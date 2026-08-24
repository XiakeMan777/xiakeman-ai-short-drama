// ============================================================
// 不标准剧本格式适配提示词（壳文件）
// 完整提示词模板存储在 BFF 服务端，前端只发送原始数据
// ============================================================

export function buildScriptFormatAdaptUserPrompt(
  scriptText: string,
  episodeDuration: number,
): string {
  return JSON.stringify({
    scriptText,
    episodeDuration,
  });
}
