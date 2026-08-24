import { useEffect, useCallback, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useProjectStore } from "@/features/canvas/stores/projectStore";
import type { Node } from "@xyflow/react";

/**
 * Keyboard shortcuts hook for canvas operations.
 * - Ctrl+Z: Undo
 * - Ctrl+Y / Ctrl+Shift+Z: Redo
 * - Ctrl+S: Save project
 * - Ctrl+A: Select all nodes
 * - Ctrl+Shift+A / Esc: Deselect all nodes
 * - Ctrl+D: Duplicate selected nodes
 * - Ctrl+C: Copy selected nodes to internal clipboard
 * - Ctrl+V: Paste nodes from internal clipboard (offset increments each paste)
 * - Ctrl+X: Cut selected nodes (copy + delete)
 * - Delete / Backspace: Delete selected nodes (only when NOT in input field)
 * - Ctrl+0: Fit view (zoom to show all nodes)
 * - Ctrl+1: Reset zoom to 100%
 * - Ctrl+/Ctrl-: Zoom in/out
 * - Space (hold): Enable pan mode (space+drag to pan canvas)
 *
 * Delete/Backspace is handled here (not via ReactFlow deleteKeyCode)
 * to properly skip when focus is in an input/contentEditable field.
 * ReactFlow deleteKeyCode is set to null in Canvas.tsx.
 *
 * PERFORMANCE: Only subscribes to stable selectors (functions).
 * Reads nodes/edges/history via getState() inside the handler to avoid re-renders.
 */

// Internal clipboard for Ctrl+C/V/X (not OS clipboard — keeps node structure)
let _internalClipboard: Node[] = [];
// Tracks how many times we've pasted the current clipboard (for incremental offset)
let _pasteCount = 0;

