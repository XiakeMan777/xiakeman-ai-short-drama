export type CharacterGenderHint = 'male' | 'female';

function normalizeText(value?: string | null) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

const FEMALE_HINTS = [
  '女主',
  '女性',
  '少女',
  '姑娘',
  '小姐',
  '女声',
  '女孩子',
  '女孩',
  '女性化',
  '女相',
  '公主',
  '仙子',
];

const MALE_HINTS = [
  '男主',
  '男性',
  '少年',
  '先生',
  '汉子',
  '男声',
  '男孩子',
  '男孩',
  '男性化',
  '男相',
  '大叔',
];

const FEMALE_RELATION_HINTS = [
  '师姐',
  '姐姐',
  '妹妹',
  '闺蜜',
  '妻子',
  '母亲',
  '夫人',
  '太太',
];

const MALE_RELATION_HINTS = [
  '丈夫',
  '哥哥',
  '弟弟',
  '师兄',
];

function includesAny(text: string, hints: string[]) {
  return hints.some((hint) => text.includes(hint));
}

export function inferCharacterGenderHint(...parts: Array<string | null | undefined>): CharacterGenderHint | undefined {
  const text = parts.map((part) => normalizeText(part)).filter(Boolean).join(' ');
  if (!text) return undefined;

  const female = includesAny(text, FEMALE_HINTS);
  const male = includesAny(text, MALE_HINTS);
  const relationPrefixPattern = /(?:身份|角色|定位|人物|关系|设定|人设|本体|本人|她是|他是|为|是)[：:\s，,、-]{0,4}$/u;
  const hasDirectRelationHint = (hints: string[]) => hints.some((hint) => {
    const index = text.indexOf(hint);
    if (index < 0) return false;
    const before = text.slice(Math.max(0, index - 12), index);
    return relationPrefixPattern.test(before);
  });
  const femaleRelation = !female && hasDirectRelationHint(FEMALE_RELATION_HINTS);
  const maleRelation = !male && hasDirectRelationHint(MALE_RELATION_HINTS);

  if (female && !male) return 'female';
  if (male && !female) return 'male';
  if (femaleRelation && !male && !maleRelation) return 'female';
  if (maleRelation && !female && !femaleRelation) return 'male';
  if (female && /女主|女性|少女|姑娘|小姐|女声|女性化|女相/.test(text)) return 'female';
  if (male && /男主|男性|少年|先生|男声|男性化|男相/.test(text)) return 'male';
  return undefined;
}
