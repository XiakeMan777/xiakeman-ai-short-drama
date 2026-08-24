export const HM_STATUS_LABELS: Record<string, string> = {
  pending: '排队中',
  submitted: '已提交',
  generating: '生成中',
  post_processing: '后处理中',
  finalizing: '合成中',
  success: '已完成',
  failed: '已失败',
};

export const VOLC_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '已失败',
  canceled: '已取消',
  expired: '已过期',
};

export const ALIYUN_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '已失败',
  canceled: '已取消',
  expired: '已过期',
  unknown: '状态确认中',
};

export const SEEDANCE_STATUS_LABELS: Record<string, string> = {
  success: '已完成',
  failed: '已失败',
  running: '生成中',
  pending: '排队中',
};

export function smoothVolcProgress(pollCount: number): number {
  if (pollCount <= 0) return 5;
  return Math.min(95, Math.round(5 + 90 * (1 - Math.exp(-0.08 * pollCount))));
}
