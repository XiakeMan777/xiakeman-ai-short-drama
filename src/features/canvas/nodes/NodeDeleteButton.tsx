import { memo } from "react";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";

import type { ReactNode } from "react";

interface NodeDeleteButtonProps {
  id: string;
  selected: boolean;
  children?: ReactNode;
}

export const NodeDeleteButton = memo(function NodeDeleteButton({ id, selected, children }: NodeDeleteButtonProps) {
  const removeNode = useCanvasStore((s) => s.removeNode);

  return (
    <div
      className="nodrag node-delete-wrapper"
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: "8px",
        position: "absolute",
        top: "-38px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        cursor: "default",
        opacity: selected ? 1 : 0,
        pointerEvents: selected ? "auto" : "none",
        transition: "opacity 0.2s ease",
      }}
    >
      {children}
      <button
        onClick={() => removeNode(id)}
        className="nodrag"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 14px",
          borderRadius: "10px",
          backgroundColor: "var(--bg-node)",
          border: "1px solid var(--border)",
          color: "var(--text-primary)",
          fontSize: "12px",
          fontWeight: 500,
          cursor: "pointer",
          backdropFilter: "blur(8px)",
          transition: "all 0.2s ease",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
        }}
        onMouseEnter={(e) => {
          const target = e.currentTarget;
          target.style.backgroundColor = "rgba(220, 38, 38, 0.9)";
          target.style.color = "#fff";
        }}
        onMouseLeave={(e) => {
          const target = e.currentTarget;
          target.style.backgroundColor = "";
          target.style.color = "";
        }}
        title="删除节点"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
        <span>删除</span>
      </button>
    </div>
  );
});



