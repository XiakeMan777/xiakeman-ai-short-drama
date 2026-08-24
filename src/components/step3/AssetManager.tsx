// ============================================================
// 步骤3: 图片资产管理
// - 平铺卡片布局：每个角色一个卡片，4个缩略图并排
// - 点击缩略图在卡片下方展开编辑区（prompt、生成模式、操作按钮）
// - 场景也用类似卡片，包含横屏/竖屏两张独立场景导演板
// - 后续角色图片基于图片1图生图，保持人物一致性
// - 支持上传 / 文生图 / 图生图 / 从资产库选择
// - 支持本地直出 prompt，可选 AI 润色增强镜头感
// - 批量生成 / 批量优化 / 搜索筛选 / 拖拽上传 / 全屏预览
// ============================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  Wand2,
  RotateCcw,
  FileArchive,
  Settings,
  ImageIcon,
  Layers,
  Volume2,
  X,
} from '@/components/icons';
import { useCurrentProject } from '@/stores/projectStore';
import { getCharacterVoiceReferences } from '@/lib/characterVoiceReferences';
import { deleteBlob, loadBlob, saveBlob } from '@/lib/imageStore';
import { encodeWebpSameSize, formatBytes } from '@/lib/lightweightImageCompression';
import {
  buildDirectImagePrompt,
  enforceImagePromptGuards,
  generateImage,
  normalizeImageSizeForConfig,
  optimizeImagePrompt,
} from '@/lib/imageApiClient';
import type {
  Asset,
  ImageReference,
  ImageConcept,
  Step3TaskState,
} from '@/types';
import {
  PROP_IMAGE_CONCEPT as PROP_CONCEPT,
} from '@/types';
import { STYLE_PRESETS, isCustomStyle } from '@/lib/style-presets';
import {
  getImageRefCharacterVariantKey,
  isStoryboardCharacterReferenceConcept,
} from '@/lib/characterReferenceUtils';
import { inferCharacterGenderHint } from '@/lib/characterIdentityHints';
import { isNonHumanSystemCharacterText } from '@/lib/nonHumanCharacterVisual';
import {
  type AssetItem,
  buildAssetDownloadFileName,
  genId,
  getSourceConcept,
  isTurnaroundConcept,
  makeItemKey,
  mergeManualPromptWithCurrentTemplate,
} from './assetUtils';
import { getPropIdentityKey } from '@/lib/propTracking';
import {
  getOfficialVirtualHumanIncompatibleMessage,
  isOfficialVirtualHumanCompatibleVideoBackend,
} from '@/lib/officialVirtualHumanVideoMode';
import { ConcurrentLimiter } from '@/lib/concurrentLimiter';
import { cn } from '@/lib/utils';
import { getErrorMessage, isTransientApiError } from '@/lib/transientApiError';
import { listBackgroundJobs, type BackgroundJob } from '@/lib/backgroundJobsClient';
import { createCloudProjectBlobDownloadUrl } from '@/lib/cloudProjectStore';
import {
  buildAllImageRefs,
  buildAssetItems,
  partitionImageRefs,
} from './assetSlotDerivation';
import {
  buildAssetContext,
  buildAssetDescription,
  buildAssetSourcePreview,
  buildTurnaroundPromptForItem,
  inferCharacterFocusProfile,
  type AssetPromptSourcePreview,
} from './assetPromptDerivation';
import {
  getBatchGenerationTasks,
  linkGeneratedCharacterBase,
  resolveGenerationItem,
  shouldDeferGenerationTask,
  type BatchSelectionOptions,
  type SectionAutoType,
} from './assetBatchPlanning';
import { requireImg2ImgSourceBlob, resolveImg2ImgSourceAsset } from './assetGenerationSource';
import { CharacterCard, PropCard, SceneCard } from './AssetCards';
import { VirtualHumanPicker } from './VirtualHumanPicker';
import { CharacterVoiceReferencePanel } from '@/components/voice/CharacterVoiceReferencePanel';
import {
  loadVolcVirtualHumanCatalog,
  type VolcVirtualHuman,
} from '@/lib/volcVirtualHumanCatalog';
import { matchDistinctVirtualHumans } from './virtualHumanMatcher';
import {
  buildVirtualHumanAsset,
  buildVirtualHumanMatchInputs,
  countPendingVirtualHumanItems,
  findVirtualHumanProfile,
  getPendingVirtualHumanItems,
  getReservedVirtualHumanAssetIds,
} from './assetVirtualHumanRuntime';
import {
  applyOfficialNoFacePromptGuard,
  getCharacterItemsForName,
  getFailureSummaryLabel,
  getGeneratedAssetExternalFields,
  getImageConceptLabel,
  getOfficialModeConceptDesc,
  getOfficialModeConceptLabel,
  getSceneItemsForName,
  getSelectedNoFaceOutfitDescription,
  isAbortError,
  isCoreRequiredSlot,
  isLegacyFaceBasedPrompt,
  isLegacyTurnaroundPrompt,
  isManualEnhancementSlot,
  isNoFaceCharacterVisualSlot,
  isOfficialVirtualHumanAsset,
  isOfficialVirtualHumanSlot,
  sanitizeNoFaceCharacterDescription,
  type BatchFailure,
  type BatchPhase,
  type BatchRunOptions,
} from './assetManagerRules';
import {
  buildGroupCharacterPrompt,
  enforceGroupCharacterPromptGuards,
  getCharacterMultiplicity,
} from '@/lib/groupCharacterAssets';

const EMPTY_ASSET_LIBRARY: Asset[] = [];
const VIRTUAL_HUMAN_AUTO_MATCH_LIMIT = 24;
const STEP3_DEFAULT_CONCURRENCY = 3;
const STEP3_CONCURRENCY_PRESETS = [1, 3, 5] as const;
const STEP3_CUSTOM_CONCURRENCY_DEFAULT = 3;
const STEP3_MAX_CONCURRENCY = 8;
const STEP3_IMAGE_GENERATE_RETRY_DELAYS_MS = [2500, 7000, 15000] as const;
const STEP3_BACKEND_IMAGE_SYNC_INTERVAL_MS = 5000;
const STEP3_BACKEND_IMAGE_JOB_LOOKBACK_MS = 12 * 60 * 60 * 1000;
const ENABLE_GLOBAL_STEP3_TASKS: boolean = true;
const LIGHTWEIGHT_WEBP_QUALITY = 0.95;
const LIGHTWEIGHT_WEBP_QUALITY_LABEL = 95;
const LIGHTWEIGHT_MIN_SAVED_BYTES = 1024;

type AssetManagerVariant = 'classic' | 'next';
type BatchProgress = {
  done: number;
  total: number;
  success: number;
  failed: number;
};
type ImageGenerationCallbacks = {
  onStatus?: (message: string) => void;
  onRemoteImageUrl?: (url: string) => void;
};
type BackendImageSyncState = {
  total: number;
  queued: number;
  running: number;
  recoverable: number;
  recovering: number;
  recovered: number;
  failed: number;
  lastMessage?: string;
  lastError?: string;
  updatedAt?: number;
  activeStartedAt?: number;
  activeUpdatedAt?: number;
  activeAttempt?: number;
  activeMaxAttempts?: number;
  activePhase?: string;
};
type Step3BackendImageJobEntry = {
  job: BackgroundJob;
  slotKey: string;
};

function createBatchProgress(total = 0): BatchProgress {
  return { done: 0, total, success: 0, failed: 0 };
}

function formatBatchProgressLabel(progress: BatchProgress) {
  return `成功 ${progress.success} / 失败 ${progress.failed} / 已处理 ${progress.done}/${progress.total}`;
}

function formatBatchProgressButtonLabel(progress: BatchProgress) {
  return `成功 ${progress.success}/${progress.total} · 失败 ${progress.failed}`;
}

function waitForStep3RetryDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException('The user aborted a request.', 'AbortError');
  }

  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      clearTimeout(timeoutId);
      reject(new DOMException('The user aborted a request.', 'AbortError'));
    };

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);

    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

function clampStep3Concurrency(value: number) {
  return Math.min(STEP3_MAX_CONCURRENCY, Math.max(1, Math.round(value)));
}

function getConcurrencySelectValue(value: number) {
  return STEP3_CONCURRENCY_PRESETS.includes(value as (typeof STEP3_CONCURRENCY_PRESETS)[number])
    ? String(value)
    : 'custom';
}

function canGenerateLightweightAsset(asset: Pick<Asset, 'blobKey' | 'source'>) {
  return asset.source !== 'volc_virtual_human' && !asset.blobKey.startsWith('external:');
}

function createBackendImageSyncState(updates: Partial<BackendImageSyncState> = {}): BackendImageSyncState {
  return {
    total: 0,
    queued: 0,
    running: 0,
    recoverable: 0,
    recovering: 0,
    recovered: 0,
    failed: 0,
    ...updates,
  };
}

function getStep3BackendImageSlotKey(job: BackgroundJob): string | null {
  const namespace = typeof job.progress?.namespace === 'string' ? job.progress.namespace : '';
  if (!namespace.startsWith('step3-')) return null;
  return namespace.slice('step3-'.length) || null;
}

function getJobTime(job: BackgroundJob) {
  const value = Date.parse(job.updatedAt || job.completedAt || job.createdAt || '');
  return Number.isFinite(value) ? value : 0;
}

function getJobStartTime(job: BackgroundJob) {
  const value = Date.parse(job.startedAt || job.queuedAt || job.createdAt || '');
  return Number.isFinite(value) ? value : 0;
}

function formatStep3BackendDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
}

function formatBackendImageActiveHint(sync: BackendImageSyncState) {
  if (!sync.activeStartedAt || sync.queued + sync.running <= 0) return '';
  const now = sync.updatedAt ?? Date.now();
  const elapsed = formatStep3BackendDuration(now - sync.activeStartedAt);
  const updateAge = sync.activeUpdatedAt
    ? formatStep3BackendDuration(now - sync.activeUpdatedAt)
    : '';
  const attemptText = sync.activeAttempt && sync.activeMaxAttempts
    ? `，第 ${sync.activeAttempt}/${sync.activeMaxAttempts} 次尝试`
    : '';
  const phaseText = sync.activePhase ? `，阶段：${sync.activePhase}` : '';
  const updateText = updateAge ? `，后台 ${updateAge} 前有心跳` : '';
  return `最长运行 ${elapsed}${attemptText}${phaseText}${updateText}`;
}

function getLatestStep3BackendImageEntries(entries: Step3BackendImageJobEntry[]) {
  const entriesBySlotKey = new Map<string, Step3BackendImageJobEntry>();
  entries.forEach((entry) => {
    const previous = entriesBySlotKey.get(entry.slotKey);
    if (!previous || getJobTime(entry.job) >= getJobTime(previous.job)) {
      entriesBySlotKey.set(entry.slotKey, entry);
    }
  });
  return Array.from(entriesBySlotKey.values());
}

