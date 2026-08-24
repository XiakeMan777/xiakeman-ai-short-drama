// v12 - StoryboardGenNode: use ChannelModelSelector with IMAGE mode (FORCE_RECOMPILE)
import { useState, useCallback, useEffect, useMemo, useRef, memo } from "react";
import { type NodeProps, Handle, Position, type Node, type Edge } from "@xyflow/react";

import { NodeDeleteButton } from "./NodeDeleteButton";
import { ImageEditorDialog } from "../ui/ImageEditorDialog";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useErrorStore } from "@/features/canvas/compat/ErrorDialog";
import type {
  StoryboardGenNodeData,
  StoryboardFrame,
  StoryboardStyleType,
} from "../domain/canvasNodes";
import {
  CANVAS_NODE_TYPES,
  STORYBOARD_STYLE_PROMPTS,
  STORYBOARD_STYLE_LABELS,
} from "../domain/canvasNodes";
import { tauriAiGateway } from "../infrastructure/tauriAiGateway";
import {
  buildReferenceImagePool,
  buildAssetImagePool,
  resolveReferenceImagesForPrompt,
  resolveReferenceThumbnailUrl,
  normalizeUrl,
  type ReferenceImagePoolResult,
} from "../application/referenceImagePool";
import {
  sanitizePromptText,
  collectReferencedImageNumbers,
  stripReferenceMarkers,
} from "../application/referenceTokenEditing";
// import { extractDisplayName } from "../application/imageData";
import { resolveImageDisplayUrl } from "../application/imageData";
import { getModelById, DEFAULT_MODEL_ID, getAllModels, createFallbackModelDefinition } from "../models/registry";
import type { ImageSize } from "../models/image/types";
import { useChannelModelSelector } from "../hooks/useChannelModelSelector";
import { ChannelModelSelector } from "../ui/ChannelModelSelector";
import { IMAGE_CREDIT_PRICES } from "../application/creditPricing";
import { useSettingsStore } from "@/features/canvas/stores/settingsStore";
import { useCreditsStore } from "@/features/canvas/stores/creditsStore";
import { RichPromptInput } from "../ui/RichPromptInput";
import { NodeResizeHandle } from "../ui/NodeResizeHandle";
import { ImageViewerModal } from "../ui/ImageViewerModal";
import { setApiKey, setBaseUrl, persistImageSource, prepareNodeImageSource } from "@/features/canvas/compat/commands";
import { useAssetStore } from "@/features/canvas/stores/assetStore";
import { useUpstreamDataKey } from "../hooks/useUpstreamNodes";
import { nodeRegistry } from "../domain/nodeRegistry";

/** Simple thumbnail image for reference strip */
function ReferenceThumbnailImg({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      draggable={false}
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
    />
  );
}


const POLL_INTERVAL = 2000;
const MAX_POLL_TIME = 15 * 60 * 1000; // 15 minute timeout per frame

// ---------------------------------------------------------------------------
// StoryboardGenNode Component
// ---------------------------------------------------------------------------

