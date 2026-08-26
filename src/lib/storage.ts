// ============================================================
// 存储层：状态持久化与 localStorage 精简策略
//
// 主要目标：
// 1. 不在 localStorage 保存 blob: 运行期 videoUrl；真实 http(s) 结果 URL 需要保留用于刷新后恢复
// 2. 不再单独保存 TTS API Key，由 TtsPanel 统一写入配置
// 3. load/save/migrate 的状态结构与 projectStore 保持一致
// 4. 撤销/重做历史只保留在当前会话，避免把重复快照一起写进 localStorage
// ============================================================

import type { AppState, ApiConfig, ImageApiConfig, VideoApiConfig, TtsApiConfig, MusicApiConfig, StoryboardState, StoryboardInfo, AppStep, ChapterStatus, ScriptAnalysis, Step3Settings, AutoGenerateState, Asset, Step4OutputMode, StoryboardBoardMode, SmartStoryboardPanelCountPreference, StoryboardCameraSegmentPreference, StoryboardBoardStyle, StoryboardDirectorRunMode, GlobalTask, GlobalTaskEvent, GlobalTaskSettings, Step1TaskState, Step3TaskState, ImageSize } from '@/types';
import { DEFAULT_VOLC_API_BASE, normalizeVolcApiBaseUrl } from '@/lib/volcengineApiClient';
import { getVolcVideoModelCapabilities, normalizeVolcVideoDuration } from '@/lib/volcengineVideoModels';
import { ensurePropTrackingIds, normalizeGeneratedPropTrackingDefaults, PROP_DEFAULT_POLICY_VERSION } from '@/lib/propTracking';
import { DEFAULT_STORYBOARD_BOARD_MODE, STORYBOARD_BOARD_MODES, normalizeStoryboardBoardState } from '@/lib/storyboardBoardState';
import { normalizeScenePositionBoardState } from '@/lib/scenePositionBoardState';
import { normalizeSceneSpatialMasters } from '@/lib/sceneSpatialMasterState';
import { relinkMissingImageReferenceAssets } from '@/lib/imageReferenceAssetBinding';
import { normalizeFrameRatio } from '@/lib/frameRatio';
import { stabilizeGeneratedEpisodeScript } from '@/lib/seriesScriptStabilizer';
import { runSelfCheck } from '@/lib/self-check';
import { isStoryboardPromptReady } from '@/lib/storyboardReadiness';
import {
  DEFAULT_SMART_STORYBOARD_PANEL_COUNT_PREFERENCE,
  normalizeSmartStoryboardPanelCountPreference,
} from '@/lib/smartStoryboardPanelCount';
import {
  DEFAULT_STORYBOARD_CAMERA_SEGMENT_PREFERENCE,
  normalizeStoryboardCameraSegmentPreference,
} from '@/lib/storyboardCameraSegments';
import {
  DEFAULT_SEEDANCE_CLOUD_API_BASE,
  getSeedanceTransit9Resolution,
  normalizeSeedanceCloudBaseUrl,
  normalizeSeedanceServiceDuration,
  normalizeSeedanceVideoResolution,
  normalizeVisibleSeedanceServiceModel,
} from '@/lib/seedanceApi';

const STORAGE_KEY = 'drama-skill-pack-v2';
const LEGACY_KEY = 'drama-skill-pack-project-state';
const API_CONFIG_KEY = 'drama-api-config';
const TTS_KEY = 'mimo-tts-api-key';
const IMAGE_SIZE_DEFAULTS_MIGRATION_KEY = 'xiakeman-image-size-defaults-20260529';
let legacyLocalStorageCompatibilityEnabled = true;
const STEP4_BUSY_STATUSES = new Set<StoryboardState['status']>([
  'checking',
  'correcting',
  'choreographing',
  'choreo-checking',
  'generating',
  'self-checking',
]);

const DEFAULT_AUTO_GENERATE: AutoGenerateState = {
  running: false,
  currentIndex: -1,
  total: 0,
  doneCount: 0,
  errors: [],
  cancelled: false,
};

const DEFAULT_STEP1_TASK: Step1TaskState = {
  running: false,
};

const DEFAULT_STEP3_TASK: Step3TaskState = {
  running: false,
  done: 0,
  total: 0,
  success: 0,
  failed: 0,
  failures: [],
};

const DEFAULT_GLOBAL_TASK_SETTINGS: GlobalTaskSettings = {
  step4Concurrency: 1,
  step4StoryboardImageConcurrency: 1,
  step4SeedancePromptConcurrency: 1,
  step4StoryboardImageSize: '2K',
  step4LlmExecutionMode: 'browser-direct',
};

// ---------- 默认配置与归一化 ----------

export const DEFAULT_API_CONFIG: ApiConfig = {
  baseUrl: '',
  apiKey: '',
  model: '',
};

const LEGACY_DEFAULT_API_CONFIG: ApiConfig = {
  baseUrl: 'https://yunwu.ai/v1',
  apiKey: '',
  model: 'gpt-5.4',
};

export function normalizeApiConfig(raw: Partial<ApiConfig> | undefined): ApiConfig {
  const config = { ...DEFAULT_API_CONFIG, ...(raw || {}) };
  const baseUrl = config.baseUrl.trim();
  const model = config.model.trim();
  const apiKey = config.apiKey.trim();
  const isLegacyEmptyDefault =
    !apiKey
    && /^https:\/\/yunwu\.ai(?:\/v1)?\/?$/i.test(baseUrl)
    && new RegExp(`^${LEGACY_DEFAULT_API_CONFIG.model.replace('.', '\\.')}$`, 'i').test(model);

  return {
    baseUrl: isLegacyEmptyDefault ? DEFAULT_API_CONFIG.baseUrl : baseUrl,
    apiKey,
    model: isLegacyEmptyDefault ? DEFAULT_API_CONFIG.model : model,
  };
}

export const DEFAULT_IMAGE_API_CONFIG: ImageApiConfig = {
  baseUrl: '',
  apiKey: '',
  model: '',
  defaultImageSize: '1K',
  apimartEnhance: false,
  apimartGoogleSearch: false,
  apimartGoogleImageSearch: false,
  apimartQuality: 'auto',
  apimartBackground: 'auto',
  apimartModeration: 'auto',
  apimartOutputFormat: 'png',
  apimartOutputCompression: 100,
  apimartMaskUrl: '',
};

export function normalizeImageApiConfig(raw: Partial<ImageApiConfig> | undefined): ImageApiConfig {
  const config = { ...DEFAULT_IMAGE_API_CONFIG, ...(raw || {}) };
  const baseUrl = config.baseUrl.trim();
  const model = config.model.trim();
  const isLegacyDefault =
    /^https:\/\/yunwu\.ai\/?$/i.test(baseUrl)
    && /^gemini-3\.1-flash-image-preview$/i.test(model);
  const isLegacyXiakemanDefault =
    !config.apiKey.trim()
    && /^https:\/\/api\.xiakeman\.com\/v1\/?$/i.test(baseUrl)
    && /^gpt-image-2$/i.test(model);
  return {
    ...config,
    baseUrl: (isLegacyDefault || isLegacyXiakemanDefault)
      ? DEFAULT_IMAGE_API_CONFIG.baseUrl
      : baseUrl,
    model: (isLegacyDefault || isLegacyXiakemanDefault) ? DEFAULT_IMAGE_API_CONFIG.model : model,
  };
}

