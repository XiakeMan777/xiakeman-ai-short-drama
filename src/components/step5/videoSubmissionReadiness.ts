import type {
  Asset,
  ImageReference,
  Project,
  ScriptAnalysis,
  StoryboardBoardMode,
  StoryboardBoardPlan,
  StoryboardState,
  VideoApiConfig,
} from '@/types';
import { isStoryboardPromptReady } from '@/lib/storyboardReadiness';
import {
  buildSeedanceFinalPromptSourceSnapshot,
  getSeedanceFinalVideoPromptState,
  type SeedanceFinalPromptReference,
} from '@/components/step4/seedanceFinalPrompt';
import { resolveStoryboardBoardReferences } from '@/components/step4/storyboardReferenceResolver';
import { sortStoryboardBoardReferencesByPlanPriority } from '@/components/step4/storyboardBoardPrompt';
import {
  getStoryboardBoardSelectedMode,
  getStoryboardBoardVariant,
} from '@/lib/storyboardBoardState';
import {
  buildMissingVideoReferenceMessage,
  buildVideoReferenceLimitMessage,
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
  resolveStoryboardVoiceReferences,
  type ResolvedStoryboardVoiceReference,
} from '@/lib/characterVoiceReferences';
import { getStoryboardVideoImageRefs } from './videoImageRefs';

export const SEEDANCE_FINAL_PROMPT_MISSING_MESSAGE =
  'Seedance 最终视频提示词未生成，请先回 Step4 生成。';
export const SEEDANCE_FINAL_PROMPT_REFERENCE_MISMATCH_MESSAGE =
  'Seedance 最终视频提示词引用了不存在的参考图片编号';
export const SEEDANCE_DIRECTOR_BOARD_MISSING_MESSAGE =
  'Step4 主导演板没有进入本次 Seedance 参考图，请先刷新详细故事板或减少参考图数量。';

export interface VideoSubmissionReadinessInput {
  storyboard: StoryboardState;
  analysis?: ScriptAnalysis | null;
  assetLibrary?: Asset[];
  project?: Pick<Project, 'characterVoiceReferences'> | null;
  videoConfig?: Pick<VideoApiConfig, 'backend' | 'characterVoiceReferencesEnabled'>;
  storyboardIndex: number;
  videoRatio: string;
  imageRefs?: ImageReference[];
}

export interface VideoSubmissionReadiness {
  ready: boolean;
  reason: string | null;
}

export interface SeedanceFinalPromptSubmissionContext {
  mode: StoryboardBoardMode;
  frameRatio: string;
  boardPlan?: StoryboardBoardPlan;
  imageRefs: ImageReference[];
  references: SeedanceFinalPromptReference[];
  voiceReferences: ResolvedStoryboardVoiceReference[];
  sourceSnapshot: string;
  finalPromptState: ReturnType<typeof getSeedanceFinalVideoPromptState>;
}

function resolveSubmissionImageRefs({
  storyboard,
  imageRefs,
}: VideoSubmissionReadinessInput) {
  return imageRefs ?? getStoryboardVideoImageRefs(storyboard);
}

function buildSeedancePromptReferences(
  imageRefs: readonly ImageReference[],
  assetLibrary: readonly Asset[] | undefined,
  boardPlan: StoryboardBoardPlan | undefined,
): SeedanceFinalPromptReference[] {
  if (assetLibrary?.length) {
    const { resolvedReferences } = resolveStoryboardBoardReferences([...imageRefs], [...assetLibrary]);
    if (resolvedReferences.length > 0) {
      const orderedReferences = sortStoryboardBoardReferencesByPlanPriority(
        resolvedReferences.map(({ imageRef }) => imageRef),
        boardPlan,
      );
      const resolvedByRefId = new Map(resolvedReferences.map((reference) => [reference.imageRef.refId, reference]));
      return orderedReferences.map((orderedReference) => {
        const resolved = resolvedByRefId.get(orderedReference.refId);
        const imageRef = resolved?.imageRef ?? orderedReference;
        const asset = resolved?.asset;
        return {
        refId: imageRef.refId,
        type: imageRef.type,
        name: imageRef.name,
        assetId: asset?.id ?? imageRef.assetId,
        trackingId: imageRef.trackingId,
        variantKey: imageRef.variantKey,
        outfitSeq: imageRef.outfitSeq,
        concept: imageRef.concept,
        assetSource: asset?.source,
        isNoFaceCharacterVisual: imageRef.isNoFaceCharacterVisual,
        };
      });
    }
  }

  return sortStoryboardBoardReferencesByPlanPriority([...imageRefs], boardPlan).map((reference) => ({
    refId: reference.refId,
    type: reference.type,
    name: reference.name,
    assetId: reference.assetId,
    trackingId: reference.trackingId,
    variantKey: reference.variantKey,
    outfitSeq: reference.outfitSeq,
  }));
}

