const crypto = require('crypto');
const {
  getCloudProjectSnapshot,
  putCloudProjectSnapshot,
} = require('./cloud-store');
const { getEffectiveAgentDefaultsForUser } = require('./commercial-settings');
const { updateJob } = require('./background-jobs');
const { runImageGenerationJob } = require('./image-job-handlers');

const CHARACTER_CONCEPTS = ['portrait_closeup', 'landscape_turnaround'];
const OUTFIT_CONCEPTS = ['portrait_outfit', 'landscape_outfit_turnaround'];
const SCENE_CONCEPTS = ['scene_main'];
const PROP_CONCEPTS = ['prop_main'];
const CONCEPT_ASPECT_RATIO = {
  portrait_closeup: 'PORTRAIT',
  portrait_outfit: 'PORTRAIT',
  landscape_turnaround: 'LANDSCAPE',
  landscape_outfit_turnaround: 'LANDSCAPE',
  scene_main: 'LANDSCAPE',
  scene_vertical: 'PORTRAIT',
  prop_main: 'LANDSCAPE',
};

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text || fallback;
}

function mergeMissing(target, defaults) {
  const next = { ...(asObject(target)) };
  Object.entries(defaults || {}).forEach(([key, value]) => {
    if (next[key] === undefined || next[key] === null || next[key] === '') next[key] = value;
  });
  return next;
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;
}

function getChapter(snapshot, chapterId) {
  const chapters = asArray(snapshot?.project?.chapters);
  if (chapterId) return chapters.find((chapter) => chapter?.id === chapterId) || null;
  const currentChapterId = snapshot?.project?.currentChapterId;
  return chapters.find((chapter) => chapter?.id === currentChapterId) || chapters[0] || null;
}

function getPropIdentityKey(prop) {
  return getText(prop.trackingId)
    || [
      getText(prop.propName),
      getText(prop.holder),
      getText(prop.storyboardRange),
      getText(prop.visualAnchor),
    ].filter(Boolean).join('|')
    || getText(prop.propName);
}

function getAssetSlotKey(asset) {
  const identity = asset.type === 'prop' && asset.identityKey ? asset.identityKey : asset.name;
  const variant = asset.type === 'character'
    ? asset.variantKey || (typeof asset.outfitSeq === 'number' ? `outfit-${asset.outfitSeq}` : 'base')
    : '';
  return `${asset.type}::${identity}::${asset.concept}::${variant}`;
}

function getSlotKey(slot) {
  return getAssetSlotKey({
    type: slot.type,
    name: slot.name,
    concept: slot.concept,
    identityKey: slot.identityKey,
    variantKey: slot.variantKey,
    outfitSeq: slot.outfitSeq,
  });
}

function findExistingAsset(assetLibrary, slot) {
  const slotKey = getSlotKey(slot);
  return asArray(assetLibrary).find((asset) => getAssetSlotKey(asset) === slotKey && getText(asset.blobKey));
}

function hasUsefulText(value) {
  return getText(value).length >= 2;
}

function getProfileDescription(profile) {
  return [
    getText(profile.step3Description),
    getText(profile.description),
    getText(profile.ageAppearance),
    getText(profile.temperament),
    getText(profile.bodyBuild),
    getText(profile.faceFeatures),
    getText(profile.hairStyle),
    getText(profile.skinTone),
    getText(profile.defaultOutfit),
    getText(profile.accessories),
    getText(profile.visualAnchor),
  ].filter(Boolean).join('；');
}

function getSceneDescription(scene) {
  return [
    getText(scene.step3Description),
    getText(scene.environment),
    getText(scene.layout),
    getText(scene.keySetPieces),
    getText(scene.lighting),
    getText(scene.weather),
    getText(scene.colorTone),
    getText(scene.atmosphere),
  ].filter(Boolean).join('；');
}

function getPropDescription(prop) {
  return [
    getText(prop.step3Description),
    getText(prop.appearanceDesc),
    getText(prop.size),
    getText(prop.material),
    getText(prop.shapeStructure),
    getText(prop.color),
    getText(prop.texture),
    getText(prop.condition),
    getText(prop.visualAnchor),
    getText(prop.stateChanges),
  ].filter(Boolean).join('；');
}

