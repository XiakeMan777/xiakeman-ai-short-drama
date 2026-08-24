export const CANVAS_NODE_TYPES = {
  upload: "uploadNode",
  imageEdit: "imageNode",
  video: "videoNode",
  videoResult: "videoResultNode",
  videoFrame: "videoFrameNode",
  director3d: "director3dNode",
  panorama360: "panorama360Node",
  exportImage: "exportImageNode",
  script: "scriptNode",
  scriptResult: "scriptResultNode",
  group: "groupNode",
  storyboardSplit: "storyboardNode",
  storyboardGen: "storyboardGenNode",
  audio: "audioNode",
  cutResult: "cutResultNode",
  videoComposition: "videoCompositionNode",
  textAnnotation: "textAnnotationNode",
  character: "characterNode",
  scene: "sceneNode",
  prop: "propNode",
  novel: "novelNode",
  novelChapter: "novelChapterNode",
  assetGen: "assetGenNode",
} as const;

export type CanvasNodeType =
  (typeof CANVAS_NODE_TYPES)[keyof typeof CANVAS_NODE_TYPES];

/** 分镜生成风格类型 */
export type StoryboardStyleType = "2d-anime" | "3d-cg" | "live-action";

/** 风格词映射（中文，注入到每帧 prompt 中） */
export const STORYBOARD_STYLE_PROMPTS: Record<StoryboardStyleType, string> = {
  "2d-anime": "2D动漫风格，日式动画美学，赛璐璐上色，鲜艳色彩，清晰线条",
  "3d-cg": "3D国漫风格，中国3D动画电影美学，高质量渲染，电影级光影，写实材质",
  "live-action": "真人实拍风格，电影摄影，自然光影，真实质感，实拍画面",
};

/** 风格中文标签映射 */
export const STORYBOARD_STYLE_LABELS: Record<StoryboardStyleType, string> = {
  "2d-anime": "2D动漫",
  "3d-cg": "3D国漫",
  "live-action": "真人",
};

// Base data interfaces
interface NodeDisplayData {
  displayName?: string;
  [key: string]: unknown;
}

export interface NodeImageData extends NodeDisplayData {
  imageUrl: string | null;
  previewImageUrl?: string | null;
  imageWidth?: number;
  imageHeight?: number;
  aspectRatio: string;
  isSizeManuallyAdjusted: boolean;
}

export interface UploadImageNodeData extends NodeImageData {
  sourceFileName?: string | null;
  /** When true, this node is an AI generation target in progress */
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number | null;
  /** Expected generation duration in ms (from model config), used for progress bar */
  expectedDurationMs?: number;
  /** Error message when generation fails */
  generationError?: string | null;
  /** Remote job ID from the AI provider, stored for remount polling recovery */
  generationJobId?: string | null;
  /** Provider ID used for the job (needed for remount polling to determine credits) */
  providerId?: string;
  /** User-resizable node width (px) */
  width?: number;
  /** User-resizable node height (px) */
  height?: number;
}

export interface ImageEditNodeData extends NodeImageData {
  prompt: string;
  model: string;
  provider: string;
  /** Selected channel/provider ID (e.g. "openai-compatible", "grsai"). Takes precedence over `provider` field. */
  providerId?: string;
  size: string;
  requestAspectRatio: string;
  extraParams: Record<string, unknown>;
  isGenerating: boolean;
  generationStartedAt: number | null;
  generationDurationMs: number | null;
  /** Real-time generation progress (0-100), from polling */
  progressPercent?: number;
  styleType?: string | null;
  /** 风格类型：2d-anime / 3d-cg / live-action */
  artStyle?: StoryboardStyleType;
  /** Persisted asset-library references so they survive panel closes */
  referencedAssets?: { url: string; thumbnailUrl?: string; name?: string }[];
  /** User-resizable node width (px). Default 520, clamped 360-900. */
  width?: number;
  /** User-resizable node height (px). Default auto, clamped 200-800. */
  height?: number;
  /** Negative prompt — things to exclude from generation (industry standard) */
  negativePrompt?: string;
  /** Seed for reproducible generation — null means random */
  seed?: number | null;
}

