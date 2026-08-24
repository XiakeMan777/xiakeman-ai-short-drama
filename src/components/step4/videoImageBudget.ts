import type {
  Asset,
  ImageReference,
  PropConsistency,
  ScriptAnalysis,
  StoryboardBoardDirectorBrief,
  StoryboardInfo,
  VideoImageBudgetOmission,
  VideoImageBudgetState,
} from '@/types';
import { getStoryboardNumbersFromRange } from '@/lib/propTracking';

export const STEP4_VIDEO_IMAGE_REFERENCE_LIMIT = 9;

export interface SelectVideoImageRefsInput {
  refs: readonly ImageReference[];
  storyboard: StoryboardInfo;
  correctedScript?: string;
  analysis?: ScriptAnalysis | null;
  allStoryboards?: readonly StoryboardInfo[];
  storyboardIndex?: number;
  propTracking?: readonly PropConsistency[];
  assetLibrary?: readonly Asset[];
  maxRefs?: number;
  directorBrief?: StoryboardBoardDirectorBrief;
}

export interface SelectVideoImageRefsResult {
  selectedRefs: ImageReference[];
  selectedOriginalRefs: ImageReference[];
  refIdMap: Record<string, string>;
  budget: VideoImageBudgetState;
}

function getRefKey(ref: Pick<ImageReference, 'type' | 'name' | 'trackingId' | 'variantKey' | 'outfitSeq'>) {
  if (ref.type === 'prop') return `prop:${ref.trackingId || ref.name}`;
  if (ref.type === 'character') return `character:${ref.name}:${ref.variantKey ?? ref.outfitSeq ?? 'base'}`;
  return `${ref.type}:${ref.name}`;
}

function renumberImageRefs(refs: readonly ImageReference[]) {
  return refs.map((ref, index) => ({
    ...ref,
    refId: `(图片${index + 1})`,
  }));
}

function buildRefIdMap(originalRefs: readonly ImageReference[], selectedRefs: readonly ImageReference[]) {
  return originalRefs.reduce<Record<string, string>>((result, ref, index) => {
    result[ref.refId] = selectedRefs[index]?.refId ?? ref.refId;
    return result;
  }, {});
}

function isStoryboardNumberInRange(storyboardNumber: number | undefined, storyboardRange: string | undefined) {
  if (!storyboardRange?.trim() || storyboardNumber === undefined) return false;
  const storyboardNumbers = getStoryboardNumbersFromRange(storyboardRange);
  return storyboardNumbers.length === 0 ? true : storyboardNumbers.includes(storyboardNumber);
}

function normalizeText(value: string | undefined) {
  return value?.trim() ?? '';
}

function countTextHits(text: string, value: string | undefined) {
  const needle = normalizeText(value);
  if (!needle) return 0;
  return text.includes(needle) ? 1 : 0;
}

function getPropForRef(
  ref: ImageReference,
  propTracking: readonly PropConsistency[] | undefined,
) {
  if (ref.type !== 'prop') return undefined;
  return (propTracking ?? []).find((prop) =>
    (ref.trackingId && prop.trackingId === ref.trackingId)
    || (!ref.trackingId && prop.propName === ref.name),
  );
}

function isCommonTextSafeProp(prop: PropConsistency | undefined, ref: ImageReference, sourceText: string) {
  const propText = [
    ref.name,
    prop?.appearanceDesc,
    prop?.size,
    prop?.material,
    prop?.shapeStructure,
    prop?.color,
    prop?.texture,
    prop?.condition,
    prop?.visualAnchor,
    prop?.step3Description,
    prop?.stateChanges,
  ].filter(Boolean).join(' ');

  const criticalPattern = /特写|近景|证据|信物|玉佩|戒指|项链|血书|合同|遗嘱|令牌|钥匙|印章|药瓶|毒药|匕首|刀|剑|枪|手机屏幕|照片|符纸|账本/;
  const propMentionedInSource = sourceText.includes(ref.name) || (!!prop?.trackingId && sourceText.includes(prop.trackingId));
  const propActionPattern = /特写|抢|争夺|递|交给|打碎|摔碎|藏|掏出|亮出|打开|签|盖章|刺|砍|开枪|拍照|展示/;
  if (criticalPattern.test(propText) || (propMentionedInSource && propActionPattern.test(sourceText))) {
    return false;
  }

  return /手机|文件|纸|杯|茶杯|酒杯|桌|椅|门|灯|床|被子|窗|帘|书|包|盘|碗|普通|背景|装饰/.test(propText || ref.name);
}