function buildCharacterPrompt(slot, styleConfig) {
  const isLandscape = slot.concept === 'landscape_turnaround' || slot.concept === 'landscape_outfit_turnaround';
  const outfitLine = slot.outfitDesc ? `Outfit variant lock: ${slot.outfitDesc}.` : '';
  return [
    `${styleConfig || 'project visual style'}, high-quality production reference image.`,
    `Character identity: ${slot.name}.`,
    `Visual lock: ${slot.description}.`,
    outfitLine,
    isLandscape
      ? 'Create a clean 16:9 character reference sheet: front full body, back full body, face close-up, costume/material detail panels, neutral readable pose, no storyboard frames, no arrows, no UI, no subtitles, no watermark.'
      : 'Create a clean 9:16 portrait close-up / bust reference: clear face identity, hair, age, temperament, upper-body outfit material, neutral pose, no text, no watermark.',
    'Keep the character alone. Do not add other named characters, dialogue text, logo, panel number, or random readable words.',
  ].filter(Boolean).join('\n');
}

function buildScenePrompt(slot, styleConfig) {
  return [
    `${styleConfig || 'project visual style'}, high-quality 16:9 environment/set design reference.`,
    `Scene: ${slot.name}.`,
    `Environment lock: ${slot.description}.`,
    'Create an empty reusable scene reference: architecture, layout, light direction, material, spatial anchors, camera blocking readability.',
    'No people, no silhouettes, no character action, no storyboard frames, no labels, no subtitles, no logo, no watermark, no random readable text.',
  ].join('\n');
}

function buildPropPrompt(slot, styleConfig) {
  return [
    `${styleConfig || 'project visual style'}, high-quality 16:9 prop reference sheet.`,
    `Prop: ${slot.name}.`,
    `Prop lock: ${slot.description}.`,
    'Create a reusable prop design sheet: main view, side/detail views, material close-up, scale readability, clean studio lighting.',
    'No character holding it unless scale needs a plain anonymous hand silhouette; no storyboard frames, no labels, no subtitles, no logo, no watermark.',
  ].join('\n');
}

function buildPrompt(slot, styleConfig) {
  if (slot.type === 'scene') return buildScenePrompt(slot, styleConfig);
  if (slot.type === 'prop') return buildPropPrompt(slot, styleConfig);
  return buildCharacterPrompt(slot, styleConfig);
}

function shouldUseCharacterProfile(profile) {
  return hasUsefulText(profile.name) && hasUsefulText(getProfileDescription(profile));
}

function shouldUseScene(scene) {
  return hasUsefulText(scene.name) && hasUsefulText(getSceneDescription(scene));
}

function shouldUseProp(prop, includeOneShotProps) {
  if (!hasUsefulText(prop.propName) || !hasUsefulText(getPropDescription(prop))) return false;
  return includeOneShotProps || prop.needsImage === true || prop.needsTracking === true;
}

function normalizeConceptList(value, fallback) {
  const allowed = new Set([...CHARACTER_CONCEPTS, ...OUTFIT_CONCEPTS, ...SCENE_CONCEPTS, 'scene_vertical', ...PROP_CONCEPTS]);
  const list = asArray(value).map(getText).filter((item) => allowed.has(item));
  return list.length ? list : fallback;
}

function buildSlots(analysis, input = {}) {
  const includeOneShotProps = input.includeOneShotProps === true;
  const characterConcepts = normalizeConceptList(input.characterConcepts, CHARACTER_CONCEPTS);
  const sceneConcepts = normalizeConceptList(input.sceneConcepts, SCENE_CONCEPTS);
  const propConcepts = normalizeConceptList(input.propConcepts, PROP_CONCEPTS);
  const outfitConcepts = normalizeConceptList(input.outfitConcepts, OUTFIT_CONCEPTS);
  const slots = [];
  const seen = new Set();
  const addSlot = (slot) => {
    const key = getSlotKey(slot);
    if (seen.has(key)) return;
    seen.add(key);
    slots.push({ ...slot, key });
  };

  for (const profile of asArray(analysis.characterProfiles)) {
    if (!shouldUseCharacterProfile(profile)) continue;
    const description = getProfileDescription(profile);
    for (const concept of characterConcepts) {
      addSlot({
        type: 'character',
        name: getText(profile.name),
        concept,
        description,
        generationMode: 'txt2img',
        aspectRatio: CONCEPT_ASPECT_RATIO[concept] || 'PORTRAIT',
        isDefault: concept === 'portrait_closeup',
      });
    }
  }

  for (const outfit of asArray(analysis.outfitTracking)) {
    if (outfit.needsNewImage !== true) continue;
    if (!hasUsefulText(outfit.characterName) || !hasUsefulText(outfit.outfitDesc)) continue;
    const profile = asArray(analysis.characterProfiles).find((item) => getText(item.name) === getText(outfit.characterName));
    const description = [getProfileDescription(profile || {}), getText(outfit.outfitDesc)].filter(Boolean).join('；');
    const outfitSeq = Number(outfit.outfitSeq);
    const variantKey = Number.isFinite(outfitSeq) ? `outfit-${outfitSeq}` : undefined;
    for (const concept of outfitConcepts) {
      addSlot({
        type: 'character',
        name: getText(outfit.characterName),
        concept,
        description,
        outfitDesc: getText(outfit.outfitDesc),
        outfitSeq: Number.isFinite(outfitSeq) ? outfitSeq : undefined,
        variantKey,
        generationMode: 'txt2img',
        aspectRatio: CONCEPT_ASPECT_RATIO[concept] || 'PORTRAIT',
        isDefault: false,
      });
    }
  }

  for (const scene of asArray(analysis.scenes)) {
    if (!shouldUseScene(scene)) continue;
    for (const concept of sceneConcepts) {
      addSlot({
        type: 'scene',
        name: getText(scene.name),
        concept,
        description: getSceneDescription(scene),
        generationMode: 'txt2img',
        aspectRatio: CONCEPT_ASPECT_RATIO[concept] || 'LANDSCAPE',
      });
    }
  }

  for (const prop of asArray(analysis.propTracking)) {
    if (!shouldUseProp(prop, includeOneShotProps)) continue;
    const identityKey = getPropIdentityKey(prop);
    for (const concept of propConcepts) {
      addSlot({
        type: 'prop',
        name: getText(prop.propName),
        concept,
        identityKey,
        description: getPropDescription(prop),
        generationMode: 'txt2img',
        aspectRatio: CONCEPT_ASPECT_RATIO[concept] || 'LANDSCAPE',
      });
    }
  }

  return slots;
}

