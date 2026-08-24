import { saveBlob } from '@/lib/imageStore';
import { loadCloudBackedBlob } from '@/lib/cloudBlobResolver';
import { encodeWebpSameSize } from '@/lib/lightweightImageCompression';

export const STORYBOARD_BOARD_UPLOAD_WEBP_QUALITY = 0.92;
export const STORYBOARD_BOARD_UPLOAD_WEBP_QUALITY_LABEL = 92;

export interface StoryboardBoardCompressionResult {
  skippedNoGain: boolean;
  blobKey?: string;
  originalBytes: number;
  compressedBytes: number;
  width: number;
  height: number;
}

export async function compressStoryboardBoardForUpload(
  sourceBlobKey: string,
  projectId?: string,
): Promise<StoryboardBoardCompressionResult> {
  const sourceBlob = await loadCloudBackedBlob(sourceBlobKey, projectId);
  if (!sourceBlob) {
    throw new Error('宫格原图读取失败，请先回 Step4 重新生成宫格图。');
  }

  const result = await encodeWebpSameSize(sourceBlob, STORYBOARD_BOARD_UPLOAD_WEBP_QUALITY);
  if (result.compressedBytes >= result.originalBytes) {
    return {
      skippedNoGain: true,
      originalBytes: result.originalBytes,
      compressedBytes: result.compressedBytes,
      width: result.width,
      height: result.height,
    };
  }

  const blobKey = await saveBlob(result.blob);
  return {
    skippedNoGain: false,
    blobKey,
    originalBytes: result.originalBytes,
    compressedBytes: result.compressedBytes,
    width: result.width,
    height: result.height,
  };
}
