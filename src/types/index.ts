// ============================================================
// 虾客漫演(xiakeman.com) - TypeScript 类型定义
// ============================================================

// ---------- API 配置 ----------
export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** 图片分辨率 */
export type ImageSize = '1K' | '2K' | '4K';
export type ApimartImageQuality = 'auto' | 'high' | 'medium' | 'low';
export type ApimartImageBackground = 'auto' | 'transparent' | 'opaque';
export type ApimartImageModeration = 'auto' | 'low';
export type ApimartImageOutputFormat = 'png' | 'jpeg' | 'webp';
export type OpenAiImageQuality = 'auto' | 'high' | 'medium' | 'low';
export type OpenAiGptImage2Background = 'auto' | 'opaque';
export type OpenAiImageModeration = 'auto' | 'low';
export type OpenAiImageOutputFormat = 'png' | 'jpeg' | 'webp';

export interface ImageApiConfig {
  baseUrl: string;   // 默认 https://sd2.xiakeman.com/api
  apiKey: string;
  model: string;     // 默认 nano-banana；也可配置 OpenAI Images 模型
  /** 默认图片分辨率，可选 1K / 2K / 4K，默认 1K */
  defaultImageSize?: ImageSize;
  /** APIMart 旧版图片增强开关，保留用于读取历史本地配置 */
  apimartEnhance?: boolean;
  /** APIMart Gemini Google 文本搜索增强 */
  apimartGoogleSearch?: boolean;
  /** APIMart Gemini Google 图片搜索增强 */
  apimartGoogleImageSearch?: boolean;
  /** APIMart GPT-Image-2 官方渠道质量 */
  apimartQuality?: ApimartImageQuality;
  /** APIMart GPT-Image-2 官方渠道背景 */
  apimartBackground?: ApimartImageBackground;
  /** APIMart GPT-Image-2 官方渠道审核强度 */
  apimartModeration?: ApimartImageModeration;
  /** APIMart GPT-Image-2 官方渠道输出格式 */
  apimartOutputFormat?: ApimartImageOutputFormat;
  /** APIMart GPT-Image-2 官方渠道输出压缩率，0-100 */
  apimartOutputCompression?: number;
  /** APIMart GPT-Image-2 官方渠道遮罩 URL */
  apimartMaskUrl?: string;
  /** OpenAI 官方 GPT-Image-2 质量 */
  openaiImageQuality?: OpenAiImageQuality;
  /** OpenAI 官方 GPT-Image-2 背景；gpt-image-2 当前不支持 transparent */
  openaiImageBackground?: OpenAiGptImage2Background;
  /** OpenAI 官方 GPT-Image-2 审核强度 */
  openaiImageModeration?: OpenAiImageModeration;
  /** OpenAI 官方 GPT-Image-2 输出格式 */
  openaiImageOutputFormat?: OpenAiImageOutputFormat;
  /** OpenAI 官方 GPT-Image-2 输出压缩率，0-100，仅 jpeg/webp 有效 */
  openaiImageOutputCompression?: number;
  /** OpenAI 官方 GPT-Image-2 原生 size，例如 auto、2048x1152、3840x2160 */
  openaiImageSize?: string;
}

/** 语音合成(TTS) API 配置 */
export interface TtsApiConfig {
  baseUrl: string;        // 默认 https://api.xiaomimimo.com/v1
  apiKey: string;         // MiMo API Key
  model: string;          // 默认 mimo-v2.5-tts
}

export type TtsMode = 'preset' | 'voiceDesign' | 'voiceClone';

export type PresetTtsVoice =
  | 'mimo_default'
  | '冰糖'
  | '茉莉'
  | '苏打'
  | '白桦'
  | 'Mia'
  | 'Chloe'
  | 'Milo'
  | 'Dean';

export interface SpeakerVoiceOverride {
  mode: TtsMode;
  presetVoice?: PresetTtsVoice;
  styleTag: string;
  audioTag: string;
  userMessage: string;
  /** 角色声线参考；一键配音默认不直接发送给 MiMo VoiceDesign */
  voiceDesignPrompt?: string;
  /** 锁定后 AI 声线参考不会自动覆盖该角色 */
  voiceDesignLockedAt?: number;
  voiceDesignGeneratedAt?: number;
  cloneSampleBlobKey?: string;
  cloneSampleName?: string;
  cloneSampleMimeType?: string;
}

export type CharacterVoiceReferenceLanguage = 'CN' | 'EN' | 'JP' | 'KR' | 'custom';

