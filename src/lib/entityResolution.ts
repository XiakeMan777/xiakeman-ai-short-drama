import type {
  Asset,
  CharacterProfile,
  Project,
  PropConsistency,
  SceneInfo,
  ScriptAnalysis,
} from '@/types';

export type EntityResolutionType = 'character' | 'scene' | 'prop';

export interface EntityResolutionSuggestion {
  id: string;
  type: EntityResolutionType;
  currentName: string;
  canonicalName: string;
  currentIdentityKey?: string;
  canonicalIdentityKey?: string;
  confidence: number;
  reason: string;
  sourceLabel: string;
  autoApplyBlockedReason?: string;
}

interface KnownEntity {
  type: EntityResolutionType;
  canonicalName: string;
  identityKey?: string;
  description?: string;
  sourceLabel: string;
}

interface CurrentEntity {
  type: EntityResolutionType;
  name: string;
  identityKey?: string;
  description?: string;
}

interface NameMatchScore {
  confidence: number;
  reason: string;
  autoApplyBlockedReason?: string;
}

export const ENTITY_RESOLUTION_MIN_CONFIDENCE = 0.74;
export const ENTITY_RESOLUTION_AUTO_APPLY_CONFIDENCE = 0.82;

const TYPE_LABELS: Record<EntityResolutionType, string> = {
  character: '角色',
  scene: '场景',
  prop: '物品',
};

const DISTINCTIVE_CHARACTER_MARKS = [
  '刀疤',
  '疤脸',
  '独眼',
  '白发',
  '银发',
  '红衣',
  '黑衣',
  '玄火',
  '冷白',
  '疤',
  '瘸',
  '瞎',
  '盲',
];

const GENERIC_CHARACTER_ROLE_TERMS = [
  '伤员',
  '杂役',
  '守备',
  '守备兵',
  '守备队员',
  '士兵',
  '兵',
  '队员',
  '文书',
  '工修',
  '医务人员',
  '棚内人',
  '棚里人',
  '路人',
  '男人',
  '女人',
  '孩子',
  '小头目',
  '领头',
  '黑披人',
  '联络兵',
];
const GENERIC_CHARACTER_QUALIFIERS = ['老', '中年', '瘦高', '高瘦', '矮胖', '年轻'];
const GENERIC_CHARACTER_SUFFIX_RE = /[甲乙丙丁ABCD]$/i;

export function getEntityResolutionTypeLabel(type: EntityResolutionType) {
  return TYPE_LABELS[type];
}

export function isEntityResolutionAutoApplicable(suggestion: EntityResolutionSuggestion) {
  return suggestion.confidence >= ENTITY_RESOLUTION_AUTO_APPLY_CONFIDENCE
    && !suggestion.autoApplyBlockedReason;
}

export function findEntityResolutionSuggestions({
  analysis,
  project,
  currentChapterId,
}: {
  analysis: ScriptAnalysis;
  project: Project;
  currentChapterId?: string;
}): EntityResolutionSuggestion[] {
  const knownEntities = collectKnownEntities(project, currentChapterId);
  const currentEntities = collectCurrentEntities(analysis);
  const suggestions: EntityResolutionSuggestion[] = [];
  const usedCanonicalKeys = new Set<string>();

  for (const current of currentEntities) {
    const best = findBestKnownEntity(current, knownEntities);
    if (!best) continue;

    const canonicalKey = buildSuggestionKey(current, best.entity);
    if (usedCanonicalKeys.has(canonicalKey)) continue;
    usedCanonicalKeys.add(canonicalKey);

    suggestions.push({
      id: canonicalKey,
      type: current.type,
      currentName: current.name,
      canonicalName: best.entity.canonicalName,
      currentIdentityKey: current.identityKey,
      canonicalIdentityKey: best.entity.identityKey,
      confidence: best.score.confidence,
      reason: best.score.reason,
      sourceLabel: best.entity.sourceLabel,
      autoApplyBlockedReason: best.score.autoApplyBlockedReason,
    });
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence);
}

