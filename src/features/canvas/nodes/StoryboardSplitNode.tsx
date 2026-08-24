import { useState, useCallback, useEffect, useRef, memo } from "react";
import { type NodeProps, Handle, Position } from "@xyflow/react";
import { open as dialogOpen } from "@/features/canvas/compat/dialog";
import { NodeDeleteButton } from "./NodeDeleteButton";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useErrorStore } from "@/features/canvas/compat/ErrorDialog";
import { useToastStore } from "@/features/canvas/compat/Toast";
import {
  splitImageSource,
  readStoryboardImageMetadata,
  embedStoryboardImageMetadata,
  mergeStoryboardImages,
  saveImageToDownloads,
  copyImageSourceToClipboard,
  persistImageSource,
  prepareNodeImageSource,
} from "@/features/canvas/compat/commands";
import type {
  StoryboardSplitNodeData,
  StoryboardFrame,
} from "../domain/canvasNodes";
import { useCachedImage } from "../hooks/useCachedImage";
import { resolveImageDisplayUrl } from "../application/imageData";
import { ImageViewerModal } from "../ui/ImageViewerModal";
import { NodeResizeHandle } from "../ui/NodeResizeHandle";

/**
 * Storyboard Split Node — splits an image into a grid of frames.
 *
 * Features:
 * - Grid-based image splitting with configurable rows/cols
 * - Per-frame description editing (label + description + notes)
 * - Frame export (save/copy individual frames)
 * - Auto-read PNG metadata for rows/cols/frame descriptions
 * - Merge-back: reassemble split frames into a single image with metadata
 * - Line thickness configuration
 */
