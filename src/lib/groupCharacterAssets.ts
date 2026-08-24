import type { ImageConcept } from '@/types';

export type CharacterMultiplicity = 'single' | 'group';

const GROUP_NAME_PATTERN = /(学生群|同学群|院生群|学员群|弟子群|人群|众人|群众|群体|群像|围观者|观众|游客|旅客|居民|路人|学生们|同学们|院生们|学员们|弟子们|护卫队|守卫队|巡逻队|卫兵队|士兵队|小队|队伍|班级|手下|随从|门徒|村民|镇民|群演)/;
const GROUP_SUFFIX_PATTERN = /(群像|群|们|队|团|班)$/;
const SINGULAR_ROLE_PATTERN = /(队长|班长|首领|头目|负责人|院监|老师|导师|长老|将军|指挥官)$/;

function normalizeName(value: string | undefined) {
  return (value ?? '').replace(/[*`#\s]/g, '').trim();
}

export function isGroupCharacterName(name: string | undefined) {
  const normalized = normalizeName(name);
  if (!normalized || SINGULAR_ROLE_PATTERN.test(normalized)) return false;
  return GROUP_NAME_PATTERN.test(normalized) || GROUP_SUFFIX_PATTERN.test(normalized);
}

export function getCharacterMultiplicity(name: string | undefined): CharacterMultiplicity {
  return isGroupCharacterName(name) ? 'group' : 'single';
}

export function getGroupCharacterConceptMeta(concept: ImageConcept) {
  switch (concept) {
    case 'portrait_closeup':
      return {
        label: '群像基础图',
        desc: '竖屏群体身份参考图：同一阵营 6-12 人同框，统一服装体系，不做单人大特写',
      };
    case 'landscape_turnaround':
      return {
        label: '群像设定图',
        desc: '横屏群体设定板：多人阵列、服装规则、层级差异和整体阵营气质，不做单人角色设定表',
      };
    case 'portrait_outfit':
      return {
        label: '群像变装图',
        desc: '竖屏群体服装版本图：多人同框展示同一批角色的新服装状态',
      };
    case 'landscape_outfit_turnaround':
      return {
        label: '群像变装设定图',
        desc: '横屏群体变装设定板：多人阵列展示同一阵营的新服装规则和差异',
      };
    default:
      return undefined;
  }
}

export function buildGroupCharacterPrompt(input: {
  name: string;
  description: string;
  styleConfig?: string;
  concept?: ImageConcept;
}) {
  const name = input.name.trim() || '群体角色';
  const description = input.description.trim() || name;
  const style = input.styleConfig?.trim();
  const isLandscape = input.concept === 'landscape_turnaround' || input.concept === 'landscape_outfit_turnaround';
  const isOutfit = input.concept === 'portrait_outfit' || input.concept === 'landscape_outfit_turnaround';

  const shared = [
    style,
    `群体角色参考图，主题：${name}`,
    `基础描述：${description}`,
    '必须画出 6-12 个清晰可辨的不同人物，同一阵营、同一学校/组织/班级体系，服装规则统一但脸型、发型、身高、体态、表情和小配饰有差异。',
    '画面要让人一眼看出这是一个群体，而不是一个主角；可以前后两排、半圆站位、阶梯式站位或队列站位。',
    '每个人都要有完整头肩或半身/全身轮廓，至少 5 张脸清楚可见；不要把背景路人画成模糊影子。',
    '群体气质要服务短剧：有压迫感、围观感、误判感或集体站队感，但不要做具体打斗剧情截图。',
    '绝对禁止只出现一个人，禁止单人头像，禁止单人大特写，禁止单人角色设定表，禁止把群像合并成一个代表人物。',
    '如果项目风格要求3D动漫/风格化3D动画，群像中的每个人都必须保持统一的3D动画角色质感；禁止真人照片、真人群演棚拍、cosplay照片和写实演员脸。',
  ].filter(Boolean);

  if (isLandscape) {
    return [
      ...shared,
      isOutfit
        ? '16:9 横屏 GROUP OUTFIT REFERENCE SHEET，展示这批人的当前服装版本。'
        : '16:9 横屏 GROUP CAST REFERENCE SHEET，展示这批人的基础阵营形象。',
      '版式：上方小标题栏写 GROUP CAST REFERENCE；主体是多人阵列大图，旁边可以有 2-3 个服装材质/徽章/队列层级小窗。',
      '多人阵列占画面主体，不能被单个超大脸部特写挤掉；不使用 FACE HERO CLOSE-UP、FRONT VIEW、BACK VIEW 这类单人设定表结构。',
      '输出为高清 4K 群像设定板，严格服从项目风格；电影级布光，人物比例自然，服装结构可读，禁止真人摄影感。',
    ].join('\n');
  }

  return [
    ...shared,
    isOutfit
      ? '9:16 竖屏群像变装参考图，展示这批人的当前服装版本。'
      : '9:16 竖屏群像基础参考图，展示这批人的集体身份和站队气质。',
    '构图：前景 3-4 人、中景 4-6 人、后景少量人物，形成真实群体层次；不要让任何单人脸部占画面 40% 以上。',
    '输出为竖屏短剧可用群像资产，严格服从项目风格；人物不糊，服装和阵营特征清楚，禁止真人摄影感。',
  ].join('\n');
}

export function enforceGroupCharacterPromptGuards(prompt: string, concept?: ImageConcept) {
  const meta = getGroupCharacterConceptMeta(concept ?? 'portrait_closeup');
  return [
    prompt,
    meta ? `用途：${meta.desc}` : '',
    '群像硬约束：必须多人同框，至少 6 人；不得只画一个人；不得套用单人角色锁定模板；不得出现“只出现一名角色、无群像、无第二个人”等单人限制。',
  ].filter(Boolean).join('\n');
}
