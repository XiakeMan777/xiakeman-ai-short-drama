import type {
  CharacterOutfit,
  CharacterProfile,
  PropConsistency,
  SceneInfo,
  ScriptAnalysis,
  StoryboardInfo,
} from '@/types';
import { includesAnyTextVariant } from '@/lib/mojibake';

function normalizeText(value: string | undefined) {
  return value?.trim() ?? '';
}

function hasText(value: string | undefined, minLength = 1) {
  return normalizeText(value).length >= minLength;
}

function hasAnyKeyword(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function toUniqueLabels(fields: string[] | undefined, labelMap: Record<string, string>) {
  if (!fields?.length) return [];
  const labels = fields
    .map((field) => labelMap[field] ?? field)
    .filter(Boolean);
  return Array.from(new Set(labels));
}

const SCENE_FIELD_LABELS: Record<string, string> = {
  timeOfDay: '时间段',
  environment: '环境描述',
  colorTone: '色调',
  spaceScale: '空间尺度',
  layout: '空间布局',
  keySetPieces: '关键陈设',
  lighting: '灯光',
  weather: '天气',
  atmosphere: '氛围',
  step3Description: 'Step3 场景描述',
};

const CHARACTER_FIELD_LABELS: Record<string, string> = {
  description: '角色描述',
  ageAppearance: '年龄感',
  temperament: '气质',
  bodyBuild: '体型',
  faceFeatures: '五官特征',
  hairStyle: '发型',
  skinTone: '肤色',
  defaultOutfit: '主服装',
  accessories: '配饰',
  visualAnchor: '视觉锚点',
  step3Description: 'Step3 角色描述',
};

const PROP_FIELD_LABELS: Record<string, string> = {
  appearanceDesc: '外观描述',
  size: '大小',
  material: '材质',
  shapeStructure: '结构',
  color: '颜色',
  texture: '质感',
  condition: '新旧状态',
  visualAnchor: '视觉锚点',
  step3Description: 'Step3 道具描述',
};

const MATERIAL_KEYWORDS = [
  '色', '金', '银', '铜', '铁', '玉', '木', '布', '皮', '纱', '袍', '甲', '绸', '缎', '瓷', '石',
];

export function extractCharacterConsistencyText(adaptedScript: string, characterName: string): string {
  if (!adaptedScript || !characterName) return '';
  const lines = adaptedScript.split(/\r?\n/);
  const startIndex = lines.findIndex((line) =>
    line.includes(characterName)
    && line.includes('**')
    && includesAnyTextVariant(line, ['一致']),
  );
  if (startIndex < 0) return '';

  const content: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (line.startsWith('##') || (line.includes('**') && includesAnyTextVariant(line, ['一致']))) {
      break;
    }
    content.push(line);
  }
  return content.join('\n').trim();
}

function sceneUseCount(sceneName: string, storyboards: StoryboardInfo[] | undefined) {
  return (storyboards ?? []).filter((storyboard) => storyboard.scene === sceneName).length;
}

function hasSceneVisualBase(scene: SceneInfo) {
  return [
    scene.environment,
    scene.step3Description,
    scene.layout,
    scene.keySetPieces,
    scene.lighting,
    scene.atmosphere,
  ].some((value) => hasText(value, 6));
}

function hasCharacterVisualBase(
  profile: CharacterProfile | undefined,
  consistencyText: string,
  primaryOutfit: CharacterOutfit | null | undefined,
) {
  const reusableDescriptions = [
    profile?.description,
    profile?.step3Description,
    consistencyText,
    primaryOutfit?.outfitDesc,
  ].filter((value) => hasText(value, 12));

  const visualAnchors = [
    profile?.ageAppearance,
    profile?.temperament,
    profile?.bodyBuild,
    profile?.faceFeatures,
    profile?.hairStyle,
    profile?.skinTone,
    profile?.defaultOutfit,
    profile?.accessories,
    profile?.visualAnchor,
  ].filter((value) => hasText(value, 4));

  return reusableDescriptions.length > 0 || visualAnchors.length >= 2;
}

