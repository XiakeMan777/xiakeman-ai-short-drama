const EXCLUDED_CHARACTER_NAMES = new Set([
  '系统',
  '旁白',
  '对白',
  '台词',
  '内心OS',
  '内心独白',
  '世界观旁白',
  '系统播报',
  '声音',
  '音效',
  '画外音',
  '画面',
  '镜头',
  '场景',
]);

const EVENT_LIKE_CHARACTER_NAME_PATTERN =
  /(背刺|刺杀|刺入|刺穿|穿胸|偷袭|围攻|追杀|逃亡|对峙|交锋|打斗|战斗|搏斗|重生|醒来|推门|治疗|救治|交易|谈判|检查|受伤|死亡|倒地|惨叫|反击|坠落)/;

const STABLE_EVENT_CHARACTER_NAME_ALLOWLIST = new Set([
  '同门背刺者',
  '背叛同门修士',
]);

const ABSTRACT_GROUP_NAME_PATTERN =
  /^(同门|敌人|对手|众人|人群|群体|旁观者|围观者|守备队|守军|巡逻队|护卫队|守卫们|侍卫们|伤员们|杂役们)$/;

const PSEUDO_CHARACTER_NAME_PATTERN =
  /(\u8c01|\u54ea\u91cc|\u54ea\u4e2a|\u4f55\u4eba|\u4f55\u5904|\u5982\u4f55|\u6267\u884c\u4e3b\u4f53|\u88ab\u8bb0\u4f4f\u5bf9\u8c61|\u95ed\u5507|\u95ed\u53e3|\u4e0d\u5f00\u53e3|\u5185\u5fc3\u58f0|\u5185\u5fc3OS|\u5185\u5fc3\u72ec\u767d|\u5bf9\u767d|\u53f0\u8bcd|\u7cfb\u7edf\u64ad\u62a5|\u753b\u5916\u97f3|\u97f3\u6548|\u58f0\u97f3|\u53e3\u578b|\u4ec5\u4ee5)/;

const OBJECT_LIKE_CHARACTER_NAME_PATTERN =
  /(残屑|样本|烂肉|腐肉|甲壳|渗液|污布|铁盆|伤口|清创物|污染物|尸块|肉块)/;

const CHARACTER_ASSET_ACTION_SEGMENT_PATTERN =
  /(背刺|刺杀|刺入|刺穿|穿胸|出剑|偷袭|围攻|追杀|对峙|交锋|打斗|战斗|搏斗|受伤|死亡|倒地|血线|血迹|两人|二人|多人|第二人|同框|群像|剧照|剧情截图|互动|攻击|反击|压制)/;

const CHARACTER_WEAPON_PHRASE_PATTERN =
  /(?:背着|背负|佩戴|佩|配|手持|握着|拿着|提着|持有|携带)?(?:带有|带)?(?:玄火纹(?:路)?的?)?(?:修士)?(?:长剑|短剑|旧剑|剑身|剑鞘|剑柄|剑锋|刀柄|刀鞘|长刀|短刀|匕首|弓箭|长枪|枪械|法杖|法器|武器)(?:[^，；。]*)?/g;

const STABLE_OUTFIT_VISUAL_TOKEN_PATTERN =
  /(衣|袍|衫|裙|裤|靴|鞋|甲|盔|护甲|铠甲|战甲|白大褂|制服|斗篷|披风|外套|夹克|长袍|法袍|短衫|布衫|绷带|腰带|袖|领|兜帽|面罩|发饰|冠|黑|白|灰|银|蓝|红|金|绿|棕|皮革|金属|布料|破旧|染血|药渍|污渍|剪裁|材质)/;

const ACTION_OR_STATUS_ONLY_OUTFIT_PATTERN =
  /(出场|背刺|刺杀|刺入|刺穿|穿胸|出剑|剑锋|反手|抓住|攻击|反击|对峙|交锋|打斗|战斗|搏斗|倒地|受伤|重伤|濒死|死亡|咳血|喷血|拖尸|推搡|枪口|枪托|手持|握着|拿着|提着|持剑|拿枪|武器)/;

