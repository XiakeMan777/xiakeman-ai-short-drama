import type {
  Choreography,
  CharacterBlockingState,
  SpatialBlockingSnapshot,
  SpatialContinuityIssue,
  StoryboardInfo,
} from '@/types';

function cleanCharacterName(value: string | undefined) {
  return (value ?? '')
    .replace(/\(图片\d+\)/g, '')
    .replace(/参考图片\d+/g, '')
    .replace(/[【】]/g, '')
    .trim();
}

function normalizeText(value: string | undefined) {
  return (value ?? '').replace(/\s+/g, '').trim();
}

function buildAllowedCharacterSet(allowedNames?: Iterable<string | undefined | null>) {
  const allowedSet = new Set<string>();
  for (const rawName of allowedNames ?? []) {
    const name = normalizeText(cleanCharacterName(rawName ?? ''));
    if (name) allowedSet.add(name);
  }
  return allowedSet;
}

function sameScene(a?: string, b?: string) {
  if (!a || !b) return false;
  return normalizeText(a) === normalizeText(b);
}

function getCoarsePositionAxes(value: string | undefined) {
  const text = normalizeText(value)
    .replace(/(特写|近景|中景|远景|全景|半身|大景|空镜|镜头|画面)/g, '');
  const horizontal = /左/.test(text)
    ? 'left'
    : /右/.test(text)
      ? 'right'
      : /(居中|正中|中央|中间|中心)/.test(text)
        ? 'center'
        : '';
  const vertical = /上/.test(text)
    ? 'up'
    : /下/.test(text)
      ? 'down'
      : '';
  const depth = /(前景|前排|前方|前侧|靠前|左前|右前|近侧|近处|近端|临桌|桌前)/.test(text)
    ? 'front'
    : /(后景|后排|后方|后侧|靠后|左后|右后|远处|远端)/.test(text)
      ? 'back'
      : '';
  return { horizontal, vertical, depth };
}

function arePositionsEquivalentForContinuity(previous: string | undefined, current: string | undefined) {
  if (normalizeText(previous) === normalizeText(current)) return true;

  const prevAxes = getCoarsePositionAxes(previous);
  const currentAxes = getCoarsePositionAxes(current);
  let comparableAxes = 0;
  for (const axis of ['horizontal', 'vertical', 'depth'] as const) {
    if (!prevAxes[axis] || !currentAxes[axis]) continue;
    comparableAxes += 1;
    if (prevAxes[axis] !== currentAxes[axis]) return false;
  }

  return comparableAxes > 0;
}

function getPointDistance(
  previous: { x: number; y: number } | undefined,
  current: { x: number; y: number } | undefined,
) {
  if (!previous || !current) return null;
  if (!Number.isFinite(previous.x) || !Number.isFinite(previous.y) || !Number.isFinite(current.x) || !Number.isFinite(current.y)) {
    return null;
  }
  return Math.hypot(previous.x - current.x, previous.y - current.y);
}

function hasVisiblePositionTransition(value: string | undefined) {
  return /移动|走|跑|冲|退|侧身|转身|上前|后撤|跨|绕|推|拉|被拖|跌|倒|跪|站起|起身|滑|靠近|靠向|挪|移步|从.+到|由.+到/.test(value ?? '');
}

function hasPositionPathTransition(value: string | undefined) {
  return /移动|走|跑|冲|退|上前|后撤|跨|绕|挪|站起|起身|移步|从.+到|由.+到/.test(value ?? '');
}

const NON_FACING_TRIGGER_RE = /(?:听见|听到|听完|看到|看见|察觉|闻声|等到|落键|回车|敲键|按键|开口|说完|回应)[^，。；、,.]*?后/g;
const GAZE_DIRECTION_TARGET_RE = /((?:目光|视线)(?:轻|微|略)?偏[左右前后上下正]+)朝[^身体头脸视线目光]+/g;