function getJobText(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function dedupeCharacterRefsByName(refs: readonly ImageReference[]) {
  const seen = new Set<string>();
  const result: ImageReference[] = [];
  for (const ref of refs) {
    const key = ref.name.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

function revokeLocalObjectUrl(url?: string) {
  if (url?.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}

function clearLightweightVariantFields(): Partial<Asset> {
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

export function AssetManager({ variant = 'classic' }: { variant?: AssetManagerVariant } = {}) {
  const isNextUi = variant === 'next';
  const { state, dispatch, currentProject, currentChapter: chapter } = useCurrentProject();
  const analysis = chapter?.analysis;
  const assetLibrary = currentProject?.assetLibrary ?? EMPTY_ASSET_LIBRARY;
  const currentStep3GlobalTask = useMemo(
    () => state.globalTasks.find((task) =>
      task.type === 'step3-batch'
      && task.projectId === currentProject?.id
      && task.chapterId === chapter?.id
      && (task.status === 'queued' || task.status === 'running'),
    ) ?? null,
    [chapter?.id, currentProject?.id, state.globalTasks],
  );
  const optimizeConcurrency = currentProject?.step3Settings?.optimizeConcurrency ?? STEP3_DEFAULT_CONCURRENCY;
  const generateConcurrency = currentProject?.step3Settings?.generateConcurrency ?? STEP3_DEFAULT_CONCURRENCY;
  const useVolcVirtualHumans = currentProject?.step3Settings?.useVolcVirtualHumans ?? false;
  const officialVirtualHumanVideoBackendReady = isOfficialVirtualHumanCompatibleVideoBackend(state.videoApiConfig.backend);
  const imageRefAssetLibrary = useMemo(
    () => useVolcVirtualHumans
      ? assetLibrary
      : assetLibrary.filter((asset) => !isOfficialVirtualHumanAsset(asset)),
    [assetLibrary, useVolcVirtualHumans],
  );

  // 合并 analysis 数据源和已有 imageRefs 的 assetId 关联
  // 数据源优先级：analysis.scenes / analysis.allCharacterNames / analysis.propTracking → 显示完整列表
  // imageRefs 提供 assetId 关联和 refId 信息
  const storyboards = chapter?.storyboards;
  const allImageRefs = useMemo(() => buildAllImageRefs(analysis, storyboards, imageRefAssetLibrary), [analysis, storyboards, imageRefAssetLibrary]);
  const { characters, scenes, props } = useMemo(() => partitionImageRefs(allImageRefs), [allImageRefs]);

  // 当前展开的编辑项（复合 key）
  const [editingKey, setEditingKey] = useState<string | null>(null);

  // 每个 concept 图片槽的运行时状态
  const [items, setItems] = useState<Record<string, AssetItem>>({});
  const itemsRef = useRef<Record<string, AssetItem>>({});

  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchOptimizing, setBatchOptimizing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgress>(() => createBatchProgress());
  const [batchCurrentLabel, setBatchCurrentLabel] = useState<string | null>(null);
  const [batchFailures, setBatchFailures] = useState<BatchFailure[]>([]);
  const [batchStopRequested, setBatchStopRequested] = useState(false);
  const [batchStopped, setBatchStopped] = useState(false);
  const [generatingLightweightAssets, setGeneratingLightweightAssets] = useState(false);
  const [lightweightProgress, setLightweightProgress] = useState({ done: 0, total: 0 });
  const [backendImageSync, setBackendImageSync] = useState<BackendImageSyncState>(() => createBackendImageSyncState());
  const [lightweightSummary, setLightweightSummary] = useState<{
    generated: number;
    skippedExisting: number;
    skippedNoGain: number;
    failed: number;
    savedBytes: number;
  } | null>(null);
  const [includeOutfitVariantsInBatch, setIncludeOutfitVariantsInBatch] = useState(true);
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [virtualHumanPickerKey, setVirtualHumanPickerKey] = useState<string | null>(null);
  const [autoMatchingVirtualHumans, setAutoMatchingVirtualHumans] = useState(false);
  const mountedRef = useRef(true);
  const batchStopRequestedRef = useRef(false);
  const batchAbortControllersRef = useRef<Set<AbortController>>(new Set());
  const batchProgressRef = useRef<BatchProgress>(createBatchProgress());
  const batchFailuresRef = useRef<BatchFailure[]>([]);
  const backendImageRecoveringRef = useRef<Set<string>>(new Set());
  const backendImageRecoveredRef = useRef<Set<string>>(new Set());

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { batchProgressRef.current = batchProgress; }, [batchProgress]);
  useEffect(() => { batchFailuresRef.current = batchFailures; }, [batchFailures]);
  useEffect(() => {
    if (batchGenerating || batchOptimizing || batchFailures.length > 0) return;
    const storedFailures = chapter?.step3Task?.failures;
    if (!storedFailures?.length) return;
    const restoredFailures: BatchFailure[] = storedFailures.map((failure) => {
      const phase: BatchPhase = failure.phase === 'optimize' ? 'optimize' : 'generate';
      return {
        key: failure.key,
        name: failure.name,
        concept: failure.concept as ImageConcept,
        phase,
        retryMode: failure.retryMode as BatchFailure['retryMode'],
        error: failure.error,
      };
    });
    batchFailuresRef.current = restoredFailures;
    setBatchFailures(restoredFailures);
  }, [batchFailures.length, batchGenerating, batchOptimizing, chapter?.step3Task?.failures]);
  const virtualHumanPickerItem = virtualHumanPickerKey ? items[virtualHumanPickerKey] ?? null : null;
  useEffect(() => {
    if (!useVolcVirtualHumans) setVirtualHumanPickerKey(null);
  }, [useVolcVirtualHumans]);
  useEffect(() => () => {
    const urls = new Set(
      Object.values(itemsRef.current)
        .map((item) => item.localBlobUrl)
        .filter((url): url is string => !!url),
    );
    urls.forEach((url) => revokeLocalObjectUrl(url));
  }, []);

  // 初始化/同步 items
  useEffect(() => {
    if (!analysis) return;
    setItems((prev) => {
      const nextItems = buildAssetItems({
        previousItems: prev,
        allImageRefs,
        assetLibrary,
        styleConfig: analysis.styleConfig,
        analysis,
        allowOfficialVirtualHumanAssets: useVolcVirtualHumans,
        officialNoFaceCharacterVisuals: useVolcVirtualHumans,
      });
      itemsRef.current = nextItems;
      return nextItems;
    });
  }, [analysis, allImageRefs, assetLibrary, useVolcVirtualHumans]);

  const editing = editingKey ? items[editingKey] ?? null : null;

  // 恢复已有资产预览
  useEffect(() => {
    if (!editing?.asset || editing.localBlobUrl || editing.asset.thumbnailUrl || editing.asset.source === 'volc_virtual_human') return;
    let cancelled = false;
    loadBlob(editing.asset.blobKey).then((blob) => {
      if (!blob || cancelled) return;
      const url = URL.createObjectURL(blob);
      if (!cancelled) updateItem(editing.key, { localBlobUrl: url });
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.asset?.blobKey, editing?.localBlobUrl]);

  const updateItem = useCallback((key: string, updates: Partial<AssetItem>) => {
    const existing = itemsRef.current[key];
    if (!existing) return;
    const nextItems = { ...itemsRef.current, [key]: { ...existing, ...updates } };
    itemsRef.current = nextItems;
    setItems(nextItems);
  }, []);

  const showGeneratedPreview = useCallback((key: string, url: string) => {
    const previousUrl = itemsRef.current[key]?.localBlobUrl;
    if (previousUrl === url) return;
    updateItem(key, { localBlobUrl: url });
    revokeLocalObjectUrl(previousUrl);
  }, [updateItem]);

  const clearBatchProcessingKeys = useCallback((keys: Iterable<string>) => {
    const keySet = new Set(keys);
    if (keySet.size === 0) return;
    setItems((prev) => {
      let changed = false;
      const nextItems = { ...prev };
      for (const key of keySet) {
        const item = nextItems[key];
        if (!item?.isProcessing) continue;
        nextItems[key] = { ...item, isProcessing: false };
        changed = true;
      }
      if (!changed) return prev;
      itemsRef.current = nextItems;
      return nextItems;
    });
  }, []);

  const updateAssetUsage = useCallback((asset: Asset | undefined, slotKey: string, selected: boolean, extraUpdates?: Partial<Asset>) => {
    if (!asset) return;
    const currentUsage = new Set(asset.usedInStoryboards ?? []);
    if (selected) {
      currentUsage.add(slotKey);
    } else {
      currentUsage.delete(slotKey);
    }
    dispatch({
      type: 'UPDATE_ASSET',
      assetId: asset.id,
      updates: {
        usedInStoryboards: Array.from(currentUsage),
        ...extraUpdates,
      },
    });
  }, [dispatch]);

  const syncPrimaryImageRefs = useCallback((
    item: Pick<AssetItem, 'type' | 'name' | 'concept' | 'identityKey' | 'variantKey' | 'outfitSeq'>,
    assetId?: string,
  ) => {
    if (!chapter) return;
    const isPrimarySlot = item.type === 'scene'
      || item.type === 'prop'
      || (item.type === 'character' && isStoryboardCharacterReferenceConcept(item.concept));
    if (!isPrimarySlot) return;

    chapter.storyboards.forEach((storyboard, storyboardIndex) => {
      storyboard.imageRefs.forEach((imageRef) => {
        const matchesRef = imageRef.type === item.type && (item.type === 'prop'
          ? imageRef.trackingId === item.identityKey
          : item.type === 'character'
            ? imageRef.name === item.name
              && (item.variantKey
                ? getImageRefCharacterVariantKey(imageRef) === item.variantKey
                : !getImageRefCharacterVariantKey(imageRef))
            : imageRef.name === item.name);
        if (!matchesRef) return;
        if (assetId) {
          dispatch({
            type: 'LINK_ASSET_TO_STORYBOARD',
            chapterId: chapter.id,
            sbIndex: storyboardIndex,
            imageRefRefId: imageRef.refId,
            assetId,
            bindingMode: item.type === 'scene' ? 'auto' : 'manual',
            preserveGeneratedBoards: item.type !== 'scene',
          });
        } else if (imageRef.assetId) {
          dispatch({
            type: 'UNLINK_ASSET_FROM_STORYBOARD',
            chapterId: chapter.id,
            sbIndex: storyboardIndex,
            imageRefRefId: imageRef.refId,
            preserveGeneratedBoards: item.type !== 'scene',
          });
        }
      });
    });
  }, [chapter, dispatch]);

  const rebindSlotAsset = useCallback((slotKey: string, nextAsset: Asset, previousAsset?: Asset) => {
    if (previousAsset && previousAsset.id !== nextAsset.id) {
      updateAssetUsage(previousAsset, slotKey, false);
    }

    updateAssetUsage(nextAsset, slotKey, true);

    const shouldLinkRefs = nextAsset.type === 'scene'
      || nextAsset.type === 'prop'
      || (nextAsset.type === 'character' && isStoryboardCharacterReferenceConcept(nextAsset.concept));

    if (shouldLinkRefs) {
      syncPrimaryImageRefs({
        type: nextAsset.type,
        name: nextAsset.name,
        concept: nextAsset.concept,
        identityKey: nextAsset.identityKey,
        variantKey: nextAsset.variantKey,
        outfitSeq: nextAsset.outfitSeq,
      }, nextAsset.id);
    }
  }, [syncPrimaryImageRefs, updateAssetUsage]);

  // 构建描述信息
  const buildDescription = useCallback((item: AssetItem) => {
    if (!analysis) return item.name;
    return buildAssetDescription({
      item,
      analysis,
      adaptedScript: chapter?.adaptedScript ?? '',
    });
  }, [analysis, chapter?.adaptedScript]);

  const buildContext = useCallback((item: AssetItem) => {
    return buildAssetContext({
      item,
      rawScript: chapter?.rawScript ?? '',
      adaptedScript: chapter?.adaptedScript ?? '',
      analysis: analysis ?? undefined,
    });
  }, [analysis, chapter?.rawScript, chapter?.adaptedScript]);

  const buildSourcePreview = useCallback((item: AssetItem): AssetPromptSourcePreview => {
    if (!analysis) {
      return {
        descriptionSources: [],
        contextSources: [],
      };
    }

    return buildAssetSourcePreview({
      item,
      rawScript: chapter?.rawScript ?? '',
      adaptedScript: chapter?.adaptedScript ?? '',
      analysis,
    });
  }, [analysis, chapter?.rawScript, chapter?.adaptedScript]);

  // Prompt 生成 / AI 润色
  const buildNoFaceCharacterPrompt = useCallback(
    (item: AssetItem): string => {
      const styleLine = analysis?.styleConfig ? `整体风格：${analysis.styleConfig}` : '';
      const outfitDesc = sanitizeNoFaceCharacterDescription(
        getSelectedNoFaceOutfitDescription(item, analysis?.outfitTracking),
      );
      const outfitLine = outfitDesc ? `变装/服装细节：${outfitDesc}` : '';
      const layoutLine = isTurnaroundConcept(item.concept)
        ? '画面结构：16:9横版无脸服装/体态工业参考表，固定 CHARACTER REFERENCE SHEET 版式；顶部浅灰技术标题栏写 CHARACTER REFERENCE | NO-FACE OUTFIT BODY REFERENCE；主体上半区约70%严格排成6个固定面板并显示英文模块标签：FRONT VIEW、SIDE VIEW、BACK VIEW、BLANK HEAD FRONT CLOSE-UP、BLANK HEAD SIDE CLOSE-UP、COSTUME / SUIT DETAIL VIEW；FRONT/SIDE/BACK 三个全身面板必须是同一套服装、同一无脸或无头中性模特、同一比例、同一灯光和同一尺度，稳定站姿，从头到脚完整呈现服装轮廓、层次、比例和重心；两个头部近景只能是空白塑料头模、无脸头盔、脖颈结构或服装领口结构，不得出现五官、头发、真实皮肤和身份特征；COSTUME / SUIT DETAIL VIEW 展示衣料、绷带、装备、鞋靴、配饰、边缘轮廓、手脚局部和材质；下方信息条约30%，左侧 PALETTE 放4到6个服装色块，右侧 MATERIAL & TEXTURE NOTES 放3到5个材质近景小窗和短标签；不要并排重复额外完整人体，不要海报构图、漫画拼贴或自由排版。背景干净，电影级灯光，高清细节。'
        : '画面结构：单人服装产品设定图，优先无头裁缝人台、脖子以下服装人台或头部完全裁出画面；如果必须出现头部，只能是空白塑料头模，不展示头发、眼鼻口、表情、皮肤质感或任何可识别身份。重点展示服装层次、装备、材质和配色；不能做肖像照或脸部定妆照。背景干净，电影级灯光，高清细节。';
      const prompt = [
        '无脸服装/体态参考图，不是角色肖像图，不要面部特写，不要头脸大特写。',
        '画面使用无头裁缝人台、脖子以下服装人台、无脸塑料模特或空白中性模特展示服装；不得出现真人脸、清晰五官、眼睛、鼻口、眉毛、表情、真实皮肤纹理、肖像脸、自拍脸、头发造型或可识别人物身份。',
        `服装/体态目标：${sanitizeNoFaceCharacterDescription(buildDescription(item))}`,
        outfitLine,
        '严禁把官方定妆照的脸、发型、肤色或身份特征带入这张服装参考图。',
        'Consistency Notes: only clothing, body proportion, material, outfit silhouette, accessories, and equipment may be inherited.',
        'Negative Prompt: no face, no facial features, no hairstyle, no skin identity, no portrait identity.',
        styleLine,
        layoutLine,
      ].filter(Boolean).join('\n');
      return applyOfficialNoFacePromptGuard(prompt, item, true);
    },
    [analysis?.styleConfig, analysis?.outfitTracking, buildDescription],
  );

  const buildTurnaroundPrompt = useCallback(
    (item: AssetItem): string => {
      if (isNoFaceCharacterVisualSlot(item, useVolcVirtualHumans)) {
        return buildNoFaceCharacterPrompt(item);
      }
      const description = buildDescription(item);
      const nonHumanSystem = isNonHumanSystemCharacterText([item.name, description].join('\n'));
      const genderHint = nonHumanSystem ? undefined : inferCharacterGenderHint(
        item.name,
        description,
      );
      const exclusivePropLines = [...description.matchAll(/专属物品设定：([^；。]+)/g)]
        .map((match) => match[1]?.trim())
        .filter(Boolean)
        .join('；');
      return buildTurnaroundPromptForItem(item, analysis?.styleConfig, exclusivePropLines, genderHint, nonHumanSystem);
    },
    [analysis?.styleConfig, buildDescription, buildNoFaceCharacterPrompt, useVolcVirtualHumans],
  );

  const getCharacterFocus = useCallback((item: AssetItem) => {
    if (!analysis || item.type !== 'character') return 'support' as const;
    return inferCharacterFocusProfile({
      name: item.name,
      analysis,
      adaptedScript: chapter?.adaptedScript ?? '',
      rawScript: chapter?.rawScript ?? '',
    }).tier;
  }, [analysis, chapter?.adaptedScript, chapter?.rawScript]);

  const buildDirectPrompt = useCallback((item: AssetItem) => {
    if (item.type === 'character' && getCharacterMultiplicity(item.name) === 'group') {
      return buildGroupCharacterPrompt({
        name: item.name,
        description: buildDescription(item),
        styleConfig: analysis?.styleConfig,
        concept: item.concept,
      });
    }
    if (isNoFaceCharacterVisualSlot(item, useVolcVirtualHumans)) {
      return buildNoFaceCharacterPrompt(item);
    }
    if (isTurnaroundConcept(item.concept)) {
      return buildTurnaroundPrompt(item);
    }
    const description = buildDescription(item);
    const genderHint = inferCharacterGenderHint(
      item.name,
      description,
      item.optimizedPrompt,
    );
    return buildDirectImagePrompt(
      description,
      analysis?.styleConfig ?? '',
      item.type,
      item.concept,
      getCharacterFocus(item),
      genderHint,
    );
  }, [analysis?.styleConfig, buildDescription, buildNoFaceCharacterPrompt, buildTurnaroundPrompt, getCharacterFocus, useVolcVirtualHumans]);

  const getEffectivePrompt = useCallback((item: AssetItem) => {
    if (item.type === 'character' && getCharacterMultiplicity(item.name) === 'group') {
      return enforceGroupCharacterPromptGuards(buildDirectPrompt(item), item.concept);
    }
    const manualPrompt = item.optimizedPrompt.trim();
    const currentTemplatePrompt = buildDirectPrompt(item);
    const nonHumanSystem = item.type === 'character'
      ? isNonHumanSystemCharacterText([item.name, buildDescription(item)].join('\n'))
      : false;
    const guardedPrompt = enforceImagePromptGuards(
      mergeManualPromptWithCurrentTemplate(manualPrompt, currentTemplatePrompt),
      item.type,
      item.concept,
      { nonHumanSystem },
    );
    return applyOfficialNoFacePromptGuard(guardedPrompt, item, useVolcVirtualHumans);
  }, [buildDescription, buildDirectPrompt, useVolcVirtualHumans]);

  useEffect(() => {
    setItems((prev) => {
      let changed = false;
      const nextItems = { ...prev };

      for (const [key, item] of Object.entries(prev)) {
        if (item.type !== 'character' || getCharacterMultiplicity(item.name) !== 'group') continue;
        const prompt = item.optimizedPrompt.trim();
        const isGroupTemplate = prompt.includes('群体角色参考图') || prompt.includes('GROUP CAST REFERENCE');
        const shouldRefresh = !isGroupTemplate && (!prompt
          || /只出现一名|只出现一个|单人|无群像|无第二个人|FACE HERO CLOSE-UP|CHARACTER REFERENCE SHEET/i.test(prompt));
        if (!shouldRefresh) continue;
        nextItems[key] = {
          ...item,
          optimizedPrompt: buildDirectPrompt(item),
        };
        changed = true;
      }

      if (!changed) return prev;
      itemsRef.current = nextItems;
      return nextItems;
    });
  }, [buildDirectPrompt]);

  useEffect(() => {
    if (!useVolcVirtualHumans) return;
    setItems((prev) => {
      let changed = false;
      const nextItems = { ...prev };

      for (const [key, item] of Object.entries(prev)) {
        if (!isNoFaceCharacterVisualSlot(item, true)) continue;

        const sourceAsset = item.baseAssetId
          ? assetLibrary.find((asset) => asset.id === item.baseAssetId)
          : undefined;
        const shouldBlockFaceSource = getSourceConcept(item.concept) === 'portrait_closeup'
          || isOfficialVirtualHumanAsset(sourceAsset);
        const nextBaseAssetId = shouldBlockFaceSource ? undefined : item.baseAssetId;
        const nextGenerationMode = shouldBlockFaceSource && item.generationMode === 'img2img'
          ? 'txt2img'
          : item.generationMode;
        let nextPrompt = item.optimizedPrompt;

        if (isLegacyFaceBasedPrompt(nextPrompt) || (isTurnaroundConcept(item.concept) && isLegacyTurnaroundPrompt(nextPrompt))) {
          nextPrompt = isTurnaroundConcept(item.concept)
            ? buildTurnaroundPrompt({ ...item, baseAssetId: nextBaseAssetId, generationMode: nextGenerationMode })
            : '';
        }

        if (
          nextBaseAssetId !== item.baseAssetId
          || nextGenerationMode !== item.generationMode
          || nextPrompt !== item.optimizedPrompt
          || (isTurnaroundConcept(item.concept) && item.imageSize !== '2K')
        ) {
          nextItems[key] = {
            ...item,
            baseAssetId: nextBaseAssetId,
            generationMode: nextGenerationMode,
            optimizedPrompt: nextPrompt,
            imageSize: isTurnaroundConcept(item.concept) ? '2K' : item.imageSize,
          };
          changed = true;
        }
      }

      if (!changed) return prev;
      itemsRef.current = nextItems;
      return nextItems;
    });
  }, [assetLibrary, buildTurnaroundPrompt, useVolcVirtualHumans]);

  useEffect(() => {
    setItems((prev) => {
      let changed = false;
      const nextItems = { ...prev };

      for (const [key, item] of Object.entries(prev)) {
        if (!isTurnaroundConcept(item.concept)) continue;
        const itemFactsAreNonHumanSystem = item.type === 'character'
          && isNonHumanSystemCharacterText([item.name, buildDescription(item)].join('\n'));
        const rebuiltTurnaroundPrompt = buildTurnaroundPrompt(item);
        const isNonHumanBadTurnaround = item.type === 'character'
          && !itemFactsAreNonHumanSystem
          && isNonHumanSystemCharacterText(item.optimizedPrompt);
        const isStaleGenderLock = item.type === 'character'
          && !itemFactsAreNonHumanSystem
          && (
            (item.optimizedPrompt.includes('Female character lock') && !rebuiltTurnaroundPrompt.includes('Female character lock'))
            || (item.optimizedPrompt.includes('Male character lock') && !rebuiltTurnaroundPrompt.includes('Male character lock'))
            || (/女性(?:主角识别锁|角色补充)[：:]/.test(item.optimizedPrompt) && !/女性(?:主角识别锁|角色补充)[：:]/.test(rebuiltTurnaroundPrompt))
            || (/男性(?:角色识别锁|角色补充)[：:]/.test(item.optimizedPrompt) && !/男性(?:角色识别锁|角色补充)[：:]/.test(rebuiltTurnaroundPrompt))
          );
        const shouldRefreshPrompt = isLegacyTurnaroundPrompt(item.optimizedPrompt) || isNonHumanBadTurnaround || isStaleGenderLock;
        const shouldUpgradeImageSize = item.imageSize !== '2K';
        if (!shouldRefreshPrompt && !shouldUpgradeImageSize) continue;
        nextItems[key] = {
          ...item,
          optimizedPrompt: shouldRefreshPrompt ? rebuiltTurnaroundPrompt : item.optimizedPrompt,
          imageSize: '2K',
          error: undefined,
        };
        changed = true;
      }

      if (!changed) return prev;
      itemsRef.current = nextItems;
      return nextItems;
    });
  }, [buildDescription, buildTurnaroundPrompt]);

  const dispatchStep3TaskUpdate = useCallback((updates: Partial<Step3TaskState>) => {
    if (!currentProject?.id || !chapter?.id) return;
    dispatch({
      type: 'UPDATE_STEP3_TASK',
      projectId: currentProject.id,
      chapterId: chapter.id,
      updates,
    });
  }, [chapter?.id, currentProject?.id, dispatch]);

  const dispatchStep3TaskEnd = (updates: Partial<Step3TaskState> = {}) => {
    if (!currentProject?.id || !chapter?.id) return;
    dispatch({
      type: 'END_STEP3_TASK',
      projectId: currentProject.id,
      chapterId: chapter.id,
      updates,
    });
  };

  const updateBatchProgress = (updater: BatchProgress | ((prev: BatchProgress) => BatchProgress)) => {
    const next = typeof updater === 'function' ? updater(batchProgressRef.current) : updater;
    batchProgressRef.current = next;
    if (mountedRef.current) setBatchProgress(next);
    dispatchStep3TaskUpdate({
      done: next.done,
      total: next.total,
      success: next.success,
      failed: next.failed,
    });
  };

  const updateBatchLabel = (label: string | null) => {
    if (mountedRef.current) setBatchCurrentLabel(label);
    dispatchStep3TaskUpdate({ currentLabel: label });
  };

  const clearBatchFailures = () => {
    batchFailuresRef.current = [];
    if (mountedRef.current) setBatchFailures([]);
    dispatchStep3TaskUpdate({ failures: [] });
  };

  const addBatchFailure = (failure: BatchFailure) => {
    const nextFailures = [...batchFailuresRef.current, failure];
    batchFailuresRef.current = nextFailures;
    if (mountedRef.current) setBatchFailures(nextFailures);
    dispatchStep3TaskUpdate({
      failures: nextFailures.map((item) => ({
        key: item.key,
        name: item.name,
        concept: item.concept,
        phase: item.phase,
        retryMode: item.retryMode,
        error: item.error,
      })),
    });
  };

  const removeResolvedBatchFailures = useCallback(() => {
    const currentItems = itemsRef.current;
    const nextFailures = batchFailuresRef.current.filter((failure) => {
      const item = currentItems[failure.key];
      if (!item) return false;
      if (failure.phase === 'generate' && item.asset) return false;
      if (failure.phase === 'optimize' && item.optimizedPrompt && !item.error) return false;
      return true;
    });
    if (nextFailures.length === batchFailuresRef.current.length) return;
    batchFailuresRef.current = nextFailures;
    if (mountedRef.current) setBatchFailures(nextFailures);
    dispatchStep3TaskUpdate({
      failures: nextFailures.map((item) => ({
        key: item.key,
        name: item.name,
        concept: item.concept,
        phase: item.phase,
        retryMode: item.retryMode,
        error: item.error,
      })),
    });
  }, [dispatchStep3TaskUpdate]);

  useEffect(() => {
    if (batchFailuresRef.current.length === 0) return;
    removeResolvedBatchFailures();
  }, [items, removeResolvedBatchFailures]);

  const beginBatchRun = (phase: BatchPhase, total: number, options: BatchRunOptions = {}) => {
    const { resetFailures = true } = options;
    batchStopRequestedRef.current = false;
    const initialProgress = createBatchProgress(total);
    batchProgressRef.current = initialProgress;
    if (mountedRef.current) {
      setBatchStopRequested(false);
      setBatchStopped(false);
      if (resetFailures) setBatchFailures([]);
      setBatchCurrentLabel(null);
      setBatchProgress(initialProgress);
      if (phase === 'optimize') {
        setBatchOptimizing(true);
      } else {
        setBatchGenerating(true);
      }
    }
    dispatchStep3TaskUpdate({
      running: true,
      phase,
      ...initialProgress,
      currentLabel: null,
      stopRequested: false,
      stopped: false,
      error: undefined,
      failures: resetFailures ? [] : batchFailuresRef.current,
      startedAt: Date.now(),
    });
    if (resetFailures) batchFailuresRef.current = [];
  };

  const finishBatchRun = (phase: BatchPhase, stopped: boolean) => {
    if (mountedRef.current) {
      setBatchCurrentLabel(null);
      setBatchStopRequested(false);
      setBatchStopped(stopped);
      if (phase === 'optimize') {
        setBatchOptimizing(false);
      } else {
        setBatchGenerating(false);
      }
    }
    dispatchStep3TaskEnd({
      ...batchProgressRef.current,
      phase,
      currentLabel: null,
      stopped,
      error: stopped
        ? '已停止'
        : batchProgressRef.current.failed > 0
          ? `${batchProgressRef.current.failed} 项生成失败`
          : undefined,
      failures: batchFailuresRef.current,
    });
    batchAbortControllersRef.current.clear();
    batchStopRequestedRef.current = false;
  };

  const requestBatchStop = () => {
    if (currentStep3GlobalTask) {
      dispatch({ type: 'CANCEL_GLOBAL_TASK', taskId: currentStep3GlobalTask.id });
      return;
    }
    batchStopRequestedRef.current = true;
    if (mountedRef.current) setBatchStopRequested(true);
    dispatchStep3TaskUpdate({
      stopRequested: true,
      currentLabel: '正在停止批量任务...',
    });
    batchAbortControllersRef.current.forEach((controller) => controller.abort());
  };

  const updateLightweightAssetInVisibleItems = useCallback((assetId: string, updates: Partial<Asset>) => {
    for (const [key, item] of Object.entries(itemsRef.current)) {
      if (item.asset?.id !== assetId) continue;
      updateItem(key, {
        asset: {
          ...item.asset,
          ...updates,
        },
      });
    }
  }, [updateItem]);

  const getLightweightAssetSnapshot = useCallback(() => {
    const assetsById = new Map<string, Asset>();

    for (const item of Object.values(itemsRef.current)) {
      if (item.asset) assetsById.set(item.asset.id, item.asset);
    }
    for (const asset of assetLibrary) {
      assetsById.set(asset.id, asset);
    }

    return Array.from(assetsById.values());
  }, [assetLibrary]);

  const handleGenerateLightweightAssets = async () => {
    if (generatingLightweightAssets || batchGenerating || batchOptimizing) return;
    const allCandidates = getLightweightAssetSnapshot().filter(canGenerateLightweightAsset);
    const candidates = allCandidates.filter((asset) => !asset.lightweightBlobKey);
    if (candidates.length === 0) return;

    setGeneratingLightweightAssets(true);
    setLightweightSummary(null);
    setLightweightProgress({ done: 0, total: candidates.length });
    dispatchStep3TaskUpdate({
      running: true,
      phase: 'lightweight',
      done: 0,
      total: candidates.length,
      success: 0,
      failed: 0,
      currentLabel: '正在压缩参考图...',
      stopRequested: false,
      stopped: false,
      error: undefined,
      startedAt: Date.now(),
    });

    const limiter = new ConcurrentLimiter(STEP3_DEFAULT_CONCURRENCY);
    const summary = {
      generated: 0,
      skippedExisting: allCandidates.length - candidates.length,
      skippedNoGain: 0,
      failed: 0,
      savedBytes: 0,
    };

    await Promise.allSettled(
      candidates.map((asset) =>
        limiter.run(async () => {
          try {
            const originalBlob = await loadBlob(asset.blobKey);
            if (!originalBlob) {
              summary.failed += 1;
              return;
            }

            const result = await encodeWebpSameSize(originalBlob, LIGHTWEIGHT_WEBP_QUALITY);
            if (result.compressedBytes >= result.originalBytes - LIGHTWEIGHT_MIN_SAVED_BYTES) {
              summary.skippedNoGain += 1;
              return;
            }

            const newBlobKey = await saveBlob(result.blob);
            const updatedAt = Date.now();
            const updates: Partial<Asset> = {
              lightweightBlobKey: newBlobKey,
              lightweightMimeType: 'image/webp',
              lightweightQuality: LIGHTWEIGHT_WEBP_QUALITY_LABEL,
              lightweightOriginalBytes: result.originalBytes,
              lightweightBytes: result.compressedBytes,
              lightweightWidth: result.width,
              lightweightHeight: result.height,
              lightweightCreatedAt: updatedAt,
              updatedAt,
            };
            dispatch({
              type: 'UPDATE_ASSET',
              assetId: asset.id,
              updates,
            });
            updateLightweightAssetInVisibleItems(asset.id, updates);

            summary.generated += 1;
            summary.savedBytes += Math.max(0, result.originalBytes - result.compressedBytes);
          } catch {
            summary.failed += 1;
          } finally {
            const done = summary.generated + summary.skippedNoGain + summary.failed;
            if (mountedRef.current) setLightweightProgress((progress) => ({ ...progress, done: progress.done + 1 }));
            dispatchStep3TaskUpdate({
              done,
              total: candidates.length,
              success: summary.generated,
              failed: summary.failed,
              currentLabel: `正在压缩参考图 ${done}/${candidates.length}`,
            });
          }
        }),
      ),
    );

    if (mountedRef.current) {
      setLightweightSummary(summary);
      setGeneratingLightweightAssets(false);
    }
    dispatchStep3TaskEnd({
      running: false,
      phase: 'lightweight',
      done: candidates.length,
      total: candidates.length,
      success: summary.generated,
      failed: summary.failed,
      currentLabel: null,
      error: summary.failed > 0 ? `压缩完成，${summary.failed} 张失败` : undefined,
    });
  };

  const updateOptimizeConcurrency = (value: number) => {
    dispatch({
      type: 'SET_PROJECT_STEP3_SETTINGS',
      settings: { optimizeConcurrency: clampStep3Concurrency(value) },
    });
  };

  const updateGenerateConcurrency = (value: number) => {
    dispatch({
      type: 'SET_PROJECT_STEP3_SETTINGS',
      settings: { generateConcurrency: clampStep3Concurrency(value) },
    });
  };

  const getVisibleGenerationTasks = useCallback((
    sourceItems: Record<string, AssetItem>,
    options?: BatchSelectionOptions,
  ) => {
    return getBatchGenerationTasks(sourceItems, options)
      .filter((item) => !isOfficialVirtualHumanSlot(item, useVolcVirtualHumans));
  }, [useVolcVirtualHumans]);

  const resolveGenerationItemForCurrentMode = useCallback((
    item: AssetItem,
    sourceItems: Record<string, AssetItem>,
    sourceAssets: readonly Asset[] = assetLibrary,
  ): { item: AssetItem; error?: string } => {
    const resolved = resolveGenerationItem(item, sourceItems);
    if (!isNoFaceCharacterVisualSlot(item, useVolcVirtualHumans)) return resolved;

    if (resolved.error) {
      return {
        item: {
          ...item,
          baseAssetId: undefined,
          generationMode: item.generationMode === 'upload' ? 'upload' : 'txt2img',
        },
      };
    }

    const sourceAsset = resolved.item.baseAssetId
      ? sourceAssets.find((asset) => asset.id === resolved.item.baseAssetId)
      : undefined;
    if (sourceAsset?.source !== 'volc_virtual_human') return resolved;

    return {
      item: {
        ...resolved.item,
        baseAssetId: undefined,
        generationMode: resolved.item.generationMode === 'upload' ? 'upload' : 'txt2img',
      },
    };
  }, [assetLibrary, useVolcVirtualHumans]);

  const handleOptimizePrompt = async (key?: string) => {
    const targetKey = key ?? editingKey;
    const target = targetKey ? items[targetKey] : null;
    if (!target || !analysis) return;

    if (target.type === 'character' && getCharacterMultiplicity(target.name) === 'group') {
      updateItem(targetKey!, { optimizedPrompt: buildDirectPrompt(target), isProcessing: false, error: undefined });
      return;
    }

    // 官方库的非身份角色图必须保持无脸，直接套用受控模板，避免 LLM 把 Step2 的面部信息带回来。
    if (isNoFaceCharacterVisualSlot(target, useVolcVirtualHumans)) {
      updateItem(targetKey!, { optimizedPrompt: buildNoFaceCharacterPrompt(target), isProcessing: false, error: undefined });
      return;
    }

    // 角色设定图使用受控模板，避免 LLM 破坏开发板分区和专属物品区。
    if (isTurnaroundConcept(target.concept)) {
      updateItem(targetKey!, { optimizedPrompt: buildTurnaroundPrompt(target), isProcessing: false, error: undefined });
      return;
    }

    const desc = buildDescription(target);
    const context = buildContext(target);
    const characterFocus = getCharacterFocus(target);
    const genderHint = inferCharacterGenderHint(
      target.name,
      desc,
      target.optimizedPrompt,
      context,
    );

    updateItem(targetKey!, { isProcessing: true, error: undefined });
    try {
      const optimized = await optimizeImagePrompt(
        state.apiConfig,
        desc,
        analysis.styleConfig ?? '',
        target.type,
        context,
        target.concept,
        characterFocus,
        undefined,
        genderHint,
        );
      if (mountedRef.current) updateItem(targetKey!, { optimizedPrompt: optimized, isProcessing: false });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : `API 请求失败: ${String(err)}`;
      if (mountedRef.current) updateItem(targetKey!, { isProcessing: false, error: errorMessage });
    }
  };

  // 批量 AI 润色
  const runBatchOptimize = async (pending: AssetItem[], options: BatchRunOptions = {}) => {
    if (!analysis) return false;
    if (pending.length === 0) return false;

    const failureRetryMode = options.failureRetryMode ?? 'optimize_only';
    beginBatchRun('optimize', pending.length, options);
    const limiter = new ConcurrentLimiter(clampStep3Concurrency(optimizeConcurrency));

    await Promise.allSettled(
      pending.map((item) =>
        limiter.run(async () => {
          if (batchStopRequestedRef.current) return;
          updateBatchLabel(`${item.name} · ${getImageConceptLabel(item.concept)}`);

          if (item.type === 'character' && getCharacterMultiplicity(item.name) === 'group') {
            updateItem(item.key, { optimizedPrompt: buildDirectPrompt(item), isProcessing: false, error: undefined });
            updateBatchProgress((p) => ({ ...p, done: p.done + 1, success: p.success + 1 }));
            return;
          }

          // 官方库的非身份角色图必须保持无脸，直接套用受控模板。
          if (isNoFaceCharacterVisualSlot(item, useVolcVirtualHumans)) {
            updateItem(item.key, { optimizedPrompt: buildNoFaceCharacterPrompt(item), isProcessing: false, error: undefined });
            updateBatchProgress((p) => ({ ...p, done: p.done + 1, success: p.success + 1 }));
            return;
          }

          // 角色设定图使用受控模板，避免 LLM 破坏开发板分区和专属物品区。
          if (isTurnaroundConcept(item.concept)) {
            updateItem(item.key, { optimizedPrompt: buildTurnaroundPrompt(item), isProcessing: false, error: undefined });
            updateBatchProgress((p) => ({ ...p, done: p.done + 1, success: p.success + 1 }));
            return;
          }

          const desc = buildDescription(item);
          const context = buildContext(item);
          const characterFocus = getCharacterFocus(item);
          const genderHint = inferCharacterGenderHint(
            item.name,
            desc,
            item.optimizedPrompt,
            context,
          );
          updateItem(item.key, { isProcessing: true, error: undefined });
          const controller = new AbortController();
          batchAbortControllersRef.current.add(controller);

          try {
            const optimized = await optimizeImagePrompt(
              state.apiConfig,
              desc,
              analysis.styleConfig ?? '',
              item.type,
              context,
              item.concept,
              characterFocus,
              controller.signal,
              genderHint,
            );
            if (mountedRef.current) {
              updateItem(item.key, { optimizedPrompt: optimized, isProcessing: false });
            }
            updateBatchProgress((p) => ({ ...p, success: p.success + 1 }));
          } catch (err: unknown) {
            if (isAbortError(err) && batchStopRequestedRef.current) {
              if (mountedRef.current) updateItem(item.key, { isProcessing: false });
            } else {
              const errorMessage = err instanceof Error ? err.message : '优化失败';
              if (mountedRef.current) {
                updateItem(item.key, { isProcessing: false, error: errorMessage });
              }
              addBatchFailure({
                key: item.key,
                name: item.name,
                concept: item.concept,
                phase: 'optimize',
                retryMode: failureRetryMode,
                error: errorMessage,
              });
              updateBatchProgress((p) => ({ ...p, failed: p.failed + 1 }));
            }
          } finally {
            batchAbortControllersRef.current.delete(controller);
            updateBatchProgress((p) => ({ ...p, done: p.done + 1 }));
          }
        }),
      ),
    );
    const stopped = batchStopRequestedRef.current;
    if (mountedRef.current) {
      clearBatchProcessingKeys(pending.map((item) => item.key));
    }
    finishBatchRun('optimize', stopped);
    return stopped;
  };

  const handleGenerateAllImages = async () => {
    const generationTasks = getVisibleGenerationTasks(itemsRef.current, batchSelectionOptions);
    if (generationTasks.length === 0) return;

    const stopped = await runBatchGenerate(generationTasks, {
      resetFailures: true,
      failureRetryMode: 'generate_only',
    });
    if (!stopped) {
      await handleGenerateLightweightAssets();
    }
  };

  // 图片生成 API
  const doGenerateImage = async (
    item: AssetItem,
    sourceAssets: readonly Asset[] = assetLibrary,
    signal?: AbortSignal,
    callbacks: ImageGenerationCallbacks = {},
  ): Promise<{
    blob: Blob;
    prompt: string;
    externalImageUrl?: string;
    externalImageExpiresAt?: number;
    sourceProvider?: string;
    sourceModel?: string;
    imageSize: AssetItem['imageSize'];
  }> => {
    if (isOfficialVirtualHumanSlot(item, useVolcVirtualHumans)) {
      throw new Error('官方虚拟人像槽位需要从官方库匹配选择，不再生成或上传真人脸。');
    }
    let sourceBlob: Blob | undefined;
    const sourceAsset = resolveImg2ImgSourceAsset(item, sourceAssets);
    if (sourceAsset) {
      sourceBlob = requireImg2ImgSourceBlob(
        sourceAsset,
        await loadBlob(sourceAsset.blobKey) ?? undefined,
      );
    }
    const prompt = getEffectivePrompt(item);
    const effectiveImageSize = normalizeImageSizeForConfig(state.imageApiConfig, item.imageSize, '1K');
    const result = await generateImage(state.imageApiConfig, {
      prompt,
      aspectRatio: item.aspectRatio,
      imageSize: effectiveImageSize,
      sourceBlob,
      signal,
      onStatus: callbacks.onStatus,
      onRemoteImageUrl: callbacks.onRemoteImageUrl,
      background: {
        projectId: currentProject?.id,
        chapterId: chapter?.id,
        namespace: `step3-${item.key}`,
        requireBackend: false,
      },
    }, state.videoApiConfig);
    return { ...result, prompt, imageSize: effectiveImageSize };
  };

  const doGenerateImageWithTransientRetry = async (
    item: AssetItem,
    sourceAssets: readonly Asset[] = assetLibrary,
    signal?: AbortSignal,
    callbacks: ImageGenerationCallbacks = {},
  ) => {
    const maxRetries = STEP3_IMAGE_GENERATE_RETRY_DELAYS_MS.length;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (signal?.aborted) {
        throw new DOMException('The user aborted a request.', 'AbortError');
      }

      try {
        return await doGenerateImage(item, sourceAssets, signal, callbacks);
      } catch (error) {
        if (isAbortError(error) || signal?.aborted || attempt >= maxRetries || !isTransientApiError(error)) {
          throw error;
        }

        const nextAttempt = attempt + 2;
        const totalAttempts = maxRetries + 1;
        const delayMs = STEP3_IMAGE_GENERATE_RETRY_DELAYS_MS[attempt] ?? 0;
        const errorMessage = getErrorMessage(error);
        callbacks.onStatus?.(
          `中转临时失败，${Math.round(delayMs / 1000)} 秒后自动重试 ${nextAttempt}/${totalAttempts}。上次错误：${errorMessage}`,
        );
        await waitForStep3RetryDelay(delayMs, signal);
        callbacks.onStatus?.(`正在自动重试 ${nextAttempt}/${totalAttempts}`);
      }
    }

    throw new Error('图片生成失败，但未返回具体错误');
  };

  // 上传本地文件
  const handleFileUpload = async (key: string, file: File) => {
    const item = items[key];
    if (!item) return;
    const blobKey = await saveBlob(file);
    const assetDescription = buildDescription(item);
    const asset: Asset = {
      id: genId(),
      name: item.name,
      type: item.type,
      concept: item.concept,
      description: assetDescription,
      identityKey: item.identityKey,
      variantKey: item.variantKey,
      outfitSeq: item.outfitSeq,
      optimizedPrompt: item.optimizedPrompt,
      generationMode: 'upload',
      blobKey,
      aspectRatio: item.aspectRatio,
      imageSize: item.imageSize,
      usedInStoryboards: [item.key],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (item.asset && item.asset.id !== asset.id) {
      updateAssetUsage(item.asset, key, false);
    }
    dispatch({ type: 'ADD_ASSET', asset });
    const objectUrl = URL.createObjectURL(file);
    updateItem(key, { asset, isProcessing: false, localBlobUrl: objectUrl, preventAutoAssetBinding: false });
    if (item.type === 'scene' || item.type === 'prop' || (item.type === 'character' && isStoryboardCharacterReferenceConcept(item.concept))) {
      syncPrimaryImageRefs(item, asset.id);
    }

    if (item.type === 'character' && (item.concept === 'portrait_closeup' || item.concept === 'portrait_outfit')) {
      autoLinkBaseAsset(item.name, asset.id, item.concept, item.variantKey);
    }
  };

  // 替换已有资产图片
  const replaceAssetImage = async (key: string, file: File) => {
    const item = items[key];
    if (!item?.asset) return;
    if (item.asset.source === 'volc_virtual_human') return;
    const previousBlobKey = item.asset.blobKey;
    const previousLightweightBlobKey = item.asset.lightweightBlobKey;
    const newBlobKey = await saveBlob(file);
    const updatedAt = Date.now();
    const nextDescription = buildDescription(item);
    const assetUpdates = {
      source: 'local' as const,
      externalAssetId: undefined,
      externalAssetUri: undefined,
      externalImageUrl: undefined,
      externalImageExpiresAt: undefined,
      externalSourceModel: undefined,
      thumbnailUrl: undefined,
      catalogTags: undefined,
      blobKey: newBlobKey,
      description: nextDescription,
      optimizedPrompt: item.optimizedPrompt,
      generationMode: 'upload' as const,
      baseAssetId: item.baseAssetId,
      aspectRatio: item.aspectRatio,
      imageSize: item.imageSize,
      ...clearLightweightVariantFields(),
      updatedAt,
    };
    dispatch({
      type: 'UPDATE_ASSET',
      assetId: item.asset.id,
      updates: assetUpdates,
    });
    revokeLocalObjectUrl(item.localBlobUrl);
    const objectUrl = URL.createObjectURL(file);
    updateItem(key, {
      asset: {
        ...item.asset,
        ...assetUpdates,
      },
      optimizedPrompt: item.optimizedPrompt,
      generationMode: 'upload',
      localBlobUrl: objectUrl,
      error: undefined,
      preventAutoAssetBinding: false,
    });
    if (!previousBlobKey.startsWith('external:')) {
      await deleteBlob(previousBlobKey).catch(() => undefined);
    }
    if (previousLightweightBlobKey) {
      await deleteBlob(previousLightweightBlobKey).catch(() => undefined);
    }
  };

  // 自动更新派生图片槽的 baseAssetId：角色设定图/变装图基于上游角色图。
  const autoLinkBaseAsset = useCallback((
    itemName: string,
    baseAssetId: string,
    sourceConcept: ImageConcept,
    sourceVariantKey?: string,
  ) => {
    setItems((prev) => {
      const nextItems = linkGeneratedCharacterBase(prev, itemName, baseAssetId, sourceConcept, sourceVariantKey);
      itemsRef.current = nextItems;
      return nextItems;
    });
  }, []);

  const recoverCompletedBackendImageJob = useCallback(async (job: BackgroundJob, slotKey: string) => {
    const projectId = currentProject?.id || job.projectId;
    const item = itemsRef.current[slotKey];
    if (!projectId || !item || item.asset) return false;

    const outputBlobKey = getJobText(job.output?.blobKey);
    if (!outputBlobKey) return false;

    const resolved = resolveGenerationItemForCurrentMode(item, itemsRef.current, assetLibrary);
    if (resolved.error) {
      updateItem(slotKey, { error: resolved.error, isProcessing: false });
      return false;
    }

    const finalItem = resolved.item;
    const downloadUrl = await createCloudProjectBlobDownloadUrl(projectId, outputBlobKey);
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text.slice(0, 300) || response.statusText || `HTTP ${response.status}`);
    }

    const contentType = getJobText(job.output?.contentType);
    const downloadedBlob = await response.blob();
    const blob = downloadedBlob.type || !contentType
      ? downloadedBlob
      : new Blob([await downloadedBlob.arrayBuffer()], { type: contentType });
    const localBlobKey = await saveBlob(blob);
    const objectUrl = URL.createObjectURL(blob);
    const prompt = getJobText(job.input?.prompt) || getEffectivePrompt(finalItem);
    const jobImageSize = getJobText(job.input?.imageSize);
    const recoveredImageSize = normalizeImageSizeForConfig(
      state.imageApiConfig,
      jobImageSize === '1K' || jobImageSize === '2K' || jobImageSize === '4K'
        ? jobImageSize
        : finalItem.imageSize,
      '1K',
    );
    const now = Date.now();
    const asset: Asset = {
      id: genId(),
      name: finalItem.name,
      type: finalItem.type,
      concept: finalItem.concept,
      description: buildDescription(finalItem),
      identityKey: finalItem.identityKey,
      variantKey: finalItem.variantKey,
      outfitSeq: finalItem.outfitSeq,
      optimizedPrompt: prompt,
      generationMode: finalItem.generationMode,
      baseAssetId: finalItem.baseAssetId,
      blobKey: localBlobKey,
      aspectRatio: finalItem.aspectRatio,
      imageSize: recoveredImageSize,
      ...getGeneratedAssetExternalFields({
        externalImageUrl: getJobText(job.output?.externalImageUrl),
        externalImageExpiresAt: typeof job.output?.externalImageExpiresAt === 'number' ? job.output.externalImageExpiresAt : undefined,
        sourceProvider: getJobText(job.output?.sourceProvider),
        sourceModel: getJobText(job.output?.sourceModel),
      }),
      usedInStoryboards: [slotKey],
      createdAt: now,
      updatedAt: now,
    };

    if (finalItem.asset && finalItem.asset.id !== asset.id) {
      updateAssetUsage(finalItem.asset, slotKey, false);
    }
    dispatch({ type: 'ADD_ASSET', asset });
    updateItem(slotKey, {
      asset,
      optimizedPrompt: prompt,
      isProcessing: false,
      localBlobUrl: objectUrl,
      preventAutoAssetBinding: false,
      error: undefined,
    });
    if (finalItem.type === 'scene' || finalItem.type === 'prop' || (finalItem.type === 'character' && isStoryboardCharacterReferenceConcept(finalItem.concept))) {
      syncPrimaryImageRefs(finalItem, asset.id);
    }
    if (finalItem.type === 'character' && (finalItem.concept === 'portrait_closeup' || finalItem.concept === 'portrait_outfit')) {
      autoLinkBaseAsset(finalItem.name, asset.id, finalItem.concept, finalItem.variantKey);
    }
    return true;
  }, [
    assetLibrary,
    autoLinkBaseAsset,
    buildDescription,
    currentProject?.id,
    dispatch,
    getEffectivePrompt,
    resolveGenerationItemForCurrentMode,
    syncPrimaryImageRefs,
    updateAssetUsage,
    updateItem,
  ]);

  const step3ItemCount = Object.keys(items).length;
  useEffect(() => {
    if (!currentProject?.id || !analysis || step3ItemCount === 0) {
      setBackendImageSync(createBackendImageSyncState());
      return;
    }

    let cancelled = false;
    let polling = false;

    const pollBackendImageJobs = async () => {
      if (polling) return;
      polling = true;
      try {
        const { jobs } = await listBackgroundJobs({
          projectId: currentProject.id,
          type: 'image-generations',
          limit: 200,
        });
        if (cancelled) return;

        const now = Date.now();
        const currentItems = itemsRef.current;
        const relevant = jobs
          .map((job) => ({ job, slotKey: getStep3BackendImageSlotKey(job) }))
          .filter((entry): entry is Step3BackendImageJobEntry => {
            if (!entry.slotKey) return false;
            const item = currentItems[entry.slotKey];
            if (!item || item.asset) return false;
            if (entry.job.status === 'queued' || entry.job.status === 'running') return true;
            return now - getJobTime(entry.job) <= STEP3_BACKEND_IMAGE_JOB_LOOKBACK_MS;
          });
        const latestRelevant = getLatestStep3BackendImageEntries(relevant);

        const recoverable = latestRelevant.filter(({ job }) =>
          job.status === 'succeeded'
          && !!getJobText(job.output?.blobKey)
          && !backendImageRecoveredRef.current.has(job.id)
          && !backendImageRecoveringRef.current.has(job.id),
        );
        const activeEntries = latestRelevant.filter(({ job }) => job.status === 'queued' || job.status === 'running');
        const oldestActiveEntry = activeEntries.reduce<Step3BackendImageJobEntry | null>((oldest, entry) => {
          if (!oldest) return entry;
          const currentTime = getJobStartTime(entry.job) || getJobTime(entry.job);
          const oldestTime = getJobStartTime(oldest.job) || getJobTime(oldest.job);
          return currentTime < oldestTime ? entry : oldest;
        }, null);
        const newestActiveEntry = activeEntries.reduce<Step3BackendImageJobEntry | null>((newest, entry) => {
          if (!newest) return entry;
          return getJobTime(entry.job) > getJobTime(newest.job) ? entry : newest;
        }, null);
        const nextSummary = createBackendImageSyncState({
          total: latestRelevant.length,
          queued: activeEntries.filter(({ job }) => job.status === 'queued').length,
          running: activeEntries.filter(({ job }) => job.status === 'running').length,
          recoverable: recoverable.length,
          recovering: backendImageRecoveringRef.current.size,
          recovered: backendImageRecoveredRef.current.size,
          failed: latestRelevant.filter(({ job }) => job.status === 'failed' || job.status === 'cancelled').length,
          updatedAt: Date.now(),
          activeStartedAt: oldestActiveEntry
            ? getJobStartTime(oldestActiveEntry.job) || getJobTime(oldestActiveEntry.job)
            : undefined,
          activeUpdatedAt: newestActiveEntry ? getJobTime(newestActiveEntry.job) : undefined,
          activeAttempt: typeof newestActiveEntry?.job.attempt === 'number' ? newestActiveEntry.job.attempt : undefined,
          activeMaxAttempts: typeof newestActiveEntry?.job.maxAttempts === 'number' ? newestActiveEntry.job.maxAttempts : undefined,
          activePhase: getJobText(newestActiveEntry?.job.progress?.phase),
        });
        setBackendImageSync((previous) => createBackendImageSyncState({
          ...nextSummary,
          lastMessage: nextSummary.total > 0
            ? `后台图片任务：排队 ${nextSummary.queued}，运行 ${nextSummary.running}，待回收 ${nextSummary.recoverable}，失败槽 ${nextSummary.failed}`
            : previous.lastMessage,
          lastError: undefined,
        }));

        for (const { job, slotKey } of recoverable) {
          if (cancelled) break;
          backendImageRecoveringRef.current.add(job.id);
          setBackendImageSync((previous) => createBackendImageSyncState({
            ...previous,
            recoverable: Math.max(0, previous.recoverable - 1),
            recovering: backendImageRecoveringRef.current.size,
            lastMessage: '正在把后台已完成图片写回当前素材槽',
            updatedAt: Date.now(),
          }));
          try {
            const recovered = await recoverCompletedBackendImageJob(job, slotKey);
            if (recovered) backendImageRecoveredRef.current.add(job.id);
          } catch (error) {
            if (!cancelled) {
              const message = getErrorMessage(error);
              updateItem(slotKey, { error: `后台图片回收失败：${message}`, isProcessing: false });
              setBackendImageSync((previous) => createBackendImageSyncState({
                ...previous,
                lastError: message,
                updatedAt: Date.now(),
              }));
            }
          } finally {
            backendImageRecoveringRef.current.delete(job.id);
            if (!cancelled) {
              setBackendImageSync((previous) => createBackendImageSyncState({
                ...previous,
                recovering: backendImageRecoveringRef.current.size,
                recovered: backendImageRecoveredRef.current.size,
                updatedAt: Date.now(),
              }));
            }
          }
        }
      } catch (error) {
        if (!cancelled) {
          setBackendImageSync((previous) => createBackendImageSyncState({
            ...previous,
            lastError: getErrorMessage(error),
            updatedAt: Date.now(),
          }));
        }
      } finally {
        polling = false;
      }
    };

    void pollBackendImageJobs();
    const intervalId = window.setInterval(pollBackendImageJobs, STEP3_BACKEND_IMAGE_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [analysis, currentProject?.id, recoverCompletedBackendImageJob, step3ItemCount, updateItem]);

  const clearLinkedBaseAsset = (
    itemName: string,
    sourceAssetId: string,
    sourceConcept: ImageConcept,
    sourceVariantKey?: string,
  ) => {
    setItems((prev) => {
      const nextItems = { ...prev };

      for (const slotKey of Object.keys(nextItems)) {
        const slotItem = nextItems[slotKey];
        if (slotItem.type !== 'character' || slotItem.name !== itemName) continue;

        const shouldClearLink = sourceConcept === 'portrait_closeup'
            ? (slotItem.concept === 'landscape_turnaround' || slotItem.concept === 'portrait_outfit')
            : slotItem.concept === 'landscape_outfit_turnaround' && slotItem.variantKey === sourceVariantKey;

        if (!shouldClearLink || slotItem.baseAssetId !== sourceAssetId) continue;

        nextItems[slotKey] = {
          ...slotItem,
          baseAssetId: undefined,
        };
      }

      itemsRef.current = nextItems;
      return nextItems;
    });
  };

// 执行生成
  const handleGenerate = async (key: string) => {
    const item = items[key];
    if (!item) return;
    const resolved = resolveGenerationItemForCurrentMode(item, items, assetLibrary);
    if (resolved.error) {
      updateItem(key, { error: resolved.error });
      return;
    }
    const finalItem = resolved.item;
    if (finalItem.baseAssetId !== item.baseAssetId || finalItem.generationMode !== item.generationMode) {
      updateItem(key, { baseAssetId: finalItem.baseAssetId, generationMode: finalItem.generationMode });
    }

    updateItem(key, { isProcessing: true, error: undefined });
    try {
      const imageResult = await doGenerateImageWithTransientRetry(finalItem, assetLibrary, undefined, {
        onRemoteImageUrl: (url) => {
          if (mountedRef.current) showGeneratedPreview(key, url);
        },
      });
      const { blob, prompt } = imageResult;
      const objectUrl = URL.createObjectURL(blob);
      if (mountedRef.current) showGeneratedPreview(key, objectUrl);
      const blobKey = await saveBlob(blob);
      const assetDescription = buildDescription(finalItem);
      const now = Date.now();
      const asset: Asset = {
        id: genId(),
        name: finalItem.name,
        type: finalItem.type,
        concept: finalItem.concept,
        description: assetDescription,
        identityKey: finalItem.identityKey,
        variantKey: finalItem.variantKey,
        outfitSeq: finalItem.outfitSeq,
        optimizedPrompt: prompt,
        generationMode: finalItem.generationMode,
        baseAssetId: finalItem.baseAssetId,
        blobKey,
        aspectRatio: finalItem.aspectRatio,
        imageSize: imageResult.imageSize,
        ...getGeneratedAssetExternalFields(imageResult),
        usedInStoryboards: [key],
        createdAt: now,
        updatedAt: now,
      };
      if (finalItem.asset && finalItem.asset.id !== asset.id) {
        updateAssetUsage(finalItem.asset, key, false);
      }
      dispatch({ type: 'ADD_ASSET', asset });
      updateItem(key, { asset, optimizedPrompt: prompt, isProcessing: false, localBlobUrl: objectUrl, preventAutoAssetBinding: false });
      if (finalItem.type === 'scene' || finalItem.type === 'prop' || (finalItem.type === 'character' && isStoryboardCharacterReferenceConcept(finalItem.concept))) {
        syncPrimaryImageRefs(finalItem, asset.id);
      }

      if (finalItem.type === 'character' && (finalItem.concept === 'portrait_closeup' || finalItem.concept === 'portrait_outfit')) {
        autoLinkBaseAsset(finalItem.name, asset.id, finalItem.concept, finalItem.variantKey);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : `生成失败: ${String(err)}`;
      updateItem(key, { isProcessing: false, error: errorMessage });
    }
  };

  // 批量生成
  const runBatchGenerate = async (orderedTasks: AssetItem[], options: BatchRunOptions = {}) => {
    if (orderedTasks.length === 0) return false;

    const failureRetryMode = options.failureRetryMode ?? 'generate_only';
    beginBatchRun('generate', orderedTasks.length, options);

    let workingItems = { ...itemsRef.current };
    const workingAssetLibrary = [...assetLibrary];
    const queue = [...orderedTasks];
    const pendingKeys = new Set(queue.map((item) => item.key));
    const inFlight = new Set<Promise<void>>();
    const inFlightKeys = new Set<string>();
    const maxConcurrency = clampStep3Concurrency(generateConcurrency);

    const dequeueNextTask = () => {
      for (let index = 0; index < queue.length; index++) {
        const candidate = queue[index];
        const currentCandidate = workingItems[candidate.key] ?? candidate;
        if (shouldDeferGenerationTask(currentCandidate, workingItems, pendingKeys, inFlightKeys)) {
          continue;
        }

        queue.splice(index, 1);
        pendingKeys.delete(candidate.key);
        return candidate;
      }
      return null;
    };

    const runTask = async (task: AssetItem) => {
      if (batchStopRequestedRef.current) return;
      updateBatchLabel(`${task.name} · ${getOfficialModeConceptLabel(task.concept, useVolcVirtualHumans)}`);

      const resolved = resolveGenerationItemForCurrentMode(workingItems[task.key] ?? task, workingItems, workingAssetLibrary);
      const generationDependencyError = resolved.error;
      if (generationDependencyError) {
        if (mountedRef.current) {
          updateItem(task.key, { error: generationDependencyError, isProcessing: false });
        }
        addBatchFailure({
          key: task.key,
          name: task.name,
          concept: task.concept,
          phase: 'generate',
          retryMode: failureRetryMode,
          error: generationDependencyError,
        });
        updateBatchProgress((p) => ({ ...p, done: p.done + 1, failed: p.failed + 1 }));
        return;
      }

      const finalItem = resolved.item;
      const mergeWorkingItem = (updates: Partial<AssetItem>) => {
        const base = workingItems[task.key] ?? itemsRef.current[task.key] ?? finalItem;
        workingItems = {
          ...workingItems,
          [task.key]: { ...base, ...updates },
        };
      };

      if (finalItem.baseAssetId !== task.baseAssetId || finalItem.generationMode !== task.generationMode) {
        mergeWorkingItem({ baseAssetId: finalItem.baseAssetId, generationMode: finalItem.generationMode });
        updateItem(task.key, { baseAssetId: finalItem.baseAssetId, generationMode: finalItem.generationMode });
      }

      mergeWorkingItem({ isProcessing: true, error: undefined });
      updateItem(task.key, { isProcessing: true, error: undefined });
      const controller = new AbortController();
      batchAbortControllersRef.current.add(controller);

      try {
        const imageResult = await doGenerateImageWithTransientRetry(
          finalItem,
          workingAssetLibrary,
          controller.signal,
          {
            onStatus: (message) => {
              updateBatchLabel(`${finalItem.name} · ${message}`);
            },
            onRemoteImageUrl: (url) => {
              mergeWorkingItem({ localBlobUrl: url, isProcessing: true });
              if (mountedRef.current) {
                showGeneratedPreview(task.key, url);
              }
            },
          },
        );
        const { blob, prompt } = imageResult;
        const objectUrl = URL.createObjectURL(blob);
        mergeWorkingItem({ optimizedPrompt: prompt, isProcessing: true, localBlobUrl: objectUrl });
        if (mountedRef.current) {
          showGeneratedPreview(task.key, objectUrl);
        }
        updateBatchLabel(`${finalItem.name} · 图片已显示，正在写入本地素材库`);
        const blobKey = await saveBlob(blob);
        const assetDescription = buildDescription(finalItem);
        const now = Date.now();
        const asset: Asset = {
          id: genId(),
          name: finalItem.name,
          type: finalItem.type,
          concept: finalItem.concept,
          description: assetDescription,
          identityKey: finalItem.identityKey,
          variantKey: finalItem.variantKey,
          outfitSeq: finalItem.outfitSeq,
          optimizedPrompt: prompt,
          generationMode: finalItem.generationMode,
          baseAssetId: finalItem.baseAssetId,
          blobKey,
          aspectRatio: finalItem.aspectRatio,
          imageSize: imageResult.imageSize,
          ...getGeneratedAssetExternalFields(imageResult),
          usedInStoryboards: [task.key],
          createdAt: now,
          updatedAt: now,
        };
        if (finalItem.asset && finalItem.asset.id !== asset.id) {
          updateAssetUsage(finalItem.asset, task.key, false);
        }
        dispatch({ type: 'ADD_ASSET', asset });
        workingAssetLibrary.push(asset);
        workingItems = {
          ...workingItems,
          [task.key]: { ...finalItem, optimizedPrompt: prompt, asset, isProcessing: false, localBlobUrl: objectUrl },
        };
        itemsRef.current = workingItems;
        if (mountedRef.current) {
          updateItem(task.key, { asset, optimizedPrompt: prompt, isProcessing: false, localBlobUrl: objectUrl, preventAutoAssetBinding: false });
        } else {
          revokeLocalObjectUrl(objectUrl);
        }
        updateBatchProgress((p) => ({ ...p, success: p.success + 1 }));
          if (finalItem.type === 'scene' || finalItem.type === 'prop' || (finalItem.type === 'character' && isStoryboardCharacterReferenceConcept(finalItem.concept))) {
            syncPrimaryImageRefs(finalItem, asset.id);
          }
        if (finalItem.type === 'character' && (finalItem.concept === 'portrait_closeup' || finalItem.concept === 'portrait_outfit')) {
          workingItems = linkGeneratedCharacterBase(
            workingItems,
            finalItem.name,
            asset.id,
            finalItem.concept,
            finalItem.variantKey,
          );
          itemsRef.current = workingItems;
          autoLinkBaseAsset(finalItem.name, asset.id, finalItem.concept, finalItem.variantKey);
        }
      } catch (err: unknown) {
        if (isAbortError(err) && batchStopRequestedRef.current) {
          if (mountedRef.current) updateItem(task.key, { isProcessing: false });
        } else {
          const errorMessage = err instanceof Error ? err.message : `生成失败: ${String(err)}`;
          if (mountedRef.current) {
            updateItem(task.key, { isProcessing: false, error: errorMessage });
          }
          addBatchFailure({
            key: task.key,
            name: task.name,
            concept: task.concept,
            phase: 'generate',
            retryMode: failureRetryMode,
            error: errorMessage,
          });
          updateBatchProgress((p) => ({ ...p, failed: p.failed + 1 }));
        }
      } finally {
        batchAbortControllersRef.current.delete(controller);
        updateBatchProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    };

    while (queue.length > 0 || inFlight.size > 0) {
      while (!batchStopRequestedRef.current && inFlight.size < maxConcurrency) {
        const nextTask = dequeueNextTask();
        if (!nextTask) break;

        inFlightKeys.add(nextTask.key);
        const taskPromise = runTask(nextTask).finally(() => {
          inFlightKeys.delete(nextTask.key);
          inFlight.delete(taskPromise);
        });
        inFlight.add(taskPromise);
      }

      if (inFlight.size === 0) break;
      await Promise.race(inFlight);
    }

    if (inFlight.size > 0) {
      await Promise.allSettled(Array.from(inFlight));
    }
    const stopped = batchStopRequestedRef.current;
    if (mountedRef.current) {
      clearBatchProcessingKeys(orderedTasks.map((task) => task.key));
    }
    finishBatchRun('generate', stopped);
    return stopped;
  };

  const handleRetryFailedBatch = async () => {
    if (generatingLightweightAssets) return;
    if (batchFailures.length === 0) return;
    const failuresToRetry = [...batchFailures];
    clearBatchFailures();

    const optimizeOnlyKeys = new Set(
      failuresToRetry.filter((failure) => failure.retryMode === 'optimize_only').map((failure) => failure.key),
    );
    const optimizeThenGenerateKeys = new Set(
      failuresToRetry.filter((failure) => failure.retryMode === 'optimize_then_generate').map((failure) => failure.key),
    );
    const generateOnlyKeys = new Set(
      failuresToRetry.filter((failure) => failure.retryMode === 'generate_only').map((failure) => failure.key),
    );

    if (optimizeOnlyKeys.size > 0) {
      const optimizeRetryItems = Object.values(itemsRef.current).filter((item) => optimizeOnlyKeys.has(item.key));
      const optimizeStopped = await runBatchOptimize(optimizeRetryItems, {
        resetFailures: false,
        failureRetryMode: 'optimize_only',
      });
      if (optimizeStopped) return;
    }

    if (optimizeThenGenerateKeys.size > 0) {
      const optimizeRetryItems = Object.values(itemsRef.current).filter((item) => optimizeThenGenerateKeys.has(item.key));
      const optimizeStopped = await runBatchOptimize(optimizeRetryItems, {
        resetFailures: false,
        failureRetryMode: 'optimize_then_generate',
      });
      if (optimizeStopped) return;

      const generationRetryItems = Object.fromEntries(
        Object.entries(itemsRef.current).filter(([key]) => optimizeThenGenerateKeys.has(key)),
      );
      await runBatchGenerate(
        getVisibleGenerationTasks(generationRetryItems, { includeOutfitVariants: true }),
        { resetFailures: false, failureRetryMode: 'generate_only' },
      );
    }

    if (generateOnlyKeys.size > 0) {
      const generationRetryItems = Object.fromEntries(
        Object.entries(itemsRef.current).filter(([key]) => generateOnlyKeys.has(key)),
      );
      await runBatchGenerate(
        getVisibleGenerationTasks(generationRetryItems, { includeOutfitVariants: true }),
        { resetFailures: false, failureRetryMode: 'generate_only' },
      );
    }
  };

  const handleRetrySingleFailure = async (failure: BatchFailure) => {
    if (batchGenerating || batchOptimizing || generatingLightweightAssets || chapter?.step3Task?.running) return;
    const nextFailures = batchFailuresRef.current.filter((item) => !(item.key === failure.key && item.phase === failure.phase));
    batchFailuresRef.current = nextFailures;
    setBatchFailures(nextFailures);
    dispatchStep3TaskUpdate({ failures: nextFailures });

    if (failure.retryMode === 'optimize_only') {
      const targetItem = itemsRef.current[failure.key];
      if (!targetItem) return;
      await runBatchOptimize([targetItem], {
        resetFailures: false,
        failureRetryMode: 'optimize_only',
      });
      return;
    }

    if (failure.retryMode === 'optimize_then_generate') {
      const targetItem = itemsRef.current[failure.key];
      if (!targetItem) return;
      const optimizeStopped = await runBatchOptimize([targetItem], {
        resetFailures: false,
        failureRetryMode: 'optimize_then_generate',
      });
      if (optimizeStopped) return;

      const generationRetryItems = Object.fromEntries(
        Object.entries(itemsRef.current).filter(([key]) => key === failure.key),
      );
      await runBatchGenerate(
        getVisibleGenerationTasks(generationRetryItems, { includeOutfitVariants: true }),
        { resetFailures: false, failureRetryMode: 'generate_only' },
      );
      return;
    }

    const generationRetryItems = Object.fromEntries(
      Object.entries(itemsRef.current).filter(([key]) => key === failure.key),
    );
    await runBatchGenerate(
      getVisibleGenerationTasks(generationRetryItems, { includeOutfitVariants: true }),
      { resetFailures: false, failureRetryMode: 'generate_only' },
    );
  };

  // #10 优化：下载时复用 localBlobUrl
  const handleDownload = async (key: string) => {
    const item = items[key];
    if (!item?.asset) return;
    if (item.asset.source === 'volc_virtual_human') return;

    let blob: Blob | null = null;
    if (item.localBlobUrl) {
      try {
        const res = await fetch(item.localBlobUrl);
        blob = await res.blob();
      } catch {
        // fallback to IndexedDB
      }
    }
    if (!blob) {
      blob = await loadBlob(item.asset.blobKey);
    }
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildAssetDownloadFileName(item.asset, assetLibrary, getImageConceptLabel);
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetAssetSlot = (key: string, item: AssetItem) => {
    const resetAssetId = item.asset?.id;
    if (item.asset) {
      updateAssetUsage(item.asset, key, false);
        if (item.type === 'scene' || item.type === 'prop' || (item.type === 'character' && isStoryboardCharacterReferenceConcept(item.concept))) {
          syncPrimaryImageRefs(item, undefined);
        }
    }
    revokeLocalObjectUrl(item.localBlobUrl);
    updateItem(key, {
      asset: undefined,
      localBlobUrl: undefined,
      optimizedPrompt: '',
      generationMode: isOfficialVirtualHumanSlot(item, useVolcVirtualHumans) ? 'upload' : 'txt2img',
      baseAssetId: undefined,
      imageSize: undefined,
      preventAutoAssetBinding: true,
    });
    if (resetAssetId && item.type === 'character' && (item.concept === 'portrait_closeup' || item.concept === 'portrait_outfit')) {
      clearLinkedBaseAsset(item.name, resetAssetId, item.concept, item.variantKey);
    }
  };

  // #6 修复：重置时删除 Asset
  const handleReset = (key: string) => {
    const item = items[key];
    if (!item) return;
    if (!window.confirm('确定要重置当前图片吗？\n\n会清空这个槽位，方便重新生成或重新上传；资产库里的原图不会被删除。')) return;
    resetAssetSlot(key, item);
  };

  // 设为默认图片：同角色只有一个默认，设为新默认时取消旧默认
  const handleSetDefault = (key: string) => {
    const item = items[key];
    if (!item?.asset || item.type !== 'character' || item.concept !== 'portrait_closeup') return;

    const nextIsDefault = !item.asset.isDefault;

    const sameCharAssets = assetLibrary.filter(
      (a) => a.type === 'character' && a.name === item.name,
    );
    for (const a of sameCharAssets) {
      if (a.isDefault && a.id !== item.asset!.id) {
        dispatch({ type: 'UPDATE_ASSET', assetId: a.id, updates: { isDefault: false } });
      }
    }

    dispatch({ type: 'UPDATE_ASSET', assetId: item.asset!.id, updates: { isDefault: nextIsDefault } });

    if (nextIsDefault) {
      syncPrimaryImageRefs(item, item.asset.id);
    } else {
      syncPrimaryImageRefs(item, undefined);
    }

    setItems((prev) => {
      const updated = { ...prev };
      for (const k of Object.keys(updated)) {
        const it = updated[k];
        if (it.type === 'character' && it.name === item.name && it.asset) {
          updated[k] = {
            ...it,
            asset: {
              ...it.asset,
              isDefault: it.asset.id === item.asset!.id ? nextIsDefault : false,
            },
          };
        }
      }
      itemsRef.current = updated;
      return updated;
    });

  };

  // 从资产库选择
  const handleSelectFromLibrary = async (key: string, asset: Asset) => {
    const oldItem = items[key];
    const blob = asset.source === 'volc_virtual_human' ? null : await loadBlob(asset.blobKey);
    const localBlobUrl = blob ? URL.createObjectURL(blob) : undefined;

    revokeLocalObjectUrl(oldItem?.localBlobUrl);

    rebindSlotAsset(key, asset, oldItem?.asset);

    updateItem(key, {
      asset: { ...asset },
      optimizedPrompt: asset.optimizedPrompt,
      generationMode: asset.generationMode,
      baseAssetId: asset.baseAssetId,
      aspectRatio: asset.aspectRatio,
      imageSize: asset.imageSize,
      localBlobUrl,
      preventAutoAssetBinding: false,
    });

    if (oldItem.type === 'character'
      && asset.source !== 'volc_virtual_human'
      && (asset.concept === 'portrait_closeup' || asset.concept === 'portrait_outfit')) {
      autoLinkBaseAsset(oldItem.name, asset.id, asset.concept, oldItem.variantKey ?? asset.variantKey);
    }

    setShowAssetPicker(false);
  };

  const applyVirtualHumanSelection = (key: string, person: VolcVirtualHuman) => {
    const item = itemsRef.current[key];
    if (!item || !isOfficialVirtualHumanSlot(item, useVolcVirtualHumans)) return false;

    const asset = buildVirtualHumanAsset(item, person);

    if (item.asset) {
      updateAssetUsage(item.asset, key, false);
    }
    for (const existingAsset of assetLibrary) {
      if (
        existingAsset.type === 'character'
        && existingAsset.name === item.name
        && existingAsset.id !== asset.id
        && existingAsset.isDefault
      ) {
        dispatch({ type: 'UPDATE_ASSET', assetId: existingAsset.id, updates: { isDefault: false } });
      }
    }

    revokeLocalObjectUrl(item.localBlobUrl);
    dispatch({ type: 'ADD_ASSET', asset });
    updateItem(key, {
      asset,
      optimizedPrompt: '',
      generationMode: 'upload',
      baseAssetId: undefined,
      localBlobUrl: undefined,
      preventAutoAssetBinding: false,
      error: undefined,
    });
    return true;
  };

  const handleSelectVirtualHuman = (key: string, person: VolcVirtualHuman) => {
    applyVirtualHumanSelection(key, person);
  };

  const getVirtualHumanProfile = useCallback((name: string) => {
    return findVirtualHumanProfile(name, analysis?.characterProfiles, currentProject?.characterProfiles);
  }, [analysis?.characterProfiles, currentProject?.characterProfiles]);

  const handleAutoMatchVirtualHumans = async () => {
    if (!useVolcVirtualHumans || autoMatchingVirtualHumans) return;
    const targetItems = getPendingVirtualHumanItems(itemsRef.current, true);
    if (targetItems.length === 0) return;

    setAutoMatchingVirtualHumans(true);
    try {
      const catalog = await loadVolcVirtualHumanCatalog();
      if (catalog.length === 0) {
        targetItems.forEach((item) => updateItem(item.key, { error: '官方虚拟人像目录未加载，请检查 public/data/volc-virtual-humans.json' }));
        return;
      }

      const reservedAssetIds = getReservedVirtualHumanAssetIds(assetLibrary);
      const results = matchDistinctVirtualHumans(
        buildVirtualHumanMatchInputs(targetItems, getVirtualHumanProfile, buildContext),
        catalog,
        { limitPerInput: VIRTUAL_HUMAN_AUTO_MATCH_LIMIT, reservedAssetIds },
      );

      let applied = 0;
      for (const result of results) {
        if (result.match && applyVirtualHumanSelection(result.key, result.match.person)) {
          applied += 1;
        } else {
          updateItem(result.key, { error: '没有找到可用的官方虚拟人像候选，请手动匹配' });
        }
      }

      if (applied === 0) {
        targetItems.forEach((item) => updateItem(item.key, { error: '没有自动匹配到官方虚拟人像，请手动选择' }));
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      targetItems.forEach((item) => updateItem(item.key, { error: `官方人像自动匹配失败：${error}` }));
    } finally {
      if (mountedRef.current) setAutoMatchingVirtualHumans(false);
    }
  };

  // 拖拽上传
  const handleDrop = async (e: React.DragEvent, key: string) => {
    e.preventDefault();
    const item = items[key];
    if (!item) return;
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      if (item.asset) {
        await replaceAssetImage(key, file);
      } else {
        await handleFileUpload(key, file);
      }
    }
  };

  // 统计
  const allItems = Object.values(items);
  const coreItems = allItems.filter(isCoreRequiredSlot);
  const enhancementItems = allItems.filter(isManualEnhancementSlot);
  const coreTotalSlots = coreItems.length;
  const coreReadySlots = coreItems.filter((item) => !!item.asset).length;
  const enhancementTotalSlots = enhancementItems.length;
  const enhancementReadySlots = enhancementItems.filter((item) => !!item.asset).length;
  const allCoreReady = coreTotalSlots > 0 && coreReadySlots === coreTotalSlots;
  const lightweightAssetTotalCount = useMemo(
    () => assetLibrary.filter(canGenerateLightweightAsset).length,
    [assetLibrary],
  );
  const lightweightAssetReadyCount = useMemo(
    () => assetLibrary.filter((asset) => canGenerateLightweightAsset(asset) && !!asset.lightweightBlobKey).length,
    [assetLibrary],
  );
  const lightweightAssetPendingCount = Math.max(0, lightweightAssetTotalCount - lightweightAssetReadyCount);
  const officialVirtualHumanPendingCount = useMemo(() => {
    return countPendingVirtualHumanItems(allItems, useVolcVirtualHumans);
  }, [allItems, useVolcVirtualHumans]);

  // 每个角色名下的图片槽数量 + 默认图状态
  const characterReadyMap = useMemo(() => {
    const map: Record<string, {
      ready: number;
      total: number;
      coreReady: number;
      coreTotal: number;
      enhancementReady: number;
      enhancementTotal: number;
      hasDefault: boolean;
      defaultConcept?: string;
    }> = {};
    for (const item of allItems) {
      if (item.type !== 'character') continue;
      if (!map[item.name]) {
        map[item.name] = {
          ready: 0,
          total: 0,
          coreReady: 0,
          coreTotal: 0,
          enhancementReady: 0,
          enhancementTotal: 0,
          hasDefault: false,
        };
      }
      map[item.name].total++;
      if (item.asset) map[item.name].ready++;
      if (isCoreRequiredSlot(item)) {
        map[item.name].coreTotal++;
        if (item.asset) map[item.name].coreReady++;
      }
      if (isManualEnhancementSlot(item)) {
        map[item.name].enhancementTotal++;
        if (item.asset) map[item.name].enhancementReady++;
      }
      if (item.asset?.isDefault) {
        map[item.name].hasDefault = true;
        map[item.name].defaultConcept = item.concept;
      }
    }
    return map;
  }, [allItems]);

  const filteredCharacters = useMemo(() => dedupeCharacterRefsByName(characters), [characters]);
  const filteredScenes = scenes;
  const filteredProps = props;

  const collectSectionItems = useCallback((
    section: SectionAutoType,
    refs: ImageReference[],
    sourceItems: Record<string, AssetItem>,
  ) => {
    const sectionItems: Record<string, AssetItem> = {};

    for (const ref of refs) {
      if (section === 'character') {
        for (const item of getCharacterItemsForName(sourceItems, ref.name)) {
          sectionItems[item.key] = item;
        }
        continue;
      }

      if (section === 'scene') {
        for (const item of getSceneItemsForName(sourceItems, ref.name)) {
          sectionItems[item.key] = item;
        }
        continue;
      }

      const key = makeItemKey('prop', ref.name, PROP_CONCEPT.concept, ref.trackingId);
      const item = sourceItems[key];
      if (item) sectionItems[key] = item;
    }

    return sectionItems;
  }, []);

  const batchSelectionOptions = useMemo<BatchSelectionOptions>(
    () => ({ includeOutfitVariants: includeOutfitVariantsInBatch }),
    [includeOutfitVariantsInBatch],
  );

  const countSectionOneClickTargets = useCallback((section: SectionAutoType, sectionItems: Record<string, AssetItem>) => {
    const options = section === 'character' ? batchSelectionOptions : undefined;
    return getVisibleGenerationTasks(sectionItems, options).length;
  }, [batchSelectionOptions, getVisibleGenerationTasks]);

  const characterSectionItems = useMemo(
    () => collectSectionItems('character', filteredCharacters, items),
    [collectSectionItems, filteredCharacters, items],
  );
  const sceneSectionItems = useMemo(
    () => collectSectionItems('scene', filteredScenes, items),
    [collectSectionItems, filteredScenes, items],
  );
  const propSectionItems = useMemo(
    () => collectSectionItems('prop', filteredProps, items),
    [collectSectionItems, filteredProps, items],
  );

  const characterOneClickCount = useMemo(
    () => countSectionOneClickTargets('character', characterSectionItems),
    [characterSectionItems, countSectionOneClickTargets],
  );
  const characterResettableCount = useMemo(
    () => Object.values(characterSectionItems).filter((item) => !!item.asset || !!item.localBlobUrl || !!item.baseAssetId).length,
    [characterSectionItems],
  );
  const sceneOneClickCount = useMemo(
    () => countSectionOneClickTargets('scene', sceneSectionItems),
    [sceneSectionItems, countSectionOneClickTargets],
  );
  const propOneClickCount = useMemo(
    () => countSectionOneClickTargets('prop', propSectionItems),
    [propSectionItems, countSectionOneClickTargets],
  );
  const allImageOneClickCount = useMemo(() => {
    return getVisibleGenerationTasks(items, batchSelectionOptions).length;
  }, [batchSelectionOptions, getVisibleGenerationTasks, items]);
  const voiceReferenceReadyCount = useMemo(() => {
    return filteredCharacters.filter((character) => {
      const reference = getCharacterVoiceReferences(currentProject, character.name)[0];
      return !!reference?.audioBlobKey || !!reference?.publicAudioUrl;
    }).length;
  }, [filteredCharacters, currentProject]);
  const nextMissingCoreCount = Math.max(0, coreTotalSlots - coreReadySlots);
  const nextMissingLightweightCount = Math.max(0, lightweightAssetTotalCount - lightweightAssetReadyCount);
  const primaryAssetActionCount = allImageOneClickCount > 0 ? allImageOneClickCount : lightweightAssetPendingCount;
  const hasPrimaryAssetAction = allImageOneClickCount > 0 || lightweightAssetPendingCount > 0;
  const backgroundStep3Task = chapter?.step3Task?.running ? chapter.step3Task : null;
  const backendImageActive = backendImageSync.queued + backendImageSync.running + backendImageSync.recovering > 0;
  const backendImageActiveHint = formatBackendImageActiveHint(backendImageSync);
  const detachedBackendImageRunning = backendImageActive && !batchGenerating && !batchOptimizing && !backgroundStep3Task && !currentStep3GlobalTask;
  const visibleBatchRunning = batchGenerating || batchOptimizing || !!backgroundStep3Task || !!currentStep3GlobalTask || backendImageActive;
  const visibleBatchProgress = backgroundStep3Task && !batchGenerating && !batchOptimizing
    ? {
        done: backgroundStep3Task.done,
        total: backgroundStep3Task.total,
        success: backgroundStep3Task.success,
        failed: backgroundStep3Task.failed,
      }
    : batchProgress;
  const visibleBatchCurrentLabel = batchCurrentLabel ?? backgroundStep3Task?.currentLabel ?? null;
  const visibleBatchStopRequested = batchStopRequested || !!backgroundStep3Task?.stopRequested;
  const visibleBatchStopped = batchStopped || !!chapter?.step3Task?.stopped;
  const primaryAssetActionLabel = visibleBatchRunning
    ? detachedBackendImageRunning
      ? `后台图片同步中（${backendImageSync.queued + backendImageSync.running}）`
      : formatBatchProgressButtonLabel(visibleBatchProgress)
    : generatingLightweightAssets
      ? `压缩中 ${lightweightProgress.done}/${lightweightProgress.total}`
      : hasPrimaryAssetAction
        ? `生成并压缩（${primaryAssetActionCount}）`
        : '已全部生成';
  const batchProgressReadinessLabel = visibleBatchRunning
    ? detachedBackendImageRunning
      ? backendImageSync.lastMessage ?? '后台图片任务仍在运行，完成后会自动回收'
      : `${formatBatchProgressLabel(visibleBatchProgress)}${allCoreReady ? ' · 参考图已就绪，正在收尾' : ''}`
    : null;
  const batchCurrentReadinessLabel = visibleBatchRunning && allCoreReady
    ? '参考图已就绪，剩余任务不阻塞进入故事板'
    : detachedBackendImageRunning
      ? backendImageSync.lastMessage ?? '后台图片任务同步中'
      : visibleBatchCurrentLabel;
  const handlePrimaryAssetProduction = async () => {
    if (!currentProject?.id || !chapter?.id) return;
    if (allImageOneClickCount > 0) {
      if (ENABLE_GLOBAL_STEP3_TASKS) {
        dispatch({
          type: 'QUEUE_STEP3_BATCH_TASK',
          projectId: currentProject.id,
          chapterId: chapter.id,
          total: allImageOneClickCount,
          mode: 'all-images',
          includeOutfitVariants: includeOutfitVariantsInBatch,
        });
      } else {
        await handleGenerateAllImages();
      }
      return;
    }
    if (lightweightAssetPendingCount > 0) {
      if (ENABLE_GLOBAL_STEP3_TASKS) {
        dispatch({
          type: 'QUEUE_STEP3_BATCH_TASK',
          projectId: currentProject.id,
          chapterId: chapter.id,
          total: lightweightAssetPendingCount,
          mode: 'lightweight-assets',
        });
      } else {
        await handleGenerateLightweightAssets();
      }
      return;
    }
  };
  const runSectionAutoGeneration = async (section: SectionAutoType, refs: ImageReference[]) => {
    if (!currentProject?.id || !chapter?.id) return;
    const initialItems = collectSectionItems(section, refs, itemsRef.current);
    const options = section === 'character' ? batchSelectionOptions : undefined;
    const generationTasks = getVisibleGenerationTasks(initialItems, options);
    if (generationTasks.length === 0) return;

    if (ENABLE_GLOBAL_STEP3_TASKS) {
      dispatch({
        type: 'QUEUE_STEP3_BATCH_TASK',
        projectId: currentProject.id,
        chapterId: chapter.id,
        total: generationTasks.length,
        mode: 'section-images',
        section,
        includeOutfitVariants: section === 'character' ? includeOutfitVariantsInBatch : undefined,
      });
      return;
    }

    const stopped = await runBatchGenerate(generationTasks, {
      resetFailures: true,
      failureRetryMode: 'generate_only',
    });
    if (!stopped) {
      await handleGenerateLightweightAssets();
    }
  };

  const handleCharacterOneClick = async () => {
    await runSectionAutoGeneration('character', filteredCharacters);
  };

  const handleResetAllCharacters = () => {
    if (visibleBatchRunning || generatingLightweightAssets || characterResettableCount === 0) return;
    const confirmed = window.confirm(
      `确定要重置全部角色素材吗？\n\n会清空当前章节 ${characterResettableCount} 个角色图片槽位，方便重新生成；资产库里的原图不会被删除。`,
    );
    if (!confirmed) return;

    Object.entries(characterSectionItems).forEach(([key, item]) => {
      if (!item.asset && !item.localBlobUrl && !item.baseAssetId) return;
      resetAssetSlot(key, item);
    });
    setEditingKey(null);
    setShowAssetPicker(false);
  };

  const handleSceneOneClick = async () => {
    await runSectionAutoGeneration('scene', filteredScenes);
  };

  const handlePropOneClick = async () => {
    await runSectionAutoGeneration('prop', filteredProps);
  };

  // 获取概念标签
  const getConceptLabel = (concept: ImageConcept) => {
    return getOfficialModeConceptLabel(concept, useVolcVirtualHumans);
  };

  const getConceptDesc = (concept: ImageConcept) => {
    return getOfficialModeConceptDesc(concept, useVolcVirtualHumans);
  };

  // 点击缩略图：展开/折叠编辑区
  const handleThumbClick = (key: string) => {
    setEditingKey((prev) => prev === key ? null : key);
    setShowAssetPicker(false);
  };

  const selectedStyleValue =
    analysis?.styleConfig && analysis.styleConfig !== '__custom__' ? analysis.styleConfig : '__custom__';
  const selectedStylePreset =
    selectedStyleValue !== '__custom__'
      ? STYLE_PRESETS.find((preset) => preset.value === selectedStyleValue)
      : null;
  const styleSummaryLabel = selectedStylePreset?.label
    ?? (analysis?.styleConfig?.trim() ? '自定义风格' : '未设置风格');
  const virtualHumanPickerProfile = virtualHumanPickerItem
    ? getVirtualHumanProfile(virtualHumanPickerItem.name)
    : undefined;
  const showCharacters = true;
  const showScenes = true;
  const showProps = true;

  return (
    <div className={cn('space-y-5', isNextUi && 'step3-next-manager')}>
      {isNextUi && (
        <div className="step3-next-command rounded-2xl border border-border/60 bg-card/80 p-4 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="step3-next-command-badge h-6 rounded-md border-0 brand-gradient px-2.5 text-[10px] font-semibold text-white">
                  素材阶段
                </Badge>
                <Badge variant="outline" className="step3-next-command-status h-6 rounded-md border-border/60 bg-background/55 px-2.5 text-[10px] text-muted-foreground">
                  {nextMissingCoreCount > 0 ? `待补 ${nextMissingCoreCount}` : '基础已齐'}
                </Badge>
              </div>
              <div>
                <h3 className="text-lg font-semibold leading-tight text-foreground">资产生产控制台</h3>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                  先看缺口，再批量补图和压缩；分组入口只负责快速定位，不重复占用首屏。
                </p>
              </div>
            </div>

            <div className="step3-next-stat-grid grid gap-2 sm:grid-cols-4 xl:min-w-[520px]">
              <div className="step3-next-stat rounded-xl border border-border/50 bg-background/55 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">基础</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{coreReadySlots}/{coreTotalSlots}</p>
              </div>
              <div className={cn('step3-next-stat rounded-xl border border-border/50 bg-background/55 px-3 py-2', nextMissingCoreCount > 0 && 'step3-next-stat-alert')}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">缺口</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{nextMissingCoreCount}</p>
              </div>
              <div className="step3-next-stat rounded-xl border border-border/50 bg-background/55 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">素材</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{assetLibrary.length}</p>
              </div>
              <div className="step3-next-stat rounded-xl border border-border/50 bg-background/55 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">压缩</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{lightweightAssetReadyCount}/{lightweightAssetTotalCount}</p>
              </div>
            </div>
          </div>

          <div className="step3-next-readiness mt-4 rounded-xl border border-border/50 bg-background/45 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-semibold text-foreground">资产准备度</span>
                    <span className="font-semibold text-foreground">
                      {coreTotalSlots > 0 ? Math.round((coreReadySlots / coreTotalSlots) * 100) : 0}%
                    </span>
                  </div>
                  <Progress value={coreTotalSlots > 0 ? (coreReadySlots / coreTotalSlots) * 100 : 0} className="mt-2 h-2" />
                  <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                    {visibleBatchRunning
                      ? batchProgressReadinessLabel
                      : generatingLightweightAssets
                        ? `正在压缩 ${lightweightProgress.done}/${lightweightProgress.total}`
                        : nextMissingCoreCount > 0
                          ? `还缺 ${nextMissingCoreCount} 个基础槽位，建议先一键补齐`
                          : nextMissingLightweightCount > 0
                            ? `基础图已齐，还可压缩 ${nextMissingLightweightCount} 张参考图`
                            : '基础图与轻量参考图已就绪'}
                  </p>
                </div>
                <div className="step3-next-actions flex flex-wrap items-center gap-2 xl:justify-end">
                  {enhancementTotalSlots > 0 && (
                    <label className="flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-background/65 px-3 text-xs text-foreground">
                      <Switch
                        checked={includeOutfitVariantsInBatch}
                        onCheckedChange={setIncludeOutfitVariantsInBatch}
                        disabled={visibleBatchRunning || generatingLightweightAssets}
                      />
                      <span className="font-medium">包含变装</span>
                    </label>
                  )}
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handlePrimaryAssetProduction}
                    disabled={visibleBatchRunning || generatingLightweightAssets || !hasPrimaryAssetAction}
                    className="step3-next-primary-action h-11 min-w-[220px] gap-2 rounded-xl border-0 px-7 text-sm font-semibold text-white brand-gradient shadow-brand-sm"
                  >
                    {(visibleBatchRunning || generatingLightweightAssets)
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Wand2 className="h-4 w-4" />}
                    <span>{primaryAssetActionLabel}</span>
                  </Button>
                  {visibleBatchRunning && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={requestBatchStop}
                      disabled={visibleBatchStopRequested || !!backgroundStep3Task || detachedBackendImageRunning}
                      className="h-9 gap-1.5 rounded-lg border-amber-300 px-3 text-xs font-medium text-amber-700 hover:bg-amber-50"
                    >
                      <RotateCcw className={`h-3.5 w-3.5 ${visibleBatchStopRequested ? 'animate-spin' : ''}`} />
                      {visibleBatchStopRequested ? '停止中' : (backgroundStep3Task || detachedBackendImageRunning) ? '任务运行中' : '停止'}
                    </Button>
                  )}
                  {!visibleBatchRunning && !generatingLightweightAssets && batchFailures.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleRetryFailedBatch}
                      className="h-9 gap-1.5 rounded-lg border-red-300 px-3 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      重试（{batchFailures.length}）
                    </Button>
                  )}
                </div>
              </div>
          </div>

          {visibleBatchRunning && batchCurrentReadinessLabel && (
            <div className="mt-3 text-xs text-muted-foreground">
              当前处理：{batchCurrentReadinessLabel}
            </div>
          )}
          {(backendImageSync.total > 0 || backendImageSync.lastError) && (
            <div className="mt-3 rounded-xl border border-cyan-300/40 bg-cyan-50/70 px-3 py-2 text-xs text-cyan-900 dark:border-cyan-400/25 dark:bg-cyan-950/25 dark:text-cyan-100">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">后台图片同步</span>
                <span>排队 {backendImageSync.queued}</span>
                <span>运行 {backendImageSync.running}</span>
                <span>待回收 {backendImageSync.recoverable}</span>
                <span>已回收 {backendImageSync.recovered}</span>
                <span>失败槽 {backendImageSync.failed}</span>
              </div>
              {backendImageSync.lastMessage && (
                <div className="mt-1 text-cyan-800/80 dark:text-cyan-100/80">{backendImageSync.lastMessage}</div>
              )}
              {backendImageActiveHint && (
                <div className="mt-1 text-cyan-800/80 dark:text-cyan-100/80">{backendImageActiveHint}</div>
              )}
              {backendImageSync.lastError && (
                <div className="mt-1 text-red-600 dark:text-red-300">最近错误：{backendImageSync.lastError}</div>
              )}
            </div>
          )}
          {visibleBatchRunning && visibleBatchStopRequested && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/25">
              已收到停止请求，会在当前项完成后结束本轮批量任务。
            </div>
          )}
          {!visibleBatchRunning && visibleBatchStopped && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/25">
              本轮批量任务已按请求停止。
            </div>
          )}
          {!visibleBatchRunning && batchFailures.length > 0 && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/20">
              {getFailureSummaryLabel(batchFailures)}有 {batchFailures.length} 项失败，支持整批或逐条重试。
            </div>
          )}

          <div className="step3-next-settings-summary mt-3 grid gap-2 rounded-xl border border-border/50 bg-background/45 p-2 xl:grid-cols-4">
            <div className="step3-next-setting-card step3-next-setting-card--optimize flex min-h-[96px] flex-col justify-between rounded-2xl border border-brand-orange/20 bg-gradient-to-br from-brand-orange/10 via-background/75 to-background/65 p-3 shadow-sm dark:border-brand-orange/25 dark:from-brand-orange/10 dark:via-background/70 dark:to-background/55">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <Settings className="h-3.5 w-3.5 text-brand-orange" />
                      <Label className="text-[11px] font-semibold text-foreground">AI 润色并发</Label>
                    </div>
                  </div>
                  <Badge variant="outline" className="rounded-full border-brand-orange/25 bg-background/70 text-[10px] text-brand-orange">
                    默认 3 路
                  </Badge>
                </div>
                <Select
                  value={getConcurrencySelectValue(optimizeConcurrency)}
                  onValueChange={(value) => {
                    updateOptimizeConcurrency(value === 'custom' ? STEP3_CUSTOM_CONCURRENCY_DEFAULT : Number(value));
                  }}
                >
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STEP3_CONCURRENCY_PRESETS.map((value) => (
                      <SelectItem key={value} value={String(value)}>{value} 路</SelectItem>
                    ))}
                    <SelectItem value="custom">自定义</SelectItem>
                  </SelectContent>
                </Select>
                {getConcurrencySelectValue(optimizeConcurrency) === 'custom' && (
                  <Input
                    type="number"
                    min={1}
                    max={STEP3_MAX_CONCURRENCY}
                    value={optimizeConcurrency}
                    onChange={(event) => updateOptimizeConcurrency(Number(event.target.value))}
                    className="h-8 text-xs"
                  />
                )}
              </div>
            </div>
            <div className="step3-next-setting-card step3-next-setting-card--generate flex min-h-[96px] flex-col justify-between rounded-2xl border border-cyan-200/70 bg-gradient-to-br from-cyan-50/80 via-background/80 to-background/65 p-3 shadow-sm dark:border-cyan-400/25 dark:from-cyan-500/10 dark:via-background/70 dark:to-background/55">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <ImageIcon className="h-3.5 w-3.5 text-cyan-700 dark:text-cyan-200" />
                      <Label className="text-[11px] font-semibold text-foreground">图片生成并发</Label>
                    </div>
                  </div>
                  <Badge variant="outline" className="rounded-full border-cyan-300/50 bg-background/70 text-[10px] text-cyan-700 dark:border-cyan-300/30 dark:text-cyan-100">
                    默认 3 路
                  </Badge>
                </div>
                <Select
                  value={getConcurrencySelectValue(generateConcurrency)}
                  onValueChange={(value) => {
                    updateGenerateConcurrency(value === 'custom' ? STEP3_CUSTOM_CONCURRENCY_DEFAULT : Number(value));
                  }}
                >
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STEP3_CONCURRENCY_PRESETS.map((value) => (
                      <SelectItem key={value} value={String(value)}>{value} 路</SelectItem>
                    ))}
                    <SelectItem value="custom">自定义</SelectItem>
                  </SelectContent>
                </Select>
                {getConcurrencySelectValue(generateConcurrency) === 'custom' && (
                  <Input
                    type="number"
                    min={1}
                    max={STEP3_MAX_CONCURRENCY}
                    value={generateConcurrency}
                    onChange={(event) => updateGenerateConcurrency(Number(event.target.value))}
                    className="h-8 text-xs"
                  />
                )}
              </div>
            </div>
            <div className="step3-next-setting-card step3-next-setting-card--virtual flex min-h-[96px] flex-col justify-between rounded-2xl border border-blue-200/70 bg-gradient-to-br from-blue-50/80 via-background/80 to-background/65 p-3 shadow-sm dark:border-blue-500/30 dark:from-blue-500/10 dark:via-background/70 dark:to-background/55">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <Layers className="h-3.5 w-3.5 text-blue-700 dark:text-blue-200" />
                      <Label className="text-xs font-semibold text-foreground">官方虚拟人脸库</Label>
                    </div>
                  </div>
                  {useVolcVirtualHumans && (
                    <Badge className="rounded-full border-0 bg-blue-600 px-2 text-[10px] text-white">
                      已开启
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {useVolcVirtualHumans && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleAutoMatchVirtualHumans()}
                      disabled={visibleBatchRunning || autoMatchingVirtualHumans || officialVirtualHumanPendingCount === 0}
                      className="h-8 gap-1.5 rounded-lg border-blue-300 bg-background/80 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-500/30 dark:text-blue-100 dark:hover:bg-blue-500/10"
                    >
                      {autoMatchingVirtualHumans ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                      自动匹配{officialVirtualHumanPendingCount > 0 ? `（${officialVirtualHumanPendingCount}）` : ''}
                    </Button>
                  )}
                  <label className="flex items-center gap-3 rounded-lg border border-blue-200 bg-background/80 px-3 py-2 text-sm font-medium text-foreground dark:border-blue-500/30">
                    <Switch
                      checked={useVolcVirtualHumans}
                      onCheckedChange={(checked) => {
                        dispatch({
                          type: 'SET_PROJECT_STEP3_SETTINGS',
                          settings: { useVolcVirtualHumans: checked },
                        });
                      }}
                      disabled={visibleBatchRunning || autoMatchingVirtualHumans}
                    />
                    <span>{useVolcVirtualHumans ? '官方库模式' : '原流程模式'}</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="step3-next-setting-card step3-next-setting-card--voice flex min-h-[96px] flex-col justify-between rounded-2xl border border-violet-200/70 bg-gradient-to-br from-violet-50/80 via-background/80 to-background/65 p-3 shadow-sm dark:border-violet-400/25 dark:from-violet-500/10 dark:via-background/70 dark:to-background/55">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <Volume2 className="h-4 w-4 text-violet-700 dark:text-violet-200" />
                      <Label className="text-xs font-semibold text-foreground">角色配音参考</Label>
                    </div>
                  </div>
                  <Badge variant="outline" className="rounded-full border-violet-300/50 bg-background/70 text-[10px] text-violet-700 dark:border-violet-300/30 dark:text-violet-100">
                    {voiceReferenceReadyCount}/{characters.length}
                  </Badge>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 w-fit rounded-lg border-violet-300 bg-background/80 px-3 text-xs font-semibold text-violet-700 hover:bg-violet-50 dark:border-violet-400/30 dark:text-violet-100 dark:hover:bg-violet-500/10"
                  onClick={() => document.getElementById('step3-voice-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                >
                  管理声线
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isNextUi && (
      <>
        {/* 顶部总览卡片 */}
        <Card className="surface-panel overflow-hidden rounded-[28px] border-border/60 bg-transparent shadow-none">
        <CardHeader className="space-y-4 pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <CardTitle className="flex items-center gap-3 text-xl">
                <span className="flex h-9 w-9 items-center justify-center rounded-2xl brand-gradient text-sm font-bold text-white shadow-brand-sm">3</span>
                图片资产管理
              </CardTitle>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                先把角色、场景和物品的关键参考图做稳，这一步越清楚，后面的提示词和视频生成越省心。
              </p>
            </div>
            <div className="grid min-w-full gap-2 sm:grid-cols-3 lg:min-w-[340px] lg:max-w-[420px]">
              <div className="rounded-2xl border border-border/50 bg-background/65 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">角色</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{filteredCharacters.length} 组</p>
              </div>
              <div className="rounded-2xl border border-border/50 bg-background/65 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">场景</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{filteredScenes.length} 项</p>
              </div>
              <div className="rounded-2xl border border-border/50 bg-background/65 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">道具</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{filteredProps.length} 项</p>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-3xl border border-brand-orange/20 bg-gradient-to-r from-brand-orange/10 via-background/70 to-background/70 p-4 shadow-brand-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="h-6 rounded-full border-0 brand-gradient px-2.5 text-[10px] font-semibold text-white">
                      先设置风格
                    </Badge>
                    <Badge variant="outline" className="rounded-full border-brand-orange/20 bg-background/70 text-[10px] text-muted-foreground">
                      影响整章生图基调
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Wand2 className="h-4 w-4 text-brand-orange" />
                    <Label className="text-sm font-semibold text-foreground">视觉风格</Label>
                    <span className="rounded-full bg-background/80 px-2.5 py-1 text-[11px] font-medium text-brand-orange">
                      当前：{styleSummaryLabel}
                    </span>
                  </div>
                  <p className="max-w-2xl text-xs leading-6 text-muted-foreground">
                    角色、场景和物品都会参考这里的风格描述。先把风格定清楚，再去一键生成图片，出图会更稳定。
                  </p>
                </div>
                <div className="min-w-0 flex-1 space-y-3 lg:max-w-[540px]">
                  <Select
                    value={selectedStyleValue}
                    onValueChange={(value) => {
                      if (!analysis) return;
                      if (value === '__custom__') {
                        dispatch({ type: 'SET_ANALYSIS', analysis: { ...analysis, styleConfig: '' } });
                      } else {
                        dispatch({ type: 'SET_ANALYSIS', analysis: { ...analysis, styleConfig: value } });
                      }
                    }}
                  >
                    <SelectTrigger className="h-10 min-w-[220px] border-brand-orange/20 bg-background/80 text-xs">
                      <SelectValue placeholder="选择风格预设" />
                    </SelectTrigger>
                    <SelectContent>
                      {STYLE_PRESETS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                      <SelectItem value="__custom__">?? 自定义</SelectItem>
                    </SelectContent>
                  </Select>
                  {(analysis?.styleConfig === '' || isCustomStyle(analysis?.styleConfig ?? '')) && (
                    <Input
                      value={analysis?.styleConfig ?? ''}
                      onChange={(e) => {
                        if (!analysis) return;
                        dispatch({ type: 'SET_ANALYSIS', analysis: { ...analysis, styleConfig: e.target.value } });
                      }}
                      placeholder="补充自定义风格描述，例如：3D 国漫、写实校园、光影冷暖对比..."
                      className="h-10 border-brand-orange/20 bg-background/80 text-xs"
                    />
                  )}
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-blue-200/70 bg-blue-50/70 p-4 dark:border-blue-500/30 dark:bg-blue-500/10">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label className="text-sm font-semibold text-foreground">官方虚拟人脸库</Label>
                    <Badge variant="outline" className="rounded-full border-blue-300 bg-background/70 px-2 text-[10px] text-blue-700 dark:border-blue-400/30 dark:text-blue-100">
                      Step3 自定义功能
                    </Badge>
                    {useVolcVirtualHumans && (
                      <Badge className="rounded-full border-0 bg-blue-600 px-2 text-[10px] text-white">
                        已开启
                      </Badge>
                    )}
                  </div>
                  <p className="max-w-3xl text-xs leading-5 text-muted-foreground">
                    开启后，角色第一张图改为从官方库匹配多个相似人像供选择；服装和角色设定图会按无脸模特/服装图生成。该模式只适用于火山方舟视频模型，后续 Step5 会用官方 asset:// 身份图提交。
                  </p>
                  {useVolcVirtualHumans && !officialVirtualHumanVideoBackendReady && (
                    <div className="mt-2 rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
                      <div className="font-semibold">当前视频后端不支持官方虚拟人脸</div>
                      <div className="mt-0.5">{getOfficialVirtualHumanIncompatibleMessage(state.videoApiConfig.backend)}</div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2 h-8 rounded-xl border-amber-300 bg-white/80 px-2.5 text-[11px] font-semibold text-amber-800 hover:bg-white dark:border-amber-400/40 dark:bg-white/10 dark:text-amber-50"
                        onClick={() => {
                          dispatch({
                            type: 'SET_VIDEO_API_CONFIG',
                            config: { ...state.videoApiConfig, backend: 'volcengine' },
                          });
                        }}
                      >
                        切换到火山方舟
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
                  {useVolcVirtualHumans && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleAutoMatchVirtualHumans()}
                      disabled={visibleBatchRunning || autoMatchingVirtualHumans || officialVirtualHumanPendingCount === 0}
                      className="h-9 gap-1.5 rounded-xl border-blue-300 bg-background/80 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-500/30 dark:text-blue-100 dark:hover:bg-blue-500/10"
                    >
                      {autoMatchingVirtualHumans ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                      自动匹配官方人像{officialVirtualHumanPendingCount > 0 ? `（${officialVirtualHumanPendingCount}）` : ''}
                    </Button>
                  )}
                  <label className="flex items-center gap-3 rounded-xl border border-blue-200 bg-background/80 px-3 py-2 text-sm font-medium text-foreground dark:border-blue-500/30">
                    <Switch
                      checked={useVolcVirtualHumans}
                      onCheckedChange={(checked) => {
                        dispatch({
                          type: 'SET_PROJECT_STEP3_SETTINGS',
                          settings: { useVolcVirtualHumans: checked },
                        });
                      }}
                      disabled={visibleBatchRunning || autoMatchingVirtualHumans}
                    />
                    <span>{useVolcVirtualHumans ? '官方库模式' : '原流程模式'}</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <div className="rounded-2xl border border-border/50 bg-background/60 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">并发设置</Label>
                <Badge variant="outline" className="rounded-full border-border/60 bg-background/70 text-[10px] text-muted-foreground">
                  已按项目保存
                </Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">AI 润色</Label>
                  <Select
                    value={getConcurrencySelectValue(optimizeConcurrency)}
                    onValueChange={(value) => {
                      updateOptimizeConcurrency(value === 'custom' ? STEP3_CUSTOM_CONCURRENCY_DEFAULT : Number(value));
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STEP3_CONCURRENCY_PRESETS.map((value) => (
                        <SelectItem key={value} value={String(value)}>{value} 路</SelectItem>
                      ))}
                      <SelectItem value="custom">自定义</SelectItem>
                    </SelectContent>
                  </Select>
                  {getConcurrencySelectValue(optimizeConcurrency) === 'custom' && (
                    <Input
                      type="number"
                      min={1}
                      max={STEP3_MAX_CONCURRENCY}
                      value={optimizeConcurrency}
                      onChange={(event) => updateOptimizeConcurrency(Number(event.target.value))}
                      className="h-9 text-xs"
                    />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">图片生成</Label>
                  <Select
                    value={getConcurrencySelectValue(generateConcurrency)}
                    onValueChange={(value) => {
                      updateGenerateConcurrency(value === 'custom' ? STEP3_CUSTOM_CONCURRENCY_DEFAULT : Number(value));
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STEP3_CONCURRENCY_PRESETS.map((value) => (
                        <SelectItem key={value} value={String(value)}>{value} 路</SelectItem>
                      ))}
                      <SelectItem value="custom">自定义</SelectItem>
                    </SelectContent>
                  </Select>
                  {getConcurrencySelectValue(generateConcurrency) === 'custom' && (
                    <Input
                      type="number"
                      min={1}
                      max={STEP3_MAX_CONCURRENCY}
                      value={generateConcurrency}
                      onChange={(event) => updateGenerateConcurrency(Number(event.target.value))}
                      className="h-9 text-xs"
                    />
                  )}
                </div>
              </div>
              <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                快速档位为 1 / 3 / 5 路；自定义最高 {STEP3_MAX_CONCURRENCY} 路。默认使用 3 路，接口不稳时可切到 1 路稳跑。
              </p>
            </div>
            <div className="rounded-2xl border border-border/50 bg-background/60 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">使用建议</Label>
                <Badge variant="outline" className="rounded-full border-border/60 bg-background/70 text-[10px] text-muted-foreground">
                  提高一致性
                </Badge>
              </div>
              <div className="space-y-2 text-xs leading-6 text-muted-foreground">
                <p>1. 先选风格，再一键生成图片；队列会按身份基础图、场景母版、角色设定图、核心物品、变装素材依次推进。</p>
                <p>2. {useVolcVirtualHumans ? '官方库模式下先为角色选官方标准定妆照，再补无脸服装和装扮素材。' : '角色标准定妆照和设定图建议使用同一风格，后面图生图会更稳。'}</p>
                <p>3. 只有在你想增强电影感或镜头语言时，再额外点 AI 润色。</p>
              </div>
            </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="rounded-2xl border border-border/50 bg-background/60 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">基础素材进度</p>
                <p className="text-xs text-muted-foreground">角色标准定妆照 / 设定图 + 场景 + 物品</p>
              </div>
              <span className="text-sm font-semibold text-foreground">
                {coreReadySlots} / {coreTotalSlots}
              </span>
            </div>
            <Progress value={coreTotalSlots > 0 ? (coreReadySlots / coreTotalSlots) * 100 : 0} className="h-2 flex-1" />
          </div>
          {enhancementTotalSlots > 0 && (
            <div className="rounded-2xl border border-border/50 bg-background/55 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">扩展素材进度</p>
                  <p className="text-xs text-muted-foreground">Step2 标记需要新图的变装素材默认纳入一键生成，保证后续分镜引用完整。</p>
                </div>
                <span className="text-sm font-semibold text-muted-foreground">
                  {enhancementReadySlots} / {enhancementTotalSlots}
                </span>
              </div>
              <Progress value={enhancementTotalSlots > 0 ? (enhancementReadySlots / enhancementTotalSlots) * 100 : 0} className="h-1.5 flex-1" />
            </div>
          )}
          <div className="rounded-2xl border border-brand-orange/20 bg-background/70 px-4 py-3 shadow-brand-sm">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="h-6 rounded-full border-0 brand-gradient px-2.5 text-[10px] font-semibold text-white shadow-brand-sm">
                    {visibleBatchRunning || generatingLightweightAssets ? '运行中' : '主操作'}
                  </Badge>
                  {allCoreReady && (
                    <Badge variant="outline" className="rounded-full border-emerald-300 bg-emerald-50 px-2.5 text-[10px] text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-100">
                      基础图片已就绪
                    </Badge>
                  )}
                  <span className="text-sm font-semibold text-foreground">资产生产</span>
                  <span className="text-xs text-muted-foreground">
                    {visibleBatchRunning
                      ? batchProgressReadinessLabel
                      : generatingLightweightAssets
                        ? `正在压缩生成结果 ${lightweightProgress.done}/${lightweightProgress.total}`
                      : allImageOneClickCount > 0
                        ? '按身份、场景、设定图、道具的顺序补齐，完成后自动压缩'
                        : '本章图片已补齐'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1">
                    无损压缩图片：{lightweightAssetReadyCount}/{lightweightAssetTotalCount}
                  </span>
                  {lightweightSummary && (
                    <span className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1">
                      已生成 {lightweightSummary.generated} 张，节省 {formatBytes(lightweightSummary.savedBytes)}
                      {lightweightSummary.skippedExisting > 0 ? `；已有 ${lightweightSummary.skippedExisting}` : ''}
                      {lightweightSummary.skippedNoGain > 0 ? `；跳过 ${lightweightSummary.skippedNoGain}` : ''}
                      {lightweightSummary.failed > 0 ? `；失败 ${lightweightSummary.failed}` : ''}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                {enhancementTotalSlots > 0 && (
                  <label className="flex h-9 items-center gap-2 rounded-xl border border-border/60 bg-background/75 px-3 text-xs text-foreground">
                    <Switch
                      checked={includeOutfitVariantsInBatch}
                      onCheckedChange={setIncludeOutfitVariantsInBatch}
                      disabled={visibleBatchRunning || generatingLightweightAssets}
                    />
                    <span className="font-medium">包含变装</span>
                  </label>
                )}
                <Button
                  size="sm"
                  variant="default"
                  onClick={handlePrimaryAssetProduction}
                  disabled={visibleBatchRunning || generatingLightweightAssets || allImageOneClickCount === 0}
                  className="h-9 gap-2 rounded-xl border-0 px-4 text-sm font-semibold text-white brand-gradient shadow-brand-sm transition-all duration-200 hover:shadow-brand-md"
                >
                  {(visibleBatchRunning || generatingLightweightAssets)
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Wand2 className="h-4 w-4" />}
                  {visibleBatchRunning
                    ? formatBatchProgressButtonLabel(visibleBatchProgress)
                    : generatingLightweightAssets
                      ? `压缩中 ${lightweightProgress.done}/${lightweightProgress.total}`
                    : allImageOneClickCount > 0
                      ? `生成并压缩${allImageOneClickCount > 0 ? `（${allImageOneClickCount}）` : ''}`
                      : '已全部生成'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!currentProject?.id || !chapter?.id || lightweightAssetPendingCount <= 0) return;
                    dispatch({
                      type: 'QUEUE_STEP3_BATCH_TASK',
                      projectId: currentProject.id,
                      chapterId: chapter.id,
                      total: lightweightAssetPendingCount,
                      mode: 'lightweight-assets',
                    });
                  }}
                  disabled={generatingLightweightAssets || visibleBatchRunning || lightweightAssetPendingCount === 0}
                  className="h-9 gap-1.5 rounded-xl border-brand-orange/45 px-3 text-xs font-semibold text-brand-orange hover:bg-brand-orange/10"
                >
                  {generatingLightweightAssets ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileArchive className="h-3.5 w-3.5" />}
                  {generatingLightweightAssets
                    ? `压缩中 ${lightweightProgress.done}/${lightweightProgress.total}`
                    : lightweightAssetPendingCount > 0
                      ? `无损压缩图片（${lightweightAssetPendingCount}）`
                      : '无损压缩图片已就绪'}
                </Button>
                {visibleBatchRunning && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={requestBatchStop}
                    disabled={visibleBatchStopRequested || !!backgroundStep3Task || detachedBackendImageRunning}
                    className="h-9 gap-1.5 rounded-xl border-amber-300 px-3 text-xs font-medium text-amber-700 hover:bg-amber-50"
                  >
                    <RotateCcw className={`h-3.5 w-3.5 ${visibleBatchStopRequested ? 'animate-spin' : ''}`} />
                    {visibleBatchStopRequested ? '停止中…' : (backgroundStep3Task || detachedBackendImageRunning) ? '任务运行中' : '停止批量'}
                  </Button>
                )}
                {!visibleBatchRunning && !generatingLightweightAssets && batchFailures.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRetryFailedBatch}
                    className="h-9 gap-1.5 rounded-xl border-red-300 px-3 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    重试失败项（{batchFailures.length}）
                  </Button>
                )}
              </div>
            </div>
          </div>
          {visibleBatchRunning && batchCurrentReadinessLabel && (
            <div className="mt-3 text-xs text-muted-foreground">
              当前处理：{batchCurrentReadinessLabel}
            </div>
          )}
          {(backendImageSync.total > 0 || backendImageSync.lastError) && (
            <div className="mt-3 rounded-xl border border-cyan-300/40 bg-cyan-50/70 px-3 py-2 text-xs text-cyan-900 dark:border-cyan-400/25 dark:bg-cyan-950/25 dark:text-cyan-100">
              后台图片同步：排队 {backendImageSync.queued} · 运行 {backendImageSync.running} · 待回收 {backendImageSync.recoverable} · 已回收 {backendImageSync.recovered} · 失败槽 {backendImageSync.failed}
              {backendImageActiveHint && <span className="ml-2 text-cyan-800/80 dark:text-cyan-100/80">{backendImageActiveHint}</span>}
              {backendImageSync.lastError && <span className="ml-2 text-red-600 dark:text-red-300">最近错误：{backendImageSync.lastError}</span>}
            </div>
          )}
          {visibleBatchRunning && visibleBatchStopRequested && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/25">
              已收到停止请求，会在当前项完成后结束本轮批量任务。
            </div>
          )}
          {!visibleBatchRunning && visibleBatchStopped && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/25">
              本轮批量任务已按请求停止。
            </div>
          )}
          {!visibleBatchRunning && batchFailures.length > 0 && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 dark:bg-red-950/20">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-red-700">
                  {getFailureSummaryLabel(batchFailures)}有 {batchFailures.length} 项失败
                </div>
                <div className="text-xs text-red-600">
                  支持整批或逐条重试
                </div>
              </div>
              <div className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1">
                {batchFailures.map((failure) => (
                  <div
                    key={`${failure.phase}:${failure.key}`}
                    className="flex items-start justify-between gap-3 rounded-md border border-red-200 bg-white/60 px-3 py-2 dark:border-red-500/30 dark:bg-red-500/10"
                  >
                    <div className="min-w-0 flex-1 text-xs text-red-700 dark:text-red-100">
                      <div className="font-medium">
                        {failure.name} · {getConceptLabel(failure.concept)}
                      </div>
                      <div className="mt-0.5 text-red-600 dark:text-red-200/90">
                        {failure.phase === 'optimize' ? '提示词优化' : '图片生成'}：{failure.error}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleRetrySingleFailure(failure)}
                      disabled={visibleBatchRunning || generatingLightweightAssets}
                      className="h-6 shrink-0 gap-1 border-red-300 text-[10px] text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:bg-transparent dark:text-red-200 dark:hover:bg-red-500/10"
                    >
                      <RotateCcw className="h-3 w-3" />
                      重试
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
        </Card>
      </>
      )}

      <div id="step3-voice-panel" className={cn(isNextUi && 'step3-next-voice-panel')}>
        <CharacterVoiceReferencePanel
          characters={filteredCharacters.map((item) => item.name)}
          characterProfiles={analysis?.characterProfiles ?? currentProject?.characterProfiles}
          projectSummary={analysis?.summary}
          projectStyle={analysis?.styleConfig}
        />
      </div>

      {/* 角色卡片列表 */}
      {showCharacters && filteredCharacters.length > 0 && (
        <div className={cn('space-y-3', isNextUi && 'step3-asset-section')}>
          <div className={cn('flex items-center justify-between gap-3', isNextUi && 'step3-section-head step3-section-head--characters')}>
            <div className="space-y-1">
              <h3 className="step3-section-title text-base font-semibold text-foreground">角色素材 <span>{filteredCharacters.length} 位</span></h3>
              <p className="step3-section-copy text-xs text-muted-foreground">定妆照和设定图先稳定，变装素材按需补齐。</p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleResetAllCharacters}
                disabled={visibleBatchRunning || generatingLightweightAssets || characterResettableCount === 0}
                title="清空当前章节所有角色图片槽位，资产库原图不会被删除"
                className={cn('h-9 rounded-xl px-3 text-xs font-semibold gap-1.5 border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-400/40 dark:bg-rose-500/10 dark:text-rose-200 dark:hover:bg-rose-500/15', isNextUi && 'step3-section-action')}
              >
                <RotateCcw className="h-3 w-3" />
                一键重置角色{characterResettableCount > 0 ? `（${characterResettableCount}）` : ''}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCharacterOneClick}
                disabled={visibleBatchRunning || generatingLightweightAssets || characterOneClickCount === 0}
                className={cn('h-9 rounded-xl px-3 text-xs font-semibold gap-1.5 border-brand-orange/30 bg-brand-orange/10 text-brand-orange hover:bg-brand-orange/15', isNextUi && 'step3-section-action')}
              >
                <Wand2 className="h-3 w-3" />
                一键生成角色{characterOneClickCount > 0 ? `（${characterOneClickCount}）` : ''}
              </Button>
            </div>
          </div>
          <div className={cn(isNextUi ? 'step3-asset-grid step3-character-grid' : 'space-y-3')}>
            {filteredCharacters.map((ir) => {
              const stat = characterReadyMap[ir.name] ?? {
                ready: 0,
                total: 4,
                coreReady: 0,
                coreTotal: 2,
                enhancementReady: 0,
                enhancementTotal: 2,
              };
              const allDone = stat.coreReady === stat.coreTotal;

              return (
                <CharacterCard
                  key={`${ir.type}:${ir.name}`}
                  ir={ir}
                  items={items}
                  stat={stat}
                  allDone={allDone}
                  editingKey={editingKey}
                  onThumbClick={handleThumbClick}
                  onPreview={setPreviewImage}
                  assetLibrary={assetLibrary}
                  projectId={currentProject?.id}
                  getConceptLabel={getConceptLabel}
                  getConceptDesc={getConceptDesc}
                  officialMode={useVolcVirtualHumans}
                  editing={editing}
                  showAssetPicker={showAssetPicker}
                  onUpdateItem={updateItem}
                  onGenerate={handleGenerate}
                  onOptimize={handleOptimizePrompt}
                  onFileUpload={handleFileUpload}
                  onReplaceImage={replaceAssetImage}
                  onSelectFromLibrary={handleSelectFromLibrary}
                  onDownload={handleDownload}
                  onDrop={handleDrop}
                  onImageSizeChange={(key, size) => updateItem(key, { imageSize: size })}
                  onReset={handleReset}
                  onSetDefault={handleSetDefault}
                  buildDescription={buildDescription}
                  buildContext={buildContext}
                  buildSourcePreview={buildSourcePreview}
                  onOpenVirtualHumanPicker={setVirtualHumanPickerKey}
                  setShowAssetPicker={setShowAssetPicker}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* 场景卡片列表 */}
      {showScenes && filteredScenes.length > 0 && (
        <div className={cn('space-y-3', isNextUi && 'step3-asset-section')}>
          <div className={cn('flex items-center justify-between gap-3', isNextUi && 'step3-section-head step3-section-head--scenes')}>
            <div className="space-y-1">
              <h3 className="step3-section-title text-base font-semibold text-foreground">场景素材 <span>{filteredScenes.length} 组</span></h3>
              <p className="step3-section-copy text-xs text-muted-foreground">锁定主环境、空间锚点和横竖屏导演板。</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSceneOneClick}
              disabled={visibleBatchRunning || generatingLightweightAssets || sceneOneClickCount === 0}
              className={cn('h-9 rounded-xl px-3 text-xs font-semibold gap-1.5 border-emerald-400/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300', isNextUi && 'step3-section-action')}
            >
              <Wand2 className="h-3 w-3" />
              一键生成场景{sceneOneClickCount > 0 ? `（${sceneOneClickCount}）` : ''}
            </Button>
          </div>
          <div className={cn(isNextUi ? 'step3-asset-grid step3-scene-grid' : 'space-y-3')}>
            {filteredScenes.map((ir) => {
              const sceneItems = getSceneItemsForName(items, ir.name);
              if (sceneItems.length === 0) return null;
              const editingSceneItem = editingKey
                ? sceneItems.find((candidate) => candidate.key === editingKey) ?? null
                : null;
              const allDone = sceneItems.every((candidate) => !!candidate.asset);

              return (
                <SceneCard
                  key={`${ir.type}:${ir.name}`}
                  ir={ir}
                  items={sceneItems}
                  allDone={allDone}
                  editingKey={editingKey}
                  onThumbClick={handleThumbClick}
                  onPreview={setPreviewImage}
                  assetLibrary={assetLibrary}
                  projectId={currentProject?.id}
                  getConceptLabel={getConceptLabel}
                  getConceptDesc={getConceptDesc}
                  editing={editingSceneItem}
                  showAssetPicker={showAssetPicker}
                  onUpdateItem={updateItem}
                  onGenerate={handleGenerate}
                  onOptimize={handleOptimizePrompt}
                  onFileUpload={handleFileUpload}
                  onReplaceImage={replaceAssetImage}
                  onSelectFromLibrary={handleSelectFromLibrary}
                  onDownload={handleDownload}
                  onDrop={handleDrop}
                  onImageSizeChange={(key, size) => updateItem(key, { imageSize: size })}
                  onReset={handleReset}
                  buildDescription={buildDescription}
                  buildContext={buildContext}
                  buildSourcePreview={buildSourcePreview}
                  setShowAssetPicker={setShowAssetPicker}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* 物品/道具卡片列表 */}
      {showProps && filteredProps.length > 0 && (
        <div className={cn('space-y-3', isNextUi && 'step3-asset-section')}>
          <div className={cn('flex items-center justify-between gap-3', isNextUi && 'step3-section-head step3-section-head--props')}>
            <div className="space-y-1">
              <h3 className="step3-section-title text-base font-semibold text-foreground">道具素材 <span>{filteredProps.length} 件</span></h3>
              <p className="step3-section-copy text-xs text-muted-foreground">锁定外观、状态变化和可复用工业板。</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handlePropOneClick}
              disabled={visibleBatchRunning || generatingLightweightAssets || propOneClickCount === 0}
              className={cn('h-9 rounded-xl px-3 text-xs font-semibold gap-1.5 border-violet-400/30 bg-violet-500/10 text-violet-700 hover:bg-violet-500/15 dark:text-violet-300', isNextUi && 'step3-section-action')}
            >
              <Wand2 className="h-3 w-3" />
              一键生成物品{propOneClickCount > 0 ? `（${propOneClickCount}）` : ''}
            </Button>
          </div>
          <div className={cn(isNextUi ? 'step3-asset-grid step3-prop-grid' : 'space-y-3')}>
            {filteredProps.map((ir) => {
              const itemKey = makeItemKey('prop', ir.name, PROP_CONCEPT.concept, ir.trackingId);
              const item = items[itemKey];
              if (!item) return null;
              const propInfo = analysis?.propTracking?.find((prop) => getPropIdentityKey(prop) === ir.trackingId)
                ?? analysis?.propTracking?.find((prop) => prop.propName === ir.name);

              return (
                <PropCard
                  key={`${ir.type}:${ir.name}`}
                  ir={ir}
                  item={item}
                  propInfo={propInfo}
                  isEditing={editingKey === itemKey}
                  onThumbClick={handleThumbClick}
                  onPreview={setPreviewImage}
                  assetLibrary={assetLibrary}
                  projectId={currentProject?.id}
                  getConceptLabel={getConceptLabel}
                  editing={editingKey === itemKey ? item : null}
                  showAssetPicker={showAssetPicker}
                  onUpdateItem={updateItem}
                  onGenerate={handleGenerate}
                  onOptimize={handleOptimizePrompt}
                  onFileUpload={handleFileUpload}
                  onReplaceImage={replaceAssetImage}
                  onSelectFromLibrary={handleSelectFromLibrary}
                  onDownload={handleDownload}
                  onDrop={handleDrop}
                  onImageSizeChange={(key, size) => updateItem(key, { imageSize: size })}
                  onReset={handleReset}
                  buildDescription={buildDescription}
                  buildContext={buildContext}
                  buildSourcePreview={buildSourcePreview}
                  setShowAssetPicker={setShowAssetPicker}
                />
              );
            })}
          </div>
        </div>
      )}

      <VirtualHumanPicker
        open={!!virtualHumanPickerItem}
        characterName={virtualHumanPickerItem?.name ?? ''}
        profile={virtualHumanPickerProfile}
        context={virtualHumanPickerItem ? buildContext(virtualHumanPickerItem) : undefined}
        onOpenChange={(open) => {
          if (!open) setVirtualHumanPickerKey(null);
        }}
        onSelect={(person) => {
          if (virtualHumanPickerItem) handleSelectVirtualHuman(virtualHumanPickerItem.key, person);
        }}
      />

      {/* 全屏预览 */}
      <Dialog open={!!previewImage} onOpenChange={(open) => { if (!open) setPreviewImage(null); }}>
        <DialogContent className="max-w-4xl p-2 border-0 bg-black/90">
          <DialogTitle className="sr-only">图片全屏预览</DialogTitle>
          <DialogDescription className="sr-only">
            查看当前图片的大图预览，点击右上角按钮可关闭。
          </DialogDescription>
          {previewImage && (
            <div className="relative">
              <img src={previewImage} alt="全屏预览" className="w-full h-auto max-h-[85vh] object-contain rounded-lg" />
              <button
                onClick={() => setPreviewImage(null)}
                className="absolute top-2 right-2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// 角色卡片：4个缩略图并排 + 展开编辑区
