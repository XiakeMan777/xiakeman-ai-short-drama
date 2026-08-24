import { useState, useCallback, useMemo, useRef, useEffect, memo } from "react";
import { type NodeProps, Handle, Position, type Node } from "@xyflow/react";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useToastStore } from "@/features/canvas/compat/Toast";
import { NodeDeleteButton } from "./NodeDeleteButton";
import { useErrorStore } from "@/features/canvas/compat/ErrorDialog";
import { useConfirm } from "@/features/canvas/compat/ConfirmDialog";
import type { VideoFrameNodeData } from "../domain/canvasNodes";
import { CANVAS_NODE_TYPES } from "../domain/canvasNodes";
import { prepareNodeImageSource, persistVideoBinary, persistVideoSource } from "@/features/canvas/compat/commands";
import { open } from "@/features/canvas/compat/dialog";
import { resolveImageDisplayUrl } from "../application/imageData";
import { useUpstreamNodes } from "../hooks/useUpstreamNodes";
import { NodeResizeHandle } from "../ui/NodeResizeHandle";

export const VideoFrameNode = memo(function VideoFrameNode({ data, id, selected }: NodeProps) {
  const nodeData = data as unknown as VideoFrameNodeData;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const addToast = useToastStore((s) => s.addToast);
  const showError = useErrorStore((s) => s.showError);
  const showConfirm = useConfirm();

  const [frameCount, setFrameCount] = useState(nodeData.frameCount || 4);
  const [outputWidth, setOutputWidth] = useState(nodeData.outputWidth || 1280);
  const [extractionMode, setExtractionMode] = useState<"uniform" | "smart">(
    nodeData.extractionMode || "uniform"
  );
  const [isExtracting, setIsExtracting] = useState(nodeData.isExtracting || false);
  const [isImporting, setIsImporting] = useState(false);
  const [isExportingFrame, setIsExportingFrame] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Blob URL for Canvas frame capture (avoids CORS tainted canvas)
  const blobVideoUrlRef = useRef<string | null>(null);

  const nodeWidth = nodeData.width || 520;
  const nodeHeight = nodeData.height || 550;
  const handleResize = useCallback(
    (result: { width: number; height: number }) => {
      updateNodeData(id, { width: result.width, height: result.height });
    },
    [id, updateNodeData]
  );

  const hasVideo = !!nodeData.videoPath;

  const videoSrc = useMemo(() => {
    if (!nodeData.videoPath) return null;
    // Use cached resolveImageDisplayUrl to avoid regenerating asset URLs
    return resolveImageDisplayUrl(nodeData.videoPath);
  }, [nodeData.videoPath]);

  // Load video as Blob URL for Canvas capture (no CORS issues)
  useEffect(() => {
    if (!nodeData.videoPath) {
      blobVideoUrlRef.current = null;
      return;
    }
    let cancelled = false;
    const loadBlob = async () => {
      try {
        const assetUrl = resolveImageDisplayUrl(nodeData.videoPath!);
        const resp = await fetch(assetUrl);
        if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
        const blob = await resp.blob();
        if (!cancelled) {
          // Revoke old blob URL
          if (blobVideoUrlRef.current) URL.revokeObjectURL(blobVideoUrlRef.current);
          blobVideoUrlRef.current = URL.createObjectURL(blob);
        }
      } catch (e) {
        console.warn("[VideoFrameNode] failed to create blob URL for canvas capture:", e);
        // Fallback: will try asset URL directly
        blobVideoUrlRef.current = null;
      }
    };
    loadBlob();
    return () => {
      cancelled = true;
      // Revoke blob URL on unmount to prevent memory leak
      if (blobVideoUrlRef.current) {
        URL.revokeObjectURL(blobVideoUrlRef.current);
        blobVideoUrlRef.current = null;
      }
    };
  }, [nodeData.videoPath]);

  // Auto-detect video from upstream connected nodes (videoNode, videoResultNode)
  const { incomingEdges, upstreamNodes } = useUpstreamNodes(id);

  // Build a dependency string that changes when any upstream node's videoUrl/videoPath changes
  const upstreamVideoKey = useMemo(() => {
    return incomingEdges
      .map((e) => {
        const src = upstreamNodes.find((n) => n.id === e.source);
        if (!src) return "";
        const d = src.data as Record<string, unknown>;
        return `${e.source}:${d.videoUrl || d.videoPath || ""}`;
      })
      .join("|");
  }, [incomingEdges, upstreamNodes]);

  useEffect(() => {
    // Find all edges where this node is the target
    if (incomingEdges.length === 0) return;
    // If already has a video, don't override
    if (nodeData.videoPath) return;

    for (const edge of incomingEdges) {
      const sourceNode = upstreamNodes.find((n) => n.id === edge.source);
      if (!sourceNode) continue;
      const sourceData = sourceNode.data as Record<string, unknown>;
      // videoNode has videoUrl; videoResultNode has videoUrl; videoFrameNode has videoPath
      const videoUrl = (sourceData.videoUrl as string) || (sourceData.videoPath as string) || null;
      if (videoUrl) {
        // If it's a remote URL, persist it first
        if (videoUrl.startsWith("http://") || videoUrl.startsWith("https://")) {
          persistVideoSource(videoUrl).then((localPath) => {
            updateNodeData(id, {
              videoPath: localPath,
              sourceFileName: `来自 ${sourceData.displayName || "上游节点"}`,
            });
            addToast("success", "已从上游节点导入视频");
          }).catch((e) => {
            console.error("Failed to persist upstream video URL:", e);
          });
        } else {
          updateNodeData(id, {
            videoPath: videoUrl,
            sourceFileName: `来自 ${sourceData.displayName || "上游节点"}`,
          });
          addToast("success", "已从上游节点导入视频");
        }
        break; // Only use the first source with a video
      }
    }
  }, [incomingEdges, upstreamNodes, id, nodeData.videoPath, updateNodeData, addToast, upstreamVideoKey]);

  // Sync local state from nodeData
  useEffect(() => {
    if (nodeData.frameCount !== frameCount) setFrameCount(nodeData.frameCount || 4);
    if (nodeData.outputWidth !== outputWidth) setOutputWidth(nodeData.outputWidth || 1280);
    if (nodeData.extractionMode !== extractionMode) setExtractionMode(nodeData.extractionMode || "uniform");
  }, [nodeData.frameCount, nodeData.outputWidth, nodeData.extractionMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleImportVideo = useCallback(async () => {
    try {
      setIsImporting(true);
      // Open file dialog to select a video file
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Video Files",
            extensions: ["mp4", "avi", "mov", "mkv", "webm", "flv", "wmv"],
          },
        ],
      });

      if (selected) {
        const filePath = selected as string;
        const fileName = filePath.split(/[\\/]/).pop() || "video";
        updateNodeData(id, {
          videoPath: filePath,
          sourceFileName: fileName,
        });
        addToast("success", `已导入: ${fileName}`);
      }
    } catch (e) {
      console.error("Failed to import video:", e);
      showError(`导入视频失败: ${e}`);
    } finally {
      setIsImporting(false);
    }
  }, [id, updateNodeData, addToast, showError]);

  // ── Drag & Drop handlers for video import ──
  const VIDEO_EXTENSIONS = ["mp4", "avi", "mov", "mkv", "webm", "flv", "wmv"];

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const name = files[0].name.toLowerCase();
      if (VIDEO_EXTENSIONS.some((ext) => name.endsWith(`.${ext}`))) {
        setIsDragOver(true);
      }
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    const file = files[0];
    const name = file.name.toLowerCase();
    if (!VIDEO_EXTENSIONS.some((ext) => name.endsWith(`.${ext}`))) {
      addToast("warning", "请拖入视频文件（mp4/avi/mov/mkv/webm/flv/wmv）");
      return;
    }

    setIsImporting(true);
    try {
      // Try Tauri's File.path extension (available on native file drops)
      const filePath = (file as any).path as string | undefined;
      if (filePath) {
        const fileName = filePath.split(/[/\\]/).pop() || file.name;
        updateNodeData(id, {
          videoPath: filePath,
          sourceFileName: fileName,
        });
        addToast("success", `已导入: ${fileName}`);
      } else {
        // Fallback: persist video via binary transfer
        const arrayBuffer = await file.arrayBuffer();
        const bytes = Array.from(new Uint8Array(arrayBuffer));
        const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";

        const persistedPath = await persistVideoBinary(bytes, ext);
        updateNodeData(id, {
          videoPath: String(persistedPath),
          sourceFileName: file.name,
        });
        addToast("success", `已导入: ${file.name}`);
      }
    } catch (e) {
      console.error("Failed to import dropped video:", e);
      showError(`导入视频失败: ${e}`);
    } finally {
      setIsImporting(false);
    }
  }, [id, updateNodeData, addToast, showError]);

  const handleExtractFrames = useCallback(async () => {
    if (!nodeData.videoPath) return;

    setIsExtracting(true);
    updateNodeData(id, { isExtracting: true });

    try {
      // 进度只 log 不弹 toast，避免 toast 风暴
      console.log(`[VideoFrameNode] 开始提取 ${frameCount} 帧...`);

      // Create a hidden video element with Blob URL (avoids CORS tainted canvas)
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.preload = "auto";
      video.muted = true;

      // Use Blob URL if available, fallback to asset URL
      const src = blobVideoUrlRef.current || resolveImageDisplayUrl(nodeData.videoPath);
      video.src = src;

      // Wait for metadata loaded
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("视频加载失败"));
        video.load();
      });

      const duration = video.duration;
      if (!duration || duration <= 0) {
        throw new Error("无法获取视频时长");
      }

      let timestamps: number[] = [];

      if (extractionMode === "uniform") {
        // Uniform: evenly spaced at midpoint of each segment
        for (let i = 0; i < frameCount; i++) {
          timestamps.push((duration / frameCount) * (i + 0.5));
        }
      } else {
        // Smart: sample densely, compute frame differences, pick top-N key frames
        console.log("[VideoFrameNode] 智能分析中，正在检测镜头变化...");

        const sampleCount = Math.min(Math.max(frameCount * 10, 30), Math.max(30, Math.floor(duration * 3)));
        const sampleInterval = duration / sampleCount;

        interface Sample { time: number; data: Uint8ClampedArray }
        const samples: Sample[] = [];

        // Helper: seek video to a specific time and wait for frame ready
        const seekTo = (time: number) =>
          new Promise<void>((resolve) => {
            let settled = false;
            const done = () => {
              if (settled) return;
              settled = true;
              video.removeEventListener("seeked", onSeeked);
              clearTimeout(fallback);
              resolve();
            };
            const onSeeked = () => done();
            video.addEventListener("seeked", onSeeked);
            video.currentTime = Math.min(time, duration - 0.05);
            const fallback = setTimeout(done, 1500); // fallback timeout
          });

        // Phase 1: dense sampling with small thumbnails for diff analysis
        const thumbW = 160;
        const thumbH = 90;
        const thumbCanvas = document.createElement("canvas");
        thumbCanvas.width = thumbW;
        thumbCanvas.height = thumbH;
        const thumbCtx = thumbCanvas.getContext("2d")!;

        for (let i = 0; i < sampleCount; i++) {
          const t = Math.min(i * sampleInterval, duration - 0.05);
          await seekTo(t);
          await new Promise((r) => setTimeout(r, 80));

          thumbCtx.drawImage(video, 0, 0, thumbW, thumbH);
          const imageData = thumbCtx.getImageData(0, 0, thumbW, thumbH).data;
          samples.push({ time: t, data: imageData });

          if (i % 5 === 0) {
            console.log(`[VideoFrameNode] 智能分析中 ${Math.round(((i + 1) / sampleCount) * 100)}%...`);
          }
        }

        // Phase 2: compute frame-to-frame differences
        const diffs: { index: number; score: number; time: number }[] = [];
        for (let i = 1; i < samples.length; i++) {
          const prev = samples[i - 1].data;
          const curr = samples[i].data;
          let diffSum = 0;
          const pixelCount = prev.length / 4;
          // Sample every 4th pixel for speed (still ~3600 pixels for 160x90)
          for (let p = 0; p < prev.length; p += 16) {
            diffSum += Math.abs(prev[p] - curr[p]);
            diffSum += Math.abs(prev[p + 1] - curr[p + 1]);
            diffSum += Math.abs(prev[p + 2] - curr[p + 2]);
          }
          const score = diffSum / (pixelCount * 3 * 255 / 4); // normalized 0-1
          diffs.push({ index: i, score, time: samples[i].time });
        }

        // Phase 3: pick top-N most different frames with minimum spacing to avoid clustering
        diffs.sort((a, b) => b.score - a.score);

        const minGap = duration / (frameCount * 2); // avoid frames too close together
        const selected: { time: number; score: number }[] = [];

        for (const d of diffs) {
          if (selected.length >= frameCount) break;
          // Check minimum distance from already selected frames
          const tooClose = selected.some((s) => Math.abs(s.time - d.time) < minGap);
          if (!tooClose) {
            selected.push({ time: d.time, score: d.score });
          }
        }

        // If we couldn't find enough diverse frames, fill with evenly spaced ones
        if (selected.length < frameCount) {
          const needed = frameCount - selected.length;
          for (let i = 0; i < needed; i++) {
            const t = (duration / (needed + 1)) * (i + 1);
            const tooClose = selected.some((s) => Math.abs(s.time - t) < minGap);
            if (!tooClose) {
              selected.push({ time: t, score: 0 });
            }
          }
        }

        // Sort by time for consistent display order
        selected.sort((a, b) => a.time - b.time);
        timestamps = selected.map((s) => s.time);

        console.log("[SmartExtraction] selected timestamps:", timestamps, "scores:", selected.map((s) => s.score.toFixed(3)));
      }

      // Capture full-resolution frames at selected timestamps
      const framePaths: string[] = [];
      const previewPaths: string[] = [];
      const timestampSecs: number[] = [];

      for (let i = 0; i < timestamps.length; i++) {
        const targetTime = Math.min(timestamps[i], duration - 0.05);

        // Seek to target time
        video.currentTime = targetTime;
        await new Promise<void>((resolve) => {
          const onSeeked = () => {
            video.removeEventListener("seeked", onSeeked);
            resolve();
          };
          video.addEventListener("seeked", onSeeked);
          setTimeout(resolve, 2000);
        });

        await new Promise((r) => setTimeout(r, 100));

        // Full-resolution capture
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 1920;
        canvas.height = video.videoHeight || 1080;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL("image/png");
        const result = await prepareNodeImageSource(dataUrl);

        framePaths.push(result.path);
        previewPaths.push(result.previewPath);
        timestampSecs.push(targetTime);

        console.log(`[VideoFrameNode] 已提取 ${i + 1}/${timestamps.length} 帧...`);
      }

      setIsExtracting(false);
      updateNodeData(id, {
        isExtracting: false,
        extractedFrames: framePaths,
        extractedFramePreviews: previewPaths,
        extractedFrameTimestamps: timestampSecs,
      });

      // Auto-create individual upload nodes for each extracted frame
      const store = useCanvasStore.getState();
      const currentNode = store.nodes.find((n) => n.id === id);
      const nodeX = currentNode?.position.x ?? 0;
      const nodeY = currentNode?.position.y ?? 0;

      const NODE_SPACING_Y = 320;
      const startX = nodeX + 560;

      for (let i = 0; i < framePaths.length; i++) {
        const timestamp = timestampSecs[i] || 0;
        const fileName = `frame_${i + 1}_${timestamp.toFixed(1)}s.png`;
        const newNodeId = `frame-${id}-${i}-${crypto.randomUUID()}`;

        const newNode: Node = {
          id: newNodeId,
          type: CANVAS_NODE_TYPES.upload,
          position: { x: startX, y: nodeY + i * NODE_SPACING_Y },
          data: {
            displayName: fileName,
            imageUrl: framePaths[i],
            previewImageUrl: previewPaths[i] || framePaths[i],
            aspectRatio: "16:9",
            isSizeManuallyAdjusted: false,
            sourceFileName: fileName,
          },
        };

        store.addNode(newNode);
        store.addEdge({
          id: `edge-${id}-${newNodeId}`,
          source: id,
          target: newNodeId,
          type: "dataFlow",
        });
      }

        addToast("success", `已提取 ${framePaths.length} 帧，已生成 ${framePaths.length} 个图片节点`);
        console.log(`[VideoFrameNode] 抽帧完成: ${framePaths.length} 帧`);
    } catch (e) {
      console.error("Frame extraction failed:", e);
      setIsExtracting(false);
      updateNodeData(id, { isExtracting: false });
      showError(`抽帧失败: ${e}`);
    }
  }, [id, updateNodeData, nodeData.videoPath, frameCount, extractionMode, addToast, showError]);

  const handleExportCurrentFrame = useCallback(async () => {
    if (!nodeData.videoPath) {
      addToast("warning", "请先导入视频");
      return;
    }

    // Always capture from the currently displayed/paused video frame
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      addToast("warning", "视频尚未加载完成");
      return;
    }

    const store = useCanvasStore.getState();
    const currentNode = store.nodes.find((n) => n.id === id);
    const nodeX = currentNode?.position.x ?? 0;
    const nodeY = currentNode?.position.y ?? 0;

    const currentTime = video.currentTime;
    setIsExportingFrame(true);

    try {
      // Capture frame from <video> element via Canvas (instant, no ffmpeg)
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL("image/png");
      const result = await prepareNodeImageSource(dataUrl);

      const newNodeId = `uploadNode-${crypto.randomUUID()}`;
      const newNode: Node = {
        id: newNodeId,
        type: CANVAS_NODE_TYPES.upload,
        position: { x: nodeX + 560, y: nodeY },
        data: {
          displayName: `视频帧 @ ${currentTime.toFixed(1)}s`,
          imageUrl: result.path,
          previewImageUrl: result.previewPath,
          aspectRatio: "16:9",
          isSizeManuallyAdjusted: false,
          sourceFileName: `frame_${currentTime.toFixed(1)}s.png`,
          imageWidth: result.width,
          imageHeight: result.height,
        },
      };

      store.addNode(newNode);
      store.addEdge({
        id: `edge-${id}-${newNodeId}`,
        source: id,
        target: newNodeId,
        type: "dataFlow",
      });
      addToast("success", "已导出当前帧");
    } catch (e) {
      console.error("Export current frame failed:", e);
      showError(`导出当前帧失败: ${e}`);
    } finally {
      setIsExportingFrame(false);
    }
  }, [nodeData.videoPath, id, addToast, showError]);

  const handleClear = useCallback(() => {
    showConfirm({
      title: "清空视频数据",
      message: "确定要清空视频数据吗？此操作不可撤销。",
      variant: "danger",
      confirmLabel: "清空",
      onConfirm: () => {
        updateNodeData(id, {
          videoPath: null,
          sourceFileName: null,
          extractedFrames: [],
        });
      },
    });
  }, [id, updateNodeData, showConfirm]);

  const handleFrameCountChange = useCallback(
    (value: number) => {
      const safe = Math.max(1, Math.min(60, isNaN(value) ? 1 : value));
      setFrameCount(safe);
      updateNodeData(id, { frameCount: safe });
    },
    [id, updateNodeData]
  );

  const handleOutputWidthChange = useCallback(
    (value: number) => {
      const safe = Math.max(320, Math.min(3840, isNaN(value) ? 1280 : value));
      setOutputWidth(safe);
      updateNodeData(id, { outputWidth: safe });
    },
    [id, updateNodeData]
  );

  const handleModeChange = useCallback(
    (mode: "uniform" | "smart") => {
      setExtractionMode(mode);
      updateNodeData(id, { extractionMode: mode });
    },
    [id, updateNodeData]
  );

  return (
    <>
      <NodeDeleteButton id={id} selected={selected ?? false} />
      <div style={{ position: 'relative' }}>
      <div
        className="node-inner"
        style={{
          backgroundColor: "var(--bg-node)",
          border: isDragOver
            ? "2px solid var(--accent)"
            : "1px solid var(--border)",
          borderRadius: "var(--node-radius)",
          width: nodeWidth,
          minHeight: "300px",
          display: "flex",
          flexDirection: "column",
          transition: "border-color 0.2s",
          boxSizing: "border-box",
          boxShadow: "var(--shadow-card)",
        }}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
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
              松开以导入视频
            </div>
          </div>
        )}
        {/* Header */}
      <div
        className="flex items-center justify-between"
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          backgroundColor: "transparent",
        }}
      >
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="2" ry="2"/>
            <circle cx="8" cy="8" r="2"/>
            <path d="M21 15l-5-5L5 21"/>
          </svg>
          <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "160px" }} title={nodeData.displayName || "视频抽帧"}>
            {nodeData.displayName || "视频抽帧"}
          </span>
        </div>
      </div>

      {/* Content — scrollable area */}
      <div className="flex-1" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Import Section */}
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            borderRadius: "12px",
            padding: "24px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
          }}
        >
          {!hasVideo ? (
            <>
              {/* Icon + Title */}
              <div className="flex items-center gap-2">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
                  <line x1="7" y1="2" x2="7" y2="22"/>
                  <line x1="17" y1="2" x2="17" y2="22"/>
                  <line x1="2" y1="12" x2="22" y2="12"/>
                  <line x1="2" y1="7" x2="7" y2="7"/>
                  <line x1="2" y1="17" x2="7" y2="17"/>
                  <line x1="17" y1="17" x2="22" y2="17"/>
                  <line x1="17" y1="7" x2="22" y2="7"/>
                </svg>
                <span style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)" }}>
                  视频抽帧
                </span>
              </div>

              {/* Description */}
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", textAlign: "center" }}>
                拖拽或导入 mp4，一键生成分镜格；每帧可继续接 AI 编辑
              </p>

              {/* Import Button */}
              <button
                className="nodrag"
                onClick={handleImportVideo}
                disabled={isImporting}
                style={{
                  width: "100%",
                  padding: "12px 24px",
                  borderRadius: "8px",
                  backgroundColor: isImporting ? "var(--bg-hover)" : "var(--accent-btn)",
                  color: "var(--text-primary)",
                  border: "none",
                  fontSize: "14px",
                  fontWeight: 500,
                  cursor: isImporting ? "not-allowed" : "pointer",
                  transition: "all 0.2s",
                  opacity: isImporting ? 0.7 : 1,
                }}
              >
                {isImporting ? "导入中..." : "导入视频"}
              </button>

              {/* Feature Tags */}
              <div className="flex items-center gap-2" style={{ flexWrap: "wrap", justifyContent: "center" }}>
                {["支持拖拽导入", "输出分镜格", "智能关键帧"].map((tag) => (
                  <span
                    key={tag}
                    style={{
                      padding: "4px 10px",
                      borderRadius: "12px",
                      backgroundColor: "var(--bg-hover)",
                      color: "var(--text-secondary)",
                      fontSize: "11px",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <span style={{ fontSize: "10px" }}>•</span>
                    {tag}
                  </span>
                ))}
              </div>
            </>
          ) : null}

          {/* Video preview */}
          {videoSrc && (
            <div style={{ width: "100%", borderRadius: "8px", overflow: "hidden", backgroundColor: "var(--bg-primary)", position: "relative" }}>
              {/* Mode badge overlay */}
              <div
                style={{
                  position: "absolute",
                  top: "12px",
                  left: "12px",
                  zIndex: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "5px 12px",
                  borderRadius: "16px",
                  backgroundColor: "var(--glass-bg)",
                  backdropFilter: "blur(6px)",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "var(--text-primary)",
                  border: "1px solid var(--border)",
                }}
              >
                <span style={{ fontSize: "10px", opacity: 0.7 }}>•</span>
                {nodeData.sourceFileName && (
                  <span style={{ marginRight: "4px", opacity: 0.85 }}>{nodeData.sourceFileName}</span>
                )}
                <span style={{
                  padding: "2px 8px",
                  borderRadius: "10px",
                  backgroundColor: "var(--accent-dim)",
                  fontSize: "11px",
                }}>
                  {extractionMode === "uniform" ? "均匀抽帧" : "智能选帧"}
                </span>
              </div>
              <video
                className="nodrag"
                ref={videoRef}
                src={videoSrc}
                crossOrigin="anonymous"
                style={{ width: "100%", display: "block" }}
                controls
                preload="metadata"
              />
            </div>
          )}

          {/* Mode Switch Buttons */}
          {hasVideo && (
            <div style={{ display: "flex", gap: "10px", width: "100%" }}>
              <button
                className="nodrag"
                onClick={() => handleModeChange("uniform")}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: "10px",
                  border: extractionMode === "uniform"
                    ? "2px solid var(--accent)"
                    : "1px solid var(--border)",
                  backgroundColor: extractionMode === "uniform"
                    ? "var(--accent-dim)"
                    : "var(--bg-hover)",
                  color: extractionMode === "uniform"
                    ? "var(--text-primary)"
                    : "var(--text-secondary)",
                  fontSize: "14px",
                  fontWeight: extractionMode === "uniform" ? 500 : 400,
                  cursor: "pointer",
                  transition: "all 0.2s",
                  boxShadow: extractionMode === "uniform" ? "0 0 8px var(--accent-dim)" : "none",
                }}
              >
                {extractionMode === "uniform" && "✓ "}均匀抽帧
              </button>
              <button
                className="nodrag"
                onClick={() => handleModeChange("smart")}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: "10px",
                  border: extractionMode === "smart"
                    ? "2px solid var(--accent)"
                    : "1px solid var(--border)",
                  backgroundColor: extractionMode === "smart"
                    ? "var(--accent-dim)"
                    : "var(--bg-hover)",
                  color: extractionMode === "smart"
                    ? "var(--text-primary)"
                    : "var(--text-secondary)",
                  fontSize: "14px",
                  fontWeight: extractionMode === "smart" ? 500 : 400,
                  cursor: "pointer",
                  transition: "all 0.2s",
                  boxShadow: extractionMode === "smart" ? "0 0 8px var(--accent-dim)" : "none",
                }}
              >
                {extractionMode === "smart" && "✓ "}智能选帧
              </button>
            </div>
          )}
        </div>

        {/* ── Section 1: 抽帧生成分镜 ── */}
        {hasVideo && (
          <div
            style={{
              padding: "12px 16px",
              borderRadius: "10px",
              border: "1px solid var(--border)",
              backgroundColor: "var(--bg-secondary)",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="21" x2="4" y2="14"/>
                <line x1="4" y1="10" x2="4" y2="3"/>
                <line x1="12" y1="21" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12" y2="3"/>
                <line x1="20" y1="21" x2="20" y2="16"/>
                <line x1="20" y1="12" x2="20" y2="3"/>
                <line x1="1" y1="14" x2="7" y2="14"/>
                <line x1="9" y1="8" x2="15" y2="8"/>
                <line x1="17" y1="16" x2="23" y2="16"/>
              </svg>
              <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>
                抽帧生成分镜
              </span>
            </div>

            {/* Settings row: frame count */}
            <div style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                  抽帧数量
                </label>
                <input
                  type="number"
                  value={frameCount}
                  onChange={(e) => handleFrameCountChange(parseInt(e.target.value) || 1)}
                  min={1}
                  max={60}
                  className="nodrag"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--bg-primary)",
                    color: "var(--text-primary)",
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                  输出宽度
                </label>
                <input
                  type="number"
                  value={outputWidth}
                  onChange={(e) => handleOutputWidthChange(parseInt(e.target.value) || 640)}
                  min={320}
                  max={3840}
                  step={10}
                  className="nodrag"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--bg-primary)",
                    color: "var(--text-primary)",
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
              </div>
            </div>

            {/* Extract button */}
            <button
              className="nodrag"
              onClick={handleExtractFrames}
              disabled={isExtracting}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "8px",
                backgroundColor: isExtracting ? "var(--bg-hover)" : "var(--accent-btn)",
                color: isExtracting ? "var(--text-muted)" : "var(--text-primary)",
                border: "none",
                fontSize: "13px",
                fontWeight: 500,
                cursor: !isExtracting ? "pointer" : "not-allowed",
                transition: "all 0.2s",
                opacity: isExtracting ? 0.7 : 1,
              }}
            >
              {isExtracting ? "抽帧中..." : "一键抽帧生成分镜"}
            </button>
          </div>
        )}

        {/* ── Section 2: 导出当前帧 ── */}
        {hasVideo && (
          <div
            style={{
              padding: "12px 16px",
              borderRadius: "10px",
              border: "1px solid var(--border)",
              backgroundColor: "var(--bg-secondary)",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
                <line x1="7" y1="2" x2="7" y2="22"/>
                <line x1="17" y1="2" x2="17" y2="22"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <line x1="2" y1="7" x2="7" y2="7"/>
                <line x1="2" y1="17" x2="7" y2="17"/>
                <line x1="17" y1="17" x2="22" y2="17"/>
                <line x1="17" y1="7" x2="22" y2="7"/>
              </svg>
              <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>
                导出当前帧
              </span>
              <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "auto" }}>
                暂停视频后截取画面
              </span>
            </div>
            <button
              className="nodrag"
              onClick={handleExportCurrentFrame}
              disabled={isExportingFrame}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "8px",
                backgroundColor: isExportingFrame ? "var(--bg-hover)" : "var(--accent-btn)",
                color: isExportingFrame ? "var(--text-muted)" : "var(--text-primary)",
                border: "none",
                fontSize: "13px",
                fontWeight: 500,
                cursor: isExportingFrame ? "not-allowed" : "pointer",
                transition: "all 0.2s",
                opacity: isExportingFrame ? 0.7 : 1,
              }}
            >
              {isExportingFrame ? "正在截取..." : "导出当前帧"}
            </button>
          </div>
        )}

        {/* Footer Actions — fixed at bottom */}
        <div style={{ display: "flex", gap: "8px", marginTop: "auto", flexShrink: 0, paddingTop: "4px" }}>
          <button
            className="nodrag"
            onClick={handleImportVideo}
            disabled={isImporting}
            style={{
              flex: 1,
              padding: "10px",
              borderRadius: "8px",
              backgroundColor: "var(--bg-secondary)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
              fontSize: "13px",
              cursor: isImporting ? "not-allowed" : "pointer",
              transition: "all 0.2s",
              opacity: isImporting ? 0.6 : 1,
            }}
          >
            更换视频
          </button>
          <button
            className="nodrag"
            onClick={handleClear}
            style={{
              flex: 1,
              padding: "10px",
              borderRadius: "8px",
              backgroundColor: "var(--bg-secondary)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
              fontSize: "13px",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--error)"; e.currentTarget.style.color = "var(--error)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
          >
            清空
          </button>
        </div>
      </div>

    </div>
    <NodeResizeHandle width={nodeWidth} height={nodeHeight} onResize={handleResize} minWidth={520} maxWidth={900} minHeight={300} maxHeight={1200} />
    </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[var(--accent-secondary)] !w-6 !h-6 !border-2 !border-[var(--bg-node)]"
      />
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[var(--accent-secondary)] !w-6 !h-6 !border-2 !border-[var(--bg-node)]"
      />
    </>
  );
});



