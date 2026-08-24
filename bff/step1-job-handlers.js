const { updateJob } = require('./background-jobs');
const {
  getCloudProjectSnapshot,
  putCloudProjectSnapshot,
} = require('./cloud-store');
const { getEffectiveAgentDefaultsForUser } = require('./commercial-settings');
const { runLlmCompletionJob } = require('./llm-job-handlers');
const { STEP1_REQUIRED_ARRAY_KEYS, STEP1_REQUIRED_STRING_KEYS } = require('./step1-contract');

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getText(value, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function mergeMissing(target, defaults) {
  const next = { ...(asObject(target)) };
  Object.entries(defaults || {}).forEach(([key, value]) => {
    if (next[key] === undefined || next[key] === null || next[key] === '') {
      next[key] = value;
    }
  });
  return next;
}

function getChapter(snapshot, chapterId) {
  const chapters = asArray(snapshot?.project?.chapters);
  if (chapterId) return chapters.find((chapter) => chapter?.id === chapterId) || null;
  const currentChapterId = snapshot?.project?.currentChapterId;
  return chapters.find((chapter) => chapter?.id === currentChapterId) || chapters[0] || null;
}

function getSourceText(chapter, input) {
  const explicit = getText(input.sourceText || input.script || input.scriptText);
  if (explicit) return explicit;
  if (getText(input.sourceType) === 'novel') return getText(chapter.adaptedScript) || getText(chapter.rawScript);
  return getText(chapter.rawScript) || getText(chapter.adaptedScript);
}

function stripCodeFence(text) {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : text;
}

function findJsonObjectText(text) {
  const raw = stripCodeFence(String(text || '').trim());
  if (!raw) return '';
  if (raw.startsWith('{') && raw.endsWith('}')) return raw;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start >= 0 && end > start ? raw.slice(start, end + 1) : '';
}

function repairJsonText(text) {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\/\/[^\n\r]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseAnalysisJson(content) {
  const jsonText = findJsonObjectText(content);
  if (!jsonText) throw new Error('Step1 analysis did not return a JSON object');
  try {
    return { parsed: JSON.parse(jsonText), source: 'strict-json', warnings: [] };
  } catch (strictError) {
    const repaired = repairJsonText(jsonText);
    if (repaired !== jsonText) {
      try {
        return {
          parsed: JSON.parse(repaired),
          source: 'repaired-json',
          warnings: ['Step1 JSON required automatic repair before writeback'],
        };
      } catch {
        // keep the stricter error below
      }
    }
    throw strictError;
  }
}

function normalizeStringArray(value) {
  return asArray(value)
    .map((item) => getText(item))
    .filter(Boolean);
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeBoolean(value) {
  return value === true || value === 'true';
}

function normalizeScene(scene) {
  const item = asObject(scene);
  return {
    name: getText(item.name),
    timeOfDay: getText(item.timeOfDay),
    environment: getText(item.environment),
    colorTone: getText(item.colorTone),
    characters: normalizeStringArray(item.characters),
    spaceScale: getText(item.spaceScale),
    layout: getText(item.layout),
    keySetPieces: getText(item.keySetPieces),
    lighting: getText(item.lighting),
    weather: getText(item.weather),
    atmosphere: getText(item.atmosphere),
    step3Description: getText(item.step3Description),
    inferredFields: normalizeStringArray(item.inferredFields),
  };
}

function normalizeStoryboard(storyboard, index) {
  const item = asObject(storyboard);
  return {
    number: normalizeNumber(item.number, index + 1),
    name: getText(item.name),
    duration: getText(item.duration),
    shotSize: getText(item.shotSize),
    scene: getText(item.scene),
    characters: normalizeStringArray(item.characters),
  };
}

function normalizeCharacterProfile(profile) {
  const item = asObject(profile);
  return {
    name: getText(item.name),
    description: getText(item.description),
    ageAppearance: getText(item.ageAppearance),
    temperament: getText(item.temperament),
    bodyBuild: getText(item.bodyBuild),
    faceFeatures: getText(item.faceFeatures),
    hairStyle: getText(item.hairStyle),
    skinTone: getText(item.skinTone),
    defaultOutfit: getText(item.defaultOutfit),
    accessories: getText(item.accessories),
    visualAnchor: getText(item.visualAnchor),
    step3Description: getText(item.step3Description),
    inferredFields: normalizeStringArray(item.inferredFields),
  };
}

function normalizeOutfit(outfit) {
  const item = asObject(outfit);
  return {
    characterName: getText(item.characterName),
    outfitSeq: normalizeNumber(item.outfitSeq, 1),
    outfitDesc: getText(item.outfitDesc),
    storyboardRange: getText(item.storyboardRange),
    needsNewImage: normalizeBoolean(item.needsNewImage),
  };
}

function normalizeProp(prop) {
  const item = asObject(prop);
  return {
    propName: getText(item.propName),
    appearanceDesc: getText(item.appearanceDesc),
    size: getText(item.size),
    material: getText(item.material),
    shapeStructure: getText(item.shapeStructure),
    color: getText(item.color),
    texture: getText(item.texture),
    condition: getText(item.condition),
    visualAnchor: getText(item.visualAnchor),
    step3Description: getText(item.step3Description),
    inferredFields: normalizeStringArray(item.inferredFields),
    holder: getText(item.holder),
    storyboardRange: getText(item.storyboardRange),
    stateChanges: getText(item.stateChanges),
    needsTracking: normalizeBoolean(item.needsTracking),
    needsImage: normalizeBoolean(item.needsImage),
  };
}

function normalizeAnalysis(raw) {
  const obj = asObject(raw);
  const analysis = {
    projectName: getText(obj.projectName, 'Untitled Project'),
    styleConfig: getText(obj.styleConfig),
    scenes: asArray(obj.scenes).map(normalizeScene).filter((item) => item.name),
    storyboards: asArray(obj.storyboards).map(normalizeStoryboard),
    allCharacterNames: normalizeStringArray(obj.allCharacterNames),
    characterProfiles: asArray(obj.characterProfiles).map(normalizeCharacterProfile).filter((item) => item.name),
    sceneRelations: getText(obj.sceneRelations),
    outfitTracking: asArray(obj.outfitTracking).map(normalizeOutfit).filter((item) => item.characterName),
    propTracking: asArray(obj.propTracking).map(normalizeProp).filter((item) => item.propName),
    propInheritance: getText(obj.propInheritance),
    summary: getText(obj.summary),
  };
  for (const key of STEP1_REQUIRED_STRING_KEYS) {
    if (typeof analysis[key] !== 'string') analysis[key] = '';
  }
  for (const key of STEP1_REQUIRED_ARRAY_KEYS) {
    if (!Array.isArray(analysis[key])) analysis[key] = [];
  }
  return analysis;
}

function writeAnalysisBack(snapshot, chapter, analysis, sourceText, input) {
  const project = snapshot.project;
  const incomingStyle = getText(analysis.styleConfig);
  const currentStyle = getText(project.styleConfig);
  const shouldSyncProjectStyle = input.syncProjectStyle !== false && incomingStyle;
  const canonicalStyle = shouldSyncProjectStyle ? incomingStyle : (currentStyle || incomingStyle);
  const nextAnalysis = {
    ...analysis,
    styleConfig: canonicalStyle || analysis.styleConfig,
  };

  if (shouldSyncProjectStyle && (!currentStyle || input.forceProjectStyle === true)) {
    project.styleConfig = canonicalStyle;
  } else if (!currentStyle && canonicalStyle) {
    project.styleConfig = canonicalStyle;
  }

  project.allCharacterNames = nextAnalysis.allCharacterNames;
  project.characterProfiles = nextAnalysis.characterProfiles;
  project.outfitTracking = nextAnalysis.outfitTracking;
  project.propTracking = nextAnalysis.propTracking;
  project.propInheritance = nextAnalysis.propInheritance;

  chapter.analysis = nextAnalysis;
  chapter.analysisSourceText = sourceText;
  chapter.analysisIsStale = false;
  chapter.step1Task = {
    running: false,
    phase: 'done',
    updatedAt: Date.now(),
  };
  chapter.status = chapter.status === 'analyzing' ? 'idle' : chapter.status;
}

async function runStep1AnalysisJob(backgroundJob, context = {}) {
  const input = asObject(backgroundJob.input);
  const defaults = await getEffectiveAgentDefaultsForUser(backgroundJob.userId);
  const apiConfig = mergeMissing(input.apiConfig, defaults.llm);
  if (!getText(apiConfig.apiKey)) throw new Error('Step1 Agent LLM apiKey is required');
  if (!getText(apiConfig.model)) throw new Error('Step1 Agent LLM model is required');

  const snapshot = await getCloudProjectSnapshot(backgroundJob.userId, backgroundJob.projectId);
  const chapter = getChapter(snapshot, backgroundJob.chapterId);
  if (!chapter) throw new Error('Step1 chapter not found');
  const sourceText = getSourceText(chapter, input);
  if (!sourceText) throw new Error('Step1 sourceText is empty');

  await updateJob(backgroundJob.userId, backgroundJob.id, {
    status: 'running',
    progress: {
      phase: 'analysis',
      updatedAt: new Date().toISOString(),
    },
  }).catch(() => undefined);

  const llmResult = await runLlmCompletionJob({
    ...backgroundJob,
    type: 'llm-completions',
    input: {
      apiConfig,
      templateType: 'step1',
      templateVars: asObject(input.templateVars),
      userMessages: [{
        role: 'user',
        content: JSON.stringify({
          scriptText: sourceText,
          originalSourceText: getText(input.originalSourceText),
          sourceType: getText(input.sourceType || chapter.scriptType) || 'annotated',
          seriesContext: input.seriesContext,
        }),
      }],
      options: mergeMissing(input.options, {
        temperature: 0.7,
        maxTokens: 12000,
        reasoningEffort: 'high',
      }),
      stream: input.stream === true ? true : false,
      progressMode: 'stage-only',
      timeoutMs: input.timeoutMs,
      streamIdleTimeoutMs: input.streamIdleTimeoutMs,
    },
  }, context);

  const content = getText(llmResult.output?.content);
  const parsedResult = parseAnalysisJson(content);
  const analysis = normalizeAnalysis(parsedResult.parsed);
  if (input.writeBack !== false) {
    writeAnalysisBack(snapshot, chapter, analysis, sourceText, input);
    snapshot.exportedAt = new Date().toISOString();
    await putCloudProjectSnapshot(backgroundJob.userId, backgroundJob.projectId, snapshot);
  }

  return {
    status: 'succeeded',
    progress: {
      phase: 'done',
      updatedAt: new Date().toISOString(),
    },
    output: {
      analysis,
      parseSource: parsedResult.source,
      warnings: parsedResult.warnings,
      writeBack: input.writeBack !== false,
      textLength: content.length,
    },
    message: 'Step1 analysis background job complete',
  };
}

function createStep1JobHandlers() {
  return {
    'step1-analysis': runStep1AnalysisJob,
  };
}

module.exports = {
  createStep1JobHandlers,
  normalizeAnalysis,
  parseAnalysisJson,
  runStep1AnalysisJob,
};
