// ============================================================
// 项目状态管理 - 多项目 + 多章节架构
// ============================================================

import { createContext, useContext, useReducer, useEffect, useCallback, useRef, useState, type ReactNode } from 'react';
import type {
  AppStep,
  ApiConfig,
  ImageApiConfig,
  VideoApiConfig,
  TtsApiConfig,
  MusicApiConfig,
  AppState,
  Project,
  Step3Settings,
  Chapter,
  ScriptAnalysis,
  StoryboardState,
  AutoGenerateState,
  CharacterOutfit,
  Asset,
  BgmConfig,
  StoryboardAudioMix,
  PostProductionState,
  RenderJobState,
  TtsLineSnapshot,
  TtsLineGenerationState,
  DubbingDialogueAnalysis,
  CharacterVoiceReference,
  VideoBackendType,
  VideoProductionMode,
  SpeakerVoiceOverride,
  SeriesPlan,
  SeriesRuntimeState,
  SceneSpatialMasterState,
  Step4OutputMode,
  StoryboardBoardMode,
  StoryboardCameraSegmentPreference,
  SmartStoryboardPanelCountPreference,
  StoryboardBoardStyle,
  StoryboardDirectorRunMode,
  GlobalTask,
  GlobalTaskEvent,
  GlobalTaskSettings,
  Step1TaskState,
  Step3TaskState,
} from '@/types';
import { updateProjectById, updateChapterById, updateCurrentProject, updateCurrentChapter, updateCurrentStoryboards, updateStoryboardsById } from './helpers';
import { handleVideoAction } from './videoReducer';
import { handleAssetAction } from './assetReducer';
import { handleHistoryAction } from './historyReducer';
import {
  DEFAULT_STEP4_OUTPUT_MODE,
  DEFAULT_STORYBOARD_BOARD_STYLE,
  DEFAULT_STORYBOARD_DIRECTOR_RUN_MODE,
  createInitialState,
  normalizeImageApiConfig,
  normalizeVideoApiConfig,
} from '@/lib/storage';
import { loadAppState, queueSaveAppState, type SaveAppStateResult } from '@/lib/appStatePersistence';
import { ensurePropTrackingIds, normalizeGeneratedPropTrackingDefaults, PROP_DEFAULT_POLICY_VERSION } from '@/lib/propTracking';
import {
  getStoryboardBoardSelectedMode,
  getStoryboardBoardVariant,
  markStoryboardBoardStale,
  mergeStoryboardBoardVariant,
  setStoryboardBoardSelectedMode,
  DEFAULT_STORYBOARD_BOARD_MODE,
} from '@/lib/storyboardBoardState';
import {
  DEFAULT_SMART_STORYBOARD_PANEL_COUNT_PREFERENCE,
  normalizeSmartStoryboardPanelCountPreference,
} from '@/lib/smartStoryboardPanelCount';
import {
  DEFAULT_STORYBOARD_CAMERA_SEGMENT_PREFERENCE,
  normalizeStoryboardCameraSegmentPreference,
} from '@/lib/storyboardCameraSegments';
import { markScenePositionBoardStale } from '@/lib/scenePositionBoardState';
import {
  SCENE_SPATIAL_MASTER_SCHEMA_VERSION,
  getSceneSpatialMasterKey,
  markSceneSpatialMasterStale,
} from '@/lib/sceneSpatialMasterState';
import { getImageRefCharacterVariantKey } from '@/lib/characterReferenceUtils';
import { relinkMissingImageReferenceAssets } from '@/lib/imageReferenceAssetBinding';
import { isStoryboardPromptReady } from '@/lib/storyboardReadiness';

// ---------- 常量 ----------
const DEFAULT_AUTO_GENERATE: AutoGenerateState = {
  running: false,
  currentIndex: -1,
  total: 0,
  doneCount: 0,
  errors: [],
  cancelled: false,
  sessionId: undefined,
  startedAt: undefined,
  stopReason: undefined,
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

function isStoryboardBoardModeSwitchBusy(storyboard: StoryboardState): boolean {
  const selectedMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
  const selectedVariant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedMode);
  return storyboard.status === 'checking'
    || storyboard.status === 'correcting'
    || storyboard.status === 'choreographing'
    || storyboard.status === 'choreo-checking'
    || storyboard.status === 'generating'
    || storyboard.status === 'self-checking'
    || selectedVariant?.status === 'generating'
    || selectedVariant?.planStatus === 'optimizing'
    || storyboard.seedanceFinalVideoPromptStatus === 'generating';
}

function shouldApplyChapterStoryboardBoardMode(storyboard: StoryboardState): boolean {
  return !isStoryboardBoardModeSwitchBusy(storyboard);
}

function getProjectStoryboardBoardMode(project: Project): StoryboardBoardMode {
  return project.chapters[0]?.storyboardBoardMode ?? DEFAULT_STORYBOARD_BOARD_MODE;
}

function getProjectSmartStoryboardPanelCountPreference(project: Project): SmartStoryboardPanelCountPreference {
  return normalizeSmartStoryboardPanelCountPreference(project.chapters[0]?.storyboardBoardSmartPanelCount);
}

function getProjectSmartStoryboardDurationCompressionEnabled(project: Project): boolean {
  return project.chapters[0]?.storyboardBoardSmartDurationCompressionEnabled !== false;
}

function getProjectStoryboardCameraSegmentCount(project: Project): StoryboardCameraSegmentPreference {
  return normalizeStoryboardCameraSegmentPreference(project.chapters[0]?.storyboardCameraSegmentCount);
}

function applyStoryboardBoardModeToChapter(chapter: Chapter, mode: StoryboardBoardMode): Chapter {
  return {
    ...chapter,
    storyboardBoardMode: mode,
    storyboards: chapter.storyboards.map((storyboard) => {
      if (!shouldApplyChapterStoryboardBoardMode(storyboard)) return storyboard;
      const previousMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
      if (previousMode === mode) return storyboard;
      const storyboardBoard = setStoryboardBoardSelectedMode(storyboard.storyboardBoard, mode);
      const selectedVariant = getStoryboardBoardVariant(storyboardBoard, mode);
      const hasSelectedModeBoard = Boolean(selectedVariant?.blobKey && selectedVariant.status === 'done');
      return {
        ...storyboard,
        storyboardBoard,
        status: storyboard.status === 'done' && !hasSelectedModeBoard ? 'pending' : storyboard.status,
        error: undefined,
        seedanceFinalVideoPrompt: '',
        seedanceFinalVideoPromptStatus: 'idle',
        seedanceFinalVideoPromptError: undefined,
        seedanceFinalVideoPromptSourceSnapshot: '',
        seedanceFinalVideoPromptUpdatedAt: undefined,
        seedanceFinalVideoPromptRunId: undefined,
        smartVideoDurationSeconds: undefined,
        smartVideoDurationReason: undefined,
        smartVideoDurationUpdatedAt: undefined,
      };
    }),
  };
}

function applySmartStoryboardPanelCountToChapter(
  chapter: Chapter,
  preference: SmartStoryboardPanelCountPreference,
): Chapter {
  const normalizedPreference = normalizeSmartStoryboardPanelCountPreference(preference);
  if (normalizeSmartStoryboardPanelCountPreference(chapter.storyboardBoardSmartPanelCount) === normalizedPreference) {
    return chapter.storyboardBoardSmartPanelCount === normalizedPreference
      ? chapter
      : { ...chapter, storyboardBoardSmartPanelCount: normalizedPreference };
  }

  const smartModeActive = (chapter.storyboardBoardMode ?? DEFAULT_STORYBOARD_BOARD_MODE) === 'smart-shot-plan-landscape';
  return {
    ...chapter,
    storyboardBoardSmartPanelCount: normalizedPreference,
    storyboards: chapter.storyboards.map((storyboard) => {
      if (!smartModeActive || !shouldApplyChapterStoryboardBoardMode(storyboard)) return storyboard;
      const selectedMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
      if (selectedMode !== 'smart-shot-plan-landscape') return storyboard;
      const storyboardBoard = mergeStoryboardBoardVariant(storyboard.storyboardBoard, 'smart-shot-plan-landscape', {
        isStale: true,
        staleReason: 'source-change',
        planIsStale: true,
        planStaleReason: 'source-change',
      });
      return {
        ...storyboard,
        storyboardBoard,
        status: storyboard.status === 'done' ? 'pending' : storyboard.status,
        error: undefined,
        seedanceFinalVideoPrompt: '',
        seedanceFinalVideoPromptStatus: 'idle',
        seedanceFinalVideoPromptError: undefined,
        seedanceFinalVideoPromptSourceSnapshot: '',
        seedanceFinalVideoPromptUpdatedAt: undefined,
        seedanceFinalVideoPromptRunId: undefined,
        smartVideoDurationSeconds: undefined,
        smartVideoDurationReason: undefined,
        smartVideoDurationUpdatedAt: undefined,
      };
    }),
  };
}

function applySmartStoryboardDurationCompressionToChapter(
  chapter: Chapter,
  enabled: boolean,
): Chapter {
  const normalizedEnabled = enabled !== false;
  if ((chapter.storyboardBoardSmartDurationCompressionEnabled !== false) === normalizedEnabled) {
    return chapter.storyboardBoardSmartDurationCompressionEnabled === normalizedEnabled
      ? chapter
      : { ...chapter, storyboardBoardSmartDurationCompressionEnabled: normalizedEnabled };
  }

  const smartModeActive = (chapter.storyboardBoardMode ?? DEFAULT_STORYBOARD_BOARD_MODE) === 'smart-shot-plan-landscape';
  return {
    ...chapter,
    storyboardBoardSmartDurationCompressionEnabled: normalizedEnabled,
    storyboards: chapter.storyboards.map((storyboard) => {
      if (!smartModeActive || !shouldApplyChapterStoryboardBoardMode(storyboard)) return storyboard;
      const selectedMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
      if (selectedMode !== 'smart-shot-plan-landscape') return storyboard;
      const storyboardBoard = mergeStoryboardBoardVariant(storyboard.storyboardBoard, 'smart-shot-plan-landscape', {
        isStale: true,
        staleReason: 'source-change',
        planIsStale: true,
        planStaleReason: 'source-change',
      });
      return {
        ...storyboard,
        storyboardBoard,
        status: storyboard.status === 'done' ? 'pending' : storyboard.status,
        error: undefined,
        seedanceFinalVideoPrompt: '',
        seedanceFinalVideoPromptStatus: 'idle',
        seedanceFinalVideoPromptError: undefined,
        seedanceFinalVideoPromptSourceSnapshot: '',
        seedanceFinalVideoPromptUpdatedAt: undefined,
        seedanceFinalVideoPromptRunId: undefined,
        smartVideoDurationSeconds: undefined,
        smartVideoDurationReason: undefined,
        smartVideoDurationUpdatedAt: undefined,
      };
    }),
  };
}

function applyStoryboardCameraSegmentCountToChapter(
  chapter: Chapter,
  value: StoryboardCameraSegmentPreference,
): Chapter {
  const normalizedValue = normalizeStoryboardCameraSegmentPreference(value);
  if (normalizeStoryboardCameraSegmentPreference(chapter.storyboardCameraSegmentCount) === normalizedValue) {
    return chapter.storyboardCameraSegmentCount === normalizedValue
      ? chapter
      : { ...chapter, storyboardCameraSegmentCount: normalizedValue };
  }

  return {
    ...chapter,
    storyboardCameraSegmentCount: normalizedValue,
    storyboards: chapter.storyboards.map((storyboard) => {
      if (!shouldApplyChapterStoryboardBoardMode(storyboard)) return storyboard;
      const storyboardBoard = markStoryboardBoardStale(storyboard.storyboardBoard, 'source-change');
      return {
        ...storyboard,
        storyboardBoard,
        status: storyboard.status === 'done' ? 'pending' : storyboard.status,
        error: undefined,
        seedanceFinalVideoPrompt: '',
        seedanceFinalVideoPromptStatus: 'idle',
        seedanceFinalVideoPromptError: undefined,
        seedanceFinalVideoPromptSourceSnapshot: '',
        seedanceFinalVideoPromptUpdatedAt: undefined,
        seedanceFinalVideoPromptRunId: undefined,
      };
    }),
  };
}

function findStoryboardBoardModeMismatchTarget(state: AppState): {
  projectId: string;
  chapterId: string;
  mode: StoryboardBoardMode;
} | null {
  for (const project of state.projects) {
    for (const chapter of project.chapters) {
      if ((chapter.step4OutputMode ?? DEFAULT_STEP4_OUTPUT_MODE) !== 'storyboard-director') continue;
      const mode = chapter.storyboardBoardMode ?? DEFAULT_STORYBOARD_BOARD_MODE;
      const hasMismatch = chapter.storyboards.some((storyboard) => (
        getStoryboardBoardSelectedMode(storyboard.storyboardBoard) !== mode
        && !isStoryboardBoardModeSwitchBusy(storyboard)
      ));
      if (hasMismatch) {
        return {
          projectId: project.id,
          chapterId: chapter.id,
          mode,
        };
      }
    }
  }
  return null;
}

const STEP4_RESET_FIELDS = {
  sourceExcerpt: undefined,
  sourceExcerptSummary: undefined,
  nextStoryboardSummary: undefined,
  logicFixes: [],
  correctedScript: '',
  sceneBlueprint: null,
  choreography: null,
  choreoCheckFixes: undefined,
  prompt: null,
  selfCheckResult: null,
  generatedStep4OutputMode: undefined,
  seedanceFinalVideoPrompt: '',
  seedanceFinalVideoPromptStatus: 'idle' as const,
  seedanceFinalVideoPromptError: undefined,
  seedanceFinalVideoPromptSourceSnapshot: '',
  seedanceFinalVideoPromptUpdatedAt: undefined,
  seedanceFinalVideoPromptRunId: undefined,
  smartVideoDurationSeconds: undefined,
  smartVideoDurationReason: undefined,
  smartVideoDurationUpdatedAt: undefined,
  videoSubmitPromptOverride: '',
  videoSubmitPromptOverrideSourcePrompt: '',
  videoSubmitPromptOverrideUpdatedAt: undefined,
  videoImageRefs: undefined,
  lastFrameInfo: '',
  spatialBlocking: undefined,
  continuityInput: undefined,
  continuityOutput: undefined,
  isStale: false,
  storyboardBoard: undefined,
  scenePositionBoard: undefined,
  error: undefined,
  step4StartedAt: undefined,
  status: 'pending' as const,
};

