import type { CharacterProfile } from '@/types';

export interface VoiceCorpusSample {
  id: string;
  fileName: string;
  displayName: string;
  sourceWork?: string;
  sourceCharacter?: string;
  language?: string;
  gender?: string;
  ageAppearance?: string;
  heat?: string;
  voiceActor?: string;
  voiceTags?: string;
  roleSuggestion?: string;
  sampleText?: string;
  durationSec?: number;
  remoteAudioUrl?: string;
  audioUrl: string;
}

export interface VoiceCorpusRecommendation {
  sample: VoiceCorpusSample;
  score: number;
  reasons: string[];
}

export type VoiceGender = 'male' | 'female';
export type VoiceAgeBand = 'child' | 'teen' | 'young' | 'mature' | 'elder' | 'nonhuman';

export interface VoiceMatchTarget {
  gender?: VoiceGender;
  ageBands: VoiceAgeBand[];
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}

export interface VoiceCorpusStats {
  total: number;
  male: number;
  female: number;
  unknownGender: number;
  ageBands: Record<VoiceAgeBand, number>;
}

export interface VoiceMatchContext {
  characterName: string;
  profile?: CharacterProfile;
  projectSummary?: string;
  projectStyle?: string;
}

let voiceCorpusCache: VoiceCorpusSample[] | null = null;

