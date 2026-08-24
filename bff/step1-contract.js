const STEP1_STYLE_PRESETS = [
  '超写实仿真人电影级质感',
  '3D国漫玄机风格CG级渲染质感',
  '3D动漫游戏级角色设定，PBR材质，服装结构可读，真实cosplay服装逻辑，电影级布光',
  '2D日漫二次元动画风格',
  '写实仿真人古装偶像剧S+级大制作质感',
  '写实仿真人仙侠玄幻电影质感',
  '写实仿真人废土玄幻融合电影质感',
  '写实仿真人现代都市剧电影质感',
  '写实仿真人现代霸总偶像剧电影质感',
  '写实仿真人青春校园剧清透电影质感',
  '写实仿真人悬疑犯罪冷峻电影质感',
  '写实仿真人民国复古传奇电影质感',
  '写实仿真人现代医疗职场剧电影质感',
  '3D动漫赛博朋克科幻CG电影质感',
  '3D国漫仙侠玄幻CG电影质感',
  '2D国风水墨动画电影质感',
  '写实仿真人港风警匪电影质感',
  '写实仿真人年代乡土现实剧电影质感',
];

const STEP1_FIELD_CONTRACT = [
  {
    key: 'projectName',
    type: 'string',
    label: '项目名称',
    promptText: '从剧本标题或正文中提炼最自然的项目名。没有明确标题时，使用简短自然的临时标题，不要额外添加宣传副标题。',
  },
  {
    key: 'styleConfig',
    type: 'string',
    label: '风格配置',
    promptText: `优先从以下预设中选择最匹配的一项：${STEP1_STYLE_PRESETS.join('、')}。题材明显是霸总、校园、悬疑犯罪、民国、医疗、港风、年代乡土、赛博科幻、3D仙侠或2D国风水墨时，优先选择对应预设。如果原文明确出现 3D动漫、3D国漫、游戏级、PBR、角色设定、科幻机甲、机械义体、驾驶舱或 AI 辅助机制，优先选择“3D动漫游戏级角色设定，PBR材质，服装结构可读，真实cosplay服装逻辑，电影级布光”或更具体的“3D动漫赛博朋克科幻CG电影质感”，不要仅因玄幻、星核、剑纹等元素选择写实仿真人仙侠玄幻。只有都不匹配时，再基于剧情给出一句简短风格描述。`,
  },
  {
    key: 'scenes',
    type: 'array',
    itemType: 'object',
    label: '场景清单',
    promptText: '提取可被后续反复复用的稳定场景锚点，目标不是剧情摘要，而是可供 Step3 直接生图的纯环境场景画像。每个 scenes[].name 都必须至少被一个 storyboards[].scene 引用；如果只是从门缝、窗口、远景中短暂看见的背景空间，合并写入当前主场景的 environment/layout，不要拆成独立场景资产。场景资产应无人、无人影、无人形，不写角色动作或剧情截图瞬间。',
    itemFields: [
      { key: 'name', type: 'string', required: true, promptText: '场景名称，必须稳定、可复用。' },
      { key: 'timeOfDay', type: 'string', required: true, promptText: '时间段，如白天、黄昏、深夜；无法判断时输出空字符串。' },
      { key: 'environment', type: 'string', required: true, promptText: '完整环境描述，至少覆盖空间用途、关键陈设或地貌、主要材质、空间压迫感或开放感。可以写这个空间用于什么，但不要把正在行动的人物写入环境本体。' },
      { key: 'colorTone', type: 'string', required: true, promptText: '主色、冷暖倾向与光线质感，不要只写抽象情绪词。' },
      { key: 'characters', type: 'array', itemType: 'string', required: true, promptText: '该场景明确出现过的具体角色名数组；不要把分镜标题、动作、事件、关系或状态短语当角色，例如“背刺同门”“重生醒来”“推门逃离”都不得进入。' },
      { key: 'spaceScale', type: 'string', required: true, promptText: '空间尺度，如狭窄卧室、开阔院落、半开放仓库；无法判断时输出空字符串。' },
      { key: 'layout', type: 'string', required: true, promptText: '空间布局，优先写前景/中景/后景关系、左右分区、出入口、视线焦点；视线焦点应是环境、陈设、建筑或地貌，不要写角色站位/躺卧/持物动作。' },
      { key: 'keySetPieces', type: 'string', required: true, promptText: '最关键的陈设、建筑部件、地貌锚点或标志物。' },
      { key: 'lighting', type: 'string', required: true, promptText: '主要光源方向、亮度、硬软光特征和氛围。' },
      { key: 'weather', type: 'string', required: true, promptText: '天气、烟雾、水汽、尘土、风雪等环境状态；没有就输出空字符串。' },
      { key: 'atmosphere', type: 'string', required: true, promptText: '场景压力感或氛围，如冷肃、压抑、旷远、暧昧，但要尽量和视觉状态绑定。' },
      { key: 'step3Description', type: 'string', required: true, promptText: '给 Step3 直接使用的一段综合场景描述，需把 environment、layout、lighting、weather、colorTone 串成一句纯环境无人场景设定图文本。禁止出现角色名、人物、人影、人形、伤员、士兵、医务人员、尸体、持枪/持剑人影、打斗/背刺/躺卧等剧情截图瞬间；只写空间布局、关键陈设、材质、光线、天气/烟雾和色调。' },
      { key: 'inferredFields', type: 'array', itemType: 'string', required: true, promptText: '哪些场景字段是基于剧情做的保守补全，如 ["lighting", "layout"]；完全无补全则输出空数组。' },
    ],
  },
  {
    key: 'storyboards',
    type: 'array',
    itemType: 'object',
    label: '分镜清单',
    promptText: '逐个分镜提取结构化信息，确保编号、时长、景别、场景归属和出场角色稳定可追踪。storyboards[].shotSize 必须根据画面功能保守推断一个可执行景别，不要留空。storyboards[].characters 必须只引用 allCharacterNames 中已经存在的稳定角色名或稳定群体称谓，禁止把动作、身体部位、道具状态、镜头描述、关系短语写成角色。',
    itemFields: [
      { key: 'number', type: 'number', required: true, promptText: '分镜编号，必须是数字。若原文是“1-1/1-2”这类子分镜标题，按出现顺序映射为 1、2、3……，不要直接输出子编号。' },
      { key: 'name', type: 'string', required: true, promptText: '分镜名称。' },
      { key: 'duration', type: 'string', required: true, promptText: '单分镜时长，保留秒数表达，如“15秒”。' },
      { key: 'shotSize', type: 'string', required: true, promptText: '景别，必须输出一个可直接指导镜头的值，如“大全景”“全景”“中景”“近景”“特写”“俯拍近景”“手持跟拍中景”。原文没有明写时，根据该分镜的画面功能保守推断：建环境用全景/大全景，对话对攻用中景/近景，伤口/道具/眼神钩子用特写或近景；不要输出空字符串。' },
      { key: 'scene', type: 'string', required: true, promptText: '所属场景名，必须能对齐 scenes[].name。' },
      { key: 'characters', type: 'array', itemType: 'string', required: true, promptText: '该分镜明确出场的具体角色名数组；只能填写 allCharacterNames 中已有的角色名或稳定群体称谓。不要写语音通道、抽象组织、剧情动作、事件、关系、身体部位或道具状态短语，例如“对白”“台词”“内心OS”“系统播报”“守备队”“背刺同门”“穿胸一剑”“围攻”“剑身仍与后方同门连贯相接”“出手后迅速后撤”“指尖压上绷带”都不是角色名。未命名、只承担环境反应或一句台词的小角色，优先合并为稳定群像角色，如“医务棚伤员群像”“医务点杂工”；只有持续参与冲突、需要特写或会跨分镜复用的人物才单独创建甲/乙/丙。' },
    ],
  },
  {
    key: 'allCharacterNames',
    type: 'array',
    itemType: 'string',
    label: '角色总表',
    promptText: '输出去重后的完整角色名数组，只收具体人物或稳定可复用的群体角色称谓。不要混入系统提示词、旁白/对白/台词/内心OS/系统播报等语音通道标签、抽象组织名、分镜标题、动作、事件、关系、身体部位、道具状态或镜头描述短语；例如“对白”“守备队”“背刺同门”“重生醒来”“穿胸一剑”“推门逃离”“围攻”“剑身仍与后方同门连贯相接”“出手后迅速后撤”“指尖压上绷带”都不是角色名。未命名、只承担背景反应或短句功能的小角色不要逐个拆成甲乙丙，优先合并成稳定群像角色；只有持续参与冲突、需要特写或会跨分镜复用的人物才单独建名。',
  },
  {
    key: 'characterProfiles',
    type: 'array',
    itemType: 'object',
    label: '角色画像表',
    promptText: '为每个主要角色生成可供 Step2 复核、Step3 直接调用的稳定视觉画像。允许基于时代、身份、处境做保守视觉补全，但不得新增剧情事实。可分离武器/道具必须拆到 propTracking，不要写进角色定妆、基础服装、配饰或变装服装。',
    itemFields: [
      { key: 'name', type: 'string', required: true, promptText: '角色名，必须来自 allCharacterNames，且必须是具体人物/稳定群体称谓，不得是动作事件短语。' },
      { key: 'description', type: 'string', required: true, promptText: '综合角色描述，覆盖外观、气质、服装锚点和表演锚点。' },
      { key: 'ageAppearance', type: 'string', required: true, promptText: '年龄感，如“二十出头”“三十岁上下”“少年感”，无法判断则输出空字符串。' },
      { key: 'temperament', type: 'string', required: true, promptText: '人物气质，如清冷、凌厉、温软、油滑，但要尽量贴合剧情姿态。' },
      { key: 'bodyBuild', type: 'string', required: true, promptText: '体型、身形、站姿印象，如高瘦、挺拔、圆润、单薄。' },
      { key: 'faceFeatures', type: 'string', required: true, promptText: '五官辨识点、面部结构、神态锚点。' },
      { key: 'hairStyle', type: 'string', required: true, promptText: '发型、发色、束发方式、刘海或头饰信息。' },
      { key: 'skinTone', type: 'string', required: true, promptText: '肤色或肤感，没有依据时输出空字符串。' },
      { key: 'defaultOutfit', type: 'string', required: true, promptText: '最主要的一套服装锚点，应与 outfitTracking 保持一致。只写衣物、护甲、鞋靴、发型/头饰、不可分离配饰；不要写手持、肩挂、背负、佩戴的武器/枪械/刀剑/棍棒/法器或其他可分离道具。' },
      { key: 'accessories', type: 'string', required: true, promptText: '稳定配饰、耳饰、冠饰、腰饰等；没有就输出空字符串。不要把武器、枪械、刀剑、棍棒、法器、手持物或剧情道具写成角色配饰。' },
      { key: 'visualAnchor', type: 'string', required: true, promptText: '最核心的一句视觉锚点，要求短、稳、可反复复用。' },
      { key: 'step3Description', type: 'string', required: true, promptText: '给 Step3 直接使用的一段角色生图描述，应整合年龄感、气质、外观和服装，不要写剧情动作、武器刺击、双人互动或具体剧照瞬间。武器/道具只进入 propTracking，不写进角色定妆描述；肩挂、背负、手持、佩戴的枪械/刀剑/棍棒/法器也不要写进单人定妆。' },
      { key: 'inferredFields', type: 'array', itemType: 'string', required: true, promptText: '哪些角色字段是保守补全得到的，如 ["ageAppearance", "skinTone"]；没有则输出空数组。' },
    ],
  },
  {
    key: 'sceneRelations',
    type: 'string',
    label: '场景关系说明',
    promptText: '只总结原剧本中明确可见的空间连续关系、场景切换关系或时间推进关系；没有明确依据时输出空字符串。',
  },
  {
    key: 'outfitTracking',
    type: 'array',
    itemType: 'object',
    label: '服装追踪',
    promptText: '追踪角色在不同分镜中的服装/造型变化，便于后续资产复用和一致性控制。必须同时记录基础服装和所有视觉上不同的分镜服装状态；后续视频提示词会全程锁定参考图中的服饰配饰，因此任何实际会在分镜中出现、且不同于基础角色设定图服装的造型都不能只靠文字描述，必须进入 outfitTracking。',
    itemFields: [
      { key: 'characterName', type: 'string', required: true, promptText: '角色名，必须来自 allCharacterNames，且不得是动作事件短语。' },
      { key: 'outfitSeq', type: 'number', required: true, promptText: '该角色服装序号。outfitSeq=1 固定代表后续最常用/默认基础服装，不一定等于角色第一次出场的服装；若首镜、闪回、濒死、伪装、病号服、战甲等造型只在局部分镜出现且不同于后续默认服装，必须标为 outfitSeq>=2。' },
      { key: 'outfitDesc', type: 'string', required: true, promptText: '服装或造型描述，至少覆盖颜色、材质、版型、层次、鞋靴、发型/头饰或不可分离配饰中的 3-5 项；必须能直接指导 Step3 生成变装定妆照和变装设定图。不要把武器/枪械/刀剑/棍棒/法器/手持道具写进服装；这些必须进入 propTracking。' },
      { key: 'storyboardRange', type: 'string', required: true, promptText: '服装出现的分镜范围，如“分镜01”或“分镜01-03”。必须非空，且只能引用 storyboards[] 中真实存在的分镜编号；不要输出空数组、空字符串、[] 或不存在的分镜号。' },
      { key: 'needsNewImage', type: 'boolean', required: true, promptText: '是否需要为该套服装单独生成新参考图。outfitSeq=1 是基础服装，必须为 false；只有 outfitSeq>=2 且颜色、材质、版型、层次、身份造型、医护/制服/战甲/伪装/闪回前世造型等有实质变化时才为 true。仅血污、破损、受伤状态、姿态、动作或情绪变化不算变装。' },
    ],
  },
  {
    key: 'propTracking',
    type: 'array',
    itemType: 'object',
    label: '道具追踪',
    promptText: '追踪关键道具的视觉形态、大小、材质、持有者、出现范围和状态变化。只有明确跨多个分镜出现、需要稳定复用的物品，才默认开启 needsTracking 和 needsImage；单分镜一次性道具可以记录为道具，但默认 needsTracking=false、needsImage=false。',
    itemFields: [
      { key: 'propName', type: 'string', required: true, promptText: '道具名称。' },
      { key: 'appearanceDesc', type: 'string', required: true, promptText: '综合外观描述，至少覆盖颜色、材质、结构、纹样、尺寸感或新旧状态。' },
      { key: 'size', type: 'string', required: true, promptText: '大小或尺寸感，如掌心大小、巴掌长、半人高、单手可握；无法判断时输出空字符串。' },
      { key: 'material', type: 'string', required: true, promptText: '主要材质，如木、铁、玉、布、皮革、塑料；无法判断时输出空字符串。' },
      { key: 'shapeStructure', type: 'string', required: true, promptText: '形状和结构，如细长短刀、圆形玉佩、折角信封、金属方盒。' },
      { key: 'color', type: 'string', required: true, promptText: '主色或综合色泽。' },
      { key: 'texture', type: 'string', required: true, promptText: '表面质感，如磨损、冰冷、粗糙、釉面、哑光、反光。' },
      { key: 'condition', type: 'string', required: true, promptText: '当前状态，如完好、破损、带血、旧化；没有则输出空字符串。' },
      { key: 'visualAnchor', type: 'string', required: true, promptText: '最核心的一句道具视觉锚点。' },
      { key: 'step3Description', type: 'string', required: true, promptText: '给 Step3 直接使用的一段道具生图描述，应包含大小、材质、结构、颜色、质感。' },
      { key: 'inferredFields', type: 'array', itemType: 'string', required: true, promptText: '哪些道具字段是保守补全得到的；没有则输出空数组。' },
      { key: 'holder', type: 'string', required: true, promptText: '当前持有者，只能填写 allCharacterNames 中已定义的角色名，或填写“场景道具 / 无 / 无/场景道具”。不要填写容器、位置、场景、家具、药柜、铁盆、床边、桌面、地面、门口、身体部位或另一个道具；道具位于某处时，把位置写进 stateChanges/appearanceDesc，holder 写“场景道具”。无法确定时输出空字符串或“场景道具”，不要臆造。' },
      { key: 'storyboardRange', type: 'string', required: true, promptText: '道具出现的分镜范围，如“分镜01”或“分镜01-05”。必须非空，且只能引用 storyboards[] 中真实存在的分镜编号；不要输出空数组、空字符串、[] 或不存在的分镜号。' },
      { key: 'stateChanges', type: 'string', required: true, promptText: '状态变化描述；没有变化时输出空字符串。' },
      { key: 'needsTracking', type: 'boolean', required: true, promptText: '是否需要跨分镜持续追踪；只有 storyboardRange 覆盖两个或更多真实分镜时才默认 true，单分镜道具默认 false。' },
      { key: 'needsImage', type: 'boolean', required: true, promptText: '是否需要单独生图；只有跨多个分镜出现、需要稳定复用的高识别关键道具才默认 true，单分镜道具默认 false。' },
    ],
  },
  {
    key: 'propInheritance',
    type: 'string',
    label: '道具继承说明',
    promptText: '只写本段剧本中能够明确确认的关键道具初始状态、归属或继承约束；没有明确依据时输出空字符串。',
  },
  {
    key: 'summary',
    type: 'string',
    label: '分析摘要',
    promptText: '用不超过 200 字概括本段剧本的核心剧情和结构特点。',
  },
];

