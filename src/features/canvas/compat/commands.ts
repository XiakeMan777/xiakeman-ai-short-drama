import { getNextGrsaiKey, GRSAI_BUILTIN_BASE_URL, GRSAI_BUILTIN_CHAT_BASE_URL } from "../shared/grsaiKeys";
import { getNextSd2Key, SD2_BUILTIN_BASE_URL } from "../shared/sd2Keys";
import { getNextYunzhiKey, YUNZHI_BUILTIN_BASE_URL } from "../shared/yunzhiKeys";

type ImageJob = {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  result?: string;
  error?: string;
  progress?: number;
};

type VideoJob = {
  job_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  result?: string | null;
  error?: string | null;
  progress?: number;
  remote?: {
    baseUrl: string;
    apiKey: string;
    pollPath: string;
    authStyle?: "bearer" | "seedance-cloud";
  };
};

const apiKeys = new Map<string, string>();
const baseUrls = new Map<string, string>();
const imageJobs = new Map<string, ImageJob>();
const videoJobs = new Map<string, VideoJob>();

const IMAGE_DONE = new Set(["success", "succeeded", "completed", "complete", "done"]);
const IMAGE_FAIL = new Set(["failed", "fail", "failure", "error", "cancelled", "canceled"]);
const VIDEO_DONE = new Set(["success", "succeeded", "completed", "complete", "done"]);
const VIDEO_FAIL = new Set(["failed", "fail", "error", "cancelled", "canceled"]);
const SEEDANCE_CLOUD_POLL_PATH = "__seedance_cloud__";

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeBaseUrl(baseUrl: string, defaultBase: string) {
  return (baseUrl || defaultBase).replace(/\/+$/, "");
}

function buildV1Url(baseUrl: string, path: string) {
  const base = normalizeBaseUrl(baseUrl, "");
  if (base.endsWith("/v1")) return `${base}${path}`;
  return `${base}/v1${path}`;
}

function normalizeArtlistImageApiBase(baseUrl: string) {
  const base = normalizeBaseUrl(baseUrl, `${SD2_BUILTIN_BASE_URL}/api`);
  if (/\/api\/generate-image$/i.test(base)) return base.replace(/\/generate-image$/i, "");
  if (/\/api$/i.test(base)) return base;
  return `${base}/api`;
}

function dataUrlToBlob(source: string): Blob {
  const match = source.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/);
  if (!match) return new Blob([source], { type: "text/plain" });
  const mime = match[1] || "application/octet-stream";
  const payload = match[2] || "";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

async function sourceToBlob(source: string): Promise<Blob> {
  if (source.startsWith("data:")) return dataUrlToBlob(source);
  const response = await fetch(source);
  if (!response.ok) throw new Error(`读取资源失败: HTTP ${response.status}`);
  return await response.blob();
}

function bytesToDataUrl(bytes: number[], mime = "application/octet-stream") {
  const chunkSize = 0x8000;
  let binary = "";
  const array = new Uint8Array(bytes);
  for (let offset = 0; offset < array.length; offset += chunkSize) {
    binary += String.fromCharCode(...array.subarray(offset, offset + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  return bytesToDataUrl(bytes, blob.type || "image/png");
}

async function getImageSize(source: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = source;
  });
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
  }
  return output;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return collectStrings(record.url || record.downloadUrl || record.download_url || record.path || "");
  }
  return [];
}