function normalizeText(value: string | undefined) {
  return (value ?? '').toLowerCase();
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

const MALE_GENDER_KEYWORDS = [
  '未婚夫', '男主', '男性', '男人', '男生', '男孩', '父亲', '爸爸', '儿子', '哥哥', '弟弟',
  '少爷', '王子', '公子', '青年男子', '成年男性',
];

const FEMALE_GENDER_KEYWORDS = [
  '未婚妻', '女主', '女性', '女人', '女生', '女孩', '母亲', '妈妈', '女儿', '姐姐', '妹妹',
  '小姐', '夫人', '公主', '少女', '青年女子', '成年女性',
];

const AGE_BAND_KEYWORDS: Record<VoiceAgeBand, string[]> = {
  child: ['儿童', '幼态', '小孩', '孩童', '童真', '萝莉', '正太'],
  teen: ['少年', '少女', '青涩', '学生', '青春期'],
  young: ['青年', '年轻', '成年', '少女到青年', '少年到青年'],
  mature: ['成熟', '中年', '母亲', '父亲', '家长', '导师', '女王', '高位'],
  elder: ['老人', '老者', '长辈', '年迈', '沧桑'],
  nonhuman: ['神明', '长生', '非人', 'ai', '系统', '机械', '机器人'],
};

function countKeywordHits(text: string, keywords: string[]) {
  return keywords.reduce((count, keyword) => count + (text.includes(keyword.toLowerCase()) ? 1 : 0), 0);
}

function detectCharacterGender(text: string): VoiceGender | undefined {
  const maleScore = countKeywordHits(text, MALE_GENDER_KEYWORDS);
  const femaleScore = countKeywordHits(text, FEMALE_GENDER_KEYWORDS);
  if (maleScore > femaleScore) return 'male';
  if (femaleScore > maleScore) return 'female';
  return undefined;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasKeywordNearName(text: string, characterName: string, keyword: string) {
  if (!text || !characterName) return false;
  const escapedName = escapeRegExp(normalizeText(characterName));
  const escapedKeyword = escapeRegExp(keyword.toLowerCase());
  const beforeName = new RegExp(`${escapedKeyword}.{0,8}${escapedName}`);
  const afterName = new RegExp(`${escapedName}.{0,10}${escapedKeyword}`);
  return beforeName.test(text) || afterName.test(text);
}

function detectNamedGender(text: string | undefined, characterName: string): VoiceGender | undefined {
  const normalizedText = normalizeText(text);
  const maleScore = MALE_GENDER_KEYWORDS.reduce(
    (score, keyword) => score + (hasKeywordNearName(normalizedText, characterName, keyword) ? 1 : 0),
    0,
  );
  const femaleScore = FEMALE_GENDER_KEYWORDS.reduce(
    (score, keyword) => score + (hasKeywordNearName(normalizedText, characterName, keyword) ? 1 : 0),
    0,
  );
  if (maleScore > femaleScore) return 'male';
  if (femaleScore > maleScore) return 'female';
  return undefined;
}

function normalizeCorpusGender(value: string | undefined): VoiceGender | undefined {
  if (!value) return undefined;
  if (value.includes('女')) return 'female';
  if (value.includes('男')) return 'male';
  return undefined;
}

function detectAgeBands(text: string): VoiceAgeBand[] {
  const bands: VoiceAgeBand[] = [];
  const add = (band: VoiceAgeBand) => {
    if (!bands.includes(band)) bands.push(band);
  };

  Object.entries(AGE_BAND_KEYWORDS).forEach(([band, keywords]) => {
    if (includesAny(text, keywords)) add(band as VoiceAgeBand);
  });

  return bands;
}

function detectNamedAgeBands(text: string | undefined, characterName: string) {
  const normalizedText = normalizeText(text);
  const bands: VoiceAgeBand[] = [];
  const add = (band: VoiceAgeBand) => {
    if (!bands.includes(band)) bands.push(band);
  };

  Object.entries(AGE_BAND_KEYWORDS).forEach(([band, keywords]) => {
    if (keywords.some((keyword) => hasKeywordNearName(normalizedText, characterName, keyword))) {
      add(band as VoiceAgeBand);
    }
  });

  return bands;
}

function getAgeBandLabel(band: VoiceAgeBand) {
  switch (band) {
    case 'child': return '儿童';
    case 'teen': return '少年/少女';
    case 'young': return '青年';
    case 'mature': return '成熟';
    case 'elder': return '长辈';
    case 'nonhuman': return '非人/AI';
  }
}

function normalizeCorpusAgeBands(value: string | undefined) {
  return detectAgeBands(normalizeText(value));
}

function extractCharacterWindows(text: string | undefined, characterName: string, radius = 36) {
  if (!text || !characterName) return '';
  const windows: string[] = [];
  let start = 0;
  while (windows.length < 4) {
    const index = text.indexOf(characterName, start);
    if (index < 0) break;
    windows.push(text.slice(Math.max(0, index - radius), Math.min(text.length, index + characterName.length + radius)));
    start = index + characterName.length;
  }
  return windows.join(' ');
}

function buildProfileText(input: VoiceMatchContext) {
  const profile = input.profile;
  return [
    input.characterName,
    profile?.description,
    profile?.ageAppearance,
    profile?.temperament,
    profile?.bodyBuild,
    profile?.faceFeatures,
    profile?.visualAnchor,
    profile?.step3Description,
  ].filter(Boolean).join(' ');
}

function buildContextText(input: VoiceMatchContext) {
  return [
    buildProfileText(input),
    extractCharacterWindows(input.projectSummary, input.characterName),
    input.projectStyle,
  ].filter(Boolean).join(' ');
}

export function resolveVoiceMatchTarget(input: VoiceMatchContext): VoiceMatchTarget {
  const profileText = normalizeText(buildProfileText(input));
  const nameText = normalizeText(input.characterName);

  const profileGender = detectCharacterGender(profileText);
  const nameGender = detectCharacterGender(nameText);
  const namedGender = detectNamedGender(input.projectSummary, input.characterName);
  const gender = profileGender ?? nameGender ?? namedGender;
  const genderSource = profileGender ? '角色画像' : nameGender ? '角色名' : namedGender ? '剧情片段' : undefined;

  const ageBands = [
    ...detectAgeBands(profileText),
    ...detectAgeBands(nameText),
    ...detectNamedAgeBands(input.projectSummary, input.characterName),
  ].filter((band, index, array) => array.indexOf(band) === index);

  const reasons: string[] = [];
  if (gender) reasons.push(`${genderSource}判定${gender === 'female' ? '女声' : '男声'}`);
  if (ageBands.length) reasons.push(`年龄/外显：${ageBands.map(getAgeBandLabel).join('、')}`);
  if (!gender) reasons.push('性别未判定，需试听确认');

  return {
    gender,
    ageBands,
    confidence: genderSource === '角色画像' || genderSource === '角色名' ? 'high' : genderSource ? 'medium' : 'low',
    reasons,
  };
}

function scoreTone(text: string, sampleText: string, reasons: string[]) {
  let score = 0;
  const groups: Array<{ keywords: string[]; sampleKeywords: string[]; reason: string; score: number }> = [
    {
      keywords: ['冷', '克制', '理性', '高冷', '无情', 'ai', '系统', '机械', '算法'],
      sampleKeywords: ['冷', '克制', '理性', '低情绪', '沉静', '机械'],
      reason: '冷静克制感匹配',
      score: 12,
    },
    {
      keywords: ['强势', '压迫', '权威', '上位', '审判', '导师', '掌控', '命令'],
      sampleKeywords: ['权威', '压迫', '稳重', '贵族', '叙事', '威严'],
      reason: '权威压迫感匹配',
      score: 12,
    },
    {
      keywords: ['狠', '疯', '反派', '危险', '挑衅', '嘴硬', '傲慢', '毒舌'],
      sampleKeywords: ['沙哑', '攻击', '傲', '危险', '松弛', '硬汉'],
      reason: '攻击性和嘴仗质感匹配',
      score: 10,
    },
    {
      keywords: ['温柔', '治愈', '软', '甜', '善良', '纯', '妹妹'],
      sampleKeywords: ['温柔', '柔和', '甜', '轻盈', '亲和'],
      reason: '柔和亲和感匹配',
      score: 10,
    },
    {
      keywords: ['少女', '年轻', '学生', '青涩', '清亮', '灵动'],
      sampleKeywords: ['少女', '年轻', '清亮', '灵动', '活泼'],
      reason: '年轻清亮感匹配',
      score: 10,
    },
    {
      keywords: ['母亲', '成熟', '长辈', '隐忍', '疲惫', '沧桑'],
      sampleKeywords: ['成熟', '低沉', '稳重', '叙事', '沧桑'],
      reason: '成熟叙事感匹配',
      score: 10,
    },
  ];

  for (const group of groups) {
    if (includesAny(text, group.keywords) && includesAny(sampleText, group.sampleKeywords)) {
      score += group.score;
      reasons.push(group.reason);
    }
  }
  return score;
}

export async function fetchVoiceCorpusSamples(signal?: AbortSignal) {
  if (voiceCorpusCache) return voiceCorpusCache;
  const response = await fetch('/api/media/voice-corpus', { signal });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`声线库读取失败 (${response.status})：${text.slice(0, 180)}`);
  }
  const data = await response.json() as { samples?: VoiceCorpusSample[] };
  voiceCorpusCache = Array.isArray(data.samples) ? data.samples : [];
  return voiceCorpusCache;
}

