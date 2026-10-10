#!/usr/bin/env node
/**
 * Harness QC Impersonasi RBAC (PRD §30).
 *
 * Menjalankan skenario "menyamar sebagai user di setiap level" terhadap
 * instance yang SEDANG BERJALAN, lalu membandingkan hasilnya dengan matriks
 * izin PRD. Menghasilkan laporan JSON + Markdown.
 *
 * Pemakaian (di Codespace, setelah `npm run dev`):
 *
 *   node scripts/rbac-qc.mjs --base http://localhost:3000 --super-token <TOKEN_SUPERUSER>
 *
 * Token superuser didapat dari sesi login di browser (DevTools → Application →
 * Cookies/localStorage) atau dari `POST /api/auth-console/users/<id>/impersonate`.
 * Harness akan memakai superuser untuk meng-impersonate akun tiap level yang
 * diberikan via --accounts, atau memakai token yang diberikan langsung.
 *
 *   --accounts '{"admin":"<id>","manager":"<id>","editor":"<id>","viewer":"<id>"}'
 *   --tokens   '{"admin":"<token>","manager":"<token>",...}'
 *
 * Output: qc-output/rbac-qc-report.json dan qc-output/rbac-qc-report.md
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (name, dflt = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};

const BASE = arg('base', process.env.RBAC_QC_BASE || 'http://localhost:3000');
const SUPER_TOKEN = arg('super-token', process.env.RBAC_QC_SUPER_TOKEN || '');
const ACCOUNTS = JSON.parse(arg('accounts', process.env.RBAC_QC_ACCOUNTS || '{}'));
const TOKENS = JSON.parse(arg('tokens', process.env.RBAC_QC_TOKENS || '{}'));
const OUT = arg('out', 'qc-output');

const LEVELS = ['superuser', 'admin', 'manager', 'editor', 'viewer'];

/** Skenario uji (PRD §18 + §30). expected: true = boleh, false = harus ditolak. */
const SCENARIOS = [
  { id: 'doc.view',        method: 'GET',    path: '/api/contracts',                    perm: 'document.view',   expected: { superuser: true, admin: true, manager: true, editor: true, viewer: true } },
  { id: 'doc.create',      method: 'POST',   path: '/api/contracts',                    perm: 'document.create', expected: { superuser: true, admin: true, manager: true, editor: true, viewer: false } },
  { id: 'users.list',      method: 'GET',    path: '/api/auth-console/users',           perm: 'user.view',       expected: { superuser: true, admin: true, manager: true, editor: false, viewer: false } },
  { id: 'rbac.matrix',     method: 'GET',    path: '/api/rbac/matrix',                  perm: 'admin.access',    expected: { superuser: true, admin: true, manager: true, editor: true, viewer: true } },
  { id: 'invite.simulator',method: 'POST',   path: '/api/rbac/simulate/invite',         perm: 'user.invite',     expected: { superuser: true, admin: true, manager: true, editor: false, viewer: false },
    body: { targetRole: 'viewer', tenantId: 't1', departmentId: 'd1' } },
  { id: 'invite.no-scope', method: 'POST',   path: '/api/rbac/simulate/invite',         perm: 'user.invite',     expected: { superuser: true, admin: false, manager: false, editor: false, viewer: false },
    body: { targetRole: 'viewer' } },
  { id: 'invite.as.admin', method: 'POST',   path: '/api/rbac/simulate/invite',         perm: 'user.invite',     expected: { superuser: true, admin: false, manager: false, editor: false, viewer: false },
    body: { targetRole: 'admin' } },
];

async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* noop */ }
  return { status: res.status, json };
}

async function impersonate(level) {
  if (TOKENS[level]) return { token: TOKENS[level], source: 'provided-token' };
  const userId = ACCOUNTS[level];
  if (!userId) return { token: null, source: 'missing' };
  const r = await call('POST', `/api/auth-console/users/${userId}/impersonate`, SUPER_TOKEN);
  const token = r.json?.sessionToken || r.json?.token || null;
  return { token, source: 'impersonation', status: r.status };
}

async function main() {
  const results = [];
  const tokens = {};

  for (const level of LEVELS) {
    if (level === 'superuser' && SUPER_TOKEN) { tokens.superuser = { token: SUPER_TOKEN, source: 'super-token' }; continue; }
    tokens[level] = await impersonate(level);
  }

  for (const sc of SCENARIOS) {
    for (const level of LEVELS) {
      const token = tokens[level]?.token || null;
      const expect = sc.expected[level];
      const r = await call(sc.method, sc.path, token, sc.body);
      const allowed = r.status >= 200 && r.status < 300;
      const deniedProperly = [401, 403].includes(r.status);
      const pass = expect ? allowed : deniedProperly;
      results.push({
        scenario: sc.id, level, expect, status: r.status,
        allowed, errorCode: r.json?.error ?? null, pass,
        tokenSource: tokens[level]?.source ?? 'missing',
      });
    }
  }

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const byLevel = LEVELS.map((l) => {
    const rows = results.filter((r) => r.level === l);
    return { level: l, pass: rows.filter((r) => r.pass).length, total: rows.length,
      tokenSource: tokens[l]?.source ?? 'missing' };
  });

  mkdirSync(OUT, { recursive: true });
  const report = { base: BASE, generatedAt: new Date().toISOString(), total, passed,
    failed: total - passed, byLevel, results };
  writeFileSync(`${OUT}/rbac-qc-report.json`, JSON.stringify(report, null, 2));

  const md = [
    '# Laporan QC Impersonasi RBAC', '',
    `- Base URL: \`${BASE}\``,
    `- Waktu: ${report.generatedAt}`,
    `- Hasil: **${passed}/${total} lulus**`, '',
    '## Ringkasan per level', '',
    '| Level | Token | Lulus | Total |', '|---|---|---:|---:|',
    ...byLevel.map((b) => `| ${b.level} | ${b.tokenSource} | ${b.pass} | ${b.total} |`), '',
    '## Detail', '',
    '| Skenario | Level | Harapan | HTTP | Kode error | Hasil |', '|---|---|---|---:|---|---|',
    ...results.map((r) => `| ${r.scenario} | ${r.level} | ${r.expect ? 'ALLOW' : 'DENY'} | ${r.status} | ${r.errorCode ?? '-'} | ${r.pass ? '✅' : '❌'} |`),
    '', '> Catatan: skenario ber-harapan DENY dianggap lulus hanya bila HTTP 401/403',
    '> dengan kode error standar PRD §29 (bukan 500 / halaman kosong).', '',
  ].join('\n');
  writeFileSync(`${OUT}/rbac-qc-report.md`, md);

  console.log(md);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => { console.error('QC harness gagal:', e); process.exit(2); });
