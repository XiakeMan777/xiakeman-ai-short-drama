import { CANVAS_NODE_TYPES, type CanvasNodeType } from "./canvasNodes";

interface CanvasNodeCapabilities {
  hasImage: boolean;
  hasPrompt: boolean;
  hasExport: boolean;
  hasTools: boolean;
}

interface CanvasNodeConnectivity {
  maxInputs: number;
  maxOutputs: number;
  acceptTypes: CanvasNodeType[];
}

/** Node category for menu grouping */
export type NodeCategory = "基础" | "场景" | "媒体" | "小说";

/** Category definition with display label and icon */
export const NODE_CATEGORIES: { id: NodeCategory; icon: string; defaultCollapsed: boolean }[] = [
  { id: "基础", icon: "📋", defaultCollapsed: false },
  { id: "场景", icon: "🌐", defaultCollapsed: true },
  { id: "媒体", icon: "🎵", defaultCollapsed: true },
  { id: "小说", icon: "📖", defaultCollapsed: true },
];

export interface CanvasNodeDefinition {
  type: CanvasNodeType;
  menuLabelKey: string;
  menuIcon: string;
  menuCategory: NodeCategory;
  visibleInMenu: boolean;
  capabilities: CanvasNodeCapabilities;
  connectivity: CanvasNodeConnectivity;
  createDefaultData: () => Record<string, unknown>;
}

/** Recent nodes tracking (localStorage key) */
export const RECENT_NODES_KEY = "storyboard-recent-nodes";
export const RECENT_NODES_MAX = 4;

