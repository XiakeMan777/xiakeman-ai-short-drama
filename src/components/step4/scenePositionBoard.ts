import type {
  CharacterBlockingState,
  Choreography,
  ScenePositionBoardPoint,
  SceneSpatialMasterView,
  SpatialBlockingSnapshot,
  StoryboardState,
} from '@/types';
import { getSceneSpatialMasterViewLabel } from '@/lib/sceneSpatialMasterState';
import { getFrameDisplayLabel, normalizeFrameRatio, type FrameRatio } from '@/lib/frameRatio';

export const SCENE_POSITION_BOARD_SIZE = { width: 720, height: 1280 };
export const SCENE_POSITION_BOARD_IMAGE_SIZE = '2K' as const;
const SCENE_POSITION_BOARD_SIZES: Record<FrameRatio, { width: number; height: number }> = {
  '9:16': SCENE_POSITION_BOARD_SIZE,
  '16:9': { width: 1280, height: 720 },
};

const POSITION_COLORS: Array<{ colorName: string; colorHex: string }> = [
  { colorName: '红点', colorHex: '#ef4444' },
  { colorName: '绿点', colorHex: '#22c55e' },
  { colorName: '蓝点', colorHex: '#3b82f6' },
  { colorName: '黄点', colorHex: '#eab308' },
  { colorName: '紫点', colorHex: '#a855f7' },
  { colorName: '青点', colorHex: '#06b6d4' },
];

const CROWD_PATTERN = /宾客|群演|众人|群众|路人|围观|侍者|服务员|背景/i;
const POSITION_TRANSITION_PATTERN = /移动|走|跑|冲|退|侧身|转身|上前|后撤|跨|绕|推|拉|被拖|跌|倒|跪|站起|起身|滑|靠近|靠向|挪|移步|从.+到|由.+到/;

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0.08, Math.min(0.92, value));
}

function clampPoint(point: { x: number; y: number }) {
  return {
    x: clamp01(point.x),
    y: clamp01(point.y),
  };
}

