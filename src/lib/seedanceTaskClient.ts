import type { VideoApiConfig } from '@/types';
import {
  appendSeedanceCloudAuthQuery,
  buildSeedanceFetchInit,
  getSeedanceApiBase,
  getSeedanceCloudLicenseKey,
} from '@/lib/seedanceApi';

export interface SeedanceTaskRecord {
  task_id: string;
  status?: string;
  progress?: number;
  prompt?: string;
  duration?: number;
  ratio?: string;
  model?: string;
  video_url?: string;
  official_video_url?: string;
  stable_video_url?: string;
  local_video_url?: string;
  mp4_url?: string;
  video_path?: string;
  client_task_id?: string | null;
  ref_images_count?: number;
  ref_videos_count?: number;
  created_at?: string;
  completed_at?: string;
}

interface SeedanceTaskListResponse {
  status?: string;
  tasks?: SeedanceTaskRecord[];
}

const DEFAULT_TASK_LIST_LIMIT = 20;
const TASK_LIST_CACHE_TTL_MS = 20_000;

const taskListCache = new Map<string, {
  expiresAt: number;
  promise: Promise<SeedanceTaskRecord[]>;
}>();

export function buildSeedanceClientTaskId(chapterId: string, index: number) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `web-${chapterId}-${index + 1}-${Date.now()}-${suffix}`;
}

export function buildSeedanceVideoUrl(taskId: string, config?: VideoApiConfig) {
  const base = getSeedanceApiBase(config);
  return appendSeedanceCloudAuthQuery(`${base}/video/${taskId}`, config);
}

export function getSeedanceTaskVideoUrl(task: SeedanceTaskRecord, config?: VideoApiConfig) {
  const rawUrl = task.video_url?.trim()
    || task.official_video_url?.trim()
    || task.stable_video_url?.trim()
    || task.local_video_url?.trim()
    || task.mp4_url?.trim();
  if (!rawUrl) return task.task_id ? buildSeedanceVideoUrl(task.task_id, config) : '';
  const base = getSeedanceApiBase(config).replace(/\/+$/, '');
  if (base.startsWith('/') && rawUrl.startsWith('/api/')) {
    return appendSeedanceCloudAuthQuery(`${base}${rawUrl.slice('/api'.length)}`, config);
  }
  try {
    const resolved = new URL(rawUrl, base.startsWith('/') ? window.location.origin : base).toString();
    return appendSeedanceCloudAuthQuery(resolved, config);
  } catch {
    return appendSeedanceCloudAuthQuery(rawUrl, config);
  }
}

function buildTaskListCacheKey(base: string, limit: number, config?: VideoApiConfig) {
  return [
    base,
    limit,
    config?.backend ?? '',
    getSeedanceCloudLicenseKey(config) ?? '',
  ].join('|');
}

export async function listSeedanceTasks(limit = DEFAULT_TASK_LIST_LIMIT, config?: VideoApiConfig): Promise<SeedanceTaskRecord[]> {
  const base = getSeedanceApiBase(config);
  const requestedLimit = Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_TASK_LIST_LIMIT;
  const safeLimit = Math.max(1, Math.min(50, requestedLimit));
  const cacheKey = buildTaskListCacheKey(base, safeLimit, config);
  const cached = taskListCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.promise;
  const response = await fetch(`${base}/tasks?limit=${safeLimit}`, buildSeedanceFetchInit(config));
  if (!response.ok) {
    throw new Error(`小云雀任务列表读取失败 (${response.status})`);
  }
  const data = await response.json() as SeedanceTaskListResponse;
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  taskListCache.set(cacheKey, {
    expiresAt: now + TASK_LIST_CACHE_TTL_MS,
    promise: Promise.resolve(tasks),
  });
  return tasks;
}

export async function findSeedanceTaskByClientTaskId(
  clientTaskId: string,
  options: { timeoutMs?: number; intervalMs?: number; limit?: number; config?: VideoApiConfig } = {},
): Promise<SeedanceTaskRecord | null> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 3_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const tasks = await listSeedanceTasks(options.limit ?? 30, options.config);
    const matched = tasks.find((task) => task.client_task_id === clientTaskId);
    if (matched) return matched;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return null;
}
