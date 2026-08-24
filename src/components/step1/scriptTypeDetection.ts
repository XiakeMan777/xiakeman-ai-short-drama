import type { ScriptType } from '@/types';

export type ScriptTypeDetectionReason =
  | 'empty'
  | 'structured-markers'
  | 'single-storyboard-marker'
  | 'loose-script'
  | 'prose-novel'
  | 'ambiguous-prose';

export interface ScriptTypeDetection {
  scriptType: ScriptType;
  confidence: 'high' | 'medium' | 'low';
  reason: ScriptTypeDetectionReason;
  label: string;
  detail: string;
}

export type ScriptTypeClassifierFlow = 'novel-adapt' | 'script-format-adapt' | 'direct-analysis';

export interface ScriptTypeClassifierDecision {
  scriptType: ScriptType;
  classifierType: 'novel' | 'annotated' | 'loose-script';
  confidence: 'high' | 'medium' | 'low';
  recommendedFlow: ScriptTypeClassifierFlow;
  reason: string;
  source: 'llm' | 'local';
}

const STORYBOARD_HEADING_RE = /(?:^|\n)\s*(?:#{1,4}\s*)?(?:分镜|镜头|shot|scene)\s*[0-9０-９一二三四五六七八九十]+(?:\s*[-－—–]\s*[0-9０-９一二三四五六七八九十]+)*[^\n]*/gi;
const STORYBOARD_DURATION_RE = /(?:\d+\s*(?:秒|seconds?|secs?|s)\b|[0-9０-９]+\s*秒|\d{1,2}:\d{2}\s*[-－—–]\s*\d{1,2}:\d{2}|时长|总时长|duration)/i;
const STRUCTURED_LABEL_RE = /(?:^|\n)\s*(?:画面|对白|台词|动作|镜头|场景|旁白|音效|角色|道具)\s*[:：]/g;
const SPEAKER_DIALOGUE_RE = /(?:^|\n)\s*([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9０-９·•]{0,11})\s*[:：][^\n]{1,}/g;
const NON_SPEAKER_LABELS = new Set([
  '画面', '对白', '台词', '动作', '镜头', '场景', '旁白', '音效', '角色', '人物', '道具', '分镜',
  '时间', '地点', '内景', '外景', '日景', '夜景', '承接', '转场', '内心', '备注', '说明',
  '标题', '章节', '本章', '内容', '简介', '作者', '提示', '系统', 'os', 'int', 'ext',
]);
const SCENE_CUE_RE = /(?:^|\n)\s*(?:第\s*[0-9０-９一二三四五六七八九十百千万]+\s*[场幕](?=$|[\s:：\-－—–])|场景(?:\s*[0-9０-９一二三四五六七八九十百千万]+)?\s*[:：]|(?:内景|外景|日景|夜景|INT\.?|EXT\.?)(?=$|[\s:：.\-－—–]))/gi;
const SCRIPT_ACTION_CUE_RE = /(?:^|\n)\s*(?:动作|转场|旁白|音效|OS|内心)\s*[:：]/gi;
const INLINE_DIALOGUE_RE = /(?:^|\n)[^\n]{0,36}(?:[:：]|说|道|问|喊|叫|笑|冷笑|怒道|吼道|低声|质问|反问)[^\n]{0,24}[“"][^”"\n]{1,120}[”"]/g;
const PARENTHETICAL_ACTION_RE = /(?:^|\n)\s*[（(][^）)\n]{1,48}[）)]/g;
const SHORT_DRAMA_SIGNAL_RE = /(?:短剧|剧本|第\s*[0-9０-９一二三四五六七八九十百千万]+\s*[场幕]|场景|内景|外景|日景|夜景|镜头|画面|对白|台词|动作|旁白|转场|字幕|OS|INT\.?|EXT\.?)/gi;
const NOVEL_CHAPTER_SIGNAL_RE = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:第\s*[0-9０-９零〇一二三四五六七八九十百千万两]{1,8}\s*[章节回卷部]|chapter\s*\d+)/gi;
const PROSE_PUNCTUATION_RE = /[。！？…]/;
const PROSE_NARRATIVE_VERB_RE = /(?:被|忽然|突然|听见|看见|冲进|赶到|站在|回头|裂开|悬在|落下|写着|传来|困住|灼伤|盯着|翻开|说道|低声|冷笑)/g;

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function getLooseScriptEvidence(text: string) {
  const meaningfulLineCount = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .length;
  const speakerDialogueMatches = [...text.matchAll(SPEAKER_DIALOGUE_RE)]
    .filter((match) => !NON_SPEAKER_LABELS.has((match[1] ?? '').trim().toLowerCase()));
  const speakerNames = new Set(speakerDialogueMatches.map((match) => (match[1] ?? '').trim().toLowerCase()));
  const inlineDialogueCount = countMatches(text, INLINE_DIALOGUE_RE);
  const parentheticalActionCount = countMatches(text, PARENTHETICAL_ACTION_RE);
  const shortDramaSignalCount = countMatches(text, SHORT_DRAMA_SIGNAL_RE);
  const novelChapterSignalCount = countMatches(text, NOVEL_CHAPTER_SIGNAL_RE);

  return {
    meaningfulLineCount,
    speakerDialogueCount: speakerDialogueMatches.length,
    distinctSpeakerCount: speakerNames.size,
    dialogueLineRatio: meaningfulLineCount > 0 ? speakerDialogueMatches.length / meaningfulLineCount : 0,
    inlineDialogueCount,
    parentheticalActionCount,
    shortDramaSignalCount,
    novelChapterSignalCount,
  };
}

