import type { AiGateway, GenerateImagePayload, GenerationJobStatus } from "../ports";
import { resolvePixelDimensions } from "../models/image/types";
import {
  setApiKey as tauriSetApiKey,
  getApiKey as tauriGetApiKey,
  listModels as tauriListModels,
  submitGenerateImageJob as tauriSubmitJob,
  getGenerateImageJob as tauriGetJob,
  generateImage as tauriGenerateImage,
  setBaseUrl as tauriSetBaseUrl,
  getBaseUrl as tauriGetBaseUrl,
  registerCustomProvider as tauriRegisterCustomProvider,
} from "@/features/canvas/compat/commands";
import { useSettingsStore } from "@/features/canvas/stores/settingsStore";
import { invoke } from "@/features/canvas/compat/tauriCore";
import { getCreditsUserId } from "@/features/canvas/stores/creditsStore";
import { useCreditsStore } from "@/features/canvas/stores/creditsStore";
import { useToastStore } from "@/features/canvas/compat/Toast";
import { useAuthStore } from "@/features/canvas/stores/authStore";
import { getNextGrsaiKey, GRSAI_BUILTIN_BASE_URL } from "@/features/canvas/shared/grsaiKeys";
import { getNextYunzhiKey, YUNZHI_BUILTIN_BASE_URL } from "@/features/canvas/shared/yunzhiKeys";
import { getNextSd2Key, SD2_BUILTIN_BASE_URL } from "@/features/canvas/shared/sd2Keys";
import { IMAGE_CREDIT_PRICES } from "../application/creditPricing";

// ---------------------------------------------------------------------------
// Submission rate limiter — prevents bursts of concurrent API submissions
// from triggering 429 rate-limit errors. Only gates the SUBMIT phase (DB
// insert + return jobId), NOT the generation/poll phase (which is handled
// by backend semaphore). Without this, SceneNode's Promise.all could fire
// 6+ submissions in the same second, overwhelming the API.
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_SUBMISSIONS = 3;
let activeSubmissions = 0;
const submissionQueue: Array<() => void> = [];

function acquireSubmissionSlot(): Promise<void> {
  if (activeSubmissions < MAX_CONCURRENT_SUBMISSIONS) {
    activeSubmissions++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    submissionQueue.push(resolve);
  });
}

function releaseSubmissionSlot(): void {
  activeSubmissions--;
  if (submissionQueue.length > 0) {
    activeSubmissions++;
    const next = submissionQueue.shift()!;
    next();
  }
}

// ---------------------------------------------------------------------------
// Reference image normalization — convert ALL images to base64 data URLs
// so the backend can directly pass them to APIs like grsai
// ---------------------------------------------------------------------------

// NOTE: normalizeReferenceImages removed — Rust backend handles all URL types
// (asset://, file://, HTTP, data:) natively. Frontend normalization was silently
// dropping images on failure, causing referenceImages to never reach the API.

