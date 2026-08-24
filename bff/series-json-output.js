const SERIES_JSON_TEMPLATE_TYPES = new Set([
  'series_concept_analyze',
  'series_concept_alignment_check',
  'series_bible_generate',
  'series_episode_cards_generate',
  'series_step0_quality_check',
  'series_step0_quality_repair',
  'series_episode_settle',
]);

const SERIES_TEMPLATE_LABELS = {
  series_concept_analyze: 'concept analysis',
  series_concept_alignment_check: 'concept alignment check',
  series_bible_generate: '系列圣经',
  series_episode_cards_generate: '分集爽点卡',
  series_step0_quality_check: 'Step0 质量检查',
  series_step0_quality_repair: 'Step0 质量修复',
  series_episode_settle: '系列连续性运行时记忆',
};

function isSeriesJsonTemplateType(templateType) {
  return SERIES_JSON_TEMPLATE_TYPES.has(templateType);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function extractFromCodeBlock(text) {
  const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (jsonBlockMatch) return jsonBlockMatch[1].trim();

  const codeBlockMatch = text.match(/```\s*([\s\S]*?)```/);
  if (!codeBlockMatch) return null;
  const content = codeBlockMatch[1].trim();
  return content.startsWith('{') ? content : null;
}

function extractAsRawJson(text) {
  const trimmed = text.trim();
  return trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed : null;
}

function findJsonInText(text) {
  const startIdx = text.indexOf('{');
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < text.length; i += 1) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;

    if (depth === 0) {
      return text.slice(startIdx, i + 1);
    }
  }

  return null;
}

function tryFixJsonIssues(jsonStr) {
  return jsonStr
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,\s*([}\]])/g, '$1');
}

function parseJsonCandidate(candidate) {
  try {
    return { ok: true, parsed: JSON.parse(candidate), repaired: false };
  } catch (error) {
    const fixed = tryFixJsonIssues(candidate);
    if (fixed === candidate) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : 'JSON parse failed',
      };
    }

    try {
      return { ok: true, parsed: JSON.parse(fixed), repaired: true };
    } catch (fixedError) {
      return {
        ok: false,
        reason: fixedError instanceof Error ? fixedError.message : 'JSON parse failed after fix',
      };
    }
  }
}

function requireField(obj, key, predicate, expected) {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    return `Missing required top-level field: ${key}`;
  }
  if (!predicate(obj[key])) {
    return `${key} must be ${expected}`;
  }
  return null;
}

const PRODUCTION_ASSET_CATEGORIES = new Set([
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
]);

const PRODUCTION_ASSET_STATUSES = new Set(['planned', 'used', 'adHoc', 'promoted']);

const SERIES_EPISODE_TYPES = new Set([
  'premise_hook',
  'rule_reveal',
  'unit_event',
  'relationship_contrast',
  'villain_probe',
  'major_payoff',
  'long_secret',
  'bridge_resolution',
]);

function validateProductionAsset(asset, index, path = 'productionAssets') {
  if (!isObject(asset)) return `${path}[${index}] must be an object`;

  const requiredStringFields = [
    'id',
    'name',
    'genreUse',
    'episodeRange',
    'visualAnchor',
    'storyFunction',
    'conflictRule',
    'assetNeed',
    'reuseLevel',
  ];
  for (const field of requiredStringFields) {
    const reason = requireField(asset, field, (value) => typeof value === 'string', 'a string');
    if (reason) return `${path}[${index}].${reason}`;
  }

  const categoryReason = requireField(
    asset,
    'category',
    (value) => typeof value === 'string' && PRODUCTION_ASSET_CATEGORIES.has(value),
    'a supported production asset category',
  );
  if (categoryReason) return `${path}[${index}].${categoryReason}`;

  const statusReason = requireField(
    asset,
    'status',
    (value) => typeof value === 'string' && PRODUCTION_ASSET_STATUSES.has(value),
    'planned, used, adHoc, or promoted',
  );
  if (statusReason) return `${path}[${index}].${statusReason}`;

  return null;
}