export async function loadVoiceCorpusSampleBlob(sample: VoiceCorpusSample, signal?: AbortSignal) {
  const response = await fetch(sample.audioUrl, { signal });
  if (!response.ok) {
    throw new Error(`声线样本读取失败 (${response.status})`);
  }
  return response.blob();
}

export function getVoiceCorpusStats(samples: readonly VoiceCorpusSample[]): VoiceCorpusStats {
  const stats: VoiceCorpusStats = {
    total: samples.length,
    male: 0,
    female: 0,
    unknownGender: 0,
    ageBands: {
      child: 0,
      teen: 0,
      young: 0,
      mature: 0,
      elder: 0,
      nonhuman: 0,
    },
  };

  for (const sample of samples) {
    const gender = normalizeCorpusGender(sample.gender);
    if (gender === 'male') stats.male += 1;
    else if (gender === 'female') stats.female += 1;
    else stats.unknownGender += 1;

    for (const band of normalizeCorpusAgeBands(sample.ageAppearance)) {
      stats.ageBands[band] += 1;
    }
  }

  return stats;
}

function scoreAgeMatch(target: VoiceMatchTarget, sample: VoiceCorpusSample, reasons: string[]) {
  if (target.ageBands.length === 0) return 0;
  const sampleBands = normalizeCorpusAgeBands(sample.ageAppearance);
  if (sampleBands.length === 0) return 0;
  const matched = target.ageBands.filter((band) => sampleBands.includes(band));
  if (matched.length > 0) {
    reasons.push(`年龄段匹配：${matched.map(getAgeBandLabel).join('、')}`);
    return 26 + matched.length * 4;
  }
  return -18;
}

