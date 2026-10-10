#!/usr/bin/env node
/**
 * QC Impersonasi LIVE terhadap app yang berjalan — tangkap bukti per level.
 *
 * Membuat: qc-output/impersonation-live/report.html  (bukti visual: matriks per level)
 *          qc-output/impersonation-live/report.json  (data mentah untuk otomasi)
 *
 * Cara pakai (di dalam Codespace, app sedang jalan):
 *   node scripts/rbac-qc-live.mjs --base http://localhost:3000
 *
 * Opsi:
 *   --db <path>          Path SQLite better-auth (default: cari auth.db / sqlite.db / better-auth.db)
 *   --token <token>      Pakai token superuser ini (kalau tidak mau baca DB)
 *   --accounts <json>    Peta manual { "admin": "<userId>", ... }
 *   --seed-users         Buat user uji untuk level yang belum ada (butuh sesi superuser)
 *   --out <dir>          Folder keluaran (default qc-output/impersonation-live)
 *
 * Catatan: hanya MEMBACA data (GET) kecuali --seed-users yang memakai API resmi app.
 */
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(`--${n}`);

const BASE = arg('base', 'http://localhost:3000');
const OUT = arg('out', 'qc-output/impersonation-live');
const SEED = flag('seed-users');
const LEVELS = ['superuser', 'admin', 'manager', 'editor', 'viewer'];

const SCENARIOS = [
  { id: 'doc.view', path: '/api/contracts', method: 'GET', expect: { superuser: 1, admin: 1, manager: 1, editor: 1, viewer: 1 } },
  { id: 'users.list', path: '/api/auth-console/users', method: 'GET', expect: { superuser: 1, admin: 1, manager: 1, editor: 0, viewer: 0 } },
  { id: 'sessions.list', path: '/api/auth-console/sessions', method: 'GET', expect: { superuser: 1, admin: 1, manager: 1, editor: 0, viewer: 0 } },
  { id: 'audit.logs', path: '/api/activity-logs', method: 'GET', expect: { superuser: 1, admin: 1, manager: 1, editor: 0, viewer: 0 } },
  { id: 'partners.list', path: '/api/partners', method: 'GET', expect: { superuser: 1, admin: 1, manager: 1, editor: 1, viewer: 1 } },
  { id: 'tenant.switch', path: '/api/tenants/switch', method: 'POST', expect: { superuser: 1, admin: 0, manager: 0, editor: 0, viewer: 0 }, body: { tenantId: '__ORG__' } },
];

/* ---------- util DB (node:sqlite bawaan Node 22) ---------- */
function findDb(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  for (const f of ['auth.db', 'sqlite.db', 'better-auth.db']) if (existsSync(f)) return f;
  try { for (const f of readdirSync('.')) if (/\.(db|sqlite)$/i.test(f)) return f; } catch {}
  return null;
}

async function loadAccounts() {
  const manual = arg('accounts');
  if (manual) return { source: 'manual', accounts: JSON.parse(manual) };

  const token = arg('token', process.env.QC_SUPER_TOKEN || '');
  const dbPath = findDb(arg('db'));
  if (!dbPath) return { source: 'none', accounts: {}, token };

  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); }
  catch { return { source: 'no-sqlite-module', accounts: {}, token }; }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const users = db.prepare('SELECT id, email, role, banned FROM user').all();
  const sessions = db.prepare("SELECT token, userId, expiresAt FROM session WHERE datetime(expiresAt) > datetime('now')").all();
  let orgId = null;
  try { orgId = db.prepare('SELECT id FROM organization LIMIT 1').get()?.id ?? null; } catch {}
  db.close();
  const byRole = {};
  for (const u of users) {
    const r = String(u.role || '').toLowerCase();
    if (u.banned) continue;
    if (!byRole[r]) byRole[r] = u;
  }
  const su = byRole.superuser || byRole['super admin'] || byRole.owner;
  const suSession = su ? sessions.find((s) => s.userId === su.id) : null;
  return {
    source: `sqlite:${dbPath}`,
    token: token || suSession?.token || '',
    accounts: { admin: byRole.admin?.id, manager: byRole.manager?.id, editor: byRole.editor?.id, viewer: byRole.viewer?.id, superuser: su?.id },
    orgId,
    dbPath,
    userCount: users.length,
    sessionCount: sessions.length,
  };
}

/**
 * Membuat sesi superuser SEMENTARA di DB (opt-in, untuk lingkungan dev/Codespace).
 * Ditandai `userAgent = 'qc-harness'` agar mudah dibersihkan.
 */