export function detectScriptType(input: string): ScriptTypeDetection {
  const text = input.trim();

  if (!text) {
    return {
      scriptType: 'annotated',
      confidence: 'low',
      reason: 'empty',
      label: '等待输入',
      detail: '粘贴小说或标注剧本后，系统会自动识别分析方式。',
    };
  }

  const storyboardHeadings = text.match(STORYBOARD_HEADING_RE) ?? [];
  const timedStoryboardHeadings = storyboardHeadings.filter((line) => STORYBOARD_DURATION_RE.test(line));
  const structuredLabelCount = countMatches(text, STRUCTURED_LABEL_RE);
  const sceneCueCount = countMatches(text, SCENE_CUE_RE);
  const actionCueCount = countMatches(text, SCRIPT_ACTION_CUE_RE);
  const {
    speakerDialogueCount,
    distinctSpeakerCount,
    dialogueLineRatio,
    inlineDialogueCount,
    parentheticalActionCount,
    shortDramaSignalCount,
    novelChapterSignalCount,
  } = getLooseScriptEvidence(text);

  if (timedStoryboardHeadings.length >= 1 && (storyboardHeadings.length >= 2 || structuredLabelCount >= 2)) {
    return {
      scriptType: 'annotated',
      confidence: 'high',
      reason: 'structured-markers',
      label: '识别为标注剧本',
      detail: '检测到分镜编号、单镜时长和画面/对白等结构字段，将直接进入 Step1 分析。',
    };
  }

  if (storyboardHeadings.length >= 1 && structuredLabelCount >= 2) {
    return {
      scriptType: 'annotated',
      confidence: 'medium',
      reason: 'single-storyboard-marker',
      label: '更像标注剧本',
      detail: '检测到分镜和结构字段，但分镜时长可能不完整；分析前会继续做格式校验。',
    };
  }

  if (
    (speakerDialogueCount >= 3 && distinctSpeakerCount >= 2 && dialogueLineRatio >= 0.28 && (sceneCueCount >= 1 || actionCueCount >= 1))
    || (sceneCueCount >= 2 && structuredLabelCount >= 2)
    || (speakerDialogueCount >= 2 && distinctSpeakerCount >= 2 && dialogueLineRatio >= 0.18 && shortDramaSignalCount >= 1)
    || (speakerDialogueCount >= 3 && distinctSpeakerCount >= 1 && (structuredLabelCount >= 1 || sceneCueCount >= 1 || actionCueCount >= 1))
    || (inlineDialogueCount >= 3 && shortDramaSignalCount >= 2)
    || (inlineDialogueCount >= 2 && parentheticalActionCount >= 2)
    || (shortDramaSignalCount >= 2 && (inlineDialogueCount >= 1 || parentheticalActionCount >= 1))
  ) {
    const strongLooseScriptEvidence = speakerDialogueCount >= 5
      || sceneCueCount >= 2
      || structuredLabelCount >= 3
      || shortDramaSignalCount >= 3
      || (inlineDialogueCount >= 3 && parentheticalActionCount >= 1);
    return {
      scriptType: 'annotated',
      confidence: strongLooseScriptEvidence ? 'high' : 'medium',
      reason: 'loose-script',
      label: '识别为待适配剧本',
      detail: '检测到人物对白或场次提示，但不是本站标注分镜格式；将先保留原对白整理成分镜，再进入 Step1 分析。',
    };
  }

  if (novelChapterSignalCount > 0 && shortDramaSignalCount < 2) {
    return {
      scriptType: 'novel',
      confidence: text.length >= 300 ? 'high' : 'medium',
      reason: 'prose-novel',
      label: '识别为网文小说',
      detail: '检测到小说章节标题，且缺少短剧脚本结构信号，将先改编为短剧分镜。',
    };
  }

  if (
    text.length >= 300
    && PROSE_PUNCTUATION_RE.test(text)
    && storyboardHeadings.length === 0
    && shortDramaSignalCount < 2
    && speakerDialogueCount < 3
  ) {
    return {
      scriptType: 'novel',
      confidence: 'high',
      reason: 'prose-novel',
      label: '识别为网文小说',
      detail: '检测到连续叙事文本，将先改编为短剧分镜，再进行结构化分析。',
    };
  }

  const proseNarrativeVerbCount = countMatches(text, PROSE_NARRATIVE_VERB_RE);
  if (
    text.length >= 180
    && PROSE_PUNCTUATION_RE.test(text)
    && storyboardHeadings.length === 0
    && sceneCueCount === 0
    && actionCueCount === 0
    && structuredLabelCount === 0
    && speakerDialogueCount < 2
    && shortDramaSignalCount < 2
    && proseNarrativeVerbCount >= 4
  ) {
    return {
      scriptType: 'novel',
      confidence: text.length >= 300 ? 'high' : 'medium',
      reason: 'prose-novel',
      label: '识别为网文小说',
      detail: '检测到连续叙事文本，且缺少剧本/分镜结构信号，将先改编为短剧分镜。',
    };
  }

  return {
    scriptType: text.length >= 300 && PROSE_PUNCTUATION_RE.test(text) ? 'novel' : 'annotated',
    confidence: text.length >= 80 && PROSE_PUNCTUATION_RE.test(text) ? 'medium' : 'low',
    reason: 'ambiguous-prose',
    label: text.length >= 300 && PROSE_PUNCTUATION_RE.test(text) ? '更像叙事文本' : '默认按剧本整理',
    detail: text.length >= 300 && PROSE_PUNCTUATION_RE.test(text)
      ? '未检测到稳定剧本结构，可能是小说或大段叙事文本；点击开始后会继续用 AI 复核。'
      : '未检测到稳定分镜结构；短文本优先按普通剧本整理，避免把剧本误当小说改编。',
  };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const candidates = [
    trimmed,
    trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim(),
    trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1),
  ].filter((item) => item.startsWith('{') && item.endsWith('}'));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function getLocalFlow(detection: ScriptTypeDetection): ScriptTypeClassifierFlow {
  if (detection.scriptType === 'novel') return 'novel-adapt';
  if (detection.reason === 'loose-script' || detection.reason === 'single-storyboard-marker') {
    return 'script-format-adapt';
  }
  return 'direct-analysis';
}

