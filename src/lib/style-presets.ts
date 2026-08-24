/** 风格预设选项 */
export interface StylePreset {
  value: string;
  label: string;
}

export type VisualStyleMedium = 'live_action' | 'stylized_3d' | '2d_anime' | 'hybrid';

export interface VisualStylePreset {
  id: string;
  label: string;
  legacyText: string;
  medium: VisualStyleMedium;
  render: string;
  material: string;
  lighting: string;
  characterRule: string;
  allow: string[];
  forbid: string[];
  risk?: string;
  deprecated?: boolean;
}

export const THREE_D_ANIME_CHARACTER_STYLE_CONFIG =
  '3D动漫游戏级角色设定，PBR材质，服装结构可读，真实cosplay服装逻辑，电影级布光';

export const THREE_D_CYBERPUNK_STYLE_CONFIG =
  '3D动漫赛博朋克科幻CG电影质感';

export const LIVE_ACTION_XIANXIA_STYLE_CONFIG =
  '写实仿真人仙侠玄幻电影质感';

export const THREE_D_XIANXIA_STYLE_CONFIG =
  '3D国漫仙侠玄幻CG电影质感';

/** 结构化视觉风格预设。代码稳定使用 id，旧项目继续兼容 legacyText。 */
export const VISUAL_STYLE_PRESETS: VisualStylePreset[] = [
  {
    id: 'photoreal_cinematic',
    label: '超写实仿真人',
    legacyText: '超写实仿真人电影级质感',
    medium: 'live_action',
    render: '超写实仿真人，电影级画面质感',
    material: '真实皮肤、真实衣料、真实发丝、真实金属/布料反光',
    lighting: '电影级真实光影，保留自然明暗层次',
    characterRule: '角色应像真人影视剧角色，不转成动漫脸或3D卡通比例',
    allow: ['超写实', '仿真人', '电影级', '真实光影', '真实皮肤质感'],
    forbid: ['2D日漫', '二次元', '3D国漫CG', 'toon-shaded', '非真人照片'],
  },
  {
    id: 'stylized_3d_guoman_xuanji',
    label: '3D国漫玄机风格',
    legacyText: '3D国漫玄机风格CG级渲染质感',
    medium: 'stylized_3d',
    render: '3D国漫CG，玄机风格，动画电影级角色比例',
    material: 'PBR材质，服装结构清楚，皮肤干净但非真人毛孔级',
    lighting: 'CG电影级布光，柔和轮廓光，高级渲染层次',
    characterRule: '角色为风格化3D国漫，不生成真人棚拍或演员定妆照',
    allow: ['3D国漫', 'CG级渲染', 'PBR', '动画电影角色', '游戏级角色设定'],
    forbid: ['真人照片', '真人棚拍', '写实演员', '皮肤毛孔级真人写实', '2D平面赛璐璐'],
  },
  {
    id: 'stylized_3d_game_anime',
    label: '3D动漫游戏级角色设定',
    legacyText: THREE_D_ANIME_CHARACTER_STYLE_CONFIG,
    medium: 'stylized_3d',
    render: '3D动漫游戏CG，角色设定图级完成度',
    material: 'PBR材质，服装可建模，结构可读，可落地为cosplay服装',
    lighting: '电影级布光，清晰轮廓光，角色展示友好',
    characterRule: '强化主角剪影、签名色块、装备锚点，不走真人证件照',
    allow: ['3D动漫', '游戏级角色', 'PBR材质', '角色设定图', 'cosplay服装逻辑'],
    forbid: ['真人证件照', '真人棚拍', '写实演员', '2D日漫平涂'],
  },
  {
    id: 'two_d_anime',
    label: '2D日漫二次元',
    legacyText: '2D日漫二次元动画风格',
    medium: '2d_anime',
    render: '2D日漫动画，线条清晰，二次元角色比例',
    material: '平面动画质感，色块清楚，不强调真实PBR材质',
    lighting: '动画式光影，干净明暗块面，可有赛璐璐阴影',
    characterRule: '角色应保持2D动画脸和线稿感，不转成3D雕塑或真人摄影',
    allow: ['2D日漫', '二次元', '动画风格', '线条感', '赛璐璐'],
    forbid: ['3D国漫CG', 'PBR材质', '真人皮肤质感', 'live-action', 'photoreal'],
  },
  {
    id: 'live_action_costume_idol',
    label: '写实古装偶像剧 S+',
    legacyText: '写实仿真人古装偶像剧S+级大制作质感',
    medium: 'live_action',
    render: '写实仿真人古装偶像剧，S+级影视质感',
    material: '真实古装衣料、刺绣、发饰、金属配饰、妆发质感',
    lighting: '古装剧电影级布光，柔光补面，精致棚拍/实景质感',
    characterRule: '角色像古装影视剧演员，不变成国漫或2D动画',
    allow: ['写实仿真人', '古装偶像剧', 'S+级制作', '真实妆发', '影视质感'],
    forbid: ['3D国漫CG硬锁', '2D日漫', 'toon-shaded', '非真人照片'],
  },
  {
    id: 'live_action_xianxia_fantasy',
    label: '写实仙侠玄幻',
    legacyText: LIVE_ACTION_XIANXIA_STYLE_CONFIG,
    medium: 'live_action',
    render: '写实仿真人仙侠玄幻，影视剧电影质感',
    material: '真实古装衣料、法器金属/玉石、烟雾、山门、云雾与少量可控能量光',
    lighting: '电影级玄幻光效，真实环境光为主，灵力光只作为特效层',
    characterRule: '角色像真人仙侠影视剧演员，不转成3D国漫比例或2D动画脸',
    allow: ['写实仿真人', '仙侠', '玄幻', '影视剧', '电影级光效'],
    forbid: ['3D国漫CG硬锁', '2D日漫', 'toon-shaded', '非真人照片'],
  },
  {
    id: 'hybrid_xianxia_guoman_live',
    label: '仙侠玄幻混合质感（旧项目兼容）',
    legacyText: '写实仿真人3D国漫仙侠玄幻质感',
    medium: 'hybrid',
    render: '写实仿真人与3D国漫之间的仙侠玄幻质感',
    material: '真实衣料与CG仙侠材质并存，法器、灵光、织物都要清晰',
    lighting: '电影级玄幻光效，仙侠能量光与真实环境光统一',
    characterRule: '必须明确偏写实还是偏3D，否则容易冲突',
    allow: ['仙侠', '玄幻', '写实仿真人', '3D国漫', '电影级光效'],
    forbid: ['2D日漫', '纯真人摄影硬锁', '纯3D国漫硬锁'],
    risk: '混合真人与3D国漫，后续建议拆成写实仙侠和3D国漫仙侠两个独立预设。',
    deprecated: true,
  },
  {
    id: 'live_action_wasteland_fantasy',
    label: '写实废土玄幻融合',
    legacyText: '写实仿真人废土玄幻融合电影质感',
    medium: 'live_action',
    render: '写实仿真人废土电影质感，混合少量玄幻能量元素',
    material: '破败工业材质、脏污衣料、金属锈蚀、医疗/废土道具',
    lighting: '低饱和电影光影，冷硬环境光，局部能量光',
    characterRule: '人物保持写实影视质感，玄幻只作为世界观视觉元素',
    allow: ['写实仿真人', '废土', '玄幻融合', '破败工业', '电影质感'],
    forbid: ['2D日漫', '纯3D国漫CG', '卡通皮肤', 'toon-shaded'],
  },
  {
    id: 'live_action_modern_drama',
    label: '写实现代都市剧',
    legacyText: '写实仿真人现代都市剧电影质感',
    medium: 'live_action',
    render: '写实仿真人现代都市短剧，电影级质感',
    material: '现代服装、城市空间、真实皮肤、真实布料与玻璃金属材质',
    lighting: '都市电影光影，自然室内外光，夜景霓虹可控',
    characterRule: '角色像现代影视剧演员，不动漫化、不3D卡通化',
    allow: ['写实仿真人', '现代都市剧', '电影质感', '真实服装', '真实光影'],
    forbid: ['3D国漫', '2D日漫', 'PBR角色设定板', '非真人照片'],
  },
  {
    id: 'live_action_boss_romance',
    label: '现代霸总偶像剧',
    legacyText: '写实仿真人现代霸总偶像剧电影质感',
    medium: 'live_action',
    render: '写实仿真人现代都市偶像剧，高级商业空间与情感拉扯质感',
    material: '西装、礼服、玻璃幕墙、豪车、酒店、办公空间真实材质',
    lighting: '都市冷暖对比，夜景霓虹，室内柔光补面',
    characterRule: '角色像现代影视剧演员，不动漫化、不3D卡通化',
    allow: ['霸总', '现代都市', '高奢空间', '偶像剧', '电影质感'],
    forbid: ['3D国漫', '2D日漫', '卡通脸', 'PBR角色设定板'],
  },
  {
    id: 'live_action_campus_youth',
    label: '青春校园剧',
    legacyText: '写实仿真人青春校园剧清透电影质感',
    medium: 'live_action',
    render: '写实青春校园，干净清透，日常真实但有偶像剧审美',
    material: '校服、书本、教室、操场、雨天走廊、阳光窗帘真实材质',
    lighting: '自然日光、浅色柔光、低对比清透色调',
    characterRule: '少年感真实自然，不转成二次元或过度网红脸',
    allow: ['青春校园', '清透', '自然光', '少年感', '日常电影感'],
    forbid: ['3D国漫CG', '超厚滤镜', '赛博霓虹', '古装质感'],
  },
  {
    id: 'live_action_suspense_crime',
    label: '悬疑犯罪电影感',
    legacyText: '写实仿真人悬疑犯罪冷峻电影质感',
    medium: 'live_action',
    render: '写实悬疑犯罪，冷峻、压迫、电影化',
    material: '雨夜街道、审讯室、旧楼道、档案、警戒线、金属与混凝土材质',
    lighting: '低照度、硬侧光、冷青灰色调、强阴影层次',
    characterRule: '人物保持真人影视质感，表演克制，不动漫化',
    allow: ['悬疑', '犯罪', '冷峻电影感', '低照度', '硬光阴影'],
    forbid: ['甜宠柔光', '2D日漫', '3D国漫', '过度梦幻滤镜'],
  },
  {
    id: 'live_action_republic_era',
    label: '民国复古传奇',
    legacyText: '写实仿真人民国复古传奇电影质感',
    medium: 'live_action',
    render: '写实民国复古，传奇感、年代感、电影质感',
    material: '旗袍、西装、老洋楼、木质家具、黄铜、旧报纸、胶片颗粒',
    lighting: '暖黄室内灯、窗外冷光、胶片质感、复古低饱和',
    characterRule: '角色像民国影视剧演员，不变成国漫或插画',
    allow: ['民国', '复古', '旗袍', '老上海', '胶片电影感'],
    forbid: ['现代都市霓虹', '2D日漫', '3D国漫CG', '未来科技'],
  },
  {
    id: 'live_action_medical_drama',
    label: '现代医疗职场',
    legacyText: '写实仿真人现代医疗职场剧电影质感',
    medium: 'live_action',
    render: '写实现代医疗职场，专业、紧张、干净可信',
    material: '白大褂、手术室、病房、监护仪、金属器械、玻璃隔断',
    lighting: '医院冷白光、无影灯、干净高亮但保留电影层次',
    characterRule: '人物真实可信，职业感优先，不做偶像剧过度磨皮',
    allow: ['医疗', '职场', '手术室', '专业感', '冷白光'],
    forbid: ['玄幻能量光', '3D国漫', '2D日漫', '古装质感'],
  },
  {
    id: 'stylized_3d_cyberpunk',
    label: '3D赛博科幻',
    legacyText: THREE_D_CYBERPUNK_STYLE_CONFIG,
    medium: 'stylized_3d',
    render: '风格化3D赛博科幻，游戏CG级角色与城市质感',
    material: '机械义体、霓虹、金属、玻璃、发光接口、战术服PBR材质',
    lighting: '高对比霓虹光、蓝紫红色边缘光、雨夜反射',
    characterRule: '角色为3D动漫/游戏CG，不生成真人棚拍或2D平涂',
    allow: ['3D动漫', '赛博朋克', '科幻', 'PBR', '霓虹城市'],
    forbid: ['真人皮肤毛孔级写实', '2D日漫平涂', '古装偶像剧'],
  },
  {
    id: 'stylized_3d_wuxia_xianxia',
    label: '3D国漫仙侠',
    legacyText: THREE_D_XIANXIA_STYLE_CONFIG,
    medium: 'stylized_3d',
    render: '3D国漫仙侠玄幻，动画电影级CG质感',
    material: '织锦、薄纱、金属法器、灵光、山门、云雾、水面PBR材质',
    lighting: '仙侠能量光、柔和轮廓光、云雾体积光',
    characterRule: '角色是3D国漫比例，不混入真人演员定妆照',
    allow: ['3D国漫', '仙侠', '玄幻', '法器', 'CG电影感'],
    forbid: ['写实真人棚拍', '2D日漫', '现代都市', '真人皮肤毛孔'],
  },
  {
    id: 'two_d_guofeng_ink',
    label: '2D国风水墨动画',
    legacyText: '2D国风水墨动画电影质感',
    medium: '2d_anime',
    render: '2D国风动画，水墨、线条、留白、东方色彩',
    material: '宣纸纹理、墨色晕染、扁平色块、古风服饰线稿',
    lighting: '水墨式明暗关系，不强调真实PBR和真人皮肤',
    characterRule: '角色保持2D国风动画脸和线条感，不转3D或真人',
    allow: ['2D国风', '水墨', '线稿', '留白', '东方动画'],
    forbid: ['3D国漫CG', '真人照片', 'PBR材质', '写实皮肤质感'],
  },
  {
    id: 'live_action_hk_crime',
    label: '港风警匪',
    legacyText: '写实仿真人港风警匪电影质感',
    medium: 'live_action',
    render: '写实港风警匪，街头压迫、动作片电影感',
    material: '霓虹招牌、窄巷、旧楼、皮衣、西装、车辆、雨夜地面',
    lighting: '高反差夜景、霓虹反射、冷暖混合硬光',
    characterRule: '人物保持真人动作电影质感，不动漫化',
    allow: ['港风', '警匪', '雨夜', '街头', '动作电影感'],
    forbid: ['2D日漫', '3D国漫', '古装仙侠', '清透校园柔光'],
  },
  {
    id: 'live_action_rural_period',
    label: '年代乡土现实剧',
    legacyText: '写实仿真人年代乡土现实剧电影质感',
    medium: 'live_action',
    render: '写实年代乡土，粗粝真实，生活质感强',
    material: '土墙、旧木门、棉布衣、搪瓷盆、粮袋、泥地、老家具',
    lighting: '自然天光、煤油灯/钨丝灯暖光、低饱和现实主义色调',
    characterRule: '角色真实朴素，不偶像化、不动漫化、不高奢滤镜',
    allow: ['年代感', '乡土', '现实主义', '粗粝', '生活质感'],
    forbid: ['霸总高奢', '赛博霓虹', '3D国漫', '2D日漫'],
  },
];

