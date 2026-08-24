import { loadBlob } from '@/lib/imageStore';
import { downloadValidatedVideoBlob, validateVideoBlob } from '@/lib/videoBlobUtils';

export function sanitizeVideoFileName(name: string): string {
  if (!name) return 'untitled';
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

export async function resolveCachedVideoBlob(videoBlobKey?: string): Promise<Blob | null> {
  if (videoBlobKey) {
    const blob = await loadBlob(videoBlobKey);
    if (blob) {
      const validation = await validateVideoBlob(blob);
      if (validation.valid) return blob;
    }
  }

  return null;
}

export async function resolveVideoBlob(videoUrl?: string, videoBlobKey?: string): Promise<Blob | null> {
  const cachedBlob = await resolveCachedVideoBlob(videoBlobKey);
  if (cachedBlob) return cachedBlob;

  if (!videoUrl) return null;

  const result = await downloadValidatedVideoBlob(videoUrl, { proxyFallback: true });
  return result.blob;
}

export async function writeBlobToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  fileNameWithoutExt: string,
  blob: Blob,
): Promise<void> {
  const fileHandle = await dirHandle.getFileHandle(`${sanitizeVideoFileName(fileNameWithoutExt)}.mp4`, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}
