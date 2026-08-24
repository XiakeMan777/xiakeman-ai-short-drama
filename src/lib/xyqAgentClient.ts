import type { VideoApiConfig } from '@/types';
import { normalizeWholeSecondVideoDuration } from '@/lib/storyboardDuration';

export const XYQ_AGENT_FIXED_MODEL = 'Seedance 2.0 Fast';
const XYQ_AGENT_API_BASE = '/api/xyq-agent';

export interface XyqAgentSubmitResult {
  taskId: string;
  threadId: string;
  runId: string;
  webThreadLink?: string;
}

export interface XyqAgentPollResult {
  status: 'running' | 'success' | 'failed' | 'cancelled';
  progress: number;
  videoUrl?: string;
  message?: string;
  rawState?: unknown;
}

function assertXyqAgentConfig(config: VideoApiConfig) {
  if (!config.xyqAgentAccessKey?.trim()) {
    throw new Error('请先在视频模型设置中填写小云雀 Agent Access Key。');
  }
}

async function parseJsonOrText(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text };
  }
}

async function throwIfNotOk(response: Response, fallback: string) {
  if (response.ok) return;
  const body = await parseJsonOrText(response);
  throw new Error(body?.error || body?.errmsg || body?.message || `${fallback} (${response.status})`);
}

function getRatioLabel(ratio: string) {
  if (ratio === '9:16') return '竖屏';
  if (ratio === '16:9') return '横屏';
  if (ratio === '1:1') return '方屏';
  return '画幅';
}

export function buildXyqAgentVideoMessage(prompt: string, config: VideoApiConfig) {
  const duration = normalizeWholeSecondVideoDuration(config.videoDuration, 5);
  const ratio = config.videoRatio || '9:16';
  const resolution = config.videoResolution === '4k' ? '1080p' : config.videoResolution || '720p';
  return [
    `生成一个 ${duration} 秒视频，${ratio} ${getRatioLabel(ratio)}，${resolution}，使用 ${XYQ_AGENT_FIXED_MODEL}，提示词如下：`,
    prompt.trim(),
  ].filter(Boolean).join('\n\n');
}

export function buildXyqAgentTaskId(threadId: string, runId: string) {
  return `xyqagent:${encodeURIComponent(threadId)}:${encodeURIComponent(runId)}`;
}

export function parseXyqAgentTaskId(taskId: string): { threadId: string; runId: string } {
  const parts = taskId.split(':');
  if (parts.length < 3 || parts[0] !== 'xyqagent') {
    throw new Error('小云雀 Agent 任务 ID 格式异常。');
  }
  return {
    threadId: decodeURIComponent(parts[1]),
    runId: decodeURIComponent(parts[2]),
  };
}

export async function uploadXyqAgentAsset(
  blob: Blob,
  config: VideoApiConfig,
  fileName: string,
  signal?: AbortSignal,
): Promise<string> {
  assertXyqAgentConfig(config);
  const form = new FormData();
  form.append('accessKey', config.xyqAgentAccessKey.trim());
  if (config.xyqAgentBaseUrl?.trim()) form.append('baseUrl', config.xyqAgentBaseUrl.trim());
  form.append('file', blob, fileName);

  const response = await fetch(`${XYQ_AGENT_API_BASE}/upload-file`, {
    method: 'POST',
    body: form,
    signal,
  });
  await throwIfNotOk(response, '小云雀 Agent 素材上传失败');
  const data = await response.json();
  if (!data.assetId) throw new Error('小云雀 Agent 素材上传未返回 asset_id。');
  return String(data.assetId);
}

export async function submitXyqAgentRun(
  config: VideoApiConfig,
  message: string,
  assetIds: string[],
  signal?: AbortSignal,
): Promise<XyqAgentSubmitResult> {
  assertXyqAgentConfig(config);
  const response = await fetch(`${XYQ_AGENT_API_BASE}/submit-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accessKey: config.xyqAgentAccessKey.trim(),
      baseUrl: config.xyqAgentBaseUrl?.trim(),
      message,
      assetIds,
    }),
    signal,
  });
  await throwIfNotOk(response, '小云雀 Agent 任务提交失败');
  const data = await response.json();
  if (!data.threadId || !data.runId) {
    throw new Error('小云雀 Agent 未返回 thread_id/run_id。');
  }
  return {
    taskId: buildXyqAgentTaskId(data.threadId, data.runId),
    threadId: data.threadId,
    runId: data.runId,
    webThreadLink: data.webThreadLink,
  };
}

export async function pollXyqAgentTask(
  taskId: string,
  config: VideoApiConfig,
  signal?: AbortSignal,
): Promise<XyqAgentPollResult> {
  assertXyqAgentConfig(config);
  const { threadId, runId } = parseXyqAgentTaskId(taskId);
  const response = await fetch(`${XYQ_AGENT_API_BASE}/get-thread`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accessKey: config.xyqAgentAccessKey.trim(),
      baseUrl: config.xyqAgentBaseUrl?.trim(),
      threadId,
      runId,
      afterSeq: 0,
    }),
    signal,
  });
  await throwIfNotOk(response, '小云雀 Agent 进度查询失败');
  return await response.json() as XyqAgentPollResult;
}
