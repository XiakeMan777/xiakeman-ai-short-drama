import type { SeriesRuntimeState, SeriesPlan } from '@/types';
import {
  countEmotionlessFunctionalDialogue,
  countHollowPerformanceActions,
  countMatches,
  countNextRelayBeatLoad,
  countOverloadedDialogue,
  findDuplicatedPropLocationIssues,
  findOverloadedStoryboardIndexes,
  hasDenseSweetOccupationVoice,
  hasUsableListItem,
  hasWeakSatisfactionBeat,
  isBlank,
} from './seriesQualityTextUtils';

export interface SeriesQualityIssue {
  id: string;
  label: string;
  suggestion: string;
}

export interface EpisodeScriptQualityContext {
  plan?: Pick<SeriesPlan, 'genreMode'>;
  genreMode?: SeriesPlan['genreMode'];
}

const CONCRETE_SATISFACTION_RE =
  /当众|签|摔|扔|跪|揭|证据|圣旨|退婚|离开|反杀|打脸|翻盘|背锅|皇印|录音|合同|账本|亲子鉴定|假千金|股权|股份|董事会|上市|直播|门禁卡|项目章|律师函|退婚声明|净身出户|戒指|录音笔|监控|签字|领证|婚约|合约|抱|吻|吃醋|公开偏爱|挡酒|送药|黑卡|房卡|热搜|官宣|点心|糕|糖|蜜饯|甜方|小厨房|厨房|药膳|药碗|喂药|装病|假病|病弱|病秧子|抓包|破绽|反咬|翻墙练剑|咳|试吃|吃光|尝|投喂|忌口|少糖|桂花|披风|钥匙|铺面|铺子|菜单|宴席单|护短|挑剔|战神|赘婿|神医|鉴宝|龙王|宗师|银针|古董|擂台|订单|封号|身份牌|癫|抽象|离谱|发疯|规则|罚款|盖章|工牌|喇叭|二维码|锦旗|横幅|表情包|外卖|奶茶|拖鞋|盆栽|工位|直播间|全员|离婚协议|房本|房产|银行卡|聊天记录|婆婆|婆媳|孩子|书包|家门|饭桌|亲戚|罗盘|符纸|符灰|香灰|铜钱|红绳|镜子|祖宅|旧物|假大师|应验|卦象|风水局|消息发错|发错|乌龙|社死|嘴瓢|拿错|拿反|误会|搭档|室友|饭局|宿舍|办公室|show|sign|leave|reveal|proof|seal|paper|backfire|walks out/i;

const ABSTRACT_SATISFACTION_RE =
  /感觉|成长|变得|意识到|明白|决定|不同|命运|内心|feel|feels|realize|realizes|different|change|changed/i;

const OPENING_HOOK_RE =
  /当众|圣旨|退婚|跪|掌掴|掀桌|倒计时|证据|皇印|血|毒|婚书|休书|背叛|逼|杀|抓|撞|摔|撕|跪下|滚出去|亲子鉴定|假千金|股权|董事会|直播|戒指|净身出户|收权|门禁卡|项目章|鉴定书|退婚声明|领证|婚约|合约|接吻|热搜|官宣|房卡|黑卡|挡酒|抱走|吃醋|点心|糕|糖|蜜饯|甜方|小厨房|厨房|药膳|药碗|喂药|装病|假病|病弱|病秧子|抓包|破绽|反咬|翻墙练剑|咳|试吃|吃光|尝|投喂|忌口|少糖|桂花|披风|钥匙|铺面|铺子|菜单|宴席单|账本|王妃做的|赌约|养胖|和离银子|护短|挑剔|战神|赘婿|神医|鉴宝|龙王|宗师|银针|古董|擂台|封号|身份牌|订单|假诊断书|离婚协议|龙纹令牌|战部|老太爷|病历夹|赔命|心跳|抢救|跪着滚|婚戒|癫|抽象|离谱|发疯|规则|罚款|盖章|工牌|喇叭|二维码|锦旗|横幅|表情包|外卖|奶茶|拖鞋|盆栽|工位|直播间|全员|房本|房产|银行卡|聊天记录|婆婆|婆媳|孩子|书包|家门|饭桌|亲戚|罗盘|符纸|符灰|香灰|铜钱|红绳|镜子|祖宅|旧物|假大师|应验|卦象|风水局|消息发错|发错|乌龙|社死|嘴瓢|拿错|拿反|误会|搭档|室友|饭局|宿舍|办公室|decree|seal|evidence|divorce|wedding|blood|kneel|betray|deadline|slap/i;

const MECHANISM_SATISFACTION_RE =
  /医圣|脉象|药方|药材|监护仪|手术灯|令牌|旧部|勋章|岳家|家宴|玉佩|瓷器|字画|包浆|落款|暗格|拍卖牌|重生|前世|上一世|改命|旧照片|旧信|命运节点|车祸|原书|原著|剧情节点|人设|剧本页|章节提示|恶毒女配|炮灰|系统|任务面板|任务奖励|惩罚|积分|弹窗|道具栏|宿主|好感值|黑化值|世界任务|小世界|时间循环|循环|回档|死亡回溯|副本|出口条件|钟表|便签|互换|灵魂互换|身份错位|权限卡|读心|心声|预知|梦境|弹幕|剧透|观众提示|刷屏|空间|囤货|末世|天灾|灾变|物资|仓库|清单|冷库|极寒|高温/i;

const MECHANISM_ACTIVE_DIALOGUE_RE =
  /脉象|心跳|监护仪|令牌|旧部|军令|家宴|岳家|废物|吃软饭|落款|暗格|拍卖|前世|上一世|这一次|重来|改命|原书|原著|剧情|人设|系统|任务|奖励|惩罚|倒计时|积分|宿主|好感值|黑化值|循环|回档|出口|互换|换回去|心声|预知|弹幕|剧透|空间|囤货|物资|仓库/i;

const SCIFI_MECHA_SCRIPT_RE =
  /机甲|星渊|白塔|灵脉|法阵|阵纹|核心|判定书|测试台|维修舱|修复舱|权限令|登记盒/;

const SCIFI_MECHA_OPENING_HOOK_RE =
  /无灵脉|灵脉|判定书|测评台|测试台|备用驾驶员|名牌|退学书|旧耳坠|权限|登记|封锁|复测令|核心|机甲|光束|继承人|唯一|高危遗物|校董|学生群|同学群|围拍|大屏|红屏|红色|不配|甩|扯下|压住|抢走|夺走|弹开|失控|倒计时/i;

const SCIFI_MECHA_DIALOGUE_PRESSURE_RE =
  /无灵脉|灵脉|废物|不配|资格|谁给你|你敢|凭什么|交(?:出)?(?:核心|星渊)|(?:核心|星渊).{0,10}(?:归我|归谁|认主|断联|封存|扣押|暂扣|失控|剥夺|判定|亮给谁|拒绝)|(?:封禁|暂扣|吊销|撤销|剥夺|复测|违规|作弊|除名|退学|通报|审查|判定书|权限令|登记盒)|(?:接口|回路|阵纹|法阵|白塔|机甲).{0,12}(?:接入|锁死|反噬|改写|失控|亮|拒绝|认主|归属)/i;

const MYSTIC_ASSET_RE =
  /鬼|僵尸|邪祟|怨灵|女鬼|禁忌|法器|符纸|符灰|香灰|罗盘|雷法|道法|直播|弹幕|祖宅|镜子|风水局|卦象|应验|龙虎山|天师/;

const MYSTIC_VISIBLE_RE =
  /罗盘|符纸|黄符|黄纸|符灰|香灰|铜钱|红绳|封条|门缝|门环|阴风|冷气|木盒|盒盖|许愿池|水面|倒影|照片|合影|镜子|铜镜|旧物|白影|白脸|人脸|半身|半个女人|尸身|棺|假大师|应验|卦象|风水局|鬼|僵尸|邪祟|怨灵|女鬼|雷法|道法|法器|直播|弹幕/;

const MYSTIC_OPENING_HOOK_RE =
  /自燃|乱转|显字|变色|弹开|自己|震响|滑出|伸出|撞进|压门|扑到|拖跪|不落地|跳秒|多出|浮起|黄符|黄纸|符纸|罗盘|香灰|铜钱|红绳|封条|门缝|门环|阴风|冷气|木盒|盒盖|山门|禁门|许愿池|水面|倒影|照片|合影|镜中|镜面|铜镜|白影|白脸|人脸|半身|半个女人|尸身|棺|停灵|鬼影|僵尸|女鬼|邪祟|雷法|道法|直播|镜头|手机|弹幕|刷屏/;

const MYSTIC_SCRIPT_OPENING_RE =
  /0-3|前三秒|开场|第一镜|罗盘|符纸|香灰|镜中|镜子|直播间|弹幕|鬼影|僵尸|邪祟|怨灵|女鬼|雷光|雷法|道法|龙虎山|山门/;

const MYSTIC_SCRIPT_TAOIST_ACTION_RE =
  /张玄|天师|道士|哥哥|黑袍|道法|雷法|掐符|压符|甩符|落符|符纸|符咒|法器|罗盘|镇|收|破|驱|敕令|龙虎山/;

const MYSTIC_SCRIPT_LIVE_REACTION_RE =
  /妹妹|主播|直播|直播间|镜头|手机|弹幕|观众|刷屏|破防|炸了|卧槽|不信/;

const MYSTIC_DIALOGUE_PRESSURE_RE =
  /退后|退|别动|别碰|别伸手|手别伸|站我后面|关播|别喂|喂它|不认镜头|认你|离门|别怼|闭嘴|让开|下山|不对|真的假的|真停了|别演|卧槽|不是特效|这灰|这风|这门|自己开了|开播|直播|弹幕|镜头|黄符|符|门缝|门环|木盒|香灰|罗盘|鬼|僵尸|女鬼|邪祟/;

const MYSTIC_IDENTITY_RE =
  /张玄|哥哥|天师|龙虎山|黑袍|道士|道法|雷法|掐符|压符|甩符|落符|符纸|符咒|法器|罗盘|风水(?!墨)|抓鬼|驱邪|敕令/;

const MYSTIC_THREAT_RE =
  /灵异|僵尸|鬼怪|女鬼|鬼影|邪祟|怨灵|凶宅|阴宅|禁忌|祖宅|鬼门|阴气|尸气|白影|白脸|人脸|尸身|棺|停灵|门缝|阴风|冷气/;

const MYSTIC_LIVE_STREAM_RE =
  /主播|直播间|镜头|手机|弹幕|观众|刷屏|破防|炸了|围观/;

const MYSTIC_ASSET_THREAT_RE =
  /灵异|僵尸|鬼怪|女鬼|鬼影|邪祟|怨灵|凶宅|阴宅|禁忌|祖宅|旧物|风水局|卦象|怪事/;

const MYSTIC_ASSET_PROOF_RE =
  /法器|符纸|符咒|符灰|香灰|罗盘|雷法|道法|铜钱|红绳|镜子|应验|显形|镇住|破局/;

const MYSTIC_ASSET_LIVE_RE =
  /妹妹|主播|直播|直播间|镜头|手机|弹幕|观众|刷屏|破防|炸了|连线/;

const MECHANICAL_AI_SUMMARY_RE =
  /(?:我决定|我明白|我必须|从现在开始|这一刻我|我要改变|我要证明).{0,18}(?:命运|人生|软弱|自己|未来|真相|复仇|改变)/;

const DIALOGUE_ATTACK_RE =
  /死|命|毒|血|跪|滚|闭嘴|掌嘴|赐|白绫|休书|退婚|通敌|背叛|体面|省|担得起|逼|配|凭什么|你敢|拿什么|半刻|上路|陪葬|证据|皇印|圣旨|药|别闹|不配|交出来|撕|摔|打|假千金|亲子鉴定|股权|股份|董事会|上市|直播|订婚|骗婚|净身出户|滚出|扫地出门|门禁卡|项目章|律师函|监控|录音|合同|签字|转让书|复印件|原件|丢人|占位|占了|收权|主桌|全网|跌停|通报|权限|冻结|报警|你算什么|谁给你的脸|不认|现在就|下不来台|合约|婚约|领证|官宣|热搜|黑卡|房卡|挡酒|吃醋|我的人|别碰她|抱走|吻|赔不起|战神|赘婿|神医|鉴宝|龙王|宗师|银针|古董|擂台|封号|订单|军令|跪下叫|谁敢动|废物|吃软饭|假诊断书|诊断书假的|心跳是真的|药谁换的|针没拔|命不算你的|不准碰|偿命|赔命|庸医|废物能救命|战部|龙纹令牌|老太爷|离婚协议|病历|抢救|跪着滚|癫|抽象|离谱|发疯|罚款|盖章|工牌|喇叭|二维码|锦旗|横幅|表情包|外卖|奶茶|拖鞋|盆栽|工位|你正常吗|别太荒谬|这合理吗|给我滚去上班|谁批准你发疯/i;

const SWEET_ROMANCE_RE =
  /ancient_sweet_romance|古风甜宠|王府轻甜|点心|糕|甜方|小厨房|厨房|药膳|药碗|喂药|装病|假病|病弱|病秧子|冲喜|翻墙练剑|试吃|吃光|尝|投喂|忌口|少糖|桂花|蜜饯|铺面|铺子|宴席单|养胖|和离银子|王妃做的/;

const SWEET_DIALOGUE_RE =
  /点心|糕|甜|药膳|药碗|喂药|装病|假病|病弱|病秧子|咳|抓包|破绽|反咬|翻墙练剑|小厨房|厨房|试吃|吃光|尝|忌口|少糖|桂花|蜜饯|挑|酸|太甜|王妃做的|我的王妃|护短|偏心|偏爱|吃醋|和离|银子|账本|铺面|铺子|菜单|宴席|钥匙|投喂|不许碰|谁准你碰|你做的|我吃|留下|端来/i;

