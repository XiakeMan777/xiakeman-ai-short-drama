import type { ScriptAnalysis } from '@/types';
export { validateAnalysisBeforeConfirm } from '@/lib/analysisValidation';

export function removeCharacterFromAnalysis(analysis: ScriptAnalysis, deletedName: string) {
  const chars = analysis.allCharacterNames.filter((name) => name !== deletedName);
  const scenes = analysis.scenes.map((scene) => ({
    ...scene,
    characters: scene.characters.filter((character) => character !== deletedName),
  }));
  const storyboards = analysis.storyboards.map((storyboard) => ({
    ...storyboard,
    characters: storyboard.characters.filter((character) => character !== deletedName),
  }));
  const outfitTracking = analysis.outfitTracking.filter(
    (outfit) => outfit.characterName !== deletedName,
  );
  const propTracking = analysis.propTracking.map((prop) =>
    prop.holder === deletedName
      ? { ...prop, holder: '无' }
      : prop,
  );

  return {
    ...analysis,
    allCharacterNames: chars,
    scenes,
    storyboards,
    outfitTracking,
    propTracking,
  };
}