const STEP1_REQUIRED_STRING_KEYS = STEP1_FIELD_CONTRACT
  .filter((field) => field.type === 'string')
  .map((field) => field.key);

const STEP1_REQUIRED_ARRAY_KEYS = STEP1_FIELD_CONTRACT
  .filter((field) => field.type === 'array')
  .map((field) => field.key);

const STEP1_REQUIRED_KEYS = STEP1_FIELD_CONTRACT.map((field) => field.key);

const STEP1_ARRAY_FIELD_SCHEMAS = Object.fromEntries(
  STEP1_FIELD_CONTRACT
    .filter((field) => field.type === 'array')
    .map((field) => [field.key, field]),
);

const STEP1_VISUAL_DETAIL_RULES = [
  '场景 environment 不要只写地点名，至少补足空间用途、关键陈设/地貌、材质或环境压迫感。',
  '场景 layout 要写清前景/中景/后景或左右分区关系，方便 Step3 搭建空间结构。',
  '每个 scenes[].name 都必须至少被一个 storyboards[].scene 精确引用。门缝/窗口/远处可见的背景只能并入当前主场景的 environment/layout，不要生成未被分镜引用的孤立场景资产。',
  '场景 lighting 要尽量写出主光源方向、亮度、冷暖和硬软光特征。',
  '场景 step3Description 必须是纯环境无人场景设定图描述，不要包含角色名、人物、人影、人形、伤员、士兵、医务人员、尸体、持枪/持剑人影或剧情动作瞬间。',
  '角色画像要优先收齐年龄感、气质、体型、五官辨识点、发型、服装锚点和稳定配饰。',
  '角色 step3Description 应是一段可直接生图的单人定妆描述，不要混入剧情动作、武器刺击、双人互动或剧照瞬间。',
  '角色定妆、defaultOutfit、accessories、outfitTracking.outfitDesc 都不得包含可分离武器/道具，例如肩挂旧式步枪、手持长剑、腰悬刀、棍棒、法器；武器和关键道具必须单独进入 propTracking。',
  '角色总表必须排除语音通道、抽象组织名、动作/事件/关系短语，例如“对白”“台词”“内心OS”“系统播报”“守备队”“背刺同门”不应作为角色资产；若需要反派角色且原文未命名，可写“同门背刺者”这类稳定人物称谓。',
  'scenes[].characters 与 storyboards[].characters 只能引用 allCharacterNames 中已经存在的角色名。禁止把语音通道、抽象组织、动作短语、身体部位、道具状态或镜头描述写成分镜角色，例如“对白”“守备队”“剑身仍与后方同门连贯相接”“出手后迅速后撤”“指尖压上绷带”必须从角色数组中移除。',
  '服装追踪中 outfitSeq=1 是基础服装，needsNewImage 必须为 false；只有第2套及以后出现实质服装/身份造型变化才标记 needsNewImage=true。',
  '不要把“第一次出场服装”机械当成基础服装。若首镜/闪回/濒死/伪装/病号服/战甲等局部造型与后续主线默认服装不同，基础服装仍应是后续最常用造型，该局部造型必须作为 outfitSeq>=2 的变装记录，并标记 needsNewImage=true。',
  '变装判断必须服务后续视频锁定：视频提示词会全程锁定参考图中的五官、脸型、发型、服饰、配饰；缺失变装设定图会导致视频沿用基础设定图服装，所以所有会被分镜实际使用的差异造型都必须提前进入 outfitTracking。',
  '道具不只写名称，必须尽量补齐大小、材质、形状结构、主色、表面质感和状态。',
  'propTracking.holder 只能是 allCharacterNames 中的角色名，或“场景道具 / 无 / 无/场景道具”。绝对不要把容器、位置、场景、家具、药柜、铁盆、床边、桌面、地面、门口、身体部位、另一个道具写成 holder；这类信息应写入 appearanceDesc 或 stateChanges。',
  '当原文细节不足但时代、身份、场景用途或剧情处境明确时，允许做保守的最小视觉补全，只补画面信息，不补剧情事实。',
  '能从原小说、改编稿、对白、动作、旁白中交叉印证的细节应合并，不要只盯单一段落。',
];

