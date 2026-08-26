import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import type { Dispatch, MutableRefObject } from 'react';
import { deleteBlob, loadBlob } from '@/lib/imageStore';
import { loadPreferredAssetBlob } from '@/lib/assetImageVariants';
import { loadCloudBackedBlob } from '@/lib/cloudBlobResolver';
import { ConcurrentLimiter } from '@/lib/concurrentLimiter';
import { volcCancelTask } from '@/lib/volcengineApiClient';
import { cancelBackgroundJob } from '@/lib/backgroundJobsClient';
import type {
  VolcReferenceImageInput,
  VolcReferenceVideoInput,
} from '@/lib/volcengineApiClient';
import { downloadValidatedVideoBlob } from '@/lib/videoBlobUtils';
import {
  getOfficialVirtualHumanIncompatibleMessage,
  isOfficialVirtualHumanCompatibleVideoBackend,
} from '@/lib/officialVirtualHumanVideoMode';
import type { Asset, Project, StoryboardState, VideoApiConfig, AppState } from '@/types';
import type { Action } from '@/stores/projectStore';
import {
  getStoryboardBoardVariant,
  mergeStoryboardBoardVariant,
} from '@/lib/storyboardBoardState';
import type { VideoTask } from './VideoTask';
import { buildErrorDetail } from './videoUtils';
import { submitSeedanceVideo } from './submitSeedance';
import { submitXyqAgentVideo } from './submitXyqAgent';
import { buildVolcError, submitVolcVideo } from './submitVolc';
import { buildAliyunBailianError, submitAliyunBailianVideo } from './submitAliyunBailian';
import { formatVideoApiErrorMessage, getRawVideoApiError } from './videoErrorFormat';
import {
  buildMissingVideoReferenceMessage,
  buildVideoReferenceLimitMessage,
  hasOfficialVirtualHumanVideoReferences,
  resolveVideoReferenceAssets,
  validateVideoPromptReferenceBindings,
} from './videoReferenceResolver';
import {
  buildEffectiveVideoPrompt,
  isStoryboardDirectorMode,
  resolveStoryboardBoardVideoReferenceState,
} from './storyboardBoardVideoReference';
import {
  buildFinalVideoSubmitPrompt,
  getVideoSubmitPromptOverrideState,
  validateStep5VideoPromptMatchesStep4Length,
} from './videoPromptOptimization';
import {
  getStoryboardVideoContinuityDecision,
  type VideoContinuityDecision,
} from './videoContinuityPlan';
import { summarizeSpatialBlocking } from '@/components/step4/spatialBlocking';
import {
  isVideoExtensionEnabled,
  supportsVideoExtensionBackend,
} from './videoExtensionConfig';
import {
  getStoryboardVideoSubmissionReadiness,
} from './videoSubmissionReadiness';
import {
  resolveStoryboardVoiceReferences,
  type ResolvedStoryboardVoiceReference,
} from '@/lib/characterVoiceReferences';
import { getStoryboardVideoImageRefs } from './videoImageRefs';
import {
  buildSeedanceFetchInit,
  getSeedanceApiBase,
  isSeedanceServiceBackend,
} from '@/lib/seedanceApi';
import { resolveStoryboardVideoDuration } from '@/lib/storyboardDuration';
import { getVolcVideoModelCapabilities } from '@/lib/volcengineVideoModels';
import {
  compressStoryboardBoardForUpload,
  STORYBOARD_BOARD_UPLOAD_WEBP_QUALITY_LABEL,
} from './storyboardBoardCompression';

type Step5Dispatch = Dispatch<Action>;

const blobLimiter = new ConcurrentLimiter(5);

type CancelVideoResult = {
  success: boolean;
  message: string;
};

type SeedanceCancelResponse = {
  status?: string;
  message?: string;
  task_status?: string;
  billing_status?: string;
  can_stop_waiting?: boolean;
  error?: {
    code?: string;
    message?: string;
    detail?: unknown;
  };
};

async function readSeedanceCancelResponse(response: Response): Promise<SeedanceCancelResponse> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as SeedanceCancelResponse;
  } catch {
    return { message: text };
  }
}

async function cancelSeedanceRemoteTask(
  config: VideoApiConfig,
  taskId: string,
): Promise<CancelVideoResult> {
  const response = await fetch(
    `${getSeedanceApiBase(config)}/task/${taskId}/cancel`,
    buildSeedanceFetchInit(config, { method: 'POST' }),
  );
  const data = await readSeedanceCancelResponse(response);
  const message = data.message || data.error?.message;

  if (response.ok && data.status !== 'error') {
    return {
      success: true,
      message: message || '任务已取消，冻结积分已释放。',
    };
  }

  return {
    success: false,
    message: message || (
      response.status === 409
        ? '任务已提交到官方生成，当前不能取消；系统会继续等待结果。'
        : `取消任务失败 (${response.status})`
    ),
  };
}

