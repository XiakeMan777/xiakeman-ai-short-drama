// ============================================================
// 步骤4: 分镜提示词生成器 - 完整流程
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertCircle,
  FileText,
  ImageIcon,
  Play,
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
  Download,
  RotateCcw,
  Square,
  DownloadCloud,
  Pencil,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Grid3x3,
  GripVertical,
  ListChecks,
} from '@/components/icons';
import { useCurrentProject } from '@/stores/projectStore';
import { useConfirm } from '@/hooks/useConfirmPrompt';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useStoryboardGenerationRuntime } from './StoryboardGenerationContext';
import { useStoryboardExport } from './useStoryboardExport';
import { useLogicFixEditor } from './useLogicFixEditor';
import { usePromptEditor } from './usePromptEditor';
import { useStoryboardNavigation } from './useStoryboardNavigation';
import { useStoryboardBoardGeneration } from './useStoryboardBoardGeneration';
import { StoryboardBoardCard } from './StoryboardBoardCard';
import { isRecoverableInterruptedStoryboard, isStep4BusyStatus } from './recoverySignature';
import { useScenePositionBoardGeneration } from './useScenePositionBoardGeneration';
import { ScenePositionBoardCard } from './ScenePositionBoardCard';
import { ActiveStreamCard } from './ActiveStreamCard';
import { getActiveStreamStageLabel } from './activeStreamPreview';
import { resolveStoryboardImageRefs } from './storyboardReferenceResolver';
import { runSelfCheck } from '@/lib/self-check';
import {
  getSupportedImageSizesForConfig,
  hasEffectiveImageApiKey,
  normalizeImageSizeForConfig,
} from '@/lib/imageApiClient';
import { getMissingImageReferenceLabels, isStoryboardPromptReady } from '@/lib/storyboardReadiness';
import { DEFAULT_STEP4_OUTPUT_MODE, DEFAULT_STORYBOARD_BOARD_STYLE, DEFAULT_STORYBOARD_DIRECTOR_RUN_MODE } from '@/lib/storage';
import { DEFAULT_STORYBOARD_BOARD_MODE, getStoryboardBoardSelectedMode, getStoryboardBoardVariant, mergeStoryboardBoardVariant } from '@/lib/storyboardBoardState';
import { sanitizeStoryboardCharacters } from '@/lib/storyboardCharacterSanitizer';
import {
  formatStoryboardDurationSeconds,
  getStoryboardStep4VideoDurationSeconds,
} from '@/lib/storyboardDuration';
import { buildStoryboardSourceContexts, resolveStoryboardSourceScriptText } from '@/lib/storyboardSource';
import {
  getOfficialVirtualHumanIncompatibleMessage,
  isOfficialVirtualHumanCompatibleVideoBackend,
} from '@/lib/officialVirtualHumanVideoMode';
import { isCharacterAssetAllowedForImageRef } from '@/lib/characterReferenceUtils';
import {
  buildStep4FailureHint,
  getDiagnosticStyles,
  getStep4PhaseLabel,
  hasOfficialVirtualHumanTemplateMatch,
  isLegacySceneSchema,
  isStep4GenerationActionBusy,
  isStoryboardBusy,
} from './promptGeneratorUtils';
import { useAssetThumbnail } from '@/components/step3/useAssetThumbnail';
import { cn } from '@/lib/utils';
import {
  formatSmartStoryboardPanelCountPreference,
  normalizeSmartStoryboardPanelCountPreference,
} from '@/lib/smartStoryboardPanelCount';
import {
  DEFAULT_STORYBOARD_CAMERA_SEGMENT_COUNT,
  MAX_STORYBOARD_CAMERA_SEGMENT_COUNT,
  MIN_STORYBOARD_CAMERA_SEGMENT_COUNT,
  normalizeStoryboardCameraSegmentPreference,
  resolveStoryboardCameraSegmentCount,
} from '@/lib/storyboardCameraSegments';
import type { Asset, ImageReference, ImageSize, Step4OutputMode, StoryboardBoardMode, StoryboardCameraSegmentPreference, SmartStoryboardPanelCountPreference, StoryboardDirectorRunMode, StoryboardState } from '@/types';

const EMPTY_STORYBOARD_STATE: StoryboardState = {
  storyboard: {
    number: 0,
    name: '',
    duration: '',
    shotSize: '',
    characters: [],
  },
  logicFixes: [],
  correctedScript: '',
  sceneBlueprint: null,
  choreography: null,
  imageRefs: [],
  prompt: null,
  selfCheckResult: null,
  lastFrameInfo: '',
  spatialBlocking: undefined,
  status: 'pending',
};
const EMPTY_STORYBOARDS: StoryboardState[] = [];

type Step4QueuePosition = {
  left: number;
  bottom: number;
};

type Step4QueueDragState = {
  startX: number;
  startY: number;
  offsetX: number;
  offsetBottom: number;
  width: number;
  height: number;
};

type CurrentStepRetryKind =
  | 'full-storyboard'
  | 'storyboard-board-image'
  | 'seedance-final-prompt';

interface CurrentStepRetryAction {
  kind: CurrentStepRetryKind;
  label: string;
}

const STORYBOARD_BOARD_MODE_OPTIONS: Array<{
  value: Extract<StoryboardBoardMode, 'shot-plan-landscape' | 'smart-shot-plan-landscape'>;
  label: string;
  shortLabel: string;
  hint: string;
  title: string;
}> = [
  {
    value: 'shot-plan-landscape',
    label: '固定15宫格',
    shortLabel: '15宫格',
    hint: '稳定版 Shot Sheet',
    title: '继续使用现有多轮优化过的固定15宫格后端模板。',
  },
  {
    value: 'smart-shot-plan-landscape',
    label: '智能故事板',
    shortLabel: '智能',
    hint: '自动6/9/12/15格',
    title: '使用固定15宫格模板的副本分支，根据分镜节奏选择6、9、12或15格。',
  },
];

const SMART_STORYBOARD_PANEL_COUNT_OPTIONS: Array<{
  value: SmartStoryboardPanelCountPreference;
  label: string;
  title: string;
}> = [
  {
    value: 'auto',
    label: '自动',
    title: '由导演阐述根据剧情节奏自动选择 6、9、12 或 15 格。',
  },
  {
    value: 6,
    label: '6格',
    title: '手动锁定智能故事板为 6 格，适合短促、动作点少的镜头。',
  },
  {
    value: 9,
    label: '9格',
    title: '手动锁定智能故事板为 9 格，适合中等节奏和中等动作密度。',
  },
  {
    value: 12,
    label: '12格',
    title: '手动锁定智能故事板为 12 格，适合较复杂但不需要完整 15 格的镜头。',
  },
];

const STEP4_BATCH_QUEUE_POSITION_KEY = 'xiakeman.step4BatchQueue.position';
const SHOW_LEGACY_STEP4_BATCH_QUEUE_PANEL = false;

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function readStoredStep4QueuePosition(): Step4QueuePosition | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STEP4_BATCH_QUEUE_POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Step4QueuePosition>;
    if (typeof parsed.left !== 'number' || typeof parsed.bottom !== 'number') return null;
    return parsed.left >= 0 && parsed.bottom >= 0
      ? { left: parsed.left, bottom: parsed.bottom }
      : null;
  } catch {
    return null;
  }
}

function storeStep4QueuePosition(position: Step4QueuePosition) {
  try {
    window.localStorage.setItem(STEP4_BATCH_QUEUE_POSITION_KEY, JSON.stringify(position));
  } catch {
    // Dragging should keep working even if local storage is unavailable.
  }
}

function formatSaveTime(timestamp?: number) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getReferenceTypeLabel(type: ImageReference['type']) {
  if (type === 'scene') return '场景';
  if (type === 'prop') return '道具';
  return '角色';
}
function getReferenceTypeIcon(type: ImageReference['type']) {
  if (type === 'scene') return '📍';
  if (type === 'prop') return '🎒';
  return '👤';
}

function ImageReferenceCard({
  imageRef,
  asset,
  projectId,
}: {
  imageRef: ImageReference;
  asset: Asset | null;
  projectId?: string;
}) {
  const thumbnailUrl = useAssetThumbnail(asset, undefined, projectId);
  const isBound = !!asset;

  return (
    <div className={`overflow-hidden rounded-xl border bg-background/75 shadow-sm transition-colors ${
      isBound
        ? 'border-green-200/80 dark:border-green-400/25'
        : 'border-amber-200/80 dark:border-amber-400/25'
    }`}>
      <div className="relative aspect-[4/3] bg-muted/60">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={`${imageRef.refId} ${imageRef.name}`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
          </div>
        )}
        <Badge className="absolute left-1.5 top-1.5 h-5 rounded-full bg-black/70 px-1.5 font-mono text-[10px] text-white hover:bg-black/70">
          {imageRef.refId}
        </Badge>
        <Badge className={`absolute right-1.5 top-1.5 h-5 rounded-full px-1.5 text-[10px] ${
          isBound
            ? 'bg-green-600 text-white hover:bg-green-600'
            : 'bg-amber-500 text-white hover:bg-amber-500'
        }`}>
          {isBound ? '已绑定' : '缺图'}
        </Badge>
      </div>
      <div className="space-y-1 px-2.5 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <span aria-hidden="true">{getReferenceTypeIcon(imageRef.type)}</span>
          <span className="truncate">{imageRef.name}</span>
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{getReferenceTypeLabel(imageRef.type)}</span>
          {asset?.imageSize && <span className="font-mono">{asset.imageSize}</span>}
        </div>
      </div>
    </div>
  );
}
type BatchTaskTone = 'done' | 'active' | 'waiting' | 'queued' | 'error' | 'stale';

const BATCH_TASK_TONE_CLASS: Record<BatchTaskTone, string> = {
  done: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-50',
  active: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-400/25 dark:bg-blue-500/10 dark:text-blue-50',
  waiting: 'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-400/25 dark:bg-violet-500/10 dark:text-violet-50',
  queued: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
  error: 'border-red-200 bg-red-50 text-red-900 dark:border-red-400/25 dark:bg-red-500/10 dark:text-red-50',
  stale: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-50',
};

function getBatchTaskView(storyboard: StoryboardState): {
  label: string;
  detail: string;
  tone: BatchTaskTone;
  spinning: boolean;
} {
  const selectedMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
  const boardVariant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedMode);
  const hasContinuityForNext = !!(
    storyboard.continuityOutput?.lastFrameInfo?.trim()
    || storyboard.lastFrameInfo?.trim()
  );
  const isBoardImageGenerating = boardVariant?.status === 'generating';
  const isSeedancePromptGenerating = storyboard.seedanceFinalVideoPromptStatus === 'generating';
  const isSeedancePromptDone = storyboard.seedanceFinalVideoPromptStatus === 'done';
  const isSeedancePromptFailed = storyboard.seedanceFinalVideoPromptStatus === 'failed';
  const missingReferenceLabels = getMissingImageReferenceLabels(storyboard.imageRefs);

  if (missingReferenceLabels.length > 0) {
    return {
      label: '缺参考图',
      detail: `缺少 ${missingReferenceLabels.length} 张 Step3 参考图，当前镜头被阻塞`,
      tone: 'error',
      spinning: false,
    };
  }
  if (storyboard.status === 'error') {
    return { label: '生成失败', detail: storyboard.error ?? '需要重新生成', tone: 'error', spinning: false };
  }
  if (storyboard.status === 'generating' && hasContinuityForNext) {
    if (isBoardImageGenerating && isSeedancePromptGenerating) {
      return {
        label: '图片 + 提交词',
        detail: '高质量规划已完成，图片与 Seedance 提交词并行生成',
        tone: 'waiting',
        spinning: true,
      };
    }
    if (isBoardImageGenerating) {
      const detail = isSeedancePromptDone
        ? 'Seedance 提交词已完成，等待图片返回'
        : isSeedancePromptFailed
        ? '提交词失败，可稍后单独刷新；图片仍在生成'
        : '连续性文本已就绪，图片生成中';
      return { label: '图片生成中', detail, tone: 'waiting', spinning: true };
    }
    if (isSeedancePromptGenerating) {
      return {
        label: '排队 + 提交词',
        detail: '规划已完成，等待图片通道；提交词正在回流',
        tone: 'waiting',
        spinning: true,
      };
    }
    return {
      label: '等待图片通道',
      detail: '连续性文本已就绪，下一镜可推进',
      tone: 'waiting',
      spinning: true,
    };
  }
  if (isSeedancePromptGenerating) {
    return { label: 'Seedance 提交词', detail: '最终视频词正在回流', tone: 'active', spinning: true };
  }
  if (isStoryboardPromptReady(storyboard)) {
    const detail = storyboard.seedanceFinalVideoPromptStatus === 'done'
      ? '故事板与提交词已完成'
      : storyboard.seedanceFinalVideoPromptStatus === 'failed'
      ? '故事板完成，提交词可单独刷新'
      : '故事板已完成';
    return { label: '已完成', detail, tone: 'done', spinning: false };
  }
  if (storyboard.isStale) {
    return { label: '待刷新', detail: '上游内容变更后需要重新生成', tone: 'stale', spinning: false };
  }
  if (isStoryboardBusy(storyboard.status)) {
    return { label: getStep4PhaseLabel(storyboard.status), detail: '文本链路执行中', tone: 'active', spinning: true };
  }
  return { label: '等待队列', detail: '等待上一镜连续性文本', tone: 'queued', spinning: false };
}

function getBatchStageCounts(storyboards: readonly StoryboardState[]) {
  return storyboards.reduce((counts, storyboard) => {
    const selectedMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
    const boardVariant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedMode);
    const hasContinuityForNext = !!(
      storyboard.continuityOutput?.lastFrameInfo?.trim()
      || storyboard.lastFrameInfo?.trim()
    );

    if (isStoryboardPromptReady(storyboard)) counts.done += 1;
    if (isStoryboardBusy(storyboard.status) && !(storyboard.status === 'generating' && hasContinuityForNext)) {
      counts.text += 1;
    }
    if (storyboard.status === 'generating' && hasContinuityForNext && boardVariant?.status !== 'generating' && !isStoryboardPromptReady(storyboard)) {
      counts.imageQueued += 1;
    }
    if (boardVariant?.status === 'generating') counts.image += 1;
    if (storyboard.seedanceFinalVideoPromptStatus === 'generating') counts.seedance += 1;
    if (storyboard.status === 'error') counts.error += 1;
    return counts;
  }, {
    text: 0,
    imageQueued: 0,
    image: 0,
    seedance: 0,
    done: 0,
    error: 0,
  });
}

