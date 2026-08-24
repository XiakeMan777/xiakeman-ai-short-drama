const templates = require('./templates');
const {
  getCloudProjectSnapshot,
  putCloudProjectSnapshot,
} = require('./cloud-store');
const { getEffectiveAgentDefaultsForUser } = require('./commercial-settings');
const { updateJob } = require('./background-jobs');
const { runImageGenerationJob } = require('./image-job-handlers');

const DEFAULT_STEP4_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_STAGE_PARAMS = {
  storyboard_director_brief: { temperature: 0.55, maxTokens: 12000, reasoningEffort: 'high' },
  storyboard_board_plan_shot15: { temperature: 0.58, maxTokens: 28000, reasoningEffort: 'high' },
  storyboard_board_plan_smart: { temperature: 0.58, maxTokens: 28000, reasoningEffort: 'high' },
  storyboard_action_director: { temperature: 0.5, maxTokens: 28000, reasoningEffort: 'high' },
  seedance_final_video_prompt: { temperature: 0.62, maxTokens: 26000, reasoningEffort: 'high' },
};
const STORYBOARD_BOARD_MODES = new Set([
  'nine-portrait',
  'nine-landscape',
  'shot-plan-landscape',
  'smart-shot-plan-landscape',
]);

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

function normalizeBoardMode(value) {
  const mode = getText(value);
  return STORYBOARD_BOARD_MODES.has(mode) ? mode : 'smart-shot-plan-landscape';
}

function getBoardLayout(mode) {
  return mode === 'shot-plan-landscape' || mode === 'smart-shot-plan-landscape' ? 'strip' : '3x3';
}

function mergeStoryboardBoardVariant(boardState, mode, updates) {
  const selectedMode = normalizeBoardMode(mode);
  const currentState = asObject(boardState);
  const variants = asObject(currentState.variants);
  const currentVariant = asObject(variants[selectedMode]);
  return {
    selectedMode,
    variants: {
      ...variants,
      [selectedMode]: {
        status: 'idle',
        isStale: false,
        planStatus: currentVariant.plan ? 'done' : 'idle',
        planIsStale: false,
        layout: getBoardLayout(selectedMode),
        imageSize: '2K',
        ...currentVariant,
        ...updates,
      },
    },
  };
}

function getBoardImagePrompt(item) {
  return getText(item.boardImagePrompt)
    || getText(item.storyboardBoardImagePrompt)
    || getText(item.imagePrompt)
    || getText(item.storyboardImagePrompt);
}

function getBoardImageReferenceBlobKeys(item) {
  return asArray(
    item.boardImageReferenceBlobKeys
      || item.storyboardBoardReferenceBlobKeys
      || item.referenceBlobKeys,
  ).map(getText).filter(Boolean);
}

function getBoardImageReferenceLabels(item) {
  return asArray(
    item.boardImageReferenceLabels
      || item.storyboardBoardReferenceLabels
      || item.referenceLabels,
  ).map(getText).filter(Boolean);
}

function buildChatUrl(baseUrl) {
  const normalized = getText(baseUrl).replace(/\/+$/, '');
  if (!normalized) throw new Error('Step4 LLM baseUrl is required');
  if (normalized.endsWith('/chat/completions')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

function extractContent(payload) {
  const content = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Step4 LLM returned empty content');
  }
  return content.trim();
}

function tryParseJsonObject(text) {
  const trimmed = getText(text);
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function getStageParams(templateType, overrides = {}) {
  return {
    ...(DEFAULT_STAGE_PARAMS[templateType] || { temperature: 0.6, maxTokens: 16000 }),
    ...(asObject(overrides[templateType])),
  };
}

function buildRequestBody(templateType, payload, params, templateVars = {}) {
  const system = templates.buildSystemPrompt(templateType, templateVars);
  if (!system) throw new Error(`Unknown Step4 templateType: ${templateType}`);
  const user = templates.buildUserPrompt(templateType, JSON.stringify(payload || {}), templateVars);
  const body = {
    model: params.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: params.temperature,
    max_tokens: params.maxTokens,
    stream: false,
  };
  if (params.reasoningEffort) body.reasoning_effort = params.reasoningEffort;
  return body;
}

async function runLlmStage({ templateType, payload, apiConfig, params, templateVars }) {
  const url = buildChatUrl(apiConfig.baseUrl);
  const body = buildRequestBody(templateType, payload, { ...params, model: apiConfig.model }, templateVars);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiConfig.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(params.timeoutMs || DEFAULT_STEP4_TIMEOUT_MS)),
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`Step4 LLM API Error (${response.status}): ${text.slice(0, 500)}`);
  }
  return extractContent(JSON.parse(text));
}