/** Sync provider config from settings store to Rust backend before generation */
async function syncProviderConfigToBackend(providerId: string): Promise<void> {
  if (!window.__TAURI__) return;
  const settings = useSettingsStore.getState();
  const creditsEnabledSync = (globalThis as any).__CREDITS_ENABLED === true;

  // When credits are enabled and this is a built-in provider (grsai, vjimeng),
  // the Rust backend already has the hardcoded API key — skip sync entirely.
  // Only custom providers need key syncing in credits mode.
  const BUILTIN_PROVIDER_IDS = ["grsai", "vjimeng", "vjimeng-sd2", "yunzhi"];
  if (creditsEnabledSync && BUILTIN_PROVIDER_IDS.includes(providerId)) {
    console.log("[tauriAiGateway] Credits mode — skipping API key sync for built-in provider:", providerId);
    return;
  }

  console.log("[tauriAiGateway] Syncing provider:", providerId, "Available providers:", settings.providers.map(p => ({ id: p.id, channel: p.channel, hasKey: !!p.apiKey })), "Custom:", settings.customProviders.map(p => ({ id: p.id, name: p.name, hasUrl: !!p.baseUrl, hasKey: !!p.apiKey })));

  // Strategy: find the provider that has the API key for this channel.
  // 1. Direct match with key: provider.id === providerId AND has apiKey (e.g. "grsai" with key)
  // 2. Channel-based match with key: provider.channel === providerId AND has apiKey
  // 3. Fallback: any provider matching id or channel (sync other config even without key)
  let foundInCustom = false;
  let provider = settings.providers.find(
    (p) => p.id === providerId && p.apiKey
  );
  if (!provider) {
    provider = settings.providers.find(
      (p) => p.channel === providerId && p.apiKey
    );
  }
  if (!provider) {
    provider = settings.providers.find(
      (p) => p.id === providerId || p.channel === providerId
    );
  }

  // Fall back to custom providers
  let customProvider: typeof settings.customProviders[0] | undefined;
  if (!provider) {
    customProvider = settings.customProviders.find(
      (p) => p.id === providerId
    );
    if (customProvider) foundInCustom = true;
  }

  if (!provider && !customProvider) {
    const allIds = settings.providers.map(p => ({ id: p.id, channel: p.channel, hasKey: !!p.apiKey, keyLen: p.apiKey?.length || 0 }));
    const customIds = settings.customProviders.map(p => ({ id: p.id, hasKey: !!p.apiKey }));
    console.error("[tauriAiGateway] Provider not found in settings:", providerId, "All providers:", allIds, "Custom:", customIds);
    // Check if this is a known channel that might exist under a different id
    const anyHasKey = settings.providers.some(p => p.apiKey);
    throw new Error(
      `Provider '${providerId}' not found in settings. ` +
      (anyHasKey
        ? `Available providers: ${settings.providers.filter(p => p.apiKey).map(p => p.id).join(", ")}. Please check the provider selector in the node.`
        : `No API keys configured at all. Please go to Settings → Image Models and enter your API key first.`
      )
    );
  }

  if (foundInCustom && customProvider) {
    // --- Custom Provider sync ---
    const targetId = customProvider.id;
    console.log("[tauriAiGateway] Syncing CUSTOM provider:", targetId, "hasKey:", !!customProvider.apiKey);

    if (!customProvider.apiKey) {
      throw new Error(
        `API key for custom provider '${customProvider.name}' (${targetId}) is empty. ` +
        `Please go to Settings and enter your API key.`
      );
    }

    try {
      // Register custom provider to Rust backend first (ensure it exists in ProviderRegistry)
      // This fixes "Provider 'custom-xxx' not found" when app restarts or registry loses the provider
      const models = customProvider.models
        ? customProvider.models.split(/[,，]/).map((m: string) => m.trim()).filter(Boolean)
        : ["custom-model"];
      const baseUrl = (customProvider.baseUrl || "").trim();
      console.log("[tauriAiGateway] About to register custom provider:", { id: targetId, name: customProvider.name, baseUrl, models, hasKey: !!customProvider.apiKey });
      if (!baseUrl) {
        throw new Error(
          `Custom provider '${customProvider.name}' (${targetId}) has no base URL configured. ` +
          `Please go to Settings and set the API endpoint URL.`
        );
      }
      await tauriRegisterCustomProvider({
        id: customProvider.id,
        name: customProvider.name,
        baseUrl,
        models,
      });
      console.log("[tauriAiGateway] Registered custom provider to backend:", targetId);

      // Sync API key
      await tauriSetApiKey(targetId, customProvider.apiKey);
      console.log("[tauriAiGateway] Synced custom API key to:", targetId);

      // Always sync base URL for custom providers (it's user-defined)
      if (customProvider.baseUrl) {
        await tauriSetBaseUrl(targetId, customProvider.baseUrl);
        console.log("[tauriAiGateway] Synced custom base URL for:", targetId);
      }

      // Verify
      const verifiedKey = await tauriGetApiKey(targetId);
      if (!verifiedKey) {
        console.error("[tauriAiGateway] CRITICAL: Custom API key verification FAILED for", targetId);
        throw new Error(`API key not stored for custom provider "${targetId}"`);
      }
      console.log("[tauriAiGateway] Custom API key verified for:", targetId);
    } catch (e) {
      console.error("[tauriAiGateway] Failed to sync custom provider:", e);
      throw e;
    }
    return;
  }

  if (!provider) {
    // This shouldn't happen — but just in case
    throw new Error(`Provider '${providerId}' not found in settings.`);
  }

  // Default URLs that should NOT be synced to Rust providers (would override built-in defaults)
  const DEFAULT_URLS = [
    "https://api.openai.com/v1",
    "https://api.siliconflow.cn/v1",
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "https://open.bigmodel.cn/api/paas/v1",
    "", // empty string is also a default
  ];

  // CRITICAL FIX: Always sync API key using the DIRECT provider ID as target.
  // The Rust ProviderRegistry uses provider.id() ("grsai") as the lookup key.
  // Old code used `provider.channel || provider.id` which could route keys to wrong targets.
  //
  // For direct providers like grsai (id="grsai", no channel), sync to "grsai".
  // For virtual providers like image-model (id="image-model", channel="grsai"),
  // we sync to BOTH "image-model" and "grsai" so both lookups work.
  const directTargetId = provider.id;      // e.g., "grsai" or "image-model"
  const channelTargetId = provider.channel; // e.g., undefined or "grsai"

  console.log("[tauriAiGateway] Syncing config - directTarget:", directTargetId, "channelTarget:", channelTargetId, "hasKey:", !!provider.apiKey, "keyLen:", provider.apiKey?.length || 0);

  // ── Credits mode fallback: when user hasn't configured an API key, use round-robin from key pools ──
  // This prevents overwriting the Rust backend's hardcoded key with an empty string,
  // which would cause "apikey error" and leave the frontend stuck in "generating" state.
  // Multiple keys are rotated in round-robin for load distribution across the key pool.
  const creditsEnabledKey = useSettingsStore.getState().creditsEnabled;
  let effectiveApiKey = provider.apiKey || "";
  let effectiveBaseUrl = provider.baseUrl || "";
  if (!effectiveApiKey && creditsEnabledKey && (directTargetId === "grsai" || channelTargetId === "grsai")) {
    effectiveApiKey = getNextGrsaiKey();
    console.log("[tauriAiGateway] Credits mode: using round-robin grsai key for", directTargetId);
  }
  if (!effectiveApiKey && creditsEnabledKey && (directTargetId === "yunzhi" || channelTargetId === "yunzhi")) {
    effectiveApiKey = getNextYunzhiKey();
    console.log("[tauriAiGateway] Credits mode: using round-robin yunzhi key for", directTargetId);
  }
  if (!effectiveApiKey && creditsEnabledKey && (directTargetId === "artlist" || channelTargetId === "artlist")) {
    effectiveApiKey = getNextSd2Key();
    effectiveBaseUrl = `${SD2_BUILTIN_BASE_URL}/api`;
    console.log("[tauriAiGateway] Credits mode: using round-robin sd2/artlist key for", directTargetId);
  }
  if (!effectiveApiKey && creditsEnabledKey && (directTargetId === "vjimeng-sd2" || channelTargetId === "vjimeng-sd2")) {
    effectiveApiKey = getNextSd2Key();
    effectiveBaseUrl = SD2_BUILTIN_BASE_URL;
    console.log("[tauriAiGateway] Credits mode: using round-robin sd2 key for", directTargetId);
  }
  if (!effectiveApiKey && creditsEnabledKey && (directTargetId === "image-model" || directTargetId === "video-model")) {
    effectiveApiKey = getNextGrsaiKey();
    console.log("[tauriAiGateway] Credits mode: using round-robin grsai key for virtual provider", directTargetId);
  }
  if (!effectiveBaseUrl && creditsEnabledKey && (directTargetId === "grsai" || channelTargetId === "grsai" || directTargetId === "image-model" || directTargetId === "video-model")) {
    effectiveBaseUrl = GRSAI_BUILTIN_BASE_URL;
  }
  if (!effectiveBaseUrl && creditsEnabledKey && (directTargetId === "yunzhi" || channelTargetId === "yunzhi")) {
    effectiveBaseUrl = YUNZHI_BUILTIN_BASE_URL;
  }
  if (!effectiveBaseUrl && creditsEnabledKey && (directTargetId === "artlist" || channelTargetId === "artlist")) {
    effectiveBaseUrl = `${SD2_BUILTIN_BASE_URL}/api`;
  }

  if (!effectiveApiKey) {
    // No key at all (even after fallback) — fail fast with a clear message
    const providerLabel = directTargetId === "grsai" ? "GRSAI" : directTargetId;
    console.error("[tauriAiGateway] Provider found but API key is empty for:", directTargetId, "All providers:", settings.providers.map(p => ({ id: p.id, keyLen: p.apiKey?.length || 0 })));
    throw new Error(
      `API key for '${providerLabel}' (${directTargetId}) is empty. ` +
      `Please go to Settings → Image Models and enter your ${providerLabel} API key.`
    );
  }

  try {
    // Always sync to the direct provider ID first (this matches Rust's ProviderRegistry key)
    await tauriSetApiKey(directTargetId, effectiveApiKey);
    console.log("[tauriAiGateway] Synced API key to direct target:", directTargetId);

    // Also sync to channel ID if it differs (for virtual → channel fallback)
    if (channelTargetId && channelTargetId !== directTargetId) {
      await tauriSetApiKey(channelTargetId, effectiveApiKey);
      console.log("[tauriAiGateway] Synced API key to channel target:", channelTargetId);
    }

    // Verify by reading back from the primary Rust registry key
    const verifyTargetId = channelTargetId || directTargetId;
    const verifiedKey = await tauriGetApiKey(verifyTargetId);
    if (!verifiedKey) {
      console.error("[tauriAiGateway] CRITICAL: API key verification FAILED for", verifyTargetId, "- key was not persisted!");
      throw new Error(`API key not stored for "${verifyTargetId}" — check that the provider exists in Rust registry`);
    }
    console.log("[tauriAiGateway] API key verified for:", verifyTargetId, "length:", (verifiedKey as string).length);
  } catch (e) {
    console.error("[tauriAiGateway] Failed to sync API key:", e);
    throw e;
  }

  // Only sync baseUrl if it's a user-configured non-default value.
  // Virtual providers (image-model, video-model, etc.) often have default baseUrl
  // from openai-compatible, which would WRONGFULLY override the Rust provider's default.
  // Rust providers (grsai, geeknow, etc.) have correct built-in default URLs.
  const isDefaultUrl = !provider.baseUrl || DEFAULT_URLS.includes(provider.baseUrl);
  if (!isDefaultUrl && provider.baseUrl) {
    try {
      await tauriSetBaseUrl(directTargetId, provider.baseUrl);
      if (channelTargetId && channelTargetId !== directTargetId) {
        await tauriSetBaseUrl(channelTargetId, provider.baseUrl);
      }
      console.log("[tauriAiGateway] Synced base URL for:", directTargetId);
    } catch (e) {
      console.error("[tauriAiGateway] Failed to sync base URL:", e);
    }
  } else {
    console.log("[tauriAiGateway] Skipping baseUrl sync (default/empty)");
  }
}