export interface ExportImageNodeData extends NodeImageData {
  sourceNodeIds: string[];
  /** User-resizable node width (px) */
  width?: number;
  /** User-resizable node height (px) */
  height?: number;
}

// ============================================================
// Script Node (剧本 → 分镜脚本)
// ============================================================

/** 单条分镜数据（AI 返回 JSON 格式） */
export interface ScriptFrame {
  /** 镜号，从 1 开始 */
  shotNumber: number;
  /** 时长（秒） */
  duration: number;
  /** 画面描述（生图 prompt 的主要来源） */
  sceneDescription: string;
  /** 景别：特写/近景/中景/全景/远景 */
  shotType: string;
  /** 机位角度 */
  cameraAngle: string;
  /** 镜头运动 */
  cameraMovement: string;
  /** 角色动作 */
  characterAction: string;
  /** 情绪 */
  emotion: string;
  /** 对白 */
  dialogue: string;
  /** 光影氛围 */
  lighting: string;
  /** 场景标签 */
  sceneTag: string;
  /** 音效 */
  sound: string;
  /** 角色名称 */
  character: string;
  /** 角色描述 */
  characterDesc: string;
}

export interface ScriptNodeData extends NodeDisplayData {
  /** 用户输入的剧本/小说原文 */
  scriptText: string;
  /** AI 生成的分镜脚本列表 */
  frames: ScriptFrame[];
  /** 是否正在生成 */
  isGenerating: boolean;
  /** 选中的通道 ID */
  providerId: string;
  /** 选中的模型 */
  model: string;
  /** User-resizable node width (px) */
  width?: number;
  /** User-resizable node height (px) */
  height?: number;
}

/** 角色实体（LibTV Step2 资产准备） */
export interface CharacterEntity {
  name: string;
  avatar?: string | null;
  description?: string;
  shotNumbers: number[];
}

/** 场景实体（LibTV Step2 资产准备） */
export interface SceneEntity {
  name: string;
  referenceImage?: string | null;
  description?: string;
  shotNumbers: number[];
}

/** 分镜脚本结果节点数据（由 ScriptNode 生成后自动弹出） */
export interface ScriptResultNodeData extends NodeDisplayData {
  frames: ScriptFrame[];
  characters: CharacterEntity[];
  scenes: SceneEntity[];
  sourceScriptNodeId: string;
  isStreaming?: boolean;
  width?: number;
  height?: number;
}

export interface GroupNodeData extends NodeDisplayData {
  childNodeIds: string[];
  /** User-resizable node width (px) */
  width?: number;
  /** User-resizable node height (px) */
  height?: number;
}

export interface StoryboardFrame {
  index: number;
  /** Frame label / shot number (e.g. "镜头1", "SC-01") */
  label?: string;
  /** Frame description / prompt text */
  description: string;
  /** Frame notes / additional remarks */
  notes?: string;
  imageUrl: string | null;
  /** Stored job ID for recovery after timeout/reload */
  generationJobId?: string | null;
  /** Preview thumbnail path (small JPEG, for fast rendering) */
  previewImageUrl?: string | null;
  /** Duration in seconds (for video composition) */
  duration?: number;
}

export interface StoryboardSplitNodeData extends NodeImageData {
  rows: number;
  cols: number;
  lineThicknessPercent?: number;
  frames: StoryboardFrame[];
  /** User-resizable node width (px) */
  width?: number;
  /** User-resizable node height (px) */
  height?: number;
}

export interface StoryboardGenNodeData extends NodeImageData {
  rows: number;
  cols: number;
  frames: StoryboardFrame[];
  overallAspectRatio: string;
  cellAspectRatio: string;
  aspectRatioMode: "overall" | "cell";
  model: string;
  provider: string;
  /** Selected channel/provider ID. Takes precedence over `provider` field. */
  providerId?: string;
  isGenerating: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number | null;
  /** Persisted asset-library references so they survive panel closes */
  referencedAssets?: { url: string; thumbnailUrl?: string; name?: string }[];
  /** 风格类型：2d-anime / 3d-cg / live-action */
  styleType?: StoryboardStyleType;
  /** User-resizable node width (px) */
  width?: number;
  /** User-resizable node height (px) */
  height?: number;
}