const CHARACTER_EXTRA_HANDHELD_PROP_PATTERN =
  /(肩上挂着旧式步枪|肩挂旧式步枪|旧式步枪|步枪|短枪|枪械|枪托|枪口|手里常拿敲床用的棍子|手持敲床用棍子|手持棍子|常拿棍子敲床|拿棍子敲床|棍子|斧锤|斧头|铁锤|手持物|背负物|可分离道具|配饰：[^；。]*?(?:步枪|棍子)[^；。]*)/g;

const STABLE_OUTFIT_KEYWORD_PATTERN =
  /(白大褂|灰布短衫|灰黑护甲|玄色法袍|黑色护甲|银白战甲|深蓝夜行衣|[黑白灰银蓝红金绿棕青紫玄][^，；。、]{0,8}(?:衣|袍|衫|裙|裤|靴|鞋|甲|盔|护甲|铠甲|战甲|大褂|制服|斗篷|披风|外套|夹克|绷带))/g;

function cleanEntityLabel(value: string) {
  return value
    .replace(/[*`#]/g, '')
    .replace(/^(?:\[|\]|【|】)+/, '')
    .replace(/(?:\[|\]|【|】)+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForComparison(value: string) {
  return cleanEntityLabel(value).replace(/[，。、《》“”‘’：:；;！!？?（）()[\]【】_\-—~·,.]/g, '');
}

function extractStableOutfitKeywords(value: string) {
  const matches = cleanEntityLabel(value).match(STABLE_OUTFIT_KEYWORD_PATTERN) ?? [];
  return new Set(matches.map((item) => normalizeForComparison(item)).filter(Boolean));
}

export function shouldUseVisualCharacterName(name: string | undefined): boolean {
  const normalized = cleanEntityLabel(name ?? '');
  if (!normalized || normalized.length > 20) return false;
  if (isGloballyInvalidVisualCharacterName(normalized)) return false;
  if (STABLE_EVENT_CHARACTER_NAME_ALLOWLIST.has(normalized)) return true;
  return !EVENT_LIKE_CHARACTER_NAME_PATTERN.test(normalized);
}

export function isGloballyInvalidVisualCharacterName(name: string | undefined): boolean {
  const normalized = cleanEntityLabel(name ?? '');
  if (!normalized) return true;
  if (EXCLUDED_CHARACTER_NAMES.has(normalized)) return true;
  if (ABSTRACT_GROUP_NAME_PATTERN.test(normalized)) return true;
  if (OBJECT_LIKE_CHARACTER_NAME_PATTERN.test(normalized)) return true;
  return PSEUDO_CHARACTER_NAME_PATTERN.test(normalized);
}

export function getSafePropHolderLabel(holder: string | undefined): string {
  const normalized = cleanEntityLabel(holder ?? '');
  if (!normalized || normalized === '无' || normalized === '未知') return '';
  if (normalized === '场景道具') return normalized;
  return shouldUseVisualCharacterName(normalized) ? normalized : '场景道具';
}

const LEGACY_LIVE_ACTION_PROMPT_CONFLICT_PATTERN =
  /(演员定妆照|真人棚拍|真人照片|真人证件照|角色设定证件照|证件照质感|写真棚拍|棚拍写真|AI真人脸|真人头像|网红自拍脸|自拍脸|皮肤毛孔级真人写实|摄影棚皮肤质感|真实皮肤纹理|photoreal|live-action|id photo|headshot|studio portrait|cosplay photo)/i;

const LEGACY_LIVE_ACTION_NEGATION_PATTERN =
  /(不是|不要|不能|避免|禁止|不得|无|非|拒绝|no\b|without\b|not\b)/i;

export function sanitizeLegacyLiveActionPromptText(description: string): string {
  const normalized = cleanEntityLabel(description);
  if (!normalized) return '';

  const segments = normalized
    .split(/[\n；;。]+/)
    .map((segment) => cleanEntityLabel(segment))
    .filter(Boolean)
    .filter((segment) => {
      if (!LEGACY_LIVE_ACTION_PROMPT_CONFLICT_PATTERN.test(segment)) return true;
      return LEGACY_LIVE_ACTION_NEGATION_PATTERN.test(segment);
    });

  return [...new Set(segments)].join('；') || '历史覆盖 Prompt 的旧写实影像倾向已清理，仅使用当前 Step3 模板。';
}

export function sanitizeCharacterAssetPromptText(
  description: string,
  options: { allowSignatureProps?: boolean } = {},
): string {
  const allowSignatureProps = !!options.allowSignatureProps;
  const segments = description
    .split(/[\n；;。]+/)
    .map((segment) => cleanEntityLabel(segment))
    .filter(Boolean)
    .map((segment) => {
      const preserveSignatureSegment = allowSignatureProps && /专属物品设定|专属物品区|角色专属物品/.test(segment);
      return segment
        .replace(preserveSignatureSegment ? /$^/g : CHARACTER_WEAPON_PHRASE_PATTERN, '')
        .replace(preserveSignatureSegment ? /$^/g : CHARACTER_EXTRA_HANDHELD_PROP_PATTERN, '')
        .replace(/[，、；;\s]+$/g, '')
        .replace(/^[，、；;\s]+/g, '')
        .trim();
    })
    .filter((segment) => {
      if (!segment) return false;
      if (allowSignatureProps && /专属物品设定|专属物品区|角色专属物品/.test(segment)) return true;
      return !CHARACTER_ASSET_ACTION_SEGMENT_PATTERN.test(segment);
    });

  return [...new Set(segments)].join('；') || '单人角色设定，面部、发型、服装轮廓清晰稳定';
}

export function isBaseOutfitSeq(outfitSeq: number | undefined): boolean {
  return typeof outfitSeq !== 'number' || !Number.isFinite(outfitSeq) || outfitSeq <= 1;
}

export function shouldCreateOutfitVariantSlot(
  outfit: { outfitSeq?: number; outfitDesc?: string; needsNewImage?: boolean },
  baseDescription: string | undefined,
): boolean {
  if (!outfit.needsNewImage) return false;
  if (typeof outfit.outfitSeq !== 'number' || !Number.isFinite(outfit.outfitSeq)) return false;
  if (!isLikelyStableOutfitVariant(outfit.outfitDesc)) return false;

  const hasBaseDescription = !!baseDescription?.trim();
  if (isBaseOutfitSeq(outfit.outfitSeq) && !hasBaseDescription) return false;

  return areOutfitDescriptionsVisuallyDistinct(outfit.outfitDesc, baseDescription);
}

export function isLikelyStableOutfitVariant(outfitDesc: string | undefined): boolean {
  const normalized = cleanEntityLabel(outfitDesc ?? '');
  if (!normalized) return false;
  const hasStableVisualOutfit = STABLE_OUTFIT_VISUAL_TOKEN_PATTERN.test(normalized);
  if (!hasStableVisualOutfit && ACTION_OR_STATUS_ONLY_OUTFIT_PATTERN.test(normalized)) {
    return false;
  }
  return hasStableVisualOutfit;
}

export function areOutfitDescriptionsVisuallyDistinct(outfitDesc: string | undefined, baseDescription: string | undefined): boolean {
  const outfit = normalizeForComparison(outfitDesc ?? '');
  const base = normalizeForComparison(baseDescription ?? '');
  if (!outfit) return false;
  if (!base) return true;
  if (base.includes(outfit) || outfit.includes(base)) return false;

  const outfitKeywords = extractStableOutfitKeywords(outfitDesc ?? '');
  const baseKeywords = extractStableOutfitKeywords(baseDescription ?? '');
  if (outfitKeywords.size > 0 && baseKeywords.size > 0) {
    for (const keyword of outfitKeywords) {
      if (baseKeywords.has(keyword)) return false;
    }
  }

  const outfitChars = new Set([...outfit]);
  const baseChars = new Set([...base]);
  if (outfitChars.size === 0) return false;

  let shared = 0;
  for (const char of outfitChars) {
    if (baseChars.has(char)) shared += 1;
  }

  return shared / outfitChars.size < 0.72;
}
