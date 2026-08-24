import type { ImageConcept } from '@/types';
import { CHARACTER_IMAGE_CONCEPTS as CHAR_CONCEPTS, SCENE_IMAGE_CONCEPTS } from '@/types';
import {
  type AssetItem,
  getSourceConcept,
  getSourceVariantKey,
  makeItemKey,
} from './assetUtils';

export type SectionAutoType = 'character' | 'scene' | 'prop';
export interface BatchSelectionOptions {
  includeOutfitVariants?: boolean;
}

export function getBatchOptimizeTargets(
  items: Record<string, AssetItem>,
  options: BatchSelectionOptions = {},
) {
  return Object.values(items).filter(
    (item) =>
      !item.asset
      && !item.isProcessing
      && item.generationMode !== 'upload'
      && isBatchOptimizableSlot(item, options)
  );
}

export function getBatchGenerationTasks(
  items: Record<string, AssetItem>,
  options: BatchSelectionOptions = {},
) {
  const generatableItems = Object.values(items).filter(
    (item) =>
      item.generationMode !== 'upload'
      && !item.asset
      && !item.isProcessing
      && isBatchGeneratableSlot(item, options)
  );

  return generatableItems
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compareGenerationTasks(a.item, b.item) || a.index - b.index)
    .map(({ item }) => item);
}

export function getSectionAutoOptimizeTargets(
  section: SectionAutoType,
  items: Record<string, AssetItem>,
  options: BatchSelectionOptions = {},
) {
  return getBatchOptimizeTargets(items, options).filter((item) => item.type === section);
}

export function resolveGenerationItem(
  item: AssetItem,
  items: Record<string, AssetItem>,
): { item: AssetItem; error?: string } {
  const currentItem = items[item.key] ?? item;
  if (!hasSourceDependency(currentItem)) {
    return { item: currentItem };
  }

  const sourceConcept = getSourceConcept(currentItem.concept);
  if (!sourceConcept) return { item: currentItem };

  const baseKey = makeItemKey(
    currentItem.type,
    currentItem.name,
    sourceConcept,
    currentItem.type === 'prop' ? currentItem.identityKey : undefined,
    getSourceVariantKey(currentItem.concept, currentItem.variantKey),
  );
  const baseItem = items[baseKey];
  if (!baseItem?.asset) {
    return { item: currentItem, error: `请先生成${getSourceConceptLabel(sourceConcept)}，此图将基于它图生图` };
  }

  return {
    item: {
      ...currentItem,
      baseAssetId: baseItem.asset.id,
      generationMode: 'img2img',
    },
  };
}

export function shouldDeferGenerationTask(
  item: AssetItem,
  items: Record<string, AssetItem>,
  pendingKeys: Set<string>,
  inFlightKeys: Set<string>,
) {
  const currentItem = items[item.key] ?? item;
  if (!hasSourceDependency(currentItem)) return false;

  const sourceConcept = getSourceConcept(currentItem.concept);
  if (!sourceConcept) return false;

  const sourceKey = makeItemKey(
    currentItem.type,
    currentItem.name,
    sourceConcept,
    currentItem.type === 'prop' ? currentItem.identityKey : undefined,
    getSourceVariantKey(currentItem.concept, currentItem.variantKey),
  );
  if (items[sourceKey]?.asset) return false;

  return pendingKeys.has(sourceKey) || inFlightKeys.has(sourceKey);
}

export function linkGeneratedCharacterBase(
  items: Record<string, AssetItem>,
  charName: string,
  baseAssetId: string,
  sourceConcept: ImageConcept,
  sourceVariantKey?: string,
) {
  const updated = { ...items };

  for (const key of Object.keys(updated)) {
    const item = updated[key];
    if (item.name !== charName || item.type !== 'character') continue;

    if (sourceConcept === 'portrait_closeup' && (item.concept === 'landscape_turnaround' || item.concept === 'portrait_outfit')) {
      updated[key] = linkBaseAsset(item, baseAssetId);
    }
    if (
      sourceConcept === 'portrait_outfit'
      && item.concept === 'landscape_outfit_turnaround'
      && item.variantKey === sourceVariantKey
    ) {
      updated[key] = linkBaseAsset(item, baseAssetId);
    }
  }

  return updated;
}

function compareGenerationTasks(a: AssetItem, b: AssetItem) {
  const waveDiff = getGenerationWave(a) - getGenerationWave(b);
  if (waveDiff !== 0) return waveDiff;

  if (a.type === 'character' && b.type === 'character') {
    const conceptOrderDiff = getCharacterConceptOrder(a) - getCharacterConceptOrder(b);
    if (conceptOrderDiff !== 0) return conceptOrderDiff;
    return (a.outfitSeq ?? 0) - (b.outfitSeq ?? 0);
  }

  if (a.type === 'scene' && b.type === 'scene') {
    return getSceneConceptOrder(a) - getSceneConceptOrder(b);
  }

  return 0;
}

function getGenerationWave(item: AssetItem) {
  if (item.type === 'character') {
    switch (item.concept) {
      case 'portrait_closeup':
        return 10;
      case 'landscape_turnaround':
        return 30;
      case 'portrait_outfit':
        return 50;
      case 'landscape_outfit_turnaround':
        return 60;
      default:
        return 90;
    }
  }

  if (item.type === 'scene') {
    return item.concept === 'scene_main' ? 20 : 21;
  }

  if (item.type === 'prop') {
    return 40;
  }

  return 90;
}

function getCharacterConceptOrder(item: AssetItem) {
  const index = CHAR_CONCEPTS.findIndex((config) => config.concept === item.concept);
  return index >= 0 ? index : 99;
}

function getSceneConceptOrder(item: AssetItem) {
  const index = SCENE_IMAGE_CONCEPTS.findIndex((config) => config.concept === item.concept);
  return index >= 0 ? index : 99;
}

function hasSourceDependency(item: AssetItem) {
  return !!getSourceConcept(item.concept);
}

function isBatchOptimizableSlot(item: AssetItem, options: BatchSelectionOptions) {
  if (item.type !== 'character') return true;
  return isBatchCharacterConcept(item.concept, options);
}

function isBatchGeneratableSlot(item: AssetItem, options: BatchSelectionOptions) {
  if (item.type !== 'character') return true;
  return isBatchCharacterConcept(item.concept, options);
}

function isBatchCharacterConcept(concept: ImageConcept, options: BatchSelectionOptions) {
  if (concept === 'portrait_closeup' || concept === 'landscape_turnaround') return true;
  if (!options.includeOutfitVariants) return false;
  return concept === 'portrait_outfit' || concept === 'landscape_outfit_turnaround';
}

function getSourceConceptLabel(sourceConcept: ImageConcept) {
  if (sourceConcept === 'portrait_closeup') return '标准正面定妆照';
  if (sourceConcept === 'portrait_outfit') return '变装定妆照';
  return '源图';
}

function linkBaseAsset(item: AssetItem, baseAssetId: string): AssetItem {
  return {
    ...item,
    baseAssetId,
    generationMode: item.generationMode === 'upload' ? item.generationMode : 'img2img',
  };
}
