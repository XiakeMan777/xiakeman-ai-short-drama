import type { ImageModelDefinition, AspectRatioOption } from "./image/types";
import type { ModelProviderDefinition } from "./providers/openai_compatible";

// ---------------------------------------------------------------------------
// All available providers
// ---------------------------------------------------------------------------

const PROVIDER_DEFINITIONS: ModelProviderDefinition[] = [
  {
    id: "grsai",
    displayName: "虾客漫图像",
    description: "虾客漫 AI 图像生成通道",
    enabledByDefault: true,
    defaultBaseUrl: "https://grsaiapi.com",
    registerUrl: "https://www.grsai.com",
    getKeyUrl: "https://api.grsai.com",
    authHeaderFormat: "Bearer",
  },
  {
    id: "yunzhi",
    displayName: "虾客漫图像",
    description: "虾客漫云智 AI 图像生成通道",
    enabledByDefault: true,
    defaultBaseUrl: "https://aiyunzhi.top",
    registerUrl: "https://aiyunzhi.top",
    getKeyUrl: "https://aiyunzhi.top",
    authHeaderFormat: "Bearer",
  },
  {
    id: "artlist",
    displayName: "虾客漫自有图片",
    description: "虾客漫 SD2 主站图片生成通道",
    enabledByDefault: true,
    defaultBaseUrl: "https://sd2.xiakeman.com/api",
    registerUrl: "https://sd2.xiakeman.com",
    getKeyUrl: "https://sd2.xiakeman.com",
    authHeaderFormat: "Key",
  },
];

// ---------------------------------------------------------------------------
// All available models
// ---------------------------------------------------------------------------

const XIAKEMAN_ARTLIST_ASPECT_RATIOS: AspectRatioOption[] = [
  { label: "1:1", value: "1:1", widthRatio: 1, heightRatio: 1 },
  { label: "16:9", value: "16:9", widthRatio: 16, heightRatio: 9 },
  { label: "9:16", value: "9:16", widthRatio: 9, heightRatio: 16 },
  { label: "4:3", value: "4:3", widthRatio: 4, heightRatio: 3 },
  { label: "3:4", value: "3:4", widthRatio: 3, heightRatio: 4 },
  { label: "3:2", value: "3:2", widthRatio: 3, heightRatio: 2 },
  { label: "2:3", value: "2:3", widthRatio: 2, heightRatio: 3 },
  { label: "5:4", value: "5:4", widthRatio: 5, heightRatio: 4 },
  { label: "4:5", value: "4:5", widthRatio: 4, heightRatio: 5 },
  { label: "21:9", value: "21:9", widthRatio: 21, heightRatio: 9 },
];