export interface VideoNodeData extends NodeImageData {
  prompt: string;
  model: string;
  provider: string;
  /** Selected channel/provider ID (e.g. "vjimeng", "siliconflow"). Takes precedence over `provider` field. */
  providerId?: string;
  size: string;
  requestAspectRatio: string;
  extraParams: Record<string, unknown>;
  isGenerating: boolean;
  generationStartedAt: number | null;
  generationDurationMs: number | null;
  /** Remote job ID from the AI provider, used for polling and cancellation */
  generationJobId?: string | null;
  videoUrl: string | null;
  videoMode: "text2video" | "image2video" | "firstLastFrame" | "fullReference" | "imageReference" | "videoReference";
  resultNodeId?: string | null;
  /** Persisted asset-library references so they survive panel closes */
  referencedAssets?: { url: string; thumbnailUrl?: string; name?: string }[];
  /** User-resizable node width (px) */
  width?: number;
  /** User-resizable node height (px) */
  height?: number;
  /** First frame image path for 首尾帧 mode — local file path or URL */
  firstFrameImage?: string | null;
  /** Last frame image path for 首尾帧 mode — local file path or URL */
  lastFrameImage?: string | null;
  /** Video reference path for 视频参考 mode — local file path or URL */
  videoReferencePath?: string | null;
  /** Start generation automatically after this node is created by another workflow. */
  autoStartGeneration?: boolean;
  /** Monotonic token used to avoid replaying the same auto-start request. */
  autoStartGenerationNonce?: number | null;
}

export interface VideoResultNodeData extends NodeDisplayData {
  prompt: string;
  model: string;
  isGenerating: boolean;
  progressPercent: number;
  videoUrl: string | null;
  imageUrl: string | null;
  error: string | null;
  generationStartedAt: number | null;
  generationDurationMs: number | null;
  /** Aspect ratio for the video container, e.g. "16:9", "9:16", "1:1" */
  aspectRatio?: string;
  /** User-resizable node width (px) */
  width?: number;
  /** User-resizable node height (px) */
  height?: number;
}

export interface VideoFrameNodeData extends NodeImageData {
  sourceFileName?: string | null;
  videoPath: string | null;
  extractionMode: "uniform" | "smart";
  frameCount: number;
  outputWidth: number;
  extractedFrames: string[];
  extractedFramePreviews?: string[];
  extractedFrameTimestamps?: number[];
  isExtracting: boolean;
  /** User-resizable node width (px) */
  width?: number;
  /** User-resizable node height (px) */
  height?: number;
}

export interface Director3DCharacter {
  id: number;
  name: string;
  color: string;
  gender: "male" | "female" | "child";
  pose: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: number;
}

export interface Director3DCamera {
  id: number;
  name: string;
  fov: number;
  aspectRatio: "16:9" | "9:16" | "1:1" | "2.35:1";
  positionX: number;
  positionY: number;
  positionZ: number;
  lookAtX: number;
  lookAtY: number;
  lookAtZ: number;
}

export interface Director3DProp {
  id: number;
  name: string;
  type: string;       // 预设道具类型key，如 "chair", "table", "box" 等
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: number;
  color: string;
  // 基础几何体的自定义尺寸
  customWidth?: number;
  customHeight?: number;
  customDepth?: number;
}

export interface Director3DNodeData extends NodeDisplayData {
  panoramaImage: string | null;
  panoramaUrl: string | null;
  characters: Director3DCharacter[];
  cameras: Director3DCamera[];
  props: Director3DProp[];
  activeTab: "background" | "characters" | "props";
  skyColor: string;
  groundVisible: boolean;
  gridVisible: boolean;
  // Legacy camera fields (kept for migration)
  cameraRotationX: number;
  cameraRotationY: number;
  cameraZoom: number;
  cameraPanX: number;
  cameraPanY: number;
  /** User-resizable node width (px) */
  width?: number;
  /** User-resizable node height (px) */
  height?: number;
}

export interface Panorama360NodeData extends NodeDisplayData {
  panoramaImage: string | null;
  panoramaUrl: string | null;
  isPreviewMode: boolean;
  /** User-resizable node width (px) */
  width?: number;
  /** User-resizable node height (px) */
  height?: number;
}

