import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  FileArchive,
  Film,
  Loader2,
  Maximize2,
  Mic,
  Play,
  RotateCcw,
  Trash2,
  Upload,
  Volume2,
  XCircle,
} from '@/components/icons';
import { VideoPreviewModal } from '@/components/shared/VideoPreviewModal';
import { loadBlob } from '@/lib/imageStore';
import { loadPreferredAssetBlob } from '@/lib/assetImageVariants';
import { loadCloudBackedBlob } from '@/lib/cloudBlobResolver';
import { getOrCreateThumbnailUrl, releaseThumbnailUrl } from '@/lib/thumbnailCache';
import { buildVideoFetchUrl, downloadValidatedVideoBlob, shouldForceProxyVideoUrl, validateVideoBlob } from '@/lib/videoBlobUtils';
import { sanitizeVideoFileName } from '@/lib/videoFileUtils';
import { formatBytes } from '@/lib/lightweightImageCompression';
import {
  CHARACTER_IMAGE_CONCEPTS,
  type CharacterVoiceReference,
  PROP_IMAGE_CONCEPT,
  SCENE_IMAGE_CONCEPTS,
  type Asset,
  type ImageConcept,
  type ImageReference,
  type StoryboardState,
  type VideoApiConfig,
  type VideoBackendType,
} from '@/types';
import {
  resolveStoryboardVoiceReferences,
  type ResolvedStoryboardVoiceReference,
} from '@/lib/characterVoiceReferences';
import {
  getOfficialVirtualHumanIncompatibleMessage,
  isOfficialVirtualHumanCompatibleVideoBackend,
} from '@/lib/officialVirtualHumanVideoMode';
import {
  supportsVideoExtensionBackend,
} from './videoExtensionConfig';
import { isSeedanceServiceBackend } from '@/lib/seedanceApi';
import { ErrorDetailPanel } from './ErrorDetailPanel';
import {
  buildCompactVideoPromptDisabledReason,
  buildFinalVideoSubmitPrompt,
  getStep4VideoPromptForLengthCheck,
  getVideoPromptFrameLabel,
  getCompactVideoPromptState,
  getPromptLengthStats,
  getVideoSubmitPromptOverrideState,
  isLikelyTextAuditFailure,
  validateStep5VideoPromptMatchesStep4Length,
} from './videoPromptOptimization';
import {
  buildEffectiveVideoPrompt,
  isStoryboardDirectorMode,
  resolveStoryboardBoardVideoReferenceState,
} from './storyboardBoardVideoReference';
import { evaluateStoryboardBoardQuality } from '@/components/step4/storyboardBoardQuality';
import { isShotPlanBoardMode } from '@/components/step4/storyboardBoardMode';
import { getStoryboardBoardSelectedMode, getStoryboardBoardVariant } from '@/lib/storyboardBoardState';
import {
  buildMissingVideoReferenceMessage,
  buildVideoReferenceLimitMessage,
  hasOfficialVirtualHumanVideoReferences,
  resolveVideoReferenceAssets,
  validateVideoPromptReferenceBindings,
  VIDEO_REFERENCE_LIMIT,
  type EffectiveVideoReferenceItem,
} from './videoReferenceResolver';
import { formatElapsed, formatVideoDuration, getVideoState } from './videoUtils';
import type { VideoContinuityDecision } from './videoContinuityPlan';
import {
  getFailureRecoveryGuidance,
  getSubmittingGuidance,
} from './videoGenerationGuidance';

function getReferenceIconLabel(item: EffectiveVideoReferenceItem) {
  if (item.type === 'scene-position-board') return '定位图';
  if (item.type === 'storyboard-board') return '详细九宫格';
  if (item.type === 'scene') return '场景';
  if (item.type === 'prop') return '道具';
  return '角色';
}

function getAssetConceptLabel(concept: ImageConcept) {
  const characterConcept = CHARACTER_IMAGE_CONCEPTS.find((item) => item.concept === concept);
  if (characterConcept) return characterConcept.label;
  const sceneConcept = SCENE_IMAGE_CONCEPTS.find((item) => item.concept === concept);
  if (sceneConcept) return sceneConcept.label;
  if (concept === PROP_IMAGE_CONCEPT.concept) return PROP_IMAGE_CONCEPT.label;
  return concept;
}

function getReferenceDetailLabel(item: EffectiveVideoReferenceItem) {
  if (item.type === 'storyboard-board' && item.packType === 'full-board') return item.modeLabel;
  if (item.type === 'scene-position-board') return '场景定位图';
  if (item.type === 'storyboard-board') return item.modeLabel;
  const conceptLabel = getAssetConceptLabel(item.asset.concept);
  if (item.asset.source === 'volc_virtual_human') return `${conceptLabel} · 官方身份`;
  if (item.asset.source === 'volc_seedream_output') return `${conceptLabel} · 原始URL`;
  return conceptLabel;
}

function getDirectReferenceThumbnailUrl(item: EffectiveVideoReferenceItem) {
  if (item.type === 'scene-position-board') return null;
  if (item.type === 'storyboard-board') return null;
  return item.asset.thumbnailUrl ?? null;
}

type VoiceSubmitPreviewItem = {
  key: string;
  kind: 'audio' | 'video';
  slotLabel: string;
  title: string;
  detail: string;
  fileName?: string;
  url?: string;
  blobKey?: string;
};

function buildVoiceSubmitPreviewItems(
  backend: VideoBackendType,
  voiceReferences: readonly ResolvedStoryboardVoiceReference[],
  videoConfig: VideoApiConfig,
): VoiceSubmitPreviewItem[] {
  if (isSeedanceServiceBackend(backend)) {
    return voiceReferences
      .filter((reference) => !!(reference.audioBlobKey || reference.publicAudioUrl))
      .map((reference) => ({
        key: `voice-audio-${reference.slot}-${reference.audioBlobKey ?? reference.publicAudioUrl}`,
        kind: 'audio',
        slotLabel: `音频${reference.slot}`,
        title: reference.characterName,
        detail: [
          '小云雀音频参考',
          reference.sourceCharacter ? `来源：${reference.sourceCharacter}` : '',
          reference.voiceTags,
        ].filter(Boolean).join(' · '),
        fileName: reference.audioFileName,
        url: reference.publicAudioUrl,
        blobKey: reference.audioBlobKey,
      }));
  }

  if (backend !== 'volcengine') return [];

  const items: VoiceSubmitPreviewItem[] = [];
  const seenUrls = new Set<string>();
  const pushAudio = (url: string, input: Omit<VoiceSubmitPreviewItem, 'key' | 'kind' | 'slotLabel' | 'url'>) => {
    const normalized = url.trim();
    if (!normalized || seenUrls.has(normalized) || items.length >= 3) return;
    seenUrls.add(normalized);
    items.push({
      ...input,
      key: `${input.title}-${items.length}-${normalized}`,
      kind: 'audio',
      slotLabel: `音频${items.length + 1}`,
      url: normalized,
    });
  };

  for (const reference of voiceReferences) {
    if (!reference.publicAudioUrl) continue;
    pushAudio(reference.publicAudioUrl, {
      title: reference.characterName,
      detail: [
        '角色公网 reference_audio',
        reference.sourceCharacter ? `来源：${reference.sourceCharacter}` : '',
        reference.voiceTags,
      ].filter(Boolean).join(' · '),
      fileName: reference.audioFileName,
    });
  }

  for (const url of videoConfig.volcReferenceAudioUrls ?? []) {
    pushAudio(url, {
      title: '全局音频参考',
      detail: '火山方舟全局 reference_audio URL',
    });
  }

  return items;
}

function getVoicePreviewEmptyText(backend: VideoBackendType) {
  if (isSeedanceServiceBackend(backend)) {
    return '当前分镜没有匹配到会提交的小云雀音频参考；需要在 Step2/Step3 给说话角色绑定声线样本。';
  }
  if (backend === 'volcengine') {
    return '当前分镜没有匹配到公网角色音频，也没有填写全局 reference_audio URL。';
  }
  return '当前视频后端不会提交角色声线媒体。';
}

