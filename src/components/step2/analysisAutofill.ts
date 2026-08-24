import type {
  CharacterOutfit,
  CharacterProfile,
  PropConsistency,
  SceneInfo,
  ScriptAnalysis,
} from '@/types';
import { startsWithAnyTextVariant } from '@/lib/mojibake';
import {
  extractCharacterConsistencyText,
  getCharacterBlockingSuggestions,
  getOutfitBlockingSuggestions,
  getPropBlockingSuggestions,
  getSceneBlockingSuggestions,
} from './detailReview';

interface AutofillCounts {
  characters: number;
  scenes: number;
  props: number;
  outfits?: number;
  total: number;
}

export interface AnalysisAutofillResult {
  analysis: ScriptAnalysis;
  changed: boolean;
  counts: AutofillCounts;
}

export type AnalysisAutofillTargetType = 'character' | 'scene' | 'prop' | 'outfit';

export interface AnalysisAutofillTarget {
  id: string;
  type: AnalysisAutofillTargetType;
  name: string;
  fields: string[];
  reasons: string[];
  current: unknown;
}

export interface AnalysisAutofillPatch {
  characterProfiles?: Partial<CharacterProfile>[];
  scenes?: Partial<SceneInfo>[];
  propTracking?: Partial<PropConsistency>[];
  outfitTracking?: Partial<CharacterOutfit>[];
}

export function resolveAutofillSourceText({
  scriptType,
  rawScript,
  adaptedScript,
}: {
  scriptType?: 'annotated' | 'novel';
  rawScript?: string;
  adaptedScript?: string;
}) {
  return scriptType === 'novel'
    ? (adaptedScript ?? '')
    : ((rawScript?.trim() ? rawScript : adaptedScript) ?? '');
}

export function createAnalysisAutofillSignature(
  analysis: ScriptAnalysis,
  targetIds?: readonly string[],
) {
  if (targetIds) {
    return JSON.stringify({
      projectName: analysis.projectName,
      targetIds: [...targetIds].sort(),
    });
  }
  return JSON.stringify(analysis);
}

function hasText(value: string | undefined) {
  return (value ?? '').trim() !== '';
}