const STEP1_EXAMPLE_OUTPUT = {
  projectName: '示例项目名',
  styleConfig: '写实仿真人古装偶像剧S+级大制作质感',
  scenes: [
    {
      name: '侯府前院',
      timeOfDay: '白天',
      environment: '雨后青石地面泛着冷湿反光，三进院落被乌木廊柱围合，正中香案与围观家仆形成对峙核心。',
      colorTone: '冷青灰底色里混着廊下灯烛透出的暖金边光',
      characters: ['沈昭', '谢临川'],
      spaceScale: '中大型宅院前庭',
      layout: '前景是湿冷石阶，中景是对峙人群与香案，后景是压低空间的回廊和门洞',
      keySetPieces: '香案、乌木廊柱、雨后青石地、侯府匾额',
      lighting: '阴天漫射天光为主，廊下暖色烛火打出边缘补光',
      weather: '薄雨初停，空气潮湿，地面留有水痕',
      atmosphere: '公开逼问带来的压迫感和权力威压',
      step3Description: '雨后冷青灰色的侯府前院，青石地面潮湿反光，乌木廊柱围合出压迫空间，正中香案与围观家仆形成对峙核心，阴天漫射冷光里混着廊下暖金烛火边光。',
      inferredFields: ['lighting', 'layout'],
    },
  ],
  storyboards: [
    {
      number: 1,
      name: '当众逼问',
      duration: '15秒',
      shotSize: '中景',
      scene: '侯府前院',
      characters: ['沈昭', '谢临川'],
    },
    {
      number: 4,
      name: '夜行潜入',
      duration: '15秒',
      shotSize: '近景',
      scene: '侯府前院',
      characters: ['沈昭'],
    },
  ],
  allCharacterNames: ['沈昭', '谢临川'],
  characterProfiles: [
    {
      name: '沈昭',
      description: '二十出头的冷白肤色女子，黑发低挽，眉眼锋利克制，穿浅金暗纹礼服，耳侧垂细金流苏，整个人清冷却不失压迫感。',
      ageAppearance: '二十出头',
      temperament: '清冷、克制、隐含锋利',
      bodyBuild: '身形修长，站姿稳定',
      faceFeatures: '眉眼锐利，唇线收紧，目光压人',
      hairStyle: '黑发低挽，发髻整齐',
      skinTone: '冷白肤色',
      defaultOutfit: '浅金暗纹礼服，内搭月白中衣',
      accessories: '耳侧细金流苏步摇',
      visualAnchor: '低挽黑发与冷白肤色衬出锋利清冷感',
      step3Description: '二十出头的冷白肤色女子，黑发低挽，眉眼锋利清冷，身形修长，穿浅金暗纹礼服与月白中衣，耳侧垂着细金流苏步摇，整体气质克制而有压迫感。',
      inferredFields: ['bodyBuild'],
    },
  ],
  sceneRelations: '侯府前院是当前冲突主场景，后续分镜仍在同一空间内推进对峙。',
  outfitTracking: [
    {
      characterName: '沈昭',
      outfitSeq: 1,
      outfitDesc: '浅金暗纹立领礼服，内搭月白中衣，外披半透明纱斗篷，发髻收得整齐，耳侧垂细金流苏',
      storyboardRange: '分镜01-03',
      needsNewImage: false,
    },
    {
      characterName: '沈昭',
      outfitSeq: 2,
      outfitDesc: '深青色夜行短袍，窄袖束腕，黑色软皮护腰，发髻压低并以素银发簪固定，外披深灰兜帽斗篷',
      storyboardRange: '分镜04',
      needsNewImage: true,
    },
  ],
  propTracking: [
    {
      propName: '侯府家印',
      appearanceDesc: '掌心大小的黑金玉质印章，方形底座边角磨圆，印纽雕成狮首，玉面泛冷光，侧边缠着一截暗红丝绳。',
      size: '掌心大小',
      material: '黑金玉质',
      shapeStructure: '方形底座，上方狮首印纽',
      color: '黑金与冷玉色',
      texture: '玉面冷润，边角有长期使用后的细磨痕',
      condition: '完好',
      visualAnchor: '黑金玉印与狮首印纽',
      step3Description: '掌心大小的黑金玉质印章，方形底座边角磨圆，上方是狮首印纽，整体呈黑金与冷玉色，玉面冷润微微反光，侧边缠着一截暗红丝绳。',
      inferredFields: ['texture'],
      holder: '谢临川',
      storyboardRange: '分镜01-04',
      stateChanges: '',
      needsTracking: true,
      needsImage: true,
    },
  ],
  propInheritance: '侯府家印开场即由谢临川持有，在当前段落内未发生持有者切换。',
  summary: '侯府前院的公开逼问迅速升级，核心冲突集中在当众施压与权力威压。',
};

