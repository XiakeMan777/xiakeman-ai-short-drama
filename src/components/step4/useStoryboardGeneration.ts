// ============================================================
// Step4: 分镜提示词生成 hook
// 5段LLM流程：检查(check) → 修正(correct) → 动作编排(choreograph) → 编排校验(choreo_check) → 生成(generate)
// 封装单镜生成、批量生成、取消批量逻辑
// ============================================================

import { useCallback, useRef, useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { useApiCall } from '@/hooks/useApiCall';
import { useCurrentProject } from '@/stores/projectStore';
import { bffChatCompleteStream } from '@/lib/bff-client';
import {
  buildCheckPrompt,
  buildCorrectPrompt,
  buildChoreographPrompt,
  buildChoreoCheckPrompt,
  buildGenerateWithChoreographyPrompt,
  buildOfficialVirtualHumanGenerateWithChoreographyPrompt,
} from '@/lib/prompt-templates/build-context-L3';
import { buildStoryboardSourceContexts, resolveStoryboardSourceScriptText } from '@/lib/storyboardSource';
import { runSelfCheck } from '@/lib/self-check';
import { generateImage, hasEffectiveImageApiKey, normalizeImageSizeForConfig } from '@/lib/imageApiClient';
import { deleteBlob, saveBlob } from '@/lib/imageStore';
import { loadPreferredAssetBlob } from '@/lib/assetImageVariants';
import {
  countStoryboardStep4Pending,
  getMissingImageReferenceLabels,
  isStoryboardPromptReady,
  isStoryboardStep4AutoGeneratePending,
} from '@/lib/storyboardReadiness';
import { getErrorMessage, isTransientApiError } from '@/lib/transientApiError';
import {
  DEFAULT_STORYBOARD_BOARD_IMAGE_SIZE,
  DEFAULT_STORYBOARD_BOARD_MODE,
  getStoryboardBoardSelectedMode,
  markStoryboardBoardStale,
  isStoryboardBoardImageFresh,
  mergeStoryboardBoardVariant,
  normalizeStoryboardBoardState,
  getStoryboardBoardVariant,
  replaceStoryboardBoardVariant,
} from '@/lib/storyboardBoardState';
import { getFrameAspectRatio, normalizeFrameRatio, type FrameRatio } from '@/lib/frameRatio';
import { resolveStoryboardProjectVisualStyle } from '@/lib/projectVisualStyle';
import { DEFAULT_STEP4_OUTPUT_MODE, DEFAULT_STORYBOARD_DIRECTOR_RUN_MODE } from '@/lib/storage';
import { getLockedSmartStoryboardPanelCount, normalizeSmartStoryboardPanelCountPreference } from '@/lib/smartStoryboardPanelCount';
import { resolveStoryboardCameraSegmentCount } from '@/lib/storyboardCameraSegments';
import { sanitizeStoryboardInfo } from '@/lib/storyboardCharacterSanitizer';
import { isCharacterAssetAllowedForImageRef } from '@/lib/characterReferenceUtils';
import {
  assertDialogueFidelity,
  compareDialogueFidelity,
  extractDialogueEntriesFromChoreography,
  extractDialogueEntriesFromText,
  type DialogueFidelityOptions,
  splitDialogueField,
} from '@/lib/dialogueFidelity';
import { ensurePromptDialogueAudioTimings } from '@/lib/dialogueAudioTiming';
import { buildInterruptedStoryboardSignature } from './recoverySignature';
import { parseCorrectResult } from './storyboardCorrectResult';
import { parseChoreoCheckResult, extractFirstJsonObject, parseLogicFixes } from './storyboardChoreoCheckParsing';
import { selectPrimaryStoryboardSourceText } from './storyboardSourceSelection';
import { augmentStoryboardCharactersFromText } from './storyboardCharacterAugment';
import { computeImageRefs } from './storyboardImageRefs';
import { findMatchingImageRef } from './storyboardReferenceResolver';
import { selectVideoImageRefs } from './videoImageBudget';
import { getVideoImageReferenceLimit } from '@/lib/volcengineVideoModels';
import { sanitizeUnboundTemporaryRoleAliases } from './promptRoleAliasSanitizer';
import { sanitizeMisboundImageReferenceLabels } from './promptImageRefSanitizer';
import { extractLastFrameInfo, parsePromptFromRawText } from './storyboardPromptParsing';
import { normalizeVideoPromptText } from './officialVirtualHumanPromptText';
import { applyInferredScenePositionPointsToChoreography } from './scenePositionBoard';
import { buildStoryboardBoardPrompt, sortStoryboardBoardReferencesByPlanPriority } from './storyboardBoardPrompt';
import { composeStoryboardBoardBlob, isComposableStoryboardBoardMode } from './storyboardBoardComposer';
import { getStoryboardBoardModeSpec, isShotPlanBoardMode, isSmartShotPlanBoardMode } from './storyboardBoardMode';
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
import { resolveStoryboardBoardReferences } from './storyboardReferenceResolver';
import { buildStoryboardBoardSourceSnapshot } from './useStoryboardBoardGeneration';
import {
  buildSeedanceFinalPromptSourceSnapshot,
  getSeedanceFinalVideoPromptState,
  requestSeedanceFinalVideoPromptStream,
  type SeedanceFinalPromptReference,
  type SeedanceFinalVideoPromptStreamCallbacks,
} from './seedanceFinalPrompt';
import {
  buildRecoverableStoryboardBoard,
  getRecoverableStoryboardBoardActionDirectorPlan,
  getRecoverableStoryboardBoardPlan,
  getRecoverableStoryboardDirectorBrief,
  markRecoverableStoryboardBoardImageFailed,
} from './storyboardBoardRecovery';
import {
  buildStoryboardBoardQualityRepairHint,
  evaluateStoryboardBoardQuality,
  getStoryboardBoardQualityBlockingChecks,
  summarizeStoryboardBoardQualityWarnings,
} from './storyboardBoardQuality';
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
import { buildEpisodeShotSheet, getEpisodeShotSheetSegment } from './episodeShotSheet';
import { buildStoryboardSequenceContinuityContext } from './storyboardSequenceContinuity';
import { resolveStoryboardVoiceReferences } from '@/lib/characterVoiceReferences';
import {
  buildSceneSpatialBible,
  filterSpatialBlockingCharacters,
  resolveChoreographyEndBlocking,
  resolveChoreographyStartBlocking,
  summarizeSpatialBlocking,
  validateSpatialContinuity,
} from './spatialBlocking';
import {
  StoryboardStageTimeoutError,
  hasRecognizedChoreoCheckOutput,
  requireStageText,
  throwRequiredStageCause,
  throwRequiredStageError,
} from './storyboardRequiredStages';
import {
  canReuseExistingImageRefBinding,
  getSpatialContinuityCharacterNames,
  shouldUseOfficialVirtualHumanGenerateTemplate,
} from './storyboardGenerationHelpers';
import {
  STORYBOARD_ACTION_DIRECTOR_LLM_PARAMS,
  STORYBOARD_BOARD_PLAN_LLM_PARAMS,
  STORYBOARD_BOARD_PLAN_REPAIR_LLM_PARAMS,
  STORYBOARD_COMPACT_BOARD_PLAN_LLM_PARAMS,
  STORYBOARD_DIRECTOR_BRIEF_LLM_PARAMS,
  STORYBOARD_DIRECTOR_BRIEF_REPAIR_LLM_PARAMS,
} from './storyboardLlmParams';
import {
  applySmartDurationToDirectorBrief,
  applySmartDurationToStoryboardForPrompt,
  buildSmartStoryboardDurationRejudgeHint,
  buildSmartStoryboardDurationUpdates,
  resolveSmartStoryboardDurationDecision,
} from './smartStoryboardDuration';
import type { ChatMessage as ApiChatMessage } from '@/lib/api-client';
import { canStartGlobalTask, getGlobalTaskPermanentBlockReason } from '@/lib/globalTaskDependencies';
import type { ApiConfig, AppState, GlobalTask, ImageReference, StoryboardState, SceneBlueprint, Choreography, Step4GenerateMode, StoryboardInfo, StoryboardBoardDirectorBrief, StoryboardBoardMode, Step4OutputMode, StoryboardBoardPlan, StoryboardDirectorRunMode, SpatialBlockingSnapshot } from '@/types';

type ChatMessage = ApiChatMessage;
type ActiveStreamStageLabel =
  | '导演阐述'
  | '15格故事板规划'
  | '智能故事板规划'
  | '规划格式修复'
  | '规划质量修复'
  | '动作导演连续性调度'
  | '已保留导演阐述，准备重试规划'
  | '已保留导演规划，准备重试图片'
  | '15格 Shot Sheet 图片生成'
  | '15格 Shot Sheet 图片重试（已保留导演规划）'
  | '智能故事板图片生成'
  | '智能故事板图片重试（已保留导演规划）'
  | 'Seedance 最终视频词'
  | '最终提示词生成';

export { parseChoreoCheckResult } from './storyboardChoreoCheckParsing';

const STORYBOARD_FLOW_RETRY_DELAYS_MS = [4000, 9000, 18000];
const STEP4_LLM_STAGE_TIMEOUT_MS = 0;
const STEP4_LLM_STREAM_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const CHOREOGRAPH_STAGE_TIMEOUT_MS = STEP4_LLM_STAGE_TIMEOUT_MS;
const CHOREO_CHECK_STAGE_TIMEOUT_MS = STEP4_LLM_STAGE_TIMEOUT_MS;
const STORYBOARD_BOARD_BRIEF_TIMEOUT_MS = STEP4_LLM_STAGE_TIMEOUT_MS;
const STORYBOARD_BOARD_PLAN_TIMEOUT_MS = STEP4_LLM_STAGE_TIMEOUT_MS;
const STORYBOARD_BOARD_BATCH_IMAGE_TIMEOUT_MS = 20 * 60 * 1000;
const STORYBOARD_BOARD_SINGLE_IMAGE_TIMEOUT_MS = 20 * 60 * 1000;
const STORYBOARD_BOARD_IMAGE_CONCURRENCY = 3;
const STORYBOARD_BOARD_BATCH_IMAGE_CONCURRENCY = 1;
const SEEDANCE_FINAL_PROMPT_CONCURRENCY = 1;
const SEEDANCE_FINAL_PROMPT_MAX_CONCURRENCY = 2;
const STORYBOARD_BATCH_PIPELINE_POLL_MS = 650;
const STEP4_BATCH_TASK_CONCURRENCY = 1;
const STEP4_BATCH_TASK_MAX_CONCURRENCY = 10;
const STEP4_DIALOGUE_FIDELITY_OPTIONS: DialogueFidelityOptions = { warnOnly: true };
const GLOBAL_TASK_STREAM_UPDATE_INTERVAL_MS = 120;
const GLOBAL_TASK_STREAM_UPDATE_MIN_CHARS = 24;
const activeStep4BatchSessionIds = new Set<string>();
let activeStoryboardBoardImageGenerations = 0;
const storyboardBoardImageWaiters: Array<() => void> = [];
let activeSeedanceFinalPromptGenerations = 0;
const seedanceFinalPromptWaiters: Array<() => void> = [];

class SeedanceFinalPromptGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedanceFinalPromptGenerationError';
  }
}

function getImageReferenceNumber(value: string | undefined) {
  return value?.match(/\d+/)?.[0] ?? '';
}

function remapReferenceIdWithBudgetMap(refId: string | undefined, refIdMap: Record<string, string>) {
  if (!refId) return undefined;
  if (refIdMap[refId]) return refIdMap[refId];
  const targetNumber = getImageReferenceNumber(refId);
  if (!targetNumber) return undefined;
  const match = Object.entries(refIdMap).find(([sourceRefId]) =>
    getImageReferenceNumber(sourceRefId) === targetNumber,
  );
  return match?.[1];
}

function remapDirectorBriefReferenceIds(
  directorBrief: StoryboardBoardDirectorBrief,
  refIdMap: Record<string, string>,
): StoryboardBoardDirectorBrief {
  const referenceMatching = (directorBrief.referenceMatching ?? [])
    .map((match) => ({
      ...match,
      refId: remapReferenceIdWithBudgetMap(match.refId, refIdMap),
    }))
    .filter((match) => !!match.refId);
  const referenceBudget = (directorBrief.referenceBudget ?? [])
    .map((item) => ({
      ...item,
      refId: remapReferenceIdWithBudgetMap(item.refId, refIdMap) ?? '',
    }))
    .filter((item) => !!item.refId);
  const referencePriority = (directorBrief.referencePriority ?? [])
    .map((refId) => remapReferenceIdWithBudgetMap(refId, refIdMap))
    .filter((refId, index, source): refId is string => !!refId && source.indexOf(refId) === index);

  return {
    ...directorBrief,
    referenceMatching,
    referenceBudget,
    referencePriority,
  };
}

function getStoryboardPlanStageLabel(mode: StoryboardBoardMode) {
  return isSmartShotPlanBoardMode(mode) ? '智能故事板规划' : '15格故事板规划';
}

function getStoryboardPlanTimeoutLabel(mode: StoryboardBoardMode, suffix = '') {
  return isSmartShotPlanBoardMode(mode) ? `故事板智能规划${suffix}` : `故事板15格规划${suffix}`;
}

function getStoryboardImageStageLabel(mode: StoryboardBoardMode, retry = false) {
  if (isSmartShotPlanBoardMode(mode)) {
    return retry ? '智能故事板图片重试（已保留导演规划）' : '智能故事板图片生成';
  }
  return retry ? '15格 Shot Sheet 图片重试（已保留导演规划）' : '15格 Shot Sheet 图片生成';
}

function getStep4StreamStageTimeoutMs(stageLabel: string | null | undefined): number | undefined {
  if (!stageLabel) return undefined;
  if (stageLabel.includes('图片')) return STORYBOARD_BOARD_BATCH_IMAGE_TIMEOUT_MS;
  if (stageLabel.includes('阐述')) return STEP4_LLM_STREAM_IDLE_TIMEOUT_MS;
  if (
    stageLabel.includes('规划')
    || stageLabel.includes('动作导演')
    || stageLabel.includes('格式修复')
    || stageLabel.includes('质量修复')
  ) {
    return STEP4_LLM_STREAM_IDLE_TIMEOUT_MS;
  }
  if (
    stageLabel.includes('逻辑检查')
    || stageLabel.includes('修正剧本')
    || stageLabel.includes('动作编排')
    || stageLabel.includes('编排校验')
    || stageLabel.includes('最终提示词')
  ) {
    return STEP4_LLM_STREAM_IDLE_TIMEOUT_MS;
  }
  return undefined;
}

function getStep4StreamStageTimeoutMode(stageLabel: string | null | undefined): 'hard' | 'idle' | undefined {
  if (!stageLabel) return undefined;
  return stageLabel.includes('图片') ? 'hard' : 'idle';
}

function normalizeStoryboardBoardImageConcurrency(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return STORYBOARD_BOARD_IMAGE_CONCURRENCY;
  return Math.max(1, Math.min(2, Math.floor(value)));
}

async function acquireStoryboardBoardImageSlot(maxConcurrency: number): Promise<void> {
  while (activeStoryboardBoardImageGenerations >= maxConcurrency) {
    await new Promise<void>((resolve) => {
      storyboardBoardImageWaiters.push(resolve);
    });
  }
  activeStoryboardBoardImageGenerations += 1;
}

function releaseStoryboardBoardImageSlot() {
  activeStoryboardBoardImageGenerations = Math.max(0, activeStoryboardBoardImageGenerations - 1);
  storyboardBoardImageWaiters.shift()?.();
}

async function runConcurrentStoryboardBoardImageGeneration<T>(
  run: () => Promise<T>,
  maxConcurrency = STORYBOARD_BOARD_IMAGE_CONCURRENCY,
): Promise<T> {
  await acquireStoryboardBoardImageSlot(normalizeStoryboardBoardImageConcurrency(maxConcurrency));
  try {
    return await run();
  } finally {
    releaseStoryboardBoardImageSlot();
  }
}

function normalizeSeedanceFinalPromptConcurrency(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SEEDANCE_FINAL_PROMPT_CONCURRENCY;
  return Math.max(1, Math.min(SEEDANCE_FINAL_PROMPT_MAX_CONCURRENCY, Math.floor(value)));
}

async function acquireSeedanceFinalPromptSlot(maxConcurrency: number): Promise<void> {
  while (activeSeedanceFinalPromptGenerations >= maxConcurrency) {
    await new Promise<void>((resolve) => {
      seedanceFinalPromptWaiters.push(resolve);
    });
  }
  activeSeedanceFinalPromptGenerations += 1;
}

function releaseSeedanceFinalPromptSlot() {
  activeSeedanceFinalPromptGenerations = Math.max(0, activeSeedanceFinalPromptGenerations - 1);
  seedanceFinalPromptWaiters.shift()?.();
}

async function runConcurrentSeedanceFinalPromptGeneration<T>(
  run: () => Promise<T>,
  maxConcurrency = SEEDANCE_FINAL_PROMPT_CONCURRENCY,
): Promise<T> {
  await acquireSeedanceFinalPromptSlot(normalizeSeedanceFinalPromptConcurrency(maxConcurrency));
  try {
    return await run();
  } finally {
    releaseSeedanceFinalPromptSlot();
  }
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
    frameRatio: targetFrameRatio,
    aspectRatio: isShotPlanBoardMode(mode)
      ? getFrameAspectRatio(targetFrameRatio)
      : mode === 'nine-landscape' ? 'LANDSCAPE' as const : 'PORTRAIT' as const,
  };
}