function uniqueParts(parts: Array<string | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of parts) {
    const normalized = (part ?? '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function joinSentence(parts: Array<string | undefined>) {
  return uniqueParts(parts).join('；');
}

const SOURCE_SECTION_HEADINGS = ['分镜', '场景', '人物一致性', '场景一致性', '物品/道具一致性'];

function isSourceSectionHeading(line: string) {
  return startsWithAnyTextVariant(line, SOURCE_SECTION_HEADINGS);
}

function pickPrimaryOutfit(outfits: CharacterOutfit[], characterName: string) {
  const characterOutfits = outfits.filter((outfit) => outfit.characterName === characterName);
  if (characterOutfits.length === 0) return null;
  const needsImageOutfits = characterOutfits.filter((outfit) => outfit.needsNewImage);
  const candidates = needsImageOutfits.length > 0 ? needsImageOutfits : characterOutfits;
  return candidates.slice().sort((a, b) => a.outfitSeq - b.outfitSeq)[0] ?? null;
}

function buildCharacterStep3Description(profile: CharacterProfile) {
  return joinSentence([
    profile.description,
    profile.ageAppearance ? `年龄感：${profile.ageAppearance}` : '',
    profile.temperament ? `气质：${profile.temperament}` : '',
    profile.bodyBuild ? `体型：${profile.bodyBuild}` : '',
    profile.faceFeatures ? `五官特征：${profile.faceFeatures}` : '',
    profile.hairStyle ? `发型：${profile.hairStyle}` : '',
    profile.skinTone ? `肤感：${profile.skinTone}` : '',
    profile.defaultOutfit ? `主服装：${profile.defaultOutfit}` : '',
    profile.accessories ? `配饰：${profile.accessories}` : '',
    profile.visualAnchor ? `视觉锚点：${profile.visualAnchor}` : '',
  ]);
}

function buildSceneStep3Description(scene: SceneInfo) {
  return joinSentence([
    scene.timeOfDay ? `时间：${scene.timeOfDay}` : '',
    scene.environment,
    scene.layout ? `空间布局：${scene.layout}` : '',
    scene.keySetPieces ? `关键陈设：${scene.keySetPieces}` : '',
    scene.lighting ? `灯光：${scene.lighting}` : '',
    scene.weather ? `天气/环境：${scene.weather}` : '',
    scene.colorTone ? `色调：${scene.colorTone}` : '',
    scene.atmosphere ? `氛围：${scene.atmosphere}` : '',
  ]);
}

function buildPropStep3Description(prop: PropConsistency) {
  return joinSentence([
    prop.appearanceDesc,
    prop.size ? `大小：${prop.size}` : '',
    prop.material ? `材质：${prop.material}` : '',
    prop.shapeStructure ? `结构：${prop.shapeStructure}` : '',
    prop.color ? `颜色：${prop.color}` : '',
    prop.texture ? `质感：${prop.texture}` : '',
    prop.condition ? `状态：${prop.condition}` : '',
    prop.visualAnchor ? `视觉锚点：${prop.visualAnchor}` : '',
  ]);
}

function extractCharacterSourceDescription(sourceText: string, characterName: string) {
  const consistencyText = extractCharacterConsistencyText(sourceText, characterName);
  if (hasText(consistencyText)) return consistencyText;
  if (!hasText(sourceText) || !hasText(characterName)) return '';

  const escapedName = characterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = uniqueParts(lines.filter((line) => {
    if (!line.includes(characterName)) return false;
    if (isSourceSectionHeading(line)) return false;
    if (new RegExp(`^${escapedName}[：:]`).test(line) && line.length <= characterName.length + 12) return false;
    return line.length > characterName.length + 4;
  }));

  return candidates.slice(0, 2).join('；');
}

function autofillCharacterProfile(
  profile: CharacterProfile,
  outfits: CharacterOutfit[],
  sourceText: string,
) {
  let changed = false;
  const nextProfile = { ...profile };
  const consistencyText = extractCharacterSourceDescription(sourceText, profile.name);
  const primaryOutfit = pickPrimaryOutfit(outfits, profile.name);

  if (!hasText(nextProfile.description) && hasText(consistencyText)) {
    nextProfile.description = consistencyText;
    changed = true;
  }

  if (!hasText(nextProfile.defaultOutfit) && hasText(primaryOutfit?.outfitDesc)) {
    nextProfile.defaultOutfit = primaryOutfit?.outfitDesc ?? '';
    changed = true;
  }

  if (!hasText(nextProfile.visualAnchor)) {
    const visualAnchor = joinSentence([
      nextProfile.faceFeatures,
      nextProfile.hairStyle,
      nextProfile.accessories,
    ]);
    if (hasText(visualAnchor)) {
      nextProfile.visualAnchor = visualAnchor;
      changed = true;
    }
  }

  if (!hasText(nextProfile.step3Description)) {
    const step3Description = buildCharacterStep3Description(nextProfile);
    if (hasText(step3Description)) {
      nextProfile.step3Description = step3Description;
      changed = true;
    }
  }

  return { profile: nextProfile, changed };
}

function autofillScene(scene: SceneInfo) {
  if (hasText(scene.step3Description)) {
    return { scene, changed: false };
  }

  const step3Description = buildSceneStep3Description(scene);
  if (!hasText(step3Description)) {
    return { scene, changed: false };
  }

  return {
    scene: {
      ...scene,
      step3Description,
    },
    changed: true,
  };
}

function autofillProp(prop: PropConsistency) {
  if (hasText(prop.step3Description)) {
    return { prop, changed: false };
  }

  const step3Description = buildPropStep3Description(prop);
  if (!hasText(step3Description)) {
    return { prop, changed: false };
  }

  return {
    prop: {
      ...prop,
      step3Description,
    },
    changed: true,
  };
}

export function autofillAnalysisDetails(
  analysis: ScriptAnalysis,
  sourceText = '',
): AnalysisAutofillResult {
  const counts: AutofillCounts = {
    characters: 0,
    scenes: 0,
    props: 0,
    total: 0,
  };

  const characterProfiles = analysis.characterProfiles.map((profile) => {
    const result = autofillCharacterProfile(profile, analysis.outfitTracking, sourceText);
    if (result.changed) counts.characters += 1;
    return result.profile;
  });

  const scenes = analysis.scenes.map((scene) => {
    const result = autofillScene(scene);
    if (result.changed) counts.scenes += 1;
    return result.scene;
  });

  const propTracking = analysis.propTracking.map((prop) => {
    const result = autofillProp(prop);
    if (result.changed) counts.props += 1;
    return result.prop;
  });

  counts.total = counts.characters + counts.scenes + counts.props;

  return {
    analysis: counts.total > 0
      ? {
        ...analysis,
        characterProfiles,
        scenes,
        propTracking,
      }
      : analysis,
    changed: counts.total > 0,
    counts,
  };
}

export function buildAiAutofillTargets(
  analysis: ScriptAnalysis,
  sourceText = '',
): AnalysisAutofillTarget[] {
  const targets: AnalysisAutofillTarget[] = [];

  for (const characterName of analysis.allCharacterNames ?? []) {
    const reasons = getCharacterBlockingSuggestions({
      characterName,
      analysis,
      adaptedScript: sourceText,
    });
    if (reasons.length === 0) continue;
    const profile = analysis.characterProfiles.find((item) => item.name === characterName);
    targets.push({
      id: `character:${characterName}`,
      type: 'character',
      name: characterName,
      fields: [
        'description',
        'ageAppearance',
        'temperament',
        'bodyBuild',
        'faceFeatures',
        'hairStyle',
        'skinTone',
        'defaultOutfit',
        'accessories',
        'visualAnchor',
        'step3Description',
      ],
      reasons,
      current: profile ?? { name: characterName, description: '' },
    });
  }

  for (const scene of analysis.scenes ?? []) {
    const reasons = getSceneBlockingSuggestions(scene, analysis.storyboards);
    if (reasons.length === 0) continue;
    targets.push({
      id: `scene:${scene.name}`,
      type: 'scene',
      name: scene.name,
      fields: [
        'environment',
        'timeOfDay',
        'colorTone',
        'spaceScale',
        'layout',
        'keySetPieces',
        'lighting',
        'weather',
        'atmosphere',
        'step3Description',
      ],
      reasons,
      current: scene,
    });
  }

  for (const prop of analysis.propTracking ?? []) {
    const reasons = getPropBlockingSuggestions(prop);
    if (reasons.length === 0) continue;
    targets.push({
      id: `prop:${prop.trackingId || prop.propName}`,
      type: 'prop',
      name: prop.propName,
      fields: [
        'appearanceDesc',
        'size',
        'material',
        'shapeStructure',
        'color',
        'texture',
        'condition',
        'visualAnchor',
        'step3Description',
      ],
      reasons,
      current: prop,
    });
  }

  for (const outfit of analysis.outfitTracking ?? []) {
    const reasons = getOutfitBlockingSuggestions(outfit);
    if (reasons.length === 0) continue;
    targets.push({
      id: `outfit:${outfit.characterName}:${outfit.outfitSeq}`,
      type: 'outfit',
      name: `${outfit.characterName}#${outfit.outfitSeq}`,
      fields: ['outfitDesc', 'storyboardRange'],
      reasons,
      current: outfit,
    });
  }

  return targets;
}

function extractJsonObject(text: string) {
  const trimmed = text.trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error('AI 补全没有返回合法 JSON');
  }
  return trimmed.slice(start, end + 1);
}