export const DEFAULT_VIDEO_API_CONFIG: VideoApiConfig = {
  backend: 'seedancecloud',
  videoDuration: 15,
  videoRatio: '16:9',
  videoResolution: '720p',
  seedanceTimeout: 7200,
  seedanceBatchDelay: 100,
  seedanceModel: 'fast',
  seedanceCloudBaseUrl: DEFAULT_SEEDANCE_CLOUD_API_BASE,
  seedanceCloudLicenseKey: '',
  seedanceCloudUserId: '',
  xyqAgentAccessKey: '',
  xyqAgentBaseUrl: 'https://xyq.jianying.com',
  xyqAgentTimeout: 1800,
  useVideoExtension: false,
  seedanceUseVideoExtension: false,
  characterVoiceReferencesEnabled: false,
  useBackendVideoJobs: false,
  hmapiApiKey: '',
  hmapiModel: 'jimeng-video-seedance-2.0-fast',
  volcBaseUrl: DEFAULT_VOLC_API_BASE,
  volcApiKey: '',
  volcModel: 'doubao-seedance-2-0-260128-fast',
  volcGenerateAudio: false,
  volcReferenceAudioUrls: [],
  aliyunApiKey: '',
  aliyunModel: 'happyhorse-1.0-r2v',
  aliyunRegion: 'cn-beijing',
  aliyunWatermark: false,
  aliyunSeed: '',
  batchConcurrency: 3,
};
export function normalizeVideoApiConfig(raw: Partial<VideoApiConfig> | undefined): VideoApiConfig {
  const backend = (raw as { backend?: string } | undefined)?.backend;
  const normalizedBackend = backend === 'seedance' || backend === 'seedancecloud' || backend === 'xyqagent' || backend === 'hmapi' || backend === 'volcengine' || backend === 'aliyunbailian'
    ? backend
    : DEFAULT_VIDEO_API_CONFIG.backend;
  const xyqAgentBaseUrl = raw?.xyqAgentBaseUrl?.trim();
  const seedanceCloudBaseUrl = normalizeSeedanceCloudBaseUrl(raw?.seedanceCloudBaseUrl);
  const legacySeedanceCloudUserId = raw?.seedanceCloudUserId?.trim();
  const volcModel = raw?.volcModel?.trim() || DEFAULT_VIDEO_API_CONFIG.volcModel;
  const volcCapabilities = getVolcVideoModelCapabilities(volcModel);
  const rawVideoDuration = Number(raw?.videoDuration) || DEFAULT_VIDEO_API_CONFIG.videoDuration;
  const videoDuration = normalizedBackend === 'volcengine'
    ? normalizeVolcVideoDuration(rawVideoDuration, DEFAULT_VIDEO_API_CONFIG.videoDuration, volcModel)
    : normalizeSeedanceServiceDuration(rawVideoDuration);
  const seedanceModel = normalizeVisibleSeedanceServiceModel(raw?.seedanceModel);
  const rawVideoResolution = normalizeSeedanceVideoResolution(raw?.videoResolution, DEFAULT_VIDEO_API_CONFIG.videoResolution);
  const videoResolution = normalizedBackend === 'aliyunbailian' && rawVideoResolution === '480p'
    ? '720p'
    : normalizedBackend === 'aliyunbailian' && rawVideoResolution === '4k'
      ? '1080p'
    : normalizedBackend === 'seedancecloud'
      ? getSeedanceTransit9Resolution(seedanceModel, rawVideoResolution) ?? rawVideoResolution
    : rawVideoResolution === '4k'
      ? '1080p'
    : rawVideoResolution;
  const rawSeedanceTimeout = Number(raw?.seedanceTimeout);
  const rawSeedanceBatchDelay = Number(raw?.seedanceBatchDelay);

  return {
    ...DEFAULT_VIDEO_API_CONFIG,
    ...(raw || {}),
    backend: normalizedBackend,
    videoDuration,
    videoResolution,
    videoRatio: normalizeFrameRatio(raw?.videoRatio ?? DEFAULT_VIDEO_API_CONFIG.videoRatio),
    volcModel,
    seedanceModel,
    seedanceCloudBaseUrl,
    seedanceCloudLicenseKey: raw?.seedanceCloudLicenseKey?.trim()
      || legacySeedanceCloudUserId
      || DEFAULT_VIDEO_API_CONFIG.seedanceCloudLicenseKey,
    seedanceCloudUserId: legacySeedanceCloudUserId ?? DEFAULT_VIDEO_API_CONFIG.seedanceCloudUserId,
    seedanceTimeout: Number.isFinite(rawSeedanceTimeout)
      ? Math.max(60, Math.min(7200, rawSeedanceTimeout))
      : DEFAULT_VIDEO_API_CONFIG.seedanceTimeout,
    seedanceBatchDelay: Number.isFinite(rawSeedanceBatchDelay)
      ? Math.max(0, Math.min(300, rawSeedanceBatchDelay))
      : DEFAULT_VIDEO_API_CONFIG.seedanceBatchDelay,
    xyqAgentBaseUrl: xyqAgentBaseUrl || DEFAULT_VIDEO_API_CONFIG.xyqAgentBaseUrl,
    xyqAgentAccessKey: raw?.xyqAgentAccessKey?.trim() ?? DEFAULT_VIDEO_API_CONFIG.xyqAgentAccessKey,
    xyqAgentTimeout: Math.max(60, Math.min(7200, Number(raw?.xyqAgentTimeout) || DEFAULT_VIDEO_API_CONFIG.xyqAgentTimeout)),
    useVideoExtension: raw?.useVideoExtension ?? raw?.seedanceUseVideoExtension ?? DEFAULT_VIDEO_API_CONFIG.useVideoExtension,
    seedanceUseVideoExtension: raw?.seedanceUseVideoExtension ?? raw?.useVideoExtension ?? DEFAULT_VIDEO_API_CONFIG.seedanceUseVideoExtension,
    characterVoiceReferencesEnabled: raw?.characterVoiceReferencesEnabled ?? DEFAULT_VIDEO_API_CONFIG.characterVoiceReferencesEnabled,
    useBackendVideoJobs: false,
    volcBaseUrl: normalizeVolcApiBaseUrl(raw?.volcBaseUrl),
    volcReferenceAudioUrls: Array.isArray(raw?.volcReferenceAudioUrls)
      ? raw.volcReferenceAudioUrls.map((url) => url.trim()).filter(Boolean).slice(0, volcCapabilities.maxAudios)
      : DEFAULT_VIDEO_API_CONFIG.volcReferenceAudioUrls,
    aliyunApiKey: raw?.aliyunApiKey?.trim() ?? DEFAULT_VIDEO_API_CONFIG.aliyunApiKey,
    aliyunModel: raw?.aliyunModel?.trim() || DEFAULT_VIDEO_API_CONFIG.aliyunModel,
    aliyunRegion: raw?.aliyunRegion?.trim() || DEFAULT_VIDEO_API_CONFIG.aliyunRegion,
    aliyunWatermark: raw?.aliyunWatermark ?? DEFAULT_VIDEO_API_CONFIG.aliyunWatermark,
    aliyunSeed: raw?.aliyunSeed?.trim() ?? DEFAULT_VIDEO_API_CONFIG.aliyunSeed,
  };
}

export const DEFAULT_TTS_API_CONFIG: TtsApiConfig = {
  baseUrl: 'https://api.xiaomimimo.com/v1',
  apiKey: '',
  model: 'mimo-v2.5-tts',
};

export const DEFAULT_MUSIC_API_CONFIG: MusicApiConfig = {
  baseUrl: 'https://api.minimaxi.com',
  apiKey: '',
  model: 'music-2.6-free',
};

export const DEFAULT_STEP3_SETTINGS: Step3Settings = {
  optimizeConcurrency: 5,
  generateConcurrency: 5,
  useVolcVirtualHumans: false,
};
const STEP3_MAX_CONCURRENCY = 8;

export const DEFAULT_STEP4_OUTPUT_MODE: Step4OutputMode = 'storyboard-director';
export const DEFAULT_STORYBOARD_BOARD_STYLE: StoryboardBoardStyle = 'seedance-board';
export const DEFAULT_STORYBOARD_DIRECTOR_RUN_MODE: StoryboardDirectorRunMode = 'refine';

function normalizeStep4OutputMode(value: unknown): Step4OutputMode {
  if (value === 'prompt' || value === 'storyboard-director') return value;
  return DEFAULT_STEP4_OUTPUT_MODE;
}

