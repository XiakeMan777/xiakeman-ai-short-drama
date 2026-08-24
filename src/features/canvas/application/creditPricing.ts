/**
 * 定价表
 *
 * 内部单位：分（1元 = 100分）
 * 视频：各模型固定价格（分/秒）
 */

// 图片模型定价（分/张）— XioArtTV 云智通道
export const IMAGE_CREDIT_PRICES: Record<string, number> = {
  "gpt-image-2": 30,  // 0.3元/张 (云智通道)
};

// 视频模型定价（分/秒）— XioArtTV
export const VIDEO_CREDIT_PRICES: Record<string, number> = {
  "mini": 20,   // 0.2元/秒
  "fast": 30,   // 0.3元/秒
  "2.0": 40,    // 0.4元/秒
  "transit9-mini": 80,   // 0.8元/秒
  "transit9-fast": 80,   // 0.8元/秒
  "transit9-2.0": 100,   // 1.0元/秒
  "xinghe-mini": 80,   // 0.8元/秒
  "xinghe-fast": 80,   // 0.8元/秒
  "xinghe-2.0": 100,   // 1.0元/秒
  // ── SD2-Video (备用通道) ──
  "sd2-720p-mini": 50,     // 0.5元/秒
  "sd2-720p-fast": 70,     // 0.7元/秒
  "sd2-720p-sh": 90,       // 0.9元/秒
  "sd2-720p": 100,         // 1元/秒
  "sd2-1080p-mini": 70,    // 0.7元/秒
  "sd2-1080p-fast": 100,   // 1元/秒
  "sd2-1080p-zt": 120,     // 1.2元/秒
  "sd2-1080p": 140,        // 1.4元/秒
};

// ── 通用图片模型列表（自定义通道 / 中转站通用） ──
// 覆盖主流中转站支持的图片生成模型
export const UNIVERSAL_IMAGE_MODELS: { id: string; label: string; series: string }[] = [
  // ── GPT Image (OpenAI) ──
  { id: "gpt-image-1", label: "GPT Image 1", series: "gpt-image" },
  { id: "gpt-image-2", label: "GPT Image 2", series: "gpt-image" },
  { id: "gpt-image-2-vip", label: "GPT Image 2 VIP", series: "gpt-image" },
  // ── DALL·E (OpenAI) ──
  { id: "dall-e-2", label: "DALL·E 2", series: "dall-e" },
  { id: "dall-e-3", label: "DALL·E 3", series: "dall-e" },
  // ── Gemini Image (Google) ──
  { id: "gemini-2.5-flash-image-preview", label: "Gemini 2.5 Flash Image", series: "gemini-image" },
  { id: "gemini-3-pro-image-preview", label: "Gemini 3 Pro Image", series: "gemini-image" },
  { id: "gemini-3.1-flash-image-preview", label: "Gemini 3.1 Flash Image", series: "gemini-image" },
  // ── Grok Image (xAI) ──
  { id: "grok-2-image", label: "Grok 2 Image", series: "grok-image" },
  { id: "grok-4-2-image", label: "Grok 4 Image", series: "grok-image" },
  // ── Flux (Black Forest Labs) ──
  { id: "flux-1.1-pro", label: "Flux 1.1 Pro", series: "flux" },
  { id: "flux-1.0-pro", label: "Flux 1.0 Pro", series: "flux" },
  { id: "flux-1.0-dev", label: "Flux 1.0 Dev", series: "flux" },
  { id: "flux-1.0-schnell", label: "Flux 1.0 Schnell", series: "flux" },
  // ── Stable Diffusion (Stability AI) ──
  { id: "stable-diffusion-3.5-large", label: "SD 3.5 Large", series: "sd" },
  { id: "stable-diffusion-3.5-medium", label: "SD 3.5 Medium", series: "sd" },
  { id: "stable-diffusion-3-medium", label: "SD 3 Medium", series: "sd" },
  { id: "sdxl", label: "SDXL", series: "sd" },
  // ── Seedream / 即梦生图 (字节) ──
  { id: "doubao-seedream-4-0-250828", label: "Seedream 4.0", series: "seedream" },
  { id: "doubao-seedream-4-5-251128", label: "Seedream 4.5", series: "seedream" },
  { id: "doubao-seedream-5-0-260128", label: "Seedream 5.0", series: "seedream" },
  // ── Nano Banana (北辰) ──
  { id: "nano-banana-2", label: "Nano Banana 2", series: "banana" },
  { id: "nano-banana-pro", label: "Nano Banana Pro", series: "banana" },
  // ── Midjourney ──
  { id: "midjourney", label: "Midjourney", series: "mj" },
  // ── Ideogram ──
  { id: "ideogram-3.0", label: "Ideogram 3.0", series: "ideogram" },
];

