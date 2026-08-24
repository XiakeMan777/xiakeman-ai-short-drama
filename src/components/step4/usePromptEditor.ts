// ============================================================
// Step4: 提示词编辑 hook
// 封装编辑/保存/取消提示词的状态机
// ============================================================

import { useState, useCallback } from 'react';
import { useCurrentProject } from '@/stores/projectStore';
import { runSelfCheck } from '@/lib/self-check';
import { parsePromptFromRawText, extractLastFrameInfo } from './storyboardPromptParsing';
import type { StoryboardState } from '@/types';
import { markStoryboardBoardStale } from '@/lib/storyboardBoardState';

export function usePromptEditor(
  currentSb: StoryboardState,
  currentIndex: number,
) {
  const { state, dispatch } = useCurrentProject();
  const prompt = currentSb.prompt;
  const promptRawText = prompt?.rawText ?? '';
  const imageRefs = currentSb.imageRefs;
  const correctedScript = currentSb.correctedScript;
  const continuityInput = currentSb.continuityInput;
  const continuityOutput = currentSb.continuityOutput;
  const storyboardBoard = currentSb.storyboardBoard;

  const [editingStoryboardIndex, setEditingStoryboardIndex] = useState<number | null>(null);
  const [editedPromptText, setEditedPromptText] = useState('');
  const isEditingPrompt = editingStoryboardIndex === currentIndex;

  const startEditPrompt = useCallback(() => {
    setEditedPromptText(promptRawText);
    setEditingStoryboardIndex(currentIndex);
  }, [currentIndex, promptRawText]);

  const cancelEditPrompt = useCallback(() => {
    setEditingStoryboardIndex(null);
    setEditedPromptText('');
  }, []);

  const saveEditPrompt = useCallback(() => {
    if (!prompt || editingStoryboardIndex !== currentIndex) return;
    dispatch({ type: 'HISTORY_PUSH' });
    const parsedPrompt = parsePromptFromRawText(editedPromptText);
    const selfCheckResult = runSelfCheck(
      editedPromptText,
      imageRefs,
      currentSb.videoImageBudget,
      undefined,
      false,
      state.videoApiConfig.videoRatio,
    );
    const lastFrameInfo = extractLastFrameInfo(editedPromptText, correctedScript);
    const itemTracker = continuityOutput?.itemTracker ?? continuityInput?.itemTracker ?? {};
    dispatch({
      type: 'UPDATE_STORYBOARD',
      index: currentIndex,
      updates: {
        prompt: {
          ...prompt,
          ...parsedPrompt,
          rawText: editedPromptText,
        },
        selfCheckResult,
        lastFrameInfo,
        spatialBlocking: continuityOutput?.spatialBlocking ?? continuityInput?.spatialBlocking,
        continuityOutput: {
          itemTracker,
          lastFrameInfo,
          spatialBlocking: continuityOutput?.spatialBlocking ?? continuityInput?.spatialBlocking,
          summary: [parsedPrompt.scene?.slice(0, 60), parsedPrompt.characters?.slice(0, 60), correctedScript?.slice(0, 120), lastFrameInfo?.slice(0, 120)]
            .filter(Boolean)
            .join(' | '),
          sourceStoryboardIndex: currentIndex,
          generatedAt: Date.now(),
        },
        isStale: false,
        status: 'done',
        error: undefined,
        storyboardBoard: markStoryboardBoardStale(storyboardBoard, 'source-change'),
      },
    });
    setEditingStoryboardIndex(null);
  }, [currentSb.videoImageBudget, prompt, imageRefs, correctedScript, continuityInput, continuityOutput, storyboardBoard, currentIndex, editedPromptText, dispatch, editingStoryboardIndex, state.videoApiConfig.videoRatio]);

  return {
    isEditingPrompt,
    editedPromptText,
    setEditedPromptText,
    startEditPrompt,
    cancelEditPrompt,
    saveEditPrompt,
  };
}