async function mintQcSession(dbPath, superUserId) {
  const { DatabaseSync } = await import('node:sqlite');
  const { randomBytes } = await import('node:crypto');
  const db = new DatabaseSync(dbPath);
  const cols = db.prepare('PRAGMA table_info(session)').all().map((c) => c.name);
  const now = new Date().toISOString();
  const vals = {
    id: `qc_sess_${Date.now()}`,
    expiresAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    token: `qc_${randomBytes(24).toString('hex')}`,
    createdAt: now, updatedAt: now,
    ipAddress: '127.0.0.1', userAgent: 'qc-harness',
    userId: superUserId, impersonatedBy: null, activeOrganizationId: null,
  };
  const use = Object.keys(vals).filter((k) => cols.includes(k));
  db.prepare(`INSERT INTO session (${use.join(',')}) VALUES (${use.map(() => '?').join(',')})`).run(...use.map((k) => vals[k]));
  db.close();
  return vals.token;
}

/** Menghapus semua sesi buatan harness QC (tahan perbedaan skema). */
async function cleanupQcSessions(dbPath) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  const cols = db.prepare('PRAGMA table_info(session)').all().map((c) => c.name);
  const where = cols.includes('userAgent')
    ? "userAgent = 'qc-harness' OR id LIKE 'qc_sess_%'"
    : "id LIKE 'qc_sess_%'";
  const info = db.prepare(`DELETE FROM session WHERE ${where}`).run();
  db.close();
  return Number(info.changes ?? 0);
}

async function call(method, path, token, body) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    let json = null; try { json = await res.json(); } catch {}
    return { status: res.status, json };
  } catch (e) { return { status: null, error: String(e?.message ?? e) }; }
}

async function impersonate(userId, superToken) {
  if (!superToken || !userId) return null;
  const r = await call('POST', `/api/auth-console/users/${userId}/impersonate`, superToken);
  return r.json?.sessionToken || r.json?.token || null;
}

async function seedUser(level, superToken, orgId) {
  const email = `qc.tester+${level}@example.test`;
  const payload = { email, name: `QC ${level}`, role: level };
  // App mensyaratkan organizationId untuk role di bawah Superuser/Admin.
  if (orgId && !['superuser', 'admin'].includes(level)) payload.organizationId = orgId;
  const r = await call('POST', '/api/auth-console/users', superToken, payload);
  if (r.status >= 200 && r.status < 300) return r.json?.user?.id || r.json?.id || null;
  console.error(`  ! gagal membuat user uji ${level}: HTTP ${r.status} ${JSON.stringify(r.json ?? {}).slice(0, 160)}`);
  return null;
}

