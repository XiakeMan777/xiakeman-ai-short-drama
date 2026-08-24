// ============================================================
// AssetManager 共享工具函数 & 类型 — 从 AssetManager.tsx 提取
// ============================================================

import type { Asset, ImageConcept, ImageSize } from '@/types';
import { sanitizeLegacyLiveActionPromptText } from '@/lib/characterAssetGuards';
import type { CharacterGenderHint } from '@/lib/characterIdentityHints';
import { hasHumanCharacterSheetConflict, isNonHumanSystemCharacterText } from '@/lib/nonHumanCharacterVisual';

const RESERVED_FILENAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

// ---------- 类型 ----------

export type AspectRatio = 'PORTRAIT' | 'LANDSCAPE';
export type GenerationMode = 'upload' | 'txt2img' | 'img2img';

/** 每个 concept 图片槽的运行时状态 */
export interface AssetItem {
  key: string;
  refId: string;
  identityKey?: string;
  variantKey?: string;
  variantLabel?: string;
  outfitSeq?: number;
  concept: ImageConcept;
  type: 'character' | 'scene' | 'prop';
  name: string;
  asset?: Asset;
  optimizedPrompt: string;
  generationMode: GenerationMode;
  baseAssetId?: string;
  aspectRatio: AspectRatio;
  /** 图片分辨率，不传则使用 API 配置的默认值 */
  imageSize?: ImageSize;
  isProcessing: boolean;
  error?: string;
  localBlobUrl?: string;
  /** 用户显式清空过当前槽位，需阻止自动从资产库重新回填 */
  preventAutoAssetBinding?: boolean;
}

// ---------- 工具函数 ----------

export function genId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function makeItemKey(
  type: 'character' | 'scene' | 'prop',
  name: string,
  concept: ImageConcept,
  identityKey?: string,
  variantKey?: string,
) {
  const stableName = type === 'prop' && identityKey ? identityKey : name;
  const variantSuffix = type === 'character' && variantKey ? `::${variantKey}` : '';
  return `${type}:${stableName}${variantSuffix}::${concept}`;
}

export function getCharacterOutfitVariantKey(outfitSeq: number | undefined) {
  return typeof outfitSeq === 'number' ? `outfit-${outfitSeq}` : undefined;
}

export function getCharacterOutfitVariantLabel(outfitSeq: number | undefined) {
  return typeof outfitSeq === 'number' ? `变装 ${outfitSeq}` : undefined;
}

/** 获取指定 concept 的图生图源图 concept */
export function getSourceConcept(concept: ImageConcept): ImageConcept | null {
  switch (concept) {
    case 'landscape_turnaround': return 'portrait_closeup';
    case 'portrait_outfit': return 'portrait_closeup';
    case 'landscape_outfit_turnaround': return 'portrait_outfit';
    default: return null;
  }
}

export function getSourceVariantKey(concept: ImageConcept, variantKey?: string) {
  switch (concept) {
    case 'landscape_outfit_turnaround':
      return variantKey;
    default:
      return undefined;
  }
}

export function isTurnaroundConcept(concept: ImageConcept) {
  return concept === 'landscape_turnaround' || concept === 'landscape_outfit_turnaround';
}

function containsPositiveStyleToken(styleConfig: string, tokenPattern: RegExp) {
  const compact = styleConfig.replace(/[\s\-·_/]+/g, '');
  const regex = new RegExp(tokenPattern.source, 'gi');

  for (const match of compact.matchAll(regex)) {
    const before = compact.slice(0, match.index ?? 0);
    if (!/(?:非|不|无|未|别|別|不是|不要|不想|别用|禁用)$/u.test(before)) {
      return true;
    }
  }

  return false;
}

export function isThreeDAnimeCharacterStyle(styleConfig?: string) {
  const normalized = (styleConfig ?? '').trim();
  if (!normalized) return false;
  const has3DSignal = containsPositiveStyleToken(normalized, /(?:3d|cg|三维|pbr|游戏级)/i);
  const hasAnimeSignal = containsPositiveStyleToken(normalized, /(?:动漫|国漫|二次元|仙侠|玄幻|角色设定)/i);
  return has3DSignal && hasAnimeSignal;
}

