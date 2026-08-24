import type { AppState, Asset, Chapter, ImageReference, Project, StoryboardState } from '@/types';
import type { Action } from './projectStore';
import { updateCurrentProject, updateCurrentStoryboards, updateChapterInProject, updateProjectById, updateStoryboardsById } from './helpers';
import { markStoryboardBoardStale, storyboardBoardUsesAsset } from '@/lib/storyboardBoardState';
import { markScenePositionBoardStale, scenePositionBoardUsesAsset } from '@/lib/scenePositionBoardState';
import { getSceneSpatialMasterViewKey, inferSceneSpatialMasterView, markSceneSpatialMastersUsingAssetStale } from '@/lib/sceneSpatialMasterState';
import {
  getImageRefCharacterVariantKey,
  isStoryboardCharacterReferenceConcept,
  resolveCharacterReferenceAssetId,
} from '@/lib/characterReferenceUtils';

function matchesCharacterRefVariant(
  imageRef: Pick<ImageReference, 'type' | 'name' | 'variantKey' | 'outfitSeq'>,
  characterName: string,
  variantKey?: string,
) {
  if (imageRef.type !== 'character' || imageRef.name !== characterName) return false;
  const refVariantKey = getImageRefCharacterVariantKey(imageRef);
  return variantKey ? refVariantKey === variantKey : !refVariantKey;
}

function relinkCharacterRefs(
  project: Project,
  characterName: string,
  variantKey?: string,
  assetId?: string,
  preserveGeneratedBoards = true,
) {
  return project.chapters.map((chapter) => ({
    ...chapter,
    storyboards: chapter.storyboards.map((storyboard) => {
      let changed = false;
      const relinkRefs = (refs: ImageReference[] | undefined) => (refs ?? []).map((imageRef) => {
        if (!matchesCharacterRefVariant(imageRef, characterName, variantKey)) {
          return imageRef;
        }
        if (imageRef.assetBindingMode === 'manual') {
          return imageRef;
        }
        if (imageRef.assetId === assetId && imageRef.assetBindingMode === (assetId ? 'auto' : undefined)) {
          return imageRef;
        }
        changed = true;
        return {
          ...imageRef,
          assetId,
          assetBindingMode: assetId ? ('auto' as const) : undefined,
        };
      });
      const imageRefs = relinkRefs(storyboard.imageRefs);
      const videoImageRefs = Array.isArray(storyboard.videoImageRefs)
        ? relinkRefs(storyboard.videoImageRefs)
        : storyboard.videoImageRefs;

      const nextStoryboard = changed ? { ...storyboard, imageRefs, videoImageRefs } : storyboard;
      return changed
        ? preserveGeneratedBoards
          ? nextStoryboard
          : {
              ...nextStoryboard,
              storyboardBoard: markStoryboardBoardStale(nextStoryboard.storyboardBoard, 'reference-binding'),
              scenePositionBoard: markScenePositionBoardStale(nextStoryboard.scenePositionBoard),
            }
        : nextStoryboard;
    }),
  }));
}

function shouldRelinkStoryboardCharacterRefs(asset: Pick<Asset, 'type'> & { concept?: Asset['concept'] } | undefined) {
  return asset?.type === 'character' && isStoryboardCharacterReferenceConcept(asset.concept);
}

function storyboardSceneSpatialMasterUsesAsset(
  chapter: Chapter,
  storyboard: StoryboardState,
  assetId: string,
) {
  const masters = chapter.sceneSpatialMasters;
  if (!masters) return false;
  const candidateKeys = new Set<string>();
  if (storyboard.scenePositionBoard?.sceneMasterKey) {
    candidateKeys.add(storyboard.scenePositionBoard.sceneMasterKey);
  }
  if (storyboard.storyboard.scene) {
    candidateKeys.add(getSceneSpatialMasterViewKey(storyboard.storyboard.scene, inferSceneSpatialMasterView(storyboard)));
    candidateKeys.add(getSceneSpatialMasterViewKey(storyboard.storyboard.scene, 'primary'));
  }

  return Array.from(candidateKeys).some((key) => {
    const master = masters[key];
    return master?.sourceSceneAssetId === assetId || (master?.referenceAssetIds ?? []).includes(assetId);
  });
}

