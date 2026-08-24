import { create } from "zustand";
import { evictImageCache } from "../hooks/useCachedImage";
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type Connection,
  type Viewport,
  type NodeChange,
} from "@xyflow/react";
import { nodeRegistry, getNodeDefByType } from "../domain/nodeRegistry";

interface CanvasState {
  nodes: Node[];
  edges: Edge[];
  viewport: Viewport;
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  history: { nodes: Node[]; edges: Edge[] }[];
  historyIndex: number;
  isDirty: boolean;

  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;

  addNode: (node: Node) => void;
  addNodes: (nodes: Node[]) => void;
  addEdge: (edge: Edge) => void;
  removeNode: (id: string) => void;
  removeNodes: (ids: string[]) => void;
  updateNodeData: (id: string, data: Record<string, unknown>) => void;
  createConnectedNode: (sourceNodeId: string, targetRegistryKey: string, flowX?: number, flowY?: number) => string | null;
  createNodeBefore: (targetNodeId: string, sourceRegistryKey: string, flowX?: number, flowY?: number) => string | null;
  setViewport: (viewport: Viewport) => void;
  setSelectedNodes: (ids: string[]) => void;
  setSelectedEdges: (ids: string[]) => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  loadState: (nodes: Node[], edges: Edge[], viewport: Viewport) => void;

  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
  markClean: () => void;

  isValidConnection: (connection: Connection) => boolean;
  getConnectedInputs: (nodeId: string) => Edge[];
  getConnectedOutputs: (nodeId: string) => Edge[];
  duplicateSelectedNodes: () => void;
  copySelectedNodes: () => Node[];
  pasteNodes: (clipboardNodes: Node[], offset?: number) => void;
  cutSelectedNodes: () => Node[];
}

const MAX_HISTORY = 50;
const MAX_NODES_PER_PROJECT = 300;

/**
 * Lightweight snapshot for undo/redo history.
 * Excludes `data:` URL fields (base64) to prevent OOM —
 * a single 4K image as base64 is ~20MB, and 50 snapshots × 10 images = crash.
 * Regular file paths and HTTP URLs are kept (only ~50 bytes each).
 * During undo/redo, excluded fields are inherited from current state.
 */
function snapshotState(nodes: Node[], edges: Edge[]) {
  return {
    nodes: nodes.map((n) => {
      const data: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(n.data as Record<string, unknown>)) {
        // Skip base64 data URLs in snapshots (they can be 20MB+ each)
        // Keep file paths and HTTP URLs (only ~50 bytes)
        if (typeof value === "string" && value.startsWith("data:") && value.length > 4096) {
          continue;
        }
        data[key] = value;
      }
      return {
        ...n,
        position: { ...n.position },
        data,
      };
    }),
    edges: edges.map((e) => ({ ...e })),
  };
}

/**
 * Merge large data fields (base64 data URLs) from current nodes into snapshot nodes.
 * This ensures undo/redo preserves the user's images when the snapshot
 * excluded them for memory efficiency.
 */
