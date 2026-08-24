import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stagingRoot = path.join(root, '.desktop-package');
const appDir = path.join(stagingRoot, 'app');
const resourcesDir = path.join(stagingRoot, 'resources');
const resourcesBinDir = path.join(resourcesDir, 'bin');

async function copyRequired(from, to, options = {}) {
  const source = path.join(root, from);
  try {
    await fs.access(source);
  } catch {
    throw new Error(`Missing required desktop package input: ${from}`);
  }
  await fs.cp(source, to, { recursive: true, force: true, ...options });
}

function findCommand(command) {
  const result = spawnSync('where.exe', [command], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) return '';
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

async function maybeCopyFfmpeg() {
  await fs.mkdir(resourcesBinDir, { recursive: true });
  await fs.writeFile(path.join(resourcesBinDir, '.keep'), '');

  if (!/^(1|true|yes)$/i.test(process.env.XIAKEMAN_INCLUDE_FFMPEG || '')) {
    return;
  }

  const binaries = [
    ['ffmpeg', 'ffmpeg.exe'],
    ['ffprobe', 'ffprobe.exe'],
  ];

  for (const [command, fileName] of binaries) {
    const resolved = findCommand(command);
    if (!resolved) {
      throw new Error(`XIAKEMAN_INCLUDE_FFMPEG was set, but ${command} was not found on PATH`);
    }
    await fs.copyFile(resolved, path.join(resourcesBinDir, fileName));
  }
}

async function writePackageJson() {
  const rootPackage = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const bffPackage = JSON.parse(await fs.readFile(path.join(root, 'bff', 'package.json'), 'utf8'));
  const packageJson = {
    name: rootPackage.name,
    version: rootPackage.version,
    description: rootPackage.description,
    license: rootPackage.license,
    private: true,
    main: 'desktop/main.cjs',
    dependencies: bffPackage.dependencies || {},
    build: {
      appId: 'com.xiakeman.desktop',
      productName: 'Xiakeman',
      electronVersion: String(rootPackage.devDependencies?.electron || '42.0.1').replace(/^[^\d]*/, ''),
      asar: true,
      directories: {
        output: '../../release',
      },
      files: [
        '**/*',
      ],
      extraResources: [
        {
          from: '../resources/bin',
          to: 'bin',
          filter: [
            '**/*',
          ],
        },
      ],
      win: {
        signAndEditExecutable: false,
        target: [
          {
            target: 'portable',
            arch: [
              'x64',
            ],
          },
        ],
        artifactName: 'Xiakeman-${version}-${arch}.${ext}',
      },
    },
  };
  await fs.writeFile(
    path.join(appDir, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    'utf8',
  );
}

async function main() {
  await fs.rm(stagingRoot, { recursive: true, force: true });
  await fs.mkdir(appDir, { recursive: true });

  await copyRequired('desktop', path.join(appDir, 'desktop'));
  await copyRequired('dist', path.join(appDir, 'dist'));
  await copyRequired('bff', path.join(appDir, 'bff'), {
    filter: (source) => !source.split(path.sep).includes('node_modules'),
  });
  await copyRequired(path.join('bff', 'node_modules'), path.join(appDir, 'node_modules'));
  await copyRequired(path.join('voice_corpus', 'output'), path.join(appDir, 'voice_corpus', 'output'));
  await writePackageJson();
  await maybeCopyFfmpeg();

  console.log(`[desktop] prepared runtime package at ${appDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
