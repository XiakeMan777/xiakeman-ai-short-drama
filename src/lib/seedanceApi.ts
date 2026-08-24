import type { VideoApiConfig, VideoBackendType } from '@/types';
import { normalizeWholeSecondVideoDuration } from '@/lib/storyboardDuration';

export const LOCAL_SEEDANCE_API_BASE = import.meta.env.DEV
  ? '/api/seedance'
  : 'http://127.0.0.1:8033/api';

export const DEFAULT_SEEDANCE_CLOUD_API_BASE = '/api/seedance-cloud';
export const DEFAULT_SEEDANCE_KREA_API_BASE = '/api/seedance-krea';
export const SEEDANCE_SERVICE_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export type SeedanceVideoResolution = VideoApiConfig['videoResolution'];
export const SEEDANCE_VIDEO_RESOLUTIONS = ['480p', '720p', '1080p', '4k'] as const satisfies readonly SeedanceVideoResolution[];
export const SEEDANCE_SERVICE_MODEL_OPTIONS = [
  {
    value: 'mini',
    label: 'Seedance2.0 Mini',
    shortLabel: 'Mini',
    detail: '低成本预览模型，适合快速跑通镜头；支持 480p / 720p。',
  },
  {
    value: 'fast',
    label: 'Seedance2.0 Fast',
    shortLabel: 'Fast',
    detail: '速度优先，适合批量预览和快速出片；支持 480p / 720p。',
  },
  {
    value: '2.0',
    label: 'Seedance2.0 满血',
    shortLabel: 'Seedance 2.0',
    detail: '质量优先，适合关键镜头和最终成片；支持 480p / 720p / 1080p / 4K。',
  },
  {
    value: 'transit9-fast',
    label: '特价 SD2 FAST',
    shortLabel: '特价 FAST',
    detail: '虾客漫 SD2 特价快速模型，仅支持 720p。',
  },
  {
    value: 'transit9-2.0',
    label: '特价 SD2 满血',
    shortLabel: '特价满血',
    detail: '虾客漫 SD2 特价满血模型，支持 720p 或 1080p。',
  },
  {
    value: 'fofo',
    label: '测试模型',
    shortLabel: '测试模型',
    detail: '虾客漫 SD2 测试模型，内部提交模型名为 fofo。',
  },
] as const;

export type SeedanceServiceModel = (typeof SEEDANCE_SERVICE_MODEL_OPTIONS)[number]['value'];

export const SEEDANCE_SERVICE_MODELS = SEEDANCE_SERVICE_MODEL_OPTIONS.map((option) => option.value);
export const SEEDANCE_SERVICE_VISIBLE_MODEL_OPTIONS = SEEDANCE_SERVICE_MODEL_OPTIONS.filter(
  (option) => option.value !== 'transit9-fast'
    && option.value !== 'transit9-2.0'
    && option.value !== 'fofo',
);
const SEEDANCE_SERVICE_VISIBLE_MODELS = SEEDANCE_SERVICE_VISIBLE_MODEL_OPTIONS.map((option) => option.value);

const LEGACY_LOCAL_SEEDANCE_CLOUD_BASES = new Set([
  '/api/seedance-cloud',
  'https://sd2.xiakeman.com',
  'https://sd2.xiakeman.com/api',
  'http://127.0.0.1:8034',
  'http://127.0.0.1:8034/api',
  'http://localhost:8034',
  'http://localhost:8034/api',
]);

const SEEDANCE_CLOUD_PROXY_ALIASES = new Map([
  ...Array.from(LEGACY_LOCAL_SEEDANCE_CLOUD_BASES, (base) => [base, DEFAULT_SEEDANCE_CLOUD_API_BASE] as const),
]);

export function isSeedanceServiceBackend(backend: VideoBackendType | undefined) {
  return backend === 'seedance' || backend === 'seedancecloud';
}

export function isSeedanceCloudBackend(backend: VideoBackendType | undefined) {
  return backend === 'seedancecloud';
}

export function normalizeSeedanceServiceDuration(value: number | string | undefined | null) {
  return normalizeWholeSecondVideoDuration(value, 10);
}

export function normalizeSeedanceServiceModel(value: string | undefined | null): SeedanceServiceModel {
  const normalized = (value ?? '').trim();
  return (SEEDANCE_SERVICE_MODELS as readonly string[]).includes(normalized)
    ? normalized as SeedanceServiceModel
    : 'fast';
}

export function normalizeVisibleSeedanceServiceModel(value: string | undefined | null): SeedanceServiceModel {
  const normalized = normalizeSeedanceServiceModel(value);
  return (SEEDANCE_SERVICE_VISIBLE_MODELS as readonly string[]).includes(normalized)
    ? normalized
    : 'fast';
}

