const DEFAULT_VIDEO_FETCH_TIMEOUT_MS = 120_000;
const DEFAULT_VIDEO_VALIDATION_TIMEOUT_MS = 8_000;

export interface VideoBlobValidationResult {
  valid: boolean;
  reason?: string;
  usedPlayableCheck: boolean;
}

export interface DownloadValidatedVideoBlobResult {
  ok: boolean;
  blob: Blob | null;
  reason?: string;
  status?: number;
  fetchUrl: string;
  usedProxy?: boolean;
}

export function shouldProxyVideoUrl(videoUrl: string): boolean {
  return videoUrl.includes('ark-acg-cn-beijing')
    || videoUrl.includes('volces.com')
    || videoUrl.includes('dashscope-result.oss-cn-beijing.aliyuncs.com')
    || videoUrl.includes('365yg.com')
    || videoUrl.includes('sd2.xiakeman.com')
    || videoUrl.includes('.cos.');
}

export function shouldForceProxyVideoUrl(videoUrl: string): boolean {
  if (!videoUrl || typeof window === 'undefined') return false;
  try {
    const parsed = new URL(videoUrl, window.location.href);
    return window.location.protocol === 'https:' && parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function shouldPreferProxyVideoDownloadUrl(videoUrl: string): boolean {
  return shouldForceProxyVideoUrl(videoUrl);
}

export function buildVideoFetchUrl(videoUrl: string, useProxy = false): string {
  if (!videoUrl) return videoUrl;
  return (useProxy || shouldForceProxyVideoUrl(videoUrl)) && canProxyVideoUrl(videoUrl)
    ? `/api/proxy/video?url=${encodeURIComponent(videoUrl)}`
    : videoUrl;
}

function canProxyVideoUrl(videoUrl: string) {
  try {
    const parsed = new URL(videoUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function createFetchSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function shouldRunPlayableCheck(skipPlayableCheck?: boolean): boolean {
  if (skipPlayableCheck) return false;
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof URL === 'undefined') {
    return false;
  }
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent ?? '' : '';
  if (/jsdom/i.test(userAgent)) return false;
  const video = document.createElement('video');
  return typeof video.load === 'function';
}

function isLikelyVideoBlobType(type: string): boolean {
  return type.startsWith('video/') || type === 'application/octet-stream' || type === '';
}

async function validateVideoBlobPlayable(
  blob: Blob,
  timeoutMs: number,
): Promise<VideoBlobValidationResult> {
  return await new Promise<VideoBlobValidationResult>((resolve) => {
    const objectUrl = URL.createObjectURL(blob);
    const video = document.createElement('video');
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timer);
      video.onerror = null;
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    };

    const finish = (result: VideoBlobValidationResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const confirmPlayable = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const width = Number.isFinite(video.videoWidth) ? video.videoWidth : 0;
      const height = Number.isFinite(video.videoHeight) ? video.videoHeight : 0;
      if (duration > 0 || (width > 0 && height > 0)) {
        finish({ valid: true, usedPlayableCheck: true });
      } else {
        finish({ valid: false, reason: '视频元数据无效', usedPlayableCheck: true });
      }
    };

    const timer = window.setTimeout(() => {
      finish({ valid: false, reason: '视频校验超时', usedPlayableCheck: true });
    }, timeoutMs);

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onerror = () => finish({ valid: false, reason: '视频无法解码', usedPlayableCheck: true });
    video.onloadedmetadata = confirmPlayable;
    video.onloadeddata = confirmPlayable;
    video.src = objectUrl;
    video.load();
  });
}

export async function validateVideoBlob(
  blob: Blob,
  options?: { timeoutMs?: number; skipPlayableCheck?: boolean },
): Promise<VideoBlobValidationResult> {
  if (blob.size <= 0) {
    return { valid: false, reason: '视频文件为空', usedPlayableCheck: false };
  }

  if (!isLikelyVideoBlobType(blob.type)) {
    return { valid: false, reason: `视频类型异常: ${blob.type || 'unknown'}`, usedPlayableCheck: false };
  }

  if (!shouldRunPlayableCheck(options?.skipPlayableCheck)) {
    return { valid: true, usedPlayableCheck: false };
  }

  return await validateVideoBlobPlayable(
    blob,
    options?.timeoutMs ?? DEFAULT_VIDEO_VALIDATION_TIMEOUT_MS,
  );
}

export async function downloadValidatedVideoBlob(
  videoUrl: string,
  options?: { useProxy?: boolean; proxyFallback?: boolean; timeoutMs?: number; skipPlayableCheck?: boolean },
): Promise<DownloadValidatedVideoBlobResult> {
  const firstAttemptUsesProxy = options?.useProxy === true || shouldPreferProxyVideoDownloadUrl(videoUrl);
  const firstFetchUrl = buildVideoFetchUrl(videoUrl, firstAttemptUsesProxy);
  const shouldTryProxyFallback = !firstAttemptUsesProxy
    && canProxyVideoUrl(videoUrl)
    && (options?.proxyFallback === true || shouldProxyVideoUrl(videoUrl));
  const attempts = [
    { fetchUrl: firstFetchUrl, usedProxy: firstFetchUrl !== videoUrl },
    ...(shouldTryProxyFallback ? [{ fetchUrl: buildVideoFetchUrl(videoUrl, true), usedProxy: true }] : []),
  ];
  let lastResult: DownloadValidatedVideoBlobResult | null = null;

  for (const attempt of attempts) {
    const { fetchUrl, usedProxy } = attempt;
    try {
      const response = await fetch(fetchUrl, {
        signal: createFetchSignal(options?.timeoutMs ?? DEFAULT_VIDEO_FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        lastResult = {
          ok: false,
          blob: null,
          reason: `下载失败 (${response.status})`,
          status: response.status,
          fetchUrl,
          usedProxy,
        };
        continue;
      }

      const blob = await response.blob();
      const validation = await validateVideoBlob(blob, {
        timeoutMs: options?.timeoutMs,
        skipPlayableCheck: options?.skipPlayableCheck,
      });

      if (!validation.valid) {
        lastResult = {
          ok: false,
          blob: null,
          reason: validation.reason ?? '视频校验失败',
          fetchUrl,
          usedProxy,
        };
        continue;
      }

      return { ok: true, blob, fetchUrl, usedProxy };
    } catch (error) {
      lastResult = {
        ok: false,
        blob: null,
        reason: error instanceof Error ? error.message : '视频下载失败',
        fetchUrl,
        usedProxy,
      };
    }
  }

  return lastResult ?? {
    ok: false,
    blob: null,
    reason: '视频下载失败',
    fetchUrl: buildVideoFetchUrl(videoUrl, options?.useProxy),
    usedProxy: options?.useProxy === true,
  };
}
