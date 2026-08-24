// ============================================================
// Step4: 分镜导航 hook
// 封装搜索、重命名、前后导航逻辑
// ============================================================

import { useState, useMemo, useCallback } from 'react';
import { useCurrentProject } from '@/stores/projectStore';
import { sanitizeStoryboardCharacters } from '@/lib/storyboardCharacterSanitizer';
import type { StoryboardState } from '@/types';

export function useStoryboardNavigation(
  allStoryboards: StoryboardState[],
  currentIndex: number,
  total: number,
  resetApi?: () => void,
) {
  const { dispatch } = useCurrentProject();

  // 搜索
  const [searchQuery, setSearchQuery] = useState('');
  const filteredIndices = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    return allStoryboards
      .map((sb, i) => ({ sb, i }))
      .filter(({ sb }) =>
        sb.storyboard.name.toLowerCase().includes(q) ||
        String(sb.storyboard.number).includes(q) ||
        sanitizeStoryboardCharacters(sb.storyboard.characters).some((c) => c.toLowerCase().includes(q)),
      )
      .map(({ i }) => i);
  }, [searchQuery, allStoryboards]);

  // 重命名
  const [renamingStoryboardIndex, setRenamingStoryboardIndex] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const isRenaming = renamingStoryboardIndex === currentIndex;
  const setIsRenaming = useCallback((value: boolean) => {
    setRenamingStoryboardIndex(value ? currentIndex : null);
    if (!value) setRenameValue('');
  }, [currentIndex]);

  const currentStoryboardName = allStoryboards[currentIndex]?.storyboard.name ?? '';

  const startRename = useCallback(() => {
    setRenameValue(currentStoryboardName);
    setRenamingStoryboardIndex(currentIndex);
  }, [currentIndex, currentStoryboardName]);

  const saveRename = useCallback(() => {
    if (renamingStoryboardIndex !== currentIndex) return;
    if (!renameValue.trim()) { setIsRenaming(false); return; }
    dispatch({ type: 'HISTORY_PUSH' });
    dispatch({ type: 'RENAME_STORYBOARD', index: currentIndex, name: renameValue.trim() });
    dispatch({ type: 'MARK_DOWNSTREAM_STALE', index: currentIndex });
    setIsRenaming(false);
  }, [renameValue, currentIndex, dispatch, renamingStoryboardIndex, setIsRenaming]);

  // 导航
  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      dispatch({ type: 'SET_CURRENT_STORYBOARD_INDEX', index: currentIndex - 1 });
      resetApi?.();
    }
  }, [currentIndex, dispatch, resetApi]);

  const goNext = useCallback(() => {
    if (currentIndex < total - 1) {
      dispatch({ type: 'SET_CURRENT_STORYBOARD_INDEX', index: currentIndex + 1 });
      resetApi?.();
    }
  }, [currentIndex, total, dispatch, resetApi]);

  const goToIndex = useCallback((i: number) => {
    dispatch({ type: 'SET_CURRENT_STORYBOARD_INDEX', index: i });
    resetApi?.();
    setSearchQuery('');
  }, [dispatch, resetApi]);

  // 搜索结果键盘导航
  const goToNextMatch = useCallback(() => {
    if (!filteredIndices || filteredIndices.length === 0) return;
    const curPos = filteredIndices.indexOf(currentIndex);
    const nextIdx = curPos >= 0 && curPos < filteredIndices.length - 1
      ? filteredIndices[curPos + 1]
      : filteredIndices[0];
    dispatch({ type: 'SET_CURRENT_STORYBOARD_INDEX', index: nextIdx });
    resetApi?.();
  }, [filteredIndices, currentIndex, dispatch, resetApi]);

  const goToPrevMatch = useCallback(() => {
    if (!filteredIndices || filteredIndices.length === 0) return;
    const curPos = filteredIndices.indexOf(currentIndex);
    const prevIdx = curPos > 0
      ? filteredIndices[curPos - 1]
      : filteredIndices[filteredIndices.length - 1];
    dispatch({ type: 'SET_CURRENT_STORYBOARD_INDEX', index: prevIdx });
    resetApi?.();
  }, [filteredIndices, currentIndex, dispatch, resetApi]);

  return {
    searchQuery,
    setSearchQuery,
    filteredIndices,
    isRenaming,
    setIsRenaming,
    renameValue,
    setRenameValue,
    startRename,
    saveRename,
    goPrev,
    goNext,
    goToIndex,
    goToNextMatch,
    goToPrevMatch,
  };
}