export function buildSeedanceFinalPromptSubmissionContext(
  input: VideoSubmissionReadinessInput,
): SeedanceFinalPromptSubmissionContext {
  const {
    storyboard,
    assetLibrary,
    videoRatio,
  } = input;
  const mode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
  const selectedVariant = getStoryboardBoardVariant(storyboard.storyboardBoard, mode);
  const imageRefs = resolveSubmissionImageRefs(input);
  const references = buildSeedancePromptReferences(imageRefs, assetLibrary, selectedVariant?.plan);
  const voiceReferences = input.videoConfig
    ? resolveStoryboardVoiceReferences({
        storyboard,
        project: input.project,
        videoConfig: input.videoConfig,
      })
    : [];
  const sourceSnapshot = buildSeedanceFinalPromptSourceSnapshot({
    storyboard,
    boardPlan: selectedVariant?.plan,
    references,
    voiceReferences,
    mode,
    frameRatio: videoRatio,
  });

  return {
    mode,
    frameRatio: videoRatio,
    boardPlan: selectedVariant?.plan,
    imageRefs,
    references,
    voiceReferences,
    sourceSnapshot,
    finalPromptState: getSeedanceFinalVideoPromptState(storyboard, sourceSnapshot),
  };
}

function extractPromptImageNumbers(prompt: string) {
  const numbers = new Set<number>();
  const pattern = /(?:参考\s*)?@?\s*(?:图片|图)\s*(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(prompt))) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > 0) numbers.add(value);
  }
  return Array.from(numbers).sort((left, right) => left - right);
}

function buildPromptReferenceMismatchReason(prompt: string, availableCount: number) {
  const invalidNumbers = extractPromptImageNumbers(prompt).filter((value) => value > availableCount);
  if (invalidNumbers.length === 0) return null;
  const labels = invalidNumbers.slice(0, 4).map((value) => `图片${value}`).join('、');
  return `${SEEDANCE_FINAL_PROMPT_REFERENCE_MISMATCH_MESSAGE}：${labels}；当前实际提交参考图只有 ${availableCount} 张。`;
}

