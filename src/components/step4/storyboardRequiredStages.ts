import type { Choreography } from '@/types';

export class StoryboardStageTimeoutError extends Error {
  readonly stageLabel: string;

  constructor(stageLabel: string, timeoutMs: number) {
    super(`${stageLabel} timeout after ${Math.round(timeoutMs / 1000)}s，已停止当前分镜生成；不会跳过该阶段。请重试当前分镜。`);
    this.name = 'StoryboardStageTimeoutError';
    this.stageLabel = stageLabel;
  }
}

export class StoryboardRequiredStageError extends Error {
  readonly stageLabel: string;

  constructor(stageLabel: string, detail?: string) {
    super(`${stageLabel}失败，已停止当前分镜生成；不会跳过该阶段。${detail ? `原因：${detail}` : '请重试当前分镜。'}`);
    this.name = 'StoryboardRequiredStageError';
    this.stageLabel = stageLabel;
  }
}

export function throwRequiredStageError(stageLabel: string, detail?: string): never {
  throw new StoryboardRequiredStageError(stageLabel, detail);
}

export function throwRequiredStageCause(stageLabel: string, error: unknown): never {
  if (error instanceof StoryboardRequiredStageError || error instanceof StoryboardStageTimeoutError) {
    throw error;
  }
  const message = error instanceof Error ? error.message : String(error);
  throwRequiredStageError(stageLabel, message);
}

export function requireStageText(text: string, stageLabel: string): string {
  if (!text.trim()) {
    throwRequiredStageError(stageLabel, 'LLM 返回空内容。');
  }
  return text;
}

export function hasRecognizedChoreoCheckOutput(
  rawText: string,
  fixes: readonly unknown[],
  correctedChoreography: Choreography | null,
): boolean {
  return /检查通过|无需修正/.test(rawText)
    || fixes.length > 0
    || correctedChoreography !== null;
}
