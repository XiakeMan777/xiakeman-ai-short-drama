import { includesAnyTextVariant } from './mojibake';

const TRANSIENT_ERROR_PATTERN =
  /BFF Error \((?:429|5\d\d)\)|LLM API Error \((?:429|5\d\d)\)|(?:^|\D)(?:429|5\d\d)(?:\D|$)|upstream_error|Upstream request failed|BFF stream error|(?:API|BFF|LLM)\s+stream\s+ended\s+before\s+completion\s+marker|stream\s+ended\s+before\s+completion\s+marker|completion\s+marker|Failed to fetch|fetch\s+failed|NetworkError|network\s+error|ERR_NETWORK|Load failed|timeout|timed out|StoryboardStageTimeoutError|stalled|Internal Server Error|Bad Gateway|Gateway Timeout|temporarily|error decoding response body|response\.completed|non[-\s]?json|非\s*JSON|解析上游|读取上游.*失败|上游.*响应.*失败|流式生成超过\s*\d+\s*秒|没有收到模型输出|没有返回可见正文|生成超过\s*\d+\s*分钟未返回/i;

const TRANSIENT_NETWORK_ERROR_PATTERN =
  /unexpected\s+EOF|unexpected\s+end|connection\s+reset\s+by\s+peer|socket\s+hang\s+up|server\s+gave\s+HTTP\s+response\s+to\s+HTTPS\s+client|ECONNRESET|ETIMEDOUT|EAI_AGAIN|TLS handshake timeout|proxyconnect|connection\s+(?:closed|refused)/i;

const TRANSIENT_BACKGROUND_IMAGE_ERROR_PATTERN =
  /lease\s+expired|Cloud blob not found:\s*background-image-inputs\//i;

const TRANSIENT_TEXTS = [
  '卡住',
  '超时',
  '暂时',
  '稍后重试',
  '请求失败',
  '请求超时',
  '网络错误',
  '网络异常',
  '网络连接失败',
  'stream ended before completion marker',
  'completion marker',
  '超过 300 秒',
  '没有收到模型输出',
  '没有返回可见正文',
  '未返回',
  '服务繁忙',
  '系统繁忙',
  '上游请求失败',
  '上游响应失败',
];

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isTransientApiError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return (
    TRANSIENT_ERROR_PATTERN.test(message)
    || TRANSIENT_NETWORK_ERROR_PATTERN.test(message)
    || TRANSIENT_BACKGROUND_IMAGE_ERROR_PATTERN.test(message)
    || includesAnyTextVariant(message, TRANSIENT_TEXTS)
  );
}
