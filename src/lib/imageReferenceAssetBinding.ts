import type { Asset, ImageReference } from '@/types';
import {
  isCharacterAssetAllowedForImageRef,
  resolveCharacterReferenceAssetId,
} from '@/lib/characterReferenceUtils';
import { normalizeFrameRatio } from '@/lib/frameRatio';

function normalizeAssetName(value: string | undefined) {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function findLatestAsset(
  assetLibrary: readonly Asset[] | undefined,
  matcher: (asset: Asset) => boolean,
) {
  return (assetLibrary ?? [])
    .map((asset, index) => ({ asset, index }))
    .filter(({ asset }) => matcher(asset))
    .sort((a, b) => (
      (b.asset.updatedAt ?? b.asset.createdAt ?? 0) - (a.asset.updatedAt ?? a.asset.createdAt ?? 0)
      || b.index - a.index
    ))[0]?.asset;
}

function resolveSceneReferenceAssetId(
  assetLibrary: readonly Asset[] | undefined,
  ref: Pick<ImageReference, 'name'>,
  frameRatio?: string,
) {
  const refName = normalizeAssetName(ref.name);
  const targetFrameRatio = normalizeFrameRatio(frameRatio);
  const preferredConcept = targetFrameRatio === '16:9' ? 'scene_main' : 'scene_vertical';
  const fallbackConcept = targetFrameRatio === '16:9' ? 'scene_vertical' : 'scene_main';
  return findLatestAsset(
    assetLibrary,
    (asset) =>
      asset.type === 'scene'
      && asset.concept === preferredConcept
      && normalizeAssetName(asset.name) === refName,
  )?.id ?? findLatestAsset(
    assetLibrary,
    (asset) =>
      asset.type === 'scene'
      && asset.concept === fallbackConcept
      && normalizeAssetName(asset.name) === refName,
  )?.id ?? findLatestAsset(
    assetLibrary,
    (asset) => asset.type === 'scene' && normalizeAssetName(asset.name) === refName,
  )?.id;
}

function resolvePropReferenceAssetId(
  assetLibrary: readonly Asset[] | undefined,
  ref: Pick<ImageReference, 'name' | 'trackingId'>,
) {
  const refName = normalizeAssetName(ref.name);
  return findLatestAsset(
    assetLibrary,
    (asset) =>
      asset.type === 'prop'
      && asset.concept === 'prop_main'
      && !!ref.trackingId
      && asset.identityKey === ref.trackingId,
  )?.id ?? findLatestAsset(
    assetLibrary,
    (asset) =>
      asset.type === 'prop'
      && asset.concept === 'prop_main'
      && !asset.identityKey
      && normalizeAssetName(asset.name) === refName,
  )?.id ?? findLatestAsset(
    assetLibrary,
    (asset) => asset.type === 'prop' && normalizeAssetName(asset.name) === refName,
  )?.id;
}

export function resolveImageReferenceAssetId(
  assetLibrary: readonly Asset[] | undefined,
  ref: ImageReference,
  frameRatio?: string,
) {
  if (ref.assetBindingMode === 'manual') {
    return ref.assetId;
  }

  switch (ref.type) {
    case 'scene':
      return resolveSceneReferenceAssetId(assetLibrary, ref, frameRatio);
    case 'character':
      return resolveCharacterReferenceAssetId(assetLibrary ?? [], ref);
    case 'prop':
      return resolvePropReferenceAssetId(assetLibrary, ref);
  }
}

export function relinkMissingImageReferenceAssets(
  imageRefs: readonly ImageReference[] | undefined,
  assetLibrary: readonly Asset[] | undefined,
): { imageRefs: ImageReference[]; changed: boolean } {
  const assets = assetLibrary ?? [];
  let changed = false;

  const nextRefs = (imageRefs ?? []).map((ref) => {
    const linkedAsset = ref.assetId
      ? assets.find((asset) => asset.id === ref.assetId)
      : undefined;

    if (ref.assetBindingMode === 'manual') {
      if (ref.type !== 'character' || isCharacterAssetAllowedForImageRef(linkedAsset, ref)) {
        return ref;
      }
    }

    if (linkedAsset && (ref.type !== 'character' || isCharacterAssetAllowedForImageRef(linkedAsset, ref))) {
      return ref;
    }

    const assetId = resolveImageReferenceAssetId(assets, ref);
    if (!assetId || assetId === ref.assetId) {
      return ref;
    }

    changed = true;
    return {
      ...ref,
      assetId,
      assetBindingMode: 'auto' as const,
    };
  });

  return { imageRefs: nextRefs, changed };
}
