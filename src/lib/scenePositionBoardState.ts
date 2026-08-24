import type { ScenePositionBoardState } from '@/types';
import { getSceneSpatialMasterViewKey, SCENE_SPATIAL_MASTER_SCHEMA_VERSION } from '@/lib/sceneSpatialMasterState';
import { normalizeFrameRatio } from '@/lib/frameRatio';

export function normalizeScenePositionBoardState(
  board: ScenePositionBoardState | undefined,
  sceneName?: string,
): ScenePositionBoardState | undefined {
  if (!board) return undefined;
  const schemaVersion = board.schemaVersion ?? 1;
  return {
    ...board,
    status: board.status ?? (board.markedBlobKey ? 'done' : 'idle'),
    schemaVersion,
    frameRatio: normalizeFrameRatio(board.frameRatio),
    points: board.points ?? [],
    referenceAssetIds: board.referenceAssetIds ?? [],
    sceneMasterView: board.sceneMasterView ?? 'primary',
    sceneMasterKey: board.sceneMasterKey ?? (board.cleanBlobKey ? getSceneSpatialMasterViewKey(sceneName, board.sceneMasterView ?? 'primary') : undefined),
    isStale: schemaVersion < SCENE_SPATIAL_MASTER_SCHEMA_VERSION ? true : (board.isStale ?? false),
  };
}

export function markScenePositionBoardStale(
  board: ScenePositionBoardState | undefined,
): ScenePositionBoardState | undefined {
  const normalized = normalizeScenePositionBoardState(board);
  if (!normalized) return undefined;
  return {
    ...normalized,
    isStale: true,
  };
}

export function scenePositionBoardUsesAsset(
  board: ScenePositionBoardState | undefined,
  assetId: string,
): boolean {
  const normalized = normalizeScenePositionBoardState(board);
  if (!normalized) return false;
  if (normalized.sourceSceneAssetId === assetId) return true;
  return (normalized.referenceAssetIds ?? []).includes(assetId);
}

export function isScenePositionBoardReady(
  board: ScenePositionBoardState | undefined,
): boolean {
  const normalized = normalizeScenePositionBoardState(board);
  return !!normalized?.markedBlobKey && normalized.status === 'done' && !normalized.isStale;
}