// ---------- Helpers ----------
const GLOBAL_TASK_EVENT_LOG_LIMIT = 200;

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function createGlobalTaskEvent(
  level: GlobalTaskEvent['level'],
  label: string,
  detail?: string,
  meta?: Pick<GlobalTaskEvent, 'storyboardIndex' | 'phase'>,
): GlobalTaskEvent {
  return {
    id: genId(),
    at: Date.now(),
    level,
    label,
    ...(detail ? { detail } : {}),
    ...(typeof meta?.storyboardIndex === 'number' ? { storyboardIndex: meta.storyboardIndex } : {}),
    ...(meta?.phase ? { phase: meta.phase } : {}),
  };
}

function appendGlobalTaskEvent(task: GlobalTask, event: GlobalTaskEvent): GlobalTask {
  const eventLog = [...(task.eventLog ?? []), event].slice(-GLOBAL_TASK_EVENT_LOG_LIMIT);
  return { ...task, eventLog };
}

function getGlobalTaskFinishEvent(status: GlobalTask['status'], stopReason?: GlobalTask['stopReason']): GlobalTaskEvent {
  if (status === 'done') return createGlobalTaskEvent('success', '任务完成');
  if (status === 'cancelled') return createGlobalTaskEvent('warning', '任务已停止', stopReason);
  return createGlobalTaskEvent('error', '任务失败', stopReason);
}

function applyGlobalTaskUpdates(task: GlobalTask, updates: Partial<GlobalTask>): GlobalTask {
  const stageChanged = Object.prototype.hasOwnProperty.call(updates, 'streamStageLabel')
    && updates.streamStageLabel !== task.streamStageLabel;
  const shouldKeepPreviousStage = stageChanged
    && typeof task.streamTextLength === 'number'
    && task.streamTextLength > 0
    && !!task.streamStageLabel;
  const previousStreamUpdates = shouldKeepPreviousStage
    ? {
        streamPreviousStageLabel: task.streamStageLabel,
        streamPreviousTextLength: task.streamTextLength,
        streamPreviousUpdatedAt: task.streamUpdatedAt ?? Date.now(),
      }
    : {};

  return {
    ...task,
    ...previousStreamUpdates,
    ...updates,
    id: task.id,
    type: task.type,
    projectId: task.projectId,
    chapterId: task.chapterId,
    createdAt: task.createdAt,
    updatedAt: Date.now(),
  };
}

function normalizeTrackedScript(value: string | undefined) {
  return (value ?? '').trim();
}

function getChapterSourceSnapshot(chapter: Chapter) {
  if (typeof chapter.analysisSourceText === 'string') {
    return chapter.analysisSourceText;
  }
  return chapter.scriptType === 'novel' ? chapter.adaptedScript : chapter.rawScript;
}

function getTrackedAnalysisState(
  chapter: Chapter,
  nextScript: string,
  trackedScriptType: 'annotated' | 'novel',
) {
  const analysisSourceText = chapter.analysis
    ? (chapter.analysisSourceText ?? getChapterSourceSnapshot(chapter))
    : chapter.analysisSourceText;
  const analysisIsStale = chapter.analysis && chapter.scriptType === trackedScriptType
    ? normalizeTrackedScript(nextScript) !== normalizeTrackedScript(analysisSourceText)
    : (chapter.analysisIsStale ?? false);

  return { analysisSourceText, analysisIsStale };
}

function createChapter(title: string, storyboardBoardMode: StoryboardBoardMode = DEFAULT_STORYBOARD_BOARD_MODE): Chapter {
  return {
    id: genId(),
    title,
    rawScript: '',
    scriptType: 'annotated',
    storyboardDuration: 15,
    episodeDuration: 120,
    adaptedScript: '',
    analysis: null,
    analysisSourceText: '',
    analysisIsStale: false,
    analysisAiAutofillSignature: undefined,
    analysisAiAutofillAt: undefined,
    storyboards: [],
    step4OutputMode: DEFAULT_STEP4_OUTPUT_MODE,
    storyboardBoardMode,
    storyboardBoardSmartPanelCount: DEFAULT_SMART_STORYBOARD_PANEL_COUNT_PREFERENCE,
    storyboardBoardSmartDurationCompressionEnabled: true,
    storyboardCameraSegmentCount: DEFAULT_STORYBOARD_CAMERA_SEGMENT_PREFERENCE,
    storyboardBoardStyle: DEFAULT_STORYBOARD_BOARD_STYLE,
    storyboardDirectorRunMode: DEFAULT_STORYBOARD_DIRECTOR_RUN_MODE,
    currentStoryboardIndex: 0,
    globalLastFrameInfo: '',
    itemTracker: {},
    autoGenerate: { ...DEFAULT_AUTO_GENERATE },
    step1Task: { ...DEFAULT_STEP1_TASK },
    step3Task: { ...DEFAULT_STEP3_TASK },
    status: 'idle',
    speakerVoiceOverrides: {},
    dubbingAnalysisLines: [],
    past: [],
    future: [],
  };
}

function isReusableEmptyChapter(chapter: Chapter): boolean {
  return !chapter.sourceSeriesEpisodeId
    && !chapter.rawScript.trim()
    && !chapter.adaptedScript.trim()
    && !chapter.analysis
    && chapter.storyboards.length === 0
    && chapter.status === 'idle';
}

function createProject(name: string, initialRawScript = ''): Project {
  const chapter = createChapter('第1章');
  const seededChapter = initialRawScript.trim()
    ? { ...chapter, rawScript: initialRawScript.trim() }
    : chapter;
  return {
    id: genId(),
    name,
    styleConfig: '',
    createdAt: Date.now(),
    allCharacterNames: [],
    characterProfiles: [],
    outfitTracking: [],
    propTracking: [],
    propInheritance: '',
    chapters: [seededChapter],
    currentChapterId: seededChapter.id,
    assetLibrary: [],
    characterVoiceReferences: [],
    step3Settings: {
      optimizeConcurrency: 5,
      generateConcurrency: 5,
      useVolcVirtualHumans: false,
    },
  };
}

function getImageRefRestoreKey(
  ref: {
    type: 'scene' | 'character' | 'prop';
    name: string;
    trackingId?: string;
    variantKey?: string;
    outfitSeq?: number;
  },
) {
  return ref.type === 'prop' && ref.trackingId
    ? `prop:${ref.trackingId}`
    : ref.type === 'character'
      ? (() => {
          const variantKey = getImageRefCharacterVariantKey(ref);
          return variantKey ? `character:${ref.name}:${variantKey}` : `character:${ref.name}`;
        })()
      : `${ref.type}:${ref.name}`;
}

function resolveActionChapterTarget(
  state: AppState,
  action: { projectId?: string; chapterId?: string },
): { projectId: string; chapterId: string } | null {
  const projectId = action.projectId ?? state.currentProjectId ?? undefined;
  if (!projectId) return null;
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return null;
  const chapterId = action.chapterId ?? project.currentChapterId;
  if (!project.chapters.some((chapter) => chapter.id === chapterId)) return null;
  return { projectId, chapterId };
}

function deriveChapterContinuityMirror(storyboards: StoryboardState[]) {
  for (let index = storyboards.length - 1; index >= 0; index -= 1) {
    const storyboard = storyboards[index];
    if (storyboard.isStale) continue;
    if (storyboard.continuityOutput) {
      return {
        globalLastFrameInfo: storyboard.continuityOutput.lastFrameInfo,
        itemTracker: storyboard.continuityOutput.itemTracker,
      };
    }
    if (storyboard.lastFrameInfo) {
      return {
        globalLastFrameInfo: storyboard.lastFrameInfo,
        itemTracker: {},
      };
    }
  }

  return {
    globalLastFrameInfo: '',
    itemTracker: {},
  };
}

// ---------- Action 类型 ----------
const STEP4_BUSY_STATUSES: StoryboardState['status'][] = [
  'checking',
  'correcting',
  'choreographing',
  'choreo-checking',
  'generating',
  'self-checking',
];

function isStep4BusyStoryboard(storyboard: StoryboardState): boolean {
  return STEP4_BUSY_STATUSES.includes(storyboard.status);
}

function isStoryboardBoardWorkBusy(storyboard: StoryboardState): boolean {
  const selectedBoardMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
  const selectedBoardVariant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedBoardMode);
  return selectedBoardVariant?.status === 'generating'
    || selectedBoardVariant?.planStatus === 'optimizing';
}

function cancelBusyStoryboardAndKeepRecoverablePlan(storyboard: StoryboardState): StoryboardState {
  const isStep4Busy = isStep4BusyStoryboard(storyboard);
  const isBoardBusy = isStoryboardBoardWorkBusy(storyboard);
  const isSeedancePromptBusy = storyboard.seedanceFinalVideoPromptStatus === 'generating';
  if (!isStep4Busy && !isBoardBusy && !isSeedancePromptBusy) return storyboard;

  const selectedBoardMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
  const selectedBoardVariant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedBoardMode);
  const storyboardBoard = (isStep4Busy || isBoardBusy)
    ? mergeStoryboardBoardVariant(storyboard.storyboardBoard, selectedBoardMode, {
        status: selectedBoardVariant?.blobKey ? 'done' : 'idle',
        startedAt: undefined,
        error: undefined,
        isStale: false,
        planStatus: selectedBoardVariant?.plan ? 'done' : 'idle',
        planError: undefined,
        planIsStale: false,
      })
    : storyboard.storyboardBoard;

  return {
    ...storyboard,
    storyboardBoard,
    status: isStep4Busy ? 'pending' : storyboard.status,
    error: isStep4Busy ? undefined : storyboard.error,
    step4StartedAt: isStep4Busy ? undefined : storyboard.step4StartedAt,
    seedanceFinalVideoPromptStatus: isSeedancePromptBusy
      ? 'idle'
      : storyboard.seedanceFinalVideoPromptStatus,
    seedanceFinalVideoPromptError: isSeedancePromptBusy
      ? undefined
      : storyboard.seedanceFinalVideoPromptError,
    seedanceFinalVideoPromptRunId: isSeedancePromptBusy
      ? undefined
      : storyboard.seedanceFinalVideoPromptRunId,
  };
}

function resetErrorStoryboardAndKeepRecoverableBoard(storyboard: StoryboardState): StoryboardState {
  const outputMode = storyboard.generatedStep4OutputMode ?? storyboard.step4OutputMode;
  const selectedBoardMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
  const selectedBoardVariant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedBoardMode);
  const hasRecoverableBoardWork = outputMode === 'storyboard-director'
    && !!(selectedBoardVariant?.plan || selectedBoardVariant?.blobKey);

  if (!hasRecoverableBoardWork) {
    return { ...storyboard, ...STEP4_RESET_FIELDS };
  }

  const storyboardBoard = mergeStoryboardBoardVariant(storyboard.storyboardBoard, selectedBoardMode, {
    status: selectedBoardVariant?.blobKey ? 'done' : 'idle',
    startedAt: undefined,
    error: undefined,
    isStale: false,
    planStatus: selectedBoardVariant?.plan ? 'done' : 'idle',
    planIsStale: false,
  });
  const keepFinalPrompt = storyboard.seedanceFinalVideoPromptStatus === 'done'
    && !!storyboard.seedanceFinalVideoPrompt?.trim();

  return {
    ...storyboard,
    storyboardBoard,
    status: 'pending',
    error: undefined,
    step4StartedAt: undefined,
    isStale: false,
    seedanceFinalVideoPrompt: keepFinalPrompt ? storyboard.seedanceFinalVideoPrompt : '',
    seedanceFinalVideoPromptStatus: keepFinalPrompt ? 'done' : 'idle',
    seedanceFinalVideoPromptError: undefined,
    seedanceFinalVideoPromptSourceSnapshot: keepFinalPrompt
      ? storyboard.seedanceFinalVideoPromptSourceSnapshot
      : '',
    seedanceFinalVideoPromptUpdatedAt: keepFinalPrompt
      ? storyboard.seedanceFinalVideoPromptUpdatedAt
      : undefined,
    seedanceFinalVideoPromptRunId: undefined,
  };
}

function clearSourceChangeStoryboardBoardStale(storyboard: StoryboardState): StoryboardState['storyboardBoard'] {
  const selectedBoardMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
  const selectedBoardVariant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedBoardMode);
  if (!selectedBoardVariant) return storyboard.storyboardBoard;

  const clearImageStale = selectedBoardVariant.staleReason === 'source-change';
  const clearPlanStale = selectedBoardVariant.planStaleReason === 'source-change';
  if (!clearImageStale && !clearPlanStale) return storyboard.storyboardBoard;

  return mergeStoryboardBoardVariant(storyboard.storyboardBoard, selectedBoardMode, {
    isStale: clearImageStale ? false : selectedBoardVariant.isStale,
    staleReason: clearImageStale ? undefined : selectedBoardVariant.staleReason,
    planIsStale: clearPlanStale ? false : selectedBoardVariant.planIsStale,
    planStaleReason: clearPlanStale ? undefined : selectedBoardVariant.planStaleReason,
  });
}

function restoreDownstreamAfterRecoverableStoryboardRetry(storyboard: StoryboardState): StoryboardState {
  const outputMode = storyboard.generatedStep4OutputMode ?? storyboard.step4OutputMode;
  const selectedBoardMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
  const selectedBoardVariant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedBoardMode);
  const hasRecoverableOutput = outputMode === 'storyboard-director'
    ? !!selectedBoardVariant?.plan && selectedBoardVariant.planStatus === 'done'
    : !!storyboard.prompt?.rawText;

  if (!hasRecoverableOutput) return storyboard;

  return {
    ...storyboard,
    isStale: false,
    storyboardBoard: clearSourceChangeStoryboardBoardStale(storyboard),
  };
}

function isActiveGlobalTask(task: GlobalTask): boolean {
  return task.status === 'queued' || task.status === 'running';
}

