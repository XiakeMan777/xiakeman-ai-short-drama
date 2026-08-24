import type { CharacterProfile } from '@/types';

const STRONG_NON_HUMAN_SYSTEM_PATTERNS = [
  /\bnon[-\s]?human\b.*\b(?:system|mechanical|entity|device|broadcast|ai)\b/i,
  /\b(?:system|mechanical|broadcast|ai)\b.*\bnon[-\s]?human\b/i,
  /\bmechanical\s+entity\b/i,
  /\bsystem\s+(?:entity|presence|broadcast(?:er)?)\b/i,
  /\balarm\s+lights?\b/i,
  /\bsurveillance\s+cameras?\b/i,
  /\bspeaker\s+array\b/i,
  /\u6ca1\u6709\u5b9e\u4f53\u4eba\u7269\u5f62\u4f53/u,
  /\u65e0\u5b9e\u4f53\u4eba\u7269/u,
  /\u65e0\u4eba\u7269\u5f62\u4f53/u,
  /\u4e0d\u5177\u5907\u4eba\u7269\u5f62\u4f53/u,
  /\u6ca1\u6709\u4eba\u5f62/u,
  /\u975e\u4eba\u5f62/u,
  /\u7cfb\u7edf\u5e7f\u64ad\u8005/u,
  /\u7cfb\u7edf\u5b58\u5728/u,
];

const SYSTEM_SIGNAL_PATTERNS = [
  /\bsystem\b/i,
  /\bbroadcast(?:er)?\b/i,
  /\bai\b/i,
  /\balgorithm\b/i,
  /\bcentral\s+control\b/i,
  /\u7cfb\u7edf/u,
  /\u5e7f\u64ad/u,
  /\u4e2d\u63a7/u,
  /\u4e3b\u63a7/u,
  /\u7a0b\u5e8f/u,
  /\u7b97\u6cd5/u,
  /\u4eba\u5de5\u667a\u80fd/u,
];

const DEVICE_SIGNAL_PATTERNS = [
  /\balarm\s+lights?\b/i,
  /\bsurveillance\s+cameras?\b/i,
  /\bcamera\s+cluster\b/i,
  /\bspeaker\s+array\b/i,
  /\bcontrol\s+(?:panel|console)\b/i,
  /\bterminal\b/i,
  /\binterface\b/i,
  /\bmechanical\b/i,
  /\bdevice\b/i,
  /\bsensor\b/i,
  /\bcable\b/i,
  /\u8b66\u62a5\u706f/u,
  /\u7ea2\u767d\u8b66\u62a5/u,
  /\u76d1\u63a7\u955c\u5934/u,
  /\u6444\u50cf\u5934/u,
  /\u626c\u58f0\u5668/u,
  /\u9635\u5217/u,
  /\u63a7\u5236\u53f0/u,
  /\u7ec8\u7aef/u,
  /\u754c\u9762/u,
  /\u673a\u68b0/u,
  /\u88c5\u7f6e/u,
  /\u4f20\u611f\u5668/u,
  /\u7535\u7f06/u,
  /\u7ebf\u7f06/u,
  /\u5168\u606f/u,
  /\u6295\u5f71/u,
  /\u65e0\u4eba\u673a/u,
];

const HUMAN_FORM_PATTERNS = [
  /\bcharacter\s+reference\s+sheet\b/i,
  /\bcharacter\s+lock\b/i,
  /\bface\s+hero\s+close-up\b/i,
  /\bface\s+lock\s+grid\b/i,
  /\bsame\s+face\b/i,
  /\bsame\s+hairstyle\b/i,
  /\bfront\s+view\b/i,
  /\bback\s+view\b/i,
  /\bcostume\s*\/\s*suit\s+detail\s+view\b/i,
  /\bhumanoid\b/i,
  /\bhuman\s+(?:face|body|figure|outfit|clothing|hair)\b/i,
  /\bperson\b/i,
  /\u4eba\u5f62/u,
  /\u4eba\u7c7b/u,
  /\u4eba\u8138/u,
  /\u4eba\u7269/u,
  /\u4e94\u5b98/u,
  /\u53d1\u578b/u,
  /\u670d\u88c5/u,
  /\u8863\u670d/u,
  /\u8eab\u9ad8/u,
];

const NEGATED_HUMAN_FORM_PATTERN =
  /(?:\b(?:no|without|not)\s+(?:human|humanoid|person|human\s+operator|human\s+face|human\s+body|human\s+figure|face(?!\s+(?:change|shape|lock|hero|detail))|body(?!\s+proportion)|eyes?|mouth|nose|hair(?!style\s+(?:drift|change))|hairstyle(?!\s+(?:drift|change))|skin|outfit(?!\s+(?:version|drift|change))|clothing)\b|\u65e0\u5b9e\u4f53\u4eba\u7269|\u65e0\u4eba\u7269\u5f62\u4f53|\u4e0d\u5177\u5907\u4eba\u7269\u5f62\u4f53|\u6ca1\u6709\u4eba\u5f62|\u975e\u4eba\u5f62)/iu;

const HUMAN_CHARACTER_SHEET_CONFLICT_PATTERN =
  /FACE HERO CLOSE-UP|FACE LOCK GRID|FRONT NEUTRAL|LEFT 3\/4 NEUTRAL|RIGHT 3\/4 NEUTRAL|EYES \/ MOUTH DETAIL NEUTRAL|same face|same hairstyle|portrait identity|human face|full-body person|COSTUME \/ SUIT DETAIL VIEW|\u7eaf\u4eba\u8138|\u540c\u4e00\u5f20\u8138|\u53d1\u578b|\u4e94\u5b98|\u4eba\u8138|\u5168\u8eab\u4eba\u7269|\u670d\u88c5/u;

function countMatches(text: string, patterns: RegExp[]) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function normalizeDetectionText(value: string | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function isNonHumanSystemCharacterText(value: string | undefined): boolean {
  const text = normalizeDetectionText(value);
  if (!text) return false;
  if (STRONG_NON_HUMAN_SYSTEM_PATTERNS.some((pattern) => pattern.test(text))) return true;

  const systemScore = countMatches(text, SYSTEM_SIGNAL_PATTERNS);
  const deviceScore = countMatches(text, DEVICE_SIGNAL_PATTERNS);
  const hasHumanForm = HUMAN_FORM_PATTERNS.some((pattern) => pattern.test(text));
  const hasNegatedHumanForm = NEGATED_HUMAN_FORM_PATTERN.test(text);
  const allowsNonHumanByForm = !hasHumanForm || hasNegatedHumanForm;

  if (!allowsNonHumanByForm) return false;
  if (systemScore >= 1 && deviceScore >= 2) return true;
  return systemScore >= 2 && deviceScore >= 1;
}

export function isNonHumanSystemCharacterProfile(
  profile: Partial<CharacterProfile> | undefined,
  extraText: string | undefined = '',
): boolean {
  return isNonHumanSystemCharacterText([
    extraText,
    profile?.name,
    profile?.description,
    profile?.step3Description,
    profile?.temperament,
    profile?.bodyBuild,
    profile?.faceFeatures,
    profile?.hairStyle,
    profile?.defaultOutfit,
    profile?.accessories,
    profile?.visualAnchor,
  ].filter(Boolean).join('\n'));
}

export function hasHumanCharacterSheetConflict(value: string | undefined): boolean {
  return HUMAN_CHARACTER_SHEET_CONFLICT_PATTERN.test(value ?? '');
}
