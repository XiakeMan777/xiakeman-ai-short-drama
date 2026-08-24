import type { ImageSize } from "./models/image/types";

// ---------------------------------------------------------------------------
// Generate Image Payload
// ---------------------------------------------------------------------------

export interface GenerateImagePayload {
  /** Model ID in "provider/model" format */
  model: string;
  /** Text prompt */
  prompt: string;
  /** Image size tier */
  size: ImageSize;
  /** Aspect ratio value (e.g. "1:1", "16:9") */
  aspectRatio: string;
  /** Reference images (URLs, data URLs, or file paths) */
  referenceImages?: string[];
  /** Model-specific extra parameters */
  extraParams?: Record<string, unknown>;
  /** Negative prompt — things to exclude from generation */
  negativePrompt?: string;
  /** Seed for reproducible generation — null means random */
  seed?: number | null;
}

export interface GenerationJobStatus {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  result?: string;
  error?: string;
  /** Real-time progress percentage (0-100) from the external API, -1 if unknown */
  progress?: number;
}

// ---------------------------------------------------------------------------
// AI Gateway interface (port)
// ---------------------------------------------------------------------------

export interface AiGateway {
  /** Set API key for a provider */
  setApiKey(provider: string, key: string): Promise<void>;

  /** Get API key for a provider */
  getApiKey(provider: string): Promise<string>;

  /** Set base URL for a provider */
  setBaseUrl(provider: string, url: string): Promise<void>;

  /** Get base URL for a provider */
  getBaseUrl(provider: string): Promise<string>;

  /** List all available models (provider/model format) */
  listModels(): Promise<string[]>;

  /** Submit an image generation job (async) */
  submitGenerateImageJob(payload: GenerateImagePayload): Promise<string>;

  /** Get generation job status */
  getGenerateImageJob(jobId: string): Promise<GenerationJobStatus>;
  /** Query task via remote Task Token API (survives local DB loss) */
  queryTaskToken(jobId: string): Promise<GenerationJobStatus>;

  /** Generate an image synchronously */
  generateImage(provider: string, payload: GenerateImagePayload): Promise<string>;

  /** Refund credits for a failed image generation job */
  refundImageCredits(jobId: string, provider?: string): Promise<void>;
}