export function applyEntityResolution(
  analysis: ScriptAnalysis,
  suggestion: EntityResolutionSuggestion,
): ScriptAnalysis {
  switch (suggestion.type) {
    case 'character':
      return applyCharacterResolution(analysis, suggestion.currentName, suggestion.canonicalName);
    case 'scene':
      return applySceneResolution(analysis, suggestion.currentName, suggestion.canonicalName);
    case 'prop':
      return applyPropResolution(analysis, suggestion);
    default:
      return analysis;
  }
}

export function applyEntityResolutions(
  analysis: ScriptAnalysis,
  suggestions: readonly EntityResolutionSuggestion[],
): ScriptAnalysis {
  return suggestions.reduce((nextAnalysis, suggestion) => applyEntityResolution(nextAnalysis, suggestion), analysis);
}

function collectKnownEntities(project: Project, currentChapterId?: string): KnownEntity[] {
  const known = new Map<string, KnownEntity>();

  project.chapters.forEach((chapter, index) => {
    if (chapter.id === currentChapterId) return;
    const analysis = chapter.analysis;
    if (!analysis) return;
    const sourceLabel = chapter.title?.trim() || `第${index + 1}章`;

    for (const name of analysis.allCharacterNames ?? []) {
      const profile = analysis.characterProfiles?.find((item) => normalizeEntityName(item.name) === normalizeEntityName(name));
      addKnownEntity(known, {
        type: 'character',
        canonicalName: name,
        description: buildCharacterDescription(profile),
        sourceLabel,
      });
    }

    for (const profile of analysis.characterProfiles ?? []) {
      addKnownEntity(known, {
        type: 'character',
        canonicalName: profile.name,
        description: buildCharacterDescription(profile),
        sourceLabel,
      });
    }

    for (const scene of analysis.scenes ?? []) {
      addKnownEntity(known, {
        type: 'scene',
        canonicalName: scene.name,
        description: buildSceneDescription(scene),
        sourceLabel,
      });
    }

    for (const prop of analysis.propTracking ?? []) {
      addKnownEntity(known, {
        type: 'prop',
        canonicalName: prop.propName,
        identityKey: prop.trackingId,
        description: buildPropDescription(prop),
        sourceLabel,
      });
    }
  });

  for (const asset of project.assetLibrary ?? []) {
    addKnownEntity(known, {
      type: asset.type,
      canonicalName: asset.name,
      identityKey: asset.identityKey,
      description: asset.description || asset.optimizedPrompt,
      sourceLabel: '资产库',
    });
  }

  return [...known.values()];
}

function collectCurrentEntities(analysis: ScriptAnalysis): CurrentEntity[] {
  const entities: CurrentEntity[] = [];
  const seen = new Set<string>();

  for (const name of analysis.allCharacterNames ?? []) {
    const profile = analysis.characterProfiles?.find((item) => normalizeEntityName(item.name) === normalizeEntityName(name));
    addCurrentEntity(entities, seen, {
      type: 'character',
      name,
      description: buildCharacterDescription(profile),
    });
  }

  for (const profile of analysis.characterProfiles ?? []) {
    addCurrentEntity(entities, seen, {
      type: 'character',
      name: profile.name,
      description: buildCharacterDescription(profile),
    });
  }

  for (const scene of analysis.scenes ?? []) {
    addCurrentEntity(entities, seen, {
      type: 'scene',
      name: scene.name,
      description: buildSceneDescription(scene),
    });
  }

  for (const prop of analysis.propTracking ?? []) {
    addCurrentEntity(entities, seen, {
      type: 'prop',
      name: prop.propName,
      identityKey: prop.trackingId,
      description: buildPropDescription(prop),
    });
  }

  return entities;
}

function addKnownEntity(map: Map<string, KnownEntity>, entity: KnownEntity) {
  const canonicalName = entity.canonicalName.trim();
  if (!canonicalName) return;
  const key = buildKnownEntityKey(entity.type, canonicalName, entity.identityKey);
  const existing = map.get(key);
  if (!existing) {
    map.set(key, { ...entity, canonicalName });
    return;
  }

  map.set(key, {
    ...existing,
    description: pickDetailedText(existing.description, entity.description),
    identityKey: existing.identityKey ?? entity.identityKey,
  });
}

