/**
 * useChannelModelSelector — unified hook for channel + model selection.
 *
 * Encapsulates provider filtering by node type, model list computation,
 * and backward compatibility logic so that ImageEditNode,
 * and VideoNode can all share the same pattern.
 *
 * Usage:
 *   const { availableProviders, availableModels, getDefaultModel } =
 *     useChannelModelSelector('image', selectedProviderId, extraModels);
 */

import { useMemo } from "react";
import { useSettingsStore } from "@/features/canvas/stores/settingsStore";
import {
  type ProviderNodeType,
  getDefaultModelForProvider,
  getProviderIdsByNodeType,
  getProviderDisplayName,
  PROVIDER_CAPABILITIES,
} from "../models/providers/capabilities";
import { getAllModels } from "../models/registry";

const WEBSITE_BUILTIN_PROVIDER_IDS = new Set(["grsai", "artlist", "vjimeng", "vjimeng-sd2"]);

// ── Friendly model name mapping ──
const MODEL_NAME_MAP: Record<string, string> = {
  // ── 北辰 (grsai) image models (only user-facing) ──
  "grsai/gpt-image-2": "GPT Image 2",
  "grsai/gpt-image-2-vip": "GPT Image 2 VIP",
  "grsai/nano-banana-2": "Nano Banana 2",
  "grsai/nano-banana-pro": "Nano Banana Pro",
  "artlist/nano-banana": "Nano Banana",
  "artlist/nano-banana-pro": "Nano Banana Pro",
  "artlist/seedream-5.0": "Seedream 5.0",
  "artlist/gpt-image-2": "GPT Image 2",
  // ── 云智 (yunzhi) image models ──
  "yunzhi/gpt-image-2": "GPT Image 2",
  // ── 北辰 (grsai) chat models ──
  "grsai/gpt-4o": "GPT-4o",
  "grsai/gpt-4o-mini": "GPT-4o Mini",
  "grsai/deepseek-chat": "DeepSeek Chat",
  "grsai/claude-3.5-sonnet": "Claude 3.5 Sonnet",
  "grsai/gpt-5.4": "GPT-5.4",
  "grsai/gpt-5.5": "GPT-5.5",
  "grsai/gemini-2.5-flash": "Gemini 2.5 Flash",
  "grsai/gemini-2.5-pro": "Gemini 2.5 Pro",
  "grsai/gemini-3-flash": "Gemini 3 Flash",
  "grsai/gemini-3-pro": "Gemini 3 Pro",
  "grsai/gemini-3.1-pro": "Gemini 3.1 Pro",
  "grsai/gemini-3.1-flash-lite": "Gemini 3.1 Flash Lite",
  "grsai/gemini-3.5-flash": "Gemini 3.5 Flash",
  // Common chat model friendly names (for custom providers / settings-driven model lists)
  "gpt-4.1": "GPT-4.1",
  "gpt-4.1-mini": "GPT-4.1 Mini",
  "gpt-4.1-nano": "GPT-4.1 Nano",
  "o1": "o1",
  "o3": "o3",
  "o3-mini": "o3 Mini",
  "o4-mini": "o4 Mini",
  "claude-3.5-sonnet": "Claude 3.5 Sonnet",
  "claude-4-sonnet": "Claude 4 Sonnet",
  "claude-sonnet-4-20250514": "Claude Sonnet 4",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-4-opus": "Claude 4 Opus",
  "claude-opus-4-6": "Claude Opus 4.6",
  "claude-opus-4-7": "Claude Opus 4.7",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
  "deepseek-chat": "DeepSeek Chat",
  "deepseek-reasoner": "DeepSeek Reasoner",
  "deepseek-r1": "DeepSeek R1",
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro Preview",
  "grok-4": "Grok 4",
  "qwen3-max": "Qwen3 Max",
  "qwen3-235b-a22b": "Qwen3 235B",
  "qwen3-omni-flash": "Qwen3 Omni Flash",
  // Common image model friendly names (for custom providers / settings-driven model lists)
  "gemini-3-pro-image-preview": "Gemini 3 Pro Image",
  "gemini-2.5-flash-image-preview": "Gemini 2.5 Flash Image",
  "gemini-3.1-flash-image-preview": "Gemini 3.1 Flash Image",
  "grok-4-2-image": "Grok 4 Image",
  "doubao-seedream-4-0-250828": "Seedream 4.0",
  "doubao-seedream-4-5-251128": "Seedream 4.5",
  "doubao-seedream-5-0-260128": "Seedream 5.0",
  "dall-e-2": "DALL·E 2",
  // XioArtTV 星核
  "transit9-mini": "Dreamina Mini",
  "transit9-fast": "Dreamina Fast",
  "transit9-2.0": "Dreamina 2.0",
  "xinghe-mini": "星核 Mini",
  "xinghe-fast": "星核 Fast",
  "xinghe-2.0": "星核 2.0",
  // VJimeng (SD2 series) — kept for backward compatibility
  "sd2-720p-mini": "SD2 720P Mini",
  "sd2-720p-fast": "SD2 720P Fast",
  "sd2-720p": "SD2 720P",
};

