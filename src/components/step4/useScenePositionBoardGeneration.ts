import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useCurrentProject } from '@/stores/projectStore';
import { deleteBlob, loadBlob, saveBlob } from '@/lib/imageStore';
import { generateImage, hasEffectiveImageApiKey } from '@/lib/imageApiClient';
import { loadPreferredAssetBlob } from '@/lib/assetImageVariants';
import type { Asset, ScenePositionBoardPoint, StoryboardState } from '@/types';
import { getFrameAspectRatio, getFrameDisplayLabel, normalizeFrameRatio } from '@/lib/frameRatio';
import {
  getSceneSpatialMaster,
  getSceneSpatialMasterKey,
  getSceneSpatialMasterViewLabel,
  getSceneSpatialMasterViewKey,
  inferSceneSpatialMasterView,
  isSceneSpatialMasterReady,
  SCENE_SPATIAL_MASTER_SCHEMA_VERSION,
} from '@/lib/sceneSpatialMasterState';
import { resolveStoryboardImageRefs } from './storyboardReferenceResolver';
import {
  applyScenePositionPointsToBlocking,
  applyScenePositionPointsToChoreography,
  SCENE_POSITION_BOARD_IMAGE_SIZE,
  buildScenePositionBoardPoints,
  buildScenePositionBoardPrompt,
  buildShortDramaLayoutForPoint,
  createScenePositionBoardCleanBlob,
  createScenePositionBoardMarkedBlob,
} from './scenePositionBoard';
import { markStoryboardBoardStale } from '@/lib/storyboardBoardState';

const SCENE_POSITION_BOARD_TIMEOUT_MS = 20 * 60 * 1000;
const EMPTY_ASSET_LIBRARY: Asset[] = [];

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  let timeoutId = 0;
  return new Promise<T>((resolve, reject) => {
    timeoutId = window.setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, timeoutMs);
    promise
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timeoutId));
  });
}

function getSceneAsset(
  storyboard: StoryboardState,
  assetLibrary: readonly Asset[] | undefined,
  analysis: Parameters<typeof resolveStoryboardImageRefs>[1],
  storyboardIndex: number,
  frameRatio?: string,
) {
  const refs = resolveStoryboardImageRefs(storyboard, analysis, assetLibrary ? [...assetLibrary] : undefined, storyboardIndex, frameRatio);
  const sceneRef = refs.find((ref) => ref.type === 'scene');
  if (!sceneRef) return { sceneRef, sceneAsset: undefined, refs };
  const targetFrameRatio = normalizeFrameRatio(frameRatio);
  const preferredConcept = targetFrameRatio === '16:9' ? 'scene_main' : 'scene_vertical';
  const fallbackConcept = targetFrameRatio === '16:9' ? 'scene_vertical' : 'scene_main';
  const sceneAsset = sceneRef.assetId
    ? assetLibrary?.find((asset) => asset.id === sceneRef.assetId)
    : assetLibrary?.find((asset) => asset.type === 'scene' && asset.name === sceneRef.name && asset.concept === preferredConcept)
      ?? assetLibrary?.find((asset) => asset.type === 'scene' && asset.name === sceneRef.name && asset.concept === fallbackConcept)
      ?? assetLibrary?.find((asset) => asset.type === 'scene' && asset.name === sceneRef.name);
  return { sceneRef, sceneAsset, refs };
}

function getAllCharacterNames(
  analysis: Parameters<typeof resolveStoryboardImageRefs>[1],
  assetLibrary: readonly Asset[] | undefined,
) {
  return [
    ...(analysis?.allCharacterNames ?? []),
    ...(analysis?.characterProfiles ?? []).map((profile) => profile.name),
    ...(assetLibrary ?? [])
      .filter((asset) => asset.type === 'character')
      .map((asset) => asset.name),
  ];
}

function downloadBlobFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function useScenePositionBoardGeneration(
  currentSb: StoryboardState,
  currentIndex: number,
) {
  const { state, dispatch, currentProject, currentChapter } = useCurrentProject();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const board = currentSb.scenePositionBoard;
  const analysis = currentChapter?.analysis ?? null;
  const assetLibrary = currentProject?.assetLibrary ?? EMPTY_ASSET_LIBRARY;
  const targetFrameRatio = useMemo(
    () => normalizeFrameRatio(state.videoApiConfig.videoRatio),
    [state.videoApiConfig.videoRatio],
  );

  const sceneContext = useMemo(
    () => getSceneAsset(currentSb, assetLibrary, analysis, currentIndex, targetFrameRatio),
    [analysis, assetLibrary, currentIndex, currentSb, targetFrameRatio],
  );

  const points = useMemo(
    () => buildScenePositionBoardPoints(currentSb, getAllCharacterNames(analysis, assetLibrary), targetFrameRatio),
    [analysis, assetLibrary, currentSb, targetFrameRatio],
  );
  const sceneMasterKey = useMemo(
    () => getSceneSpatialMasterKey(sceneContext.sceneRef?.name ?? currentSb.storyboard.scene),
    [currentSb.storyboard.scene, sceneContext.sceneRef?.name],
  );
  const sceneMasterView = useMemo(
    () => inferSceneSpatialMasterView(currentSb),
    [currentSb],
  );
  const sceneMasterViewKey = useMemo(
    () => getSceneSpatialMasterViewKey(sceneMasterKey, sceneMasterView),
    [sceneMasterKey, sceneMasterView],
  );
  const sceneMasterViewLabel = getSceneSpatialMasterViewLabel(sceneMasterView);
  const sceneMaster = useMemo(
    () => getSceneSpatialMaster(currentChapter?.sceneSpatialMasters, sceneMasterKey, sceneMasterView),
    [currentChapter?.sceneSpatialMasters, sceneMasterKey, sceneMasterView],
  );
  const freshSceneMaster = useMemo(
    () => isSceneSpatialMasterReady(sceneMaster, sceneContext.sceneAsset?.id, targetFrameRatio) ? sceneMaster : undefined,
    [sceneContext.sceneAsset?.id, sceneMaster, targetFrameRatio],
  );
  const hasFreshSceneMaster = !!freshSceneMaster;
  const freshSceneMasterCleanBlobKey = freshSceneMaster?.cleanBlobKey;

  const hasFreshBoard = useMemo(() => (
    !!board?.markedBlobKey
    && board.status === 'done'
    && !board.isStale
    && normalizeFrameRatio(board.frameRatio) === targetFrameRatio
    && board.sourceSceneAssetId === sceneContext.sceneAsset?.id
    && (!board.sceneMasterKey || board.sceneMasterKey === sceneMasterViewKey)
    && (!board.sceneMasterView || board.sceneMasterView === sceneMasterView)
    && (!board.cleanBlobKey || !hasFreshSceneMaster || board.cleanBlobKey === freshSceneMasterCleanBlobKey)
  ), [board, freshSceneMasterCleanBlobKey, hasFreshSceneMaster, sceneContext.sceneAsset?.id, sceneMasterView, sceneMasterViewKey, targetFrameRatio]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    async function loadPreview() {
      if (!board?.markedBlobKey) {
        setPreviewUrl(null);
        return;
      }
      const blob = await loadBlob(board.markedBlobKey).catch(() => null);
      if (!blob || cancelled) {
        if (!cancelled) setPreviewUrl(null);
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      if (!cancelled) setPreviewUrl(objectUrl);
    }

    void loadPreview();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [board?.markedBlobKey]);

  const commonDisabledReason = useMemo(() => {
    if (!currentSb.prompt?.rawText) return '请先生成当前分镜提示词';
    if (!currentSb.choreography && !currentSb.spatialBlocking) return '请先完成动作编排，系统需要站位信息来放置色点';
    if (!sceneContext.sceneAsset) return '请先在 Step3 绑定当前场景图';
    if (sceneContext.sceneAsset.source === 'volc_virtual_human' || sceneContext.sceneAsset.blobKey.startsWith('external:')) {
      return '当前场景图不是本地可读取图片，请先重新生成或上传本地场景图';
    }
    if (points.length === 0) return '当前分镜没有可定位的关键角色';
    return null;
  }, [currentSb.choreography, currentSb.prompt?.rawText, currentSb.spatialBlocking, points.length, sceneContext.sceneAsset]);

  const redrawMarkedBoard = useCallback(async (
    nextPoints: ScenePositionBoardPoint[],
    cleanBlobKey = board?.cleanBlobKey ?? freshSceneMaster?.cleanBlobKey,
  ) => {
    const targetProjectId = currentProject?.id;
    const targetChapterId = currentChapter?.id;
    if (!targetProjectId || !targetChapterId || !cleanBlobKey) return;
    const cleanBlob = await loadBlob(cleanBlobKey);
    if (!cleanBlob) {
      toast.error('定位图底图读取失败，请重新生成定位图');
      return;
    }
    const markedBlob = await createScenePositionBoardMarkedBlob(cleanBlob, nextPoints, targetFrameRatio);
    const markedBlobKey = await saveBlob(markedBlob);
    const oldMarkedBlobKey = board?.markedBlobKey;
    const nextChoreography = applyScenePositionPointsToChoreography(currentSb.choreography, nextPoints, targetFrameRatio);
    const sourceBlocking = currentSb.spatialBlocking
      ?? currentSb.continuityOutput?.spatialBlocking
      ?? nextChoreography?.endBlocking
      ?? nextChoreography?.startBlocking;
    const nextSpatialBlocking = applyScenePositionPointsToBlocking(sourceBlocking, nextPoints, targetFrameRatio);
    const nextContinuityOutput = currentSb.continuityOutput
      ? {
          ...currentSb.continuityOutput,
          spatialBlocking: nextSpatialBlocking ?? currentSb.continuityOutput.spatialBlocking,
          generatedAt: Date.now(),
        }
      : currentSb.continuityInput
        ? {
            itemTracker: currentSb.continuityInput.itemTracker,
            lastFrameInfo: currentSb.lastFrameInfo || currentSb.continuityInput.lastFrameInfo,
            spatialBlocking: nextSpatialBlocking,
            summary: currentSb.continuityInput.summary,
            sourceStoryboardIndex: currentIndex,
            generatedAt: Date.now(),
          }
        : undefined;
    dispatch({
      type: 'UPDATE_STORYBOARD',
      index: currentIndex,
      projectId: targetProjectId,
      chapterId: targetChapterId,
      updates: {
        scenePositionBoard: {
          ...board,
          status: 'done',
          schemaVersion: SCENE_SPATIAL_MASTER_SCHEMA_VERSION,
          frameRatio: targetFrameRatio,
          cleanBlobKey,
          markedBlobKey,
          sceneMasterKey: board?.sceneMasterKey ?? sceneMasterViewKey,
          sceneMasterView,
          sceneMasterReused: board?.sceneMasterReused ?? hasFreshSceneMaster,
          points: nextPoints,
          isStale: false,
          generatedAt: Date.now(),
        },
        choreography: nextChoreography,
        spatialBlocking: nextSpatialBlocking ?? currentSb.spatialBlocking,
        continuityOutput: nextContinuityOutput,
        isStale: !!currentSb.prompt,
        storyboardBoard: markStoryboardBoardStale(currentSb.storyboardBoard, 'source-change'),
      },
    });
    if (oldMarkedBlobKey && oldMarkedBlobKey !== markedBlobKey) {
      deleteBlob(oldMarkedBlobKey).catch(() => undefined);
    }
  }, [board, currentChapter?.id, currentIndex, currentProject?.id, currentSb, dispatch, freshSceneMaster?.cleanBlobKey, hasFreshSceneMaster, sceneMasterView, sceneMasterViewKey, targetFrameRatio]);

  const generateBoard = useCallback(async () => {
    const targetProjectId = currentProject?.id;
    const targetChapterId = currentChapter?.id;
    const sceneAsset = sceneContext.sceneAsset;
    if (!targetProjectId || !targetChapterId || !sceneAsset || commonDisabledReason) return;

    const target = { projectId: targetProjectId, chapterId: targetChapterId };
    const pointSnapshot = points;
    const promptSnapshot = buildScenePositionBoardPrompt(currentSb, sceneMasterView, targetFrameRatio);
    dispatch({
      type: 'UPDATE_STORYBOARD',
      index: currentIndex,
      ...target,
      updates: {
        scenePositionBoard: {
          ...board,
          status: 'generating',
          schemaVersion: SCENE_SPATIAL_MASTER_SCHEMA_VERSION,
          frameRatio: targetFrameRatio,
          error: undefined,
          warning: undefined,
          isStale: false,
          sourceSceneAssetId: sceneAsset.id,
          promptSnapshot: currentSb.prompt?.rawText,
          referenceAssetIds: [sceneAsset.id],
          sceneMasterKey: sceneMasterViewKey,
          sceneMasterView,
          sceneMasterReused: hasFreshSceneMaster,
          points: pointSnapshot,
        },
      },
    });

    let cleanBlob: Blob | null = null;
    let cleanBlobKey = '';
    let warning: string | undefined;
    let usedFallbackCrop = false;
    let reusedSceneMaster = false;
    const previousBoardCleanBlobKey = board?.cleanBlobKey;

    try {
      if (freshSceneMaster) {
        const masterBlob = await loadBlob(freshSceneMaster.cleanBlobKey);
        if (masterBlob) {
          cleanBlob = masterBlob;
          cleanBlobKey = freshSceneMaster.cleanBlobKey;
          warning = freshSceneMaster.warning;
          usedFallbackCrop = !!freshSceneMaster.usedFallbackCrop;
          reusedSceneMaster = true;
        } else {
          dispatch({
            type: 'UPDATE_SCENE_SPATIAL_MASTER',
            sceneKey: sceneMasterViewKey,
            ...target,
            updates: { status: 'failed', isStale: true, error: '场景母版底图读取失败，请重新生成' },
          });
        }
      }

      if (!cleanBlob) {
        dispatch({
          type: 'UPDATE_SCENE_SPATIAL_MASTER',
          sceneKey: sceneMasterViewKey,
          ...target,
          updates: {
            status: 'generating',
            schemaVersion: SCENE_SPATIAL_MASTER_SCHEMA_VERSION,
            frameRatio: targetFrameRatio,
            sceneName: sceneMasterKey,
            view: sceneMasterView,
            sourceSceneAssetId: sceneAsset.id,
            promptSnapshot,
            referenceAssetIds: [sceneAsset.id],
            error: undefined,
            warning: undefined,
            isStale: false,
          },
        });

        const sourceBlob = (await loadPreferredAssetBlob(sceneAsset)).blob;
        if (!sourceBlob) throw new Error('场景图读取失败');

        if (hasEffectiveImageApiKey(state.imageApiConfig, state.videoApiConfig)) {
          try {
            const controller = new AbortController();
            const result = await withTimeout(
              generateImage(state.imageApiConfig, {
                prompt: promptSnapshot,
                aspectRatio: getFrameAspectRatio(targetFrameRatio),
                imageSize: SCENE_POSITION_BOARD_IMAGE_SIZE,
                referenceBlobs: [sourceBlob],
                referenceLabels: [`${sceneMasterViewLabel}场景母版：只锁定空间结构、桌椅方向、灯光和关键陈设，不要画人物或标记`],
                signal: controller.signal,
                background: {
                  projectId: targetProjectId,
                  chapterId: targetChapterId,
                  storyboardIndex: currentIndex,
                  namespace: `step4-scene-position-${sceneMasterView}-${currentIndex}`,
                  requireBackend: false,
                },
              }, state.videoApiConfig),
              SCENE_POSITION_BOARD_TIMEOUT_MS,
              `${getFrameDisplayLabel(targetFrameRatio)}场景底图生成超时，已改用原场景图裁切兜底`,
              () => controller.abort(),
            );
            cleanBlob = result.blob;
          } catch (error) {
            warning = `${getFrameDisplayLabel(targetFrameRatio)}场景底图生成失败，已使用原场景图裁切兜底：${error instanceof Error ? error.message : String(error)}`;
          }
        } else {
          warning = '未配置图片 API 或虾客漫SD2卡密，已使用原场景图裁切兜底';
        }

        if (!cleanBlob) {
          cleanBlob = await createScenePositionBoardCleanBlob(sourceBlob, targetFrameRatio);
          usedFallbackCrop = true;
        }

        cleanBlobKey = await saveBlob(cleanBlob);
        dispatch({
          type: 'UPDATE_SCENE_SPATIAL_MASTER',
          sceneKey: sceneMasterViewKey,
          ...target,
          updates: {
            status: 'done',
            schemaVersion: SCENE_SPATIAL_MASTER_SCHEMA_VERSION,
            frameRatio: targetFrameRatio,
            sceneName: sceneMasterKey,
            view: sceneMasterView,
            cleanBlobKey,
            sourceSceneAssetId: sceneAsset.id,
            promptSnapshot,
            referenceAssetIds: [sceneAsset.id],
            generatedAt: Date.now(),
            warning,
            error: undefined,
            isStale: false,
            usedFallbackCrop,
          },
        });
      }

      const markedBlob = await createScenePositionBoardMarkedBlob(cleanBlob, pointSnapshot, targetFrameRatio);
      const markedBlobKey = await saveBlob(markedBlob);
      const oldMarkedBlobKey = board?.markedBlobKey;
      const nextChoreography = applyScenePositionPointsToChoreography(currentSb.choreography, pointSnapshot, targetFrameRatio);
      const sourceBlocking = currentSb.spatialBlocking
        ?? currentSb.continuityOutput?.spatialBlocking
        ?? nextChoreography?.endBlocking
        ?? nextChoreography?.startBlocking;
      const nextSpatialBlocking = applyScenePositionPointsToBlocking(sourceBlocking, pointSnapshot, targetFrameRatio);
      const nextContinuityOutput = currentSb.continuityOutput
        ? {
            ...currentSb.continuityOutput,
            spatialBlocking: nextSpatialBlocking ?? currentSb.continuityOutput.spatialBlocking,
            generatedAt: Date.now(),
          }
        : currentSb.continuityInput
          ? {
              itemTracker: currentSb.continuityInput.itemTracker,
              lastFrameInfo: currentSb.lastFrameInfo || currentSb.continuityInput.lastFrameInfo,
              spatialBlocking: nextSpatialBlocking,
              summary: currentSb.continuityInput.summary,
              sourceStoryboardIndex: currentIndex,
              generatedAt: Date.now(),
            }
          : undefined;

      dispatch({
        type: 'UPDATE_STORYBOARD',
        index: currentIndex,
        ...target,
        updates: {
          scenePositionBoard: {
            status: 'done',
            schemaVersion: SCENE_SPATIAL_MASTER_SCHEMA_VERSION,
            frameRatio: targetFrameRatio,
            cleanBlobKey,
            markedBlobKey,
            sourceSceneAssetId: sceneAsset.id,
            promptSnapshot: currentSb.prompt?.rawText,
            referenceAssetIds: [sceneAsset.id],
            sceneMasterKey: sceneMasterViewKey,
            sceneMasterView,
            sceneMasterReused: reusedSceneMaster,
            points: pointSnapshot,
            generatedAt: Date.now(),
            warning,
            isStale: false,
            usedFallbackCrop,
          },
          choreography: nextChoreography,
          spatialBlocking: nextSpatialBlocking ?? currentSb.spatialBlocking,
          continuityOutput: nextContinuityOutput,
          isStale: !!currentSb.prompt,
          storyboardBoard: markStoryboardBoardStale(currentSb.storyboardBoard, 'source-change'),
        },
      });

      if (oldMarkedBlobKey && oldMarkedBlobKey !== markedBlobKey) {
        deleteBlob(oldMarkedBlobKey).catch(() => undefined);
      }
      if (previousBoardCleanBlobKey && previousBoardCleanBlobKey !== cleanBlobKey) {
        const latestChapter = currentProject?.chapters.find((chapter) => chapter.id === targetChapterId);
        const stillUsedByMaster = Object.values(latestChapter?.sceneSpatialMasters ?? {}).some((master) =>
          master.cleanBlobKey === previousBoardCleanBlobKey,
        );
        if (!stillUsedByMaster) deleteBlob(previousBoardCleanBlobKey).catch(() => undefined);
      }
    } catch (error) {
      dispatch({
        type: 'UPDATE_SCENE_SPATIAL_MASTER',
        sceneKey: sceneMasterViewKey,
        ...target,
        updates: {
          status: 'failed',
          schemaVersion: SCENE_SPATIAL_MASTER_SCHEMA_VERSION,
          frameRatio: targetFrameRatio,
          sceneName: sceneMasterKey,
          view: sceneMasterView,
          error: error instanceof Error ? error.message : String(error),
          sourceSceneAssetId: sceneAsset.id,
          promptSnapshot,
          referenceAssetIds: [sceneAsset.id],
          isStale: true,
        },
      });
      dispatch({
        type: 'UPDATE_STORYBOARD',
        index: currentIndex,
        ...target,
        updates: {
          scenePositionBoard: {
            ...board,
            status: 'failed',
            schemaVersion: SCENE_SPATIAL_MASTER_SCHEMA_VERSION,
            frameRatio: targetFrameRatio,
            error: error instanceof Error ? error.message : String(error),
            sourceSceneAssetId: sceneAsset.id,
            promptSnapshot: currentSb.prompt?.rawText,
            referenceAssetIds: [sceneAsset.id],
            sceneMasterKey: sceneMasterViewKey,
            sceneMasterView,
            points: pointSnapshot,
            isStale: true,
          },
        },
      });
    }
  }, [
    board,
    commonDisabledReason,
    currentChapter?.id,
    currentIndex,
    currentProject?.id,
    currentProject?.chapters,
    currentSb,
    dispatch,
    freshSceneMaster,
    hasFreshSceneMaster,
    points,
    sceneMasterKey,
    sceneMasterView,
    sceneMasterViewKey,
    sceneMasterViewLabel,
    sceneContext.sceneAsset,
    state.imageApiConfig,
    state.videoApiConfig,
    targetFrameRatio,
  ]);

  const nudgePoint = useCallback((character: string, dx: number, dy: number) => {
    const sourcePoints = board?.points?.length ? board.points : points;
    const nextPoints = sourcePoints.map((point) => point.character === character
      ? (() => {
          const nextPoint = {
          ...point,
          x: Math.max(0.08, Math.min(0.92, point.x + dx)),
          y: Math.max(0.08, Math.min(0.92, point.y + dy)),
          };
          return {
            ...nextPoint,
            shortDramaLayout: buildShortDramaLayoutForPoint(nextPoint, targetFrameRatio),
          };
        })()
      : point);
    void redrawMarkedBoard(nextPoints);
  }, [board?.points, points, redrawMarkedBoard, targetFrameRatio]);

  const clearBoard = useCallback(async () => {
    const targetProjectId = currentProject?.id;
    const targetChapterId = currentChapter?.id;
    if (!targetProjectId || !targetChapterId || !board) return;
    await Promise.all([
      board.markedBlobKey ? deleteBlob(board.markedBlobKey).catch(() => undefined) : Promise.resolve(),
    ]);
    dispatch({
      type: 'UPDATE_STORYBOARD',
      index: currentIndex,
      projectId: targetProjectId,
      chapterId: targetChapterId,
      updates: { scenePositionBoard: undefined },
    });
  }, [board, currentChapter?.id, currentIndex, currentProject?.id, dispatch]);

  const downloadBoard = useCallback(async () => {
    if (!board?.markedBlobKey) return;
    const blob = await loadBlob(board.markedBlobKey);
    if (!blob) return;
    const fileName = `${String(currentSb.storyboard.number).padStart(2, '0')}_${currentSb.storyboard.name}_scene-position-board.png`;
    downloadBlobFile(blob, fileName);
  }, [board?.markedBlobKey, currentSb.storyboard.name, currentSb.storyboard.number]);

  return {
    board,
    previewUrl,
    points: board?.points?.length ? board.points : points,
    hasFreshBoard,
    hasFreshSceneMaster,
    sceneMaster,
    sceneMasterView,
    sceneMasterViewLabel,
    sceneAsset: sceneContext.sceneAsset,
    disabledReason: commonDisabledReason,
    isGenerating: board?.status === 'generating',
    generateBoard,
    nudgePoint,
    clearBoard,
    downloadBoard,
  };
}
