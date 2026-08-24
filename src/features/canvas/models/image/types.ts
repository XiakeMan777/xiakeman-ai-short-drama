// ---------------------------------------------------------------------------
// Image model type definitions
// ---------------------------------------------------------------------------

/** Image size tiers */
export type ImageSize = "0.5K" | "1K" | "2K" | "4K";

/** Resolution for a given size tier */
export interface ImageResolution {
  label: string;
  width: number;
  height: number;
  size: ImageSize;
}

/** Aspect ratio definition */
export interface AspectRatioOption {
  label: string;
  value: string;   // e.g. "1:1", "16:9"
  widthRatio: number;
  heightRatio: number;
}

/** Extra parameter schema for model-specific options */
export type ExtraParamType = "enum" | "boolean" | "number" | "string";

export interface ExtraParamDefinition {
  key: string;
  label: string;
  type: ExtraParamType;
  defaultValue?: unknown;
  /** For enum type: available options */
  options?: { label: string; value: string }[];
  /** For number type */
  min?: number;
  max?: number;
  step?: number;
  /** Description / tooltip */
  description?: string;
}

/** Image model definition */
export interface ImageModelDefinition {
  /** Model ID in "provider/model" format (e.g. "openai-compatible/dall-e-3") */
  id: string;
  /** Display name */
  displayName: string;
  /** Provider ID */
  providerId: string;
  /** Description */
  description?: string;
  /** Supported image sizes */
  supportedSizes: ImageSize[];
  /** Default size */
  defaultSize: ImageSize;
  /** Supported aspect ratios */
  supportedAspectRatios: AspectRatioOption[];
  /** Default aspect ratio value */
  defaultAspectRatio: string;
  /** Whether this model supports image-to-image (reference images) */
  supportsImageToImage: boolean;
  /** Max reference images (0 = unlimited) */
  maxReferenceImages: number;
  /** Extra parameters schema */
  extraParamsSchema: ExtraParamDefinition[];
  /** Expected generation duration in ms (for progress display) */
  expectedDurationMs: number;
  /** Resolve the actual request model and mode label based on reference images */
  resolveRequest: (context: {
    referenceImageCount: number;
  }) => {
    requestModel: string;
    modeLabel: string;
  };
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

export const STANDARD_ASPECT_RATIOS: AspectRatioOption[] = [
  { label: "1:1", value: "1:1", widthRatio: 1, heightRatio: 1 },
  { label: "16:9", value: "16:9", widthRatio: 16, heightRatio: 9 },
  { label: "9:16", value: "9:16", widthRatio: 9, heightRatio: 16 },
  { label: "4:3", value: "4:3", widthRatio: 4, heightRatio: 3 },
  { label: "3:4", value: "3:4", widthRatio: 3, heightRatio: 4 },
  { label: "3:2", value: "3:2", widthRatio: 3, heightRatio: 2 },
  { label: "2:3", value: "2:3", widthRatio: 2, heightRatio: 3 },
  { label: "21:9", value: "21:9", widthRatio: 21, heightRatio: 9 },
  { label: "9:21", value: "9:21", widthRatio: 9, heightRatio: 21 },
  { label: "2:1", value: "2:1", widthRatio: 2, heightRatio: 1 },
  { label: "1:2", value: "1:2", widthRatio: 1, heightRatio: 2 },
];

export const SIZE_TO_MAX_DIMENSION: Record<ImageSize, number> = {
  "0.5K": 512,
  "1K": 1024,
  "2K": 2048,
  "4K": 4096,
};

/** Resolve size + aspect ratio to pixel dimensions */
export function resolvePixelDimensions(
  size: ImageSize,
  aspectRatio: string
): { width: number; height: number } {
  const maxDim = SIZE_TO_MAX_DIMENSION[size];
  const ratio = STANDARD_ASPECT_RATIOS.find((r) => r.value === aspectRatio) || STANDARD_ASPECT_RATIOS[0];
  const { widthRatio, heightRatio } = ratio;

  if (widthRatio >= heightRatio) {
    const width = maxDim;
    const height = Math.round((maxDim * heightRatio) / widthRatio);
    return { width, height };
  } else {
    const height = maxDim;
    const width = Math.round((maxDim * widthRatio) / heightRatio);
    return { width, height };
  }
}

/** Auto aspect ratio value */
export const AUTO_ASPECT_RATIO = "auto";