function html(report) {
  const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const cell = (ok, status) => `<td class="c ${ok ? 'ok' : 'no'}">${ok ? '✔' : '✗'}<span class="code">${esc(status ?? '-')}</span></td>`;
  const rows = report.scenarios.map((sc) => {
    const cells = report.levels.map((lv) => {
      const r = report.results.find((x) => x.scenario === sc.id && x.level === lv);
      const allowed = r && r.status >= 200 && r.status < 300;
      const expectAllow = sc.expect[lv] === 1;
      const pass = expectAllow ? allowed : [401, 403].includes(r?.status);
      return cell(pass, r?.status);
    }).join('');
    return `<tr><td><code>${esc(sc.id)}</code><div class="muted">${esc(sc.method)} ${esc(sc.path)}</div></td>${cells}</tr>`;
  }).join('');

  const summary = report.levels.map((lv) => {
    const rs = report.results.filter((r) => r.level === lv);
    const ok = rs.filter((r) => r.pass).length;
    return `<div class="card"><div class="row"><strong>${esc(lv)}</strong><span class="badge ${ok === rs.length ? 'b-ok' : 'b-no'}">${ok}/${rs.length}</span></div><div class="muted">token: ${esc(report.tokens[lv]?.source ?? 'none')}</div></div>`;
  }).join('');

  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QC Impersonasi Live — ${esc(report.base)}</title><style>
:root{--bg:#F7F8FA;--sf:#fff;--sf2:#F2F3F5;--ink:#111;--soft:#666;--line:#E5E8EB;--grn:#037436;--red:#B3261E;--acc:#06C755}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 'Plus Jakarta Sans','Inter',system-ui,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:24px 16px 64px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:26px 0 10px}
.muted{color:var(--soft);font-size:12px}.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
.card{background:var(--sf);border:1px solid var(--line);border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,.03);padding:12px}
.row{display:flex;justify-content:space-between;align-items:center;gap:8px}
.badge{border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;border:1px solid var(--line);background:var(--sf2)}
.b-ok{background:rgba(6,199,85,.12);border-color:rgba(6,199,85,.35);color:var(--grn)}.b-no{background:rgba(179,38,30,.10);border-color:rgba(179,38,30,.3);color:var(--red)}
.tbl{width:100%;overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:var(--sf)}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:9px 11px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
thead th{background:var(--sf2);color:var(--soft);font-weight:600;white-space:nowrap}td.c{text-align:center;font-weight:700}.ok{color:var(--grn)}.no{color:var(--red)}
.code{display:block;font-size:11px;font-weight:400;color:var(--soft)}tbody tr:last-child td{border-bottom:0}
code{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px}
</style></head><body><div class="wrap">
<h1>QC Impersonasi Live — bukti per level</h1>
<p class="muted">Target: <code>${esc(report.base)}</code> · dijalankan ${esc(report.generatedAt)} · sumber akun: ${esc(report.accountSource)}</p>
<h2>1. Ringkasan per level</h2><div class="grid">${summary}</div>
<h2>2. Matriks skenario × level (hijau = sesuai harapan PRD)</h2>
<div class="tbl"><table><thead><tr><th>Skenario</th>${report.levels.map((l) => `<th class="c">${esc(l.toUpperCase())}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
<p class="muted">✔ = perilaku benar (boleh → 2xx; harus ditolak → 401/403) · ✗ = menyimpang. Angka kecil = kode HTTP sebenarnya.</p>
<h2>3. Catatan</h2><ul class="muted">${report.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
</div></body></html>`;
}

async function main() {
  /* Preflight: pastikan app benar-benar berjalan di BASE. */
  const probe = await call('GET', '/api/exchange-rates');
  if (probe.status === null) {
    console.error(`\n❌ Tidak bisa menghubungi ${BASE}`);
    console.error('   → App belum berjalan. Nyalakan dulu di terminal lain:');
    console.error('       npm run dev      (tunggu: "Pengelola Kontrak & IO Server running on http://0.0.0.0:3000")');
    console.error('     Lalu buka terminal KEDUA dan ulangi perintah QC ini.');
    console.error(`   (detail: ${probe.error ?? 'koneksi ditolak'})`);
    process.exit(3);
  }

  const { source, accounts, token: tokenFromDb, userCount, sessionCount, orgId, dbPath } = await loadAccounts();
  let superToken = tokenFromDb;

  /* Pembersihan sesi QC (bila diminta) */
  if (flag('cleanup-qc-sessions')) {
    if (!dbPath) { console.error('Tidak ada DB untuk dibersihkan.'); process.exit(1); }
    const n = await cleanupQcSessions(dbPath);
    console.log(`Dibersihkan: ${n} sesi buatan harness QC (userAgent='qc-harness').`);
    process.exit(0);
  }
  /* Sesi superuser: dari DB, atau dibuat sementara bila --mint-session */
  if (!superToken) {
    if (flag('mint-session') && dbPath && accounts.superuser) {
      superToken = await mintQcSession(dbPath, accounts.superuser);
      console.log(`Sesi QC sementara dibuat untuk userId ${accounts.superuser} (berlaku 2 jam).`);
      console.log('Hapus setelah selesai:  node scripts/rbac-qc-live.mjs --cleanup-qc-sessions');
    } else {
      console.error('\u274c Tidak ada sesi superuser aktif di database.');
      console.error('   \u2192 Pilihan 1: login sebagai superuser di browser, lalu jalankan ulang.');
      console.error('   \u2192 Pilihan 2: pakai --mint-session (sesi QC sementara; hanya dev/Codespace).');
      console.error('   \u2192 Cek cepat:  node scripts/get-superuser-token.mjs');
      process.exit(4);
    }
  }
  const token = superToken;
  const notes = [];
  console.log(`Base            : ${BASE}`);
  console.log(`Sumber akun     : ${source}`);
  if (userCount != null) console.log(`Database        : ${userCount} user, ${sessionCount} sesi aktif`);
  if (orgId) console.log(`Organisasi      : ${orgId}`);
  console.log(`Token superuser : ${token ? 'ditemukan' : 'TIDAK ditemukan'}`);
  console.log('');
  if (userCount != null) notes.push(`Database berisi ${userCount} user dan ${sessionCount} sesi aktif.`);
  if (orgId) notes.push(`Organisasi aktif terdeteksi: ${orgId}.`);

  // Seed user uji bila diminta & level belum punya akun
  if (SEED && token) {
    for (const lv of ['admin', 'manager', 'editor', 'viewer']) {
      if (!accounts[lv]) {
        const id = await seedUser(lv, token, orgId);
        if (id) { accounts[lv] = id; notes.push(`User uji dibuat untuk level ${lv} (id ${id}).`); }
      }
    }
  }

  const tokens = {};
  for (const lv of LEVELS) {
    if (lv === 'superuser' && token) { tokens[lv] = { token, source: 'superuser-session' }; continue; }
    if (accounts[lv] && token) {
      const t = await impersonate(accounts[lv], token);
      tokens[lv] = { token: t, source: t ? 'impersonation' : 'impersonation-failed' };
      if (!t) console.error(`  ! impersonasi gagal untuk level ${lv} (user id ${accounts[lv]})`);
    } else {
      tokens[lv] = { token: null, source: 'none' };
    }
  }

  const results = [];
  for (const sc of SCENARIOS) {
    for (const lv of LEVELS) {
      const t = tokens[lv]?.token || null;
      const body = sc.body
        ? JSON.parse(JSON.stringify(sc.body).replace('__ORG__', orgId ?? ''))
        : undefined;
      const r = await call(sc.method, sc.path, t, body);
      const allowed = r.status >= 200 && r.status < 300;
      const expectAllow = sc.expect[lv] === 1;
      results.push({
        scenario: sc.id, level: lv, method: sc.method, path: sc.path,
        status: r.status, errorCode: r.json?.error ?? null,
        allowed, expect: expectAllow ? 'ALLOW' : 'DENY',
        pass: expectAllow ? allowed : [401, 403].includes(r.status),
      });
    }
  }

  const report = {
    base: BASE, generatedAt: new Date().toISOString(), accountSource: source,
    levels: LEVELS, scenarios: SCENARIOS, tokens, results, notes,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(OUT, 'report.html'), html(report));

  const pass = results.filter((r) => r.pass).length;
  console.log(`QC live: ${pass}/${results.length} sesuai harapan`);
  for (const lv of LEVELS) {
    const rs = results.filter((r) => r.level === lv);
    console.log(`  ${lv.padEnd(10)} ${rs.filter((r) => r.pass).length}/${rs.length}  (token: ${tokens[lv]?.source})`);
  }
  const bad = results.filter((r) => !r.pass);
  if (bad.length) {
    console.log(`\n! ${bad.length} skenario menyimpang dari PRD:`);
    for (const r of bad) {
      const got = r.status == null ? 'tidak ada respons' : `HTTP ${r.status}${r.errorCode ? ' ' + r.errorCode : ''}`;
      console.log(`  ${r.scenario.padEnd(14)} ${r.level.padEnd(10)} harapan=${r.expect.padEnd(5)} dapat=${got}  →  ${r.method} ${r.path}`);
    }
    console.log('\n  Tempelkan baris-baris ini ke chat; saya perbaiki akar penyebabnya.');
  }
  console.log(`\nBukti visual: ${join(OUT, 'report.html')}`);
  console.log(`Data: ${join(OUT, 'report.json')}`);

  if (flag('push')) {
    const { execFileSync } = await import('node:child_process');
    const branch = `qc-report-${Date.now()}`;
    try {
      execFileSync('git', ['checkout', '-b', branch], { stdio: 'inherit' });
      execFileSync('git', ['add', OUT], { stdio: 'inherit' });
      execFileSync('git', ['commit', '-m', 'qc: laporan impersonasi live (dari app berjalan)'], { stdio: 'inherit' });
      execFileSync('git', ['push', '-u', 'origin', branch], { stdio: 'inherit' });
      console.log(`\nLaporan sudah di-push ke branch '${branch}'. Saya bisa membacanya langsung — tidak perlu menempel apa pun.`);
    } catch (e) {
      console.error(`\nGagal push otomatis (${e?.message?.split('\n')[0]}).`);
      console.error(`Fallback: buat branch baru sendiri lalu push:`);
      console.error(`  git checkout -b ${branch} && git add ${OUT} && git commit -m "qc: laporan" && git push -u origin ${branch}`);
    }
  } else {
    console.log(`\nKirim ke saya: tambahkan --push pada perintah di atas (otomatis commit & push), atau tempel keluarannya.`);
  }
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error('QC live gagal:', e); process.exit(2); });
