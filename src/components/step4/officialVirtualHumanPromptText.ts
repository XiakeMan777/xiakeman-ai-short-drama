const TIME_SEGMENT_LINE_PATTERN = /^\d+(?:\.\d+)?\s*[-~–—]\s*\d+(?:\.\d+)?\s*(?:秒|s|S)?\s*｜/m;

function normalizeColorLightingSegment(segment: string, forcePrefix = false) {
  const text = segment.trim();
  if (/^调色光影[：:]/.test(text)) return text;
  if (/^调色[与和+＋]?光影[：:]/.test(text)) {
    return text.replace(/^调色[与和+＋]?光影[：:]\s*/, '调色光影：');
  }
  if (/^调色由/.test(text)) return text.replace(/^调色由/, '调色光影：由');
  if (/^调色[：:]/.test(text)) return text.replace(/^调色[：:]\s*/, '调色光影：');
  if (/^调色/.test(text) && !/^调色.{0,12}光影/.test(text)) {
    return `调色光影：${text.replace(/^调色\s*/, '').trim()}`;
  }
  if (forcePrefix) {
    return `调色光影：${text}`;
  }
  return text;
}

export function normalizeVideoPromptText(rawText: string) {
  const trimmed = rawText.trim();
  if (!trimmed) return '';

  const withoutOuterSeparators = trimmed
    .replace(/^(?:\*{3}\s*)+/, '')
    .replace(/(?:\s*\*{3})+$/, '')
    .trim();

  const segments = withoutOuterSeparators
    .split(/\*{3}/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const lastNoSubtitleIndex = [...segments]
    .reverse()
    .findIndex((segment) => /禁止显示字幕|不显示字幕/.test(segment));
  const noSubtitleIndex = lastNoSubtitleIndex >= 0
    ? segments.length - 1 - lastNoSubtitleIndex
    : segments.length;
  let colorLightingIndex = -1;
  for (let index = noSubtitleIndex - 1; index >= 0; index -= 1) {
    if (!TIME_SEGMENT_LINE_PATTERN.test(segments[index])) {
      colorLightingIndex = index;
      break;
    }
  }

  return segments
    .map((segment, index) => normalizeColorLightingSegment(segment, index === colorLightingIndex && index >= 4))
    .filter(Boolean)
    .join('\n***\n');
}

export const normalizeOfficialVirtualHumanPromptText = normalizeVideoPromptText;
