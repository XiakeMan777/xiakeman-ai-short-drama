import type { SceneSpatialMasterState, SceneSpatialMasterView, StoryboardState } from '@/types';
import { normalizeFrameRatio } from '@/lib/frameRatio';

const VIEW_LABELS: Record<SceneSpatialMasterView, string> = {
  primary: '主视角',
  reverse: '反打视角',
  side: '侧面视角',
};

export const SCENE_SPATIAL_MASTER_SCHEMA_VERSION = 3;

export function getSceneSpatialMasterKey(sceneName: string | undefined): string {
  const normalized = (sceneName ?? '').trim().replace(/\s+/g, ' ');
  return normalized || '当前场景';
}

export function getSceneSpatialMasterViewLabel(view: SceneSpatialMasterView | undefined): string {
  return VIEW_LABELS[view ?? 'primary'];
}

export function getSceneSpatialMasterViewKey(
  sceneName: string | undefined,
  view: SceneSpatialMasterView | undefined = 'primary',
): string {
  const sceneKey = getSceneSpatialMasterKey(sceneName);
  return view === 'primary' ? sceneKey : `${sceneKey}::${view}`;
}

export function getSceneSpatialMaster(
  masters: Record<string, SceneSpatialMasterState> | undefined,
  sceneName: string | undefined,
  view: SceneSpatialMasterView | undefined = 'primary',
): SceneSpatialMasterState | undefined {
  return masters?.[getSceneSpatialMasterViewKey(sceneName, view)];
}

export function normalizeSceneSpatialMasters(
  masters: Record<string, Partial<SceneSpatialMasterState>> | undefined,
): Record<string, SceneSpatialMasterState> {
  if (!masters) return {};
  return Object.fromEntries(
    Object.entries(masters).map(([key, master]) => {
      const sceneName = master.sceneName ?? key;
      const view = master.view ?? (key.endsWith('::reverse') ? 'reverse' : key.endsWith('::side') ? 'side' : 'primary');
      const schemaVersion = master.schemaVersion ?? 1;
      return [
        getSceneSpatialMasterViewKey(sceneName, view),
        {
          status: master.status ?? (master.cleanBlobKey ? 'done' : 'idle'),
          schemaVersion,
          frameRatio: normalizeFrameRatio(master.frameRatio),
          sceneName,
          view,
          cleanBlobKey: master.cleanBlobKey,
          sourceSceneAssetId: master.sourceSceneAssetId,
          promptSnapshot: master.promptSnapshot,
          referenceAssetIds: master.referenceAssetIds ?? [],
          generatedAt: master.generatedAt,
          error: master.error,
          warning: master.warning,
          isStale: schemaVersion < SCENE_SPATIAL_MASTER_SCHEMA_VERSION ? true : (master.isStale ?? false),
          usedFallbackCrop: master.usedFallbackCrop,
        },
      ];
    }),
  );
}

function collectCameraText(storyboard: StoryboardState): string {
  return [
    storyboard.storyboard.shotSize,
    storyboard.choreography?.cameraOverview,
    storyboard.choreography?.cameraAxis,
    storyboard.choreography?.startBlocking?.cameraAxis,
    storyboard.choreography?.endBlocking?.cameraAxis,
    storyboard.prompt?.cameraOverview,
    storyboard.prompt?.rawText,
  ].filter(Boolean).join('\n');
}

export function inferSceneSpatialMasterView(storyboard: StoryboardState): SceneSpatialMasterView {
  const text = collectCameraText(storyboard);
  if (/反打|对打|回看|回望|背面|背后|身后|对向|对面|180度|180°|轴线另一侧/.test(text)) return 'reverse';
  if (/侧面|侧拍|侧脸|侧身|横移|平移|侧向|左侧|右侧|侧后|侧前/.test(text)) return 'side';
  return 'primary';
}

export function isSceneSpatialMasterReady(
  master: SceneSpatialMasterState | undefined,
  sourceSceneAssetId?: string,
  frameRatio?: string,
): master is SceneSpatialMasterState & { cleanBlobKey: string } {
  const targetFrameRatio = normalizeFrameRatio(frameRatio);
  return !!master?.cleanBlobKey
    && master.status === 'done'
    && master.schemaVersion === SCENE_SPATIAL_MASTER_SCHEMA_VERSION
    && normalizeFrameRatio(master.frameRatio) === targetFrameRatio
    && !master.isStale
    && (!sourceSceneAssetId || master.sourceSceneAssetId === sourceSceneAssetId);
}

export function markSceneSpatialMasterStale(
  master: SceneSpatialMasterState | undefined,
): SceneSpatialMasterState | undefined {
  if (!master) return undefined;
  return {
    ...master,
    isStale: true,
  };
}

export function markSceneSpatialMastersUsingAssetStale(
  masters: Record<string, SceneSpatialMasterState> | undefined,
  assetId: string,
): Record<string, SceneSpatialMasterState> {
  if (!masters) return {};
  let changed = false;
  const nextMasters = Object.fromEntries(
    Object.entries(masters).map(([key, master]) => {
      const usesAsset = master.sourceSceneAssetId === assetId || (master.referenceAssetIds ?? []).includes(assetId);
      if (!usesAsset) return [key, master];
      changed = true;
      return [key, markSceneSpatialMasterStale(master)!];
    }),
  );
  return changed ? nextMasters : masters;
}

export function sceneSpatialMastersUseAsset(
  masters: Record<string, SceneSpatialMasterState> | undefined,
  assetId: string,
): boolean {
  return Object.values(masters ?? {}).some((master) =>
    master.sourceSceneAssetId === assetId || (master.referenceAssetIds ?? []).includes(assetId),
  );
}