export function getSceneDetailSuggestions(scene: SceneInfo): string[] {
  const suggestions: string[] = [];
  const environment = normalizeText(scene.environment);
  const step3Description = normalizeText(scene.step3Description);

  if (environment.length > 0 && environment.length < 24) {
    suggestions.push('可补充空间用途、关键陈设或环境材质');
  }
  if (!normalizeText(scene.layout)) {
    suggestions.push('可补充前景/中景/后景或左右分区布局');
  }
  if (!normalizeText(scene.lighting)) {
    suggestions.push('可补充主光源方向和光线质感');
  }
  if (!normalizeText(scene.keySetPieces)) {
    suggestions.push('可补充最能识别场景的陈设或地标');
  }
  if (step3Description.length > 0 && step3Description.length < 30) {
    suggestions.push('可补一段更完整的 Step3 综合场景描述');
  }
  if ((scene.characters ?? []).length === 0) {
    suggestions.push('可确认该场景的出场角色');
  }

  return suggestions;
}

export function getSceneBlockingSuggestions(
  scene: SceneInfo,
  storyboards?: StoryboardInfo[],
): string[] {
  const isReferenced = sceneUseCount(scene.name, storyboards) > 0;
  if (isReferenced && !hasSceneVisualBase(scene)) {
    return ['缺少可用于出图的基础场景描述'];
  }
  return [];
}

export function getOutfitDetailSuggestions(outfit: CharacterOutfit): string[] {
  const suggestions: string[] = [];
  const description = normalizeText(outfit.outfitDesc);

  if (description.length > 0 && description.length < 20) {
    suggestions.push('可补充颜色、材质、层次或关键配饰');
  } else if (description && !hasAnyKeyword(description, MATERIAL_KEYWORDS)) {
    suggestions.push('可再补一点材质、版型或配饰细节');
  }

  if (outfit.needsNewImage && !normalizeText(outfit.storyboardRange)) {
    suggestions.push('可补充分镜范围');
  }

  return suggestions;
}

export function getOutfitBlockingSuggestions(outfit: CharacterOutfit): string[] {
  if (!outfit.needsNewImage) return [];
  const suggestions: string[] = [];
  if (!hasText(outfit.outfitDesc, 6)) {
    suggestions.push('变装需要新图，但缺少可用于出图的服装描述');
  }
  if (!normalizeText(outfit.storyboardRange)) {
    suggestions.push('变装需要新图，但缺少分镜范围');
  }
  return suggestions;
}

export function getPropDetailSuggestions(prop: PropConsistency): string[] {
  if (prop.needsTracking === false || !prop.needsImage) return [];

  const suggestions: string[] = [];
  const description = normalizeText(prop.appearanceDesc);

  if (description.length > 0 && description.length < 18) {
    suggestions.push('可补充颜色、材质、结构或纹样');
  }
  if (!normalizeText(prop.size)) {
    suggestions.push('可补充大小或尺寸感');
  }
  if (!normalizeText(prop.material)) {
    suggestions.push('可补充主要材质');
  }
  if (!normalizeText(prop.shapeStructure)) {
    suggestions.push('可补充形状和结构锚点');
  }
  if (!normalizeText(prop.step3Description)) {
    suggestions.push('可补一段 Step3 综合道具描述');
  }

  return suggestions;
}

export function getPropBlockingSuggestions(prop: PropConsistency): string[] {
  if (prop.needsTracking === false || !prop.needsImage) return [];
  const suggestions: string[] = [];
  if (!hasText(prop.appearanceDesc, 6) && !hasText(prop.step3Description, 6)) {
    suggestions.push('道具需要生成设定图，但缺少可用于出图的外观描述');
  }
  if (!normalizeText(prop.size)) {
    suggestions.push('道具需要生成设定图，但缺少大小/尺寸感');
  }
  return suggestions;
}

export function getSceneInferredFieldLabels(scene: SceneInfo) {
  return toUniqueLabels(scene.inferredFields, SCENE_FIELD_LABELS);
}

export function getCharacterInferredFieldLabels(profile?: CharacterProfile | null) {
  return toUniqueLabels(profile?.inferredFields, CHARACTER_FIELD_LABELS);
}

export function getPropInferredFieldLabels(prop: PropConsistency) {
  return toUniqueLabels(prop.inferredFields, PROP_FIELD_LABELS);
}

