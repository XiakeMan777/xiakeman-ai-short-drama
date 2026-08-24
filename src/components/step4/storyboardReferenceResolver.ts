import type { Asset, ImageReference, ScriptAnalysis, StoryboardState } from '@/types';
import { computeImageRefs } from './storyboardImageRefs';
import type { StoryboardBoardReference } from './storyboardBoardPrompt';
import {
  getImageRefCharacterVariantKey,
  isCharacterAssetAllowedForImageRef,
} from '@/lib/characterReferenceUtils';
import { isNoFaceCharacterReferenceAsset } from './storyboardReferenceReadingContract';

export interface ResolvedStoryboardBoardReference {
  imageRef: StoryboardBoardReference;
  asset: Asset;
}

export interface StoryboardBoardReferenceIssue {
  imageRef: StoryboardBoardReference;
  reason: 'unlinked' | 'asset-missing';
}

function toStoryboardBoardReference(imageRef: ImageReference, asset?: Asset): StoryboardBoardReference {
  return {
    refId: imageRef.refId,
    type: imageRef.type,
    name: imageRef.name,
    concept: asset?.concept,
    assetSource: asset?.source,
    trackingId: imageRef.trackingId,
    assetId: imageRef.assetId,
    variantKey: imageRef.variantKey,
    outfitSeq: imageRef.outfitSeq,
    isNoFaceCharacterVisual: isNoFaceCharacterReferenceAsset(asset),
  };
}

export function findMatchingImageRef(
  refs: ImageReference[],
  target: Pick<ImageReference, 'type' | 'name' | 'trackingId' | 'variantKey' | 'outfitSeq'>,
) {
  return refs.find((ref) =>
    ref.type === target.type
    && (target.type === 'prop'
      ? (target.trackingId || ref.trackingId
        ? ref.trackingId === target.trackingId
        : ref.name === target.name)
      : ref.name === target.name),
  );
}

export function formatStoryboardBoardReferenceLabel(reference: StoryboardBoardReference): string {
  switch (reference.type) {
    case 'scene':
      return `场景 ${reference.name}`;
    case 'character':
      return `角色 ${reference.name}`;
    case 'prop':
      return `道具 ${reference.name}`;
  }
}

function mergeResolvedImageRefs(
  existingRefs: ImageReference[],
  expectedRefs: ImageReference[],
  assetLibrary: Asset[] | undefined,
) {
  const assetMap = new Map((assetLibrary ?? []).map((asset) => [asset.id, asset]));

  return expectedRefs.map((expectedRef) => {
    const existingRef = findMatchingImageRef(existingRefs, expectedRef);
    if (!existingRef) return expectedRef;

    const existingAsset = existingRef.assetId ? assetMap.get(existingRef.assetId) : undefined;
    const shouldKeepManualBinding = shouldKeepManualImageRefBinding(existingRef, expectedRef, existingAsset);
    const canReuseExistingAutoBinding = !!existingAsset
      && !expectedRef.assetId
      && canReuseExistingBindingForExpectedRef(existingRef, expectedRef, existingAsset);

    return {
      ...expectedRef,
      refId: expectedRef.refId,
      fileName: existingRef.fileName || expectedRef.fileName,
      assetId: shouldKeepManualBinding
        ? existingRef.assetId
        : (expectedRef.assetId ?? (canReuseExistingAutoBinding ? existingRef.assetId : undefined)),
      assetBindingMode: shouldKeepManualBinding
        ? 'manual'
        : (expectedRef.assetId ? 'auto' : (canReuseExistingAutoBinding ? existingRef.assetBindingMode : undefined)),
    };
  });
}

function mergeSelectedImageRefs(
  selectedRefs: ImageReference[],
  expectedRefs: ImageReference[],
  assetLibrary: Asset[] | undefined,
) {
  const assetMap = new Map((assetLibrary ?? []).map((asset) => [asset.id, asset]));

  return selectedRefs.map((selectedRef) => {
    const expectedRef = findMatchingImageRef(expectedRefs, selectedRef);
    if (!expectedRef) return selectedRef;

    const selectedAsset = selectedRef.assetId ? assetMap.get(selectedRef.assetId) : undefined;
    const shouldKeepManualBinding = shouldKeepManualImageRefBinding(selectedRef, expectedRef, selectedAsset);
    const canReuseSelectedAutoBinding = !!selectedAsset
      && !expectedRef.assetId
      && canReuseExistingBindingForExpectedRef(selectedRef, expectedRef, selectedAsset);

    return {
      ...expectedRef,
      refId: selectedRef.refId,
      fileName: selectedRef.fileName || expectedRef.fileName,
      assetId: shouldKeepManualBinding
        ? selectedRef.assetId
        : (expectedRef.assetId ?? (canReuseSelectedAutoBinding ? selectedRef.assetId : undefined)),
      assetBindingMode: shouldKeepManualBinding
        ? 'manual'
        : (expectedRef.assetId ? 'auto' : (canReuseSelectedAutoBinding ? selectedRef.assetBindingMode : undefined)),
    };
  });
}

