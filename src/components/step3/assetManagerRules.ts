import type {
  Asset,
  CharacterOutfit,
  ImageConcept,
} from '@/types';
import {
  CHARACTER_IMAGE_CONCEPTS as CHAR_CONCEPTS,
  SCENE_IMAGE_CONCEPTS as SCENE_CONCEPTS,
  PROP_IMAGE_CONCEPT as PROP_CONCEPT,
} from '@/types';
import { hasHumanCharacterSheetConflict, isNonHumanSystemCharacterText } from '@/lib/nonHumanCharacterVisual';
import {
  type AssetItem,
  getSourceConcept,
  getSourceVariantKey,
  isTurnaroundConcept,
  makeItemKey,
} from './assetUtils';
import type { AssetPromptSourcePreview } from './assetPromptDerivation';

export const CORE_CHARACTER_CONCEPTS: ImageConcept[] = ['portrait_closeup', 'landscape_turnaround'];
export const MANUAL_CHARACTER_CONCEPTS: ImageConcept[] = ['portrait_outfit', 'landscape_outfit_turnaround'];

export type BatchPhase = 'optimize' | 'generate';
export type StatusFilter = 'all' | 'pending' | 'failed' | 'dependency_missing' | 'manual' | 'ready';
export type BatchRetryMode = 'optimize_only' | 'optimize_then_generate' | 'generate_only';

export interface BatchFailure {
  key: string;
  name: string;
  concept: ImageConcept;
  phase: BatchPhase;
  retryMode: BatchRetryMode;
  error: string;
}

export interface BatchRunOptions {
  resetFailures?: boolean;
  failureRetryMode?: BatchRetryMode;
}

export function getImageConceptLabel(concept: ImageConcept) {
  const sceneConcept = SCENE_CONCEPTS.find((item) => item.concept === concept);
  if (sceneConcept) return sceneConcept.label;
  if (concept === 'prop_main') return PROP_CONCEPT.label;
  return CHAR_CONCEPTS.find((item) => item.concept === concept)?.label ?? concept;
}

export function getOfficialModeConceptLabel(concept: ImageConcept, enabled: boolean) {
  if (!enabled) return getImageConceptLabel(concept);
  if (concept === 'portrait_closeup') return '官方定妆照';
  if (concept === 'landscape_turnaround') return '无脸模特设定图';
  if (concept === 'portrait_outfit') return '无脸服装设定图';
  if (concept === 'landscape_outfit_turnaround') return '无脸装扮设定图';
  return getImageConceptLabel(concept);
}

export function getOfficialModeConceptDesc(concept: ImageConcept, enabled: boolean) {
  if (!enabled) {
    const sceneConcept = SCENE_CONCEPTS.find((item) => item.concept === concept);
    if (sceneConcept) return sceneConcept.desc;
    if (concept === 'prop_main') return PROP_CONCEPT.desc;
    return CHAR_CONCEPTS.find((item) => item.concept === concept)?.desc ?? '';
  }
  if (concept === 'portrait_closeup') return '绑定火山官方虚拟人像，仅作为标准正面定妆照的身份参考';
  if (concept === 'landscape_turnaround') return '只生成无脸服装/体态参考，不出现真人脸';
  if (concept === 'portrait_outfit') return '只展示服装、装备、材质和体态，不展示真人脸';
  if (concept === 'landscape_outfit_turnaround') return '用无脸或无头人台展示装扮设定图';
  const sceneConcept = SCENE_CONCEPTS.find((item) => item.concept === concept);
  if (sceneConcept) return sceneConcept.desc;
  if (concept === 'prop_main') return PROP_CONCEPT.desc;
  return '';
}

export function isOfficialVirtualHumanSlot(item: Pick<AssetItem, 'type' | 'concept'>, enabled: boolean) {
  return enabled && item.type === 'character' && item.concept === 'portrait_closeup';
}

export function isNoFaceCharacterVisualSlot(item: Pick<AssetItem, 'type' | 'concept'>, enabled: boolean) {
  return enabled && item.type === 'character' && item.concept !== 'portrait_closeup';
}

