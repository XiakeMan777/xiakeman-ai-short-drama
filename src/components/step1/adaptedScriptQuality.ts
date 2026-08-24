export interface AdaptedScriptQualityIssue {
  id: string;
  label: string;
  suggestion: string;
}

const QUALITY_RULES: Array<{
  id: string;
  pattern: RegExp;
  label: string;
  suggestion: string;
}> = [
  {
    id: 'typo-yixing-invasion',
    pattern: /异性侵/g,
    label: '疑似错字“异性侵”仍残留',
    suggestion: '怪物或污染语境应改为“异种侵体”“怪物污染侵体”等自然表达。',
  },
  {
    id: 'awkward-drag-corpses-line',
    pattern: /(?:缝个屁，?明天杂役营还要出墙拖尸，?能喘气就算活。?|缝个屁。?明早还得出墙，?能喘气就算活。?)/g,
    label: '原文别扭对白仍被原样照抄',
    suggestion: '建议改为“缝个屁。明早还得出墙拖尸，能喘气的都得上”这类保留火气的短促命令句。',
  },
  {
    id: 'awkward-body-os',
    pattern: /我活在一具废人身上了/g,
    label: '主角内心OS仍像说明句',
    suggestion: '建议改为“我被扔进了一具将死的废土伤兵身体里”等更自然的短剧表达。',
  },
  {
    id: 'object-written-as-character',
    pattern: /人物一致性｜[^\n*]*(?:残屑|样本|烂肉|甲壳|渗液|污布|铁盆|伤口)[^\n*]*/g,
    label: '道具/残屑被误写成人物一致性',
    suggestion: '异种残屑、污染样本、铁盆污布等应写入道具或画面，不应进入角色资产。',
  },
];

const KNOWN_ISSUE_REPAIRS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /缝个屁，?明天杂役营还要出墙拖尸，?能喘气就算活。?/g,
    replacement: '缝个屁。明早还得出墙拖尸，能喘气的都得上。',
  },
  {
    pattern: /缝个屁。?明早还得出墙，?能喘气就算活。?/g,
    replacement: '缝个屁。明早还得出墙拖尸，能喘气的都得上。',
  },
  {
    pattern: /缝好也没用，?明早出墙拖尸，?能喘气就得上。?/g,
    replacement: '缝个屁。明早还得出墙拖尸，能喘气的都得上。',
  },
  {
    pattern: /明天杂役营还要出墙拖尸/g,
    replacement: '明早还得出墙拖尸',
  },
  {
    pattern: /异性侵/g,
    replacement: '异种侵',
  },
  {
    pattern: /我活在一具废人身上了/g,
    replacement: '我被扔进了一具将死的废土伤兵身体里',
  },
  {
    pattern: /人物一致性｜([^\n*]*(?:残屑|样本|烂肉|甲壳|渗液|污布|铁盆|伤口)[^\n*]*)/g,
    replacement: '道具/物品一致性｜$1',
  },
];

const MAX_SPEECH_CHARS_PER_15_SECOND_STORYBOARD = 143;
const MAX_SPEECH_LINES_PER_15_SECOND_STORYBOARD = 12;
const MAX_CONSECUTIVE_DIALOGUE_LINES_BY_SAME_SPEAKER = 4;
const MAX_OS_OR_SYSTEM_LINES_PER_15_SECOND_STORYBOARD = 2;
const MAX_OS_OR_SYSTEM_CHARS_PER_15_SECOND_STORYBOARD = 31;

interface StoryboardSpeechLine {
  type: string;
  speaker: string;
  text: string;
  meta: string;
}

function isCrowdOrAmbientSpeaker(speaker: string): boolean {
  return /(?:众人|人声|伤员|棚内|士兵|守卫|杂役|路人|孩童|群众|人群)/.test(speaker);
}

function countSpeechChars(text: string): number {
  return text.match(/[\u4e00-\u9fffA-Za-z0-9]/g)?.length ?? 0;
}

