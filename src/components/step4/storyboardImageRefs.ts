import type { Asset, CharacterOutfit, ImageReference, PropConsistency, SceneInfo, ScriptAnalysis } from '@/types';
import {
  findStoryboardCharacterOutfit,
  getCharacterOutfitVariantKey,
  resolveCharacterReferenceAssetId,
} from '@/lib/characterReferenceUtils';
import { isBaseOutfitSeq, shouldCreateOutfitVariantSlot } from '@/lib/characterAssetGuards';
import { shouldFoldPropIntoCharacterSetting } from '@/lib/characterExclusiveProps';
import { sanitizeStoryboardCharacters } from '@/lib/storyboardCharacterSanitizer';
import { normalizeFrameRatio } from '@/lib/frameRatio';
import { getStoryboardNumbersFromRange } from '@/lib/propTracking';
import { findPropReferenceAsset } from '@/lib/propReferenceAssets';

function sceneNameSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.includes(b)) return b.length / a.length;
  if (b.includes(a)) return a.length / b.length;
  let common = 0;
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i += 1) {
    if (a[i] === b[i]) common += 1;
    else break;
  }
  return common / Math.max(a.length, b.length);
}

function pickLatestAsset(candidates: readonly Asset[]) {
  if (candidates.length === 0) return undefined;
  return candidates.slice().sort((a, b) =>
    (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0),
  )[0];
}

function findSceneReferenceAsset(
  assetLibrary: Asset[] | undefined,
  sceneName: string,
  frameRatio?: string,
) {
  const candidates = (assetLibrary ?? []).filter(
    (asset) => asset.type === 'scene' && asset.name === sceneName,
  );
  const targetFrameRatio = normalizeFrameRatio(frameRatio);
  const preferredConcept = targetFrameRatio === '16:9' ? 'scene_main' : 'scene_vertical';
  const fallbackConcept = targetFrameRatio === '16:9' ? 'scene_vertical' : 'scene_main';
  return pickLatestAsset(candidates.filter((asset) => asset.concept === preferredConcept))
    ?? pickLatestAsset(candidates.filter((asset) => asset.concept === fallbackConcept))
    ?? pickLatestAsset(candidates);
}

function isPropInStoryboardRange(prop: PropConsistency, storyboardNumber: number) {
  const storyboardNumbers = getStoryboardNumbersFromRange(prop.storyboardRange);
  return storyboardNumbers.length === 0 || storyboardNumbers.includes(storyboardNumber);
}

function shouldIncludePropReference(
  prop: PropConsistency,
  storyboardCharacters: readonly string[],
  propAsset: Asset | undefined,
) {
  const hasStandaloneAsset = !!propAsset;
  const explicitlyNeedsImage = prop.needsImage === true;
  if (prop.needsTracking === false && !explicitlyNeedsImage && !hasStandaloneAsset) return false;
  if (shouldFoldPropIntoCharacterSetting(prop, storyboardCharacters) && !explicitlyNeedsImage && !hasStandaloneAsset) return false;
  return explicitlyNeedsImage || hasStandaloneAsset;
}

