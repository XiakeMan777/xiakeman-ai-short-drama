// ---------------------------------------------------------------------------
// Reference Image Pool — dedup, caching, and stable numbering
// ---------------------------------------------------------------------------

import type { Node, Edge } from "@xyflow/react";
import type { AssetRecord } from "@/features/canvas/stores/assetStore";
import { CANVAS_NODE_TYPES } from "../domain/canvasNodes";
import { resolveImageDisplayUrl } from "./imageData";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Media type for reference entries */
export type MediaType = "image" | "audio";

/** A resolved reference image with metadata */
export interface ReferenceImageEntry {
  /** Stable 1-based number (for @图N mapping) */
  number: number;
  /** The image URL (could be file path, data URL, or HTTP URL) */
  url: string;
  /** The source node ID that produced this image */
  sourceNodeId: string;
  /** Optional thumbnail URL (may be the same as url for file paths) */
  thumbnailUrl: string;
  /** Width of the image (if known) */
  width?: number;
  /** Height of the image (if known) */
  height?: number;
  /** Source node display name */
  sourceNodeName?: string;
  /** Where this reference comes from: upstream node or asset library */
  source: "upstream" | "asset";
  /** Asset library ID (only when source === 'asset') */
  assetId?: string;
  /** Media type: image or audio */
  mediaType?: MediaType;
}

/** Persisted reference to an asset-library image (survives asset pool reloads) */
export interface PersistedAssetRef {
  url: string;
  thumbnailUrl?: string;
  name?: string;
}

/** Result of building a reference image pool */
export interface ReferenceImagePoolResult {
  /** All reference images in order (1-based numbering = index + 1) */
  entries: ReferenceImageEntry[];
  /** Total count of unique images */
  count: number;
  /** Lookup by number */
  getByNumber: (n: number) => ReferenceImageEntry | undefined;
  /** Lookup by URL */
  getByUrl: (url: string) => ReferenceImageEntry | undefined;
  /** Get all URLs in order */
  urls: string[];
  /** Get all thumbnail URLs in order */
  thumbnailUrls: string[];
  /** Check if a number is valid */
  isValidNumber: (n: number) => boolean;
}

// ---------------------------------------------------------------------------
// URL normalization (module-level for reuse in all dedup stages)
// ---------------------------------------------------------------------------

/**
 * Normalize a URL for deduplication purposes.
 * Handles asset:// prefix, query strings, case differences, path separators,
 * URL encoding, and trailing index fragments.
 */
export function normalizeUrl(u: string): string {
  if (u.startsWith("data:")) return u.slice(0, 200);
  let base = u;
  const qIdx = u.indexOf("?");
  if (qIdx >= 0) base = u.slice(0, qIdx);
  const hIdx = base.indexOf("#");
  if (hIdx >= 0) base = base.slice(0, hIdx);
  if (base.startsWith("asset://localhost/")) {
    base = base.slice("asset://localhost/".length);
  }
  // Decode URL-encoded chars (e.g. %3A → :, %2F → /) so asset:// and file paths
  // that represent the SAME file are normalized identically regardless of encoding.
  try { base = decodeURIComponent(base); } catch { /* keep raw if invalid */ }
  return base.toLowerCase().replace(/\\/g, "/");
}

/**
 * Extract a file basename from a URL for coarse-grained dedup.
 * Falls back to the full normalized URL if no path segment looks like a filename.
 */
export function extractBasename(normalized: string): string {
  const slashIdx = normalized.lastIndexOf("/");
  if (slashIdx < 0 || slashIdx >= normalized.length - 1) return normalized;
  const candidate = normalized.slice(slashIdx + 1);
  // Must look like a filename (has extension or at least 3 chars + dot)
  if (candidate.includes(".") && candidate.length >= 5) return candidate.toLowerCase();
  return normalized;
}

// ---------------------------------------------------------------------------
// Node types that are "image source" nodes
// ---------------------------------------------------------------------------

/**
 * Only these node types should have their `imageUrl` extracted as a reference image.
 * Other node types (imageNode, videoNode, etc.) are "processing" nodes that
 * may coincidentally have `imageUrl` set on their data (from extending NodeImageData),
 * but are not intended to be reference image sources.
 * For non-source nodes, only `frames` array is extracted (for storyboard nodes).
 */