function hasActiveGlobalTaskForChapter(
  state: AppState,
  type: GlobalTask['type'],
  projectId: string,
  chapterId: string,
): boolean {
  return state.globalTasks.some((task) =>
    task.type === type
    && task.projectId === projectId
    && task.chapterId === chapterId
    && isActiveGlobalTask(task),
  );
}

function hasActiveStep4GlobalTaskForChapter(state: AppState, projectId: string, chapterId: string): boolean {
  return hasActiveGlobalTaskForChapter(state, 'step4-batch', projectId, chapterId);
}

function getGlobalTaskIdentityKey(task: Pick<GlobalTask, 'type' | 'projectId' | 'chapterId'>): string {
  return `${task.type}:${task.projectId}:${task.chapterId}`;
}

function pruneFinishedGlobalTasksByIdentity(state: AppState, keepPerIdentity = 3): AppState {
  const activeTasks = state.globalTasks.filter(isActiveGlobalTask);
  const finishedTasks = state.globalTasks
    .filter((task) => !isActiveGlobalTask(task))
    .sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt);
  const keptFinished: GlobalTask[] = [];
  const keptCounts = new Map<string, number>();

  for (const task of finishedTasks) {
    const key = getGlobalTaskIdentityKey(task);
    const count = keptCounts.get(key) ?? 0;
    if (count >= keepPerIdentity) continue;
    keptCounts.set(key, count + 1);
    keptFinished.push(task);
  }

  const keptIds = new Set([...activeTasks, ...keptFinished].map((task) => task.id));
  if (keptIds.size === state.globalTasks.length) return state;
  return {
    ...state,
    globalTasks: state.globalTasks.filter((task) => keptIds.has(task.id)),
  };
}

function updateGlobalTaskById(
  state: AppState,
  taskId: string,
  updater: (task: GlobalTask) => GlobalTask,
): AppState {
  let changed = false;
  const globalTasks = state.globalTasks.map((task) => {
    if (task.id !== taskId) return task;
    changed = true;
    return updater(task);
  });
  return changed ? { ...state, globalTasks } : state;
}

function updateMatchingStep4GlobalTask(
  state: AppState,
  target: { projectId: string; chapterId: string },
  sessionId: string | undefined,
  updater: (task: GlobalTask) => GlobalTask,
): AppState {
  const exactIndex = sessionId
    ? state.globalTasks.findIndex((task) => task.id === sessionId && task.type === 'step4-batch')
    : -1;
  const fallbackIndex = state.globalTasks.findIndex((task) =>
    task.type === 'step4-batch'
    && task.projectId === target.projectId
    && task.chapterId === target.chapterId
    && isActiveGlobalTask(task),
  );
  const matchIndex = exactIndex >= 0 ? exactIndex : fallbackIndex;
  if (matchIndex < 0) return state;
  return {
    ...state,
    globalTasks: state.globalTasks.map((task, index) => index === matchIndex ? updater(task) : task),
  };
}

function pickGlobalTaskAutoGenerateUpdates(updates: Partial<Omit<AutoGenerateState, 'running' | 'total'>>) {
  const picked: Partial<GlobalTask> = {};
  if (typeof updates.currentIndex === 'number') picked.currentIndex = updates.currentIndex;
  if (typeof updates.doneCount === 'number') picked.doneCount = updates.doneCount;
  if (Array.isArray(updates.errors)) picked.errors = updates.errors;
  if ('retryNotice' in updates) picked.retryNotice = updates.retryNotice;
  return picked;
}

function normalizeStep4Concurrency(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(10, Math.floor(value as number)));
}

function normalizeStoryboardImageConcurrency(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(2, Math.floor(value as number)));
}

function normalizeSeedancePromptConcurrency(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(2, Math.floor(value as number)));
}

function normalizeStoryboardImageSize(value: GlobalTaskSettings['step4StoryboardImageSize'] | undefined, fallback: GlobalTaskSettings['step4StoryboardImageSize']) {
  if (value === '2K' || value === '4K') return value;
  return fallback === '4K' ? '4K' : '2K';
}

function getGlobalTaskStatusFromStopReason(stopReason: AutoGenerateState['stopReason'] | undefined): GlobalTask['status'] {
  if (stopReason === 'failed') return 'failed';
  if (stopReason === 'cancelled') return 'cancelled';
  return 'done';
}

export type Action =
  | { type: 'HYDRATE_STATE'; state: AppState }
  | { type: 'SET_API_CONFIG'; config: ApiConfig }
  | { type: 'SET_IMAGE_API_CONFIG'; config: ImageApiConfig }
  | { type: 'SET_VIDEO_API_CONFIG'; config: VideoApiConfig }
  | { type: 'SET_TTS_API_CONFIG'; config: TtsApiConfig }
  | { type: 'SET_MUSIC_API_CONFIG'; config: MusicApiConfig }
  // 项目管理
  | { type: 'CREATE_PROJECT'; name: string; initialRawScript?: string }
  | { type: 'DELETE_PROJECT'; projectId: string }
  | { type: 'SWITCH_PROJECT'; projectId: string }
  | { type: 'RENAME_PROJECT'; projectId: string; name: string }
  // 章节管理
  | { type: 'CREATE_CHAPTER'; title: string }
  | {
      type: 'IMPORT_CHAPTERS_FROM_INPUT';
      projectId?: string;
      sourceChapterId?: string;
      sourceText?: string;
      chapters: Array<{
        title: string;
        rawScript: string;
        scriptType: Chapter['scriptType'];
        storyboardDuration?: number;
        episodeDuration?: number;
      }>;
    }
  | { type: 'DELETE_CHAPTER'; chapterId: string }
  | { type: 'SWITCH_CHAPTER'; chapterId: string; projectId?: string }
  | { type: 'RENAME_CHAPTER'; chapterId: string; title: string }
  | { type: 'MOVE_CHAPTER'; chapterId: string; direction: 'up' | 'down' }
  | { type: 'DUPLICATE_CHAPTER'; chapterId: string; title: string }
  // 全局资源（项目级）
  | { type: 'SET_ALL_CHARACTER_NAMES'; names: string[] }
  | { type: 'SET_OUTFIT_TRACKING'; outfits: CharacterOutfit[] }
  | { type: 'SET_PROP_INHERITANCE'; text: string }
  | { type: 'SET_PROJECT_STEP3_SETTINGS'; settings: Partial<Step3Settings> }
  | { type: 'SET_SERIES_PLAN'; plan: SeriesPlan; resetSeriesRuntime?: boolean }
  | { type: 'SET_SERIES_RUNTIME'; runtime: SeriesRuntimeState }
  | { type: 'UPDATE_SERIES_EPISODE_SCRIPT'; episodeId: string; script: string }
  | { type: 'CREATE_CHAPTER_FROM_SERIES_EPISODE'; episodeId: string }
  // 当前章节操作（全部落到当前章节）
  | { type: 'SET_STEP'; step: AppStep }
  | { type: 'SET_RAW_SCRIPT'; script: string; projectId?: string; chapterId?: string }
  | { type: 'UPDATE_RAW_SCRIPT'; script: string }
  | { type: 'SET_SCRIPT_TYPE'; scriptType: Chapter['scriptType']; projectId?: string; chapterId?: string }
  | { type: 'SET_STORYBOARD_DURATION'; duration: number }
  | { type: 'SET_EPISODE_DURATION'; duration: number }
  | { type: 'SET_STEP4_OUTPUT_MODE'; mode: Step4OutputMode; projectId?: string; chapterId?: string }
  | { type: 'SET_STORYBOARD_BOARD_MODE'; mode: StoryboardBoardMode; projectId?: string; chapterId?: string }
  | { type: 'SET_SMART_STORYBOARD_PANEL_COUNT'; preference: SmartStoryboardPanelCountPreference; projectId?: string; chapterId?: string }
  | { type: 'SET_SMART_STORYBOARD_DURATION_COMPRESSION'; enabled: boolean; projectId?: string; chapterId?: string }
  | { type: 'SET_STORYBOARD_CAMERA_SEGMENT_COUNT'; count: StoryboardCameraSegmentPreference; projectId?: string; chapterId?: string }
  | { type: 'SET_STORYBOARD_BOARD_STYLE'; style: StoryboardBoardStyle; projectId?: string; chapterId?: string }
  | { type: 'SET_STORYBOARD_DIRECTOR_RUN_MODE'; mode: StoryboardDirectorRunMode; projectId?: string; chapterId?: string }
  | { type: 'SET_ADAPTED_SCRIPT'; script: string; projectId?: string; chapterId?: string }
  | {
      type: 'SET_ANALYSIS';
      analysis: ScriptAnalysis;
      projectId?: string;
      chapterId?: string;
      sourceText?: string;
      aiAutofillSignature?: string;
      aiAutofillAt?: number;
      syncProjectStyle?: boolean;
    }
  | { type: 'SET_CHAPTER_STATUS'; status: Chapter['status']; projectId?: string; chapterId?: string }
  | { type: 'UPDATE_STEP1_TASK'; updates: Partial<Step1TaskState>; projectId?: string; chapterId?: string }
  | { type: 'END_STEP1_TASK'; updates?: Partial<Step1TaskState>; projectId?: string; chapterId?: string }
  | { type: 'UPDATE_STEP3_TASK'; updates: Partial<Step3TaskState>; projectId?: string; chapterId?: string }
  | { type: 'END_STEP3_TASK'; updates?: Partial<Step3TaskState>; projectId?: string; chapterId?: string }
  | { type: 'INIT_STORYBOARDS'; storyboards: StoryboardState[] }
  | { type: 'SET_CURRENT_STORYBOARD_INDEX'; index: number }
  | {
      type: 'UPDATE_STORYBOARD';
      index: number;
      updates: Partial<StoryboardState>;
      projectId?: string;
      chapterId?: string;
    }
  | {
      type: 'UPDATE_SCENE_SPATIAL_MASTER';
      sceneKey: string;
      updates: Partial<SceneSpatialMasterState> | undefined;
      projectId?: string;
      chapterId?: string;
    }
  | { type: 'MARK_DOWNSTREAM_STALE'; index: number; projectId?: string; chapterId?: string }
  | { type: 'RESTORE_DOWNSTREAM_AFTER_RECOVERABLE_STORYBOARD_RETRY'; index: number; projectId?: string; chapterId?: string }
  | { type: 'RESET_LEGACY_SCENE_MASTERS'; projectId?: string; chapterId?: string }
  | { type: 'RENAME_STORYBOARD'; index: number; name: string }
  | { type: 'SET_LAST_FRAME_INFO'; info: string; projectId?: string; chapterId?: string }
  | { type: 'SET_ITEM_TRACKER'; tracker: Record<string, string>; projectId?: string; chapterId?: string }
  | { type: 'START_AUTO_GENERATE'; total: number; sessionId?: string; startedAt?: number; projectId?: string; chapterId?: string }
  | {
      type: 'UPDATE_AUTO_GENERATE';
      updates: Partial<Omit<AutoGenerateState, 'running' | 'total'>>;
      projectId?: string;
      chapterId?: string;
    }
  | { type: 'END_AUTO_GENERATE'; stopReason?: AutoGenerateState['stopReason']; projectId?: string; chapterId?: string }
  | { type: 'QUEUE_STEP1_TASK'; projectId: string; chapterId: string; mode?: GlobalTask['step1Mode'] }
  | {
      type: 'QUEUE_STEP3_BATCH_TASK';
      projectId: string;
      chapterId: string;
      total: number;
      mode?: GlobalTask['step3Mode'];
      section?: GlobalTask['step3Section'];
      includeOutfitVariants?: boolean;
    }
  | { type: 'QUEUE_STEP4_BATCH_TASK'; projectId: string; chapterId: string; total: number; doneCount?: number; storyboardDirectorRunMode?: StoryboardDirectorRunMode }
  | { type: 'QUEUE_STEP5_BATCH_TASK'; projectId: string; chapterId: string; total: number; doneCount?: number; indices?: number[]; backend?: VideoBackendType }
  | { type: 'START_GLOBAL_TASK'; taskId: string; startedAt?: number }
  | { type: 'UPDATE_GLOBAL_TASK'; taskId: string; updates: Partial<Omit<GlobalTask, 'id' | 'type' | 'projectId' | 'chapterId' | 'createdAt'>> }
  | { type: 'APPEND_GLOBAL_TASK_EVENT'; taskId: string; event: Omit<GlobalTaskEvent, 'id' | 'at'> & Partial<Pick<GlobalTaskEvent, 'id' | 'at'>> }
  | { type: 'FINISH_GLOBAL_TASK'; taskId: string; status: 'done' | 'failed' | 'cancelled'; stopReason?: GlobalTask['stopReason'] }
  | { type: 'CANCEL_GLOBAL_TASK'; taskId: string }
  | { type: 'REMOVE_GLOBAL_TASK'; taskId: string }
  | { type: 'CLEAR_FINISHED_GLOBAL_TASKS' }
  | { type: 'SET_GLOBAL_TASK_SETTINGS'; settings: Partial<AppState['globalTaskSettings']> }
  | {
      type: 'SUBMIT_VIDEO';
      index: number;
      taskId: string;
      clientTaskId?: string;
      submittedAt?: number;
      duration?: number;
      chapterId: string;
      backend: VideoBackendType;
      productionMode?: VideoProductionMode;
      continuityGroupId?: string;
      continuityReason?: string;
      extendSourceIndex?: number;
      extendSourceTaskId?: string;
      extendSourceBlobKey?: string;
      extendSubmittedAsExtend?: boolean;
    }
  | {
      type: 'UPDATE_VIDEO_PROGRESS';
      index: number;
      progress: number;
      status?: 'polling';
      statusDetail?: string;
      progressIsEstimated?: boolean;
      chapterId: string;
      /** 可选：更新真实 taskId（HM/Volc 提交后获取真实 ID 替换占位符） */
      taskId?: string;
    }
  | {
      type: 'SET_VIDEO_COMPLETE';
      index: number;
      videoUrl: string;
      blobKey?: string;
      chapterId: string;
      completedAt?: number;
      taskId?: string;
      clientTaskId?: string;
      backend?: VideoBackendType;
      submittedAt?: number;
      duration?: number;
    }
  | { type: 'SET_VIDEO_ERROR'; index: number; error: string; errorDetail?: StoryboardState['videoErrorDetail']; chapterId: string }
  | { type: 'CLEAR_VIDEO'; index: number; chapterId?: string }
  | { type: 'RESET_ERROR_VIDEOS'; chapterId?: string }
  | { type: 'MARK_POLLING_VIDEOS_FAILED'; projectId: string; chapterId: string; taskIds: string[] }
  | { type: 'MARK_POLLING_AS_RESUMABLE'; projectId: string; chapterId: string }
  | { type: 'RESET_ALL_STORYBOARDS'; projectId?: string; chapterId?: string }
  | { type: 'RESET_ERROR_STORYBOARDS'; projectId?: string; chapterId?: string }
  | { type: 'CANCEL_BUSY_STORYBOARDS'; projectId?: string; chapterId?: string }
  | { type: 'RECOVER_INTERRUPTED_STORYBOARDS'; projectId?: string; chapterId?: string }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'HISTORY_PUSH'; projectId?: string; chapterId?: string }
  // 资产管理
  | { type: 'ADD_ASSET'; asset: Asset; skipAutoRelink?: boolean; projectId?: string }
  | { type: 'UPDATE_ASSET'; assetId: string; updates: Partial<Asset>; projectId?: string }
  | { type: 'DELETE_ASSET'; assetId: string }
  // 分镜关联资产
  | {
      type: 'LINK_ASSET_TO_STORYBOARD';
      projectId?: string;
      chapterId: string;
      sbIndex: number;
      imageRefRefId: string;
      assetId: string;
      bindingMode?: 'auto' | 'manual';
      preserveGeneratedBoards?: boolean;
    }
  | { type: 'UNLINK_ASSET_FROM_STORYBOARD'; projectId?: string; chapterId: string; sbIndex: number; imageRefRefId: string; preserveGeneratedBoards?: boolean }
  // F9: 分镜排序
  | { type: 'REORDER_STORYBOARDS'; chapterId: string; fromIndex: number; toIndex: number }
  // BGM / 音效 / 混音
  | { type: 'SET_CHAPTER_BGM'; bgm: BgmConfig | undefined }
  | { type: 'SET_STORYBOARD_BGM'; index: number; bgm: BgmConfig | undefined }
  | { type: 'SET_STORYBOARD_AUDIO_MIX'; index: number; audioMix: StoryboardAudioMix | undefined }
  | { type: 'SET_TTS_BLOB_KEY'; index: number; lineIndex: number; blobKey: string | undefined; snapshot?: TtsLineSnapshot }
  | {
      type: 'SET_TTS_LINE_GENERATION_STATE';
      index: number;
      lineIndex: number;
      state: TtsLineGenerationState | null;
    }
  | { type: 'SET_SFX_BLOB_KEY'; index: number; segmentIndex: number; blobKey: string | undefined }
  | { type: 'SET_CHAPTER_SPEAKER_VOICE_OVERRIDES'; overrides: Record<string, SpeakerVoiceOverride> }
  | { type: 'SET_CHAPTER_DUBBING_ANALYSIS_LINES'; lines: DubbingDialogueAnalysis[] }
  | { type: 'SET_POST_PRODUCTION_STATE'; postProduction: PostProductionState | undefined }
  | { type: 'UPSERT_CHARACTER_VOICE_REFERENCE'; reference: CharacterVoiceReference }
  | { type: 'DELETE_CHARACTER_VOICE_REFERENCE'; referenceId: string }
  | { type: 'SET_CHARACTER_VOICE_REFERENCE_LOCKED'; referenceId: string; locked: boolean }
  | { type: 'UPDATE_RENDER_JOB_STATE'; renderJob: RenderJobState | undefined }
  // 项目导入
  | { type: 'IMPORT_PROJECT'; project: Project }
  | { type: 'IMPORT_APP_STATE'; state: AppState };