const STEP1_NO_HALLUCINATION_RULES = [
  '不得新增剧本中不存在的角色、场景、道具、关系或事件。',
  '角色名、场景名、道具名必须以原文为准；没有明确证据时不要脑补。',
  '允许基于剧情强约束做最小视觉补全，但补全内容只服务外观和画面落地，不得新增会改变剧情理解的身份、设定、关系或能力。',
  '如果同时拿到改编稿和原小说：分镜结构以改编稿为准，视觉细节优先吸收原小说中不冲突的描写。',
  'sceneRelations 只允许写剧本中明确体现的空间或时间连续关系，不得写空泛套话。',
  'propInheritance 只允许写本段剧本能够确认的初始状态或继承约束，不得预判后续剧情。',
  'propTracking.needsTracking 与 needsImage 的默认值由 storyboardRange 决定：只有出现在两个或更多分镜的物品才默认 true；只出现在单个分镜的一次性道具默认 needsTracking=false、needsImage=false。',
  '所有 scenes[].characters、storyboards[].characters、characterProfiles[].name、outfitTracking[].characterName 都必须与 allCharacterNames 完全一致；“对白/台词/内心OS/系统播报/画外音/音效”是声音通道，“守备队/守军/巡逻队”是抽象组织，不得作为角色名；未命名小角色若需要独立出镜，先创建稳定角色称谓和画像，否则统一映射到已有群像角色。',
  '所有 scenes[].name 都必须被 storyboards[].scene 引用；禁止输出没有任何分镜使用的幻觉场景或背景远景场景。',
  'allCharacterNames 中的每个角色都必须至少出现在 scenes[].characters 或 storyboards[].characters，禁止输出未在本章出场的幻觉角色。',
  'outfitTracking[].storyboardRange 与 propTracking[].storyboardRange 必须非空且命中已有分镜编号，例如“分镜01”或“分镜01-03”；禁止输出 []、空字符串或不存在的分镜号。',
  'propTracking.holder 不得使用未定义角色；如果道具只是放在容器/床边/桌面/药柜/铁盆/地面/场景中，holder 必须写“场景道具”，位置细节写到 appearanceDesc 或 stateChanges。',
  'inferredFields 只能标记真正做过保守补全的字段，没有补全就输出空数组。',
];

