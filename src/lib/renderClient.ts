import { loadBlob } from '@/lib/imageStore';
import { resolveVideoBlob } from '@/lib/videoFileUtils';
import {
  cancelBackgroundJob,
  getBackgroundJob,
  type BackgroundJob,
} from '@/lib/backgroundJobsClient';
import {
  createCloudProjectBlobDownloadUrl,
} from '@/lib/cloudProjectStore';
import type { Project, RenderJobState } from '@/types';
import type { RenderPackage } from '@/lib/postProduction';

const BACKGROUND_RENDER_PREFIX = 'background:';

export interface RenderHealth {
  ok: boolean;
  ffmpeg?: { ok: boolean; version?: string; error?: string };
  ffprobe?: { ok: boolean; version?: string; error?: string };
}

function normalizeRenderJob(value: unknown): RenderJobState {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    id: typeof data.id === 'string' ? data.id : undefined,
    status: ['idle', 'queued', 'running', 'done', 'failed', 'cancelled'].includes(String(data.status))
      ? data.status as RenderJobState['status']
      : 'failed',
    progress: typeof data.progress === 'number' ? data.progress : 0,
    message: typeof data.message === 'string' ? data.message : undefined,
    error: typeof data.error === 'string' ? data.error : undefined,
    downloadUrl: typeof data.downloadUrl === 'string' ? data.downloadUrl : undefined,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : undefined,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : undefined,
  };
}

async function toBlobWithType(blob: Blob, fallbackType: string): Promise<Blob> {
  if (blob.type) return blob;
  return new Blob([await blob.arrayBuffer()], { type: fallbackType });
}

export async function getRenderHealth(): Promise<RenderHealth> {
  const response = await fetch('/api/render/health');
  if (!response.ok) {
    return { ok: false };
  }
  return await response.json() as RenderHealth;
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isBackgroundRenderJobId(jobId?: string): boolean {
  return !!jobId?.startsWith(BACKGROUND_RENDER_PREFIX);
}

function stripBackgroundRenderJobId(jobId: string): string {
  return jobId.startsWith(BACKGROUND_RENDER_PREFIX)
    ? jobId.slice(BACKGROUND_RENDER_PREFIX.length)
    : jobId;
}

async function normalizeBackgroundRenderJob(job: BackgroundJob): Promise<RenderJobState> {
  const progress = getRecord(job.progress);
  const output = getRecord(job.output);
  const error = getRecord(job.error);
  const downloadBlobKey = getText(output.downloadBlobKey);
  let downloadUrl = getText(output.downloadUrl);

  if (job.status === 'succeeded' && downloadBlobKey && !downloadUrl) {
    try {
      downloadUrl = await createCloudProjectBlobDownloadUrl(job.projectId, downloadBlobKey);
    } catch {
      downloadUrl = '';
    }
  }

  const status: RenderJobState['status'] =
    job.status === 'succeeded'
      ? 'done'
      : job.status === 'failed'
        ? 'failed'
        : job.status === 'cancelled'
          ? 'cancelled'
          : job.status === 'queued' || job.status === 'paused'
            ? 'queued'
            : 'running';

  return {
    id: `${BACKGROUND_RENDER_PREFIX}${job.id}`,
    status,
    progress: status === 'done' ? 100 : Math.max(0, Math.min(100, getNumber(progress.percent, 0))),
    message: getText(progress.message) || getText(output.message) || undefined,
    error: getText(error.message) || getText(error.error) || undefined,
    downloadUrl: downloadUrl || undefined,
    createdAt: Date.parse(job.createdAt) || undefined,
    updatedAt: Date.parse(job.updatedAt) || undefined,
  };
}

async function createLegacyRenderJob(pkg: RenderPackage): Promise<RenderJobState> {
  const form = new FormData();
  form.append(
    'manifest',
    new Blob([JSON.stringify(pkg.manifest, null, 2)], { type: 'application/json' }),
    'manifest.json',
  );

  for (const asset of pkg.assets) {
    const blob = asset.type === 'video'
      ? await resolveVideoBlob(asset.sourceUrl, asset.blobKey)
      : asset.blobKey
        ? await loadBlob(asset.blobKey)
        : null;
    if (!blob) throw new Error(`素材读取失败：${asset.fileName}`);
    const fallbackType = asset.type === 'video'
      ? 'video/mp4'
      : asset.type === 'bgm'
        ? 'audio/mpeg'
        : 'audio/wav';
    form.append(`asset_${asset.id}`, await toBlobWithType(blob, fallbackType), asset.fileName);
  }

  const response = await fetch('/api/render/jobs', {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `渲染任务创建失败 (${response.status})`);
  }

  return normalizeRenderJob(await response.json());
}

export async function createRenderJob(
  pkg: RenderPackage,
  options: { project?: Project; chapterId?: string } = {},
): Promise<RenderJobState> {
  void options;
  return await createLegacyRenderJob(pkg);
}

export async function getRenderJob(jobId: string): Promise<RenderJobState> {
  if (isBackgroundRenderJobId(jobId)) {
    const { job } = await getBackgroundJob(stripBackgroundRenderJobId(jobId));
    return await normalizeBackgroundRenderJob(job);
  }

  const response = await fetch(`/api/render/jobs/${encodeURIComponent(jobId)}`);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `渲染任务状态读取失败 (${response.status})`);
  }
  return normalizeRenderJob(await response.json());
}

export async function cancelRenderJob(jobId: string): Promise<RenderJobState> {
  if (isBackgroundRenderJobId(jobId)) {
    const { job } = await cancelBackgroundJob(stripBackgroundRenderJobId(jobId), '用户取消成片渲染');
    return await normalizeBackgroundRenderJob(job);
  }

  const response = await fetch(`/api/render/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `取消渲染失败 (${response.status})`);
  }
  return normalizeRenderJob(await response.json());
}
