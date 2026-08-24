// ============================================================
// PERF1: 全局缩略图 URL 缓存
// 同一个 blobKey 只创建一次 ObjectURL，引用计数管理释放
// ============================================================

const cache = new Map<string, { url: string; refCount: number }>();

/** 获取缓存的 ObjectURL，如果不存在则创建 */
export function getOrCreateThumbnailUrl(blobKey: string, blob: Blob): string {
  const entry = cache.get(blobKey);
  if (entry) {
    entry.refCount++;
    return entry.url;
  }
  const url = URL.createObjectURL(blob);
  cache.set(blobKey, { url, refCount: 1 });
  return url;
}

/** 释放一个引用，引用计数归零时撤销 ObjectURL */
export function releaseThumbnailUrl(blobKey: string): void {
  const entry = cache.get(blobKey);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount <= 0) {
    URL.revokeObjectURL(entry.url);
    cache.delete(blobKey);
  }
}

/** 清空所有缓存（组件卸载时慎用） */
export function clearThumbnailCache(): void {
  cache.forEach(({ url }) => URL.revokeObjectURL(url));
  cache.clear();
}
