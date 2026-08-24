import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertCircle,
  Check,
  ChevronRight,
  Clapperboard,
  Eye,
  FileText,
  Loader2,
  RotateCcw,
  Sparkles,
  Wand2,
  Zap,
} from '@/components/icons';
import { OPEN_API_SETTINGS_EVENT } from '@/components/shared/apiSettingsEvents';
import { useApiCall } from '@/hooks/useApiCall';
import { cn } from '@/lib/utils';
import { useCurrentProject } from '@/stores/projectStore';
import {
  buildSeriesConceptAlignmentCheckUserPrompt,
  buildSeriesConceptAnalyzeUserPrompt,
  buildSeriesBibleUserPrompt,
  buildSeriesEpisodeCardsUserPrompt,
  buildSeriesEpisodeSettleUserPrompt,
  buildSeriesEpisodeScriptRepairUserPrompt,
  buildSeriesEpisodeScriptUserPrompt,
  buildSeriesPremisePolishUserPrompt,
  buildSeriesStep0QualityCheckUserPrompt,
  buildSeriesStep0QualityRepairUserPrompt,
  type SeriesStep0QualityStage,
  type SeriesStep0RepairScope,
} from '@/lib/prompt-templates/series-planner';
import { createEmptySeriesRuntime, normalizeSeriesRuntime } from '@/lib/seriesRuntime';
import { resolveStep1StyleConfig } from '@/lib/style-presets';
import {
  findEpisodeScriptQualityIssues,
  getBlockingEpisodeScriptIssues,
  findSeriesPlanQualityIssues,
  findSeriesRuntimeQualityIssues,
  formatSeriesQualityIssues,
  type SeriesQualityIssue,
} from './seriesQuality';
import { stabilizeGeneratedEpisodeScript } from '@/lib/seriesScriptStabilizer';
import type {
  EpisodeSatisfactionType,
  SeriesAudienceChannel,
  SeriesCharacterProfile,
  SeriesConceptAlignmentReport,
  SeriesConceptAnalysis,
  SeriesEpisodeCard,
  SeriesEpisodeAdHocAsset,
  SeriesEpisodeType,
  SeriesPlan,
  SeriesPlayRules,
  SeriesProductionAsset,
  SeriesProductionAssetCategory,
  SeriesProductionAssetStatus,
  SeriesRuntimeState,
  SeriesSeasonRhythmBeat,
  SeriesStep0QualityReport,
} from '@/types';

const GENRE_OPTIONS = [
  { value: 'ancient_sweet_romance', label: '古风甜宠轻喜' },
  { value: 'ancient_romance', label: '古风虐恋反转' },
  { value: 'palace_intrigue', label: '宫斗权谋' },
  { value: 'xianxia', label: '仙侠玄幻' },
  { value: 'modern_revenge', label: '现代复仇' },
  { value: 'boss_romance', label: '霸总甜宠恋爱' },
  { value: 'male_power_fantasy', label: '男频逆袭爽剧' },
  { value: 'male_medical_master', label: '男频神医医圣' },
  { value: 'male_war_god_dragon', label: '男频战神龙王' },
  { value: 'male_son_in_law', label: '男频赘婿逆袭' },
  { value: 'male_treasure_appraisal', label: '男频鉴宝捡漏' },
  { value: 'rebirth_revenge', label: '重生复仇改命' },
  { value: 'transmigration_book', label: '穿书改剧情' },
  { value: 'system_task', label: '系统任务奖励' },
  { value: 'quick_transmigration', label: '快穿单元任务' },
  { value: 'time_loop', label: '时间循环破局' },
  { value: 'body_swap', label: '身份互换错位' },
  { value: 'mind_reading', label: '读心预知偷听' },
  { value: 'bullet_comments', label: '弹幕剧透旁观' },
  { value: 'space_stockpile', label: '空间囤货生存' },
  { value: 'absurd_comedy', label: '搞笑抽象癫剧' },
  { value: 'family_ethics', label: '家庭伦理婚姻' },
  { value: 'mystic_fengshui', label: '玄学风水抓鬼' },
  { value: 'pure_comedy', label: '纯搞笑喜剧' },
  { value: 'custom', label: '自定义类型' },
] as const;

const DEFAULT_GENRE_MODE: SeriesPlan['genreMode'] = 'custom';
const DEFAULT_SERIES_EPISODE_DURATION = 120;
const SERIES_LLM_REQUEST_TIMEOUT_SECONDS = 300;
const STALE_STEP0_STRUCTURE_REPORT_RE = /(?:缺少|缺失|未生成|还没有|没有)[\s\S]{0,18}(?:分集爽点卡|分集卡|集卡|整季节奏表|整季节奏|节奏表|episodeCards|seasonRhythm)|(?:分集爽点卡|分集卡|集卡|整季节奏表|整季节奏|节奏表|episodeCards|seasonRhythm)[\s\S]{0,8}(?:为空|未生成|还没有|没有)/i;

type Step1EntryIssueSource = 'missing-script' | 'step0-report' | 'step0-plan' | 'episode-script';

interface Step1EntryIssue {
  id: string;
  source: Step1EntryIssueSource;
  title: string;
  detail: string;
  ignoreable: boolean;
}

interface Step1EntryDialogState {
  episodeId: string;
  episodeNumber: number;
  episodeTitle: string;
  issues: Step1EntryIssue[];
  canIgnore: boolean;
}

interface SettleEpisodeMemoryOptions {
  background?: boolean;
  notify?: boolean;
}

const GENRE_OPTION_GROUPS: Array<{ label: string; values: Array<(typeof GENRE_OPTIONS)[number]['value']> }> = [
  { label: '古风与仙侠', values: ['ancient_sweet_romance', 'ancient_romance', 'palace_intrigue', 'xianxia'] },
  { label: '现代情感', values: ['modern_revenge', 'boss_romance'] },
  { label: '男频反打', values: ['male_power_fantasy', 'male_medical_master', 'male_war_god_dragon', 'male_son_in_law', 'male_treasure_appraisal'] },
  { label: '机制爽剧', values: ['rebirth_revenge', 'transmigration_book', 'system_task', 'quick_transmigration', 'time_loop', 'body_swap', 'mind_reading', 'bullet_comments', 'space_stockpile'] },
  { label: '生活与喜剧', values: ['absurd_comedy', 'family_ethics', 'pure_comedy'] },
  { label: '玄学与自定义', values: ['mystic_fengshui', 'custom'] },
];
const GENRE_OPTION_BY_VALUE = new Map(GENRE_OPTIONS.map((option) => [option.value, option]));
const AUDIENCE_CHANNEL_OPTIONS: Array<{ value: SeriesAudienceChannel; label: string; hint: string }> = [
  { value: 'auto', label: '自动判断', hint: '让系统按点子选方向' },
  { value: 'male', label: '男频', hint: '逆袭反打，剧情爽' },
  { value: 'female', label: '女频', hint: '暧昧拉扯，关系爽' },
];
const DEFAULT_AUDIENCE_CHANNEL: SeriesAudienceChannel = 'auto';

const PRODUCTION_ASSET_CATEGORIES: SeriesProductionAssetCategory[] = [
  'unit_antagonist',
  'supernatural_event',
  'case_crisis',
  'enemy_force',
  'evidence_secret',
  'system_task',
  'relationship_event',
  'business_order',
  'comedy_misunderstanding',
  'key_scene',
  'special_prop',
  'rule_mechanism',
  'other',
];

const PRODUCTION_ASSET_STATUSES: SeriesProductionAssetStatus[] = ['planned', 'used', 'adHoc', 'promoted'];

const PRODUCTION_ASSET_CATEGORY_LABELS: Record<SeriesProductionAssetCategory, string> = {
  unit_antagonist: '单元对手',
  supernatural_event: '灵异事件',
  case_crisis: '案件危机',
  enemy_force: '敌方势力',
  evidence_secret: '证据秘密',
  system_task: '系统任务',
  relationship_event: '关系事件',
  business_order: '经营订单',
  comedy_misunderstanding: '喜剧误会',
  key_scene: '关键场景',
  special_prop: '特殊道具',
  rule_mechanism: '规则机制',
  other: '其他素材',
};

const EPISODE_TYPES: SeriesEpisodeType[] = [
  'premise_hook',
  'rule_reveal',
  'unit_event',
  'relationship_contrast',
  'villain_probe',
  'major_payoff',
  'long_secret',
  'bridge_resolution',
];

const EPISODE_TYPE_LABELS: Record<SeriesEpisodeType, string> = {
  premise_hook: '破题集',
  rule_reveal: '规则揭露',
  unit_event: '单元事件',
  relationship_contrast: '关系反差',
  villain_probe: '反派试探',
  major_payoff: '大爽点爆发',
  long_secret: '长线秘密',
  bridge_resolution: '收束承接',
};

const SATISFACTION_TYPES: EpisodeSatisfactionType[] = [
  'humiliation_reversal',
  'identity_tease',
  'misunderstanding_deepens',
  'villain_backfires',
  'heroine_leaves_coldly',
  'male_lead_regret',
  'evidence_reveal',
  'power_flip',
  'feeding_preference',
  'soft_protection',
  'romantic_misread',
  'daily_pull',
  'business_growth',
];

const SATISFACTION_LABELS: Record<EpisodeSatisfactionType, string> = {
  humiliation_reversal: '羞辱反转',
  identity_tease: '身份钩子',
  misunderstanding_deepens: '误会加深',
  villain_backfires: '反派反噬',
  heroine_leaves_coldly: '冷退场',
  male_lead_regret: '男主后悔',
  evidence_reveal: '证据揭露',
  power_flip: '权力翻盘',
  feeding_preference: '投喂偏爱',
  soft_protection: '温柔护短',
  romantic_misread: '暧昧误读',
  daily_pull: '日常拉扯',
  business_growth: '生意成长',
};

const EPISODE_CARD_BATCH_SIZE = 4;
const SERIES_REASONING_EFFORT = {
  creative: 'high',
  check: 'medium',
  repair: 'high',
} as const;

const TAOIST_LIVE_STREAM_KEYWORDS = [
  '天师',
  '龙虎山',
  '黑袍',
  '道士',
  '修道',
  '主播',
  '直播间',
  '直播',
  '僵尸',
  '鬼怪',
  '女鬼',
  '道法',
  '雷法',
  '符纸',
  '罗盘',
  '抓鬼',
  '驱邪',
];

const TAOIST_LIVE_STREAM_ANCHORS = [
  '黑袍天师哥哥必须是镇场爽点，不要写成普通顾问。',
  '主播妹妹和直播镜头是观众入口，每集要有她的破防反应。',
  '直播间弹幕要见证灵异从“不信”到“炸裂”，不能只当旁白。',
  '真实灵异必须被道法、雷法、符纸或法器当场验证兑现。',
];

interface SeriesInputHints {
  recommendedGenreMode?: SeriesPlan['genreMode'];
  recommendedAudienceChannel?: SeriesAudienceChannel;
  storyEngineCandidate: string;
  matchedKeywords: string[];
  anchorTitle: string;
  anchors: string[];
}

function inferSeriesInputHints(value: string): SeriesInputHints | undefined {
  const normalized = value.trim();
  if (normalized.length < 6) return undefined;

  const matchedKeywords = TAOIST_LIVE_STREAM_KEYWORDS.filter((keyword) => normalized.includes(keyword));
  const hasTaoistIdentity = /天师|龙虎山|黑袍|道士|修道/.test(normalized);
  const hasLiveStreamView = /主播|直播间|直播|弹幕/.test(normalized);
  const hasSupernaturalPayoff = /僵尸|鬼怪|女鬼|鬼|道法|雷法|符纸|罗盘|抓鬼|驱邪/.test(normalized);

  if (hasTaoistIdentity && hasLiveStreamView && hasSupernaturalPayoff) {
    return {
      recommendedGenreMode: 'mystic_fengshui',
      recommendedAudienceChannel: 'male',
      storyEngineCandidate: '天师哥哥 + 主播妹妹 + 直播间见证真实灵异',
      matchedKeywords,
      anchorTitle: '天师直播题材质量锚点',
      anchors: TAOIST_LIVE_STREAM_ANCHORS,
    };
  }

  return undefined;
}

function getGenreLabel(value: SeriesPlan['genreMode']): string {
  return GENRE_OPTION_BY_VALUE.get(value)?.label ?? '自定义类型';
}

function getAudienceChannelLabel(value: SeriesAudienceChannel): string {
  return AUDIENCE_CHANNEL_OPTIONS.find((option) => option.value === value)?.label ?? '自动判断';
}

function openApiSettings() {
  window.dispatchEvent(new CustomEvent(OPEN_API_SETTINGS_EVENT));
}

