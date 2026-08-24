import { useEffect, useRef, useState } from 'react';
import { loadCloudBackedBlob } from '@/lib/cloudBlobResolver';
import type { Asset } from '@/types';

export function useAssetThumbnail(
  asset: Pick<Asset, 'blobKey' | 'thumbnailUrl'> | null | undefined,
  localBlobUrl?: string,
  projectId?: string,
) {
  const blobKey = asset?.blobKey;
  const thumbnailUrl = asset?.thumbnailUrl?.startsWith('blob:') ? undefined : asset?.thumbnailUrl;
  const [blobPreview, setBlobPreview] = useState<{ blobKey: string; url: string } | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!blobKey || localBlobUrl || thumbnailUrl) {
      let cancelled = false;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      queueMicrotask(() => {
        if (!cancelled) setBlobPreview(null);
      });
      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;
    loadCloudBackedBlob(blobKey, projectId).then(async (blob) => {
      if (!blob || cancelled) return;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      setBlobPreview({ blobKey, url });
    }).catch(() => null);

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [blobKey, localBlobUrl, thumbnailUrl, projectId]);

  return localBlobUrl ?? thumbnailUrl ?? (blobKey && blobPreview?.blobKey === blobKey ? blobPreview.url : null);
}