const SWEET_ENDING_RE =
  /点心|糕|甜方|小厨房|厨房|药膳|药碗|喂药|装病|假病|病弱|病秧子|咳|抓包|破绽|反咬|翻墙练剑|试吃|吃光|忌口|少糖|桂花|蜜饯|铺面|铺子|账本|菜单|宴席单|钥匙|投喂|偏爱|护短|吃醋|王妃做的|和离银子|下一集|接下一镜|未说完|门外|响起|露出/i;

const SOFT_FUNCTIONAL_DIALOGUE_RE =
  /^(?:娘娘，请吧|别让.*久等|别闹|莫拿.*寻开心|别听他们的|咱们再想法子|天气真冷|你怎么来了|发生什么了)$/;

const AUTHOR_COMMENTARY_OS_RE =
  /话不重|刀很准|硬说成|她把|他把|反倒更|这才是|真正的|不是.*是|看似.*实则|观众|爽点/;

const STANDALONE_OS_RE = /(?:^|\n)\s*(?:字幕\/OS|内心OS|OS|旁白)：/;

const NAMED_EXTRA_RE = /(秀女|宫人|宫女|太监|侍卫|宾客|董事)[甲乙丙丁]/;

const TEMPORARY_NAMED_SERVANT_RE =
  /(?:^|\n)(?:对白：)?(?:阿福|小顺|小德子|小安子|阿贵|阿成|阿平|阿忠)[：:（]|(?:阿福|小顺|小德子|小安子|阿贵|阿成|阿平|阿忠)[^。\n]{0,20}(?:端着|抱着|拿着|拎着|递来|冲进|快步|进院|关门|收起|托盘|药碗|医箱)/;

const NEXT_RELAY_POSITION_CONFLICT_RE =
  /(?:萧砚|王爷)[\s\S]{0,260}(?:院中|院里|石桌|石凳|药碗|喝下一口|唇边|靠回)[\s\S]{0,260}接下一镜：(?:屋内|门后|房内)[^。\n]{0,40}(?:破风|剑声|剑风|练剑|剑影)/;

const PALACE_POWER_PROP_RE = /圣旨|懿旨|白绫|冷宫|宫规|宗正司|摄政王|太后/;

const PALACE_POWER_BOUNDARY_RE =
  /命审|命押|命罚|命杀|候审|收押|暂押|私刑|越权|添字|宗正司|特旨|赐死|宣旨|懿旨|宫规|担得起|谁给你的胆/;

const PALACE_POWER_JARGON_RE = /命审|命押|命搜|命罚|命杀/g;

const PALACE_BUREAUCRATIC_DIALOGUE_RE =
  /抗选冲殿|冲殿犯上|犯上|涉旧案器物|禁中旧物|这等物件|禁物|依规处置|冲撞宫门|冲撞供殿|抗旨不遵|内廷封存|收归内廷|候审候死|冷宫候死|冷院候死|候死/;

const PSEUDO_COOL_SHORT_LINE_RE =
  /别慌[，,]先活|别掉[。！!？?]?那根|封我[，,]可以|少问[。！!？?]交|命还悬着|簪子亮了|先活。|先活$/;

const COMMA_TOUGH_GUY_FRAGMENT_RE =
  /(?:关我|封我|押我|搜我|验我|关|封|押|搜|验|交)[，,](?:可以|行|不行)|白绫你们留着|要验[，,]就验它/;

const FLAT_FUNCTIONAL_DIALOGUE_RE =
  /旨上写押[，,]没写勒|公公眼真尖|姐姐[，,]你别再拧了|别再拧了|听不懂最好|要验[，,]就验这个|王爷刚才说了[，,]?看着|命账最值钱|替我背|谁替.*认|簪子.*开口|对我[，,]是旧物/;

const ABSTRACT_FUNCTION_WORD_RE =
  /规矩|价钱|活路|背锅|把柄|条件|人情|主动权|破绽|算账|这笔账|讨价|值点什么|股权|证据|权限|声明|合约|官宣|我的人|黑卡|房卡|订单|诊断书|身份|军令|规则|罚款|精神状态|合理吗/;

const EMOTION_SOURCE_RE =
  /疼|痛|怕|慌|急|气|恼|怒|羞|丢脸|委屈|心虚|试探|不信|嘴硬|吃醋|护|装|咳|喘|抖|红了眼|攥|捏|按住|压住|躲|避开|盯|瞪|笑|冷笑|挑眉|咬唇|低头|抬眼|偏头|贴近|退后|挡|抢|夺|扯|推|递|扣住|摔|撕|甩|砸|镜头|直播|手机|屏幕|桌|主桌|合同|鉴定书|门禁卡|印章|项目章|戒指|外套|酒杯|热搜|黑卡|房卡|银针|病历|订单|鉴定物|擂台|身份牌|病人|心跳|药碗|药膳|咳帕|长剑|账本|钥匙|汤匙|披风|点心|小厨房|忌口|食盒|药盅|床幔|墙头|银子|手腕|虎口|剑鞘|罚单|二维码|工牌|奶茶|盆栽|群聊|直播间|白绫|圣旨|门槛|信物|伤口|封条|心口|耳坠|剑锋|剑柄|剑纹|星纹剑|白塔|倒计时|机甲|驾驶舱|接口|备用线|残线|断线|能量槽|核心|星核|机械义心|护臂|蓝白光|蓝白能量纹|权限令/;

const SLOGAN_DIALOGUE_RE =
  /复印件也配判我|项目章扣住|谁也别想跑|董事会来电|我的人[，,]?谁准你碰|合约归合约|委屈不归你|酒她不喝[，,]?我替|针没拔[，,]?命不算你的|诊断书假的[，,]?心跳是真的|药谁换的[，,]?现在说|谁批准你正常了|这合理吗|精神状态后补|给我滚去上班/;

const COMPRESSED_FUNCTION_DIALOGUE_RE =
  /我嘴严|银子堵|墙是证|人在这儿|拿着[。！!？?]?以后你来守我|都听见了|亲喂[，,]?本王才喝|我只认现成的|看都看见了|贴近点看|院门不换人/;

const GENERIC_SWEET_ROMANCE_DIALOGUE_RE =
  /我眼神好|看见了[，,]?收不回|我总得给自己留后路|既撞见了[，,]?你就别乱跑|省得你嘴快|稳不稳妥[，,]?我得先看看|刚进府[，,]?就惦记走|想我不往外说|别让王爷再折腾|就得守他这一口药|最稳妥/;

const ELLIPSIS_COMPRESSION_DIALOGUE_RE =
  /病成这样……还翻墙|王妃进门……先学会闭眼|[^“”"\n]{1,8}……[^“”"\n]{1,8}[？?。！!]/;

const OVERCRAFTED_SWEET_LINE_RE =
  /热气最足的时候.*凉心话|嫌药苦.*嫌自己心太软|炖进药锅|这碗病是熬给外人看的|夜里的病都分两锅熬/;

const SWEET_MATERIAL_WORD_RE = /热|凉|苦|火候/g;

const SWEET_OCCUPATION_WORD_RE =
  /食盒|火候|甜|咸|赔本|手艺|铺子|铺面|银子|客人|忌口|药膳|药碗|药苦|咳帕|咳/;

const OVERLOADED_DIALOGUE_SPLIT_RE = /[，,；;。]/g;

const PERFORMANCE_BEAT_RE =
  /吸气|停手|抬眼|避开|偏开|压住|卡住|攥紧|捏紧|按住|扣住|悬住|停在唇边|咳声|咳岔|食盒盖|药碗|咳帕|退半步|站住|愣住|被噎|抢|躲|眼神|指尖|手腕|喉头|肩背/;

const HOLLOW_PERFORMANCE_ACTION_RE =
  /画面：[^。\n]*(?:回答她|回答他|继续追问|继续问|继续说|两人对视|看着对方|气氛一静|空气一静|沉默片刻|站在原地)[^。\n]*/g;

const STATE_LINKED_ACTION_RE =
  /食盒|药碗|咳帕|长剑|剑影|账本|钥匙|汤匙|披风|床幔|墙头|袖口|门闩|药膳单|手腕|指尖|喉头|肩背|停手|抬眼|避开|偏开|压住|攥紧|按住|扣住|悬住|咳声|退半步|被噎|抢|躲/;

const STORYBOARD_BEAT_LOAD_PATTERNS = [
  /进来|进院|入画|冲进来|跑进来|跨进/,
  /递|塞|压进|推向|抽出|端来|拿出/,
  /药膳单|名册|钥匙串|医箱|药碗|咳帕|小盅/,
  /院门|锁院|关上|门帘|门闩/,
  /夜色|夜里|天色|转暗|一转/,
  /耳边|靠近|拂过|低低落下一句/,
  /练剑|剑风|破风声|长剑|动刀/,
  /接下一镜|下一镜/,
];

const HARD_TIME_JUMP_RE = /夜色(?:一转|转深|渐深|压下|沉下)|天色(?:一转|转暗|渐暗)|转眼夜里|夜里[\s\S]{0,80}(?:门后|屋里|房门|端着药回来)/;

const CUT_TRANSITION_RE = /(?:镜头|画面)(?:一切|切到|切至|转到)|切到夜里|夜色一转|转眼夜里/;

const SKIPPED_KEY_ACTION_RE = /药碗(?:已经)?空了些|已经喂完|喂完药|两人僵持后|夜里她端药回来|端着空了些的药碗|回身.*空了些|重新热好的药|夜里[^。；\n]{0,25}重新热好/;

const UNEARNED_DOOR_HOOK_RE =
  /(?:喝下第一口|喝下一口|第一口|喂到唇边|唇边)[\s\S]{0,220}(?:屋门半掩|房门半掩|门口|门闩|推门|门后|破风|剑声|剑影)|(?:端着空了些的药碗|空了些的药碗)[\s\S]{0,160}(?:屋门|房门|门闩|门后|破风|剑声|剑影)/;

const PROP_TELEPORT_RE =
  /(?:不知何时|已被人|已经)[^。；\n]{0,35}(?:挂着|挂在|挂上|放在|放到|到了)[^。；\n]{0,35}(?:咳帕|帕子|药碗|药膳单|食盒|钥匙)|(?:咳帕|帕子|药碗|药膳单|食盒|钥匙)[^。；\n]{0,35}(?:不知何时|已被人|已经)[^。；\n]{0,35}(?:挂着|挂在|挂上|放在|放到|到了)|(?:门闩|门上|桌上|案上)[^。；\n]{0,35}(?:不知何时|已被人|已经)[^。；\n]{0,35}(?:挂着|放着|摆着)[^。；\n]{0,35}(?:咳帕|帕子|药碗|药膳单|食盒|钥匙)/;

const NEXT_RELAY_LINE_RE = /(?:^|\n)\s*-?\s*接下一镜：([^\n]+)/g;

const NEXT_RELAY_BEAT_PATTERNS = [
  /夜里|夜色|天色|转眼|重新热|热过/,
  /端着|拿着|捧着|抱着|攥着|夹着/,
  /咳帕|帕子|药碗|药膳单|食盒|钥匙/,
  /门闩|房门|半掩|推门|进屋|屋里|门后/,
  /挂在|挂上|挂着|已被|已经|不知何时/,
  /练剑|剑声|剑风|破风|破风声|破风响|剑影|长剑/,
];

const NEXT_RELAY_PROP_TELEPORT_RE =
  /(?:咳帕|帕子|药碗|药膳单|食盒|钥匙)[^。\n]{0,35}(?:已被|已经|不知何时|挂在|挂上|挂着|放到|放在|到了)[^。\n]{0,35}(?:门闩|门上|桌上|案上|别人手里|他手里|她手里)|(?:先前|刚才|那方|那只|那张)[^。\n]{0,20}(?:咳帕|帕子|药碗|药膳单|食盒|钥匙)[^。\n]{0,35}(?:已被|已经|不知何时|挂在|挂上|挂着|放到|放在|到了)/;

const NEXT_RELAY_LEAVES_FEEDING_SCENE_RE =
  /(?:空勺|空碗|空了些的药碗|端着[^。\n]{0,12}(?:勺|碗)|拿着[^。\n]{0,12}(?:勺|碗))[^。\n]{0,35}(?:房门|屋里|门口|门边|往房门|往屋|走去|推门)/;

const PROP_DUPLICATED_LOCATION_RULES = [
  {
    prop: '咳帕',
    firstLocation: /(?:手里|手心|掌心|袖里|袖中|指间|另一手|一手|攥着|捏着|拿着|握着|拎着|夹着)[^。；\n]{0,35}(?:咳帕|帕子|帕角)|(?:咳帕|帕子|帕角)[^。；\n]{0,35}(?:手里|手心|掌心|袖里|袖中|指间|攥着|捏着|拿着|握着|拎着|夹着)/,
    secondLocation: /(?:门闩|门上|门边|门口|门板|门缝)[^。；\n]{0,35}(?:挂着|垂着|挂住|落着|正是|另一角)[^。；\n]{0,35}(?:咳帕|帕子|帕角)|(?:咳帕|帕子|帕角)[^。；\n]{0,35}(?:挂在|挂到|挂上|挂着|垂在|落在)[^。；\n]{0,25}(?:门闩|门上|门边|门口|门板|门缝)/,
    transfer: /(?:把|将|顺手|抬手|伸手)[^。；\n]{0,45}(?:咳帕|帕子|帕角)[^。；\n]{0,45}(?:挂在|挂到|挂上|放在|放到|塞进|塞到|递到|递给)|(?:咳帕|帕子|帕角)[^。；\n]{0,30}(?:滑出|滑出来|掉出|掉下来|滑下|落进|落到)[^。；\n]{0,30}(?:掌心|手里|门闩|门边|地上)/,
  },
  {
    prop: '药碗',
    firstLocation: /(?:端着|捧着|拿着|接着|接住|托住|手里|掌心|怀里|双手)[^。；\n]{0,35}药碗|药碗[^。；\n]{0,35}(?:端在|捧在|拿在|接在|托在|手里|掌心)/,
    secondLocation: /(?:石桌|桌上|案上|案几|托盘|石几)[^。；\n]{0,35}药碗|药碗[^。；\n]{0,35}(?:放在|搁在|摆在|停在|落在)[^。；\n]{0,25}(?:石桌|桌上|案上|案几|托盘|石几)/,
    transfer: /(?:把|将|顺手|抬手|伸手|下意识)[^。；\n]{0,45}药碗[^。；\n]{0,45}(?:放|搁|推|递|塞|端|接|拿)|药碗[^。；\n]{0,35}(?:被推到|被塞进|被递到|放回|搁回|端起|接过|接住|递进|塞回)/,
  },
] as const;

