import type {
  Asset,
  CharacterOutfit,
  ImageConcept,
  ImageReference,
  PropConsistency,
  ScriptAnalysis,
  StoryboardState,
} from '@/types';
import {
  CHARACTER_IMAGE_CONCEPTS as CHAR_CONCEPTS,
  SCENE_IMAGE_CONCEPTS as SCENE_CONCEPTS,
  PROP_IMAGE_CONCEPT as PROP_CONCEPT,
} from '@/types';
import {
  shouldCreateOutfitVariantSlot,
  shouldUseVisualCharacterName,
} from '@/lib/characterAssetGuards';
import { shouldFoldPropIntoCharacterSetting } from '@/lib/characterExclusiveProps';
import { inferCharacterGenderHint } from '@/lib/characterIdentityHints';
import { isNonHumanSystemCharacterText } from '@/lib/nonHumanCharacterVisual';
import { findPropReferenceAsset } from '@/lib/propReferenceAssets';
import { sanitizeStoryboardCharacters } from '@/lib/storyboardCharacterSanitizer';
import { getPropIdentityKey } from '@/lib/propTracking';
import { computeImageRefs } from '@/components/step4/storyboardImageRefs';
import {
  type AspectRatio,
  type AssetItem,
  type GenerationMode,
  buildTurnaroundPromptInit,
  getCharacterOutfitVariantKey,
  getCharacterOutfitVariantLabel,
  getSourceConcept,
  getSourceVariantKey,
  isTurnaroundConcept,
  makeItemKey,
} from './assetUtils';

export type ImageRefSourceStoryboard = Pick<StoryboardState, 'imageRefs'>;
type StoryboardCharacterSource = {
  storyboard?: Pick<StoryboardState['storyboard'], 'number' | 'characters' | 'scene'>;
};

type CharacterSlot = {
  concept: ImageConcept;
  aspectRatio: AspectRatio;
  variantKey?: string;
  variantLabel?: string;
  outfitSeq?: number;
  allowLegacyVariantFallback?: boolean;
};

const CORE_CHARACTER_CONCEPTS: ImageConcept[] = ['portrait_closeup', 'landscape_turnaround'];

function buildStoryboardRefMaps(storyboards: readonly ImageRefSourceStoryboard[] | undefined) {
  const assetIdMap = new Map<string, string>();
  const refIdMap = new Map<string, string>();

  for (const storyboard of storyboards ?? []) {
    for (const ref of storyboard.imageRefs ?? []) {
      const key = getImageRefMapKey(ref);
      if (ref.assetId && !assetIdMap.has(key)) {
        assetIdMap.set(key, ref.assetId);
      }
      if (ref.refId && !refIdMap.has(key)) {
        refIdMap.set(key, ref.refId);
      }
    }
  }

  return { assetIdMap, refIdMap };
}

function normalizeName(value: string | undefined) {
  return value?.trim() ?? '';
}

function getCharacterImageRefVariantMapKey(
  ref: Pick<ImageReference, 'variantKey' | 'outfitSeq'>,
) {
  const explicitVariant = normalizeName(ref.variantKey);
  if (explicitVariant) return explicitVariant;
  return Number.isFinite(ref.outfitSeq)
    ? getCharacterOutfitVariantKey(ref.outfitSeq)
    : '';
}

export function getImageRefMapKey(
  ref: Pick<ImageReference, 'type' | 'name' | 'trackingId' | 'variantKey' | 'outfitSeq'>,
) {
  if (ref.type === 'prop' && ref.trackingId) return `prop:${ref.trackingId}`;
  if (ref.type === 'character') {
    const variantKey = getCharacterImageRefVariantMapKey(ref);
    return variantKey ? `character:${ref.name}:${variantKey}` : `character:${ref.name}`;
  }
  return `${ref.type}:${ref.name}`;
}

function getCharacterNames(
  analysis: Pick<ScriptAnalysis, 'allCharacterNames' | 'characterProfiles'>,
  allowedEventLikeNames: ReadonlySet<string> = new Set(),
) {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const profile of analysis.characterProfiles ?? []) {
    const name = normalizeName(profile.name);
    if (!name || seen.has(name) || (!allowedEventLikeNames.has(name) && !shouldUseVisualCharacterName(name))) continue;
    seen.add(name);
    names.push(name);
  }

  for (const name of analysis.allCharacterNames ?? []) {
    const normalizedName = normalizeName(name);
    if (!normalizedName || seen.has(normalizedName) || (!allowedEventLikeNames.has(normalizedName) && !shouldUseVisualCharacterName(normalizedName))) continue;
    seen.add(normalizedName);
    names.push(normalizedName);
  }

  return names;
}