function buildPayloadJson(payload: GenerateImagePayload): string {
  const { width, height } = resolvePixelDimensions(
    payload.size,
    payload.aspectRatio
  );

  const [providerId, ...modelParts] = payload.model.split("/");
  const model = modelParts.join("/") || payload.model;

  const isCustomProvider = providerId !== "grsai" && providerId !== "artlist" && providerId !== "vjimeng" && providerId !== "yunzhi";
  const isYunzhi = providerId === "yunzhi";
  const isArtlist = providerId === "artlist";

  const request: Record<string, unknown> = {
    provider_id: providerId,
    model,
    prompt: payload.prompt,
    size: `${width}x${height}`,
    n: 1,
  };

  // Negative prompt — industry standard parameter (ComfyUI, Leonardo, etc.)
  if (payload.negativePrompt && payload.negativePrompt.trim()) {
    request.negative_prompt = payload.negativePrompt.trim();
  }

  // Seed — for reproducible generation (ComfyUI KSampler, Leonardo, etc.)
  if (payload.seed !== undefined && payload.seed !== null) {
    request.seed = payload.seed;
  }

  if (payload.extraParams) {
    request.extra_params = payload.extraParams;
  }

  // ── Custom provider: use _raw_body passthrough (skip grsai routing) ──
  if (isCustomProvider) {
    const rawBody: Record<string, unknown> = {
      model,
      prompt: payload.prompt,
      n: 1,
    };
    // size (OpenAI format: "WxH")
    if (payload.size && String(payload.size) !== "auto") {
      rawBody.size = `${width}x${height}`;
    }
    // quality
    rawBody.response_format = "url";
    // aspect ratio for APIs that support it
    rawBody.aspect_ratio = payload.aspectRatio || "1:1";
    // reference images
    if (payload.referenceImages && payload.referenceImages.length > 0) {
      rawBody.image = payload.referenceImages;
      rawBody.reference_images = payload.referenceImages;
    }
    // extra params merge
    if (payload.extraParams) {
      Object.assign(rawBody, payload.extraParams);
    }
    // negative prompt
    if (payload.negativePrompt && payload.negativePrompt.trim()) {
      rawBody.negative_prompt = payload.negativePrompt.trim();
    }
    if (payload.seed !== undefined && payload.seed !== null) {
      rawBody.seed = payload.seed;
    }

    request._raw_body = rawBody;
    // Smart auth detection done in Rust
    console.log("[tauriAiGateway] Custom provider => _raw_body mode, provider=", providerId);
    return JSON.stringify(request);
  }

  // ── grsai provider: legacy routing (unchanged) ──
  const extraParams = (request.extra_params as Record<string, unknown>) || {};

    // For grsai provider, pass aspectRatio and/or imageSize in extra_params
    // Also pass `image` field for gpt-image-2 models (grsai /v1/images/generations API spec)
    // - gpt-image-2: supports aspectRatio string ("16:9") + image (array of refs)
    // - gpt-image-2-vip: requires pixel values in size + image (array of refs)
    // - other models: use aspectRatio string + imageSize tier ("1K"/"2K"/"4K")
    // IMPORTANT: each provider block cleans up fields from other providers to avoid cross-contamination
    if (providerId === "grsai") {
      if (model === "gpt-image-2" || model === "gpt-image-2-1k") {
        extraParams.aspectRatio = payload.aspectRatio || "1:1";
        extraParams.imageSize = payload.size || "1K";
        if (payload.referenceImages && payload.referenceImages.length > 0) {
          extraParams.image = payload.referenceImages;
        }
      } else if (model === "gpt-image-2-vip" || model === "gpt-image-2-vip-artsapi") {
        extraParams.aspectRatio = payload.aspectRatio || "1:1";
        extraParams.imageSize = payload.size || "1K";
        if (payload.referenceImages && payload.referenceImages.length > 0) {
          extraParams.image = payload.referenceImages;
        }
      } else {
        extraParams.aspectRatio = payload.aspectRatio || "1:1";
        extraParams.imageSize = payload.size || "1K";
      }
    }

    // ── yunzhi (云智) provider: OpenAI-compatible format ──
    // 云智 uses /v1/images/generations with aspectRatio string + image refs
    if (isYunzhi) {
      extraParams.aspectRatio = payload.aspectRatio || "1:1";
      extraParams.imageSize = payload.size || "1K";
      if (payload.referenceImages && payload.referenceImages.length > 0) {
        extraParams.image = payload.referenceImages;
      }
    }

    // ── XiaKeMan first-party image API (/api/generate-image) ──
    if (isArtlist) {
      extraParams.aspectRatio = payload.aspectRatio || "1:1";
      extraParams.imageSize = payload.size || "1K";
      if (payload.referenceImages && payload.referenceImages.length > 0) {
        extraParams.image = payload.referenceImages;
      }
    }

  // Always pass reference images in extra_params so backend providers can access them
  if (payload.referenceImages && payload.referenceImages.length > 0) {
    extraParams.referenceImages = payload.referenceImages;
    console.log("[tauriAiGateway] Including referenceImages in extra_params, count:", payload.referenceImages.length);
  } else {
    console.log("[tauriAiGateway] NO reference images in payload! payload.referenceImages =", payload.referenceImages);
  }
  request.extra_params = extraParams;

  // Don't log full JSON — it may contain huge base64 data URLs
  console.log("[tauriAiGateway] Payload: provider_id=", request.provider_id, "model=", model, "extra_params keys=", Object.keys(extraParams));
  const refImages = extraParams.referenceImages as string[] | undefined;
  console.log("[tauriAiGateway] referenceImages in extra_params:", refImages ? `count=${refImages.length}, first=${refImages[0]?.slice(0, 100)}` : "UNDEFINED");
  return JSON.stringify(request);
}