// ---------- Reducer ----------
export function projectReducer(state: AppState, action: Action): AppState {
  if (action.type === 'HYDRATE_STATE') {
    return action.state;
  }

  // ---- 委托子 Reducer ----
  const videoResult = handleVideoAction(state, action);
  if (videoResult !== null) return videoResult;

  const assetResult = handleAssetAction(state, action);
  if (assetResult !== null) return assetResult;

  const historyResult = handleHistoryAction(state, action);
  if (historyResult !== null) return historyResult;

  // ---- 主 Reducer：全局配置 / 项目 / 章节 / 分镜 / 自动生成 ----
  switch (action.type) {
    // ---- 全局配置 ----
    case 'SET_API_CONFIG':
      return { ...state, apiConfig: action.config };
    case 'SET_IMAGE_API_CONFIG':
      return { ...state, imageApiConfig: normalizeImageApiConfig(action.config) };
    case 'SET_VIDEO_API_CONFIG':
      return { ...state, videoApiConfig: normalizeVideoApiConfig(action.config) };
    case 'SET_TTS_API_CONFIG':
      return { ...state, ttsApiConfig: action.config };
    case 'SET_MUSIC_API_CONFIG':
      return { ...state, musicApiConfig: action.config };
    case 'SET_GLOBAL_TASK_SETTINGS': {
      const nextConcurrency = normalizeStep4Concurrency(
        action.settings.step4Concurrency,
        state.globalTaskSettings?.step4Concurrency ?? DEFAULT_GLOBAL_TASK_SETTINGS.step4Concurrency,
      );
      const nextStoryboardImageConcurrency = normalizeStoryboardImageConcurrency(
        action.settings.step4StoryboardImageConcurrency,
        state.globalTaskSettings?.step4StoryboardImageConcurrency ?? DEFAULT_GLOBAL_TASK_SETTINGS.step4StoryboardImageConcurrency,
      );
      const nextSeedancePromptConcurrency = normalizeSeedancePromptConcurrency(
        action.settings.step4SeedancePromptConcurrency,
        state.globalTaskSettings?.step4SeedancePromptConcurrency ?? DEFAULT_GLOBAL_TASK_SETTINGS.step4SeedancePromptConcurrency,
      );
      const nextStoryboardImageSize = normalizeStoryboardImageSize(
        action.settings.step4StoryboardImageSize,
        state.globalTaskSettings?.step4StoryboardImageSize ?? DEFAULT_GLOBAL_TASK_SETTINGS.step4StoryboardImageSize,
      );
      const nextStep4LlmExecutionMode = 'browser-direct';
      return {
        ...state,
        globalTaskSettings: {
          ...state.globalTaskSettings,
          ...action.settings,
          step4Concurrency: nextConcurrency,
          step4StoryboardImageConcurrency: nextStoryboardImageConcurrency,
          step4SeedancePromptConcurrency: nextSeedancePromptConcurrency,
          step4StoryboardImageSize: nextStoryboardImageSize,
          step4LlmExecutionMode: nextStep4LlmExecutionMode,
        },
      };
    }
    case 'UPSERT_CHARACTER_VOICE_REFERENCE':
      return updateCurrentProject(state, (project) => {
        const references = project.characterVoiceReferences ?? [];
        const existingIndex = references.findIndex((item) => item.id === action.reference.id);
        const nextReferences = existingIndex >= 0
          ? references.map((item, index) => index === existingIndex ? action.reference : item)
          : [...references, action.reference];
        return { ...project, characterVoiceReferences: nextReferences };
      });
    case 'DELETE_CHARACTER_VOICE_REFERENCE':
      return updateCurrentProject(state, (project) => ({
        ...project,
        characterVoiceReferences: (project.characterVoiceReferences ?? []).filter((item) => item.id !== action.referenceId),
      }));
    case 'SET_CHARACTER_VOICE_REFERENCE_LOCKED':
      return updateCurrentProject(state, (project) => ({
        ...project,
        characterVoiceReferences: (project.characterVoiceReferences ?? []).map((item) =>
          item.id === action.referenceId
            ? { ...item, locked: action.locked, updatedAt: Date.now() }
            : item,
        ),
      }));

    // ---- 项目 ----
    case 'CREATE_PROJECT': {
      const p = createProject(action.name, action.initialRawScript);
      return {
        ...state,
        projects: [...state.projects, p],
        currentProjectId: p.id,
      };
    }
    case 'DELETE_PROJECT': {
      const remaining = state.projects.filter((p) => p.id !== action.projectId);
      return {
        ...state,
        projects: remaining,
        globalTasks: state.globalTasks.filter((task) => task.projectId !== action.projectId),
        currentProjectId:
          state.currentProjectId === action.projectId
            ? (remaining[0]?.id ?? null)
            : state.currentProjectId,
      };
    }
    case 'SWITCH_PROJECT':
      return { ...state, currentProjectId: action.projectId };
    case 'RENAME_PROJECT':
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId ? { ...p, name: action.name } : p,
        ),
      };

    // ---- 章节 ----
    case 'CREATE_CHAPTER': {
      const proj = state.projects.find((p) => p.id === state.currentProjectId);
      if (!proj) return state;
      const ch: Chapter = {
        ...createChapter(action.title, getProjectStoryboardBoardMode(proj)),
        storyboardBoardSmartPanelCount: getProjectSmartStoryboardPanelCountPreference(proj),
        storyboardBoardSmartDurationCompressionEnabled: getProjectSmartStoryboardDurationCompressionEnabled(proj),
        storyboardCameraSegmentCount: getProjectStoryboardCameraSegmentCount(proj),
      };
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === proj.id
            ? { ...p, chapters: [...p.chapters, ch], currentChapterId: ch.id }
            : p,
        ),
      };
    }
    case 'IMPORT_CHAPTERS_FROM_INPUT': {
      const projectId = action.projectId ?? state.currentProjectId;
      const proj = state.projects.find((p) => p.id === projectId);
      const importedInputs = action.chapters.filter((item) => item.rawScript.trim());
      if (!proj || importedInputs.length === 0) return state;

      const sourceChapterId = action.sourceChapterId ?? proj.currentChapterId;
      const sourceChapter = proj.chapters.find((chapter) => chapter.id === sourceChapterId);
      const sourceTextMatches = !!sourceChapter
        && typeof action.sourceText === 'string'
        && normalizeTrackedScript(sourceChapter.rawScript) === normalizeTrackedScript(action.sourceText);
      const canReplaceSourceChapter = !!sourceChapter
        && !sourceChapter.sourceSeriesEpisodeId
        && !sourceChapter.adaptedScript.trim()
        && !sourceChapter.analysis
        && sourceChapter.storyboards.length === 0
        && sourceChapter.status === 'idle'
        && (isReusableEmptyChapter(sourceChapter) || sourceTextMatches);

      const projectBoardMode = getProjectStoryboardBoardMode(proj);
      const projectSmartPanelCountPreference = getProjectSmartStoryboardPanelCountPreference(proj);
      const projectSmartDurationCompressionEnabled = getProjectSmartStoryboardDurationCompressionEnabled(proj);
      const projectCameraSegmentCount = getProjectStoryboardCameraSegmentCount(proj);
      const importedChapters = importedInputs.map((input) => {
        const chapter = createChapter(input.title, projectBoardMode);
        return {
          ...chapter,
          rawScript: input.rawScript.trim(),
          scriptType: input.scriptType,
          storyboardDuration: input.storyboardDuration ?? sourceChapter?.storyboardDuration ?? chapter.storyboardDuration,
          episodeDuration: input.episodeDuration ?? sourceChapter?.episodeDuration ?? chapter.episodeDuration,
          storyboardBoardSmartPanelCount: projectSmartPanelCountPreference,
          storyboardBoardSmartDurationCompressionEnabled: projectSmartDurationCompressionEnabled,
          storyboardCameraSegmentCount: projectCameraSegmentCount,
        };
      });
      const firstImportedChapterId = importedChapters[0]?.id;
      if (!firstImportedChapterId) return state;

      const nextChapters = (() => {
        if (!canReplaceSourceChapter || !sourceChapter) return [...proj.chapters, ...importedChapters];
        const sourceIndex = proj.chapters.findIndex((chapter) => chapter.id === sourceChapter.id);
        if (sourceIndex < 0) return [...proj.chapters, ...importedChapters];
        const chapters = [...proj.chapters];
        chapters.splice(sourceIndex, 1, ...importedChapters);
        return chapters;
      })();

      return {
        ...state,
        globalTasks: canReplaceSourceChapter && sourceChapter
          ? state.globalTasks.filter((task) => task.projectId !== proj.id || task.chapterId !== sourceChapter.id)
          : state.globalTasks,
        projects: state.projects.map((p) =>
          p.id === proj.id
            ? { ...p, chapters: nextChapters, currentChapterId: firstImportedChapterId }
            : p,
        ),
      };
    }
    case 'DELETE_CHAPTER': {
      const proj = state.projects.find((p) => p.id === state.currentProjectId);
      if (!proj || proj.chapters.length <= 1) return state; // 至少保留一章
      const remaining = proj.chapters.filter((c) => c.id !== action.chapterId);
      if (remaining.length === 0) return state;
      return {
        ...state,
        globalTasks: state.globalTasks.filter((task) =>
          task.projectId !== proj.id || task.chapterId !== action.chapterId,
        ),
        projects: state.projects.map((p) =>
          p.id === proj.id
            ? {
                ...p,
                chapters: remaining,
                currentChapterId:
                  proj.currentChapterId === action.chapterId
                    ? remaining[0].id
                    : proj.currentChapterId,
              }
            : p,
        ),
      };
    }
    case 'SWITCH_CHAPTER': {
      const targetProjectId = action.projectId ?? state.currentProjectId;
      const proj = state.projects.find((p) => p.id === targetProjectId);
      if (!proj) return state;
      if (!proj.chapters.some((chapter) => chapter.id === action.chapterId)) return state;
      const projectBoardMode = getProjectStoryboardBoardMode(proj);
      return {
        ...state,
        currentProjectId: proj.id,
        projects: state.projects.map((p) =>
          p.id === proj.id
            ? {
                ...p,
                currentChapterId: action.chapterId,
                chapters: p.chapters.map((chapter) =>
                  chapter.id === action.chapterId
                    ? applyStoryboardBoardModeToChapter(chapter, projectBoardMode)
                    : chapter,
                ),
              }
            : p,
        ),
      };
    }
    case 'RENAME_CHAPTER': {
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === state.currentProjectId
            ? {
                ...p,
                chapters: p.chapters.map((c) =>
                  c.id === action.chapterId ? { ...c, title: action.title } : c,
                ),
              }
            : p,
        ),
      };
    }
    case 'MOVE_CHAPTER': {
      const proj = state.projects.find((p) => p.id === state.currentProjectId);
      if (!proj) return state;
      const fromIndex = proj.chapters.findIndex((chapter) => chapter.id === action.chapterId);
      if (fromIndex < 0) return state;
      const toIndex = action.direction === 'up' ? fromIndex - 1 : fromIndex + 1;
      if (toIndex < 0 || toIndex >= proj.chapters.length) return state;
      const chapters = [...proj.chapters];
      const [moved] = chapters.splice(fromIndex, 1);
      chapters.splice(toIndex, 0, moved);
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === proj.id ? { ...p, chapters } : p,
        ),
      };
    }
    case 'DUPLICATE_CHAPTER': {
      const proj = state.projects.find((p) => p.id === state.currentProjectId);
      if (!proj) return state;
      const source = proj.chapters.find((chapter) => chapter.id === action.chapterId);
      if (!source) return state;
      const projectSmartPanelCountPreference = getProjectSmartStoryboardPanelCountPreference(proj);
      const projectSmartDurationCompressionEnabled = getProjectSmartStoryboardDurationCompressionEnabled(proj);
      const projectCameraSegmentCount = getProjectStoryboardCameraSegmentCount(proj);
      const cloned: Chapter = {
        ...source,
        id: genId(),
        title: action.title,
        storyboards: [],
        currentStoryboardIndex: 0,
        globalLastFrameInfo: '',
        itemTracker: {},
        autoGenerate: { ...DEFAULT_AUTO_GENERATE },
        status: source.analysis ? 'analyzing' : 'idle',
        storyboardBoardMode: getProjectStoryboardBoardMode(proj),
        storyboardBoardSmartPanelCount: projectSmartPanelCountPreference,
        storyboardBoardSmartDurationCompressionEnabled: projectSmartDurationCompressionEnabled,
        storyboardCameraSegmentCount: projectCameraSegmentCount,
        past: [],
        future: [],
      };
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === proj.id
            ? { ...p, chapters: [...p.chapters, cloned], currentChapterId: cloned.id }
            : p,
        ),
      };
    }

    // ---- 全局资源 ----
    case 'SET_ALL_CHARACTER_NAMES':
      return updateCurrentProject(state, (p) => ({ ...p, allCharacterNames: action.names }));
    case 'SET_OUTFIT_TRACKING':
      return updateCurrentProject(state, (p) => ({ ...p, outfitTracking: action.outfits }));
    case 'SET_PROP_INHERITANCE':
      return updateCurrentProject(state, (p) => ({ ...p, propInheritance: action.text }));
    case 'SET_PROJECT_STEP3_SETTINGS':
      return updateCurrentProject(state, (p) => ({
        ...p,
        step3Settings: {
          optimizeConcurrency: p.step3Settings?.optimizeConcurrency ?? 5,
          generateConcurrency: p.step3Settings?.generateConcurrency ?? 5,
          useVolcVirtualHumans: p.step3Settings?.useVolcVirtualHumans ?? false,
          ...action.settings,
        },
      }));
    case 'SET_SERIES_PLAN':
      return updateCurrentProject(state, (p) => {
        const nextStyleConfig = action.plan.styleConfig?.trim() || p.styleConfig;
        return {
          ...p,
          styleConfig: nextStyleConfig,
          seriesPlan: action.plan,
          seriesRuntime: action.resetSeriesRuntime ? undefined : p.seriesRuntime,
          chapters: nextStyleConfig
            ? p.chapters.map((chapter) => chapter.analysis
              ? {
                  ...chapter,
                  analysis: {
                    ...chapter.analysis,
                    styleConfig: nextStyleConfig,
                  },
                }
              : chapter)
            : p.chapters,
        };
      });
    case 'SET_SERIES_RUNTIME':
      return updateCurrentProject(state, (p) => ({
        ...p,
        seriesRuntime: action.runtime,
      }));
    case 'UPDATE_SERIES_EPISODE_SCRIPT':
      return updateCurrentProject(state, (p) => {
        if (!p.seriesPlan) return p;
        const updatedAt = Date.now();
        return {
          ...p,
          seriesPlan: {
            ...p.seriesPlan,
            episodeCards: p.seriesPlan.episodeCards.map((episode) =>
              episode.id === action.episodeId
                ? { ...episode, generatedScript: action.script, generatedAt: updatedAt }
                : episode,
            ),
            updatedAt,
          },
        };
      });
    case 'CREATE_CHAPTER_FROM_SERIES_EPISODE': {
      const proj = state.projects.find((p) => p.id === state.currentProjectId);
      const episode = proj?.seriesPlan?.episodeCards.find((item) => item.id === action.episodeId);
      if (!proj || !episode) return state;

      const existingChapter = proj.chapters.find((item) => item.sourceSeriesEpisodeId === episode.id);
      const reusableChapter = existingChapter
        ?? (proj.chapters.length === 1 && isReusableEmptyChapter(proj.chapters[0]) ? proj.chapters[0] : undefined);
      const projectBoardMode = getProjectStoryboardBoardMode(proj);
      const projectSmartPanelCountPreference = getProjectSmartStoryboardPanelCountPreference(proj);
      const projectSmartDurationCompressionEnabled = getProjectSmartStoryboardDurationCompressionEnabled(proj);
      const projectCameraSegmentCount = getProjectStoryboardCameraSegmentCount(proj);
      const chapter = reusableChapter ?? createChapter(`第${episode.episodeNumber}集：${episode.title}`, projectBoardMode);
      const preparedChapter: Chapter = {
        ...chapter,
        title: `第${episode.episodeNumber}集：${episode.title}`,
        storyboardBoardMode: projectBoardMode,
        storyboardBoardSmartPanelCount: projectSmartPanelCountPreference,
        storyboardBoardSmartDurationCompressionEnabled: projectSmartDurationCompressionEnabled,
        storyboardCameraSegmentCount: projectCameraSegmentCount,
        sourceSeriesEpisodeId: episode.id,
        rawScript: episode.generatedScript ?? '',
        scriptType: 'annotated',
        adaptedScript: '',
        episodeDuration: proj.seriesPlan?.episodeDuration ?? chapter.episodeDuration,
        analysis: null,
        analysisSourceText: '',
        analysisIsStale: false,
        storyboards: [],
        status: 'idle',
      };

      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === proj.id
            ? {
                ...p,
                chapters: reusableChapter
                  ? p.chapters.map((item) => item.id === reusableChapter.id ? preparedChapter : item)
                  : [...p.chapters, preparedChapter],
                currentChapterId: preparedChapter.id,
              }
            : p,
        ),
      };
    }

    // ---- 当前章节操作 ----
    case 'SET_STEP':
      return updateCurrentChapter(state, { status: 'idle' });
    case 'SET_RAW_SCRIPT':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        const project = state.projects.find((item) => item.id === target.projectId);
        const chapter = project?.chapters.find((item) => item.id === target.chapterId);
        if (!project || !chapter) return state;
        const { analysisSourceText, analysisIsStale } = getTrackedAnalysisState(chapter, action.script, 'annotated');
        return updateChapterById(state, target.projectId, target.chapterId, {
          rawScript: action.script,
          analysisSourceText,
          analysisIsStale,
        });
      })();
    case 'UPDATE_RAW_SCRIPT':
      return (() => {
        const project = state.projects.find((item) => item.id === state.currentProjectId);
        const chapter = project?.chapters.find((item) => item.id === project.currentChapterId);
        if (!project || !chapter) return state;
        const { analysisSourceText, analysisIsStale } = getTrackedAnalysisState(chapter, action.script, 'annotated');
        return updateCurrentChapter(state, {
          rawScript: action.script,
          analysisSourceText,
          analysisIsStale,
        });
      })();
    case 'SET_SCRIPT_TYPE':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        const project = state.projects.find((item) => item.id === target.projectId);
        const chapter = project?.chapters.find((item) => item.id === target.chapterId);
        if (!chapter) return state;
        const analysisSourceText = chapter.analysis
          ? (chapter.analysisSourceText ?? getChapterSourceSnapshot(chapter))
          : chapter.analysisSourceText;
        const nextTrackedScript = action.scriptType === 'novel' ? chapter.adaptedScript : chapter.rawScript;
        const analysisIsStale = chapter.analysis
          ? normalizeTrackedScript(nextTrackedScript) !== normalizeTrackedScript(analysisSourceText)
          : (chapter.analysisIsStale ?? false);
        return updateChapterById(state, target.projectId, target.chapterId, {
          scriptType: action.scriptType,
          analysisSourceText,
          analysisIsStale,
        });
      })();
    case 'SET_STORYBOARD_DURATION':
      return updateCurrentChapter(state, { storyboardDuration: action.duration });
    case 'SET_EPISODE_DURATION':
      return updateCurrentChapter(state, { episodeDuration: action.duration });
    case 'SET_STEP4_OUTPUT_MODE':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        return updateChapterById(state, target.projectId, target.chapterId, { step4OutputMode: action.mode });
      })();
    case 'SET_STORYBOARD_BOARD_MODE':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        const project = state.projects.find((item) => item.id === target.projectId);
        if (!project) return state;
        return updateProjectById(state, target.projectId, (currentProject) => ({
          ...currentProject,
          chapters: currentProject.chapters.map((chapter) => applyStoryboardBoardModeToChapter(chapter, action.mode)),
        }));
      })();
    case 'SET_SMART_STORYBOARD_PANEL_COUNT':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        const project = state.projects.find((item) => item.id === target.projectId);
        if (!project) return state;
        const preference = normalizeSmartStoryboardPanelCountPreference(action.preference);
        return updateProjectById(state, target.projectId, (currentProject) => ({
          ...currentProject,
          chapters: currentProject.chapters.map((chapter) => applySmartStoryboardPanelCountToChapter(chapter, preference)),
        }));
      })();
    case 'SET_SMART_STORYBOARD_DURATION_COMPRESSION':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        const project = state.projects.find((item) => item.id === target.projectId);
        if (!project) return state;
        return updateProjectById(state, target.projectId, (currentProject) => ({
          ...currentProject,
          chapters: currentProject.chapters.map((chapter) => (
            applySmartStoryboardDurationCompressionToChapter(chapter, action.enabled)
          )),
        }));
      })();
    case 'SET_STORYBOARD_CAMERA_SEGMENT_COUNT':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        const project = state.projects.find((item) => item.id === target.projectId);
        if (!project) return state;
        const count = normalizeStoryboardCameraSegmentPreference(action.count);
        return updateProjectById(state, target.projectId, (currentProject) => ({
          ...currentProject,
          chapters: currentProject.chapters.map((chapter) => (
            applyStoryboardCameraSegmentCountToChapter(chapter, count)
          )),
        }));
      })();
    case 'SET_STORYBOARD_BOARD_STYLE':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        return updateChapterById(state, target.projectId, target.chapterId, { storyboardBoardStyle: action.style });
      })();
    case 'SET_STORYBOARD_DIRECTOR_RUN_MODE':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        return updateChapterById(state, target.projectId, target.chapterId, { storyboardDirectorRunMode: action.mode });
      })();
    case 'SET_ADAPTED_SCRIPT':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        const project = state.projects.find((item) => item.id === target.projectId);
        const chapter = project?.chapters.find((item) => item.id === target.chapterId);
        if (!project || !chapter) return state;
        const { analysisSourceText, analysisIsStale } = getTrackedAnalysisState(chapter, action.script, 'novel');
        return updateChapterById(state, target.projectId, target.chapterId, {
          adaptedScript: action.script,
          analysisSourceText,
          analysisIsStale,
        });
      })();
    case 'SET_ANALYSIS': {
      const hasSourceText = typeof action.sourceText === 'string';
      const target = resolveActionChapterTarget(state, action);
      if (!target) return state;
      const project = state.projects.find((item) => item.id === target.projectId);
      const chapter = project?.chapters.find((item) => item.id === target.chapterId);
      if (!project || !chapter) return state;

      const incomingStyle = action.analysis.styleConfig?.trim() ?? '';
      const currentProjectStyle = project.styleConfig?.trim() ?? '';
      const hasManualProjectStyleEdit = action.syncProjectStyle === true;
      const shouldSyncProjectStyle = hasManualProjectStyleEdit && incomingStyle.length > 0;
      const canonicalStyle = shouldSyncProjectStyle
        ? incomingStyle
        : hasManualProjectStyleEdit
          ? incomingStyle
          : currentProjectStyle || incomingStyle;
      const shouldPropagateProjectStyle = canonicalStyle.length > 0 && (!hasManualProjectStyleEdit || incomingStyle.length > 0);
      const analysis = {
        ...action.analysis,
        styleConfig: canonicalStyle || action.analysis.styleConfig,
        propTracking: hasSourceText
          ? normalizeGeneratedPropTrackingDefaults(action.analysis.propTracking ?? [])
          : ensurePropTrackingIds(action.analysis.propTracking ?? []),
      };
      const hasAiAutofillSignature = typeof action.aiAutofillSignature === 'string';
      const shouldResetAiAutofillSignature = hasSourceText && !hasAiAutofillSignature;
      return updateProjectById(
        state,
        target.projectId,
        (p) => ({
          ...p,
          styleConfig: shouldSyncProjectStyle || (!currentProjectStyle && incomingStyle)
            ? canonicalStyle
            : p.styleConfig,
          allCharacterNames: analysis.allCharacterNames ?? p.allCharacterNames,
          characterProfiles: analysis.characterProfiles ?? p.characterProfiles,
          outfitTracking: analysis.outfitTracking ?? p.outfitTracking,
          propTracking: analysis.propTracking ?? p.propTracking,
          propInheritance: analysis.propInheritance ?? p.propInheritance,
          chapters: p.chapters.map((item) => {
            if (item.id === target.chapterId) {
              return {
                ...item,
                analysis,
                analysisPropDefaultPolicyVersion: hasSourceText
                  ? PROP_DEFAULT_POLICY_VERSION
                  : chapter.analysisPropDefaultPolicyVersion,
                analysisSourceText: hasSourceText ? action.sourceText : chapter.analysisSourceText,
                analysisIsStale: hasSourceText ? false : (chapter.analysisIsStale ?? false),
                analysisAiAutofillSignature: hasAiAutofillSignature
                  ? action.aiAutofillSignature
                  : (shouldResetAiAutofillSignature ? undefined : chapter.analysisAiAutofillSignature),
                analysisAiAutofillAt: hasAiAutofillSignature
                  ? (action.aiAutofillAt ?? Date.now())
                  : (shouldResetAiAutofillSignature ? undefined : chapter.analysisAiAutofillAt),
              };
            }
            if (!shouldPropagateProjectStyle || !item.analysis || item.analysis.styleConfig === canonicalStyle) {
              return item;
            }
            return {
              ...item,
              analysis: {
                ...item.analysis,
                styleConfig: canonicalStyle,
              },
            };
          }),
        }),
      );
    }
    case 'SET_CHAPTER_STATUS':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        return updateChapterById(state, target.projectId, target.chapterId, { status: action.status });
      })();
    case 'UPDATE_STEP1_TASK':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        const project = state.projects.find((item) => item.id === target.projectId);
        const chapter = project?.chapters.find((item) => item.id === target.chapterId);
        if (!chapter) return state;
        return updateChapterById(state, target.projectId, target.chapterId, {
          step1Task: {
            ...DEFAULT_STEP1_TASK,
            ...(chapter.step1Task ?? {}),
            ...action.updates,
            updatedAt: Date.now(),
          },
        });
      })();
    case 'END_STEP1_TASK':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        const project = state.projects.find((item) => item.id === target.projectId);
        const chapter = project?.chapters.find((item) => item.id === target.chapterId);
        if (!chapter) return state;
        return updateChapterById(state, target.projectId, target.chapterId, {
          step1Task: {
            ...DEFAULT_STEP1_TASK,
            ...(chapter.step1Task ?? {}),
            ...(action.updates ?? {}),
            running: false,
            sessionId: undefined,
            updatedAt: Date.now(),
          },
        });
      })();
    case 'UPDATE_STEP3_TASK':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        const project = state.projects.find((item) => item.id === target.projectId);
        const chapter = project?.chapters.find((item) => item.id === target.chapterId);
        if (!chapter) return state;
        return updateChapterById(state, target.projectId, target.chapterId, {
          step3Task: {
            ...DEFAULT_STEP3_TASK,
            ...(chapter.step3Task ?? {}),
            ...action.updates,
            updatedAt: Date.now(),
          },
        });
      })();
    case 'END_STEP3_TASK':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        const project = state.projects.find((item) => item.id === target.projectId);
        const chapter = project?.chapters.find((item) => item.id === target.chapterId);
        if (!chapter) return state;
        return updateChapterById(state, target.projectId, target.chapterId, {
          step3Task: {
            ...DEFAULT_STEP3_TASK,
            ...(chapter.step3Task ?? {}),
            ...(action.updates ?? {}),
            running: false,
            sessionId: undefined,
            stopRequested: false,
            updatedAt: Date.now(),
          },
        });
      })();
    case 'INIT_STORYBOARDS': {
      if (import.meta.env.DEV) console.log('[store] INIT_STORYBOARDS', {
        currentProjectId: state.currentProjectId,
        storyboardsCount: action.storyboards.length,
      });

      // 收集旧 imageRefs 中已有的 assetId 映射（道具按 trackingId 恢复），以便在新 refs 中恢复
      const proj = state.projects.find((p) => p.id === state.currentProjectId);
      const chapter = proj?.chapters.find((c) => c.id === proj.currentChapterId);
      const oldAssetMap = new Map<string, { assetId: string; assetBindingMode?: 'auto' | 'manual' }>();
      if (chapter) {
        for (const sb of chapter.storyboards) {
          for (const ref of sb.imageRefs ?? []) {
            if (ref.assetId) {
              oldAssetMap.set(getImageRefRestoreKey(ref), {
                assetId: ref.assetId,
                assetBindingMode: ref.assetBindingMode,
              });
            }
          }
        }
      }

      return updateCurrentChapter(state, {
        storyboards: action.storyboards.map((sb) => ({
          storyboard: sb.storyboard,
          step4OutputMode: chapter?.step4OutputMode ?? DEFAULT_STEP4_OUTPUT_MODE,
          generatedStep4OutputMode: undefined,
          storyboardBoardStyle: (chapter?.step4OutputMode ?? DEFAULT_STEP4_OUTPUT_MODE) === 'storyboard-director'
            ? DEFAULT_STORYBOARD_BOARD_STYLE
            : (chapter?.storyboardBoardStyle ?? DEFAULT_STORYBOARD_BOARD_STYLE),
          logicFixes: [],
          correctedScript: '',
          sceneBlueprint: null,
          choreography: null,
          imageRefs: sb.imageRefs.map((ref) => {
            const restored = oldAssetMap.get(getImageRefRestoreKey(ref));
            return {
              ...ref,
              assetId: restored?.assetId ?? ref.assetId,
              assetBindingMode: restored?.assetBindingMode ?? ref.assetBindingMode,
            };
          }),
          prompt: null,
          selfCheckResult: null,
          lastFrameInfo: '',
          spatialBlocking: undefined,
          continuityInput: undefined,
          continuityOutput: undefined,
          isStale: false,
          storyboardBoard: undefined,
          scenePositionBoard: undefined,
          error: undefined,
          status: 'pending' as const,
        })),
        currentStoryboardIndex: 0,
        globalLastFrameInfo: '',
        itemTracker: {},
        status: 'assets',
      });
    }
    case 'SET_CURRENT_STORYBOARD_INDEX':
      return updateCurrentChapter(state, { currentStoryboardIndex: action.index });
    case 'UPDATE_STORYBOARD':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        const project = state.projects.find((item) => item.id === target.projectId);
        const chapter = project?.chapters.find((item) => item.id === target.chapterId);
        if (!project || !chapter) return state;
        const updatesImageRefs = Object.prototype.hasOwnProperty.call(action.updates, 'imageRefs');
        const updatesVideoImageRefs = Object.prototype.hasOwnProperty.call(action.updates, 'videoImageRefs');
        const storyboards = chapter.storyboards.map((sb, i) => {
          if (i !== action.index) return sb;
          const next = { ...sb, ...action.updates };
          return updatesImageRefs && !updatesVideoImageRefs
            ? { ...next, videoImageRefs: undefined }
            : next;
        });
        const continuityMirror = deriveChapterContinuityMirror(storyboards);
        return updateChapterById(state, target.projectId, target.chapterId, {
          storyboards,
          ...continuityMirror,
        });
      })();
    case 'UPDATE_SCENE_SPATIAL_MASTER':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        const project = state.projects.find((item) => item.id === target.projectId);
        const chapter = project?.chapters.find((item) => item.id === target.chapterId);
        if (!project || !chapter) return state;
        const sceneSpatialMasters = { ...(chapter.sceneSpatialMasters ?? {}) };
        if (action.updates) {
          const previous = sceneSpatialMasters[action.sceneKey];
          const nextStatus = action.updates.status ?? previous?.status ?? 'idle';
          const nextSceneName = action.updates.sceneName ?? previous?.sceneName ?? action.sceneKey;
          sceneSpatialMasters[action.sceneKey] = {
            ...previous,
            ...action.updates,
            schemaVersion: action.updates.schemaVersion ?? previous?.schemaVersion,
            status: nextStatus,
            sceneName: nextSceneName,
          };
        } else {
          delete sceneSpatialMasters[action.sceneKey];
        }
        return updateChapterById(state, target.projectId, target.chapterId, {
          sceneSpatialMasters,
        });
      })();
    case 'MARK_DOWNSTREAM_STALE':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        const project = state.projects.find((item) => item.id === target.projectId);
        const chapter = project?.chapters.find((item) => item.id === target.chapterId);
        if (!project || !chapter) return state;
        const storyboards = chapter.storyboards.map((sb, i) =>
          i > action.index
            ? (() => {
                const isStale = !!(sb.prompt || sb.correctedScript || sb.choreography || sb.sceneBlueprint || sb.lastFrameInfo || sb.spatialBlocking);
                return {
                  ...sb,
                  isStale,
                  storyboardBoard: isStale ? markStoryboardBoardStale(sb.storyboardBoard, 'source-change') : sb.storyboardBoard,
                  scenePositionBoard: isStale ? markScenePositionBoardStale(sb.scenePositionBoard) : sb.scenePositionBoard,
                };
              })()
            : sb,
        );
        return updateChapterById(state, target.projectId, target.chapterId, {
          storyboards,
          ...deriveChapterContinuityMirror(storyboards),
        });
      })();
    case 'RESTORE_DOWNSTREAM_AFTER_RECOVERABLE_STORYBOARD_RETRY':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        const project = state.projects.find((item) => item.id === target.projectId);
        const chapter = project?.chapters.find((item) => item.id === target.chapterId);
        if (!project || !chapter) return state;
        const storyboards = chapter.storyboards.map((sb, i) =>
          i > action.index ? restoreDownstreamAfterRecoverableStoryboardRetry(sb) : sb,
        );
        return updateChapterById(state, target.projectId, target.chapterId, {
          storyboards,
          ...deriveChapterContinuityMirror(storyboards),
        });
      })();
    case 'RESET_LEGACY_SCENE_MASTERS':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        const project = state.projects.find((item) => item.id === target.projectId);
        const chapter = project?.chapters.find((item) => item.id === target.chapterId);
        if (!project || !chapter) return state;

        const legacySceneNames = new Set(
          Object.entries(chapter.sceneSpatialMasters ?? {})
            .filter(([, master]) => (master.schemaVersion ?? 1) < SCENE_SPATIAL_MASTER_SCHEMA_VERSION)
            .map(([key, master]) => getSceneSpatialMasterKey(master.sceneName ?? key.replace(/::(?:reverse|side)$/, ''))),
        );
        const sceneSpatialMasters = Object.fromEntries(
          Object.entries(chapter.sceneSpatialMasters ?? {}).map(([key, master]) => [
            key,
            (master.schemaVersion ?? 1) < SCENE_SPATIAL_MASTER_SCHEMA_VERSION
              ? {
                  ...markSceneSpatialMasterStale(master)!,
                  schemaVersion: SCENE_SPATIAL_MASTER_SCHEMA_VERSION,
                  status: master.status === 'generating' ? 'idle' : master.status,
                }
              : master,
          ]),
        );

        const storyboards = chapter.storyboards.map((storyboard) => {
          const board = storyboard.scenePositionBoard;
          const hasLegacyBoard = !!board && (board.schemaVersion ?? 1) < SCENE_SPATIAL_MASTER_SCHEMA_VERSION;
          const usesLegacyScene = legacySceneNames.has(getSceneSpatialMasterKey(storyboard.storyboard.scene));
          const relinked = relinkMissingImageReferenceAssets(storyboard.imageRefs, project.assetLibrary);
          if (!hasLegacyBoard && !usesLegacyScene) return storyboard;
          return {
            ...storyboard,
            imageRefs: relinked.changed ? relinked.imageRefs : storyboard.imageRefs,
            scenePositionBoard: board
              ? {
                  ...markScenePositionBoardStale(board)!,
                  schemaVersion: SCENE_SPATIAL_MASTER_SCHEMA_VERSION,
                }
              : board,
            isStale: !!storyboard.prompt,
            storyboardBoard: markStoryboardBoardStale(storyboard.storyboardBoard, 'source-change'),
            compactVideoPromptStatus: storyboard.compactVideoPromptStatus ? 'idle' as const : storyboard.compactVideoPromptStatus,
            compactVideoPrompt: storyboard.compactVideoPrompt ? '' : storyboard.compactVideoPrompt,
            compactVideoPromptError: undefined,
            compactVideoPromptSourcePrompt: storyboard.compactVideoPromptSourcePrompt ? '' : storyboard.compactVideoPromptSourcePrompt,
            compactVideoPromptUpdatedAt: undefined,
            videoSubmitPromptOverride: storyboard.videoSubmitPromptOverride ? '' : storyboard.videoSubmitPromptOverride,
            videoSubmitPromptOverrideSourcePrompt: storyboard.videoSubmitPromptOverrideSourcePrompt ? '' : storyboard.videoSubmitPromptOverrideSourcePrompt,
            videoSubmitPromptOverrideUpdatedAt: undefined,
          };
        });

        return updateChapterById(state, target.projectId, target.chapterId, {
          sceneSpatialMasters,
          storyboards,
          ...deriveChapterContinuityMirror(storyboards),
        });
      })();
    case 'RENAME_STORYBOARD':
      return updateCurrentStoryboards(state, (sb, i) =>
        i === action.index
          ? {
              ...sb,
              storyboard: { ...sb.storyboard, name: action.name },
              isStale: !!(sb.prompt || sb.correctedScript || sb.choreography || sb.sceneBlueprint || sb.lastFrameInfo || sb.spatialBlocking),
              storyboardBoard: markStoryboardBoardStale(sb.storyboardBoard, 'source-change'),
              scenePositionBoard: markScenePositionBoardStale(sb.scenePositionBoard),
            }
          : sb,
      );
    case 'SET_LAST_FRAME_INFO':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        return updateChapterById(state, target.projectId, target.chapterId, { globalLastFrameInfo: action.info });
      })();
    case 'SET_ITEM_TRACKER':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        return updateChapterById(state, target.projectId, target.chapterId, { itemTracker: action.tracker });
      })();
    case 'QUEUE_STEP1_TASK': {
      const project = state.projects.find((item) => item.id === action.projectId);
      const chapter = project?.chapters.find((item) => item.id === action.chapterId);
      if (!project || !chapter) return state;
      if (hasActiveGlobalTaskForChapter(state, 'step1-analysis', action.projectId, action.chapterId)) return state;
      const now = Date.now();
      const task: GlobalTask = {
        id: genId(),
        type: 'step1-analysis',
        projectId: action.projectId,
        chapterId: action.chapterId,
        step1Mode: action.mode ?? 'auto',
        status: 'queued',
        currentIndex: -1,
        total: 1,
        doneCount: 0,
        errors: [],
        eventLog: [createGlobalTaskEvent('info', '任务已加入队列', 'Step1')],
        createdAt: now,
        updatedAt: now,
      };
      return pruneFinishedGlobalTasksByIdentity({
        ...state,
        globalTasks: [...state.globalTasks, task],
      });
    }
    case 'QUEUE_STEP3_BATCH_TASK': {
      const project = state.projects.find((item) => item.id === action.projectId);
      const chapter = project?.chapters.find((item) => item.id === action.chapterId);
      if (!project || !chapter || action.total <= 0) return state;
      if (hasActiveGlobalTaskForChapter(state, 'step3-batch', action.projectId, action.chapterId)) return state;
      const now = Date.now();
      const task: GlobalTask = {
        id: genId(),
        type: 'step3-batch',
        projectId: action.projectId,
        chapterId: action.chapterId,
        step3Mode: action.mode ?? 'all-images',
        step3Section: action.section,
        step3IncludeOutfitVariants: action.includeOutfitVariants,
        status: 'queued',
        currentIndex: -1,
        total: action.total,
        doneCount: 0,
        errors: [],
        eventLog: [createGlobalTaskEvent('info', '任务已加入队列', 'Step3')],
        createdAt: now,
        updatedAt: now,
      };
      return pruneFinishedGlobalTasksByIdentity({
        ...state,
        globalTasks: [...state.globalTasks, task],
      });
    }
    case 'QUEUE_STEP4_BATCH_TASK': {
      const project = state.projects.find((item) => item.id === action.projectId);
      const chapter = project?.chapters.find((item) => item.id === action.chapterId);
      if (!project || !chapter || action.total <= 0) return state;
      if (hasActiveStep4GlobalTaskForChapter(state, action.projectId, action.chapterId)) return state;
      const now = Date.now();
      const task: GlobalTask = {
        id: genId(),
        type: 'step4-batch',
        projectId: action.projectId,
        chapterId: action.chapterId,
        storyboardDirectorRunMode: action.storyboardDirectorRunMode
          ?? chapter.storyboardDirectorRunMode
          ?? DEFAULT_STORYBOARD_DIRECTOR_RUN_MODE,
        status: 'queued',
        currentIndex: -1,
        total: action.total,
        doneCount: Math.max(0, Math.min(action.doneCount ?? 0, action.total)),
        errors: [],
        eventLog: [createGlobalTaskEvent('info', '任务已加入队列', 'Step4')],
        createdAt: now,
        updatedAt: now,
      };
      return pruneFinishedGlobalTasksByIdentity({
        ...state,
        globalTasks: [...state.globalTasks, task],
      });
    }
    case 'QUEUE_STEP5_BATCH_TASK': {
      const project = state.projects.find((item) => item.id === action.projectId);
      const chapter = project?.chapters.find((item) => item.id === action.chapterId);
      if (!project || !chapter || action.total <= 0) return state;
      if (hasActiveGlobalTaskForChapter(state, 'step5-batch', action.projectId, action.chapterId)) return state;
      const indices = action.indices
        ?.map((index) => Math.round(index))
        .filter((index) => index >= 0 && index < chapter.storyboards.length);
      const now = Date.now();
      const task: GlobalTask = {
        id: genId(),
        type: 'step5-batch',
        projectId: action.projectId,
        chapterId: action.chapterId,
        step5Indices: indices?.length ? Array.from(new Set(indices)) : undefined,
        step5Backend: action.backend ?? state.videoApiConfig.backend,
        status: 'queued',
        currentIndex: -1,
        total: action.total,
        doneCount: Math.max(0, Math.min(action.doneCount ?? 0, action.total)),
        errors: [],
        eventLog: [createGlobalTaskEvent('info', '任务已加入队列', 'Step5')],
        createdAt: now,
        updatedAt: now,
      };
      return pruneFinishedGlobalTasksByIdentity({
        ...state,
        globalTasks: [...state.globalTasks, task],
      });
    }
    case 'START_GLOBAL_TASK': {
      const startedAt = action.startedAt ?? Date.now();
      return updateGlobalTaskById(state, action.taskId, (task) => ({
        ...task,
        status: 'running',
        currentIndex: -1,
        doneCount: 0,
        errors: [],
        retryNotice: undefined,
        streamStoryboardIndex: undefined,
        streamPhase: undefined,
        streamStageLabel: undefined,
        streamStageStartedAt: undefined,
        streamStageLastActivityAt: undefined,
        streamStageTimeoutMs: undefined,
        streamStageTimeoutMode: undefined,
        streamTextPreview: '',
        streamTextLength: 0,
        streamUpdatedAt: undefined,
        streamPreviousStageLabel: undefined,
        streamPreviousTextLength: undefined,
        streamPreviousUpdatedAt: undefined,
        startedAt,
        completedAt: undefined,
        stopReason: undefined,
        updatedAt: startedAt,
        eventLog: appendGlobalTaskEvent(task, createGlobalTaskEvent('info', '任务开始')).eventLog,
      }));
    }
    case 'UPDATE_GLOBAL_TASK':
      return updateGlobalTaskById(state, action.taskId, (task) => applyGlobalTaskUpdates(task, action.updates));
    case 'APPEND_GLOBAL_TASK_EVENT':
      return updateGlobalTaskById(state, action.taskId, (task) => {
        const event: GlobalTaskEvent = {
          id: action.event.id ?? genId(),
          at: action.event.at ?? Date.now(),
          level: action.event.level,
          label: action.event.label,
          ...(action.event.detail ? { detail: action.event.detail } : {}),
          ...(typeof action.event.storyboardIndex === 'number' ? { storyboardIndex: action.event.storyboardIndex } : {}),
          ...(action.event.phase ? { phase: action.event.phase } : {}),
        };
        return {
          ...appendGlobalTaskEvent(task, event),
          updatedAt: Date.now(),
        };
      });
    case 'FINISH_GLOBAL_TASK': {
      const completedAt = Date.now();
      return updateGlobalTaskById(state, action.taskId, (task) => ({
        ...appendGlobalTaskEvent(task, getGlobalTaskFinishEvent(action.status, action.stopReason ?? task.stopReason)),
        status: action.status,
        currentIndex: -1,
        streamStageStartedAt: undefined,
        streamStageLastActivityAt: undefined,
        streamStageTimeoutMs: undefined,
        streamStageTimeoutMode: undefined,
        completedAt,
        stopReason: action.stopReason ?? task.stopReason,
        updatedAt: completedAt,
      }));
    }
    case 'CANCEL_GLOBAL_TASK': {
      const task = state.globalTasks.find((item) => item.id === action.taskId);
      if (!task) return state;
      const completedAt = Date.now();
      let next = updateGlobalTaskById(state, action.taskId, (item) => ({
        ...item,
        status: 'cancelled',
        currentIndex: -1,
        streamPhase: null,
        streamStageLabel: '已取消',
        streamStageStartedAt: undefined,
        streamStageLastActivityAt: undefined,
        streamStageTimeoutMs: undefined,
        streamStageTimeoutMode: undefined,
        completedAt,
        stopReason: 'cancelled',
        updatedAt: completedAt,
        eventLog: appendGlobalTaskEvent(item, createGlobalTaskEvent('warning', '任务已手动停止')).eventLog,
      }));
      if (task.status === 'running') {
        const project = next.projects.find((item) => item.id === task.projectId);
        const chapter = project?.chapters.find((item) => item.id === task.chapterId);
        if (chapter) {
          if (task.type === 'step1-analysis') {
            next = updateChapterById(next, task.projectId, task.chapterId, {
              step1Task: {
                ...(chapter.step1Task ?? DEFAULT_STEP1_TASK),
                running: false,
                sessionId: undefined,
                error: '已取消',
                updatedAt: completedAt,
              },
              status: 'idle',
            });
          } else if (task.type === 'step3-batch') {
            next = updateChapterById(next, task.projectId, task.chapterId, {
              step3Task: {
                ...(chapter.step3Task ?? DEFAULT_STEP3_TASK),
                running: false,
                sessionId: undefined,
                stopRequested: true,
                stopped: true,
                currentLabel: null,
                error: '已停止',
                updatedAt: completedAt,
              },
            });
          } else if (task.type === 'step4-batch') {
            next = updateChapterById(next, task.projectId, task.chapterId, {
              autoGenerate: {
                ...chapter.autoGenerate,
                running: false,
                currentIndex: -1,
                cancelled: true,
                retryNotice: undefined,
                stopReason: 'cancelled',
              },
              storyboards: chapter.storyboards.map(cancelBusyStoryboardAndKeepRecoverablePlan),
            });
          } else if (task.type === 'step5-batch') {
            next = updateGlobalTaskById(next, action.taskId, (item) => ({
              ...item,
              streamStageLabel: '视频任务已停止等待',
              streamStageStartedAt: undefined,
              streamStageLastActivityAt: undefined,
              streamStageTimeoutMs: undefined,
              streamStageTimeoutMode: undefined,
              streamTextPreview: '',
              streamUpdatedAt: completedAt,
              updatedAt: completedAt,
            }));
          }
        }
      }
      return next;
    }
    case 'REMOVE_GLOBAL_TASK':
      return {
        ...state,
        globalTasks: state.globalTasks.filter((task) => task.id !== action.taskId || task.status === 'running'),
      };
    case 'CLEAR_FINISHED_GLOBAL_TASKS':
      return {
        ...state,
        globalTasks: state.globalTasks.filter((task) => task.status === 'queued' || task.status === 'running'),
      };
    case 'START_AUTO_GENERATE':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        const next = updateChapterById(state, target.projectId, target.chapterId, {
          autoGenerate: {
            running: true, currentIndex: -1, total: action.total,
            doneCount: 0, errors: [], cancelled: false,
            retryNotice: undefined,
            sessionId: action.sessionId,
            startedAt: action.startedAt,
            stopReason: undefined,
          },
        });
        return updateMatchingStep4GlobalTask(next, target, action.sessionId, (task) => ({
          ...task,
          status: 'running',
          currentIndex: -1,
          total: action.total,
          doneCount: 0,
          errors: [],
          retryNotice: undefined,
          streamStoryboardIndex: undefined,
          streamPhase: undefined,
          streamStageLabel: undefined,
          streamStageStartedAt: undefined,
          streamStageLastActivityAt: undefined,
          streamStageTimeoutMs: undefined,
          streamStageTimeoutMode: undefined,
          streamTextPreview: '',
          streamTextLength: 0,
          streamUpdatedAt: undefined,
          streamPreviousStageLabel: undefined,
          streamPreviousTextLength: undefined,
          streamPreviousUpdatedAt: undefined,
          startedAt: action.startedAt ?? task.startedAt ?? Date.now(),
          completedAt: undefined,
          stopReason: undefined,
          updatedAt: Date.now(),
          eventLog: appendGlobalTaskEvent(task, createGlobalTaskEvent('info', '任务开始')).eventLog,
        }));
      })();
    case 'UPDATE_AUTO_GENERATE': {
      const target = resolveActionChapterTarget(state, action);
      if (!target) return state;
      const proj = state.projects.find((p) => p.id === target.projectId);
      const chapter = proj?.chapters.find((c) => c.id === target.chapterId);
      if (!chapter) return state;
      const next = updateChapterById(state, target.projectId, target.chapterId, {
        autoGenerate: { ...chapter.autoGenerate, ...action.updates },
      });
      const picked = pickGlobalTaskAutoGenerateUpdates(action.updates);
      if (Object.keys(picked).length === 0) return next;
      return updateMatchingStep4GlobalTask(next, target, chapter.autoGenerate.sessionId, (task) => {
        const updated = applyGlobalTaskUpdates(task, picked);
        if (!picked.retryNotice) return updated;
        return {
          ...appendGlobalTaskEvent(
            updated,
            createGlobalTaskEvent(
              'retry',
              `分镜${String(picked.retryNotice.index + 1).padStart(2, '0')} 自动重试`,
              picked.retryNotice.error,
              { storyboardIndex: picked.retryNotice.index, phase: 'step4' },
            ),
          ),
          updatedAt: Date.now(),
        };
      });
    }
    case 'END_AUTO_GENERATE': {
      const target = resolveActionChapterTarget(state, action);
      if (!target) return state;
      const proj = state.projects.find((p) => p.id === target.projectId);
      const chapter = proj?.chapters.find((c) => c.id === target.chapterId);
      if (!chapter) return state;
      const stopReason = action.stopReason ?? chapter.autoGenerate.stopReason;
      const next = updateChapterById(state, target.projectId, target.chapterId, {
        autoGenerate: { ...chapter.autoGenerate, running: false, stopReason: action.stopReason ?? chapter.autoGenerate.stopReason },
      });
      const completedAt = Date.now();
      return updateMatchingStep4GlobalTask(next, target, chapter.autoGenerate.sessionId, (task) => ({
        ...appendGlobalTaskEvent(
          task,
          getGlobalTaskFinishEvent(getGlobalTaskStatusFromStopReason(stopReason), stopReason),
        ),
        status: getGlobalTaskStatusFromStopReason(stopReason),
        currentIndex: -1,
        retryNotice: undefined,
        streamPhase: null,
        streamStageLabel: stopReason === 'failed' ? '已失败' : stopReason === 'cancelled' ? '已取消' : '已完成',
        streamStageStartedAt: undefined,
        streamStageLastActivityAt: undefined,
        streamStageTimeoutMs: undefined,
        streamStageTimeoutMode: undefined,
        completedAt,
        stopReason,
        updatedAt: completedAt,
      }));
    }
    case 'RESET_ALL_STORYBOARDS':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        const project = state.projects.find((item) => item.id === target.projectId);
        const chapter = project?.chapters.find((item) => item.id === target.chapterId);
        if (!project || !chapter) return state;
        const storyboards = chapter.storyboards.map((sb) => ({
          ...sb,
          ...STEP4_RESET_FIELDS,
        }));
        return updateChapterById(state, target.projectId, target.chapterId, {
          storyboards,
          globalLastFrameInfo: '',
          itemTracker: {},
        });
      })();

    case 'RESET_ERROR_STORYBOARDS':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        return updateStoryboardsById(state, target.projectId, target.chapterId, (sb) =>
          sb.status !== 'done' && sb.status !== 'pending'
            ? resetErrorStoryboardAndKeepRecoverableBoard(sb)
            : sb,
        );
      })();

    case 'CANCEL_BUSY_STORYBOARDS':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        return updateStoryboardsById(
          state,
          target.projectId,
          target.chapterId,
          cancelBusyStoryboardAndKeepRecoverablePlan,
        );
      })();

    case 'RECOVER_INTERRUPTED_STORYBOARDS':
      return (() => {
        const target = resolveActionChapterTarget(state, action);
        if (!target) return state;
        return updateStoryboardsById(
          state,
          target.projectId,
          target.chapterId,
          cancelBusyStoryboardAndKeepRecoverablePlan,
        );
      })();

    // ---- BGM / 音效 / 混音 ----
    case 'SET_CHAPTER_BGM':
      return updateCurrentChapter(state, { bgm: action.bgm });
    case 'SET_STORYBOARD_BGM':
      return updateCurrentStoryboards(state, (sb, i) =>
        i === action.index
          ? {
              ...sb,
              audioMix: {
                ...sb.audioMix,
                ttsBlobKeys: sb.audioMix?.ttsBlobKeys ?? [],
                ttsLineSnapshots: sb.audioMix?.ttsLineSnapshots ?? [],
                sfxBlobKeys: sb.audioMix?.sfxBlobKeys ?? [],
                bgm: action.bgm,
              },
            }
          : sb,
      );
    case 'SET_CHAPTER_SPEAKER_VOICE_OVERRIDES':
      return updateCurrentChapter(state, { speakerVoiceOverrides: action.overrides });
    case 'SET_CHAPTER_DUBBING_ANALYSIS_LINES':
      return updateCurrentChapter(state, { dubbingAnalysisLines: action.lines });
    case 'SET_POST_PRODUCTION_STATE':
      return updateCurrentChapter(state, { postProduction: action.postProduction });
    case 'UPDATE_RENDER_JOB_STATE': {
      const project = state.projects.find((item) => item.id === state.currentProjectId);
      const chapter = project?.chapters.find((item) => item.id === project.currentChapterId);
      if (!chapter) return state;
      return updateCurrentChapter(state, {
        postProduction: {
          ...(chapter.postProduction ?? {
            version: 1,
            generatedAt: Date.now(),
            clips: [],
            voiceProfiles: {},
            subtitles: [],
            audioCues: [],
          }),
          renderJob: action.renderJob,
        },
      });
    }
    case 'SET_STORYBOARD_AUDIO_MIX':
      return updateCurrentStoryboards(state, (sb, i) =>
        i === action.index ? { ...sb, audioMix: action.audioMix } : sb,
      );
    case 'SET_TTS_BLOB_KEY':
      return updateCurrentStoryboards(state, (sb, i) => {
        if (i !== action.index) return sb;
        const ttsBlobKeys = [...(sb.audioMix?.ttsBlobKeys ?? [])];
        const ttsLineSnapshots = [...(sb.audioMix?.ttsLineSnapshots ?? [])];
        const ttsLineGeneration = [...(sb.audioMix?.ttsLineGeneration ?? [])];
        if (action.blobKey) {
          ttsBlobKeys[action.lineIndex] = action.blobKey;
          ttsLineSnapshots[action.lineIndex] = action.snapshot ?? ttsLineSnapshots[action.lineIndex] ?? null;
          ttsLineGeneration[action.lineIndex] = null;
        } else {
          ttsBlobKeys.splice(action.lineIndex, 1);
          ttsLineSnapshots.splice(action.lineIndex, 1);
          ttsLineGeneration.splice(action.lineIndex, 1);
        }
        const audioMix: StoryboardAudioMix = {
          ttsBlobKeys,
          ttsLineSnapshots,
          ttsLineGeneration,
          sfxBlobKeys: sb.audioMix?.sfxBlobKeys ?? [],
          bgm: sb.audioMix?.bgm,
          mixBlobKey: sb.audioMix?.mixBlobKey,
        };
        return { ...sb, audioMix };
      });
    case 'SET_TTS_LINE_GENERATION_STATE':
      return updateCurrentStoryboards(state, (sb, i) => {
        if (i !== action.index) return sb;
        const ttsLineGeneration = [...(sb.audioMix?.ttsLineGeneration ?? [])];
        ttsLineGeneration[action.lineIndex] = action.state;
        const audioMix: StoryboardAudioMix = {
          ttsBlobKeys: sb.audioMix?.ttsBlobKeys ?? [],
          ttsLineSnapshots: sb.audioMix?.ttsLineSnapshots ?? [],
          ttsLineGeneration,
          sfxBlobKeys: sb.audioMix?.sfxBlobKeys ?? [],
          bgm: sb.audioMix?.bgm,
          mixBlobKey: sb.audioMix?.mixBlobKey,
        };
        return { ...sb, audioMix };
      });
    case 'SET_SFX_BLOB_KEY': {
      return updateCurrentStoryboards(state, (sb, i) => {
        if (i !== action.index || !sb.prompt?.timeSegments) return sb;
        const newSegments = [...sb.prompt.timeSegments];
        newSegments[action.segmentIndex] = {
          ...newSegments[action.segmentIndex],
          soundEffectBlobKey: action.blobKey,
        };
        return {
          ...sb,
          prompt: { ...sb.prompt, timeSegments: newSegments },
        };
      });
    }

    // ---- 项目导入 ----
    case 'IMPORT_PROJECT': {
      const imported = action.project;
      const existingIndex = state.projects.findIndex((project) => project.id === imported.id);
      if (existingIndex >= 0) {
        return {
          ...state,
          projects: state.projects.map((project, index) => (index === existingIndex ? imported : project)),
          currentProjectId: imported.id,
        };
      }
      return {
        ...state,
        projects: [...state.projects, imported],
        currentProjectId: imported.id,
      };
    }
    case 'IMPORT_APP_STATE':
      return {
        ...action.state,
        currentProjectId: action.state.currentProjectId ?? action.state.projects[0]?.id ?? null,
      };

    default:
      return state;
  }
}