export function getRecentNodes(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_NODES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addRecentNode(registryKey: string): void {
  const recent = getRecentNodes().filter((k) => k !== registryKey);
  recent.unshift(registryKey);
  localStorage.setItem(RECENT_NODES_KEY, JSON.stringify(recent.slice(0, RECENT_NODES_MAX)));
}

export const nodeRegistry: Record<string, CanvasNodeDefinition> = {
  // Script Node (剧本)
  scriptNode: {
    type: CANVAS_NODE_TYPES.script,
    menuLabelKey: "canvas.scriptNode",
    menuIcon: "📄",
    menuCategory: "基础",
    visibleInMenu: true,
    capabilities: { hasImage: false, hasPrompt: true, hasExport: false, hasTools: false },
    connectivity: { maxInputs: 0, maxOutputs: 2, acceptTypes: [] },
    createDefaultData: () => ({
      displayName: "剧本",
      scriptText: "",
      frames: [],
      isGenerating: false,
      providerId: "",
      model: "",
    }),
  },
  // Script Result Node (auto-created by ScriptNode, hidden from menu)
  [CANVAS_NODE_TYPES.scriptResult]: {
    type: CANVAS_NODE_TYPES.scriptResult,
    menuLabelKey: "canvas.scriptResult",
    menuIcon: "📋",
    menuCategory: "基础",
    visibleInMenu: false,
    capabilities: { hasImage: false, hasPrompt: false, hasExport: false, hasTools: false },
    connectivity: { maxInputs: 0, maxOutputs: 1, acceptTypes: [] },
    createDefaultData: () => ({
      displayName: "分镜脚本",
      frames: [],
      characters: [],
      scenes: [],
      sourceScriptNodeId: "",
    }),
  },
  // AI Image Generation
  [CANVAS_NODE_TYPES.imageEdit]: {
    type: CANVAS_NODE_TYPES.imageEdit,
    menuLabelKey: "canvas.aiImage",
    menuIcon: "✨",
    menuCategory: "基础",
    visibleInMenu: true,
    capabilities: { hasImage: true, hasPrompt: true, hasExport: false, hasTools: true },
    connectivity: { maxInputs: 0, maxOutputs: 0, acceptTypes: [CANVAS_NODE_TYPES.upload, CANVAS_NODE_TYPES.imageEdit, CANVAS_NODE_TYPES.video, CANVAS_NODE_TYPES.videoFrame] },
    createDefaultData: () => ({
      displayName: "AI 图片",
      imageUrl: null,
      aspectRatio: "1:1",
      isSizeManuallyAdjusted: false,
      prompt: "",
      model: "",
      provider: "",
      providerId: "",
      size: "1K",
      requestAspectRatio: "1:1",
      extraParams: {},
      isGenerating: false,
      generationStartedAt: null,
      generationDurationMs: null,
    }),
  },
  // Video Generation
  videoGen: {
    type: CANVAS_NODE_TYPES.video,
    menuLabelKey: "canvas.videoGen",
    menuIcon: "🎬",
    menuCategory: "基础",
    visibleInMenu: true,
    capabilities: { hasImage: true, hasPrompt: true, hasExport: false, hasTools: true },
    connectivity: { maxInputs: 0, maxOutputs: 0, acceptTypes: [CANVAS_NODE_TYPES.upload, CANVAS_NODE_TYPES.imageEdit, CANVAS_NODE_TYPES.video, CANVAS_NODE_TYPES.videoFrame, CANVAS_NODE_TYPES.audio] },
    createDefaultData: () => ({
      displayName: "生视频",
      imageUrl: null,
      aspectRatio: "16:9",
      isSizeManuallyAdjusted: false,
      prompt: "",
      model: "",
      provider: "",
      providerId: "",
      size: "720P",
      requestAspectRatio: "16:9",
      extraParams: {},
      isGenerating: false,
      generationStartedAt: null,
      generationDurationMs: null,
      videoUrl: null,
      videoMode: "text2video",
    }),
  },
  // Video Result (auto-created by VideoNode, hidden from menu)
  videoResult: {
    type: CANVAS_NODE_TYPES.videoResult,
    menuLabelKey: "canvas.videoResult",
    menuIcon: "🎥",
    menuCategory: "基础",
    visibleInMenu: false,
    capabilities: { hasImage: true, hasPrompt: false, hasExport: false, hasTools: false },
    connectivity: { maxInputs: 0, maxOutputs: 0, acceptTypes: [CANVAS_NODE_TYPES.video] },
    createDefaultData: () => ({
      displayName: "视频结果",
      prompt: "",
      model: "",
      isGenerating: false,
      progressPercent: 0,
      videoUrl: null,
      imageUrl: null,
      error: null,
      generationStartedAt: null,
      generationDurationMs: null,
      aspectRatio: "16:9",
    }),
  },
  // Video Frame Extraction
  videoFrame: {
    type: CANVAS_NODE_TYPES.videoFrame,
    menuLabelKey: "canvas.videoFrame",
    menuIcon: "🖼️",
    menuCategory: "基础",
    visibleInMenu: true,
    capabilities: { hasImage: true, hasPrompt: false, hasExport: false, hasTools: true },
    connectivity: { maxInputs: 0, maxOutputs: 0, acceptTypes: [CANVAS_NODE_TYPES.video, CANVAS_NODE_TYPES.videoResult, CANVAS_NODE_TYPES.videoFrame] },
    createDefaultData: () => ({
      displayName: "视频抽帧",
      imageUrl: null,
      aspectRatio: "16:9",
      isSizeManuallyAdjusted: false,
      sourceFileName: null,
      videoPath: null,
      extractionMode: "uniform",
      frameCount: 4,
      outputWidth: 1280,
      extractedFrames: [],
      isExtracting: false,
    }),
  },
  // Storyboard Generation
  [CANVAS_NODE_TYPES.storyboardGen]: {
    type: CANVAS_NODE_TYPES.storyboardGen,
    menuLabelKey: "canvas.storyboardGen",
    menuIcon: "🎭",
    menuCategory: "基础",
    visibleInMenu: true,
    capabilities: { hasImage: true, hasPrompt: true, hasExport: true, hasTools: true },
    connectivity: { maxInputs: 0, maxOutputs: 0, acceptTypes: [CANVAS_NODE_TYPES.upload, CANVAS_NODE_TYPES.imageEdit, CANVAS_NODE_TYPES.video, CANVAS_NODE_TYPES.videoFrame, CANVAS_NODE_TYPES.script, CANVAS_NODE_TYPES.scriptResult] },
    createDefaultData: () => ({
      displayName: "分镜生成",
      imageUrl: null,
      aspectRatio: "16:9",
      isSizeManuallyAdjusted: false,
      rows: 2,
      cols: 3,
      frames: [],
      overallAspectRatio: "16:9",
      cellAspectRatio: "16:9",
      aspectRatioMode: "overall",
      model: "",
      provider: "",
      providerId: "",
      isGenerating: false,
      styleType: "2d-anime",
    }),
  },
  // Upload Image
  [CANVAS_NODE_TYPES.upload]: {
    type: CANVAS_NODE_TYPES.upload,
    menuLabelKey: "canvas.upload",
    menuIcon: "📤",
    menuCategory: "基础",
    visibleInMenu: true,
    capabilities: { hasImage: true, hasPrompt: false, hasExport: false, hasTools: true },
    connectivity: { maxInputs: 0, maxOutputs: 0, acceptTypes: [CANVAS_NODE_TYPES.imageEdit, CANVAS_NODE_TYPES.video, CANVAS_NODE_TYPES.storyboardGen] },
    createDefaultData: () => ({
      displayName: "上传图片",
      imageUrl: null,
      aspectRatio: "1:1",
      isSizeManuallyAdjusted: false,
      sourceFileName: "",
    }),
  },
  // VR360 Panorama
  panorama360: {
    type: CANVAS_NODE_TYPES.panorama360,
    menuLabelKey: "canvas.panorama360",
    menuIcon: "🌐",
    menuCategory: "场景",
    visibleInMenu: true,
    capabilities: { hasImage: true, hasPrompt: false, hasExport: true, hasTools: true },
    connectivity: { maxInputs: 0, maxOutputs: 0, acceptTypes: [CANVAS_NODE_TYPES.upload, CANVAS_NODE_TYPES.imageEdit] },
    createDefaultData: () => ({
      displayName: "VR360 全景场景",
      panoramaImage: null,
      panoramaUrl: null,
      isPreviewMode: false,
    }),
  },
  // 3D Director
  director3d: {
    type: CANVAS_NODE_TYPES.director3d,
    menuLabelKey: "canvas.director3d",
    menuIcon: "🎮",
    menuCategory: "场景",
    visibleInMenu: true,
    capabilities: { hasImage: true, hasPrompt: false, hasExport: true, hasTools: false },
    connectivity: { maxInputs: 0, maxOutputs: 0, acceptTypes: [CANVAS_NODE_TYPES.upload, CANVAS_NODE_TYPES.imageEdit] },
    createDefaultData: () => ({
      displayName: "3D 导演台",
      panoramaImage: null,
      panoramaUrl: null,
      characters: [
        { id: 1, name: "角色1", color: "#ef4444", gender: "male" as const, pose: "站立", x: -1.5, y: 0, z: 0, rotationY: 0, scale: 1 },
        { id: 2, name: "角色2", color: "#22c55e", gender: "female" as const, pose: "站立", x: 1.5, y: 0, z: 0, rotationY: 180, scale: 1 },
      ],
      cameras: [],
      props: [],
      activeTab: "characters",
      skyColor: "#141414",
      groundVisible: true,
      gridVisible: true,
      cameraRotationX: -20,
      cameraRotationY: 30,
      cameraZoom: 1,
      cameraPanX: 0,
      cameraPanY: 0,
    }),
  },
  // Audio Node
  audioNode: {
    type: CANVAS_NODE_TYPES.audio,
    menuLabelKey: "canvas.audioNode",
    menuIcon: "🔊",
    menuCategory: "媒体",
    visibleInMenu: true,
    capabilities: { hasImage: false, hasPrompt: false, hasExport: false, hasTools: false },
    connectivity: { maxInputs: 0, maxOutputs: 0, acceptTypes: [] },
    createDefaultData: () => ({
      displayName: "音频",
      audioPath: null,
      sourceFileName: null,
      duration: null,
      ttsText: "",
      ttsModel: "minimax-speech-2.8-hd",
      ttsProvider: "audio-model",
      isGenerating: false,
      generatedAudioPath: null,
      generatedFileName: null,
      cloneModelId: null,
      cloneModelName: null,
      cloneRefAudioPath: null,
    }),
  },
  // Export Image (hidden from menu)
  [CANVAS_NODE_TYPES.exportImage]: {
    type: CANVAS_NODE_TYPES.exportImage,
    menuLabelKey: "canvas.exportImage",
    menuIcon: "💾",
    menuCategory: "基础",
    visibleInMenu: false,
    capabilities: { hasImage: true, hasPrompt: false, hasExport: true, hasTools: true },
    connectivity: { maxInputs: 0, maxOutputs: 0, acceptTypes: [CANVAS_NODE_TYPES.upload, CANVAS_NODE_TYPES.imageEdit, CANVAS_NODE_TYPES.storyboardGen, CANVAS_NODE_TYPES.video, CANVAS_NODE_TYPES.videoFrame] },
    createDefaultData: () => ({
      displayName: "导出图片",
      imageUrl: null,
      aspectRatio: "1:1",
      isSizeManuallyAdjusted: false,
      sourceNodeIds: [],
    }),
  },
  // Group (hidden from menu)
  [CANVAS_NODE_TYPES.group]: {
    type: CANVAS_NODE_TYPES.group,
    menuLabelKey: "canvas.group",
    menuIcon: "📦",
    menuCategory: "基础",
    visibleInMenu: false,
    capabilities: { hasImage: false, hasPrompt: false, hasExport: false, hasTools: false },
    connectivity: { maxInputs: 0, maxOutputs: 0, acceptTypes: [] },
    createDefaultData: () => ({
      displayName: "分组",
      childNodeIds: [],
    }),
  },
  // Storyboard Split (hidden from menu)
  [CANVAS_NODE_TYPES.storyboardSplit]: {
    type: CANVAS_NODE_TYPES.storyboardSplit,
    menuLabelKey: "canvas.storyboardSplit",
    menuIcon: "✂️",
    menuCategory: "基础",
    visibleInMenu: false,
    capabilities: { hasImage: true, hasPrompt: false, hasExport: false, hasTools: true },
    connectivity: { maxInputs: 0, maxOutputs: 0, acceptTypes: [CANVAS_NODE_TYPES.upload, CANVAS_NODE_TYPES.imageEdit, CANVAS_NODE_TYPES.video, CANVAS_NODE_TYPES.videoFrame] },
    createDefaultData: () => ({
      displayName: "分镜拆分",
      imageUrl: null,
      aspectRatio: "16:9",
      isSizeManuallyAdjusted: false,
      rows: 2,
      cols: 3,
      frames: [],
    }),
  },
  // Cut Result Node
  cutResultNode: {
    type: CANVAS_NODE_TYPES.cutResult,
    menuLabelKey: "canvas.cutResult",
    menuIcon: "🧩",
    menuCategory: "基础",
    visibleInMenu: false, // Auto-created, not in toolbar
    capabilities: { hasImage: true, hasPrompt: false, hasExport: true, hasTools: false },
    connectivity: { maxInputs: 0, maxOutputs: 0, acceptTypes: [CANVAS_NODE_TYPES.videoFrame] },
    createDefaultData: () => ({
      displayName: "切割结果",
      sourceNodeId: "",
      gridCols: 2,
      frames: [],
      imageUrl: null,
      previewImageUrl: null,
      aspectRatio: "16:9",
      isSizeManuallyAdjusted: false,
    }),
  },
  // Video Composition Node
  [CANVAS_NODE_TYPES.videoComposition]: {
    type: CANVAS_NODE_TYPES.videoComposition,
    menuLabelKey: "canvas.videoComposition",
    menuIcon: "🔗",
    menuCategory: "媒体",
    visibleInMenu: true,
    capabilities: { hasImage: true, hasPrompt: false, hasExport: false, hasTools: true },
    connectivity: {
      maxInputs: 0,
      maxOutputs: 0,
      acceptTypes: [CANVAS_NODE_TYPES.video, CANVAS_NODE_TYPES.videoResult, CANVAS_NODE_TYPES.videoFrame],
    },
    createDefaultData: () => ({
      displayName: "视频合成",
      videoPaths: [],
      composedVideoUrl: null,
      compositionMode: "sequential",
      isComposing: false,
      error: null,
      clipEdits: [],
      isEditorOpen: false,
      selectedClipIndex: 0,
    }),
  },
  // Character Element Node (auto-created by ScriptNode extraction, hidden from menu)
  [CANVAS_NODE_TYPES.character]: {
    type: CANVAS_NODE_TYPES.character,
    menuLabelKey: "canvas.characterNode",
    menuIcon: "👤",
    menuCategory: "基础",
    visibleInMenu: false,
    capabilities: { hasImage: true, hasPrompt: true, hasExport: false, hasTools: true },
    connectivity: { maxInputs: 0, maxOutputs: 0, acceptTypes: [] },
    createDefaultData: () => ({
      displayName: "角色要素",
      items: [],
      sourceScriptNodeId: "",
      providerId: "",
      model: "",
      requestAspectRatio: "3:4",
      size: "2K",
      generateCount: 1,
    }),
  },
  // Scene Element Node (auto-created by ScriptNode extraction, hidden from menu)
  [CANVAS_NODE_TYPES.scene]: {
    type: CANVAS_NODE_TYPES.scene,
    menuLabelKey: "canvas.sceneNode",
    menuIcon: "🏔",
    menuCategory: "场景",
    visibleInMenu: false,
    capabilities: { hasImage: true, hasPrompt: true, hasExport: false, hasTools: true },
    connectivity: { maxInputs: 0, maxOutputs: 0, acceptTypes: [] },
    createDefaultData: () => ({
      displayName: "场景要素",
      items: [],
      sourceScriptNodeId: "",
      providerId: "",
      model: "",
      requestAspectRatio: "16:9",
      size: "2K",
      generateCount: 1,
    }),
  },
  // Prop Element Node (auto-created by ScriptNode extraction, hidden from menu)
  [CANVAS_NODE_TYPES.prop]: {
    type: CANVAS_NODE_TYPES.prop,
    menuLabelKey: "canvas.propNode",
    menuIcon: "🎒",
    menuCategory: "场景",
    visibleInMenu: false,
    capabilities: { hasImage: true, hasPrompt: true, hasExport: false, hasTools: true },
    connectivity: { maxInputs: 0, maxOutputs: 0, acceptTypes: [] },
    createDefaultData: () => ({
      displayName: "道具要素",
      items: [],
      sourceScriptNodeId: "",
      providerId: "",
      model: "",
      requestAspectRatio: "1:1",
      size: "2K",
      generateCount: 1,
    }),
  },
  // ─── Novel Writing Nodes ──────────────────────────────────────────────────
  [CANVAS_NODE_TYPES.novel]: {
    type: CANVAS_NODE_TYPES.novel,
    menuLabelKey: "canvas.novelNode",
    menuIcon: "📖",
    menuCategory: "小说",
    visibleInMenu: true,
    capabilities: { hasImage: false, hasPrompt: true, hasExport: false, hasTools: false },
    connectivity: { maxInputs: 0, maxOutputs: 2, acceptTypes: [] },
    createDefaultData: () => ({
      displayName: "小说",
      premise: "",
      generatedSettings: "",
      characters: [],
      outline: [],
      isGenerating: false,
      providerId: "",
      model: "",
    }),
  },
  [CANVAS_NODE_TYPES.novelChapter]: {
    type: CANVAS_NODE_TYPES.novelChapter,
    menuLabelKey: "canvas.novelChapterNode",
    menuIcon: "✍️",
    menuCategory: "小说",
    visibleInMenu: true,
    capabilities: { hasImage: false, hasPrompt: true, hasExport: false, hasTools: false },
    connectivity: { maxInputs: 0, maxOutputs: 0, acceptTypes: [] },
    createDefaultData: () => ({
      displayName: "章节内容",
      chapterNo: 1,
      chapterTitle: "",
      writingGuide: "",
      content: "",
      isFinalized: false,
      globalState: null,
      isGenerating: false,
      generationPhase: "idle",
      providerId: "",
      model: "",
    }),
  },
  [CANVAS_NODE_TYPES.assetGen]: {
    type: CANVAS_NODE_TYPES.assetGen,
    menuLabelKey: "canvas.assetGenNode",
    menuIcon: "🎭",
    menuCategory: "媒体",
    visibleInMenu: true,
    capabilities: { hasImage: true, hasPrompt: true, hasExport: false, hasTools: false },
    connectivity: { maxInputs: 0, maxOutputs: 1, acceptTypes: [] },
    createDefaultData: () => ({
      displayName: "素材生成",
      prompt: "",
      cameraAngle: "front",
      cameraAzimuth: 0,
      cameraElevation: 0,
      cameraZoom: 5,
      characterRef: null,
      poseRef: null,
      sceneRef: null,
      selectedPoseId: null,
      removeBg: false,
      removeBgFeather: 0,
      removeBgGreenScreen: 0,
      removeBgEdgeShrink: 0,
      aspectRatio: "1:1",
      size: "1K",
      negativeHints: [],
      generatedImageUrl: null,
      removedBgUrl: null,
      isGenerating: false,
      progressPercent: 0,
      isRemovingBg: false,
      history: [],
      providerId: "",
      model: "",
    }),
  },
  // Text Annotation Node
  textAnnotationNode: {
    type: CANVAS_NODE_TYPES.textAnnotation,
    menuLabelKey: "canvas.textAnnotation",
    menuIcon: "📝",
    menuCategory: "基础",
    visibleInMenu: true,
    capabilities: { hasImage: false, hasPrompt: false, hasExport: false, hasTools: false },
    connectivity: { maxInputs: 2, maxOutputs: 2, acceptTypes: [] },
    createDefaultData: () => ({
      displayName: "文字标注",
      text: "",
      fontSize: 14,
    }),
  },
};

/**
 * Look up a node definition by its ReactFlow node type (e.g. "videoNode", "imageNode").
 * This handles the mismatch where nodeRegistry keys (e.g. "videoGen") differ from
 * the actual node.type values (e.g. "videoNode").
 */
export function getNodeDefByType(nodeType: string): CanvasNodeDefinition | undefined {
  // Try direct key match first (for entries where key === type, e.g. "imageNode")
  const direct = nodeRegistry[nodeType];
  if (direct) return direct;
  // Fallback: search by type field
  return Object.values(nodeRegistry).find((def) => def.type === nodeType);
}



