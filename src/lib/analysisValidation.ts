import type { CharacterOutfit, PropConsistency, ScriptAnalysis } from '@/types';

function normalizeName(value: string) {
  return value.trim();
}

function toUniqueNames(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const normalizedItem = normalizeName(item);
    if (!normalizedItem || seen.has(normalizedItem)) continue;
    seen.add(normalizedItem);
    result.push(normalizedItem);
  }

  return result;
}

function isAllowedPropHolder(holder: string, knownCharacters: Set<string>) {
  const normalizedHolder = normalizeName(holder);
  if (!normalizedHolder) return true;
  return normalizedHolder === '无'
    || normalizedHolder === '场景道具'
    || normalizedHolder === '无/场景道具'
    || knownCharacters.has(normalizedHolder);
}

function isPositiveInteger(value: number) {
  return Number.isInteger(value) && value > 0;
}

function parseDurationSeconds(duration: string): number | null {
  const normalizedDuration = normalizeName(duration);
  if (!normalizedDuration) return null;

  const secondsMatch = normalizedDuration.match(/(\d+(?:\.\d+)?)/);
  if (!secondsMatch) return null;

  const seconds = Number(secondsMatch[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function hasSceneDetail(scene: ScriptAnalysis['scenes'][number]) {
  return [
    scene.environment,
    scene.step3Description,
    scene.layout,
    scene.keySetPieces,
    scene.lighting,
    scene.weather,
  ].some((value) => normalizeName(value ?? '') !== '');
}

function hasCharacterProfileDetail(profile: ScriptAnalysis['characterProfiles'][number]) {
  return [
    profile.description,
    profile.step3Description,
    profile.ageAppearance,
    profile.temperament,
    profile.faceFeatures,
    profile.hairStyle,
    profile.defaultOutfit,
    profile.visualAnchor,
  ].some((value) => normalizeName(value ?? '') !== '');
}

function hasPropDetail(prop: PropConsistency) {
  return [
    prop.appearanceDesc,
    prop.step3Description,
    prop.size,
    prop.material,
    prop.shapeStructure,
    prop.color,
    prop.texture,
    prop.visualAnchor,
  ].some((value) => normalizeName(value ?? '') !== '');
}

interface AnalysisValidationOptions {
  /** Step1 validates structure only; Step2 keeps strict Step3 asset readiness checks. */
  requireStep3Details?: boolean;
}

function parseStoryboardRange(range: string): { start: number; end: number } | null {
  const normalizedRange = normalizeName(range);
  if (!normalizedRange) return null;

  const rangeMatch = normalizedRange.match(/分镜\s*(\d+)\s*[-—–到至]\s*(\d+)/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (!isPositiveInteger(start) || !isPositiveInteger(end) || end < start) return null;
    return { start, end };
  }

  const singleMatch = normalizedRange.match(/分镜\s*(\d+)/);
  if (!singleMatch) return null;

  const number = parseInt(singleMatch[1], 10);
  if (!isPositiveInteger(number)) return null;
  return { start: number, end: number };
}

function isValidStoryboardRange(range: string, knownStoryboardNumbers: Set<number>) {
  const parsed = parseStoryboardRange(range);
  if (!parsed) return false;

  for (let number = parsed.start; number <= parsed.end; number += 1) {
    if (!knownStoryboardNumbers.has(number)) return false;
  }

  return true;
}

function getStoryboardLabel(name: string, number: number) {
  return `分镜「${normalizeName(name) || number}」`;
}

function getOutfitLabel(outfit: CharacterOutfit) {
  const characterName = normalizeName(outfit.characterName) || '未命名角色';
  const seq = isPositiveInteger(outfit.outfitSeq) ? outfit.outfitSeq : '?';
  return `服装记录「${characterName}#${seq}」`;
}

function getPropLabel(prop: PropConsistency) {
  return `道具「${normalizeName(prop.propName) || '未命名道具'}」`;
}

export function validateAnalysisBeforeConfirm(
  analysis: ScriptAnalysis,
  options: AnalysisValidationOptions = {},
): string | null {
  const requireStep3Details = options.requireStep3Details ?? true;
  const sceneNames = analysis.scenes.map((scene) => normalizeName(scene.name));
  const characterNames = analysis.allCharacterNames.map(normalizeName);
  const storyboardNumbers = analysis.storyboards.map((storyboard) => storyboard.number);
  const knownScenes = new Set(sceneNames.filter(Boolean));
  const knownCharacters = new Set(characterNames.filter(Boolean));
  const knownStoryboardNumbers = new Set<number>();

  if (analysis.storyboards.length === 0) return '至少需要保留 1 个分镜';
  if (sceneNames.some((name) => !name)) return '场景名称不能为空';
  if (new Set(sceneNames.filter(Boolean)).size !== sceneNames.filter(Boolean).length) return '场景名称不能重复';
  if (characterNames.some((name) => !name)) return '角色名称不能为空';
  if (new Set(characterNames.filter(Boolean)).size !== characterNames.filter(Boolean).length) return '角色名称不能重复';

  for (const scene of analysis.scenes) {
    const unknownCharacters = toUniqueNames(scene.characters).filter((character) => !knownCharacters.has(character));
    if (unknownCharacters.length > 0) {
      return `场景「${scene.name}」存在未定义角色：${unknownCharacters.join('、')}`;
    }
  }

  for (const profile of analysis.characterProfiles ?? []) {
    const profileName = normalizeName(profile.name);
    if (!profileName || !knownCharacters.has(profileName)) {
      return `角色画像引用了未定义角色「${profile.name}」`;
    }
  }

  for (const storyboardNumber of storyboardNumbers) {
    if (!isPositiveInteger(storyboardNumber)) return '分镜编号必须是大于 0 的整数';
    if (knownStoryboardNumbers.has(storyboardNumber)) return '分镜编号不能重复';
    knownStoryboardNumbers.add(storyboardNumber);
  }

  for (const storyboard of analysis.storyboards) {
    const storyboardLabel = getStoryboardLabel(storyboard.name, storyboard.number);
    const sceneName = normalizeName(storyboard.scene ?? '');

    if (!normalizeName(storyboard.name)) return '分镜名称不能为空';
    if (parseDurationSeconds(storyboard.duration) === null) return `${storyboardLabel}缺少有效时长`;
    if (!sceneName) return `${storyboardLabel}缺少所属场景`;
    if (!knownScenes.has(sceneName)) return `${storyboardLabel}引用了不存在的场景「${storyboard.scene}」`;

    const unknownCharacters = toUniqueNames(storyboard.characters).filter((character) => !knownCharacters.has(character));
    if (unknownCharacters.length > 0) {
      return `${storyboardLabel}存在未定义角色：${unknownCharacters.join('、')}`;
    }
  }

  for (const outfit of analysis.outfitTracking) {
    const outfitLabel = getOutfitLabel(outfit);
    const characterName = normalizeName(outfit.characterName);

    if (!characterName || !knownCharacters.has(characterName)) {
      return `${outfitLabel}引用了未定义角色「${outfit.characterName}」`;
    }
    if (!isValidStoryboardRange(outfit.storyboardRange, knownStoryboardNumbers)) {
      return `${outfitLabel}引用了不存在的分镜范围「${outfit.storyboardRange}」`;
    }
  }

  for (const prop of analysis.propTracking) {
    const propLabel = getPropLabel(prop);

    if (!isAllowedPropHolder(prop.holder, knownCharacters)) {
      return `${propLabel}引用了不存在的持有者「${prop.holder}」`;
    }
    if (!isValidStoryboardRange(prop.storyboardRange, knownStoryboardNumbers)) {
      return `${propLabel}引用了不存在的分镜范围「${prop.storyboardRange}」`;
    }
  }

  if (requireStep3Details) {
    for (const scene of analysis.scenes) {
      if (!hasSceneDetail(scene)) {
        return `场景「${scene.name}」缺少可供 Step3 使用的场景画像描述`;
      }
    }

    for (const profile of analysis.characterProfiles ?? []) {
      if (!hasCharacterProfileDetail(profile)) {
        return `角色「${profile.name}」缺少可供 Step3 使用的角色画像描述`;
      }
    }

    for (const characterName of knownCharacters) {
      const profile = analysis.characterProfiles.find((item) => normalizeName(item.name) === characterName);
      if (!profile || !hasCharacterProfileDetail(profile)) {
        return `角色「${characterName}」缺少可供 Step3 使用的角色画像描述`;
      }
    }

    for (const prop of analysis.propTracking) {
      const propLabel = getPropLabel(prop);

      if (prop.needsImage && !hasPropDetail(prop)) {
        return `${propLabel}缺少可供 Step3 使用的道具画像描述`;
      }
      if (prop.needsImage && !normalizeName(prop.size ?? '')) {
        return `${propLabel}缺少大小/尺寸信息，难以稳定生成参考图`;
      }
    }
  }

  return null;
}
