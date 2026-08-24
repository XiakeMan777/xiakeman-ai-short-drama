const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const {
  createCloudBlobDownloadUrlsForUser,
  putCloudProjectBlobBufferForUser,
} = require('./cloud-store');
const {
  normalizeRenderManifest,
  renderJob,
} = require('./render-jobs');
const {
  getJob,
  updateJob,
} = require('./background-jobs');

const RENDER_ROOT = process.env.RENDER_WORK_DIR || path.join(os.tmpdir(), 'xiakeman-render-jobs');
const BACKEND_RENDER_PROGRESS_INTERVAL_MS = 1500;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeFileName(value, fallback = 'asset.bin') {
  const base = path.basename(String(value || fallback)).replace(/[^\w.\-()[\] ]+/g, '_');
  return base || fallback;
}

function sanitizeId(value) {
  return String(value || '').replace(/[^\w.-]+/g, '_').slice(0, 80);
}

function normalizeHttpUrl(value, label) {
  const text = getText(value);
  if (!text) return '';
  const parsed = new URL(text);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use http or https`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not include credentials`);
  }
  return parsed.toString();
}

async function fetchToFile(url, filePath) {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text.slice(0, 300) || `HTTP ${response.status}`);
  }
  if (!response.body) throw new Error('download response body is empty');
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(filePath));
}

async function buildSignedBlobUrlMap(userId, projectId, assets) {
  const blobKeys = [...new Set(
    assets
      .map((asset) => getText(asset.blobKey))
      .filter(Boolean),
  )];
  if (blobKeys.length === 0) return new Map();

  const payload = await createCloudBlobDownloadUrlsForUser(userId, projectId, blobKeys);
  return new Map(
    asArray(payload.blobs).map((item) => [
      getText(item.blobKey),
      getText(asObject(item.download).url),
    ]),
  );
}

async function prepareRenderAssets(job, manifest, submittedAssets) {
  const projectId = getText(job.projectId || job.input?.projectId);
  if (!projectId) throw new Error('step6-render job missing projectId');

  const inputDir = path.join(job.dir, 'input');
  await fsp.mkdir(inputDir, { recursive: true });

  const assetById = new Map(
    submittedAssets.map((asset) => [getText(asset.id), asset]),
  );
  const signedUrls = await buildSignedBlobUrlMap(job.userId, projectId, submittedAssets);
  const assetPaths = new Map();

  for (const manifestAsset of manifest.assets) {
    const asset = assetById.get(getText(manifestAsset.id));
    if (!asset) throw new Error(`render asset ${manifestAsset.id} is missing from backend job input`);

    const assetId = sanitizeId(manifestAsset.id);
    const destination = path.join(inputDir, `${assetId}-${sanitizeFileName(manifestAsset.fileName)}`);
    const blobKey = getText(asset.blobKey);
    const signedUrl = blobKey ? signedUrls.get(blobKey) : '';
    const sourceUrl = signedUrl || normalizeHttpUrl(asset.sourceUrl, `render asset ${manifestAsset.id} sourceUrl`);
    if (!sourceUrl) throw new Error(`render asset ${manifestAsset.id} has no cloud blob or source URL`);

    await fetchToFile(sourceUrl, destination);
    assetPaths.set(manifestAsset.id, destination);
  }

  return assetPaths;
}

async function runStep6RenderJob(backgroundJob, context = {}) {
  const input = asObject(backgroundJob.input);
  const manifest = normalizeRenderManifest(input.manifest);
  const submittedAssets = asArray(input.assets).map(asObject);
  const outputBlobKey = getText(input.outputBlobKey) || `render-${backgroundJob.id || randomUUID()}.zip`;
  const jobDir = path.join(RENDER_ROOT, backgroundJob.id || randomUUID());
  const localJob = {
    id: backgroundJob.id,
    dir: jobDir,
    status: 'running',
    progress: 0,
    message: 'Preparing render',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await fsp.mkdir(jobDir, { recursive: true });
  await fsp.writeFile(path.join(jobDir, 'submitted-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  let progressTimer;
  const pushProgress = async () => {
    const latest = await getJob(backgroundJob.userId, backgroundJob.id).catch(() => null);
    if (latest?.status === 'cancelled') {
      localJob.status = 'cancelled';
      if (localJob.process) {
        try { localJob.process.kill('SIGTERM'); } catch {}
      }
      return;
    }

    const progress = {
      percent: Math.max(0, Math.min(100, Math.round(localJob.progress || 0))),
      message: localJob.message || 'Rendering',
      renderStatus: localJob.status,
      updatedAt: new Date().toISOString(),
    };
    await updateJob(backgroundJob.userId, backgroundJob.id, {
      status: 'running',
      progress,
      media: {
        ...(backgroundJob.media || {}),
        outputBlobKey,
      },
    }).catch(() => undefined);
    await context.heartbeat?.().catch(() => undefined);
  };

  try {
    progressTimer = setInterval(pushProgress, BACKEND_RENDER_PROGRESS_INTERVAL_MS);
    if (typeof progressTimer.unref === 'function') progressTimer.unref();

    context.event?.({
      level: 'info',
      phase: 'prepare',
      message: 'Preparing render assets from cloud storage',
      data: { assetCount: manifest.assets.length },
    });
    const assetPaths = await prepareRenderAssets({ ...backgroundJob, dir: jobDir }, manifest, submittedAssets);

    await pushProgress();
    await renderJob(localJob, manifest, assetPaths);

    if (localJob.status === 'cancelled') {
      return {
        status: 'cancelled',
        progress: { percent: Math.min(localJob.progress || 0, 99), message: 'Render cancelled' },
        output: {},
        media: { outputBlobKey },
        message: 'Render cancelled',
      };
    }
    if (localJob.status !== 'done' || !localJob.zipPath) {
      throw new Error(localJob.error || 'Render failed before producing ZIP');
    }

    localJob.message = 'Uploading render ZIP';
    localJob.progress = 96;
    await pushProgress();
    const zipBuffer = await fsp.readFile(localJob.zipPath);
    await putCloudProjectBlobBufferForUser(
      backgroundJob.userId,
      backgroundJob.projectId,
      outputBlobKey,
      zipBuffer,
      'application/zip',
    );

    return {
      status: 'succeeded',
      progress: {
        percent: 100,
        message: 'Render complete',
        renderStatus: 'done',
        updatedAt: new Date().toISOString(),
      },
      output: {
        downloadBlobKey: outputBlobKey,
        fileName: 'episode-render.zip',
        contentType: 'application/zip',
        sizeBytes: zipBuffer.length,
      },
      media: {
        outputBlobKey,
        outputSizeBytes: zipBuffer.length,
      },
      message: 'Render complete',
    };
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    await fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}

function createRenderJobHandlers() {
  return {
    'step6-render': runStep6RenderJob,
  };
}

module.exports = {
  createRenderJobHandlers,
};
