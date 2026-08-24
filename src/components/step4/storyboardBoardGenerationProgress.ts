import type { StoryboardBoardVariantState } from '@/types';

export type StoryboardBoardGenerationTone = 'normal' | 'slow' | 'very-slow' | 'stalled';

export interface StoryboardBoardGenerationProgressStep {
  label: string;
  state: 'done' | 'active' | 'pending';
}

export interface StoryboardBoardGenerationProgress {
  elapsedLabel: string;
  title: string;
  detail: string;
  tone: StoryboardBoardGenerationTone;
  steps: StoryboardBoardGenerationProgressStep[];
}

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
export const STORYBOARD_BOARD_SUSPECTED_STALL_MS = 12 * MINUTE_MS;

export function formatStoryboardBoardElapsed(ms: number): string {
  const safeMs = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safeMs / SECOND_MS);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}秒`;
  if (minutes < 60) return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}小时${remainingMinutes}分`;
}

export function buildStoryboardBoardGenerationProgress(
  boardState: StoryboardBoardVariantState | undefined,
  now = Date.now(),
  referenceCount = 0,
): StoryboardBoardGenerationProgress | null {
  const startedAt = boardState?.generationTiming?.imageStartedAt ?? boardState?.startedAt;
  if (boardState?.status !== 'generating' || !startedAt) return null;

  const elapsedMs = Math.max(0, now - startedAt);
  const elapsedLabel = formatStoryboardBoardElapsed(elapsedMs);
  const isShotSheet = boardState.layout === 'strip';
  const boardLabel = isShotSheet ? 'Shot Sheet' : '详细故事板';
  const referenceText = referenceCount > 0 ? `，本次带 ${referenceCount} 张参考图` : '';
  const retryCount = boardState.generationTiming?.retryCount ?? 0;
  const retryText = retryCount > 0 ? `，当前第 ${retryCount + 1} 次尝试` : '';

  let tone: StoryboardBoardGenerationTone = 'normal';
  let title = retryCount > 0 ? '图片自动重试中' : '图片任务已提交，正在等待模型接管';
  let detail = `${boardLabel}${referenceText}${retryText}，已进入图片接口等待阶段；这一步不会逐字回流，完成前通常只有等待状态。`;

  if (elapsedMs >= STORYBOARD_BOARD_SUSPECTED_STALL_MS) {
    tone = 'stalled';
    title = '图片生成等待过久，可能已经卡住';
    detail = `已等待 ${elapsedLabel}${retryText}。复杂 ${boardLabel}${referenceText} 正常可能需要 5-10 分钟；超过 20 分钟会自动进入下一次图片重试。`;
  } else if (elapsedMs >= 10 * MINUTE_MS) {
    tone = 'very-slow';
    title = '生成时间偏长，但仍在等待图片接口返回';
    detail = `已等待 ${elapsedLabel}${retryText}。只要没有出现红色失败提示，说明前端还没有判定连接断开；当前尝试最长会等到 20 分钟后进入自动重试。`;
  } else if (elapsedMs >= 5 * MINUTE_MS) {
    tone = 'slow';
    title = '仍在正常慢生成区间';
    detail = `已等待 ${elapsedLabel}${retryText}。复杂 ${boardLabel}${referenceText} 常见需要 5-10 分钟，尤其是多参考图和高分辨率任务。`;
  } else if (elapsedMs >= 30 * SECOND_MS) {
    title = '图片模型生成中';
    detail = `已等待 ${elapsedLabel}${retryText}。当前不是文本流式阶段，图片接口通常会在整张图完成后一次性返回。`;
  }

  const steps: StoryboardBoardGenerationProgressStep[] = [
    { label: '规划已完成', state: 'done' },
    { label: '图片请求已提交', state: 'done' },
    { label: elapsedMs >= 5 * MINUTE_MS ? '长图生成中' : '等待图片返回', state: 'active' },
    { label: '保存并刷新预览', state: 'pending' },
  ];

  return {
    elapsedLabel,
    title,
    detail,
    tone,
    steps,
  };
}
