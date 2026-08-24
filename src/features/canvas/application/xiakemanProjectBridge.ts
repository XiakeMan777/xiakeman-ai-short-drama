import type { Edge, Node } from "@xyflow/react";
import type { Asset, Chapter, ImageApiConfig, Project, StoryboardInfo, StoryboardState, VideoApiConfig } from "@/types";
import { getStoryboardBoardSelectedMode, getStoryboardBoardVariant } from "@/lib/storyboardBoardState";
import {
  CANVAS_NODE_TYPES,
  type CharacterItem,
  type CharacterEntity,
  type PropItem,
  type SceneItem,
  type SceneEntity,
  type ScriptFrame,
  type StoryboardFrame,
} from "../domain/canvasNodes";

export const XIAKEMAN_PROJECT_SOURCE_KIND = "xiakeman-project";
export const CANVAS_DEFAULT_CHAT_MODEL = "grsai/gpt-5.5";
export const CANVAS_DEFAULT_IMAGE_MODEL = "artlist/nano-banana";
export const CANVAS_DEFAULT_VIDEO_PROVIDER = "vjimeng";
export const CANVAS_DEFAULT_VIDEO_MODEL = "transit9-fast";

export interface XiakemanCanvasBuildResult {
  nodes: Node[];
  edges: Edge[];
  chapterCount: number;
  storyboardCount: number;
  assetCount: number;
  videoCount: number;
}

export interface ImportedCanvasNodeData extends Record<string, unknown> {
  sourceKind?: typeof XIAKEMAN_PROJECT_SOURCE_KIND;
  sourceStep?: "step1" | "step2" | "step3" | "step4" | "step5" | "summary";
  sourceProjectId?: string;
  sourceChapterId?: string;
  sourceStoryboardIndex?: number;
  sourceAssetId?: string;
  sourceAssetBlobKey?: string;
  sourceStoryboardBoardBlobKey?: string;
  sourceVideoBlobKey?: string;
  sourceScriptField?: "rawScript" | "adaptedScript";
  scriptText?: string;
  frames?: ScriptFrame[];
}

export interface XiakemanCanvasBuildOptions {
  imageApiConfig?: Partial<Pick<ImageApiConfig, "baseUrl" | "model" | "defaultImageSize">>;
  videoApiConfig?: Partial<Pick<VideoApiConfig, "backend" | "seedanceModel" | "videoResolution" | "videoRatio" | "videoDuration">>;
}

type ImportedCharacterItem = CharacterItem & {
  sourceAssetId?: string;
  sourceAssetBlobKey?: string;
};

type ImportedSceneItem = SceneItem & {
  sourceAssetId?: string;
  sourceAssetBlobKey?: string;
};

