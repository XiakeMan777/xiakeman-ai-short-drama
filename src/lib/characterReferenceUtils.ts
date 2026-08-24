import type { Asset, CharacterOutfit, ImageReference } from '@/types';

export function getCharacterOutfitVariantKey(outfitSeq: number | undefined) {
  return typeof outfitSeq === 'number' ? `outfit-${outfitSeq}` : undefined;
}

export function getImageRefCharacterVariantKey(
  ref: Pick<ImageReference, 'variantKey' | 'outfitSeq'>,
) {
  return ref.variantKey ?? getCharacterOutfitVariantKey(ref.outfitSeq);
}

export function parseStoryboardRange(range: string): { start: number; end: number } | null {
  const rangeMatch = range.match(/分镜\s*(\d+)\s*[-–—]\s*(\d+)/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    return { start, end };
  }

  const singleMatch = range.match(/分镜\s*(\d+)/);
  if (singleMatch) {
    const point = parseInt(singleMatch[1], 10);
    return { start: point, end: point };
  }

  return null;
}

export function isStoryboardNumberInRange(
  storyboardNumber: number | undefined,
  storyboardRange: string,
) {
  if (storyboardNumber === undefined) return false;
  const parsed = parseStoryboardRange(storyboardRange);
  if (!parsed) return false;
  return storyboardNumber >= parsed.start && storyboardNumber <= parsed.end;
}

function normalizeName(value: string | undefined) {
  return value?.trim() ?? '';
}

export function findStoryboardCharacterOutfit(
  characterName: string,
  storyboardNumber: number | undefined,
  outfitTracking: readonly CharacterOutfit[] | undefined,
) {
  if (storyboardNumber === undefined) return undefined;

  return (outfitTracking ?? [])
    .filter((outfit) => normalizeName(outfit.characterName) === normalizeName(characterName))
    .sort((a, b) => a.outfitSeq - b.outfitSeq)
    .find((outfit) => isStoryboardNumberInRange(storyboardNumber, outfit.storyboardRange));
}

function findCharacterAsset(
  assetLibrary: readonly Asset[],
  matcher: (asset: Asset) => boolean,
) {
  return assetLibrary.find((asset) => asset.type === 'character' && matcher(asset));
}

function findLatestCharacterAsset(
  assetLibrary: readonly Asset[],
  matcher: (asset: Asset) => boolean,
) {
  return assetLibrary
    .filter((asset) => asset.type === 'character' && matcher(asset))
    .slice()
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
}

export function isStoryboardCharacterReferenceConcept(concept: Asset['concept'] | undefined) {
  return concept === 'landscape_turnaround' || concept === 'landscape_outfit_turnaround';
}

export function isCharacterAssetAllowedForImageRef(
  asset: Asset | undefined,
  ref: Pick<ImageReference, 'name' | 'variantKey' | 'outfitSeq'>,
) {
  if (!asset || asset.type !== 'character' || asset.name !== ref.name) return false;
  const variantKey = getImageRefCharacterVariantKey(ref);

  if (variantKey) {
    return asset.concept === 'landscape_outfit_turnaround'
      && (asset.variantKey === variantKey
        || (asset.usedInStoryboards ?? []).includes(getCharacterSlotUsageKey(ref.name, 'landscape_outfit_turnaround', variantKey)));
  }

  return asset.concept === 'landscape_turnaround' && !asset.variantKey;
}

function findBaseCharacterAsset(
  assetLibrary: readonly Asset[],
  characterName: string,
  preferredAssetId?: string,
) {
  const preferred = preferredAssetId
    ? assetLibrary.find((asset) =>
        asset.id === preferredAssetId
        && asset.type === 'character'
        && asset.concept === 'landscape_turnaround'
        && !asset.variantKey,
      )
    : undefined;

  const turnaroundUsageKey = getCharacterSlotUsageKey(characterName, 'landscape_turnaround');

  return findCharacterAsset(
    assetLibrary,
    (asset) => asset.name === characterName
      && asset.concept === 'landscape_turnaround'
      && !asset.variantKey
      && (asset.usedInStoryboards ?? []).includes(turnaroundUsageKey),
  ) ?? findLatestCharacterAsset(
    assetLibrary,
    (asset) => asset.name === characterName && asset.concept === 'landscape_turnaround' && !asset.variantKey,
  ) ?? preferred
    ?? findCharacterAsset(
      assetLibrary,
      (asset) => asset.name === characterName
        && asset.concept === 'landscape_turnaround'
        && !asset.variantKey
        && !!asset.isDefault,
    );
}

function getCharacterSlotUsageKey(
  characterName: string,
  concept: Asset['concept'],
  variantKey?: string,
) {
  return variantKey
    ? `character:${characterName}::${variantKey}::${concept}`
    : `character:${characterName}::${concept}`;
}

function matchesCharacterVariantSlot(
  asset: Asset,
  characterName: string,
  concept: Asset['concept'],
  variantKey?: string,
) {
  if (asset.type !== 'character' || asset.name !== characterName || asset.concept !== concept) {
    return false;
  }
  if (variantKey && asset.variantKey === variantKey) return true;
  const usageKey = getCharacterSlotUsageKey(characterName, concept, variantKey);
  return (asset.usedInStoryboards ?? []).includes(usageKey);
}

export function resolveCharacterReferenceAsset(
  assetLibrary: readonly Asset[],
  ref: Pick<ImageReference, 'name' | 'assetId' | 'variantKey' | 'outfitSeq' | 'assetBindingMode'>,
) {
  const variantKey = getImageRefCharacterVariantKey(ref);
  const byAssetId = ref.assetId
    ? assetLibrary.find((asset) => asset.id === ref.assetId)
    : undefined;

  if (ref.assetBindingMode === 'manual' && isCharacterAssetAllowedForImageRef(byAssetId, ref)) {
    return byAssetId;
  }

  if (variantKey) {
    const variantAsset = findCharacterAsset(
      assetLibrary,
      (asset) => matchesCharacterVariantSlot(asset, ref.name, 'landscape_outfit_turnaround', variantKey),
    );
    if (variantAsset) return variantAsset;
    return undefined;
  }

  return findBaseCharacterAsset(
    assetLibrary,
    ref.name,
    byAssetId?.type === 'character' ? byAssetId.id : undefined,
  );
}

export function resolveCharacterReferenceAssetId(
  assetLibrary: readonly Asset[],
  ref: Pick<ImageReference, 'name' | 'assetId' | 'variantKey' | 'outfitSeq' | 'assetBindingMode'>,
) {
  return resolveCharacterReferenceAsset(assetLibrary, ref)?.id;
}