function getInteger(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function getNested(obj: unknown, path: string): unknown {
  if (!obj || !path) return undefined;
  return path.split(".").reduce<unknown>((current, key) => {
    if (current == null) return undefined;
    const normalizedKey = /^\d+$/.test(key) ? Number(key) : key;
    return (current as Record<string | number, unknown>)[normalizedKey];
  }, obj);
}

function extractImageResult(payload: unknown): string {
  const data = payload as Record<string, unknown>;
  const candidates = [
    data.url,
    data.image_url,
    data.output_url,
    data.stable_image_url,
    data.official_image_url,
    data.result,
    getNested(data, "data.0.url"),
    getNested(data, "data.0.image_url"),
    getNested(data, "data.url"),
    getNested(data, "data.image_url"),
    getNested(data, "data.output_url"),
    getNested(data, "data.stable_image_url"),
    getNested(data, "data.official_image_url"),
    getNested(data, "output.url"),
    getNested(data, "images.0.url"),
  ];
  const url = firstString(...candidates);
  if (url) return url;

  const b64 = firstString(
    getNested(data, "data.0.b64_json"),
    getNested(data, "data.b64_json"),
    data.b64_json,
  );
  if (b64) return `data:image/png;base64,${b64}`;

  throw new Error("图片 API 未返回图片 URL 或 b64_json");
}

function extractTaskId(payload: unknown): string {
  const data = payload as Record<string, unknown>;
  return firstString(
    data.id,
    data.task_id,
    data.taskId,
    data.job_id,
    data.jobId,
    getNested(data, "data.id"),
    getNested(data, "data.task_id"),
    getNested(data, "data.taskId"),
  );
}

function extractVideoUrl(payload: unknown, field?: string): string {
  const data = payload as Record<string, unknown>;
  if (field) {
    const value = getNested(data, field);
    if (typeof value === "string") return value;
  }
  return firstString(
    data.video_url,
    data.videoUrl,
    data.url,
    data.result,
    data.result_url,
    data.official_video_url,
    data.officialVideoUrl,
    data.stable_video_url,
    data.stableVideoUrl,
    data.local_video_url,
    data.localVideoUrl,
    data.mp4_url,
    data.mp4Url,
    getNested(data, "data.video_url"),
    getNested(data, "data.videoUrl"),
    getNested(data, "data.url"),
    getNested(data, "data.result"),
    getNested(data, "data.result_url"),
    getNested(data, "data.official_video_url"),
    getNested(data, "data.stable_video_url"),
    getNested(data, "data.local_video_url"),
    getNested(data, "data.mp4_url"),
    getNested(data, "output.url"),
    getNested(data, "output.video_url"),
    getNested(data, "videos.0.url"),
    getNested(data, "choices.0.message.content"),
  );
}

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { text };
  }
  if (!response.ok) {
    throw new Error(typeof text === "string" && text ? text.slice(0, 500) : `HTTP ${response.status}`);
  }
  return payload;
}