function sortAndDedupeRecommendations(
  recommendations: VoiceCorpusRecommendation[],
  limit: number,
) {
  const sorted = [...recommendations].sort((left, right) =>
    right.score - left.score || left.sample.id.localeCompare(right.sample.id),
  );
  const picked: VoiceCorpusRecommendation[] = [];
  const seenCharacters = new Set<string>();

  for (const recommendation of sorted) {
    const key = recommendation.sample.sourceCharacter || recommendation.sample.id;
    if (seenCharacters.has(key)) continue;
    picked.push(recommendation);
    seenCharacters.add(key);
    if (picked.length >= limit) return picked;
  }

  for (const recommendation of sorted) {
    if (picked.some((item) => item.sample.id === recommendation.sample.id)) continue;
    picked.push(recommendation);
    if (picked.length >= limit) break;
  }

  return picked;
}

export function recommendVoiceCorpusSamples(
  samples: readonly VoiceCorpusSample[],
  input: VoiceMatchContext,
  limit = 5,
): VoiceCorpusRecommendation[] {
  const contextText = buildContextText(input);
  const normalizedContext = normalizeText(contextText);
  const target = resolveVoiceMatchTarget(input);
  const expectedLanguage = includesAny(normalizedContext, ['英文', 'english']) ? 'EN'
    : includesAny(normalizedContext, ['日文', '日语', 'japanese']) ? 'JP'
      : includesAny(normalizedContext, ['韩文', '韩语', 'korean']) ? 'KR'
        : 'CN';

  const scored = samples
    .map((sample) => {
      const reasons: string[] = [];
      const sampleText = normalizeText([
        sample.gender,
        sample.ageAppearance,
        sample.voiceTags,
        sample.roleSuggestion,
        sample.sourceCharacter,
        sample.voiceActor,
      ].filter(Boolean).join(' '));
      let score = 0;

      const sampleGender = normalizeCorpusGender(sample.gender);
      if (target.gender && sampleGender === target.gender) {
        score += 120;
        reasons.push(target.gender === 'female' ? '性别硬匹配：女声' : '性别硬匹配：男声');
      } else if (target.gender && sampleGender && sampleGender !== target.gender) {
        score -= 1000;
        reasons.push('性别不匹配，仅兜底显示');
      } else if (!target.gender) {
        reasons.push('角色性别未判定，请试听确认');
      }

      score += scoreAgeMatch(target, sample, reasons);

      if (sample.language === expectedLanguage) {
        score += 16;
        reasons.push(`${expectedLanguage} 样本优先`);
      } else if (sample.language === 'CN') {
        score += 8;
      }

      score += scoreTone(normalizedContext, sampleText, reasons);

      if (sample.roleSuggestion && includesAny(normalizedContext, sample.roleSuggestion.split(/[/、,，\s]+/).filter(Boolean))) {
        score += 8;
        reasons.push('角色功能相近');
      }
      if (sample.heat === 'S') score += 3;
      if (sample.heat === 'A') score += 1;
      if (!reasons.length) reasons.push('作为备选声线');

      return { sample, score, reasons };
    });

  const genderMatched = target.gender
    ? scored.filter((recommendation) => normalizeCorpusGender(recommendation.sample.gender) === target.gender)
    : scored;
  const pool = genderMatched.length >= limit ? genderMatched : scored;

  return sortAndDedupeRecommendations(pool, limit);
}