const IMAGE_SOURCE_NODE_TYPES: Set<string> = new Set([
  CANVAS_NODE_TYPES.upload,       // "uploadNode" — primary image source
  CANVAS_NODE_TYPES.imageEdit,    // "imageNode" — AI generated/edited image
  CANVAS_NODE_TYPES.videoResult,   // "videoResultNode" — generated video thumbnail
  CANVAS_NODE_TYPES.cutResult,     // "cutResultNode" — cut result image
  CANVAS_NODE_TYPES.exportImage,   // "exportImageNode" — exported image
  CANVAS_NODE_TYPES.director3d,    // "director3dNode" — 3D camera preview export
  CANVAS_NODE_TYPES.panorama360,   // "panorama360Node" — 360° panorama
  CANVAS_NODE_TYPES.character,     // "characterNode" — character reference image
  CANVAS_NODE_TYPES.scene,         // "sceneNode" — scene reference image
  CANVAS_NODE_TYPES.prop,          // "propNode" — prop reference image
]);

// ---------------------------------------------------------------------------
// Build Reference Image Pool
// ---------------------------------------------------------------------------

/**
 * Extract images from a single node's data.
 * Returns the entries added (without numbering — caller assigns numbers).
 *
 * IMPORTANT: Only extracts `imageUrl` from "image source" node types
 * (uploadNode, videoResultNode, etc.). Other node types like imageNode/videoNode
 * are processing nodes that shouldn't contribute their own imageUrl to the pool.
 * For storyboard split/gen nodes, `frames` array is always extracted.
 */
function extractNodeImages(
  node: Node,
  seenUrls: Set<string>,
  normSeenUrls: Set<string>
): Omit<ReferenceImageEntry, "number">[] {
  const results: Omit<ReferenceImageEntry, "number">[] = [];
  const data = node.data as Record<string, unknown>;
  const displayName = data.displayName as string | undefined;
  const sourceFileName = data.sourceFileName as string | null | undefined;
  const nodeType = node.type || "";

  // Only extract imageUrl from "image source" node types
  if (IMAGE_SOURCE_NODE_TYPES.has(nodeType)) {
    const imageUrl = data.imageUrl as string | null | undefined;
    const previewImageUrl = data.previewImageUrl as string | null | undefined;
    const imageWidth = data.imageWidth as number | undefined;
    const imageHeight = data.imageHeight as number | undefined;
    const sourceFileName = data.sourceFileName as string | null | undefined;

    if (imageUrl && !seenUrls.has(imageUrl) && !normSeenUrls.has(normalizeUrl(imageUrl))) {
      seenUrls.add(imageUrl);
      normSeenUrls.add(normalizeUrl(imageUrl));
      results.push({
        url: imageUrl,
        sourceNodeId: node.id,
        thumbnailUrl: previewImageUrl || imageUrl,
        width: imageWidth,
        height: imageHeight,
        sourceNodeName: sourceFileName || displayName,
        source: "upstream" as const,
        mediaType: "image" as const,
      });
    }
  }

  // For storyboard split/gen nodes, also collect frame images
  const frames = data.frames as
    | Array<{ imageUrl?: string | null }>
    | undefined;
  if (frames) {
    let frameIndex = 0;
    for (const frame of frames) {
      frameIndex++;
      if (frame.imageUrl && !seenUrls.has(frame.imageUrl) && !normSeenUrls.has(normalizeUrl(frame.imageUrl))) {
        seenUrls.add(frame.imageUrl);
        normSeenUrls.add(normalizeUrl(frame.imageUrl));
        results.push({
          url: frame.imageUrl,
          sourceNodeId: node.id,
          thumbnailUrl: frame.imageUrl,
          sourceNodeName: sourceFileName
            ? `${sourceFileName} 帧${frameIndex}`
            : displayName
              ? `${displayName} 帧${frameIndex}`
              : undefined,
          source: "upstream" as const,
          mediaType: "image" as const,
        });
      }
    }
  }

  return results;
}