export interface AudioNodeData extends NodeDisplayData {
  /** Persisted local file path of the audio */
  audioPath: string | null;
  /** Original file name of the uploaded audio */
  sourceFileName: string | null;
  /** Duration in seconds (populated after load) */
  duration: number | null;
  /** TTS: text to synthesize */
  ttsText: string;
  /** TTS: selected model */
  ttsModel: string;
  /** TTS: selected provider (for API key lookup) */
  ttsProvider: string;
  /** TTS: is generating audio */
  isGenerating: boolean;
  /** TTS: generated audio path */
  generatedAudioPath: string | null;
  /** TTS: generated audio file name */
  generatedFileName: string | null;
  /** Fish Audio voice clone model ID (for TTS reference_id) */
  cloneModelId: string | null;
  /** Fish Audio voice clone model display name */
  cloneModelName: string | null;
  /** Reference audio path for voice cloning (local file) */
  cloneRefAudioPath: string | null;
  /** User-resizable node width (px) */
  width?: number;
  /** User-resizable node height (px) */
  height?: number;
}

export interface VideoClipEdit {
  /** Start trim time in seconds */
  trimStart: number;
  /** End trim time in seconds */
  trimEnd: number;
  /** Playback speed multiplier (0.25 - 4.0) */
  speed: number;
  /** Whether audio is separated/muted */
  audioMuted: boolean;
  /** Extracted audio path (if separated) */
  extractedAudioPath: string | null;
  /** Audio volume 0-100, default 100 */
  volume: number;
  /** Split points (seconds) within this clip — each point divides the clip */
  splitPoints: number[];
}

export interface VideoCompositionNodeData extends NodeDisplayData {
  videoPaths: string[];
  composedVideoUrl: string | null;
  compositionMode: "sequential" | "overlay" | "grid";
  isComposing: boolean;
  error: string | null;
  /** Per-clip edit settings, indexed by clip order */
  clipEdits?: VideoClipEdit[];
  /** Whether the fullscreen editor is open */
  isEditorOpen?: boolean;
  /** Index of the currently selected clip in the editor */
  selectedClipIndex?: number;
  /** User-resizable node width (px) */
  width?: number;
  /** User-resizable node height (px) */
  height?: number;
}

export interface TextAnnotationNodeData extends NodeDisplayData {
  text: string;
  fontSize: number;
  /** @deprecated Legacy field from when textAnnotation was the script node */
  selectedAction?: string | null;
  /** @deprecated Legacy field */
  provider?: string;
  /** @deprecated Legacy field */
  providerId?: string;
  /** @deprecated Legacy field */
  model?: string;
}

// ============================================================
// Element Nodes (角色/场景/道具 — 从剧本提取)
// ============================================================

/** 场景视角类型 */
export type SceneViewAngle = "front" | "side" | "top" | "panorama";

/** 场景视角追加词映射 */
export const SCENE_VIEW_ANGLE_PROMPTS: Record<SceneViewAngle, string> = {
  front: "场景正面视角，正面全景",
  side: "场景侧面视角，侧面全景",
  top: "场景俯视视角，鸟瞰全景",
  panorama: "场景360度全景视角",
};

/** 场景视角中文标签 */
export const SCENE_VIEW_ANGLE_LABELS: Record<SceneViewAngle, string> = {
  front: "正面",
  side: "侧面",
  top: "俯视",
  panorama: "全景",
};

/** 角色卡片数据 */
export interface CharacterItem {
  id: string;
  name: string;
  hair: string;
  face: string;
  body: string;
  upperClothing: string;
  lowerClothing: string;
  shoes: string;
  accessories: string;
  styleType: StoryboardStyleType;
  imageUrl: string | null;
  isGenerating: boolean;
  /** Real-time generation progress (0-100), from API polling or real-time events */
  progressPercent?: number;
  /** Preserved raw text from textarea editing — keeps user formatting */
  rawText?: string;
}