export function getNoFaceCharacterPromptGuard(item: Pick<AssetItem, 'concept'>) {
  if (item.concept === 'landscape_turnaround' || item.concept === 'landscape_outfit_turnaround') {
    return '无脸塑料模特设定图要求：使用无脸、无五官、无真实皮肤细节的中性塑料模特或服装人台展示服装、装备、材质和体态；不得出现真人脸、清晰五官、肖像脸、自拍脸、头脸特写或可识别人物身份。';
  }
  return '无脸服装设定要求：只展示服装、装备、材质、配色和体态，优先使用无头裁缝人台或脖子以下服装展示；不得出现真人脸、清晰五官、肖像脸、头发造型或可识别人物身份。';
}

export function applyOfficialNoFacePromptGuard(prompt: string, item: AssetItem, enabled: boolean) {
  if (!isNoFaceCharacterVisualSlot(item, enabled)) return prompt;
  if (prompt.includes('无脸') && prompt.includes('不得出现真人脸')) return prompt;
  return `${prompt}\n\n${getNoFaceCharacterPromptGuard(item)}`;
}

export function isOfficialVirtualHumanAsset(asset: Pick<Asset, 'source'> | undefined) {
  return asset?.source === 'volc_virtual_human';
}

export function isLegacyFaceBasedPrompt(prompt: string | undefined) {
  const text = prompt?.trim() ?? '';
  if (!text) return false;
  const hasNoFaceGuard = text.includes('无脸') && text.includes('不得出现真人脸');
  if (hasNoFaceGuard) {
    return (
      text.includes('发型轮廓')
      || text.includes('重点展示脸')
      || text.includes('角色变装定妆图')
      || text.includes('头脸空白')
    );
  }
  return (
    text.includes('参考图片')
    || text.includes('大特写')
    || text.includes('面部特写')
    || text.includes('面部特征')
    || text.includes('面容')
    || text.includes('眼神')
    || text.includes('眉骨')
    || text.includes('唇')
    || text.includes('肤色')
    || text.includes('肤感')
    || text.includes('五官')
    || text.includes('真人脸')
    || !text.includes('不得出现真人脸')
  );
}

export function isLegacyTurnaroundPrompt(prompt: string | undefined) {
  const text = prompt?.trim() ?? '';
  if (!text) return false;
  if (isNonHumanSystemCharacterText(text) && hasHumanCharacterSheetConflict(text)) return true;
  const isNoFaceReferenceSheet = (
    text.includes('NO-FACE OUTFIT BODY REFERENCE')
    || text.includes('BLANK HEAD FRONT CLOSE-UP')
    || text.includes('无脸服装/体态工业参考表')
  );
  if (isNoFaceReferenceSheet) return false;
  const hasLeftThirdFaceColumn = (
    text.includes('左侧固定三分之一')
    || text.includes('左三分之一脸部竖栏')
    || text.includes('左侧1/3')
    || text.includes('左侧 1/3')
  );
  const hasFaceOnlyCloseup = (
    text.includes('纯人脸大特写')
    && text.includes('脸部必须占左侧竖栏画面90%以上')
    && text.includes('严禁出现肩颈')
  );
  const hasFaceLockGrid = (
    text.includes('FACE LOCK GRID')
    || text.includes('FRONT NEUTRAL')
    || text.includes('LEFT 3/4 NEUTRAL')
    || text.includes('RIGHT 3/4 NEUTRAL')
    || text.includes('EYES / MOUTH DETAIL NEUTRAL')
    || text.includes('四格')
  );
  const hasNaturalFullBodyScale = (
    text.includes('72%-78%')
    || (text.includes('72%') && text.includes('78%'))
    || (text.includes('不拉长') && text.includes('不瘦长化'))
  );
  const isReferenceSheet = (
    text.includes('CHARACTER REFERENCE')
    && text.includes('FRONT VIEW')
    && text.includes('BACK VIEW')
    && text.includes('FACE HERO CLOSE-UP')
    && text.includes('MATERIAL')
    && !text.includes('PALETTE')
    && hasLeftThirdFaceColumn
    && hasFaceOnlyCloseup
    && hasFaceLockGrid
    && hasNaturalFullBodyScale
  );
  if (isReferenceSheet) return false;
  const isDevelopmentBoard = text.includes('角色锁定开发板') || text.includes('变装后角色锁定开发板');
  const isOldDevelopmentBoard = (
    isDevelopmentBoard
    || text.includes('固定蓝图')
    || (text.includes('2x2') && !hasFaceLockGrid)
    || text.includes('左栏')
    || text.includes('右栏')
    || text.includes('右上格')
    || text.includes('右中格')
    || text.includes('右下格')
  );
  return (
    isOldDevelopmentBoard
    || text.includes('三视图')
    || text.includes('四视图')
    || text.includes('Front')
    || text.includes('Profile')
    || text.includes('Back')
    || text.includes('正面/侧面/背面')
    || text.includes('正面、侧面、背面')
    || text.includes('侧面/背面')
    || text.includes('侧面、背面')
    || text.includes('SIDE VIEW')
    || text.includes('HEAD / FACE SIDE CLOSE-UP')
    || text.includes('FRONT/SIDE/BACK')
    || (
      text.includes('CHARACTER REFERENCE')
      && text.includes('FACE HERO CLOSE-UP')
      && text.includes('PALETTE')
    )
    || (
      text.includes('CHARACTER REFERENCE')
      && text.includes('FACE HERO CLOSE-UP')
      && !hasLeftThirdFaceColumn
    )
    || (
      text.includes('CHARACTER REFERENCE')
      && text.includes('FACE HERO CLOSE-UP')
      && !hasFaceOnlyCloseup
    )
    || (
      text.includes('CHARACTER REFERENCE')
      && text.includes('FACE HERO CLOSE-UP')
      && (!hasFaceLockGrid || !hasNaturalFullBodyScale)
    )
    || text.includes('允许少量肩颈入画')
    || text.includes('不得缩成半身照')
    || text.includes('三到四个角度')
    || text.includes('多角度周转图')
    || text.includes('turnaround sheet')
    || text.includes('model sheet')
  );
}