// ── 通用视频模型列表（自定义通道 / 中转站通用） ──
// 与 VideoNode 中的 UNIVERSAL_VIDEO_MODELS 保持一致
export const UNIVERSAL_VIDEO_MODELS: { id: string; label: string; series: string }[] = [
  // ── Seedance (即梦/Seed) ──
  { id: "seedance-2.0", label: "Seedance 2.0", series: "seedance" },
  { id: "seedance-2.0-pro", label: "Seedance 2.0 Pro", series: "seedance" },
  { id: "seedance-2.0-lite", label: "Seedance 2.0 Lite", series: "seedance" },
  // ── 即梦 (Jimeng/字节) ──
  { id: "jimeng-video-seedance-2.0", label: "即梦 Seedance 2.0", series: "seedance" },
  { id: "jimeng-video-seedance-2.0-fast", label: "即梦 Seedance 2.0 Fast", series: "seedance" },
  { id: "jimeng-video-3.5-pro", label: "即梦 3.5 Pro", series: "v3" },
  { id: "jimeng-video-3.5", label: "即梦 3.5", series: "v3" },
  { id: "jimeng_vgfm_t2v_l20", label: "即梦文生视频", series: "v3" },
  { id: "jimeng_vgfm_i2v_l20", label: "即梦图生视频", series: "v3" },
  // ── Grok Video (xAI) ──
  { id: "grok-video-3", label: "Grok Video 3", series: "grok" },
  { id: "grok-video-3-pro", label: "Grok Video 3 Pro", series: "grok" },
  { id: "grok-video-3-max", label: "Grok Video 3 Max", series: "grok" },
  { id: "grok-video-1.5-pro", label: "Grok Video 1.5 Pro", series: "grok" },
  { id: "grok-video-1.5-max", label: "Grok Video 1.5 Max", series: "grok" },
  { id: "grok-imagine-video", label: "Grok Imagine Video", series: "grok" },
  { id: "grok-imagine-video-1.5-preview", label: "Grok Imagine 1.5 Preview", series: "grok" },
  // ── Veo (Google) ──
  { id: "veo-3.1", label: "Veo 3.1", series: "veo" },
  { id: "veo-3.1-fast", label: "Veo 3.1 Fast", series: "veo" },
  { id: "veo-3", label: "Veo 3", series: "veo" },
  { id: "veo-3-fast", label: "Veo 3 Fast", series: "veo" },
  { id: "veo-2", label: "Veo 2", series: "veo" },
  // ── Sora (OpenAI) ──
  { id: "sora-2", label: "Sora 2", series: "sora" },
  // ── Vidu ──
  { id: "viduq1", label: "Vidu Q1", series: "vidu" },
  { id: "vidu-1.5", label: "Vidu 1.5", series: "vidu" },
  // ── Kling (可灵) ──
  { id: "kling-v1", label: "可灵 V1", series: "kling" },
  { id: "kling-v1-5", label: "可灵 V1.5", series: "kling" },
  { id: "kling-v1-6", label: "可灵 V1.6", series: "kling" },
  { id: "kling-v1-pro", label: "可灵 V1 Pro", series: "kling" },
  { id: "kling-v2-5-turbo", label: "可灵 V2.5 Turbo", series: "kling" },
  { id: "kling-v2-6", label: "可灵 V2.6", series: "kling" },
  { id: "kling-v2-master", label: "可灵 V2 Master", series: "kling" },
  { id: "kling-v3", label: "可灵 V3", series: "kling" },
  { id: "kling-v3-omni", label: "可灵 V3 Omni", series: "kling" },
  { id: "kling-3.0-turbo", label: "可灵 3.0 Turbo", series: "kling" },
  { id: "kling-video-o1", label: "可灵 O1", series: "kling" },
  // ── Luma Dream Machine ──
  { id: "ray-1-6", label: "Luma Ray 1.6", series: "luma" },
  { id: "ray-2", label: "Luma Ray 2", series: "luma" },
  // ── Runway ──
  { id: "gen3a_turbo", label: "Runway Gen-3 Turbo", series: "runway" },
  { id: "gen4_turbo", label: "Runway Gen-4 Turbo", series: "runway" },
  // ── MiniMax 海螺 ──
  { id: "MiniMax-Hailuo-02", label: "海螺 02", series: "minimax" },
  { id: "MiniMax-Hailuo-2.3", label: "海螺 2.3", series: "minimax" },
  { id: "S2V-01", label: "海螺 S2V-01 主体参考", series: "minimax" },
  // ── Wan (万相/阿里云) ──
  { id: "wan2.5-t2v-preview", label: "万相 2.5 文生视频", series: "wan" },
  { id: "wan2.5-i2v-preview", label: "万相 2.5 图生视频", series: "wan" },
  { id: "wan2.2-i2v-flash", label: "万相 2.2 Flash", series: "wan" },
  { id: "wan2.2-i2v-plus", label: "万相 2.2 Plus", series: "wan" },
  { id: "wanx2.1-i2v-plus", label: "万相 2.1 Plus", series: "wan" },
  { id: "wanx2.1-i2v-turbo", label: "万相 2.1 Turbo", series: "wan" },
];