const MODEL_DEFINITIONS: ImageModelDefinition[] = [
  // XiaKeMan first-party Artlist image API
  {
    id: "artlist/nano-banana",
    displayName: "Nano Banana",
    providerId: "artlist",
    supportedSizes: ["1K", "2K", "4K"],
    defaultSize: "1K",
    supportedAspectRatios: XIAKEMAN_ARTLIST_ASPECT_RATIOS,
    defaultAspectRatio: "1:1",
    supportsImageToImage: true,
    maxReferenceImages: 14,
    extraParamsSchema: [],
    expectedDurationMs: 120000,
    resolveRequest: () => ({
      requestModel: "nano-banana",
      modeLabel: "虾客漫自有图片",
    }),
  },
  {
    id: "artlist/nano-banana-pro",
    displayName: "Nano Banana Pro",
    providerId: "artlist",
    supportedSizes: ["1K", "2K"],
    defaultSize: "1K",
    supportedAspectRatios: XIAKEMAN_ARTLIST_ASPECT_RATIOS,
    defaultAspectRatio: "1:1",
    supportsImageToImage: true,
    maxReferenceImages: 14,
    extraParamsSchema: [],
    expectedDurationMs: 150000,
    resolveRequest: () => ({
      requestModel: "nano-banana-pro",
      modeLabel: "虾客漫自有图片",
    }),
  },
  {
    id: "artlist/seedream-5.0",
    displayName: "Seedream 5.0",
    providerId: "artlist",
    supportedSizes: ["2K", "4K"],
    defaultSize: "2K",
    supportedAspectRatios: XIAKEMAN_ARTLIST_ASPECT_RATIOS,
    defaultAspectRatio: "1:1",
    supportsImageToImage: true,
    maxReferenceImages: 14,
    extraParamsSchema: [],
    expectedDurationMs: 150000,
    resolveRequest: () => ({
      requestModel: "seedream-5.0",
      modeLabel: "虾客漫自有图片",
    }),
  },
  {
    id: "artlist/gpt-image-2",
    displayName: "GPT Image 2",
    providerId: "artlist",
    supportedSizes: ["1K", "2K"],
    defaultSize: "1K",
    supportedAspectRatios: XIAKEMAN_ARTLIST_ASPECT_RATIOS,
    defaultAspectRatio: "1:1",
    supportsImageToImage: true,
    maxReferenceImages: 14,
    extraParamsSchema: [],
    expectedDurationMs: 150000,
    resolveRequest: () => ({
      requestModel: "gpt-image-2",
      modeLabel: "虾客漫自有图片",
    }),
  },
  // grsai models
  {
    id: "grsai/gpt-image-2",
    displayName: "GPT Image 2",
    providerId: "grsai",
    supportedSizes: ["1K"],
    defaultSize: "1K",
    supportedAspectRatios: [
      { label: "1:1", value: "1:1", widthRatio: 1, heightRatio: 1 },
      { label: "16:9", value: "16:9", widthRatio: 16, heightRatio: 9 },
      { label: "9:16", value: "9:16", widthRatio: 9, heightRatio: 16 },
      { label: "4:3", value: "4:3", widthRatio: 4, heightRatio: 3 },
      { label: "3:4", value: "3:4", widthRatio: 3, heightRatio: 4 },
      { label: "3:2", value: "3:2", widthRatio: 3, heightRatio: 2 },
      { label: "2:3", value: "2:3", widthRatio: 2, heightRatio: 3 },
      { label: "5:4", value: "5:4", widthRatio: 5, heightRatio: 4 },
      { label: "4:5", value: "4:5", widthRatio: 4, heightRatio: 5 },
      { label: "21:9", value: "21:9", widthRatio: 21, heightRatio: 9 },
      { label: "9:21", value: "9:21", widthRatio: 9, heightRatio: 21 },
      { label: "1:2", value: "1:2", widthRatio: 1, heightRatio: 2 },
      { label: "2:1", value: "2:1", widthRatio: 2, heightRatio: 1 },
    ],
    defaultAspectRatio: "1:1",
    supportsImageToImage: true,
    maxReferenceImages: 5,
    extraParamsSchema: [],
    expectedDurationMs: 90000,
    resolveRequest: () => {
      return {
        requestModel: "gpt-image-2",
        modeLabel: "标准 (虾客漫通道)",
      };
    },
  },
  {
    id: "grsai/gpt-image-2-vip",
    displayName: "GPT Image 2 VIP",
    providerId: "grsai",
    supportedSizes: ["1K", "2K", "4K"],
    defaultSize: "1K",
    supportedAspectRatios: [
      { label: "1:1", value: "1:1", widthRatio: 1, heightRatio: 1 },
      { label: "16:9", value: "16:9", widthRatio: 16, heightRatio: 9 },
      { label: "9:16", value: "9:16", widthRatio: 9, heightRatio: 16 },
      { label: "4:3", value: "4:3", widthRatio: 4, heightRatio: 3 },
      { label: "3:4", value: "3:4", widthRatio: 3, heightRatio: 4 },
      { label: "3:2", value: "3:2", widthRatio: 3, heightRatio: 2 },
      { label: "2:3", value: "2:3", widthRatio: 2, heightRatio: 3 },
      { label: "5:4", value: "5:4", widthRatio: 5, heightRatio: 4 },
      { label: "4:5", value: "4:5", widthRatio: 4, heightRatio: 5 },
      { label: "21:9", value: "21:9", widthRatio: 21, heightRatio: 9 },
      { label: "9:21", value: "9:21", widthRatio: 9, heightRatio: 21 },
      { label: "1:3", value: "1:3", widthRatio: 1, heightRatio: 3 },
      { label: "3:1", value: "3:1", widthRatio: 3, heightRatio: 1 },
      { label: "2:1", value: "2:1", widthRatio: 2, heightRatio: 1 },
      { label: "1:2", value: "1:2", widthRatio: 1, heightRatio: 2 },
    ],
    defaultAspectRatio: "1:1",
    supportsImageToImage: true,
    maxReferenceImages: 5,
    extraParamsSchema: [],
    expectedDurationMs: 90000,
    resolveRequest: () => {
      return {
        requestModel: "gpt-image-2-vip",
        modeLabel: "VIP (虾客漫通道)",
      };
    },
  },
  // grsai nano-banana models (only user-facing models kept)
  {
    id: "grsai/nano-banana-2",
    displayName: "Nano Banana 2",
    providerId: "grsai",
    supportedSizes: ["1K", "2K", "4K"],
    defaultSize: "1K",
    supportedAspectRatios: [
      { label: "Auto", value: "auto", widthRatio: 1, heightRatio: 1 },
      { label: "1:1", value: "1:1", widthRatio: 1, heightRatio: 1 },
      { label: "16:9", value: "16:9", widthRatio: 16, heightRatio: 9 },
      { label: "9:16", value: "9:16", widthRatio: 9, heightRatio: 16 },
      { label: "4:3", value: "4:3", widthRatio: 4, heightRatio: 3 },
      { label: "3:4", value: "3:4", widthRatio: 3, heightRatio: 4 },
      { label: "3:2", value: "3:2", widthRatio: 3, heightRatio: 2 },
      { label: "2:3", value: "2:3", widthRatio: 2, heightRatio: 3 },
      { label: "5:4", value: "5:4", widthRatio: 5, heightRatio: 4 },
      { label: "4:5", value: "4:5", widthRatio: 4, heightRatio: 5 },
      { label: "21:9", value: "21:9", widthRatio: 21, heightRatio: 9 },
      { label: "1:4", value: "1:4", widthRatio: 1, heightRatio: 4 },
      { label: "4:1", value: "4:1", widthRatio: 4, heightRatio: 1 },
      { label: "1:8", value: "1:8", widthRatio: 1, heightRatio: 8 },
      { label: "8:1", value: "8:1", widthRatio: 8, heightRatio: 1 },
    ],
    defaultAspectRatio: "1:1",
    supportsImageToImage: true,
    maxReferenceImages: 5,
    extraParamsSchema: [],
    expectedDurationMs: 90000,
    resolveRequest: () => ({
      requestModel: "nano-banana-2",
      modeLabel: "生成模式",
    }),
  },
  {
    id: "grsai/nano-banana-pro",
    displayName: "Nano Banana Pro",
    providerId: "grsai",
    supportedSizes: ["1K", "2K", "4K"],
    defaultSize: "1K",
    supportedAspectRatios: [
      { label: "Auto", value: "auto", widthRatio: 1, heightRatio: 1 },
      { label: "1:1", value: "1:1", widthRatio: 1, heightRatio: 1 },
      { label: "16:9", value: "16:9", widthRatio: 16, heightRatio: 9 },
      { label: "9:16", value: "9:16", widthRatio: 9, heightRatio: 16 },
      { label: "4:3", value: "4:3", widthRatio: 4, heightRatio: 3 },
      { label: "3:4", value: "3:4", widthRatio: 3, heightRatio: 4 },
      { label: "3:2", value: "3:2", widthRatio: 3, heightRatio: 2 },
      { label: "2:3", value: "2:3", widthRatio: 2, heightRatio: 3 },
      { label: "5:4", value: "5:4", widthRatio: 5, heightRatio: 4 },
      { label: "4:5", value: "4:5", widthRatio: 4, heightRatio: 5 },
      { label: "21:9", value: "21:9", widthRatio: 21, heightRatio: 9 },
    ],
    defaultAspectRatio: "1:1",
    supportsImageToImage: true,
    maxReferenceImages: 5,
    extraParamsSchema: [],
    expectedDurationMs: 90000,
    resolveRequest: () => ({
      requestModel: "nano-banana-pro",
      modeLabel: "生成模式",
    }),
  },
  // yunzhi (云智) models
  {
    id: "yunzhi/gpt-image-2",
    displayName: "GPT Image 2",
    providerId: "yunzhi",
    supportedSizes: ["1K"],
    defaultSize: "1K",
    supportedAspectRatios: [
      { label: "1:1", value: "1:1", widthRatio: 1, heightRatio: 1 },
      { label: "16:9", value: "16:9", widthRatio: 16, heightRatio: 9 },
      { label: "9:16", value: "9:16", widthRatio: 9, heightRatio: 16 },
      { label: "4:3", value: "4:3", widthRatio: 4, heightRatio: 3 },
      { label: "3:4", value: "3:4", widthRatio: 3, heightRatio: 4 },
      { label: "3:2", value: "3:2", widthRatio: 3, heightRatio: 2 },
      { label: "2:3", value: "2:3", widthRatio: 2, heightRatio: 3 },
      { label: "5:4", value: "5:4", widthRatio: 5, heightRatio: 4 },
      { label: "4:5", value: "4:5", widthRatio: 4, heightRatio: 5 },
      { label: "21:9", value: "21:9", widthRatio: 21, heightRatio: 9 },
      { label: "9:21", value: "9:21", widthRatio: 9, heightRatio: 21 },
    ],
    defaultAspectRatio: "1:1",
    supportsImageToImage: true,
    maxReferenceImages: 5,
    extraParamsSchema: [],
    expectedDurationMs: 90000,
    resolveRequest: () => ({
      requestModel: "gpt-image-2",
      modeLabel: "云智通道",
    }),
  },
];