export function buildThreeDAnimeCharacterDesignEnhancement(
  styleConfig?: string,
  options: { isOfficialNoFace?: boolean; genderHint?: CharacterGenderHint; nonHumanSystem?: boolean } = {},
) {
  if (!isThreeDAnimeCharacterStyle(styleConfig)) return '';

  if (options.nonHumanSystem) {
    return [
      '3D anime CG non-human system entity design boost: stylized industrial/mechanical reference art, not a human character sheet.',
      'Use clean game-CG hard-surface materials, warning-light glow, camera lenses, speaker grilles, UI panels, metal housings, cables, sensors, and readable mechanical silhouettes.',
      'Keep the entity iconic and storyboard-reusable through a fixed red/white alarm palette, repeated device modules, and stable interface/broadcast details.',
      'Hard ban: no face, no eyes/mouth/nose, no hair, no skin, no outfit, no clothing, no human proportions, no humanoid android body, no anime character portrait, no FACE HERO CLOSE-UP, no FACE LOCK GRID.',
    ].join(' ');
  }

  const shared = '3D动漫角色设计增强 / 3D国漫CG角色设定：非真人照片、非真人棚拍、非写实演员证件照；采用风格化3D国漫CG渲染、动画电影角色比例、清晰但非真人皮肤、干净卡通化五官结构、游戏级角色设定图、PBR材质、电影级布光、柔和轮廓光、影棚级渲染；角色必须有主角/反派级视觉等级：女主/男主需要主角级剪影、签名色块、标志性装备锚点和能一眼记住的发型/眼神/服装轮廓，反派需要更鲜明的权力符号、冷峻剪影、非对称细节或专属纹章，不能只是普通好看真人脸、普通校服或无特点制服；服装结构要可读、可建模、可真实落地为cosplay服装，强调完整穿搭逻辑、可信服装构造、清晰轮廓线和明确色块关系；右侧 COSTUME / SUIT DETAIL VIEW 与 MATERIAL & TEXTURE NOTES 重点展示外套/外袍、内层、束腰/腰带/战术挂点、披肩/短披风、袖型、手套、护臂、鞋履、配饰、可拆解服装组件，并按角色原设定取舍；若角色设定包含科幻、机甲、军校、修复师、机械义体、AI、能量接口或驾驶舱，服装必须偏功能性3D动漫科幻设计：高领或完整胸甲覆盖、装甲分割线、功能缝线、机械接口、工具挂点、护臂、战术靴、可动关节和能量纹路清晰，不要自动改成仙侠长裙、披帛、古风飘带或礼服裙；材质细节按题材取舍表现丝绸、薄纱、缎面、织锦、刺绣、金属饰件、皮革拼接、合成纤维、碳纤维护甲、半透明能量层、真实缝线、精致包边、布料自然褶皱和受力分布；安全服装展示，端庄克制，非情色表达，非fetish化表达，胸口区域必须完整覆盖，不露乳沟，无低胸深V，无挑逗性开口，不强调腿部、胸部或身体凝视；不改变既有固定版式，不新增整张爆炸拆解大板，不挤占 FACE HERO CLOSE-UP。';
  const restyleReferenceRule = '3D anime restyle lock: even if the source/reference image is photoreal, repaint it into stylized 3D guoman anime CG with toon-shaded face, anime face proportions, simplified clean skin, no real skin pores, no live-action actor face, no cosplay photo, no photographic lens look.';
  const femaleCharacterRule = options.genderHint === 'female'
    ? '若为女性角色，必须明确读成女性主角：更柔和的下颌线、更小的下巴、更精致的眉眼和睫毛、更优雅的肩颈线与体态比例，不要因短发、冷感或战斗感而被读成男性；服装仍须端庄完整覆盖胸口，不露乳沟，不要低胸深V。'
    : '';

  if (options.isOfficialNoFace) {
    return `${shared} ${restyleReferenceRule} 无脸服装图只服务服装版本、体态比例、材质、配饰和装备，不得写入脸、五官、发型、肤色或肖像身份。`;
  }

  return `${shared} ${restyleReferenceRule}${femaleCharacterRule ? ` ${femaleCharacterRule}` : ''}`;
}