export function buildAllImageRefs(
  analysis: Pick<ScriptAnalysis, 'scenes' | 'allCharacterNames' | 'characterProfiles' | 'propTracking' | 'outfitTracking'> | null | undefined,
  storyboards: readonly (ImageRefSourceStoryboard & StoryboardCharacterSource)[] | undefined,
  assetLibrary: readonly Asset[] = [],
): ImageReference[] {
  if (!analysis) return [];

  const { assetIdMap, refIdMap } = buildStoryboardRefMaps(storyboards);
  const acceptedAssetCharacterNames = new Set(
    assetLibrary
      .filter((asset) => asset.type === 'character')
      .map((asset) => normalizeName(asset.name))
      .filter(Boolean),
  );
  const result: ImageReference[] = [];
  const seenKeys = new Set<string>();

  const addImageRef = (ref: ImageReference) => {
    const key = getImageRefMapKey(ref);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    result.push(ref);
  };

  for (const scene of analysis.scenes ?? []) {
    const key = `scene:${scene.name}`;
    addImageRef({
      refId: refIdMap.get(key) ?? `【场景_${scene.name}】`,
      type: 'scene',
      name: scene.name,
      fileName: `${scene.name}.jpg`,
      assetId: assetIdMap.get(key),
    });
  }

  const characterNames = getCharacterNames(analysis, acceptedAssetCharacterNames);
  for (const charName of characterNames) {
    const key = `character:${charName}`;
    addImageRef({
      refId: refIdMap.get(key) ?? `【角色_${charName}】`,
      type: 'character',
      name: charName,
      fileName: `${charName}.jpg`,
      assetId: assetIdMap.get(key),
    });
  }

  for (const prop of analysis.propTracking ?? []) {
    const propAsset = findPropReferenceAsset(assetLibrary, prop);
    if (!shouldCreatePropRef(prop, characterNames, !!propAsset)) continue;
    const trackingId = getPropIdentityKey(prop);
    const key = `prop:${trackingId}`;
    addImageRef({
      refId: refIdMap.get(key) ?? `【道具_${trackingId}】`,
      type: 'prop',
      name: prop.propName,
      fileName: `${prop.propName}.jpg`,
      trackingId,
      assetId: assetIdMap.get(key) ?? propAsset?.id,
    });
  }

  for (const [storyboardIndex, storyboard] of (storyboards ?? []).entries()) {
    if (storyboard.storyboard) {
      for (const ref of computeImageRefs(
        storyboard.storyboard,
        analysis.scenes ?? [],
        [...assetLibrary],
        analysis.propTracking,
        storyboardIndex,
        false,
        analysis.outfitTracking,
        analysis.characterProfiles,
      )) {
        addImageRef({
          ...ref,
          fileName: ref.fileName || `${ref.name}.jpg`,
        });
      }
    }

    for (const characterName of sanitizeStoryboardCharacters(storyboard.storyboard?.characters, { allowedNames: acceptedAssetCharacterNames })) {
      const key = `character:${characterName}`;
      addImageRef({
        refId: refIdMap.get(key) ?? `【角色_${characterName}】`,
        type: 'character',
        name: characterName,
        fileName: `${characterName}.jpg`,
        assetId: assetIdMap.get(key),
      });
    }

    for (const ref of storyboard.imageRefs ?? []) {
      const name = normalizeName(ref.name);
      if (!name) continue;
      if (ref.type === 'character' && !acceptedAssetCharacterNames.has(name) && !shouldUseVisualCharacterName(name)) continue;
      addImageRef({
        ...ref,
        name,
        fileName: ref.fileName || `${name}.jpg`,
      });
    }
  }

  return result;
}

export function partitionImageRefs(imageRefs: readonly ImageReference[]) {
  return {
    characters: imageRefs.filter((ref) => ref.type === 'character'),
    scenes: imageRefs.filter((ref) => ref.type === 'scene'),
    props: imageRefs.filter((ref) => ref.type === 'prop'),
  };
}