// ---------- Context ----------
export type PersistencePhase = 'idle' | 'saving' | 'saved' | 'error';

export interface PersistenceStatus {
  phase: PersistencePhase;
  hasHydrated: boolean;
  lastSavedAt?: number;
  saveRevision?: number;
  error?: string;
}

interface ProjectContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  persistenceStatus: PersistenceStatus;
  flushState: () => Promise<SaveAppStateResult | null>;
}

const ProjectContext = createContext<ProjectContextType | null>(null);

function isTerminalGlobalTaskStatus(status: GlobalTask['status']): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled';
}

function hasStoryboardPersistenceMilestone(
  previous: StoryboardState | undefined,
  current: StoryboardState,
): boolean {
  if (!previous) return isStoryboardPromptReady(current) || current.status === 'done' || current.status === 'error';

  if (!isStoryboardPromptReady(previous) && isStoryboardPromptReady(current)) return true;
  if (previous.status !== current.status && (current.status === 'done' || current.status === 'error')) return true;

  const selectedMode = getStoryboardBoardSelectedMode(current.storyboardBoard ?? previous.storyboardBoard);
  const previousVariant = getStoryboardBoardVariant(previous.storyboardBoard, selectedMode);
  const currentVariant = getStoryboardBoardVariant(current.storyboardBoard, selectedMode);
  if (currentVariant?.planStatus === 'done' && previousVariant?.planStatus !== 'done') return true;
  if (currentVariant?.planStatus === 'failed' && previousVariant?.planStatus !== 'failed') return true;
  if (currentVariant?.status === 'done' && previousVariant?.status !== 'done') return true;
  if (currentVariant?.status === 'failed' && previousVariant?.status !== 'failed') return true;

  if (current.seedanceFinalVideoPromptStatus === 'done' && previous.seedanceFinalVideoPromptStatus !== 'done') return true;
  if (current.seedanceFinalVideoPromptStatus === 'failed' && previous.seedanceFinalVideoPromptStatus !== 'failed') return true;

  if (current.videoStatus === 'done') {
    if (previous.videoStatus !== 'done') return true;
    if (previous.videoUrl !== current.videoUrl) return true;
    if (previous.videoBlobKey !== current.videoBlobKey) return true;
    if (previous.videoCompletedAt !== current.videoCompletedAt) return true;
  }
  if (current.videoStatus === 'failed' && previous.videoStatus !== 'failed') return true;

  return false;
}

