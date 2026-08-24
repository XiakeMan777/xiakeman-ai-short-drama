import type { Asset } from '@/types';
import type { AssetItem } from './assetUtils';

type SourceAssetLike = Pick<Asset, 'id' | 'name' | 'blobKey' | 'source'>;

export function resolveImg2ImgSourceAsset(
  item: Pick<AssetItem, 'generationMode' | 'baseAssetId'>,
  sourceAssets: readonly SourceAssetLike[],
) {
  if (item.generationMode !== 'img2img') return undefined;
  if (!item.baseAssetId) {
    throw new Error('当前槽位需要参考源图，请先生成并绑定上一张基础图后再重试。');
  }

  const sourceAsset = sourceAssets.find((asset) => asset.id === item.baseAssetId);
  if (!sourceAsset) {
    throw new Error('参考源图不存在或已被移除，请重新生成上一张基础图后再重试。');
  }
  if (sourceAsset.source === 'volc_virtual_human') {
    throw new Error('官方虚拟人像只能作为视频身份参考，不能作为图生图源图。请生成无脸服装图或上传本地服装参考。');
  }

  return sourceAsset;
}

export function requireImg2ImgSourceBlob(
  sourceAsset: Pick<Asset, 'name'>,
  blob: Blob | null | undefined,
) {
  if (!blob) {
    throw new Error(`参考源图“${sourceAsset.name}”已失效，请重新生成或重新上传后再试。`);
  }
  return blob;
}
