/**
 * Guards the token migration from the UI/UX audit: brand and neutral colors
 * that have a design token must use it, and text stays at 12px or larger
 * (DashboardView.tsx is exempt — its visual hierarchy is intentionally frozen).
 * Run: npx tsx --test tests/designTokens.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const FILES = sourceFiles('apps/frontend/src').concat(sourceFiles('packages/ui-components/src'), sourceFiles('packages/platform-console/src'), sourceFiles('apps/backend/console/src')).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

test('filled primary buttons use theme tokens rather than a fixed green palette', () => {
  const offenders = FILES.flatMap(({ path, text }) => text.split('\n')
    .filter(line => /ui-button/.test(line) && /bg-(emerald|green)-[567]00/.test(line))
    .map(line => `${path}: ${line.trim()}`));
  assert.deepEqual(offenders, []);
});

// Hex utilities that have an exact token (same light and dark value) or whose
// raw value fails contrast. `dark:text-[#06C755]` is allowed: it passes on dark surfaces.
const TOKENIZED = /(?<![\w\-[])((?:[a-z0-9-]+:)*)(text-\[#(?:06C755|048C3B|111111|777777)\]|bg-\[#(?:04803D|036B33|06C755|EBFBF0)\]|(?:border|ring)-\[#06C755\]|(?:border|divide)-\[#E5E8EB\])/gi;

test('brand and neutral colors with a token use the token, not a raw hex', () => {
  const offenders: string[] = [];
  for (const { path, text } of FILES) {
    for (const match of text.matchAll(TOKENIZED)) {
      if (match[1].includes('dark:') && /^text-\[#06C755\]$/i.test(match[2])) continue;
      offenders.push(`${path}: ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, [], 'use text-accent-text / bg-accent-strong / border-hairline / text-ink(-soft) …');
});

test('no text utility below 12px outside the dashboard', () => {
  const offenders = FILES
    .filter(({ path }) => !path.endsWith('DashboardView.tsx'))
    .flatMap(({ path, text }) => [...text.matchAll(/text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]|text-2xs\b/g)].map((m) => `${path}: ${m[0]}`));
  assert.deepEqual(offenders, []);
});

test('every color token utility used in src is registered in index.css @theme', () => {
  // Application role utilities are registered in the shared @theme;
  // an unregistered token silently renders transparent/inherited colors.
  const theme = readFileSync('packages/platform-console/src/index.css', 'utf8');
  const TOKENS = ['accent', 'accent-text', 'accent-strong', 'accent-strong-hover', 'accent-soft', 'accent-dark', 'ink', 'ink-soft', 'ink-faint', 'hairline', 'surface', 'surface-2', 'canvas'];
  const used = new Set<string>();
  for (const { text } of FILES) {
    for (const m of text.matchAll(/\b(?:bg|text|border|ring|divide|from|to|fill|stroke)-([a-z0-9-]+?)(?:\/\d+)?(?=["'`\s])/g)) {
      if (TOKENS.includes(m[1])) used.add(m[1]);
    }
  }
  const missing = [...used].filter((token) => !theme.includes(`--color-${token}:`));
  assert.deepEqual(missing, []);
});

test('application components use semantic colors instead of palette utilities', () => {
  const files = FILES;
  const offenders = files.flatMap(({ path, text }) => [...text.matchAll(/\b(?:bg|text|border|ring)-(?:slate|gray|zinc|neutral|emerald|green|red|rose|amber|blue|purple)-\d+\b/g)].map(match => `${path}: ${match[0]}`));
  assert.deepEqual(offenders, []);
});

test('semantic feedback pairs meet normal-text contrast in light and dark themes', async () => {
  const { contrastRatio } = await import('../packages/platform-console/src/lib/organizationColors');
  const css = readFileSync('packages/ui-components/src/styles/tokens.css', 'utf8');
  const [light, rest] = css.split(".dark, [data-moduix-color-scheme='dark'] {");
  const dark = rest.split('}')[0];
  const palette = (source: string) => Object.fromEntries([...source.matchAll(/--ds-([\w-]+):\s*(#[\da-f]{6});/gi)].map(match => [match[1], match[2]]));
  const base = palette(light);
  for (const colors of [base, { ...base, ...palette(dark) }]) {
    for (const status of ['success', 'warning', 'danger', 'info', 'special', 'finance']) {
      assert.ok(contrastRatio(colors[status], colors[`${status}-soft`]) >= 4.5, `${status} feedback must be readable`);
    }
    assert.ok(contrastRatio(colors.text, colors.surface) >= 4.5);
    assert.ok(contrastRatio(colors['text-muted'], colors.surface) >= 4.5);
  }
});