export function buildAssetItems({
  previousItems,
  allImageRefs,
  assetLibrary,
  styleConfig,
  analysis,
  allowOfficialVirtualHumanAssets = true,
  officialNoFaceCharacterVisuals = false,
}: {
  previousItems: Record<string, AssetItem>;
  allImageRefs: readonly ImageReference[];
  assetLibrary: readonly Asset[];
  styleConfig?: string;
  analysis?: Pick<ScriptAnalysis, 'outfitTracking' | 'characterProfiles'> | null;
  allowOfficialVirtualHumanAssets?: boolean;
  officialNoFaceCharacterVisuals?: boolean;
}): Record<string, AssetItem> {
  const nextItems: Record<string, AssetItem> = {};
  const bindableAssetLibrary = allowOfficialVirtualHumanAssets
    ? assetLibrary
    : assetLibrary.filter((asset) => !isOfficialVirtualHumanAsset(asset));

  for (const imageRef of allImageRefs) {
    for (const slot of getConceptSlots(imageRef, analysis)) {
      const key = makeItemKey(
        imageRef.type,
        imageRef.name,
        slot.concept,
        imageRef.trackingId,
        slot.variantKey,
      );
      const existingItem = normalizeExistingItemForOfficialMode(
        previousItems[key],
        allowOfficialVirtualHumanAssets,
      );
      const existingAsset = shouldPreventAutoAssetBinding(existingItem)
        ? undefined
        : findSlotAsset(bindableAssetLibrary, imageRef, slot, key);
      const { autoBaseAssetId, autoGenerationMode } = getAutoBaseForSlot(
        bindableAssetLibrary,
        imageRef,
        slot,
        existingAsset,
        previousItems,
      );
      const autoTurnaroundPrompt = getAutoTurnaroundPrompt(
        slot.concept,
        imageRef.name,
        styleConfig,
        existingAsset,
        existingItem,
      );

      nextItems[key] = existingItem
        ? mergeExistingItem(
            existingItem,
            imageRef,
            slot,
            existingAsset,
            autoBaseAssetId,
            autoGenerationMode,
            autoTurnaroundPrompt,
            bindableAssetLibrary,
            shouldForceTextToImageForOfficialNoFaceSlot(imageRef, slot, officialNoFaceCharacterVisuals),
          )
        : createNewItem(
            imageRef,
            slot,
            existingAsset,
            autoBaseAssetId,
            autoGenerationMode,
            autoTurnaroundPrompt,
            key,
            bindableAssetLibrary,
            shouldForceTextToImageForOfficialNoFaceSlot(imageRef, slot, officialNoFaceCharacterVisuals),
          );
    }
  }

  return nextItems;
}

function isOfficialVirtualHumanAsset(asset: Pick<Asset, 'source'> | undefined) {
  return asset?.source === 'volc_virtual_human';
}

function normalizeExistingItemForOfficialMode(
  existingItem: AssetItem | undefined,
  allowOfficialVirtualHumanAssets: boolean,
) {
  if (!existingItem || allowOfficialVirtualHumanAssets || !isOfficialVirtualHumanAsset(existingItem.asset)) {
    return existingItem;
  }

  return {
    ...existingItem,
    asset: undefined,
    baseAssetId: undefined,
    generationMode: existingItem.generationMode === 'upload' ? 'txt2img' : existingItem.generationMode,
    optimizedPrompt: '',
    localBlobUrl: undefined,
    error: undefined,
  };
}

function shouldForceTextToImageForOfficialNoFaceSlot(
  imageRef: ImageReference,
  slot: CharacterSlot,
  enabled: boolean,
) {
  return enabled && imageRef.type === 'character' && getSourceConcept(slot.concept) === 'portrait_closeup';
}

function shouldCreatePropRef(prop: PropConsistency, characterNames: readonly string[] = [], hasStandaloneAsset = false) {
  const explicitlyNeedsImage = prop.needsImage === true;
  if (prop.needsTracking === false && !explicitlyNeedsImage && !hasStandaloneAsset) return false;
  if (shouldFoldPropIntoCharacterSetting(prop, characterNames) && !explicitlyNeedsImage && !hasStandaloneAsset) return false;
  return explicitlyNeedsImage || hasStandaloneAsset;
}