export function getStoryboardVideoSubmissionReadiness(input: VideoSubmissionReadinessInput): VideoSubmissionReadiness {
  const {
    storyboard,
    analysis,
    assetLibrary,
    storyboardIndex,
    videoRatio,
  } = input;

  if (!isStoryboardPromptReady(storyboard)) {
    return { ready: false, reason: '请先完成 Step4 提示词或详细故事板。' };
  }

  if (!isStoryboardDirectorMode(storyboard)) {
    return { ready: true, reason: null };
  }

  const submitImageRefs = resolveSubmissionImageRefs(input);
  const context = buildSeedanceFinalPromptSubmissionContext({
    storyboard,
    analysis,
    assetLibrary,
    storyboardIndex,
    videoRatio,
    imageRefs: submitImageRefs,
  });
  const finalPromptState = context.finalPromptState;
  const step4Prompt = finalPromptState.prompt || storyboard.prompt?.rawText?.trim() || '';

  if (!assetLibrary) {
    if (!step4Prompt) {
      return { ready: false, reason: SEEDANCE_FINAL_PROMPT_MISSING_MESSAGE };
    }
    return { ready: true, reason: null };
  }

  const storyboardBoardReference = resolveStoryboardBoardVideoReferenceState(storyboard);
  if (storyboardBoardReference.enabled && !storyboardBoardReference.available) {
    return {
      ready: false,
      reason: storyboardBoardReference.reason ?? SEEDANCE_DIRECTOR_BOARD_MISSING_MESSAGE,
    };
  }

  const resolution = resolveVideoReferenceAssets(
    submitImageRefs,
    assetLibrary,
    storyboardBoardReference,
    storyboard.scenePositionBoard,
    videoRatio,
    {
      includeScenePositionBoard: false,
      useStoryboardBoardReferencePack: true,
      finalVideoPrompt: step4Prompt,
    },
  );

  if (resolution.promptOrder.checked && !resolution.promptOrder.valid) {
    return {
      ready: false,
      reason: resolution.promptOrder.message ?? 'Step5 参考图顺序与最终视频词中的【@图片x】编号不一致，请先返回 Step4 刷新最终视频词。',
    };
  }

  if (resolution.exceedsLimit) {
    return { ready: false, reason: buildVideoReferenceLimitMessage(resolution.totalRefs) };
  }

  if (resolution.missing.length > 0) {
    return { ready: false, reason: buildMissingVideoReferenceMessage(resolution.missing) };
  }

  if (storyboardBoardReference.required && !resolution.storyboardBoardIncluded) {
    return { ready: false, reason: SEEDANCE_DIRECTOR_BOARD_MISSING_MESSAGE };
  }

  if (!step4Prompt) {
    return { ready: false, reason: SEEDANCE_FINAL_PROMPT_MISSING_MESSAGE };
  }

  const includeStoryboardBoardInPrompt = storyboardBoardReference.enabled && resolution.storyboardBoardIncluded;
  const basePrompt = buildEffectiveVideoPrompt(storyboard.prompt?.rawText ?? '', {
    includeStoryboardBoardReference: !isStoryboardDirectorMode(storyboard) && includeStoryboardBoardInPrompt,
    storyboardBoardAvailable: includeStoryboardBoardInPrompt,
    storyboardBoardReferenceLabel: resolution.storyboardBoardRefId || (`参考图片${resolution.totalRefs}`),
    storyboardBoardModeLabel: storyboardBoardReference.modeLabel,
  });
  const autoStep5Prompt = buildFinalVideoSubmitPrompt(storyboard, basePrompt, submitImageRefs, {
    effectiveItems: resolution.effectiveItems,
    omittedItems: resolution.budget.omittedItems,
    videoRatio,
  });
  const promptOverrideState = getVideoSubmitPromptOverrideState(storyboard, autoStep5Prompt);
  const step5Prompt = promptOverrideState.isUsable ? promptOverrideState.prompt : autoStep5Prompt;

  if (!step5Prompt.trim()) {
    return { ready: false, reason: 'Step5 视频提示词为空，请先编辑后再提交。' };
  }

  const promptLengthValidation = validateStep5VideoPromptMatchesStep4Length(storyboard, step5Prompt, {
    manualOverride: promptOverrideState.isUsable,
  });
  if (!promptLengthValidation.ok) {
    return { ready: false, reason: promptLengthValidation.reason ?? 'Step5 视频提示词字数与 Step4 不一致，请人工确认后再提交。' };
  }

  const promptReferenceBindingValidation = validateVideoPromptReferenceBindings(step5Prompt, resolution.effectiveItems);
  if (!promptReferenceBindingValidation.valid) {
    return {
      ready: false,
      reason: promptReferenceBindingValidation.message ?? 'Step5 视频提示词里的【@图片x】引用和本次提交参考图不一致，请先修正后再提交。',
    };
  }

  const mismatchReason = buildPromptReferenceMismatchReason(
    step5Prompt,
    resolution.effectiveItems.length,
  );
  if (mismatchReason) {
    return { ready: false, reason: mismatchReason };
  }

  return { ready: true, reason: null };
}