function formatFieldType(field) {
  if (field.type !== 'array') return field.type;
  if (field.itemType === 'object') return 'array<object>';
  if (field.itemType === 'string') return 'string[]';
  return 'array';
}

function formatFieldGuide(field, index) {
  if (field.type !== 'array') {
    return [
      `### ${index}. ${field.key} (${formatFieldType(field)}) - ${field.label}`,
      field.promptText,
    ].join('\n');
  }

  const lines = [
    `### ${index}. ${field.key} (${formatFieldType(field)}) - ${field.label}`,
    field.promptText,
  ];

  if (field.itemType === 'string') {
    lines.push('输出纯字符串数组，不要混入对象。');
    return lines.join('\n');
  }

  lines.push(`每个 ${field.key}[] 对象必须包含：`);
  lines.push(
    ...field.itemFields.map((itemField) => {
      const requiredLabel = itemField.required ? '必填' : '可选';
      const itemType = itemField.type === 'array'
        ? `${itemField.itemType || 'unknown'}[]`
        : itemField.type;
      return `- ${itemField.key} (${itemType}, ${requiredLabel}): ${itemField.promptText}`;
    }),
  );
  return lines.join('\n');
}

function buildNestedValidationRuleLines() {
  return STEP1_FIELD_CONTRACT
    .filter((field) => field.type === 'array')
    .map((field) => {
      if (field.itemType === 'string') {
        return `${field.key} 必须是字符串数组。`;
      }
      const itemKeys = field.itemFields.map((itemField) => itemField.key).join(', ');
      return `${field.key}[] 每项都必须包含：${itemKeys}。`;
    });
}