function getStatusLabel(
  videoState: ReturnType<typeof getVideoState>,
  isSubmitting: boolean,
  isDone: boolean,
  isFailed: boolean,
) {
  if (isSubmitting) {
    if (videoState.status === 'submitting') return '提交中';
    return videoState.statusDetail ? `${videoState.statusDetail} ${videoState.progress}%` : `${videoState.progress}%`;
  }
  if (isDone) return '已完成';
  if (isFailed) return '生成失败';
  return '待生成';
}

export function StoryboardVideoCard({
  sb,
  sbIndex,
  projectId,
  imageRefs,
  videoState,
  onSubmit,
  onReset,
  onCancel,
  onRecoverResult,
  onRecoverSeedanceTask,
  isRecoveringResult = false,
  canRecoverResult = false,
  canRecoverSeedanceTask = false,
  onToggleStoryboardBoardReference,
  onToggleCompactVideoPrompt,
  onOptimizeCompactVideoPrompt,
  onVideoSubmitPromptOverrideChange,
  onClearVideoSubmitPromptOverride,
  onCompressStoryboardBoard,
  isCompressingStoryboardBoard = false,
  onCompressAllStoryboardBoards,
  isCompressingAllStoryboardBoards = false,
  compressAllStoryboardBoardProgress,
  onReplaceReferenceImage,
  onRemoveReferenceImage,
  onRestoreDefaultReferences,
  onReferenceVideoUrlsChange,
  assetLibrary,
  videoBackend,
  videoConfig,
  characterVoiceReferences = [],
  videoRatio,
  useVideoExtension = false,
  videoContinuityDecision,
  batchControls,
  workspaceTools,
  isBatchSelectMode = false,
}: {
  sb: StoryboardState;
  sbIndex: number;
  projectId?: string;
  imageRefs: ImageReference[];
  videoState: ReturnType<typeof getVideoState>;
  assetLibrary: Asset[];
  videoBackend: VideoBackendType;
  videoConfig: VideoApiConfig;
  characterVoiceReferences?: CharacterVoiceReference[];
  videoRatio: string;
  useVideoExtension?: boolean;
  videoContinuityDecision?: VideoContinuityDecision;
  isBatchSelectMode?: boolean;
  onSubmit: () => void;
  onReset: () => void;
  onCancel?: () => void;
  onRecoverResult?: () => void;
  onRecoverSeedanceTask?: () => void;
  isRecoveringResult?: boolean;
  canRecoverResult?: boolean;
  canRecoverSeedanceTask?: boolean;
  onToggleStoryboardBoardReference?: (nextValue: boolean) => void;
  onToggleCompactVideoPrompt?: (nextValue: boolean) => void;
  onOptimizeCompactVideoPrompt?: () => void;
  onVideoSubmitPromptOverrideChange?: (prompt: string, sourcePrompt: string) => void;
  onClearVideoSubmitPromptOverride?: () => void;
  onCompressStoryboardBoard?: () => void;
  isCompressingStoryboardBoard?: boolean;
  onCompressAllStoryboardBoards?: () => void;
  isCompressingAllStoryboardBoards?: boolean;
  compressAllStoryboardBoardProgress?: { current: number; total: number };
  onReplaceReferenceImage?: (item: EffectiveVideoReferenceItem, file: File) => Promise<void> | void;
  onRemoveReferenceImage?: (item: EffectiveVideoReferenceItem) => void;
  onRestoreDefaultReferences?: () => void;
  onReferenceVideoUrlsChange?: (urls: string[]) => void;
  batchControls?: ReactNode;
  workspaceTools?: ReactNode;
}) {
  const isSubmitting = videoState.status === 'submitting' || videoState.status === 'polling';
  const isDone = videoState.status === 'done';
  const isFailed = videoState.status === 'failed';
  const isTextAuditFailure = isFailed && isLikelyTextAuditFailure(videoState.error ?? undefined);

  const storyboardBoardReference = useMemo(
    () => resolveStoryboardBoardVideoReferenceState(sb),
    [sb],
  );
  const isDirectorMode = isStoryboardDirectorMode(sb);
  const hasCustomVideoImageRefs = Array.isArray(sb.videoImageRefs);
  const selectedStoryboardBoardMode = getStoryboardBoardSelectedMode(sb.storyboardBoard);
  const storyboardBoardVariant = getStoryboardBoardVariant(sb.storyboardBoard, selectedStoryboardBoardMode);
  const storyboardBoardQualityReport = useMemo(() => {
    return evaluateStoryboardBoardQuality(storyboardBoardVariant, selectedStoryboardBoardMode);
  }, [storyboardBoardVariant, selectedStoryboardBoardMode]);
  const referenceResolution = useMemo(
    () => resolveVideoReferenceAssets(
      imageRefs,
      assetLibrary,
      storyboardBoardReference,
      sb.scenePositionBoard,
      videoRatio,
      {
        includeScenePositionBoard: false,
        useStoryboardBoardReferencePack: isDirectorMode,
        finalVideoPrompt: sb.seedanceFinalVideoPrompt?.trim() || sb.prompt?.rawText?.trim(),
      },
    ),
    [imageRefs, assetLibrary, storyboardBoardReference, sb.scenePositionBoard, videoRatio, isDirectorMode, sb.seedanceFinalVideoPrompt, sb.prompt?.rawText],
  );
  const includeStoryboardBoardInPrompt = storyboardBoardReference.enabled && referenceResolution.storyboardBoardIncluded;
  const storyboardBoardBlockingReason = storyboardBoardReference.available
    ? null
    : (storyboardBoardReference.reason ?? '当前详细九宫格暂不可作为视频参考图。');
  const storyboardBoardBudgetOmitted = !!sb.useStoryboardBoardReference
    && storyboardBoardReference.available
    && !referenceResolution.storyboardBoardIncluded
    && referenceResolution.budget.omittedItems.some((item) => item.type === 'storyboard-board');

  const storyboardBoardSwitchDisabled = isDirectorMode || (!sb.useStoryboardBoardReference && !!storyboardBoardBlockingReason);
  const storyboardBoardRefLabel = referenceResolution.storyboardBoardRefId
    ?? `参考图片${Math.min(referenceResolution.effectiveItems.length + 1, VIDEO_REFERENCE_LIMIT)}`;
  const storyboardBoardSequenceLabel = isShotPlanBoardMode(storyboardBoardReference.selectedMode)
    ? `S01-S${String(storyboardBoardVariant?.plan?.panels.length || 15).padStart(2, '0')}`
    : 'S01-S09';
  const storyboardBoardCompressed = !!storyboardBoardVariant?.lightweightBlobKey;
  const storyboardBoardCompressionLabel = storyboardBoardCompressed && storyboardBoardVariant?.lightweightBytes
    ? storyboardBoardVariant.lightweightOriginalBytes
      ? `上传版 ${formatBytes(storyboardBoardVariant.lightweightBytes)} / 原图 ${formatBytes(storyboardBoardVariant.lightweightOriginalBytes)}`
      : `上传版 ${formatBytes(storyboardBoardVariant.lightweightBytes)}`
    : '生成 Step5 上传用 WebP92 轻量版，原宫格图保留';

  const effectivePrompt = useMemo(
    () => buildEffectiveVideoPrompt(sb.prompt?.rawText ?? '', {
      includeStoryboardBoardReference: !isDirectorMode && includeStoryboardBoardInPrompt,
      storyboardBoardAvailable: includeStoryboardBoardInPrompt,
      storyboardBoardReferenceLabel: storyboardBoardRefLabel,
      storyboardBoardModeLabel: storyboardBoardReference.modeLabel,
    }),
    [
      sb.prompt?.rawText,
      isDirectorMode,
      includeStoryboardBoardInPrompt,
      storyboardBoardReference.modeLabel,
      storyboardBoardRefLabel,
    ],
  );

  const originalDirectorSubmitPrompt = useMemo(
    () => isDirectorMode
      ? buildFinalVideoSubmitPrompt(sb, effectivePrompt, imageRefs, {
          effectiveItems: referenceResolution.effectiveItems,
          omittedItems: referenceResolution.budget.omittedItems,
          videoRatio,
          ignoreCompactPrompt: true,
        })
      : '',
    [sb, effectivePrompt, imageRefs, isDirectorMode, referenceResolution.effectiveItems, referenceResolution.budget.omittedItems, videoRatio],
  );

  const compactPromptSource = isDirectorMode ? originalDirectorSubmitPrompt : effectivePrompt;

  const compactPromptState = useMemo(
    () => getCompactVideoPromptState(sb, compactPromptSource),
    [sb, compactPromptSource],
  );
  const autoFinalPreviewPrompt = useMemo(
    () => buildFinalVideoSubmitPrompt(sb, compactPromptSource, imageRefs, {
      effectiveItems: referenceResolution.effectiveItems,
      omittedItems: referenceResolution.budget.omittedItems,
      videoRatio,
    }),
    [sb, compactPromptSource, imageRefs, referenceResolution.effectiveItems, referenceResolution.budget.omittedItems, videoRatio],
  );
  const videoPromptOverrideState = useMemo(
    () => getVideoSubmitPromptOverrideState(sb, autoFinalPreviewPrompt),
    [sb, autoFinalPreviewPrompt],
  );
  const finalPreviewPrompt = videoPromptOverrideState.isUsable
    ? videoPromptOverrideState.prompt
    : autoFinalPreviewPrompt;
  const hasStep4DirectorPrompt = !!(sb.seedanceFinalVideoPrompt?.trim() || sb.prompt?.rawText?.trim());
  const compactPromptDisabledReason = buildCompactVideoPromptDisabledReason(compactPromptState);
  const promptLengthStats = getPromptLengthStats(compactPromptSource, compactPromptState.optimizedPrompt);
  const effectiveReferenceCount = referenceResolution.effectiveItems.length;
  const finalPromptChars = finalPreviewPrompt.length;
  const step4PromptChars = getStep4VideoPromptForLengthCheck(sb).length;
  const promptLengthValidation = validateStep5VideoPromptMatchesStep4Length(sb, finalPreviewPrompt, {
    manualOverride: videoPromptOverrideState.isUsable || compactPromptState.isUsable,
  });
  const promptLengthMismatchReason = promptLengthValidation.ok ? null : promptLengthValidation.reason;
  const promptReferenceBindingValidation = useMemo(
    () => validateVideoPromptReferenceBindings(finalPreviewPrompt, referenceResolution.effectiveItems),
    [finalPreviewPrompt, referenceResolution.effectiveItems],
  );
  const promptReferenceBindingMismatchDetail = promptReferenceBindingValidation.valid
    ? null
    : promptReferenceBindingValidation.message;
  const promptReferenceBindingMismatchReason = promptReferenceBindingMismatchDetail
    ? '图片引用编号不一致，请展开下方详情修正。'
    : null;
  const finalPromptFrameLabel = getVideoPromptFrameLabel(videoRatio);
  const hasOfficialVirtualHumanRefs = hasOfficialVirtualHumanVideoReferences(referenceResolution);
  const officialVirtualHumanBackendReady = isOfficialVirtualHumanCompatibleVideoBackend(videoBackend);
  const officialVirtualHumanDisabledReason = hasOfficialVirtualHumanRefs && !officialVirtualHumanBackendReady
    ? getOfficialVirtualHumanIncompatibleMessage(videoBackend)
    : null;
  const extensionEnabled = supportsVideoExtensionBackend(videoBackend) && useVideoExtension;
  const extensionBackendLabel = videoBackend === 'volcengine'
    ? '火山方舟全能参考多参'
    : isSeedanceServiceBackend(videoBackend)
      ? '小云雀延长'
      : '视频延长';
  const continuityTitle = !extensionEnabled
    ? '普通生成'
    : videoContinuityDecision?.mode === 'extend'
      ? videoBackend === 'volcengine' ? '全能参考续写段' : '视频延长段'
      : '连续镜组首镜';
  const continuityMessage = !extensionEnabled
    ? '当前后端或配置未启用视频延长，本镜会按参考图正常生成。'
    : videoContinuityDecision?.mode === 'extend'
      ? (videoContinuityDecision.blockingReason
          ?? (videoBackend === 'volcengine'
              ? `${extensionBackendLabel} 将把分镜 ${typeof videoContinuityDecision.sourceIndex === 'number' ? videoContinuityDecision.sourceIndex + 1 : '?'} 作为视频1直接续写，并自动补充同场景近邻完成视频作为视频2/3，保持空间、站位和表演连续。`
              : `${extensionBackendLabel} 将从分镜 ${typeof videoContinuityDecision.sourceIndex === 'number' ? videoContinuityDecision.sourceIndex + 1 : '?'} 的完成视频继续延长，保持同场景站位。`))
      : (videoContinuityDecision?.reason ?? '本镜作为连续镜组起点，先正常生成源视频。');
  const continuityTone = extensionEnabled && videoContinuityDecision?.mode === 'extend'
    ? (videoContinuityDecision.blockingReason ? 'blocked' : 'extend')
    : 'normal';
  const referenceVideoUrls = sb.referenceVideo?.urls ?? [];
  const referenceVideoText = referenceVideoUrls.join('\n');
  const validReferenceVideoCount = referenceVideoUrls.filter((url) => /^https?:\/\//i.test(url.trim())).length;
  const invalidReferenceVideoCount = referenceVideoUrls.filter((url) => url.trim() && !/^https?:\/\//i.test(url.trim())).length;
  const storyboardVoiceReferences = useMemo(
    () => resolveStoryboardVoiceReferences({
      storyboard: sb,
      project: { characterVoiceReferences },
      videoConfig,
    }),
    [sb, characterVoiceReferences, videoConfig],
  );
  const voiceSubmitPreviewItems = useMemo(
    () => buildVoiceSubmitPreviewItems(videoBackend, storyboardVoiceReferences, videoConfig),
    [videoBackend, storyboardVoiceReferences, videoConfig],
  );
  const showVoiceSubmitPreview = isSeedanceServiceBackend(videoBackend)
    ? videoConfig.characterVoiceReferencesEnabled === true
    : videoBackend === 'volcengine'
      ? videoConfig.characterVoiceReferencesEnabled === true || (videoConfig.volcReferenceAudioUrls ?? []).some((url) => url.trim())
      : false;

  const submitDisabledReason = !sb.prompt?.rawText && !isDirectorMode
    ? '请先生成分镜提示词。'
    : officialVirtualHumanDisabledReason
      ? officialVirtualHumanDisabledReason
      : isDirectorMode && !hasStep4DirectorPrompt
        ? 'Seedance 最终视频提示词未生成，请先回 Step4 生成。'
      : !finalPreviewPrompt.trim()
        ? 'Step5 视频提示词为空，请先编辑后再提交。'
      : promptLengthMismatchReason
        ? promptLengthMismatchReason
      : promptReferenceBindingMismatchReason
        ? promptReferenceBindingMismatchReason
      : storyboardBoardReference.enabled && storyboardBoardBlockingReason
        ? storyboardBoardBlockingReason
        : sb.useCompactVideoPrompt && compactPromptDisabledReason
          ? compactPromptDisabledReason
          : referenceResolution.exceedsLimit
            ? buildVideoReferenceLimitMessage(referenceResolution.totalRefs)
            : referenceResolution.missing.length > 0
              ? buildMissingVideoReferenceMessage(referenceResolution.missing)
              : referenceResolution.promptOrder.checked && !referenceResolution.promptOrder.valid
                ? (referenceResolution.promptOrder.message ?? 'Step5 参考图顺序与最终视频词中的【@图片x】编号不一致，请先返回 Step4 刷新最终视频词。')
                : referenceResolution.effectiveItems.length === 0
                ? '请先在 Step 3 配置参考图片。'
                : null;

  const [showPrompt, setShowPrompt] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [blobVideoSrc, setBlobVideoSrc] = useState<string | null>(null);
  const [blobFallbackReason, setBlobFallbackReason] = useState<string | null>(null);
  const [useProxyVideoSrc, setUseProxyVideoSrc] = useState(() =>
    videoState.videoUrl ? shouldForceProxyVideoUrl(videoState.videoUrl) : false,
  );
  const [downloadingVideo, setDownloadingVideo] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const videoObjUrlRef = useRef<string | null>(null);
  const videoSrc = blobVideoSrc ?? (isDone && videoState.videoUrl ? buildVideoFetchUrl(videoState.videoUrl, useProxyVideoSrc) : null);
  const referenceReplacementInputRef = useRef<HTMLInputElement>(null);
  const pendingReferenceReplacementRef = useRef<EffectiveVideoReferenceItem | null>(null);
  const [replacingReferenceKey, setReplacingReferenceKey] = useState<string | null>(null);

  const requestReferenceReplacement = (item: EffectiveVideoReferenceItem) => {
    pendingReferenceReplacementRef.current = item;
    referenceReplacementInputRef.current?.click();
  };

  const handleReferenceReplacementFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const item = pendingReferenceReplacementRef.current;
    pendingReferenceReplacementRef.current = null;
    if (!file || !item || !onReplaceReferenceImage) return;

    setReplacingReferenceKey(item.key);
    try {
      await onReplaceReferenceImage(item, file);
    } finally {
      setReplacingReferenceKey((current) => (current === item.key ? null : current));
    }
  };

  useEffect(() => {
    setUseProxyVideoSrc(videoState.videoUrl ? shouldForceProxyVideoUrl(videoState.videoUrl) : false);
    setDownloadError(null);
  }, [videoState.videoUrl]);

  const downloadVideoFileName = `${sanitizeVideoFileName(
    `分镜${sb.storyboard ? String(sb.storyboard.number).padStart(2, '0') : sbIndex + 1}_${sb.storyboard?.name ?? 'video'}`,
  )}.mp4`;

  const triggerVideoDownload = (blob: Blob) => {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = downloadVideoFileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  };

  const handleDownloadVideo = async () => {
    if (downloadingVideo) return;
    setDownloadingVideo(true);
    setDownloadError(null);
    try {
      if (videoState.videoBlobKey) {
        const blob = await loadBlob(videoState.videoBlobKey);
        if (blob) {
          const validation = await validateVideoBlob(blob);
          if (validation.valid) {
            triggerVideoDownload(blob);
            return;
          }
        }
      }

      if (!videoState.videoUrl) {
        setDownloadError('当前没有可下载的视频结果。');
        return;
      }

      const result = await downloadValidatedVideoBlob(videoState.videoUrl, { proxyFallback: true });
      if (!result.ok || !result.blob) {
        setDownloadError(result.reason ?? '视频下载失败');
        return;
      }
      triggerVideoDownload(result.blob);
    } finally {
      setDownloadingVideo(false);
    }
  };

  useEffect(() => {
    if (!isDone || !videoState.videoBlobKey) return;
    let cancelled = false;

    loadBlob(videoState.videoBlobKey).then(async (blob) => {
      if (cancelled) return;
      if (!blob) {
        setBlobFallbackReason(
          videoState.videoUrl
            ? '本地缓存不存在，已回退远端结果。'
            : '本地缓存不存在，请重新下载结果。',
        );
        return;
      }

      setBlobFallbackReason(null);
      const validation = await validateVideoBlob(blob);
      if (cancelled) return;
      if (!validation.valid) {
        setBlobFallbackReason(
          videoState.videoUrl
            ? `本地缓存校验失败，已回退远端结果${validation.reason ? `：${validation.reason}` : ''}。`
            : `本地缓存校验失败，请重新下载结果${validation.reason ? `：${validation.reason}` : ''}。`,
        );
        return;
      }

      if (videoObjUrlRef.current) URL.revokeObjectURL(videoObjUrlRef.current);
      const objectUrl = URL.createObjectURL(blob);
      videoObjUrlRef.current = objectUrl;
      setBlobVideoSrc(objectUrl);
    }).catch((error) => {
      if (cancelled) return;
      setBlobFallbackReason(
        videoState.videoUrl
          ? `本地缓存读取失败，已回退远端结果：${error instanceof Error ? error.message : 'unknown'}`
          : `本地缓存读取失败，请重新下载结果：${error instanceof Error ? error.message : 'unknown'}`,
      );
    });

    return () => {
      cancelled = true;
      if (videoObjUrlRef.current) {
        URL.revokeObjectURL(videoObjUrlRef.current);
        videoObjUrlRef.current = null;
      }
      setBlobVideoSrc(null);
    };
  }, [isDone, videoState.videoBlobKey, videoState.videoUrl]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, videoSrc]);

  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const activeThumbnailBlobKeysRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const nextBlobKeys: string[] = [];
    const previousBlobKeys = activeThumbnailBlobKeysRef.current;

    Promise.all(
      referenceResolution.effectiveItems.map(async (item) => {
        const directThumbnailUrl = getDirectReferenceThumbnailUrl(item);
        if (directThumbnailUrl) return [item.key, directThumbnailUrl] as const;

        const loaded = 'blobKey' in item
          ? { blobKey: item.blobKey, blob: await loadCloudBackedBlob(item.blobKey, projectId) }
          : await loadPreferredAssetBlob(item.asset, projectId);
        const { blobKey, blob } = loaded;
        if (!blob || cancelled) return null;
        const url = getOrCreateThumbnailUrl(blobKey, blob);
        nextBlobKeys.push(blobKey);
        return [item.key, url] as const;
      }),
    ).then((entries) => {
      if (cancelled) {
        nextBlobKeys.forEach((key) => releaseThumbnailUrl(key));
        return;
      }
      const nextThumbUrls: Record<string, string> = {};
      entries.forEach((entry) => {
        if (!entry) return;
        nextThumbUrls[entry[0]] = entry[1];
      });
      setThumbUrls(nextThumbUrls);
      activeThumbnailBlobKeysRef.current = nextBlobKeys;
      requestAnimationFrame(() => {
        previousBlobKeys.forEach((key) => releaseThumbnailUrl(key));
      });
    });

    return () => {
      cancelled = true;
    };
  }, [referenceResolution.effectiveItems, projectId]);

  useEffect(() => () => {
    activeThumbnailBlobKeysRef.current.forEach((key) => releaseThumbnailUrl(key));
    activeThumbnailBlobKeysRef.current = [];
  }, []);

  const [voicePreviewBlobUrls, setVoicePreviewBlobUrls] = useState<Record<string, string>>({});
  const [voicePreviewErrors, setVoicePreviewErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const blobItems = voiceSubmitPreviewItems.filter((item) => item.blobKey);
    if (blobItems.length === 0) {
      return undefined;
    }

    let cancelled = false;
    const objectUrls: string[] = [];

    Promise.all(blobItems.map(async (item) => {
      const blob = await loadCloudBackedBlob(item.blobKey!, projectId);
      if (!blob) {
        return {
          key: item.key,
          error: item.kind === 'audio' ? '音频缓存不存在' : '视频缓存不存在',
        };
      }
      if (cancelled) return null;
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      return { key: item.key, url };
    })).then((results) => {
      if (cancelled) return;
      const urls: Record<string, string> = {};
      const errors: Record<string, string> = {};
      results.forEach((result) => {
        if (!result) return;
        if ('url' in result && typeof result.url === 'string') urls[result.key] = result.url;
        if ('error' in result && typeof result.error === 'string') errors[result.key] = result.error;
      });
      setVoicePreviewBlobUrls(urls);
      setVoicePreviewErrors(errors);
    }).catch((error) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : '读取失败';
      setVoicePreviewBlobUrls({});
      setVoicePreviewErrors(Object.fromEntries(blobItems.map((item) => [item.key, message])));
    });

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [voiceSubmitPreviewItems, projectId]);

  const durationText = formatVideoDuration(videoState.submittedAt, videoState.completedAt);
  const guidanceState = {
    status: videoState.status,
    progress: videoState.progress,
    progressIsEstimated: videoState.progressIsEstimated,
    submittedAt: videoState.submittedAt,
    error: videoState.error,
    usingDesensitizedPrompt: !!sb.useCompactVideoPrompt && compactPromptState.isUsable,
  };
  const submittingGuidance = getSubmittingGuidance(guidanceState);
  const failureRecoveryGuidance = getFailureRecoveryGuidance(guidanceState);
  const title = sb.storyboard
    ? `分镜${String(sb.storyboard.number).padStart(2, '0')} · ${sb.storyboard.name}`
    : `分镜 ${sbIndex + 1}`;
  const compressAllStoryboardBoardLabel = isCompressingAllStoryboardBoards
    ? `压缩宫格 ${compressAllStoryboardBoardProgress?.current ?? 0}/${compressAllStoryboardBoardProgress?.total ?? 0}`
    : '一键压缩全部宫格图';
  const recoveryMessage = (videoState.videoBlobKey ? blobFallbackReason : null)
    ?? (isDone && !videoState.videoBlobKey && canRecoverResult
      ? '当前正在直接使用远端结果预览，可点击“重新下载结果”补回本地缓存。'
      : null);

  return (
    <Card className="surface-panel step5-next-workbench border-white/70">
      <CardHeader className="step5-next-shot-head pb-3">
        <input
          ref={referenceReplacementInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleReferenceReplacementFileChange}
        />
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                #{String(sbIndex + 1).padStart(2, '0')}
              </span>
              <span className="font-semibold">{title}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span>参考图 {effectiveReferenceCount}/{VIDEO_REFERENCE_LIMIT} 张</span>
              {referenceResolution.budget.compressed && (
                <>
                  <span>·</span>
                  <span>已从 {referenceResolution.budget.originalTotalRefs} 张自动压缩</span>
                </>
              )}
              <span>·</span>
              <span>提交版 {finalPromptChars} 字</span>
              <span>·</span>
              <span>提示词画幅 {finalPromptFrameLabel}</span>
              {includeStoryboardBoardInPrompt && (
                <>
                  <span>·</span>
                  <span>已带详细九宫格参考</span>
                </>
              )}
              {sb.useCompactVideoPrompt && compactPromptState.isUsable && (
                <>
                  <span>·</span>
                  <span>已启用脱敏提交</span>
                </>
              )}
              {referenceResolution.promptOrder.checked && referenceResolution.promptOrder.valid && referenceResolution.promptOrder.reordered && (
                <>
                  <span>·</span>
                  <span>已按最终词图片编号校正</span>
                </>
              )}
              {referenceResolution.promptOrder.checked && !referenceResolution.promptOrder.valid && (
                <>
                  <span>·</span>
                  <span className="text-red-500">参考图编号需修复</span>
                </>
              )}
            </div>
          </div>

          <div className="min-w-[190px] rounded-2xl border border-white/70 bg-white/70 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-white/5">
            <div className="text-[11px] text-muted-foreground">当前状态</div>
            <div className="mt-1">
              <Badge
                className="rounded-full"
                variant={isDone ? 'default' : isFailed ? 'destructive' : isSubmitting ? 'secondary' : 'outline'}
              >
                {isSubmitting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                {getStatusLabel(videoState, isSubmitting, isDone, isFailed)}
              </Badge>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              {isDone
                ? '可以直接预览、下载或重新生成。'
                : isSubmitting
                  ? '当前任务已进入执行队列，进度会实时回流。'
                  : isFailed
                    ? '建议先查看错误详情，再决定是否重试。'
                    : '确认参考图和提示词后即可提交生成。'}
            </div>
          </div>
        </div>

        {(referenceResolution.effectiveItems.length > 0 || hasCustomVideoImageRefs) && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">本次提交参考图</div>
                {hasCustomVideoImageRefs && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    已手动调整，只影响 Step5 本次提交，不会删除 Step3/Step4 原图。
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <div className="text-[11px] text-muted-foreground">按实际提交顺序排列，共 {effectiveReferenceCount} 张</div>
                {hasCustomVideoImageRefs && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-lg bg-white/70 px-2 text-[11px] dark:bg-white/5"
                    onClick={onRestoreDefaultReferences}
                    disabled={!onRestoreDefaultReferences || isSubmitting}
                  >
                    <RotateCcw className="mr-1 h-3.5 w-3.5" />
                    恢复默认
                  </Button>
                )}
              </div>
            </div>
            {referenceResolution.effectiveItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-amber-200/80 bg-amber-50/70 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-100">
                当前已手动删除全部参考图，视频提交会被阻止；可点击“恢复默认”重新使用 Step4 分配的参考图。
              </div>
            ) : (
            <div className="flex flex-wrap gap-2">
              {referenceResolution.effectiveItems.map((item, itemIndex) => {
                const thumbUrl = thumbUrls[item.key];
                const displayName = item.type === 'storyboard-board'
                  ? `${item.name} · ${item.modeLabel}`
                  : item.name;
                const submitRefLabel = `图片${itemIndex + 1}`;
                const sourceRefLabel = item.refId.replace(/[()（）]/g, '').trim();
                const sourceDetailPrefix = sourceRefLabel && sourceRefLabel !== submitRefLabel
                  ? `来自 ${sourceRefLabel} · `
                  : '';
                const canReplaceReference = !!onReplaceReferenceImage
                  && !isSubmitting
                  && (
                    item.type === 'storyboard-board'
                    || ('asset' in item && item.asset.source !== 'volc_virtual_human')
                  );
                const canRemoveReference = !!onRemoveReferenceImage
                  && !isSubmitting
                  && 'asset' in item;
                const isReplacingReference = replacingReferenceKey === item.key;
                return (
                  <div
                    key={item.key}
                    className="flex items-center gap-2 rounded-2xl border border-white/70 bg-white/70 px-2.5 py-2 text-xs shadow-sm dark:border-white/10 dark:bg-white/5"
                  >
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt={displayName}
                        className="h-11 w-11 flex-shrink-0 rounded-xl border border-muted object-cover"
                      />
                    ) : (
                      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-dashed border-muted-foreground/30 bg-muted/30">
                        <Film className="h-4 w-4 text-muted-foreground/50" />
                      </div>
                    )}
                    <div className="flex min-w-0 flex-col">
                      <span className="font-mono text-[10px] text-muted-foreground">{submitRefLabel}</span>
                      <span className="max-w-[120px] truncate">{getReferenceIconLabel(item)} {displayName}</span>
                      <span className="max-w-[120px] truncate text-[10px] text-muted-foreground">
                        {sourceDetailPrefix}{getReferenceDetailLabel(item)}
                      </span>
                    </div>
                    {canReplaceReference && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 gap-1 rounded-lg bg-white/70 px-2 text-[11px] dark:bg-white/5"
                        onClick={() => requestReferenceReplacement(item)}
                        disabled={isReplacingReference}
                        aria-label={`替换${displayName}参考图`}
                      >
                        {isReplacingReference ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                        替换
                      </Button>
                    )}
                    {canRemoveReference && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 gap-1 rounded-lg border-red-200 bg-white/70 px-2 text-[11px] text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-400/30 dark:bg-white/5 dark:text-red-200 dark:hover:bg-red-500/10"
                        onClick={() => onRemoveReferenceImage?.(item)}
                        aria-label={`从本次提交删除${displayName}参考图`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            )}
          </div>
        )}
        {showVoiceSubmitPreview && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Mic className="h-3.5 w-3.5 text-cyan-700 dark:text-cyan-200" />
                <span>本次提交音频参考</span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {voiceSubmitPreviewItems.length > 0
                  ? `按实际提交顺序排列，共 ${voiceSubmitPreviewItems.length} 个`
                  : '暂无可提交声线媒体'}
              </div>
            </div>

            {voiceSubmitPreviewItems.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {voiceSubmitPreviewItems.map((item) => {
                  const previewSrc = item.kind === 'video'
                    ? voicePreviewBlobUrls[item.key]
                    : (voicePreviewBlobUrls[item.key] ?? item.url);
                  const previewError = voicePreviewErrors[item.key];
                  return (
                    <div
                      key={item.key}
                      className="min-w-[260px] flex-1 rounded-2xl border border-cyan-200/70 bg-cyan-50/70 p-2.5 text-xs shadow-sm dark:border-cyan-400/20 dark:bg-cyan-500/10"
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-200 bg-white/80 text-cyan-700 dark:border-cyan-300/20 dark:bg-slate-950/30 dark:text-cyan-100">
                          {item.kind === 'video' ? <Film className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-cyan-900/70 dark:text-cyan-100/75">{item.slotLabel}</span>
                            <span className="truncate font-medium text-foreground">{item.title}</span>
                          </div>
                          <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                            {item.detail}
                          </div>
                        </div>
                      </div>

                      {item.kind === 'video' ? (
                        previewSrc ? (
                          <video
                            src={previewSrc}
                            controls
                            preload="metadata"
                            className="mt-2 h-20 w-full rounded-xl border border-cyan-200 bg-black object-cover dark:border-cyan-300/20"
                          />
                        ) : (
                          <div className="mt-2 flex h-20 items-center justify-center rounded-xl border border-dashed border-cyan-200 bg-white/60 text-[11px] text-muted-foreground dark:border-cyan-300/20 dark:bg-slate-950/20">
                            {previewError ?? '正在读取视频'}
                          </div>
                        )
                      ) : (
                        previewSrc ? (
                          <audio
                            src={previewSrc}
                            controls
                            preload="metadata"
                            className="mt-2 h-9 w-full"
                          />
                        ) : (
                          <div className="mt-2 flex h-9 items-center justify-center rounded-xl border border-dashed border-cyan-200 bg-white/60 text-[11px] text-muted-foreground dark:border-cyan-300/20 dark:bg-slate-950/20">
                            {previewError ?? '正在读取音频'}
                          </div>
                        )
                      )}

                      {item.fileName && (
                        <div className="mt-1 truncate text-[10px] text-muted-foreground">{item.fileName}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-cyan-200/70 bg-cyan-50/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground dark:border-cyan-400/20 dark:bg-cyan-500/5">
                {getVoicePreviewEmptyText(videoBackend)}
              </div>
            )}
          </div>
        )}
        {referenceResolution.budget.compressed && (
          <div className="mt-3 rounded-2xl border border-blue-200/70 bg-blue-50/80 px-3 py-2.5 text-xs text-blue-800 dark:border-blue-400/25 dark:bg-blue-500/10 dark:text-blue-100">
            <div className="font-semibold">
              已启用智能参考图预算：{referenceResolution.budget.originalTotalRefs} 张压缩为 {effectiveReferenceCount}/{VIDEO_REFERENCE_LIMIT} 张
            </div>
            <div className="mt-1 leading-relaxed">
              {referenceResolution.budget.omittedItems.slice(0, 4).map((item) => item.message).join('；')}
              {referenceResolution.budget.omittedItems.length > 4 ? `；另有 ${referenceResolution.budget.omittedItems.length - 4} 项自动降级` : ''}
            </div>
          </div>
        )}
        {hasOfficialVirtualHumanRefs && (
          <div className={`mt-3 rounded-2xl border px-3 py-2.5 text-xs leading-relaxed ${
            officialVirtualHumanBackendReady
              ? 'border-blue-200/70 bg-blue-50/80 text-blue-800 dark:border-blue-400/25 dark:bg-blue-500/10 dark:text-blue-100'
              : 'border-amber-200/70 bg-amber-50/80 text-amber-800 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-100'
          }`}
          >
            <div className="font-semibold">
              官方虚拟人脸库 · {officialVirtualHumanBackendReady ? '火山方舟提交模式' : '需要切换火山方舟'}
            </div>
            <div className="mt-1">
              {officialVirtualHumanBackendReady
                ? '本分镜包含官方身份参考图，提交时会按火山方舟 asset:// 身份图发送。'
                : officialVirtualHumanDisabledReason}
            </div>
          </div>
        )}
        {(referenceResolution.missing.length > 0 || referenceResolution.exceedsLimit) && (
          <div className="mt-3 rounded-2xl border border-amber-200/70 bg-amber-50/80 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-100">
            <div className="font-semibold">参考图未就绪，当前分镜不应重新生成视频</div>
            <div className="mt-1 leading-relaxed">
              {referenceResolution.exceedsLimit
                ? buildVideoReferenceLimitMessage(referenceResolution.totalRefs)
                : buildMissingVideoReferenceMessage(referenceResolution.missing)}
            </div>
          </div>
        )}
        <div className={`mt-3 rounded-2xl border px-3 py-2.5 text-xs leading-relaxed ${
          continuityTone === 'extend'
            ? 'border-emerald-200/80 bg-emerald-50/80 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-100'
            : continuityTone === 'blocked'
              ? 'border-amber-200/80 bg-amber-50/80 text-amber-800 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-100'
              : 'border-white/70 bg-white/60 text-muted-foreground dark:border-white/10 dark:bg-white/5'
        }`}
        >
          <div className="flex flex-wrap items-center gap-2 font-semibold text-foreground dark:text-inherit">
            <span>{continuityTitle}</span>
            {extensionEnabled && videoContinuityDecision?.mode === 'extend' && (
              <Badge variant="outline" className="rounded-full bg-white/60 text-[10px] dark:bg-white/10">
                {videoBackend === 'volcengine'
                  ? `视频1 源分镜 #${(videoContinuityDecision.sourceIndex ?? 0) + 1}`
                  : `源分镜 #${(videoContinuityDecision.sourceIndex ?? 0) + 1}`}
              </Badge>
            )}
          </div>
          <div className="mt-1">{continuityMessage}</div>
          {extensionEnabled && videoContinuityDecision?.mode === 'extend' && videoContinuityDecision.sharedCharacters.length > 0 && (
            <div className="mt-1 text-[11px] opacity-80">
              连续角色：{videoContinuityDecision.sharedCharacters.join('、')}
            </div>
          )}
        </div>

        {videoBackend === 'volcengine' && (
          <div className="mt-3 rounded-2xl border border-white/70 bg-white/60 px-3 py-2.5 text-xs dark:border-white/10 dark:bg-white/5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">单镜 reference_video URL</div>
              <Badge variant="outline" className="rounded-full bg-white/70 text-[10px] dark:bg-white/5">
                {validReferenceVideoCount}/3
              </Badge>
            </div>
            <Textarea
              value={referenceVideoText}
              onChange={(event) => onReferenceVideoUrlsChange?.(
                event.target.value
                  .split(/\r?\n/)
                  .map((url) => url.trim())
                  .filter(Boolean)
                  .slice(0, 3),
              )}
              placeholder="https://example.com/action-reference.mp4"
              className="mt-2 min-h-[68px] resize-y text-xs"
            />
            <div className="mt-1 leading-5 text-muted-foreground">
              仅提交公网 URL，最多 3 个；会和同场景续写自动 reference_video 去重，优先保留续写源视频。
            </div>
            {invalidReferenceVideoCount > 0 && (
              <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-200">
                有 {invalidReferenceVideoCount} 个 URL 不是 http/https，提交时会被忽略。
              </div>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid gap-3 xl:grid-cols-2">
          {isDirectorMode && (
          <div className="rounded-2xl border border-muted/70 bg-muted/20 px-3 py-3 dark:border-slate-700/70 dark:bg-slate-900/45">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-medium text-foreground">
                    {isDirectorMode ? 'Step4 详细九宫格驱动' : '使用详细九宫格作为额外参考图'}
                  </div>
                  <Badge
                    variant="outline"
                    className="rounded-full text-[10px] dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-100"
                  >
                    镜头编排
                  </Badge>
                </div>
                <div className="text-[11px] leading-relaxed text-muted-foreground">
                  {isDirectorMode
                    ? `当前镜头会以 Step4 的 ${storyboardBoardReference.modeLabel} 作为主导演参考，视频提交词会按 ${storyboardBoardSequenceLabel} 重排。`
                    : `开启后会把 Step4 的 ${storyboardBoardReference.modeLabel} 加入本次视频生成参考图，并在提示词末尾追加镜头编排约束。会额外占用 1 张参考图名额。`}
                </div>
              </div>
              <Switch
                checked={isDirectorMode || !!sb.useStoryboardBoardReference}
                onCheckedChange={(checked) => onToggleStoryboardBoardReference?.(checked)}
                disabled={storyboardBoardSwitchDisabled}
                aria-label="使用详细九宫格作为额外参考图"
              />
            </div>
            {isDirectorMode ? (
              storyboardBoardBlockingReason ? (
                <div className="mt-2 text-xs text-amber-600 dark:text-amber-200">{storyboardBoardBlockingReason}</div>
              ) : (
                <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-200">
                  已由 Step4 详细九宫格模式接管，将作为 {storyboardBoardRefLabel} 参与本次视频生成。
                </div>
              )
            ) : sb.useStoryboardBoardReference ? (
              storyboardBoardBlockingReason ? (
                <div className="mt-2 text-xs text-amber-600 dark:text-amber-200">{storyboardBoardBlockingReason}</div>
              ) : storyboardBoardBudgetOmitted ? (
                <div className="mt-2 text-xs text-blue-600 dark:text-blue-200">
                  已开启，但因 9 张上限本次自动让位；角色、场景和道具参考图优先。
                </div>
              ) : (
                <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-200">
                  已启用，将在现有参考图后追加为 {storyboardBoardRefLabel}。
                </div>
              )
            ) : storyboardBoardBlockingReason ? (
              <div className="mt-2 text-xs text-muted-foreground">{storyboardBoardBlockingReason}</div>
            ) : (
              <div className="mt-2 text-xs text-muted-foreground">
                当前详细九宫格可用，开启后优先作为 {storyboardBoardRefLabel} 参与本次视频生成；若超过 9 张，会自动让位给角色、场景和道具参考图。
              </div>
            )}
            {storyboardBoardReference.enabled && storyboardBoardReference.available && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/60 px-2.5 py-2">
                <div className="min-w-0 text-[11px] leading-5 text-muted-foreground">
                  <span className="font-medium text-foreground">宫格上传版</span>
                  <span className="ml-2">{storyboardBoardCompressionLabel}</span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={storyboardBoardCompressed ? 'outline' : 'secondary'}
                  onClick={onCompressStoryboardBoard}
                  disabled={!onCompressStoryboardBoard || isSubmitting || isCompressingStoryboardBoard}
                  className="h-8 gap-1.5 rounded-lg px-2.5 text-[11px]"
                >
                  {isCompressingStoryboardBoard
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <FileArchive className="h-3.5 w-3.5" />}
                  {isCompressingStoryboardBoard
                    ? '压缩中'
                    : storyboardBoardCompressed
                      ? '重新压缩'
                      : '压缩宫格'}
                </Button>
              </div>
            )}
            {storyboardBoardReference.enabled && storyboardBoardReference.available && storyboardBoardQualityReport.hasHighRisk && (
              <div className="mt-2 rounded-xl border border-amber-200/70 bg-amber-50/80 px-2.5 py-2 text-[11px] leading-5 text-amber-800 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-100">
                详细九宫格质检提示：{storyboardBoardQualityReport.failCount > 0
                  ? `${storyboardBoardQualityReport.failCount} 个关键项未通过`
                  : `${storyboardBoardQualityReport.warningCount} 个风险项`}。仍可继续提交，但建议先回 Step4 刷新详细九宫格，避免格数错位、文字残留或角色漂移。
              </div>
            )}
          </div>
          )}

          <div className={`rounded-2xl border px-3 py-3 ${
            isTextAuditFailure
              ? 'border-amber-300/70 bg-amber-50/70 dark:border-amber-400/30 dark:bg-amber-500/10'
              : 'border-muted/70 bg-muted/20 dark:border-slate-700/70 dark:bg-slate-900/45'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-medium text-foreground">文字审核失败补救</div>
                  <Badge
                    variant="outline"
                    className="rounded-full text-[10px] dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-100"
                  >
                    手动脱敏
                  </Badge>
                </div>
                <div className="text-[11px] leading-relaxed text-muted-foreground">
                  默认直接提交完整长提示词。只有视频平台返回文字审核、敏感词或内容安全失败时，再点击生成脱敏提示词；系统会保留时间段、台词、参考图编号和镜头调度，只替换高风险表述。
                </div>
              </div>
              <Switch
                checked={!!sb.useCompactVideoPrompt}
                onCheckedChange={(checked) => onToggleCompactVideoPrompt?.(checked)}
                disabled={!compactPromptSource.trim()}
                aria-label="使用脱敏视频提示词"
              />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={compactPromptState.isFresh ? 'outline' : 'default'}
                className={
                  compactPromptState.isFresh
                    ? 'rounded-xl bg-white/70 dark:bg-white/5'
                    : 'rounded-xl bg-[linear-gradient(135deg,#ff7a4f,#ff4f7d)] text-white shadow-[0_12px_28px_-18px_rgba(255,92,120,0.9)] hover:opacity-95'
                }
                onClick={onOptimizeCompactVideoPrompt}
                disabled={
                  !compactPromptSource.trim()
                  || (storyboardBoardReference.enabled && !!storyboardBoardBlockingReason)
                  || compactPromptState.status === 'optimizing'
                }
              >
                {compactPromptState.status === 'optimizing' ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    脱敏中...
                  </>
                ) : (
                  <>{compactPromptState.isFresh ? '重新生成脱敏提示词' : '生成脱敏提示词'}</>
                )}
              </Button>
              {compactPromptState.isFresh && (
                <span className="text-[11px] text-muted-foreground">
                  原 {promptLengthStats.originalChars} 字，脱敏后 {promptLengthStats.optimizedChars} 字
                </span>
              )}
            </div>

            {isTextAuditFailure && (
              <div className="mt-2 text-xs text-amber-700 dark:text-amber-100">
                检测到疑似文字审核失败，建议生成脱敏提示词后手动重试。
              </div>
            )}
            {sb.useCompactVideoPrompt ? (
              compactPromptDisabledReason ? (
                <div className="mt-2 text-xs text-amber-600 dark:text-amber-200">{compactPromptDisabledReason}</div>
              ) : (
                <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-200">
                  已启用，提交和预览将使用脱敏后的提示词。
                </div>
              )
            ) : compactPromptState.isFresh ? (
              <div className="mt-2 text-xs text-muted-foreground">当前已有可用脱敏版，开启后即可作为本次视频提交版本使用。</div>
            ) : compactPromptState.error ? (
              <div className="mt-2 text-xs text-red-600 dark:text-red-200">上次脱敏失败：{compactPromptState.error}</div>
            ) : null}
          </div>
        </div>

        {workspaceTools && (
          <div className="mt-3">
            {workspaceTools}
          </div>
        )}

        {(sb.prompt?.rawText || isDirectorMode) && (
          <div className="rounded-2xl border border-white/70 bg-white/60 dark:border-white/10 dark:bg-white/5">
            <button
              type="button"
              onClick={() => setShowPrompt((value) => !value)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Eye className="h-3.5 w-3.5" />
                <span className="truncate">视频提示词（实际提交版本，可编辑）</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="rounded-full border border-white/70 bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-foreground shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
                  Step5 {finalPromptChars} 字
                </span>
                {showPrompt ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </span>
            </button>
            {showPrompt && (
              <div className="px-3 pb-3">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <Badge
                    variant="outline"
                    className="rounded-full bg-white/80 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-100"
                  >
                    {videoPromptOverrideState.isUsable
                      ? '人工编辑提交版'
                      : isDirectorMode ? '详细九宫格导演版' : (compactPromptState.isUsable ? '脱敏提交版' : '原始提交版')}
                  </Badge>
                  {isDirectorMode && step4PromptChars > 0 && (
                    <>
                      <span>Step4 {step4PromptChars} 字</span>
                      <span>·</span>
                    </>
                  )}
                  <span>
                    {videoPromptOverrideState.isUsable
                      ? '当前预览使用：人工编辑后的 Step5 实际提交词'
                      : isDirectorMode
                      ? '当前预览使用：详细九宫格导演驱动提交词'
                      : compactPromptState.isUsable
                        ? '当前预览使用：详细九宫格增强后的脱敏提交版提示词'
                        : '当前预览使用：详细九宫格增强后的原始提交版提示词'}
                  </span>
                  {videoPromptOverrideState.isUsable && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 rounded-lg px-2 text-[11px]"
                      onClick={onClearVideoSubmitPromptOverride}
                    >
                      <RotateCcw className="mr-1 h-3 w-3" />
                      恢复自动版
                    </Button>
                  )}
                </div>
                {promptLengthMismatchReason && (
                  <div className="mb-2 rounded-xl border border-amber-200/70 bg-amber-50/80 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-100">
                    {promptLengthMismatchReason}
                  </div>
                )}
                {videoPromptOverrideState.isUsable && (
                  <div className="mb-2 rounded-xl border border-emerald-200/70 bg-emerald-50/80 px-3 py-2 text-xs leading-5 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-100">
                    已使用人工编辑版，提交时按当前编辑内容和字数同步，不再使用 Step4 字数拦截。
                  </div>
                )}
                <Textarea
                  value={finalPreviewPrompt}
                  onChange={(event) => onVideoSubmitPromptOverrideChange?.(event.target.value, autoFinalPreviewPrompt)}
                  className="min-h-[220px] resize-y whitespace-pre-wrap rounded-xl border bg-background font-mono text-xs leading-relaxed text-foreground"
                />
              </div>
            )}
          </div>
        )}

        {isSubmitting && (
          <div className="space-y-2 rounded-2xl border border-blue-200/60 bg-blue-50/50 p-3 dark:border-blue-400/20 dark:bg-blue-500/5">
            <Progress
              value={videoState.progress}
              className={`h-2 ${videoState.progressIsEstimated && videoState.status === 'polling' ? 'animate-pulse' : ''}`}
            />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>
                {videoState.statusDetail || (videoState.status === 'submitting' ? '提交中' : '生成中')}
                {videoState.progressIsEstimated && videoState.status === 'polling' && (
                  <span className="ml-1 text-amber-500">· 估算</span>
                )}
              </span>
              {videoState.submittedAt && videoState.status === 'polling' && (
                <span>已用时 {formatElapsed(videoState.submittedAt)}</span>
              )}
            </div>
            {submittingGuidance && (
              <p className="text-xs leading-5 text-blue-700 dark:text-blue-200">
                {submittingGuidance}
              </p>
            )}
          </div>
        )}

        {isFailed && videoState.error && (
          <div className="space-y-2">
            {failureRecoveryGuidance && (
              <div className="rounded-2xl border border-amber-200/70 bg-amber-50/60 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100">
                {failureRecoveryGuidance}
              </div>
            )}
            <ErrorDetailPanel error={videoState.error} detail={videoState.errorDetail ?? undefined} />
          </div>
        )}

        {isDone && (videoSrc || recoveryMessage) && (
          <div className="space-y-2">
            {videoSrc ? (
              <div className="group relative overflow-hidden rounded-2xl border border-muted/70 bg-black/5">
                <video
                  ref={videoRef}
                  key={videoSrc}
                  src={videoSrc}
                  controls
                  className="max-h-[280px] w-full bg-black"
                  onError={() => {
                    if (blobVideoSrc) {
                      if (videoObjUrlRef.current) {
                        URL.revokeObjectURL(videoObjUrlRef.current);
                        videoObjUrlRef.current = null;
                      }
                      setBlobVideoSrc(null);
                      setBlobFallbackReason(
                        videoState.videoUrl
                          ? '本地缓存播放失败，已回退远端结果，可点击“重新下载结果”刷新缓存。'
                          : '本地缓存播放失败，请重新下载结果。',
                      );
                    } else {
                      if (videoState.videoUrl && !useProxyVideoSrc) {
                        setUseProxyVideoSrc(true);
                        setBlobFallbackReason('远端直连播放失败，已切换服务器代理预览；下载仍会优先尝试直连。');
                        return;
                      }
                      setBlobFallbackReason('远端结果播放失败，请重新下载结果或重新生成。');
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPreview(true)}
                  className="absolute right-2 top-2 rounded-md bg-black/50 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
                  title="全屏预览"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-200/70 bg-amber-50/70 px-3 py-3 text-xs text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100">
                {recoveryMessage ?? '当前视频暂时不可预览，请重新下载结果。'}
              </div>
            )}

            {recoveryMessage && videoSrc && (
              <div className="rounded-xl border border-amber-200/60 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100">
                {recoveryMessage}
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1">
                {[0.5, 1, 1.5, 2].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => setPlaybackRate(rate)}
                    className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
                      playbackRate === rate
                        ? 'border-primary bg-primary/10 font-medium text-primary'
                        : 'border-muted text-muted-foreground hover:border-muted-foreground/50'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                {durationText && (
                  <>
                    <span>生成耗时 {durationText}</span>
                    <span>·</span>
                  </>
                )}
                <span>{finalPromptChars} 字提示词</span>
              </div>
            </div>

            {videoSrc && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl"
                  onClick={handleDownloadVideo}
                  disabled={downloadingVideo}
                >
                  {downloadingVideo ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="mr-1 h-3.5 w-3.5" />
                  )}
                  {downloadingVideo ? '下载中' : '下载视频'}
                </Button>
                <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setShowPreview(true)}>
                  <Maximize2 className="mr-1 h-3.5 w-3.5" />
                  大屏预览
                </Button>
              </div>
            )}

            {downloadError && (
              <div className="rounded-xl border border-amber-200/60 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100">
                {downloadError}
              </div>
            )}

            {showPreview && videoSrc && (
              <VideoPreviewModal
                videoSrc={videoSrc}
                title={title}
                onClose={() => setShowPreview(false)}
              />
            )}
          </div>
        )}

        {promptReferenceBindingMismatchDetail && !isSubmitting && !isDone && (
          <div className="rounded-2xl border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100">
            {promptReferenceBindingMismatchDetail}
          </div>
        )}

        <div className="rounded-2xl border border-white/70 bg-white/60 px-3 py-3 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="step5-next-action-row flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {!isBatchSelectMode && !isSubmitting && !isDone && (
                <Button
                  size="sm"
                  className="step5-next-primary-action h-10 rounded-full bg-[linear-gradient(135deg,#ff7a4f,#ff4f7d)] px-5 text-white shadow-[0_14px_30px_-18px_rgba(255,92,120,0.9)] hover:opacity-95"
                  onClick={onSubmit}
                  disabled={!!submitDisabledReason}
                  title={submitDisabledReason ?? '提交视频生成'}
                >
                  <Play className="mr-1 h-3.5 w-3.5" />
                  {isFailed ? '重新生成' : '生成单分镜视频'}
                </Button>
              )}

              {onCompressAllStoryboardBoards && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-10 gap-1.5 rounded-full bg-white/70 px-4 text-xs dark:bg-white/5"
                  onClick={onCompressAllStoryboardBoards}
                  disabled={isCompressingStoryboardBoard || isCompressingAllStoryboardBoards}
                  title="为本集所有已生成宫格图准备 Step5 上传轻量版，不改原图"
                >
                  {isCompressingAllStoryboardBoards ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileArchive className="h-3.5 w-3.5" />
                  )}
                  {compressAllStoryboardBoardLabel}
                </Button>
              )}

              {isBatchSelectMode && !isSubmitting && !isDone && (
                <span className="text-xs text-muted-foreground">正在选择批量镜头；退出选择后可生成当前单分镜。</span>
              )}

              {(isDone || isFailed || videoState.status === 'submitting') && (
                <Button size="sm" variant="ghost" className="rounded-xl" onClick={onReset}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />
                  重置状态
                </Button>
              )}

              {(isDone || isFailed) && canRecoverResult && onRecoverResult && (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl"
                  onClick={onRecoverResult}
                  disabled={isRecoveringResult}
                >
                  {isRecoveringResult ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="mr-1 h-3.5 w-3.5" />
                  )}
                  {isRecoveringResult ? '恢复中...' : isFailed ? '恢复远端结果' : '重新下载结果'}
                </Button>
              )}

              {isSubmitting && canRecoverSeedanceTask && onRecoverSeedanceTask && (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl"
                  onClick={onRecoverSeedanceTask}
                  disabled={isRecoveringResult}
                >
                  {isRecoveringResult ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="mr-1 h-3.5 w-3.5" />
                  )}
                  {isRecoveringResult ? '恢复中...' : '恢复小云雀结果'}
                </Button>
              )}

              {isSubmitting && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={onCancel ?? onReset}
                  title={videoState.status === 'submitting' ? '取消当前提交' : '取消当前任务'}
                >
                  <XCircle className="mr-1 h-3.5 w-3.5" />
                  {videoState.status === 'submitting' ? '取消提交' : '取消任务'}
                </Button>
              )}

              {!sb.prompt?.rawText && !isDirectorMode && (
                <span className="text-xs text-muted-foreground">请先生成分镜提示词。</span>
              )}
              {(sb.prompt?.rawText || isDirectorMode) && !isSubmitting && !isDone && submitDisabledReason ? (
                <span className="min-w-0 max-w-full flex-1 text-xs leading-5 text-muted-foreground xl:max-w-[520px]">
                  {submitDisabledReason}
                </span>
              ) : null}
            </div>
            {batchControls && (
              <div className="min-w-0 flex-1 xl:flex xl:justify-end">
                {batchControls}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
