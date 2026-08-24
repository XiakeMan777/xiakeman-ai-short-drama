import { useState, useCallback, useEffect, useRef, memo } from "react";
import { createPortal } from "react-dom";
import { type NodeProps, Handle, Position } from "@xyflow/react";
import { NodeDeleteButton } from "./NodeDeleteButton";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useErrorStore } from "@/features/canvas/compat/ErrorDialog";
import type { UploadImageNodeData } from "../domain/canvasNodes";
import { CANVAS_NODE_TYPES } from "../domain/canvasNodes";
import {
  prepareNodeImageFromFile,
  extractImageFromClipboardEvent,
} from "../application/imageData";
import { useCachedImage } from "../hooks/useCachedImage";
import { ImageViewerModal } from "../ui/ImageViewerModal";
import { ImageEditorDialog } from "../ui/ImageEditorDialog";
import { NodeResizeHandle } from "../ui/NodeResizeHandle";
import { saveImageToDownloads, splitImageSource } from "@/features/canvas/compat/commands";
import { useToastStore } from "@/features/canvas/compat/Toast";
import { resolveImageDisplayUrl } from "../application/imageData";

/**
 * Upload Node — supports drag-drop, file dialog, and clipboard paste.
 * Uses a three-tier strategy for image preparation:
 *   1. Tauri path mode (if file.path available)
 *   2. Tauri binary mode (read as ArrayBuffer → persist)
 *   3. DataURL fallback
 *
 * Stores both imageUrl (original, persisted path) and previewImageUrl
 * (base64 data URL for fast rendering at low zoom).
 */