export const StoryboardSplitNode = memo(function StoryboardSplitNode({ data, id, selected }: NodeProps) {
  const nodeData = data as unknown as StoryboardSplitNodeData;
  const [rows, setRows] = useState(nodeData.rows || 2);
  const [cols, setCols] = useState(nodeData.cols || 3);
  const [isSplitting, setIsSplitting] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [lineThickness, setLineThickness] = useState(
    nodeData.lineThicknessPercent ?? 0.5
  );
  const [expandedFrame, setExpandedFrame] = useState<number | null>(null);
  const [viewerImages, setViewerImages] = useState<string[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);
  // Cached image for source display
  const { loaded: srcLoaded, displayUrl: srcDisplayUrl } = useCachedImage(nodeData.previewImageUrl || nodeData.imageUrl);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const showError = useErrorStore((s) => s.showError);
  const addToast = useToastStore((s) => s.addToast);

  /** Whether the image has been split into frames already */
  const hasFrames = nodeData.frames && nodeData.frames.length > 0;
  /** Whether we have a main image but haven't split yet (online split should be highlighted) */
  const canOnlineSplit = !!nodeData.imageUrl && !hasFrames;

  // Try to read PNG metadata for auto-fill
  useEffect(() => {
    if (!nodeData.imageUrl) return;
    // Only auto-read if we don't already have data
    if (nodeData.rows && nodeData.cols && nodeData.frames?.length) return;

    const tryReadMetadata = async () => {
      try {
        const source = nodeData.imageUrl as string;
        const metadata = await readStoryboardImageMetadata(source);
        if (metadata) {
          const m = metadata as { gridRows: number; gridCols: number; frameNotes: string[] };
          if (m.gridRows && m.gridCols) {
            setRows(m.gridRows);
            setCols(m.gridCols);

            // Restore frame descriptions from metadata
            const totalFrames = m.gridRows * m.gridCols;
            const existingFrames = nodeData.frames || [];
            const frames: StoryboardFrame[] = Array.from(
              { length: totalFrames },
              (_, i) => {
                const existing = existingFrames[i];
                return {
                  index: i,
                  label: existing?.label || `镜头${i + 1}`,
                  description:
                    existing?.description ||
                    (m.frameNotes?.[i] ? m.frameNotes[i] : ""),
                  notes: existing?.notes || "",
                  imageUrl: existing?.imageUrl || null,
                };
              }
            );

            updateNodeData(id, { rows: m.gridRows, cols: m.gridCols, frames });
          }
        }
      } catch {
        // Ignore metadata read failures
      }
    };
    tryReadMetadata();
  }, [nodeData.imageUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync from store (only depend on nodeData values, not local state — prevents infinite loop)
  useEffect(() => {
    if (nodeData.rows !== undefined && nodeData.rows !== rows)
      setRows(nodeData.rows);
    if (nodeData.cols !== undefined && nodeData.cols !== cols)
      setCols(nodeData.cols);
    if (nodeData.lineThicknessPercent !== undefined && nodeData.lineThicknessPercent !== lineThickness)
      setLineThickness(nodeData.lineThicknessPercent);
  }, [nodeData.rows, nodeData.cols, nodeData.lineThicknessPercent]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRowsChange = useCallback(
    (value: number) => {
      const r = Math.max(1, Math.min(10, value));
      setRows(r);
      updateNodeData(id, { rows: r });
    },
    [id, updateNodeData]
  );

  const handleColsChange = useCallback(
    (value: number) => {
      const c = Math.max(1, Math.min(10, value));
      setCols(c);
      updateNodeData(id, { cols: c });
    },
    [id, updateNodeData]
  );

  const handleLineThicknessChange = useCallback(
    (value: number) => {
      const v = Math.max(0, Math.min(5, value));
      setLineThickness(v);
      updateNodeData(id, { lineThicknessPercent: v });
    },
    [id, updateNodeData]
  );

  // Update a specific frame field
  const handleFrameFieldChange = useCallback(
    (frameIndex: number, field: "label" | "description" | "notes", value: string) => {
      const newFrames = [...(nodeData.frames || [])];
      while (newFrames.length < frameIndex + 1) {
        newFrames.push({
          index: newFrames.length,
          label: `镜头${newFrames.length + 1}`,
          description: "",
          notes: "",
          imageUrl: null,
        });
      }
      newFrames[frameIndex] = { ...newFrames[frameIndex], [field]: value };
      updateNodeData(id, { frames: newFrames });
    },
    [id, nodeData.frames, updateNodeData]
  );

  const handleSplit = useCallback(async () => {
    if (!nodeData.imageUrl) return;
    setIsSplitting(true);
    try {
      const source = nodeData.imageUrl as string;
      const frames = (await splitImageSource(source, rows, cols)) as string[];

      const storyFrames: StoryboardFrame[] = frames.map((path, index) => ({
        index,
        label: `镜头${index + 1}`,
        description: "",
        notes: "",
        imageUrl: path,
      }));
      updateNodeData(id, { frames: storyFrames });
    } catch (e) {
      showError(`拆分失败: ${e}`);

      // Fallback: try browser Canvas-based split
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = resolveImageDisplayUrl(nodeData.imageUrl as string);
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Image load failed"));
        });

        const tileW = img.naturalWidth / cols;
        const tileH = img.naturalHeight / rows;
        const storyFrames: StoryboardFrame[] = [];

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const canvas = document.createElement("canvas");
            canvas.width = tileW;
            canvas.height = tileH;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(
              img,
              c * tileW,
              r * tileH,
              tileW,
              tileH,
              0,
              0,
              tileW,
              tileH
            );
            // Persist canvas data URL to disk instead of storing raw data URL
            let frameUrl = canvas.toDataURL("image/png");
            try {
              const persistedPath = (await persistImageSource(frameUrl)) as string;
              frameUrl = persistedPath;
            } catch {
              // Keep data URL as fallback (will be large but at least not lost)
            }
            storyFrames.push({
              index: r * cols + c,
              label: `镜头${r * cols + c + 1}`,
              description: "",
              notes: "",
              imageUrl: frameUrl,
            });
          }
        }
        updateNodeData(id, { frames: storyFrames });
      } catch (e2) {
        showError(`Canvas 降级拆分也失败: ${e2}`);
      }
    } finally {
      setIsSplitting(false);
    }
  }, [id, nodeData.imageUrl, rows, cols, updateNodeData, showError]);

  // Merge frames back into a single image
  const handleMerge = useCallback(async () => {
    const frames = nodeData.frames || [];
    if (frames.length === 0) return;

    setIsMerging(true);
    try {
      // Collect frame image sources
      const sources = frames
        .map((f) => f.imageUrl)
        .filter((url): url is string => !!url);

      if (sources.length === 0) {
        showError("没有可合并的帧图片");
        return;
      }

      const result = (await mergeStoryboardImages({
        sources,
        rows,
        cols,
      })) as { path: string; width: number; height: number };

      // Embed metadata into the merged image
      const frameNotes = frames.map((f) => {
        const parts: string[] = [];
        if (f.label) parts.push(f.label);
        if (f.description) parts.push(f.description);
        if (f.notes) parts.push(f.notes);
        return parts.join(" | ");
      });

      const mergedPath = (await embedStoryboardImageMetadata(
        result.path,
        {
          gridRows: rows,
          gridCols: cols,
          frameNotes,
        }
      )) as string;

      updateNodeData(id, {
        imageUrl: mergedPath,
        imageWidth: result.width,
        imageHeight: result.height,
      });
    } catch (e) {
      showError(`合并失败: ${e}`);
    } finally {
      setIsMerging(false);
    }
  }, [id, nodeData.frames, rows, cols, updateNodeData, showError]);

  // Save individual frame
  const handleSaveFrame = useCallback(
    async (frame: StoryboardFrame) => {
      if (!frame.imageUrl) return;
      try {
        await saveImageToDownloads(
          frame.imageUrl,
          `frame_${frame.label || frame.index + 1}.png`
        );
        addToast("success", "已保存到下载目录");
      } catch (e) {
        showError(`保存帧失败: ${e}`);
      }
    },
    [showError, addToast]
  );

  // Copy individual frame
  const handleCopyFrame = useCallback(
    async (frame: StoryboardFrame) => {
      if (!frame.imageUrl) return;
      try {
        await copyImageSourceToClipboard(frame.imageUrl);
      } catch (e) {
        showError(`复制帧失败: ${e}`);
      }
    },
    [showError]
  );

  // Import local image file (Feature 4)
  const handleImportFile = useCallback(async () => {
    setIsImporting(true);
    try {
      const selected = await dialogOpen({
        multiple: false,
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "webp"],
          },
        ],
      });
      if (!selected) {
        setIsImporting(false);
        return;
      }
      // dialogOpen returns string | string[] | null depending on `multiple`
      const filePath = typeof selected === "string" ? selected : (selected as string[])[0];
      if (!filePath) {
        setIsImporting(false);
        return;
      }

      // Persist the image source
      const persistedPath = (await persistImageSource(filePath)) as string;

      // Prepare the node image (generate preview/thumbnail)
      const prepared = (await prepareNodeImageSource(persistedPath)) as {
        previewPath: string;
        width: number;
        height: number;
      };

      // Set as main image
      updateNodeData(id, {
        imageUrl: persistedPath,
        previewImageUrl: prepared.previewPath,
        imageWidth: prepared.width,
        imageHeight: prepared.height,
      });

      // Try to read storyboard metadata from the image
      try {
        const metadata = await readStoryboardImageMetadata(persistedPath);
        if (metadata) {
          const m = metadata as { gridRows: number; gridCols: number; frameNotes: string[] };
          if (m.gridRows && m.gridCols) {
            setRows(m.gridRows);
            setCols(m.gridCols);
            const totalFrames = m.gridRows * m.gridCols;
            const existingFrames = nodeData.frames || [];
            const frames: StoryboardFrame[] = Array.from(
              { length: totalFrames },
              (_, i) => {
                const existing = existingFrames[i];
                return {
                  index: i,
                  label: existing?.label || `镜头${i + 1}`,
                  description:
                    existing?.description ||
                    (m.frameNotes?.[i] ? m.frameNotes[i] : ""),
                  notes: existing?.notes || "",
                  imageUrl: existing?.imageUrl || null,
                };
              }
            );
            updateNodeData(id, { rows: m.gridRows, cols: m.gridCols, frames });
            addToast("success", `已导入图片并恢复 ${totalFrames} 帧分镜元数据`);
          } else {
            addToast("success", "已导入图片");
          }
        } else {
          addToast("success", "已导入图片");
        }
      } catch {
        addToast("success", "已导入图片");
      }
    } catch (e) {
      showError(`导入失败: ${e}`);
    } finally {
      setIsImporting(false);
    }
  }, [id, updateNodeData, showError, addToast, nodeData.frames]);

  const totalFrames = rows * cols;

  const nodeWidth = nodeData.width || 280;
  const nodeHeight = nodeData.height || 400;
  const handleResize = useCallback(
    (result: { width: number; height: number }) => {
      updateNodeData(id, { width: result.width, height: result.height });
    },
    [id, updateNodeData]
  );

  return (
    <>
    <NodeDeleteButton id={id} selected={selected ?? false} />
    <div style={{ position: 'relative' }}>
    <div className="bg-[var(--bg-node)] border border-[var(--border)] rounded-[var(--node-radius)] min-w-[280px] node-inner" style={{ width: nodeWidth, height: nodeHeight, boxSizing: 'border-box', boxShadow: "0 2px 12px rgba(0,0,0,.3)" }}>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="6" r="3"/>
            <circle cx="6" cy="18" r="3"/>
            <line x1="20" y1="4" x2="8.12" y2="15.88"/>
            <line x1="14.47" y1="14.48" x2="20" y2="20"/>
            <line x1="8.12" y1="8.12" x2="12" y2="12"/>
          </svg>
          <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "160px" }} title={nodeData.displayName || "分镜拆分"}>
            {nodeData.displayName || "分镜拆分"}
          </span>
        </div>
      </div>
      <div className="p-3 space-y-2">
        {/* Source image */}
        {nodeData.imageUrl ? (
          <img
            src={srcDisplayUrl}
            alt="source"
            className="w-full rounded object-contain max-h-[120px] cursor-zoom-in"
            draggable={false}
            loading="lazy"
            decoding="async"
            style={{ opacity: srcLoaded ? 1 : 0, transition: "opacity 0.15s ease" }}
            onDoubleClick={() => {
              setViewerImages([nodeData.imageUrl!]);
              setViewerIndex(0);
            }}
          />
        ) : (
          <div className="h-[80px] flex items-center justify-center text-[var(--text-secondary)] text-sm border-2 border-dashed border-[var(--border)] rounded">
            连接图片节点进行拆分
          </div>
        )}

        {/* Grid config */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[var(--text-secondary)]">行</span>
            <button
              onClick={() => handleRowsChange(rows - 1)}
              className="w-7 h-7 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded hover:bg-[var(--border)] nodrag flex items-center justify-center transition-colors"
              aria-label="减少行数"
            >
              −
            </button>
            <span className="text-xs w-4 text-center">{rows}</span>
            <button
              onClick={() => handleRowsChange(rows + 1)}
              className="w-7 h-7 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded hover:bg-[var(--border)] nodrag flex items-center justify-center transition-colors"
              aria-label="增加行数"
            >
              +
            </button>
          </div>
          <span className="text-[10px] text-[var(--text-secondary)]">×</span>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[var(--text-secondary)]">列</span>
            <button
              onClick={() => handleColsChange(cols - 1)}
              className="w-7 h-7 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded hover:bg-[var(--border)] nodrag flex items-center justify-center transition-colors"
              aria-label="减少列数"
            >
              −
            </button>
            <span className="text-xs w-4 text-center">{cols}</span>
            <button
              onClick={() => handleColsChange(cols + 1)}
              className="w-7 h-7 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded hover:bg-[var(--border)] nodrag flex items-center justify-center transition-colors"
              aria-label="增加列数"
            >
              +
            </button>
          </div>
          <span className="text-[10px] text-[var(--text-secondary)]">
            = {totalFrames} 帧
          </span>
        </div>

        {/* Line thickness */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--text-secondary)] min-w-[40px]">
            分割线
          </span>
          <input
            type="range"
            min={0}
            max={5}
            step={0.1}
            value={lineThickness}
            onChange={(e) => handleLineThicknessChange(Number(e.target.value))}
            className="flex-1 h-1 accent-[var(--accent)] nodrag"
          />
          <span className="text-[10px] text-[var(--text-secondary)] w-8">
            {lineThickness.toFixed(1)}%
          </span>
        </div>

        {/* Split / Merge / Import buttons */}
        <div className="flex gap-1.5">
          <button
            onClick={handleSplit}
            disabled={!nodeData.imageUrl || isSplitting}
            className="flex-1 py-1.5 text-xs bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors nodrag"
          >
            {isSplitting ? "拆分中..." : `拆分为 ${totalFrames} 帧`}
          </button>
          {/* Online Split button (Feature 2): highlighted when image exists but not yet split */}
          {canOnlineSplit && (
            <button
              onClick={handleSplit}
              disabled={isSplitting}
              className="py-1.5 px-2 text-xs bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors nodrag"
              title="在线分割：点击拆分图片为帧"
            >
              在线分割
            </button>
          )}
          {hasFrames && (
            <button
              onClick={handleMerge}
              disabled={isMerging}
              className="py-1.5 px-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] rounded hover:bg-[var(--border)] disabled:opacity-50 transition-colors nodrag"
              title="合并帧回单张图片（带元数据）"
            >
              {isMerging ? "合并中..." : "合并"}
            </button>
          )}
          {/* Import button (Feature 4) */}
          <button
            onClick={handleImportFile}
            disabled={isImporting}
            className="py-1.5 px-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] rounded hover:bg-[var(--border)] disabled:opacity-50 transition-colors nodrag"
            title="导入本地图片文件"
          >
            {isImporting ? "导入中..." : "导入"}
          </button>
        </div>

        {/* Frame previews with description editing */}
        {hasFrames && (
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
          >
            {nodeData.frames!.map((frame) => (
              <FrameCell
                key={frame.index}
                frame={frame}
                isExpanded={expandedFrame === frame.index}
                onToggleExpand={() =>
                  setExpandedFrame(
                    expandedFrame === frame.index ? null : frame.index
                  )
                }
                onFieldChange={handleFrameFieldChange}
                onSave={handleSaveFrame}
                onCopy={handleCopyFrame}
                onDoubleClick={() => {
                  // Collect all frame images that have URLs for browsing
                  const frameImages = nodeData.frames!
                    .filter((f) => f.imageUrl)
                    .map((f) => f.imageUrl!);
                  const idx = frameImages.indexOf(frame.imageUrl!);
                  setViewerImages(frameImages);
                  setViewerIndex(idx >= 0 ? idx : 0);
                }}
              />
            ))}
          </div>
        )}
      </div>
      {/* Fullscreen image viewer */}
      {viewerImages && (
        <ImageViewerModal
          images={viewerImages}
          initialIndex={viewerIndex}
          onClose={() => setViewerImages(null)}
        />
      )}
    </div>
    <NodeResizeHandle width={nodeWidth} height={nodeHeight} onResize={handleResize} minWidth={280} maxWidth={900} minHeight={300} maxHeight={1200} />
    </div>
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[var(--accent-secondary)] !w-6 !h-6 !border-2 !border-[var(--bg-node)]"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[var(--accent-secondary)] !w-6 !h-6 !border-2 !border-[var(--bg-node)]"
      />
    </>
  );
});