function getConceptSlots(
  imageRef: ImageReference,
  analysis: Pick<ScriptAnalysis, 'outfitTracking' | 'characterProfiles'> | null | undefined,
): CharacterSlot[] {
  if (imageRef.type === 'character') {
    return getCharacterConceptSlots(imageRef.name, analysis);
  }
  if (imageRef.type === 'prop') {
    return [{ concept: PROP_CONCEPT.concept, aspectRatio: PROP_CONCEPT.aspectRatio }];
  }
  return SCENE_CONCEPTS.map((config) => ({ concept: config.concept, aspectRatio: config.aspectRatio }));
}

function getCharacterConceptSlots(
  characterName: string,
  analysis: Pick<ScriptAnalysis, 'outfitTracking' | 'characterProfiles'> | null | undefined,
): CharacterSlot[] {
  const baseSlots = CHAR_CONCEPTS
    .filter((config) => CORE_CHARACTER_CONCEPTS.includes(config.concept))
    .map((config) => ({ concept: config.concept, aspectRatio: config.aspectRatio }));

  const profile = analysis?.characterProfiles?.find(
    (entry) => normalizeName(entry.name) === normalizeName(characterName),
  );
  const baseDescription = [
    profile?.defaultOutfit,
    profile?.step3Description,
  ].filter(Boolean).join('；');
  const derivedOutfits = dedupeCharacterOutfits(
    (analysis?.outfitTracking ?? []).filter(
      (outfit) => normalizeName(outfit.characterName) === normalizeName(characterName)
        && shouldCreateOutfitVariantSlot(outfit, baseDescription),
    ),
  );

  if (derivedOutfits.length === 0) {
    return baseSlots;
  }

  const allowLegacyVariantFallback = derivedOutfits.length === 1;
  const portraitOutfit = CHAR_CONCEPTS.find((config) => config.concept === 'portrait_outfit');
  const outfitTurnaround = CHAR_CONCEPTS.find((config) => config.concept === 'landscape_outfit_turnaround');
  if (!portraitOutfit || !outfitTurnaround) {
    return baseSlots;
  }

  const outfitSlots = derivedOutfits.flatMap((outfit) => {
    const variantKey = getCharacterOutfitVariantKey(outfit.outfitSeq);
    const variantLabel = getCharacterOutfitVariantLabel(outfit.outfitSeq);
    return [
      {
        concept: portraitOutfit.concept,
        aspectRatio: portraitOutfit.aspectRatio,
        variantKey,
        variantLabel,
        outfitSeq: outfit.outfitSeq,
        allowLegacyVariantFallback,
      },
      {
        concept: outfitTurnaround.concept,
        aspectRatio: outfitTurnaround.aspectRatio,
        variantKey,
        variantLabel,
        outfitSeq: outfit.outfitSeq,
        allowLegacyVariantFallback,
      },
    ];
  });

  return [...baseSlots, ...outfitSlots];
}

function dedupeCharacterOutfits(outfits: readonly CharacterOutfit[]) {
  const outfitMap = new Map<number, CharacterOutfit>();

  for (const outfit of outfits) {
    if (!Number.isFinite(outfit.outfitSeq)) continue;
    if (!outfitMap.has(outfit.outfitSeq)) {
      outfitMap.set(outfit.outfitSeq, outfit);
    }
  }

  return [...outfitMap.values()].sort((a, b) => a.outfitSeq - b.outfitSeq);
}

function findSlotAsset(
  assetLibrary: readonly Asset[],
  imageRef: ImageReference,
  slot: CharacterSlot,
  slotKey: string,
) {
  return pickLatestAsset(assetLibrary.filter((asset) => asset.usedInStoryboards?.includes(slotKey)))
    ?? pickLatestAsset(assetLibrary.filter((asset) => matchesAssetSlot(asset, imageRef, slot)))
    ?? (imageRef.assetId
      ? assetLibrary.find((asset) => asset.id === imageRef.assetId && asset.concept === slot.concept)
      : undefined);
}

function pickLatestAsset(candidates: readonly Asset[]) {
  if (candidates.length === 0) return undefined;
  return candidates.slice().sort((a, b) =>
    (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0),
  )[0];
}

function matchesAssetSlot(asset: Asset, imageRef: ImageReference, slot: CharacterSlot) {
  if (asset.type !== imageRef.type || asset.concept !== slot.concept) return false;

  if (imageRef.type === 'prop') {
    return asset.identityKey === imageRef.trackingId;
  }

  if (imageRef.type === 'character') {
    return asset.name === imageRef.name && matchesCharacterVariant(asset.variantKey, slot);
  }

  return asset.name === imageRef.name;
}

