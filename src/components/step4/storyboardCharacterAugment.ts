import type { Asset, LogicFix, ScriptAnalysis, StoryboardInfo } from '@/types';
import { isGloballyInvalidVisualCharacterName } from '@/lib/characterAssetGuards';
import { sanitizeStoryboardCharacters, sanitizeStoryboardInfo } from '@/lib/storyboardCharacterSanitizer';

function uniqueCleanNames(names: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawName of names) {
    const name = (rawName ?? '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }

  return result;
}

function stripText(text: string): string {
  return text.replace(/\s+/g, '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isLikelyCharacterName(name: string): boolean {
  if (!name || name.length > 16) return false;
  if (/^\d+$/.test(name)) return false;
  if (isGloballyInvalidVisualCharacterName(name)) return false;
  if (/^(无|不涉及|旁白|对白|台词|内心OS|内心独白|系统播报|声音|音效|画外音|镜头|场景|道具|图片\d+|参考图片\d+)$/.test(name)) return false;
  if (/(秒|分镜|镜头|图片|参考|场景|道具|音效|特效|字幕|画幅|景别)/.test(name)) return false;
  return true;
}

function splitRoleList(fragment: string): string[] {
  return fragment
    .replace(/[“”"']/g, '')
    .split(/[、,，/／|｜\s]+/)
    .map((item) => item.trim().replace(/[。；;：:]+$/g, ''))
    .filter(isLikelyCharacterName);
}

function extractExplicitCharacterNames(text: string): string[] {
  const names: string[] = [];

  const roleListPatterns = [
    /出场角色[^：:\n]*[：:]\s*([^\n。；;]+)/g,
    /(?:纳入|包含|补齐|补充|加入)[^“”"\n]*[“"]([^”"]+)[”"]/g,
  ];

  for (const pattern of roleListPatterns) {
    for (const match of text.matchAll(pattern)) {
      names.push(...splitRoleList(match[1] ?? ''));
    }
  }

  const speechRolePattern = /(?:对白|台词|内心OS|内心独白)[（(]([^）)]+)[）)]/g;
  for (const match of text.matchAll(speechRolePattern)) {
    names.push(...splitRoleList(match[1] ?? ''));
  }

  return uniqueCleanNames(names);
}

function collectKnownCharacterNames(
  analysis: Pick<ScriptAnalysis, 'allCharacterNames' | 'characterProfiles'>,
  assetLibrary?: Asset[],
): string[] {
  const assetCharacterNames = (assetLibrary ?? [])
    .filter((asset) => asset.type === 'character')
    .map((asset) => asset.name);

  return uniqueCleanNames([
    ...(analysis.allCharacterNames ?? []),
    ...(analysis.characterProfiles ?? []).map((profile) => profile.name),
    ...assetCharacterNames,
  ]);
}

function collectLogicFixText(logicFixes: LogicFix[]): string {
  return logicFixes
    .map((fix) => [fix.originalIssue, fix.correction, fix.reason].filter(Boolean).join('\n'))
    .join('\n');
}

function splitDownstreamContextSections(text: string): { currentText: string; downstreamText: string } {
  const downstreamHeadingPattern =
    /(?:\n-{3,}\s*)?\n\s*#{1,4}\s*(?:\u4e0b\u4e00\u5206\u955c\u6458\u8981|\u4e0b\u4e00\u955c\u6458\u8981|\u4e0b\u4e00\u5206\u955c|\u4e0b\u4e00\u955c\u8fb9\u754c\u7ea6\u675f)[^\n]*[\s\S]*$/;
  const downstreamLabelPattern =
    /\n\s*(?:\u4e0b\u4e00\u5206\u955c\u6458\u8981|\u4e0b\u4e00\u955c\u6458\u8981|\u4e0b\u4e00\u955c\u8fb9\u754c\u7ea6\u675f)[\uff1a:][\s\S]*$/;
  const headingMatch = text.match(downstreamHeadingPattern);
  if (headingMatch?.[0]) {
    return {
      currentText: text.slice(0, headingMatch.index),
      downstreamText: headingMatch[0],
    };
  }
  const labelMatch = text.match(downstreamLabelPattern);
  if (labelMatch?.[0]) {
    return {
      currentText: text.slice(0, labelMatch.index),
      downstreamText: labelMatch[0],
    };
  }
  return { currentText: text, downstreamText: '' };
}

function isOnlyOffscreenMention(name: string, text: string): boolean {
  const normalizedName = stripText(name);
  if (!normalizedName) return false;
  const mentionSegments = text
    .split(/[\n\u3002\uff1b;.!?！？]/)
    .map((segment) => segment.trim())
    .filter((segment) => stripText(segment).includes(normalizedName));
  if (mentionSegments.length === 0) return false;

  const offscreenPattern =
    /(\u8d70\u540e|\u79bb\u5f00|\u5df2\u79bb\u5f00|\u753b\u5916|\u672a\u8fdb\u5165\u5f53\u524d\u6784\u56fe|\u4e0d\u518d\u5f62\u6210\u753b\u5185|\u521a\u8d70\u5f00|\u5df2\u8d70|\u9000\u51fa\u753b\u9762|\u4e0d\u518d\u5165\u753b|\u672c\u6bb5\u4e0d\u518d\u5f62\u6210|\u79bb\u573a|\u64a4\u51fa|\u64a4\u79bb|\u8d70\u51fa|\u5e26\u79bb\u753b\u9762|\u79bb\u573a\u5c3e\u5df4)/;
  const nameThenOffscreenPattern = new RegExp(`${escapeRegExp(name)}.{0,18}${offscreenPattern.source}`);
  return mentionSegments.every((segment) => nameThenOffscreenPattern.test(segment));
}

export function augmentStoryboardCharactersFromText(
  storyboard: StoryboardInfo,
  analysis: Pick<ScriptAnalysis, 'allCharacterNames' | 'characterProfiles'>,
  textParts: string[],
  assetLibrary?: Asset[],
  logicFixes: LogicFix[] = [],
): StoryboardInfo {
  const knownCharacterNames = collectKnownCharacterNames(analysis, assetLibrary);
  const sanitizeOptions = { allowedNames: knownCharacterNames, allowUnknownVisualNames: false };
  const sanitizedStoryboard = sanitizeStoryboardInfo(storyboard, sanitizeOptions);
  const splitTextParts = textParts.map(splitDownstreamContextSections);
  const logicFixText = collectLogicFixText(logicFixes);
  const currentTextParts = splitTextParts.map((part) => part.currentText);
  const downstreamText = splitTextParts.map((part) => part.downstreamText).filter(Boolean).join('\n');
  const combinedText = [
    logicFixText,
    ...currentTextParts,
  ].filter(Boolean).join('\n');
  if (!combinedText.trim()) return sanitizedStoryboard;

  const compactText = stripText(combinedText);
  const compactDownstreamText = stripText(downstreamText);
  const prunedStoryboardCharacters = sanitizedStoryboard.characters.filter((name) =>
    (!compactDownstreamText.includes(stripText(name)) || compactText.includes(stripText(name)))
    && !isOnlyOffscreenMention(name, combinedText),
  );
  const mentionedKnownCharacters = knownCharacterNames.filter((name) =>
    compactText.includes(stripText(name)) && !isOnlyOffscreenMention(name, combinedText),
  );
  const explicitCharacters = sanitizeStoryboardCharacters(extractExplicitCharacterNames(combinedText), sanitizeOptions);
  const characters = sanitizeStoryboardCharacters(uniqueCleanNames([
    ...prunedStoryboardCharacters,
    ...mentionedKnownCharacters,
    ...explicitCharacters,
  ]), sanitizeOptions);

  if (characters.length === sanitizedStoryboard.characters.length
    && characters.every((name, index) => name === sanitizedStoryboard.characters[index])) {
    return sanitizedStoryboard;
  }

  return {
    ...sanitizedStoryboard,
    characters,
  };
}
