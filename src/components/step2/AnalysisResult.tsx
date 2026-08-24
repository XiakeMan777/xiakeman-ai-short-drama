// ============================================================
// Step2: 分析结果展示 + 确认（可编辑 + 增删）
// ============================================================

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Pencil, Check, X, BookOpen, RotateCcw, Loader2 } from '@/components/icons';
import { toast } from 'sonner';
import { useApiCall } from '@/hooks/useApiCall';
import { useConfirm } from '@/hooks/useConfirmPrompt';
import { useCurrentProject } from '@/stores/projectStore';
import { STYLE_PRESETS, isCustomStyle } from '@/lib/style-presets';
import { computeImageRefs } from '@/components/step4/storyboardImageRefs';
import { buildStoryboardSourceContexts, resolveStoryboardSourceScriptText } from '@/lib/storyboardSource';
import { removeCharacterFromAnalysis, validateAnalysisBeforeConfirm } from './analysisEditing';
import { EntityResolutionPanel } from './EntityResolutionPanel';
import { AnalysisResultTabs, replaceStoryboardSourceText } from './AnalysisResultTabs';
import { CharacterVoiceReferencePanel } from '@/components/voice/CharacterVoiceReferencePanel';
import { getReviewFilterLabel, REVIEW_FILTER_OPTIONS, type ReviewFilter } from './analysisReviewFilters';
import { ENABLE_NEXT_UI_PREVIEW } from '@/lib/uiMode';
import {
  buildUniqueName,
  getNextOutfitSeqForCharacter,
  hasDuplicateName,
  limitTextForAiAutofill,
  normalizeName,
  normalizeOptionalText,
  replaceName,
  shiftStoryboardRange,
  toUniqueNames,
  withPropRangeDefaultsIfFollowingCurrentDefault,
} from './analysisResultUtils';
import {
  autofillAnalysisDetails,
  buildAiAutofillTargets,
  createAnalysisAutofillSignature,
  mergeAnalysisAutofillPatch,
  parseAnalysisAutofillPatchResponse,
  resolveAutofillSourceText,
} from './analysisAutofill';
import {
  applyEntityResolution,
  applyEntityResolutions,
  findEntityResolutionSuggestions,
  getEntityResolutionTypeLabel,
  isEntityResolutionAutoApplicable,
  type EntityResolutionSuggestion,
} from '@/lib/entityResolution';
import {
  getAnalysisReviewOverview,
  getCharacterBlockingSuggestions,
  getCharacterReviewSummary,
  getOutfitBlockingSuggestions,
  getOutfitDetailSuggestions,
  getPropBlockingSuggestions,
  getPropInferredFieldLabels,
  getPropDetailSuggestions,
  getSceneBlockingSuggestions,
  getSceneInferredFieldLabels,
  getSceneDetailSuggestions,
} from './detailReview';
import type {
  CharacterOutfit,
  CharacterProfile,
  PropConsistency,
  ScriptAnalysis,
  StoryboardState,
  SceneInfo,
  StoryboardInfo,
} from '@/types';