function canReuseExistingBindingForExpectedRef(
  existingRef: ImageReference,
  expectedRef: ImageReference,
  existingAsset?: Asset,
) {
  if (expectedRef.type !== 'character' || existingRef.type !== 'character') return true;
  if (!isCharacterAssetAllowedForImageRef(existingAsset, expectedRef)) return false;
  const expectedVariantKey = getImageRefCharacterVariantKey(expectedRef);
  const existingVariantKey = getImageRefCharacterVariantKey(existingRef);

  if (expectedVariantKey) {
    return existingVariantKey === expectedVariantKey;
  }

  return !existingVariantKey;
}

function shouldKeepManualImageRefBinding(
  existingRef: ImageReference,
  expectedRef: ImageReference,
  existingAsset: Asset | undefined,
) {
  if (existingRef.assetBindingMode !== 'manual' || !existingAsset) return false;
  if (existingRef.type === 'scene' && expectedRef.type === 'scene' && expectedRef.assetId && existingRef.assetId !== expectedRef.assetId) {
    return false;
  }
  if (existingRef.type === 'character' && expectedRef.type === 'character') {
    return isCharacterAssetAllowedForImageRef(existingAsset, expectedRef);
  }
  return true;
}

export function resolveStoryboardImageRefs(
  storyboardState: StoryboardState,
  analysis: ScriptAnalysis | null | undefined,
  assetLibrary: Asset[] | undefined,
  storyboardIndex: number,
  frameRatio?: string,
): ImageReference[] {
  const expectedRefs = computeImageRefs(
    storyboardState.storyboard,
    analysis?.scenes ?? [],
    assetLibrary,
    analysis?.propTracking,
    storyboardIndex,
    false,
    analysis?.outfitTracking,
    analysis?.characterProfiles,
    frameRatio,
  );

  if ((storyboardState.imageRefs ?? []).length === 0) {
    return expectedRefs;
  }

  if (storyboardState.videoImageBudget?.compressed) {
    return mergeSelectedImageRefs(storyboardState.imageRefs, expectedRefs, assetLibrary);
  }

  return mergeResolvedImageRefs(storyboardState.imageRefs, expectedRefs, assetLibrary);
}

export function resolveStoryboardBoardReferences(
  imageRefs: ImageReference[],
  assetLibrary: Asset[] | undefined,
): {
  resolvedReferences: ResolvedStoryboardBoardReference[];
  missingReferences: StoryboardBoardReferenceIssue[];
} {
  const assetMap = new Map((assetLibrary ?? []).map((asset) => [asset.id, asset]));
  const seenAssetIds = new Set<string>();
  const resolvedReferences: ResolvedStoryboardBoardReference[] = [];
  const missingReferences: StoryboardBoardReferenceIssue[] = [];

  imageRefs.forEach((imageRef) => {
    const boardReference = toStoryboardBoardReference(imageRef);

    if (!imageRef.assetId) {
      missingReferences.push({ imageRef: boardReference, reason: 'unlinked' });
      return;
    }

    const asset = assetMap.get(imageRef.assetId);
    if (!asset) {
      missingReferences.push({ imageRef: boardReference, reason: 'asset-missing' });
      return;
    }

    if (imageRef.type === 'character' && !isCharacterAssetAllowedForImageRef(asset, imageRef)) {
      missingReferences.push({ imageRef: boardReference, reason: 'asset-missing' });
      return;
    }

    if (seenAssetIds.has(asset.id)) {
      return;
    }

    seenAssetIds.add(asset.id);
    resolvedReferences.push({ imageRef: toStoryboardBoardReference(imageRef, asset), asset });
  });

  return {
    resolvedReferences,
    missingReferences,
  };
}