function validateAdHocAsset(asset, index, path) {
  if (!isObject(asset)) return `${path}[${index}] must be an object`;

  const requiredStringFields = ['id', 'name', 'reason', 'visualAnchor', 'assetNeed'];
  for (const field of requiredStringFields) {
    const reason = requireField(asset, field, (value) => typeof value === 'string', 'a string');
    if (reason) return `${path}[${index}].${reason}`;
  }

  const categoryReason = requireField(
    asset,
    'category',
    (value) => typeof value === 'string' && PRODUCTION_ASSET_CATEGORIES.has(value),
    'a supported production asset category',
  );
  if (categoryReason) return `${path}[${index}].${categoryReason}`;

  for (const field of ['needsReference', 'promoteSuggestion']) {
    const reason = requireField(asset, field, (value) => typeof value === 'boolean', 'a boolean');
    if (reason) return `${path}[${index}].${reason}`;
  }

  return null;
}

function validateEpisodeCard(card, index) {
  if (!isObject(card)) return `episodeCards[${index}] must be an object`;

  const requiredStringFields = [
    'id',
    'episodeType',
    'title',
    'mainQuestion',
    'coreConflictAction',
    'openingHook',
    'satisfactionType',
    'satisfactionBeat',
    'visiblePayoffAction',
    'cliffhanger',
    'nextHookRequirement',
  ];
  for (const field of requiredStringFields) {
    const reason = requireField(card, field, (value) => typeof value === 'string', 'a string');
    if (reason) return `episodeCards[${index}].${reason}`;
  }

  if (!SERIES_EPISODE_TYPES.has(card.episodeType)) {
    return `episodeCards[${index}].episodeType must be a supported episode type`;
  }

  if (!Number.isInteger(card.episodeNumber) || card.episodeNumber <= 0) {
    return `episodeCards[${index}].episodeNumber must be a positive integer`;
  }

  const requiredArrayFields = ['pressureBeats', 'continuityIn', 'continuityOut', 'visualReuse', 'assetPlan', 'adHocAssets'];
  for (const field of requiredArrayFields) {
    const reason = requireField(card, field, Array.isArray, 'an array');
    if (reason) return `episodeCards[${index}].${reason}`;
  }

  const adHocAssets = card.adHocAssets;
  if (adHocAssets.length > 2) {
    return `episodeCards[${index}].adHocAssets must contain at most 2 items`;
  }
  for (let adHocIndex = 0; adHocIndex < adHocAssets.length; adHocIndex += 1) {
    const adHocReason = validateAdHocAsset(adHocAssets[adHocIndex], adHocIndex, `episodeCards[${index}].adHocAssets`);
    if (adHocReason) return adHocReason;
  }

  return null;
}

function validateSeriesConceptAnalysisPayload(payload) {
  if (!isObject(payload)) return { ok: false, reason: 'Top-level value must be a JSON object' };

  const requiredStringFields = [
    'conceptLogline',
    'coreStoryEngine',
    'audiencePromise',
    'viewpointEntry',
    'protagonistFantasy',
    'recommendedGenreMode',
  ];
  for (const field of requiredStringFields) {
    const reason = requireField(payload, field, (value) => typeof value === 'string', 'a string');
    if (reason) return { ok: false, reason };
  }

  const requiredArrayFields = [
    'episodeEnginePattern',
    'characterVoiceRules',
    'visualSatisfactionRules',
    'driftGuardrails',
    'worldRules',
    'mustKeepFacts',
    'mustKeepCharacters',
    'mustKeepMechanisms',
    'episodeFormula',
    'forbiddenDrift',
    'toneKeywords',
  ];
  for (const field of requiredArrayFields) {
    const reason = requireField(payload, field, Array.isArray, 'an array');
    if (reason) return { ok: false, reason };
  }

  const playRulesReason = validatePlayRules(payload.playRules);
  if (playRulesReason) return { ok: false, reason: playRulesReason };

  const updatedAtReason = requireField(
    payload,
    'updatedAt',
    (value) => typeof value === 'number' && Number.isFinite(value),
    'a finite number',
  );
  if (updatedAtReason) return { ok: false, reason: updatedAtReason };

  return { ok: true, value: payload };
}

