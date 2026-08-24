import { getImageRefCharacterVariantKey } from '@/lib/characterReferenceUtils';
import type { Asset, ImageReference, StoryboardInfo } from '@/types';

export function canReuseExistingImageRefBinding(
  existingRef: ImageReference,
  expectedRef: ImageReference,
) {
  if (expectedRef.type !== 'character' || existingRef.type !== 'character') return true;
  const expectedVariantKey = getImageRefCharacterVariantKey(expectedRef);
  const existingVariantKey = getImageRefCharacterVariantKey(existingRef);

  if (expectedVariantKey) {
    return existingVariantKey === expectedVariantKey;
  }

  return !existingVariantKey;
}

export function getSpatialContinuityCharacterNames(
  storyboard: StoryboardInfo,
  refs: ImageReference[] = [],
) {
  return [
    ...(storyboard.characters ?? []),
    ...refs.filter((ref) => ref.type === 'character').map((ref) => ref.name),
  ];
}

export function shouldUseOfficialVirtualHumanGenerateTemplate(
  useVolcVirtualHumans: boolean | undefined,
  refs: readonly ImageReference[],
  assetLibrary: readonly Asset[] | undefined,
) {
  if (!useVolcVirtualHumans) return false;
  const characterNames = new Set(
    refs
      .filter((ref) => ref.type === 'character')
      .map((ref) => ref.name),
  );
  if (characterNames.size === 0) return false;

  return (assetLibrary ?? []).some((asset) => (
    asset.type === 'character'
    && asset.source === 'volc_virtual_human'
    && characterNames.has(asset.name)
  ));
}
