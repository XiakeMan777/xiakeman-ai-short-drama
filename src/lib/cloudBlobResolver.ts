import { createCloudProjectBlobDownloadUrl } from '@/lib/cloudProjectStore';
import { loadBlob, saveBlobWithKey } from '@/lib/imageStore';

export async function loadCloudBackedBlob(
  blobKey: string | undefined,
  projectId?: string,
): Promise<Blob | null> {
  if (!blobKey || blobKey.startsWith('external:')) return null;

  const localBlob = await loadBlob(blobKey).catch(() => null);
  if (localBlob) return localBlob;
  if (!projectId) return null;

  const downloadUrl = await createCloudProjectBlobDownloadUrl(projectId, blobKey);
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text.slice(0, 240) || response.statusText || `HTTP ${response.status}`);
  }

  const blob = await response.blob();
  if (blob.size > 0) {
    await saveBlobWithKey(blobKey, blob).catch(() => undefined);
  }
  return blob;
}