function getStoryboardRequestedOutputMode(
  storyboard: StoryboardState,
  chapterMode?: Step4OutputMode,
): Step4OutputMode {
  return chapterMode ?? storyboard.step4OutputMode ?? DEFAULT_STEP4_OUTPUT_MODE;
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

function buildBoardReferenceLabel(refId: string, type: ImageReference['type'], name: string, projectVisualStyle: string) {
  return [
    `${refId} / ${name}`,
    `当前项目视觉风格：${projectVisualStyle}`,
    type === 'scene'
      ? '类型：场景空间参考，只锁定空间、材质、光线方向'
      : type === 'character'
        ? '类型：Step3 角色身份参考，供九宫格故事板锁定角色身份与动作调度'
        : '类型：道具参考，只锁定外观、材质、颜色和持有关系',
  ].join('\n');
}

function storyboardBoardPlanToSpatialBlocking(
  plan: StoryboardBoardPlan,
  sceneName?: string,
): SpatialBlockingSnapshot | undefined {
  if (plan.blockingContinuity.endBlocking) return plan.blockingContinuity.endBlocking;
  const characterLocks = plan.characterLocks.filter((lock) => lock.role !== 'background').slice(0, 4);
  if (characterLocks.length === 0) return undefined;
  const lastPanel = plan.panels.at(-1);
  return {
    sceneName,
    sceneAnchor: plan.worldLock.actionZone || plan.worldLock.anchors.join(' / ') || plan.sceneAnchor,
    cameraAxis: plan.cameraPlan.cameraAxis || plan.cameraPlan.cameraRelation,
    characters: characterLocks.map((lock, index) => ({
      character: lock.name,
      position: lastPanel?.continuityOut || lastPanel?.blocking || plan.blockingContinuity.currentEnd,
      facing: lastPanel?.cameraTask || plan.cameraPlan.cameraRelation,
      posture: lastPanel?.motion,
      notes: [
        lastPanel?.worldAnchor ? `世界锚点：${lastPanel.worldAnchor}` : '',
        lastPanel?.directorNote,
      ].filter(Boolean).join('；'),
      positionPoint: index === 0
        ? { x: 0.42, y: 0.7 }
        : { x: Math.min(0.78, 0.42 + index * 0.16), y: 0.7 },
    })),
    continuityNotes: plan.blockingContinuity.currentEnd || lastPanel?.continuityOut || lastPanel?.continuity,
  };
}

/** 从检查输出中解析物品状态更新 */
function parseItemTrackerUpdate(text: string): Record<string, string> {
  const tracker: Record<string, string> = {};
  const trackerSection = text.match(/【物品状态更新】\s*\n([\s\S]*?)(?:\n\s*\n|$)/);
  if (!trackerSection) return tracker;
  const lines = trackerSection[1].split('\n').filter((l) => l.trim());
  for (const line of lines) {
    const match = line.match(/^[-•*]?\s*(.+?)[:：]\s*(.+)$/);
    if (match) {
      tracker[match[1].trim()] = match[2].trim();
    }
  }
  return tracker;
}

/** 从检查输出中解析创作分析建议 */
function parsePreprocessNotes(text: string): string {
  const notes: string[] = [];

  const executionMatch = text.match(/【执行诊断】\s*\n([\s\S]*?)(?=\n【|$)/);
  if (executionMatch) notes.push(`【执行诊断】\n${executionMatch[1].trim()}`);

  const cameraMatch = text.match(/【运镜建议】\s*\n([\s\S]*?)(?=\n【|\n\n|$)/);
  if (cameraMatch) notes.push(`【运镜建议】\n${cameraMatch[1].trim()}`);

  const emotionMatch = text.match(/【情绪走向】\s*\n([\s\S]*?)(?=\n【|\n\n|$)/);
  if (emotionMatch) notes.push(`【情绪走向】\n${emotionMatch[1].trim()}`);

  const rhythmMatch = text.match(/【节奏建议】\s*\n([\s\S]*?)(?=\n【|\n\n|$)/);
  if (rhythmMatch) notes.push(`【节奏建议】\n${rhythmMatch[1].trim()}`);

  return notes.length > 0 ? notes.join('\n\n') : '';
}

/** 构建前序分镜的逻辑修正摘要（链式传递给后续分镜） */
function buildPrevLogicFixSummary(
  allStoryboards: StoryboardState[],
  currentIndex: number,
): string {
  const recentIndices = Array.from({ length: currentIndex }, (_, index) => index).slice(-2);
  const prevFixes: string[] = [];
  for (const i of recentIndices) {
    const sb = allStoryboards[i];
    if (sb.logicFixes?.length > 0) {
      const fixes = sb.logicFixes
        .map((f, j) => `  修正${j + 1}: ${f.correction}`)
        .join('\n');
      prevFixes.push(`分镜${String(sb.storyboard.number).padStart(2, '0')} (${sb.storyboard.name}):\n${fixes}`);
    }
  }
  return prevFixes.length > 0
    ? `## 前序分镜逻辑修正记录（已在提示词中生效，请保持一致）\n${prevFixes.join('\n\n')}`
    : '';
}

function buildStoryboardNarrativeSummary(sb: StoryboardState): string {
  const parts: string[] = [];
  if (sb.prompt?.scene) parts.push(sb.prompt.scene.slice(0, 60));
  if (sb.prompt?.characters) parts.push(sb.prompt.characters.slice(0, 60));
  if (sb.correctedScript) parts.push(sb.correctedScript.slice(0, 120));
  if (sb.lastFrameInfo) parts.push(sb.lastFrameInfo.slice(0, 120));
  if (sb.spatialBlocking) parts.push(summarizeSpatialBlocking(sb.spatialBlocking).slice(0, 120));
  return parts.join(' | ');
}

/** 构建前序分镜的叙事摘要（链式传递给后续分镜，确保叙事连贯） */
function buildPrevNarrativeSummary(
  allStoryboards: StoryboardState[],
  currentIndex: number,
): string {
  const recentIndices = Array.from({ length: currentIndex }, (_, index) => index).slice(-2);
  const summaries: string[] = [];
  for (const i of recentIndices) {
    const sb = allStoryboards[i];
    const sbNum = String(sb.storyboard.number).padStart(2, '0');
    const summary = sb.continuityOutput?.summary || buildStoryboardNarrativeSummary(sb);
    if (summary) {
      summaries.push(`分镜${sbNum}(${sb.storyboard.name}): ${summary}`);
    }
  }
  return summaries.length > 0
    ? `## 前序分镜叙事摘要（确保本分镜与前面剧情连贯）\n${summaries.join('\n')}`
    : '';
}

function getContinuityInput(
  storyboards: StoryboardState[],
  currentIndex: number,
) {
  const previousStoryboard = currentIndex > 0 ? storyboards[currentIndex - 1] : null;
  const previousOutput = previousStoryboard?.continuityOutput;
  const previousInput = previousStoryboard?.continuityInput;

  if (!previousStoryboard) {
    return {
      itemTracker: {},
      lastFrameInfo: '',
      spatialBlocking: undefined,
      sourceStoryboardIndex: -1,
    };
  }

  return {
    itemTracker: previousOutput?.itemTracker
      ?? previousInput?.itemTracker
      ?? {},
    lastFrameInfo: previousOutput?.lastFrameInfo
      ?? previousStoryboard?.lastFrameInfo
      ?? previousInput?.lastFrameInfo
      ?? '',
    spatialBlocking: previousOutput?.spatialBlocking
      ?? previousStoryboard?.spatialBlocking
      ?? previousInput?.spatialBlocking
      ?? undefined,
    sourceStoryboardIndex: previousStoryboard ? currentIndex - 1 : -1,
  };
}

/** 从 check 输出中解析场景蓝图（先尝试 JSON，再降级到关键词推断） */
function parseSceneBlueprint(text: string): SceneBlueprint {
  // 方式0: 优先查找【场景蓝图】标记后的 JSON
  try {
    const blueprintMarker = text.match(/【场景蓝图】\s*\n([\s\S]*?)(?:\n【|$)/);
    if (blueprintMarker) {
      const section = blueprintMarker[1];
      // 先找 ```json``` 包裹的
      const jsonBlock = section.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
      if (jsonBlock) {
        try {
          const parsed = JSON.parse(jsonBlock[1].trim());
          if (parsed.sceneType) return parsed as SceneBlueprint;
        } catch { /* ignore */ }
      }
      // 再找裸 JSON
      const bareJson = extractFirstJsonObject(section);
      if (bareJson) {
        try {
          const parsed = JSON.parse(bareJson);
          if (parsed.sceneType) return parsed as SceneBlueprint;
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  // 方式1: 从全文中提取 sceneBlueprint JSON
  try {
    // 先找 ```json``` 中的 sceneBlueprint
    const jsonMatches = text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g);
    for (const m of jsonMatches) {
      try {
        const parsed = JSON.parse(m[1].trim());
        if (parsed.sceneType) return parsed as SceneBlueprint;
      } catch { /* ignore */ }
    }
    // 再找裸 JSON
    const bareMatch = text.match(/\{[\s\S]*?"sceneType"\s*:/);
    if (bareMatch) {
      const start = bareMatch.index!;
      let depth = 0;
      for (let i = start; i < text.length; i++) {
        if (text[i] === '{') depth++;
        if (text[i] === '}') depth--;
        if (depth === 0) {
          const jsonStr = text.slice(start, i + 1);
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.sceneType) return parsed as SceneBlueprint;
          } catch { /* ignore */ }
          break;
        }
      }
    }
  } catch { /* ignore */ }

  // 方式2: 基于文本关键词推断场景类型（降级路径）
  const combatKeywords = /打斗|战斗|格斗|交手|出拳|踢|斩|刺|攻击|防御|闪避|碰撞|冲击|武器|剑|刀|拳|掌风|法术|魔法|火球|冰|雷|圣光|暗黑/;
  const suppressedKeywords = /被按在墙上|被踩在地上|被钳制|无还手之力|完全被压制|动弹不得|死死压住|按在地上|掐住|锁喉/;
  const emotionalKeywords = /内心|独白|悲伤|痛苦|挣扎|回忆|眼泪|哭泣|沉默|绝望|思念|释然|崩溃/;
  const transitionKeywords = /转场|过渡|切换|时间流逝|场景变化|到达|离开/;

  const sceneType: SceneBlueprint['sceneType'] = combatKeywords.test(text) ? 'combat'
    : emotionalKeywords.test(text) ? 'emotional'
    : transitionKeywords.test(text) ? 'transition'
    : 'dialogue';

  return {
    sceneType,
    combatSubType: sceneType === 'combat' ? (suppressedKeywords.test(text) ? 'suppressed' : 'active') : undefined,
    combatType: sceneType === 'combat' ? 'melee' : undefined,
    intensity: sceneType === 'combat' ? 'high' : 'medium',
    emotionArc: '',
    keyMoments: [],
    cameraStyle: sceneType === 'combat' ? 'dynamic' : 'static',
    suggestedCuts: 4,
    needsSlowMotion: sceneType === 'combat',
    slowMotionMoments: [],
    soundDesign: sceneType === 'combat'
      ? '动作音效=破空/碰撞/碎屑；环境音=风声/低吼/脚步；对白表演=短促呼吸、压低声线；BGM=低频铺底→冲击点骤强→尾音收束'
      : sceneType === 'dialogue'
      ? '动作音效=道具轻响/衣料摩擦；环境音=室内底噪；对白表演=语气、音量、语速、停顿清晰，像真人日常说话，不要播音腔、书面腔或AI味；BGM=低频铺底，对白时压低'
      : sceneType === 'emotional'
      ? '动作音效=呼吸/心跳/衣料；环境音=风声或空间回响；对白表演=气声、停顿、闭唇OS；BGM=情绪铺底→转折渐强→落幅悬停'
      : '动作音效=脚步/门轴/衣料；环境音=新旧场景底噪交接；对白表演=短句清晰；BGM=转场尾音延长→新场景铺底',
    bgmMood: sceneType === 'combat'
      ? '低频压迫、鼓点渐强、撞击点骤强、对白时压低、结尾收束'
      : sceneType === 'dialogue'
      ? '轻低频铺底、对白时压低、反应镜头留短尾音'
      : sceneType === 'emotional'
      ? '弦乐或低频铺底、情绪转折渐强、落幅尾音悬停'
      : '旧场景尾音延长，新场景低频铺底进入',
    dialoguePerformance: sceneType === 'combat'
      ? '极限对抗中短句优先，压低声线、短促呼吸、语速中快，内心OS闭唇'
      : sceneType === 'dialogue'
      ? '说话人语气、音量、语速、句前呼吸、句后反应必须随台词攻防变化，台词要口语化、像真人临场说话，不要播音腔、书面腔或AI味'
      : sceneType === 'emotional'
      ? '内心OS闭唇，台词保留气声和停顿，句尾情绪变化可听见'
      : '如有短句，语速偏快，入场前后留呼吸停顿',
  };
}

/** 从 choreograph LLM 输出中解析动作编排方案 JSON，并校正图片编号 */
function parseChoreography(text: string, imageRefs: ImageReference[]): Choreography | null {
  let raw: Record<string, unknown> | null = null;
  try {
    // 尝试提取 JSON
    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1].trim());
      if (parsed.sceneType && parsed.timeSegments) raw = parsed;
    }
    // 尝试裸 JSON
    if (!raw) {
      const bareJson = extractFirstJsonObject(text, /\{[\s\S]*?"sceneType"\s*:/);
      if (bareJson) {
        const parsed = JSON.parse(bareJson);
        if (parsed.sceneType && parsed.timeSegments) raw = parsed;
      }
    }
  } catch { /* ignore */ }
  if (!raw) return null;

  // 编号校正：如果 choreography 输出的 imageRefMap 与前端 imageRefs 不一致，
  // 用前端 imageRefs 重新映射编号
  if (imageRefs.length > 0) {
    const rawMap = raw.imageRefMap as Record<string, { type: string; name: string }> | undefined;
    if (rawMap) {
      // 构建 LLM 编号 → 正确编号 的映射
      const correctionMap: Record<string, string> = {};
      for (const [llmNum, info] of Object.entries(rawMap)) {
        const correctRef = imageRefs.find(r => r.type === info.type && r.name === info.name);
        if (correctRef) {
          const correctNum = correctRef.refId.match(/图片(\d+)/)?.[1];
          if (correctNum && correctNum !== llmNum) {
            correctionMap[llmNum] = correctNum;
          }
        }
      }

      // 应用编号校正
      if (Object.keys(correctionMap).length > 0) {
        const jsonStr = JSON.stringify(raw);
        // 从大编号到小编号排序，避免替换冲突（如先替换"图片12"再替换"图片1"）
        const sortedEntries = Object.entries(correctionMap).sort((a, b) => parseInt(b[0]) - parseInt(a[0]));
        let correctedStr = jsonStr;
        for (const [wrong, right] of sortedEntries) {
          // 替换 "参考图片X" 和 "(图片X)" 和 "图片X中" 等格式
          correctedStr = correctedStr.replace(
            new RegExp(`图片${wrong}`, 'g'),
            `图片${right}`
          );
        }
        try {
          raw = JSON.parse(correctedStr);
        } catch { /* 校正后解析失败，用原始数据 */ }
      }
    }

    // 删除 imageRefMap（不需要传递到后续步骤）
    delete (raw as Record<string, unknown>).imageRefMap;
  }


  return normalizeChoreographyDialogueActions(raw as unknown as Choreography);
}

function normalizeChoreographyDialogueActions(choreography: Choreography): Choreography {
  return {
    ...choreography,
    timeSegments: (choreography.timeSegments ?? []).map((segment) => ({
      ...segment,
      actions: (segment.actions ?? []).flatMap((action) => {
        const parts = splitDialogueField(action.dialogue ?? '');
        if (parts.length <= 1) return [action];

        return parts.map((part, index) => ({
          ...action,
          dialogue: part,
          action: index === 0
            ? action.action
            : `${action.action}（同一说话人连续台词拆分，第${index + 1}句）`,
        }));
      }),
    })),
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripAddedDialogueLinesFromCorrectedScript(sourceText: string, correctedScript: string) {
  const expectedEntries = extractDialogueEntriesFromText(sourceText);
  const actualEntries = extractDialogueEntriesFromText(correctedScript);
  const report = compareDialogueFidelity(expectedEntries, actualEntries);
  if (report.passed || report.missing.length > 0 || report.added.length === 0) {
    return { script: correctedScript, changed: false };
  }

  const addedTexts = report.added.map((issue) => issue.text);
  const addedPatterns = addedTexts.map((text) => new RegExp(`[“"「『']?${escapeRegExp(text)}[”"」』']?`));
  const nextLines = correctedScript
    .split(/\r?\n/)
    .filter((line) => !addedPatterns.some((pattern) => pattern.test(line)));
  const nextScript = nextLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return {
    script: nextScript,
    changed: nextScript !== correctedScript.trim(),
  };
}

function getStoryboardSourceExcerpt(
  chapter: { scriptType: 'annotated' | 'novel'; adaptedScript: string; rawScript: string; analysisSourceText?: string },
  storyboardState: StoryboardState,
  storyboardIndex: number,
  allStoryboards: StoryboardState[],
): { sourceExcerpt: string; sourceExcerptSummary: string; nextStoryboardSummary: string } {
  if (storyboardState.sourceExcerpt?.trim()) {
    return {
      sourceExcerpt: storyboardState.sourceExcerpt.trim(),
      sourceExcerptSummary: storyboardState.sourceExcerptSummary ?? '',
      nextStoryboardSummary: storyboardState.nextStoryboardSummary ?? '',
    };
  }

  const primaryScript = resolveStoryboardSourceScriptText({
    scriptType: chapter.scriptType,
    rawScript: chapter.rawScript,
    adaptedScript: chapter.adaptedScript,
    analysisSourceText: chapter.analysisSourceText,
  });
  const contexts = buildStoryboardSourceContexts(primaryScript, allStoryboards.map((storyboard) => storyboard.storyboard));

  return {
    sourceExcerpt: contexts[storyboardIndex]?.sourceExcerpt ?? '',
    sourceExcerptSummary: contexts[storyboardIndex]?.sourceExcerptSummary ?? '',
    nextStoryboardSummary: contexts[storyboardIndex]?.nextStoryboardSummary ?? '',
  };
}

/** 从 stateRef 中获取最新的 chapter storyboards（确保读取最新 dispatch 后的 state） */
function getLatestProjectAndChapter(
  stateRef: MutableRefObject<AppState>,
  projectId?: string,
  chapterId?: string,
) {
  const resolvedProjectId = projectId ?? stateRef.current.currentProjectId ?? undefined;
  const project = resolvedProjectId
    ? stateRef.current.projects.find((item) => item.id === resolvedProjectId)
    : undefined;
  const resolvedChapterId = chapterId ?? project?.currentChapterId;
  const chapter = resolvedChapterId
    ? project?.chapters.find((item) => item.id === resolvedChapterId)
    : undefined;
  return { project: project ?? null, chapter: chapter ?? null };
}

/** 从 stateRef 中获取最新的 chapter storyboards（确保读取最新 dispatch 后的 state） */
function getLatestStoryboards(
  stateRef: MutableRefObject<AppState>,
  projectId?: string,
  chapterId?: string,
): StoryboardState[] {
  // stateRef.current 在 React dispatch 后需要等待下一次渲染才能更新
  // 由于批量生成是串行 await，下一个分镜开始时 React 通常已完成渲染
  // 但为安全起见，如果发现状态仍然是旧的，等待一个微任务
  const { chapter } = getLatestProjectAndChapter(stateRef, projectId, chapterId);
  return chapter?.storyboards ?? [];
}

function findRunningAutoGenerateTask(state: AppState) {
  for (const project of state.projects) {
    for (const chapter of project.chapters) {
      if (chapter.autoGenerate?.running) {
        return {
          projectId: project.id,
          chapterId: chapter.id,
          projectName: project.name,
          chapterTitle: chapter.title,
          sessionId: chapter.autoGenerate.sessionId,
        };
      }
    }
  }
  return null;
}

function normalizeStep4BatchTaskConcurrency(value: number | undefined): number {
  if (!Number.isFinite(value)) return STEP4_BATCH_TASK_CONCURRENCY;
  return Math.max(1, Math.min(STEP4_BATCH_TASK_MAX_CONCURRENCY, Math.floor(value as number)));
}

function countRunningStep4BatchTasks(state: AppState, localRunningIds: ReadonlySet<string>): number {
  const runningGlobalTasks = state.globalTasks.filter((task) =>
    task.type === 'step4-batch' && task.status === 'running',
  ).length;
  const localRunningTasks = state.globalTasks.filter((task) =>
    task.type === 'step4-batch' && localRunningIds.has(task.id),
  ).length;
  let runningAutoGenerateChapters = 0;
  state.projects.forEach((project) => {
    project.chapters.forEach((chapter) => {
      if (chapter.autoGenerate?.running && chapter.autoGenerate.sessionId) {
        runningAutoGenerateChapters += 1;
      }
    });
  });

  return Math.max(
    runningGlobalTasks,
    localRunningTasks,
    activeStep4BatchSessionIds.size,
    runningAutoGenerateChapters,
  );
}

/** 等待 React 渲染完成（让 stateRef 反映最新 dispatch 后的 state） */
function waitForRender(): Promise<void> {
  // 使用 requestAnimationFrame + setTimeout(0) 让 React 有机会完成渲染并更新 ref
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}

function waitForDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createScopedAbortController(parentSignal?: AbortSignal): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  if (!parentSignal) {
    return { controller, cleanup: () => {} };
  }

  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal.reason ?? new DOMException('The user aborted a request.', 'AbortError'));
    }
  };

  if (parentSignal.aborted) {
    abortFromParent();
    return { controller, cleanup: () => {} };
  }

  parentSignal.addEventListener('abort', abortFromParent, { once: true });
  return {
    controller,
    cleanup: () => parentSignal.removeEventListener('abort', abortFromParent),
  };
}

function isStoryboardBoardImageTimeoutMessage(message: string): boolean {
  return /timeout|timed out|超过|超时|未返回|20\s*分钟/i.test(message);
}

function withStageTimeout<T>(
  run: () => Promise<T>,
  timeoutMs: number,
  stageLabel: string,
  onTimeout: () => void,
): Promise<T> {
  if (timeoutMs <= 0) return run();

  let settled = false;
  let timeoutId = 0;

  return new Promise<T>((resolve, reject) => {
    timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout();
      reject(new StoryboardStageTimeoutError(stageLabel, timeoutMs));
    }, timeoutMs);

    run().then(
      (value) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function formatFallbackStageReason(error: unknown, fallbackAction: string) {
  if (error instanceof StoryboardStageTimeoutError) {
    return `${error.stageLabel}超时，${fallbackAction}`;
  }
  if (error instanceof Error) {
    return `${fallbackAction}：${error.message}`;
  }
  return fallbackAction;
}

function isAbortLikeError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && (error.name === 'AbortError' || error.message === '请求已取消'));
}

function throwIfAbortLikeError(error: unknown): void {
  if (isAbortLikeError(error)) throw error;
}

function hasRecoverableStoryboardDirectorCheckpoint(
  storyboard: StoryboardState | undefined,
  requestedOutputMode: Step4OutputMode | undefined,
): boolean {
  if (!storyboard || requestedOutputMode !== 'storyboard-director') return false;
  const selectedMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
  const variant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedMode);
  return !!variant?.plan
    && variant.planStatus === 'done'
    && !variant.planIsStale;
}

function getStoredRecoverableStoryboardDirectorPlan(
  storyboard: StoryboardState | undefined,
  mode: StoryboardBoardMode,
): { plan: StoryboardBoardPlan; planError?: string; planGeneratedAt?: number } | null {
  const variant = getStoryboardBoardVariant(storyboard?.storyboardBoard, mode);
  if (!variant?.plan || variant.planStatus !== 'done' || variant.planIsStale) return null;
  return {
    plan: variant.plan,
    planError: variant.planError,
    planGeneratedAt: variant.planGeneratedAt,
  };
}

function hasCompletedStoryboardBoardImage(storyboard: StoryboardState | undefined): boolean {
  const selectedMode = getStoryboardBoardSelectedMode(storyboard?.storyboardBoard);
  const variant = getStoryboardBoardVariant(storyboard?.storyboardBoard, selectedMode);
  return variant?.status === 'done'
    && !!variant.blobKey
    && !variant.isStale;
}

function hasCompletedSeedanceFinalPrompt(storyboard: StoryboardState | undefined): boolean {
  return storyboard?.seedanceFinalVideoPromptStatus === 'done'
    && !!storyboard.seedanceFinalVideoPrompt?.trim();
}

function isRecoverableStoryboardDirectorArtifactRetry(
  storyboard: StoryboardState | undefined,
  requestedOutputMode: Step4OutputMode | undefined,
): boolean {
  if (!hasRecoverableStoryboardDirectorCheckpoint(storyboard, requestedOutputMode)) return false;
  const selectedMode = getStoryboardBoardSelectedMode(storyboard?.storyboardBoard);
  const variant = getStoryboardBoardVariant(storyboard?.storyboardBoard, selectedMode);
  return variant?.status === 'failed'
    || storyboard?.seedanceFinalVideoPromptStatus === 'failed'
    || !hasCompletedStoryboardBoardImage(storyboard)
    || !hasCompletedSeedanceFinalPrompt(storyboard);
}

function appendPlanWarning(current: string | undefined, warning: string): string {
  return [current, warning].filter(Boolean).join('；');
}

function isStoryboardContinuityReadyForNext(storyboard: StoryboardState | undefined): boolean {
  if (!storyboard) return false;
  if (isStoryboardPromptReady(storyboard)) return true;

  const hasContinuity = !!(
    storyboard.continuityOutput?.lastFrameInfo?.trim()
    || storyboard.lastFrameInfo?.trim()
  );
  if (!hasContinuity) return false;

  const outputMode = storyboard.generatedStep4OutputMode ?? storyboard.step4OutputMode ?? 'prompt';
  if (outputMode === 'storyboard-director') {
    const selectedMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
    const variant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedMode);
    return !!variant?.plan
      && variant.planStatus === 'done'
      && !variant.planIsStale
      && !variant.isStale;
  }

  return storyboard.status === 'done';
}