function matchesCharacterVariant(assetVariantKey: string | undefined, slot: CharacterSlot) {
  if (slot.variantKey) {
    return assetVariantKey === slot.variantKey || (slot.allowLegacyVariantFallback && !assetVariantKey);
  }
  return !assetVariantKey;
}

function getAutoBaseForSlot(
  assetLibrary: readonly Asset[],
  imageRef: ImageReference,
  slot: CharacterSlot,
  existingAsset: Asset | undefined,
  previousItems: Record<string, AssetItem>,
) {
  const sourceConcept = imageRef.type === 'character'
    ? getSourceConcept(slot.concept)
    : null;
  let autoBaseAssetId: string | undefined;
  let autoGenerationMode: GenerationMode = existingAsset?.generationMode ?? 'txt2img';

  if (sourceConcept && imageRef.type === 'character') {
    const sourceVariantKey = getSourceVariantKey(slot.concept, slot.variantKey);
    const sourceKey = makeItemKey('character', imageRef.name, sourceConcept, undefined, sourceVariantKey);
    const sourceSlotItem = previousItems[sourceKey];
    const sourceAsset = shouldPreventAutoAssetBinding(sourceSlotItem)
      ? undefined
      : findSourceAssetForSlot(assetLibrary, imageRef, sourceConcept, sourceVariantKey, slot, sourceKey, sourceSlotItem);
    if (sourceAsset && sourceAsset.source !== 'volc_virtual_human') {
      autoBaseAssetId = sourceAsset.id;
    }
    autoGenerationMode = sourceAsset?.source === 'volc_virtual_human' ? 'txt2img' : 'img2img';
  }

  return { autoBaseAssetId, autoGenerationMode };
}

function findSourceAssetForSlot(
  assetLibrary: readonly Asset[],
  imageRef: ImageReference,
  sourceConcept: ImageConcept,
  sourceVariantKey: string | undefined,
  slot: CharacterSlot,
  sourceKey: string,
  sourceSlotItem: AssetItem | undefined,
) {
  const usageMatched = pickLatestAsset(assetLibrary.filter((asset) =>
    matchesCharacterSourceAsset(asset, imageRef, sourceConcept, sourceVariantKey, slot)
    && (asset.usedInStoryboards ?? []).includes(sourceKey),
  ));
  if (usageMatched) return usageMatched;

  const selectedSourceAsset = sourceSlotItem?.asset
    ? assetLibrary.find((asset) => asset.id === sourceSlotItem.asset?.id)
    : undefined;
  if (selectedSourceAsset && matchesCharacterSourceAsset(selectedSourceAsset, imageRef, sourceConcept, sourceVariantKey, slot)) {
    return selectedSourceAsset;
  }

  return pickLatestAsset(assetLibrary.filter((asset) =>
    matchesCharacterSourceAsset(asset, imageRef, sourceConcept, sourceVariantKey, slot),
  ));
}

function matchesCharacterSourceAsset(
  asset: Asset,
  imageRef: ImageReference,
  sourceConcept: ImageConcept,
  sourceVariantKey: string | undefined,
  slot: CharacterSlot,
) {
  return asset.type === 'character'
    && asset.name === imageRef.name
    && asset.concept === sourceConcept
    && (sourceVariantKey
      ? asset.variantKey === sourceVariantKey || (slot.allowLegacyVariantFallback && !asset.variantKey)
      : !asset.variantKey);
}

function getAutoTurnaroundPrompt(
  concept: ImageConcept,
  name: string,
  styleConfig: string | undefined,
  existingAsset: Asset | undefined,
  existingItem: AssetItem | undefined,
) {
  if (!isTurnaroundConcept(concept) || existingAsset?.optimizedPrompt || existingItem?.optimizedPrompt) {
    return undefined;
  }
  const genderHint = inferCharacterGenderHint(
    name,
    existingAsset?.description,
  );
  const nonHumanSystem = isNonHumanSystemCharacterText([
    name,
    existingAsset?.description,
  ].filter(Boolean).join('\n'));
  return buildTurnaroundPromptInit(concept, name, styleConfig, undefined, genderHint, nonHumanSystem);
}

