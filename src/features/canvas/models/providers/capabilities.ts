/**
 * Provider Capability Registry
 *
 * The website build exposes only XiaKeMan-managed providers.
 * Custom and third-party provider configuration is intentionally hidden from users.
 */

import { useSettingsStore } from "@/features/canvas/stores/settingsStore";

/** Node type capability */
export type ProviderNodeType = "chat" | "image" | "video";

/** Provider capability definition */
export interface ProviderCapability {
  providerId: string;
  /** Which node types this provider supports */
  nodeTypes: ProviderNodeType[];
  /** Default model ID per node type (used for auto-select on provider switch) */
  defaultModelId?: Partial<Record<ProviderNodeType, string>>;
}

/**
 * Provider capability table — only XiaKeMan-managed channels are selectable.
 */
export const PROVIDER_CAPABILITIES: ProviderCapability[] = [
  // ── 虾客漫图像 / 对话 ──
  {
    providerId: "grsai",
    nodeTypes: ["chat", "image"],
    defaultModelId: { chat: "grsai/gpt-5.5", image: "grsai/gpt-image-2" },
  },

  // ── 虾客漫自有图片（SD2 主站图片 API） ──
  {
    providerId: "artlist",
    nodeTypes: ["image"],
    defaultModelId: { image: "artlist/nano-banana" },
  },

  // ── 虾客漫视频 ──
  {
    providerId: "vjimeng",
    nodeTypes: ["video"],
    defaultModelId: { video: "transit9-fast" },
  },

  // ── 星核备用 (SD2) ──
  {
    providerId: "vjimeng-sd2",
    nodeTypes: ["video"],
    defaultModelId: { video: "sd2-720p-fast" },
  },

  // ── 即梦官网：保留兼容，不在网站版中展示 ──
  {
    providerId: "jimeng-official",
    nodeTypes: [],
    defaultModelId: { video: "jimeng-video-seedance-2.0" },
  },

  // ── 云智：保留兼容，不在网站版中展示 ──
  {
    providerId: "yunzhi",
    nodeTypes: [],
    defaultModelId: { image: "gpt-image-2" },
  },

  // ── Virtual / special providers (internal bookkeeping only, NOT shown as channels) ──
  {
    providerId: "chat-model",
    nodeTypes: [],
  },
  {
    providerId: "image-model",
    nodeTypes: [],
  },
  {
    providerId: "video-model",
    nodeTypes: [],
  },
];

// ── Provider display name mapping ──
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  "grsai": "虾客漫图像",
  "artlist": "虾客漫自有图片",
  "vjimeng": "虾客漫视频",
  "vjimeng-sd2": "虾客漫 SD2",
  "jimeng-official": "即梦官网",
  "yunzhi": "虾客漫图像",
  // Virtual providers (internal, not shown to user)
  "chat-model": "对话模型",
  "image-model": "图像模型",
  "video-model": "视频模型",
};

/** Get friendly display name for a provider ID */
export function getProviderDisplayName(providerId: string): string {
  return PROVIDER_DISPLAY_NAMES[providerId] || providerId;
}

// ── Lookup helpers ──

/** Get provider IDs that support a given node type */
export function getProviderIdsByNodeType(nodeType: ProviderNodeType): string[] {
  return PROVIDER_CAPABILITIES
    .filter((cap) => cap.nodeTypes.includes(nodeType))
    .map((cap) => cap.providerId);
}

/** Get default model ID for a provider + node type combination */
export function getDefaultModelForProvider(
  providerId: string,
  nodeType: ProviderNodeType
): string | undefined {
  const cap = PROVIDER_CAPABILITIES.find((c) => c.providerId === providerId);
  return cap?.defaultModelId?.[nodeType];
}

/** Check if a provider supports a given node type */
export function providerSupportsCapability(
  providerId: string,
  nodeType: ProviderNodeType
): boolean {
  const cap = PROVIDER_CAPABILITIES.find((c) => c.providerId === providerId);
  if (cap) return cap.nodeTypes.includes(nodeType);

  // Check custom providers
  return false;
}

/**
 * Get all enabled providers that support a given capability.
 * Returns provider info from settingsStore for UI display.
 *
 * Handles channel-based mapping: e.g. provider with channel="grsai" → maps to "grsai" capability
 */
export function getProvidersForCapability(
  capability: ProviderNodeType
): { id: string; name: string; modelName?: string; channel?: string; apiKey?: string }[] {
  const providers = useSettingsStore.getState().providers;
  const supportedIds = new Set(getProviderIdsByNodeType(capability));

  return providers
    .filter((p) => p.enabled)
    .filter((p) => {
      // Match by provider.id OR by provider.channel
      return supportedIds.has(p.id) || (p.channel ? supportedIds.has(p.channel) : false);
    })
    .map((p) => ({
      // Prefer channel-based ID if it matches a capability (e.g. channel="grsai" → "grsai")
      id: p.channel && supportedIds.has(p.channel) ? p.channel : p.id,
      name: p.name,
      modelName: p.modelName,
      channel: p.channel,
      apiKey: p.apiKey,
    }));
}

/** Get display name from settings for a provider ID (falls back to capability display name) */
export function getProviderDisplayNameFromSettings(providerId: string): string {
  const providers = useSettingsStore.getState().providers;
  const p = providers.find((p) => p.id === providerId || p.channel === providerId);
  if (p) return p.name;

  return getProviderDisplayName(providerId);
}



