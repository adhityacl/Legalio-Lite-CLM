/**
 * Guards the token migration from the UI/UX audit: brand and neutral colors
 * that have a design token must use it, and text stays at 12px or larger
 * (DashboardView.tsx is exempt — its visual hierarchy is intentionally frozen).
 * Run: npx tsx --test tests/designTokens.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

test('no text utility below the 13px golden floor outside the dashboard', () => {
  const offenders = FILES
    .filter(({ path }) => !path.endsWith('DashboardView.tsx'))
    .flatMap(({ path, text }) => [...text.matchAll(/text-\[(?:[0-9]|1[0-2])(?:\.\d+)?px\]|text-2xs\b/g)].map((m) => `${path}: ${m[0]}`));
  assert.deepEqual(offenders, []);
});

test('every legacy color token utility used in src is registered in a @theme', () => {
  // Legacy role names must not come back unless a theme registers them; moduix registers
  // its own roles (accent, muted, card…) in its stylesheet, the product status palette lives in theme.css.
  // The moduix foundation is copy-owned in-tree (official registry source).
  const foundationDir = 'packages/ui-components/src/moduix/lib/styles';
  const themes = [
    'packages/platform-console/src/index.css',
    'packages/ui-components/src/styles/theme.css',
    ...readdirSync(foundationDir).map((name) => join(foundationDir, name)),
  ].map((path) => readFileSync(path, 'utf8')).join('\n');
  const TOKENS = ['accent', 'accent-text', 'accent-strong', 'accent-strong-hover', 'accent-soft', 'accent-dark', 'ink', 'ink-soft', 'ink-faint', 'hairline', 'surface', 'surface-2', 'canvas'];
  const used = new Set<string>();
  for (const { text } of FILES) {
    for (const m of text.matchAll(/\b(?:bg|text|border|ring|divide|from|to|fill|stroke)-([a-z0-9-]+?)(?:\/\d+)?(?=["'`\s])/g)) {
      if (TOKENS.includes(m[1])) used.add(m[1]);
    }
  }
  const missing = [...used].filter((token) => !themes.includes(`--color-${token}:`));
  assert.deepEqual(missing, []);
});

test('application components use semantic colors instead of palette utilities', () => {
  const files = FILES;
  const offenders = files.flatMap(({ path, text }) => [...text.matchAll(/\b(?:bg|text|border|ring)-(?:slate|gray|zinc|neutral|emerald|green|red|rose|amber|blue|purple)-\d+\b/g)].map(match => `${path}: ${match[0]}`));
  assert.deepEqual(offenders, []);
});

test('semantic feedback pairs meet normal-text contrast in light and dark themes', async () => {
  const { contrastRatio } = await import('../packages/platform-console/src/lib/organizationColors');
  const css = readFileSync('packages/ui-components/src/styles/theme.css', 'utf8');
  // Every role is declared once as light-dark(light, dark); index 0 is light, 1 is dark.
  const pairs = Object.fromEntries([...css.matchAll(/--(moduix|legalio)-([\w-]+):\s*light-dark\((#[\da-f]{6}),\s*(#[\da-f]{6})\)/gi)]
    .map((m) => [`${m[1]}-${m[2]}`, [m[3], m[4]]]));
  const tone = (status: string) => ({ success: 'moduix-success', warning: 'moduix-warning', danger: 'moduix-destructive' } as Record<string, string>)[status] || `legalio-${status}`;
  for (const scheme of [0, 1]) {
    for (const status of ['success', 'warning', 'danger', 'info', 'special', 'finance']) {
      assert.ok(contrastRatio(pairs[tone(status)][scheme], pairs[`legalio-${status}-soft`][scheme]) >= 4.5, `${status} feedback must be readable`);
    }
    assert.ok(contrastRatio(pairs['moduix-foreground'][scheme], pairs['moduix-card'][scheme]) >= 4.5);
    assert.ok(contrastRatio(pairs['moduix-muted-foreground'][scheme], pairs['moduix-card'][scheme]) >= 4.5);
  }
});

test('sizes and spacing come from the golden ladder (docs/design-system/STANDARD.md)', () => {
  // 4px numeric Tailwind steps, container sizes and arbitrary pixel/rem values are not on the ladder.
  const NUMERIC = /(?<![\w-])-?(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y|w|h|min-w|min-h|max-w|max-h|size|inset|top|right|bottom|left)-(?:[1-9]\d*(?:\.\d+)?|[2-7]?xl|xs|sm|md|lg)(?![\w.\-\]/%])/g;
  const ARBITRARY = /(?<![\w-])-?(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|w|h|min-w|min-h|max-w|max-h|size)-\[(?:[2-9]|\d{2,})(?:\.\d+)?(?:px|rem)\]/g; // sub-2px hairlines are allowed
  const offenders = FILES
    .filter(({ path }) => !path.includes('/moduix/lib/') && !path.endsWith('catalog.tsx'))
    .flatMap(({ path, text }) => [...text.matchAll(NUMERIC), ...text.matchAll(ARBITRARY)].map(m => `${path}: ${m[0]}`));
  assert.deepEqual(offenders.slice(0, 40), []);
});

test('no rem lengths inside size utilities (only breakpoint variants may use rem)', () => {
  const REM = /(?<![\w.])\d+(?:\.\d+)?rem(?![a-zA-Z])/g;
  const offenders = FILES
    .filter(({ path }) => !path.includes('/moduix/lib/') && !path.includes('/icons/') && !path.endsWith('catalog.tsx'))
    .flatMap(({ path, text }) => [...text.matchAll(REM)]
      .filter(m => !/(?:max|min)-\[$/.test(text.slice(Math.max(0, m.index! - 8), m.index!)))
      .map(m => `${path}: ${m[0]}`));
  assert.deepEqual(offenders.slice(0, 40), []);
});

test('table bodies use the row-action sizes from STANDARD.md (sm / icon-sm), never md', () => {
  const offenders = FILES
    .filter(({ path }) => !path.includes('/moduix/') && !path.endsWith('catalog.tsx'))
    .flatMap(({ path, text }) => [...text.matchAll(/<TableBody\b[\s\S]*?<\/TableBody>/g)]
      .flatMap(body => [...body[0].matchAll(/size="(icon-md|md|lg)"/g)].map(m => `${path}: ${m[0]}`)));
  assert.deepEqual(offenders, []);
  const headerOverrides = FILES
    .filter(({ path }) => !path.includes('/moduix/') && !path.endsWith('catalog.tsx'))
    .flatMap(({ path, text }) => [...text.matchAll(/<TableColumnHeader[^>]*className="[^"]*\b(?:text-left|align-middle|uppercase|font-medium|p[xy]?-g\d+)\b/g)].map(m => `${path}: ${m[0].slice(0, 80)}`));
  assert.deepEqual(headerOverrides.slice(0, 20), []);
});

test('dates and months use the moduix DatePicker, never the native browser inputs', () => {
  const offenders = FILES
    .filter(({ path }) => !path.includes('/moduix/') && !path.endsWith('catalog.tsx'))
    .flatMap(({ path, text }) => [...text.matchAll(/type="(date|month|week|time|datetime-local)"/g)].map(m => `${path}: ${m[0]}`));
  assert.deepEqual(offenders, []);
});