function validatePlayRules(playRules) {
  if (!isObject(playRules)) return 'playRules must be an object';
  const requiredStringFields = [
    'audienceEntry',
    'recurringHook',
    'payoffLoop',
    'escalationRule',
    'assetRotationRule',
    'protagonistActionRule',
    'forbiddenShortcut',
  ];
  for (const field of requiredStringFields) {
    const reason = requireField(playRules, field, (value) => typeof value === 'string', 'a string');
    if (reason) return `playRules.${reason}`;
  }
  return null;
}

function validateSeriesConceptAlignmentPayload(payload) {
  if (!isObject(payload)) return { ok: false, reason: 'Top-level value must be a JSON object' };

  const requiredFields = [
    ['aligned', (value) => typeof value === 'boolean', 'a boolean'],
    ['riskLevel', (value) => ['low', 'medium', 'high'].includes(value), 'low, medium, or high'],
    ['missingMustKeep', Array.isArray, 'an array'],
    ['driftRisks', Array.isArray, 'an array'],
    ['repairInstructions', Array.isArray, 'an array'],
    ['updatedAt', (value) => typeof value === 'number' && Number.isFinite(value), 'a finite number'],
  ];

  for (const [key, predicate, expected] of requiredFields) {
    const reason = requireField(payload, key, predicate, expected);
    if (reason) return { ok: false, reason };
  }

  return { ok: true, value: payload };
}

function validateSeriesBiblePayload(payload) {
  if (!isObject(payload)) return { ok: false, reason: 'Top-level value must be a JSON object' };

  const requiredFields = [
    ['premise', (value) => typeof value === 'string', 'a string'],
    ['genreMode', (value) => typeof value === 'string', 'a string'],
    ['tone', (value) => typeof value === 'string', 'a string'],
    ['characters', Array.isArray, 'an array'],
    ['longRunningSecrets', Array.isArray, 'an array'],
    ['recurringProps', Array.isArray, 'an array'],
    ['productionAssets', Array.isArray, 'an array'],
    ['episodeCards', Array.isArray, 'an array'],
    ['updatedAt', (value) => typeof value === 'number' && Number.isFinite(value), 'a finite number'],
  ];

  for (const [key, predicate, expected] of requiredFields) {
    const reason = requireField(payload, key, predicate, expected);
    if (reason) return { ok: false, reason };
  }

  if (payload.episodeCards.length !== 0) {
    return { ok: false, reason: 'episodeCards must stay an empty array during series bible generation' };
  }

  for (let index = 0; index < payload.productionAssets.length; index += 1) {
    const assetReason = validateProductionAsset(payload.productionAssets[index], index);
    if (assetReason) return { ok: false, reason: assetReason };
  }

  return { ok: true, value: payload };
}

function validateSeriesEpisodeCardsPayload(payload) {
  if (!isObject(payload)) return { ok: false, reason: 'Top-level value must be a JSON object' };

  const reason = requireField(payload, 'episodeCards', Array.isArray, 'an array');
  if (reason) return { ok: false, reason };
  if (payload.episodeCards.length === 0) {
    return { ok: false, reason: 'episodeCards must contain at least one episode card' };
  }

  for (let index = 0; index < payload.episodeCards.length; index += 1) {
    const cardReason = validateEpisodeCard(payload.episodeCards[index], index);
    if (cardReason) return { ok: false, reason: cardReason };
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'seasonRhythm')) {
    if (!Array.isArray(payload.seasonRhythm)) {
      return { ok: false, reason: 'seasonRhythm must be an array when provided' };
    }
    for (let index = 0; index < payload.seasonRhythm.length; index += 1) {
      const rhythmReason = validateSeasonRhythmBeat(payload.seasonRhythm[index], index);
      if (rhythmReason) return { ok: false, reason: rhythmReason };
    }
  }

  return { ok: true, value: payload };
}

