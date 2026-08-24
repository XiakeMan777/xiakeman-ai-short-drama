import { getVolcApiBase } from '@/lib/volcengineApiClient';
import type { VideoApiConfig } from '@/types';

export interface VolcHistoryTask {
  id: string;
  model: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'expired' | 'canceled';
  created_at: string | number;
  updated_at: string | number;
  video_url?: string;
  status_msg?: string;
  usage?: {
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface VolcHistoryListResponse {
  tasks: VolcHistoryTask[];
  total: number;
  page: number;
  page_size: number;
}

function normalizeTimestamp(value: unknown): string | number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return value;
  return '';
}

function normalizeHistoryTask(task: Record<string, unknown>): VolcHistoryTask | null {
  const id = typeof task.id === 'string' ? task.id : '';
  const status = typeof task.status === 'string' ? task.status : '';
  if (!id || !status) return null;

  const content = typeof task.content === 'object' && task.content !== null
    ? task.content as Record<string, unknown>
    : null;

  return {
    id,
    model: typeof task.model === 'string'
      ? task.model
      : (typeof task.model_name === 'string' ? task.model_name : ''),
    status: status as VolcHistoryTask['status'],
    created_at: normalizeTimestamp(task.created_at),
    updated_at: normalizeTimestamp(task.updated_at),
    video_url: typeof task.video_url === 'string'
      ? task.video_url
      : (typeof content?.video_url === 'string' ? content.video_url : undefined),
    status_msg: typeof task.status_msg === 'string'
      ? task.status_msg
      : (typeof task.error_message === 'string'
        ? task.error_message
        : (typeof task.message === 'string' ? task.message : undefined)),
    usage: typeof task.usage === 'object' && task.usage !== null
      ? task.usage as VolcHistoryTask['usage']
      : undefined,
  };
}

function normalizeHistoryListPayload(
  data: Record<string, unknown>,
  fallbackPage: number,
  fallbackPageSize: number,
): VolcHistoryListResponse {
  const dataContainer = typeof data.data === 'object' && data.data !== null
    ? data.data as Record<string, unknown>
    : null;

  const rawItems = Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.tasks)
      ? data.tasks
      : Array.isArray(dataContainer?.items)
        ? dataContainer.items
        : Array.isArray(dataContainer?.tasks)
          ? dataContainer.tasks
          : [];

  const tasks = rawItems
    .map((item) => (typeof item === 'object' && item !== null ? normalizeHistoryTask(item as Record<string, unknown>) : null))
    .filter((item): item is VolcHistoryTask => !!item);

  const total = typeof data.total === 'number'
    ? data.total
    : (typeof dataContainer?.total === 'number'
      ? dataContainer.total
      : tasks.length);

  const page = typeof data.page === 'number'
    ? data.page
    : (typeof dataContainer?.page === 'number' ? dataContainer.page : fallbackPage);

  const pageSize = typeof data.page_size === 'number'
    ? data.page_size
    : (typeof dataContainer?.page_size === 'number' ? dataContainer.page_size : fallbackPageSize);

  return {
    tasks,
    total,
    page,
    page_size: pageSize,
  };
}

export async function volcListHistoryTasks(
  config: VideoApiConfig,
  options?: {
    page?: number;
    page_size?: number;
    status?: string;
    model?: string;
  },
): Promise<VolcHistoryListResponse> {
  const baseUrl = getVolcApiBase(config);
  const { page = 1, page_size = 20, status, model } = options || {};

  const params = new URLSearchParams({
    page: String(page),
    page_size: String(page_size),
  });

  if (status) params.append('filter.status', status);
  if (model) params.append('filter.model', model);

  const resp = await fetch(`${baseUrl}/contents/generations/tasks?${params.toString()}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.volcApiKey}`,
    },
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`查询历史任务失败 (${resp.status}): ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  return normalizeHistoryListPayload(data as Record<string, unknown>, page, page_size);
}

export async function volcDeleteTask(
  config: VideoApiConfig,
  taskId: string,
): Promise<{ success: boolean; message: string }> {
  const baseUrl = getVolcApiBase(config);

  try {
    const resp = await fetch(`${baseUrl}/contents/generations/tasks/${taskId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.volcApiKey}`,
      },
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { success: false, message: `删除失败 (${resp.status}): ${errText.slice(0, 200)}` };
    }

    return { success: true, message: '任务已删除' };
  } catch (error) {
    return { success: false, message: `删除出错: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export { normalizeHistoryListPayload };
