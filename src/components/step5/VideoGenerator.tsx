import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, Film, FolderOpen, GripVertical, ListChecks, Loader2, XCircle } from '@/components/icons';
import { useApiCall } from '@/hooks/useApiCall';
import type { VolcHistoryTask } from '@/lib/volcHistoryClient';
import { useConfirm } from '@/hooks/useConfirmPrompt';
import { sanitizeMisboundImageReferenceLabels } from '@/lib/promptImageRefValidation';
import { isStoryboardPromptReady } from '@/lib/storyboardReadiness';
import { volcResolveCompletedVideoUrl } from '@/lib/volcengineApiClient';
import { getVideoImageReferenceLimit } from '@/lib/volcengineVideoModels';
import { deleteBlob, saveBlob } from '@/lib/imageStore';
import { formatBytes } from '@/lib/lightweightImageCompression';
import {
  getStoryboardBoardSelectedMode,
  getStoryboardBoardVariant,
  mergeStoryboardBoardVariant,
} from '@/lib/storyboardBoardState';
import {
  getOfficialVirtualHumanIncompatibleMessage,
  hasOfficialVirtualHumanProjectAssets,
  getVideoBackendDisplayName,
  isOfficialVirtualHumanCompatibleVideoBackend,
} from '@/lib/officialVirtualHumanVideoMode';
import { useCurrentProject } from '@/stores/projectStore';
import type { Asset, ImageReference, StoryboardState, VideoApiConfig } from '@/types';
import { BatchControlBar } from './BatchControlBar';
import { StoryboardProgressCell } from './StoryboardProgressCell';
import { StoryboardVideoCard } from './StoryboardVideoCard';
import { Step5TaskHistoryModal } from './Step5TaskHistoryModal';
import { VideoHistoryModal } from './VideoHistoryModal';
import { VideoQuickParams } from './VideoQuickParams';
import { useBatchExport } from './useBatchExport';
import { useBatchVideoGenerate } from './useBatchVideoGenerate';
import { useBgmGeneration } from './useBgmGeneration';
import { useVideoAutoSaveEffect } from './useVideoAutoSaveEffect';
import { useVideoNotification } from './useVideoNotification';
import { useVideoProgressSummary } from './useVideoProgressSummary';
import { useStoryboardDragSort } from './useStoryboardDragSort';
import { useStep5TaskRuntime } from './Step5TaskProvider';
import type { Step5VideoTaskLogEntry } from '@/lib/step5VideoTaskLog';
import {
  buildEffectiveVideoPrompt,
  isStoryboardDirectorMode,
  resolveStoryboardBoardVideoReferenceState,
} from './storyboardBoardVideoReference';
import {
  buildMissingVideoReferenceMessage,
  buildVideoReferenceLimitMessage,
  resolveVideoReferenceAssets,
  type EffectiveVideoReferenceItem,
} from './videoReferenceResolver';
import {
  buildVideoPromptDesensitizePayload,
  buildFinalVideoSubmitPrompt,
  getVideoSubmitPromptOverrideState,
  validateDesensitizedVideoPrompt,
} from './videoPromptOptimization';
import {
  getStoryboardVideoSubmissionReadiness,
  SEEDANCE_FINAL_PROMPT_MISSING_MESSAGE,
} from './videoSubmissionReadiness';
import { cacheVideoBlob, estimateRemainingTime, getVideoState } from './videoUtils';
import { getStoryboardVideoContinuityDecision } from './videoContinuityPlan';
import { isVideoExtensionEnabled } from './videoExtensionConfig';
import { getSeedanceTaskVideoUrl, listSeedanceTasks, type SeedanceTaskRecord } from '@/lib/seedanceTaskClient';
import { isSeedanceServiceBackend, normalizeSeedanceServiceDuration } from '@/lib/seedanceApi';
import {
  formatStoryboardDurationSeconds,
  getStoryboardStep4VideoDurationSeconds,
  resolveStoryboardVideoDuration,
} from '@/lib/storyboardDuration';
import {
  compressStoryboardBoardForUpload,
  STORYBOARD_BOARD_UPLOAD_WEBP_QUALITY_LABEL,
} from './storyboardBoardCompression';
import { getStoryboardVideoImageRefs } from './videoImageRefs';

const EMPTY_STORYBOARDS: StoryboardState[] = [];

