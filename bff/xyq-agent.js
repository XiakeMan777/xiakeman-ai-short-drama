const express = require('express');
const multer = require('multer');
const { isHostnameAllowed, isPrivateHostname } = require('./url-policy');

const DEFAULT_XYQ_BASE = 'https://xyq.jianying.com';
const SUBMIT_RUN_PATH = '/api/biz/v1/skill/submit_run';
const GET_THREAD_PATH = '/api/biz/v1/skill/get_thread';
const UPLOAD_FILE_PATH = '/api/biz/v1/skill/upload_file';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

const XYQ_BASE_ALLOWLIST = (process.env.XYQ_AGENT_BASE_ALLOWLIST || 'xyq.jianying.com')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function normalizeAccessKey(value) {
  const accessKey = String(value || '').trim();
  if (!accessKey) {
    const error = new Error('Missing XYQ Access Key');
    error.status = 400;
    throw error;
  }
  return accessKey;
}

function resolveXyqBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || DEFAULT_XYQ_BASE));
  } catch {
    const error = new Error('Invalid XYQ base URL');
    error.status = 400;
    throw error;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    const error = new Error('XYQ base URL must be http or https');
    error.status = 400;
    throw error;
  }
  if (isPrivateHostname(parsed.hostname)) {
    const error = new Error('XYQ base URL cannot point to a private host');
    error.status = 400;
    throw error;
  }
  if (!isHostnameAllowed(parsed.hostname, XYQ_BASE_ALLOWLIST)) {
    const error = new Error(`XYQ base host is not allowed: ${parsed.hostname}`);
    error.status = 400;
    throw error;
  }

  for (const suffix of [SUBMIT_RUN_PATH, GET_THREAD_PATH, UPLOAD_FILE_PATH, '/api/biz/v1/skill']) {
    if (parsed.pathname.endsWith(suffix)) {
      parsed.pathname = parsed.pathname.slice(0, -suffix.length) || '/';
      break;
    }
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

function xyqHeaders(accessKey) {
  return {
    Authorization: `Bearer ${accessKey}`,
    'Content-Type': 'application/json',
  };
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const error = new Error(text || `Non-JSON response (${response.status})`);
    error.status = response.status || 502;
    throw error;
  }
}

function unwrapXyqEnvelope(payload) {
  const ret = payload?.ret;
  if (ret !== undefined && String(ret) !== '0') {
    const error = new Error(payload?.errmsg || payload?.message || `XYQ error ${ret}`);
    error.status = 502;
    throw error;
  }
  return payload?.data ?? payload;
}

