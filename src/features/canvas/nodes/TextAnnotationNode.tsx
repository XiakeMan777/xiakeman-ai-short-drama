import { useState, useCallback, memo, useRef, useEffect } from "react";
import { type NodeProps, Handle, Position } from "@xyflow/react";
import { NodeDeleteButton } from "./NodeDeleteButton";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import type { TextAnnotationNodeData } from "../domain/canvasNodes";

export const TextAnnotationNode = memo(function TextAnnotationNode({ data, id, selected }: NodeProps) {
  const nodeData = data as unknown as TextAnnotationNodeData;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const [text, setText] = useState(nodeData.text || "");
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync from store
  useEffect(() => {
    if (nodeData.text !== undefined && nodeData.text !== text) {
      setText(nodeData.text);
    }
  }, [nodeData.text]);

  const handleSave = useCallback(() => {
    updateNodeData(id, { text });
    setIsEditing(false);
  }, [id, text, updateNodeData]);

  const handleDoubleClick = useCallback(() => {
    setIsEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setText(nodeData.text || "");
        setIsEditing(false);
      }
      if (e.ctrlKey && e.key === "Enter") {
        handleSave();
      }
    },
    [handleSave, nodeData.text]
  );

  const displayName = nodeData.displayName || "文字标注";

  return (
    <div
      style={{
        minWidth: 180,
        minHeight: 60,
        backgroundColor: "var(--bg-surface)",
        borderRadius: "8px",
        border: selected ? "2px solid var(--accent)" : "1px solid var(--border)",
        boxShadow: selected ? "0 0 0 1px var(--accent)" : "0 1px 4px rgba(0,0,0,0.2)",
        overflow: "hidden",
      }}
    >
      {/* Title bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 10px",
          backgroundColor: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border)",
          cursor: "grab",
        }}
        className="drag-handle"
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
          📝 {displayName}
        </span>
        <NodeDeleteButton id={id} selected={selected ?? false} />
      </div>

      {/* Content area */}
      <div
        style={{ padding: "8px 10px", cursor: isEditing ? "text" : "pointer", minHeight: 24 }}
        onDoubleClick={handleDoubleClick}
        className="nodrag"
      >
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            placeholder="输入文本注释…"
            rows={4}
            style={{
              width: "100%",
              minWidth: 160,
              border: "1px solid var(--accent)",
              borderRadius: "4px",
              padding: "6px 8px",
              fontSize: nodeData.fontSize || 14,
              fontFamily: "inherit",
              color: "var(--text-primary)",
              backgroundColor: "var(--bg-primary)",
              resize: "vertical",
              outline: "none",
            }}
          />
        ) : (
          <div
            style={{
              fontSize: nodeData.fontSize || 14,
              color: text ? "var(--text-primary)" : "var(--text-muted)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              lineHeight: 1.5,
              minHeight: 20,
            }}
          >
            {text || "双击编辑文本…"}
          </div>
        )}
      </div>

      {/* Handles */}
      <Handle type="target" position={Position.Left} style={{ background: "var(--accent)", width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ background: "var(--accent)", width: 8, height: 8 }} />
    </div>
  );
});



