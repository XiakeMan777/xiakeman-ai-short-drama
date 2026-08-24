import type { ScriptType } from '@/types';
import { detectScriptType } from './scriptTypeDetection';

export type Step1ImportKind =
  | 'single'
  | 'novel-chapters'
  | 'annotated-episodes'
  | 'annotated-storyboard-resets'
  | 'large-ambiguous';

export interface Step1ImportSegment {
  title: string;
  content: string;
  scriptType: ScriptType;
  charCount: number;
}

export interface Step1ImportPreview {
  kind: Step1ImportKind;
  confidence: 'high' | 'medium' | 'low';
  label: string;
  detail: string;
  shouldOfferImport: boolean;
  segments: Step1ImportSegment[];
}

interface MarkerMatch {
  index: number;
  title: string;
}

const MAX_TITLE_LENGTH = 36;
const LARGE_TEXT_CHAR_THRESHOLD = 20000;
const CHINESE_NUMBER = '0-9０-９零〇一二三四五六七八九十百千万两';

const NOVEL_CHAPTER_HEADING_RE = new RegExp(
  `^[ \\t]*(?:#{1,6}\\s*)?((?:第\\s*[${CHINESE_NUMBER}]{1,8}\\s*[章节回卷部][^\\n]{0,60})|(?:chapter\\s*\\d+[^\\n]{0,60}))\\s*$`,
  'gim',
);
const EPISODE_HEADING_RE = new RegExp(
  `^[ \\t]*(?:#{1,6}\\s*)?((?:第\\s*[${CHINESE_NUMBER}]{1,8}\\s*集[^\\n]{0,60})|(?:ep(?:isode)?\\.?\\s*\\d+[^\\n]{0,60})|(?:e\\d{1,3}[^\\n]{0,60}))\\s*$`,
  'gim',
);
const STORYBOARD_ONE_RE = /^[ \t]*(?:#{1,6}\s*)?(?:分镜|镜头|shot|scene)\s*0*1(?:\D|$)[^\n]*/gim;
const STRUCTURED_LABEL_RE = /(?:^|\n)\s*(?:画面|对白|台词|动作|镜头|场景|旁白|音效|角色|道具)\s*[:：]/g;

function cleanText(input: string): string {
  return input.replace(/\r\n?/g, '\n').trim();
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function trimTitle(title: string, fallback: string): string {
  const cleaned = normalizeWhitespace(title.replace(/^#{1,6}\s*/, ''));
  if (!cleaned) return fallback;
  return cleaned.length > MAX_TITLE_LENGTH
    ? `${cleaned.slice(0, MAX_TITLE_LENGTH)}...`
    : cleaned;
}

function collectMarkers(text: string, pattern: RegExp): MarkerMatch[] {
  const markers: MarkerMatch[] = [];
  pattern.lastIndex = 0;
  let match = pattern.exec(text);

  while (match) {
    markers.push({
      index: match.index,
      title: match[1] ?? match[0],
    });
    match = pattern.exec(text);
  }

  return markers;
}

function splitByMarkers(
  text: string,
  markers: MarkerMatch[],
  options: {
    fallbackTitlePrefix: string;
    forcedScriptType?: ScriptType;
  },
): Step1ImportSegment[] {
  return markers
    .map((marker, index) => {
      const next = markers[index + 1];
      const content = text.slice(marker.index, next?.index ?? text.length).trim();
      const detection = detectScriptType(content);
      const scriptType = options.forcedScriptType ?? detection.scriptType;
      return {
        title: trimTitle(marker.title, `${options.fallbackTitlePrefix}${index + 1}`),
        content,
        scriptType,
        charCount: content.length,
      };
    })
    .filter((segment) => segment.content.length > 0);
}

function countMatches(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  return text.match(pattern)?.length ?? 0;
}

function buildSinglePreview(text: string): Step1ImportPreview {
  const isLarge = text.length >= LARGE_TEXT_CHAR_THRESHOLD;
  return {
    kind: isLarge ? 'large-ambiguous' : 'single',
    confidence: isLarge ? 'medium' : 'low',
    label: isLarge ? '检测到大段内容' : '单章节内容',
    detail: isLarge
      ? '内容较长，但没有识别到稳定的章节或集标题。为避免误切，暂不自动拆分。'
      : '未检测到需要批量建章的章节或集段结构。',
    shouldOfferImport: false,
    segments: [],
  };
}

export function buildStep1ImportPreview(input: string): Step1ImportPreview {
  const text = cleanText(input);
  if (!text) return buildSinglePreview('');

  const episodeMarkers = collectMarkers(text, EPISODE_HEADING_RE);
  if (episodeMarkers.length >= 2) {
    const segments = splitByMarkers(text, episodeMarkers, {
      fallbackTitlePrefix: '第',
    });
    return {
      kind: 'annotated-episodes',
      confidence: 'high',
      label: `检测到 ${segments.length} 集内容`,
      detail: '可先按集创建章节，再逐集分析；不会自动把全部章节丢进模型队列。',
      shouldOfferImport: segments.length >= 2,
      segments,
    };
  }

  const novelChapterMarkers = collectMarkers(text, NOVEL_CHAPTER_HEADING_RE);
  if (novelChapterMarkers.length >= 2) {
    const segments = splitByMarkers(text, novelChapterMarkers, {
      fallbackTitlePrefix: '第',
      forcedScriptType: 'novel',
    });
    return {
      kind: 'novel-chapters',
      confidence: novelChapterMarkers.length >= 3 ? 'high' : 'medium',
      label: `检测到 ${segments.length} 个小说章节`,
      detail: '可先把全本拆成章节保存，之后选择单章或多章排队改编。',
      shouldOfferImport: segments.length >= 2,
      segments,
    };
  }

  const storyboardOneMarkers = collectMarkers(text, STORYBOARD_ONE_RE);
  const structuredLabelCount = countMatches(text, STRUCTURED_LABEL_RE);
  if (storyboardOneMarkers.length >= 2 && structuredLabelCount >= 4) {
    const segments = splitByMarkers(text, storyboardOneMarkers, {
      fallbackTitlePrefix: '第',
      forcedScriptType: 'annotated',
    }).map((segment, index) => ({
      ...segment,
      title: `第${index + 1}集：标注剧本`,
    }));

    return {
      kind: 'annotated-storyboard-resets',
      confidence: 'medium',
      label: `检测到 ${segments.length} 段标注剧本`,
      detail: '检测到分镜01多次重启，可按多个章节保存；如它们本来属于同一集，也可以继续只分析当前文本。',
      shouldOfferImport: segments.length >= 2,
      segments,
    };
  }

  return buildSinglePreview(text);
}
