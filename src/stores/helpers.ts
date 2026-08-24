// ============================================================
// Reducer 共享辅助函数 — 供主 reducer 和子 reducer 使用
// ============================================================

import type { AppState, Project, Chapter, StoryboardState } from '@/types';

/** 从 currentProjectId + chapters 找到活跃 chapter */
export function getActiveChapter(project: Project): Chapter | null {
  return project.chapters.find((c) => c.id === project.currentChapterId) ?? null;
}

/** 按项目 ID 更新项目 */
export function updateProjectById(
  state: AppState,
  projectId: string,
  updater: (project: Project) => Project,
): AppState {
  return {
    ...state,
    projects: state.projects.map((project) =>
      project.id === projectId ? updater(project) : project,
    ),
  };
}

/** 替换指定项目的指定章节 */
export function updateChapterInProject(
  project: Project,
  chapterId: string,
  updates: Partial<Chapter>,
): Project {
  return {
    ...project,
    chapters: project.chapters.map((c) =>
      c.id === chapterId ? { ...c, ...updates } : c,
    ),
  };
}

/** 按项目 ID + 章节 ID 更新指定章节 */
export function updateChapterById(
  state: AppState,
  projectId: string,
  chapterId: string,
  updates: Partial<Chapter>,
): AppState {
  return updateProjectById(state, projectId, (project) =>
    updateChapterInProject(project, chapterId, updates),
  );
}

/** 高级辅助：更新当前项目的当前章节 */
export function updateCurrentChapter(
  state: AppState,
  updates: Partial<Chapter>,
): AppState {
  if (!state.currentProjectId) return state;
  const project = state.projects.find((item) => item.id === state.currentProjectId);
  if (!project) return state;
  return updateChapterById(state, project.id, project.currentChapterId, updates);
}

/** 高级辅助：更新当前项目的当前章节的 storyboards（按 mapFn 转换） */
export function updateCurrentStoryboards(
  state: AppState,
  mapFn: (sb: StoryboardState, index: number, sbs: StoryboardState[]) => StoryboardState,
  chapterId?: string,
): AppState {
  if (chapterId) {
    return {
      ...state,
      projects: state.projects.map((project) => {
        const chapter = project.chapters.find((item) => item.id === chapterId);
        if (!chapter) return project;
        return updateChapterInProject(project, chapterId, {
          storyboards: chapter.storyboards.map(mapFn),
        });
      }),
    };
  }

  const targetChapterId = chapterId ?? (state.currentProjectId
    ? state.projects.find((p) => p.id === state.currentProjectId)?.currentChapterId
    : undefined);
  if (!targetChapterId && !chapterId) return state;
  const cid = chapterId ?? targetChapterId!;
  return {
    ...state,
    projects: state.projects.map((p) => {
      if (p.id !== state.currentProjectId) return p;
      const chapter = p.chapters.find((c) => c.id === cid);
      if (!chapter) return p;
      return updateChapterInProject(p, cid, {
        storyboards: chapter.storyboards.map(mapFn),
      });
    }),
  };
}

/** 按项目 ID + 章节 ID 更新指定章节的 storyboards（按 mapFn 转换） */
export function updateStoryboardsById(
  state: AppState,
  projectId: string,
  chapterId: string,
  mapFn: (sb: StoryboardState, index: number, sbs: StoryboardState[]) => StoryboardState,
): AppState {
  return updateProjectById(state, projectId, (project) => {
    const chapter = project.chapters.find((item) => item.id === chapterId);
    if (!chapter) return project;
    return updateChapterInProject(project, chapterId, {
      storyboards: chapter.storyboards.map(mapFn),
    });
  });
}

/** 高级辅助：更新当前项目（非章节级） */
export function updateCurrentProject(
  state: AppState,
  updater: (p: Project) => Project,
): AppState {
  if (!state.currentProjectId) return state;
  return updateProjectById(state, state.currentProjectId, updater);
}
