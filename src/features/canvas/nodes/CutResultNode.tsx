import { useState, useCallback, memo } from "react";
import { type NodeProps, Handle, Position } from "@xyflow/react";
import { NodeDeleteButton } from "./NodeDeleteButton";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useErrorStore } from "@/features/canvas/compat/ErrorDialog";
import { useToastStore } from "@/features/canvas/compat/Toast";
import type { CutResultNodeData, CutResultFrame } from "../domain/canvasNodes";
import { useCachedImage } from "../hooks/useCachedImage";
import { NodeResizeHandle } from "../ui/NodeResizeHandle";
import { saveImageToDownloads } from "@/features/canvas/compat/commands";

/**
 * Cut Result Node — displays extracted video frames in a grid layout.
 *
 * Features:
 * - Grid display of extracted frames with numbering
 * - Per-frame description editing
 * - Packaged download of all frames
 * - Merge storyboard button
 */
export const CutResultNode = memo(function CutResultNode({ data, id, selected }: NodeProps) {
  const nodeData = data as unknown as CutResultNodeData;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const showError = useErrorStore((s) => s.showError);
  const addToast = useToastStore((s) => s.addToast);
  const [isDownloading, setIsDownloading] = useState(false);

  const nodeWidth = nodeData.width || 400;
  const nodeHeight = nodeData.height || 400;
  const handleResize = useCallback(
    (result: { width: number; height: number }) => {
      updateNodeData(id, { width: result.width, height: result.height });
    },
    [id, updateNodeData]
  );

  const frames = nodeData.frames || [];
  const gridCols = nodeData.gridCols || 2;
  const gridRows = Math.ceil(frames.length / gridCols);

  const handleDescriptionChange = useCallback(
    (frameIndex: number, value: string) => {
      const newFrames = [...frames];
      newFrames[frameIndex] = { ...newFrames[frameIndex], description: value };
      updateNodeData(id, { frames: newFrames });
    },
    [id, frames, updateNodeData]
  );

  const handleDownloadAll = useCallback(async () => {
    if (frames.length === 0) return;
    setIsDownloading(true);
    try {
      let successCount = 0;
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        if (frame.imageUrl) {
          try {
            await saveImageToDownloads(
              frame.imageUrl,
              `frame_${i + 1}_${frame.timestamp.toFixed(1)}s.png`
            );
            successCount++;
          } catch {
            // Continue with next frame
          }
        }
      }
      addToast("success", `已下载 ${successCount}/${frames.length} 帧`);
    } catch (e) {
      showError(`打包下载失败: ${e}`);
    } finally {
      setIsDownloading(false);
    }
  }, [frames, addToast, showError]);

  const handleMergeStoryboard = useCallback(() => {
    addToast("info", "合并分镜功能开发中...");
  }, [addToast]);

  const containerStyle: React.CSSProperties = {
    width: nodeWidth,
    height: nodeHeight,
    backgroundColor: "var(--bg-node)",
    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
    borderRadius: "var(--node-radius)",
    boxShadow: selected
      ? "0 0 0 1px var(--accent), var(--shadow-float)"
      : "var(--shadow-card)",
    fontFamily: "system-ui, -apple-system, sans-serif",
  };

  return (
    <>
    <NodeDeleteButton id={id} selected={selected ?? false} />
    <div style={{ position: 'relative' }}>
    <div style={containerStyle} className="node-inner">
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="9" y1="21" x2="9" y2="9"/>
          </svg>
          <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            切割结果
          </span>
        </div>
      </div>

      {/* Grid */}
      {frames.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
            gap: "8px",
            padding: "12px",
          }}
        >
          {frames.map((frame, i) => (
            <CutResultFrameCard
              key={i}
              frame={frame}
              index={i}
              onDescriptionChange={handleDescriptionChange}
            />
          ))}
        </div>
      )}

      {frames.length === 0 && (
        <div style={{ padding: "32px", textAlign: "center", color: "var(--text-secondary)", fontSize: "13px" }}>
          暂无帧数据
        </div>
      )}

      {/* Footer controls */}
      {frames.length > 0 && (
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {/* Export settings label */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text-secondary)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span>导出设置</span>
            <span style={{ marginLeft: "auto", padding: "2px 8px", borderRadius: "4px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
              {gridRows}×{gridCols} · {frames.length} 格
            </span>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              className="nodrag"
              onClick={handleDownloadAll}
              disabled={isDownloading}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: "6px",
                backgroundColor: "var(--bg-secondary)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border)",
                fontSize: "12px",
                cursor: isDownloading ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                opacity: isDownloading ? 0.6 : 1,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              {isDownloading ? "下载中..." : "打包下载"}
            </button>
            <button
              className="nodrag"
              onClick={handleMergeStoryboard}
              disabled
              title="此功能正在开发中，暂不可用"
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: "6px",
                backgroundColor: "var(--bg-secondary)",
                color: "var(--text-muted)",
                border: "1px solid var(--border)",
                fontSize: "12px",
                cursor: "not-allowed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                opacity: 0.5,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10"/>
                <line x1="12" y1="20" x2="12" y2="4"/>
                <line x1="6" y1="20" x2="6" y2="14"/>
              </svg>
              合并分镜(开发中)
            </button>
          </div>
        </div>
      )}
    </div>
    <NodeResizeHandle width={nodeWidth} height={nodeHeight} onResize={handleResize} minWidth={400} maxWidth={900} minHeight={300} maxHeight={1200} />
    </div>
      <Handle type="target" position={Position.Left} style={{ background: "var(--accent-secondary)", width: 10, height: 10, border: "2px solid var(--bg-surface)" }} />
      <Handle type="source" position={Position.Right} style={{ background: "var(--accent-secondary)", width: 10, height: 10, border: "2px solid var(--bg-surface)" }} />
    </>
  );
});

/** Individual frame card within the cut result grid */
const CutResultFrameCard = memo(function CutResultFrameCard({
  frame,
  index,
  onDescriptionChange,
}: {
  frame: CutResultFrame;
  index: number;
  onDescriptionChange: (idx: number, val: string) => void;
}) {
  const { loaded, displayUrl } = useCachedImage(frame.previewImageUrl || frame.imageUrl);
  const padNum = (n: number) => String(n + 1).padStart(2, "0");

  return (
    <div
      style={{
        borderRadius: "8px",
        overflow: "hidden",
        backgroundColor: "var(--bg-primary)",
        border: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Image with number badge */}
      <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", overflow: "hidden" }}>
        {displayUrl ? (
          <img
            src={displayUrl}
            alt={`Frame ${index + 1}`}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: loaded ? 1 : 0, transition: "opacity 0.15s ease" }}
            loading="lazy"
          />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: "12px" }}>
            无图片
          </div>
        )}
        {/* Number badge */}
        <div
          style={{
            position: "absolute",
            top: "6px",
            left: "6px",
            width: "22px",
            height: "22px",
            borderRadius: "4px",
            backgroundColor: "var(--glass-bg)",
            color: "var(--text-primary)",
            fontSize: "11px",
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid var(--border)",
          }}
        >
          {padNum(index)}
        </div>
      </div>

      {/* Description input */}
      <input
        type="text"
        placeholder="填写分镜描述..."
        value={frame.description}
        onChange={(e) => onDescriptionChange(index, e.target.value)}
        maxLength={5000}
        className="unified-input nodrag"
        style={{
          width: "100%",
          padding: "8px 10px",
          borderRadius: '8px',
          fontSize: "12px",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
});



