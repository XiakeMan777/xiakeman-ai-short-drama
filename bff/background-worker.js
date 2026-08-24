const {
  appendJobEvent,
  claimNextJobForWorker,
  finishJobForWorker,
  heartbeatJobForWorker,
  updateJob,
} = require('./background-jobs');

const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;
const DEFAULT_LEASE_SECONDS = 1800;
const DEFAULT_STALE_SECONDS = 4 * 60;
const DEFAULT_CONCURRENCY = 256;
const DEFAULT_TYPE_CONCURRENCY = {
  'step1-analysis': 32,
  'step3-assets': 32,
  'step4-storyboards': 24,
  'image-generations': 64,
  'llm-completions': 128,
  'step5-videos': 24,
  'step6-tts': 64,
  'step6-bgm': 32,
  'step6-render': 12,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error) {
  const raw = error instanceof Error ? error.message : String(error);
  if (/insufficient\s+(account\s+)?balance|INSUFFICIENT_BALANCE|billing_error|余额不足|账户余额不足|无额度|no\s+balance|quota/i.test(raw)) {
    return [
      '后台使用的对话/图片模型账号余额不足。',
      '后台任务会优先使用当前用户保存到账号云端的模型配置，缺项才回落管理员共享配置。',
      '请先充值或更新对应的用户云端 Key；如果用户未配置，则请管理员充值或更新共享 Key 后重试。这类错误不会自动反复重试。',
    ].join('');
  }
  return raw;
}

function isPermanentJobError(message) {
  return /余额不足|账户余额不足|无额度|no\s+balance|quota|INSUFFICIENT_BALANCE|billing_error|insufficient\s+(account\s+)?balance/i.test(String(message || ''));
}

