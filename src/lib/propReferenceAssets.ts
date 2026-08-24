import type { Asset, PropConsistency } from '@/types';
import { getPropIdentityKey } from '@/lib/propTracking';

function pickLatestAsset(candidates: readonly Asset[]) {
  if (candidates.length === 0) return undefined;
  return candidates.slice().sort((a, b) =>
    (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0),
  )[0];
}

export function findPropReferenceAsset(
  assetLibrary: readonly Asset[] | undefined,
  prop: Pick<PropConsistency, 'trackingId' | 'propName' | 'storyboardRange' | 'holder' | 'appearanceDesc'>,
) {
  const candidates = (assetLibrary ?? []).filter((asset) => asset.type === 'prop');
  const identityKey = getPropIdentityKey(prop);

  return pickLatestAsset(candidates.filter((asset) => !!prop.trackingId && asset.identityKey === prop.trackingId))
    ?? pickLatestAsset(candidates.filter((asset) => asset.identityKey === identityKey))
    ?? pickLatestAsset(candidates.filter((asset) => !asset.identityKey && asset.name === prop.propName))
    ?? pickLatestAsset(candidates.filter((asset) => asset.name === prop.propName));
}