/**
 * Extract audio from a single audio node's data.
 */
function extractNodeAudio(
  node: Node,
  seenUrls: Set<string>,
  normSeenUrls: Set<string>
): Omit<ReferenceImageEntry, "number">[] {
  const results: Omit<ReferenceImageEntry, "number">[] = [];
  const data = node.data as Record<string, unknown>;
  const audioPath = data.audioPath as string | null | undefined;
  const generatedAudioPath = data.generatedAudioPath as string | null | undefined;
  const sourceFileName = data.sourceFileName as string | null | undefined;
  const generatedFileName = data.generatedFileName as string | null | undefined;
  const displayName = data.displayName as string | undefined;

  // Prefer generated audio if available, fallback to uploaded audio
  const effectivePath = generatedAudioPath || audioPath;
  const effectiveName = generatedFileName || sourceFileName || displayName;

  if (effectivePath && !seenUrls.has(effectivePath) && !normSeenUrls.has(normalizeUrl(effectivePath))) {
    seenUrls.add(effectivePath);
    normSeenUrls.add(normalizeUrl(effectivePath));
    results.push({
      url: effectivePath,
      sourceNodeId: node.id,
      thumbnailUrl: effectivePath,
      sourceNodeName: effectiveName || displayName,
      source: "upstream" as const,
      mediaType: "audio" as const,
    });
  }

  return results;
}

/**
 * Recursively collect images and audio from all upstream nodes (transitive closure).
 * Uses BFS with a visited set to prevent cycles.
 * Orders results by BFS depth then by node X position.
 *
 * @param maxDepth Maximum BFS hops from the target node.
 *   - `1` = only DIRECT upstreams (for ReferenceStrip UI display)
 *   - `Infinity` = full transitive closure (for @图N resolution during generation)
 */
function collectUpstreamMedia(
  startNodeId: string,
  nodes: Node[],
  edges: Edge[],
  seenUrls: Set<string>,
  normSeenUrls: Set<string>,
  visitedNodes: Set<string>,
  maxDepth: number = Infinity
): Omit<ReferenceImageEntry, "number">[] {
  const results: Omit<ReferenceImageEntry, "number">[] = [];
  const queue: string[] = [startNodeId];
  const nodeDepth = new Map<string, number>();
  nodeDepth.set(startNodeId, 0);

  // DEBUG
  const bfsLog: string[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentDepth = nodeDepth.get(currentId) || 0;

    // Skip if already visited (cycle protection)
    if (visitedNodes.has(currentId)) continue;
    visitedNodes.add(currentId);

    // Don't extract media from the start node itself (it's the target, not an upstream)
    if (currentId !== startNodeId) {
      const node = nodes.find((n) => n.id === currentId);
      if (node) {
        const nodeType = node.type || "?";
        const nodeName = ((node.data as any)?.displayName as string) || currentId.slice(-8);
        let logLine = `[BFS d=${currentDepth}] ${nodeType}:${nodeName} `;
        // Extract images
        const nodeImages = extractNodeImages(node, seenUrls, normSeenUrls);
        if (nodeImages.length > 0) logLine += `→ ${nodeImages.length} img `;
        results.push(...nodeImages);
        // Extract audio from audio nodes
        if (node.type === CANVAS_NODE_TYPES.audio) {
          const nodeAudio = extractNodeAudio(node, seenUrls, normSeenUrls);
          if (nodeAudio.length > 0) logLine += `→ ${nodeAudio.length} audio `;
          results.push(...nodeAudio);
        }
        const incoming2 = edges.filter((e) => e.target === currentId);
        if (incoming2.length > 0) logLine += `← upstreams:[${incoming2.map(e => e.source.slice(0,10)).join(",")}]`;
        bfsLog.push(logLine);
      }
    } else {
      const incomingStart = edges.filter((e) => e.target === startNodeId);
      bfsLog.push(`[BFS START] maxDepth=${maxDepth} ← ${incomingStart.length} direct edge(s): [${incomingStart.map(e => `src:${e.source.slice(0,14)}`).join(", ")}]`);
    }

    // Stop exploring deeper if we've reached maxDepth (for display-only pools)
    if (currentDepth >= maxDepth) continue;

    // Find all nodes that feed INTO the current node (its upstreams)
    const incoming = edges.filter((e) => e.target === currentId);
    for (const edge of incoming) {
      if (!visitedNodes.has(edge.source) && !queue.includes(edge.source)) {
        queue.push(edge.source);
        nodeDepth.set(edge.source, currentDepth + 1);
      }
    }
  }

  if (results.length > 0 || bfsLog.length > 2) {
    console.warn("[PoolBFS] " + startNodeId.slice(0,16) + " → " + results.length + " upstream entries");
    for (const l of bfsLog) console.warn("  " + l);
  }

  return results;
}