function addCurrentEntity(items: CurrentEntity[], seen: Set<string>, entity: CurrentEntity) {
  const name = entity.name.trim();
  if (!name) return;
  const key = buildKnownEntityKey(entity.type, name, entity.identityKey);
  if (seen.has(key)) return;
  seen.add(key);
  items.push({ ...entity, name });
}

function findBestKnownEntity(current: CurrentEntity, knownEntities: readonly KnownEntity[]) {
  let best: { entity: KnownEntity; score: NameMatchScore } | null = null;

  for (const known of knownEntities) {
    if (known.type !== current.type) continue;
    const sameName = normalizeEntityName(current.name) === normalizeEntityName(known.canonicalName);
    const sameIdentity = current.identityKey && known.identityKey && current.identityKey === known.identityKey;
    if (sameName && (current.type !== 'prop' || sameIdentity || !known.identityKey)) continue;

    const score = scoreEntityMatch(current, known);
    if (score.confidence < ENTITY_RESOLUTION_MIN_CONFIDENCE) continue;
    if (!best || score.confidence > best.score.confidence) {
      best = { entity: known, score };
    }
  }

  return best;
}

function scoreEntityMatch(current: CurrentEntity, known: KnownEntity): NameMatchScore {
  const nameScore = scoreNameMatch(current.type, current.name, known.canonicalName);
  const descriptionScore = scoreDescriptionOverlap(current.description, known.description);
  const confidence = Math.min(0.98, nameScore.confidence + descriptionScore);
  const autoApplyBlockedReason = getAutoApplyBlockedReason(current, known, confidence);

  if (current.type === 'prop' && current.identityKey && known.identityKey && current.identityKey !== known.identityKey) {
    return {
      confidence: Math.max(confidence, nameScore.confidence),
      reason: nameScore.reason.includes('名称完全一致')
        ? '名称完全一致，但当前道具身份键不同，建议复用已有道具身份'
        : `${nameScore.reason}，建议复用已有道具身份`,
      autoApplyBlockedReason,
    };
  }

  return {
    confidence,
    reason: descriptionScore > 0 ? `${nameScore.reason}，描述也有重叠` : nameScore.reason,
    autoApplyBlockedReason,
  };
}

function getAutoApplyBlockedReason(current: CurrentEntity, known: KnownEntity, confidence: number) {
  if (confidence < ENTITY_RESOLUTION_AUTO_APPLY_CONFIDENCE) return undefined;
  if (current.type !== 'character') return undefined;

  const currentGeneric = isGenericCharacterRoleName(current.name);
  const knownGeneric = isGenericCharacterRoleName(known.canonicalName);
  const sharedDistinctiveMark = getSharedDistinctiveCharacterMark(current.name, known.canonicalName);

  if (currentGeneric && knownGeneric && !sharedDistinctiveMark) {
    return '泛称角色名相似，需人工确认后再复用';
  }

  if (!sharedDistinctiveMark && !hasStableCharacterNameSignal(current.name, known.canonicalName)) {
    return '角色别名证据不足，需人工确认后再复用';
  }

  return undefined;
}

function isGenericCharacterRoleName(name: string) {
  const normalized = name.trim();
  if (!normalized) return false;
  if (getSharedDistinctiveCharacterMark(normalized, normalized)) return false;

  const hasRoleTerm = GENERIC_CHARACTER_ROLE_TERMS.some((term) => normalized.includes(term));
  const hasQualifier = GENERIC_CHARACTER_QUALIFIERS.some((term) => normalized.includes(term));
  return hasRoleTerm || hasQualifier || GENERIC_CHARACTER_SUFFIX_RE.test(normalized);
}

function getSharedDistinctiveCharacterMark(a: string, b: string) {
  return DISTINCTIVE_CHARACTER_MARKS.find((mark) => a.includes(mark) && b.includes(mark));
}

function hasStableCharacterNameSignal(currentName: string, canonicalName: string) {
  const current = normalizeEntityName(currentName);
  const canonical = normalizeEntityName(canonicalName);
  if (!current || !canonical) return false;
  if (current === canonical) return true;
  return current.length >= 3
    && canonical.length >= 3
    && (current.includes(canonical) || canonical.includes(current));
}

