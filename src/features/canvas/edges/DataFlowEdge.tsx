import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";

export function DataFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  animated: _animated,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.5,
  });

  // Combine ReactFlow's internal selected state with store-tracked selection
  // (box selection only marks nodes; edges between them are tracked in selectedEdgeIds)
  const selectedEdgeIds = useCanvasStore((s) => s.selectedEdgeIds);
  const isSelected = selected || selectedEdgeIds.includes(id);

  const arrowId = `arrow-${id}`;
  const glowId = `glow-${id}`;
  const haloId = `halo-${id}`;

  const lineColor = isSelected ? "#ffb84d" : "#ff8a3d";
  const shadowColor = isSelected ? "rgba(255, 184, 77, 0.5)" : "rgba(255, 138, 61, 0.35)";

  return (
    <>
      <defs>
        <marker
          id={arrowId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto"
        >
          <path
            d="M 0 1.2 L 8.2 5 L 0 8.8 z"
            fill={lineColor}
            style={{ transition: "fill 0.3s ease" }}
          />
        </marker>

        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id={haloId} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Wide invisible hit area — makes edge easy to click/select */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ cursor: "pointer" }}
      />

      <path
        d={edgePath}
        fill="none"
        stroke={shadowColor}
        strokeWidth={isSelected ? 12 : 9}
        strokeLinecap="round"
        opacity={isSelected ? 0.55 : 0.42}
        filter={`url(#${haloId})`}
        style={{ pointerEvents: "none" }}
      />

      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: lineColor,
          strokeWidth: isSelected ? 4.5 : 3.4,
          strokeLinecap: "round",
          opacity: isSelected ? 1 : 0.92,
          transition: "stroke 0.3s ease, stroke-width 0.3s ease, opacity 0.3s ease",
          filter: `drop-shadow(0 0 10px ${shadowColor})`,
        }}
      />

      <path
        d={edgePath}
        fill="none"
        stroke="rgba(255, 255, 255, 0.58)"
        strokeWidth={isSelected ? 1.5 : 1}
        strokeLinecap="round"
        strokeDasharray="10 12"
        opacity={isSelected ? 0.85 : 0.62}
        style={{ pointerEvents: "none" }}
      />

      {/* Arrow head (separate so it's not affected by dash) */}
      <path
        d={edgePath}
        fill="none"
        stroke="none"
        markerEnd={`url(#${arrowId})`}
        style={{ pointerEvents: "none" }}
      />

      {/* Traveling light dot — flows from source to target */}
      <circle r="4.2" fill={lineColor} filter={`url(#${glowId})`} opacity="0.95" style={{ pointerEvents: "none" }}>
        <animateMotion
          dur="2.5s"
          repeatCount="indefinite"
          path={edgePath}
        />
      </circle>

      {/* Second dot — offset for continuous flow feel */}
      <circle r="2.8" fill="#fff7d6" opacity="0.72" style={{ pointerEvents: "none" }}>
        <animateMotion
          dur="2.5s"
          repeatCount="indefinite"
          path={edgePath}
          begin="1.25s"
        />
      </circle>

      {/* Selected midpoint label */}
      <EdgeLabelRenderer>
        {isSelected && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            className="text-[10px] bg-[var(--bg-surface)] text-[#ffb84d] px-2 py-0.5 rounded-full border border-[#ffb84d] shadow-sm"
          >
            →
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}