function appendSeedanceAuthQuery(url: string, licenseKey: string) {
  if (!url || !licenseKey) return url;
  try {
    const parsed = new URL(url, window.location.origin);
    if (!parsed.searchParams.get("license_key")) parsed.searchParams.set("license_key", licenseKey);
    return parsed.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}license_key=${encodeURIComponent(licenseKey)}`;
  }
}

function resolveSeedanceVideoUrl(url: string, apiBase: string, licenseKey: string) {
  if (!url) return "";
  let resolved = url;
  try {
    resolved = new URL(url, apiBase).toString();
  } catch {
    return url;
  }
  try {
    const parsed = new URL(resolved);
    return parsed.pathname.startsWith("/api/video/") || parsed.pathname.startsWith("/video/")
      ? appendSeedanceAuthQuery(resolved, licenseKey)
      : resolved;
  } catch {
    return resolved;
  }
}

function buildSeedanceVideoUrl(apiBase: string, taskId: string, licenseKey: string) {
  return appendSeedanceAuthQuery(`${apiBase}/video/${encodeURIComponent(taskId)}`, licenseKey);
}

function normalizeSeedanceCloudBaseUrl(value: string) {
  const raw = normalizeBaseUrl(value || SD2_BUILTIN_BASE_URL, SD2_BUILTIN_BASE_URL);
  if (/\/api$/i.test(raw)) return raw;
  return `${raw}/api`;
}

function normalizeSeedanceCloudModel(model: unknown) {
  const normalized = String(model || "").trim().toLowerCase();
  if (["mini", "transit9-mini", "sd2-720p-mini", "sd2-1080p-mini", "jimeng-video-seedance-2.0-mini"].includes(normalized)) {
    return "mini";
  }
  if (["2.0", "seedance-2.0", "transit9-2.0", "sd2-720p", "sd2-1080p", "sd2-720p-sh", "sd2-1080p-zt", "jimeng-video-seedance-2.0"].includes(normalized)) {
    return "2.0";
  }
  if (normalized === "fofo") return "fofo";
  return "fast";
}

function normalizeSeedanceCloudResolution(model: string, value: unknown) {
  const requested = String(value || "720p").trim().toLowerCase();
  const allowed = model === "2.0" ? ["480p", "720p", "1080p", "4k"] : ["480p", "720p"];
  return allowed.includes(requested) ? requested : "720p";
}

function isSeedanceCloudVideoPayload(payload: Record<string, unknown>, rawBody: Record<string, unknown>, baseUrl: string) {
  const format = String(payload.api_format || payload._api_format || rawBody.api_format || "").toLowerCase();
  return format === "seedance-cloud" || /(^|\/\/)sd2\.xiakeman\.com/i.test(baseUrl);
}

function collectSeedanceMediaUrls(payload: Record<string, unknown>, rawBody: Record<string, unknown>, keys: string[]) {
  return uniqueStrings(keys.flatMap((key) => [
    ...collectStrings(rawBody[key]),
    ...collectStrings(payload[key]),
  ]));
}

function normalizeFrameRatio(value: unknown) {
  const text = String(value || "16:9").trim();
  if (["9:16", "16:9", "1:1", "4:3", "3:4"].includes(text)) return text;
  return "16:9";
}

function extractSeedanceStatus(payload: unknown) {
  const data = payload as Record<string, unknown>;
  const status = String(
    data.status ||
    data.state ||
    data.task_status ||
    getNested(data, "data.status") ||
    getNested(data, "data.state") ||
    "",
  ).toLowerCase();
  if (["finish", "finished"].includes(status)) return "success";
  if (["timeout"].includes(status)) return "failed";
  return status;
}

async function submitSeedanceCloudVideoJob(payload: Record<string, unknown>, rawBody: Record<string, unknown>, baseUrl: string, apiKey: string) {
  const licenseKey = firstString(
    payload.seedance_cloud_license_key,
    payload.seedanceCloudLicenseKey,
    payload.license_key,
    payload.licenseKey,
    rawBody.seedance_cloud_license_key,
    rawBody.seedanceCloudLicenseKey,
    rawBody.license_key,
    rawBody.licenseKey,
    apiKey && !apiKey.startsWith("sk-") ? apiKey : "",
  );
  if (!licenseKey) {
    throw new Error("请先在视频模型设置中填写虾客漫SD2卡密，画布视频会复用主站的云端卡密。");
  }

  const apiBase = normalizeSeedanceCloudBaseUrl(firstString(
    payload.seedance_cloud_base_url,
    payload.seedanceCloudBaseUrl,
    rawBody.seedance_cloud_base_url,
    rawBody.seedanceCloudBaseUrl,
    baseUrl,
  ));
  const prompt = firstString(rawBody.prompt, payload.prompt);
  if (!prompt) throw new Error("缺少视频提示词");

  const model = normalizeSeedanceCloudModel(rawBody.model || payload.model);
  const duration = getInteger(rawBody.duration ?? rawBody.seconds ?? payload.duration, 4, 1, 60);
  const ratio = normalizeFrameRatio(rawBody.ratio || rawBody.aspect_ratio || payload.ratio || payload.aspect_ratio);
  const resolution = normalizeSeedanceCloudResolution(model, rawBody.resolution || payload.resolution);
  const clientTaskId = firstString(rawBody.client_task_id, rawBody.clientTaskId, payload.client_task_id, payload.clientTaskId)
    || `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const imageUrls = collectSeedanceMediaUrls(payload, rawBody, [
    "image_urls",
    "imageUrls",
    "images",
    "reference_images",
    "referenceImages",
    "ref_images",
    "first_frame",
    "firstFrame",
    "image",
  ]).filter((url) => /^https?:\/\//i.test(url));
  const audioUrls = collectSeedanceMediaUrls(payload, rawBody, [
    "audio_urls",
    "audioUrls",
    "audio_paths",
    "audio_path",
    "audios",
  ]).filter((url) => /^https?:\/\//i.test(url));
  const videoUrls = collectSeedanceMediaUrls(payload, rawBody, [
    "video_urls",
    "videoUrls",
    "reference_video_urls",
    "referenceVideoUrls",
    "video_reference",
    "videoReference",
    "videos",
  ]).filter((url) => /^https?:\/\//i.test(url));

  const formData = new FormData();
  formData.append("prompt", prompt);
  formData.append("duration", String(duration));
  formData.append("ratio", ratio);
  formData.append("model", model);
  formData.append("resolution", resolution);
  formData.append("client_task_id", clientTaskId);
  formData.append("media_numbering", "independent_by_type");
  formData.append("image_reference_count", String(imageUrls.length));
  if (imageUrls.length > 0) formData.append("image_urls", JSON.stringify(imageUrls));
  if (audioUrls.length > 0) {
    formData.append("audio_reference_count", String(audioUrls.length));
    formData.append("voice_reference_count", String(audioUrls.length));
    formData.append("audio_urls", JSON.stringify(audioUrls));
    formData.append("voice_reference_audio_urls", JSON.stringify(audioUrls));
    formData.append("audio_reference_urls", JSON.stringify(audioUrls));
  }
  if (videoUrls.length > 0) {
    formData.append("video_urls", JSON.stringify(videoUrls));
    formData.append("reference_video_urls", JSON.stringify(videoUrls));
    formData.append("imitation_video_urls", JSON.stringify(videoUrls));
  }
  formData.append("remote_media_source", "cos");

  const response = await fetch(`${apiBase}/generate-video`, {
    method: "POST",
    headers: { "X-License-Key": licenseKey },
    body: formData,
    signal: AbortSignal.timeout(10 * 60_000),
  });
  const text = await response.text();
  let responsePayload: unknown = {};
  try {
    responsePayload = text ? JSON.parse(text) : {};
  } catch {
    responsePayload = { text };
  }
  if (!response.ok) {
    throw new Error(text.slice(0, 500) || `Seedance submit HTTP ${response.status}`);
  }
  const remoteId = extractTaskId(responsePayload);
  if (!remoteId) throw new Error("虾客漫SD2未返回任务 ID");
  const rawStatus = extractSeedanceStatus(responsePayload);
  const directUrl = resolveSeedanceVideoUrl(extractVideoUrl(responsePayload, String(payload._video_url_field || "")), apiBase, licenseKey);
  const job: VideoJob = directUrl && VIDEO_DONE.has(rawStatus)
    ? { job_id: remoteId, status: "succeeded", result: directUrl, progress: 100 }
    : { job_id: remoteId, status: "running", result: null, progress: 5, remote: { baseUrl: apiBase, apiKey: licenseKey, pollPath: SEEDANCE_CLOUD_POLL_PATH, authStyle: "seedance-cloud" } };
  videoJobs.set(remoteId, job);
  return remoteId;
}

function normalizeArtlistImageModel(model: string) {
  const normalized = String(model || "").trim().toLowerCase().replace(/_/g, "-").replace(/\s+/g, "-");
  if (!normalized) return "nano-banana";
  const compact = normalized.replace(/-/g, "");
  if (normalized === "nano-banana-2" || compact === "nanobanana2" || compact === "nanobanana") return "nano-banana";
  if (normalized === "google-nano-banana-2") return "nano-banana";
  if (compact === "nanobananapro" || normalized === "google-nano-banana-pro") return "nano-banana-pro";
  if (/^seedream-?5(?:\.0|-0)?$/.test(normalized) || compact === "seedream50" || compact === "seedream5") return "seedream-5.0";
  if (normalized === "openai-gpt-image-2" || normalized === "gpt-image2" || compact === "gptimage2") return "gpt-image-2";
  return String(model || "").trim();
}

function toArtlistImageResolution(model: string, imageSize: string) {
  const normalizedModel = normalizeArtlistImageModel(model).toLowerCase();
  const normalizedSize = String(imageSize || "1K").toUpperCase();
  if (normalizedModel === "gpt-image-2") return normalizedSize === "1K" ? "low" : "medium";
  if (normalizedModel === "nano-banana-pro") return normalizedSize === "1K" ? "1K" : "2K";
  if (normalizedModel === "seedream-5.0") return normalizedSize === "4K" ? "4K" : "2K";
  return normalizedSize === "4K" ? "4K" : normalizedSize === "2K" ? "2K" : "1K";
}

function makeArtlistImageTaskId() {
  const fallback = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `canvas-img-${crypto.randomUUID?.() || fallback}`;
}

async function buildArtlistImageReferencePayload(references: string[]) {
  const image_urls: string[] = [];
  const images_base64: Array<{ data: string; filename: string; mime_type: string }> = [];
  const capped = uniqueStrings(references).slice(0, 14);
  for (let index = 0; index < capped.length; index += 1) {
    const source = capped[index];
    if (/^https?:\/\//i.test(source)) {
      image_urls.push(source);
      continue;
    }
    const blob = await sourceToBlob(source);
    images_base64.push({
      data: await blobToDataUrl(blob),
      filename: `reference-${index + 1}.${blob.type.includes("webp") ? "webp" : blob.type.includes("jpeg") || blob.type.includes("jpg") ? "jpg" : "png"}`,
      mime_type: blob.type || "image/png",
    });
  }
  return { image_urls, images_base64 };
}

async function pollArtlistImageTask(apiBase: string, apiKey: string, taskId: string): Promise<string> {
  const startedAt = Date.now();
  while (true) {
    const payload = await requestJson(`${apiBase}/task/${encodeURIComponent(taskId)}`, {
      headers: { "X-License-Key": apiKey },
    });
    const status = String(
      (payload as Record<string, unknown>).status ||
      (payload as Record<string, unknown>).task_status ||
      getNested(payload, "task.status") ||
      getNested(payload, "data.status") ||
      "",
    ).toLowerCase();
    let imageUrl = "";
    try {
      imageUrl = extractImageResult(payload);
    } catch {
      imageUrl = "";
    }
    if (imageUrl && (!status || IMAGE_DONE.has(status))) return imageUrl;
    if (IMAGE_FAIL.has(status)) {
      throw new Error(firstString(
        (payload as Record<string, unknown>).error_message,
        (payload as Record<string, unknown>).message,
        getNested(payload, "error.message"),
      ) || "图片生成失败");
    }
    if (Date.now() - startedAt > 25 * 60_000) {
      throw new Error("虾客漫图片生成超过 25 分钟未完成");
    }
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
}

async function runArtlistImageRequest(payload: Record<string, unknown>, model: string, baseUrl: string, apiKey: string) {
  const extraParams = (payload.extra_params || {}) as Record<string, unknown>;
  const apiBase = normalizeArtlistImageApiBase(baseUrl);
  const imageSize = String(extraParams.imageSize || payload.image_size || "1K");
  const referenceImages = uniqueStrings([
    ...collectStrings(extraParams.referenceImages),
    ...collectStrings(extraParams.image),
    ...collectStrings((payload as Record<string, unknown>).referenceImages),
  ]);
  const references = await buildArtlistImageReferencePayload(referenceImages);
  const requestModel = normalizeArtlistImageModel(model);
  const body = {
    client_task_id: makeArtlistImageTaskId(),
    prompt: payload.prompt,
    model: requestModel,
    resolution: toArtlistImageResolution(requestModel, imageSize),
    ratio: firstString(extraParams.aspectRatio, payload.aspect_ratio, payload.ratio) || "1:1",
    ...(references.image_urls.length ? { image_urls: references.image_urls } : {}),
    ...(references.images_base64.length ? { images_base64: references.images_base64 } : {}),
  };
  const result = await requestJson(`${apiBase}/generate-image`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-License-Key": apiKey,
    },
    body: JSON.stringify(body),
  });
  const status = String(
    (result as Record<string, unknown>).status ||
    (result as Record<string, unknown>).task_status ||
    "",
  ).toLowerCase();
  let immediateUrl = "";
  try {
    immediateUrl = extractImageResult(result);
  } catch {
    immediateUrl = "";
  }
  if (immediateUrl && IMAGE_DONE.has(status)) return immediateUrl;
  const taskId = extractTaskId(result);
  if (!taskId) throw new Error("虾客漫图片 API 未返回任务 ID");
  return await pollArtlistImageTask(apiBase, apiKey, taskId);
}

async function runImageRequest(payloadJson: string): Promise<string> {
  const payload = JSON.parse(payloadJson) as Record<string, unknown>;
  const providerId = String(payload.provider_id || "grsai");
  const model = String(payload.model || "gpt-image-2").replace(/^(grsai|yunzhi|artlist)\//, "");
  const extraParams = (payload.extra_params || {}) as Record<string, unknown>;
  const rawBody = payload._raw_body as Record<string, unknown> | undefined;

  const baseUrl =
    baseUrls.get(providerId) ||
    (providerId === "artlist"
      ? `${SD2_BUILTIN_BASE_URL}/api`
      : providerId === "yunzhi" ? YUNZHI_BUILTIN_BASE_URL : GRSAI_BUILTIN_BASE_URL);
  const apiKey =
    apiKeys.get(providerId) ||
    (providerId === "artlist"
      ? getNextSd2Key()
      : providerId === "yunzhi" ? getNextYunzhiKey() : getNextGrsaiKey());

  if (providerId === "artlist") {
    return await runArtlistImageRequest(payload, model, baseUrl, apiKey);
  }

  const body = rawBody || {
    model,
    prompt: payload.prompt,
    n: payload.n ?? 1,
    response_format: "url",
    ...extraParams,
    ...(payload.size ? { size: payload.size } : {}),
  };

  const result = await requestJson(buildV1Url(baseUrl, "/images/generations"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  return extractImageResult(result);
}

function normalizeVideoSubmitPath(path?: string) {
  if (!path || path === "/v1/videos") return "/v1/video/generations";
  return path;
}

function normalizeVideoPollPath(path?: string) {
  if (!path || path === "/v1/videos") return "/v1/video/generations";
  return path;
}

async function pollRemoteVideo(job: VideoJob): Promise<VideoJob> {
  if (!job.remote) return job;
  if (job.remote.authStyle === "seedance-cloud" || job.remote.pollPath === SEEDANCE_CLOUD_POLL_PATH) {
    const apiBase = normalizeBaseUrl(job.remote.baseUrl, `${SD2_BUILTIN_BASE_URL}/api`);
    const payload = await requestJson(`${apiBase}/task/${encodeURIComponent(job.job_id)}`, {
      headers: { "X-License-Key": job.remote.apiKey },
    });
    const rawStatus = extractSeedanceStatus(payload);
    const progress = Number(
      (payload as Record<string, unknown>).progress ??
      getNested(payload, "data.progress") ??
      job.progress ??
      0,
    );
    const returnedVideoUrl = resolveSeedanceVideoUrl(extractVideoUrl(payload), apiBase, job.remote.apiKey);
    if (VIDEO_DONE.has(rawStatus)) {
      return {
        ...job,
        status: "succeeded",
        result: returnedVideoUrl || buildSeedanceVideoUrl(apiBase, job.job_id, job.remote.apiKey),
        progress: 100,
      };
    }
    if (VIDEO_FAIL.has(rawStatus)) {
      return {
        ...job,
        status: "failed",
        error: firstString(
          (payload as Record<string, unknown>).error_message,
          (payload as Record<string, unknown>).message,
          (payload as Record<string, unknown>).error,
          getNested(payload, "data.error"),
        ) || "视频生成失败",
        progress,
      };
    }
    return { ...job, status: "running", progress: Number.isFinite(progress) ? progress : job.progress ?? 0 };
  }
  const url = `${normalizeBaseUrl(job.remote.baseUrl, SD2_BUILTIN_BASE_URL)}${job.remote.pollPath}/${encodeURIComponent(job.job_id)}`;
  const payload = await requestJson(url, {
    headers: {
      Authorization: `Bearer ${job.remote.apiKey}`,
    },
  });
  const rawStatus = String(
    (payload as Record<string, unknown>).status ||
    getNested(payload, "data.status") ||
    getNested(payload, "data.state") ||
    "",
  ).toLowerCase();
  const progress = Number(
    (payload as Record<string, unknown>).progress ??
    getNested(payload, "data.progress") ??
    job.progress ??
    0,
  );
  const videoUrl = extractVideoUrl(payload);

  if (videoUrl || VIDEO_DONE.has(rawStatus)) {
    return { ...job, status: "succeeded", result: videoUrl || job.result || null, progress: 100 };
  }
  if (VIDEO_FAIL.has(rawStatus)) {
    return {
      ...job,
      status: "failed",
      error: firstString((payload as Record<string, unknown>).error, getNested(payload, "data.error")) || "视频生成失败",
      progress,
    };
  }
  return { ...job, status: "running", progress: Number.isFinite(progress) ? progress : job.progress ?? 0 };
}

export async function setApiKey(provider: string, key: string) {
  apiKeys.set(provider, key);
}

export async function getApiKey(provider: string) {
  return apiKeys.get(provider) || "";
}

export async function setBaseUrl(provider: string, url: string) {
  baseUrls.set(provider, url);
}

export async function getBaseUrl(provider: string) {
  return baseUrls.get(provider) || "";
}

export async function listModels() {
  return [
    "artlist/nano-banana",
    "artlist/nano-banana-pro",
    "artlist/seedream-5.0",
    "artlist/gpt-image-2",
    "grsai/gpt-image-2",
    "grsai/nano-banana-2",
    "yunzhi/gpt-image-2",
  ];
}

export async function registerCustomProvider(_config?: unknown) {
  return true;
}

export async function unregisterCustomProvider(_providerId?: string) {
  return true;
}

export async function generateImage(_provider: string, payloadJson: string) {
  return await runImageRequest(payloadJson);
}

export async function submitGenerateImageJob(payloadJson: string) {
  const jobId = makeId("img");
  imageJobs.set(jobId, { jobId, status: "running", progress: 8 });
  void runImageRequest(payloadJson)
    .then((result) => {
      imageJobs.set(jobId, { jobId, status: "succeeded", result, progress: 100 });
    })
    .catch((error: unknown) => {
      imageJobs.set(jobId, {
        jobId,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        progress: 100,
      });
    });
  return jobId;
}

export async function getGenerateImageJob(jobId: string) {
  return imageJobs.get(jobId) || { jobId, status: "running", progress: 0 };
}

export async function submitGenerateVideoJob(payloadJson: string) {
  const payload = JSON.parse(payloadJson) as Record<string, unknown>;
  const rawBody = typeof payload._raw_body === "string"
    ? JSON.parse(payload._raw_body)
    : (payload._raw_body || payload);
  const baseUrl = normalizeBaseUrl(String(payload.base_url || ""), SD2_BUILTIN_BASE_URL);
  const apiKey = String(payload.api_key || "") || getNextSd2Key();
  if (isSeedanceCloudVideoPayload(payload, rawBody as Record<string, unknown>, baseUrl)) {
    return await submitSeedanceCloudVideoJob(payload, rawBody as Record<string, unknown>, baseUrl, apiKey);
  }
  const submitPath = normalizeVideoSubmitPath(String(payload._submit_url_path || ""));
  const pollPath = normalizeVideoPollPath(String(payload._poll_url_path || ""));

  const response = await requestJson(`${baseUrl}${submitPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(rawBody),
  });
  const remoteId = extractTaskId(response);
  const directUrl = extractVideoUrl(response, String(payload._video_url_field || ""));
  const jobId = remoteId || makeId("video");
  const job: VideoJob = directUrl
    ? { job_id: jobId, status: "succeeded", result: directUrl, progress: 100 }
    : { job_id: jobId, status: "running", result: null, progress: 5, remote: { baseUrl, apiKey, pollPath } };
  videoJobs.set(jobId, job);
  return jobId;
}

export async function getGenerateVideoJob(jobId: string) {
  const job = videoJobs.get(jobId);
  if (!job) return { job_id: jobId, status: "running", result: null, progress: 0 };
  if (job.status === "running" && job.remote) {
    try {
      const next = await pollRemoteVideo(job);
      videoJobs.set(jobId, next);
      return next;
    } catch (error) {
      return {
        ...job,
        status: "running",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return job;
}

export async function chatCompletion(payload: {
  provider?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  maxTokens?: number;
}) {
  return await chatCompletionStream(payload, () => undefined);
}

export async function chatCompletionStream(
  payload: {
    provider?: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: { role: string; content: string }[];
    temperature?: number;
    maxTokens?: number;
    _raw_body?: Record<string, unknown>;
    _auth_header_style?: string;
  },
  onChunk: (delta: string) => void,
  signal?: AbortSignal,
) {
  const baseUrl = normalizeBaseUrl(payload.baseUrl, GRSAI_BUILTIN_CHAT_BASE_URL);
  const url = baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
  const body = payload._raw_body || {
    model: payload.model,
    messages: payload.messages,
    temperature: payload.temperature ?? 0.7,
    max_tokens: payload.maxTokens,
    stream: true,
  };
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${payload.apiKey || getNextGrsaiKey()}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw new Error((await response.text().catch(() => "")).slice(0, 500) || `HTTP ${response.status}`);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    onChunk(text);
    return text;
  }
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;
      try {
        const json = JSON.parse(trimmed.slice(6));
        const delta = json.choices?.[0]?.delta?.content || "";
        if (delta) {
          full += delta;
          onChunk(delta);
        }
      } catch {
        // ignore malformed chunks
      }
    }
  }
  return full;
}

export async function persistImageSource(source: string) {
  return source;
}

export async function prepareNodeImageSource(source: string, _maxPreviewDimension?: number) {
  const { width, height } = await getImageSize(source);
  return { path: source, previewPath: source, width, height };
}

export async function persistImageBinary(bytes: number[], extension = "png") {
  const mime = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : `image/${extension || "png"}`;
  return bytesToDataUrl(bytes, mime);
}

export async function persistVideoSource(source: string) {
  return source;
}

export async function persistVideoBinary(bytes: number[], extension = "mp4") {
  return bytesToDataUrl(bytes, `video/${extension || "mp4"}`);
}

export async function persistAudioSource(source: string) {
  return source;
}

export async function splitImageSource(source: string, rows: number, cols: number, lineThickness = 0) {
  void lineThickness;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = source;
  });
  const frameWidth = Math.floor(img.naturalWidth / cols);
  const frameHeight = Math.floor(img.naturalHeight / rows);
  const frames: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = frameWidth;
      canvas.height = frameHeight;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(img, col * frameWidth, row * frameHeight, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
      frames.push(canvas.toDataURL("image/png"));
    }
  }
  return frames;
}

export async function mergeStoryboardImages(payloadOrSources: {
  sources: string[];
  rows: number;
  cols: number;
  gap?: number;
  backgroundColor?: string;
} | string[], rowsArg?: number, colsArg?: number) {
  const payload = Array.isArray(payloadOrSources)
    ? { sources: payloadOrSources, rows: rowsArg || 1, cols: colsArg || payloadOrSources.length || 1 }
    : payloadOrSources;
  const images = await Promise.all(payload.sources.map((source) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = source;
  })));
  const first = images[0];
  const gap = payload.gap ?? 0;
  const cellWidth = first?.naturalWidth || 512;
  const cellHeight = first?.naturalHeight || 512;
  const canvas = document.createElement("canvas");
  canvas.width = payload.cols * cellWidth + Math.max(0, payload.cols - 1) * gap;
  canvas.height = payload.rows * cellHeight + Math.max(0, payload.rows - 1) * gap;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = payload.backgroundColor || "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    images.forEach((img, index) => {
      const col = index % payload.cols;
      const row = Math.floor(index / payload.cols);
      ctx.drawImage(img, col * (cellWidth + gap), row * (cellHeight + gap), cellWidth, cellHeight);
    });
  }
  return { path: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}

export async function cropImageSource(imageSource: string, x: number, y: number, width: number, height: number) {
  const [frame] = await splitImageSource(imageSource, 1, 1);
  void x; void y; void width; void height;
  return frame;
}

export async function saveImageToDownloads(imageSource: string, fileName = "image.png") {
  const link = document.createElement("a");
  link.href = imageSource;
  link.download = fileName;
  link.click();
}

export async function copyImageToClipboard(source: string) {
  await copyImageSourceToClipboard(source);
}

export async function copyImageSourceToClipboard(source: string) {
  const blob = await sourceToBlob(source);
  await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
}

export async function readStoryboardImageMetadata(_source?: string) {
  return null;
}

export async function embedStoryboardImageMetadata(source: string, _metadata?: unknown) {
  return source;
}

export async function extractVideoFrames(_videoPath?: string, _frameCount?: number, _mode?: string): Promise<Array<{ path: string; previewPath: string; timestampSecs: number }>> {
  throw new Error("网页版本暂不支持本地视频抽帧，请先用上传图片节点导入关键帧。");
}

export async function extractVideoFrameAtTimestamp(_videoPath?: string, _timestampSecs?: number, _outputWidth?: number): Promise<{ path: string; previewPath: string; width: number; height: number }> {
  throw new Error("网页版本暂不支持视频定点抽帧。");
}

export async function composeVideosSequential(_videoPaths?: string[], _outputDir?: string): Promise<string> {
  throw new Error("网页版本暂不支持本地视频合成。");
}

export async function trimVideo(_videoPath?: string, _startTime?: number, _endTime?: number): Promise<string> {
  throw new Error("网页版本暂不支持本地视频裁剪。");
}

export async function changeVideoSpeed(_videoPath?: string, _speed?: number): Promise<string> {
  throw new Error("网页版本暂不支持本地视频变速。");
}

export async function extractAudioFromVideo(_videoPath?: string): Promise<string> {
  throw new Error("网页版本暂不支持本地音频提取。");
}

export async function getVideoDuration(_videoPath?: string) {
  return 0;
}

export async function removeVideoWatermark(videoPath: string, ..._args: unknown[]) {
  return videoPath;
}

export async function removeVideoSubtitles(videoPath: string, ..._args: unknown[]) {
  return videoPath;
}

export async function upscaleVideo(videoPath: string, ..._args: unknown[]) {
  return videoPath;
}

export async function generateTts(_payload?: unknown) {
  throw new Error("网页版本暂未接入 TTS。");
}

export async function jimengSubmitVideo(_payload?: string): Promise<string> {
  throw new Error("网页版本暂不支持即梦官网自动化，请使用虾客漫 SD2 视频模型。");
}

export async function jimengGetVideoStatus(_jobId?: string) {
  return { job_id: "", status: "failed", result: null, error: "网页版本暂不支持即梦官网自动化", progress: 100 };
}

export async function jimengBrowserOpenLogin(_browserExe?: string) {
  return { status: "unsupported", message: "网页版本暂不支持浏览器自动化登录" };
}

export async function jimengBrowserGenerate(_params?: Record<string, unknown>) {
  return { event: "error", video_path: "", video_url: "" };
}

export async function jimengBrowserCheckEnv() {
  return { playwright_installed: false, browser_found: false, browser_path: null, python: "" };
}

export async function jimengBrowserInstall() {
  return { status: "unsupported", message: "网页版本不需要安装 Playwright" };
}

export async function checkForUpdate(_currentVersion: string) {
  return {
    version: "",
    notes: "网页版本由虾客漫主站统一更新。",
    pub_date: "",
    url: "",
    signature: "",
  };
}

export async function jimengSaveSessionid(sessionid: string) {
  localStorage.setItem("xiakeman-canvas-jimeng-sessionid", sessionid);
}

export async function jimengCheckSessionid() {
  return !!localStorage.getItem("xiakeman-canvas-jimeng-sessionid");
}

export async function jimengDeleteSessionid() {
  localStorage.removeItem("xiakeman-canvas-jimeng-sessionid");
}

export async function jimengLoginWindow() {
  throw new Error("网页画布暂不支持打开即梦桌面登录窗口，请手动粘贴 sessionid。");
}

export async function jimengPollSessionid() {
  return localStorage.getItem("xiakeman-canvas-jimeng-sessionid");
}

export async function authLogin(email: string, _password?: string) {
  return { id: 0, email, status: "local" };
}

export async function authRegister(email: string, _password?: string) {
  return { id: 0, email, status: "local" };
}

export async function authLogout() {
  return true;
}

export async function getAuthState() {
  return { authenticated: false, user: null, reason: "web-canvas" };
}

export async function exportProjectToFile(_projectId: string, _filePath: string) {
  return true;
}

export async function importProjectFromFile(_filePath: string) {
  return "";
}

export async function invokeCompat<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (command === "get_auth_token") return null as T;
  if (command === "credits_machine_id") return "web-canvas" as T;
  if (command === "credits_balance") return { balance: 999999 } as T;
  if (command === "credits_deduct") return { success: true } as T;
  if (command === "credits_refund") return { success: true, refunded: 0 } as T;
  if (command === "persist_image_source") return await persistImageSource(String(args?.source || "")) as T;
  if (command === "query_task_token") return await getGenerateImageJob(String(args?.jobId || "")) as T;
  if (command === "save_settings_json") return true as T;
  if (command === "load_settings_json") return null as T;
  throw new Error(`网页画布暂不支持桌面命令: ${command}`);
}
