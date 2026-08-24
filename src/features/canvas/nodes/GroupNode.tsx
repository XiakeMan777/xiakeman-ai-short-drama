import { type NodeProps } from "@xyflow/react";
import { memo, useMemo, useCallback } from "react";
import { NodeDeleteButton } from "./NodeDeleteButton";
import { NodeResizeHandle } from "../ui/NodeResizeHandle";
import type { GroupNodeData } from "../domain/canvasNodes";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";

export const GroupNode = memo(function GroupNode({ data, id, selected }: NodeProps) {
  const nodeData = data as unknown as GroupNodeData;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  // Only subscribe to childNodeIds — read node details via getState() to avoid re-renders
  const childNodeIds = nodeData.childNodeIds;

  const nodeWidth = nodeData.width || 300;
  const nodeHeight = nodeData.height || 400;
  const handleResize = useCallback(
    (result: { width: number; height: number }) => {
      updateNodeData(id, { width: result.width, height: result.height });
    },
    [id, updateNodeData]
  );

  const childNames = useMemo(() => {
    const nodes = useCanvasStore.getState().nodes;
    return nodes
      .filter((n) => childNodeIds?.includes(n.id))
      .map((n) => {
        const d = n.data as Record<string, unknown>;
        return String(d.displayName || n.type || "节点");
      });
  }, [childNodeIds]);

  return (
    <>
    <NodeDeleteButton id={id} selected={selected ?? false} />
    <div style={{ position: 'relative' }}>
    <div className="bg-[var(--bg-node)] border-2 border-[var(--border)] border-dashed rounded-[var(--node-radius)] min-w-[300px] min-h-[200px] opacity-80 node-inner" style={{ width: nodeWidth, height: nodeHeight, boxSizing: 'border-box', boxShadow: "0 2px 12px rgba(0,0,0,.3)" }}>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
          <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "160px" }} title={nodeData.displayName || "分组"}>
            {nodeData.displayName || "分组"}
          </span>
        </div>
      </div>
      <div className="p-3 space-y-2">
        {childNodeIds && childNodeIds.length > 0 ? (
          <div className="space-y-1">
            <div className="text-xs text-[var(--text-secondary)]">
              包含 {childNodeIds?.length || 0} 个节点:
            </div>
            <div className="flex flex-wrap gap-1">
              {childNames.map((name, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 text-[10px] bg-[var(--bg-secondary)] rounded border border-[var(--border)]"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-xs text-[var(--text-secondary)] text-center py-4">
            选中多个节点后右键创建分组
          </div>
        )}
      </div>
    </div>
    <NodeResizeHandle width={nodeWidth} height={nodeHeight} onResize={handleResize} minWidth={300} maxWidth={900} minHeight={300} maxHeight={1200} />
    </div>
    </>
  );
});