export function useStoryboardGeneration() {
  const { state, dispatch, currentProject, currentChapter: chapter } = useCurrentProject();
  const allStoryboards = useMemo(() => chapter?.storyboards ?? [], [chapter?.storyboards]);
  const autoGenerate = chapter?.autoGenerate ?? {
    running: false, currentIndex: -1, total: 0, doneCount: 0, errors: [], cancelled: false,
  };

  const cancelledBatchSessionIdsRef = useRef<Set<string>>(new Set());
  const activeBatchSessionIdsRef = useRef<Set<string>>(new Set());
  const batchAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const recoveredInterruptSignatureRef = useRef<string | null>(null);
  const [activeStreamTarget, setActiveStreamTarget] = useState<{ projectId: string; chapterId: string; storyboardIndex: number } | null>(null);
  const [activeStreamPhase, setActiveStreamPhase] = useState<StoryboardState['status'] | null>(null);
  const [activeStreamStageLabel, setActiveStreamStageLabel] = useState<ActiveStreamStageLabel | string | null>(null);
  const [activeStreamStageStartedAt, setActiveStreamStageStartedAt] = useState<number | undefined>(undefined);
  const [activeStreamStageLastActivityAt, setActiveStreamStageLastActivityAt] = useState<number | undefined>(undefined);
  const [activeStreamStageTimeoutMs, setActiveStreamStageTimeoutMs] = useState<number | undefined>(undefined);
  const [activeStreamStageTimeoutMode, setActiveStreamStageTimeoutMode] = useState<'hard' | 'idle' | undefined>(undefined);
  const activeStoryboardGenerationCountRef = useRef(0);
  const [activeStoryboardGenerationCount, setActiveStoryboardGenerationCount] = useState(0);
  const activeStoryboardBoardImageControllersRef = useRef<Set<AbortController>>(new Set());
  const activeStoryboardBoardImageControllersBySessionRef = useRef<Map<string, Set<AbortController>>>(new Map());
  const activeSeedanceFinalPromptControllersRef = useRef<Set<AbortController>>(new Set());
  const activeSeedanceFinalPromptControllersBySessionRef = useRef<Map<string, Set<AbortController>>>(new Map());
  const activeAutoGenerateTask = useMemo(() => findRunningAutoGenerateTask(state), [state]);
  const runningGlobalTaskIdsRef = useRef<Set<string>>(new Set());

  const beginStoryboardGeneration = useCallback(() => {
    activeStoryboardGenerationCountRef.current += 1;
    setActiveStoryboardGenerationCount(activeStoryboardGenerationCountRef.current);
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      activeStoryboardGenerationCountRef.current = Math.max(0, activeStoryboardGenerationCountRef.current - 1);
      setActiveStoryboardGenerationCount(activeStoryboardGenerationCountRef.current);
    };
  }, []);

  // 用 stateRef 持有最新 state，避免闭包快照问题
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const {
    loading: apiLoading,
    error: apiError,
    streamText,
    callApiViaBff,
    abort,
    reset: resetApi,
  } = useApiCall({ stream: true, allowConcurrent: true });

  const getBatchAbortSignal = useCallback((sessionId: string | undefined): AbortSignal | undefined => {
    if (!sessionId) return undefined;
    let controller = batchAbortControllersRef.current.get(sessionId);
    if (!controller || controller.signal.aborted) {
      controller = new AbortController();
      batchAbortControllersRef.current.set(sessionId, controller);
    }
    return controller.signal;
  }, []);

  const registerSessionController = useCallback((
    mapRef: MutableRefObject<Map<string, Set<AbortController>>>,
    sessionId: string | undefined,
    controller: AbortController,
  ) => {
    if (!sessionId) return;
    let controllers = mapRef.current.get(sessionId);
    if (!controllers) {
      controllers = new Set<AbortController>();
      mapRef.current.set(sessionId, controllers);
    }
    controllers.add(controller);
  }, []);

  const unregisterSessionController = useCallback((
    mapRef: MutableRefObject<Map<string, Set<AbortController>>>,
    sessionId: string | undefined,
    controller: AbortController,
  ) => {
    if (!sessionId) return;
    const controllers = mapRef.current.get(sessionId);
    if (!controllers) return;
    controllers.delete(controller);
    if (controllers.size === 0) {
      mapRef.current.delete(sessionId);
    }
  }, []);

  const abortControllerSet = useCallback((controllers: Set<AbortController> | undefined) => {
    controllers?.forEach((controller) => controller.abort());
    controllers?.clear();
  }, []);

  const abortStoryboardBoardImageRequests = useCallback(() => {
    activeStoryboardBoardImageControllersRef.current.forEach((controller) => controller.abort());
    activeStoryboardBoardImageControllersRef.current.clear();
    activeStoryboardBoardImageControllersBySessionRef.current.clear();
  }, []);

  const abortSeedanceFinalPromptRequests = useCallback(() => {
    activeSeedanceFinalPromptControllersRef.current.forEach((controller) => controller.abort());
    activeSeedanceFinalPromptControllersRef.current.clear();
    activeSeedanceFinalPromptControllersBySessionRef.current.clear();
  }, []);

  const abortBatchSessionRequests = useCallback((sessionId: string) => {
    cancelledBatchSessionIdsRef.current.add(sessionId);
    const batchController = batchAbortControllersRef.current.get(sessionId);
    if (batchController && !batchController.signal.aborted) {
      batchController.abort(new DOMException('The user aborted a request.', 'AbortError'));
    }
    abortControllerSet(activeStoryboardBoardImageControllersBySessionRef.current.get(sessionId));
    activeStoryboardBoardImageControllersBySessionRef.current.delete(sessionId);
    abortControllerSet(activeSeedanceFinalPromptControllersBySessionRef.current.get(sessionId));
    activeSeedanceFinalPromptControllersBySessionRef.current.delete(sessionId);
  }, [abortControllerSet]);

  const cleanupBatchSessionRequests = useCallback((sessionId: string) => {
    batchAbortControllersRef.current.delete(sessionId);
    activeStoryboardBoardImageControllersBySessionRef.current.delete(sessionId);
    activeSeedanceFinalPromptControllersBySessionRef.current.delete(sessionId);
  }, []);

  const abortStep4BackgroundRequests = useCallback(() => {
    batchAbortControllersRef.current.forEach((controller, sessionId) => {
      cancelledBatchSessionIdsRef.current.add(sessionId);
      activeBatchSessionIdsRef.current.delete(sessionId);
      activeStep4BatchSessionIds.delete(sessionId);
      controller.abort();
    });
    batchAbortControllersRef.current.clear();
    abortStoryboardBoardImageRequests();
    abortSeedanceFinalPromptRequests();
  }, [abortSeedanceFinalPromptRequests, abortStoryboardBoardImageRequests]);

  const forceStopAutoGenerate = useCallback((target?: { projectId?: string; chapterId?: string }) => {
    const latest = getLatestProjectAndChapter(stateRef, target?.projectId, target?.chapterId);
    const projectId = latest.project?.id;
    const chapterId = latest.chapter?.id;
    if (!projectId || !chapterId) return;

    const actualDoneCount = getLatestStoryboards(stateRef, projectId, chapterId)
      .filter(isStoryboardPromptReady).length;

    const sessionId = latest.chapter?.autoGenerate.sessionId;
    if (sessionId) {
      abortBatchSessionRequests(sessionId);
      activeBatchSessionIdsRef.current.delete(sessionId);
      activeStep4BatchSessionIds.delete(sessionId);
    } else {
      abortStep4BackgroundRequests();
    }
    dispatch({ type: 'CANCEL_BUSY_STORYBOARDS', projectId, chapterId });
    dispatch({
      type: 'UPDATE_AUTO_GENERATE',
      updates: { cancelled: true, currentIndex: -1, doneCount: actualDoneCount },
      projectId,
      chapterId,
    });
    dispatch({ type: 'END_AUTO_GENERATE', stopReason: 'cancelled', projectId, chapterId });
  }, [abortBatchSessionRequests, abortStep4BackgroundRequests, dispatch, stateRef]);

  useEffect(() => () => {
    abortStep4BackgroundRequests();
  }, [abortStep4BackgroundRequests]);

  useEffect(() => {
    if (!autoGenerate.running) {
      if (autoGenerate.sessionId) {
        activeBatchSessionIdsRef.current.delete(autoGenerate.sessionId);
      }
      return;
    }

    if (autoGenerate.sessionId && activeBatchSessionIdsRef.current.has(autoGenerate.sessionId)) {
      return;
    }

    if (autoGenerate.sessionId && activeStep4BatchSessionIds.has(autoGenerate.sessionId)) {
      activeBatchSessionIdsRef.current.add(autoGenerate.sessionId);
      return;
    }

    const latest = getLatestProjectAndChapter(stateRef);
    if (!latest.project?.id || !latest.chapter?.id) return;

    forceStopAutoGenerate({ projectId: latest.project.id, chapterId: latest.chapter.id });
  }, [autoGenerate.running, autoGenerate.sessionId, forceStopAutoGenerate, stateRef]);

  // 批量生成时自动滚动到进度卡片
  const batchProgressRef = useRef<HTMLDivElement>(null);
  const prevAutoIdxRef = useRef(autoGenerate.currentIndex);
  useEffect(() => {
    if (autoGenerate.running && autoGenerate.currentIndex !== prevAutoIdxRef.current) {
      prevAutoIdxRef.current = autoGenerate.currentIndex;
      const timer = setTimeout(() => {
        batchProgressRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [autoGenerate.currentIndex, autoGenerate.running]);

  useEffect(() => {
    const chapterId = chapter?.id ?? null;
    if (!chapterId) return;
    if (
      autoGenerate.running
      || apiLoading
      || activeStoryboardGenerationCount > 0
      || activeStoryboardGenerationCountRef.current > 0
    ) return;

    const interruptedSignature = buildInterruptedStoryboardSignature(allStoryboards);
    if (!interruptedSignature) {
      recoveredInterruptSignatureRef.current = null;
      return;
    }

    const scopedSignature = `${chapterId}:${interruptedSignature}`;
    if (recoveredInterruptSignatureRef.current === scopedSignature) return;

    recoveredInterruptSignatureRef.current = scopedSignature;
    dispatch({ type: 'RECOVER_INTERRUPTED_STORYBOARDS', chapterId });

  }, [activeStoryboardGenerationCount, allStoryboards, apiLoading, autoGenerate.running, chapter?.id, dispatch]);

  /**
   * 对指定分镜索引执行完整3步生成流程
   * Step 1: 检查(check) — 逻辑检查 + 创作分析
   * Step 2: 修正(correct) — 根据检查结果改写剧本片段
   * Step 3: 生成(generate) — 基于修正后剧本生成视频提示词
   */
  const generateStoryboardAt = useCallback(async (index: number, targetIds?: { projectId?: string; chapterId?: string; batchSessionId?: string; storyboardDirectorRunMode?: StoryboardDirectorRunMode }) => {
    const latestProjectAndChapter = getLatestProjectAndChapter(stateRef, targetIds?.projectId, targetIds?.chapterId);
    const latestProject = latestProjectAndChapter.project;
    const latestChapter = latestProjectAndChapter.chapter;
    const latestStoryboards = getLatestStoryboards(stateRef, latestProject?.id, latestChapter?.id);
    const targetProjectId = latestProject?.id;
    const targetChapterId = latestChapter?.id;
    const batchSessionId = targetIds?.batchSessionId;
    if (!targetProjectId || !targetChapterId) return;

    const target = { projectId: targetProjectId, chapterId: targetChapterId };
    const batchAbortSignal = getBatchAbortSignal(batchSessionId);
    const scopedBatchRequestControllers = new Set<AbortController>();
    let currentTaskStreamPhase: StoryboardState['status'] | null = null;
    let currentTaskStreamStageLabel: string | null = null;
    let currentTaskStreamStageStartedAt: number | undefined;
    let currentTaskStreamStageLastActivityAt: number | undefined;
    let currentTaskStreamStageTimeoutMs: number | undefined;
    let currentTaskStreamStageTimeoutMode: 'hard' | 'idle' | undefined;
    let lastTaskStreamLength = 0;
    let lastTaskStreamPreviewAt = 0;
    const updateGlobalTaskRuntime = (updates: Partial<GlobalTask>) => {
      if (!batchSessionId) return;
      dispatch({ type: 'UPDATE_GLOBAL_TASK', taskId: batchSessionId, updates });
    };
    const setTaskActiveStreamPhase = (phase: StoryboardState['status'] | null) => {
      currentTaskStreamPhase = phase;
      setActiveStreamPhase(phase);
      updateGlobalTaskRuntime({
        streamStoryboardIndex: index,
        streamPhase: phase,
        streamUpdatedAt: Date.now(),
      });
    };
    const setTaskActiveStreamStageLabel = (stageLabel: ActiveStreamStageLabel | string | null) => {
      currentTaskStreamStageLabel = stageLabel;
      currentTaskStreamStageStartedAt = stageLabel ? Date.now() : undefined;
      currentTaskStreamStageLastActivityAt = currentTaskStreamStageStartedAt;
      currentTaskStreamStageTimeoutMs = getStep4StreamStageTimeoutMs(stageLabel);
      currentTaskStreamStageTimeoutMode = getStep4StreamStageTimeoutMode(stageLabel);
      setActiveStreamStageLabel(stageLabel);
      setActiveStreamStageStartedAt(currentTaskStreamStageStartedAt);
      setActiveStreamStageLastActivityAt(currentTaskStreamStageLastActivityAt);
      setActiveStreamStageTimeoutMs(currentTaskStreamStageTimeoutMs);
      setActiveStreamStageTimeoutMode(currentTaskStreamStageTimeoutMode);
      updateGlobalTaskRuntime({
        streamStoryboardIndex: index,
        streamStageLabel: stageLabel,
        streamStageStartedAt: currentTaskStreamStageStartedAt,
        streamStageLastActivityAt: currentTaskStreamStageLastActivityAt,
        streamStageTimeoutMs: currentTaskStreamStageTimeoutMs,
        streamStageTimeoutMode: currentTaskStreamStageTimeoutMode,
        streamUpdatedAt: Date.now(),
      });
    };
    const clearGlobalTaskStreamPreview = () => {
      lastTaskStreamLength = 0;
      lastTaskStreamPreviewAt = 0;
      updateGlobalTaskRuntime({
        streamStoryboardIndex: index,
        streamTextPreview: '',
        streamTextLength: 0,
        streamStageLabel: currentTaskStreamStageLabel,
        streamStageStartedAt: currentTaskStreamStageStartedAt,
        streamStageLastActivityAt: currentTaskStreamStageLastActivityAt,
        streamStageTimeoutMs: currentTaskStreamStageTimeoutMs,
        streamStageTimeoutMode: currentTaskStreamStageTimeoutMode,
        streamUpdatedAt: Date.now(),
      });
    };
    const updateGlobalTaskStreamPreview = (fullText: string, force = false, event?: string) => {
      if (!batchSessionId) return;
      if (!isBatchSessionActive()) return;
      const textLength = fullText.trim().length;
      const now = Date.now();
      if (event === 'activity' || event === 'chunk' || event === 'replace' || event === 'done' || event === 'result') {
        currentTaskStreamStageLastActivityAt = now;
        setActiveStreamStageLastActivityAt(now);
      }
      const gainedChars = textLength - lastTaskStreamLength;
      if (!force && now - lastTaskStreamPreviewAt < GLOBAL_TASK_STREAM_UPDATE_INTERVAL_MS && gainedChars < GLOBAL_TASK_STREAM_UPDATE_MIN_CHARS) return;
      lastTaskStreamLength = textLength;
      lastTaskStreamPreviewAt = now;
      updateGlobalTaskRuntime({
        streamStoryboardIndex: index,
        streamPhase: currentTaskStreamPhase,
        streamStageLabel: currentTaskStreamStageLabel,
        streamStageStartedAt: currentTaskStreamStageStartedAt,
        streamStageLastActivityAt: currentTaskStreamStageLastActivityAt,
        streamStageTimeoutMs: currentTaskStreamStageTimeoutMs,
        streamStageTimeoutMode: currentTaskStreamStageTimeoutMode,
        streamTextPreview: '',
        streamTextLength: textLength,
        streamUpdatedAt: now,
      });
    };
    const createScopedBatchRequest = () => {
      if (!batchAbortSignal) return null;
      const scoped = createScopedAbortController(batchAbortSignal);
      scopedBatchRequestControllers.add(scoped.controller);
      return {
        signal: scoped.controller.signal,
        cleanup: () => {
          scoped.cleanup();
          scopedBatchRequestControllers.delete(scoped.controller);
        },
      };
    };
    const abortCurrentStageRequests = () => {
      if (!batchSessionId) {
        abort();
        return;
      }
      scopedBatchRequestControllers.forEach((controller) => {
        if (!controller.signal.aborted) {
          controller.abort(new DOMException('The current request timed out.', 'AbortError'));
        }
      });
    };
    const callBatchApiViaBff: typeof callApiViaBff = (config, messages, bffParams, apiOptions) => {
      clearGlobalTaskStreamPreview();
      const scopedRequest = createScopedBatchRequest();
      const suppressDisplayUpdates = batchSessionId ? true : apiOptions?.suppressDisplayUpdates === true;
      const useBrowserDirectStep4Llm = true;
      const useStageOnlyBackground = !useBrowserDirectStep4Llm && (apiOptions?.disableBackgroundJob ?? false) !== true;
      return callApiViaBff(
        config,
        messages,
        bffParams,
        {
          ...apiOptions,
          suppressDisplayUpdates,
          disableBackgroundJob: apiOptions?.disableBackgroundJob ?? useBrowserDirectStep4Llm,
          backgroundProgressMode: apiOptions?.backgroundProgressMode ?? (useStageOnlyBackground ? 'stage-only' : undefined),
          ...(scopedRequest ? { signal: scopedRequest.signal } : {}),
          onStreamUpdate: (fullText, delta, event) => {
            apiOptions?.onStreamUpdate?.(fullText, delta, event);
            updateGlobalTaskStreamPreview(
              fullText,
              event === 'done' || event === 'replace' || event === 'retry' || event === 'result',
              event,
            );
          },
        },
      ).finally(() => {
        scopedRequest?.cleanup();
      });
    };
    const isBatchSessionActive = () => {
      if (!batchSessionId) return true;
      const currentChapter = getLatestProjectAndChapter(stateRef, targetProjectId, targetChapterId).chapter;
      return !!currentChapter
        && !cancelledBatchSessionIdsRef.current.has(batchSessionId)
        && currentChapter.autoGenerate.running
        && currentChapter.autoGenerate.sessionId === batchSessionId;
    };
    const ensureBatchSessionActive = () => {
      if (!isBatchSessionActive()) {
        throw new DOMException('The user aborted a request.', 'AbortError');
      }
    };
    const continuityInput = getContinuityInput(
      latestStoryboards,
      index,
    );
    let currentItemTracker = continuityInput.itemTracker;
    let currentSceneBlueprint: SceneBlueprint | null = null;
    let recoverableStoryboardBoard: StoryboardState['storyboardBoard'] | undefined;
    let directorBriefCheckpointBoard: StoryboardState['storyboardBoard'] | undefined;
    let recoverableStoryboardBoardMode: StoryboardBoardMode | undefined;
    const activeSeedanceFinalPromptControllerRef: { current: AbortController | null } = { current: null };

    const updateStoryboard = (updates: Partial<StoryboardState>) => {
      if (!isBatchSessionActive()) return;
      dispatch({ type: 'UPDATE_STORYBOARD', index, updates, ...target });
    };

    const setItemTracker = (tracker: Record<string, string>) => {
      currentItemTracker = tracker;
    };

    const sb = latestStoryboards[index];
    const latestAnalysis = latestChapter?.analysis ?? null;
    if (!latestAnalysis || !sb) return;
    const requestedOutputMode = getStoryboardRequestedOutputMode(sb, latestChapter?.step4OutputMode);
    const storyboardDirectorRunMode = normalizeStoryboardDirectorRunMode(
      targetIds?.storyboardDirectorRunMode ?? latestChapter?.storyboardDirectorRunMode,
    );
    const shouldPreserveRecoverableStoryboardDirectorCheckpoint = isRecoverableStoryboardDirectorArtifactRetry(
      sb,
      requestedOutputMode,
    );

    ensureBatchSessionActive();
    setActiveStreamTarget({ projectId: targetProjectId, chapterId: targetChapterId, storyboardIndex: index });
    updateGlobalTaskRuntime({
      streamStoryboardIndex: index,
      streamPhase: 'checking',
      streamStageLabel: '逻辑检查',
      streamTextPreview: '',
      streamTextLength: 0,
      streamUpdatedAt: Date.now(),
    });
    setTaskActiveStreamPhase('checking');
    setTaskActiveStreamStageLabel('逻辑检查');
    if (!shouldPreserveRecoverableStoryboardDirectorCheckpoint) {
      dispatch({ type: 'MARK_DOWNSTREAM_STALE', index, ...target });
    }

    const projectAssetLibrary = latestProject?.assetLibrary;
    if (!latestAnalysis || !sb) return;
    const acceptedCharacterNames = [
      ...(latestAnalysis.allCharacterNames ?? []),
      ...(latestAnalysis.characterProfiles ?? []).map((profile) => profile.name),
      ...(projectAssetLibrary ?? [])
        .filter((asset) => asset.type === 'character')
        .map((asset) => asset.name),
    ];
    const sbInfo = sanitizeStoryboardInfo(sb.storyboard, { allowedNames: acceptedCharacterNames });
    let continuitySpatialBlocking = filterSpatialBlockingCharacters(
      continuityInput.spatialBlocking,
      getSpatialContinuityCharacterNames(sbInfo),
    );
    const storyboardSource = getStoryboardSourceExcerpt(
      {
        scriptType: latestChapter.scriptType,
        adaptedScript: latestChapter.adaptedScript,
        rawScript: latestChapter.rawScript,
        analysisSourceText: latestChapter.analysisSourceText,
      },
      sb,
      index,
      latestStoryboards,
    );
    const primaryScriptText = selectPrimaryStoryboardSourceText({
      scriptType: latestChapter.scriptType,
      sourceExcerpt: storyboardSource.sourceExcerpt,
      adaptedScript: latestChapter.adaptedScript,
      rawScript: latestChapter.rawScript,
    });
    const sourceHasScopedExcerpt = !!storyboardSource.sourceExcerpt.trim();
    const dialogueFidelityOptions: DialogueFidelityOptions = {
      ...STEP4_DIALOGUE_FIDELITY_OPTIONS,
      allowSubset: !sourceHasScopedExcerpt,
    };
    const step4StartedAt = Date.now();

    const initialStoryboardUpdates: Partial<StoryboardState> = {
      sourceExcerpt: storyboardSource.sourceExcerpt,
      sourceExcerptSummary: storyboardSource.sourceExcerptSummary,
      nextStoryboardSummary: storyboardSource.nextStoryboardSummary,
      continuityInput: {
        itemTracker: continuityInput.itemTracker,
        lastFrameInfo: continuityInput.lastFrameInfo,
        spatialBlocking: continuitySpatialBlocking,
        sourceStoryboardIndex: continuityInput.sourceStoryboardIndex,
      },
      isStale: false,
      error: undefined,
      step4StartedAt,
    };
    updateStoryboard(shouldPreserveRecoverableStoryboardDirectorCheckpoint
      ? {
          ...initialStoryboardUpdates,
          status: 'generating',
        }
      : {
          ...initialStoryboardUpdates,
          logicFixes: [],
          correctedScript: '',
          sceneBlueprint: null,
          choreography: null,
          prompt: null,
          selfCheckResult: null,
          generatedStep4OutputMode: undefined,
          lastFrameInfo: '',
          spatialBlocking: undefined,
          continuityOutput: undefined,
          choreoCheckFixes: undefined,
          videoImageBudget: undefined,
          seedanceFinalVideoPrompt: '',
          seedanceFinalVideoPromptStatus: 'idle',
          seedanceFinalVideoPromptError: undefined,
          seedanceFinalVideoPromptSourceSnapshot: '',
          seedanceFinalVideoPromptUpdatedAt: undefined,
          seedanceFinalVideoPromptRunId: undefined,
          smartVideoDurationSeconds: undefined,
          smartVideoDurationReason: undefined,
          smartVideoDurationUpdatedAt: undefined,
          storyboardBoard: markStoryboardBoardStale(sb.storyboardBoard, 'source-change'),
        });

    if (!batchSessionId) resetApi();
    const isSbLast = index === latestStoryboards.length - 1;
    const isSbFirst = index === 0;
    const initialSceneDetail = latestAnalysis.scenes.find((scene) => scene.name === sbInfo.scene) ?? null;
    let sceneSpatialBible = buildSceneSpatialBible(sbInfo, initialSceneDetail);

    // 收集前序分镜的逻辑修正摘要（链式传递）
    const prevLogicFixSummary = buildPrevLogicFixSummary(latestStoryboards, index);

    // 收集前序分镜的叙事摘要（链式传递，确保叙事连贯）
    const prevNarrativeSummary = buildPrevNarrativeSummary(latestStoryboards, index);

    const existingRefs = sb.imageRefs;
    let effectiveSbInfo: StoryboardInfo = sbInfo;
    let refs: ImageReference[] = [];

    const resolveRefsForStoryboard = (storyboardInfo: StoryboardInfo) => {
      const nextRefs = computeImageRefs(
        storyboardInfo,
        latestAnalysis.scenes,
        projectAssetLibrary,
        latestAnalysis.propTracking,
        index,
        false,
        latestAnalysis.outfitTracking,
        latestAnalysis.characterProfiles,
        stateRef.current.videoApiConfig.videoRatio,
      );

      if (existingRefs.length > 0) {
        nextRefs.forEach((ref) => {
          const existing = findMatchingImageRef(existingRefs, ref);
          const existingAsset = existing?.assetId
            ? projectAssetLibrary.find((asset) => asset.id === existing.assetId)
            : undefined;
          const canReuseExistingAsset = ref.type !== 'character'
            || isCharacterAssetAllowedForImageRef(existingAsset, ref);
          if (existing?.assetBindingMode === 'manual' && existing.assetId && canReuseExistingAsset) {
            ref.assetId = existing.assetId;
            ref.assetBindingMode = 'manual';
          } else if (
            !ref.assetId
            && existing?.assetId
            && canReuseExistingAsset
            && canReuseExistingImageRefBinding(existing, ref)
          ) {
            ref.assetId = existing.assetId;
            ref.assetBindingMode = existing.assetBindingMode;
          }
        });
      }

      return nextRefs;
    };

    // 保留已有 imageRefs 中的 assetId（按 type+name 匹配，比 refId 更稳定）
    const finishStoryboardGeneration = beginStoryboardGeneration();
    try {
      if (requestedOutputMode === 'storyboard-director') {
        updateStoryboard({ status: 'generating', error: undefined, step4StartedAt });
        setTaskActiveStreamPhase('generating');
        setTaskActiveStreamStageLabel('导演阐述');

        if (!hasEffectiveImageApiKey(stateRef.current.imageApiConfig, stateRef.current.videoApiConfig)) {
          throwRequiredStageError('详细故事板生成', '请先在设置中填写图片 API Key 或虾客漫SD2卡密，才能生成 Seedance 详细故事板。');
        }

        effectiveSbInfo = augmentStoryboardCharactersFromText(
          sbInfo,
          latestAnalysis,
          [primaryScriptText, sb.correctedScript],
          projectAssetLibrary,
          [],
        );
        refs = resolveRefsForStoryboard(effectiveSbInfo);
        const candidateRefsForStoryboardBoard = refs;
        let videoImageSelection = selectVideoImageRefs({
          refs,
          storyboard: effectiveSbInfo,
          correctedScript: primaryScriptText,
          analysis: latestAnalysis,
          allStoryboards: latestAnalysis.storyboards,
          storyboardIndex: index,
          propTracking: latestAnalysis.propTracking,
          assetLibrary: projectAssetLibrary,
          maxRefs: Math.max(1, getVideoImageReferenceLimit(stateRef.current.videoApiConfig) - 1),
        });
        refs = videoImageSelection.selectedRefs;
        continuitySpatialBlocking = filterSpatialBlockingCharacters(
          continuityInput.spatialBlocking,
          getSpatialContinuityCharacterNames(effectiveSbInfo, refs),
        );

        const boardContainer = normalizeStoryboardBoardState(sb.storyboardBoard);
        const mode = latestChapter.storyboardBoardMode ?? boardContainer?.selectedMode ?? DEFAULT_STORYBOARD_BOARD_MODE;
        const smartPanelCountPreference = normalizeSmartStoryboardPanelCountPreference(latestChapter.storyboardBoardSmartPanelCount);
        const lockedSmartPanelCount = getLockedSmartStoryboardPanelCount(smartPanelCountPreference);
        const smartDurationCompressionEnabled = latestChapter.storyboardBoardSmartDurationCompressionEnabled !== false;
        const cameraSegmentCount = resolveStoryboardCameraSegmentCount(latestChapter.storyboardCameraSegmentCount, {
          ...sb,
          storyboard: effectiveSbInfo,
          correctedScript: primaryScriptText || sb.correctedScript,
          sourceExcerpt: storyboardSource.sourceExcerpt || sb.sourceExcerpt,
          sourceExcerptSummary: storyboardSource.sourceExcerptSummary || sb.sourceExcerptSummary,
        });
        recoverableStoryboardBoardMode = mode;
        const modeConfig = getBoardModeConfig(mode);
        const storyboardBoardImageSize = normalizeImageSizeForConfig(
          stateRef.current.imageApiConfig,
          stateRef.current.globalTaskSettings?.step4StoryboardImageSize,
          DEFAULT_STORYBOARD_BOARD_IMAGE_SIZE,
        );
        const targetVideoFrameRatio = normalizeFrameRatio(stateRef.current.videoApiConfig.videoRatio);
        const directorSourceScript = primaryScriptText || storyboardSource.sourceExcerpt || sb.correctedScript || sb.storyboard.name;
        let storyboardForBoard: StoryboardState = {
          ...sb,
          storyboard: effectiveSbInfo,
          step4OutputMode: 'storyboard-director',
          generatedStep4OutputMode: 'storyboard-director',
          storyboardBoardStyle: 'seedance-board',
          correctedScript: directorSourceScript,
          sceneBlueprint: sb.sceneBlueprint ?? null,
          choreography: sb.choreography,
          imageRefs: refs,
          videoImageRefs: refs,
          prompt: null,
          selfCheckResult: null,
          continuityInput: {
            itemTracker: continuityInput.itemTracker,
            lastFrameInfo: continuityInput.lastFrameInfo,
            spatialBlocking: continuitySpatialBlocking,
            sourceStoryboardIndex: continuityInput.sourceStoryboardIndex,
          },
        };

        let boardReferenceResolution = resolveStoryboardBoardReferences(refs, projectAssetLibrary);
        if (boardReferenceResolution.missingReferences.length > 0) {
          const missing = boardReferenceResolution.missingReferences
            .slice(0, 4)
            .map(({ imageRef }) => `${imageRef.refId} ${imageRef.name}`)
            .join('、');
          throwRequiredStageError('详细故事板生成', `当前分镜缺少可用参考图：${missing}`);
        }

        let storyboardsForSequence = latestStoryboards.map((item, itemIndex) =>
          itemIndex === index ? storyboardForBoard : item,
        );
        let episodeShotSheet = latestChapter.episodeShotSheet ?? buildEpisodeShotSheet(storyboardsForSequence);
        let episodeShotSheetSegment = getEpisodeShotSheetSegment(episodeShotSheet, index);
        let nextEpisodeShotSheetSegment = getEpisodeShotSheetSegment(episodeShotSheet, index + 1);
        let sequenceContinuityContext = buildStoryboardSequenceContinuityContext(
          storyboardsForSequence,
          index,
          episodeShotSheetSegment,
          mode,
          nextEpisodeShotSheetSegment,
        );

        let references = boardReferenceResolution.resolvedReferences.map(({ imageRef }) => imageRef);
        let planReferenceAssetIds = boardReferenceResolution.resolvedReferences.map(({ asset }) => asset.id);
        let initialProjectVisualStyle = resolveStoryboardProjectVisualStyle(
          storyboardForBoard,
          undefined,
          latestAnalysis.styleConfig,
        ).resolvedVisualStyle;
        let boardSourceSnapshot = withStoryboardDirectorRunModeSnapshot(
          buildStoryboardBoardSourceSnapshot(
            storyboardForBoard,
            targetVideoFrameRatio,
            sequenceContinuityContext,
            initialProjectVisualStyle,
            { smartPanelCountPreference, smartDurationCompressionEnabled, cameraSegmentCount },
          ),
          storyboardDirectorRunMode,
        );
        const candidateReferenceResolution = resolveStoryboardBoardReferences(candidateRefsForStoryboardBoard, projectAssetLibrary);
        const candidateReferences = candidateReferenceResolution.resolvedReferences.length > 0
          ? candidateReferenceResolution.resolvedReferences.map(({ imageRef }) => imageRef)
          : references;
        const storyboardForDirectorBriefCandidates: StoryboardState = {
          ...storyboardForBoard,
          imageRefs: candidateRefsForStoryboardBoard,
          continuityInput: {
            itemTracker: continuityInput.itemTracker,
            lastFrameInfo: continuityInput.lastFrameInfo,
            spatialBlocking: filterSpatialBlockingCharacters(
              continuityInput.spatialBlocking,
              getSpatialContinuityCharacterNames(effectiveSbInfo, candidateRefsForStoryboardBoard),
            ),
            sourceStoryboardIndex: continuityInput.sourceStoryboardIndex,
          },
        };
        const refreshStoryboardBoardReferenceContext = (nextRefs: ImageReference[]) => {
          refs = nextRefs;
          continuitySpatialBlocking = filterSpatialBlockingCharacters(
            continuityInput.spatialBlocking,
            getSpatialContinuityCharacterNames(effectiveSbInfo, refs),
          );
          storyboardForBoard = {
            ...storyboardForBoard,
            imageRefs: refs,
            videoImageRefs: refs,
            continuityInput: {
              itemTracker: continuityInput.itemTracker,
              lastFrameInfo: continuityInput.lastFrameInfo,
              spatialBlocking: continuitySpatialBlocking,
              sourceStoryboardIndex: continuityInput.sourceStoryboardIndex,
            },
          };
          boardReferenceResolution = resolveStoryboardBoardReferences(refs, projectAssetLibrary);
          if (boardReferenceResolution.missingReferences.length > 0) {
            const missing = boardReferenceResolution.missingReferences
              .slice(0, 4)
              .map(({ imageRef }) => `${imageRef.refId} ${imageRef.name}`)
              .join('、');
            throwRequiredStageError('详细故事板生成', `当前分镜缺少可用参考图：${missing}`);
          }
          storyboardsForSequence = latestStoryboards.map((item, itemIndex) =>
            itemIndex === index ? storyboardForBoard : item,
          );
          episodeShotSheet = latestChapter.episodeShotSheet ?? buildEpisodeShotSheet(storyboardsForSequence);
          episodeShotSheetSegment = getEpisodeShotSheetSegment(episodeShotSheet, index);
          nextEpisodeShotSheetSegment = getEpisodeShotSheetSegment(episodeShotSheet, index + 1);
          sequenceContinuityContext = buildStoryboardSequenceContinuityContext(
            storyboardsForSequence,
            index,
            episodeShotSheetSegment,
            mode,
            nextEpisodeShotSheetSegment,
          );
          references = boardReferenceResolution.resolvedReferences.map(({ imageRef }) => imageRef);
          planReferenceAssetIds = boardReferenceResolution.resolvedReferences.map(({ asset }) => asset.id);
          initialProjectVisualStyle = resolveStoryboardProjectVisualStyle(
            storyboardForBoard,
            undefined,
            latestAnalysis.styleConfig,
          ).resolvedVisualStyle;
          boardSourceSnapshot = withStoryboardDirectorRunModeSnapshot(
            buildStoryboardBoardSourceSnapshot(
              storyboardForBoard,
              targetVideoFrameRatio,
              sequenceContinuityContext,
              initialProjectVisualStyle,
              { smartPanelCountPreference, smartDurationCompressionEnabled, cameraSegmentCount },
            ),
            storyboardDirectorRunMode,
          );
        };
        const freshRecoverablePlan = getRecoverableStoryboardBoardPlan(
          sb.storyboardBoard,
          mode,
          boardSourceSnapshot,
          planReferenceAssetIds,
        );
        const storedRecoverablePlan = shouldPreserveRecoverableStoryboardDirectorCheckpoint
          ? getStoredRecoverableStoryboardDirectorPlan(sb, mode)
          : null;
        const recoverablePlan = freshRecoverablePlan ?? storedRecoverablePlan;
        const compactPlanning = isCompactStoryboardDirectorRunMode(storyboardDirectorRunMode);
        const recoverableActionDirectorPlan = recoverablePlan || !shouldRunStoryboardActionDirector(storyboardDirectorRunMode)
          ? null
          : getRecoverableStoryboardBoardActionDirectorPlan(
              sb.storyboardBoard,
              mode,
              boardSourceSnapshot,
              planReferenceAssetIds,
            );
        const freshRecoverableDirectorBrief = recoverablePlan || recoverableActionDirectorPlan || compactPlanning
          ? null
          : getRecoverableStoryboardDirectorBrief(
              sb.storyboardBoard,
              mode,
              boardSourceSnapshot,
              planReferenceAssetIds,
            );
        let boardGenerationTiming = getStoryboardBoardVariant(sb.storyboardBoard, mode)?.generationTiming;
        const runStoryboardActionDirectorPlan = async (
          basePlan: StoryboardBoardPlan,
          directorBrief: StoryboardBoardDirectorBrief,
          storyboardForSmartTiming: StoryboardState,
        ): Promise<StoryboardBoardPlan> => {
          setTaskActiveStreamStageLabel('动作导演连续性调度');
          const rawActionDirectorText = await withStageTimeout(
            () => callBatchApiViaBff(stateRef.current.apiConfig, [{
              role: 'user',
              content: buildStoryboardActionDirectorRequest(
                storyboardForSmartTiming,
                references,
                mode,
                basePlan,
                undefined,
                episodeShotSheetSegment,
                targetVideoFrameRatio,
                sequenceContinuityContext,
                directorBrief,
                latestAnalysis.styleConfig,
                smartPanelCountPreference,
                cameraSegmentCount,
                { maxImageReferences: getVideoImageReferenceLimit(stateRef.current.videoApiConfig) },
              ),
            }], {
              templateType: STORYBOARD_ACTION_DIRECTOR_TEMPLATE_TYPE,
              templateVars: {},
            }, STORYBOARD_ACTION_DIRECTOR_LLM_PARAMS),
            STORYBOARD_BOARD_PLAN_TIMEOUT_MS,
            '故事板动作导演连续性调度',
            abortCurrentStageRequests,
          );
          ensureBatchSessionActive();
          return parseStoryboardBoardPlan(rawActionDirectorText, storyboardForSmartTiming, references, mode, targetVideoFrameRatio, directorBrief, smartPanelCountPreference);
        };
        if (shouldPreserveRecoverableStoryboardDirectorCheckpoint && recoverablePlan) {
          dispatch({
            type: 'RESTORE_DOWNSTREAM_AFTER_RECOVERABLE_STORYBOARD_RETRY',
            index,
            ...target,
          });
        }
        if (shouldPreserveRecoverableStoryboardDirectorCheckpoint && !recoverablePlan && !recoverableActionDirectorPlan && !freshRecoverableDirectorBrief) {
          dispatch({ type: 'MARK_DOWNSTREAM_STALE', index, ...target });
          updateStoryboard({
            ...initialStoryboardUpdates,
            logicFixes: [],
            correctedScript: '',
            sceneBlueprint: null,
            choreography: null,
            prompt: null,
            selfCheckResult: null,
            generatedStep4OutputMode: undefined,
            lastFrameInfo: '',
            spatialBlocking: undefined,
            continuityOutput: undefined,
            choreoCheckFixes: undefined,
            videoImageBudget: undefined,
            seedanceFinalVideoPrompt: '',
            seedanceFinalVideoPromptStatus: 'idle',
            seedanceFinalVideoPromptError: undefined,
            seedanceFinalVideoPromptSourceSnapshot: '',
            seedanceFinalVideoPromptUpdatedAt: undefined,
            seedanceFinalVideoPromptRunId: undefined,
            smartVideoDurationSeconds: undefined,
            smartVideoDurationReason: undefined,
            smartVideoDurationUpdatedAt: undefined,
            storyboardBoard: markStoryboardBoardStale(sb.storyboardBoard, 'source-change'),
          });
        }

        let plan: StoryboardBoardPlan;
        let planError: string | undefined;
        let planGeneratedAt = recoverablePlan?.planGeneratedAt ?? Date.now();
        let smartDurationUpdates: Partial<StoryboardState> = {};
        let storyboardForPrompt: StoryboardState = storyboardForBoard;
        if (recoverablePlan) {
          setTaskActiveStreamStageLabel('已保留导演规划，准备重试图片');
          plan = recoverablePlan.plan;
          const smartDurationDecision = resolveSmartStoryboardDurationDecision(
            mode,
            storyboardForBoard,
            plan.directorBrief,
            lockedSmartPanelCount,
            { durationCompressionEnabled: smartDurationCompressionEnabled },
          );
          smartDurationUpdates = buildSmartStoryboardDurationUpdates(smartDurationDecision);
          storyboardForPrompt = applySmartDurationToStoryboardForPrompt(storyboardForBoard, smartDurationDecision);
          planError = freshRecoverablePlan
            ? recoverablePlan.planError
            : appendPlanWarning(
                recoverablePlan.planError,
                '已复用当前镜头的既有导演规划，仅补跑故事板图或 Seedance 最终词，未重新计算连续性。',
              );
        } else {
          if (recoverableActionDirectorPlan) {
            setTaskActiveStreamStageLabel('已保留故事板规划，准备重试动作导演');
            plan = recoverableActionDirectorPlan.plan;
            planGeneratedAt = recoverableActionDirectorPlan.planGeneratedAt ?? planGeneratedAt;
            const directorBrief = plan.directorBrief;
            if (!directorBrief) {
              throw new Error('已保留的故事板规划缺少导演阐述，无法只重试动作导演。');
            }
            const smartDurationDecision = resolveSmartStoryboardDurationDecision(
              mode,
              storyboardForBoard,
              directorBrief,
              lockedSmartPanelCount,
              { durationCompressionEnabled: smartDurationCompressionEnabled },
            );
            smartDurationUpdates = buildSmartStoryboardDurationUpdates(smartDurationDecision);
            storyboardForPrompt = applySmartDurationToStoryboardForPrompt(storyboardForBoard, smartDurationDecision);
            planError = appendPlanWarning(
              recoverableActionDirectorPlan.planError,
              '已复用基础故事板规划，仅重试动作导演连续性调度。',
            );
            try {
              plan = await runStoryboardActionDirectorPlan(plan, directorBrief, storyboardForPrompt);
            } catch (actionDirectorError) {
              throwIfAbortLikeError(actionDirectorError);
              throw new Error(formatFallbackStageReason(
                actionDirectorError,
                '动作导演连续性调度未完成，已停止后续生图；请重试当前分镜',
              ));
            }
            planGeneratedAt = Date.now();
            boardGenerationTiming = completeStoryboardBoardPlanTiming(boardGenerationTiming, planGeneratedAt);
          } else {
          boardGenerationTiming = beginStoryboardBoardPlanTiming(boardGenerationTiming);
          const fallbackDirectorBrief = buildFallbackStoryboardBoardPlan(
            storyboardForBoard,
            references,
            mode,
            targetVideoFrameRatio,
          ).directorBrief;
          if (!fallbackDirectorBrief) {
            throw new Error('精简规划缺少可用导演阐述兜底，无法继续生成故事板。');
          }
          let directorBrief: StoryboardBoardDirectorBrief = fallbackDirectorBrief;
          if (compactPlanning) {
            setTaskActiveStreamStageLabel('精简规划');
            planError = appendPlanWarning(
              planError,
              '精简模式：已跳过导演阐述，使用上一镜连续性、当前剧本和参考图职责组成上下文胶囊，直接进入单轮故事板规划。',
            );
          } else if (freshRecoverableDirectorBrief) {
            setTaskActiveStreamStageLabel('已保留导演阐述，准备重试规划');
            directorBrief = freshRecoverableDirectorBrief.directorBrief;
            planError = appendPlanWarning(
              freshRecoverableDirectorBrief.directorBriefError,
              '已复用导演阐述，仅重试故事板规划。',
            );
          } else {
            try {
              setTaskActiveStreamStageLabel('导演阐述');
              let rawBriefText = await withStageTimeout(
                () => callBatchApiViaBff(stateRef.current.apiConfig, [{
                  role: 'user',
                  content: buildStoryboardDirectorBriefRequest(
                    storyboardForDirectorBriefCandidates,
                    candidateReferences,
                    mode,
                    episodeShotSheetSegment,
                    targetVideoFrameRatio,
                    sequenceContinuityContext,
                    latestAnalysis.styleConfig,
                    undefined,
                    smartPanelCountPreference,
                    cameraSegmentCount,
                    { maxImageReferences: getVideoImageReferenceLimit(stateRef.current.videoApiConfig) },
                  ),
                }], {
                  templateType: STORYBOARD_DIRECTOR_BRIEF_TEMPLATE_TYPE,
                  templateVars: {},
                }, STORYBOARD_DIRECTOR_BRIEF_LLM_PARAMS),
                STORYBOARD_BOARD_BRIEF_TIMEOUT_MS,
                '故事板导演阐述',
                abortCurrentStageRequests,
              );
              ensureBatchSessionActive();
              try {
                directorBrief = parseStoryboardDirectorBrief(rawBriefText, storyboardForDirectorBriefCandidates, candidateReferences, mode, targetVideoFrameRatio, smartPanelCountPreference);
              } catch (firstBriefParseError) {
                setTaskActiveStreamStageLabel('规划格式修复');
                rawBriefText = await withStageTimeout(
                  () => callBatchApiViaBff(stateRef.current.apiConfig, [{
                  role: 'user',
                  content: buildStoryboardDirectorBriefRequest(
                      storyboardForDirectorBriefCandidates,
                      candidateReferences,
                      mode,
                      episodeShotSheetSegment,
                      targetVideoFrameRatio,
                      sequenceContinuityContext,
                      latestAnalysis.styleConfig,
                      firstBriefParseError instanceof Error ? firstBriefParseError.message : String(firstBriefParseError),
                      smartPanelCountPreference,
                      cameraSegmentCount,
                      { maxImageReferences: getVideoImageReferenceLimit(stateRef.current.videoApiConfig) },
                    ),
                  }], {
                    templateType: STORYBOARD_DIRECTOR_BRIEF_TEMPLATE_TYPE,
                    templateVars: {},
                  }, STORYBOARD_DIRECTOR_BRIEF_REPAIR_LLM_PARAMS),
                  STORYBOARD_BOARD_BRIEF_TIMEOUT_MS,
                  '故事板导演阐述格式修复',
                  abortCurrentStageRequests,
                );
                ensureBatchSessionActive();
                directorBrief = parseStoryboardDirectorBrief(rawBriefText, storyboardForDirectorBriefCandidates, candidateReferences, mode, targetVideoFrameRatio, smartPanelCountPreference);
              }
              const durationRejudgeHint = buildSmartStoryboardDurationRejudgeHint(
                mode,
                storyboardForBoard,
                directorBrief,
                lockedSmartPanelCount,
                { durationCompressionEnabled: smartDurationCompressionEnabled },
              );
              if (durationRejudgeHint) {
                setTaskActiveStreamStageLabel('导演阐述');
                rawBriefText = await withStageTimeout(
                  () => callBatchApiViaBff(stateRef.current.apiConfig, [{
                  role: 'user',
                  content: buildStoryboardDirectorBriefRequest(
                      storyboardForDirectorBriefCandidates,
                      candidateReferences,
                      mode,
                      episodeShotSheetSegment,
                      targetVideoFrameRatio,
                      sequenceContinuityContext,
                      latestAnalysis.styleConfig,
                      durationRejudgeHint,
                      smartPanelCountPreference,
                      cameraSegmentCount,
                      { maxImageReferences: getVideoImageReferenceLimit(stateRef.current.videoApiConfig) },
                    ),
                  }], {
                    templateType: STORYBOARD_DIRECTOR_BRIEF_TEMPLATE_TYPE,
                    templateVars: {},
                  }, STORYBOARD_DIRECTOR_BRIEF_REPAIR_LLM_PARAMS),
                  STORYBOARD_BOARD_BRIEF_TIMEOUT_MS,
                  '故事板导演阐述时长复判',
                  abortCurrentStageRequests,
                );
                ensureBatchSessionActive();
                directorBrief = parseStoryboardDirectorBrief(rawBriefText, storyboardForDirectorBriefCandidates, candidateReferences, mode, targetVideoFrameRatio, smartPanelCountPreference);
              }
            } catch (briefError) {
              throwIfAbortLikeError(briefError);
              throw new Error(formatFallbackStageReason(briefError, '故事板导演阐述生成失败，已停止当前分镜；请重试'));
            }
          }

          if (!freshRecoverableDirectorBrief) {
            videoImageSelection = selectVideoImageRefs({
              refs: candidateRefsForStoryboardBoard,
              storyboard: effectiveSbInfo,
              correctedScript: primaryScriptText,
              analysis: latestAnalysis,
              allStoryboards: latestAnalysis.storyboards,
              storyboardIndex: index,
              propTracking: latestAnalysis.propTracking,
              assetLibrary: projectAssetLibrary,
              maxRefs: Math.max(1, getVideoImageReferenceLimit(stateRef.current.videoApiConfig) - 1),
              directorBrief,
            });
            refreshStoryboardBoardReferenceContext(videoImageSelection.selectedRefs);
            directorBrief = parseStoryboardDirectorBrief(
              JSON.stringify(remapDirectorBriefReferenceIds(directorBrief, videoImageSelection.refIdMap)),
              storyboardForBoard,
              references,
              mode,
              targetVideoFrameRatio,
              smartPanelCountPreference,
            );
          }

          const planTemplateType = getStoryboardBoardPlanTemplateType(mode);
          const boardPlanLlmParams = compactPlanning
            ? STORYBOARD_COMPACT_BOARD_PLAN_LLM_PARAMS
            : STORYBOARD_BOARD_PLAN_LLM_PARAMS;
          const smartDurationDecision = resolveSmartStoryboardDurationDecision(
            mode,
            storyboardForBoard,
            directorBrief,
            lockedSmartPanelCount,
            { durationCompressionEnabled: smartDurationCompressionEnabled },
          );
          smartDurationUpdates = buildSmartStoryboardDurationUpdates(smartDurationDecision);
          directorBrief = applySmartDurationToDirectorBrief(directorBrief, smartDurationDecision);
          storyboardForPrompt = applySmartDurationToStoryboardForPrompt(storyboardForBoard, smartDurationDecision);
          const storyboardForSmartTiming = storyboardForPrompt;
          const directorBriefCheckpointGeneratedAt = freshRecoverableDirectorBrief?.directorBriefGeneratedAt ?? Date.now();
          const latestStoryboardForDirectorBriefCheckpoint =
            getLatestStoryboards(stateRef, targetProjectId, targetChapterId)[index] ?? sb;
          directorBriefCheckpointBoard = mergeStoryboardBoardVariant(
            latestStoryboardForDirectorBriefCheckpoint.storyboardBoard,
            mode,
            {
              status: 'idle',
              boardStyle: 'seedance-board',
              generatedForOutputMode: 'storyboard-director',
              frameRatio: modeConfig.frameRatio,
              error: undefined,
              isStale: false,
              layout: modeConfig.layout,
              imageSize: storyboardBoardImageSize,
              generationTiming: boardGenerationTiming,
              directorBrief,
              directorBriefStatus: 'done',
              directorBriefError: undefined,
              directorBriefGeneratedAt: directorBriefCheckpointGeneratedAt,
              directorBriefPromptSnapshot: boardSourceSnapshot,
              directorBriefReferenceAssetIds: planReferenceAssetIds,
              planStatus: 'optimizing',
              planError,
              planIsStale: false,
              planPromptSnapshot: boardSourceSnapshot,
              planReferenceAssetIds: planReferenceAssetIds,
            },
          );
          updateStoryboard({
            storyboardBoard: directorBriefCheckpointBoard,
          });
          try {
            setTaskActiveStreamStageLabel(compactPlanning ? '精简规划' : getStoryboardPlanStageLabel(mode));
            let rawPlanText = await withStageTimeout(
              () => callBatchApiViaBff(stateRef.current.apiConfig, [{
                role: 'user',
                content: buildStoryboardBoardPlanRequest(
                  storyboardForSmartTiming,
                  references,
                  mode,
                  undefined,
                  episodeShotSheetSegment,
                  targetVideoFrameRatio,
                  sequenceContinuityContext,
                  directorBrief,
                  latestAnalysis.styleConfig,
                  smartPanelCountPreference,
                  cameraSegmentCount,
                  {
                    compactPlanning,
                    maxImageReferences: getVideoImageReferenceLimit(stateRef.current.videoApiConfig),
                  },
                ),
              }], {
                templateType: planTemplateType,
                templateVars: {},
              }, boardPlanLlmParams),
              STORYBOARD_BOARD_PLAN_TIMEOUT_MS,
              getStoryboardPlanTimeoutLabel(mode),
              abortCurrentStageRequests,
            );
            ensureBatchSessionActive();

            try {
              plan = parseStoryboardBoardPlan(rawPlanText, storyboardForSmartTiming, references, mode, targetVideoFrameRatio, directorBrief, smartPanelCountPreference);
            } catch (firstParseError) {
              try {
                setTaskActiveStreamStageLabel('规划格式修复');
                rawPlanText = await withStageTimeout(
                  () => callBatchApiViaBff(stateRef.current.apiConfig, [{
                    role: 'user',
                    content: buildStoryboardBoardFormatRepairRequest(
                      storyboardForSmartTiming,
                      references,
                      mode,
                      rawPlanText,
                      firstParseError instanceof Error ? firstParseError.message : String(firstParseError),
                      episodeShotSheetSegment,
                      targetVideoFrameRatio,
                      sequenceContinuityContext,
                      directorBrief,
                      latestAnalysis.styleConfig,
                      smartPanelCountPreference,
                      cameraSegmentCount,
                      {
                        compactPlanning,
                        maxImageReferences: getVideoImageReferenceLimit(stateRef.current.videoApiConfig),
                      },
                    ),
                  }], {
                    templateType: planTemplateType,
                    templateVars: {},
                  }, STORYBOARD_BOARD_PLAN_REPAIR_LLM_PARAMS),
                  STORYBOARD_BOARD_PLAN_TIMEOUT_MS,
                  getStoryboardPlanTimeoutLabel(mode, '修复'),
                  abortCurrentStageRequests,
                );
                ensureBatchSessionActive();
                plan = parseStoryboardBoardPlan(rawPlanText, storyboardForSmartTiming, references, mode, targetVideoFrameRatio, directorBrief, smartPanelCountPreference);
              } catch (planRepairError) {
                throwIfAbortLikeError(planRepairError);
                throw new Error(formatFallbackStageReason(
                  planRepairError,
                  '故事板导演规划解析异常，修复后仍不可用，已停止后续生图',
                ));
              }
            }
            const qualityRepairHint = buildStoryboardBoardQualityRepairHint(
              evaluateStoryboardBoardQuality(
                { status: 'done', plan, layout: modeConfig.layout, frameRatio: modeConfig.frameRatio },
                mode,
                sequenceContinuityContext,
                { references },
              ),
            );
            if (qualityRepairHint) {
              try {
                setTaskActiveStreamStageLabel('规划质量修复');
                rawPlanText = await withStageTimeout(
                  () => callBatchApiViaBff(stateRef.current.apiConfig, [{
                    role: 'user',
                    content: buildStoryboardBoardQualityRepairRequest(
                      storyboardForSmartTiming,
                      references,
                      mode,
                      plan,
                      qualityRepairHint,
                      episodeShotSheetSegment,
                      targetVideoFrameRatio,
                      sequenceContinuityContext,
                      directorBrief,
                      latestAnalysis.styleConfig,
                      smartPanelCountPreference,
                      cameraSegmentCount,
                      {
                        compactPlanning,
                        maxImageReferences: getVideoImageReferenceLimit(stateRef.current.videoApiConfig),
                      },
                    ),
                  }], {
                    templateType: planTemplateType,
                    templateVars: {},
                  }, STORYBOARD_BOARD_PLAN_REPAIR_LLM_PARAMS),
                  STORYBOARD_BOARD_PLAN_TIMEOUT_MS,
                  getStoryboardPlanTimeoutLabel(mode, '质检修复'),
                  abortCurrentStageRequests,
                );
                ensureBatchSessionActive();
                plan = parseStoryboardBoardPlan(rawPlanText, storyboardForSmartTiming, references, mode, targetVideoFrameRatio, directorBrief, smartPanelCountPreference);
                const repairedQualityReport = evaluateStoryboardBoardQuality(
                  { status: 'done', plan, layout: modeConfig.layout, frameRatio: modeConfig.frameRatio },
                  mode,
                  sequenceContinuityContext,
                  { references },
                );
                const remainingRepairHint = buildStoryboardBoardQualityRepairHint(repairedQualityReport, 2);
                const blockingQualityChecks = getStoryboardBoardQualityBlockingChecks(repairedQualityReport);
                if (remainingRepairHint && blockingQualityChecks.length > 0) {
                  throw new Error(`导演规划质量门修复后仍有结构性问题，已停止后续生图：${blockingQualityChecks.slice(0, 4).map((check) => `${check.id}: ${check.detail}`).join(' / ')}`);
                }
                const warningSummary = summarizeStoryboardBoardQualityWarnings(repairedQualityReport);
                planError = [
                  planError,
                  warningSummary
                    ? `导演规划质量门已自动修复；仍有非阻塞风险：${warningSummary}`
                    : '导演规划质量门发现问题后已自动修复。',
                ].filter(Boolean).join('；');
              } catch (qualityRepairError) {
                throwIfAbortLikeError(qualityRepairError);
                throw new Error(formatFallbackStageReason(
                  qualityRepairError,
                  '导演规划质量门自动修复未完成，已停止后续生图',
                ));
              }
            }
            const basePlanCheckpointGeneratedAt = Date.now();
            const latestStoryboardForPlanCheckpoint =
              getLatestStoryboards(stateRef, targetProjectId, targetChapterId)[index] ?? sb;
            directorBriefCheckpointBoard = mergeStoryboardBoardVariant(
              directorBriefCheckpointBoard ?? latestStoryboardForPlanCheckpoint.storyboardBoard,
              mode,
              {
                status: 'idle',
                boardStyle: 'seedance-board',
                generatedForOutputMode: 'storyboard-director',
                frameRatio: modeConfig.frameRatio,
                error: undefined,
                isStale: false,
                layout: modeConfig.layout,
                imageSize: storyboardBoardImageSize,
                generationTiming: boardGenerationTiming,
                directorBrief,
                directorBriefStatus: 'done',
                directorBriefError: undefined,
                directorBriefGeneratedAt: directorBriefCheckpointGeneratedAt,
                directorBriefPromptSnapshot: boardSourceSnapshot,
                directorBriefReferenceAssetIds: planReferenceAssetIds,
                plan,
                planStatus: 'optimizing',
                planError,
                planGeneratedAt: basePlanCheckpointGeneratedAt,
                planIsStale: false,
                planPromptSnapshot: boardSourceSnapshot,
                planReferenceAssetIds: planReferenceAssetIds,
              },
            );
            updateStoryboard({
              storyboardBoard: directorBriefCheckpointBoard,
            });
            if (!shouldRunStoryboardActionDirector(storyboardDirectorRunMode)) {
              planError = [
                planError,
                compactPlanning
                  ? '精简模式：已跳过动作导演连续性调度；上下文由单轮规划中的 START/END 桥接和 continuityOut 保留。'
                  : '快速模式：已跳过动作导演连续性调度。',
              ].filter(Boolean).join('；');
            } else {
              try {
                setTaskActiveStreamStageLabel('动作导演连续性调度');
                const rawActionDirectorText = await withStageTimeout(
                  () => callBatchApiViaBff(stateRef.current.apiConfig, [{
                    role: 'user',
                    content: buildStoryboardActionDirectorRequest(
                      storyboardForSmartTiming,
                      references,
                      mode,
                      plan,
                      undefined,
                      episodeShotSheetSegment,
                      targetVideoFrameRatio,
                      sequenceContinuityContext,
                      directorBrief,
                      latestAnalysis.styleConfig,
                      smartPanelCountPreference,
                      cameraSegmentCount,
                      { maxImageReferences: getVideoImageReferenceLimit(stateRef.current.videoApiConfig) },
                    ),
                  }], {
                    templateType: STORYBOARD_ACTION_DIRECTOR_TEMPLATE_TYPE,
                    templateVars: {},
                  }, STORYBOARD_ACTION_DIRECTOR_LLM_PARAMS),
                  STORYBOARD_BOARD_PLAN_TIMEOUT_MS,
                  '故事板动作导演连续性调度',
                  abortCurrentStageRequests,
                );
                ensureBatchSessionActive();
                plan = parseStoryboardBoardPlan(rawActionDirectorText, storyboardForSmartTiming, references, mode, targetVideoFrameRatio, directorBrief, smartPanelCountPreference);
              } catch (actionDirectorError) {
                throwIfAbortLikeError(actionDirectorError);
                throw new Error(formatFallbackStageReason(
                  actionDirectorError,
                  '动作导演连续性调度未完成，已停止后续生图；请重试当前分镜',
                ));
              }
            }
          } catch (planRequestError) {
            throwIfAbortLikeError(planRequestError);
            throw new Error(formatFallbackStageReason(
              planRequestError,
              '故事板导演规划失败，已停止当前分镜；不会继续生成故事板图片或最终视频词',
            ));
          }

          planGeneratedAt = Date.now();
          boardGenerationTiming = completeStoryboardBoardPlanTiming(boardGenerationTiming, planGeneratedAt);
          }
        }

        const orderedRefIds = sortStoryboardBoardReferencesByPlanPriority(references, plan).map((reference) => reference.refId);
        const priorityMap = new Map(orderedRefIds.map((refId, order) => [refId, order]));
        const orderedReferences = [...boardReferenceResolution.resolvedReferences].sort((left, right) => {
          const leftPriority = priorityMap.get(left.imageRef.refId) ?? Number.MAX_SAFE_INTEGER;
          const rightPriority = priorityMap.get(right.imageRef.refId) ?? Number.MAX_SAFE_INTEGER;
          if (leftPriority !== rightPriority) return leftPriority - rightPriority;
          return left.imageRef.refId.localeCompare(right.imageRef.refId);
        });
        const seedanceFinalPromptReferences: SeedanceFinalPromptReference[] = orderedReferences.map(({ imageRef, asset }) => ({
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
        const projectVisualStyle = resolveStoryboardProjectVisualStyle(
          storyboardForPrompt,
          plan,
          latestAnalysis.styleConfig,
        ).resolvedVisualStyle;
        const seedanceFinalPromptVoiceReferences = resolveStoryboardVoiceReferences({
          storyboard: {
            ...storyboardForPrompt,
            correctedScript: directorSourceScript,
          },
          project: latestProject,
          videoConfig: stateRef.current.videoApiConfig,
        });
        const seedanceFinalPromptSourceSnapshot = buildSeedanceFinalPromptSourceSnapshot({
          storyboard: storyboardForPrompt,
          boardPlan: plan,
          references: seedanceFinalPromptReferences,
          voiceReferences: seedanceFinalPromptVoiceReferences,
          mode,
          frameRatio: targetVideoFrameRatio,
          projectVisualStyle,
          cameraSegmentCount,
          maxImageReferences: getVideoImageReferenceLimit(stateRef.current.videoApiConfig),
        });
        const existingSeedanceFinalPromptState = getSeedanceFinalVideoPromptState(
          sb,
          seedanceFinalPromptSourceSnapshot,
        );
        const hasStoredCompletedSeedanceFinalPrompt = sb.seedanceFinalVideoPromptStatus === 'done'
          && !!sb.seedanceFinalVideoPrompt?.trim()
          && !sb.seedanceFinalVideoPromptError;
        const shouldReuseCompletedSeedanceFinalPrompt = existingSeedanceFinalPromptState.status === 'done'
          && !!existingSeedanceFinalPromptState.prompt.trim()
          && (
            existingSeedanceFinalPromptState.isUsable
            || (shouldPreserveRecoverableStoryboardDirectorCheckpoint && hasStoredCompletedSeedanceFinalPrompt)
          );
        const plannedStoryboard: StoryboardState = {
          ...storyboardForPrompt,
          ...smartDurationUpdates,
          imageRefs: refs,
          videoImageRefs: refs,
          videoImageBudget: videoImageSelection.budget,
          storyboardBoard: buildRecoverableStoryboardBoard({
            boardState: sb.storyboardBoard,
            mode,
            boardStyle: 'seedance-board',
            generatedForOutputMode: 'storyboard-director',
            frameRatio: modeConfig.frameRatio,
            layout: modeConfig.layout,
            plan,
            planError,
            planGeneratedAt,
            sourceSnapshot: boardSourceSnapshot,
            referenceAssetIds: planReferenceAssetIds,
            imageSize: storyboardBoardImageSize,
          }),
          seedanceFinalVideoPrompt: shouldReuseCompletedSeedanceFinalPrompt
            ? existingSeedanceFinalPromptState.prompt
            : '',
          seedanceFinalVideoPromptStatus: shouldReuseCompletedSeedanceFinalPrompt ? 'done' : 'idle',
          seedanceFinalVideoPromptError: undefined,
          seedanceFinalVideoPromptSourceSnapshot: shouldReuseCompletedSeedanceFinalPrompt
            ? seedanceFinalPromptSourceSnapshot
            : '',
          seedanceFinalVideoPromptUpdatedAt: shouldReuseCompletedSeedanceFinalPrompt
            ? sb.seedanceFinalVideoPromptUpdatedAt
            : undefined,
          seedanceFinalVideoPromptRunId: undefined,
        };
        const boardImageSourceSnapshot = buildStoryboardBoardSourceSnapshot(
          plannedStoryboard,
          targetVideoFrameRatio,
          sequenceContinuityContext,
          projectVisualStyle,
          { smartPanelCountPreference, smartDurationCompressionEnabled, cameraSegmentCount },
        );
        const existingBoardVariant = getStoryboardBoardVariant(sb.storyboardBoard, mode);
        const existingBoardImageSizeMatches =
          (existingBoardVariant?.imageSize ?? DEFAULT_STORYBOARD_BOARD_IMAGE_SIZE) === storyboardBoardImageSize;
        const hasStoredCompletedBoardImage = existingBoardVariant?.status === 'done'
          && !!existingBoardVariant.blobKey
          && !existingBoardVariant.isStale
          && existingBoardImageSizeMatches;
        const shouldReuseCompletedBoardImage = (
          isStoryboardBoardImageFresh(
            existingBoardVariant,
            boardImageSourceSnapshot,
            planReferenceAssetIds,
          ) && existingBoardImageSizeMatches
        ) || (shouldPreserveRecoverableStoryboardDirectorCheckpoint && hasStoredCompletedBoardImage);
        recoverableStoryboardBoard = buildRecoverableStoryboardBoard({
          boardState: sb.storyboardBoard,
          mode,
          boardStyle: 'seedance-board',
          generatedForOutputMode: 'storyboard-director',
          frameRatio: modeConfig.frameRatio,
          layout: modeConfig.layout,
          plan,
          planError,
          planGeneratedAt,
          sourceSnapshot: boardSourceSnapshot,
          referenceAssetIds: planReferenceAssetIds,
          imageSize: storyboardBoardImageSize,
        });
        const boardGenerationStartedAt = Date.now();
        if (shouldReuseCompletedBoardImage) {
          recoverableStoryboardBoard = replaceStoryboardBoardVariant(sb.storyboardBoard, mode, {
            ...(existingBoardVariant ?? {}),
            status: 'done',
            boardStyle: 'seedance-board',
            generatedForOutputMode: 'storyboard-director',
            frameRatio: modeConfig.frameRatio,
            error: undefined,
            isStale: false,
            layout: modeConfig.layout,
            imageSize: storyboardBoardImageSize,
            generationTiming: boardGenerationTiming,
            promptSnapshot: boardImageSourceSnapshot,
            referenceAssetIds: planReferenceAssetIds,
            directorBrief: plan.directorBrief,
            directorBriefStatus: plan.directorBrief ? 'done' : 'idle',
            directorBriefError: undefined,
            directorBriefGeneratedAt: planGeneratedAt,
            directorBriefPromptSnapshot: boardSourceSnapshot,
            directorBriefReferenceAssetIds: planReferenceAssetIds,
            plan,
            planStatus: 'done',
            planError,
            planGeneratedAt,
            planIsStale: false,
            planPromptSnapshot: boardSourceSnapshot,
            planReferenceAssetIds: planReferenceAssetIds,
          });
          setTaskActiveStreamStageLabel(isSmartShotPlanBoardMode(mode) ? '已保留智能故事板图片，补跑最终词' : '已保留15格图片，补跑最终词');
        } else {
          boardGenerationTiming = beginStoryboardBoardImageTiming(boardGenerationTiming, boardGenerationStartedAt);
          recoverableStoryboardBoard = mergeStoryboardBoardVariant(recoverableStoryboardBoard, mode, {
            status: 'generating',
            startedAt: boardGenerationStartedAt,
            error: undefined,
            generationTiming: boardGenerationTiming,
          });
        }
        const spatialBlocking = storyboardBoardPlanToSpatialBlocking(plan, effectiveSbInfo.scene) ?? undefined;
        const generatedLastFrameInfo = plan.blockingContinuity.currentEnd
          || plan.panels.at(-1)?.continuityOut
          || (spatialBlocking ? summarizeSpatialBlocking(spatialBlocking) : directorSourceScript.slice(0, 180));
        const continuityOutput = {
          itemTracker: currentItemTracker,
          lastFrameInfo: generatedLastFrameInfo,
          spatialBlocking,
          summary: buildStoryboardNarrativeSummary({
            ...storyboardForBoard,
            storyboardBoard: recoverableStoryboardBoard,
            lastFrameInfo: generatedLastFrameInfo,
            spatialBlocking,
          }),
          sourceStoryboardIndex: index,
          generatedAt: Date.now(),
        };
        const seedanceFinalPromptRunId = `${boardGenerationStartedAt}-${Math.random().toString(36).slice(2)}`;
        if (!batchSessionId) resetApi();
        updateStoryboard({
          storyboard: effectiveSbInfo,
          sourceExcerpt: storyboardSource.sourceExcerpt,
          sourceExcerptSummary: storyboardSource.sourceExcerptSummary,
          nextStoryboardSummary: storyboardSource.nextStoryboardSummary,
          step4OutputMode: 'storyboard-director',
          generatedStep4OutputMode: 'storyboard-director',
          storyboardBoardStyle: 'seedance-board',
          useStoryboardBoardReference: true,
          correctedScript: directorSourceScript,
          sceneBlueprint: sb.sceneBlueprint ?? currentSceneBlueprint,
          choreography: null,
          prompt: null,
          imageRefs: refs,
          videoImageRefs: refs,
          videoImageBudget: videoImageSelection.budget,
          selfCheckResult: null,
          lastFrameInfo: generatedLastFrameInfo,
          spatialBlocking,
          continuityOutput,
          continuityInput: {
            itemTracker: continuityInput.itemTracker,
            lastFrameInfo: continuityInput.lastFrameInfo,
            spatialBlocking: continuitySpatialBlocking,
            sourceStoryboardIndex: continuityInput.sourceStoryboardIndex,
          },
          storyboardBoard: recoverableStoryboardBoard,
          seedanceFinalVideoPrompt: shouldReuseCompletedSeedanceFinalPrompt
            ? existingSeedanceFinalPromptState.prompt
            : '',
          seedanceFinalVideoPromptStatus: shouldReuseCompletedSeedanceFinalPrompt ? 'done' : 'idle',
          seedanceFinalVideoPromptError: undefined,
          seedanceFinalVideoPromptSourceSnapshot: seedanceFinalPromptSourceSnapshot,
          seedanceFinalVideoPromptUpdatedAt: shouldReuseCompletedSeedanceFinalPrompt
            ? (sb.seedanceFinalVideoPromptUpdatedAt ?? Date.now())
            : Date.now(),
          seedanceFinalVideoPromptRunId: shouldReuseCompletedSeedanceFinalPrompt
            ? undefined
            : seedanceFinalPromptRunId,
          ...smartDurationUpdates,
          isStale: false,
          status: 'generating',
          error: undefined,
          step4StartedAt: boardGenerationStartedAt,
        });

        let seedanceFinalPromptStarted = false;
        const isSeedanceFinalPromptRunActive = () => {
          if (!isBatchSessionActive()) return false;
          const currentStoryboard = getLatestStoryboards(stateRef, targetProjectId, targetChapterId)[index];
          if (!currentStoryboard || currentStoryboard.status === 'error' || currentStoryboard.isStale) return false;
          return currentStoryboard.seedanceFinalVideoPromptRunId === seedanceFinalPromptRunId;
        };
        const dispatchSeedanceFinalPromptUpdate = (updates: Partial<StoryboardState>) => {
          if (!isSeedanceFinalPromptRunActive()) return false;
          dispatch({
            type: 'UPDATE_STORYBOARD',
            index,
            ...target,
            updates,
          });
          return true;
        };
        const startSeedanceFinalPromptGeneration = (): Promise<void> => {
          seedanceFinalPromptStarted = true;
          setTaskActiveStreamStageLabel('Seedance 最终视频词');
          const apiConfigSnapshot = stateRef.current.apiConfig;
          if (!apiConfigSnapshot.apiKey) {
            const message = '请先在设置中填写 LLM API Key，才能生成 Seedance 最终视频词。';
            dispatch({
              type: 'UPDATE_STORYBOARD',
              index,
              ...target,
              updates: {
                seedanceFinalVideoPromptStatus: 'failed',
                seedanceFinalVideoPromptError: message,
                seedanceFinalVideoPromptSourceSnapshot: seedanceFinalPromptSourceSnapshot,
                seedanceFinalVideoPromptUpdatedAt: Date.now(),
                seedanceFinalVideoPromptRunId: seedanceFinalPromptRunId,
              },
            });
            const failedTask = Promise.reject(new SeedanceFinalPromptGenerationError(message));
            void failedTask.catch(() => undefined);
            return failedTask;
          }

          const seedancePromptController = new AbortController();
          activeSeedanceFinalPromptControllerRef.current = seedancePromptController;
          activeSeedanceFinalPromptControllersRef.current.add(seedancePromptController);
          registerSessionController(
            activeSeedanceFinalPromptControllersBySessionRef,
            batchSessionId,
            seedancePromptController,
          );
          dispatch({
            type: 'UPDATE_STORYBOARD',
            index,
            ...target,
            updates: {
              seedanceFinalVideoPrompt: '',
              seedanceFinalVideoPromptStatus: 'generating',
              seedanceFinalVideoPromptError: undefined,
              seedanceFinalVideoPromptSourceSnapshot: seedanceFinalPromptSourceSnapshot,
              seedanceFinalVideoPromptUpdatedAt: Date.now(),
              seedanceFinalVideoPromptRunId: seedanceFinalPromptRunId,
            },
          });

          let lastSeedancePromptPreview = '';
          let lastSeedancePromptPreviewAt = 0;
          const dispatchSeedancePromptPreview = (fullText: string, force = false) => {
            if (!isSeedanceFinalPromptRunActive()) return;
            const trimmedText = fullText.trim();
            if (!trimmedText) return;
            const now = Date.now();
            const gainedChars = trimmedText.length - lastSeedancePromptPreview.length;
            if (!force && now - lastSeedancePromptPreviewAt < GLOBAL_TASK_STREAM_UPDATE_INTERVAL_MS && gainedChars < GLOBAL_TASK_STREAM_UPDATE_MIN_CHARS) return;
            lastSeedancePromptPreview = trimmedText;
            lastSeedancePromptPreviewAt = now;
            updateGlobalTaskStreamPreview(trimmedText, force);
            dispatchSeedanceFinalPromptUpdate({
              seedanceFinalVideoPrompt: trimmedText,
              seedanceFinalVideoPromptStatus: 'generating',
              seedanceFinalVideoPromptError: undefined,
              seedanceFinalVideoPromptSourceSnapshot: seedanceFinalPromptSourceSnapshot,
              seedanceFinalVideoPromptUpdatedAt: now,
              seedanceFinalVideoPromptRunId: seedanceFinalPromptRunId,
            });
          };

          const seedancePromptConcurrency = batchSessionId
            ? normalizeSeedanceFinalPromptConcurrency(
                stateRef.current.globalTaskSettings?.step4SeedancePromptConcurrency
                  ?? SEEDANCE_FINAL_PROMPT_CONCURRENCY,
              )
            : SEEDANCE_FINAL_PROMPT_CONCURRENCY;
          const seedancePromptTask = runConcurrentSeedanceFinalPromptGeneration(() => {
            ensureBatchSessionActive();
            if (seedancePromptController.signal.aborted) {
              throw new DOMException('The user aborted a request.', 'AbortError');
            }
            return requestSeedanceFinalVideoPromptStream({
              storyboard: {
                ...plannedStoryboard,
                correctedScript: directorSourceScript,
                sourceExcerpt: storyboardSource.sourceExcerpt,
                sourceExcerptSummary: storyboardSource.sourceExcerptSummary,
                nextStoryboardSummary: storyboardSource.nextStoryboardSummary,
                sceneBlueprint: sb.sceneBlueprint ?? currentSceneBlueprint,
                imageRefs: refs,
                videoImageRefs: refs,
                videoImageBudget: videoImageSelection.budget,
                lastFrameInfo: generatedLastFrameInfo,
                spatialBlocking,
                storyboardBoard: recoverableStoryboardBoard,
                generatedStep4OutputMode: 'storyboard-director',
                storyboardBoardStyle: 'seedance-board',
                status: 'generating',
              },
              boardPlan: plan,
              references: seedanceFinalPromptReferences,
              voiceReferences: seedanceFinalPromptVoiceReferences,
              mode,
              frameRatio: targetVideoFrameRatio,
              projectVisualStyle,
              cameraSegmentCount,
              maxImageReferences: getVideoImageReferenceLimit(stateRef.current.videoApiConfig),
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
            }, undefined, seedancePromptController.signal);
          }, seedancePromptConcurrency)
            .then((finalPrompt) => {
              if (!isSeedanceFinalPromptRunActive()) return;
              const trimmedFinalPrompt = finalPrompt.trim();
              if (!trimmedFinalPrompt) {
                throw new SeedanceFinalPromptGenerationError('Seedance 最终视频词为空，已标记为失败。');
              }
              dispatchSeedancePromptPreview(trimmedFinalPrompt, true);
              dispatchSeedanceFinalPromptUpdate({
                seedanceFinalVideoPrompt: trimmedFinalPrompt,
                seedanceFinalVideoPromptStatus: 'done',
                seedanceFinalVideoPromptError: undefined,
                seedanceFinalVideoPromptSourceSnapshot: seedanceFinalPromptSourceSnapshot,
                seedanceFinalVideoPromptUpdatedAt: Date.now(),
                seedanceFinalVideoPromptRunId: seedanceFinalPromptRunId,
              });
            })
            .catch((error: unknown) => {
              if (!isBatchSessionActive() || isAbortLikeError(error)) throw error;
              if (!isSeedanceFinalPromptRunActive()) return;
              const message = error instanceof Error ? error.message : String(error);
              dispatchSeedanceFinalPromptUpdate({
                seedanceFinalVideoPromptStatus: 'failed',
                seedanceFinalVideoPromptError: message,
                seedanceFinalVideoPromptSourceSnapshot: seedanceFinalPromptSourceSnapshot,
                seedanceFinalVideoPromptUpdatedAt: Date.now(),
                seedanceFinalVideoPromptRunId: seedanceFinalPromptRunId,
              });
              if (error instanceof SeedanceFinalPromptGenerationError) throw error;
              throw new SeedanceFinalPromptGenerationError(`Seedance 最终视频词生成失败：${message}`);
            })
            .finally(() => {
              activeSeedanceFinalPromptControllersRef.current.delete(seedancePromptController);
              unregisterSessionController(
                activeSeedanceFinalPromptControllersBySessionRef,
                batchSessionId,
                seedancePromptController,
              );
              if (activeSeedanceFinalPromptControllerRef.current === seedancePromptController) {
                activeSeedanceFinalPromptControllerRef.current = null;
              }
            });
          void seedancePromptTask.catch(() => undefined);
          return seedancePromptTask;
        };

        const referenceBlobResults = shouldReuseCompletedBoardImage
          ? []
          : await Promise.all(
            orderedReferences.map(async (reference) => ({
              reference,
              blob: (await loadPreferredAssetBlob(reference.asset)).blob,
            })),
          );
        const missingBlobs = shouldReuseCompletedBoardImage
          ? []
          : referenceBlobResults.filter((entry) => !entry.blob);
        if (missingBlobs.length > 0) {
          const missing = missingBlobs
            .slice(0, 4)
            .map(({ reference }) => `${reference.imageRef.refId} ${reference.imageRef.name}`)
            .join('、');
          throwRequiredStageError('详细故事板生成', `以下参考图读取失败：${missing}`);
        }

        const seedanceFinalPromptTask = shouldReuseCompletedSeedanceFinalPrompt
          ? Promise.resolve()
          : startSeedanceFinalPromptGeneration();
        if (shouldReuseCompletedBoardImage) {
          await seedanceFinalPromptTask;
          ensureBatchSessionActive();
          if (!shouldReuseCompletedSeedanceFinalPrompt && !isSeedanceFinalPromptRunActive()) {
            throw new DOMException('The user aborted a request.', 'AbortError');
          }

          updateStoryboard({
            storyboardBoard: recoverableStoryboardBoard,
            status: 'done',
            error: undefined,
            step4StartedAt: undefined,
          });
          return;
        }

        const boardPrompt = buildStoryboardBoardPrompt(
          storyboardForPrompt,
          orderedReferences.map(({ imageRef }) => imageRef),
          mode,
          plan,
          'seedance-board',
          { frameRatio: targetVideoFrameRatio, sequenceContinuityContext, projectVisualStyle },
        );
        const boardImageTimeoutMs = batchSessionId
          ? STORYBOARD_BOARD_BATCH_IMAGE_TIMEOUT_MS
          : STORYBOARD_BOARD_SINGLE_IMAGE_TIMEOUT_MS;
        const boardImageConcurrency = batchSessionId
          ? normalizeStoryboardBoardImageConcurrency(
              stateRef.current.globalTaskSettings?.step4StoryboardImageConcurrency
                ?? STORYBOARD_BOARD_BATCH_IMAGE_CONCURRENCY,
            )
          : latestProject?.step3Settings?.generateConcurrency ?? STORYBOARD_BOARD_IMAGE_CONCURRENCY;
        setTaskActiveStreamStageLabel(getStoryboardImageStageLabel(mode));
        const boardImage = await runConcurrentStoryboardBoardImageGeneration(async () => {
          return runStoryboardBoardImageWithRetry(async () => {
            ensureBatchSessionActive();
            const boardImageController = new AbortController();
            activeStoryboardBoardImageControllersRef.current.add(boardImageController);
            registerSessionController(
              activeStoryboardBoardImageControllersBySessionRef,
              batchSessionId,
              boardImageController,
            );
            try {
              return await withStageTimeout(
                () => generateImage(stateRef.current.imageApiConfig, {
                  prompt: boardPrompt,
                  aspectRatio: modeConfig.aspectRatio,
                  imageSize: storyboardBoardImageSize,
                  referenceBlobs: referenceBlobResults
                    .map((entry) => entry.blob)
                    .filter((blob): blob is Blob => !!blob),
                  referenceLabels: orderedReferences.map(({ imageRef }) =>
                    buildBoardReferenceLabel(imageRef.refId, imageRef.type, imageRef.name, projectVisualStyle),
                  ),
                  signal: boardImageController.signal,
                  background: {
                    projectId: targetProjectId,
                    chapterId: targetChapterId,
                    storyboardIndex: index,
                    namespace: `step4-board-${mode}-${index}`,
                    requireBackend: false,
                  },
                }, stateRef.current.videoApiConfig),
                boardImageTimeoutMs,
                isSmartShotPlanBoardMode(mode) ? '故事板智能图片生成' : '故事板15格图片生成',
                () => boardImageController.abort(),
              );
            } finally {
              activeStoryboardBoardImageControllersRef.current.delete(boardImageController);
              unregisterSessionController(
                activeStoryboardBoardImageControllersBySessionRef,
                batchSessionId,
                boardImageController,
              );
            }
          }, {
            delaysMs: STORYBOARD_BOARD_IMAGE_RETRY_DELAYS_MS,
            isAborted: () => !isBatchSessionActive(),
            onRetry: (event) => {
              setTaskActiveStreamStageLabel(getStoryboardImageStageLabel(mode, true));
              const retryNotice = formatStoryboardBoardImageRetryNotice(event);
              const retryStartedAt = Date.now();
              const retryFailedState = markRecoverableStoryboardBoardImageFailed(
                recoverableStoryboardBoard,
                recoverableStoryboardBoardMode,
                retryNotice,
              ) ?? recoverableStoryboardBoard;
              boardGenerationTiming = beginStoryboardBoardImageTiming(
                failStoryboardBoardImageTiming(
                  getStoryboardBoardVariant(retryFailedState, mode)?.generationTiming ?? boardGenerationTiming,
                  event.error,
                  retryStartedAt,
                  isStoryboardBoardImageTimeoutMessage(event.error),
                  boardGenerationStartedAt,
                ),
                retryStartedAt,
              );
              recoverableStoryboardBoard = mergeStoryboardBoardVariant(retryFailedState, mode, {
                status: 'generating',
                startedAt: retryStartedAt,
                error: retryNotice,
                generationTiming: boardGenerationTiming,
              });
              updateStoryboard({
                storyboardBoard: recoverableStoryboardBoard,
                error: retryNotice,
              });
            },
          });
        }, boardImageConcurrency);
        ensureBatchSessionActive();

        const shouldComposeDetailedBoard = isComposableStoryboardBoardMode(mode);
        const composedBlob = shouldComposeDetailedBoard
            ? await composeStoryboardBoardBlob(boardImage.blob, {
                mode,
                storyboard: storyboardForPrompt,
                panels: plan.panels,
              })
          : boardImage.blob;
        const [blobKey, visualBoardBlobKey] = await Promise.all([
          saveBlob(composedBlob),
          shouldComposeDetailedBoard ? saveBlob(boardImage.blob) : Promise.resolve(undefined),
        ]);
        const previousVariant = getStoryboardBoardVariant(sb.storyboardBoard, mode);
        const boardGeneratedAt = Date.now();
        boardGenerationTiming = completeStoryboardBoardImageTiming(
          boardGenerationTiming,
          boardGeneratedAt,
          boardGenerationStartedAt,
        );
        const storyboardWithPlan: StoryboardState = {
          ...storyboardForPrompt,
          ...smartDurationUpdates,
          storyboardBoard: replaceStoryboardBoardVariant(sb.storyboardBoard, mode, {
            status: 'done',
            boardStyle: 'seedance-board',
            generatedForOutputMode: 'storyboard-director',
            frameRatio: modeConfig.frameRatio,
            visualBoardBlobKey,
            blobKey,
            generatedAt: boardGeneratedAt,
            error: undefined,
            isStale: false,
            layout: modeConfig.layout,
            imageSize: storyboardBoardImageSize,
            generationTiming: boardGenerationTiming,
            promptSnapshot: '',
            referenceAssetIds: planReferenceAssetIds,
            directorBrief: plan.directorBrief,
            directorBriefStatus: plan.directorBrief ? 'done' : 'idle',
            directorBriefError: undefined,
            directorBriefGeneratedAt: planGeneratedAt,
            directorBriefPromptSnapshot: boardSourceSnapshot,
            directorBriefReferenceAssetIds: planReferenceAssetIds,
            plan,
            planStatus: 'done',
            planError,
            planGeneratedAt,
            planIsStale: false,
            planPromptSnapshot: boardSourceSnapshot,
            planReferenceAssetIds: planReferenceAssetIds,
          }),
          seedanceFinalVideoPrompt: '',
          seedanceFinalVideoPromptStatus: 'idle',
          seedanceFinalVideoPromptError: undefined,
          seedanceFinalVideoPromptSourceSnapshot: '',
          seedanceFinalVideoPromptUpdatedAt: undefined,
          seedanceFinalVideoPromptRunId: undefined,
        };
        const sourceSnapshot = buildStoryboardBoardSourceSnapshot(
          storyboardWithPlan,
          targetVideoFrameRatio,
          sequenceContinuityContext,
          projectVisualStyle,
          { smartPanelCountPreference, smartDurationCompressionEnabled, cameraSegmentCount },
        );
        const boardState = replaceStoryboardBoardVariant(sb.storyboardBoard, mode, {
          status: 'done',
          boardStyle: 'seedance-board',
          generatedForOutputMode: 'storyboard-director',
          frameRatio: modeConfig.frameRatio,
          visualBoardBlobKey,
          blobKey,
          referencePack: [],
          generatedAt: boardGeneratedAt,
          error: undefined,
          isStale: false,
          layout: modeConfig.layout,
          imageSize: storyboardBoardImageSize,
          generationTiming: boardGenerationTiming,
          promptSnapshot: sourceSnapshot,
          referenceAssetIds: planReferenceAssetIds,
          directorBrief: plan.directorBrief,
          directorBriefStatus: plan.directorBrief ? 'done' : 'idle',
          directorBriefError: undefined,
          directorBriefGeneratedAt: planGeneratedAt,
          directorBriefPromptSnapshot: boardSourceSnapshot,
          directorBriefReferenceAssetIds: planReferenceAssetIds,
          plan,
          planStatus: 'done',
          planError,
          planGeneratedAt,
          planIsStale: false,
          planPromptSnapshot: boardSourceSnapshot,
          planReferenceAssetIds: planReferenceAssetIds,
        });
        recoverableStoryboardBoard = boardState;
        if (previousVariant?.blobKey && previousVariant.blobKey !== blobKey) {
          deleteBlob(previousVariant.blobKey).catch(() => undefined);
        }
        if (previousVariant?.visualBoardBlobKey && previousVariant.visualBoardBlobKey !== visualBoardBlobKey) {
          deleteBlob(previousVariant.visualBoardBlobKey).catch(() => undefined);
        }
        if (previousVariant?.lightweightBlobKey) {
          deleteBlob(previousVariant.lightweightBlobKey).catch(() => undefined);
        }
        updateStoryboard({
          storyboard: effectiveSbInfo,
          sourceExcerpt: storyboardSource.sourceExcerpt,
          sourceExcerptSummary: storyboardSource.sourceExcerptSummary,
          nextStoryboardSummary: storyboardSource.nextStoryboardSummary,
          step4OutputMode: 'storyboard-director',
          generatedStep4OutputMode: 'storyboard-director',
          storyboardBoardStyle: 'seedance-board',
          useStoryboardBoardReference: true,
          correctedScript: directorSourceScript,
          sceneBlueprint: sb.sceneBlueprint ?? currentSceneBlueprint,
          choreography: null,
          prompt: null,
          imageRefs: refs,
          videoImageRefs: refs,
          videoImageBudget: videoImageSelection.budget,
          selfCheckResult: null,
          lastFrameInfo: generatedLastFrameInfo,
          spatialBlocking,
          continuityOutput: {
            itemTracker: currentItemTracker,
            lastFrameInfo: generatedLastFrameInfo,
            spatialBlocking,
            summary: buildStoryboardNarrativeSummary({
              ...storyboardForBoard,
              storyboardBoard: boardState,
              lastFrameInfo: generatedLastFrameInfo,
              spatialBlocking,
            }),
            sourceStoryboardIndex: index,
            generatedAt: Date.now(),
          },
          isStale: false,
          storyboardBoard: boardState,
          ...smartDurationUpdates,
          status: 'generating',
          error: undefined,
          step4StartedAt: boardGenerationStartedAt,
        });

        await seedanceFinalPromptTask;
        ensureBatchSessionActive();
        if (!shouldReuseCompletedSeedanceFinalPrompt && !isSeedanceFinalPromptRunActive()) {
          throw new DOMException('The user aborted a request.', 'AbortError');
        }

        updateStoryboard({
          status: 'done',
          error: undefined,
          step4StartedAt: undefined,
        });

        const latestSeedancePromptSnapshot = getLatestStoryboards(stateRef, targetProjectId, targetChapterId)[index]
          ?.seedanceFinalVideoPromptSourceSnapshot;
        if (!batchSessionId && !seedanceFinalPromptStarted && !latestSeedancePromptSnapshot) {
          const apiConfigSnapshot = stateRef.current.apiConfig;
          const seedancePromptStartedAt = Date.now();
          const seedancePromptTiming = beginStoryboardBoardSeedanceTiming(
            getStoryboardBoardVariant(boardState, mode)?.generationTiming,
            seedancePromptStartedAt,
          );
          const seedancePromptBoardState = mergeStoryboardBoardVariant(boardState, mode, {
            generationTiming: seedancePromptTiming,
          });
          if (!apiConfigSnapshot.apiKey) {
          dispatch({
            type: 'UPDATE_STORYBOARD',
            index,
            ...target,
            updates: {
              seedanceFinalVideoPromptStatus: 'failed',
              seedanceFinalVideoPromptError: '请先在设置中填写 LLM API Key，才能生成 Seedance 最终视频词。',
              seedanceFinalVideoPromptSourceSnapshot: seedanceFinalPromptSourceSnapshot,
              seedanceFinalVideoPromptUpdatedAt: Date.now(),
              storyboardBoard: mergeStoryboardBoardVariant(seedancePromptBoardState, mode, {
                generationTiming: failStoryboardBoardSeedanceTiming(seedancePromptTiming, 'Seedance final prompt API key missing'),
              }),
            },
          });
        } else {
          dispatch({
            type: 'UPDATE_STORYBOARD',
            index,
            ...target,
            updates: {
              seedanceFinalVideoPromptStatus: 'generating',
              seedanceFinalVideoPromptError: undefined,
              seedanceFinalVideoPromptSourceSnapshot: seedanceFinalPromptSourceSnapshot,
              seedanceFinalVideoPromptUpdatedAt: Date.now(),
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
            if (!force && now - lastSeedancePromptPreviewAt < GLOBAL_TASK_STREAM_UPDATE_INTERVAL_MS && gainedChars < GLOBAL_TASK_STREAM_UPDATE_MIN_CHARS) return;
            lastSeedancePromptPreview = trimmedText;
            lastSeedancePromptPreviewAt = now;
            dispatch({
              type: 'UPDATE_STORYBOARD',
              index,
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

          void requestSeedanceFinalVideoPromptStream({
            storyboard: {
              ...storyboardForPrompt,
              correctedScript: directorSourceScript,
              sourceExcerpt: storyboardSource.sourceExcerpt,
              sourceExcerptSummary: storyboardSource.sourceExcerptSummary,
              nextStoryboardSummary: storyboardSource.nextStoryboardSummary,
              sceneBlueprint: sb.sceneBlueprint ?? currentSceneBlueprint,
              imageRefs: refs,
              videoImageRefs: refs,
              videoImageBudget: videoImageSelection.budget,
              lastFrameInfo: generatedLastFrameInfo,
              spatialBlocking,
              storyboardBoard: boardState,
              generatedStep4OutputMode: 'storyboard-director',
              storyboardBoardStyle: 'seedance-board',
              status: 'done',
            },
            boardPlan: plan,
            references: seedanceFinalPromptReferences,
            voiceReferences: seedanceFinalPromptVoiceReferences,
            mode,
            frameRatio: targetVideoFrameRatio,
            projectVisualStyle,
            cameraSegmentCount,
            maxImageReferences: getVideoImageReferenceLimit(stateRef.current.videoApiConfig),
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
          })
            .then((finalPrompt) => {
              dispatchSeedancePromptPreview(finalPrompt, true);
              dispatch({
                type: 'UPDATE_STORYBOARD',
                index,
                ...target,
                updates: {
                  seedanceFinalVideoPrompt: finalPrompt,
                  seedanceFinalVideoPromptStatus: 'done',
                  seedanceFinalVideoPromptError: undefined,
                  seedanceFinalVideoPromptSourceSnapshot: seedanceFinalPromptSourceSnapshot,
                  seedanceFinalVideoPromptUpdatedAt: Date.now(),
                  storyboardBoard: mergeStoryboardBoardVariant(seedancePromptBoardState, mode, {
                    generationTiming: completeStoryboardBoardSeedanceTiming(seedancePromptTiming),
                  }),
                },
              });
            })
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              dispatch({
                type: 'UPDATE_STORYBOARD',
                index,
                ...target,
                updates: {
                  seedanceFinalVideoPromptStatus: 'failed',
                  seedanceFinalVideoPromptError: message,
                  seedanceFinalVideoPromptSourceSnapshot: seedanceFinalPromptSourceSnapshot,
                  seedanceFinalVideoPromptUpdatedAt: Date.now(),
                  storyboardBoard: mergeStoryboardBoardVariant(seedancePromptBoardState, mode, {
                    generationTiming: failStoryboardBoardSeedanceTiming(seedancePromptTiming, message),
                  }),
                },
              });
            });
        }
        }
        return;
      }

      // ========== Step 1: 检查(check) ==========
      updateStoryboard({ status: 'checking', error: undefined });

      const checkUserMessages: ChatMessage[] = [
        {
          role: 'user',
          content: buildCheckPrompt(
            sbInfo,
            primaryScriptText,
            latestAnalysis,
            continuityInput.lastFrameInfo,
            currentItemTracker,
            isSbLast,
            isSbFirst,
            prevLogicFixSummary,
            latestAnalysis.propTracking,
            storyboardSource.nextStoryboardSummary,
            continuitySpatialBlocking,
            sceneSpatialBible,
          ),
        },
      ];

      const checkResult = requireStageText(await callBatchApiViaBff(stateRef.current.apiConfig, checkUserMessages, {
          templateType: 'check',
          templateVars: { styleConfig: latestAnalysis.styleConfig, videoRatio: stateRef.current.videoApiConfig.videoRatio },
      }, { temperature: 0.3, maxTokens: 4000 }), '逻辑检查(check)');
      ensureBatchSessionActive();

      // 解析检查结果
      const logicFixes = parseLogicFixes(checkResult);
      const preprocessNotes = parsePreprocessNotes(checkResult);
      const sceneBlueprint = parseSceneBlueprint(checkResult);
      currentSceneBlueprint = sceneBlueprint;

      // 解析物品状态更新
      const itemTrackerUpdate = parseItemTrackerUpdate(checkResult);
      if (Object.keys(itemTrackerUpdate).length > 0) {
        const mergedTracker = { ...currentItemTracker, ...itemTrackerUpdate };
        setItemTracker(mergedTracker);
      }

      updateStoryboard({ logicFixes, sceneBlueprint });

      // ========== Step 2: 修正(correct) ==========
      updateStoryboard({ status: 'correcting' });
      setTaskActiveStreamPhase('correcting');
      setTaskActiveStreamStageLabel('修正剧本');

      const correctUserMessages: ChatMessage[] = [
        {
          role: 'user',
          content: buildCorrectPrompt(
            sbInfo,
            primaryScriptText,
            logicFixes,
            isSbFirst,
            isSbLast,
            currentItemTracker,
            latestAnalysis.propTracking,
            prevNarrativeSummary,
            prevLogicFixSummary,
            currentSceneBlueprint,
            storyboardSource.nextStoryboardSummary,
            acceptedCharacterNames,
          ),
        },
      ];

      const correctResult = requireStageText(await callBatchApiViaBff(stateRef.current.apiConfig, correctUserMessages, {
        templateType: 'correct',
        templateVars: {},
      }, { temperature: 0.5, maxTokens: 4000 }), '剧本修正(correct)');
      ensureBatchSessionActive();

      const parsedCorrectResult = parseCorrectResult(correctResult, currentSceneBlueprint);

      if (!parsedCorrectResult.correctedScript || parsedCorrectResult.correctedScript.trim().length < 10) {
        throwRequiredStageError('剧本修正(correct)', '未解析到有效的【修正后剧本】。');
      }
      const sanitizedCorrected = stripAddedDialogueLinesFromCorrectedScript(primaryScriptText, parsedCorrectResult.correctedScript);
      if (sanitizedCorrected.changed && import.meta.env.DEV) {
        console.warn('[Step4] correct 阶段输出了源剧本外台词，已自动剔除新增台词行后复检。');
      }
      const effectiveCorrectedScript = sanitizedCorrected.script;
      assertDialogueFidelity('剧本修正(correct)', primaryScriptText, effectiveCorrectedScript, dialogueFidelityOptions);

      currentSceneBlueprint = parsedCorrectResult.sceneBlueprint ?? currentSceneBlueprint;

      effectiveSbInfo = augmentStoryboardCharactersFromText(
        sbInfo,
        latestAnalysis,
        [primaryScriptText, effectiveCorrectedScript],
        projectAssetLibrary,
        logicFixes,
      );
      refs = resolveRefsForStoryboard(effectiveSbInfo);
      const sceneDetailForSpatialBible = latestAnalysis.scenes.find((scene) => scene.name === effectiveSbInfo.scene) ?? null;
      sceneSpatialBible = buildSceneSpatialBible(effectiveSbInfo, sceneDetailForSpatialBible);
      const videoImageSelection = selectVideoImageRefs({
        refs,
        storyboard: effectiveSbInfo,
        correctedScript: effectiveCorrectedScript,
        analysis: latestAnalysis,
        allStoryboards: latestAnalysis.storyboards,
        storyboardIndex: index,
        propTracking: latestAnalysis.propTracking,
        assetLibrary: projectAssetLibrary,
        maxRefs: getVideoImageReferenceLimit(stateRef.current.videoApiConfig),
      });
      refs = videoImageSelection.selectedRefs;
      continuitySpatialBlocking = filterSpatialBlockingCharacters(
        continuityInput.spatialBlocking,
        getSpatialContinuityCharacterNames(effectiveSbInfo, refs),
      );

      updateStoryboard({
        storyboard: effectiveSbInfo,
        correctedScript: effectiveCorrectedScript,
        sceneBlueprint: currentSceneBlueprint,
        imageRefs: refs,
        videoImageRefs: refs,
        videoImageBudget: videoImageSelection.budget,
      });

      // ========== Step 2.5: 动作编排(choreograph) ==========
      let choreography: Choreography | null = null;
      let choreographSpatialIssues: ReturnType<typeof validateSpatialContinuity> = [];
      updateStoryboard({ status: 'choreographing' });
      setTaskActiveStreamPhase('choreographing');
      setTaskActiveStreamStageLabel('动作编排');

      try {
        const choreographUserMessages: ChatMessage[] = [
          {
            role: 'user',
            content: buildChoreographPrompt(
              effectiveSbInfo,
              primaryScriptText,
              latestAnalysis,
              refs,
              effectiveCorrectedScript,
              currentSceneBlueprint,
              continuityInput.lastFrameInfo,
              latestAnalysis.propTracking,
              currentItemTracker,
              isSbFirst,
              isSbLast,
              latestAnalysis.styleConfig,
              prevNarrativeSummary,
              prevLogicFixSummary,
              storyboardSource.nextStoryboardSummary,
              preprocessNotes,
              continuitySpatialBlocking,
              sceneSpatialBible,
            ),
          },
        ];

        const choreographResult = requireStageText(await withStageTimeout(
          () => callBatchApiViaBff(stateRef.current.apiConfig, choreographUserMessages, {
            templateType: 'choreograph',
            templateVars: {
              sceneType: currentSceneBlueprint?.sceneType,
              combatSubType: currentSceneBlueprint?.combatSubType,
              videoRatio: stateRef.current.videoApiConfig.videoRatio,
              maxImageReferences: getVideoImageReferenceLimit(stateRef.current.videoApiConfig),
            },
          }, { temperature: 0.4, maxTokens: 10000 }),
          CHOREOGRAPH_STAGE_TIMEOUT_MS,
          'choreograph',
          abortCurrentStageRequests,
        ), '动作编排(choreograph)');
        ensureBatchSessionActive();

        choreography = parseChoreography(choreographResult, refs);
        choreography = applyInferredScenePositionPointsToChoreography(choreography, continuitySpatialBlocking);

        // 如果首次解析失败，重试一次
        if (!choreography) {
          console.warn('[Step4] Choreography parse returned null, retrying once...');
          const retryUserMessages = [
            ...choreographUserMessages,
            {
              role: 'user' as const,
              content: '上一次输出的JSON格式有误，无法解析。请重新输出完整的编排方案，确保：1) 输出合法的JSON格式；2) 用```json代码块包裹；3) 不要在JSON之外添加多余文本。',
            },
          ];
          const retryResult = requireStageText(await withStageTimeout(
            () => callBatchApiViaBff(stateRef.current.apiConfig, retryUserMessages, {
              templateType: 'choreograph',
              templateVars: {
                sceneType: currentSceneBlueprint?.sceneType,
                combatSubType: currentSceneBlueprint?.combatSubType,
                videoRatio: stateRef.current.videoApiConfig.videoRatio,
                maxImageReferences: getVideoImageReferenceLimit(stateRef.current.videoApiConfig),
              },
            }, { temperature: 0.3, maxTokens: 10000 }),
            CHOREOGRAPH_STAGE_TIMEOUT_MS,
            'choreograph retry',
            abortCurrentStageRequests,
          ), '动作编排(choreograph)重试');
          ensureBatchSessionActive();
          choreography = parseChoreography(retryResult, refs);
          choreography = applyInferredScenePositionPointsToChoreography(choreography, continuitySpatialBlocking);
          if (!choreography) {
            throwRequiredStageError('动作编排(choreograph)', '重试后仍无法解析有效的动作编排 JSON。');
          }
        }
        assertDialogueFidelity(
          '动作编排(choreograph)',
          effectiveCorrectedScript,
          extractDialogueEntriesFromChoreography(choreography),
          STEP4_DIALOGUE_FIDELITY_OPTIONS,
        );

        const choreographStartBlocking = resolveChoreographyStartBlocking(choreography, effectiveSbInfo.scene);
        choreographSpatialIssues = validateSpatialContinuity(
          continuitySpatialBlocking,
          choreographStartBlocking,
          { allowedCharacterNames: getSpatialContinuityCharacterNames(effectiveSbInfo, refs) },
        );
        if (choreographSpatialIssues.length > 0) {
          console.warn('[Step4] Spatial continuity issues after choreograph, delegating to choreo-check', choreographSpatialIssues);
        }

        updateStoryboard({ choreography });
      } catch (choreoErr) {
        if (isAbortLikeError(choreoErr)) {
          throw choreoErr;
        }
        throwRequiredStageCause('动作编排(choreograph)', choreoErr);
      }

      // ========== Step 2.6: 编排方案逻辑检查(choreo-check) ==========
      // 每个分镜必须执行，检查编排中是否引入了新的逻辑问题
      let choreoCheckFailSummary = '';
      if (!choreography) {
        throwRequiredStageError('动作编排(choreograph)', '动作编排结果缺失，无法进入编排校验。');
      }
      const shouldRunChoreoCheck = true;
      if (shouldRunChoreoCheck) {
        updateStoryboard({ status: 'choreo-checking' });
        setTaskActiveStreamPhase('choreo-checking');
        setTaskActiveStreamStageLabel('编排校验');

        try {
        const choreoCheckUserMessages: ChatMessage[] = [
          {
            role: 'user',
            content: buildChoreoCheckPrompt(
              effectiveSbInfo,
              choreography,
              latestAnalysis.propTracking,
              currentItemTracker,
              effectiveCorrectedScript,
              primaryScriptText,
              currentSceneBlueprint,
              continuityInput.lastFrameInfo,
              acceptedCharacterNames,
              refs,
              storyboardSource.nextStoryboardSummary,
              continuitySpatialBlocking,
              sceneSpatialBible,
              choreographSpatialIssues,
            ),
          },
        ];

        const choreoCheckResult = requireStageText(await withStageTimeout(
          () => callBatchApiViaBff(stateRef.current.apiConfig, choreoCheckUserMessages, {
            templateType: 'choreo_check',
            templateVars: { videoRatio: stateRef.current.videoApiConfig.videoRatio },
          }, { temperature: 0.2, maxTokens: 10000 }),
          CHOREO_CHECK_STAGE_TIMEOUT_MS,
          'choreo-check',
          abortCurrentStageRequests,
        ), '编排校验(choreo_check)');
        ensureBatchSessionActive();

        const { fixes: choreoCheckFixes, correctedChoreography } = parseChoreoCheckResult(choreoCheckResult);
        if (!hasRecognizedChoreoCheckOutput(choreoCheckResult, choreoCheckFixes, correctedChoreography)) {
          throwRequiredStageError('编排校验(choreo_check)', '输出既不是“检查通过”，也没有可解析的修正记录或修正后编排 JSON。');
        }

        choreoCheckFailSummary = choreoCheckFixes.map(f =>
          `- 问题类型：${f.issueType}，描述：${f.description}，修正建议：${f.fixSuggestion}`,
        ).join('\n');

        // 如果有修正后的 choreography，使用修正版本替换
        if (correctedChoreography) {
          choreography = applyInferredScenePositionPointsToChoreography(correctedChoreography, continuitySpatialBlocking);
          updateStoryboard({ choreography, choreoCheckFixes });
        } else if (choreoCheckFixes.length > 0) {
          updateStoryboard({ choreoCheckFixes });
        }
        assertDialogueFidelity(
          '编排校验(choreo_check)',
          effectiveCorrectedScript,
          extractDialogueEntriesFromChoreography(choreography),
          STEP4_DIALOGUE_FIDELITY_OPTIONS,
        );

        const checkedStartBlocking = resolveChoreographyStartBlocking(choreography, effectiveSbInfo.scene);
        const checkedSpatialIssues = validateSpatialContinuity(
          continuitySpatialBlocking,
          checkedStartBlocking,
          { allowedCharacterNames: getSpatialContinuityCharacterNames(effectiveSbInfo, refs) },
        );
        if (checkedSpatialIssues.length > 0) {
          const issueSummary = checkedSpatialIssues.map((issue) => `- ${issue.message}`).join('\n');
          throwRequiredStageError(
            '编排校验(choreo_check)',
            `跨分镜站位连续性仍未通过，禁止继续生成视频提示词：\n${issueSummary}`,
          );
        }

        const criticalFixes = choreoCheckFixes.filter(f => f.isCritical);
        if (criticalFixes.length > 0 && !correctedChoreography) {
          throwRequiredStageError('编排校验(choreo_check)', '发现严重问题，但未返回可用的修正后动作编排 JSON。');
        }
        } catch (checkErr) {
        if (isAbortLikeError(checkErr)) {
          throw checkErr;
        }
        throwRequiredStageCause('编排校验(choreo_check)', checkErr);
      }

      }

      // ========== Step 3: 生成(generate) ==========
      updateStoryboard({ status: 'generating' });
      setTaskActiveStreamPhase('generating');
      setTaskActiveStreamStageLabel('最终提示词生成');

      let promptText: string;

      if (!choreography) {
        throwRequiredStageError('动作编排(choreograph)', '动作编排结果缺失，无法进入最终提示词生成。');
      }
      const generateMode: Step4GenerateMode = 'formatter';
      const useOfficialVirtualHumanTemplate = shouldUseOfficialVirtualHumanGenerateTemplate(
        latestProject?.step3Settings?.useVolcVirtualHumans,
        refs,
        projectAssetLibrary,
      );
      const generateTemplateType = useOfficialVirtualHumanTemplate
        ? 'generate_official_virtual_human'
        : 'generate';

      // 有编排方案 → 走简化版 generate（只做格式化）
      const logicFixSummary = logicFixes.length > 0
        ? logicFixes
            .map(
              (f, i) =>
                `【修正${i + 1}】\n矛盾：${f.originalIssue}\n修正为：${f.correction}\n原因：${f.reason}`,
            )
            .join('\n\n')
        : '';

      const combinedFixSummary = prevLogicFixSummary
        ? (logicFixSummary ? `${prevLogicFixSummary}\n\n---\n\n## 本分镜修正\n${logicFixSummary}` : prevLogicFixSummary)
        : logicFixSummary;

      const generateUserMessages: ChatMessage[] = [
        {
          role: 'user',
          content: (useOfficialVirtualHumanTemplate
            ? buildOfficialVirtualHumanGenerateWithChoreographyPrompt
            : buildGenerateWithChoreographyPrompt)(
            effectiveSbInfo,
            primaryScriptText,
            latestAnalysis,
            refs,
            choreography,
            effectiveCorrectedScript,
            continuityInput.lastFrameInfo,
            isSbLast,
            isSbFirst,
            combinedFixSummary,
            currentSceneBlueprint,
            latestAnalysis.propTracking,
            choreoCheckFailSummary,
            prevNarrativeSummary,
            currentItemTracker,
            storyboardSource.nextStoryboardSummary,
            preprocessNotes,
            continuitySpatialBlocking,
            sceneSpatialBible,
          ),
        },
      ];

      promptText = requireStageText(await callBatchApiViaBff(stateRef.current.apiConfig, generateUserMessages, {
        templateType: generateTemplateType,
        templateVars: {
          styleConfig: latestAnalysis.styleConfig,
          generateMode,
          officialVirtualHumanMode: useOfficialVirtualHumanTemplate,
          videoRatio: stateRef.current.videoApiConfig.videoRatio,
          maxImageReferences: getVideoImageReferenceLimit(stateRef.current.videoApiConfig),
        },
      }, { temperature: 0.7, maxTokens: 8000 }), '最终提示词生成(generate)');
      ensureBatchSessionActive();

      promptText = sanitizeUnboundTemporaryRoleAliases(promptText, refs);
      promptText = sanitizeMisboundImageReferenceLabels(promptText, refs);
      promptText = normalizeVideoPromptText(promptText);
      promptText = ensurePromptDialogueAudioTimings(promptText).text;
      assertDialogueFidelity(
        '最终提示词生成(generate)',
        effectiveCorrectedScript,
        promptText,
        STEP4_DIALOGUE_FIDELITY_OPTIONS,
      );

      // Step 4: 前端自检
      updateStoryboard({ status: 'self-checking' });
      setTaskActiveStreamPhase(null);

      const selfCheckResult = runSelfCheck(
        promptText,
        refs,
        videoImageSelection.budget,
        effectiveCorrectedScript,
        false,
        stateRef.current.videoApiConfig.videoRatio,
      );
      const parsed = parsePromptFromRawText(promptText);
      const promptPayload = {
        ...parsed,
        rawText: promptText,
      };

      const generatedLastFrameInfo = extractLastFrameInfo(promptText, effectiveCorrectedScript);
      const spatialBlocking = resolveChoreographyEndBlocking(choreography, effectiveSbInfo.scene) ?? undefined;
      updateStoryboard({
        storyboard: effectiveSbInfo,
        step4OutputMode: requestedOutputMode,
        generatedStep4OutputMode: 'prompt',
        storyboardBoardStyle: sb.storyboardBoardStyle ?? latestChapter.storyboardBoardStyle ?? 'seedance-board',
        prompt: promptPayload,
        imageRefs: refs,
        videoImageRefs: refs,
        selfCheckResult,
        lastFrameInfo: generatedLastFrameInfo,
        spatialBlocking,
        continuityOutput: {
          itemTracker: currentItemTracker,
          lastFrameInfo: generatedLastFrameInfo,
          spatialBlocking,
          summary: buildStoryboardNarrativeSummary({
            ...sb,
            storyboard: effectiveSbInfo,
            correctedScript: effectiveCorrectedScript,
            prompt: promptPayload,
            lastFrameInfo: generatedLastFrameInfo,
            spatialBlocking,
          } as StoryboardState),
          sourceStoryboardIndex: index,
          generatedAt: Date.now(),
        },
        isStale: false,
        storyboardBoard: markStoryboardBoardStale(sb.storyboardBoard, 'source-change'),
        status: 'done',
        error: undefined,
        step4StartedAt: undefined,
      });

    } catch (err) {
      activeSeedanceFinalPromptControllerRef.current?.abort();
      if (isAbortLikeError(err)) {
        throw err;
      }
      if (err instanceof SeedanceFinalPromptGenerationError) {
        if (!batchSessionId) resetApi();
        updateStoryboard({
          status: 'error',
          error: err.message,
          step4StartedAt: undefined,
        });
        throw err;
      }
      if (!batchSessionId) resetApi();
      const rawErrorMessage = err instanceof Error ? err.message : String(err);
      const imageRetryCount = getStoryboardBoardImageRetryCount(err);
      const errorMessage = recoverableStoryboardBoard
        ? formatStoryboardBoardImageRecoverableFailure(err, { retryCount: imageRetryCount })
        : rawErrorMessage;
      const failedRecoverableBoard = markRecoverableStoryboardBoardImageFailed(
        recoverableStoryboardBoard,
        recoverableStoryboardBoardMode,
        errorMessage,
      );
      const failedDirectorBriefBoard = !failedRecoverableBoard && directorBriefCheckpointBoard && recoverableStoryboardBoardMode
        ? mergeStoryboardBoardVariant(directorBriefCheckpointBoard, recoverableStoryboardBoardMode, {
            status: 'failed',
            error: rawErrorMessage,
            planStatus: 'failed',
            planError: rawErrorMessage,
            planIsStale: false,
            generationTiming: failStoryboardBoardPlanTiming(
              getStoryboardBoardVariant(directorBriefCheckpointBoard, recoverableStoryboardBoardMode)?.generationTiming,
              rawErrorMessage,
              Date.now(),
              err instanceof StoryboardStageTimeoutError || isStoryboardBoardImageTimeoutMessage(rawErrorMessage),
            ),
          })
        : undefined;
      const failedOutputMode = getStoryboardRequestedOutputMode(sb, latestChapter?.step4OutputMode);
      updateStoryboard({
        status: 'error',
        error: errorMessage,
        step4StartedAt: undefined,
        ...(failedRecoverableBoard
          ? { storyboardBoard: failedRecoverableBoard }
          : failedDirectorBriefBoard
            ? { storyboardBoard: failedDirectorBriefBoard }
            : {}),
        ...(failedOutputMode === 'storyboard-director' && !failedRecoverableBoard
          ? {
              seedanceFinalVideoPrompt: '',
              seedanceFinalVideoPromptStatus: 'idle',
              seedanceFinalVideoPromptError: undefined,
              seedanceFinalVideoPromptSourceSnapshot: '',
              seedanceFinalVideoPromptUpdatedAt: undefined,
              seedanceFinalVideoPromptRunId: undefined,
            }
          : {}),
      });
      throw err;
    } finally {
      scopedBatchRequestControllers.forEach((controller) => {
        if (!controller.signal.aborted) {
          controller.abort(new DOMException('The storyboard request finished.', 'AbortError'));
        }
      });
      scopedBatchRequestControllers.clear();
      finishStoryboardGeneration();
      setActiveStreamTarget((current) => {
        const isCurrent = current?.projectId === targetProjectId
          && current?.chapterId === targetChapterId
          && current?.storyboardIndex === index;
        if (isCurrent) {
          setActiveStreamPhase(null);
          setActiveStreamStageLabel(null);
          setActiveStreamStageStartedAt(undefined);
          setActiveStreamStageLastActivityAt(undefined);
          setActiveStreamStageTimeoutMs(undefined);
          setActiveStreamStageTimeoutMode(undefined);
          return null;
        }
        return current;
      });
    }
  }, [
    abort,
    beginStoryboardGeneration,
    callApiViaBff,
    dispatch,
    getBatchAbortSignal,
    registerSessionController,
    resetApi,
    stateRef,
    unregisterSessionController,
  ]);

  const generateStoryboardAtWithRetry = useCallback(async (
    index: number,
    target: { projectId: string; chapterId: string; batchSessionId: string; storyboardDirectorRunMode?: StoryboardDirectorRunMode },
  ) => {
    let lastError: unknown = null;
    const maxRetries = STORYBOARD_FLOW_RETRY_DELAYS_MS.length;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) {
        const error = getErrorMessage(lastError);
        dispatch({
          type: 'UPDATE_AUTO_GENERATE',
          updates: {
            retryNotice: { index, attempt, maxRetries, error },
          },
          projectId: target.projectId,
          chapterId: target.chapterId,
        });
        await waitForDelay(STORYBOARD_FLOW_RETRY_DELAYS_MS[attempt - 1] ?? 0);
        if (
          cancelledBatchSessionIdsRef.current.has(target.batchSessionId)
          || !activeBatchSessionIdsRef.current.has(target.batchSessionId)
        ) {
          throw new DOMException('The user aborted a request.', 'AbortError');
        }
      }

      try {
        await generateStoryboardAt(index, target);
        dispatch({
          type: 'UPDATE_AUTO_GENERATE',
          updates: { retryNotice: undefined },
          projectId: target.projectId,
          chapterId: target.chapterId,
        });
        return;
      } catch (err) {
        if (
          cancelledBatchSessionIdsRef.current.has(target.batchSessionId)
          || !activeBatchSessionIdsRef.current.has(target.batchSessionId)
          || isAbortLikeError(err)
        ) {
          throw err;
        }
        lastError = err;
        if (attempt >= maxRetries || !isTransientApiError(err)) {
          dispatch({
            type: 'UPDATE_AUTO_GENERATE',
            updates: { retryNotice: undefined },
            projectId: target.projectId,
            chapterId: target.chapterId,
          });
          throw err;
        }
      }
    }

    throw lastError ?? new Error('Storyboard generation failed without an error');
  }, [dispatch, generateStoryboardAt]);

  // 当前单镜生成
  const handleGenerateFull = useCallback(async (currentIndex: number) => {
    const { project, chapter } = getLatestProjectAndChapter(stateRef);
    const latestAnalysis = chapter?.analysis ?? null;
    if (!latestAnalysis) return;
    if (!project?.id || !chapter?.id) return;
    const runningTask = findRunningAutoGenerateTask(stateRef.current);
    if (
      runningTask
      && (runningTask.projectId !== project.id || runningTask.chapterId !== chapter.id)
    ) {
      return;
    }
    dispatch({ type: 'HISTORY_PUSH', projectId: project.id, chapterId: chapter.id });
    resetApi();
    try {
      await generateStoryboardAt(currentIndex, { projectId: project.id, chapterId: chapter.id });
    } catch {
      // generateStoryboardAt 已回写错误状态，这里避免按钮事件出现未捕获 Promise
    }
  }, [stateRef, dispatch, resetApi, generateStoryboardAt]);

  // 一键批量生成全部
  const runStep4BatchTask = useCallback(async (task: GlobalTask) => {
    const { project: latestProject, chapter: latestChapter } = getLatestProjectAndChapter(stateRef, task.projectId, task.chapterId);
    const latestStoryboards = getLatestStoryboards(stateRef, latestProject?.id, latestChapter?.id);
    const latestAnalysis = latestChapter?.analysis ?? null;
    const totalSb = latestStoryboards.length;
    if (!latestAnalysis || totalSb === 0) {
      dispatch({ type: 'FINISH_GLOBAL_TASK', taskId: task.id, status: 'failed', stopReason: 'failed' });
      return;
    }

    const targetProjectId = latestProject?.id;
    const targetChapterId = latestChapter?.id;
    if (!targetProjectId || !targetChapterId) {
      dispatch({ type: 'FINISH_GLOBAL_TASK', taskId: task.id, status: 'failed', stopReason: 'failed' });
      return;
    }

    const target = { projectId: targetProjectId, chapterId: targetChapterId };
    const storyboardDirectorRunMode = normalizeStoryboardDirectorRunMode(
      task.storyboardDirectorRunMode ?? latestChapter.storyboardDirectorRunMode,
    );
    const sessionId = task.id;
    const latestGlobalTask = stateRef.current.globalTasks.find((item) => item.id === sessionId);
    if (latestGlobalTask && latestGlobalTask.status !== 'queued' && latestGlobalTask.status !== 'running') {
      return;
    }
    if (
      latestChapter.autoGenerate.running
      && latestChapter.autoGenerate.sessionId
      && latestChapter.autoGenerate.sessionId !== sessionId
    ) {
      return;
    }
    const startedAt = Date.now();
    cancelledBatchSessionIdsRef.current.delete(sessionId);
    getBatchAbortSignal(sessionId);
    activeBatchSessionIdsRef.current.add(sessionId);
    activeStep4BatchSessionIds.add(sessionId);

    dispatch({ type: 'RESET_ERROR_STORYBOARDS', ...target });
    await waitForRender();
    const taskBeforeStart = stateRef.current.globalTasks.find((item) => item.id === sessionId);
    if (taskBeforeStart && taskBeforeStart.status !== 'queued' && taskBeforeStart.status !== 'running') {
      activeStep4BatchSessionIds.delete(sessionId);
      activeBatchSessionIdsRef.current.delete(sessionId);
      cleanupBatchSessionRequests(sessionId);
      return;
    }
    dispatch({ type: 'START_GLOBAL_TASK', taskId: task.id, startedAt });
    dispatch({ type: 'START_AUTO_GENERATE', total: totalSb, sessionId, startedAt, ...target });

    const errors: { index: number; error: string }[] = [];
    const recordBatchError = (index: number, error: string) => {
      if (!errors.some((item) => item.index === index && item.error === error)) {
        errors.push({ index, error });
      }
      dispatch({ type: 'UPDATE_AUTO_GENERATE', updates: { errors: [...errors] }, ...target });
    };

    try {
      const runningTasks = new Map<number, Promise<void>>();
      let nextIndex = 0;
      let lastReportedDoneCount = -1;

      const reportDoneCount = () => {
        const currentSbs = getLatestStoryboards(stateRef, target.projectId, target.chapterId);
        const actualDoneCount = currentSbs.filter(isStoryboardPromptReady).length;
        if (actualDoneCount !== lastReportedDoneCount) {
          lastReportedDoneCount = actualDoneCount;
          dispatch({ type: 'UPDATE_AUTO_GENERATE', updates: { doneCount: actualDoneCount }, ...target });
        }
      };

      const launchStoryboard = (index: number, currentSbs: StoryboardState[]) => {
        const actualDoneCount = currentSbs.filter(isStoryboardPromptReady).length;
        lastReportedDoneCount = actualDoneCount;
        dispatch({ type: 'HISTORY_PUSH', ...target });
        dispatch({ type: 'UPDATE_AUTO_GENERATE', updates: { currentIndex: index, doneCount: actualDoneCount, retryNotice: undefined }, ...target });

        const task = generateStoryboardAtWithRetry(index, {
          ...target,
          batchSessionId: sessionId,
          storyboardDirectorRunMode,
        })
          .catch((err) => {
            if (
              cancelledBatchSessionIdsRef.current.has(sessionId)
              || !activeBatchSessionIdsRef.current.has(sessionId)
              || isAbortLikeError(err)
            ) {
              return;
            }
            recordBatchError(index, err instanceof Error ? err.message : String(err));
          })
          .finally(() => {
            runningTasks.delete(index);
            reportDoneCount();
          });

        runningTasks.set(index, task);
      };

      while (nextIndex < totalSb) {
        if (
          cancelledBatchSessionIdsRef.current.has(sessionId)
          || !activeBatchSessionIdsRef.current.has(sessionId)
        ) {
          break;
        }

        // 等待 React 渲染完成，确保 stateRef 反映上一个分镜的 dispatch 结果
        await waitForRender();

        const latestChapterState = getLatestProjectAndChapter(stateRef, target.projectId, target.chapterId).chapter;
        if (!latestChapterState || latestChapterState.autoGenerate.sessionId !== sessionId || !latestChapterState.autoGenerate.running) {
          break;
        }

        const currentSbs = getLatestStoryboards(stateRef, target.projectId, target.chapterId);
        reportDoneCount();

        const sb = currentSbs[nextIndex];
        const missingReferenceLabels = sb ? getMissingImageReferenceLabels(sb.imageRefs) : [];
        if (sb && missingReferenceLabels.length > 0) {
          recordBatchError(
            nextIndex,
            `缺少参考图，已跳过：${missingReferenceLabels.slice(0, 3).join(' / ')}${missingReferenceLabels.length > 3 ? ' / ...' : ''}`,
          );
          nextIndex += 1;
          continue;
        }
        if (sb?.status === 'error') {
          recordBatchError(nextIndex, sb.error ?? '分镜已失败，已跳过');
        }
        if (sb && !isStoryboardStep4AutoGeneratePending(sb)) {
          nextIndex += 1;
          continue;
        }

        const previous = currentSbs[nextIndex - 1];
        const previousReady = nextIndex === 0 || isStoryboardContinuityReadyForNext(previous);
        const previousUnavailable = nextIndex > 0
          && !!previous
          && !previousReady
          && !runningTasks.has(nextIndex - 1)
          && (previous.status === 'error' || !isStoryboardStep4AutoGeneratePending(previous));
        if (previousUnavailable) {
          const skipReason = '前序分镜未完成，已保留当前分镜为待生成；修复前序后可从断点继续。';
          recordBatchError(nextIndex, skipReason);
          if (sb && sb.status !== 'pending') {
            dispatch({
              type: 'UPDATE_STORYBOARD',
              index: nextIndex,
              updates: {
                status: 'pending',
                error: undefined,
                step4StartedAt: undefined,
              },
              ...target,
            });
          }
          nextIndex += 1;
          continue;
        }
        if (previousReady && !runningTasks.has(nextIndex)) {
          launchStoryboard(nextIndex, currentSbs);
          nextIndex += 1;
          continue;
        }

        await waitForDelay(STORYBOARD_BATCH_PIPELINE_POLL_MS);
      }

      await Promise.allSettled(runningTasks.values());

      if (!activeBatchSessionIdsRef.current.has(sessionId)) {
        return;
      }

      // 最后一镜完成后的 UPDATE_STORYBOARD 需要等一帧才会同步到 stateRef。
      await waitForRender();
      const finalSbs = getLatestStoryboards(stateRef, target.projectId, target.chapterId);
      const finalDoneCount = finalSbs.filter(isStoryboardPromptReady).length;

      if (errors.length > 0) {
        dispatch({ type: 'UPDATE_AUTO_GENERATE', updates: { doneCount: finalDoneCount, currentIndex: -1 }, ...target });
        dispatch({ type: 'END_AUTO_GENERATE', stopReason: 'failed', ...target });
      } else if (cancelledBatchSessionIdsRef.current.has(sessionId)) {
        forceStopAutoGenerate(target);
      } else {
        dispatch({ type: 'UPDATE_AUTO_GENERATE', updates: { doneCount: finalDoneCount, currentIndex: -1 }, ...target });
        dispatch({ type: 'END_AUTO_GENERATE', stopReason: 'completed', ...target });
      }
    } finally {
      activeStep4BatchSessionIds.delete(sessionId);
      activeBatchSessionIdsRef.current.delete(sessionId);
      cancelledBatchSessionIdsRef.current.delete(sessionId);
      cleanupBatchSessionRequests(sessionId);
    }
  }, [cleanupBatchSessionRequests, dispatch, forceStopAutoGenerate, generateStoryboardAtWithRetry, getBatchAbortSignal, stateRef]);

  const handleAutoGenerate = useCallback(async () => {
    const targetProjectId = currentProject?.id;
    const targetChapterId = chapter?.id;
    if (!targetProjectId || !targetChapterId) return;

    const { chapter: latestChapter } = getLatestProjectAndChapter(stateRef, targetProjectId, targetChapterId);
    const targetChapter = latestChapter ?? chapter;
    if (!targetChapter) return;
    const latestStoryboards = targetChapter.storyboards;
    const latestAnalysis = targetChapter.analysis ?? null;
    const totalSb = latestStoryboards.length;
    if (!latestAnalysis || totalSb === 0) return;

    dispatch({
      type: 'QUEUE_STEP4_BATCH_TASK',
      projectId: targetProjectId,
      chapterId: targetChapterId,
      total: totalSb,
      doneCount: latestStoryboards.filter(isStoryboardPromptReady).length,
      storyboardDirectorRunMode: normalizeStoryboardDirectorRunMode(targetChapter.storyboardDirectorRunMode),
    });
  }, [chapter, currentProject?.id, dispatch, stateRef]);

  const handleQueueAutoGenerate = useCallback(async () => {
    const targetProjectId = currentProject?.id;
    const targetChapterId = chapter?.id;
    if (!targetProjectId || !targetChapterId) return;

    const { chapter: latestChapter } = getLatestProjectAndChapter(stateRef, targetProjectId, targetChapterId);
    const targetChapter = latestChapter ?? chapter;
    if (!targetChapter) return;
    const latestStoryboards = targetChapter.storyboards;
    const latestAnalysis = targetChapter.analysis ?? null;
    const totalSb = latestStoryboards.length;
    if (!latestAnalysis || totalSb === 0) return;

    dispatch({
      type: 'QUEUE_STEP4_BATCH_TASK',
      projectId: targetProjectId,
      chapterId: targetChapterId,
      total: totalSb,
      doneCount: latestStoryboards.filter(isStoryboardPromptReady).length,
      storyboardDirectorRunMode: normalizeStoryboardDirectorRunMode(targetChapter.storyboardDirectorRunMode),
    });
  }, [chapter, currentProject?.id, dispatch, stateRef]);

  const startQueuedStep4BatchTasks = useCallback(() => {
    const runningIds = runningGlobalTaskIdsRef.current;
    const maxParallelStep4Tasks = normalizeStep4BatchTaskConcurrency(
      stateRef.current.globalTaskSettings?.step4Concurrency,
    );
    const runningStep4TaskCount = countRunningStep4BatchTasks(stateRef.current, runningIds);
    const availableStep4TaskSlots = Math.max(0, maxParallelStep4Tasks - runningStep4TaskCount);
    const blockedTaskIds = new Set<string>();
    stateRef.current.globalTasks.forEach((task) => {
      if (task.type !== 'step4-batch' || task.status !== 'queued' || runningIds.has(task.id)) return;
      const blockReason = getGlobalTaskPermanentBlockReason(stateRef.current, task);
      if (!blockReason) return;
      blockedTaskIds.add(task.id);
      dispatch({
        type: 'UPDATE_GLOBAL_TASK',
        taskId: task.id,
        updates: {
          errors: [{ index: 0, error: blockReason }],
          streamStageLabel: '前置步骤未完成',
          streamTextPreview: '',
          streamTextLength: 0,
          streamUpdatedAt: Date.now(),
        },
      });
      dispatch({ type: 'FINISH_GLOBAL_TASK', taskId: task.id, status: 'failed', stopReason: 'failed' });
    });
    const queuedTasks = stateRef.current.globalTasks.filter((task) => {
      if (task.type !== 'step4-batch' || task.status !== 'queued' || runningIds.has(task.id)) return false;
      if (blockedTaskIds.has(task.id)) return false;
      if (!canStartGlobalTask(stateRef.current, task)) return false;
      const chapter = getLatestProjectAndChapter(stateRef, task.projectId, task.chapterId).chapter;
      if (!chapter) return false;
      return !chapter.autoGenerate.running || chapter.autoGenerate.sessionId === task.id;
    });

    queuedTasks.slice(availableStep4TaskSlots).forEach((task) => {
      if (task.streamStageLabel === '等待章节并发空位') return;
      dispatch({
        type: 'UPDATE_GLOBAL_TASK',
        taskId: task.id,
        updates: {
          streamStageLabel: '等待章节并发空位',
          streamTextPreview: '',
          streamTextLength: 0,
          streamUpdatedAt: Date.now(),
        },
      });
    });

    queuedTasks.slice(0, availableStep4TaskSlots).forEach((task) => {
      runningIds.add(task.id);
      void runStep4BatchTask(task).finally(() => {
        runningIds.delete(task.id);
      });
    });
  }, [dispatch, runStep4BatchTask, stateRef]);

  useEffect(() => {
    startQueuedStep4BatchTasks();
  }, [startQueuedStep4BatchTasks]);

  useEffect(() => {
    startQueuedStep4BatchTasks();
  }, [startQueuedStep4BatchTasks, state.globalTaskSettings?.step4Concurrency]);

  useEffect(() => {
    const hasLiveStep4Tasks = state.globalTasks.some((task) =>
      task.type === 'step4-batch' && (task.status === 'queued' || task.status === 'running'),
    );
    if (!hasLiveStep4Tasks) return undefined;

    const timer = window.setInterval(() => {
      startQueuedStep4BatchTasks();
    }, 1500);

    return () => window.clearInterval(timer);
  }, [startQueuedStep4BatchTasks, state.globalTasks]);

  useEffect(() => {
    activeBatchSessionIdsRef.current.forEach((sessionId) => {
      const task = state.globalTasks.find((item) => item.id === sessionId && item.type === 'step4-batch');
      if (!task) return;
      if (task.status === 'queued') return;
      const chapter = getLatestProjectAndChapter(stateRef, task.projectId, task.chapterId).chapter;
      const stillRunning = task.status === 'running'
        && chapter?.autoGenerate.running
        && chapter.autoGenerate.sessionId === sessionId;
      if (!stillRunning) {
        abortBatchSessionRequests(sessionId);
        activeBatchSessionIdsRef.current.delete(sessionId);
        activeStep4BatchSessionIds.delete(sessionId);
      }
    });
  }, [abortBatchSessionRequests, state.globalTasks, state.projects, stateRef]);

  // 取消批量生成
  const handleCancelBatch = useCallback(() => {
    forceStopAutoGenerate();
  }, [forceStopAutoGenerate]);

  const clearActiveStreamState = useCallback((target?: {
    projectId?: string;
    chapterId?: string;
    storyboardIndex?: number;
  }) => {
    const shouldClearStageTimer = (() => {
      if (!target) return true;
      const currentTarget = activeStreamTarget;
      if (!currentTarget) return false;
      const matchesProject = target.projectId === undefined || currentTarget.projectId === target.projectId;
      const matchesChapter = target.chapterId === undefined || currentTarget.chapterId === target.chapterId;
      const matchesStoryboard = target.storyboardIndex === undefined || currentTarget.storyboardIndex === target.storyboardIndex;
      return matchesProject && matchesChapter && matchesStoryboard;
    })();
    if (shouldClearStageTimer) {
      setActiveStreamStageStartedAt(undefined);
      setActiveStreamStageLastActivityAt(undefined);
      setActiveStreamStageTimeoutMs(undefined);
      setActiveStreamStageTimeoutMode(undefined);
    }

    setActiveStreamPhase((currentPhase) => {
      if (!currentPhase) return currentPhase;
      if (!target) return null;
      const currentTarget = activeStreamTarget;
      if (!currentTarget) return currentPhase;
      const matchesProject = target.projectId === undefined || currentTarget.projectId === target.projectId;
      const matchesChapter = target.chapterId === undefined || currentTarget.chapterId === target.chapterId;
      const matchesStoryboard = target.storyboardIndex === undefined || currentTarget.storyboardIndex === target.storyboardIndex;
      return matchesProject && matchesChapter && matchesStoryboard ? null : currentPhase;
    });

    setActiveStreamStageLabel((currentLabel) => {
      if (!currentLabel) return currentLabel;
      if (!target) return null;
      const currentTarget = activeStreamTarget;
      if (!currentTarget) return currentLabel;
      const matchesProject = target.projectId === undefined || currentTarget.projectId === target.projectId;
      const matchesChapter = target.chapterId === undefined || currentTarget.chapterId === target.chapterId;
      const matchesStoryboard = target.storyboardIndex === undefined || currentTarget.storyboardIndex === target.storyboardIndex;
      return matchesProject && matchesChapter && matchesStoryboard ? null : currentLabel;
    });

    setActiveStreamTarget((currentTarget) => {
      if (!currentTarget) return currentTarget;
      if (!target) return null;
      const matchesProject = target.projectId === undefined || currentTarget.projectId === target.projectId;
      const matchesChapter = target.chapterId === undefined || currentTarget.chapterId === target.chapterId;
      const matchesStoryboard = target.storyboardIndex === undefined || currentTarget.storyboardIndex === target.storyboardIndex;
      return matchesProject && matchesChapter && matchesStoryboard ? null : currentTarget;
    });
  }, [activeStreamTarget]);

  // 计算待生成/已完成/失败/卡住数量
  const doneCount = allStoryboards.filter(isStoryboardPromptReady).length;
  const errorCount = allStoryboards.filter((sb) => sb.status === 'error').length;
  const stuckCount = allStoryboards.filter(
    (sb) => sb.status === 'checking' || sb.status === 'correcting' || sb.status === 'choreographing' || sb.status === 'choreo-checking' || sb.status === 'generating' || sb.status === 'self-checking',
  ).length;
  const pendingCount = countStoryboardStep4Pending(allStoryboards);

  return {
    generateStoryboardAt,
    handleGenerateFull,
    handleAutoGenerate,
    handleQueueAutoGenerate,
    handleCancelBatch,
    abortStep4BackgroundRequests,
    clearActiveStreamState,
    apiLoading,
    apiError,
    streamText,
    activeStreamTarget,
    activeStreamPhase,
    activeStreamStageLabel,
    activeStreamStageStartedAt,
    activeStreamStageLastActivityAt,
    activeStreamStageTimeoutMs,
    activeStreamStageTimeoutMode,
    activeAutoGenerateTask,
    resetApi,
    batchProgressRef,
    doneCount,
    errorCount,
    stuckCount,
    pendingCount,
  };
}

export type StoryboardGenerationRuntime = ReturnType<typeof useStoryboardGeneration>;
