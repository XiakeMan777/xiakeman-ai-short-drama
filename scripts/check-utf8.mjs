import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const textExtensions = new Set([
  '.bat',
  '.cmd',
  '.css',
  '.d.ts',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.md',
  '.ps1',
  '.sh',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const excludedDirNames = new Set([
  '.codex-tmp',
  '.deploy-package',
  '.deploy-runtime',
  '.git',
  'backups',
  'coky',
  'deploy',
  'dist',
  'node_modules',
  'stable-backups',
  'tmp',
  'tmp-codex-review',
]);

const excludedDirPrefixes = ['unused-files-archive-'];
const decoder = new TextDecoder('utf-8', { fatal: true });

function isExcludedDir(name) {
  return excludedDirNames.has(name) || excludedDirPrefixes.some((prefix) => name.startsWith(prefix));
}

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (textExtensions.has(ext)) return true;
  if (filePath.toLowerCase().endsWith('.d.ts')) return true;
  return ['Dockerfile', '.dockerignore', '.gitignore', '.editorconfig'].includes(path.basename(filePath));
}

function looksLikeUtf16(buffer) {
  if (buffer.length >= 2) {
    if ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff)) {
      return true;
    }
  }

  const sampleLength = Math.min(buffer.length, 200);
  if (sampleLength < 20) return false;
  let nullCount = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) nullCount += 1;
  }
  return nullCount / sampleLength > 0.2;
}

function walk(dir, issues) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!isExcludedDir(entry.name)) walk(path.join(dir, entry.name), issues);
      continue;
    }

    if (!entry.isFile()) continue;
    const filePath = path.join(dir, entry.name);
    if (!isTextFile(filePath)) continue;

    const buffer = fs.readFileSync(filePath);
    const relativePath = path.relative(root, filePath);
    if (looksLikeUtf16(buffer)) {
      issues.push(`${relativePath}: looks like UTF-16; use UTF-8 for project text files`);
      continue;
    }

    try {
      decoder.decode(buffer);
    } catch {
      issues.push(`${relativePath}: invalid UTF-8 bytes`);
    }
  }
}

const issues = [];
walk(root, issues);

if (issues.length > 0) {
  console.error(`UTF-8 check failed (${issues.length} issue${issues.length === 1 ? '' : 's'}):`);
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log('UTF-8 check passed.');
