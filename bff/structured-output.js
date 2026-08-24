const {
  STEP1_ARRAY_FIELD_SCHEMAS,
  STEP1_REQUIRED_ARRAY_KEYS,
  STEP1_REQUIRED_KEYS,
  STEP1_REQUIRED_STRING_KEYS,
  buildNestedValidationRuleLines,
} = require('./step1-contract');

function extractFromCodeBlock(text) {
  const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (jsonBlockMatch) {
    return jsonBlockMatch[1].trim();
  }

  const codeBlockMatch = text.match(/```\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const content = codeBlockMatch[1].trim();
    if (content.startsWith('{')) {
      return content;
    }
  }

  return null;
}

function extractAsRawJson(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }
  return null;
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

function findPartialJsonInText(text) {
  const startIdx = text.indexOf('{');
  if (startIdx === -1) return null;
  return text.slice(startIdx).trim();
}

function closeOpenJsonStructures(jsonStr) {
  const stack = [];
  let inString = false;
  let escape = false;

  for (const ch of jsonStr) {
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

    if (ch === '{') stack.push('}');
    if (ch === '[') stack.push(']');
    if (ch === '}' || ch === ']') {
      if (stack[stack.length - 1] === ch) stack.pop();
    }
  }

  let fixed = jsonStr.trim();
  if (inString) fixed += '"';
  while (stack.length > 0) fixed += stack.pop();
  return fixed;
}

function tryFixJsonIssues(jsonStr) {
  return jsonStr
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,\s*([}\]])/g, '$1');
}

function parseJsonCandidate(candidate) {
  const variants = [];
  const seen = new Set();
  const pushVariant = (value, repaired) => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    variants.push({ value: trimmed, repaired });
  };

  pushVariant(candidate, false);
  const fixed = tryFixJsonIssues(candidate);
  pushVariant(fixed, fixed !== candidate);
  const closed = closeOpenJsonStructures(fixed);
  pushVariant(closed, closed !== candidate);

  let lastReason = 'JSON parse failed';
  for (const variant of variants) {
    try {
      return { ok: true, parsed: JSON.parse(variant.value), repaired: variant.repaired };
    } catch (error) {
      lastReason = error instanceof Error ? error.message : 'JSON parse failed';
    }
  }

  return { ok: false, reason: lastReason };
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function parseStoryboardRange(range) {
  const normalizedRange = normalizeText(range);
  if (!normalizedRange) return null;

  const rangeMatch = normalizedRange.match(/分镜\s*(\d+)\s*[-—–到至]\s*(\d+)/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (!isPositiveInteger(start) || !isPositiveInteger(end) || end < start) return null;
    return { start, end };
  }

  const singleMatch = normalizedRange.match(/分镜\s*(\d+)/);
  if (!singleMatch) return null;

  const number = parseInt(singleMatch[1], 10);
  if (!isPositiveInteger(number)) return null;
  return { start: number, end: number };
}

function isValidStoryboardRange(range, knownStoryboardNumbers) {
  const parsed = parseStoryboardRange(range);
  if (!parsed) return false;

  for (let number = parsed.start; number <= parsed.end; number += 1) {
    if (!knownStoryboardNumbers.has(number)) return false;
  }

  return true;
}

const DETACHABLE_WEAPON_OR_PROP_PATTERN =
  /(?:肩挂|背负|手持|握着|拿着|提着|持有|携带|腰悬|腰挂|装备|配有|配着|佩戴|挂着|便于持)?[^，。；、]{0,8}(?:旧式步枪|步枪|手枪|短枪|枪械|枪口|枪托|玄火纹长剑|长剑|短剑|佩剑|持剑|用剑|剑身|剑鞘|剑柄|剑锋|长刀|短刀|匕首|弓箭|弩|棍子|棍棒|长棍|短棍|铁棍|法器|法杖)/;

const SCENE_HUMAN_REFERENCE_PATTERN =
  /(?:人物|人影|人形|角色|伤员|医务人员|护工|同门|士兵|守备队员|巡逻者|持枪|持剑|尸体|脚尖外露|被钉|背刺|打斗|躺在|坐在|站在)/;

const ACTION_OR_STATE_CHARACTER_NAME_PATTERN =
  /(?:剑身|刀刃|枪口|指尖|手指|掌心|脚尖|后方|前方|仍与|连贯|相接|迅速|后撤|后退|压上|按住|贴住|抵住|刺入|贯穿|穿胸|推门|逃离|醒来|重生|围攻|打斗|背刺同门|画面|镜头|动作|绷带|血迹|渗液)/;

const NON_VISUAL_CHARACTER_LABEL_PATTERN =
  /^(?:镜头|画面|动作|旁白|对白|台词|内心OS|内心独白|世界观旁白|系统|系统播报|声音|音效|画外音|本镜|当前|时间段)/;

const ABSTRACT_NON_VISUAL_GROUP_NAME_PATTERN =
  /^(?:同门|敌人|对手|众人|人群|群体|守备队|守军|巡逻队|护卫队|守卫们|侍卫们|伤员们|杂役们)$/;

function isAllowedPropHolder(holder, knownCharacters) {
  const normalizedHolder = normalizeText(holder);
  if (!normalizedHolder) return true;
  return normalizedHolder === '无'
    || normalizedHolder === '场景道具'
    || normalizedHolder === '无/场景道具'
    || knownCharacters.has(normalizedHolder);
}

function findCharacterAssetWeaponField(obj) {
  const characterAssetFields = ['defaultOutfit', 'accessories', 'step3Description'];
  for (let index = 0; index < (obj.characterProfiles || []).length; index += 1) {
    const profile = obj.characterProfiles[index] || {};
    for (const field of characterAssetFields) {
      const value = normalizeText(profile[field]);
      if (value && DETACHABLE_WEAPON_OR_PROP_PATTERN.test(value)) {
        return { path: `characterProfiles[${index}].${field}`, value };
      }
    }
  }

  for (let index = 0; index < (obj.outfitTracking || []).length; index += 1) {
    const outfit = obj.outfitTracking[index] || {};
    const value = normalizeText(outfit.outfitDesc);
    if (value && DETACHABLE_WEAPON_OR_PROP_PATTERN.test(value)) {
      return { path: `outfitTracking[${index}].outfitDesc`, value };
    }
  }

  return null;
}

function looksLikeActionOrStateCharacterName(name) {
  const normalized = normalizeText(name);
  if (!normalized) return false;
  if (/[，。；：,.!?！？]/.test(normalized)) return true;
  if (NON_VISUAL_CHARACTER_LABEL_PATTERN.test(normalized)) return true;
  if (ABSTRACT_NON_VISUAL_GROUP_NAME_PATTERN.test(normalized)) return true;
  if (/(?:剑身|刀刃|枪口|指尖|手指|掌心|脚尖).*(?:压上|按住|贴住|抵住|相接|连贯|刺入|贯穿|后撤|后退)/.test(normalized)) {
    return true;
  }
  if (normalized.length >= 5 && ACTION_OR_STATE_CHARACTER_NAME_PATTERN.test(normalized)) {
    return true;
  }
  return false;
}

function findInvalidCharacterReference(obj, knownCharacters) {
  for (let index = 0; index < (obj.allCharacterNames || []).length; index += 1) {
    const characterName = normalizeText(obj.allCharacterNames[index]);
    if (looksLikeActionOrStateCharacterName(characterName)) {
      return {
        path: `allCharacterNames[${index}]`,
        value: obj.allCharacterNames[index],
        reason: 'must be a stable character name, not an action/state phrase',
      };
    }
  }

  const characterArrayFields = [
    { key: 'scenes', childKey: 'characters' },
    { key: 'storyboards', childKey: 'characters' },
  ];

  for (const { key, childKey } of characterArrayFields) {
    for (let index = 0; index < (obj[key] || []).length; index += 1) {
      const item = obj[key][index] || {};
      for (let childIndex = 0; childIndex < (item[childKey] || []).length; childIndex += 1) {
        const characterName = normalizeText(item[childKey][childIndex]);
        if (looksLikeActionOrStateCharacterName(characterName)) {
          return {
            path: `${key}[${index}].${childKey}[${childIndex}]`,
            value: item[childKey][childIndex],
            reason: 'must be a stable character name, not an action/state phrase',
          };
        }
        if (characterName && !knownCharacters.has(characterName)) {
          return {
            path: `${key}[${index}].${childKey}[${childIndex}]`,
            value: item[childKey][childIndex],
            reason: 'must exactly match a name in allCharacterNames',
          };
        }
      }
    }
  }

  const singleCharacterFields = [
    { key: 'characterProfiles', childKey: 'name' },
    { key: 'outfitTracking', childKey: 'characterName' },
  ];

  for (const { key, childKey } of singleCharacterFields) {
    for (let index = 0; index < (obj[key] || []).length; index += 1) {
      const characterName = normalizeText(obj[key][index]?.[childKey]);
      if (looksLikeActionOrStateCharacterName(characterName)) {
        return {
          path: `${key}[${index}].${childKey}`,
          value: obj[key][index]?.[childKey],
          reason: 'must be a stable character name, not an action/state phrase',
        };
      }
      if (characterName && !knownCharacters.has(characterName)) {
        return {
          path: `${key}[${index}].${childKey}`,
          value: obj[key][index]?.[childKey],
          reason: 'must exactly match a name in allCharacterNames',
        };
      }
    }
  }

  return null;
}

function findUnreferencedCharacterName(obj, knownCharacters) {
  const referencedCharacters = new Set();

  for (const scene of obj.scenes || []) {
    for (const name of scene?.characters || []) {
      const characterName = normalizeText(name);
      if (characterName) referencedCharacters.add(characterName);
    }
  }

  for (const storyboard of obj.storyboards || []) {
    for (const name of storyboard?.characters || []) {
      const characterName = normalizeText(name);
      if (characterName) referencedCharacters.add(characterName);
    }
  }

  for (const characterName of knownCharacters) {
    if (!referencedCharacters.has(characterName)) {
      return characterName;
    }
  }

  return null;
}

function findInvalidStoryboardRangeReference(obj, knownStoryboardNumbers) {
  const trackerFields = [
    { key: 'outfitTracking', nameKey: 'characterName' },
    { key: 'propTracking', nameKey: 'propName' },
  ];

  for (const { key, nameKey } of trackerFields) {
    for (let index = 0; index < (obj[key] || []).length; index += 1) {
      const item = obj[key][index] || {};
      if (!isValidStoryboardRange(item.storyboardRange, knownStoryboardNumbers)) {
        return {
          path: `${key}[${index}].storyboardRange`,
          value: item.storyboardRange,
          label: item[nameKey],
        };
      }
    }
  }

  return null;
}

function findSceneAssetHumanReference(obj, knownCharacters) {
  for (let index = 0; index < (obj.scenes || []).length; index += 1) {
    const scene = obj.scenes[index] || {};
    const value = normalizeText(scene.step3Description)
      .replace(/无人物|无人影|无人形|无角色/g, '');
    if (!value) continue;

    for (const characterName of knownCharacters) {
      if (characterName && value.includes(characterName)) {
        return { path: `scenes[${index}].step3Description`, value, match: characterName };
      }
    }

    const genericMatch = value.match(SCENE_HUMAN_REFERENCE_PATTERN);
    if (genericMatch) {
      return { path: `scenes[${index}].step3Description`, value, match: genericMatch[0] };
    }
  }

  return null;
}

function validateStep1AnalysisPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'Step1 output must be a JSON object' };
  }

  const obj = payload;

  for (const key of STEP1_REQUIRED_KEYS) {
    if (!(key in obj)) {
      return { ok: false, reason: `Missing required top-level field: ${key}` };
    }
  }

  for (const key of STEP1_REQUIRED_STRING_KEYS) {
    if (typeof obj[key] !== 'string') {
      return { ok: false, reason: `Field ${key} must be a string` };
    }
  }

  for (const key of STEP1_REQUIRED_ARRAY_KEYS) {
    if (!Array.isArray(obj[key])) {
      return { ok: false, reason: `Field ${key} must be an array` };
    }
  }

  for (const key of STEP1_REQUIRED_ARRAY_KEYS) {
    const fieldSchema = STEP1_ARRAY_FIELD_SCHEMAS[key];
    const fieldValue = obj[key];

    if (!fieldSchema || !Array.isArray(fieldValue)) continue;

    if (fieldSchema.itemType === 'string') {
      const invalidIndex = fieldValue.findIndex((item) => typeof item !== 'string');
      if (invalidIndex !== -1) {
        return { ok: false, reason: `Field ${key}[${invalidIndex}] must be a string` };
      }
      continue;
    }

    if (fieldSchema.itemType === 'object') {
      for (let index = 0; index < fieldValue.length; index += 1) {
        const item = fieldValue[index];
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return { ok: false, reason: `Field ${key}[${index}] must be an object` };
        }

        for (const itemField of fieldSchema.itemFields || []) {
          if (!(itemField.key in item)) {
            return { ok: false, reason: `Field ${key}[${index}].${itemField.key} is required` };
          }

          const value = item[itemField.key];
          if (itemField.type === 'string' && typeof value !== 'string') {
            return { ok: false, reason: `Field ${key}[${index}].${itemField.key} must be a string` };
          }
          if (itemField.type === 'number' && typeof value !== 'number') {
            return { ok: false, reason: `Field ${key}[${index}].${itemField.key} must be a number` };
          }
          if (itemField.type === 'boolean' && typeof value !== 'boolean') {
            return { ok: false, reason: `Field ${key}[${index}].${itemField.key} must be a boolean` };
          }
          if (itemField.type === 'array') {
            if (!Array.isArray(value)) {
              return { ok: false, reason: `Field ${key}[${index}].${itemField.key} must be an array` };
            }
            if (itemField.itemType === 'string') {
              const invalidChildIndex = value.findIndex((child) => typeof child !== 'string');
              if (invalidChildIndex !== -1) {
                return {
                  ok: false,
                  reason: `Field ${key}[${index}].${itemField.key}[${invalidChildIndex}] must be a string`,
                };
              }
            }
          }
        }
      }
    }
  }

  const knownCharacters = new Set((obj.allCharacterNames || []).map(normalizeText).filter(Boolean));
  const knownStoryboardNumbers = new Set((obj.storyboards || []).map((storyboard) => storyboard.number).filter(isPositiveInteger));

  const emptyShotSizeIndex = (obj.storyboards || []).findIndex((storyboard) => !normalizeText(storyboard?.shotSize));
  if (emptyShotSizeIndex !== -1) {
    return {
      ok: false,
      reason: `Field storyboards[${emptyShotSizeIndex}].shotSize must not be empty; infer a concrete shot size`,
    };
  }

  const invalidCharacterReference = findInvalidCharacterReference(obj, knownCharacters);
  if (invalidCharacterReference) {
    return {
      ok: false,
      reason: `Field ${invalidCharacterReference.path} ${invalidCharacterReference.reason}; got "${invalidCharacterReference.value}"`,
    };
  }

  const unreferencedCharacterName = findUnreferencedCharacterName(obj, knownCharacters);
  if (unreferencedCharacterName) {
    return {
      ok: false,
      reason: `Field allCharacterNames contains unreferenced character "${unreferencedCharacterName}"; every character must appear in scenes[].characters or storyboards[].characters`,
    };
  }

  const invalidStoryboardRange = findInvalidStoryboardRangeReference(obj, knownStoryboardNumbers);
  if (invalidStoryboardRange) {
    return {
      ok: false,
      reason: `Field ${invalidStoryboardRange.path} must reference existing storyboard numbers; got "${invalidStoryboardRange.value}" for "${invalidStoryboardRange.label}"`,
    };
  }

  const sceneHumanField = findSceneAssetHumanReference(obj, knownCharacters);
  if (sceneHumanField) {
    return {
      ok: false,
      reason: `Field ${sceneHumanField.path} must describe an empty environment scene asset; remove character/human reference "${sceneHumanField.match}", got "${sceneHumanField.value}"`,
    };
  }

  const weaponField = findCharacterAssetWeaponField(obj);
  if (weaponField) {
    return {
      ok: false,
      reason: `Field ${weaponField.path} contains detachable weapon/prop text; move weapons and props to propTracking, got "${weaponField.value}"`,
    };
  }

  for (let index = 0; index < (obj.propTracking || []).length; index += 1) {
    const prop = obj.propTracking[index];
    if (!isAllowedPropHolder(prop.holder, knownCharacters)) {
      return {
        ok: false,
        reason: `Field propTracking[${index}].holder must be a known character name or 场景道具/无, got "${prop.holder}"`,
      };
    }
  }

  return { ok: true };
}

function getDefaultFieldValue(field) {
  if (field.type === 'string') return '';
  if (field.type === 'number') return 0;
  if (field.type === 'boolean') return false;
  if (field.type === 'array') return [];
  return '';
}

function coerceFieldValue(value, field) {
  if (value === null || value === undefined) return getDefaultFieldValue(field);
  if (field.type === 'string') return typeof value === 'string' ? value : String(value);
  if (field.type === 'number') {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : 0;
  }
  if (field.type === 'boolean') return typeof value === 'boolean' ? value : Boolean(value);
  if (field.type === 'array') return Array.isArray(value) ? value : [];
  return value;
}

function coerceStep1PayloadForValidation(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;

  const presentRequiredKeys = STEP1_REQUIRED_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(payload, key),
  ).length;
  if (presentRequiredKeys < Math.ceil(STEP1_REQUIRED_KEYS.length * 0.7)) {
    return payload;
  }

  const cloned = JSON.parse(JSON.stringify(payload));

  for (const key of STEP1_REQUIRED_STRING_KEYS) {
    if (cloned[key] === null || cloned[key] === undefined) cloned[key] = '';
  }
  for (const key of STEP1_REQUIRED_ARRAY_KEYS) {
    if (!Array.isArray(cloned[key])) cloned[key] = [];
  }

  for (const key of STEP1_REQUIRED_ARRAY_KEYS) {
    const fieldSchema = STEP1_ARRAY_FIELD_SCHEMAS[key];
    if (!fieldSchema || fieldSchema.itemType !== 'object' || !Array.isArray(cloned[key])) continue;

    cloned[key] = cloned[key]
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => {
        const nextItem = { ...item };
        for (const itemField of fieldSchema.itemFields || []) {
          nextItem[itemField.key] = coerceFieldValue(nextItem[itemField.key], itemField);
        }
        return nextItem;
      });
  }

  return cloned;
}

function normalizeStep1AnalysisContent(content) {
  if (typeof content !== 'string' || !content.trim()) {
    return { ok: false, reason: 'Step1 output is empty' };
  }

  const candidates = [];
  const seen = new Set();
  const pushCandidate = (value, source) => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push({ source, value: trimmed });
  };

  pushCandidate(extractAsRawJson(content), 'raw-json');
  pushCandidate(extractFromCodeBlock(content), 'code-block');
  pushCandidate(findJsonInText(content), 'embedded-json');
  pushCandidate(findPartialJsonInText(content), 'partial-json');

  let lastReason = 'Step1 output is not valid JSON';

  for (const candidate of candidates) {
    const parsedResult = parseJsonCandidate(candidate.value);
    if (!parsedResult.ok) {
      lastReason = parsedResult.reason;
      continue;
    }

    const validation = validateStep1AnalysisPayload(parsedResult.parsed);
    if (validation.ok) {
      return {
        ok: true,
        source: candidate.source,
        repaired: parsedResult.repaired,
        payload: parsedResult.parsed,
        content: JSON.stringify(parsedResult.parsed),
      };
    }

    const coercedPayload = coerceStep1PayloadForValidation(parsedResult.parsed);
    const coercedValidation = coercedPayload === parsedResult.parsed
      ? validation
      : validateStep1AnalysisPayload(coercedPayload);
    if (coercedValidation.ok) {
      return {
        ok: true,
        source: `${candidate.source}:local-coerce`,
        repaired: true,
        payload: coercedPayload,
        content: JSON.stringify(coercedPayload),
      };
    }

    lastReason = coercedValidation.reason || validation.reason;
  }

  return { ok: false, reason: lastReason };
}

function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part.text === 'string') return part.text;
      if (part && typeof part.content === 'string') return part.content;
      return '';
    })
    .join('');
}

function unwrapResponseEnvelope(data) {
  if (!data || typeof data !== 'object' || !data.data || typeof data.data !== 'object') {
    return data;
  }
  return data.data;
}

function extractContentFromChatResponse(data) {
  const body = unwrapResponseEnvelope(data);
  const textContent = extractTextContent(body?.choices?.[0]?.message?.content);
  if (textContent) return textContent;

  if (typeof body?.choices?.[0]?.text === 'string') {
    return body.choices[0].text;
  }

  return '';
}

function replaceContentInChatResponse(data, content) {
  const cloned = data && typeof data === 'object'
    ? JSON.parse(JSON.stringify(data))
    : {};
  const target = unwrapResponseEnvelope(cloned) || cloned;

  if (!Array.isArray(target.choices) || target.choices.length === 0) {
    target.choices = [{ message: { role: 'assistant', content } }];
    return cloned;
  }

  const firstChoice = target.choices[0] && typeof target.choices[0] === 'object'
    ? target.choices[0]
    : {};

  const message = firstChoice.message && typeof firstChoice.message === 'object'
    ? firstChoice.message
    : { role: 'assistant' };

  message.content = content;
  if (!message.role) {
    message.role = 'assistant';
  }

  firstChoice.message = message;
  target.choices[0] = firstChoice;
  return cloned;
}

function buildStep1RepairPrompt(reason) {
  return [
    '你刚才的 Step1 输出没有通过结构化校验，请重新输出。',
    `失败原因：${reason}`,
    '这一次必须满足以下硬约束：',
    '1. 只输出单个合法 JSON 对象，不要输出 markdown、代码块、解释、注释或额外说明。',
    `2. 顶层字段必须完整出现：${STEP1_REQUIRED_KEYS.join(', ')}。`,
    '3. 取不到的字段使用 [] 或 ""，不要省略字段，不要输出 null。',
    '4. 顶层字段的类型必须正确：字符串字段是 string，数组字段是 array。',
    `5. 嵌套结构也必须完整：${buildNestedValidationRuleLines().join('；')}`,
    '6. propTracking[].holder 只能是 allCharacterNames 中的角色名，或“场景道具 / 无 / 无/场景道具”；不要把容器、位置、场景、家具、药柜、铁盆、床边、桌面、地面、身体部位或另一个道具写成 holder。',
    '7. characterProfiles.defaultOutfit/accessories/step3Description 与 outfitTracking.outfitDesc 只能写衣物、护甲、发型、头饰和不可分离配饰；枪械、刀剑、棍棒、法器、手持物、肩挂/背负武器必须进入 propTracking，不要进入角色定妆或服装。',
    '8. propTracking[].needsTracking 和 needsImage 默认只在 storyboardRange 覆盖两个或更多分镜时为 true；单分镜一次性道具默认 false。',
    '9. scenes[].step3Description 必须是纯环境无人场景设定图描述；不要出现角色名、人物、人影、人形、伤员、士兵、医务人员、尸体、持枪/持剑人影或剧情动作瞬间。',
    '10. storyboards[].shotSize 必须保守推断一个可执行景别，如“全景”“中景”“近景”“特写”“手持跟拍中景”，不要输出空字符串。',
    '11. scenes[].characters、storyboards[].characters、characterProfiles[].name、outfitTracking[].characterName 必须只使用 allCharacterNames 中已有的稳定角色名；不要把“对白”“台词”“内心OS”“系统播报”“守备队”“剑身仍与后方同门连贯相接”“出手后迅速后撤”“指尖压上绷带”等语音通道、抽象组织、动作/身体部位/道具状态短语写成角色。未命名、只承担背景反应或短句功能的小角色优先合并成稳定群像角色；只有持续参与冲突、需要特写或会跨分镜复用的人物才单独建名。',
    '12. allCharacterNames 中的每个角色都必须至少出现在 scenes[].characters 或 storyboards[].characters；outfitTracking[].storyboardRange 与 propTracking[].storyboardRange 必须是非空且命中已有分镜编号的范围，如“分镜01”或“分镜01-03”，禁止输出空数组、空字符串或不存在的分镜号。',
  ].join('\n');
}

module.exports = {
  buildStep1RepairPrompt,
  extractContentFromChatResponse,
  normalizeStep1AnalysisContent,
  replaceContentInChatResponse,
  validateStep1AnalysisPayload,
};