function clampPercent(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function getScenePositionBoardSize(frameRatio?: string | null) {
  return SCENE_POSITION_BOARD_SIZES[normalizeFrameRatio(frameRatio)];
}

function normalizeName(value: string) {
  return value.trim();
}

function normalizeText(value: string | undefined) {
  return (value ?? '').replace(/\s+/g, '').trim();
}

function stripPositionPointLabel(value: string | undefined) {
  return normalizeText(value).replace(/（定位点：[^）]+）/g, '').trim();
}

function stripShortDramaLayoutNote(value: string | undefined) {
  return (value ?? '')
    .split('；')
    .map((item) => item.trim())
    .filter((item) => item && !/^(?:竖屏|横屏)?短剧构图：/.test(item) && !/^(?:竖屏 9:16|横屏 16:9)成片构图：/.test(item))
    .join('；');
}

function getCoarsePositionAxes(value: string | undefined) {
  const text = stripPositionPointLabel(value)
    .replace(/(特写|近景|中景|远景|全景|半身|大景|空镜|镜头|画面|定位点)/g, '');
  const horizontal = /左/.test(text)
    ? 'left'
    : /右/.test(text)
      ? 'right'
      : /(居中|正中|中央|中间|中心|主位|中)/.test(text)
        ? 'center'
        : '';
  const depth = /(前景|前排|前方|前侧|靠前|左前|右前|近侧|近处|近端|临桌|桌前|桌边|前)/.test(text)
    ? 'front'
    : /(后景|后排|后方|后侧|靠后|左后|右后|远处|远端|门口|后)/.test(text)
      ? 'back'
      : '';
  return { horizontal, depth };
}

function hasExplicitPositionAxis(value: string | undefined) {
  const axes = getCoarsePositionAxes(value);
  return !!axes.horizontal || !!axes.depth;
}

function arePositionTextsCompatible(previous: string | undefined, current: string | undefined) {
  const prevAxes = getCoarsePositionAxes(previous);
  const currentAxes = getCoarsePositionAxes(current);

  for (const axis of ['horizontal', 'depth'] as const) {
    if (prevAxes[axis] && currentAxes[axis] && prevAxes[axis] !== currentAxes[axis]) {
      return false;
    }
  }

  return true;
}

function findBlockingCharacter(
  blocking: SpatialBlockingSnapshot | null | undefined,
  character: string,
) {
  const normalized = normalizeName(character);
  return blocking?.characters?.find((item) => normalizeName(item.character) === normalized);
}

function hasSameScene(
  previous: SpatialBlockingSnapshot | null | undefined,
  current: SpatialBlockingSnapshot | null | undefined,
) {
  if (!previous?.sceneName || !current?.sceneName) return true;
  return normalizeText(previous.sceneName) === normalizeText(current.sceneName);
}

function hasPositionTransitionIntent(
  character: CharacterBlockingState,
  blocking?: SpatialBlockingSnapshot | null,
) {
  return POSITION_TRANSITION_PATTERN.test([
    character.position,
    character.notes,
    character.facing,
    character.posture,
    blocking?.continuityNotes,
  ].filter(Boolean).join(' '));
}

function shouldReusePreviousPoint(
  character: CharacterBlockingState,
  previous: CharacterBlockingState | undefined,
  currentBlocking?: SpatialBlockingSnapshot | null,
) {
  if (!previous?.positionPoint || character.positionPoint) return false;
  if (hasPositionTransitionIntent(character, currentBlocking)) return false;

  const currentPosition = stripPositionPointLabel(character.position);
  const previousPosition = stripPositionPointLabel(previous.position);
  if (!currentPosition) return true;
  if (!previousPosition) return !hasExplicitPositionAxis(currentPosition);
  return arePositionTextsCompatible(previousPosition, currentPosition);
}

export function getScenePositionColor(
  character: string,
  allCharacterNames: readonly string[] = [],
) {
  const normalized = normalizeName(character);
  if (normalized === '沈念') return POSITION_COLORS[0];

  const stableNames = Array.from(
    new Set(allCharacterNames.map(normalizeName).filter(Boolean).filter((name) => !CROWD_PATTERN.test(name))),
  );
  const orderedNames = stableNames.length > 0
    ? stableNames
    : [normalized];
  const nonLeadNames = orderedNames.filter((name) => name !== '沈念');
  const index = Math.max(0, nonLeadNames.indexOf(normalized));
  return POSITION_COLORS[(index % (POSITION_COLORS.length - 1)) + 1];
}

export function isScenePositionBoardCharacter(name: string) {
  return !!normalizeName(name) && !CROWD_PATTERN.test(name);
}

export function inferPointFromPosition(
  position: string | undefined,
  fallbackIndex: number,
  total: number,
): { x: number; y: number } {
  const text = position ?? '';
  let x = total > 1 ? 0.18 + (0.64 * fallbackIndex) / Math.max(1, total - 1) : 0.5;
  let y = 0.58;

  const hasLeft = /左/.test(text);
  const hasRight = /右/.test(text);
  if (hasLeft) x = 0.26;
  if (hasRight) x = 0.74;
  if (!hasLeft && !hasRight && /居中|正中|中央|中间|中心|正面|主位/.test(text)) x = 0.5;
  if (/前景|近景|桌边|桌前|前/.test(text)) y = 0.68;
  if (/中景|中段|侧席|主位/.test(text)) y = 0.52;
  if (/后景|背景|后方|门口|后/.test(text)) y = 0.36;
  if (/站/.test(text) && !/前景|近景/.test(text)) y -= 0.06;
  if (/坐|座/.test(text)) y += 0.06;

  return { x: clamp01(x), y: clamp01(y) };
}

export function formatScenePositionPoint(point: { x: number; y: number }): string {
  const { x, y } = clampPoint(point);
  const horizontal = x < 0.38 ? '左' : x > 0.62 ? '右' : '中';
  const vertical = y < 0.42 ? '上' : y > 0.64 ? '下' : '';
  const depth = y > 0.64 ? '前景' : y < 0.42 ? '后景' : '中景';
  return `${horizontal}${vertical}${depth}`;
}

export function buildShortDramaLayoutForPoint(
  point: { x: number; y: number },
  frameRatio?: string | null,
): NonNullable<ScenePositionBoardPoint['shortDramaLayout']> {
  const { x, y } = clampPoint(point);
  const targetFrameRatio = normalizeFrameRatio(frameRatio);
  const horizontal = x < 0.38 ? '左侧' : x > 0.62 ? '右侧' : '中部';
  const faceX = x < 0.38 ? '左中' : x > 0.62 ? '右中' : '中上';
  const faceTop = y > 0.64 ? 0.24 : y < 0.42 ? 0.2 : 0.22;
  const faceBottom = y > 0.64 ? 0.46 : y < 0.42 ? 0.42 : 0.44;
  const minHeight = y > 0.64 ? '画面高度45%以上' : y < 0.42 ? '画面高度30%以上' : '画面高度38%以上';
  const shotSize = y < 0.42 ? '中景偏近' : '中近景或半身中景';
  const frameLabel = targetFrameRatio === '16:9' ? '横屏' : '竖屏';
  const riskFlags: string[] = [];

  if (x < 0.18 || x > 0.82) riskFlags.push('edge-anchor');
  if (y > 0.7) riskFlags.push('foreground-low-anchor');
  if (y < 0.42) riskFlags.push('background-small-face');

  const visibilityGuards = [
    '色点代表脚下/落位点，不代表脸的位置',
    `脸部应落在${frameLabel}${faceX}安全区，约画面高度${Math.round(faceTop * 100)}%-${Math.round(faceBottom * 100)}%`,
    `主体保持${shotSize}，人物可见高度至少${minHeight}`,
  ];

  if (x < 0.18 || x > 0.82) {
    visibilityGuards.push('不要贴边裁掉肩膀、头发或半张脸');
  }
  if (y > 0.7) {
    visibilityGuards.push('前景落位不能只拍到下半身，脸必须抬到画面中上部');
  }
  if (y < 0.42) {
    visibilityGuards.push('后景落位不能缩成远处小人，脸部必须清晰可辨');
  }

  const safeXMin = clampPercent(x - 0.16, 0.12, 0.72);
  const safeXMax = clampPercent(x + 0.16, 0.28, 0.88);
  return {
    faceZone: `${horizontal}脸部安全区，脸中心约在x=${Math.round(x * 100)}%，y=${Math.round(((faceTop + faceBottom) / 2) * 100)}%`,
    framing: `${shotSize}，上半身和表情清晰，主体横向控制在画面${Math.round(safeXMin * 100)}%-${Math.round(safeXMax * 100)}%附近`,
    visibility: visibilityGuards.join('；'),
    ...(riskFlags.length ? { riskFlags } : {}),
  };
}

export function formatShortDramaLayout(
  point: ScenePositionBoardPoint | { x: number; y: number },
  frameRatio?: string | null,
): string {
  const layout = !frameRatio && 'shortDramaLayout' in point && point.shortDramaLayout
    ? point.shortDramaLayout
    : buildShortDramaLayoutForPoint(point, frameRatio);
  return `${layout.faceZone}；${layout.framing}；${layout.visibility}`;
}

function getCharacterPoint(
  character: CharacterBlockingState,
  fallbackIndex: number,
  total: number,
  previousBlocking?: SpatialBlockingSnapshot | null,
  currentBlocking?: SpatialBlockingSnapshot | null,
) {
  if (character.positionPoint) return clampPoint(character.positionPoint);

  const previous = hasSameScene(previousBlocking, currentBlocking)
    ? findBlockingCharacter(previousBlocking, character.character)
    : undefined;
  if (shouldReusePreviousPoint(character, previous, currentBlocking)) {
    return clampPoint(previous!.positionPoint!);
  }

  return inferPointFromPosition(character.position, fallbackIndex, total);
}

function getScenePositionTargetBlocking(storyboard: StoryboardState): SpatialBlockingSnapshot | undefined {
  return storyboard.choreography?.endBlocking
    ?? storyboard.spatialBlocking
    ?? storyboard.continuityOutput?.spatialBlocking
    ?? storyboard.choreography?.startBlocking
    ?? undefined;
}

function getBlockingCharacters(storyboard: StoryboardState): {
  characters: CharacterBlockingState[];
  blocking?: SpatialBlockingSnapshot;
} {
  const blocking = getScenePositionTargetBlocking(storyboard);
  const blockingCharacters = blocking?.characters ?? [];
  if (blockingCharacters.length > 0) {
    return {
      characters: blockingCharacters,
      blocking,
    };
  }
  return {
    characters: (storyboard.storyboard.characters ?? []).map((character) => ({ character, position: '' })),
    blocking: undefined,
  };
}

export function buildScenePositionBoardPoints(
  storyboard: StoryboardState,
  allCharacterNames: readonly string[] = [],
  frameRatio?: string | null,
): ScenePositionBoardPoint[] {
  const { characters, blocking } = getBlockingCharacters(storyboard);
  const candidates = characters
    .filter((item) => isScenePositionBoardCharacter(item.character));
  const limited = candidates.slice(0, 6);
  const previousBlocking = storyboard.continuityInput?.spatialBlocking ?? undefined;

  return limited.map((item, index) => {
    const color = getScenePositionColor(item.character, allCharacterNames);
    const point = getCharacterPoint(item, index, limited.length, previousBlocking, blocking);
    return {
      character: item.character,
      colorName: color.colorName,
      colorHex: color.colorHex,
      x: point.x,
      y: point.y,
      sourcePosition: stripPositionPointLabel(item.position),
      shortDramaLayout: buildShortDramaLayoutForPoint(point, frameRatio),
    };
  });
}

export function applyInferredScenePositionPointsToBlocking(
  blocking: SpatialBlockingSnapshot | null | undefined,
  previousBlocking?: SpatialBlockingSnapshot | null,
): SpatialBlockingSnapshot | undefined {
  if (!blocking) return undefined;
  const candidates = (blocking.characters ?? [])
    .filter((item) => isScenePositionBoardCharacter(item.character));
  if (candidates.length === 0) return blocking;

  const points = candidates.map((character, index) => {
    const point = getCharacterPoint(character, index, candidates.length, previousBlocking, blocking);
    return {
      character: character.character,
      colorName: '',
      colorHex: '#000000',
      x: point.x,
      y: point.y,
      sourcePosition: stripPositionPointLabel(character.position),
      shortDramaLayout: buildShortDramaLayoutForPoint(point),
    };
  });

  return applyScenePositionPointsToBlocking(blocking, points);
}

export function applyInferredScenePositionPointsToChoreography(
  choreography: Choreography | null | undefined,
  previousBlocking?: SpatialBlockingSnapshot | null,
): Choreography | null {
  if (!choreography) return choreography ?? null;

  const startBlocking = applyInferredScenePositionPointsToBlocking(
    choreography.startBlocking,
    previousBlocking,
  );
  const endBlocking = applyInferredScenePositionPointsToBlocking(
    choreography.endBlocking,
    startBlocking ?? previousBlocking,
  );

  if (startBlocking === choreography.startBlocking && endBlocking === choreography.endBlocking) {
    return choreography;
  }

  return {
    ...choreography,
    ...(startBlocking ? { startBlocking } : {}),
    ...(endBlocking ? { endBlocking } : {}),
  };
}

export function applyScenePositionPointsToBlocking(
  blocking: SpatialBlockingSnapshot | null | undefined,
  points: readonly ScenePositionBoardPoint[],
  frameRatio?: string | null,
): SpatialBlockingSnapshot | undefined {
  if (!blocking) return undefined;
  const layoutLabel = normalizeFrameRatio(frameRatio) === '16:9' ? '横屏短剧构图' : '竖屏短剧构图';
  const pointByCharacter = new Map(points.map((point) => [normalizeName(point.character), clampPoint(point)]));
  let changed = false;
  const characters = (blocking.characters ?? []).map((character) => {
    const point = pointByCharacter.get(normalizeName(character.character));
    if (!point) return character;
    changed = true;
    const pointLabel = formatScenePositionPoint(point);
    const layoutText = formatShortDramaLayout(point, frameRatio);
    const cleanPosition = stripPositionPointLabel(character.position);
    const notes = [stripShortDramaLayoutNote(character.notes), `${layoutLabel}：${layoutText}`]
      .filter(Boolean)
      .join('；');
    return {
      ...character,
      position: cleanPosition
        ? `${cleanPosition}（定位点：${pointLabel}）`
        : pointLabel,
      positionPoint: point,
      notes,
    };
  });
  if (!changed) return blocking;
  return {
    ...blocking,
    characters,
  };
}

export function applyScenePositionPointsToChoreography(
  choreography: Choreography | null | undefined,
  points: readonly ScenePositionBoardPoint[],
  frameRatio?: string | null,
): Choreography | null {
  if (!choreography) return choreography ?? null;
  const endBlocking = applyScenePositionPointsToBlocking(choreography.endBlocking, points, frameRatio);
  if (endBlocking) {
    return {
      ...choreography,
      endBlocking,
    };
  }

  const startBlocking = applyScenePositionPointsToBlocking(choreography.startBlocking, points, frameRatio);
  if (startBlocking) {
    return {
      ...choreography,
      startBlocking,
    };
  }

  return choreography;
}

export function buildScenePositionBoardPrompt(
  storyboard: StoryboardState,
  view: SceneSpatialMasterView = 'primary',
  frameRatio?: string | null,
): string {
  const targetFrameRatio = normalizeFrameRatio(frameRatio);
  const frameLabel = getFrameDisplayLabel(targetFrameRatio);
  const frameCameraInstruction = targetFrameRatio === '16:9'
    ? '短剧成片构图优先：使用接近人物视线高度或胸口高度的横屏机位，保留更宽的左右调度空间，适合后续放入清晰可见的中近景/半身人物；避免高空俯拍、远景大全景、超宽桌面占满画面、人物被边缘或陈设遮脸。'
    : '短剧成片构图优先：使用接近人物视线高度或胸口高度的竖屏机位，适合后续放入清晰可见的中近景/半身人物；避免高空俯拍、远景大全景、超宽会议桌占满画面、人物落位会被桌椅遮脸或压到画面底部。';
  const sceneName = storyboard.storyboard.scene || storyboard.choreography?.startBlocking?.sceneName || '当前场景';
  const camera = storyboard.choreography?.cameraOverview || storyboard.prompt?.cameraOverview || storyboard.storyboard.shotSize;
  const sceneAnchor = storyboard.choreography?.sceneAnchor
    || storyboard.choreography?.startBlocking?.sceneAnchor
    || storyboard.spatialBlocking?.sceneAnchor
    || '';
  const viewLabel = getSceneSpatialMasterViewLabel(view);
  const viewInstruction: Record<SceneSpatialMasterView, string> = {
    primary: '主视角：保持当前分镜最常用的正向观看角度，适合开场、正面交代和常规对话。',
    reverse: '反打视角：从主视角相反方向观察同一空间，保持同一门窗、桌椅和陈设关系，但镜头朝向反过来，适合对话反打。',
    side: '侧面视角：从空间侧面观察同一场景，强调左右关系、人物横向走位和侧身调度，适合横移、并行或侧脸镜头。',
  };

  return [
    `生成一张${frameLabel}真人短剧场景底图，只要无人环境，不出现任何人物、文字、箭头、色点或标记。`,
    frameCameraInstruction,
    '画面中上部预留人物脸部安全区，中下部保留可站立/坐下的脚下落位空间；让前景、中景、后景关系清楚，但不要为了展示空间而牺牲人物脸部可见性。',
    `场景：${sceneName}。`,
    `母版机位：${viewLabel}。${viewInstruction[view]}`,
    sceneAnchor ? `空间锚点：${sceneAnchor}。` : '',
    camera ? `镜头机位：${camera}。` : '',
    '保持参考图中的建筑结构、桌椅方向、墙面材质、灯光色温和关键陈设一致；画面要像当前分镜的视频背景，不要做设定图排版。',
  ].filter(Boolean).join('\n');
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    image.src = url;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('画布导出失败'));
    }, 'image/png');
  });
}