async function ensureCompressedStoryboardBoardForSubmit(
  storyboard: StoryboardState,
  options: {
    index: number;
    chapterId: string;
    projectId?: string;
    dispatch: Step5Dispatch;
  },
): Promise<StoryboardState> {
  const storyboardBoardReference = resolveStoryboardBoardVideoReferenceState(storyboard);
  if (!storyboardBoardReference.enabled || !storyboardBoardReference.available) return storyboard;

  const selectedMode = storyboardBoardReference.selectedMode;
  const variant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedMode);
  if (!variant?.blobKey) return storyboard;

  if (variant.lightweightBlobKey) {
    const existingLightweight = await blobLimiter
      .run(() => loadCloudBackedBlob(variant.lightweightBlobKey!, options.projectId))
      .catch(() => null);
    if (existingLightweight && existingLightweight.size > 0) return storyboard;
  }

  try {
    const previousLightweightBlobKey = variant.lightweightBlobKey;
    const result = await compressStoryboardBoardForUpload(variant.blobKey, options.projectId);
    if (result.skippedNoGain || !result.blobKey) return storyboard;

    const nextStoryboardBoard = mergeStoryboardBoardVariant(storyboard.storyboardBoard, selectedMode, {
      lightweightBlobKey: result.blobKey,
      lightweightMimeType: 'image/webp',
      lightweightQuality: STORYBOARD_BOARD_UPLOAD_WEBP_QUALITY_LABEL,
      lightweightOriginalBytes: result.originalBytes,
      lightweightBytes: result.compressedBytes,
      lightweightWidth: result.width,
      lightweightHeight: result.height,
      lightweightCreatedAt: Date.now(),
    });

    options.dispatch({
      type: 'UPDATE_STORYBOARD',
      index: options.index,
      chapterId: options.chapterId,
      updates: { storyboardBoard: nextStoryboardBoard },
    });

    if (previousLightweightBlobKey && previousLightweightBlobKey !== result.blobKey) {
      deleteBlob(previousLightweightBlobKey).catch(() => undefined);
    }

    return {
      ...storyboard,
      storyboardBoard: nextStoryboardBoard,
    };
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[Step5] 宫格故事板自动压缩失败，继续使用原图提交：', error);
    }
    return storyboard;
  }
}

function buildStoryboardLabel(index: number, sb?: StoryboardState) {
  if (!sb?.storyboard) return `分镜${index + 1}`;
  return `分镜${String(sb.storyboard.number || index + 1).padStart(2, '0')} ${sb.storyboard.name}`;
}

function buildVideoExtensionPrompt(
  prompt: string,
  decision: VideoContinuityDecision,
  previous: StoryboardState,
  current: StoryboardState,
  referenceVideos?: VolcReferenceVideoInput[],
  storyboards?: readonly StoryboardState[],
) {
  const previousBlocking = summarizeSpatialBlocking(previous.spatialBlocking ?? previous.continuityOutput?.spatialBlocking);
  const currentBlocking = summarizeSpatialBlocking(current.continuityInput?.spatialBlocking ?? current.choreography?.startBlocking);
  const videoReferenceDetails = referenceVideos?.length
    ? referenceVideos.map((_, index) => {
        const refIndex = index === 0
          ? decision.sourceIndex
          : findStoryboardIndexByVideoUrl(storyboards ?? [], referenceVideos[index].url);
        const label = typeof refIndex === 'number' && refIndex >= 0
          ? buildStoryboardLabel(refIndex, storyboards?.[refIndex])
          : `同场景参考视频${index + 1}`;
        return `视频${index + 1}：${label}${index === 0 ? '，作为本镜直接续写源视频' : '，只作为同场景空间、角色走位和视觉风格参考'}`;
      }).join('\n')
    : '';
  const details = [
    `连续原因：${decision.reason}`,
    referenceVideos?.length
      ? `官方多视频参考顺序：\n${videoReferenceDetails}`
      : `上一段源视频：${buildStoryboardLabel(decision.sourceIndex ?? 0, previous)}。`,
    previous.lastFrameInfo ? `上一镜落幅：${previous.lastFrameInfo}` : '',
    previousBlocking ? `上一镜落幅站位：\n${previousBlocking}` : '',
    currentBlocking ? `本镜开场站位目标：\n${currentBlocking}` : '',
  ].filter(Boolean).join('\n');

  return [
    `【火山方舟全能参考多参模式】本镜是同一场景连续剧情，必须以视频1为直接续写源视频；${(referenceVideos?.length ?? 0) > 1 ? `视频2..视频${referenceVideos!.length}` : '其他参考视频'}如存在，只能作为同场景空间母版、人物走位、光影风格和表演节奏参考。不要重新开场，不要重置人物站位，不要改变场景空间母版、机位轴线、角色服装、道具归属和对白秒点。若有动作变化，只能从视频1结尾状态顺滑过渡到本镜动作。`,
    details,
    '【本镜原始视频提示词】',
    prompt,
  ].join('\n\n');
}