function normalizeOptionalStep4OutputMode(value: unknown): Step4OutputMode | undefined {
  if (value === 'prompt' || value === 'storyboard-director') return value;
  return undefined;
}

function normalizeStoryboardBoardStyle(value: unknown): StoryboardBoardStyle {
  if (value === 'cinematic' || value === 'stick-figure' || value === 'seedance-board') {
    return value;
  }
  return DEFAULT_STORYBOARD_BOARD_STYLE;
}

function normalizeStoryboardBoardMode(value: unknown): StoryboardBoardMode {
  return STORYBOARD_BOARD_MODES.includes(value as StoryboardBoardMode)
    ? value as StoryboardBoardMode
    : DEFAULT_STORYBOARD_BOARD_MODE;
}

function normalizeStoryboardDirectorRunMode(value: unknown): StoryboardDirectorRunMode {
  if (value === 'compact') return 'compact';
  if (value === 'fast') return 'fast';
  return DEFAULT_STORYBOARD_DIRECTOR_RUN_MODE;
}

function normalizeStep3Settings(raw: Partial<Step3Settings> | undefined): Step3Settings {
  const optimizeConcurrency = typeof raw?.optimizeConcurrency === 'number' ? raw.optimizeConcurrency : DEFAULT_STEP3_SETTINGS.optimizeConcurrency;
  const generateConcurrency = typeof raw?.generateConcurrency === 'number' ? raw.generateConcurrency : DEFAULT_STEP3_SETTINGS.generateConcurrency;

  return {
    optimizeConcurrency: Math.min(STEP3_MAX_CONCURRENCY, Math.max(1, Math.round(optimizeConcurrency))),
    generateConcurrency: Math.min(STEP3_MAX_CONCURRENCY, Math.max(1, Math.round(generateConcurrency))),
    useVolcVirtualHumans: raw?.useVolcVirtualHumans ?? DEFAULT_STEP3_SETTINGS.useVolcVirtualHumans,
  };
}

function normalizeStoredStep1Task(raw: Partial<Step1TaskState> | undefined): Step1TaskState {
  if (!raw) return { ...DEFAULT_STEP1_TASK };
  return {
    ...DEFAULT_STEP1_TASK,
    ...raw,
    sessionId: undefined,
    phase: raw.phase === 'adapting' || raw.phase === 'scripting' ? raw.phase : undefined,
    running: false,
    error: raw.running ? '页面刷新后 Step1 后台请求已中断，可重新开始。' : raw.error,
  };
}

function normalizeStoredStep3Task(raw: Partial<Step3TaskState> | undefined): Step3TaskState {
  if (!raw) return { ...DEFAULT_STEP3_TASK };
  return {
    ...DEFAULT_STEP3_TASK,
    ...raw,
    sessionId: undefined,
    phase: raw.phase === 'optimize' || raw.phase === 'generate' || raw.phase === 'lightweight' ? raw.phase : undefined,
    done: Math.max(0, Number(raw.done) || 0),
    total: Math.max(0, Number(raw.total) || 0),
    success: Math.max(0, Number(raw.success) || 0),
    failed: Math.max(0, Number(raw.failed) || 0),
    failures: Array.isArray(raw.failures)
      ? raw.failures.map((failure) => ({
          key: String(failure.key ?? ''),
          name: String(failure.name ?? ''),
          concept: failure.concept ? String(failure.concept) : undefined,
          phase: failure.phase === 'optimize' || failure.phase === 'generate' || failure.phase === 'lightweight' ? failure.phase : 'generate',
          retryMode: failure.retryMode ? String(failure.retryMode) : undefined,
          error: String(failure.error ?? '生成失败'),
        })).filter((failure) => failure.key && failure.name)
      : [],
    running: false,
    stopRequested: false,
    error: raw.running ? '页面刷新后 Step3 后台任务已中断，可从当前资产状态继续。' : raw.error,
  };
}

// ---------- 精简持久化数据 ----------

/** 去掉运行期临时字段，避免把无效链接或大对象直接写入持久化存储 */
function stripTransientData(state: AppState): AppState {
  return {
    ...state,
    projects: state.projects.map((p) => ({
      ...p,
      chapters: p.chapters.map((c) => ({
        ...c,
        step1Task: c.step1Task?.running
          ? {
              ...c.step1Task,
              running: false,
              sessionId: undefined,
              error: '页面刷新后 Step1 后台请求已中断，可重新开始。',
            }
          : c.step1Task,
        step3Task: c.step3Task?.running
          ? {
              ...c.step3Task,
              running: false,
              sessionId: undefined,
              stopRequested: false,
              error: '页面刷新后 Step3 后台任务已中断，可从当前资产状态继续。',
            }
          : c.step3Task,
        past: [],
        future: [],
        storyboards: c.storyboards.map((sb) => {
          // blob: URL 刷新后会失效；远端/代理 URL 要保留，避免生成完成后刷新丢失预览入口。
          if (typeof sb.videoUrl === 'string' && sb.videoUrl.startsWith('blob:')) {
            return { ...sb, videoUrl: undefined };
          }
          return sb;
        }),
      })),
    })),
  };
}

// ---------- Migration ----------

interface LegacyState {
  currentStep?: AppStep;
  rawScript?: string;
  analysis?: ScriptAnalysis | null;
  currentStoryboardIndex?: number;
  storyboards?: StoryboardState[];
  globalLastFrameInfo?: string;
  itemTracker?: Record<string, string>;
  apiConfig?: ApiConfig;
}

function normalizeAnalysisForStorage(
  analysis: ScriptAnalysis | null | undefined,
  options: { applyGeneratedPropDefaults?: boolean } = {},
): ScriptAnalysis | null {
  if (!analysis) return null;
  return {
    ...analysis,
    characterProfiles: analysis.characterProfiles ?? [],
    propTracking: options.applyGeneratedPropDefaults
      ? normalizeGeneratedPropTrackingDefaults(analysis.propTracking ?? [])
      : ensurePropTrackingIds(analysis.propTracking ?? []),
  };
}

export function sanitizeStateForPersistence(state: AppState): AppState {
  return stripTransientData(state);
}

function inferLegacyChapterStatus(legacy: LegacyState): ChapterStatus {
  if (legacy.currentStep === 'step3-generation') {
    const hasPromptData = (legacy.storyboards ?? []).some((storyboard) => !!storyboard?.prompt?.rawText);
    return hasPromptData ? 'generating' : 'assets';
  }

  if (legacy.currentStep === 'step2-analysis') {
    return legacy.analysis ? 'analyzing' : 'idle';
  }

  if ((legacy.storyboards?.length ?? 0) > 0) {
    const hasPromptData = legacy.storyboards?.some((storyboard) => !!storyboard?.prompt?.rawText);
    return hasPromptData ? 'generating' : 'assets';
  }

  if (legacy.analysis) {
    return 'analyzing';
  }

  return 'idle';
}

function normalizeLegacyStoryboardInfo(raw: unknown): StoryboardInfo {
  const storyboard = (raw ?? {}) as Partial<StoryboardInfo>;
  return {
    number: typeof storyboard.number === 'number' ? storyboard.number : 0,
    name: typeof storyboard.name === 'string' ? storyboard.name : '未命名分镜',
    duration: typeof storyboard.duration === 'string' ? storyboard.duration : '',
    shotSize: typeof storyboard.shotSize === 'string' ? storyboard.shotSize : '中景',
    scene: typeof storyboard.scene === 'string' ? storyboard.scene : undefined,
    characters: Array.isArray(storyboard.characters)
      ? storyboard.characters.filter((character): character is string => typeof character === 'string')
      : [],
  };
}