function normalizePremiseForCompare(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function extractJsonObject(rawText: string): unknown {
  const text = rawText.trim();
  if (!text) throw new Error('模型没有返回内容');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? text;
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('模型返回的不是 JSON 对象');
  }
  return JSON.parse(source.slice(start, end + 1));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

function normalizePlayRules(rawInput: unknown): SeriesPlayRules {
  const raw = rawInput && typeof rawInput === 'object' ? rawInput as Record<string, unknown> : {};
  return {
    audienceEntry: String(raw.audienceEntry ?? ''),
    recurringHook: String(raw.recurringHook ?? ''),
    payoffLoop: String(raw.payoffLoop ?? ''),
    escalationRule: String(raw.escalationRule ?? ''),
    assetRotationRule: String(raw.assetRotationRule ?? ''),
    protagonistActionRule: String(raw.protagonistActionRule ?? ''),
    forbiddenShortcut: String(raw.forbiddenShortcut ?? ''),
  };
}

function normalizeConceptAnalysis(rawInput: unknown): SeriesConceptAnalysis {
  const raw = rawInput && typeof rawInput === 'object' ? rawInput as Record<string, unknown> : {};
  const updatedAt = Number(raw.updatedAt);
  return {
    conceptLogline: String(raw.conceptLogline ?? ''),
    coreStoryEngine: String(raw.coreStoryEngine ?? ''),
    audiencePromise: String(raw.audiencePromise ?? ''),
    viewpointEntry: String(raw.viewpointEntry ?? ''),
    protagonistFantasy: String(raw.protagonistFantasy ?? ''),
    playRules: normalizePlayRules(raw.playRules),
    episodeEnginePattern: toStringArray(raw.episodeEnginePattern),
    characterVoiceRules: toStringArray(raw.characterVoiceRules),
    visualSatisfactionRules: toStringArray(raw.visualSatisfactionRules),
    driftGuardrails: toStringArray(raw.driftGuardrails),
    worldRules: toStringArray(raw.worldRules),
    mustKeepFacts: toStringArray(raw.mustKeepFacts),
    mustKeepCharacters: toStringArray(raw.mustKeepCharacters),
    mustKeepMechanisms: toStringArray(raw.mustKeepMechanisms),
    episodeFormula: toStringArray(raw.episodeFormula),
    forbiddenDrift: toStringArray(raw.forbiddenDrift),
    recommendedGenreMode: String(raw.recommendedGenreMode ?? ''),
    toneKeywords: toStringArray(raw.toneKeywords),
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
  };
}

function hasUsefulConceptAnalysis(concept: SeriesConceptAnalysis | undefined): concept is SeriesConceptAnalysis {
  if (!concept) return false;
  const raw = concept as Partial<SeriesConceptAnalysis>;
  const playRules = raw.playRules;
  const episodeEnginePattern = Array.isArray(raw.episodeEnginePattern) ? raw.episodeEnginePattern : [];
  const mustKeepFacts = Array.isArray(raw.mustKeepFacts) ? raw.mustKeepFacts : [];
  const mustKeepMechanisms = Array.isArray(raw.mustKeepMechanisms) ? raw.mustKeepMechanisms : [];
  return Boolean(
    String(raw.conceptLogline ?? '').trim()
      || String(raw.coreStoryEngine ?? '').trim()
      || String(raw.audiencePromise ?? '').trim()
      || String(playRules?.recurringHook ?? '').trim()
      || episodeEnginePattern.length > 0
      || mustKeepFacts.length > 0
      || mustKeepMechanisms.length > 0,
  );
}

function normalizeConceptAlignmentReport(rawInput: unknown): SeriesConceptAlignmentReport {
  const raw = rawInput && typeof rawInput === 'object' ? rawInput as Record<string, unknown> : {};
  const riskLevel = String(raw.riskLevel ?? 'low');
  return {
    aligned: typeof raw.aligned === 'boolean' ? raw.aligned : true,
    riskLevel: ['low', 'medium', 'high'].includes(riskLevel)
      ? riskLevel as SeriesConceptAlignmentReport['riskLevel']
      : 'low',
    missingMustKeep: toStringArray(raw.missingMustKeep),
    driftRisks: toStringArray(raw.driftRisks),
    repairInstructions: toStringArray(raw.repairInstructions),
    updatedAt: Date.now(),
  };
}

function normalizeStep0QualityReport(rawInput: unknown): SeriesStep0QualityReport {
  const raw = rawInput && typeof rawInput === 'object' ? rawInput as Record<string, unknown> : {};
  const riskLevel = String(raw.riskLevel ?? 'low');
  return {
    ok: typeof raw.ok === 'boolean' ? raw.ok : false,
    riskLevel: ['low', 'medium', 'high'].includes(riskLevel)
      ? riskLevel as SeriesStep0QualityReport['riskLevel']
      : 'low',
    summary: String(raw.summary ?? ''),
    bibleIssues: toStringArray(raw.bibleIssues),
    assetIssues: toStringArray(raw.assetIssues),
    rhythmIssues: toStringArray(raw.rhythmIssues),
    cardIssues: toStringArray(raw.cardIssues),
    repairInstructions: toStringArray(raw.repairInstructions),
    updatedAt: Date.now(),
  };
}

function isStaleMissingStructureStep0Report(report: SeriesStep0QualityReport): boolean {
  const reportText = [
    report.summary,
    ...report.bibleIssues,
    ...report.assetIssues,
    ...report.rhythmIssues,
    ...report.cardIssues,
    ...report.repairInstructions,
  ].filter(Boolean).join('\n');
  return STALE_STEP0_STRUCTURE_REPORT_RE.test(reportText);
}

function getStep1EntryIssueSourceLabel(source: Step1EntryIssueSource) {
  switch (source) {
    case 'missing-script':
      return '缺少剧本';
    case 'step0-report':
      return 'Step0 质量报告';
    case 'step0-plan':
      return 'Step0 本地门禁';
    case 'episode-script':
      return '本集稿质量';
    default:
      return '质量问题';
  }
}

function createStep1IssueFromQualityIssue(
  issue: SeriesQualityIssue,
  source: Step1EntryIssueSource,
): Step1EntryIssue {
  return {
    id: `${source}:${issue.id}`,
    source,
    title: issue.label,
    detail: issue.suggestion,
    ignoreable: true,
  };
}

function createStep1IssuesFromReport(report: SeriesStep0QualityReport): Step1EntryIssue[] {
  const sections: Array<[string, string[]]> = [
    ['人设圣经问题', report.bibleIssues],
    ['素材池问题', report.assetIssues],
    ['整季节奏问题', report.rhythmIssues],
    ['分集卡问题', report.cardIssues],
    ['修复建议', report.repairInstructions],
  ];
  const issues: Step1EntryIssue[] = [];
  if (report.summary.trim()) {
    issues.push({
      id: 'step0-report:summary',
      source: 'step0-report',
      title: 'Step0 高风险',
      detail: report.summary,
      ignoreable: true,
    });
  }
  sections.forEach(([title, items]) => {
    items.filter((item) => item.trim()).forEach((item, index) => {
      issues.push({
        id: `step0-report:${title}:${index}`,
        source: 'step0-report',
        title,
        detail: item,
        ignoreable: true,
      });
    });
  });
  return issues.length > 0
    ? issues
    : [{
        id: 'step0-report:high',
        source: 'step0-report',
        title: 'Step0 高风险',
        detail: '质量报告仍标记为高风险。建议先按报告修复集卡，再进入 Step1。',
        ignoreable: true,
      }];
}

function buildStep1EntryIssues(params: {
  episode: SeriesEpisodeCard;
  plan: SeriesPlan;
  planIssues: SeriesQualityIssue[];
  step0QualityReport?: SeriesStep0QualityReport;
  step0QualityReportIsStale: boolean;
}): Step1EntryIssue[] {
  const scriptText = params.episode.generatedScript?.trim();
  const issues: Step1EntryIssue[] = [];

  if (!scriptText) {
    return [{
      id: 'missing-script',
      source: 'missing-script',
      title: '本集还没有长剧情稿',
      detail: '请先点击“生成本集剧本”，拿到 Step1 可解析的分镜剧本后再进入。',
      ignoreable: false,
    }];
  }

  if (params.step0QualityReport?.riskLevel === 'high' && !params.step0QualityReportIsStale) {
    issues.push(...createStep1IssuesFromReport(params.step0QualityReport));
  }

  params.planIssues
    .filter((issue) => issue.id.startsWith('step0-mystic-') || issue.id.startsWith('episode-mystic-'))
    .forEach((issue) => {
      issues.push(createStep1IssueFromQualityIssue(issue, 'step0-plan'));
    });

  getBlockingEpisodeScriptIssues(scriptText, { plan: params.plan }).forEach((issue) => {
    issues.push(createStep1IssueFromQualityIssue(issue, 'episode-script'));
  });

  return issues;
}

function normalizeSatisfactionType(value: unknown, index: number): EpisodeSatisfactionType {
  if (typeof value === 'string' && SATISFACTION_TYPES.includes(value as EpisodeSatisfactionType)) {
    return value as EpisodeSatisfactionType;
  }
  return SATISFACTION_TYPES[index % SATISFACTION_TYPES.length];
}

function normalizeEpisodeType(value: unknown, index: number): SeriesEpisodeType | undefined {
  if (typeof value === 'string' && EPISODE_TYPES.includes(value as SeriesEpisodeType)) {
    return value as SeriesEpisodeType;
  }
  return EPISODE_TYPES[index % EPISODE_TYPES.length];
}

function normalizeCharacter(raw: Record<string, unknown>, index: number): SeriesCharacterProfile {
  const role = String(raw.role ?? (index === 0 ? 'heroine' : 'supporting'));
  return {
    id: String(raw.id ?? `char-${index + 1}`),
    name: String(raw.name ?? `角色${index + 1}`),
    role: ['heroine', 'hero', 'villain', 'supporting'].includes(role)
      ? role as SeriesCharacterProfile['role']
      : 'supporting',
    coreDesire: String(raw.coreDesire ?? ''),
    woundOrWeakness: String(raw.woundOrWeakness ?? ''),
    actionStyle: String(raw.actionStyle ?? ''),
    voiceStyle: String(raw.voiceStyle ?? ''),
    visualAnchor: String(raw.visualAnchor ?? ''),
    recurringProps: toStringArray(raw.recurringProps),
    continuityNotes: String(raw.continuityNotes ?? ''),
  };
}

function normalizeProductionAssetCategory(value: unknown): SeriesProductionAssetCategory {
  const category = String(value ?? 'other');
  return PRODUCTION_ASSET_CATEGORIES.includes(category as SeriesProductionAssetCategory)
    ? category as SeriesProductionAssetCategory
    : 'other';
}

function normalizeProductionAssetStatus(value: unknown): SeriesProductionAssetStatus {
  const status = String(value ?? 'planned');
  return PRODUCTION_ASSET_STATUSES.includes(status as SeriesProductionAssetStatus)
    ? status as SeriesProductionAssetStatus
    : 'planned';
}

function normalizeProductionAsset(raw: Record<string, unknown>, index: number): SeriesProductionAsset {
  const name = String(raw.name ?? `素材${index + 1}`);
  return {
    id: String(raw.id ?? `asset-${index + 1}`),
    name,
    category: normalizeProductionAssetCategory(raw.category),
    genreUse: String(raw.genreUse ?? ''),
    episodeRange: String(raw.episodeRange ?? ''),
    visualAnchor: String(raw.visualAnchor ?? ''),
    storyFunction: String(raw.storyFunction ?? ''),
    conflictRule: String(raw.conflictRule ?? ''),
    assetNeed: String(raw.assetNeed ?? ''),
    reuseLevel: String(raw.reuseLevel ?? ''),
    status: normalizeProductionAssetStatus(raw.status),
  };
}

function normalizeAdHocAsset(raw: Record<string, unknown>, index: number): SeriesEpisodeAdHocAsset {
  const name = String(raw.name ?? `临时素材${index + 1}`);
  return {
    id: String(raw.id ?? `adhoc-${index + 1}`),
    name,
    category: normalizeProductionAssetCategory(raw.category),
    reason: String(raw.reason ?? ''),
    visualAnchor: String(raw.visualAnchor ?? ''),
    assetNeed: String(raw.assetNeed ?? ''),
    needsReference: typeof raw.needsReference === 'boolean'
      ? raw.needsReference
      : /^(true|yes|是|需要)$/i.test(String(raw.needsReference ?? '').trim()),
    promoteSuggestion: typeof raw.promoteSuggestion === 'boolean'
      ? raw.promoteSuggestion
      : /^(true|yes|是|建议)$/i.test(String(raw.promoteSuggestion ?? '').trim()),
  };
}

function normalizeEpisode(raw: Record<string, unknown>, index: number): SeriesEpisodeCard {
  const episodeNumber = Number(raw.episodeNumber ?? index + 1);
  return {
    id: String(raw.id ?? `ep-${episodeNumber || index + 1}`),
    episodeNumber: Number.isFinite(episodeNumber) && episodeNumber > 0 ? episodeNumber : index + 1,
    episodeType: normalizeEpisodeType(raw.episodeType, index),
    title: String(raw.title ?? `第${index + 1}集`),
    mainQuestion: String(raw.mainQuestion ?? ''),
    coreConflictAction: String(raw.coreConflictAction ?? ''),
    openingHook: String(raw.openingHook ?? ''),
    pressureBeats: toStringArray(raw.pressureBeats),
    satisfactionType: normalizeSatisfactionType(raw.satisfactionType, index),
    satisfactionBeat: String(raw.satisfactionBeat ?? ''),
    visiblePayoffAction: String(raw.visiblePayoffAction ?? ''),
    cliffhanger: String(raw.cliffhanger ?? ''),
    nextHookRequirement: String(raw.nextHookRequirement ?? ''),
    continuityIn: toStringArray(raw.continuityIn),
    continuityOut: toStringArray(raw.continuityOut),
    visualReuse: toStringArray(raw.visualReuse),
    assetPlan: toStringArray(raw.assetPlan),
    adHocAssets: Array.isArray(raw.adHocAssets)
      ? raw.adHocAssets.map((item, itemIndex) => normalizeAdHocAsset(item as Record<string, unknown>, itemIndex))
      : [],
    generatedScript: typeof raw.generatedScript === 'string' ? raw.generatedScript : undefined,
    generatedAt: typeof raw.generatedAt === 'number' ? raw.generatedAt : undefined,
  };
}

function normalizeSeasonRhythmBeat(raw: Record<string, unknown>, index: number): SeriesSeasonRhythmBeat {
  const episodeNumber = Number(raw.episodeNumber ?? index + 1);
  return {
    episodeNumber: Number.isFinite(episodeNumber) && episodeNumber > 0 ? episodeNumber : index + 1,
    episodeType: normalizeEpisodeType(raw.episodeType, index) ?? EPISODE_TYPES[index % EPISODE_TYPES.length],
    role: String(raw.role ?? ''),
    requiredAsset: String(raw.requiredAsset ?? ''),
    coreTurn: String(raw.coreTurn ?? ''),
    payoffPromise: String(raw.payoffPromise ?? ''),
    nextHook: String(raw.nextHook ?? ''),
  };
}

function toBoundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function toIntegerDraft(value: number) {
  return String(Math.round(value));
}

function getDraftInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : null;
}

function normalizeSeriesPlan(
  rawInput: unknown,
  fallback: Pick<SeriesPlan, 'premise' | 'genreMode'> & {
    audienceChannel: SeriesAudienceChannel;
    episodeCount: number;
    episodeDuration: number;
    sourcePremise?: string;
    conceptAnalysis?: SeriesConceptAnalysis;
    styleConfig?: string;
  },
): SeriesPlan {
  const wrapped = rawInput && typeof rawInput === 'object' && 'seriesPlan' in rawInput
    ? (rawInput as { seriesPlan?: unknown }).seriesPlan
    : rawInput;
  const raw = wrapped && typeof wrapped === 'object' ? wrapped as Record<string, unknown> : {};
  const genre = String(raw.genreMode ?? fallback.genreMode);
  const audienceChannel = String(raw.audienceChannel ?? fallback.audienceChannel);
  const characters = Array.isArray(raw.characters)
    ? raw.characters.map((item, index) => normalizeCharacter(item as Record<string, unknown>, index))
    : [];
  const productionAssets = Array.isArray(raw.productionAssets)
    ? raw.productionAssets
      .map((item, index) => normalizeProductionAsset(item as Record<string, unknown>, index))
      .filter((item) => item.name.trim())
    : [];
  const seasonRhythm = Array.isArray(raw.seasonRhythm)
    ? raw.seasonRhythm
      .map((item, index) => normalizeSeasonRhythmBeat(item as Record<string, unknown>, index))
      .filter((item) => item.role.trim() || item.coreTurn.trim() || item.payoffPromise.trim())
    : undefined;

  return {
    premise: String(raw.premise ?? fallback.premise),
    sourcePremise: String(raw.sourcePremise ?? fallback.sourcePremise ?? fallback.premise),
    conceptAnalysis: raw.conceptAnalysis && typeof raw.conceptAnalysis === 'object'
      ? normalizeConceptAnalysis(raw.conceptAnalysis)
      : fallback.conceptAnalysis,
    genreMode: GENRE_OPTIONS.some((item) => item.value === genre)
      ? genre as SeriesPlan['genreMode']
      : 'custom',
    audienceChannel: AUDIENCE_CHANNEL_OPTIONS.some((item) => item.value === audienceChannel)
      ? audienceChannel as SeriesAudienceChannel
      : DEFAULT_AUDIENCE_CHANNEL,
    tone: String(raw.tone ?? ''),
    styleConfig: resolveStep1StyleConfig(
      String(raw.styleConfig ?? fallback.styleConfig ?? ''),
      [
        String(raw.premise ?? fallback.premise),
        genre,
        String(raw.tone ?? ''),
        raw.conceptAnalysis ? JSON.stringify(raw.conceptAnalysis) : '',
      ].join('\n'),
    ),
    episodeCount: toBoundedInteger(raw.episodeCount, fallback.episodeCount, 3, 30),
    episodeDuration: toBoundedInteger(raw.episodeDuration, fallback.episodeDuration, 15, 180),
    characters,
    longRunningSecrets: toStringArray(raw.longRunningSecrets),
    recurringProps: toStringArray(raw.recurringProps),
    productionAssets,
    seasonRhythm,
    step0QualityReport: raw.step0QualityReport && typeof raw.step0QualityReport === 'object'
      ? normalizeStep0QualityReport(raw.step0QualityReport)
      : undefined,
    episodeCards: [],
    updatedAt: Date.now(),
  };
}

function mergeEpisodeCards(plan: SeriesPlan, rawInput: unknown): SeriesPlan {
  const raw = rawInput && typeof rawInput === 'object' ? rawInput as Record<string, unknown> : {};
  const rawCards = Array.isArray(raw.episodeCards) ? raw.episodeCards : [];
  const incomingSeasonRhythm = Array.isArray(raw.seasonRhythm)
    ? raw.seasonRhythm
      .map((item, index) => normalizeSeasonRhythmBeat(item as Record<string, unknown>, index))
      .filter((item) => item.role.trim() || item.coreTurn.trim() || item.payoffPromise.trim())
    : [];
  const incomingCards = rawCards.map((item, index) => normalizeEpisode(item as Record<string, unknown>, index));
  const incomingEpisodeNumbers = new Set(incomingCards.map((episode) => episode.episodeNumber));
  const incomingRhythmNumbers = new Set(incomingSeasonRhythm.map((beat) => beat.episodeNumber));
  const seasonRhythm = incomingSeasonRhythm.length > 0
    ? [
        ...(plan.seasonRhythm ?? []).filter((beat) => !incomingRhythmNumbers.has(beat.episodeNumber)),
        ...incomingSeasonRhythm,
      ].sort((a, b) => a.episodeNumber - b.episodeNumber)
    : plan.seasonRhythm;
  return {
    ...plan,
    seasonRhythm,
    episodeCards: [
      ...plan.episodeCards.filter((episode) => !incomingEpisodeNumbers.has(episode.episodeNumber)),
      ...incomingCards,
    ].sort((a, b) => a.episodeNumber - b.episodeNumber),
    updatedAt: Date.now(),
  };
}

function extractEpisodeCards(rawInput: unknown): SeriesEpisodeCard[] {
  const raw = rawInput && typeof rawInput === 'object' ? rawInput as Record<string, unknown> : {};
  const rawCards = Array.isArray(raw.episodeCards) ? raw.episodeCards : [];
  return rawCards.map((item, index) => normalizeEpisode(item as Record<string, unknown>, index));
}

function replaceEpisodeCard(plan: SeriesPlan, episode: SeriesEpisodeCard, replacement: SeriesEpisodeCard): SeriesPlan {
  return {
    ...plan,
    episodeCards: plan.episodeCards.map((item) =>
      item.id === episode.id
        ? {
            ...replacement,
            id: episode.id,
            episodeNumber: episode.episodeNumber,
            generatedScript: undefined,
            generatedAt: undefined,
          }
        : item,
    ),
    updatedAt: Date.now(),
  };
}

function formatEpisodeNumberList(numbers: number[]) {
  return numbers.sort((a, b) => a - b).join('、');
}

function getEpisodeNumberCoverage(
  cards: Array<Pick<SeriesEpisodeCard, 'episodeNumber'>>,
  start: number,
  end: number,
) {
  const expected = new Set(Array.from({ length: end - start + 1 }, (_, index) => start + index));
  const counts = new Map<number, number>();
  for (const card of cards) {
    counts.set(card.episodeNumber, (counts.get(card.episodeNumber) ?? 0) + 1);
  }

  const missing = Array.from(expected).filter((episodeNumber) => !counts.has(episodeNumber));
  const duplicate = Array.from(counts.entries())
    .filter(([episodeNumber, count]) => expected.has(episodeNumber) && count > 1)
    .map(([episodeNumber]) => episodeNumber);
  const extra = Array.from(counts.keys()).filter((episodeNumber) => !expected.has(episodeNumber));

  return { missing, duplicate, extra };
}

function assertEpisodeCardsCoverRange(
  cards: Array<Pick<SeriesEpisodeCard, 'episodeNumber'>>,
  start: number,
  end: number,
  label: string,
) {
  const { missing, duplicate, extra } = getEpisodeNumberCoverage(cards, start, end);
  const details = [
    missing.length > 0 ? `缺少第 ${formatEpisodeNumberList(missing)} 集` : '',
    duplicate.length > 0 ? `重复第 ${formatEpisodeNumberList(duplicate)} 集` : '',
    extra.length > 0 ? `包含范围外第 ${formatEpisodeNumberList(extra)} 集` : '',
  ].filter(Boolean);

  if (details.length > 0) {
    throw new Error(`${label}不完整：${details.join('；')}。请重新生成。`);
  }
}

function compactList(items: string[], fallback: string) {
  return items.length > 0 ? items.join(' / ') : fallback;
}

function compactReportList(items: string[], fallback: string) {
  return items.length > 0 ? items.slice(0, 5) : [fallback];
}

function getProductionAssetLabel(asset: SeriesProductionAsset): string {
  return PRODUCTION_ASSET_CATEGORY_LABELS[asset.category] ?? PRODUCTION_ASSET_CATEGORY_LABELS.other;
}

function getEpisodeTypeLabel(type: SeriesEpisodeType | undefined): string {
  return type ? EPISODE_TYPE_LABELS[type] : '未标记集型';
}

