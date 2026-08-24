import type { CharacterProfile, PropConsistency, ScriptAnalysis } from '@/types';
import { getSafePropHolderLabel, shouldUseVisualCharacterName } from '@/lib/characterAssetGuards';
import { normalizeGeneratedPropTrackingDefaults } from '@/lib/propTracking';

function extractFromCodeBlock(text: string): string | null {
  const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (jsonBlockMatch) return jsonBlockMatch[1].trim();

  const codeBlockMatch = text.match(/```\s*([\s\S]*?)```/);
  if (!codeBlockMatch) return null;

  const content = codeBlockMatch[1].trim();
  return content.startsWith('{') || content.startsWith('[') ? content : null;
}

function extractAsRawJson(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed : null;
}

function findJsonInText(text: string): string | null {
  const startIdx = text.indexOf('{');
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = startIdx; index < text.length; index += 1) {
    const ch = text[index];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;

    if (depth === 0) {
      return text.slice(startIdx, index + 1);
    }
  }

  return null;
}

function tryFixJsonIssues(jsonStr: string): string {
  return jsonStr
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,\s*([}\]])/g, '$1');
}

const SCENE_SECTION_PATTERN = /\*\*场景一致性\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n###|\n##|$)/gi;
const CHARACTER_SECTION_PATTERN = /\*\*人物一致性[｜|:：]?([^*\n]+)\*\*\s*\n([\s\S]*?)(?=\n\*\*人物一致性[｜|:：]?|\n###|\n##|$)/gi;
const PROP_SECTION_PATTERN = /\*\*(?:物品\/道具一致性|道具一致性)\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n###|\n##|$)/gi;
const STORYBOARD_HEADER_PATTERN = /^(?:#{1,3}\s*)?分镜\s*([0-9０-９]+(?:\s*[-－—–]\s*[0-9０-９]+)*)([^\n]*)$/gim;
const TIME_RANGE_PATTERN = /(\d+(?:\.\d+)?)\s*[-—–]\s*(\d+(?:\.\d+)?)\s*秒/g;
const TIMECODE_RANGE_PATTERN = /\d{1,2}:\d{2}\s*[-－—–]\s*\d{1,2}:\d{2}/g;

function normalizeDigits(value: string): string {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function normalizeStoryboardLabel(value: string): string {
  const normalized = normalizeDigits(value)
    .replace(/[－—–]/g, '-')
    .replace(/\s+/g, '');
  const parts = normalized
    .split('-')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));

  return parts.map(String).join('-') || normalized;
}

function parseStoryboardLabelNumber(label: string, fallbackNumber: number): number {
  const normalized = normalizeStoryboardLabel(label);
  if (normalized.includes('-')) return fallbackNumber;

  const number = Number.parseInt(normalized, 10);
  return Number.isFinite(number) && number > 0 ? number : fallbackNumber;
}

function cleanInlineText(value: string): string {
  return value
    .replace(/[*`#]/g, '')
    .replace(/^(?:\[|\]|【|】)+/, '')
    .replace(/(?:\[|\]|【|】)+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeOptionalText(value: unknown): string {
  return typeof value === 'string' ? cleanInlineText(value) : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => cleanInlineText(item))
    .filter(Boolean);
}

function getSceneMatchKey(value: string | undefined): string {
  return cleanInlineText(value ?? '').replace(/\s+/g, '').toLowerCase();
}

function normalizeCharacterNameArray(value: unknown): string[] {
  return normalizeStringArray(value).filter(shouldUseVisualCharacterName);
}

function uniqueTextParts(parts: Array<string | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of parts) {
    const normalized = cleanInlineText(part ?? '');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function joinDescriptionParts(parts: Array<string | undefined>, separator = '，') {
  return uniqueTextParts(parts).join(separator);
}

function buildSceneStep3Description(scene: Partial<ScriptAnalysis['scenes'][number]>) {
  return joinDescriptionParts([
    scene.environment,
    scene.layout,
    scene.keySetPieces,
    scene.lighting,
    scene.weather,
    scene.colorTone ? `色调：${scene.colorTone}` : '',
    scene.atmosphere ? `氛围：${scene.atmosphere}` : '',
  ]);
}

function buildCharacterDescription(profile: Partial<CharacterProfile>) {
  return joinDescriptionParts([
    profile.ageAppearance,
    profile.skinTone,
    profile.hairStyle,
    profile.faceFeatures,
    profile.bodyBuild,
    profile.defaultOutfit,
    profile.accessories,
    profile.temperament,
    profile.visualAnchor,
  ]);
}

function buildCharacterStep3Description(profile: Partial<CharacterProfile>) {
  return joinDescriptionParts([
    profile.ageAppearance,
    profile.skinTone,
    profile.hairStyle,
    profile.faceFeatures,
    profile.bodyBuild,
    profile.defaultOutfit,
    profile.accessories,
    profile.temperament,
    profile.visualAnchor,
    profile.description,
  ]);
}

function buildPropStep3Description(prop: Partial<PropConsistency>) {
  return joinDescriptionParts([
    prop.size,
    prop.material,
    prop.shapeStructure,
    prop.color,
    prop.texture,
    prop.condition,
    prop.appearanceDesc,
    prop.visualAnchor,
  ]);
}

function buildVisualAnchor(text: string) {
  const normalized = cleanInlineText(text);
  if (!normalized) return '';
  return normalized.split(/[，。；]/)[0]?.slice(0, 40) ?? '';
}

function normalizeSceneInfo(scene: Partial<ScriptAnalysis['scenes'][number]>): ScriptAnalysis['scenes'][number] {
  const normalized = {
    name: normalizeOptionalText(scene.name) || '未命名场景',
    timeOfDay: normalizeOptionalText(scene.timeOfDay),
    environment: normalizeOptionalText(scene.environment),
    colorTone: normalizeOptionalText(scene.colorTone),
    characters: normalizeCharacterNameArray(scene.characters),
    spaceScale: normalizeOptionalText(scene.spaceScale),
    layout: normalizeOptionalText(scene.layout),
    keySetPieces: normalizeOptionalText(scene.keySetPieces),
    lighting: normalizeOptionalText(scene.lighting),
    weather: normalizeOptionalText(scene.weather),
    atmosphere: normalizeOptionalText(scene.atmosphere),
    step3Description: normalizeOptionalText(scene.step3Description),
    inferredFields: normalizeStringArray(scene.inferredFields),
  };

  if (!normalized.step3Description) {
    normalized.step3Description = buildSceneStep3Description(normalized);
  }

  return normalized;
}

function normalizeCharacterProfile(
  profile: Partial<CharacterProfile>,
  outfitTracking: ScriptAnalysis['outfitTracking'],
): CharacterProfile {
  const name = normalizeOptionalText(profile.name);
  const defaultOutfit = normalizeOptionalText(profile.defaultOutfit)
    || outfitTracking.find((outfit) => cleanInlineText(outfit.characterName) === name)?.outfitDesc?.trim()
    || '';

  const normalized = {
    name,
    description: normalizeOptionalText(profile.description),
    ageAppearance: normalizeOptionalText(profile.ageAppearance),
    temperament: normalizeOptionalText(profile.temperament),
    bodyBuild: normalizeOptionalText(profile.bodyBuild),
    faceFeatures: normalizeOptionalText(profile.faceFeatures),
    hairStyle: normalizeOptionalText(profile.hairStyle),
    skinTone: normalizeOptionalText(profile.skinTone),
    defaultOutfit,
    accessories: normalizeOptionalText(profile.accessories),
    visualAnchor: normalizeOptionalText(profile.visualAnchor),
    step3Description: normalizeOptionalText(profile.step3Description),
    inferredFields: normalizeStringArray(profile.inferredFields),
  };

  if (!normalized.description) {
    normalized.description = buildCharacterDescription(normalized);
  }
  if (!normalized.visualAnchor) {
    normalized.visualAnchor = buildVisualAnchor(normalized.description || normalized.step3Description);
  }
  if (!normalized.step3Description) {
    normalized.step3Description = buildCharacterStep3Description(normalized);
  }

  return normalized;
}

function normalizePropConsistency(prop: Partial<PropConsistency>): PropConsistency {
  const normalized = {
    trackingId: typeof prop.trackingId === 'string' ? prop.trackingId : undefined,
    propName: normalizeOptionalText(prop.propName),
    appearanceDesc: normalizeOptionalText(prop.appearanceDesc),
    size: normalizeOptionalText(prop.size),
    material: normalizeOptionalText(prop.material),
    shapeStructure: normalizeOptionalText(prop.shapeStructure),
    color: normalizeOptionalText(prop.color),
    texture: normalizeOptionalText(prop.texture),
    condition: normalizeOptionalText(prop.condition),
    visualAnchor: normalizeOptionalText(prop.visualAnchor),
    step3Description: normalizeOptionalText(prop.step3Description),
    inferredFields: normalizeStringArray(prop.inferredFields),
    holder: getSafePropHolderLabel(normalizeOptionalText(prop.holder)),
    storyboardRange: normalizeOptionalText(prop.storyboardRange),
    stateChanges: normalizeOptionalText(prop.stateChanges),
    needsTracking: typeof prop.needsTracking === 'boolean' ? prop.needsTracking : true,
    needsImage: typeof prop.needsImage === 'boolean' ? prop.needsImage : false,
  } satisfies PropConsistency;

  if (!normalized.condition && normalized.stateChanges) {
    normalized.condition = cleanInlineText(normalized.stateChanges.split(/(?:->|→|↠)/)[0] || '');
  }
  if (!normalized.visualAnchor) {
    normalized.visualAnchor = buildVisualAnchor(normalized.appearanceDesc || normalized.step3Description);
  }
  if (!normalized.step3Description) {
    normalized.step3Description = buildPropStep3Description(normalized);
  }

  return normalized;
}

function shouldUseCharacterName(name: string): boolean {
  return shouldUseVisualCharacterName(cleanInlineText(name));
}

function formatDuration(seconds: number): string {
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1).replace(/\.0$/, '')}秒`;
}

function extractDurationFromText(text: string): string {
  const directMatch = text.match(/(?:总时长|时长|本镜时长)?\s*[：:（(]?\s*(\d+(?:\.\d+)?)\s*秒/);
  if (directMatch) return formatDuration(Number(directMatch[1]));

  const timecodeMatch = text.match(/(\d{1,2}):(\d{2})\s*[-－—–]\s*(\d{1,2}):(\d{2})/);
  if (timecodeMatch) {
    const start = Number(timecodeMatch[1]) * 60 + Number(timecodeMatch[2]);
    const end = Number(timecodeMatch[3]) * 60 + Number(timecodeMatch[4]);
    const duration = end - start;
    if (Number.isFinite(duration) && duration > 0) return formatDuration(duration);
  }

  let maxEnd = 0;
  for (const match of text.matchAll(TIME_RANGE_PATTERN)) {
    const end = Number(match[2]);
    if (Number.isFinite(end)) {
      maxEnd = Math.max(maxEnd, end);
    }
  }

  return maxEnd > 0 ? formatDuration(maxEnd) : '';
}

function extractProjectNameFromText(rawText: string): string {
  const headingMatch = rawText.match(/^\s*#\s*(.+)$/m);
  if (headingMatch?.[1]) return cleanInlineText(headingMatch[1]).slice(0, 60);

  const titleMatch = rawText.match(/《([^》]{2,40})》/);
  if (titleMatch?.[1]) return cleanInlineText(titleMatch[1]);

  const firstMeaningfulLine = rawText
    .split(/\n/)
    .map((line) => cleanInlineText(line))
    .find((line) => line
      && !line.startsWith('分镜')
      && !line.startsWith('**')
      && !line.startsWith('画面')
      && line.length <= 40);

  return firstMeaningfulLine || '未命名项目';
}

function extractStyleConfigFromText(rawText: string): string {
  const aestheticMatch = rawText.match(/\*\*画幅与美学\*\*\s*\n([^\n]+)/i);
  if (!aestheticMatch?.[1]) return '';

  const cleaned = cleanInlineText(
    aestheticMatch[1]
      .replace(/^竖屏\s*9[:：]16[。.\s]*/i, '')
      .replace(/^横屏\s*16[:：]9[。.\s]*/i, ''),
  );
  if (!cleaned || cleaned.includes('风格描述')) return '';
  return cleaned.slice(0, 120);
}

function extractCharacterNames(rawText: string): string[] {
  const characterPatterns = [
    /\*\*人物一致性[｜|:：]?(.+?)\*\*/g,
    /人物一致性[｜|:：]?\s*(.+?)(?:\n|$)/g,
    /\*\*(?:对白|内心OS)[（(]([^）)\n]+)[）)]\*\*/g,
    /对白[：:]\s*([^：:\n]{1,20})[：:]/g,
    /^角色[：:]\s*([^，,、\n\r]{1,20})/gm,
  ];

  const charSet = new Set<string>();
  for (const pattern of characterPatterns) {
    let match;
    while ((match = pattern.exec(rawText)) !== null) {
      const name = cleanInlineText(match[1]);
      if (shouldUseCharacterName(name)) {
        charSet.add(name);
      }
    }
  }

  for (const match of rawText.matchAll(/^出场角色[：:]\s*([^\n\r]+)/gm)) {
    match[1]
      .split(/[、,，]/)
      .map((name) => cleanInlineText(name))
      .filter((name) => shouldUseCharacterName(name))
      .forEach((name) => charSet.add(name));
  }

  return Array.from(charSet);
}

function collectSectionContents(pattern: RegExp, rawText: string): string[] {
  const results: string[] = [];
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(rawText)) !== null) {
    const content = match[1]?.trim();
    if (content) results.push(content);
  }
  return results;
}

function extractSceneNameCandidate(value: string): string {
  let candidate = cleanInlineText(value.split(/[，,]/)[0] || value);
  const keepIndex = candidate.indexOf('保持');
  if (keepIndex > 0 && keepIndex <= 12) {
    candidate = candidate.slice(0, keepIndex);
  }
  return cleanInlineText(candidate).slice(0, 50);
}

function parseSceneBlock(sceneText: string, knownCharacters: string[]): ScriptAnalysis['scenes'][number] | null {
  const lines = sceneText
    .split(/\n/)
    .map((line) => cleanInlineText(line))
    .filter(Boolean);
  if (lines.length === 0) return null;

  const combined = lines.join('，');
  const firstLineTokens = lines[0].split(/[，,]/).map((item) => cleanInlineText(item)).filter(Boolean);
  const name = extractSceneNameCandidate(firstLineTokens[0] || lines[0]);
  if (!name) return null;

  const timeOfDay = firstLineTokens[1]
    || combined.match(/(清晨|早晨|上午|中午|午后|傍晚|黄昏|夜晚|深夜|午夜|白天)/)?.[1]
    || '';
  const colorTone = firstLineTokens.length >= 4
    ? firstLineTokens[firstLineTokens.length - 1]
    : (combined.match(/(冷青灰|暖金|冷色调|暖色调|青灰色调|昏黄|蓝灰)/)?.[1] || '');
  const environment = (firstLineTokens.length >= 3
    ? firstLineTokens.slice(2, Math.max(3, firstLineTokens.length - 1)).join('，')
    : '')
    || combined.slice(0, 200);
  const characters = knownCharacters.filter((character) => combined.includes(character));

  return normalizeSceneInfo({
    name,
    timeOfDay,
    environment,
    colorTone,
    characters,
    layout: environment,
    keySetPieces: '',
    lighting: '',
    weather: '',
    atmosphere: '',
    spaceScale: '',
    step3Description: buildSceneStep3Description({
      environment,
      colorTone,
      layout: environment,
    }),
    inferredFields: [],
  });
}

type FallbackStoryboardBlock = {
  storyboard: ScriptAnalysis['storyboards'][number];
  rawBlock: string;
};

function inferShotSizeFromBlock(block: string): string {
  return block.match(/(大全景|全景|远景|中景|近景|特写|大特写)/)?.[1] || '';
}

function inferStoryboardName(number: number, headerTail: string, block: string, sourceLabel?: string): string {
  const labeledTitle = headerTail.match(/(?:^|[｜|])\s*标题\s*[：:]\s*([^｜|\n]+)/)?.[1];
  if (labeledTitle) return cleanInlineText(labeledTitle).slice(0, 50);

  const boldTitle = headerTail.match(/[｜|:：-]\s*\*\*(.+?)\*\*/)?.[1];
  if (boldTitle) return cleanInlineText(boldTitle).slice(0, 50);

  const inlineTitle = cleanInlineText(
    headerTail
      .replace(TIMECODE_RANGE_PATTERN, '')
      .replace(/[（(][^（）()]*\d+(?:\.\d+)?\s*秒[^（）()]*[）)]/g, '')
      .replace(/^[｜|:：\-\s]+/, ''),
  );
  if (inlineTitle) return inlineTitle.slice(0, 50);

  const fallbackLine = block
    .split(/\n/)
    .map((line) => cleanInlineText(line))
    .find((line) => line
      && !line.startsWith('分镜')
      && !line.startsWith('**')
      && !line.startsWith('###'));
  if (fallbackLine) {
    const afterColon = cleanInlineText(fallbackLine.split(/[：:]/).slice(1).join('：') || fallbackLine);
    if (afterColon) return afterColon.slice(0, 24);
  }

  return `分镜${sourceLabel ?? String(number).padStart(2, '0')}`;
}

function extractStoryboardBlocks(rawText: string, knownCharacters: string[]): FallbackStoryboardBlock[] {
  const matches = [...rawText.matchAll(STORYBOARD_HEADER_PATTERN)];
  if (matches.length === 0) return [];

  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? rawText.length;
    const block = rawText.slice(start, end).trim();
    const sourceLabel = normalizeStoryboardLabel(match[1] ?? '');
    const number = parseStoryboardLabelNumber(sourceLabel, index + 1);
    const headerTail = match[2] || '';
    const duration = extractDurationFromText(match[0]) || extractDurationFromText(block);

    return {
      storyboard: {
        number,
        name: inferStoryboardName(number, headerTail, block, sourceLabel),
        duration,
        shotSize: inferShotSizeFromBlock(block),
        scene: undefined,
        characters: knownCharacters.filter((character) => block.includes(character)),
      },
      rawBlock: block,
    };
  });
}

