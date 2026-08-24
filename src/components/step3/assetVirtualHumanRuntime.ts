import type { VolcVirtualHuman } from '@/lib/volcVirtualHumanCatalog';
import type { Asset, CharacterProfile } from '@/types';
import { type AssetItem, genId } from './assetUtils';
import { isOfficialVirtualHumanSlot } from './assetManagerRules';
import type { VirtualHumanBatchMatchInput } from './virtualHumanMatcher';

export function buildVirtualHumanAsset(item: AssetItem, person: VolcVirtualHuman, now = Date.now()): Asset {
  return {
    id: genId(),
    name: item.name,
    type: 'character',
    concept: item.concept,
    description: `官方虚拟人像：${person.name}。${person.bio}`,
    source: 'volc_virtual_human',
    externalAssetId: person.assetId,
    externalAssetUri: person.uri,
    thumbnailUrl: person.thumbnailUrl,
    catalogTags: person.tags,
    identityKey: item.identityKey,
    variantKey: item.variantKey,
    outfitSeq: item.outfitSeq,
    optimizedPrompt: '',
    generationMode: 'upload',
    blobKey: `external:${person.assetId}`,
    aspectRatio: item.aspectRatio,
    imageSize: item.imageSize,
    isDefault: true,
    usedInStoryboards: [item.key],
    createdAt: now,
    updatedAt: now,
  };
}

export function getPendingVirtualHumanItems(items: Record<string, AssetItem>, enabled: boolean) {
  if (!enabled) return [];
  return Object.values(items).filter((item) => (
    isOfficialVirtualHumanSlot(item, true)
    && item.asset?.source !== 'volc_virtual_human'
  ));
}

export function countPendingVirtualHumanItems(items: readonly AssetItem[], enabled: boolean) {
  if (!enabled) return 0;
  return items.filter((item) => (
    isOfficialVirtualHumanSlot(item, true)
    && item.asset?.source !== 'volc_virtual_human'
  )).length;
}

export function getReservedVirtualHumanAssetIds(assetLibrary: readonly Asset[]) {
  return assetLibrary
    .filter((asset) => (
      asset.source === 'volc_virtual_human'
      && asset.externalAssetId
      && (asset.usedInStoryboards?.length ?? 0) > 0
    ))
    .map((asset) => asset.externalAssetId as string);
}

export function findVirtualHumanProfile(
  name: string,
  analysisProfiles: readonly CharacterProfile[] | undefined,
  projectProfiles: readonly CharacterProfile[] | undefined,
) {
  return analysisProfiles?.find((profile) => profile.name === name)
    ?? projectProfiles?.find((profile) => profile.name === name);
}

export function buildVirtualHumanMatchInputs(
  items: readonly AssetItem[],
  getProfile: (name: string) => CharacterProfile | undefined,
  getContext: (item: AssetItem) => string | undefined,
): VirtualHumanBatchMatchInput[] {
  return items.map((item) => ({
    key: item.key,
    characterName: item.name,
    profile: getProfile(item.name),
    context: getContext(item),
  }));
}