function mergeExistingItem(
  existingItem: AssetItem,
  imageRef: ImageReference,
  slot: CharacterSlot,
  existingAsset: Asset | undefined,
  autoBaseAssetId: string | undefined,
  autoGenerationMode: GenerationMode,
  autoTurnaroundPrompt: string | undefined,
  assetLibrary: readonly Asset[],
  forceTextToImageWhenBaseMissing = false,
): AssetItem {
  const blobChanged = !!existingItem.asset?.blobKey
    && !!existingAsset?.blobKey
    && existingItem.asset.blobKey !== existingAsset.blobKey;
  let baseAssetId = resolveAvailableBaseAssetId(
    assetLibrary,
    autoBaseAssetId,
    existingItem.baseAssetId,
    existingAsset?.baseAssetId,
  );
  let generationMode: GenerationMode = existingItem.generationMode !== 'upload'
    ? (existingItem.generationMode === 'txt2img' && autoGenerationMode === 'img2img'
        ? 'img2img'
        : existingItem.generationMode)
    : 'upload';

  if (forceTextToImageWhenBaseMissing) {
    baseAssetId = undefined;
    if (generationMode === 'img2img') generationMode = 'txt2img';
  }
  if (imageRef.type === 'scene') {
    baseAssetId = undefined;
    generationMode = generationMode === 'upload' ? 'upload' : 'txt2img';
  }

  return {
    ...existingItem,
    identityKey: imageRef.trackingId,
    variantKey: slot.variantKey,
    variantLabel: slot.variantLabel,
    outfitSeq: slot.outfitSeq,
    name: imageRef.name,
    asset: existingAsset ?? existingItem.asset,
    baseAssetId,
    generationMode,
    optimizedPrompt: existingItem.optimizedPrompt || autoTurnaroundPrompt || existingItem.optimizedPrompt,
    imageSize: existingAsset?.imageSize ?? existingItem.imageSize ?? (isTurnaroundConcept(slot.concept) ? '2K' : undefined),
    localBlobUrl: blobChanged ? undefined : existingItem.localBlobUrl,
    preventAutoAssetBinding: existingItem.preventAutoAssetBinding,
  };
}

function createNewItem(
  imageRef: ImageReference,
  slot: CharacterSlot,
  existingAsset: Asset | undefined,
  autoBaseAssetId: string | undefined,
  autoGenerationMode: GenerationMode,
  autoTurnaroundPrompt: string | undefined,
  key: string,
  assetLibrary: readonly Asset[],
  forceTextToImageWhenBaseMissing = false,
): AssetItem {
  let baseAssetId = resolveAvailableBaseAssetId(
    assetLibrary,
    autoBaseAssetId,
    existingAsset?.baseAssetId,
  );
  let generationMode = existingAsset?.generationMode ?? autoGenerationMode;
  if (forceTextToImageWhenBaseMissing) {
    baseAssetId = undefined;
    if (generationMode === 'img2img') generationMode = 'txt2img';
  }
  if (imageRef.type === 'scene') {
    baseAssetId = undefined;
    generationMode = generationMode === 'upload' ? 'upload' : 'txt2img';
  }

  return {
    key,
    refId: imageRef.refId,
    identityKey: imageRef.trackingId,
    variantKey: slot.variantKey,
    variantLabel: slot.variantLabel,
    outfitSeq: slot.outfitSeq,
    concept: slot.concept,
    type: imageRef.type,
    name: imageRef.name,
    asset: existingAsset,
    optimizedPrompt: existingAsset?.optimizedPrompt ?? autoTurnaroundPrompt ?? '',
    generationMode,
    baseAssetId,
    aspectRatio: existingAsset?.aspectRatio ?? slot.aspectRatio,
    imageSize: existingAsset?.imageSize ?? (isTurnaroundConcept(slot.concept) ? '2K' : undefined),
    isProcessing: false,
    error: undefined,
    localBlobUrl: undefined,
    preventAutoAssetBinding: false,
  };
}

function shouldPreventAutoAssetBinding(item: AssetItem | undefined) {
  return !!item?.preventAutoAssetBinding && !item.asset;
}

function resolveAvailableBaseAssetId(
  assetLibrary: readonly Asset[],
  ...candidateIds: Array<string | undefined>
) {
  for (const candidateId of candidateIds) {
    if (candidateId && assetLibrary.some((asset) => asset.id === candidateId && asset.source !== 'volc_virtual_human')) {
      return candidateId;
    }
  }
  return undefined;
}
