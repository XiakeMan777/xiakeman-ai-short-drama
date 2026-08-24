export interface SeedanceFinalPromptGateInput {
  isDirectorMode: boolean;
  commonDisabledReason?: string | null;
  hasBoardPlan: boolean;
  hasFreshImage: boolean;
  hasUsableDirectorImage: boolean;
  isGenerating: boolean;
  hasLlmApiKey: boolean;
}

export function getSeedanceFinalPromptDisabledReason(input: SeedanceFinalPromptGateInput): string | null {
  if (!input.isDirectorMode) return '仅详细故事板模式可生成 Seedance 最终视频词';
  if (input.commonDisabledReason) return input.commonDisabledReason;
  if (!input.hasLlmApiKey) return '请先在设置中填写 LLM API Key，才能生成 Seedance 最终视频词';
  if (!input.hasBoardPlan) return '请先生成导演规划，再刷新 Seedance 最终视频词';
  if (!input.hasFreshImage && !input.hasUsableDirectorImage) return '请先生成当前详细故事板图，再刷新 Seedance 最终视频词';
  if (input.isGenerating) return 'Seedance 最终视频词正在生成中，请稍候';
  return null;
}