export function getCharacterReviewSummary({
  characterName,
  adaptedScript,
  outfits,
  characterProfiles,
}: {
  characterName: string;
  adaptedScript: string;
  outfits: CharacterOutfit[];
  characterProfiles: CharacterProfile[];
}) {
  const consistencyText = extractCharacterConsistencyText(adaptedScript, characterName);
  const existingProfile = characterProfiles.find((profile) => profile.name === characterName);
  const primaryOutfit = outfits
    .filter((outfit) => outfit.characterName === characterName)
    .slice()
    .sort((a, b) => a.outfitSeq - b.outfitSeq)[0];

  const suggestions: string[] = [];
  if (!normalizeText(existingProfile?.description) && !consistencyText) {
    suggestions.push('可补充可复用的角色描述');
  }
  if (!normalizeText(existingProfile?.ageAppearance)) {
    suggestions.push('可补充年龄感');
  }
  if (!normalizeText(existingProfile?.temperament)) {
    suggestions.push('可补充人物气质');
  }
  if (!normalizeText(existingProfile?.faceFeatures)) {
    suggestions.push('可补充五官辨识点或面部结构');
  }
  if (!normalizeText(existingProfile?.step3Description)) {
    suggestions.push('可补一段 Step3 角色描述');
  } else if (normalizeText(existingProfile?.step3Description).length < 30) {
    suggestions.push('Step3 角色描述偏短，可补充年龄感、脸部锚点、发型、服装和气质');
  }
  if (!normalizeText(primaryOutfit?.outfitDesc) && !normalizeText(existingProfile?.defaultOutfit)) {
    suggestions.push('可补充稳定服装锚点');
  }

  const metaChips = [
    existingProfile?.ageAppearance ? `年龄感：${existingProfile.ageAppearance}` : '',
    existingProfile?.temperament ? `气质：${existingProfile.temperament}` : '',
    existingProfile?.skinTone ? `肤色：${existingProfile.skinTone}` : '',
    existingProfile?.bodyBuild ? `体型：${existingProfile.bodyBuild}` : '',
    existingProfile?.hairStyle ? `发型：${existingProfile.hairStyle}` : '',
    existingProfile?.defaultOutfit ? `主服装：${existingProfile.defaultOutfit}` : '',
    existingProfile?.accessories ? `配饰：${existingProfile.accessories}` : '',
    existingProfile?.visualAnchor ? `视觉锚点：${existingProfile.visualAnchor}` : '',
  ].filter(Boolean);

  return {
    consistencyText,
    description: normalizeText(existingProfile?.description) || consistencyText,
    step3Description: normalizeText(existingProfile?.step3Description),
    metaChips,
    primaryOutfit,
    suggestions,
    profile: existingProfile,
    inferredLabels: getCharacterInferredFieldLabels(existingProfile),
  };
}

export function getCharacterBlockingSuggestions({
  characterName,
  analysis,
  adaptedScript,
}: {
  characterName: string;
  analysis: ScriptAnalysis;
  adaptedScript: string;
}) {
  const review = getCharacterReviewSummary({
    characterName,
    adaptedScript,
    outfits: analysis.outfitTracking ?? [],
    characterProfiles: analysis.characterProfiles ?? [],
  });
  if (hasCharacterVisualBase(review.profile, review.consistencyText, review.primaryOutfit)) return [];
  return ['角色缺少可用于出图的基础外观描述'];
}

export interface ReviewOverviewSection {
  key: 'scenes' | 'characters' | 'outfits' | 'props';
  label: string;
  needsReviewCount: number;
  optionalImproveCount: number;
  inferredCount: number;
  examples: string[];
  optionalExamples: string[];
}

