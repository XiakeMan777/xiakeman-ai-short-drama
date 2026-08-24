import { useState, useCallback, useEffect, useRef, useMemo, memo } from "react";
import { type NodeProps, Handle, Position, type Node } from "@xyflow/react";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { CANVAS_NODE_TYPES, type StoryboardStyleType, STORYBOARD_STYLE_PROMPTS, STORYBOARD_STYLE_LABELS } from "../domain/canvasNodes";
import { useErrorStore } from "@/features/canvas/compat/ErrorDialog";
import { useUpstreamDataKey } from "../hooks/useUpstreamNodes";
import { NodeDeleteButton } from "./NodeDeleteButton";
import type { ImageEditNodeData } from "../domain/canvasNodes";
import { tauriAiGateway } from "../infrastructure/tauriAiGateway";
import {
  buildReferenceImagePool,
  buildAssetImagePool,
  normalizeUrl,
  resolveReferenceThumbnailUrl,
  type ReferenceImageEntry,
} from "../application/referenceImagePool";
import {
  stripReferenceMarkers,
  collectReferencedImageNumbers,
  removeReferenceTokenByNumber,
} from "../application/referenceTokenEditing";
import { extractDisplayName } from "../application/imageData";
import { getAllModels, getModelById, DEFAULT_MODEL_ID, resolveModelId, createFallbackModelDefinition } from "../models/registry";
import { useChannelModelSelector, type ModelOption } from "../hooks/useChannelModelSelector";
import { ChannelModelSelector } from "../ui/ChannelModelSelector";
import type { ImageSize } from "../models/image/types";
import { RichPromptInput } from "../ui/RichPromptInput";
import { NodeResizeHandle } from "../ui/NodeResizeHandle";
import { useSettingsStore } from "@/features/canvas/stores/settingsStore";
import type { ImageModelDefinition } from "../models/image/types";
import { IMAGE_CREDIT_PRICES } from "../application/creditPricing";
import { persistImageSource, prepareNodeImageSource } from "@/features/canvas/compat/commands";
import { useAssetStore } from "@/features/canvas/stores/assetStore";
import { ImageEditorDialog } from "../ui/ImageEditorDialog";
import { resolveImageDisplayUrl } from "../application/imageData";

// ─── Constants ────────────────────────────────────────────────────────────

/** Simple thumbnail image for reference strip — uses convertFileSrc via resolveReferenceThumbnailUrl */
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
const MAX_POLL_TIME = 15 * 60 * 1000;
const DEFAULT_NODE_WIDTH = 520;
const DEFAULT_NODE_HEIGHT = 400;
const MIN_NODE_WIDTH = 520;
const MAX_NODE_WIDTH = 900;
const MIN_NODE_HEIGHT = 300;
const MAX_NODE_HEIGHT = 1200;

const ALL_ASPECT_RATIOS = [
  { value: "auto", label: "自适应", icon: "□" },
  { value: "1:1", label: "1:1", icon: "□" },
  { value: "9:16", label: "9:16", icon: "▯" },
  { value: "16:9", label: "16:9", icon: "▭" },
  { value: "3:4", label: "3:4", icon: "▯" },
  { value: "4:3", label: "4:3", icon: "▭" },
  { value: "3:2", label: "3:2", icon: "▭" },
  { value: "2:3", label: "2:3", icon: "▯" },
  { value: "4:5", label: "4:5", icon: "▯" },
  { value: "5:4", label: "5:4", icon: "▭" },
  { value: "21:9", label: "21:9", icon: "▭" },
];

const SIZE_OPTIONS = [
  { value: "1K" as ImageSize, label: "1K" },
  { value: "2K" as ImageSize, label: "2K" },
  { value: "4K" as ImageSize, label: "4K" },
];

// ─── Style Presets ────────────────────────────────────────────────────────

export interface ImageStylePreset {
  key: string;
  label: string;
  prompt?: string;
}