function validateSeriesEpisodePatchPayload(payload) {
  if (!isObject(payload)) return { ok: false, reason: 'Top-level value must be a JSON object' };
  const hasEpisodeCards = Object.prototype.hasOwnProperty.call(payload, 'episodeCards');
  const hasSeasonRhythm = Object.prototype.hasOwnProperty.call(payload, 'seasonRhythm');
  if (!hasEpisodeCards && !hasSeasonRhythm) {
    return { ok: false, reason: 'Patch must include episodeCards or seasonRhythm' };
  }

  if (hasEpisodeCards) {
    if (!Array.isArray(payload.episodeCards)) {
      return { ok: false, reason: 'episodeCards must be an array when provided' };
    }
    if (payload.episodeCards.length === 0 && !hasSeasonRhythm) {
      return { ok: false, reason: 'episodeCards must contain at least one episode card' };
    }
    for (let index = 0; index < payload.episodeCards.length; index += 1) {
      const cardReason = validateEpisodeCard(payload.episodeCards[index], index);
      if (cardReason) return { ok: false, reason: cardReason };
    }
  }

  if (hasSeasonRhythm) {
    if (!Array.isArray(payload.seasonRhythm)) {
      return { ok: false, reason: 'seasonRhythm must be an array when provided' };
    }
    if (payload.seasonRhythm.length === 0 && !hasEpisodeCards) {
      return { ok: false, reason: 'seasonRhythm must contain at least one rhythm beat' };
    }
    for (let index = 0; index < payload.seasonRhythm.length; index += 1) {
      const rhythmReason = validateSeasonRhythmBeat(payload.seasonRhythm[index], index);
      if (rhythmReason) return { ok: false, reason: rhythmReason };
    }
  }

  return { ok: true, value: payload };
}

function validateSeasonRhythmBeat(beat, index) {
  if (!isObject(beat)) return `seasonRhythm[${index}] must be an object`;
  if (!Number.isInteger(beat.episodeNumber) || beat.episodeNumber <= 0) {
    return `seasonRhythm[${index}].episodeNumber must be a positive integer`;
  }
  const requiredStringFields = ['episodeType', 'role', 'requiredAsset', 'coreTurn', 'payoffPromise', 'nextHook'];
  for (const field of requiredStringFields) {
    const reason = requireField(beat, field, (value) => typeof value === 'string', 'a string');
    if (reason) return `seasonRhythm[${index}].${reason}`;
  }
  if (!SERIES_EPISODE_TYPES.has(beat.episodeType)) {
    return `seasonRhythm[${index}].episodeType must be a supported episode type`;
  }
  return null;
}

function validateStep0QualityReportPayload(payload) {
  if (!isObject(payload)) return { ok: false, reason: 'Top-level value must be a JSON object' };
  const requiredFields = [
    ['ok', (value) => typeof value === 'boolean', 'a boolean'],
    ['riskLevel', (value) => ['low', 'medium', 'high'].includes(value), 'low, medium, or high'],
    ['summary', (value) => typeof value === 'string', 'a string'],
    ['bibleIssues', Array.isArray, 'an array'],
    ['assetIssues', Array.isArray, 'an array'],
    ['rhythmIssues', Array.isArray, 'an array'],
    ['cardIssues', Array.isArray, 'an array'],
    ['repairInstructions', Array.isArray, 'an array'],
    ['updatedAt', (value) => typeof value === 'number' && Number.isFinite(value), 'a finite number'],
  ];
  for (const [key, predicate, expected] of requiredFields) {
    const reason = requireField(payload, key, predicate, expected);
    if (reason) return { ok: false, reason };
  }
  return { ok: true, value: payload };
}

