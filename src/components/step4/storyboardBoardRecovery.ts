import {
  DEFAULT_STORYBOARD_BOARD_IMAGE_SIZE,
  getStoryboardBoardVariant,
  isStoryboardBoardActionDirectorPlanFresh,
  isStoryboardBoardDirectorBriefFresh,
  isStoryboardBoardPlanFresh,
  mergeStoryboardBoardVariant,
} from '@/lib/storyboardBoardState';
import { includesAnyTextVariant } from '@/lib/mojibake';
import { failStoryboardBoardImageTiming } from './storyboardBoardTiming';
import type {
  Step4OutputMode,
  ImageSize,
  StoryboardBoardDirectorBrief,
  StoryboardBoardMode,
  StoryboardBoardPlan,
  StoryboardBoardState,
  StoryboardBoardStyle,
} from '@/types';

export interface RecoverableStoryboardBoardInput {
  boardState: StoryboardBoardState | undefined;
  mode: StoryboardBoardMode;
  boardStyle: StoryboardBoardStyle;
  generatedForOutputMode: Step4OutputMode;
  frameRatio: '9:16' | '16:9';
  layout: '3x3' | 'strip';
  plan: StoryboardBoardPlan;
  planError?: string;
  planGeneratedAt: number;
  sourceSnapshot: string;
  referenceAssetIds: string[];
  imageSize?: ImageSize;
}

export interface RecoverableStoryboardBoardPlan {
  plan: StoryboardBoardPlan;
  planError?: string;
  planGeneratedAt?: number;
}

export interface RecoverableStoryboardDirectorBrief {
  directorBrief: StoryboardBoardDirectorBrief;
  directorBriefError?: string;
  directorBriefGeneratedAt?: number;
}

export function getRecoverableStoryboardBoardPlan(
  boardState: StoryboardBoardState | undefined,
  mode: StoryboardBoardMode,
  sourceSnapshot: string,
  referenceAssetIds: string[],
): RecoverableStoryboardBoardPlan | null {
  const variant = getStoryboardBoardVariant(boardState, mode);
  if (!isStoryboardBoardPlanFresh(variant, sourceSnapshot, referenceAssetIds) || !variant?.plan) {
    return null;
  }
  return {
    plan: variant.plan,
    planError: variant.planError,
    planGeneratedAt: variant.planGeneratedAt,
  };
}

export function getRecoverableStoryboardBoardActionDirectorPlan(
  boardState: StoryboardBoardState | undefined,
  mode: StoryboardBoardMode,
  sourceSnapshot: string,
  referenceAssetIds: string[],
): RecoverableStoryboardBoardPlan | null {
  const variant = getStoryboardBoardVariant(boardState, mode);
  if (!isStoryboardBoardActionDirectorPlanFresh(variant, sourceSnapshot, referenceAssetIds) || !variant?.plan) {
    return null;
  }
  return {
    plan: variant.plan,
    planError: variant.planError,
    planGeneratedAt: variant.planGeneratedAt,
  };
}

export function getRecoverableStoryboardDirectorBrief(
  boardState: StoryboardBoardState | undefined,
  mode: StoryboardBoardMode,
  sourceSnapshot: string,
  referenceAssetIds: string[],
): RecoverableStoryboardDirectorBrief | null {
  const variant = getStoryboardBoardVariant(boardState, mode);
  if (!isStoryboardBoardDirectorBriefFresh(variant, sourceSnapshot, referenceAssetIds) || !variant?.directorBrief) {
    return null;
  }
  return {
    directorBrief: variant.directorBrief,
    directorBriefError: variant.directorBriefError,
    directorBriefGeneratedAt: variant.directorBriefGeneratedAt,
  };
}

export function buildRecoverableStoryboardBoard(input: RecoverableStoryboardBoardInput): StoryboardBoardState {
  return mergeStoryboardBoardVariant(input.boardState, input.mode, {
    status: 'idle',
    boardStyle: input.boardStyle,
    generatedForOutputMode: input.generatedForOutputMode,
    frameRatio: input.frameRatio,
    error: undefined,
    isStale: false,
    layout: input.layout,
    imageSize: input.imageSize ?? DEFAULT_STORYBOARD_BOARD_IMAGE_SIZE,
    directorBrief: input.plan.directorBrief,
    directorBriefStatus: input.plan.directorBrief ? 'done' : 'idle',
    directorBriefError: undefined,
    directorBriefGeneratedAt: input.planGeneratedAt,
    directorBriefPromptSnapshot: input.sourceSnapshot,
    directorBriefReferenceAssetIds: input.referenceAssetIds,
    plan: input.plan,
    planStatus: 'done',
    planError: input.planError,
    planGeneratedAt: input.planGeneratedAt,
    planIsStale: false,
    planPromptSnapshot: input.sourceSnapshot,
    planReferenceAssetIds: input.referenceAssetIds,
  });
}

export function markRecoverableStoryboardBoardImageFailed(
  boardState: StoryboardBoardState | undefined,
  mode: StoryboardBoardMode | undefined,
  error: string,
): StoryboardBoardState | undefined {
  if (!boardState || !mode) return undefined;
  const currentVariant = getStoryboardBoardVariant(boardState, mode);
  const isTimeout = /timeout|timed out|超过|未返回|没有收到模型输出/i.test(error)
    || includesAnyTextVariant(error, ['超时']);
  return mergeStoryboardBoardVariant(boardState, mode, {
    status: 'failed',
    error,
    isStale: false,
    planStatus: 'done',
    planIsStale: false,
    generationTiming: failStoryboardBoardImageTiming(currentVariant?.generationTiming, error, Date.now(), isTimeout),
  });
}