function mergeDataUrlFields(
  snapshotNodes: Node[],
  currentNodes: Node[]
): Node[] {
  const currentDataMap = new Map<string, Record<string, unknown>>();
  for (const n of currentNodes) {
    const largeFields: Record<string, unknown> = {};
    const d = n.data as Record<string, unknown>;
    for (const [key, value] of Object.entries(d)) {
      if (typeof value === "string" && value.startsWith("data:") && value.length > 4096) {
        largeFields[key] = value;
      }
    }
    if (Object.keys(largeFields).length > 0) {
      currentDataMap.set(n.id, largeFields);
    }
  }

  return snapshotNodes.map((sn) => {
    const largeFields = currentDataMap.get(sn.id);
    if (!largeFields) return sn;
    return {
      ...sn,
      position: { ...sn.position },
      data: { ...sn.data, ...largeFields },
    };
  });
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedNodeIds: [],
  selectedEdgeIds: [],
  history: [],
  historyIndex: -1,
  isDirty: false,

  onNodesChange: (changes: NodeChange[]) => {
    // Track deletions for cleanup
    const deletedIds = changes
      .filter((c) => c.type === "remove")
      .map((c) => c.id);

    set((state) => {
      const newNodes = applyNodeChanges(changes, state.nodes);
      let newEdges = state.edges;

      // Remove edges connected to deleted nodes
      if (deletedIds.length > 0) {
        newEdges = state.edges.filter(
          (e) => !deletedIds.includes(e.source) && !deletedIds.includes(e.target)
        );
      }

      return { nodes: newNodes, edges: newEdges, isDirty: true };
    });
  },

  onEdgesChange: (changes) => {
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
      isDirty: true,
    }));
  },

  onConnect: (connection: Connection) => {
    const { nodes, edges } = get();

    // Validate connection using nodeRegistry
    const sourceNode = nodes.find((n) => n.id === connection.source);
    const targetNode = nodes.find((n) => n.id === connection.target);

    if (!sourceNode || !targetNode) return;
    if (sourceNode.id === targetNode.id) return; // No self-connections

    const sourceDef = getNodeDefByType(sourceNode.type || "");
    const targetDef = getNodeDefByType(targetNode.type || "");

    if (!sourceDef || !targetDef) return;

    // Check max outputs from source
    const sourceOutputCount = edges.filter(
      (e) => e.source === connection.source && e.sourceHandle === connection.sourceHandle
    ).length;
    if (sourceDef.connectivity.maxOutputs > 0 && sourceOutputCount >= sourceDef.connectivity.maxOutputs) {
      return;
    }

    // Check max inputs to target
    const targetInputCount = edges.filter(
      (e) => e.target === connection.target && e.targetHandle === connection.targetHandle
    ).length;
    if (targetDef.connectivity.maxInputs > 0 && targetInputCount >= targetDef.connectivity.maxInputs) {
      return;
    }

    // Check if target accepts this source type
    if (
      targetDef.connectivity.acceptTypes.length > 0 &&
      !targetDef.connectivity.acceptTypes.includes(sourceNode.type as never)
    ) {
      return;
    }

    // Check for duplicate edge
    const isDuplicate = edges.some(
      (e) =>
        e.source === connection.source &&
        e.target === connection.target &&
        e.sourceHandle === connection.sourceHandle &&
        e.targetHandle === connection.targetHandle
    );
    if (isDuplicate) return;

    set({
      edges: addEdge(
        {
          ...connection,
          type: "dataFlow",
        },
        edges
      ),
      isDirty: true,
    });
  },

  addNode: (node) => {
    const { nodes } = get();
    if (nodes.length >= MAX_NODES_PER_PROJECT) {
      console.warn(`[canvasStore] Node limit reached (${MAX_NODES_PER_PROJECT}). Node not added.`);
      return;
    }
    set((state) => ({
      nodes: [...state.nodes, node],
      isDirty: true,
    }));
  },

  addNodes: (newNodes) => {
    const { nodes } = get();
    const remaining = MAX_NODES_PER_PROJECT - nodes.length;
    if (remaining <= 0) {
      console.warn(`[canvasStore] Node limit reached (${MAX_NODES_PER_PROJECT}). Nodes not added.`);
      return;
    }
    const toAdd = newNodes.slice(0, remaining);
    set((state) => ({
      nodes: [...state.nodes, ...toAdd],
      isDirty: true,
    }));
  },

  removeNode: (id) => {
    set((state) => {
      const node = state.nodes.find((n) => n.id === id);
      if (node) {
        const data = node.data as Record<string, unknown>;
        // Evict image cache entries for this node's images
        if (data.imageUrl) evictImageCache(data.imageUrl as string);
        if (data.previewImageUrl) evictImageCache(data.previewImageUrl as string);
      }
      return {
        nodes: state.nodes.filter((n) => n.id !== id),
        edges: state.edges.filter((e) => e.source !== id && e.target !== id),
        isDirty: true,
      };
    });
  },

  removeNodes: (ids) => {
    const idSet = new Set(ids);
    set((state) => {
      // Evict image cache for all removed nodes
      state.nodes.forEach((n) => {
        if (!idSet.has(n.id)) return;
        const data = n.data as Record<string, unknown>;
        if (data.imageUrl) evictImageCache(data.imageUrl as string);
        if (data.previewImageUrl) evictImageCache(data.previewImageUrl as string);
      });
      return {
        nodes: state.nodes.filter((n) => !idSet.has(n.id)),
        edges: state.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
        isDirty: true,
      };
    });
  },

  updateNodeData: (id, data) => {
    set((state) => {
      const idx = state.nodes.findIndex((n) => n.id === id);
      if (idx === -1) return state; // Node not found, no change
      
      const node = state.nodes[idx];
      const newData = { ...node.data, ...data };
      
      // Shallow compare: skip update if data hasn't actually changed
      const changed = Object.keys(data).some(
        (key) => (newData as Record<string, unknown>)[key] !== (node.data as Record<string, unknown>)[key]
      );
      if (!changed) return state;
      
      const newNodes = [...state.nodes];
      newNodes[idx] = { ...node, data: newData };
      return { nodes: newNodes, isDirty: true };
    });
  },

  createConnectedNode: (sourceNodeId, targetRegistryKey, flowX?: number, flowY?: number) => {
    const { nodes } = get();
    const sourceNode = nodes.find((n) => n.id === sourceNodeId);
    if (!sourceNode) return null;

    const def = nodeRegistry[targetRegistryKey];
    if (!def) return null;

    // Check source can output (maxOutputs === 0 means unlimited)
    if (sourceNode.type) {
      const sourceDef = getNodeDefByType(sourceNode.type);
      if (sourceDef && sourceDef.connectivity.maxOutputs > 0) {
        const sourceOutputCount = get().edges.filter(
          (e) => e.source === sourceNodeId
        ).length;
        if (sourceOutputCount >= sourceDef.connectivity.maxOutputs) return null;
      }
    }

    // Check target can accept this source type
    if (
      def.connectivity.acceptTypes.length > 0 &&
      !def.connectivity.acceptTypes.includes(sourceNode.type as never)
    ) {
      return null;
    }

    // Position: use flow coordinates if provided (drag-to-empty), otherwise place to the right of source
    const newNodeId = `${targetRegistryKey}-${Date.now()}`;
    const defaultData = def.createDefaultData();

    // Auto-fill @图1 in prompt if source has an image and target has a prompt field
    const sourceData = sourceNode.data as Record<string, unknown>;
    const sourceHasImage = !!(sourceData.imageUrl || sourceData.panoramaImage);
    if ("prompt" in defaultData && sourceHasImage) {
      defaultData.prompt = "@图1 ";
    }

    const newNode: Node = {
      id: newNodeId,
      type: def.type,
      position:
        flowX !== undefined && flowY !== undefined
          ? { x: flowX, y: flowY }
          : {
              x: sourceNode.position.x + 600,
              y: sourceNode.position.y,
            },
      data: defaultData,
    };

    const newEdge: Edge = {
      id: `edge-${sourceNodeId}-${newNodeId}-${Date.now()}`,
      source: sourceNodeId,
      target: newNodeId,
      type: "dataFlow",
    };

    set((state) => ({
      nodes: [...state.nodes, newNode],
      edges: [...state.edges, newEdge],
      isDirty: true,
    }));

    return newNodeId;
  },

  createNodeBefore: (targetNodeId, sourceRegistryKey, flowX?, flowY?) => {
    const { nodes } = get();
    const targetNode = nodes.find((n) => n.id === targetNodeId);
    if (!targetNode) return null;

    const def = nodeRegistry[sourceRegistryKey];
    if (!def) return null;

    // Check target can accept inputs (maxInputs === 0 means unlimited)
    if (targetNode.type) {
      const targetDef = getNodeDefByType(targetNode.type);
      if (targetDef && targetDef.connectivity.maxInputs > 0) {
        const targetInputCount = get().edges.filter(
          (e) => e.target === targetNodeId
        ).length;
        if (targetInputCount >= targetDef.connectivity.maxInputs) return null;
      }
    }

    const newNodeId = `${sourceRegistryKey}-${Date.now()}`;
    const defaultData = def.createDefaultData();

    // Auto-fill @图1 in target's prompt if new source node type has images
    // (The new node feeds INTO the target, so the target should reference the new source)

    const newNode: Node = {
      id: newNodeId,
      type: def.type,
      position:
        flowX !== undefined && flowY !== undefined
          ? { x: flowX, y: flowY }
          : {
              x: targetNode.position.x - 600,
              y: targetNode.position.y,
            },
      data: defaultData,
    };

    const newEdge: Edge = {
      id: `edge-${newNodeId}-${targetNodeId}-${Date.now()}`,
      source: newNodeId,
      target: targetNodeId,
      type: "dataFlow",
    };

    set((state) => ({
      nodes: [...state.nodes, newNode],
      edges: [...state.edges, newEdge],
      isDirty: true,
    }));

    // Auto-fill @图1 in target's prompt if the new source has image capability
    if (def.capabilities.hasImage && targetNode.type) {
      const targetData = targetNode.data as Record<string, unknown>;
      if ("prompt" in targetData && typeof targetData.prompt === "string" && !targetData.prompt.includes("@图")) {
        // Need to recalculate reference pool, so just prepend @图1
        const updatedPrompt = `@图1 ${targetData.prompt}`;
        // Update after a tick so the new node is already in the pool
        setTimeout(() => {
          get().updateNodeData(targetNodeId, { prompt: updatedPrompt });
        }, 0);
      }
    }

    return newNodeId;
  },

  setViewport: (viewport) => set({ viewport }),

  setSelectedNodes: (ids) => set({ selectedNodeIds: ids }),
  setSelectedEdges: (ids) => set({ selectedEdgeIds: ids }),

  setNodes: (nodes) => set({ nodes, isDirty: true }),
  setEdges: (edges) => set({ edges, isDirty: true }),
  addEdge: (edge: Edge) => {
    set((state) => ({
      edges: [...state.edges, edge],
      isDirty: true,
    }));
  },

  loadState: (nodes, edges, viewport) => {
    const snapshot = snapshotState(nodes, edges);
    set({
      nodes,
      edges,
      viewport,
      history: [snapshot],
      historyIndex: 0,
      isDirty: false,
    });
  },

  // History management
  undo: () => {
    const { history, historyIndex, nodes: currentNodes } = get();
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const snapshot = history[newIndex];
    // Merge base64 fields from current state (they were excluded from snapshot)
    const restoredNodes = mergeDataUrlFields(snapshot.nodes, currentNodes);
    set({
      nodes: restoredNodes,
      edges: snapshot.edges.map((e) => ({ ...e })),
      historyIndex: newIndex,
      isDirty: true,
    });
  },

  redo: () => {
    const { history, historyIndex, nodes: currentNodes } = get();
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    const snapshot = history[newIndex];
    const restoredNodes = mergeDataUrlFields(snapshot.nodes, currentNodes);
    set({
      nodes: restoredNodes,
      edges: snapshot.edges.map((e) => ({ ...e })),
      historyIndex: newIndex,
      isDirty: true,
    });
  },

  pushHistory: () => {
    const { nodes, edges, history, historyIndex } = get();
    const snapshot = snapshotState(nodes, edges);
    // Truncate future history if we're not at the end
    const truncatedHistory = history.slice(0, historyIndex + 1);
    const newHistory = [...truncatedHistory, snapshot];
    // Limit history size
    if (newHistory.length > MAX_HISTORY) {
      newHistory.shift();
    }
    set({
      history: newHistory,
      historyIndex: Math.min(historyIndex + 1, newHistory.length - 1),
    });
  },

  markClean: () => set({ isDirty: false }),

  // Connection validation helpers
  isValidConnection: (connection: Connection) => {
    const { nodes, edges } = get();
    const sourceNode = nodes.find((n) => n.id === connection.source);
    const targetNode = nodes.find((n) => n.id === connection.target);

    if (!sourceNode || !targetNode) return false;
    if (sourceNode.id === targetNode.id) return false;

    const sourceDef = getNodeDefByType(sourceNode.type || "");
    const targetDef = getNodeDefByType(targetNode.type || "");

    if (!sourceDef || !targetDef) return false;

    // Check max outputs
    const sourceOutputCount = edges.filter(
      (e) => e.source === connection.source
    ).length;
    if (sourceDef.connectivity.maxOutputs > 0 && sourceOutputCount >= sourceDef.connectivity.maxOutputs) {
      return false;
    }

    // Check max inputs
    const targetInputCount = edges.filter(
      (e) => e.target === connection.target
    ).length;
    if (targetDef.connectivity.maxInputs > 0 && targetInputCount >= targetDef.connectivity.maxInputs) {
      return false;
    }

    // Check accept types
    if (
      targetDef.connectivity.acceptTypes.length > 0 &&
      !targetDef.connectivity.acceptTypes.includes(sourceNode.type as never)
    ) {
      return false;
    }

    return true;
  },

  getConnectedInputs: (nodeId: string) => {
    return get().edges.filter((e) => e.target === nodeId);
  },

  getConnectedOutputs: (nodeId: string) => {
    return get().edges.filter((e) => e.source === nodeId);
  },

  // Duplicate selected nodes (Ctrl+D)
  duplicateSelectedNodes: () => {
    const { nodes, selectedNodeIds } = get();
    const selectedNodes = nodes.filter((n) => selectedNodeIds.includes(n.id));
    if (selectedNodes.length === 0) return;

    // Check node limit
    if (nodes.length + selectedNodes.length > MAX_NODES_PER_PROJECT) {
      return;
    }

    const OFFSET = 30;
    const idMap: Record<string, string> = {}; // old id → new id

    const newNodes: Node[] = selectedNodes.map((n) => {
      const newId = `${n.type || "node"}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      idMap[n.id] = newId;
      return {
        ...n,
        id: newId,
        position: { x: n.position.x + OFFSET, y: n.position.y + OFFSET },
        data: { ...(n.data as Record<string, unknown>) },
        selected: true,
      };
    });

    // Deselect original nodes
    const updatedOldNodes = nodes.map((n) =>
      selectedNodeIds.includes(n.id) ? { ...n, selected: false } : n
    );

    set({
      nodes: [...updatedOldNodes, ...newNodes],
      selectedNodeIds: newNodes.map((n) => n.id),
      isDirty: true,
    });
  },

  // Copy selected nodes (Ctrl+C)
  copySelectedNodes: () => {
    const { nodes, selectedNodeIds } = get();
    const selectedNodes = nodes.filter((n) => selectedNodeIds.includes(n.id));
    return selectedNodes.map((n) => ({
      ...n,
      data: { ...(n.data as Record<string, unknown>) },
    }));
  },

  // Paste nodes from clipboard (Ctrl+V)
  pasteNodes: (clipboardNodes: Node[], offset = 40) => {
    const { nodes } = get();
    if (nodes.length + clipboardNodes.length > MAX_NODES_PER_PROJECT) return;

    const idMap: Record<string, string> = {};

    const newNodes: Node[] = clipboardNodes.map((n) => {
      const newId = `${n.type || "node"}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      idMap[n.id] = newId;
      return {
        ...n,
        id: newId,
        position: { x: n.position.x + offset, y: n.position.y + offset },
        data: { ...(n.data as Record<string, unknown>) },
        selected: true,
      };
    });

    // Deselect all current nodes
    const updatedNodes = nodes.map((n) => ({ ...n, selected: false }));

    set({
      nodes: [...updatedNodes, ...newNodes],
      selectedNodeIds: newNodes.map((n) => n.id),
      isDirty: true,
    });
  },

  // Cut selected nodes (Ctrl+X) — copy then remove
  cutSelectedNodes: () => {
    const copied = get().copySelectedNodes();
    const { selectedNodeIds } = get();
    if (selectedNodeIds.length > 0) {
      get().removeNodes(selectedNodeIds);
    }
    return copied;
  },
}));