function isReferencedLater(characterName: string, allStoryboards: readonly StoryboardInfo[] | undefined, storyboardIndex: number | undefined) {
  if (!allStoryboards || storyboardIndex === undefined) return false;
  return allStoryboards.slice(storyboardIndex + 1).some((storyboard) =>
    storyboard.characters.some((character) => character === characterName),
  );
}

function isBackgroundCharacter(ref: ImageReference, storyboard: StoryboardInfo, sourceText: string, allStoryboards: readonly StoryboardInfo[] | undefined, storyboardIndex: number | undefined) {
  if (ref.type !== 'character') return false;
  if (isReferencedLater(ref.name, allStoryboards, storyboardIndex)) return false;
  if (countTextHits(sourceText, ref.name) > 0) return false;
  const listed = storyboard.characters.includes(ref.name);
  return !listed || /路人|群众|群演|侍卫|宫女|杂役|护工|保安|顾客|行人|围观|背景/.test(ref.name);
}

function getAssetForRef(ref: ImageReference, assetLibrary: readonly Asset[] | undefined) {
  if (!ref.assetId) return undefined;
  return (assetLibrary ?? []).find((asset) => asset.id === ref.assetId);
}

function getReferenceIdNumber(value: string | undefined) {
  return value?.match(/\d+/)?.[0] ?? '';
}

function isSameReferenceId(left: string | undefined, right: string | undefined) {
  const leftClean = left?.trim() ?? '';
  const rightClean = right?.trim() ?? '';
  if (!leftClean || !rightClean) return false;
  if (leftClean === rightClean) return true;
  const leftNumber = getReferenceIdNumber(leftClean);
  const rightNumber = getReferenceIdNumber(rightClean);
  if (!leftNumber || leftNumber !== rightNumber) return false;
  return /图|圖片|图片|image|ref|reference|参考/i.test(`${leftClean}${rightClean}`);
}

function getDirectorBudgetDecision(
  ref: ImageReference,
  directorBrief: StoryboardBoardDirectorBrief | undefined,
) {
  const budgetItem = directorBrief?.referenceBudget?.find((item) =>
    isSameReferenceId(item.refId, ref.refId)
    || (
      item.name === ref.name
      && (!item.type || item.type === ref.type)
    ),
  );
  return budgetItem?.decision;
}

function getDirectorBudgetReason(
  ref: ImageReference,
  directorBrief: StoryboardBoardDirectorBrief | undefined,
) {
  const budgetItem = directorBrief?.referenceBudget?.find((item) =>
    isSameReferenceId(item.refId, ref.refId)
    || (
      item.name === ref.name
      && (!item.type || item.type === ref.type)
    ),
  );
  return budgetItem?.reason;
}

function getDirectorPriorityBoost(
  ref: ImageReference,
  directorBrief: StoryboardBoardDirectorBrief | undefined,
) {
  const priority = directorBrief?.referencePriority ?? [];
  const index = priority.findIndex((refId) => isSameReferenceId(refId, ref.refId));
  if (index < 0) return 0;
  return Math.max(0, 220 - index * 16);
}

function buildOmission(ref: ImageReference, reason: VideoImageBudgetOmission['reason']): VideoImageBudgetOmission {
  const typeLabel = ref.type === 'character' ? '角色' : ref.type === 'scene' ? '场景' : '道具';
  const messageByReason: Record<VideoImageBudgetOmission['reason'], string> = {
    'prop-text-safe': `道具「${ref.name}」属于普通小物件/场景陈设，可用文字或场景母版保持一致，本镜不占 Seedance 9 图名额。`,
    'prop-overflow': `道具「${ref.name}」超出 Seedance 9 图预算，本镜改用文字描述；若它只是小物件，建议 Step3 合并到“小道具合集图”，若是核心剧情道具则拆分分镜或优先保留单独参考图。`,
    'background-character-overflow': `背景/一扫而过角色「${ref.name}」超出 9 张预算，本镜改用文字描述。`,
    'scene-overflow': `场景「${ref.name}」超出 Seedance 9 图预算，当前以文字场景描述兜底；普通陈设应尽量烘焙在场景母版里。`,
    'asset-overflow': `${typeLabel}「${ref.name}」超出 Seedance 9 图预算，本镜改用文字描述。`,
  };

  return {
    ref,
    reason,
    message: messageByReason[reason],
  };
}