function normalizePromptForMatch(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function scoreSeedanceTaskMatch(
  task: SeedanceTaskRecord,
  expectedPrompt: string,
  options: { duration?: number; ratio?: string; storyboardName?: string },
) {
  if (task.status !== 'success' || !task.task_id || !task.prompt) return 0;

  const taskPrompt = normalizePromptForMatch(task.prompt);
  const prompt = normalizePromptForMatch(expectedPrompt);
  if (!taskPrompt || !prompt) return 0;

  let score = 0;
  if (taskPrompt === prompt) {
    score += 100;
  } else {
    const head = prompt.slice(0, 700);
    const tail = prompt.slice(Math.max(0, prompt.length - 700));
    if (head.length > 120 && taskPrompt.includes(head)) score += 45;
    if (tail.length > 120 && taskPrompt.includes(tail)) score += 30;
    const name = options.storyboardName?.trim();
    if (name && taskPrompt.includes(name)) score += 20;
  }

  if (typeof options.duration === 'number' && task.duration === options.duration) score += 10;
  if (options.ratio && task.ratio === options.ratio) score += 10;

  return score;
}

function isRecoverableSeedanceTask(task: SeedanceTaskRecord | undefined): task is SeedanceTaskRecord {
  return !!task?.task_id && task.status === 'success';
}

function parseSeedanceTimestamp(value?: string | null) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function resolveStoryboardSubmitDuration(storyboard: StoryboardState | undefined, videoConfig: VideoApiConfig) {
  const duration = resolveStoryboardVideoDuration(storyboard, videoConfig.videoDuration);
  if (isSeedanceServiceBackend(videoConfig.backend)) return normalizeSeedanceServiceDuration(duration);
  return duration;
}

function createLocalId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function clearLightweightAssetFields(): Partial<Asset> {
  return {
    lightweightBlobKey: undefined,
    lightweightMimeType: undefined,
    lightweightQuality: undefined,
    lightweightOriginalBytes: undefined,
    lightweightBytes: undefined,
    lightweightWidth: undefined,
    lightweightHeight: undefined,
    lightweightCreatedAt: undefined,
  };
}

function isAssetVideoReferenceItem(
  item: EffectiveVideoReferenceItem,
): item is Extract<EffectiveVideoReferenceItem, { asset: Asset }> {
  return 'asset' in item;
}

function findVideoImageRefIndex(
  imageRefs: readonly ImageReference[],
  item: Extract<EffectiveVideoReferenceItem, { asset: Asset }>,
) {
  const sourceRefId = item.sourceRefId || item.refId;
  const trackingId = item.trackingId ?? '';
  const exactIndex = imageRefs.findIndex((ref) =>
    ref.refId === sourceRefId
    && ref.type === item.type
    && ref.name === item.name
    && (ref.trackingId ?? '') === trackingId,
  );
  if (exactIndex >= 0) return exactIndex;

  const assetIndex = imageRefs.findIndex((ref) => ref.assetId === item.asset.id);
  if (assetIndex >= 0) return assetIndex;

  return imageRefs.findIndex((ref) =>
    ref.type === item.type
    && ref.name === item.name
    && (ref.trackingId ?? '') === trackingId,
  );
}

export function Step5VideoGenerator() {
  const { state, dispatch, currentProject, currentChapter: chapter } = useCurrentProject();
  const { confirm, ConfirmDialog } = useConfirm();
  const { callApiViaBff } = useApiCall();

  const allStoryboards = chapter?.storyboards ?? EMPTY_STORYBOARDS;
  const currentStoryboardIndex = chapter?.currentStoryboardIndex ?? 0;
  const getVideoSubmissionReadiness = useCallback((sb: StoryboardState, index: number) => getStoryboardVideoSubmissionReadiness({
    storyboard: sb,
    analysis: chapter?.analysis,
    assetLibrary: currentProject?.assetLibrary,
    storyboardIndex: index,
    videoRatio: state.videoApiConfig.videoRatio,
  }), [chapter?.analysis, currentProject?.assetLibrary, state.videoApiConfig.videoRatio]);
  const batchGenerateDisabledReason = useMemo(() => {
    let readyPendingCount = 0;
    let blockedPendingCount = 0;
    let firstBlockedReason: string | null = null;

    allStoryboards.forEach((sb, index) => {
      const status = sb.videoStatus ?? 'idle';
      if (status !== 'idle' && status !== 'failed') return;
      if (!isStoryboardPromptReady(sb)) return;

      const readiness = getVideoSubmissionReadiness(sb, index);
      if (readiness.ready) {
        readyPendingCount += 1;
      } else {
        blockedPendingCount += 1;
        firstBlockedReason ??= readiness.reason;
      }
    });

    if (readyPendingCount > 0 || blockedPendingCount === 0) return null;
    return firstBlockedReason ?? SEEDANCE_FINAL_PROMPT_MISSING_MESSAGE;
  }, [allStoryboards, getVideoSubmissionReadiness]);
  const summary = useVideoProgressSummary(allStoryboards);
  const autoSave = useVideoAutoSaveEffect(state, currentProject);

  const {
    submitVideo,
    abortPolling: abortSubmitPolling,
    abortAllPolling,
    cancelVideoTask,
    abortPollingForTask,
    abortAllPollingTasks,
  } = useStep5TaskRuntime();

  const {
    isBatchGenerating,
    batchProgress,
    batchStartTime,
    handleBatchGenerate,
    cancelBatch,
    abortAllPollingRef,
  } = useBatchVideoGenerate(
    state.videoApiConfig,
    state,
    confirm,
  );

  useEffect(() => {
    abortAllPollingRef.current = async () => {
      abortAllPolling();
      await abortAllPollingTasks();
    };
  }, [abortAllPolling, abortAllPollingRef, abortAllPollingTasks]);

  const { exportAll } = useBatchExport(allStoryboards, {
    projectName: currentProject?.name,
    chapterName: chapter?.title,
  });
  const { requestPermission } = useVideoNotification(allStoryboards);
  const { dragState, onDragStart, onDragOver, onDragEnd } = useStoryboardDragSort();

  useBgmGeneration();

  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showLocalTaskHistory, setShowLocalTaskHistory] = useState(false);
  const [recoveringVideoIndex, setRecoveringVideoIndex] = useState<number | null>(null);
  const [usingHistoryTaskId, setUsingHistoryTaskId] = useState<string | null>(null);
  const [compressingStoryboardBoardIndex, setCompressingStoryboardBoardIndex] = useState<number | null>(null);
  const [compressingAllStoryboardBoards, setCompressingAllStoryboardBoards] = useState(false);
  const [compressAllStoryboardBoardProgress, setCompressAllStoryboardBoardProgress] = useState({ current: 0, total: 0 });
  const getBatchSelectDisabledReason = useCallback((sb: StoryboardState | undefined, index: number) => {
    if (!sb) return '这个镜头不存在，不能加入批量生成。';
    const videoState = getVideoState(sb);
    if (videoState.status === 'done') return '这个镜头已完成，不会重复加入批量生成。';
    if (videoState.status === 'submitting' || videoState.status === 'polling') {
      return '这个镜头正在生成中，不能重复加入批量生成。';
    }

    const readiness = getVideoSubmissionReadiness(sb, index);
    if (!readiness.ready) {
      return readiness.reason ?? SEEDANCE_FINAL_PROMPT_MISSING_MESSAGE;
    }

    return null;
  }, [getVideoSubmissionReadiness]);

  useEffect(() => {
    setIsSelectMode(false);
    setSelectedIndices(new Set());
  }, [chapter?.id]);

  useEffect(() => {
    setSelectedIndices((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<number>();
      prev.forEach((index) => {
        if (!getBatchSelectDisabledReason(allStoryboards[index], index)) {
          next.add(index);
        }
      });
      if (next.size === prev.size && Array.from(next).every((index) => prev.has(index))) {
        return prev;
      }
      return next;
    });
  }, [allStoryboards, getBatchSelectDisabledReason]);

  const compressStoryboardBoardUploadImage = useCallback(async (index: number) => {
    if (!chapter || compressingStoryboardBoardIndex !== null || compressingAllStoryboardBoards) return;
    const sb = chapter.storyboards[index];
    if (!sb) return;

    const selectedMode = getStoryboardBoardSelectedMode(sb.storyboardBoard);
    const variant = getStoryboardBoardVariant(sb.storyboardBoard, selectedMode);
    if (!variant?.blobKey) {
      toast.warning('请先在 Step4 生成宫格图。');
      return;
    }

    setCompressingStoryboardBoardIndex(index);
    try {
      const previousLightweightBlobKey = variant.lightweightBlobKey;
      const result = await compressStoryboardBoardForUpload(variant.blobKey, currentProject?.id);
      if (result.skippedNoGain || !result.blobKey) {
        toast.info(previousLightweightBlobKey
          ? '本次压缩没有明显变小，已保留原有宫格上传版。'
          : '本次压缩没有明显变小，暂不生成宫格上传版。');
        return;
      }

      dispatch({
        type: 'UPDATE_STORYBOARD',
        index,
        chapterId: chapter.id,
        updates: {
          storyboardBoard: mergeStoryboardBoardVariant(sb.storyboardBoard, selectedMode, {
            lightweightBlobKey: result.blobKey,
            lightweightMimeType: 'image/webp',
            lightweightQuality: STORYBOARD_BOARD_UPLOAD_WEBP_QUALITY_LABEL,
            lightweightOriginalBytes: result.originalBytes,
            lightweightBytes: result.compressedBytes,
            lightweightWidth: result.width,
            lightweightHeight: result.height,
            lightweightCreatedAt: Date.now(),
          }),
        },
      });

      if (previousLightweightBlobKey && previousLightweightBlobKey !== result.blobKey) {
        deleteBlob(previousLightweightBlobKey).catch(() => undefined);
      }

      toast.success(`宫格上传版已压缩：${formatBytes(result.originalBytes)} → ${formatBytes(result.compressedBytes)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`宫格压缩失败：${message}`);
    } finally {
      setCompressingStoryboardBoardIndex(null);
    }
  }, [chapter, compressingAllStoryboardBoards, compressingStoryboardBoardIndex, dispatch]);

  const compressAllStoryboardBoardUploadImages = useCallback(async () => {
    if (!chapter || compressingAllStoryboardBoards || compressingStoryboardBoardIndex !== null) return;

    const candidates = chapter.storyboards
      .map((sb, index) => {
        const selectedMode = getStoryboardBoardSelectedMode(sb.storyboardBoard);
        const variant = getStoryboardBoardVariant(sb.storyboardBoard, selectedMode);
        return variant?.blobKey ? { sb, index, selectedMode, variant, blobKey: variant.blobKey } : null;
      })
      .filter((item): item is NonNullable<typeof item> => !!item);

    if (candidates.length === 0) {
      toast.warning('本集还没有可压缩的分镜宫格图，请先在 Step4 生成。');
      return;
    }

    setCompressingAllStoryboardBoards(true);
    setCompressAllStoryboardBoardProgress({ current: 0, total: candidates.length });
    let compressedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    try {
      for (let i = 0; i < candidates.length; i += 1) {
        const { sb, index, selectedMode, variant, blobKey } = candidates[i];
        setCompressingStoryboardBoardIndex(index);
        setCompressAllStoryboardBoardProgress({ current: i, total: candidates.length });

        try {
          const previousLightweightBlobKey = variant.lightweightBlobKey;
          const result = await compressStoryboardBoardForUpload(blobKey, currentProject?.id);
          if (result.skippedNoGain || !result.blobKey) {
            skippedCount += 1;
            continue;
          }

          dispatch({
            type: 'UPDATE_STORYBOARD',
            index,
            chapterId: chapter.id,
            updates: {
              storyboardBoard: mergeStoryboardBoardVariant(sb.storyboardBoard, selectedMode, {
                lightweightBlobKey: result.blobKey,
                lightweightMimeType: 'image/webp',
                lightweightQuality: STORYBOARD_BOARD_UPLOAD_WEBP_QUALITY_LABEL,
                lightweightOriginalBytes: result.originalBytes,
                lightweightBytes: result.compressedBytes,
                lightweightWidth: result.width,
                lightweightHeight: result.height,
                lightweightCreatedAt: Date.now(),
              }),
            },
          });

          if (previousLightweightBlobKey && previousLightweightBlobKey !== result.blobKey) {
            deleteBlob(previousLightweightBlobKey).catch(() => undefined);
          }
          compressedCount += 1;
        } catch {
          failedCount += 1;
        } finally {
          setCompressAllStoryboardBoardProgress({ current: i + 1, total: candidates.length });
        }
      }

      if (compressedCount > 0) {
        toast.success(`已压缩 ${compressedCount} 张分镜宫格图${skippedCount ? `，${skippedCount} 张无需更新` : ''}${failedCount ? `，${failedCount} 张失败` : ''}。`);
      } else if (failedCount > 0) {
        toast.error(`宫格图压缩完成，但 ${failedCount} 张失败，请稍后重试。`);
      } else {
        toast.info('全部宫格图已经是合适的上传体积，本次没有生成新的压缩版。');
      }
    } finally {
      setCompressingStoryboardBoardIndex(null);
      setCompressingAllStoryboardBoards(false);
      setCompressAllStoryboardBoardProgress({ current: 0, total: 0 });
    }
  }, [chapter, compressingAllStoryboardBoards, compressingStoryboardBoardIndex, dispatch]);

  const replaceCurrentVideoReferenceImage = useCallback(async (
    item: EffectiveVideoReferenceItem,
    file: File,
  ) => {
    if (!chapter) return;
    const storyboard = chapter.storyboards[currentStoryboardIndex];
    if (!storyboard) return;

    if (item.type === 'storyboard-board') {
      if (!file.type.startsWith('image/')) {
        toast.warning('请选择本地图片文件。');
        return;
      }

      try {
        const blobKey = await saveBlob(file);
        const selectedMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
        const variant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedMode);
        const previousBlobKey = variant?.blobKey;
        const previousVisualBoardBlobKey = variant?.visualBoardBlobKey;
        const previousLightweightBlobKey = variant?.lightweightBlobKey;
        const previousReferencePack = variant?.referencePack ?? [];
        const nextStoryboardBoard = mergeStoryboardBoardVariant(storyboard.storyboardBoard, selectedMode, {
          status: 'done',
          blobKey,
          visualBoardBlobKey: undefined,
          lightweightBlobKey: undefined,
          lightweightMimeType: undefined,
          lightweightQuality: undefined,
          lightweightOriginalBytes: undefined,
          lightweightBytes: undefined,
          lightweightWidth: undefined,
          lightweightHeight: undefined,
          lightweightCreatedAt: undefined,
          referencePack: [],
          generatedAt: Date.now(),
          error: undefined,
          isStale: false,
        });

        dispatch({
          type: 'UPDATE_STORYBOARD',
          index: currentStoryboardIndex,
          chapterId: chapter.id,
          updates: {
            storyboardBoard: nextStoryboardBoard,
            useStoryboardBoardReference: true,
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
        previousReferencePack.forEach((packItem) => {
          deleteBlob(packItem.blobKey).catch(() => undefined);
        });

        toast.success('已替换故事板参考图，本次视频提交会使用新图。');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`替换故事板失败：${message}`);
      }
      return;
    }

    if (!isAssetVideoReferenceItem(item)) {
      toast.warning('这张参考图不是 Step3 资产图，暂不能在 Step5 直接替换。');
      return;
    }
    if (!currentProject) return;
    if (!file.type.startsWith('image/')) {
      toast.warning('请选择本地图片文件。');
      return;
    }
    if (item.asset.source === 'volc_virtual_human') {
      toast.warning('官方身份图需要回到 Step3 更换；Step5 只替换本地参考图片。');
      return;
    }

    const baseImageRefs = getStoryboardVideoImageRefs(storyboard);
    const targetIndex = findVideoImageRefIndex(baseImageRefs, item);
    if (targetIndex < 0) {
      toast.warning('没有找到这张参考图对应的分镜引用，暂不能替换。');
      return;
    }

    try {
      const blobKey = await saveBlob(file);
      const now = Date.now();
      const replacementAsset: Asset = {
        ...item.asset,
        ...clearLightweightAssetFields(),
        id: createLocalId(),
        source: 'local',
        externalAssetId: undefined,
        externalAssetUri: undefined,
        externalImageUrl: undefined,
        externalImageExpiresAt: undefined,
        externalSourceModel: undefined,
        thumbnailUrl: undefined,
        catalogTags: undefined,
        blobKey,
        description: item.asset.description || `Step5 本次视频提交替换图：${item.name}`,
        generationMode: 'upload',
        usedInStoryboards: [`step5-video-ref:${chapter.id}:${currentStoryboardIndex}:${item.sourceRefId || item.refId}`],
        createdAt: now,
        updatedAt: now,
      };
      const nextImageRefs = baseImageRefs.map((ref, index) => (
        index === targetIndex
          ? { ...ref, assetId: replacementAsset.id, assetBindingMode: 'manual' as const }
          : ref
      ));

      dispatch({ type: 'ADD_ASSET', asset: replacementAsset, skipAutoRelink: true });
      dispatch({
        type: 'UPDATE_STORYBOARD',
        index: currentStoryboardIndex,
        chapterId: chapter.id,
        updates: {
          videoImageRefs: nextImageRefs,
        },
      });
      toast.success(`已替换 ${item.name} 的本次提交参考图。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`替换参考图失败：${message}`);
    }
  }, [chapter, currentProject, currentStoryboardIndex, dispatch]);

  const removeCurrentVideoReferenceImage = useCallback((item: EffectiveVideoReferenceItem) => {
    if (!chapter) return;
    const storyboard = chapter.storyboards[currentStoryboardIndex];
    if (!storyboard) return;
    if (!isAssetVideoReferenceItem(item)) {
      toast.warning('这张参考图不是 Step3 资产图，暂不能在 Step5 直接删除。');
      return;
    }

    const baseImageRefs = getStoryboardVideoImageRefs(storyboard);
    const targetIndex = findVideoImageRefIndex(baseImageRefs, item);
    if (targetIndex < 0) {
      toast.warning('没有找到这张参考图对应的分镜引用，暂不能删除。');
      return;
    }

    const nextImageRefs = baseImageRefs.filter((_ref, index) => index !== targetIndex);
    dispatch({
      type: 'UPDATE_STORYBOARD',
      index: currentStoryboardIndex,
      chapterId: chapter.id,
      updates: {
        videoImageRefs: nextImageRefs,
      },
    });
    toast.success(`已从本次视频提交删除 ${item.name}；Step3 原图不会被删除。`);
  }, [chapter, currentStoryboardIndex, dispatch]);

  const restoreCurrentVideoReferences = useCallback(() => {
    if (!chapter) return;
    dispatch({
      type: 'UPDATE_STORYBOARD',
      index: currentStoryboardIndex,
      chapterId: chapter.id,
      updates: {
        videoImageRefs: undefined,
      },
    });
    toast.success('已恢复 Step4 默认参考图。');
  }, [chapter, currentStoryboardIndex, dispatch]);

  const optimizeCurrentVideoPrompt = useCallback(async (index: number) => {
    if (!chapter || !currentProject) return;
    const sb = chapter.storyboards[index];
    if (!sb || !(sb.prompt?.rawText?.trim() || sb.seedanceFinalVideoPrompt?.trim())) {
      toast.warning('请先生成分镜提示词。');
      return;
    }

    const imageRefs = getStoryboardVideoImageRefs(sb);
    const storyboardBoardReference = resolveStoryboardBoardVideoReferenceState(sb);
    const isDirectorMode = isStoryboardDirectorMode(sb);
    const imageReferenceLimit = getVideoImageReferenceLimit(state.videoApiConfig);
    const referenceResolution = resolveVideoReferenceAssets(
      imageRefs,
      currentProject.assetLibrary ?? [],
      storyboardBoardReference,
      sb.scenePositionBoard,
      state.videoApiConfig.videoRatio,
      {
        includeScenePositionBoard: false,
        useStoryboardBoardReferencePack: isDirectorMode,
        finalVideoPrompt: sb.seedanceFinalVideoPrompt?.trim() || sb.prompt?.rawText?.trim(),
        imageReferenceLimit,
      },
    );

    if (referenceResolution.missing.length > 0) {
      toast.warning(buildMissingVideoReferenceMessage(referenceResolution.missing));
      return;
    }

    if (referenceResolution.exceedsLimit) {
      toast.warning(buildVideoReferenceLimitMessage(referenceResolution.totalRefs, imageReferenceLimit));
      return;
    }

    if (referenceResolution.promptOrder.checked && !referenceResolution.promptOrder.valid) {
      toast.warning(referenceResolution.promptOrder.message ?? 'Step5 参考图顺序与最终视频词中的【@图片x】编号不一致，请先返回 Step4 刷新最终视频词。');
      return;
    }

    if (storyboardBoardReference.enabled && !storyboardBoardReference.available) {
      toast.warning(storyboardBoardReference.reason ?? '当前详细九宫格暂不可作为视频参考图。');
      return;
    }

    const includeStoryboardBoardInPrompt = storyboardBoardReference.enabled && referenceResolution.storyboardBoardIncluded;
    const basePrompt = sanitizeMisboundImageReferenceLabels(buildEffectiveVideoPrompt(sb.prompt?.rawText ?? '', {
      includeStoryboardBoardReference: includeStoryboardBoardInPrompt,
      storyboardBoardAvailable: includeStoryboardBoardInPrompt,
      storyboardBoardReferenceLabel: referenceResolution.storyboardBoardRefId ?? `参考图片${Math.min(referenceResolution.effectiveItems.length + 1, imageReferenceLimit)}`,
      storyboardBoardModeLabel: storyboardBoardReference.modeLabel,
    }), imageRefs);
    const desensitizeSourcePrompt = isDirectorMode
      ? buildFinalVideoSubmitPrompt(sb, basePrompt, imageRefs, {
          effectiveItems: referenceResolution.effectiveItems,
          omittedItems: referenceResolution.budget.omittedItems,
          videoRatio: state.videoApiConfig.videoRatio,
          ignoreCompactPrompt: true,
        })
      : basePrompt;

    dispatch({
      type: 'UPDATE_STORYBOARD',
      index,
      updates: {
        compactVideoPromptMode: 'desensitized',
        compactVideoPromptStatus: 'optimizing',
        compactVideoPromptError: undefined,
      },
      chapterId: chapter.id,
    });

    try {
      const failedReason = sb.videoStatus === 'failed' ? sb.videoError : undefined;
      const finalCompactPrompt = (await callApiViaBff(
        state.apiConfig,
        [
          {
            role: 'user',
            content: buildVideoPromptDesensitizePayload(desensitizeSourcePrompt, { failedReason }),
          },
        ],
        {
          templateType: 'video_prompt_desensitize',
          templateVars: { videoRatio: state.videoApiConfig.videoRatio },
        },
        { temperature: 0.15, maxTokens: 8000 },
      )).trim();

      const validation = validateDesensitizedVideoPrompt(desensitizeSourcePrompt, finalCompactPrompt);
      if (!validation.ok) {
        throw new Error(validation.reason ?? '脱敏提示词校验失败。');
      }

      dispatch({
        type: 'UPDATE_STORYBOARD',
        index,
        updates: {
          useCompactVideoPrompt: true,
          compactVideoPrompt: finalCompactPrompt,
          compactVideoPromptMode: 'desensitized',
          compactVideoPromptStatus: 'done',
          compactVideoPromptError: undefined,
          compactVideoPromptSourcePrompt: desensitizeSourcePrompt,
          compactVideoPromptUpdatedAt: Date.now(),
        },
        chapterId: chapter.id,
      });
      toast.success('脱敏版视频提示词已生成并启用，请重新提交视频。');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dispatch({
        type: 'UPDATE_STORYBOARD',
        index,
        updates: {
          compactVideoPromptStatus: 'failed',
          compactVideoPromptError: message,
        },
        chapterId: chapter.id,
      });
      toast.error(`脱敏失败：${message}`);
    }
  }, [chapter, currentProject, dispatch, callApiViaBff, state.apiConfig, state.videoApiConfig]);

  const recoverVolcResult = useCallback(async (index: number) => {
    if (!chapter) return;
    const storyboard = chapter.storyboards[index];
    if (!storyboard) return;

    const isVolcTask = storyboard.videoBackend === 'volcengine'
      || (state.videoApiConfig.backend === 'volcengine' && !!storyboard.videoTaskId);

    if (!isVolcTask || !storyboard.videoTaskId) {
      toast.warning('当前视频缺少火山任务信息，无法重新下载结果。');
      return;
    }

    if (!state.videoApiConfig.volcApiKey) {
      toast.warning('请先在 API 设置中填写火山引擎视频 API Key。');
      return;
    }

    setRecoveringVideoIndex(index);
    try {
      const latestVideoUrl = await volcResolveCompletedVideoUrl(
        state.videoApiConfig,
        storyboard.videoTaskId,
        storyboard.videoUrl ?? undefined,
      );

      if (!latestVideoUrl) {
        toast.info('火山任务还在处理中，请稍后再试。');
        return;
      }

      const result = await cacheVideoBlob(latestVideoUrl, index, chapter.id, dispatch);
      if (result.mode === 'cached') {
        toast.success('已重新下载并更新本地视频缓存。');
      } else {
        toast.warning(`结果已刷新，但本地缓存校验未通过${result.reason ? `：${result.reason}` : ''}，当前将回退使用远端结果。`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`重新下载失败：${message}`);
    } finally {
      setRecoveringVideoIndex((current) => (current === index ? null : current));
    }
  }, [chapter, dispatch, state.videoApiConfig]);

  const buildSeedanceRecoveryPrompt = useCallback((index: number) => {
    if (!chapter || !currentProject) return null;
    const storyboard = chapter.storyboards[index];
    if (!storyboard) return null;

    const directorMode = isStoryboardDirectorMode(storyboard);
    const imageRefs = getStoryboardVideoImageRefs(storyboard);
    const storyboardBoardReference = resolveStoryboardBoardVideoReferenceState(storyboard);
    const imageReferenceLimit = getVideoImageReferenceLimit(state.videoApiConfig);
    const resolution = resolveVideoReferenceAssets(
      imageRefs,
      currentProject.assetLibrary,
      storyboardBoardReference,
      storyboard.scenePositionBoard,
      state.videoApiConfig.videoRatio,
      {
        includeScenePositionBoard: false,
        useStoryboardBoardReferencePack: directorMode,
        finalVideoPrompt: storyboard.seedanceFinalVideoPrompt?.trim() || storyboard.prompt?.rawText?.trim(),
        imageReferenceLimit,
      },
    );
    const shouldUseStoryboardBoardReference = storyboardBoardReference.enabled && resolution.storyboardBoardIncluded;
    const basePrompt = buildEffectiveVideoPrompt(storyboard.prompt?.rawText ?? '', {
      includeStoryboardBoardReference: !directorMode && shouldUseStoryboardBoardReference,
      storyboardBoardAvailable: storyboardBoardReference.available,
      storyboardBoardReferenceLabel: resolution.storyboardBoardRefId || (`参考图片${resolution.totalRefs}`),
      storyboardBoardModeLabel: storyboardBoardReference.modeLabel,
    });

    const compactSourcePrompt = directorMode
      ? buildFinalVideoSubmitPrompt(storyboard, basePrompt, imageRefs, {
          effectiveItems: resolution.effectiveItems,
          omittedItems: resolution.budget.omittedItems,
          videoRatio: state.videoApiConfig.videoRatio,
          ignoreCompactPrompt: true,
        })
      : basePrompt;

    const autoPrompt = buildFinalVideoSubmitPrompt(storyboard, compactSourcePrompt, imageRefs, {
      effectiveItems: resolution.effectiveItems,
      omittedItems: resolution.budget.omittedItems,
      videoRatio: state.videoApiConfig.videoRatio,
    });
    const overrideState = getVideoSubmitPromptOverrideState(storyboard, autoPrompt);
    return overrideState.isUsable ? overrideState.prompt : autoPrompt;
  }, [chapter, currentProject, state.videoApiConfig]);

  const recoverSeedanceResult = useCallback(async (index: number) => {
    if (!chapter) return;
    const storyboard = chapter.storyboards[index];
    if (!storyboard) return;

    setRecoveringVideoIndex(index);
    try {
      const seedanceConfig = isSeedanceServiceBackend(state.videoApiConfig.backend)
        ? state.videoApiConfig
        : { ...state.videoApiConfig, backend: 'seedance' as const };
      const tasks = await listSeedanceTasks(30, seedanceConfig);
      let matched = storyboard.videoClientTaskId
        ? tasks.find((task) => task.client_task_id === storyboard.videoClientTaskId)
        : undefined;

      if (!isRecoverableSeedanceTask(matched)) {
        const expectedPrompt = buildSeedanceRecoveryPrompt(index);
        if (!expectedPrompt) {
          toast.warning('当前分镜缺少可用于匹配的提交词，无法自动恢复小云雀结果。');
          return;
        }

        const scored = tasks
          .map((task) => ({
            task,
            score: scoreSeedanceTaskMatch(task, expectedPrompt, {
              duration: resolveStoryboardSubmitDuration(storyboard, state.videoApiConfig),
              ratio: state.videoApiConfig.videoRatio,
              storyboardName: storyboard.storyboard?.name,
            }),
          }))
          .filter((item) => item.score >= 65)
          .sort((a, b) => b.score - a.score);
        matched = scored[0]?.task;
      }

      if (!isRecoverableSeedanceTask(matched)) {
        toast.warning('没有在小云雀历史任务中找到可绑定到当前分镜的成功结果。');
        return;
      }

      if (storyboard.videoTaskId) {
        abortPollingForTask(storyboard.videoTaskId, storyboard.videoBackend, { remoteCancel: false });
      }
      abortSubmitPolling({ chapterId: chapter.id, storyboardIndex: index });

      const recoveredVideoUrl = getSeedanceTaskVideoUrl(matched, seedanceConfig)
        || storyboard.videoUrl?.trim()
        || '';
      const result = await cacheVideoBlob(
        recoveredVideoUrl,
        index,
        chapter.id,
        dispatch,
        {
          completedAt: parseSeedanceTimestamp(matched.completed_at),
          taskId: matched.task_id,
          clientTaskId: matched.client_task_id ?? storyboard.videoClientTaskId,
          submittedAt: parseSeedanceTimestamp(matched.created_at),
          duration: matched.duration ?? resolveStoryboardSubmitDuration(storyboard, state.videoApiConfig),
          backend: seedanceConfig.backend,
        },
      );
      if (result.mode === 'cached') {
        toast.success('已恢复小云雀结果，并写入本地视频缓存。');
      } else {
        toast.warning(`已恢复小云雀结果，但本地缓存未写入${result.reason ? `：${result.reason}` : ''}。`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`小云雀结果恢复失败：${message}`);
    } finally {
      setRecoveringVideoIndex((current) => (current === index ? null : current));
    }
  }, [abortPollingForTask, abortSubmitPolling, buildSeedanceRecoveryPrompt, chapter, dispatch, state.videoApiConfig]);

  const useHistoryTaskResult = useCallback(async (task: VolcHistoryTask) => {
    if (!chapter) return;
    if (task.status !== 'succeeded' || !task.video_url) {
      toast.warning('这个历史任务还没有可用成片，暂时不能绑定到当前分镜。');
      return;
    }

    const current = chapter.storyboards[currentStoryboardIndex];
    if (!current) return;

    const isRunning = current.videoStatus === 'submitting' || current.videoStatus === 'polling';
    const isDone = current.videoStatus === 'done';

    if (isRunning) {
      const confirmed = await confirm('当前分镜还有进行中的视频任务。继续导入历史结果会先停止当前任务，是否继续？');
      if (!confirmed) return;
      if (current.videoTaskId) {
        abortPollingForTask(current.videoTaskId, current.videoBackend);
      }
      abortSubmitPolling({ chapterId: chapter.id, storyboardIndex: currentStoryboardIndex });
    } else if (isDone) {
      const confirmed = await confirm('当前分镜已经有视频结果。继续导入历史任务会覆盖当前视频，是否继续？');
      if (!confirmed) return;
    }

    setUsingHistoryTaskId(task.id);
    try {
      dispatch({
        type: 'SUBMIT_VIDEO',
        index: currentStoryboardIndex,
        taskId: task.id,
        chapterId: chapter.id,
        backend: 'volcengine',
      });
      const result = await cacheVideoBlob(task.video_url, currentStoryboardIndex, chapter.id, dispatch);
      if (result.mode === 'cached') {
        toast.success('已把历史任务结果绑定到当前分镜。');
      } else {
        toast.warning(`已绑定远端结果，但本地缓存校验未通过${result.reason ? `：${result.reason}` : ''}。`);
      }
      setShowHistory(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`绑定历史结果失败：${message}`);
    } finally {
      setUsingHistoryTaskId((currentTaskId) => (currentTaskId === task.id ? null : currentTaskId));
    }
  }, [
    abortPollingForTask,
    abortSubmitPolling,
    chapter,
    confirm,
    currentStoryboardIndex,
    dispatch,
  ]);

  const restoreLocalTaskLogEntry = useCallback(async (entry: Step5VideoTaskLogEntry) => {
    const targetChapter = currentProject?.chapters.find((item) => item.id === entry.chapterId);
    const targetStoryboard = targetChapter?.storyboards[entry.storyboardIndex];
    if (!targetChapter || !targetStoryboard) {
      toast.warning('日志对应的章节或分镜不存在，无法恢复。');
      return;
    }

    const isRunning = targetStoryboard.videoStatus === 'submitting' || targetStoryboard.videoStatus === 'polling';
    const isDone = targetStoryboard.videoStatus === 'done';
    if (isRunning) {
      const confirmed = await confirm('这个分镜还有进行中的视频任务。继续恢复历史任务会先停止当前本地等待，是否继续？');
      if (!confirmed) return;
      if (targetStoryboard.videoTaskId) {
        abortPollingForTask(targetStoryboard.videoTaskId, targetStoryboard.videoBackend, { remoteCancel: false });
      }
      abortSubmitPolling({ chapterId: entry.chapterId, storyboardIndex: entry.storyboardIndex });
    } else if (isDone && entry.videoUrl !== targetStoryboard.videoUrl) {
      const confirmed = await confirm('这个分镜已经有视频结果。继续恢复会覆盖当前绑定的视频结果，是否继续？');
      if (!confirmed) return;
    }

    dispatch({ type: 'SWITCH_CHAPTER', projectId: currentProject?.id, chapterId: entry.chapterId });
    dispatch({ type: 'SET_CURRENT_STORYBOARD_INDEX', index: entry.storyboardIndex });

    const backend = entry.backend ?? targetStoryboard.videoBackend ?? state.videoApiConfig.backend;
    const providerTaskId = entry.providerTaskId?.trim();
    const seedancePendingTaskId = isSeedanceServiceBackend(backend) && entry.clientTaskId
      ? 'seedance-pending'
      : undefined;
    const taskId = providerTaskId || seedancePendingTaskId;

    if (entry.videoUrl) {
      setRecoveringVideoIndex(entry.storyboardIndex);
      try {
        if (taskId) {
          dispatch({
            type: 'SUBMIT_VIDEO',
            index: entry.storyboardIndex,
            taskId,
            clientTaskId: entry.clientTaskId,
            submittedAt: entry.submittedAt,
            duration: entry.duration,
            chapterId: entry.chapterId,
            backend,
            productionMode: entry.productionMode,
            continuityGroupId: entry.continuityGroupId,
            continuityReason: entry.continuityReason,
            extendSourceIndex: entry.extendSourceIndex,
            extendSourceTaskId: entry.extendSourceTaskId,
            extendSourceBlobKey: entry.extendSourceBlobKey,
            extendSubmittedAsExtend: entry.extendSubmittedAsExtend,
          });
        }
        const result = await cacheVideoBlob(
          entry.videoUrl,
          entry.storyboardIndex,
          entry.chapterId,
          dispatch,
          { completedAt: entry.completedAt ?? Date.now() },
        );
        if (result.mode === 'cached') {
          toast.success('已从本机任务日志恢复视频，并写入本地缓存。');
        } else {
          toast.warning(`已恢复远端视频结果${result.reason ? `，但本地缓存未写入：${result.reason}` : '。'}`);
        }
        setShowLocalTaskHistory(false);
      } finally {
        setRecoveringVideoIndex((current) => (current === entry.storyboardIndex ? null : current));
      }
      return;
    }

    if (!taskId) {
      toast.warning('这条日志没有可用 taskId；如果远端服务支持历史查询，请在对应模型的历史任务面板中找回。');
      return;
    }

    dispatch({
      type: 'SUBMIT_VIDEO',
      index: entry.storyboardIndex,
      taskId,
      clientTaskId: entry.clientTaskId,
      submittedAt: entry.submittedAt,
      duration: entry.duration,
      chapterId: entry.chapterId,
      backend,
      productionMode: entry.productionMode,
      continuityGroupId: entry.continuityGroupId,
      continuityReason: entry.continuityReason,
      extendSourceIndex: entry.extendSourceIndex,
      extendSourceTaskId: entry.extendSourceTaskId,
      extendSourceBlobKey: entry.extendSourceBlobKey,
      extendSubmittedAsExtend: entry.extendSubmittedAsExtend,
    });
    toast.success('已从本机任务日志恢复任务状态，系统会继续轮询远端结果。');
    setShowLocalTaskHistory(false);
  }, [
    abortPollingForTask,
    abortSubmitPolling,
    confirm,
    currentProject,
    dispatch,
    state.videoApiConfig.backend,
  ]);

  const resetVideo = useCallback(async (index: number) => {
    const sb = allStoryboards[index];
    const isDone = sb?.videoStatus === 'done';
    const isPolling = sb?.videoStatus === 'polling' || sb?.videoStatus === 'submitting';

    if (isDone) {
      const confirmed = await confirm('确定要重置此视频吗？已生成的视频会被清除，重新生成会再次消耗视频额度。');
      if (!confirmed) return;
    }
    if (isPolling) {
      const confirmed = await confirm('确定要取消当前正在生成的视频吗？');
      if (!confirmed) return;
    }

    if (sb?.videoTaskId) {
      abortPollingForTask(sb.videoTaskId, sb.videoBackend);
    }
    abortSubmitPolling({ chapterId: chapter?.id ?? '', storyboardIndex: index });
    dispatch({ type: 'CLEAR_VIDEO', index, chapterId: chapter?.id });
  }, [chapter?.id, allStoryboards, abortPollingForTask, abortSubmitPolling, confirm, dispatch]);

  const handleDrop = useCallback((fromIndex: number, toIndex: number) => {
    if (!chapter) return;
    dispatch({ type: 'REORDER_STORYBOARDS', chapterId: chapter.id, fromIndex, toIndex });
  }, [chapter, dispatch]);

  const handleCellClick = useCallback((index: number, isSelectable: boolean) => {
    if (isSelectMode) {
      if (!isSelectable) {
        toast.info(getBatchSelectDisabledReason(allStoryboards[index], index) ?? '这个镜头不能加入批量生成。');
        return;
      }
      setSelectedIndices((prev) => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
      return;
    }

    dispatch({ type: 'SET_CURRENT_STORYBOARD_INDEX', index });
  }, [allStoryboards, dispatch, getBatchSelectDisabledReason, isSelectMode]);

  if (!chapter) return null;

  const currentSb = allStoryboards[currentStoryboardIndex];
  const currentStep4DurationSeconds = getStoryboardStep4VideoDurationSeconds(currentSb);
  const currentStoryboardDurationLabel = currentStep4DurationSeconds
    ? `${formatStoryboardDurationSeconds(currentStep4DurationSeconds)} · 智能时长`
    : (currentSb?.storyboard.duration || '时长待补充');
  const currentImageRefs = getStoryboardVideoImageRefs(currentSb);
  const currentVideoState = currentSb ? getVideoState(currentSb) : null;
  const currentVideoBackend = currentSb?.videoBackend ?? state.videoApiConfig.backend;
  const projectUsesOfficialVirtualHumans = !!currentProject?.step3Settings?.useVolcVirtualHumans
    || hasOfficialVirtualHumanProjectAssets(currentProject?.assetLibrary);
  const officialVirtualHumanBackendReady = isOfficialVirtualHumanCompatibleVideoBackend(state.videoApiConfig.backend);
  const currentVideoContinuityDecision = currentSb
    ? getStoryboardVideoContinuityDecision(allStoryboards, currentStoryboardIndex)
    : undefined;
  const batchControls = (
    <BatchControlBar
      className="step5-next-command-bar border-transparent bg-transparent p-0 shadow-none dark:border-transparent dark:bg-transparent"
      summary={summary}
      isBatchGenerating={isBatchGenerating}
      batchProgress={batchProgress}
      isSelectMode={isSelectMode}
      selectedCount={selectedIndices.size}
      onToggleSelectMode={() => {
        setIsSelectMode((value) => !value);
        if (isSelectMode) setSelectedIndices(new Set());
      }}
      batchGenerateDisabledReason={batchGenerateDisabledReason}
      onBatchGenerate={async () => {
        if (isSelectMode && selectedIndices.size > 0) {
          const indices = Array.from(selectedIndices)
            .filter((index) => !getBatchSelectDisabledReason(allStoryboards[index], index));
          if (indices.length === 0) {
            toast.warning('请先选择可生成的待生成镜头。');
            setSelectedIndices(new Set());
            return;
          }
          await handleBatchGenerate(undefined, {
            chapterId: chapter.id,
            indices,
          });
          setIsSelectMode(false);
          setSelectedIndices(new Set());
        } else {
          await handleBatchGenerate(undefined, { chapterId: chapter.id });
        }
      }}
      onRetryFailed={async () => {
        const confirmed = await confirm(`确定要重新生成全部 ${summary.failedCount} 个失败镜头视频吗？`);
        if (!confirmed) return;
        dispatch({ type: 'RESET_ERROR_VIDEOS', chapterId: chapter.id });
        setTimeout(() => {
          handleBatchGenerate(undefined, { chapterId: chapter.id });
        }, 100);
      }}
      onCancelBatch={cancelBatch}
      onExportAll={exportAll}
      notificationPermission={typeof Notification !== 'undefined' ? Notification.permission : 'default'}
      onRequestNotification={requestPermission}
    />
  );

  return (
    <div className="space-y-6">
      <Card className="surface-panel border-white/70 !py-4">
        <CardHeader className="gap-3 px-4 pb-3 sm:px-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-sm">
                  5
                </span>
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="rounded-full bg-[linear-gradient(135deg,#ff7a4f,#ff4f7d)] px-3 text-white hover:bg-[linear-gradient(135deg,#ff7a4f,#ff4f7d)]">
                      视频工作台
                    </Badge>
                    <Badge variant="outline" className="rounded-full bg-white/70 dark:bg-white/5">
                      {getVideoBackendDisplayName(state.videoApiConfig.backend)}
                    </Badge>
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/65 px-2.5 py-1 text-xs text-muted-foreground shadow-sm dark:border-white/10 dark:bg-white/5">
                      可生成 <strong className="text-foreground">{summary.totalWithPrompt}</strong>
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/65 px-2.5 py-1 text-xs text-muted-foreground shadow-sm dark:border-white/10 dark:bg-white/5">
                      完成 <strong className="text-foreground">{summary.doneCount}</strong>
                      {summary.pollingCount > 0 && <span>· 进行中 {summary.pollingCount}</span>}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs shadow-sm ${
                      summary.failedCount > 0
                        ? 'border-red-200/80 bg-red-50/80 text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100'
                        : 'border-white/70 bg-white/65 text-muted-foreground dark:border-white/10 dark:bg-white/5'
                    }`}
                    >
                      待生成/失败 <strong className={summary.failedCount > 0 ? 'text-red-700 dark:text-red-100' : 'text-foreground'}>{summary.pendingCount + summary.failedCount}</strong>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <CardTitle className="flex items-center gap-2 whitespace-nowrap text-lg">生成单分镜视频</CardTitle>
                    <span className="text-xs leading-5 text-muted-foreground">
                      批量推进本集；失败、画面不稳或需要替换时，再进入单镜头处理。
                    </span>
                  </div>
                  {projectUsesOfficialVirtualHumans && (
                    <div className={`max-w-3xl rounded-xl border px-2.5 py-1.5 text-[11px] leading-5 ${
                      officialVirtualHumanBackendReady
                        ? 'border-blue-200/80 bg-blue-50/80 text-blue-800 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-100'
                        : 'border-amber-200/80 bg-amber-50/90 text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100'
                    }`}
                    >
                      <span className="font-semibold">官方虚拟人脸库：</span>
                      {officialVirtualHumanBackendReady
                        ? '当前视频后端已匹配，官方身份图会作为火山方舟 asset:// 参考图提交。'
                        : getOfficialVirtualHumanIncompatibleMessage(state.videoApiConfig.backend)}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-2 xl:w-[340px]">
              <div className="rounded-xl border border-white/70 bg-white/65 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-white/5">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] text-muted-foreground">当前选中镜头</div>
                    <div
                      className="mt-0.5 truncate text-sm font-semibold"
                      title={currentSb?.storyboard ? `分镜${String(currentSb.storyboard.number).padStart(2, '0')} · ${currentSb.storyboard.name}` : undefined}
                    >
                      {currentSb?.storyboard
                        ? `分镜${String(currentSb.storyboard.number).padStart(2, '0')} · ${currentSb.storyboard.name}`
                        : '未选择分镜'}
                    </div>
                  </div>
                  {currentVideoState && (
                    <Badge
                      variant={
                        currentVideoState.status === 'done'
                          ? 'default'
                          : currentVideoState.status === 'failed'
                            ? 'destructive'
                            : currentVideoState.status === 'submitting' || currentVideoState.status === 'polling'
                              ? 'secondary'
                              : 'outline'
                      }
                      className="shrink-0 rounded-full"
                    >
                      {currentVideoState.status === 'done'
                        ? '已完成'
                        : currentVideoState.status === 'failed'
                          ? '失败'
                          : currentVideoState.status === 'submitting' || currentVideoState.status === 'polling'
                            ? '生成中'
                            : '待生成'}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {currentSb?.storyboard
                    ? `${currentStoryboardDurationLabel} · ${currentSb.storyboard.shotSize || '景别待补充'}`
                    : '请选择一个镜头后开始处理。'}
                </div>
              </div>
              {state.videoApiConfig.backend === 'volcengine' && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-white/70 bg-white/65 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-white/5">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-foreground">火山任务恢复</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      历史任务、成片重绑
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 rounded-lg px-2.5 text-xs"
                    onClick={() => setShowHistory(true)}
                  >
                    任务面板
                  </Button>
                </div>
              )}
            </div>
          </div>
          <VideoQuickParams
            videoConfig={state.videoApiConfig}
            dispatch={dispatch}
            currentSubmitDurationSeconds={currentSb ? resolveStoryboardSubmitDuration(currentSb, state.videoApiConfig) : undefined}
            requiresVolcengineForOfficialVirtualHuman={projectUsesOfficialVirtualHumans}
          />


          {isBatchGenerating && batchProgress.total > 0 && (
            <div className="mt-3 space-y-2">
              <Progress value={(batchProgress.current / batchProgress.total) * 100} className="h-2" />
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  {batchProgress.current}/{batchProgress.total} 完成（{Math.round((batchProgress.current / batchProgress.total) * 100)}%）
                </span>
                <span>预计剩余 {estimateRemainingTime(batchProgress.current, batchProgress.total, batchStartTime ?? 0)}</span>
              </div>
            </div>
          )}
        </CardHeader>
      </Card>

      {currentSb && (
        <StoryboardVideoCard
          sb={currentSb}
          sbIndex={currentStoryboardIndex}
          projectId={currentProject?.id}
          imageRefs={currentImageRefs}
          videoState={getVideoState(currentSb)}
          assetLibrary={currentProject?.assetLibrary ?? []}
          videoBackend={state.videoApiConfig.backend}
          videoConfig={state.videoApiConfig}
          characterVoiceReferences={currentProject?.characterVoiceReferences ?? []}
          videoRatio={state.videoApiConfig.videoRatio}
          useVideoExtension={isVideoExtensionEnabled(state.videoApiConfig)}
          videoContinuityDecision={currentVideoContinuityDecision}
          batchControls={batchControls}
          workspaceTools={(
            <div className="grid gap-3 md:grid-cols-2">
              {autoSave.supported && (
                <div className="rounded-xl border border-blue-200/80 bg-blue-50/80 px-3 py-3 shadow-sm dark:border-blue-400/30 dark:bg-blue-500/10">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-semibold text-blue-900 dark:text-blue-100">
                        <FolderOpen className="h-4 w-4" />
                        自动保存目录
                      </div>
                      <div className="mt-1 text-xs leading-5 text-blue-700/80 dark:text-blue-100/75">
                        {autoSave.hasDir
                          ? <>视频完成后会保存到：<span className="font-medium text-blue-950 dark:text-blue-50">{autoSave.dirName}</span></>
                          : '选择本地输出目录，视频完成后会自动保存到文件夹。'}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                      <Button type="button" size="sm" className="h-8 rounded-lg" onClick={autoSave.selectDir}>
                        {autoSave.hasDir ? '更换目录' : '选择目录'}
                      </Button>
                      {autoSave.hasDir && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-lg bg-white/70 dark:bg-white/5"
                          onClick={async () => {
                            await autoSave.clearDir();
                            toast.success('已清除输出目录。');
                          }}
                        >
                          取消
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-violet-200/80 bg-violet-50/80 px-3 py-3 shadow-sm dark:border-violet-400/30 dark:bg-violet-500/10">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-violet-900 dark:text-violet-100">
                      <ListChecks className="h-4 w-4" />
                      本机任务日志
                    </div>
                    <div className="mt-1 text-xs leading-5 text-violet-700/80 dark:text-violet-100/75">
                      刷新、崩溃或中断后，可在这里恢复轮询、对账 taskId 和补回结果。
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 rounded-lg bg-white/70 dark:bg-white/5"
                    onClick={() => setShowLocalTaskHistory(true)}
                  >
                    打开日志
                  </Button>
                </div>
              </div>
            </div>
          )}
          isBatchSelectMode={isSelectMode}
          onToggleStoryboardBoardReference={(nextValue) => {
            dispatch({
              type: 'UPDATE_STORYBOARD',
              index: currentStoryboardIndex,
              updates: { useStoryboardBoardReference: nextValue },
              chapterId: chapter.id,
            });
          }}
          onToggleCompactVideoPrompt={(nextValue) => {
            dispatch({
              type: 'UPDATE_STORYBOARD',
              index: currentStoryboardIndex,
              updates: { useCompactVideoPrompt: nextValue },
              chapterId: chapter.id,
            });
          }}
          onOptimizeCompactVideoPrompt={() => optimizeCurrentVideoPrompt(currentStoryboardIndex)}
          onVideoSubmitPromptOverrideChange={(prompt, sourcePrompt) => {
            dispatch({
              type: 'UPDATE_STORYBOARD',
              index: currentStoryboardIndex,
              updates: {
                videoSubmitPromptOverride: prompt,
                videoSubmitPromptOverrideSourcePrompt: sourcePrompt,
                videoSubmitPromptOverrideUpdatedAt: Date.now(),
              },
              chapterId: chapter.id,
            });
          }}
          onClearVideoSubmitPromptOverride={() => {
            dispatch({
              type: 'UPDATE_STORYBOARD',
              index: currentStoryboardIndex,
              updates: {
                videoSubmitPromptOverride: '',
                videoSubmitPromptOverrideSourcePrompt: '',
                videoSubmitPromptOverrideUpdatedAt: undefined,
              },
              chapterId: chapter.id,
            });
          }}
          onCompressStoryboardBoard={() => compressStoryboardBoardUploadImage(currentStoryboardIndex)}
          isCompressingStoryboardBoard={
            compressingStoryboardBoardIndex === currentStoryboardIndex
            || compressingAllStoryboardBoards
          }
          onCompressAllStoryboardBoards={compressAllStoryboardBoardUploadImages}
          isCompressingAllStoryboardBoards={compressingAllStoryboardBoards}
          compressAllStoryboardBoardProgress={compressAllStoryboardBoardProgress}
          onReplaceReferenceImage={replaceCurrentVideoReferenceImage}
          onRemoveReferenceImage={removeCurrentVideoReferenceImage}
          onRestoreDefaultReferences={restoreCurrentVideoReferences}
          onReferenceVideoUrlsChange={(urls) => {
            dispatch({
              type: 'UPDATE_STORYBOARD',
              index: currentStoryboardIndex,
              updates: { referenceVideo: { urls } },
              chapterId: chapter.id,
            });
          }}
          onSubmit={async () => {
            const isFailed = getVideoState(currentSb).status === 'failed';
            const label = isFailed ? '重新生成' : '生成';
            const confirmed = await confirm(`确定要${label}当前镜头的视频吗？这会消耗视频生成额度。`);
            if (confirmed) {
              submitVideo({ chapterId: chapter.id, storyboardIndex: currentStoryboardIndex });
            }
          }}
          onReset={() => resetVideo(currentStoryboardIndex)}
          onRecoverResult={() => (
            isSeedanceServiceBackend(currentVideoBackend)
              ? recoverSeedanceResult(currentStoryboardIndex)
              : recoverVolcResult(currentStoryboardIndex)
          )}
          onRecoverSeedanceTask={() => recoverSeedanceResult(currentStoryboardIndex)}
          isRecoveringResult={recoveringVideoIndex === currentStoryboardIndex}
          canRecoverResult={
            !!currentSb.videoTaskId
            && (
              currentVideoBackend === 'volcengine'
              || isSeedanceServiceBackend(currentVideoBackend)
            )
          }
          canRecoverSeedanceTask={
            (isSeedanceServiceBackend(currentSb.videoBackend) || isSeedanceServiceBackend(state.videoApiConfig.backend))
            && (currentSb.videoStatus === 'submitting' || currentSb.videoStatus === 'polling')
          }
          onCancel={async () => {
            const taskBeforeCancel = currentSb;
            const result = await cancelVideoTask({
              chapterId: chapter.id,
              storyboardIndex: currentStoryboardIndex,
            });
            if (result.success) {
              if (taskBeforeCancel.videoTaskId && !taskBeforeCancel.videoTaskId.endsWith('-pending')) {
                abortPollingForTask(taskBeforeCancel.videoTaskId, taskBeforeCancel.videoBackend, { remoteCancel: false });
              }
              toast.success(result.message);
            } else {
              toast.warning(result.message);
            }
          }}
        />
      )}

      {summary.totalWithPrompt > 1 && (
        <Card className="surface-panel border-white/70">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                本集镜头进度
                <Badge variant="outline" className="rounded-full bg-white/70 dark:bg-white/5">总览</Badge>
              </CardTitle>
              <div className="flex items-center gap-2 text-xs">
                {summary.doneCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 font-medium text-green-700">
                    <CheckCircle2 className="h-3 w-3" /> {summary.doneCount} 完成
                  </span>
                )}
                {summary.pollingCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 font-medium text-blue-700">
                    <Loader2 className="h-3 w-3 animate-spin" /> {summary.pollingCount} 生成中
                  </span>
                )}
                {summary.failedCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">
                    <XCircle className="h-3 w-3" /> {summary.failedCount} 失败
                  </span>
                )}
                {summary.pendingCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">
                    <Film className="h-3 w-3" /> {summary.pendingCount} 待生成
                  </span>
                )}
              </div>
            </div>

            {isSelectMode && (
              <div className="mt-2 flex items-center gap-3 text-xs">
                <button
                  className="text-blue-500 hover:underline"
                  onClick={() => {
                    const all = new Set<number>();
                    allStoryboards.forEach((sb, index) => {
                      if (!getBatchSelectDisabledReason(sb, index)) {
                        all.add(index);
                      }
                    });
                    if (all.size === 0) {
                      toast.info('当前没有可批量选择的待生成镜头。');
                    }
                    setSelectedIndices(all);
                  }}
                >
                  全选待生成镜头
                </button>
                <button
                  className="text-blue-500 hover:underline"
                  onClick={() => setSelectedIndices(new Set())}
                >
                  清空选择
                </button>
                {selectedIndices.size > 0 && (
                  <span className="text-muted-foreground">已选 {selectedIndices.size} 个</span>
                )}
              </div>
            )}

            {!isSelectMode && !isBatchGenerating && (
              <p className="mt-1 text-[10px] text-muted-foreground">拖动分镜可以调整生成顺序。</p>
            )}
          </CardHeader>

          <CardContent>
            {isBatchGenerating && (
              <div className="mb-3 space-y-1">
                {allStoryboards.map((sb, index) => {
                  if (!isStoryboardPromptReady(sb)) return null;
                  if (sb.videoStatus !== 'submitting' && sb.videoStatus !== 'polling' && sb.videoStatus !== 'failed') return null;
                  return (
                    <div key={index} className="flex items-center gap-2 rounded bg-muted/30 px-2 py-1 text-xs">
                      <span className="w-8 font-mono">#{String(index + 1).padStart(2, '0')}</span>
                      {sb.videoStatus === 'polling' && (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                          <span className="text-blue-500">{sb.videoStatusDetail || `${sb.videoProgress ?? 0}%`}</span>
                        </>
                      )}
                      {sb.videoStatus === 'submitting' && (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
                          <span className="text-amber-500">提交中</span>
                        </>
                      )}
                      {sb.videoStatus === 'failed' && (
                        <>
                          <XCircle className="h-3 w-3 text-red-500" />
                          <span className="truncate text-red-500">{sb.videoError ?? '失败'}</span>
                        </>
                      )}
                      <span className="ml-auto max-w-[120px] truncate text-muted-foreground">
                        {sb.storyboard?.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="grid grid-cols-5 gap-2">
              {allStoryboards.map((sb, index) => {
                const videoState = getVideoState(sb);
                const isActive = index === currentStoryboardIndex;
                const isSelected = selectedIndices.has(index);
                const selectDisabledReason = isSelectMode ? getBatchSelectDisabledReason(sb, index) : null;
                const isSelectable = isSelectMode && !selectDisabledReason;
                const isDragOver = dragState.overIndex === index && dragState.dragIndex !== null && dragState.dragIndex !== index;

                return (
                  <div
                    key={index}
                    className={`relative ${isDragOver ? 'rounded-lg ring-2 ring-primary/50' : ''}`}
                    draggable={!isSelectMode && !isBatchGenerating}
                    onDragStart={() => onDragStart(index)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      onDragOver(index);
                    }}
                    onDrop={() => {
                      if (dragState.dragIndex !== null && dragState.dragIndex !== index) {
                        handleDrop(dragState.dragIndex, index);
                      }
                      onDragEnd();
                    }}
                    onDragEnd={onDragEnd}
                  >
                    {!isSelectMode && !isBatchGenerating && (
                      <div className="absolute -left-0.5 top-1/2 z-10 -translate-y-1/2 cursor-grab opacity-0 transition-opacity hover:opacity-100">
                        <GripVertical className="h-3 w-3 text-muted-foreground" />
                      </div>
                    )}
                    <StoryboardProgressCell
                      index={index}
                      number={sb.storyboard ? sb.storyboard.number : index + 1}
                      name={sb.storyboard?.name}
                      status={videoState.status}
                      progress={videoState.progress}
                      statusDetail={videoState.statusDetail}
                      isActive={isActive}
                      isSelected={isSelected}
                      isSelectMode={isSelectMode}
                      isSelectable={isSelectable}
                      selectDisabledReason={selectDisabledReason}
                      onClick={handleCellClick}
                    />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {ConfirmDialog}

      <Step5TaskHistoryModal
        open={showLocalTaskHistory}
        onOpenChange={setShowLocalTaskHistory}
        projectId={currentProject?.id}
        chapterId={chapter.id}
        onRestoreTask={restoreLocalTaskLogEntry}
        onClearLogs={() => confirm(
          '确定清空本章的本机 Step5 任务日志吗？这不会删除已生成视频，只会删除本机 IndexedDB 里的对账记录。',
          '清空本机任务日志',
        )}
      />

      <VideoHistoryModal
        open={showHistory}
        onOpenChange={setShowHistory}
        videoConfig={state.videoApiConfig}
        currentStoryboardLabel={currentSb?.storyboard
          ? `分镜${String(currentSb.storyboard.number).padStart(2, '0')} · ${currentSb.storyboard.name}`
          : undefined}
        onUseTaskResult={useHistoryTaskResult}
        usingTaskId={usingHistoryTaskId}
        onConfirmDeleteTask={(taskId) => confirm(
          `确定要删除火山历史任务 ${taskId} 吗？删除后可能无法再通过任务列表恢复这个结果。`,
          '删除火山历史任务',
        )}
      />
    </div>
  );
}
