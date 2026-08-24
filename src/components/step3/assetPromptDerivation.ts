import type { CharacterOutfit, CharacterProfile, PropConsistency, SceneInfo, ScriptAnalysis } from '@/types';
import { CHARACTER_IMAGE_CONCEPTS as CHAR_CONCEPTS } from '@/types';
import { getSafePropHolderLabel, sanitizeCharacterAssetPromptText } from '@/lib/characterAssetGuards';
import { getCharacterExclusiveProps } from '@/lib/characterExclusiveProps';
import { inferCharacterGenderHint, type CharacterGenderHint } from '@/lib/characterIdentityHints';
import { isNonHumanSystemCharacterProfile } from '@/lib/nonHumanCharacterVisual';
import { getPropIdentityKey } from '@/lib/propTracking';
import type { AssetItem } from './assetUtils';
import { buildThreeDAnimeCharacterDesignEnhancement, buildTurnaroundPromptInit, escapeRegExp } from './assetUtils';

type DescriptionItem = Pick<AssetItem, 'type' | 'name' | 'concept' | 'identityKey' | 'variantKey' | 'variantLabel' | 'outfitSeq'>;
type ContextItem = Pick<AssetItem, 'type' | 'name' | 'concept' | 'identityKey' | 'variantKey' | 'variantLabel' | 'outfitSeq'>;

export type CharacterFocusTier = 'lead' | 'key' | 'support';
export type AssetPromptSourceTone = 'step2' | 'structured' | 'script' | 'raw';

export interface AssetPromptSourceEntry {
  label: string;
  value: string;
  tone: AssetPromptSourceTone;
}

export interface AssetPromptSourcePreview {
  descriptionSources: AssetPromptSourceEntry[];
  contextSources: AssetPromptSourceEntry[];
}

export interface CharacterFocusProfile {
  tier: CharacterFocusTier;
  label: string;
  rank: number;
  score: number;
}

function normalizeText(value: string | undefined) {
  return value?.trim() ?? '';
}

