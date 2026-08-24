import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import type { Node, Edge } from "@xyflow/react";

/**
 * Returns only the upstream nodes connected to the given node ID.
 *
 * PERFORMANCE FIX: Previously subscribed to entire nodes/edges arrays,
 * causing ALL node components to re-render on ANY data change.
 *
 * Now uses a custom Zustand selector with object-cached results:
 * - The selector computes a compact "upstream key" from media fields
 * - Only when the key actually changes does Zustand trigger a re-render
 * - The full upstream objects are cached and returned as stable references
 */

// Compute a compact key from upstream node media-relevant fields
function computeUpstreamKey(nodes: Node[], edges: Edge[], nodeId: string): string {
  const incoming = edges.filter((e) => e.target === nodeId);
  if (incoming.length === 0) return "";
  const ids = new Set(incoming.map((e) => e.source));
  return nodes
    .filter((n) => ids.has(n.id))
    .map((src) => {
      const d = src.data as Record<string, unknown>;
      return `${src.id}:${d.imageUrl || ""}:${d.previewImageUrl || ""}:${d.videoUrl || ""}:${d.videoPath || ""}`;
    })
    .join("|");
}

// Cache: maps key → derived result, keyed by nodeId prefix for eviction
const upstreamCache = new Map<string, { incomingEdges: Edge[]; upstreamNodes: Node[] }>();

export function useUpstreamNodes(nodeId: string): {
  incomingEdges: Edge[];
  upstreamNodes: Node[];
} {
  // Use a custom selector that returns a stable reference via cache
  const result = useCanvasStore((s) => {
    const key = `upstream:${nodeId}:${computeUpstreamKey(s.nodes, s.edges, nodeId)}`;

    // Check cache
    const cached = upstreamCache.get(key);
    if (cached) return cached;

    // Compute and cache
    const incomingEdges = s.edges.filter((e) => e.target === nodeId);
    const upstreamNodeIds = new Set(incomingEdges.map((e) => e.source));
    const upstreamNodes = s.nodes.filter((n) => upstreamNodeIds.has(n.id));
    const entry = { incomingEdges, upstreamNodes };
    upstreamCache.set(key, entry);

    // Evict old entries for this nodeId to prevent memory leak
    for (const k of upstreamCache.keys()) {
      if (k.startsWith(`upstream:${nodeId}:`) && k !== key) {
        upstreamCache.delete(k);
      }
    }

    return entry;
  });

  return result;
}

/**
 * Returns a stable key that only changes when the upstream nodes'
 * relevant media data changes. Use this to skip expensive re-computations
 * (e.g., reference image pool) when only unrelated nodes changed.
 */
export function useUpstreamDataKey(nodeId: string): string {
  return useCanvasStore(
    (s) => computeUpstreamKey(s.nodes, s.edges, nodeId)
  );
}



