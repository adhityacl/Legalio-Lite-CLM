#!/usr/bin/env node
/**
 * Menutup celah PRD §27: sesi impersonasi tidak pernah mengisi kolom
 * `session.impersonatedBy`, sehingga jejak audit "siapa menyamar sebagai siapa"
 * hilang (sekaligus menyulitkan pemisahan identitas admin vs user yang disamari).
 *
 * Patcher ini mengubah `src/server/authConsoleRoutes.ts`:
 *   1. menyisipkan penentuan pemanggil dari token sesi (bukan header email),
 *   2. menambahkan kolom `impersonatedBy` pada INSERT sesi impersonasi.
 *
 * Sifat: idempoten (dilewati bila penanda sudah ada), hanya menyentuh satu blok.
 *
 * Pakai (dari akar repo):
 *   node tools/apply-impersonation-audit.mjs
 *   node tools/apply-impersonation-audit.mjs src/server/authConsoleRoutes.ts   # path kustom
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const file = process.argv[2] ?? 'apps/backend/src/authConsoleRoutes.ts';
const MARK = '/* RBAC-IMPERSONATION-AUDIT-V1 */';

if (!existsSync(file)) {
  console.error(`Tidak menemukan ${file}. Jalankan dari akar repo.`);
  process.exit(1);
}
let src = readFileSync(file, 'utf8');

if (src.includes(MARK)) {
  console.log('ALREADY PATCHED — kolom impersonatedBy sudah diisi. Tidak ada perubahan.');
  process.exit(0);
}

const INSERT_SQL_OLD = 'INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId, activeOrganizationId)\n      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
const INSERT_SQL_NEW = 'INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId, activeOrganizationId, impersonatedBy)\n      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

const RUN_OLD = `.run(sessionId, expiresAt.toISOString(), token, now.toISOString(), now.toISOString(), req.ip || '127.0.0.1', 'Impersonated by Enterprise Superadmin', id, null);`;
const RUN_NEW = `.run(sessionId, expiresAt.toISOString(), token, now.toISOString(), now.toISOString(), req.ip || '127.0.0.1', 'Impersonated by Enterprise Superadmin', id, null, _callerUserId);`;

const SESSIONID_ANCHOR = '    const sessionId = `sess_${Date.now()}_${crypto.randomBytes(4).toString(\'hex\')}`;';
const CALLER_BLOCK = [
  '    ' + MARK,
  '    // Identitas pemanggil dari TOKEN SESI (bukan header email yang bisa dipalsukan).',
  '    const _callerToken = ((req.headers[\'authorization\'] || \'\').toString().replace(/^Bearer\\s+/i, \'\')',
  '      || (req.headers[\'x-session-token\'] || \'\').toString()).trim();',
  '    let _callerUserId: string | null = null;',
  '    if (_callerToken) {',
  '      try {',
  '        _callerUserId = (sqliteDb.prepare(\'SELECT userId FROM session WHERE token = ?\').get(_callerToken) as any)?.userId ?? null;',
  '      } catch { _callerUserId = null; }',
  '    }',
  SESSIONID_ANCHOR,
].join('\n');

function count(hay, needle) { return hay.split(needle).length - 1; }
for (const [label, needle] of [['INSERT SQL', INSERT_SQL_OLD], ['call .run', RUN_OLD], ['anchor sessionId', SESSIONID_ANCHOR]]) {
  const c = count(src, needle);
  if (c === 0) { console.error(`Anchor tidak ditemukan: ${label}. Kirimkan blok impersonate-nya ke saya.`); process.exit(1); }
  if (c > 1) { console.error(`Anchor ${label} muncul ${c}x — saya tidak menebak.`); process.exit(1); }
}

src = src.replace(SESSIONID_ANCHOR, CALLER_BLOCK);
src = src.replace(INSERT_SQL_OLD, INSERT_SQL_NEW);
src = src.replace(RUN_OLD, RUN_NEW);

writeFileSync(file, src);
console.log('PATCHED — sesi impersonasi kini mencatat impersonatedBy (dari token sesi pemanggil).');
console.log('Langkah berikutnya: restart dev server (Ctrl+C lalu npm run dev),');
console.log('lalu periksa: node scripts/get-superuser-token.mjs --all  (kolom impersonatedBy terisi pada sesi hasil impersonasi)');