export interface CharacterVoiceReference {
  id: string;
  characterName: string;
  displayName: string;
  language: CharacterVoiceReferenceLanguage;
  sourceWork?: string;
  sourceCharacter?: string;
  voiceActor?: string;
  voiceTags?: string;
  sampleText?: string;
  sourcePath?: string;
  audioBlobKey?: string;
  audioFileName?: string;
  audioMimeType?: string;
  audioBytes?: number;
  audioDurationSec?: number;
  publicAudioUrl?: string;
  blackVideoBlobKey?: string;
  blackVideoFileName?: string;
  blackVideoMimeType?: string;
  blackVideoBytes?: number;
  blackVideoDurationSec?: number;
  locked?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TtsLineSnapshot {
  signature: string;
  sourceText: string;
  speaker: string;
  generatedAt: number;
  durationMs?: number;
  targetDurationMs?: number;
  qualityNote?: string;
}

export interface TtsLineGenerationState {
  status: 'generating' | 'error';
  lineKey: string;
  sourceText: string;
  speaker: string;
  startedAt?: number;
  updatedAt: number;
  error?: string;
}

export interface DubbingDialogueAnalysis {
  storyboardIndex: number;
  storyboardName: string;
  timeRange?: string;
  speaker: string;
  text: string;
  emotion: string;
  suggestedVoice: PresetTtsVoice;
  styleTag: string;
  audioTag: string;
  userMessage?: string;
  sceneContext?: string;
  subtext?: string;
  emotionCurve?: string;
  pausePlan?: string;
  emphasis?: string;
  pacing?: string;
  targetDurationSec?: number;
  maxDurationSec?: number;
  performanceIntensity?: string;
  analysisSource?: 'ai' | 'recovered';
}

/** 音乐生成 API 配置 */
export interface MusicApiConfig {
  baseUrl: string;        // 默认 https://api.minimaxi.com
  apiKey: string;
  model: string;          // 默认 music-2.6-free
}

/** BGM 配置（章节级 + 分镜级） */
export interface BgmConfig {
  /** BGM 文件名或预设 ID */
  id: string;
  /** 显示名称 */
  name: string;
  /** BGM 来源：preset(内置预设) / upload(用户上传) */
  source: 'preset' | 'upload';
  /** Blob key（IndexedDB 中存储的音频文件） */
  blobKey?: string;
  /** 音量 0-1，默认 0.3 */
  volume: number;
  /** 是否循环播放，默认 true */
  loop: boolean;
  /** 淡入时长(秒)，默认 1 */
  fadeIn: number;
  /** 淡出时长(秒)，默认 1 */
  fadeOut: number;
}

/** 内置 BGM 预设 */
export interface BgmPreset {
  id: string;
  name: string;
  category: string;       // 如 '悬疑' / '古风' / '浪漫' / '战斗' / '悲伤'
  description: string;
  duration: number;       // 秒
  tags: string[];
}

/** 分镜音频混音状态 */
export interface StoryboardAudioMix {
  /** TTS 配音 Blob key 列表（按台词顺序） */
  ttsBlobKeys: string[];
  /** TTS 配音生成快照（按台词顺序），用于判断音色配置是否已过期 */
  ttsLineSnapshots?: Array<TtsLineSnapshot | null>;
  /** TTS 生成中的临时状态；刷新后会转为可重试错误，避免用户误以为仍在后台执行 */
  ttsLineGeneration?: Array<TtsLineGenerationState | null>;
  /** 音效 Blob key 列表（按时间段顺序） */
  sfxBlobKeys: string[];
  /** BGM 配置（覆盖章节级） */
  bgm?: BgmConfig;
  /** 混音输出 Blob key */
  mixBlobKey?: string;
}

export type VoiceProfileMode = 'preset' | 'clone';

export interface VoiceSampleCandidate {
  id: string;
  speaker: string;
  sourceAssetId?: string;
  startSec: number;
  endSec: number;
  confidence: number;
  reason: string;
  blobKey?: string;
  fileName?: string;
  mimeType?: string;
}

export interface VoiceProfile {
  speaker: string;
  mode: VoiceProfileMode;
  presetVoice: PresetTtsVoice;
  roleType: 'main' | 'supporting' | 'narrator';
  locked: boolean;
  cloneSampleBlobKey?: string;
  cloneSampleName?: string;
  cloneSampleMimeType?: string;
  sampleCandidates?: VoiceSampleCandidate[];
  status?: 'ready' | 'needs-sample' | 'fallback' | 'stale';
  updatedAt: number;
}

export interface SubtitleCue {
  id: string;
  clipId: string;
  lineId?: string;
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
  source?: string;
}

export interface AudioCue {
  id: string;
  clipId?: string;
  type: 'tts' | 'sfx' | 'bgm' | 'original';
  assetId?: string;
  blobKey?: string;
  label: string;
  startSec: number;
  endSec?: number;
  volume: number;
  status: 'missing' | 'ready' | 'generating' | 'stale' | 'error';
  error?: string;
}

export interface PostClip {
  id: string;
  storyboardIndex: number;
  name: string;
  order: number;
  enabled: boolean;
  durationSec: number;
  videoBlobKey?: string;
  videoUrl?: string;
  keepOriginalAudio: boolean;
  volume: number;
  sourceStartSec?: number;
  sourceEndSec?: number;
  subtitleText: string;
  sfxStatus: 'none' | 'missing' | 'partial' | 'ready' | 'generating' | 'error';
  bgmStatus: 'missing' | 'ready' | 'style-only';
  notes?: string;
}

export type PostTimelineTrackType = 'video' | 'original-audio' | 'tts' | 'sfx' | 'bgm' | 'subtitle';

export type PostTimelineItemType = 'clip' | 'original-audio' | 'tts' | 'sfx' | 'bgm' | 'subtitle';

export interface PostTimelineTrack {
  id: string;
  type: PostTimelineTrackType;
  name: string;
  muted?: boolean;
  locked?: boolean;
}

export interface PostTimelineItem {
  id: string;
  trackId: string;
  type: PostTimelineItemType;
  label: string;
  startSec: number;
  durationSec: number;
  enabled: boolean;
  clipId?: string;
  audioCueId?: string;
  subtitleCueId?: string;
  sourceStartSec?: number;
  sourceEndSec?: number;
  volume?: number;
  text?: string;
  status?: 'missing' | 'ready' | 'generating' | 'stale' | 'error';
}

export interface PostTimelineState {
  version: 2;
  tracks: PostTimelineTrack[];
  items: PostTimelineItem[];
  scalePxPerSec: number;
  playheadSec: number;
  selectedItemId?: string;
}

export interface RenderJobState {
  id?: string;
  status: 'idle' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress: number;
  message?: string;
  error?: string;
  downloadUrl?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface Cc0AudioAsset {
  id: string;
  name: string;
  blobKey: string;
  mimeType: string;
  type: 'sfx' | 'bgm';
  sourceName: string;
  sourceUrl?: string;
  license: 'CC0' | 'Public Domain';
  author?: string;
  importedAt: number;
}

export interface PostProductionState {
  version: number;
  generatedAt: number;
  clips: PostClip[];
  voiceProfiles: Record<string, VoiceProfile>;
  subtitles: SubtitleCue[];
  audioCues: AudioCue[];
  timeline?: PostTimelineState;
  cc0Assets?: Cc0AudioAsset[];
  renderJob?: RenderJobState;
}

/** Step4 生成模式：传统文字提示词，或 Seedance 详细故事板导演模式 */
export type Step4OutputMode = 'prompt' | 'storyboard-director';

/** Seedance 故事板流程：精修模式会追加动作导演，快速模式跳过动作导演，精简模式只跑单轮规划 */
export type StoryboardDirectorRunMode = 'refine' | 'fast' | 'compact';

/** 导演板输出样式 */
export type StoryboardBoardStyle = 'seedance-board' | 'stick-figure' | 'cinematic';

/** Step4 生成的故事板图状态 */
export type StoryboardBoardMode =
  | 'nine-portrait'
  | 'nine-landscape'
  | 'shot-plan-landscape'
  | 'smart-shot-plan-landscape';

export type SmartStoryboardPanelCountPreference = 'auto' | 6 | 9 | 12;
export type StoryboardCameraSegmentPreference = 'auto' | 1 | 2 | 3 | 4 | 5;

export interface StoryboardBoardPlanCharacterLock {
  refId?: string;
  name: string;
  role: 'primary' | 'secondary' | 'background';
  mustKeep: string[];
}

export interface StoryboardBoardPlanPanel {
  index: number;
  timeRange?: string;
  beat: string;
  shotType: string;
  cameraAngle: string;
  primarySubject: string;
  secondarySubjects: string[];
  composition: string;
  staticMoment: string;
  blocking?: string;
  motion?: string;
  cameraTask?: string;
  mustShow: string[];
  background: string;
  continuity: string;
  worldAnchor?: string;
  dialogue?: string;
  sfx?: string;
  audio?: string;
  transition?: string;
  dialoguePerformance?: string;
  continuityIn?: string;
  continuityOut?: string;
  directorNote?: string;
}

export interface StoryboardBoardWorldLock {
  sceneName?: string;
  masterScene?: string;
  anchors: string[];
  actionZone?: string;
  continuityNotes?: string;
}

export interface StoryboardBoardBlockingContinuity {
  previousEnd?: string;
  currentStart: string;
  currentEnd: string;
  cameraChanged?: boolean;
  cameraChangeReason?: string;
  movementAxis?: string;
  startBlocking?: SpatialBlockingSnapshot;
  endBlocking?: SpatialBlockingSnapshot;
}

export interface StoryboardBoardCameraPlan {
  cameraId?: string;
  cameraAxis?: string;
  cameraRelation?: string;
  lensPlan?: string;
  lightPlan?: string;
}

export interface StoryboardBoardTransitionBridge {
  previousEndBeat?: string;
  transitionType?: string;
  transitionRationale?: string;
  visualBridge?: string;
  soundBridge?: string;
  cameraBridge?: string;
  firstFrameInstruction?: string;
}

export interface StoryboardBoardDirectorContract {
  spatialContract?: string;
  characterZones: string[];
  mechanismState?: string;
  uiContinuity?: string;
  beatProgression?: string;
  startFrameContract?: string;
  endBeatContract?: string;
  rejectionRules: string[];
}

export interface StoryboardBoardDirectorBriefReferenceMatch {
  refId?: string;
  name: string;
  type: string;
  readFor: string;
  doNotUseFor?: string;
}

export interface StoryboardBoardReferenceBudgetItem {
  refId: string;
  name?: string;
  type?: string;
  decision: 'mustKeep' | 'preferKeep' | 'textFallback';
  reason: string;
}

export interface StoryboardBoardDirectorBrief {
  styleStatement?: string;
  referenceMatching: StoryboardBoardDirectorBriefReferenceMatch[];
  referenceBudget?: StoryboardBoardReferenceBudgetItem[];
  referencePriority?: string[];
  cameraStrategy?: string;
  soundStrategy?: string;
  hookStrategy?: string;
  storyboardStrategy?: string;
  sceneType?: string;
  paceLevel?: string;
  beatDensity?: string;
  dialogueDensity?: string;
  actionComplexity?: string;
  continuityRisk?: string;
  recommendedPanelCount?: 6 | 9 | 12 | 15;
  recommendedDurationSeconds?: number;
  panelCountReason?: string;
}

export interface StoryboardBoardPlan {
  mode: StoryboardBoardMode;
  directorBrief?: StoryboardBoardDirectorBrief;
  boardGoal: string;
  sceneAnchor: string;
  styleAnchor: string;
  transitionBridge?: StoryboardBoardTransitionBridge;
  directorContract?: StoryboardBoardDirectorContract;
  worldLock: StoryboardBoardWorldLock;
  blockingContinuity: StoryboardBoardBlockingContinuity;
  cameraPlan: StoryboardBoardCameraPlan;
  consistencyRules: string[];
  characterLocks: StoryboardBoardPlanCharacterLock[];
  propLocks: string[];
  referencePriority: string[];
  layoutRules: string[];
  negativeRules: string[];
  panels: StoryboardBoardPlanPanel[];
}

export type StoryboardBoardReferencePackItemType =
  | 'character-lock'
  | 'scene-blocking'
  | 'camera-light'
  | 'keyframes';

export interface StoryboardBoardReferencePackItem {
  type: StoryboardBoardReferencePackItemType;
  blobKey: string;
  name: string;
  generatedAt: number;
  sourceBlobKey?: string;
  sourceSceneName?: string;
  points?: ScenePositionBoardPoint[];
}

export interface StoryboardBoardGenerationTiming {
  planStartedAt?: number;
  planCompletedAt?: number;
  planElapsedMs?: number;
  imageStartedAt?: number;
  imageCompletedAt?: number;
  imageElapsedMs?: number;
  seedancePromptStartedAt?: number;
  seedancePromptCompletedAt?: number;
  seedancePromptElapsedMs?: number;
  failedAt?: number;
  failureReason?: string;
  timeoutAt?: number;
  retryCount?: number;
  lastAttemptStartedAt?: number;
}

export interface StoryboardBoardVariantState {
  status: 'idle' | 'generating' | 'done' | 'failed';
  boardStyle?: StoryboardBoardStyle;
  generatedForOutputMode?: Step4OutputMode;
  frameRatio?: '9:16' | '16:9';
  visualBoardBlobKey?: string;
  blobKey?: string;
  lightweightBlobKey?: string;
  lightweightMimeType?: 'image/webp';
  lightweightQuality?: number;
  lightweightOriginalBytes?: number;
  lightweightBytes?: number;
  lightweightWidth?: number;
  lightweightHeight?: number;
  lightweightCreatedAt?: number;
  referencePack?: StoryboardBoardReferencePackItem[];
  startedAt?: number;
  generatedAt?: number;
  error?: string;
  isStale?: boolean;
  staleReason?: 'scene-asset' | 'reference-binding' | 'source-change';
  promptSnapshot?: string;
  referenceAssetIds?: string[];
  directorBriefStatus?: 'idle' | 'done' | 'failed';
  directorBrief?: StoryboardBoardDirectorBrief;
  directorBriefError?: string;
  directorBriefGeneratedAt?: number;
  directorBriefPromptSnapshot?: string;
  directorBriefReferenceAssetIds?: string[];
  planStatus?: 'idle' | 'optimizing' | 'done' | 'failed';
  plan?: StoryboardBoardPlan;
  planError?: string;
  planGeneratedAt?: number;
  planIsStale?: boolean;
  planStaleReason?: 'scene-asset' | 'reference-binding' | 'source-change';
  planPromptSnapshot?: string;
  planReferenceAssetIds?: string[];
  layout?: '3x3' | 'strip';
  imageSize?: ImageSize;
  generationTiming?: StoryboardBoardGenerationTiming;
}

export interface StoryboardBoardState {
  selectedMode?: StoryboardBoardMode;
  variants?: Partial<Record<StoryboardBoardMode, StoryboardBoardVariantState>>;
}

/** 视频生成后端类型 */
export type VideoBackendType = 'seedance' | 'seedancecloud' | 'xyqagent' | 'hmapi' | 'volcengine' | 'aliyunbailian';

/** 视频生产模式：普通图生视频，或基于上一段视频延长 */
export type VideoProductionMode = 'normal' | 'extend';

/** 视频生成 API 配置 */
export interface VideoApiConfig {
  backend: VideoBackendType;       // 后端类型：seedance（本地小云雀）/ seedancecloud（虾客漫SD2）/ xyqagent（小云雀 Agent）/ hmapi（HM 官方）/ volcengine（火山方舟官方）/ aliyunbailian（百炼 HappyHorse）
  // 通用视频参数
  videoDuration: number;           // 视频时长（秒），作为分镜未写时长时的兜底；Seedance 2.5 可到 30 秒，其他当前模型到 15 秒
  videoRatio: string;              // 宽高比，如 '9:16'、'16:9'、'1:1'
  videoResolution: '480p' | '720p' | '1080p' | '4k';  // 分辨率，默认 720p
  // Seedance（本地小云雀）配置
  seedanceTimeout: number;         // 单任务超时时间（秒），默认 7200（120 分钟），范围 60~7200
  seedanceBatchDelay: number;      // 批量生成提交延时（秒），默认 100，范围 0~300
  seedanceModel: string;           // Seedance 模型：'fast'（默认）或 '2.0'
  seedanceCloudBaseUrl: string;     // 虾客漫SD2接口地址，默认 https://sd2.xiakeman.com 并自动补 /api
  seedanceCloudLicenseKey: string;  // 虾客漫SD2卡密；服务端用它派生用户隔离 ID
  /** @deprecated 旧云端原型字段；现在只作为卡密迁移兜底，不再作为用户 ID 发送 */
  seedanceCloudUserId?: string;
  // 小云雀 Agent（Access Key）配置
  xyqAgentAccessKey: string;        // 小云雀 Agent Access Key
  xyqAgentBaseUrl: string;          // 默认 https://xyq.jianying.com
  xyqAgentTimeout: number;          // 会话任务轮询超时时间（秒）
  /** 同场景连续镜头优先使用视频延长/参考视频；火山方舟走官方 reference_video，小云雀走本地延长模拟 */
  useVideoExtension?: boolean;
  /** @deprecated 旧项目兼容字段；请使用 useVideoExtension */
  seedanceUseVideoExtension?: boolean;
  /** 火山方舟官方 reference_audio 公共 URL；2.0 最多 3 个，2.5 最多 10 个 */
  volcReferenceAudioUrls?: string[];
  /** 角色配音参考总开关；关闭后 Step4 不改提示词，Step5 不提交角色音频参考 */
  characterVoiceReferencesEnabled?: boolean;
  /** Step5 使用后端后台任务提交/轮询视频；可在 COS + 后端 Worker 未就绪时关闭回退浏览器直连 */
  useBackendVideoJobs?: boolean;
  // 火山方舟官方 API 配置
  hmapiApiKey: string;
  hmapiModel: string;
  volcBaseUrl: string;             // 火山方舟 API 地址，默认 https://ark.cn-beijing.volces.com/api/v3
  volcApiKey: string;              // 火山方舟 API Key
  volcModel: string;               // 火山方舟 Model ID；Seedance 2.5 为 doubao-seedance-2-5-260628
  volcGenerateAudio: boolean;      // 是否生成音频，默认 false
  aliyunApiKey: string;            // 阿里云百炼 DashScope API Key
  aliyunModel: string;             // 默认 happyhorse-1.0-r2v
  aliyunRegion: string;            // 默认 cn-beijing
  aliyunWatermark: boolean;        // 是否添加 HappyHorse 水印，默认 false
  aliyunSeed: string;              // 可选随机种子，0~2147483647
  // 批量生成配置
  batchConcurrency: number;        // 批量生成并发数，默认 3
}

// ---------- 项目级风格配置 ----------
export const STYLE_PRESETS = [
  '超写实仿真人电影级质感',
  '3D国漫玄机风格CG级渲染质感',
  '3D动漫游戏级角色设定，PBR材质，服装结构可读，真实cosplay服装逻辑，电影级布光',
  '2D日漫二次元动画风格',
  '写实仿真人古装偶像剧S+级大制作质感',
  '写实仿真人仙侠玄幻电影质感',
  '写实仿真人3D国漫仙侠玄幻质感',
  '写实仿真人废土玄幻融合电影质感',
  '写实仿真人现代都市剧电影质感',
  '写实仿真人现代霸总偶像剧电影质感',
  '写实仿真人青春校园剧清透电影质感',
  '写实仿真人悬疑犯罪冷峻电影质感',
  '写实仿真人民国复古传奇电影质感',
  '写实仿真人现代医疗职场剧电影质感',
  '3D动漫赛博朋克科幻CG电影质感',
  '3D国漫仙侠玄幻CG电影质感',
  '2D国风水墨动画电影质感',
  '写实仿真人港风警匪电影质感',
  '写实仿真人年代乡土现实剧电影质感',
] as const;

export type StylePreset = (typeof STYLE_PRESETS)[number];

// ---------- Step1：剧本分析结果 ----------
export interface SceneInfo {
  name: string;
  timeOfDay?: string;
  environment: string;
  colorTone: string;
  characters: string[];
  spaceScale?: string;
  layout?: string;
  keySetPieces?: string;
  lighting?: string;
  weather?: string;
  atmosphere?: string;
  step3Description?: string;
  inferredFields?: string[];
}

export interface StoryboardInfo {
  number: number;
  name: string;
  duration: string;
  shotSize: string;
  scene?: string;
  characters: string[];
  content?: string;
  dialogue?: string;
  notes?: string;
}

export interface CharacterOutfit {
  characterName: string;
  outfitSeq: number;
  outfitDesc: string;
  storyboardRange: string;
  needsNewImage: boolean;
}

export interface CharacterProfile {
  name: string;
  description: string;
  ageAppearance?: string;
  temperament?: string;
  bodyBuild?: string;
  faceFeatures?: string;
  hairStyle?: string;
  skinTone?: string;
  defaultOutfit?: string;
  accessories?: string;
  visualAnchor?: string;
  step3Description?: string;
  inferredFields?: string[];
}

export interface PropConsistency {
  trackingId?: string;
  propName: string;
  appearanceDesc: string;
  size?: string;
  material?: string;
  shapeStructure?: string;
  color?: string;
  texture?: string;
  condition?: string;
  visualAnchor?: string;
  step3Description?: string;
  inferredFields?: string[];
  holder: string;
  storyboardRange: string;
  stateChanges: string;
  needsTracking: boolean;
  needsImage: boolean;
}

export interface ScriptAnalysis {
  projectName: string;
  styleConfig: string;
  scenes: SceneInfo[];
  storyboards: StoryboardInfo[];
  allCharacterNames: string[];
  characterProfiles: CharacterProfile[];
  sceneRelations: string;
  outfitTracking: CharacterOutfit[];
  propTracking: PropConsistency[];
  propInheritance: string;
  summary: string;
}

// ---------- 图片资产 ----------

/** 角色图片概念类型（一个角色需要多张不同用途的图片） */
export type CharacterImageConcept =
  | 'portrait_closeup'           // 竖屏标准正面定妆照 (9:16)
  | 'landscape_turnaround'      // 横屏角色设定图/设定板 (16:9)
  | 'portrait_outfit'           // 竖屏变装定妆图 (9:16)
  | 'landscape_outfit_turnaround'; // 横屏变装设定图/设定板 (16:9)

/** 场景图片概念类型 */
export type SceneImageConcept =
  | 'scene_main'       // 横屏场景导演板 (16:9)
  | 'scene_vertical';  // 竖屏场景导演板 (9:16)，与横屏同级独立生成

/** 物品/道具图片概念类型 */
export type PropImageConcept = 'prop_main';

/** 所有图片概念类型 */
export type ImageConcept = CharacterImageConcept | SceneImageConcept | PropImageConcept;

/** 图片概念元数据 */
export const CHARACTER_IMAGE_CONCEPTS: { concept: CharacterImageConcept; label: string; aspectRatio: 'PORTRAIT' | 'LANDSCAPE'; desc: string; order: number }[] = [
  { concept: 'portrait_closeup', label: '标准正面定妆照', aspectRatio: 'PORTRAIT', desc: '竖屏角色标准正面定妆特写（头肩像），作为后续图生图的基础源图', order: 1 },
  { concept: 'landscape_turnaround', label: '角色设定图', aspectRatio: 'LANDSCAPE', desc: '横屏工业角色参考表：左侧1/3 FACE HERO 超大脸部特写 + 中央 FRONT/BACK 正背全身 + 右上 FACE LOCK GRID ×4 + 右下服装/材质细节与专属物品小窗', order: 2 },
  { concept: 'portrait_outfit', label: '变装定妆照', aspectRatio: 'PORTRAIT', desc: '竖屏变装角色定妆照', order: 3 },
  { concept: 'landscape_outfit_turnaround', label: '变装设定图', aspectRatio: 'LANDSCAPE', desc: '横屏变装工业角色参考表：左侧1/3 FACE HERO 超大脸部特写 + 中央 FRONT/BACK 正背全身 + 右上 FACE LOCK GRID ×4 + 右下服装/材质细节与专属物品小窗', order: 4 },
];

export const SCENE_IMAGE_CONCEPTS: { concept: SceneImageConcept; label: string; aspectRatio: 'PORTRAIT' | 'LANDSCAPE'; desc: string; order: number }[] = [
  {
    concept: 'scene_main',
    label: '横屏场景导演板',
    aspectRatio: 'LANDSCAPE',
    desc: '横屏16:9 ENVIRONMENT / SET DESIGN 场景导演板：横屏主环境图 + 高对比 FLOOR PLAN / TOP-DOWN BLOCKING MAP + 放大机位/图例 + 锚点对应',
    order: 1,
  },
  {
    concept: 'scene_vertical',
    label: '竖屏场景导演板',
    aspectRatio: 'PORTRAIT',
    desc: '竖屏9:16 ENVIRONMENT / SET DESIGN 场景导演板：竖屏主环境图 + 高对比 FLOOR PLAN / TOP-DOWN BLOCKING MAP + 放大机位/图例 + 锚点对应，独立供竖屏视频调用',
    order: 2,
  },
];

export const SCENE_IMAGE_CONCEPT: { concept: SceneImageConcept; label: string; aspectRatio: 'PORTRAIT' | 'LANDSCAPE'; desc: string; order: number } = SCENE_IMAGE_CONCEPTS[0];

export const PROP_IMAGE_CONCEPT: { concept: PropImageConcept; label: string; aspectRatio: 'PORTRAIT' | 'LANDSCAPE'; desc: string; order: number } = {
  concept: 'prop_main',
  label: '道具工业板',
  aspectRatio: 'LANDSCAPE',
  desc: '横屏16:9 PROP REFERENCE SHEET：主视图 + 多角度结构 + 尺寸/手部比例 + 材质细节 + 状态版本 + 使用方式小窗',
  order: 1,
};

export type AssetSource = 'local' | 'volc_virtual_human' | 'volc_seedream_output';

export interface Asset {
  id: string;                       // UUID
  name: string;                      // "李天骄" / "仙侠大殿" / "紫霄剑"
  type: 'scene' | 'character' | 'prop';
  concept: ImageConcept;             // 图片概念类型
  description: string;               // 原始描述（来自 Step2）
  /** 资产来源。local 为本地生成/上传；volc_virtual_human 为火山官方虚拟人像 asset:// 资源；volc_seedream_output 为火山 Seedream 原始产物 */
  source?: AssetSource;
  /** 外部官方资产 ID，例如 asset-xxxx */
  externalAssetId?: string;
  /** 外部官方资产 URI，例如 asset://asset-xxxx */
  externalAssetUri?: string;
  /** 火山 Seedream 原始产物 URL，用于传给 Seedance 作为同账号可信输入素材 */
  externalImageUrl?: string;
  /** externalImageUrl 下载有效期，过期后需重新生成或转存 */
  externalImageExpiresAt?: number;
  /** 外部产物来源模型，例如 doubao-seedream-5.0-lite */
  externalSourceModel?: string;
  /** 外部资产预览图，仅用于展示，不作为视频生成输入上传 */
  thumbnailUrl?: string;
  /** 官方目录标签，用于筛选和展示 */
  catalogTags?: string[];
  /** 稳定身份键（道具等需要避免同名串联时使用） */
  identityKey?: string;
  /** 角色变装变量键（如 outfit-2），仅变装资产有效 */
  variantKey?: string;
  /** Step2 变装序号，供 Step3 描述/手动分组使用 */
  outfitSeq?: number;
  optimizedPrompt: string;            // LLM 优化后的图片 prompt
  generationMode: 'txt2img' | 'img2img' | 'upload';
  sourceAssetId?: string;            // img2img 时参考的源图片 assetId
  baseAssetId?: string;              // 图生图基础源图 assetId（如变装图、角色设定图的源图）
  blobKey: string;                   // IndexedDB Blob key
  aspectRatio: 'PORTRAIT' | 'LANDSCAPE';
  /** 图片分辨率 1K/2K/4K，null 表示使用 API 默认值 */
  imageSize?: ImageSize;
  /** 同尺寸轻量参考图，用于 Step4/Step5 上传；原 blobKey 仍保留为母版 */
  lightweightBlobKey?: string;
  lightweightMimeType?: 'image/webp';
  lightweightQuality?: number;
  lightweightOriginalBytes?: number;
  lightweightBytes?: number;
  lightweightWidth?: number;
  lightweightHeight?: number;
  lightweightCreatedAt?: number;
  /** 是否为该角色的默认图片（后续步骤可优先调用），仅角色类型有效 */
  isDefault?: boolean;
  usedInStoryboards: string[];       // [chapterId-sbIndex, ...]
  createdAt: number;
  updatedAt: number;
}

// ---------- Step4：分镜提示词相关 ----------
/** 逻辑修正记录 */
export interface LogicFix {
  originalIssue: string;  // 原剧本矛盾点
  correction: string;     // 修正内容
  reason: string;         // 原因
}

/** 场景蓝图（check 步骤输出，用于判断场景类型和编排方向） */
export interface SceneBlueprint {
  sceneType: 'combat' | 'dialogue' | 'emotional' | 'transition';
  combatSubType?: 'active' | 'suppressed' | 'ambush';
  combatType?: 'melee' | 'weapon' | 'magic' | 'mixed';
  intensity?: 'low' | 'medium' | 'high' | 'extreme';
  emotionArc?: string;
  keyMoments?: { timeRange: string; moment: string }[];
  cameraStyle?: 'static' | 'dynamic' | 'handheld' | 'crane';
  suggestedCuts?: number;
  needsSlowMotion?: boolean;
  slowMotionMoments?: string[];
  soundDesign?: string;
  bgmMood?: string;
  dialoguePerformance?: string;
}

export interface CharacterBlockingState {
  character: string;
  position: string;
  /** 0-1 normalized coordinates on the portrait scene-position board. */
  positionPoint?: { x: number; y: number };
  facing?: string;
  posture?: string;
  heldProps?: string[];
  notes?: string;
}

export interface PropBlockingState {
  prop: string;
  holder?: string;
  position?: string;
  state?: string;
}

export interface SpatialBlockingSnapshot {
  sceneName?: string;
  sceneAnchor?: string;
  cameraAxis?: string;
  characters: CharacterBlockingState[];
  props?: PropBlockingState[];
  continuityNotes?: string;
}

export interface SpatialContinuityIssue {
  character: string;
  type: 'missing-character' | 'position-jump' | 'facing-jump';
  message: string;
}

export interface ScenePositionBoardPoint {
  character: string;
  colorName: string;
  colorHex: string;
  /** 0-1 normalized foot/ground anchor on the portrait scene-position board. */
  x: number;
  y: number;
  sourcePosition?: string;
  shortDramaLayout?: {
    /** Where the face should land in the final vertical video, derived from the foot anchor. */
    faceZone: string;
    /** How large/visible the character should remain for short-drama readability. */
    framing: string;
    /** Extra guardrails when the foot anchor is near an edge, foreground, or background. */
    visibility: string;
    riskFlags?: string[];
  };
}

export interface ScenePositionBoardState {
  status: 'idle' | 'generating' | 'done' | 'failed';
  schemaVersion?: number;
  frameRatio?: '9:16' | '16:9';
  cleanBlobKey?: string;
  markedBlobKey?: string;
  sourceSceneAssetId?: string;
  sceneMasterKey?: string;
  sceneMasterView?: SceneSpatialMasterView;
  sceneMasterReused?: boolean;
  promptSnapshot?: string;
  referenceAssetIds?: string[];
  points: ScenePositionBoardPoint[];
  generatedAt?: number;
  error?: string;
  warning?: string;
  isStale?: boolean;
  usedFallbackCrop?: boolean;
}

export type SceneSpatialMasterView = 'primary' | 'reverse' | 'side';

export interface SceneSpatialMasterState {
  status: 'idle' | 'generating' | 'done' | 'failed';
  schemaVersion?: number;
  frameRatio?: '9:16' | '16:9';
  sceneName: string;
  view?: SceneSpatialMasterView;
  cleanBlobKey?: string;
  sourceSceneAssetId?: string;
  promptSnapshot?: string;
  referenceAssetIds?: string[];
  generatedAt?: number;
  error?: string;
  warning?: string;
  isStale?: boolean;
  usedFallbackCrop?: boolean;
}

/** 动作编排方案中的单个角色动作 */
export interface ChoreographyAction {
  character: string;     // 角色名（含图片引用）
  position: string;      // 画面位置
  action: string;        // 具体动作描述
  dialogue?: string;     // 台词（如有）
  emotion?: string;      // 情绪
  microAction?: string;  // 微动作 / 表情细节
  facing?: string;       // 朝向（面朝镜头/背对镜头/左侧脸等）
  posture?: string;      // 姿态（站立/跪地/半蹲/被压制等）
  heldProps?: string[];  // 当前持有道具
}

/** 动作编排方案中的单个时间段 */
export interface ChoreographyTimeSegment {
  timeRange: string;
  segmentType: string;              // 蓄势 / 初交锋 / 高潮 / 收束 等
  rhythm?: string;                  // 节奏标签：极慢 / 慢 / 中 / 加速 / 快 / 极快 等
  actionFlow?: string;              // 连贯动作流描述（将本段所有角色动作合并为一条连续动作链）
  actions: ChoreographyAction[];
  camera: string;                   // 运镜描述，含量化参数
  vfx: string;                      // 特效标注
  impact?: string;                  // 环境联动反馈（飞沙走石、冲击波、碎屑飞溅等，有力击打时必填）
  sound: string;                    // 音效
  bgm?: string;                     // BGM 情绪曲线
  dialoguePerformance?: string;     // 对白/内心OS表演：语气、音量、语速、呼吸停顿、口型/闭唇状态
}

/** 动作编排方案（choreograph 步骤输出） */
export interface Choreography {
  sceneType: 'combat' | 'dialogue' | 'emotional' | 'transition';
  combatType?: string;
  overallRhythm: string;
  cameraOverview: string;
  lightNotes: string;
  colorGrading: string;
  timeSegments: ChoreographyTimeSegment[];
  sceneAnchor?: string;
  cameraAxis?: string;
  startBlocking?: SpatialBlockingSnapshot;
  endBlocking?: SpatialBlockingSnapshot;
  transitionType?: string;          // 仅 transition 类型
  emotionArc?: string;              // 仅 emotional 类型
}

/** 编排方案逻辑检查修正记录（choreo-check 步骤输出） */
export interface ChoreoCheckFix {
  issueType: string;     // 角色瞬移 / 道具分身 / 时长矛盾 / 状态遗漏 / 位置重叠 / 道具归属矛盾 / 特效断裂 / 跨分镜衔接矛盾
  description: string;
  fixSuggestion: string;
  isCritical?: boolean;  // 严重问题标记（道具分身、时长矛盾、位置重叠无法修正时为 true，建议降级）
}

export type Step4GenerateMode = 'full' | 'formatter';

/** 单个时间段 */
export interface TimeSegment {
  timeRange: string;       // 如 "0-3秒"
  cameraShot: string;      // 景别 + 运镜 + 特效标注
  actionDesc: string;      // 空间位置 + 动作 + 台词
  soundEffect: string;     // 音效描述
  /** AI 生成的音效音频 Blob key（IndexedDB） */
  soundEffectBlobKey?: string;
}

/** 完整的分镜视频提示词 */
export interface StoryboardPrompt {
  header: string;                    // 画幅 + 画质 + 风格 + 字幕禁令
  scene: string;                     // 场景段（含参考图片句式）
  characters: string;                // 人物段（含参考图片句式）
  cameraOverview: string;            // 景别 + 运镜概述
  timeSegments: TimeSegment[];       // 时间段列表
  colorLighting: string;             // 调色 + 光影
  noSubtitle: string;                // 禁止显示字幕
  rawText: string;                   // 完整原始文本（** 分隔）
}

export interface StoryboardContinuitySnapshot {
  itemTracker: Record<string, string>;
  lastFrameInfo: string;
  spatialBlocking?: SpatialBlockingSnapshot;
  summary?: string;
  sourceStoryboardIndex?: number;
  generatedAt?: number;
}

export type VideoImageBudgetOmissionReason =
  | 'prop-text-safe'
  | 'prop-overflow'
  | 'background-character-overflow'
  | 'scene-overflow'
  | 'asset-overflow';

export interface VideoImageBudgetOmission {
  ref: ImageReference;
  reason: VideoImageBudgetOmissionReason;
  message: string;
}

export interface VideoImageBudgetState {
  limit: number;
  originalCount: number;
  selectedCount: number;
  compressed: boolean;
  omittedRefs: VideoImageBudgetOmission[];
  notes: string[];
  warnings: string[];
}

export interface StoryboardReferenceVideoConfig {
  urls: string[];
  note?: string;
}

export interface EpisodeShotSheetSegment {
  storyboardIndex: number;
  storyFunction: string;
  continuityIn: string;
  continuityOut: string;
  characterState: string;
}

export interface EpisodeShotSheetState {
  updatedAt: number;
  segments: EpisodeShotSheetSegment[];
}

export interface StoryboardSequenceContinuityContext {
  sourceSignature: string;
  hasPrevious: boolean;
  previousStoryboardNumber?: number;
  previousStoryboardName?: string;
  previousLastFrameInfo?: string;
  previousFinalPanel?: {
    index?: number;
    beat?: string;
    staticMoment?: string;
    blocking?: string;
    motion?: string;
    continuityOut?: string;
    dialogue?: string;
    sfx?: string;
    audio?: string;
  };
  currentContinuityIn?: string;
  currentContinuityOut?: string;
  nextContinuityIn?: string;
  visualLocks: string[];
  hardRules: string[];
  warnings: string[];
}

/** 分镜处理状态 */
export interface StoryboardState {
  storyboard: StoryboardInfo;
  step4OutputMode?: Step4OutputMode; // 当前镜头希望使用的 Step4 生成模式；未设置时继承章节默认
  generatedStep4OutputMode?: Step4OutputMode; // 当前已生成结果实际采用的 Step4 模式
  storyboardBoardStyle?: StoryboardBoardStyle; // 导演模式默认 seedance-board，写实预览可用 cinematic
  useStoryboardBoardReference?: boolean; // Step5：是否将 Step4 九宫格故事板作为额外参考图
  useCompactVideoPrompt?: boolean; // Step5：是否启用 LLM 生成的补救版视频提示词
  compactVideoPrompt?: string; // Step5：LLM 生成的补救版提交提示词（兼容旧精简字段名）
  compactVideoPromptMode?: 'compact' | 'desensitized'; // Step5：旧精简版或文字审核脱敏版
  compactVideoPromptStatus?: 'idle' | 'optimizing' | 'done' | 'failed';
  compactVideoPromptError?: string;
  compactVideoPromptSourcePrompt?: string; // 生成补救提示词时所基于的最终源 prompt
  compactVideoPromptUpdatedAt?: number;
  videoSubmitPromptOverride?: string; // Step5：人工编辑后的实际提交提示词
  videoSubmitPromptOverrideSourcePrompt?: string; // Step5：人工编辑时对应的自动提交词快照
  videoSubmitPromptOverrideUpdatedAt?: number;
  seedanceFinalVideoPrompt?: string; // Step4：LLM 生成的 Seedance 最终提交词
  seedanceFinalVideoPromptStatus?: 'idle' | 'generating' | 'done' | 'failed';
  seedanceFinalVideoPromptError?: string;
  seedanceFinalVideoPromptSourceSnapshot?: string; // Seedance 最终提交词生成时所基于的源快照
  seedanceFinalVideoPromptUpdatedAt?: number;
  seedanceFinalVideoPromptRunId?: string; // Step4：当前 Seedance 最终提交词异步任务票据，防止旧任务回写
  smartVideoDurationSeconds?: number; // Step4 智能故事板：LLM 根据剧情节奏建议的实际视频提交时长（秒）
  smartVideoDurationReason?: string; // Step4 智能故事板：时长调整原因
  smartVideoDurationUpdatedAt?: number;
  sourceExcerpt?: string;
  sourceExcerptSummary?: string;
  nextStoryboardSummary?: string;
  logicFixes: LogicFix[];           // 逻辑修正记录
  correctedScript: string;          // 修正后剧本片段（来自 Step4.2 修正）
  sceneBlueprint: SceneBlueprint | null; // 场景蓝图（来自步骤 4.1 check）
  choreography: Choreography | null;    // 动作编排方案（来自步骤 4.3 choreograph）
  choreoCheckFixes?: ChoreoCheckFix[];  // 编排方案逻辑检查修正记录（来自步骤 4.3.5 choreo-check）
  imageRefs: ImageReference[];       // 图片引用分配
  videoImageRefs?: ImageReference[];  // Step5：仅本次视频提交使用的参考图覆盖，不影响 Step4 回退/刷新判断
  videoImageBudget?: VideoImageBudgetState; // Step4：按所选视频模型计算的参考图预算结果
  referenceVideo?: StoryboardReferenceVideoConfig; // Step5：火山方舟公网 reference_video URL（单分镜）
  prompt: StoryboardPrompt | null;   // 生成的提示词
  selfCheckResult: SelfCheckResult | null; // 自检结果
  lastFrameInfo: string;             // 落幅画面信息（传给下一个镜）
  spatialBlocking?: SpatialBlockingSnapshot; // Step4：当前分镜落幅站位快照
  continuityInput?: StoryboardContinuitySnapshot;
  continuityOutput?: StoryboardContinuitySnapshot;
  isStale?: boolean;
  step4StartedAt?: number;          // Step4 当前生成流程开始时间，用于避免长图任务被误判为中断
  status: 'pending' | 'checking' | 'correcting' | 'choreographing' | 'choreo-checking' | 'generating' | 'self-checking' | 'done' | 'error';
  error?: string;
  // 视频生成状态
  videoBackend?: VideoBackendType;
  videoProductionMode?: VideoProductionMode;
  videoContinuityGroupId?: string;
  videoContinuityReason?: string;
  videoExtendSourceIndex?: number;
  videoExtendSourceTaskId?: string;
  videoExtendSourceBlobKey?: string;
  videoExtendSubmittedAsExtend?: boolean;
  videoTaskId?: string;
  videoClientTaskId?: string;
  videoStatus?: 'idle' | 'submitting' | 'polling' | 'done' | 'failed';
  videoProgress?: number;            // 0-100
  videoProgressIsEstimated?: boolean; // 进度是否为估算值（火山方舟等无真实进度的后端）
  videoStatusDetail?: string;        // 后端原始状态的中文描述（如“排队中”“生成中”“后处理中”）
  videoUrl?: string;                // 完成后可播放的 URL（可能过期）
  videoBlobKey?: string;            // IndexedDB 中的 Blob key（持久缓存，不会过期）
  videoSubmittedAt?: number;         // 任务提交时间戳（用于计算 ETA）
  videoSubmitDuration?: number;       // 本次实际提交到视频后端的时长（秒）
  videoCompletedAt?: number;          // 任务完成时间戳（用于显示耗时）
  videoError?: string;
  videoErrorDetail?: {              // 错误详情（展开面板使用）
    backend: string;                // 后端类型
    taskId?: string;                // 任务 ID
    submittedAt?: number;           // 提交时间戳
    prompt?: string;                // 提交的提示词（截取前 200 字）
    rawError?: string;              // 后端原始错误消息
    // 火山引擎官方错误详情
    errorCode?: string;             // 火山错误码（如 InvalidParameter）
    errorMsg?: string;              // 火山官方错误消息
    httpStatus?: number;            // HTTP 状态码
    volcRequestId?: string;         // 火山请求 ID
    volcCode?: string;              // 火山业务错误码
    volcMessage?: string;           // 火山业务错误消息
    aliyunRequestId?: string;       // 阿里云百炼请求 ID
  };
  /** 分镜音频混音状态（TTS + 音效 + BGM） */
  audioMix?: StoryboardAudioMix;
  /** Step4 生成的九宫格故事板图 */
  storyboardBoard?: StoryboardBoardState;
  /** Step4 生成的场景定位图，用于 Step5 以 1 张场景图位锁定竖屏背景和人物站位 */
  scenePositionBoard?: ScenePositionBoardState;
}

/** 图片引用 */
export interface ImageReference {
  refId: string;       // 如 "(图片1)" 或 "【图片1】"（兼容旧数据）
  type: 'scene' | 'character' | 'prop';
  name: string;        // 场景名、角色名或物品名
  fileName: string;    // 文件名（legacy，保留兼容）
  trackingId?: string; // 道具等稳定身份键
  assetId?: string;    // 生成/选择图片后填充，指向 Asset.id
  variantKey?: string; // 角色变装变量键（如 outfit-2）
  outfitSeq?: number;  // Step2 变装序号，供默认匹配和恢复
  assetBindingMode?: 'auto' | 'manual'; // Step3 手动绑定后应优先保留
}

// ---------- 自检结果 ----------
export interface CheckItem {
  name: string;         // 检查项名称
  passed: boolean;      // 是否通过
  detail?: string;      // 详情
}

export interface SelfCheckResult {
  totalChecks: number;
  passedCount: number;
  failedCount: number;
  items: CheckItem[];
  overallPassed: boolean;
}

// ---------- 批量生成状态 ----------
export interface AutoGenerateState {
  running: boolean;
  currentIndex: number;       // 当前正在生成分镜的索引（0-based）
  total: number;              // 总分镜数
  doneCount: number;          // 已完成数
  errors: { index: number; error: string }[]; // 失败记录
  cancelled: boolean;
  retryNotice?: { index: number; attempt: number; maxRetries: number; error: string };
  sessionId?: string;
  startedAt?: number;
  stopReason?: 'completed' | 'cancelled' | 'failed';
}

export type GlobalTaskType = 'step1-analysis' | 'step3-batch' | 'step4-batch' | 'step5-batch';
export type GlobalTaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type Step1GlobalTaskMode = 'auto' | 'adapted-analysis';
export type Step3GlobalTaskMode = 'all-images' | 'section-images' | 'lightweight-assets' | 'retry-failed';
export type Step3GlobalTaskSection = 'character' | 'scene' | 'prop';
export type GlobalTaskEventLevel = 'info' | 'retry' | 'warning' | 'error' | 'success';

export interface GlobalTaskEvent {
  id: string;
  at: number;
  level: GlobalTaskEventLevel;
  label: string;
  detail?: string;
  storyboardIndex?: number;
  phase?: string;
}

export interface GlobalTask {
  id: string;
  type: GlobalTaskType;
  projectId: string;
  chapterId: string;
  step1Mode?: Step1GlobalTaskMode;
  step3Mode?: Step3GlobalTaskMode;
  step3Section?: Step3GlobalTaskSection;
  step3IncludeOutfitVariants?: boolean;
  storyboardDirectorRunMode?: StoryboardDirectorRunMode;
  step5Indices?: number[];
  step5Backend?: VideoBackendType;
  status: GlobalTaskStatus;
  currentIndex: number;
  total: number;
  doneCount: number;
  errors: { index: number; error: string }[];
  retryNotice?: AutoGenerateState['retryNotice'];
  streamStoryboardIndex?: number;
  streamPhase?: StoryboardState['status'] | null;
  streamStageLabel?: string | null;
  streamStageStartedAt?: number;
  streamStageLastActivityAt?: number;
  streamStageTimeoutMs?: number;
  streamStageTimeoutMode?: 'hard' | 'idle';
  streamTextPreview?: string;
  streamTextLength?: number;
  streamUpdatedAt?: number;
  streamPreviousStageLabel?: string | null;
  streamPreviousTextLength?: number;
  streamPreviousUpdatedAt?: number;
  eventLog?: GlobalTaskEvent[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  stopReason?: AutoGenerateState['stopReason'] | 'interrupted';
}

export interface GlobalTaskSettings {
  step4Concurrency: number;
  step4StoryboardImageConcurrency: number;
  step4SeedancePromptConcurrency: number;
  step4StoryboardImageSize: ImageSize;
  step4LlmExecutionMode: 'browser-direct' | 'background-job';
}

// ---------- 系列短剧策划 ----------
export interface SeriesCharacterProfile {
  id: string;
  name: string;
  role: 'heroine' | 'hero' | 'villain' | 'supporting';
  coreDesire: string;
  woundOrWeakness: string;
  actionStyle: string;
  voiceStyle: string;
  visualAnchor: string;
  recurringProps: string[];
  continuityNotes: string;
}

export type SeriesProductionAssetCategory =
  | 'unit_antagonist'
  | 'supernatural_event'
  | 'case_crisis'
  | 'enemy_force'
  | 'evidence_secret'
  | 'system_task'
  | 'relationship_event'
  | 'business_order'
  | 'comedy_misunderstanding'
  | 'key_scene'
  | 'special_prop'
  | 'rule_mechanism'
  | 'other';

export type SeriesProductionAssetStatus = 'planned' | 'used' | 'adHoc' | 'promoted';

export interface SeriesProductionAsset {
  id: string;
  name: string;
  category: SeriesProductionAssetCategory;
  genreUse: string;
  episodeRange: string;
  visualAnchor: string;
  storyFunction: string;
  conflictRule: string;
  assetNeed: string;
  reuseLevel: string;
  status: SeriesProductionAssetStatus;
}

export interface SeriesEpisodeAdHocAsset {
  id: string;
  name: string;
  category: SeriesProductionAssetCategory;
  reason: string;
  visualAnchor: string;
  assetNeed: string;
  needsReference: boolean;
  promoteSuggestion: boolean;
}

export type SeriesEpisodeType =
  | 'premise_hook'
  | 'rule_reveal'
  | 'unit_event'
  | 'relationship_contrast'
  | 'villain_probe'
  | 'major_payoff'
  | 'long_secret'
  | 'bridge_resolution';

export type EpisodeSatisfactionType =
  | 'humiliation_reversal'
  | 'identity_tease'
  | 'misunderstanding_deepens'
  | 'villain_backfires'
  | 'heroine_leaves_coldly'
  | 'male_lead_regret'
  | 'evidence_reveal'
  | 'power_flip'
  | 'feeding_preference'
  | 'soft_protection'
  | 'romantic_misread'
  | 'daily_pull'
  | 'business_growth';

export interface SeriesEpisodeCard {
  id: string;
  episodeNumber: number;
  episodeType?: SeriesEpisodeType;
  title: string;
  mainQuestion: string;
  coreConflictAction?: string;
  openingHook: string;
  pressureBeats: string[];
  satisfactionType: EpisodeSatisfactionType;
  satisfactionBeat: string;
  visiblePayoffAction?: string;
  cliffhanger: string;
  nextHookRequirement?: string;
  continuityIn: string[];
  continuityOut: string[];
  visualReuse: string[];
  assetPlan?: string[];
  adHocAssets?: SeriesEpisodeAdHocAsset[];
  generatedScript?: string;
  generatedAt?: number;
}

export type SeriesHookStatus = 'active' | 'advanced' | 'resolved' | 'dropped';

export interface SeriesEpisodeSummary {
  episodeId: string;
  episodeNumber: number;
  title: string;
  keyEvents: string[];
  stateChanges: string[];
  relationshipChanges: string[];
  hookActivity: string[];
  settledAt: number;
}

export interface SeriesHookLedgerItem {
  hookId: string;
  description: string;
  status: SeriesHookStatus;
  startEpisode: number;
  lastAdvancedEpisode: number;
  expectedPayoff: string;
  notes: string;
}

export interface SeriesCharacterContinuity {
  characterId?: string;
  name: string;
  currentState: string;
  knownInfo: string[];
  relationshipChanges: string[];
  voiceRisk: string;
}

export interface SeriesPropLedgerItem {
  propId: string;
  name: string;
  owner: string;
  status: string;
  lastSeenEpisode: number;
  carriedForward: boolean;
  notes: string;
}

export interface SeriesRuntimeState {
  currentFocus: string;
  episodeSummaries: SeriesEpisodeSummary[];
  hookLedger: SeriesHookLedgerItem[];
  characterContinuity: SeriesCharacterContinuity[];
  propLedger: SeriesPropLedgerItem[];
  updatedAt: number;
}

export type SeriesAudienceChannel = 'auto' | 'male' | 'female';

export interface SeriesPlayRules {
  audienceEntry: string;
  recurringHook: string;
  payoffLoop: string;
  escalationRule: string;
  assetRotationRule: string;
  protagonistActionRule: string;
  forbiddenShortcut: string;
}

export interface SeriesConceptAnalysis {
  conceptLogline: string;
  coreStoryEngine: string;
  audiencePromise: string;
  viewpointEntry: string;
  protagonistFantasy: string;
  playRules: SeriesPlayRules;
  episodeEnginePattern: string[];
  characterVoiceRules: string[];
  visualSatisfactionRules: string[];
  driftGuardrails: string[];
  worldRules: string[];
  mustKeepFacts: string[];
  mustKeepCharacters: string[];
  mustKeepMechanisms: string[];
  episodeFormula: string[];
  forbiddenDrift: string[];
  recommendedGenreMode: string;
  toneKeywords: string[];
  updatedAt: number;
}

export interface SeriesSeasonRhythmBeat {
  episodeNumber: number;
  episodeType: SeriesEpisodeType;
  role: string;
  requiredAsset: string;
  coreTurn: string;
  payoffPromise: string;
  nextHook: string;
}

export interface SeriesStep0QualityReport {
  ok: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  summary: string;
  bibleIssues: string[];
  assetIssues: string[];
  rhythmIssues: string[];
  cardIssues: string[];
  repairInstructions: string[];
  updatedAt: number;
}

export interface SeriesConceptAlignmentReport {
  aligned: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  missingMustKeep: string[];
  driftRisks: string[];
  repairInstructions: string[];
  updatedAt: number;
}

export interface SeriesPlan {
  premise: string;
  sourcePremise?: string;
  conceptAnalysis?: SeriesConceptAnalysis;
  genreMode: 'ancient_sweet_romance' | 'ancient_romance' | 'palace_intrigue' | 'xianxia' | 'modern_revenge' | 'boss_romance' | 'male_power_fantasy' | 'male_medical_master' | 'male_war_god_dragon' | 'male_son_in_law' | 'male_treasure_appraisal' | 'rebirth_revenge' | 'transmigration_book' | 'system_task' | 'quick_transmigration' | 'time_loop' | 'body_swap' | 'mind_reading' | 'bullet_comments' | 'space_stockpile' | 'absurd_comedy' | 'family_ethics' | 'mystic_fengshui' | 'pure_comedy' | 'custom';
  audienceChannel?: SeriesAudienceChannel;
  tone: string;
  styleConfig?: string;
  episodeCount?: number;
  episodeDuration?: number;
  characters: SeriesCharacterProfile[];
  longRunningSecrets: string[];
  recurringProps: string[];
  productionAssets: SeriesProductionAsset[];
  seasonRhythm?: SeriesSeasonRhythmBeat[];
  step0QualityReport?: SeriesStep0QualityReport;
  episodeCards: SeriesEpisodeCard[];
  updatedAt: number;
}

// ---------- 章节状态 ----------
export type ChapterStatus = 'idle' | 'scripting' | 'adapting' | 'analyzing' | 'assets' | 'generating' | 'videos' | 'dubbing' | 'compositing';

export type Step1TaskPhase = 'adapting' | 'scripting';

export interface Step1TaskState {
  running: boolean;
  sessionId?: string;
  phase?: Step1TaskPhase;
  streamTextPreview?: string;
  streamTextLength?: number;
  streamActivityAt?: number;
  streamLastEvent?: string;
  error?: string;
  startedAt?: number;
  updatedAt?: number;
}

export type Step3TaskPhase = 'optimize' | 'generate' | 'lightweight';

export interface Step3TaskFailure {
  key: string;
  name: string;
  concept?: string;
  phase: Step3TaskPhase;
  retryMode?: string;
  error: string;
}

export interface Step3TaskState {
  running: boolean;
  sessionId?: string;
  phase?: Step3TaskPhase;
  done: number;
  total: number;
  success: number;
  failed: number;
  currentLabel?: string | null;
  stopRequested?: boolean;
  stopped?: boolean;
  error?: string;
  failures?: Step3TaskFailure[];
  startedAt?: number;
  updatedAt?: number;
}

/** 剧本类型 */
export type ScriptType = 'annotated' | 'novel';

/** 单个章节 */
export interface Chapter {
  id: string;
  title: string;                       // 如 "第1章：仙侠大殿"
  sourceSeriesEpisodeId?: string;       // 来自系列策划集卡时，用于连续性上下文回传 Step1
  rawScript: string;
  scriptType: ScriptType;              // 剧本类型：标注剧本 / 网文小说
  storyboardDuration: number;          // 分镜时长（秒），默认 15
  episodeDuration: number;             // 单集时长（秒），网文模式专用，默认 120
  adaptedScript: string;               // 网文改编后的分镜剧本
  analysis: ScriptAnalysis | null;
  analysisPropDefaultPolicyVersion?: number; // 道具追踪/参考图默认策略版本
  analysisSourceText?: string;         // 当前 analysis 对应的脚本文本快照（标注剧本=rawScript，网文=adaptedScript）
  analysisIsStale?: boolean;           // analysis 是否已落后于当前脚本文本
  analysisAiAutofillSignature?: string; // 当前 analysis 最近一次 AI 补全完成后的快照签名
  analysisAiAutofillAt?: number;        // 当前 analysis 最近一次 AI 补全时间
  storyboards: StoryboardState[];
  step4OutputMode?: Step4OutputMode; // 章节级 Step4 默认生成模式
  storyboardBoardMode?: StoryboardBoardMode; // 章节级故事板规格：固定15格或智能格数
  storyboardBoardSmartPanelCount?: SmartStoryboardPanelCountPreference; // 智能故事板格数偏好：自动或固定 6/9/12
  storyboardBoardSmartDurationCompressionEnabled?: boolean; // 智能故事板是否允许压缩原分镜时长，默认开启
  storyboardCameraSegmentCount?: StoryboardCameraSegmentPreference; // Step4 故事板最终视频镜头段数量，默认自动，范围 1-5
  storyboardBoardStyle?: StoryboardBoardStyle; // 章节级导演板默认样式
  storyboardDirectorRunMode?: StoryboardDirectorRunMode; // 15格故事板：精修 / 快速 / 精简
  episodeShotSheet?: EpisodeShotSheetState; // 章节级整集 Shot Sheet，给 Step4 单段继承故事功能和连续性
  currentStoryboardIndex: number;
  globalLastFrameInfo: string;        // 兼容旧链路的章节级落幅镜像信息
  itemTracker: Record<string, string>; // 兼容旧链路的章节级物品状态镜像
  /** 章节级同场景空间母版；同名场景复用同一张无人竖屏底图 */
  sceneSpatialMasters?: Record<string, SceneSpatialMasterState>;
  autoGenerate: AutoGenerateState;
  step1Task?: Step1TaskState;
  step3Task?: Step3TaskState;
  status: ChapterStatus;
  speakerVoiceOverrides?: Record<string, SpeakerVoiceOverride>;
  /** Step6 AI 配音分析结果，和 TTS 音频索引保持一致 */
  dubbingAnalysisLines?: DubbingDialogueAnalysis[];
  /** 章节 BGM 配置（所有分镜共用，分镜可覆盖） */
  bgm?: BgmConfig;
  /** Step6/Step7 一键成片后期状态 */
  postProduction?: PostProductionState;
    // 撤销/重做历史（past 和 future 栈，章节级连续性镜像按需回推）
    past: Array<Pick<Chapter, 'storyboards'> & Partial<Pick<Chapter, 'sceneSpatialMasters'>>>;
    future: Array<Pick<Chapter, 'storyboards'> & Partial<Pick<Chapter, 'sceneSpatialMasters'>>>;
}

export interface Step3Settings {
  optimizeConcurrency: number;
  generateConcurrency: number;
  /** 开启后，角色基础身份可绑定火山官方虚拟人像；不开启时保持原有生图流程 */
  useVolcVirtualHumans?: boolean;
}

/** 项目 */
export interface Project {
  id: string;
  name: string;
  styleConfig: string;
  createdAt: number;
  // 全局共享资源
  allCharacterNames: string[];
  characterProfiles: CharacterProfile[];
  outfitTracking: CharacterOutfit[];
  propTracking: PropConsistency[];   // 物品/道具一致性追踪表
  propInheritance: string;
  // 章节列表
  chapters: Chapter[];
  // 当前活跃章节
  currentChapterId: string;
  // 图片资产库（项目级）
  assetLibrary: Asset[];
  // 项目级角色配音参考库（音频母版；旧项目可能保留黑屏视频派生物）
  characterVoiceReferences?: CharacterVoiceReference[];
  // Step3 资产生成偏好设置
  step3Settings?: Step3Settings;
  // Step0 系列短剧策划
  seriesPlan?: SeriesPlan;
  seriesRuntime?: SeriesRuntimeState;
}

/** 应用状态（最外层） */
export interface AppState {
  projects: Project[];
  currentProjectId: string | null;
  globalTasks: GlobalTask[];
  globalTaskSettings: GlobalTaskSettings;
  apiConfig: ApiConfig;
  imageApiConfig: ImageApiConfig;
  videoApiConfig: VideoApiConfig;
  ttsApiConfig: TtsApiConfig;
  musicApiConfig: MusicApiConfig;
}

/** AppStep 按章节计步（章节内） */
export type AppStep = 'step1-input' | 'step2-analysis' | 'step3-generation';