type ImportedPropItem = PropItem & {
  sourceAssetId?: string;
  sourceAssetBlobKey?: string;
};

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function parseDurationSeconds(value: unknown, fallback = 5): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const matched = value.match(/[\d.]+/);
    if (matched) {
      const parsed = Number(matched[0]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return fallback;
}

function joinDefined(parts: Array<string | undefined | null>, separator = "，"): string {
  return parts.map((part) => part?.trim()).filter(Boolean).join(separator);
}

function splitNames(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[、,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function compactText(parts: Array<string | undefined | null>, separator = "\n"): string {
  return parts.map((part) => part?.trim()).filter(Boolean).join(separator);
}

function getCanvasImageModel(config?: Partial<Pick<ImageApiConfig, "baseUrl" | "model">>): string {
  const model = config?.model?.trim() || "nano-banana";
  const normalized = model.toLowerCase().replace(/_/g, "-").replace(/\s+/g, "-");
  const compact = normalized.replace(/-/g, "");
  if (/sd2\.xiakeman\.com/i.test(config?.baseUrl ?? "") || !config?.baseUrl) {
    if (normalized === "nano-banana-pro" || compact === "nanobananapro") return "artlist/nano-banana-pro";
    if (normalized === "seedream-5.0" || normalized === "seedream-5-0" || compact === "seedream50") return "artlist/seedream-5.0";
    if (normalized === "gpt-image-2" || compact === "gptimage2") return "artlist/gpt-image-2";
    return CANVAS_DEFAULT_IMAGE_MODEL;
  }
  return model.includes("/") ? model : CANVAS_DEFAULT_IMAGE_MODEL;
}

function getCanvasVideoDefaults(config?: Partial<Pick<VideoApiConfig, "backend" | "seedanceModel" | "videoResolution" | "videoRatio" | "videoDuration">>) {
  if (!config) {
    return {
      providerId: CANVAS_DEFAULT_VIDEO_PROVIDER,
      model: CANVAS_DEFAULT_VIDEO_MODEL,
      size: "720P",
      aspectRatio: "16:9",
      duration: 5,
    };
  }
  const backend = config.backend;
  const providerId = backend === "seedancecloud" ? "vjimeng" : backend === "seedance" ? "vjimeng" : CANVAS_DEFAULT_VIDEO_PROVIDER;
  const model = backend === "seedancecloud" || backend === "seedance"
    ? (config.seedanceModel || "fast")
    : CANVAS_DEFAULT_VIDEO_MODEL;
  return {
    providerId,
    model,
    size: (config.videoResolution || "720p").toUpperCase(),
    aspectRatio: config.videoRatio || "16:9",
    duration: config.videoDuration || 5,
  };
}

function getAssetDisplayUrl(asset: Asset | undefined): string | null {
  if (!asset) return null;
  return asset.thumbnailUrl || asset.externalImageUrl || null;
}

function pickAssetForName(assets: readonly Asset[], type: Asset["type"], name: string): Asset | undefined {
  const candidates = assets.filter((asset) => asset.type === type && asset.name === name);
  return candidates.find((asset) => asset.isDefault)
    ?? candidates.find((asset) => asset.concept === "portrait_closeup")
    ?? candidates.find((asset) => asset.concept === "scene_main")
    ?? candidates.find((asset) => asset.concept === "prop_main")
    ?? candidates[0];
}

function getStoryboardBoardBlobKey(state: StoryboardState): string | undefined {
  const selectedMode = getStoryboardBoardSelectedMode(state.storyboardBoard);
  const variant = getStoryboardBoardVariant(state.storyboardBoard, selectedMode);
  return variant?.visualBoardBlobKey || variant?.blobKey || variant?.lightweightBlobKey;
}

function getStep4PromptText(state?: StoryboardState): string {
  return compactText([
    state?.seedanceFinalVideoPrompt,
    state?.videoSubmitPromptOverride,
    state?.compactVideoPrompt,
    state?.prompt?.rawText,
    state?.correctedScript,
    state?.storyboard.content,
  ], "\n\n");
}

function getVideoSubmitPromptText(state: StoryboardState): string {
  return compactText([
    state.videoSubmitPromptOverride,
    state.seedanceFinalVideoPrompt,
    state.compactVideoPrompt,
    state.prompt?.rawText,
    state.storyboard.content,
  ], "\n\n");
}

function makeLabelNode(id: string, x: number, y: number, text: string, width = 360): Node {
  return {
    id,
    type: CANVAS_NODE_TYPES.textAnnotation,
    position: { x, y },
    data: {
      displayName: "流程说明",
      text,
      fontSize: 14,
      width,
      sourceKind: XIAKEMAN_PROJECT_SOURCE_KIND,
      sourceStep: "summary",
    },
  };
}

function profileToCharacterItem(profileName: string, project: Project): ImportedCharacterItem {
  const profile = project.characterProfiles.find((item) => item.name === profileName);
  const asset = pickAssetForName(project.assetLibrary ?? [], "character", profileName);
  return {
    id: `character-${sanitizeId(profileName)}`,
    name: profileName,
    hair: profile?.hairStyle || "",
    face: compactText([profile?.faceFeatures, profile?.skinTone], "，"),
    body: compactText([profile?.ageAppearance, profile?.bodyBuild, profile?.temperament], "，"),
    upperClothing: profile?.defaultOutfit || "",
    lowerClothing: "",
    shoes: "",
    accessories: profile?.accessories || "",
    styleType: "2d-anime",
    imageUrl: getAssetDisplayUrl(asset),
    isGenerating: false,
    rawText: asset?.optimizedPrompt || profile?.step3Description || profile?.visualAnchor || profile?.description || "",
    sourceAssetId: asset?.id,
    sourceAssetBlobKey: asset?.thumbnailUrl || asset?.externalImageUrl ? undefined : asset?.blobKey,
  };
}

function sceneInfoToSceneItem(sceneName: string, chapter: Chapter, project: Project): ImportedSceneItem {
  const scene = chapter.analysis?.scenes.find((item) => item.name === sceneName);
  const asset = pickAssetForName(project.assetLibrary ?? [], "scene", sceneName);
  return {
    id: `scene-${sanitizeId(sceneName)}`,
    name: sceneName,
    type: scene?.spaceScale || scene?.environment || "",
    environment: compactText([scene?.environment, scene?.layout, scene?.keySetPieces], "，"),
    lighting: compactText([scene?.timeOfDay, scene?.lighting, scene?.weather, scene?.colorTone], "，"),
    atmosphere: scene?.atmosphere || "",
    viewAngle: "front",
    styleType: "2d-anime",
    imageUrl: getAssetDisplayUrl(asset),
    isGenerating: false,
    rawText: asset?.optimizedPrompt || scene?.step3Description || scene?.environment || "",
    sourceAssetId: asset?.id,
    sourceAssetBlobKey: asset?.thumbnailUrl || asset?.externalImageUrl ? undefined : asset?.blobKey,
  };
}

function propInfoToPropItem(propName: string, project: Project): ImportedPropItem {
  const prop = project.propTracking.find((item) => item.propName === propName);
  const asset = pickAssetForName(project.assetLibrary ?? [], "prop", propName);
  return {
    id: `prop-${sanitizeId(propName)}`,
    name: propName,
    appearance: compactText([prop?.appearanceDesc, prop?.shapeStructure, prop?.color, prop?.condition], "，"),
    material: compactText([prop?.material, prop?.texture], "，"),
    details: compactText([prop?.size, prop?.holder, prop?.stateChanges, prop?.visualAnchor], "，"),
    styleType: "2d-anime",
    imageUrl: getAssetDisplayUrl(asset),
    isGenerating: false,
    rawText: asset?.optimizedPrompt || prop?.step3Description || prop?.appearanceDesc || "",
    sourceAssetId: asset?.id,
    sourceAssetBlobKey: asset?.thumbnailUrl || asset?.externalImageUrl ? undefined : asset?.blobKey,
  };
}

function getChapterScriptSource(chapter: Chapter): {
  scriptText: string;
  sourceScriptField: "rawScript" | "adaptedScript";
} {
  const rawScript = chapter.rawScript?.trim() ?? "";
  const adaptedScript = chapter.adaptedScript?.trim() ?? "";
  if (chapter.scriptType === "novel" && adaptedScript) {
    return { scriptText: adaptedScript, sourceScriptField: "adaptedScript" };
  }
  return { scriptText: rawScript || adaptedScript, sourceScriptField: rawScript ? "rawScript" : "adaptedScript" };
}

function storyboardStateToScriptFrame(state: StoryboardState, index: number): ScriptFrame {
  const storyboard = state.storyboard ?? ({} as StoryboardInfo);
  const duration = parseDurationSeconds(state.smartVideoDurationSeconds ?? storyboard.duration);
  const sceneDescription = joinDefined([
    storyboard.content,
    state.seedanceFinalVideoPrompt,
    state.videoSubmitPromptOverride,
    state.compactVideoPrompt,
    state.sourceExcerptSummary,
  ]);

  return {
    shotNumber: Number(storyboard.number) || index + 1,
    duration,
    sceneDescription: sceneDescription || storyboard.name || `分镜 ${index + 1}`,
    shotType: storyboard.shotSize || "",
    cameraAngle: "",
    cameraMovement: "",
    characterAction: storyboard.content || "",
    emotion: "",
    dialogue: storyboard.dialogue || "",
    lighting: "",
    sceneTag: storyboard.scene || "",
    sound: "",
    character: Array.isArray(storyboard.characters) ? storyboard.characters.join("、") : "",
    characterDesc: "",
  };
}

function scriptFrameToStoryboardFrame(frame: ScriptFrame, index: number, state?: StoryboardState): StoryboardFrame {
  const notes = joinDefined([
    frame.shotType,
    frame.cameraAngle,
    frame.cameraMovement,
    frame.dialogue ? `对白：${frame.dialogue}` : "",
    frame.sound ? `音效：${frame.sound}` : "",
    state?.status ? `Step4：${state.status}` : "",
  ]);
  return {
    index,
    label: `镜头 ${frame.shotNumber || index + 1}`,
    description: getStep4PromptText(state) || frame.sceneDescription || frame.characterAction || "",
    notes,
    imageUrl: null,
    duration: parseDurationSeconds(frame.duration),
  };
}

function extractCharacters(frames: ScriptFrame[], project: Project): CharacterEntity[] {
  const profileMap = new Map(project.characterProfiles.map((profile) => [profile.name, profile]));
  const shotMap = new Map<string, number[]>();
  for (const frame of frames) {
    for (const name of splitNames(frame.character)) {
      const shots = shotMap.get(name) ?? [];
      shots.push(frame.shotNumber || shots.length + 1);
      shotMap.set(name, shots);
    }
  }
  return Array.from(shotMap.entries()).map(([name, shotNumbers]) => {
    const profile = profileMap.get(name);
    return {
      name,
      description: profile?.step3Description || profile?.visualAnchor || profile?.description || "",
      shotNumbers,
    };
  });
}

function extractScenes(frames: ScriptFrame[]): SceneEntity[] {
  const sceneMap = new Map<string, number[]>();
  for (const frame of frames) {
    const sceneName = frame.sceneTag?.trim();
    if (!sceneName) continue;
    const shots = sceneMap.get(sceneName) ?? [];
    shots.push(frame.shotNumber || shots.length + 1);
    sceneMap.set(sceneName, shots);
  }
  return Array.from(sceneMap.entries()).map(([name, shotNumbers]) => ({
    name,
    description: "",
    shotNumbers,
  }));
}

function makeChapterNodes(
  project: Project,
  chapter: Chapter,
  chapterIndex: number,
  rowY: number,
  options: Required<Pick<XiakemanCanvasBuildOptions, "imageApiConfig" | "videoApiConfig">>,
): { nodes: Node[]; edges: Edge[]; storyboardCount: number; assetCount: number; videoCount: number; rowHeight: number } {
  const baseId = `xkm-${sanitizeId(project.id)}-${sanitizeId(chapter.id)}`;
  const labelNodeId = `${baseId}-label`;
  const scriptNodeId = `${baseId}-script`;
  const resultNodeId = `${baseId}-script-result`;
  const characterNodeId = `${baseId}-characters`;
  const sceneNodeId = `${baseId}-scenes`;
  const propNodeId = `${baseId}-props`;
  const storyboardNodeId = `${baseId}-storyboard`;
  const compositionNodeId = `${baseId}-video-composition`;
  const title = chapter.title || `章节 ${chapterIndex + 1}`;
  const { scriptText, sourceScriptField } = getChapterScriptSource(chapter);
  const frames = chapter.storyboards.map(storyboardStateToScriptFrame);
  const storyboardFrames = frames.map((frame, index) => scriptFrameToStoryboardFrame(frame, index, chapter.storyboards[index]));
  const characterNames = uniq([
    ...(chapter.analysis?.allCharacterNames ?? []),
    ...frames.flatMap((frame) => splitNames(frame.character)),
  ]);
  const sceneNames = uniq([
    ...(chapter.analysis?.scenes ?? []).map((scene) => scene.name).filter(Boolean),
    ...frames.map((frame) => frame.sceneTag).filter(Boolean),
  ]);
  const propNames = uniq((project.propTracking ?? [])
    .filter((prop) => prop.needsImage !== false)
    .map((prop) => prop.propName)
    .filter(Boolean));
  const imageModel = getCanvasImageModel(options.imageApiConfig);
  const videoDefaults = getCanvasVideoDefaults(options.videoApiConfig);
  const videoColumns = 4;
  const videoRows = Math.max(1, Math.ceil(chapter.storyboards.length / videoColumns));
  const rowHeight = Math.max(960, videoRows * 270 + 260);

  const sharedSource = {
    sourceKind: XIAKEMAN_PROJECT_SOURCE_KIND,
    sourceProjectId: project.id,
    sourceChapterId: chapter.id,
  };

  const nodes: Node[] = [
    makeLabelNode(
      labelNodeId,
      120,
      rowY - 64,
      `${title}\nStep1 剧本 → Step2 分镜/分析 → Step3 角色场景道具 → Step4 故事板提示词 → Step5 视频生成`,
      580,
    ),
    {
      id: scriptNodeId,
      type: CANVAS_NODE_TYPES.script,
      position: { x: 120, y: rowY },
      data: {
        displayName: `${title} - 剧本`,
        scriptText,
        frames,
        isGenerating: false,
        providerId: "grsai",
        model: CANVAS_DEFAULT_CHAT_MODEL,
        width: 520,
        height: 460,
        sourceScriptField,
        sourceStep: "step1",
        ...sharedSource,
      },
    },
    {
      id: resultNodeId,
      type: CANVAS_NODE_TYPES.scriptResult,
      position: { x: 740, y: rowY },
      data: {
        displayName: `${title} - 分镜表(${frames.length}镜)`,
        frames,
        characters: extractCharacters(frames, project),
        scenes: extractScenes(frames),
        sourceScriptNodeId: scriptNodeId,
        width: 960,
        height: 620,
        sourceStep: "step2",
        ...sharedSource,
      },
    },
    {
      id: characterNodeId,
      type: CANVAS_NODE_TYPES.character,
      position: { x: 1780, y: rowY },
      data: {
        displayName: `${title} - Step3 角色素材`,
        items: characterNames.map((name) => profileToCharacterItem(name, project)),
        sourceScriptNodeId: scriptNodeId,
        providerId: "artlist",
        model: imageModel,
        requestAspectRatio: "3:4",
        size: options.imageApiConfig.defaultImageSize || "2K",
        generateCount: 1,
        width: 480,
        height: 540,
        sourceStep: "step3",
        ...sharedSource,
      },
    },
    {
      id: sceneNodeId,
      type: CANVAS_NODE_TYPES.scene,
      position: { x: 2300, y: rowY },
      data: {
        displayName: `${title} - Step3 场景素材`,
        items: sceneNames.map((name) => sceneInfoToSceneItem(name, chapter, project)),
        sourceScriptNodeId: scriptNodeId,
        providerId: "artlist",
        model: imageModel,
        requestAspectRatio: "16:9",
        size: options.imageApiConfig.defaultImageSize || "2K",
        generateCount: 1,
        width: 480,
        height: 540,
        sourceStep: "step3",
        ...sharedSource,
      },
    },
    {
      id: propNodeId,
      type: CANVAS_NODE_TYPES.prop,
      position: { x: 2820, y: rowY },
      data: {
        displayName: `${title} - Step3 道具素材`,
        items: propNames.map((name) => propInfoToPropItem(name, project)),
        sourceScriptNodeId: scriptNodeId,
        providerId: "artlist",
        model: imageModel,
        requestAspectRatio: "1:1",
        size: options.imageApiConfig.defaultImageSize || "2K",
        generateCount: 1,
        width: 480,
        height: 540,
        sourceStep: "step3",
        ...sharedSource,
      },
    },
    {
      id: storyboardNodeId,
      type: CANVAS_NODE_TYPES.storyboardGen,
      position: { x: 3360, y: rowY },
      data: {
        displayName: `${title} - Step4 故事板/提示词`,
        imageUrl: null,
        aspectRatio: "16:9",
        isSizeManuallyAdjusted: false,
        rows: frames.length > 6 ? 3 : 2,
        cols: frames.length > 8 ? 4 : 3,
        frames: storyboardFrames,
        overallAspectRatio: "16:9",
        cellAspectRatio: "16:9",
        aspectRatioMode: "overall",
        model: imageModel,
        provider: "artlist",
        providerId: "artlist",
        isGenerating: false,
        styleType: "2d-anime",
        width: 620,
        height: 560,
        sourceStep: "step4",
        sourceStoryboardBoardBlobKey: chapter.storyboards.map(getStoryboardBoardBlobKey).find(Boolean),
        ...sharedSource,
      },
    },
    {
      id: compositionNodeId,
      type: CANVAS_NODE_TYPES.videoComposition,
      position: { x: 5160, y: rowY },
      data: {
        displayName: `${title} - Step5 视频合成`,
        videoPaths: chapter.storyboards.map((state) => state.videoUrl).filter((url): url is string => !!url),
        composedVideoUrl: null,
        compositionMode: "sequential",
        isComposing: false,
        error: null,
        clipEdits: [],
        isEditorOpen: false,
        selectedClipIndex: 0,
        width: 520,
        height: 420,
        sourceStep: "step5",
        ...sharedSource,
      },
    },
  ];

  const edges: Edge[] = [
    {
      id: `${scriptNodeId}-to-${resultNodeId}`,
      source: scriptNodeId,
      target: resultNodeId,
      type: "dataFlow",
    },
    {
      id: `${resultNodeId}-to-${characterNodeId}`,
      source: resultNodeId,
      target: characterNodeId,
      type: "dataFlow",
    },
    {
      id: `${resultNodeId}-to-${sceneNodeId}`,
      source: resultNodeId,
      target: sceneNodeId,
      type: "dataFlow",
    },
    {
      id: `${resultNodeId}-to-${propNodeId}`,
      source: resultNodeId,
      target: propNodeId,
      type: "dataFlow",
    },
    {
      id: `${resultNodeId}-to-${storyboardNodeId}`,
      source: resultNodeId,
      target: storyboardNodeId,
      type: "dataFlow",
    },
    {
      id: `${characterNodeId}-to-${storyboardNodeId}`,
      source: characterNodeId,
      target: storyboardNodeId,
      type: "dataFlow",
    },
    {
      id: `${sceneNodeId}-to-${storyboardNodeId}`,
      source: sceneNodeId,
      target: storyboardNodeId,
      type: "dataFlow",
    },
    {
      id: `${propNodeId}-to-${storyboardNodeId}`,
      source: propNodeId,
      target: storyboardNodeId,
      type: "dataFlow",
    },
  ];

  chapter.storyboards.forEach((state, storyboardIndex) => {
    const videoNodeId = `${baseId}-video-${storyboardIndex + 1}`;
    const col = storyboardIndex % videoColumns;
    const row = Math.floor(storyboardIndex / videoColumns);
    const prompt = getVideoSubmitPromptText(state);
    nodes.push({
      id: videoNodeId,
      type: CANVAS_NODE_TYPES.video,
      position: { x: 4040 + col * 260, y: rowY + row * 270 },
      data: {
        displayName: `Step5 镜头 ${storyboardIndex + 1}`,
        imageUrl: null,
        aspectRatio: videoDefaults.aspectRatio,
        isSizeManuallyAdjusted: false,
        prompt,
        model: state.videoBackend === "seedancecloud" || !state.videoBackend ? videoDefaults.model : videoDefaults.model,
        provider: videoDefaults.providerId,
        providerId: videoDefaults.providerId,
        size: videoDefaults.size,
        requestAspectRatio: videoDefaults.aspectRatio,
        extraParams: {
          duration: state.videoSubmitDuration ?? state.smartVideoDurationSeconds ?? videoDefaults.duration,
          sourceStatus: state.videoStatus ?? "idle",
          sourceTaskId: state.videoTaskId,
          storyboardNumber: state.storyboard.number,
        },
        isGenerating: state.videoStatus === "submitting" || state.videoStatus === "polling",
        generationStartedAt: state.videoSubmittedAt ?? null,
        generationDurationMs: state.videoSubmittedAt && state.videoCompletedAt ? state.videoCompletedAt - state.videoSubmittedAt : null,
        videoUrl: state.videoUrl ?? null,
        videoMode: state.referenceVideo ? "videoReference" : state.imageRefs.length > 0 || state.useStoryboardBoardReference ? "fullReference" : "text2video",
        width: 240,
        height: 360,
        sourceStep: "step5",
        sourceStoryboardIndex: storyboardIndex,
        sourceVideoBlobKey: state.videoBlobKey,
        ...sharedSource,
      },
    });
    edges.push({
      id: `${storyboardNodeId}-to-${videoNodeId}`,
      source: storyboardNodeId,
      target: videoNodeId,
      type: "dataFlow",
    });
    edges.push({
      id: `${videoNodeId}-to-${compositionNodeId}`,
      source: videoNodeId,
      target: compositionNodeId,
      type: "dataFlow",
    });
  });

  return {
    nodes,
    edges,
    storyboardCount: frames.length,
    assetCount: characterNames.length + sceneNames.length + propNames.length,
    videoCount: chapter.storyboards.length,
    rowHeight,
  };
}

export function buildCanvasFromXiakemanProject(
  project: Project,
  options: XiakemanCanvasBuildOptions = {},
): XiakemanCanvasBuildResult {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let storyboardCount = 0;
  let assetCount = 0;
  let videoCount = 0;
  let rowY = 120;

  project.chapters.forEach((chapter, chapterIndex) => {
    const built = makeChapterNodes(
      project,
      chapter,
      chapterIndex,
      rowY,
      {
        imageApiConfig: options.imageApiConfig ?? {},
        videoApiConfig: options.videoApiConfig ?? {},
      },
    );
    nodes.push(...built.nodes);
    edges.push(...built.edges);
    storyboardCount += built.storyboardCount;
    assetCount += built.assetCount;
    videoCount += built.videoCount;
    rowY += built.rowHeight;
  });

  return {
    nodes,
    edges,
    chapterCount: project.chapters.length,
    storyboardCount,
    assetCount,
    videoCount,
  };
}

export function frameToStoryboardInfo(
  frame: ScriptFrame,
  existing: StoryboardInfo | undefined,
  index: number,
): StoryboardInfo {
  const notes = joinDefined([
    frame.cameraAngle ? `机位：${frame.cameraAngle}` : "",
    frame.cameraMovement ? `运动：${frame.cameraMovement}` : "",
    frame.lighting ? `光影：${frame.lighting}` : "",
    frame.sound ? `音效：${frame.sound}` : "",
    frame.characterDesc ? `角色描述：${frame.characterDesc}` : "",
    existing?.notes,
  ]);

  return {
    number: Number(frame.shotNumber) || existing?.number || index + 1,
    name: existing?.name || `分镜 ${index + 1}`,
    duration: `${parseDurationSeconds(frame.duration, parseDurationSeconds(existing?.duration))}秒`,
    shotSize: frame.shotType || existing?.shotSize || "",
    scene: frame.sceneTag || existing?.scene,
    characters: splitNames(frame.character).length > 0 ? splitNames(frame.character) : (existing?.characters ?? []),
    content: frame.sceneDescription || frame.characterAction || existing?.content || "",
    dialogue: frame.dialogue || existing?.dialogue,
    notes: notes || existing?.notes,
  };
}

export function getImportedNodeData(node: Node): ImportedCanvasNodeData {
  return (node.data ?? {}) as ImportedCanvasNodeData;
}