// ---------------------------------------------------------------------------
// AutoResizeTextarea — auto-resizing textarea that shows full content (Feature 5)
// ---------------------------------------------------------------------------

function AutoResizeTextarea({
  value,
  onChange,
  placeholder,
  className,
  style,
  maxLength,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  maxLength?: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize on mount and when value changes
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(32, Math.min(el.scrollHeight, 200))}px`;
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      style={style}
      maxLength={maxLength}
      rows={2}
    />
  );
}

// ---------------------------------------------------------------------------
// FrameCell — frame preview with description editing and actions
// ---------------------------------------------------------------------------

const FrameCell = memo(function FrameCell({
  frame,
  isExpanded,
  onToggleExpand,
  onFieldChange,
  onSave,
  onCopy,
  onDoubleClick,
}: {
  frame: StoryboardFrame;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onFieldChange: (index: number, field: "label" | "description" | "notes", value: string) => void;
  onSave: (frame: StoryboardFrame) => void;
  onCopy: (frame: StoryboardFrame) => void;
  onDoubleClick?: () => void;
}) {
  const { loaded: frameLoaded, displayUrl: frameDisplayUrl } = useCachedImage(frame.previewImageUrl || frame.imageUrl);
  return (
    <div
      className={`border border-[var(--border)] rounded overflow-hidden transition-all ${
        isExpanded ? "col-span-1" : ""
      }`}
    >
      {/* Frame image */}
      <div className="relative group">
        {frame.imageUrl ? (
          <img
            src={frameDisplayUrl}
            alt={`frame-${frame.index}`}
            className="w-full aspect-video object-cover cursor-zoom-in"
            draggable={false}
            loading="lazy"
            decoding="async"
            style={{ opacity: frameLoaded ? 1 : 0, transition: "opacity 0.15s ease" }}
            onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
          />
        ) : (
          <div className="w-full aspect-video bg-[var(--bg-secondary)] flex items-center justify-center text-[10px] text-[var(--text-secondary)]">
            {frame.index + 1}
          </div>
        )}

        {/* Frame number badge */}
        <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[8px] text-center py-0.5 flex items-center justify-between px-1">
          <span>{frame.label || frame.index + 1}</span>
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {frame.imageUrl && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); onCopy(frame); }}
                  className="hover:text-[var(--accent)] nodrag transition-colors"
                  title="复制帧"
                  style={{ padding: "2px", display: "flex", alignItems: "center" }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onSave(frame); }}
                  className="hover:text-[var(--accent)] nodrag transition-colors"
                  title="保存帧"
                  style={{ padding: "2px", display: "flex", alignItems: "center" }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Description area - click to expand (Feature 5: no truncation when expanded) */}
      <div
        onClick={onToggleExpand}
        className="px-1 py-0.5 text-[8px] text-[var(--text-secondary)] bg-[var(--bg-secondary)] cursor-pointer hover:bg-[var(--border)] transition-colors"
        style={{
          maxHeight: isExpanded ? undefined : '2.4em',
          overflow: isExpanded ? undefined : 'hidden',
          lineHeight: '1.2em',
          whiteSpace: isExpanded ? 'pre-wrap' : 'nowrap',
          wordBreak: 'break-all',
        }}
      >
        {frame.description || "点击编辑描述..."}
      </div>

      {/* Expanded editing area (Feature 5: auto-resize textarea for full content) */}
      {isExpanded && (
        <div className="p-1 space-y-1 bg-[var(--bg-secondary)] border-t border-[var(--border)]">
          <input
            type="text"
            value={frame.label || ""}
            onChange={(e) => onFieldChange(frame.index, "label", e.target.value)}
            placeholder="镜头号..."
            className="w-full px-1 py-0.5 text-[9px] nodrag unified-input"
            style={{
              borderRadius: '4px',
            }}
          />
          <AutoResizeTextarea
            value={frame.description}
            onChange={(v) => onFieldChange(frame.index, "description", v)}
            placeholder="帧描述..."
            maxLength={5000}
            className="w-full px-1 py-0.5 text-[9px] resize-none nodrag nowheel unified-input"
            style={{
              borderRadius: '6px',
            }}
          />
          <input
            type="text"
            value={frame.notes || ""}
            onChange={(e) => onFieldChange(frame.index, "notes", e.target.value)}
            placeholder="备注..."
            className="w-full px-1 py-0.5 text-[9px] nodrag unified-input"
            style={{
              borderRadius: '4px',
            }}
          />
        </div>
      )}
    </div>
  );
});