export function handleAssetAction(state: AppState, action: Action): AppState | null {
  switch (action.type) {
    case 'ADD_ASSET':
      return (action.projectId ? updateProjectById(state, action.projectId, (project) => {
        const newAssetLibrary = [...(project.assetLibrary ?? []), action.asset];
        if (action.skipAutoRelink) {
          return { ...project, assetLibrary: newAssetLibrary };
        }

        const isLinkableConcept = action.asset.type === 'scene' || action.asset.type === 'prop';

        const updatedChapters = shouldRelinkStoryboardCharacterRefs(action.asset)
          ? relinkCharacterRefs(
              project,
              action.asset.name,
              action.asset.variantKey,
              resolveCharacterReferenceAssetId(newAssetLibrary, {
                name: action.asset.name,
                variantKey: action.asset.variantKey,
                outfitSeq: action.asset.outfitSeq,
              }),
            )
          : isLinkableConcept
            ? project.chapters.map((chapter) => ({
                ...chapter,
                storyboards: chapter.storyboards.map((storyboard) => {
                  let changed = false;
                  const imageRefs = (storyboard.imageRefs ?? []).map((imageRef) => {
                    const shouldLink = imageRef.type === action.asset.type
                      && !imageRef.assetId
                      && (action.asset.type === 'prop'
                        ? imageRef.trackingId === action.asset.identityKey
                        : imageRef.name === action.asset.name);
                    if (!shouldLink) return imageRef;
                    changed = true;
                    return {
                      ...imageRef,
                      assetId: action.asset.id,
                      assetBindingMode: 'auto' as const,
                    };
                  });
                  const nextStoryboard = changed ? { ...storyboard, imageRefs } : storyboard;
                  if (!changed) return nextStoryboard;
                  if (action.asset.type !== 'scene') return nextStoryboard;
                  return {
                    ...nextStoryboard,
                    storyboardBoard: markStoryboardBoardStale(nextStoryboard.storyboardBoard, 'scene-asset'),
                    scenePositionBoard: markScenePositionBoardStale(nextStoryboard.scenePositionBoard),
                  };
                }),
              }))
            : project.chapters;

        return { ...project, assetLibrary: newAssetLibrary, chapters: updatedChapters };
      }) : updateCurrentProject(state, (project) => {
        const newAssetLibrary = [...(project.assetLibrary ?? []), action.asset];
        if (action.skipAutoRelink) {
          return { ...project, assetLibrary: newAssetLibrary };
        }

        const isLinkableConcept = action.asset.type === 'scene' || action.asset.type === 'prop';

        const updatedChapters = shouldRelinkStoryboardCharacterRefs(action.asset)
          ? relinkCharacterRefs(
              project,
              action.asset.name,
              action.asset.variantKey,
              resolveCharacterReferenceAssetId(newAssetLibrary, {
                name: action.asset.name,
                variantKey: action.asset.variantKey,
                outfitSeq: action.asset.outfitSeq,
              }),
            )
          : isLinkableConcept
            ? project.chapters.map((chapter) => ({
                ...chapter,
                storyboards: chapter.storyboards.map((storyboard) => {
                  let changed = false;
                  const imageRefs = (storyboard.imageRefs ?? []).map((imageRef) => {
                    const shouldLink = imageRef.type === action.asset.type
                      && !imageRef.assetId
                      && (action.asset.type === 'prop'
                        ? imageRef.trackingId === action.asset.identityKey
                        : imageRef.name === action.asset.name);
                    if (!shouldLink) return imageRef;
                    changed = true;
                    return {
                      ...imageRef,
                      assetId: action.asset.id,
                      assetBindingMode: 'auto' as const,
                    };
                  });
                  const nextStoryboard = changed ? { ...storyboard, imageRefs } : storyboard;
                  if (!changed) return nextStoryboard;
                  if (action.asset.type !== 'scene') return nextStoryboard;
                  return {
                    ...nextStoryboard,
                    storyboardBoard: markStoryboardBoardStale(nextStoryboard.storyboardBoard, 'scene-asset'),
                    scenePositionBoard: markScenePositionBoardStale(nextStoryboard.scenePositionBoard),
                  };
                }),
              }))
            : project.chapters;

        return { ...project, assetLibrary: newAssetLibrary, chapters: updatedChapters };
      }));

    case 'UPDATE_ASSET':
      return (action.projectId ? updateProjectById(state, action.projectId, (project) => {
        const targetAsset = (project.assetLibrary ?? []).find((asset) => asset.id === action.assetId);
        if (!targetAsset) return project;

        const touchesDefault = Object.prototype.hasOwnProperty.call(action.updates, 'isDefault');
        const imageBlobChanged = Object.prototype.hasOwnProperty.call(action.updates, 'blobKey');
        const preservesLightweightVariant = Object.prototype.hasOwnProperty.call(action.updates, 'lightweightBlobKey');
        const normalizedUpdates = imageBlobChanged && !preservesLightweightVariant
          ? {
              ...action.updates,
              lightweightBlobKey: undefined,
              lightweightMimeType: undefined,
              lightweightQuality: undefined,
              lightweightOriginalBytes: undefined,
              lightweightBytes: undefined,
              lightweightWidth: undefined,
              lightweightHeight: undefined,
              lightweightCreatedAt: undefined,
            }
          : action.updates;
        const updatedAssetLibrary = (project.assetLibrary ?? []).map((asset) => {
          if (touchesDefault && targetAsset.type === 'character' && asset.type === 'character' && asset.name === targetAsset.name) {
            if (asset.id === action.assetId) {
              return { ...asset, ...normalizedUpdates, updatedAt: Date.now() };
            }
            return { ...asset, isDefault: false, updatedAt: Date.now() };
          }
          return asset.id === action.assetId ? { ...asset, ...normalizedUpdates, updatedAt: Date.now() } : asset;
        });

        const shouldMarkBoardStale = imageBlobChanged && targetAsset.type === 'scene';
        const effectiveVariantKey = Object.prototype.hasOwnProperty.call(normalizedUpdates, 'variantKey')
          ? normalizedUpdates.variantKey
          : targetAsset.variantKey;
        const effectiveOutfitSeq = Object.prototype.hasOwnProperty.call(normalizedUpdates, 'outfitSeq')
          ? normalizedUpdates.outfitSeq
          : targetAsset.outfitSeq;

        const effectiveConcept = Object.prototype.hasOwnProperty.call(normalizedUpdates, 'concept')
          ? normalizedUpdates.concept
          : targetAsset.concept;

        const relinkedChapters = shouldRelinkStoryboardCharacterRefs({ type: targetAsset.type, concept: effectiveConcept })
          ? relinkCharacterRefs(
              project,
              targetAsset.name,
              effectiveVariantKey,
              resolveCharacterReferenceAssetId(updatedAssetLibrary, {
                name: targetAsset.name,
                variantKey: effectiveVariantKey,
                outfitSeq: effectiveOutfitSeq,
              }),
            )
          : project.chapters;

        const updatedChapters = shouldMarkBoardStale
          ? relinkedChapters.map((chapter) => ({
              ...chapter,
              sceneSpatialMasters: markSceneSpatialMastersUsingAssetStale(chapter.sceneSpatialMasters, action.assetId),
              storyboards: chapter.storyboards.map((storyboard) => {
                const usesChangedAsset = storyboardBoardUsesAsset(storyboard.storyboardBoard, action.assetId)
                  || scenePositionBoardUsesAsset(storyboard.scenePositionBoard, action.assetId)
                  || storyboardSceneSpatialMasterUsesAsset(chapter, storyboard, action.assetId);
                return usesChangedAsset
                  ? {
                      ...storyboard,
                      storyboardBoard: markStoryboardBoardStale(storyboard.storyboardBoard, 'scene-asset'),
                      scenePositionBoard: markScenePositionBoardStale(storyboard.scenePositionBoard),
                    }
                  : storyboard;
              }),
            }))
          : relinkedChapters;

        return {
          ...project,
          assetLibrary: updatedAssetLibrary,
          chapters: updatedChapters,
        };
      }) : updateCurrentProject(state, (project) => {
        const targetAsset = (project.assetLibrary ?? []).find((asset) => asset.id === action.assetId);
        if (!targetAsset) return project;

        const touchesDefault = Object.prototype.hasOwnProperty.call(action.updates, 'isDefault');
        const imageBlobChanged = Object.prototype.hasOwnProperty.call(action.updates, 'blobKey');
        const preservesLightweightVariant = Object.prototype.hasOwnProperty.call(action.updates, 'lightweightBlobKey');
        const normalizedUpdates = imageBlobChanged && !preservesLightweightVariant
          ? {
              ...action.updates,
              lightweightBlobKey: undefined,
              lightweightMimeType: undefined,
              lightweightQuality: undefined,
              lightweightOriginalBytes: undefined,
              lightweightBytes: undefined,
              lightweightWidth: undefined,
              lightweightHeight: undefined,
              lightweightCreatedAt: undefined,
            }
          : action.updates;
        const updatedAssetLibrary = (project.assetLibrary ?? []).map((asset) => {
          if (touchesDefault && targetAsset.type === 'character' && asset.type === 'character' && asset.name === targetAsset.name) {
            if (asset.id === action.assetId) {
              return { ...asset, ...normalizedUpdates, updatedAt: Date.now() };
            }
            return { ...asset, isDefault: false, updatedAt: Date.now() };
          }
          return asset.id === action.assetId ? { ...asset, ...normalizedUpdates, updatedAt: Date.now() } : asset;
        });

        // Same-id character/prop refinements should flow into Step5 as fresh refs without invalidating Step4 planning.
        const shouldMarkBoardStale = imageBlobChanged && targetAsset.type === 'scene';
        const effectiveVariantKey = Object.prototype.hasOwnProperty.call(normalizedUpdates, 'variantKey')
          ? normalizedUpdates.variantKey
          : targetAsset.variantKey;
        const effectiveOutfitSeq = Object.prototype.hasOwnProperty.call(normalizedUpdates, 'outfitSeq')
          ? normalizedUpdates.outfitSeq
          : targetAsset.outfitSeq;

        const effectiveConcept = Object.prototype.hasOwnProperty.call(normalizedUpdates, 'concept')
          ? normalizedUpdates.concept
          : targetAsset.concept;

        const relinkedChapters = shouldRelinkStoryboardCharacterRefs({ type: targetAsset.type, concept: effectiveConcept })
          ? relinkCharacterRefs(
              project,
              targetAsset.name,
              effectiveVariantKey,
              resolveCharacterReferenceAssetId(updatedAssetLibrary, {
                name: targetAsset.name,
                variantKey: effectiveVariantKey,
                outfitSeq: effectiveOutfitSeq,
              }),
            )
          : project.chapters;

        const updatedChapters = shouldMarkBoardStale
          ? relinkedChapters.map((chapter) => ({
              ...chapter,
              sceneSpatialMasters: markSceneSpatialMastersUsingAssetStale(chapter.sceneSpatialMasters, action.assetId),
              storyboards: chapter.storyboards.map((storyboard) => {
                const usesChangedAsset = storyboardBoardUsesAsset(storyboard.storyboardBoard, action.assetId)
                  || scenePositionBoardUsesAsset(storyboard.scenePositionBoard, action.assetId)
                  || storyboardSceneSpatialMasterUsesAsset(chapter, storyboard, action.assetId);
                return usesChangedAsset
                  ? {
                      ...storyboard,
                      storyboardBoard: markStoryboardBoardStale(storyboard.storyboardBoard, 'scene-asset'),
                      scenePositionBoard: markScenePositionBoardStale(storyboard.scenePositionBoard),
                    }
                  : storyboard;
              }),
            }))
          : relinkedChapters;

        return {
          ...project,
          assetLibrary: updatedAssetLibrary,
          chapters: updatedChapters,
        };
      }));

    case 'DELETE_ASSET':
      return updateCurrentProject(state, (project) => {
        const deletedAsset = (project.assetLibrary ?? []).find((asset) => asset.id === action.assetId);
        const newAssetLibrary = (project.assetLibrary ?? [])
          .filter((asset) => asset.id !== action.assetId)
          .map((asset) => (
            asset.baseAssetId === action.assetId
              ? { ...asset, baseAssetId: undefined, updatedAt: Date.now() }
              : asset
          ));
        let updatedChapters: Project['chapters'] = project.chapters.map((chapter) => ({
          ...chapter,
          sceneSpatialMasters: markSceneSpatialMastersUsingAssetStale(chapter.sceneSpatialMasters, action.assetId),
          storyboards: chapter.storyboards.map((storyboard) => {
            let changed = false;
            const unlinkRefs = (refs: ImageReference[] | undefined) => (refs ?? []).map((imageRef) => {
              if (imageRef.assetId === action.assetId) {
                changed = true;
                return {
                  ...imageRef,
                  assetId: undefined,
                  assetBindingMode: undefined,
                };
              }
              return imageRef;
            });
            const imageRefs = unlinkRefs(storyboard.imageRefs);
            const videoImageRefs = Array.isArray(storyboard.videoImageRefs)
              ? unlinkRefs(storyboard.videoImageRefs)
              : storyboard.videoImageRefs;
            const referencesDeletedAsset = storyboardBoardUsesAsset(storyboard.storyboardBoard, action.assetId)
              || scenePositionBoardUsesAsset(storyboard.scenePositionBoard, action.assetId)
              || storyboardSceneSpatialMasterUsesAsset(chapter, storyboard, action.assetId);
            const nextStoryboard = changed ? { ...storyboard, imageRefs, videoImageRefs } : storyboard;
            const staleReason = deletedAsset?.type === 'scene' ? 'scene-asset' : 'reference-binding';
            return changed || referencesDeletedAsset
              ? {
                  ...nextStoryboard,
                  storyboardBoard: markStoryboardBoardStale(nextStoryboard.storyboardBoard, staleReason),
                  scenePositionBoard: markScenePositionBoardStale(nextStoryboard.scenePositionBoard),
                }
              : nextStoryboard;
          }),
        }));

        if (deletedAsset && shouldRelinkStoryboardCharacterRefs(deletedAsset)) {
          updatedChapters = relinkCharacterRefs(
            { ...project, chapters: updatedChapters },
            deletedAsset.name,
            deletedAsset.variantKey,
            resolveCharacterReferenceAssetId(newAssetLibrary, {
              name: deletedAsset.name,
              variantKey: deletedAsset.variantKey,
              outfitSeq: deletedAsset.outfitSeq,
            }),
          );
        }

        return { ...project, assetLibrary: newAssetLibrary, chapters: updatedChapters };
      });

    case 'LINK_ASSET_TO_STORYBOARD': {
      const mapLink = (storyboard: StoryboardState, index: number) =>
          index === action.sbIndex
            ? (() => {
                const targetImageRef = storyboard.imageRefs.find((imageRef) => imageRef.refId === action.imageRefRefId);
                const preserveGeneratedBoards = action.preserveGeneratedBoards ?? targetImageRef?.type !== 'scene';
                const linkRefs = (refs: ImageReference[] | undefined) => (refs ?? []).map((imageRef) =>
                  imageRef.refId === action.imageRefRefId
                    ? {
                        ...imageRef,
                        assetId: action.assetId,
                        assetBindingMode: (action.bindingMode ?? 'manual') as 'auto' | 'manual',
                      }
                    : imageRef,
                );
                const nextStoryboard = {
                  ...storyboard,
                  imageRefs: linkRefs(storyboard.imageRefs),
                  videoImageRefs: Array.isArray(storyboard.videoImageRefs)
                    ? linkRefs(storyboard.videoImageRefs)
                    : storyboard.videoImageRefs,
                };
                return preserveGeneratedBoards
                  ? nextStoryboard
                  : {
                      ...nextStoryboard,
                      storyboardBoard: markStoryboardBoardStale(storyboard.storyboardBoard, 'scene-asset'),
                      scenePositionBoard: markScenePositionBoardStale(storyboard.scenePositionBoard),
                    };
              })()
            : storyboard;
      return action.projectId
        ? updateStoryboardsById(state, action.projectId, action.chapterId, mapLink)
        : updateCurrentStoryboards(state, mapLink, action.chapterId);
    }

    case 'UNLINK_ASSET_FROM_STORYBOARD': {
      const mapUnlink = (storyboard: StoryboardState, index: number) =>
          index === action.sbIndex
            ? (() => {
                const targetImageRef = storyboard.imageRefs.find((imageRef) => imageRef.refId === action.imageRefRefId);
                const preserveGeneratedBoards = action.preserveGeneratedBoards ?? targetImageRef?.type !== 'scene';
                const unlinkRefs = (refs: ImageReference[] | undefined) => (refs ?? []).map((imageRef) =>
                  imageRef.refId === action.imageRefRefId
                    ? { ...imageRef, assetId: undefined, assetBindingMode: undefined }
                    : imageRef,
                );
                const nextStoryboard = {
                  ...storyboard,
                  imageRefs: unlinkRefs(storyboard.imageRefs),
                  videoImageRefs: Array.isArray(storyboard.videoImageRefs)
                    ? unlinkRefs(storyboard.videoImageRefs)
                    : storyboard.videoImageRefs,
                };
                return preserveGeneratedBoards
                  ? nextStoryboard
                  : {
                      ...nextStoryboard,
                      storyboardBoard: markStoryboardBoardStale(storyboard.storyboardBoard, 'scene-asset'),
                      scenePositionBoard: markScenePositionBoardStale(storyboard.scenePositionBoard),
                    };
              })()
            : storyboard;
      return action.projectId
        ? updateStoryboardsById(state, action.projectId, action.chapterId, mapUnlink)
        : updateCurrentStoryboards(state, mapUnlink, action.chapterId);
    }

    case 'REORDER_STORYBOARDS': {
      const chapterId = action.chapterId;
      const project = state.projects.find((item) => item.id === state.currentProjectId);
      if (!project) return state;
      const chapter = project.chapters.find((item) => item.id === chapterId);
      if (!chapter) return state;
      const storyboards = [...chapter.storyboards];
      if (action.fromIndex === action.toIndex) return state;
      const [moved] = storyboards.splice(action.fromIndex, 1);
      storyboards.splice(action.toIndex, 0, moved);
      return {
        ...state,
        projects: state.projects.map((item) => {
          if (item.id !== state.currentProjectId) return item;
          return updateChapterInProject(item, chapterId, { storyboards });
        }),
      };
    }

    default:
      return null;
  }
}