function normalizeFacingForContinuity(value: string | undefined) {
  const text = normalizeText(value)
    .replace(NON_FACING_TRIGGER_RE, '')
    .replace(/towards?/gi, '朝')
    .replace(/(^|[^A-Za-z])to(?=[^A-Za-z]|$)/gi, '$1朝')
    .replace(GAZE_DIRECTION_TARGET_RE, '$1')
    .replace(/[，。；、,.]/g, '')
    .replace(/(已经|已|仍然|仍|保持|维持|持续|开场|落幅|最后|最终)/g, '')
    .replace(/(目光|视线)(轻|微|略)?偏/g, '$1朝')
    .replace(/(轻|微|略)?回看/g, '看向')
    .replace(/(轻|微|略)?抬/g, '')
    .replace(/(头部|头|脸部|脸|视线|目光)(已)?(转向|朝向|面向|看向|望向|朝|对准|转到)/g, '头朝')
    .replace(/(身体|身位|躯干)(仍)?(朝向|面向|朝|保持朝向)/g, '身体朝')
    .replace(/(面向|朝向|朝|看向|望向|转向|转头看向)/g, '朝')
    .replace(/的/g, '')
    .replace(/一侧/g, '侧')
    .replace(/右后方/g, '右后侧')
    .replace(/左后方/g, '左后侧')
    .replace(/正前方/g, '前')
    .replace(/前方/g, '前');

  const headTarget = text.match(/头朝([^身体]+?)(?=身体|$)/)?.[1] ?? '';
  const bodyTarget = text.match(/身体朝(.+)$/)?.[1] ?? '';
  if (headTarget || bodyTarget) {
    return [
      headTarget ? `头:${headTarget}` : '',
      bodyTarget ? `身:${bodyTarget}` : '',
    ].filter(Boolean).join('|');
  }

  return text;
}

function areFacingsEquivalentForContinuity(previous: string | undefined, current: string | undefined) {
  const prevFacing = normalizeFacingForContinuity(previous);
  const currentFacing = normalizeFacingForContinuity(current);
  if (!prevFacing || !currentFacing) return true;
  return prevFacing === currentFacing;
}

export function filterSpatialBlockingCharacters(
  blocking: SpatialBlockingSnapshot | null | undefined,
  allowedNames?: Iterable<string | undefined | null>,
): SpatialBlockingSnapshot | undefined {
  if (!blocking) return undefined;
  const allowedSet = buildAllowedCharacterSet(allowedNames);
  if (allowedSet.size === 0) return blocking;
  return {
    ...blocking,
    characters: (blocking.characters ?? []).filter((character) =>
      allowedSet.has(normalizeText(cleanCharacterName(character.character))),
    ),
  };
}

export function buildSceneSpatialBible(storyboard: StoryboardInfo, sceneDetail?: {
  timeOfDay?: string;
  environment?: string;
  colorTone?: string;
} | null) {
  const parts = [
    storyboard.scene ? `场景名：${storyboard.scene}` : '',
    sceneDetail?.timeOfDay ? `时间：${sceneDetail.timeOfDay}` : '',
    sceneDetail?.environment ? `固定环境锚点：${sceneDetail.environment}` : '',
    sceneDetail?.colorTone ? `色调：${sceneDetail.colorTone}` : '',
  ].filter(Boolean);

  return parts.join('；');
}

export function summarizeSpatialBlocking(blocking?: SpatialBlockingSnapshot | null) {
  if (!blocking) return '';

  const characterLines = (blocking.characters ?? [])
    .filter((item) => item.character && item.position)
    .map((item) => [
      `${cleanCharacterName(item.character)}=${item.position}`,
      item.facing ? `朝向${item.facing}` : '',
      item.posture ? `姿态${item.posture}` : '',
      item.heldProps?.length ? `持有${item.heldProps.join('、')}` : '',
      item.notes ? item.notes : '',
    ].filter(Boolean).join('，'));

  const propLines = (blocking.props ?? [])
    .filter((item) => item.prop)
    .map((item) => [
      `${item.prop}`,
      item.holder ? `持有者${item.holder}` : '',
      item.position ? `位置${item.position}` : '',
      item.state ? `状态${item.state}` : '',
    ].filter(Boolean).join('，'));

  return [
    blocking.sceneName ? `场景：${blocking.sceneName}` : '',
    blocking.sceneAnchor ? `空间母版：${blocking.sceneAnchor}` : '',
    blocking.cameraAxis ? `机位轴线：${blocking.cameraAxis}` : '',
    characterLines.length ? `人物站位：${characterLines.join('；')}` : '',
    propLines.length ? `道具站位：${propLines.join('；')}` : '',
    blocking.continuityNotes ? `连续性备注：${blocking.continuityNotes}` : '',
  ].filter(Boolean).join('\n');
}

function normalizeBlockingCharacter(action: {
  character?: string;
  position?: string;
  facing?: string;
  posture?: string;
  heldProps?: string[];
  action?: string;
}, fallbackPosition = ''): CharacterBlockingState | null {
  const character = cleanCharacterName(action.character);
  if (!character) return null;

  return {
    character,
    position: action.position || fallbackPosition || '未标注位置',
    facing: action.facing,
    posture: action.posture,
    heldProps: action.heldProps,
    notes: action.action,
  };
}

