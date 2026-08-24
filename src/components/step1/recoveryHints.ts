export interface Step1RecoveryHintInput {
  failureMessage: string;
  isNovel: boolean;
  hasAdaptedScript: boolean;
  hasRawScript: boolean;
}

function pushUnique(target: string[], value: string) {
  if (!value || target.includes(value)) return;
  target.push(value);
}

export function buildStep1RecoveryHints({
  failureMessage,
  isNovel,
  hasAdaptedScript,
  hasRawScript,
}: Step1RecoveryHintInput): string[] {
  const hints: string[] = [];

  if (/未能提取到任何分镜|未识别到任何分镜标题/.test(failureMessage)) {
    pushUnique(
      hints,
      isNovel
        ? '先检查改编稿里是否真的拆成了分镜结构，至少要出现“分镜01（15秒）”或“## 分镜01”这类标题。'
        : '请把每个分镜写成明确标题，例如“分镜01（15秒）”或“## 分镜01”。',
    );
  }

  if (/缺少名称或时长|缺少名称|缺少时长|分镜标题缺少单镜时长|个分镜标题缺少单镜时长/.test(failureMessage)) {
    pushUnique(hints, '给每个分镜补齐名称和单镜时长，再重新分析。');
  }

  if (/分镜编号.+重复/.test(failureMessage)) {
    pushUnique(hints, '先把重复的分镜编号整理成唯一顺序，再重新分析，避免后续场景和道具范围串位。');
  }

  if (/分镜编号顺序有误/.test(failureMessage)) {
    pushUnique(hints, '把分镜编号按从小到大排列，例如分镜01、分镜02、分镜03，再重新分析。');
  }

  if (/单镜时长不合理/.test(failureMessage)) {
    pushUnique(hints, '把单镜时长控制在 4~60 秒之间；如果是一镜多段内容，优先拆成多个分镜，而不是把单镜时长拉得过长。');
  }

  if (/角色信息|未定义角色/.test(failureMessage)) {
    pushUnique(hints, '在对白、人物一致性或分镜描述里显式写出角色名，不要只用“她/他/对方”指代。');
  }

  if (/不存在的场景/.test(failureMessage)) {
    pushUnique(hints, '分镜里的场景名要和场景清单保持完全一致，避免一个写“主入口”，另一个写“入口前台阶”。');
  }

  if (/持有者/.test(failureMessage)) {
    pushUnique(hints, '道具持有者只能写已定义角色，或写“无 / 场景道具 / 无/场景道具”。');
  }

  if (/无法连接到提示词代理服务|BFF Error|empty content|网络|fetch/i.test(failureMessage)) {
    pushUnique(hints, '如果是接口或网络异常，先检查 API Key、模型配置，以及本地 BFF 服务是否正常。');
  }

  if (/合法 JSON|兜底提取|自动修复/.test(failureMessage)) {
    pushUnique(hints, '优先重新分析一次，确认模型返回的是标准 JSON，而不是解释性文本或半结构化内容。');
    pushUnique(hints, '如果你在网文模式下，先检查改编稿里是否保留了明确的分镜标题、单镜时长和角色名，再重新分析。');
  }

  if (isNovel && hasAdaptedScript) {
    pushUnique(hints, '如果改编稿整体没问题，优先点“只重新分析改编稿”；只有改编内容本身不对时，再点“重新从原网文改编”。');
  } else if (hasRawScript) {
    pushUnique(hints, '修改当前剧本后，直接点“重新分析当前剧本”即可。');
  }

  if (hints.length === 0) {
    pushUnique(
      hints,
      isNovel && hasAdaptedScript
        ? '先检查改编稿，再决定是只重跑分析，还是重新从原网文改编。'
        : '先根据提示修正当前剧本，再重新分析。',
    );
  }

  return hints;
}