function uniqueParts(parts: Array<string | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of parts) {
    const normalized = normalizeText(part);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function joinParts(parts: Array<string | undefined>, separator = '；') {
  return uniqueParts(parts).join(separator);
}

function clipText(value: string | undefined, max = 220) {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function makeSourceEntry(
  label: string,
  value: string | undefined,
  tone: AssetPromptSourceTone,
  max = 220,
): AssetPromptSourceEntry | null {
  const normalized = clipText(value, max);
  if (!normalized) return null;
  return { label, value: normalized, tone };
}

function dedupeSourceEntries(entries: Array<AssetPromptSourceEntry | null>) {
  const seen = new Set<string>();
  const result: AssetPromptSourceEntry[] = [];

  for (const entry of entries) {
    if (!entry) continue;
    const key = `${entry.label}:${entry.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }

  return result;
}

function pickPrimaryOutfit(
  outfits: Array<{ outfitSeq: number; outfitDesc: string; needsNewImage: boolean; storyboardRange?: string }>,
) {
  if (outfits.length === 0) return undefined;
  const needsImageOutfits = outfits.filter((outfit) => outfit.needsNewImage);
  const candidates = needsImageOutfits.length > 0 ? needsImageOutfits : outfits;
  return candidates.slice().sort((a, b) => b.outfitSeq - a.outfitSeq)[0];
}

function pickBaseOutfit(
  outfits: Array<{ outfitSeq: number; outfitDesc: string; needsNewImage: boolean; storyboardRange?: string }>,
) {
  if (outfits.length === 0) return undefined;
  return outfits.find((outfit) => outfit.outfitSeq === 1)
    ?? outfits.slice().sort((a, b) => a.outfitSeq - b.outfitSeq)[0];
}

function findSelectedOutfit(
  item: Pick<DescriptionItem, 'outfitSeq' | 'variantKey' | 'concept'>,
  outfits: Array<{ outfitSeq: number; outfitDesc: string; needsNewImage: boolean; storyboardRange?: string }>,
) {
  if (typeof item.outfitSeq === 'number') {
    const matched = outfits.find((outfit) => outfit.outfitSeq === item.outfitSeq);
    if (matched) return matched;
  }
  if (item.variantKey) {
    const matched = outfits.find((outfit) => `outfit-${outfit.outfitSeq}` === item.variantKey);
    if (matched) return matched;
  }
  return isCharacterOutfitConcept(item.concept) ? pickPrimaryOutfit(outfits) : pickBaseOutfit(outfits);
}

function isCharacterOutfitConcept(concept: DescriptionItem['concept']) {
  return concept === 'portrait_outfit' || concept === 'landscape_outfit_turnaround';
}

function isCharacterSettingSheetConcept(concept: DescriptionItem['concept']) {
  return concept === 'landscape_turnaround' || concept === 'landscape_outfit_turnaround';
}

type CharacterSheetPromptItem = Pick<ContextItem, 'name' | 'concept' | 'variantLabel' | 'outfitSeq'>;
type CharacterSheetPromptOutfit = Pick<CharacterOutfit, 'outfitSeq' | 'outfitDesc'>
  & Partial<Pick<CharacterOutfit, 'characterName' | 'storyboardRange' | 'needsNewImage'>>;

interface CharacterSheetPromptSectionsInput {
  item: CharacterSheetPromptItem;
  profile?: Partial<CharacterProfile>;
  selectedOutfit?: CharacterSheetPromptOutfit;
  exclusivePropLine?: string;
  consistencyBlock?: string;
  isOfficialNoFace?: boolean;
  genderHint?: CharacterGenderHint;
  nonHumanSystem?: boolean;
}

function buildOutfitVersionLine(input: CharacterSheetPromptSectionsInput) {
  const outfit = input.selectedOutfit;
  if (!outfit?.outfitDesc) return '';
  const label = input.item.variantLabel ?? `Outfit ${outfit.outfitSeq}`;
  const range = outfit.storyboardRange ? `; range: ${outfit.storyboardRange}` : '';
  return `${label}: ${outfit.outfitDesc}${range}`;
}

function buildCharacterGenderNotes(input: CharacterSheetPromptSectionsInput) {
  if (input.genderHint === 'female') {
    return {
      identity: input.isOfficialNoFace
        ? 'Gender anchor: female body reference only; keep clothing version, body proportion, silhouette, accessories, and equipment, but never face identity.'
        : 'Gender anchor: clearly female-coded identity with a softer jawline, smaller chin, delicate brows and eyelashes, and an elegant shoulder-neck line; do not let short hair or a cool temperament make the character read as male.',
      fullPrompt: input.isOfficialNoFace
        ? 'If a female official no-face outfit/body reference is used, keep the body line feminine and graceful while still removing every face cue.'
        : 'If the character is female, the sheet must read clearly female without becoming sexualized; keep the silhouette graceful, production-safe, and unmistakably feminine.'
        ,
      consistency: 'Keep the female-coded face and body line stable across all panels; do not drift into masculine jaw, broad neck, or male-coded shoulder line.',
      negative: input.isOfficialNoFace
        ? 'Negative Prompt: no face, no facial features, no hairstyle, no skin identity, no portrait identity, no recognizable person, no masculine face drift, no male-coded facial identity.'
        : 'Negative Prompt: no masculine jaw, no broad neck, no heavy brow ridge, no male-coded shoulder line, no male read, no face change, no face shape change, no hairstyle drift, no body proportion drift.',
    };
  }

  if (input.genderHint === 'male') {
    return {
      identity: input.isOfficialNoFace
        ? 'Gender anchor: male body reference only; keep clothing version, body proportion, silhouette, accessories, and equipment, but never face identity.'
        : 'Gender anchor: clearly male-coded identity; keep the face and body structure firmly masculine and do not drift into feminine read.',
      fullPrompt: '',
      consistency: 'Keep the male-coded face and body line stable across all panels; do not drift into feminine facial structure or body silhouette.',
      negative: input.isOfficialNoFace
        ? 'Negative Prompt: no face, no facial features, no hairstyle, no skin identity, no portrait identity, no recognizable person.'
        : 'Negative Prompt: no feminine face drift, no delicate jawline, no narrow shoulders with feminine read, no face change, no face shape change, no hairstyle drift, no body proportion drift.',
    };
  }

  return {
    identity: '',
    fullPrompt: '',
    consistency: '',
    negative: '',
  };
}

function buildNonHumanSystemDescriptionLine(input: CharacterSheetPromptSectionsInput, max = 360) {
  const profileLine = clipText(buildCharacterVisualDescription(input.profile ?? {}), max);
  const sourceLine = clipText(input.consistencyBlock, Math.min(max, 220));
  return uniqueParts([profileLine, sourceLine]).join(' | ');
}

function buildCharacterIdentitySummary(input: CharacterSheetPromptSectionsInput) {
  const name = normalizeText(input.item.name) || 'character';
  if (input.nonHumanSystem) {
    const descriptionLine = buildNonHumanSystemDescriptionLine(input, 420);
    return [
      `Character Identity Summary: ${name} is a non-human system / mechanical broadcast entity, not a person.`,
      descriptionLine ? `Step2 visual anchor: ${descriptionLine}.` : '',
      'Represent the character through fixed system hardware, warning signals, surveillance devices, speaker arrays, interface panels, and mechanical materials; do not invent a human face, body, hairstyle, outfit, skin, or humanoid android form.',
    ].filter(Boolean).join(' ');
  }

  const genderNotes = buildCharacterGenderNotes(input);

  if (input.isOfficialNoFace) {
    return `Character Identity Summary: ${name} is represented only as a no-face outfit/body reference; use this sheet for clothing version, body proportion, material, accessories, and equipment, not face identity.${genderNotes.identity ? ` ${genderNotes.identity}` : ''}`;
  }

  const profile = input.profile ?? {};
  const profileLine = clipText(buildCharacterVisualDescription(profile), 420);
  const outfitLine = buildOutfitVersionLine(input);
  const parts = uniqueParts([
    name,
    profileLine,
    outfitLine ? `Current outfit version: ${outfitLine}` : '',
  ]);

  return `Character Identity Summary: ${parts.join(' | ') || name}.${genderNotes.identity ? ` ${genderNotes.identity}` : ''}`;
}

function buildFullCharacterSheetPromptSection(input: CharacterSheetPromptSectionsInput) {
  const name = normalizeText(input.item.name) || 'character';
  const outfitLine = buildOutfitVersionLine(input);
  const genderNotes = buildCharacterGenderNotes(input);

  if (input.nonHumanSystem) {
    const descriptionLine = buildNonHumanSystemDescriptionLine(input, 320);
    return [
      `Full Character Sheet Image Prompt: Create a controlled 16:9 SYSTEM / MECHANICAL ENTITY REFERENCE SHEET for ${name}.`,
      descriptionLine ? `Preserve the exact Step2 mechanical/system visual facts: ${descriptionLine}.` : '',
      'Use a clean industrial reference-board layout with fixed modules: SYSTEM HERO VIEW, DEVICE ARRAY FRONT, DEVICE ARRAY REAR/SIDE, ALARM / SENSOR STATE GRID x4, MECHANICAL MODULE DETAIL VIEW, MATERIAL & TEXTURE NOTES, INTERFACE / BROADCAST DETAIL.',
      'Visualize the entity as its system presence: red/white alarm lights, surveillance camera clusters, speaker arrays, warning UI panels, metal housings, cables, bridge-control console fragments, sensors, and signal states.',
      'Do not use FACE HERO CLOSE-UP, FACE LOCK GRID, human FRONT/BACK full-body panels, human portrait modules, human face, five facial features, hairstyle, clothing, skin, age, gender, or humanoid android body.',
    ].filter(Boolean).join(' ');
  }

  if (input.isOfficialNoFace) {
    return [
      `Full Character Sheet Image Prompt: Create a no-face outfit/body reference sheet for ${name}.`,
      outfitLine ? `Use clothing version ${outfitLine}.` : 'Use the current clothing version from Step2.',
      'Show clothing version, body proportion, material, outfit silhouette, accessories, and equipment only.',
      ...(genderNotes.fullPrompt ? [genderNotes.fullPrompt] : []),
    ].join(' ');
  }

  switch (input.item.concept) {
    case 'portrait_closeup':
      return [
        `Full Character Sheet Image Prompt: Create a standardized front-facing portrait reference for ${name}; focus on face identity and portrait framing.`,
        'Lock facial features, face shape, hairline, hairstyle, age feel, expression baseline, and identity anchors.',
        'Keep the shoulder line, neckline, and a small amount of costume context visible so the portrait reads as a proper character reference, not a pure head crop.',
        ...(genderNotes.fullPrompt ? [genderNotes.fullPrompt] : []),
        'Keep the image as a clean standardized portrait reference, not a cropped headshot or story screenshot.',
      ].join(' ');
    case 'landscape_turnaround':
      return [
        `Full Character Sheet Image Prompt: Create the existing controlled 16:9 CHARACTER REFERENCE SHEET for ${name}.`,
        'Preserve the industrial layout modules: FACE HERO CLOSE-UP, FRONT VIEW, BACK VIEW, FACE LOCK GRID ×4, COSTUME / SUIT DETAIL VIEW, MATERIAL & TEXTURE NOTES.',
        'The left FACE HERO CLOSE-UP remains the primary identity lock; the FACE LOCK GRID ×4 must be a fixed 2x2 set of neutral expression/angle close-ups: FRONT NEUTRAL, LEFT 3/4 NEUTRAL, RIGHT 3/4 NEUTRAL, EYES / MOUTH DETAIL NEUTRAL.',
        'FRONT VIEW and BACK VIEW inherit the same face, base outfit version, and scale, but must keep natural full-body proportions with head and feet breathing room; do not stretch the figure to fill the panel.',
        ...(genderNotes.fullPrompt ? [genderNotes.fullPrompt] : []),
        'The sheet must not become a single oversized headshot, an avatar collage, or a single unstable face detail panel.',
      ].join(' ');
    case 'portrait_outfit':
      return [
        `Full Character Sheet Image Prompt: Create a new outfit portrait version for ${name}.`,
        outfitLine ? `Use outfit version ${outfitLine}.` : 'Use the selected Step2 outfit version.',
        'Keep the same face identity, body proportion, and identity anchors while presenting the new clothing version clearly.',
        ...(genderNotes.fullPrompt ? [genderNotes.fullPrompt] : []),
      ].join(' ');
    case 'landscape_outfit_turnaround':
      return [
        `Full Character Sheet Image Prompt: Create the existing controlled 16:9 outfit turnaround reference sheet for ${name}.`,
        outfitLine ? `Use outfit version ${outfitLine}.` : 'Use the selected Step2 outfit version.',
        'Preserve FACE HERO CLOSE-UP, FRONT VIEW, BACK VIEW, FACE LOCK GRID ×4, COSTUME / SUIT DETAIL VIEW, MATERIAL & TEXTURE NOTES; enforce outfit version consistency across all panels so later storyboards inherit the same transformation version.',
        'FACE LOCK GRID ×4 must be a fixed 2x2 set of neutral expression/angle close-ups: FRONT NEUTRAL, LEFT 3/4 NEUTRAL, RIGHT 3/4 NEUTRAL, EYES / MOUTH DETAIL NEUTRAL.',
        'FRONT VIEW and BACK VIEW must keep natural full-body proportions with head and feet breathing room; do not stretch the figure to fill the panel.',
        ...(genderNotes.fullPrompt ? [genderNotes.fullPrompt] : []),
        'The sheet must not become a single oversized headshot, an avatar collage, or a single unstable face detail panel.',
      ].join(' ');
    default:
      return `Full Character Sheet Image Prompt: Create a stable single-character visual reference for ${name}, keeping identity anchors and the Step2 description consistent.${genderNotes.fullPrompt ? ` ${genderNotes.fullPrompt}` : ''}`;
  }
}

function buildCharacterConsistencyNotes(input: CharacterSheetPromptSectionsInput) {
  const genderNotes = buildCharacterGenderNotes(input);
  const sourceNotes = uniqueParts([
    input.consistencyBlock ? `adapted script consistency: ${clipText(input.consistencyBlock, 260)}` : '',
    input.exclusivePropLine ? `signature props/equipment: ${clipText(input.exclusivePropLine, 260)}` : '',
  ]);

  if (input.nonHumanSystem) {
    return [
      'Consistency Notes: preserve the same non-human system identity across all panels: same alarm-light colors, same surveillance-camera cluster logic, same speaker-array placement, same interface language, same metal material family, same cable/sensor layout, and same warning-state vocabulary.',
      'Every panel must read as one named system entity represented through hardware and UI signals, not as a person, mascot, android, human operator, or character cosplay.',
      ...sourceNotes,
    ].join(' ');
  }

  if (input.isOfficialNoFace) {
    return [
      'Consistency Notes: preserve only clothing version, body proportion, material, outfit silhouette, accessories, and equipment.',
      'Do not inherit any face identity from official portrait assets.',
      ...(genderNotes.consistency ? [genderNotes.consistency] : []),
      ...sourceNotes,
    ].join(' ');
  }

  const conceptNote = (() => {
    switch (input.item.concept) {
      case 'portrait_closeup':
        return 'For portrait_closeup, lock facial features, face shape, hairline, hairstyle, skin tone, age feel, and visible neckline / shoulder portrait framing.';
      case 'landscape_turnaround':
        return 'For landscape_turnaround, keep the FACE HERO CLOSE-UP / FACE LOCK GRID ×4 / FRONT VIEW / BACK VIEW sheet layout; make every face panel and full-body panel the same character with natural body proportions.';
      case 'portrait_outfit':
        return 'For portrait_outfit, keep the same face identity and body proportion while showing the selected outfit version.';
      case 'landscape_outfit_turnaround':
        return 'For landscape_outfit_turnaround, enforce outfit version consistency, same character, same transformation version, fixed FACE LOCK GRID ×4 identity close-ups, natural body proportion, and reusable storyboard inheritance.';
      default:
        return 'Keep character identity, body proportion, and visual anchors stable.';
    }
  })();

  return ['Consistency Notes:', conceptNote, ...(genderNotes.consistency ? [genderNotes.consistency] : []), ...sourceNotes].join(' ');
}

function buildCharacterNegativePrompt(input: CharacterSheetPromptSectionsInput) {
  const genderNotes = buildCharacterGenderNotes(input);
  if (input.nonHumanSystem) {
    return 'Negative Prompt: no human, no person, no humanoid body, no android body, no face, no eyes, no mouth, no nose, no hair, no hairstyle, no skin, no outfit, no clothing, no portrait identity, no FACE HERO CLOSE-UP, no FACE LOCK GRID, no full-body character turnaround, no anime character sheet, no second character, no human operator, no poster layout, no story screenshot, no watermark, no logo.';
  }

  if (input.isOfficialNoFace) {
    return genderNotes.negative || 'Negative Prompt: no face, no facial features, no hairstyle, no skin identity, no portrait identity, no recognizable person, no second character, no story action, no poster layout, no watermark, no logo.';
  }

  const baseNegative = 'Negative Prompt: no face change, no face shape change, no hairstyle change, no age shift, no outfit version drift, no body proportion change, no stretched full-body figure, no long skinny body, no missing FACE LOCK GRID, no single unstable face detail panel, no pure head-only crop, no isolated face crop, no extra characters, no random accessories, no poster layout, no story screenshot, no watermark, no logo, no ID photo sheet, no beauty headshot sheet, no tiny full-body panel, no generic handsome face, no generic pretty face.';
  return `${baseNegative}${genderNotes.negative ? ` ${genderNotes.negative.replace(/^Negative Prompt:\s*/, '')}` : ''}`;
}

export function buildCharacterSheetPromptSections(input: CharacterSheetPromptSectionsInput) {
  return [
    buildCharacterIdentitySummary(input),
    buildFullCharacterSheetPromptSection(input),
    buildCharacterConsistencyNotes(input),
    buildCharacterNegativePrompt(input),
  ].join('\n');
}

function buildCharacterAssetConstraint(
  concept: DescriptionItem['concept'],
  options: { nonHumanSystem?: boolean } = {},
) {
  if (options.nonHumanSystem) {
    const sheetLine = isCharacterSettingSheetConcept(concept)
      ? 'Generate a 16:9 SYSTEM / MECHANICAL ENTITY REFERENCE SHEET. Fixed module labels must be SYSTEM HERO VIEW, DEVICE ARRAY FRONT, DEVICE ARRAY REAR/SIDE, ALARM / SENSOR STATE GRID x4, MECHANICAL MODULE DETAIL VIEW, MATERIAL & TEXTURE NOTES, and INTERFACE / BROADCAST DETAIL.'
      : 'Generate a single non-human system/device visual reference, using the named entity as a mechanical/system presence instead of a person.';
    return [
      'Internal image constraint: Seedance non-human system entity lock. This asset is still stored under the character slot because it speaks or is referenced by dialogue, but visually it is not a human character.',
      sheetLine,
      'Required visual anchors: warning/alarm lights, surveillance camera lenses, speaker arrays, control panels, UI warning states, metal housings, sensors, cables, and clean industrial materials, according to Step2 facts.',
      'Continuity: later storyboards inherit the same mechanical modules, red/white warning palette, camera/speaker layout, UI signal vocabulary, and material family.',
      'Hard ban: no FACE HERO CLOSE-UP, no FACE LOCK GRID, no human FRONT/BACK body panels, no human face, no eyes/mouth/nose, no hair, no hairstyle, no skin, no outfit/clothing, no human age/gender, no humanoid android body, no human operator, no second character, no story screenshot, no poster layout.',
    ].join(' ');
  }

  const sharedProfile = '内部提示词画像：用途=Seedance 2.0 角色锁定参考图；参考角色=后续 MODULE A / CHARACTER LOCK 的身份、脸、发型、服装版本、体态比例和专属稳定物必须分工清楚；构图=定妆照或工业角色参考表；镜头=稳定清晰；光影=柔和主光加轮廓光；连续性=后续视频继承同一身份、同一服装版本、同一体态比例和可合入的专属稳定物；视觉等级=主角/重要反派必须有清晰剪影、签名色块、角色专属纹样/装备锚点和强辨识度，避免普通好看真人脸、普通校服、普通古风白袍或无特点制服；负面=无Logo水印、无长段文字说明、无单张大头照设定板、无真人证件照。';
  if (isCharacterSettingSheetConcept(concept)) {
    return `${sharedProfile}生成16:9横版工业角色参考表 / CHARACTER REFERENCE SHEET，只能出现同一名角色；顶部标题栏写入 CHARACTER REFERENCE | 角色名；主体区采用固定工业化分区，面板标签必须清晰可见：FACE HERO CLOSE-UP、FRONT VIEW、BACK VIEW、FACE LOCK GRID ×4、COSTUME / SUIT DETAIL VIEW、MATERIAL & TEXTURE NOTES；FACE HERO CLOSE-UP 必须独占画布左侧固定三分之一宽度（约33%-35%画布宽），从标题栏下沿一直延伸到主体底部；左侧竖栏下方不得再横跨 MATERIAL、服装细节、专属物品、色板或任何信息条；FACE HERO CLOSE-UP 内必须是纯人脸大特写，不是头像半身照；脸部必须占左侧竖栏画面90%以上，画面只允许脸、五官、耳朵、发际线和少量头发，额头到下巴清晰完整，五官、脸型、发际线、发型、疤痕/眼镜/发饰等身份锚点必须锐利；严禁出现肩颈、胸口、衣领、上半身、手部或半身构图；中间区域放 FRONT VIEW 与 BACK VIEW 两个等宽全身面板，两个全身面板必须是同一角色、同一服装版本、同一自然身高比例、同一灯光和同一尺度，稳定站姿，从头到脚完整展示；FRONT/BACK 人物高度只占各自面板72%-78%，必须保留头顶和脚底呼吸空间，不贴边、不拉长、不瘦长化，服装轮廓和身体比例必须清楚；右上固定为 FACE LOCK GRID ×4 的2x2小格，标签固定为 FRONT NEUTRAL、LEFT 3/4 NEUTRAL、RIGHT 3/4 NEUTRAL、EYES / MOUTH DETAIL NEUTRAL，四格同一中性表情基线、同一脸型、同一发际线、同一眉眼鼻唇、同一下颌线、同一妆面和同一灯光，不笑、不怒、不张口、不换年龄、不换脸；服装细节面板展示衣领、袖口、腰带、鞋靴、配饰、边缘轮廓和材质；取消单独不稳定 FACE DETAIL CLOSE-UP 大面板、取消色板区和调色块模块；MATERIAL & TEXTURE NOTES 不得做成横跨全画幅的底部栏，只能作为右侧区域内的小面板；允许把该角色长期专属、外观稳定的签名武器/法器/随身物放入右侧 SIGNATURE PROP / EQUIPMENT DETAIL 小窗，用来节省 Seedance 9 张参考图预算；不出现第二个人、群像、具体场景、建筑、街道、复杂陈设、打斗动作或剧情截图；不允许海报构图、漫画分镜、随机贴纸拼贴或自由排版；除固定模块标签外不生成大段文字；非专属、共享、转手、状态会变化或需要特写锁材质的道具仍单独生成道具设定图。`;
  }
  if (isCharacterOutfitConcept(concept)) {
    return `${sharedProfile}生成单人角色变装定妆图，重点展示同一张脸、发型可控变化和完整服装造型；背景简洁纯净，服装版本要可被后续分镜明确继承；不出现第二个人、群像、具体场景、建筑、街道、复杂陈设、武器、手持道具、打斗动作或剧情截图。`;
  }
  return `${sharedProfile}生成单人角色标准正面定妆照，重点稳定五官、脸型、发际线、发型边缘、痣/疤/眼镜/发饰等身份锚点；构图为头肩像，脸部占画面约65%-75%，必须保留肩线、领口和少量服装结构，方便作为后续图生图的身份源图；背景简洁纯净，不出现第二个人、群像、具体场景、建筑、街道、复杂陈设、武器、手持道具、打斗动作或剧情截图。`;
}

function buildSceneAssetConstraint(concept: DescriptionItem['concept'] = 'scene_main') {
  if (concept === 'scene_vertical') {
    return '内部提示词画像：用途=Seedance 2.0 竖屏 WORLD LOCK 场景导演板，专供9:16竖屏视频调用，不依赖横屏图生图；参考角色=用一张竖屏 ENVIRONMENT / SET DESIGN 制作板直接锁定竖屏可拍空间、关键陈设、材质、光线、色调、机位轴线、入口/出口、障碍物位置和可复用运动空间；构图=9:16竖屏制作板，不是单张空镜；布局参考 1/2/7 的信息密度：顶部约58%-62%为一张干净、无人、可直接拍摄的竖屏主环境图，必须保留前景/中景/远景、上下安全留白、人物入画空间和镜头运动余量；底部约34%-38%为 FLOOR PLAN / TOP-DOWN BLOCKING MAP，必须是简洁高对比图纸/蓝图/浅灰底矢量式俯视图，不要照片质感、电影阴影或暗色氛围图；竖屏底部俯视图必须占底部区域至少78%宽度，LEGEND 只能做右侧窄条且不得超过底部区域宽度18%，不要额外 SIDE ELEVATION 小窗挤压地图；制作板必须出现黑底白字或深灰底白字的大号清晰模块标题条 MAIN ENVIRONMENT、TOP-DOWN BLOCKING MAP、CAMERA 1-6、LEGEND，标题条在画面分隔栏/边框上，不画进主环境图；模块标题高度约为画布高度3%-5%，CAMERA 1-6 编号和图例短标签要比普通文字放大1.5-2倍，缩略图下仍可读；俯视图固定图例颜色：ENTRY 蓝色箭头，EXIT 红色箭头，SAFE ACTION ZONE 绿色矩形，OBSTACLE / MACHINE 灰色块，STRUCTURAL COLUMN 橙棕色方块，CAMERA POSITION 蓝色编号圆点，CAMERA MOVE 蓝色虚线箭头；至少5个空间锚点必须在主环境图和俯视图中一一对应，锚点优先为 ENTRY DOOR / EXIT DOOR / CENTRAL COLUMN / RIGHT MACHINE / SAFE ACTION ZONE / HANGING CHAIN，主环境里要真实画出这些物体，俯视图用短英文标签标出这些锚点；只允许标题栏和俯视图里出现短标签、数字机位和箭头，主环境图不能出现文字；连续性=与同名横屏场景导演板共享同一地点和同一空间锚点，但独立服务竖屏视频，不把横屏画面裁切或复制成竖屏；负面=无人物、无人影、无人形、无剧情动作、无对白字幕、无Logo水印、无随机漫画分镜、无海报构图。';
  }
  return '内部提示词画像：用途=Seedance 2.0 横屏 WORLD LOCK 场景导演板，专供16:9横屏视频调用；参考角色=用一张横屏 ENVIRONMENT / SET DESIGN 制作板锁定空间结构、关键陈设、材质、光线、色调、机位轴线、入口/出口、障碍物位置和可复用运动空间；构图=16:9横屏制作板，不是单张空镜；布局参考 1/2/7：顶部约55%-60%为一张干净、宽幅、无人、可直接拍摄的主环境图；底部约40%-45%为 FLOOR PLAN / TOP-DOWN BLOCKING MAP，必须是简洁高对比图纸/蓝图/浅灰底矢量式俯视图，不要照片质感、电影阴影或暗色氛围图，显示空间俯视图、入口/出口、核心锚点、可行动路线、障碍物、角色入画安全区和 CAMERA 1-6 机位/运动箭头；横屏底部俯视图必须占底部区域至少76%宽度，LEGEND 只能做右侧窄条且不得超过底部区域宽度18%；制作板必须出现黑底白字或深灰底白字的大号清晰模块标题条 MAIN ENVIRONMENT、TOP-DOWN BLOCKING MAP、CAMERA 1-6、LEGEND，标题条在画面分隔栏/边框上，不画进主环境图；模块标题高度约为画布高度3%-5%，CAMERA 1-6 编号和图例短标签要比普通文字放大1.5-2倍，缩略图下仍可读；俯视图固定图例颜色：ENTRY 蓝色箭头，EXIT 红色箭头，SAFE ACTION ZONE 绿色矩形，OBSTACLE / MACHINE 灰色块，STRUCTURAL COLUMN 橙棕色方块，CAMERA POSITION 蓝色编号圆点，CAMERA MOVE 蓝色虚线箭头；至少5个空间锚点必须在主环境图和俯视图中一一对应，锚点优先为 ENTRY DOOR / EXIT DOOR / CENTRAL COLUMN / RIGHT MACHINE / SAFE ACTION ZONE / HANGING CHAIN，主环境里要真实画出这些物体，俯视图用短英文标签标出这些锚点；只允许标题栏和俯视图里出现短标签、数字机位和箭头，主环境图不能出现文字；连续性=与同名竖屏场景导演板共享同一地点和同一空间锚点，但独立服务横屏视频；负面=无人物、无人影、无人形、无剧情动作、无对白字幕、无Logo水印、无随机漫画分镜、无海报构图。';
}

function buildPropAssetConstraint() {
  return '内部提示词画像：用途=Seedance 2.0 道具工业锁定板 / PROP REFERENCE SHEET；参考角色=用一张横屏16:9工业道具参考表锁定道具形状、尺寸、材质、颜色、结构比例、纹理、磨损、状态版本和使用方式，供后续 Seedance 全能参考直接继承；构图=固定16:9制作板，不是单张产品照，不是剧情截图。顶部浅灰技术标题栏写 PROP REFERENCE | 道具名；主图区约45%-52%为 HERO VIEW，单个核心道具完整居中、轮廓清楚、无人物脸和复杂场景；右侧或下方约22%-28%为 ORTHOGRAPHIC VIEWS，至少包含 FRONT VIEW、SIDE VIEW、TOP VIEW 或 DETAIL CUTAWAY，用同一尺度展示正面/侧面/顶面/剖面结构；底部约22%-28%为 SCALE / HAND CONTACT、MATERIAL / TEXTURE、STATE A-B-C、USE DETAIL 小窗：SCALE / HAND CONTACT 只允许中性手部剪影、手套手或比例尺辅助锁尺寸，不画具体角色脸和剧情动作；MATERIAL / TEXTURE 展示金属/玉石/纸张/布料/皮革/玻璃等材质近景、划痕、锈迹、裂纹、反光；STATE A-B-C 展示完好/激活/破损/沾血/发光等基础描述明确或状态追踪需要的版本；USE DETAIL 展示插入、按压、打开、掉落朝向、佩挂点、锁孔接触等关键交互方式，但只做干净局部示意，不做完整人物持拿镜头。允许固定英文模块标签 PROP REFERENCE、HERO VIEW、FRONT、SIDE、TOP、SCALE、MATERIAL、STATE A/B/C、USE DETAIL、PALETTE；禁止长段中文说明、Logo、水印、价格牌、随机编号和装饰性海报文字。连续性=同一追踪道具跨分镜不得换形、换色、换材质、换状态版本或变成同类替代物；道具归属、位置、状态变化由 Step4/Step5 指定。普通小物件、配件或零散陈设可合并为 SMALL PROPS KIT 合集板，每个物件完整可辨识、留白分隔、材质清楚；核心剧情道具必须单独成板，不要和无关杂物混画。负面=无清晰人物、无角色脸、无完整人物动作、无复杂场景背景、无剧情截图、无漫画分镜、无自由贴纸拼贴。';
}

function countOccurrences(text: string, keyword: string) {
  if (!text || !keyword) return 0;
  return text.match(new RegExp(escapeRegExp(keyword), 'g'))?.length ?? 0;
}

function extractCharacterConsistencyBlock(adaptedScript: string, characterName: string) {
  if (!adaptedScript || !characterName) return undefined;
  const pattern = new RegExp(
    `\\*\\*人物一致性[｜|:]\\s*${escapeRegExp(characterName)}\\*\\*\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*|\\n###|\\n##|$)`,
    'i',
  );
  return adaptedScript.match(pattern)?.[1]?.trim();
}

function extractSceneConsistencyBlock(adaptedScript: string, sceneName: string) {
  const scenePattern = /\*\*场景一致性\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n###|\n##|$)/i;
  const sceneMatch = adaptedScript.match(scenePattern);
  if (!sceneMatch?.[1]?.trim()) return undefined;
  const block = sceneMatch[1].trim();
  return block.includes(sceneName) ? block : undefined;
}

function buildCharacterStructuredSummary(profile: Partial<CharacterProfile>) {
  return joinParts([
    normalizeText(profile.ageAppearance) ? `年龄感：${normalizeText(profile.ageAppearance)}` : '',
    normalizeText(profile.temperament) ? `气质：${normalizeText(profile.temperament)}` : '',
    normalizeText(profile.bodyBuild) ? `体型：${normalizeText(profile.bodyBuild)}` : '',
    normalizeText(profile.faceFeatures) ? `面部特征：${normalizeText(profile.faceFeatures)}` : '',
    normalizeText(profile.hairStyle) ? `发型：${normalizeText(profile.hairStyle)}` : '',
    normalizeText(profile.skinTone) ? `肤感：${normalizeText(profile.skinTone)}` : '',
    normalizeText(profile.defaultOutfit) ? `主服装：${normalizeText(profile.defaultOutfit)}` : '',
    normalizeText(profile.accessories) ? `配饰：${normalizeText(profile.accessories)}` : '',
    normalizeText(profile.visualAnchor) ? `视觉锚点：${normalizeText(profile.visualAnchor)}` : '',
  ]);
}

function buildSceneStructuredSummary(scene: Partial<SceneInfo>) {
  return joinParts([
    normalizeText(scene.environment) ? `环境：${normalizeText(scene.environment)}` : '',
    normalizeText(scene.layout) ? `空间布局：${normalizeText(scene.layout)}` : '',
    normalizeText(scene.keySetPieces) ? `关键陈设：${normalizeText(scene.keySetPieces)}` : '',
    normalizeText(scene.lighting) ? `灯光：${normalizeText(scene.lighting)}` : '',
    normalizeText(scene.weather) ? `天气/环境：${normalizeText(scene.weather)}` : '',
    normalizeText(scene.colorTone) ? `色调：${normalizeText(scene.colorTone)}` : '',
    normalizeText(scene.atmosphere) ? `氛围：${normalizeText(scene.atmosphere)}` : '',
    normalizeText(scene.timeOfDay) ? `时间：${normalizeText(scene.timeOfDay)}` : '',
  ]);
}

function buildCharacterVisualDescription(profile: Partial<CharacterProfile>) {
  return joinParts([
    profile.step3Description,
    profile.description,
    buildCharacterStructuredSummary(profile),
  ]);
}

function buildSceneVisualDescription(scene: Partial<SceneInfo>) {
  return joinParts([
    scene.step3Description,
    scene.environment,
    normalizeText(scene.layout) ? `空间布局：${normalizeText(scene.layout)}` : '',
    normalizeText(scene.keySetPieces) ? `关键陈设：${normalizeText(scene.keySetPieces)}` : '',
    normalizeText(scene.lighting) ? `灯光：${normalizeText(scene.lighting)}` : '',
    normalizeText(scene.weather) ? `天气/环境：${normalizeText(scene.weather)}` : '',
    normalizeText(scene.colorTone) ? `色调：${normalizeText(scene.colorTone)}` : '',
    normalizeText(scene.atmosphere) ? `氛围：${normalizeText(scene.atmosphere)}` : '',
    normalizeText(scene.timeOfDay) ? `时间：${normalizeText(scene.timeOfDay)}` : '',
  ]);
}

function buildPropVisualDescription(prop: Partial<PropConsistency>) {
  return joinParts([
    prop.step3Description,
    prop.appearanceDesc,
    normalizeText(prop.size) ? `大小：${normalizeText(prop.size)}` : '',
    normalizeText(prop.material) ? `材质：${normalizeText(prop.material)}` : '',
    normalizeText(prop.shapeStructure) ? `结构：${normalizeText(prop.shapeStructure)}` : '',
    normalizeText(prop.color) ? `颜色：${normalizeText(prop.color)}` : '',
    normalizeText(prop.texture) ? `质感：${normalizeText(prop.texture)}` : '',
    normalizeText(prop.condition) ? `状态：${normalizeText(prop.condition)}` : '',
    normalizeText(prop.visualAnchor) ? `视觉锚点：${normalizeText(prop.visualAnchor)}` : '',
  ]);
}

function buildPropStructuredSummary(prop: Partial<PropConsistency>) {
  return joinParts([
    normalizeText(prop.appearanceDesc) ? `外观：${normalizeText(prop.appearanceDesc)}` : '',
    normalizeText(prop.size) ? `大小：${normalizeText(prop.size)}` : '',
    normalizeText(prop.material) ? `材质：${normalizeText(prop.material)}` : '',
    normalizeText(prop.shapeStructure) ? `结构：${normalizeText(prop.shapeStructure)}` : '',
    normalizeText(prop.color) ? `颜色：${normalizeText(prop.color)}` : '',
    normalizeText(prop.texture) ? `质感：${normalizeText(prop.texture)}` : '',
    normalizeText(prop.condition) ? `状态：${normalizeText(prop.condition)}` : '',
    normalizeText(prop.visualAnchor) ? `视觉锚点：${normalizeText(prop.visualAnchor)}` : '',
  ]);
}

function buildExclusivePropSummary(prop: PropConsistency) {
  return joinParts([
    prop.propName,
    normalizeText(prop.step3Description),
    normalizeText(prop.appearanceDesc) ? `外观：${normalizeText(prop.appearanceDesc)}` : '',
    normalizeText(prop.size) ? `尺寸：${normalizeText(prop.size)}` : '',
    normalizeText(prop.material) ? `材质：${normalizeText(prop.material)}` : '',
    normalizeText(prop.shapeStructure) ? `结构：${normalizeText(prop.shapeStructure)}` : '',
    normalizeText(prop.color) ? `颜色：${normalizeText(prop.color)}` : '',
    normalizeText(prop.texture) ? `质感：${normalizeText(prop.texture)}` : '',
    normalizeText(prop.condition) ? `状态：${normalizeText(prop.condition)}` : '',
    normalizeText(prop.visualAnchor) ? `视觉锚点：${normalizeText(prop.visualAnchor)}` : '',
  ], '，');
}

function buildExclusivePropsLine(
  props: readonly PropConsistency[],
  maxProps = 3,
) {
  if (props.length === 0) return '';
  const selected = props.slice(0, maxProps).map(buildExclusivePropSummary).filter(Boolean);
  if (selected.length === 0) return '';
  return selected
    .map((propLine) => `专属物品设定：${propLine}`)
    .join('；')
    + '。作为角色设定板的独立小窗/道具陈列区，或稳定持握展示；不得遮挡脸、五官、服装廓形和主定妆图身体比例；不得变成打斗动作、剧情剧照或场景截图。';
}

export function buildAssetSourcePreview({
  item,
  analysis,
  adaptedScript = '',
}: {
  item: ContextItem;
  analysis: Pick<ScriptAnalysis, 'characterProfiles' | 'storyboards' | 'propTracking' | 'scenes' | 'outfitTracking'>;
  rawScript?: string;
  adaptedScript?: string;
}): AssetPromptSourcePreview {
  if (item.type === 'character') {
    const profile = analysis.characterProfiles?.find((entry) => entry.name === item.name);
    const outfits = analysis.outfitTracking?.filter((outfit) => outfit.characterName === item.name) ?? [];
    const selectedOutfit = findSelectedOutfit(item, outfits);
    const fallbackConsistency = extractCharacterConsistencyBlock(adaptedScript, item.name);
    const nonHumanSystem = isNonHumanSystemCharacterProfile(
      profile,
      [item.name, selectedOutfit?.outfitDesc, fallbackConsistency].filter(Boolean).join('\n'),
    );
    const exclusivePropsLine = isCharacterSettingSheetConcept(item.concept)
      ? buildExclusivePropsLine(getCharacterExclusiveProps(analysis.propTracking, item.name), 3)
      : '';

    return {
      descriptionSources: dedupeSourceEntries([
        makeSourceEntry('Step2 主描述', profile?.step3Description, 'step2'),
        makeSourceEntry(
          'Step2 角色描述',
          normalizeText(profile?.description) !== normalizeText(profile?.step3Description)
            ? profile?.description
            : '',
          'step2',
        ),
        makeSourceEntry('Step2 结构字段', buildCharacterStructuredSummary(profile ?? {}), 'structured'),
        isCharacterOutfitConcept(item.concept)
          ? makeSourceEntry(
            'Step2 变装描述',
            selectedOutfit
              ? `${item.variantLabel ?? `变装 ${selectedOutfit.outfitSeq}`}：${selectedOutfit.outfitDesc}${selectedOutfit.storyboardRange ? `；范围：${selectedOutfit.storyboardRange}` : ''}`
              : '',
            'structured',
          )
          : null,
        !profile ? makeSourceEntry('改编稿人物一致性', fallbackConsistency, 'script') : null,
        makeSourceEntry('Step2 专属物品', exclusivePropsLine, 'structured', 360),
      ]),
      contextSources: dedupeSourceEntries([
        makeSourceEntry('角色设定图约束', buildCharacterAssetConstraint(item.concept, { nonHumanSystem }), 'structured'),
        makeSourceEntry('角色设定板专属物品规则', exclusivePropsLine, 'structured', 360),
        makeSourceEntry('改编稿人物一致性', fallbackConsistency, 'script'),
      ]),
    };
  }

  if (item.type === 'scene') {
    const scene = analysis.scenes?.find((entry) => entry.name === item.name);
    const sceneConsistency = extractSceneConsistencyBlock(adaptedScript, item.name);

    return {
      descriptionSources: dedupeSourceEntries([
        makeSourceEntry('Step2 主描述', scene?.step3Description, 'step2'),
        makeSourceEntry('Step2 场景字段', buildSceneStructuredSummary(scene ?? {}), 'structured'),
        !scene ? makeSourceEntry('改编稿场景一致性', sceneConsistency, 'script') : null,
      ]),
      contextSources: dedupeSourceEntries([
        makeSourceEntry(
          item.concept === 'scene_vertical' ? '竖屏场景导演板约束' : '横屏场景导演板约束',
          buildSceneAssetConstraint(item.concept),
          'structured',
        ),
        makeSourceEntry('改编稿场景一致性', sceneConsistency, 'script'),
      ]),
    };
  }

  const prop = analysis.propTracking?.find((propInfo) => getPropIdentityKey(propInfo) === item.identityKey)
    ?? analysis.propTracking?.find((propInfo) => propInfo.propName === item.name);
  const safeHolder = getSafePropHolderLabel(prop?.holder);

  return {
    descriptionSources: dedupeSourceEntries([
      makeSourceEntry('Step2 主描述', prop?.step3Description, 'step2'),
      makeSourceEntry('Step2 物品字段', buildPropStructuredSummary(prop ?? {}), 'structured'),
    ]),
    contextSources: dedupeSourceEntries([
      makeSourceEntry('道具工业板约束', buildPropAssetConstraint(), 'structured'),
      makeSourceEntry(
        'Step2 道具追踪',
        prop
          ? `${prop.propName}；持有者：${safeHolder || '场景道具'}；状态：${prop.stateChanges || prop.condition || '无明显变化'}；范围：${prop.storyboardRange || '未知'}`
          : '',
        'structured',
        240,
      ),
    ]),
  };
}

export function inferCharacterFocusProfile({
  name,
  analysis,
  adaptedScript = '',
  rawScript = '',
}: {
  name: string;
  analysis: Pick<ScriptAnalysis, 'allCharacterNames' | 'storyboards' | 'scenes'> & Partial<Pick<ScriptAnalysis, 'characterProfiles'>>;
  adaptedScript?: string;
  rawScript?: string;
}): CharacterFocusProfile {
  const profile = analysis.characterProfiles?.find((entry) => entry.name === name);
  const profileText = [
    profile?.description,
    profile?.step3Description,
    profile?.temperament,
    profile?.visualAnchor,
    profile?.defaultOutfit,
  ].filter(Boolean).join('；');
  const profileLeadHint = /女主角|男主角|主角定位|主人公|核心主角|第一主角|暗中保护|守护者|命定主角|关键盟友/.test(profileText);
  const profileKeyHint = /反派|敌对|对手|未婚夫|退婚|羞辱|夺取|夺走|权力|天才军校|军校|统治|压迫|追杀/.test(profileText);
  const characters = analysis.allCharacterNames ?? [];
  const scoreCharacter = (characterName: string) => {
    const storyboardHits = (analysis.storyboards ?? []).filter((storyboard) => storyboard.characters.includes(characterName)).length;
    const sceneHits = (analysis.scenes ?? []).filter((scene) => scene.characters.includes(characterName)).length;
    const adaptedMentions = Math.min(12, countOccurrences(adaptedScript, characterName));
    const rawMentions = Math.min(12, countOccurrences(rawScript, characterName));
    return storyboardHits * 4 + sceneHits * 2 + adaptedMentions * 1.2 + rawMentions * 0.6;
  };

  const ranked = characters
    .map((characterName) => ({ name: characterName, score: scoreCharacter(characterName) }))
    .sort((a, b) => b.score - a.score);

  const rank = Math.max(0, ranked.findIndex((item) => item.name === name));
  const score = ranked[rank]?.score ?? scoreCharacter(name);

  if (profileLeadHint) {
    return { tier: 'lead', label: '主角', rank, score };
  }
  if (profileKeyHint) {
    return { tier: 'key', label: '重要角色', rank, score };
  }
  if (rank === 0 && score >= 6) {
    return { tier: 'lead', label: '主角', rank, score };
  }
  if (rank <= 2 && score >= 3) {
    return { tier: 'key', label: '重要角色', rank, score };
  }
  return { tier: 'support', label: '普通角色', rank, score };
}

export function buildAssetDescription({
  item,
  analysis,
  adaptedScript = '',
}: {
  item: DescriptionItem;
  analysis: Pick<ScriptAnalysis, 'characterProfiles' | 'outfitTracking' | 'propTracking' | 'scenes'>;
  adaptedScript?: string;
}) {
  if (item.type === 'character') {
    const profile = analysis.characterProfiles?.find((entry) => entry.name === item.name);
    const fallbackConsistency = extractCharacterConsistencyBlock(adaptedScript, item.name);
    const parts = [item.name];
    const rawBaseDescription = buildCharacterVisualDescription(profile ?? {}) || normalizeText(fallbackConsistency);
    const allowSignatureProps = isCharacterSettingSheetConcept(item.concept);
    const baseDescription = rawBaseDescription
      ? sanitizeCharacterAssetPromptText(rawBaseDescription, { allowSignatureProps })
      : '';
    if (baseDescription) {
      parts.push(baseDescription);
    }

    const outfits = analysis.outfitTracking?.filter((outfit) => outfit.characterName === item.name) ?? [];
    const selectedOutfit = findSelectedOutfit(item, outfits);
    const selectedOutfitDesc = selectedOutfit?.outfitDesc
      ? sanitizeCharacterAssetPromptText(selectedOutfit.outfitDesc, { allowSignatureProps })
      : '';
    const isOutfitConcept = isCharacterOutfitConcept(item.concept);
    if (isOutfitConcept && selectedOutfitDesc && !baseDescription.includes(selectedOutfitDesc)) {
      parts.push(`服装设定：${selectedOutfitDesc}`);
      if (selectedOutfit?.storyboardRange) {
        parts.push(`对应分镜：${selectedOutfit.storyboardRange}`);
      }
    } else if (!isOutfitConcept && selectedOutfitDesc && !baseDescription.includes(selectedOutfitDesc)) {
      parts.push(`参考服装：${selectedOutfitDesc}`);
    }
    if (isOutfitConcept && item.variantLabel) {
      parts.push(`变装版本：${item.variantLabel}`);
    }

    const conceptMeta = CHAR_CONCEPTS.find((conceptConfig) => conceptConfig.concept === item.concept);
    if (conceptMeta) {
      parts.push(`用途：${conceptMeta.desc}`);
    }
    if (isCharacterSettingSheetConcept(item.concept)) {
      const exclusivePropsLine = buildExclusivePropsLine(getCharacterExclusiveProps(analysis.propTracking, item.name), 3);
      if (exclusivePropsLine) parts.push(exclusivePropsLine);
    }

    return joinParts(parts);
  }

  if (item.type === 'prop') {
    const prop = analysis.propTracking?.find((propInfo) => getPropIdentityKey(propInfo) === item.identityKey)
      ?? analysis.propTracking?.find((propInfo) => propInfo.propName === item.name);
    const parts = [item.name];
    const baseDescription = buildPropVisualDescription(prop ?? {});
    if (baseDescription) {
      parts.push(baseDescription);
    }
    return joinParts(parts);
  }

  const scene = analysis.scenes?.find((sceneInfo) => sceneInfo.name === item.name);
  const fallbackConsistency = extractSceneConsistencyBlock(adaptedScript, item.name);
  const parts = [
    item.name,
    buildSceneVisualDescription(scene ?? {}) || normalizeText(fallbackConsistency),
  ];
  if (item.concept === 'scene_vertical') {
    parts.push('用途：竖屏9:16场景导演板，供竖屏视频直接调用；独立生成竖屏主环境图和竖屏 FLOOR PLAN / TOP-DOWN BLOCKING MAP，保留空间锚点、关键陈设、材质、光线、色调、角色入画区和 CAMERA 1-6 机位；底部地图占比提升到约34%-38%，俯视图必须高对比、图纸化、带大号 MAIN ENVIRONMENT / TOP-DOWN BLOCKING MAP / LEGEND 标题条和固定颜色图例，机位编号放大1.5-2倍，不新增人物。');
  } else {
    parts.push('用途：横屏16:9场景导演板，供横屏视频直接调用；独立生成横屏主环境图和横屏 FLOOR PLAN / TOP-DOWN BLOCKING MAP，锁定空间锚点、入口出口、障碍物、可行动路线和 CAMERA 1-6 机位；俯视图必须高对比、图纸化、带大号 MAIN ENVIRONMENT / TOP-DOWN BLOCKING MAP / LEGEND 标题条和固定颜色图例，机位编号放大1.5-2倍。');
  }
  return joinParts(parts);
}

export function buildAssetContext({
  item,
  adaptedScript = '',
  analysis,
  isOfficialNoFace = false,
}: {
  item: ContextItem;
  rawScript?: string;
  adaptedScript?: string;
  analysis?: Pick<ScriptAnalysis, 'characterProfiles' | 'storyboards' | 'propTracking' | 'scenes' | 'outfitTracking' | 'styleConfig'>;
  isOfficialNoFace?: boolean;
}) {
  if (!adaptedScript && !analysis) return undefined;

  const relevantParts: string[] = [];

  if (item.type === 'character') {
    const profile = analysis?.characterProfiles?.find((entry) => entry.name === item.name);
    if (profile && !isOfficialNoFace) {
      const rawStep2CharacterDescription = buildCharacterVisualDescription(profile);
      const step2CharacterDescription = rawStep2CharacterDescription
        ? sanitizeCharacterAssetPromptText(rawStep2CharacterDescription, { allowSignatureProps: isCharacterSettingSheetConcept(item.concept) })
        : '';
      if (step2CharacterDescription) {
        relevantParts.push(`【Step2-角色画像】${step2CharacterDescription}`);
      }
      const rawStructured = buildCharacterStructuredSummary(profile);
      const structured = rawStructured
        ? sanitizeCharacterAssetPromptText(rawStructured, { allowSignatureProps: isCharacterSettingSheetConcept(item.concept) })
        : '';
      if (structured) {
        relevantParts.push(`【Step2-角色字段】${structured}`);
      }
    }

    const outfits = analysis?.outfitTracking?.filter((outfit) => outfit.characterName === item.name) ?? [];
    const selectedOutfit = findSelectedOutfit(item, outfits);
    if (selectedOutfit && isCharacterOutfitConcept(item.concept)) {
      relevantParts.push(
        `【Step2-变装设定】${item.variantLabel ?? `变装 ${selectedOutfit.outfitSeq}`}：${selectedOutfit.outfitDesc}；范围：${selectedOutfit.storyboardRange || '未知'}`,
      );
    }
    const exclusivePropsLine = isCharacterSettingSheetConcept(item.concept)
      ? buildExclusivePropsLine(getCharacterExclusiveProps(analysis?.propTracking, item.name), 3)
      : '';
    if (exclusivePropsLine) {
      relevantParts.push(`【Step2-角色专属物品】${exclusivePropsLine}`);
    }
    const consistencyBlock = extractCharacterConsistencyBlock(adaptedScript, item.name);
    const nonHumanSystem = isNonHumanSystemCharacterProfile(
      profile,
      [
        item.name,
        selectedOutfit?.outfitDesc,
        consistencyBlock,
      ].filter(Boolean).join('\n'),
    );
    const genderHint = nonHumanSystem ? undefined : inferCharacterGenderHint(
      profile?.description,
      profile?.step3Description,
      profile?.faceFeatures,
      profile?.hairStyle,
      profile?.defaultOutfit,
      profile?.accessories,
      profile?.visualAnchor,
      item.name,
      selectedOutfit?.outfitDesc,
      consistencyBlock,
    );

    const characterSheetSections = buildCharacterSheetPromptSections({
      item,
      profile: isOfficialNoFace ? undefined : profile,
      selectedOutfit,
      exclusivePropLine: exclusivePropsLine,
      consistencyBlock,
      isOfficialNoFace,
      genderHint,
      nonHumanSystem,
    });
    relevantParts.push(`【Character Sheet Prompt Structure】${characterSheetSections}`);

    if (isOfficialNoFace) {
      relevantParts.push('【官方虚拟人无脸服装图约束】只允许继承服装版本、体态比例、材质、配饰和装备；不得继承官方人像的脸、五官、发型、肤色或肖像身份。');
    } else {
      relevantParts.push(`【角色设定图约束】${buildCharacterAssetConstraint(item.concept, { nonHumanSystem })}`);
    }

    const threeDAnimeDesignBoost = buildThreeDAnimeCharacterDesignEnhancement(analysis?.styleConfig, { isOfficialNoFace, genderHint, nonHumanSystem });
    if (threeDAnimeDesignBoost && (isCharacterSettingSheetConcept(item.concept) || isCharacterOutfitConcept(item.concept))) {
      relevantParts.push(`【3D动漫角色设计增强】${threeDAnimeDesignBoost}`);
    }

    if (consistencyBlock) {
      relevantParts.push(`【改编剧本-人物一致性】${consistencyBlock}`);
    }
  } else if (item.type === 'scene') {
    const scene = analysis?.scenes?.find((entry) => entry.name === item.name);
    const step2SceneDescription = buildSceneVisualDescription(scene ?? {});
    if (step2SceneDescription) {
      relevantParts.push(`【Step2-场景画像】${step2SceneDescription}`);
    }
    relevantParts.push(`【${item.concept === 'scene_vertical' ? '竖屏场景导演板约束' : '横屏场景导演板约束'}】${buildSceneAssetConstraint(item.concept)}`);

    const sceneConsistency = extractSceneConsistencyBlock(adaptedScript, item.name);
    if (sceneConsistency) {
      relevantParts.push(`【改编剧本-场景一致性】${sceneConsistency.slice(0, 260)}`);
    }
  } else if (item.type === 'prop') {
    const prop = analysis?.propTracking?.find((propInfo) => getPropIdentityKey(propInfo) === item.identityKey)
      ?? analysis?.propTracking?.find((propInfo) => propInfo.propName === item.name);
    if (prop) {
      const safeHolder = getSafePropHolderLabel(prop.holder);
      const step2PropDescription = buildPropVisualDescription(prop);
      if (step2PropDescription) {
        relevantParts.push(`【Step2-道具画像】${step2PropDescription}`);
      }
      relevantParts.push(
        `【道具追踪】${item.name}；持有者：${safeHolder || '场景道具'}；状态：${prop.stateChanges || prop.condition || '无明显变化'}；范围：${prop.storyboardRange || '未知'}`,
      );
      relevantParts.push(`【道具工业板约束】${buildPropAssetConstraint()}`);
    }
  }

  return relevantParts.length > 0 ? relevantParts.join('\n\n') : undefined;
}

export function buildTurnaroundPromptForItem(
  item: Pick<AssetItem, 'concept' | 'name'>,
  styleConfig?: string,
  exclusivePropLine?: string,
  genderHint?: CharacterGenderHint,
  nonHumanSystem = false,
) {
  return buildTurnaroundPromptInit(item.concept, item.name, styleConfig, exclusivePropLine, genderHint, nonHumanSystem);
}