const STYLE_PRESETS: ImageStylePreset[] = [
  {
    key: "portrait",
    label: "人物四视图",
    prompt: "纯白背景，全身正面站立形象，双手自然下垂至身体两侧。从左到右依次生成【正脸头肩特写，全身正面视图，全身侧面视图，全身背面视图】，生成在一张图上。四格保持角色外形服装完全一致。人物形象：",
  },
  {
    key: "storyboard",
    label: "故事板",
    prompt: "故事板提示：\n全篇提示词用中文\n\n创建一个电影制作板/视觉规划表，比例16:9，展示短片或商业广告的完整。布局应简洁、基于网格，并分为清晰标记的部分。包含：\n共享创意指导（顶部栏）：整体限制，如镜头数量、统一的调色板和一般的环境背景。\n角色与风格参考部分：一个从多个角度展示的模型（正面、背面、侧面、特写、放松姿态），配有服装和配饰参考。强调身份的一致性，同时允许在特定场景中进行细微变化。\n环境和场景设计部分：一个具有戏剧性自然特征的场景户外地点，以及一个俯视示意图，说明在空间中的移动路径。包括摄像机位置和沿路线标注的拍摄类型。\n故事板部分：一系列编号的帧（大约 8 个镜头）展示场景的进展。每个帧包括：摄像机类型/镜头感觉、镜头大小（广角、中景、特写、微距）、运动方式（静态、跟踪、手持等）、动作和情绪进展的简要描述。\n灯光/情绪/风格备注：与灯光条件、氛围和纹理相关的视觉示例和简短描述。包括一天中不同时间的过渡和光线质量的变化。\n情绪和关键词块：指导作品的简洁情绪基调主题描述列表。\n音频/音调部分：环境声音、音乐风格和整体声音氛围的指示。\n电影摄影笔记：包括镜头特性、运动风格和后期处理感觉的总体视觉哲学。\n整个版面应感觉连贯、电影化且专业设计——就像导演的预制作指南，能一眼传达出基调、节奏和视觉叙事。\n剧情描述：",
  },
  {
    key: "panorama360",
    label: "GPT生360全景图",
    prompt: "生成该图的360全景图，360度水平无死角，180度垂直全视角覆盖，画面完整连贯.首尾无缝衔接，无畸变.无拉伸.无黑边.无裁切",
  },
  {
    key: "multi-grid",
    label: "多宫格",
    prompt: "【系统指令：多角度专业摄影作品集生成器（终极版）】\n设定与目标：\n你是一个顶级的AI电影摄影师和图像生成专家。你的任务是按照严格的三个阶段，为用户生成具有 100% 绝对一致性 的专业摄影作品集。核心在于建立一个\"一致性锚点\"，并在后续的网格和单张大图中完美复刻该锚点的人物特征、服装、环境和光影基调。\n\n🛠️ 核心执行流程：\n阶段一：建立【参考图 0】(核心一致性锚点)\n操作：根据用户的描述，首先生成一张超高清的基准图像，我们称之为【参考图 0】。\n要求：这张图必须明确界定人物的长相、身材、服装、主要道具以及核心环境基调。这是后续所有生成的\"绝对基因库\"。\n\n阶段二：生成 3x5 摄影预览网格图 (15个分镜)\n操作：严格基于【参考图 0】的元素，生成一张包含 15 个不同拍摄角度的 3x5 拼图网格（3行5列）的完整图像。\n构图与一致性：人物在每个分格中的构图大小协调，面部神态自然过渡。确保网格内容不重复，且同一网格内不出现重复的\"克隆人\"。\n15个指定视角（随机分布于网格中）：\nFront Extreme Close-Up: 浅景深眼部或面部极端特写。\nMid-Shot from an angle: 非正面角度的中景，交代部分背景。\nLow Angle (Action/Dynamic Shot): 低角度仰拍，带有环境中的动态感。\nOver-the-shoulder Shot (Cinematic): 越过前景模糊物体（或肩膀）的过肩镜头，焦点在主体。\nOverhead/Top-Down View: 从正上方的俯视镜头，展现人物与所处环境的空间关系。\nLeft Profile 90° (Dramatic): 左侧90度轮廓，强调光影对比、逆光或剪影。\nRight Profile 90° Close-Up: 右侧90度精致面部特写。\nGrand Environmental/Bird's Eye View: 远景/鸟瞰，人物化为宏大环境中的一个元素。\nDutch Tilt/Dynamic Street Shot: 荷兰角（倾斜构图），传达张力或动感。\nLow-key/Abstract/Atmospheric Shot: 低调/暗调摄影，利用逆光强调氛围、轮廓或局部细节。\nClose-Up Details/Macro Shot: 非面部细节特写（如服饰纹理、手表、首饰、手部动作）。\nLeft-side Over-the-shoulder Shot: 左侧视角的电影感过肩镜头。\nDirect Flash/High-key Shot: 强闪光灯直射/高调摄影，时尚杂志封面感。\nEnvironmental Wide-Shot: 充满电影叙事感的情景广角，传达特定情绪。\nExtreme Low Angle Through Elements: 极低角度，透过前景元素（如树枝、玻璃、织物）拍摄，增加画面纵深。\n\n阶段三：高清大图模式 (HIGH-RES MODE) - 后续触发\n触发条件：当用户发送指令 生成第 X 格的高清大图 (X 为 1-15) 时触发。\n图片样式：单张、完整的电影级渲染大图。\n内容要求：精确复制阶段二预览图中第 X 格的内容、机位构图和布光。\n画面升级：通过增加大量微小细节、真实物理纹理（如皮肤质感、衣物纤维）、超高分辨率（4K+）和电影胶片颗粒感（Film grain），大幅提升画质。\n绝对一致性：确保角色特征依然与【参考图 0】 100% 一致，且比预览图更加精致逼真，绝不可发生\"换人\"或\"换衣服\"的情况。\n剧情描述：",
  },
  { key: "custom", label: "自定义" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Remove style preset prompt prefix from input text (when switching presets or selecting 自定义) */
function removeStylePrefixFromInput(text: string): string {
  for (const preset of STYLE_PRESETS) {
    if (preset.prompt && text.startsWith(preset.prompt)) {
      // Remove the prefix and the trailing separator (，or comma)
      const remaining = text.slice(preset.prompt.length);
      return remaining.replace(/^[，,：:\s]+/, '').trim();
    }
  }
  return text;
}

/** Remove art style prompt prefix from input text (when switching art styles) */
function removeArtStylePrefixFromInput(text: string): string {
  for (const stylePrompt of Object.values(STORYBOARD_STYLE_PROMPTS)) {
    if (text.startsWith(stylePrompt)) {
      const remaining = text.slice(stylePrompt.length);
      return remaining.replace(/^[，,：:\s]+/, '').trim();
    }
  }
  return text;
}

/** Resolve reference image URLs from prompt tokens.
 *  - If @图N tokens exist → only send those specific images
 *  - No @图N but has upstream images → auto-send the first (closest) upstream image
 *  - Multiple upstream images → user must use @图N to specify which ones
 */
function resolveReferenceImages(text: string, nodeId: string, assetPool: ReturnType<typeof buildAssetImagePool>, persistedAssets: ImageEditNodeData["referencedAssets"], maxRef: number = 5): string[] | undefined {
  const { nodes, edges } = useCanvasStore.getState();
  const freshPool = buildReferenceImagePool(nodeId, nodes, edges, assetPool, persistedAssets, Infinity);
  if (freshPool.count === 0) return undefined;
  const referencedNumbers = collectReferencedImageNumbers(text);
  if (referencedNumbers.length > 0) {
    return referencedNumbers
      .filter((n) => freshPool.isValidNumber(n))
      .map((n) => freshPool.getByNumber(n)!.url);
  }
  // No @图N tokens — auto-send only the first upstream image as reference
  // (For multiple upstreams, user should use @图N to specify which ones)
  const autoImages = freshPool.urls.slice(0, Math.min(1, maxRef));
  return autoImages.length > 0 ? autoImages : undefined;
}

// ─── Component ────────────────────────────────────────────────────────────

export const ImageEditNode = memo(function ImageEditNode({ data, id, selected }: NodeProps) {
  const nodeData = data as unknown as ImageEditNodeData;
  const [prompt, setPrompt] = useState(nodeData.prompt || "");
  const [inputText, setInputText] = useState(nodeData.prompt || "");
  const [selectedModelId, setSelectedModelId] = useState(nodeData.model || DEFAULT_MODEL_ID);
  const [selectedSize, _setSelectedSize] = useState<ImageSize>((nodeData.size as ImageSize) || "1K");
  const currentModelId = selectedModelId;
  const model = getModelById(currentModelId);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState(
    nodeData.aspectRatio || model?.defaultAspectRatio || "1:1"
  );
  const [generateCount, setGenerateCount] = useState(1);
  const [showCountMenu, setShowCountMenu] = useState(false);
  const [showParamsPanel, setShowParamsPanel] = useState(false);
  const [styleType, setStyleType] = useState<string | null>(nodeData.styleType || null);
  const [artStyle, setArtStyle] = useState<StoryboardStyleType>((nodeData as ImageEditNodeData & { artStyle?: StoryboardStyleType }).artStyle || "2d-anime");
  const [selectedProviderId, setSelectedProviderId] = useState(nodeData.providerId || nodeData.provider || "");
  const [_anyMenuOpen, setAnyMenuOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(nodeData.isGenerating || false);
  const [showEditor, setShowEditor] = useState(false);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const setEdges = useCanvasStore((s) => s.setEdges);
  const showError = useErrorStore((s) => s.showError);

  const upstreamDataKey = useUpstreamDataKey(id);
  const activeJobsRef = useRef<Map<string, { timer: ReturnType<typeof setTimeout> | null; outputNodeId: string; pollStart: number; shouldUseCredits: boolean }>>(new Map());
  const onJobCompleteRef = useRef<(jobId: string) => void>(() => {});
  onJobCompleteRef.current = (jobId: string) => {
    activeJobsRef.current.delete(jobId);
    if (activeJobsRef.current.size === 0) {
      setIsGenerating(false);
      updateNodeData(id, { isGenerating: false });
    }
  };
  const cursorPosRef = useRef<number>(0);

  // ── Asset pool ────────────────────────────────────────────────────────
  const assets = useAssetStore((s) => s.allAssets);
  const assetPool = useMemo(() => buildAssetImagePool(assets), [assets]);
  const persistedAssets = (nodeData as ImageEditNodeData).referencedAssets;

  // Only include persisted assets that are ACTUALLY REFERENCED in the current prompt.
  // Stale persisted entries must not pollute the ReferenceStrip.
  const activePersistedAssets = useMemo(() => {
    if (!persistedAssets || persistedAssets.length === 0) return [];
    const referencedNums = collectReferencedImageNumbers(inputText || prompt);
    if (referencedNums.length === 0) return [];
    const { nodes, edges } = useCanvasStore.getState();
    const upstreamPool = buildReferenceImagePool(id, nodes, edges, undefined, []);
    const activeUrls = new Set<string>();
    for (const num of referencedNums) {
      const entry = upstreamPool.getByNumber(num);
      if (entry) activeUrls.add(normalizeUrl(entry.url));
    }
    return persistedAssets.filter(pa => activeUrls.has(normalizeUrl(pa.url)));
  }, [persistedAssets, inputText, prompt, id, upstreamDataKey]);

  const pool = useMemo(
    () => {
      const { nodes, edges } = useCanvasStore.getState();
      return buildReferenceImagePool(id, nodes, edges, assetPool, activePersistedAssets);
    },
    [id, upstreamDataKey, assetPool, activePersistedAssets]
  );

  // @图N numbers — asset library images only show when @-referenced
  const allRefNumbers = useMemo(
    () => new Set(collectReferencedImageNumbers(prompt)),
    [prompt]
  );

  // ── Handle deleting a reference — removes prompt token + disconnects upstream edge ──
  const handleDeleteRefEntry = useCallback(
    (entry: ReferenceImageEntry) => {
      // Remove @token from prompt
      const newPrompt = removeReferenceTokenByNumber(inputText || prompt, entry.number);
      setInputText(newPrompt);
      handlePromptChange(newPrompt);
      // Disconnect upstream edge
      if (entry.source === "upstream" && entry.sourceNodeId) {
        const { edges } = useCanvasStore.getState();
        const remaining = edges.filter(
          (e) => !(e.source === entry.sourceNodeId && e.target === id)
        );
        if (remaining.length !== edges.length) setEdges(remaining);
      }
    },
    [id, setEdges, inputText, prompt]
  );

  // ── Settings / grsai ──────────────────────────────────────────────────
  const settingsProviders = useSettingsStore((s) => s.providers);
  const imageTabProvider = settingsProviders.find((p) => p.id === "image-model");
  const imageChannelId = imageTabProvider?.channel || "";
  const isGrsaiChannel = imageTabProvider?.channel === "grsai";
  const grsaiModelName = isGrsaiChannel ? imageTabProvider?.modelName : undefined;
  const isCustomProvider = selectedProviderId && selectedProviderId !== "grsai" && selectedProviderId !== "vjimeng";

  const extraImageModels = useMemo<ModelOption[]>(() => {
    if (!grsaiModelName || !isGrsaiChannel) return [];
    return [{ id: `grsai/${grsaiModelName}`, label: grsaiModelName, providerId: "grsai" }];
  }, [grsaiModelName, isGrsaiChannel]);

  const { availableProviders, availableModels, getDefaultModel } = useChannelModelSelector(
    "image", selectedProviderId, extraImageModels
  );

  // Auto-sync provider from settings — continuous monitoring via imageChannelId
  useEffect(() => {
    if (!imageChannelId) return;
    const savedProviderId = nodeData.providerId || nodeData.provider;
    if (!savedProviderId || savedProviderId === "openai-compatible" || savedProviderId === "") {
      setSelectedProviderId(imageChannelId);
      updateNodeData(id, { providerId: imageChannelId, provider: imageChannelId });
    }
  }, [imageChannelId, nodeData.providerId, nodeData.provider, id, updateNodeData]);

  // ── All models (built-in + grsai custom + custom provider fallback) ──
  const allModels = useMemo(() => {
    const builtIn = getAllModels();
    if (grsaiModelName && isGrsaiChannel) {
      const customModelId = `grsai/${grsaiModelName}`;
      const exists = builtIn.some((m) => m.id === customModelId);
      if (!exists) {
        const customModel: ImageModelDefinition = {
          id: customModelId,
          displayName: grsaiModelName,
          providerId: "grsai",
          supportedSizes: ["1K", "2K", "4K"],
          defaultSize: "1K",
          supportedAspectRatios: [
            { label: "1:1", value: "1:1", widthRatio: 1, heightRatio: 1 },
            { label: "16:9", value: "16:9", widthRatio: 16, heightRatio: 9 },
            { label: "9:16", value: "9:16", widthRatio: 9, heightRatio: 16 },
            { label: "4:3", value: "4:3", widthRatio: 4, heightRatio: 3 },
            { label: "3:4", value: "3:4", widthRatio: 3, heightRatio: 4 },
            { label: "3:2", value: "3:2", widthRatio: 3, heightRatio: 2 },
            { label: "2:3", value: "2:3", widthRatio: 2, heightRatio: 3 },
            { label: "5:4", value: "5:4", widthRatio: 5, heightRatio: 4 },
            { label: "4:5", value: "4:5", widthRatio: 4, heightRatio: 5 },
            { label: "21:9", value: "21:9", widthRatio: 21, heightRatio: 9 },
            { label: "9:21", value: "9:21", widthRatio: 9, heightRatio: 21 },
            { label: "1:2", value: "1:2", widthRatio: 1, heightRatio: 2 },
            { label: "2:1", value: "2:1", widthRatio: 2, heightRatio: 1 },
          ],
          defaultAspectRatio: "1:1",
          supportsImageToImage: true,
          maxReferenceImages: 5,
          extraParamsSchema: [],
          expectedDurationMs: 90000,
          resolveRequest: () => ({ requestModel: grsaiModelName, modeLabel: "生成模式" }),
        };
        return [...builtIn, customModel];
      }
    }
    // ── Custom provider fallback: create a generic ImageModelDefinition ──
    // When using a custom provider (e.g. "geek"), the model ID from the
    // dropdown is just the raw model name (e.g. "gemini-3-pro-image-preview")
    // without a provider prefix. We need to create a fallback definition so
    // that handleGenerate can find it in allModels.
    if (isCustomProvider && nodeData.model) {
      const rawModelName = nodeData.model.replace(/^[^/]+\//, ""); // strip provider prefix if any
      const exists = builtIn.some((m) => m.id === nodeData.model || m.id === rawModelName);
      if (!exists) {
        const fallbackModel: ImageModelDefinition = {
          id: nodeData.model,
          displayName: rawModelName,
          providerId: selectedProviderId,
          supportedSizes: ["1K", "2K", "4K"],
          defaultSize: "1K",
          supportedAspectRatios: [
            { label: "1:1", value: "1:1", widthRatio: 1, heightRatio: 1 },
            { label: "16:9", value: "16:9", widthRatio: 16, heightRatio: 9 },
            { label: "9:16", value: "9:16", widthRatio: 9, heightRatio: 16 },
            { label: "4:3", value: "4:3", widthRatio: 4, heightRatio: 3 },
            { label: "3:4", value: "3:4", widthRatio: 3, heightRatio: 4 },
            { label: "3:2", value: "3:2", widthRatio: 3, heightRatio: 2 },
            { label: "2:3", value: "2:3", widthRatio: 2, heightRatio: 3 },
            { label: "5:4", value: "5:4", widthRatio: 5, heightRatio: 4 },
            { label: "4:5", value: "4:5", widthRatio: 4, heightRatio: 5 },
            { label: "21:9", value: "21:9", widthRatio: 21, heightRatio: 9 },
            { label: "9:21", value: "9:21", widthRatio: 9, heightRatio: 21 },
            { label: "1:2", value: "1:2", widthRatio: 1, heightRatio: 2 },
            { label: "2:1", value: "2:1", widthRatio: 2, heightRatio: 1 },
          ],
          defaultAspectRatio: "1:1",
          supportsImageToImage: true,
          maxReferenceImages: 5,
          extraParamsSchema: [],
          expectedDurationMs: 90000,
          resolveRequest: () => ({ requestModel: rawModelName, modeLabel: "生成模式" }),
        };
        return [...builtIn, fallbackModel];
      }
    }
    return builtIn;
  }, [grsaiModelName, isGrsaiChannel, isCustomProvider, nodeData.model, selectedProviderId]);


  // ── Persist referenced asset images ────────────────────────────────────
  useEffect(() => {
    const referencedNums = collectReferencedImageNumbers(prompt);
    const newPersisted: { url: string; thumbnailUrl?: string; name?: string }[] = [];
    for (const num of referencedNums) {
      const entry = pool.getByNumber(num);
      // Only persist if the entry is from the LIVE asset pool (not circular from previous persists)
      if (entry && entry.source === "asset" && entry.assetId && entry.sourceNodeId !== "persisted-asset") {
        newPersisted.push({ url: entry.url, thumbnailUrl: entry.thumbnailUrl, name: entry.sourceNodeName });
      }
    }
    const current = (nodeData as ImageEditNodeData).referencedAssets || [];
    const isSame = current.length === newPersisted.length && current.every((c, i) => c.url === newPersisted[i].url && c.name === newPersisted[i].name);
    if (!isSame) updateNodeData(id, { referencedAssets: newPersisted });
  }, [prompt, pool, id, updateNodeData]);

  // Sync prompt from store
  useEffect(() => {
    if (nodeData.prompt !== undefined && nodeData.prompt !== prompt) {
      setPrompt(nodeData.prompt);
      setInputText(nodeData.prompt);
    }
  }, [nodeData.prompt]);

  // Sync isGenerating
  useEffect(() => {
    if (nodeData.isGenerating !== isGenerating) setIsGenerating(nodeData.isGenerating);
  }, [nodeData.isGenerating]);

  // ── Resume polling on remount ──────────────────────────────────────────
  // When the component remounts (e.g. user navigated away and back),
  // activeJobsRef is empty but outputNodes may still have isGenerating=true
  // with a generationJobId. Scan all downstream outputNodes and resume polling.
  useEffect(() => {
    const { nodes, edges } = useCanvasStore.getState();
    // Find all output nodes that are downstream of this ImageEditNode
    const downstreamEdges = edges.filter((e) => e.source === id);
    const downstreamOutputNodes = downstreamEdges
      .map((e) => nodes.find((n) => n.id === e.target))
      .filter((n) => n && n.type === CANVAS_NODE_TYPES.upload)
      .filter((n) => {
        const data = n!.data as any;
        return data.isGenerating && data.generationJobId;
      });

    if (downstreamOutputNodes.length === 0) {
      // No active jobs — if ImageEditNode itself still has isGenerating=true but
      // no downstream outputNodes with jobs, it's stale state. Clear it.
      if (nodeData.isGenerating) {
        setIsGenerating(false);
        updateNodeData(id, { isGenerating: false });
      }
      return;
    }

    // Found active jobs — resume polling for each
    setIsGenerating(true);
    updateNodeData(id, { isGenerating: true });

    for (const outputNode of downstreamOutputNodes) {
      const outData = outputNode!.data as any;
      const jobId = String(outData.generationJobId || "");
      const outputNodeId = outputNode!.id;
      const expectedDurationMs = outData.expectedDurationMs || 90000;
      if (!jobId) continue;

      // Reuse pollJobUntilDone to resume the poll
      pollJobUntilDone(jobId, outputNodeId, expectedDurationMs).catch((e) => {
        console.error("[ImageEditNode remount] poll resume failed:", e);
        onJobCompleteRef.current(jobId);
      });
    }
  // Run ONLY on mount (empty dependency array) — this is intentional.
  // We want to resume polls exactly once when the component first appears.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePromptChange = useCallback(
    (value: string) => { setPrompt(value); updateNodeData(id, { prompt: value }); },
    [id, updateNodeData]
  );

  const handleModelChange = useCallback(
    (newModelId: string) => {
      setSelectedModelId(newModelId);
      const newModel = getModelById(newModelId);
      if (newModel) {
        const supportedRatios = newModel.supportedAspectRatios.map((r) => r.value);
        if (!supportedRatios.includes(selectedAspectRatio)) {
          const defaultRatio = newModel.defaultAspectRatio;
          setSelectedAspectRatio(defaultRatio);
          updateNodeData(id, { model: newModelId, aspectRatio: defaultRatio, providerId: selectedProviderId });
        } else {
          updateNodeData(id, { model: newModelId, providerId: selectedProviderId });
        }
      } else {
        updateNodeData(id, { model: newModelId, providerId: selectedProviderId });
      }
    },
    [id, updateNodeData, selectedAspectRatio, selectedProviderId]
  );

  const handleAspectRatioChange = useCallback(
    (newRatio: string) => { setSelectedAspectRatio(newRatio); updateNodeData(id, { aspectRatio: newRatio, requestAspectRatio: newRatio }); setShowParamsPanel(false); },
    [id, updateNodeData]
  );

  const handleSizeChange = useCallback(
    (newSize: ImageSize) => { _setSelectedSize(newSize); updateNodeData(id, { size: newSize }); setShowParamsPanel(false); },
    [id, updateNodeData]
  );

  const handleProviderChange = useCallback(
    (providerId: string) => {
      setSelectedProviderId(providerId);
      updateNodeData(id, { providerId, provider: providerId });
      const defaultModel = getDefaultModel(providerId);
      if (defaultModel) { setSelectedModelId(defaultModel); updateNodeData(id, { model: defaultModel, providerId, provider: providerId }); }
    },
    [id, updateNodeData, getDefaultModel]
  );

  // ── Poll job status (returns Promise that resolves when job completes) ──
  // Changed from setInterval callback to Promise-based polling:
  // This ensures multi-image generation (generateCount>1) runs serially,
  // preventing concurrent setInterval timers that caused UI lag.
  const pollJobUntilDone = useCallback(
    (jobId: string, outputNodeId: string, expectedDurationMs: number): Promise<void> => {
      return new Promise<void>((resolve) => {
        const pollStart = Date.now();
        const pollErrorCount = { value: 0 };
        const shouldUseCredits = useSettingsStore.getState().creditsEnabled && !(selectedProviderId?.startsWith("custom-"));
        // 动态超时：取 模型预期时长 × 5 和 10 分钟 的最大值（高峰期排队可能很久）
        const forceTimeout = Math.max(expectedDurationMs * 5, 10 * 60 * 1000);
        const MAX_POLL_ERRORS = 15; // 增加容错：网络抖动不应导致退积分
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let stopped = false;

        // Register job in activeJobs
        activeJobsRef.current.set(jobId, { timer: null, outputNodeId, pollStart, shouldUseCredits });
        // Helper: schedule next poll AND store timer in activeJobsRef for cleanup on unmount
        const scheduleNext = (fn: () => void, delay: number) => {
          const id = setTimeout(fn, delay);
          const entry = activeJobsRef.current.get(jobId);
          if (entry) entry.timer = id;
          return id;
        };

        const poll = async () => {
          if (stopped) return;
          try {
            if (Date.now() - pollStart > forceTimeout) {
              stopped = true;
              if (timeoutId) clearTimeout(timeoutId);
              showError("图片生成超时，任务可能仍在排队中，请稍后重试");
              updateNodeData(outputNodeId, { isGenerating: false, generationJobId: null, generationError: "生成超时（任务可能仍在排队）", displayName: "生成超时" });
              onJobCompleteRef.current(jobId);
              // 不退积分！任务可能还在后端排队，最终仍可能成功
              resolve();
              return;
            }
            if (Date.now() - pollStart > MAX_POLL_TIME) {
              stopped = true;
              if (timeoutId) clearTimeout(timeoutId);
              showError("图片生成超时（15分钟），任务可能仍在排队中，请稍后重试");
              updateNodeData(outputNodeId, { isGenerating: false, generationJobId: null, generationError: "生成超时（15分钟），任务可能仍在排队", displayName: "生成超时" });
              onJobCompleteRef.current(jobId);
              // 不退积分！任务可能还在后端排队
              resolve();
              return;
            }

            const status = await tauriAiGateway.getGenerateImageJob(jobId);
            pollErrorCount.value = 0; // 成功响应后重置错误计数

            if (status.progress !== undefined && status.progress >= 0) {
              updateNodeData(id, { progressPercent: Math.round(status.progress) });
            }

            if (status.result) {
              stopped = true;
              const resultFileName = extractDisplayName(status.result, "image");
              const duration = nodeData.generationStartedAt ? Date.now() - nodeData.generationStartedAt : null;
              updateNodeData(outputNodeId, { imageUrl: status.result, displayName: resultFileName, sourceFileName: resultFileName, isGenerating: false, generationJobId: null, generationDurationMs: duration, generationError: undefined });

              (async () => {
                try {
                  let persistedPath = status.result!;
                  if (persistedPath.startsWith("data:") || persistedPath.startsWith("http://") || persistedPath.startsWith("https://")) {
                    try {
                      const localPath = (await persistImageSource(persistedPath)) as string;
                      if (localPath && localPath !== persistedPath) {
                        updateNodeData(outputNodeId, { imageUrl: localPath });
                        persistedPath = localPath;
                      }
                    } catch (persistErr) { console.warn("[ImageEditNode] persist failed:", persistErr); }
                  }
                  try {
                    const prepared = (await prepareNodeImageSource(persistedPath, 0)) as { previewPath: string; width: number; height: number };
                    updateNodeData(outputNodeId, { imageWidth: prepared.width, imageHeight: prepared.height });
                  } catch (e) { console.error("[图生图] 预览图尺寸解析失败:", e); }
                } catch (e) { console.error("[图生图] 生成结果回调失败:", e); }
              })();

              onJobCompleteRef.current(jobId);
              resolve();
              return;
            }

            if (status.status === "succeeded") {
              stopped = true;
              showError("图片生成失败: 后端返回空结果");
              updateNodeData(outputNodeId, { isGenerating: false, generationJobId: null, generationError: "后端返回空结果", displayName: "生成失败" });
              if (shouldUseCredits) tauriAiGateway.refundImageCredits(jobId, selectedProviderId);
              onJobCompleteRef.current(jobId);
              resolve();
            } else if (status.status === "failed" || (status.error && !status.result)) {
              stopped = true;
              const errorMsg = status.error || "未知错误";
              showError(`图片生成失败: ${errorMsg}`);
              updateNodeData(outputNodeId, { isGenerating: false, generationJobId: null, generationError: errorMsg, displayName: "生成失败" });
              onJobCompleteRef.current(jobId);
              // 只有明确 failed 才退积分
              if (shouldUseCredits) tauriAiGateway.refundImageCredits(jobId, selectedProviderId);
              resolve();
            } else {
              // Still running — schedule next poll AFTER this one completes
              if (!stopped) {
                timeoutId = scheduleNext(poll, POLL_INTERVAL);
              }
            }
          } catch (e) {
            console.error(`[pollJobUntilDone] POLL ERROR for ${jobId}:`, e);
            pollErrorCount.value++;
            if (pollErrorCount.value >= MAX_POLL_ERRORS) {
              stopped = true;
              updateNodeData(outputNodeId, { isGenerating: false, generationJobId: null, generationError: "轮询暂时中断（网络不稳定），任务可能仍在排队中" });
              onJobCompleteRef.current(jobId);
              // 不退积分！网络中断不代表任务失败，后端可能还在排队
              resolve();
            } else {
              // Schedule retry
              if (!stopped) {
                timeoutId = scheduleNext(poll, POLL_INTERVAL);
              }
            }
          }
        };

        // Start the first poll
        timeoutId = scheduleNext(poll, 0);
      });
    },
    [id, nodeData, updateNodeData, showError, selectedProviderId]
  );

  // ── Listen for real-time progress events from Rust (bypasses DB latency) ──
  useEffect(() => {
    let unlisten1: (() => void) | undefined;
    let unlisten2: (() => void) | undefined;
    import("@/features/canvas/compat/event").then(({ listen }) => {
      // 1) grsai/credits API progress (via DB + atomic)
      listen<{ jobId: string; progress: number }>("generation-progress", (event) => {
        const { jobId, progress } = event.payload;
        if (activeJobsRef.current.has(jobId) && progress >= 0) {
          updateNodeData(id, { progressPercent: Math.round(progress) });
        }
      }).then((fn) => { unlisten1 = fn; });

      // 2) jimeng browser automation progress (Playwright stdout line-by-line)
      listen<{ percent: number; stage: string; message: string }>("jimeng-browser-progress", (event) => {
        const { percent } = event.payload;
        if (isGenerating && percent >= 0) {
          updateNodeData(id, { progressPercent: Math.round(percent) });
        }
      }).then((fn) => { unlisten2 = fn; });
    });
    return () => { unlisten1?.(); unlisten2?.(); };
  }, [id, updateNodeData, isGenerating]);

  // Cleanup all polling on unmount
  useEffect(() => {
    return () => { activeJobsRef.current.forEach((job) => { if (job.timer) clearTimeout(job.timer); }); };
  }, []);

  // ── Submit a single generation job (NO polling — returns jobId + outputNodeId) ──
  // This allows parallel submission of N jobs, then parallel polling.
  // `index` is the 0-based position among N parallel jobs, used for vertical offset.
  // NOTE: Provider config sync MUST be done before calling this in parallel,
  //       because syncProviderConfigToBackend uses multiple IPC calls that
  //       would race if called concurrently from N jobs.
  const submitOneJobAsync = useCallback(async (textToUse: string, modelDef: ImageModelDefinition, index: number): Promise<{ jobId: string; outputNodeId: string }> => {
    const referenceImages = resolveReferenceImages(textToUse, id, assetPool, persistedAssets);
    let cleanPrompt = stripReferenceMarkers(textToUse);

    // Style & art style words are now in the input box directly — no extraParams injection needed
    const extraParams = { ...(nodeData.extraParams || {}) };

    const { requestModel } = modelDef.resolveRequest({ referenceImageCount: referenceImages?.length || 0 });
    const submitAspectRatio = nodeData.requestAspectRatio || nodeData.aspectRatio || modelDef.defaultAspectRatio;

    // P0 fix: use selectedProviderId (user's channel) not modelDef.providerId
    const effectiveProviderId = selectedProviderId || modelDef.providerId;

    // Create output node FIRST so user always sees it (even if API call fails)
    const outputNodeId = `uploadNode-${crypto.randomUUID()}`;
    const store = useCanvasStore.getState();
    const currentNode = store.nodes.find((n) => n.id === id);
    const nodeX = currentNode?.position.x ?? 0;
    const nodeY = currentNode?.position.y ?? 0;

    // ── Offset output nodes vertically so they don't overlap ──
    // Use index-based offset for parallel submission (deterministic, no race condition)
    const yOffset = index * 320;

    const outputNode: Node = {
      id: outputNodeId,
      type: CANVAS_NODE_TYPES.upload,
      position: { x: nodeX + 560, y: nodeY + yOffset },
      data: {
        displayName: "生成中…",
        imageUrl: null, previewImageUrl: null,
        aspectRatio: submitAspectRatio,
        isSizeManuallyAdjusted: false,
        sourceFileName: null,
        isGenerating: true,
        generationStartedAt: Date.now(),
        expectedDurationMs: modelDef.expectedDurationMs || 90000,
      },
    };
    store.addNode(outputNode);
    store.addEdge({ id: `edge-${id}-${outputNodeId}`, source: id, target: outputNodeId, type: "dataFlow" });

    // submitGenerateImageJob internally calls syncProviderConfigToBackend()
    // which syncs API key & base URL to the Rust backend before submission
    // NOTE: Provider config sync MUST be done BEFORE parallel submission
    //       to prevent IPC race conditions when generateCount > 1.
    let jobId: string;
    try {
      jobId = await tauriAiGateway.submitGenerateImageJob({
        model: `${effectiveProviderId}/${requestModel}`,
        prompt: cleanPrompt,
        size: (nodeData.size as ImageSize) || modelDef.defaultSize,
        aspectRatio: submitAspectRatio,
        referenceImages,
        extraParams,
        negativePrompt: nodeData.negativePrompt || undefined,
        seed: nodeData.seed ?? undefined,
      });
    } catch (e) {
      console.error("submitGenerateImageJob failed:", e);
      showError(`图片生成提交失败: ${e}`);
      updateNodeData(outputNodeId, { isGenerating: false, generationJobId: null, generationError: `提交失败: ${e}`, displayName: `提交失败` });
      // DO NOT check activeJobsRef.size here — other jobs may still be in submission phase.
      // The isGenerating state will be cleared when all polling completes in handleGenerate.
      throw e; // throw so caller knows this job failed
    }

    // ── Store jobId in outputNode for remount polling recovery ──
    updateNodeData(outputNodeId, { generationJobId: jobId, providerId: effectiveProviderId });

    // ── Return jobId + outputNodeId — caller will poll in parallel ──
    return { jobId, outputNodeId };
  }, [id, nodeData, assetPool, persistedAssets, selectedProviderId, updateNodeData, showError]);

  // ── Handle generate ────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    const textToUse = inputText.trim() || prompt.trim();
    if (!textToUse) return;

    const effectiveModelId = nodeData.model || DEFAULT_MODEL_ID;
    const modelDef = allModels.find((m) => m.id === effectiveModelId)
      || resolveModelId(effectiveModelId)
      || (isCustomProvider ? createFallbackModelDefinition(effectiveModelId, selectedProviderId) : undefined);
    if (!modelDef) { showError("未找到模型配置: " + effectiveModelId); return; }

    // Note: syncProviderConfigToBackend() is called internally by submitOneJob → tauriAiGateway.submitGenerateImageJob

    // Update prompt from input
    if (inputText.trim()) handlePromptChange(inputText.trim());
    if (!inputText.trim() && prompt.trim()) setInputText(prompt.trim());

    updateNodeData(id, { prompt: textToUse, isGenerating: true, generationStartedAt: Date.now(), generationDurationMs: null });
    setIsGenerating(true);

    try {
      // ── CRITICAL: Submit ALL jobs serially (fast, ~100ms each for IPC + DB write),
      //    then poll ALL jobs in PARALLEL — each image appears as soon as its API returns.
      //    Serial submission prevents provider-config IPC race conditions when generateCount > 1.
      //    Parallel polling ensures image #2..N are NOT stuck waiting for image #1.
      const count = generateCount;
      const jobs: { jobId: string; outputNodeId: string }[] = [];

      // Phase 1: Submit all jobs serially (fast — just IPC + DB write, ~100ms each)
      for (let i = 0; i < count; i++) {
        try {
          const job = await submitOneJobAsync(textToUse, modelDef, i);
          jobs.push(job);
        } catch (e) {
          // One job submission failed — show error on that output node but continue with others
          console.error("Job submission failed:", e);
        }
      }

      if (jobs.length === 0) {
        // All submissions failed
        updateNodeData(id, { isGenerating: false }); setIsGenerating(false);
        return;
      }

      // Phase 2: Poll all jobs concurrently — each resolves independently
      const pollPromises = jobs.map(({ jobId, outputNodeId }) => pollJobUntilDone(jobId, outputNodeId, modelDef.expectedDurationMs || 90000));
      await Promise.all(pollPromises);

      // ── ALL polls completed — clear generating state ──
      // This is the definitive clearing point. pollJobUntilDone may also clear
      // isGenerating inside each timer callback (when activeJobsRef.size === 0),
      // but we ensure it here as a safety net.
      updateNodeData(id, { isGenerating: false });
      setIsGenerating(false);
    } catch (e) {
      console.error("Generation failed:", e);
      showError(`图片生成失败: ${e}`);
      if (activeJobsRef.current.size === 0) {
        setIsGenerating(false);
        updateNodeData(id, { isGenerating: false });
      }
    }
  }, [inputText, prompt, nodeData, id, pollJobUntilDone, updateNodeData, showError, handlePromptChange, allModels, generateCount, submitOneJobAsync]);

  const handleSend = useCallback(() => {
    if (!inputText.trim()) return;
    handleGenerate();
  }, [inputText, handleGenerate]);

  const handleKeyDown = useCallback((_e: React.KeyboardEvent) => {}, []);

  // ── Node dimensions (resizable) ──────────────────────────────────────
  const nodeWidth = nodeData.width || DEFAULT_NODE_WIDTH;
  const nodeHeight = nodeData.height || DEFAULT_NODE_HEIGHT;
  const handleResize = useCallback(
    (result: { width: number; height: number }) => {
      updateNodeData(id, { width: result.width, height: result.height });
    },
    [id, updateNodeData]
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`@keyframes imageEditPulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
      <NodeDeleteButton id={id} selected={selected ?? false}>
        {nodeData.imageUrl && (
          <button
            onClick={() => setShowEditor(true)}
            className="nodrag"
            style={{
              padding: '6px 14px', borderRadius: '10px', backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border)', color: 'var(--text-primary)',
              fontSize: '12px', fontWeight: 500, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px', backdropFilter: 'blur(8px)',
              transition: 'all 0.2s ease', boxShadow: 'var(--shadow-card)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-btn)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-surface)'; }}
            title="编辑图片（画笔/文字）"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
            </svg>
            <span>编辑</span>
          </button>
        )}
      </NodeDeleteButton>
      {/* Outer wrapper — position:relative so the resize handle (absolute) anchors here */}
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
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box',
            /* overflow controlled by CSS: hidden by default, visible when popup is open */
          }}
        >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }} title={nodeData.displayName || "AI 图片生成"}>
              {nodeData.displayName || "AI 图片生成"}
            </span>
            {/* Generating indicator */}
            {isGenerating && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                fontSize: '11px', color: 'var(--accent)',
                backgroundColor: 'var(--bg-hover)', borderRadius: '9999px',
                padding: '2px 10px', marginLeft: '4px',
              }}>
                <span style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  backgroundColor: 'var(--accent-btn)',
                  opacity: 1,
                  animation: 'imageEditPulse 1.5s ease-in-out infinite',
                  display: 'inline-block',
                }} />
                生成中
              </span>
            )}
            {isGenerating && (nodeData.progressPercent ?? 0) > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                fontSize: '11px', color: 'var(--accent)',
                backgroundColor: 'var(--bg-hover)', borderRadius: '9999px',
                padding: '2px 8px', marginLeft: '2px',
              }}>
                {nodeData.progressPercent}%
              </span>
            )}
          </div>
        </div>

        {/* Style type presets — click to inject prompt text into input box */}
        <div style={{ padding: '4px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: '6px', overflowX: 'auto', scrollbarWidth: 'none', flexShrink: 0, alignItems: 'center' }}>
          {STYLE_PRESETS.map((s) => {
            const active = styleType === s.key;
            return (
              <button
                key={s.key}
                onClick={() => {
                  const next = active ? null : s.key;
                  setStyleType(next);
                  updateNodeData(id, { styleType: next });
                  // Style preset → inject prompt text into input box
                  if (s.prompt) {
                    const current = inputText.trim();
                    // Remove any previously injected style preset prompt prefix
                    const cleaned = removeStylePrefixFromInput(current);
                    const newInput = s.prompt + (cleaned ? (s.prompt.endsWith('，') || s.prompt.endsWith(',') || s.prompt.endsWith('：') || s.prompt.endsWith(':') ? '' : '，') + cleaned : '');
                    setInputText(newInput);
                    handlePromptChange(newInput);
                  } else {
                    // "自定义" → remove style prefix, keep user text
                    const cleaned = removeStylePrefixFromInput(inputText);
                    setInputText(cleaned);
                    handlePromptChange(cleaned);
                  }
                }}
                className="nodrag shrink-0"
                style={{
                  padding: '3px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 500,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  border: active ? '1px solid var(--accent-btn)' : '1px solid var(--border)',
                  backgroundColor: active ? 'var(--accent-btn)' : 'transparent',
                  color: active ? '#fff' : 'var(--text-secondary)',
                  transition: 'all 0.2s ease',
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Art style selector — click to inject style text into input box */}
        <div style={{ padding: '4px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginRight: '2px' }}>风格</span>
          {(Object.keys(STORYBOARD_STYLE_PROMPTS) as StoryboardStyleType[]).map((style) => (
            <button
              key={style}
              className="nodrag shrink-0"
              onClick={() => {
                setArtStyle(style);
                updateNodeData(id, { artStyle: style });
                // Art style → inject style prompt text into input box
                const stylePromptText = STORYBOARD_STYLE_PROMPTS[style];
                const current = inputText.trim();
                // Remove any previously injected art style prefix
                const cleaned = removeArtStylePrefixFromInput(current);
                const newInput = stylePromptText + (cleaned ? '，' + cleaned : '');
                setInputText(newInput);
                handlePromptChange(newInput);
              }}
              style={{
                padding: '2px 8px', borderRadius: '9999px', fontSize: '10px', fontWeight: artStyle === style ? 500 : 400,
                cursor: 'pointer', whiteSpace: 'nowrap',
                border: artStyle === style ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                backgroundColor: artStyle === style ? 'var(--bg-hover)' : 'transparent',
                color: artStyle === style ? 'var(--accent)' : 'var(--text-secondary)',
                transition: 'all 0.2s ease', lineHeight: '16px',
              }}
            >
              {STORYBOARD_STYLE_LABELS[style]}
            </button>
          ))}
        </div>

        {/* Input area — scrollable when height is constrained */}
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {/* ── Reference image strip (when upstream images exist) ── */}
          {pool.entries.filter(e => e.mediaType !== "audio").length > 0 && (
            <div>
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

          <RichPromptInput
            value={inputText}
            onChange={(v) => { setInputText(v); handlePromptChange(v); }}
            onKeyDown={handleKeyDown}
            onCursorPosChange={(pos) => { cursorPosRef.current = pos; }}
            placeholder="描述你想要生成的画面内容，@引用素材"
            maxLength={5000}
            pool={pool}
            minHeight={80}
            maxHeight={0}
            onDeleteRefEntry={handleDeleteRefEntry}
            showStrip={false}
            style={{ flex: 1, minHeight: 0 }}
            showPromptAssistant
            promptAssistantProviderId={selectedProviderId}
          />

          {/* Bottom toolbar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ChannelModelSelector
                selectedProviderId={selectedProviderId}
                selectedModelId={currentModelId}
                availableProviders={availableProviders}
                availableModels={availableModels.map((m) => ({ id: m.id, label: m.label || m.id, providerId: m.providerId }))}
                onProviderChange={handleProviderChange}
                onModelChange={handleModelChange}
                onMenuOpenChange={setAnyMenuOpen}
              />

              {/* ── 云智通道价格标签：0.3元/张 ── */}
              {selectedProviderId === "yunzhi" && (() => {
                const modelShort = currentModelId.includes("/") ? currentModelId.split("/")[1] : currentModelId;
                const pricePerImage = IMAGE_CREDIT_PRICES[modelShort] || 30;
                const priceYuan = (pricePerImage / 100).toFixed(1);
                return <span className="nodrag" style={{ fontSize: '11px', color: '#7ab4f0', fontWeight: 500, flexShrink: 0, whiteSpace: 'nowrap' }}>{priceYuan}元/张</span>;
              })()}

              <div className="flex items-center gap-1 relative nodrag" style={{ color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer' }} onClick={() => setShowParamsPanel(!showParamsPanel)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
                <span>{selectedAspectRatio} · {selectedSize}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 relative nodrag" style={{ color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer' }} onClick={() => setShowCountMenu(!showCountMenu)}>
                <span>{generateCount}张</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                {showCountMenu && (
                  <div className="nodrag" style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: '4px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', padding: '4px', zIndex: 50, minWidth: '60px' }}>
                    {[1, 2, 4].map((n) => (
                      <button key={n} onClick={(e) => { e.stopPropagation(); setGenerateCount(n); setShowCountMenu(false); }} style={{ display: 'block', width: '100%', padding: '6px 10px', border: 'none', borderRadius: '4px', backgroundColor: generateCount === n ? 'var(--bg-hover)' : 'transparent', color: generateCount === n ? 'var(--accent)' : 'var(--text-primary)', fontSize: '12px', cursor: 'pointer', textAlign: 'center' }}>{n}张</button>
                    ))}
                  </div>
                )}
              </div>
              <button className="nodrag" onClick={handleSend} disabled={!inputText.trim()} style={{ width: '32px', height: '32px', borderRadius: '8px', backgroundColor: inputText.trim() ? 'var(--accent-btn)' : 'var(--bg-hover)', color: inputText.trim() ? '#fff' : 'var(--text-muted)', border: 'none', cursor: inputText.trim() ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Params panel — placed outside node-inner to avoid overflow clipping */}
      {showParamsPanel && (
        <div className="nodrag" style={{ position: 'absolute', bottom: 52, left: 170, backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)', padding: '10px', zIndex: 50, width: '260px' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 500, marginBottom: '6px' }}>分辨率</div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {SIZE_OPTIONS.map((s) => (
                <button key={s.value} onClick={() => handleSizeChange(s.value)} style={{ flex: 1, padding: '5px 8px', borderRadius: '6px', border: selectedSize === s.value ? '1.5px solid var(--accent)' : '1px solid var(--border)', backgroundColor: selectedSize === s.value ? 'var(--bg-hover)' : 'transparent', color: selectedSize === s.value ? 'var(--accent)' : 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer', transition: 'all 0.2s', fontWeight: selectedSize === s.value ? 500 : 400 }}>{s.label}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 500, marginBottom: '6px' }}>比例</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
              {ALL_ASPECT_RATIOS.map((ratio) => (
                <button key={ratio.value} onClick={() => handleAspectRatioChange(ratio.value)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', padding: '5px 2px', borderRadius: '6px', border: selectedAspectRatio === ratio.value ? '1.5px solid var(--accent)' : '1px solid var(--border)', backgroundColor: selectedAspectRatio === ratio.value ? 'var(--bg-hover)' : 'transparent', color: selectedAspectRatio === ratio.value ? 'var(--accent)' : 'var(--text-secondary)', fontSize: '10px', cursor: 'pointer', transition: 'all 0.2s', minHeight: '38px' }}><span style={{ fontSize: '13px', lineHeight: 1 }}>{ratio.icon}</span><span>{ratio.label}</span></button>
              ))}
            </div>
          </div>
          <div style={{ marginTop: '10px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 500, marginBottom: '6px' }}>反向提示词</div>
            <input
              type="text"
              className="nodrag"
              placeholder="不想出现的内容，如: 模糊, 变形, 低质量..."
              value={nodeData.negativePrompt || ''}
              onChange={(e) => updateNodeData(id, { negativePrompt: e.target.value })}
              style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '11px', outline: 'none' }}
            />
          </div>
          <div style={{ marginTop: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 500 }}>种子 Seed</span>
              <button
                className="nodrag"
                onClick={() => {
                  const newSeed = Math.floor(Math.random() * 2147483647);
                  updateNodeData(id, { seed: newSeed });
                }}
                style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer' }}
                title="随机生成种子"
              >随机</button>
            </div>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <input
                type="number"
                className="nodrag"
                placeholder="留空=随机"
                value={nodeData.seed ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  updateNodeData(id, { seed: val === '' ? null : parseInt(val) || 0 });
                }}
                style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '11px', outline: 'none' }}
              />
              {nodeData.seed !== undefined && nodeData.seed !== null && (
                <button
                  className="nodrag"
                  onClick={() => updateNodeData(id, { seed: null })}
                  style={{ fontSize: '10px', padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  title="清除种子，恢复随机"
                >清除</button>
              )}
            </div>
          </div>
        </div>
      )}

      <NodeResizeHandle width={nodeWidth} height={nodeHeight} onResize={handleResize} minWidth={MIN_NODE_WIDTH} maxWidth={MAX_NODE_WIDTH} minHeight={MIN_NODE_HEIGHT} maxHeight={MAX_NODE_HEIGHT} />
      </div>
      <Handle type="target" position={Position.Left} className="!bg-[var(--accent-secondary)] !w-6 !h-6 !border-2 !border-[var(--bg-node)]" />
      <Handle type="source" position={Position.Right} className="!bg-[var(--accent-secondary)] !w-6 !h-6 !border-2 !border-[var(--bg-node)]" />
      {/* Image Editor Dialog */}
      {showEditor && nodeData.imageUrl && (
        <ImageEditorDialog
          imageUrl={resolveImageDisplayUrl(nodeData.imageUrl)}
          onSave={(editedUrl) => {
            updateNodeData(id, { imageUrl: editedUrl });
            setShowEditor(false);
          }}
          onClose={() => setShowEditor(false)}
        />
      )}
    </>
  );
});