/**
 * Build a reference image pool from the upstream nodes connected to a target node.
 *
 * Deduplicates by URL: if the same image appears from multiple sources,
 * only the first occurrence is kept.
 *
 * Images are collected transitively from ALL upstream nodes (not just direct
 * parents), so a chain like Upload → Storyboard → VideoNode still makes the
 * upload visible to the video node.
 *
 * Only upstream (connected) images and explicitly persisted asset references
 * are shown. The full asset pool is available separately for @图N resolution
 * via buildAssetImagePool, but is NOT merged into this pool to avoid
 * showing unconnected asset-library images in every node's strip.
 *
 * If `persistedAssets` is provided, previously-referenced asset images that may
 * no longer exist in the live asset pool are still included. This ensures
 * references survive asset library reloads / panel closes.
 *
 * @param maxDepth Maximum BFS depth for upstream traversal.
 *   - `1` = direct upstreams only (default for UI display)
 *   - `Infinity` = full transitive closure (for @图N resolution during generation)
 */
export function buildReferenceImagePool(
  targetNodeId: string,
  nodes: Node[],
  edges: Edge[],
  _assetPool?: ReferenceImagePoolResult,
  persistedAssets?: PersistedAssetRef[],
  maxDepth: number = 1
): ReferenceImagePoolResult {
  const entries: ReferenceImageEntry[] = [];
  const seenUrls = new Set<string>();
  const normSeenUrls = new Set<string>();
  const visitedNodes = new Set<string>();

  // Collect images and audio from upstream nodes (depth-limited for UI display)
  const upstreamMedia = collectUpstreamMedia(targetNodeId, nodes, edges, seenUrls, normSeenUrls, visitedNodes, maxDepth);

  // Sort by media type (images first, then audio) then by source node's X position
  const sortedMedia = [...upstreamMedia].sort((a, b) => {
    // Images first, then audio
    const typeOrder = { image: 0, audio: 1 };
    const typeDiff = (typeOrder[a.mediaType || "image"] || 0) - (typeOrder[b.mediaType || "image"] || 0);
    if (typeDiff !== 0) return typeDiff;
    const nodeA = nodes.find((n) => n.id === a.sourceNodeId);
    const nodeB = nodes.find((n) => n.id === b.sourceNodeId);
    if (!nodeA || !nodeB) return 0;
    return (nodeA.position?.x || 0) - (nodeB.position?.x || 0);
  });

  for (const item of sortedMedia) {
    entries.push({
      ...item,
      number: entries.length + 1,
    });
  }

  // DEBUG: trace the full picture
  if ((persistedAssets?.length ?? 0) > 0 || entries.length > 1) {
    console.groupCollapsed("[Pool] buildReferenceImagePool for", targetNodeId.slice(0,16));
    console.log("upstream entries:", entries.length, entries.map(e => ({src: e.source, node: e.sourceNodeId?.slice(0,20), url: e.url?.slice(0,80)})));
    console.log("persistedAssets:", persistedAssets?.length ?? 0, persistedAssets?.map(p => ({url: p.url?.slice(0,80), name: p.name})));
    console.log("assetPool count:", _assetPool?.count ?? 0);
    console.groupEnd();
  }

  let allEntries = entries;
  const normalizedSeen = new Set(entries.map(e => normalizeUrl(e.url)));
  const basenameSeen = new Set(entries.map(e => extractBasename(normalizeUrl(e.url))));

  // Merge asset library images so they appear in @ picker and can be referenced via @图N.
  // Deduplication by URL ensures no duplicates with upstream images.
  if (_assetPool && _assetPool.entries.length > 0) {
    for (const ae of _assetPool.entries) {
      const aeNorm = normalizeUrl(ae.url);
      const aeBase = extractBasename(aeNorm);
      if (!normalizedSeen.has(aeNorm) && !basenameSeen.has(aeBase)) {
        allEntries.push({
          number: allEntries.length + 1,
          url: ae.url,
          sourceNodeId: ae.sourceNodeId || `asset-${ae.assetId || ae.number}`,
          thumbnailUrl: ae.thumbnailUrl || ae.url,
          sourceNodeName: ae.sourceNodeName || `素材${allEntries.length + 1}`,
          source: "asset" as const,
          assetId: ae.assetId || ae.number.toString(),
          mediaType: (ae.mediaType as "image" | "audio") || "image",
        });
        normalizedSeen.add(aeNorm);
        basenameSeen.add(aeBase);
      }
    }
  }

  // Merge persisted assets — these are assets that the user has explicitly
  // referenced via @图N in their prompt. They survive asset pool reloads.
  if (persistedAssets && persistedAssets.length > 0) {
    for (const pa of persistedAssets) {
      const paNorm = normalizeUrl(pa.url);
      const paBase = extractBasename(paNorm);
      if (!normalizedSeen.has(paNorm) && !basenameSeen.has(paBase)) {
        allEntries.push({
          number: allEntries.length + 1,
          url: pa.url,
          sourceNodeId: "persisted-asset",
          thumbnailUrl: pa.thumbnailUrl || pa.url,
          sourceNodeName: pa.name,
          source: "asset" as const,
          mediaType: "image" as const,
        });
        normalizedSeen.add(normalizeUrl(pa.url));
        basenameSeen.add(paBase);
      }
    }
  }

  // Final deduplication safety net — multi-key: normalized URL + file basename
  if (allEntries.length > 1) {
    console.warn("[PoolDedup] BEFORE dedup (" + allEntries.length + " entries):",
      allEntries.map(e => ({ n: e.number, src: e.source, nodeId: e.sourceNodeId?.slice(0,20), url: e.url?.slice(0,80), norm: normalizeUrl(e.url).slice(0,60) })));
  }

  const dedupSeen = new Set<string>();
  const dedupBasenames = new Set<string>();
  const dedupedEntries: ReferenceImageEntry[] = [];
  for (const entry of allEntries) {
    const urlKey = normalizeUrl(entry.url);
    const basenameKey = extractBasename(urlKey);
    const isDupeByUrl = dedupSeen.has(urlKey);
    const isDupeByBasename = basenameKey !== urlKey && dedupBasenames.has(basenameKey);

    if (!isDupeByUrl && !isDupeByBasename) {
      dedupSeen.add(urlKey);
      dedupBasenames.add(basenameKey);
      dedupedEntries.push({ ...entry, number: dedupedEntries.length + 1 });
    } else {
      console.warn("[PoolDedup] DROPPED duplicate:", entry.url?.slice(0,80),
        "| norm:", urlKey.slice(0,60),
        "| base:", basenameKey.slice(0,40),
        "| reason:", isDupeByUrl ? "URL" : "basename");
    }
  }
  if (allEntries.length !== dedupedEntries.length) {
    console.warn("[PoolDedup] AFTER:", dedupedEntries.length, "entries (dropped", allEntries.length - dedupedEntries.length, "duplicates)");
  }
  allEntries = dedupedEntries;

  // Build lookup helpers
  const numberMap = new Map<number, ReferenceImageEntry>();
  const urlMap = new Map<string, ReferenceImageEntry>();

  for (const entry of allEntries) {
    numberMap.set(entry.number, entry);
    urlMap.set(entry.url, entry);
  }

  return {
    entries: allEntries,
    count: allEntries.length,
    getByNumber: (n: number) => numberMap.get(n),
    getByUrl: (url: string) => urlMap.get(url),
    urls: allEntries.map((e) => e.url),
    thumbnailUrls: allEntries.map((e) => e.thumbnailUrl),
    isValidNumber: (n: number) => n >= 1 && n <= allEntries.length,
  };
}