async function drawBaseImage(sourceBlob: Blob, frameRatio?: string | null) {
  const image = await loadImageFromBlob(sourceBlob);
  const canvas = document.createElement('canvas');
  const boardSize = getScenePositionBoardSize(frameRatio);
  canvas.width = boardSize.width;
  canvas.height = boardSize.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持画布处理');

  const targetRatio = canvas.width / canvas.height;
  const sourceRatio = image.width / image.height;
  let sx = 0;
  let sy = 0;
  let sw = image.width;
  let sh = image.height;

  if (sourceRatio > targetRatio) {
    sw = image.height * targetRatio;
    sx = (image.width - sw) / 2;
  } else {
    sh = image.width / targetRatio;
    sy = (image.height - sh) / 2;
  }

  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function createScenePositionBoardCleanBlob(
  sourceBlob: Blob,
  frameRatio?: string | null,
): Promise<Blob> {
  const canvas = await drawBaseImage(sourceBlob, frameRatio);
  return canvasToPngBlob(canvas);
}

export async function createScenePositionBoardMarkedBlob(
  cleanBlob: Blob,
  points: readonly ScenePositionBoardPoint[],
  frameRatio?: string | null,
): Promise<Blob> {
  const canvas = await drawBaseImage(cleanBlob, frameRatio);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持画布处理');

  points.forEach((point) => {
    const x = point.x * canvas.width;
    const y = point.y * canvas.height;
    const radius = 16;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = point.colorHex;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  });

  return canvasToPngBlob(canvas);
}