function hasStep4PersistenceMilestone(previous: AppState | null, current: AppState): boolean {
  if (!previous) return false;

  for (const currentTask of current.globalTasks) {
    const previousTask = previous.globalTasks.find((task) => task.id === currentTask.id);
    if (!previousTask) continue;
    if (currentTask.doneCount > previousTask.doneCount) return true;
    if (currentTask.errors.length > previousTask.errors.length) return true;
    if (currentTask.status !== previousTask.status && isTerminalGlobalTaskStatus(currentTask.status)) return true;
  }

  for (const currentProject of current.projects) {
    const previousProject = previous.projects.find((project) => project.id === currentProject.id);
    if (!previousProject) continue;

    for (const currentChapter of currentProject.chapters) {
      const previousChapter = previousProject.chapters.find((chapter) => chapter.id === currentChapter.id);
      if (!previousChapter) continue;

      if ((currentChapter.autoGenerate.doneCount ?? 0) > (previousChapter.autoGenerate.doneCount ?? 0)) return true;
      if ((currentChapter.autoGenerate.errors?.length ?? 0) > (previousChapter.autoGenerate.errors?.length ?? 0)) return true;
      if (previousChapter.autoGenerate.running && !currentChapter.autoGenerate.running) return true;

      for (let index = 0; index < currentChapter.storyboards.length; index += 1) {
        if (hasStoryboardPersistenceMilestone(previousChapter.storyboards[index], currentChapter.storyboards[index])) {
          return true;
        }
      }
    }
  }

  return false;
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(projectReducer, undefined, createInitialState);
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>({ phase: 'idle', hasHydrated: false });
  const stateRef = useRef(state);
  const saveTimerRef = useRef<number | null>(null);
  const hasHydratedRef = useRef(false);
  const saveRequestIdRef = useRef(0);
  const previousStateForSaveRef = useRef<AppState | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!hasHydratedRef.current) return;
    const target = findStoryboardBoardModeMismatchTarget(state);
    if (!target) return;
    dispatch({
      type: 'SET_STORYBOARD_BOARD_MODE',
      mode: target.mode,
      projectId: target.projectId,
      chapterId: target.chapterId,
    });
  }, [state]);

  const persistState = useCallback(() => {
    if (!hasHydratedRef.current) return Promise.resolve(null);
    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;
    setPersistenceStatus((current) => ({
      ...current,
      phase: 'saving',
      error: undefined,
    }));

    return queueSaveAppState(stateRef.current).then((result) => {
      if (requestId === saveRequestIdRef.current) {
        setPersistenceStatus({
          phase: result.ok ? 'saved' : 'error',
          hasHydrated: hasHydratedRef.current,
          lastSavedAt: result.ok ? Date.now() : undefined,
          saveRevision: result.saveRevision,
          error: result.ok
            ? undefined
            : result.error instanceof Error
              ? result.error.message
              : String(result.error ?? '保存失败'),
        });
      }
      if (!result.ok && import.meta.env.DEV) {
        console.warn('[storage] 保存到 IndexedDB 失败', result.error);
      }
      return result;
    });
  }, []);

  const flushState = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    return persistState();
  }, [persistState]);

  const scheduleStateSave = useCallback(() => {
    if (!hasHydratedRef.current) return;
    if (saveTimerRef.current !== null) return;
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      persistState();
    }, 1000);
  }, [persistState]);

  useEffect(() => {
    let cancelled = false;
    void loadAppState()
      .then((result) => {
        if (cancelled) return;
        hasHydratedRef.current = true;
        setPersistenceStatus((current) => ({ ...current, hasHydrated: true }));
        dispatch({ type: 'HYDRATE_STATE', state: result.state });
      })
      .catch((error) => {
        if (import.meta.env.DEV) {
          console.warn('[storage] IndexedDB 状态恢复失败，继续使用同步 fallback 状态', error);
        }
        hasHydratedRef.current = true;
        setPersistenceStatus((current) => ({ ...current, hasHydrated: true }));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const previousState = previousStateForSaveRef.current;
    previousStateForSaveRef.current = state;
    if (!hasHydratedRef.current) return;

    if (hasStep4PersistenceMilestone(previousState, state)) {
      window.setTimeout(() => {
        void flushState();
      }, 0);
      return;
    }

    scheduleStateSave();
  }, [flushState, scheduleStateSave, state]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return;
    void navigator.storage.persist().catch(() => undefined);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushState();
      }
    };

    window.addEventListener('pagehide', flushState);
    window.addEventListener('beforeunload', flushState);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      flushState();
      window.removeEventListener('pagehide', flushState);
      window.removeEventListener('beforeunload', flushState);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [flushState]);

  return (
    <ProjectContext.Provider value={{ state, dispatch, persistenceStatus, flushState }}>
      {children}
    </ProjectContext.Provider>
  );
}

// ---------- Hook ----------
export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
}

/**
 * 便捷 hook：返回当前项目、当前章节及 store 上下文
 * 替代各组件中重复的 projects.find → chapters.find 模式
 */
export function useCurrentProject() {
  const { state, dispatch, persistenceStatus, flushState } = useProject();
  const currentProject =
    state.projects.find((p) => p.id === state.currentProjectId) ?? null;
  const currentChapter = currentProject
    ? currentProject.chapters.find((c) => c.id === currentProject.currentChapterId) ?? null
    : null;

  return { state, dispatch, currentProject, currentChapter, persistenceStatus, flushState };
}