function getFriendlyModelName(modelId: string): string {
  return MODEL_NAME_MAP[modelId] || modelId;
}

// ── Public types ──

export interface ProviderOption {
  id: string;
  name: string;
  enabled: boolean;
  hasApiKey: boolean;
}

export interface ModelOption {
  id: string;
  label: string;
  providerId: string;
}

export interface ChannelModelSelectorResult {
  /** Providers available for this node type (enabled in settings) */
  availableProviders: ProviderOption[];
  /** Models available for the currently selected provider */
  availableModels: ModelOption[];
  /** Get the default model ID for a given provider */
  getDefaultModel: (providerId: string) => string | undefined;
}

/**
 * Channel + Model selector hook
 *
 * @param nodeType    The capability this node uses ("chat" | "image" | "video")
 * @param selectedProviderId  Currently selected provider ID (from node data or state)
 * @param extraModels Optional extra model list (for video hardcoded models, grsai custom, etc.)
 */
export function useChannelModelSelector(
  nodeType: ProviderNodeType,
  selectedProviderId: string | undefined,
  extraModels?: ModelOption[],
): ChannelModelSelectorResult {
  const providers = useSettingsStore((s) => s.providers);
  const creditsEnabled = useSettingsStore((s) => s.creditsEnabled);

  // 1. Set of provider IDs that support this node type
  const supportedProviderIds = useMemo(
    () => new Set(getProviderIdsByNodeType(nodeType)),
    [nodeType],
  );

  // 2. Build the list of providers available for this node type.
  // Website build: only show XiaKeMan-managed providers.
  const availableProviders = useMemo<ProviderOption[]>(() => {
    const result: ProviderOption[] = [];
    const seenIds = new Set<string>();

    // Built-in 北辰 channels — always show for paid build (creditsEnabled)
    for (const cap of PROVIDER_CAPABILITIES) {
      if (!cap.nodeTypes.includes(nodeType)) continue;
      if (!WEBSITE_BUILTIN_PROVIDER_IDS.has(cap.providerId)) continue;
      if (seenIds.has(cap.providerId)) continue;
      // Skip virtual/meta providers — they are internal bookkeeping only
      if (cap.providerId === "chat-model" || cap.providerId === "image-model" || cap.providerId === "video-model") continue;

      seenIds.add(cap.providerId);

      const providerInSettings = providers.find(
        (p) => p.id === cap.providerId || p.channel === cap.providerId,
      );
      const hasApiKey = !!providerInSettings?.apiKey || (creditsEnabled && (cap.providerId === "grsai" || cap.providerId === "artlist" || cap.providerId === "vjimeng" || cap.providerId === "vjimeng-sd2" || cap.providerId === "yunzhi"));

      result.push({
        id: cap.providerId,
        name: getProviderDisplayName(cap.providerId),
        enabled: true,
        hasApiKey,
      });
    }

    return result;
  }, [providers, supportedProviderIds, nodeType, creditsEnabled]);

  // For "chat" / "image" / "video" node types: return ALL available providers
  // so users can switch channels from the dropdown. Previously this only returned
  // the single configured channel, preventing channel switching in the UI.
  // The actual channel used for generation is determined by selectedProviderId
  // (which auto-syncs from settings), so returning all providers here is safe.
  const filteredProviders = useMemo<ProviderOption[]>(() => {
    // Always show all available providers for all node types
    // This allows users to pick any channel from the dropdown
    return availableProviders;
  }, [availableProviders]);

  // 3. Compute model list based on selected provider + node type
  const availableModels = useMemo<ModelOption[]>(() => {
    const effectiveProviderId = selectedProviderId;
    if (!effectiveProviderId) return extraModels || [];
    if (!WEBSITE_BUILTIN_PROVIDER_IDS.has(effectiveProviderId)) return [];

    // Guard: if the selected provider is not in availableProviders (e.g. no channels configured),
    // return empty — don't show stale models from registry/settings
    if (availableProviders.length === 0 || !availableProviders.some((p) => p.id === effectiveProviderId)) {
      return extraModels || [];
    }

    // Helper: parse modelName from settings (format: "显示名:模型ID,显示名:模型ID" or "模型ID,模型ID")
    const parseModelsFromSettings = (providerId: string): ModelOption[] => {
      const settingsProvider = providers.find(
        (p) => p.id === providerId || p.channel === providerId,
      );
      if (!settingsProvider?.modelName) return [];
      return settingsProvider.modelName
        .split(/[,，]/)
        .map((m) => m.trim())
        .filter(Boolean)
        .map((m) => {
          const colonIdx = m.indexOf(":");
          if (colonIdx > 0) {
            return {
              id: m.slice(colonIdx + 1).trim(),
              label: m.slice(0, colonIdx).trim(),
              providerId,
            };
          }
          // Use friendly name from MODEL_NAME_MAP if available
          const friendlyName = MODEL_NAME_MAP[m] || m;
          return { id: m, label: friendlyName, providerId };
        });
    };

    // ── Image node: use registry first, fall back to settings modelName, then capabilities defaults ──
    if (nodeType === "image") {
      const registryModels = getAllModels()
        .filter((m) => m.providerId === effectiveProviderId)
        .map((m) => ({ id: m.id, label: m.displayName, providerId: m.providerId }));

      // If registry has models for this provider, use them (+ extras)
      if (registryModels.length > 0) {
        const existingIds = new Set(registryModels.map((m) => m.id));
        const extras = (extraModels || []).filter((m) => !existingIds.has(m.id));
        return [...registryModels, ...extras];
      }

      // Try parsing from the "image-model" provider's modelName (primary source for image nodes)
      const imageModelProvider = providers.find((p) => p.id === "image-model");
      if (imageModelProvider?.modelName) {
        const models = imageModelProvider.modelName
          .split(/[,，]/)
          .map((m) => m.trim())
          .filter(Boolean)
          .map((m) => {
            const colonIdx = m.indexOf(":");
            if (colonIdx > 0) {
              return {
                id: m.slice(colonIdx + 1).trim(),
                label: m.slice(0, colonIdx).trim(),
                providerId: effectiveProviderId,
              };
            }
            return { id: m, label: m, providerId: effectiveProviderId };
          });
        if (models.length > 0) {
          const existingIds = new Set(models.map((m) => m.id));
          const extras = (extraModels || []).filter((m) => !existingIds.has(m.id));
          return [...models, ...extras];
        }
      }

      // Fallback: parse from the selected provider's own modelName
      const settingsModels = parseModelsFromSettings(effectiveProviderId);
      if (settingsModels.length > 0) {
        const existingIds = new Set(settingsModels.map((m) => m.id));
        const extras = (extraModels || []).filter((m) => !existingIds.has(m.id));
        return [...settingsModels, ...extras];
      }

      // Fallback: use default model from capabilities with friendly display names
      const cap = PROVIDER_CAPABILITIES.find((c) => c.providerId === effectiveProviderId);
      const defaultModelId = cap?.defaultModelId?.image;
      if (defaultModelId) {
        const friendlyName = getFriendlyModelName(defaultModelId);
        return [
          { id: defaultModelId, label: friendlyName, providerId: effectiveProviderId },
          ...(extraModels || []),
        ];
      }

      // Last resort: for openai-compatible, add common image models
      if (effectiveProviderId === "openai-compatible") {
        return [
          { id: "dall-e-3", label: "DALL·E 3", providerId: effectiveProviderId },
          { id: "gpt-image-1", label: "GPT Image 1", providerId: effectiveProviderId },
          ...(extraModels || []),
        ];
      }

      return extraModels || [];
    }

    // ── Video node: use extraModels (parsed from settings), fall back to capabilities defaults ──
    if (nodeType === "video") {
      // extraModels is the primary source for video nodes (from VideoNode.parseVideoModels)
      if (extraModels && extraModels.length > 0) return extraModels;

      // Fallback: parse from the selected provider's modelName in settings
      const settingsModels = parseModelsFromSettings(effectiveProviderId);
      if (settingsModels.length > 0) return settingsModels;

      // Fallback: use default model from capabilities with friendly display names
      const cap = PROVIDER_CAPABILITIES.find((c) => c.providerId === effectiveProviderId);
      const defaultModelId = cap?.defaultModelId?.video;
      if (defaultModelId) {
        const friendlyName = getFriendlyModelName(defaultModelId);
        return [{ id: defaultModelId, label: friendlyName, providerId: effectiveProviderId }];
      }

      return [];
    }

    // ── Chat node: use grsai built-in models when creditsEnabled, else settings ──
    if (nodeType === "chat") {
      // Paid build (creditsEnabled) + grsai channel: show full built-in chat model list
      if (creditsEnabled && effectiveProviderId === "grsai") {
        const builtinModels: ModelOption[] = [
          { id: "grsai/gpt-5.5", label: "GPT-5.5", providerId: "grsai" },
          { id: "grsai/gpt-5.4", label: "GPT-5.4", providerId: "grsai" },
          { id: "grsai/gemini-2.5-flash", label: "Gemini 2.5 Flash", providerId: "grsai" },
          { id: "grsai/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", providerId: "grsai" },
          { id: "grsai/gemini-3-flash", label: "Gemini 3 Flash", providerId: "grsai" },
          { id: "grsai/gemini-2.5-pro", label: "Gemini 2.5 Pro", providerId: "grsai" },
          { id: "grsai/gemini-3-pro", label: "Gemini 3 Pro", providerId: "grsai" },
          { id: "grsai/gemini-3.1-pro", label: "Gemini 3.1 Pro", providerId: "grsai" },
          { id: "grsai/gemini-3.5-flash", label: "Gemini 3.5 Flash", providerId: "grsai" },
        ];
        return builtinModels;
      }

      // For chat nodes, models come from the "chat-model" provider in settings
      const chatModelProvider = providers.find((p) => p.id === "chat-model");

      // For all providers: try parsing from chat-model's modelName in settings
      if (chatModelProvider?.modelName) {
        const models = chatModelProvider.modelName
          .split(/[,，]/)
          .map((m) => m.trim())
          .filter(Boolean)
          .map((m) => {
            const colonIdx = m.indexOf(":");
            if (colonIdx > 0) {
              return {
                id: m.slice(colonIdx + 1).trim(),
                label: m.slice(0, colonIdx).trim(),
                providerId: effectiveProviderId,
              };
            }
            return { id: m, label: getFriendlyModelName(m), providerId: effectiveProviderId };
          });
        if (models.length > 0) return models;
      }

      // Fallback: use default model from capabilities
      const cap = PROVIDER_CAPABILITIES.find((c) => c.providerId === effectiveProviderId);
      const defaultModelId = cap?.defaultModelId?.chat;
      if (defaultModelId) {
        const friendlyName = getFriendlyModelName(defaultModelId);
        return [
          { id: defaultModelId, label: friendlyName, providerId: effectiveProviderId },
          ...(extraModels || []),
        ];
      }

      // Last resort defaults for chat
      return [
        { id: "glm-4-flash", label: "GLM 4 Flash", providerId: effectiveProviderId },
        { id: "gpt-4o", label: "GPT-4o", providerId: effectiveProviderId },
        { id: "deepseek-ai/DeepSeek-V3", label: "DeepSeek V3", providerId: effectiveProviderId },
      ];
    }

    return extraModels || [];
  }, [selectedProviderId, nodeType, extraModels, providers]);

  // 4. Default model getter
  const getDefaultModel = useMemo(() => {
    return (providerId: string): string | undefined => {
      if (!WEBSITE_BUILTIN_PROVIDER_IDS.has(providerId)) return undefined;
      // Check static registry
      const fromRegistry = getDefaultModelForProvider(providerId, nodeType);
      if (fromRegistry) return fromRegistry;
      // Fall back to first available model
      return availableModels[0]?.id;
    };
  }, [nodeType, availableModels]);

  return {
    availableProviders: filteredProviders,
    availableModels,
    getDefaultModel,
  };
}



