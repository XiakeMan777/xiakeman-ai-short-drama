import type { VideoApiConfig, VideoBackendType } from '@/types';
import { isSeedanceServiceBackend } from '@/lib/seedanceApi';

export function supportsVideoExtensionBackend(backend: VideoBackendType) {
  return backend === 'volcengine' || isSeedanceServiceBackend(backend);
}

export function isVideoExtensionEnabled(config: Pick<VideoApiConfig, 'useVideoExtension' | 'seedanceUseVideoExtension'>) {
  return config.useVideoExtension === true || config.seedanceUseVideoExtension === true;
}