function getAssetSlotKey(asset: Pick<Asset, 'type' | 'name' | 'concept' | 'identityKey' | 'variantKey' | 'outfitSeq'>) {
  const identity = asset.type === 'prop' && asset.identityKey ? asset.identityKey : asset.name;
  const variant = asset.type === 'character'
    ? asset.variantKey ?? (typeof asset.outfitSeq === 'number' ? `outfit-${asset.outfitSeq}` : 'base')
    : '';
  return `${asset.type}::${identity}::${asset.concept}::${variant}`;
}

export function getAssetVersionIndex(asset: Asset, assetLibrary: readonly Asset[]) {
  const slotKey = getAssetSlotKey(asset);
  const sameSlotAssets = assetLibrary
    .filter((candidate) => getAssetSlotKey(candidate) === slotKey)
    .slice()
    .sort((a, b) => {
      const timeDiff = (a.createdAt || a.updatedAt || 0) - (b.createdAt || b.updatedAt || 0);
      return timeDiff || a.id.localeCompare(b.id);
    });
  const index = sameSlotAssets.findIndex((candidate) => candidate.id === asset.id);
  return index >= 0 ? index + 1 : 1;
}

export function getAssetVersionLabel(asset: Asset | undefined, assetLibrary: readonly Asset[]) {
  if (!asset) return '';
  return `v${getAssetVersionIndex(asset, assetLibrary)}`;
}

export function getAssetVariantLabel(asset: Pick<Asset, 'type' | 'outfitSeq' | 'variantKey'>) {
  if (asset.type !== 'character') return '';
  if (typeof asset.outfitSeq === 'number') return `变装${asset.outfitSeq}`;
  if (asset.variantKey) return asset.variantKey.replace(/^outfit-/, '变装');
  return '';
}