// ---------------------------------------------------------------------------
// Registry API
// ---------------------------------------------------------------------------

/** Default model ID */
export const DEFAULT_MODEL_ID = "artlist/nano-banana";

/** Get all provider definitions */
export function getAllProviders(): ModelProviderDefinition[] {
  return PROVIDER_DEFINITIONS;
}

/** Get a provider by ID */
export function getProviderById(id: string): ModelProviderDefinition | undefined {
  return PROVIDER_DEFINITIONS.find((p) => p.id === id);
}

/** Get all model definitions */
export function getAllModels(): ImageModelDefinition[] {
  return MODEL_DEFINITIONS;
}

/** Get models for a specific provider */
export function getModelsByProvider(providerId: string): ImageModelDefinition[] {
  return MODEL_DEFINITIONS.filter((m) => m.providerId === providerId);
}

/** Get a model by its full ID (e.g. "openai-compatible/dall-e-3") */
export function getModelById(modelId: string): ImageModelDefinition | undefined {
  return MODEL_DEFINITIONS.find((m) => m.id === modelId);
}

/** Resolve a model ID string that may be a short name or full ID */
export function resolveModelId(modelId: string): ImageModelDefinition | undefined {
  // Try direct match
  const direct = getModelById(modelId);
  if (direct) return direct;

  // Try matching by short model name across all providers
  return MODEL_DEFINITIONS.find((m) => {
    const parts = m.id.split("/");
    return parts.length === 2 && parts[1] === modelId;
  });
}

