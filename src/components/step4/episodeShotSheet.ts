import type { EpisodeShotSheetSegment, EpisodeShotSheetState, StoryboardState } from '@/types';

const DEFAULT_FUNCTIONS = [
  'Hook / establish the immediate visual problem',
  'Setup / lock the scene and active characters',
  'Escalation / push the action or emotion forward',
  'Complication / introduce a reversal or pressure point',
  'Breakpoint / land the strongest action or emotional beat',
  'Consequence / leave a clear handoff to the next segment',
];

function compact(value: string | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function buildEpisodeShotSheet(storyboards: readonly StoryboardState[]): EpisodeShotSheetState {
  return {
    updatedAt: Date.now(),
    segments: storyboards.map((storyboard, index): EpisodeShotSheetSegment => {
      const fallbackFunction = DEFAULT_FUNCTIONS[Math.min(index, DEFAULT_FUNCTIONS.length - 1)]
        ?? 'Segment beat / advance the current episode';
      return {
        storyboardIndex: index,
        storyFunction: compact(storyboard.sceneBlueprint?.emotionArc)
          || compact(storyboard.choreography?.sceneType)
          || fallbackFunction,
        continuityIn: compact(storyboard.continuityInput?.lastFrameInfo)
          || compact(storyboard.continuityInput?.summary)
          || compact(storyboard.storyboard.scene)
          || 'Start from the previous segment state.',
        continuityOut: compact(storyboard.lastFrameInfo)
          || compact(storyboard.continuityOutput?.lastFrameInfo)
          || compact(storyboard.spatialBlocking?.continuityNotes)
          || 'End with a clear next-segment handoff.',
        characterState: compact(storyboard.storyboard.characters?.join('、'))
          || 'Keep active character state continuous.',
      };
    }),
  };
}

export function getEpisodeShotSheetSegment(
  sheet: EpisodeShotSheetState | undefined,
  storyboardIndex: number,
): EpisodeShotSheetSegment | undefined {
  return sheet?.segments.find((segment) => segment.storyboardIndex === storyboardIndex);
}
