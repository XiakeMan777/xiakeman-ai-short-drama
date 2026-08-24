import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const DEFAULT_SOURCE_DIR = 'E:/B/volcengine_roles';
const DEFAULT_OUTPUT_DIR = path.join(repoRoot, 'public/data/volc-virtual-humans');
const DEFAULT_CATALOG_PATH = path.join(repoRoot, 'public/data/volc-virtual-humans.json');

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const [key, inlineValue] = arg.slice(2).split('=');
  const value = inlineValue ?? process.argv[i + 1];
  args.set(key, value);
  if (inlineValue === undefined) i += 1;
}

const sourceDir = path.resolve(args.get('source-dir') ?? DEFAULT_SOURCE_DIR);
const sourceJsonPath = path.resolve(args.get('source-json') ?? path.join(sourceDir, 'roles_all.json'));
const outputDir = path.resolve(args.get('output-dir') ?? DEFAULT_OUTPUT_DIR);
const catalogPath = path.resolve(args.get('catalog') ?? DEFAULT_CATALOG_PATH);
const imagesOutputDir = path.join(outputDir, 'images-webp');
const ffmpegBin = args.get('ffmpeg') ?? 'ffmpeg';
const quality = Number(args.get('quality') ?? 80);
const maxWidth = Number(args.get('max-width') ?? 512);
const concurrency = Number(args.get('concurrency') ?? 4);

function getAgeGroup(age) {
  if (!Number.isFinite(age)) return '';
  if (age < 20) return '少年';
  if (age < 36) return '青年';
  if (age < 56) return '中年';
  return '长者';
}

function normalizeGender(gender) {
  if (typeof gender !== 'string') return '';
  if (gender.includes('女')) return '女';
  if (gender.includes('男')) return '男';
  return gender.trim();
}

function normalizeTitleGender(title) {
  return title
    .replace(/\s+女性\s+/g, ' 女 ')
    .replace(/\s+男性\s+/g, ' 男 ');
}

function getTags(role) {
  const tags = new Set(['中国', normalizeGender(role.gender), getAgeGroup(role.age), role.occupation].filter(Boolean));
  if (role.age < 20) tags.add('青春');
  if (role.age >= 56) tags.add('熟龄');
  if (['演员', '模特', '歌手', '网红/主播', 'DJ/音乐制作人'].includes(role.occupation)) tags.add('表演');
  if (['企业高管', '银行柜员', '工程师', '科学家/研究员', '作家'].includes(role.occupation)) tags.add('职业');
  if (['农民', '果农', '养蜂人', '快递员', '外卖员', '司机', '保洁员', '工厂工人'].includes(role.occupation)) tags.add('生活感');
  return Array.from(tags);
}

function normalizeRole(role) {
  const assetId = typeof role.asset_id === 'string' ? role.asset_id.trim() : '';
  const title = typeof role.title === 'string' ? normalizeTitleGender(role.title.trim()) : '';
  const imagePath = typeof role.image_path === 'string' ? role.image_path.trim() : '';
  if (!assetId || !title || !imagePath) return null;

  const age = Number(role.age);
  const ageGroup = getAgeGroup(age);
  const gender = normalizeGender(role.gender);
  const thumbnailFile = `${assetId}.webp`;

  return {
    sourceIndex: role.index,
    assetId,
    uri: `asset://${assetId}`,
    name: title,
    thumbnailUrl: `/data/volc-virtual-humans/images-webp/${thumbnailFile}`,
    gender,
    age,
    ageGroup,
    nationality: role.country ?? '',
    occupation: role.occupation ?? '',
    tags: getTags({ ...role, age }),
    bio: [role.country, Number.isFinite(age) ? `${age}岁` : '', gender, role.occupation].filter(Boolean).join(' '),
    sourceObjectPath: role.source_object_path ?? '',
    originalImageBytes: role.image_bytes ?? undefined,
    _sourceImagePath: imagePath,
    _thumbnailFile: thumbnailFile,
  };
}

function runFfmpeg(inputPath, outputPath) {
  const ffmpegArgs = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-vf',
    `scale='min(${maxWidth},iw)':-2`,
    '-c:v',
    'libwebp',
    '-quality',
    String(quality),
    '-compression_level',
    '6',
    outputPath,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed for ${inputPath}: ${stderr || `exit ${code}`}`));
    });
  });
}

async function runPool(items, worker, limit) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const raw = JSON.parse(await fs.readFile(sourceJsonPath, 'utf8'));
  if (!Array.isArray(raw)) throw new Error(`Expected an array in ${sourceJsonPath}`);

  const normalized = raw.map(normalizeRole).filter(Boolean);
  const seen = new Set();
  const catalogWithPrivateFields = [];
  const duplicates = [];
  const missingImages = [];

  for (const item of normalized) {
    if (seen.has(item.assetId)) {
      duplicates.push(item.assetId);
      continue;
    }
    seen.add(item.assetId);
    if (!existsSync(item._sourceImagePath)) missingImages.push(item._sourceImagePath);
    catalogWithPrivateFields.push(item);
  }

  if (missingImages.length > 0) {
    throw new Error(`Missing ${missingImages.length} source images. First: ${missingImages[0]}`);
  }

  await fs.mkdir(imagesOutputDir, { recursive: true });

  const converted = [];
  await runPool(catalogWithPrivateFields, async (item) => {
    const outputPath = path.join(imagesOutputDir, item._thumbnailFile);
    await runFfmpeg(item._sourceImagePath, outputPath);
    const stat = await fs.stat(outputPath);
    converted.push({
      assetId: item.assetId,
      bytes: stat.size,
      originalBytes: item.originalImageBytes ?? 0,
    });
  }, concurrency);

  const catalog = catalogWithPrivateFields
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map(({ _sourceImagePath, _thumbnailFile, ...item }) => item);

  await fs.mkdir(path.dirname(catalogPath), { recursive: true });
  await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

  const totalOriginalBytes = converted.reduce((sum, item) => sum + item.originalBytes, 0);
  const totalWebpBytes = converted.reduce((sum, item) => sum + item.bytes, 0);
  const summary = {
    sourceJsonPath,
    sourceCount: raw.length,
    catalogCount: catalog.length,
    skippedMissingAssetIds: raw.length - normalized.length,
    duplicateAssetIds: duplicates,
    imagesOutputDir,
    catalogPath,
    maxWidth,
    quality,
    totalOriginalBytes,
    totalWebpBytes,
    compressionRatio: totalWebpBytes > 0 ? Number((totalOriginalBytes / totalWebpBytes).toFixed(2)) : null,
    generatedAt: new Date().toISOString(),
  };

  await fs.writeFile(
    path.join(outputDir, 'build-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
