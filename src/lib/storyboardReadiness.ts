import {
  getStoryboardBoardSelectedMode,
  getStoryboardBoardVariant,
  isStoryboardBoardStaleBlocking,
} from '@/lib/storyboardBoardState';
import type { ImageReference, StoryboardState } from '@/types';

export function formatImageReferenceLabel(ref: ImageReference): string {
  const typeLabel = ref.type === 'scene' ? '场景' : ref.type === 'character' ? '角色' : '道具';
  const outfitLabel = ref.type === 'character' && typeof ref.outfitSeq === 'number'
    ? ` · 变装${ref.outfitSeq}设定图`
    : ref.type === 'character' && ref.variantKey
      ? ` · ${ref.variantKey}设定图`
      : '';
  return `${typeLabel}「${ref.name}」${outfitLabel}${ref.refId}`;
}

export function getMissingImageReferenceLabels(imageRefs: readonly ImageReference[] | undefined): string[] {
  return (imageRefs ?? [])
    .filter((ref) => !ref.assetId)
    .map(formatImageReferenceLabel);
}

export function hasMissingImageReferences(imageRefs: readonly ImageReference[] | undefined): boolean {
  return getMissingImageReferenceLabels(imageRefs).length > 0;
}

export function isStoryboardDirectorOutputReady(storyboard: StoryboardState): boolean {
  const selectedMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
  const variant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedMode);
  const hasFinalPrompt = storyboard.seedanceFinalVideoPromptStatus === 'done'
    && !!storyboard.seedanceFinalVideoPrompt?.trim();

  return !!variant?.blobKey
    && variant.status === 'done'
    && !isStoryboardBoardStaleBlocking(variant, storyboard.imageRefs)
    && hasFinalPrompt;
}

export function isStoryboardPromptReady(storyboard: StoryboardState): boolean {
  if (storyboard.status !== 'done' || storyboard.isStale || hasMissingImageReferences(storyboard.imageRefs)) {
    return false;
  }

  const outputMode = storyboard.generatedStep4OutputMode ?? storyboard.step4OutputMode ?? 'prompt';
  if (outputMode === 'storyboard-director') {
    return isStoryboardDirectorOutputReady(storyboard);
  }

  return !!storyboard.prompt?.rawText;
}

export function isStoryboardStep4AutoGeneratePending(storyboard: StoryboardState): boolean {
  return !isStoryboardPromptReady(storyboard) && !hasMissingImageReferences(storyboard.imageRefs);
}

export function countStoryboardStep4Ready(storyboards: readonly StoryboardState[] | undefined): number {
  return (storyboards ?? []).filter(isStoryboardPromptReady).length;
}

export function countStoryboardStep4Pending(storyboards: readonly StoryboardState[] | undefined): number {
  return (storyboards ?? []).filter(isStoryboardStep4AutoGeneratePending).length;
}
