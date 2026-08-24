// ============================================================
// Step5: 浏览器通知 Hook
// 视频生成完成时发送浏览器 Notification
// ============================================================

import { useEffect, useRef, useCallback } from 'react';
import { isStoryboardPromptReady } from '@/lib/storyboardReadiness';
import type { StoryboardState } from '@/types';

export function useVideoNotification(allStoryboards: StoryboardState[]) {
  const prevDoneCountRef = useRef(0);
  const notifiedRef = useRef<Set<number>>(new Set());

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }, []);

  useEffect(() => {
    const newDoneCount = allStoryboards.filter((sb) => sb.videoStatus === 'done').length;

    if (newDoneCount > prevDoneCountRef.current && prevDoneCountRef.current > 0) {
      for (let i = 0; i < allStoryboards.length; i++) {
        const sb = allStoryboards[i];
        if (sb.videoStatus === 'done' && !notifiedRef.current.has(i)) {
          notifiedRef.current.add(i);
        }
      }

      const newlyDone = newDoneCount - prevDoneCountRef.current;
      if (newlyDone > 0 && 'Notification' in window && Notification.permission === 'granted') {
        const totalDone = newDoneCount;
        const total = allStoryboards.filter(isStoryboardPromptReady).length;
        new Notification('虾客漫 - 视频生成完成', {
          body: `新完成 ${newlyDone} 个视频（共 ${totalDone}/${total}）`,
        });
      }
    }

    prevDoneCountRef.current = newDoneCount;
  }, [allStoryboards]);

  return { requestPermission };
}
