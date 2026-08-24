import { useSettingsStore } from "@/features/canvas/stores/settingsStore";
import { useTranslation } from "react-i18next";
import { setBaseUrl, setApiKey, checkForUpdate, jimengCheckSessionid, jimengSaveSessionid, jimengDeleteSessionid, jimengLoginWindow, jimengPollSessionid, registerCustomProvider, unregisterCustomProvider, chatCompletion } from "@/features/canvas/compat/commands";
import { getAllProviders } from "@/features/canvas/models/registry";
import { useAuthStore } from "@/features/canvas/stores/authStore";
import { useEffect, useState, useCallback } from "react";
import { create } from "zustand";
import { open } from "@/features/canvas/compat/dialog";
import { invoke } from "@/features/canvas/compat/tauriCore";
import { BUILD_INFO } from "@/lib/buildInfo";


interface SettingsDialogState {
  isOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  isOpen: false,
  openSettings: () => set({ isOpen: true, activeTab: "models" }),
  closeSettings: () => set({ isOpen: false }),
  activeTab: "models",
  setActiveTab: (activeTab) => set({ activeTab }),
}));

/** All known provider definitions */
const KNOWN_PROVIDERS = getAllProviders();

// P9: SVG icons for tab items — consistent with project style (no emoji/numbers)
const TAB_ICONS: Record<string, React.ReactNode> = {
  models: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>,
  image: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
  chat: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  video: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>,
  savePath: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
  update: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
  general: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  appearance: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a7 7 0 0 0 0 14"/></svg>,
  credits: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  tutorial: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h6z"/></svg>,
};

const TABS = [
  { id: "models", label: "内置模型", desc: "查看虾客漫画布内置模型" },
  { id: "tutorial", label: "使用说明", desc: "画布节点创作流程" },
  { id: "general", label: "通用", desc: "" },
  { id: "appearance", label: "外观", desc: "" },
];

/** Channel definitions per AI tab */
const CHANNEL_OPTIONS: Record<string, { id: string; label: string; desc: string; baseUrl: string }[]> = {
  image: [
    { id: "artlist", label: "虾客漫自有图片", desc: "Nano Banana / Seedream 5.0 / GPT Image 2 · 复用主站卡密", baseUrl: "https://sd2.xiakeman.com/api" },
    { id: "grsai", label: "虾客漫图像", desc: "GPT Image 2 / Nano Banana系列 / 多尺寸", baseUrl: "https://grsaiapi.com/v1" },
  ],
  chat: [
    { id: "grsai", label: "虾客漫对话", desc: "GPT-5.4/5.5 / Gemini 3系列 / 多模型", baseUrl: "https://grsaiapi.com/v1" },
  ],
  video: [
    { id: "vjimeng", label: "虾客漫视频", desc: "Seedance2.0 Mini/Fast/满血 / 复用主站卡密", baseUrl: "https://sd2.xiakeman.com/api" },
    { id: "vjimeng-sd2", label: "虾客漫 SD2", desc: "兼容旧项目 / 复用主站卡密", baseUrl: "https://sd2.xiakeman.com/api" },
  ],
  audio: [
    { id: "grsai", label: "虾客漫音频", desc: "Minimax / OpenAI TTS / OpenAI兼容", baseUrl: "https://grsaiapi.com/v1" },
  ],
};

/** Channel link URLs for each channel option */
const CHANNEL_LINKS: Record<string, { website: string; apiPlatform: string; docs: string }> = {
  grsai: {
    website: "https://www.grsai.com",
    apiPlatform: "https://api.grsai.com",
    docs: "https://qmy27nhsd9.apifox.cn/452392911e0",
  },
  artlist: {
    website: "https://sd2.xiakeman.com",
    apiPlatform: "https://sd2.xiakeman.com",
    docs: "https://sd2.xiakeman.com",
  },
  vjimeng: {
    website: "https://sd2.xiakeman.com",
    apiPlatform: "https://sd2.xiakeman.com",
    docs: "https://sd2.xiakeman.com",
  },
  "vjimeng-sd2": {
    website: "https://sd2.xiakeman.com",
    apiPlatform: "https://sd2.xiakeman.com",
    docs: "https://sd2.xiakeman.com",
  },
  "jimeng-official": {
    website: "https://jimeng.jianying.com",
    apiPlatform: "https://jimeng.jianying.com",
    docs: "https://jimeng.jianying.com",
  },
};

const BUILTIN_MODEL_GROUPS = [
  {
    title: "图像生成",
    subtitle: "用于 AI 图片、角色、场景、道具、分镜帧生成",
    channel: "虾客漫自有图片 / 虾客漫图像",
    models: ["Nano Banana", "Nano Banana Pro", "Seedream 5.0", "GPT Image 2"],
  },
  {
    title: "视频生成",
    subtitle: "用于文生视频、图生视频、多图参考视频",
    channel: "虾客漫视频 / 虾客漫 SD2",
    models: ["Seedance2.0 Mini", "Seedance2.0 Fast", "Seedance2.0 满血"],
  },
  {
    title: "文本与剧本",
    subtitle: "用于 AI 对话、剧本扩写、节点提示词辅助",
    channel: "虾客漫对话",
    models: ["Gemini Flash", "Gemini Pro", "GPT-5 系列"],
  },
  {
    title: "音频",
    subtitle: "用于画布音频节点和后续配音扩展",
    channel: "虾客漫音频",
    models: ["内置语音合成", "多音色配音"],
  },
] as const;