async function xyqPostJson(baseUrl, path, accessKey, body, signal) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: xyqHeaders(accessKey),
    body: JSON.stringify(body),
    signal,
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const error = new Error(payload?.errmsg || payload?.message || `XYQ HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return unwrapXyqEnvelope(payload);
}

function pickFirstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeSubmitRunData(data) {
  const run = data?.run ?? data?.thread?.run ?? data ?? {};
  const thread = data?.thread ?? {};
  const threadId = pickFirstString(
    run.thread_id,
    run.threadId,
    data?.thread_id,
    data?.threadId,
    thread.thread_id,
    thread.threadId,
  );
  const runId = pickFirstString(run.run_id, run.runId, data?.run_id, data?.runId);
  const webThreadLink = pickFirstString(
    data?.web_thread_link,
    data?.webThreadLink,
    run.web_thread_link,
    run.webThreadLink,
    thread.web_thread_link,
  );
  return { threadId, runId, webThreadLink, raw: data };
}

function normalizeState(value) {
  const numeric = Number(value);
  if (numeric === 3) return 'success';
  if (numeric === 4) return 'failed';
  if (numeric === 5) return 'cancelled';
  const text = String(value || '').toLowerCase();
  if (['success', 'succeeded', 'done', 'completed'].includes(text)) return 'success';
  if (['failed', 'error'].includes(text)) return 'failed';
  if (['cancelled', 'canceled'].includes(text)) return 'cancelled';
  return 'running';
}

function extractRunFromThreadData(data, runId) {
  const thread = data?.thread ?? data ?? {};
  const runs = Array.isArray(thread.run_list) ? thread.run_list : [];
  if (runs.length > 0) {
    return runs.find((run) => run?.run_id === runId || run?.runId === runId) ?? runs[0];
  }
  return data?.run ?? thread.run ?? data ?? {};
}

function collectUrls(value, output = []) {
  if (!value) return output;
  if (typeof value === 'string') {
    const matches = value.match(/https?:\/\/[^\s"'<>\\]+/g);
    if (matches) output.push(...matches.map((url) => url.replace(/[),.，。；;]+$/, '')));
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, output));
    return output;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectUrls(item, output);
  }
  return output;
}

function pickVideoUrl(urls) {
  const unique = Array.from(new Set(urls.filter(Boolean)));
  return unique.find((url) => /\.(mp4|mov|webm|m4v)(?:[?#]|$)/i.test(url))
    || unique.find((url) => /video|mp4|play|download/i.test(url))
    || '';
}

function collectText(value, output = []) {
  if (!value) return output;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed && !/^https?:\/\//i.test(trimmed)) output.push(trimmed);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, output));
    return output;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectText(item, output);
  }
  return output;
}

function normalizeThreadData(data, runId) {
  const run = extractRunFromThreadData(data, runId);
  const status = normalizeState(run.state ?? run.run_state ?? data?.state);
  const urls = collectUrls(run);
  const videoUrl = pickVideoUrl(urls);
  const texts = collectText(run);
  const failReason = pickFirstString(run.fail_reason, run.failReason, run.error, run.errmsg, data?.errmsg);
  const message = failReason || texts.slice(-3).join('\n').slice(0, 1000);
  const progress = status === 'success'
    ? 100
    : Number.isFinite(Number(run.progress))
      ? Math.max(0, Math.min(99, Number(run.progress)))
      : 15;

  return {
    status,
    progress,
    videoUrl,
    message,
    rawState: run.state ?? run.run_state,
    raw: run,
  };
}

function handleError(res, error) {
  const status = Number(error?.status) || 500;
  res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
}

function createXyqAgentRouter({ rateLimit } = {}) {
  const router = express.Router();
  if (rateLimit) router.use(rateLimit);

  router.post('/submit-run', async (req, res) => {
    try {
      const accessKey = normalizeAccessKey(req.body?.accessKey);
      const baseUrl = resolveXyqBaseUrl(req.body?.baseUrl);
      const message = String(req.body?.message || '').trim();
      if (!message) return res.status(400).json({ error: 'Missing message' });
      const body = { message };
      const threadId = String(req.body?.threadId || '').trim();
      if (threadId) body.thread_id = threadId;
      if (Array.isArray(req.body?.assetIds) && req.body.assetIds.length > 0) {
        body.asset_ids = req.body.assetIds.map(String).filter(Boolean);
      }

      const data = await xyqPostJson(baseUrl, SUBMIT_RUN_PATH, accessKey, body, req.signal);
      const normalized = normalizeSubmitRunData(data);
      if (!normalized.threadId || !normalized.runId) {
        return res.status(502).json({ error: 'XYQ did not return thread_id/run_id', raw: data });
      }
      res.json(normalized);
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/get-thread', async (req, res) => {
    try {
      const accessKey = normalizeAccessKey(req.body?.accessKey);
      const baseUrl = resolveXyqBaseUrl(req.body?.baseUrl);
      const threadId = String(req.body?.threadId || '').trim();
      const runId = String(req.body?.runId || '').trim();
      if (!threadId) return res.status(400).json({ error: 'Missing thread_id' });

      const data = await xyqPostJson(baseUrl, GET_THREAD_PATH, accessKey, {
        thread_id: threadId,
        ...(runId ? { run_id: runId } : {}),
        after_seq: Number(req.body?.afterSeq) || 0,
      }, req.signal);
      res.json(normalizeThreadData(data, runId));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/upload-file', upload.single('file'), async (req, res) => {
    try {
      const accessKey = normalizeAccessKey(req.body?.accessKey);
      const baseUrl = resolveXyqBaseUrl(req.body?.baseUrl);
      if (!req.file?.buffer?.length) return res.status(400).json({ error: 'Missing file' });
      if (!/^image\/|^video\//i.test(req.file.mimetype || '')) {
        return res.status(400).json({ error: `Unsupported file type: ${req.file.mimetype || 'unknown'}` });
      }

      const form = new FormData();
      form.append('accessKey', accessKey);
      form.append(
        'file',
        new Blob([req.file.buffer], { type: req.file.mimetype || 'application/octet-stream' }),
        req.file.originalname || 'asset',
      );

      const response = await fetch(`${baseUrl}${UPLOAD_FILE_PATH}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessKey}` },
        body: form,
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        return res.status(response.status).json({
          error: payload?.errmsg || payload?.message || `XYQ upload HTTP ${response.status}`,
        });
      }
      const data = unwrapXyqEnvelope(payload);
      const assetId = pickFirstString(data?.pippit_asset_id, data?.asset_id, data?.assetId);
      if (!assetId) return res.status(502).json({ error: 'XYQ upload did not return asset id', raw: data });
      res.json({ assetId, raw: data });
    } catch (error) {
      handleError(res, error);
    }
  });

  return router;
}

module.exports = {
  createXyqAgentRouter,
};