/** 场景卡片数据 */
export interface SceneItem {
  id: string;
  name: string;
  type: string;
  environment: string;
  lighting: string;
  atmosphere: string;
  viewAngle: SceneViewAngle;
  styleType: StoryboardStyleType;
  imageUrl: string | null;
  isGenerating: boolean;
  /** Real-time generation progress (0-100), from API polling or real-time events */
  progressPercent?: number;
  /** Preserved raw text from textarea editing — keeps user formatting */
  rawText?: string;
}

/** 道具卡片数据 */
export interface PropItem {
  id: string;
  name: string;
  appearance: string;
  material: string;
  details: string;
  styleType: StoryboardStyleType;
  imageUrl: string | null;
  isGenerating: boolean;
  /** Real-time generation progress (0-100), from API polling or real-time events */
  progressPercent?: number;
  /** Preserved raw text from textarea editing — keeps user formatting */
  rawText?: string;
}

export interface CharacterNodeData extends NodeDisplayData {
  items: CharacterItem[];
  /** 关联的剧本节点 ID */
  sourceScriptNodeId: string;
  /** Image generation settings */
  providerId: string;
  model: string;
  requestAspectRatio: string;
  size: string;
  generateCount: number;
  /** User-resizable node width (px) */
  width?: number;
  /** User-resizable node height (px) */
  height?: number;
}

export interface SceneNodeData extends NodeDisplayData {
  items: SceneItem[];
  /** 关联的剧本节点 ID */
  sourceScriptNodeId: string;
  /** Image generation settings */
  providerId: string;
  model: string;
  requestAspectRatio: string;
  size: string;
  generateCount: number;
  /** User-resizable node width (px) */
  width?: number;
  /** User-resizable node height (px) */
  height?: number;
}

export interface PropNodeData extends NodeDisplayData {
  items: PropItem[];
  /** 关联的剧本节点 ID */
  sourceScriptNodeId: string;
  /** Image generation settings */
  providerId: string;
  model: string;
  requestAspectRatio: string;
  size: string;
  generateCount: number;
  /** User-resizable node width (px) */
  width?: number;
  /** User-resizable node height (px) */
  height?: number;
}

// ─── Novel Writing Nodes ───────────────────────────────────────────────────

/** 小说设定 — Layer1 核心问答 */
/** 小说角色档案 */
export interface NovelCharacterProfile {
  name: string;         // 姓名
  role: string;         // 角色类型：主角/反派/配角/导师
  appearance: string;   // 外貌
  personality: string;  // 性格
  motivation: string;   // 动机
  secret: string;       // 秘密/暗线
  relationships: string; // 与其他角色关系
}

/** 小说章节大纲条目 */
export interface NovelOutlineEntry {
  chapterNo: number;      // 章节号
  title: string;          // 标题
  perspective: string;    // 视角
  conflict: string;       // 冲突
  keyEvents: string;      // 关键事件
  foreshadowing: string;  // 伏笔
  wordCount: number;       // 预计字数
}

/** 小说全局状态追踪 */
export interface NovelGlobalState {
  globalSummary: string;       // 全局摘要
  characterState: string;      // 角色状态
  plotArcs: string;            // 情节线
  foreshadowing: string;       // 伏笔追踪（已埋/已收/未收）
}

/** 小说节点（合并设定+角色+目录） */
export interface NovelNodeData extends NodeDisplayData {
  /** 一句话描述 */
  premise: string;
  /** AI 生成的设定文本 */
  generatedSettings: string;
  /** 角色档案列表 */
  characters: NovelCharacterProfile[];
  /** 章节大纲列表 */
  outline: NovelOutlineEntry[];
  /** 是否正在生成 */
  isGenerating: boolean;
  /** 对话通道 */
  providerId: string;
  model: string;
  width?: number;
  height?: number;
}

export interface NovelChapterNodeData extends NodeDisplayData {
  /** 章节序号（从目录选择） */
  chapterNo: number;
  /** 章节标题（从目录自动填入） */
  chapterTitle: string;
  /** 本章写作指导 */
  writingGuide: string;
  /** AI 生成的章节正文 */
  content: string;
  /** 是否已定稿 */
  isFinalized: boolean;
  /** 全局状态追踪 */
  globalState: NovelGlobalState | null;
  /** 是否正在生成 */
  isGenerating: boolean;
  /** 生成阶段: idle / analyzing / writing / done */
  generationPhase: string;
  /** 对话通道 */
  providerId: string;
  model: string;
  width?: number;
  height?: number;
}

