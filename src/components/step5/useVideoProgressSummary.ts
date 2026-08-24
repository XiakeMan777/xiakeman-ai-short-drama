// ============================================================
// Step5: 视频进度统计 hook（C3: 统一模型）
// PERF3: useMemo 避免每次渲染重复 .filter()
// ============================================================

import { useMemo } from 'react';
import { isStoryboardPromptReady } from '@/lib/storyboardReadiness';
import type { StoryboardState } from '@/types';

export interface VideoProgressSummary {
  totalWithPrompt: number;   // 有提示词的分镜总数
  doneCount: number;         // 已完成
  pollingCount: number;      // 生成中
  submittingCount: number;   // 提交中
  failedCount: number;       // 失败
  pendingCount: number;      // 待生成（idle/pending/无状态）
  idleCount: number;         // 空闲
}

export function useVideoProgressSummary(allStoryboards: StoryboardState[]): VideoProgressSummary {
  return useMemo(() => {
    let totalWithPrompt = 0;
    let doneCount = 0;
    let pollingCount = 0;
    let submittingCount = 0;
    let failedCount = 0;
    let pendingCount = 0;
    let idleCount = 0;

    for (const sb of allStoryboards) {
      if (!isStoryboardPromptReady(sb)) continue;
      totalWithPrompt++;
      const s = sb.videoStatus ?? 'idle';
      switch (s) {
        case 'done': doneCount++; break;
        case 'polling': pollingCount++; break;
        case 'submitting': submittingCount++; break;
        case 'failed': failedCount++; break;
        case 'idle':
          pendingCount++;
          if (s === 'idle') idleCount++;
          break;
        default:
          pendingCount++;
          idleCount++;
          break;
      }
    }

    return { totalWithPrompt, doneCount, pollingCount, submittingCount, failedCount, pendingCount, idleCount };
  }, [allStoryboards]);
}