function parseStep1UserPayload(input) {
  if (typeof input !== 'string') {
    return {
      scriptText: '',
      originalSourceText: '',
      sourceType: 'annotated',
      seriesContext: null,
    };
  }

  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        scriptText: typeof parsed.scriptText === 'string' ? parsed.scriptText : input,
        originalSourceText: typeof parsed.originalSourceText === 'string' ? parsed.originalSourceText : '',
        sourceType: parsed.sourceType === 'novel' ? 'novel' : 'annotated',
        seriesContext: parsed.seriesContext && typeof parsed.seriesContext === 'object' && !Array.isArray(parsed.seriesContext)
          ? parsed.seriesContext
          : null,
      };
    }
  } catch {
    // Keep backward compatibility with the old plain-text payload.
  }

  return {
    scriptText: input,
    originalSourceText: '',
    sourceType: 'annotated',
    seriesContext: null,
  };
}

function buildStep1SystemPrompt() {
  const topLevelKeys = STEP1_REQUIRED_KEYS.join(', ');
  const nestedRules = buildNestedValidationRuleLines().map((line, index) => `${index + 1}. ${line}`).join('\n');
  const visualDetailRules = STEP1_VISUAL_DETAIL_RULES.map((line, index) => `${index + 1}. ${line}`).join('\n');
  const antiHallucinationRules = STEP1_NO_HALLUCINATION_RULES.map((line, index) => `${index + 1}. ${line}`).join('\n');

  return `你是一位专业的中文剧本结构化分析专家，服务于短剧生产流程。

## 你的任务
把用户提供的剧本分析成一个可直接进入 Step2 / Step3 的结构化 JSON 对象，重点是让人物、场景、道具都形成可复用的资产画像。

## 顶层字段契约
你必须完整输出以下顶层字段，字段名保持完全一致：
${topLevelKeys}

## 嵌套结构契约
${nestedRules}

## 视觉细节粒度要求
${visualDetailRules}

## 输出纪律
1. 必须且只能输出一个合法的 JSON 对象。
2. 不要输出 markdown、代码块、注释、解释文字或额外说明。
3. 所有顶层字段都必须完整出现，即使为空也不能省略。
4. 无法确认的字符串字段输出 ""；无法确认的数组字段输出 []；不要输出 null。

## 禁止脑补规则
${antiHallucinationRules}`;
}