export const UploadNode = memo(function UploadNode({ data, id, selected }: NodeProps) {
  const nodeData = data as unknown as UploadImageNodeData;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const showError = useErrorStore((s) => s.showError);
  const addToast = useToastStore((s) => s.addToast);
  const [isUploading, setIsUploading] = useState(false);
  const [tempPreviewUrl, setTempPreviewUrl] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showSplitDialog, setShowSplitDialog] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [splitRows, setSplitRows] = useState(2);
  const [splitCols, setSplitCols] = useState(2);
  const [splitLineThickness, setSplitLineThickness] = useState(0.0);
  const [isSplitting, setIsSplitting] = useState(false);
  const perfRef = useRef<{ start: number; tauriDone?: number; urlSet?: number } | null>(null);

  const handleResize = useCallback(
    (result: { width: number; height: number }) => {
      updateNodeData(id, { width: result.width, height: result.height });
    },
    [id, updateNodeData]
  );

  // For AI-generated output nodes: always show the original imageUrl directly.
  // This ensures the image appears immediately when generation completes,
  // Always prefer imageUrl (original image) for instant display.
  // previewImageUrl (thumbnail) is only used as fallback when imageUrl is unavailable.
  const imageSource = tempPreviewUrl
    ? tempPreviewUrl
    : nodeData.imageUrl
      ? nodeData.imageUrl
      : nodeData.previewImageUrl
        ? nodeData.previewImageUrl
        : "";

  // useCachedImage: resolves URL + preloads into global HTMLImageElement cache
  const { loaded, displayUrl } = useCachedImage(imageSource);

  // Listen for clipboard paste events (from Canvas level)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const imageFile = extractImageFromClipboardEvent(e);
      if (imageFile) {
        e.preventDefault();
        processFile(imageFile);
      }
    };

    // Listen on document level for paste events targeting this node
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [id]);

  /**
   * Process an uploaded file: persist to local storage and generate preview.
   */
  const processFile = useCallback(
    async (file: File) => {
      setIsUploading(true);
      perfRef.current = { start: Date.now() };

      try {
        // Optimistic preview: show blob URL in local state only (NOT in node data)
        // This prevents blob URLs from being auto-saved to SQLite
        const tempUrl = URL.createObjectURL(file);
        setTempPreviewUrl(tempUrl);

        // Persist via Tauri backend
        const result = await prepareNodeImageFromFile(file);

        // Clear temp preview before setting persisted data
        setTempPreviewUrl(null);
        URL.revokeObjectURL(tempUrl);

        if (result) {
          perfRef.current!.tauriDone = Date.now();

          updateNodeData(id, {
            imageUrl: result.path,
            previewImageUrl: result.previewPath,
            sourceFileName: file.name,
            imageWidth: result.width,
            imageHeight: result.height,
          });

          perfRef.current!.urlSet = Date.now();

          // Performance log (debug)
          const elapsed = Date.now() - perfRef.current!.start;
          if (elapsed > 1000) {
            console.warn(
              `[UploadNode] Slow upload: ${elapsed}ms (Tauri: ${perfRef.current!.tauriDone! - perfRef.current!.start}ms)`,
              file.name
            );
          }
        } else {
          // Fallback: use data URL (safe for persistence, unlike blob URL)
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
          setTempPreviewUrl(null);
          updateNodeData(id, {
            imageUrl: dataUrl,
            previewImageUrl: dataUrl,
            sourceFileName: file.name,
          });
        }
      } catch (e) {
        showError(`上传失败: ${e}`);
        setTempPreviewUrl(null);
        updateNodeData(id, {
          imageUrl: null,
          previewImageUrl: null,
          sourceFileName: null,
        });
      } finally {
        setIsUploading(false);
        perfRef.current = null;
      }
    },
    [id, updateNodeData, showError]
  );

  const handleUpload = useCallback(async () => {
    if (!window.__TAURI__) {
      // Web fallback: use file input
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = () => {
        if (input.files?.[0]) processFile(input.files[0]);
      };
      input.click();
      return;
    }

    try {
      const { open } = await import("@/features/canvas/compat/dialog");
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tiff", "avif"],
          },
        ],
      });
      if (selected) {
        const filePath = selected as string;
        const fileName = filePath.split(/[/\\]/).pop() || "image.png";

        // For Tauri dialog, we use the path directly
        setIsUploading(true);
        perfRef.current = { start: Date.now() };

        try {
          const { prepareNodeImageSource } = await import("@/features/canvas/compat/commands");
          const result = await prepareNodeImageSource(filePath);

          if (result) {
            updateNodeData(id, {
              imageUrl: (result as { path: string; previewPath: string; width: number; height: number }).path,
              previewImageUrl: (result as { path: string; previewPath: string; width: number; height: number }).previewPath,
              sourceFileName: fileName,
              imageWidth: (result as { path: string; previewPath: string; width: number; height: number }).width,
              imageHeight: (result as { path: string; previewPath: string; width: number; height: number }).height,
            });
          }
        } catch (e) {
          showError(`上传失败: ${e}`);
        } finally {
          setIsUploading(false);
          perfRef.current = null;
        }
      }
    } catch (e) {
      showError(`文件对话框打开失败: ${e}`);
    }
  }, [id, updateNodeData, showError, processFile]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        processFile(files[0]);
      }
    },
    [processFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  // Save image to user's computer (downloads / desktop)
  const handleSaveToLocal = useCallback(async () => {
    const sourceUrl = nodeData.imageUrl || nodeData.previewImageUrl;
    if (!sourceUrl) return;
    setIsSaving(true);
    try {
      const fileName = nodeData.sourceFileName || nodeData.displayName || `image_${Date.now()}.png`;
      await saveImageToDownloads(sourceUrl, fileName);
      addToast("success", `已保存到本地: ${fileName}`);
    } catch (e) {
      showError(`保存失败: ${e}`);
    } finally {
      setIsSaving(false);
    }
  }, [nodeData.imageUrl, nodeData.previewImageUrl, nodeData.sourceFileName, nodeData.displayName, showError, addToast]);

  // Generation progress — shows elapsed time only, NO fake percentage bar.
  // No matter how long grsai takes (45s, 100s, 300s...), the spinner keeps
  // animating and the timer keeps counting. No "stuck at X%" ever again.
  const genProgress = (() => {
    if (!nodeData.isGenerating || !nodeData.generationStartedAt) return { elapsed: "0s" };
    const elapsed = Date.now() - nodeData.generationStartedAt;
    const secs = Math.floor(elapsed / 1000);
    if (secs < 60) return { elapsed: `${secs}s` };
    const min = Math.floor(secs / 60);
    const rem = secs % 60;
    return { elapsed: `${min}m${rem}s` };
  })();

  // When the job actually succeeds (isGenerating turns false with an imageUrl),
  // the progress display is replaced by the image itself, so the 99% cap is fine.
  // The transition from 99% → showing image happens instantly via isGenerating state change.

  // Dynamic height based on actual image dimensions, then aspectRatio, then default 16:9
  const nodeWidth = nodeData.width || 520;
  const nodeHeight = nodeData.height || 400;

  // Calculate the ideal height for the image to fill width without letterboxing
  let imageIdealHeight: number | undefined;
  if (nodeData.imageWidth && nodeData.imageHeight && nodeData.imageWidth > 0 && nodeData.imageHeight > 0) {
    const headerH = 44; // header height (padding 12*2 + font 14 + border)
    imageIdealHeight = Math.round(nodeWidth * nodeData.imageHeight / nodeData.imageWidth) + headerH;
  }

  // Use image-fitted height if no user-set height, otherwise use nodeHeight
  const effectiveHeight = nodeData.height ? nodeHeight : (imageIdealHeight || nodeHeight);

  const hasImage = !!(nodeData.imageUrl || nodeData.previewImageUrl);

  // Handle split dialog apply
  const handleSplitApply = useCallback(async () => {
    const sourceUrl = nodeData.imageUrl || nodeData.previewImageUrl;
    if (!sourceUrl) return;
    setIsSplitting(true);
    try {
      const frames = (await splitImageSource(sourceUrl, splitRows, splitCols, splitLineThickness)) as string[];
      const { addNode, addEdge, nodes } = useCanvasStore.getState();
      const currentNode = nodes.find((n) => n.id === id);
      const baseX = currentNode ? currentNode.position.x : 0;
      const baseY = currentNode ? currentNode.position.y : 0;
      const nodeWidth = 280;
      const nodeHeight = 220;
      const gapX = 40;
      const gapY = 40;
      const perRow = 2; // 2 nodes per row

      for (let i = 0; i < frames.length; i++) {
        const col = i % perRow;
        const row = Math.floor(i / perRow);
        const uploadNodeId = `upload-${Date.now()}-${i}`;
        const uploadNode = {
          id: uploadNodeId,
          type: CANVAS_NODE_TYPES.upload,
          position: {
            x: baseX + 600 + col * (nodeWidth + gapX),
            y: baseY + row * (nodeHeight + gapY),
          },
          data: {
            imageUrl: frames[i],
            previewImageUrl: null,
            aspectRatio: nodeData.aspectRatio || "1:1",
            isSizeManuallyAdjusted: false,
            displayName: `分割图 ${i + 1}`,
          } as UploadImageNodeData,
        };
        addNode(uploadNode);
        addEdge({
          id: `edge-${id}-${uploadNodeId}`,
          source: id,
          target: uploadNodeId,
          type: "dataFlow",
        });
      }
      addToast("success", `已生成 ${frames.length} 个分割图片节点`);
      setShowSplitDialog(false);
    } catch (e) {
      showError(`分割失败: ${e}`);
    } finally {
      setIsSplitting(false);
    }
  }, [nodeData.imageUrl, nodeData.previewImageUrl, nodeData.aspectRatio, nodeData.model, nodeData.provider, splitRows, splitCols, id, showError, addToast]);

  return (
    <>
    <NodeDeleteButton id={id} selected={selected ?? false}>
      <button
        onClick={() => { if (hasImage) setShowSplitDialog(true); }}
        className="nodrag"
        style={{
          padding: '6px 14px',
          borderRadius: '10px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          color: hasImage ? 'var(--text-primary)' : 'var(--text-muted)',
          fontSize: '12px',
          fontWeight: 500,
          cursor: hasImage ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          backdropFilter: 'blur(8px)',
          transition: 'all 0.2s ease',
          boxShadow: 'var(--shadow-card)',
        }}
        onMouseEnter={(e) => {
          if (!hasImage) return;
          const target = e.currentTarget;
          target.style.backgroundColor = 'var(--accent-btn)';
          target.style.color = 'var(--text-primary)';
        }}
        onMouseLeave={(e) => {
          const target = e.currentTarget;
          target.style.backgroundColor = 'var(--bg-surface)';
          target.style.color = hasImage ? 'var(--text-primary)' : 'var(--text-muted)';
        }}
        title={hasImage ? "分割图片" : "上传图片后可分割"}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <line x1="12" y1="3" x2="12" y2="21"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
        </svg>
        <span>分割</span>
      </button>
      <button
        onClick={() => { if (hasImage) setShowEditor(true); }}
        className="nodrag"
        style={{
          padding: '6px 14px', borderRadius: '10px', backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border)', color: hasImage ? 'var(--text-primary)' : 'var(--text-muted)',
          fontSize: '12px', fontWeight: 500, cursor: hasImage ? 'pointer' : 'not-allowed',
          display: 'flex', alignItems: 'center', gap: '6px', backdropFilter: 'blur(8px)',
          transition: 'all 0.2s ease', boxShadow: 'var(--shadow-card)',
        }}
        onMouseEnter={(e) => { if (!hasImage) return; e.currentTarget.style.backgroundColor = 'var(--accent-btn)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-surface)'; e.currentTarget.style.color = hasImage ? 'var(--text-primary)' : 'var(--text-muted)'; }}
        title={hasImage ? "编辑图片（画笔/文字）" : "上传图片后可编辑"}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
        </svg>
        <span>编辑</span>
      </button>
    </NodeDeleteButton>
    <div style={{ position: 'relative' }}>
    <div className="bg-[var(--bg-node)] border rounded-[var(--node-radius)] overflow-hidden node-inner" style={{ width: nodeWidth, height: effectiveHeight, overflow: 'hidden', display: 'flex', flexDirection: 'column', borderColor: isDragOver ? 'var(--accent)' : 'var(--border)', borderWidth: isDragOver ? '2px' : '1px', transition: 'border-color 0.2s, border-width 0.2s', boxSizing: 'border-box', boxShadow: "0 2px 12px rgba(0,0,0,.3)" }}>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "200px" }} title={nodeData.sourceFileName || nodeData.displayName || "上传图片"}>
            {nodeData.sourceFileName || nodeData.displayName || "上传图片"}
          </span>
        </div>
      </div>
      <div
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
      >
        {/* Drag overlay */}
        {isDragOver && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 50,
              borderRadius: "var(--node-radius)",
              backgroundColor: "var(--accent-dim)",
              backdropFilter: "blur(2px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div style={{
              padding: "16px 28px",
              borderRadius: "12px",
              backgroundColor: "var(--glass-bg)",
              color: "var(--text-primary)",
              fontSize: "14px",
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              松开以上传图片
            </div>
          </div>
        )}
        {nodeData.isGenerating ? (
          <div className="flex flex-col items-center justify-center" style={{ flex: 1, padding: '24px 0' }}>
            <div className="animate-spin" style={{
              width: '28px',
              height: '28px',
              border: '3px solid var(--border)',
              borderTopColor: 'var(--accent)',
              borderRadius: '50%'
            }} />
            <p style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              正在生成图片... {genProgress.elapsed}
            </p>
          </div>
        ) : nodeData.generationError ? (
          <div className="flex flex-col items-center justify-center" style={{ flex: 1, padding: '24px 0' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            <p style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-secondary)', textAlign: 'center', maxWidth: '200px' }}>
              {nodeData.generationError}
            </p>
          </div>
        ) : nodeData.imageUrl || nodeData.previewImageUrl ? (
          <div
            className="relative group"
            style={{ flex: 1, width: '100%', height: '100%', overflow: 'hidden', cursor: 'zoom-in' }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (nodeData.imageUrl || nodeData.previewImageUrl) setViewerOpen(true);
            }}
          >
            <img
              src={displayUrl}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => {
                console.error("[UploadNode] Image load error for:", displayUrl?.slice(0, 120));
                // If it's an HTTP URL that failed, try to persist it via backend as fallback
                const src = nodeData.imageUrl || nodeData.previewImageUrl || '';
                if (src.startsWith("http://") || src.startsWith("https://")) {
                  import("@/features/canvas/compat/commands").then(({ persistImageSource }) => {
                    persistImageSource(src).then((persisted) => {
                      if (persisted && persisted !== src) {
                        console.log("[UploadNode] Persisted HTTP URL fallback:", persisted);
                        updateNodeData(id, { imageUrl: persisted });
                      }
                    }).catch(console.error);
                  }).catch(console.error);
                }
              }}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                opacity: loaded ? 1 : 0.6,
                transition: 'opacity 0.3s ease',
              }}
              onDoubleClick={() => {
                if (nodeData.imageUrl || nodeData.previewImageUrl) setViewerOpen(true);
              }}
            />
            {/* Hover action bar */}
            <div
              className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              style={{ zIndex: 10 }}
            >
              <button
                onClick={(e) => { e.stopPropagation(); handleSaveToLocal(); }}
                disabled={isSaving}
                className="nodrag flex items-center gap-1"
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  backgroundColor: 'var(--glass-bg)',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                  border: 'none',
                  cursor: isSaving ? 'wait' : 'pointer',
                  backdropFilter: 'blur(4px)',
                }}
                title="保存到本地"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                {isSaving ? "保存中..." : "保存到本地"}
              </button>
            </div>
            {isUploading && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-[2px]">
                <div className="flex flex-col items-center gap-2">
                  <div className="animate-spin" style={{
                    width: '24px',
                    height: '24px',
                    border: '2.5px solid var(--border)',
                    borderTopColor: 'var(--text-primary)',
                    borderRadius: '50%'
                  }} />
                  <span className="text-white text-xs">上传中...</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            className="flex flex-col items-center justify-center gap-3 cursor-pointer"
            style={{
              flex: 1,
              minHeight: '180px',
              border: '1.5px dashed var(--border)',
              borderRadius: '10px',
              transition: 'all 0.25s ease',
            }}
            onClick={handleUpload}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              el.style.borderColor = 'var(--accent)';
              el.style.borderStyle = 'solid';
              el.style.backgroundColor = 'var(--accent-muted)';
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget;
              el.style.borderColor = 'var(--border)';
              el.style.borderStyle = 'dashed';
              el.style.backgroundColor = 'transparent';
            }}
          >
            {isUploading ? (
              <>
                <div className="animate-spin" style={{
                  width: '24px',
                  height: '24px',
                  border: '2.5px solid var(--border)',
                  borderTopColor: 'var(--accent)',
                  borderRadius: '50%'
                }} />
                <span className="text-sm text-[var(--text-secondary)]">上传中...</span>
              </>
            ) : (
              <>
                {/* Icon circle */}
                <div
                  className="flex items-center justify-center"
                  style={{
                width: '56px',
                height: '56px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, var(--accent-muted) 0%, transparent 100%)',
                    border: '1px solid var(--accent-muted)',
                  }}
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <span className="text-base font-medium text-[var(--text-secondary)]">点击上传图片</span>
                  <span className="text-xs text-[var(--text-muted)]">拖拽或 Ctrl+V 粘贴</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {/* Fullscreen image viewer */}
      {viewerOpen && (nodeData.imageUrl || nodeData.previewImageUrl) && (
        <ImageViewerModal
          images={[nodeData.imageUrl || nodeData.previewImageUrl!]}
          onClose={() => setViewerOpen(false)}
        />
      )}

      {/* Split Dialog - rendered via portal to body to avoid node overflow clipping */}
      {showSplitDialog && createPortal(
        <div
          className="nodrag"
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'var(--glass-bg)',
            zIndex: 999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setShowSplitDialog(false)}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderRadius: '12px',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-float)',
              width: '680px',
              maxWidth: '90vw',
              maxHeight: '90vh',
              display: 'grid',
              gridTemplateRows: 'auto 1fr auto',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>切割工具</span>
              <button
                onClick={() => setShowSplitDialog(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '18px',
                  padding: '4px',
                }}
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div style={{ display: 'flex', overflow: 'auto', minHeight: 0 }}>
              {/* Left: Preview */}
              <div style={{ flex: 1, padding: '16px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>原图 + 切割预览</div>
                {(nodeData.imageUrl || nodeData.previewImageUrl) && (
                  <div style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                    <img
                      src={resolveImageDisplayUrl(nodeData.previewImageUrl || nodeData.imageUrl!)}
                      alt="preview"
                      loading="lazy"
                      decoding="async"
                      style={{ width: '100%', display: 'block' }}
                    />
                    {/* Grid overlay */}
                    <div
                      style={{
                        position: 'absolute',
                        top: 0, left: 0, right: 0, bottom: 0,
                        display: 'grid',
                        gridTemplateColumns: `repeat(${splitCols}, 1fr)`,
                        gridTemplateRows: `repeat(${splitRows}, 1fr)`,
                        pointerEvents: 'none',
                        gap: `${splitLineThickness}%`,
                      }}
                    >
                      {Array.from({ length: splitRows * splitCols }).map((_, i) => (
                        <div
                          key={i}
                          style={{
                            border: '1px solid var(--error)',
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '8px', height: '8px', backgroundColor: 'var(--error)', borderRadius: '2px', display: 'inline-block' }} />
                  红色区域为切割时会丢弃的分割线像素
                </div>
              </div>

              {/* Right: Params */}
              <div
                style={{
                  width: '240px',
                  padding: '16px',
                  borderLeft: '1px solid var(--border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                  overflow: 'auto',
                  minHeight: 0,
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>切割参数</div>

                {/* Rows */}
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>行数</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      onClick={() => setSplitRows(Math.max(1, splitRows - 1))}
                      style={{
                        width: '28px', height: '28px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                        backgroundColor: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                    >-</button>
                    <input
                      type="number"
                      value={splitRows}
                      onChange={(e) => setSplitRows(Math.max(1, Math.min(10, Number(e.target.value))))}
                      style={{
                        flex: 1,
                        height: '28px',
                        textAlign: 'center',
                        backgroundColor: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                      }}
                    />
                    <button
                      onClick={() => setSplitRows(Math.min(10, splitRows + 1))}
                      style={{
                        width: '28px', height: '28px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                        backgroundColor: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                    >+</button>
                  </div>
                </div>

                {/* Cols */}
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>列数</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      onClick={() => setSplitCols(Math.max(1, splitCols - 1))}
                      style={{
                        width: '28px', height: '28px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                        backgroundColor: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                    >-</button>
                    <input
                      type="number"
                      value={splitCols}
                      onChange={(e) => setSplitCols(Math.max(1, Math.min(10, Number(e.target.value))))}
                      style={{
                        flex: 1,
                        height: '28px',
                        textAlign: 'center',
                        backgroundColor: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                      }}
                    />
                    <button
                      onClick={() => setSplitCols(Math.min(10, splitCols + 1))}
                      style={{
                        width: '28px', height: '28px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                        backgroundColor: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                    >+</button>
                  </div>
                </div>

                {/* Line thickness */}
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                    <span>分割线粗细</span>
                    <span>{splitLineThickness.toFixed(1)}% ({Math.max(1, Math.round(splitLineThickness * 10))}px)</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.1}
                    value={splitLineThickness}
                    onChange={(e) => setSplitLineThickness(Number(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--accent)' }}
                  />
                </div>

                {/* Stats */}
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>输出小格数量</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{splitRows * splitCols}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                padding: '12px 20px',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
              }}
            >
              <button
                onClick={() => setShowSplitDialog(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                onClick={handleSplitApply}
                disabled={isSplitting}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: 'var(--accent-btn)',
                  color: '#fff',
                  fontSize: '13px',
                  cursor: isSplitting ? 'wait' : 'pointer',
                  opacity: isSplitting ? 0.7 : 1,
                }}
              >
                {isSplitting ? '切割中...' : '确定'}
              </button>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
    <NodeResizeHandle width={nodeWidth} height={effectiveHeight} onResize={handleResize} minWidth={520} maxWidth={900} minHeight={300} maxHeight={1200} />
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
      {/* Image Editor Dialog */}
      {showEditor && (nodeData.imageUrl || nodeData.previewImageUrl) && (
        <ImageEditorDialog
          imageUrl={resolveImageDisplayUrl(nodeData.imageUrl || nodeData.previewImageUrl!)}
          onSave={(editedUrl) => {
            updateNodeData(id, { imageUrl: editedUrl, previewImageUrl: editedUrl });
            setShowEditor(false);
          }}
          onClose={() => setShowEditor(false)}
        />
      )}
    </>
  );
});



