import type { AppState } from '@/types';
import type { Action } from './projectStore';
import { updateChapterInProject, updateCurrentStoryboards } from './helpers';

const VIDEO_RESET_FIELDS = {
  videoBackend: undefined,
  videoProductionMode: undefined,
  videoContinuityGroupId: undefined,
  videoContinuityReason: undefined,
  videoExtendSourceIndex: undefined,
  videoExtendSourceTaskId: undefined,
  videoExtendSourceBlobKey: undefined,
  videoExtendSubmittedAsExtend: undefined,
  videoTaskId: undefined,
  videoClientTaskId: undefined,
  videoStatus: 'idle' as const,
  videoProgress: 0,
  videoProgressIsEstimated: undefined,
  videoStatusDetail: undefined,
  videoSubmittedAt: undefined,
  videoSubmitDuration: undefined,
  videoUrl: undefined,
  videoBlobKey: undefined,
  videoError: undefined,
};

export function handleVideoAction(state: AppState, action: Action): AppState | null {
  switch (action.type) {
    case 'SUBMIT_VIDEO': {
      const chapterId = action.chapterId;
      return updateCurrentStoryboards(
        state,
        (sb, index) => (
          index === action.index
            && !(sb.videoStatus === 'done' && (
              (action.taskId && action.taskId === sb.videoTaskId)
              || (action.clientTaskId && action.clientTaskId === sb.videoClientTaskId)
            ))
            ? {
                ...sb,
                videoBackend: action.backend,
                videoProductionMode: action.productionMode ?? 'normal',
                videoContinuityGroupId: action.continuityGroupId,
                videoContinuityReason: action.continuityReason,
                videoExtendSourceIndex: action.extendSourceIndex,
                videoExtendSourceTaskId: action.extendSourceTaskId,
                videoExtendSourceBlobKey: action.extendSourceBlobKey,
                videoExtendSubmittedAsExtend: action.extendSubmittedAsExtend,
                videoTaskId: action.taskId,
                videoClientTaskId: action.clientTaskId,
                videoStatus: 'submitting' as const,
                videoProgress: 0,
                videoProgressIsEstimated: false,
                videoStatusDetail: '提交中...',
                videoSubmittedAt: action.submittedAt ?? Date.now(),
                videoSubmitDuration: action.duration,
                videoError: undefined,
              }
            : sb
        ),
        chapterId,
      );
    }
    case 'UPDATE_VIDEO_PROGRESS': {
      const chapterId = action.chapterId;
      return updateCurrentStoryboards(
        state,
        (sb, index) => (
          index === action.index
            && sb.videoStatus !== 'done'
            ? {
                ...sb,
                videoStatus: action.status ?? sb.videoStatus,
                videoProgress: action.progress,
                videoProgressIsEstimated: action.progressIsEstimated,
                videoStatusDetail: action.statusDetail,
                ...(action.taskId ? { videoTaskId: action.taskId } : {}),
              }
            : sb
        ),
        chapterId,
      );
    }
    case 'SET_VIDEO_COMPLETE': {
      const chapterId = action.chapterId;
      return updateCurrentStoryboards(
        state,
        (sb, index) => (
          index === action.index
            ? {
                ...sb,
                videoStatus: 'done' as const,
                videoProgress: 100,
                videoUrl: action.videoUrl,
                videoBlobKey: action.blobKey,
                videoTaskId: action.taskId ?? sb.videoTaskId,
                videoClientTaskId: action.clientTaskId ?? sb.videoClientTaskId,
                videoBackend: action.backend ?? sb.videoBackend,
                videoSubmittedAt: action.submittedAt ?? sb.videoSubmittedAt,
                videoSubmitDuration: action.duration ?? sb.videoSubmitDuration,
                videoError: undefined,
                videoCompletedAt: action.completedAt ?? Date.now(),
              }
            : sb
        ),
        chapterId,
      );
    }
    case 'SET_VIDEO_ERROR': {
      const chapterId = action.chapterId;
      return updateCurrentStoryboards(
        state,
        (sb, index) => (
          index === action.index
            ? {
                ...sb,
                videoStatus: 'failed' as const,
                videoError: action.error,
                videoErrorDetail: action.errorDetail,
              }
            : sb
        ),
        chapterId,
      );
    }
    case 'CLEAR_VIDEO': {
      const chapterId = action.chapterId ?? state.projects.find((p) => p.id === state.currentProjectId)?.currentChapterId;
      if (!chapterId) return state;
      return updateCurrentStoryboards(
        state,
        (sb, index) => (index === action.index ? { ...sb, ...VIDEO_RESET_FIELDS } : sb),
        chapterId,
      );
    }
    case 'RESET_ERROR_VIDEOS': {
      const chapterId = action.chapterId ?? state.projects.find((p) => p.id === state.currentProjectId)?.currentChapterId;
      if (!chapterId) return state;
      return updateCurrentStoryboards(
        state,
        (sb) => (sb.videoStatus === 'failed' ? { ...sb, ...VIDEO_RESET_FIELDS } : sb),
        chapterId,
      );
    }
    case 'MARK_POLLING_VIDEOS_FAILED': {
      return {
        ...state,
        projects: state.projects.map((project) => {
          if (project.id !== action.projectId) return project;
          const chapter = project.chapters.find((item) => item.id === action.chapterId);
          if (!chapter) return project;
          return updateChapterInProject(project, action.chapterId, {
            storyboards: chapter.storyboards.map((sb) => (
              sb.videoStatus === 'polling' && sb.videoTaskId && action.taskIds.includes(sb.videoTaskId)
                ? {
                    ...sb,
                    videoStatus: 'failed' as const,
                    videoError: '页面关闭时任务仍在生成中',
                    videoErrorDetail: {
                      backend: 'unknown',
                      taskId: sb.videoTaskId,
                      rawError: '页面关闭时任务仍在生成中',
                    },
                  }
                : sb
            )),
          });
        }),
      };
    }
    case 'MARK_POLLING_AS_RESUMABLE': {
      return {
        ...state,
        projects: state.projects.map((project) => {
          if (project.id !== action.projectId) return project;
          const chapter = project.chapters.find((item) => item.id === action.chapterId);
          if (!chapter) return project;
          return updateChapterInProject(project, action.chapterId, {
            storyboards: chapter.storyboards.map((sb) => (
              sb.videoStatus === 'polling' || sb.videoStatus === 'submitting'
                ? { ...sb, videoStatus: 'idle' as const, videoProgress: 0, videoStatusDetail: undefined }
                : sb
            )),
          });
        }),
      };
    }
    default:
      return null;
  }
}