export function localDetectionToClassifierDecision(detection: ScriptTypeDetection): ScriptTypeClassifierDecision {
  const recommendedFlow = getLocalFlow(detection);
  return {
    scriptType: recommendedFlow === 'novel-adapt' ? 'novel' : 'annotated',
    classifierType: recommendedFlow === 'script-format-adapt'
      ? 'loose-script'
      : recommendedFlow === 'direct-analysis'
        ? 'annotated'
        : 'novel',
    confidence: detection.confidence,
    recommendedFlow,
    reason: detection.detail,
    source: 'local',
  };
}

export function parseScriptTypeClassifierDecision(
  responseText: string,
  fallback: ScriptTypeDetection,
): ScriptTypeClassifierDecision {
  const parsed = extractJsonObject(responseText);
  if (!parsed) return localDetectionToClassifierDecision(fallback);

  const rawType = typeof parsed.type === 'string' ? parsed.type.trim() : '';
  const classifierType: ScriptTypeClassifierDecision['classifierType'] =
    rawType === 'annotated' || rawType === 'loose-script' || rawType === 'novel'
      ? rawType
      : localDetectionToClassifierDecision(fallback).classifierType;

  const rawFlow = typeof parsed.recommendedFlow === 'string' ? parsed.recommendedFlow.trim() : '';
  const recommendedFlow: ScriptTypeClassifierFlow =
    rawFlow === 'direct-analysis' || rawFlow === 'script-format-adapt' || rawFlow === 'novel-adapt'
      ? rawFlow
      : classifierType === 'annotated'
        ? 'direct-analysis'
        : classifierType === 'loose-script'
          ? 'script-format-adapt'
          : 'novel-adapt';

  const rawConfidence = typeof parsed.confidence === 'string' ? parsed.confidence.trim() : '';
  const confidence: ScriptTypeClassifierDecision['confidence'] =
    rawConfidence === 'high' || rawConfidence === 'medium' || rawConfidence === 'low'
      ? rawConfidence
      : fallback.confidence;

  if (
    recommendedFlow === 'novel-adapt'
    && fallback.scriptType === 'annotated'
    && (fallback.reason === 'loose-script' || fallback.reason === 'structured-markers' || fallback.reason === 'single-storyboard-marker')
    && fallback.confidence !== 'low'
  ) {
    const localDecision = localDetectionToClassifierDecision(fallback);
    return {
      ...localDecision,
      confidence: fallback.confidence,
      reason: `本地检测到明确剧本结构证据，已保留剧本流程。${typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 60) : ''}`,
      source: 'llm',
    };
  }

  return {
    scriptType: recommendedFlow === 'novel-adapt' ? 'novel' : 'annotated',
    classifierType,
    confidence,
    recommendedFlow,
    reason: typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim().slice(0, 120)
      : fallback.detail,
    source: 'llm',
  };
}
