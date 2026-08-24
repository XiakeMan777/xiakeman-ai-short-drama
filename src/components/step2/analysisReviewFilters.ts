export type ReviewFilter = 'all' | 'blocking' | 'optional' | 'inferred' | 'needsImage';

export const REVIEW_FILTER_OPTIONS: Array<{
  value: ReviewFilter;
  label: string;
  description: string;
}> = [
  { value: 'all', label: '全部', description: '显示所有资产项' },
  { value: 'blocking', label: '必须补齐', description: '只看会阻塞进入 Step3 的项目' },
  { value: 'optional', label: '建议优化', description: '只看可提升出图稳定性的项目' },
  { value: 'inferred', label: 'AI 已补', description: '只看已由 AI 自动补过的字段' },
  { value: 'needsImage', label: '会生图', description: '只看后续会进入图片资产的项目' },
];

export function getReviewFilterLabel(value: ReviewFilter) {
  return REVIEW_FILTER_OPTIONS.find((option) => option.value === value)?.label ?? '全部';
}
