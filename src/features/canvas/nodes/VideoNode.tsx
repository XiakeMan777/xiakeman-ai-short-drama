import { useState, useCallback, useEffect, useMemo, useRef, memo } from "react";
import { type NodeProps, Handle, Position } from "@xyflow/react";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useToastStore } from "@/features/canvas/compat/Toast";
import { useSettingsStore } from "@/features/canvas/stores/settingsStore";

import { type VideoNodeData } from "../domain/canvasNodes";
import { CANVAS_NODE_TYPES } from "../domain/canvasNodes";
import { nodeRegistry } from "../domain/nodeRegistry";
import { RichPromptInput } from "../ui/RichPromptInput";
import { NodeResizeHandle } from "../ui/NodeResizeHandle";
import { submitGenerateVideoJob, getGenerateVideoJob, persistVideoSource } from "@/features/canvas/compat/commands";
import { jimengSubmitVideo, jimengGetVideoStatus, jimengBrowserOpenLogin, jimengBrowserGenerate, jimengBrowserCheckEnv, jimengBrowserInstall } from "@/features/canvas/compat/commands";
import { invoke } from "@/features/canvas/compat/tauriCore";
import { useUpstreamDataKey } from "../hooks/useUpstreamNodes";
import { useAssetStore } from "@/features/canvas/stores/assetStore";
import { useCreditsStore } from "@/features/canvas/stores/creditsStore";
import { useAuthStore } from "@/features/canvas/stores/authStore";
import { useProject } from "@/stores/projectStore";
import type { VideoApiConfig } from "@/types";
import { VIDEO_CREDIT_PRICES, UNIVERSAL_VIDEO_MODELS as CREDIT_PRICING_UNIVERSAL_VIDEO_MODELS } from "../application/creditPricing";
import { tauriAiGateway } from "../infrastructure/tauriAiGateway";
import {
  buildReferenceImagePool,
  buildAssetImagePool,
  resolveReferenceImagesForPrompt,
  normalizeUrl,
  type ReferenceImageEntry,
} from "../application/referenceImagePool";
import {
  stripReferenceMarkers,
  collectReferencedImageNumbers,
  collectReferencedAudioNumbers,
  removeReferenceTokenByNumber,
} from "../application/referenceTokenEditing";
import { extractDisplayName } from "../application/imageData";
import { prepareNodeImageFromFile } from "../application/imageData";
import { NodeDeleteButton } from "./NodeDeleteButton";
import { useChannelModelSelector } from "../hooks/useChannelModelSelector";
import { ChannelModelSelector } from "../ui/ChannelModelSelector";
import { useCachedImage } from "../hooks/useCachedImage";

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Mini image preview for frame slots — uses cached image loading */
function FrameImagePreview({ src }: { src: string }) {
  const { displayUrl } = useCachedImage(src);
  return (
    <img
      src={displayUrl || src}
      alt=""
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        borderRadius: 6,
        pointerEvents: "none",
        background: "var(--bg-secondary)",
      }}
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
    />
  );
}

/** Reusable frame slot for adaptive image area */
function FrameSlot({ label, tooltip, image, dragOver, onClick, onDrop, onDragOver, onDragLeave, onClear, pool, onUseRef, height = 80 }: {
  label: string;
  tooltip: string;
  image: string | null;
  dragOver: boolean;
  onClick: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onClear: () => void;
  pool: { entries: ReferenceImageEntry[] };
  onUseRef: (entry: ReferenceImageEntry) => void;
  /** Slot image area height in px (default 120) */
  height?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }} title={tooltip}>{label}</div>
      <div
        onClick={onClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        style={{
          position: "relative",
          height: height,
          borderRadius: 8,
          border: dragOver ? "2px dashed var(--accent)" : "2px dashed var(--border)",
          background: dragOver ? "var(--accent-dim)" : "var(--bg-secondary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          overflow: "hidden",
          transition: "all 0.2s",
        }}
      >
        {image ? (
          <>
            <FrameImagePreview src={image} />
            <button
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              style={{
                position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: "50%",
                background: "rgba(0,0,0,0.6)", border: "none", color: "#fff", fontSize: 12,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                lineHeight: 1,
              }}
              title={`清除${label}`}
            >✕</button>
          </>
        ) : (
          <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 11 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto 3px", display: "block", opacity: 0.5 }}>
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
            </svg>
            点击 / 拖入
          </div>
        )}
      </div>
      {/* Pick from reference pool */}
      {pool.entries.length > 0 && !image && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {pool.entries.filter((e) => e.mediaType !== "audio").slice(0, 4).map((entry) => (
            <button
              key={entry.number}
              onClick={() => onUseRef(entry)}
              title={`使用 @图${entry.number} 作为${label}`}
              style={{
                width: 28, height: 28, borderRadius: 4, border: "1px solid var(--border)",
                background: "var(--bg-secondary)", cursor: "pointer", overflow: "hidden",
                padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, color: "var(--text-muted)",
              }}
            >@{entry.number}</button>
          ))}
        </div>
      )}
    </div>
  );
}

async function persistVideoUrl(videoUrl: string | null): Promise<string | null> {
  if (!videoUrl) return null;
  if (videoUrl.match(/^[A-Za-z]:/) || videoUrl.startsWith("/")) return videoUrl;
  try { return String(await persistVideoSource(videoUrl)); }
  catch (e) { console.warn("Failed to persist video:", e); return videoUrl; }
}

const ALL_VIDEO_MODES = [
  { id: "text2video", label: "文生视频" },
  { id: "fullReference", label: "全能参考" },
  { id: "image2video", label: "图生视频" },
  { id: "firstLastFrame", label: "首尾帧" },
  { id: "videoReference", label: "视频参考" },
  { id: "smartMultiframe", label: "智能多帧" },
] as const;

const VJIMENG_VIDEO_MODES = [
  { id: "fullReference", label: "全能参考" },
  { id: "text2video", label: "文生视频" },
  { id: "image2video", label: "图生视频" },
  { id: "firstLastFrame", label: "首尾帧" },
  { id: "videoReference", label: "视频参考" },
] as const;

const JIMENG_OFFICIAL_VIDEO_MODES = [
  { id: "fullReference", label: "全能参考" },
  { id: "firstLastFrame", label: "首尾帧" },
  { id: "smartMultiframe", label: "智能多帧" },
  { id: "text2video", label: "文生视频" },
  { id: "image2video", label: "图生视频" },
] as const;

const VIDEO_MODES = ALL_VIDEO_MODES;

const VJIMENG_DEFAULT_MODELS: { id: string; label: string; series: string }[] = [
  { id: "fast", label: "Seedance2.0 Fast (720P)", series: "seedance-cloud" },
  { id: "mini", label: "Seedance2.0 Mini (720P)", series: "seedance-cloud" },
  { id: "2.0", label: "Seedance2.0 满血", series: "seedance-cloud" },
];

const VJIMENG_SD2_MODELS: { id: string; label: string; series: string }[] = [
  { id: "sd2-720p-mini", label: "SD2 Mini (720P)", series: "sd2" },
  { id: "sd2-720p-fast", label: "SD2 Fast (720P)", series: "sd2" },
  { id: "sd2-720p-sh", label: "SD2 SH (720P)", series: "sd2" },
  { id: "sd2-720p", label: "SD2 720P", series: "sd2" },
  { id: "sd2-1080p-mini", label: "SD2 Mini (1080P)", series: "sd2" },
  { id: "sd2-1080p-fast", label: "SD2 Fast (1080P)", series: "sd2" },
  { id: "sd2-1080p-zt", label: "SD2 ZT (1080P)", series: "sd2" },
  { id: "sd2-1080p", label: "SD2 1080P", series: "sd2" },
];

const JIMENG_OFFICIAL_MODELS: { id: string; label: string; series: string }[] = [
  { id: "jimeng-video-seedance-2.0", label: "Seedance 2.0", series: "seedance" },
  { id: "jimeng-video-seedance-2.0-fast", label: "Seedance 2.0 Fast", series: "seedance" },
  { id: "jimeng-video-3.5-pro", label: "即梦 3.5 Pro", series: "v3" },
  { id: "jimeng-video-3.5", label: "即梦 3.5", series: "v3" },
  { id: "jimeng-video-3.0-pro", label: "Seedance 1.5 Pro", series: "seedance" },
  { id: "jimeng-video-3.0", label: "Seedance 1.0", series: "seedance" },
  { id: "jimeng-video-3.0-fast", label: "Seedance 1.0 Fast", series: "seedance" },
  // Seedance 2.0 mini (by seed) — new model
  { id: "jimeng-video-seedance-2.0-mini", label: "Seedance 2.0 mini", series: "seedance" },
  // Seedance 2.0 Fast VIP / VIP — VIP-only models
  { id: "jimeng-video-seedance-2.0-fast-vip", label: "Seedance 2.0 Fast VIP", series: "seedance" },
  { id: "jimeng-video-seedance-2.0-vip", label: "Seedance 2.0 VIP", series: "seedance" },
];

// ── Universal video model list for custom providers (中转站通用) ──
// Now imported from creditPricing.ts — single source of truth
const UNIVERSAL_VIDEO_MODELS = CREDIT_PRICING_UNIVERSAL_VIDEO_MODELS;

const ALL_DEFAULT_MODELS = [...VJIMENG_DEFAULT_MODELS, ...VJIMENG_SD2_MODELS, ...JIMENG_OFFICIAL_MODELS, ...UNIVERSAL_VIDEO_MODELS];

const NON_VIDEO_PATTERNS = ["gpt-image", "dall-e", "flux", "sdxl", "cogview", "imagen", "midjourney", "stable-diffusion", "sd3"];

function isCustomVideoChannel(channel?: string): boolean {
  // Custom providers have IDs like "custom-xxx" or user-defined names
  return !!channel && channel.startsWith("custom-");
}

function parseVideoModels(modelNameStr: string | undefined, channel?: string): { id: string; label: string }[] {
  // Each channel shows its own models — custom channels show ALL video models
  const isJimengOfficial = channel === "jimeng-official";
  const isCustomChannel = isCustomVideoChannel(channel);

  // Custom channel defaults to universal model list (所有中转站视频模型)
  const channelDefaults = isCustomChannel
    ? UNIVERSAL_VIDEO_MODELS.map((m) => ({ id: m.id, label: m.label }))
    : isJimengOfficial
    ? JIMENG_OFFICIAL_MODELS.map((m) => ({ id: m.id, label: m.label }))
    : channel === "vjimeng-sd2"
    ? VJIMENG_SD2_MODELS.map((m) => ({ id: m.id, label: m.label }))
    : VJIMENG_DEFAULT_MODELS.map((m) => ({ id: m.id, label: m.label }));

  if (!modelNameStr || !modelNameStr.trim()) return channelDefaults;

  const parts = modelNameStr.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length > 0) {
    const parsed = parts.map((trimmed) => {
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx > 0) return { id: trimmed.slice(colonIdx + 1).trim(), label: trimmed.slice(0, colonIdx).trim() };
      const defaultModel = ALL_DEFAULT_MODELS.find((m) => m.id === trimmed);
      return { id: trimmed, label: defaultModel?.label || trimmed };
    }).filter((m) => m.id.length > 0);

    // Filter out non-video model patterns
    const videoOnly = parsed.filter((m) => !NON_VIDEO_PATTERNS.some((p) => m.id.toLowerCase().includes(p)));

    // Cross-filter by channel:
    // - custom channels show ALL video models (Grok, Jimeng, Veo, Vidu, Kling, Wan, etc.)
    // - jimeng-official shows jimeng models
    // - vjimeng(XioArtTV) shows Transit9 models
    const channelFiltered = isCustomChannel
      ? videoOnly // Custom channel: no filtering, show everything
      : isJimengOfficial
      ? videoOnly.filter((m) => isJimengOfficialModel(m.id))
      : videoOnly.filter((m) => !isJimengOfficialModel(m.id)); // XioArtTV: Transit9 models (去掉即梦官网模型)

    return channelFiltered.length > 0 ? channelFiltered : channelDefaults;
  }
  return channelDefaults;
}

function getModelMeta(modelId: string) { return ALL_DEFAULT_MODELS.find((m) => m.id === modelId); }

function isGrokModel(modelId: string) { return modelId.startsWith("grok-video") || modelId.startsWith("grok-imagine"); }
/** Compute pixel width/height from resolution P-label + aspect ratio.
 *  Used to generate WxH format for `size` field (e.g. "1280x720")
 *  which is the most widely accepted format across New API, SiliconFlow, volces, Sora etc.
 */
function computeVideoDimensions(aspectRatio: string, resolution: string): { width: number; height: number; sizeWH: string } {
  const baseH = resolution === "1080P" ? 1080 : resolution === "540P" ? 540 : resolution === "480P" ? 480 : 720;
  const [wRatio, hRatio] = aspectRatio.split(":").map(Number);
  const height = baseH;
  const width = Math.round(baseH * (wRatio / hRatio));
  // Ensure both dimensions are even (video encoders require even dimensions)
  const w = width % 2 === 0 ? width : width + 1;
  const h = height % 2 === 0 ? height : height + 1;
  return { width: w, height: h, sizeWH: `${w}x${h}` };
}
function isJimengOfficialModel(modelId: string) { return modelId.startsWith("jimeng-video-"); }

/** Map aspect ratio → xAI Grok API compatible size (WxH).
 *  xAI/Grok Imagine accepts: 720x1280, 1280x720, 1024x1792, 1792x1024, 480p, 720p, 1080p */
function grokXaiSizeMap(aspectRatio: string): string {
  switch (aspectRatio) {
    case "1:1":  return "1024x1024";
    case "2:3":  return "1024x1792";
    case "3:2":  return "1792x1024";
    case "16:9": return "1280x720";
    case "9:16": return "720x1280";
    default:     return "1280x720";
  }
}

function getDefaultVideoModel(modelNameStr: string | undefined, channel?: string): string {
  const isJimengOfficial = channel === "jimeng-official";
  const isCustomChannel = isCustomVideoChannel(channel);
  if (!modelNameStr || !modelNameStr.trim()) return isCustomChannel ? "seedance-2.0" : isJimengOfficial ? "jimeng-video-seedance-2.0" : channel === "vjimeng-sd2" ? "sd2-720p-fast" : "transit9-fast";
  const trimmed = modelNameStr.trim();
  const colonIdx = trimmed.indexOf(":");
  const idPart = colonIdx > 0 ? trimmed.slice(colonIdx + 1).trim() : trimmed;
  if (ALL_DEFAULT_MODELS.some((m) => m.id === idPart)) return idPart;
  if (idPart.length > 0) return idPart;
  return isCustomChannel ? "seedance-2.0" : isJimengOfficial ? "jimeng-video-seedance-2.0" : "transit9-fast";
}

const ASPECT_RATIOS = [
  { value: "auto", label: "Auto", icon: "□" },
  { value: "16:9", label: "16:9", icon: "▭" },
  { value: "4:3", label: "4:3", icon: "▭" },
  { value: "1:1", label: "1:1", icon: "□" },
  { value: "3:4", label: "3:4", icon: "▯" },
  { value: "9:16", label: "9:16", icon: "▯" },
  { value: "21:9", label: "21:9", icon: "▭" },
];


const RESOLUTIONS = [
  { value: "480P", label: "480P" },
  { value: "720P", label: "720P" },
  { value: "1080P", label: "1080P" },
];

// ALL grok models via GeekNow use WxH size + metadata.output_config (reference plugin)
// grok-video supports 480P/540P/720P/1080P, grok-imagine supports 480P/720P only
// We show a unified list and auto-downgrade in the payload for grok-imagine

const XIOARTTV_ASPECT_RATIOS = [
  { value: "16:9", label: "16:9", icon: "▭" },
  { value: "9:16", label: "9:16", icon: "▯" },
];

const XIOARTTV_RESOLUTIONS = [
  { value: "720P", label: "720P" },
  { value: "1080P", label: "1080P" },
];

