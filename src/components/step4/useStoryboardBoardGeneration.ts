import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ApiConfig,
  SmartStoryboardPanelCountPreference,
  StoryboardBoardDirectorBrief,
  StoryboardBoardMode,
  StoryboardBoardPlan,
  StoryboardBoardStyle,
  StoryboardBoardVariantState,
  StoryboardDirectorRunMode,
  StoryboardSequenceContinuityContext,
  StoryboardState,
  ImageReference,
} from '@/types';
import { useCurrentProject } from '@/stores/projectStore';
import { bffChatCompleteStream } from '@/lib/bff-client';
import { deleteBlob, saveBlob } from '@/lib/imageStore';
import { loadPreferredAssetBlob } from '@/lib/assetImageVariants';
import { loadCloudBackedBlob } from '@/lib/cloudBlobResolver';
import { generateImage, hasEffectiveImageApiKey, normalizeImageSizeForConfig } from '@/lib/imageApiClient';
import { includesAnyTextVariant } from '@/lib/mojibake';
import {
  buildStoryboardBoardPrompt,
  sortStoryboardBoardReferencesByPlanPriority,
  type StoryboardBoardReference,
} from './storyboardBoardPrompt';
import {
  buildStoryboardActionDirectorRequest,
  buildStoryboardBoardFormatRepairRequest,
  buildStoryboardDirectorBriefRequest,
  buildFallbackStoryboardBoardPlan,
  buildStoryboardBoardQualityRepairRequest,
  buildStoryboardBoardPlanRequest,
  getStoryboardBoardPlanTemplateType,
  parseStoryboardDirectorBrief,
  parseStoryboardBoardPlan,
  STORYBOARD_ACTION_DIRECTOR_TEMPLATE_TYPE,
  STORYBOARD_DIRECTOR_BRIEF_TEMPLATE_TYPE,
} from './storyboardBoardPlanning';
import { repairStoryboardBoardTextBlob } from './storyboardBoardTextRepair';
import {
  composeStoryboardBoardBlob,
  isComposableStoryboardBoardMode,
} from './storyboardBoardComposer';
import { getStoryboardBoardModeSpec, isShotPlanBoardMode, isSmartShotPlanBoardMode } from './storyboardBoardMode';
import {
  buildStoryboardBoardQualityRepairHint,
  evaluateStoryboardBoardQuality,
  getStoryboardBoardQualityBlockingChecks,
  summarizeStoryboardBoardQualityWarnings,
  type StoryboardBoardQualityReport,
} from './storyboardBoardQuality';
import { buildEpisodeShotSheet, getEpisodeShotSheetSegment } from './episodeShotSheet';
import { getFrameAspectRatio, normalizeFrameRatio, type FrameRatio } from '@/lib/frameRatio';
import { resolveStoryboardProjectVisualStyle } from '@/lib/projectVisualStyle';
import { DEFAULT_STORYBOARD_DIRECTOR_RUN_MODE } from '@/lib/storage';
import { getLockedSmartStoryboardPanelCount, normalizeSmartStoryboardPanelCountPreference } from '@/lib/smartStoryboardPanelCount';
import { resolveStoryboardCameraSegmentCount } from '@/lib/storyboardCameraSegments';
import {
  formatStoryboardBoardReferenceLabel,
  resolveStoryboardBoardReferences,
  resolveStoryboardImageRefs,
  type ResolvedStoryboardBoardReference,
} from './storyboardReferenceResolver';
import {
  createEmptyStoryboardBoardVariant,
  DEFAULT_STORYBOARD_BOARD_MODE,
  DEFAULT_STORYBOARD_BOARD_IMAGE_SIZE,
  getStoryboardBoardSelectedMode,
  getStoryboardBoardVariant,
  isStoryboardBoardImageFresh,
  isStoryboardBoardPlanFresh,
  mergeStoryboardBoardVariant,
  normalizeStoryboardBoardState,
  replaceStoryboardBoardVariant,
} from '@/lib/storyboardBoardState';
import {
  buildSeedanceFinalPromptSourceSnapshot,
  isSeedanceFinalVideoPromptGeneratingStale,
  getSeedanceFinalVideoPromptState,
  requestSeedanceFinalVideoPromptStream,
  SEEDANCE_FINAL_VIDEO_PROMPT_NO_OUTPUT_TIMEOUT_MESSAGE,
  SEEDANCE_FINAL_VIDEO_PROMPT_STALE_MS,
  type SeedanceFinalPromptReference,
  type SeedanceFinalVideoPromptStreamCallbacks,
} from './seedanceFinalPrompt';
import {
  requestStoryboardPlanningTextStream,
  type StoryboardPlanningStreamCallbacks,
} from './storyboardPlanningStream';
import { buildStoryboardSequenceContinuityContext } from './storyboardSequenceContinuity';
import { isRecoverableInterruptedStoryboard } from './recoverySignature';
import { getSeedanceFinalPromptDisabledReason } from './storyboardBoardFinalPromptGate';
import { buildStoryboardReferenceReadingContract } from './storyboardReferenceReadingContract';
import {
  beginStoryboardBoardImageTiming,
  beginStoryboardBoardPlanTiming,
  beginStoryboardBoardSeedanceTiming,
  completeStoryboardBoardImageTiming,
  completeStoryboardBoardPlanTiming,
  completeStoryboardBoardSeedanceTiming,
  failStoryboardBoardImageTiming,
  failStoryboardBoardPlanTiming,
  failStoryboardBoardSeedanceTiming,
} from './storyboardBoardTiming';
import {
  formatStoryboardBoardImageRecoverableFailure,
  formatStoryboardBoardImageRetryNotice,
  getStoryboardBoardImageRetryCount,
  runStoryboardBoardImageWithRetry,
  STORYBOARD_BOARD_IMAGE_RETRY_DELAYS_MS,
} from './storyboardBoardImageRetry';
import {
  STORYBOARD_ACTION_DIRECTOR_LLM_PARAMS,
  STORYBOARD_BOARD_PLAN_LLM_PARAMS,
  STORYBOARD_BOARD_PLAN_REPAIR_LLM_PARAMS,
  STORYBOARD_COMPACT_BOARD_PLAN_LLM_PARAMS,
  STORYBOARD_DIRECTOR_BRIEF_LLM_PARAMS,
  STORYBOARD_DIRECTOR_BRIEF_REPAIR_LLM_PARAMS,
  type StoryboardLlmParams,
} from './storyboardLlmParams';
import { resolveStoryboardVoiceReferences } from '@/lib/characterVoiceReferences';
import {
  applySmartDurationToDirectorBrief,
  applySmartDurationToStoryboardForPrompt,
  buildSmartStoryboardDurationRejudgeHint,
  buildSmartStoryboardDurationUpdates,
  resolveSmartStoryboardDurationDecision,
} from './smartStoryboardDuration';

const STORYBOARD_BOARD_IMAGE_TIMEOUT_MS = 20 * 60 * 1000;
const STORYBOARD_BOARD_IMAGE_TIMEOUT_MESSAGE = '详细故事板生成超过 20 分钟未返回，已停止等待。建议稍后重试或减少参考图后再生成。';
const STORYBOARD_BOARD_SOURCE_VERSION = 'direct-bmx-shot-sheet-v6-start-end-bridge';

function isAbortLikeError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && (error.name === 'AbortError' || error.message === '请求已取消'));
}

function throwIfAbortLikeError(error: unknown): void {
  if (isAbortLikeError(error)) throw error;
}

export interface StoryboardBoardConditionCheck {
  id: string;
  label: string;
  detail: string;
  passed: boolean;
  blocking: boolean;
}

interface UseStoryboardBoardGenerationOptions {
  isCurrentStoryboardGenerationActive?: boolean;
}

export function buildStoryboardBoardSourceSnapshot(
  storyboard: StoryboardState,
  frameRatio?: string,
  sequenceContinuityContext?: StoryboardSequenceContinuityContext,
  projectVisualStyle?: string,
  options?: {
    smartPanelCountPreference?: SmartStoryboardPanelCountPreference;
    smartDurationCompressionEnabled?: boolean;
    cameraSegmentCount?: unknown;
  },
): string {
  const smartPanelCountPreference = normalizeSmartStoryboardPanelCountPreference(options?.smartPanelCountPreference);
  const smartPanelCountSnapshot = smartPanelCountPreference === 'auto' ? undefined : smartPanelCountPreference;
  const smartDurationCompressionSnapshot = options?.smartDurationCompressionEnabled === false ? false : undefined;
  const cameraSegmentCountSnapshot = resolveStoryboardCameraSegmentCount(options?.cameraSegmentCount, storyboard);
  if (storyboard.prompt?.rawText) {
    return JSON.stringify({
      storyboardBoardSourceVersion: STORYBOARD_BOARD_SOURCE_VERSION,
      frameRatio: frameRatio ? normalizeFrameRatio(frameRatio) : undefined,
      projectVisualStyle,
      ...(smartPanelCountSnapshot ? { smartPanelCountPreference: smartPanelCountSnapshot } : {}),
      ...(smartDurationCompressionSnapshot === false ? { smartDurationCompressionEnabled: false } : {}),
      cameraSegmentCount: cameraSegmentCountSnapshot,
      prompt: storyboard.prompt.rawText,
      sequenceContinuitySourceSignature: sequenceContinuityContext?.sourceSignature,
    });
  }
  return JSON.stringify({
    storyboardBoardSourceVersion: STORYBOARD_BOARD_SOURCE_VERSION,
    frameRatio: frameRatio ? normalizeFrameRatio(frameRatio) : undefined,
    projectVisualStyle,
    ...(smartPanelCountSnapshot ? { smartPanelCountPreference: smartPanelCountSnapshot } : {}),
    ...(smartDurationCompressionSnapshot === false ? { smartDurationCompressionEnabled: false } : {}),
    cameraSegmentCount: cameraSegmentCountSnapshot,
    sequenceContinuitySourceSignature: sequenceContinuityContext?.sourceSignature,
    mode: storyboard.generatedStep4OutputMode ?? storyboard.step4OutputMode ?? 'prompt',
    storyboard: storyboard.storyboard,
    correctedScript: storyboard.correctedScript,
    sceneBlueprint: storyboard.sceneBlueprint,
    choreography: storyboard.choreography,
    imageRefs: storyboard.imageRefs?.map((ref) => ({
      refId: ref.refId,
      type: ref.type,
      name: ref.name,
      assetId: ref.assetId,
      trackingId: ref.trackingId,
      variantKey: ref.variantKey,
      outfitSeq: ref.outfitSeq,
    })),
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  let timeoutId = 0;
  return new Promise<T>((resolve, reject) => {
    timeoutId = window.setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, timeoutMs);
    promise
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timeoutId));
  });
}

function getBoardModeConfig(mode: StoryboardBoardMode) {
  const modeSpec = getStoryboardBoardModeSpec(mode);
  const targetFrameRatio: FrameRatio = isShotPlanBoardMode(mode)
    ? '16:9'
    : mode === 'nine-landscape'
      ? '16:9'
      : '9:16';
  return {
    mode,
    layout: modeSpec.layout,
    panelCount: modeSpec.panelCount,
    frameRatio: targetFrameRatio,
    aspectRatio: isShotPlanBoardMode(mode)
      ? getFrameAspectRatio(targetFrameRatio)
      : mode === 'nine-portrait' ? 'PORTRAIT' as const : 'LANDSCAPE' as const,
    label: mode === 'shot-plan-landscape'
      ? `横向 15格 Shot Sheet ${targetFrameRatio}`
      : isSmartShotPlanBoardMode(mode)
        ? `智能故事板 ${targetFrameRatio}`
        : modeSpec.modeLabel,
  };
}

function getReferencePriority(type: StoryboardBoardReference['type']) {
  switch (type) {
    case 'scene':
      return 0;
    case 'character':
      return 1;
    case 'prop':
      return 2;
  }
}

function normalizeRefNumber(refId: string) {
  const match = refId.match(/\d+/);
  return match ? match[0] : refId.replace(/[()（）【】\s图片]/g, '');
}

function buildBoardProjectVisualStyle(
  storyboard: StoryboardState,
  plan?: StoryboardBoardPlan,
  styleConfig?: string,
) {
  return resolveStoryboardProjectVisualStyle(storyboard, plan, styleConfig).resolvedVisualStyle;
}

function buildReferenceInputLabel(
  reference: StoryboardBoardReference,
  index: number,
  projectVisualStyle: string,
) {
  const refNumber = normalizeRefNumber(reference.refId) || String(index + 1);
  const contract = buildStoryboardReferenceReadingContract(reference);
  const styleTransferGuard = `风格转换：只读取身份锚点、服装轮廓、体态比例、空间结构或道具形状；必须重绘为当前项目风格：${projectVisualStyle}；不得固定成任何未在当前项目风格中声明的全局风格。`;
  const wardrobeSafety = '服装边界：不得露乳沟、不得胸部裸露或胸部暴露漂移；允许符合项目风格与角色设定的性感、华丽或擦边表达。';
  if (reference.type === 'character') {
    return [
      `参考图片 ${refNumber} / ${reference.refId}`,
      `类型：角色 ${reference.name}`,
      `锁定身份：${reference.name} = ${reference.refId}`,
      `读图契约：${contract.readFor}`,
      `禁止用途：${contract.doNotUseFor}`,
      styleTransferGuard,
      wardrobeSafety,
    ].join('\n');
  }

  return [
    `参考图片 ${refNumber} / ${reference.refId}`,
    `类型：${formatStoryboardBoardReferenceLabel(reference)}`,
    `读图契约：${contract.readFor}`,
    `禁止用途：${contract.doNotUseFor}`,
    styleTransferGuard,
  ].join('\n');
}