export function getAnalysisReviewOverview({
  analysis,
  adaptedScript,
}: {
  analysis: ScriptAnalysis;
  adaptedScript: string;
}) {
  const sceneBlockingSections = analysis.scenes.filter((scene) =>
    getSceneBlockingSuggestions(scene, analysis.storyboards).length > 0,
  );
  const sceneOptionalSections = analysis.scenes.filter((scene) =>
    getSceneDetailSuggestions(scene).length > getSceneBlockingSuggestions(scene, analysis.storyboards).length,
  );
  const characterBlockingSections = analysis.allCharacterNames.filter((characterName) =>
    getCharacterBlockingSuggestions({ characterName, analysis, adaptedScript }).length > 0,
  );
  const characterOptionalSections = analysis.allCharacterNames.filter((characterName) =>
    getCharacterReviewSummary({
      characterName,
      adaptedScript,
      outfits: analysis.outfitTracking ?? [],
      characterProfiles: analysis.characterProfiles ?? [],
    }).suggestions.length > getCharacterBlockingSuggestions({ characterName, analysis, adaptedScript }).length,
  );
  const outfitBlockingSections = (analysis.outfitTracking ?? []).filter((outfit) =>
    getOutfitBlockingSuggestions(outfit).length > 0,
  );
  const outfitOptionalSections = (analysis.outfitTracking ?? []).filter((outfit) =>
    getOutfitDetailSuggestions(outfit).length > getOutfitBlockingSuggestions(outfit).length,
  );
  const propBlockingSections = (analysis.propTracking ?? []).filter((prop) =>
    getPropBlockingSuggestions(prop).length > 0,
  );
  const propOptionalSections = (analysis.propTracking ?? []).filter((prop) =>
    getPropDetailSuggestions(prop).length > getPropBlockingSuggestions(prop).length,
  );

  const sections: ReviewOverviewSection[] = [
    {
      key: 'scenes',
      label: '场景图像',
      needsReviewCount: sceneBlockingSections.length,
      optionalImproveCount: sceneOptionalSections.length,
      inferredCount: analysis.scenes.filter((scene) => getSceneInferredFieldLabels(scene).length > 0).length,
      examples: sceneBlockingSections.slice(0, 3).map((scene) => scene.name),
      optionalExamples: sceneOptionalSections.slice(0, 3).map((scene) => scene.name),
    },
    {
      key: 'characters',
      label: '角色图像',
      needsReviewCount: characterBlockingSections.length,
      optionalImproveCount: characterOptionalSections.length,
      inferredCount: analysis.characterProfiles.filter((profile) => getCharacterInferredFieldLabels(profile).length > 0).length,
      examples: characterBlockingSections.slice(0, 3),
      optionalExamples: characterOptionalSections.slice(0, 3),
    },
    {
      key: 'outfits',
      label: '变装记录',
      needsReviewCount: outfitBlockingSections.length,
      optionalImproveCount: outfitOptionalSections.length,
      inferredCount: 0,
      examples: outfitBlockingSections.slice(0, 3).map((outfit) => `${outfit.characterName}#${outfit.outfitSeq}`),
      optionalExamples: outfitOptionalSections.slice(0, 3).map((outfit) => `${outfit.characterName}#${outfit.outfitSeq}`),
    },
    {
      key: 'props',
      label: '道具图像',
      needsReviewCount: propBlockingSections.length,
      optionalImproveCount: propOptionalSections.length,
      inferredCount: analysis.propTracking.filter((prop) => getPropInferredFieldLabels(prop).length > 0).length,
      examples: propBlockingSections.slice(0, 3).map((prop) => prop.propName),
      optionalExamples: propOptionalSections.slice(0, 3).map((prop) => prop.propName),
    },
  ];

  const priorityActions: string[] = [];
  if (sceneBlockingSections.length > 0) {
    priorityActions.push('优先补齐缺少基础描述的关键场景');
  }
  if (characterBlockingSections.length > 0) {
    priorityActions.push('优先补齐所有出图角色的基础外观');
  }
  if (propBlockingSections.length > 0) {
    priorityActions.push('优先补齐需要生成设定图的关键道具外观');
  }
  if (outfitBlockingSections.length > 0) {
    priorityActions.push('优先补齐需要新图的变装描述和分镜范围');
  }

  const totalNeedsReviewCount = sections.reduce((sum, section) => sum + section.needsReviewCount, 0);
  const totalOptionalImproveCount = sections.reduce((sum, section) => sum + section.optionalImproveCount, 0);
  const totalInferredCount = sections.reduce((sum, section) => sum + section.inferredCount, 0);

  return {
    sections,
    priorityActions,
    totalNeedsReviewCount,
    totalBlockingCount: totalNeedsReviewCount,
    totalOptionalImproveCount,
    totalInferredCount,
  };
}
