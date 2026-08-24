import esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, '.docker-bff');

await fs.rm(outdir, { recursive: true, force: true });
await fs.mkdir(outdir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, 'bff', 'server.js')],
  outfile: path.join(outdir, 'server.cjs'),
  bundle: true,
  platform: 'node',
  target: ['node20'],
  format: 'cjs',
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
});

console.log(`[bff] bundled ${path.join(outdir, 'server.cjs')}`);