function requestSeedanceFinalPromptViaBffStream(
  requestPayload: string,
  requestOptions: { temperature: number; maxTokens: number; signal: AbortSignal },
  apiConfig: ApiConfig,
  frameRatio: string,
  streamCallbacks: SeedanceFinalVideoPromptStreamCallbacks,
  options: { disableBackgroundJob?: boolean; backgroundProgressMode?: 'detailed' | 'stage-only' } = {},
) {
  return new Promise<string>((resolve, reject) => {
    let streamedText = '';

    bffChatCompleteStream(
      {
        templateType: 'seedance_final_video_prompt',
        templateVars: { videoRatio: frameRatio },
        userMessages: [{ role: 'user', content: requestPayload }],
        apiConfig,
        temperature: requestOptions.temperature,
        maxTokens: requestOptions.maxTokens,
        reasoningEffort: 'high',
        disableBackgroundJob: options.disableBackgroundJob,
        backgroundProgressMode: options.backgroundProgressMode,
      },
      {
        onActivity: () => {
          streamCallbacks.onActivity?.();
        },
        onChunk: (delta) => {
          streamedText += delta;
          streamCallbacks.onChunk(delta);
        },
        onReplace: (fullText) => {
          streamedText = fullText;
          streamCallbacks.onReplace?.(fullText);
        },
        onDone: (fullText) => {
          resolve(fullText.trim() || streamedText);
        },
        onError: reject,
      },
      requestOptions.signal,
    );
  });
}

function requestStoryboardPlanningViaBffStream(
  requestPayload: string,
  requestOptions: StoryboardLlmParams & { signal: AbortSignal },
  apiConfig: ApiConfig,
  templateType: string,
  streamCallbacks: StoryboardPlanningStreamCallbacks,
  options: { disableBackgroundJob?: boolean; backgroundProgressMode?: 'detailed' | 'stage-only' } = {},
) {
  return new Promise<string>((resolve, reject) => {
    let streamedText = '';

    bffChatCompleteStream(
      {
        templateType,
        templateVars: {},
        userMessages: [{ role: 'user', content: requestPayload }],
        apiConfig,
        temperature: requestOptions.temperature,
        maxTokens: requestOptions.maxTokens,
        reasoningEffort: requestOptions.reasoningEffort,
        disableBackgroundJob: options.disableBackgroundJob,
        backgroundProgressMode: options.backgroundProgressMode,
      },
      {
        onActivity: () => {
          streamCallbacks.onActivity?.();
        },
        onChunk: (delta) => {
          streamedText += delta;
          streamCallbacks.onChunk(delta);
        },
        onReplace: (fullText) => {
          streamedText = fullText;
          streamCallbacks.onReplace?.(fullText);
        },
        onDone: (fullText) => {
          resolve(fullText.trim() || streamedText.trim());
        },
        onError: reject,
      },
      requestOptions.signal,
    );
  });
}

function downloadBlobFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function shouldRepairStoryboardBoardText(mode: StoryboardBoardMode, style: StoryboardBoardStyle) {
  return style === 'seedance-board' && (mode === 'nine-landscape' || mode === 'nine-portrait');
}

function normalizeStoryboardDirectorRunMode(mode?: StoryboardDirectorRunMode): StoryboardDirectorRunMode {
  if (mode === 'compact') return 'compact';
  if (mode === 'fast') return 'fast';
  return DEFAULT_STORYBOARD_DIRECTOR_RUN_MODE;
}

function shouldRunStoryboardActionDirector(mode: StoryboardDirectorRunMode): boolean {
  return mode === 'refine';
}

function isCompactStoryboardDirectorRunMode(mode: StoryboardDirectorRunMode): boolean {
  return mode === 'compact';
}

function withStoryboardDirectorRunModeSnapshot(
  snapshot: string,
  mode: StoryboardDirectorRunMode,
): string {
  return `${snapshot}\nstoryboardDirectorRunMode:${mode}`;
}

function sortResolvedReferencesByPlan(
  references: ResolvedStoryboardBoardReference[],
  plan: StoryboardBoardPlan,
) {
  const orderedRefIds = sortStoryboardBoardReferencesByPlanPriority(
    references.map(({ imageRef }) => imageRef),
    plan,
  ).map((reference) => reference.refId);
  const priorityMap = new Map(orderedRefIds.map((refId, index) => [refId, index]));

  return [...references].sort((left, right) => {
    const leftPriority = priorityMap.get(left.imageRef.refId) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = priorityMap.get(right.imageRef.refId) ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return getReferencePriority(left.imageRef.type) - getReferencePriority(right.imageRef.type);
  });
}

function buildVideoImageRefsFromOrderedReferences(
  orderedReferences: ResolvedStoryboardBoardReference[],
  sourceImageRefs: readonly ImageReference[],
): ImageReference[] {
  const sourceByRefId = new Map(sourceImageRefs.map((ref) => [ref.refId, ref]));
  return orderedReferences
    .map(({ imageRef }) => sourceByRefId.get(imageRef.refId))
    .filter((ref): ref is ImageReference => !!ref);
}