function normalizeLegacyStoryboard(raw: unknown): StoryboardState {
  const legacyStoryboard = (raw ?? {}) as Partial<StoryboardState> & {
    storyboards?: unknown;
  };
  const compactVideoPromptMode = legacyStoryboard.compactVideoPromptMode
    ?? (legacyStoryboard.compactVideoPrompt ? 'compact' : undefined);

  return normalizeStoredStoryboardSelfCheck({
    storyboard: normalizeLegacyStoryboardInfo(legacyStoryboard.storyboard ?? legacyStoryboard.storyboards),
    step4OutputMode: normalizeStep4OutputMode(legacyStoryboard.step4OutputMode),
    generatedStep4OutputMode: normalizeOptionalStep4OutputMode(legacyStoryboard.generatedStep4OutputMode),
    storyboardBoardStyle: normalizeStoryboardBoardStyle(legacyStoryboard.storyboardBoardStyle),
    useStoryboardBoardReference: legacyStoryboard.useStoryboardBoardReference ?? false,
    useCompactVideoPrompt: compactVideoPromptMode === 'desensitized'
      ? legacyStoryboard.useCompactVideoPrompt ?? false
      : false,
    compactVideoPrompt: legacyStoryboard.compactVideoPrompt ?? '',
    compactVideoPromptMode,
    compactVideoPromptStatus: legacyStoryboard.compactVideoPromptStatus ?? 'idle',
    compactVideoPromptError: legacyStoryboard.compactVideoPromptError,
    compactVideoPromptSourcePrompt: legacyStoryboard.compactVideoPromptSourcePrompt ?? '',
    compactVideoPromptUpdatedAt: legacyStoryboard.compactVideoPromptUpdatedAt,
    videoSubmitPromptOverride: legacyStoryboard.videoSubmitPromptOverride ?? '',
    videoSubmitPromptOverrideSourcePrompt: legacyStoryboard.videoSubmitPromptOverrideSourcePrompt ?? '',
    videoSubmitPromptOverrideUpdatedAt: legacyStoryboard.videoSubmitPromptOverrideUpdatedAt,
    seedanceFinalVideoPrompt: legacyStoryboard.seedanceFinalVideoPrompt ?? '',
    seedanceFinalVideoPromptStatus: legacyStoryboard.seedanceFinalVideoPromptStatus ?? 'idle',
    seedanceFinalVideoPromptError: legacyStoryboard.seedanceFinalVideoPromptError,
    seedanceFinalVideoPromptSourceSnapshot: legacyStoryboard.seedanceFinalVideoPromptSourceSnapshot ?? '',
    seedanceFinalVideoPromptUpdatedAt: legacyStoryboard.seedanceFinalVideoPromptUpdatedAt,
    smartVideoDurationSeconds: typeof legacyStoryboard.smartVideoDurationSeconds === 'number'
      ? legacyStoryboard.smartVideoDurationSeconds
      : undefined,
    smartVideoDurationReason: legacyStoryboard.smartVideoDurationReason,
    smartVideoDurationUpdatedAt: legacyStoryboard.smartVideoDurationUpdatedAt,
    sourceExcerpt: legacyStoryboard.sourceExcerpt ?? '',
    sourceExcerptSummary: legacyStoryboard.sourceExcerptSummary ?? '',
    nextStoryboardSummary: legacyStoryboard.nextStoryboardSummary ?? '',
    logicFixes: legacyStoryboard.logicFixes ?? [],
    correctedScript: legacyStoryboard.correctedScript ?? '',
    sceneBlueprint: legacyStoryboard.sceneBlueprint ?? null,
    choreography: legacyStoryboard.choreography ?? null,
    choreoCheckFixes: legacyStoryboard.choreoCheckFixes,
    imageRefs: legacyStoryboard.imageRefs ?? [],
    videoImageRefs: Array.isArray(legacyStoryboard.videoImageRefs) ? legacyStoryboard.videoImageRefs : undefined,
    videoImageBudget: legacyStoryboard.videoImageBudget,
    referenceVideo: legacyStoryboard.referenceVideo
      ? {
          urls: Array.isArray(legacyStoryboard.referenceVideo.urls)
            ? legacyStoryboard.referenceVideo.urls.map((url) => String(url).trim()).filter(Boolean).slice(0, 3)
            : [],
          note: legacyStoryboard.referenceVideo.note,
        }
      : undefined,
    prompt: legacyStoryboard.prompt ?? null,
    selfCheckResult: legacyStoryboard.selfCheckResult ?? null,
    lastFrameInfo: legacyStoryboard.lastFrameInfo ?? '',
    spatialBlocking: legacyStoryboard.spatialBlocking,
    continuityInput: legacyStoryboard.continuityInput,
    continuityOutput: legacyStoryboard.continuityOutput,
    isStale: legacyStoryboard.isStale ?? false,
    status: legacyStoryboard.status ?? 'pending',
    error: legacyStoryboard.error,
    videoTaskId: legacyStoryboard.videoTaskId,
    videoClientTaskId: legacyStoryboard.videoClientTaskId,
    videoStatus: legacyStoryboard.videoStatus,
    videoProgress: legacyStoryboard.videoProgress,
    videoProgressIsEstimated: legacyStoryboard.videoProgressIsEstimated,
    videoStatusDetail: legacyStoryboard.videoStatusDetail,
    videoUrl: legacyStoryboard.videoUrl,
    videoBlobKey: legacyStoryboard.videoBlobKey,
    videoSubmittedAt: legacyStoryboard.videoSubmittedAt,
    videoCompletedAt: legacyStoryboard.videoCompletedAt,
    videoError: legacyStoryboard.videoError,
    videoErrorDetail: legacyStoryboard.videoErrorDetail,
    audioMix: legacyStoryboard.audioMix,
    storyboardBoard: normalizeStoryboardBoardState(legacyStoryboard.storyboardBoard),
    scenePositionBoard: normalizeScenePositionBoardState(
      legacyStoryboard.scenePositionBoard,
      normalizeLegacyStoryboardInfo(legacyStoryboard.storyboard ?? legacyStoryboard.storyboards).scene,
    ),
  }, DEFAULT_VIDEO_API_CONFIG.videoRatio);
}

function normalizeStoredStoryboardSelfCheck(storyboard: StoryboardState, videoRatio?: string | null): StoryboardState {
  const promptText = storyboard.prompt?.rawText;
  if (!promptText) return storyboard;
  return {
    ...storyboard,
    selfCheckResult: runSelfCheck(promptText, storyboard.imageRefs, storyboard.videoImageBudget, storyboard.correctedScript, false, videoRatio),
  };
}

function normalizeStoredStoryboardAssetBindings(
  storyboard: StoryboardState,
  assetLibrary: readonly Asset[] | undefined,
): StoryboardState {
  const relinked = relinkMissingImageReferenceAssets(storyboard.imageRefs, assetLibrary);
  const videoRelinked = storyboard.videoImageRefs
    ? relinkMissingImageReferenceAssets(storyboard.videoImageRefs, assetLibrary)
    : undefined;
  return {
    ...storyboard,
    imageRefs: relinked.changed ? relinked.imageRefs : storyboard.imageRefs,
    videoImageRefs: videoRelinked
      ? (videoRelinked.changed ? videoRelinked.imageRefs : storyboard.videoImageRefs)
      : storyboard.videoImageRefs,
  };
}

function recoverInterruptedStoredStoryboard(storyboard: StoryboardState): StoryboardState {
  const audioMix = storyboard.audioMix?.ttsLineGeneration?.some((state) => state?.status === 'generating')
    ? {
        ...storyboard.audioMix,
        ttsLineGeneration: storyboard.audioMix.ttsLineGeneration.map((state) =>
          state?.status === 'generating'
            ? {
                ...state,
                status: 'error' as const,
                error: '上次配音生成被刷新或关闭打断，请重新生成这一句。',
                updatedAt: Date.now(),
              }
            : state,
        ),
      }
    : storyboard.audioMix;

  const withRecoveredAudio = audioMix === storyboard.audioMix ? storyboard : { ...storyboard, audioMix };
  if (!STEP4_BUSY_STATUSES.has(storyboard.status)) return withRecoveredAudio;
  return {
    ...withRecoveredAudio,
    status: 'pending',
    error: undefined,
  };
}