/** Build payload and submit a single video generation job */
async function submitVideoJob(
  id: string,
  textToUse: string,
  _assetPool: ReturnType<typeof buildAssetImagePool>,
  _persistedAssets: VideoNodeData["referencedAssets"],
  provider: { id: string; baseUrl?: string; apiKey?: string; channel?: string },
  effectiveModel: string,
  duration: number,
  selectedAspectRatio: string,
  generateAudio: boolean,
  selectedResolution: string,
  activeMode: string,
  effectiveImages: string[],
  referencedAudioPaths: string[],
  addToast: ReturnType<typeof useToastStore.getState>["addToast"],
  firstFrameOverride?: string | null,
  lastFrameOverride?: string | null,
  videoReferenceOverride?: string | null,
  isCustomVideoProvider?: boolean,
  apiFormat?: "openai" | "volcano" | "kling" | "luma" | "runway" | "minimax" | "yunzhi" | "pika" | "vidu" | "veo" | "grok" | "sora" | "zhipu" | "aicost" | "axmgc" | "custom",
  siteVideoConfig?: Pick<VideoApiConfig, "seedanceCloudBaseUrl" | "seedanceCloudLicenseKey" | "seedanceCloudUserId">,
): Promise<string> {
  const modelMeta = getModelMeta(effectiveModel);
  const isMinSeries = modelMeta?.series === "min";
  const isGrok = isGrokModel(effectiveModel);

  let effectiveDuration = duration;
  if (isMinSeries) effectiveDuration = Math.max(5, Math.min(10, effectiveDuration));
  // Grok per GeekNow docs: pro=10s, max=15s, others=user choice (1-15)
  if (isGrok && effectiveModel.endsWith("-pro")) effectiveDuration = 10;
  if (isGrok && effectiveModel.endsWith("-max")) effectiveDuration = 15;
  // Grok Imagine series: resolution only supports 480P and 720P — auto-downgrade 1080P

  // ── Kling (可灵) Video Provider ────────────────────────────────────
  // Uses _raw_body passthrough: frontend builds native Kling API JSON,
  // Rust sends it verbatim. Supports both 中转站 and 直连原生API.
  if (isCustomVideoProvider && apiFormat === "kling") {
    const baseUrl = (provider.baseUrl || "").trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
    const hasImages = effectiveImages.length > 0 || firstFrameOverride || lastFrameOverride;
    // Kling native API: separate endpoints for text2video vs image2video
    const submitPath = hasImages ? "/v1/videos/image2video" : "/v1/videos/text2video";
    // Build native Kling request body
    const rawBody: Record<string, unknown> = {
      model: effectiveModel,
      prompt: textToUse,
      duration: effectiveDuration,
    };
    if (selectedAspectRatio !== "auto") {
      rawBody.aspect_ratio = selectedAspectRatio;
    }
    if (firstFrameOverride) {
      rawBody.image = firstFrameOverride;  // Kling native: "image" field for first frame
    }
    if (lastFrameOverride) {
      rawBody.last_frame_image = lastFrameOverride;
    }
    if (effectiveImages.length > 0 && !firstFrameOverride) {
      rawBody.image = effectiveImages[0];  // Fallback: use first reference image
    }
    if (generateAudio) {
      rawBody.mode = "professional";  // Kling: professional mode supports audio
    } else {
      rawBody.mode = "standard";
    }
    const payloadObj: Record<string, unknown> = {
      base_url: baseUrl,
      api_key: provider.apiKey,
      model: effectiveModel,
      prompt: textToUse,
      provider_type: "custom-video",
      api_format: "kling",
      _submit_url_path: submitPath,
      _poll_url_path: "/v1/videos",
      _raw_body: JSON.stringify(rawBody),
    };
    console.log("[submitVideoJob] Kling raw body:", rawBody);
    return await submitGenerateVideoJob(JSON.stringify(payloadObj)) as string;
  }

  // ── Luma Dream Machine Video Provider ─────────────────────────────
  // Uses _raw_body passthrough: frontend builds native Luma API JSON,
  // Rust sends it verbatim. Luma uses POST /dream-machine/v1/generations.
  if (isCustomVideoProvider && apiFormat === "luma") {
    const baseUrl = (provider.baseUrl || "").trim().replace(/\/+$/, "").replace(/\/dream-machine\/v1$/i, "");
    // Build native Luma request body
    const rawBody: Record<string, unknown> = {
      prompt: textToUse,
      model: effectiveModel,
    };
    if (selectedAspectRatio !== "auto") {
      rawBody.aspect_ratio = selectedAspectRatio;
    }
    // Luma: duration is a string like "5s" or "9s"
    rawBody.duration = `${effectiveDuration}s`;
    if (selectedResolution) {
      rawBody.resolution = selectedResolution.toLowerCase();
    }
    // Luma: keyframes format for image-to-video
    if (firstFrameOverride || effectiveImages.length > 0) {
      const firstFrameUrl = firstFrameOverride || effectiveImages[0];
      const keyframes: Record<string, { type: string; url: string }> = {
        frame0: { type: "image", url: firstFrameUrl },
      };
      if (lastFrameOverride) {
        keyframes.frame1 = { type: "image", url: lastFrameOverride };
      }
      rawBody.keyframes = keyframes;
    }
    const payloadObj: Record<string, unknown> = {
      base_url: baseUrl,
      api_key: provider.apiKey,
      model: effectiveModel,
      prompt: textToUse,
      provider_type: "custom-video",
      api_format: "luma",
      _submit_url_path: "/dream-machine/v1/generations",
      _poll_url_path: "/dream-machine/v1/generations",
      _raw_body: JSON.stringify(rawBody),
    };
    console.log("[submitVideoJob] Luma raw body:", rawBody);
    return await submitGenerateVideoJob(JSON.stringify(payloadObj)) as string;
  }

  // ── Runway Video Provider ─────────────────────────────────────────
  // Uses _raw_body passthrough: frontend builds native Runway API JSON,
  // Rust sends it verbatim. Runway uses POST /v1/generations/text-to-video
  // or /v1/generations/image-to-video.
  if (isCustomVideoProvider && apiFormat === "runway") {
    const baseUrl = (provider.baseUrl || "").trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
    const hasImages = effectiveImages.length > 0 || firstFrameOverride;
    const submitPath = hasImages ? "/v1/generations/image-to-video" : "/v1/generations/text-to-video";
    // Build native Runway request body
    const rawBody: Record<string, unknown> = {
      prompt: textToUse,
      model: effectiveModel,
    };
    if (effectiveDuration) {
      rawBody.duration = effectiveDuration;
    }
    if (selectedAspectRatio !== "auto") {
      rawBody.aspect_ratio = selectedAspectRatio;
    }
    if (firstFrameOverride) {
      rawBody.promptImage = firstFrameOverride;  // Runway: promptImage field
    } else if (effectiveImages.length > 0) {
      rawBody.promptImage = effectiveImages[0];
    }
    const payloadObj: Record<string, unknown> = {
      base_url: baseUrl,
      api_key: provider.apiKey,
      model: effectiveModel,
      prompt: textToUse,
      provider_type: "custom-video",
      api_format: "runway",
      _submit_url_path: submitPath,
      _poll_url_path: "/v1/generations",
      _raw_body: JSON.stringify(rawBody),
    };
    console.log("[submitVideoJob] Runway raw body:", rawBody);
    return await submitGenerateVideoJob(JSON.stringify(payloadObj)) as string;
  }

  // ── MiniMax (海螺) Video Provider ──────────────────────────────────
  // Uses _raw_body passthrough: frontend builds native MiniMax API JSON,
  // Rust sends it verbatim. MiniMax uses POST /v1/video_generation.
  if (isCustomVideoProvider && apiFormat === "minimax") {
    const baseUrl = (provider.baseUrl || "").trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
    // Build native MiniMax request body
    const rawBody: Record<string, unknown> = {
      model: effectiveModel,
      prompt: textToUse,
    };
    if (effectiveDuration) {
      rawBody.duration = effectiveDuration;
    }
    if (selectedResolution) {
      rawBody.resolution = selectedResolution;
    }
    if (firstFrameOverride) {
      rawBody.first_frame_image = firstFrameOverride;  // MiniMax: first_frame_image
    }
    if (lastFrameOverride) {
      rawBody.last_frame_image = lastFrameOverride;    // MiniMax: last_frame_image
    }
    if (effectiveImages.length > 0 && !firstFrameOverride) {
      rawBody.first_frame_image = effectiveImages[0];
    }
    if (generateAudio) {
      rawBody.generate_audio = true;
    }
    const payloadObj: Record<string, unknown> = {
      base_url: baseUrl,
      api_key: provider.apiKey,
      model: effectiveModel,
      prompt: textToUse,
      provider_type: "custom-video",
      api_format: "minimax",
      _submit_url_path: "/v1/video_generation",
      _poll_url_path: "/v1/query/video_generation",
      _raw_body: JSON.stringify(rawBody),
    };
    console.log("[submitVideoJob] MiniMax raw body:", rawBody);
    return await submitGenerateVideoJob(JSON.stringify(payloadObj)) as string;
  }

  // ── Volcano Engine (火山方舟) Video Provider ──
  // Uses _raw_body passthrough: frontend builds native Volcano API JSON,
  // Rust sends it verbatim. Volcano uses POST /api/v3/contents/generations/tasks.
  if (isCustomVideoProvider && apiFormat === "volcano") {
    const baseUrl = (provider.baseUrl || "").trim().replace(/\/+$/, "");
    // Build native Volcano (火山方舟) request body
    // Volcano uses a "content" array for multimodal input (text + images)
    const content: Array<Record<string, unknown>> = [
      { type: "text", text: textToUse },
    ];
    // Add reference images to content array
    if (firstFrameOverride) {
      content.push({ type: "image_url", image_url: { url: firstFrameOverride } });
    } else if (effectiveImages.length > 0) {
      for (const img of effectiveImages) {
        content.push({ type: "image_url", image_url: { url: img } });
      }
    }
    if (lastFrameOverride) {
      content.push({ type: "image_url", image_url: { url: lastFrameOverride } });
    }
    const rawBody: Record<string, unknown> = {
      model: effectiveModel,
      content: content,
    };
    const effectiveRatio = selectedAspectRatio === "auto" ? "adaptive" : selectedAspectRatio;
    rawBody.ratio = effectiveRatio;
    rawBody.duration = effectiveDuration;
    if (generateAudio) {
      rawBody.generate_audio = true;
    }
    const payloadObj: Record<string, unknown> = {
      base_url: baseUrl,
      api_key: provider.apiKey,
      model: effectiveModel,
      prompt: textToUse,
      provider_type: "custom-video",
      api_format: "volcano",
      _submit_url_path: "/api/v3/contents/generations/tasks",
      _poll_url_path: "/api/v3/contents/generations/tasks",
      _raw_body: JSON.stringify(rawBody),
    };
    console.log("[submitVideoJob] 火山方舟 raw body:", rawBody);
    return await submitGenerateVideoJob(JSON.stringify(payloadObj)) as string;
  }

  // ── Pika (快乐马) Video Provider ──────────────────────────────────
  // Uses _raw_body passthrough: frontend builds native Pika API JSON.
  // Pika official API: https://api.pika.art/v1
  // Submit: POST /v1/videos/generate (text-to-video)
  //         POST /v1/videos/image-to-video (image-to-video)
  // Poll: GET /v1/videos/{video_id}
  // Auth: Bearer {PIKA_API_KEY}
  // Status: "completed" | "failed"
  // Video URL: video_url
  if (isCustomVideoProvider && apiFormat === "pika") {
    const baseUrl = (provider.baseUrl || "").trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
    const hasImages = effectiveImages.length > 0 || firstFrameOverride;
    const submitPath = hasImages ? "/v1/videos/image-to-video" : "/v1/videos/generate";
    const rawBody: Record<string, unknown> = {
      prompt: textToUse,
      model: effectiveModel || "pika-1.0",
      duration: effectiveDuration,
    };
    if (selectedAspectRatio !== "auto") {
      rawBody.aspect_ratio = selectedAspectRatio;
    }
    if (firstFrameOverride) {
      rawBody.image_url = firstFrameOverride;
    } else if (effectiveImages.length > 0) {
      rawBody.image_url = effectiveImages[0];
    }
    if (lastFrameOverride) {
      rawBody.last_frame_image_url = lastFrameOverride;
    }
    const payloadObj: Record<string, unknown> = {
      base_url: baseUrl,
      api_key: provider.apiKey,
      model: effectiveModel || "pika-1.0",
      prompt: textToUse,
      provider_type: "custom-video",
      api_format: "pika",
      _submit_url_path: submitPath,
      _poll_url_path: "/v1/videos",
      _raw_body: JSON.stringify(rawBody),
    };
    console.log("[submitVideoJob] Pika raw body:", rawBody);
    return await submitGenerateVideoJob(JSON.stringify(payloadObj)) as string;
  }

  // ── Vidu (生数) Video Provider ────────────────────────────────────
  // Uses _raw_body passthrough: frontend builds native Vidu API JSON.
  // Vidu official API: https://api.vidu.cn
  // Submit: POST /ent/v2/create  (auto-detects text2video/img2video/start-end2video from payload)
  // Poll: GET /ent/v2/tasks/{id}/creations
  // Auth: Token {VIDU_API_KEY} (NOT "Bearer"!)
  // Status: state="success" | "failed"
  // Video URL: creations[0].url
  if (isCustomVideoProvider && apiFormat === "vidu") {
    const baseUrl = (provider.baseUrl || "").trim().replace(/\/+$/, "");
    // Vidu API uses different creation types based on input
    const hasImages = effectiveImages.length > 0 || firstFrameOverride;
    const hasLastFrame = lastFrameOverride || effectiveImages.length >= 2;
    let submitPath: string;
    let rawBody: Record<string, unknown>;

    if (hasLastFrame && (firstFrameOverride || effectiveImages.length >= 2)) {
      // 首尾帧生视频
      submitPath = "/ent/v2/start-end2video";
      const images: string[] = [];
      if (firstFrameOverride) images.push(firstFrameOverride);
      else images.push(effectiveImages[0]);
      if (lastFrameOverride) images.push(lastFrameOverride);
      else images.push(effectiveImages[1]);
      rawBody = {
        model: effectiveModel || "vidu-q2-pro",
        prompt: textToUse,
        images,
        duration: effectiveDuration,
      };
    } else if (hasImages) {
      // 图生视频
      submitPath = "/ent/v2/img2video";
      rawBody = {
        model: effectiveModel || "vidu-q2-pro",
        prompt: textToUse,
        images: [firstFrameOverride || effectiveImages[0]],
        duration: effectiveDuration,
      };
    } else {
      // 文生视频
      submitPath = "/ent/v2/text2video";
      rawBody = {
        model: effectiveModel || "vidu-q2",
        prompt: textToUse,
        duration: effectiveDuration,
      };
    }
    if (selectedAspectRatio !== "auto") {
      rawBody.aspect_ratio = selectedAspectRatio;
    }
    if (selectedResolution) {
      rawBody.resolution = selectedResolution;
    }

    const payloadObj: Record<string, unknown> = {
      base_url: baseUrl,
      api_key: provider.apiKey,
      model: effectiveModel || "vidu-q2",
      prompt: textToUse,
      provider_type: "custom-video",
      api_format: "vidu",
      _submit_url_path: submitPath,
      _poll_url_path: "/ent/v2/tasks",
      _auth_header_style: "token",  // Vidu uses "Token" not "Bearer"
      _raw_body: JSON.stringify(rawBody),
    };
    console.log("[submitVideoJob] Vidu raw body:", rawBody);
    return await submitGenerateVideoJob(JSON.stringify(payloadObj)) as string;
  }

  // ── Google Veo Video Provider ──────────────────────────────────────
  // Uses _raw_body passthrough: frontend builds native Google Veo API JSON.
  // Google Veo via Gemini API:
  // Submit: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:predictLongRunning
  // Poll: GET https://generativelanguage.googleapis.com/v1beta/{operation_name}
  // Auth: x-goog-api-key {GEMINI_API_KEY} (NOT "Bearer"!)
  // Status: done=true | error in response
  // Video URL: response.generateVideoResponse.generatedSamples[0].video.uri
  if (isCustomVideoProvider && apiFormat === "veo") {
    const baseUrl = (provider.baseUrl || "").trim().replace(/\/+$/, "");
    // Default to Google's Gemini endpoint if user didn't specify a custom base
    const effectiveBaseUrl = baseUrl || "https://generativelanguage.googleapis.com";
    const effectiveModelName = effectiveModel || "veo-3.1-generate-preview";
    const submitPath = `/v1beta/models/${effectiveModelName}:predictLongRunning`;

    // Build Google Veo native format: {instances:[...], parameters:{...}}
    const instance: Record<string, unknown> = { prompt: textToUse };
    if (firstFrameOverride || effectiveImages.length > 0) {
      // Image-to-video: use inlineData format
      instance.image = {
        inlineData: {
          mimeType: "image/png",
          data: firstFrameOverride || effectiveImages[0],
        },
      };
    }
    if (lastFrameOverride) {
      instance.lastFrame = {
        inlineData: {
          mimeType: "image/png",
          data: lastFrameOverride,
        },
      };
    }
    const parameters: Record<string, unknown> = {
      aspectRatio: selectedAspectRatio === "auto" ? "16:9" : selectedAspectRatio,
      resolution: selectedResolution || "720p",
      durationSeconds: String(effectiveDuration),
      numberOfVideos: 1,
      personGeneration: "allow_all",
    };
    const rawBody = { instances: [instance], parameters };

    const payloadObj: Record<string, unknown> = {
      base_url: effectiveBaseUrl,
      api_key: provider.apiKey,
      model: effectiveModelName,
      prompt: textToUse,
      provider_type: "custom-video",
      api_format: "veo",
      _submit_url_path: submitPath,
      _poll_url_path: "/v1beta",
      _auth_header_style: "x-goog-api-key",  // Google uses x-goog-api-key header
      _raw_body: JSON.stringify(rawBody),
    };
    console.log("[submitVideoJob] Veo raw body:", rawBody);
    return await submitGenerateVideoJob(JSON.stringify(payloadObj)) as string;
  }

  // ── xAI Grok Video Provider (native) ───────────────────────────────
  // Uses _raw_body passthrough: frontend builds native xAI Grok API JSON.
  // xAI Grok official API: https://api.x.ai
  // Submit: POST /v1/videos/generations
  // Poll: GET /v1/videos/generations/{request_id}
  // Auth: Bearer {XAI_API_KEY}
  // Status: status="done" | "failed"
  // Video URL: video.url
  if (isCustomVideoProvider && apiFormat === "grok") {
    const baseUrl = (provider.baseUrl || "").trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
    const rawBody: Record<string, unknown> = {
      model: effectiveModel,
      prompt: textToUse,
      duration: effectiveDuration,
      resolution: selectedResolution || "720p",
    };
    // Grok image-to-video: image_url field
    if (firstFrameOverride) {
      rawBody.image_url = firstFrameOverride;
    } else if (effectiveImages.length > 0) {
      rawBody.image_url = effectiveImages[0];
    }

    const payloadObj: Record<string, unknown> = {
      base_url: baseUrl,
      api_key: provider.apiKey,
      model: effectiveModel,
      prompt: textToUse,
      provider_type: "custom-video",
      api_format: "grok",
      _submit_url_path: "/v1/videos/generations",
      _poll_url_path: "/v1/videos/generations",
      _raw_body: JSON.stringify(rawBody),
    };
    console.log("[submitVideoJob] Grok native raw body:", rawBody);
    return await submitGenerateVideoJob(JSON.stringify(payloadObj)) as string;
  }

  // ── OpenAI Sora Video Provider ──────────────────────────────────────
  // Uses _raw_body passthrough: frontend builds native Sora API JSON.
  // OpenAI Sora official API:
  // Submit: POST /v1/videos
  // Poll: GET /v1/videos/{video_id}
  // Content download: GET /v1/videos/{video_id}/content
  // Auth: Bearer {OPENAI_API_KEY}
  // Status: status="completed" | "failed"
  // Video URL: need to download from /v1/videos/{id}/content after completion
  if (isCustomVideoProvider && apiFormat === "sora") {
    const baseUrl = (provider.baseUrl || "").trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
    const effectiveModelName = effectiveModel || "sora-2";
    const rawBody: Record<string, unknown> = {
      model: effectiveModelName,
      prompt: textToUse,
    };
    // Sora uses "size" for resolution: pixel values like "1280x720" or shorthand like "720p"
    if (selectedResolution) {
      rawBody.size = selectedResolution;
    } else if (selectedAspectRatio !== "auto") {
      const dims = computeVideoDimensions(selectedAspectRatio, "720p");
      rawBody.size = dims.sizeWH;
    }
    // Sora uses "seconds" string for duration
    rawBody.seconds = String(effectiveDuration);
    // Sora image-to-video: input_reference field
    if (firstFrameOverride || effectiveImages.length > 0) {
      rawBody.input_reference = {
        image_url: firstFrameOverride || effectiveImages[0],
      };
    }

    const payloadObj: Record<string, unknown> = {
      base_url: baseUrl,
      api_key: provider.apiKey,
      model: effectiveModelName,
      prompt: textToUse,
      provider_type: "custom-video",
      api_format: "sora",
      _submit_url_path: "/v1/videos",
      _poll_url_path: "/v1/videos",
      _raw_body: JSON.stringify(rawBody),
    };
    console.log("[submitVideoJob] Sora raw body:", rawBody);
    return await submitGenerateVideoJob(JSON.stringify(payloadObj)) as string;
  }

  // ── Zhipu (智谱) CogVideo Video Provider ────────────────────────────
  // Uses _raw_body passthrough: frontend builds native Zhipu API JSON.
  // Zhipu official API: https://open.bigmodel.cn/api/paas/v4
  // Submit: POST /v4/videos/generations
  // Poll: GET /v4/async-result/{id}  (use id from submit response)
  // Auth: Bearer {ZHIPU_API_KEY}
  // Status: task_status="SUCCESS" | "FAIL"
  // Video URL: video_result.url
  if (isCustomVideoProvider && apiFormat === "zhipu") {
    const baseUrl = (provider.baseUrl || "").trim().replace(/\/+$/, "");
    const effectiveModelName = effectiveModel || "cogvideox-3";
    const rawBody: Record<string, unknown> = {
      model: effectiveModelName,
      prompt: textToUse,
      quality: "quality",
    };
    // Zhipu: size is pixel values like "1920x1080"
    if (selectedResolution) {
      rawBody.size = selectedResolution;
    } else if (selectedAspectRatio !== "auto") {
      const dims = computeVideoDimensions(selectedAspectRatio, "720p");
      rawBody.size = dims.sizeWH;
    }
    // Zhipu: duration options are 5 or 10
    rawBody.duration = effectiveDuration <= 5 ? 5 : 10;
    // Zhipu: audio generation
    rawBody.with_audio = generateAudio;
    // Zhipu: image_url for image-to-video (URL or base64)
    if (firstFrameOverride || effectiveImages.length > 0) {
      rawBody.image_url = firstFrameOverride || effectiveImages[0];
    }

    const payloadObj: Record<string, unknown> = {
      base_url: baseUrl,
      api_key: provider.apiKey,
      model: effectiveModelName,
      prompt: textToUse,
      provider_type: "custom-video",
      api_format: "zhipu",
      _submit_url_path: "/v4/videos/generations",
      _poll_url_path: "/v4/async-result",
      _raw_body: JSON.stringify(rawBody),
    };
    console.log("[submitVideoJob] Zhipu raw body:", rawBody);
    return await submitGenerateVideoJob(JSON.stringify(payloadObj)) as string;
  }

  // ── aicost.xyz Video Provider ──────────────────────────────────
  // aicost.xyz uses OpenAI Chat Completions format for Grok/Veo/Sora.
  // Submit: POST /v1/chat/completions
  // Poll: GET /v1/tasks/{task_id}
  // Response: {id, choices: [{message: {content: "video_url"}}]}  or  {task_id, status: "pending"}
  if (isCustomVideoProvider && apiFormat === "aicost") {
    const baseUrl = (provider.baseUrl || "").trim().replace(/\/+$/, "");
    const effectiveRatio = selectedAspectRatio === "auto" ? "16:9" : selectedAspectRatio;
    const dims = computeVideoDimensions(effectiveRatio, selectedResolution);

    // Build OpenAI Chat messages
    const contentParts: Record<string, unknown>[] = [];
    // Reference images as image_url parts
    const refImages = firstFrameOverride ? [firstFrameOverride] :
      effectiveImages.length > 0 ? effectiveImages : [];
    for (const img of refImages) {
      contentParts.push({ type: "image_url", image_url: { url: img } });
    }
    // Text prompt
    contentParts.push({ type: "text", text: textToUse });

    const modelSuffix = effectiveModel.startsWith("grok-imagine") ? `-${effectiveDuration}s` : "";

    const rawBody: Record<string, unknown> = {
      model: effectiveModel + modelSuffix,
      stream: false,
      messages: [{ role: "user", content: contentParts }],
      duration: effectiveDuration,
      seconds: effectiveDuration,
      aspect_ratio: effectiveRatio,
      size: dims.sizeWH,
      prompt: textToUse,
      generation_type: activeMode === "image2video" ? "首帧生成视频"
        : activeMode === "firstLastFrame" ? "首尾帧生成视频"
        : activeMode === "fullReference" ? "参考图生视频"
        : "文生视频",
      image_count: refImages.length,
      video_config: {
        seconds: effectiveDuration,
        duration: effectiveDuration,
        size: dims.sizeWH,
        aspect_ratio: effectiveRatio,
        resolution: (selectedResolution || "720p").toLowerCase(),
        resolution_name: (selectedResolution || "720p").toLowerCase(),
      },
    };

    const payloadObj: Record<string, unknown> = {
      base_url: baseUrl,
      api_key: provider.apiKey,
      model: effectiveModel + modelSuffix,
      prompt: textToUse,
      provider_type: "custom-video",
      api_format: "aicost",
      _submit_url_path: "/v1/chat/completions",
      _poll_url_path: "/v1/tasks",
      _raw_body: JSON.stringify(rawBody),
    };
    console.log("[submitVideoJob] aicost.xyz raw body:", rawBody);
    return await submitGenerateVideoJob(JSON.stringify(payloadObj)) as string;
  }

  // ── 爱享漫工厂 (axmgc.com) Video Provider ─────────────────────
  // axmgc uses content array (Chat-style) + model + aspect_ratio + duration
  // Submit: POST /v1/video/generations
  // Poll: GET /v1/video/generations/{task_id}
  // Response: {status:"succeeded", resource_list:[{resource_url:"..."}]}
  if (isCustomVideoProvider && apiFormat === "axmgc") {
    const baseUrl = (provider.baseUrl || "").trim().replace(/\/+$/, "");
    const effectiveRatio = selectedAspectRatio === "auto" ? "16:9" : selectedAspectRatio;

    // Build content array
    const contentArr: Record<string, unknown>[] = [];
    const refImages = firstFrameOverride ? [firstFrameOverride] :
      effectiveImages.length > 0 ? effectiveImages : [];
    for (const img of refImages) {
      contentArr.push({ type: "image_url", image_url: { url: img } });
    }
    // Text prompt
    contentArr.push({ type: "text", text: textToUse });

    const rawBody: Record<string, unknown> = {
      model: effectiveModel,
      content: contentArr,
      aspect_ratio: effectiveRatio,
      duration: 15,  // axmgc fixed 15s
    };

    const payloadObj: Record<string, unknown> = {
      base_url: baseUrl,
      api_key: provider.apiKey,
      model: effectiveModel,
      prompt: textToUse,
      provider_type: "custom-video",
      api_format: "axmgc",
      _submit_url_path: "/v1/video/generations",
      _poll_url_path: "/v1/video/generations",
      _raw_body: JSON.stringify(rawBody),
    };
    console.log("[submitVideoJob] axmgc raw body:", rawBody);
    return await submitGenerateVideoJob(JSON.stringify(payloadObj)) as string;
  }

  // ── 通用自定义通道 ──────────────────────────────────────────
  // 用户自己填 URL + Key + 请求体模板，Rust 自动识别响应格式
  if (isCustomVideoProvider && apiFormat === "custom") {
    const baseUrl = (provider.baseUrl || "").trim().replace(/\/+$/, "");
    const rawBody: Record<string, unknown> = {
      model: effectiveModel,
      prompt: textToUse,
      duration: effectiveDuration,
      seconds: effectiveDuration,
      aspect_ratio: selectedAspectRatio,
      ratio: selectedAspectRatio,
      resolution: selectedResolution,
      enable_sound: generateAudio,
    };
    const payloadObj: Record<string, unknown> = {
      base_url: baseUrl,
      api_key: provider.apiKey,
      model: effectiveModel,
      prompt: textToUse,
      provider_type: "custom-video",
      api_format: "custom",
      _submit_url_path: (provider as any)._submit_url_path || "/v1/videos",
      _poll_url_path: (provider as any)._poll_url_path || "/v1/videos",
      _status_field: (provider as any)._status_field || "",
      _done_value: (provider as any)._done_value || "",
      _video_url_field: (provider as any)._video_url_field || "",
      _auth_style: (provider as any)._auth_style || "bearer",
      _raw_body: JSON.stringify(rawBody),
    };
    console.log("[submitVideoJob] custom raw body:", rawBody);
    return await submitGenerateVideoJob(JSON.stringify(payloadObj)) as string;
  }

  // ── 云智 (Yunzhi) Video Provider ──────────────────────────────
  // 云智平台支持多种SD2/Grok/Veo模型，每种格式不同。
  // 采用 _raw_body 透传方案：前端构建完整 JSON，Rust 原样发送。
  // 所有格式差异在前端处理，无需改 Rust。
  // See: https://aiyunzhi.top docs
  if (isCustomVideoProvider && apiFormat === "yunzhi") {
    const baseUrl = (provider.baseUrl || "").trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
    const effectiveRatio = selectedAspectRatio === "auto" ? "16:9" : selectedAspectRatio;
    const modeType = activeMode === "image2video" ? "image2video"
      : activeMode === "firstLastFrame" ? "frames2video"
      : activeMode === "smartMultiframe" ? "frames2video"
      : activeMode === "fullReference" ? "fullReference"
      : activeMode === "videoReference" ? "video2video"
      : "text2video";

    // Collect reference images and videos
    const refImages: string[] = [];
    if (effectiveImages.length > 0) refImages.push(...effectiveImages);
    const refVideos: string[] = [];
    let refAudios: string[] = [...referencedAudioPaths];

    // Build the raw body based on model type
    const isSD2Model = effectiveModel.startsWith("sd2-") || effectiveModel.startsWith("sd-");
    let rawBody: Record<string, unknown>;

    if (isSD2Model) {
      // SD2 models via New API gateway (POST /v1/video/generations):
      // Per New API docs: model, prompt, duration, image (single string), metadata
      // Also send "images" array as fallback for relay APIs
      rawBody = {
        model: effectiveModel,
        prompt: textToUse,
        duration: effectiveDuration,
        // ── Per New API spec: "image" is a single string (URL or Base64) ──
        image: refImages.length > 0 ? refImages[0] : undefined,
        // ── Fallback: "images" array for relay APIs that expect array ──
        images: refImages.length > 0 ? refImages : undefined,
        videos: refVideos.length > 0 ? refVideos : undefined,
        audios: refAudios.length > 0 ? refAudios : undefined,
        metadata: {
          modeType: modeType,
          ratio: effectiveRatio,
          enableSound: generateAudio ? "on" : "off",
        },
      };
    } else {
      // Non-SD2 models (限时使用SD 2, Grok, Veo, etc.):
      // camelCase flat format with aspectRatio, referenceMode
      rawBody = {
        model: effectiveModel,
        prompt: textToUse,
        duration: `${effectiveDuration}s`,
        aspectRatio: effectiveRatio,
        images: refImages.length > 0 ? refImages : undefined,
        // 限时模型通过 audios 数组 + referenceMode 隐式触发音频
        // 即使没有参考音频文件，用户开了声音开关也要保留 audios 数组
        audios: generateAudio ? refAudios : (refAudios.length > 0 ? refAudios : undefined),
        referenceMode: generateAudio ? "multimodal" : (refImages.length > 0 ? "multimodal" : undefined),
      };
    }

    // Assemble the payload for Rust: include standard routing fields + _raw_body
    const payloadObj: Record<string, unknown> = {
      base_url: baseUrl,
      api_key: provider.apiKey,
      model: effectiveModel,
      prompt: textToUse,
      provider_type: "custom-video",
      api_format: "yunzhi",
      _submit_url_path: "/v1/videos",
      _poll_url_path: "/v1/videos",
      _raw_body: JSON.stringify(rawBody),
    };

    console.log("[submitVideoJob] 云智 raw body:", rawBody);

    return await submitGenerateVideoJob(JSON.stringify(payloadObj)) as string;
  }

  // ── Custom Video Provider (user-defined OpenAI-compatible API) ──
  // Uses /v1/videos format (New API / Sora compatible) — submit + poll
  // ── Custom video provider (openai format) ─────────────────────────
  // Also uses _raw_body passthrough for maximum flexibility.
  // The body is built with belt-and-suspenders fields (both aspect_ratio + ratio,
  // both duration + seconds) to work with any relay/proxy that expects OpenAI format.
  // GeekNow Grok: grok-video→multipart[size=P-label], grok-imagine→JSON[resolution]
  // xAI official Grok: size=WxH (grokXaiSizeMap)
  // Other APIs: size=WxH (computeVideoDimensions)
  if (isCustomVideoProvider) {
    const baseUrl = (provider.baseUrl || "").trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
    let effectiveRatio = selectedAspectRatio === "auto" ? "16:9" : selectedAspectRatio;
    const isGrokCustom = isGrokModel(effectiveModel);
    if (isGrokCustom && !["1:1", "2:3", "3:2", "16:9", "9:16"].includes(effectiveRatio)) {
      effectiveRatio = "16:9";
    }
    const isGeekNowBase = baseUrl.includes("geeknow");
    // GeekNow Grok: P-label size (Rust does ratio mapping), xAI: WxH
    const effectiveSize = (isGrokCustom && isGeekNowBase)
      ? selectedResolution  // P-label for GeekNow Grok
      : isGrokCustom
        ? grokXaiSizeMap(effectiveRatio)
        : computeVideoDimensions(effectiveRatio, selectedResolution).sizeWH;
    const dims = computeVideoDimensions(effectiveRatio, selectedResolution);
    // Map activeMode → mode_type so custom providers know the generation mode
    let customModeType = "text2video";
    let customFirstFrame: string | undefined;
    let customLastFrame: string | undefined;
    let customRefImages: string[] | undefined;
    switch (activeMode) {
      case "text2video": break;
      case "image2video":
        customModeType = "image2video";
        if (firstFrameOverride) customFirstFrame = firstFrameOverride;
        else if (effectiveImages.length > 0) customFirstFrame = effectiveImages[0];
        break;
      case "firstLastFrame":
        customModeType = "frames2video";
        if (firstFrameOverride) customFirstFrame = firstFrameOverride;
        else if (effectiveImages.length >= 1) customFirstFrame = effectiveImages[0];
        if (lastFrameOverride) customLastFrame = lastFrameOverride;
        else if (effectiveImages.length >= 2) customLastFrame = effectiveImages[1];
        break;
      case "fullReference":
        customModeType = "fullReference";
        if (effectiveImages.length > 0) { customFirstFrame = effectiveImages[0]; customRefImages = effectiveImages; }
        break;
      case "smartMultiframe":
        customModeType = "frames2video";
        if (firstFrameOverride) customFirstFrame = firstFrameOverride;
        else if (effectiveImages.length >= 1) customFirstFrame = effectiveImages[0];
        if (lastFrameOverride) customLastFrame = lastFrameOverride;
        else if (effectiveImages.length >= 2) customLastFrame = effectiveImages[1];
        if (effectiveImages.length > 0) customRefImages = effectiveImages;
        break;
      case "videoReference":
        customModeType = "video2video";
        if (effectiveImages.length > 0) { customFirstFrame = effectiveImages[0]; customRefImages = effectiveImages; }
        break;
      default:
        if (effectiveImages.length === 1) { customModeType = "image2video"; customFirstFrame = effectiveImages[0]; }
        else if (effectiveImages.length >= 2) { customModeType = "frames2video"; customFirstFrame = effectiveImages[0]; customLastFrame = effectiveImages[1]; }
    }
    // Build the raw body for OpenAI-compatible /v1/videos endpoint
    const rawBody: Record<string, unknown> = {
      model: effectiveModel,
      prompt: textToUse,
      mode_type: customModeType,
      seconds: String(effectiveDuration),
      duration: effectiveDuration,
      duration_s: `${effectiveDuration}s`,
      size: effectiveSize || undefined,
      resolution: selectedResolution,
      aspect_ratio: effectiveRatio,
      ratio: effectiveRatio,
      width: dims.width,
      height: dims.height,
    };
    // Include reference images for i2v / fusion modes
    // Send ALL common field names for maximum relay compatibility
    // (different relays / new-api forks check different fields)
    if (customRefImages && customRefImages.length > 0) {
      rawBody.reference_images = customRefImages;
      rawBody.image = customFirstFrame || customRefImages[0];
    }
    if (customFirstFrame) {
      rawBody.image = customFirstFrame;
    }
    if (customLastFrame) {
      rawBody.last_frame_image = customLastFrame;
    }
    if (effectiveImages.length > 0 && !customRefImages) {
      rawBody.reference_images = effectiveImages;
      // Send image as single for APIs that expect single image_url
      rawBody.image = effectiveImages[0];
    }
    // Audio: send all three formats (string / bool / string-bool) for relay compat
    if (generateAudio) {
      rawBody.enable_sound = "on";
      rawBody.enable_audio = true;
    } else {
      rawBody.enable_sound = "off";
      rawBody.enable_audio = false;
    }
    if (referencedAudioPaths.length > 0) {
      rawBody.audios = referencedAudioPaths;
      rawBody.audio_paths = referencedAudioPaths;
    }

    const payloadObj: Record<string, unknown> = {
      base_url: baseUrl,
      api_key: provider.apiKey,
      model: effectiveModel,
      prompt: textToUse,
      provider_type: "custom-video",
      api_format: "openai",
      _submit_url_path: "/v1/videos",
      _poll_url_path: "/v1/videos",
      _raw_body: JSON.stringify(rawBody),
    };

    console.log("[submitVideoJob] Custom video raw body:", {
      base_url: baseUrl,
      model: effectiveModel,
      seconds: effectiveDuration,
      imagesCount: effectiveImages.length,
    });

    return await submitGenerateVideoJob(JSON.stringify(payloadObj)) as string;
  }

  const effectiveMaxImages = isMinSeries ? 4 : 9;
  if (!isGrok && effectiveImages.length > effectiveMaxImages) {
    addToast("warning", `引用了 ${effectiveImages.length} 张图，${isMinSeries ? "Mini" : "该"}模型最多支持 ${effectiveMaxImages} 张，已自动截断`);
    effectiveImages = effectiveImages.slice(0, effectiveMaxImages);
  }

  let modeType = "text2video";
  let firstFrame: string | undefined;
  let lastFrame: string | undefined;
  let refImages: string[] | undefined;

  if (isGrok) {
    // Grok video: simpler mode mapping — images become input_reference
    // No explicit mode_type needed; images are sent as reference files
  } else {
    switch (activeMode) {
      case "text2video":
        // text2video uses no images — effectiveImages already cleared by handleGenerate
        break;
      case "image2video":
        modeType = "image2video";
        // Prefer slot upload; fallback to @引用
        if (firstFrameOverride) firstFrame = firstFrameOverride;
        else if (effectiveImages.length > 0) firstFrame = effectiveImages[0];
        break;
      case "firstLastFrame":
        modeType = "frames2video";
        // Use override values (from dedicated slot) if available, fallback to effectiveImages
        if (firstFrameOverride) firstFrame = firstFrameOverride;
        else if (effectiveImages.length >= 1) firstFrame = effectiveImages[0];
        if (lastFrameOverride) lastFrame = lastFrameOverride;
        else if (effectiveImages.length >= 2) lastFrame = effectiveImages[1];
        break;
      case "fullReference":
        modeType = "image2video"; if (effectiveImages.length > 0) { firstFrame = effectiveImages[0]; refImages = effectiveImages; }
        break;
      case "smartMultiframe":
        modeType = "frames2video";
        // Similar to firstLastFrame but supports multiple reference frames
        if (firstFrameOverride) firstFrame = firstFrameOverride;
        else if (effectiveImages.length >= 1) firstFrame = effectiveImages[0];
        if (lastFrameOverride) lastFrame = lastFrameOverride;
        else if (effectiveImages.length >= 2) lastFrame = effectiveImages[1];
        if (effectiveImages.length > 0) refImages = effectiveImages;
        break;
      case "videoReference":
        modeType = "video2video";
        if (effectiveImages.length > 0) { firstFrame = effectiveImages[0]; refImages = effectiveImages; }
        break;
      default:
        if (effectiveImages.length === 1) { modeType = "image2video"; firstFrame = effectiveImages[0]; }
        else if (effectiveImages.length >= 2) { modeType = "frames2video"; firstFrame = effectiveImages[0]; lastFrame = effectiveImages[1]; }
    }
  }

  // Grok video uses different API: POST /v1/videos with multipart/form-data (GeekNow) or JSON
  if (isGrok) {
    let grokImages: string[] = [...effectiveImages];
    if (activeMode === "image2video" || activeMode === "firstLastFrame") {
      if (firstFrameOverride && !grokImages.includes(firstFrameOverride)) {
        grokImages = [firstFrameOverride, ...grokImages].slice(0, 9);
      }
      if (lastFrameOverride && !grokImages.includes(lastFrameOverride)) {
        grokImages.push(lastFrameOverride);
      }
    }
    let grokAspectRatio = selectedAspectRatio;
    if (grokAspectRatio === "auto" || !["1:1", "2:3", "3:2", "16:9", "9:16"].includes(grokAspectRatio)) {
      grokAspectRatio = "16:9";
    }

    // ── Official docs ──────────────────────────────────────
    // ── GeekNow Grok: JSON with P-label (Rust handles ratio mapping) ──
    const isGrokGeekNow = (provider.baseUrl || "").includes("geeknow");
    const grokSize = isGrokGeekNow
      ? selectedResolution  // P-label for GeekNow
      : grokXaiSizeMap(grokAspectRatio);
    const grokDims = computeVideoDimensions(grokAspectRatio, selectedResolution);
    const payloadObj: Record<string, unknown> = {
      base_url: provider.baseUrl || "https://grsaiapi.com",
      api_key: provider.apiKey,
      model: effectiveModel,
      prompt: textToUse,
      aspect_ratio: grokAspectRatio,
      seconds: effectiveDuration,
      size: grokSize,
      resolution: selectedResolution,
      width: grokDims.width,
      height: grokDims.height,
    };
    payloadObj.input_reference_images = grokImages;
    // Grok supports synchronous audio generation via "sound" parameter
    if (generateAudio) {
      payloadObj.enable_sound = "on";
    } else {
      payloadObj.enable_sound = "off";
    }
    // Grok does not support audio reference input — but pass for consistency
    if (referencedAudioPaths.length > 0) {
      payloadObj.audio_path = referencedAudioPaths[0];
      payloadObj.audio_paths = referencedAudioPaths;
    }

    return await submitGenerateVideoJob(JSON.stringify(payloadObj)) as string;
  }

  // Jimeng Official — prefer browser automation (Playwright), fallback to HTTP API
  const isJimengOfficial = provider.id === "jimeng-official";
  if (isJimengOfficial) {
    let browserGenerationAttempted = false;
    let browserFailReason = "";

    // Check if browser automation is available
    try {
      const env = await jimengBrowserCheckEnv();
      if (env.playwright_installed && env.browser_found) {
        // Use browser automation mode (more stable, no 502 errors)
        const browserParams: Record<string, unknown> = {
          prompt: textToUse,
          model: effectiveModel,
          // Pass the actual canvas mode directly — the Python script maps it to UI labels
          mode: activeMode,
          duration: effectiveDuration,
          aspect_ratio: selectedAspectRatio === "auto" ? "16:9" : selectedAspectRatio,
          timeout: 900,
          first_frame_path: firstFrame || undefined,
          last_frame_path: lastFrame || undefined,
          ref_image_paths: effectiveImages || [],
          enable_sound: generateAudio ? "on" : "off",
          audio_paths: referencedAudioPaths.length > 0 ? referencedAudioPaths : undefined,
          video_reference: videoReferenceOverride || undefined,
        };

        browserGenerationAttempted = true;
        // Browser automation returns the final video path directly
        // Prefix with "browser:" so handleGenerate can distinguish from async jobId
        const result = await jimengBrowserGenerate(browserParams);
        const videoPath = result.video_path || result.video_url;
        if (videoPath) {
          return `browser:${videoPath}`;
        }
        browserFailReason = "浏览器自动化未返回视频路径";
      } else {
        console.warn("[VideoNode] Browser automation env:", env);
      }
    } catch (e) {
      console.error("[VideoNode] Browser automation error:", e);
      if (browserGenerationAttempted) {
        // Browser generation was attempted but failed → don't silently fall through
        browserFailReason = e instanceof Error ? e.message : String(e);
      }
    }

    if (browserGenerationAttempted && browserFailReason) {
      throw new Error(`浏览器自动化失败: ${browserFailReason}。HTTP API 当前可能也不可用(502)。建议: 1) 确认已点击"浏览器登录"并登录即梦; 2) 稍后重试。`);
    }

    // Fallback: HTTP API with sessionid
    const jimengPayload: Record<string, unknown> = {
      model: effectiveModel,
      prompt: textToUse,
      ratio: selectedAspectRatio === "auto" ? "16:9" : selectedAspectRatio,
      duration: effectiveDuration,
      resolution: selectedResolution.toLowerCase(),
      first_frame: firstFrame || undefined,
      last_frame: lastFrame || undefined,
      enable_sound: generateAudio ? "on" : "off",
      audio_path: referencedAudioPaths.length > 0 ? referencedAudioPaths[0] : undefined,
      audio_paths: referencedAudioPaths.length > 0 ? referencedAudioPaths : undefined,
      video_reference: videoReferenceOverride || undefined,
    };
    // Image references: always pass when available (not just fullReference mode)
    if (effectiveImages && effectiveImages.length > 0) {
      jimengPayload.ref_images = effectiveImages;
    }
    // 全能参考模式：明确标记 mode_type
    if (activeMode === "fullReference") {
      jimengPayload.mode_type = "fullReference";
    }
    return await jimengSubmitVideo(JSON.stringify(jimengPayload)) as string;
  }

  // VJimeng (default) video generation
  const isBuiltinSd2Cloud = provider.id === "vjimeng" || provider.id === "vjimeng-sd2";
  const seedanceCloudLicenseKey = (siteVideoConfig?.seedanceCloudLicenseKey || siteVideoConfig?.seedanceCloudUserId || provider.apiKey || "").trim();
  const seedanceCloudBaseUrl = (siteVideoConfig?.seedanceCloudBaseUrl || "https://sd2.xiakeman.com/api").trim();
  const payloadObj: Record<string, unknown> = {
    base_url: isBuiltinSd2Cloud ? seedanceCloudBaseUrl : (provider.baseUrl || "https://api.shishikeji.com"),
    api_key: isBuiltinSd2Cloud ? seedanceCloudLicenseKey : provider.apiKey,
    api_format: isBuiltinSd2Cloud ? "seedance-cloud" : undefined,
    seedance_cloud_base_url: isBuiltinSd2Cloud ? seedanceCloudBaseUrl : undefined,
    seedance_cloud_license_key: isBuiltinSd2Cloud ? seedanceCloudLicenseKey : undefined,
    model: effectiveModel,
    prompt: textToUse,
    duration: effectiveDuration,
    mode_type: modeType,
    ratio: selectedAspectRatio === "auto" ? "16:9" : selectedAspectRatio,
    enable_sound: generateAudio ? "on" : "off",
    resolution: selectedResolution,
  };

  if (lastFrame) payloadObj.last_frame = lastFrame;
  if (videoReferenceOverride) payloadObj.video_reference = videoReferenceOverride;
  if (refImages && refImages.length > 0) {
    payloadObj.reference_images = refImages;
    // Also include first_frame from slot if available
    if (firstFrame) payloadObj.first_frame = firstFrame;
  } else if (effectiveImages.length > 0) {
    if (firstFrame) payloadObj.first_frame = firstFrame;
    payloadObj.images = effectiveImages;
  } else if (firstFrame) {
    // Only slot image, no @引用 — send as single image
    payloadObj.first_frame = firstFrame;
    payloadObj.images = [firstFrame];
  }

  // Collect audio paths
  const allAudioPaths: string[] = [...referencedAudioPaths];
  if (allAudioPaths.length === 0) {
    const { nodes: currentNodes, edges: currentEdges } = useCanvasStore.getState();
    for (const edge of currentEdges.filter((e) => e.target === id)) {
      const srcNode = currentNodes.find((n) => n.id === edge.source);
      if (srcNode?.type === CANVAS_NODE_TYPES.audio) {
        const audioData = srcNode.data as Record<string, unknown>;
        const p = (audioData.generatedAudioPath as string) || (audioData.audioPath as string);
        if (p) allAudioPaths.push(p);
      }
    }
  }
  if (allAudioPaths.length > 0) {
    payloadObj.audio_path = allAudioPaths[0];
    payloadObj.audio_paths = allAudioPaths;
    payloadObj.audios = allAudioPaths;
  }

  console.log("[submitVideoJob] Final payload:", {
    base_url: payloadObj.base_url,
    model: payloadObj.model,
    mode_type: payloadObj.mode_type,
    imagesCount: (payloadObj.images as string[])?.length,
    referenceImagesCount: (payloadObj.reference_images as string[])?.length,
    firstFrame: (payloadObj.first_frame as string)?.substring(0, 80),
    duration: payloadObj.duration,
    ratio: payloadObj.ratio,
    enable_sound: payloadObj.enable_sound,
  });

  return await submitGenerateVideoJob(JSON.stringify(payloadObj)) as string;
}

