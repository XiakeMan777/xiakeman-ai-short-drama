import type { VideoApiConfig } from '@/types';
import { normalizeWholeSecondVideoDuration } from '@/lib/storyboardDuration';

export const VOLC_SEEDANCE_25_MODEL_ID = 'doubao-seedance-2-5-260628';

export const VOLC_VIDEO_MODEL_OPTIONS = [
  {
    value: VOLC_SEEDANCE_25_MODEL_ID,
    label: 'Seedance 2.5（30 图 / 10 视频 / 10 音频）',
  },
  {
    value: 'doubao-seedance-2-0-260128-fast',
    label: 'Seedance 2.0 Fast（兼容旧配置）',
  },
  {
    value: 'doubao-seedance-2-0-fast-260128',
    label: 'Seedance 2.0 Fast（快速）',
  },
  {
    value: 'doubao-seedance-2-0-260128',
    label: 'Seedance 2.0 标准',
  },
] as const;

export interface VolcVideoModelCapabilities {
  isSeedance25: boolean;
  maxImages: number;
  maxVideos: number;
  maxAudios: number;
  maxTotalReferences: number;
  minDuration: number;
  maxDuration: number;
  outputFormats: readonly ('mp4' | 'mov')[];
}

const LEGACY_VOLC_CAPABILITIES: VolcVideoModelCapabilities = {
  isSeedance25: false,
  maxImages: 9,
  maxVideos: 3,
  maxAudios: 3,
  maxTotalReferences: 15,
  minDuration: 4,
  maxDuration: 15,
  outputFormats: ['mp4'],
};

const SEEDANCE_25_CAPABILITIES: VolcVideoModelCapabilities = {
  isSeedance25: true,
  maxImages: 30,
  maxVideos: 10,
  maxAudios: 10,
  maxTotalReferences: 50,
  minDuration: 4,
  maxDuration: 30,
  outputFormats: ['mp4', 'mov'],
};

export function isVolcSeedance25Model(model: string | undefined | null): boolean {
  return model?.trim().toLowerCase() === VOLC_SEEDANCE_25_MODEL_ID;
}

export function getVolcVideoModelCapabilities(
  model: string | undefined | null,
): VolcVideoModelCapabilities {
  return isVolcSeedance25Model(model)
    ? SEEDANCE_25_CAPABILITIES
    : LEGACY_VOLC_CAPABILITIES;
}

export function getVideoImageReferenceLimit(
  config: Pick<VideoApiConfig, 'backend' | 'volcModel'> | undefined,
): number {
  return config?.backend === 'volcengine'
    ? getVolcVideoModelCapabilities(config.volcModel).maxImages
    : LEGACY_VOLC_CAPABILITIES.maxImages;
}

export function normalizeVolcVideoDuration(
  value: number | string | undefined | null,
  fallback: number | string | undefined | null,
  model: string | undefined | null,
): number {
  const capabilities = getVolcVideoModelCapabilities(model);
  return normalizeWholeSecondVideoDuration(
    value,
    fallback,
    capabilities.minDuration,
    capabilities.maxDuration,
  );
}

export function getVolcVideoDurationOptions(model: string | undefined | null): number[] {
  return isVolcSeedance25Model(model)
    ? [4, 5, 6, 8, 10, 12, 15, 20, 25, 30]
    : [4, 5, 6, 8, 10, 12, 15];
}

export function assertVolcReferenceCounts(
  model: string | undefined | null,
  counts: { images: number; videos: number; audios: number },
): void {
  const capabilities = getVolcVideoModelCapabilities(model);
  if (counts.images > capabilities.maxImages) {
    throw new Error(`当前火山模型最多支持 ${capabilities.maxImages} 张 reference_image，当前传入 ${counts.images} 张。`);
  }
  if (counts.videos > capabilities.maxVideos) {
    throw new Error(`当前火山模型最多支持 ${capabilities.maxVideos} 个 reference_video，当前传入 ${counts.videos} 个。`);
  }
  if (counts.audios > capabilities.maxAudios) {
    throw new Error(`当前火山模型最多支持 ${capabilities.maxAudios} 个 reference_audio，当前传入 ${counts.audios} 个。`);
  }
  const total = counts.images + counts.videos + counts.audios;
  if (total > capabilities.maxTotalReferences) {
    throw new Error(`当前火山模型最多支持 ${capabilities.maxTotalReferences} 个参考素材，当前传入 ${total} 个。`);
  }
}