// ── 通用对话模型列表（自定义通道 / 中转站通用） ──
// 覆盖主流中转站支持的对话模型（OpenAI /v1/chat/completions 格式）
export const UNIVERSAL_CHAT_MODELS: { id: string; label: string; series: string }[] = [
  // ── GPT (OpenAI) ──
  { id: "gpt-5.5", label: "GPT-5.5", series: "gpt" },
  { id: "gpt-5.4", label: "GPT-5.4", series: "gpt" },
  { id: "gpt-5.1", label: "GPT-5.1", series: "gpt" },
  { id: "gpt-4.1", label: "GPT-4.1", series: "gpt" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", series: "gpt" },
  { id: "gpt-4.1-nano", label: "GPT-4.1 Nano", series: "gpt" },
  { id: "gpt-4o", label: "GPT-4o", series: "gpt" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", series: "gpt" },
  // ── o 系列 (OpenAI 推理) ──
  { id: "o3", label: "o3", series: "o" },
  { id: "o3-mini", label: "o3 Mini", series: "o" },
  { id: "o4-mini", label: "o4 Mini", series: "o" },
  // ── Claude (Anthropic) ──
  { id: "claude-opus-4-7", label: "Claude Opus 4.7", series: "claude" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", series: "claude" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", series: "claude" },
  { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", series: "claude" },
  // ── Gemini (Google) ──
  { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro", series: "gemini" },
  { id: "gemini-3.1-flash", label: "Gemini 3.1 Flash", series: "gemini" },
  { id: "gemini-3-pro", label: "Gemini 3 Pro", series: "gemini" },
  { id: "gemini-3-flash", label: "Gemini 3 Flash", series: "gemini" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", series: "gemini" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", series: "gemini" },
  // ── DeepSeek ──
  { id: "deepseek-chat", label: "DeepSeek Chat", series: "deepseek" },
  { id: "deepseek-reasoner", label: "DeepSeek Reasoner", series: "deepseek" },
  // ── Qwen (通义千问/阿里云) ──
  { id: "qwen3-235b-a22b", label: "Qwen3 235B", series: "qwen" },
  { id: "qwen3-30b-a3b", label: "Qwen3 30B", series: "qwen" },
  { id: "qwen-turbo-latest", label: "通义千问 Turbo", series: "qwen" },
  { id: "qwen-plus-latest", label: "通义千问 Plus", series: "qwen" },
  { id: "qwen-max-latest", label: "通义千问 Max", series: "qwen" },
  // ── Grok (xAI) ──
  { id: "grok-3", label: "Grok 3", series: "grok" },
  { id: "grok-3-mini", label: "Grok 3 Mini", series: "grok" },
  // ── 豆包 (字节) ──
  { id: "doubao-1.5-pro-256k", label: "豆包 1.5 Pro", series: "doubao" },
  { id: "doubao-1.5-lite-32k", label: "豆包 1.5 Lite", series: "doubao" },
  // ── Llama (Meta) ──
  { id: "llama-4-maverick", label: "Llama 4 Maverick", series: "llama" },
  { id: "llama-3.3-70b-instruct", label: "Llama 3.3 70B", series: "llama" },
];

/** 图片模型 key 集合（用于使用统计分类） */
export const IMAGE_CREDIT_PRICES_KEYS = new Set(Object.keys(IMAGE_CREDIT_PRICES));

/** 视频模型 key 集合（用于使用统计分类） */
export const VIDEO_CREDIT_PRICES_KEYS = new Set(Object.keys(VIDEO_CREDIT_PRICES));

/** 判断 deduction 记录属于哪种使用类型 — image 或 video */
export function getUsageCategory(_provider: string, model: string): "image" | "video" {
  // 云智通道的图片模型 → image
  if (IMAGE_CREDIT_PRICES_KEYS.has(model)) return "image";
  // 其他 → video
  return "video";
}

/** 获取图片生成每张所需的积分数量 */
export function getImageCreditPerImage(model: string): number {
  return IMAGE_CREDIT_PRICES[model] || 30;
}

/** 获取视频生成每秒所需的积分数量 */
export function getVideoCreditPerSecond(model: string): number {
  return VIDEO_CREDIT_PRICES[model] || 47;
}

/** 固定价格模型（已废弃，保留空表向后兼容） */
export const FIXED_PRICE_VIDEO_MODELS: Record<string, number> = {};

/** 判断是否为固定价格模型 */
export function isFixedPriceVideoModel(model: string): boolean {
  return model in FIXED_PRICE_VIDEO_MODELS;
}

/** 获取固定价格（不存在返回 null） */
export function getVideoFixedPrice(model: string): number | null {
  return FIXED_PRICE_VIDEO_MODELS[model] ?? null;
}



