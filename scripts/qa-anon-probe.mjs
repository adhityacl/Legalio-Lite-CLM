#!/usr/bin/env node
/**
 * Probe otorisasi untuk request ANONIM (tanpa kredensial) — READ-ONLY.
 *
 * Aman dijalankan terhadap lingkungan live: hanya memakai metode GET pada
 * endpoint nyata, dan POST hanya ke path yang TIDAK ADA (untuk menguji apakah
 * gerbang tulis berlaku) sehingga tidak pernah mengubah data.
 *
 * Jalankan: node scripts/qa-anon-probe.mjs --base https://<host>
 * Output:   qc-output/anon-probe-report.json + .md  (exit 1 bila ada kebocoran)
 *
 * Ekspektasi PRD: request anonim harus 401/403. GET yang mengembalikan 200
 * pada endpoint terproteksi = KEBOCORAN.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const BASE = arg('base', process.env.QA_BASE || 'http://localhost:3000');
const OUT = arg('out', 'qc-output');

/** Endpoint terproteksi (read-only GET). 200 untuk anonim = kebocoran. */
const PROTECTED_GET = [
  ['/api/contracts', 'data kontrak'],
  ['/api/partners', 'data mitra'],
  ['/api/ios', 'data IO'],
  ['/api/tenants', 'daftar tenant'],
  ['/api/activity-logs', 'log aktivitas (email/IP)'],
  ['/api/auth-console/users', 'daftar pengguna (email/role)'],
  ['/api/auth-console/sessions', 'daftar sesi'],
  ['/api/auth-console/organizations', 'daftar organisasi'],
  ['/api/auth-console/invitations', 'daftar undangan'],
  ['/api/auth-console/teams', 'daftar tim/departemen'],
  ['/api/auth-console/api-keys', 'daftar API key'],
  ['/api/user/allowed-users', 'daftar user diizinkan'],
];

/** Endpoint publik yang memang boleh 200 tanpa login. */
const PUBLIC_GET = [
  ['/api/exchange-rates', 'kurs'],
  ['/api/health', 'health (opsional)'],
];

async function req(method, path, headers = {}) {
  try {
    const r = await fetch(`${BASE}${path}`, { method, headers, redirect: 'manual' });
    let text = '';
    try { text = (await r.text()).slice(0, 160); } catch { /* noop */ }
    return { status: r.status, snippet: text.replace(/\s+/g, ' ').trim() };
  } catch (e) {
    return { status: null, error: String(e?.message ?? e) };
  }
}

const results = [];

for (const [path, label] of PROTECTED_GET) {
  const r = await req('GET', path);
  results.push({
    kind: 'protected-get', path, label, status: r.status,
    verdict: r.status === 401 || r.status === 403 ? 'DENIED (benar)' :
             r.status === 200 ? 'LEAK (bocor)' :
             r.status === 404 ? 'tidak ada route' : `lain (${r.status})`,
    leak: r.status === 200, snippet: r.snippet,
  });
}

for (const [path, label] of PUBLIC_GET) {
  const r = await req('GET', path);
  results.push({ kind: 'public-get', path, label, status: r.status,
    verdict: r.status === 200 ? 'publik (wajar)' : `lain (${r.status})`, leak: false, snippet: r.snippet });
}

/* Gerbang tulis: POST ke path yang TIDAK ADA — tidak mungkin mengubah data. */
for (const path of ['/api/__rbac_probe__', '/api/contracts/__rbac_probe__']) {
  const r = await req('POST', path, { 'content-type': 'application/json' });
  results.push({
    kind: 'write-guard', path, label: 'uji gerbang tulis (path tidak ada)',
    status: r.status,
    verdict: r.status === 403 ? 'gerbang tulis AKTIF (Viewer diblokir)' :
             r.status === 401 ? 'butuh autentikasi' :
             r.status === 404 ? 'gerbang tulis TIDAK terpasang (jatuh ke 404)' : `lain (${r.status})`,
    leak: false, snippet: r.snippet,
  });
}

const leaks = results.filter((r) => r.leak);
const report = {
  base: BASE, generatedAt: new Date().toISOString(),
  total: results.length, leaks: leaks.length,
  verdict: leaks.length === 0 ? 'BERSIH' : `BOCOR (${leaks.length} endpoint)`,
  results,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/anon-probe-report.json`, JSON.stringify(report, null, 2));

const md = [
  '# Probe Otorisasi Anonim (read-only)', '',
  `- Base: \`${BASE}\``, `- Waktu: ${report.generatedAt}`,
  `- Verdict: **${report.verdict}** — ${leaks.length}/${results.length} bermasalah`, '',
  '| Jenis | Endpoint | Status | Verdict |', '|---|---|---:|---|',
  ...results.map((r) => `| ${r.kind} | \`${r.path}\` | ${r.status ?? '-'} | ${r.verdict} |`), '',
].join('\n');
writeFileSync(`${OUT}/anon-probe-report.md`, md);

console.log(md);
process.exit(leaks.length === 0 ? 0 : 1);