function normalizeStoredSeriesPlan<T extends { episodeCards?: Array<{ generatedScript?: string }> }>(seriesPlan: T | undefined): T | undefined {
  if (!seriesPlan) return seriesPlan;
  const raw = seriesPlan as T & {
    characters?: unknown[];
    longRunningSecrets?: unknown[];
    recurringProps?: unknown[];
    productionAssets?: unknown[];
    seasonRhythm?: unknown[];
    episodeCards?: Array<{ generatedScript?: string }>;
  };
  const episodeCards = Array.isArray(raw.episodeCards) ? raw.episodeCards : [];
  return {
    ...raw,
    characters: Array.isArray(raw.characters) ? raw.characters : [],
    longRunningSecrets: Array.isArray(raw.longRunningSecrets) ? raw.longRunningSecrets : [],
    recurringProps: Array.isArray(raw.recurringProps) ? raw.recurringProps : [],
    productionAssets: Array.isArray(raw.productionAssets) ? raw.productionAssets : [],
    seasonRhythm: Array.isArray(raw.seasonRhythm) ? raw.seasonRhythm : undefined,
    episodeCards: episodeCards.map((episode) => ({
      ...episode,
      generatedScript: episode.generatedScript ? stabilizeGeneratedEpisodeScript(episode.generatedScript) : episode.generatedScript,
    })),
  } as T;
}

function normalizeStoredAutoGenerate(
  raw: Partial<AutoGenerateState> | undefined,
  storyboards: readonly StoryboardState[],
): AutoGenerateState {
  const doneCount = storyboards.filter((storyboard) =>
    isStoryboardPromptReady(storyboard),
  ).length;
  const total = raw?.total ?? storyboards.length;

  if (raw?.running) {
    return {
      ...DEFAULT_AUTO_GENERATE,
      total,
      doneCount,
      errors: raw.errors ?? [],
      cancelled: true,
      startedAt: raw.startedAt,
      stopReason: 'cancelled',
    };
  }

  return {
    ...DEFAULT_AUTO_GENERATE,
    ...raw,
    running: false,
    currentIndex: -1,
    total,
    doneCount: raw?.doneCount ?? doneCount,
    errors: raw?.errors ?? [],
  };
}

function normalizeGlobalTaskSettings(raw: Partial<GlobalTaskSettings> | undefined): GlobalTaskSettings {
  const step4Concurrency = typeof raw?.step4Concurrency === 'number'
    ? raw.step4Concurrency
    : DEFAULT_GLOBAL_TASK_SETTINGS.step4Concurrency;
  const step4StoryboardImageConcurrency = typeof raw?.step4StoryboardImageConcurrency === 'number'
    ? raw.step4StoryboardImageConcurrency
    : DEFAULT_GLOBAL_TASK_SETTINGS.step4StoryboardImageConcurrency;
  const step4SeedancePromptConcurrency = typeof raw?.step4SeedancePromptConcurrency === 'number'
    ? raw.step4SeedancePromptConcurrency
    : DEFAULT_GLOBAL_TASK_SETTINGS.step4SeedancePromptConcurrency;
  const rawStep4StoryboardImageSize = raw?.step4StoryboardImageSize;
  const step4StoryboardImageSize: ImageSize =
    rawStep4StoryboardImageSize === '1K'
      || rawStep4StoryboardImageSize === '2K'
      || rawStep4StoryboardImageSize === '4K'
      ? rawStep4StoryboardImageSize
      : DEFAULT_GLOBAL_TASK_SETTINGS.step4StoryboardImageSize;
  const step4LlmExecutionMode = DEFAULT_GLOBAL_TASK_SETTINGS.step4LlmExecutionMode;
  return {
    step4Concurrency: Math.min(10, Math.max(1, Math.round(step4Concurrency))),
    step4StoryboardImageConcurrency: Math.min(2, Math.max(1, Math.round(step4StoryboardImageConcurrency))),
    step4SeedancePromptConcurrency: Math.min(2, Math.max(1, Math.round(step4SeedancePromptConcurrency))),
    step4StoryboardImageSize,
    step4LlmExecutionMode,
  };
}

function normalizeGlobalTaskEventLog(
  raw: readonly Partial<GlobalTaskEvent>[] | undefined,
  now: number,
  options?: { recoveredFromRunning?: boolean },
): GlobalTaskEvent[] | undefined {
  const eventLog: GlobalTaskEvent[] = Array.isArray(raw)
    ? raw
        .filter((event) =>
          typeof event?.label === 'string'
          && event.label.trim().length > 0
          && (event.level === 'info'
            || event.level === 'retry'
            || event.level === 'warning'
            || event.level === 'error'
            || event.level === 'success'),
        )
        .map((event): GlobalTaskEvent => ({
          id: typeof event.id === 'string' ? event.id : `${now}-${Math.random().toString(36).slice(2)}`,
          at: Number.isFinite(event.at) ? Number(event.at) : now,
          level: event.level as GlobalTaskEvent['level'],
          label: event.label?.slice(0, 120) ?? '',
          detail: typeof event.detail === 'string' ? event.detail.slice(0, 800) : undefined,
          storyboardIndex: Number.isFinite(event.storyboardIndex) ? Math.round(event.storyboardIndex ?? -1) : undefined,
          phase: typeof event.phase === 'string' ? event.phase.slice(0, 80) : undefined,
        }))
        .slice(-200)
    : [];

  if (options?.recoveredFromRunning) {
    eventLog.push({
      id: `${now}-${Math.random().toString(36).slice(2)}`,
      at: now,
      level: 'warning',
      label: '检测到上次中断，已恢复为排队',
      detail: '页面刷新或浏览器关闭前任务仍在运行，系统已保留进度并等待继续。',
    });
  }

  return eventLog.length > 0 ? eventLog.slice(-200) : undefined;
}

