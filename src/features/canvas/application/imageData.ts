/**
 * Image data utility functions.
 * Provides image source resolution, file preparation, display URL conversion,
 * and zoom-based image switching logic.
 *
 * Follows the same patterns as the reference Storyboard-Copilot project.
 */

import { convertFileSrc } from "@/features/canvas/compat/tauriCore";

// ---------------------------------------------------------------------------
// convertFileSrc cache — avoid regenerating asset URLs on every render
// ---------------------------------------------------------------------------
// Tauri's convertFileSrc() generates a new token each call, causing the browser
// to treat the URL as a different resource and reload the image. This cache
// ensures the same file path always maps to the same asset URL, preventing
// unnecessary image reloads and eliminating flicker/stutter in ReactFlow nodes.
// Cache TTL matches Tauri's default asset token validity (~5 minutes).
// ---------------------------------------------------------------------------

const assetUrlCache = new Map<string, string>();
const ASSET_URL_CACHE_TTL_MS = 4 * 60 * 1000; // 4 minutes (conservative)
const assetUrlCacheTimestamps = new Map<string, number>();

/** Purge expired entries from the cache (called lazily). */
function purgeExpiredCacheEntries(): void {
  const now = Date.now();
  for (const [key, ts] of assetUrlCacheTimestamps) {
    if (now - ts > ASSET_URL_CACHE_TTL_MS) {
      assetUrlCache.delete(key);
      assetUrlCacheTimestamps.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// File extension resolution
// ---------------------------------------------------------------------------

/** Map MIME types to file extensions. */
export function resolveFileExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
    "image/avif": "avif",
  };
  return map[mimeType] || "png";
}

/** Guess extension from a filename. */
export function guessExtensionFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg"].includes(ext)) return "jpg";
  if (["png", "webp", "gif", "bmp", "tiff", "avif"].includes(ext)) return ext;
  return "png";
}

// ---------------------------------------------------------------------------
// Display URL resolution
// ---------------------------------------------------------------------------

/**
 * Convert an image source to a displayable URL.
 * - `file://` paths → Tauri asset protocol URL (cached!)
 * - Local absolute paths → Tauri asset protocol URL (cached!)
 * - `data:` URLs → use as-is
 * - `http://` / `https://` → use as-is
 *
 * IMPORTANT: File-path → asset-URL conversions are cached so that the same
 * path always maps to the same `asset://...?token=...` URL. Without this
 * cache, every React re-render would call convertFileSrc(), get a *new*
 * token, and the browser would treat it as a brand-new image — causing
 * flicker, reload spinners, and perceived lag.
 */
export function resolveImageDisplayUrl(source: string | null | undefined): string {
  if (!source) return "";

  // Detect corrupted image pool references (old projects where imagePool was lost)
  // These look like "__img_ref__:0" and cannot be displayed
  if (source.includes("__img_ref__:")) return "";

  // Data URL — use directly (no caching needed)
  if (source.startsWith("data:")) return source;

  // HTTP(S) — use directly (browser handles caching)
  if (source.startsWith("http://") || source.startsWith("https://")) return source;

  // file:// protocol — convert to Tauri asset URL (with cache)
  if (source.startsWith("file://")) {
    const filePath = source.replace("file://", "");
    const decodedPath = decodeURIComponent(filePath);
    return cachedConvertFileSrc(decodedPath);
  }

  // Local absolute path (Windows: C:\..., Unix: /home/...) — with cache
  if (source.match(/^[A-Za-z]:/) || source.startsWith("/")) {
    return cachedConvertFileSrc(source);
  }

  // Fallback
  return source;
}

/**
 * Cached version of convertFileSrc — same path always returns the same URL.
 * Prevents browser from re-fetching images on every React re-render.
 */