function getEpisodeAssetLabels(plan: SeriesPlan, episode: SeriesEpisodeCard): string[] {
  const byIdOrName = new Map<string, SeriesProductionAsset>();
  for (const asset of plan.productionAssets ?? []) {
    byIdOrName.set(asset.id, asset);
    byIdOrName.set(asset.name, asset);
  }
  return (episode.assetPlan ?? [])
    .map((idOrName) => {
      const asset = byIdOrName.get(idOrName);
      return asset ? asset.name : idOrName;
    })
    .filter(Boolean);
}

function getIssueEpisodeNumber(label: string): number | null {
  const match = label.match(/第(\d+)集/);
  if (!match) return null;
  const episodeNumber = Number(match[1]);
  return Number.isFinite(episodeNumber) ? episodeNumber : null;
}

interface SeriesDesignerProps {
  onOpenChapter?: () => void;
}

interface ConfirmActionDialogState {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
}

export function SeriesDesigner({ onOpenChapter }: SeriesDesignerProps) {
  const { state, dispatch, currentProject } = useCurrentProject();
  const { loading, error: apiError, streamText, callApiViaBff } = useApiCall({ stream: true });
  const {
    loading: memorySettling,
    streamText: memoryStreamText,
    callApiViaBff: callMemoryViaBff,
  } = useApiCall({ stream: true });
  const [activeTaskLabel, setActiveTaskLabel] = useState('');
  const [memoryTaskLabel, setMemoryTaskLabel] = useState('');
  const memoryQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [memoryQueueSize, setMemoryQueueSize] = useState(0);
  const [requestStartedAt, setRequestStartedAt] = useState<number | null>(null);
  const [requestElapsedSeconds, setRequestElapsedSeconds] = useState(0);
  const [premise, setPremise] = useState(currentProject?.seriesPlan?.premise ?? '');
  const [genreMode, setGenreMode] = useState<SeriesPlan['genreMode']>(
    currentProject?.seriesPlan?.genreMode ?? DEFAULT_GENRE_MODE,
  );
  const [audienceChannel, setAudienceChannel] = useState<SeriesAudienceChannel>(
    currentProject?.seriesPlan?.audienceChannel ?? DEFAULT_AUDIENCE_CHANNEL,
  );
  const [episodeCount, setEpisodeCount] = useState(() => {
    const plannedCount = currentProject?.seriesPlan?.episodeCount ?? currentProject?.seriesPlan?.episodeCards.length ?? 0;
    return plannedCount > 0 ? plannedCount : 12;
  });
  const [episodeDuration, setEpisodeDuration] = useState(
    currentProject?.seriesPlan?.episodeDuration ?? DEFAULT_SERIES_EPISODE_DURATION,
  );
  const [episodeCountInput, setEpisodeCountInput] = useState(() => toIntegerDraft(episodeCount));
  const [episodeDurationInput, setEpisodeDurationInput] = useState(() => toIntegerDraft(episodeDuration));
  const [pendingConceptAnalysis, setPendingConceptAnalysis] = useState<SeriesConceptAnalysis | undefined>(
    currentProject?.seriesPlan?.conceptAnalysis,
  );
  const [pendingConceptPremise, setPendingConceptPremise] = useState(
    currentProject?.seriesPlan?.sourcePremise ?? currentProject?.seriesPlan?.premise ?? '',
  );
  const [conceptReportOpen, setConceptReportOpen] = useState(false);
  const [confirmActionDialog, setConfirmActionDialog] = useState<ConfirmActionDialogState | null>(null);
  const confirmActionRef = useRef<(() => void | Promise<void>) | null>(null);
  const [step1EntryDialog, setStep1EntryDialog] = useState<Step1EntryDialogState | null>(null);
  const [step1EntryConfirming, setStep1EntryConfirming] = useState(false);
  const seriesPlan = currentProject?.seriesPlan;
  const seriesRuntime = currentProject?.seriesRuntime;
  const hasApiKey = !!state.apiConfig.apiKey.trim();
  const isPremiseDetachedFromPlan = !!seriesPlan
    && normalizePremiseForCompare(premise) !== normalizePremiseForCompare(seriesPlan.premise);
  const currentSeriesPlan = isPremiseDetachedFromPlan ? undefined : seriesPlan;
  const currentSeriesRuntime = currentSeriesPlan ? seriesRuntime : undefined;
  const hasCurrentSeriesPlan = !!currentSeriesPlan;
  const currentConceptAnalysis = currentSeriesPlan?.conceptAnalysis;
  const premiseCompareKey = normalizePremiseForCompare(premise);
  const pendingConceptMatchesPremise = hasUsefulConceptAnalysis(pendingConceptAnalysis)
    && normalizePremiseForCompare(pendingConceptPremise) === premiseCompareKey;
  const rawEffectiveConceptAnalysis = hasUsefulConceptAnalysis(currentConceptAnalysis)
    ? currentConceptAnalysis
    : pendingConceptMatchesPremise
      ? pendingConceptAnalysis
      : undefined;
  const effectiveConceptAnalysis = useMemo(
    () => (rawEffectiveConceptAnalysis ? normalizeConceptAnalysis(rawEffectiveConceptAnalysis) : undefined),
    [rawEffectiveConceptAnalysis],
  );
  const hasEffectiveConceptAnalysis = hasUsefulConceptAnalysis(effectiveConceptAnalysis);
  const conceptAnalysisIsMissing = !effectiveConceptAnalysis;
  const canPolishPremise = premise.trim().length >= 2 && !loading;
  const inputHints = useMemo(() => inferSeriesInputHints(premise), [premise]);
  const targetGenreMode = inputHints?.recommendedGenreMode ?? genreMode;
  const targetAudienceChannel = inputHints?.recommendedAudienceChannel ?? audienceChannel;
  const targetStoryEngine = inputHints?.storyEngineCandidate
    ?? effectiveConceptAnalysis?.coreStoryEngine
    ?? effectiveConceptAnalysis?.conceptLogline
    ?? '等待构思理解报告锁定故事发动机';
  const shouldShowTaoistAnchors = !!inputHints
    || genreMode === 'mystic_fengshui'
    || effectiveConceptAnalysis?.recommendedGenreMode === 'mystic_fengshui';

  useEffect(() => {
    if (seriesPlan) {
      setPremise(seriesPlan.premise);
      setGenreMode(seriesPlan.genreMode);
      setAudienceChannel(seriesPlan.audienceChannel ?? DEFAULT_AUDIENCE_CHANNEL);
      setEpisodeCount(seriesPlan.episodeCount ?? (seriesPlan.episodeCards.length || 12));
      setEpisodeDuration(seriesPlan.episodeDuration ?? DEFAULT_SERIES_EPISODE_DURATION);
      setPendingConceptAnalysis(seriesPlan.conceptAnalysis);
      setPendingConceptPremise(seriesPlan.sourcePremise ?? seriesPlan.premise);
      return;
    }

    setPremise('');
    setGenreMode(DEFAULT_GENRE_MODE);
    setAudienceChannel(DEFAULT_AUDIENCE_CHANNEL);
    setEpisodeCount(12);
    setEpisodeDuration(DEFAULT_SERIES_EPISODE_DURATION);
    setPendingConceptAnalysis(undefined);
    setPendingConceptPremise('');
  }, [currentProject?.id, seriesPlan]);

  useEffect(() => {
    setEpisodeCountInput(toIntegerDraft(episodeCount));
  }, [episodeCount]);

  useEffect(() => {
    setEpisodeDurationInput(toIntegerDraft(episodeDuration));
  }, [episodeDuration]);

  const handleEpisodeCountInputChange = useCallback((value: string) => {
    const draft = value.replace(/\D/g, '');
    setEpisodeCountInput(draft);
    const parsed = getDraftInteger(draft);
    if (parsed !== null && parsed >= 3 && parsed <= 30) {
      setEpisodeCount(parsed);
    }
  }, []);

  const commitEpisodeCountInput = useCallback(() => {
    const parsed = getDraftInteger(episodeCountInput);
    const next = parsed === null ? episodeCount : Math.max(3, Math.min(30, parsed));
    setEpisodeCount(next);
    setEpisodeCountInput(toIntegerDraft(next));
  }, [episodeCount, episodeCountInput]);

  const handleEpisodeDurationInputChange = useCallback((value: string) => {
    const draft = value.replace(/\D/g, '');
    setEpisodeDurationInput(draft);
    const parsed = getDraftInteger(draft);
    if (parsed !== null && parsed >= 15 && parsed <= 180) {
      setEpisodeDuration(parsed);
    }
  }, []);

  const commitEpisodeDurationInput = useCallback(() => {
    const parsed = getDraftInteger(episodeDurationInput);
    const next = parsed === null ? episodeDuration : Math.max(15, Math.min(180, parsed));
    setEpisodeDuration(next);
    setEpisodeDurationInput(toIntegerDraft(next));
  }, [episodeDuration, episodeDurationInput]);

  useEffect(() => {
    if (!inputHints || seriesPlan) return;
    if (genreMode === DEFAULT_GENRE_MODE && inputHints.recommendedGenreMode) {
      setGenreMode(inputHints.recommendedGenreMode);
    }
    if (audienceChannel === DEFAULT_AUDIENCE_CHANNEL && inputHints.recommendedAudienceChannel) {
      setAudienceChannel(inputHints.recommendedAudienceChannel);
    }
  }, [audienceChannel, genreMode, inputHints, seriesPlan]);

  const generatedScriptCount = currentSeriesPlan?.episodeCards.filter((episode) => !!episode.generatedScript?.trim()).length ?? 0;
  const settledEpisodeCount = currentSeriesRuntime?.episodeSummaries.length ?? 0;
  const activeHookCount = currentSeriesRuntime?.hookLedger.filter((hook) => hook.status !== 'resolved' && hook.status !== 'dropped').length ?? 0;
  const propCount = currentSeriesRuntime?.propLedger.length ?? 0;
  const currentProductionAssets = currentSeriesPlan?.productionAssets ?? [];
  const productionAssetCount = currentProductionAssets.length;
  const adHocAssetCount = currentSeriesPlan?.episodeCards.reduce((total, episode) => total + (episode.adHocAssets?.length ?? 0), 0) ?? 0;
  const currentSeasonRhythm = currentSeriesPlan?.seasonRhythm ?? [];
  const step0QualityReport = currentSeriesPlan?.step0QualityReport;
  const step0QualityIssueCount = step0QualityReport
    ? step0QualityReport.bibleIssues.length
      + step0QualityReport.assetIssues.length
      + step0QualityReport.rhythmIssues.length
      + step0QualityReport.cardIssues.length
    : 0;
  const hasEpisodeCards = (currentSeriesPlan?.episodeCards.length ?? 0) > 0;
  const hasGeneratedSeriesMaterial = !!currentSeriesPlan
    && (currentSeriesPlan.characters.length > 0 || hasEpisodeCards || generatedScriptCount > 0);
  const hasFastLineOutput = hasEpisodeCards || generatedScriptCount > 0;
  const runtimeEpisodeNumber = Math.max(
    1,
    ...(currentSeriesRuntime?.episodeSummaries.map((summary) => summary.episodeNumber + 1) ?? []),
    ...(currentSeriesPlan?.episodeCards.filter((episode) => episode.generatedScript?.trim()).map((episode) => episode.episodeNumber) ?? []),
  );
  const canGenerateBible = premise.trim().length >= 6 && hasEffectiveConceptAnalysis && !loading;
  const canGenerateCards = hasCurrentSeriesPlan && hasUsefulConceptAnalysis(currentSeriesPlan?.conceptAnalysis) && !loading;
  const targetEpisodeCount = Math.max(3, Math.min(30, Math.round(episodeCount)));
  const generatedEpisodeCardCount = currentSeriesPlan?.episodeCards.length ?? 0;
  const missingEpisodeNumbers = currentSeriesPlan
    ? Array.from({ length: targetEpisodeCount }, (_, index) => index + 1)
      .filter((episodeNumber) => !currentSeriesPlan.episodeCards.some((episode) => episode.episodeNumber === episodeNumber))
    : [];
  const firstMissingEpisodeNumber = missingEpisodeNumbers[0] ?? null;
  const hasMissingEpisodeCards = firstMissingEpisodeNumber !== null;
  const episodeCardsActionLabel = hasMissingEpisodeCards
    ? generatedEpisodeCardCount > 0
      ? `补齐整季 ${firstMissingEpisodeNumber}-${targetEpisodeCount}`
      : '生成分集爽点卡'
    : generatedEpisodeCardCount > 0
      ? '重新生成集卡'
      : '生成分集爽点卡';
  const shouldPrioritizeBible = !currentSeriesPlan || conceptAnalysisIsMissing;
  const shouldPrioritizeCards = !!currentSeriesPlan
    && hasUsefulConceptAnalysis(currentSeriesPlan.conceptAnalysis)
    && currentSeriesPlan.episodeCards.length === 0;
  const inputStatusMessage = isPremiseDetachedFromPlan
    ? '当前结果基于旧点子，修改后需重新分析构思、生成人设圣经和分集卡。'
    : currentSeriesPlan
      ? effectiveConceptAnalysis
        ? generatedEpisodeCardCount > 0 && hasMissingEpisodeCards
          ? `当前点子已完成构思理解和人设圣经，可继续补齐第 ${firstMissingEpisodeNumber}-${targetEpisodeCount} 集卡。`
          : hasMissingEpisodeCards
            ? '当前点子已完成构思理解和人设圣经，可继续生成分集爽点卡。'
            : '当前点子已完成构思理解和人设圣经，可继续生成单集稿或重做集卡。'
        : '当前项目来自旧链路，建议先补一次构思理解，再继续生成分集爽点卡。'
      : effectiveConceptAnalysis
        ? '构思理解已完成。下一步生成人设圣经时会严格继承这份报告。'
        : '先写点子，再分析构思，最后生成可连续生产的系列策划。';
  const workflowSteps = useMemo(() => {
    const hasPremise = premise.trim().length >= 6;
    const hasConcept = hasUsefulConceptAnalysis(effectiveConceptAnalysis);
    const hasBible = hasCurrentSeriesPlan && (currentSeriesPlan?.characters.length ?? 0) > 0;
    const hasCards = hasCurrentSeriesPlan && hasEpisodeCards;
    const hasScripts = hasCurrentSeriesPlan && generatedScriptCount > 0;

    return [
      {
        label: '点子',
        value: hasPremise ? '已输入' : '待输入',
        done: hasPremise,
        current: !hasPremise,
      },
      {
        label: '构思理解',
        value: hasConcept ? '已分析' : '待分析',
        done: hasConcept,
        current: hasPremise && !hasConcept,
      },
      {
        label: '人设',
        value: hasBible ? `${currentSeriesPlan?.characters.length ?? 0} 人` : '待生成',
        done: hasBible,
        current: hasConcept && !hasBible,
      },
      {
        label: '集卡',
        value: hasCards ? `${currentSeriesPlan?.episodeCards.length ?? 0} 集` : '待生成',
        done: hasCards,
        current: hasBible && !hasCards,
      },
      {
        label: '稿件',
        value: hasScripts ? `${generatedScriptCount} 集` : '待出稿',
        done: hasScripts,
        current: hasCards && !hasScripts,
      },
    ];
  }, [currentSeriesPlan, effectiveConceptAnalysis, generatedScriptCount, hasCurrentSeriesPlan, hasEpisodeCards, premise]);
  const canAnalyzeConcept = premise.trim().length >= 6 && !loading;
  const canGenerateFirstEpisodeFast = premise.trim().length >= 6 && !loading && !hasFastLineOutput;
  const conceptButtonTitle = loading
    ? '正在生成，请稍候'
    : premise.trim().length < 6
      ? '请先输入至少 6 个字的系列点子'
      : !hasApiKey
        ? '缺少 API Key，点击后会打开 API 设置'
        : hasUsefulConceptAnalysis(effectiveConceptAnalysis)
          ? '按当前点子重新分析构思理解'
          : '先读懂长点子的故事发动机';
  const bibleButtonTitle = loading
    ? '正在生成，请稍候'
    : premise.trim().length < 6
      ? '请先输入至少 6 个字的系列点子'
      : !hasApiKey
        ? '缺少 API Key，点击后会打开 API 设置'
        : '先分析构思，再生成人设圣经';
  const polishButtonTitle = loading
    ? '正在生成，请稍候'
    : premise.trim().length < 2
      ? '先写几个短点子，再润色成长点子'
      : !hasApiKey
        ? '缺少 API Key，点击后会打开 API 设置'
        : '把零散短点子串成可生成的长点子';
  const cardsButtonTitle = loading
    ? '正在生成，请稍候'
    : !seriesPlan || isPremiseDetachedFromPlan
      ? '当前点子已改，请先分析构思并生成人设圣经'
      : !hasUsefulConceptAnalysis(seriesPlan.conceptAnalysis)
        ? '当前项目缺少构思理解，请先补分析'
        : hasMissingEpisodeCards
          ? generatedEpisodeCardCount > 0
            ? `继续生成第 ${firstMissingEpisodeNumber}-${targetEpisodeCount} 集卡，保留已生成集卡并补齐目标集数`
            : `生成第 1-${targetEpisodeCount} 集分集爽点卡`
          : '当前目标集卡已齐，点击会按当前人设圣经重新生成整套分集爽点卡';
  const firstEpisodeFastTitle = loading
    ? '正在生成，请稍候'
    : premise.trim().length < 6
      ? '请先输入至少 6 个字的系列点子'
      : !hasApiKey
        ? '缺少 API Key，点击后会打开 API 设置'
        : hasFastLineOutput
          ? '当前已有集卡或剧本，首集快线已锁定；请用补齐整季或单集按钮继续'
          : '先生成第 1-4 集卡并立刻写第 1 集剧本，5-12 集稍后补齐';
  const regenerateCardsTitle = loading
    ? '正在生成，请稍候'
    : cardsButtonTitle;
  const activeStageButtonClass = 'border-brand-orange/70 bg-brand-orange text-white shadow-[0_0_0_3px_rgba(255,112,67,0.18)] hover:bg-brand-orange/90 dark:text-white';
  const shouldHighlightConceptAction = conceptAnalysisIsMissing && canAnalyzeConcept;
  const shouldHighlightBibleAction = !conceptAnalysisIsMissing && shouldPrioritizeBible && canGenerateBible;
  const shouldHighlightCardsAction = canGenerateCards && (shouldPrioritizeCards || hasMissingEpisodeCards);
  const nextScriptEpisodeNumber = !hasMissingEpisodeCards
    ? currentSeriesPlan?.episodeCards.find((episode) => !episode.generatedScript?.trim())?.episodeNumber ?? null
    : null;
  const streamPreviewText = streamText.trim();
  const generationProgressText = loading
    ? streamPreviewText
      ? `流式输出中，已收到 ${streamPreviewText.length} 字；仅连续 ${SERIES_LLM_REQUEST_TIMEOUT_SECONDS} 秒没有新输出或思考活动才会超时。`
      : requestStartedAt
        ? `模型正在准备输出，已等待 ${requestElapsedSeconds} 秒；连续 ${SERIES_LLM_REQUEST_TIMEOUT_SECONDS} 秒没有上游活动才会超时。`
        : '请求已发出，正在等待模型返回。'
    : apiError;
  const memoryStreamPreviewText = memoryStreamText.trim();
  const memoryProgressText = memorySettling || memoryQueueSize > 0
    ? memoryStreamPreviewText
      ? `后台沉淀中，已收到 ${memoryStreamPreviewText.length} 字；仅连续 ${SERIES_LLM_REQUEST_TIMEOUT_SECONDS} 秒没有新输出或思考活动才会超时。${memoryQueueSize > 1 ? ` 后面还有 ${memoryQueueSize - 1} 个沉淀任务排队。` : ''}`
      : memoryQueueSize > 1
        ? `后台记忆沉淀正在排队执行；当前共 ${memoryQueueSize} 个任务，不会阻塞进入 Step1。`
        : `后台正在等待模型活动；这一步不会阻塞进入 Step1，连续 ${SERIES_LLM_REQUEST_TIMEOUT_SECONDS} 秒无活动才会超时。`
    : '';
  const seriesEmptyStateMessage = loading
    ? `${activeTaskLabel || '正在生成系列策划'}，完成后会自动更新这里。`
    : hasEffectiveConceptAnalysis
      ? '构思理解已完成。下一步请生成人设圣经，再生成分集爽点卡。'
      : isPremiseDetachedFromPlan
        ? '当前点子已改。请先重新分析构思，再生成人设圣经和分集爽点卡。'
        : '当前还没有系列策划。输入一个系列点子后，先分析构思，再生成人设圣经和分集爽点卡。';
  const planIssues = useMemo(
    () => (currentSeriesPlan ? findSeriesPlanQualityIssues(currentSeriesPlan) : []),
    [currentSeriesPlan],
  );
  const step0QualityReportIsStale = useMemo(() => {
    if (!currentSeriesPlan || !step0QualityReport || step0QualityReport.riskLevel !== 'high') return false;
    if (!hasEpisodeCards || planIssues.length > 0 || (currentSeriesPlan.seasonRhythm?.length ?? 0) === 0) return false;
    return isStaleMissingStructureStep0Report(step0QualityReport);
  }, [currentSeriesPlan, hasEpisodeCards, planIssues, step0QualityReport]);
  const runtimeIssues = useMemo(
    () => findSeriesRuntimeQualityIssues(currentSeriesRuntime, runtimeEpisodeNumber),
    [currentSeriesRuntime, runtimeEpisodeNumber],
  );
  const firstIssueByEpisode = useMemo(() => {
    const seen = new Set<number>();
    return new Set(planIssues.map((issue) => {
      const episodeNumber = getIssueEpisodeNumber(issue.label);
      if (!episodeNumber || seen.has(episodeNumber)) return null;
      seen.add(episodeNumber);
      return issue.label;
    }).filter(Boolean));
  }, [planIssues]);

  const guardApiKey = useCallback(() => {
    if (hasApiKey) return true;
    toast.error('请先配置对话模型 API Key');
    openApiSettings();
    return false;
  }, [hasApiKey]);

  const setSeriesRuntime = useCallback((runtime: SeriesRuntimeState) => {
    dispatch({ type: 'SET_SERIES_RUNTIME', runtime });
  }, [dispatch]);

  useEffect(() => {
    if (!loading || !requestStartedAt) {
      setRequestElapsedSeconds(0);
      return undefined;
    }

    const updateElapsed = () => {
      setRequestElapsedSeconds(Math.max(0, Math.floor((Date.now() - requestStartedAt) / 1000)));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [loading, requestStartedAt]);

  const runWithTaskLabel = useCallback(async <T,>(label: string, task: () => Promise<T>): Promise<T> => {
    setActiveTaskLabel(label);
    setRequestStartedAt(Date.now());
    try {
      return await task();
    } finally {
      setActiveTaskLabel('');
      setRequestStartedAt(null);
    }
  }, []);

  const handleCurrentFocusChange = useCallback((value: string) => {
    const nextRuntime = normalizeSeriesRuntime({
      ...(seriesRuntime ?? createEmptySeriesRuntime()),
      currentFocus: value,
      updatedAt: Date.now(),
    }, seriesRuntime);
    setSeriesRuntime(nextRuntime);
  }, [seriesRuntime, setSeriesRuntime]);

  const handlePremiseChange = useCallback((value: string) => {
    const wasUsingSavedPremise = !!seriesPlan
      && normalizePremiseForCompare(premise) === normalizePremiseForCompare(seriesPlan.premise);
    const willUseSavedPremise = !!seriesPlan
      && normalizePremiseForCompare(value) === normalizePremiseForCompare(seriesPlan.premise);

    setPremise(value);
    if (normalizePremiseForCompare(value) !== normalizePremiseForCompare(pendingConceptPremise)) {
      setPendingConceptAnalysis(undefined);
      setPendingConceptPremise('');
    }

    if (!seriesPlan) return;
    if (wasUsingSavedPremise && !willUseSavedPremise) {
      setGenreMode(DEFAULT_GENRE_MODE);
      setAudienceChannel(DEFAULT_AUDIENCE_CHANNEL);
      return;
    }
    if (!wasUsingSavedPremise && willUseSavedPremise) {
      setGenreMode(seriesPlan.genreMode);
      setAudienceChannel(seriesPlan.audienceChannel ?? DEFAULT_AUDIENCE_CHANNEL);
    }
  }, [pendingConceptPremise, premise, seriesPlan]);

  const analyzeConceptForPremise = useCallback(async (sourcePremise: string): Promise<SeriesConceptAnalysis> => {
    const response = await runWithTaskLabel('正在分析系列构思', () => callApiViaBff(state.apiConfig, [{
      role: 'user',
      content: buildSeriesConceptAnalyzeUserPrompt({
        premise: sourcePremise,
        genreMode,
        audienceChannel,
        episodeCount,
      }),
      }], {
        templateType: 'series_concept_analyze',
      }, {
        temperature: 0.25,
        maxTokens: 4000,
        reasoningEffort: SERIES_REASONING_EFFORT.creative,
        stream: true,
      }));
    const analysis = normalizeConceptAnalysis(extractJsonObject(response));
    if (!hasUsefulConceptAnalysis(analysis)) {
      throw new Error('构思理解报告为空，请重试或补充更明确的点子。');
    }
    return analysis;
  }, [audienceChannel, callApiViaBff, episodeCount, genreMode, runWithTaskLabel, state.apiConfig]);

  const handleAnalyzeConcept = useCallback(async () => {
    if (!canAnalyzeConcept || !guardApiKey()) return;
    const sourcePremise = premise.trim();
    try {
      const analysis = await analyzeConceptForPremise(sourcePremise);
      setPendingConceptAnalysis(analysis);
      setPendingConceptPremise(sourcePremise);
      if (seriesPlan && !isPremiseDetachedFromPlan) {
        dispatch({
          type: 'SET_SERIES_PLAN',
          plan: {
            ...seriesPlan,
            sourcePremise,
            conceptAnalysis: analysis,
            updatedAt: Date.now(),
          },
        });
      }
      toast.success('构思理解已完成');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '构思理解失败');
    }
  }, [analyzeConceptForPremise, canAnalyzeConcept, dispatch, guardApiKey, isPremiseDetachedFromPlan, premise, seriesPlan]);

  const checkConceptAlignment = useCallback(async (
    sourcePremise: string,
    conceptAnalysis: SeriesConceptAnalysis,
    target: unknown,
    targetType: 'bible' | 'cards',
  ): Promise<SeriesConceptAlignmentReport | null> => {
    try {
      const response = await runWithTaskLabel(
        targetType === 'bible' ? '正在检查人设是否跑偏' : '正在检查集卡是否跑偏',
        () => callApiViaBff(state.apiConfig, [{
          role: 'user',
          content: buildSeriesConceptAlignmentCheckUserPrompt({
            premise: sourcePremise,
            conceptAnalysis,
            target,
            targetType,
          }),
        }], {
          templateType: 'series_concept_alignment_check',
        }, {
          temperature: 0.1,
          maxTokens: 1800,
          reasoningEffort: SERIES_REASONING_EFFORT.check,
          stream: true,
        }),
      );
      return normalizeConceptAlignmentReport(extractJsonObject(response));
    } catch (err) {
      toast.warning(err instanceof Error ? `构思继承检查未完成：${err.message}` : '构思继承检查未完成');
      return null;
    }
  }, [callApiViaBff, runWithTaskLabel, state.apiConfig]);

  const checkStep0Quality = useCallback(async (
    plan: SeriesPlan,
    stage: SeriesStep0QualityStage = 'final',
    promptEpisodeCount?: number,
  ): Promise<SeriesStep0QualityReport | null> => {
    try {
      const response = await runWithTaskLabel('正在检查 Step0 质量', () => callApiViaBff(state.apiConfig, [{
        role: 'user',
        content: buildSeriesStep0QualityCheckUserPrompt({
          premise: plan.sourcePremise ?? plan.premise,
          seriesPlan: plan,
          episodeCount: promptEpisodeCount ?? plan.episodeCount ?? episodeCount,
          stage,
        }),
      }], {
        templateType: 'series_step0_quality_check',
      }, {
        temperature: 0.1,
        maxTokens: 2400,
        reasoningEffort: SERIES_REASONING_EFFORT.check,
        stream: true,
      }));
      return normalizeStep0QualityReport(extractJsonObject(response));
    } catch (err) {
      toast.warning(err instanceof Error ? `Step0 质量检查未完成：${err.message}` : 'Step0 质量检查未完成');
      return null;
    }
  }, [callApiViaBff, episodeCount, runWithTaskLabel, state.apiConfig]);

  const repairStep0Cards = useCallback(async (
    plan: SeriesPlan,
    qualityReport: SeriesStep0QualityReport,
    repairScope?: SeriesStep0RepairScope,
  ): Promise<SeriesPlan | null> => {
    try {
      const response = await runWithTaskLabel('正在按质量建议修复集卡', () => callApiViaBff(state.apiConfig, [{
        role: 'user',
        content: buildSeriesStep0QualityRepairUserPrompt({
          seriesPlan: plan,
          qualityReport,
          repairScope,
        }),
      }], {
        templateType: 'series_step0_quality_repair',
      }, {
        temperature: 0.22,
        maxTokens: 12000,
        reasoningEffort: SERIES_REASONING_EFFORT.repair,
        stream: true,
      }));
      const patchPayload = extractJsonObject(response);
      const patchRecord = patchPayload && typeof patchPayload === 'object'
        ? patchPayload as { seasonRhythm?: unknown }
        : {};
      const repairedPlan = mergeEpisodeCards(plan, patchPayload);
      const targetStart = repairScope?.episodeRange?.start ?? 1;
      const targetEnd = repairScope?.episodeRange?.end
        ?? Math.max(targetStart, Math.min(
          Math.max(3, Math.min(30, Math.round(plan.episodeCount ?? episodeCount))),
          targetStart + EPISODE_CARD_BATCH_SIZE - 1,
        ));
      if (extractEpisodeCards(patchPayload).length > 0) {
        assertEpisodeCardsCoverRange(repairedPlan.episodeCards, targetStart, targetEnd, '修复后的局部分集爽点卡');
      }
      if (Array.isArray(patchRecord.seasonRhythm) && Array.isArray(repairedPlan.seasonRhythm)) {
        assertEpisodeCardsCoverRange(repairedPlan.seasonRhythm, targetStart, targetEnd, '修复后的局部整季节奏表');
      }
      return {
        ...repairedPlan,
        step0QualityReport: undefined,
      };
    } catch (err) {
      toast.warning(err instanceof Error ? `自动修复未完成：${err.message}` : '自动修复未完成');
      return null;
    }
  }, [callApiViaBff, episodeCount, runWithTaskLabel, state.apiConfig]);

  const settleEpisodeMemory = useCallback(async (
    episode: SeriesEpisodeCard,
    script: string,
    planOverride?: SeriesPlan,
    options: SettleEpisodeMemoryOptions = {},
  ) => {
    const planForPrompt = planOverride ?? seriesPlan;
    if (!planForPrompt) return;
    const label = `正在沉淀第${episode.episodeNumber}集连续性记忆`;
    const runSettle = (caller: typeof callApiViaBff) => {
      return caller(state.apiConfig, [{
        role: 'user',
        content: buildSeriesEpisodeSettleUserPrompt({
          seriesPlan: planForPrompt,
          seriesRuntime,
          episodeCard: episode,
          scriptText: script,
        }),
      }], {
        templateType: 'series_episode_settle',
      }, {
        temperature: 0.15,
        maxTokens: 4500,
        reasoningEffort: SERIES_REASONING_EFFORT.check,
        stream: true,
      });
    };

    const finalizeSettle = (response: string) => {
      const nextRuntime = normalizeSeriesRuntime(extractJsonObject(response), seriesRuntime);
      setSeriesRuntime(nextRuntime);
      if (options.notify) {
        toast.success(`第${episode.episodeNumber}集连续性记忆已更新`);
      }
    };

    if (options.background) {
      setMemoryQueueSize((count) => count + 1);
      const queuedTask = memoryQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          setMemoryTaskLabel(label);
          try {
            const response = await runSettle(callMemoryViaBff);
            finalizeSettle(response);
          } finally {
            setMemoryTaskLabel('');
            setMemoryQueueSize((count) => Math.max(0, count - 1));
          }
        });
      memoryQueueRef.current = queuedTask.catch(() => undefined);
      return queuedTask;
    }

    const response = options.background
      ? await runSettle(callMemoryViaBff)
      : await runWithTaskLabel(label, () => runSettle(callApiViaBff));
    finalizeSettle(response);
  }, [callApiViaBff, callMemoryViaBff, runWithTaskLabel, seriesPlan, seriesRuntime, setSeriesRuntime, state.apiConfig]);

  const repairEpisodeScript = useCallback(async (
    episode: SeriesEpisodeCard,
    scriptText: string,
    qualityIssues: ReturnType<typeof findEpisodeScriptQualityIssues>,
    planOverride?: SeriesPlan,
  ) => {
    const planForPrompt = planOverride ?? seriesPlan;
    if (!planForPrompt) return null;
    const response = await runWithTaskLabel(`正在修复第${episode.episodeNumber}集剧本`, () => callApiViaBff(state.apiConfig, [{
      role: 'user',
      content: buildSeriesEpisodeScriptRepairUserPrompt({
        seriesPlan: planForPrompt,
        episodeCard: episode,
        episodeDuration,
        scriptText,
        qualityIssues,
      }),
    }], {
      templateType: 'series_episode_script_repair',
    }, {
      temperature: 0.22,
      maxTokens: 12000,
      reasoningEffort: SERIES_REASONING_EFFORT.repair,
    }));

    const repairedScript = stabilizeGeneratedEpisodeScript(response);
    return repairedScript || null;
  }, [callApiViaBff, episodeDuration, runWithTaskLabel, seriesPlan, state.apiConfig]);

  const handlePolishPremise = useCallback(async () => {
    if (!canPolishPremise || !guardApiKey()) return;
    try {
      const response = await runWithTaskLabel('正在润色系列点子', () => callApiViaBff(state.apiConfig, [{
        role: 'user',
        content: buildSeriesPremisePolishUserPrompt({
          premise: premise.trim(),
          genreMode,
          audienceChannel,
        }),
      }], {
        templateType: 'series_premise_polish',
      }, {
        temperature: 0.45,
        maxTokens: 1200,
        reasoningEffort: SERIES_REASONING_EFFORT.creative,
      }));

      const polished = response
        .trim()
        .replace(/^```(?:text|markdown)?\s*/i, '')
        .replace(/```$/i, '')
        .trim();
      if (!polished) {
        throw new Error('模型没有返回润色后的点子');
      }
      handlePremiseChange(polished);
      toast.success('点子已润色成长点子');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '点子润色失败');
    }
  }, [audienceChannel, callApiViaBff, canPolishPremise, genreMode, guardApiKey, handlePremiseChange, premise, runWithTaskLabel, state.apiConfig]);

  const handleGenerateBible = useCallback(async () => {
    if (!canGenerateBible || !guardApiKey()) return;
    const sourcePremise = premise.trim();
    try {
      const conceptAnalysis = hasUsefulConceptAnalysis(effectiveConceptAnalysis)
        ? effectiveConceptAnalysis
        : await analyzeConceptForPremise(sourcePremise);
      setPendingConceptAnalysis(conceptAnalysis);
      setPendingConceptPremise(sourcePremise);

      const response = await runWithTaskLabel('正在生成人设圣经', () => callApiViaBff(state.apiConfig, [{
        role: 'user',
        content: buildSeriesBibleUserPrompt({
          premise: sourcePremise,
          genreMode,
          audienceChannel,
          episodeCount,
          conceptAnalysis,
        }),
      }], {
        templateType: 'series_bible_generate',
      }, {
        temperature: 0.35,
        maxTokens: 7000,
        reasoningEffort: SERIES_REASONING_EFFORT.creative,
        stream: true,
      }));

      const parsed = extractJsonObject(response);
      const plan = {
        ...normalizeSeriesPlan(parsed, {
          premise: sourcePremise,
          sourcePremise,
          conceptAnalysis,
          genreMode,
          audienceChannel,
          episodeCount,
          episodeDuration,
        }),
        premise: sourcePremise,
        sourcePremise,
        conceptAnalysis,
      };
      const qualityReport = await checkStep0Quality(plan, 'bible');
      const planWithQuality = qualityReport
        ? { ...plan, step0QualityReport: qualityReport }
        : plan;
      dispatch({ type: 'SET_SERIES_PLAN', plan: planWithQuality, resetSeriesRuntime: true });
      const alignment = await checkConceptAlignment(sourcePremise, conceptAnalysis, plan, 'bible');
      if (qualityReport && (!qualityReport.ok || qualityReport.riskLevel !== 'low')) {
        const reasons = [
          ...qualityReport.bibleIssues,
          ...qualityReport.assetIssues,
        ].slice(0, 2).join('；');
        toast.warning(reasons ? `人设圣经需要补强：${reasons}` : '人设圣经需要补强，建议按质量提示重生。');
      } else if (alignment && (!alignment.aligned || alignment.riskLevel !== 'low')) {
        const reasons = [...alignment.missingMustKeep, ...alignment.driftRisks].slice(0, 2).join('；');
        toast.warning(reasons ? `人设圣经有跑偏风险：${reasons}` : '人设圣经有跑偏风险，建议重新生成。');
      } else {
        toast.success('系列人设已生成');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '系列人设生成失败');
    }
  }, [analyzeConceptForPremise, audienceChannel, callApiViaBff, canGenerateBible, checkConceptAlignment, checkStep0Quality, dispatch, effectiveConceptAnalysis, episodeCount, episodeDuration, genreMode, guardApiKey, premise, runWithTaskLabel, state.apiConfig]);

  const handleGenerateCards = useCallback(async () => {
    if (!seriesPlan || isPremiseDetachedFromPlan || !canGenerateCards || !guardApiKey()) return;
    const conceptAnalysis = seriesPlan.conceptAnalysis;
    if (!hasUsefulConceptAnalysis(conceptAnalysis)) {
      toast.error('请先完成构思理解，再生成分集爽点卡');
      return;
    }
    try {
      const targetCount = Math.max(3, Math.min(30, Math.round(episodeCount)));
      const existingEpisodeNumbers = new Set(seriesPlan.episodeCards.map((episode) => episode.episodeNumber));
      const firstMissingEpisode = Array.from({ length: targetCount }, (_, index) => index + 1)
        .find((episodeNumber) => !existingEpisodeNumbers.has(episodeNumber));
      const generationStart = firstMissingEpisode ?? 1;
      let generatedPlan: SeriesPlan = {
        ...seriesPlan,
        episodeCards: firstMissingEpisode ? seriesPlan.episodeCards : [],
        seasonRhythm: firstMissingEpisode ? seriesPlan.seasonRhythm ?? [] : [],
        episodeCount: targetCount,
        episodeDuration,
      };
      let repairedAnyBatch = false;
      for (let start = generationStart; start <= targetCount; start += EPISODE_CARD_BATCH_SIZE) {
        const end = Math.min(targetCount, start + EPISODE_CARD_BATCH_SIZE - 1);
        const response = await runWithTaskLabel(`正在生成第${start}-${end}集爽点卡`, () => callApiViaBff(state.apiConfig, [{
          role: 'user',
          content: buildSeriesEpisodeCardsUserPrompt({
            seriesPlan: generatedPlan,
            episodeCount: targetCount,
            targetRange: { start, end },
          }),
        }], {
          templateType: 'series_episode_cards_generate',
        }, {
          temperature: 0.35,
          maxTokens: 6500,
          reasoningEffort: SERIES_REASONING_EFFORT.creative,
          stream: true,
        }));

        const parsed = extractJsonObject(response);
        const batchCards = extractEpisodeCards(parsed);
        assertEpisodeCardsCoverRange(batchCards, start, end, `第${start}-${end}集爽点卡`);
        generatedPlan = mergeEpisodeCards(generatedPlan, parsed);
        assertEpisodeCardsCoverRange(generatedPlan.episodeCards, 1, end, '已生成分集爽点卡');
        dispatch({ type: 'SET_SERIES_PLAN', plan: generatedPlan });

        const batchQualityPlan = { ...generatedPlan, episodeCount: end };
        const batchQualityReport = await checkStep0Quality(batchQualityPlan, 'cards', end);
        if (batchQualityReport) {
          generatedPlan = {
            ...generatedPlan,
            step0QualityReport: batchQualityReport,
          };
          dispatch({ type: 'SET_SERIES_PLAN', plan: generatedPlan });
        }

        const shouldRepairBatch = !!batchQualityReport
          && batchQualityReport.riskLevel === 'high'
          && [
            ...batchQualityReport.rhythmIssues,
            ...batchQualityReport.cardIssues,
            ...batchQualityReport.repairInstructions,
          ].length > 0;
        if (shouldRepairBatch) {
          const batchRepairScope: SeriesStep0RepairScope = {
            stage: 'cards',
            episodeRange: { start, end },
            issueTypes: [
              ...(batchQualityReport.assetIssues.length ? ['assets'] : []),
              ...(batchQualityReport.rhythmIssues.length ? ['rhythm'] : []),
              ...(batchQualityReport.cardIssues.length ? ['cards'] : []),
            ],
            focus: `auto repair high risk only for episode batch ${start}-${end}`,
          };
          const repairedBatchPlan = await repairStep0Cards(generatedPlan, batchQualityReport, batchRepairScope);
          if (repairedBatchPlan) {
            repairedAnyBatch = true;
            generatedPlan = {
              ...repairedBatchPlan,
              episodeCount: targetCount,
              episodeDuration,
            };
            assertEpisodeCardsCoverRange(generatedPlan.episodeCards, 1, end, '局部修复后的分集爽点卡');
            const repairedBatchQuality = await checkStep0Quality({ ...generatedPlan, episodeCount: end }, 'cards', end);
            generatedPlan = {
              ...generatedPlan,
              step0QualityReport: repairedBatchQuality ?? generatedPlan.step0QualityReport,
            };
            dispatch({ type: 'SET_SERIES_PLAN', plan: generatedPlan });
          }
        }
      }
      assertEpisodeCardsCoverRange(generatedPlan.episodeCards, 1, targetCount, '整季分集爽点卡');
      const finalQualityReport = await checkStep0Quality(generatedPlan, 'cards', targetCount);
      const nextPlan = {
        ...generatedPlan,
        step0QualityReport: finalQualityReport ?? generatedPlan.step0QualityReport,
      };
      dispatch({ type: 'SET_SERIES_PLAN', plan: nextPlan });
      const issueSummary = formatSeriesQualityIssues(findSeriesPlanQualityIssues(nextPlan));
      const alignment = await checkConceptAlignment(nextPlan.sourcePremise ?? nextPlan.premise, conceptAnalysis, nextPlan.episodeCards, 'cards');
      if (issueSummary) {
        toast.warning(issueSummary);
      } else if (repairedAnyBatch) {
        toast.success('分集爽点卡已生成，并按批次自动修复了 high 风险问题');
      } else if (alignment && (!alignment.aligned || alignment.riskLevel !== 'low')) {
        const reasons = [...alignment.missingMustKeep, ...alignment.driftRisks].slice(0, 2).join('；');
        toast.warning(reasons ? `分集卡有跑偏风险：${reasons}` : '分集卡有跑偏风险，建议重新生成。');
      } else {
        toast.success('分集爽点卡已生成');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '分集爽点生成失败');
    }
  }, [callApiViaBff, canGenerateCards, checkConceptAlignment, checkStep0Quality, dispatch, episodeCount, episodeDuration, guardApiKey, isPremiseDetachedFromPlan, repairStep0Cards, runWithTaskLabel, seriesPlan, state.apiConfig]);

  const handleRegenerateEpisodeCard = useCallback(async (episode: SeriesEpisodeCard) => {
    if (!seriesPlan || loading || !guardApiKey()) return;
    try {
      const response = await runWithTaskLabel(`正在重做第${episode.episodeNumber}集卡`, () => callApiViaBff(state.apiConfig, [{
        role: 'user',
        content: buildSeriesEpisodeCardsUserPrompt({
          seriesPlan,
          episodeCount: Math.max(seriesPlan.episodeCards.length || episodeCount, episode.episodeNumber),
          targetEpisode: episode,
        }),
      }], {
        templateType: 'series_episode_cards_generate',
      }, {
        temperature: 0.4,
        maxTokens: 4000,
        reasoningEffort: SERIES_REASONING_EFFORT.creative,
        stream: true,
      }));

      const candidates = extractEpisodeCards(extractJsonObject(response));
      const replacement = candidates.find((item) => item.episodeNumber === episode.episodeNumber)
        ?? candidates[episode.episodeNumber - 1]
        ?? candidates[0];
      if (!replacement) {
        throw new Error('模型没有返回可替换的本集卡');
      }
      const nextPlan = replaceEpisodeCard({ ...seriesPlan, episodeCount, episodeDuration }, episode, replacement);
      dispatch({ type: 'SET_SERIES_PLAN', plan: nextPlan });
      const issueSummary = formatSeriesQualityIssues(findSeriesPlanQualityIssues(nextPlan)
        .filter((issue) => issue.label.includes(`第${episode.episodeNumber}集`)));
      if (issueSummary) {
        toast.warning(issueSummary);
      } else {
        toast.success(`第${episode.episodeNumber}集卡已重做`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '本集卡重做失败');
    }
  }, [callApiViaBff, dispatch, episodeCount, episodeDuration, guardApiKey, loading, runWithTaskLabel, seriesPlan, state.apiConfig]);

  const generateEpisodeScriptForPlan = useCallback(async (planForPrompt: SeriesPlan, episode: SeriesEpisodeCard) => {
    const response = await runWithTaskLabel(`正在生成第${episode.episodeNumber}集长剧情稿`, () => callApiViaBff(state.apiConfig, [{
      role: 'user',
      content: buildSeriesEpisodeScriptUserPrompt({
        seriesPlan: planForPrompt,
        episodeCard: episode,
        episodeDuration,
      }),
    }], {
      templateType: 'series_episode_script_generate',
    }, {
      temperature: 0.28,
      maxTokens: 12000,
      reasoningEffort: SERIES_REASONING_EFFORT.creative,
    }));

    const script = stabilizeGeneratedEpisodeScript(response);
    if (!script) {
      throw new Error('模型没有返回本集剧本，请重试或检查对话模型配置。');
    }

    let finalScript = script;
    const scriptQualityContext = { plan: planForPrompt };
    let finalIssues = findEpisodeScriptQualityIssues(finalScript, scriptQualityContext);
    let blockingIssues = getBlockingEpisodeScriptIssues(finalScript, scriptQualityContext);
    if (blockingIssues.length > 0) {
      try {
        const repaired = await repairEpisodeScript(episode, finalScript, blockingIssues, planForPrompt);
        if (repaired) {
          finalScript = repaired;
          finalIssues = findEpisodeScriptQualityIssues(finalScript, scriptQualityContext);
          blockingIssues = getBlockingEpisodeScriptIssues(finalScript, scriptQualityContext);
        }
      } catch (repairErr) {
        toast.warning(repairErr instanceof Error ? `自动修复未完成：${repairErr.message}` : '自动修复未完成，已保留原始生成稿');
      }
    }

    dispatch({ type: 'UPDATE_SERIES_EPISODE_SCRIPT', episodeId: episode.id, script: finalScript });
    const issueSummary = formatSeriesQualityIssues(finalIssues);
    if (blockingIssues.length > 0) {
      toast.warning(`本集稿已保留，但仍需修复：${blockingIssues[0].suggestion}`);
      return finalScript;
    }
    if (issueSummary) {
      toast.warning(issueSummary);
    } else {
      toast.success(`第${episode.episodeNumber}集剧本已生成`);
    }
    void settleEpisodeMemory(episode, finalScript, planForPrompt, { background: true }).catch((settleErr) => {
      toast.warning(settleErr instanceof Error ? `连续性记忆未更新：${settleErr.message}` : '连续性记忆未更新');
    });
    return finalScript;
  }, [callApiViaBff, dispatch, episodeDuration, repairEpisodeScript, runWithTaskLabel, settleEpisodeMemory, state.apiConfig]);

  const handleGenerateEpisodeScript = useCallback(async (episode: SeriesEpisodeCard) => {
    if (!seriesPlan || !guardApiKey()) return;
    try {
      await generateEpisodeScriptForPlan(seriesPlan, episode);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '本集剧本生成失败');
    }
  }, [generateEpisodeScriptForPlan, guardApiKey, seriesPlan]);

  const handleGenerateFirstEpisodeFast = useCallback(async () => {
    const sourcePremise = premise.trim();
    if (sourcePremise.length < 6 || !guardApiKey()) return;
    if (hasFastLineOutput) {
      toast.warning('当前已有集卡或剧本，请用“补齐整季”或单集按钮继续。');
      return;
    }

    try {
      const targetCount = Math.max(3, Math.min(30, Math.round(episodeCount)));
      const firstBatchEnd = Math.min(EPISODE_CARD_BATCH_SIZE, targetCount);
      const conceptAnalysis = hasUsefulConceptAnalysis(effectiveConceptAnalysis)
        ? effectiveConceptAnalysis
        : await analyzeConceptForPremise(sourcePremise);
      setPendingConceptAnalysis(conceptAnalysis);
      setPendingConceptPremise(sourcePremise);

      let workingPlan: SeriesPlan | null = !isPremiseDetachedFromPlan && currentSeriesPlan && currentSeriesPlan.characters.length > 0
        ? {
          ...currentSeriesPlan,
          premise: sourcePremise,
          sourcePremise,
          conceptAnalysis,
          episodeCount: targetCount,
          episodeDuration,
        }
        : null;

      if (!workingPlan) {
        const bibleResponse = await runWithTaskLabel('正在生成首集快线人设圣经', () => callApiViaBff(state.apiConfig, [{
          role: 'user',
          content: buildSeriesBibleUserPrompt({
            premise: sourcePremise,
            genreMode,
            audienceChannel,
            episodeCount: targetCount,
            conceptAnalysis,
          }),
        }], {
          templateType: 'series_bible_generate',
        }, {
          temperature: 0.35,
          maxTokens: 7000,
          reasoningEffort: SERIES_REASONING_EFFORT.creative,
          stream: true,
        }));

        workingPlan = {
          ...normalizeSeriesPlan(extractJsonObject(bibleResponse), {
            premise: sourcePremise,
            sourcePremise,
            conceptAnalysis,
            genreMode,
            audienceChannel,
            episodeCount: targetCount,
            episodeDuration,
          }),
          premise: sourcePremise,
          sourcePremise,
          conceptAnalysis,
        };
        const bibleQuality = await checkStep0Quality(workingPlan, 'bible');
        workingPlan = bibleQuality ? { ...workingPlan, step0QualityReport: bibleQuality } : workingPlan;
        dispatch({ type: 'SET_SERIES_PLAN', plan: workingPlan, resetSeriesRuntime: true });
      }
      if (!workingPlan) {
        throw new Error('首集快线没有拿到人设圣经，请重试。');
      }
      let fastPlan: SeriesPlan = workingPlan;

      const hasFirstBatchCards = Array.from({ length: firstBatchEnd }, (_, index) => index + 1)
        .every((episodeNumber) => fastPlan.episodeCards.some((episode) => episode.episodeNumber === episodeNumber));

      if (!hasFirstBatchCards) {
        const cardsResponse = await runWithTaskLabel(`正在生成首集快线第1-${firstBatchEnd}集卡`, () => callApiViaBff(state.apiConfig, [{
          role: 'user',
          content: buildSeriesEpisodeCardsUserPrompt({
            seriesPlan: {
              ...fastPlan,
              episodeCount: targetCount,
              episodeDuration,
            },
            episodeCount: targetCount,
            targetRange: { start: 1, end: firstBatchEnd },
          }),
        }], {
          templateType: 'series_episode_cards_generate',
        }, {
          temperature: 0.35,
          maxTokens: 6500,
          reasoningEffort: 'medium',
          stream: true,
        }));

        const parsedCards = extractJsonObject(cardsResponse);
        const batchCards = extractEpisodeCards(parsedCards);
        assertEpisodeCardsCoverRange(batchCards, 1, firstBatchEnd, `第1-${firstBatchEnd}集爽点卡`);
        fastPlan = mergeEpisodeCards({
          ...fastPlan,
          episodeCount: targetCount,
          episodeDuration,
        }, parsedCards);
        assertEpisodeCardsCoverRange(fastPlan.episodeCards, 1, firstBatchEnd, '首集快线分集爽点卡');

        const fastQualityPlan = { ...fastPlan, episodeCount: firstBatchEnd };
        const cardsQuality = await checkStep0Quality(fastQualityPlan, 'cards', firstBatchEnd);
        fastPlan = {
          ...fastPlan,
          step0QualityReport: cardsQuality ?? fastPlan.step0QualityReport,
        };
        dispatch({ type: 'SET_SERIES_PLAN', plan: fastPlan });

        const shouldRepair = !!cardsQuality
          && cardsQuality.riskLevel === 'high'
          && [
            ...cardsQuality.rhythmIssues,
            ...cardsQuality.cardIssues,
            ...cardsQuality.assetIssues,
            ...cardsQuality.repairInstructions,
          ].length > 0;
        if (shouldRepair) {
          const repairedPlan = await repairStep0Cards(fastPlan, cardsQuality, {
            stage: 'cards',
            episodeRange: { start: 1, end: firstBatchEnd },
            issueTypes: [
              ...(cardsQuality.rhythmIssues.length ? ['rhythm'] : []),
              ...(cardsQuality.cardIssues.length ? ['cards'] : []),
              ...(cardsQuality.assetIssues.length ? ['assets'] : []),
            ],
            focus: 'first episode fast path high risk repair',
          });
          if (repairedPlan) {
            const repairedQuality = await checkStep0Quality({ ...repairedPlan, episodeCount: firstBatchEnd }, 'cards', firstBatchEnd);
            fastPlan = {
              ...repairedPlan,
              step0QualityReport: repairedQuality ?? repairedPlan.step0QualityReport,
            };
            dispatch({ type: 'SET_SERIES_PLAN', plan: fastPlan });
          }
        }
      } else {
        dispatch({ type: 'SET_SERIES_PLAN', plan: fastPlan });
      }

      const firstEpisode = fastPlan.episodeCards.find((episode) => episode.episodeNumber === 1);
      if (!firstEpisode) {
        throw new Error('首集快线没有拿到第1集卡，请重试生成第1-4集卡。');
      }
      await generateEpisodeScriptForPlan(fastPlan, firstEpisode);
      toast.success('首集快线完成：第1集剧本已生成，后续集卡可稍后补齐。');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '首集快线生成失败');
    }
  }, [
    analyzeConceptForPremise,
    audienceChannel,
    callApiViaBff,
    checkStep0Quality,
    currentSeriesPlan,
    dispatch,
    effectiveConceptAnalysis,
    episodeCount,
    episodeDuration,
    generateEpisodeScriptForPlan,
    genreMode,
    guardApiKey,
    hasFastLineOutput,
    isPremiseDetachedFromPlan,
    premise,
    repairStep0Cards,
    runWithTaskLabel,
    state.apiConfig,
  ]);

  const handleRepairEpisodeScript = useCallback(async (episode: SeriesEpisodeCard) => {
    const script = episode.generatedScript?.trim();
    if (!script || !seriesPlan || !guardApiKey()) return;
    const scriptQualityContext = { plan: seriesPlan };
    const qualityIssues = findEpisodeScriptQualityIssues(script, scriptQualityContext);
    const blockingIssues = getBlockingEpisodeScriptIssues(script, scriptQualityContext);
    const repairIssues = blockingIssues.length > 0 ? blockingIssues : qualityIssues.slice(0, 6);
    if (repairIssues.length === 0) {
      toast.success(`第${episode.episodeNumber}集剧本暂无阻塞问题`);
      return;
    }

    try {
      const repaired = await repairEpisodeScript(episode, script, repairIssues);
      if (!repaired) {
        throw new Error('模型没有返回修复后的本集剧本');
      }
      const nextBlockingIssues = getBlockingEpisodeScriptIssues(repaired, scriptQualityContext);
      dispatch({ type: 'UPDATE_SERIES_EPISODE_SCRIPT', episodeId: episode.id, script: repaired });
      if (nextBlockingIssues.length > 0) {
        toast.warning(`本集稿已更新，但仍需修复：${nextBlockingIssues[0].suggestion}`);
        return;
      }
      toast.success(`第${episode.episodeNumber}集剧本已修复`);
      void settleEpisodeMemory(episode, repaired, undefined, { background: true }).catch((settleErr) => {
        toast.warning(settleErr instanceof Error ? `连续性记忆未更新：${settleErr.message}` : '连续性记忆未更新');
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '本集剧本修复失败');
    }
  }, [dispatch, guardApiKey, repairEpisodeScript, seriesPlan, settleEpisodeMemory]);

  const handleResettleEpisodeMemory = useCallback(async (episode: SeriesEpisodeCard) => {
    const script = episode.generatedScript?.trim();
    if (!script || !guardApiKey()) return;
    try {
      await settleEpisodeMemory(episode, script, undefined, { background: true, notify: true });
    } catch (err) {
      toast.warning(err instanceof Error ? `连续性记忆未更新：${err.message}` : '连续性记忆未更新');
    }
  }, [guardApiKey, settleEpisodeMemory]);

  const handleRepairCurrentStep0Cards = useCallback(async () => {
    if (!currentSeriesPlan || !step0QualityReport || !guardApiKey()) return;
    const repairEnd = Math.min(
      EPISODE_CARD_BATCH_SIZE,
      currentSeriesPlan.episodeCards.length || currentSeriesPlan.episodeCount || episodeCount,
    );
    const repairedPlan = await repairStep0Cards(currentSeriesPlan, step0QualityReport, {
      stage: 'cards',
      episodeRange: { start: 1, end: repairEnd },
      issueTypes: [
        ...(step0QualityReport.rhythmIssues.length ? ['rhythm'] : []),
        ...(step0QualityReport.cardIssues.length ? ['cards'] : []),
        ...(step0QualityReport.assetIssues.length ? ['assets'] : []),
      ],
      focus: 'manual local repair from Step0 quality report',
    });
    if (!repairedPlan) return;
    const repairedQualityReport = await checkStep0Quality(repairedPlan, 'cards');
    const nextPlan = {
      ...repairedPlan,
      step0QualityReport: repairedQualityReport ?? repairedPlan.step0QualityReport,
    };
    dispatch({ type: 'SET_SERIES_PLAN', plan: nextPlan });
    const issueSummary = formatSeriesQualityIssues(findSeriesPlanQualityIssues(nextPlan));
    if (issueSummary) {
      toast.warning(issueSummary);
    } else {
      toast.success('Step0 集卡已按质量报告修复');
    }
  }, [checkStep0Quality, currentSeriesPlan, dispatch, episodeCount, guardApiKey, repairStep0Cards, step0QualityReport]);

  const closeStep1EntryDialog = useCallback(() => {
    setStep1EntryDialog(null);
    setStep1EntryConfirming(false);
  }, []);

  const commitEpisodeToStep1 = useCallback((episodeId: string, episodeNumber: number) => {
    dispatch({ type: 'CREATE_CHAPTER_FROM_SERIES_EPISODE', episodeId });
    onOpenChapter?.();
    toast.success(`第${episodeNumber}集已送入 Step1`);
  }, [dispatch, onOpenChapter]);

  const handleUseEpisode = useCallback((episode: SeriesEpisodeCard) => {
    if (!currentSeriesPlan) return;
    if (!episode.generatedScript?.trim()) {
      toast.warning(`请先生成第${episode.episodeNumber}集剧本，再进入 Step1。`);
      return;
    }
    const issues = buildStep1EntryIssues({
      episode,
      plan: currentSeriesPlan,
      planIssues,
      step0QualityReport,
      step0QualityReportIsStale,
    });
    if (issues.length > 0) {
      setStep1EntryDialog({
        episodeId: episode.id,
        episodeNumber: episode.episodeNumber,
        episodeTitle: episode.title,
        issues,
        canIgnore: issues.every((issue) => issue.ignoreable),
      });
      setStep1EntryConfirming(false);
      return;
    }
    commitEpisodeToStep1(episode.id, episode.episodeNumber);
  }, [commitEpisodeToStep1, currentSeriesPlan, planIssues, step0QualityReport, step0QualityReportIsStale]);

  const handleConfirmIgnoreStep1Risks = useCallback(() => {
    if (!step1EntryDialog?.canIgnore) return;
    commitEpisodeToStep1(step1EntryDialog.episodeId, step1EntryDialog.episodeNumber);
    closeStep1EntryDialog();
  }, [closeStep1EntryDialog, commitEpisodeToStep1, step1EntryDialog]);

  const closeConfirmActionDialog = useCallback(() => {
    setConfirmActionDialog(null);
    confirmActionRef.current = null;
  }, []);

  const requestConfirmAction = useCallback((
    dialog: ConfirmActionDialogState,
    action: () => void | Promise<void>,
  ) => {
    confirmActionRef.current = action;
    setConfirmActionDialog(dialog);
  }, []);

  const handleConfirmAction = useCallback(() => {
    const action = confirmActionRef.current;
    setConfirmActionDialog(null);
    confirmActionRef.current = null;
    if (action) void action();
  }, []);

  const handleAnalyzeConceptProtected = useCallback(() => {
    if (!isPremiseDetachedFromPlan && hasUsefulConceptAnalysis(effectiveConceptAnalysis) && hasGeneratedSeriesMaterial) {
      requestConfirmAction({
        title: '重新分析构思？',
        description: '这会更新当前项目的构思理解。已有的人设、集卡和剧本不会自动重写，但后续可能需要重新生成以保持一致。',
        confirmLabel: '确认重新分析',
        destructive: true,
      }, () => handleAnalyzeConcept());
      return;
    }
    void handleAnalyzeConcept();
  }, [effectiveConceptAnalysis, handleAnalyzeConcept, hasGeneratedSeriesMaterial, isPremiseDetachedFromPlan, requestConfirmAction]);

  const handleGenerateBibleProtected = useCallback(() => {
    if (!isPremiseDetachedFromPlan && hasGeneratedSeriesMaterial) {
      requestConfirmAction({
        title: '重新生成人设圣经？',
        description: '这会替换当前系列圣经，并重置连续性记忆；已有集卡和剧本可能不再匹配。补齐整季不需要点这里。',
        confirmLabel: '确认重生人设',
        destructive: true,
      }, () => handleGenerateBible());
      return;
    }
    void handleGenerateBible();
  }, [handleGenerateBible, hasGeneratedSeriesMaterial, isPremiseDetachedFromPlan, requestConfirmAction]);

  const handleGenerateCardsProtected = useCallback(() => {
    if (!hasMissingEpisodeCards && generatedEpisodeCardCount > 0) {
      requestConfirmAction({
        title: '重新生成全部集卡？',
        description: generatedScriptCount > 0
          ? '这会覆盖现有分集卡，已生成的单集剧本可能不再匹配。要补齐后续集数时，请用“补齐整季”。'
          : '这会覆盖现有分集卡。要补齐后续集数时，请用“补齐整季”。',
        confirmLabel: '确认重生集卡',
        destructive: true,
      }, () => handleGenerateCards());
      return;
    }
    void handleGenerateCards();
  }, [generatedEpisodeCardCount, generatedScriptCount, handleGenerateCards, hasMissingEpisodeCards, requestConfirmAction]);

  const handleRepairCurrentStep0CardsProtected = useCallback(() => {
    requestConfirmAction({
      title: '按报告修复集卡？',
      description: '这会按质量报告局部修改当前集卡和节奏表，不会重写整季，但已有稿件可能需要复核。',
      confirmLabel: '确认修复集卡',
    }, () => handleRepairCurrentStep0Cards());
  }, [handleRepairCurrentStep0Cards, requestConfirmAction]);

  const handleRegenerateEpisodeCardProtected = useCallback((episode: SeriesEpisodeCard) => {
    requestConfirmAction({
      title: `重做第${episode.episodeNumber}集卡？`,
      description: episode.generatedScript?.trim()
        ? '这会更新本集卡。当前已有剧本不会自动删除，但可能不再匹配新的集卡。'
        : '这会覆盖当前这一集的钩子、压力节拍、爽点和悬念。',
      confirmLabel: '确认重做集卡',
      destructive: true,
    }, () => handleRegenerateEpisodeCard(episode));
  }, [handleRegenerateEpisodeCard, requestConfirmAction]);

  const handleGenerateEpisodeScriptProtected = useCallback((episode: SeriesEpisodeCard) => {
    if (episode.generatedScript?.trim()) {
      requestConfirmAction({
        title: `重新生成第${episode.episodeNumber}集剧本？`,
        description: '这会覆盖当前已生成的本集长剧情稿。已经送入 Step1 的章节不会自动同步。',
        confirmLabel: '确认重生本集',
        destructive: true,
      }, () => handleGenerateEpisodeScript(episode));
      return;
    }
    void handleGenerateEpisodeScript(episode);
  }, [handleGenerateEpisodeScript, requestConfirmAction]);

  const step1EntryDialogEpisode = useMemo(() => {
    if (!step1EntryDialog || !currentSeriesPlan) return null;
    return currentSeriesPlan.episodeCards.find((episode) => episode.id === step1EntryDialog.episodeId) ?? null;
  }, [currentSeriesPlan, step1EntryDialog]);
  const step1DialogHasScriptIssue = step1EntryDialog?.issues.some((issue) => issue.source === 'episode-script') ?? false;

  return (
    <div className="animate-fade-in space-y-5">
      <div className="surface-panel overflow-hidden rounded-[28px] px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-full border-brand-orange/30 bg-brand-orange/10 text-brand-orange">
                Step0
              </Badge>
              <Badge variant="outline" className="rounded-full border-border/60 bg-background/70">
                项目级剧集工厂
              </Badge>
              {currentSeriesPlan && (
                <Badge variant="outline" className="rounded-full border-border/60 bg-background/70">
                  已出稿 {generatedScriptCount}/{currentSeriesPlan.episodeCount || currentSeriesPlan.episodeCards.length || episodeCount} 集
                </Badge>
              )}
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
              系列策划
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
              先锁定整部剧的人设圣经、长线秘密和分集爽点卡，再把单集长剧情稿送入 Step1 生产线。
            </p>
          </div>

          {currentSeriesPlan && (
            <div className="grid min-w-full gap-2 sm:grid-cols-3 xl:min-w-[360px]">
              <div className="rounded-2xl border border-border/50 bg-background/65 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">人设</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{currentSeriesPlan.characters.length}</p>
              </div>
              <div className="rounded-2xl border border-border/50 bg-background/65 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">集卡</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{currentSeriesPlan.episodeCards.length}</p>
              </div>
              <div className="rounded-2xl border border-border/50 bg-background/65 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">稿件</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{generatedScriptCount}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <Card className="border-border/70 bg-background/90 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" />
                系列输入
              </CardTitle>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                写点子、定方向、锁定构思，再继续生成可生产的系列资料。
              </p>
            </div>
            <div className="rounded-full border border-border/60 bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground">
              点子 → 构思 → 人设 → 集卡 → 稿件
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" aria-label="系列策划进度">
            {workflowSteps.map((step, index) => (
              <div
                key={step.label}
                className={cn(
                  'flex min-h-16 items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 transition-colors',
                  step.done
                    ? 'border-success/25 bg-success/10 text-success'
                    : step.current
                      ? 'border-brand-orange/35 bg-brand-orange/10 text-brand-orange'
                      : 'border-border/55 bg-muted/20 text-muted-foreground',
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-foreground">{step.label}</p>
                  <p className="mt-0.5 truncate text-[11px]">{step.value}</p>
                </div>
                <div
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                    step.done
                      ? 'border-success/30 bg-success text-success-foreground'
                      : step.current
                        ? 'border-brand-orange/30 bg-brand-orange text-white'
                        : 'border-border bg-background text-muted-foreground',
                  )}
                >
                  {step.done ? <Check className="h-3.5 w-3.5" /> : index + 1}
                </div>
              </div>
            ))}
          </div>

          {generationProgressText && (
            <div
              className={cn(
                'rounded-2xl border px-3 py-3 text-sm leading-5 sm:px-4',
                loading
                  ? 'border-brand-orange/35 bg-brand-orange/10 text-foreground'
                  : 'border-destructive/35 bg-destructive/10 text-destructive',
              )}
              role={loading ? 'status' : 'alert'}
              aria-live="polite"
            >
              <div className="flex items-start gap-2">
                {loading ? (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-brand-orange" />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="font-medium">
                    {loading ? activeTaskLabel || '正在生成' : '上一次生成失败'}
                  </p>
                  <p className="mt-1 line-clamp-3 break-words text-xs opacity-85">
                    {generationProgressText}
                  </p>
                </div>
              </div>
            </div>
          )}

          {memoryProgressText && (
            <div
              className="rounded-2xl border border-blue-200/70 bg-blue-50/60 px-3 py-3 text-sm leading-5 text-blue-950 sm:px-4 dark:border-blue-400/25 dark:bg-blue-950/20 dark:text-blue-100"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-start gap-2">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-blue-500" />
                <div className="min-w-0">
                  <p className="font-medium">{memoryTaskLabel || '后台正在沉淀连续性记忆'}</p>
                  <p className="mt-1 line-clamp-3 break-words text-xs opacity-85">
                    {memoryProgressText}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
            <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/10 p-3 sm:p-4">
              <div className="flex flex-col gap-1">
                <div className="min-w-0">
                  <Label htmlFor="series-premise">系列点子</Label>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    先把故事发动机写清楚，短构思也可以先润色成长点子。
                  </p>
                </div>
              </div>
              <Textarea
                id="series-premise"
                value={premise}
                onChange={(event) => handlePremiseChange(event.target.value)}
                placeholder="一句话写系列：公司迟到罚款新规反噬老板，打工人把罚单二维码贴进群聊，越收越失控..."
                className="min-h-[168px] resize-y bg-background/80 text-sm leading-6"
                aria-label="系列点子"
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={handlePolishPremise}
                  disabled={!canPolishPremise}
                  title={polishButtonTitle}
                >
                  {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                  润色点子
                </Button>
                <Button
                  variant={shouldHighlightConceptAction ? 'default' : 'outline'}
                  size="sm"
                  className={cn('w-full sm:w-auto', shouldHighlightConceptAction && activeStageButtonClass)}
                  onClick={handleAnalyzeConceptProtected}
                  disabled={!canAnalyzeConcept}
                  title={conceptButtonTitle}
                >
                  {loading && activeTaskLabel.includes('分析') ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1.5 h-4 w-4" />}
                  {hasUsefulConceptAnalysis(effectiveConceptAnalysis) ? '重新分析构思' : '分析构思'}
                </Button>
              </div>
              <div
                className={cn(
                  'rounded-xl border px-3 py-2 text-xs leading-5',
                  isPremiseDetachedFromPlan
                    ? 'border-amber-300/45 bg-amber-50/80 text-amber-900 dark:bg-amber-950/20 dark:text-amber-100'
                    : 'border-border/50 bg-background/60 text-muted-foreground',
                )}
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <span>{inputStatusMessage}</span>
                  {isPremiseDetachedFromPlan && (
                    <span className="font-medium">请先重新生成人设圣经</span>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-border/60 bg-background/70 p-3 sm:p-4">
                <div className="mb-3 flex flex-col gap-1">
                  <p className="text-sm font-semibold text-foreground">生成设置</p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    题材管机制，频道管爽感，集数和秒数管节奏密度。
                  </p>
                </div>
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="series-genre">题材类型</Label>
                      <Select value={genreMode} onValueChange={(value) => setGenreMode(value as SeriesPlan['genreMode'])}>
                        <SelectTrigger id="series-genre" className="w-full bg-background/80" aria-label="系列类型">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {GENRE_OPTION_GROUPS.map((group, groupIndex) => (
                            <SelectGroup key={group.label}>
                              {groupIndex > 0 && <SelectSeparator />}
                              <SelectLabel>{group.label}</SelectLabel>
                              {group.values.map((value) => {
                                const option = GENRE_OPTION_BY_VALUE.get(value);
                                if (!option) return null;
                                const recommended = inputHints?.recommendedGenreMode === option.value;
                                return (
                                  <SelectItem
                                    key={option.value}
                                    value={option.value}
                                    className={recommended ? 'bg-brand-orange/10 text-brand-orange focus:bg-brand-orange/15 focus:text-brand-orange' : undefined}
                                  >
                                    <span className="flex w-full items-center justify-between gap-2">
                                      <span>{option.label}</span>
                                      {recommended && <span className="text-[10px] font-semibold">推荐</span>}
                                    </span>
                                  </SelectItem>
                                );
                              })}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-2">
                        <Label htmlFor="series-episode-count">目标集数</Label>
                        <Input
                          id="series-episode-count"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={episodeCountInput}
                          onChange={(event) => handleEpisodeCountInputChange(event.target.value)}
                          onBlur={commitEpisodeCountInput}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              commitEpisodeCountInput();
                              event.currentTarget.blur();
                            }
                          }}
                          aria-label="目标集数"
                          className="bg-background/80"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="series-episode-duration">单集秒数</Label>
                        <Input
                          id="series-episode-duration"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={episodeDurationInput}
                          onChange={(event) => handleEpisodeDurationInputChange(event.target.value)}
                          onBlur={commitEpisodeDurationInput}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              commitEpisodeDurationInput();
                              event.currentTarget.blur();
                            }
                          }}
                          aria-label="单集秒数"
                          className="bg-background/80"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label id="series-audience-channel-label">频道方向</Label>
                    <div
                      className="grid gap-2 sm:grid-cols-3"
                      role="radiogroup"
                      aria-labelledby="series-audience-channel-label"
                    >
                      {AUDIENCE_CHANNEL_OPTIONS.map((option) => {
                        const selected = audienceChannel === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            className={cn(
                              'min-h-[58px] rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                              selected
                                ? 'border-brand-orange/60 bg-brand-orange/10 text-foreground shadow-[0_0_0_1px_rgba(255,112,67,0.18)]'
                                : 'border-border/60 bg-muted/20 text-muted-foreground hover:border-border hover:bg-muted/35',
                            )}
                            onClick={() => setAudienceChannel(option.value)}
                          >
                            <span className="block text-sm font-semibold">{option.label}</span>
                            <span className="mt-1 block text-[11px] leading-4 opacity-80">{option.hint}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      男频偏剧情爽、反打、逆袭；女频偏暧昧、拉扯、关系情绪。
                    </p>
                  </div>
                </div>
              </div>

              {inputHints && (
              <div className="rounded-2xl border border-success/25 bg-success/10 px-3 py-3 sm:px-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-success/35 bg-background/70 text-success">
                    自动识别建议
                  </Badge>
                  {inputHints?.recommendedGenreMode && (
                    <Badge variant="outline" className="border-success/35 bg-success/10 text-success">
                      已推荐：{getGenreLabel(inputHints.recommendedGenreMode)}
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-sm font-semibold leading-6 text-foreground">{targetStoryEngine}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  题材：{getGenreLabel(targetGenreMode)} · 频道：{getAudienceChannelLabel(targetAudienceChannel)} · 目标：{episodeCount} 集 · 单集 {episodeDuration} 秒
                </p>
                {inputHints.matchedKeywords.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {inputHints.matchedKeywords.slice(0, 10).map((keyword) => (
                      <Badge key={keyword} variant="secondary" className="bg-background/75 text-[11px]">
                        {keyword}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
              )}

              <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-muted/10 p-3 sm:p-4">
                <div className="text-xs leading-5 text-muted-foreground">
                  {!hasUsefulConceptAnalysis(effectiveConceptAnalysis)
                    ? '下一步：先分析构思，锁住故事发动机。'
                    : shouldPrioritizeBible
                    ? '下一步：基于构思理解生成人设圣经。'
                    : shouldPrioritizeCards
                      ? '下一步：生成分集爽点卡。'
                      : hasMissingEpisodeCards
                        ? `已有 ${generatedEpisodeCardCount}/${targetEpisodeCount} 集卡，可补齐整季或继续生成已有单集稿。`
                        : '已有完整分集卡，可重做集卡或继续生成单集稿。'}
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Button
                    variant={shouldHighlightBibleAction ? 'default' : 'outline'}
                    className={cn(shouldHighlightBibleAction && activeStageButtonClass)}
                    onClick={handleGenerateBibleProtected}
                    disabled={!canGenerateBible}
                    title={bibleButtonTitle}
                  >
                    {loading && shouldPrioritizeBible ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1.5 h-4 w-4" />}
                    生成人设圣经
                  </Button>
                  <Button
                    variant={shouldHighlightCardsAction ? 'default' : 'outline'}
                    className={cn(shouldHighlightCardsAction && activeStageButtonClass)}
                    onClick={handleGenerateCardsProtected}
                    disabled={!canGenerateCards}
                    title={cardsButtonTitle}
                  >
                    {loading && shouldPrioritizeCards ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Zap className="mr-1.5 h-4 w-4" />}
                    {episodeCardsActionLabel}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void handleGenerateFirstEpisodeFast()}
                    disabled={!canGenerateFirstEpisodeFast}
                    title={firstEpisodeFastTitle}
                  >
                    {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Clapperboard className="mr-1.5 h-4 w-4" />}
                    首集快线
                  </Button>
                </div>
                {!hasApiKey && (
                  <Button variant="ghost" onClick={openApiSettings}>
                    配置 API
                  </Button>
                )}
              </div>
            </div>
          </div>

          {shouldShowTaoistAnchors && (
            <div className="rounded-2xl border border-success/25 bg-success/10 px-3 py-3 sm:px-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">{inputHints?.anchorTitle ?? '玄学抓鬼题材质量锚点'}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    后续人设、素材池、集卡和单集稿都必须继承这些锚点，避免漂成普通玄学探案。
                  </p>
                </div>
                <Badge variant="outline" className="mt-1 w-fit border-success/35 bg-background/70 text-success">
                  生成护栏
                </Badge>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {(inputHints?.anchors ?? TAOIST_LIVE_STREAM_ANCHORS).map((anchor) => (
                  <div key={anchor} className="rounded-xl border border-border/45 bg-background/70 px-3 py-2">
                    <p className="text-xs leading-5 text-foreground">{anchor}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Collapsible open={conceptReportOpen} onOpenChange={setConceptReportOpen}>
            <div
              className={cn(
                'rounded-2xl border px-3 py-3 sm:px-4',
                hasUsefulConceptAnalysis(effectiveConceptAnalysis)
                  ? 'border-success/25 bg-success/10'
                  : 'border-dashed border-border/70 bg-muted/15',
              )}
              aria-label="构思理解报告"
            >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">构思理解报告</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  先锁住故事发动机，再让人设、集卡和单集稿继承它。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {hasUsefulConceptAnalysis(effectiveConceptAnalysis) && (
                  <Badge variant="outline" className="w-fit border-success/35 bg-background/70 text-success">
                    已锁定
                  </Badge>
                )}
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 bg-background/70">
                    <ChevronRight className={cn('mr-1.5 h-3.5 w-3.5 transition-transform', conceptReportOpen && 'rotate-90')} />
                    {conceptReportOpen ? '收起' : '展开'}
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>

            <CollapsibleContent>
            {hasUsefulConceptAnalysis(effectiveConceptAnalysis) ? (
              <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="rounded-xl border border-border/55 bg-background/70 px-3 py-3">
                  <p className="text-[11px] font-semibold text-muted-foreground">这故事卖什么</p>
                  <p className="mt-1 text-sm leading-6 text-foreground">
                    {effectiveConceptAnalysis.conceptLogline || effectiveConceptAnalysis.coreStoryEngine || '待补充'}
                  </p>
                </div>
                <div className="rounded-xl border border-border/55 bg-background/70 px-3 py-3">
                  <p className="text-[11px] font-semibold text-muted-foreground">观众从哪里进入</p>
                  <p className="mt-1 text-sm leading-6 text-foreground">
                    {effectiveConceptAnalysis.viewpointEntry || effectiveConceptAnalysis.protagonistFantasy || '待补充'}
                  </p>
                </div>
                <div className="rounded-xl border border-border/55 bg-background/70 px-3 py-3">
                  <p className="text-[11px] font-semibold text-muted-foreground">每集怎么爽</p>
                  <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                    {compactReportList(effectiveConceptAnalysis.episodeFormula, effectiveConceptAnalysis.audiencePromise || '待补充单集公式').map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-border/55 bg-background/70 px-3 py-3">
                  <p className="text-[11px] font-semibold text-muted-foreground">绝对不能丢</p>
                  <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                    {compactReportList([
                      ...effectiveConceptAnalysis.mustKeepFacts,
                      ...effectiveConceptAnalysis.mustKeepCharacters,
                      ...effectiveConceptAnalysis.mustKeepMechanisms,
                    ], '待补充不可丢事实').map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                {effectiveConceptAnalysis.forbiddenDrift.length > 0 && (
                  <div className="rounded-xl border border-amber-300/45 bg-amber-50/70 px-3 py-3 text-amber-900 dark:bg-amber-950/20 dark:text-amber-100 lg:col-span-2">
                    <p className="text-[11px] font-semibold">跑偏风险</p>
                    <p className="mt-1 text-xs leading-5 opacity-85">
                      {compactList(effectiveConceptAnalysis.forbiddenDrift.slice(0, 4), '暂无')}
                    </p>
                  </div>
                )}
                <div className="rounded-xl border border-border/55 bg-background/70 px-3 py-3 lg:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-muted-foreground">玩法规则卡</p>
                    <Badge variant="outline">Step0 质量锚点</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {[
                      ['观众入口', effectiveConceptAnalysis.playRules.audienceEntry || effectiveConceptAnalysis.viewpointEntry],
                      ['反复钩子', effectiveConceptAnalysis.playRules.recurringHook || effectiveConceptAnalysis.coreStoryEngine],
                      ['爽点兑现', effectiveConceptAnalysis.playRules.payoffLoop || effectiveConceptAnalysis.audiencePromise],
                      ['素材轮换', effectiveConceptAnalysis.playRules.assetRotationRule || '待补充素材轮换规则'],
                      ['主角出手', effectiveConceptAnalysis.playRules.protagonistActionRule || effectiveConceptAnalysis.protagonistFantasy],
                      ['禁止偷懒', effectiveConceptAnalysis.playRules.forbiddenShortcut || compactList(effectiveConceptAnalysis.driftGuardrails.slice(0, 2), '待补充禁区')],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-xl border border-border/45 bg-muted/15 px-3 py-2">
                        <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
                        <p className="mt-1 text-xs leading-5 text-foreground">{value || '待补充'}</p>
                      </div>
                    ))}
                  </div>
                  {(effectiveConceptAnalysis.episodeEnginePattern.length > 0 || effectiveConceptAnalysis.visualSatisfactionRules.length > 0) && (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <div>
                        <p className="text-[11px] font-semibold text-muted-foreground">单集发动机</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {compactList(effectiveConceptAnalysis.episodeEnginePattern.slice(0, 5), '待补充')}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-muted-foreground">可拍爽点规则</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {compactList(effectiveConceptAnalysis.visualSatisfactionRules.slice(0, 4), '待补充')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                还未分析构思。输入长点子后点“分析构思”，系统会先读懂人物入口、爽点机制和不可丢事实，再进入人设圣经。
              </p>
            )}
            </CollapsibleContent>
            </div>
          </Collapsible>

        </CardContent>
      </Card>

      {!currentSeriesPlan ? (
        <div className="rounded-[24px] border border-dashed border-border/70 bg-muted/25 px-5 py-8 text-center text-sm text-muted-foreground">
          {seriesEmptyStateMessage}
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[0.88fr_1.35fr]">
          <div className="space-y-4">
            <Card className="border-border/70 bg-background/90">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">系列圣经摘要</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">系列点子</p>
                  <p className="mt-1 text-sm leading-6 text-foreground">{currentSeriesPlan.premise}</p>
                </div>
                {currentSeriesPlan.tone && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">语气</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{currentSeriesPlan.tone}</p>
                  </div>
                )}
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">人设</p>
                  {currentSeriesPlan.characters.slice(0, 6).map((character) => (
                    <div key={character.id} className="rounded-2xl border border-border/60 bg-muted/20 px-3 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-medium text-foreground">{character.name}</p>
                        <Badge variant="outline">{character.role}</Badge>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {character.actionStyle || character.voiceStyle || character.visualAnchor || '待补充角色锚点'}
                      </p>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">长线秘密</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {compactList(currentSeriesPlan.longRunningSecrets, '暂无长线秘密')}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">复用道具</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {compactList(currentSeriesPlan.recurringProps, '暂无复用道具')}
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">单元素材池</p>
                    <Badge variant={productionAssetCount > 0 ? 'outline' : 'secondary'}>
                      {productionAssetCount > 0 ? `${productionAssetCount} 个` : '建议补齐'}
                    </Badge>
                  </div>
                  {productionAssetCount === 0 ? (
                    <div className="rounded-2xl border border-amber-300/45 bg-amber-50/70 px-3 py-3 text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
                      <p className="text-sm font-medium">当前人设圣经还没有单元素材池</p>
                      <p className="mt-1 text-xs leading-5 opacity-85">
                        建议重新生成人设圣经，补齐怪物、病例、任务、证据、关系事件或关键场景，后续集卡会更稳定。
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {currentProductionAssets.slice(0, 8).map((asset) => (
                        <div key={asset.id} className="rounded-2xl border border-border/60 bg-muted/20 px-3 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="min-w-0 truncate text-sm font-medium text-foreground">{asset.name}</p>
                            <Badge variant="outline">{getProductionAssetLabel(asset)}</Badge>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {asset.storyFunction || asset.genreUse || asset.visualAnchor || '待补充素材用途'}
                          </p>
                          {(asset.episodeRange || asset.assetNeed) && (
                            <p className="mt-1 text-[11px] leading-4 text-muted-foreground/80">
                              {[asset.episodeRange, asset.assetNeed].filter(Boolean).join(' / ')}
                            </p>
                          )}
                        </div>
                      ))}
                      {productionAssetCount > 8 && (
                        <p className="text-xs text-muted-foreground">还有 {productionAssetCount - 8} 个素材将在集卡中按需分配。</p>
                      )}
                    </div>
                  )}
                  {adHocAssetCount > 0 && (
                    <div className="rounded-2xl border border-amber-300/45 bg-amber-50/70 px-3 py-3 text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
                      <p className="text-sm font-medium">本季已有 {adHocAssetCount} 个计划外临时素材</p>
                      <p className="mt-1 text-xs leading-5 opacity-85">
                        临时素材可以保留用于当前集，也可以后续沉淀进素材池，避免长期漂移。
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {(currentSeasonRhythm.length > 0 || step0QualityReport) && (
              <Card className="border-border/70 bg-background/90">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Clapperboard className="h-4 w-4 text-primary" />
                    Step0 生产规则
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {currentSeasonRhythm.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">整季节奏表</p>
                        <Badge variant="outline">{currentSeasonRhythm.length} 集</Badge>
                      </div>
                      <div className="space-y-2">
                        {currentSeasonRhythm.slice(0, 8).map((beat) => (
                          <div key={`${beat.episodeNumber}-${beat.episodeType}`} className="rounded-2xl border border-border/60 bg-muted/20 px-3 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="secondary">第{beat.episodeNumber}集</Badge>
                              <Badge variant="outline">{getEpisodeTypeLabel(beat.episodeType)}</Badge>
                            </div>
                            <p className="mt-2 text-sm font-medium text-foreground">{beat.role || beat.coreTurn || '待补充节奏职责'}</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              {[beat.requiredAsset, beat.payoffPromise, beat.nextHook].filter(Boolean).join(' / ') || '待补充素材、爽点和钩子'}
                            </p>
                          </div>
                        ))}
                        {currentSeasonRhythm.length > 8 && (
                          <p className="text-xs text-muted-foreground">还有 {currentSeasonRhythm.length - 8} 集节奏安排将在分集卡中展开。</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-amber-300/45 bg-amber-50/70 px-3 py-3 text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
                      <p className="text-sm font-medium">当前集卡还没有整季节奏表</p>
                      <p className="mt-1 text-xs leading-5 opacity-85">建议重新生成分集爽点卡，让每集先分配集型、素材和节奏职责。</p>
                    </div>
                  )}

                  {step0QualityReport && (
                    <div
                      className={cn(
                        'rounded-2xl border px-3 py-3',
                        step0QualityReport.ok && step0QualityReport.riskLevel === 'low'
                          ? 'border-success/25 bg-success/10 text-foreground'
                          : 'border-amber-300/45 bg-amber-50/70 text-amber-900 dark:bg-amber-950/20 dark:text-amber-100',
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">Step0 质量报告</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">
                            {step0QualityReport.riskLevel === 'low' ? '低风险' : step0QualityReport.riskLevel === 'medium' ? '中风险' : '高风险'}
                          </Badge>
                          {loading && (
                            <Badge variant="outline" className="border-brand-orange/35 bg-brand-orange/10 text-brand-orange">
                              处理中，完成后复检
                            </Badge>
                          )}
                          {(!step0QualityReport.ok || step0QualityReport.riskLevel !== 'low') && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 border-amber-300/70 bg-background/80"
                              onClick={() => void handleRepairCurrentStep0CardsProtected()}
                              disabled={loading || !hasEpisodeCards}
                              title={loading ? '正在生成或修复，完成后会重新检查质量报告' : !hasEpisodeCards ? '请先生成分集爽点卡' : '按 Step0 质量报告局部修复前4集卡和节奏'}
                            >
                              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                              按报告修复集卡
                            </Button>
                          )}
                        </div>
                      </div>
                      <p className="mt-1 text-xs leading-5 opacity-85">
                        {step0QualityReport.summary || (step0QualityReport.ok ? '当前 Step0 质量通过检查。' : '当前 Step0 仍有需要补强的地方。')}
                      </p>
                      {loading && (
                        <p className="mt-2 text-xs leading-5 opacity-75">
                          当前展示的是上一版报告；本轮生成或修复完成后会自动更新风险判断。
                        </p>
                      )}
                      {step0QualityIssueCount > 0 && (
                        <div className="mt-3 space-y-1 text-xs leading-5 opacity-90">
                          {[
                            ...step0QualityReport.bibleIssues,
                            ...step0QualityReport.assetIssues,
                            ...step0QualityReport.rhythmIssues,
                            ...step0QualityReport.cardIssues,
                          ].slice(0, 5).map((issue) => (
                            <p key={issue}>- {issue}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="border-border/70 bg-background/90">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  {runtimeIssues.length > 0 ? (
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                  ) : (
                    <Check className="h-4 w-4 text-success" />
                  )}
                  连续性记忆
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-2xl border border-border/60 bg-muted/20 px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">已沉淀</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{settledEpisodeCount} 集</p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-muted/20 px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">未闭合伏笔</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{activeHookCount}</p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-muted/20 px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">关键道具</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{propCount}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="series-current-focus">当前重点</Label>
                  <Textarea
                    id="series-current-focus"
                    value={currentSeriesRuntime?.currentFocus ?? ''}
                    onChange={(event) => handleCurrentFocusChange(event.target.value)}
                    placeholder="例如：前 3 集先锁定退婚死局和皇印伏笔，不提前解释幕后人。"
                    className="min-h-[72px] text-sm"
                    aria-label="当前重点"
                  />
                </div>

                {runtimeIssues.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    当前连续性记忆暂无明显风险。
                  </p>
                ) : (
                  <div className="space-y-2">
                    {runtimeIssues.slice(0, 4).map((issue) => (
                      <div key={`${issue.id}-${issue.label}`} className="rounded-2xl border border-amber-300/45 bg-amber-50/70 px-3 py-3 text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
                        <p className="text-sm font-medium">{issue.label}</p>
                        <p className="mt-1 text-xs leading-5 opacity-85">{issue.suggestion}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-background/90">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  {planIssues.length === 0 ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                  )}
                  质量提示
                </CardTitle>
              </CardHeader>
              <CardContent>
                {planIssues.length === 0 && !hasEpisodeCards ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium text-foreground">集卡待生成</p>
                    <p className="text-sm text-muted-foreground">集卡待生成；生成分集爽点卡后再检查整季节奏、开场、爽点和承接物。</p>
                  </div>
                ) : planIssues.length === 0 ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-muted-foreground">
                      {hasMissingEpisodeCards
                        ? `当前已生成 ${generatedEpisodeCardCount}/${targetEpisodeCount} 集卡通过基础检查，可继续补齐整季。`
                        : '当前集卡节奏通过基础检查。'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {planIssues.slice(0, 5).map((issue) => {
                      const issueEpisodeNumber = getIssueEpisodeNumber(issue.label);
                      const issueEpisode = issueEpisodeNumber && firstIssueByEpisode.has(issue.label)
                        ? currentSeriesPlan.episodeCards.find((episode) => episode.episodeNumber === issueEpisodeNumber)
                        : undefined;
                      return (
                        <div key={`${issue.id}-${issue.label}`} className="rounded-2xl border border-amber-300/40 bg-amber-50/70 px-3 py-3 text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{issue.label}</p>
                              <p className="mt-1 text-xs leading-5 opacity-85">{issue.suggestion}</p>
                            </div>
                            {issueEpisode && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="shrink-0 border-amber-300/70 bg-background/80"
                                onClick={() => void handleRegenerateEpisodeCardProtected(issueEpisode)}
                                disabled={loading}
                                title={loading ? '正在生成，请稍候' : `只重做第${issueEpisode.episodeNumber}集集卡`}
                              >
                                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                                重做第{issueEpisode.episodeNumber}集
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex flex-col gap-2 rounded-2xl border border-amber-300/50 bg-background/80 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs leading-5 text-muted-foreground">
                        这些问题来自分集卡结构检查；中风险先提示，可用局部修复或单集重做处理，不会自动重写整季。
                      </p>
                      <Button
                        size="sm"
                        onClick={() => void handleGenerateCardsProtected()}
                        disabled={!canGenerateCards}
                        title={regenerateCardsTitle}
                      >
                        {hasMissingEpisodeCards ? <Zap className="mr-1.5 h-3.5 w-3.5" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                        {episodeCardsActionLabel}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/70 bg-background/90">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-base">分集爽点卡</CardTitle>
                <Badge variant="outline">{currentSeriesPlan.episodeCards.length} 集</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {currentSeriesPlan.episodeCards.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-border/70 bg-muted/25 px-4 py-6 text-sm text-muted-foreground">
                  人设已生成。继续点击“生成分集爽点卡”，拿到每集的钩子、压力节拍、爽点和悬念。
                </div>
              ) : (
                <div className="space-y-3">
                  {currentSeriesPlan.episodeCards.map((episode) => {
                    const scriptIssues = episode.generatedScript
                      ? findEpisodeScriptQualityIssues(episode.generatedScript, { plan: currentSeriesPlan })
                      : [];
                    const blockingScriptIssues = episode.generatedScript
                      ? getBlockingEpisodeScriptIssues(episode.generatedScript, { plan: currentSeriesPlan })
                      : [];
                    const plannedAssetLabels = getEpisodeAssetLabels(currentSeriesPlan, episode);
                    const shouldHighlightEpisodeScriptAction = !episode.generatedScript?.trim()
                      && nextScriptEpisodeNumber === episode.episodeNumber;
                    return (
                      <div key={episode.id} className="rounded-[22px] border border-border/70 bg-muted/15 p-4">
                        <div className="flex flex-col gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="secondary">第{episode.episodeNumber}集</Badge>
                              <Badge variant="outline">{getEpisodeTypeLabel(episode.episodeType)}</Badge>
                              <Badge variant="outline">{SATISFACTION_LABELS[episode.satisfactionType]}</Badge>
                              {episode.generatedScript && <Badge className="bg-success/10 text-success">已出稿</Badge>}
                              {episode.generatedScript && blockingScriptIssues.length === 0 && (
                                <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                                  可进 Step1
                                </Badge>
                              )}
                              {blockingScriptIssues.length > 0 && (
                                <Badge variant="outline" className="border-destructive/35 text-destructive">
                                  需修复 {blockingScriptIssues.length}
                                </Badge>
                              )}
                              {plannedAssetLabels.length > 0 && <Badge variant="outline">{plannedAssetLabels.length} 个素材</Badge>}
                              {(episode.adHocAssets?.length ?? 0) > 0 && (
                                <Badge variant="outline" className="border-amber-300 text-amber-700">
                                  {episode.adHocAssets?.length ?? 0} 个临时新增
                                </Badge>
                              )}
                              {scriptIssues.length > 0 && (
                                <Badge variant="outline" className="border-amber-300 text-amber-700">
                                  {scriptIssues.length} 项提示
                                </Badge>
                              )}
                            </div>
                            <p className="mt-2 text-sm font-semibold text-foreground">{episode.title}</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              {episode.mainQuestion || episode.openingHook || '待补充本集核心问题'}
                            </p>
                          </div>
                          <div className="grid w-full gap-2 sm:grid-cols-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full"
                              onClick={() => void handleRegenerateEpisodeCardProtected(episode)}
                              disabled={loading}
                              title={loading ? '正在生成，请稍候' : '只重做当前这一集的钩子、压力节拍、爽点和悬念'}
                            >
                              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                              重做本集卡
                            </Button>
                            <Button
                              size="sm"
                              variant={shouldHighlightEpisodeScriptAction ? 'default' : 'outline'}
                              className={cn('w-full', shouldHighlightEpisodeScriptAction && activeStageButtonClass)}
                              onClick={() => void handleGenerateEpisodeScriptProtected(episode)}
                              disabled={loading}
                              title={loading ? '正在生成，请稍候' : episode.generatedScript ? '重新生成本集长剧情稿，会覆盖当前生成稿' : '生成本集长剧情稿'}
                            >
                              {episode.generatedScript ? (
                                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                              ) : (
                                <Clapperboard className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              {episode.generatedScript ? '重新生成本集' : '生成本集剧本'}
                            </Button>
                            {episode.generatedScript && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full"
                                onClick={() => void handleRepairEpisodeScript(episode)}
                                disabled={loading || scriptIssues.length === 0}
                                title={loading ? '正在生成，请稍候' : scriptIssues.length === 0 ? '当前本集稿暂无需要修复的问题' : '按质量提示修复当前本集稿，不重做集卡'}
                              >
                                <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                                修复本集稿
                              </Button>
                            )}
                            {episode.generatedScript && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full"
                                onClick={() => void handleResettleEpisodeMemory(episode)}
                                disabled={loading || memoryQueueSize > 0}
                                title={loading ? '正在生成，请稍候' : memoryQueueSize > 0 ? '连续性记忆正在后台排队沉淀' : '用当前生成稿重新更新连续性记忆'}
                              >
                                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                                重新沉淀记忆
                              </Button>
                            )}
                            <Button
                              size="sm"
                              className="w-full"
                              onClick={() => handleUseEpisode(episode)}
                              disabled={loading || !episode.generatedScript?.trim()}
                              title={loading
                                ? '正在生成，请稍候'
                                : !episode.generatedScript?.trim()
                                  ? '请先生成本集剧本，再进入 Step1'
                                  : blockingScriptIssues.length > 0
                                    ? `点击查看问题详情：${blockingScriptIssues[0].label}`
                                    : '把本集稿件送入 Step1'}
                            >
                              <FileText className="mr-1.5 h-3.5 w-3.5" />
                              {episode.generatedScript?.trim() ? '进入 Step1' : '未出稿'}
                            </Button>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div className="rounded-2xl border border-border/60 bg-background/75 px-3 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">开场钩子</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{episode.openingHook || '待补充'}</p>
                          </div>
                          <div className="rounded-2xl border border-border/60 bg-background/75 px-3 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">核心冲突动作</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{episode.coreConflictAction || '待补充'}</p>
                          </div>
                          <div className="rounded-2xl border border-border/60 bg-background/75 px-3 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">爽点</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{episode.satisfactionBeat || '待补充'}</p>
                          </div>
                          <div className="rounded-2xl border border-border/60 bg-background/75 px-3 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">可拍爽点动作</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{episode.visiblePayoffAction || '待补充'}</p>
                          </div>
                          <div className="rounded-2xl border border-border/60 bg-background/75 px-3 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">压力节拍</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{compactList(episode.pressureBeats, '待补充')}</p>
                          </div>
                          <div className="rounded-2xl border border-border/60 bg-background/75 px-3 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">悬念</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{episode.cliffhanger || '待补充'}</p>
                            {episode.nextHookRequirement && (
                              <p className="mt-1 text-[11px] leading-4 text-muted-foreground/80">
                                下一集必须承接：{episode.nextHookRequirement}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 grid gap-2 text-xs leading-5 text-muted-foreground md:grid-cols-3">
                          <p><span className="font-medium text-foreground">连续性入口：</span>{compactList(episode.continuityIn, '无')}</p>
                          <p><span className="font-medium text-foreground">连续性出口：</span>{compactList(episode.continuityOut, '无')}</p>
                          <p><span className="font-medium text-foreground">复用视觉：</span>{compactList(episode.visualReuse, '无')}</p>
                        </div>

                        {(plannedAssetLabels.length > 0 || (episode.adHocAssets?.length ?? 0) > 0) && (
                          <div className="mt-3 grid gap-2 text-xs leading-5 md:grid-cols-2">
                            {plannedAssetLabels.length > 0 && (
                              <div className="rounded-2xl border border-border/60 bg-background/75 px-3 py-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">本集素材计划</p>
                                <p className="mt-1 text-muted-foreground">{compactList(plannedAssetLabels, '无')}</p>
                              </div>
                            )}
                            {(episode.adHocAssets?.length ?? 0) > 0 && (
                              <div className="rounded-2xl border border-amber-300/45 bg-amber-50/70 px-3 py-3 text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.14em]">计划外临时素材</p>
                                <p className="mt-1 opacity-85">
                                  本集新增了计划外素材，可保留为临时素材或沉淀进素材池。
                                </p>
                                <p className="mt-1 opacity-85">
                                  {compactList((episode.adHocAssets ?? []).map((asset) => asset.name), '无')}
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {scriptIssues.length > 0 && (
                          <div className="mt-3 rounded-2xl border border-amber-300/45 bg-amber-50/70 px-3 py-3 text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 space-y-2">
                                <p className="text-sm font-medium">
                                  {blockingScriptIssues.length > 0 ? '本集剧本暂不能进入 Step1' : '本集剧本需要优化'}
                                </p>
                                {(blockingScriptIssues.length > 0 ? blockingScriptIssues : scriptIssues).slice(0, 3).map((issue) => (
                                  <p key={`${episode.id}-${issue.id}`} className="text-xs leading-5 opacity-85">
                                    {issue.label}：{issue.suggestion}
                                  </p>
                                ))}
                              </div>
                              <div className="flex shrink-0 flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-amber-300/70 bg-background/80"
                                  onClick={() => void handleRepairEpisodeScript(episode)}
                                  disabled={loading}
                                  title={loading ? '正在生成，请稍候' : '按质量提示修复当前本集稿'}
                                >
                                  <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                                  修复本集稿
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-amber-300/70 bg-background/80"
                                  onClick={() => void handleGenerateEpisodeScriptProtected(episode)}
                                  disabled={loading}
                                  title={loading ? '正在生成，请稍候' : '按当前集卡重新生成本集剧本'}
                                >
                                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                                  重新生成
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}

                        {episode.generatedScript && (
                          <details className="mt-3 rounded-2xl border border-border/60 bg-background/80">
                            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-foreground">
                              <Eye className="h-3.5 w-3.5" />
                              预览生成稿
                              <ChevronRight className="h-3.5 w-3.5 opacity-50" />
                            </summary>
                            <pre className="max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words border-t border-border/60 p-3 text-xs leading-5 text-muted-foreground">
                              {episode.generatedScript}
                            </pre>
                          </details>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog
        open={!!confirmActionDialog}
        onOpenChange={(open) => {
          if (!open) closeConfirmActionDialog();
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className={cn('h-5 w-5', confirmActionDialog?.destructive ? 'text-destructive' : 'text-amber-600')} />
              {confirmActionDialog?.title ?? '确认操作'}
            </DialogTitle>
            <DialogDescription>
              {confirmActionDialog?.description ?? '这个操作会修改当前系列内容，请确认后继续。'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeConfirmActionDialog}>
              取消
            </Button>
            <Button
              variant={confirmActionDialog?.destructive ? 'destructive' : 'default'}
              onClick={handleConfirmAction}
            >
              {confirmActionDialog?.confirmLabel ?? '确认'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!step1EntryDialog}
        onOpenChange={(open) => {
          if (!open) closeStep1EntryDialog();
        }}
      >
        <DialogContent className="max-h-[88vh] overflow-hidden sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              进入 Step1 前发现问题
            </DialogTitle>
            <DialogDescription>
              {step1EntryDialog
                ? `第${step1EntryDialog.episodeNumber}集「${step1EntryDialog.episodeTitle || '未命名'}」有 ${step1EntryDialog.issues.length} 项需要确认。`
                : '当前集进入 Step1 前需要确认质量风险。'}
            </DialogDescription>
          </DialogHeader>

          {step1EntryDialog && (
            <div className="space-y-4 overflow-hidden">
              <div className="max-h-[48vh] space-y-2 overflow-y-auto pr-1">
                {step1EntryDialog.issues.map((issue, index) => (
                  <div
                    key={`${issue.id}-${index}`}
                    className={cn(
                      'rounded-2xl border px-3 py-3 text-sm',
                      issue.ignoreable
                        ? 'border-amber-300/50 bg-amber-50/70 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100'
                        : 'border-destructive/30 bg-destructive/5 text-foreground',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="bg-background/80">
                        {getStep1EntryIssueSourceLabel(issue.source)}
                      </Badge>
                      {!issue.ignoreable && (
                        <Badge variant="outline" className="border-destructive/35 text-destructive">
                          不可忽略
                        </Badge>
                      )}
                    </div>
                    <p className="mt-2 font-medium">{issue.title}</p>
                    <p className="mt-1 text-xs leading-5 opacity-85">{issue.detail}</p>
                  </div>
                ))}
              </div>

              {step1EntryDialog.canIgnore ? (
                step1EntryConfirming ? (
                  <div className="rounded-2xl border border-destructive/35 bg-destructive/5 px-3 py-3 text-sm">
                    <p className="font-medium text-destructive">确认要忽略这些风险吗？</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      忽略后会直接创建章节并进入 Step1。后续 Step1 解析、角色/道具抽取或连续性可能需要更多手工修正。
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-amber-300/50 bg-muted/20 px-3 py-3 text-xs leading-5 text-muted-foreground">
                    建议先修复这些问题；如果你确认当前稿件可用，可以点击“忽略风险”，再进行一次确认后进入 Step1。
                  </div>
                )
              ) : (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-3 text-xs leading-5 text-muted-foreground">
                  当前问题包含不可忽略项，暂时不能进入 Step1。请先补齐本集长剧情稿。
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeStep1EntryDialog}>
              取消
            </Button>
            {step1EntryDialog && !step1EntryDialog.canIgnore && step1EntryDialogEpisode && (
              <Button
                onClick={() => {
                  const episode = step1EntryDialogEpisode;
                  closeStep1EntryDialog();
                  void handleGenerateEpisodeScriptProtected(episode);
                }}
                disabled={loading}
              >
                <Clapperboard className="mr-1.5 h-3.5 w-3.5" />
                生成本集剧本
              </Button>
            )}
            {step1EntryDialog?.canIgnore && step1DialogHasScriptIssue && step1EntryDialogEpisode && !step1EntryConfirming && (
              <Button
                variant="outline"
                onClick={() => {
                  const episode = step1EntryDialogEpisode;
                  closeStep1EntryDialog();
                  void handleRepairEpisodeScript(episode);
                }}
                disabled={loading}
              >
                <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                先修复本集稿
              </Button>
            )}
            {step1EntryDialog?.canIgnore && !step1EntryConfirming && (
              <Button
                variant="outline"
                className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:text-amber-200 dark:hover:bg-amber-950/30"
                onClick={() => setStep1EntryConfirming(true)}
              >
                忽略风险
              </Button>
            )}
            {step1EntryDialog?.canIgnore && step1EntryConfirming && (
              <Button variant="destructive" onClick={handleConfirmIgnoreStep1Risks}>
                确认忽略并进入 Step1
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
