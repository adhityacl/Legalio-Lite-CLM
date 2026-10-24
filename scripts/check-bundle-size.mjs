#!/usr/bin/env node
/**
 * Fails when the frontend's entry bundle (the module script of index.html plus every chunk it preloads) is larger than its budget.
 *
 *   npm run build:frontend && npm run check:bundle          check against apps/frontend/bundle-budget.json
 *   node scripts/check-bundle-size.mjs --write-budget        record the current size + 10 % as the new budget
 *
 * Sizes are bytes of the files in apps/frontend/dist: raw, and brotli at quality 11 (what the server sends to browsers).
 */
import { brotliCompressSync, constants } from 'node:zlib';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'apps/frontend/dist');
const budgetFile = path.join(root, 'apps/frontend/bundle-budget.json');
const MARGIN = 1.1;

if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('apps/frontend/dist/index.html not found: run `npm run build:frontend` first.');
  process.exit(2);
}
const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
const urls = new Set();
for (const match of html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)) urls.add(match[1]);
for (const match of html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)) urls.add(match[1]);
if (urls.size === 0) {
  console.error('No module script found in index.html.');
  process.exit(2);
}

const files = [...urls].map((url) => {
  const body = readFileSync(path.join(dist, url.replace(/^\//, '')));
  const brotli = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } }).length;
  return { url, raw: body.length, brotli };
});
const total = { raw: files.reduce((sum, f) => sum + f.raw, 0), brotli: files.reduce((sum, f) => sum + f.brotli, 0) };
const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

for (const f of files) console.log(`  ${f.url}  raw ${f.raw} B (${kib(f.raw)})  brotli ${f.brotli} B (${kib(f.brotli)})`);
console.log(`Entry total: raw ${total.raw} B (${kib(total.raw)}), brotli ${total.brotli} B (${kib(total.brotli)})`);

if (process.argv.includes('--write-budget')) {
  const budget = { note: 'Entry bundle budget in bytes: the measured size at the time plus 10 %. Regenerate with `node scripts/check-bundle-size.mjs --write-budget` after a deliberate change.', measured: total, raw: Math.ceil(total.raw * MARGIN), brotli: Math.ceil(total.brotli * MARGIN) };
  writeFileSync(budgetFile, JSON.stringify(budget, null, 2) + '\n');
  console.log(`Budget written to ${path.relative(root, budgetFile)}: raw ${budget.raw} B, brotli ${budget.brotli} B`);
  process.exit(0);
}

const budget = JSON.parse(readFileSync(budgetFile, 'utf8'));
let failed = false;
for (const kind of ['raw', 'brotli']) {
  const over = total[kind] - budget[kind];
  const status = over > 0 ? 'OVER BUDGET' : 'ok';
  console.log(`${kind.padEnd(6)} ${total[kind]} / ${budget[kind]} B  ${status}${over > 0 ? ` (+${over} B, +${((over / budget[kind]) * 100).toFixed(1)} %)` : ''}`);
  if (over > 0) failed = true;
}
if (failed) {
  console.error('The entry bundle grew past its budget. Load the new code lazily (React.lazy / dynamic import) or, if the growth is deliberate, regenerate the budget with --write-budget.');
  process.exit(1);
}
