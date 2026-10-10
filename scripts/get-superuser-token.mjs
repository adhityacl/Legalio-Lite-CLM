#!/usr/bin/env node
/**
 * Menampilkan token sesi untuk akun SUPERUSER dari database SQLite lokal.
 *
 * Pakai:
 *   node scripts/get-superuser-token.mjs [--db auth.db] [--all] [--preview]
 *
 *   --db <path>   Path SQLite better-auth (default: cari auth.db / sqlite.db / better-auth.db)
 *   --all         Tampilkan juga sesi untuk semua role (bukan hanya superuser)
 *   --preview     Sembunyikan sebagian token (aman untuk ditempel ke chat)
 *
 * Hanya MEMBACA database (readOnly). Tidak mengubah apa pun.
 */
import { existsSync, readdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(`--${n}`);

function findDb(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  for (const f of ['auth.db', 'sqlite.db', 'better-auth.db']) if (existsSync(f)) return f;
  try { for (const f of readdirSync('.')) if (/\.(db|sqlite)$/i.test(f) && !/-wal$|-shm$/.test(f)) return f; } catch {}
  return null;
}

const dbPath = findDb(arg('db'));
if (!dbPath) {
  console.error('Database SQLite tidak ditemukan. Jalankan dari akar repo, atau pakai --db <path>.');
  process.exit(1);
}

const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(dbPath, { readOnly: true });

const cols = db.prepare('PRAGMA table_info(user)').all().map((c) => c.name);
const pick = (want, fallback = "''") => (cols.includes(want) ? want : fallback);
const users = db.prepare(`SELECT id, ${pick('email')} AS email, ${pick('name')} AS name, ${pick('role')} AS role, ${pick('banned', '0')} AS banned FROM user`).all();
const sessCols = db.prepare('PRAGMA table_info(session)').all().map((c) => c.name);
const orderBy = sessCols.includes('createdAt') ? "ORDER BY datetime(createdAt) DESC" : '';
const sessions = db.prepare(`SELECT token, userId, expiresAt FROM session WHERE datetime(expiresAt) > datetime('now') ${orderBy}`).all();

const rows = [];
for (const s of sessions) {
  const u = users.find((x) => x.id === s.userId) || {};
  const role = String(u.role || '').toLowerCase();
  const isSuper = ['superuser', 'owner', 'super admin'].includes(role);
  if (!flag('all') && !isSuper) continue;
  rows.push({
    email: u.email ?? '-', role: u.role ?? '-', banned: u.banned ? 'yes' : 'no',
    expiresAt: s.expiresAt, token: flag('preview') ? `${String(s.token).slice(0, 8)}…${String(s.token).slice(-6)}` : s.token,
  });
}
db.close();

console.log(`DB: ${dbPath} · user: ${users.length} · sesi aktif: ${sessions.length}`);
if (!rows.length) {
  console.log('\nTidak ada sesi aktif untuk superuser.');
  console.log('Solusi: login sekali sebagai akun superuser di browser (http://localhost:3000), lalu jalankan lagi.');
  process.exit(0);
}
console.log('');
for (const r of rows) {
  console.log(`email      : ${r.email}`);
  console.log(`role       : ${r.role}   (banned: ${r.banned})`);
  console.log(`berakhir   : ${r.expiresAt}`);
  console.log(`TOKEN      : ${r.token}`);
  console.log('-'.repeat(60));
}
console.log('\nHeader yang dipakai app:  Authorization: Bearer <token>   (juga: x-session-token)');
console.log('Di browser: DevTools → Application → Local Storage → key "auth_session_token".');
console.log('Peringatan: token ini setara akses penuh akun tersebut. Jangan sebar; matikan setelah selesai.');
