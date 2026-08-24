// ============================================================
// Step5: 视频自动保存副作用 hook
// 视频完成后自动保存到用户选择的本地目录
// 支持跨章节：检测所有章节的已完成视频
// ============================================================

import { useEffect, useRef } from 'react';
import { useVideoAutoSave } from '@/hooks/useVideoAutoSave';
import type { Project, AppState } from '@/types';

export function useVideoAutoSaveEffect(
  state: AppState,
  currentProject: Project | null,
) {
  const autoSave = useVideoAutoSave();
  const autoSaveRef = useRef(autoSave);
  autoSaveRef.current = autoSave;

  // 构建跨章节已完成视频的快照，用于触发自动保存
  const doneSnapshot = buildDoneSnapshot(state, currentProject?.id ?? '');

  useEffect(() => {
    if (!autoSave.enabled || !autoSave.hasDir || !autoSave.keysReady || !currentProject) return;

    const project = state.projects.find((p) => p.id === currentProject.id);
    if (!project) return;

    const projectName = project.name;

    for (const chapter of project.chapters) {
      const chapterName = chapter.title;
      const chapterId = chapter.id;

      chapter.storyboards.forEach((sb, i) => {
        if (sb.videoStatus === 'done' && (sb.videoBlobKey || sb.videoUrl) && sb.storyboard) {
          const fileName = `分镜${String(sb.storyboard.number).padStart(2, '0')}_${sb.storyboard.name ?? 'video'}`;
          const versionKey = sb.videoBlobKey ?? sb.videoCompletedAt ?? sb.videoTaskId ?? sb.videoUrl;
          const dedupeKey = `${chapterId}_${i}_${String(versionKey)}`;
          autoSaveRef.current.saveVideo(
            sb.videoUrl,
            projectName,
            chapterName,
            fileName,
            dedupeKey,
            sb.videoBlobKey,
          ).then((ok) => {
            if (!ok && import.meta.env.DEV) {
              console.warn(`[Step5] 自动保存失败: ${fileName} (${chapterName})`);
            }
          });
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneSnapshot, autoSave.dirName, autoSave.enabled, autoSave.hasDir, autoSave.keysReady, currentProject?.id, currentProject?.name]);

  return autoSave;
}

/** 构建跨章节已完成视频的快照字符串，任一章节有新完成的视频都会触发变化 */
function buildDoneSnapshot(state: AppState, projectId: string): string {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return '';
  const parts: string[] = [];
  for (const chapter of project.chapters) {
    chapter.storyboards.forEach((sb, index) => {
      if (sb.videoStatus === 'done' && (sb.videoBlobKey || sb.videoUrl)) {
        parts.push(`${chapter.id}:${index}:${sb.videoBlobKey ?? sb.videoCompletedAt ?? sb.videoTaskId ?? sb.videoUrl}`);
      }
    });
  }
  return parts.join('|');
}
