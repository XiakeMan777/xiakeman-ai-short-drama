export type BackgroundJobType =
  | 'step0-series'
  | 'step1-analysis'
  | 'step2-analysis'
  | 'step3-assets'
  | 'step4-storyboards'
  | 'step5-videos'
  | 'step6-tts'
  | 'step6-bgm'
  | 'step6-render'
  | 'project-sync'
  | 'llm-completions'
  | 'image-generations';

export type BackgroundJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'paused';

export type BackgroundJobEventLevel =
  | 'debug'
  | 'info'
  | 'retry'
  | 'warning'
  | 'error'
  | 'success';

export interface BackgroundJob {
  id: string;
  userId: string;
  projectId: string;
  chapterId?: string;
  storyboardIndex?: number;
  parentJobId?: string;
  type: BackgroundJobType;
  status: BackgroundJobStatus;
  priority: number;
  attempt: number;
  maxAttempts: number;
  idempotencyKey?: string;
  input: Record<string, unknown>;
  progress: Record<string, unknown>;
  output: Record<string, unknown>;
  error?: Record<string, unknown>;
  media: Record<string, unknown>;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface BackgroundJobEvent {
  jobId: string;
  seq: number;
  level: BackgroundJobEventLevel;
  phase?: string;
  message: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface CreateBackgroundJobInput {
  id?: string;
  projectId: string;
  chapterId?: string;
  storyboardIndex?: number;
  parentJobId?: string;
  type: BackgroundJobType;
  status?: BackgroundJobStatus;
  priority?: number;
  maxAttempts?: number;
  idempotencyKey?: string;
  input?: Record<string, unknown>;
  progress?: Record<string, unknown>;
  media?: Record<string, unknown>;
}

export interface ListBackgroundJobsParams {
  projectId?: string;
  chapterId?: string;
  type?: BackgroundJobType;
  status?: BackgroundJobStatus;
  limit?: number;
}

export interface UpdateBackgroundJobInput {
  status?: BackgroundJobStatus;
  progress?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: Record<string, unknown>;
  media?: Record<string, unknown>;
  attempt?: number;
}

export interface AppendBackgroundJobEventInput {
  level?: BackgroundJobEventLevel;
  phase?: string;
  message: string;
  data?: Record<string, unknown>;
}

function buildQuery(params: Record<string, unknown>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === '') return;
    query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : '';
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload?.error || response.statusText || `HTTP ${response.status}`);
  }
  return payload as T;
}

export async function getBackgroundJobsHealth() {
  return requestJson<{
    ok: true;
    driver: string;
    postgresConfigured: boolean;
    supportedTypes: BackgroundJobType[];
    supportedStatuses: BackgroundJobStatus[];
  }>('/api/jobs/health');
}

export async function createBackgroundJob(input: CreateBackgroundJobInput) {
  return requestJson<{ job: BackgroundJob; reused: boolean }>('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listBackgroundJobs(params: ListBackgroundJobsParams = {}) {
  return requestJson<{ jobs: BackgroundJob[] }>(`/api/jobs${buildQuery({ ...params })}`);
}

export async function getBackgroundJob(jobId: string) {
  return requestJson<{ job: BackgroundJob }>(`/api/jobs/${encodeURIComponent(jobId)}`);
}

export async function updateBackgroundJob(jobId: string, input: UpdateBackgroundJobInput) {
  return requestJson<{ job: BackgroundJob }>(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function cancelBackgroundJob(jobId: string, reason?: string) {
  return requestJson<{ job: BackgroundJob }>(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function retryBackgroundJob(jobId: string, reason?: string) {
  return requestJson<{ job: BackgroundJob }>(`/api/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function listBackgroundJobEvents(jobId: string, limit = 100) {
  return requestJson<{ events: BackgroundJobEvent[] }>(
    `/api/jobs/${encodeURIComponent(jobId)}/events${buildQuery({ limit })}`,
  );
}

export async function appendBackgroundJobEvent(jobId: string, input: AppendBackgroundJobEventInput) {
  return requestJson<{ event: BackgroundJobEvent }>(`/api/jobs/${encodeURIComponent(jobId)}/events`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
