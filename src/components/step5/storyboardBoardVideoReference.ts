import {
  getStoryboardBoardSelectedMode,
  getStoryboardBoardVariant,
  isStoryboardBoardStaleBlocking,
} from '@/lib/storyboardBoardState';
import { normalizeFrameRatio } from '@/lib/frameRatio';
import type { StoryboardBoardMode, StoryboardState } from '@/types';
import type { StoryboardBoardReferencePackItem } from '@/types';
import { isShotPlanBoardMode, isSmartShotPlanBoardMode } from '@/components/step4/storyboardBoardMode';

export interface StoryboardBoardVideoReferenceState {
  enabled: boolean;
  available: boolean;
  required: boolean;
  selectedMode: StoryboardBoardMode;
  modeLabel: string;
  frameRatio?: '9:16' | '16:9';
  blobKey?: string;
  sourceBlobKey?: string;
  compressed?: boolean;
  lightweightBytes?: number;
  lightweightOriginalBytes?: number;
  referencePack?: StoryboardBoardReferencePackItem[];
  reason?: string;
}

export function isStoryboardDirectorMode(storyboard: StoryboardState): boolean {
  return (storyboard.generatedStep4OutputMode ?? storyboard.step4OutputMode) === 'storyboard-director';
}

function getStoredBoardFrameRatio(mode: StoryboardBoardMode, frameRatio?: string) {
  if (isShotPlanBoardMode(mode)) return '16:9';
  if (frameRatio) return normalizeFrameRatio(frameRatio);
  if (mode === 'nine-landscape') return '16:9';
  return '9:16';
}

export function getStoryboardBoardModeLabel(mode: StoryboardBoardMode, frameRatio?: string): string {
  if (mode === 'shot-plan-landscape') return `横向 15格 Shot Sheet 导演参考 ${getStoredBoardFrameRatio(mode, frameRatio)}`;
  if (isSmartShotPlanBoardMode(mode)) return `智能故事板导演参考 ${getStoredBoardFrameRatio(mode, frameRatio)}`;
  return mode === 'nine-landscape' ? '横版详细九宫格导演参考 16:9' : '竖版详细九宫格导演参考 9:16';
}

export function resolveStoryboardBoardVideoReferenceState(
  storyboard: StoryboardState,
): StoryboardBoardVideoReferenceState {
  const required = isStoryboardDirectorMode(storyboard);
  const enabled = required;
  const selectedMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
  const variant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedMode);
  const frameRatio = getStoredBoardFrameRatio(selectedMode, variant?.frameRatio);
  const modeLabel = getStoryboardBoardModeLabel(selectedMode, frameRatio);

  if (!variant?.blobKey || variant.status === 'idle') {
    return {
      enabled,
      available: false,
      required,
      selectedMode,
      modeLabel,
      frameRatio,
      reason: required ? '请先在 Step4 生成 Seedance 详细九宫格或 Shot Plan。' : '请先在 Step4 生成详细九宫格或 Shot Plan。',
    };
  }

  if (variant.status === 'generating') {
    return {
      enabled,
      available: false,
      required,
      selectedMode,
      modeLabel,
      frameRatio,
      reason: '当前详细九宫格仍在生成中，请稍后再作为参考图使用。',
    };
  }

  if (variant.status === 'failed') {
    return {
      enabled,
      available: false,
      required,
      selectedMode,
      modeLabel,
      frameRatio,
      reason: '当前详细九宫格生成失败，请先重新生成。',
    };
  }

  if (isStoryboardBoardStaleBlocking(variant, storyboard.imageRefs)) {
    return {
      enabled,
      available: false,
      required,
      selectedMode,
      modeLabel,
      frameRatio,
      reason: '当前详细九宫格已失效，请先在 Step4 刷新后再作为参考图使用。',
    };
  }

  return {
    enabled,
    available: true,
    required,
    selectedMode,
    modeLabel,
    frameRatio,
    blobKey: variant.lightweightBlobKey ?? variant.blobKey,
    sourceBlobKey: variant.blobKey,
    compressed: !!variant.lightweightBlobKey,
    lightweightBytes: variant.lightweightBytes,
    lightweightOriginalBytes: variant.lightweightOriginalBytes,
    referencePack: variant.referencePack ?? [],
  };
}

export function buildStoryboardBoardReferenceInstruction(
  referenceLabel: string,
  modeLabel: string,
): string {
  return `补充镜头编排参考：${referenceLabel} 为当前分镜的 ${modeLabel}；只读整板的镜头顺序、blocking、机位节奏、对白/SFX/AUDIO、转场和首尾连续；Step3 参考图锁身份、空间和道具设计；成片不保留故事板边框、编号、箭头、信息条或文字。`;
}

function buildDetailedStoryboardBoardReferenceInstruction(
  referenceLabel: string,
  modeLabel: string,
): string {
  return buildStoryboardBoardReferenceInstruction(referenceLabel, modeLabel);
}

export function buildEffectiveVideoPrompt(
  rawPrompt: string,
  options: {
    includeStoryboardBoardReference: boolean;
    storyboardBoardAvailable: boolean;
    storyboardBoardReferenceLabel: string;
    storyboardBoardModeLabel: string;
  },
): string {
  if (!options.includeStoryboardBoardReference || !options.storyboardBoardAvailable) {
    return rawPrompt;
  }

  const instruction = buildDetailedStoryboardBoardReferenceInstruction(
    options.storyboardBoardReferenceLabel,
    options.storyboardBoardModeLabel,
  );

  return `${rawPrompt}\n\n${instruction}`;
}