export function isTransit9SeedanceModel(value: string | undefined | null) {
  const normalized = (value ?? '').trim();
  return normalized === 'transit9-fast' || normalized === 'transit9-2.0';
}

export function normalizeSeedanceVideoResolution(
  value: string | undefined | null,
  fallback: SeedanceVideoResolution = '720p',
): SeedanceVideoResolution {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === '480p' || normalized === '720p' || normalized === '1080p' || normalized === '4k') {
    return normalized as SeedanceVideoResolution;
  }
  return fallback;
}

export function getSeedanceResolutionOptions(
  model: string | undefined | null,
): readonly SeedanceVideoResolution[] {
  const normalized = normalizeSeedanceServiceModel(model);
  if (normalized === 'mini' || normalized === 'fast') return ['480p', '720p'];
  if (normalized === '2.0') return ['480p', '720p', '1080p', '4k'];
  if (normalized === 'transit9-fast') return ['720p'];
  if (normalized === 'transit9-2.0') return ['720p', '1080p'];
  return ['720p'];
}

export function normalizeSeedanceServiceResolution(
  model: string | undefined | null,
  resolution: string | undefined | null,
): SeedanceVideoResolution {
  const requested = normalizeSeedanceVideoResolution(resolution);
  const options = getSeedanceResolutionOptions(model);
  if (options.includes(requested)) return requested;
  return options.includes('720p') ? '720p' : options[0] ?? '720p';
}

export function getSeedanceTransit9Resolution(
  model: string | undefined | null,
  resolution: string | undefined | null,
): SeedanceVideoResolution | undefined {
  const normalized = normalizeSeedanceServiceModel(model);
  if (!(SEEDANCE_SERVICE_MODELS as readonly string[]).includes(normalized)) return undefined;
  return normalizeSeedanceServiceResolution(normalized, resolution);
}

export function normalizeSeedanceCloudBaseUrl(value: string | undefined) {
  const normalizedInput = (value ?? '').trim().replace(/\/+$/, '');
  const raw = !normalizedInput
    ? DEFAULT_SEEDANCE_CLOUD_API_BASE
    : SEEDANCE_CLOUD_PROXY_ALIASES.get(normalizedInput) ?? normalizedInput;
  const trimmed = raw.replace(/\/+$/, '');

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.pathname === '' || parsed.pathname === '/') {
      parsed.pathname = '/api';
      return parsed.toString().replace(/\/+$/, '');
    }
  } catch {
    // Relative paths such as /api/seedance-cloud are valid in the browser.
  }

  return trimmed;
}

export function getSeedanceCloudLicenseKey(
  config: Pick<VideoApiConfig, 'seedanceCloudLicenseKey' | 'seedanceCloudUserId'> | undefined,
) {
  return (config?.seedanceCloudLicenseKey ?? config?.seedanceCloudUserId ?? '').trim();
}

export function getSeedanceApiBase(config?: Pick<VideoApiConfig, 'backend' | 'seedanceCloudBaseUrl'>) {
  if (config?.backend === 'seedancecloud') {
    return normalizeSeedanceCloudBaseUrl(config.seedanceCloudBaseUrl);
  }
  return LOCAL_SEEDANCE_API_BASE;
}

export function buildSeedanceFetchInit(
  config: Pick<VideoApiConfig, 'backend' | 'seedanceCloudLicenseKey' | 'seedanceCloudUserId'> | undefined,
  init: RequestInit = {},
): RequestInit {
  if (config?.backend !== 'seedancecloud') return init;

  const licenseKey = getSeedanceCloudLicenseKey(config);
  if (!licenseKey) return init;

  const headers = new Headers(init.headers);
  headers.set('X-License-Key', licenseKey);
  return { ...init, headers };
}

export function appendSeedanceCloudAuthQuery(
  url: string,
  config: Pick<VideoApiConfig, 'backend' | 'seedanceCloudLicenseKey' | 'seedanceCloudUserId'> | undefined,
) {
  if (config?.backend !== 'seedancecloud') return url;

  const licenseKey = getSeedanceCloudLicenseKey(config);
  if (!licenseKey) return url;

  try {
    const parsed = new URL(url, window.location.origin);
    parsed.searchParams.set('license_key', licenseKey);
    return parsed.toString();
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}license_key=${encodeURIComponent(licenseKey)}`;
  }
}

export const appendSeedanceCloudUserQuery = appendSeedanceCloudAuthQuery;
export const getSeedanceCloudUserId = getSeedanceCloudLicenseKey;
