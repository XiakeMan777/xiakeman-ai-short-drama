import type { StoryboardBoardMode } from '@/types';

export type FrameRatio = '9:16' | '16:9';
export type FrameAspectRatio = 'PORTRAIT' | 'LANDSCAPE';

export function normalizeFrameRatio(value: string | undefined | null): FrameRatio {
  return value === '16:9' ? '16:9' : '9:16';
}

export function getFrameAspectRatio(value: string | undefined | null): FrameAspectRatio {
  return normalizeFrameRatio(value) === '16:9' ? 'LANDSCAPE' : 'PORTRAIT';
}

export function getFramePromptLabel(value: string | undefined | null): string {
  return normalizeFrameRatio(value) === '16:9' ? '横屏16:9画幅' : '竖屏9:16画幅';
}

export function getFrameDisplayLabel(value: string | undefined | null): string {
  return normalizeFrameRatio(value) === '16:9' ? '横屏 16:9' : '竖屏 9:16';
}

export function getStoryboardBoardModeForFrameRatio(value: string | undefined | null): StoryboardBoardMode {
  return normalizeFrameRatio(value) === '16:9' ? 'nine-landscape' : 'nine-portrait';
}