/** 镜头角度预设 */
export interface CameraAnglePreset {
  value: string;
  label: string;
  prompt: string;
}

/** 姿势库条目 */
export interface PoseLibraryEntry {
  id: string;
  name: string;
  category: string;
  thumbnailUrl: string;
  description: string;
}

/** 素材生成历史记录条目 */
export interface AssetGenHistoryEntry {
  id: string;
  timestamp: number;
  prompt: string;
  cameraAngle: string;
  providerId: string;
  model: string;
  generatedImageUrl: string;
  removedBgUrl: string | null;
}

/** 素材生成节点（对标闪帧素材助手） */
export interface AssetGenNodeData extends NodeDisplayData {
  /** 提示词 */
  prompt: string;
  /** 镜头角度 */
  cameraAngle: string;
  /** 场景相机 - 方位角 (Azimuth, 0 ~ 360, 0=正面) */
  cameraAzimuth: number;
  /** 场景相机 - 仰角 (Elevation, -30 ~ 60) */
  cameraElevation: number;
  /** 场景相机 - 缩放 (Zoom, 0 ~ 10, 越大越近=特写) */
  cameraZoom: number;
  /** 参考图 - 角色参考 */
  characterRef: string | null;
  /** 参考图 - 姿势参考 */
  poseRef: string | null;
  /** 参考图 - 场景参考 */
  sceneRef: string | null;
  /** 选中的姿势库姿势ID */
  selectedPoseId: string | null;
  /** 一键抠图开关 */
  removeBg: boolean;
  /** 抠图参数 - 去毛边 */
  removeBgFeather: number;
  /** 抠图参数 - 去绿强度 (0~100) */
  removeBgGreenScreen: number;
  /** 抠图参数 - 边缘收缩 (0~20) */
  removeBgEdgeShrink: number;
  /** 输出比例 */
  aspectRatio: string;
  /** 输出尺寸 */
  size: string;
  /** 不需要的元素（如：不要场景、不要渐变、不要网格、不要骨架线、不要生成角色、不要随机改变视角） */
  negativeHints: string[];
  /** 生成的图片URL */
  generatedImageUrl: string | null;
  /** 抠图后的图片URL */
  removedBgUrl: string | null;
  /** 是否正在生成 */
  isGenerating: boolean;
  /** Real-time progress percentage from the external API (0-100, -1 if unknown) */
  progressPercent: number;
  /** 是否正在抠图 */
  isRemovingBg: boolean;
  /** 历史记录 */
  history: AssetGenHistoryEntry[];
  /** 对话通道 */
  providerId: string;
  model: string;
  width?: number;
  height?: number;
}

export interface CutResultFrame {
  index: number;
  /** Frame image path */
  imageUrl: string;
  /** Preview/thumbnail path */
  previewImageUrl?: string;
  /** Frame description text */
  description: string;
  /** Timestamp in seconds from source video */
  timestamp: number;
}

export interface CutResultNodeData extends NodeDisplayData {
  /** Source video frame node ID */
  sourceNodeId: string;
  /** Number of columns in grid */
  gridCols: number;
  /** Extracted frames */
  frames: CutResultFrame[];
  /** User-resizable node width (px) */
  width?: number;
  /** User-resizable node height (px) */
  height?: number;
}

export type CanvasNodeData =
  | UploadImageNodeData
  | ImageEditNodeData
  | ExportImageNodeData
  | ScriptNodeData
  | ScriptResultNodeData
  | GroupNodeData
  | StoryboardSplitNodeData
  | StoryboardGenNodeData
  | VideoNodeData
  | VideoResultNodeData
  | VideoFrameNodeData
  | Director3DNodeData
  | Panorama360NodeData
  | AudioNodeData
  | CutResultNodeData
  | VideoCompositionNodeData
  | TextAnnotationNodeData
  | CharacterNodeData
  | SceneNodeData
  | PropNodeData
  | NovelNodeData
  | NovelChapterNodeData
  | AssetGenNodeData;

