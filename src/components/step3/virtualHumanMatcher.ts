import type { CharacterProfile } from '@/types';
import type { VolcVirtualHuman } from '@/lib/volcVirtualHumanCatalog';

export interface VirtualHumanMatchInput {
  characterName: string;
  profile?: CharacterProfile;
  context?: string;
}

export interface VirtualHumanMatch {
  person: VolcVirtualHuman;
  score: number;
  reasons: string[];
}

export interface VirtualHumanBatchMatchInput extends VirtualHumanMatchInput {
  key: string;
}

export interface VirtualHumanBatchMatch {
  key: string;
  match: VirtualHumanMatch | null;
  candidates: VirtualHumanMatch[];
}

export interface VirtualHumanBatchMatchOptions {
  limitPerInput?: number;
  reservedAssetIds?: Iterable<string>;
}

type NormalizedGender = 'male' | 'female';

interface MatchSignals {
  text: string;
  gender?: NormalizedGender;
  age?: number;
  ageGroup?: string;
  occupationHints: string[];
  styleHints: string[];
  wantsPerformance: boolean;
  hasStrongSignal: boolean;
}

const MALE_HINTS = ['男', '男性', '男主', '少年', '父亲', '哥哥', '弟弟', '丈夫', '先生'];
const FEMALE_HINTS = ['女', '女性', '女主', '少女', '母亲', '姐姐', '妹妹', '妻子', '姑娘'];

const AGE_GROUP_HINTS: Record<string, string[]> = {
  少年: ['少年', '少女', '学生', '高中', '青春', '年轻', '未成年'],
  青年: ['青年', '年轻', '大学', '青春', '二十', '女主', '男主'],
  中年: ['中年', '成熟', '父亲', '母亲', '叔叔', '阿姨', '总裁', '稳重'],
  长者: ['老人', '老年', '爷爷', '奶奶', '长者', '年迈'],
};

const STYLE_HINTS = [
  '古风',
  '仙侠',
  '武侠',
  '玄幻',
  '都市',
  '职场',
  '商务',
  '现代',
  '校园',
  '农村',
  '生活',
  '表演',
];

const PERFORMANCE_HINTS = ['演员', '影视', '电影', '电视', '短剧', '剧组', '表演', '戏剧', '明星', '艺人', '镜头感'];
const PERFORMANCE_RELATED_HINTS = ['演员', '影视', '电影', '电视', '短剧', '剧组', '表演', '戏剧', '明星', '艺人'];

const OCCUPATION_ALIASES: Record<string, string[]> = {
  演员: ['演员', '明星', '艺人', '表演'],
  模特: ['模特', '时尚', '走秀'],
  歌手: ['歌手', '音乐', '唱歌'],
  '网红/主播': ['网红', '主播', '直播', '博主'],
  工程师: ['工程师', '程序员', '技术', '研发'],
  '科学家/研究员': ['科学家', '研究员', '科研', '实验室'],
  作家: ['作家', '写作', '作者', '编剧'],
  企业高管: ['高管', '总裁', '老板', '职场', '商务'],
  农民: ['农民', '农村', '田地', '乡村'],
  果农: ['果农', '果园', '农村', '乡村'],
  养蜂人: ['养蜂', '蜂农', '乡村'],
  快递员: ['快递', '配送'],
  外卖员: ['外卖', '配送'],
  司机: ['司机', '开车'],
  美甲师: ['美甲', '美甲师'],
  客服: ['客服', '接线', '服务'],
  银行柜员: ['银行', '柜员'],
};