export function useStoryboardBoardGeneration(
  currentSb: StoryboardState,
  currentIndex: number,
  options: UseStoryboardBoardGenerationOptions = {},
) {
  const { state, dispatch, currentProject, currentChapter } = useCurrentProject();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [visualPreviewUrl, setVisualPreviewUrl] = useState<string | null>(null);
  const [planStreamText, setPlanStreamText] = useState('');
  const activeBoardImageControllersRef = useRef<Set<AbortController>>(new Set());
  const activeSeedanceFinalPromptControllersRef = useRef<Set<AbortController>>(new Set());
  const analysis = currentChapter?.analysis;
  const episodeShotSheet = useMemo(
    () => currentChapter?.episodeShotSheet ?? buildEpisodeShotSheet(currentChapter?.storyboards ?? []),
    [currentChapter?.episodeShotSheet, currentChapter?.storyboards],
  );
  const episodeShotSheetSegment = useMemo(
    () => getEpisodeShotSheetSegment(episodeShotSheet, currentIndex),
    [episodeShotSheet, currentIndex],
  );
  const nextEpisodeShotSheetSegment = useMemo(
    () => getEpisodeShotSheetSegment(episodeShotSheet, currentIndex + 1),
    [episodeShotSheet, currentIndex],
  );

  const abortBoardGenerationRequests = useCallback(() => {
    activeBoardImageControllersRef.current.forEach((controller) => controller.abort());
    activeBoardImageControllersRef.current.clear();
    activeSeedanceFinalPromptControllersRef.current.forEach((controller) => controller.abort());
    activeSeedanceFinalPromptControllersRef.current.clear();
  }, []);

  useEffect(() => () => {
    abortBoardGenerationRequests();
  }, [abortBoardGenerationRequests]);

  const boardContainer = useMemo(
    () => normalizeStoryboardBoardState(currentSb.storyboardBoard),
    [currentSb.storyboardBoard],
  );
  const preferredMode = currentChapter?.storyboardBoardMode ?? DEFAULT_STORYBOARD_BOARD_MODE;
  const smartPanelCountPreference = normalizeSmartStoryboardPanelCountPreference(currentChapter?.storyboardBoardSmartPanelCount);
  const lockedSmartPanelCount = getLockedSmartStoryboardPanelCount(smartPanelCountPreference);
  const smartDurationCompressionEnabled = currentChapter?.storyboardBoardSmartDurationCompressionEnabled !== false;
  const selectedMode = useMemo(
    () => preferredMode ?? (boardContainer ? getStoryboardBoardSelectedMode(boardContainer) : DEFAULT_STORYBOARD_BOARD_MODE),
    [boardContainer, preferredMode],
  );
  const rawBoardState = useMemo<StoryboardBoardVariantState | undefined>(
    () => getStoryboardBoardVariant(boardContainer, selectedMode),
    [boardContainer, selectedMode],
  );
  const modeConfig = useMemo(
    () => getBoardModeConfig(selectedMode),
    [selectedMode],
  );
  const storyboardBoardImageSize = normalizeImageSizeForConfig(
    state.imageApiConfig,
    state.globalTaskSettings?.step4StoryboardImageSize,
    DEFAULT_STORYBOARD_BOARD_IMAGE_SIZE,
  );
  const targetVideoFrameRatio = useMemo(
    () => normalizeFrameRatio(state.videoApiConfig.videoRatio),
    [state.videoApiConfig.videoRatio],
  );
  const isDirectorMode = (currentSb.generatedStep4OutputMode ?? currentSb.step4OutputMode) === 'storyboard-director';
  const storyboardDirectorRunMode = normalizeStoryboardDirectorRunMode(currentChapter?.storyboardDirectorRunMode);
  const directorScriptSource = useMemo(() => {
    if (!isDirectorMode) return currentSb.correctedScript;
    return [
      currentSb.correctedScript,
      currentSb.sourceExcerpt,
      currentSb.sourceExcerptSummary,
      currentSb.storyboard.scene,
      currentSb.storyboard.name,
    ].find((value) => value?.trim())?.trim() ?? '';
  }, [
    currentSb.correctedScript,
    currentSb.sourceExcerpt,
    currentSb.sourceExcerptSummary,
    currentSb.storyboard.scene,
    currentSb.storyboard.name,
    isDirectorMode,
  ]);
  const currentSbForPlanning = useMemo(
    () => (isDirectorMode && directorScriptSource && !currentSb.correctedScript
      ? { ...currentSb, correctedScript: directorScriptSource }
      : currentSb),
    [currentSb, directorScriptSource, isDirectorMode],
  );
  const cameraSegmentCount = resolveStoryboardCameraSegmentCount(currentChapter?.storyboardCameraSegmentCount, currentSbForPlanning);
  const sequenceContinuityContext = useMemo(
    () => buildStoryboardSequenceContinuityContext(
      currentChapter?.storyboards ?? [],
      currentIndex,
      episodeShotSheetSegment,
      modeConfig.mode,
      nextEpisodeShotSheetSegment,
    ),
    [currentChapter?.storyboards, currentIndex, episodeShotSheetSegment, modeConfig.mode, nextEpisodeShotSheetSegment],
  );
  const planProjectVisualStyle = useMemo(
    () => buildBoardProjectVisualStyle(currentSbForPlanning, undefined, analysis?.styleConfig),
    [analysis?.styleConfig, currentSbForPlanning],
  );
  const planSourceSnapshot = useMemo(
    () => withStoryboardDirectorRunModeSnapshot(
      buildStoryboardBoardSourceSnapshot(
        currentSbForPlanning,
        state.videoApiConfig.videoRatio,
        sequenceContinuityContext,
        planProjectVisualStyle,
        { smartPanelCountPreference, smartDurationCompressionEnabled, cameraSegmentCount },
      ),
      storyboardDirectorRunMode,
    ),
    [cameraSegmentCount, currentSbForPlanning, planProjectVisualStyle, sequenceContinuityContext, smartDurationCompressionEnabled, smartPanelCountPreference, state.videoApiConfig.videoRatio, storyboardDirectorRunMode],
  );
  const projectVisualStyle = useMemo(
    () => buildBoardProjectVisualStyle(currentSbForPlanning, rawBoardState?.plan, analysis?.styleConfig),
    [analysis?.styleConfig, currentSbForPlanning, rawBoardState?.plan],
  );
  const sourceSnapshot = useMemo(
    () => buildStoryboardBoardSourceSnapshot(
      currentSbForPlanning,
      state.videoApiConfig.videoRatio,
      sequenceContinuityContext,
      projectVisualStyle,
      { smartPanelCountPreference, smartDurationCompressionEnabled, cameraSegmentCount },
    ),
    [cameraSegmentCount, currentSbForPlanning, projectVisualStyle, sequenceContinuityContext, smartDurationCompressionEnabled, smartPanelCountPreference, state.videoApiConfig.videoRatio],
  );
  const hasPrompt = !!currentSb.prompt?.rawText;
  const hasDirectorScriptSource = isDirectorMode && !!directorScriptSource;
  const hasReusableBoardPlan = isDirectorMode && !!rawBoardState?.plan;
  const hasBoardSource = hasPrompt || hasDirectorScriptSource || hasReusableBoardPlan;
  const boardStyle: StoryboardBoardStyle = isDirectorMode ? 'seedance-board' : (currentSb.storyboardBoardStyle ?? 'seedance-board');
  const isStoryboardBusy = currentSb.status === 'checking'
    || currentSb.status === 'correcting'
    || currentSb.status === 'choreographing'
    || currentSb.status === 'choreo-checking'
    || currentSb.status === 'generating'
    || currentSb.status === 'self-checking';
  const hasLiveStoryboardBoardWork = rawBoardState?.status === 'generating'
    || rawBoardState?.planStatus === 'optimizing';
  const isRecoverableStoryboardBusy = isRecoverableInterruptedStoryboard(currentSb, {
    hasLiveGeneration: options.isCurrentStoryboardGenerationActive || hasLiveStoryboardBoardWork,
  });
  const isBlockingStoryboardBusy = isStoryboardBusy && !isRecoverableStoryboardBusy;

  const expectedImageRefs = useMemo(
    () => resolveStoryboardImageRefs(currentSb, analysis, currentProject?.assetLibrary, currentIndex, state.videoApiConfig.videoRatio),
    [analysis, currentIndex, currentProject?.assetLibrary, currentSb, state.videoApiConfig.videoRatio],
  );

  const referenceResolution = useMemo(
    () => resolveStoryboardBoardReferences(expectedImageRefs, currentProject?.assetLibrary),
    [currentProject?.assetLibrary, expectedImageRefs],
  );

  const baseUsedReferences = useMemo(
    () => [...referenceResolution.resolvedReferences].sort(
      (left, right) => getReferencePriority(left.imageRef.type) - getReferencePriority(right.imageRef.type),
    ),
    [referenceResolution.resolvedReferences],
  );

  const hardFreshnessReferenceAssetIds = useMemo(
    () => baseUsedReferences
      .filter(({ imageRef }) => imageRef.type === 'scene')
      .map(({ asset }) => asset.id),
    [baseUsedReferences],
  );
  const freshnessOptions = useMemo(() => ({
    allowStoredReferenceSuperset: true,
    ignoreSoftReferenceAssetChanges: true,
    allowLegacySoftStale: true,
  }), []);

  const hasFreshPlan = useMemo(
    () => isStoryboardBoardPlanFresh(rawBoardState, planSourceSnapshot, hardFreshnessReferenceAssetIds, freshnessOptions),
    [freshnessOptions, hardFreshnessReferenceAssetIds, planSourceSnapshot, rawBoardState],
  );

  const currentImageSizeMatches = (rawBoardState?.imageSize ?? DEFAULT_STORYBOARD_BOARD_IMAGE_SIZE) === storyboardBoardImageSize;
  const hasFreshImage = useMemo(
    () => currentImageSizeMatches && isStoryboardBoardImageFresh(rawBoardState, sourceSnapshot, hardFreshnessReferenceAssetIds, freshnessOptions),
    [currentImageSizeMatches, freshnessOptions, hardFreshnessReferenceAssetIds, rawBoardState, sourceSnapshot],
  );
  const hasUsableDirectorImage = !!rawBoardState?.blobKey || !!rawBoardState?.visualBoardBlobKey;

  const boardState = useMemo<StoryboardBoardVariantState | undefined>(() => {
    if (!rawBoardState) return undefined;
    return {
      ...rawBoardState,
      isStale: rawBoardState.blobKey ? !hasFreshImage : rawBoardState.isStale ?? false,
      planIsStale: rawBoardState.plan ? !hasFreshPlan : rawBoardState.planIsStale ?? false,
    };
  }, [hasFreshImage, hasFreshPlan, rawBoardState]);

  const usedReferences = useMemo(
    () => (hasFreshPlan && rawBoardState?.plan
      ? sortResolvedReferencesByPlan(baseUsedReferences, rawBoardState.plan)
      : baseUsedReferences),
    [baseUsedReferences, hasFreshPlan, rawBoardState],
  );

  const boardPromptPreview = useMemo(() => {
    if (!boardState?.plan) return '';
    const orderedReferences = sortResolvedReferencesByPlan(baseUsedReferences, boardState.plan);
    const smartDurationDecision = resolveSmartStoryboardDurationDecision(
      modeConfig.mode,
      currentSb,
      boardState.plan.directorBrief,
      lockedSmartPanelCount,
      { durationCompressionEnabled: smartDurationCompressionEnabled },
    );
    const promptStoryboard = applySmartDurationToStoryboardForPrompt(currentSb, smartDurationDecision);
    return buildStoryboardBoardPrompt(
      promptStoryboard,
      orderedReferences.map(({ imageRef }) => imageRef),
      modeConfig.mode,
      boardState.plan,
      boardStyle,
      { frameRatio: targetVideoFrameRatio, sequenceContinuityContext, projectVisualStyle },
    );
  }, [baseUsedReferences, boardState, boardStyle, currentSb, lockedSmartPanelCount, modeConfig.mode, projectVisualStyle, sequenceContinuityContext, smartDurationCompressionEnabled, targetVideoFrameRatio]);

  const seedanceFinalPromptReferences = useMemo<SeedanceFinalPromptReference[]>(() => {
    const orderedReferences = boardState?.plan
      ? sortResolvedReferencesByPlan(baseUsedReferences, boardState.plan)
      : baseUsedReferences;
    return orderedReferences.map(({ imageRef, asset }) => ({
      refId: imageRef.refId,
      type: imageRef.type,
      name: imageRef.name,
      assetId: asset.id,
      trackingId: imageRef.trackingId,
      variantKey: imageRef.variantKey,
      outfitSeq: imageRef.outfitSeq,
      concept: imageRef.concept,
      assetSource: asset.source,
      isNoFaceCharacterVisual: imageRef.isNoFaceCharacterVisual,
    }));
  }, [baseUsedReferences, boardState]);

  const seedanceFinalPromptVoiceReferences = useMemo(
    () => resolveStoryboardVoiceReferences({
      storyboard: currentSb,
      project: currentProject,
      videoConfig: state.videoApiConfig,
    }),
    [currentProject, currentSb, state.videoApiConfig],
  );

  const seedanceFinalPromptSourceSnapshot = useMemo(
    () => buildSeedanceFinalPromptSourceSnapshot({
      storyboard: applySmartDurationToStoryboardForPrompt(
        currentSb,
        resolveSmartStoryboardDurationDecision(
          modeConfig.mode,
          currentSb,
          boardState?.plan?.directorBrief,
          lockedSmartPanelCount,
          { durationCompressionEnabled: smartDurationCompressionEnabled },
        ),
      ),
      boardPlan: boardState?.plan,
      references: seedanceFinalPromptReferences,
      voiceReferences: seedanceFinalPromptVoiceReferences,
      mode: modeConfig.mode,
      frameRatio: targetVideoFrameRatio,
      projectVisualStyle,
      cameraSegmentCount,
    }),
    [boardState?.plan, currentSb, lockedSmartPanelCount, modeConfig.mode, projectVisualStyle, seedanceFinalPromptReferences, seedanceFinalPromptVoiceReferences, smartDurationCompressionEnabled, targetVideoFrameRatio],
  );

  const seedanceFinalPromptState = useMemo(
    () => getSeedanceFinalVideoPromptState(currentSb, seedanceFinalPromptSourceSnapshot),
    [currentSb, seedanceFinalPromptSourceSnapshot],
  );

  useEffect(() => {
    if (boardState?.status !== 'generating') return undefined;
    const targetProjectId = currentProject?.id;
    const targetChapterId = currentChapter?.id;
    if (!targetProjectId || !targetChapterId) return undefined;

    const startedAt = boardState.generationTiming?.lastAttemptStartedAt
      ?? boardState.generationTiming?.imageStartedAt
      ?? boardState.startedAt;
    const elapsedMs = typeof startedAt === 'number' && Number.isFinite(startedAt)
      ? Math.max(0, Date.now() - startedAt)
      : STORYBOARD_BOARD_IMAGE_TIMEOUT_MS;
    const delayMs = Math.max(0, STORYBOARD_BOARD_IMAGE_TIMEOUT_MS - elapsedMs + 250);
    const timeoutId = window.setTimeout(() => {
      dispatch({
        type: 'UPDATE_STORYBOARD',
        index: currentIndex,
        projectId: targetProjectId,
        chapterId: targetChapterId,
        updates: {
          ...(isDirectorMode
            ? {
                status: 'error' as const,
                error: STORYBOARD_BOARD_IMAGE_TIMEOUT_MESSAGE,
                step4StartedAt: undefined,
              }
            : {}),
          storyboardBoard: mergeStoryboardBoardVariant(boardContainer, modeConfig.mode, {
            status: 'failed',
            startedAt: undefined,
            error: STORYBOARD_BOARD_IMAGE_TIMEOUT_MESSAGE,
            isStale: boardState.isStale ?? false,
            generationTiming: failStoryboardBoardImageTiming(
              boardState.generationTiming,
              STORYBOARD_BOARD_IMAGE_TIMEOUT_MESSAGE,
              Date.now(),
              true,
              startedAt,
            ),
          }),
        },
      });
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    boardContainer,
    boardState,
    currentChapter?.id,
    currentIndex,
    currentProject?.id,
    dispatch,
    isDirectorMode,
    modeConfig.mode,
  ]);

  useEffect(() => {
    if (currentSb.seedanceFinalVideoPromptStatus !== 'generating') return undefined;
    const targetProjectId = currentProject?.id;
    const targetChapterId = currentChapter?.id;
    if (!targetProjectId || !targetChapterId) return undefined;

    const updatedAt = currentSb.seedanceFinalVideoPromptUpdatedAt;
    const elapsedMs = typeof updatedAt === 'number' && Number.isFinite(updatedAt)
      ? Math.max(0, Date.now() - updatedAt)
      : SEEDANCE_FINAL_VIDEO_PROMPT_STALE_MS;
    const delayMs = Math.max(0, SEEDANCE_FINAL_VIDEO_PROMPT_STALE_MS - elapsedMs + 250);
    const timeoutId = window.setTimeout(() => {
      if (!isSeedanceFinalVideoPromptGeneratingStale(currentSb, Date.now())) return;
      dispatch({
        type: 'UPDATE_STORYBOARD',
        index: currentIndex,
        projectId: targetProjectId,
        chapterId: targetChapterId,
        updates: {
          seedanceFinalVideoPromptStatus: 'failed',
          seedanceFinalVideoPromptError: SEEDANCE_FINAL_VIDEO_PROMPT_NO_OUTPUT_TIMEOUT_MESSAGE,
          seedanceFinalVideoPromptSourceSnapshot: seedanceFinalPromptSourceSnapshot,
          seedanceFinalVideoPromptUpdatedAt: Date.now(),
          storyboardBoard: mergeStoryboardBoardVariant(boardContainer, modeConfig.mode, {
            generationTiming: failStoryboardBoardSeedanceTiming(
              boardState?.generationTiming,
              SEEDANCE_FINAL_VIDEO_PROMPT_NO_OUTPUT_TIMEOUT_MESSAGE,
            ),
          }),
        },
      });
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    boardContainer,
    boardState?.generationTiming,
    currentChapter?.id,
    currentIndex,
    currentProject?.id,
    currentSb,
    dispatch,
    modeConfig.mode,
    seedanceFinalPromptSourceSnapshot,
  ]);

  const boardPlanPreview = useMemo(
    () => {
      if (boardState?.planStatus === 'optimizing' && planStreamText.trim()) {
        return planStreamText;
      }
      return boardState?.plan ? JSON.stringify(boardState.plan, null, 2) : '';
    },
    [boardState?.plan, boardState?.planStatus, planStreamText],
  );

  const missingReferenceLabels = useMemo(
    () => Array.from(
      new Set(referenceResolution.missingReferences.map(({ imageRef }) => formatStoryboardBoardReferenceLabel(imageRef))),
    ),
    [referenceResolution.missingReferences],
  );

  const missingReferenceSummary = useMemo(() => {
    if (missingReferenceLabels.length === 0) return '';
    if (missingReferenceLabels.length <= 4) return missingReferenceLabels.join('、');
    return `${missingReferenceLabels.slice(0, 4).join('、')} 等 ${missingReferenceLabels.length} 项`;
  }, [missingReferenceLabels]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    async function loadPreview() {
      if (!boardState?.blobKey) {
        setPreviewUrl(null);
        return;
      }

      try {
        const blob = await loadCloudBackedBlob(boardState.blobKey, currentProject?.id);
        if (!blob || cancelled) {
          if (!cancelled) setPreviewUrl(null);
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setPreviewUrl(objectUrl);
      } catch {
        if (!cancelled) setPreviewUrl(null);
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [boardState?.blobKey, currentProject?.id]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    async function loadPreview() {
      if (!boardState?.visualBoardBlobKey) {
        setVisualPreviewUrl(null);
        return;
      }

      try {
        const blob = await loadCloudBackedBlob(boardState.visualBoardBlobKey, currentProject?.id);
        if (!blob || cancelled) {
          if (!cancelled) setVisualPreviewUrl(null);
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setVisualPreviewUrl(objectUrl);
      } catch {
        if (!cancelled) setVisualPreviewUrl(null);
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [boardState?.visualBoardBlobKey, currentProject?.id]);

  const sourceDisabledReason = useMemo(() => {
    if (!hasBoardSource) return isDirectorMode ? '当前分镜缺少剧本片段或导演规划，请先重新生成当前镜故事板' : '请先生成当前分镜的视频提示词';
    if (isBlockingStoryboardBusy) return isDirectorMode ? '当前分镜正在生成故事板，请等完成后再操作' : '当前分镜正在生成提示词，请等完成后再生成详细故事板';
    if (currentSb.isStale && !(isDirectorMode && hasFreshPlan)) {
      return isDirectorMode ? '当前故事板已失效，请先重新生成当前镜故事板' : '当前提示词已失效，请先重新生成分镜提示词';
    }
    return null;
  }, [
    currentSb.isStale,
    hasFreshPlan,
    hasBoardSource,
    isBlockingStoryboardBusy,
    isDirectorMode,
  ]);

  const referenceDisabledReason = useMemo(() => {
    if (expectedImageRefs.length === 0) return '当前分镜还没有可用参考图，请先在 Step 3 绑定场景、角色或道具参考图';
    if (missingReferenceLabels.length > 0) return `请先在 Step 3 补齐或重新绑定当前分镜需要的参考图：${missingReferenceSummary}`;
    if (usedReferences.length === 0) return '当前分镜参考图不可用，请先在 Step 3 检查并重新绑定';
    return null;
  }, [
    expectedImageRefs.length,
    missingReferenceLabels.length,
    missingReferenceSummary,
    usedReferences.length,
  ]);

  const commonDisabledReason = sourceDisabledReason || referenceDisabledReason;
  const imageGenerationReady = useMemo(
    () => hasEffectiveImageApiKey(state.imageApiConfig, state.videoApiConfig),
    [state.imageApiConfig, state.videoApiConfig],
  );

  const optimizeDisabledReason = useMemo(() => {
    if (sourceDisabledReason) return sourceDisabledReason;
    if (!state.apiConfig.apiKey) return '请先在设置中填写 LLM API Key，才能生成详细故事板导演规划';
    return null;
  }, [sourceDisabledReason, state.apiConfig.apiKey]);

  const generateDisabledReason = useMemo(() => {
    if (commonDisabledReason) return commonDisabledReason;
    if (!imageGenerationReady) return '请先在设置中填写图片 API Key 或虾客漫SD2卡密';
    if (!hasFreshPlan && !state.apiConfig.apiKey) return '当前模式还没有可用的宫格 LLM 规划，请先配置 LLM API Key';
    return null;
  }, [commonDisabledReason, hasFreshPlan, imageGenerationReady, state.apiConfig.apiKey]);

  const conditionChecks = useMemo<StoryboardBoardConditionCheck[]>(() => [
    {
      id: 'source',
      label: '源内容',
      detail: hasBoardSource
        ? (hasPrompt ? '已找到当前分镜视频提示词。' : '导演模式已找到剧本片段或可复用导演规划。')
        : (isDirectorMode ? '缺少剧本片段或导演规划。' : '缺少当前分镜视频提示词。'),
      passed: hasBoardSource,
      blocking: true,
    },
    {
      id: 'step3-refs',
      label: 'Step3 引用',
      detail: expectedImageRefs.length > 0
        ? `已解析 ${expectedImageRefs.length} 个分镜参考需求。`
        : '当前分镜还没有角色、场景或道具参考需求。',
      passed: expectedImageRefs.length > 0,
      blocking: true,
    },
    {
      id: 'assets',
      label: '资产绑定',
      detail: missingReferenceLabels.length > 0
        ? `缺少 ${missingReferenceLabels.length} 个参考资产：${missingReferenceSummary}`
        : `可用参考图 ${usedReferences.length} 张。`,
      passed: missingReferenceLabels.length === 0 && usedReferences.length > 0,
      blocking: true,
    },
    {
      id: 'llm',
      label: 'LLM 规划',
      detail: hasFreshPlan
        ? '已有新鲜导演规划。'
        : state.apiConfig.apiKey
          ? '可生成或刷新导演规划。'
          : '缺少 LLM API Key，不能生成导演规划。',
      passed: hasFreshPlan || !!state.apiConfig.apiKey,
      blocking: !hasFreshPlan,
    },
    {
      id: 'image-api',
      label: '图片生成',
      detail: imageGenerationReady ? '图片 API 可用。' : '缺少图片 API Key 或虾客漫SD2卡密，不能生成故事板图。',
      passed: imageGenerationReady,
      blocking: true,
    },
    {
      id: 'freshness',
      label: '新鲜度',
      detail: currentSb.isStale
        ? '当前分镜已失效，需要先重新生成 Step4 结果。'
        : boardState?.isStale || boardState?.planIsStale
          ? '已有故事板或导演规划落后于当前素材，建议刷新。'
          : '当前分镜未标记失效。',
      passed: !currentSb.isStale,
      blocking: true,
    },
  ], [
    boardState?.isStale,
    boardState?.planIsStale,
    currentSb.isStale,
    expectedImageRefs.length,
    hasBoardSource,
    hasFreshPlan,
    hasPrompt,
    isDirectorMode,
    missingReferenceLabels.length,
    missingReferenceSummary,
    state.apiConfig.apiKey,
    imageGenerationReady,
    usedReferences.length,
  ]);

  const qualityReport = useMemo<StoryboardBoardQualityReport>(
    () => evaluateStoryboardBoardQuality(boardState, modeConfig.mode, sequenceContinuityContext, {
      references: usedReferences.map(({ imageRef }) => imageRef),
    }),
    [boardState, modeConfig.mode, sequenceContinuityContext, usedReferences],
  );

  const runOptimizedBoardPlan = useCallback(async (): Promise<StoryboardBoardPlan | null> => {
    const targetProjectId = currentProject?.id;
    const targetChapterId = currentChapter?.id;
    if (!targetProjectId || !targetChapterId || !hasBoardSource || optimizeDisabledReason) return null;

    const target = { projectId: targetProjectId, chapterId: targetChapterId };
    const planReferenceIds = usedReferences.map(({ asset }) => asset.id);
    const references = usedReferences.map(({ imageRef }) => imageRef);
    const planStartedAt = Date.now();
    const planTiming = beginStoryboardBoardPlanTiming(boardState?.generationTiming, planStartedAt);

    dispatch({
      type: 'UPDATE_STORYBOARD',
      index: currentIndex,
      ...target,
      updates: {
        storyboardBoard: mergeStoryboardBoardVariant(boardContainer, modeConfig.mode, {
          planStatus: 'optimizing',
          planError: undefined,
          planIsStale: false,
          planPromptSnapshot: planSourceSnapshot,
          planReferenceAssetIds: planReferenceIds,
          layout: modeConfig.layout,
          frameRatio: modeConfig.frameRatio,
          imageSize: storyboardBoardImageSize,
          generationTiming: planTiming,
        }),
        seedanceFinalVideoPromptStatus: 'idle',
        seedanceFinalVideoPrompt: '',
        seedanceFinalVideoPromptError: undefined,
        seedanceFinalVideoPromptSourceSnapshot: '',
        seedanceFinalVideoPromptUpdatedAt: undefined,
        smartVideoDurationSeconds: undefined,
        smartVideoDurationReason: undefined,
        smartVideoDurationUpdatedAt: undefined,
      },
    });

    try {
      const planningStoryboard = currentSbForPlanning;
      const fallbackDirectorBrief = buildFallbackStoryboardBoardPlan(
        planningStoryboard,
        references,
        modeConfig.mode,
        targetVideoFrameRatio,
      ).directorBrief;
      if (!fallbackDirectorBrief) {
        throw new Error('精简规划缺少可用导演阐述兜底，无法继续生成故事板。');
      }
      let directorBrief: StoryboardBoardDirectorBrief = fallbackDirectorBrief;
      let planWarning: string | undefined;
      const compactPlanning = isCompactStoryboardDirectorRunMode(storyboardDirectorRunMode);

      const useBrowserDirectStep4Llm = true;
      const backgroundProgressMode = useBrowserDirectStep4Llm ? undefined : 'stage-only' as const;
      const requestPlanningText = async (
        requestPayload: string,
        templateType: string,
        params: StoryboardLlmParams,
        showPreview = false,
      ) => requestStoryboardPlanningTextStream(
        requestPayload,
        (payload, requestOptions, streamCallbacks) => requestStoryboardPlanningViaBffStream(
          payload,
          requestOptions,
          state.apiConfig,
          templateType,
          streamCallbacks,
          { disableBackgroundJob: useBrowserDirectStep4Llm, backgroundProgressMode },
        ),
        params,
        showPreview
          ? {
              onProgress: (fullText) => {
                setPlanStreamText(fullText);
              },
            }
          : undefined,
      );

      if (compactPlanning) {
        planWarning = [
          planWarning,
          '精简模式：已跳过导演阐述，使用上一镜连续性、当前剧本和参考图职责组成上下文胶囊，直接进入单轮故事板规划。',
        ].filter(Boolean).join('；');
      } else {
      try {
        let rawBriefText = await requestPlanningText(
          buildStoryboardDirectorBriefRequest(
            planningStoryboard,
            references,
            modeConfig.mode,
            episodeShotSheetSegment,
            targetVideoFrameRatio,
            sequenceContinuityContext,
            analysis?.styleConfig,
            undefined,
            smartPanelCountPreference,
            cameraSegmentCount,
          ),
          STORYBOARD_DIRECTOR_BRIEF_TEMPLATE_TYPE,
          STORYBOARD_DIRECTOR_BRIEF_LLM_PARAMS,
        );
        try {
          directorBrief = parseStoryboardDirectorBrief(rawBriefText, planningStoryboard, references, modeConfig.mode, targetVideoFrameRatio, smartPanelCountPreference);
        } catch (firstBriefParseError) {
          rawBriefText = await requestPlanningText(
            buildStoryboardDirectorBriefRequest(
              planningStoryboard,
                references,
                modeConfig.mode,
                episodeShotSheetSegment,
                targetVideoFrameRatio,
                sequenceContinuityContext,
                analysis?.styleConfig,
                firstBriefParseError instanceof Error ? firstBriefParseError.message : String(firstBriefParseError),
                smartPanelCountPreference,
                cameraSegmentCount,
            ),
            STORYBOARD_DIRECTOR_BRIEF_TEMPLATE_TYPE,
            STORYBOARD_DIRECTOR_BRIEF_REPAIR_LLM_PARAMS,
          );
          directorBrief = parseStoryboardDirectorBrief(rawBriefText, planningStoryboard, references, modeConfig.mode, targetVideoFrameRatio, smartPanelCountPreference);
        }
        const durationRejudgeHint = buildSmartStoryboardDurationRejudgeHint(
          modeConfig.mode,
          planningStoryboard,
          directorBrief,
          lockedSmartPanelCount,
          { durationCompressionEnabled: smartDurationCompressionEnabled },
        );
        if (durationRejudgeHint) {
          rawBriefText = await requestPlanningText(
            buildStoryboardDirectorBriefRequest(
              planningStoryboard,
              references,
              modeConfig.mode,
              episodeShotSheetSegment,
              targetVideoFrameRatio,
              sequenceContinuityContext,
              analysis?.styleConfig,
              durationRejudgeHint,
              smartPanelCountPreference,
              cameraSegmentCount,
            ),
            STORYBOARD_DIRECTOR_BRIEF_TEMPLATE_TYPE,
            STORYBOARD_DIRECTOR_BRIEF_REPAIR_LLM_PARAMS,
          );
          directorBrief = parseStoryboardDirectorBrief(rawBriefText, planningStoryboard, references, modeConfig.mode, targetVideoFrameRatio, smartPanelCountPreference);
        }
      } catch (briefError) {
        throwIfAbortLikeError(briefError);
        throw new Error(briefError instanceof Error
          ? `导演阐述流式生成失败，已停止当前故事板规划；请重试当前分镜：${briefError.message}`
          : '导演阐述流式生成失败，已停止当前故事板规划；请重试当前分镜。');
      }
      }

      const planTemplateType = getStoryboardBoardPlanTemplateType(modeConfig.mode);
      const boardPlanLlmParams = compactPlanning
        ? STORYBOARD_COMPACT_BOARD_PLAN_LLM_PARAMS
        : STORYBOARD_BOARD_PLAN_LLM_PARAMS;
      const smartDurationDecision = resolveSmartStoryboardDurationDecision(
        modeConfig.mode,
        planningStoryboard,
        directorBrief,
        lockedSmartPanelCount,
        { durationCompressionEnabled: smartDurationCompressionEnabled },
      );
      const smartDurationUpdates = buildSmartStoryboardDurationUpdates(smartDurationDecision);
      directorBrief = applySmartDurationToDirectorBrief(directorBrief, smartDurationDecision);
      const planningStoryboardForPlan = applySmartDurationToStoryboardForPrompt(planningStoryboard, smartDurationDecision);
      const buildPlanText = (repairHint?: string) => buildStoryboardBoardPlanRequest(
        planningStoryboardForPlan,
        references,
        modeConfig.mode,
        repairHint,
        episodeShotSheetSegment,
        targetVideoFrameRatio,
        sequenceContinuityContext,
        directorBrief,
        analysis?.styleConfig,
        smartPanelCountPreference,
        cameraSegmentCount,
        { compactPlanning },
      );
      const buildFormatRepairText = (previousRawText: string, repairHint: string) => buildStoryboardBoardFormatRepairRequest(
        planningStoryboardForPlan,
        references,
        modeConfig.mode,
        previousRawText,
        repairHint,
        episodeShotSheetSegment,
        targetVideoFrameRatio,
        sequenceContinuityContext,
        directorBrief,
        analysis?.styleConfig,
        smartPanelCountPreference,
        cameraSegmentCount,
        { compactPlanning },
      );
      const buildQualityRepairText = (currentPlan: StoryboardBoardPlan, repairHint: string) => buildStoryboardBoardQualityRepairRequest(
        planningStoryboardForPlan,
        references,
        modeConfig.mode,
        currentPlan,
        repairHint,
        episodeShotSheetSegment,
        targetVideoFrameRatio,
        sequenceContinuityContext,
        directorBrief,
        analysis?.styleConfig,
        smartPanelCountPreference,
        cameraSegmentCount,
        { compactPlanning },
      );

      let rawPlanText = await requestPlanningText(
        buildPlanText(),
        planTemplateType,
        boardPlanLlmParams,
        true,
      );

      let plan: StoryboardBoardPlan;

      try {
        plan = parseStoryboardBoardPlan(rawPlanText, planningStoryboardForPlan, references, modeConfig.mode, targetVideoFrameRatio, directorBrief, smartPanelCountPreference);
      } catch (firstParseError) {
        try {
          rawPlanText = await requestPlanningText(
            buildFormatRepairText(
              rawPlanText,
              firstParseError instanceof Error ? firstParseError.message : String(firstParseError),
            ),
            planTemplateType,
            STORYBOARD_BOARD_PLAN_REPAIR_LLM_PARAMS,
            true,
          );
          plan = parseStoryboardBoardPlan(rawPlanText, planningStoryboardForPlan, references, modeConfig.mode, targetVideoFrameRatio, directorBrief, smartPanelCountPreference);
        } catch (planRepairError) {
          throwIfAbortLikeError(planRepairError);
          throw new Error(planRepairError instanceof Error
            ? `LLM 故事板规划输出格式异常，修复后仍不可用；已停止后续生图：${planRepairError.message}`
            : 'LLM 故事板规划输出格式异常，修复后仍不可用；已停止后续生图。');
        }
      }

      const qualityRepairHint = buildStoryboardBoardQualityRepairHint(
        evaluateStoryboardBoardQuality(
          { status: 'done', plan, layout: modeConfig.layout, frameRatio: modeConfig.frameRatio },
          modeConfig.mode,
          sequenceContinuityContext,
          { references },
        ),
      );
      if (qualityRepairHint) {
        try {
          rawPlanText = await requestPlanningText(
            buildQualityRepairText(plan, qualityRepairHint),
            planTemplateType,
            STORYBOARD_BOARD_PLAN_REPAIR_LLM_PARAMS,
            true,
        );
          plan = parseStoryboardBoardPlan(rawPlanText, planningStoryboardForPlan, references, modeConfig.mode, targetVideoFrameRatio, directorBrief, smartPanelCountPreference);
          const repairedQualityReport = evaluateStoryboardBoardQuality(
            { status: 'done', plan, layout: modeConfig.layout, frameRatio: modeConfig.frameRatio },
            modeConfig.mode,
            sequenceContinuityContext,
            { references },
          );
          const remainingRepairHint = buildStoryboardBoardQualityRepairHint(repairedQualityReport, 2);
          const blockingQualityChecks = getStoryboardBoardQualityBlockingChecks(repairedQualityReport);
          if (remainingRepairHint && blockingQualityChecks.length > 0) {
            throw new Error(`导演规划质量门修复后仍有结构性问题，已停止后续生图：${blockingQualityChecks.slice(0, 4).map((check) => `${check.id}: ${check.detail}`).join(' / ')}`);
          }
          const warningSummary = summarizeStoryboardBoardQualityWarnings(repairedQualityReport);
          planWarning = [
            planWarning,
            warningSummary
              ? `导演规划质量门已自动修复；仍有非阻塞风险：${warningSummary}`
              : '导演规划质量门发现问题后已自动修复。',
          ].filter(Boolean).join('；');
        } catch (qualityRepairError) {
          throwIfAbortLikeError(qualityRepairError);
          throw new Error(qualityRepairError instanceof Error
            ? `导演规划质量门自动修复失败，已停止后续生图：${qualityRepairError.message}`
            : '导演规划质量门自动修复失败，已停止后续生图。');
        }
      }

      if (!shouldRunStoryboardActionDirector(storyboardDirectorRunMode)) {
        planWarning = [
          planWarning,
          compactPlanning
            ? '精简模式：已跳过动作导演连续性调度；上下文由单轮规划中的 START/END 桥接和 continuityOut 保留。'
            : '快速模式：已跳过动作导演连续性调度。',
        ].filter(Boolean).join('；');
      } else {
        try {
          const rawActionDirectorText = await requestPlanningText(
            buildStoryboardActionDirectorRequest(
              planningStoryboardForPlan,
              references,
              modeConfig.mode,
              plan,
              undefined,
              episodeShotSheetSegment,
              targetVideoFrameRatio,
              sequenceContinuityContext,
              directorBrief,
              analysis?.styleConfig,
              smartPanelCountPreference,
              cameraSegmentCount,
            ),
            STORYBOARD_ACTION_DIRECTOR_TEMPLATE_TYPE,
            STORYBOARD_ACTION_DIRECTOR_LLM_PARAMS,
            true,
          );
          plan = parseStoryboardBoardPlan(rawActionDirectorText, planningStoryboardForPlan, references, modeConfig.mode, targetVideoFrameRatio, directorBrief, smartPanelCountPreference);
        } catch (actionDirectorError) {
          throwIfAbortLikeError(actionDirectorError);
          throw new Error(actionDirectorError instanceof Error
            ? `动作导演连续性调度未完成，已停止后续生图；请重试当前分镜：${actionDirectorError.message}`
            : '动作导演连续性调度未完成，已停止后续生图；请重试当前分镜。');
        }
      }

      const planCompletedAt = Date.now();
      const completedPlanTiming = completeStoryboardBoardPlanTiming(planTiming, planCompletedAt);

      dispatch({
        type: 'UPDATE_STORYBOARD',
        index: currentIndex,
        ...target,
        updates: {
          ...smartDurationUpdates,
          storyboardBoard: mergeStoryboardBoardVariant(boardContainer, modeConfig.mode, {
            planStatus: 'done',
            plan,
            planError: planWarning,
            planGeneratedAt: planCompletedAt,
            planIsStale: false,
            planPromptSnapshot: planSourceSnapshot,
            planReferenceAssetIds: planReferenceIds,
            layout: modeConfig.layout,
            frameRatio: modeConfig.frameRatio,
            imageSize: storyboardBoardImageSize,
            generationTiming: completedPlanTiming,
          }),
          seedanceFinalVideoPromptStatus: 'idle',
          seedanceFinalVideoPrompt: '',
          seedanceFinalVideoPromptError: undefined,
          seedanceFinalVideoPromptSourceSnapshot: '',
          seedanceFinalVideoPromptUpdatedAt: undefined,
        },
      });

      return plan;
    } catch (error) {
      const errorMessage = formatStoryboardBoardImageRecoverableFailure(error);
      const isTimeout = /timeout|timed out/i.test(errorMessage) || includesAnyTextVariant(errorMessage, ['超时']);
      dispatch({
        type: 'UPDATE_STORYBOARD',
        index: currentIndex,
        ...target,
        updates: {
          storyboardBoard: mergeStoryboardBoardVariant(boardContainer, modeConfig.mode, {
            planStatus: 'failed',
            planError: errorMessage,
            planIsStale: true,
            planPromptSnapshot: planSourceSnapshot,
            planReferenceAssetIds: planReferenceIds,
            layout: modeConfig.layout,
            frameRatio: modeConfig.frameRatio,
            imageSize: storyboardBoardImageSize,
            generationTiming: failStoryboardBoardPlanTiming(planTiming, errorMessage, Date.now(), isTimeout),
          }),
          seedanceFinalVideoPromptStatus: 'idle',
          seedanceFinalVideoPrompt: '',
          seedanceFinalVideoPromptError: undefined,
          seedanceFinalVideoPromptSourceSnapshot: '',
          seedanceFinalVideoPromptUpdatedAt: undefined,
        },
      });

      return null;
    } finally {
      setPlanStreamText('');
    }
  }, [
    analysis?.styleConfig,
    boardContainer,
    boardState?.generationTiming,
    currentChapter?.id,
    currentIndex,
    currentProject?.id,
    currentSbForPlanning,
    dispatch,
    episodeShotSheetSegment,
    hasBoardSource,
    lockedSmartPanelCount,
    modeConfig.frameRatio,
    modeConfig.layout,
    modeConfig.mode,
    optimizeDisabledReason,
    planSourceSnapshot,
    sequenceContinuityContext,
    smartDurationCompressionEnabled,
    smartPanelCountPreference,
    state.apiConfig,
    state.globalTaskSettings?.step4LlmExecutionMode,
    storyboardBoardImageSize,
    storyboardDirectorRunMode,
    targetVideoFrameRatio,
    usedReferences,
  ]);

  const optimizeBoardPlan = runOptimizedBoardPlan;

  const generateBoard = useCallback(async () => {
    const targetProjectId = currentProject?.id;
    const targetChapterId = currentChapter?.id;
    if (!hasBoardSource || !targetProjectId || !targetChapterId || generateDisabledReason) return;

    const target = { projectId: targetProjectId, chapterId: targetChapterId };
    const plan = hasFreshPlan && rawBoardState?.plan
      ? rawBoardState.plan
      : await optimizeBoardPlan();
    if (!plan) return;

    const smartDurationDecision = resolveSmartStoryboardDurationDecision(
      modeConfig.mode,
      currentSbForPlanning,
      plan.directorBrief,
      lockedSmartPanelCount,
      { durationCompressionEnabled: smartDurationCompressionEnabled },
    );
    const smartDurationUpdates = buildSmartStoryboardDurationUpdates(smartDurationDecision);
    const storyboardForPrompt = applySmartDurationToStoryboardForPrompt(currentSbForPlanning, smartDurationDecision);
    const boardProjectVisualStyle = buildBoardProjectVisualStyle(currentSbForPlanning, plan, analysis?.styleConfig);
    const boardSourceSnapshot = buildStoryboardBoardSourceSnapshot(
      storyboardForPrompt,
      targetVideoFrameRatio,
      sequenceContinuityContext,
      boardProjectVisualStyle,
      { smartPanelCountPreference, smartDurationCompressionEnabled, cameraSegmentCount },
    );
    const orderedReferences = sortResolvedReferencesByPlan(baseUsedReferences, plan);
    const referenceBlobResults = await Promise.all(
      orderedReferences.map(async (reference) => ({
        reference,
        blob: (await loadPreferredAssetBlob(reference.asset, currentProject?.id)).blob,
      })),
    );
    const missingReferences = referenceBlobResults.filter((entry) => !entry.blob);
    const referenceBlobs = referenceBlobResults
      .map((entry) => entry.blob)
      .filter((blob): blob is Blob => !!blob);

    if (missingReferences.length > 0) {
      const missingLabel = missingReferences
        .map(({ reference }) => reference.imageRef.name)
        .join('、');
      dispatch({
        type: 'UPDATE_STORYBOARD',
        index: currentIndex,
        ...target,
        updates: {
          storyboardBoard: mergeStoryboardBoardVariant(boardContainer, modeConfig.mode, {
            status: 'failed',
            boardStyle,
            generatedForOutputMode: currentSb.generatedStep4OutputMode ?? currentSb.step4OutputMode ?? 'prompt',
            error: `以下参考图加载失败：${missingLabel}。请重新绑定后再试。`,
            isStale: boardState?.isStale ?? false,
            layout: modeConfig.layout,
            frameRatio: modeConfig.frameRatio,
            imageSize: storyboardBoardImageSize,
            promptSnapshot: boardSourceSnapshot,
            referenceAssetIds: orderedReferences.map(({ asset }) => asset.id),
          }),
        },
      });
      return;
    }

    const finalReferences: SeedanceFinalPromptReference[] = orderedReferences.map(({ imageRef, asset }) => ({
      refId: imageRef.refId,
      type: imageRef.type,
      name: imageRef.name,
      assetId: asset.id,
      trackingId: imageRef.trackingId,
      variantKey: imageRef.variantKey,
      outfitSeq: imageRef.outfitSeq,
      concept: imageRef.concept,
      assetSource: asset.source,
      isNoFaceCharacterVisual: imageRef.isNoFaceCharacterVisual,
    }));
    const orderedImageRefs = buildVideoImageRefsFromOrderedReferences(orderedReferences, expectedImageRefs);
    const finalVoiceReferences = resolveStoryboardVoiceReferences({
      storyboard: currentSb,
      project: currentProject,
      videoConfig: state.videoApiConfig,
    });
    const seedanceFinalPromptSourceSnapshot = buildSeedanceFinalPromptSourceSnapshot({
      storyboard: storyboardForPrompt,
      boardPlan: plan,
      references: finalReferences,
      voiceReferences: finalVoiceReferences,
      mode: modeConfig.mode,
      frameRatio: targetVideoFrameRatio,
      projectVisualStyle: boardProjectVisualStyle,
      cameraSegmentCount,
    });

    const boardGenerationStartedAt = Date.now();
    let imageGenerationTiming = beginStoryboardBoardImageTiming(
      boardState?.generationTiming,
      boardGenerationStartedAt,
    );
    dispatch({
      type: 'UPDATE_STORYBOARD',
      index: currentIndex,
      ...target,
      updates: {
        ...(isDirectorMode
          ? {
              status: 'generating' as const,
              error: undefined,
              step4StartedAt: boardGenerationStartedAt,
            }
          : {}),
        storyboardBoard: mergeStoryboardBoardVariant(boardContainer, modeConfig.mode, {
          status: 'generating',
          boardStyle,
          generatedForOutputMode: currentSb.generatedStep4OutputMode ?? currentSb.step4OutputMode ?? 'prompt',
          startedAt: boardGenerationStartedAt,
          error: undefined,
          isStale: false,
          layout: modeConfig.layout,
          frameRatio: modeConfig.frameRatio,
          imageSize: storyboardBoardImageSize,
          promptSnapshot: boardSourceSnapshot,
          referenceAssetIds: orderedReferences.map(({ asset }) => asset.id),
          plan,
          planStatus: 'done',
          planGeneratedAt: boardState?.planGeneratedAt ?? Date.now(),
          planError: boardState?.planError,
          planIsStale: false,
          planPromptSnapshot: planSourceSnapshot,
          planReferenceAssetIds: orderedReferences.map(({ asset }) => asset.id),
          generationTiming: imageGenerationTiming,
        }),
        seedanceFinalVideoPromptStatus: 'idle',
        seedanceFinalVideoPrompt: '',
        seedanceFinalVideoPromptError: undefined,
        seedanceFinalVideoPromptSourceSnapshot: seedanceFinalPromptSourceSnapshot,
        seedanceFinalVideoPromptUpdatedAt: Date.now(),
        videoImageRefs: orderedImageRefs,
        ...smartDurationUpdates,
      },
    });

    try {
      const prompt = buildStoryboardBoardPrompt(
        storyboardForPrompt,
        orderedReferences.map(({ imageRef }) => imageRef),
        modeConfig.mode,
        plan,
        boardStyle,
        {
          frameRatio: targetVideoFrameRatio,
          sequenceContinuityContext,
          projectVisualStyle: boardProjectVisualStyle,
        },
      );

      const result = await runStoryboardBoardImageWithRetry(async () => {
        const controller = new AbortController();
        activeBoardImageControllersRef.current.add(controller);
        try {
          return await withTimeout(
            generateImage(state.imageApiConfig, {
              prompt,
              aspectRatio: modeConfig.aspectRatio,
              imageSize: storyboardBoardImageSize,
              referenceBlobs,
              referenceLabels: orderedReferences.map(({ imageRef }, index) => (
                buildReferenceInputLabel(
                  imageRef,
                  index,
                  boardProjectVisualStyle,
                )
              )),
              signal: controller.signal,
              background: {
                projectId: currentProject?.id,
                chapterId: currentChapter?.id,
                storyboardIndex: currentIndex,
                namespace: `step4-board-${modeConfig.mode}-${currentIndex}`,
                requireBackend: false,
              },
            }, state.videoApiConfig),
            STORYBOARD_BOARD_IMAGE_TIMEOUT_MS,
            STORYBOARD_BOARD_IMAGE_TIMEOUT_MESSAGE,
            () => controller.abort(),
          );
        } finally {
          activeBoardImageControllersRef.current.delete(controller);
        }
      }, {
        delaysMs: STORYBOARD_BOARD_IMAGE_RETRY_DELAYS_MS,
        onRetry: (event) => {
          const retryNotice = formatStoryboardBoardImageRetryNotice(event);
          const retryStartedAt = Date.now();
          const isTimeout = /timeout|timed out|超过|超时|未返回/i.test(event.error)
            || includesAnyTextVariant(event.error, ['超时']);
          imageGenerationTiming = beginStoryboardBoardImageTiming(
            failStoryboardBoardImageTiming(imageGenerationTiming, event.error, retryStartedAt, isTimeout, boardGenerationStartedAt),
            retryStartedAt,
          );
          dispatch({
            type: 'UPDATE_STORYBOARD',
            index: currentIndex,
            ...target,
            updates: {
              error: retryNotice,
              storyboardBoard: mergeStoryboardBoardVariant(boardContainer, modeConfig.mode, {
                status: 'generating',
                boardStyle,
                generatedForOutputMode: currentSb.generatedStep4OutputMode ?? currentSb.step4OutputMode ?? 'prompt',
                startedAt: retryStartedAt,
                error: retryNotice,
                isStale: false,
                layout: modeConfig.layout,
                frameRatio: modeConfig.frameRatio,
                imageSize: storyboardBoardImageSize,
                promptSnapshot: boardSourceSnapshot,
                referenceAssetIds: orderedReferences.map(({ asset }) => asset.id),
                plan,
                planStatus: 'done',
                planGeneratedAt: boardState?.planGeneratedAt ?? Date.now(),
                planError: boardState?.planError,
                planIsStale: false,
                planPromptSnapshot: planSourceSnapshot,
                planReferenceAssetIds: orderedReferences.map(({ asset }) => asset.id),
                generationTiming: imageGenerationTiming,
              }),
            },
          });
        },
      });

      const shouldComposeDetailedBoard = isComposableStoryboardBoardMode(modeConfig.mode);
      const finalBlob = shouldComposeDetailedBoard
        ? await composeStoryboardBoardBlob(result.blob, {
            mode: modeConfig.mode,
            storyboard: storyboardForPrompt,
            panels: plan.panels,
          })
        : result.blob;
      const [blobKey, visualBoardBlobKey] = await Promise.all([
        saveBlob(finalBlob),
        shouldComposeDetailedBoard ? saveBlob(result.blob) : Promise.resolve(undefined),
      ]);
      const previousBlobKey = rawBoardState?.blobKey;
      const previousVisualBoardBlobKey = rawBoardState?.visualBoardBlobKey;
      const previousLightweightBlobKey = rawBoardState?.lightweightBlobKey;
      const previousReferencePack = rawBoardState?.referencePack ?? [];
      const boardGeneratedAt = Date.now();
      const completedImageTiming = completeStoryboardBoardImageTiming(
        imageGenerationTiming,
        boardGeneratedAt,
        boardGenerationStartedAt,
      );
      const completedBoardState = replaceStoryboardBoardVariant(boardContainer, modeConfig.mode, {
        status: 'done',
        boardStyle,
        generatedForOutputMode: currentSb.generatedStep4OutputMode ?? currentSb.step4OutputMode ?? 'prompt',
        visualBoardBlobKey,
        blobKey,
        referencePack: [],
        startedAt: undefined,
        generatedAt: boardGeneratedAt,
        error: undefined,
        isStale: false,
        layout: modeConfig.layout,
        frameRatio: modeConfig.frameRatio,
        imageSize: storyboardBoardImageSize,
        generationTiming: completedImageTiming,
        promptSnapshot: boardSourceSnapshot,
        referenceAssetIds: orderedReferences.map(({ asset }) => asset.id),
        plan,
        planStatus: 'done',
        planGeneratedAt: boardState?.planGeneratedAt ?? Date.now(),
        planError: boardState?.planError,
        planIsStale: false,
        planPromptSnapshot: planSourceSnapshot,
        planReferenceAssetIds: orderedReferences.map(({ asset }) => asset.id),
      });

      dispatch({
        type: 'UPDATE_STORYBOARD',
        index: currentIndex,
        ...target,
        updates: {
          ...(isDirectorMode
            ? {
                status: 'done' as const,
                error: undefined,
                step4StartedAt: undefined,
              }
            : {}),
          storyboardBoard: completedBoardState,
          useStoryboardBoardReference: true,
          ...smartDurationUpdates,
        },
      });

      const seedancePromptTiming = beginStoryboardBoardSeedanceTiming(
        completedImageTiming,
        Date.now(),
      );
      const seedancePromptBoardState = mergeStoryboardBoardVariant(completedBoardState, modeConfig.mode, {
        generationTiming: seedancePromptTiming,
      });

      if (!state.apiConfig.apiKey) {
        dispatch({
          type: 'UPDATE_STORYBOARD',
          index: currentIndex,
          ...target,
          updates: {
            seedanceFinalVideoPromptStatus: 'failed',
            seedanceFinalVideoPromptError: '请先在设置中填写 LLM API Key，才能生成 Seedance 最终视频词。',
            seedanceFinalVideoPromptSourceSnapshot: seedanceFinalPromptSourceSnapshot,
            seedanceFinalVideoPromptUpdatedAt: Date.now(),
            ...smartDurationUpdates,
            storyboardBoard: mergeStoryboardBoardVariant(seedancePromptBoardState, modeConfig.mode, {
              generationTiming: failStoryboardBoardSeedanceTiming(seedancePromptTiming, 'Seedance final prompt API key missing'),
            }),
          },
        });
      } else {
        const apiConfigSnapshot = state.apiConfig;
        dispatch({
          type: 'UPDATE_STORYBOARD',
          index: currentIndex,
          ...target,
          updates: {
            ...(isDirectorMode
              ? {
                  status: 'generating' as const,
                  error: undefined,
                  step4StartedAt: Date.now(),
                }
              : {}),
            seedanceFinalVideoPromptStatus: 'generating',
            seedanceFinalVideoPromptError: undefined,
            seedanceFinalVideoPromptSourceSnapshot: seedanceFinalPromptSourceSnapshot,
            seedanceFinalVideoPromptUpdatedAt: Date.now(),
            ...smartDurationUpdates,
            storyboardBoard: seedancePromptBoardState,
          },
        });

        let lastSeedancePromptPreview = '';
        let lastSeedancePromptPreviewAt = 0;
        const dispatchSeedancePromptPreview = (fullText: string, force = false) => {
          const trimmedText = fullText.trim();
          if (!trimmedText) return;
          const now = Date.now();
          const gainedChars = trimmedText.length - lastSeedancePromptPreview.length;
          if (!force && now - lastSeedancePromptPreviewAt < 750 && gainedChars < 160) return;
          lastSeedancePromptPreview = trimmedText;
          lastSeedancePromptPreviewAt = now;
          dispatch({
            type: 'UPDATE_STORYBOARD',
            index: currentIndex,
            ...target,
            updates: {
              seedanceFinalVideoPrompt: trimmedText,
              seedanceFinalVideoPromptStatus: 'generating',
              seedanceFinalVideoPromptError: undefined,
              seedanceFinalVideoPromptSourceSnapshot: seedanceFinalPromptSourceSnapshot,
              seedanceFinalVideoPromptUpdatedAt: now,
              storyboardBoard: seedancePromptBoardState,
            },
          });
        };

        const seedancePromptController = new AbortController();
        activeSeedanceFinalPromptControllersRef.current.add(seedancePromptController);
        void requestSeedanceFinalVideoPromptStream({
          storyboard: {
            ...storyboardForPrompt,
            storyboardBoard: seedancePromptBoardState,
            useStoryboardBoardReference: true,
            status: isDirectorMode ? 'done' : currentSb.status,
          },
          boardPlan: plan,
          references: finalReferences,
          voiceReferences: finalVoiceReferences,
          mode: modeConfig.mode,
          frameRatio: targetVideoFrameRatio,
          projectVisualStyle: boardProjectVisualStyle,
          cameraSegmentCount,
        }, (requestPayload, requestOptions, streamCallbacks) => requestSeedanceFinalPromptViaBffStream(
          requestPayload,
          requestOptions,
          apiConfigSnapshot,
          targetVideoFrameRatio,
          streamCallbacks,
          {
            disableBackgroundJob: true,
            backgroundProgressMode: undefined,
          },
        ), {
          onProgress: (fullText) => dispatchSeedancePromptPreview(fullText),
        }, undefined, seedancePromptController.signal)
          .then((finalPrompt) => {
            dispatchSeedancePromptPreview(finalPrompt, true);
            dispatch({
              type: 'UPDATE_STORYBOARD',
              index: currentIndex,
              ...target,
              updates: {
                ...(isDirectorMode
                  ? {
                      status: 'done' as const,
                      error: undefined,
                      step4StartedAt: undefined,
                    }
                  : {}),
                seedanceFinalVideoPrompt: finalPrompt,
                seedanceFinalVideoPromptStatus: 'done',
                seedanceFinalVideoPromptError: undefined,
                seedanceFinalVideoPromptSourceSnapshot: seedanceFinalPromptSourceSnapshot,
                seedanceFinalVideoPromptUpdatedAt: Date.now(),
                ...smartDurationUpdates,
                storyboardBoard: mergeStoryboardBoardVariant(seedancePromptBoardState, modeConfig.mode, {
                  generationTiming: completeStoryboardBoardSeedanceTiming(seedancePromptTiming),
                }),
              },
            });
          })
          .catch((error: unknown) => {
            if (isAbortLikeError(error)) return;
            const message = error instanceof Error ? error.message : String(error);
            const statusError = message.startsWith('Seedance 最终视频词生成失败')
              ? message
              : `Seedance 最终视频词生成失败：${message}`;
            dispatch({
              type: 'UPDATE_STORYBOARD',
              index: currentIndex,
              ...target,
              updates: {
                ...(isDirectorMode
                  ? {
                      status: 'error' as const,
                      error: statusError,
                      step4StartedAt: undefined,
                    }
                  : {}),
                seedanceFinalVideoPromptStatus: 'failed',
                seedanceFinalVideoPromptError: message,
                seedanceFinalVideoPromptSourceSnapshot: seedanceFinalPromptSourceSnapshot,
                seedanceFinalVideoPromptUpdatedAt: Date.now(),
                ...smartDurationUpdates,
                storyboardBoard: mergeStoryboardBoardVariant(seedancePromptBoardState, modeConfig.mode, {
                  generationTiming: failStoryboardBoardSeedanceTiming(seedancePromptTiming, message),
                }),
              },
            });
          })
          .finally(() => {
            activeSeedanceFinalPromptControllersRef.current.delete(seedancePromptController);
          });
      }

      if (previousBlobKey && previousBlobKey !== blobKey) {
        deleteBlob(previousBlobKey).catch(() => undefined);
      }
      if (previousVisualBoardBlobKey && previousVisualBoardBlobKey !== visualBoardBlobKey) {
        deleteBlob(previousVisualBoardBlobKey).catch(() => undefined);
      }
      if (previousLightweightBlobKey) {
        deleteBlob(previousLightweightBlobKey).catch(() => undefined);
      }
      previousReferencePack.forEach((item) => {
        deleteBlob(item.blobKey).catch(() => undefined);
      });
    } catch (error) {
      if (isAbortLikeError(error)) return;
      const retryCount = getStoryboardBoardImageRetryCount(error);
      const errorMessage = typeof retryCount === 'number'
        ? formatStoryboardBoardImageRecoverableFailure(error, { retryCount })
        : error instanceof Error ? error.message : String(error);
      const isTimeout = /timeout|timed out|超过|超时|未返回/i.test(errorMessage)
        || includesAnyTextVariant(errorMessage, ['超时']);
      dispatch({
        type: 'UPDATE_STORYBOARD',
        index: currentIndex,
        ...target,
        updates: {
          ...(isDirectorMode
            ? {
                status: 'error' as const,
                error: errorMessage,
                step4StartedAt: undefined,
              }
            : {}),
          storyboardBoard: mergeStoryboardBoardVariant(boardContainer, modeConfig.mode, {
            status: 'failed',
            boardStyle,
            generatedForOutputMode: currentSb.generatedStep4OutputMode ?? currentSb.step4OutputMode ?? 'prompt',
            startedAt: undefined,
            error: errorMessage,
            isStale: boardState?.isStale ?? false,
            layout: modeConfig.layout,
            frameRatio: modeConfig.frameRatio,
            imageSize: storyboardBoardImageSize,
            promptSnapshot: boardSourceSnapshot,
            referenceAssetIds: orderedReferences.map(({ asset }) => asset.id),
            plan,
            planStatus: 'done',
            planGeneratedAt: boardState?.planGeneratedAt ?? Date.now(),
            planError: boardState?.planError,
            planIsStale: false,
            planPromptSnapshot: planSourceSnapshot,
            planReferenceAssetIds: orderedReferences.map(({ asset }) => asset.id),
            generationTiming: failStoryboardBoardImageTiming(
              imageGenerationTiming,
              errorMessage,
              Date.now(),
              isTimeout,
              boardGenerationStartedAt,
            ),
          }),
          seedanceFinalVideoPromptStatus: 'idle',
          seedanceFinalVideoPrompt: '',
          seedanceFinalVideoPromptError: undefined,
          seedanceFinalVideoPromptSourceSnapshot: '',
          seedanceFinalVideoPromptUpdatedAt: undefined,
        },
      });
    }
  }, [
    analysis?.styleConfig,
    baseUsedReferences,
    boardContainer,
    boardState,
    boardStyle,
    currentChapter?.id,
    currentIndex,
    currentProject,
    currentSb,
    currentSbForPlanning,
    dispatch,
    generateDisabledReason,
    hasBoardSource,
    hasFreshPlan,
    isDirectorMode,
    lockedSmartPanelCount,
    modeConfig.aspectRatio,
    modeConfig.frameRatio,
    modeConfig.layout,
    modeConfig.mode,
    optimizeBoardPlan,
    planSourceSnapshot,
    rawBoardState,
    sequenceContinuityContext,
    smartDurationCompressionEnabled,
    smartPanelCountPreference,
    state.apiConfig,
    state.globalTaskSettings?.step4LlmExecutionMode,
    state.imageApiConfig,
    state.videoApiConfig,
    storyboardBoardImageSize,
    targetVideoFrameRatio,
  ]);

  const generateSeedanceFinalVideoPrompt = useCallback(async (options?: {
    boardPlan?: StoryboardBoardPlan;
    references?: ResolvedStoryboardBoardReference[];
    sourceSnapshot?: string;
  }) => {
    const targetProjectId = currentProject?.id;
    const targetChapterId = currentChapter?.id;
    if (!targetProjectId || !targetChapterId) return null;
    if (!isDirectorMode) return null;

    const boardPlan = options?.boardPlan ?? boardState?.plan;
    if (!boardPlan) return null;

    const orderedReferences = options?.references
      ?? (boardState?.plan
        ? sortResolvedReferencesByPlan(baseUsedReferences, boardState.plan)
        : baseUsedReferences);

    if (orderedReferences.length === 0) return null;

    const smartDurationDecision = resolveSmartStoryboardDurationDecision(
      modeConfig.mode,
      currentSb,
      boardPlan.directorBrief,
      lockedSmartPanelCount,
      { durationCompressionEnabled: smartDurationCompressionEnabled },
    );
    const smartDurationUpdates = buildSmartStoryboardDurationUpdates(smartDurationDecision);
    const storyboardForPrompt = applySmartDurationToStoryboardForPrompt(currentSb, smartDurationDecision);
    const finalReferences: SeedanceFinalPromptReference[] = orderedReferences.map(({ imageRef, asset }) => ({
      refId: imageRef.refId,
      type: imageRef.type,
      name: imageRef.name,
      assetId: asset.id,
      trackingId: imageRef.trackingId,
      variantKey: imageRef.variantKey,
      outfitSeq: imageRef.outfitSeq,
      concept: imageRef.concept,
      assetSource: asset.source,
      isNoFaceCharacterVisual: imageRef.isNoFaceCharacterVisual,
    }));
    const orderedImageRefs = buildVideoImageRefsFromOrderedReferences(orderedReferences, expectedImageRefs);
    const finalVoiceReferences = resolveStoryboardVoiceReferences({
      storyboard: currentSb,
      project: currentProject,
      videoConfig: state.videoApiConfig,
    });
    const sourceSnapshot = options?.sourceSnapshot ?? buildSeedanceFinalPromptSourceSnapshot({
      storyboard: storyboardForPrompt,
      boardPlan,
      references: finalReferences,
      voiceReferences: finalVoiceReferences,
      mode: modeConfig.mode,
      frameRatio: targetVideoFrameRatio,
      projectVisualStyle: buildBoardProjectVisualStyle(storyboardForPrompt, boardPlan, analysis?.styleConfig),
      cameraSegmentCount,
    });
    const seedanceStartedAt = Date.now();
    const seedancePromptTiming = beginStoryboardBoardSeedanceTiming(
      boardState?.generationTiming,
      seedanceStartedAt,
    );
    const seedancePromptBoardState = mergeStoryboardBoardVariant(boardContainer, modeConfig.mode, {
      generationTiming: seedancePromptTiming,
    });

    if (!state.apiConfig.apiKey) {
      const message = '请先在设置中填写 LLM API Key，才能生成 Seedance 最终视频词。';
      dispatch({
        type: 'UPDATE_STORYBOARD',
        index: currentIndex,
        projectId: targetProjectId,
        chapterId: targetChapterId,
        updates: {
          seedanceFinalVideoPromptStatus: 'failed',
          seedanceFinalVideoPromptError: message,
          seedanceFinalVideoPromptSourceSnapshot: sourceSnapshot,
          seedanceFinalVideoPromptUpdatedAt: Date.now(),
          videoImageRefs: orderedImageRefs,
          ...smartDurationUpdates,
          storyboardBoard: mergeStoryboardBoardVariant(seedancePromptBoardState, modeConfig.mode, {
            generationTiming: failStoryboardBoardSeedanceTiming(seedancePromptTiming, message),
          }),
        },
      });
      return null;
    }

    dispatch({
      type: 'UPDATE_STORYBOARD',
      index: currentIndex,
      projectId: targetProjectId,
      chapterId: targetChapterId,
        updates: {
          ...(isDirectorMode
            ? {
                status: 'generating' as const,
                error: undefined,
                step4StartedAt: seedanceStartedAt,
              }
            : {}),
          seedanceFinalVideoPromptStatus: 'generating',
          seedanceFinalVideoPromptError: undefined,
          seedanceFinalVideoPromptSourceSnapshot: sourceSnapshot,
        videoImageRefs: orderedImageRefs,
        seedanceFinalVideoPromptUpdatedAt: Date.now(),
        ...smartDurationUpdates,
        storyboardBoard: seedancePromptBoardState,
      },
    });

    try {
      let lastSeedancePromptPreview = '';
      let lastSeedancePromptPreviewAt = 0;
      const dispatchSeedancePromptPreview = (fullText: string, force = false) => {
        const trimmedText = fullText.trim();
        if (!trimmedText) return;
        const now = Date.now();
        const gainedChars = trimmedText.length - lastSeedancePromptPreview.length;
        if (!force && now - lastSeedancePromptPreviewAt < 750 && gainedChars < 160) return;
        lastSeedancePromptPreview = trimmedText;
        lastSeedancePromptPreviewAt = now;
        dispatch({
          type: 'UPDATE_STORYBOARD',
          index: currentIndex,
          projectId: targetProjectId,
          chapterId: targetChapterId,
          updates: {
            seedanceFinalVideoPrompt: trimmedText,
            seedanceFinalVideoPromptStatus: 'generating',
            seedanceFinalVideoPromptError: undefined,
            seedanceFinalVideoPromptSourceSnapshot: sourceSnapshot,
            seedanceFinalVideoPromptUpdatedAt: now,
            storyboardBoard: seedancePromptBoardState,
          },
        });
      };

      const seedancePromptController = new AbortController();
      activeSeedanceFinalPromptControllersRef.current.add(seedancePromptController);
      let finalPrompt = '';
      try {
        finalPrompt = await requestSeedanceFinalVideoPromptStream({
          storyboard: {
            ...storyboardForPrompt,
            storyboardBoard: seedancePromptBoardState,
          },
          boardPlan,
          references: finalReferences,
          voiceReferences: finalVoiceReferences,
          mode: modeConfig.mode,
          frameRatio: targetVideoFrameRatio,
          projectVisualStyle: buildBoardProjectVisualStyle(storyboardForPrompt, boardPlan, analysis?.styleConfig),
          cameraSegmentCount,
        }, (requestPayload, requestOptions, streamCallbacks) => requestSeedanceFinalPromptViaBffStream(
          requestPayload,
          requestOptions,
          state.apiConfig,
          targetVideoFrameRatio,
          streamCallbacks,
          {
            disableBackgroundJob: true,
            backgroundProgressMode: undefined,
          },
        ), {
          onProgress: (fullText) => dispatchSeedancePromptPreview(fullText),
        }, undefined, seedancePromptController.signal);
      } finally {
        activeSeedanceFinalPromptControllersRef.current.delete(seedancePromptController);
      }

      dispatchSeedancePromptPreview(finalPrompt, true);
      dispatch({
        type: 'UPDATE_STORYBOARD',
        index: currentIndex,
        projectId: targetProjectId,
        chapterId: targetChapterId,
        updates: {
          ...(isDirectorMode
            ? {
                status: 'done' as const,
                error: undefined,
                step4StartedAt: undefined,
              }
            : {}),
          seedanceFinalVideoPrompt: finalPrompt,
          seedanceFinalVideoPromptStatus: 'done',
          seedanceFinalVideoPromptError: undefined,
          seedanceFinalVideoPromptSourceSnapshot: sourceSnapshot,
          seedanceFinalVideoPromptUpdatedAt: Date.now(),
          ...smartDurationUpdates,
          storyboardBoard: mergeStoryboardBoardVariant(seedancePromptBoardState, modeConfig.mode, {
            generationTiming: completeStoryboardBoardSeedanceTiming(seedancePromptTiming),
          }),
        },
      });

      return finalPrompt;
    } catch (error) {
      if (isAbortLikeError(error)) return null;
      const message = error instanceof Error ? error.message : String(error);
      const statusError = message.startsWith('Seedance 最终视频词生成失败')
        ? message
        : `Seedance 最终视频词生成失败：${message}`;
      dispatch({
        type: 'UPDATE_STORYBOARD',
        index: currentIndex,
        projectId: targetProjectId,
        chapterId: targetChapterId,
        updates: {
          ...(isDirectorMode
            ? {
                status: 'error' as const,
                error: statusError,
                step4StartedAt: undefined,
              }
            : {}),
          seedanceFinalVideoPromptStatus: 'failed',
          seedanceFinalVideoPromptError: message,
          seedanceFinalVideoPromptSourceSnapshot: sourceSnapshot,
          seedanceFinalVideoPromptUpdatedAt: Date.now(),
          ...smartDurationUpdates,
          storyboardBoard: mergeStoryboardBoardVariant(seedancePromptBoardState, modeConfig.mode, {
            generationTiming: failStoryboardBoardSeedanceTiming(seedancePromptTiming, message),
          }),
        },
      });
      return null;
    }
  }, [
    analysis?.styleConfig,
    baseUsedReferences,
    boardContainer,
    boardState,
    currentChapter?.id,
    currentIndex,
    currentProject,
    currentSb,
    dispatch,
    lockedSmartPanelCount,
    modeConfig.mode,
    smartDurationCompressionEnabled,
    state.apiConfig,
    state.globalTaskSettings?.step4LlmExecutionMode,
    state.videoApiConfig,
    targetVideoFrameRatio,
    isDirectorMode,
  ]);

  const importBoardImageFromUrl = useCallback(async (imageUrl: string) => {
    const targetProjectId = currentProject?.id;
    const targetChapterId = currentChapter?.id;
    if (!targetProjectId || !targetChapterId) {
      throw new Error('当前项目或章节不可用，无法导入 Shot Sheet。');
    }

    const trimmedUrl = imageUrl.trim();
    if (!trimmedUrl) {
      throw new Error('请先粘贴已完成图片 URL。');
    }
    if (!/^https?:\/\//i.test(trimmedUrl) && !trimmedUrl.startsWith('/')) {
      throw new Error('图片地址必须是 http(s) URL，或当前站点下的 / 开头路径。');
    }

    const plan = hasFreshPlan && rawBoardState?.plan ? rawBoardState.plan : boardState?.plan;
    if (!plan) {
      throw new Error('缺少可用导演规划，不能把外部图片写入当前分镜。');
    }

    let response: Response;
    try {
      response = await fetch(trimmedUrl, { cache: 'no-store' });
    } catch (error) {
      throw new Error(`读取图片失败：${error instanceof Error ? error.message : String(error)}。如果是跨域限制，请把图片放到 public 目录后使用同源路径导入。`);
    }
    if (!response.ok) {
      throw new Error(`读取图片失败：HTTP ${response.status}`);
    }

    const importedBlob = await response.blob();
    if (importedBlob.size === 0) {
      throw new Error('读取到的图片为空。');
    }
    if (importedBlob.type && !importedBlob.type.startsWith('image/')) {
      throw new Error(`读取到的内容不是图片：${importedBlob.type}`);
    }

    const orderedReferences = sortResolvedReferencesByPlan(baseUsedReferences, plan);
    const referenceAssetIds = orderedReferences.map(({ asset }) => asset.id);
    const finalReferences: SeedanceFinalPromptReference[] = orderedReferences.map(({ imageRef, asset }) => ({
      refId: imageRef.refId,
      type: imageRef.type,
      name: imageRef.name,
      assetId: asset.id,
      trackingId: imageRef.trackingId,
      variantKey: imageRef.variantKey,
      outfitSeq: imageRef.outfitSeq,
      concept: imageRef.concept,
      assetSource: asset.source,
      isNoFaceCharacterVisual: imageRef.isNoFaceCharacterVisual,
    }));
    const orderedImageRefs = buildVideoImageRefsFromOrderedReferences(orderedReferences, expectedImageRefs);
    const finalVoiceReferences = resolveStoryboardVoiceReferences({
      storyboard: currentSb,
      project: currentProject,
      videoConfig: state.videoApiConfig,
    });
    const finalPromptSourceSnapshot = buildSeedanceFinalPromptSourceSnapshot({
      storyboard: currentSb,
      boardPlan: plan,
      references: finalReferences,
      voiceReferences: finalVoiceReferences,
      mode: modeConfig.mode,
      frameRatio: modeConfig.frameRatio,
      projectVisualStyle: buildBoardProjectVisualStyle(currentSb, plan, analysis?.styleConfig),
      cameraSegmentCount,
    });

    const blobKey = await saveBlob(importedBlob);
    const previousBlobKey = rawBoardState?.blobKey;
    const previousVisualBoardBlobKey = rawBoardState?.visualBoardBlobKey;
    const previousLightweightBlobKey = rawBoardState?.lightweightBlobKey;
    const previousReferencePack = rawBoardState?.referencePack ?? [];

    dispatch({
      type: 'UPDATE_STORYBOARD',
      index: currentIndex,
      projectId: targetProjectId,
      chapterId: targetChapterId,
      updates: {
        ...(isDirectorMode
          ? {
              status: 'done' as const,
              error: undefined,
              step4StartedAt: undefined,
            }
          : {}),
        videoImageRefs: orderedImageRefs,
        storyboardBoard: replaceStoryboardBoardVariant(boardContainer, modeConfig.mode, {
          status: 'done',
          boardStyle,
          generatedForOutputMode: currentSb.generatedStep4OutputMode ?? currentSb.step4OutputMode ?? 'prompt',
          visualBoardBlobKey: undefined,
          blobKey,
          referencePack: [],
          startedAt: undefined,
          generatedAt: Date.now(),
          error: undefined,
          isStale: false,
          layout: modeConfig.layout,
          frameRatio: modeConfig.frameRatio,
          imageSize: storyboardBoardImageSize,
          promptSnapshot: sourceSnapshot,
          referenceAssetIds,
          plan,
          planStatus: 'done',
          planGeneratedAt: boardState?.planGeneratedAt ?? Date.now(),
          planError: boardState?.planError,
          planIsStale: false,
          planPromptSnapshot: planSourceSnapshot,
          planReferenceAssetIds: referenceAssetIds,
        }),
        useStoryboardBoardReference: true,
        seedanceFinalVideoPromptStatus: 'idle',
        seedanceFinalVideoPrompt: '',
        seedanceFinalVideoPromptError: undefined,
        seedanceFinalVideoPromptSourceSnapshot: finalPromptSourceSnapshot,
        seedanceFinalVideoPromptUpdatedAt: Date.now(),
      },
    });

    if (previousBlobKey && previousBlobKey !== blobKey) {
      deleteBlob(previousBlobKey).catch(() => undefined);
    }
    if (previousVisualBoardBlobKey) {
      deleteBlob(previousVisualBoardBlobKey).catch(() => undefined);
    }
    if (previousLightweightBlobKey) {
      deleteBlob(previousLightweightBlobKey).catch(() => undefined);
    }
    previousReferencePack.forEach((item) => {
      deleteBlob(item.blobKey).catch(() => undefined);
    });

    await generateSeedanceFinalVideoPrompt({
      boardPlan: plan,
      references: orderedReferences,
      sourceSnapshot: finalPromptSourceSnapshot,
    });

    return blobKey;
  }, [
    analysis?.styleConfig,
    baseUsedReferences,
    boardContainer,
    boardState?.plan,
    boardState?.planError,
    boardState?.planGeneratedAt,
    boardStyle,
    currentChapter?.id,
    currentIndex,
    currentProject,
    currentSb,
    dispatch,
    generateSeedanceFinalVideoPrompt,
    hasFreshPlan,
    isDirectorMode,
    modeConfig.frameRatio,
    modeConfig.layout,
    modeConfig.mode,
    planSourceSnapshot,
    rawBoardState,
    sourceSnapshot,
    state.videoApiConfig,
    storyboardBoardImageSize,
  ]);

  const seedanceFinalPromptDisabledReason = useMemo(() => {
    return getSeedanceFinalPromptDisabledReason({
      isDirectorMode,
      commonDisabledReason,
      hasBoardPlan: !!boardState?.plan,
      hasFreshImage,
      hasUsableDirectorImage,
      isGenerating: seedanceFinalPromptState.status === 'generating',
      hasLlmApiKey: !!state.apiConfig.apiKey,
    });
  }, [boardState?.plan, commonDisabledReason, hasFreshImage, hasUsableDirectorImage, isDirectorMode, seedanceFinalPromptState.status, state.apiConfig.apiKey]);

  const repairBoardText = useCallback(async () => {
    const targetProjectId = currentProject?.id;
    const targetChapterId = currentChapter?.id;
    if (
      !targetProjectId
      || !targetChapterId
      || !boardState?.blobKey
      || boardState.visualBoardBlobKey
      || !boardState.plan
      || !shouldRepairStoryboardBoardText(modeConfig.mode, boardStyle)
    ) return;

    const sourceBlob = await loadCloudBackedBlob(boardState.blobKey, targetProjectId);
    if (!sourceBlob) return;

    const repairedBlob = await repairStoryboardBoardTextBlob(sourceBlob, {
      mode: modeConfig.mode,
      storyboard: currentSb,
      plan: boardState.plan,
    });
    const blobKey = await saveBlob(repairedBlob);
    const previousBlobKey = boardState.blobKey;

    dispatch({
      type: 'UPDATE_STORYBOARD',
      index: currentIndex,
      projectId: targetProjectId,
      chapterId: targetChapterId,
      updates: {
        storyboardBoard: mergeStoryboardBoardVariant(boardContainer, modeConfig.mode, {
          blobKey,
          boardStyle,
          status: 'done',
          generatedAt: Date.now(),
          error: undefined,
          isStale: false,
        }),
      },
    });

    if (previousBlobKey && previousBlobKey !== blobKey) {
      deleteBlob(previousBlobKey).catch(() => undefined);
    }
  }, [
    boardContainer,
    boardState,
    boardStyle,
    currentChapter?.id,
    currentIndex,
    currentProject?.id,
    currentSb,
    dispatch,
    modeConfig.mode,
  ]);

  const setBoardMode = useCallback((mode: StoryboardBoardMode) => {
    const targetProjectId = currentProject?.id;
    const targetChapterId = currentChapter?.id;
    if (!targetProjectId || !targetChapterId) return;

    dispatch({
      type: 'SET_STORYBOARD_BOARD_MODE',
      mode,
      projectId: targetProjectId,
      chapterId: targetChapterId,
    });
  }, [currentChapter?.id, currentProject?.id, dispatch]);

  const setBoardStyle = useCallback((style: StoryboardBoardStyle) => {
    const targetProjectId = currentProject?.id;
    const targetChapterId = currentChapter?.id;
    if (!targetProjectId || !targetChapterId) return;

    dispatch({
      type: 'UPDATE_STORYBOARD',
      index: currentIndex,
      projectId: targetProjectId,
      chapterId: targetChapterId,
      updates: {
        storyboardBoardStyle: style,
        storyboardBoard: boardContainer
            ? mergeStoryboardBoardVariant(boardContainer, modeConfig.mode, {
              boardStyle: style,
              isStale: !!boardState?.blobKey || !!boardState?.visualBoardBlobKey || boardState?.isStale,
            })
          : boardContainer,
        seedanceFinalVideoPrompt: '',
        seedanceFinalVideoPromptStatus: 'idle',
        seedanceFinalVideoPromptError: undefined,
        seedanceFinalVideoPromptSourceSnapshot: '',
        seedanceFinalVideoPromptUpdatedAt: undefined,
      },
    });
  }, [boardContainer, boardState?.blobKey, boardState?.isStale, boardState?.visualBoardBlobKey, currentChapter?.id, currentIndex, currentProject?.id, dispatch, modeConfig.mode]);

  const clearBoard = useCallback(async () => {
    if (!boardState) return;
    const targetProjectId = currentProject?.id;
    const targetChapterId = currentChapter?.id;
    if (!targetProjectId || !targetChapterId) return;
    if (boardState.blobKey) {
      await deleteBlob(boardState.blobKey).catch(() => undefined);
    }
    if (boardState.visualBoardBlobKey) {
      await deleteBlob(boardState.visualBoardBlobKey).catch(() => undefined);
    }
    if (boardState.lightweightBlobKey) {
      await deleteBlob(boardState.lightweightBlobKey).catch(() => undefined);
    }
    await Promise.all((boardState.referencePack ?? []).map((item) => deleteBlob(item.blobKey).catch(() => undefined)));
    dispatch({
      type: 'UPDATE_STORYBOARD',
      index: currentIndex,
      projectId: targetProjectId,
      chapterId: targetChapterId,
      updates: {
        storyboardBoard: replaceStoryboardBoardVariant(
          boardContainer,
          modeConfig.mode,
          createEmptyStoryboardBoardVariant(modeConfig.mode),
        ),
        seedanceFinalVideoPrompt: '',
        seedanceFinalVideoPromptStatus: 'idle',
        seedanceFinalVideoPromptError: undefined,
        seedanceFinalVideoPromptSourceSnapshot: '',
        seedanceFinalVideoPromptUpdatedAt: undefined,
      },
    });
  }, [boardContainer, boardState, currentChapter?.id, currentIndex, currentProject?.id, dispatch, modeConfig.mode]);

  const downloadBoard = useCallback(async () => {
    if (!boardState?.blobKey) return;
    const blob = await loadCloudBackedBlob(boardState.blobKey, currentProject?.id);
    if (!blob) return;
    const modeSuffix = selectedMode === 'shot-plan-landscape'
      ? `shot-plan-${modeConfig.frameRatio.replace(':', 'x')}`
      : selectedMode === 'smart-shot-plan-landscape'
        ? `smart-storyboard-${modeConfig.frameRatio.replace(':', 'x')}`
      : selectedMode === 'nine-landscape'
        ? '9grid-landscape-16x9'
        : '9grid-portrait-9x16';
    const fileName = `${String(currentSb.storyboard.number).padStart(2, '0')}_${currentSb.storyboard.name}_storyboard-board_${modeSuffix}.png`;
    downloadBlobFile(blob, fileName);
  }, [boardState, currentProject?.id, currentSb.storyboard.name, currentSb.storyboard.number, modeConfig.frameRatio, selectedMode]);

  return {
    boardState,
    selectedMode,
    modeConfig,
    previewUrl,
    visualPreviewUrl,
    storyboardBoardReferenceEnabled: currentSb.useStoryboardBoardReference || isDirectorMode,
    boardPromptPreview,
    boardPlanPreview,
    seedanceFinalPromptPreview: seedanceFinalPromptState.prompt,
    seedanceFinalPromptState,
    seedanceFinalPromptSourceSnapshot,
    seedanceFinalPromptDisabledReason,
    usedReferences,
    missingReferenceLabels,
    conditionChecks,
    qualityReport,
    episodeShotSheetSegment,
    sequenceContinuityContext,
    boardStyle,
    hasFreshPlan,
    optimizeDisabledReason,
    generateDisabledReason,
    isGenerating: boardState?.status === 'generating',
    isOptimizingPlan: boardState?.planStatus === 'optimizing',
    abortBoardGenerationRequests,
    setBoardMode,
    setBoardStyle,
    optimizeBoardPlan,
    generateBoard,
    generateSeedanceFinalVideoPrompt,
    importBoardImageFromUrl,
    repairBoardText,
    clearBoard,
    downloadBoard,
  };
}