const TEMPLATE_PLOT_BLEED_RE =
  /短刀[\s\S]{0,5000}(?:凤冠|血书|染血旧簪)|(?:凤冠|血书|染血旧簪)[\s\S]{0,5000}短刀/;

const STORY_BOUNDARY_HIGH_RISK_TERMS = [
  '凤冠',
  '血书',
  '染血旧簪',
  '血簪',
  '旧簪',
  '短刀',
  '匕首',
  '冷宫',
  '冷院',
  '黑猫',
  '黑曜',
  '灵宠',
  '系统',
  '摄政王',
  '太后',
  '佛珠',
  '凤钗',
  '药碗',
];

const DIALOGUE_LINE_RE = /^对白：/gm;
const DIALOGUE_TEXT_RE = /对白：[^“"‘'\n]*[“"‘']([^”"’'\n]+)[”"’']/g;
const DIALOGUE_TEXT_LINE_RE = /对白：[^“"‘'\n]*[“"‘']([^”"’'\n]+)[”"’']/;
const TIME_SEGMENT_LINE_RE = /^\[(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)秒\]/;
const SHORTDRAMA_SPEECH_CHARS_PER_SECOND = 6;
const DIALOGUE_LINE_SPEAKABLE_CHAR_LIMIT = 28;
const DIALOGUE_LINE_TARGET_CHAR_LIMIT = 20;
const STORYBOARD_DIALOGUE_CHAR_BUDGET = 78;

const MODERN_REVENGE_RE =
  /亲子鉴定|假千金|股权|股份|董事会|订婚|退婚|直播|项目章|门禁卡|净身出户|律师函|上市|收权|转让书|主桌|鉴定书|签字/;

const MALE_POWER_RE =
  /战神|赘婿|神医|龙王|鉴宝|宗师|废物|吃软饭|银针|诊断书|龙纹令牌|战部|老太爷|离婚协议|药碗|病历夹|赔命|心跳|抢救|跪着滚|净身出户|订单|军令|身份牌/;

const MALE_POWER_EXCLUSIVE_RE =
  /战神|赘婿|神医|龙王|鉴宝|宗师|废物|吃软饭|银针|诊断书|龙纹令牌|战部|老太爷|离婚协议|病历夹|赔命|心跳|抢救|跪着滚|净身出户|订单|军令|身份牌/;

const CONTINUITY_PLACEHOLDER_RE =
  /^(?:无|暂无|没有|待定|待补充|none|null|n\/a|-|—)$/i;

const SICK_SWEET_SIGNAL_RE =
  /装病|假病|病弱|病秧子|冲喜|喂药|药膳|药碗|咳|抓包|翻墙练剑/;

const SWEET_CORE_LOOP_RE =
  /装病|假病|病弱|病秧子|咳|药膳|药碗|喂药|抓包|破绽|反咬|投喂|试吃|忌口|嘴硬|护短|偏爱|假戏真甜|翻墙练剑/;

const SWEET_STRONG_CORE_LOOP_RE =
  /装病|假病|病弱|病秧子|咳|药膳|药碗|喂药|抓包|破绽|反咬|投喂|护短|偏爱|假戏真甜|翻墙练剑/;

const SWEET_BUSINESS_DRIFT_RE =
  /铺面|铺子|宴席单|宴席|采买|账本|订单|生意|开铺/;

const SCRIPT_BACKSTAGE_SECTION_RE =
  /###\s*(?:分镜职责与边界|角色与连续性)|(?:^|\n)\s*-\s*(?:本镜解决|本镜不提前|爽点\/压力点|人设锁定|道具\/视觉锚点|道具状态|群演处理)：/;

const SOFT_TRANSITION_EPISODE_RE =
  /过渡|铺垫|纯承接|承接上一集|准备|熟悉|观察|等待|先稳住|铺路|酝酿|慢慢升温|关系升温|埋下伏笔|日常展开|暂时没有|继续推进/;

const EPISODE_BURST_RE =
  /当众|撞见|抓包|反咬|揭|暴露|露出|甩|砸|摔|抢|逼|赌约|护短|偏爱|投喂|吃光|装病|假病|翻墙练剑|喂药|药碗|咳|退婚|股权|直播|亲子鉴定|跪|打脸|翻盘|反杀|热搜|官宣|领证|战神|银针|癫|发疯|离谱|倒计时|赔命|抢救|门禁卡|项目章|黑卡|房卡/;

function isSweetRomancePlan(plan: SeriesPlan): boolean {
  if (plan.genreMode && plan.genreMode !== 'custom') {
    return plan.genreMode === 'ancient_sweet_romance';
  }
  return SWEET_ROMANCE_RE.test(JSON.stringify(plan));
}

function isSweetRomanceScript(text: string): boolean {
  return SWEET_ROMANCE_RE.test(text) && !MODERN_REVENGE_RE.test(text) && !MALE_POWER_EXCLUSIVE_RE.test(text);
}

function getEpisodeScriptGenreMode(context?: EpisodeScriptQualityContext): SeriesPlan['genreMode'] {
  return context?.genreMode || context?.plan?.genreMode || 'custom';
}

function isSweetRomanceScriptForContext(text: string, context?: EpisodeScriptQualityContext): boolean {
  const genreMode = getEpisodeScriptGenreMode(context);
  if (genreMode === 'ancient_sweet_romance') return true;
  if (genreMode !== 'custom') return false;
  return isSweetRomanceScript(text);
}

function getSeriesGenreMode(plan: SeriesPlan): SeriesPlan['genreMode'] {
  return plan.genreMode || 'custom';
}

function isMysticPlan(plan: SeriesPlan): boolean {
  return getSeriesGenreMode(plan) === 'mystic_fengshui';
}

function isMysticScript(text: string): boolean {
  return MYSTIC_THREAT_RE.test(text)
    || (MYSTIC_IDENTITY_RE.test(text) && (MYSTIC_THREAT_RE.test(text) || MYSTIC_SCRIPT_LIVE_REACTION_RE.test(text)))
    || (MYSTIC_SCRIPT_LIVE_REACTION_RE.test(text) && MYSTIC_THREAT_RE.test(text));
}

function isMysticScriptForContext(text: string, context?: EpisodeScriptQualityContext): boolean {
  const genreMode = getEpisodeScriptGenreMode(context);
  if (genreMode === 'mystic_fengshui') return true;
  if (genreMode !== 'custom') return false;
  return isMysticScript(text);
}

function getEpisodeSatisfactionSuggestion(plan: SeriesPlan, sweetRomance: boolean): string {
  const genreMode = getSeriesGenreMode(plan);
  if (sweetRomance) {
    return '爽点要落到可拍的关系或经营动作，例如点心被吃光、小厨房归她、他当众点名王妃做的、她拿到宴席单或铺面钥匙。';
  }
  if (genreMode === 'modern_revenge') {
    return '爽点要落到可拍的反击动作或证据状态，例如当众验章、直播权限保住、退婚协议被反压、股权文件改走公开表决。';
  }
  if (genreMode === 'boss_romance') {
    return '爽点要落到可拍的关系动作，例如当众挡酒、合约被压住、外套披上、热搜反打、房卡或黑卡改变两人边界。';
  }
  if (genreMode === 'male_power_fantasy') {
    return '爽点要落到可拍的能力兑现，例如一针救醒病人、诊断书被反证、对手当众跪下、身份牌或战部来电露出。';
  }
  if (genreMode === 'male_medical_master') {
    return '爽点要落到可拍的医术兑现，例如银针落穴、监护仪心跳回稳、病历误诊被划掉、药方当场见效或庸医抢话失败。';
  }
  if (genreMode === 'male_war_god_dragon') {
    return '爽点要落到可拍的身份压场，例如令牌被认出、旧部当众敬礼、保安退开、勋章编号对上或对手跪服。';
  }
  if (genreMode === 'male_son_in_law') {
    return '爽点要落到可拍的羞辱回收，例如家宴桌上合同反转、岳家抢功失败、废物称呼被结果打回或老婆选择站到他身边。';
  }
  if (genreMode === 'male_treasure_appraisal') {
    return '爽点要落到可拍的鉴定结果，例如暗格打开、落款显真、拍卖价翻倍、假货变真货或抢拍的人当场改口。';
  }
  if (genreMode === 'rebirth_revenge') {
    return '爽点要落到可拍的改命动作，例如前世物证被提前拿住、催签被反压、车祸节点改掉、旧照片反噬仇人。';
  }
  if (genreMode === 'transmigration_book') {
    return '爽点要落到可拍的改剧情动作，例如原书台词被改、剧本页变灰、人设限制被钻空、恶毒女配标签当场反噬。';
  }
  if (genreMode === 'system_task') {
    return '爽点要落到可拍的规则兑现，例如任务完成弹窗、奖励到账、惩罚转嫁、倒计时卡在最后一秒或道具栏亮起。';
  }
  if (genreMode === 'quick_transmigration') {
    return '爽点要落到可拍的任务指标变化，例如好感值回升、黑化值停住、宿主遗憾被补上、世界任务进度条跳动。';
  }
  if (genreMode === 'time_loop') {
    return '爽点要落到可拍的循环验证，例如便签内容改变、死亡倒计时被推迟、门禁第一次打开或副本规则被钻出缝。';
  }
  if (genreMode === 'body_swap') {
    return '爽点要落到可拍的错位反打，例如用对方权限过门、身体习惯救场、证件反压质疑或互换破绽被临场找补。';
  }
  if (genreMode === 'mind_reading') {
    return '爽点要落到可拍的信息差反击，例如心声被套话验证、预知画面对上、对手内心露怯或文件被提前保住。';
  }
  if (genreMode === 'bullet_comments') {
    return '爽点要落到可拍的剧透验证，例如弹幕预警成真、主角避开原剧情、观众提示反打对手或屏幕刷出新分支。';
  }
  if (genreMode === 'space_stockpile') {
    return '爽点要落到可拍的生存兑现，例如仓库清单锁定、物资进空间、第一波断电断水被提前化解或囤货被证明有用。';
  }
  if (genreMode === 'absurd_comedy') {
    return '爽点要落到可拍的荒诞反转，例如罚单反贴老板、二维码收款成功、群聊全员跟进、离谱规则变成主角的新权力。';
  }
  if (genreMode === 'family_ethics') {
    return '爽点要落到可拍的家庭反击，例如离婚协议被反压、房本归属说清、聊天记录当众外放、饭桌站队反转或孩子边界被守住。';
  }
  if (genreMode === 'mystic_fengshui') {
    return '爽点要落到可拍的玄学验证，例如罗盘指向真物、符灰落出名字、监控对上卦象、假大师露怯或怪事当场应验。';
  }
  if (genreMode === 'pure_comedy') {
    return '爽点要落到可拍的喜剧反转，例如误会反救场、嘴瓢变神助攻、拿错道具反而解决问题、补救失败却意外赢回局面。';
  }
  return '爽点要落到可拍动作或证据，例如当众签字、甩出账本、反派自爆、主角冷退场。';
}

function getEpisodeCliffhangerSuggestion(plan: SeriesPlan, sweetRomance: boolean): string {
  const genreMode = getSeriesGenreMode(plan);
  if (sweetRomance) {
    return '集尾要制造下一集甜宠问题，例如新点心单、试吃邀约、铺面钥匙、账本异常、宫宴名单或一句没说完的偏爱。';
  }
  if (genreMode === 'modern_revenge') {
    return '集尾要留下下一集能直接开拍的现代复仇钩子，例如直播弹窗、项目章状态变化、股权文件下一页、媒体追问或新证据露角。';
  }
  if (genreMode === 'boss_romance') {
    return '集尾要留下下一集能直接开拍的关系钩子，例如热搜新词条、房卡落手、合约隐藏条款、前任进场或一句没接完的护短。';
  }
  if (genreMode === 'male_power_fantasy') {
    return '集尾要留下下一集能直接开拍的逆袭钩子，例如监护仪突变、身份牌露角、更高人物来电、对手加码或病人喊出真身份。';
  }
  if (genreMode === 'male_medical_master') {
    return '集尾要留下下一集能直接开拍的病案钩子，例如监护仪再报警、病历夹第二页露出、神秘病人进门或药方被人调包。';
  }
  if (genreMode === 'male_war_god_dragon') {
    return '集尾要留下下一集能直接开拍的身份钩子，例如旧部来电、令牌编号被查到、旧敌车队到场或封号名单露出。';
  }
  if (genreMode === 'male_son_in_law') {
    return '集尾要留下下一集能直接开拍的岳家钩子，例如更大订单来电、离婚协议被抢、岳家亲戚进门或老婆态度转向。';
  }
  if (genreMode === 'male_treasure_appraisal') {
    return '集尾要留下下一集能直接开拍的藏品钩子，例如暗格里露出第二件物、拍卖师来电、证书编号对不上或局中人出价。';
  }
  if (genreMode === 'rebirth_revenge') {
    return '集尾要留下下一集能直接开拍的改命钩子，例如前世旧信露角、仇人提前行动、重来节点偏移或新的代价出现。';
  }
  if (genreMode === 'transmigration_book') {
    return '集尾要留下下一集能直接开拍的剧情钩子，例如剧本页改字、原主记忆闪回、关键角色误认或人设惩罚倒计时。';
  }
  if (genreMode === 'system_task') {
    return '集尾要留下下一集能直接开拍的系统钩子，例如新任务弹出、奖励异常、惩罚倒计时、隐藏选项亮起或系统警告。';
  }
  if (genreMode === 'quick_transmigration') {
    return '集尾要留下下一集能直接开拍的快穿钩子，例如好感值异常、黑化值爆表、新支线任务、宿主记忆碎片或世界崩坏预警。';
  }
  if (genreMode === 'time_loop') {
    return '集尾要留下下一集能直接开拍的循环钩子，例如倒计时重置失败、便签多出一行、出口门闪开或死亡条件变化。';
  }
  if (genreMode === 'body_swap') {
    return '集尾要留下下一集能直接开拍的错位钩子，例如换回条件露角、对方身体受伤、手机弹出秘密消息或镜子再次异动。';
  }
  if (genreMode === 'mind_reading') {
    return '集尾要留下下一集能直接开拍的信息钩子，例如新人物心声响起、预知画面变暗、梦境碎片对上或对手发现异常。';
  }
  if (genreMode === 'bullet_comments') {
    return '集尾要留下下一集能直接开拍的弹幕钩子，例如弹幕集体改口、观众刷出死亡预警、屏幕出现新称呼或剧透被现场反证。';
  }
  if (genreMode === 'space_stockpile') {
    return '集尾要留下下一集能直接开拍的生存钩子，例如天气预警升级、仓库断电、空间容量报警、物资清单缺口或灾变第一声落下。';
  }
  if (genreMode === 'absurd_comedy') {
    return '集尾要留下下一集能直接开拍的荒诞钩子，例如群聊新规则、二维码新账单、老板反被罚、全员误读升级或更离谱通知弹出。';
  }
  if (genreMode === 'family_ethics') {
    return '集尾要留下下一集能直接开拍的家庭钩子，例如新聊天记录弹出、亲戚进门、房本下一页露出、孩子电话打来或离婚协议被抢走。';
  }
  if (genreMode === 'mystic_fengshui') {
    return '集尾要留下下一集能直接开拍的玄学钩子，例如罗盘指向新房间、符纸背面显字、监控出现异影、旧物裂开或直播连线求救。';
  }
  if (genreMode === 'pure_comedy') {
    return '集尾要留下下一集能直接开拍的笑点钩子，例如更大的误会弹窗、错误对象进门、道具又被拿反、群聊新截图或搭档补救出新乱子。';
  }
  return '集尾要制造下一集问题，例如新证据出现、关键人物进门、身份被误认或更大代价落地。';
}

function getEpisodeContinuityInSuggestion(plan: SeriesPlan, sweetRomance: boolean): string {
  const genreMode = getSeriesGenreMode(plan);
  if (sweetRomance) {
    return '第2集以后必须承接上一集的具体点心、厨房归属、赌约、暧昧误读、生意机会或未解决的小压力，不能写“无”。';
  }
  if (genreMode === 'modern_revenge') {
    return '第2集以后必须承接上一集的具体证据、项目章归属、直播权限、股权文件、媒体镜头或未解决的公开压力，不能写“无”。';
  }
  if (genreMode === 'boss_romance') {
    return '第2集以后必须承接上一集的具体合约、热搜、房卡、外套、酒杯、亲密误会或家族/前任压力，不能写“无”。';
  }
  if (genreMode === 'male_power_fantasy') {
    return '第2集以后必须承接上一集的具体银针、诊断书、身份牌、病人状态、订单/军令或对手加码，不能写“无”。';
  }
  if (genreMode === 'male_medical_master') {
    return '第2集以后必须承接上一集的具体银针、病历、药方、监护仪读数、病人状态、庸医失手或新病案，不能写“无”。';
  }
  if (genreMode === 'male_war_god_dragon') {
    return '第2集以后必须承接上一集的具体令牌、旧部电话、勋章、车队、封号名单、对手跪服或旧敌加码，不能写“无”。';
  }
  if (genreMode === 'male_son_in_law') {
    return '第2集以后必须承接上一集的具体家宴羞辱、离婚协议、订单、合同、岳家站队、老婆反应或新亲戚压力，不能写“无”。';
  }
  if (genreMode === 'male_treasure_appraisal') {
    return '第2集以后必须承接上一集的具体玉佩、瓷器、落款、暗格、拍卖牌、鉴定证书或藏品价格变化，不能写“无”。';
  }
  if (genreMode === 'rebirth_revenge') {
    return '第2集以后必须承接上一集的具体前世物证、旧照片、旧信、婚书/合同状态、重来节点变化或仇人提前动作，不能写“无”。';
  }
  if (genreMode === 'transmigration_book') {
    return '第2集以后必须承接上一集的具体原书节点、剧本页、人设限制、章节提示、角色误读或剧情线偏移，不能写“无”。';
  }
  if (genreMode === 'system_task') {
    return '第2集以后必须承接上一集的具体任务面板、倒计时、积分、奖励、惩罚、道具栏状态或系统异常，不能写“无”。';
  }
  if (genreMode === 'quick_transmigration') {
    return '第2集以后必须承接上一集的具体宿主身份、好感值、黑化值、世界任务、人设限制、支线任务或世界异常，不能写“无”。';
  }
  if (genreMode === 'time_loop') {
    return '第2集以后必须承接上一集的具体循环次数、便签、钟表、倒计时、死亡地点、门禁状态或副本规则，不能写“无”。';
  }
  if (genreMode === 'body_swap') {
    return '第2集以后必须承接上一集的具体手机、证件、权限卡、身体习惯、镜子异动、身份误判或换回线索，不能写“无”。';
  }
  if (genreMode === 'mind_reading') {
    return '第2集以后必须承接上一集的具体心声对象、预知画面、梦境碎片、文件状态、眼神破绽或监听信息，不能写“无”。';
  }
  if (genreMode === 'bullet_comments') {
    return '第2集以后必须承接上一集的具体弹幕预警、屏幕内容、观众提示、原剧情称呼、验证结果或命运偏移，不能写“无”。';
  }
  if (genreMode === 'space_stockpile') {
    return '第2集以后必须承接上一集的具体空间状态、仓库清单、物资缺口、天气预警、断水断电或灾变征兆，不能写“无”。';
  }
  if (genreMode === 'absurd_comedy') {
    return '第2集以后必须承接上一集的具体罚单、二维码、群聊、工牌、办公室规则或误读后果，不能写“无”。';
  }
  if (genreMode === 'family_ethics') {
    return '第2集以后必须承接上一集的具体饭桌冲突、离婚协议、房本、聊天记录、孩子边界、家门钥匙或亲戚站队，不能写“无”。';
  }
  if (genreMode === 'mystic_fengshui') {
    return '第2集以后必须承接上一集的具体符纸、罗盘指向、香灰痕迹、旧物状态、直播弹幕、监控异影或未解怪事，不能写“无”。';
  }
  if (genreMode === 'pure_comedy') {
    return '第2集以后必须承接上一集的具体误会、拿错的物件、发错的消息、社死现场、搭档补救后果或新笑点任务，不能写“无”。';
  }
  return '第2集以后必须承接上一集的具体道具、证据、误会或未解决威胁，不能写“无”。';
}

function getEpisodeContinuityOutSuggestion(plan: SeriesPlan, sweetRomance: boolean): string {
  const genreMode = getSeriesGenreMode(plan);
  if (sweetRomance) {
    return '每集都要留下可被下一集直接承接的点心、厨房动作、账本/铺面机会、暧昧误读、偏爱动作或小代价。';
  }
  if (genreMode === 'modern_revenge') {
    return '每集都要留下可被下一集直接承接的证据、权限、项目章状态、直播画面、文件页或对手失手动作。';
  }
  if (genreMode === 'boss_romance') {
    return '每集都要留下可被下一集直接承接的合约状态、热搜变化、房卡/黑卡归属、公开偏爱动作或误会代价。';
  }
  if (genreMode === 'male_power_fantasy') {
    return '每集都要留下可被下一集直接承接的能力证据、病人状态、身份线索、订单/军令变化或更强对手。';
  }
  if (genreMode === 'male_medical_master') {
    return '每集都要留下可被下一集直接承接的病历变化、药方疑点、监护仪读数、病人状态、医界身份线索或新病案。';
  }
  if (genreMode === 'male_war_god_dragon') {
    return '每集都要留下可被下一集直接承接的令牌状态、旧部反应、勋章编号、车队动向、旧敌线索或更高势力。';
  }
  if (genreMode === 'male_son_in_law') {
    return '每集都要留下可被下一集直接承接的岳家站队、离婚协议状态、订单/合同变化、老婆态度或新羞辱回收点。';
  }
  if (genreMode === 'male_treasure_appraisal') {
    return '每集都要留下可被下一集直接承接的藏品状态、暗格线索、落款疑点、拍卖价变化、证书编号或局中人动向。';
  }
  if (genreMode === 'rebirth_revenge') {
    return '每集都要留下可被下一集直接承接的前世物证、重来节点偏移、仇人提前动作、改命代价或新旧时间差。';
  }
  if (genreMode === 'transmigration_book') {
    return '每集都要留下可被下一集直接承接的剧情偏移、剧本页状态、人设限制、原角色误读、章节提示或惩罚倒计时。';
  }
  if (genreMode === 'system_task') {
    return '每集都要留下可被下一集直接承接的任务状态、倒计时、积分变化、奖励/惩罚、道具栏变化或系统异常。';
  }
  if (genreMode === 'quick_transmigration') {
    return '每集都要留下可被下一集直接承接的任务指标、好感值、黑化值、宿主遗憾、世界规则或支线异常。';
  }
  if (genreMode === 'time_loop') {
    return '每集都要留下可被下一集直接承接的循环次数、规则验证结果、便签变化、倒计时、死亡条件或出口线索。';
  }
  if (genreMode === 'body_swap') {
    return '每集都要留下可被下一集直接承接的身份误判、手机/证件状态、权限变化、身体破绽或换回条件。';
  }
  if (genreMode === 'mind_reading') {
    return '每集都要留下可被下一集直接承接的心声线索、预知画面、梦境碎片、信息差结果或新心声对象。';
  }
  if (genreMode === 'bullet_comments') {
    return '每集都要留下可被下一集直接承接的弹幕预警、屏幕变化、观众提示、剧透真假验证或命运偏移。';
  }
  if (genreMode === 'space_stockpile') {
    return '每集都要留下可被下一集直接承接的空间容量、物资清单、仓库状态、灾变征兆、断水断电或生存代价。';
  }
  if (genreMode === 'absurd_comedy') {
    return '每集都要留下可被下一集直接承接的规则变化、罚单状态、群聊发酵、二维码结果或更荒诞的新误读。';
  }
  if (genreMode === 'family_ethics') {
    return '每集都要留下可被下一集直接承接的家庭关系变化、协议/房本状态、聊天记录发酵、孩子边界或亲戚站队后果。';
  }
  if (genreMode === 'mystic_fengshui') {
    return '每集都要留下可被下一集直接承接的征兆变化、符纸/罗盘状态、旧物线索、监控画面、直播连线或更深因果。';
  }
  if (genreMode === 'pure_comedy') {
    return '每集都要留下可被下一集直接承接的误会状态、错发消息、错拿物件、补救失败后果或更大的社交事故。';
  }
  return '每集都要留下可被下一集直接承接的道具、证据、误判、人物动作或更大代价。';
}

function getRepeatedSatisfactionSuggestion(plan: SeriesPlan, sweetRomance: boolean): string {
  const genreMode = getSeriesGenreMode(plan);
  if (sweetRomance) {
    return '连续三集不要使用同一种爽点。穿插投喂偏爱、温柔护短、暧昧误读、日常拉扯和生意成长。';
  }
  if (genreMode === 'modern_revenge') {
    return '连续三集不要使用同一种爽点。穿插公开羞辱反打、证据揭露、权限翻盘、反派反噬和盟友压场。';
  }
  if (genreMode === 'boss_romance') {
    return '连续三集不要使用同一种爽点。穿插边界拉扯、公开偏爱、吃醋误读、前任反噬和关系升级。';
  }
  if (genreMode === 'male_power_fantasy') {
    return '连续三集不要使用同一种爽点。穿插受辱反击、能力落地、身份露角、对手跪服和更高资源进场。';
  }
  if (genreMode === 'male_medical_master') {
    return '连续三集不要使用同一种爽点。穿插误诊反打、银针救急、药方验证、监护仪回稳、庸医反噬和医界身份露角。';
  }
  if (genreMode === 'male_war_god_dragon') {
    return '连续三集不要使用同一种爽点。穿插当众受辱、令牌露角、旧部认出、对手跪服、旧敌加码和身份压场。';
  }
  if (genreMode === 'male_son_in_law') {
    return '连续三集不要使用同一种爽点。穿插家宴反打、岳家抢功失败、订单落地、老婆站队、离婚协议反压和更大资源进场。';
  }
  if (genreMode === 'male_treasure_appraisal') {
    return '连续三集不要使用同一种爽点。穿插假货反转、暗格打开、落款验真、拍卖翻价、对手抢拍失败和局中局露角。';
  }
  if (genreMode === 'rebirth_revenge') {
    return '连续三集不要使用同一种爽点。穿插前世刺痛、节点抢先、物证保住、仇人反噬、命运偏移和改命代价。';
  }
  if (genreMode === 'transmigration_book') {
    return '连续三集不要使用同一种爽点。穿插原情节点、人设限制、剧情改写、角色误读、惩罚倒计时和新剧情偏移。';
  }
  if (genreMode === 'system_task') {
    return '连续三集不要使用同一种爽点。穿插任务砸脸、倒计时逼迫、卡规则完成、奖励兑现、惩罚反噬和系统异常。';
  }
  if (genreMode === 'quick_transmigration') {
    return '连续三集不要使用同一种爽点。穿插宿主身份、人设限制、好感值变化、黑化值报警、任务进度和世界异常。';
  }
  if (genreMode === 'time_loop') {
    return '连续三集不要使用同一种爽点。穿插重复时刻、失败痕迹、规则验证、死亡条件变化、便签改写和出口线索。';
  }
  if (genreMode === 'body_swap') {
    return '连续三集不要使用同一种爽点。穿插身份露馅、权限错用、身体习惯救场、临场找补、互换破绽和换回线索。';
  }
  if (genreMode === 'mind_reading') {
    return '连续三集不要使用同一种爽点。穿插心声入耳、表里不一、信息差反套、预知验证、新对象心声和对手察觉。';
  }
  if (genreMode === 'bullet_comments') {
    return '连续三集不要使用同一种爽点。穿插弹幕预警、半信半疑验证、原剧情偏移、观众提示升级、刷屏反转和来源悬念。';
  }
  if (genreMode === 'space_stockpile') {
    return '连续三集不要使用同一种爽点。穿插囤货被嘲、物资入库、灾变兑现、空间限制、清单缺口和生存代价。';
  }
  if (genreMode === 'absurd_comedy') {
    return '连续三集不要使用同一种爽点。穿插离谱规则、认真发疯、全员误读、道具升级和规则反噬。';
  }
  if (genreMode === 'family_ethics') {
    return '连续三集不要使用同一种爽点。穿插饭桌反咬、协议反压、房产边界、孩子保护、亲戚站队和家丑反噬。';
  }
  if (genreMode === 'mystic_fengshui') {
    return '连续三集不要使用同一种爽点。穿插怪事应验、假大师露怯、符纸破局、旧物露线、直播验证和因果反噬。';
  }
  if (genreMode === 'pure_comedy') {
    return '连续三集不要使用同一种爽点。穿插误会爆开、嘴瓢找补、道具错位、搭档帮倒忙、社死反转和反常识小胜。';
  }
  return '连续三集不要使用同一种爽点。穿插身份悬念、证据揭露、反派反噬、冷退场和权力翻盘。';
}

function extractStoryboardBlocks(text: string): string[] {
  return text
    .split(/(?=^##\s*分镜\s*0*\d+)/m)
    .map((block) => block.trim())
    .filter((block) => /^##\s*分镜\s*0*\d+/.test(block));
}

function countDialogueLines(text: string): number {
  return Array.from(text.matchAll(DIALOGUE_LINE_RE)).length;
}

function extractDialogueTexts(text: string): string[] {
  return Array.from(text.matchAll(DIALOGUE_TEXT_RE), (match) => match[1].trim())
    .filter(Boolean);
}

function countSpeakableChars(text: string): number {
  return text
    .replace(/[“”"‘’'（）()【】[\]\s，,。.!！?？；;：:、…—-]/g, '')
    .length;
}

function extractDialogueTextFromLine(line: string): string | null {
  return line.match(DIALOGUE_TEXT_LINE_RE)?.[1]?.trim() || null;
}

function findLongDialogueLines(dialogueTexts: string[]): Array<{ index: number; chars: number; text: string }> {
  return dialogueTexts
    .map((dialogue, index) => ({
      index: index + 1,
      chars: countSpeakableChars(dialogue),
      text: dialogue,
    }))
    .filter((line) => line.chars > DIALOGUE_LINE_SPEAKABLE_CHAR_LIMIT);
}

function formatDialogueLineSample(lines: Array<{ index: number; chars: number; text: string }>): string {
  return lines
    .slice(0, 3)
    .map((line) => `第${line.index}句约${line.chars}字`)
    .join('、');
}

function findSegmentDialogueBudgetIssues(
  storyboardBlocks: string[],
): Array<{ storyboardIndex: number; timeLabel: string; chars: number; budget: number; allowed: number }> {
  const issues: Array<{ storyboardIndex: number; timeLabel: string; chars: number; budget: number; allowed: number }> = [];

  storyboardBlocks.forEach((block, blockIndex) => {
    let current: { timeLabel: string; budget: number; chars: number } | null = null;
    const flush = () => {
      if (!current) {
        return;
      }
      const allowed = current.budget + Math.max(3, Math.ceil(current.budget * 0.2));
      if (current.chars > allowed) {
        issues.push({
          storyboardIndex: blockIndex + 1,
          timeLabel: current.timeLabel,
          chars: current.chars,
          budget: current.budget,
          allowed,
        });
      }
    };

    block.split(/\r?\n/).forEach((rawLine) => {
      const line = rawLine.trim();
      const timeMatch = line.match(TIME_SEGMENT_LINE_RE);
      if (timeMatch) {
        flush();
        const start = Number(timeMatch[1]);
        const end = Number(timeMatch[2]);
        const duration = Number.isFinite(start) && Number.isFinite(end)
          ? Math.max(0, end - start)
          : 0;
        current = {
          timeLabel: timeMatch[0],
          budget: Math.max(1, Math.floor(duration * SHORTDRAMA_SPEECH_CHARS_PER_SECOND)),
          chars: 0,
        };
      }

      const dialogue = extractDialogueTextFromLine(line);
      if (dialogue && current) {
        current.chars += countSpeakableChars(dialogue);
      }
    });
    flush();
  });

  return issues;
}

function findStoryboardDialogueBudgetIssues(
  storyboardBlocks: string[],
): Array<{ storyboardIndex: number; chars: number }> {
  return storyboardBlocks
    .map((block, index) => ({
      storyboardIndex: index + 1,
      chars: extractDialogueTexts(block).reduce((total, dialogue) => total + countSpeakableChars(dialogue), 0),
    }))
    .filter((block) => block.chars > STORYBOARD_DIALOGUE_CHAR_BUDGET);
}

function extractNextRelayLines(text: string): string[] {
  return Array.from(text.matchAll(NEXT_RELAY_LINE_RE), (match) => match[1].trim())
    .filter(Boolean);
}

function extractOsTexts(text: string): string[] {
  const standaloneOs = Array.from(text.matchAll(/(?:字幕\/OS|内心OS|OS)：([^\n]+)/g), (match) => match[1].trim());
  const inlineHeartVoice = Array.from(
    text.matchAll(/对白：[^：\n]*（心声）[^“"\n]*[“"]([^”"\n]+)[”"]/g),
    (match) => match[1].trim(),
  );
  return [...standaloneOs, ...inlineHeartVoice].filter(Boolean);
}

function findStoryBoundaryLeaks(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const leaks: string[] = [];
  lines.forEach((line, index) => {
    if (!line.includes('本镜不提前')) return;
    if (!/(?:不引出|不出现|不进入|不展开|不提前抛出|不提前亮出)/.test(line)) return;
    STORY_BOUNDARY_HIGH_RISK_TERMS.forEach((term) => {
      if (!line.includes(term)) return;
      const appearsElsewhere = lines.some((otherLine, otherIndex) => (
        otherIndex !== index
        && !otherLine.includes('本镜不提前')
        && otherLine.includes(term)
      ));
      if (appearsElsewhere) leaks.push(term);
    });
  });
  return Array.from(new Set(leaks));
}

export function findSeriesPlanQualityIssues(plan: SeriesPlan): SeriesQualityIssue[] {
  const issues: SeriesQualityIssue[] = [];
  const episodes = Array.isArray(plan.episodeCards) ? plan.episodeCards : [];
  const sweetRomance = isSweetRomancePlan(plan);
  const mysticPlan = isMysticPlan(plan);
  const planText = JSON.stringify(plan);
  const needsSickSweetLoop = sweetRomance && SICK_SWEET_SIGNAL_RE.test(planText);
  const productionAssets = Array.isArray(plan.productionAssets) ? plan.productionAssets : [];
  const weakOpeningHookEpisodes: number[] = [];

  if (plan.conceptAnalysis && !plan.conceptAnalysis.playRules?.recurringHook?.trim()) {
    issues.push({
      id: 'step0-missing-play-rules',
      label: '构思理解缺少玩法规则卡',
      suggestion: '请重新分析构思，让系统明确观众入口、反复钩子、爽点兑现、素材轮换和主角出手规则。',
    });
  }

  const styleConfig = plan.styleConfig?.trim() ?? '';
  if (!styleConfig) {
    issues.push({
      id: 'step0-missing-style-config',
      label: '系列圣经缺少全局视觉风格',
      suggestion: '请重新生成人设圣经，让 styleConfig 明确选择写实仿真人、3D动漫/3D国漫或2D动画中的一种，后续 Step1-Step5 才能稳定继承。',
    });
  } else if (/(真人|仿真人|写实)/.test(styleConfig) && /(3D|3d|国漫|动漫|CG|cg|PBR|pbr|2D|2d|二次元)/.test(styleConfig)) {
    issues.push({
      id: 'step0-mixed-style-config',
      label: '全局视觉风格混入多种媒介',
      suggestion: '建议把 styleConfig 拆成单一媒介路线，例如写实仿真人仙侠、3D国漫仙侠或2D国风水墨，不要在同一风格里同时写真人、3D和2D。',
    });
  }

  if (productionAssets.length === 0) {
    issues.push({
      id: 'step0-missing-production-assets',
      label: '人设圣经缺少单元素材池',
      suggestion: '请重新生成人设圣经，补齐怪物、病例、任务、证据、关系事件或关键场景，避免后续集卡只能围绕常驻人设打转。',
    });
  } else {
    const weakAssets = productionAssets.filter((asset) =>
      isBlank(asset.storyFunction) || isBlank(asset.conflictRule) || isBlank(asset.visualAnchor),
    );
    if (weakAssets.length > 0) {
      issues.push({
        id: 'step0-weak-production-assets',
        label: '单元素材池缺少可拍冲突说明',
        suggestion: '每个素材都要写清出场价值、眼前攻防规则和镜头能抓住的视觉锚点，否则后续只会列名不会入戏。',
      });
    }

    if (mysticPlan) {
      const mysticAssets = productionAssets.filter((asset) => MYSTIC_ASSET_RE.test(JSON.stringify(asset)));
      const threatAssets = productionAssets.filter((asset) => MYSTIC_ASSET_THREAT_RE.test(JSON.stringify(asset)));
      const proofAssets = productionAssets.filter((asset) => MYSTIC_ASSET_PROOF_RE.test(JSON.stringify(asset)));
      const liveAssets = productionAssets.filter((asset) => MYSTIC_ASSET_LIVE_RE.test(JSON.stringify(asset)));
      if (mysticAssets.length < 4 || threatAssets.length < 2 || proofAssets.length < 1 || liveAssets.length < 1) {
        issues.push({
          id: 'step0-mystic-thin-production-assets',
          label: '玄学抓鬼素材池不够支撑多集',
          suggestion: '玄学风水抓鬼的 productionAssets 至少要覆盖多个鬼怪/禁忌事件、法器应验、符纸罗盘雷法兑现和直播破防事件，不能只靠一个女鬼或一句“有灵异”。',
        });
      }
    }
  }

  if (episodes.length > 0 && (!Array.isArray(plan.seasonRhythm) || plan.seasonRhythm.length === 0)) {
    issues.push({
      id: 'step0-missing-season-rhythm',
      label: '缺少整季节奏表',
      suggestion: '请重生成分集爽点卡，让系统先规划破题、规则揭露、单元事件、关系反差、大爽点和长线秘密的节奏分布。',
    });
  }

  episodes.forEach((episode) => {
    const openingHook = episode.openingHook?.trim() ?? '';
    const episodeText = JSON.stringify(episode);
    const episodeActionText = [
      episode.coreConflictAction,
      episode.visiblePayoffAction,
      episode.satisfactionBeat,
      episode.cliffhanger,
      episode.nextHookRequirement,
      ...(episode.pressureBeats ?? []),
      ...(episode.visualReuse ?? []),
    ].filter(Boolean).join(' ');
    if (!episode.episodeType) {
      issues.push({
        id: 'episode-missing-type',
        label: `第${episode.episodeNumber}集缺少集型`,
        suggestion: '请标记这一集是破题、规则揭露、单元事件、关系反差、反派试探、大爽点、长线秘密还是收束承接，避免整季节奏变成同一种冲突。',
      });
    }

    if (isBlank(episode.coreConflictAction)) {
      issues.push({
        id: 'episode-missing-core-conflict-action',
        label: `第${episode.episodeNumber}集缺少核心冲突动作`,
        suggestion: '请写清“谁对谁做了什么”，让本集主问题从可拍动作里长出来，不要只写剧情概括。',
      });
    }

    if (isBlank(episode.visiblePayoffAction)) {
      issues.push({
        id: 'episode-missing-visible-payoff-action',
        label: `第${episode.episodeNumber}集缺少可拍爽点动作`,
        suggestion: '请把爽点写成镜头能拍到的动作，例如证据翻面、符纸自燃、令牌亮出、直播间刷屏、对方当众改口。',
      });
    }

    if (isBlank(episode.nextHookRequirement)) {
      issues.push({
        id: 'episode-missing-next-hook-requirement',
        label: `第${episode.episodeNumber}集缺少下一集承接要求`,
        suggestion: '请写清下一集开场必须承接的具体动作、道具、信息或未落地威胁，避免结尾只剩“危机升级”。',
      });
    }

    if (productionAssets.length > 0 && (!Array.isArray(episode.assetPlan) || episode.assetPlan.length === 0)) {
      issues.push({
        id: 'episode-missing-asset-plan',
        label: `第${episode.episodeNumber}集没有绑定素材池`,
        suggestion: '每集至少绑定一个 productionAssets，并让它进入开场、压力、爽点或结尾钩子，不能只围绕常驻人设空转。',
      });
    }

    const hasScifiMechaOpeningHook =
      SCIFI_MECHA_SCRIPT_RE.test(planText)
      && (SCIFI_MECHA_OPENING_HOOK_RE.test(openingHook) || SCIFI_MECHA_OPENING_HOOK_RE.test(episodeActionText));
    const hasStrongOpeningHook = mysticPlan
      ? MYSTIC_OPENING_HOOK_RE.test(openingHook) || MYSTIC_OPENING_HOOK_RE.test(episodeActionText)
      : OPENING_HOOK_RE.test(openingHook)
        || MECHANISM_SATISFACTION_RE.test(openingHook)
        || hasScifiMechaOpeningHook
        || OPENING_HOOK_RE.test(episodeActionText)
        || MECHANISM_SATISFACTION_RE.test(episodeActionText);
    if (isBlank(openingHook)) {
      issues.push({
        id: 'episode-missing-opening-hook',
        label: `第${episode.episodeNumber}集缺少开头钩子`,
        suggestion: '请补一条本集开场能直接拍出来的小事件或具体信息，不需要每集都爆炸开场，但不能留空或只写氛围。',
      });
    } else if (!hasStrongOpeningHook) {
      weakOpeningHookEpisodes.push(episode.episodeNumber);
    }

    if (!Array.isArray(episode.pressureBeats) || episode.pressureBeats.filter((item) => item.trim()).length < 2) {
      issues.push({
        id: 'episode-weak-pressure-beats',
        label: `第${episode.episodeNumber}集压力节拍不足`,
        suggestion: '至少给 2-3 个逐步加码的压力点，让对白和画面有接力，不要一开场就直奔结论。',
      });
    }

    if (hasWeakSatisfactionBeat(episode.satisfactionBeat, {
      abstractRe: ABSTRACT_SATISFACTION_RE,
      concreteRe: CONCRETE_SATISFACTION_RE,
      mechanismRe: MECHANISM_SATISFACTION_RE,
    })) {
      issues.push({
        id: 'episode-weak-satisfaction-beat',
        label: `第${episode.episodeNumber}集爽点不够具体`,
        suggestion: getEpisodeSatisfactionSuggestion(plan, sweetRomance),
      });
    }

    if (isBlank(episode.cliffhanger)) {
      issues.push({
        id: 'episode-missing-cliffhanger',
        label: `第${episode.episodeNumber}集缺少集尾悬念`,
        suggestion: getEpisodeCliffhangerSuggestion(plan, sweetRomance),
      });
    }

    if (episode.episodeNumber > 1 && !hasUsableListItem(episode.continuityIn, CONTINUITY_PLACEHOLDER_RE)) {
      issues.push({
        id: 'episode-missing-continuity-in',
        label: `第${episode.episodeNumber}集缺少连续性入口`,
        suggestion: getEpisodeContinuityInSuggestion(plan, sweetRomance),
      });
    }

    if (!hasUsableListItem(episode.continuityOut, CONTINUITY_PLACEHOLDER_RE)) {
      issues.push({
        id: 'episode-missing-continuity-out',
        label: `第${episode.episodeNumber}集缺少连续性出口`,
        suggestion: getEpisodeContinuityOutSuggestion(plan, sweetRomance),
      });
    }

    if (SOFT_TRANSITION_EPISODE_RE.test(episodeText) && !EPISODE_BURST_RE.test(episodeText)) {
      issues.push({
        id: 'episode-missing-single-episode-burst',
        label: `第${episode.episodeNumber}集缺少单集爆点`,
        suggestion: '短篇季不能有过渡集、铺垫集或纯承接集。请给这一集补上可截图的前 3 秒爆图、中段反转/反咬、爽点落地或集尾强钩子，至少三项成立。',
      });
    }

    if (mysticPlan) {
      const mysticOpeningText = [
        openingHook,
        episode.coreConflictAction,
        ...(episode.pressureBeats ?? []),
      ].filter(Boolean).join(' ');
      const mysticPayoffText = [
        episode.visiblePayoffAction,
        episode.satisfactionBeat,
      ].filter(Boolean).join(' ');
      const mysticRelayText = [
        episode.cliffhanger,
        episode.nextHookRequirement,
        ...(episode.continuityOut ?? []),
      ].filter(Boolean).join(' ');
      const mysticLiveReactionText = [
        openingHook,
        episode.coreConflictAction,
        episode.visiblePayoffAction,
        episode.satisfactionBeat,
        episode.cliffhanger,
        episode.nextHookRequirement,
        ...(episode.pressureBeats ?? []),
        ...(episode.visualReuse ?? []),
        ...(episode.continuityOut ?? []),
      ].filter(Boolean).join(' ');

      if (!MYSTIC_VISIBLE_RE.test(mysticOpeningText) && !MYSTIC_THREAT_RE.test(mysticOpeningText)) {
        issues.push({
          id: 'episode-mystic-missing-opening-abnormality',
          label: `第${episode.episodeNumber}集缺少 0-3 秒异常画面`,
          suggestion: '玄学抓鬼每集开场要先给镜头能拍到的怪事或证验动作，例如罗盘乱转、符纸自燃、镜中鬼影、僵尸压门、直播弹幕刷屏或龙虎山禁忌物露出。',
        });
      }

      if (!MYSTIC_ASSET_PROOF_RE.test(mysticPayoffText) && !MYSTIC_VISIBLE_RE.test(mysticPayoffText)) {
        issues.push({
          id: 'episode-mystic-missing-proof-payoff',
          label: `第${episode.episodeNumber}集缺少道法/法器兑现爽点`,
          suggestion: '本集爽点必须落到可拍的玄学验证：天师出手、雷法落地、符纸起效、罗盘指向真物、鬼怪显形或直播镜头拍到应验结果。',
        });
      }

      if (!MYSTIC_IDENTITY_RE.test(episodeActionText)) {
        issues.push({
          id: 'episode-mystic-missing-taoist-action',
          label: `第${episode.episodeNumber}集缺少哥哥/天师出手规则`,
          suggestion: '请写清黑袍天师哥哥什么时候出手、用什么道法/法器破局、他为什么能镇住现场，不要让灵异只靠旁白解释。',
        });
      }

      if (!MYSTIC_LIVE_STREAM_RE.test(mysticLiveReactionText)) {
        issues.push({
          id: 'episode-mystic-missing-live-view',
          label: `第${episode.episodeNumber}集缺少主播/直播间反应`,
          suggestion: '天师直播题材每集都要让妹妹、镜头或弹幕承担观众入口，写出从不信、破防到刷屏炸裂的可拍反应。',
        });
      }

      if (!MYSTIC_VISIBLE_RE.test(mysticRelayText) && !MYSTIC_THREAT_RE.test(mysticRelayText)) {
        issues.push({
          id: 'episode-mystic-missing-next-relay-object',
          label: `第${episode.episodeNumber}集缺少下一集具体承接物`,
          suggestion: '结尾和 nextHookRequirement 要留下下一集能直接开拍的承接物，例如符纸背面显字、罗盘指向新房间、直播连线求救、镜中异影或未处理的鬼怪禁忌。',
        });
      }
    }

    if (
      needsSickSweetLoop
      && episode.episodeNumber <= 3
      && (!SWEET_CORE_LOOP_RE.test(episodeText) || (SWEET_BUSINESS_DRIFT_RE.test(episodeText) && !SWEET_STRONG_CORE_LOOP_RE.test(episodeText)))
    ) {
      issues.push({
        id: 'episode-sweet-core-loop-drift',
        label: `第${episode.episodeNumber}集偏离装病甜宠循环`,
        suggestion: '前 3 集要围绕装病破绽、抓包试探、反咬照顾、药膳/点心投喂、当众护短或假戏真甜推进；铺面、宴席、采买和账本只能当压力辅料。',
      });
    }
  });

  if (weakOpeningHookEpisodes.length >= Math.max(2, Math.ceil(episodes.length * 0.45))) {
    issues.push({
      id: 'episode-soft-opening-hook-batch',
      label: `第${weakOpeningHookEpisodes.slice(0, 4).join('、')}${weakOpeningHookEpisodes.length > 4 ? '等' : ''}集开场钩子可再加强`,
      suggestion: '部分集的开场已经有内容，但事件感偏弱。建议优先把开场改成“人物动作 + 可见道具/证据 + 当场压力”的小事件；不用每集都追求强爆点。',
    });
  }

  for (let index = 2; index < episodes.length; index += 1) {
    const a = episodes[index - 2];
    const b = episodes[index - 1];
    const c = episodes[index];
    if (a.satisfactionType === b.satisfactionType && b.satisfactionType === c.satisfactionType) {
      issues.push({
        id: 'episode-repeated-satisfaction-type',
        label: `第${a.episodeNumber}-${c.episodeNumber}集爽点类型重复`,
        suggestion: getRepeatedSatisfactionSuggestion(plan, sweetRomance),
      });
      break;
    }
  }

  for (let index = 2; index < episodes.length; index += 1) {
    const assetKeys = episodes.slice(index - 2, index + 1)
      .map((episode) => (episode.assetPlan ?? []).join('|'))
      .filter(Boolean);
    if (assetKeys.length === 3 && assetKeys.every((key) => key === assetKeys[0])) {
      issues.push({
        id: mysticPlan ? 'episode-mystic-repeated-asset-plan' : 'episode-repeated-asset-plan',
        label: mysticPlan
          ? `第${episodes[index - 2].episodeNumber}-${episodes[index].episodeNumber}集连续复用同一鬼怪/法器素材`
          : `第${episodes[index - 2].episodeNumber}-${episodes[index].episodeNumber}集素材使用重复`,
        suggestion: mysticPlan
          ? '连续三集不要只用同一个鬼怪、禁忌或法器。请轮换僵尸、女鬼、凶宅禁忌、符纸罗盘应验、直播破防和更深因果，让整季有层层升级。'
          : '连续三集不要只使用同一个单元素材。请轮换单元对手、事件、证据、关系事件或规则机制，让整季有扩展感。',
      });
      break;
    }
  }

  return issues;
}

export function findEpisodeScriptQualityIssues(
  scriptText: string,
  context?: EpisodeScriptQualityContext,
): SeriesQualityIssue[] {
  const issues: SeriesQualityIssue[] = [];
  const text = scriptText.trim();
  const sweetRomance = isSweetRomanceScriptForContext(text, context);
  const mysticScript = isMysticScriptForContext(text, context);
  if (!text) {
    return [{
      id: 'script-empty',
      label: '单集剧本为空',
      suggestion: '先生成或粘贴本集分镜剧本，再进入 Step1 分析。',
    }];
  }

  if (SCRIPT_BACKSTAGE_SECTION_RE.test(text)) {
    issues.push({
      id: 'script-backstage-section-leak',
      label: '生成稿含后台说明',
      suggestion: 'Step0 单集稿只保留分镜标题、时间轴画面、对白和接下一镜；删除“分镜职责与边界、角色与连续性、人设锁定、道具状态、自检”等后台块再送入 Step1。',
    });
  }

  if (NAMED_EXTRA_RE.test(text)) {
    issues.push({
      id: 'script-named-extras',
      label: '群演被写成独立角色',
      suggestion: '把秀女甲乙、宫人甲乙、侍卫甲乙等合并为“秀女群 / 宫人群 / 侍卫”，避免 Step1 抽出过多无用角色资产。',
    });
  }

  if (TEMPORARY_NAMED_SERVANT_RE.test(text)) {
    issues.push({
      id: 'script-temporary-named-servant',
      label: '临时小厮被命名',
      suggestion: '只端药、传话、关门、收托盘的小厮或宫人不要临时起名，例如阿福、小顺、小德子。除非系列圣经已列为常驻角色，否则写成“小厮/侍从/宫人群/丫鬟群”，避免 Step1 抽出无用角色资产。',
    });
  }

  if (PALACE_POWER_PROP_RE.test(text) && !PALACE_POWER_BOUNDARY_RE.test(text)) {
    issues.push({
      id: 'script-unclear-palace-power-rule',
      label: '宫廷权力边界不清',
      suggestion: '出现圣旨、懿旨、白绫、冷宫、宫规等道具时，要写清谁只能押、谁越权动刑、谁要担责，并把规矩写成角色能说出口的人话。',
    });
  }

  if (NEXT_RELAY_POSITION_CONFLICT_RE.test(text)) {
    issues.push({
      id: 'script-next-relay-position-conflict',
      label: '接下一镜人物位置矛盾',
      suggestion: '萧砚还在院中/石桌边喝药时，不要写“屋内/门后传来疑似他练剑的破风声”。下一镜钩子要和当前站位相容，可改成袖口露出剑茧、碗底碰出剑穗声，或远处剑声让他先于众人抬眼。',
    });
  }

  const palacePowerJargonCount = Array.from(text.matchAll(PALACE_POWER_JARGON_RE)).length;
  if (palacePowerJargonCount >= 4) {
    issues.push({
      id: 'script-palace-power-jargon',
      label: '宫廷规矩台词过硬',
      suggestion: '规矩爽点要改成人话。把“命审、命押、命罚、命杀”这类术语链改成当场追责：谁动的手、谁要回话、谁别想躲。',
    });
  }

  if (PALACE_BUREAUCRATIC_DIALOGUE_RE.test(text)) {
    issues.push({
      id: 'script-palace-bureaucratic-dialogue',
      label: '对白存在宫廷公文腔',
      suggestion: '观众要一秒听懂。把“抗选冲殿、冲殿犯上、候死、禁物、这等物件、内廷封存”等硬词改成俗话：闯了选秀殿、关着等发落、不能带的东西、这东西、宫里收走。',
    });
  }

  if (PSEUDO_COOL_SHORT_LINE_RE.test(text)) {
    issues.push({
      id: 'script-pseudo-cool-short-line',
      label: '存在伪短句/标语式心声',
      suggestion: '短不等于有性格。别写模型味断句，要让台词听得出疼、怕、恨、急或讽刺，并且有明确对象和后果。',
    });
  }

  if (COMMA_TOUGH_GUY_FRAGMENT_RE.test(text)) {
    issues.push({
      id: 'script-comma-tough-guy-fragment',
      label: '存在逗号断句装狠',
      suggestion: '不要用“关我，可以”“搜，可以”这类硬切短句装性格。改成完整顶嘴：先承认动作，再卡住对方的手和后果。',
    });
  }

  if (FLAT_FUNCTIONAL_DIALOGUE_RE.test(text)) {
    issues.push({
      id: 'script-flat-functional-dialogue',
      label: '关键对白只有功能没有情绪',
      suggestion: '关键句要先有情绪来源，再完成剧情功能。别写平台词、谜语词和抽象账本词；让台词听得出疼、怕、急、装可怜、心虚或试探。',
    });
  }

  if (SLOGAN_DIALOGUE_RE.test(text)) {
    issues.push({
      id: 'script-slogan-dialogue',
      label: '对白像短剧标语',
      suggestion: '不要堆“复印件也配判我、我的人谁准你碰、针没拔命不算你的、谁批准你正常了”这类万能金句。把金句改成角色被当场刺到后的反应：先有羞、怒、怕、心虚、吃醋、忍怒或怨气，再绑定眼前道具和动作。',
    });
  }

  if (COMPRESSED_FUNCTION_DIALOGUE_RE.test(text)) {
    issues.push({
      id: 'script-compressed-functional-dialogue',
      label: '少台词被压成机械功能句',
      suggestion: '少对白不是把人物压成剧情按钮。把“我嘴严、银子堵、墙是证、以后你来守我、亲喂才喝”这类结论句改成当场反应：姜梨先气笑、护食盒、怕被困住又不肯认输；萧砚先心虚遮破绽、嘴硬挑剔、借咳把她留近。',
    });
  }

  if (isSweetRomanceScript(text) && GENERIC_SWEET_ROMANCE_DIALOGUE_RE.test(text)) {
    issues.push({
      id: 'script-generic-sweet-romance-dialogue',
      label: '甜宠对白缺少角色语言指纹',
      suggestion: '这些句子像任何甜宠剧都能用。让姜梨从点心铺小掌柜的材料里说话：食盒、火候、甜咸、赔本、手艺、铺面、客人、忌口；让萧砚从装病王爷的小毛病里说话：咳、药苦、挑剔、怕露馅、装虚、故意要照顾。',
    });
  }

  if (ELLIPSIS_COMPRESSION_DIALOGUE_RE.test(text)) {
    issues.push({
      id: 'script-ellipsis-compression-dialogue',
      label: '对白被省略号压成机械短句',
      suggestion: '不要为了压字数写“病成这样……还翻墙？”“王妃进门……先学会闭眼。”这种不像人说话的省略号短句。控制每镜对白句数即可，单句可以自然到 12-24 字；把省略号改成正常顶嘴、气笑、心虚打岔或被动作打断。',
    });
  }

  if (isSweetRomanceScript(text) && OVERCRAFTED_SWEET_LINE_RE.test(text)) {
    issues.push({
      id: 'script-overcrafted-sweet-line',
      label: '甜宠对白有编剧金句感',
      suggestion: '少写太工整的俏皮句和对仗句，例如“热气最足的时候谈凉心话”“嫌药苦还是嫌心软”“炖进药锅”。改成当场嘴瓢、心虚岔话、被噎住后的找补，让角色像在现场反应。',
    });
  }

  if (isSweetRomanceScript(text) && countMatches(text, SWEET_MATERIAL_WORD_RE) >= 12) {
    issues.push({
      id: 'script-repeated-sweet-material-metaphor',
      label: '甜宠语言材料重复过密',
      suggestion: '“热/凉/苦/火候”方向是对的，但不要押成新模板。一集里轮换到食盒盖、客人忌口、铺子赔本、手艺被糟蹋、药碗洒出、咳帕藏湿等具体动作。',
    });
  }

  const dialogueTextsForLoad = extractDialogueTexts(text);
  const longDialogueLines = findLongDialogueLines(dialogueTextsForLoad);
  if (longDialogueLines.length > 0) {
    issues.push({
      id: 'script-dialogue-too-long-for-speed',
      label: '台词超出 1.2x 语速预算',
      suggestion: `${formatDialogueLineSample(longDialogueLines)}超过 ${DIALOGUE_LINE_SPEAKABLE_CHAR_LIMIT} 个可念字，1.2x 下容易念不完。单句优先 ${DIALOGUE_LINE_TARGET_CHAR_LIMIT} 字以内，24 字内最稳；25-28 字如果自然顺口可以保留，超过 ${DIALOGUE_LINE_SPEAKABLE_CHAR_LIMIT} 字或一口气塞两层意思再拆。`,
    });
  }

  if (countOverloadedDialogue(dialogueTextsForLoad, OVERLOADED_DIALOGUE_SPLIT_RE) >= 2) {
    issues.push({
      id: 'script-dialogue-overloaded-line',
      label: '单句台词信息太满',
      suggestion: '一口气只打一层意思。自然句可以略超预算，但同时塞进吐槽、解释、开价、后果、比喻的句子，要拆成“短口语 -> 动作反应 -> 下一段再接”，让演员有气口。',
    });
  }

  if (isSweetRomanceScript(text) && hasDenseSweetOccupationVoice(dialogueTextsForLoad, SWEET_OCCUPATION_WORD_RE)) {
    issues.push({
      id: 'script-sweet-occupation-voice-overpacked',
      label: '甜宠职业语料压得过满',
      suggestion: '点心铺/装病语料是角色指纹，不是每句都要押的包袱。同一镜连续 2 句后，要换成怕被锁院、心虚遮掩、被靠近逼退、被噎住找补或嘴瓢。',
    });
  }

  if (countDialogueLines(text) >= 3 && countMatches(text, PERFORMANCE_BEAT_RE) < 3) {
    issues.push({
      id: 'script-dialogue-missing-performance-beats',
      label: '对白缺少表演气口',
      suggestion: '每句对白要有“说前动作 -> 台词 -> 说后反应”。把气口写进画面：吸气、停手、抬眼、避开、压住、咳声卡住、指尖攥紧、食盒盖被按住、药碗悬住、对方被噎或退半步。',
    });
  }

  if (countDialogueLines(text) >= 3 && countHollowPerformanceActions(text, HOLLOW_PERFORMANCE_ACTION_RE, STATE_LINKED_ACTION_RE) >= 2) {
    issues.push({
      id: 'script-hollow-performance-actions',
      label: '表演节拍是空动作',
      suggestion: '不要用“他回答她、她继续追问、两人对视、气氛一静”冒充气口。动作要改变台词含义：写清食盒/药碗/咳帕/剑影/袖口/门闩怎么停住、被藏、被抢、被攥紧，谁被哪句话噎住。',
    });
  }

  if (TEMPLATE_PLOT_BLEED_RE.test(text)) {
    issues.push({
      id: 'script-template-plot-bleed',
      label: '疑似混入模板道具套路',
      suggestion: '不要把常见古偶道具一股脑塞进同一集。本集只保留系列圣经、本集卡、recurringProps、visualReuse、continuityIn/out 已给出的关键道具和地点。',
    });
  }

  const boundaryLeaks = findStoryBoundaryLeaks(text);
  if (boundaryLeaks.length > 0) {
    issues.push({
      id: 'script-story-boundary-leak',
      label: '分镜边界自相矛盾',
      suggestion: `“本镜不提前”已经禁止引出的内容又在正文出现：${boundaryLeaks.join('、')}。要么删除该内容，要么把它放回分集卡的后续钩子里，不能两边同时写。`,
    });
  }

  const storyboardBlocks = extractStoryboardBlocks(text);
  const segmentDialogueBudgetIssues = findSegmentDialogueBudgetIssues(storyboardBlocks);
  if (segmentDialogueBudgetIssues.length > 0) {
    issues.push({
      id: 'script-dialogue-segment-over-budget',
      label: '时间段台词念不完',
      suggestion: segmentDialogueBudgetIssues
        .slice(0, 3)
        .map((item) => `第${item.storyboardIndex}镜 ${item.timeLabel} 台词约${item.chars}字，1.2x 参考预算约${item.budget}字，自然余量约${item.allowed}字`)
        .join('；')
        + '。只处理真正念不完或信息过载的句子，先删解释和重复群嘲，不要把顺口人话硬压成碎片。',
    });
  }

  const storyboardDialogueBudgetIssues = findStoryboardDialogueBudgetIssues(storyboardBlocks);
  if (storyboardDialogueBudgetIssues.length > 0) {
    issues.push({
      id: 'script-dialogue-storyboard-over-budget',
      label: '单镜台词总量过载',
      suggestion: `第${storyboardDialogueBudgetIssues.slice(0, 4).map((item) => `${item.storyboardIndex}镜约${item.chars}字`).join('、')}超过 15 秒短剧对白预算。每镜对白总量通常 60-72 字，高压嘴仗可到 ${STORYBOARD_DIALOGUE_CHAR_BUDGET} 字；优先删重复群嘲、规则说明和作者总结，保留自然接话。`,
    });
  }

  const hardTimeJumpIndexes = storyboardBlocks
    .map((block, index) => ({ index: index + 1, hasJump: HARD_TIME_JUMP_RE.test(block) }))
    .filter((block) => block.hasJump)
    .map((block) => block.index);
  if (hardTimeJumpIndexes.length > 0) {
    issues.push({
      id: 'script-hard-time-jump-in-storyboard',
      label: '单镜内硬跳时间或空间',
      suggestion: `第${hardTimeJumpIndexes.join('、')}镜疑似用“夜色转深/夜色一转/转眼夜里”在 15 秒内硬跳时间或从院中跳到屋内门后。需要转夜或换空间时另起下一镜。`,
    });
  }

  const cutTransitionIndexes = storyboardBlocks
    .map((block, index) => ({ index: index + 1, hasCut: CUT_TRANSITION_RE.test(block) }))
    .filter((block) => block.hasCut)
    .map((block) => block.index);
  if (cutTransitionIndexes.length > 0) {
    issues.push({
      id: 'script-cut-transition-in-storyboard',
      label: '单镜用切镜跳过过程',
      suggestion: `第${cutTransitionIndexes.join('、')}镜疑似用“镜头一切/画面切到/夜色一转”在 15 秒里跳过时间或空间。分镜正文要保持连续可拍动作；换时间、换空间或重新热药，应另起下一镜或只放到“接下一镜”。`,
    });
  }

  const skippedActionIndexes = storyboardBlocks
    .map((block, index) => ({ index: index + 1, skipped: SKIPPED_KEY_ACTION_RE.test(block) }))
    .filter((block) => block.skipped)
    .map((block) => block.index);
  if (skippedActionIndexes.length > 0) {
    issues.push({
      id: 'script-skips-key-action-result-line',
      label: '关键动作被结果句跳过',
      suggestion: `第${skippedActionIndexes.join('、')}镜疑似用“药碗空了些/已经喂完/夜里端药回来”跳过喂药、接碗、锁门、走到门前等可拍过程。关键动作要么拍出来，要么放到接下一镜。`,
    });
  }

  const unearnedDoorHookIndexes = storyboardBlocks
    .map((block, index) => ({ index: index + 1, unearned: UNEARNED_DOOR_HOOK_RE.test(block) }))
    .filter((block) => block.unearned)
    .map((block) => block.index);
  if (unearnedDoorHookIndexes.length > 0) {
    issues.push({
      id: 'script-unearned-door-hook',
      label: '门口钩子没有过程支撑',
      suggestion: `第${unearnedDoorHookIndexes.join('、')}镜疑似刚完成喂药或接碗，就跳到屋门、门闩、推门、练剑声。结尾要停在当前动作的反应上；房门、门闩和练剑声留到下一镜正文。`,
    });
  }

  const propTeleportIndexes = storyboardBlocks
    .map((block, index) => ({ index: index + 1, teleported: PROP_TELEPORT_RE.test(block) }))
    .filter((block) => block.teleported)
    .map((block) => block.index);
  if (propTeleportIndexes.length > 0) {
    issues.push({
      id: 'script-prop-teleport',
      label: '关键道具瞬移',
      suggestion: `第${propTeleportIndexes.join('、')}镜疑似用“不知何时/已被人/已经挂着”给关键道具换位置。咳帕、药碗、药膳单、食盒、钥匙移动时，必须拍出谁拿走、谁挂上、谁放下。`,
    });
  }

  const duplicatedPropLocations = findDuplicatedPropLocationIssues(
    storyboardBlocks.length > 0 ? storyboardBlocks : [text],
    PROP_DUPLICATED_LOCATION_RULES,
  );
  if (duplicatedPropLocations.length > 0) {
    issues.push({
      id: 'script-prop-duplicated-location',
      label: '关键道具位置自相矛盾',
      suggestion: `第${duplicatedPropLocations.map((item) => item.index).join('、')}镜疑似让 ${Array.from(new Set(duplicatedPropLocations.flatMap((item) => item.props))).join('、')} 同时出现在两个位置。咳帕、药碗、药膳单、食盒、钥匙同一时刻只能在一个位置；如果换位置，必须写出转移动作。`,
    });
  }

  const nextRelayLines = extractNextRelayLines(text);
  const overloadedNextRelays = nextRelayLines.filter((line) => countNextRelayBeatLoad(line, NEXT_RELAY_BEAT_PATTERNS) >= 4);
  if (overloadedNextRelays.length > 0) {
    issues.push({
      id: 'script-next-relay-too-loaded',
      label: '接下一镜写成剧情摘要',
      suggestion: '“接下一镜”只能写 1 个直接承接动作或 1 句未落完的话，不能同时写夜里、重新热药、道具换位、推门、练剑声等多件事。把这些拆到下一镜正文。',
    });
  }

  const teleportedNextRelayProps = nextRelayLines.filter((line) => NEXT_RELAY_PROP_TELEPORT_RE.test(line));
  if (teleportedNextRelayProps.length > 0) {
    issues.push({
      id: 'script-next-relay-prop-teleport',
      label: '接下一镜偷换道具状态',
      suggestion: '上一镜还在手里的咳帕、药碗、药膳单、食盒或钥匙，不能在“接下一镜”里突然变成已挂到门闩、已放到桌上或到了别人手里。必须在正文或下一镜开头拍出谁移动。',
    });
  }

  const nextRelaysLeavingFeedingScene = nextRelayLines.filter((line) => NEXT_RELAY_LEAVES_FEEDING_SCENE_RE.test(line));
  if (nextRelaysLeavingFeedingScene.length > 0) {
    issues.push({
      id: 'script-next-relay-leaves-feeding-scene',
      label: '接下一镜离开喂药现场',
      suggestion: '喂药小胜刚落地时，不要在“接下一镜”里让姜梨端着空勺/空碗往房门、屋里或门口走。把钩子留在当前可拍细节里：收勺、药痕、袖口、虎口、剑茧、咳帕或碗沿。',
    });
  }

  const overloadedStoryboardIndexes = findOverloadedStoryboardIndexes(storyboardBlocks, STORYBOARD_BEAT_LOAD_PATTERNS);
  if (overloadedStoryboardIndexes.length > 0) {
    issues.push({
      id: 'script-storyboard-too-many-beats',
      label: '单镜剧情节拍过载',
      suggestion: `第${overloadedStoryboardIndexes.join('、')}镜疑似把新角色进场、道具递入、关系判定、锁院/转场和下集钩子塞在一起。15 秒只完成 1 个主转折，最多 2 个辅助节拍；其余改成接下一镜。`,
    });
  }

  const denseBlocks = storyboardBlocks
    .map((block, index) => ({
      index: index + 1,
      count: countDialogueLines(block),
    }))
    .filter((block) => block.count >= 6);
  if (denseBlocks.length > 0) {
    issues.push({
      id: 'script-dialogue-too-dense',
      label: '单镜对白密度偏高',
      suggestion: `第${denseBlocks.map((block) => block.index).join('、')}镜对白达到或超过建议密度。15 秒通常保留 3-5 句，高压嘴仗最多 6 句；把重复群嘲、普通反应和解释腔改成眼神、停顿、手上动作或道具特写，让性格情绪有呼吸。`,
    });
  }

  if (MECHANICAL_AI_SUMMARY_RE.test(text)) {
    issues.push({
      id: 'script-mechanical-ai-summary',
      label: '对白存在机械 AI 总结腔',
      suggestion: '把“我决定/我明白/我必须/从现在开始”改成具体动作、证据、威胁、反问或下一步选择。',
    });
  }

  if (STANDALONE_OS_RE.test(text)) {
    issues.push({
      id: 'script-standalone-os-lines',
      label: '存在独立字幕/OS行',
      suggestion: '不要单独输出“字幕/OS、内心OS、OS、旁白”。确实需要心声时，写成“对白：角色名（心声）：短句”。',
    });
  }

  const dialogueTexts = dialogueTextsForLoad;
  const scifiMechaScript = SCIFI_MECHA_SCRIPT_RE.test(text);
  if (dialogueTexts.length >= 8) {
    const activeCount = dialogueTexts.filter((line) => (
      sweetRomance
        ? (SWEET_DIALOGUE_RE.test(line) || DIALOGUE_ATTACK_RE.test(line))
        : (
          DIALOGUE_ATTACK_RE.test(line) ||
          MECHANISM_ACTIVE_DIALOGUE_RE.test(line) ||
          (scifiMechaScript && SCIFI_MECHA_DIALOGUE_PRESSURE_RE.test(line)) ||
          (mysticScript && MYSTIC_DIALOGUE_PRESSURE_RE.test(line))
        )
    )).length;
    const softFunctionCount = dialogueTexts.filter((line) => SOFT_FUNCTIONAL_DIALOGUE_RE.test(line)).length;
    const storyboardCount = Math.max(1, countMatches(text, /^##\s*分镜/gm));
    const minimumScenePressureBeats = Math.max(3, Math.ceil(storyboardCount * (sweetRomance ? 0.65 : scifiMechaScript ? 0.7 : 0.8)));
    const hasEnoughScenePressure = activeCount >= minimumScenePressureBeats;
    const minActiveRatio = sweetRomance ? 0.18 : MODERN_REVENGE_RE.test(text) ? 0.28 : MALE_POWER_RE.test(text) ? 0.32 : mysticScript ? 0.22 : scifiMechaScript ? 0.16 : 0.18;
    const softFunctionLimit = scifiMechaScript || mysticScript ? 6 : 4;
    if ((activeCount / dialogueTexts.length < minActiveRatio && !hasEnoughScenePressure) || softFunctionCount >= softFunctionLimit) {
      issues.push({
        id: 'script-weak-shortdrama-dialogue',
        label: sweetRomance ? '甜宠对白推进不足' : mysticScript ? '玄学对白压力不足' : '短剧对白攻击性不足',
        suggestion: sweetRomance
          ? '甜宠对白不能只是寒暄。每个主要交锋都要有挑剔、试吃、讨价还价、护短、吃醋误读或反撩；女主要守边界和手艺，男主要嘴硬但行动偏爱。'
          : mysticScript
            ? '玄学直播对白要有禁忌命令、嘴硬破防、镜头争夺和现场求证，例如“退后”“别喂它”“关播”“这不是特效”，不能只说明发生了灵异。'
            : '对白不能只是推进流程。每个主要交锋都要有羞辱、威胁、打断、反问、交易或逼选择；配角台词要更坏，女主台词要反咬和定价。',
      });
    }
  }

  const emotionlessFunctionalCount = countEmotionlessFunctionalDialogue(dialogueTexts, ABSTRACT_FUNCTION_WORD_RE, EMOTION_SOURCE_RE);
  const emotionlessFunctionalLimit = scifiMechaScript || mysticScript ? 4 : 2;
  if (emotionlessFunctionalCount >= emotionlessFunctionalLimit) {
    issues.push({
      id: 'script-dialogue-missing-character-emotion',
      label: '台词缺少人物情绪',
      suggestion: scifiMechaScript || mysticScript
        ? '机制词可以保留，但要落在现场动作上。连续多句只讲权限、判定、规则或记录时，要改成角色能演出来的抢、压、躲、急、心虚、反咬、扣物件或逼选择。'
        : '功能句要先有当下情绪，再落到眼前动作或物件上。把“规矩、价钱、活路、背锅、把柄、条件、人情、主动权、股权、合约、身份、规则”等抽象词，改成角色能演出来的怕、急、心虚、试探、嘴硬、忍怒、护短、吃醋或怨气。',
    });
  }

  const osTexts = extractOsTexts(text);
  if (osTexts.filter((line) => AUTHOR_COMMENTARY_OS_RE.test(line)).length >= 3) {
    issues.push({
      id: 'script-author-commentary-os',
      label: '字幕/OS 像作者点评',
      suggestion: '字幕/OS 只能补短刺句或关键信息，不要替观众总结“话很准、刀很狠、她把血说成喜气”等爽点。',
    });
  }

  const firstStoryboard = text.split(/(?=^##\s*分镜\s*0*2\b)/m)[0] ?? text.slice(0, 500);
  const hasScriptOpeningHook = OPENING_HOOK_RE.test(firstStoryboard)
    || (scifiMechaScript && SCIFI_MECHA_OPENING_HOOK_RE.test(firstStoryboard));
  if (!hasScriptOpeningHook) {
    issues.push({
      id: 'script-missing-opening-hook',
      label: '第一镜缺少强钩子',
      suggestion: sweetRomance
        ? '第一镜要直接出现甜宠可拍钩子，例如点心被退又被吃、小厨房归属被抢、试吃忌口暴露、赌约落下或公开偏爱，不要从平静走路和回忆开场。'
      : '第一镜要直接出现冲突、证据、羞辱、误判、倒计时或危险动作，不要从平静走路和回忆开场。',
    });
  }

  if (mysticScript) {
    if (!MYSTIC_SCRIPT_OPENING_RE.test(firstStoryboard) && !MYSTIC_THREAT_RE.test(firstStoryboard)) {
      issues.push({
        id: 'script-mystic-missing-opening-abnormality',
        label: '玄学稿第一镜缺少 0-3 秒异常画面',
        suggestion: '第一镜要先拍出异常或证验：罗盘乱转、符纸自燃、镜中鬼影、僵尸压门、雷光劈落、直播间刷屏或妹妹镜头抖住，不要从解释背景开场。',
      });
    }

    if (!MYSTIC_SCRIPT_TAOIST_ACTION_RE.test(text)) {
      issues.push({
        id: 'script-mystic-missing-taoist-action',
        label: '玄学稿缺少哥哥出手规则',
        suggestion: '写清黑袍天师哥哥怎么出手：用符、罗盘、雷法、敕令或法器破局，并让现场看见结果；不要只说“他很厉害”。',
      });
    }

    if (!MYSTIC_SCRIPT_LIVE_REACTION_RE.test(text)) {
      issues.push({
        id: 'script-mystic-missing-live-reaction',
        label: '玄学稿缺少妹妹/直播间反应',
        suggestion: '每集要让妹妹、镜头、弹幕或观众承担见证入口，写出从不信到破防刷屏的反应，不能只用旁白说明灵异是真的。',
      });
    }

    if (!MYSTIC_VISIBLE_RE.test(text)) {
      issues.push({
        id: 'script-mystic-missing-visible-proof',
        label: '玄学稿缺少鬼怪或法器素材落地',
        suggestion: '请让鬼怪、符纸、罗盘、香灰、镜子、雷法、法器或直播画面至少一个真实落地并改变现场状态，避免整集只有解释性旁白。',
      });
    }
  }

  if (!/##\s*分镜\s*0*1/.test(text)) {
    issues.push({
      id: 'script-missing-storyboard-heading',
      label: '缺少标准分镜标题',
      suggestion: '请使用“## 分镜 01｜**标题**（总时长：15 秒）”这类 Step1 可解析格式。',
    });
  }

  const endingRelayRe = sweetRomance ? SWEET_ENDING_RE : /cliffhanger|悬念|接下一镜|下一集|门外|皇印|证据|未说完|进门|响起|露出/i;
  const weakNextRelay = extractNextRelayLines(text).some((line) => SOFT_TRANSITION_EPISODE_RE.test(line));
  if (!endingRelayRe.test(text.slice(-700)) || weakNextRelay) {
    issues.push({
      id: 'script-weak-ending-relay',
      label: '结尾接力不足',
      suggestion: sweetRomance
        ? '结尾要留下可直接接下一镜的甜宠问题，例如新点心单、试吃邀约、铺面钥匙、账本异常、未说完的偏爱或吃醋误读。'
        : '结尾要留下未解释证据、未进门人物、未落地威胁或下一集更大的问题。',
    });
  }

  return issues;
}

const BLOCKING_EPISODE_SCRIPT_ISSUE_IDS = new Set([
  'script-empty',
  'script-missing-storyboard-heading',
  'script-backstage-section-leak',
  'script-missing-opening-hook',
  'script-weak-shortdrama-dialogue',
  'script-dialogue-too-long-for-speed',
  'script-dialogue-segment-over-budget',
  'script-dialogue-storyboard-over-budget',
  'script-dialogue-missing-performance-beats',
  'script-flat-functional-dialogue',
  'script-slogan-dialogue',
  'script-compressed-functional-dialogue',
  'script-pseudo-cool-short-line',
  'script-comma-tough-guy-fragment',
  'script-hard-time-jump-in-storyboard',
  'script-cut-transition-in-storyboard',
  'script-skips-key-action-result-line',
  'script-unearned-door-hook',
  'script-prop-teleport',
  'script-prop-duplicated-location',
  'script-next-relay-too-loaded',
  'script-next-relay-prop-teleport',
  'script-next-relay-position-conflict',
  'script-next-relay-leaves-feeding-scene',
  'script-template-plot-bleed',
  'script-story-boundary-leak',
  'script-weak-ending-relay',
]);

export function getBlockingEpisodeScriptIssues(
  scriptText: string,
  context?: EpisodeScriptQualityContext,
): SeriesQualityIssue[] {
  return findEpisodeScriptQualityIssues(scriptText, context).filter((issue) =>
    BLOCKING_EPISODE_SCRIPT_ISSUE_IDS.has(issue.id) || issue.id.startsWith('script-mystic-'),
  );
}

export function findSeriesRuntimeQualityIssues(
  runtime: SeriesRuntimeState | undefined,
  currentEpisodeNumber = 1,
): SeriesQualityIssue[] {
  if (!runtime) return [];
  const issues: SeriesQualityIssue[] = [];
  const staleHooks = runtime.hookLedger.filter((hook) => (
    hook.status !== 'resolved'
    && hook.status !== 'dropped'
    && currentEpisodeNumber - hook.lastAdvancedEpisode > 3
  ));
  staleHooks.slice(0, 3).forEach((hook) => {
    issues.push({
      id: 'runtime-stale-hook',
      label: `${hook.hookId} 超过 3 集未推进`,
      suggestion: `下一轮集卡或剧本要推进、回收或明确搁置这个伏笔：${hook.description || hook.expectedPayoff || '未写明伏笔内容'}。`,
    });
  });

  const propOwners = new Map<string, Set<string>>();
  runtime.propLedger.forEach((prop) => {
    const name = prop.name.trim();
    const owner = prop.owner.trim();
    if (!name || !owner) return;
    if (!propOwners.has(name)) propOwners.set(name, new Set());
    propOwners.get(name)?.add(owner);
  });
  Array.from(propOwners.entries())
    .filter(([, owners]) => owners.size > 1)
    .slice(0, 3)
    .forEach(([name, owners]) => {
      issues.push({
        id: 'runtime-prop-owner-conflict',
        label: `${name} 的归属可能冲突`,
        suggestion: `当前记忆里同时出现 ${Array.from(owners).join('、')} 持有。下集出稿前先锁定这个道具/证据在谁手里。`,
      });
    });

  runtime.characterContinuity
    .filter((character) => (
      character.voiceRisk.trim()
      || character.knownInfo.some((item) => /不该知道|越界|未来|未见|没见过/.test(item))
    ))
    .slice(0, 3)
    .forEach((character) => {
      issues.push({
        id: 'runtime-character-boundary-risk',
        label: `${character.name} 有信息或口吻越界风险`,
        suggestion: character.voiceRisk || '检查这个角色下一集是否知道了自己没有亲眼见过、没有被告知的信息。',
      });
    });

  return issues;
}

export function formatSeriesQualityIssues(issues: SeriesQualityIssue[]): string {
  if (issues.length === 0) return '';
  const metadataIssueIds = new Set([
    'episode-missing-type',
    'episode-missing-core-conflict-action',
    'episode-missing-visible-payoff-action',
    'episode-missing-next-hook-requirement',
    'episode-missing-asset-plan',
  ]);
  const prioritized = [
    ...issues.filter((issue) => !issue.id.startsWith('step0-') && !metadataIssueIds.has(issue.id)),
    ...issues.filter((issue) => metadataIssueIds.has(issue.id)),
    ...issues.filter((issue) => issue.id.startsWith('step0-')),
  ];
  return prioritized
    .slice(0, 5)
    .map((issue) => `${issue.label}：${issue.suggestion}`)
    .join('；');
}