export function AnalysisResult() {
  const { state, dispatch, currentProject, currentChapter: chapter } = useCurrentProject();
  const { confirm, ConfirmDialog } = useConfirm();
  const {
    loading: aiAutofillLoading,
    error: aiAutofillError,
    streamText: aiAutofillStreamText,
    callApiViaBff: callAiAutofillViaBff,
  } = useApiCall({ stream: true });

  const analysis = chapter?.analysis ?? null;
  const isAnalysisStale = !!chapter?.analysisIsStale;
  const [editSceneIdx, setEditSceneIdx] = useState<number | null>(null);
  const [editCharIdx, setEditCharIdx] = useState<number | null>(null);
  const [editSbIdx, setEditSbIdx] = useState<number | null>(null);
  const [editOutfitIdx, setEditOutfitIdx] = useState<number | null>(null);
  const [editPropIdx, setEditPropIdx] = useState<number | null>(null);
  const [tempScene, setTempScene] = useState<Partial<SceneInfo>>({});
  const [tempChar, setTempChar] = useState('');
  const [tempCharacterProfile, setTempCharacterProfile] = useState<Partial<CharacterProfile>>({});
  const [tempSb, setTempSb] = useState<Partial<StoryboardInfo>>({});
  const [tempOutfit, setTempOutfit] = useState<Partial<CharacterOutfit>>({});
  const [tempProp, setTempProp] = useState<Partial<PropConsistency>>({});
  const [customStyle, setCustomStyle] = useState('');
  const [editingAdaptedScript, setEditingAdaptedScript] = useState(false);
  const [tempAdaptedScript, setTempAdaptedScript] = useState('');
  const [dismissedEntityResolutionIds, setDismissedEntityResolutionIds] = useState<Set<string>>(() => new Set());
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [confirmingStep3, setConfirmingStep3] = useState(false);
  const confirmStep3Ref = useRef(false);

  if (!analysis) return null;

  const reviewOverview = getAnalysisReviewOverview({
    analysis,
    adaptedScript: chapter?.adaptedScript ?? '',
  });
  const autofillSourceText = resolveAutofillSourceText({
    scriptType: chapter?.scriptType,
    rawScript: chapter?.rawScript,
    adaptedScript: chapter?.adaptedScript,
  });
  const autofillPreview = autofillAnalysisDetails(analysis, autofillSourceText);
  const aiAutofillTextLength = aiAutofillStreamText.trim().length;
  const aiAutofillTargets = buildAiAutofillTargets(autofillPreview.analysis, autofillSourceText);
  const aiAutofillTargetIds = aiAutofillTargets.map((target) => target.id);
  const currentAnalysisAutofillSignature = createAnalysisAutofillSignature(
    autofillPreview.analysis,
    aiAutofillTargetIds,
  );
  const hasFreshAiAutofill = aiAutofillTargets.length > 0
    && chapter?.analysisAiAutofillSignature === currentAnalysisAutofillSignature;
  const entityResolutionSuggestions = currentProject
    ? findEntityResolutionSuggestions({
        analysis,
        project: currentProject,
        currentChapterId: currentProject.currentChapterId,
      }).filter((suggestion) => !dismissedEntityResolutionIds.has(suggestion.id))
    : [];
  const highConfidenceEntityResolutionSuggestions = entityResolutionSuggestions.filter(isEntityResolutionAutoApplicable);
  const hasComparableChapterAnalysis = (currentProject?.chapters ?? []).some((item) =>
    item.id !== currentProject?.currentChapterId && !!item.analysis,
  );
  const isReviewFilterActive = reviewFilter !== 'all';
  const reviewFilterLabel = getReviewFilterLabel(reviewFilter);
  const effectiveProjectStyleConfig = analysis.styleConfig || currentProject?.styleConfig || '';
  const stylePreset = STYLE_PRESETS.find((preset) => preset.value === effectiveProjectStyleConfig);
  const styleDisplayLabel = stylePreset?.label ?? (effectiveProjectStyleConfig.trim() || '未设置');
  const hasReviewOverview =
    reviewOverview.totalBlockingCount > 0 ||
    reviewOverview.totalOptionalImproveCount > 0 ||
    reviewOverview.totalInferredCount > 0;

  const sceneMatchesReviewFilter = (scene: SceneInfo) => {
    if (reviewFilter === 'all') return true;
    const blockingCount = getSceneBlockingSuggestions(scene, analysis.storyboards).length;
    const optionalCount = Math.max(0, getSceneDetailSuggestions(scene).length - blockingCount);
    const isReferencedScene = analysis.storyboards.some((storyboard) => storyboard.scene === scene.name);

    if (reviewFilter === 'blocking') return blockingCount > 0;
    if (reviewFilter === 'optional') return optionalCount > 0;
    if (reviewFilter === 'inferred') return getSceneInferredFieldLabels(scene).length > 0;
    if (reviewFilter === 'needsImage') return isReferencedScene;
    return true;
  };

  const characterMatchesReviewFilter = (characterName: string) => {
    if (reviewFilter === 'all') return true;
    const blockingCount = getCharacterBlockingSuggestions({
      characterName,
      analysis,
      adaptedScript: chapter?.adaptedScript ?? '',
    }).length;
    const review = getCharacterReviewSummary({
      characterName,
      adaptedScript: chapter?.adaptedScript ?? '',
      outfits: analysis.outfitTracking,
      characterProfiles: analysis.characterProfiles,
    });
    const optionalCount = Math.max(0, review.suggestions.length - blockingCount);
    const appearsInStoryboard = analysis.storyboards.some((storyboard) =>
      storyboard.characters?.includes(characterName),
    );

    if (reviewFilter === 'blocking') return blockingCount > 0;
    if (reviewFilter === 'optional') return optionalCount > 0;
    if (reviewFilter === 'inferred') return review.inferredLabels.length > 0;
    if (reviewFilter === 'needsImage') return appearsInStoryboard;
    return true;
  };

  const outfitMatchesReviewFilter = (outfit: CharacterOutfit) => {
    if (reviewFilter === 'all') return true;
    const blockingCount = getOutfitBlockingSuggestions(outfit).length;
    const optionalCount = Math.max(0, getOutfitDetailSuggestions(outfit).length - blockingCount);

    if (reviewFilter === 'blocking') return blockingCount > 0;
    if (reviewFilter === 'optional') return optionalCount > 0;
    if (reviewFilter === 'inferred') return false;
    if (reviewFilter === 'needsImage') return outfit.needsNewImage;
    return true;
  };

  const propMatchesReviewFilter = (prop: PropConsistency) => {
    if (reviewFilter === 'all') return true;
    const blockingCount = getPropBlockingSuggestions(prop).length;
    const optionalCount = Math.max(0, getPropDetailSuggestions(prop).length - blockingCount);

    if (reviewFilter === 'blocking') return blockingCount > 0;
    if (reviewFilter === 'optional') return optionalCount > 0;
    if (reviewFilter === 'inferred') return getPropInferredFieldLabels(prop).length > 0;
    if (reviewFilter === 'needsImage') return prop.needsTracking !== false && prop.needsImage;
    return true;
  };

  const visibleSceneItems = analysis.scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => sceneMatchesReviewFilter(scene));
  const visibleCharacterItems = analysis.allCharacterNames
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => characterMatchesReviewFilter(name));
  const visibleOutfitItems = analysis.outfitTracking
    .map((outfit, index) => ({ outfit, index }))
    .filter(({ outfit }) => outfitMatchesReviewFilter(outfit));
  const visiblePropItems = analysis.propTracking
    .map((prop, index) => ({ prop, index }))
    .filter(({ prop }) => propMatchesReviewFilter(prop));

  const reviewFilterCounts: Record<ReviewFilter, number> = {
    all: analysis.scenes.length + analysis.allCharacterNames.length + analysis.outfitTracking.length + analysis.propTracking.length,
    blocking: reviewOverview.totalBlockingCount,
    optional: reviewOverview.totalOptionalImproveCount,
    inferred: reviewOverview.totalInferredCount,
    needsImage:
      analysis.scenes.filter((scene) => analysis.storyboards.some((storyboard) => storyboard.scene === scene.name)).length
      + analysis.allCharacterNames.filter((name) =>
        analysis.storyboards.some((storyboard) => storyboard.characters?.includes(name)),
      ).length
      + analysis.outfitTracking.filter((outfit) => outfit.needsNewImage).length
      + analysis.propTracking.filter((prop) => prop.needsTracking !== false && prop.needsImage).length,
  };
  const visibleReviewFilterOptions = ENABLE_NEXT_UI_PREVIEW
    ? REVIEW_FILTER_OPTIONS.filter((option) =>
        option.value === 'all' ||
        reviewFilterCounts[option.value] > 0 ||
        option.value === reviewFilter,
      )
    : REVIEW_FILTER_OPTIONS;

  const resolveEntitySuggestionsForAnalysis = (baseAnalysis: ScriptAnalysis) => {
    if (!currentProject) return [];
    return findEntityResolutionSuggestions({
      analysis: baseAnalysis,
      project: currentProject,
      currentChapterId: currentProject.currentChapterId,
    }).filter((suggestion) => !dismissedEntityResolutionIds.has(suggestion.id));
  };

  const dismissEntityResolutionSuggestion = (suggestionId: string) => {
    setDismissedEntityResolutionIds((prev) => {
      const next = new Set(prev);
      next.add(suggestionId);
      return next;
    });
  };

  const mergeEntityResolutionSuggestion = (suggestion: EntityResolutionSuggestion) => {
    const nextAnalysis = applyEntityResolution(analysis, suggestion);
    dispatch({ type: 'SET_ANALYSIS', analysis: nextAnalysis });
    setDismissedEntityResolutionIds((prev) => {
      const next = new Set(prev);
      next.delete(suggestion.id);
      return next;
    });
    toast.success(`已合并${getEntityResolutionTypeLabel(suggestion.type)}「${suggestion.currentName}」`, {
      description: `后续统一按「${suggestion.canonicalName}」复用资产。`,
    });
  };

  const mergeHighConfidenceEntitySuggestions = () => {
    if (highConfidenceEntityResolutionSuggestions.length === 0) return;
    const nextAnalysis = applyEntityResolutions(analysis, highConfidenceEntityResolutionSuggestions);
    dispatch({ type: 'SET_ANALYSIS', analysis: nextAnalysis });
    toast.success(`已合并 ${highConfidenceEntityResolutionSuggestions.length} 个高置信实体`, {
      description: 'Step3 会优先复用已有角色、场景和物品资产。',
    });
  };

  const startEditScene = (i: number) => {
    setEditSceneIdx(i);
    setTempScene({ ...analysis.scenes[i] });
  };
  const startEditChar = (i: number) => {
    setEditCharIdx(i);
    setTempChar(analysis.allCharacterNames[i]);
    const currentProfile = analysis.characterProfiles.find((profile) => profile.name === analysis.allCharacterNames[i]);
    setTempCharacterProfile({
      name: analysis.allCharacterNames[i],
      ...(currentProfile ?? {}),
      description: currentProfile?.description ?? '',
    });
  };
  const startEditSb = (i: number) => {
    setEditSbIdx(i);
    setTempSb({ ...analysis.storyboards[i] });
  };
  const startEditOutfit = (i: number) => {
    setEditOutfitIdx(i);
    setTempOutfit({ ...analysis.outfitTracking[i] });
  };
  const startEditProp = (i: number) => {
    setEditPropIdx(i);
    setTempProp({ ...analysis.propTracking[i] });
  };
  const saveScene = () => {
    if (editSceneIdx === null) return;
    const previousScene = analysis.scenes[editSceneIdx];
    const nextSceneName = normalizeName(tempScene.name ?? previousScene.name);
    if (!nextSceneName) {
      toast.error('场景名称不能为空');
      return;
    }
    if (hasDuplicateName(analysis.scenes.map((scene) => scene.name), editSceneIdx, nextSceneName)) {
      toast.error(`场景名称「${nextSceneName}」已存在`);
      return;
    }
    const scenes = [...analysis.scenes];
    scenes[editSceneIdx] = { ...scenes[editSceneIdx], ...tempScene, name: nextSceneName } as SceneInfo;
    const storyboards = previousScene.name !== nextSceneName
      ? analysis.storyboards.map((storyboard) =>
          storyboard.scene === previousScene.name
            ? { ...storyboard, scene: nextSceneName }
            : storyboard,
        )
      : analysis.storyboards;
    dispatch({ type: 'SET_ANALYSIS', analysis: { ...analysis, scenes, storyboards } });
    setEditSceneIdx(null);
  };
  const saveChar = () => {
    if (editCharIdx === null) return;
    const previousCharacterName = analysis.allCharacterNames[editCharIdx];
    const nextCharacterName = normalizeName(tempChar);
    if (!nextCharacterName) {
      toast.error('角色名称不能为空');
      return;
    }
    if (hasDuplicateName(analysis.allCharacterNames, editCharIdx, nextCharacterName)) {
      toast.error(`角色名称「${nextCharacterName}」已存在`);
      return;
    }
    const chars = [...analysis.allCharacterNames];
    chars[editCharIdx] = nextCharacterName;
    const scenes = analysis.scenes.map((scene) => ({
      ...scene,
      characters: replaceName(scene.characters, previousCharacterName, nextCharacterName),
    }));
    const storyboards = analysis.storyboards.map((storyboard) => ({
      ...storyboard,
      characters: replaceName(storyboard.characters, previousCharacterName, nextCharacterName),
    }));
    const outfitTracking = analysis.outfitTracking.map((outfit) =>
      outfit.characterName === previousCharacterName
        ? { ...outfit, characterName: nextCharacterName }
        : outfit,
    );
    const characterProfiles = analysis.characterProfiles.map((profile) =>
      profile.name === previousCharacterName
        ? { ...profile, name: nextCharacterName }
        : profile,
    );
    const propTracking = analysis.propTracking.map((prop) =>
      prop.holder === previousCharacterName
        ? { ...prop, holder: nextCharacterName }
        : prop,
    );
    dispatch({ type: 'SET_ANALYSIS', analysis: { ...analysis, allCharacterNames: chars, characterProfiles, scenes, storyboards, outfitTracking, propTracking } });
    setEditCharIdx(null);
  };
  const saveCharacterProfile = (characterName: string) => {
    const nextName = normalizeName(characterName);
    const nextDescription = normalizeOptionalText(tempCharacterProfile.description);
    const existingIndex = analysis.characterProfiles.findIndex((profile) => profile.name === nextName);
    const nextProfiles = [...analysis.characterProfiles];
    const nextProfile: CharacterProfile = {
      ...(existingIndex >= 0 ? nextProfiles[existingIndex] : { name: nextName, description: '' }),
      ...tempCharacterProfile,
      name: nextName,
      description: nextDescription,
      ageAppearance: normalizeOptionalText(tempCharacterProfile.ageAppearance),
      temperament: normalizeOptionalText(tempCharacterProfile.temperament),
      bodyBuild: normalizeOptionalText(tempCharacterProfile.bodyBuild),
      faceFeatures: normalizeOptionalText(tempCharacterProfile.faceFeatures),
      hairStyle: normalizeOptionalText(tempCharacterProfile.hairStyle),
      skinTone: normalizeOptionalText(tempCharacterProfile.skinTone),
      defaultOutfit: normalizeOptionalText(tempCharacterProfile.defaultOutfit),
      accessories: normalizeOptionalText(tempCharacterProfile.accessories),
      visualAnchor: normalizeOptionalText(tempCharacterProfile.visualAnchor),
      step3Description: normalizeOptionalText(tempCharacterProfile.step3Description),
      inferredFields: tempCharacterProfile.inferredFields ?? (existingIndex >= 0 ? nextProfiles[existingIndex].inferredFields : []),
    };
    if (existingIndex >= 0) {
      nextProfiles[existingIndex] = nextProfile;
    } else {
      nextProfiles.push(nextProfile);
    }
    dispatch({ type: 'SET_ANALYSIS', analysis: { ...analysis, characterProfiles: nextProfiles } });
    toast.success(`已更新角色「${nextName}」描述`);
  };
  const saveSb = () => {
    if (editSbIdx === null) return;
    const previousStoryboard = analysis.storyboards[editSbIdx];
    const { content: _sourceDraft, dialogue: _dialogueDraft, notes: _notesDraft, ...tempSbFields } = tempSb;
    const nextStoryboard: StoryboardInfo = {
      ...previousStoryboard,
      ...tempSbFields,
      name: normalizeName(tempSbFields.name ?? previousStoryboard.name),
      duration: normalizeName(tempSbFields.duration ?? previousStoryboard.duration),
      shotSize: normalizeName(tempSbFields.shotSize ?? previousStoryboard.shotSize),
      scene: normalizeName(tempSbFields.scene ?? previousStoryboard.scene ?? '') || undefined,
      characters: toUniqueNames(tempSbFields.characters ?? previousStoryboard.characters),
    };

    if (!nextStoryboard.name) {
      toast.error('分镜名称不能为空');
      return;
    }
    if (!nextStoryboard.duration) {
      toast.error(`分镜「${nextStoryboard.name}」缺少时长`);
      return;
    }

    const sceneNames = new Set(analysis.scenes.map((scene) => normalizeName(scene.name)).filter(Boolean));
    if (nextStoryboard.scene && !sceneNames.has(nextStoryboard.scene)) {
      toast.error(`分镜引用了不存在的场景「${nextStoryboard.scene}」`);
      return;
    }

    const knownCharacters = new Set(analysis.allCharacterNames.map(normalizeName).filter(Boolean));
    const unknownCharacters = nextStoryboard.characters.filter((character) => !knownCharacters.has(character));
    if (unknownCharacters.length > 0) {
      toast.error(`分镜存在未定义角色：${unknownCharacters.join('、')}`);
      return;
    }

    const sbs = [...analysis.storyboards];
    sbs[editSbIdx] = nextStoryboard;
    dispatch({ type: 'SET_ANALYSIS', analysis: { ...analysis, storyboards: sbs } });
    setEditSbIdx(null);
  };
  const saveOutfit = () => {
    if (editOutfitIdx === null) return;
    const previousOutfit = analysis.outfitTracking[editOutfitIdx];
    const nextOutfit: CharacterOutfit = {
      ...previousOutfit,
      ...tempOutfit,
      characterName: normalizeName(tempOutfit.characterName ?? previousOutfit.characterName),
      outfitSeq: Number(tempOutfit.outfitSeq ?? previousOutfit.outfitSeq) || previousOutfit.outfitSeq,
      outfitDesc: normalizeName(tempOutfit.outfitDesc ?? previousOutfit.outfitDesc),
      storyboardRange: normalizeName(tempOutfit.storyboardRange ?? previousOutfit.storyboardRange),
      needsNewImage: tempOutfit.needsNewImage ?? previousOutfit.needsNewImage,
    };
    const knownCharacters = new Set(analysis.allCharacterNames.map(normalizeName).filter(Boolean));
    if (!nextOutfit.characterName || !knownCharacters.has(nextOutfit.characterName)) {
      toast.error('变装记录必须绑定一个已存在的角色');
      return;
    }
    if (!nextOutfit.outfitDesc) {
      toast.error('服装描述不能为空');
      return;
    }
    if (!nextOutfit.storyboardRange) {
      toast.error('变装记录必须填写分镜范围');
      return;
    }
    const outfitTracking = analysis.outfitTracking.map((outfit, index) =>
      index === editOutfitIdx ? nextOutfit : outfit,
    );
    dispatch({ type: 'SET_ANALYSIS', analysis: { ...analysis, outfitTracking } });
    setEditOutfitIdx(null);
  };
  const saveProp = () => {
    if (editPropIdx === null) return;
    const previousProp = analysis.propTracking[editPropIdx];
    const nextProp: PropConsistency = {
      ...previousProp,
      ...tempProp,
      propName: normalizeName(tempProp.propName ?? previousProp.propName),
      appearanceDesc: normalizeName(tempProp.appearanceDesc ?? previousProp.appearanceDesc),
      size: normalizeOptionalText(tempProp.size ?? previousProp.size),
      material: normalizeOptionalText(tempProp.material ?? previousProp.material),
      shapeStructure: normalizeOptionalText(tempProp.shapeStructure ?? previousProp.shapeStructure),
      color: normalizeOptionalText(tempProp.color ?? previousProp.color),
      texture: normalizeOptionalText(tempProp.texture ?? previousProp.texture),
      condition: normalizeOptionalText(tempProp.condition ?? previousProp.condition),
      visualAnchor: normalizeOptionalText(tempProp.visualAnchor ?? previousProp.visualAnchor),
      step3Description: normalizeOptionalText(tempProp.step3Description ?? previousProp.step3Description),
      inferredFields: tempProp.inferredFields ?? previousProp.inferredFields ?? [],
      holder: normalizeName(tempProp.holder ?? previousProp.holder),
      storyboardRange: normalizeName(tempProp.storyboardRange ?? previousProp.storyboardRange),
      stateChanges: normalizeName(tempProp.stateChanges ?? previousProp.stateChanges),
      needsTracking: tempProp.needsTracking ?? previousProp.needsTracking,
      needsImage: tempProp.needsImage ?? previousProp.needsImage,
    };
    if (!nextProp.propName) {
      toast.error('道具名称不能为空');
      return;
    }
    if (!nextProp.appearanceDesc) {
      toast.error('道具外观描述不能为空');
      return;
    }
    if (!nextProp.holder) {
      toast.error('道具持有者不能为空');
      return;
    }
    if (!nextProp.storyboardRange) {
      toast.error('道具分镜范围不能为空');
      return;
    }
    const propTracking = analysis.propTracking.map((prop, index) =>
      index === editPropIdx ? nextProp : prop,
    );
    dispatch({ type: 'SET_ANALYSIS', analysis: { ...analysis, propTracking } });
    setEditPropIdx(null);
  };

  // ---- 增删操作 ----
  const addScene = () => {
    const newScene: SceneInfo = {
      name: buildUniqueName('新场景', analysis.scenes.map((scene) => scene.name)),
      timeOfDay: '',
      environment: '',
      colorTone: '',
      characters: [],
      spaceScale: '',
      layout: '',
      keySetPieces: '',
      lighting: '',
      weather: '',
      atmosphere: '',
      step3Description: '',
      inferredFields: [],
    };
    dispatch({ type: 'SET_ANALYSIS', analysis: { ...analysis, scenes: [...analysis.scenes, newScene] } });
  };
  const deleteScene = async (i: number) => {
    const deletedName = analysis.scenes[i].name;
    if (!(await confirm(`确定删除场景「${deletedName}」吗？引用该场景的分镜会清空场景绑定。`))) return;
    const scenes = analysis.scenes.filter((_, idx) => idx !== i);
    // 同步清理引用该场景的分镜：清空 scene 字段，保留 characters（场景名不等于角色名）
    const storyboards = analysis.storyboards.map((sb) =>
      sb.scene === deletedName
        ? { ...sb, scene: undefined }
        : sb
    );
    dispatch({ type: 'SET_ANALYSIS', analysis: { ...analysis, scenes, storyboards } });
  };

  const addChar = () => {
    const nextCharacterName = buildUniqueName('新角色', analysis.allCharacterNames);
    dispatch({
      type: 'SET_ANALYSIS',
      analysis: {
        ...analysis,
        allCharacterNames: [...analysis.allCharacterNames, nextCharacterName],
        characterProfiles: [...analysis.characterProfiles, { name: nextCharacterName, description: '', inferredFields: [] }],
      },
    });
  };
  const deleteChar = async (i: number) => {
    const deletedName = analysis.allCharacterNames[i];
    if (!(await confirm(`确定删除角色「${deletedName}」吗？该角色会从场景、分镜、变装和道具持有人中移除。`))) return;
    dispatch({
      type: 'SET_ANALYSIS',
      analysis: {
        ...removeCharacterFromAnalysis(analysis, deletedName),
        characterProfiles: analysis.characterProfiles.filter((profile) => profile.name !== deletedName),
      },
    });
  };

  const addStoryboard = () => {
    const maxNum = analysis.storyboards.reduce((max, sb) => Math.max(max, sb.number), 0);
    const newSb: StoryboardInfo = {
      number: maxNum + 1,
      name: buildUniqueName('新分镜', analysis.storyboards.map((storyboard) => storyboard.name)),
      duration: `${chapter?.storyboardDuration ?? 15}秒`,
      shotSize: '中景',
      characters: [],
    };
    dispatch({ type: 'SET_ANALYSIS', analysis: { ...analysis, storyboards: [...analysis.storyboards, newSb] } });
  };
  const deleteStoryboard = async (i: number) => {
    const removedStoryboardNumber = analysis.storyboards[i]?.number;
    const storyboardName = analysis.storyboards[i]?.name ?? `分镜 ${i + 1}`;
    if (!(await confirm(`确定删除「${storyboardName}」吗？后续分镜会重新编号，变装和道具范围也会同步调整。`))) return;
    const sbs = analysis.storyboards.filter((_, idx) => idx !== i);
    // 重新编号
    const renumbered = sbs.map((sb, idx) => ({ ...sb, number: idx + 1 }));
    const outfitTracking = removedStoryboardNumber
      ? analysis.outfitTracking
          .map((outfit) => ({ ...outfit, storyboardRange: shiftStoryboardRange(outfit.storyboardRange, removedStoryboardNumber) }))
          .filter((outfit) => outfit.storyboardRange)
      : analysis.outfitTracking;
    const propTracking = removedStoryboardNumber
      ? analysis.propTracking
          .map((prop) => withPropRangeDefaultsIfFollowingCurrentDefault(
            prop,
            shiftStoryboardRange(prop.storyboardRange, removedStoryboardNumber),
          ))
          .filter((prop) => prop.storyboardRange)
      : analysis.propTracking;
    dispatch({ type: 'SET_ANALYSIS', analysis: { ...analysis, storyboards: renumbered, outfitTracking, propTracking } });
  };

  const addOutfit = () => {
    const defaultCharacterName = analysis.allCharacterNames[0];
    if (!defaultCharacterName) {
      toast.error('请先添加角色，再补录变装');
      return;
    }
    const newOutfit: CharacterOutfit = {
      characterName: defaultCharacterName,
      outfitSeq: getNextOutfitSeqForCharacter(analysis.outfitTracking, defaultCharacterName),
      outfitDesc: '',
      storyboardRange: '',
      needsNewImage: true,
    };
    const outfitTracking = [...analysis.outfitTracking, newOutfit];
    dispatch({ type: 'SET_ANALYSIS', analysis: { ...analysis, outfitTracking } });
    setEditOutfitIdx(outfitTracking.length - 1);
    setTempOutfit(newOutfit);
  };

  const deleteOutfit = async (index: number) => {
    const outfit = analysis.outfitTracking[index];
    const label = outfit ? `${outfit.characterName} · 变装 ${outfit.outfitSeq}` : `变装记录 ${index + 1}`;
    if (!(await confirm(`确定删除「${label}」吗？对应的变装素材规划将不再自动生成。`))) return;
    const outfitTracking = analysis.outfitTracking.filter((_, currentIndex) => currentIndex !== index);
    dispatch({ type: 'SET_ANALYSIS', analysis: { ...analysis, outfitTracking } });
    if (editOutfitIdx === index) {
      setEditOutfitIdx(null);
    } else if (editOutfitIdx !== null && editOutfitIdx > index) {
      setEditOutfitIdx(editOutfitIdx - 1);
    }
  };

  const addProp = () => {
    const newProp: PropConsistency = {
      propName: buildUniqueName('新道具', analysis.propTracking.map((prop) => prop.propName)),
      appearanceDesc: '',
      size: '',
      material: '',
      shapeStructure: '',
      color: '',
      texture: '',
      condition: '',
      visualAnchor: '',
      step3Description: '',
      inferredFields: [],
      holder: analysis.allCharacterNames[0] ?? '',
      storyboardRange: '',
      stateChanges: '',
      needsTracking: false,
      needsImage: false,
    };
    const propTracking = [...analysis.propTracking, newProp];
    dispatch({ type: 'SET_ANALYSIS', analysis: { ...analysis, propTracking } });
    setEditPropIdx(propTracking.length - 1);
    setTempProp(newProp);
  };

  const deleteProp = async (index: number) => {
    const propName = analysis.propTracking[index]?.propName ?? `道具记录 ${index + 1}`;
    if (!(await confirm(`确定删除道具「${propName}」吗？对应的跨分镜追踪和图片生成需求会被移除。`))) return;
    const propTracking = analysis.propTracking.filter((_, currentIndex) => currentIndex !== index);
    dispatch({ type: 'SET_ANALYSIS', analysis: { ...analysis, propTracking } });
    if (editPropIdx === index) {
      setEditPropIdx(null);
    } else if (editPropIdx !== null && editPropIdx > index) {
      setEditPropIdx(editPropIdx - 1);
    }
  };

  const updatePropTracking = (index: number, updates: Partial<ScriptAnalysis['propTracking'][number]>) => {
    const propTracking = analysis.propTracking.map((prop, currentIndex) =>
      currentIndex === index ? { ...prop, ...updates } : prop,
    );
    dispatch({ type: 'SET_ANALYSIS', analysis: { ...analysis, propTracking } });
  };

  const togglePropNeedsTracking = (index: number, checked: boolean) => {
    updatePropTracking(index, checked ? { needsTracking: true } : { needsTracking: false, needsImage: false });
  };

  const togglePropNeedsImage = (index: number, checked: boolean) => {
    updatePropTracking(index, checked ? { needsTracking: true, needsImage: true } : { needsImage: false });
  };

  const applyAutofill = (options?: { silent?: boolean }) => {
    if (isAnalysisStale) {
      if (!options?.silent) {
        toast.error('当前脚本已修改，请先返回 Step1 重新分析后再补齐描述');
      }
      return {
        analysis,
        changed: false,
        counts: { characters: 0, scenes: 0, props: 0, total: 0 },
      };
    }

    const result = autofillAnalysisDetails(analysis, autofillSourceText);
    if (!result.changed) {
      if (!options?.silent) {
        toast.info('当前可自动补齐的描述已经齐了');
      }
      return result;
    }

    dispatch({ type: 'SET_ANALYSIS', analysis: result.analysis });

    if (!options?.silent) {
      toast.success(`已自动补齐 ${result.counts.total} 项描述`, {
        description: `角色 ${result.counts.characters} 项，场景 ${result.counts.scenes} 项，道具 ${result.counts.props} 项`,
      });
    }

    return result;
  };

  const runAiAutofill = async (options?: {
    baseAnalysis?: ScriptAnalysis;
    silent?: boolean;
  }) => {
    if (isAnalysisStale) {
      if (!options?.silent) {
        toast.error('当前脚本已修改，请先返回 Step1 重新分析后再执行 AI 补齐');
      }
      return { analysis, didRun: false };
    }

    const baseAnalysis = options?.baseAnalysis ?? applyAutofill({ silent: true }).analysis;
    const targets = buildAiAutofillTargets(baseAnalysis, autofillSourceText);
    const targetIds = targets.map((target) => target.id);
    const baseSignature = createAnalysisAutofillSignature(baseAnalysis, targetIds);

    if (targets.length === 0) {
      if (!options?.silent) {
        toast.info('没有必须 AI 补齐的阻塞项', {
          description: '剩下的弱描述属于可选优化，不会影响进入 Step3。',
        });
      }
      return { analysis: baseAnalysis, didRun: false };
    }

    if (!state.apiConfig.apiKey) {
      if (!options?.silent) {
        toast.error('请先配置 API Key（点击右上角设置按钮）');
      }
      return { analysis: baseAnalysis, didRun: false };
    }

    if (chapter?.analysisAiAutofillSignature === baseSignature) {
      if (!options?.silent) {
        toast.info('当前这一版分析已经做过 AI 补齐了');
      }
      return { analysis: baseAnalysis, didRun: false };
    }

    try {
      const response = await callAiAutofillViaBff(
        state.apiConfig,
        [{
          role: 'user',
          content: JSON.stringify({
            sourceType: chapter?.scriptType ?? 'annotated',
            sourceText: limitTextForAiAutofill(autofillSourceText || chapter?.rawScript || chapter?.adaptedScript || ''),
            targets,
          }),
        }],
        { templateType: 'analysis_autofill_patch' },
        { temperature: 0.2, maxTokens: 4000 },
      );

      const patch = parseAnalysisAutofillPatchResponse(response);
      const merged = mergeAnalysisAutofillPatch(baseAnalysis, patch);

      dispatch({
        type: 'SET_ANALYSIS',
        analysis: merged.analysis,
        aiAutofillSignature: baseSignature,
      });

      if (!options?.silent) {
        toast.success(merged.changed ? 'AI 已补齐必须项' : 'AI 已尝试补齐必须项', {
          description: merged.changed
            ? `已处理 ${merged.counts.total} 个阻塞资产：角色 ${merged.counts.characters}，场景 ${merged.counts.scenes}，道具 ${merged.counts.props}，变装 ${merged.counts.outfits ?? 0}。`
            : '模型未返回更完整的可合并字段，本版不会再自动重复补全。',
        });
      }

      return { analysis: merged.analysis, didRun: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI 补齐失败，请稍后重试';
      toast.error(message);
      return { analysis: baseAnalysis, didRun: false };
    }
  };

  const handleConfirm = async () => {
    if (confirmStep3Ref.current) return;
    confirmStep3Ref.current = true;
    setConfirmingStep3(true);
    try {
    if (isAnalysisStale) {
      toast.error('当前脚本已修改，分析结果已过期，请先重新分析后再进入 Step3');
      return;
    }

    const autofillResult = applyAutofill({ silent: true });
    const nextAnalysis = autofillResult.analysis;
    let confirmedAnalysis = nextAnalysis;
    let nextReviewOverview = getAnalysisReviewOverview({
      analysis: confirmedAnalysis,
      adaptedScript: chapter?.adaptedScript ?? '',
    });
    let validation = validateAnalysisBeforeConfirm(confirmedAnalysis);
    const confirmAiTargets = buildAiAutofillTargets(confirmedAnalysis, autofillSourceText);

    const shouldRunAiAutofill = !!state.apiConfig.apiKey && confirmAiTargets.length > 0;
    let aiAutofillExecuted = false;

    if (shouldRunAiAutofill) {
      const aiResult = await runAiAutofill({
        baseAnalysis: confirmedAnalysis,
        silent: true,
      });

      if (aiResult) {
        confirmedAnalysis = aiResult.analysis;
        aiAutofillExecuted = aiResult.didRun;
        nextReviewOverview = getAnalysisReviewOverview({
          analysis: confirmedAnalysis,
          adaptedScript: chapter?.adaptedScript ?? '',
        });
        validation = validateAnalysisBeforeConfirm(confirmedAnalysis);
      }
    }

    if (validation) {
      toast.error(validation);
      return;
    }

    const autoEntitySuggestions = resolveEntitySuggestionsForAnalysis(confirmedAnalysis)
      .filter(isEntityResolutionAutoApplicable);
    if (autoEntitySuggestions.length > 0) {
      confirmedAnalysis = applyEntityResolutions(confirmedAnalysis, autoEntitySuggestions);
      validation = validateAnalysisBeforeConfirm(confirmedAnalysis);
      if (validation) {
        toast.error(validation);
        return;
      }
      dispatch({ type: 'SET_ANALYSIS', analysis: confirmedAnalysis });
      toast.success(`已自动合并 ${autoEntitySuggestions.length} 个跨章节同名/别名实体`, {
        description: 'Step3 会按统一后的角色、场景、物品复用已有资产。',
      });
    }

    if (aiAutofillExecuted) {
      toast.success('已自动补齐必须项并继续进入 Step3', {
        description: nextReviewOverview.totalOptionalImproveCount > 0
          ? `还有 ${nextReviewOverview.totalOptionalImproveCount} 项可选优化，不影响进入 Step3。`
          : '本次进入前已自动补齐可识别的关键资产描述。',
      });
    } else if (autofillResult.changed) {
      toast.success(`已自动补齐 ${autofillResult.counts.total} 项描述并继续进入 Step3`);
    }
    if (import.meta.env.DEV) console.log('[AnalysisResult] handleConfirm', { analysisStoryboards: confirmedAnalysis?.storyboards?.length });

    // 使用 computeImageRefs 为每个分镜按需计算图片引用（与 Step4 逻辑一致）
    const sourceScriptText = resolveStoryboardSourceScriptText({
      scriptType: chapter?.scriptType ?? 'annotated',
      rawScript: chapter?.rawScript ?? '',
      adaptedScript: chapter?.adaptedScript ?? '',
      analysisSourceText: chapter?.analysisSourceText ?? '',
    });
    const sourceContexts = buildStoryboardSourceContexts(sourceScriptText, confirmedAnalysis.storyboards);
    const storyboards: StoryboardState[] = confirmedAnalysis.storyboards.map(
      (sb, idx) => ({
        storyboard: sb,
        sourceExcerpt: sourceContexts[idx]?.sourceExcerpt ?? '',
        sourceExcerptSummary: sourceContexts[idx]?.sourceExcerptSummary ?? '',
        nextStoryboardSummary: sourceContexts[idx]?.nextStoryboardSummary ?? '',
        logicFixes: [],
        correctedScript: '',
        sceneBlueprint: null,
        choreography: null,
            imageRefs: computeImageRefs(
              sb,
              confirmedAnalysis.scenes ?? [],
              currentProject?.assetLibrary,
              confirmedAnalysis.propTracking,
              idx,
              false,
              confirmedAnalysis.outfitTracking,
              confirmedAnalysis.characterProfiles,
              state.videoApiConfig.videoRatio,
            ),
        prompt: null,
        selfCheckResult: null,
        lastFrameInfo: '',
        spatialBlocking: undefined,
        continuityInput: undefined,
        continuityOutput: undefined,
        isStale: false,
        status: 'pending' as const,
      }),
    );
    dispatch({ type: 'INIT_STORYBOARDS', storyboards });
    } finally {
      confirmStep3Ref.current = false;
      setConfirmingStep3(false);
    }
  };

  const handleStyleChange = (value: string) => {
    if (analysis) {
      if (value === '__custom__') {
        // 选择“自定义”时，清空当前值让用户输入，避免 __custom__ 字面值残留
        const emptyStyle = '';
        setCustomStyle(emptyStyle);
        dispatch({
          type: 'SET_ANALYSIS',
          analysis: { ...analysis, styleConfig: emptyStyle },
          syncProjectStyle: true,
        });
      } else {
        setCustomStyle('');
        dispatch({
          type: 'SET_ANALYSIS',
          analysis: { ...analysis, styleConfig: value },
          syncProjectStyle: true,
        });
      }
    }
  };

  // ---- 改编剧本编辑 ----
  const startEditAdaptedScript = () => {
    setTempAdaptedScript(chapter?.adaptedScript ?? '');
    setEditingAdaptedScript(true);
  };
  const persistAdaptedScript = (options?: { returnToStep1?: boolean }) => {
    const trimmed = tempAdaptedScript.trim();
    if (!trimmed) {
      toast.error('改编稿不能为空');
      return false;
    }
    const previous = chapter?.adaptedScript?.trim() ?? '';
    const changed = trimmed !== previous;
    dispatch({ type: 'SET_ADAPTED_SCRIPT', script: trimmed });
    setTempAdaptedScript(trimmed);
    setEditingAdaptedScript(false);
    if (options?.returnToStep1) {
      dispatch({ type: 'SET_CHAPTER_STATUS', status: 'idle' });
      toast.success(changed ? '改编稿已保存，已返回 Step1 重新分析' : '已返回 Step1，可重新分析改编稿');
      return true;
    }
    if (changed) {
      toast.warning('改编稿已保存，当前分析已标记为待重分析');
    } else {
      toast.success('改编稿未发生变化');
    }
    return true;
  };
  const saveAdaptedScript = () => {
    persistAdaptedScript();
  };
  const saveAdaptedScriptAndReturnToStep1 = () => {
    persistAdaptedScript({ returnToStep1: true });
  };
  const restoreAnalyzedAdaptedScript = () => {
    const snapshot = chapter?.analysisSourceText?.trim();
    if (!snapshot) {
      toast.error('当前没有可恢复的分析版本脚本');
      return;
    }
    dispatch({ type: 'SET_ADAPTED_SCRIPT', script: snapshot });
    setTempAdaptedScript(snapshot);
    setEditingAdaptedScript(false);
    toast.success('已恢复到当前分析对应的改编稿版本');
  };

  const saveStoryboardSourceText = (storyboardNumber: number | string, nextSectionText: string) => {
    if (!analysis || !chapter) return false;
    const nextSection = nextSectionText.trim();
    if (!nextSection) {
      toast.error('分镜原文不能为空');
      return false;
    }

    const sourceText = chapter.analysisSourceText || chapter.adaptedScript || chapter.rawScript;
    const nextSourceText = replaceStoryboardSourceText(sourceText, storyboardNumber, nextSection);
    if (nextSourceText === sourceText) {
      toast.error(`没有找到分镜 ${storyboardNumber} 对应的原文段落，暂时无法替换`);
      return false;
    }

    if (chapter.scriptType === 'novel') {
      dispatch({ type: 'SET_ADAPTED_SCRIPT', script: nextSourceText });
    } else {
      dispatch({ type: 'SET_RAW_SCRIPT', script: nextSourceText });
    }
    dispatch({ type: 'SET_ANALYSIS', analysis, sourceText: nextSourceText });
    toast.success(`已更新分镜 ${storyboardNumber} 的剧本原文`);
    return true;
  };

  // ---- 重新分析 ----
  const handleReanalyze = () => {
    // 回到 Step1 输入状态，用户可修改剧本后重新分析
    dispatch({ type: 'SET_CHAPTER_STATUS', status: 'idle' });
  };

  return (
    <div className="space-y-6">
      {/* 项目名称 & 风格配置 */}
      <Card className={ENABLE_NEXT_UI_PREVIEW ? 'surface-panel step2-next-overview-card border-white/70' : 'surface-panel border-white/70'}>
        <CardHeader className={ENABLE_NEXT_UI_PREVIEW ? 'step2-next-overview-header' : undefined}>
          <CardTitle className="flex items-center gap-2">
            <span className={ENABLE_NEXT_UI_PREVIEW ? 'step2-next-step-badge flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground' : 'flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground'}>
              {ENABLE_NEXT_UI_PREVIEW ? '02' : '2'}
            </span>
            {ENABLE_NEXT_UI_PREVIEW ? '分析复核台' : '剧本分析结果'}
          </CardTitle>
        </CardHeader>
        <CardContent className={ENABLE_NEXT_UI_PREVIEW ? 'step2-next-overview-content space-y-4' : 'space-y-6'}>
          {/* 项目信息 */}
          {ENABLE_NEXT_UI_PREVIEW ? (
            <div className="step2-next-meta-grid">
              <div className="step2-next-meta-card step2-next-global-style" title={styleDisplayLabel}>
                <div className="step2-next-style-head">
                  <div>
                    <Label>全局视觉风格</Label>
                    <p className="step2-next-style-hint">项目级，修改后同步本项目全部集数</p>
                  </div>
                  <div className="step2-next-style-actions">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="step2-next-custom-button"
                      onClick={() => handleStyleChange('__custom__')}
                    >
                      自定义
                    </Button>
                  </div>
                </div>
                <Select
                  value={analysis.styleConfig && analysis.styleConfig !== '__custom__' && !isCustomStyle(analysis.styleConfig) ? analysis.styleConfig : '__custom__'}
                  onValueChange={handleStyleChange}
                >
                  <SelectTrigger className="step2-next-style-trigger">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STYLE_PRESETS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                    <SelectItem value="__custom__">自定义</SelectItem>
                  </SelectContent>
                </Select>
                {isCustomStyle(analysis.styleConfig) && (
                  <Input
                    className="step2-next-custom-style"
                    value={analysis.styleConfig === '__custom__' ? customStyle : analysis.styleConfig}
                    placeholder="输入自定义风格，例如：写实仿真人古装偶像剧 S+ 质感"
                    onChange={(e) => {
                      setCustomStyle(e.target.value);
                      dispatch({
                        type: 'SET_ANALYSIS',
                        analysis: {
                          ...analysis,
                          styleConfig: e.target.value,
                        },
                        syncProjectStyle: true,
                      });
                    }}
                  />
                )}
              </div>
              <div className="step2-next-meta-card step2-next-project-card">
                <Label>项目名称</Label>
                <Input
                  value={analysis.projectName}
                  onChange={(e) =>
                    dispatch({
                      type: 'SET_ANALYSIS',
                      analysis: { ...analysis, projectName: e.target.value },
                    })
                  }
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>项目名称</Label>
                <Input
                  value={analysis.projectName}
                  onChange={(e) =>
                    dispatch({
                      type: 'SET_ANALYSIS',
                      analysis: { ...analysis, projectName: e.target.value },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>视觉风格配置</Label>
                <p className="text-xs text-muted-foreground">项目级，修改后同步本项目全部集数</p>
                <Select
                  value={analysis.styleConfig && analysis.styleConfig !== '__custom__' ? analysis.styleConfig : '__custom__'}
                  onValueChange={handleStyleChange}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STYLE_PRESETS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                    <SelectItem value="__custom__">✨ 自定义</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* 自定义风格 */}
          {(!ENABLE_NEXT_UI_PREVIEW && isCustomStyle(analysis.styleConfig)) && (
            <div className="space-y-2">
              <Label>自定义风格描述</Label>
              <Input
                value={analysis.styleConfig === '__custom__' ? customStyle : analysis.styleConfig}
                placeholder="例如：写实仿真人赛博朋克科幻电影质感"
                onChange={(e) => {
                  setCustomStyle(e.target.value);
                  dispatch({
                    type: 'SET_ANALYSIS',
                    analysis: {
                      ...analysis,
                      styleConfig: e.target.value,
                    },
                    syncProjectStyle: true,
                  });
                }}
              />
            </div>
          )}

          {ENABLE_NEXT_UI_PREVIEW ? (
            <details className="step2-next-guidance">
              <summary>
                <span>复核提示</span>
                <span>{analysis.summary ? '含分析摘要与补全规则' : '查看补全规则'}</span>
              </summary>
              <div className="step2-next-guidance-body">
                {analysis.summary && (
                  <p>
                    <strong>分析摘要：</strong>
                    {analysis.summary}
                  </p>
                )}
                <p>
                  <strong>复核重点：</strong>
                  优先看人物身份、场景环境、服装连续性、关键道具是否会影响出图。
                </p>
              </div>
            </details>
          ) : (
            <>
              {/* 摘要 */}
              {analysis.summary && (
                <div className="rounded-xl border border-white/60 bg-muted/50 p-3 shadow-sm">
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    📋 分析摘要
                  </p>
                  <p className="text-sm">{analysis.summary}</p>
                </div>
              )}

              <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 shadow-sm dark:border-amber-400/30 dark:bg-amber-500/10">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                  🔍 Step2 重点复核说明
                </p>
                <p className="mt-1 text-sm text-amber-800/90 dark:text-amber-200/90">
                  当原剧本或小说对人物、场景、物品写得较粗时，Step1 / 改编会在不改变剧情事实的前提下做保守的视觉补全。这里请重点复核场景环境、服装描述、道具外观，以及网文模式下“人物一致性”里的角色细节。
                </p>
              </div>
            </>
          )}

          {!ENABLE_NEXT_UI_PREVIEW && (
            <CharacterVoiceReferencePanel
              characters={analysis.allCharacterNames}
              characterProfiles={analysis.characterProfiles}
              projectSummary={analysis.summary}
              projectStyle={effectiveProjectStyleConfig}
              compact
            />
          )}

          {(!ENABLE_NEXT_UI_PREVIEW || entityResolutionSuggestions.length > 0) && (
            <EntityResolutionPanel
              suggestions={entityResolutionSuggestions}
              highConfidenceSuggestions={highConfidenceEntityResolutionSuggestions}
              hasComparableChapterAnalysis={hasComparableChapterAnalysis}
              isAnalysisStale={isAnalysisStale}
              onMergeHighConfidence={mergeHighConfidenceEntitySuggestions}
              onDismiss={dismissEntityResolutionSuggestion}
              onMerge={mergeEntityResolutionSuggestion}
            />
          )}

          {hasReviewOverview && (
            <div className={ENABLE_NEXT_UI_PREVIEW ? 'step2-next-review-overview rounded-xl border border-sky-200 bg-sky-50/80 p-4 shadow-sm dark:border-sky-400/30 dark:bg-sky-500/10' : 'rounded-xl border border-sky-200 bg-sky-50/80 p-4 shadow-sm dark:border-sky-400/30 dark:bg-sky-500/10'}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-sky-900 dark:text-sky-100">
                  🧭 资产复核总览
                </p>
                {ENABLE_NEXT_UI_PREVIEW ? (
                  <Badge
                    variant="outline"
                    className={reviewOverview.totalBlockingCount > 0
                      ? 'step2-next-review-pill is-blocking'
                      : 'step2-next-review-pill is-clear'}
                  >
                    {reviewOverview.totalBlockingCount > 0
                      ? `需补齐 ${reviewOverview.totalBlockingCount}`
                      : '可进入 Step3'}
                  </Badge>
                ) : (
                  <>
                    <Badge variant="outline" className="border-amber-200 bg-white/70 text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-100">
                      必须补齐 {reviewOverview.totalBlockingCount}
                    </Badge>
                    <Badge variant="outline" className="border-sky-200 bg-white/70 text-sky-800 dark:border-sky-400/30 dark:bg-sky-500/15 dark:text-sky-100">
                      建议优化 {reviewOverview.totalOptionalImproveCount}
                    </Badge>
                    <Badge variant="outline" className="border-violet-200 bg-white/70 text-violet-800 dark:border-violet-400/30 dark:bg-violet-500/15 dark:text-violet-100">
                      AI 已补 {reviewOverview.totalInferredCount}
                    </Badge>
                  </>
                )}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {autofillPreview.counts.total > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-sky-200 bg-white/80 text-xs text-sky-800 hover:bg-sky-50 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-100"
                      onClick={() => applyAutofill()}
                      disabled={aiAutofillLoading || isAnalysisStale}
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" />
                      自动补齐描述（{autofillPreview.counts.total}）
                    </Button>
                  )}
                  {(!ENABLE_NEXT_UI_PREVIEW ||
                    reviewOverview.totalBlockingCount > 0 ||
                    aiAutofillLoading ||
                    !!aiAutofillError) && (
                    <Button
                      size="sm"
                      variant={hasFreshAiAutofill || reviewOverview.totalBlockingCount === 0 ? 'outline' : 'default'}
                      className={hasFreshAiAutofill || reviewOverview.totalBlockingCount === 0
                        ? 'h-7 border-sky-200 bg-white/80 px-3 text-xs text-sky-800 hover:bg-sky-50 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-100'
                        : 'h-7 bg-sky-600 px-3 text-xs text-white hover:bg-sky-700'}
                      onClick={() => {
                        void runAiAutofill();
                      }}
                      disabled={aiAutofillLoading || hasFreshAiAutofill || isAnalysisStale || reviewOverview.totalBlockingCount === 0}
                    >
                      {aiAutofillLoading ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : reviewOverview.totalBlockingCount === 0 ? (
                        <Check className="mr-1 h-3.5 w-3.5" />
                      ) : (
                        <RotateCcw className="mr-1 h-3.5 w-3.5" />
                      )}
                      {isAnalysisStale
                        ? '请先重新分析'
                        : reviewOverview.totalBlockingCount === 0
                          ? '无需 AI 补齐（0）'
                          : (hasFreshAiAutofill ? '阻塞项已尝试补齐' : `AI 补齐必须项（${aiAutofillTargets.length}）`)}
                    </Button>
                  )}
                </div>
                {reviewOverview.totalBlockingCount === 0
                  && (reviewOverview.totalOptionalImproveCount > 0 || reviewOverview.totalInferredCount > 0)
                  && (
                    <p className="basis-full text-xs text-sky-700/80 dark:text-sky-200/80">
                      当前没有阻塞 Step3 的必须项；AI 补齐入口已保留为状态提示。建议优化和已补字段不影响直接进入 Step3。
                    </p>
                  )}
              </div>
              <div className="mt-3 rounded-lg border border-white/70 bg-white/70 p-2 shadow-sm dark:border-slate-700/70 dark:bg-slate-950/35">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-1 text-xs font-medium text-sky-900 dark:text-sky-100">
                    复核筛选
                  </span>
                  {visibleReviewFilterOptions.map((option) => {
                    const active = reviewFilter === option.value;
                    return (
                      <Button
                        key={option.value}
                        type="button"
                        size="sm"
                        variant={active ? 'default' : 'outline'}
                        className={active
                          ? 'h-7 px-2.5 text-xs'
                          : 'h-7 border-sky-100 bg-white/70 px-2.5 text-xs text-sky-800 hover:bg-sky-50 dark:border-sky-400/20 dark:bg-slate-950/30 dark:text-sky-100'}
                        title={option.description}
                        onClick={() => setReviewFilter(option.value)}
                      >
                        {option.label}
                        <span className="ml-1 rounded-full bg-black/10 px-1.5 text-[10px] dark:bg-white/15">
                          {reviewFilterCounts[option.value]}
                        </span>
                      </Button>
                    );
                  })}
                </div>
                {isReviewFilterActive && (
                  <p className="mt-2 px-1 text-xs text-sky-700/80 dark:text-sky-200/80">
                    当前只显示“{reviewFilterLabel}”相关资产项，方便快速扫完待处理内容。
                  </p>
                )}
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {reviewOverview.sections.map((section) => (
                  <div
                    key={section.key}
                    className="rounded-lg border border-white/70 bg-white/70 p-3 text-sm shadow-sm dark:border-slate-700/70 dark:bg-slate-950/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-900 dark:text-slate-100">{section.label}</span>
                      <div className="flex shrink-0 gap-1">
                        {section.needsReviewCount > 0 && (
                          <Badge variant="secondary" className="text-[11px]">
                            必须 {section.needsReviewCount}
                          </Badge>
                        )}
                        {section.optionalImproveCount > 0 && (
                          <Badge variant="outline" className="text-[11px]">
                            建议 {section.optionalImproveCount}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      AI 已补 {section.inferredCount} 项
                    </p>
                    {(section.examples.length > 0 || section.optionalExamples.length > 0) && (
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        例如：{(section.examples.length > 0 ? section.examples : section.optionalExamples).join('、')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {reviewOverview.priorityActions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {reviewOverview.priorityActions.map((action) => (
                    <Badge
                      key={action}
                      variant="outline"
                      className="border-amber-200 bg-amber-50 text-[11px] text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-200"
                    >
                      优先：{action}
                    </Badge>
                  ))}
                </div>
              )}
              {(aiAutofillLoading || aiAutofillTextLength > 0 || aiAutofillError) && (
                <div className="mt-4 rounded-lg border border-sky-200/80 bg-white/75 p-3 shadow-sm dark:border-sky-400/20 dark:bg-slate-950/40">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-sky-900 dark:text-sky-100">
                      AI 补齐过程反馈
                    </p>
                    <span className="text-[11px] text-sky-700/80 dark:text-sky-200/80">
                      {aiAutofillLoading ? '正在流式补全，300 秒无活动才超时' : '已完成本次输出'}
                    </span>
                  </div>
                  <div className="mt-2 rounded-md bg-slate-950 px-3 py-2 text-[11px] leading-5 text-slate-100">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {aiAutofillLoading ? 'AI 补齐进行中' : 'AI 补齐已完成'}
                      </span>
                      <span className="text-slate-300">
                        已接收 {aiAutofillTextLength} 字
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full rounded-full ${aiAutofillLoading ? 'animate-pulse bg-sky-400/80' : 'bg-sky-500/80'}`}
                        style={{ width: `${aiAutofillTextLength > 0 ? Math.min(100, Math.max(18, 10 + Math.log10(aiAutofillTextLength + 1) * 18)) : 12}%` }}
                      />
                    </div>
                    <p className="mt-2 text-slate-300">
                      {aiAutofillLoading
                        ? '这里只显示字符数进度，不展开正文。只要内容或思考活动持续流动，就不会触发 300 秒空闲超时。'
                        : '本次已完成，展示的只是字数进度。'}
                    </p>
                  </div>
                  {aiAutofillError && (
                    <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">
                      {aiAutofillError}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 场景关联分析 */}
          {analysis.sceneRelations && (
            ENABLE_NEXT_UI_PREVIEW ? (
              <details className="step2-next-fold-note step2-next-fold-note-scene">
                <summary>
                  <span>🔗 场景关联分析</span>
                  <span className="step2-next-fold-state">
                    <span>展开</span>
                    <span>收起</span>
                  </span>
                </summary>
                <p>{analysis.sceneRelations}</p>
              </details>
            ) : (
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 shadow-sm dark:bg-blue-950/20">
                <p className="mb-1 text-sm font-medium text-muted-foreground">
                  🔗 场景关联分析
                </p>
                <p className="text-sm">{analysis.sceneRelations}</p>
              </div>
            )
          )}

          {/* 跨集道具继承 */}
          {analysis.propInheritance && (
            ENABLE_NEXT_UI_PREVIEW ? (
              <details className="step2-next-fold-note step2-next-fold-note-prop">
                <summary>
                  <span>🎒 跨集道具状态继承</span>
                  <span className="step2-next-fold-state">
                    <span>展开</span>
                    <span>收起</span>
                  </span>
                </summary>
                <p>{analysis.propInheritance}</p>
              </details>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 shadow-sm dark:bg-amber-950/20">
                <p className="mb-1 text-sm font-medium text-muted-foreground">
                  🎒 跨集道具状态继承
                </p>
                <p className="text-sm">{analysis.propInheritance}</p>
              </div>
            )
          )}

          {/* 改编后的分镜剧本（网文模式） */}
          {chapter?.scriptType === 'novel' && chapter.adaptedScript && (
            <details className="group rounded-md border bg-muted/30" open={editingAdaptedScript} onToggle={(e) => {
              const isOpen = (e.target as HTMLDetailsElement).open;
              if (!isOpen) setEditingAdaptedScript(false);
            }}>
              <summary className="flex min-w-0 cursor-pointer items-center gap-2 p-3 text-sm font-medium transition-colors rounded-t-xl hover:bg-muted/50">
                <BookOpen className="h-4 w-4 shrink-0 text-violet-500" />
                <span className="shrink-0">改编后的分镜剧本</span>
                <span className="ml-1 min-w-0 truncate text-xs text-muted-foreground">
                  （由网文自动改编，{chapter.adaptedScript.length} 字符）
                </span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground group-open:hidden">▼ 展开</span>
                <span className="ml-auto hidden shrink-0 text-xs text-muted-foreground group-open:inline">▲ 收起</span>
              </summary>
              <div className="border-t p-3 space-y-2 bg-background/60 rounded-b-xl">
                {editingAdaptedScript ? (
                  <>
                    <Textarea
                      value={tempAdaptedScript}
                      onChange={(e) => setTempAdaptedScript(e.target.value)}
                      className="min-h-[300px] text-xs font-mono"
                    />
                    {isAnalysisStale && (
                      <p className="text-xs text-amber-700 dark:text-amber-200">
                        当前展示的是已修改稿，和这页分析结果不是同一版本。保存后请返回 Step1 重新分析。
                      </p>
                    )}
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => setEditingAdaptedScript(false)}>
                        <X className="h-3.5 w-3.5 mr-1" />取消
                      </Button>
                      <Button size="sm" variant="outline" onClick={saveAdaptedScript}>
                        <Check className="h-3.5 w-3.5 mr-1" />保存修改
                      </Button>
                      <Button size="sm" onClick={saveAdaptedScriptAndReturnToStep1}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />保存并返回 Step1
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <pre className="whitespace-pre-wrap break-words text-xs text-muted-foreground font-mono max-h-[400px] overflow-y-auto">
                      {chapter.adaptedScript}
                    </pre>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={startEditAdaptedScript}>
                        <Pencil className="h-3.5 w-3.5 mr-1" />编辑改编结果
                      </Button>
                      <Button size="sm" onClick={handleReanalyze}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />返回 Step1 重新分析
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      {isAnalysisStale && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/90 p-4 text-amber-900 shadow-sm dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
          <p className="text-sm font-medium">
            当前改编稿已修改，Step2 和 Step3 仍基于旧分析结果。请先重新分析，再继续进入 Step3。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={handleReanalyze}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              返回 Step1 重新分析
            </Button>
            {chapter?.scriptType === 'novel' && chapter.analysisSourceText?.trim() && (
              <Button size="sm" variant="outline" onClick={restoreAnalyzedAdaptedScript}>
                恢复到当前分析版本
              </Button>
            )}
          </div>
        </div>
      )}

      <AnalysisResultTabs
        analysis={analysis}
        adaptedScript={chapter?.adaptedScript ?? ''}
        analysisSourceText={chapter?.analysisSourceText ?? chapter?.adaptedScript ?? chapter?.rawScript ?? ''}
        saveStoryboardSourceText={saveStoryboardSourceText}
        isReviewFilterActive={isReviewFilterActive}
        reviewFilterLabel={reviewFilterLabel}
        visibleSceneItems={visibleSceneItems}
        visibleCharacterItems={visibleCharacterItems}
        visibleOutfitItems={visibleOutfitItems}
        visiblePropItems={visiblePropItems}
        editSceneIdx={editSceneIdx}
        setEditSceneIdx={setEditSceneIdx}
        tempScene={tempScene}
        setTempScene={setTempScene}
        startEditScene={startEditScene}
        saveScene={saveScene}
        addScene={addScene}
        deleteScene={deleteScene}
        editCharIdx={editCharIdx}
        setEditCharIdx={setEditCharIdx}
        tempChar={tempChar}
        setTempChar={setTempChar}
        tempCharacterProfile={tempCharacterProfile}
        setTempCharacterProfile={setTempCharacterProfile}
        startEditChar={startEditChar}
        saveChar={saveChar}
        saveCharacterProfile={saveCharacterProfile}
        addChar={addChar}
        deleteChar={deleteChar}
        editSbIdx={editSbIdx}
        setEditSbIdx={setEditSbIdx}
        tempSb={tempSb}
        setTempSb={setTempSb}
        startEditSb={startEditSb}
        saveSb={saveSb}
        addStoryboard={addStoryboard}
        deleteStoryboard={deleteStoryboard}
        editOutfitIdx={editOutfitIdx}
        setEditOutfitIdx={setEditOutfitIdx}
        tempOutfit={tempOutfit}
        setTempOutfit={setTempOutfit}
        startEditOutfit={startEditOutfit}
        saveOutfit={saveOutfit}
        addOutfit={addOutfit}
        deleteOutfit={deleteOutfit}
        editPropIdx={editPropIdx}
        setEditPropIdx={setEditPropIdx}
        tempProp={tempProp}
        setTempProp={setTempProp}
        startEditProp={startEditProp}
        saveProp={saveProp}
        addProp={addProp}
        deleteProp={deleteProp}
        togglePropNeedsTracking={togglePropNeedsTracking}
        togglePropNeedsImage={togglePropNeedsImage}
      />

      {/* 操作按钮 */}
      <div className="surface-panel sticky bottom-3 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-200/70 bg-background/90 px-4 py-3 shadow-2xl backdrop-blur supports-[backdrop-filter]:bg-background/80 dark:border-orange-400/25">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {reviewOverview.totalBlockingCount > 0
              ? `仍有 ${reviewOverview.totalBlockingCount} 个必须项，点击确认会先尝试自动补齐`
              : '复核完成后可直接进入图片资产'}
          </p>
          {ENABLE_NEXT_UI_PREVIEW ? (
            isReviewFilterActive && (
              <p className="mt-1 text-xs text-muted-foreground">
                当前筛选：{reviewFilterLabel}
              </p>
            )
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              {isReviewFilterActive ? `当前筛选：${reviewFilterLabel} · ` : ''}
              建议优化 {reviewOverview.totalOptionalImproveCount} · AI 已补 {reviewOverview.totalInferredCount}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={handleReanalyze}
            className="gap-1.5"
          >
            <RotateCcw className="h-4 w-4" />
            重新分析
          </Button>
          <Button
            size="lg"
            onClick={handleConfirm}
            className="min-w-[220px] bg-orange-600 text-white hover:bg-orange-700"
            disabled={aiAutofillLoading || confirmingStep3}
          >
            {aiAutofillLoading || confirmingStep3 ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                正在自动补齐并进入…
              </>
            ) : '确认并进入 Step3'}
          </Button>
        </div>
      </div>
      {ConfirmDialog}
    </div>
  );
}