export function parseAnalysisAutofillPatchResponse(response: string): AnalysisAutofillPatch {
  const parsed = JSON.parse(extractJsonObject(response)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI 补全没有返回合法补丁 JSON');
  }
  const patch = 'patch' in parsed && parsed.patch && typeof parsed.patch === 'object'
    ? (parsed.patch as AnalysisAutofillPatch)
    : (parsed as AnalysisAutofillPatch);
  return patch;
}

function mergeStringField<T extends Record<string, unknown>>(
  target: T,
  patch: Partial<T>,
  field: keyof T,
  inferredFields: string[],
) {
  const value = patch[field];
  if (typeof value !== 'string' || !value.trim()) return false;
  const current = target[field];
  if (typeof current === 'string' && current.trim().length >= value.trim().length) return false;
  target[field] = value.trim() as T[keyof T];
  inferredFields.push(String(field));
  return true;
}

function mergeInferredFields(existing: string[] | undefined, added: string[]) {
  return Array.from(new Set([...(existing ?? []), ...added]));
}

export function mergeAnalysisAutofillPatch(
  analysis: ScriptAnalysis,
  patch: AnalysisAutofillPatch,
): AnalysisAutofillResult {
  const counts: AutofillCounts = {
    characters: 0,
    scenes: 0,
    props: 0,
    outfits: 0,
    total: 0,
  };

  const characterProfiles = [...analysis.characterProfiles];
  for (const patchProfile of patch.characterProfiles ?? []) {
    if (!patchProfile.name) continue;
    let index = characterProfiles.findIndex((profile) => profile.name === patchProfile.name);
    if (index < 0) {
      characterProfiles.push({ name: patchProfile.name, description: '' });
      index = characterProfiles.length - 1;
    }
    const nextProfile = { ...characterProfiles[index] } as CharacterProfile & Record<string, unknown>;
    const inferredFields: string[] = [];
    for (const field of ['description', 'ageAppearance', 'temperament', 'bodyBuild', 'faceFeatures', 'hairStyle', 'skinTone', 'defaultOutfit', 'accessories', 'visualAnchor', 'step3Description'] as const) {
      mergeStringField(nextProfile, patchProfile as typeof nextProfile, field, inferredFields);
    }
    if (inferredFields.length > 0) {
      nextProfile.inferredFields = mergeInferredFields(characterProfiles[index].inferredFields, inferredFields);
      characterProfiles[index] = nextProfile;
      counts.characters += 1;
    }
  }

  const scenes = analysis.scenes.map((scene) => {
    const patchScene = (patch.scenes ?? []).find((item) => item.name === scene.name);
    if (!patchScene) return scene;
    const nextScene = { ...scene } as SceneInfo & Record<string, unknown>;
    const inferredFields: string[] = [];
    for (const field of ['environment', 'timeOfDay', 'colorTone', 'spaceScale', 'layout', 'keySetPieces', 'lighting', 'weather', 'atmosphere', 'step3Description'] as const) {
      mergeStringField(nextScene, patchScene as typeof nextScene, field, inferredFields);
    }
    if (inferredFields.length === 0) return scene;
    nextScene.inferredFields = mergeInferredFields(scene.inferredFields, inferredFields);
    counts.scenes += 1;
    return nextScene;
  });

  const propTracking = analysis.propTracking.map((prop) => {
    const patchProp = (patch.propTracking ?? []).find((item) =>
      (item.trackingId && item.trackingId === prop.trackingId) || item.propName === prop.propName,
    );
    if (!patchProp) return prop;
    const nextProp = { ...prop } as PropConsistency & Record<string, unknown>;
    const inferredFields: string[] = [];
    for (const field of ['appearanceDesc', 'size', 'material', 'shapeStructure', 'color', 'texture', 'condition', 'visualAnchor', 'step3Description'] as const) {
      mergeStringField(nextProp, patchProp as typeof nextProp, field, inferredFields);
    }
    if (inferredFields.length === 0) return prop;
    nextProp.inferredFields = mergeInferredFields(prop.inferredFields, inferredFields);
    counts.props += 1;
    return nextProp;
  });

  const outfitTracking = analysis.outfitTracking.map((outfit) => {
    const patchOutfit = (patch.outfitTracking ?? []).find((item) =>
      item.characterName === outfit.characterName && item.outfitSeq === outfit.outfitSeq,
    );
    if (!patchOutfit) return outfit;
    const nextOutfit = { ...outfit } as CharacterOutfit & Record<string, unknown>;
    const inferredFields: string[] = [];
    for (const field of ['outfitDesc', 'storyboardRange'] as const) {
      mergeStringField(nextOutfit, patchOutfit as typeof nextOutfit, field, inferredFields);
    }
    if (
      typeof patchOutfit.needsNewImage === 'boolean'
      && patchOutfit.needsNewImage !== outfit.needsNewImage
      && patchOutfit.needsNewImage === true
    ) {
      nextOutfit.needsNewImage = true;
      inferredFields.push('needsNewImage');
    }
    if (inferredFields.length === 0) return outfit;
    counts.outfits = (counts.outfits ?? 0) + 1;
    return nextOutfit;
  });

  counts.total = counts.characters + counts.scenes + counts.props + (counts.outfits ?? 0);

  return {
    analysis: counts.total > 0
      ? {
        ...analysis,
        characterProfiles,
        scenes,
        propTracking,
        outfitTracking,
      }
      : analysis,
    changed: counts.total > 0,
    counts,
  };
}