function getChapter(snapshot, chapterId) {
  const chapters = Array.isArray(snapshot?.project?.chapters) ? snapshot.project.chapters : [];
  if (!chapterId) return chapters[0] || null;
  return chapters.find((chapter) => chapter?.id === chapterId) || null;
}

function getStoryboard(chapter, index) {
  const storyboards = Array.isArray(chapter?.storyboards) ? chapter.storyboards : [];
  return storyboards[index] || null;
}

function getStoryboardInfo(storyboardState, fallback = {}) {
  const source = asObject(storyboardState?.storyboard);
  return Object.keys(source).length ? source : asObject(fallback);
}

function ensureStoryboardsFromAnalysis(chapter, input = {}) {
  if (!Array.isArray(chapter.storyboards)) chapter.storyboards = [];
  if (chapter.storyboards.length > 0 || input.createStoryboards === false) return chapter.storyboards;
  const analysisStoryboards = asArray(chapter.analysis?.storyboards);
  chapter.storyboards = analysisStoryboards.map((storyboard, index) => ({
    storyboard: {
      number: storyboard.number || index + 1,
      name: getText(storyboard.name, `Storyboard ${index + 1}`),
      duration: getText(storyboard.duration, '15秒'),
      shotSize: getText(storyboard.shotSize, '中景'),
      scene: getText(storyboard.scene),
      characters: asArray(storyboard.characters).map(getText).filter(Boolean),
    },
    status: 'pending',
    imageRefs: [],
    seedanceFinalVideoPromptStatus: 'idle',
  }));
  return chapter.storyboards;
}

function getSceneByName(analysis, name) {
  const target = getText(name);
  return asArray(analysis?.scenes).find((scene) => getText(scene.name) === target) || null;
}

function getProfileByName(analysis, name) {
  const target = getText(name);
  return asArray(analysis?.characterProfiles).find((profile) => getText(profile.name) === target) || null;
}

function getAssetIdentity(asset) {
  if (asset?.type === 'prop') return getText(asset.identityKey) || getText(asset.name);
  if (asset?.type === 'character') {
    const variant = getText(asset.variantKey) || (Number.isFinite(Number(asset.outfitSeq)) ? `outfit-${asset.outfitSeq}` : '');
    return variant ? `${getText(asset.name)}::${variant}` : getText(asset.name);
  }
  return getText(asset?.name);
}

function buildAssetReference(asset, refId) {
  return {
    refId,
    type: getText(asset.type),
    name: getText(asset.name),
    assetId: getText(asset.id),
    blobKey: getText(asset.blobKey),
    concept: getText(asset.concept),
    variantKey: getText(asset.variantKey),
    outfitSeq: asset.outfitSeq,
    identityKey: getText(asset.identityKey),
    readFor: getText(asset.description) || getText(asset.optimizedPrompt).slice(0, 240),
    doNotUseFor: 'Do not copy storyboard borders, labels, subtitles, logos, watermarks, or reference-sheet layout into final video.',
  };
}

function sortAssetsForStoryboard(assets, storyboardInfo) {
  const sceneName = getText(storyboardInfo.scene);
  const characters = new Set(asArray(storyboardInfo.characters).map(getText).filter(Boolean));
  return [...assets].sort((left, right) => {
    const score = (asset) => {
      let value = 0;
      if (asset.type === 'scene' && getText(asset.name) === sceneName) value += 100;
      if (asset.type === 'character' && characters.has(getText(asset.name))) value += 90;
      if (asset.type === 'prop') value += 40;
      if (asset.isDefault) value += 10;
      if (asset.concept === 'portrait_closeup') value += 8;
      if (asset.concept === 'scene_main') value += 8;
      if (asset.concept === 'prop_main') value += 8;
      return value;
    };
    return score(right) - score(left) || getText(left.name).localeCompare(getText(right.name));
  });
}

