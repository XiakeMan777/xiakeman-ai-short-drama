// ============================================================
// Step5: 分镜拖拽排序 hook（F9）
// 管理拖拽状态和排序逻辑
// ============================================================

import { useState, useCallback } from 'react';
import type { StoryboardState } from '@/types';

export interface DragState {
  dragIndex: number | null;
  overIndex: number | null;
}

export function useStoryboardDragSort() {
  const [dragState, setDragState] = useState<DragState>({ dragIndex: null, overIndex: null });

  const onDragStart = useCallback((index: number) => {
    setDragState({ dragIndex: index, overIndex: null });
  }, []);

  const onDragOver = useCallback((index: number) => {
    setDragState((prev) => {
      if (prev.dragIndex === null || prev.overIndex === index) return prev;
      return { ...prev, overIndex: index };
    });
  }, []);

  const onDragEnd = useCallback(() => {
    setDragState({ dragIndex: null, overIndex: null });
  }, []);

  /**
   * 执行排序：将 fromIndex 位置的元素移到 toIndex
   * 返回新的排序数组，调用方负责 dispatch 更新 store
   */
  const reorderStoryboards = useCallback(
    (storyboards: StoryboardState[], fromIndex: number, toIndex: number): StoryboardState[] => {
      if (fromIndex === toIndex) return storyboards;
      const result = [...storyboards];
      const [moved] = result.splice(fromIndex, 1);
      result.splice(toIndex, 0, moved);
      return result;
    },
    [],
  );

  return {
    dragState,
    onDragStart,
    onDragOver,
    onDragEnd,
    reorderStoryboards,
  };
}
