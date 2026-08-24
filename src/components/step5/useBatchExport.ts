// ============================================================
// Step5: export completed videos
// Priority: IndexedDB video cache -> auto-save output folder -> videoUrl download.
// ============================================================

import { useCallback } from 'react';
import { toast } from 'sonner';
import { getAutoSavedVideoBlob, isFileSystemAccessSupported } from '@/lib/videoAutoSave';
import {
  resolveCachedVideoBlob,
  resolveVideoBlob,
  sanitizeVideoFileName,
  writeBlobToDirectory,
} from '@/lib/videoFileUtils';
import type { StoryboardState } from '@/types';

interface BatchExportContext {
  projectName?: string;
  chapterName?: string;
}

function getStoryboardVideoFileName(sb: StoryboardState): string {
  if (!sb.storyboard) return `video_${Date.now()}`;
  return `分镜${String(sb.storyboard.number).padStart(2, '0')}_${sb.storyboard.name ?? 'video'}`;
}

async function resolveExportVideoBlob(
  sb: StoryboardState,
  context: BatchExportContext,
): Promise<Blob | null> {
  const cached = await resolveCachedVideoBlob(sb.videoBlobKey);
  if (cached) return cached;

  const autoSaved = await getAutoSavedVideoBlob(
    context.projectName,
    context.chapterName,
    getStoryboardVideoFileName(sb),
  );
  if (autoSaved) return autoSaved;

  return await resolveVideoBlob(sb.videoUrl);
}

export function useBatchExport(
  allStoryboards: StoryboardState[],
  context: BatchExportContext = {},
) {
  const exportAll = useCallback(async () => {
    const doneItems = allStoryboards.filter((sb) => sb.videoStatus === 'done');

    if (doneItems.length === 0) {
      toast.warning('没有已完成的视频可导出');
      return;
    }

    let exportDirHandle: FileSystemDirectoryHandle | null = null;
    if (isFileSystemAccessSupported()) {
      try {
        exportDirHandle = await window.showDirectoryPicker?.({
          id: 'video-batch-export',
          mode: 'readwrite',
          startIn: 'videos',
        }) ?? null;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          toast.info('已取消批量导出');
          return;
        }
      }
    }

    toast.info(
      `${exportDirHandle ? '开始保存' : '开始下载'} ${doneItems.length} 个视频，缺失缓存时会自动从本地输出目录或远程链接补回。`,
    );

    let exported = 0;
    let failed = 0;

    for (const sb of doneItems) {
      try {
        const blob = await resolveExportVideoBlob(sb, context);

        if (!blob) {
          failed++;
          continue;
        }

        const fileNameWithoutExt = getStoryboardVideoFileName(sb);

        if (exportDirHandle) {
          await writeBlobToDirectory(exportDirHandle, fileNameWithoutExt, blob);
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${sanitizeVideoFileName(fileNameWithoutExt)}.mp4`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }

        exported++;

        if (exported < doneItems.length) {
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch {
        failed++;
      }
    }

    if (failed === 0) {
      toast.success(`已导出 ${exported} 个视频`);
    } else {
      toast.warning(`导出完成：${exported} 成功，${failed} 失败`);
    }
  }, [allStoryboards, context]);

  return { exportAll };
}
