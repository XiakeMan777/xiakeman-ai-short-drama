import type { ImageReference, StoryboardState } from '@/types';

export function getStoryboardVideoImageRefs(storyboard: StoryboardState | undefined): ImageReference[] {
  if (!storyboard) return [];
  return storyboard.videoImageRefs ?? storyboard.imageRefs ?? [];
}