function scoreNameMatch(type: EntityResolutionType, currentName: string, canonicalName: string): NameMatchScore {
  const current = normalizeEntityName(currentName);
  const canonical = normalizeEntityName(canonicalName);
  if (!current || !canonical) return { confidence: 0, reason: '名称为空' };
  if (current === canonical) return { confidence: 0.97, reason: '名称完全一致' };

  const minLength = Math.min(current.length, canonical.length);
  const maxLength = Math.max(current.length, canonical.length);
  if (minLength >= 2 && (current.includes(canonical) || canonical.includes(current))) {
    const base = type === 'scene' ? 0.86 : type === 'prop' ? 0.84 : 0.8;
    return {
      confidence: Math.min(0.95, Math.max(base, 0.72 + (minLength / maxLength) * 0.22)),
      reason: '名称存在包含关系',
    };
  }

  const overlap = getCharacterOverlap(current, canonical);
  if (overlap.sharedCount >= 2 && overlap.jaccard >= 0.5) {
    return {
      confidence: type === 'character' ? 0.84 : type === 'scene' ? 0.8 : 0.82,
      reason: '名称关键字高度重叠',
    };
  }

  if (
    type === 'character'
    && overlap.sharedCount >= 1
    && overlap.jaccard >= 0.34
    && DISTINCTIVE_CHARACTER_MARKS.some((mark) => currentName.includes(mark) && canonicalName.includes(mark))
  ) {
    return {
      confidence: 0.82,
      reason: '角色辨识词重叠',
    };
  }

  if (type !== 'character' && overlap.sharedCount >= 2 && overlap.jaccard >= 0.42) {
    return {
      confidence: type === 'scene' ? 0.77 : 0.78,
      reason: '名称核心字重叠',
    };
  }

  return { confidence: 0, reason: '相似度不足' };
}

function scoreDescriptionOverlap(currentDescription?: string, knownDescription?: string) {
  const current = normalizeEntityName(currentDescription ?? '');
  const known = normalizeEntityName(knownDescription ?? '');
  if (current.length < 8 || known.length < 8) return 0;

  const currentTokens = getTokenSet(current);
  const knownTokens = getTokenSet(known);
  if (currentTokens.size === 0 || knownTokens.size === 0) return 0;

  let shared = 0;
  for (const token of currentTokens) {
    if (knownTokens.has(token)) shared += 1;
  }

  const ratio = shared / Math.min(currentTokens.size, knownTokens.size);
  return ratio >= 0.28 ? 0.06 : 0;
}

function applyCharacterResolution(analysis: ScriptAnalysis, currentName: string, canonicalName: string): ScriptAnalysis {
  if (currentName === canonicalName) return analysis;

  return {
    ...analysis,
    allCharacterNames: replaceAndDedupeNames(analysis.allCharacterNames, currentName, canonicalName),
    characterProfiles: mergeCharacterProfiles(
      analysis.characterProfiles.map((profile) =>
        profile.name === currentName ? { ...profile, name: canonicalName } : profile,
      ),
    ),
    scenes: analysis.scenes.map((scene) => ({
      ...scene,
      characters: replaceAndDedupeNames(scene.characters, currentName, canonicalName),
    })),
    storyboards: analysis.storyboards.map((storyboard) => ({
      ...storyboard,
      characters: replaceAndDedupeNames(storyboard.characters, currentName, canonicalName),
    })),
    outfitTracking: analysis.outfitTracking.map((outfit) =>
      outfit.characterName === currentName ? { ...outfit, characterName: canonicalName } : outfit,
    ),
    propTracking: analysis.propTracking.map((prop) =>
      prop.holder === currentName ? { ...prop, holder: canonicalName } : prop,
    ),
  };
}