// ---------------------------------------------------------------------------
// Build Asset Image Pool
// ---------------------------------------------------------------------------

/**
 * Build a reference image pool from asset library records.
 *
 * Asset images are numbered starting from 1 (they get renumbered when merged
 * into a combined pool via buildReferenceImagePool).
 */
export function buildAssetImagePool(
  assets: AssetRecord[] | null | undefined
): ReferenceImagePoolResult {
  const safeAssets = Array.isArray(assets) ? assets : [];
  const entries: ReferenceImageEntry[] = safeAssets.map((asset, index) => ({
    number: index + 1,
    url: asset.file_path,
    sourceNodeId: `asset-${asset.id}`,
    thumbnailUrl: asset.thumbnail_path || asset.file_path,
    sourceNodeName: asset.name,
    source: "asset" as const,
    assetId: asset.id,
    mediaType: "image" as const,
  }));

  const numberMap = new Map<number, ReferenceImageEntry>();
  const urlMap = new Map<string, ReferenceImageEntry>();

  for (const entry of entries) {
    numberMap.set(entry.number, entry);
    urlMap.set(entry.url, entry);
  }

  return {
    entries,
    count: entries.length,
    getByNumber: (n: number) => numberMap.get(n),
    getByUrl: (url: string) => urlMap.get(url),
    urls: entries.map((e) => e.url),
    thumbnailUrls: entries.map((e) => e.thumbnailUrl),
    isValidNumber: (n: number) => n >= 1 && n <= entries.length,
  };
}