// ─── Component ────────────────────────────────────────────────────────────

export const VideoNode = memo(function VideoNode({ data, id, selected }: NodeProps) {
  const { state: projectState } = useProject();
  const nodeData = data as unknown as VideoNodeData;
  const [prompt, setPrompt] = useState(nodeData.prompt || "");
  const [inputText, setInputText] = useState(nodeData.prompt || "");
  const initialMode = nodeData.videoMode === "imageReference" ? "fullReference" : (nodeData.videoMode || "text2video");
  const [activeMode, setActiveMode] = useState<typeof VIDEO_MODES[number]["id"]>(initialMode);
  const [isGeneratingRaw, setIsGeneratingRaw] = useState(nodeData.isGenerating || false);
  const isGeneratingRef = useRef(nodeData.isGenerating || false);
  const setIsGenerating = useCallback((val: boolean) => {
    isGeneratingRef.current = val;
    setIsGeneratingRaw(val);
  }, []);
  const isGenerating = isGeneratingRaw;
  // Track active job IDs for true concurrent generation (enterprise)
  const activeJobIdsRef = useRef<Set<string>>(new Set());
  const onJobCompleteRef = useRef<(jobId: string) => void>(() => {});
  onJobCompleteRef.current = (jobId: string) => {
    activeJobIdsRef.current.delete(jobId);
    if (activeJobIdsRef.current.size === 0) {
      isGeneratingRef.current = false;
      setIsGeneratingRaw(false);
      updateNodeData(id, { isGenerating: false, generationJobId: null, generationStartedAt: null });
    }
  };
  const activePollsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  // ── Store cancel function from active pollJob so we can cancel it when starting a new generation ──
  const pollCancelRef = useRef<(() => void) | null>(null);
  const autoStartNonceRef = useRef<number | null>(null);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [_anyMenuOpen, setAnyMenuOpen] = useState(false);

  const [selectedProviderId, setSelectedProviderId] = useState(() => {
    // Eager-read from store to avoid cascade re-render on mount
    const vm = useSettingsStore.getState().providers.find((p: any) => p.id === "video-model");
    const channel = vm?.channel || "";
    return nodeData.providerId || nodeData.provider || channel || "vjimeng";
  });

  // Sync providerId only when it genuinely changes (not on mount)
  const provRef = useRef(selectedProviderId);
  useEffect(() => {
    const vm = useSettingsStore.getState().providers.find((p: any) => p.id === "video-model");
    const newId = vm?.channel || nodeData.providerId || nodeData.provider || "";
    if (newId && newId !== provRef.current) {
      provRef.current = newId;
      setSelectedProviderId(newId);
      updateNodeData(id, { providerId: newId, provider: newId });
    }
  }, [nodeData.providerId, nodeData.provider]);

  const providers = useSettingsStore((s) => s.providers);
  const customProviders = useSettingsStore((s) => s.customProviders);

  // Look up provider by channel ID directly (e.g. "geeknow" or "vjimeng"),
  // with fallback to video-model for backward compatibility
  const currentProviderConfig = useMemo(() => {
    // 1. Direct match: provider.id === selectedProviderId (e.g. "geeknow" or "vjimeng")
    const directMatch = providers.find((p) => p.id === selectedProviderId && p.apiKey);
    if (directMatch) return directMatch;
    // 2. Channel-based match via video-model (backward compat)
    const videoModel = providers.find((p) => p.id === "video-model");
    if (videoModel?.apiKey && (videoModel.channel === selectedProviderId || !videoModel.channel)) {
      return videoModel;
    }
    // 3. Custom providers
    const customMatch = customProviders.find((p) => p.id === selectedProviderId && p.apiKey);
    if (customMatch) return { id: customMatch.id, name: customMatch.name, apiKey: customMatch.apiKey, baseUrl: customMatch.baseUrl, channel: customMatch.id, enabled: true, modelName: customMatch.models || "" };
    // 4. Exact match even without apiKey (for non-credential config like modelName)
    const exactMatch = providers.find((p) => p.id === selectedProviderId);
    if (exactMatch) return exactMatch;
    // 5. Fallback: video-model
    return providers.find((p) => p.id === "video-model");
  }, [selectedProviderId, providers, customProviders]);

  const videoModels = useMemo(() => parseVideoModels(currentProviderConfig?.modelName, selectedProviderId), [currentProviderConfig?.modelName, selectedProviderId]);
  const defaultModel = useMemo(() => getDefaultVideoModel(currentProviderConfig?.modelName, selectedProviderId), [currentProviderConfig?.modelName, selectedProviderId]);

  const [selectedModel, setSelectedModel] = useState(nodeData.model || defaultModel);
  const [customVideoModelId, setCustomVideoModelId] = useState(() => {
    const initial = String(nodeData.model || "").trim();
    return initial && !videoModels.some((m) => m.id === initial) ? initial : "";
  });
  const availableVideoModels = useMemo(() => {
    const customId = customVideoModelId.trim();
    if (!customId || videoModels.some((m) => m.id === customId)) return videoModels;
    return [...videoModels, { id: customId, label: `自定义：${customId}` }];
  }, [videoModels, customVideoModelId]);

  // VideoNode's own parsed models are the source of truth — do NOT merge with useChannelModelSelector's fallback
  const { availableProviders } = useChannelModelSelector("video", selectedProviderId, availableVideoModels.map((m) => ({ id: m.id, label: m.label, providerId: selectedProviderId })));

  const updateNodeData = useCanvasStore((s) => s.updateNodeData);

  // Auto-fix selectedModel when the available model list changes and current selection is no longer valid.
  useEffect(() => {
    if (availableVideoModels.length > 0 && !availableVideoModels.some((m) => m.id === selectedModel)) {
      if (customVideoModelId.trim()) return;
      const newDefault = defaultModel || availableVideoModels[0].id;
      setSelectedModel(newDefault);
      updateNodeData(id, { model: newDefault });
    }
  }, [availableVideoModels, selectedModel, defaultModel, customVideoModelId, id, updateNodeData]);

  const [generateCount, setGenerateCount] = useState(1);
  const [showCountMenu, setShowCountMenu] = useState(false);
  const [showParamsPanel, setShowParamsPanel] = useState(false);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState("16:9");
  const [selectedResolution, setSelectedResolution] = useState("720P");
  const [duration, setDuration] = useState(4);
  const [generateAudio, setGenerateAudio] = useState(false);

  // 价格显示（元/秒）— XioArtTV 通道显示
  const isCustomProvider = customProviders.some((p: any) => p.id === selectedProviderId);
  const showPrice = selectedProviderId === "vjimeng" || selectedProviderId === "vjimeng-sd2";
  const priceYuanPerSec = (VIDEO_CREDIT_PRICES[selectedModel] ?? 80) / 100;
  const totalPriceYuan = Math.ceil(priceYuanPerSec * duration * 100) / 100;

  // ── First/Last frame slots for 首尾帧 mode ──
  const [firstFrameImage, setFirstFrameImage] = useState<string | null>(nodeData.firstFrameImage || null);
  const [lastFrameImage, setLastFrameImage] = useState<string | null>(nodeData.lastFrameImage || null);
  const firstFrameSlotRef = useRef<HTMLInputElement>(null);
  const lastFrameSlotRef = useRef<HTMLInputElement>(null);
  const [firstFrameDragOver, setFirstFrameDragOver] = useState(false);
  const [lastFrameDragOver, setLastFrameDragOver] = useState(false);
  const [videoReference, setVideoReference] = useState<string | null>(nodeData.videoReferencePath || null);
  const videoRefSlotRef = useRef<HTMLInputElement>(null);
  const cursorPosRef = useRef<number>(0); // track cursor position for reference insertion
  const [videoRefDragOver, setVideoRefDragOver] = useState(false);

  // Sync frame images from node data
  useEffect(() => {
    if (nodeData.firstFrameImage !== undefined && nodeData.firstFrameImage !== firstFrameImage) setFirstFrameImage(nodeData.firstFrameImage);
    if (nodeData.lastFrameImage !== undefined && nodeData.lastFrameImage !== lastFrameImage) setLastFrameImage(nodeData.lastFrameImage);
    if (nodeData.videoReferencePath !== undefined && nodeData.videoReferencePath !== videoReference) setVideoReference(nodeData.videoReferencePath);
  }, [nodeData.firstFrameImage, nodeData.lastFrameImage, nodeData.videoReferencePath]);

  // Handle file upload for frame slots
  const handleFrameFileUpload = useCallback(async (file: File, slot: "first" | "last") => {
    const toastFn = useToastStore.getState().addToast;
    try {
      const result = await prepareNodeImageFromFile(file);
      if (result) {
        const imgPath = result.path;
        if (slot === "first") { setFirstFrameImage(imgPath); updateNodeData(id, { firstFrameImage: imgPath }); }
        else { setLastFrameImage(imgPath); updateNodeData(id, { lastFrameImage: imgPath }); }
      }
    } catch (e) {
      toastFn("error", `图片上传失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [id, updateNodeData]);

  const handleFrameSlotClick = useCallback(async (slot: "first" | "last") => {
    try {
      const { open } = await import("@/features/canvas/compat/dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] }],
      });
      if (selected) {
        const filePath = selected as string;
        if (slot === "first") { setFirstFrameImage(filePath); updateNodeData(id, { firstFrameImage: filePath }); }
        else { setLastFrameImage(filePath); updateNodeData(id, { lastFrameImage: filePath }); }
      }
    } catch {
      // Fallback: use file input
      if (slot === "first") firstFrameSlotRef.current?.click();
      else lastFrameSlotRef.current?.click();
    }
  }, [id, updateNodeData]);

  const handleFrameFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>, slot: "first" | "last") => {
    const file = e.target.files?.[0];
    if (file) handleFrameFileUpload(file, slot);
    e.target.value = "";
  }, [handleFrameFileUpload]);

  const handleFrameDrop = useCallback((e: React.DragEvent, slot: "first" | "last") => {
    e.preventDefault();
    e.stopPropagation();
    if (slot === "first") setFirstFrameDragOver(false);
    else setLastFrameDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleFrameFileUpload(file, slot);
  }, [handleFrameFileUpload]);

  const handleFrameDragOver = useCallback((e: React.DragEvent, slot: "first" | "last") => {
    e.preventDefault();
    e.stopPropagation();
    if (slot === "first") setFirstFrameDragOver(true);
    else setLastFrameDragOver(true);
  }, []);

  const handleFrameDragLeave = useCallback((e: React.DragEvent, slot: "first" | "last") => {
    e.preventDefault();
    if (slot === "first") setFirstFrameDragOver(false);
    else setLastFrameDragOver(false);
  }, []);

  const clearFrameImage = useCallback((slot: "first" | "last") => {
    if (slot === "first") { setFirstFrameImage(null); updateNodeData(id, { firstFrameImage: null }); }
    else { setLastFrameImage(null); updateNodeData(id, { lastFrameImage: null }); }
  }, [id, updateNodeData]);

  // Allow dropping upstream reference images into frame slots
  const handleDropRefToFrame = useCallback((entry: ReferenceImageEntry, slot: "first" | "last") => {
    if (slot === "first") { setFirstFrameImage(entry.url); updateNodeData(id, { firstFrameImage: entry.url }); }
    else { setLastFrameImage(entry.url); updateNodeData(id, { lastFrameImage: entry.url }); }
  }, [id, updateNodeData]);

  // Handle video file upload for video reference slot
  const handleVideoRefFileUpload = useCallback(async (file: File) => {
    const toastFn = useToastStore.getState().addToast;
    try {
      if (!file.type.startsWith("video/")) {
        toastFn("error", "请上传视频文件（MP4/MOV）");
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        toastFn("error", "视频文件不能超过 50MB");
        return;
      }
      const result = await prepareNodeImageFromFile(file);
      if (!result) { toastFn("error", "视频上传失败"); return; }
      const path = result.path;
      setVideoReference(path);
      updateNodeData(id, { videoReferencePath: path });
      toastFn("success", "视频参考已上传");
    } catch (err) {
      toastFn("error", `视频上传失败: ${err}`);
    }
  }, [id, updateNodeData]);

  const handleVideoRefFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleVideoRefFileUpload(file);
    e.target.value = "";
  }, [handleVideoRefFileUpload]);

  const handleVideoRefDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setVideoRefDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleVideoRefFileUpload(file);
  }, [handleVideoRefFileUpload]);

  const handleVideoRefDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setVideoRefDragOver(true);
  }, []);

  const handleVideoRefDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setVideoRefDragOver(false);
  }, []);

  const clearVideoReference = useCallback(() => {
    setVideoReference(null);
    updateNodeData(id, { videoReferencePath: null });
  }, [id, updateNodeData]);

  const currentIsGrok = isGrokModel(selectedModel);
  const currentIsVjimeng = selectedProviderId === "vjimeng" || selectedProviderId === "vjimeng-sd2";
  const currentIsJimengOfficial = selectedProviderId === "jimeng-official";
  // Detect Luma/Runway (channels that do NOT support audio generation)
  const customProviderConfig = customProviders.find((p: any) => p.id === selectedProviderId);
  const currentApiFormat = customProviderConfig?.apiFormat || "";
  const audioNotSupported = currentApiFormat === "luma" || currentApiFormat === "runway";
  // Dynamic mode list based on channel (also check model name for custom channels using Grok models)
  const currentVideoModes = useMemo(() => {
    if (currentIsVjimeng) return VJIMENG_VIDEO_MODES;
    if (currentIsJimengOfficial) return JIMENG_OFFICIAL_VIDEO_MODES;
    return ALL_VIDEO_MODES;
  }, [currentIsVjimeng, currentIsJimengOfficial]);
  const currentAspectRatios = currentIsVjimeng ? XIOARTTV_ASPECT_RATIOS : ASPECT_RATIOS;
  const baseResolutions = currentIsVjimeng ? XIOARTTV_RESOLUTIONS : RESOLUTIONS;
  // Resolution constraints: mini/fast only 720p, sd2-720p series only 720p, sd2-1080p series only 1080p.
  const currentIsSd2Channel = selectedProviderId === "vjimeng-sd2";
  const currentIsKnownMiniFast = ["transit9-mini", "transit9-fast", "xinghe-mini", "xinghe-fast"].includes(selectedModel);
  const currentResolutions = currentIsVjimeng && currentIsKnownMiniFast && !currentIsSd2Channel
    ? baseResolutions.filter(r => r.value === "720P")
    : currentIsSd2Channel && selectedModel.startsWith("sd2-720p")
    ? baseResolutions.filter(r => r.value === "720P")
    : currentIsSd2Channel && selectedModel.startsWith("sd2-1080p")
    ? baseResolutions.filter(r => r.value === "1080P")
    : baseResolutions;

  // Auto-fix aspect ratio when switching to/from XioArtTV channel
  useEffect(() => {
    if (currentIsVjimeng && !XIOARTTV_ASPECT_RATIOS.some(r => r.value === selectedAspectRatio)) {
      setSelectedAspectRatio("16:9");
    }
  }, [currentIsVjimeng, selectedAspectRatio]);

  // Auto-fix resolution when switching to XioArtTV channel
  useEffect(() => {
    if (currentIsVjimeng && !XIOARTTV_RESOLUTIONS.some(r => r.value === selectedResolution)) {
      setSelectedResolution("720P");
    }
  }, [currentIsVjimeng, selectedResolution, selectedModel]);

  // Auto-fix activeMode when current channel doesn't support it
  useEffect(() => {
    if (!currentVideoModes.some(m => m.id === activeMode)) {
      const fallback = "text2video";
      setActiveMode(fallback);
      updateNodeData(id, { videoMode: fallback });
    }
  }, [currentVideoModes, activeMode, id, updateNodeData]);

  // Cleanup all active polling timers on unmount
  useEffect(() => {
    return () => {
      activePollsRef.current.forEach(t => clearTimeout(t));
      activePollsRef.current.clear();
    };
  }, []);

  // ── Listen for real-time progress events from Rust (bypasses DB latency) ──
  useEffect(() => {
    let unlisten1: (() => void) | undefined;
    let unlisten2: (() => void) | undefined;
    import("@/features/canvas/compat/event").then(({ listen }) => {
      // 1) grsai/credits API progress (via DB + atomic)
      listen<{ jobId: string; progress: number }>("generation-progress", (event) => {
        const { progress } = event.payload;
        if (progress >= 0 && isGeneratingRef.current) {
          const resultNodeId = (useCanvasStore.getState().nodes.find(n => n.id === id)?.data as any)?.resultNodeId;
          if (resultNodeId) {
            useCanvasStore.getState().updateNodeData(resultNodeId, { progressPercent: Math.round(progress) });
          }
        }
      }).then((fn) => { unlisten1 = fn; });

      // 2) jimeng browser automation progress (Playwright stdout line-by-line)
      listen<{ percent: number; stage: string; message: string }>("jimeng-browser-progress", (event) => {
        const { percent, stage, message } = event.payload;
        if (isGeneratingRef.current) {
          const resultNodeId = (useCanvasStore.getState().nodes.find(n => n.id === id)?.data as any)?.resultNodeId;
          if (resultNodeId) {
            useCanvasStore.getState().updateNodeData(resultNodeId, {
              progressPercent: Math.round(percent),
              generationPhase: stage,
            });
          }
        }
      }).then((fn) => { unlisten2 = fn; });
    });
    return () => { unlisten1?.(); unlisten2?.(); };
  }, [id]);

  const addNode = useCanvasStore((s) => s.addNode);
  const addEdge = useCanvasStore((s) => s.addEdge);
  const setEdges = useCanvasStore((s) => s.setEdges);
  const addToast = useToastStore((s) => s.addToast);
  const upstreamDataKey = useUpstreamDataKey(id);

  const assets = useAssetStore((s) => s.allAssets);
  const assetPool = useMemo(() => buildAssetImagePool(assets), [assets]);
  const persistedAssets = nodeData.referencedAssets;

  // Only include persisted assets that are ACTUALLY REFERENCED in the current prompt.
  // Stale persisted entries (from previous sessions) must not pollute the ReferenceStrip.
  const activePersistedAssets = useMemo(() => {
    if (!persistedAssets || persistedAssets.length === 0) return [];
    const referencedNums = collectReferencedImageNumbers(inputText || prompt);
    if (referencedNums.length === 0) return [];
    // Build a temporary pool of just upstream entries (no persisted) to resolve @图N numbers
    const { nodes, edges } = useCanvasStore.getState();
    const upstreamPool = buildReferenceImagePool(id, nodes, edges, undefined, []);
    const activeUrls = new Set<string>();
    for (const num of referencedNums) {
      const entry = upstreamPool.getByNumber(num);
      if (entry) activeUrls.add(normalizeUrl(entry.url));
    }
    // Also include persisted assets whose URLs match any actively-referenced number's resolved URL
    // This handles the case where @图N resolves to a persisted asset from a previous render
    return persistedAssets.filter(pa =>
      activeUrls.has(normalizeUrl(pa.url))
    );
  }, [persistedAssets, inputText, prompt, id, upstreamDataKey]);

  const pool = useMemo(
    () => { const { nodes, edges } = useCanvasStore.getState(); return buildReferenceImagePool(id, nodes, edges, assetPool, activePersistedAssets); },
    [id, upstreamDataKey, assetPool, activePersistedAssets]
  );

  // @图N numbers referenced in the prompt — asset library images only show when @-referenced
  const allRefNumbers = useMemo(
    () => new Set(collectReferencedImageNumbers(prompt)),
    [prompt]
  );

  // Keep all reference entries available in the prompt input.
  // Generation mode decides how images are used; the @ menu should never hide images.
  const promptPool = pool;

  // Persist referenced asset images — only persist entries that actually
  // exist in the live asset pool (not entries added by persistedAssets itself)
  useEffect(() => {
    const referencedNums = collectReferencedImageNumbers(prompt);
    const newPersisted: { url: string; thumbnailUrl?: string; name?: string }[] = [];
    for (const num of referencedNums) {
      const entry = pool.getByNumber(num);
      // Only persist if the entry is from the LIVE asset pool (not circular from previous persists)
      if (entry && entry.source === "asset" && entry.assetId && entry.sourceNodeId !== "persisted-asset") {
        newPersisted.push({ url: entry.url, thumbnailUrl: entry.thumbnailUrl, name: entry.sourceNodeName });
      }
    }
    const current = nodeData.referencedAssets || [];
    const isSame = current.length === newPersisted.length && current.every((c, i) => c.url === newPersisted[i].url && c.name === newPersisted[i].name);
    if (!isSame) updateNodeData(id, { referencedAssets: newPersisted });
  }, [prompt, pool, id, updateNodeData]);

  // Handle deleting a reference
  const handleDeleteRefEntry = useCallback(
    (entry: ReferenceImageEntry) => {
      const newPrompt = removeReferenceTokenByNumber(inputText || prompt, entry.number);
      setInputText(newPrompt);
      handlePromptChange(newPrompt);
      if (entry.source === "upstream" && entry.sourceNodeId) {
        const { edges } = useCanvasStore.getState();
        const remaining = edges.filter((e) => !(e.source === entry.sourceNodeId && e.target === id));
        if (remaining.length !== edges.length) setEdges(remaining);
      }
    },
    [id, setEdges, inputText, prompt]
  );

  // Active reference numbers for strip highlight (includes both @image#N and @audio#N)

  // Sync from store
  useEffect(() => {
    if (nodeData.prompt !== undefined && nodeData.prompt !== prompt) { setPrompt(nodeData.prompt); setInputText(nodeData.prompt); }
  }, [nodeData.prompt]);
  useEffect(() => {
    const migrated = nodeData.videoMode === "imageReference" ? "fullReference" : nodeData.videoMode;
    if (migrated && migrated !== activeMode) setActiveMode(migrated);
  }, [nodeData.videoMode]);
  useEffect(() => {
    if (nodeData.isGenerating) {
      const hasJobId = !!nodeData.generationJobId;
      const startedAt = nodeData.generationStartedAt;
      // 只有完全没 jobId 才清理（真正的脏数据），有 jobId 的就保留让 resume 轮询接管
      // 视频生成排队可能持续很久（10-20分钟），2分钟清理太短了
      const isStale = !hasJobId && (!startedAt || Date.now() - startedAt > 5 * 60 * 1000);
      if (isStale) { setIsGenerating(false); updateNodeData(id, { isGenerating: false, generationJobId: null, generationStartedAt: null }); return; }
    }
    // Only sync from nodeData when not actively polling (avoid overwriting in-flight state)
    if (nodeData.isGenerating !== isGeneratingRef.current) {
      setIsGenerating(nodeData.isGenerating || false);
    }
  }, [nodeData.isGenerating, nodeData.generationJobId, nodeData.generationStartedAt]);

  const handlePromptChange = useCallback((value: string) => { setPrompt(value); updateNodeData(id, { prompt: value }); }, [id, updateNodeData]);
  const handleModeChange = useCallback((mode: typeof VIDEO_MODES[number]["id"]) => {
    setActiveMode(mode);
    const heights: Record<string, number> = {
      text2video: 340, image2video: 400, firstLastFrame: 420,
      fullReference: 380, smartMultiframe: 500, videoReference: 400,
    };
    updateNodeData(id, { videoMode: mode, height: heights[mode] || 400 });
  }, [id, updateNodeData]);
  const handleModelChange = useCallback((modelId: string) => {
    if (!videoModels.some((m) => m.id === modelId)) setCustomVideoModelId(modelId);
    setSelectedModel(modelId);
    updateNodeData(id, { model: modelId, providerId: selectedProviderId });
  }, [videoModels, id, updateNodeData, selectedProviderId]);
  const handleApplyCustomVideoModel = useCallback(() => {
    const modelId = customVideoModelId.trim();
    if (!modelId) return;
    setCustomVideoModelId(modelId);
    setSelectedModel(modelId);
    updateNodeData(id, { model: modelId, providerId: selectedProviderId });
  }, [customVideoModelId, id, updateNodeData, selectedProviderId]);
  const handleProviderChange = useCallback((providerId: string) => {
    setSelectedProviderId(providerId); updateNodeData(id, { providerId, provider: providerId });
    const defaultModelId = getDefaultVideoModel(currentProviderConfig?.modelName);
    if (defaultModelId) { setSelectedModel(defaultModelId); updateNodeData(id, { model: defaultModelId, providerId, provider: providerId }); }
  }, [id, updateNodeData, currentProviderConfig]);

  // Resume polling on mount — ONLY for page refresh / remount recovery
  // Normal generation flow is handled by pollJob, not this effect.
  // This effect should NOT re-run when generationJobId changes during normal generation,
  // because that would cancel the pollJob's timers and create a duplicate polling loop.
  useEffect(() => {
    const jobId = String(nodeData.generationJobId || "");
    if (!jobId || !nodeData.isGenerating || jobId.startsWith("browser:")) return;
    // ── Only resume if pollJob is NOT already active (no cancel function stored) ──
    // If pollCancelRef.current exists, pollJob is already running and we should not interfere.
    if (pollCancelRef.current) return;
    let active = true;
    const pollStart = Date.now();
    let pollCount = 0;
    let pollErrorCount = 0;
    const MAX_POLL_ERRORS = 20; // 增加容错次数：排队期间 API 可能响应慢或超时
    // Read latest values from store to avoid stale closures
    const isJimengJob = nodeData.providerId === "jimeng-official";
    const targetId = nodeData.resultNodeId || id;
    const poll = async () => {
      if (!active) return;
      if (Date.now() - pollStart > 30 * 60 * 1000) { useCanvasStore.getState().updateNodeData(targetId, { isGenerating: false, error: "排队超时（30分钟），任务可能仍在队列中" }); onJobCompleteRef.current(String(jobId)); addToast("warning", "视频排队超时，任务可能仍在队列中，请稍后查看结果"); return; }
      pollCount++;
      const delay = pollCount < 15 ? 2000 : pollCount < 75 ? 5000 : 10000;
      try {
        const status = isJimengJob
          ? await jimengGetVideoStatus(String(jobId))
          : await getGenerateVideoJob(String(jobId)) as { job_id: string; status: string; result?: string; error?: string; progress?: number };
        if (!active) return;
        
        // 重置错误计数（成功获取到响应）
        pollErrorCount = 0;
        
        if (status.progress !== undefined) {
          const roundedProgress = Math.round(status.progress);
          useCanvasStore.getState().updateNodeData(targetId, { progressPercent: roundedProgress });
          useCanvasStore.getState().updateNodeData(id, { progressPercent: roundedProgress });
        }

        // ── CRITICAL: API出图=画布出图 ──
        // 只要API返回了result URL，不管status是什么，立即显示到画布
        if (status.result) {
          const name = extractDisplayName(status.result || "", "video");
          const ud = useCanvasStore.getState().updateNodeData;
          ud(targetId, { isGenerating: false, videoUrl: status.result, displayName: name, generationDurationMs: Date.now() - (nodeData.generationStartedAt || Date.now()), error: undefined });
          ud(id, { videoUrl: status.result, displayName: name });
          onJobCompleteRef.current(String(jobId));
          addToast("success", "视频生成完成");
          // Asynchronously persist to disk for reliability (non-blocking)
          persistVideoUrl(status.result).then((localPath) => {
            if (localPath && localPath !== status.result) {
              const ud2 = useCanvasStore.getState().updateNodeData;
              ud2(targetId, { videoUrl: localPath });
              ud2(id, { videoUrl: localPath });
            }
          });
          return;
        }

        if (status.status === "succeeded") {
          // ── 后端说 succeeded 但没有 result URL ──
          // 尝试从 status 对象中寻找任何视频 URL 字段
          const fallbackUrl = (status as any).video_url || (status as any).url || (status as any).result_url || (status as any).output?.url || null;
          if (fallbackUrl && typeof fallbackUrl === "string" && fallbackUrl.startsWith("http")) {
            console.log("[VideoNode] Resume poll: succeeded with no result but found fallback URL:", fallbackUrl.substring(0, 80));
            const name = extractDisplayName(fallbackUrl, "video");
            const ud = useCanvasStore.getState().updateNodeData;
            ud(targetId, { isGenerating: false, videoUrl: fallbackUrl, displayName: name, error: undefined });
            ud(id, { videoUrl: fallbackUrl, displayName: name });
            onJobCompleteRef.current(String(jobId));
            addToast("success", "视频生成完成");
            persistVideoUrl(fallbackUrl).then((localPath) => {
              if (localPath && localPath !== fallbackUrl) {
                const ud2 = useCanvasStore.getState().updateNodeData;
                ud2(targetId, { videoUrl: localPath });
                ud2(id, { videoUrl: localPath });
              }
            });
            return;
          }
          useCanvasStore.getState().updateNodeData(targetId, { isGenerating: false, error: "后端返回空结果" });
          onJobCompleteRef.current(String(jobId));
          addToast("error", "视频生成失败: 后端返回空结果");
          return;
        }
        if (status.status === "failed" || (status.error && !status.result)) {
          useCanvasStore.getState().updateNodeData(targetId, { isGenerating: false, error: status.error || "生成失败" });
          onJobCompleteRef.current(String(jobId));
          addToast("error", status.error || "视频生成失败");
          return;
        }
        const timer = setTimeout(poll, delay);
        activePollsRef.current.add(timer);
        timer; // schedule next
      } catch (e) {
        if (active) {
          pollErrorCount++;
          if (pollErrorCount >= MAX_POLL_ERRORS) {
            // 轮询错误过多 → 暂停但不破坏状态，保留 isGenerating 以便刷新后恢复
            addToast("warning", "视频轮询暂时中断，任务可能仍在排队中，请稍后刷新画布恢复");
            useCanvasStore.getState().updateNodeData(targetId, {
              error: "轮询暂时中断（网络不稳定），刷新画布可恢复",
            });
            return; // 停止轮询，但保持 isGenerating=true
          } else {
            const timer = setTimeout(poll, 5000);
            activePollsRef.current.add(timer);
          }
        }
      }
    };
    const timer = setTimeout(poll, 1000);
    activePollsRef.current.add(timer);
    // ── Cleanup: only set active=false, don't clear activePollsRef ──
    // pollJob manages its own timers and will clear them when needed.
    // Old resume timers will fire but see active=false and return harmlessly.
    return () => { active = false; };
  }, [id, nodeData.generationJobId, nodeData.isGenerating, nodeData.providerId, nodeData.resultNodeId, nodeData.generationStartedAt]);

  // Poll for a single job result
  const pollJob = useCallback((jobId: string, resultNodeId: string, isJimengOfficial: boolean) => {
    // ── CRITICAL: Cancel any previous active pollJob before starting a new one ──
    // This prevents duplicate polling loops when user switches models and regenerates
    if (pollCancelRef.current) {
      pollCancelRef.current();
      pollCancelRef.current = null;
    }
    // Clear all active polling timers from previous polls
    activePollsRef.current.forEach(t => clearTimeout(t));
    activePollsRef.current.clear();

    const maxPollTime = 30 * 60 * 1000;
    const pollStart = Date.now();
    let pollCount = 0;
    let pollErrorCount = 0;
    const MAX_POLL_ERRORS = 20; // 增加容错次数：排队期间 API 可能响应慢或超时
    let cancelled = false;
    let hasShownQueueToast = false;
    const poll = async () => {
      if (cancelled) return;
      if (Date.now() - pollStart > maxPollTime) { useCanvasStore.getState().updateNodeData(resultNodeId, { isGenerating: false, error: "排队超时（30分钟），任务可能仍在队列中" }); onJobCompleteRef.current(jobId); addToast("warning", "视频排队超时，任务可能仍在队列中，请稍后查看结果"); return; }
      pollCount++;
      const delay = pollCount < 15 ? 2000 : pollCount < 75 ? 5000 : 10000;
      try {
        const status = isJimengOfficial
          ? await jimengGetVideoStatus(String(jobId))
          : await getGenerateVideoJob(String(jobId)) as { job_id: string; status: string; result?: string; error?: string; progress?: number };
        if (cancelled) return;
        
        // 重置错误计数（成功获取到响应）
        pollErrorCount = 0;
        
        // ── Update progress on both VideoResult node AND VideoNode itself ──
        // This ensures the progress bar syncs with backend even if only one node re-renders
        if (status.progress !== undefined) {
          const roundedProgress = Math.round(status.progress);
          useCanvasStore.getState().updateNodeData(resultNodeId, { progressPercent: roundedProgress });
          useCanvasStore.getState().updateNodeData(id, { progressPercent: roundedProgress });
        }

        // ── 排队中提示 ──
        // 如果连续轮询超过 10 次还没结果，提示用户任务在排队
        if (pollCount === 10 && !hasShownQueueToast && !status.result && status.status !== "failed") {
          hasShownQueueToast = true;
          addToast("info", "视频任务排队中，请耐心等待...");
        }

        // ── CRITICAL: API出图=画布出图 ──
        if (status.result) {
          const name = extractDisplayName(status.result || "", "video");
          const ud = useCanvasStore.getState().updateNodeData;
          ud(resultNodeId, { isGenerating: false, videoUrl: status.result, displayName: name, generationDurationMs: Date.now() - (useCanvasStore.getState().nodes.find(n => n.id === id)?.data as any)?.generationStartedAt || Date.now(), error: undefined });
          ud(id, { videoUrl: status.result, displayName: name });
          onJobCompleteRef.current(jobId);
          addToast("success", "视频生成完成");
          // Asynchronously persist to disk for reliability (non-blocking)
          persistVideoUrl(status.result).then((localPath) => {
            if (localPath && localPath !== status.result) {
              const ud2 = useCanvasStore.getState().updateNodeData;
              ud2(resultNodeId, { videoUrl: localPath });
              ud2(id, { videoUrl: localPath });
            }
            // Auto-save completed video to asset library
            const finalPath = localPath || status.result;
            if (finalPath) {
              useAssetStore.getState().addAsset({
                name: name,
                category: "场景",
                tags: "视频,生成",
                filePath: finalPath,
                sourceType: "generated",
                sourceNodeId: id,
                mediaType: "video",
              }).catch(e => console.error("[VideoNode] Auto-save to asset library failed:", e));
            }
          });
          return;
        }

        if (status.status === "succeeded") {
          // ── 后端说 succeeded 但没有 result URL ──
          // 可能是 API 返回格式不兼容导致 URL 提取失败
          // 尝试从 status 对象中寻找任何视频 URL 字段
          const fallbackUrl = (status as any).video_url || (status as any).url || (status as any).result_url || (status as any).output?.url || null;
          if (fallbackUrl && typeof fallbackUrl === "string" && fallbackUrl.startsWith("http")) {
            console.log("[VideoNode] Poll: succeeded with no result but found fallback URL:", fallbackUrl.substring(0, 80));
            const name = extractDisplayName(fallbackUrl, "video");
            const ud = useCanvasStore.getState().updateNodeData;
            ud(resultNodeId, { isGenerating: false, videoUrl: fallbackUrl, displayName: name, error: undefined });
            ud(id, { videoUrl: fallbackUrl, displayName: name });
            onJobCompleteRef.current(jobId);
            addToast("success", "视频生成完成");
            persistVideoUrl(fallbackUrl).then((localPath) => {
              if (localPath && localPath !== fallbackUrl) {
                ud(resultNodeId, { videoUrl: localPath });
                ud(id, { videoUrl: localPath });
              }
            });
            return;
          }
          useCanvasStore.getState().updateNodeData(resultNodeId, { isGenerating: false, error: "后端返回空结果" });
          onJobCompleteRef.current(jobId);
          addToast("error", "视频生成失败: 后端返回空结果");
          return;
        }
        if (status.status === "failed" || (status.error && !status.result)) {
          useCanvasStore.getState().updateNodeData(resultNodeId, { isGenerating: false, error: status.error || "生成失败" });
          onJobCompleteRef.current(jobId);
          addToast("error", status.error || "视频生成失败");
          return;
        }
        const timer = setTimeout(poll, delay);
        activePollsRef.current.add(timer);
      } catch (e) {
        pollErrorCount++;
        if (pollErrorCount >= MAX_POLL_ERRORS) {
          // 轮询错误过多 → 暂停但不破坏状态，保留 isGenerating 以便刷新后恢复
          addToast("warning", "视频轮询暂时中断，任务可能仍在排队中，请稍后刷新画布恢复");
          // 不退积分！任务可能还在后端排队
          // 保持 isGenerating=true，这样刷新画布后 resume 轮询会自动重新连接
          // 同时在 result node 显示提示信息
          useCanvasStore.getState().updateNodeData(resultNodeId, {
            error: "轮询暂时中断（网络不稳定），刷新画布可恢复",
          });
          return; // 停止轮询，但不改 isGenerating
        } else {
          const timer = setTimeout(poll, delay);
          activePollsRef.current.add(timer);
        }
      }
    };
    const timer = setTimeout(poll, 3000);
    activePollsRef.current.add(timer);
    // ── Store cancel function so handleGenerate can cancel this poll when starting a new one ──
    const cancelFn = () => { cancelled = true; };
    pollCancelRef.current = cancelFn;
    return cancelFn;
  }, [id, addToast, setIsGenerating]);

  // ── Handle generate（支持并发：多个任务独立提交、独立轮询、独立完成）──
  const handleGenerate = useCallback(async (promptText?: string) => {
    // ── CRITICAL: Cancel any previous polling before starting a new generation ──
    // This prevents duplicate polling loops and stale results from previous models
    if (pollCancelRef.current) {
      pollCancelRef.current();
      pollCancelRef.current = null;
    }
    activePollsRef.current.forEach(t => clearTimeout(t));
    activePollsRef.current.clear();

    // ── Keep old result node: disconnect it from VideoNode but leave on canvas ──
    // Also auto-save old video to asset library as historical record
    const oldResultNodeId = nodeData.resultNodeId;
    if (oldResultNodeId) {
      const store = useCanvasStore.getState();
      const oldResultNode = store.nodes.find(n => n.id === oldResultNodeId);
      if (oldResultNode) {
        const oldData = oldResultNode.data as any;
        const oldVideoUrl = oldData?.videoUrl;
        const oldDisplayName = oldData?.displayName || oldData?.name || "视频";

        // 1. Disconnect edge: remove the connection from VideoNode to old result
        // This makes the old result node a standalone node on the canvas (user can still see it)
        const edgeToRemove = store.edges.find(e => e.source === id && e.target === oldResultNodeId);
        if (edgeToRemove) {
          // Remove only the edge, not the node itself
          store.setEdges(store.edges.filter(e => e.id !== edgeToRemove.id));
        }

        // 2. Auto-save old video to asset library (if it has a valid URL)
        if (oldVideoUrl && !oldData?.isGenerating && !oldData?.error) {
          // Persist the video URL to local file first
          (async () => {
            try {
              const localPath = await persistVideoSource(oldVideoUrl);
              if (localPath) {
                await useAssetStore.getState().addAsset({
                  name: oldDisplayName,
                  category: "场景",
                  tags: "视频,历史",
                  filePath: localPath,
                  sourceType: "generated",
                  sourceNodeId: id,
                  mediaType: "video",
                });
              }
            } catch (e) {
              console.error("[VideoNode] Failed to auto-save old video to asset library:", e);
            }
          })();
        }
      }
    }

    const textToUse = (promptText ?? inputText).trim() || prompt.trim();
    if (!textToUse) return;
    if (!promptText && inputText.trim()) handlePromptChange(inputText.trim());
    else if (promptText?.trim()) handlePromptChange(promptText.trim());

    const { nodes: freshNodes, edges: freshEdges } = useCanvasStore.getState();
    // Use full transitive closure for generation (maxDepth=∞) so @图N resolves
    // to any upstream node in the chain. Display pool uses maxDepth=1.
    const freshPool = buildReferenceImagePool(id, freshNodes, freshEdges, assetPool, persistedAssets, Infinity);
    const referencedNumbers = collectReferencedImageNumbers(textToUse);
    let referenceImages = resolveReferenceImagesForPrompt(textToUse, freshPool, referencedNumbers);
    const referencedAudioNumbers = collectReferencedAudioNumbers(textToUse);
    const referencedAudioPaths = referencedAudioNumbers.map((n) => freshPool.getByNumber(n)).filter((e): e is NonNullable<typeof e> => !!e && e.mediaType === "audio").map((e) => e.url);
    const cleanPrompt = stripReferenceMarkers(textToUse);

    let provider = currentProviderConfig;
    const isJimengOfficial = selectedProviderId === "jimeng-official";
    const isBuiltinVjimeng = selectedProviderId === "vjimeng" || selectedProviderId === "vjimeng-sd2";
    // Jimeng Official uses Cookie (sessionid) — skip key check
    // XioArtTV built-in channel — Rust injects license key, skip frontend key check
    if (!isJimengOfficial && !isBuiltinVjimeng && (!provider || !provider.apiKey)) {
      // Try to find apiKey directly from the channel provider (e.g. "geeknow" or "vjimeng")
      const effectiveProviderId = selectedProviderId || "grsai";
      const channelProvider = providers.find((p) => p.id === effectiveProviderId && p.apiKey);
      if (channelProvider) {
        provider = { ...provider, apiKey: channelProvider.apiKey, baseUrl: channelProvider.baseUrl || provider?.baseUrl, channel: effectiveProviderId, id: effectiveProviderId } as typeof provider;
      } else {
        // Check custom providers
        const customProviders = useSettingsStore.getState().customProviders;
        const cp = customProviders.find((p) => p.id === effectiveProviderId);
        if (cp && cp.apiKey) {
          provider = { id: cp.id, name: cp.name, baseUrl: cp.baseUrl, apiKey: cp.apiKey } as typeof provider;
        } else {
          // Fallback: try video-model (backward compat)
          const fallbackProvider = providers.find((p) => p.channel === selectedProviderId && p.apiKey);
          if (fallbackProvider) {
            provider = { ...provider, apiKey: fallbackProvider.apiKey, baseUrl: fallbackProvider.baseUrl, channel: selectedProviderId, id: selectedProviderId } as typeof provider;
          } else {
            addToast("warning", isCustomProvider ? "请先在画布设置中为自定义视频通道配置 API Key" : "请先在画布设置中配置虾客漫视频 API 密钥");
            return;
          }
        }
      }
    }

    const availableModelIds = availableVideoModels.map((m) => m.id);
    let effectiveModel = selectedModel;
    if (!availableModelIds.includes(selectedModel)) {
      effectiveModel = availableVideoModels[0]?.id || "transit9-fast";
      setSelectedModel(effectiveModel); updateNodeData(id, { model: effectiveModel });
      addToast("info", `当前模型 "${selectedModel}" 不可用，已自动切换`);
    }

    // ── 扣费（XioArtTV / XioArtTV备用 通道） ──
    const creditsEnabled = useSettingsStore.getState().creditsEnabled;
    const shouldDeduct = creditsEnabled && (selectedProviderId === "vjimeng" || selectedProviderId === "vjimeng-sd2");
    let deducted = false;
    let deductedAmount = 0;
    let deductJobId: string | null = null;
    if (shouldDeduct) {
      const pricePerSec = VIDEO_CREDIT_PRICES[effectiveModel] || 100;
      deductedAmount = pricePerSec * Math.max(1, duration);
      const auth = useAuthStore.getState();
      const ue = auth.user?.email || "";
      let tok: string | null = null;
      try { tok = await invoke<string | null>("get_auth_token"); } catch {}
      try {
        const deductRes = await invoke<any>("credits_deduct", {
          machineId: ue,
          amount: deductedAmount,
          provider: selectedProviderId,
          model: effectiveModel,
          mode: activeMode,
          duration: String(duration),
          jobId: null,
          token: tok,
        });
        if (!deductRes.success) {
          addToast("error", deductRes.error || "余额不足，无法生成视频");
          return;
        }
        useCreditsStore.getState().deductCredits(deductedAmount);
        deducted = true;
        deductJobId = deductRes.jobId || null;
      } catch (e) {
        addToast("error", "扣费失败: " + String(e));
        return;
      }
    }

    // Validate reference requirements BEFORE setting isGenerating
    const preImages = referenceImages || [];
    if ((activeMode === "fullReference" || activeMode === "videoReference") && preImages.length === 0) {
      addToast("warning", activeMode === "fullReference" ? "全能参考模式需要至少一张参考图，请@引用素材" : "视频参考模式需要参考图，请@引用素材");
      return;
    }
    if (activeMode === "firstLastFrame") {
      const hasFirst = !!firstFrameImage;
      const hasLast = !!lastFrameImage;
      if (!hasFirst || !hasLast) {
        addToast("warning", "首尾帧模式需要上传首帧和尾帧图片");
        return;
      }
    }


    setIsGenerating(true);
    updateNodeData(id, { prompt: textToUse, isGenerating: true, generationStartedAt: Date.now(), model: effectiveModel, videoUrl: null, displayName: "生成中…" });

    // If no explicit @ references but upstream images exist, auto-include them.
    // Video models often require image input and cannot work in pure text2video mode.
    // ONLY use direct upstream (maxDepth=1) for auto-include; @图N uses full chain.
    const directUpstreamPool = buildReferenceImagePool(id, freshNodes, freshEdges, assetPool, persistedAssets, 1);
    if ((!referenceImages || referenceImages.length === 0) && directUpstreamPool.count > 0) {
      const upstreamImageEntries = directUpstreamPool.entries.filter((e) => e.mediaType !== "audio");
      if (upstreamImageEntries.length > 0) {
        referenceImages = upstreamImageEntries.map((e) => e.url);
      }
    }

    const effectiveImages = referenceImages || [];

    // ── 图生视频 / 首尾帧：只用槽位图片，忽略@引用 ──
    if (activeMode === "image2video" || activeMode === "firstLastFrame") {
      effectiveImages.length = 0;
    }

    console.log("[VideoNode] handleGenerate called:", {
      model: effectiveModel,
      mode: activeMode,
      effectiveImagesCount: effectiveImages.length,
      effectiveImageUrls: effectiveImages.map((u: string) => u.substring(0, 80)),
      poolCount: freshPool.count,
      poolEntries: freshPool.entries.map((e) => ({ num: e.number, type: e.mediaType, url: e.url.substring(0, 80) })),
    });

    try {
      for (let i = 0; i < generateCount; i++) {
        const thisNode = useCanvasStore.getState().nodes.find((n) => n.id === id);
        const resultNodeId = `video-result-${crypto.randomUUID()}`;
        const resultX = (thisNode?.position?.x ?? 0) + 560;
        const resultY = (thisNode?.position?.y ?? 0) + i * 260;
        const resultData = nodeRegistry[CANVAS_NODE_TYPES.videoResult]?.createDefaultData() || { displayName: "生成中…", isGenerating: true, progressPercent: 0, videoUrl: null, error: null };
        addNode({ id: resultNodeId, type: CANVAS_NODE_TYPES.videoResult, position: { x: resultX, y: resultY }, data: { ...resultData, isGenerating: true, progressPercent: 0, aspectRatio: selectedAspectRatio, generationStartedAt: Date.now() } });
        addEdge({ id: `e-${id}-${resultNodeId}`, source: id, target: resultNodeId, type: "dataFlow" });
        updateNodeData(id, { resultNodeId });

        console.log("[VideoNode] Calling submitVideoJob with effectiveImages:", effectiveImages.length);

        const customProviderConfig = customProviders.find((p: any) => p.id === selectedProviderId);
        const customApiFormat = customProviderConfig?.apiFormat || "openai";
        const jobId = await submitVideoJob(id, cleanPrompt, assetPool, persistedAssets, { ...provider, channel: currentProviderConfig?.channel || selectedProviderId, id: provider?.id || selectedProviderId }, effectiveModel, duration, selectedAspectRatio, generateAudio, selectedResolution, activeMode, effectiveImages, referencedAudioPaths, addToast, (activeMode === "firstLastFrame" || activeMode === "image2video") ? firstFrameImage : null, activeMode === "firstLastFrame" ? lastFrameImage : null, activeMode === "videoReference" ? videoReference : null, isCustomProvider, customApiFormat, projectState.videoApiConfig);
        console.log("[VideoNode] submitVideoJob returned:", jobId);

        // ── CRITICAL: Store jobId on source node for remount polling recovery ──
        updateNodeData(id, { generationJobId: jobId });

        // Browser automation mode: result is "browser:<videoPath>" — show video directly, no polling
        if (jobId.startsWith("browser:")) {
          const rawVideoPath = jobId.slice("browser:".length);
          const name = extractDisplayName(rawVideoPath, "video");
          // ── CRITICAL: 先立即显示到画布，不等 persist ──
          setIsGenerating(false);
          useCanvasStore.getState().updateNodeData(resultNodeId, { isGenerating: false, videoUrl: rawVideoPath, displayName: name });
          updateNodeData(id, { isGenerating: false, videoUrl: rawVideoPath, displayName: name });
          addToast("success", "视频生成完成");
          // Asynchronously persist to disk for reliability (non-blocking)
          persistVideoUrl(rawVideoPath).then((localPath) => {
            if (localPath && localPath !== rawVideoPath) {
              const ud2 = useCanvasStore.getState().updateNodeData;
              ud2(resultNodeId, { videoUrl: localPath });
              ud2(id, { videoUrl: localPath });
            }
          });
          continue; // skip polling
        }

        activeJobIdsRef.current.add(jobId);
        pollJob(jobId, resultNodeId, selectedProviderId === "jimeng-official");
      }
    } catch (e) {
      console.error("Video generation error:", e);
      const errMsg = e instanceof Error ? e.message : String(e);
      if (activeJobIdsRef.current.size === 0) {
        isGeneratingRef.current = false;
        setIsGeneratingRaw(false);
        updateNodeData(id, { isGenerating: false });
      }
      // ── 提交失败，退还积分 ──
      if (deducted && deductedAmount > 0) {
        try {
          let tok: string | null = null;
          try { tok = await invoke<string | null>("get_auth_token"); } catch {}
          await invoke("credits_refund", {
            machineId: useAuthStore.getState().user?.email || "",
            jobId: deductJobId || "",
            provider: selectedProviderId,
            reason: "视频提交失败",
            token: tok,
          });
          useCreditsStore.getState().deductCredits(-deductedAmount);
        } catch { /* refund best-effort */ }
      }
      addToast("error", `视频提交失败: ${errMsg}`);
      }
  }, [inputText, prompt, id, updateNodeData, addNode, addEdge, handlePromptChange, selectedModel, availableVideoModels, addToast, currentProviderConfig, duration, selectedAspectRatio, generateAudio, activeMode, selectedResolution, generateCount, assetPool, persistedAssets, pollJob]);

  useEffect(() => {
    const nonce = nodeData.autoStartGenerationNonce ?? null;
    if (!nodeData.autoStartGeneration || nonce === null) return;
    if (autoStartNonceRef.current === nonce) return;
    if (nodeData.generationJobId || nodeData.videoUrl || isGeneratingRef.current) return;

    const autoPrompt = (nodeData.prompt || prompt || inputText || "").trim();
    if (!autoPrompt) {
      updateNodeData(id, { autoStartGeneration: false });
      return;
    }

    autoStartNonceRef.current = nonce;
    updateNodeData(id, { autoStartGeneration: false });
    void handleGenerate(autoPrompt);
  }, [
    id,
    nodeData.autoStartGeneration,
    nodeData.autoStartGenerationNonce,
    nodeData.generationJobId,
    nodeData.prompt,
    nodeData.videoUrl,
    prompt,
    inputText,
    handleGenerate,
    updateNodeData,
  ]);

  const handleSend = useCallback(() => { if (!inputText.trim()) return; handleGenerate(inputText.trim()); }, [inputText, handleGenerate]);
  const handleKeyDown = useCallback((_e: React.KeyboardEvent) => {}, []);

  const handleImportLink = useCallback(async () => {
    const trimmedUrl = linkUrl.trim();
    if (!trimmedUrl) return;
    if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) { addToast("error", "请输入有效的视频链接"); return; }
    setIsImporting(true); addToast("info", "正在下载视频...");
    try {
      const localPath = await persistVideoSource(trimmedUrl);
      if (!localPath) throw new Error("下载失败");
      const thisNode = useCanvasStore.getState().nodes.find((n) => n.id === id);
      const resultNodeId = `video-result-${crypto.randomUUID()}`;
      const resultX = (thisNode?.position?.x ?? 0) + 560;
      const resultY = (thisNode?.position?.y ?? 0);
      addNode({ id: resultNodeId, type: CANVAS_NODE_TYPES.videoResult, position: { x: resultX, y: resultY }, data: { displayName: "导入视频", isGenerating: false, videoUrl: localPath, aspectRatio: selectedAspectRatio } });
      addEdge({ id: `e-${id}-${resultNodeId}`, source: id, target: resultNodeId, type: "dataFlow" });
      setLinkUrl(""); setShowLinkInput(false); addToast("success", "视频导入成功");
    } catch (e) { addToast("error", `视频导入失败: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setIsImporting(false); }
  }, [linkUrl, id, addNode, addEdge, addToast, selectedAspectRatio]);

  const formatDuration = (sec: number) => sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60 || ""}s`;

  // ── Node dimensions (resizable) ──────────────────────────────────────
  const nodeWidth = nodeData.width || 600;
  const nodeHeight = nodeData.height || 480;
  const handleResize = useCallback(
    (result: { width: number; height: number }) => {
      updateNodeData(id, { width: result.width, height: result.height });
    },
    [id, updateNodeData]
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`@keyframes videoGenPulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
      <NodeDeleteButton id={id} selected={selected ?? false} />
      <div style={{ position: 'relative' }}>
        <div
          className="node-inner"
          style={{ backgroundColor: "var(--bg-node)", border: "1px solid var(--border)", borderRadius: "var(--node-radius)", width: nodeWidth, height: nodeHeight, display: "flex", flexDirection: "column", boxSizing: "border-box", boxShadow: "0 2px 12px rgba(0,0,0,.3)" }}
        >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>
            <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "120px" }} title={nodeData.displayName || "生视频"}>{nodeData.displayName || "生视频"}</span>
            {selectedModel && (
              <span style={{ fontSize: "11px", color: "var(--text-muted)", backgroundColor: "var(--bg-hover)", padding: "2px 8px", borderRadius: "4px" }}>
                {availableVideoModels.find((m) => m.id === selectedModel)?.label || selectedModel}
              </span>
            )}
            {isGenerating && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "var(--text-secondary)", backgroundColor: "var(--bg-hover)", borderRadius: "9999px", padding: "2px 10px", marginLeft: "4px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--accent)", animation: "videoGenPulse 1.5s ease-in-out infinite", display: "inline-block" }} />
                {(() => {
                  const startedAt = nodeData.generationStartedAt;
                  if (startedAt && Date.now() - startedAt > 3 * 60 * 1000) return "排队中...";
                  return "生成中";
                })()}
              </span>
            )}
          </div>
        </div>