function applySceneResolution(analysis: ScriptAnalysis, currentName: string, canonicalName: string): ScriptAnalysis {
  if (currentName === canonicalName) return analysis;

  return {
    ...analysis,
    scenes: mergeScenes(
      analysis.scenes.map((scene) =>
        scene.name === currentName ? { ...scene, name: canonicalName } : scene,
      ),
    ),
    storyboards: analysis.storyboards.map((storyboard) =>
      storyboard.scene === currentName ? { ...storyboard, scene: canonicalName } : storyboard,
    ),
    propTracking: analysis.propTracking.map((prop) =>
      prop.holder === currentName ? { ...prop, holder: canonicalName } : prop,
    ),
  };
}

function applyPropResolution(analysis: ScriptAnalysis, suggestion: EntityResolutionSuggestion): ScriptAnalysis {
  const nextProps = analysis.propTracking.map((prop) => {
    const isTarget = suggestion.currentIdentityKey
      ? prop.trackingId === suggestion.currentIdentityKey
      : prop.propName === suggestion.currentName;
    if (!isTarget) return prop;
    return {
      ...prop,
      propName: suggestion.canonicalName,
      trackingId: suggestion.canonicalIdentityKey ?? prop.trackingId,
    };
  });

  return {
    ...analysis,
    propTracking: mergeProps(nextProps),
  };
}

function mergeCharacterProfiles(profiles: CharacterProfile[]) {
  const map = new Map<string, CharacterProfile>();
  for (const profile of profiles) {
    const key = profile.name;
    const existing = map.get(key);
    map.set(key, existing ? mergeCharacterProfile(existing, profile) : profile);
  }
  return [...map.values()];
}

function mergeCharacterProfile(a: CharacterProfile, b: CharacterProfile): CharacterProfile {
  return {
    ...a,
    ...b,
    description: pickDetailedText(a.description, b.description) ?? '',
    ageAppearance: pickDetailedText(a.ageAppearance, b.ageAppearance),
    temperament: pickDetailedText(a.temperament, b.temperament),
    bodyBuild: pickDetailedText(a.bodyBuild, b.bodyBuild),
    faceFeatures: pickDetailedText(a.faceFeatures, b.faceFeatures),
    hairStyle: pickDetailedText(a.hairStyle, b.hairStyle),
    skinTone: pickDetailedText(a.skinTone, b.skinTone),
    defaultOutfit: pickDetailedText(a.defaultOutfit, b.defaultOutfit),
    accessories: pickDetailedText(a.accessories, b.accessories),
    visualAnchor: pickDetailedText(a.visualAnchor, b.visualAnchor),
    step3Description: pickDetailedText(a.step3Description, b.step3Description),
    inferredFields: uniqueStrings([...(a.inferredFields ?? []), ...(b.inferredFields ?? [])]),
  };
}

function mergeScenes(scenes: SceneInfo[]) {
  const map = new Map<string, SceneInfo>();
  for (const scene of scenes) {
    const existing = map.get(scene.name);
    map.set(scene.name, existing ? mergeScene(existing, scene) : scene);
  }
  return [...map.values()];
}

function mergeScene(a: SceneInfo, b: SceneInfo): SceneInfo {
  return {
    ...a,
    ...b,
    environment: pickDetailedText(a.environment, b.environment) ?? '',
    colorTone: pickDetailedText(a.colorTone, b.colorTone) ?? '',
    characters: uniqueStrings([...(a.characters ?? []), ...(b.characters ?? [])]),
    timeOfDay: pickDetailedText(a.timeOfDay, b.timeOfDay),
    spaceScale: pickDetailedText(a.spaceScale, b.spaceScale),
    layout: pickDetailedText(a.layout, b.layout),
    keySetPieces: pickDetailedText(a.keySetPieces, b.keySetPieces),
    lighting: pickDetailedText(a.lighting, b.lighting),
    weather: pickDetailedText(a.weather, b.weather),
    atmosphere: pickDetailedText(a.atmosphere, b.atmosphere),
    step3Description: pickDetailedText(a.step3Description, b.step3Description),
    inferredFields: uniqueStrings([...(a.inferredFields ?? []), ...(b.inferredFields ?? [])]),
  };
}

function mergeProps(props: PropConsistency[]) {
  const map = new Map<string, PropConsistency>();
  for (const prop of props) {
    const key = prop.trackingId || prop.propName;
    const existing = map.get(key);
    map.set(key, existing ? mergeProp(existing, prop) : prop);
  }
  return [...map.values()];
}