function normalizeStoredGlobalTasks(
  raw: readonly Partial<GlobalTask>[] | undefined,
  projects: readonly { id: string; chapters?: readonly { id: string }[] }[] | undefined,
): GlobalTask[] {
  if (!Array.isArray(raw)) return [];

  const validChapterKeys = new Set<string>();
  (projects ?? []).forEach((project) => {
    (project.chapters ?? []).forEach((chapter) => {
      validChapterKeys.add(`${project.id}:${chapter.id}`);
    });
  });

  const now = Date.now();
  return raw
  .filter((task) =>
      (task?.type === 'step1-analysis' || task?.type === 'step3-batch' || task?.type === 'step4-batch' || task?.type === 'step5-batch')
      && typeof task.id === 'string'
      && typeof task.projectId === 'string'
      && typeof task.chapterId === 'string'
      && (validChapterKeys.size === 0 || validChapterKeys.has(`${task.projectId}:${task.chapterId}`)),
    )
    .map((task) => {
      const wasRunning = task.status === 'running';
      const status = wasRunning
        ? 'queued'
        : task.status === 'queued'
          || task.status === 'done'
          || task.status === 'failed'
          || task.status === 'cancelled'
          ? task.status
          : 'queued';
      const total = Number.isFinite(task.total) ? Math.max(0, Math.round(task.total ?? 0)) : 0;
      const doneCount = Number.isFinite(task.doneCount) ? Math.max(0, Math.round(task.doneCount ?? 0)) : 0;
      return {
        id: task.id,
        type: task.type,
        projectId: task.projectId,
        chapterId: task.chapterId,
        step1Mode: task.step1Mode === 'auto' || task.step1Mode === 'adapted-analysis'
          ? task.step1Mode
          : undefined,
        step3Mode: task.step3Mode === 'all-images'
          || task.step3Mode === 'section-images'
          || task.step3Mode === 'lightweight-assets'
          || task.step3Mode === 'retry-failed'
          ? task.step3Mode
          : undefined,
        step3Section: task.step3Section === 'character' || task.step3Section === 'scene' || task.step3Section === 'prop'
          ? task.step3Section
          : undefined,
        step3IncludeOutfitVariants: typeof task.step3IncludeOutfitVariants === 'boolean'
          ? task.step3IncludeOutfitVariants
          : undefined,
        storyboardDirectorRunMode: normalizeStoryboardDirectorRunMode(task.storyboardDirectorRunMode),
        step5Indices: Array.isArray(task.step5Indices)
          ? task.step5Indices
              .map((index: unknown) => Number(index))
              .filter((index: number) => Number.isInteger(index) && index >= 0)
          : undefined,
        step5Backend: task.step5Backend === 'seedance'
          || task.step5Backend === 'seedancecloud'
          || task.step5Backend === 'xyqagent'
          || task.step5Backend === 'hmapi'
          || task.step5Backend === 'volcengine'
          || task.step5Backend === 'aliyunbailian'
          ? task.step5Backend
          : undefined,
        status,
        currentIndex: Number.isFinite(task.currentIndex) ? Math.round(task.currentIndex ?? -1) : -1,
        total,
        doneCount,
        errors: Array.isArray(task.errors)
          ? task.errors
              .filter((error: Partial<GlobalTask['errors'][number]>) =>
                typeof error?.index === 'number' && typeof error?.error === 'string',
              )
              .map((error: Partial<GlobalTask['errors'][number]>) => ({
                index: Math.round(error.index ?? 0),
                error: error.error ?? '',
              }))
          : [],
        retryNotice: task.retryNotice && typeof task.retryNotice.index === 'number'
          ? {
              index: Math.round(task.retryNotice.index),
              attempt: Number.isFinite(task.retryNotice.attempt) ? Math.round(task.retryNotice.attempt) : 0,
              maxRetries: Number.isFinite(task.retryNotice.maxRetries) ? Math.round(task.retryNotice.maxRetries) : 0,
              error: typeof task.retryNotice.error === 'string' ? task.retryNotice.error : '',
            }
          : undefined,
        streamStoryboardIndex: Number.isFinite(task.streamStoryboardIndex)
          ? Math.round(task.streamStoryboardIndex ?? -1)
          : undefined,
        streamPhase: status === 'running' ? task.streamPhase : null,
        streamStageLabel: wasRunning
          ? '上次中断，等待恢复'
          : (typeof task.streamStageLabel === 'string' ? task.streamStageLabel : undefined),
        streamStageStartedAt: !wasRunning && Number.isFinite(task.streamStageStartedAt) ? Number(task.streamStageStartedAt) : undefined,
        streamStageLastActivityAt: !wasRunning && Number.isFinite(task.streamStageLastActivityAt) ? Number(task.streamStageLastActivityAt) : undefined,
        streamStageTimeoutMs: !wasRunning && Number.isFinite(task.streamStageTimeoutMs) ? Math.max(0, Number(task.streamStageTimeoutMs)) : undefined,
        streamStageTimeoutMode: !wasRunning && (task.streamStageTimeoutMode === 'hard' || task.streamStageTimeoutMode === 'idle')
          ? task.streamStageTimeoutMode
          : undefined,
        streamTextPreview: typeof task.streamTextPreview === 'string' ? task.streamTextPreview.slice(0, 4000) : '',
        streamTextLength: Number.isFinite(task.streamTextLength) ? Math.max(0, Math.round(task.streamTextLength ?? 0)) : 0,
        streamUpdatedAt: Number.isFinite(task.streamUpdatedAt) ? Number(task.streamUpdatedAt) : undefined,
        streamPreviousStageLabel: typeof task.streamPreviousStageLabel === 'string' ? task.streamPreviousStageLabel : undefined,
        streamPreviousTextLength: Number.isFinite(task.streamPreviousTextLength) ? Math.max(0, Math.round(task.streamPreviousTextLength ?? 0)) : undefined,
        streamPreviousUpdatedAt: Number.isFinite(task.streamPreviousUpdatedAt) ? Number(task.streamPreviousUpdatedAt) : undefined,
        eventLog: normalizeGlobalTaskEventLog(task.eventLog, now, { recoveredFromRunning: wasRunning }),
        createdAt: Number.isFinite(task.createdAt) ? Number(task.createdAt) : now,
        updatedAt: wasRunning
          ? now
          : Number.isFinite(task.updatedAt)
            ? Number(task.updatedAt)
            : now,
        startedAt: Number.isFinite(task.startedAt) ? Number(task.startedAt) : undefined,
        completedAt: Number.isFinite(task.completedAt) ? Number(task.completedAt) : undefined,
        stopReason: wasRunning ? 'interrupted' : task.stopReason,
      } satisfies GlobalTask;
    });
}

function migrateLegacyState(): AppState | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;

    const legacy = JSON.parse(raw) as LegacyState;
    if (!legacy.rawScript && !legacy.analysis) {
      localStorage.removeItem(LEGACY_KEY);
      return null;
    }

    const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
    const projectId = genId();
    const chapterId = genId();

    const project = {
      id: projectId,
      name: legacy.analysis?.projectName || '未命名项目',
      styleConfig: legacy.analysis?.styleConfig?.trim() || '',
      createdAt: Date.now(),
      allCharacterNames: [],
      characterProfiles: [],
      outfitTracking: [],
      propTracking: [],
      propInheritance: '',
      currentChapterId: chapterId,
      assetLibrary: [],
      step3Settings: DEFAULT_STEP3_SETTINGS,
      chapters: [{
        id: chapterId,
        title: '第1章',
        rawScript: legacy.rawScript || '',
        scriptType: 'annotated' as const,
        storyboardDuration: 15,
        episodeDuration: 120,
        adaptedScript: '',
        analysis: normalizeAnalysisForStorage(legacy.analysis || null, { applyGeneratedPropDefaults: true }),
        analysisPropDefaultPolicyVersion: legacy.analysis ? PROP_DEFAULT_POLICY_VERSION : undefined,
        storyboards: (legacy.storyboards || []).map((sb) => normalizeLegacyStoryboard(sb)),
        step4OutputMode: DEFAULT_STEP4_OUTPUT_MODE,
        storyboardBoardMode: DEFAULT_STORYBOARD_BOARD_MODE,
        storyboardBoardSmartPanelCount: DEFAULT_SMART_STORYBOARD_PANEL_COUNT_PREFERENCE,
        storyboardBoardSmartDurationCompressionEnabled: true,
        storyboardCameraSegmentCount: DEFAULT_STORYBOARD_CAMERA_SEGMENT_PREFERENCE,
        storyboardBoardStyle: DEFAULT_STORYBOARD_BOARD_STYLE,
        storyboardDirectorRunMode: DEFAULT_STORYBOARD_DIRECTOR_RUN_MODE,
        currentStoryboardIndex: legacy.currentStoryboardIndex ?? 0,
        globalLastFrameInfo: legacy.globalLastFrameInfo ?? '',
        itemTracker: legacy.itemTracker ?? {},
        autoGenerate: { running: false, currentIndex: -1, total: 0, doneCount: 0, errors: [], cancelled: false },
        step1Task: { ...DEFAULT_STEP1_TASK },
        step3Task: { ...DEFAULT_STEP3_TASK },
        status: inferLegacyChapterStatus(legacy),
        past: [],
        future: [],
      }],
    };

    const apiConfig = normalizeApiConfig({
      baseUrl: legacy.apiConfig?.baseUrl || DEFAULT_API_CONFIG.baseUrl,
      model: legacy.apiConfig?.model || DEFAULT_API_CONFIG.model,
      apiKey: legacy.apiConfig?.apiKey || '',
    });

    const imageApiConfig = normalizeImageApiConfig({
      baseUrl: (legacy as { imageApiConfig?: Partial<ImageApiConfig> }).imageApiConfig?.baseUrl || DEFAULT_IMAGE_API_CONFIG.baseUrl,
      model: (legacy as { imageApiConfig?: Partial<ImageApiConfig> }).imageApiConfig?.model || DEFAULT_IMAGE_API_CONFIG.model,
      apiKey: (legacy as { imageApiConfig?: Partial<ImageApiConfig> }).imageApiConfig?.apiKey || '',
    });

    // 删除 legacy key
    localStorage.removeItem(LEGACY_KEY);

    return {
      projects: [project],
      currentProjectId: projectId,
      globalTasks: [],
      globalTaskSettings: DEFAULT_GLOBAL_TASK_SETTINGS,
      apiConfig,
      imageApiConfig,
      videoApiConfig: DEFAULT_VIDEO_API_CONFIG,
      ttsApiConfig: DEFAULT_TTS_API_CONFIG,
      musicApiConfig: DEFAULT_MUSIC_API_CONFIG,
    };
  } catch {
    return null;
  }
}