/** 预设风格列表，供现有 Select 组件兼容使用。 */
export const STYLE_PRESETS: StylePreset[] = VISUAL_STYLE_PRESETS
  .filter((preset) => !preset.deprecated)
  .map((preset) => ({
    value: preset.legacyText,
    label: preset.label,
  }));

/** 所有预设 value 的集合，用于判断是否为自定义风格 */
export const STYLE_PRESET_VALUES = new Set(STYLE_PRESETS.map((p) => p.value));

/** 判断是否为自定义风格（不在预设列表中） */
export function isCustomStyle(styleConfig: string | undefined): boolean {
  return !styleConfig || !STYLE_PRESET_VALUES.has(styleConfig);
}

export function resolveStep1StyleConfig(styleConfig: string | undefined, sourceText: string): string {
  const currentStyle = (styleConfig ?? '').trim();
  const source = sourceText.trim();
  if (!source) return currentStyle;

  const hasCyberpunkIntent =
    /赛博|朋克|霓虹|义体|机械义体|机械臂|驾驶舱|星核|星渊核心|权限诊断|权限倒计时/i.test(source);
  const hasExplicitThreeDAnimeIntent =
    /3D动漫|3D国漫|国漫科幻|动漫短剧|动漫剧本|游戏级角色设定|PBR材质|角色设定图/i.test(source);
  const hasMechaSciFiIntent =
    /科幻机甲|机甲|AI|能量槽|能量纹|接口/i.test(source);
  const hasThreeDXianxiaIntent =
    /3D国漫仙侠|3D.*仙侠|国漫.*仙侠|CG.*仙侠/i.test(source);
  const isLikelyLiveActionOrAncientPreset =
    !currentStyle || /写实仿真人|仙侠玄幻|古装偶像剧|现代都市剧/.test(currentStyle);

  if (hasCyberpunkIntent && isLikelyLiveActionOrAncientPreset) {
    return THREE_D_CYBERPUNK_STYLE_CONFIG;
  }

  if (hasThreeDXianxiaIntent && isLikelyLiveActionOrAncientPreset) {
    return THREE_D_XIANXIA_STYLE_CONFIG;
  }

  if ((hasExplicitThreeDAnimeIntent || hasMechaSciFiIntent) && isLikelyLiveActionOrAncientPreset) {
    return THREE_D_ANIME_CHARACTER_STYLE_CONFIG;
  }

  if (!currentStyle) {
    if (/2D国风|国风水墨|水墨动画|水墨/i.test(source)) return '2D国风水墨动画电影质感';
    if (/2D|日漫|二次元/i.test(source)) return '2D日漫二次元动画风格';
    if (/霸总|总裁|豪门|联姻|契约婚|高奢|boss_romance/i.test(source)) return '写实仿真人现代霸总偶像剧电影质感';
    if (/校园|校霸|同桌|高中|大学|青梅竹马|青春/i.test(source)) return '写实仿真人青春校园剧清透电影质感';
    if (/悬疑|犯罪|刑侦|凶案|追凶|审讯|警察|modern_revenge/i.test(source)) return '写实仿真人悬疑犯罪冷峻电影质感';
    if (/民国|旗袍|军阀|老上海|租界/i.test(source)) return '写实仿真人民国复古传奇电影质感';
    if (/医疗|医院|医生|手术|病房|急诊|male_medical_master/i.test(source)) return '写实仿真人现代医疗职场剧电影质感';
    if (/港风|警匪|卧底|黑帮|社团/i.test(source)) return '写实仿真人港风警匪电影质感';
    if (/年代|乡土|农村|村里|知青|七十年代|八十年代/i.test(source)) return '写实仿真人年代乡土现实剧电影质感';
    if (/仙侠|玄幻|修仙|宗门|灵根|法器|飞剑|xianxia/i.test(source)) return LIVE_ACTION_XIANXIA_STYLE_CONFIG;
    if (/古风|古装|宫斗|权谋|ancient_|palace_intrigue/i.test(source)) return '写实仿真人古装偶像剧S+级大制作质感';
    if (/都市|现代|male_power_fantasy|male_war_god_dragon|male_son_in_law|male_treasure_appraisal|family_ethics|mystic_fengshui/i.test(source)) return '写实仿真人现代都市剧电影质感';
  }

  return currentStyle;
}