function splitStoryboardSections(scriptText: string): Array<{
  number: string;
  durationSeconds: number;
  content: string;
}> {
  return scriptText
    .split(/(?=^##\s*分镜\s*\d+)/m)
    .filter((section) => /^##\s*分镜\s*\d+/.test(section.trim()))
    .map((section) => {
      const heading = section.match(/^##\s*分镜\s*0*(\d+)[^\n]*/m);
      const duration = heading?.[0].match(/(?:总时长：\s*)?(\d+(?:\.\d+)?)\s*秒/);
      return {
        number: heading?.[1] ?? '?',
        durationSeconds: Number(duration?.[1] ?? 15),
        content: section,
      };
    });
}

function extractSpeechLines(sectionText: string): StoryboardSpeechLine[] {
  const markerPattern = /\*\*(对白|内心OS|系统播报)(?:（([^）]+)）)?\*\*/g;
  const markers: Array<{ index: number; end: number; type: string; speaker: string }> = [];
  let markerMatch: RegExpExecArray | null;

  while ((markerMatch = markerPattern.exec(sectionText)) !== null) {
    markers.push({
      index: markerMatch.index,
      end: markerPattern.lastIndex,
      type: markerMatch[1],
      speaker: markerMatch[2] ?? (markerMatch[1] === '系统播报' ? '系统' : '主角'),
    });
  }

  const lines: StoryboardSpeechLine[] = [];
  markers.forEach((marker, index) => {
    const nextMarkerIndex = markers[index + 1]?.index ?? sectionText.length;
    const block = sectionText.slice(marker.end, nextMarkerIndex);
    const speechLinePattern = /\[[^\]]+\](?:【([^】]+)】)?\s*\\?["“]([^"”\n\\]+)\\?["”]/g;
    let lineMatch: RegExpExecArray | null;

    while ((lineMatch = speechLinePattern.exec(block)) !== null) {
      lines.push({
        type: marker.type,
        speaker: marker.speaker,
        meta: lineMatch[1] ?? '',
        text: lineMatch[2].trim(),
      });
    }
  });

  return lines;
}

function getMaxConsecutiveDialogueLines(lines: StoryboardSpeechLine[]): number {
  let maxRun = 0;
  let currentSpeaker = '';
  let currentRun = 0;

  lines.forEach((line) => {
    if (line.type !== '对白' || isCrowdOrAmbientSpeaker(line.speaker)) {
      currentSpeaker = '';
      currentRun = 0;
      return;
    }

    if (line.speaker === currentSpeaker) {
      currentRun += 1;
    } else {
      currentSpeaker = line.speaker;
      currentRun = 1;
    }
    maxRun = Math.max(maxRun, currentRun);
  });

  return maxRun;
}

const STIFF_DIALOGUE_LINE_PATTERN = /^(?:同源。?|同源，能用。?|这不是毒，是材料。?|绝境？是材料。?|我验伤。?|我验伤。也拿它活命。?|是我把你留下的。?|今天是我把你留下来的。?)$/;
const MECHANICAL_AI_SUMMARY_OPENING_RE = /^(?:我(?:决定|明白|知道|必须|一定|不能再|不会再|要|会)|从现在开始|这一切|这就是真相)/;
const MECHANICAL_AI_ABSTRACT_RE = /(?:命运|软弱|一切|未来|真相|身份|人生|选择|改变|反击|复仇|证明|守护|摆布)/;
const CONCRETE_PRESSURE_RE = /(?:你|他|她|刀|剑|药|血|门|圣旨|白绫|证据|袖口|跪|杀|死|烧|割|扔|拿|放|滚|闭嘴|账|钱|婚书|玉佩|诏书|毒|尸)/;

function findStiffLabelDialogueIssue(scriptText: string): AdaptedScriptQualityIssue | null {
  const hasStiffSpeechLine = splitStoryboardSections(scriptText)
    .some((section) => extractSpeechLines(section.content)
      .some((line) => STIFF_DIALOGUE_LINE_PATTERN.test(line.text.trim())));

  if (!hasStiffSpeechLine) return null;

  return {
    id: 'stiff-label-dialogue',
    label: '短剧对白口语感不足',
    suggestion: '当前台词仍像概念标签或提纲句。请改成能被演员直接说出口的口语对攻：带反问、打断、威胁、试探和代价，不要只说“材料”“验伤”“我留下你”这类信息块。',
  };
}

function normalizeSpeechText(text: string): string {
  return text.replace(/[“”"。！？!?，,、\s]/g, '').trim();
}

function isMechanicalAiSummaryLine(text: string): boolean {
  const normalized = normalizeSpeechText(text);
  if (countSpeechChars(normalized) < 8) return false;
  if (!MECHANICAL_AI_SUMMARY_OPENING_RE.test(normalized)) return false;
  if (!MECHANICAL_AI_ABSTRACT_RE.test(normalized)) return false;
  return !CONCRETE_PRESSURE_RE.test(normalized);
}

function findMechanicalAiDialogueIssue(scriptText: string): AdaptedScriptQualityIssue | null {
  const matchedLines = splitStoryboardSections(scriptText)
    .flatMap((section) => extractSpeechLines(section.content))
    .filter((line) => isMechanicalAiSummaryLine(line.text));

  if (matchedLines.length < 2) return null;

  const examples = matchedLines
    .slice(0, 3)
    .map((line) => `“${line.text}”`)
    .join('、');

  return {
    id: 'mechanical-ai-summary-dialogue',
    label: '对白存在机械AI总结腔',
    suggestion: `${examples} 这类句子在短视频里像角色替作者总结主题。请改成具体对象、证据、代价、反问、威胁或下一步动作，例如把“我必须改变命运”改成“圣旨先别烧，我要借它进宫”。`,
  };
}

function findSpeechRhythmIssue(scriptText: string): AdaptedScriptQualityIssue | null {
  const sections = splitStoryboardSections(scriptText);
  const overloadedSections = sections
    .map((section, index) => {
      const speechLines = extractSpeechLines(section.content);
      const speechChars = speechLines.reduce((sum, line) => sum + countSpeechChars(line.text), 0);
      const maxConsecutiveDialogueLines = getMaxConsecutiveDialogueLines(speechLines);
      const osOrSystemLines = speechLines.filter((line) => line.type !== '对白');
      const osOrSystemChars = osOrSystemLines.reduce((sum, line) => sum + countSpeechChars(line.text), 0);
      const isShortStoryboard = section.durationSeconds <= 16;
      const isFinalStoryboard = sections.length > 1 && index === sections.length - 1;
      const problems: string[] = [];

      if (isShortStoryboard && speechChars > MAX_SPEECH_CHARS_PER_15_SECOND_STORYBOARD) {
        problems.push(`${speechChars}字`);
      }
      if (isShortStoryboard && speechLines.length > MAX_SPEECH_LINES_PER_15_SECOND_STORYBOARD) {
        problems.push(`${speechLines.length}句`);
      }
      if (
        isShortStoryboard
        && maxConsecutiveDialogueLines > MAX_CONSECUTIVE_DIALOGUE_LINES_BY_SAME_SPEAKER
        && !(isFinalStoryboard
          && maxConsecutiveDialogueLines <= 5
          && speechChars <= MAX_SPEECH_CHARS_PER_15_SECOND_STORYBOARD)
      ) {
        problems.push(`同角色连说${maxConsecutiveDialogueLines}句`);
      }
      if (
        isShortStoryboard
        && osOrSystemLines.length > MAX_OS_OR_SYSTEM_LINES_PER_15_SECOND_STORYBOARD
      ) {
        problems.push(`OS/系统播报${osOrSystemLines.length}句`);
      }
      if (
        isShortStoryboard
        && osOrSystemChars > MAX_OS_OR_SYSTEM_CHARS_PER_15_SECOND_STORYBOARD
      ) {
        problems.push(`OS/系统播报${osOrSystemChars}字`);
      }

      return problems.length > 0 ? { number: section.number, problems } : null;
    })
    .filter((section): section is { number: string; problems: string[] } => Boolean(section));

  if (overloadedSections.length === 0) return null;

  const sectionSummary = overloadedSections
    .slice(0, 6)
    .map((section) => `第${section.number}镜${section.problems.join('、')}`)
    .join('；');

  return {
    id: 'short-video-dialogue-rhythm-overloaded',
    label: '短视频对白节奏失衡',
    suggestion: `${sectionSummary}。15秒分镜允许高密度快语速对攻，建议保留情绪足、冲突强、互相顶的短句；只拦截说明型堆字、OS/系统播报过多、同一真实角色连续播报式长说。`,
  };
}

function findDialogueDeliveryIssue(scriptText: string): AdaptedScriptQualityIssue | null {
  const weakSections = splitStoryboardSections(scriptText)
    .map((section) => {
      const dialogueLines = extractSpeechLines(section.content)
        .filter((line) => line.type === '对白');
      const slowDialogueLines = dialogueLines.filter((line) => /语速：(?:慢|中慢)/.test(line.meta));
      const isShortStoryboard = section.durationSeconds <= 16;

      if (
        !isShortStoryboard
        || dialogueLines.length < 6
        || slowDialogueLines.length < Math.ceil(dialogueLines.length * 0.45)
      ) {
        return null;
      }

      return {
        number: section.number,
        slow: slowDialogueLines.length,
        total: dialogueLines.length,
      };
    })
    .filter((section): section is { number: string; slow: number; total: number } => Boolean(section));

  if (weakSections.length === 0) return null;

  const sectionSummary = weakSections
    .slice(0, 6)
    .map((section) => `第${section.number}镜慢/中慢${section.slow}/${section.total}句`)
    .join('；');

  return {
    id: 'short-video-dialogue-delivery-too-slow',
    label: '短剧对白语速偏慢',
    suggestion: `${sectionSummary}。当前目标是话密、词多、语速快、情绪足，除关键压迫停顿外，互怼对白应优先标为中快/快/爆发，并写成有气口的反问、打断和反击。`,
  };
}

const OBSERVATION_GOAL_RE = /(?:交代设定|观察|说明|回顾|铺垫)/;
const CONFLICT_GOAL_RE = /(?:冲突|威胁|拆穿|压迫|决定|反转|代价|升级|揭示|对攻|逼迫|打脸|逼近)/;
const RELAY_SIGNAL_RE = /(?:未完成|未落地|未说完|未揭晓|悬念|钩子|承接口|接力口|接到下一镜|推到下一镜|强切|停顿|逼近|撕裂|威胁|证据|门外来人)/;

function findObservationStoryboardIssue(scriptText: string): AdaptedScriptQualityIssue | null {
  const sections = splitStoryboardSections(scriptText);
  const observationStoryboards: string[] = [];

  for (const section of sections) {
    const goalMatch = section.content.match(/\*\*本镜叙事目标\*\*\s*\[([^\]]+)\]/);
    const goal = goalMatch?.[1] ?? '';
    if (!OBSERVATION_GOAL_RE.test(goal)) continue;

    const speechLines = extractSpeechLines(section.content);
    const dialogueLines = speechLines.filter((l) => l.type === '对白');
    const coreInfoMatch = section.content.match(/\*\*本镜核心信息点\*\*\s*\[([^\]]+)\]/);
    const coreInfo = coreInfoMatch?.[1] ?? '';
    const hasConflictCore = CONFLICT_GOAL_RE.test(coreInfo);

    if (!hasConflictCore && dialogueLines.length <= 1) {
      observationStoryboards.push(section.number);
    }
  }

  if (observationStoryboards.length === 0) return null;

  return {
    id: 'observation-storyboard-standalone',
    label: '观察镜独立成镜',
    suggestion: `第${observationStoryboards.join('、')}镜主要是观察/设定，无角色对抗、资源损失或危险逼近，应并入前一镜后半段或后一镜开头，不应独立成15秒分镜。`,
  };
}

function findDuplicateGoalIssue(scriptText: string): AdaptedScriptQualityIssue | null {
  const sections = splitStoryboardSections(scriptText);
  const duplicatePairs: string[] = [];

  for (let i = 1; i < sections.length; i += 1) {
    const prevGoalMatch = sections[i - 1].content.match(/\*\*本镜叙事目标\*\*\s*\[([^\]]+)\]/);
    const currGoalMatch = sections[i].content.match(/\*\*本镜叙事目标\*\*\s*\[([^\]]+)\]/);
    const prevGoal = prevGoalMatch?.[1]?.trim() ?? '';
    const currGoal = currGoalMatch?.[1]?.trim() ?? '';

    if (prevGoal && prevGoal === currGoal) {
      duplicatePairs.push(`${sections[i - 1].number}→${sections[i].number}`);
    }
  }

  if (duplicatePairs.length === 0) return null;

  return {
    id: 'adjacent-storyboard-duplicate-goal',
    label: '相邻分镜功能重复',
    suggestion: `第${duplicatePairs.join('、')}镜叙事目标相同且无升级，应合并或重新分配分镜职责，确保每镜有且只有1个主推进点。`,
  };
}

function findMissingRelayIssue(scriptText: string): AdaptedScriptQualityIssue | null {
  const sections = splitStoryboardSections(scriptText);
  if (sections.length < 2) return null;

  const missingRelayStoryboards: string[] = [];

  for (let i = 0; i < sections.length - 1; i += 1) {
    const boundaryMatch = sections[i].content.match(/\*\*本镜边界\*\*\s*\[([^\]]+)\]/);
    const boundary = boundaryMatch?.[1] ?? '';
    const lastTimeBlockMatches = sections[i].content.match(/(?:\*\*)?\d+[.–]+\d+\s*秒(?:\*\*)?.*[｜|]/g);
    const lastTimeBlock = lastTimeBlockMatches?.at(-1) ?? '';
    const tailContent = [
      lastTimeBlock,
      sections[i].content.split('\n').slice(-8).join('\n'),
    ].filter(Boolean).join('\n');

    const hasRelayInBoundary = RELAY_SIGNAL_RE.test(boundary);
    const hasRelayInTail = RELAY_SIGNAL_RE.test(tailContent) || /(?:未|没|还|尚)[^。？]{0,6}(?:完|说|落|解决|揭晓|出现|来)/.test(tailContent);
    const hasConflictEnd = /(?:威胁|挑衅|拆穿|决定|翻转|撕裂|逼近|危险)/.test(tailContent);

    if (!hasRelayInBoundary && !hasRelayInTail && !hasConflictEnd) {
      missingRelayStoryboards.push(sections[i].number);
    }
  }

  if (missingRelayStoryboards.length === 0) return null;

  return {
    id: 'storyboard-missing-relay',
    label: '分镜缺少接力口',
    suggestion: `第${missingRelayStoryboards.join('、')}镜结尾无未完成动作、未落地威胁或悬念接力口，下一镜缺乏自然承接口。应在结尾保留未完成动作、未说完的话、未落地威胁或关系撕裂后停顿。`,
  };
}