function collectStep4References(project, storyboardInfo, input = {}) {
  const maxReferences = Math.max(1, Number(input.maxStep3References || 7));
  const assets = asArray(project?.assetLibrary).filter((asset) => getText(asset.blobKey));
  const selected = [];
  const seen = new Set();
  for (const asset of sortAssetsForStoryboard(assets, storyboardInfo)) {
    const identity = `${asset.type}:${getAssetIdentity(asset)}:${asset.concept}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    selected.push(asset);
    if (selected.length >= maxReferences) break;
  }
  return selected.map((asset, index) => buildAssetReference(asset, `图片${index + 2}`));
}

function buildPromptSummary(storyboardInfo, analysis, sourceText) {
  const scene = getSceneByName(analysis, storyboardInfo.scene);
  const profiles = asArray(storyboardInfo.characters)
    .map((name) => getProfileByName(analysis, name))
    .filter(Boolean);
  return {
    rawText: [
      `分镜${storyboardInfo.number || ''}：${storyboardInfo.name || ''}`,
      `时长：${storyboardInfo.duration || '15秒'}；景别：${storyboardInfo.shotSize || '中景'}；场景：${storyboardInfo.scene || ''}`,
      `出场角色：${asArray(storyboardInfo.characters).join('、')}`,
      scene ? `场景描述：${scene.step3Description || scene.environment || ''}` : '',
      profiles.length ? `角色描述：${profiles.map((profile) => `${profile.name}:${profile.step3Description || profile.description || ''}`).join('；')}` : '',
      sourceText ? `剧本来源：${sourceText}` : '',
    ].filter(Boolean).join('\n'),
    header: getText(storyboardInfo.name),
    scene: scene?.step3Description || scene?.environment || getText(storyboardInfo.scene),
    cameraOverview: getText(storyboardInfo.shotSize, '中景连续镜头'),
    colorLighting: scene?.lighting || scene?.colorTone || '',
    timeSegments: [],
  };
}

function buildContinuityForIndex(chapter, storyboardIndex) {
  const previous = storyboardIndex > 0 ? getStoryboard(chapter, storyboardIndex - 1) : null;
  return {
    hasPrevious: !!previous,
    previousLastFrameInfo: getText(previous?.lastFrameInfo || previous?.continuityOutput || previous?.storyboardBoard?.endBeat),
    previousSpatialBlocking: previous?.agentStoryboardActionDirector?.blockingContinuity?.currentEnd
      || previous?.agentStoryboardBoardPlan?.blockingContinuity?.currentEnd
      || null,
    currentSpatialBlocking: null,
  };
}

function getPanelCountForMode(mode, input = {}) {
  const count = Number(input.panelCount || input.smartPanelCount || input.storyboardBoardSmartPanelCount);
  if (mode === 'smart-shot-plan-landscape' && [6, 9, 12, 15].includes(count)) return count;
  return mode === 'smart-shot-plan-landscape' ? 15 : 15;
}

function buildAutoStep4Item({ project, chapter, storyboardState, storyboardIndex, input }) {
  const analysis = asObject(chapter.analysis);
  const storyboardInfo = getStoryboardInfo(storyboardState, asArray(analysis.storyboards)[storyboardIndex]);
  const mode = normalizeBoardMode(input.mode || chapter.storyboardBoardMode || 'smart-shot-plan-landscape');
  const panelCount = getPanelCountForMode(mode, input);
  const frameRatio = getText(input.frameRatio || input.videoRatio, '16:9');
  const boardStyle = getText(input.boardStyle || chapter.storyboardBoardStyle, 'seedance-board');
  const sourceText = getText(input.sourceText || chapter.rawScript || chapter.adaptedScript);
  const references = collectStep4References(project, storyboardInfo, input);
  const prompt = buildPromptSummary(storyboardInfo, analysis, sourceText);
  const continuity = buildContinuityForIndex(chapter, storyboardIndex);
  const common = {
    mode,
    outputMode: 'storyboard-director',
    boardStyle,
    panelCount,
    frameRatio,
    storyboard: storyboardInfo,
    prompt,
    correctedScript: sourceText,
    sourceExcerpt: sourceText,
    projectVisualStyle: getText(analysis.styleConfig || project.styleConfig),
    references,
    continuity,
    sequenceContinuityContext: {
      hasPrevious: continuity.hasPrevious,
      previousLastFrameInfo: continuity.previousLastFrameInfo,
    },
    referenceBudget: references.map((reference) => ({
      refId: reference.refId,
      decision: 'mustKeep',
      reason: reference.readFor || `${reference.type} reference`,
    })),
    cameraSegmentCount: input.cameraSegmentCount || chapter.storyboardCameraSegmentCount || 'auto',
    planningMode: input.planningMode || chapter.storyboardDirectorRunMode || 'fast',
  };
  const seedancePayload = {
    ...common,
    storyboard: storyboardState || { storyboard: storyboardInfo },
    directorBoardRefId: '图片1',
    generatedStep4OutputMode: 'storyboard-director',
    storyboardBoardStyle: boardStyle,
    finalPromptContract: {
      projectVisualStyle: getText(analysis.styleConfig || project.styleConfig),
      frameRatio,
      mode,
      panelCount,
      referenceOrder: ['图片1', ...references.map((reference) => reference.refId)],
    },
  };
  return {
    storyboardIndex,
    mode,
    frameRatio,
    boardStyle,
    panelCount,
    directorBriefPayload: common,
    boardPlanPayload: common,
    boardPlanTemplateType: mode === 'smart-shot-plan-landscape'
      ? 'storyboard_board_plan_smart'
      : 'storyboard_board_plan_shot15',
    actionDirectorPayload: common,
    seedanceFinalPromptPayload: seedancePayload,
    referenceBlobKeys: references.map((reference) => reference.blobKey).filter(Boolean),
    referenceLabels: references.map((reference) => `${reference.refId}: ${reference.type} ${reference.name}`),
    referenceAssetIds: references.map((reference) => reference.assetId).filter(Boolean),
    referencePack: references,
  };
}

function buildAutoItems(snapshot, chapter, input = {}) {
  if (!snapshot?.project) throw new Error('Step4 autoBuild requires a project snapshot');
  if (!chapter) throw new Error('Step4 autoBuild chapter not found');
  if (!chapter.analysis) throw new Error('Step4 autoBuild requires Step1 analysis');
  const storyboards = ensureStoryboardsFromAnalysis(chapter, input);
  if (storyboards.length === 0) throw new Error('Step4 autoBuild found no storyboards; run Step1 analysis first');
  const requestedIndexes = asArray(input.storyboardIndexes)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value < storyboards.length);
  const indexes = requestedIndexes.length
    ? requestedIndexes
    : storyboards.map((_storyboard, index) => index);
  return indexes.map((storyboardIndex) => buildAutoStep4Item({
    project: snapshot.project,
    chapter,
    storyboardState: storyboards[storyboardIndex],
    storyboardIndex,
    input,
  }));
}

function normalizeItems(input) {
  const items = asArray(input.items);
  if (items.length === 0) {
    throw new Error('step4-storyboards requires input.items with prepared template payloads');
  }
  return items.map((item, index) => ({
    ...asObject(item),
    storyboardIndex: Number.isInteger(item?.storyboardIndex) ? item.storyboardIndex : index,
  }));
}

function writeItemBack(storyboard, itemResult) {
  if (!storyboard) return;
  const now = Date.now();
  storyboard.agentStep4 = {
    ...(asObject(storyboard.agentStep4)),
    updatedAt: now,
    stages: itemResult.stages,
  };
  if (itemResult.seedanceFinalVideoPrompt) {
    storyboard.seedanceFinalVideoPrompt = itemResult.seedanceFinalVideoPrompt;
    storyboard.seedanceFinalVideoPromptStatus = 'done';
    storyboard.seedanceFinalVideoPromptError = undefined;
    storyboard.seedanceFinalVideoPromptUpdatedAt = now;
  }
  if (itemResult.boardPlanJson) {
    storyboard.agentStoryboardBoardPlan = itemResult.boardPlanJson;
  }
  if (itemResult.directorBriefJson) {
    storyboard.agentStoryboardDirectorBrief = itemResult.directorBriefJson;
  }
  if (itemResult.actionDirectorJson) {
    storyboard.agentStoryboardActionDirector = itemResult.actionDirectorJson;
  }
  if (itemResult.boardImage?.blobKey) {
    const mode = normalizeBoardMode(itemResult.boardImage.mode);
    storyboard.storyboardBoard = mergeStoryboardBoardVariant(storyboard.storyboardBoard, mode, {
      status: 'done',
      boardStyle: itemResult.boardImage.boardStyle,
      generatedForOutputMode: 'storyboard-director',
      blobKey: itemResult.boardImage.blobKey,
      visualBoardBlobKey: itemResult.boardImage.visualBoardBlobKey,
      referencePack: itemResult.boardImage.referencePack || [],
      startedAt: undefined,
      generatedAt: now,
      error: undefined,
      isStale: false,
      layout: getBoardLayout(mode),
      frameRatio: itemResult.boardImage.frameRatio,
      imageSize: itemResult.boardImage.imageSize,
      promptSnapshot: itemResult.boardImage.promptSnapshot,
      referenceAssetIds: itemResult.boardImage.referenceAssetIds || [],
      plan: itemResult.boardImage.plan || itemResult.boardPlanJson,
      planStatus: itemResult.boardImage.plan || itemResult.boardPlanJson ? 'done' : undefined,
      planGeneratedAt: itemResult.boardImage.plan || itemResult.boardPlanJson ? now : undefined,
      planError: undefined,
      planIsStale: false,
      planPromptSnapshot: itemResult.boardImage.planPromptSnapshot,
      planReferenceAssetIds: itemResult.boardImage.planReferenceAssetIds || [],
    });
    storyboard.useStoryboardBoardReference = true;
  }
}

function buildStageList(item) {
  const stages = [];
  if (item.directorBriefPayload) stages.push(['directorBrief', 'storyboard_director_brief', item.directorBriefPayload]);
  if (item.boardPlanPayload) {
    stages.push([
      'boardPlan',
      getText(item.boardPlanTemplateType, item.mode === 'smart-shot-plan-landscape' ? 'storyboard_board_plan_smart' : 'storyboard_board_plan_shot15'),
      item.boardPlanPayload,
    ]);
  }
  if (item.actionDirectorPayload) stages.push(['actionDirector', 'storyboard_action_director', item.actionDirectorPayload]);
  if (item.seedanceFinalPromptPayload) stages.push(['seedanceFinalPrompt', 'seedance_final_video_prompt', item.seedanceFinalPromptPayload]);
  return stages;
}

function resolveStagePayload(stageName, payload, itemResult, item) {
  const next = { ...(asObject(payload)) };
  if (stageName === 'boardPlan' && itemResult.directorBriefJson) {
    next.directorBrief = itemResult.directorBriefJson;
  }
  if (stageName === 'actionDirector' && itemResult.boardPlanJson) {
    next.currentPlan = itemResult.boardPlanJson;
    next.boardPlan = itemResult.boardPlanJson;
    if (itemResult.directorBriefJson) next.directorBrief = itemResult.directorBriefJson;
  }
  if (stageName === 'seedanceFinalPrompt') {
    const finalPlan = itemResult.actionDirectorJson || itemResult.boardPlanJson;
    if (finalPlan) {
      next.boardPlan = finalPlan;
      next.currentPlan = finalPlan;
      next.videoExecutionContract = {
        ...(asObject(next.videoExecutionContract)),
        panelExecutionCards: asArray(finalPlan.panels).map((panel, index) => ({
          panel: index + 1,
          timeRange: getText(panel.timeRange || panel.time || panel.TIME),
          beat: getText(panel.beat || panel.frameFunction || panel.purpose),
          action: getText(panel.action || panel.screenAction || panel.visualAction || panel.ACTION),
          camera: getText(panel.camera || panel.cameraMove || panel.CAMERA),
          dialogue: getText(panel.dialogue || panel.DIALOGUE),
          sound: getText(panel.sound || panel.SOUND || panel.sfx),
          openingContinuity: getText(panel.continuityIn),
          endingContinuity: getText(panel.continuityOut),
        })),
      };
    }
    if (itemResult.boardImage?.blobKey) {
      next.directorBoardBlobKey = itemResult.boardImage.blobKey;
    }
    next.directorBoardRefId = getText(next.directorBoardRefId || item.directorBoardRefId, '图片1');
  }
  return next;
}

function buildBoardImagePromptFromPlan(item, itemResult, input) {
  const staticPrompt = getBoardImagePrompt(item);
  if (staticPrompt) return staticPrompt;
  if (input.generateBoardImage === false || item.generateBoardImage === false) return '';
  const plan = itemResult.actionDirectorJson || itemResult.boardPlanJson;
  if (!plan) return '';
  const mode = normalizeBoardMode(item.boardMode || item.mode || input.boardMode || input.mode);
  const panelCount = asArray(plan.panels).length || item.panelCount || input.panelCount || 15;
  return [
    'Create a clean cinematic storyboard director board image for Seedance video generation.',
    `Board mode: ${mode}; panel count: ${panelCount}; aspect ratio: 16:9.`,
    'Use the supplied reference images only for identity, costume, material, scene layout, prop shape, and spatial/action relationship.',
    'Render a professional director board / shot sheet with START FRAME, S01-S15 or the provided S rows, END BEAT, blocking, camera rhythm, action progression, and transition intent.',
    'Do not create subtitles, logos, watermarks, random readable text, UI panels, arrows, labels, page footer text, or a comic page. If panel captions are unavoidable, keep them as tiny unreadable layout marks.',
    'Storyboard plan JSON:',
    JSON.stringify(plan).slice(0, 12000),
  ].join('\n');
}

async function runBoardImageStage({ backgroundJob, context, item, itemResult, defaults, input, itemIndex, itemCount }) {
  const prompt = buildBoardImagePromptFromPlan(item, itemResult, input);
  if (!prompt) return null;

  await updateJob(backgroundJob.userId, backgroundJob.id, {
    status: 'running',
    progress: {
      phase: 'boardImage',
      itemIndex,
      itemCount,
      storyboardIndex: item.storyboardIndex,
      updatedAt: new Date().toISOString(),
    },
  }).catch(() => undefined);
  await context.event?.({
    level: 'info',
    phase: 'boardImage',
    message: 'Step4 storyboard board image started',
    data: { storyboardIndex: item.storyboardIndex },
  });
  await context.heartbeat?.();

  const mode = normalizeBoardMode(item.boardMode || item.mode || input.boardMode || input.mode);
  const imageConfig = mergeMissing(item.imageConfig || input.imageConfig, defaults.image);
  const syntheticJob = {
    ...backgroundJob,
    id: `${backgroundJob.id}-step4-board-${item.storyboardIndex}`,
    type: 'image-generations',
    input: {
      config: imageConfig,
      prompt,
      aspectRatio: item.aspectRatio || input.aspectRatio || 'LANDSCAPE',
      imageSize: item.imageSize || input.imageSize || input.storyboardImageSize || imageConfig.defaultImageSize || '2K',
      sourceBlobKey: getText(item.sourceBlobKey || item.boardImageSourceBlobKey || input.sourceBlobKey),
      maskBlobKey: getText(item.maskBlobKey || input.maskBlobKey),
      referenceBlobKeys: input.useBoardImageReferenceInputs === false ? [] : getBoardImageReferenceBlobKeys(item),
      referenceLabels: input.useBoardImageReferenceInputs === false ? [] : getBoardImageReferenceLabels(item),
      sourceLabel: getText(item.sourceLabel || item.boardImageSourceLabel || input.sourceLabel),
    },
  };

  const imageResult = await runImageGenerationJob(syntheticJob, {
    ...context,
    event: async (event) => {
      await context.event?.({
        ...event,
        phase: event?.phase ? `boardImage:${event.phase}` : 'boardImage',
        data: {
          ...(asObject(event?.data)),
          storyboardIndex: item.storyboardIndex,
        },
      });
    },
  });
  const blobKey = getText(imageResult?.output?.blobKey);
  if (!blobKey) throw new Error('Step4 board image generation did not return blobKey');

  const boardImage = {
    status: 'done',
    mode,
    boardStyle: getText(item.boardStyle || input.boardStyle) || 'seedance-board',
    frameRatio: getText(item.frameRatio || input.frameRatio) || '16:9',
    imageSize: syntheticJob.input.imageSize,
    blobKey,
    contentType: imageResult.output.contentType,
    sizeBytes: imageResult.output.sizeBytes,
    promptSnapshot: getText(item.promptSnapshot) || prompt,
    referenceAssetIds: asArray(item.referenceAssetIds).map(getText).filter(Boolean),
    referencePack: asArray(item.referencePack),
    plan: itemResult.boardPlanJson || item.boardPlan || item.plan,
    planPromptSnapshot: getText(item.planPromptSnapshot),
    planReferenceAssetIds: asArray(item.planReferenceAssetIds || item.referenceAssetIds).map(getText).filter(Boolean),
  };
  itemResult.boardImage = boardImage;
  itemResult.stages.boardImage = {
    templateType: 'image-generations',
    blobKey,
    contentType: imageResult.output.contentType,
    sizeBytes: imageResult.output.sizeBytes,
  };
  return boardImage;
}

async function runStep4StoryboardJob(backgroundJob, context = {}) {
  const input = asObject(backgroundJob.input);
  const defaults = await getEffectiveAgentDefaultsForUser(backgroundJob.userId);
  const apiConfig = mergeMissing(input.apiConfig, defaults.llm);
  if (!getText(apiConfig.apiKey)) throw new Error('Step4 Agent LLM apiKey is required');
  if (!getText(apiConfig.model)) throw new Error('Step4 Agent LLM model is required');
  const stageParamOverrides = asObject(input.stageParams);
  const writeBack = input.writeBack !== false;
  const needsSnapshot = writeBack || input.autoBuild === true || asArray(input.items).length === 0;
  const snapshot = needsSnapshot
    ? await getCloudProjectSnapshot(backgroundJob.userId, backgroundJob.projectId)
    : null;
  const chapter = snapshot ? getChapter(snapshot, backgroundJob.chapterId) : null;
  const items = input.autoBuild === true || asArray(input.items).length === 0
    ? buildAutoItems(snapshot, chapter, input)
    : normalizeItems(input);
  const results = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const itemResult = {
      storyboardIndex: item.storyboardIndex,
      status: 'succeeded',
      stages: {},
    };
    const stageList = buildStageList(item);
    const hasBoardImageStage = input.generateBoardImage !== false && item.generateBoardImage !== false;
    if (stageList.length === 0 && !hasBoardImageStage) {
      throw new Error(`Step4 item ${index + 1} has no stage payloads`);
    }

    for (const [stageName, templateType, payload] of stageList) {
      await updateJob(backgroundJob.userId, backgroundJob.id, {
        status: 'running',
        progress: {
          phase: stageName,
          itemIndex: index,
          itemCount: items.length,
          storyboardIndex: item.storyboardIndex,
          updatedAt: new Date().toISOString(),
        },
      }).catch(() => undefined);
      await context.event?.({
        level: 'info',
        phase: stageName,
        message: `Step4 ${stageName} started`,
        data: { storyboardIndex: item.storyboardIndex, templateType },
      });
      await context.heartbeat?.();

      const resolvedPayload = resolveStagePayload(stageName, payload, itemResult, item);
      const content = await runLlmStage({
        templateType,
        payload: resolvedPayload,
        apiConfig,
        params: getStageParams(templateType, stageParamOverrides),
        templateVars: templateType === 'seedance_final_video_prompt'
          ? { videoRatio: item.frameRatio || input.frameRatio || '16:9' }
          : {},
      });
      const json = templateType === 'seedance_final_video_prompt' ? null : tryParseJsonObject(content);
      itemResult.stages[stageName] = {
        templateType,
        text: content,
        json,
        textLength: content.length,
      };
      if (stageName === 'directorBrief') itemResult.directorBriefJson = json;
      if (stageName === 'boardPlan') itemResult.boardPlanJson = json;
      if (stageName === 'actionDirector') itemResult.actionDirectorJson = json;
      if (stageName === 'seedanceFinalPrompt') itemResult.seedanceFinalVideoPrompt = content;
    }

    if (hasBoardImageStage) {
      await runBoardImageStage({
        backgroundJob,
        context,
        item,
        itemResult,
        defaults,
        input,
        itemIndex: index,
        itemCount: items.length,
      });
    }

    if (writeBack && chapter) {
      writeItemBack(getStoryboard(chapter, item.storyboardIndex), itemResult);
    }
    results.push(itemResult);
  }

  if (writeBack && snapshot) {
    snapshot.exportedAt = new Date().toISOString();
    await putCloudProjectSnapshot(backgroundJob.userId, backgroundJob.projectId, snapshot);
  }

  return {
    status: 'succeeded',
    progress: {
      phase: 'done',
      itemCount: items.length,
      updatedAt: new Date().toISOString(),
    },
    output: {
      items: results,
      writeBack,
    },
    message: 'Step4 storyboard background stages complete',
  };
}

function createStep4JobHandlers() {
  return {
    'step4-storyboards': runStep4StoryboardJob,
  };
}

module.exports = {
  createStep4JobHandlers,
};