function snapshotFromSegment(
  choreography: Choreography,
  segmentIndex: number,
  sceneName?: string,
): SpatialBlockingSnapshot | null {
  const segment = choreography.timeSegments?.[segmentIndex];
  if (!segment?.actions?.length) return null;

  const characters = segment.actions
    .map((action) => normalizeBlockingCharacter(action))
    .filter((item): item is CharacterBlockingState => !!item);

  if (characters.length === 0) return null;

  return {
    sceneName,
    sceneAnchor: choreography.sceneAnchor,
    cameraAxis: choreography.cameraAxis,
    characters,
    continuityNotes: segment.actionFlow,
  };
}

export function resolveChoreographyStartBlocking(
  choreography: Choreography | null | undefined,
  sceneName?: string,
) {
  if (!choreography) return null;
  return choreography.startBlocking ?? snapshotFromSegment(choreography, 0, sceneName);
}

export function resolveChoreographyEndBlocking(
  choreography: Choreography | null | undefined,
  sceneName?: string,
) {
  if (!choreography) return null;
  const lastIndex = Math.max(0, (choreography.timeSegments?.length ?? 1) - 1);
  return choreography.endBlocking ?? snapshotFromSegment(choreography, lastIndex, sceneName);
}

function findCharacter(blocking: SpatialBlockingSnapshot, name: string) {
  const normalized = normalizeText(cleanCharacterName(name));
  return blocking.characters.find((item) => normalizeText(cleanCharacterName(item.character)) === normalized);
}

export function validateSpatialContinuity(
  previous: SpatialBlockingSnapshot | null | undefined,
  currentStart: SpatialBlockingSnapshot | null | undefined,
  options: { strictSameScene?: boolean; allowedCharacterNames?: Iterable<string | undefined | null> } = {},
): SpatialContinuityIssue[] {
  if (!previous || !currentStart) return [];
  if (options.strictSameScene !== false && previous.sceneName && currentStart.sceneName && !sameScene(previous.sceneName, currentStart.sceneName)) {
    return [];
  }

  const allowedSet = buildAllowedCharacterSet(options.allowedCharacterNames);
  const issues: SpatialContinuityIssue[] = [];
  for (const prevCharacter of previous.characters ?? []) {
    if (allowedSet.size > 0 && !allowedSet.has(normalizeText(cleanCharacterName(prevCharacter.character)))) {
      continue;
    }
    const current = findCharacter(currentStart, prevCharacter.character);
    if (!current) {
      issues.push({
        character: prevCharacter.character,
        type: 'missing-character',
        message: `${prevCharacter.character} 上一镜落幅在 ${prevCharacter.position}，下一镜开场缺少该角色站位。`,
      });
      continue;
    }

    const pointDistance = getPointDistance(prevCharacter.positionPoint, current.positionPoint);
    if (pointDistance !== null && pointDistance > 0.22) {
      const transitionNotes = [current.notes, currentStart.continuityNotes].filter(Boolean).join('\n');
      if (!hasVisiblePositionTransition(transitionNotes) && !hasPositionPathTransition(current.position)) {
        issues.push({
          character: prevCharacter.character,
          type: 'position-jump',
          message: `${prevCharacter.character} 上一镜落幅定位点为「${Math.round(prevCharacter.positionPoint!.x * 100)}%, ${Math.round(prevCharacter.positionPoint!.y * 100)}%」，下一镜开场定位点为「${Math.round(current.positionPoint!.x * 100)}%, ${Math.round(current.positionPoint!.y * 100)}%」，缺少移动过渡。`,
        });
      }
      continue;
    }

    if (prevCharacter.position && current.position && !arePositionsEquivalentForContinuity(prevCharacter.position, current.position)) {
      const transitionNotes = [current.notes, currentStart.continuityNotes].filter(Boolean).join('\n');
      const hasTransition = hasVisiblePositionTransition(transitionNotes)
        || hasPositionPathTransition(current.position);
      if (!hasTransition) {
        issues.push({
          character: prevCharacter.character,
          type: 'position-jump',
          message: `${prevCharacter.character} 上一镜落幅位置为「${prevCharacter.position}」，下一镜开场为「${current.position}」，缺少移动过渡。`,
        });
      }
    }

    if (prevCharacter.facing && current.facing && !areFacingsEquivalentForContinuity(prevCharacter.facing, current.facing)) {
      const hasTurn = /转身|转头|回头|侧身|扭头|抬头|低头|偏头/.test(current.notes ?? '');
      if (!hasTurn) {
        issues.push({
          character: prevCharacter.character,
          type: 'facing-jump',
          message: `${prevCharacter.character} 上一镜朝向「${prevCharacter.facing}」，下一镜开场朝向「${current.facing}」，缺少转向过渡。`,
        });
      }
    }
  }

  return issues;
}