function BuiltInModelsOverview() {
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
        虾客漫内置模型
      </h2>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 18 }}>
        画布统一使用网站内置模型和平台额度。用户不需要填写密钥或接口地址，也不需要添加第三方通道。
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        {BUILTIN_MODEL_GROUPS.map((group) => (
          <div
            key={group.title}
            style={{
              border: "1px solid var(--border-glow)",
              borderRadius: 12,
              padding: 14,
              background: "var(--accent-dim)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 3 }}>
                  {group.title}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  {group.subtitle}
                </div>
              </div>
              <span
                style={{
                  flexShrink: 0,
                  border: "1px solid color-mix(in srgb, var(--success) 34%, transparent)",
                  borderRadius: 999,
                  padding: "4px 8px",
                  background: "color-mix(in srgb, var(--success) 12%, transparent)",
                  color: "var(--success)",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                已内置
              </span>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--accent-light)" }}>
              {group.channel}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}>
              {group.models.map((model) => (
                <span
                  key={model}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 999,
                    padding: "4px 8px",
                    background: "var(--bg-secondary)",
                    color: "var(--text-secondary)",
                    fontSize: 11,
                  }}
                >
                  {model}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 14,
          border: "1px solid color-mix(in srgb, var(--accent) 28%, transparent)",
          borderRadius: 12,
          padding: 12,
          background: "color-mix(in srgb, var(--accent) 8%, transparent)",
          color: "var(--text-secondary)",
          fontSize: 12,
          lineHeight: 1.6,
        }}
      >
        节点里的“通道 / 模型”下拉只会出现虾客漫内置选项。后续如需增加新模型，应该在网站后台统一维护，而不是让终端用户自己配置。
      </div>
    </div>
  );
}

function CanvasUsageGuide() {
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
        画布使用说明
      </h2>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 18 }}>
        画布适合不走 Step1-Step5 固定流程的自由创作：先放想法，再接图片、视频、音频和合成节点。
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {[
          ["创建节点", "在画布空白处右键，或点击左侧 +，添加图片、剧本、角色、视频等节点。"],
          ["连接素材", "把上游图片或分镜连到视频节点，节点会自动把参考图带入生成。"],
          ["修改提示词", "直接在节点输入框里改文字；生成不满意时，在节点内重新生成或替换输入。"],
          ["管理素材", "左侧素材库可以保存常用角色、场景和道具，拖到画布即可继续使用。"],
        ].map(([title, text], index) => (
          <div
            key={title}
            style={{
              display: "flex",
              gap: 12,
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 12,
              background: "var(--bg-secondary)",
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                background: "var(--accent-dim)",
                color: "var(--accent-light)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {index + 1}
            </span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 3 }}>
                {title}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                {text}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Jimeng Official Login Component — uses Cookie bridge (sessionid) instead of API key */
function JimengOfficialLogin() {
  const [sessionId, setSessionId] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [showUpdate, setShowUpdate] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    if (window.__TAURI__) {
      jimengCheckSessionid().then((exists: boolean) => {
        setIsLoggedIn(exists);
        if (exists) setStatus("saved");
      }).catch(() => {}).finally(() => setIsChecking(false));

      // Listen for login success event from popup window
      const unlisten = (window as any).__TAURI__?.event?.listen?.("jimeng-login-success", () => {
        setIsLoggedIn(true);
        setStatus("saved");
        setShowUpdate(false);
        setIsLoggingIn(false);
      });
      return () => { unlisten?.then?.((fn: () => void) => fn()); };
    } else {
      setIsChecking(false);
    }
  }, []);

  const handleOneClickLogin = async () => {
    setIsLoggingIn(true);
    try {
      await jimengLoginWindow();
      // PRIMARY: Poll via Rust jimengPollSessionid() which uses WebView2's
      // native cookie API — can read HttpOnly cookies that JS document.cookie
      // cannot see. Falls back to the event listener above.
      const pollInterval = setInterval(async () => {
        try {
          const sid = await jimengPollSessionid();
          if (sid) {
            // sessionid found and auto-saved by Rust
            setIsLoggedIn(true);
            setStatus("saved");
            setShowUpdate(false);
            setIsLoggingIn(false);
            clearInterval(pollInterval);
          }
        } catch {}
      }, 2000);
      // Stop polling after 5 minutes
      setTimeout(() => { clearInterval(pollInterval); setIsLoggingIn(false); }, 300000);
    } catch {
      setIsLoggingIn(false);
    }
  };

  const handleSave = async () => {
    if (!sessionId.trim()) return;
    setStatus("saving");
    try {
      await jimengSaveSessionid(sessionId.trim());
      setIsLoggedIn(true);
      setStatus("saved");
      setShowUpdate(false);
      setSessionId("");
    } catch {
      setStatus("error");
    }
  };

  const handleLogout = async () => {
    try {
      await jimengDeleteSessionid();
      setIsLoggedIn(false);
      setStatus("idle");
      setSessionId("");
      setShowUpdate(false);
    } catch {}
  };

  if (isChecking) {
    return (
      <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 0" }}>
        检测登录状态中...
      </div>
    );
  }

  if (isLoggedIn && !showUpdate) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(122, 180, 240, 0.1)", border: "1px solid rgba(122, 180, 240, 0.2)" }}>
          <span style={{ fontSize: 14 }}>✅</span>
          <span style={{ fontSize: 13, color: "var(--accent-light)" }}>已登录即梦官网，可使用积分生成视频</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowUpdate(true)} style={{ fontSize: 12, color: "var(--accent-light)", background: "none", border: "1px solid var(--border-glow)", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>
            更新登录
          </button>
          <button onClick={handleLogout} style={{ fontSize: 12, color: "var(--text-muted)", background: "none", border: "1px solid var(--border-glow)", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>
            退出登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* 一键登录按钮 */}
      <button
        onClick={handleOneClickLogin}
        disabled={isLoggingIn}
        style={{
          padding: "10px 16px",
          borderRadius: 8,
          border: "none",
          background: "var(--accent-btn)",
          color: "#fff",
          fontSize: 13,
          fontWeight: 500,
          cursor: isLoggingIn ? "wait" : "pointer",
          opacity: isLoggingIn ? 0.7 : 1,
          width: "100%",
        }}
      >
        {isLoggingIn ? "等待登录中..." : "🔑 一键登录即梦官网"}
      </button>

      {/* 分隔线 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>或手动输入</span>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>

      {/* 手动输入 sessionid */}
      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
        从浏览器 Cookie 中复制 <code style={{ background: "var(--bg-secondary)", padding: "1px 4px", borderRadius: 3, fontSize: 10 }}>sessionid</code> 的值
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="password"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder="粘贴 sessionid..."
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid var(--border-glow)",
            background: "var(--bg-secondary)",
            color: "var(--text-primary)",
            fontSize: 13,
            outline: "none",
            fontFamily: "monospace",
          }}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
        />
        <button
          onClick={handleSave}
          disabled={status === "saving" || !sessionId.trim()}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "none",
            background: "var(--accent-btn)",
            color: "#fff",
            fontSize: 13,
            cursor: status === "saving" || !sessionId.trim() ? "not-allowed" : "pointer",
            opacity: status === "saving" || !sessionId.trim() ? 0.6 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {status === "saving" ? "保存中..." : "登录"}
        </button>
      </div>
      {status === "error" && (
        <div style={{ fontSize: 12, color: "var(--error)" }}>保存失败，请重试</div>
      )}
    </div>
  );
}

/** Custom Providers Section — for user-defined OpenAI-compatible API endpoints */
function CustomProvidersSection({ nodeType }: { nodeType: "image" | "chat" | "video" | "audio" }) {
  const settings = useSettingsStore();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newApiFormat, setNewApiFormat] = useState<"openai" | "volcano" | "kling" | "luma" | "runway" | "minimax" | "yunzhi" | "pika" | "vidu" | "veo" | "grok" | "sora" | "zhipu" | "aicost" | "axmgc" | "custom">("openai");
  const [newModels, setNewModels] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Smart parse — paste API docs to auto-detect paths/fields
  const [docText, setDocText] = useState("");
  const [parseMsg, setParseMsg] = useState<{ type: "ok" | "info"; text: string } | null>(null);
  // Custom format override fields (filled by smart parse or manually)
  const [customSubmitPath, setCustomSubmitPath] = useState("");
  const [customPollPath, setCustomPollPath] = useState("");
  const [customStatusField, setCustomStatusField] = useState("");
  const [customDoneValue, setCustomDoneValue] = useState("");
  const [customVideoUrlField, setCustomVideoUrlField] = useState("");
  // Per-card collapsible "高级设置" state (keyed by provider ID)
  const [expandedAdvanced, setExpandedAdvanced] = useState<Record<string, boolean>>({});

  // Highlight states for each expanded provider's advanced fields
  const [expandedProviders, setExpandedProviders] = useState<Record<string, {
    _submit_url_path: string;
    _poll_url_path: string;
    _status_field: string;
    _done_value: string;
    _video_url_field: string;
  }>>({});

  const toggleAdvanced = (id: string) => {
    setExpandedAdvanced((prev) => {
      const next = !prev[id];
      if (next) {
        // Load current values when expanding
        const cp = settings.customProviders.find((p: any) => p.id === id);
        if (cp) {
          setExpandedProviders((prev2) => ({
            ...prev2,
            [id]: {
              _submit_url_path: (cp as any)._submit_url_path || "",
              _poll_url_path: (cp as any)._poll_url_path || "",
              _status_field: (cp as any)._status_field || "",
              _done_value: (cp as any)._done_value || "",
              _video_url_field: (cp as any)._video_url_field || "",
            },
          }));
        }
      } else {
        setExpandedProviders((prev2) => {
          const next2 = { ...prev2 };
          delete next2[id];
          return next2;
        });
      }
      return { ...prev, [id]: next };
    });
  };

  const updateAdvanced = (id: string, field: string, value: string) => {
    setExpandedProviders((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
    settings.updateCustomProvider(id, { [field]: value });
  };

  const handleSmartParse = async () => {
    if (!docText.trim()) { setParseMsg({ type: "info", text: "请先粘贴 API 文档或网址" }); return; }

    let content = docText.trim();

    // ── Detect URL → fetch webpage content ──
    const urlMatch = content.match(/^(https?:\/\/[^\s]+)$/);
    if (urlMatch) {
      setParseMsg({ type: "info", text: "正在获取网页内容..." });
      try {
        const resp = await fetch(urlMatch[1]);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const html = await resp.text();
        // Strip HTML tags, normalize whitespace
        content = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]*>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, " ")
          .substring(0, 8000);
        if (!content.trim()) throw new Error("网页内容为空");
        setParseMsg({ type: "info", text: "已获取网页内容，AI 分析中..." });
      } catch (fetchErr: any) {
        console.warn("[SmartParse] URL fetch failed:", fetchErr.message || fetchErr);
        setParseMsg({ type: "info", text: `无法获取网页: ${fetchErr.message}。请直接粘贴文档内容` });
        return;
      }
    }

    // ── Try AI-powered parse first ──
    // Find available chat provider: custom with key, or grsai/vjimeng built-in
    const allProviders = useSettingsStore.getState().providers;
    const customChat = useSettingsStore.getState().customProviders.find(
      (cp) => cp.apiKey && cp.capabilities.includes("chat" as any)
    );

    let chatBaseUrl = "";
    let chatApiKey = "";
    let chatModel = "gpt-4o-mini";
    let chatProviderId = "";

    if (customChat) {
      chatBaseUrl = customChat.baseUrl;
      chatApiKey = customChat.apiKey || "";
      chatModel = (customChat.models || "").split(/[,，]/)[0]?.trim() || "gpt-4o-mini";
      chatProviderId = customChat.id;
    } else {
      // Try built-in grsai/vjimeng chat
      const chatModelProvider = allProviders.find((p) => p.id === "chat-model");
      if (chatModelProvider?.apiKey) {
        chatBaseUrl = chatModelProvider.baseUrl || "https://api.openai.com/v1";
        chatApiKey = chatModelProvider.apiKey;
        chatModel = chatModelProvider.modelName || "gpt-4o-mini";
        chatProviderId = chatModelProvider.channel || "chat-model";
      }
    }

    if (chatApiKey && chatBaseUrl) {
      // AI-powered parse
      setParseMsg({ type: "info", text: "AI 正在分析文档..." });
      try {
        const response: any = await chatCompletion({
          provider: chatProviderId,
          baseUrl: chatBaseUrl,
          apiKey: chatApiKey,
          model: chatModel,
          messages: [
            {
              role: "system",
              content: `You are an API documentation parser. Extract the following fields from the API documentation and return ONLY valid JSON (no markdown, no explanation):

{
  "base_url": "the API base URL (e.g. https://api.example.com)",
  "submit_method": "POST or PUT or PATCH",
  "submit_path": "the endpoint path for submitting tasks (e.g. /v1/video/generations)",
  "submit_content_type": "json or multipart or form",
  "poll_method": "GET or POST",
  "poll_path": "the endpoint path for polling task status, use {id} as placeholder (e.g. /v1/tasks/{id})",
  "status_field": "the JSON field name for task status (e.g. status, state, task_status)",
  "done_values": ["list of", "values that indicate", "completion"],
  "failed_values": ["list of", "values that indicate", "failure"],
  "result_field": "the JSON field/path for the video URL or image URL (e.g. video_url, data.url, output.image_url)",
  "result_is_array": true or false,
  "auth_style": "bearer or token or x-goog-api-key or x-api-key or basic",
  "supports_stream": true or false,
  "image_size_fields": {"width_field": "width", "height_field": "height"} or null,
  "extra_headers": {"Header-Name": "description"} or {}
}

Rules:
- For result_field, use dot notation for nested paths (e.g. "data.result.url")
- If the result is an array, set result_is_array=true and result_field to the array path (e.g. "data")
- For auth_style: "bearer" = Authorization: Bearer xxx, "token" = Token xxx, "x-goog-api-key", "x-api-key", or "basic"
- If the doc describes multiple APIs (e.g. text2video + image2video), extract the most common pattern
- If a field is not found, set it to null or empty string
- ONLY output the JSON object, nothing else`
            },
            {
              role: "user",
              content: `Parse this API documentation:\n\n${docText}`
            }
          ],
          temperature: 0,
          maxTokens: 1000,
        });

        // Parse the AI response — extract JSON from possibly wrapped text
        const text = typeof response === "string" ? response : JSON.stringify(response);
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("AI 返回格式异常");
        const parsed = JSON.parse(jsonMatch[0]);

        // Apply parsed fields
        if (parsed.base_url) setNewBaseUrl(parsed.base_url);
        if (parsed.submit_path) setCustomSubmitPath(parsed.submit_path);
        if (parsed.poll_path) setCustomPollPath(parsed.poll_path);
        if (parsed.status_field) setCustomStatusField(parsed.status_field);
        if (parsed.done_values && parsed.done_values.length > 0) setCustomDoneValue(parsed.done_values[0]);
        if (parsed.result_field) setCustomVideoUrlField(parsed.result_field);
        setParseMsg({ type: "ok", text: "AI 识别成功" });
        return;
      } catch (aiErr: any) {
        console.warn("[SmartParse] AI parse failed, falling back to regex:", aiErr.message || aiErr);
      }
    }

    // ── Regex fallback ──
    const d = docText.trim();
    let found = 0;

    const baseUrlMatch = d.match(/(https?:\/\/[^\s"<>]+)/g);
    if (baseUrlMatch) {
      const apiUrl = baseUrlMatch.find(u => !u.endsWith(".com") && !u.endsWith(".png") && !u.endsWith(".jpg"));
      if (apiUrl) { const u = new URL(apiUrl); setNewBaseUrl(u.origin); found++; }
    }

    const postMatch = d.match(/POST\s+(\/[\w\/-]+)/i);
    if (postMatch) { setCustomSubmitPath(postMatch[1]); found++; }

    const getMatch = d.match(/GET\s+(\/[\w\/-]+)\/\{/i);
    if (getMatch) { setCustomPollPath(getMatch[1]); found++; }

    const statusMatch = d.match(/"(\w+)":\s*"(succeeded|completed|success|done|finished|ready|SUCCESS|COMPLETED)"/i);
    if (statusMatch) { setCustomStatusField(statusMatch[1]); setCustomDoneValue(statusMatch[2]); found += 2; }

    const videoMatch = d.match(/resource_list|\bresource_url\b|video_url|result_url/);
    if (videoMatch) {
      const field = videoMatch[0];
      if (field === "resource_list") setCustomVideoUrlField("resource_list.0.resource_url");
      else setCustomVideoUrlField(field);
      found++;
    }

    setParseMsg(found > 0 ? { type: "ok", text: `自动识别 ${found} 个字段` } : { type: "info", text: "未能识别，请手动填写高级设置" });
  };

  // Filter custom providers by capability
  const customProviders = settings.customProviders.filter((cp) =>
    cp.capabilities.includes(nodeType)
  );

  const handleAdd = async () => {
    if (!newName.trim() || !newBaseUrl.trim()) return;
    const id = `custom-${Date.now()}`;
    const config = {
      id,
      name: newName.trim(),
      baseUrl: newBaseUrl.trim(),
      apiKey: "",
      apiFormat: newApiFormat,
      models: newModels.trim(),
      capabilities: [nodeType] as ("image" | "chat" | "video" | "audio")[],
      createdAt: Date.now(),
    } as Parameters<typeof settings.addCustomProvider>[0];
    // Add smart-parsed override fields for custom format
    if (newApiFormat === "custom") {
      if (customSubmitPath.trim()) config._submit_url_path = customSubmitPath.trim();
      if (customPollPath.trim()) config._poll_url_path = customPollPath.trim();
      if (customStatusField.trim()) config._status_field = customStatusField.trim();
      if (customDoneValue.trim()) config._done_value = customDoneValue.trim();
      if (customVideoUrlField.trim()) config._video_url_field = customVideoUrlField.trim();
    }

    // Register in frontend store
    settings.addCustomProvider(config);

    // Register in Rust backend
    if (window.__TAURI__) {
      setSyncing(true);
      try {
        const parsedModels = newModels.trim() ? newModels.split(/[,，]/).map((m) => m.trim()).filter(Boolean) : ["custom-model"];
        await registerCustomProvider({ id, name: config.name, baseUrl: config.baseUrl, models: parsedModels });
        console.log("[CustomProviders] Registered in Rust:", id);
      } catch (e) {
        console.error("[CustomProviders] Failed to register in Rust:", e);
      }
      setSyncing(false);
    }

    setNewName("");
    setNewBaseUrl("");
    setNewModels("");
    setNewApiFormat("openai");
    setDocText(""); setParseMsg(null);
    setCustomSubmitPath(""); setCustomPollPath(""); setCustomStatusField(""); setCustomDoneValue(""); setCustomVideoUrlField("");
    setShowAddForm(false);
  };

  const handleDelete = async (cp: typeof settings.customProviders[0]) => {
    // Remove from frontend store
    settings.removeCustomProvider(cp.id);

    // Unregister from Rust backend
    if (window.__TAURI__) {
      try {
        await unregisterCustomProvider(cp.id);
        console.log("[CustomProviders] Unregistered from Rust:", cp.id);
      } catch (e) {
        console.error("[CustomProviders] Failed to unregister:", e);
      }
    }
  };

  const handleKeyChange = async (cp: typeof settings.customProviders[0], newKey: string) => {
    // Update in frontend store
    settings.updateCustomProvider(cp.id, { apiKey: newKey });

    // Sync API key to Rust backend
    if (window.__TAURI__ && newKey) {
      try {
        await setApiKey(cp.id, newKey);
        console.log("[CustomProviders] Synced API key for:", cp.id);
      } catch (e) {
        console.error("[CustomProviders] Failed to sync key:", e);
      }
    }
  };

  return (
    <div style={{ marginTop: 32 }}>
      {/* Section header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 12,
      }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
            自定义API
          </h3>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, marginBottom: 0 }}>
            添加你自己的 OpenAI 兼容 API 端点
          </p>
        </div>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            style={{
              fontSize: 12,
              padding: "6px 14px",
              borderRadius: 8,
              border: "1px dashed var(--border-glow)",
              background: "transparent",
              color: "var(--accent-light)",
              cursor: "pointer",
            }}
          >
            + 添加
          </button>
        )}
      </div>

      {/* ====== Quick Parse: paste doc/URL → AI auto-fill & add ====== */}
      {!showAddForm && (
        <div style={{
          border: "1px solid var(--accent-muted)",
          borderRadius: 12,
          padding: 16,
          marginBottom: 12,
          background: "rgba(122, 180, 240, 0.05)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent-light)" }}>
              粘贴文档 / 网址 — AI 自动识别并添加
            </span>
          </div>
          <textarea
            value={docText}
            onChange={(e) => { setDocText(e.target.value); setParseMsg(null); }}
            placeholder={`粘贴 {${nodeType === "image" ? "图片" : nodeType === "chat" ? "对话" : nodeType === "audio" ? "音频" : "视频"}} API 文档内容，或直接粘贴文档网址...
支持：OpenAI、火山方舟、可灵、Luma、Runway、MiniMax、Pika、Vidu 等任意 API`}
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--border-glow)",
              background: "var(--bg-primary)",
              color: "var(--text-primary)",
              fontSize: 12,
              outline: "none",
              resize: "vertical",
              minHeight: 64,
              fontFamily: "monospace",
            }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={handleSmartParse}
              style={{
                fontSize: 12,
                padding: "7px 18px",
                borderRadius: 8,
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              🤖 AI 智能解析
            </button>
            {parseMsg && (
              <span style={{
                fontSize: 12,
                color: parseMsg.type === "ok" ? "#22c55e" : "var(--text-secondary)",
              }}>
                {parseMsg.text}
              </span>
            )}
            {/* Show detected config summary */}
            {newBaseUrl && (
              <button
                onClick={handleAdd}
                disabled={!newName.trim() || syncing}
                style={{
                  fontSize: 12,
                  padding: "7px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--success)",
                  color: "#fff",
                  cursor: (!newName.trim() || syncing) ? "not-allowed" : "pointer",
                  fontWeight: 500,
                  opacity: (!newName.trim() || syncing) ? 0.5 : 1,
                  marginLeft: "auto",
                }}
              >
                {syncing ? "添加中..." : "✓ 一键添加"}
              </button>
            )}
          </div>
          {/* Show parsed fields preview */}
          {newBaseUrl && (
            <div style={{
              fontSize: 11,
              color: "var(--text-muted)",
              background: "var(--bg-secondary)",
              borderRadius: 8,
              padding: "8px 12px",
              display: "flex",
              flexWrap: "wrap",
              gap: "4px 16px",
            }}>
              <span>名称: <b style={{ color: "var(--text-primary)" }}>{newName}</b></span>
              <span>Base URL: <b style={{ color: "var(--text-primary)", fontFamily: "monospace" }}>{newBaseUrl}</b></span>
              {customSubmitPath && <span>POST: <b style={{ color: "var(--text-primary)", fontFamily: "monospace" }}>{customSubmitPath}</b></span>}
              {customPollPath && <span>GET: <b style={{ color: "var(--text-primary)", fontFamily: "monospace" }}>{customPollPath}</b></span>}
              {customStatusField && <span>状态字段: <b style={{ color: "var(--text-primary)" }}>{customStatusField}={customDoneValue || "?"}</b></span>}
              {customVideoUrlField && <span>结果路径: <b style={{ color: "var(--text-primary)", fontFamily: "monospace" }}>{customVideoUrlField}</b></span>}
            </div>
          )}
        </div>
      )}

      {/* Add form */}
      {showAddForm && (
        <div style={{
          border: "1px solid var(--accent-muted)",
          borderRadius: 12,
          padding: 16,
          marginBottom: 12,
          background: "rgba(122, 180, 240, 0.05)",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Preset selector */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "var(--text-muted)", flexShrink: 0 }}>平台:</span>
              <select
                value={newApiFormat}
                onChange={(e) => {
                  const val = e.target.value as typeof newApiFormat;
                  setNewApiFormat(val);
                  const map: Record<string, string> = {
                    volcano: "https://ark.cn-beijing.volces.com/api/v3",
                    kling: "https://api.kuaishou.com",
                    luma: "https://api.lumalabs.ai/dream-machine",
                    runway: "https://api.runwayml.com",
                    minimax: "https://api.minimax.chat",
                    pika: "https://api.pika.art",
                    vidu: "https://api.vidu.cn",
                    veo: "https://generativelanguage.googleapis.com",
                    grok: "https://api.x.ai",
                    sora: "https://api.openai.com",
                    zhipu: "https://open.bigmodel.cn/api/paas",
                    yunzhi: "https://aiyunzhi.top",
                    aicost: "https://www.aicost.xyz",
                    axmgc: "https://axmgc.com",
                    custom: "",
                  };
                  const names: Record<string, string> = {
                    volcano: "火山方舟", kling: "可灵", luma: "Luma", runway: "Runway",
                    minimax: "海螺", pika: "Pika", vidu: "Vidu", veo: "Veo",
                    grok: "Grok Video", sora: "Sora", zhipu: "智谱", yunzhi: "云智",
                    aicost: "aicost.xyz", axmgc: "爱享漫工厂", custom: "通用自定义",
                  };
                  if (names[val]) setNewName(names[val]);
                  if (map[val] !== undefined) setNewBaseUrl(map[val]);
                  // Reset smart parse when switching away from custom
                  if (val !== "custom") {
                    setDocText(""); setParseMsg(null);
                    setCustomSubmitPath(""); setCustomPollPath(""); setCustomStatusField(""); setCustomDoneValue(""); setCustomVideoUrlField("");
                  }
                }}
                style={{
                  flex: 1, padding: "8px 12px", borderRadius: 8,
                  border: "1px solid var(--border-glow)", background: "var(--bg-secondary)",
                  color: "var(--text-primary)", fontSize: 13, outline: "none",
                }}
              >
                <option value="openai">OpenAI 兼容</option>
                <option value="volcano">火山方舟</option>
                <option value="kling">可灵 Kling</option>
                <option value="luma">Luma</option>
                <option value="runway">Runway</option>
                <option value="minimax">MiniMax 海螺</option>
                <option value="pika">Pika</option>
                <option value="vidu">Vidu</option>
                <option value="veo">Google Veo</option>
                <option value="grok">Grok</option>
                <option value="sora">Sora</option>
                <option value="zhipu">智谱 Zhipu</option>
                <option value="yunzhi">云智 Yunzhi</option>
                <option value="axmgc">axmgc 爱享漫工厂</option>
                <option value="aicost">aicost.xyz</option>
                <option value="custom">通用自定义</option>
              </select>
            </div>

            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={newApiFormat === "volcano" ? "API 名称 (如: 火山方舟)" : "API 名称 (如: 我的OpenAI)"}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--border-glow)",
                background: "var(--bg-secondary)",
                color: "var(--text-primary)",
                fontSize: 13,
                outline: "none",
              }}
            />
            <input
              value={newBaseUrl}
              onChange={(e) => setNewBaseUrl(e.target.value)}
              placeholder={newApiFormat === "volcano" ? "https://ark.cn-beijing.volces.com/api/v3" : "Base URL (如: https://api.openai.com/v1)"}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--border-glow)",
                background: "var(--bg-secondary)",
                color: "var(--text-primary)",
                fontSize: 13,
                outline: "none",
                fontFamily: "monospace",
              }}
            />
            <input
              value={newModels}
              onChange={(e) => setNewModels(e.target.value)}
              placeholder="模型名称 (可选, 多个用逗号分隔, 留空则使用通用列表)"
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--border-glow)",
                background: "var(--bg-secondary)",
                color: "var(--text-primary)",
                fontSize: 13,
                outline: "none",
                fontFamily: "monospace",
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowAddForm(false)}
                style={{
                  fontSize: 12,
                  padding: "6px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--border-glow)",
                  background: "transparent",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                取消
              </button>
              <button
                onClick={handleAdd}
                disabled={!newName.trim() || !newBaseUrl.trim() || syncing}
                style={{
                  fontSize: 12,
                  padding: "6px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--accent)",
                  color: "#fff",
                  cursor: (!newName.trim() || !newBaseUrl.trim() || syncing) ? "not-allowed" : "pointer",
                  opacity: (!newName.trim() || !newBaseUrl.trim() || syncing) ? 0.5 : 1,
                }}
              >
                {syncing ? "注册中..." : "添加"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom provider list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {customProviders.map((cp) => {
          const hasKey = !!cp.apiKey;
          return (
            <div
              key={cp.id}
              style={{
                border: "1px solid var(--border-glow)",
                borderRadius: 12,
                padding: 16,
                background: "var(--accent-dim)",
              }}
            >
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: hasKey ? "var(--success)" : "var(--error)",
                  flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: hasKey ? "var(--accent-light)" : "var(--text-primary)" }}>
                    {cp.name}
                    {cp.apiFormat === "volcano" && (
                      <span style={{
                        fontSize: 11,
                        marginLeft: 6,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "var(--accent-dim)",
                        color: "var(--accent-light)",
                        fontWeight: 400,
                      }}>火山方舟</span>
                    )}
                    {cp.apiFormat === "kling" && (
                      <span style={{
                        fontSize: 11,
                        marginLeft: 6,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "var(--accent-dim)",
                        color: "var(--accent-light)",
                        fontWeight: 400,
                      }}>可灵</span>
                    )}
                    {cp.apiFormat === "luma" && (
                      <span style={{
                        fontSize: 11,
                        marginLeft: 6,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "var(--accent-dim)",
                        color: "var(--accent-light)",
                        fontWeight: 400,
                      }}>Luma</span>
                    )}
                    {cp.apiFormat === "runway" && (
                      <span style={{
                        fontSize: 11,
                        marginLeft: 6,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "var(--accent-dim)",
                        color: "var(--accent-light)",
                        fontWeight: 400,
                      }}>Runway</span>
                    )}
                    {cp.apiFormat === "minimax" && (
                      <span style={{
                        fontSize: 11,
                        marginLeft: 6,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "var(--accent-dim)",
                        color: "var(--accent-light)",
                        fontWeight: 400,
                      }}>MiniMax海螺</span>
                    )}
                    {cp.apiFormat === "yunzhi" && (
                      <span style={{
                        fontSize: 11,
                        marginLeft: 6,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "var(--accent-dim)",
                        color: "var(--accent-light)",
                        fontWeight: 400,
                      }}>云智</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, fontFamily: "monospace" }}>
                    {cp.baseUrl}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: hasKey ? "var(--success)" : "var(--error)" }}>
                    {hasKey ? "已配置" : "未配置"}
                  </span>
                  <button
                    onClick={() => handleDelete(cp)}
                    style={{
                      fontSize: 11,
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: "1px solid rgba(255, 80, 80, 0.3)",
                      background: "transparent",
                      color: "#ff5050",
                      cursor: "pointer",
                    }}
                    title="删除此自定义API"
                  >
                    删除
                  </button>
                </div>
              </div>

              {/* API Key input */}
              <div style={{ position: "relative" }}>
                <input
                  type={showApiKey ? "text" : "password"}
                  value={cp.apiKey}
                  onChange={(e) => handleKeyChange(cp, e.target.value)}
                  placeholder="输入 API 密钥..."
                  style={{
                    width: "100%",
                    padding: "10px 40px 10px 14px",
                    borderRadius: 10,
                    border: "1px solid var(--border-glow)",
                    background: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    fontSize: 13,
                    outline: "none",
                    fontFamily: "monospace",
                  }}
                />
                <button
                  onClick={() => setShowApiKey(!showApiKey)}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    padding: 4,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title={showApiKey ? "隐藏密钥" : "显示密钥"}
                >
                  {showApiKey ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>

              {/* Models input — comma-separated, e.g. gpt-image-1, dall-e-3 */}
              <div style={{ marginTop: 8 }}>
                <input
                  value={cp.models || ""}
                  onChange={(e) => {
                    settings.updateCustomProvider(cp.id, { models: e.target.value });
                    // Also sync to Rust backend
                    if (window.__TAURI__) {
                      registerCustomProvider({
                        id: cp.id,
                        name: cp.name,
                        baseUrl: cp.baseUrl,
                        models: e.target.value ? e.target.value.split(/[,，]/).map((m) => m.trim()).filter(Boolean) : ["custom-model"],
                      }).catch((err) => console.error("[CustomProviders] Failed to sync models:", err));
                    }
                  }}
                  placeholder="模型名称 (多个用逗号分隔, 如: gpt-image-1, dall-e-3)"
                  style={{
                    width: "100%",
                    padding: "8px 14px",
                    borderRadius: 10,
                    border: "1px solid var(--border-glow)",
                    background: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    fontSize: 13,
                    outline: "none",
                    fontFamily: "monospace",
                  }}
                />
              </div>

              {/* Advanced settings — only for video channels or custom format */}
              {(nodeType === "video" || (cp as any).apiFormat === "custom") && (
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={() => toggleAdvanced(cp.id)}
                    style={{
                      fontSize: 12,
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--border-glow)",
                      background: "transparent",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <svg
                      width="12" height="12" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round"
                      style={{
                        transform: expandedAdvanced[cp.id] ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "transform 0.2s",
                      }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                    高级设置
                  </button>
                  {expandedAdvanced[cp.id] && (
                    <div style={{
                      marginTop: 8,
                      padding: "12px",
                      borderRadius: 8,
                      border: "1px solid var(--border-glow)",
                      background: "var(--bg-secondary)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        路径覆盖 — 仅当 API 格式为非标准时填写。留空则使用自动识别。
                      </span>
                      <input
                        value={expandedProviders[cp.id]?._submit_url_path || (cp as any)._submit_url_path || ""}
                        onChange={(e) => updateAdvanced(cp.id, "_submit_url_path", e.target.value)}
                        placeholder="提交路径 (如 /v1/video/generations)"
                        style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border-glow)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 12, outline: "none" }}
                      />
                      <input
                        value={expandedProviders[cp.id]?._poll_url_path || (cp as any)._poll_url_path || ""}
                        onChange={(e) => updateAdvanced(cp.id, "_poll_url_path", e.target.value)}
                        placeholder="轮询路径 (如 /v1/video/generations)"
                        style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border-glow)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 12, outline: "none" }}
                      />
                      <div style={{ display: "flex", gap: "8px" }}>
                        <input
                          value={expandedProviders[cp.id]?._status_field || (cp as any)._status_field || ""}
                          onChange={(e) => updateAdvanced(cp.id, "_status_field", e.target.value)}
                          placeholder="状态字段 (如 status)"
                          style={{ flex: 1, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border-glow)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 12, outline: "none" }}
                        />
                        <input
                          value={expandedProviders[cp.id]?._done_value || (cp as any)._done_value || ""}
                          onChange={(e) => updateAdvanced(cp.id, "_done_value", e.target.value)}
                          placeholder="完成值 (如 succeeded)"
                          style={{ flex: 1, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border-glow)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 12, outline: "none" }}
                        />
                      </div>
                      <input
                        value={expandedProviders[cp.id]?._video_url_field || (cp as any)._video_url_field || ""}
                        onChange={(e) => updateAdvanced(cp.id, "_video_url_field", e.target.value)}
                        placeholder="视频URL路径 (如 resource_list.0.resource_url)"
                        style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border-glow)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 12, outline: "none" }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {customProviders.length === 0 && !showAddForm && (
          <div style={{
            textAlign: "center",
            padding: "24px 16px",
            color: "var(--text-muted)",
            fontSize: 13,
            border: "1px dashed var(--border-glow)",
            borderRadius: 12,
          }}>
            暂无自定义API，点击"+ 添加"来配置你自己的 OpenAI 兼容端点
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsDialog() {
  const { t, i18n } = useTranslation();
  const isOpen = useSettingsDialogStore((s) => s.isOpen);
  const closeSettings = useSettingsDialogStore((s) => s.closeSettings);
  const activeTab = useSettingsDialogStore((s) => s.activeTab);
  const setActiveTab = useSettingsDialogStore((s) => s.setActiveTab);
  const settings = useSettingsStore();
  const authUser = useAuthStore((s) => s.user);
  const authLogout = useAuthStore((s) => s.logout);

  const [showApiKey, setShowApiKey] = useState(false);

  // Sync providers from registry to settings on first load
  useEffect(() => {
    for (const provider of KNOWN_PROVIDERS) {
      const existing = settings.providers.find((p) => p.id === provider.id);
      if (!existing) {
        settings.addProvider({
          id: provider.id,
          name: provider.displayName,
          apiKey: "",
          baseUrl: provider.defaultBaseUrl,
          enabled: provider.enabledByDefault,
        });
      } else if (existing.baseUrl !== provider.defaultBaseUrl && !existing.baseUrl) {
        settings.updateProvider(provider.id, { baseUrl: provider.defaultBaseUrl });
      }
    }
    // Ensure chat-model provider exists
    const chatProvider = settings.providers.find((p) => p.id === "chat-model");
    if (!chatProvider) {
      settings.addProvider({
        id: "chat-model",
        name: "对话模型",
        apiKey: "",
        baseUrl: "https://grsaiapi.com/v1",
        enabled: true,
        channel: "grsai",
        modelName: "grsai/gpt-5.5",
      });
    } else if (!chatProvider.channel || chatProvider.baseUrl === "https://api.openai.com/v1") {
      settings.updateProvider("chat-model", {
        baseUrl: "https://grsaiapi.com/v1",
        channel: "grsai",
        modelName: chatProvider.modelName && !["grsai/gemini-2.5-flash", "gemini-2.5-flash"].includes(chatProvider.modelName)
          ? chatProvider.modelName
          : "grsai/gpt-5.5",
      });
    }
    // Ensure image-model provider exists (migrate channel from openai-compatible if present)
    const imageProvider = settings.providers.find((p) => p.id === "image-model");
    if (!imageProvider) {
      const sd2Provider = settings.providers.find((p) => p.id === "vjimeng" || p.id === "vjimeng-sd2" || p.id === "video-model");
      settings.addProvider({
        id: "image-model",
        name: "图像模型",
        apiKey: sd2Provider?.apiKey || "",
        baseUrl: "https://sd2.xiakeman.com/api",
        enabled: true,
        channel: "artlist",
        modelName: "artlist/nano-banana",
      });
    } else if (
      !imageProvider.channel
      || imageProvider.channel === "openai-compatible"
      || imageProvider.baseUrl === "https://api.openai.com/v1"
      || ["nano-banana-2", "grsai/nano-banana-2", "grsai/gpt-image-2", "gpt-image-2"].includes(imageProvider.modelName || "")
    ) {
      settings.updateProvider("image-model", {
        baseUrl: "https://sd2.xiakeman.com/api",
        channel: "artlist",
        modelName: imageProvider.modelName && !["nano-banana-2", "grsai/nano-banana-2", "grsai/gpt-image-2", "gpt-image-2"].includes(imageProvider.modelName)
          ? imageProvider.modelName
          : "artlist/nano-banana",
      });
    }

    const artlistProvider = settings.providers.find((p) => p.id === "artlist");
    const sd2KeyProvider = settings.providers.find((p) => (p.id === "vjimeng" || p.id === "vjimeng-sd2" || p.id === "video-model") && p.apiKey);
    if (artlistProvider && !artlistProvider.apiKey && sd2KeyProvider?.apiKey) {
      settings.updateProvider("artlist", { apiKey: sd2KeyProvider.apiKey, baseUrl: "https://sd2.xiakeman.com/api" });
    }

    // Migration: if image-model has an apiKey + channel, migrate it to the channel provider
    // This ensures both grsai and geeknow have their own independent API keys
    const imgProvider = settings.providers.find((p) => p.id === "image-model");
    if (imgProvider?.apiKey && imgProvider.channel) {
      const channelProvider = settings.providers.find((p) => p.id === imgProvider.channel);
      if (channelProvider && !channelProvider.apiKey) {
        // Migrate: copy apiKey from image-model to the channel provider
        settings.updateProvider(imgProvider.channel, { apiKey: imgProvider.apiKey });
      }
    }
    // Ensure video-model provider exists (migrate channel from siliconflow if present)
    const videoProvider = settings.providers.find((p) => p.id === "video-model");
    if (!videoProvider) {
      settings.addProvider({
        id: "video-model",
        name: "视频模型",
        apiKey: "",
        baseUrl: "https://sd2.xiakeman.com",
        enabled: true,
        channel: "vjimeng",
        modelName: "transit9-fast",
      });
    } else if (!videoProvider.channel || videoProvider.channel === "siliconflow" || videoProvider.baseUrl === "https://api.siliconflow.cn/v1") {
      settings.updateProvider("video-model", {
        baseUrl: "https://sd2.xiakeman.com",
        channel: "vjimeng",
        modelName: videoProvider.modelName && !["sd2-720p-fast", "transit9-mini"].includes(videoProvider.modelName)
          ? videoProvider.modelName
          : "transit9-fast",
      });
    }
    // Migration: if video-model has an apiKey + channel, migrate it to the channel provider
    // This ensures both geeknow and vjimeng have their own independent API keys
    const vidProvider = settings.providers.find((p) => p.id === "video-model");
    if (vidProvider?.apiKey && vidProvider.channel) {
      const channelProvider = settings.providers.find((p) => p.id === vidProvider.channel);
      if (channelProvider && !channelProvider.apiKey) {
        settings.updateProvider(vidProvider.channel, { apiKey: vidProvider.apiKey });
      }
    }

    // Migration: if chat-model has an apiKey + channel, migrate it to the channel provider
    // This ensures grsai and vjimeng each have their own independent API keys
    const chatMigrateProvider = settings.providers.find((p) => p.id === "chat-model");
    if (chatMigrateProvider?.apiKey && chatMigrateProvider.channel) {
      const chTargetProvider = settings.providers.find((p) => p.id === chatMigrateProvider.channel);
      if (chTargetProvider && !chTargetProvider.apiKey) {
        settings.updateProvider(chatMigrateProvider.channel, { apiKey: chatMigrateProvider.apiKey });
      }
    }

    // Ensure audio-model provider exists
    const audioProvider = settings.providers.find((p) => p.id === "audio-model");
    if (!audioProvider) {
      const grsaiP = settings.providers.find((p) => p.id === "grsai");
      settings.addProvider({
        id: "audio-model",
        name: "音频模型",
        apiKey: grsaiP?.apiKey || "",
        baseUrl: grsaiP?.baseUrl || "https://grsaiapi.com/v1",
        enabled: true,
        channel: "grsai",
      });
    } else if (!audioProvider.channel) {
      settings.updateProvider("audio-model", { channel: "grsai", baseUrl: audioProvider.baseUrl || "https://grsaiapi.com/v1" });
    }
  }, []);

  // Sync all provider API keys and base URLs to Tauri backend
  const syncProvidersToBackend = useCallback(async () => {
    if (!window.__TAURI__) return;

    // Default URLs that should NOT be synced to Rust providers.
    // Virtual providers (image-model, video-model, etc.) often have these defaults
    // which would WRONGFULLY override the Rust provider's built-in URL.
    const DEFAULT_URLS = [
      "https://api.openai.com/v1",
      "https://api.siliconflow.cn/v1",
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "https://open.bigmodel.cn/api/paas/v1",
      "",
    ];

    const promises: Promise<unknown>[] = [];
    for (const provider of settings.providers) {
      // Skip providers without configuration
      if (!provider.apiKey && !provider.baseUrl) continue;

      const isDefaultUrl = !provider.baseUrl || DEFAULT_URLS.includes(provider.baseUrl);

      // Sync to the provider's own ID first (e.g., "openai-compatible")
      // This ensures the key is available when the backend resolves by provider_id
      if (provider.apiKey) {
        promises.push(setApiKey(provider.id, provider.apiKey).catch((e) => {
          console.error("[Settings] Failed to sync API key for", provider.id, ":", e);
        }));
      }
      if (provider.baseUrl && !isDefaultUrl) {
        promises.push(setBaseUrl(provider.id, provider.baseUrl).catch(console.error));
      }

      // If channel is set and different from id, also sync to channel
      // (e.g., sync grsai key to "grsai" backend provider as well)
      if (provider.channel && provider.channel !== provider.id) {
        if (provider.apiKey) {
          promises.push(setApiKey(provider.channel, provider.apiKey).catch((e) => {
            console.error("[Settings] Failed to sync API key for channel", provider.channel, ":", e);
          }));
        }
        if (provider.baseUrl && !isDefaultUrl) {
          promises.push(setBaseUrl(provider.channel, provider.baseUrl).catch(console.error));
        }
      }
    }
    await Promise.allSettled(promises);

    // Also sync custom providers
    for (const cp of settings.customProviders) {
      if (cp.apiKey) {
        try {
          await setApiKey(cp.id, cp.apiKey);
        } catch (e) {
          console.error("[Settings] Failed to sync custom provider key for", cp.id, ":", e);
        }
      }
    }
  }, [settings.providers, settings.customProviders]);

  const handleClose = useCallback(async () => {
    await syncProvidersToBackend();
    closeSettings();
  }, [syncProvidersToBackend, closeSettings]);

  // Helper: update provider key in zustand AND immediately sync to Rust backend
  // This prevents the "key configured but not found on generation" bug
  const updateProviderKeyAndSync = useCallback((providerId: string, newKey: string) => {
    settings.updateProvider(providerId, { apiKey: newKey });
    if (window.__TAURI__ && newKey) {
      setApiKey(providerId, newKey).catch((e) => {
        console.error("[Settings] Failed to sync API key to backend for", providerId, ":", e);
      });
    }
  }, [settings]);

  const syncProviderKeyOnBlur = useCallback((providerId: string) => {
    const currentKey = settings.providers.find((p) => p.id === providerId)?.apiKey;
    if (window.__TAURI__ && currentKey) {
      setApiKey(providerId, currentKey).catch((e) => {
        console.error("[Settings] Failed to sync API key on blur for", providerId, ":", e);
      });
    }
  }, [settings.providers]);

  const updateProviderBaseUrlAndSync = useCallback((providerId: string, baseUrl: string) => {
    settings.updateProvider(providerId, { baseUrl });
    if (window.__TAURI__ && baseUrl.trim()) {
      setBaseUrl(providerId, baseUrl.trim()).catch((e) => {
        console.error("[Settings] Failed to sync Base URL to backend for", providerId, ":", e);
      });
    }
  }, [settings]);

  const syncProviderBaseUrlOnBlur = useCallback((providerId: string) => {
    const currentBaseUrl = settings.providers.find((p) => p.id === providerId)?.baseUrl;
    if (window.__TAURI__ && currentBaseUrl) {
      setBaseUrl(providerId, currentBaseUrl).catch((e) => {
        console.error("[Settings] Failed to sync Base URL on blur for", providerId, ":", e);
      });
    }
  }, [settings.providers]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--glass-bg)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        style={{
          width: 720,
          height: 560,
          background: "var(--bg-surface)",
          borderRadius: 16,
          display: "flex",
          overflow: "hidden",
          boxShadow: "var(--shadow-float)",
          border: "1px solid var(--border-glow)",
        }}
      >
        {/* Left sidebar */}
        <div
          style={{
            width: 220,
            background: "var(--bg-secondary)",
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            padding: "16px 12px",
            position: "relative",
          }}
        >
          {/* Top accent line */}
          <div style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "3px",
            background: "linear-gradient(90deg, var(--accent), var(--accent-secondary))",
            borderRadius: "16px 0 0 0",
            opacity: 0.5,
          }} />
          {/* Header */}
          <div style={{ padding: "0 8px 16px", borderBottom: "1px solid var(--border)", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "var(--accent-dim)",
                border: "1px solid var(--accent-muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
              }}>
                ⚙️
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>画布模型设置</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>使用虾客漫内置模型</div>
              </div>
            </div>
          </div>

          {/* Tab list */}
          <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "none",
                    background: isActive ? "var(--accent-dim)" : "transparent",
                    color: isActive ? "var(--accent-light)" : "var(--text-secondary)",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.2s",
                    width: "100%",
                  }}
                >
                  <div style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    background: isActive ? "var(--accent-muted)" : "var(--bg-hover)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                  }}>
                    {TAB_ICONS[tab.id] || tab.id.charAt(0)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13,
                      fontWeight: isActive ? 600 : 400,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}>
                      {tab.label}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Version */}
          <div style={{ padding: "12px 8px 0", borderTop: "1px solid var(--border)", marginTop: 12 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>虾客漫画布</div>
          </div>
        </div>

        {/* Right content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
          {/* Content area */}
          <div style={{ flex: 1, overflow: "auto", padding: "24px 28px" }}>
            {/* Close button */}
            <button
              onClick={handleClose}
              style={{
                position: "absolute",
                top: 20,
                right: 20,
                width: 32,
                height: 32,
                borderRadius: 8,
                border: "none",
                background: "var(--bg-hover)",
                color: "var(--text-secondary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
              }}
            >
              ✕
            </button>

            {activeTab === "models" && (
              <BuiltInModelsOverview />
            )}

            {activeTab === "tutorial" && (
              <CanvasUsageGuide />
            )}

            {/* Image tab — independent channel cards with own API keys */}
            {activeTab === "image" && (() => {
              // In paid build, grsai is credits-powered — no user API key needed
              const imageChannels = CHANNEL_OPTIONS.image || [];
              return (
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
                    图像模型
                  </h2>
                  {settings.creditsEnabled ? (
                    <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 24 }}>
                      AI 图片服务已内置 · 使用余额付费 · 也可添加自定义 API
                    </p>
                  ) : (
                    <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 24 }}>
                      每个通道独立配置，互不影响。填写密钥即可使用 AI 图片服务
                    </p>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {imageChannels.map((ch) => {
                      // Find the provider for this channel (e.g. "grsai" or "geeknow")
                      const chProvider = settings.providers.find((p) => p.id === ch.id);
                      const chApiKey = chProvider?.apiKey || "";
                      const chBaseUrl = chProvider?.baseUrl || ch.baseUrl;
                      const hasKey = (settings.creditsEnabled && (ch.id === "grsai" || ch.id === "artlist")) || !!chApiKey;
                      const links = CHANNEL_LINKS[ch.id];
                      return (
                        <div
                          key={ch.id}
                          style={{
                            border: "1px solid var(--border-glow)",
                            borderRadius: 12,
                            padding: 16,
                            background: "var(--accent-dim)",
                          }}
                        >
                          {/* Channel header */}
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                            <div style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: hasKey ? "var(--success)" : "var(--error)",
                              flexShrink: 0,
                            }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 600, color: hasKey ? "var(--accent-light)" : "var(--text-primary)" }}>
                                {ch.label}
                              </div>
                              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>
                                {ch.desc}
                              </div>
                            </div>
                            <span style={{ fontSize: 11, color: hasKey ? "var(--success)" : "var(--error)", flexShrink: 0 }}>
                              {hasKey ? "已配置" : "未配置"}
                            </span>
                          </div>

                          {/* API Key input */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ position: "relative" }}>
                              <input
                                type={showApiKey ? "text" : "password"}
                                value={chApiKey}
                                onChange={(e) => updateProviderKeyAndSync(ch.id, e.target.value)}
                                onBlur={() => syncProviderKeyOnBlur(ch.id)}
                                placeholder={`输入 ${ch.label} API 密钥...`}
                                style={{
                                  width: "100%",
                                  padding: "10px 40px 10px 14px",
                                  borderRadius: 10,
                                  border: "1px solid var(--border-glow)",
                                  background: "var(--bg-secondary)",
                                  color: "var(--text-primary)",
                                  fontSize: 13,
                                  outline: "none",
                                  fontFamily: "monospace",
                                }}
                              />
                              <button
                                onClick={() => setShowApiKey(!showApiKey)}
                                style={{
                                  position: "absolute",
                                  right: 10,
                                  top: "50%",
                                  transform: "translateY(-50%)",
                                  background: "none",
                                  border: "none",
                                  color: "var(--text-muted)",
                                  cursor: "pointer",
                                  padding: 4,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                                title={showApiKey ? "隐藏密钥" : "显示密钥"}
                              >
                                {showApiKey ? (
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                                    <line x1="1" y1="1" x2="23" y2="23"/>
                                  </svg>
                                ) : (
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                    <circle cx="12" cy="12" r="3"/>
                                  </svg>
                                )}
                              </button>
                            </div>
                            <input
                              type="text"
                              value={chBaseUrl}
                              onChange={(e) => updateProviderBaseUrlAndSync(ch.id, e.target.value)}
                              onBlur={() => syncProviderBaseUrlOnBlur(ch.id)}
                              placeholder="Base URL"
                              style={{
                                width: "100%",
                                padding: "9px 12px",
                                borderRadius: 10,
                                border: "1px solid var(--border-glow)",
                                background: "var(--bg-secondary)",
                                color: "var(--text-primary)",
                                fontSize: 12,
                                outline: "none",
                                fontFamily: "monospace",
                              }}
                            />
                          </div>

                          {/* Quick links */}
                          {links && (
                            <div style={{
                              display: "flex",
                              gap: 12,
                              alignItems: "center",
                              padding: "8px 0 0",
                              marginTop: 8,
                            }}>
                              <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>链接:</span>
                              <a href={links.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent-light)", textDecoration: "none" }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
                              >官网</a>
                              <a href={links.apiPlatform} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent-light)", textDecoration: "none" }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
                              >API平台</a>
                              <a href={links.docs} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent-light)", textDecoration: "none" }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
                              >文档</a>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Video tab — independent channel cards with own API keys (same pattern as image) */}
            {activeTab === "video" && (() => {
              // In paid build, vjimeng (SD2.0) is credits-powered — no user API key needed
              const videoChannels = CHANNEL_OPTIONS.video;
              return (
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
                    视频模型
                  </h2>
                  {settings.creditsEnabled ? (
                    <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 24 }}>
                      AI 视频服务已内置 · 使用余额付费 · 也可添加自定义 API
                    </p>
                  ) : (
                    <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 24 }}>
                      每个通道独立配置，互不影响。填写密钥即可使用 AI 视频服务
                    </p>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {videoChannels.map((ch) => {
                      const chProvider = settings.providers.find((p) => p.id === ch.id);
                      const chApiKey = chProvider?.apiKey || "";
                      const chBaseUrl = chProvider?.baseUrl || ch.baseUrl;
                      const hasKey = (settings.creditsEnabled && (ch.id === "vjimeng" || ch.id === "vjimeng-sd2")) || !!chApiKey;
                      const isJimengOfficial = ch.id === "jimeng-official";
                      const links = CHANNEL_LINKS[ch.id];
                      return (
                        <div
                          key={ch.id}
                          style={{
                            border: "1px solid var(--border-glow)",
                            borderRadius: 12,
                            padding: 16,
                            background: "var(--accent-dim)",
                          }}
                        >
                          {/* Channel header */}
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                            <div style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: hasKey ? "var(--success)" : "var(--error)",
                              flexShrink: 0,
                            }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 600, color: hasKey ? "var(--accent-light)" : "var(--text-primary)" }}>
                                {ch.label}
                              </div>
                              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>
                                {ch.desc}
                              </div>
                            </div>
                            <span style={{ fontSize: 11, color: hasKey ? "var(--success)" : "var(--error)", flexShrink: 0 }}>
                              {hasKey ? "已配置" : "未配置"}
                            </span>
                          </div>

                          {/* API Key input or special login for jimeng-official */}
                          {isJimengOfficial ? (
                            <JimengOfficialLogin />
                          ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ position: "relative" }}>
                              <input
                                type={showApiKey ? "text" : "password"}
                                value={chApiKey}
                                onChange={(e) => updateProviderKeyAndSync(ch.id, e.target.value)}
                                onBlur={() => syncProviderKeyOnBlur(ch.id)}
                                placeholder={`输入 ${ch.label} API 密钥...`}
                                style={{
                                  width: "100%",
                                  padding: "10px 40px 10px 14px",
                                  borderRadius: 10,
                                  border: "1px solid var(--border-glow)",
                                  background: "var(--bg-secondary)",
                                  color: "var(--text-primary)",
                                  fontSize: 13,
                                  outline: "none",
                                  fontFamily: "monospace",
                                }}
                              />
                              <button
                                onClick={() => setShowApiKey(!showApiKey)}
                                style={{
                                  position: "absolute",
                                  right: 10,
                                  top: "50%",
                                  transform: "translateY(-50%)",
                                  background: "none",
                                  border: "none",
                                  color: "var(--text-muted)",
                                  cursor: "pointer",
                                  padding: 4,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                                title={showApiKey ? "隐藏密钥" : "显示密钥"}
                              >
                                {showApiKey ? (
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                                    <line x1="1" y1="1" x2="23" y2="23"/>
                                  </svg>
                                ) : (
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                    <circle cx="12" cy="12" r="3"/>
                                  </svg>
                                )}
                              </button>
                            </div>
                            <input
                              type="text"
                              value={chBaseUrl}
                              onChange={(e) => updateProviderBaseUrlAndSync(ch.id, e.target.value)}
                              onBlur={() => syncProviderBaseUrlOnBlur(ch.id)}
                              placeholder="Base URL"
                              style={{
                                width: "100%",
                                padding: "9px 12px",
                                borderRadius: 10,
                                border: "1px solid var(--border-glow)",
                                background: "var(--bg-secondary)",
                                color: "var(--text-primary)",
                                fontSize: 12,
                                outline: "none",
                                fontFamily: "monospace",
                              }}
                            />
                          </div>
                          )}

                          {/* Quick links */}
                          {links && (
                            <div style={{
                              display: "flex",
                              gap: 12,
                              alignItems: "center",
                              padding: "8px 0 0",
                              marginTop: 8,
                            }}>
                              <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>链接:</span>
                              <a href={links.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent-light)", textDecoration: "none" }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
                              >官网</a>
                              <a href={links.apiPlatform} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent-light)", textDecoration: "none" }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
                              >API平台</a>
                              <a href={links.docs} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent-light)", textDecoration: "none" }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
                              >文档</a>
                            </div>
                          )}
                        </div>
                      );
                    })}

                  </div>
                </div>
              );
            })()}

            {/* Chat tab — independent channel cards with own API keys (same pattern as image/video) */}
            {activeTab === "chat" && (() => {
              // In paid build, grsai is credits-powered — no user API key needed
              const chatChannels = CHANNEL_OPTIONS.chat || [];
              return (
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
                    对话模型
                  </h2>
                  {settings.creditsEnabled ? (
                    <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 24 }}>
                      AI 对话服务已内置 · 使用余额付费 · 也可添加自定义 API
                    </p>
                  ) : (
                    <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 24 }}>
                      每个通道独立配置，互不影响。填写密钥即可使用 AI 对话服务
                    </p>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {chatChannels.map((ch) => {
                      const chProvider = settings.providers.find((p) => p.id === ch.id);
                      const chApiKey = chProvider?.apiKey || "";
                      const chBaseUrl = chProvider?.baseUrl || ch.baseUrl;
                      const hasKey = (settings.creditsEnabled && ch.id === "grsai") || !!chApiKey;
                      const links = CHANNEL_LINKS[ch.id];
                      return (
                        <div
                          key={ch.id}
                          style={{
                            border: "1px solid var(--border-glow)",
                            borderRadius: 12,
                            padding: 16,
                            background: "var(--accent-dim)",
                          }}
                        >
                          {/* Channel header */}
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                            <div style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: hasKey ? "var(--success)" : "var(--error)",
                              flexShrink: 0,
                            }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 600, color: hasKey ? "var(--accent-light)" : "var(--text-primary)" }}>
                                {ch.label}
                              </div>
                              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>
                                {ch.desc}
                              </div>
                            </div>
                            <span style={{ fontSize: 11, color: hasKey ? "var(--success)" : "var(--error)", flexShrink: 0 }}>
                              {hasKey ? "已配置" : "未配置"}
                            </span>
                          </div>

                          {/* API Key input */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ position: "relative" }}>
                              <input
                                type={showApiKey ? "text" : "password"}
                                value={chApiKey}
                                onChange={(e) => updateProviderKeyAndSync(ch.id, e.target.value)}
                                onBlur={() => syncProviderKeyOnBlur(ch.id)}
                                placeholder={`输入 ${ch.label} API 密钥...`}
                                style={{
                                  width: "100%",
                                  padding: "10px 40px 10px 14px",
                                  borderRadius: 10,
                                  border: "1px solid var(--border-glow)",
                                  background: "var(--bg-secondary)",
                                  color: "var(--text-primary)",
                                  fontSize: 13,
                                  outline: "none",
                                  fontFamily: "monospace",
                                }}
                              />
                              <button
                                onClick={() => setShowApiKey(!showApiKey)}
                                style={{
                                  position: "absolute",
                                  right: 10,
                                  top: "50%",
                                  transform: "translateY(-50%)",
                                  background: "none",
                                  border: "none",
                                  color: "var(--text-muted)",
                                  cursor: "pointer",
                                  padding: 4,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                                title={showApiKey ? "隐藏密钥" : "显示密钥"}
                              >
                                {showApiKey ? (
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                                    <line x1="1" y1="1" x2="23" y2="23"/>
                                  </svg>
                                ) : (
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                    <circle cx="12" cy="12" r="3"/>
                                  </svg>
                                )}
                              </button>
                            </div>
                            <input
                              type="text"
                              value={chBaseUrl}
                              onChange={(e) => updateProviderBaseUrlAndSync(ch.id, e.target.value)}
                              onBlur={() => syncProviderBaseUrlOnBlur(ch.id)}
                              placeholder="Base URL"
                              style={{
                                width: "100%",
                                padding: "9px 12px",
                                borderRadius: 10,
                                border: "1px solid var(--border-glow)",
                                background: "var(--bg-secondary)",
                                color: "var(--text-primary)",
                                fontSize: 12,
                                outline: "none",
                                fontFamily: "monospace",
                              }}
                            />
                          </div>

                          {/* Quick links */}
                          {links && (
                            <div style={{
                              display: "flex",
                              gap: 12,
                              alignItems: "center",
                              padding: "8px 0 0",
                              marginTop: 8,
                            }}>
                              <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>链接:</span>
                              <a href={links.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent-light)", textDecoration: "none" }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
                              >官网</a>
                              <a href={links.apiPlatform} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent-light)", textDecoration: "none" }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
                              >API平台</a>
                              <a href={links.docs} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent-light)", textDecoration: "none" }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
                              >文档</a>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Audio tab — single "audio-model" provider config */}
            {activeTab === "audio" && (() => {
              const audioProvider = settings.providers.find((p) => p.id === "audio-model");
              const key = audioProvider?.apiKey || "";
              const baseUrl = audioProvider?.baseUrl || "https://grsaiapi.com/v1";
              const isActive = !!key;
              return (
                <div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.6 }}>
                    配置 TTS（文字转语音）API 端点。使用 OpenAI 兼容的 <code style={{ background: "var(--bg-surface-alt)", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>POST /v1/audio/speech</code> 接口。
                    <br />支持的模型：Minimax-speech、OpenAI TTS-1、TTS-1-HD 等。
                  </div>
                  <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, background: isActive ? "rgba(122,180,240,0.06)" : "var(--bg-surface)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>TTS 音频 API</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>OpenAI 兼容 /v1/audio/speech</div>
                      </div>
                      <span style={{
                        display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 10, fontSize: 11,
                        background: isActive ? "rgba(34,197,94,0.15)" : "rgba(148,163,184,0.1)", color: isActive ? "#22c55e" : "var(--text-muted)",
                      }}>{isActive ? "已配置" : "未配置"}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <input placeholder="API Key" value={key} onChange={(e) => {
                        const existing = settings.providers.find((p) => p.id === "audio-model");
                        if (existing) settings.updateProvider("audio-model", { apiKey: e.target.value });
                        else settings.addProvider({ id: "audio-model", name: "音频模型", apiKey: e.target.value, baseUrl: "https://grsaiapi.com/v1", enabled: true });
                      }} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-surface-alt)", color: "var(--text-primary)", fontSize: 12, fontFamily: "monospace", width: "100%", boxSizing: "border-box" }} />
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>Base URL</span>
                        <input value={baseUrl} onChange={(e) => {
                          const existing = settings.providers.find((p) => p.id === "audio-model");
                          if (existing) settings.updateProvider("audio-model", { baseUrl: e.target.value });
                          else settings.addProvider({ id: "audio-model", name: "音频模型", apiKey: "", baseUrl: e.target.value, enabled: true });
                        }} style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-surface-alt)", color: "var(--text-primary)", fontSize: 11, fontFamily: "monospace", boxSizing: "border-box" }} />
                      </div>
                    </div>
                  </div>

                </div>
              );
            })()}

            {/* Tutorial tab — global API configuration guide */}
            {activeTab === "legacy-tutorial" && (
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
                  API 配置教程
                </h2>
                <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 16 }}>
                  本教程帮助你了解如何为各类 AI 功能配置 API 通道和密钥，使画布节点能正常调用 AI 服务。
                </p>

                {/* — 1. 基础概念 — */}
                <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", marginBottom: 14, background: "var(--bg-surface)" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
                    1. 基础概念
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.8, color: "var(--text-secondary)" }}>
                    <div style={{ marginBottom: 6 }}>
                      <b style={{ color: "var(--text-primary)" }}>通道 (Channel)</b> — 每个 AI 功能类型有一个或多个通道，例如图像模型下的「虾客漫图像」、视频模型下的「虾客漫 SD2」「即梦官网」「可灵 Kling」等。每个通道需要填写对应的 <b>API Key</b> 才能使用。
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <b style={{ color: "var(--text-primary)" }}>自定义通道 (Custom Provider)</b> — 如果内置通道不满足需求，你可以在各模型 tab 的「自定义通道」区域添加任意兼容的 API 端点。
                    </div>
                    <div>
                      <b style={{ color: "var(--text-primary)" }}>Base URL</b> — API 的根地址，如 <code style={{ background: "var(--bg-surface-alt)", padding: "1px 4px", borderRadius: 3 }}>https://grsaiapi.com/v1</code>。程序会根据 Base URL 自动判断 API 格式（OpenAI / 火山方舟等）。
                    </div>
                  </div>
                </div>

                {/* — 2. 各类型配置方法 — */}
                <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", marginBottom: 14, background: "var(--bg-surface)" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
                    2. 各类型配置方法
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.8, color: "var(--text-secondary)" }}>
                    {/* 图像 */}
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontWeight: 600, color: "var(--accent)", marginBottom: 4 }}>🖼️ 图像模型</div>
                      <div>• 切换到「图像模型」tab → 选择通道（如虾客漫图像）→ 填写 API Key → 保存</div>
                      <div>• 支持的自定义通道：任何兼容 <code style={{ background: "var(--bg-surface-alt)", padding: "1px 4px", borderRadius: 3 }}>POST /v1/images/generations</code> 的 OpenAI 格式端点</div>
                      <div>• 画布图像节点 → 右侧面板底部「通道」下拉选择你配置的通道 → 选择模型 → 输入提示词 → 生成</div>
                    </div>
                    {/* 对话 */}
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontWeight: 600, color: "var(--accent)", marginBottom: 4 }}>💬 对话模型</div>
                      <div>• 切换到「对话模型」tab → 选择通道 → 填写 API Key → 保存</div>
                      <div>• 支持的自定义通道：任何兼容 <code style={{ background: "var(--bg-surface-alt)", padding: "1px 4px", borderRadius: 3 }}>POST /v1/chat/completions</code> 的 OpenAI 格式端点</div>
                      <div>• 画布对话节点 → 底部「通道」下拉 → 选择模型 → 输入提示词 → 生成</div>
                    </div>
                    {/* 视频 */}
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontWeight: 600, color: "var(--accent)", marginBottom: 4 }}>🎬 视频模型</div>
                      <div>• 切换到「视频模型」tab → 选择通道（虾客漫视频 / 虾客漫 SD2 / 即梦官网 / 可灵 / Luma / Runway / MiniMax海螺）→ 填写 API Key</div>
                      <div>• 自定义通道支持 <b>OpenAI 格式</b> 和 <b>火山方舟格式</b>，程序根据 Base URL 自动判断</div>
                      <div>• 画布视频节点 → 底部「通道」下拉 → 选择模型 → 输入提示词 → 生成</div>
                    </div>
                    {/* 音频 */}
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--accent)", marginBottom: 4 }}>🔊 音频模型</div>
                      <div>• 切换到「音频模型」tab → 填写 API Key 和 Base URL → 保存</div>
                      <div>• 支持的自定义通道：任何兼容 <code style={{ background: "var(--bg-surface-alt)", padding: "1px 4px", borderRadius: 3 }}>POST /v1/audio/speech</code> 的 OpenAI TTS 端点</div>
                      <div>• 画布音频节点 → 底部「通道」下拉 → 输入模型名 → 输入文本 → 生成</div>
                      <div style={{ color: "var(--accent)", fontWeight: 500 }}>💡 音频节点的模型名支持直接输入，不限预设值</div>
                    </div>
                  </div>
                </div>

                {/* — 3. 自定义通道配置 — */}
                <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", marginBottom: 14, background: "var(--bg-surface)" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
                    3. 自定义通道配置
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.8, color: "var(--text-secondary)" }}>
                    <div style={{ marginBottom: 8 }}>
                      在每个模型 tab 的下方都有「自定义通道」区域，你可以添加任意 API 端点：
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <b style={{ color: "var(--text-primary)" }}>配置步骤：</b>
                    </div>
                    <div style={{ marginLeft: 12, marginBottom: 8 }}>
                      <div>1. 点击「添加自定义通道」按钮</div>
                      <div>2. 填写 <b>名称</b>（如「云智」）、<b>Base URL</b>（如 <code style={{ background: "var(--bg-surface-alt)", padding: "1px 4px", borderRadius: 3 }}>https://api.aiyunzhi.top</code>）</div>
                      <div>3. 填写 <b>API Key</b></div>
                      <div>4. 保存后，对应节点中会自动出现该通道选项</div>
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <b style={{ color: "var(--text-primary)" }}>API 格式自动识别：</b>
                    </div>
                    <div style={{ marginLeft: 12 }}>
                      <div>• URL 包含 <code style={{ background: "var(--bg-surface-alt)", padding: "1px 4px", borderRadius: 3 }}>/v1</code> 或无前缀 → 使用 OpenAI 格式</div>
                      <div>• URL 包含 <code style={{ background: "var(--bg-surface-alt)", padding: "1px 4px", borderRadius: 3 }}>/api/v3</code> → 使用火山方舟格式</div>
                      <div>• URL 包含 <code style={{ background: "var(--bg-surface-alt)", padding: "1px 4px", borderRadius: 3 }}>/v2</code> → 使用 OpenAI v2 格式</div>
                    </div>
                  </div>
                </div>

                {/* — 5. 常见问题 — */}
                <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", marginBottom: 14, background: "var(--bg-surface)" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
                    5. 常见问题
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.8, color: "var(--text-secondary)" }}>
                    <div style={{ marginBottom: 10 }}>
                      <b style={{ color: "var(--text-primary)" }}>Q: 为什么通道下拉里没有我刚添加的自定义通道？</b>
                    </div>
                    <div style={{ marginLeft: 12, marginBottom: 10 }}>A: 确保自定义通道的 API Key 已填写并保存。没有 Key 的通道不会出现在节点下拉中。</div>

                    <div style={{ marginBottom: 10 }}>
                      <b style={{ color: "var(--text-primary)" }}>Q: 自定义通道填什么 Base URL？</b>
                    </div>
                    <div style={{ marginLeft: 12, marginBottom: 10 }}>A: 一般填到版本前缀为止，如 <code style={{ background: "var(--bg-surface-alt)", padding: "1px 4px", borderRadius: 3 }}>https://api.example.com/v1</code>。程序会自动拼接具体的子路径。火山方舟格式填到 <code style={{ background: "var(--bg-surface-alt)", padding: "1px 4px", borderRadius: 3 }}>/api/v3</code>。</div>

                    <div style={{ marginBottom: 10 }}>
                      <b style={{ color: "var(--text-primary)" }}>Q: 付费版用户还需要配置 API Key 吗？</b>
                    </div>
                    <div style={{ marginLeft: 12, marginBottom: 10 }}>A: 虾客漫内置通道可使用平台额度，无需单独配 Key。如需使用其他提供商（如可灵、Luma），仍需配置各自的 Key。</div>

                    <div style={{ marginBottom: 10 }}>
                      <b style={{ color: "var(--text-primary)" }}>Q: 音频模型的模型名怎么填？</b>
                    </div>
                    <div style={{ marginLeft: 12 }}>A: 音频节点支持直接输入任意模型名（如 <code style={{ background: "var(--bg-surface-alt)", padding: "1px 4px", borderRadius: 3 }}>tts-1</code>、<code style={{ background: "var(--bg-surface-alt)", padding: "1px 4px", borderRadius: 3 }}>minimax-speech-2.0</code> 等），只要你的 API 端点支持该模型即可。</div>
                  </div>
                </div>
              </div>
            )}

            {/* Save path */}
            {activeTab === "savePath" && (
              <SavePathSettings />
            )}

            {/* Online update */}
            {activeTab === "update" && (
              <UpdateSettings />
            )}

            {activeTab === "image" && (
              <CustomProvidersSection nodeType="image" />
            )}

            {activeTab === "chat" && (
              <CustomProvidersSection nodeType="chat" />
            )}

            {activeTab === "video" && (
              <CustomProvidersSection nodeType="video" />
            )}

            {activeTab === "audio" && (
              <CustomProvidersSection nodeType="audio" />
            )}

            {/* General */}
            {activeTab === "general" && (
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>
                  {t("settings.general")}
                </h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  {/* Account info & logout — most visible place */}
                  <div style={{
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: 16,
                    background: "var(--bg-secondary)",
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginBottom: 10 }}>
                      账号信息
                    </div>
                    {authUser?.email ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7ab4f0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                            <circle cx="12" cy="7" r="4"/>
                          </svg>
                          <span style={{ fontSize: 13, color: "#7ab4f0" }}>{authUser.email}</span>
                        </div>
                        <button
                          onClick={async () => {
                            await authLogout();
                          }}
                          style={{
                            fontSize: 12,
                            color: "var(--text-secondary)",
                            background: "transparent",
                            border: "1px solid rgba(224, 82, 82, 0.4)",
                            borderRadius: 8,
                            padding: "6px 16px",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(224, 82, 82, 0.1)"; e.currentTarget.style.color = "var(--error)"; e.currentTarget.style.borderColor = "var(--error)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.borderColor = "rgba(224, 82, 82, 0.4)"; }}
                        >
                          退出登录
                        </button>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        未登录 — 余额不会跨设备同步
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginBottom: 8 }}>
                      {t("settings.language")}
                    </div>
                    <select
                      value={settings.language}
                      onChange={(e) => {
                        settings.setLanguage(e.target.value);
                        i18n.changeLanguage(e.target.value);
                        localStorage.setItem("language", e.target.value);
                      }}
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: "1px solid var(--border)",
                        background: "var(--bg-secondary)",
                        color: "var(--text-primary)",
                        fontSize: 13,
                        outline: "none",
                      }}
                    >
                      <option value="zh">简体中文</option>
                      <option value="zh-Hant">繁體中文</option>
                      <option value="en">English</option>
                      <option value="ja">日本語</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{t("settings.autoSave")}</span>
                    <ToggleSwitch checked={settings.autoSave} onChange={(v) => settings.setAutoSave(v)} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{t("settings.autoInferEmptyFrame")}</span>
                    <ToggleSwitch checked={settings.storyboardGenAutoInferEmptyFrame} onChange={(v) => settings.setStoryboardGenAutoInferEmptyFrame(v)} />
                  </div>
                </div>
              </div>
            )}

            {/* Appearance */}
            {activeTab === "appearance" && (
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>
                  {t("settings.appearance")}
                </h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginBottom: 8 }}>
                      {t("settings.theme")}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {(["light", "dark", "system"] as const).map((themeVal) => (
                        <button
                          key={themeVal}
                          onClick={() => settings.setTheme(themeVal)}
                          style={{
                            padding: "8px 16px",
                            borderRadius: 8,
                            border: settings.theme === themeVal ? "1px solid var(--accent)" : "1px solid var(--border)",
                            background: settings.theme === themeVal ? "var(--accent-dim)" : "var(--bg-secondary)",
                            color: settings.theme === themeVal ? "var(--accent-light)" : "var(--text-secondary)",
                            fontSize: 13,
                            cursor: "pointer",
                          }}
                        >
                          {themeVal === "light" ? `☀️ ${t("settings.light")}` : themeVal === "dark" ? `🌙 ${t("settings.dark")}` : `💻 ${t("settings.system")}`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{t("settings.showGrid")}</span>
                    <ToggleSwitch checked={settings.showGrid} onChange={(v) => settings.setShowGrid(v)} />
                  </div>
                </div>
              </div>
            )}

          </div>

          {/* Bottom bar */}
          <div style={{
            padding: "12px 24px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>虾客漫画布工作台</div>
            <button
              onClick={handleClose}
              style={{
                padding: "8px 28px",
                borderRadius: 8,
                border: "none",
                background: "var(--accent-btn)",
                color: "var(--text-primary)",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Toggle Switch Component ---
function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        border: "none",
        background: checked ? "var(--accent)" : "var(--bg-secondary)",
        cursor: "pointer",
        position: "relative",
        transition: "background 0.2s",
        padding: 0,
      }}
    >
      <div style={{
        width: 20,
        height: 20,
        borderRadius: "50%",
        background: "#fff",
        position: "absolute",
        top: 2,
        left: checked ? 22 : 2,
        transition: "left 0.2s",
        boxShadow: "var(--shadow-card)",
      }} />
    </button>
  );
}


// ---------------------------------------------------------------------------
// SavePathSettings
// ---------------------------------------------------------------------------

function SavePathSettings() {
  const settings = useSettingsStore();
  const [defaultPath, setDefaultPath] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  // P1: Path validation state — "valid" | "invalid" | "checking" | "idle"
  const [pathStatus, setPathStatus] = useState<"valid" | "invalid" | "checking" | "idle">("idle");
  const [pathError, setPathError] = useState<string>("");
  // P2: Reset feedback
  const [showResetToast, setShowResetToast] = useState(false);

  // Get the desktop dir as default path
  useEffect(() => {
    invoke<string>("get_default_save_dir")
      .then((dir) => setDefaultPath(dir))
      .catch(console.error);
  }, []);

  const currentPath = settings.projectSavePath || defaultPath;

  // P1 + P7: Validate path whenever it changes
  useEffect(() => {
    if (!settings.projectSavePath) {
      // Using default path — no need to validate
      setPathStatus("idle");
      setPathError("");
      return;
    }
    let cancelled = false;
    setPathStatus("checking");
    setPathError("");
    invoke<string>("validate_save_dir", { path: settings.projectSavePath })
      .then(() => {
        if (!cancelled) {
          setPathStatus("valid");
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setPathStatus("invalid");
          setPathError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => { cancelled = true; };
  }, [settings.projectSavePath]);

  const handleSelectFolder = async () => {
    try {
      setIsLoading(true);
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择项目保存路径",
      });
      if (typeof selected === "string") {
        settings.setProjectSavePath(selected);
        // P8: Explicitly await settings.json write to disk so Rust backend
        // can read the new path immediately (Zustand persist is fire-and-forget)
        try {
          const json = localStorage.getItem("storyboard-copilot-settings") || "";
          await invoke("save_settings_json", { json });
        } catch { /* best effort */ }
      }
    } catch (e) {
      console.error("Failed to select folder:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = async () => {
    settings.setProjectSavePath(null);
    // P8: Ensure disk is updated before Rust reads
    try {
      const json = localStorage.getItem("storyboard-copilot-settings") || "";
      await invoke("save_settings_json", { json });
    } catch { /* best effort */ }
    // P2: Show brief feedback
    setShowResetToast(true);
    setTimeout(() => setShowResetToast(false), 2000);
  };

  // P7: Status indicator color & icon
  const statusIcon = (() => {
    if (!settings.projectSavePath) return null; // default path, no indicator
    if (pathStatus === "checking") {
      return <div style={{ width: 14, height: 14, border: "2px solid var(--border)", borderTopColor: "var(--accent-btn)", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />;
    }
    if (pathStatus === "valid") {
      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="20 6 9 17 4 12"/></svg>;
    }
    if (pathStatus === "invalid") {
      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>;
    }
    return null;
  })();

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
        设置文件保存路径
      </h2>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 24 }}>
        设置本地保存目录后，软件中产生的所有图片和视频会自动同步保存到该目录下的 images/ 和 videos/ 文件夹
      </p>

      {/* Current path display */}
      <div style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 20,
        background: "var(--bg-hover)",
      }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          {settings.projectSavePath ? "自定义路径" : "默认路径"}
          {statusIcon}
        </div>

        {/* P7: Show error message if path is invalid */}
        {settings.projectSavePath && pathStatus === "invalid" && pathError && (
          <div style={{
            fontSize: 12,
            color: "var(--error)",
            marginBottom: 8,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}>
            {pathError}
          </div>
        )}

        {/* Path display row — P5: user-select text */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
        }}>
          <div style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--bg-secondary)",
            color: "var(--text-primary)",
            fontSize: 13,
            fontFamily: "monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            userSelect: "text",
            WebkitUserSelect: "text",
          } as React.CSSProperties}>
            {currentPath || "加载中..."}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* P3: Primary action style for "更改路径" */}
          <button
            onClick={handleSelectFolder}
            disabled={isLoading}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "var(--accent-btn)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 500,
              cursor: isLoading ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "background-color 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!isLoading) e.currentTarget.style.backgroundColor = "var(--accent-btn-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--accent-btn)";
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            {isLoading ? "选择中..." : "更改路径"}
          </button>

          {/* P4: Reset with hover feedback */}
          {settings.projectSavePath && (
            <button
              onClick={handleReset}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-secondary)",
                fontSize: 13,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-primary)";
                e.currentTarget.style.borderColor = "var(--border-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = "var(--text-secondary)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              恢复默认
            </button>
          )}

          {/* P2: Reset toast feedback */}
          {showResetToast && (
            <span style={{ fontSize: 12, color: "var(--success)", marginLeft: 4 }}>
              ✓ 已恢复默认路径
            </span>
          )}
        </div>
      </div>

      {/* P6: Info — emoji → SVG icon */}
      <div style={{
        marginTop: 16,
        padding: "12px 16px",
        borderRadius: 10,
        background: "var(--accent-dim)",
        border: "1px solid var(--border-glow)",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="12"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          设置本地保存目录后，软件中产生的所有图片和视频会自动同步保存到该目录下的 images/ 和 videos/ 文件夹。方便您直接在文件管理器中查看和使用生成的素材。不设置则仅保存在应用数据目录中。
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UpdateSettings
// ---------------------------------------------------------------------------

export function useAutoUpdateCheck() {
  const [updateAvailable, setUpdateAvailable] = useState<{
    version: string;
    notes: string;
    url: string;
  } | null>(null);
  // Tracks which version the user has dismissed — so we re-notify only if a NEWER version appears
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!window.__TAURI__) return;

    const currentVersion = BUILD_INFO.version;
    const CHECK_INTERVAL_MS = 30 * 60 * 1000; // Check every 30 minutes
    const INITIAL_DELAY_MS = 3000; // First check after 3s (app load)

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const doCheck = async () => {
      if (stopped) return;
      try {
        const data = await checkForUpdate(currentVersion);
        const serverVersion = data.version?.replace(/^v/, "");
        const current = currentVersion.replace(/^v/, "");

        if (!serverVersion || serverVersion === current) {
          // No update — clear notification if it was from a stale check
          setUpdateAvailable(null);
          return;
        }

        // Simple version comparison
        const sv = serverVersion.split(".").map(Number);
        const cv = current.split(".").map(Number);
        let hasUpdate = false;
        for (let i = 0; i < Math.max(sv.length, cv.length); i++) {
          const a = sv[i] || 0;
          const b = cv[i] || 0;
          if (a > b) { hasUpdate = true; break; }
          if (a < b) { hasUpdate = false; break; }
        }

        if (hasUpdate) {
          // Re-show notification if this is a different version than the one user dismissed
          // (or if user hasn't dismissed yet)
          setUpdateAvailable(prev => {
            // Always update info (notes/url might change between checks)
            const newInfo = {
              version: serverVersion,
              notes: data.notes ?? "",
              url: data.url ?? "",
            };
            // If user dismissed this exact version before, keep hidden —
            // but if server pushed a newer version, show again
            if (dismissedVersion === serverVersion) {
              return prev; // Keep previous state (null or same info)
            }
            return newInfo;
          });
        }
      } catch (e) {
        console.warn("[AutoUpdate] Check failed:", e);
      }
    };

    // First check after short delay
    timeoutId = setTimeout(() => {
      doCheck();
      // Then poll every 30 minutes
      intervalId = setInterval(doCheck, CHECK_INTERVAL_MS);
    }, INITIAL_DELAY_MS);

    return () => {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [dismissedVersion]); // Re-run effect when dismissedVersion changes so the closure captures it

  const dismiss = () => {
    // Remember which version was dismissed so we don't re-notify for the same version
    if (updateAvailable) {
      setDismissedVersion(updateAvailable.version);
    }
    setUpdateAvailable(null);
  };

  return { update: updateAvailable, dismiss };
}

export function UpdateNotification({ update, onDismiss }: {
  update: { version: string; notes: string; url: string };
  onDismiss: () => void;
}) {
  const handleUpdate = async () => {
    if (!update.url) return;
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(update.url);
    } catch (e) {
      console.error("Failed to open update URL:", e);
    }
  };

  const handleOpenSettings = () => {
    onDismiss();
    useSettingsDialogStore.getState().openSettings();
    useSettingsDialogStore.getState().setActiveTab("update");
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--glass-bg)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          width: 420,
          background: "var(--bg-surface)",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "var(--shadow-float)",
          border: "1px solid var(--border-glow)",
        }}
      >
        {/* Top accent */}
        <div style={{
          height: 4,
          background: "var(--accent-btn)",
        }} />

        <div style={{ padding: "28px 28px 20px" }}>
          {/* Icon + Title */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
            <div style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: "var(--accent-dim)",
              border: "1px solid var(--accent-muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              flexShrink: 0,
            }}>
              🚀
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
                发现新版本
              </div>
              <div style={{ fontSize: 13, color: "var(--accent-light)", fontFamily: "monospace", marginTop: 2 }}>
                v{update.version}
              </div>
            </div>
          </div>

          {/* Notes */}
          {update.notes && (
            <div style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              lineHeight: 1.7,
              maxHeight: 120,
              overflow: "auto",
              padding: "12px 14px",
              borderRadius: 10,
              background: "var(--bg-hover)",
              marginBottom: 20,
              whiteSpace: "pre-wrap",
            }}>
              {update.notes}
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              onClick={onDismiss}
              style={{
                padding: "9px 18px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--bg-secondary)",
                color: "var(--text-secondary)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              稍后再说
            </button>
            <button
              onClick={handleOpenSettings}
              style={{
                padding: "9px 18px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--bg-secondary)",
                color: "var(--text-primary)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              查看详情
            </button>
            <button
              onClick={handleUpdate}
              style={{
                padding: "9px 22px",
                borderRadius: 10,
                border: "none",
                background: "var(--accent-btn)",
                color: "var(--text-primary)",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              立即更新
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function UpdateSettings() {
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error">("idle");
  const [updateInfo, setUpdateInfo] = useState<{ version: string; date: string; body: string; url: string; signature: string } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const currentVersion = BUILD_INFO.version;

  const handleCheckForUpdates = async () => {
    setUpdateStatus("checking");
    setErrorMsg("");
    setUpdateInfo(null);

    try {
      // Use Rust backend to fetch — bypasses CORS in WebView
      const data = await checkForUpdate(currentVersion);

      // Compare versions
      const serverVersion = data.version?.replace(/^v/, "");
      const current = currentVersion.replace(/^v/, "");

      if (!serverVersion || serverVersion === current) {
        setUpdateStatus("up-to-date");
        return;
      }

      // Simple version comparison
      const sv = serverVersion.split(".").map(Number);
      const cv = current.split(".").map(Number);
      let hasUpdate = false;
      for (let i = 0; i < Math.max(sv.length, cv.length); i++) {
        const a = sv[i] || 0;
        const b = cv[i] || 0;
        if (a > b) { hasUpdate = true; break; }
        if (a < b) { hasUpdate = false; break; }
      }

      if (hasUpdate) {
        setUpdateStatus("available");
        setUpdateInfo({
          version: data.version,
          date: data.pub_date ?? "",
          body: data.notes ?? "",
          url: data.url ?? "",
          signature: data.signature ?? "",
        });
      } else {
        setUpdateStatus("up-to-date");
      }
    } catch (e) {
      setUpdateStatus("error");
      setErrorMsg(`检查更新失败: ${e}`);
    }
  };

  const downloadAndInstall = async () => {
    if (!updateInfo || !updateInfo.url) return;

    try {
      setUpdateStatus("downloading");
      setDownloadProgress(0);

      // Download the update file using Tauri's HTTP or shell open
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(updateInfo.url);

      setUpdateStatus("ready");
    } catch (e) {
      setUpdateStatus("error");
      setErrorMsg(`下载更新失败: ${e}`);
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
        版本信息
      </h2>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 24 }}>
        查看当前虾客漫版本，并在桌面环境中检查更新
      </p>

      {/* Current version */}
      <div style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 20,
        background: "var(--bg-hover)",
        marginBottom: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginBottom: 4 }}>
              当前版本
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent-light)", fontFamily: "monospace" }}>
              v{currentVersion}
            </div>
          </div>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: "var(--accent-dim)",
            border: "1px solid var(--accent-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
          }}>
            🔄
          </div>
        </div>

        {/* Status messages */}
        {updateStatus === "up-to-date" && (
          <div style={{
            padding: "10px 14px",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--success) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--success) 20%, transparent)",
            color: "var(--success)",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            ✅ 已是最新版本
          </div>
        )}

        {updateStatus === "error" && (
          <div style={{
            padding: "10px 14px",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--error) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--error) 20%, transparent)",
            color: "var(--error)",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            ❌ {errorMsg}
          </div>
        )}

        {updateStatus === "checking" && (
          <div style={{
            padding: "10px 14px",
            borderRadius: 8,
            background: "var(--accent-dim)",
            border: "1px solid var(--accent-muted)",
            color: "var(--accent-light)",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            ⏳ 正在检查更新...
          </div>
        )}

        {updateStatus === "downloading" && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, color: "var(--text-primary)", marginBottom: 8 }}>
              正在下载更新... {downloadProgress}%
            </div>
            <div style={{
              width: "100%",
              height: 8,
              borderRadius: 4,
              background: "var(--accent-dim)",
              overflow: "hidden",
            }}>
              <div style={{
                width: `${downloadProgress}%`,
                height: "100%",
                borderRadius: 4,
                background: "var(--accent-btn)",
                transition: "width 0.3s ease",
              }} />
            </div>
          </div>
        )}

        {updateStatus === "ready" && (
          <div style={{
            padding: "10px 14px",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--success) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--success) 20%, transparent)",
            color: "var(--success)",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            ✅ 更新下载完成，将在重启后生效
          </div>
        )}
      </div>

      {/* Update info */}
      {updateInfo && updateStatus === "available" && (
        <div style={{
          border: "1px solid var(--border-glow)",
          borderRadius: 12,
          padding: 20,
          background: "var(--accent-dim)",
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
            🆕 发现新版本 v{updateInfo.version}
          </div>
          {updateInfo.date && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
              发布日期: {updateInfo.date}
            </div>
          )}
          {updateInfo.body && (
            <div style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              lineHeight: 1.6,
              maxHeight: 120,
              overflow: "auto",
              padding: "10px 14px",
              borderRadius: 8,
              background: "var(--bg-hover)",
              whiteSpace: "pre-wrap",
            }}>
              {updateInfo.body}
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 10 }}>
        {(updateStatus === "idle" || updateStatus === "up-to-date" || updateStatus === "error" || updateStatus === "ready") && (
          <button
            onClick={handleCheckForUpdates}
            disabled={false}
            style={{
              padding: "10px 24px",
              borderRadius: 10,
              border: "none",
              background: "var(--accent-btn)",
              color: "var(--text-primary)",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            🔄 检查更新
          </button>
        )}

        {updateStatus === "available" && (
          <button
            onClick={downloadAndInstall}
            style={{
              padding: "10px 24px",
              borderRadius: 10,
              border: "none",
              background: "var(--success)",
              color: "var(--text-primary)",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            ⬇️ 立即更新
          </button>
        )}
      </div>

      {/* Info */}
      <div style={{
        marginTop: 20,
        padding: "12px 16px",
        borderRadius: 10,
        background: "var(--accent-dim)",
        border: "1px solid var(--border-glow)",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
      }}>
        <span style={{ fontSize: 14, lineHeight: 1 }}>💡</span>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          点击"检查更新"会连接到虾客漫更新服务。网页版本通常由服务器自动更新；桌面环境检测到新版本后可下载安装，更新完成后需要重启应用生效。
        </div>
      </div>
    </div>
  );
}