// ---------------------------------------------------------------------------
// Reference image resolution for AI submission
// ---------------------------------------------------------------------------

/**
 * Resolve which reference images to send to the AI based on @图N tokens in the prompt.
 *
 * Logic:
 * - If the prompt contains @图N tokens, only send the specifically referenced images.
 * - If no @图N tokens are present but upstream images exist, send all of them.
 * - Invalid references (N > total count) are silently dropped.
 */
export function resolveReferenceImagesForPrompt(
  _prompt: string,
  pool: ReferenceImagePoolResult,
  referencedNumbers: number[]
): string[] | undefined {
  if (pool.count === 0) return undefined;

  /**
   * Resolve the best URL for API submission.
   * Always prefer the original image URL (entry.url) for best quality.
   * Only fall back to thumbnailUrl if the original is unavailable.
   * The Rust backend handles converting file paths to base64 for the API.
   */
  const resolveBestUrl = (entry: ReferenceImageEntry): string => {
    // Always use the original image for API submission (best quality)
    if (entry.url) return entry.url;
    // Fallback to thumbnail if original is unavailable
    return entry.thumbnailUrl || entry.url;
  };

  if (referencedNumbers.length > 0) {
    // Only send specifically referenced images
    const images = referencedNumbers
      .filter((n) => pool.isValidNumber(n))
      .map((n) => resolveBestUrl(pool.getByNumber(n)!));

    return images.length > 0 ? images : undefined;
  }

  // No explicit @图N tokens — auto-send only the first upstream image as reference
  return pool.urls.slice(0, 1);
}

/**
 * Resolve reference image entries (with metadata) for UI display.
 */
export function resolveReferenceEntriesForPrompt(
  _prompt: string,
  pool: ReferenceImagePoolResult,
  referencedNumbers: number[]
): ReferenceImageEntry[] {
  if (referencedNumbers.length > 0) {
    return referencedNumbers
      .filter((n) => pool.isValidNumber(n))
      .map((n) => pool.getByNumber(n)!);
  }

  // No explicit references — auto-send only the first upstream entry
  return pool.entries.slice(0, 1);
}

// ---------------------------------------------------------------------------
// Thumbnail URL resolution helper
// ---------------------------------------------------------------------------

/**
 * Resolve the display URL for a reference image entry.
 * Uses resolveImageDisplayUrl to properly convert local paths via Tauri asset protocol.
 */
export function resolveReferenceThumbnailUrl(entry: ReferenceImageEntry): string {
  const url = entry.thumbnailUrl || entry.url;
  return resolveImageDisplayUrl(url) || url;
}