export function mergeManualPromptWithCurrentTemplate(manualPrompt: string, currentTemplatePrompt: string) {
  const manual = manualPrompt.trim();
  const current = currentTemplatePrompt.trim();
  if (!manual) return current;
  if (!current) return manual;
  const cleanedManual = sanitizeLegacyLiveActionPromptText(manual)
    .replace(/\b(?:Female|Male) character lock:[^.;。]*(?:[.;。]|$)/gi, ' ')
    .replace(/(?:女性主角识别锁|男性角色识别锁|女性角色补充|男性角色补充)[：:][^。]*(?:。|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!isNonHumanSystemCharacterText(current) && isNonHumanSystemCharacterText(cleanedManual)) {
    return current;
  }
  if (isNonHumanSystemCharacterText(current) && hasHumanCharacterSheetConflict(cleanedManual)) {
    return current;
  }
  return [
    '当前 Step3 模板硬约束（优先级最高，不得被历史 Prompt 覆盖削弱）：',
    current,
    '历史 Prompt 补充（已清理冲突项，仅低优先级保留角色事实）：',
    cleanedManual,
  ].join('\n\n');
}

export function formatAssetCreatedAt(asset: Pick<Asset, 'createdAt' | 'updatedAt'> | undefined) {
  const timestamp = asset?.createdAt || asset?.updatedAt;
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatAssetCreatedAtForFile(asset: Pick<Asset, 'createdAt' | 'updatedAt'> | undefined) {
  const timestamp = asset?.createdAt || asset?.updatedAt;
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function sanitizeAssetFileNameSegment(value: string | undefined) {
  return (value ?? '')
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0);
      return code <= 31 || RESERVED_FILENAME_CHARS.has(char) ? '_' : char;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '未命名';
}

export function buildAssetDownloadFileName(
  asset: Asset,
  assetLibrary: readonly Asset[],
  getConceptLabel: (concept: ImageConcept) => string,
) {
  const parts = [
    asset.name,
    getConceptLabel(asset.concept),
    getAssetVariantLabel(asset),
    getAssetVersionLabel(asset, assetLibrary),
    formatAssetCreatedAtForFile(asset),
  ].filter(Boolean);
  return `${parts.map(sanitizeAssetFileNameSegment).join('_')}.png`;
}

/** 初始化时生成角色设定板模板 prompt（纯函数，供 useEffect 调用） */
export function buildTurnaroundPromptInit(
  concept: ImageConcept,
  name: string,
  styleConfig?: string,
  exclusivePropLine?: string,
  genderHint?: CharacterGenderHint,
  nonHumanSystem = false,
): string {
  const stylePrefix = styleConfig ? `${styleConfig}，` : '';
  const isOutfitSheet = concept === 'landscape_outfit_turnaround';
  const threeDAnimeDesignBoost = buildThreeDAnimeCharacterDesignEnhancement(styleConfig, { genderHint, nonHumanSystem });
  if (nonHumanSystem) {
    const propLine = exclusivePropLine?.trim()
      ? `Stable system/equipment anchors from Step2: ${exclusivePropLine.trim()}.`
      : '';
    return [
      `${stylePrefix}16:9 horizontal SYSTEM / MECHANICAL ENTITY REFERENCE SHEET for ${name}.`,
      'This is a speaking/referenced character slot, but the visual subject is a non-human system presence, not a person.',
      'Fixed industrial board layout with clear module labels: SYSTEM HERO VIEW, DEVICE ARRAY FRONT, DEVICE ARRAY REAR/SIDE, ALARM / SENSOR STATE GRID x4, MECHANICAL MODULE DETAIL VIEW, MATERIAL & TEXTURE NOTES, INTERFACE / BROADCAST DETAIL.',
      'Show warning/alarm lights, surveillance camera clusters, speaker arrays, control panels, UI warning states, metal housings, cables, sensors, and bridge-control hardware as the identity anchors.',
      propLine,
      threeDAnimeDesignBoost,
      'Continuity Notes: keep the same red/white alarm palette, same camera/speaker array logic, same UI signal vocabulary, same metal material family, and same mechanical layout across all panels.',
      'Negative Prompt: no human, no person, no humanoid body, no android body, no face, no eyes, no mouth, no nose, no hair, no hairstyle, no skin, no outfit, no clothing, no human age/gender, no FACE HERO CLOSE-UP, no FACE LOCK GRID, no full-body character turnaround, no COSTUME / SUIT DETAIL VIEW, no story screenshot, no poster layout, no logo, no watermark.',
    ].filter(Boolean).join(' ');
  }
  const titleLabel = isOutfitSheet
    ? `CHARACTER REFERENCE | OUTFIT VERSION | ${name}`
    : `CHARACTER REFERENCE | ${name}`;
  const propLine = exclusivePropLine?.trim()
    ? ` 专属物品区：${exclusivePropLine.trim()}；只放入右侧三分之二区域的 SIGNATURE PROP / EQUIPMENT DETAIL 小窗或 MATERIAL & TEXTURE NOTES 附近的干净陈列格，不挤占左侧 FACE HERO CLOSE-UP 竖栏，不要变成动作镜头。`
    : ' 如角色有长期专属且外观稳定的签名武器、法器或随身物，只能放入 SIGNATURE PROP / EQUIPMENT DETAIL 小窗；没有明确专属物品则该小窗改为手部、鞋靴或轮廓细节。';
  const guard = `Seedance 2.0 MODULE A / CHARACTER LOCK 工业角色参考表；固定版式，不自由排版；16:9横版；只能出现同一名角色；允许且必须出现清晰英文模块标签，但只允许固定标签，不生成长段说明文字、Logo 或水印；纯白或浅灰技术背景；不出现第二个人、群像、剧情剧照、具体场景、打斗动作。${propLine} 非专属、共享、转手、状态会变化或需要特写锁材质的道具不要合入本图。`;
  const boardLayout = [
    `顶部标题栏：浅灰细边框技术标题条，清晰写入 "${titleLabel}"，标题只占很小高度`,
    '主体区采用固定工业化分区：左侧三分之一脸部竖栏，中间 FRONT/BACK 正背全身，右上 FACE LOCK GRID ×4，右中/右下为服装、材质和专属物品细节；面板标签必须清晰可见：FACE HERO CLOSE-UP、FRONT VIEW、BACK VIEW、FACE LOCK GRID ×4、COSTUME / SUIT DETAIL VIEW、MATERIAL & TEXTURE NOTES',
    'FACE HERO CLOSE-UP 必须独占画布左侧固定三分之一宽度（约33%-35%画布宽），从标题栏下沿一直延伸到主体底部；左侧竖栏下方不得再横跨 MATERIAL、服装细节、专属物品、色板或任何信息条',
    'FACE HERO CLOSE-UP 内必须是纯人脸大特写，不是头像半身照；脸部必须占左侧竖栏画面90%以上，画面只允许脸、五官、耳朵、发际线和少量头发，额头到下巴清晰完整，眼睛、鼻梁、嘴形、脸型、发际线、痣/疤/眼镜/发饰等身份锚点必须锐利；严禁出现肩颈、胸口、衣领、上半身、手部或半身构图',
    '中间区域放 FRONT VIEW 与 BACK VIEW 两个等宽全身面板；两个全身人物必须是同一角色、同一服装版本、同一身高比例、同一灯光和同一尺度；正面、背面站姿稳定，完整从头到脚展示，不做动作姿势；人物高度只占各自面板72%-78%，必须保留头顶和脚底呼吸空间，不贴边、不拉长、不瘦长化，肩宽、腰胯、腿长和靴子比例保持自然真实；整张设定图不能变成单张大头照或头像相册',
    '右上固定为 FACE LOCK GRID ×4 的2x2小格，不再使用单独不稳定的 FACE DETAIL CLOSE-UP 大面板；四格标签固定为 FRONT NEUTRAL、LEFT 3/4 NEUTRAL、RIGHT 3/4 NEUTRAL、EYES / MOUTH DETAIL NEUTRAL；四格必须同一中性表情基线、同一脸型、同一发际线、同一眉眼鼻唇、同一下颌线、同一妆面和同一灯光；不笑、不怒、不张口、不换年龄、不换脸',
    'COSTUME / SUIT DETAIL VIEW、MATERIAL & TEXTURE NOTES 与可选 SIGNATURE PROP / EQUIPMENT DETAIL 只能在右中和右下区域展示衣领、袖口、腰带、鞋靴、配饰、边缘轮廓、金属/布料/皮革/绷带等材质细节，不挤占 FACE LOCK GRID ×4 和 FRONT/BACK 全身面板',
    '取消色板区和调色块模块；MATERIAL & TEXTURE NOTES 不得做成横跨全画幅的底部栏，只能作为右侧区域内的小面板，用短标签标识 cloth、metal、leather、wet fabric、edge wear 等材质，不写大段文字',
    '整体为工业角色参考表，不是海报、不是真人棚拍写真、不做漫画分镜、不做随机贴纸拼贴；所有面板细浅灰分割线、边界规整、留白清楚，4K细节密度',
  ].join('；');
  const sheetNotes = concept === 'landscape_turnaround' || concept === 'landscape_outfit_turnaround'
    ? ' Consistency Notes: keep the same character identity, same face, same body proportion, same scale, same outfit version, and same lighting across FACE HERO CLOSE-UP, FRONT VIEW, BACK VIEW, FACE LOCK GRID ×4, and COSTUME / SUIT DETAIL VIEW. Negative Prompt: no second character, no face change, no face shape change, no hairstyle drift, no outfit version drift, no body proportion change, no stretched body, no long skinny body, no missing FACE LOCK GRID, no single unstable face detail panel, no poster layout, no story screenshot, no logo, no watermark.'
    : '';
  const genderNotes = genderHint === 'female'
    ? ' Female character lock: keep the face unmistakably female-coded, avoid masculine jaw, broad neck, heavy brow ridge, or male-coded shoulder line; preserve a safe, elegant, production-ready silhouette with full chest coverage.'
    : '';
  if (isOutfitSheet) {
    return `${stylePrefix}16:9横版构图，变装后工业角色参考表，严格按照参考图片保持同一张脸、发型可控变化、当前变装服装版本和体态比例。${guard} ${threeDAnimeDesignBoost ? `${threeDAnimeDesignBoost} ` : ''}${boardLayout} 超高清，4K细节密度，电影级角色参考表质感，结构稳定，${name}.${sheetNotes}${genderNotes}`;
  }
  return `${stylePrefix}16:9横版构图，工业角色参考表，角色严格按照参考图片保持同一张脸、同一发型、同一基础服装版本和体态比例。${guard} ${threeDAnimeDesignBoost ? `${threeDAnimeDesignBoost} ` : ''}${boardLayout} 超高清，4K细节密度，电影级角色参考表质感，结构稳定，${name}.${sheetNotes}${genderNotes}`;
}