function cachedConvertFileSrc(filePath: string): string {
  // Lazy cache purge
  if (assetUrlCache.size > 200) {
    purgeExpiredCacheEntries();
  }

  const cached = assetUrlCache.get(filePath);
  if (cached) {
    // Check if still valid
    const ts = assetUrlCacheTimestamps.get(filePath) || 0;
    if (Date.now() - ts < ASSET_URL_CACHE_TTL_MS) {
      return cached;
    }
    // Expired — fall through to regenerate
  }

  try {
    const url = convertFileSrc(filePath);
    assetUrlCache.set(filePath, url);
    assetUrlCacheTimestamps.set(filePath, Date.now());
    return url;
  } catch (e) {
    console.error("[cachedConvertFileSrc] convertFileSrc failed:", e, "path:", filePath);
    // Manual fallback for Windows paths
    const normalized = filePath.replace(/\\/g, "/").replace(/:/g, "%3A");
    return `https://asset.localhost/${normalized}`;
  }
}

// ---------------------------------------------------------------------------
// Zoom-based image switching
// ---------------------------------------------------------------------------

/**
 * Threshold zoom level for switching between preview and original images.
 * Below this level, use the lightweight preview; above, use the original.
 */
const ZOOM_THRESHOLD = 1.45;

/**
 * Decide whether to use the original (full-resolution) image based on zoom.
 * Returns true when the zoom level is high enough to warrant the original.
 */
export function shouldUseOriginalImageByZoom(zoom: number): boolean {
  return zoom >= ZOOM_THRESHOLD;
}

/**
 * Choose the best image URL based on zoom level and available sources.
 * Prefers the preview image at low zoom, original at high zoom.
 */
export function resolveImageUrlByZoom(
  imageUrl: string | null | undefined,
  previewImageUrl: string | null | undefined,
  zoom: number
): string {
  if (!imageUrl && !previewImageUrl) return "";
  if (!previewImageUrl) return resolveImageDisplayUrl(imageUrl);
  if (!imageUrl) return resolveImageDisplayUrl(previewImageUrl);

  if (shouldUseOriginalImageByZoom(zoom)) {
    return resolveImageDisplayUrl(imageUrl);
  }
  return resolveImageDisplayUrl(previewImageUrl);
}

// ---------------------------------------------------------------------------
// File reading helpers
// ---------------------------------------------------------------------------

/** Read a File as a data URL. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/** Read a File as an ArrayBuffer. */
export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

// ---------------------------------------------------------------------------
// Prepare node image from file (three-tier strategy)
// ---------------------------------------------------------------------------

/**
 * Prepare a node image from a File object using a three-tier strategy:
 * 1. Tauri path mode: if file.path is available (Electron-like), use path directly
 * 2. Tauri binary mode: read as ArrayBuffer, pass to backend
 * 3. DataURL fallback: read as data URL, pass to backend
 *
 * Returns { path, previewPath, width, height } from the backend.
 */
