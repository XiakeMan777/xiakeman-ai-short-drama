export interface WebpSameSizeCompressionResult {
  blob: Blob;
  originalBytes: number;
  compressedBytes: number;
  width: number;
  height: number;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export async function encodeWebpSameSize(blob: Blob, quality = 0.95): Promise<WebpSameSizeCompressionResult> {
  if (!canUseCanvasReencode()) {
    throw new Error('当前浏览器不支持本地图片重编码');
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器不支持 Canvas 图片处理');

    ctx.drawImage(bitmap, 0, 0);
    const compressedBlob = await canvasToBlob(canvas, 'image/webp', quality);
    if (compressedBlob.size <= 0) throw new Error('WebP 编码结果为空');

    return {
      blob: compressedBlob,
      originalBytes: blob.size,
      compressedBytes: compressedBlob.size,
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap?.close();
  }
}

function canUseCanvasReencode() {
  return typeof document !== 'undefined'
    && typeof document.createElement === 'function'
    && typeof createImageBitmap === 'function';
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('图片无损压缩失败'));
    }, type, quality);
  });
}
