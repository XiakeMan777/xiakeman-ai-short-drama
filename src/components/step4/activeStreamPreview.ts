import { getStep4PhaseLabel } from './promptGeneratorUtils';
import { getStoryboardBoardVariant } from '@/lib/storyboardBoardState';
import type { StoryboardState } from '@/types';

const RAW_STREAM_PREVIEW_LIMIT = 1800;
const LLM_STREAM_IDLE_TIMEOUT_SECONDS = 300;

export interface ActiveStreamPreview {
  title: string;
  details: string[];
  rawPreview: string;
  structured: boolean;
  stageLabel?: string;
}

function unique(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

function collectMatches(text: string, pattern: RegExp, limit = 4) {
  const matches: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const value = match[1]?.trim();
    if (value) matches.push(value);
    if (matches.length >= limit) break;
  }
  return unique(matches);
}

function compactRawPreview(text: string) {
  const trimmed = text.trim();
  if (trimmed.length <= RAW_STREAM_PREVIEW_LIMIT) return trimmed;
  return `${trimmed.slice(0, RAW_STREAM_PREVIEW_LIMIT)}\n\n...已省略 ${trimmed.length - RAW_STREAM_PREVIEW_LIMIT} 字，模型仍在回流。`;
}

function normalizeStreamForSignals(text: string) {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function isStoryboardDirectorMode(storyboard?: StoryboardState) {
  return storyboard?.generatedStep4OutputMode === 'storyboard-director'
    || storyboard?.step4OutputMode === 'storyboard-director';
}

export function getActiveStreamStageLabel(
  phase: StoryboardState['status'] | null,
  storyboard?: StoryboardState,
  overrideLabel?: string | null,
): string {
  if (overrideLabel) return overrideLabel;
  if (phase !== 'generating') return getStep4PhaseLabel(phase);
  if (!storyboard || !isStoryboardDirectorMode(storyboard)) return getStep4PhaseLabel(phase);
  const boardVariant = getStoryboardBoardVariant(storyboard.storyboardBoard);

  if (storyboard.seedanceFinalVideoPromptStatus === 'generating') {
    return 'Seedance 最终提交词';
  }

  if (boardVariant?.planStatus === 'optimizing') {
    return '导演阐述 / 故事板规划';
  }

  if (boardVariant?.status === 'generating') {
    return '故事版图片生成';
  }

  return '故事版生成';
}

export function buildActiveStreamPreview(
  streamText: string,
  phase: StoryboardState['status'] | null,
  storyboard?: StoryboardState,
  stageLabelOverride?: string | null,
): ActiveStreamPreview {
  const stageLabel = getActiveStreamStageLabel(phase, storyboard, stageLabelOverride);
  const isStoryboardDirectorImageStage = stageLabel === '故事版图片生成' || stageLabel.includes('图片');
  const rawPreview = compactRawPreview(streamText || (
    isStoryboardDirectorImageStage
      ? '故事版图片生成请求已提交，正在等待图片模型返回完整结果。图片接口通常不会流式吐出中间图。'
      : `${stageLabel}已开始，正在等待模型返回第一段内容。`
  ));
  const normalized = normalizeStreamForSignals(streamText);
  const received = streamText.trim().length;

  if (!streamText.trim()) {
    if (isStoryboardDirectorImageStage) {
      return {
        title: '故事版图片生成正在等待完整结果',
        details: [
          `当前阶段：${stageLabel}`,
          '15格 Shot Sheet 不是文本流式输出，通常会在整张图完成后一次性返回。',
          '当前没有红色失败提示时，表示流程仍在等待图片接口；复杂图等待 5-10 分钟属于正常情况。',
        ],
        rawPreview,
        structured: false,
        stageLabel,
      };
    }

    return {
        title: `${stageLabel}正在等待回流`,
        details: [
          `当前阶段：${stageLabel}`,
          '请求已经发出，正在等待模型返回第一段内容。',
          `只要内容或思考活动持续流动，就不会触发 ${LLM_STREAM_IDLE_TIMEOUT_SECONDS} 秒空闲超时。`,
        ],
        rawPreview,
        structured: false,
        stageLabel,
    };
  }

  if (phase === 'choreographing') {
    const sceneType = normalized.match(/"sceneType"\s*:\s*"([^"]+)"/)?.[1];
    const characters = collectMatches(normalized, /"character"\s*:\s*"([^"]+)"/g, 5);
    const timeSegmentCount = (normalized.match(/"timeRange"\s*:/g) ?? []).length;
    const detailLines = [
      `已收到 ${received} 字动作编排数据；仅连续 ${LLM_STREAM_IDLE_TIMEOUT_SECONDS} 秒无内容或思考活动才会超时。`,
      sceneType ? `场景类型：${sceneType}` : '',
      characters.length > 0 ? `正在写入角色站位：${characters.join('、')}` : '',
      timeSegmentCount > 0 ? `已回流 ${timeSegmentCount} 个时间段动作。` : '',
    ].filter(Boolean);

    return {
      title: '动作编排正在生成结构化导演方案',
      details: detailLines.length > 1 ? detailLines : [
        detailLines[0],
        '当前阶段输出 JSON 属于中间结果，不需要手动复制；系统会继续完成校验和最终提示词转写。',
      ],
      rawPreview,
      structured: true,
      stageLabel,
    };
  }

  if (phase === 'choreo-checking') {
    const issueTypes = collectMatches(normalized, /"issueType"\s*:\s*"([^"]+)"/g, 5);
    const fixCount = (normalized.match(/"fixSuggestion"\s*:/g) ?? []).length;
    const passed = /检查通过|无需修正/.test(normalized);
    const detailLines = [
      `已收到 ${received} 字编排校验数据；仅连续 ${LLM_STREAM_IDLE_TIMEOUT_SECONDS} 秒无内容或思考活动才会超时。`,
      passed ? '模型判断当前编排无需修正。' : '',
      issueTypes.length > 0 ? `正在校验/修正：${issueTypes.join('、')}` : '',
      fixCount > 0 ? `已回流 ${fixCount} 条修正建议，系统会尝试吸收为可用编排。` : '',
    ].filter(Boolean);

    return {
      title: '编排校验正在检查站位、道具和台词一致性',
      details: detailLines.length > 1 ? detailLines : [
        detailLines[0],
        '当前阶段可能会返回较长 JSON；这是中间校验结果，完成后才会进入最终提示词生成。',
      ],
      rawPreview,
      structured: true,
      stageLabel,
    };
  }

  if (phase === 'generating') {
    const lines = streamText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return {
      title: `${stageLabel}正在回流`,
      details: [
        `当前阶段：${stageLabel}`,
        `已收到 ${received} 字生成内容。`,
        `空闲超时口径：连续 ${LLM_STREAM_IDLE_TIMEOUT_SECONDS} 秒无新内容或思考活动才会停止。`,
        lines[0] ? `开头：${lines[0].slice(0, 120)}` : '正在等待正文片段。',
      ],
      rawPreview,
      structured: false,
      stageLabel,
    };
  }

  return {
    title: `正在${stageLabel}`,
    details: [`已收到 ${received} 字回流内容。`],
    rawPreview,
    structured: false,
    stageLabel,
  };
}