function normalize(value: string | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function joinInput(input: VirtualHumanMatchInput) {
  const profile = input.profile;
  return [
    input.characterName,
    profile?.description,
    profile?.ageAppearance,
    profile?.temperament,
    profile?.bodyBuild,
    profile?.faceFeatures,
    profile?.hairStyle,
    profile?.skinTone,
    profile?.defaultOutfit,
    profile?.accessories,
    profile?.visualAnchor,
    profile?.step3Description,
    input.context,
  ].filter(Boolean).join(' ');
}

function includesAny(text: string, hints: string[]) {
  return hints.some((hint) => text.includes(hint.toLowerCase()));
}

function normalizeGender(value: string | undefined): NormalizedGender | undefined {
  if (!value) return undefined;
  if (value.includes('女')) return 'female';
  if (value.includes('男')) return 'male';
  return undefined;
}

function inferGender(text: string): NormalizedGender | undefined {
  const male = includesAny(text, MALE_HINTS);
  const female = includesAny(text, FEMALE_HINTS);
  if (male && !female) return 'male';
  if (female && !male) return 'female';
  return undefined;
}

function inferAge(text: string) {
  const match = text.match(/(\d{1,3})\s*岁/);
  if (!match) return undefined;
  const age = Number(match[1]);
  return Number.isFinite(age) ? age : undefined;
}

function inferAgeGroupFromAge(age: number | undefined) {
  if (typeof age !== 'number' || !Number.isFinite(age)) return undefined;
  if (age < 20) return '少年';
  if (age < 36) return '青年';
  if (age < 56) return '中年';
  return '长者';
}

function inferAgeGroup(text: string, age: number | undefined) {
  const fromAge = inferAgeGroupFromAge(age);
  if (fromAge) return fromAge;
  for (const [ageGroup, hints] of Object.entries(AGE_GROUP_HINTS)) {
    if (includesAny(text, hints)) return ageGroup;
  }
  return undefined;
}

function collectOccupationHints(text: string) {
  const matches = new Set<string>();
  for (const [occupation, aliases] of Object.entries(OCCUPATION_ALIASES)) {
    if (text.includes(occupation.toLowerCase()) || includesAny(text, aliases)) {
      matches.add(occupation);
    }
  }
  return Array.from(matches);
}

function collectStyleHints(text: string) {
  return STYLE_HINTS.filter((hint) => text.includes(hint.toLowerCase()));
}

function getSignals(input: VirtualHumanMatchInput): MatchSignals {
  const text = normalize(joinInput(input));
  const age = inferAge(text);
  const gender = inferGender(text);
  const ageGroup = inferAgeGroup(text, age);
  const occupationHints = collectOccupationHints(text);
  const styleHints = collectStyleHints(text);
  const wantsPerformance = includesAny(text, PERFORMANCE_HINTS);
  return {
    text,
    gender,
    age,
    ageGroup,
    occupationHints,
    styleHints,
    wantsPerformance,
    hasStrongSignal: Boolean(gender || age || ageGroup || occupationHints.length || styleHints.length || wantsPerformance),
  };
}

export function inferVirtualHumanTargetGender(input: VirtualHumanMatchInput): '男' | '女' | undefined {
  const gender = getSignals(input).gender;
  if (gender === 'male') return '男';
  if (gender === 'female') return '女';
  return undefined;
}

function scoreTagMatches(signals: MatchSignals, person: VolcVirtualHuman) {
  const matchedTags = person.tags.filter((tag) => signals.text.includes(tag.toLowerCase()));
  return {
    score: matchedTags.length * 10,
    matchedTags,
  };
}

function scoreAge(signals: MatchSignals, person: VolcVirtualHuman, reasons: string[]) {
  if (typeof signals.age === 'number' && typeof person.age === 'number') {
    const delta = Math.abs(person.age - signals.age);
    if (delta <= 2) {
      reasons.push(`年龄接近：${person.age}岁`);
      return 30;
    }
    if (delta <= 5) {
      reasons.push(`年龄段接近：${person.age}岁`);
      return 18;
    }
    if (delta <= 10) return 8;
    if (delta <= 20) return -18;
    return -36;
  }

  if (signals.ageGroup && person.ageGroup === signals.ageGroup) {
    reasons.push(`年龄段匹配：${signals.ageGroup}`);
    return 18;
  }

  return 0;
}

function scoreOccupation(signals: MatchSignals, person: VolcVirtualHuman, reasons: string[]) {
  if (signals.occupationHints.length === 0) return 0;
  if (person.occupation && signals.occupationHints.includes(person.occupation)) {
    reasons.push(`职业匹配：${person.occupation}`);
    return 28;
  }
  if (person.tags.some((tag) => signals.occupationHints.includes(tag))) {
    reasons.push('职业标签接近');
    return 14;
  }
  return 0;
}

function scorePerformance(signals: MatchSignals, person: VolcVirtualHuman, reasons: string[]) {
  if (person.occupation === '演员') {
    reasons.push(signals.wantsPerformance ? '影视表演优先：演员' : '表演相关优先：演员');
    return signals.wantsPerformance ? 64 : 18;
  }
  if (person.tags.includes('表演') || includesAny(`${person.name} ${person.bio} ${person.tags.join(' ')}`, PERFORMANCE_RELATED_HINTS)) {
    reasons.push('影视表演相关形象');
    return signals.wantsPerformance ? 14 : 8;
  }
  return 0;
}

function getPerformancePriority(person: VolcVirtualHuman) {
  if (person.occupation === '演员') return 2;
  if (person.tags.includes('表演') || includesAny(`${person.name} ${person.bio} ${person.tags.join(' ')}`, PERFORMANCE_RELATED_HINTS)) return 1;
  return 0;
}

function scorePerson(signals: MatchSignals, person: VolcVirtualHuman): VirtualHumanMatch {
  const reasons: string[] = [];
  let score = 20;

  const personGender = normalizeGender(person.gender);
  if (signals.gender && personGender) {
    if (signals.gender === personGender) {
      score += 36;
      reasons.push(`性别匹配：${person.gender}`);
    } else {
      score -= 60;
    }
  }

  score += scoreAge(signals, person, reasons);
  score += scoreOccupation(signals, person, reasons);
  score += scorePerformance(signals, person, reasons);

  const { score: tagScore, matchedTags } = scoreTagMatches(signals, person);
  if (matchedTags.length > 0) {
    score += tagScore;
    reasons.push(`标签匹配：${matchedTags.slice(0, 3).join('、')}`);
  }

  for (const hint of signals.styleHints) {
    if (person.tags.includes(hint) || person.bio.includes(hint) || person.name.includes(hint)) {
      score += 10;
      reasons.push(`风格接近：${hint}`);
    }
  }

  if (reasons.length === 0) {
    reasons.push('基础候选，可手动判断气质是否贴合');
  }

  return { person, score, reasons };
}

function enoughStrongMatches(matches: VirtualHumanMatch[], limit: number) {
  return matches.length >= Math.min(2, limit);
}

function filterStrongMatches(signals: MatchSignals, matches: VirtualHumanMatch[], limit: number) {
  if (!signals.hasStrongSignal) return matches;

  if (signals.gender) {
    const sameGender = matches.filter((match) => normalizeGender(match.person.gender) === signals.gender);
    const sameGenderStrong = sameGender.filter((match) => match.score >= 45);
    if (enoughStrongMatches(sameGenderStrong, limit)) return sameGenderStrong;
    const sameGenderPositive = sameGender.filter((match) => match.score > 0);
    if (enoughStrongMatches(sameGenderPositive, limit)) return sameGenderPositive;
    if (sameGender.length > 0) return sameGender;
  }

  const strong = matches.filter((match) => match.score >= 45);
  if (enoughStrongMatches(strong, limit)) return strong;

  return matches.filter((match) => match.score > 0);
}

export function matchVirtualHumans(
  input: VirtualHumanMatchInput,
  catalog: readonly VolcVirtualHuman[],
  limit = 12,
): VirtualHumanMatch[] {
  const signals = getSignals(input);
  const sorted = catalog
    .map((person) => scorePerson(signals, person))
    .sort((a, b) => (
      b.score - a.score
      || getPerformancePriority(b.person) - getPerformancePriority(a.person)
      || a.person.name.localeCompare(b.person.name, 'zh-CN')
    ));

  return filterStrongMatches(signals, sorted, limit).slice(0, Math.max(1, limit));
}

export function matchDistinctVirtualHumans(
  inputs: readonly VirtualHumanBatchMatchInput[],
  catalog: readonly VolcVirtualHuman[],
  options: VirtualHumanBatchMatchOptions = {},
): VirtualHumanBatchMatch[] {
  const limitPerInput = options.limitPerInput ?? 12;
  const usedAssetIds = new Set(options.reservedAssetIds ?? []);

  return inputs.map((input) => {
    const candidates = matchVirtualHumans(input, catalog, limitPerInput);
    const match = candidates.find((candidate) => !usedAssetIds.has(candidate.person.assetId))
      ?? candidates[0]
      ?? null;

    if (match) usedAssetIds.add(match.person.assetId);

    return {
      key: input.key,
      match,
      candidates,
    };
  });
}
