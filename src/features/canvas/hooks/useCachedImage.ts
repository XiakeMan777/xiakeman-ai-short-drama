/**
 * useCachedImage — 图片加载 + 全局 LRU 缓存的 hook
 *
 * 核心思路：
 * 1. 同一个 URL 全局只创建一个 HTMLImageElement
 * 2. 图片一旦解码完成就缓存在内存里
 * 3. 后续渲染直接复用，永远不重复请求/解码
 * 4. 配合 resolveImageDisplayUrl() 的 URL 缓存，确保同一文件路径 → 同一 URL → 同一 Image 对象
 * 5. LRU 淘汰策略：最多保留 MAX_CACHE_SIZE 个条目，超出时淘汰最久未使用的
 */

import { useState, useEffect, useMemo } from "react";
import { resolveImageDisplayUrl } from "../application/imageData";

// ─── 全局 HTMLImageElement 缓存（LRU） ─────────────────────────────

const MAX_CACHE_SIZE = 80;

interface CacheEntry {
  element: HTMLImageElement;
  lastAccess: number;
}

// Map<url, CacheEntry> — 跨组件、跨节点共享，有序（插入顺序即 LRU 顺序）
const imageCache = new Map<string, CacheEntry>();
// Map<url, Set<callback>> — 正在加载中的 URL，等待完成后通知所有订阅者
const loadingCallbacks = new Map<string, Set<() => void>>();

function touchEntry(url: string): void {
  const entry = imageCache.get(url);
  if (entry) {
    entry.lastAccess = Date.now();
    // Re-insert to maintain Map insertion order (most recently used at end)
    imageCache.delete(url);
    imageCache.set(url, entry);
  }
}

function evictIfNeeded(): void {
  if (imageCache.size <= MAX_CACHE_SIZE) return;
  // Evict oldest entries (first in Map = least recently used)
  const keysToDelete: string[] = [];
  for (const [key] of imageCache) {
    if (imageCache.size - keysToDelete.length <= MAX_CACHE_SIZE) break;
    // Don't evict images that are currently loading
    if (!loadingCallbacks.has(key)) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach((key) => {
    const entry = imageCache.get(key);
    // Release reference to allow GC of decoded bitmap
    if (entry) {
      entry.element.src = '';
      entry.element.removeAttribute('src');
    }
    imageCache.delete(key);
  });
}

function loadImage(url: string): HTMLImageElement {
  const existing = imageCache.get(url);
  if (existing) {
    touchEntry(url);
    return existing.element;
  }

  const img = new window.Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  imageCache.set(url, { element: img, lastAccess: Date.now() });

  img.onload = () => {
    touchEntry(url);
    const cbs = loadingCallbacks.get(url);
    if (cbs) {
      cbs.forEach((cb) => cb());
      loadingCallbacks.delete(url);
    }
    evictIfNeeded();
  };

  img.onerror = () => {
    const cbs = loadingCallbacks.get(url);
    if (cbs) {
      cbs.forEach((cb) => cb());
      loadingCallbacks.delete(url);
    }
    // 加载失败也保留在缓存中，避免反复重试
  };

  return img;
}

function onImageLoaded(url: string, callback: () => void): () => void {
  const cached = imageCache.get(url);
  if (cached && cached.element.complete && cached.element.naturalWidth > 0) {
    touchEntry(url);
    callback();
    return () => {};
  }

  let cbs = loadingCallbacks.get(url);
  if (!cbs) {
    cbs = new Set();
    loadingCallbacks.set(url, cbs);
  }
  cbs.add(callback);
  return () => {
    cbs!.delete(callback);
  };
}

// ─── Hook ────────────────────────────────────────────────────────

interface UseCachedImageResult {
  /** 图片是否已加载完成 */
  loaded: boolean;
  /** HTMLImageElement 对象（用于高级场景） */
  imageElement: HTMLImageElement | null;
  /** 可直接用于 <img src> 的 URL（已通过 resolveImageDisplayUrl 转换） */
  displayUrl: string;
}

/**
 * 加载图片并缓存。
 *
 * @param source 原始图片路径（文件路径、URL 等，会自动调用 resolveImageDisplayUrl）
 * @returns { loaded, imageElement, displayUrl }
 *
 * 用法：
 * ```tsx
 * const { loaded, displayUrl } = useCachedImage(nodeData.imageUrl);
 * return <img src={displayUrl} style={{ opacity: loaded ? 1 : 0 }} />;
 * ```
 */
export function useCachedImage(source: string | null | undefined): UseCachedImageResult {
  // 1. 先把 source 转换为可显示 URL（有缓存，不会每次都调 convertFileSrc）
  const displayUrl = useMemo(() => resolveImageDisplayUrl(source), [source]);

  // 2. 加载图片到缓存
  const [loaded, setLoaded] = useState(() => {
    if (!displayUrl) return false;
    const cached = imageCache.get(displayUrl);
    return !!(cached && cached.element.complete && cached.element.naturalWidth > 0);
  });

  useEffect(() => {
    if (!displayUrl) {
      setLoaded(false);
      return;
    }

    // 检查是否已缓存且加载完成
    const cached = imageCache.get(displayUrl);
    if (cached && cached.element.complete && cached.element.naturalWidth > 0) {
      touchEntry(displayUrl);
      setLoaded(true);
      return;
    }

    // 需要加载
    setLoaded(false);
    loadImage(displayUrl);

    const unsub = onImageLoaded(displayUrl, () => {
      setLoaded(true);
    });

    return unsub;
  }, [displayUrl]);

  const imageElement = loaded && displayUrl
    ? (imageCache.get(displayUrl)?.element ?? null)
    : null;

  return { loaded, imageElement, displayUrl };
}

// ─── 预加载工具函数 ──────────────────────────────────────────────

/**
 * 预加载图片到缓存（不阻塞渲染）
 * 适合在节点数据刚到达时调用，提前开始解码
 */
export function preloadImage(source: string | null | undefined): void {
  if (!source) return;
  const url = resolveImageDisplayUrl(source);
  if (!url) return;
  loadImage(url);
}

/**
 * 清理指定 URL 的缓存
 */
export function evictImageCache(source: string | null | undefined): void {
  if (!source) return;
  const url = resolveImageDisplayUrl(source);
  if (!url) return;
  const entry = imageCache.get(url);
  if (entry) {
    entry.element.src = '';
    entry.element.removeAttribute('src');
  }
  imageCache.delete(url);
}

/**
 * 清理全部缓存（谨慎使用，通常不需要手动清理）
 */
export function clearImageCache(): void {
  imageCache.forEach((entry) => {
    entry.element.src = '';
    entry.element.removeAttribute('src');
  });
  imageCache.clear();
  loadingCallbacks.clear();
}



