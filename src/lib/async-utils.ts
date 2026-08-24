// ============================================================
// 异步工具函数 — 消除多模块间的 sleep 重复定义
// ============================================================

/**
 * 可中断的 sleep — 支持 AbortSignal 提前唤醒
 *
 * 两处视频后端模块（videoPoller / volcengineApiClient）
 * 原各有一份完全相同的实现，现统一抽取到此。
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => { clearTimeout(timer); resolve(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    // 清理：timeout 触发后移除 listener
    const origResolve = resolve;
    resolve = (() => { signal?.removeEventListener('abort', onAbort); origResolve(); }) as unknown as () => void;
  });
}
