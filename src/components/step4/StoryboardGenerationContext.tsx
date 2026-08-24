import { createContext, useContext, type ReactNode } from 'react';
import {
  useStoryboardGeneration,
  type StoryboardGenerationRuntime,
} from './useStoryboardGeneration';

const StoryboardGenerationContext = createContext<StoryboardGenerationRuntime | null>(null);

export function Step4TaskProvider({ children }: { children: ReactNode }) {
  const runtime = useStoryboardGeneration();
  return (
    <StoryboardGenerationContext.Provider value={runtime}>
      {children}
    </StoryboardGenerationContext.Provider>
  );
}

export const StoryboardGenerationProvider = Step4TaskProvider;

export function useStoryboardGenerationRuntime() {
  const runtime = useContext(StoryboardGenerationContext);
  if (!runtime) {
    throw new Error('useStoryboardGenerationRuntime must be used within Step4TaskProvider');
  }
  return runtime;
}
