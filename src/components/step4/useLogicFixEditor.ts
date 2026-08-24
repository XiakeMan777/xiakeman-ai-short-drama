// ============================================================
// Step4: 逻辑修正记录编辑 hook
// 封装编辑/保存/删除/新增修正记录的状态机
// ============================================================

import { useState, useCallback } from 'react';
import { useCurrentProject } from '@/stores/projectStore';
import type { StoryboardState } from '@/types';
import { markStoryboardBoardStale } from '@/lib/storyboardBoardState';

export function useLogicFixEditor(
  currentSb: StoryboardState,
  currentIndex: number,
  confirm: (message: string, title?: string) => Promise<boolean>,
) {
  const { dispatch } = useCurrentProject();

  const buildStaleUpdates = useCallback((logicFixes: StoryboardState['logicFixes']) => ({
    logicFixes,
    isStale: !!(currentSb.prompt || currentSb.correctedScript || currentSb.choreography || currentSb.sceneBlueprint || currentSb.lastFrameInfo),
    storyboardBoard: markStoryboardBoardStale(currentSb.storyboardBoard, 'source-change'),
  }), [currentSb.choreography, currentSb.correctedScript, currentSb.lastFrameInfo, currentSb.prompt, currentSb.sceneBlueprint, currentSb.storyboardBoard]);

  const [editingStoryboardIndex, setEditingStoryboardIndex] = useState<number | null>(null);
  const [editFixIdxState, setEditFixIdx] = useState<number | null>(null);
  const [editFixForm, setEditFixForm] = useState({ originalIssue: '', correction: '', reason: '' });
  const editFixIdx = editingStoryboardIndex === currentIndex ? editFixIdxState : null;

  const startEditFix = useCallback((i: number) => {
    const fix = currentSb.logicFixes[i];
    setEditingStoryboardIndex(currentIndex);
    setEditFixIdx(i);
    setEditFixForm({ originalIssue: fix.originalIssue, correction: fix.correction, reason: fix.reason });
  }, [currentIndex, currentSb.logicFixes]);

  const saveEditFix = useCallback(() => {
    if (editingStoryboardIndex !== currentIndex || editFixIdx === null) return;
    dispatch({ type: 'HISTORY_PUSH' });
    const newFixes = currentSb.logicFixes.map((f, i) =>
      i === editFixIdx ? { ...f, ...editFixForm } : f,
    );
    dispatch({ type: 'UPDATE_STORYBOARD', index: currentIndex, updates: buildStaleUpdates(newFixes) });
    dispatch({ type: 'MARK_DOWNSTREAM_STALE', index: currentIndex });
    setEditingStoryboardIndex(null);
    setEditFixIdx(null);
  }, [buildStaleUpdates, currentIndex, currentSb.logicFixes, dispatch, editFixForm, editFixIdx, editingStoryboardIndex]);

  const deleteFix = useCallback(async (i: number) => {
    if (!(await confirm('确定删除这条修正记录？'))) return;
    dispatch({ type: 'HISTORY_PUSH' });
    const newFixes = currentSb.logicFixes.filter((_, idx) => idx !== i);
    dispatch({ type: 'UPDATE_STORYBOARD', index: currentIndex, updates: buildStaleUpdates(newFixes) });
    dispatch({ type: 'MARK_DOWNSTREAM_STALE', index: currentIndex });
  }, [buildStaleUpdates, currentSb.logicFixes, currentIndex, dispatch, confirm]);

  const addFix = useCallback(() => {
    dispatch({ type: 'HISTORY_PUSH' });
    const newFixes = [
      ...currentSb.logicFixes,
      { originalIssue: '新矛盾', correction: '修正为...', reason: '...' },
    ];
    dispatch({ type: 'UPDATE_STORYBOARD', index: currentIndex, updates: buildStaleUpdates(newFixes) });
    dispatch({ type: 'MARK_DOWNSTREAM_STALE', index: currentIndex });
  }, [buildStaleUpdates, currentSb.logicFixes, currentIndex, dispatch]);

  const cancelEditFix = useCallback(() => {
    setEditingStoryboardIndex(null);
    setEditFixIdx(null);
  }, []);

  return {
    editFixIdx,
    editFixForm,
    setEditFixForm,
    startEditFix,
    saveEditFix,
    cancelEditFix,
    deleteFix,
    addFix,
  };
}
