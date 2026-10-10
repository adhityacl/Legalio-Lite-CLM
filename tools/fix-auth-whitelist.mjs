#!/usr/bin/env node
/**
 * Perbaikan kecil mandiri: persempit whitelist `/api/auth` pada rbacAuthMiddleware
 * agar `/api/auth-console/*` TIDAK ikut lolos tanpa autentikasi.
 *
 * Kenapa: `req.path.startsWith("/api/auth")` juga cocok untuk "/api/auth-console/...",
 * sehingga 5 endpoint admin-console masih terbaca anonim walau tier `strict` sudah aktif.
 *
 * Sifat: idempoten & aman. Tidak menyentuh berkas lain.
 *
 * Pemakaian (di dalam Codespace, dari akar repo):
 *   node tools/fix-auth-whitelist.mjs server.ts
 *
 * Keluaran:
 *   "PATCHED"          -> berhasil diubah, silakan restart dev server
 *   "ALREADY PATCHED"  -> sudah benar, tidak ada perubahan
 *   exit code 1        -> anchor tidak ditemukan (kirimkan pesan ini ke saya)
 */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] ?? 'apps/backend/src/server.ts';
const FROM = '    req.path.startsWith("/api/auth") ||';
const TO = '    /* RBAC-INTEGRATION-V1-STRICT2 */\n    (req.path === "/api/auth" || req.path.startsWith("/api/auth/")) ||';

let src;
try {
  src = readFileSync(file, 'utf8');
} catch {
  console.error(`TIDAK BISA membaca ${file}. Jalankan dari akar repo (folder yang berisi server.ts).`);
  process.exit(1);
}

if (src.includes('RBAC-INTEGRATION-V1-STRICT2')) {
  console.log('ALREADY PATCHED — tidak ada perubahan. Silakan restart dev server (Ctrl+C lalu: npm run dev).');
  process.exit(0);
}

const count = src.split(FROM).length - 1;
if (count === 0) {
  console.error(`ANCHOR TIDAK DITEMUKAN di ${file}.`);
  console.error('Cari manual baris: ' + FROM.trim());
  console.error('Ganti dengan:      (req.path === "/api/auth" || req.path.startsWith("/api/auth/")) ||');
  process.exit(1);
}
if (count > 1) {
  console.error(`ANCHOR muncul ${count}x — saya tidak mau menebak. Kirimkan hasil "grep -n \'/api/auth\' server.ts" ke saya.`);
  process.exit(1);
}

writeFileSync(file, src.replace(FROM, TO));
console.log('PATCHED — whitelist /api/auth dipersempit.');
console.log('Langkah berikutnya: hentikan dev server (Ctrl+C) lalu jalankan ulang: npm run dev');
