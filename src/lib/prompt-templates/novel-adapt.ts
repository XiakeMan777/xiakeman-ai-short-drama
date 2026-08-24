// ============================================================
// 网文小说改编提示词（壳文件）
// 完整提示词模板存储在 BFF 服务端，前端只发送原始数据
// ============================================================

/**
 * 构建网文改编请求的原始数据
 * BFF 服务端负责拼接完整的用户侧消息（含改编要求、流量公式等）
 */
export function buildNovelAdaptUserPrompt(
  novelText: string,
  storyboardDuration: number,
  episodeDuration: number,
): string {
  return JSON.stringify({
    novelText,
    storyboardDuration,
    episodeDuration,
  });
}

export function buildNovelAdaptRhythmRepairUserPrompt(params: {
  novelText: string;
  adaptedScript: string;
  qualityIssueSummary: string;
  storyboardDuration: number;
  episodeDuration: number;
}): string {
  return JSON.stringify(params);
}