export const StoryboardGenNode = memo(function StoryboardGenNode({ data, id, selected }: NodeProps) {
  const nodeData = data as unknown as StoryboardGenNodeData;
  const [rows, setRows] = useState(nodeData.rows || 2);
  const [cols, setCols] = useState(nodeData.cols || 3);
  const [showParamsPanel, setShowParamsPanel] = useState(false);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const showError = useErrorStore((s) => s.showError);
  const upstreamDataKey = useUpstreamDataKey(id);
  const [_activeFrameIndex, setActiveFrameIndex] = useState<number | null>(0);
  const frameCursorPosRef = useRef<number>(0); // last known cursor pos in active frame's prompt
  const activeJobsRef = useRef<Set<string>>(new Set()); // track active job IDs for progress event filtering

  // ── Node dimensions (resizable) ──────────────────────────────────────
  const nodeWidth = nodeData.width || 680;
  const nodeHeight = nodeData.height || 560;
  const handleResize = useCallback(
    (result: { width: number; height: number }) => {
      updateNodeData(id, { width: result.width, height: result.height });
    },
    [id, updateNodeData]
  );

  // Fullscreen image viewer state (Feature 6)
  const [viewerImages, setViewerImages] = useState<string[] | null>(null);
  const [viewerIndex] = useState(0);

  // Track which frames are being regenerated
  // const [, setRegeneratingFrames] = useState<Set<number>>(new Set());

  // Channel / model selector state
  // StoryboardGenNode generates IMAGES, so use "image" mode (shows grsai, not chat-model)
  const imageModelProvider = useSettingsStore((s) => s.providers.find((p) => p.id === "image-model"));
  // Only use image-model's channel if configured; otherwise leave empty to show "通道"
  const imageChannelId = imageModelProvider?.channel || "";

  const [selectedProviderId, setSelectedProviderId] = useState(
    nodeData.providerId || nodeData.provider || imageChannelId || ""
  );
  const [_anyMenuOpen, setAnyMenuOpen] = useState(false);
  const [showImageEditor, setShowImageEditor] = useState(false);

  // Sync selectedProviderId when imageChannelId changes (e.g. user updates settings)
  useEffect(() => {
    const newId = imageChannelId || nodeData.providerId || nodeData.provider || "";
    if (newId !== selectedProviderId) {
      setSelectedProviderId(newId);
      if (newId) {
        updateNodeData(id, { providerId: newId, provider: newId });
        // Auto-switch model to match the new provider
        const modelsForNewProvider = getAllModels().filter(
          (m) => m.providerId === newId
        );
        if (modelsForNewProvider.length > 0) {
          updateNodeData(id, { model: modelsForNewProvider[0].id });
        }
      }
    }
  }, [imageChannelId, nodeData.providerId, nodeData.provider]); // eslint-disable-line react-hooks/exhaustive-deps

  const { availableProviders, availableModels } = useChannelModelSelector(
    "image",
    selectedProviderId
  );

  const handleProviderChange = useCallback((providerId: string) => {
    setSelectedProviderId(providerId);
    updateNodeData(id, { providerId, provider: providerId });
    // Auto-switch model to the new provider's first available model
    const modelsForProvider = getAllModels().filter(
      (m) => m.providerId === providerId
    );
    if (modelsForProvider.length > 0) {
      updateNodeData(id, { model: modelsForProvider[0].id });
    }
  }, [id, updateNodeData]);

  // Resolve current model
  const currentModelId = nodeData.model || DEFAULT_MODEL_ID;
  const model = getModelById(currentModelId);

  // Use global asset store (loaded once at Canvas level, shared by all nodes)
  const assets = useAssetStore((s) => s.allAssets);
  const assetPool = useMemo(() => buildAssetImagePool(assets), [assets]);

  // Credits mode tracking for image refunds
  const creditsEnabled = useSettingsStore((s) => s.creditsEnabled);
  const isCustomProvider = useSettingsStore((s) => s.customProviders.some((p: any) => p.id === selectedProviderId));
  const shouldUseCreditsRef = useRef(creditsEnabled && !isCustomProvider);

  // Collect @图N numbers from ALL frame descriptions — asset library images
  // only appear in the reference strip when explicitly referenced in a prompt.
  const allRefNumbers = useMemo(() => {
    const nums = new Set<number>();
    (nodeData.frames || []).forEach((f) => {
      collectReferencedImageNumbers(f.description).forEach((n) => nums.add(n));
    });
    return nums;
  }, [nodeData.frames]);

  // Persisted asset refs — survive asset library reloads / panel closes
  const persistedAssets = nodeData.referencedAssets;

  // Only include persisted assets that are ACTUALLY REFERENCED in frame descriptions.
  // Stale persisted entries must not pollute the ReferenceStrip.
  const allDescriptions = (nodeData.frames || []).map((f) => f.description).join(" ");
  const activePersistedAssets = useMemo(() => {
    if (!persistedAssets || persistedAssets.length === 0) return [];
    const referencedNums = collectReferencedImageNumbers(allDescriptions);
    if (referencedNums.length === 0) return [];
    const { nodes, edges } = useCanvasStore.getState();
    const upstreamPool = buildReferenceImagePool(id, nodes, edges, undefined, []);
    const activeUrls = new Set<string>();
    for (const num of referencedNums) {
      const entry = upstreamPool.getByNumber(num);
      if (entry) activeUrls.add(normalizeUrl(entry.url));
    }
    return persistedAssets.filter(pa => activeUrls.has(normalizeUrl(pa.url)));
  }, [persistedAssets, allDescriptions, id, upstreamDataKey]);

  // Build reference image pool (upstream + asset library + persisted refs)
  const pool = useMemo(
    () => {
      const { nodes, edges } = useCanvasStore.getState();
      return buildReferenceImagePool(id, nodes, edges, assetPool, activePersistedAssets);
    },
    [id, upstreamDataKey, assetPool, activePersistedAssets]
  );

  // Sync referenced asset-library images from ALL frame descriptions into node data
  useEffect(() => {
    const allDescriptions = (nodeData.frames || []).map((f) => f.description).join(" ");
    const referencedNums = collectReferencedImageNumbers(allDescriptions);
    const newPersisted: { url: string; thumbnailUrl?: string; name?: string }[] = [];
    for (const num of referencedNums) {
      const entry = pool.getByNumber(num);
      // Only persist if the entry is from the LIVE asset pool (not circular from previous persists)
      if (entry && entry.source === "asset" && entry.assetId && entry.sourceNodeId !== "persisted-asset") {
        newPersisted.push({
          url: entry.url,
          thumbnailUrl: entry.thumbnailUrl,
          name: entry.sourceNodeName,
        });
      }
    }
    const current = nodeData.referencedAssets || [];
    const isSame =
      current.length === newPersisted.length &&
      current.every(
        (c, i) =>
          c.url === newPersisted[i].url &&
          c.name === newPersisted[i].name
      );
    if (!isSame) {
      updateNodeData(id, { referencedAssets: newPersisted });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeData.frames, pool, id, updateNodeData]);

  // Sync from store
  useEffect(() => {
    if (nodeData.rows !== rows) setRows(nodeData.rows || 2);
    if (nodeData.cols !== cols) setCols(nodeData.cols || 3);
  }, [nodeData.rows, nodeData.cols, rows, cols]);

  // ── Recovery: on mount or reload, check pending frames that have a stored jobId ──
  useEffect(() => {
    const frames = nodeData.frames || [];
    const pending = frames
      .map((f, i) => ({ frame: f, idx: i }))
      .filter(({ frame }) => frame.generationJobId && !frame.imageUrl);
    if (pending.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const { frame, idx } of pending) {
        if (cancelled) break;
        try {
          const status = await tauriAiGateway.queryTaskToken(frame.generationJobId!);
          if (status.result) {
            let url = status.result;
            if (url.startsWith("data:") || url.startsWith("http")) { try { const lp = await persistImageSource(url) as string; if (lp) url = lp; } catch {} }
            const curFrames = [...(nodeData.frames || [])];
            if (curFrames[idx]) { curFrames[idx] = { ...curFrames[idx], imageUrl: url, generationJobId: null }; }
            updateNodeData(id, { frames: curFrames });
          } else if (status.status === "failed") {
            const curFrames = [...(nodeData.frames || [])];
            if (curFrames[idx]) { curFrames[idx] = { ...curFrames[idx], generationJobId: null }; }
            updateNodeData(id, { frames: curFrames });
          }
          // Still pending — leave jobId, show "排队中"
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [id]); // only on mount

  const handleRowsChange = useCallback(
    (value: number) => {
      const r = Math.max(1, Math.min(5, value));
      setRows(r);
      updateNodeData(id, { rows: r });
    },
    [id, updateNodeData]
  );

  const handleColsChange = useCallback(
    (value: number) => {
      const c = Math.max(1, Math.min(5, value));
      setCols(c);
      updateNodeData(id, { cols: c });
    },
    [id, updateNodeData]
  );

  const handleModelChange = useCallback(
    (modelId: string) => {
      updateNodeData(id, { model: modelId, providerId: selectedProviderId });
    },
    [id, updateNodeData, selectedProviderId]
  );

  const handleSizeChange = useCallback(
    (size: ImageSize) => {
      updateNodeData(id, { size });
    },
    [id, updateNodeData]
  );

  const handleAspectRatioChange = useCallback(
    (aspectRatio: string) => {
      updateNodeData(id, { overallAspectRatio: aspectRatio });
    },
    [id, updateNodeData]
  );

  const handleStyleChange = useCallback(
    (styleType: StoryboardStyleType) => {
      const newStylePrompt = STORYBOARD_STYLE_PROMPTS[styleType];
      const styleRegex = /^(2D动漫风格|3D国漫风格|真人实拍风格)[^，]*，/;
      // Update frame descriptions: replace any existing style prefix with the new one
      const newFrames = (nodeData.frames || []).map((f) => {
        const desc = f.description || "";
        if (styleRegex.test(desc)) {
          return { ...f, description: desc.replace(styleRegex, `${newStylePrompt}，`) };
        }
        return { ...f, description: `${newStylePrompt}，${desc}` };
      });
      updateNodeData(id, { styleType, frames: newFrames });
    },
    [id, updateNodeData, nodeData.frames]
  );

  const handleFrameDescriptionChange = useCallback(
    (frameIndex: number, description: string) => {
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
      newFrames[frameIndex] = { ...newFrames[frameIndex], description };
      updateNodeData(id, { frames: newFrames });
    },
    [id, nodeData.frames, updateNodeData]
  );

  const handleFrameDurationChange = useCallback(
    (frameIndex: number, duration: number) => {
      const newFrames = [...(nodeData.frames || [])];
      if (newFrames[frameIndex]) {
        newFrames[frameIndex] = { ...newFrames[frameIndex], duration };
        updateNodeData(id, { frames: newFrames });
      }
    },
    [id, nodeData.frames, updateNodeData]
  );

  const totalDuration = useMemo(() => (nodeData.frames || []).reduce((sum, f) => sum + (f.duration ?? 5), 0), [nodeData.frames]);
  const videoReadyDuration = useMemo(
    () => (nodeData.frames || []).filter((f) => f.imageUrl).reduce((sum, f) => sum + (f.duration ?? 5), 0),
    [nodeData.frames]
  );

  // Check if at least one frame has an image (for "批量生视频" button)
  const hasVideoReadyFrames = useMemo(() => {
    const frames = nodeData.frames || [];
    return frames.some((f) => f.imageUrl);
  }, [nodeData.frames]);

  // ── 断点2: Batch video generation ────────────────────────────────────
  // For each frame with an imageUrl, create a VideoNode (image2video mode)
  // with the frame's imageUrl as firstFrameImage and description as prompt.
  // Then auto-create a VideoCompositionNode and connect all VideoResultNodes to it.

  const [isBatchVideo, setIsBatchVideo] = useState(false);
  const [batchVideoProgress, setBatchVideoProgress] = useState({ done: 0, total: 0 });

  const handleBatchGenerateVideo = useCallback(async () => {
    if (isBatchVideo) return;
    console.log("[StoryboardGenNode] batch video clicked", {
      nodeId: id,
      frameCount: nodeData.frames?.length || 0,
      readyFrameCount: (nodeData.frames || []).filter((f) => f.imageUrl).length,
    });
    try {
      const frames = (nodeData.frames || []).filter((f) => f.imageUrl);
      if (frames.length === 0) {
        showError("没有可生视频的分镜帧");
        return;
      }

      setIsBatchVideo(true);
      setBatchVideoProgress({ done: 0, total: frames.length });

      const store = useCanvasStore.getState();
      const currentNode = store.nodes.find((n) => n.id === id);
      const posX = currentNode?.position?.x ?? 0;
      const posY = currentNode?.position?.y ?? 0;
      const videoEntry = nodeRegistry.videoGen;
      const compEntry = nodeRegistry[CANVAS_NODE_TYPES.videoComposition];
      if (!videoEntry) throw new Error("视频节点未注册");

      // Create VideoNodes for each frame with imageUrl
      const videoNodeIds: string[] = [];
      const spacingX = 260;
      const spacingY = 320;

      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const vNodeId = `sb2v-${id}-${i}-${Date.now()}`;
        const videoNode: Node = {
          id: vNodeId,
          type: videoEntry.type,
          position: {
            x: posX + nodeWidth + 60 + (i % 3) * spacingX,
            y: posY + Math.floor(i / 3) * spacingY,
          },
          data: {
            ...videoEntry.createDefaultData(),
            displayName: `镜头${frame.label || i + 1} → 视频`,
            prompt: stripReferenceMarkers(sanitizePromptText(frame.description)) || `分镜${i + 1}动画`,
            videoMode: "image2video",
            firstFrameImage: frame.imageUrl,
            duration: frame.duration ?? 5,
            isGenerating: false,
            generationStartedAt: null,
            autoStartGeneration: true,
            autoStartGenerationNonce: Date.now() + i,
          },
        };
        store.addNode(videoNode);
        // Connect storyboard → videoNode
        store.addEdge({
          id: `edge-sb2v-${id}-${vNodeId}`,
          source: id,
          target: vNodeId,
          type: "dataFlow",
        });
        videoNodeIds.push(vNodeId);
      }

      // ── 断点3: Auto-create VideoCompositionNode ────────────────────
      if (compEntry && videoNodeIds.length > 0) {
        const compNodeId = `sbcomp-${id}-${Date.now()}`;
        const compNode: Node = {
          id: compNodeId,
          type: compEntry.type,
          position: {
            x: posX + nodeWidth + 60 + frames.length * spacingX / 2 + 100,
            y: posY,
          },
          data: {
            ...compEntry.createDefaultData(),
            displayName: `分镜合成(${frames.length}段 ${videoReadyDuration}s)`,
            compositionMode: "sequential",
          },
        };
        store.addNode(compNode);

        // Connect all VideoNodes → VideoCompositionNode
        for (const vId of videoNodeIds) {
          store.addEdge({
            id: `edge-v2comp-${vId}`,
            source: vId,
            target: compNodeId,
            type: "dataFlow",
          });
        }
      }

      // Mark batch complete
      setBatchVideoProgress({ done: frames.length, total: frames.length });
      setIsBatchVideo(false);
    } catch (error) {
      console.error("[StoryboardGenNode] batch video failed:", error);
      setIsBatchVideo(false);
      showError(`创建视频节点失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [id, isBatchVideo, nodeData.frames, nodeWidth, videoReadyDuration, showError]);

  // Referenced image numbers for the currently active frame (for top ReferenceStrip)
  // ---------------------------------------------------------------------------
  // Core generation helper: persist result and update output node + frame data
  // ---------------------------------------------------------------------------

  /** Persist a generated image result and update the target output node. (currently unused) */
  /* const persistAndUpdateOutputNode = useCallback(async (
    outputNodeId: string,
    resultUrl: string,
    frameIndex: number
  ) => {
    const resultFileName = extractDisplayName(resultUrl || "", "image");
    let finalImageUrl: string | null = resultUrl;

    if (finalImageUrl) {
      if (finalImageUrl.startsWith("data:")) {
        try {
          const persistedPath = (await persistImageSource(finalImageUrl)) as string;
          const prepared = (await prepareNodeImageSource(persistedPath)) as {
            previewPath: string;
            width: number;
            height: number;
          };
          updateNodeData(outputNodeId, {
            imageUrl: persistedPath,
            previewImageUrl: prepared.previewPath,
            displayName: resultFileName,
            sourceFileName: resultFileName,
            imageWidth: prepared.width,
            imageHeight: prepared.height,
            isGenerating: false,
          });
          finalImageUrl = persistedPath;
        } catch (e) {
          console.error("[分镜生图] data URL 持久化失败:", e);
          updateNodeData(outputNodeId, {
            imageUrl: finalImageUrl,
            displayName: resultFileName,
            sourceFileName: resultFileName,
            isGenerating: false,
          });
        }
      } else if (finalImageUrl.startsWith("http://") || finalImageUrl.startsWith("https://")) {
        try {
          const persistedPath = (await persistImageSource(finalImageUrl)) as string;
          const prepared = (await prepareNodeImageSource(persistedPath)) as {
            previewPath: string;
            width: number;
            height: number;
          };
          updateNodeData(outputNodeId, {
            imageUrl: persistedPath,
            previewImageUrl: prepared.previewPath,
            displayName: resultFileName,
            sourceFileName: resultFileName,
            imageWidth: prepared.width,
            imageHeight: prepared.height,
            isGenerating: false,
          });
          finalImageUrl = persistedPath;
        } catch (e) {
          console.error("[分镜生图] HTTP 图片下载到本地失败:", e);
          updateNodeData(outputNodeId, {
            imageUrl: finalImageUrl,
            displayName: resultFileName,
            sourceFileName: resultFileName,
            isGenerating: false,
          });
        }
      } else {
        try {
          const prepared = (await prepareNodeImageSource(finalImageUrl)) as {
            previewPath: string;
            width: number;
            height: number;
          };
          updateNodeData(outputNodeId, {
            imageUrl: finalImageUrl,
            previewImageUrl: prepared.previewPath,
            displayName: resultFileName,
            sourceFileName: resultFileName,
            imageWidth: prepared.width,
            imageHeight: prepared.height,
            isGenerating: false,
          });
        } catch (e) {
          console.error("[分镜生图] 结果预览准备失败:", e);
          updateNodeData(outputNodeId, {
            imageUrl: finalImageUrl,
            displayName: resultFileName,
            sourceFileName: resultFileName,
            isGenerating: false,
          });
        }
      }
    } else {
      updateNodeData(outputNodeId, {
        isGenerating: false,
        displayName: `分镜 ${String(frameIndex + 1).padStart(2, "0")} — 无结果`,
      });
    }

    // Update frame imageUrl in storyboard node
    const currentFrames = (useCanvasStore.getState().nodes.find((n) => n.id === id)?.data as unknown as StoryboardGenNodeData)?.frames || [];
    const updatedFrames = [...currentFrames];
    if (updatedFrames[frameIndex]) {
      updatedFrames[frameIndex] = { ...updatedFrames[frameIndex], imageUrl: finalImageUrl };
    }
    updateNodeData(id, { frames: updatedFrames });

    return finalImageUrl;
  }, [id, updateNodeData]); */

  /*
  // ---------------------------------------------------------------------------
  // Feature 1: Regenerate single frame (currently unused)
  // ---------------------------------------------------------------------------

  const handleRegenerateFrame = useCallback(async (frameIndex: number) => {
    const frame = nodeData.frames?.[frameIndex];
    if (!frame) return;

    const sanitized = stripReferenceMarkers(sanitizePromptText(frame.description));
    if (!sanitized) return;

    const effectiveModelId = nodeData.model || DEFAULT_MODEL_ID;
    let modelDef = getModelById(effectiveModelId);
    if (!modelDef && isCustomProvider) {
      modelDef = createFallbackModelDefinition(effectiveModelId, selectedProviderId);
    }
    if (!modelDef) {
      showError("未找到模型配置");
      return;
    }

    // Sync API key/base URL before submitting
    const eProviderId = selectedProviderId || modelDef.providerId;
    const settings = useSettingsStore.getState();
    let config = settings.providers.find((p) => p.id === eProviderId && p.apiKey);
    if (!config) config = settings.providers.find((p) => p.channel === eProviderId && p.apiKey);
    if (!config) {
      const cp = settings.customProviders.find((p) => p.id === eProviderId && p.apiKey);
      if (cp) config = { id: cp.id, name: cp.name, apiKey: cp.apiKey, baseUrl: cp.baseUrl, enabled: true, channel: eProviderId } as any;
    }
    if (config?.apiKey?.trim()) {
      await setApiKey(eProviderId, config.apiKey.trim());
      if (config.baseUrl?.trim()) await setBaseUrl(eProviderId, config.baseUrl.trim());
    }

    // Mark frame as regenerating
    setRegeneratingFrames((prev) => new Set(prev).add(frameIndex));

    const effectiveSize = (nodeData.size as ImageSize) || modelDef.defaultSize;
    const cellAspectRatio = nodeData.cellAspectRatio || nodeData.overallAspectRatio || nodeData.aspectRatio || "1:1";

    // Always create a new output node for each generation
    const store = useCanvasStore.getState();
    const currentNode = store.nodes.find((n) => n.id === id);
    const nodeX = currentNode?.position.x ?? 0;
    const nodeY = currentNode?.position.y ?? 0;

    const outputNodeId = `sb-out-${id}-${frameIndex}-${crypto.randomUUID()}`;

    const col = frameIndex % cols;
    const row = Math.floor(frameIndex / cols);
    const spacingX = 260;
    const spacingY = 320;
    const outputX = nodeX + 560 + col * spacingX;
    const outputY = nodeY + row * spacingY;

    const outputNode: Node = {
      id: outputNodeId,
      type: CANVAS_NODE_TYPES.upload,
      position: { x: outputX, y: outputY },
      data: {
        displayName: `分镜 ${String(frameIndex + 1).padStart(2, "0")}`,
        imageUrl: null,
        previewImageUrl: null,
        aspectRatio: cellAspectRatio,
        isSizeManuallyAdjusted: false,
        sourceFileName: null,
        isGenerating: true,
        generationStartedAt: Date.now(),
        expectedDurationMs: modelDef.expectedDurationMs || 90000,
      },
    };
    store.addNode(outputNode);

    const newEdge: Edge = {
      id: `edge-${id}-${outputNodeId}`,
      source: id,
      target: outputNodeId,
      type: "dataFlow",
    };
    store.addEdge(newEdge);

    // Also update the frame's imageUrl to null in the storyboard node
    const currentFrames = [...(nodeData.frames || [])];
    if (currentFrames[frameIndex]) {
      currentFrames[frameIndex] = { ...currentFrames[frameIndex], imageUrl: null };
      updateNodeData(id, { frames: currentFrames });
    }

    try {
      // Rebuild pool from fresh store state
      const { nodes: freshNodes2, edges: freshEdges2 } = useCanvasStore.getState();
      const freshPool2 = buildReferenceImagePool(id, freshNodes2, freshEdges2, assetPool, persistedAssets, Infinity);

      // Collect @图N references
      const refNumbers = collectReferencedImageNumbers(frame.description);
      const referencedImages = resolveReferenceImagesForPrompt("", freshPool2, refNumbers);

      let prompt = `分镜${frameIndex + 1}：${sanitized}`;
      if (referencedImages && referencedImages.length > 0) {
        prompt = `参考提供的图片，${prompt}`;
      }

      const { requestModel } = modelDef.resolveRequest({
        referenceImageCount: (referencedImages || []).length,
      });

      // Use selectedProviderId (user's channel) not modelDef.providerId
      const effectiveProviderId = selectedProviderId || modelDef.providerId;

      const styleExtraParams = { ...(nodeData.extraParams || {}) } as Record<string, unknown>;
      if (nodeData.styleType) {
        styleExtraParams.artStylePrompt = STORYBOARD_STYLE_PROMPTS[nodeData.styleType];
      }

      const jobId = await tauriAiGateway.submitGenerateImageJob({
        model: `${effectiveProviderId}/${requestModel}`,
        prompt,
        size: effectiveSize,
        aspectRatio: cellAspectRatio,
        referenceImages: referencedImages,
        extraParams: styleExtraParams,
      });

      // Track this job for progress event filtering
      activeJobsRef.current.add(jobId);

      // Poll until completion (setTimeout recursion — no request stacking)
      await new Promise<void>((resolve) => {
        const framePollStart = Date.now();
        let stopped = false;

        const poll = async () => {
          if (stopped) return;
          try {
            if (Date.now() - framePollStart > MAX_POLL_TIME) {
              stopped = true;
              activeJobsRef.current.delete(jobId);
              updateNodeData(outputNodeId, { isGenerating: false, displayName: `分镜 ${String(frameIndex + 1).padStart(2, "0")} — 超时` });
              showError(`分镜${frameIndex + 1}重新生成超时（15分钟）`);
              setRegeneratingFrames((prev) => { const next = new Set(prev); next.delete(frameIndex); return next; });
              resolve(); return;
            }
            const status = await tauriAiGateway.getGenerateImageJob(jobId);
            (window as any)[`__pollErr_single_${id}_${frameIndex}`] = 0;
            if (status.status === "succeeded") {
              stopped = true;
              activeJobsRef.current.delete(jobId);
              await persistAndUpdateOutputNode(outputNodeId, status.result || "", frameIndex);
              setRegeneratingFrames((prev) => { const next = new Set(prev); next.delete(frameIndex); return next; });
              resolve();
            } else if (status.status === "failed") {
              stopped = true;
              activeJobsRef.current.delete(jobId);
              updateNodeData(outputNodeId, { isGenerating: false, displayName: `分镜 ${String(frameIndex + 1).padStart(2, "0")} — 失败` });
              showError(`分镜${frameIndex + 1}重新生成失败: ${status.error || "未知错误"}`);
              setRegeneratingFrames((prev) => { const next = new Set(prev); next.delete(frameIndex); return next; });
              resolve();
            } else { if (!stopped) setTimeout(poll, POLL_INTERVAL); }
          } catch (e) {
            console.error("Poll error:", e);
            const pollErrKey = `__pollErr_single_${id}_${frameIndex}`;
            const prevCount = (window as any)[pollErrKey] || 0;
            (window as any)[pollErrKey] = prevCount + 1;
            if (prevCount + 1 >= 5) {
              stopped = true;
              activeJobsRef.current.delete(jobId);
              const errMsg = e instanceof Error ? e.message : String(e);
              updateNodeData(outputNodeId, { isGenerating: false, generationError: errMsg || "轮询出错过多，已停止" });
              setRegeneratingFrames((prev) => { const next = new Set(prev); next.delete(frameIndex); return next; });
              resolve();
            } else { if (!stopped) setTimeout(poll, POLL_INTERVAL); }
          }
        };
        setTimeout(poll, 0);
      });
    } catch (e) {
      showError(`分镜${frameIndex + 1}重新生成提交失败: ${e}`);
      updateNodeData(outputNodeId, {
        isGenerating: false,
        displayName: `分镜 ${String(frameIndex + 1).padStart(2, "0")} — 失败`,
      });
      setRegeneratingFrames((prev) => {
        const next = new Set(prev);
        next.delete(frameIndex);
        return next;
      });
    }
  }, [id, cols, nodeData, pool, updateNodeData, showError, persistAndUpdateOutputNode]);
  */

  // ---------------------------------------------------------------------------
  // handleGenerateAll — generate merged storyboard image
  // ---------------------------------------------------------------------------

  // ─── Batch generation state ────────────────────────────────────────────
  const [isBatching, setIsBatching] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });

  // Check if any frame has non-empty description (for button disabled state)
  const hasValidFrames = (nodeData.frames || []).some(
    (f) => stripReferenceMarkers(sanitizePromptText(f.description)).length > 0
  );

  const handleGenerateAll = useCallback(async () => {
    // Prevent re-entry while already generating
    if (nodeData.isGenerating) return;

    const totalFrames = rows * cols;
    const currentFrames = nodeData.frames || [];

    // Ensure frames array has correct length
    const frames: StoryboardFrame[] = Array.from({ length: totalFrames }, (_, i) =>
      currentFrames[i] || {
        index: i,
        label: `镜头${i + 1}`,
        description: "",
        notes: "",
        imageUrl: null,
      }
    );

    // Collect all non-empty frame descriptions
    const validFrames = frames
      .map((f, i) => ({ ...f, index: i }))
      .filter((f) => stripReferenceMarkers(sanitizePromptText(f.description)).length > 0);

    if (validFrames.length === 0) {
      showError("请先填写分镜描述");
      return;
    }

    updateNodeData(id, { isGenerating: true, frames });

    const effectiveModelId = nodeData.model || DEFAULT_MODEL_ID;
    let modelDef = getModelById(effectiveModelId);
    if (!modelDef && isCustomProvider) {
      modelDef = createFallbackModelDefinition(effectiveModelId, selectedProviderId);
    }
    if (!modelDef) {
      showError("未找到模型配置信息");
      updateNodeData(id, { isGenerating: false });
      return;
    }

    // Sync API key/base URL before submitting
    const eProviderId = selectedProviderId || modelDef.providerId;
    const settings = useSettingsStore.getState();
    let config = settings.providers.find((p) => p.id === eProviderId && p.apiKey);
    if (!config) config = settings.providers.find((p) => p.channel === eProviderId && p.apiKey);
    if (!config) {
      const cp = settings.customProviders.find((p) => p.id === eProviderId && p.apiKey);
      if (cp) config = { id: cp.id, name: cp.name, apiKey: cp.apiKey, baseUrl: cp.baseUrl, enabled: true, channel: eProviderId } as any;
    }
    if (config?.apiKey?.trim()) {
      await setApiKey(eProviderId, config.apiKey.trim());
      if (config.baseUrl?.trim()) await setBaseUrl(eProviderId, config.baseUrl.trim());
    }

    const store = useCanvasStore.getState();
    const currentNode = store.nodes.find((n) => n.id === id);
    const nodeX = currentNode?.position.x ?? 0;
    const nodeY = currentNode?.position.y ?? 0;
    const effectiveSize = (nodeData.size as ImageSize) || modelDef.defaultSize;
    const cellAspectRatio = nodeData.cellAspectRatio || nodeData.overallAspectRatio || nodeData.aspectRatio || "1:1";

    // Always rebuild pool from fresh store state at generation time.
    // The useMemo pool can be stale (e.g., upstream images loaded after initial render).
    const { nodes: freshNodes, edges: freshEdges } = useCanvasStore.getState();
    const freshPool = buildReferenceImagePool(id, freshNodes, freshEdges, assetPool, persistedAssets, Infinity);

    // Build prompt in Chinese as user requested
    const frameDescriptions = validFrames
      .map((f, idx) => `${idx + 1}. ${stripReferenceMarkers(sanitizePromptText(f.description))}`)
      .join("\n");

    // Style prompt already embedded in frame descriptions (by handleStyleChange)
    const mergedPrompt = `生成一张${rows}×${cols}的${rows * cols}宫格分镜图，禁止添加描述文本\n\n${frameDescriptions}`;

    // Only collect reference images that are explicitly @图N-referenced in frame descriptions.
    // No auto-injection — user must opt in via @图N tokens.
    const allRefNumbers = new Set<number>();
    validFrames.forEach((f) => {
      collectReferencedImageNumbers(f.description).forEach((n) => allRefNumbers.add(n));
    });
    const referencedImages = resolveReferenceImagesForPrompt(
      "",
      freshPool,
      Array.from(allRefNumbers)
    );

    // Find or create a single merged output node
    const currentNodes = useCanvasStore.getState().nodes;
    let outputNodeId: string | null = null;
    for (const node of currentNodes) {
      if (node.id.startsWith(`sb-out-${id}-merged-`)) {
        outputNodeId = node.id;
        break;
      }
    }

    if (!outputNodeId) {
      outputNodeId = `sb-out-${id}-merged-${crypto.randomUUID()}`;
      const outputNode: Node = {
        id: outputNodeId,
        type: CANVAS_NODE_TYPES.upload,
        position: { x: nodeX + 560, y: nodeY },
        data: {
          displayName: `${rows}×${cols} 电影连拍分镜图`,
          imageUrl: null,
          previewImageUrl: null,
          aspectRatio: cellAspectRatio,
          isSizeManuallyAdjusted: false,
          sourceFileName: null,
          isGenerating: true,
          generationStartedAt: Date.now(),
          expectedDurationMs: modelDef.expectedDurationMs || 90000,
        },
      };
      store.addNode(outputNode);

      const newEdge: Edge = {
        id: outputNodeId,
        source: id,
        target: outputNodeId,
        type: "dataFlow",
      };
      store.addEdge(newEdge);
    } else {
      updateNodeData(outputNodeId, {
        isGenerating: true,
        imageUrl: null,
        previewImageUrl: null,
        generationStartedAt: Date.now(),
        expectedDurationMs: modelDef.expectedDurationMs || 90000,
        displayName: `${rows}×${cols} 电影连拍分镜图`,
      });
    }

    try {
      const { requestModel } = modelDef.resolveRequest({
        referenceImageCount: (referencedImages || []).length,
      });

      // Use selectedProviderId (user's channel) not modelDef.providerId
      const effectiveProviderId = selectedProviderId || modelDef.providerId;

      console.log("[StoryboardGenNode] Submitting generation:", {
        model: `${effectiveProviderId}/${requestModel}`,
        aspectRatio: cellAspectRatio,
        size: effectiveSize,
        referenceImageCount: (referencedImages || []).length,
        promptPreview: mergedPrompt.slice(0, 100),
        poolEntryCount: pool.entries.length,
        refNumbersUsed: Array.from(allRefNumbers),
      });

      const styleExtraParams = { ...(nodeData.extraParams || {}) } as Record<string, unknown>;
      if (nodeData.styleType) {
        styleExtraParams.artStylePrompt = STORYBOARD_STYLE_PROMPTS[nodeData.styleType];
      }

      const jobId = await tauriAiGateway.submitGenerateImageJob({
        model: `${effectiveProviderId}/${requestModel}`,
        prompt: mergedPrompt,
        size: effectiveSize,
        aspectRatio: cellAspectRatio,
        referenceImages: referencedImages,
        extraParams: styleExtraParams,
      });

      // Track this job for progress event filtering
      activeJobsRef.current.add(jobId);

      // Poll until completion (setTimeout recursion)
      await new Promise<void>((resolve) => {
        const pollStart = Date.now();
        let stopped = false;

        const poll = async () => {
          if (stopped) return;
          try {
            if (Date.now() - pollStart > MAX_POLL_TIME) {
              stopped = true;
              activeJobsRef.current.delete(jobId);
              updateNodeData(outputNodeId!, { isGenerating: false, displayName: `${rows}×${cols} 电影连拍分镜图`, generationError: "分镜生成超时（15分钟）" });
              showError("分镜生成超时（15分钟）");
              updateNodeData(id, { isGenerating: false });
              if (shouldUseCreditsRef.current) { tauriAiGateway.refundImageCredits(jobId, selectedProviderId); await useCreditsStore.getState().fetchBalance(); }
              resolve(); return;
            }

            const status = await tauriAiGateway.getGenerateImageJob(jobId);
            (window as any)[`__pollErr_${id}`] = 0;
            if (status.progress !== undefined && status.progress >= 0) {
              updateNodeData(id, { progressPercent: Math.round(status.progress) });
            }

            if (status.result) {
              stopped = true;
              activeJobsRef.current.delete(jobId);
              let resultUrl = status.result;
              updateNodeData(outputNodeId!, { imageUrl: resultUrl, isGenerating: false, displayName: `${rows}×${cols} 电影连拍分镜图`, generationError: undefined });
              updateNodeData(id, { isGenerating: false, progressPercent: 0, imageUrl: resultUrl });
              const currentF = [...(useCanvasStore.getState().nodes.find((n) => n.id === id)?.data as unknown as StoryboardGenNodeData)?.frames || []];
              for (let i = 0; i < currentF.length; i++) { currentF[i] = { ...currentF[i], imageUrl: resultUrl }; }
              updateNodeData(id, { frames: currentF, isGenerating: false, imageUrl: resultUrl });
              (async () => {
                try { let p = resultUrl; if (resultUrl.startsWith("data:") || resultUrl.startsWith("http")) { try { const lp = await persistImageSource(resultUrl) as string; if (lp && lp !== resultUrl) { p = lp; const curFrames = [...(useCanvasStore.getState().nodes.find((n) => n.id === id)?.data as unknown as StoryboardGenNodeData)?.frames || []]; let fc = false; for (let i = 0; i < curFrames.length; i++) { if (curFrames[i].imageUrl === resultUrl) { curFrames[i] = { ...curFrames[i], imageUrl: lp }; fc = true; } } if (fc) updateNodeData(id, { frames: curFrames, imageUrl: lp }); updateNodeData(outputNodeId!, { imageUrl: lp }); } } catch {} } try { const prep = await prepareNodeImageSource(p, 0) as any; updateNodeData(outputNodeId!, { imageWidth: prep.width, imageHeight: prep.height }); } catch {} } catch {}
              })();
              resolve(); return;
            }

            if (status.status === "succeeded") {
              stopped = true;
              activeJobsRef.current.delete(jobId);
              updateNodeData(outputNodeId!, { isGenerating: false, displayName: `${rows}×${cols} 电影连拍分镜图`, generationError: "后端返回空结果" });
              showError("分镜生成失败: 后端返回空结果"); updateNodeData(id, { isGenerating: false });
              if (shouldUseCreditsRef.current) { tauriAiGateway.refundImageCredits(jobId, selectedProviderId); await useCreditsStore.getState().fetchBalance(); }
              resolve();
            } else if (status.status === "failed" || (status.error && !status.result)) {
              stopped = true;
              activeJobsRef.current.delete(jobId);
              const errorMsg = status.error || "未知错误";
              updateNodeData(outputNodeId!, { isGenerating: false, displayName: "生成失败", generationError: errorMsg });
              showError("分镜生成失败: " + errorMsg); updateNodeData(id, { isGenerating: false });
              if (shouldUseCreditsRef.current) { tauriAiGateway.refundImageCredits(jobId, selectedProviderId); await useCreditsStore.getState().fetchBalance(); }
              resolve();
            } else { if (!stopped) setTimeout(poll, POLL_INTERVAL); }
          } catch (e) {
            console.error("Poll error:", e);
            const pollErrKey = `__pollErr_${id}`;
            const prevCount = (window as any)[pollErrKey] || 0;
            (window as any)[pollErrKey] = prevCount + 1;
            if (prevCount + 1 >= 5) {
              stopped = true;
              activeJobsRef.current.delete(jobId);
              const errMsg = e instanceof Error ? e.message : String(e);
              updateNodeData(outputNodeId!, { isGenerating: false, generationError: errMsg || "轮询出错过多，已停止" });
              showError("轮询出错过多，已停止"); updateNodeData(id, { isGenerating: false });
              if (shouldUseCreditsRef.current) { tauriAiGateway.refundImageCredits(jobId, selectedProviderId); await useCreditsStore.getState().fetchBalance(); }
              resolve();
            } else { if (!stopped) setTimeout(poll, POLL_INTERVAL); }
          }
        };
        setTimeout(poll, 0);
      });
    } catch (e) {
      showError("分镜提交失败: " + e);
      updateNodeData(outputNodeId!, {
        isGenerating: false,
        displayName: `${rows}×${cols} 电影连拍分镜图`,
      });
      updateNodeData(id, { isGenerating: false });
    }
  }, [
    id, rows, cols, nodeData, pool, updateNodeData, showError,
  ]);

  // ---------------------------------------------------------------------------
  // handleGenerateAllFrames — generate each frame individually (batch)
  // ---------------------------------------------------------------------------
  const handleGenerateAllFrames = useCallback(async () => {
    if (nodeData.isGenerating || isBatching) return;
    const currentFrames = nodeData.frames || [];
    const validFrames = currentFrames
      .map((f, i) => ({ ...f, frameIndex: i }))
      .filter((f) => stripReferenceMarkers(sanitizePromptText(f.description)).length > 0);

    if (validFrames.length === 0) { showError("请先填写分镜描述"); return; }

    setIsBatching(true);
    setBatchProgress({ done: 0, total: validFrames.length });
    updateNodeData(id, { isGenerating: true });

    const eModelId = nodeData.model || DEFAULT_MODEL_ID;
    let modelDef = getModelById(eModelId);
    if (!modelDef && isCustomProvider) modelDef = createFallbackModelDefinition(eModelId, selectedProviderId);
    if (!modelDef) { showError("未找到模型配置"); setIsBatching(false); updateNodeData(id, { isGenerating: false }); return; }

    const eProviderId = selectedProviderId || modelDef.providerId;
    const settings = useSettingsStore.getState();
    let config = settings.providers.find((p) => p.id === eProviderId && p.apiKey);
    if (!config) config = settings.providers.find((p) => p.channel === eProviderId && p.apiKey);
    if (!config) { const cp = settings.customProviders.find((p) => p.id === eProviderId && p.apiKey); if (cp) config = { id: cp.id, name: cp.name, apiKey: cp.apiKey, baseUrl: cp.baseUrl, enabled: true, channel: eProviderId } as any; }
    if (config?.apiKey?.trim()) { await setApiKey(eProviderId, config.apiKey.trim()); if (config.baseUrl?.trim()) await setBaseUrl(eProviderId, config.baseUrl.trim()); }

    const effectiveSize = (nodeData.size as ImageSize) || modelDef.defaultSize;
    const cellAspectRatio = nodeData.cellAspectRatio || nodeData.overallAspectRatio || "1:1";
    const styleExtraParams = { ...(nodeData.extraParams || {}) } as Record<string, unknown>;
    if (nodeData.styleType) styleExtraParams.artStylePrompt = STORYBOARD_STYLE_PROMPTS[nodeData.styleType];

    for (const frame of validFrames) {
      try {
        const sanitized = stripReferenceMarkers(sanitizePromptText(frame.description));
        const { nodes: freshN, edges: freshE } = useCanvasStore.getState();
        const freshPool = buildReferenceImagePool(id, freshN, freshE, assetPool, persistedAssets, Infinity);
        const refNums = collectReferencedImageNumbers(frame.description);
        const refImgs = resolveReferenceImagesForPrompt("", freshPool, refNums);
        let prompt = `分镜${frame.frameIndex + 1}：${sanitized}`;
        if (refImgs && refImgs.length > 0) prompt = `参考提供的图片，${prompt}`;

        const { requestModel } = modelDef!.resolveRequest({ referenceImageCount: (refImgs || []).length });

        const jobId = await tauriAiGateway.submitGenerateImageJob({
          model: `${eProviderId}/${requestModel}`,
          prompt, size: effectiveSize, aspectRatio: cellAspectRatio,
          referenceImages: refImgs, extraParams: styleExtraParams,
        });
        activeJobsRef.current.add(jobId);
        // Store jobId on frame so it survives reload/timeout for recovery
        (() => {
          const curFrames = [...(useCanvasStore.getState().nodes.find((n) => n.id === id)?.data as unknown as StoryboardGenNodeData)?.frames || []];
          if (curFrames[frame.frameIndex]) {
            curFrames[frame.frameIndex] = { ...curFrames[frame.frameIndex], generationJobId: jobId };
            updateNodeData(id, { frames: curFrames });
          }
        })();

        await new Promise<void>((resolve) => {
          const start = Date.now(); let stopped = false;
          const poll = async () => {
            if (stopped) return;
            try {
              if (Date.now() - start > MAX_POLL_TIME) {
                stopped = true; activeJobsRef.current.delete(jobId);
                // Don't refund — API may still be processing, task could complete later
                resolve(); return;
              }
              const status = await tauriAiGateway.getGenerateImageJob(jobId);
              if (status.result) {
                stopped = true; activeJobsRef.current.delete(jobId);
                let url = status.result;
                if (url.startsWith("data:") || url.startsWith("http")) { try { const lp = await persistImageSource(url) as string; if (lp) url = lp; } catch (e) { console.error("[分镜生图] 轮询结果保存图片失败:", e); } }
                const curFrames = [...(useCanvasStore.getState().nodes.find((n) => n.id === id)?.data as unknown as StoryboardGenNodeData)?.frames || []];
                if (curFrames[frame.frameIndex]) { curFrames[frame.frameIndex] = { ...curFrames[frame.frameIndex], imageUrl: url }; }
                updateNodeData(id, { frames: curFrames });
                setBatchProgress((p) => ({ ...p, done: p.done + 1 }));
                resolve();
              } else if (status.status === "failed") {
                stopped = true; activeJobsRef.current.delete(jobId);
                if (shouldUseCreditsRef.current) { try { await tauriAiGateway.refundImageCredits(jobId, eProviderId); } catch {} }
                setBatchProgress((p) => ({ ...p, done: p.done + 1 }));
                resolve();
              } else if (!stopped) setTimeout(poll, POLL_INTERVAL);
            } catch (e) { console.error("[分镜生图] 轮询请求失败:", e); if (!stopped) setTimeout(poll, POLL_INTERVAL); }
          };
          setTimeout(poll, 0);
        });
      } catch (e) { console.error("[分镜生图] 提交生图任务失败:", e); setBatchProgress((p) => ({ ...p, done: p.done + 1 })); }
    }
    setIsBatching(false);
    updateNodeData(id, { isGenerating: false });
  }, [id, nodeData, isBatching, pool, updateNodeData, showError, assetPool, persistedAssets, selectedProviderId]);

  // ── Retry a single frame ──
  const handleRetrySingleFrame = useCallback(async (frameIndex: number) => {
    if (nodeData.isGenerating || isBatching) return;
    const currentFrames = nodeData.frames || [];
    const frame = currentFrames[frameIndex];
    if (!frame) return;

    // If frame has stored jobId, poll existing job instead of creating new one
    if (frame.generationJobId && !frame.imageUrl) {
      setIsBatching(true);
      setBatchProgress({ done: 0, total: 1 });
      try {
        const status = await tauriAiGateway.queryTaskToken(frame.generationJobId);
        if (status.result) {
          let url = status.result;
          if (url.startsWith("data:") || url.startsWith("http")) { try { const lp = await persistImageSource(url) as string; if (lp) url = lp; } catch {} }
          const curFrames = [...(nodeData.frames || [])];
          if (curFrames[frameIndex]) { curFrames[frameIndex] = { ...curFrames[frameIndex], imageUrl: url, generationJobId: null }; }
          updateNodeData(id, { frames: curFrames });
        } else if (status.status === "failed") {
          const curFrames = [...(nodeData.frames || [])];
          if (curFrames[frameIndex]) { curFrames[frameIndex] = { ...curFrames[frameIndex], generationJobId: null }; }
          updateNodeData(id, { frames: curFrames });
        }
      } catch {}
      setIsBatching(false);
      updateNodeData(id, { isGenerating: false });
      return;
    }

    if (!stripReferenceMarkers(sanitizePromptText(frame.description))) return;

    setIsBatching(true);
    setBatchProgress({ done: 0, total: 1 });
    updateNodeData(id, { isGenerating: true });

    const eModelId = nodeData.model || DEFAULT_MODEL_ID;
    let modelDef = getModelById(eModelId);
    if (!modelDef && isCustomProvider) modelDef = createFallbackModelDefinition(eModelId, selectedProviderId);
    if (!modelDef) { showError("未找到模型配置"); setIsBatching(false); updateNodeData(id, { isGenerating: false }); return; }

    const eProviderId = selectedProviderId || modelDef.providerId;
    const settings = useSettingsStore.getState();
    let config = settings.providers.find((p) => p.id === eProviderId && p.apiKey);
    if (!config) config = settings.providers.find((p) => p.channel === eProviderId && p.apiKey);
    if (!config) { const cp = settings.customProviders.find((p) => p.id === eProviderId && p.apiKey); if (cp) config = { id: cp.id, name: cp.name, apiKey: cp.apiKey, baseUrl: cp.baseUrl, enabled: true, channel: eProviderId } as any; }
    if (config?.apiKey?.trim()) { await setApiKey(eProviderId, config.apiKey.trim()); if (config.baseUrl?.trim()) await setBaseUrl(eProviderId, config.baseUrl.trim()); }

    const effectiveSize = (nodeData.size as ImageSize) || modelDef.defaultSize;
    const cellAspectRatio = nodeData.cellAspectRatio || nodeData.overallAspectRatio || "1:1";
    const styleExtraParams = { ...(nodeData.extraParams || {}) } as Record<string, unknown>;
    if (nodeData.styleType) styleExtraParams.artStylePrompt = STORYBOARD_STYLE_PROMPTS[nodeData.styleType];

    try {
      const sanitized = stripReferenceMarkers(sanitizePromptText(frame.description));
      const { nodes: freshN, edges: freshE } = useCanvasStore.getState();
      const freshPool = buildReferenceImagePool(id, freshN, freshE, assetPool, persistedAssets, Infinity);
      const refNums = collectReferencedImageNumbers(frame.description);
      const refImgs = resolveReferenceImagesForPrompt("", freshPool, refNums);
      let prompt = `分镜${frameIndex + 1}：${sanitized}`;
      if (refImgs && refImgs.length > 0) prompt = `参考提供的图片，${prompt}`;

      const { requestModel } = modelDef!.resolveRequest({ referenceImageCount: (refImgs || []).length });
      const jobId = await tauriAiGateway.submitGenerateImageJob({
        model: `${eProviderId}/${requestModel}`,
        prompt, size: effectiveSize, aspectRatio: cellAspectRatio,
        referenceImages: refImgs, extraParams: styleExtraParams,
      });
      activeJobsRef.current.add(jobId);
      (() => {
        const curFrames = [...(useCanvasStore.getState().nodes.find((n) => n.id === id)?.data as unknown as StoryboardGenNodeData)?.frames || []];
        if (curFrames[frameIndex]) { curFrames[frameIndex] = { ...curFrames[frameIndex], generationJobId: jobId }; updateNodeData(id, { frames: curFrames }); }
      })();

      await new Promise<void>((resolve) => {
        const start = Date.now(); let stopped = false;
        const poll = async () => {
          if (stopped) return;
          try {
            if (Date.now() - start > MAX_POLL_TIME) {
              stopped = true; activeJobsRef.current.delete(jobId);
              resolve(); return;
            }
            const status = await tauriAiGateway.getGenerateImageJob(jobId);
            if (status.result) {
              stopped = true; activeJobsRef.current.delete(jobId);
              let url = status.result;
              if (url.startsWith("data:") || url.startsWith("http")) { try { const lp = await persistImageSource(url) as string; if (lp) url = lp; } catch {} }
              const curFrames = [...(useCanvasStore.getState().nodes.find((n) => n.id === id)?.data as unknown as StoryboardGenNodeData)?.frames || []];
              if (curFrames[frameIndex]) { curFrames[frameIndex] = { ...curFrames[frameIndex], imageUrl: url }; }
              updateNodeData(id, { frames: curFrames });
              resolve();
            } else if (status.status === "failed") {
              stopped = true; activeJobsRef.current.delete(jobId);
              if (shouldUseCreditsRef.current) { try { await tauriAiGateway.refundImageCredits(jobId, eProviderId); } catch {} }
              resolve();
            } else if (!stopped) setTimeout(poll, POLL_INTERVAL);
          } catch (e) { console.error("[分镜生图] 重试轮询失败:", e); if (!stopped) setTimeout(poll, POLL_INTERVAL); }
        };
        setTimeout(poll, 0);
      });
    } catch (e) { console.error("[分镜生图] 重试提交失败:", e); }
    setIsBatching(false);
    updateNodeData(id, { isGenerating: false });
  }, [id, nodeData, updateNodeData, showError, assetPool, persistedAssets, selectedProviderId, isCustomProvider]);


  // ── Listen for real-time progress events from Rust (same as ImageEditNode) ──
  useEffect(() => {
    let unlisten1: (() => void) | undefined;
    let unlisten2: (() => void) | undefined;
    import("@/features/canvas/compat/event").then(({ listen }) => {
      // 1) grsai/credits API progress (via DB + atomic)
      listen<{ jobId: string; progress: number }>("generation-progress", (event) => {
        const { jobId, progress } = event.payload;
        if (activeJobsRef.current.has(jobId) && progress >= 0) {
          // StoryboardGenNode uses a single merged output node, update progress on the node
          updateNodeData(id, { progressPercent: Math.round(progress) });
        }
      }).then((fn) => { unlisten1 = fn; });

      // 2) jimeng browser automation progress (Playwright stdout line-by-line)
      listen<{ percent: number; stage: string; message: string }>("jimeng-browser-progress", (event) => {
        const { percent } = event.payload;
        if (nodeData.isGenerating && percent >= 0) {
          updateNodeData(id, { progressPercent: Math.round(percent) });
        }
      }).then((fn) => { unlisten2 = fn; });
    });
    return () => { unlisten1?.(); unlisten2?.(); };
  }, [id, updateNodeData, nodeData.isGenerating]);

  // ── Also update progress from API polling (status.progress) ──
  // Added inside the poll timer callback below (in handleGenerateAll)

  const totalFrames = rows * cols;

  return (
    <>
    <NodeDeleteButton id={id} selected={selected ?? false}>
      {nodeData.imageUrl && (
        <button
          className="nodrag"
          onClick={() => setShowImageEditor(true)}
          style={{
            display: "flex", alignItems: "center", gap: "6px",
            padding: "6px 14px", borderRadius: "10px",
            backgroundColor: "var(--bg-node)", border: "1px solid var(--border)",
            color: "var(--text-primary)", fontSize: "12px", fontWeight: 500,
            cursor: "pointer", backdropFilter: "blur(8px)",
            transition: "all 0.2s ease", boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
          }}
          title="编辑图片"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <span>编辑</span>
        </button>
      )}
    </NodeDeleteButton>
    {/* Image editor dialog */}
    {showImageEditor && nodeData.imageUrl && (
      <ImageEditorDialog
        imageUrl={nodeData.imageUrl}
        onSave={async (editedUrl) => {
          if (editedUrl) {
            try {
              const persistedPath = (await persistImageSource(editedUrl)) as string;
              updateNodeData(id, { imageUrl: persistedPath });
            } catch {
              updateNodeData(id, { imageUrl: editedUrl });
            }
          }
          setShowImageEditor(false);
        }}
        onClose={() => setShowImageEditor(false)}
      />
    )}
    <div style={{ position: 'relative' }}>
    <div
      className="node-inner"
      style={{
        backgroundColor: 'var(--bg-node)',
        border: '1px solid var(--border)',
        boxShadow: '0 2px 12px rgba(0,0,0,.3)',
        borderRadius: 'var(--node-radius)',
        width: nodeWidth,
        height: nodeHeight,
        minHeight: '300px',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        /* overflow controlled by CSS: hidden by default, visible when popup is open */
      }}
    >
      {/* Header — matches ImageEditNode style */}
      <div className="flex items-center justify-between" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="2" ry="2"/>
            <path d="M2 8h20"/>
            <path d="M10 8v14"/>
            <circle cx="6" cy="5" r="1.5" fill="var(--text-secondary)"/>
            <circle cx="15" cy="5" r="1.5" fill="var(--text-secondary)"/>
          </svg>
          <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }} title={nodeData.displayName || "分镜生成"}>
            {nodeData.displayName || "分镜生成"}
          </span>
        </div>
      </div>

        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {/* ── Reference image strip ── */}
        {pool.entries.filter(e => e.mediaType !== "audio").length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, marginBottom: 4 }}>
              参考图片
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {pool.entries.filter(e => e.mediaType !== "audio" && (e.source === "upstream" || allRefNumbers.has(e.number))).slice(0, 9).map((entry) => (
                <div key={entry.number} style={{ width: 40, height: 40, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", overflow: "hidden", cursor: "default", position: "relative" }}>
                  <ReferenceThumbnailImg src={resolveReferenceThumbnailUrl(entry)} />
                  <div style={{ position: "absolute", bottom: 1, right: 2, fontSize: 8, color: "#fff", background: "rgba(0,0,0,0.5)", borderRadius: 3, padding: "0 3px", lineHeight: "14px" }}>@{entry.number}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Progress indicator when generating */}
        {nodeData.isGenerating && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', flexShrink: 0 }}>
            <span style={{ fontSize: '11px', color: 'var(--accent)', backgroundColor: 'var(--bg-hover)', borderRadius: '9999px', padding: '2px 10px' }}>生成中</span>
            {(nodeData.progressPercent as number) > 0 && (
              <span style={{ fontSize: '11px', color: 'var(--accent)', backgroundColor: 'var(--bg-hover)', borderRadius: '9999px', padding: '2px 8px' }}>{nodeData.progressPercent as number}%</span>
            )}
          </div>
        )}

        {/* ── GRID MODE (original UI, unchanged) ── */}        {/* Top bar: Row/Col controls + frame count */}
        <div className="flex items-center justify-between" style={{ marginBottom: '12px', flexShrink: 0 }}>
          <div className="flex items-center gap-2">
            {/* Row control */}
            <div
              className="flex items-center gap-1"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                borderRadius: '9999px',
                padding: '4px 10px',
                border: '1px solid var(--border)'
              }}
            >
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>行</span>
              <button
                className="nodrag"
                onClick={() => handleRowsChange(rows - 1)}
                style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 2px', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}
              >
                −
              </button>
              <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 500, minWidth: '16px', textAlign: 'center' }}>{rows}</span>
              <button
                className="nodrag"
                onClick={() => handleRowsChange(rows + 1)}
                style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 2px', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}
              >
                +
              </button>
            </div>
            {/* Col control */}
            <div
              className="flex items-center gap-1"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                borderRadius: '9999px',
                padding: '4px 10px',
                border: '1px solid var(--border)'
              }}
            >
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>列</span>
              <button
                className="nodrag"
                onClick={() => handleColsChange(cols - 1)}
                style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 2px', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}
              >
                −
              </button>
              <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 500, minWidth: '16px', textAlign: 'center' }}>{cols}</span>
              <button
                className="nodrag"
                onClick={() => handleColsChange(cols + 1)}
                style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 2px', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}
              >
                +
              </button>
            </div>
          </div>
          {/* Frame count badge */}
          <div
            className="flex items-center"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              borderRadius: '9999px',
              padding: '4px 12px',
              border: '1px solid var(--border)'
            }}
          >
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{totalFrames} 格</span>
          </div>
        </div>

        {/* Frame descriptions grid — fills remaining space, scrollable if needed */}
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridAutoRows: '1fr',
            backgroundColor: 'var(--border)',
            borderRadius: '8px',
            overflow: 'hidden',
            border: '1px solid var(--border)',
            gap: '1px',
            flex: 1,
            minHeight: 0,
          }}
        >
          {Array.from({ length: totalFrames }, (_, i) => {
            const frame = nodeData.frames?.[i];
            const currentStyle = nodeData.styleType || "2d-anime";
            return (
              <FrameDescriptionCell
                key={i}
                frameIndex={i}
                frame={frame}
                onDescriptionChange={handleFrameDescriptionChange}
                onFocus={(idx) => setActiveFrameIndex(idx)}
                pool={pool}
                styleLabel={STORYBOARD_STYLE_LABELS[currentStyle]}
                onCursorPosChange={(pos) => { frameCursorPosRef.current = pos; }}
                promptAssistantProviderId={selectedProviderId}
                duration={frame?.duration}
                onDurationChange={handleFrameDurationChange}
                onRetry={handleRetrySingleFrame}
              />
            );
          })}
        </div>

        {/* Total duration display */}
        <div style={{
          marginTop: '6px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: '11px', color: 'var(--text-tertiary)',
        }}>
          <span>总时长: {totalDuration}s</span>
          <span>{totalFrames}帧 × 平均{Math.round(totalDuration / totalFrames)}s</span>
        </div>

        {/* Prompt hint */}
        <div
          style={{
            marginTop: '10px',
            padding: '6px 10px',
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            fontSize: '11px',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            flexShrink: 0,
          }}
        >
          <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>提示词小抄：</span>
          每格写「镜号(景别/角度)+人物动作+表情+环境/光影」；输入 @ 引用素材
        </div>

        {/* Camera movement quick tags */}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', flexShrink: 0, marginBottom: '6px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginRight: '2px' }}>镜头运动</span>
          {[
            { label: '推轨', prompt: '推轨镜头(dolly shot)' },
            { label: '横移', prompt: '横移镜头(pan shot)' },
            { label: '仰拍', prompt: '仰拍镜头(low angle)' },
            { label: '俯拍', prompt: '俯拍镜头(high angle)' },
            { label: '跟拍', prompt: '跟拍镜头(tracking shot)' },
            { label: '旋转', prompt: '旋转镜头(rotating shot)' },
            { label: '手持', prompt: '手持镜头(handheld shot)' },
            { label: '航拍', prompt: '航拍镜头(aerial shot)' },
            { label: '特写', prompt: '特写镜头(close-up)' },
            { label: '远景', prompt: '远景镜头(wide shot)' },
          ].map((tag) => (
            <button
              key={tag.label}
              className="nodrag"
              onClick={() => {
                // Insert camera movement tag into active frame's description
                if (_activeFrameIndex !== null) {
                  const desc = nodeData.frames?.[_activeFrameIndex]?.description || "";
                  const newDesc = desc.trim() ? `${desc.trim()}，${tag.prompt}` : tag.prompt;
                  handleFrameDescriptionChange(_activeFrameIndex, newDesc);
                }
              }}
              style={{
                padding: '2px 8px',
                borderRadius: '9999px',
                fontSize: '10px',
                fontWeight: 400,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                border: '1px solid var(--border)',
                backgroundColor: 'transparent',
                color: 'var(--text-secondary)',
                transition: 'all 0.15s',
                lineHeight: '16px',
              }}
              title={`点击插入「${tag.prompt}」到当前活跃帧`}
            >{tag.label}</button>
          ))}
        </div>

        {/* Batch generation progress bar */}
        {isBatching && (
          <div style={{ flexShrink: 0, marginBottom: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              <span>逐帧生成中</span><span>{batchProgress.done}/{batchProgress.total}</span>
            </div>
            <div style={{ height: '4px', backgroundColor: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', backgroundColor: 'var(--accent-btn)', borderRadius: '2px', width: `${batchProgress.total > 0 ? (batchProgress.done / batchProgress.total) * 100 : 0}%`, transition: 'width 0.3s ease' }}></div>
            </div>
          </div>
        )}

        {/* Batch video generation button (appears when at least one frame has an image) */}
        {hasVideoReadyFrames && !isBatchVideo && (
          <button
            className="nodrag"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void handleBatchGenerateVideo();
            }}
            style={{
              flexShrink: 0, marginBottom: '8px',
              padding: '6px 14px', borderRadius: '8px',
              backgroundColor: 'var(--accent)',
              color: '#fff', fontSize: '12px', fontWeight: 500,
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px',
              width: 'fit-content',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            批量生视频 ({(nodeData.frames || []).filter(f => f.imageUrl).length}帧 → {videoReadyDuration}s)
          </button>
        )}
        {/* Batch video progress */}
        {isBatchVideo && (
          <div style={{ flexShrink: 0, marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--accent)', marginBottom: '4px' }}>
              <span>批量创建视频节点…</span><span>{batchVideoProgress.done}/{batchVideoProgress.total}</span>
            </div>
            <div style={{ height: '4px', backgroundColor: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', backgroundColor: 'var(--accent)', borderRadius: '2px', width: `${batchVideoProgress.total > 0 ? (batchVideoProgress.done / batchVideoProgress.total) * 100 : 0}%`, transition: 'width 0.3s ease' }}></div>
            </div>
          </div>
        )}

        {/* ── Grid mode bottom bar ── */}
        <div style={{ paddingTop: '12px', borderTop: '1px solid var(--border)', marginTop: '10px', flexShrink: 0 }}>
          {/* Style selector row */}
          <div className="flex items-center gap-1" style={{ marginBottom: '8px' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginRight: '4px' }}>风格</span>
            {(Object.keys(STORYBOARD_STYLE_PROMPTS) as StoryboardStyleType[]).map((style) => (
              <button
                key={style}
                className="nodrag"
                onClick={() => handleStyleChange(style)}
                style={{
                  padding: '3px 10px',
                  borderRadius: '9999px',
                  border: nodeData.styleType === style ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                  backgroundColor: nodeData.styleType === style ? 'var(--bg-hover)' : 'transparent',
                  color: nodeData.styleType === style ? 'var(--accent)' : 'var(--text-secondary)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  fontWeight: nodeData.styleType === style ? 500 : 400,
                  lineHeight: '18px',
                  whiteSpace: 'nowrap',
                }}
              >
                {STORYBOARD_STYLE_LABELS[style]}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            {/* Left: Channel + Model + Ratio/Size */}
            <div className="flex items-center gap-3">
              {/* Channel + Model selector */}
              <ChannelModelSelector
                selectedProviderId={selectedProviderId}
                selectedModelId={currentModelId}
                availableProviders={availableProviders}
                availableModels={availableModels}
                onProviderChange={handleProviderChange}
                onModelChange={handleModelChange}
                onMenuOpenChange={setAnyMenuOpen}
              />
              {/* ── 云智通道价格标签 ── */}
              {selectedProviderId === "yunzhi" && (() => {
                const modelShort = currentModelId.includes("/") ? currentModelId.split("/")[1] : currentModelId;
                const pricePerImage = IMAGE_CREDIT_PRICES[modelShort] || 30;
                const priceYuan = (pricePerImage / 100).toFixed(1);
                return <span className="nodrag" style={{ fontSize: '11px', color: '#7ab4f0', fontWeight: 500, flexShrink: 0, whiteSpace: 'nowrap' }}>{priceYuan}元/张</span>;
              })()}
              {/* Params trigger */}
              <div
                className="flex items-center gap-1 relative nodrag"
                style={{ color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer' }}
                onClick={() => setShowParamsPanel(!showParamsPanel)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                </svg>
                <span>{nodeData.overallAspectRatio || nodeData.aspectRatio || model?.defaultAspectRatio || "1:1"} · {(nodeData.size as ImageSize) || model?.defaultSize || "1K"}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </div>
            </div>
            {/* Right: Credits + Generate buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <button
                className="nodrag"
                onClick={handleGenerateAllFrames}
                disabled={!hasValidFrames || isBatching || (nodeData.isGenerating ?? false)}
                title="逐帧独立生成"
                style={{
                  padding: '4px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: 500,
                  backgroundColor: (hasValidFrames && !isBatching && !nodeData.isGenerating) ? 'var(--accent-btn)' : 'var(--bg-hover)',
                  color: (hasValidFrames && !isBatching && !nodeData.isGenerating) ? '#fff' : 'var(--text-muted)',
                  border: 'none', cursor: (hasValidFrames && !isBatching && !nodeData.isGenerating) ? 'pointer' : 'not-allowed',
                  whiteSpace: 'nowrap',
                }}
              >
                {isBatching ? `${batchProgress.done}/${batchProgress.total}` : `逐帧生成`}
              </button>
              <button
                className="nodrag"
                onClick={handleGenerateAll}
                disabled={!hasValidFrames || isBatching || (nodeData.isGenerating ?? false)}
                title="合并宫格生成"
                style={{
                  width: '32px', height: '32px', borderRadius: '8px',
                  backgroundColor: (hasValidFrames && !isBatching && !nodeData.isGenerating) ? 'var(--accent)' : 'var(--bg-hover)',
                  color: (hasValidFrames && !isBatching && !nodeData.isGenerating) ? '#fff' : 'var(--text-muted)',
                  border: 'none', cursor: (hasValidFrames && !isBatching && !nodeData.isGenerating) ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.2s'
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5"/>
                  <polyline points="5 12 12 5 19 12"/>
                </svg>
              </button>
            </div>
            </div>
          </div>
        </div>



      </div>
    </div>

    {/* Params panel — placed outside node-inner to avoid overflow clipping */}
    {showParamsPanel && (
      <div
        className="nodrag"
        style={{
          position: 'absolute',
          bottom: 52,
          left: 170,
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          padding: '16px',
          zIndex: 50,
          width: '280px'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Size */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500, marginBottom: '10px' }}>分辨率</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {(["0.5K", "1K", "2K", "4K"] as ImageSize[]).map((s) => (
              <button
                key={s}
                onClick={() => { handleSizeChange(s); setShowParamsPanel(false); }}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: (nodeData.size as ImageSize) === s ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                  backgroundColor: (nodeData.size as ImageSize) === s ? 'var(--bg-hover)' : 'transparent',
                  color: (nodeData.size as ImageSize) === s ? 'var(--accent)' : 'var(--text-secondary)',
                  fontSize: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  fontWeight: (nodeData.size as ImageSize) === s ? 500 : 400
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        {/* Aspect Ratio */}
        <div>
          <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500, marginBottom: '10px' }}>比例</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
            {["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21", "1:2", "2:1"].map((r) => (
              <button
                key={r}
                onClick={() => { handleAspectRatioChange(r); setShowParamsPanel(false); }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '3px',
                  padding: '6px 4px',
                  borderRadius: '8px',
                  border: (nodeData.overallAspectRatio || nodeData.aspectRatio) === r ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                  backgroundColor: (nodeData.overallAspectRatio || nodeData.aspectRatio) === r ? 'var(--bg-hover)' : 'transparent',
                  color: (nodeData.overallAspectRatio || nodeData.aspectRatio) === r ? 'var(--accent)' : 'var(--text-secondary)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  minHeight: '42px'
                }}
              >
                <span style={{ fontSize: '14px', lineHeight: 1 }}>{r}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )}

    <NodeResizeHandle width={nodeWidth} height={nodeHeight} onResize={handleResize} minWidth={520} maxWidth={900} minHeight={400} maxHeight={1200} />
    </div>

      {/* Feature 6: Fullscreen image viewer */}
      {viewerImages && (
        <ImageViewerModal
          images={viewerImages}
          initialIndex={viewerIndex}
          onClose={() => setViewerImages(null)}
        />
      )}

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
// FrameDescriptionCell — frame description cell with image preview + regenerate
// ---------------------------------------------------------------------------

const FrameDescriptionCell = memo(function FrameDescriptionCell({
  frameIndex,
  frame,
  onDescriptionChange,
  onFocus,
  pool,
  styleLabel,
  onCursorPosChange,
  promptAssistantProviderId = "grsai",
  duration,
  onDurationChange,
  onRetry,
}: {
  frameIndex: number;
  frame?: StoryboardFrame;
  onDescriptionChange: (frameIndex: number, description: string) => void;
  textareaRef?: (el: HTMLTextAreaElement | null) => void;
  onFocus?: (frameIndex: number) => void;
  pool: ReferenceImagePoolResult;
  styleLabel?: string;
  onCursorPosChange?: (pos: number) => void;
  promptAssistantProviderId?: string;
  duration?: number;
  onDurationChange?: (frameIndex: number, duration: number) => void;
  onRetry?: (frameIndex: number) => void;
}) {
  const description = frame?.description || "";

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        borderRadius: '8px',
        border: '1px solid var(--border)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Thumbnail area */}
      <div
        style={{
          height: 80,
          flexShrink: 0,
          backgroundColor: frame?.imageUrl ? 'transparent' : 'var(--bg-secondary)',
          borderRadius: '6px 6px 0 0',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {frame?.imageUrl ? (
          <img
            src={resolveImageDisplayUrl(frame.imageUrl)}
            alt={`帧 ${frameIndex + 1}`}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            draggable={false}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : frame?.generationJobId ? (
          <div style={{ fontSize: '10px', color: 'var(--accent)', textAlign: 'center', lineHeight: '1.4' }}>
            排队中
            <br/><span style={{ fontSize: '9px', opacity: 0.6 }}>点击检查</span>
          </div>
        ) : (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        )}
        {/* Retry button — shown when frame has description but no image */}
        {onRetry && frame?.description && !frame?.imageUrl && (
          <button
            className="nodrag"
            onClick={() => onRetry(frameIndex)}
            title={frame?.generationJobId ? "检查排队结果" : "重新生成这一帧"}
            style={{
              position: 'absolute', bottom: '4px', right: '4px',
              width: '22px', height: '22px', borderRadius: '4px',
              border: '1px solid var(--border)', background: 'rgba(0,0,0,0.5)',
              color: 'var(--accent)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '12px', lineHeight: 1,
            }}
          >{frame?.generationJobId ? '⌛' : '↻'}</button>
        )}
      </div>
      {/* Frame number label + style badge + description input */}
      <div style={{ padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 500 }}>#{String(frameIndex + 1).padStart(2, "0")}</span>
          {styleLabel && (
            <span style={{
              fontSize: '9px',
              color: 'var(--accent)',
              backgroundColor: 'var(--bg-hover)',
              padding: '0 5px',
              borderRadius: '9999px',
              lineHeight: '14px',
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}>
              {styleLabel}
            </span>
          )}
          <select
            className="nodrag"
            value={duration ?? 5}
            onChange={(e) => onDurationChange?.(frameIndex, Number(e.target.value))}
            style={{
              fontSize: '9px',
              border: '0.5px solid var(--border)',
              borderRadius: '4px',
              background: 'var(--bg-surface)',
              color: 'var(--text-muted)',
              padding: '0 2px',
              height: '16px',
              appearance: 'auto',
              marginLeft: 'auto',
            }}
          >
            {[1, 2, 3, 4, 5, 6, 8, 10, 15].map(s => (
              <option key={s} value={s}>{s}s</option>
            ))}
          </select>
        </div>
        <RichPromptInput
          value={description}
          onChange={(v) => onDescriptionChange(frameIndex, v)}
          onFocus={() => onFocus?.(frameIndex)}
          onCursorPosChange={(pos) => { onCursorPosChange?.(pos); }}
          placeholder="分镜描述…"
          maxLength={5000}
          pool={pool}
          minHeight={40}
          maxHeight={0}
          showStrip={false}
          style={{
            flex: 1,
            minHeight: 0,
            borderRadius: '6px',
            padding: 0,
          }}
          showPromptAssistant
          promptAssistantProviderId={promptAssistantProviderId}
        />
      </div>
    </div>
  );
});


