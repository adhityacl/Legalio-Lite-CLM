#!/usr/bin/env node
/**
 * Menguji kontras warna token terhadap WCAG 2.1 AA memakai angka nyata.
 * Sumber: src/index.css (nilai --line-*) + src/styles/tokens.css (surface-2, data-*).
 *
 * Jalankan: node tools/check-contrast.mjs <index.css> <tokens.css>
 * Output:   DELIVERY/qc/contrast-report.json  (exit 1 bila ada yang gagal)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [indexCssPath, tokensCssPath] = process.argv.slice(2);
const indexCss = readFileSync(indexCssPath, 'utf8');
const tokensCss = readFileSync(tokensCssPath, 'utf8');

function varsIn(css, selectorRegex) {
  const out = {};
  for (const m of css.matchAll(selectorRegex)) {
    const body = m[1];
    for (const d of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[d[1].trim()] = d[2].trim();
  }
  return out;
}

const light = {
  ...varsIn(indexCss, /:root\s*\{([^}]*)\}/g),
  ...varsIn(tokensCss, /:root\s*\{([^}]*)\}/g),
  ...varsIn(tokensCss, /@theme\s*\{([^}]*)\}/g),
};
const dark = {
  ...light,
  ...varsIn(indexCss, /\.dark\s*\{([^}]*)\}/g),
  ...varsIn(tokensCss, /\.dark\s*\{([^}]*)\}/g),
};

function resolve(map, name, depth = 0) {
  if (depth > 5) return null;
  const v = map[name];
  if (!v) return null;
  const vm = v.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (vm) return resolve(map, vm[1], depth + 1);
  return v.trim();
}

function hexToRgb(h) {
  const s = h.replace('#', '').trim();
  if (s.length === 3) return [0, 1, 2].map((i) => parseInt(s[i] + s[i], 16));
  if (s.length >= 6) return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  return null;
}
function rgbToLum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const A = hexToRgb(a), B = hexToRgb(b);
  if (!A || !B) return null;
  const la = rgbToLum(A), lb = rgbToLum(B);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* pasangan yang diuji: [label, foreground, background, minimum] */
const PAIRS = [
  ['teks utama di canvas', '--color-ink', '--color-canvas', 4.5],
  ['teks utama di surface', '--color-ink', '--color-surface', 4.5],
  ['teks sekunder di canvas', '--color-ink-soft', '--color-canvas', 4.5],
  ['teks sekunder di surface', '--color-ink-soft', '--color-surface', 4.5],
  ['placeholder di surface', '--color-ink-faint', '--color-surface', 4.5],
  ['teks tombol di accent', '--color-on-accent', '--color-accent', 4.5],
  ['teks bahaya di surface', '--color-danger', '--color-surface', 4.5],
  ['teks info di surface', '--color-info', '--color-surface', 4.5],
  ['aksen brand untuk teks di surface', '--color-accent-text', '--color-surface', 4.5],
  ['data-1 di surface', '--color-data-1', '--color-surface', 3.0],
  ['data-2 di surface', '--color-data-2', '--color-surface', 3.0],
  ['data-3 di surface', '--color-data-3', '--color-surface', 3.0],
  ['data-4 di surface', '--color-data-4', '--color-surface', 3.0],
  ['data-5 di surface', '--color-data-5', '--color-surface', 3.0],
];

function runTheme(name, map) {
  const rows = [];
  for (const [label, fg, bg, min] of PAIRS) {
    const f = resolve(map, fg), b = resolve(map, bg);
    const ratio = f && b ? contrast(f, b) : null;
    rows.push({ theme: name, label, fg: `${fg}=${f}`, bg: `${bg}=${b}`,
      ratio: ratio ? Number(ratio.toFixed(2)) : null, min, pass: ratio != null && ratio >= min });
  }
  return rows;
}

const rows = [...runTheme('light', light), ...runTheme('dark', dark)];
const failures = rows.filter((r) => !r.pass);
const report = {
  generatedAt: new Date().toISOString(),
  sources: { indexCss: indexCssPath, tokensCss: tokensCssPath },
  total: rows.length, passed: rows.length - failures.length, failed: failures.length,
  failures, rows,
};
mkdirSync('DELIVERY/qc', { recursive: true });
writeFileSync('DELIVERY/qc/contrast-report.json', JSON.stringify(report, null, 2));

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('tema', 6) + pad('pasangan', 26) + pad('rasio', 8) + pad('min', 6) + 'hasil');
for (const r of rows) console.log(pad(r.theme, 6) + pad(r.label, 26) + pad(r.ratio ?? '-', 8) + pad(r.min, 6) + (r.pass ? 'OK' : 'GAGAL'));
console.log(`\n${rows.length - failures.length}/${rows.length} lulus AA`);
process.exit(failures.length === 0 ? 0 : 1);
