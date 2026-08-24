import { formatElapsed } from './videoUtils';
import { isLikelyTextAuditFailure } from './videoPromptOptimization';

export type VideoGuidanceState = {
  status: 'idle' | 'submitting' | 'polling' | 'done' | 'failed';
  progress: number;
  progressIsEstimated: boolean;
  submittedAt: number | null;
  error: string | null;
  usingDesensitizedPrompt: boolean;
};

export function getSubmittingGuidance(state: VideoGuidanceState): string {
  if (state.status === 'submitting') {
    return state.usingDesensitizedPrompt
      ? '正在提交脱敏后的安全版本。它会尽量保留镜头调度和表演重点，同时避开容易触发审核的表达。'
      : '正在提交当前镜头。提交成功后会进入远端队列，页面会自动回收结果。';
  }

  if (state.status !== 'polling') return '';

  const elapsed = state.submittedAt ? formatElapsed(state.submittedAt) : '';
  const elapsedText = elapsed ? `已等待 ${elapsed}。` : '';
  if (state.progress <= 8 || state.progressIsEstimated) {
    return `${elapsedText}远端可能仍在排队，低进度停留几分钟是正常情况；保持页面打开即可，任务结果会自动同步。`;
  }
  if (state.progress < 80) {
    return `${elapsedText}视频正在生成中，进度会分段回流；如果长时间不动，可以稍后用“重新下载结果”检查远端是否已完成。`;
  }
  return `${elapsedText}视频接近完成，正在等待远端返回成片并保存到本地。`;
}

export function getFailureRecoveryGuidance(state: VideoGuidanceState): string {
  if (state.status !== 'failed') return '';
  if (isLikelyTextAuditFailure(state.error ?? undefined)) {
    return state.usingDesensitizedPrompt
      ? '这次已经使用脱敏版仍未通过。建议再生成一次脱敏提示词，或手动删掉可能像品牌、真人、暴力、医疗承诺的表达后重试。'
      : '这类失败通常是提示词触发审核。建议先生成脱敏提示词，再用脱敏版重新提交；系统会保留原始镜头意图。';
  }
  return '可以先查看错误详情。如果远端提示可重试，直接重新生成；如果像网络或下载问题，可先尝试重新下载结果。';
}