function mergeProp(a: PropConsistency, b: PropConsistency): PropConsistency {
  return {
    ...a,
    ...b,
    trackingId: a.trackingId ?? b.trackingId,
    appearanceDesc: pickDetailedText(a.appearanceDesc, b.appearanceDesc) ?? '',
    size: pickDetailedText(a.size, b.size),
    material: pickDetailedText(a.material, b.material),
    shapeStructure: pickDetailedText(a.shapeStructure, b.shapeStructure),
    color: pickDetailedText(a.color, b.color),
    texture: pickDetailedText(a.texture, b.texture),
    condition: pickDetailedText(a.condition, b.condition),
    visualAnchor: pickDetailedText(a.visualAnchor, b.visualAnchor),
    step3Description: pickDetailedText(a.step3Description, b.step3Description),
    holder: pickDetailedText(a.holder, b.holder) ?? '',
    storyboardRange: pickDetailedText(a.storyboardRange, b.storyboardRange) ?? '',
    stateChanges: pickDetailedText(a.stateChanges, b.stateChanges) ?? '',
    needsTracking: a.needsTracking !== false || b.needsTracking !== false,
    needsImage: a.needsImage || b.needsImage,
    inferredFields: uniqueStrings([...(a.inferredFields ?? []), ...(b.inferredFields ?? [])]),
  };
}

function buildKnownEntityKey(type: EntityResolutionType, name: string, identityKey?: string) {
  return `${type}:${identityKey || normalizeEntityName(name)}`;
}

function buildSuggestionKey(current: CurrentEntity, known: KnownEntity) {
  return [
    current.type,
    current.identityKey || normalizeEntityName(current.name),
    known.identityKey || normalizeEntityName(known.canonicalName),
  ].join('::');
}

function normalizeEntityName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。、《》“”‘’：:；;！!？?（）()[\]【】_\-—~·,.]/g, '');
}

function getCharacterOverlap(a: string, b: string) {
  const aSet = new Set([...a]);
  const bSet = new Set([...b]);
  let sharedCount = 0;
  for (const item of aSet) {
    if (bSet.has(item)) sharedCount += 1;
  }
  const unionCount = new Set([...aSet, ...bSet]).size || 1;
  return {
    sharedCount,
    jaccard: sharedCount / unionCount,
  };
}

function getTokenSet(value: string) {
  const tokens = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    tokens.add(value.slice(index, index + 2));
  }
  return tokens;
}

function replaceAndDedupeNames(items: readonly string[], currentName: string, canonicalName: string) {
  return uniqueStrings(items.map((item) => (item === currentName ? canonicalName : item)));
}

function uniqueStrings(items: readonly string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function pickDetailedText(a?: string, b?: string) {
  const left = a?.trim() ?? '';
  const right = b?.trim() ?? '';
  if (!left) return right || undefined;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

function buildCharacterDescription(profile?: CharacterProfile) {
  if (!profile) return '';
  return [
    profile.description,
    profile.ageAppearance,
    profile.temperament,
    profile.bodyBuild,
    profile.faceFeatures,
    profile.hairStyle,
    profile.skinTone,
    profile.defaultOutfit,
    profile.accessories,
    profile.visualAnchor,
    profile.step3Description,
  ].filter(Boolean).join('；');
}

function buildSceneDescription(scene: SceneInfo) {
  return [
    scene.environment,
    scene.layout,
    scene.keySetPieces,
    scene.lighting,
    scene.weather,
    scene.colorTone,
    scene.atmosphere,
    scene.step3Description,
  ].filter(Boolean).join('；');
}

function buildPropDescription(prop: PropConsistency | Asset) {
  if ('appearanceDesc' in prop) {
    return [
      prop.appearanceDesc,
      prop.size,
      prop.material,
      prop.shapeStructure,
      prop.color,
      prop.texture,
      prop.condition,
      prop.visualAnchor,
      prop.step3Description,
    ].filter(Boolean).join('；');
  }
  return [prop.description, prop.optimizedPrompt].filter(Boolean).join('；');
}