function buildStep1UserPrompt(input) {
  const { scriptText, originalSourceText, sourceType, seriesContext } = parseStep1UserPayload(input);
  const fieldGuides = STEP1_FIELD_CONTRACT.map((field, index) => formatFieldGuide(field, index + 1)).join('\n\n');
  const visualDetailRules = STEP1_VISUAL_DETAIL_RULES.map((line) => `- ${line}`).join('\n');
  const antiHallucinationRules = STEP1_NO_HALLUCINATION_RULES.map((line) => `- ${line}`).join('\n');
  const sourceInstructions = sourceType === 'novel'
    ? [
        '本次输入来自“小说 -> 改编稿 -> Step1分析”链路。',
        '请以改编稿作为分镜结构和出场顺序的准绳。',
        '如果原小说提供了更细的人物、场景、道具描写，且不与改编稿冲突，可以吸收进角色画像、场景画像和道具画像。',
      ].join('\n')
    : [
        '本次输入来自标注剧本链路，请直接以当前剧本为准提取结构化结果。',
        '如果原文标题使用“分镜1-1 / 分镜1-2 / 分镜2-1”这类子分镜编号，storyboards[].number 必须按文本出现顺序重新映射为连续数字 1、2、3……；原始标题可保留在 storyboards[].name 中。',
        '不要把“1-1”输出为 storyboards[].number，也不要把“分镜1-1”和“分镜1-2”都输出成 number=1；outfitTracking[].storyboardRange 与 propTracking[].storyboardRange 也必须使用映射后的连续分镜号。',
      ].join('\n');

  const originalSourceSection = originalSourceText.trim()
    ? `\n## 原始素材（可用于补足视觉细节，不可改写改编稿已确定的分镜结构）\n---\n${originalSourceText}\n---\n`
    : '';
  const seriesContextSection = seriesContext
    ? `\n## 系列连续性上下文（必须保持人设和长线一致，不可新增未给出的剧情事实）\n${JSON.stringify(seriesContext, null, 2)}\n`
    : '';

  return `请分析以下剧本，提取结构化信息。严格按照下方 JSON 结构输出。

## 链路说明
${sourceInstructions}

## 需要提取的字段说明
${fieldGuides}

## 视觉细节粒度要求
${visualDetailRules}

## 反幻觉约束
${antiHallucinationRules}

## JSON 输出格式示例
${JSON.stringify(STEP1_EXAMPLE_OUTPUT, null, 2)}

## 当前用于结构分析的剧本文本
---
${scriptText}
---${originalSourceSection}${seriesContextSection}

请严格按照上面的 JSON 结构输出分析结果。只输出单个合法 JSON 对象，不要输出 markdown、代码块、注释、解释或其他任何内容。所有顶层字段都必须保留，即使为空也不能省略。`;
}

module.exports = {
  STEP1_ARRAY_FIELD_SCHEMAS,
  STEP1_EXAMPLE_OUTPUT,
  STEP1_FIELD_CONTRACT,
  STEP1_NO_HALLUCINATION_RULES,
  STEP1_REQUIRED_ARRAY_KEYS,
  STEP1_REQUIRED_KEYS,
  STEP1_REQUIRED_STRING_KEYS,
  STEP1_STYLE_PRESETS,
  STEP1_VISUAL_DETAIL_RULES,
  buildNestedValidationRuleLines,
  buildStep1SystemPrompt,
  buildStep1UserPrompt,
  parseStep1UserPayload,
};