function findStoryboardIndexByVideoUrl(storyboards: readonly StoryboardState[], videoUrl: string) {
  const index = storyboards.findIndex((storyboard) => storyboard.videoUrl === videoUrl);
  return index >= 0 ? index : undefined;
}

async function resolveSeedanceSourceVideoBlob(previous: StoryboardState) {
  const videoBlobKey = previous.videoBlobKey;
  if (videoBlobKey) {
    const blob = await blobLimiter.run(() => loadBlob(videoBlobKey));
    if (blob) return { blob, blobKey: videoBlobKey };
  }

  if (previous.videoUrl) {
    const result = await downloadValidatedVideoBlob(previous.videoUrl, { proxyFallback: true });
    if (result.ok && result.blob) return { blob: result.blob, blobKey: videoBlobKey };
    throw new Error(`上一镜视频读取失败：${result.reason ?? '无法下载或校验源视频'}`);
  }

  throw new Error('上一镜没有可用的视频缓存或远程视频地址。');
}

function resolveVolcSourceVideoUrl(previous: StoryboardState) {
  if (previous.videoUrl) return previous.videoUrl;

  throw new Error('火山方舟官方 reference_video 需要上一镜保留远程 video_url；当前只有本地缓存或没有远程地址，不能作为官方参考视频提交。请先用“重新下载结果/恢复结果”拿回远程地址，或重新生成上一镜。');
}

function resolveVolcReferenceVideos(
  storyboards: readonly StoryboardState[],
  currentIndex: number,
  decision: VideoContinuityDecision,
  maxVideos: number,
): VolcReferenceVideoInput[] {
  const sourceIndex = decision.sourceIndex;
  const source = typeof sourceIndex === 'number' ? storyboards[sourceIndex] : undefined;
  if (!source) {
    throw new Error('火山方舟全能参考多参模式缺少直接续写源分镜。');
  }

  const urls: string[] = [resolveVolcSourceVideoUrl(source)];
  const seen = new Set(urls);

  for (let index = currentIndex - 1; index >= decision.groupHeadIndex && urls.length < maxVideos; index -= 1) {
    if (index === sourceIndex) continue;
    const storyboard = storyboards[index];
    if (!storyboard || storyboard.videoStatus !== 'done' || !storyboard.videoUrl) continue;
    if (seen.has(storyboard.videoUrl)) continue;
    seen.add(storyboard.videoUrl);
    urls.push(storyboard.videoUrl);
  }

  return urls.map((url) => ({ url }));
}