function mergeGeneratedAsset(project, asset) {
  const assetLibrary = asArray(project.assetLibrary);
  const existingIndex = assetLibrary.findIndex((item) => getAssetSlotKey(item) === getAssetSlotKey(asset));
  if (existingIndex >= 0) {
    const next = [...assetLibrary];
    next[existingIndex] = {
      ...next[existingIndex],
      ...asset,
      id: next[existingIndex].id || asset.id,
      createdAt: next[existingIndex].createdAt || asset.createdAt,
      updatedAt: asset.updatedAt,
    };
    project.assetLibrary = next;
  } else {
    project.assetLibrary = [...assetLibrary, asset];
  }
}

function relinkStoryboards(project, asset) {
  for (const chapter of asArray(project.chapters)) {
    chapter.storyboards = asArray(chapter.storyboards).map((storyboard) => {
      const refs = asArray(storyboard.imageRefs);
      if (!refs.length) return storyboard;
      let changed = false;
      const imageRefs = refs.map((ref) => {
        if (ref.assetBindingMode === 'manual') return ref;
        const sameType = ref.type === asset.type;
        const sameName = ref.name === asset.name;
        const sameProp = asset.type === 'prop' && ref.trackingId && ref.trackingId === asset.identityKey;
        const refVariant = ref.variantKey || (typeof ref.outfitSeq === 'number' ? `outfit-${ref.outfitSeq}` : '');
        const assetVariant = asset.variantKey || (typeof asset.outfitSeq === 'number' ? `outfit-${asset.outfitSeq}` : '');
        const sameVariant = asset.type !== 'character' || refVariant === assetVariant || (!refVariant && asset.isDefault);
        if (sameType && (sameName || sameProp) && sameVariant && ref.assetId !== asset.id) {
          changed = true;
          return { ...ref, assetId: asset.id, assetBindingMode: 'auto' };
        }
        return ref;
      });
      return changed ? { ...storyboard, imageRefs } : storyboard;
    });
  }
}