export function selectVideoImageRefs({
  refs,
  storyboard,
  correctedScript = '',
  analysis,
  allStoryboards,
  storyboardIndex,
  propTracking,
  assetLibrary,
  maxRefs = STEP4_VIDEO_IMAGE_REFERENCE_LIMIT,
  directorBrief,
}: SelectVideoImageRefsInput): SelectVideoImageRefsResult {
  const sourceText = [
    storyboard.name,
    storyboard.scene,
    storyboard.characters.join(' '),
    correctedScript,
  ].join(' ');

  const uniqueRefs = refs.filter((ref, index, source) =>
    source.findIndex((candidate) => getRefKey(candidate) === getRefKey(ref)) === index,
  );

  if (uniqueRefs.length <= maxRefs) {
    const selectedRefs = renumberImageRefs(uniqueRefs);
    return {
      selectedRefs,
      selectedOriginalRefs: uniqueRefs,
      refIdMap: buildRefIdMap(uniqueRefs, selectedRefs),
      budget: {
        limit: maxRefs,
        originalCount: uniqueRefs.length,
        selectedCount: selectedRefs.length,
        compressed: false,
        omittedRefs: [],
        notes: [`参考图 ${selectedRefs.length}/${maxRefs}，未触发压缩。`],
        warnings: [],
      },
    };
  }

  const entries = uniqueRefs.map((ref, index) => {
    const prop = getPropForRef(ref, propTracking ?? analysis?.propTracking);
    const asset = getAssetForRef(ref, assetLibrary);
    const sourceHit = countTextHits(sourceText, ref.name);
    const propInRange = ref.type === 'prop'
      ? isStoryboardNumberInRange(storyboard.number, prop?.storyboardRange)
      : false;
    const textSafeProp = ref.type === 'prop' && isCommonTextSafeProp(prop, ref, sourceText);
    const backgroundCharacter = isBackgroundCharacter(ref, storyboard, sourceText, allStoryboards, storyboardIndex);
    const directorDecision = getDirectorBudgetDecision(ref, directorBrief);
    const directorReason = getDirectorBudgetReason(ref, directorBrief);

    let priority = 0;
    if (ref.type === 'scene') priority = 900;
    if (ref.type === 'character') priority = 800;
    if (ref.type === 'prop') priority = 420;

    if (ref.type === 'character' && storyboard.characters.includes(ref.name)) priority += 120;
    if (ref.type === 'character' && sourceHit > 0) priority += 80;
    if (ref.type === 'character' && isReferencedLater(ref.name, allStoryboards, storyboardIndex)) priority += 50;
    if (ref.type === 'character' && backgroundCharacter) priority -= 560;
    if (asset?.source === 'volc_virtual_human') priority += 80;
    if (ref.variantKey || typeof ref.outfitSeq === 'number') priority += 35;

    if (ref.type === 'scene' && storyboard.scene === ref.name) priority += 80;
    if (ref.type === 'scene' && sourceHit > 0) priority += 30;

    if (ref.type === 'prop') {
      if (propInRange) priority += 80;
      if (sourceHit > 0 || countTextHits(sourceText, prop?.trackingId) > 0) priority += 60;
      if (prop?.needsTracking) priority += 30;
      if (textSafeProp) priority -= 180;
    }

    priority += getDirectorPriorityBoost(ref, directorBrief);
    if (directorDecision === 'mustKeep') priority += 1000;
    if (directorDecision === 'preferKeep') priority += 260;
    if (directorDecision === 'textFallback') priority -= 360;

    return {
      ref,
      index,
      priority,
      textSafeProp,
      backgroundCharacter,
      directorDecision,
      directorReason,
    };
  });

  const keepIndexes = new Set<number>();
  const omittedIndexes = new Set<number>();
  const omittedRefs: VideoImageBudgetOmission[] = [];

  const candidateEntries = entries.filter((entry) =>
    !(
      entry.directorDecision === 'textFallback'
      && !(entry.ref.type === 'scene' && storyboard.scene === entry.ref.name)
      && !(entry.ref.type === 'character' && !entry.backgroundCharacter)
    ),
  );
  const hardKeepEntries = candidateEntries.filter((entry) =>
    entry.directorDecision === 'mustKeep'
    || (entry.ref.type === 'scene' && storyboard.scene === entry.ref.name)
    || (entry.ref.type === 'character' && !entry.backgroundCharacter),
  );

  const hardKeepSorted = hardKeepEntries
    .slice()
    .sort((a, b) => b.priority - a.priority || a.index - b.index);

  for (const entry of hardKeepSorted.slice(0, maxRefs)) {
    keepIndexes.add(entry.index);
  }

  const remainingSlots = maxRefs - keepIndexes.size;
  if (remainingSlots > 0) {
    const softSorted = candidateEntries
      .filter((entry) => !keepIndexes.has(entry.index))
      .sort((a, b) => b.priority - a.priority || a.index - b.index);
    for (const entry of softSorted.slice(0, remainingSlots)) {
      keepIndexes.add(entry.index);
    }
  }

  for (const entry of entries) {
    if (keepIndexes.has(entry.index) || omittedIndexes.has(entry.index)) continue;
    const reason: VideoImageBudgetOmission['reason'] = entry.ref.type === 'prop'
      ? entry.textSafeProp
        ? 'prop-text-safe'
        : 'prop-overflow'
      : entry.backgroundCharacter
        ? 'background-character-overflow'
        : entry.ref.type === 'scene'
          ? 'scene-overflow'
          : 'asset-overflow';
    omittedRefs.push(buildOmission(entry.ref, reason));
  }

  const selectedOriginalRefs = uniqueRefs.filter((_ref, index) => keepIndexes.has(index));
  const selectedRefs = renumberImageRefs(selectedOriginalRefs);
  const refIdMap = buildRefIdMap(selectedOriginalRefs, selectedRefs);
  const selectedTypes = selectedRefs.reduce<Record<ImageReference['type'], number>>((acc, ref) => {
    acc[ref.type] += 1;
    return acc;
  }, { scene: 0, character: 0, prop: 0 });
  const warnings: string[] = [];
  const omittedCriticalCharacters = omittedRefs.filter((item) =>
    item.ref.type === 'character' && item.reason !== 'background-character-overflow',
  );
  if (omittedCriticalCharacters.length > 0) {
    warnings.push(`关键人物超过 ${maxRefs} 张预算：${omittedCriticalCharacters.map((item) => item.ref.name).join('、')} 已被迫改用文字。建议拆分分镜。`);
  }
  if (storyboard.scene && selectedRefs.every((ref) => ref.type !== 'scene')) {
    warnings.push(`场景「${storyboard.scene}」未进入参考图预算，场景一致性可能下降。`);
  }

  return {
    selectedRefs,
    selectedOriginalRefs,
    refIdMap,
    budget: {
      limit: maxRefs,
      originalCount: uniqueRefs.length,
      selectedCount: selectedRefs.length,
      compressed: omittedRefs.length > 0,
      omittedRefs,
      notes: [
        `参考图已压缩为 ${selectedRefs.length}/${maxRefs}：人物 ${selectedTypes.character}，场景 ${selectedTypes.scene}，道具 ${selectedTypes.prop}。`,
        'Seedance 2.0 全能参考模式最多 9 张图：人物和场景优先保一致性；核心剧情道具优先单独保留；普通小物件优先改用文字、场景母版或 Step3 小道具合集图。',
        ...(directorBrief ? ['导演参考预算已参与排序：mustKeep 优先保留，textFallback 优先文字兜底。'] : []),
      ],
      warnings,
    },
  };
}