export async function prepareNodeImageFromFile(
  file: File
): Promise<{
  path: string;
  previewPath: string;
  width: number;
  height: number;
} | null> {
  const isTauri = !!window.__TAURI__;

  if (!isTauri) {
    // Web fallback — just read as data URL
    const dataUrl = await readFileAsDataUrl(file);
    // Return minimal structure
    const img = new Image();
    return new Promise((resolve) => {
      img.onload = () => {
        resolve({
          path: dataUrl,
          previewPath: dataUrl,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  try {
    // Strategy 1: Tauri path mode (if file.path is available)
    const filePath = (file as unknown as { path?: string }).path;
    if (filePath) {
      const { prepareNodeImageSource } = await import("@/features/canvas/compat/commands");
      const result = await prepareNodeImageSource(filePath);
      return result as { path: string; previewPath: string; width: number; height: number };
    }
  } catch (e) {
    console.warn("Tauri path mode failed, trying binary mode:", e);
  }

  try {
    // Strategy 2: Tauri binary mode
    const arrayBuffer = await readFileAsArrayBuffer(file);
    const bytes = Array.from(new Uint8Array(arrayBuffer));
    const extension = resolveFileExtension(file.type) || guessExtensionFromFilename(file.name);

    const { persistImageBinary, prepareNodeImageSource } = await import("@/features/canvas/compat/commands");
    const path = (await persistImageBinary(bytes, extension)) as string;
    const result = await prepareNodeImageSource(path);
    return result as { path: string; previewPath: string; width: number; height: number };
  } catch (e) {
    console.warn("Tauri binary mode failed, trying data URL fallback:", e);
  }

  try {
    // Strategy 3: DataURL fallback
    const dataUrl = await readFileAsDataUrl(file);
    const { prepareNodeImageSource } = await import("@/features/canvas/compat/commands");
    const result = await prepareNodeImageSource(dataUrl);
    return result as { path: string; previewPath: string; width: number; height: number };
  } catch (e) {
    console.error("All image preparation strategies failed:", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Clipboard helpers
// ---------------------------------------------------------------------------

/**
 * Extract an image File from a clipboard paste event, if any.
 */
export function extractImageFromClipboardEvent(
  event: ClipboardEvent
): File | null {
  const items = event.clipboardData?.items;
  if (!items) return null;

  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith("image/")) {
      return items[i].getAsFile();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Extract display name from URL or path
// ---------------------------------------------------------------------------

/**
 * Extract a human-readable filename from an image/video URL or local path.
 *
 * Priority:
 * 1. If it's an HTTP(S) URL, extract the last path segment (e.g. "abc.png" from "https://cdn.com/abc.png")
 * 2. If it's a local file path, extract the filename portion
 * 3. If the extracted name is a bare hash (hex-only, no meaningful words), fall back to a timestamp-based name
 *
 * @param source The original URL or path of the generated image/video
 * @param fallbackPrefix Prefix for the timestamp fallback (e.g. "image" or "video")
 * @returns A display-friendly filename
 */
export function extractDisplayName(source: string, fallbackPrefix = "image"): string {
  let rawName = "";

  try {
    if (source.startsWith("http://") || source.startsWith("https://")) {
      // Extract last path segment from URL
      const url = new URL(source);
      const pathSegments = url.pathname.split("/").filter(Boolean);
      rawName = pathSegments[pathSegments.length - 1] || "";
    } else if (source.startsWith("data:")) {
      // Data URL — no name, use timestamp
      rawName = "";
    } else {
      // Local file path — extract filename
      const normalized = source.replace(/\\/g, "/");
      const segments = normalized.split("/").filter(Boolean);
      rawName = segments[segments.length - 1] || "";
    }
  } catch {
    rawName = "";
  }

  // If we got a name, check if it's meaningful (not just a hex hash)
  if (rawName) {
    // Decode URI encoding
    try { rawName = decodeURIComponent(rawName); } catch { /* keep as-is */ }

    // Strip query string
    const withoutQuery = rawName.split("?")[0];

    // Check if it's a bare hex hash like "a1b2c3d4e5f6.png" or "a1b2c3d4e5f6"
    const nameWithoutExt = withoutQuery.replace(/\.[^.]+$/, "");
    if (/^[0-9a-f]{6,}$/i.test(nameWithoutExt)) {
      // It's a hex hash — not meaningful to users, fall through to timestamp
    } else if (withoutQuery.length > 0) {
      return withoutQuery;
    }
  }

  // Fallback: timestamp-based name
  const now = new Date();
  const ts = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    "_" +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");

  return `${fallbackPrefix}_${ts}.png`;
}

// ---------------------------------------------------------------------------
// Save-time HTTP URL persistence
// ---------------------------------------------------------------------------

/** Known media URL field names that should be persisted before saving */
const MEDIA_URL_FIELDS = new Set([
  "imageUrl", "previewImageUrl", "videoUrl", "previewVideoUrl",
  "firstFrameImage", "thumbnailUrl",
]);

/** Max seconds to wait for a single HTTP image download during save */
const PERSIST_TIMEOUT_MS = 10_000;

/**
 * Before saving project JSON, scan all nodes for HTTP(S) media URLs
 * and persist them to local disk. This ensures images/videos survive
 * across app restarts, even when the original URL expires.
 *
 * Returns the updated nodes JSON string with HTTP URLs replaced by
 * local file paths.
 */
export async function persistMediaUrlsBeforeSave(
  nodesJson: string
): Promise<string> {
  const httpUrls = new Set<string>();
  let nodes: any[];

  try {
    nodes = JSON.parse(nodesJson);
  } catch {
    return nodesJson;
  }

  collectHttpMediaUrls(nodes, httpUrls, new WeakSet());

  if (httpUrls.size === 0) return nodesJson;

  // Persist each URL with a per-URL timeout — avoids hanging
  // the save pipeline (and the window close) on slow servers.
  const urlMap = new Map<string, string>();
  const { persistImageSource } = await import("@/features/canvas/compat/commands");
  for (const url of httpUrls) {
    try {
      const localPath = await withTimeout(
        persistImageSource(url),
        PERSIST_TIMEOUT_MS
      ) as string;
      if (localPath && localPath !== url) {
        urlMap.set(url, localPath);
      }
    } catch (e) {
      console.warn("[persistMediaUrlsBeforeSave] Failed to persist:", url.substring(0, 80), e);
    }
  }

  if (urlMap.size === 0) return nodesJson;

  replaceHttpMediaUrls(nodes, urlMap, new WeakSet());

  return JSON.stringify(nodes);
}

/** Race a promise against a timeout, rejecting on expiry */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

/** Recursively collect HTTP(S) URLs from known media fields */
function collectHttpMediaUrls(
  obj: unknown,
  urls: Set<string>,
  visited: WeakSet<object>
): void {
  if (!obj || typeof obj !== "object") return;
  if (visited.has(obj as object)) return;
  visited.add(obj as object);

  if (Array.isArray(obj)) {
    for (const item of obj) collectHttpMediaUrls(item, urls, visited);
    return;
  }

  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const val = record[key];
    if (typeof val === "string" && MEDIA_URL_FIELDS.has(key)) {
      if (val.startsWith("http://") || val.startsWith("https://")) {
        urls.add(val);
      }
    } else if (key === "referencedAssets" && Array.isArray(val)) {
      // Handle referencedAssets[].url — without adding "url" to
      // the global MEDIA_URL_FIELDS set (which is too broad).
      for (const asset of val) {
        if (asset && typeof asset === "object") {
          const assetObj = asset as Record<string, unknown>;
          const assetUrl = assetObj.url;
          if (typeof assetUrl === "string" && (assetUrl.startsWith("http://") || assetUrl.startsWith("https://"))) {
            urls.add(assetUrl);
          }
        }
      }
    } else if (typeof val === "object") {
      collectHttpMediaUrls(val, urls, visited);
    }
  }
}

/** Recursively replace HTTP URLs with local paths */
function replaceHttpMediaUrls(
  obj: unknown,
  urlMap: Map<string, string>,
  visited: WeakSet<object>
): void {
  if (!obj || typeof obj !== "object") return;
  if (visited.has(obj as object)) return;
  visited.add(obj as object);

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) replaceHttpMediaUrls(obj[i], urlMap, visited);
    return;
  }

  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const val = record[key];
    if (typeof val === "string" && MEDIA_URL_FIELDS.has(key)) {
      const replacement = urlMap.get(val);
      if (replacement) record[key] = replacement;
    } else if (key === "referencedAssets" && Array.isArray(val)) {
      for (const asset of val) {
        if (asset && typeof asset === "object") {
          const assetObj = asset as Record<string, unknown>;
          const assetUrl = assetObj.url;
          if (typeof assetUrl === "string") {
            const replacement = urlMap.get(assetUrl);
            if (replacement) assetObj.url = replacement;
          }
        }
      }
    } else if (typeof val === "object") {
      replaceHttpMediaUrls(val, urlMap, visited);
    }
  }
}