export function sanitizeNoFaceCharacterDescription(description: string) {
  const blockedTerms = [
    '面容',
    '面部',
    '五官',
    '眼神',
    '眼底',
    '眉',
    '唇',
    '肤色',
    '肤感',
    '脸',
    '真人',
    '肖像',
    '特写',
    '左侧',
    '右侧',
    '参考图片',
    '身份',
    '发型',
    '黑发',
    '发丝',
    '头发',
    '束冠',
    '头脸',
    '表情',
  ];
  const clauses = description
    .split(/[；;。，,\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !blockedTerms.some((term) => part.includes(term)));

  return clauses.join('；') || '服装、装备、材质、配色、轮廓、体态和整体气质';
}

export function buildNoFacePreviewSource(item: AssetItem, description: string): AssetPromptSourcePreview {
  const target = sanitizeNoFaceCharacterDescription(description);
  const isTurnaround = isTurnaroundConcept(item.concept);
  return {
    descriptionSources: [
      {
        label: '无脸服装目标',
        value: target,
        tone: 'structured',
      },
    ],
    contextSources: [
      {
        label: '官方库保护规则',
        value: isTurnaround
          ? '只生成无脸/无五官服装人台设定图，保留服装、装备、材质、配色和体态，不展示真人脸或可识别身份。'
          : '只生成无头或脖子以下服装设定图，保留服装、装备、材质、配色和体态，不展示真人脸、五官或头发造型。',
        tone: 'structured',
      },
    ],
  };
}

export function getSelectedNoFaceOutfitDescription(item: AssetItem, outfits: CharacterOutfit[] | undefined) {
  if (item.type !== 'character') return '';
  if (item.concept !== 'portrait_outfit' && item.concept !== 'landscape_outfit_turnaround') return '';

  const candidates = (outfits ?? []).filter((outfit) => outfit.characterName === item.name);
  if (candidates.length === 0) return '';

  const byOutfitSeq = typeof item.outfitSeq === 'number'
    ? candidates.find((outfit) => outfit.outfitSeq === item.outfitSeq)
    : undefined;
  if (byOutfitSeq?.outfitDesc) return byOutfitSeq.outfitDesc;

  if (item.variantKey) {
    const match = item.variantKey.match(/outfit-(\d+)/);
    const seq = match ? Number(match[1]) : NaN;
    const byVariant = Number.isFinite(seq)
      ? candidates.find((outfit) => outfit.outfitSeq === seq)
      : undefined;
    if (byVariant?.outfitDesc) return byVariant.outfitDesc;
  }

  const needsImage = candidates.filter((outfit) => outfit.needsNewImage);
  const fallback = (needsImage.length > 0 ? needsImage : candidates)
    .slice()
    .sort((a, b) => b.outfitSeq - a.outfitSeq)[0];
  return fallback?.outfitDesc ?? '';
}

export function isCoreRequiredSlot(item: Pick<AssetItem, 'type' | 'concept'>) {
  return item.type !== 'character' || CORE_CHARACTER_CONCEPTS.includes(item.concept);
}

export function isManualEnhancementSlot(item: Pick<AssetItem, 'type' | 'concept'>) {
  return item.type === 'character' && MANUAL_CHARACTER_CONCEPTS.includes(item.concept);
}

export function getSceneConceptMeta(concept: ImageConcept) {
  return SCENE_CONCEPTS.find((config) => config.concept === concept);
}

export function getSceneItemsForName(items: Record<string, AssetItem>, name: string) {
  return Object.values(items)
    .filter((item) => item.type === 'scene' && item.name === name)
    .sort((a, b) => {
      const conceptOrderDiff = SCENE_CONCEPTS.findIndex((config) => config.concept === a.concept)
        - SCENE_CONCEPTS.findIndex((config) => config.concept === b.concept);
      if (conceptOrderDiff !== 0) return conceptOrderDiff;
      return a.key.localeCompare(b.key);
    });
}

export function sortCharacterItems(items: AssetItem[]) {
  return [...items].sort((a, b) => {
    const conceptOrderDiff = CHAR_CONCEPTS.findIndex((config) => config.concept === a.concept)
      - CHAR_CONCEPTS.findIndex((config) => config.concept === b.concept);
    if (conceptOrderDiff !== 0) return conceptOrderDiff;
    return (a.outfitSeq ?? 0) - (b.outfitSeq ?? 0);
  });
}

export function getCharacterItemsForName(items: Record<string, AssetItem>, name: string) {
  return sortCharacterItems(
    Object.values(items).filter((item) => item.type === 'character' && item.name === name),
  );
}

export function getCharacterSlotWidthClass(item: Pick<AssetItem, 'aspectRatio'>) {
  return item.aspectRatio === 'PORTRAIT'
    ? 'w-[136px] sm:w-[148px] lg:w-[164px] xl:w-[172px]'
    : 'w-[208px] sm:w-[224px] lg:w-[240px] xl:w-[256px]';
}

export function getFailureSummaryLabel(failures: BatchFailure[]) {
  const phases = new Set(failures.map((failure) => failure.phase));
  if (phases.size > 1) return '一键生成';
  if (phases.has('optimize')) return '批量优化';
  return '批量生成';
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

export function getGeneratedAssetExternalFields(result: {
  externalImageUrl?: string;
  externalImageExpiresAt?: number;
  sourceProvider?: string;
  sourceModel?: string;
}): Partial<Pick<Asset, 'source' | 'externalImageUrl' | 'externalImageExpiresAt' | 'externalSourceModel'>> {
  if (result.sourceProvider !== 'volc_seedream' || !result.externalImageUrl) return {};
  return {
    source: 'volc_seedream_output',
    externalImageUrl: result.externalImageUrl,
    externalImageExpiresAt: result.externalImageExpiresAt,
    externalSourceModel: result.sourceModel,
  };
}

export function hasMissingDependency(item: AssetItem, items: Record<string, AssetItem>, officialMode = false) {
  if (isNoFaceCharacterVisualSlot(item, officialMode)) return false;
  const sourceConcept = getSourceConcept(item.concept);
  if (!sourceConcept) return false;
  const baseKey = makeItemKey(
    item.type,
    item.name,
    sourceConcept,
    item.type === 'prop' ? item.identityKey : undefined,
    getSourceVariantKey(item.concept, item.variantKey),
  );
  return !items[baseKey]?.asset;
}
