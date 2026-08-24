export interface ParsedVideoApiError {
  httpStatus?: number;
  code?: string;
  message?: string;
  detail?: string;
  rawText?: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function tryParseJson(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function decodeJsonEscapes(value: string): string {
  if (!/\\u[0-9a-fA-F]{4}|\\n|\\t|\\r/.test(value)) return value;
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return value;
  }
}

function parseMaybeJsonString(value: string): unknown {
  const decoded = decodeJsonEscapes(value);
  return tryParseJson(decoded) ?? tryParseJson(value) ?? decoded;
}

function getString(record: JsonRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return decodeJsonEscapes(value.trim());
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function getNumber(record: JsonRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function mergeParsedError(left: ParsedVideoApiError, right: ParsedVideoApiError): ParsedVideoApiError {
  return {
    httpStatus: left.httpStatus ?? right.httpStatus,
    code: left.code ?? right.code,
    message: left.message ?? right.message,
    detail: left.detail ?? right.detail,
    rawText: left.rawText ?? right.rawText,
  };
}

function parseErrorValue(value: unknown, depth = 0): ParsedVideoApiError {
  if (depth > 4 || value == null) return {};

  if (typeof value === 'string') {
    const parsed = parseMaybeJsonString(value);
    if (parsed !== value && parsed !== decodeJsonEscapes(value)) {
      return parseErrorValue(parsed, depth + 1);
    }
    const decoded = typeof parsed === 'string' ? parsed : decodeJsonEscapes(value);
    return { detail: decoded, rawText: value };
  }

  if (Array.isArray(value)) {
    return value.reduce<ParsedVideoApiError>(
      (acc, item) => mergeParsedError(acc, parseErrorValue(item, depth + 1)),
      {},
    );
  }

  if (!isRecord(value)) return {};

  const nestedError = parseErrorValue(value.error, depth + 1);
  const nestedDetail = parseErrorValue(value.detail, depth + 1);
  const nestedMetadata = parseErrorValue(value.metadata, depth + 1);
  const own: ParsedVideoApiError = {
    httpStatus: getNumber(value, ['httpStatus', 'statusCode', 'status_code']),
    code: getString(value, ['code', 'errorCode', 'error_code', 'status']),
    message: getString(value, ['message', 'msg', 'errorMsg', 'error_message']),
    detail: getString(value, ['detail', 'description', 'reason']),
  };

  return mergeParsedError(
    mergeParsedError(own, nestedError),
    mergeParsedError(nestedDetail, nestedMetadata),
  );
}

export function parseVideoApiError(raw: unknown, httpStatus?: number): ParsedVideoApiError {
  if (typeof raw !== 'string') {
    return { ...parseErrorValue(raw), httpStatus };
  }

  const trimmed = raw.trim();
  const statusFromPrefix = trimmed.match(/\((\d{3})\)/)?.[1];
  const firstJsonIndex = Math.min(
    ...['{', '[']
      .map((token) => trimmed.indexOf(token))
      .filter((index) => index >= 0),
  );
  const jsonCandidate = Number.isFinite(firstJsonIndex) ? trimmed.slice(firstJsonIndex) : trimmed;
  const parsedRoot = parseMaybeJsonString(jsonCandidate);
  const parsed = parseErrorValue(parsedRoot, 0);

  return {
    ...parsed,
    httpStatus: httpStatus ?? parsed.httpStatus ?? (statusFromPrefix ? Number(statusFromPrefix) : undefined),
    rawText: trimmed,
  };
}

export function formatVideoApiErrorMessage(message: string | undefined): string | undefined {
  const readable = message?.trim();
  if (!readable) return undefined;

  const normalized = readable.toLowerCase();
  if (
    normalized.includes('input or output video may contain sensitive information')
    || (normalized.includes('sensitive information') && normalized.includes('video'))
  ) {
    return '平台内容安全审核未通过：输入提示词或生成结果触发敏感内容检测。建议先使用“生成脱敏提示词”，再用脱敏版重新提交。';
  }
  if (
    normalized.includes('copyright-infringing images')
    || normalized.includes('copyright infringing images')
    || normalized.includes('copyright')
  ) {
    return '平台参考图版权检测未通过：某张参考图可能被判定为版权风险。请更换或弱化对应参考图后再重试，单纯脱敏提示词通常无法解决。';
  }
  if (normalized.includes('green net check failed') && normalized.includes('text input')) {
    return '平台文本安全审核未通过：提示词触发文本安全检测。可先使用“生成脱敏提示词”或手动删减高风险表述后，再由用户决定是否重试。';
  }
  if (normalized.includes('green net check failed')) {
    return '平台内容安全审核未通过：提交内容触发安全检测。请查看错误详情后手动调整并决定是否重试。';
  }

  return readable;
}

export function formatVideoHttpError(status: number, body: string, label = '提交失败'): string {
  const parsed = parseVideoApiError(body, status);
  const readable = formatVideoApiErrorMessage(
    parsed.message || parsed.detail || decodeJsonEscapes(body).trim(),
  ) ?? decodeJsonEscapes(body).trim();
  const code = parsed.code && parsed.code !== 'error' ? `[${parsed.code}] ` : '';
  return `${label} (${status}): ${code}${readable}`.slice(0, 800);
}

export function getRawVideoApiError(error: unknown): string | undefined {
  const rawBody = (error as { rawBody?: unknown } | null)?.rawBody;
  return typeof rawBody === 'string' ? rawBody : undefined;
}

export function attachRawVideoApiError(error: Error, rawBody: string): Error {
  (error as Error & { rawBody?: string }).rawBody = rawBody;
  return error;
}