function buildStoryboardRange(numbers: number[]): string {
  const unique = [...new Set(numbers.filter((number) => Number.isFinite(number)).sort((a, b) => a - b))];
  if (unique.length === 0) return '';
  if (unique.length === 1) return `分镜${String(unique[0]).padStart(2, '0')}`;
  return `分镜${String(unique[0]).padStart(2, '0')}-${String(unique[unique.length - 1]).padStart(2, '0')}`;
}

function extractTaggedValue(text: string, labels: string[]): string {
  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*[：:,，]?\\s*([^，。；;]+)`, 'i');
    const match = text.match(pattern);
    if (match?.[1]) return cleanInlineText(match[1]);
  }
  return '';
}

function extractPropTrackingFromText(
  rawText: string,
  storyboards: FallbackStoryboardBlock[],
): ScriptAnalysis['propTracking'] {
  const props: ScriptAnalysis['propTracking'] = [];
  const propSections = collectSectionContents(PROP_SECTION_PATTERN, rawText);

  for (const section of propSections) {
    const lines = section
      .split(/\n/)
      .map((line) => cleanInlineText(line.replace(/^[-*•]\s*/, '')))
      .filter(Boolean);

    let currentEntry = '';
    const flushEntry = () => {
      if (!currentEntry) return;

      const nameMatch = currentEntry.match(/^([^：:]{1,30})[：:]\s*(.+)$/);
      if (!nameMatch) {
        currentEntry = '';
        return;
      }

      const propName = cleanInlineText(nameMatch[1]);
      const rest = nameMatch[2];
      const holder = extractTaggedValue(rest, ['持有者', 'holder']) || '';
      const storyboardNumbers = storyboards
        .filter((item) => item.rawBlock.includes(propName))
        .map((item) => item.storyboard.number);
      const storyboardRange = extractTaggedValue(rest, ['分镜范围', '范围', 'storyboardRange'])
        || buildStoryboardRange(storyboardNumbers);
      const stateChanges = extractTaggedValue(rest, ['状态变化', '状态', 'stateChanges']) || '';
      const size = extractTaggedValue(rest, ['大小', '尺寸', 'size']) || '';
      const material = extractTaggedValue(rest, ['材质', 'material']) || '';
      const shapeStructure = extractTaggedValue(rest, ['形状', '结构', 'shapeStructure']) || '';
      const color = extractTaggedValue(rest, ['颜色', '主色', 'color']) || '';
      const texture = extractTaggedValue(rest, ['质感', '纹理', 'texture']) || '';
      const condition = extractTaggedValue(rest, ['当前状态', '状态', 'condition']) || '';
      const appearanceDesc = cleanInlineText(
        rest
          .replace(/(?:持有者|holder|分镜范围|范围|storyboardRange|状态变化|stateChanges|大小|尺寸|size|材质|material|形状|结构|shapeStructure|颜色|主色|color|质感|纹理|texture|当前状态|condition)\s*[：:]\s*[^，。；;]+/gi, '')
          .replace(/[，；;]+/g, '，'),
      ) || cleanInlineText(rest);
      const visualAnchor = buildVisualAnchor(appearanceDesc);

      props.push(normalizePropConsistency({
        propName,
        appearanceDesc,
        size,
        material,
        shapeStructure,
        color,
        texture,
        condition: condition || cleanInlineText(stateChanges.split(/(?:->|→|↠)/)[0] || ''),
        visualAnchor,
        step3Description: buildPropStep3Description({
          size,
          material,
          shapeStructure,
          color,
          texture,
          condition,
          appearanceDesc,
          visualAnchor,
        }),
        inferredFields: [],
        holder,
        storyboardRange,
        stateChanges,
        needsTracking: !/无须追踪|needstracking\s*[：:]?\s*false/i.test(rest),
        needsImage: /需要(?:生成)?参考图|需要生图|核心道具|关键道具|反复特写|needsimage\s*[：:]?\s*true/i.test(rest),
      }));
      currentEntry = '';
    };

    for (const line of lines) {
      if (/^[^：:]{1,30}[：:]/.test(line) && !/^(持有者|范围|分镜范围|状态|状态变化|holder|storyboardRange|stateChanges)/i.test(line)) {
        flushEntry();
        currentEntry = line;
      } else if (currentEntry) {
        currentEntry += `，${line}`;
      }
    }
    flushEntry();
  }

  return props;
}

function extractOutfitTrackingFromText(
  rawText: string,
  storyboards: FallbackStoryboardBlock[],
): ScriptAnalysis['outfitTracking'] {
  const outfits: ScriptAnalysis['outfitTracking'] = [];
  CHARACTER_SECTION_PATTERN.lastIndex = 0;
  let match;
  while ((match = CHARACTER_SECTION_PATTERN.exec(rawText)) !== null) {
    const characterName = cleanInlineText(match[1]);
    const desc = cleanInlineText(match[2]);
    if (!shouldUseCharacterName(characterName) || !desc) continue;

    const storyboardNumbers = storyboards
      .filter((item) => item.rawBlock.includes(characterName))
      .map((item) => item.storyboard.number);

    outfits.push({
      characterName,
      outfitSeq: 1,
      outfitDesc: desc.slice(0, 120),
      storyboardRange: buildStoryboardRange(storyboardNumbers),
      needsNewImage: false,
    });
  }

  return outfits;
}

function inferCharacterAgeAppearance(description: string) {
  return description.match(/(少年感|少女感|青年感|中年感|老年感|二十出头|三十岁上下|四十岁上下)/)?.[1] || '';
}

function inferCharacterTemperament(description: string) {
  return description.match(/(清冷|凌厉|温软|温和|沉稳|锐利|克制|压迫感强|油滑|冷硬)/)?.[1] || '';
}

function extractCharacterProfilesFromText(rawText: string): ScriptAnalysis['characterProfiles'] {
  const profiles: CharacterProfile[] = [];
  CHARACTER_SECTION_PATTERN.lastIndex = 0;
  let match;
  while ((match = CHARACTER_SECTION_PATTERN.exec(rawText)) !== null) {
    const name = cleanInlineText(match[1]);
    const description = cleanInlineText(match[2]);
    if (!shouldUseCharacterName(name) || !description) continue;

    profiles.push(normalizeCharacterProfile({
      name,
      description,
      ageAppearance: inferCharacterAgeAppearance(description),
      temperament: inferCharacterTemperament(description),
      hairStyle: description.match(/(黑发低挽|黑发高束|短发利落后梳|灰白发髻)/)?.[1] || '',
      visualAnchor: buildVisualAnchor(description),
      step3Description: description,
      inferredFields: [],
    }, []));
  }
  return profiles;
}

function mergeCharacterProfiles(
  names: string[],
  profiles: CharacterProfile[],
  outfitTracking: ScriptAnalysis['outfitTracking'],
): CharacterProfile[] {
  const normalizedProfiles = new Map<string, CharacterProfile>();

  for (const profile of profiles) {
    const normalized = normalizeCharacterProfile(profile, outfitTracking);
    if (!normalized.name) continue;
    normalizedProfiles.set(normalized.name, normalized);
  }

  for (const name of names) {
    const normalizedName = cleanInlineText(name);
    if (!normalizedName || normalizedProfiles.has(normalizedName)) continue;
    normalizedProfiles.set(normalizedName, normalizeCharacterProfile({
      name: normalizedName,
      description: '',
    }, outfitTracking));
  }

  return Array.from(normalizedProfiles.values());
}

function fallbackExtract(rawText: string): Partial<ScriptAnalysis> {
  const result: Partial<ScriptAnalysis> = {
    projectName: extractProjectNameFromText(rawText),
    styleConfig: extractStyleConfigFromText(rawText),
    scenes: [],
    storyboards: [],
    allCharacterNames: [],
    characterProfiles: [],
    sceneRelations: '',
    outfitTracking: [],
    propTracking: [],
    propInheritance: '',
    summary: rawText.slice(0, 2000),
  };

  const characterNames = extractCharacterNames(rawText);
  result.allCharacterNames = characterNames;

  const storyboardBlocks = extractStoryboardBlocks(rawText, characterNames);
  result.storyboards = storyboardBlocks.map((item) => item.storyboard);

  const sceneMap = new Map<string, ScriptAnalysis['scenes'][number]>();
  for (const sceneText of collectSectionContents(SCENE_SECTION_PATTERN, rawText)) {
    const parsedScene = parseSceneBlock(sceneText, characterNames);
    if (parsedScene && !sceneMap.has(parsedScene.name)) {
      sceneMap.set(parsedScene.name, parsedScene);
    }
  }

  if ((result.storyboards ?? []).length > 0 && sceneMap.size === 1) {
    const onlySceneName = Array.from(sceneMap.keys())[0];
    result.storyboards = (result.storyboards ?? []).map((storyboard) => ({
      ...storyboard,
      scene: storyboard.scene || onlySceneName,
    }));
  }

  result.scenes = Array.from(sceneMap.values());
  result.outfitTracking = extractOutfitTrackingFromText(rawText, storyboardBlocks);
  result.characterProfiles = mergeCharacterProfiles(
    characterNames,
    extractCharacterProfilesFromText(rawText),
    result.outfitTracking,
  );
  result.propTracking = extractPropTrackingFromText(rawText, storyboardBlocks);

  return result;
}

export type AnalysisParseSource = 'strict-json' | 'repaired-json' | 'fallback-text';

export interface ParsedAnalysisResponse {
  analysis: ScriptAnalysis;
  source: AnalysisParseSource;
  warnings: string[];
}

export function parseAnalysisResponseDetailed(response: string): ParsedAnalysisResponse {
  let jsonStr = extractFromCodeBlock(response);
  if (!jsonStr) jsonStr = extractAsRawJson(response);
  if (!jsonStr) jsonStr = findJsonInText(response);

  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      logParsedData(parsed, 'strict-json');
      return {
        analysis: normalizeAnalysis(parsed),
        source: 'strict-json',
        warnings: [],
      };
    } catch {
      // continue
    }

    const fixedJson = tryFixJsonIssues(jsonStr);
    if (fixedJson !== jsonStr) {
      try {
        const parsed = JSON.parse(fixedJson);
        logParsedData(parsed, 'repaired-json');
        return {
          analysis: normalizeAnalysis(parsed),
          source: 'repaired-json',
          warnings: ['AI 返回的 JSON 经过自动修复后才解析成功，建议你在 Step2 再确认一次关键字段。'],
        };
      } catch {
        // continue
      }
    }
  }

  return {
    analysis: normalizeAnalysis(fallbackExtract(response)),
    source: 'fallback-text',
    warnings: ['AI 返回的不是可直接解析的合法 JSON，当前结果来自文本兜底提取。为避免把猜出来的结构带入下一步，已停留在 Step1，请优先重新分析。'],
  };
}

export function parseAnalysisResponse(response: string): ScriptAnalysis {
  return parseAnalysisResponseDetailed(response).analysis;
}

function remapStoryboardNumbersIfNeeded(storyboards: ScriptAnalysis['storyboards']): ScriptAnalysis['storyboards'] {
  const seen = new Set<number>();
  const needsRemap = storyboards.some((storyboard) => {
    const invalid = !Number.isInteger(storyboard.number) || storyboard.number <= 0 || seen.has(storyboard.number);
    seen.add(storyboard.number);
    return invalid;
  });

  if (!needsRemap) return storyboards;

  return storyboards.map((storyboard, index) => ({
    ...storyboard,
    number: index + 1,
  }));
}

function normalizeAnalysis(raw: unknown): ScriptAnalysis {
  if (typeof raw !== 'object' || raw === null) {
    return getDefaultAnalysis();
  }

  const obj = raw as Record<string, unknown>;
  const normalizedStoryboards: ScriptAnalysis['storyboards'] = Array.isArray(obj.storyboards)
    ? obj.storyboards.map((storyboard) => {
      const item = storyboard as Record<string, unknown>;
      return {
        number: typeof item.number === 'number' ? item.number : parseInt(String(item.number), 10) || 0,
        name: typeof item.name === 'string' ? item.name : '',
        duration: typeof item.duration === 'string' ? item.duration : '',
        shotSize: typeof item.shotSize === 'string' ? item.shotSize : '',
        scene: typeof item.scene === 'string' ? item.scene : undefined,
        characters: normalizeCharacterNameArray(item.characters),
      };
    })
    : [];

  const analysis: ScriptAnalysis = {
    projectName: typeof obj.projectName === 'string' ? obj.projectName : '未命名项目',
    styleConfig: typeof obj.styleConfig === 'string' ? obj.styleConfig : '',
    scenes: Array.isArray(obj.scenes)
      ? obj.scenes.map((scene) => normalizeSceneInfo(scene as Partial<ScriptAnalysis['scenes'][number]>))
      : [],
    storyboards: remapStoryboardNumbersIfNeeded(normalizedStoryboards),
    allCharacterNames: normalizeCharacterNameArray(obj.allCharacterNames),
    characterProfiles: [],
    sceneRelations: typeof obj.sceneRelations === 'string' ? obj.sceneRelations : '',
    outfitTracking: Array.isArray(obj.outfitTracking)
      ? obj.outfitTracking.map((outfit) => {
          const item = outfit as Record<string, unknown>;
          return {
            characterName: typeof item.characterName === 'string' ? item.characterName : '',
            outfitSeq: typeof item.outfitSeq === 'number' ? item.outfitSeq : 1,
            outfitDesc: typeof item.outfitDesc === 'string' ? item.outfitDesc : '',
            storyboardRange: typeof item.storyboardRange === 'string' ? item.storyboardRange : '',
            needsNewImage: !!item.needsNewImage,
          };
        }).filter((outfit) => shouldUseCharacterName(outfit.characterName))
      : [],
    propTracking: normalizeGeneratedPropTrackingDefaults(
      Array.isArray(obj.propTracking)
        ? obj.propTracking.map((prop) => normalizePropConsistency(prop as Partial<PropConsistency>))
        : [],
    ),
    propInheritance: typeof obj.propInheritance === 'string' ? obj.propInheritance : '',
    summary: typeof obj.summary === 'string' ? obj.summary : '',
  };

  analysis.characterProfiles = mergeCharacterProfiles(
    analysis.allCharacterNames,
    Array.isArray(obj.characterProfiles)
      ? obj.characterProfiles
        .filter((profile) => shouldUseCharacterName((profile as Partial<CharacterProfile>).name ?? ''))
        .map((profile) => normalizeCharacterProfile(profile as Partial<CharacterProfile>, analysis.outfitTracking))
      : [],
    analysis.outfitTracking,
  );

  if (analysis.storyboards.length > 0 && analysis.scenes.length === 1) {
    const onlySceneName = analysis.scenes[0].name;
    analysis.storyboards = analysis.storyboards.map((storyboard) => ({
      ...storyboard,
      scene: storyboard.scene || onlySceneName,
    }));
  }

  analysis.scenes = analysis.scenes.map((scene) => normalizeSceneInfo(scene));
  const referencedSceneNames = new Set(
    analysis.storyboards
      .map((storyboard) => getSceneMatchKey(storyboard.scene))
      .filter(Boolean),
  );
  if (referencedSceneNames.size > 0) {
    analysis.scenes = analysis.scenes.filter((scene) => referencedSceneNames.has(getSceneMatchKey(scene.name)));
  }
  analysis.propTracking = normalizeGeneratedPropTrackingDefaults(
    analysis.propTracking.map((prop) => normalizePropConsistency(prop)),
  );

  return analysis;
}

function getDefaultAnalysis(): ScriptAnalysis {
  return {
    projectName: '未命名项目',
    styleConfig: '',
    scenes: [],
    storyboards: [],
    allCharacterNames: [],
    characterProfiles: [],
    sceneRelations: '',
    outfitTracking: [],
    propTracking: [],
    propInheritance: '',
    summary: '',
  };
}

function logParsedData(data: unknown, source: AnalysisParseSource) {
  if (!import.meta.env.DEV) return;
  const value = data as Record<string, unknown>;
  console.log('[步骤1-解析结果]', {
    source,
    projectName: value.projectName,
    scenes: Array.isArray(value.scenes) ? value.scenes.length : 0,
    storyboards: Array.isArray(value.storyboards) ? value.storyboards.length : 0,
    characters: Array.isArray(value.allCharacterNames) ? value.allCharacterNames.length : 0,
  });
}

export function isAnalysisSparse(analysis: ScriptAnalysis): boolean {
  return getAnalysisSparseReason(analysis) !== null;
}

function hasText(value: string | undefined): boolean {
  return !!value?.trim();
}

export function getAnalysisSparseReason(analysis: ScriptAnalysis): string | null {
  if (analysis.storyboards.length === 0) {
    return '未能提取到任何分镜，请检查剧本格式或重新分析。';
  }

  const incompleteStoryboards = analysis.storyboards.filter(
    (storyboard) => !hasText(storyboard.name) || !hasText(storyboard.duration),
  );
  if (incompleteStoryboards.length > 0) {
    return incompleteStoryboards.length === analysis.storyboards.length
      ? '提取出的分镜缺少名称或时长，结果暂时不能进入下一步。'
      : `有 ${incompleteStoryboards.length} 个分镜缺少名称或时长，请重新分析。`;
  }

  const hasCharacters = analysis.allCharacterNames.some((name) => hasText(name))
    || analysis.storyboards.some((storyboard) => storyboard.characters.some((name) => hasText(name)));
  if (!hasCharacters) {
    return '未能提取到角色信息，请检查剧本内容后重新分析。';
  }

  return null;
}