/** Get models grouped by provider */
export function getModelsGroupedByProvider(): Record<string, ImageModelDefinition[]> {
  const groups: Record<string, ImageModelDefinition[]> = {};
  for (const model of MODEL_DEFINITIONS) {
    if (!groups[model.providerId]) {
      groups[model.providerId] = [];
    }
    groups[model.providerId].push(model);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Fallback model definition for custom providers
// ---------------------------------------------------------------------------

const FALLBACK_ASPECT_RATIOS: AspectRatioOption[] = [
  { label: "1:1", value: "1:1", widthRatio: 1, heightRatio: 1 },
  { label: "16:9", value: "16:9", widthRatio: 16, heightRatio: 9 },
  { label: "9:16", value: "9:16", widthRatio: 9, heightRatio: 16 },
  { label: "4:3", value: "4:3", widthRatio: 4, heightRatio: 3 },
  { label: "3:4", value: "3:4", widthRatio: 3, heightRatio: 4 },
  { label: "3:2", value: "3:2", widthRatio: 3, heightRatio: 2 },
  { label: "2:3", value: "2:3", widthRatio: 2, heightRatio: 3 },
  { label: "21:9", value: "21:9", widthRatio: 21, heightRatio: 9 },
  { label: "9:21", value: "9:21", widthRatio: 9, heightRatio: 21 },
];

/**
 * Create a fallback ImageModelDefinition for a custom provider model.
 *
 * When using a custom provider (user-defined API), the model ID is just the
 * raw model name (e.g. "gemini-3-pro-image-preview") without a provider
 * prefix. This function creates a generic definition with sensible defaults
 * so that image generation can proceed.
 */
export function createFallbackModelDefinition(
  modelId: string,
  providerId: string,
  modeLabel: string = "生成模式",
): ImageModelDefinition {
  const rawModelName = modelId.replace(/^[^/]+\//, "");
  return {
    id: modelId,
    displayName: rawModelName,
    providerId,
    supportedSizes: ["1K", "2K", "4K"],
    defaultSize: "1K",
    supportedAspectRatios: FALLBACK_ASPECT_RATIOS,
    defaultAspectRatio: "1:1",
    supportsImageToImage: true,
    maxReferenceImages: 5,
    extraParamsSchema: [],
    expectedDurationMs: 90000,
    resolveRequest: () => ({ requestModel: rawModelName, modeLabel }),
  };
}



