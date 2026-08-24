import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const sourceDir = path.join(root, 'release', 'win-unpacked');
const zipPath = path.join(root, 'release', `Xiakeman-${packageJson.version}-win-x64-folder.zip`);

try {
  await fs.access(sourceDir);
} catch {
  console.error(`Missing desktop build directory: ${sourceDir}`);
  process.exit(1);
}

await fs.rm(zipPath, { force: true });

const command = [
  '$ErrorActionPreference = "Stop";',
  `Compress-Archive -Path '${sourceDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -CompressionLevel Optimal`,
].join(' ');

const result = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
  {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  },
);

if (result.status !== 0) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status || 1);
}

const stat = await fs.stat(zipPath);
console.log(`[desktop] archived ${zipPath}`);
console.log(`[desktop] zip size ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