function unwrapRuntimePayload(payload) {
  if (isObject(payload?.seriesRuntime)) return payload.seriesRuntime;
  if (isObject(payload?.runtime)) return payload.runtime;
  return payload;
}

function validateSeriesRuntimePayload(payload) {
  const runtime = unwrapRuntimePayload(payload);
  if (!isObject(runtime)) return { ok: false, reason: 'Top-level value must be a JSON object' };

  const requiredFields = [
    ['currentFocus', (value) => typeof value === 'string', 'a string'],
    ['episodeSummaries', Array.isArray, 'an array'],
    ['hookLedger', Array.isArray, 'an array'],
    ['characterContinuity', Array.isArray, 'an array'],
    ['propLedger', Array.isArray, 'an array'],
    ['updatedAt', (value) => typeof value === 'number' && Number.isFinite(value), 'a finite number'],
  ];

  for (const [key, predicate, expected] of requiredFields) {
    const reason = requireField(runtime, key, predicate, expected);
    if (reason) return { ok: false, reason };
  }

  return { ok: true, value: runtime };
}

function validateSeriesJsonPayload(payload, templateType) {
  switch (templateType) {
    case 'series_concept_analyze':
      return validateSeriesConceptAnalysisPayload(payload);
    case 'series_concept_alignment_check':
      return validateSeriesConceptAlignmentPayload(payload);
    case 'series_bible_generate':
      return validateSeriesBiblePayload(payload);
    case 'series_episode_cards_generate':
      return validateSeriesEpisodeCardsPayload(payload);
    case 'series_step0_quality_check':
      return validateStep0QualityReportPayload(payload);
    case 'series_step0_quality_repair':
      return validateSeriesEpisodePatchPayload(payload);
    case 'series_episode_settle':
      return validateSeriesRuntimePayload(payload);
    default:
      return { ok: false, reason: `Unsupported series JSON templateType: ${templateType}` };
  }
}

function normalizeSeriesJsonContent(content, templateType) {
  if (!isSeriesJsonTemplateType(templateType)) {
    return { ok: true, content: String(content ?? ''), repaired: false };
  }

  if (typeof content !== 'string' || !content.trim()) {
    return { ok: false, reason: 'Model output is empty' };
  }

  const candidate = extractFromCodeBlock(content) || extractAsRawJson(content) || findJsonInText(content);
  if (!candidate) {
    return { ok: false, reason: 'No JSON object found in model output' };
  }

  const parsed = parseJsonCandidate(candidate);
  if (!parsed.ok) return parsed;

  const validation = validateSeriesJsonPayload(parsed.parsed, templateType);
  if (!validation.ok) return validation;

  return {
    ok: true,
    content: JSON.stringify(validation.value),
    repaired: parsed.repaired || candidate.trim() !== content.trim(),
  };
}