{/* Adaptive image area — replaced by new section below mode tabs */}

        {/* Input area — scrollable when height is constrained */}
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {/* Mode tabs */}
          <div className="flex items-center gap-1" style={{ flexWrap: "wrap" }}>
            {currentVideoModes.map((mode) => (
              <button
                key={mode.id}
                onClick={() => handleModeChange(mode.id)}
                className="nodrag"
                style={{
                  padding: "6px 14px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: activeMode === mode.id ? "var(--accent-btn)" : "transparent",
                  color: activeMode === mode.id ? "#fff" : "var(--text-secondary)",
                  fontSize: "12px",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  fontWeight: activeMode === mode.id ? 500 : 400,
                }}
                onMouseEnter={(e) => { if (activeMode !== mode.id) e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { if (activeMode !== mode.id) e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {/* ── Adaptive image area — mode-dependent, replaces old 首帧 / 输入框 split ── */}
          {activeMode !== "text2video" && (
            <div className="nodrag" style={{ padding: "4px 0", borderBottom: "1px solid var(--border)", marginBottom: "2px" }}>

              {/* ── image2video: single frame upload ── */}
              {(activeMode === "image2video" && !currentIsGrok) && (
                <FrameSlot label="图片" tooltip="拖入一张图作为视频首帧" image={firstFrameImage} dragOver={firstFrameDragOver} onClick={() => handleFrameSlotClick("first")} onDrop={(e) => handleFrameDrop(e, "first")} onDragOver={(e) => handleFrameDragOver(e, "first")} onDragLeave={(e) => handleFrameDragLeave(e, "first")} onClear={() => clearFrameImage("first")} pool={pool} onUseRef={(e) => handleDropRefToFrame(e, "first")} />
              )}

              {/* ── Grok 首帧生视频: single frame ── */}
              {(activeMode === "image2video" && currentIsGrok) && (
                <FrameSlot label="首帧" tooltip="拖入一张图作为视频首帧" image={firstFrameImage} dragOver={firstFrameDragOver} onClick={() => handleFrameSlotClick("first")} onDrop={(e) => handleFrameDrop(e, "first")} onDragOver={(e) => handleFrameDragOver(e, "first")} onDragLeave={(e) => handleFrameDragLeave(e, "first")} onClear={() => clearFrameImage("first")} pool={pool} onUseRef={(e) => handleDropRefToFrame(e, "first")} />
              )}

              {/* ── 首尾帧 / 智能多帧: two side-by-side slots ── */}
              {(activeMode === "firstLastFrame" || activeMode === "smartMultiframe") && (
                <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <FrameSlot label="首帧" tooltip="拖入第一帧图片" image={firstFrameImage} dragOver={firstFrameDragOver} onClick={() => handleFrameSlotClick("first")} onDrop={(e) => handleFrameDrop(e, "first")} onDragOver={(e) => handleFrameDragOver(e, "first")} onDragLeave={(e) => handleFrameDragLeave(e, "first")} onClear={() => clearFrameImage("first")} pool={pool} onUseRef={(e) => handleDropRefToFrame(e, "first")} height={72} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", color: "var(--text-muted)", fontSize: 18, padding: "0 2px", alignSelf: "center" }}>
                    →
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <FrameSlot label="尾帧" tooltip="拖入最后一帧图片" image={lastFrameImage} dragOver={lastFrameDragOver} onClick={() => handleFrameSlotClick("last")} onDrop={(e) => handleFrameDrop(e, "last")} onDragOver={(e) => handleFrameDragOver(e, "last")} onDragLeave={(e) => handleFrameDragLeave(e, "last")} onClear={() => clearFrameImage("last")} pool={pool} onUseRef={(e) => handleDropRefToFrame(e, "last")} height={72} />
                  </div>
                </div>
              )}

              {/* ── 全能参考 / 智能多帧 additional: reference image strip ── */}
              {(activeMode === "fullReference" || activeMode === "smartMultiframe") && pool.entries.filter(e => e.mediaType !== "audio" && (e.source === "upstream" || allRefNumbers.has(e.number))).length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, marginBottom: 4 }}>
                    {activeMode === "smartMultiframe" ? "参考图" : "参考图片"}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {pool.entries.filter(e => e.mediaType !== "audio" && (e.source === "upstream" || allRefNumbers.has(e.number))).slice(0, 9).map((entry) => (
                      <div key={entry.number} style={{ width: 48, height: 48, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", overflow: "hidden", cursor: "default", position: "relative" }}>
                        <FrameImagePreview src={entry.url} />
                        <div style={{ position: "absolute", bottom: 1, right: 2, fontSize: 8, color: "#fff", background: "rgba(0,0,0,0.5)", borderRadius: 3, padding: "0 3px", lineHeight: "14px" }}>@{entry.number}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── 全能参考: when no pool images, show upload hint ── */}
              {activeMode === "fullReference" && pool.entries.filter(e => e.mediaType !== "audio" && (e.source === "upstream" || allRefNumbers.has(e.number))).length === 0 && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: "8px 0" }}>
                  从画布上 @引用 图片作为参考，或连接上游节点导入
                </div>
              )}

              {/* ── 视频参考: video upload ── */}
              {activeMode === "videoReference" && (
                <div style={{ padding: "4px 0" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, marginBottom: 4 }}>参考视频</div>
                  <div
                    onClick={() => videoRefSlotRef.current?.click()}
                    onDrop={handleVideoRefDrop}
                    onDragOver={handleVideoRefDragOver}
                    onDragLeave={handleVideoRefDragLeave}
                    style={{
                      position: "relative",
                      height: videoReference ? 64 : 52,
                      borderRadius: 8,
                      border: videoRefDragOver ? "2px dashed var(--accent)" : "2px dashed var(--border)",
                      background: videoRefDragOver ? "var(--accent-dim)" : "var(--bg-secondary)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      overflow: "hidden",
                      transition: "border-color 0.2s, background 0.2s",
                    }}
                  >
                    {videoReference ? (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px" }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                          <span style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {videoReference.split(/[\\/]/).pop()?.substring(0, 30) || "视频已上传"}
                          </span>
                        </div>
                        <button
                          className="nodrag"
                          onClick={(e) => { e.stopPropagation(); clearVideoReference(); }}
                          style={{ position: "absolute", top: 4, right: 4, width: 18, height: 18, borderRadius: "50%", border: "none", background: "var(--bg-danger)", color: "#fff", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                        >✕</button>
                      </>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>点击或拖拽上传视频 (MP4/MOV)</span>
                      </div>
                    )}
                  </div>
                  <input ref={videoRefSlotRef} type="file" accept="video/mp4,video/quicktime,video/*" style={{ display: "none" }} onChange={handleVideoRefFileInput} />
                </div>
              )}

              {/* ── Audio references: show attached audio from pool (all modes) ── */}
              {pool.entries.filter(e => e.mediaType === "audio").length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, marginBottom: 4 }}>音频参考</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {pool.entries.filter(e => e.mediaType === "audio").map((entry) => (
                      <div key={entry.number} style={{
                        display: "flex", alignItems: "center", gap: 4,
                        padding: "3px 8px", borderRadius: 6,
                        border: "0.5px solid var(--border)",
                        background: "var(--bg-secondary)", fontSize: 11, color: "var(--text-secondary)",
                      }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
                        @音频{entry.number}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Hidden file inputs for frame slots */}
              <input ref={firstFrameSlotRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleFrameFileInput(e, "first")} />
              <input ref={lastFrameSlotRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleFrameFileInput(e, "last")} />
            </div>
          )}

          <RichPromptInput value={inputText} onChange={(v) => { setInputText(v); handlePromptChange(v); }} onKeyDown={handleKeyDown} onCursorPosChange={(pos) => { cursorPosRef.current = pos; }} placeholder="描述你想要生成的画面内容，@引用素材" disabled={false} maxLength={5000} pool={promptPool} minHeight={120} maxHeight={0} showStrip={false} onDeleteRefEntry={handleDeleteRefEntry} style={{ flex: 1 }} showPromptAssistant promptAssistantProviderId={selectedProviderId} />

          {/* Bottom toolbar */}
          <div className="flex items-center justify-between" style={{ flexShrink: 0 }}>
            <div className="flex items-center gap-3" style={{ flexShrink: 0, minWidth: 0 }}>
              <div style={{ flexShrink: 0 }}><ChannelModelSelector selectedProviderId={selectedProviderId} selectedModelId={selectedModel} availableProviders={availableProviders} availableModels={availableVideoModels.map((m) => ({ id: m.id, label: m.label || m.id, providerId: selectedProviderId }))} onProviderChange={handleProviderChange} onModelChange={handleModelChange} onMenuOpenChange={setAnyMenuOpen} /></div>

              <div className="flex items-center gap-1 relative nodrag" style={{ color: "var(--text-secondary)", fontSize: "12px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, padding: "4px 8px", borderRadius: "6px", transition: "background-color 0.15s" }} onClick={() => setShowParamsPanel(!showParamsPanel)} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
                <span>{selectedAspectRatio} · {selectedResolution} · {formatDuration(duration)}</span>
                {generateAudio && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
            </div>


            <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
              {/* Jimeng Official: Browser Login Button */}
              {currentIsJimengOfficial && (
                <button
                  onClick={async () => {
                    try {
                      // Check environment first
                      const env = await jimengBrowserCheckEnv();
                      if (!env.playwright_installed) {
                        addToast("info", "正在安装Playwright（首次使用需安装）...");
                        try {
                          await jimengBrowserInstall();
                          addToast("success", "Playwright安装成功");
                        } catch (installErr) {
                          addToast("error", `Playwright安装失败: ${installErr}`);
                          return;
                        }
                      }
                      const result = await jimengBrowserOpenLogin();
                      addToast("success", result.message || "浏览器已启动，请在浏览器中登录即梦账号");
                    } catch (e) {
                      addToast("error", `打开浏览器失败: ${e}`);
                    }
                  }}
                  title="打开浏览器登录即梦（浏览器自动化模式，更稳定）"
                  className="nodrag"
                  style={{
                    height: "28px",
                    padding: "0 10px",
                    borderRadius: "6px",
                    backgroundColor: "var(--bg-hover)",
                    border: "1px solid var(--border)",
                    color: "var(--accent-btn)",
                    cursor: "pointer",
                    fontSize: "11px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    transition: "all 0.2s",
                    flexShrink: 0,
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  浏览器登录
                </button>
              )}
              <div className="relative" style={{ flexShrink: 0 }}>
                <button onClick={() => setShowLinkInput(!showLinkInput)} disabled={isImporting} title="链接导入视频" className="nodrag" style={{ width: "28px", height: "28px", borderRadius: "6px", backgroundColor: showLinkInput ? "var(--bg-hover)" : "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)", cursor: isImporting ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s", opacity: isImporting ? 0.5 : 1 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                </button>
                {showLinkInput && (
                  <div className="nodrag" style={{ position: "absolute", bottom: "100%", right: 0, marginBottom: "6px", backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "8px", boxShadow: "0 4px 16px rgba(0,0,0,0.4)", padding: "10px", zIndex: 50, width: "280px", display: "flex", flexDirection: "column", gap: "8px" }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ fontSize: "12px", color: "var(--text-primary)", fontWeight: 500 }}>链接导入视频</div>
                    <input type="text" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !isImporting) { e.preventDefault(); handleImportLink(); } }} placeholder="粘贴视频链接..." disabled={isImporting} className="nodrag" style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "12px", outline: "none" }} />
                    <div className="flex items-center gap-2" style={{ justifyContent: "flex-end" }}>
                      <button onClick={() => { setShowLinkInput(false); setLinkUrl(""); }} disabled={isImporting} style={{ padding: "5px 12px", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "transparent", color: "var(--text-secondary)", fontSize: "12px", cursor: "pointer" }}>取消</button>
                      <button onClick={handleImportLink} disabled={isImporting || !linkUrl.trim()} style={{ padding: "5px 12px", borderRadius: "6px", border: "none", backgroundColor: linkUrl.trim() && !isImporting ? "var(--accent-btn)" : "var(--bg-hover)", color: linkUrl.trim() && !isImporting ? "#fff" : "var(--text-muted)", fontSize: "12px", cursor: linkUrl.trim() && !isImporting ? "pointer" : "not-allowed" }}>{isImporting ? "下载中..." : "导入"}</button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1 relative nodrag" style={{ color: "var(--text-secondary)", fontSize: "12px", cursor: "pointer", flexShrink: 0 }} onClick={() => setShowCountMenu(!showCountMenu)}>
                <span>{generateCount}个</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                {showCountMenu && (
                  <div className="nodrag" style={{ position: "absolute", bottom: "100%", right: 0, marginBottom: "4px", backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "8px", boxShadow: "0 4px 12px rgba(0,0,0,0.3)", padding: "4px", zIndex: 50, minWidth: "60px" }}>
                    {[1, 2, 4].map((n) => (
                      <button key={n} onClick={(e) => { e.stopPropagation(); setGenerateCount(n); setShowCountMenu(false); }} style={{ display: "block", width: "100%", padding: "6px 10px", border: "none", borderRadius: "4px", backgroundColor: generateCount === n ? "var(--bg-hover)" : "transparent", color: generateCount === n ? "var(--accent)" : "var(--text-primary)", fontSize: "12px", cursor: "pointer", textAlign: "center" }}>{n}个</button>
                    ))}
                  </div>
                )}
              </div>
              {showPrice && <span className="nodrag" style={{ fontSize: '11px', color: '#7ab4f0', fontWeight: 500, flexShrink: 0, whiteSpace: 'nowrap' }}>{priceYuanPerSec}元/秒</span>}
              {/* 恢复轮询按钮：当 isGenerating=true 且有 jobId 时，说明任务在排队，用户可以手动触发恢复 */}
              {isGenerating && nodeData.generationJobId && (
                <button
                  onClick={() => {
                    // 触发一次重新轮询：短暂设置 isGenerating 让 useEffect 重新挂载轮询
                    updateNodeData(id, { isGenerating: false });
                    setTimeout(() => {
                      updateNodeData(id, { isGenerating: true });
                      addToast("info", "正在重新连接任务...");
                    }, 100);
                  }}
                  title="重新连接排队中的任务"
                  className="nodrag"
                  style={{
                    width: "28px", height: "28px", borderRadius: "6px",
                    backgroundColor: "rgba(59, 130, 246, 0.2)",
                    border: "1px solid rgba(59, 130, 246, 0.4)",
                    color: "rgb(96, 165, 250)",
                    cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                    animation: "videoGenPulse 2s ease-in-out infinite",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10"/>
                    <polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                </button>
              )}
              <button onClick={handleSend} disabled={!inputText.trim()} title={inputText.trim() ? "发送" : "请输入内容"} className="nodrag" style={{ width: "32px", height: "32px", borderRadius: "8px", backgroundColor: inputText.trim() ? "var(--accent-btn)" : "var(--bg-hover)", color: inputText.trim() ? "#fff" : "var(--text-secondary)", border: "none", cursor: inputText.trim() ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s", flexShrink: 0 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Params panel — placed outside scrollable container to avoid overflow clipping */}
      {showParamsPanel && (
        <div className="nodrag" style={{ position: "absolute", bottom: 52, left: 170, backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "8px", boxShadow: "0 4px 16px rgba(0,0,0,0.4)", padding: "10px", zIndex: 50, width: "260px" }} onClick={(e) => e.stopPropagation()}>
          {/* Channel indicator — visually distinct header for different providers */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px", padding: "4px 8px", borderRadius: "6px", backgroundColor: currentIsGrok ? "rgba(120,80,255,0.15)" : currentIsJimengOfficial ? "rgba(255,160,0,0.12)" : "var(--bg-secondary)" }}>
            <span style={{ fontSize: "11px", fontWeight: 600, color: currentIsGrok ? "rgb(120,80,255)" : currentIsJimengOfficial ? "rgb(255,160,0)" : "var(--text-secondary)" }}>
              {currentIsGrok ? "Grok Video 参数" : currentIsJimengOfficial ? "即梦官方 参数" : currentIsVjimeng ? "虾客漫视频参数" : currentApiFormat === "kling" ? "可灵 参数" : currentApiFormat === "luma" ? "Luma 参数" : currentApiFormat === "runway" ? "Runway 参数" : currentApiFormat === "minimax" ? "海螺 参数" : currentApiFormat === "volcano" ? "火山方舟 参数" : "视频参数"}
            </span>
            <button onClick={() => setShowParamsPanel(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "12px", padding: 0 }}>✕</button>
          </div>
          {currentIsVjimeng && (
            <div style={{ marginBottom: "10px" }}>
              <div style={{ fontSize: "12px", color: "var(--text-primary)", fontWeight: 500, marginBottom: "6px" }}>自定义模型 ID</div>
              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  className="nodrag"
                  value={customVideoModelId}
                  onChange={(e) => setCustomVideoModelId(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleApplyCustomVideoModel(); }}
                  placeholder="例如 transit9-new-model"
                  style={{ flex: 1, minWidth: 0, padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: "11px", outline: "none" }}
                />
                <button
                  type="button"
                  onClick={handleApplyCustomVideoModel}
                  disabled={!customVideoModelId.trim()}
                  style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: customVideoModelId.trim() ? "var(--accent)" : "var(--bg-hover)", color: customVideoModelId.trim() ? "white" : "var(--text-muted)", fontSize: "11px", cursor: customVideoModelId.trim() ? "pointer" : "not-allowed", whiteSpace: "nowrap" }}
                >
                  使用
                </button>
              </div>
            </div>
          )}
          <div style={{ marginBottom: "10px" }}><div style={{ fontSize: "12px", color: "var(--text-primary)", fontWeight: 500, marginBottom: "6px" }}>比例</div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(currentAspectRatios.length, 5)}, 1fr)`, gap: "4px" }}>
              {currentAspectRatios.map((ratio) => (
                <button key={ratio.value} onClick={() => { setSelectedAspectRatio(ratio.value); setShowParamsPanel(false); }} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "2px", padding: "5px 2px", borderRadius: "6px", border: selectedAspectRatio === ratio.value ? "1.5px solid var(--accent)" : "1px solid var(--border)", backgroundColor: selectedAspectRatio === ratio.value ? "var(--bg-hover)" : "transparent", color: selectedAspectRatio === ratio.value ? "var(--accent)" : "var(--text-secondary)", fontSize: "10px", cursor: "pointer", transition: "all 0.2s", minHeight: "38px" }}><span style={{ fontSize: "13px", lineHeight: 1 }}>{ratio.icon}</span><span>{ratio.label}</span></button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: "10px" }}><div style={{ fontSize: "12px", color: "var(--text-primary)", fontWeight: 500, marginBottom: "6px" }}>清晰度</div>
            <div style={{ display: "flex", gap: "4px" }}>
              {currentResolutions.map((res) => (
                <button key={res.value} onClick={() => { setSelectedResolution(res.value); setShowParamsPanel(false); }} style={{ flex: 1, padding: "5px 8px", borderRadius: "6px", border: selectedResolution === res.value ? "1.5px solid var(--accent)" : "1px solid var(--border)", backgroundColor: selectedResolution === res.value ? "var(--bg-hover)" : "transparent", color: selectedResolution === res.value ? "var(--accent)" : "var(--text-secondary)", fontSize: "11px", cursor: "pointer", transition: "all 0.2s", fontWeight: selectedResolution === res.value ? 500 : 400 }}>{res.label}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: "10px" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}><span style={{ fontSize: "12px", color: "var(--text-primary)", fontWeight: 500 }}>视频时长</span><span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{formatDuration(duration)}</span></div>
            {currentIsGrok ? (
              selectedModel.startsWith("grok-imagine") ? (
                <input type="range" min={1} max={15} step={1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="nodrag" style={{ width: "100%", height: "4px", borderRadius: "2px", background: `linear-gradient(to right, var(--accent) ${(duration - 1) / 14 * 100}%, var(--bg-hover) ${(duration - 1) / 14 * 100}%)`, outline: "none", cursor: "pointer", appearance: "none", WebkitAppearance: "none" }} />
              ) : (
              <div style={{ display: "flex", gap: "4px" }}>
                {(selectedModel.endsWith("-pro") ? [10] : selectedModel.endsWith("-max") ? [15] : [10, 15]).map((sec) => (
                  <button key={sec} onClick={() => { setDuration(sec); setShowParamsPanel(false); }} style={{ flex: 1, padding: "5px 8px", borderRadius: "6px", border: duration === sec ? "1.5px solid var(--accent)" : "1px solid var(--border)", backgroundColor: duration === sec ? "var(--bg-hover)" : "transparent", color: duration === sec ? "var(--accent)" : "var(--text-secondary)", fontSize: "11px", cursor: "pointer", transition: "all 0.2s", fontWeight: duration === sec ? 500 : 400 }}>{sec}s</button>
                ))}
              </div>
              )) : (
              <input type="range" min={4} max={15} step={1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="nodrag" style={{ width: "100%", height: "4px", borderRadius: "2px", background: `linear-gradient(to right, var(--accent) ${(duration - 4) / 11 * 100}%, var(--bg-hover) ${(duration - 4) / 11 * 100}%)`, outline: "none", cursor: "pointer", appearance: "none", WebkitAppearance: "none" }} />
            )}
          </div>
          <div><div style={{ fontSize: "12px", color: "var(--text-primary)", fontWeight: 500, marginBottom: "6px" }}>生成音频{currentIsGrok ? " (Grok音画同步)" : audioNotSupported ? " (该通道不支持)" : ""}</div>
            {audioNotSupported ? (
              <div style={{ fontSize: "11px", color: "var(--text-muted)", padding: "4px 8px", borderRadius: "6px", backgroundColor: "var(--bg-secondary)" }}>
                {currentApiFormat === "luma" ? "Luma Dream Machine 不支持音频生成" : "Runway 不支持音频生成"}
              </div>
            ) : (
            <div style={{ display: "flex", gap: "4px" }}>
              <button onClick={() => { setGenerateAudio(true); setShowParamsPanel(false); }} style={{ flex: 1, padding: "5px 8px", borderRadius: "6px", border: generateAudio ? "1.5px solid var(--accent)" : "1px solid var(--border)", backgroundColor: generateAudio ? "var(--bg-hover)" : "transparent", color: generateAudio ? "var(--accent)" : "var(--text-secondary)", fontSize: "11px", cursor: "pointer", transition: "all 0.2s", fontWeight: generateAudio ? 500 : 400 }}>开启</button>
              <button onClick={() => { setGenerateAudio(false); setShowParamsPanel(false); }} style={{ flex: 1, padding: "5px 8px", borderRadius: "6px", border: !generateAudio ? "1.5px solid var(--accent)" : "1px solid var(--border)", backgroundColor: !generateAudio ? "var(--bg-hover)" : "transparent", color: !generateAudio ? "var(--accent)" : "var(--text-secondary)", fontSize: "11px", cursor: "pointer", transition: "all 0.2s", fontWeight: !generateAudio ? 500 : 400 }}>关闭</button>
            </div>
            )}
          </div>
      </div>
    )}

      <NodeResizeHandle width={nodeWidth} height={nodeHeight} onResize={handleResize} minWidth={560} maxWidth={1000} minHeight={300} maxHeight={1200} />
      </div>
      <Handle type="target" position={Position.Left} className="!bg-[var(--accent-secondary)] !w-6 !h-6 !border-2 !border-[var(--bg-node)]" />
      <Handle type="source" position={Position.Right} className="!bg-[var(--accent-secondary)] !w-6 !h-6 !border-2 !border-[var(--bg-node)]" />
    </>
  );
});