// Aspect ratio presets
export const ASPECT_RATIOS = {
  "1:1": { label: "1:1", width: 1, height: 1 },
  "16:9": { label: "16:9", width: 16, height: 9 },
  "9:16": { label: "9:16", width: 9, height: 16 },
  "4:3": { label: "4:3", width: 4, height: 3 },
  "3:4": { label: "3:4", width: 3, height: 4 },
  "3:2": { label: "3:2", width: 3, height: 2 },
  "2:3": { label: "2:3", width: 2, height: 3 },
} as const;

// Camera angle presets for AssetGen node
export const CAMERA_ANGLE_PRESETS: CameraAnglePreset[] = [
  { value: "front", label: "正面", prompt: "正面视角，直视镜头，front view" },
  { value: "side-left", label: "左侧", prompt: "左侧90度视角，侧面，left profile view" },
  { value: "side-right", label: "右侧", prompt: "右侧90度视角，侧面，right profile view" },
  { value: "back", label: "背面", prompt: "背面视角，back view" },
  { value: "three-quarter-left", label: "左前45°", prompt: "左前45度四分之三视角，three-quarter left view" },
  { value: "three-quarter-right", label: "右前45°", prompt: "右前45度四分之三视角，three-quarter right view" },
  { value: "high-angle", label: "俯拍", prompt: "高角度俯拍，俯视，high angle shot, looking down" },
  { value: "low-angle", label: "仰拍", prompt: "低角度仰拍，仰视，low angle shot, looking up" },
  { value: "bird-eye", label: "鸟瞰", prompt: "鸟瞰视角，正上方俯视，bird's eye view, top-down" },
  { value: "worm-eye", label: "虫视", prompt: "虫视视角，极低角度仰视，worm's eye view" },
  { value: "over-shoulder", label: "过肩", prompt: "过肩镜头，over-the-shoulder shot" },
  { value: "dutch-tilt", label: "倾斜", prompt: "荷兰角，倾斜构图，dutch tilt, canted angle" },
  { value: "close-up", label: "特写", prompt: "面部特写镜头，close-up shot" },
  { value: "extreme-close-up", label: "极特写", prompt: "极端特写，眼睛/嘴部细节，extreme close-up" },
  { value: "medium-shot", label: "中景", prompt: "中景镜头，腰部以上，medium shot" },
  { value: "full-shot", label: "全景", prompt: "全景镜头，全身可见，full shot" },
  { value: "wide-shot", label: "远景", prompt: "远景镜头，人物在环境中，wide shot" },
  { value: "extreme-wide", label: "极远景", prompt: "极远景，宏大场景，extreme wide shot, establishing shot" },
  { value: "cowboy-shot", label: "牛仔景", prompt: "牛仔镜头，膝盖以上，cowboy shot" },
  { value: "two-shot", label: "双人景", prompt: "双人镜头，two shot" },
  { value: "point-of-view", label: "主观", prompt: "主观视角，第一人称，POV shot, point of view" },
  { value: "profile-left", label: "左轮廓", prompt: "左侧轮廓特写，left profile close-up" },
  { value: "profile-right", label: "右轮廓", prompt: "右侧轮廓特写，right profile close-up" },
];

// Negative hint options for AssetGen node
export const NEGATIVE_HINT_OPTIONS = [
  { value: "no-scene", label: "不要场景", prompt: "no background scene, transparent background" },
  { value: "no-gradient", label: "不要渐变", prompt: "no gradient, flat solid color" },
  { value: "no-grid", label: "不要网格", prompt: "no grid lines" },
  { value: "no-shadow", label: "不要阴影", prompt: "no shadow, drop shadow removed" },
  { value: "no-outline", label: "不要描边", prompt: "no outline, no stroke" },
  { value: "no-skeleton", label: "不要骨架线", prompt: "do not copy the skeleton lines from the pose reference image" },
  { value: "no-character", label: "不要生成角色", prompt: "do not generate any character, generate scene only" },
  { value: "no-random-view", label: "锁定视角", prompt: "strictly follow the specified camera angle, do not randomly change viewpoint" },
];



