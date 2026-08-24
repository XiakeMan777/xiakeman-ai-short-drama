import type { PropConsistency } from '@/types';
import { getSafePropHolderLabel, shouldUseVisualCharacterName } from '@/lib/characterAssetGuards';
import { getStoryboardNumbersFromRange } from '@/lib/propTracking';

const SHARED_OR_SCENE_HOLDER_PATTERN = /^(无|未知|场景道具|众人|所有人|多人|全员|敌人|怪物|群众|路人|桌面|地面|墙面|空中)$/;
const SCENE_PROP_NAME_PATTERN = /(石桌|桌椅|桌案|椅子|木床|药柜|柜子|烛台|祭坛|阵法|屏风|马车|车辆|建筑|雕像|尸体|血迹|残屑|样本|污布|铁盆|伤口|裂缝|雷柱|雾气|雨幕|石桥|木桥|桥面|入口|大门|房门|窗户|墙面|地板|台阶|石阶|立柱|牌匾)/;
const STATE_CHANGE_PATTERN = /(转交|递给|交给|移交|传递|被夺|夺走|抢走|掉落|丢失|遗失|放下|捡起|拾起|易主|换持有者|折断|断裂|破碎|碎裂|裂开|裂纹扩大|损坏|烧毁|腐蚀|染血|耗尽|打开|关闭|爆炸|消失|变形|变色|变化|完好\s*(?:→|->|-))/;

function normalizeName(value: string | undefined) {
  return (value ?? '')
    .trim()
    .replace(/[【】[\]（）()《》“”‘’"'\s,，、。；;：:_\-—~·]/g, '');
}

function hasEnoughVisualPropDetail(prop: Pick<PropConsistency, 'appearanceDesc' | 'step3Description' | 'material' | 'shapeStructure' | 'color' | 'visualAnchor'>) {
  return [
    prop.step3Description,
    prop.appearanceDesc,
    prop.material,
    prop.shapeStructure,
    prop.color,
    prop.visualAnchor,
  ].some((value) => !!value?.trim());
}

function hasStableSingleOwnerState(prop: Pick<PropConsistency, 'stateChanges' | 'condition'>) {
  const stateText = [prop.stateChanges, prop.condition].filter(Boolean).join('；');
  if (!stateText.trim()) return true;
  const stateSegments = stateText
    .split(/[；;，,、。]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (stateSegments.length > 0 && stateSegments.every((segment) =>
    /^(无|无明显变化|稳定|稳定完好|保持一致|全程一致|始终完好|完好)$/i.test(segment)
  )) {
    return true;
  }
  return !STATE_CHANGE_PATTERN.test(stateText);
}

export function getCharacterExclusivePropHolder(prop: Pick<PropConsistency, 'holder'>) {
  const holder = getSafePropHolderLabel(prop.holder);
  if (!holder || holder === '场景道具' || SHARED_OR_SCENE_HOLDER_PATTERN.test(holder)) return '';
  return shouldUseVisualCharacterName(holder) ? holder : '';
}

export function isCharacterExclusivePropFor(
  prop: Pick<PropConsistency, 'propName' | 'holder' | 'storyboardRange' | 'stateChanges' | 'condition' | 'needsTracking' | 'needsImage' | 'appearanceDesc' | 'step3Description' | 'material' | 'shapeStructure' | 'color' | 'visualAnchor'>,
  characterName: string,
) {
  const holder = getCharacterExclusivePropHolder(prop);
  if (!holder || normalizeName(holder) !== normalizeName(characterName)) return false;
  if (SCENE_PROP_NAME_PATTERN.test(prop.propName)) return false;
  if (!hasEnoughVisualPropDetail(prop)) return false;
  if (!hasStableSingleOwnerState(prop)) return false;
  if (prop.needsTracking === false && !prop.needsImage && getStoryboardNumbersFromRange(prop.storyboardRange).length <= 1) return false;
  return true;
}

export function getCharacterExclusiveProps(
  propTracking: readonly PropConsistency[] | undefined,
  characterName: string,
) {
  return (propTracking ?? []).filter((prop) => isCharacterExclusivePropFor(prop, characterName));
}

export function shouldFoldPropIntoCharacterSetting(
  prop: PropConsistency,
  characterNames: readonly string[],
) {
  const holder = getCharacterExclusivePropHolder(prop);
  if (!holder) return false;
  return characterNames.some((name) => normalizeName(name) === normalizeName(holder))
    && isCharacterExclusivePropFor(prop, holder);
}