export function polishKnownAdaptedScriptIssues(scriptText: string): string {
  return KNOWN_ISSUE_REPAIRS.reduce(
    (nextScript, repair) => nextScript.replace(repair.pattern, repair.replacement),
    scriptText.trim(),
  );
}

export function findAdaptedScriptQualityIssues(scriptText: string): AdaptedScriptQualityIssue[] {
  if (!scriptText.trim()) return [];

  const deterministicIssues = QUALITY_RULES
    .filter((rule) => {
      rule.pattern.lastIndex = 0;
      return rule.pattern.test(scriptText);
    })
    .map(({ id, label, suggestion }) => ({ id, label, suggestion }));

  const speechRhythmIssue = findSpeechRhythmIssue(scriptText);
  if (speechRhythmIssue) {
    deterministicIssues.push(speechRhythmIssue);
  }

  const stiffLabelDialogueIssue = findStiffLabelDialogueIssue(scriptText);
  if (stiffLabelDialogueIssue) {
    deterministicIssues.push(stiffLabelDialogueIssue);
  }

  const mechanicalAiDialogueIssue = findMechanicalAiDialogueIssue(scriptText);
  if (mechanicalAiDialogueIssue) {
    deterministicIssues.push(mechanicalAiDialogueIssue);
  }

  const dialogueDeliveryIssue = findDialogueDeliveryIssue(scriptText);
  if (dialogueDeliveryIssue) {
    deterministicIssues.push(dialogueDeliveryIssue);
  }

  const observationIssue = findObservationStoryboardIssue(scriptText);
  if (observationIssue) {
    deterministicIssues.push(observationIssue);
  }

  const duplicateGoalIssue = findDuplicateGoalIssue(scriptText);
  if (duplicateGoalIssue) {
    deterministicIssues.push(duplicateGoalIssue);
  }

  const missingRelayIssue = findMissingRelayIssue(scriptText);
  if (missingRelayIssue) {
    deterministicIssues.push(missingRelayIssue);
  }

  return deterministicIssues;
}

export function formatAdaptedScriptQualityIssues(issues: AdaptedScriptQualityIssue[]): string {
  if (issues.length === 0) return '';
  const details = issues
    .map((issue) => `${issue.label}：${issue.suggestion}`)
    .join('；');
  return `改编稿质检未通过：${details}`;
}
