import type { StoryboardPrompt, TimeSegment } from '@/types';

const TIME_RANGE_PATTERN = String.raw`\d+(?:\.\d+)?\s*[-~–—]\s*\d+(?:\.\d+)?\s*(?:秒|s|S)?`;
const TIME_SEGMENT_LINE_PATTERN = new RegExp(`^(${TIME_RANGE_PATTERN})\\s*[｜|]\\s*(.+?)\\s*[｜|]\\s*(.+?)(?:\\s*[｜|]\\s*(.+))?$`);

function parseTimeSegmentLine(line: string): TimeSegment | null {
  const match = line.trim().match(TIME_SEGMENT_LINE_PATTERN);
  if (!match) return null;
  return {
    timeRange: match[1].trim(),
    cameraShot: match[2].trim(),
    actionDesc: match[3].trim(),
    soundEffect: match[4]?.trim() ?? '',
  };
}

function parseTimeSegmentsFromSection(section: string): TimeSegment[] {
  return section
    .split('\n')
    .map((line) => parseTimeSegmentLine(line))
    .filter((segment): segment is TimeSegment => !!segment);
}

function sectionHasTimeSegment(section: string): boolean {
  return parseTimeSegmentsFromSection(section).length > 0;
}

function findLastIndex<T>(items: T[], predicate: (item: T, index: number) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index], index)) return index;
  }
  return -1;
}

/** 从 rawText 中解析 *** 分隔的结构化段落，填充 StoryboardPrompt 子字段 */
export function parsePromptFromRawText(
  rawText: string,
): Omit<StoryboardPrompt, 'rawText' | 'timeSegments'> & { timeSegments: TimeSegment[] } {
  const segments = rawText.split('***').map((s) => s.trim()).filter(Boolean);
  const header = segments[0] ?? '';
  const scene = segments[1] ?? '';
  const characters = segments[2] ?? '';
  const cameraOverview = segments[3] ?? '';
  const bodySegments = segments.slice(4);
  const noSubtitleIndex = findLastIndex(bodySegments, (section) => /禁止显示字幕|不显示字幕/.test(section));
  const bodyWithoutNoSubtitle = noSubtitleIndex >= 0
    ? bodySegments.slice(0, noSubtitleIndex)
    : bodySegments;
  const noSubtitle = noSubtitleIndex >= 0 ? bodySegments[noSubtitleIndex] : '';

  const colorLightingIndex = findLastIndex(
    bodyWithoutNoSubtitle,
    (section) => !sectionHasTimeSegment(section),
  );
  const colorLighting = colorLightingIndex >= 0 ? bodyWithoutNoSubtitle[colorLightingIndex] : '';

  const timeSegments = bodyWithoutNoSubtitle.flatMap((section, index) =>
    index === colorLightingIndex ? [] : parseTimeSegmentsFromSection(section),
  );

  return { header, scene, characters, cameraOverview, timeSegments, colorLighting, noSubtitle };
}

/** 从生成的提示词中提取落幅画面信息（视觉+叙事+情绪复合状态，用于下一分镜衔接） */
export function extractLastFrameInfo(promptText: string, correctedScript?: string): string {
  const parsedPrompt = parsePromptFromRawText(promptText);
  const segments = promptText.split('***').map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return '';

  const lastTimeSegment = parsedPrompt.timeSegments[parsedPrompt.timeSegments.length - 1];
  const visualInfo = lastTimeSegment
    ? [lastTimeSegment.cameraShot, lastTimeSegment.actionDesc, lastTimeSegment.soundEffect]
        .filter(Boolean)
        .join('｜')
        .slice(0, 300)
    : (segments[segments.length - 2] || segments[segments.length - 1] || '').slice(0, 200);

  const parts: string[] = [];
  if (visualInfo) {
    parts.push(`【落幅画面】${visualInfo}`);
  }
  if (parsedPrompt.characters) {
    const charBrief = parsedPrompt.characters.slice(0, 200);
    parts.push(`【人物状态】${charBrief}`);
  }
  if (parsedPrompt.scene) {
    const sceneBrief = parsedPrompt.scene.slice(0, 150);
    parts.push(`【场景状态】${sceneBrief}`);
  }
  if (correctedScript) {
    const scriptBrief = correctedScript.slice(0, 300);
    parts.push(`【本镜剧情摘要】${scriptBrief}`);
  }

  return parts.join('\n');
}