function getRetryDelayMs(message, attempt) {
  const text = String(message || '');
  const retryAfterMatch = text.match(/retry-after["'\s:=]+(\d{1,4})/i);
  const retryAfterSeconds = retryAfterMatch ? Number(retryAfterMatch[1]) : NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(180_000, retryAfterSeconds * 1000);
  }
  if (/Too many requests|(?:^|\D)429(?:\D|$)|rate\s*limit/i.test(text)) {
    return Math.min(180_000, 20_000 * Math.max(1, attempt));
  }
  if (/Cloud blob not found:\s*background-image-inputs\//i.test(text)) {
    return Math.min(45_000, 5000 * Math.max(1, attempt));
  }
  if (/Cloud blob not found:/i.test(text)) {
    return Math.min(120_000, 15_000 * Math.max(1, attempt));
  }
  if (/timeout|timed out|fetch failed|network error|upstream request failed|upstream_error|(?:^|\D)5\d{2}(?:\D|$)|ECONNRESET|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|Bad Gateway|Gateway Timeout|temporarily/i.test(text)) {
    return Math.min(60_000, 5000 * Math.max(1, attempt));
  }
  return 0;
}

function normalizeHandlerResult(result) {
  if (!result || typeof result !== 'object') return {};
  return result;
}

function getFailedResultMessage(result) {
  const directMessage = getErrorMessage(result?.error?.message || result?.error || '');
  if (directMessage) return directMessage;

  const items = Array.isArray(result?.output?.items) ? result.output.items : [];
  const failedItem = items.find((item) => item && (item.status === 'failed' || item.error));
  const itemError = getErrorMessage(failedItem?.error || failedItem?.message || '');
  if (itemError) return itemError;

  return getErrorMessage(result?.message || '后台任务失败');
}

async function applyRetryDelay(userId, jobId, message, attempt, maxAttempts) {
  const retryDelayMs = getRetryDelayMs(message, attempt);
  if (retryDelayMs <= 0) return;
  await appendJobEvent(userId, jobId, {
    level: 'retry',
    phase: 'retry-backoff',
    message: `后台任务遇到临时错误，${Math.round(retryDelayMs / 1000)} 秒后重试`,
    data: { retryDelayMs, attempt, maxAttempts },
  }).catch(() => undefined);
  await sleep(retryDelayMs);
}

function normalizeTypeConcurrency(value = {}) {
  const result = {};
  for (const [type, fallback] of Object.entries(DEFAULT_TYPE_CONCURRENCY)) {
    const configured = Number(value[type]);
    result[type] = Math.max(1, Number.isFinite(configured) ? configured : fallback);
  }
  for (const [type, configured] of Object.entries(value || {})) {
    if (result[type] !== undefined) continue;
    const number = Number(configured);
    if (Number.isFinite(number)) result[type] = Math.max(1, number);
  }
  return result;
}

function createBackgroundWorker(options = {}) {
  const handlers = options.handlers || {};
  const handledTypes = Object.keys(handlers);
  const workerId = options.workerId || `xiakeman-worker-${process.pid}`;
  const types = options.types?.length ? options.types : handledTypes;
  let concurrency = Math.max(1, Number(options.concurrency || DEFAULT_CONCURRENCY));
  let typeConcurrency = normalizeTypeConcurrency(options.typeConcurrency);
  const pollIntervalMs = Math.max(500, Number(options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS));
  const heartbeatIntervalMs = Math.max(5000, Number(options.heartbeatIntervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS));
  const leaseSeconds = Math.max(30, Number(options.leaseSeconds || DEFAULT_LEASE_SECONDS));
  const staleSeconds = Math.max(
    Math.ceil(heartbeatIntervalMs / 1000) * 2,
    Number(options.staleSeconds || DEFAULT_STALE_SECONDS),
  );

  let stopped = false;
  let activeCount = 0;
  const activeByType = new Map();
  const running = new Set();

  function getTypeLimit(type) {
    return Math.min(concurrency, Math.max(1, Number(typeConcurrency[type] || concurrency)));
  }

  function getActiveTypeCount(type) {
    return activeByType.get(type) || 0;
  }

  function getClaimableTypes() {
    return types.filter((type) => getActiveTypeCount(type) < getTypeLimit(type));
  }

  function updateConfig(nextConfig = {}) {
    if (nextConfig.concurrency !== undefined) {
      concurrency = Math.max(1, Number(nextConfig.concurrency || DEFAULT_CONCURRENCY));
    }
    if (nextConfig.typeConcurrency && typeof nextConfig.typeConcurrency === 'object') {
      typeConcurrency = normalizeTypeConcurrency(nextConfig.typeConcurrency);
    }
    return {
      concurrency,
      typeConcurrency,
    };
  }

  async function runJob(job) {
    const handler = handlers[job.type];
    if (!handler) {
      await finishJobForWorker(job.id, {
        workerId,
        status: 'paused',
        message: `No worker handler registered for ${job.type}`,
      });
      return;
    }

    let heartbeatTimer;
    try {
      heartbeatTimer = setInterval(() => {
          heartbeatJobForWorker(job.id, { userId: job.userId, workerId, leaseSeconds }).catch((error) => {
          console.warn('[background-worker] heartbeat failed', job.id, getErrorMessage(error));
        });
      }, heartbeatIntervalMs);

      await appendJobEvent(job.userId, job.id, {
        level: 'info',
        phase: 'running',
        message: '后台任务开始执行',
        data: { workerId },
      });

      const result = normalizeHandlerResult(await handler(job, {
        workerId,
        heartbeat: () => heartbeatJobForWorker(job.id, { userId: job.userId, workerId, leaseSeconds }),
        event: (event) => appendJobEvent(job.userId, job.id, event),
        update: (updates) => updateJob(job.userId, job.id, updates),
      }));

      if (result.status === 'failed') {
        const message = getFailedResultMessage(result);
        const shouldRetry = !isPermanentJobError(message) && (job.attempt || 0) < (job.maxAttempts || 1);
        if (shouldRetry) {
          await applyRetryDelay(job.userId, job.id, message, job.attempt || 1, job.maxAttempts || 1);
        }
        await finishJobForWorker(job.id, {
          userId: job.userId,
          workerId,
          status: shouldRetry ? 'queued' : 'failed',
          progress: result.progress,
          output: shouldRetry ? undefined : result.output,
          media: result.media,
          error: { message },
          message: shouldRetry ? '后台任务失败，已重新排队等待重试' : (result.message || '后台任务失败'),
        });
        return;
      }

      await finishJobForWorker(job.id, {
        userId: job.userId,
        workerId,
        status: result.status || 'succeeded',
        progress: result.progress,
        output: result.output,
        media: result.media,
        message: result.message || '后台任务完成',
      });
    } catch (error) {
      const message = getErrorMessage(error);
      const shouldRetry = !isPermanentJobError(message) && (job.attempt || 0) < (job.maxAttempts || 1);
      if (shouldRetry) {
        const retryDelayMs = getRetryDelayMs(message, job.attempt || 1);
        if (retryDelayMs > 0) {
          await appendJobEvent(job.userId, job.id, {
            level: 'retry',
            phase: 'retry-backoff',
            message: `后台任务遇到临时错误，${Math.round(retryDelayMs / 1000)} 秒后重试`,
            data: { retryDelayMs, attempt: job.attempt, maxAttempts: job.maxAttempts },
          }).catch(() => undefined);
          await sleep(retryDelayMs);
        }
      }
      await finishJobForWorker(job.id, {
        userId: job.userId,
        workerId,
        status: shouldRetry ? 'queued' : 'failed',
        error: { message },
        message: shouldRetry ? '后台任务失败，已重新排队等待重试' : '后台任务失败',
      }).catch((finishError) => {
        console.error('[background-worker] failed to finish job after error', job.id, finishError);
      });
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  }

  async function tick() {
    if (stopped || types.length === 0) return;
    while (!stopped && activeCount < concurrency) {
      const claimableTypes = getClaimableTypes();
      if (claimableTypes.length === 0) break;
      const job = await claimNextJobForWorker({ workerId, types: claimableTypes, leaseSeconds, staleSeconds });
      if (!job) break;
      activeCount += 1;
      activeByType.set(job.type, getActiveTypeCount(job.type) + 1);
      const promise = runJob(job)
        .catch((error) => {
          console.error('[background-worker] unhandled job error', job.id, error);
        })
        .finally(() => {
          activeCount -= 1;
          activeByType.set(job.type, Math.max(0, getActiveTypeCount(job.type) - 1));
          running.delete(promise);
        });
      running.add(promise);
    }
  }

  async function loop() {
    while (!stopped) {
      try {
        await tick();
      } catch (error) {
        console.error('[background-worker] tick failed', error);
      }
      await sleep(pollIntervalMs);
    }
  }

  return {
    start() {
      stopped = false;
      loop();
    },
    async stop() {
      stopped = true;
      await Promise.allSettled(Array.from(running));
    },
    getStatus() {
      return {
        workerId,
        stopped,
        activeCount,
        concurrency,
        typeConcurrency,
        activeByType: Object.fromEntries(activeByType.entries()),
        types,
      };
    },
    updateConfig,
  };
}

module.exports = {
  createBackgroundWorker,
};