function buildSeriesJsonRepairPrompt(templateType, reason) {
  const label = SERIES_TEMPLATE_LABELS[templateType] || 'Step0 JSON';
  const schemaRules = {
    series_concept_analyze: [
      'Top-level fields must include conceptLogline, coreStoryEngine, audiencePromise, viewpointEntry, protagonistFantasy, playRules, recommendedGenreMode, and updatedAt.',
      'playRules must include audienceEntry, recurringHook, payoffLoop, escalationRule, assetRotationRule, protagonistActionRule, and forbiddenShortcut.',
      'episodeEnginePattern, characterVoiceRules, visualSatisfactionRules, driftGuardrails, worldRules, mustKeepFacts, mustKeepCharacters, mustKeepMechanisms, episodeFormula, forbiddenDrift, and toneKeywords must be arrays. Use 0 for updatedAt.',
    ],
    series_concept_alignment_check: [
      'Top-level fields must include aligned, riskLevel, missingMustKeep, driftRisks, repairInstructions, and updatedAt.',
      'aligned must be boolean. riskLevel must be low, medium, or high. missingMustKeep, driftRisks, and repairInstructions must be arrays. Use 0 for updatedAt.',
    ],
    series_bible_generate: [
      '顶层必须包含 premise、genreMode、tone、characters、longRunningSecrets、recurringProps、productionAssets、episodeCards、updatedAt。',
      'characters、longRunningSecrets、recurringProps、productionAssets 必须是数组；episodeCards 必须是空数组 []；updatedAt 使用 0。',
      'productionAssets[].category 必须是支持的素材类型；status 必须是 planned、used、adHoc 或 promoted。',
    ],
    series_episode_cards_generate: [
      '顶层必须只输出对象，并包含 episodeCards 数组；整季生成或分批生成必须同时包含 seasonRhythm 数组，单集重做可以只返回目标 episodeCards。',
      'episodeCards[].episodeNumber 必须是正整数；id、episodeType、title、mainQuestion、coreConflictAction、openingHook、satisfactionType、satisfactionBeat、visiblePayoffAction、cliffhanger、nextHookRequirement 必须是字符串。',
      'episodeType 必须是 premise_hook、rule_reveal、unit_event、relationship_contrast、villain_probe、major_payoff、long_secret 或 bridge_resolution。',
      'episodeCards[].pressureBeats、continuityIn、continuityOut、visualReuse、assetPlan、adHocAssets 必须是数组。',
      'assetPlan 写本集使用的 productionAssets id 或名称；当 productionAssets 非空时每集 assetPlan 至少 1 个；adHocAssets 每集最多 2 个，且必须写清 reason、needsReference、promoteSuggestion。',
      '如果上一条要求只重做单集，只返回 1 张卡，并严格使用上一条要求里的目标集编号；如果上一条要求分批生成，只返回该批范围内的连续 episodeNumber。',
    ],
    series_step0_quality_check: [
      '顶层必须包含 ok、riskLevel、summary、bibleIssues、assetIssues、rhythmIssues、cardIssues、repairInstructions、updatedAt。',
      'ok 必须是 boolean；riskLevel 必须是 low、medium 或 high；四类 issues 和 repairInstructions 必须是数组；updatedAt 使用 0。',
    ],
    series_step0_quality_repair: [
      '顶层必须只输出对象，并包含 episodeCards 数组和 seasonRhythm 数组。',
      'episodeCards 字段要求与 series_episode_cards_generate 完全一致。',
      'episodeCards 和 seasonRhythm 必须覆盖质量修复请求里的完整目标集数，不得缺集、重复集或越界。',
      '只能按质量报告修复集卡和整季节奏表，不要重写人设圣经，不要新增长期角色。',
    ],
    series_episode_settle: [
      '直接输出 seriesRuntime 快照对象，不要包在 markdown 或解释文字里。',
      '顶层必须包含 currentFocus、episodeSummaries、hookLedger、characterContinuity、propLedger、updatedAt。',
      'episodeSummaries、hookLedger、characterContinuity、propLedger 必须是数组；updatedAt 使用 0。',
    ],
  };

  return [
    `刚才的 Step0 ${label} 输出没有通过服务端 JSON 稳定性校验，请重新输出。`,
    `失败原因：${reason}`,
    '',
    '## 输出硬规则',
    '- 只输出单个合法 JSON 对象，不要输出 markdown、代码块、解释、注释或额外说明。',
    '- 取不到的字段使用 ""、[] 或 0，不要省略字段，不要输出 null。',
    ...(schemaRules[templateType] || []),
    '- 内容仍然只能依据上一条输入 JSON 和系统规则，不要新增未给出的角色、道具、地点或长线。',
  ].join('\n');
}

module.exports = {
  buildSeriesJsonRepairPrompt,
  isSeriesJsonTemplateType,
  normalizeSeriesJsonContent,
  validateSeriesJsonPayload,
};