// ---------------------------------------------------------------------------
// Tauri AI Gateway implementation
// ---------------------------------------------------------------------------

export const tauriAiGateway: AiGateway = {
  async setApiKey(provider: string, key: string): Promise<void> {
    await tauriSetApiKey(provider, key);
  },

  async getApiKey(provider: string): Promise<string> {
    try {
      return String(await tauriGetApiKey(provider));
    } catch (e) {
      console.error("[AI网关] 获取 API Key 失败:", e);
      return "";
    }
  },

  async setBaseUrl(provider: string, url: string): Promise<void> {
    await tauriSetBaseUrl(provider, url);
  },

  async getBaseUrl(provider: string): Promise<string> {
    try {
      return String(await tauriGetBaseUrl(provider));
    } catch (e) {
      console.error("[AI网关] 获取 Base URL 失败:", e);
      return "";
    }
  },

  async listModels(): Promise<string[]> {
    const result = await tauriListModels();
    return result as string[];
  },

  async submitGenerateImageJob(
    payload: GenerateImagePayload
  ): Promise<string> {
    await acquireSubmissionSlot();
    try {
    console.log("[tauriAiGateway] submitGenerateImageJob:", {
      model: payload.model,
      aspectRatio: payload.aspectRatio,
      size: payload.size,
      referenceImageCount: payload.referenceImages?.length || 0,
      referenceImagesDefined: payload.referenceImages !== undefined,
      referenceImagesType: typeof payload.referenceImages,
      firstImagePreview: payload.referenceImages?.[0]?.slice(0, 80),
    });

    // ── 统一积分扣费（所有节点共用） ──
    // 在 gateway 层统一处理积分，避免各节点遗漏
    const [providerId, ...modelParts] = payload.model.split("/");
    const modelId = modelParts.join("/") || "gpt-image-2";
    const settings = useSettingsStore.getState();
    const creditsEnabled = settings.creditsEnabled;
    const isCustomProvider = providerId?.startsWith("custom-") ?? false;
    const shouldUseCredits = creditsEnabled && !isCustomProvider;

    console.log("[tauriAiGateway] credits check:", { providerId, modelId, creditsEnabled, isCustomProvider, shouldUseCredits });

    // Prepare payload (sync provider config + build JSON)
    const payloadWithImages = {
      ...payload,
      referenceImages: payload.referenceImages,
    };
    if (providerId) {
      await syncProviderConfigToBackend(providerId);
    }
    const json = buildPayloadJson(payloadWithImages);

    if (shouldUseCredits) {
      // ── 云智图片通道：按张扣费（0.3元/张=30分/张） ──
      const isYunzhiImage = providerId === "yunzhi";
      if (isYunzhiImage) {
        const pricePerImage = IMAGE_CREDIT_PRICES[modelId] || 30;
        const userId: string = await getCreditsUserId();
        const auth = useAuthStore.getState();
        const userEmail = auth.user?.email || userId;
        let tok: string | null = null;
        try { tok = await invoke<string | null>("get_auth_token"); } catch {}

        const balance = useCreditsStore.getState().balance;
        if (balance !== null && balance < pricePerImage) {
          useToastStore.getState().addToast("error", `余额不足！当前余额 ${(balance / 100).toFixed(2)} 元，生成一张图片需要 ${(pricePerImage / 100).toFixed(2)} 元`);
          throw new Error("余额不足，无法生成图片");
        }

        try {
          const deductRes: any = await invoke("credits_deduct", {
            machineId: userEmail,
            amount: pricePerImage,
            provider: providerId,
            model: modelId,
            mode: "image",
            duration: "1",
            jobId: null,
            token: tok,
          });
          if (!deductRes.success) {
            const errMsg = deductRes.error || "余额不足，无法生成图片";
            useToastStore.getState().addToast("error", errMsg);
            throw new Error(errMsg);
          }
          useCreditsStore.getState().deductCredits(pricePerImage);
          console.log("[tauriAiGateway] 云智图片扣费成功:", pricePerImage, "分");
        } catch (e) {
          console.error("[tauriAiGateway] 云智图片扣费失败:", e);
          throw e;
        }
      }

      // ── 其他内置通道：图片不再扣积分，直接提交 ──
      let jobId = "";
      try {
        console.log("[tauriAiGateway] JSON payload size:", json.length, "chars");
        jobId = String(await tauriSubmitJob(json));
        console.log("[tauriAiGateway] Job submitted, jobId:", jobId);
      } catch (submitErr) {
        console.error("[tauriAiGateway] Job submission failed:", submitErr);
        throw submitErr;
      }
      return jobId;
    }

    // 非积分模式（自定义通道或免费版）— 直接提交
    console.log("[tauriAiGateway] JSON payload size:", json.length, "chars");
    return String(await tauriSubmitJob(json));
    } finally {
    releaseSubmissionSlot();
    }
  },

  async getGenerateImageJob(jobId: string): Promise<GenerationJobStatus> {
    const result = await tauriGetJob(jobId);
    return result as GenerationJobStatus;
  },

  /** Query task status via remote Task Token API (survives local DB loss) */
  async queryTaskToken(jobId: string): Promise<GenerationJobStatus> {
    const result = await invoke<GenerationJobStatus>("query_task_token", { jobId });
    return result;
  },

  /** Refund credits for a failed image generation job */
  async refundImageCredits(jobId: string, provider?: string): Promise<void> {
    try {
      const userId: string = await getCreditsUserId();
      const token: string | null = await invoke<string | null>("get_auth_token");
      const refundProvider = provider || "grsai";
      console.log("[tauriAiGateway] refundImageCredits START:", { jobId, provider: refundProvider });
      const refundResult: any = await invoke("credits_refund", {
        machineId: userId,
        jobId: jobId || "",
        provider: refundProvider,
        reason: "生成失败",
        token,
      });
      console.log("[tauriAiGateway] refund result:", JSON.stringify(refundResult));

      // ── 检查服务端是否真的退费成功 ──
      if (!refundResult || (refundResult.success === false) || (refundResult.refunded !== undefined && refundResult.refunded <= 0)) {
        const errMsg = refundResult?.error || (refundResult ? JSON.stringify(refundResult) : "无响应");
        console.error("[tauriAiGateway] refund FAILED by server:", errMsg);
        useToastStore.getState().addToast("error", `⚠️ 退款失败！(${errMsg}) 请联系客服处理`);
        return;
      }

      // ── 退费后验证余额合理性，防止服务端返回异常高余额 ──
      const preRefundBalance = useCreditsStore.getState().balance;
      const refundedAmount = refundResult.refunded ?? 0;
      // 理论最大余额 = 退款前余额 + 退款金额
      const maxExpectedBalance = (preRefundBalance ?? 0) + refundedAmount;
      console.log("[tauriAiGateway] refund verify: preBalance=", preRefundBalance, "refunded=", refundedAmount, "maxExpected=", maxExpectedBalance);
      
      // 先本地恢复余额（不依赖服务端fetchBalance）
      useCreditsStore.getState().deductCredits(-refundedAmount);
      // 设置预期余额上限，防止服务端返回异常值
      useCreditsStore.getState().setExpectedBalanceForRefund(maxExpectedBalance);
      await useCreditsStore.getState().fetchBalance();
      
      // 验证：如果服务端返回的余额超过理论最大值，可能服务端有bug
      const postBalance = useCreditsStore.getState().balance;
      if (postBalance !== null && postBalance > maxExpectedBalance + 100) {
        console.error("[tauriAiGateway] ⚠️ ABNORMAL: server returned", postBalance, "but max expected", maxExpectedBalance);
        useToastStore.getState().addToast("error", `⚠️ 余额异常恢复！已自动修正，请联系客服。`);
        // 强制修正为理论最大值
        useCreditsStore.getState().forceSetBalance(maxExpectedBalance);
      }
      useToastStore.getState().addToast("success", "生成失败，已退还余额");
    } catch (e) {
      console.error("[tauriAiGateway] refundImageCredits FAILED:", e);
      useToastStore.getState().addToast("error", `❌ 退余额异常: ${e}，请联系客服`);
    }
  },

  async generateImage(
    provider: string,
    payload: GenerateImagePayload
  ): Promise<string> {
    await acquireSubmissionSlot();
    try {
    // Skip frontend normalization — pass raw URLs directly to Rust backend
    const payloadWithImages = {
      ...payload,
      referenceImages: payload.referenceImages,
    };

    // Ensure provider config is synced to backend before generation
    const [providerId] = payload.model.split("/");
    if (providerId) {
      await syncProviderConfigToBackend(providerId);
    }

    const json = buildPayloadJson(payloadWithImages);
    return String(await tauriGenerateImage(provider, json));
    } finally {
    releaseSubmissionSlot();
    }
  },
};



