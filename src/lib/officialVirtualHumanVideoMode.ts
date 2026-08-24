import type { Asset, VideoBackendType } from '@/types';

export const OFFICIAL_VIRTUAL_HUMAN_REQUIRED_BACKEND: VideoBackendType = 'volcengine';

export function getVideoBackendDisplayName(backend: VideoBackendType): string {
  switch (backend) {
    case 'seedance':
      return '小云雀';
    case 'seedancecloud':
      return '虾客漫SD2';
    case 'xyqagent':
      return '小云雀 Agent';
    case 'hmapi':
      return 'HM 官方';
    case 'volcengine':
      return '火山方舟';
    case 'aliyunbailian':
      return '百炼 HappyHorse';
    default:
      return backend;
  }
}

export function isOfficialVirtualHumanCompatibleVideoBackend(backend: VideoBackendType): boolean {
  return backend === OFFICIAL_VIRTUAL_HUMAN_REQUIRED_BACKEND;
}

export function isOfficialVirtualHumanAsset(asset: Pick<Asset, 'source' | 'type'> | undefined): boolean {
  return asset?.type === 'character' && asset.source === 'volc_virtual_human';
}

export function hasOfficialVirtualHumanProjectAssets(
  assetLibrary: readonly Pick<Asset, 'source' | 'type'>[] | undefined,
): boolean {
  return (assetLibrary ?? []).some(isOfficialVirtualHumanAsset);
}

export function getOfficialVirtualHumanIncompatibleMessage(backend: VideoBackendType): string {
  return `官方虚拟人脸库只适用于火山方舟视频模型。当前视频后端是${getVideoBackendDisplayName(backend)}，请在 Step5 视频参数中切换为火山方舟后再生成。`;
}