/** 恢复 API 配置，并兼容旧 key / 旧存储结构 */
function restoreApiConfigs(parsed: Partial<AppState>) {
  let restoredApiConfig = normalizeApiConfig(parsed.apiConfig);
  let restoredImageApiConfig = normalizeImageApiConfig(parsed.imageApiConfig);
  let restoredVideoApiConfig = normalizeVideoApiConfig(parsed.videoApiConfig);
  let restoredTtsApiConfig = { ...DEFAULT_TTS_API_CONFIG, ...(parsed.ttsApiConfig || {}) };
  let restoredMusicApiConfig = { ...DEFAULT_MUSIC_API_CONFIG, ...(parsed.musicApiConfig || {}) };

  if (!restoredTtsApiConfig.model || restoredTtsApiConfig.model === 'mimo-v2-tts') {
    restoredTtsApiConfig = { ...restoredTtsApiConfig, model: DEFAULT_TTS_API_CONFIG.model };
  }

  if (legacyLocalStorageCompatibilityEnabled) {
    // 兼容旧的 drama-api-config
    try {
      const apiConfigSaved = localStorage.getItem(API_CONFIG_KEY);
      if (apiConfigSaved) {
        const apiParsed = JSON.parse(apiConfigSaved);
        if (apiParsed.llm) restoredApiConfig = normalizeApiConfig({ ...restoredApiConfig, ...apiParsed.llm });
        if (apiParsed.image) restoredImageApiConfig = normalizeImageApiConfig({ ...restoredImageApiConfig, ...apiParsed.image });
        if (apiParsed.video) restoredVideoApiConfig = normalizeVideoApiConfig({ ...restoredVideoApiConfig, ...apiParsed.video });
        if (apiParsed.tts) restoredTtsApiConfig = { ...restoredTtsApiConfig, ...apiParsed.tts };
        if (apiParsed.music) restoredMusicApiConfig = { ...restoredMusicApiConfig, ...apiParsed.music };
      }
    } catch {
      // 读取失败时静默忽略，继续走默认配置
    }

    // 兼容旧的 mimo-tts-api-key
    if (!restoredTtsApiConfig.apiKey) {
      const legacyTtsKey = localStorage.getItem(TTS_KEY);
      if (legacyTtsKey) {
        restoredTtsApiConfig = { ...restoredTtsApiConfig, apiKey: legacyTtsKey };
      }
    }
  }

  return { restoredApiConfig, restoredImageApiConfig, restoredVideoApiConfig, restoredTtsApiConfig, restoredMusicApiConfig };
}

// ---------- Public API ----------

export function createInitialState(): AppState {
  return {
    projects: [],
    currentProjectId: null,
    globalTasks: [],
    globalTaskSettings: DEFAULT_GLOBAL_TASK_SETTINGS,
    apiConfig: DEFAULT_API_CONFIG,
    imageApiConfig: DEFAULT_IMAGE_API_CONFIG,
    videoApiConfig: DEFAULT_VIDEO_API_CONFIG,
    ttsApiConfig: DEFAULT_TTS_API_CONFIG,
    musicApiConfig: DEFAULT_MUSIC_API_CONFIG,
  };
}

export function setLegacyLocalStorageCompatibilityEnabled(enabled: boolean): void {
  legacyLocalStorageCompatibilityEnabled = enabled;
}