export function useCanvasKeyboard() {
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const setNodes = useCanvasStore((s) => s.setNodes);
  const setSelectedNodes = useCanvasStore((s) => s.setSelectedNodes);
  const duplicateSelectedNodes = useCanvasStore((s) => s.duplicateSelectedNodes);
  const copySelectedNodes = useCanvasStore((s) => s.copySelectedNodes);
  const pasteNodes = useCanvasStore((s) => s.pasteNodes);
  const cutSelectedNodes = useCanvasStore((s) => s.cutSelectedNodes);
  const removeNodes = useCanvasStore((s) => s.removeNodes);
  const setEdges = useCanvasStore((s) => s.setEdges);
  const setSelectedEdges = useCanvasStore((s) => s.setSelectedEdges);
  const currentProject = useProjectStore((s) => s.currentProject);
  const saveProject = useProjectStore((s) => s.saveProject);
  const { fitView, setViewport, zoomIn, zoomOut } = useReactFlow();

  // Space-to-pan state
  const spaceHeldRef = useRef(false);
  const panModeRef = useRef(false);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      const isCtrl = event.ctrlKey || event.metaKey;

      // ── Space: Toggle pan mode ──────────────────────────────────
      if (event.key === " " && !isCtrl && !event.shiftKey) {
        event.preventDefault();
        if (!spaceHeldRef.current) {
          spaceHeldRef.current = true;
          panModeRef.current = true;
          document.body.style.cursor = "grab";
        }
        return;
      }

      // ── Undo ────────────────────────────────────────────────────
      if (isCtrl && event.key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      // ── Redo ────────────────────────────────────────────────────
      if (
        (isCtrl && event.key === "y") ||
        (isCtrl && event.shiftKey && event.key === "Z")
      ) {
        event.preventDefault();
        redo();
        return;
      }

      // ── Save ────────────────────────────────────────────────────
      if (isCtrl && event.key === "s") {
        event.preventDefault();
        if (currentProject) {
          const { nodes, edges, history } = useCanvasStore.getState();
          saveProject({
            nodesJson: JSON.stringify(nodes),
            edgesJson: JSON.stringify(edges),
            historyJson: JSON.stringify(history),
            nodeCount: nodes.length,
          });
        }
        return;
      }

      // ── Select all ──────────────────────────────────────────────
      if (isCtrl && event.key === "a" && !event.shiftKey) {
        event.preventDefault();
        const { nodes } = useCanvasStore.getState();
        const allSelected = nodes.map((n: Node) => ({
          ...n,
          selected: true,
        }));
        setNodes(allSelected);
        setSelectedNodes(nodes.map((n: Node) => n.id));
        return;
      }

      // ── Deselect all (Ctrl+Shift+A or Esc) ──────────────────────
      if ((isCtrl && event.shiftKey && event.key === "A") || event.key === "Escape") {
        event.preventDefault();
        const { nodes } = useCanvasStore.getState();
        const allDeselected = nodes.map((n: Node) => ({
          ...n,
          selected: false,
        }));
        setNodes(allDeselected);
        setSelectedNodes([]);
        return;
      }

      // ── Duplicate (Ctrl+D) ──────────────────────────────────────
      if (isCtrl && event.key === "d") {
        event.preventDefault();
        duplicateSelectedNodes();
        return;
      }

      // ── Copy (Ctrl+C) ───────────────────────────────────────────
      if (isCtrl && event.key === "c") {
        event.preventDefault();
        _internalClipboard = copySelectedNodes();
        _pasteCount = 0; // reset paste offset on new copy
        return;
      }

      // ── Paste (Ctrl+V) ──────────────────────────────────────────
      if (isCtrl && event.key === "v") {
        event.preventDefault();
        if (_internalClipboard.length > 0) {
          _pasteCount++;
          // Each consecutive paste shifts further (40px per paste)
          pasteNodes(_internalClipboard, 40 * _pasteCount);
        }
        return;
      }

      // ── Cut (Ctrl+X) ────────────────────────────────────────────
      if (isCtrl && event.key === "x") {
        event.preventDefault();
        _internalClipboard = cutSelectedNodes();
        _pasteCount = 0;
        return;
      }

      // ── Delete / Backspace (only when not in input) ─────────────
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        const { selectedNodeIds, selectedEdgeIds, edges } = useCanvasStore.getState();
        // Delete selected nodes
        if (selectedNodeIds.length > 0) {
          removeNodes(selectedNodeIds);
        }
        // Also delete selected edges
        if (selectedEdgeIds.length > 0) {
          const remainingEdges = edges.filter((e) => !selectedEdgeIds.includes(e.id));
          setEdges(remainingEdges);
          setSelectedEdges([]);
        }
        return;
      }

      // ── Fit View (Ctrl+0) or Home key ───────────────────────────
      if ((isCtrl && event.key === "0") || event.key === "Home") {
        event.preventDefault();
        fitView({ padding: 0.2, duration: 300 });
        return;
      }

      // ── 100% Zoom (Ctrl+1) ──────────────────────────────────────
      if (isCtrl && event.key === "1") {
        event.preventDefault();
        const { viewport } = useCanvasStore.getState();
        setViewport({ x: viewport.x, y: viewport.y, zoom: 1 });
        return;
      }

      // ── Zoom in (Ctrl++ / Ctrl+=) ──────────────────────────────
      if (isCtrl && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        zoomIn({ duration: 200 });
        return;
      }

      // ── Zoom out (Ctrl+-) ───────────────────────────────────────
      if (isCtrl && event.key === "-") {
        event.preventDefault();
        zoomOut({ duration: 200 });
        return;
      }
    },
    [
      undo,
      redo,
      setNodes,
      setSelectedNodes,
      duplicateSelectedNodes,
      copySelectedNodes,
      pasteNodes,
      cutSelectedNodes,
      removeNodes,
      setEdges,
      setSelectedEdges,
      currentProject,
      saveProject,
      fitView,
      setViewport,
      zoomIn,
      zoomOut,
    ]
  );

  const handleKeyUp = useCallback(
    (event: KeyboardEvent) => {
      // Release space → exit pan mode
      if (event.key === " ") {
        spaceHeldRef.current = false;
        panModeRef.current = false;
        document.body.style.cursor = "";
      }
    },
    []
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  // Expose panMode ref for Canvas component to use
  return { isPanMode: panModeRef };
}



