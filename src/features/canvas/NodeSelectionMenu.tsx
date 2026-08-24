import { useState, useEffect, useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { nodeRegistry } from "./domain/nodeRegistry";
import { GroupedNodeMenu } from "./ui/GroupedNodeMenu";

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
}

export function NodeSelectionMenu() {
  const { screenToFlowPosition } = useReactFlow();
  const [menu, setMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0 });
  const addNode = useCanvasStore((s) => s.addNode);

  const handleAddNode = useCallback((type: string) => {
    const def = nodeRegistry[type];
    if (!def) return;

    const nodeCount = useCanvasStore.getState().nodes.length;
    const MAX_NODES = 300;
    if (nodeCount >= MAX_NODES) {
      console.warn(`[NodeSelectionMenu] Node limit reached (${MAX_NODES}). Node not added.`);
      return;
    }

    // Convert screen coordinates to flow/canvas coordinates
    const flowPosition = screenToFlowPosition({ x: menu.x, y: menu.y });

    const node = {
      id: `${type}-${Date.now()}`,
      type: def.type, // Use the actual node type from definition
      position: flowPosition,
      data: def.createDefaultData(),
    };
    addNode(node);
    setMenu({ visible: false, x: 0, y: 0 });
  }, [addNode, menu.x, menu.y, screenToFlowPosition]);

  // Handle right-click on canvas
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Only show if right-clicking on the canvas background (not on nodes)
      const target = e.target as HTMLElement;
      const isCanvasBackground = target.closest('.react-flow__pane') ||
        target.classList.contains('react-flow__pane') ||
        target.closest('.react-flow__background');

      if (isCanvasBackground) {
        e.preventDefault();
        setMenu({ visible: true, x: e.clientX, y: e.clientY });
      }
    };

    const handleClick = () => {
      setMenu({ visible: false, x: 0, y: 0 });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu({ visible: false, x: 0, y: 0 });
      }
    };

    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (!menu.visible) return null;

  return (
    <div
      className="fixed z-50"
      style={{
        left: menu.x,
        top: menu.y,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <GroupedNodeMenu onAddNode={handleAddNode} />
    </div>
  );
}



