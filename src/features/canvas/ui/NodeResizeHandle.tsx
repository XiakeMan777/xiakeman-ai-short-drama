// ---------------------------------------------------------------------------
// NodeResizeHandle — bottom-right corner drag handle for node resizing
// ---------------------------------------------------------------------------
//
// Sits outside the node at bottom-right corner.  Drag diagonally to resize
// both width and height simultaneously.
//
// Usage:
//   <NodeResizeHandle
//     width={nodeWidth}
//     height={nodeHeight}
//     onResize={({ width, height }) => updateNodeData(id, { width, height })}
//     minWidth={360}
//     maxWidth={900}
//     minHeight={200}
//     maxHeight={800}
//   />
// ---------------------------------------------------------------------------

import { useCallback, useRef, useEffect } from "react";

export interface ResizeResult {
  width: number;
  height: number;
}

interface NodeResizeHandleProps {
  /** Current node width in px */
  width: number;
  /** Current node height in px (optional — if omitted, only width is resized) */
  height?: number;
  /** Called continuously during drag with the new dimensions */
  onResize: (result: ResizeResult) => void;
  /** Minimum allowed width (default 360) */
  minWidth?: number;
  /** Maximum allowed width (default 900) */
  maxWidth?: number;
  /** Minimum allowed height (default 200) */
  minHeight?: number;
  /** Maximum allowed height (default 800) */
  maxHeight?: number;
  /** Handle size in px (default 18) */
  size?: number;
  /** Offset from node edge — positions handle outside the node (default 6) */
  offset?: number;
}

export function NodeResizeHandle({
  width,
  height,
  onResize,
  minWidth = 520,
  maxWidth = 900,
  minHeight = 300,
  maxHeight = 1200,
  size = 18,
  offset = 6,
}: NodeResizeHandleProps) {
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startWidthRef = useRef(0);
  const startHeightRef = useRef(0);
  const draggingRef = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = true;
      startXRef.current = e.clientX;
      startYRef.current = e.clientY;
      startWidthRef.current = width;
      startHeightRef.current = height ?? 0;
    },
    [width, height]
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const deltaX = e.clientX - startXRef.current;
      const deltaY = e.clientY - startYRef.current;
      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidthRef.current + deltaX));
      const newHeight = Math.max(minHeight, Math.min(maxHeight, startHeightRef.current + deltaY));
      onResize({ width: newWidth, height: newHeight });
    };

    const onMouseUp = () => {
      draggingRef.current = false;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [onResize, minWidth, maxWidth, minHeight, maxHeight]);

  return (
    <div
      className="nodrag"
      onMouseDown={onMouseDown}
      style={{
        position: "absolute",
        bottom: -offset,
        right: -offset,
        width: size,
        height: size,
        cursor: "nwse-resize",
        zIndex: 20,
        // Right-angle corner indicator — draws ┘ shape using borders
        borderRight: "2px solid var(--text-muted)",
        borderBottom: "2px solid var(--text-muted)",
        borderRadius: "0 0 6px 0",
        opacity: 0.35,
        transition: "opacity 0.15s, border-color 0.15s",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.opacity = "0.8";
        el.style.borderColor = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        if (!draggingRef.current) {
          const el = e.currentTarget as HTMLElement;
          el.style.opacity = "0.35";
          el.style.borderColor = "var(--text-muted)";
        }
      }}
    />
  );
}