function normalizeStoryboardReferenceVideoUrls(storyboard: StoryboardState, maxVideos: number): string[] {
  const urls = storyboard.referenceVideo?.urls ?? [];
  const seen = new Set<string>();
  return urls
    .map((url) => url.trim())
    .filter((url) => /^https?:\/\//i.test(url))
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .slice(0, maxVideos);
}

function mergeVolcReferenceVideos(
  continuityVideos: VolcReferenceVideoInput[] | undefined,
  storyboardReferenceUrls: string[],
  maxVideos: number,
): VolcReferenceVideoInput[] | undefined {
  const merged: VolcReferenceVideoInput[] = [];
  const seen = new Set<string>();
  const pushUrl = (url: string | undefined) => {
    const normalized = url?.trim();
    if (!normalized || seen.has(normalized) || merged.length >= maxVideos) return;
    seen.add(normalized);
    merged.push({ url: normalized });
  };

  continuityVideos?.forEach((item) => pushUrl(item.url));
  storyboardReferenceUrls.forEach(pushUrl);

  return merged.length > 0 ? merged : undefined;
}

function getVolcRemoteReferenceImageUrl(asset: Asset): string | undefined {
  if (asset.source === 'volc_virtual_human') return asset.externalAssetUri;
  if (asset.source !== 'volc_seedream_output') return undefined;
  if (!asset.externalImageUrl) return undefined;
  if (asset.externalImageExpiresAt && asset.externalImageExpiresAt <= Date.now()) return undefined;
  return asset.externalImageUrl;
}

function resolveTask(
  state: AppState,
  projectId: string | undefined,
  task: VideoTask,
): { sb: StoryboardState; project: Project; chapterId: string; chapter: Project['chapters'][number] } | null {
  const hintedProject = projectId ? state.projects.find((p) => p.id === projectId) : undefined;
  const project = hintedProject?.chapters.some((chapter) => chapter.id === task.chapterId)
    ? hintedProject
    : state.projects.find((p) => p.chapters.some((chapter) => chapter.id === task.chapterId));
  if (!project) return null;
  const chapter = project.chapters.find((c) => c.id === task.chapterId);
  if (!chapter) return null;
  const sb = chapter.storyboards[task.storyboardIndex];
  if (!sb) return null;
  return { sb, project, chapterId: task.chapterId, chapter };
}

export function useVideoSubmit(
  videoApiConfig: VideoApiConfig,
  dispatchRef: MutableRefObject<Step5Dispatch>,
  stateRef: MutableRefObject<AppState>,
  projectIdRef: MutableRefObject<string | undefined>,
) {
  const reportSubmitError = useCallback((task: VideoTask, error: string, prompt?: string) => {
    const readableError = formatVideoApiErrorMessage(error) ?? error;
    dispatchRef.current({
      type: 'SET_VIDEO_ERROR',
      index: task.storyboardIndex,
      error: readableError,
      errorDetail: buildErrorDetail(videoApiConfig.backend, { prompt, rawError: error }),
      chapterId: task.chapterId,
    });
  }, [dispatchRef, videoApiConfig.backend]);

  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const taskKey = (task: VideoTask) => `${task.chapterId}-${task.storyboardIndex}`;

  const abortPolling = useCallback((task: VideoTask) => {
    const key = taskKey(task);
    const ctrl = abortControllersRef.current.get(key);
    if (ctrl) {
      ctrl.abort();
      abortControllersRef.current.delete(key);
    }
  }, []);

  const abortAllPolling = useCallback(() => {
    abortControllersRef.current.forEach((ctrl) => ctrl.abort());
    abortControllersRef.current.clear();
  }, []);

  const submitVideoInternal = useCallback(
    async (task: VideoTask, options?: { async?: boolean }): Promise<void> => {
      const resolved = resolveTask(stateRef.current, projectIdRef.current, task);
      if (!resolved) {
        if (import.meta.env.DEV) console.log('[Step5] submitVideo 跳过：无法解析任务', task);
        return;
      }

      const { sb, project, chapterId, chapter } = resolved;
      const directorMode = !!sb && isStoryboardDirectorMode(sb);
      if (!sb || (!sb.prompt?.rawText && !directorMode)) {
        if (import.meta.env.DEV) console.log('[Step5] submitVideo 跳过：当前分镜没有 Prompt', task);
        return;
      }
      if (sb.videoStatus === 'submitting' || sb.videoStatus === 'polling') {
        if (import.meta.env.DEV) console.log(`[Step5] submitVideo 跳过：当前状态=${sb.videoStatus}`, task);
        return;
      }

      const index = task.storyboardIndex;
      const videoConfig = videoApiConfig;
      const volcCapabilities = getVolcVideoModelCapabilities(videoConfig.volcModel);
      const imageReferenceLimit = videoConfig.backend === 'volcengine'
        ? volcCapabilities.maxImages
        : 9;
      const submitDuration = resolveStoryboardVideoDuration(sb, videoConfig.videoDuration);
      const isAsync = options?.async ?? false;
      let abortCtrl: AbortController | null = null;
      let promptForErrorDetail = sb.prompt?.rawText ?? '';
      let sbForSubmit = sb;

      try {
        abortPolling(task);
        abortCtrl = new AbortController();
        abortControllersRef.current.set(taskKey(task), abortCtrl);

        const assetLibrary = project.assetLibrary ?? [];
        const imageRefs = getStoryboardVideoImageRefs(sb);
        const submissionReadiness = getStoryboardVideoSubmissionReadiness({
          storyboard: sbForSubmit,
          analysis: chapter.analysis,
          assetLibrary,
          project,
          videoConfig,
          storyboardIndex: task.storyboardIndex,
          videoRatio: videoConfig.videoRatio,
          imageRefs,
        });
        if (!submissionReadiness.ready) {
          const errorMsg = submissionReadiness.reason ?? '当前分镜还不能提交视频，请先回 Step4 检查最终视频词和参考图。';
          reportSubmitError(task, errorMsg, sbForSubmit.seedanceFinalVideoPrompt ?? sbForSubmit.prompt?.rawText ?? '');
          if (!isAsync) toast.error(errorMsg);
          return;
        }

        sbForSubmit = await ensureCompressedStoryboardBoardForSubmit(sbForSubmit, {
          index,
          chapterId,
          projectId: project.id,
          dispatch: dispatchRef.current,
        });

        const storyboardBoardReference = resolveStoryboardBoardVideoReferenceState(sbForSubmit);
        const resolution = resolveVideoReferenceAssets(
          imageRefs,
          assetLibrary,
          storyboardBoardReference,
          sbForSubmit.scenePositionBoard,
          videoConfig.videoRatio,
          {
            includeScenePositionBoard: false,
            useStoryboardBoardReferencePack: directorMode,
            finalVideoPrompt: sbForSubmit.seedanceFinalVideoPrompt?.trim() || sbForSubmit.prompt?.rawText?.trim(),
            imageReferenceLimit,
          },
        );
        const shouldUseStoryboardBoardReference = storyboardBoardReference.enabled && resolution.storyboardBoardIncluded;
        const hasOfficialVirtualHumanRefs = hasOfficialVirtualHumanVideoReferences(resolution);

        if (storyboardBoardReference.enabled && !storyboardBoardReference.available) {
          const errorMsg = storyboardBoardReference.reason ?? '当前故事板暂不可作为视频参考图。';
          reportSubmitError(task, errorMsg, sbForSubmit.prompt?.rawText ?? '');
          if (!isAsync) toast.error(errorMsg);
          return;
        }

        if (resolution.exceedsLimit) {
          const errorMsg = buildVideoReferenceLimitMessage(resolution.totalRefs, imageReferenceLimit);
          reportSubmitError(task, errorMsg, sbForSubmit.prompt?.rawText ?? '');
          if (!isAsync) toast.error(errorMsg);
          return;
        }

        if (resolution.promptOrder.checked && !resolution.promptOrder.valid) {
          const errorMsg = resolution.promptOrder.message ?? 'Step5 参考图顺序与最终视频词中的【@图片x】编号不一致，请先返回 Step4 刷新最终视频词。';
          reportSubmitError(task, errorMsg, sbForSubmit.seedanceFinalVideoPrompt ?? sbForSubmit.prompt?.rawText ?? '');
          if (!isAsync) toast.error(errorMsg);
          return;
        }

        if (hasOfficialVirtualHumanRefs && !isOfficialVirtualHumanCompatibleVideoBackend(videoConfig.backend)) {
          const errorMsg = getOfficialVirtualHumanIncompatibleMessage(videoConfig.backend);
          reportSubmitError(task, errorMsg, sbForSubmit.prompt?.rawText ?? '');
          if (!isAsync) toast.error(errorMsg);
          return;
        }

        if (resolution.missing.length > 0) {
          const errorMsg = buildMissingVideoReferenceMessage(resolution.missing);
          reportSubmitError(task, errorMsg, sbForSubmit.prompt?.rawText ?? '');
          if (!isAsync) toast.error(errorMsg);
          return;
        }

        const blobs: Blob[] = [];
        const volcReferenceImageUrls: string[] = [];
        const volcReferenceImages: VolcReferenceImageInput[] = [];
        const unreadableRefs: Array<{ refId: string; name: string }> = [];

        for (const item of resolution.effectiveItems) {
          if ('blobKey' in item) {
            const referenceBlob = await blobLimiter.run(() => loadCloudBackedBlob(item.blobKey, project.id));
            if (referenceBlob) {
              blobs.push(referenceBlob);
              volcReferenceImages.push({ blob: referenceBlob });
            } else {
              const errorMsg = '故事板参考图读取失败，请先在 Step4 重新生成后再试。';
              reportSubmitError(task, errorMsg, sbForSubmit.prompt?.rawText ?? '');
              if (!isAsync) toast.error(errorMsg);
              return;
            }
            continue;
          }

          if (item.asset.source === 'volc_virtual_human'
            || (item.asset.source === 'volc_seedream_output' && videoConfig.backend === 'volcengine')) {
            const remoteImageUrl = getVolcRemoteReferenceImageUrl(item.asset);
            if (remoteImageUrl) {
              volcReferenceImageUrls.push(remoteImageUrl);
              volcReferenceImages.push({ url: remoteImageUrl });
            } else {
              unreadableRefs.push({ refId: item.refId, name: item.name });
            }
            continue;
          }

          const blob = (await blobLimiter.run(() => loadPreferredAssetBlob(item.asset, project.id))).blob;
          if (blob) {
            blobs.push(blob);
            volcReferenceImages.push({ blob });
          } else {
            unreadableRefs.push({ refId: item.refId, name: item.name });
          }
        }

        if (unreadableRefs.length > 0) {
          const details = unreadableRefs
            .slice(0, 4)
            .map((ref) => `${ref.refId} ${ref.name}`)
            .join('、');
          const suffix = unreadableRefs.length > 4 ? ' 等' : '';
          const errorMsg = `以下参考图读取失败：${details}${suffix}`;
          reportSubmitError(task, errorMsg, sbForSubmit.prompt?.rawText ?? '');
          if (!isAsync) toast.error(errorMsg);
          return;
        }

        if (blobs.length === 0 && volcReferenceImageUrls.length === 0) {
          const errorMsg = '请先在 Step3 配置参考图片资源。';
          reportSubmitError(task, errorMsg, sbForSubmit.prompt?.rawText ?? '');
          if (!isAsync) toast.error(errorMsg);
          return;
        }

        const rawPrompt = sbForSubmit.prompt?.rawText ?? '';
        const basePrompt = buildEffectiveVideoPrompt(rawPrompt, {
          includeStoryboardBoardReference: !directorMode && shouldUseStoryboardBoardReference,
          storyboardBoardAvailable: storyboardBoardReference.available,
          storyboardBoardReferenceLabel: resolution.storyboardBoardRefId || (`参考图片${resolution.totalRefs}`),
          storyboardBoardModeLabel: storyboardBoardReference.modeLabel,
        });
        const effectivePrompt = buildFinalVideoSubmitPrompt(sbForSubmit, basePrompt, imageRefs, {
          effectiveItems: resolution.effectiveItems,
          omittedItems: resolution.budget.omittedItems,
          videoRatio: videoConfig.videoRatio,
        });
        const promptOverrideState = getVideoSubmitPromptOverrideState(sbForSubmit, effectivePrompt);
        const baseSubmitPrompt = promptOverrideState.isUsable
          ? promptOverrideState.prompt
          : effectivePrompt;
        if (!baseSubmitPrompt.trim()) {
          const errorMsg = 'Step5 视频提示词为空，请先编辑后再提交。';
          reportSubmitError(task, errorMsg, baseSubmitPrompt);
          if (!isAsync) toast.error(errorMsg);
          return;
        }

        const promptLengthValidation = validateStep5VideoPromptMatchesStep4Length(sbForSubmit, baseSubmitPrompt, {
          manualOverride: promptOverrideState.isUsable,
        });
        if (!promptLengthValidation.ok) {
          const errorMsg = promptLengthValidation.reason ?? 'Step5 视频提示词字数与 Step4 不一致，请人工确认后再提交。';
          reportSubmitError(task, errorMsg, baseSubmitPrompt);
          if (!isAsync) toast.error(errorMsg);
          return;
        }

        const promptReferenceBindingValidation = validateVideoPromptReferenceBindings(
          baseSubmitPrompt,
          resolution.effectiveItems,
          imageReferenceLimit,
        );
        if (!promptReferenceBindingValidation.valid) {
          const errorMsg = promptReferenceBindingValidation.message ?? 'Step5 视频提示词里的【@图片x】引用和本次提交参考图不一致，请先修正后再提交。';
          reportSubmitError(task, errorMsg, baseSubmitPrompt);
          if (!isAsync) toast.error(errorMsg);
          return;
        }

        let promptForSubmit = baseSubmitPrompt;
        const continuityDecision = getStoryboardVideoContinuityDecision(chapter.storyboards, index);
        const storyboardReferenceVideoUrls = videoConfig.backend === 'volcengine'
          ? normalizeStoryboardReferenceVideoUrls(sbForSubmit, volcCapabilities.maxVideos)
          : [];
        let extensionOptions: {
          productionMode: 'normal' | 'extend';
          continuityGroupId?: string;
          continuityReason?: string;
          sourceVideoBlob?: Blob;
          sourceVideoUrl?: string;
          referenceVideos?: VolcReferenceVideoInput[];
          referenceAudios?: { url: string }[];
          voiceReferenceAudios?: { blob?: Blob; url?: string; characterName: string; fileName?: string }[];
          sourceTaskId?: string;
          sourceStoryboardIndex?: number;
          sourceBlobKey?: string;
        } = {
          productionMode: 'normal',
          continuityGroupId: continuityDecision.groupId,
          continuityReason: continuityDecision.reason,
        };

        if (
          supportsVideoExtensionBackend(videoConfig.backend)
          && isVideoExtensionEnabled(videoConfig)
          && continuityDecision.mode === 'extend'
        ) {
          const sourceIndex = continuityDecision.sourceIndex;
          const previous = typeof sourceIndex === 'number' ? chapter.storyboards[sourceIndex] : undefined;
          if (!previous || previous.videoStatus !== 'done') {
            const errorMsg = continuityDecision.blockingReason
              ?? `需要先完成${typeof sourceIndex === 'number' ? buildStoryboardLabel(sourceIndex, previous) : '上一镜'}的视频，才能使用同场景视频参考。`;
            reportSubmitError(task, errorMsg, promptForSubmit);
            if (!isAsync) toast.error(errorMsg);
            return;
          }

          try {
            extensionOptions = {
              productionMode: 'extend',
              continuityGroupId: continuityDecision.groupId,
              continuityReason: continuityDecision.reason,
              sourceTaskId: previous.videoTaskId,
              sourceStoryboardIndex: sourceIndex,
            };

            if (isSeedanceServiceBackend(videoConfig.backend)) {
              const source = await resolveSeedanceSourceVideoBlob(previous);
              extensionOptions.sourceVideoBlob = source.blob;
              extensionOptions.sourceBlobKey = source.blobKey;
              promptForSubmit = buildVideoExtensionPrompt(baseSubmitPrompt, continuityDecision, previous, sbForSubmit);
            } else {
              const referenceVideos = resolveVolcReferenceVideos(
                chapter.storyboards,
                index,
                continuityDecision,
                volcCapabilities.maxVideos,
              );
              extensionOptions.sourceVideoUrl = referenceVideos[0]?.url;
              extensionOptions.referenceVideos = referenceVideos;
              extensionOptions.sourceBlobKey = previous.videoBlobKey;
              promptForSubmit = buildVideoExtensionPrompt(baseSubmitPrompt, continuityDecision, previous, sbForSubmit, referenceVideos, chapter.storyboards);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const errorMsg = `同场景视频参考源读取失败：${message}`;
            reportSubmitError(task, errorMsg, baseSubmitPrompt);
            if (!isAsync) toast.error(errorMsg);
            return;
          }
        }

        if (videoConfig.backend === 'volcengine') {
          extensionOptions.referenceVideos = mergeVolcReferenceVideos(
            extensionOptions.referenceVideos,
            storyboardReferenceVideoUrls,
            volcCapabilities.maxVideos,
          );
        }

        const storyboardVoiceReferences: ResolvedStoryboardVoiceReference[] = resolveStoryboardVoiceReferences({
          storyboard: sbForSubmit,
          project,
          videoConfig,
        });

        if (isSeedanceServiceBackend(videoConfig.backend) && storyboardVoiceReferences.length > 0) {
          const voiceReferenceAudios: { blob?: Blob; url?: string; characterName: string; fileName?: string }[] = [];
          for (const voiceReference of storyboardVoiceReferences) {
            if (voiceReference.audioBlobKey) {
              const voiceAudioBlob = await blobLimiter.run(() => loadCloudBackedBlob(voiceReference.audioBlobKey!, project.id));
              if (!voiceAudioBlob) {
                const errorMsg = `${voiceReference.characterName} 的配音参考音频读取失败，请在 Step3 重新上传声线样本后再提交。`;
                reportSubmitError(task, errorMsg, promptForSubmit);
                if (!isAsync) toast.error(errorMsg);
                return;
              }
              voiceReferenceAudios.push({
                blob: voiceAudioBlob,
                characterName: voiceReference.characterName,
                fileName: voiceReference.audioFileName,
              });
              continue;
            }

            const audioUrl = voiceReference.publicAudioUrl?.trim();
            if (!audioUrl) {
              const errorMsg = `${voiceReference.characterName} 的配音参考缺少可提交音频，请在 Step3 重新上传声线样本后再提交。`;
              reportSubmitError(task, errorMsg, promptForSubmit);
              if (!isAsync) toast.error(errorMsg);
              return;
            }
            voiceReferenceAudios.push({
              url: audioUrl,
              characterName: voiceReference.characterName,
              fileName: voiceReference.audioFileName,
            });
          }
          if (voiceReferenceAudios.length > 0) {
            extensionOptions.voiceReferenceAudios = voiceReferenceAudios;
          }
        }

        if (videoConfig.backend === 'volcengine') {
          const roleAudioUrls = storyboardVoiceReferences
            .map((reference) => reference.publicAudioUrl?.trim())
            .filter((url): url is string => !!url);
          const globalAudioUrls = (videoConfig.volcReferenceAudioUrls ?? [])
            .map((url) => url.trim())
            .filter(Boolean);
          const mergedAudioUrls: string[] = [];
          const seenAudioUrls = new Set<string>();
          for (const url of [...roleAudioUrls, ...globalAudioUrls]) {
            if (seenAudioUrls.has(url) || mergedAudioUrls.length >= volcCapabilities.maxAudios) continue;
            seenAudioUrls.add(url);
            mergedAudioUrls.push(url);
          }
          if (mergedAudioUrls.length > 0) {
            extensionOptions.referenceAudios = mergedAudioUrls.map((url) => ({ url }));
          }
        }

        promptForErrorDetail = promptForSubmit;

        if (videoConfig.backend === 'hmapi') {
          const errorMsg = 'HM 官方视频模型已下线，请在视频参数中切换到小云雀或火山方舟后再生成。';
          reportSubmitError(task, errorMsg, baseSubmitPrompt);
          if (!isAsync) toast.error(errorMsg);
          abortControllersRef.current.delete(taskKey(task));
          return;
        }

        if (videoConfig.backend === 'xyqagent') {
          if (!videoConfig.xyqAgentAccessKey?.trim()) {
            const errorMsg = '请先在视频模型设置中填写小云雀 Agent Access Key。';
            reportSubmitError(task, errorMsg, promptForSubmit);
            if (!isAsync) toast.error(errorMsg);
            abortControllersRef.current.delete(taskKey(task));
            return;
          }
          await submitXyqAgentVideo(index, promptForSubmit, blobs, videoConfig, chapterId, dispatchRef, abortCtrl, {
            duration: submitDuration,
          });
          return;
        }

        if (videoConfig.backend === 'aliyunbailian') {
          if (!videoConfig.aliyunApiKey?.trim()) {
            const errorMsg = '请先在 API 设置中填写阿里云百炼 API Key。';
            reportSubmitError(task, errorMsg, promptForSubmit);
            if (!isAsync) toast.error(errorMsg);
            abortControllersRef.current.delete(taskKey(task));
            return;
          }
          try {
            await submitAliyunBailianVideo(index, promptForSubmit, blobs, videoConfig, chapterId, dispatchRef, abortCtrl, {
              duration: submitDuration,
            });
            return;
          } catch (err) {
            if (abortCtrl.signal.aborted) return;
            buildAliyunBailianError(index, promptForSubmit, err, chapterId, dispatchRef.current);
            return;
          }
        }

        if (videoConfig.backend === 'volcengine') {
          if (!videoConfig.volcApiKey) {
            const errorMsg = '请先在 API 配置中设置火山方舟视频模型的 API Key。';
            reportSubmitError(task, errorMsg, promptForSubmit);
            if (!isAsync) toast.error(errorMsg);
            abortControllersRef.current.delete(taskKey(task));
            return;
          }
          try {
            await submitVolcVideo(index, promptForSubmit, blobs, volcReferenceImageUrls, videoConfig, chapterId, dispatchRef, abortCtrl, {
              duration: submitDuration,
              referenceImages: volcReferenceImages,
              ...extensionOptions,
            });
            return;
          } catch (err) {
            if (abortCtrl.signal.aborted) return;
            buildVolcError(index, promptForSubmit, err, chapterId, dispatchRef.current);
            return;
          }
        }

        await submitSeedanceVideo(index, promptForSubmit, blobs, videoConfig, chapterId, dispatchRef, abortCtrl, {
          async: isAsync,
          duration: submitDuration,
          ...extensionOptions,
        });
      } catch (err) {
        if (abortCtrl?.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        const readableMsg = formatVideoApiErrorMessage(msg) ?? msg;
        const latestBackend = stateRef.current.videoApiConfig.backend;
        if (import.meta.env.DEV) {
          console.warn(`[Step5] submitVideo 失败：chapter=${task.chapterId} #${task.storyboardIndex}, error=${msg}`);
        }
        const rawError = getRawVideoApiError(err) ?? msg;
        dispatchRef.current({
          type: 'SET_VIDEO_ERROR',
          index,
          error: readableMsg,
          errorDetail: buildErrorDetail(latestBackend, { prompt: promptForErrorDetail, rawError }),
          chapterId,
        });
      } finally {
        abortControllersRef.current.delete(taskKey(task));
      }
    },
    [videoApiConfig, dispatchRef, stateRef, projectIdRef, abortPolling, reportSubmitError],
  );

  const submitVideo = useCallback(
    (task: VideoTask) => submitVideoInternal(task, { async: false }),
    [submitVideoInternal],
  );

  const submitVideoAsync = useCallback(
    (task: VideoTask) => submitVideoInternal(task, { async: true }),
    [submitVideoInternal],
  );

  const cancelVideoTask = useCallback(
    async (task: VideoTask): Promise<CancelVideoResult> => {
      const resolved = resolveTask(stateRef.current, projectIdRef.current, task);
      if (!resolved) return { success: false, message: '未找到对应的分镜任务。' };

      const { sb } = resolved;
      const config = stateRef.current.videoApiConfig;
      const taskBackend = sb.videoBackend ?? config.backend;
      const taskConfig: VideoApiConfig = {
        ...config,
        backend: taskBackend,
      };

      if (taskBackend !== 'volcengine' && !isSeedanceServiceBackend(taskBackend)) {
        return { success: false, message: '当前视频后端不支持远程取消；只能停止本地等待或重置状态。' };
      }

      abortPolling(task);

      if (sb.videoTaskId?.startsWith('background:')) {
        const jobId = sb.videoTaskId.slice('background:'.length);
        const result = await cancelBackgroundJob(jobId, '用户取消视频后台任务')
          .then(() => ({ success: true, message: '后台视频任务已取消。' }))
          .catch((error) => ({
            success: false,
            message: error instanceof Error ? error.message : '后台视频任务取消失败',
          }));
        if (result.success) {
          dispatchRef.current({ type: 'CLEAR_VIDEO', index: task.storyboardIndex, chapterId: task.chapterId });
        }
        return result;
      }

      if (!sb.videoTaskId || sb.videoTaskId.endsWith('-pending')) {
        dispatchRef.current({ type: 'CLEAR_VIDEO', index: task.storyboardIndex, chapterId: task.chapterId });
        return { success: true, message: '已取消当前提交；如果服务端已经收到任务，请稍后在任务列表确认。' };
      }

      if (isSeedanceServiceBackend(taskBackend)) {
        const result = await cancelSeedanceRemoteTask(taskConfig, sb.videoTaskId);
        if (result.success) {
          dispatchRef.current({ type: 'CLEAR_VIDEO', index: task.storyboardIndex, chapterId: task.chapterId });
        }
        return result;
      }

      const result = await volcCancelTask(taskConfig, sb.videoTaskId);
      if (result.success) {
        dispatchRef.current({ type: 'CLEAR_VIDEO', index: task.storyboardIndex, chapterId: task.chapterId });
      }
      return result;
    },
    [abortPolling, dispatchRef, stateRef, projectIdRef],
  );

  return { submitVideo, submitVideoAsync, abortPolling, abortAllPolling, cancelVideoTask };
}
