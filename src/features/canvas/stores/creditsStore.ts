import { create } from "zustand";
import { invoke } from "@/features/canvas/compat/tauriCore";

/** Check if running inside Tauri (desktop) — try calling a no-op command */
export function isTauri(): boolean {
  // In Tauri v2, window.__TAURI__ is NOT set by default (requires withGlobalTauri: true).
  // Instead, we check if the invoke function is available and the IPC bridge exists.
  try {
    return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
  } catch { return false; }
}

/**
 * 获取余额系统使用的 user_id。
 * 优先使用已登录账号的邮箱，确保同一账号在不同设备上余额一致。
 * 未登录时 fallback 到本地 machine_id。
 */
export async function getCreditsUserId(): Promise<string> {
  // 1. 优先从 authStore 取已登录用户的邮箱
  try {
    const { useAuthStore } = await import("./authStore");
    const email = useAuthStore.getState().user?.email;
    if (email && email.trim()) {
      return email.trim();
    }
  } catch { /* authStore not available */ }
  // 2. 尝试从 Tauri 命令获取 auth token 对应的邮箱
  try {
    const token: string | null = await invoke<string | null>("get_auth_token");
    if (token) {
      // 解析 JWT 获取邮箱
      const parts = token.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1]));
        if (payload.email) return payload.email;
      }
    }
  } catch { /* no token */ }
  // 3. Fallback: machine_id
  try {
    return await invoke<string>("credits_machine_id");
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// CreditsStore — 全局积分状态 + 充值弹窗触发器
//
// 设计原则（一次性解决余额回滚问题）：
// 
// 根本原因：扣费成功 → 本地减余额 → 但90秒后锁解除 → fetchBalance 查服务器
// → 服务器返回旧值(可能根本没同步) → 覆盖本地正确值
//
// 解决方案：
// 1. 扣费后本地减余额(deductCredits)，同时记录"预期余额"
// 2. fetchBalance 查到服务器余额后，如果服务器余额 > 预期余额（说明服务器还没扣/多退了）
//    → 不覆盖！信任本地扣费结果
// 3. 只有服务器余额 <= 预期余额时才更新（说明服务器已经同步或用户充值了）
// 4. 无限期有效——不依赖时间锁，依赖数值比较
// ---------------------------------------------------------------------------

interface CreditsState {
  /** 当前积分余额 */
  balance: number | null;
  /** 是否正在加载余额 */
  loading: boolean;
  /** 加载错误信息 */
  error: string;
  /** 是否显示充值弹窗（余额气泡点击 or 余额不足拦截触发） */
  showRechargeDialog: boolean;
  /** 是否显示积分详情面板（余额气泡点击弹出） */
  showCreditsPanel: boolean;
  /** machineId 缓存 */
  machineId: string;
  /** auth token 缓存 */
  authToken: string | null;

  /**
   * 扣费后的最低预期余额。
   * 
   * 工作原理：
   * - 扣费成功时设置此值为：balance - amount
   * - fetchBalance 返回服务器余额时，如果 serverBalance > expectedBalance，
   *   说明服务器还没同步扣费（或被异常退费），此时不更新本地余额
   * - 只有 serverBalance <= expectedBalance 时才接受（服务器已同步 或 用户充值增加了）
   * 
   * 这比时间锁更可靠——不依赖"服务器N秒内会同步"的假设。
   * 即使服务器永远不同步，本地显示的也是正确的扣费后余额。
   */
  expectedBalance: number | null;

  /** 刷新余额（从服务器获取）— 有防覆盖保护 */
  fetchBalance: () => Promise<number | null>;
  /** 扣费后本地减余额 + 设置预期余额下限 */
  deductCredits: (amount: number) => void;
  /** 重置预期余额保护（用于充值成功后，需要接受服务器新值） */
  clearExpectedBalance: () => void;
  /** 退款场景设置预期余额上限（退款前余额+退款金额），防止服务端返回异常值 */
  setExpectedBalanceForRefund: (maxExpected: number) => void;
  /** 强制设置余额（仅用于修复严重的服务端数据异常） */
  forceSetBalance: (value: number) => void;
  /** 打开充值弹窗 */
  openRecharge: () => void;
  /** 关闭充值弹窗 */
  closeRecharge: () => void;
  /** 打开积分详情面板 */
  openCreditsPanel: () => void;
  /** 关闭积分详情面板 */
  closeCreditsPanel: () => void;
}

export const useCreditsStore = create<CreditsState>()((set, get) => ({
  balance: null,
  loading: false,
  error: "",
  showRechargeDialog: false,
  showCreditsPanel: false,
  machineId: "",
  authToken: null,
  expectedBalance: null,

  fetchBalance: async () => {
    set({ loading: true, error: "" });
    try {
      const id: string = await getCreditsUserId();
      const token: string | null = await invoke<string | null>("get_auth_token");
      const result: any = await invoke("credits_balance", { machineId: id, token });
      const serverBalance = result.balance ?? 0;
      const currentLocal = get().balance;
      const expected = get().expectedBalance;

      let finalBalance = serverBalance;

      // ── 防覆盖保护 ──
      // 如果存在预期余额 且 服务器返回值 > 预期余额
      // 说明服务器还没有反映我们的扣费（或者被异常退费）
      // 此时保留本地值，不接受服务器的高值
      if (expected !== null && currentLocal !== null && serverBalance > expected) {
        console.log(
          "[creditsStore] fetchBalance PROTECTED: server=", serverBalance,
          "> expected=", expected, ", keeping local=", currentLocal
        );
        finalBalance = currentLocal;
        // 不要重置 expectedBalance —— 保护继续生效直到充值或手动清除
      } else if (serverBalance < (currentLocal ?? Infinity)) {
        // 服务器余额更低 = 正常扣费已同步 或 新的消费发生
        console.log("[creditsStore] fetchBalance accepted: server=", serverBalance, "(lower than local", currentLocal, ")");
        // 接受服务器值，但保持 expectedBalance 不变
      } else {
        // 服务器余额 >= 本地值 且不超过预期 = 正常（可能是充值）
        console.log("[creditsStore] fetchBalance normal: server=", serverBalance, "local=", currentLocal);
        // 如果服务器值更高且合理（比如充值），接受并清除预期
        if (serverBalance > (currentLocal ?? 0)) {
          set({ expectedBalance: null });
        }
      }

      set({ balance: finalBalance, machineId: id, authToken: token, loading: false, error: "" });
      return finalBalance;
    } catch (e: any) {
      console.error("[creditsStore] fetchBalance FAILED:", e);
      set({ error: e?.toString() || "连接余额服务失败", loading: false });
      return null;
    }
  },

  /**
   * 扣费后本地减余额 + 设置预期余额下限
   * 
   * 这是扣费成功后唯一正确的余额更新方式：
   *   newBalance = 当前余额 - amount
   *   expectedBalance = newBalance （后续fetchBalance不会接受高于此值的服务器数据）
   *
   * 充值成功后必须调用 clearExpectedBalance()
   */
  deductCredits: (amount: number) => {
    const current = get().balance;
    if (current === null) {
      console.warn("[creditsStore] deductCredits called with null balance, skipping");
      return;
    }
    const newBalance = current - amount;
    set({
      balance: newBalance,
      expectedBalance: newBalance,  // 设置保护：不接受高于此值的任何服务器数据
    });
    console.log(
      "[creditsStore] deductCredits:", amount,
      "old=", current, "new=", newBalance,
      "expectedBalance set to", newBalance
    );
  },

  /**
   * 清除预期余额保护
   * 在充值成功后调用，让下次 fetchBalance 能接受服务器的新余额
   */
  clearExpectedBalance: () => {
    console.log("[creditsStore] clearExpectedBalance: was", get().expectedBalance);
    set({ expectedBalance: null });
  },

  /**
   * 退款场景设置预期余额上限
   * 防止服务端 refund 接口返回异常高余额（如 2000+ 而实际只有 10）
   * fetchBalance 会拒绝高于此值的服务器返回
   */
  setExpectedBalanceForRefund: (maxExpected: number) => {
    console.log("[creditsStore] setExpectedBalanceForRefund:", maxExpected);
    set({ expectedBalance: maxExpected });
  },

  /**
   * 强制设置余额（仅用于修复严重的服务端数据异常）
   */
  forceSetBalance: (value: number) => {
    console.log("[creditsStore] forceSetBalance:", value);
    set({ balance: value, expectedBalance: value });
  },

  openRecharge: () => set({ showRechargeDialog: true }),
  closeRecharge: () => set({ showRechargeDialog: false }),

  openCreditsPanel: () => set({ showCreditsPanel: true }),
  closeCreditsPanel: () => set({ showCreditsPanel: false }),
}));



