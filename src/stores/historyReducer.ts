// ============================================================
// 撤销/重做 Reducer — 处理 UNDO / REDO / HISTORY_PUSH
// ============================================================

import type { AppState, Chapter } from '@/types';
import type { Action } from './projectStore';
import { updateChapterById, updateCurrentChapter } from './helpers';
import { countStoryboardStep4Ready } from '@/lib/storyboardReadiness';

type HistorySnapshot = Pick<Chapter, 'storyboards'> & Partial<Pick<Chapter, 'sceneSpatialMasters'>>;

function deriveChapterContinuityMirror(storyboards: Chapter['storyboards']) {
  for (let index = storyboards.length - 1; index >= 0; index -= 1) {
    const storyboard = storyboards[index];
    if (storyboard.isStale) continue;
    if (storyboard.continuityOutput) {
      return {
        globalLastFrameInfo: storyboard.continuityOutput.lastFrameInfo,
        itemTracker: storyboard.continuityOutput.itemTracker,
      };
    }
    if (storyboard.lastFrameInfo) {
      return {
        globalLastFrameInfo: storyboard.lastFrameInfo,
        itemTracker: {},
      };
    }
  }

  return {
    globalLastFrameInfo: '',
    itemTracker: {},
  };
}

function takeSnapshot(chapter: Chapter): HistorySnapshot {
  return {
    storyboards: chapter.storyboards,
    sceneSpatialMasters: chapter.sceneSpatialMasters,
  };
}

export function handleHistoryAction(state: AppState, action: Action): AppState | null {
  const proj = state.projects.find((p) => p.id === state.currentProjectId);
  const chapter = proj?.chapters.find((c) => c.id === proj.currentChapterId);

  switch (action.type) {
    case 'UNDO': {
      if (!chapter || chapter.past.length === 0) return state;
      const current = takeSnapshot(chapter);
      const previous = chapter.past[chapter.past.length - 1];
      const continuityMirror = deriveChapterContinuityMirror(previous.storyboards);
      const doneCount = countStoryboardStep4Ready(previous.storyboards);
      return updateCurrentChapter(state, {
        ...previous,
        ...continuityMirror,
        autoGenerate: {
          ...chapter.autoGenerate,
          running: false,
          currentIndex: -1,
          total: previous.storyboards.length,
          doneCount,
          errors: [],
          cancelled: false,
          retryNotice: undefined,
          sessionId: undefined,
          startedAt: undefined,
          stopReason: doneCount === previous.storyboards.length && doneCount > 0 ? 'completed' : undefined,
        },
        past: chapter.past.slice(0, -1),
        future: [current, ...chapter.future],
      });
    }
    case 'REDO': {
      if (!chapter || chapter.future.length === 0) return state;
      const current = takeSnapshot(chapter);
      const next = chapter.future[0];
      const continuityMirror = deriveChapterContinuityMirror(next.storyboards);
      const doneCount = countStoryboardStep4Ready(next.storyboards);
      return updateCurrentChapter(state, {
        ...next,
        ...continuityMirror,
        autoGenerate: {
          ...chapter.autoGenerate,
          running: false,
          currentIndex: -1,
          total: next.storyboards.length,
          doneCount,
          errors: [],
          cancelled: false,
          retryNotice: undefined,
          sessionId: undefined,
          startedAt: undefined,
          stopReason: doneCount === next.storyboards.length && doneCount > 0 ? 'completed' : undefined,
        },
        past: [...chapter.past, current],
        future: chapter.future.slice(1),
      });
    }
    case 'HISTORY_PUSH': {
      const targetProjectId = action.projectId ?? state.currentProjectId ?? undefined;
      const targetProject = targetProjectId
        ? state.projects.find((p) => p.id === targetProjectId)
        : undefined;
      const targetChapterId = action.chapterId ?? targetProject?.currentChapterId;
      const targetChapter = targetChapterId
        ? targetProject?.chapters.find((c) => c.id === targetChapterId)
        : undefined;
      if (!targetProject || !targetChapter) return state;
      const snapshot = takeSnapshot(targetChapter);
      const newPast = [...targetChapter.past, snapshot].slice(-20);
      return updateChapterById(state, targetProject.id, targetChapter.id, { past: newPast, future: [] });
    }
    default:
      return null;
  }
}