async function runStep3AssetsJob(backgroundJob, context = {}) {
  const input = asObject(backgroundJob.input);
  const defaults = await getEffectiveAgentDefaultsForUser(backgroundJob.userId);
  const imageConfig = mergeMissing(input.config || input.imageConfig, defaults.image);
  if (input.mode !== 'plan-only' && !getText(imageConfig.apiKey)) throw new Error('Step3 Agent image apiKey is required');
  if (input.mode !== 'plan-only' && !getText(imageConfig.model)) throw new Error('Step3 Agent image model is required');

  const snapshot = await getCloudProjectSnapshot(backgroundJob.userId, backgroundJob.projectId);
  const chapter = getChapter(snapshot, backgroundJob.chapterId);
  if (!chapter) throw new Error('Step3 chapter not found');
  const analysis = asObject(chapter.analysis);
  if (!analysis || Object.keys(analysis).length === 0) throw new Error('Step3 requires chapter.analysis from Step1');

  const project = snapshot.project;
  const styleConfig = getText(analysis.styleConfig || project.styleConfig);
  const slots = buildSlots(analysis, input);
  const maxItems = Number.isFinite(Number(input.maxItems)) ? Math.max(1, Math.round(Number(input.maxItems))) : slots.length;
  const selectedSlots = slots.slice(0, maxItems);
  const skipExisting = input.skipExisting !== false;
  const planOnly = input.mode === 'plan-only';
  const generated = [];
  const skipped = [];
  const failed = [];

  chapter.step3Task = {
    ...(asObject(chapter.step3Task)),
    running: true,
    total: selectedSlots.length,
    done: 0,
    success: 0,
    failed: 0,
    failures: [],
    phase: planOnly ? 'planning' : 'generating',
  };

  for (let index = 0; index < selectedSlots.length; index += 1) {
    const slot = selectedSlots[index];
    const existing = skipExisting ? findExistingAsset(project.assetLibrary, slot) : null;
    await updateJob(backgroundJob.userId, backgroundJob.id, {
      status: 'running',
      progress: {
        phase: planOnly ? 'planning' : 'generating',
        itemIndex: index,
        itemCount: selectedSlots.length,
        key: slot.key,
        name: slot.name,
        concept: slot.concept,
        updatedAt: new Date().toISOString(),
      },
    }).catch(() => undefined);
    await context.heartbeat?.();

    if (existing) {
      skipped.push({ key: slot.key, assetId: existing.id, blobKey: existing.blobKey, reason: 'existing asset' });
      chapter.step3Task.done += 1;
      continue;
    }

    if (planOnly) {
      generated.push({ ...slot, prompt: buildPrompt(slot, styleConfig), status: 'planned' });
      chapter.step3Task.done += 1;
      continue;
    }

    try {
      const prompt = buildPrompt(slot, styleConfig);
      const syntheticJob = {
        ...backgroundJob,
        id: `${backgroundJob.id}-step3-${index}`,
        type: 'image-generations',
        input: {
          config: imageConfig,
          prompt,
          aspectRatio: slot.aspectRatio,
          imageSize: input.imageSize || imageConfig.defaultImageSize || '1K',
        },
        media: {},
      };
      const imageResult = await runImageGenerationJob(syntheticJob, context);
      const now = Date.now();
      const asset = {
        id: createId('asset'),
        name: slot.name,
        type: slot.type,
        concept: slot.concept,
        description: slot.description,
        identityKey: slot.identityKey,
        variantKey: slot.variantKey,
        outfitSeq: slot.outfitSeq,
        optimizedPrompt: prompt,
        generationMode: slot.generationMode,
        blobKey: imageResult.output.blobKey,
        aspectRatio: slot.aspectRatio,
        imageSize: input.imageSize || imageConfig.defaultImageSize || '1K',
        externalImageUrl: imageResult.output.externalImageUrl,
        externalImageExpiresAt: imageResult.output.externalImageExpiresAt,
        externalSourceModel: imageResult.output.sourceModel,
        isDefault: slot.isDefault,
        usedInStoryboards: [slot.key],
        createdAt: now,
        updatedAt: now,
      };
      mergeGeneratedAsset(project, asset);
      relinkStoryboards(project, asset);
      generated.push({ key: slot.key, assetId: asset.id, blobKey: asset.blobKey, name: asset.name, concept: asset.concept });
      chapter.step3Task.success += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ key: slot.key, name: slot.name, concept: slot.concept, error: message });
      chapter.step3Task.failed += 1;
      chapter.step3Task.failures = failed;
      if (input.continueOnError === false) throw error;
    } finally {
      chapter.step3Task.done += 1;
    }
  }

  chapter.step3Task.running = false;
  chapter.step3Task.phase = failed.length ? 'done-with-errors' : 'done';
  chapter.step3Task.stopped = false;
  snapshot.exportedAt = new Date().toISOString();
  if (input.writeBack !== false) {
    await putCloudProjectSnapshot(backgroundJob.userId, backgroundJob.projectId, snapshot);
  }

  return {
    status: failed.length && input.failOnItemError === true ? 'failed' : 'succeeded',
    progress: {
      phase: failed.length ? 'done-with-errors' : 'done',
      itemCount: selectedSlots.length,
      generatedCount: generated.length,
      skippedCount: skipped.length,
      failedCount: failed.length,
      updatedAt: new Date().toISOString(),
    },
    output: {
      slots: selectedSlots,
      generated,
      skipped,
      failed,
      writeBack: input.writeBack !== false,
    },
    message: failed.length ? 'Step3 assets completed with item errors' : 'Step3 assets complete',
  };
}

function createStep3JobHandlers() {
  return {
    'step3-assets': runStep3AssetsJob,
  };
}

module.exports = {
  buildSlots,
  createStep3JobHandlers,
  runStep3AssetsJob,
};