export function normalizePersistedState(raw: unknown): AppState {
  const initial = createInitialState();
  const parsed = (raw ?? {}) as Partial<AppState>;
  const { restoredApiConfig, restoredImageApiConfig, restoredVideoApiConfig, restoredTtsApiConfig, restoredMusicApiConfig } = restoreApiConfigs(parsed);

  // API settings are valid user state even before the first project exists.
  // Returning `initial` here used to discard freshly saved BYOK credentials on
  // the next reload whenever the workspace still had zero projects.
  if (!Array.isArray(parsed.projects) || parsed.projects.length === 0) {
    return {
      ...initial,
      globalTaskSettings: normalizeGlobalTaskSettings(parsed.globalTaskSettings),
      apiConfig: restoredApiConfig,
      imageApiConfig: restoredImageApiConfig,
      videoApiConfig: restoredVideoApiConfig,
      ttsApiConfig: restoredTtsApiConfig,
      musicApiConfig: restoredMusicApiConfig,
    };
  }

  return {
    ...initial,
    projects: (parsed.projects ?? []).map((p) => {
      const storedChapters = p.chapters ?? [];
      const seriesPlan = normalizeStoredSeriesPlan(p.seriesPlan);
      const projectStyle = (
        p.styleConfig?.trim()
        || storedChapters.find((chapter) => chapter.analysis?.styleConfig?.trim())?.analysis?.styleConfig?.trim()
        || seriesPlan?.styleConfig?.trim()
        || ''
      );
      const projectStoryboardBoardMode = normalizeStoryboardBoardMode(storedChapters[0]?.storyboardBoardMode);
      const projectSmartPanelCountPreference: SmartStoryboardPanelCountPreference = normalizeSmartStoryboardPanelCountPreference(
        storedChapters[0]?.storyboardBoardSmartPanelCount,
      );
      const projectSmartDurationCompressionEnabled = storedChapters[0]?.storyboardBoardSmartDurationCompressionEnabled !== false;
      const projectStoryboardCameraSegmentCount: StoryboardCameraSegmentPreference = normalizeStoryboardCameraSegmentPreference(
        storedChapters[0]?.storyboardCameraSegmentCount,
      );
      return {
      ...p,
      styleConfig: projectStyle,
      seriesPlan,
      step3Settings: normalizeStep3Settings(p.step3Settings),
      characterProfiles: p.characterProfiles ?? [],
      characterVoiceReferences: Array.isArray(p.characterVoiceReferences) ? p.characterVoiceReferences : [],
      propTracking: (p.propTracking ?? []).map((prop) => ({
        ...prop,
        needsTracking: prop.needsTracking ?? true,
      })),
      chapters: storedChapters.map((c) => {
        const applyGeneratedPropDefaults = c.analysisPropDefaultPolicyVersion !== PROP_DEFAULT_POLICY_VERSION;
        const normalizedAnalysis = normalizeAnalysisForStorage(c.analysis ?? null, { applyGeneratedPropDefaults });
        const analysis = normalizedAnalysis && projectStyle
          ? { ...normalizedAnalysis, styleConfig: projectStyle }
          : normalizedAnalysis;
        const storyboards = (c.storyboards ?? []).map((sb) => {
          const compactVideoPromptMode = sb.compactVideoPromptMode ?? (sb.compactVideoPrompt ? 'compact' : undefined);
          const storyboard = normalizeStoredStoryboardAssetBindings({
            ...sb,
            step4OutputMode: normalizeStep4OutputMode(sb.step4OutputMode),
            generatedStep4OutputMode: normalizeOptionalStep4OutputMode(sb.generatedStep4OutputMode),
            storyboardBoardStyle: normalizeStoryboardBoardStyle(sb.storyboardBoardStyle),
            useStoryboardBoardReference: sb.useStoryboardBoardReference ?? false,
            useCompactVideoPrompt: compactVideoPromptMode === 'desensitized'
              ? sb.useCompactVideoPrompt ?? false
              : false,
            compactVideoPrompt: sb.compactVideoPrompt ?? '',
            compactVideoPromptMode,
            compactVideoPromptStatus: sb.compactVideoPromptStatus ?? 'idle',
            compactVideoPromptError: sb.compactVideoPromptError,
            compactVideoPromptSourcePrompt: sb.compactVideoPromptSourcePrompt ?? '',
            compactVideoPromptUpdatedAt: sb.compactVideoPromptUpdatedAt,
            videoSubmitPromptOverride: sb.videoSubmitPromptOverride ?? '',
            videoSubmitPromptOverrideSourcePrompt: sb.videoSubmitPromptOverrideSourcePrompt ?? '',
            videoSubmitPromptOverrideUpdatedAt: sb.videoSubmitPromptOverrideUpdatedAt,
            seedanceFinalVideoPrompt: sb.seedanceFinalVideoPrompt ?? '',
            seedanceFinalVideoPromptStatus: sb.seedanceFinalVideoPromptStatus ?? 'idle',
            seedanceFinalVideoPromptError: sb.seedanceFinalVideoPromptError,
            seedanceFinalVideoPromptSourceSnapshot: sb.seedanceFinalVideoPromptSourceSnapshot ?? '',
            seedanceFinalVideoPromptUpdatedAt: sb.seedanceFinalVideoPromptUpdatedAt,
            sourceExcerpt: sb.sourceExcerpt ?? '',
            sourceExcerptSummary: sb.sourceExcerptSummary ?? '',
            nextStoryboardSummary: sb.nextStoryboardSummary ?? '',
            sceneBlueprint: sb.sceneBlueprint ?? null,
            choreography: sb.choreography ?? null,
            videoImageRefs: Array.isArray(sb.videoImageRefs) ? sb.videoImageRefs : undefined,
            spatialBlocking: sb.spatialBlocking,
            continuityInput: sb.continuityInput,
            continuityOutput: sb.continuityOutput,
            isStale: sb.isStale ?? false,
            referenceVideo: sb.referenceVideo
              ? {
                  urls: Array.isArray(sb.referenceVideo.urls)
                    ? sb.referenceVideo.urls.map((url) => String(url).trim()).filter(Boolean).slice(0, 3)
                    : [],
                  note: sb.referenceVideo.note,
                }
              : undefined,
            storyboardBoard: normalizeStoryboardBoardState(sb.storyboardBoard),
            scenePositionBoard: normalizeScenePositionBoardState(sb.scenePositionBoard, sb.storyboard.scene),
          } as StoryboardState, p.assetLibrary);
          return recoverInterruptedStoredStoryboard(normalizeStoredStoryboardSelfCheck(storyboard, restoredVideoApiConfig.videoRatio));
        });
        return {
          ...c,
          analysis,
          analysisPropDefaultPolicyVersion: analysis ? PROP_DEFAULT_POLICY_VERSION : c.analysisPropDefaultPolicyVersion,
          sceneSpatialMasters: normalizeSceneSpatialMasters(c.sceneSpatialMasters),
          step4OutputMode: normalizeStep4OutputMode(c.step4OutputMode),
          storyboardBoardMode: projectStoryboardBoardMode,
          storyboardBoardSmartPanelCount: projectSmartPanelCountPreference,
          storyboardBoardSmartDurationCompressionEnabled: projectSmartDurationCompressionEnabled,
          storyboardCameraSegmentCount: projectStoryboardCameraSegmentCount,
          storyboardBoardStyle: normalizeStoryboardBoardStyle(c.storyboardBoardStyle),
          storyboardDirectorRunMode: normalizeStoryboardDirectorRunMode(c.storyboardDirectorRunMode),
          episodeShotSheet: c.episodeShotSheet
            ? {
                updatedAt: Number(c.episodeShotSheet.updatedAt) || Date.now(),
                segments: Array.isArray(c.episodeShotSheet.segments)
                  ? c.episodeShotSheet.segments.map((segment) => ({
                      storyboardIndex: Number(segment.storyboardIndex) || 0,
                      storyFunction: String(segment.storyFunction ?? ''),
                      continuityIn: String(segment.continuityIn ?? ''),
                      continuityOut: String(segment.continuityOut ?? ''),
                      characterState: String(segment.characterState ?? ''),
                    }))
                  : [],
              }
          : undefined,
          storyboards,
          autoGenerate: normalizeStoredAutoGenerate(c.autoGenerate, storyboards),
          step1Task: normalizeStoredStep1Task(c.step1Task),
          step3Task: normalizeStoredStep3Task(c.step3Task),
          past: [],
          future: [],
        };
      }),
      };
    }),
    currentProjectId: parsed.currentProjectId ?? null,
    globalTasks: normalizeStoredGlobalTasks(parsed.globalTasks, parsed.projects),
    globalTaskSettings: normalizeGlobalTaskSettings(parsed.globalTaskSettings),
    apiConfig: restoredApiConfig,
    imageApiConfig: restoredImageApiConfig,
    videoApiConfig: restoredVideoApiConfig,
    ttsApiConfig: restoredTtsApiConfig,
    musicApiConfig: restoredMusicApiConfig,
  };
}

function applyImageSizeDefaultsMigration(state: AppState): AppState {
  try {
    if (localStorage.getItem(IMAGE_SIZE_DEFAULTS_MIGRATION_KEY)) return state;
    localStorage.setItem(IMAGE_SIZE_DEFAULTS_MIGRATION_KEY, '1');
  } catch {
    return state;
  }

  let changed = false;
  const imageApiConfig = { ...state.imageApiConfig };
  const globalTaskSettings = { ...state.globalTaskSettings };

  if (imageApiConfig.defaultImageSize === '2K') {
    imageApiConfig.defaultImageSize = '1K';
    changed = true;
  }

  if (
    globalTaskSettings.step4StoryboardImageSize !== '1K'
    && globalTaskSettings.step4StoryboardImageSize !== '2K'
    && globalTaskSettings.step4StoryboardImageSize !== '4K'
  ) {
    globalTaskSettings.step4StoryboardImageSize = '2K';
    changed = true;
  }

  return changed
    ? { ...state, imageApiConfig, globalTaskSettings }
    : state;
}

export function loadState(): AppState {
  const initial = createInitialState();

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return migrateLegacyState() ?? normalizePersistedState(initial);
    const parsed = JSON.parse(saved) as Partial<AppState>;
    return applyImageSizeDefaultsMigration(normalizePersistedState(parsed));
  } catch {
    return migrateLegacyState() ?? normalizePersistedState(initial);
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeStateForPersistence(state)));
    // 同步写一份 drama-api-config，供 ApiSettingsModal 等旧入口兼容读取
    localStorage.setItem(
      API_CONFIG_KEY,
      JSON.stringify({ llm: state.apiConfig, image: state.imageApiConfig, video: state.videoApiConfig, tts: state.ttsApiConfig, music: state.musicApiConfig }),
    );
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[storage] 保存到 localStorage 失败，可能是数据过大或浏览器配额不足', err instanceof Error ? err.message : String(err));
  }
}

/** TtsPanel 仍会调用这个函数，实际不再单独持久化 TTS API Key */
export function saveTtsApiKey(_key: string): void {
  void _key;
  // 这里保留空实现，避免旧调用路径继续写入 mimo-tts-api-key；改由 store persist 统一管理
  // 所有 API 配置都通过统一的 API 设置面板维护
  // TtsPanel 只需要 dispatch SET_TTS_API_CONFIG
}

export { STORAGE_KEY, API_CONFIG_KEY, TTS_KEY };
