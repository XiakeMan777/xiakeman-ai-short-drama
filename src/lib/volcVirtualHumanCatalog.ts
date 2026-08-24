export interface VolcVirtualHuman {
  assetId: string;
  uri: string;
  name: string;
  thumbnailUrl: string;
  gender: string;
  ageGroup: string;
  nationality: string;
  age?: number;
  occupation?: string;
  tags: string[];
  bio: string;
}

const DEFAULT_CATALOG_URL = '/data/volc-virtual-humans.json';

function getCatalogUrl() {
  const configured = import.meta.env.VITE_VOLC_VIRTUAL_HUMAN_CATALOG_URL;
  return typeof configured === 'string' && configured.trim()
    ? configured.trim()
    : DEFAULT_CATALOG_URL;
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeString).filter(Boolean);
}

function normalizeGender(value: unknown) {
  const gender = normalizeString(value);
  if (gender.includes('女')) return '女';
  if (gender.includes('男')) return '男';
  return gender;
}

function normalizeNameGender(value: unknown) {
  return normalizeString(value)
    .replace(/\s+女性\s+/g, ' 女 ')
    .replace(/\s+男性\s+/g, ' 男 ');
}

function normalizeTags(value: unknown) {
  return normalizeStringArray(value).map((tag) => {
    if (tag === '女性') return '女';
    if (tag === '男性') return '男';
    return tag;
  });
}

function inferAgeGroup(age?: number) {
  if (typeof age !== 'number' || !Number.isFinite(age)) return '';
  if (age < 20) return '少年';
  if (age < 36) return '青年';
  if (age < 56) return '中年';
  return '长者';
}

function normalizeCatalogItem(value: unknown): VolcVirtualHuman | null {
  const item = value as Partial<VolcVirtualHuman>;
  const assetId = normalizeString(item.assetId);
  const name = normalizeNameGender(item.name);
  const gender = normalizeGender(item.gender);
  const nationality = normalizeString(item.nationality);
  const thumbnailUrl = normalizeString(item.thumbnailUrl);
  if (!assetId || !name || !gender) return null;

  const uri = normalizeString(item.uri);
  const age = typeof item.age === 'number' && Number.isFinite(item.age) ? item.age : undefined;
  const occupation = normalizeString(item.occupation);
  const tags = normalizeTags(item.tags);

  return {
    assetId,
    uri: uri.startsWith('asset://') ? uri : `asset://${assetId}`,
    name,
    thumbnailUrl,
    gender,
    age,
    ageGroup: normalizeString(item.ageGroup) || inferAgeGroup(age),
    nationality,
    occupation,
    tags,
    bio: normalizeString(item.bio) || [nationality, age ? `${age}岁` : '', gender, occupation].filter(Boolean).join(' '),
  };
}

export async function loadVolcVirtualHumanCatalog(): Promise<VolcVirtualHuman[]> {
  if (typeof fetch !== 'function') return [];

  try {
    const response = await fetch(getCatalogUrl(), { cache: 'no-store' });
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    return data.map(normalizeCatalogItem).filter((item): item is VolcVirtualHuman => item !== null);
  } catch {
    return [];
  }
}