export function computeImageRefs(
  storyboard: { number?: number; characters: string[]; scene?: string },
  scenes: SceneInfo[],
  assetLibrary?: Asset[],
  propTracking?: PropConsistency[],
  storyboardIndex?: number,
  allowSceneInference = true,
  outfitTracking?: CharacterOutfit[],
  characterProfiles?: ScriptAnalysis['characterProfiles'],
  frameRatio?: string,
): ImageReference[] {
  const refs: ImageReference[] = [];
  const assetCharacterNames = (assetLibrary ?? [])
    .filter((asset) => asset.type === 'character')
    .map((asset) => asset.name);
  const analysisCharacterNames = [
    ...(characterProfiles ?? []).map((profile) => profile.name),
    ...(outfitTracking ?? []).map((outfit) => outfit.characterName),
  ];
  const storyboardCharacters = sanitizeStoryboardCharacters(storyboard.characters, {
    allowedNames: [...assetCharacterNames, ...analysisCharacterNames],
  });
  const resolvedStoryboardNumber = typeof storyboard.number === 'number'
    ? storyboard.number
    : (storyboardIndex !== undefined ? storyboardIndex + 1 : undefined);

  let matchedScene: SceneInfo | null = null;
  if (storyboard.scene) {
    matchedScene = scenes.find((scene) => scene.name === storyboard.scene) ?? null;
    if (!matchedScene && scenes.length > 0) {
      const scored = scenes
        .filter((scene) => storyboard.scene!.includes(scene.name) || scene.name.includes(storyboard.scene!))
        .map((scene) => ({ scene, score: sceneNameSimilarity(storyboard.scene!, scene.name) }))
        .sort((a, b) => b.score - a.score);
      matchedScene = scored.length > 0 ? scored[0].scene : null;
    }
  }

  if (!matchedScene && storyboard.scene && scenes.length > 0 && allowSceneInference) {
    matchedScene = scenes.reduce<SceneInfo | null>((best, scene) => {
      if (!best) return scene;
      const bestOverlap = storyboardCharacters.filter((character) => best.characters?.includes(character)).length;
      const sceneOverlap = storyboardCharacters.filter((character) => scene.characters?.includes(character)).length;
      return sceneOverlap > bestOverlap ? scene : best;
    }, null);
  }

  if (matchedScene) {
    const sceneAsset = findSceneReferenceAsset(assetLibrary, matchedScene.name, frameRatio);
    refs.push({
      refId: '(图片1)',
      type: 'scene',
      name: matchedScene.name,
      fileName: `${matchedScene.name}.jpg`,
      assetId: sceneAsset?.id,
      assetBindingMode: sceneAsset ? 'auto' : undefined,
    });
  }

  if (storyboardCharacters.length > 0) {
    storyboardCharacters.forEach((characterName, index) => {
      const matchedOutfit = findStoryboardCharacterOutfit(
        characterName,
        resolvedStoryboardNumber,
        outfitTracking,
      );
      const baseDescription = getCharacterBaseDescription(characterName, characterProfiles);
      const shouldUseOutfitVariant = !!matchedOutfit?.needsNewImage
        && (!isBaseOutfitSeq(matchedOutfit.outfitSeq) || shouldCreateOutfitVariantSlot(matchedOutfit, baseDescription));
      const variantKey = shouldUseOutfitVariant
        ? getCharacterOutfitVariantKey(matchedOutfit.outfitSeq)
        : undefined;
      const assetId = resolveCharacterReferenceAssetId(assetLibrary ?? [], {
        name: characterName,
        variantKey,
        outfitSeq: variantKey ? matchedOutfit?.outfitSeq : undefined,
      });

      refs.push({
        refId: `(图片${index + 2})`,
        type: 'character',
        name: characterName,
        fileName: `${characterName}.jpg`,
        assetId,
        variantKey,
        outfitSeq: variantKey ? matchedOutfit?.outfitSeq : undefined,
        assetBindingMode: assetId ? 'auto' : undefined,
      });
    });
  }

  if (propTracking && propTracking.length > 0 && resolvedStoryboardNumber !== undefined) {
    const storyboardNumber = resolvedStoryboardNumber;
    const characterCount = storyboardCharacters.length;
    let propIndex = 0;
    for (const prop of propTracking) {
      const propAsset = findPropReferenceAsset(assetLibrary, prop);
      if (!shouldIncludePropReference(prop, storyboardCharacters, propAsset)) continue;
      if (!isPropInStoryboardRange(prop, storyboardNumber)) continue;
      const imageNumber = 1 + 1 + characterCount + propIndex;
      refs.push({
        refId: `(图片${imageNumber})`,
        type: 'prop',
        name: prop.propName,
        fileName: `${prop.propName}.jpg`,
        trackingId: prop.trackingId,
        assetId: propAsset?.id,
        assetBindingMode: propAsset ? 'auto' : undefined,
      });
      propIndex += 1;
    }
  }

  return refs;
}

function getCharacterBaseDescription(
  characterName: string,
  characterProfiles: ScriptAnalysis['characterProfiles'] | undefined,
) {
  const profile = characterProfiles?.find((entry) => entry.name.trim() === characterName.trim());
  return [
    profile?.defaultOutfit,
    profile?.step3Description,
  ].filter(Boolean).join('; ');
}
