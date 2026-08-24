import type { ReasoningEffort } from '@/lib/api-client';

export interface StoryboardLlmParams {
  temperature: number;
  maxTokens: number;
  reasoningEffort?: ReasoningEffort;
}

export const STORYBOARD_DIRECTOR_BRIEF_LLM_PARAMS: StoryboardLlmParams = {
  temperature: 0.28,
  maxTokens: 1800,
  reasoningEffort: 'medium',
};

export const STORYBOARD_DIRECTOR_BRIEF_REPAIR_LLM_PARAMS: StoryboardLlmParams = {
  temperature: 0.2,
  maxTokens: 1800,
  reasoningEffort: 'medium',
};

export const STORYBOARD_BOARD_PLAN_LLM_PARAMS: StoryboardLlmParams = {
  temperature: 0.28,
  maxTokens: 5200,
  reasoningEffort: 'high',
};

export const STORYBOARD_BOARD_PLAN_REPAIR_LLM_PARAMS: StoryboardLlmParams = {
  temperature: 0.22,
  maxTokens: 5200,
  reasoningEffort: 'high',
};

export const STORYBOARD_COMPACT_BOARD_PLAN_LLM_PARAMS: StoryboardLlmParams = {
  temperature: 0.3,
  maxTokens: 5200,
  reasoningEffort: 'medium',
};

export const STORYBOARD_ACTION_DIRECTOR_LLM_PARAMS: StoryboardLlmParams = {
  temperature: 0.2,
  maxTokens: 3200,
  reasoningEffort: 'medium',
};
