import type { Asset } from '@/types';
import { loadCloudBackedBlob } from '@/lib/cloudBlobResolver';

type AssetImageVariantFields = Pick<Asset, 'blobKey' | 'lightweightBlobKey'>;

export function getPreferredAssetBlobKey(asset: AssetImageVariantFields) {
  return asset.lightweightBlobKey ?? asset.blobKey;
}

export async function loadPreferredAssetBlob(asset: AssetImageVariantFields): Promise<{
  blob: Blob | null;
  blobKey: string;
  usedLightweight: boolean;
}>;
export async function loadPreferredAssetBlob(asset: AssetImageVariantFields, projectId?: string): Promise<{
  blob: Blob | null;
  blobKey: string;
  usedLightweight: boolean;
}>;
export async function loadPreferredAssetBlob(asset: AssetImageVariantFields, projectId?: string): Promise<{
  blob: Blob | null;
  blobKey: string;
  usedLightweight: boolean;
}> {
  if (asset.lightweightBlobKey) {
    const lightweightBlob = await loadCloudBackedBlob(asset.lightweightBlobKey, projectId).catch(() => null);
    if (lightweightBlob) {
      return {
        blob: lightweightBlob,
        blobKey: asset.lightweightBlobKey,
        usedLightweight: true,
      };
    }
  }

  const originalBlob = await loadCloudBackedBlob(asset.blobKey, projectId).catch(() => null);
  return {
    blob: originalBlob,
    blobKey: asset.blobKey,
    usedLightweight: false,
  };
}
