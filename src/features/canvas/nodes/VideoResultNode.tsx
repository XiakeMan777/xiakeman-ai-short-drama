import { memo, useState, useCallback } from "react";
import { type NodeProps, Handle, Position } from "@xyflow/react";
import type { VideoResultNodeData } from "../domain/canvasNodes";
import { CANVAS_NODE_TYPES } from "../domain/canvasNodes";
import { nodeRegistry } from "../domain/nodeRegistry";
import { resolveImageDisplayUrl } from "../application/imageData";
import { NodeDeleteButton } from "./NodeDeleteButton";
import { NodeResizeHandle } from "../ui/NodeResizeHandle";
import { saveImageToDownloads, removeVideoWatermark, removeVideoSubtitles, upscaleVideo } from "@/features/canvas/compat/commands";
import { useToastStore } from "@/features/canvas/compat/Toast";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { usePrompt } from "@/features/canvas/compat/PromptDialog";

export const VideoResultNode = memo(function VideoResultNode({ data, id, selected }: NodeProps & { data: VideoResultNodeData }) {
  const nodeData = data;
  const isGenerating = nodeData.isGenerating || false;
  const progressPercent = nodeData.progressPercent || 0;
  const hasVideo = !!nodeData.videoUrl;
  const hasError = !!nodeData.error;
  const addToast = useToastStore((s) => s.addToast);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const addNode = useCanvasStore((s) => s.addNode);
  const addEdge = useCanvasStore((s) => s.addEdge);
  const nodes = useCanvasStore((s) => s.nodes);
  const [isSaving, setIsSaving] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const showPrompt = usePrompt();

  const nodeWidth = nodeData.width || 520;
  const nodeHeight = nodeData.height || 400;
  const handleResize = useCallback(
    (result: { width: number; height: number }) => {
      updateNodeData(id, { width: result.width, height: result.height });
    },
    [id, updateNodeData]
  );

  // Convert "16:9" → "16/9" for CSS aspect-ratio property
  const videoAspectRatio = (nodeData.aspectRatio || "16:9").replace(":", "/");

  // Dynamic height based on aspect ratio (width is fixed at 520px)
  const aspectHeight = (() => {
    const ar = nodeData.aspectRatio || "16:9";
    const [w, h] = ar.split(":").map(Number);
    if (w && h) {
      return Math.round(520 * h / w);
    }
    return 293;
  })();

  const handleSaveToLocal = useCallback(async () => {
    if (!nodeData.videoUrl) return;
    setIsSaving(true);
    try {
      // Derive correct extension from videoUrl or displayName
      const rawName = nodeData.displayName || "";
      const hasValidExt = /\.(mp4|webm|mov|avi|mkv)$/i.test(rawName);
      const fileName = hasValidExt
        ? rawName
        : rawName
          ? `${rawName.replace(/\.[^.]+$/, "")}.mp4`
          : `video_${Date.now()}.mp4`;
      await saveImageToDownloads(String(nodeData.videoUrl), fileName);
      addToast("success", `已保存到本地: ${fileName}`);
    } catch (e) {
      addToast("error", `保存失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [nodeData.videoUrl, nodeData.displayName, addToast]);

  // Create a new video result node to the right with the processed video
  const createProcessedResultNode = useCallback((videoUrl: string, label: string) => {
    const thisNode = nodes.find((n) => n.id === id);
    const resultNodeId = `video-result-${crypto.randomUUID()}`;
    const resultX = (thisNode?.position?.x ?? 0) + 560;
    const resultY = (thisNode?.position?.y ?? 0);
    const resultData = nodeRegistry[CANVAS_NODE_TYPES.videoResult]?.createDefaultData() || { displayName: label, isGenerating: false, progressPercent: 0, videoUrl: null, error: null };
    addNode({ id: resultNodeId, type: CANVAS_NODE_TYPES.videoResult, position: { x: resultX, y: resultY }, data: { ...resultData, displayName: label, isGenerating: false, progressPercent: 0, videoUrl, aspectRatio: nodeData.aspectRatio || "16:9" } });
    addEdge({ id: `e-${id}-${resultNodeId}`, source: id, target: resultNodeId, type: "dataFlow" });
  }, [id, nodes, nodeData.aspectRatio, addNode, addEdge]);

  const handleRemoveWatermark = useCallback(async () => {
    if (!nodeData.videoUrl) return;
    const result = await showPrompt({
      title: "去水印 — 设置区域",
      fields: [
        { key: "x", label: "水印区域左上角 X 坐标", defaultValue: "400" },
        { key: "y", label: "水印区域左上角 Y 坐标", defaultValue: "680" },
        { key: "w", label: "水印区域宽度", defaultValue: "120" },
        { key: "h", label: "水印区域高度", defaultValue: "40" },
      ],
      confirmLabel: "开始去水印",
    });
    if (!result) return;
    const { x, y, w, h } = result;
    if (!x || !y || !w || !h) return;
    setProcessing("watermark");
    try {
      const outputPath = await removeVideoWatermark(String(nodeData.videoUrl), Number(x), Number(y), Number(w), Number(h));
      createProcessedResultNode(outputPath, `${nodeData.displayName || "视频"}_去水印`);
      addToast("success", "去水印完成");
    } catch (e) {
      addToast("error", `去水印失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setProcessing(null);
    }
  }, [nodeData.videoUrl, nodeData.displayName, addToast, createProcessedResultNode, showPrompt]);

  const handleRemoveSubtitles = useCallback(async () => {
    if (!nodeData.videoUrl) return;
    const result = await showPrompt({
      title: "去字幕 — 设置区域",
      fields: [
        { key: "cropHeight", label: "底部字幕区域高度（像素）", defaultValue: "60" },
      ],
      confirmLabel: "开始去字幕",
    });
    if (!result) return;
    const { cropHeight } = result;
    if (!cropHeight) return;
    setProcessing("subtitles");
    try {
      const outputPath = await removeVideoSubtitles(String(nodeData.videoUrl), Number(cropHeight));
      createProcessedResultNode(outputPath, `${nodeData.displayName || "视频"}_去字幕`);
      addToast("success", "去字幕完成");
    } catch (e) {
      addToast("error", `去字幕失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setProcessing(null);
    }
  }, [nodeData.videoUrl, nodeData.displayName, addToast, createProcessedResultNode, showPrompt]);

  const handleUpscale = useCallback(async () => {
    if (!nodeData.videoUrl) return;
    const result = await showPrompt({
      title: "视频超分 — 设置目标宽度",
      fields: [
        { key: "targetWidth", label: "目标宽度（像素）", defaultValue: "1920" },
      ],
      confirmLabel: "开始超分",
    });
    if (!result) return;
    const { targetWidth } = result;
    if (!targetWidth) return;
    setProcessing("upscale");
    try {
      const outputPath = await upscaleVideo(String(nodeData.videoUrl), Number(targetWidth));
      createProcessedResultNode(outputPath, `${nodeData.displayName || "视频"}_超分`);
      addToast("success", "视频超分完成");
    } catch (e) {
      addToast("error", `超分失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setProcessing(null);
    }
  }, [nodeData.videoUrl, nodeData.displayName, addToast, createProcessedResultNode, showPrompt]);

  return (
    <>
    <NodeDeleteButton id={id} selected={selected ?? false} />
    <div style={{ position: 'relative' }}>
    <div
      className="node-inner"
      style={{
        width: nodeWidth,
        height: nodeHeight,
        minHeight: `${aspectHeight}px`,
        backgroundColor: "var(--bg-node)",
        border: "1px solid var(--border)",
        borderRadius: "var(--node-radius)",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 2px 12px rgba(0,0,0,.3)",
        boxSizing: "border-box",
        /* overflow controlled by CSS: hidden by default, visible when popup is open */
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between"
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--text-secondary)" stroke="none">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "160px" }} title={nodeData.displayName || "视频结果"}>
            {nodeData.displayName || "视频结果"}
          </span>
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          padding: "8px",
          minHeight: hasVideo ? "auto" : "60px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Generating progress - compact */}
        {isGenerating && (
          <div className="flex items-center gap-2" style={{ padding: "4px 0" }}>
            <div
              className="animate-spin"
              style={{
                width: "14px",
                height: "14px",
                border: "2px solid var(--border)",
                borderTopColor: "var(--accent)",
                borderRadius: "50%",
              }}
            />
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              {(() => {
                const startedAt = (nodeData as any).generationStartedAt;
                const hasBeenLong = startedAt && Date.now() - startedAt > 3 * 60 * 1000;
                if (hasBeenLong) return `排队中${progressPercent > 0 ? ` ${Math.min(progressPercent, 100)}%` : "..."}`;
                return `生成中${progressPercent > 0 ? ` ${Math.min(progressPercent, 100)}%` : "..."}`;
              })()}
            </span>
          </div>
        )}

        {/* Video result */}
        {!isGenerating && hasVideo && (
          <div style={{ width: "100%", position: "relative" }} className="group">
            <div
              style={{
                width: "100%",
                aspectRatio: videoAspectRatio,
                backgroundColor: "var(--bg-primary)",
                borderRadius: "8px",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <video
                src={resolveImageDisplayUrl(String(nodeData.videoUrl))}
                poster={nodeData.imageUrl ? resolveImageDisplayUrl(String(nodeData.imageUrl)) : undefined}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
                controls
              />
            </div>
            {/* Action buttons — appears on hover */}
            <div
              className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              style={{ zIndex: 10 }}
            >
              <button
                onClick={(e) => { e.stopPropagation(); handleRemoveWatermark(); }}
                disabled={!!processing}
                className="nodrag flex items-center gap-1"
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(0,0,0,0.65)',
                  color: '#fff',
                  fontSize: '12px',
                  border: 'none',
                  cursor: processing ? 'wait' : 'pointer',
                  backdropFilter: 'blur(4px)',
                }}
                title="去水印"
              >
                {processing === "watermark" ? "处理中..." : "去水印"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleRemoveSubtitles(); }}
                disabled={!!processing}
                className="nodrag flex items-center gap-1"
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(0,0,0,0.65)',
                  color: '#fff',
                  fontSize: '12px',
                  border: 'none',
                  cursor: processing ? 'wait' : 'pointer',
                  backdropFilter: 'blur(4px)',
                }}
                title="去字幕"
              >
                {processing === "subtitles" ? "处理中..." : "去字幕"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleUpscale(); }}
                disabled={!!processing}
                className="nodrag flex items-center gap-1"
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(0,0,0,0.65)',
                  color: '#fff',
                  fontSize: '12px',
                  border: 'none',
                  cursor: processing ? 'wait' : 'pointer',
                  backdropFilter: 'blur(4px)',
                }}
                title="视频超分"
              >
                {processing === "upscale" ? "处理中..." : "超分"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleSaveToLocal(); }}
                disabled={isSaving}
                className="nodrag flex items-center gap-1"
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(0,0,0,0.65)',
                  color: '#fff',
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
                {isSaving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        )}

        {/* Error state */}
        {!isGenerating && !hasVideo && hasError && (
          <div className="flex flex-col items-center" style={{ padding: "20px 0" }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            <p style={{ marginTop: "10px", fontSize: "12px", color: "var(--text-secondary)", textAlign: "center" }}>
              {String(nodeData.error)}
            </p>
            {/* 恢复轮询按钮：错误可能是网络中断导致的，点击可重新连接源节点的轮询 */}
            {String(nodeData.error).includes("轮询") && (
              <button
                onClick={() => {
                  // 找到源节点并触发恢复
                  const edge = useCanvasStore.getState().edges.find(e => e.target === id);
                  if (edge) {
                    const sourceNode = useCanvasStore.getState().nodes.find(n => n.id === edge.source);
                    if (sourceNode?.data?.generationJobId) {
                      // 短暂切换 isGenerating 来触发 resume 轮询重新挂载
                      useCanvasStore.getState().updateNodeData(edge.source, { isGenerating: false });
                      setTimeout(() => {
                        useCanvasStore.getState().updateNodeData(edge.source, { isGenerating: true });
                        useCanvasStore.getState().updateNodeData(id, { error: null, isGenerating: true });
                      }, 200);
                    }
                  }
                }}
                className="nodrag"
                style={{
                  marginTop: "12px",
                  padding: "6px 16px",
                  borderRadius: "6px",
                  backgroundColor: "rgba(59, 130, 246, 0.15)",
                  border: "1px solid rgba(59, 130, 246, 0.3)",
                  color: "rgb(96, 165, 250)",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline", marginRight: "4px", verticalAlign: "middle" }}>
                  <polyline points="23 4 23 10 17 10"/>
                  <polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
                重试连接任务
              </button>
            )}
          </div>
        )}

        {/* Empty state */}
        {!isGenerating && !hasVideo && !hasError && (
          <div className="flex flex-col items-center" style={{ padding: "20px 0" }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="var(--text-muted)" stroke="none">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            <p style={{ marginTop: "10px", fontSize: "12px", color: "var(--text-muted)" }}>
              等待生成...
            </p>
          </div>
        )}
      </div>
    </div>
    <NodeResizeHandle width={nodeWidth} height={nodeHeight} onResize={handleResize} minWidth={520} maxWidth={900} minHeight={300} maxHeight={1200} />
    </div>
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[var(--accent-secondary)] !w-5 !h-5 !border-2 !border-[var(--bg-node)]"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[var(--accent-secondary)] !w-5 !h-5 !border-2 !border-[var(--bg-node)]"
      />
    </>
  );
});