export function PromptGenerator() {
  const { state, dispatch, currentProject, currentChapter: chapter, persistenceStatus } = useCurrentProject();
  const { confirm, ConfirmDialog } = useConfirm();

  const allStoryboards = chapter?.storyboards ?? EMPTY_STORYBOARDS;
  const analysis = chapter?.analysis ?? null;
  const currentStoryboardIndex = chapter?.currentStoryboardIndex ?? 0;
  const autoGenerate = chapter?.autoGenerate ?? {
    running: false, currentIndex: -1, total: 0, doneCount: 0, errors: [], cancelled: false,
  };
  const canUndo = (chapter?.past?.length ?? 0) > 0;
  const canRedo = (chapter?.future?.length ?? 0) > 0;
  const total = allStoryboards.length;
  const currentIndex = total > 0 ? Math.min(currentStoryboardIndex, total - 1) : 0;
  const currentSb = allStoryboards[currentIndex] ?? EMPTY_STORYBOARD_STATE;
  const currentStep4Ready = isStoryboardPromptReady(currentSb);
  const currentStep4DurationSeconds = getStoryboardStep4VideoDurationSeconds(currentSb);
  const step4OutputMode: Step4OutputMode = chapter?.step4OutputMode ?? currentSb.step4OutputMode ?? DEFAULT_STEP4_OUTPUT_MODE;
  const isStoryboardDirectorMode = step4OutputMode === 'storyboard-director';
  const chapterStoryboardBoardMode = chapter?.storyboardBoardMode ?? DEFAULT_STORYBOARD_BOARD_MODE;
  const smartPanelCountPreference = normalizeSmartStoryboardPanelCountPreference(chapter?.storyboardBoardSmartPanelCount);
  const smartDurationCompressionEnabled = chapter?.storyboardBoardSmartDurationCompressionEnabled !== false;
  const storyboardCameraSegmentPreference = normalizeStoryboardCameraSegmentPreference(chapter?.storyboardCameraSegmentCount);
  const storyboardCameraSegmentCount = resolveStoryboardCameraSegmentCount(storyboardCameraSegmentPreference, currentSb);
  const currentStoryboardDurationLabel = currentStep4DurationSeconds
    ? `${formatStoryboardDurationSeconds(currentStep4DurationSeconds)} · ${chapterStoryboardBoardMode === 'smart-shot-plan-landscape' && !smartDurationCompressionEnabled ? '原时长' : '智能时长'}`
    : (currentSb.storyboard.duration || '时长未填写');
  const activeStoryboardBoardModeOption = STORYBOARD_BOARD_MODE_OPTIONS.find((option) => option.value === chapterStoryboardBoardMode)
    ?? STORYBOARD_BOARD_MODE_OPTIONS[0];
  const activeStoryboardBoardLabel = chapterStoryboardBoardMode === 'smart-shot-plan-landscape'
    ? `智能${formatSmartStoryboardPanelCountPreference(smartPanelCountPreference)}${smartDurationCompressionEnabled ? '' : ' · 原时长'}`
    : activeStoryboardBoardModeOption.label;
  const storyboardDirectorRunMode: StoryboardDirectorRunMode = chapter?.storyboardDirectorRunMode ?? DEFAULT_STORYBOARD_DIRECTOR_RUN_MODE;
  const imageGenerationReady = hasEffectiveImageApiKey(state.imageApiConfig, state.videoApiConfig);
  const isStoryboardDirectorImageKeyMissing = isStoryboardDirectorMode && !imageGenerationReady;
  const outputUnitLabel = isStoryboardDirectorMode ? '故事板' : '提示词';
  const outputBatchLabel = isStoryboardDirectorMode ? '本集全部故事板' : '本集全部提示词';
  const currentOutputLabel = isStoryboardDirectorMode ? '当前故事板' : '当前镜头';
  const currentStep4ActionLabel = currentSb.status === 'done' || currentSb.status === 'error' || currentSb.isStale
    ? `重新生成${currentOutputLabel}`
    : `生成${currentOutputLabel}`;
  const [batchQueueCollapsed, setBatchQueueCollapsed] = useState(false);
  const [batchQueuePosition, setBatchQueuePosition] = useState<Step4QueuePosition | null>(() => readStoredStep4QueuePosition());
  const batchQueueRef = useRef<HTMLDivElement>(null);
  const batchQueueDragRef = useRef<Step4QueueDragState | null>(null);
  const batchQueueMovedRef = useRef(false);
  const suppressBatchQueueClickRef = useRef(false);

  // ---------- Hooks ----------
  const {
    handleGenerateFull,
    handleAutoGenerate,
    handleQueueAutoGenerate,
    handleCancelBatch,
    abortStep4BackgroundRequests,
    clearActiveStreamState,
    apiLoading,
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
  } = useStoryboardGenerationRuntime();
  const isCurrentChapterActiveStream = !!activeStreamTarget
    && activeStreamTarget.projectId === currentProject?.id
    && activeStreamTarget.chapterId === chapter?.id;
  const currentChapterApiLoading = apiLoading && isCurrentChapterActiveStream;
  const isCurrentStoryboardActiveStream = isCurrentChapterActiveStream
    && activeStreamTarget?.storyboardIndex === currentIndex
    && !!activeStreamPhase;
  const {
    isRenaming,
    setIsRenaming,
    renameValue,
    setRenameValue,
    startRename,
    saveRename,
    goPrev,
    goNext,
    goToIndex,
  } = useStoryboardNavigation(allStoryboards, currentIndex, total, autoGenerate.running || currentChapterApiLoading ? undefined : resetApi);
  const { handleCopy, handleDownload, handleExportAll } = useStoryboardExport(allStoryboards, analysis, currentIndex);
  const {
    editFixIdx,
    editFixForm,
    setEditFixForm,
    startEditFix,
    saveEditFix,
    cancelEditFix,
    deleteFix,
    addFix,
  } = useLogicFixEditor(currentSb, currentIndex, confirm);
  const {
    isEditingPrompt,
    editedPromptText,
    setEditedPromptText,
    startEditPrompt,
    cancelEditPrompt,
    saveEditPrompt,
  } = usePromptEditor(currentSb, currentIndex);
  const {
    boardState,
    selectedMode,
    modeConfig,
    previewUrl,
    visualPreviewUrl,
    storyboardBoardReferenceEnabled,
    boardPromptPreview,
    boardPlanPreview,
    seedanceFinalPromptPreview,
    seedanceFinalPromptState,
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
    isOptimizingPlan,
    isGenerating,
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
  } = useStoryboardBoardGeneration(currentSb, currentIndex, {
    isCurrentStoryboardGenerationActive: isCurrentStoryboardActiveStream,
  });
  const {
    board: scenePositionBoard,
    previewUrl: scenePositionBoardPreviewUrl,
    points: scenePositionBoardPoints,
    hasFreshBoard: hasFreshScenePositionBoard,
    hasFreshSceneMaster,
    sceneMaster,
    sceneMasterViewLabel,
    disabledReason: scenePositionBoardDisabledReason,
    isGenerating: isGeneratingScenePositionBoard,
    generateBoard: generateScenePositionBoard,
    nudgePoint: nudgeScenePositionBoardPoint,
    clearBoard: clearScenePositionBoard,
    downloadBoard: downloadScenePositionBoard,
  } = useScenePositionBoardGeneration(currentSb, currentIndex);

  useEffect(() => {
    if (!SHOW_LEGACY_STEP4_BATCH_QUEUE_PANEL || !autoGenerate.running || batchQueuePosition) return;
    const frame = window.requestAnimationFrame(() => {
      const rect = batchQueueRef.current?.getBoundingClientRect();
      const width = rect?.width ?? 380;
      setBatchQueuePosition({
        left: Math.max(12, window.innerWidth - width - 16),
        bottom: 16,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoGenerate.running, batchQueuePosition]);

  useEffect(() => {
    if (!batchQueuePosition) return;
    storeStep4QueuePosition(batchQueuePosition);
  }, [batchQueuePosition]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = batchQueueDragRef.current;
      if (!dragState) return;
      const moved = Math.abs(event.clientX - dragState.startX) + Math.abs(event.clientY - dragState.startY) > 4;
      if (!moved && !batchQueueMovedRef.current) return;
      batchQueueMovedRef.current = true;

      const maxLeft = Math.max(12, window.innerWidth - dragState.width - 12);
      const maxBottom = Math.max(12, window.innerHeight - dragState.height - 12);
      setBatchQueuePosition({
        left: clampNumber(event.clientX - dragState.offsetX, 12, maxLeft),
        bottom: clampNumber(window.innerHeight - event.clientY - dragState.offsetBottom, 12, maxBottom),
      });
    };

    const handlePointerUp = () => {
      if (batchQueueMovedRef.current) {
        suppressBatchQueueClickRef.current = true;
        window.setTimeout(() => {
          suppressBatchQueueClickRef.current = false;
        }, 0);
      }
      batchQueueDragRef.current = null;
      batchQueueMovedRef.current = false;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  const startBatchQueueDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const rect = batchQueueRef.current?.getBoundingClientRect();
    if (!rect) return;
    batchQueueDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetBottom: rect.bottom - event.clientY,
      width: rect.width,
      height: rect.height,
    };
    batchQueueMovedRef.current = false;
  };

  const currentPromptRawText = currentSb.prompt?.rawText ?? '';
  const resolvedStoryboardRefs = useMemo(
    () => allStoryboards.map((storyboard, index) =>
      resolveStoryboardImageRefs(storyboard, analysis, currentProject?.assetLibrary, index, state.videoApiConfig.videoRatio),
    ),
    [allStoryboards, analysis, currentProject?.assetLibrary, state.videoApiConfig.videoRatio],
  );
  const currentResolvedImageRefs = resolvedStoryboardRefs[currentIndex] ?? currentSb.imageRefs;
  const currentDisplayCharacters = useMemo(
    () => sanitizeStoryboardCharacters(currentSb.storyboard.characters, {
      allowedNames: [
        ...(analysis?.allCharacterNames ?? []),
        ...(analysis?.characterProfiles ?? []).map((profile) => profile.name),
        ...(currentProject?.assetLibrary ?? [])
          .filter((asset) => asset.type === 'character')
          .map((asset) => asset.name),
      ],
    }),
    [analysis?.allCharacterNames, analysis?.characterProfiles, currentProject?.assetLibrary, currentSb.storyboard.characters],
  );
  const displaySourceContext = useMemo(() => {
    if (!chapter) return null;
    const scriptText = resolveStoryboardSourceScriptText({
      scriptType: chapter.scriptType,
      rawScript: chapter.rawScript,
      adaptedScript: chapter.adaptedScript,
      analysisSourceText: chapter.analysisSourceText,
    });
    if (!scriptText.trim() || allStoryboards.length === 0) return null;
    return buildStoryboardSourceContexts(scriptText, allStoryboards.map((storyboard) => storyboard.storyboard))[currentIndex] ?? null;
  }, [allStoryboards, chapter, currentIndex]);
  const currentSourceExcerpt = currentSb.sourceExcerpt?.trim() || displaySourceContext?.sourceExcerpt || '';
  const currentSourceExcerptSummary = currentSb.sourceExcerptSummary?.trim() || displaySourceContext?.sourceExcerptSummary || '';
  const currentNextStoryboardSummary = currentSb.nextStoryboardSummary?.trim() || displaySourceContext?.nextStoryboardSummary || '';
  const liveSelfCheckResult = useMemo(() => {
    if (!currentPromptRawText) return currentSb.selfCheckResult;
    return runSelfCheck(
      currentPromptRawText,
      currentResolvedImageRefs,
      currentSb.videoImageBudget,
      currentSb.correctedScript,
      false,
      state.videoApiConfig.videoRatio,
    );
  }, [currentPromptRawText, currentResolvedImageRefs, currentSb.correctedScript, currentSb.selfCheckResult, currentSb.videoImageBudget, state.videoApiConfig.videoRatio]);
  const currentMissingReferenceLabels = useMemo(
    () => getMissingImageReferenceLabels(currentResolvedImageRefs),
    [currentResolvedImageRefs],
  );
  const missingReferenceStoryboards = useMemo(() => (
    allStoryboards
      .map((storyboard, index) => ({
        number: storyboard.storyboard.number,
        labels: getMissingImageReferenceLabels(resolvedStoryboardRefs[index] ?? storyboard.imageRefs),
      }))
      .filter((item) => item.labels.length > 0)
  ), [allStoryboards, resolvedStoryboardRefs]);
  const missingReferenceTotal = useMemo(
    () => missingReferenceStoryboards.reduce((total, item) => total + item.labels.length, 0),
    [missingReferenceStoryboards],
  );
  const currentErrorMessage = currentSb.error ?? null;
  const currentErrorHint = buildStep4FailureHint(currentErrorMessage ?? undefined);
  const currentBoardModeForRetry = getStoryboardBoardSelectedMode(currentSb.storyboardBoard);
  const currentBoardVariantForRetry = getStoryboardBoardVariant(currentSb.storyboardBoard, currentBoardModeForRetry);
  const currentStoryboardDirectorMode = isStoryboardDirectorMode
    || currentSb.generatedStep4OutputMode === 'storyboard-director'
    || currentSb.step4OutputMode === 'storyboard-director';
  const currentStepRetryAction = useMemo<CurrentStepRetryAction>(() => {
    const retryContext = [
      currentSb.error,
      currentSb.seedanceFinalVideoPromptError,
      currentBoardVariantForRetry?.error,
      currentBoardVariantForRetry?.planError,
    ].filter(Boolean).join('\n');
    const hasDirectorPlan = currentStoryboardDirectorMode
      && !!currentBoardVariantForRetry?.plan
      && currentBoardVariantForRetry.planStatus === 'done';
    const hasDirectorImage = currentStoryboardDirectorMode
      && currentBoardVariantForRetry?.status === 'done'
      && !!currentBoardVariantForRetry.blobKey;
    const seedanceFinalPromptFailed = hasDirectorPlan
      && hasDirectorImage
      && (
        currentSb.seedanceFinalVideoPromptStatus === 'failed'
        || /Seedance\s*最终|最终视频词|最终视频提示词|提交词/.test(retryContext)
      );
    if (seedanceFinalPromptFailed) {
      return { kind: 'seedance-final-prompt', label: '重试最终视频词' };
    }

    const storyboardBoardImageFailed = hasDirectorPlan
      && (
        currentBoardVariantForRetry?.status === 'failed'
        || /详细故事板生成|故事板图|图片生成|Shot Sheet 图片|15格图片/i.test(retryContext)
      );
    if (storyboardBoardImageFailed || (hasDirectorPlan && !hasDirectorImage)) {
      return { kind: 'storyboard-board-image', label: hasDirectorImage ? '重试故事板图' : '继续生成故事板图' };
    }

    if (currentStoryboardDirectorMode) {
      return { kind: 'full-storyboard', label: '重试导演规划' };
    }

    return { kind: 'full-storyboard', label: '重试当前步骤' };
  }, [
    currentBoardVariantForRetry,
    currentSb.error,
    currentSb.seedanceFinalVideoPromptError,
    currentSb.seedanceFinalVideoPromptStatus,
    currentStoryboardDirectorMode,
  ]);
  const assetById = useMemo(
    () => new Map((currentProject?.assetLibrary ?? []).map((asset) => [asset.id, asset])),
    [currentProject?.assetLibrary],
  );
  const hasLiveCurrentStep4Generation = isCurrentStoryboardActiveStream
    || isGenerating
    || isOptimizingPlan
    || isGeneratingScenePositionBoard;
  const currentStoryboardBusyRecoverable = isRecoverableInterruptedStoryboard(currentSb, {
    hasLiveGeneration: hasLiveCurrentStep4Generation,
  });
  const canRecoverCurrentStoryboard = currentSb.status === 'error'
    || currentSb.seedanceFinalVideoPromptStatus === 'failed'
    || boardState?.status === 'failed'
    || boardState?.planStatus === 'failed'
    || (!currentChapterApiLoading && currentStoryboardBusyRecoverable);
  const currentStoryboardStatusForBusy = currentStoryboardBusyRecoverable ? null : currentSb.status;
  const staleCount = allStoryboards.filter((storyboard) => storyboard.isStale).length;
  const legacySceneMasterCount = useMemo(
    () => Object.values(chapter?.sceneSpatialMasters ?? {}).filter((master) => isLegacySceneSchema(master.schemaVersion)).length,
    [chapter?.sceneSpatialMasters],
  );
  const legacySceneBoardCount = useMemo(
    () => allStoryboards.filter((storyboard) => storyboard.scenePositionBoard && isLegacySceneSchema(storyboard.scenePositionBoard.schemaVersion)).length,
    [allStoryboards],
  );
  const legacySceneResetCount = legacySceneMasterCount + legacySceneBoardCount;
  const hasLegacySceneData = legacySceneResetCount > 0;
  const activeStreamingStoryboard = isCurrentChapterActiveStream && activeStreamTarget
    ? (allStoryboards[activeStreamTarget.storyboardIndex] ?? null)
    : null;
  const visibleStreamText = isCurrentChapterActiveStream
    && activeStreamTarget?.storyboardIndex === currentIndex
    && activeStreamPhase === 'generating'
    ? streamText
    : '';
  const showPinnedStreamStatus = !!activeStreamingStoryboard
    && !!activeStreamTarget
    && activeStreamTarget.storyboardIndex !== currentIndex
    && !!activeStreamPhase;
  const showActiveStreamCard = !!activeStreamingStoryboard && !!activeStreamPhase;
  const disableLogicFixEditing = autoGenerate.running || currentChapterApiLoading || isStoryboardBusy(currentStoryboardStatusForBusy ?? 'pending');
  const disableStoryboardRename = autoGenerate.running || currentChapterApiLoading || isStoryboardBusy(currentStoryboardStatusForBusy ?? 'pending');
  const otherStep4BatchRunning = !!activeAutoGenerateTask
    && (activeAutoGenerateTask.projectId !== currentProject?.id || activeAutoGenerateTask.chapterId !== chapter?.id);
  const currentStep4GlobalTask = useMemo(
    () => state.globalTasks.find((task) =>
      task.type === 'step4-batch'
      && task.projectId === currentProject?.id
      && task.chapterId === chapter?.id
      && (task.status === 'queued' || task.status === 'running'),
    ) ?? null,
    [chapter?.id, currentProject?.id, state.globalTasks],
  );
  const activeStep4BatchSummaries = useMemo(
    () => state.globalTasks
      .filter((task) => task.type === 'step4-batch' && (task.status === 'queued' || task.status === 'running'))
      .map((task) => {
        const project = state.projects.find((item) => item.id === task.projectId);
        const targetChapter = project?.chapters.find((item) => item.id === task.chapterId);
        if (!project || !targetChapter) return null;
        const storyboards = targetChapter.storyboards ?? [];
        const total = task.total || storyboards.length || 1;
        const done = Math.max(task.doneCount ?? 0, storyboards.filter(isStoryboardPromptReady).length);
        const imageGenerating = storyboards.filter((storyboard) => {
          const board = storyboard.storyboardBoard;
          const selectedMode = getStoryboardBoardSelectedMode(board);
          const variant = getStoryboardBoardVariant(board, selectedMode);
          return variant?.status === 'generating';
        }).length;
        const imageQueued = storyboards.filter((storyboard) => {
          const board = storyboard.storyboardBoard;
          const selectedMode = getStoryboardBoardSelectedMode(board);
          const variant = getStoryboardBoardVariant(board, selectedMode);
          return variant?.planStatus === 'optimizing'
            || (variant?.planStatus === 'done' && variant?.status === 'idle');
        }).length;
        const promptGenerating = storyboards.filter((storyboard) =>
          storyboard.seedanceFinalVideoPromptStatus === 'generating'
        ).length;
        const activeTextLength = task.streamTextLength ?? 0;
        const fallbackTextLength = task.streamPreviousTextLength ?? 0;
        return {
          id: task.id,
          projectName: project.name,
          chapterTitle: targetChapter.title,
          status: task.status,
          done,
          total,
          stageLabel: task.streamStageLabel || (task.status === 'queued' ? '等待启动' : '运行中'),
          textLength: activeTextLength > 0 ? activeTextLength : fallbackTextLength,
          previousStageLabel: activeTextLength > 0 ? null : task.streamPreviousStageLabel,
          imageGenerating,
          imageQueued,
          promptGenerating,
          errorCount: task.errors.length,
        };
      })
      .filter((summary): summary is NonNullable<typeof summary> => !!summary),
    [state.globalTasks, state.projects],
  );
  const currentStep4TaskActive = !!currentStep4GlobalTask;
  const step4Concurrency = state.globalTaskSettings?.step4Concurrency ?? 1;
  const storyboardImageConcurrency = state.globalTaskSettings?.step4StoryboardImageConcurrency ?? 1;
  const seedancePromptConcurrency = state.globalTaskSettings?.step4SeedancePromptConcurrency ?? 1;
  const storyboardImageSizeOptions = getSupportedImageSizesForConfig(state.imageApiConfig);
  const storyboardImageSize = normalizeImageSizeForConfig(
    state.imageApiConfig,
    state.globalTaskSettings?.step4StoryboardImageSize,
    '2K',
  );
  const updateStep4ChannelConcurrency = (
    key: 'step4Concurrency' | 'step4StoryboardImageConcurrency' | 'step4SeedancePromptConcurrency',
    value: number,
  ) => {
    const settings = key === 'step4Concurrency'
      ? { step4Concurrency: value }
      : key === 'step4StoryboardImageConcurrency'
      ? { step4StoryboardImageConcurrency: value }
      : { step4SeedancePromptConcurrency: value };
    dispatch({
      type: 'SET_GLOBAL_TASK_SETTINGS',
      settings,
    });
  };
  const handleSetStoryboardImageSize = (imageSize: ImageSize) => {
    dispatch({
      type: 'SET_GLOBAL_TASK_SETTINGS',
      settings: { step4StoryboardImageSize: imageSize },
    });
  };
  const currentStep4ActionBusy = isStep4GenerationActionBusy({
    apiLoading: currentChapterApiLoading,
    storyboardStatus: currentStoryboardStatusForBusy,
    storyboardBoardGenerating: isGenerating,
    storyboardBoardOptimizing: isOptimizingPlan,
    scenePositionBoardGenerating: isGeneratingScenePositionBoard,
  });
  const canCancelCurrentStoryboardWork = !autoGenerate.running
    && !otherStep4BatchRunning
    && (
      currentStep4ActionBusy
      || isStep4BusyStatus(currentSb.status)
      || currentSb.seedanceFinalVideoPromptStatus === 'generating'
    );
  const chapterStep4ActionBusy = isStep4GenerationActionBusy({
    apiLoading: currentChapterApiLoading,
    busyStoryboardCount: stuckCount,
    storyboardBoardGenerating: isGenerating,
    storyboardBoardOptimizing: isOptimizingPlan,
    scenePositionBoardGenerating: isGeneratingScenePositionBoard,
  });
  const showPromptWorkbench = !isStoryboardDirectorMode && Boolean(currentSb.prompt?.rawText || visibleStreamText || isEditingPrompt);
  const showBoardWorkbench = Boolean(isStoryboardDirectorMode || currentSb.prompt?.rawText || boardState || scenePositionBoard);
  const showLogicFixCard = !isStoryboardDirectorMode;
  const showContextSourceCard = Boolean(
    isStoryboardDirectorMode
    || currentSourceExcerpt
    || currentSourceExcerptSummary
    || currentNextStoryboardSummary
    || currentSb.continuityInput?.lastFrameInfo
    || currentSb.continuityOutput?.lastFrameInfo
    || currentSb.lastFrameInfo
    || episodeShotSheetSegment
    || sequenceContinuityContext,
  );
  const workbenchGridClass = showPromptWorkbench && showBoardWorkbench
    ? 'grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.95fr)]'
    : 'grid gap-6';
  const displayAutoDoneCount = autoGenerate.running ? Math.max(autoGenerate.doneCount, doneCount) : doneCount;
  const batchProgressPercent = autoGenerate.total > 0
    ? Math.min(100, Math.round((displayAutoDoneCount / autoGenerate.total) * 100))
    : 0;
  const showBatchProgressPanel = autoGenerate.running || autoGenerate.errors.length > 0;
  const hasStoryboardStep4Artifact = (storyboard: StoryboardState) => Boolean(
    storyboard.status !== 'pending'
    || storyboard.prompt
    || storyboard.storyboardBoard
    || storyboard.scenePositionBoard
    || storyboard.seedanceFinalVideoPrompt
    || storyboard.correctedScript
    || storyboard.lastFrameInfo
    || storyboard.spatialBlocking
    || storyboard.continuityOutput
  );
  const resettableStoryboardCount = allStoryboards.filter(hasStoryboardStep4Artifact).length;
  const recoverableStep4IssueCount = errorCount + (autoGenerate.running ? 0 : stuckCount);
  const showBatchRepairActions = !autoGenerate.running && (resettableStoryboardCount > 0 || recoverableStep4IssueCount > 0);
  const batchTaskItems = useMemo(
    () => allStoryboards.map((storyboard, index) => ({
      index,
      storyboard,
      view: getBatchTaskView(storyboard),
    })),
    [allStoryboards],
  );
  const batchStageCounts = useMemo(() => getBatchStageCounts(allStoryboards), [allStoryboards]);
  const storyboardStatusLabel = currentStep4Ready
    ? '已完成'
    : currentSb.isStale
    ? '结果待刷新'
    : {
        pending: '待生成',
        checking: '逻辑检查中',
        correcting: '修正剧本中',
        choreographing: '动作编排中',
        'choreo-checking': '编排校验中',
        generating: '生成中',
        'self-checking': '自检中',
        done: liveSelfCheckResult?.overallPassed ? '已完成' : '待复查',
        error: '生成失败',
      }[currentSb.status];
  const diagnosticSummary = useMemo(() => {
    if (!state.apiConfig.apiKey) {
      return {
        level: 'warning' as const,
        title: '尚未配置 LLM API Key',
        detail: isStoryboardDirectorMode
          ? '请点击右上角“API 设置”，填入对话模型配置后再生成 Step4 故事板导演规划。'
          : '请点击右上角“API 设置”，填入对话模型配置后再生成 Step4 视频提示词。',
      };
    }
    if (isStoryboardDirectorMode && !imageGenerationReady) {
      return {
        level: 'warning' as const,
        title: '可先生成导演规划',
        detail: '当前缺少图片 API Key 或虾客漫SD2卡密，只会影响 Shot Sheet 出图；导演规划仍可用 LLM 先生成并检查。',
      };
    }
    if (currentErrorMessage) {
      return {
        level: 'error' as const,
        title: '当前镜生成失败或已中断',
        detail: currentErrorHint ?? currentErrorMessage,
      };
    }
    if (canRecoverCurrentStoryboard) {
      return {
        level: 'warning' as const,
        title: '检测到当前镜处于中断状态',
        detail: `可以点击“${currentStepRetryAction.label}”，系统会从当前失败点继续。`,
      };
    }
    if (autoGenerate.running) {
      if (autoGenerate.retryNotice) {
        const retryStoryboard = allStoryboards[autoGenerate.retryNotice.index]?.storyboard;
        return {
          level: 'info' as const,
          title: `正在自动重试：分镜${retryStoryboard ? String(retryStoryboard.number).padStart(2, '0') : autoGenerate.retryNotice.index + 1}`,
          detail: `第 ${autoGenerate.retryNotice.attempt}/${autoGenerate.retryNotice.maxRetries} 次重试。上次失败：${autoGenerate.retryNotice.error}`,
        };
      }
      const streamStageLabel = getActiveStreamStageLabel(
        activeStreamPhase,
        activeStreamingStoryboard ?? undefined,
        activeStreamStageLabel,
      );
      return {
        level: 'info' as const,
        title: `批量生成${outputUnitLabel}进行中：${autoGenerate.currentIndex + 1}/${autoGenerate.total}`,
        detail: activeStreamingStoryboard
          ? `当前执行阶段：${streamStageLabel} · 分镜${String(activeStreamingStoryboard.storyboard.number).padStart(2, '0')} · ${activeStreamingStoryboard.storyboard.name}`
          : '如遇网络波动，可点击“停止”后使用诊断条或本集修复继续恢复。',
      };
    }
    if (otherStep4BatchRunning && activeAutoGenerateTask) {
      return {
        level: 'info' as const,
        title: '其他章节正在并发执行 Step4',
        detail: `当前后台任务：${activeAutoGenerateTask.projectName} / ${activeAutoGenerateTask.chapterTitle}。本章可以继续编辑，也可以直接加入 Step4 全局队列并发执行。`,
      };
    }
    if (missingReferenceTotal > 0) {
      const detail = missingReferenceStoryboards
        .slice(0, 3)
        .map((item) => `分镜${String(item.number).padStart(2, '0')}：${item.labels.join('、')}`)
        .join('；');
      const extraCount = missingReferenceStoryboards.length > 3 ? `；另有 ${missingReferenceStoryboards.length - 3} 个分镜也缺图` : '';
      return {
        level: 'warning' as const,
        title: `还有 ${missingReferenceStoryboards.length} 个分镜缺少 ${missingReferenceTotal} 张 Step3 参考图`,
        detail: `请先返回图片资产管理补齐：${detail}${extraCount}`,
      };
    }
    if (hasLegacySceneData) {
      return {
        level: 'warning' as const,
        title: `检测到 ${legacySceneResetCount} 个旧场景定位数据`,
        detail: '建议先点击“重置旧场景”，让旧版/单视角定位图改走当前画幅的多视角场景母版方案。',
      };
    }
    if (staleCount > 0) {
      return {
        level: 'warning' as const,
        title: `有 ${staleCount} 个分镜结果已失效`,
        detail: isStoryboardDirectorMode
          ? '这些分镜的导演规划、剧本片段或引用资源发生过变化，建议重新生成故事板。'
          : '这些分镜的逻辑修正、Prompt 或引用资源发生过变化，建议重新生成。',
      };
    }
    if (currentMissingReferenceLabels.length > 0) {
      return {
        level: 'warning' as const,
        title: `当前分镜缺少 ${currentMissingReferenceLabels.length} 张 Step3 参考图`,
        detail: `请先返回图片资产管理补齐：${currentMissingReferenceLabels.join('、')}`,
      };
    }
    if (pendingCount > 0) {
      return {
        level: 'info' as const,
        title: `本集还有 ${pendingCount} 个镜头待处理`,
        detail: `优先继续生成剩余镜头；单镜操作只用于检查和局部返工。`,
      };
    }
    return {
      level: 'success' as const,
      title: 'Step4 状态正常',
      detail: isStoryboardDirectorMode
        ? '本集故事板已生成完成，可继续检查逐格导演说明或进入视频生成。'
        : '本集有效提示词已生成完成，可继续检查、导出或进入视频生成。',
    };
  }, [activeAutoGenerateTask, activeStreamPhase, activeStreamStageLabel, activeStreamingStoryboard, allStoryboards, autoGenerate.currentIndex, autoGenerate.retryNotice, autoGenerate.running, autoGenerate.total, canRecoverCurrentStoryboard, currentErrorHint, currentErrorMessage, currentMissingReferenceLabels, currentStepRetryAction.label, hasLegacySceneData, imageGenerationReady, isStoryboardDirectorMode, legacySceneResetCount, missingReferenceStoryboards, missingReferenceTotal, otherStep4BatchRunning, outputUnitLabel, pendingCount, staleCount, state.apiConfig.apiKey]);

  // 图片引用分配（从 store 中当前分镜的 imageRefs 读取，保留 assetId）
  const imageRefs = useMemo<ImageReference[]>(() => {
    if (total === 0) return [];
    return currentResolvedImageRefs;
  }, [total, currentResolvedImageRefs]);
  const getDisplayImageRefAsset = useCallback((imageRef: ImageReference) => {
    if (!imageRef.assetId) return null;
    const asset = assetById.get(imageRef.assetId) ?? null;
    if (imageRef.type === 'character' && !isCharacterAssetAllowedForImageRef(asset ?? undefined, imageRef)) {
      return null;
    }
    return asset;
  }, [assetById]);
  const boundImageRefCount = useMemo(
    () => imageRefs.filter((imageRef) => !!getDisplayImageRefAsset(imageRef)).length,
    [getDisplayImageRefAsset, imageRefs],
  );
  const officialVirtualHumanTemplateActive = useMemo(
    () => hasOfficialVirtualHumanTemplateMatch(
      currentProject?.step3Settings?.useVolcVirtualHumans ?? false,
      imageRefs,
      currentProject?.assetLibrary,
    ),
    [currentProject?.assetLibrary, currentProject?.step3Settings?.useVolcVirtualHumans, imageRefs],
  );
  const officialVirtualHumanVideoBackendReady = isOfficialVirtualHumanCompatibleVideoBackend(state.videoApiConfig.backend);
  const showEpisodeGenerationCommand = !autoGenerate.running && pendingCount > 0;
  const episodeGenerationDisabled = !state.apiConfig.apiKey
    || isStoryboardDirectorImageKeyMissing
    || total === 0
    || doneCount === total
    || currentStep4TaskActive
    || chapterStep4ActionBusy;
  const queueEpisodeGenerationDisabled = !state.apiConfig.apiKey
    || isStoryboardDirectorImageKeyMissing
    || total === 0
    || doneCount === total
    || currentStep4TaskActive
    || chapterStep4ActionBusy;
  const storyboardDirectorRunModeDisabled = autoGenerate.running
    || currentStep4TaskActive
    || chapterStep4ActionBusy;
  const episodeGenerationLabel = pendingCount === total
    ? `生成${outputBatchLabel}`
    : `继续生成剩余 ${pendingCount} 镜`;
  const showExpandedDiagnostic = autoGenerate.running
    || autoGenerate.errors.length > 0
    || canRecoverCurrentStoryboard
    || canCancelCurrentStoryboardWork
    || hasLegacySceneData
    || officialVirtualHumanTemplateActive;

  const handleResetLegacySceneMasters = async () => {
    if (!hasLegacySceneData || autoGenerate.running || currentChapterApiLoading || otherStep4BatchRunning) return;
    const confirmed = await confirm(
      `检测到 ${legacySceneMasterCount} 个旧场景母版、${legacySceneBoardCount} 张旧定位图。重置后不会删除原图文件，也不会隐藏 Step5 已生成视频；只会把相关分镜、故事板图和提交词标记为待刷新，后续会按当前画幅的多视角母版方案重新生成。是否继续？`,
      '重置旧场景',
    );
    if (!confirmed) return;
    dispatch({ type: 'HISTORY_PUSH' });
    dispatch({
      type: 'RESET_LEGACY_SCENE_MASTERS',
      projectId: currentProject?.id,
      chapterId: chapter?.id,
    });
    resetApi();
  };

  const handleSetStoryboardDirectorRunMode = (mode: StoryboardDirectorRunMode) => {
    if (!currentProject?.id || !chapter?.id) return;
    if (mode === storyboardDirectorRunMode || storyboardDirectorRunModeDisabled) return;
    dispatch({ type: 'HISTORY_PUSH', projectId: currentProject.id, chapterId: chapter.id });
    dispatch({
      type: 'SET_STORYBOARD_DIRECTOR_RUN_MODE',
      mode,
      projectId: currentProject.id,
      chapterId: chapter.id,
    });
  };

  const handleSetStoryboardBoardMode = (mode: StoryboardBoardMode) => {
    if (!currentProject?.id || !chapter?.id) return;
    if (mode === chapterStoryboardBoardMode || storyboardDirectorRunModeDisabled) return;
    dispatch({ type: 'HISTORY_PUSH', projectId: currentProject.id, chapterId: chapter.id });
    dispatch({
      type: 'SET_STORYBOARD_BOARD_MODE',
      mode,
      projectId: currentProject.id,
      chapterId: chapter.id,
    });
  };

  const handleSetSmartStoryboardPanelCount = (preference: SmartStoryboardPanelCountPreference) => {
    if (!currentProject?.id || !chapter?.id) return;
    const normalizedPreference = normalizeSmartStoryboardPanelCountPreference(preference);
    if (normalizedPreference === smartPanelCountPreference || storyboardDirectorRunModeDisabled) return;
    dispatch({ type: 'HISTORY_PUSH', projectId: currentProject.id, chapterId: chapter.id });
    dispatch({
      type: 'SET_SMART_STORYBOARD_PANEL_COUNT',
      preference: normalizedPreference,
      projectId: currentProject.id,
      chapterId: chapter.id,
    });
  };

  const handleSetSmartStoryboardDurationCompression = (enabled: boolean) => {
    if (!currentProject?.id || !chapter?.id) return;
    if (enabled === smartDurationCompressionEnabled || storyboardDirectorRunModeDisabled) return;
    dispatch({ type: 'HISTORY_PUSH', projectId: currentProject.id, chapterId: chapter.id });
    dispatch({
      type: 'SET_SMART_STORYBOARD_DURATION_COMPRESSION',
      enabled,
      projectId: currentProject.id,
      chapterId: chapter.id,
    });
  };

  const handleSetStoryboardCameraSegmentCount = (count: StoryboardCameraSegmentPreference) => {
    if (!currentProject?.id || !chapter?.id) return;
    const normalizedCount = normalizeStoryboardCameraSegmentPreference(count);
    if (normalizedCount === storyboardCameraSegmentPreference || storyboardDirectorRunModeDisabled) return;
    dispatch({ type: 'HISTORY_PUSH', projectId: currentProject.id, chapterId: chapter.id });
    dispatch({
      type: 'SET_STORYBOARD_CAMERA_SEGMENT_COUNT',
      count: normalizedCount,
      projectId: currentProject.id,
      chapterId: chapter.id,
    });
  };

  const renderPersistenceStatusBadge = () => {
    const savedTime = formatSaveTime(persistenceStatus.lastSavedAt);
    const label = persistenceStatus.phase === 'saving'
      ? '正在保存'
      : persistenceStatus.phase === 'saved'
        ? `已保存 ${savedTime}`
        : persistenceStatus.phase === 'error'
          ? '保存失败'
          : '等待保存';

    return (
      <Badge
        variant="outline"
        className={cn(
          'rounded-full px-2.5 py-1 text-[11px]',
          persistenceStatus.phase === 'saving' && 'border-cyan-300/70 bg-cyan-50/80 text-cyan-900 dark:border-cyan-300/40 dark:bg-cyan-400/10 dark:text-cyan-100',
          persistenceStatus.phase === 'saved' && 'border-emerald-300/70 bg-emerald-50/80 text-emerald-900 dark:border-emerald-300/35 dark:bg-emerald-400/10 dark:text-emerald-100',
          persistenceStatus.phase === 'error' && 'border-rose-300/80 bg-rose-50/90 text-rose-900 dark:border-rose-300/45 dark:bg-rose-400/10 dark:text-rose-100',
          persistenceStatus.phase === 'idle' && 'border-white/60 bg-white/55 text-muted-foreground dark:border-white/10 dark:bg-white/5',
        )}
        title={persistenceStatus.error ? `保存失败：${persistenceStatus.error}` : undefined}
      >
        {label}
      </Badge>
    );
  };

  const renderStoryboardDirectorRunModeSwitch = (className?: string) => {
    if (!isStoryboardDirectorMode) return null;
    const options: Array<{
      value: StoryboardDirectorRunMode;
      label: string;
      title: string;
    }> = [
      {
        value: 'refine',
        label: '精修模式',
        title: '完整运行动作导演，适合最终质量',
      },
      {
        value: 'fast',
        label: '快速模式',
        title: '跳过动作导演，适合先跑通本集初稿',
      },
      {
        value: 'compact',
        label: '精简模式',
        title: '跳过导演阐述和动作导演，只用上下文胶囊单轮规划，最快。',
      },
    ];

    return (
      <div
        className={cn(
          'flex h-9 overflow-hidden rounded-full border border-slate-200 bg-white p-0.5 text-xs shadow-sm dark:border-slate-600/70 dark:bg-slate-950/80',
          className,
        )}
        aria-label="Seedance 故事板生成速度"
      >
        {options.map((option) => {
          const selected = storyboardDirectorRunMode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={storyboardDirectorRunModeDisabled}
              title={option.title}
              onClick={() => handleSetStoryboardDirectorRunMode(option.value)}
              className={cn(
                'min-w-[68px] rounded-full px-2.5 font-medium transition disabled:cursor-not-allowed disabled:opacity-100 sm:min-w-[74px] sm:px-3',
                selected
                  ? 'bg-slate-950 text-white shadow-sm dark:bg-cyan-300 dark:text-slate-950 dark:shadow-[0_0_0_1px_rgba(103,232,249,0.45)]'
                  : 'text-slate-600 hover:bg-slate-950/5 hover:text-slate-950 dark:text-slate-200 dark:hover:bg-white/[0.12] dark:hover:text-white',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    );
  };

  const renderStoryboardBoardModeSwitch = (className?: string) => {
    if (!isStoryboardDirectorMode) return null;

    return (
      <div
        className={cn(
          'flex h-9 overflow-hidden rounded-full border border-slate-200 bg-white p-0.5 text-xs shadow-sm dark:border-slate-600/70 dark:bg-slate-950/80',
          className,
        )}
        aria-label="故事板规格"
      >
        {STORYBOARD_BOARD_MODE_OPTIONS.map((option) => {
          const selected = chapterStoryboardBoardMode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={storyboardDirectorRunModeDisabled}
              title={option.title}
              onClick={() => handleSetStoryboardBoardMode(option.value)}
              className={cn(
                'min-w-[78px] rounded-full px-3 font-medium transition disabled:cursor-not-allowed disabled:opacity-100',
                selected
                  ? 'bg-slate-950 text-white shadow-sm dark:bg-orange-300 dark:text-slate-950 dark:shadow-[0_0_0_1px_rgba(253,186,116,0.45)]'
                  : 'text-slate-600 hover:bg-slate-950/5 hover:text-slate-950 dark:text-slate-200 dark:hover:bg-white/[0.12] dark:hover:text-white',
              )}
            >
              {option.shortLabel}
            </button>
          );
        })}
      </div>
    );
  };

  const renderSmartStoryboardPanelCountSwitch = (className?: string) => {
    if (!isStoryboardDirectorMode || chapterStoryboardBoardMode !== 'smart-shot-plan-landscape') return null;

    return (
      <div
        className={cn(
          'flex h-9 overflow-hidden rounded-full border border-slate-200 bg-white p-0.5 text-xs shadow-sm dark:border-slate-600/70 dark:bg-slate-950/80',
          className,
        )}
        aria-label="智能故事板格数"
      >
        {SMART_STORYBOARD_PANEL_COUNT_OPTIONS.map((option) => {
          const selected = smartPanelCountPreference === option.value;
          return (
            <button
              key={String(option.value)}
              type="button"
              disabled={storyboardDirectorRunModeDisabled}
              title={option.title}
              onClick={() => handleSetSmartStoryboardPanelCount(option.value)}
              className={cn(
                'min-w-[52px] rounded-full px-2.5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-100',
                selected
                  ? 'bg-slate-950 text-white shadow-sm dark:bg-cyan-300 dark:text-slate-950 dark:shadow-[0_0_0_1px_rgba(103,232,249,0.45)]'
                  : 'text-slate-600 hover:bg-slate-950/5 hover:text-slate-950 dark:text-slate-200 dark:hover:bg-white/[0.12] dark:hover:text-white',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    );
  };

  const renderSmartStoryboardDurationCompressionSwitch = (className?: string) => {
    if (!isStoryboardDirectorMode || chapterStoryboardBoardMode !== 'smart-shot-plan-landscape') return null;
    const options = [
      {
        enabled: true,
        label: '压缩',
        title: '允许智能故事板按剧情节奏把原分镜时长压缩到更适合的成片秒数。',
      },
      {
        enabled: false,
        label: '原时长',
        title: '关闭智能压缩时长：保留原分镜秒数，只使用智能格数和节奏密度。',
      },
    ];

    return (
      <div
        className={cn(
          'flex h-9 overflow-hidden rounded-full border border-slate-200 bg-white p-0.5 text-xs shadow-sm dark:border-slate-600/70 dark:bg-slate-950/80',
          className,
        )}
        aria-label="智能故事板时长压缩"
      >
        {options.map((option) => {
          const selected = smartDurationCompressionEnabled === option.enabled;
          return (
            <button
              key={String(option.enabled)}
              type="button"
              disabled={storyboardDirectorRunModeDisabled}
              title={option.title}
              onClick={() => handleSetSmartStoryboardDurationCompression(option.enabled)}
              className={cn(
                'min-w-[58px] rounded-full px-2.5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-100',
                selected && option.enabled
                  ? 'bg-emerald-600 text-white shadow-sm dark:bg-emerald-300 dark:text-slate-950 dark:shadow-[0_0_0_1px_rgba(110,231,183,0.45)]'
                  : selected
                    ? 'bg-orange-500 text-white shadow-sm dark:bg-orange-300 dark:text-slate-950 dark:shadow-[0_0_0_1px_rgba(253,186,116,0.45)]'
                    : 'text-slate-600 hover:bg-slate-950/5 hover:text-slate-950 dark:text-slate-200 dark:hover:bg-white/[0.12] dark:hover:text-white',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    );
  };

  const renderStoryboardCameraSegmentCountSwitch = (className?: string) => {
    if (!isStoryboardDirectorMode) return null;
    const numericOptions = Array.from(
      { length: MAX_STORYBOARD_CAMERA_SEGMENT_COUNT - MIN_STORYBOARD_CAMERA_SEGMENT_COUNT + 1 },
      (_, index) => MIN_STORYBOARD_CAMERA_SEGMENT_COUNT + index,
    );
    const options: Array<{ value: StoryboardCameraSegmentPreference; label: string; title: string; className: string }> = [
      {
        value: 'auto',
        label: '自动',
        title: `自动判断镜头段数：当前分镜预计 ${storyboardCameraSegmentCount} 段。适合批量生成时减少不必要切镜。`,
        className: 'min-w-[52px] px-2.5',
      },
      ...numericOptions.map((count) => ({
        value: count as StoryboardCameraSegmentPreference,
        label: String(count),
        title: `${count} 段镜头：${count === 1 ? '强单镜头/one-take' : count <= 3 ? '舒适少切镜' : '较快节奏'}`,
        className: 'min-w-[34px] px-2',
      })),
    ];

    return (
      <div
        className={cn(
          'flex h-9 overflow-hidden rounded-full border border-slate-200 bg-white p-0.5 text-xs shadow-sm dark:border-slate-600/70 dark:bg-slate-950/80',
          className,
        )}
        aria-label="分镜单镜头数量"
        title={`控制最终视频允许的连续镜头段数量；自动档会按当前分镜内容推荐 1-5 段，默认兜底 ${DEFAULT_STORYBOARD_CAMERA_SEGMENT_COUNT} 段；S 格仍是动作锚点，不等于每秒切镜。`}
      >
        {options.map((option) => {
          const selected = storyboardCameraSegmentPreference === option.value;
          return (
            <button
              key={String(option.value)}
              type="button"
              disabled={storyboardDirectorRunModeDisabled}
              title={option.title}
              onClick={() => handleSetStoryboardCameraSegmentCount(option.value)}
              className={cn(
                'rounded-full font-semibold transition disabled:cursor-not-allowed disabled:opacity-100',
                option.className,
                selected
                  ? 'bg-slate-950 text-white shadow-sm dark:bg-lime-300 dark:text-slate-950 dark:shadow-[0_0_0_1px_rgba(190,242,100,0.45)]'
                  : 'text-slate-600 hover:bg-slate-950/5 hover:text-slate-950 dark:text-slate-200 dark:hover:bg-white/[0.12] dark:hover:text-white',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    );
  };

  const renderBatchConcurrencyControl = (className?: string) => {
    if (!isStoryboardDirectorMode) return null;
    const controls = [
      {
        key: 'step4Concurrency' as const,
        label: '章节',
        value: step4Concurrency,
        min: 1,
        max: 10,
        title: '同时运行的 Step4 章节数量；单章内部仍按连续性顺序推进',
      },
      {
        key: 'step4StoryboardImageConcurrency' as const,
        label: '图片',
        value: storyboardImageConcurrency,
        min: 1,
        max: 2,
        title: '批量故事板图片同时生成数量；长图多参考图建议 1-2 路，避免上游 502',
      },
      {
        key: 'step4SeedancePromptConcurrency' as const,
        label: '提交词',
        value: seedancePromptConcurrency,
        min: 1,
        max: 2,
        title: 'Seedance 最终视频词同时生成数量',
      },
    ];

    return (
      <div className={cn(
        'flex flex-wrap items-center gap-1 rounded-lg border border-white/60 bg-white/55 px-1.5 py-1 dark:border-white/10 dark:bg-white/5',
        className,
      )}>
        <span className="pl-2 text-[11px] font-medium text-muted-foreground">批量并发</span>
        {controls.map((control) => (
          <div
            key={control.key}
            className="flex h-8 items-center gap-1 rounded-full border border-slate-200 bg-white px-1 text-xs shadow-sm dark:border-slate-600/70 dark:bg-slate-950/80"
            title={control.title}
          >
            <span className="pl-2 text-[11px] text-slate-600 dark:text-slate-300">{control.label}</span>
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-35 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
              disabled={control.value <= control.min}
              onClick={() => updateStep4ChannelConcurrency(control.key, control.value - 1)}
              title={`${control.label}并发减少`}
              aria-label={`${control.label}并发减少`}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-4 text-center text-[12px] font-semibold tabular-nums text-slate-950 dark:text-white">
              {control.value}
            </span>
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-35 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
              disabled={control.value >= control.max}
              onClick={() => updateStep4ChannelConcurrency(control.key, control.value + 1)}
              title={`${control.label}并发增加`}
              aria-label={`${control.label}并发增加`}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    );
  };

  const renderStoryboardImageSizeControl = (className?: string) => {
    if (!isStoryboardDirectorMode) return null;
    const options: Array<{ value: ImageSize; label: string; title: string }> = storyboardImageSizeOptions.map((size) => ({
      value: size,
      label: size,
      title: size === '1K'
        ? '低成本预览档，适合快速检查构图'
        : size === '2K'
          ? '默认档，清晰度和速度更均衡'
          : '更清晰，生成更慢',
    }));

    return (
      <div className={cn(
        'flex flex-wrap items-center gap-1 rounded-lg border border-white/60 bg-white/55 px-1.5 py-1 dark:border-white/10 dark:bg-white/5',
        className,
      )}>
        <span className="pl-2 text-[11px] font-medium text-muted-foreground">出图</span>
        <div className="flex h-8 items-center rounded-full border border-slate-200 bg-white p-0.5 text-xs shadow-sm dark:border-slate-600/70 dark:bg-slate-950/80">
          {options.map((option) => {
            const selected = storyboardImageSize === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={currentStep4TaskActive}
                title={option.title}
                onClick={() => handleSetStoryboardImageSize(option.value)}
                className={cn(
                  'h-7 min-w-10 rounded-full px-2 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                  selected
                    ? 'bg-slate-950 text-white shadow-sm dark:bg-orange-300 dark:text-slate-950'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderStoryboardDirectorSettingsGroup = (className?: string) => {
    if (!isStoryboardDirectorMode) return null;

    return (
      <div
        className={cn(
          'flex max-w-full flex-col gap-2 rounded-lg border border-white/60 bg-white/50 p-2 shadow-sm dark:border-white/10 dark:bg-white/[0.04] lg:flex-row lg:flex-wrap lg:items-center',
          className,
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-white/60 bg-white/55 px-1.5 py-1 dark:border-white/10 dark:bg-white/5">
          <span className="pl-2 text-[11px] font-medium text-muted-foreground">规格</span>
          {renderStoryboardBoardModeSwitch()}
          {renderSmartStoryboardPanelCountSwitch()}
          {renderSmartStoryboardDurationCompressionSwitch()}
          <span className="px-1 text-[11px] font-medium text-muted-foreground">镜头段</span>
          {renderStoryboardCameraSegmentCountSwitch()}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-white/60 bg-white/55 px-1.5 py-1 dark:border-white/10 dark:bg-white/5">
          <span className="pl-2 text-[11px] font-medium text-muted-foreground">模式</span>
          {renderStoryboardDirectorRunModeSwitch()}
        </div>
        {renderBatchConcurrencyControl('min-w-0')}
        {renderStoryboardImageSizeControl('min-w-0')}
      </div>
    );
  };

  const renderStep4BackgroundTaskStatus = () => {
    if (!isStoryboardDirectorMode || activeStep4BatchSummaries.length === 0) return null;

    return (
      <div className="max-w-4xl rounded-lg border border-cyan-200/70 bg-cyan-50/70 p-2.5 text-xs text-cyan-950 dark:border-cyan-300/25 dark:bg-cyan-400/10 dark:text-cyan-50">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">前台队列</span>
          <span className="text-[11px] opacity-80">章节并发 {step4Concurrency} · 图片 {storyboardImageConcurrency} · 提交词 {seedancePromptConcurrency}</span>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {activeStep4BatchSummaries.map((task) => (
            <div
              key={task.id}
              className="rounded-lg border border-white/70 bg-white/70 p-2 dark:border-white/10 dark:bg-white/5"
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{task.chapterTitle}</div>
                  <div className="mt-0.5 truncate text-[11px] opacity-75">{task.projectName}</div>
                </div>
                <Badge variant="outline" className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] dark:bg-white/5">
                  {task.status === 'queued' ? '排队' : '运行'} {task.done}/{task.total}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="rounded-full bg-cyan-100 px-2 py-0.5 font-medium text-cyan-900 dark:bg-cyan-300/15 dark:text-cyan-50">
                  {task.stageLabel}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 dark:bg-white/10 dark:text-slate-200">
                  回流 {task.textLength} 字
                </span>
                {task.previousStageLabel && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500 dark:bg-white/10 dark:text-slate-300">
                    上一阶段 {task.previousStageLabel}
                  </span>
                )}
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900 dark:bg-amber-300/15 dark:text-amber-50">
                  图 {task.imageGenerating} / 排 {task.imageQueued}
                </span>
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-violet-900 dark:bg-violet-300/15 dark:text-violet-50">
                  词 {task.promptGenerating}
                </span>
                {task.errorCount > 0 && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-900 dark:bg-rose-300/15 dark:text-rose-50">
                    错 {task.errorCount}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const handleRetryCurrentStep = () => {
    if (currentStepRetryAction.kind === 'full-storyboard') {
      clearActiveStreamState({
        projectId: currentProject?.id,
        chapterId: chapter?.id,
        storyboardIndex: currentIndex,
      });
      void handleGenerateFull(currentIndex);
      return;
    }

    dispatch({ type: 'HISTORY_PUSH' });
    clearActiveStreamState({
      projectId: currentProject?.id,
      chapterId: chapter?.id,
      storyboardIndex: currentIndex,
    });
    const shouldKeepDirectorPlan = currentStoryboardDirectorMode
      && !!currentBoardVariantForRetry?.plan
      && currentBoardVariantForRetry.planStatus === 'done';
    if (shouldKeepDirectorPlan) {
      dispatch({
        type: 'RESTORE_DOWNSTREAM_AFTER_RECOVERABLE_STORYBOARD_RETRY',
        index: currentIndex,
        projectId: currentProject?.id,
        chapterId: chapter?.id,
      });
      const retryingFinalPrompt = currentStepRetryAction.kind === 'seedance-final-prompt';
      const hasDoneBoardImage = currentBoardVariantForRetry?.status === 'done' && !!currentBoardVariantForRetry.blobKey;
      dispatch({
        type: 'UPDATE_STORYBOARD',
        index: currentIndex,
        updates: {
          status: retryingFinalPrompt && hasDoneBoardImage ? 'done' : 'pending',
          storyboardBoard: mergeStoryboardBoardVariant(currentSb.storyboardBoard, currentBoardModeForRetry, {
            status: retryingFinalPrompt && hasDoneBoardImage ? 'done' : (currentBoardVariantForRetry?.blobKey ? 'done' : 'idle'),
            startedAt: undefined,
            error: undefined,
            isStale: false,
            planStatus: 'done',
            planError: currentBoardVariantForRetry?.planError,
            planIsStale: false,
          }),
          seedanceFinalVideoPrompt: retryingFinalPrompt ? '' : currentSb.seedanceFinalVideoPrompt,
          seedanceFinalVideoPromptStatus: retryingFinalPrompt ? 'idle' : currentSb.seedanceFinalVideoPromptStatus,
          seedanceFinalVideoPromptError: retryingFinalPrompt ? undefined : currentSb.seedanceFinalVideoPromptError,
          seedanceFinalVideoPromptSourceSnapshot: retryingFinalPrompt ? '' : currentSb.seedanceFinalVideoPromptSourceSnapshot,
          seedanceFinalVideoPromptUpdatedAt: retryingFinalPrompt ? undefined : currentSb.seedanceFinalVideoPromptUpdatedAt,
          seedanceFinalVideoPromptRunId: retryingFinalPrompt ? undefined : currentSb.seedanceFinalVideoPromptRunId,
          isStale: false,
          error: undefined,
          step4StartedAt: undefined,
        },
      });
      resetApi();
      if (retryingFinalPrompt) {
        void generateSeedanceFinalVideoPrompt();
      } else {
        void generateBoard();
      }
      return;
    }
    dispatch({
      type: 'UPDATE_STORYBOARD',
      index: currentIndex,
      updates: {
        sourceExcerpt: undefined,
        sourceExcerptSummary: undefined,
        nextStoryboardSummary: undefined,
        logicFixes: [],
        correctedScript: '',
        sceneBlueprint: null,
        choreography: null,
        status: 'pending',
        continuityInput: undefined,
        prompt: null,
        selfCheckResult: null,
        lastFrameInfo: '',
        spatialBlocking: undefined,
        continuityOutput: undefined,
        choreoCheckFixes: undefined,
        storyboardBoard: undefined,
        isStale: false,
        error: undefined,
      },
    });
    dispatch({ type: 'MARK_DOWNSTREAM_STALE', index: currentIndex });
    resetApi();
    void handleGenerateFull(currentIndex);
  };

  const handleCancelCurrentStoryboardWork = () => {
    dispatch({ type: 'HISTORY_PUSH' });
    abortStep4BackgroundRequests();
    abortBoardGenerationRequests();
    clearActiveStreamState({
      projectId: currentProject?.id,
      chapterId: chapter?.id,
      storyboardIndex: currentIndex,
    });
    dispatch({ type: 'CANCEL_BUSY_STORYBOARDS' });
    resetApi();
  };

  if (total === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>分镜数据异常，正在返回...</p>
        <button
          className="mt-4 text-sm underline"
          onClick={() => dispatch({ type: 'SET_CHAPTER_STATUS', status: 'analyzing' })}
        >
          ← 返回分析结果
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {SHOW_LEGACY_STEP4_BATCH_QUEUE_PANEL && autoGenerate.running && (
        <div
          ref={batchQueueRef}
          className={cn(
            'fixed z-50 max-w-[calc(100vw-2rem)] select-none',
            batchQueueCollapsed ? 'w-auto' : 'w-[min(380px,calc(100vw-2rem))]',
            batchQueuePosition ? '' : 'bottom-4 right-4',
          )}
          style={batchQueuePosition ? { left: batchQueuePosition.left, bottom: batchQueuePosition.bottom } : undefined}
        >
          {batchQueueCollapsed ? (
            <button
              type="button"
              onPointerDown={startBatchQueueDrag}
              onClick={() => {
                if (suppressBatchQueueClickRef.current) return;
                setBatchQueueCollapsed(false);
              }}
              className="flex h-12 cursor-grab items-center gap-2 rounded-full border border-blue-300/60 bg-white/95 px-4 text-left text-sm font-semibold text-slate-900 shadow-2xl backdrop-blur transition hover:-translate-y-0.5 hover:border-blue-400 hover:bg-blue-50 active:cursor-grabbing dark:border-blue-400/30 dark:bg-slate-950/95 dark:text-slate-50 dark:hover:bg-blue-500/10"
              title="拖动移动；点击展开队列"
              aria-label="展开 Step4 批量任务队列"
            >
              <ListChecks className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300" />
              <span>Step4 队列</span>
              <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white dark:bg-blue-500">
                {displayAutoDoneCount}/{autoGenerate.total}
              </span>
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            </button>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-2xl backdrop-blur dark:border-slate-700/80 dark:bg-slate-950/95">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 px-4 py-3 dark:border-slate-800">
                <div
                  className="flex min-w-0 flex-1 cursor-grab items-center gap-2 active:cursor-grabbing"
                  onPointerDown={startBatchQueueDrag}
                  title="拖动移动队列面板"
                >
                  <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <ListChecks className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">Step4 批量任务队列</div>
                    <div className="text-[11px] text-muted-foreground">
                      已完成 {displayAutoDoneCount}/{autoGenerate.total}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => setBatchQueueCollapsed(true)}
                    className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white/80 text-muted-foreground transition hover:bg-slate-50 hover:text-foreground dark:border-slate-700 dark:bg-white/5 dark:hover:bg-white/10"
                    title="收起队列"
                    aria-label="收起 Step4 批量任务队列"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <Button
                    variant="outline"
                    size="sm"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={handleCancelBatch}
                    className="h-8 rounded-xl border-red-200 bg-white/80 px-2.5 text-red-600 hover:bg-red-50 dark:bg-white/5"
                  >
                    <Square className="mr-1 h-3.5 w-3.5" />
                    停止
                  </Button>
                </div>
              </div>
              <div className="max-h-80 space-y-2 overflow-auto p-3">
                {batchTaskItems.map(({ index, storyboard, view }) => (
                  <button
                    key={`${storyboard.storyboard.number}-${index}`}
                    type="button"
                    onClick={() => goToIndex(index)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-xs transition hover:shadow-sm ${BATCH_TASK_TONE_CLASS[view.tone]}`}
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/70 font-mono text-[11px] shadow-sm dark:bg-white/10">
                      {view.spinning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : String(storyboard.storyboard.number).padStart(2, '0')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-semibold">{storyboard.storyboard.name || `分镜${storyboard.storyboard.number}`}</span>
                        {index === autoGenerate.currentIndex && (
                          <span className="shrink-0 rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] dark:bg-white/10">当前</span>
                        )}
                      </div>
                      <div className="mt-0.5 line-clamp-1 opacity-80">{view.label} · {view.detail}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Card className={`surface-panel step4-next-command-bar border ${getDiagnosticStyles(diagnosticSummary.level)}`} ref={batchProgressRef}>
        <CardContent className={cn(showExpandedDiagnostic ? 'space-y-5 p-4 sm:p-5' : 'space-y-3 p-3 sm:p-3.5')}>
          {showExpandedDiagnostic ? (
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/70 shadow-sm ring-1 ring-white/60 dark:bg-white/10 dark:ring-white/10">
                  <AlertCircle className="h-4 w-4" />
                </div>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="rounded-full bg-white/70 px-3 dark:bg-white/10">
                      工作台诊断
                    </Badge>
                    {autoGenerate.running && (
                      <Badge variant="outline" className="rounded-full border-current/20 bg-white/50 dark:bg-white/5">
                        批量执行中
                      </Badge>
                    )}
                    {renderPersistenceStatusBadge()}
                    {officialVirtualHumanTemplateActive && (
                      <Badge variant="outline" className="rounded-full border-blue-300/70 bg-blue-100/70 text-blue-900 dark:border-blue-400/30 dark:bg-blue-500/15 dark:text-blue-50">
                        官方虚拟人视频模板
                      </Badge>
                    )}
                  </div>
                  <div className="text-base font-semibold tracking-tight">{diagnosticSummary.title}</div>
                  <div className="max-w-3xl text-sm leading-6 opacity-90">{diagnosticSummary.detail}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="rounded-full bg-white/60 px-3 py-1 dark:bg-white/5">本集完成 {doneCount}</Badge>
                <Badge variant="outline" className="rounded-full bg-white/60 px-3 py-1 dark:bg-white/5">待处理 {pendingCount}</Badge>
                {staleCount > 0 && <Badge variant="outline" className="rounded-full bg-white/60 px-3 py-1 dark:bg-white/5">待刷新 {staleCount}</Badge>}
                {hasLegacySceneData && <Badge variant="outline" className="rounded-full bg-white/60 px-3 py-1 dark:bg-white/5">旧场景 {legacySceneResetCount}</Badge>}
                {errorCount > 0 && <Badge variant="outline" className="rounded-full bg-white/60 px-3 py-1 dark:bg-white/5">失败 {errorCount}</Badge>}
                {stuckCount > 0 && <Badge variant="outline" className="rounded-full bg-white/60 px-3 py-1 dark:bg-white/5">处理中 {stuckCount}</Badge>}
              </div>

              {officialVirtualHumanTemplateActive && (
                <div className={`max-w-3xl rounded-2xl border px-3 py-2 text-xs leading-5 ${
                  officialVirtualHumanVideoBackendReady
                    ? 'border-blue-200/70 bg-blue-50/70 text-blue-900 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-50'
                    : 'border-amber-200/80 bg-amber-50/90 text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-50'
                }`}
                >
                  <div className="font-semibold">官方虚拟人视频模板仅面向火山方舟视频模型</div>
                  <div className="mt-0.5">
                    {officialVirtualHumanVideoBackendReady
                      ? isStoryboardDirectorMode
                        ? '当前 Step5 视频后端已是火山方舟，故事板参考会继续匹配官方身份图提交格式。'
                        : '当前 Step5 视频后端已是火山方舟，生成的提示词会继续匹配官方身份图提交格式。'
                      : getOfficialVirtualHumanIncompatibleMessage(state.videoApiConfig.backend)}
                  </div>
                </div>
              )}

              {showEpisodeGenerationCommand && (
                <div className="max-w-4xl">
                  {renderStoryboardDirectorSettingsGroup()}
                </div>
              )}
              {renderStep4BackgroundTaskStatus()}

              <div className="flex flex-wrap gap-2">
                {showEpisodeGenerationCommand && (
                  <>
                    <Button
                      size="sm"
                      variant="default"
                      className="step4-next-primary-action h-9 rounded-full bg-[linear-gradient(135deg,#ff7a4f,#ff4f7d)] px-4 text-xs text-white shadow-[0_14px_30px_-18px_rgba(255,92,120,0.9)] hover:opacity-95"
                      disabled={episodeGenerationDisabled}
                      onClick={() => { void handleAutoGenerate(); }}
                      title="优先推进整集剩余镜头"
                    >
                      {episodeGenerationLabel}
                      {pendingCount > 0 && (
                        <Badge variant="secondary" className="ml-2 rounded-full bg-white/20 text-[10px] text-white">
                          {pendingCount}
                        </Badge>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 rounded-full bg-white/70 px-3 text-xs dark:bg-white/5"
                      disabled={queueEpisodeGenerationDisabled}
                      onClick={() => { void handleQueueAutoGenerate(); }}
                      title="加入全局队列；按章节并发上限执行，同一章节仍按分镜顺序推进"
                    >
                      加入队列
                    </Button>
                  </>
                )}
                {canRecoverCurrentStoryboard && (
                  <Button size="sm" variant="outline" className="rounded-xl bg-white/70 dark:bg-white/5" onClick={() => { void handleRetryCurrentStep(); }}>
                    {currentStepRetryAction.label}
                  </Button>
                )}
                {canCancelCurrentStoryboardWork && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl border-amber-200 bg-white/70 text-amber-800 hover:bg-amber-50 dark:border-amber-400/30 dark:bg-white/5 dark:text-amber-100"
                    onClick={() => { void handleCancelCurrentStoryboardWork(); }}
                  >
                    <Square className="mr-1.5 h-3.5 w-3.5" />
                    停止当前生成
                  </Button>
                )}
                {hasLegacySceneData && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl border-blue-200 bg-white/70 text-blue-800 hover:bg-blue-50 dark:border-blue-400/30 dark:bg-white/5 dark:text-blue-100"
                    disabled={currentChapterApiLoading || autoGenerate.running || otherStep4BatchRunning}
                    onClick={() => {
                      void handleResetLegacySceneMasters();
                    }}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    重置旧场景
                  </Button>
                )}
              </div>
            </div>

            <div className="grid min-w-[280px] gap-3 sm:grid-cols-2 xl:max-w-sm">
              <div className="rounded-2xl border border-white/70 bg-white/70 p-4 text-foreground shadow-sm dark:border-white/10 dark:bg-white/5">
                <div className="text-xs text-muted-foreground">当前检查镜头</div>
                <div className="mt-1 text-lg font-semibold">
                  {String(currentSb.storyboard.number).padStart(2, '0')} · {currentSb.storyboard.name || '未命名分镜'}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {currentStoryboardDurationLabel} · {currentSb.storyboard.shotSize || '景别待补充'}
                </div>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/70 p-4 text-foreground shadow-sm dark:border-white/10 dark:bg-white/5">
                <div className="text-xs text-muted-foreground">当前状态</div>
                <div className="mt-1 text-lg font-semibold">{storyboardStatusLabel}</div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {currentDisplayCharacters.length > 0
                    ? `出场角色：${currentDisplayCharacters.join('、')}`
                    : '本镜头暂无角色信息'}
                </div>
              </div>
            </div>
          </div>
          ) : (
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="rounded-full bg-white/70 px-2.5 dark:bg-white/10">
                    工作台诊断
                  </Badge>
                  <span className="truncate text-sm font-semibold text-foreground">{diagnosticSummary.title}</span>
                  <Badge variant="outline" className="rounded-full bg-white/55 px-2.5 py-1 text-xs dark:bg-white/5">
                    {pendingCount > 0 ? `待处理 ${pendingCount}` : '本集已完成'}
                  </Badge>
                  {renderPersistenceStatusBadge()}
                  <div
                    className="max-w-full truncate rounded-full border border-white/60 bg-white/55 px-3 py-1 text-xs text-muted-foreground dark:border-white/10 dark:bg-white/5"
                    title={`${String(currentSb.storyboard.number).padStart(2, '0')} · ${currentSb.storyboard.name || '未命名分镜'} · ${storyboardStatusLabel}`}
                  >
                    当前 {String(currentSb.storyboard.number).padStart(2, '0')} · {storyboardStatusLabel}
                  </div>
                </div>
                <div className="line-clamp-2 text-xs text-muted-foreground">{diagnosticSummary.detail}</div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="rounded-full bg-white/55 px-2.5 py-1 text-xs dark:bg-white/5">
                    本集完成 {doneCount}
                  </Badge>
                  <Badge variant="outline" className="rounded-full bg-white/55 px-2.5 py-1 text-xs dark:bg-white/5">
                    待处理 {pendingCount}
                  </Badge>
                  {staleCount > 0 && <Badge variant="outline" className="rounded-full bg-white/55 px-2.5 py-1 text-xs dark:bg-white/5">待刷新 {staleCount}</Badge>}
                  {errorCount > 0 && <Badge variant="outline" className="rounded-full bg-white/55 px-2.5 py-1 text-xs dark:bg-white/5">失败 {errorCount}</Badge>}
                  {stuckCount > 0 && <Badge variant="outline" className="rounded-full bg-white/55 px-2.5 py-1 text-xs dark:bg-white/5">处理中 {stuckCount}</Badge>}
                </div>
              </div>

              <div className="flex flex-col items-stretch gap-2 xl:items-end">
                {showEpisodeGenerationCommand && renderStoryboardDirectorSettingsGroup('xl:max-w-[720px]')}
                {renderStep4BackgroundTaskStatus()}
                <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                {showEpisodeGenerationCommand && (
                  <>
                    <Button
                      size="sm"
                      variant="default"
                      className="step4-next-primary-action h-9 rounded-full bg-[linear-gradient(135deg,#ff7a4f,#ff4f7d)] px-4 text-xs text-white shadow-[0_14px_30px_-18px_rgba(255,92,120,0.9)] hover:opacity-95"
                      disabled={episodeGenerationDisabled}
                      onClick={() => { void handleAutoGenerate(); }}
                      title="优先推进整集剩余镜头"
                    >
                      {episodeGenerationLabel}
                      {pendingCount > 0 && (
                        <Badge variant="secondary" className="ml-2 rounded-full bg-white/20 text-[10px] text-white">
                          {pendingCount}
                        </Badge>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 rounded-full bg-white/70 px-3 text-xs dark:bg-white/5"
                      disabled={queueEpisodeGenerationDisabled}
                      onClick={() => { void handleQueueAutoGenerate(); }}
                      title="加入全局队列；按章节并发上限执行，同一章节仍按分镜顺序推进"
                    >
                      加入队列
                    </Button>
                  </>
                )}
                {canRecoverCurrentStoryboard && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 rounded-full bg-white/70 px-3 text-xs dark:bg-white/5"
                    onClick={() => { void handleRetryCurrentStep(); }}
                  >
                    {currentStepRetryAction.label}
                  </Button>
                )}
                {canCancelCurrentStoryboardWork && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 rounded-full border-amber-200 bg-white/70 px-3 text-xs text-amber-800 hover:bg-amber-50 dark:border-amber-400/30 dark:bg-white/5 dark:text-amber-100"
                    onClick={() => { void handleCancelCurrentStoryboardWork(); }}
                  >
                    停止当前生成
                  </Button>
                )}
                {hasLegacySceneData && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 rounded-full border-blue-200 bg-white/70 px-3 text-xs text-blue-800 hover:bg-blue-50 dark:border-blue-400/30 dark:bg-white/5 dark:text-blue-100"
                    disabled={currentChapterApiLoading || autoGenerate.running || otherStep4BatchRunning}
                    onClick={() => { void handleResetLegacySceneMasters(); }}
                  >
                    重置旧场景
                  </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {showBatchProgressPanel && (
            <div className="rounded-2xl border border-blue-200/70 bg-white/65 p-3 text-slate-900 shadow-sm dark:border-sky-400/20 dark:bg-white/5 dark:text-slate-50">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    {autoGenerate.running ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" />
                    ) : autoGenerate.cancelled ? (
                      <XCircle className="h-4 w-4 shrink-0 text-orange-500" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                    )}
                    <div className="truncate text-sm font-semibold">
                      {autoGenerate.running
                        ? `正在批量生成 ${autoGenerate.currentIndex + 1}/${autoGenerate.total}`
                        : autoGenerate.cancelled
                        ? '批量生成已取消'
                        : autoGenerate.stopReason === 'failed'
                        ? `批量生成中断（${displayAutoDoneCount}/${autoGenerate.total}）`
                        : `批量生成完成（${displayAutoDoneCount}/${autoGenerate.total}）`}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {autoGenerate.running
                      ? '文本规划、图片通道、Seedance 提交词按顺序回流。'
                      : autoGenerate.errors.length > 0
                      ? '批量任务已记录失败镜头，可继续处理其余可生成镜头。'
                      : '文本规划、图片通道、Seedance 提交词已结算。'}
                  </div>
                </div>

                {autoGenerate.running && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelBatch}
                    className="w-fit rounded-xl border-red-200 bg-white/80 text-red-600 hover:bg-red-50 dark:bg-white/5"
                  >
                    <Square className="mr-1.5 h-3.5 w-3.5" />
                    停止
                  </Button>
                )}
              </div>

              <div className="mt-3 space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>整体进度</span>
                  <span className="font-medium text-foreground">
                    {displayAutoDoneCount}/{autoGenerate.total}
                    {autoGenerate.errors.length > 0 && (
                      <span className="ml-2 text-red-500">
                        · {autoGenerate.errors.length} 个失败
                      </span>
                    )}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-950/60">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-300"
                    style={{
                      width: `${batchProgressPercent}%`,
                    }}
                  />
                </div>
              </div>

              {autoGenerate.running && (
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-blue-200/70 bg-white/70 px-3 py-2 dark:border-blue-400/20 dark:bg-white/5">
                    <div className="font-medium text-blue-900 dark:text-blue-100">高质量规划</div>
                    <div className="mt-0.5 text-muted-foreground">{batchStageCounts.text} 个文本链路执行中</div>
                  </div>
                  <div className="rounded-xl border border-violet-200/70 bg-white/70 px-3 py-2 dark:border-violet-400/20 dark:bg-white/5">
                    <div className="font-medium text-violet-900 dark:text-violet-100">图片通道</div>
                    <div className="mt-0.5 text-muted-foreground">
                      {batchStageCounts.image} 个生成中 · {batchStageCounts.imageQueued} 个排队
                    </div>
                  </div>
                  <div className="rounded-xl border border-cyan-200/70 bg-white/70 px-3 py-2 dark:border-cyan-400/20 dark:bg-white/5">
                    <div className="font-medium text-cyan-900 dark:text-cyan-100">Seedance 提交词</div>
                    <div className="mt-0.5 text-muted-foreground">{batchStageCounts.seedance} 个正在回流</div>
                  </div>
                  <div className="rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 dark:border-slate-700 dark:bg-white/5">
                    <div className="font-medium text-slate-900 dark:text-slate-100">保护策略</div>
                    <div className="mt-0.5 text-muted-foreground">单张图片 20 分钟超时</div>
                  </div>
                </div>
              )}

              {autoGenerate.running && autoGenerate.retryNotice && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
                  <div className="font-medium">
                    正在自动重试分镜{String(allStoryboards[autoGenerate.retryNotice.index]?.storyboard.number ?? autoGenerate.retryNotice.index + 1).padStart(2, '0')}
                    （{autoGenerate.retryNotice.attempt}/{autoGenerate.retryNotice.maxRetries}）
                  </div>
                  <div className="mt-1 line-clamp-2 opacity-90">
                    {autoGenerate.retryNotice.error}
                  </div>
                </div>
              )}

              <div className="mt-3 grid grid-cols-4 gap-1 sm:grid-cols-8">
                {allStoryboards.map((sb, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
                      i === autoGenerate.currentIndex && autoGenerate.running
                        ? 'bg-blue-200 font-medium'
                        : getMissingImageReferenceLabels(sb.imageRefs).length > 0
                        ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200'
                        : sb.isStale
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200'
                        : isStoryboardPromptReady(sb)
                        ? 'bg-green-100 text-green-800 dark:bg-emerald-500/15 dark:text-emerald-200'
                        : sb.status === 'done'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200'
                        : sb.status === 'error'
                        ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200'
                        : sb.status === 'checking' || sb.status === 'correcting' || sb.status === 'choreographing' || sb.status === 'choreo-checking' || sb.status === 'generating' || sb.status === 'self-checking'
                        ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-200'
                        : 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {getMissingImageReferenceLabels(sb.imageRefs).length > 0 ? (
                      <XCircle className="h-3 w-3 shrink-0 text-red-500" />
                    ) : sb.isStale ? (
                      <RotateCcw className="h-3 w-3 shrink-0 text-amber-600" />
                    ) : isStoryboardPromptReady(sb) ? (
                      <CheckCircle2 className="h-3 w-3 shrink-0 text-green-600" />
                    ) : sb.status === 'done' ? (
                      <RotateCcw className="h-3 w-3 shrink-0 text-amber-600" />
                    ) : sb.status === 'error' ? (
                      <XCircle className="h-3 w-3 shrink-0 text-red-500" />
                    ) : sb.status === 'checking' || sb.status === 'correcting' || sb.status === 'choreographing' || sb.status === 'choreo-checking' || sb.status === 'generating' || sb.status === 'self-checking' ? (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-orange-500" />
                    ) : i === autoGenerate.currentIndex && autoGenerate.running ? (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-600" />
                    ) : (
                      <div className="h-3 w-3 shrink-0 rounded-full border border-gray-300" />
                    )}
                    <span className="truncate">
                      {String(sb.storyboard.number).padStart(2, '0')}
                    </span>
                  </div>
                ))}
              </div>

              {autoGenerate.errors.length > 0 && (
                <div className="mt-3 space-y-1">
                  <p className="text-xs font-medium text-red-700">
                    失败的分镜（已记录，批量会继续处理可生成镜头）：
                  </p>
                  {autoGenerate.errors.map((e) => (
                    <div key={e.index} className="rounded bg-red-50 px-2 py-1 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-200">
                      分镜{String(allStoryboards[e.index]?.storyboard.number).padStart(2, '0')}：{e.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {showActiveStreamCard && activeStreamingStoryboard && (
      <ActiveStreamCard
        storyboard={activeStreamingStoryboard}
        phase={activeStreamPhase}
        stageLabel={activeStreamStageLabel}
        stageStartedAt={currentStep4GlobalTask?.streamStageStartedAt ?? activeStreamStageStartedAt}
        stageLastActivityAt={currentStep4GlobalTask?.streamStageLastActivityAt ?? activeStreamStageLastActivityAt}
        stageTimeoutMs={currentStep4GlobalTask?.streamStageTimeoutMs ?? activeStreamStageTimeoutMs}
        stageTimeoutMode={currentStep4GlobalTask?.streamStageTimeoutMode ?? activeStreamStageTimeoutMode}
        streamText={streamText}
        streamTextLength={currentStep4GlobalTask?.streamTextLength}
        backgroundJobMode={false}
        showJumpButton={showPinnedStreamStatus}
        onJump={() => goToIndex(activeStreamTarget!.storyboardIndex)}
      />
      )}

      {/* 分镜选择器 + 控制栏 */}
      <Card className="surface-panel step4-next-workbench border-white/70">
        <CardHeader className="pb-4">
          <div className="step4-next-shot-head flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-sm font-bold text-primary-foreground shadow-sm">
                4
              </span>
              <div className="space-y-1">
                {isRenaming ? (
                  <div className="flex items-center gap-2">
                    <input
                      className="text-base font-semibold border-b border-primary bg-transparent px-1 py-0.5 focus:outline-none"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      disabled={disableStoryboardRename}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setIsRenaming(false); }}
                      autoFocus
                    />
                    <Button size="sm" variant="ghost" className="h-7 px-2" disabled={disableStoryboardRename} onClick={saveRename}><Check className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setIsRenaming(false)}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                ) : (
                  <CardTitle className="text-lg leading-tight flex items-center gap-2">
                    分镜{String(currentSb.storyboard.number).padStart(2, '0')} · {currentSb.storyboard.name}
                    <button disabled={disableStoryboardRename} onClick={startRename} className="text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed" title="重命名">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </CardTitle>
                )}
                <p className="text-sm text-muted-foreground">
                  {currentStoryboardDurationLabel} ·{' '}
                  {currentSb.storyboard.shotSize} ·{' '}
                  {currentDisplayCharacters.length > 0
                    ? `出场角色：${currentDisplayCharacters.join('、')}`
                    : '本镜头暂无角色信息'}
                  {currentSb.isStale ? ' · 结果已失效，建议重生成' : ''}
                </p>
              </div>
              <Badge
                className="rounded-full px-3 py-1"
                variant={
                  currentSb.isStale
                    ? 'secondary'
                    : currentSb.status === 'done'
                    ? liveSelfCheckResult?.overallPassed
                      ? 'default'
                      : 'destructive'
                    : currentSb.status === 'error'
                      ? 'destructive'
                      : 'secondary'
                }
              >
                {storyboardStatusLabel}
              </Badge>
            </div>

            {/* 导航按钮 */}
            <div className="flex items-center gap-2 self-end lg:self-auto">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl bg-white/70 dark:bg-white/5"
                onClick={goPrev}
                disabled={currentIndex <= 0}
              >
                ← 上一镜
              </Button>
              <span className="text-sm text-muted-foreground min-w-[60px] text-center">
                {currentIndex + 1}/{total}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl bg-white/70 dark:bg-white/5"
                onClick={goNext}
                disabled={currentIndex >= total - 1}
              >
                下一镜 →
              </Button>
            </div>
          </div>
        </CardHeader>

        {/* 进度指示器 */}
        <div className="step4-next-progress px-6 pb-4">
          <div className="flex gap-1">
            {allStoryboards.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  allStoryboards[i].isStale
                    ? 'bg-amber-400'
                    : getMissingImageReferenceLabels(allStoryboards[i].imageRefs).length > 0
                    ? 'bg-red-400'
                    : isStoryboardPromptReady(allStoryboards[i])
                    ? 'bg-green-400'
                    : allStoryboards[i].status === 'done'
                    ? 'bg-amber-400'
                    : allStoryboards[i].status === 'error'
                    ? 'bg-red-400'
                    : allStoryboards[i].status === 'checking' || allStoryboards[i].status === 'correcting' || allStoryboards[i].status === 'choreographing' || allStoryboards[i].status === 'choreo-checking' || allStoryboards[i].status === 'generating' || allStoryboards[i].status === 'self-checking'
                    ? 'bg-orange-400'
                    : i === currentIndex
                    ? 'bg-primary/60 animate-pulse'
                    : 'bg-muted'
                }`}
                onClick={() => goToIndex(i)}
                title={`分镜${String(i + 1).padStart(2, '0')}${allStoryboards[i].status === 'error' ? ' ⚠' : ''}`}
                style={{ cursor: 'pointer' }}
              />
            ))}
          </div>
        </div>

        <Separator />

        {/* 操作按钮区 */}
        <CardContent className="pt-5">
          <div className="step4-next-mode-panel mb-4 rounded-2xl border border-border/80 bg-background/85 p-2.5 shadow-sm dark:border-white/10 dark:bg-slate-950/45">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step4 输出模式</div>
              <Badge variant="outline" className="rounded-full bg-muted/50 text-[10px]">
                {isStoryboardDirectorMode ? activeStoryboardBoardLabel : '文字Prompt'}
              </Badge>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {([
                {
                  value: 'prompt' as const,
                  label: '文字提示词',
                  hint: '多轮分析后输出长视频 Prompt',
                  icon: FileText,
                  activeClass: 'border-cyan-400/70 bg-cyan-50 text-cyan-950 shadow-[0_10px_24px_-18px_rgba(34,211,238,0.9)] ring-2 ring-cyan-400/20 dark:border-cyan-300/70 dark:bg-cyan-400/10 dark:text-cyan-50 dark:ring-cyan-300/20',
                  idleClass: 'border-border/80 bg-muted/35 text-muted-foreground hover:border-cyan-300 hover:bg-cyan-50/80 hover:text-cyan-900 dark:border-white/10 dark:bg-white/5 dark:hover:border-cyan-300/60 dark:hover:bg-cyan-400/10 dark:hover:text-cyan-50',
                },
                {
                  value: 'storyboard-director' as const,
                  label: 'Seedance 故事板',
                  hint: `输出详细故事板 · ${activeStoryboardBoardLabel}`,
                  icon: Grid3x3,
                  activeClass: 'border-orange-400/70 bg-orange-50 text-orange-950 shadow-[0_10px_24px_-18px_rgba(255,114,94,0.9)] ring-2 ring-orange-400/20 dark:border-orange-300/70 dark:bg-orange-500/10 dark:text-orange-50 dark:ring-orange-300/20',
                  idleClass: 'border-border/80 bg-muted/35 text-muted-foreground hover:border-orange-300 hover:bg-orange-50/80 hover:text-orange-900 dark:border-white/10 dark:bg-white/5 dark:hover:border-orange-300/60 dark:hover:bg-orange-500/10 dark:hover:text-orange-50',
                },
              ]).map((option) => {
                const isSelectedMode = step4OutputMode === option.value;
                const OptionIcon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={currentChapterApiLoading || autoGenerate.running}
                    onClick={() => {
                      dispatch({
                        type: 'SET_STEP4_OUTPUT_MODE',
                        mode: option.value,
                        projectId: currentProject?.id,
                        chapterId: chapter?.id,
                      });
                      dispatch({
                        type: 'UPDATE_STORYBOARD',
                        index: currentIndex,
                        projectId: currentProject?.id,
                        chapterId: chapter?.id,
                        updates: {
                          step4OutputMode: option.value,
                          storyboardBoardStyle: option.value === 'storyboard-director' ? DEFAULT_STORYBOARD_BOARD_STYLE : (currentSb.storyboardBoardStyle ?? chapter?.storyboardBoardStyle ?? DEFAULT_STORYBOARD_BOARD_STYLE),
                        },
                      });
                    }}
                    className={`group min-h-[58px] rounded-2xl border px-3 py-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                      isSelectedMode ? option.activeClass : option.idleClass
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
                        isSelectedMode
                          ? 'border-current/20 bg-white/70 dark:bg-white/10'
                          : 'border-border/60 bg-background/70 group-hover:border-current/20 dark:border-white/10 dark:bg-slate-950/30'
                      }`}>
                        <OptionIcon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
                          {option.label}
                          {isSelectedMode && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                        </span>
                        <span className="mt-0.5 block line-clamp-1 text-[11px] leading-4 opacity-80">{option.hint}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="step4-next-action-row flex flex-wrap items-center gap-3">
            {/* 撤销/重做 */}
            {(canUndo || canRedo) && (
              <div className="mr-2 flex items-center gap-1 rounded-2xl border border-border/70 bg-muted/40 p-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl bg-white/80 dark:bg-white/5"
                  onClick={() => dispatch({ type: 'UNDO' })}
                  disabled={!canUndo}
                  title="撤销"
                >
                  ↩ 撤销
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl bg-white/80 dark:bg-white/5"
                  onClick={() => dispatch({ type: 'REDO' })}
                  disabled={!canRedo}
                  title="重做"
                >
                  ↪ 重做
                </Button>
              </div>
            )}

            {isStoryboardDirectorMode && !showEpisodeGenerationCommand && (
              <div className="basis-full">
                {renderStoryboardDirectorSettingsGroup()}
                <div className="mt-2">
                  {renderStep4BackgroundTaskStatus()}
                </div>
              </div>
            )}

            <Button
              onClick={() => {
                void handleGenerateFull(currentIndex);
              }}
              disabled={
                currentStep4ActionBusy ||
                autoGenerate.running ||
                otherStep4BatchRunning ||
                isStoryboardDirectorImageKeyMissing ||
                !state.apiConfig.apiKey
              }
              title={
                otherStep4BatchRunning
                  ? `另一个章节正在批量生成${outputUnitLabel}，请等待完成后再生成${currentOutputLabel}`
                  : currentStep4ActionBusy
                    ? `${currentOutputLabel}正在生成中，请稍候`
                  : isStoryboardDirectorImageKeyMissing
                    ? '缺少图片 API Key 或虾客漫SD2卡密，不能直接生成完整故事板；可在下方先生成导演规划'
                  : undefined
              }
              size="lg"
              variant="outline"
              className="step4-next-current-action h-11 rounded-2xl border-sky-200 bg-sky-50 text-sky-800 shadow-sm hover:bg-sky-100 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-100"
            >
              {currentStep4ActionBusy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isStoryboardDirectorMode
                    ? '故事板生成中...'
                    : currentSb.status === 'checking'
                      ? '逻辑检查中...'
                      : currentSb.status === 'correcting'
                        ? '修正剧本中...'
                        : currentSb.status === 'choreographing'
                          ? '动作编排中...'
                          : currentSb.status === 'choreo-checking'
                            ? '编排校验中...'
                            : currentSb.status === 'self-checking'
                              ? '自检中...'
                          : '生成中...'}
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  {currentStep4ActionLabel}
                </>
              )}
            </Button>

            {!isStoryboardDirectorMode && currentSb.prompt?.rawText && !currentSb.isStale && (
              <>
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" /> 复制
                </Button>
                {/* 单个导出下拉 */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Download className="mr-1.5 h-3.5 w-3.5" /> 导出
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => handleDownload('txt')}>📄 导出 .txt</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleDownload('md')}>📝 导出 .md</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleDownload('json')}>📋 导出 .json</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}

            {/* 批量导出全部 */}
            {!isStoryboardDirectorMode && doneCount > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-green-700 border-green-200 hover:bg-green-50"
                    title={`已生成 ${doneCount} 个分镜提示词`}
                  >
                    <DownloadCloud className="mr-1.5 h-3.5 w-3.5" />
                    导出全部（{doneCount}个）
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => handleExportAll('txt')}>📄 导出 .txt</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleExportAll('md')}>📝 导出 .md</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleExportAll('json')}>📋 导出 .json</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* 批量操作 */}
            {showBatchRepairActions && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="step4-next-repair-action h-9 rounded-full bg-white/70 px-3 text-xs dark:bg-white/5"
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5 text-orange-500" />
                    本集修复
                    {recoverableStep4IssueCount > 0 && (
                      <Badge variant="secondary" className="ml-2 rounded-full bg-orange-500/15 text-orange-700 dark:bg-orange-500/20 dark:text-orange-100">
                        {recoverableStep4IssueCount}
                      </Badge>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[220px]">
                  {recoverableStep4IssueCount > 0 && (
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={otherStep4BatchRunning}
                      onSelect={() => {
                        if (otherStep4BatchRunning) return;
                        void (async () => {
                          const totalCount = recoverableStep4IssueCount;
                          if (await confirm(`确定要重新生成全部 ${totalCount} 个异常（失败/卡住）的分镜吗？`)) {
                            dispatch({ type: 'HISTORY_PUSH' });
                            dispatch({ type: 'RESET_ERROR_STORYBOARDS' });
                            setTimeout(() => {
                              void handleAutoGenerate();
                            }, 100);
                          }
                        })();
                      }}
                    >
                      🔄 重新生成异常项 ({recoverableStep4IssueCount}个)
                    </DropdownMenuItem>
                  )}
                  {doneCount > 0 && (
                    <DropdownMenuItem
                      disabled={otherStep4BatchRunning}
                      onSelect={() => {
                        if (otherStep4BatchRunning) return;
                        void (async () => {
                          if (await confirm(`确定要重新生成全部 ${doneCount} 个已完成的分镜吗？`)) {
                            dispatch({ type: 'HISTORY_PUSH' });
                            dispatch({ type: 'RESET_ALL_STORYBOARDS' });
                            setTimeout(() => {
                              void handleAutoGenerate();
                            }, 100);
                          }
                        })();
                      }}
                    >
                      🔄 批量重新生成 ({doneCount}个)
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      void (async () => {
                        if (await confirm(`确定要清空全部 ${resettableStoryboardCount || total} 个分镜的${outputUnitLabel}吗？此操作不可撤销。`)) {
                          dispatch({ type: 'HISTORY_PUSH' });
                          dispatch({ type: 'RESET_ALL_STORYBOARDS' });
                        }
                      })();
                    }}
                  >
                    🗑️ 清空全部{outputUnitLabel}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {canRecoverCurrentStoryboard && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { void handleRetryCurrentStep(); }}
              >
                {currentStepRetryAction.label}
              </Button>
            )}
            {canCancelCurrentStoryboardWork && (
              <Button
                variant="outline"
                size="sm"
                className="border-amber-200 text-amber-800 hover:bg-amber-50 dark:border-amber-400/30 dark:text-amber-100"
                onClick={() => { void handleCancelCurrentStoryboardWork(); }}
              >
                <Square className="mr-1.5 h-3.5 w-3.5" />
                停止当前生成
              </Button>
            )}
          </div>

          {/* 错误信息 */}
          {currentErrorMessage && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 space-y-2">
              <div>{currentErrorMessage}</div>
              {currentErrorHint && (
                <div className="text-xs text-red-700/90">{currentErrorHint}</div>
              )}
              {canRecoverCurrentStoryboard && (
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-200 bg-white text-red-700 hover:bg-red-100"
                    onClick={() => { void handleRetryCurrentStep(); }}
                  >
                    {currentStepRetryAction.label}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {showContextSourceCard && (
        <Collapsible defaultOpen={false}>
          <Card className="surface-panel border-white/70">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">上下文取料</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    查看当前镜原文、下一镜边界，以及批量生成时传给当前镜的连续性上下文。
                  </p>
                </div>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm" className="rounded-full bg-white/70 dark:bg-white/5">
                    展开
                  </Button>
                </CollapsibleTrigger>
              </div>
            </CardHeader>
            <CollapsibleContent className="space-y-3 px-6 pb-6">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border bg-muted/30 p-3 text-sm dark:border-slate-700/70 dark:bg-slate-900/45">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">当前镜摘要</p>
                  <p>{currentSourceExcerptSummary || '未取到当前镜原文摘要；仍会使用分镜结构、角色、资产和连续性上下文生成。'}</p>
                </div>

                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
                  <p className="mb-1 text-xs font-medium">下一镜边界约束</p>
                  <p>{currentNextStoryboardSummary || sequenceContinuityContext?.nextContinuityIn || '暂无下一镜边界；当前镜会按自身 END BEAT 做开放交接。'}</p>
                </div>

                <div className="rounded-md border bg-muted/20 p-3 text-sm dark:border-slate-700/70 dark:bg-slate-950/40">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">入点承接</p>
                  <p>
                    {episodeShotSheetSegment?.continuityIn
                      || sequenceContinuityContext?.currentContinuityIn
                      || currentSb.continuityInput?.lastFrameInfo
                      || '暂无显式入点承接。'}
                  </p>
                </div>

                <div className="rounded-md border bg-muted/20 p-3 text-sm dark:border-slate-700/70 dark:bg-slate-950/40">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">落幅输出</p>
                  <p>
                    {episodeShotSheetSegment?.continuityOut
                      || sequenceContinuityContext?.currentContinuityOut
                      || currentSb.continuityOutput?.lastFrameInfo
                      || currentSb.lastFrameInfo
                      || '暂无显式落幅输出。'}
                  </p>
                </div>
              </div>

              {currentSourceExcerpt && (
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button variant="outline" size="sm">查看当前镜原始片段</Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-3">
                    <div className="max-h-72 overflow-auto rounded-md border bg-muted/20 p-3 text-sm whitespace-pre-wrap leading-6 dark:border-slate-700/70 dark:bg-slate-950/40">
                      {currentSourceExcerpt}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
              {!currentSourceExcerpt && (
                <div className="rounded-md border border-dashed bg-muted/10 p-3 text-xs leading-5 text-muted-foreground dark:border-slate-700/70 dark:bg-slate-950/30">
                  当前没有匹配到原始片段。常见原因是剧本标题格式不是“分镜01/SHOT 01/SCENE 01”，或本镜来自旧数据；重新跑 Step1/Step4 后会自动补齐。
                </div>
              )}
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* 逻辑修正记录（文字提示词模式专用） */}
      {showLogicFixCard && (
        <Collapsible defaultOpen={false}>
          <Card className="surface-panel border-white/70">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  📝 逻辑修正记录
                  <Badge variant="secondary">
                    {currentSb.logicFixes.length} 条
                  </Badge>
                </CardTitle>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    disabled={disableLogicFixEditing}
                    onClick={addFix}
                  >
                    + 新增修正
                  </Button>
                  <CollapsibleTrigger asChild>
                    <Button variant="outline" size="sm" className="rounded-full bg-white/70 dark:bg-white/5">
                      展开
                    </Button>
                  </CollapsibleTrigger>
                </div>
              </div>
            </CardHeader>
            <CollapsibleContent>
              <CardContent>
                <div className="space-y-3">
                  {disableLogicFixEditing && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      当前镜头正在生成或本集批量处理中，已临时锁定逻辑修正编辑，避免生成结果与手动修改互相覆盖。
                    </div>
                  )}
                  {currentSb.logicFixes.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      无修正记录，剧本逻辑检查通过 ✅
                    </p>
                  )}
                  {currentSb.logicFixes.map((fix, i) => (
                    <div key={i} className="rounded-md border bg-muted/30 p-3 space-y-2">
                      {editFixIdx === i ? (
                        <div className="space-y-2">
                          <div>
                            <label className="text-xs font-medium text-red-700">矛盾描述</label>
                            <Input
                              value={editFixForm.originalIssue}
                              disabled={disableLogicFixEditing}
                              onChange={(e) => setEditFixForm((p) => ({ ...p, originalIssue: e.target.value }))}
                              className="text-sm mt-1"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-green-700">修正内容</label>
                            <Input
                              value={editFixForm.correction}
                              disabled={disableLogicFixEditing}
                              onChange={(e) => setEditFixForm((p) => ({ ...p, correction: e.target.value }))}
                              className="text-sm mt-1"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-muted-foreground">原因</label>
                            <Input
                              value={editFixForm.reason}
                              disabled={disableLogicFixEditing}
                              onChange={(e) => setEditFixForm((p) => ({ ...p, reason: e.target.value }))}
                              className="text-sm mt-1"
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" disabled={disableLogicFixEditing} onClick={saveEditFix}><Check className="h-3.5 w-3.5 mr-1" />保存</Button>
                            <Button size="sm" variant="ghost" onClick={cancelEditFix}><X className="h-3.5 w-3.5 mr-1" />取消</Button>
                            <Button size="sm" variant="ghost" className="text-red-500 ml-auto" disabled={disableLogicFixEditing} onClick={() => { cancelEditFix(); deleteFix(i); }}><XCircle className="h-3.5 w-3.5 mr-1" />删除</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="flex items-start gap-2">
                            <p className="text-sm flex-1">
                              <span className="font-medium text-red-700">矛盾：</span>
                              <span className="line-through text-red-600/70">{fix.originalIssue}</span>
                            </p>
                            <div className="flex gap-1 shrink-0">
                              <button disabled={disableLogicFixEditing} onClick={() => startEditFix(i)} className="text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed" title="编辑"><Pencil className="h-3.5 w-3.5" /></button>
                              <button disabled={disableLogicFixEditing} onClick={() => deleteFix(i)} className="text-muted-foreground hover:text-red-500 disabled:opacity-40 disabled:cursor-not-allowed" title="删除"><XCircle className="h-3.5 w-3.5" /></button>
                            </div>
                          </div>
                          <p className="text-sm">
                            <span className="font-medium text-green-700">修正：</span>
                            {fix.correction}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            原因：{fix.reason}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* 图片引用 */}
      {imageRefs.length > 0 && (
        <Collapsible defaultOpen={false}>
          <Card className="surface-panel border-white/70">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  🖼️ 图片引用分配
                  {currentSb.videoImageBudget && (
                    <Badge
                      variant={currentSb.videoImageBudget.warnings.length > 0 ? 'secondary' : 'outline'}
                      className="rounded-full bg-white/70 dark:bg-white/5"
                    >
                      视频参考图 {currentSb.videoImageBudget.selectedCount}/{currentSb.videoImageBudget.limit}
                    </Badge>
                  )}
                </CardTitle>
                <div className="ml-auto flex items-center gap-2">
                  <Badge variant="outline" className="rounded-full bg-white/55 px-2.5 py-1 text-xs dark:bg-white/5">
                    已绑定 {boundImageRefCount}/{imageRefs.length}
                  </Badge>
                  <CollapsibleTrigger asChild>
                    <Button variant="outline" size="sm" className="rounded-full bg-white/70 dark:bg-white/5">
                      展开
                    </Button>
                  </CollapsibleTrigger>
                </div>
              </div>
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {imageRefs.map((imageRef) => (
                    <ImageReferenceCard
                      key={`${imageRef.refId}-${imageRef.assetId ?? imageRef.name}`}
                      imageRef={imageRef}
                      asset={getDisplayImageRefAsset(imageRef)}
                      projectId={currentProject?.id}
                    />
                  ))}
                </div>
                {currentSb.videoImageBudget?.compressed && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                    <div className="font-medium">
                      已按视频模型上限自动压缩：{currentSb.videoImageBudget.originalCount} → {currentSb.videoImageBudget.selectedCount}/{currentSb.videoImageBudget.limit}
                    </div>
                    <div className="mt-1 text-amber-800/90 dark:text-amber-100/80">
                      {currentSb.videoImageBudget.notes.join(' ')}
                    </div>
                    {currentSb.videoImageBudget.omittedRefs.length > 0 && (
                      <div className="mt-2">
                        文字兜底：{currentSb.videoImageBudget.omittedRefs.slice(0, 5).map((item) => item.message).join('；')}
                        {currentSb.videoImageBudget.omittedRefs.length > 5 ? `；另有 ${currentSb.videoImageBudget.omittedRefs.length - 5} 项` : ''}
                      </div>
                    )}
                    {currentSb.videoImageBudget.warnings.length > 0 && (
                      <div className="mt-2 font-medium text-red-700 dark:text-red-200">
                        {currentSb.videoImageBudget.warnings.join('；')}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Step4 输出工作台 */}
      {(showPromptWorkbench || showBoardWorkbench) && (
        <div className={workbenchGridClass}>
          {showPromptWorkbench && (
            <Card className="surface-panel border-white/70">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                  📋 当前镜头视频提示词
                  <Badge variant="outline" className="rounded-full bg-white/70 dark:bg-white/5">
                    主输出
                  </Badge>
                  {visibleStreamText && !currentSb.prompt?.rawText && (
                    <span className="text-xs text-muted-foreground animate-pulse">
                      正在生成...
                    </span>
                  )}
                  {!visibleStreamText && (currentSb.status === 'done' || (currentSb.status === 'error' && !!currentSb.prompt?.rawText)) && (
                    <div className="ml-auto flex gap-2">
                      {isEditingPrompt ? (
                        <>
                          <Button size="sm" variant="default" className="rounded-xl" onClick={saveEditPrompt}>
                            <Check className="mr-1.5 h-3.5 w-3.5" /> 保存
                          </Button>
                          <Button size="sm" variant="ghost" className="rounded-xl" onClick={cancelEditPrompt}>
                            <X className="mr-1.5 h-3.5 w-3.5" /> 取消
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="outline" className="rounded-xl bg-white/70 dark:bg-white/5" onClick={startEditPrompt}>
                          <Pencil className="mr-1.5 h-3.5 w-3.5" /> 编辑
                        </Button>
                      )}
                    </div>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  这里是当前镜头最终用于视频生成的主 Prompt。整集生成已完成后，只在局部返工时编辑这里。
                </div>
                {isEditingPrompt ? (
                  <textarea
                    className="w-full min-h-[300px] rounded-2xl bg-gray-950 p-4 text-sm text-gray-100 leading-relaxed font-mono resize-y"
                    value={editedPromptText}
                    onChange={(e) => setEditedPromptText(e.target.value)}
                    placeholder="编辑提示词内容..."
                    spellCheck={false}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap break-words rounded-2xl bg-gray-950 p-4 text-sm text-gray-100 leading-relaxed font-mono max-h-[600px] overflow-y-auto">
                    {currentSb.prompt?.rawText || visibleStreamText}
                  </pre>
                )}
              </CardContent>
            </Card>
          )}

          {showBoardWorkbench && (
            <div className="space-y-4">
              {!isStoryboardDirectorMode && (
                <ScenePositionBoardCard
                  board={scenePositionBoard}
                  previewUrl={scenePositionBoardPreviewUrl}
                  points={scenePositionBoardPoints}
                  disabledReason={scenePositionBoardDisabledReason}
                  isGenerating={isGeneratingScenePositionBoard}
                  hasFreshBoard={hasFreshScenePositionBoard}
                  hasFreshSceneMaster={hasFreshSceneMaster}
                  sceneMaster={sceneMaster}
                  sceneMasterViewLabel={sceneMasterViewLabel}
                  onGenerate={generateScenePositionBoard}
                  onNudgePoint={nudgeScenePositionBoardPoint}
                  onClear={clearScenePositionBoard}
                  onDownload={downloadScenePositionBoard}
                />
              )}
              <StoryboardBoardCard
                boardState={boardState}
                selectedMode={selectedMode}
                storyboardDuration={currentSb.storyboard.duration}
                smartVideoDurationSeconds={currentSb.smartVideoDurationSeconds}
                smartVideoDurationReason={currentSb.smartVideoDurationReason}
                previewAspectRatio={modeConfig.aspectRatio}
                shotPlanFrameRatio={modeConfig.frameRatio}
                previewUrl={previewUrl}
                visualPreviewUrl={visualPreviewUrl}
                storyboardBoardReferenceEnabled={storyboardBoardReferenceEnabled}
                promptPreview={boardPromptPreview}
                planPreview={boardPlanPreview}
                seedanceFinalPromptPreview={seedanceFinalPromptPreview}
                seedanceFinalPromptState={seedanceFinalPromptState}
                seedanceFinalPromptDisabledReason={seedanceFinalPromptDisabledReason}
                references={usedReferences}
                missingReferenceLabels={missingReferenceLabels}
                conditionChecks={conditionChecks}
                qualityReport={qualityReport}
                episodeShotSheetSegment={episodeShotSheetSegment}
                sequenceContinuityContext={sequenceContinuityContext}
                boardStyle={boardStyle}
                optimizeDisabledReason={optimizeDisabledReason}
                generateDisabledReason={generateDisabledReason}
                hasFreshPlan={hasFreshPlan}
                isOptimizingPlan={isOptimizingPlan}
                isGenerating={isGenerating}
                onModeChange={setBoardMode}
                onStyleChange={setBoardStyle}
                onOptimizePlan={optimizeBoardPlan}
                onGenerate={generateBoard}
                onRefreshSeedanceFinalPrompt={generateSeedanceFinalVideoPrompt}
                onImportImageUrl={importBoardImageFromUrl}
                onRepairText={repairBoardText}
                onClear={clearBoard}
                onDownload={downloadBoard}
              />
            </div>
          )}
        </div>
      )}

      {/* 自检结果 */}
      {liveSelfCheckResult && (
        <Card className="surface-panel border-white/70">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {liveSelfCheckResult.overallPassed ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-amber-500" />
              )}
              质量报告
              <Badge
                variant={
                  liveSelfCheckResult.overallPassed
                    ? 'default'
                    : 'secondary'
                }
              >
                {liveSelfCheckResult.passedCount}/
                {liveSelfCheckResult.totalChecks} 通过
              </Badge>
              {!liveSelfCheckResult.overallPassed && (
                <span className="text-xs font-normal text-muted-foreground">
                  已发现可优化项，可继续生成，也可先按提示修复
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {liveSelfCheckResult.items.map((item, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-3 rounded-md p-2.5 text-sm ${
                    item.passed
                      ? 'bg-green-50/50'
                      : 'bg-amber-50/70'
                  }`}
                >
                  {item.passed ? (
                    <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-green-600" />
                  ) : (
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                  )}
                  <div className="min-w-0">
                    <span
                      className={
                        item.passed ? '' : 'font-medium'
                      }
                    >
                      {item.name}
                    </span>
                    {item.detail && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {item.detail}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      {ConfirmDialog}
    </div>
  );
}
