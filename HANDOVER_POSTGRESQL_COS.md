# Handover: SQLite ke PostgreSQL, `uploads/` ke Tencent COS, setup di onboarding

Status per 22 Oktober 2026. Branch: `PostgreSQL`.

Pekerjaan dibagi menjadi 7 fase (A–G). Fase D dipecah menjadi D1 (backend pg dan skema, sifatnya hanya menambah) dan D2 (pindah engine). **Fase A sampai F selesai.** Aplikasi hanya berjalan di PostgreSQL, upload memakai Tencent COS, dan onboarding meminta koneksi DB serta kunci COS. Review keamanan fase B sudah dilakukan dan 10 temuannya sudah diperbaiki; semua tes hijau. **Tinggal fase G (Docker, compose, dokumentasi).**

> Koneksi DB untuk dev: isi `DATABASE_URL=postgres://legalio:legalio@127.0.0.1:5432/legalio` di `apps/backend/.env`, atau kosongkan agar form "Hubungkan PostgreSQL" muncul di kunjungan pertama. File ini di-update dan di-push setiap kali satu fase selesai. Dokumen ini berisi semua yang perlu diketahui untuk melanjutkan. Catatan kerja sebelumnya (rencana arsitek dan review) hanya disimpan di `/tmp` dan sudah hilang, jadi isinya dirangkum ulang di sini.

> **Jangan merge ke `main` sebelum fase G selesai.** `.github/workflows/deploy.yml` men-deploy `main` ke produksi secara otomatis. Fase A dan B tidak aman dideploy sendirian (lihat §6). Setelah merge, produksi akan mulai dengan PostgreSQL kosong. Itu memang keputusannya, tetapi **jangan hapus `/data/kaelyn.db`** di server; biarkan sebagai arsip.

---

## 1. Keputusan yang sudah final

| Topik | Keputusan |
|---|---|
| Database | Hanya PostgreSQL. `better-sqlite3` dihapus total, tanpa dukungan ganda. |
| Data lama | Tidak diimpor. Postgres kosong diperlakukan sebagai instalasi baru: setup, lalu data demo seperti sekarang. |
| Koneksi DB | Diisi di **langkah pertama onboarding** (host, port, user, password, database, SSL), lalu disimpan ke `APP_DATA_DIR/database.json` dengan mode `0600`. Env `DATABASE_URL` selalu menang atas file. |
| File storage | **Tencent COS wajib**, tanpa fallback ke disk lokal. SDK: `cos-nodejs-sdk-v5` versi `^3` (lisensi ISC). Format link tetap `/uploads/...`, sehingga data dan frontend tidak berubah. |
| Kredensial COS | Diisi saat onboarding, diuji dengan put, get lalu delete objek percobaan, lalu disimpan **terenkripsi** di DB. Seluruh tabel `integration_credentials` (Google + COS) dienkripsi. |
| Backup/restore `.db` dan SQLite browser di /sys | Dihapus (sudah dikerjakan di fase A). Backup diserahkan ke `pg_dump` dan versioning COS. |
| Pencarian | `ILIKE`, bukan tsvector. Beri komentar `shortcut:`; jalur upgrade-nya `pg_trgm` atau tsvector. |
| Model penyimpanan inti | Koleksi in-memory (`db`) tetap dipakai. Penyimpanan diserialkan (satu writer), dengan snapshot dan satu transaksi. |
| Transaksi | Transaksi ambient memakai `AsyncLocalStorage` (`sql.tx`), jadi client tidak perlu dioper ke setiap fungsi. |
| Start setelah DB diisi | Server tidak restart. `main.ts` melakukan `import('./server')` secara lazy setelah koneksi berhasil. |
| Di luar scope | Enkripsi `smtpPassword`, `geminiApiKey`, `refreshToken` di `app_settings`; endpoint `DELETE` untuk COS; tabel `schema_migrations`; pembersihan permission rbac `platform.database.*` dan key i18n `sqlite.*`/`backup.*`; dukungan HTTP Range di `/uploads`; key upload berbasis nama organisasi (masalah lama). |

---

## 2. Cara melanjutkan

```bash
git switch PostgreSQL
git pull              # semua fase yang selesai sudah di-commit dan di-push ke origin/PostgreSQL
```

> Aturan kerja: setiap fase yang selesai dan lulus gate langsung di-commit, file ini di-update, lalu di-push. Jangan pernah meng-commit `packages/ui-components/src/moduix/ui/alert/Alert.tsx` (perubahan lain, bukan bagian pekerjaan ini).

PostgreSQL untuk pengujian (container lama ikut hilang saat restart):

```bash
docker run -d --name legalio-pg -e POSTGRES_USER=legalio -e POSTGRES_PASSWORD=legalio \
  -e POSTGRES_DB=legalio -p 127.0.0.1:5432:5432 postgres:17-alpine
```

### Gate untuk setiap fase (semua harus hijau sebelum fase berikutnya)

```bash
npm run lint
npm run build
npm test                     # semua unit test; butuh container pg (database legalio_test_* dibuat lalu dihapus)
npm run build:sys            # wajib sebelum e2e, kalau tidak halaman /sys gagal ("System Console has not been built")
npm run test:e2e:postgres    # perlu Playwright Chromium
npm run test:e2e:data-entry
```

Di codespace ini, e2e yang dijalankan langsung di shell agen kadang dihentikan paksa (exit 137). Jalankan di background, lalu baca exit code-nya. Setelah run yang terputus, hapus database `legalio_test_*` yang tertinggal:
```bash
docker exec legalio-pg psql -U legalio -tAc "select datname from pg_database where datname like 'legalio_test_%'"
```

Ditambah **cek promise** (lihat §7). Tsconfig repo ini tidak strict, sehingga `tsc` tidak menangkap promise yang dipakai sebagai boolean. Akibatnya bisa berupa **bypass otorisasi**.

---

## 3. Yang sudah selesai

### Fase A: hapus fitur khusus SQLite ✅
- Dihapus di `apps/backend/src`: `sqliteBackups.ts`, `sqliteBackupRoutes.ts`, `sqliteEditing.ts`, `benchmarkCore.ts`, `databaseFilename.test.ts` dan `migrations/001_rbac_alignment.sql`. Endpoint SQLite browser di `authConsoleRoutes.ts` dan route policy-nya juga dihapus.
- UI yang dihapus: `SQLiteBackupsPanel`, kedua `SQLiteDatabaseCard`, `i18n/backups.ts`, menu Database/Backups di Sidebar, Header, AdminUsersView dan PlatformConfigurationPanel, serta tab `database`/`backups` di `packages/shared/src/systemConsole.ts`.
- `appRoutes.ts`: `settings-security`, `admin-system-database` dan `admin-system-backups` sekarang mengarah ke `admin-system-dashboard`. Ada tesnya.
- Sengaja dipertahankan sampai fase D: `indexedConfiguration.ts` dan migrasi 003–006 (masih diimpor), watch-ignore `*.db` di `vite.config.ts`, serta langkah `VACUUM INTO` di `organizationReset`.

### Fase B: semua akses DB menjadi async, masih memakai SQLite ✅
Tujuannya: perubahan async yang paling berisiko diuji dulu dengan engine lama, sebelum engine diganti.

- **`apps/backend/src/db.ts`** (baru):
  - Mengekspor `sql = { get, all, run, exec, tx, inTx }`, `createSql(conn)` dan `useSqlite(conn)`.
  - `tx` memakai ALS: `BEGIN/COMMIT/ROLLBACK` di lapisan terluar, `SAVEPOINT` untuk transaksi bersarang.
  - Store ditandai `done` saat transaksi selesai. Pemanggilan yang "bocor" setelahnya kembali ke koneksi biasa.
  - Mutex promise-chain membuat transaksi terluar berjalan satu per satu. Panggilan non-tx juga menunggu transaksi yang sedang terbuka.
  - Parameter `?` dan `@name` diteruskan apa adanya. `run` mengembalikan `{changes}`.
  - Nilai int8 dikembalikan sebagai Number bila aman, selain itu sebagai string.
  - Tes: `db.test.ts`.
- **Otorisasi:**
  - `identityOf(req)` versi sync di `identity.ts`. Hanya middleware otorisasi, `/api/auth` dan `/uploads` yang memanggil `resolveIdentity` async.
  - `createOrganizationScope(teams, orgId, collections)` sekarang sync. `teamsOf` di `recordScope.ts` membaca `req.teams`, yang dimuat sekali oleh middleware di `routePolicies.ts`. Jika `teams` tidak ada, list departemen kosong dan akses ditolak.
- **Bypass yang ditemukan review dan sudah diperbaiki:**
  - `.some` di `/uploads` diganti loop di `authorizeUpload`, di `server.ts`.
  - `.filter` di `/api/search` diganti loop.
  - `.every` untuk departemen undangan dan `.some` di `hasApprovalInvitation`.
  - `withRequest`/`isApprover` di `approvalRoutes`.
- **Error async:** `forwardAsyncRouteErrors` (`asyncRoutes.ts`) sekarang menerima Router dan dipakai di router document, approval, googleCredentials dan authConsole. Kedua middleware async `app.use` memakai `run(...).catch(next)`.
- **Penyimpanan:**
  - `createCoreSaver(db, memory)` di `coreDataStore.ts` menyediakan `save(alongside?)`, `withSaveLock` dan snapshot `structuredClone`.
  - Lock diambil **di luar** transaksi. Ada assert `!inTx()` di luar produksi.
  - Konfigurasi platform memakai `coreSaver.save(() => appendAudit(...))`. Reset aplikasi memakai `withSaveLock(() => sql.tx(...))` dan `resetSyncCache()`.
- **Startup:**
  - `export async function init()` di `server.ts` di-`await` oleh `startServer()` sebelum `listen`.
  - DDL di `lib/auth.ts` pindah ke `initAuthDatabase()`. `googleCredentials` dan `mailTemplateStore` punya `init()` masing-masing, dan `googleCredentials` menyimpan cache baris kredensial di memori.
- **Migrasi:** `002_tenant_boundaries.ts` dihapus karena tidak dipakai. 003 diberi shim async; 004–006 hanya berubah import.
- **Hasil gate:** lint ✅, build ✅, unit 62/62 ✅, e2e sqlite 32 ✅ (termasuk tes baru "akses upload mengikuti record pemilik dan departemennya"), data-entry 41 skenario ✅, cek promise tanpa temuan baru.

### Perbaikan hasil review fase B ✅
Review menemukan bahwa di SQLite tidak ada bug aktif, karena request tidak pernah saling menyela. Tetapi ada pola "cek di luar tx, lalu tulis" yang akan menjadi race begitu memakai pg. Semua perbaikan di bawah bekerja di kedua engine: write bersyarat dengan cek `changes === 1`, plus lock baris.

1. **Approval tidak bisa dilompati.** `approvalRoutes.ts`: write pertama di tx adalah `UPDATE approval_requests … WHERE id=? AND status='pending' AND current_step=?`. Jika `changes !== 1` hasilnya 409 `NOT_CURRENT_APPROVER`. Ada tes.
2. **Approval yang sudah diputuskan tidak bisa dihapus.** DELETE diawali `DELETE FROM approval_requests WHERE id=? AND status='pending'`, lalu wajib `changes === 1` (selain itu 409). Ada tes. Tabel approval tidak punya FK, jadi parent boleh dihapus duluan.
3. **Kunci status dokumen.** `documentRoutes.ts` punya `lockDocument(id)` (`UPDATE contract_documents SET id = id WHERE id = ?`). Di pg ini mengunci baris. PATCH dan DELETE: lock → baca ulang status → `approvalStatusLock` → write, semua dalam satu tx.
4. **Save gagal tidak membuang perubahan lain.** `createCoreSaver(db, memory, reload?)` menjalankan `resetSyncCache` dan `reload` **di dalam** lock save. Ada tes.
5. **Tidak ada referensi lepas.** `recalculateStatuses` sekarang mengubah kontrak/IO di tempat (`Object.assign`), bukan mengganti array.
6. **Nomor versi draft.** Draft dan restore membaca versi terakhir di dalam tx, setelah `lockDocument`.
7. **Reset aplikasi.** State baru baru dipasang ke `db` setelah commit. Catch tidak lagi melakukan restore dangkal. **Jangan menambah `await`** antara membangun state dan mengembalikannya (ada komentar di kode).
8. **Refresh lifecycle.** Satu promise in-flight (`lifecycleRefresh`) dipakai bersama oleh semua pemanggil.
9. **Login Google bersamaan.** `isUniqueViolation(err)` di `db.ts`. Insert user yang bentrok diabaikan, lalu user dibaca ulang. Ada tes.
10. **Impor `data_store.json` gagal** sekarang memanggil `resetSyncCache`.

Gate: lint ✅, build ✅, unit 66/66 ✅, e2e sqlite 32 ✅, data-entry 41 ✅, cek promise tanpa temuan baru ✅.

### Fase C: Tencent COS dan enkripsi kredensial ✅
- **`objectStore.ts`:** `ObjectStore` (put/get/delete/list, berbasis Buffer), `memoryStore()`, `parseCosConfig()` (validasi bucket/region/prefix; prefix selalu diakhiri `/`), `cosStore(cfg, client?)`, `probe(store)`, `keyFromLink(link)`.
  - `cosStore` memberi prefix pada key, membuangnya saat `list`, dan mengikuti halaman (`IsTruncated`/`NextMarker`).
  - Parameter `client` bisa diganti dengan client palsu untuk tes.
  - SDK: `cos-nodejs-sdk-v5` 3.0.0.
- **`secretBox.ts`:** `seal`/`open`, AES-256-GCM, format `'v1:'+base64(iv|tag|ct)`. Kunci di-HKDF dari `BETTER_AUTH_SECRET`, dengan fallback yang sama seperti `lib/auth.ts`.
- **`googleCredentials.ts`:**
  - Semua baris dienkripsi saat ditulis. Baris lama yang belum dienkripsi dibaca sebagai JSON biasa. Baris yang gagal didekripsi dicatat ke log lalu dilewati, jadi server tetap bisa start.
  - Baris `tencent_cos`, dengan fungsi `getCos`/`saveCos`/`storageStatus()`.
  - `GET` dan `PUT /api/integrations/storage/cos` (superuser): validasi → probe → simpan. `secretKey` tidak pernah dikembalikan.
- **`server.ts`:**
  - `getStore()` mengembalikan `memoryStore()` di `APP_TEST_MODE` tanpa COS; selain itu 503 `STORAGE_NOT_CONFIGURED`.
  - `saveUpload` async, dengan key = `keyFromLink(link)`, dan melempar error jika gagal. Semua `generateNext*Id()` tetap setelah `await`.
  - `/uploads`: `authorizeUpload` menyimpan key yang lolos cek di `res.locals.uploadKey`, lalu `serveUpload` mengambil objek dengan key itu (404 jika tidak ada). Content type ditentukan dari ekstensi. Segmen yang diawali `.` ditolak dengan 400.
  - Backup Drive memakai `storage.list/get` dengan stamp ETag, dan index-nya di `APP_DATA_DIR/drive-backup.json`.
  - Reset aplikasi menghapus semua key setelah commit.
- **`organizationReset.ts`:** memakai `storage.delete(keyFromLink(link))`. Langkah `VACUUM INTO` dihapus. Tanpa COS di luar mode tes, hasilnya 503 sebelum ada yang dihapus.
- **`runtimePaths.ts`:** `UPLOADS_DIR` dihapus.
- **/sys:** kartu `CosStorageForm.tsx` di bawah form kredensial Google, dengan i18n en/id/zh.
- **Tes:** `objectStore.test.ts` (5), `secretBox.test.ts` (3, termasuk store kredensial), reset org di `memoryStore`, upload di e2e dicek lewat HTTP, dan endpoint COS di e2e (400/401/403/404).
- **Gate:** lint ✅, build ✅, unit 74/74 ✅, e2e sqlite 32 ✅, data-entry 41 ✅, cek promise tanpa temuan baru ✅, grep `UPLOADS_DIR` kosong ✅.

### Fase D1: backend pg dan skema (hanya menambah; aplikasi masih SQLite) ✅
- **`db.ts`** (backend SQLite tidak berubah):
  - `toPg(text, params)`: `?` dan `@name` menjadi `$n`. `@name` yang berulang memakai `$n` yang sama; `@name` yang hilang melempar error.
  - Assert camelCase dan `user` di luar produksi.
  - Type parser per query: 1184 menjadi string ISO; 20 menjadi Number (atau string jika tidak aman).
  - `pgSql`, `connect`/`pool`/`end`, `resolveDatabaseConfig`, `testConnection`, `saveDatabaseConfig` (0600).
  - `isUniqueViolation` juga mengenali `23505`.
  - Guard mode tes: nama database wajib diawali `legalio_test_`.
- **`schema.ts` → `ensureSchema()`:**
  - Urutan: better-auth `getMigrations(authOptions(pool()))` → tabel inti dan `apikey` → tabel tenant-boundary (`organization_settings`, `organization_integrations`, `audit_log`, `schema_migrations`) → `createNormalizedCoreSchema(sql, true)` → index status → dokumen → approval (`file_data bytea`, `approval_events.seq`) → mail, kredensial, instalasi → `uq_member_org_user`, `uq_team_member`.
  - Idempoten. **Belum dipanggil aplikasi.**
- **`lib/auth.ts`:** `authOptions(database)` berupa fungsi, karena `baseURL` dibaca ulang saat `reloadAuthConfiguration`.
- **`normalizedCoreStore.ts`:** `createNormalizedCoreSchema(db, postgres)`.
- **`runtimePaths.ts`:** `DATABASE_CONFIG_FILE`.
- **`testDatabase.ts`:** `createTestDatabase()` mengembalikan `{ name, url, drop }`. `drop` menjalankan `DROP … WITH (FORCE)`.
- **Script baru `npm run test:pg`:** `db.pg.test.ts` (9 tes) dan `schema.test.ts` (1 tes). Butuh container pg (§2).
- **Gate:** lint ✅, build ✅, sqlite 74/74 ✅, pg 10/10 ✅, e2e 32 ✅, data-entry 41 ✅, promise ✅, tidak ada DB tes yang tertinggal ✅.

**Fakta skema better-auth 1.7.5 di pg17** (NN = NOT NULL):
- `session.updatedAt` dan `account.updatedAt` bersifat NN tanpa default.
- `account` tidak punya `issuer`.
- `organization.slug` NN dan UNIQUE. `organization.createdAt`, `team.createdAt`, `member.createdAt`, `team.memberCount` dan `invitation.expiresAt` NN tanpa default.
- `teamMember.membershipKey` bertipe text dengan index UNIQUE. Insert manual harus mengisi NULL atau nilai yang unik.
- `member.status` nullable tanpa default, jadi insert manual wajib menulis `'active'`.
- Semua FK `ON DELETE CASCADE`, termasuk `invitation.inviterId` → `"user"`.

**Jebakan pg:**
- Satu statement yang error membatalkan seluruh transaksi. Pola catch-lalu-lanjut di dalam `sql.tx` wajib dibungkus `sql.tx(...)` bersarang (savepoint).
- `SUM` atas bigint mengembalikan **string**.
- `toPg` tidak memahami komentar SQL, jadi jangan menulis `'` atau kata camelCase di komentar `--`.
- `connect()` melempar error jika pool sudah ada. Panggil `end()` sebelum retry (penting untuk fase F).

### Fase D2: aplikasi pindah ke PostgreSQL ✅
- **Dihapus:** `better-sqlite3` dan `@types/better-sqlite3`, `@better-auth/cli`, `auth.config.ts`, script `auth:*`, `db.test.ts` (versi SQLite), `indexedConfiguration.ts`, migrasi 003–006, semua DDL modul (sekarang di `schema.ts`), probe `sqlite_master`/PRAGMA, `migrationBlock` dan watch-ignore `*.db`.
- **`db.ts`:**
  - `sql` sekarang facade pg.
  - `isConstraintViolation` (`/^23/`) dipetakan ke 409.
  - `isUniqueViolation` (`23505`).
- **`server.ts` `init()`:** `connect(resolveDatabaseConfig())` → `ensureSchema()`, lalu data dimuat. better-auth memakai `pool()`.
- **Terjemahan SQL sesuai §4 Fase D langkah 5:**
  - camelCase dan `"user"` / `"teamMember"` dikutip.
  - Boolean better-auth.
  - Tanpa `issuer`.
  - `ON CONFLICT`, `IS DISTINCT FROM`, `lower()` dan `ILIKE`.
  - `seq` dan `COUNT(*) FILTER` di approval.
  - Pencarian memakai ILIKE di `search_records`, dengan komentar `shortcut:`.
- **Lock:**
  - Advisory xact lock untuk setup, kode approval per org, dan invariant admin/superuser (`organizationAdminRoutes.ts`).
  - `FOR UPDATE` pada baris organisasi untuk `patchOrganizationSettings` / `patchIntegration`, dan pada template email.
  - Submit approval mengunci baris dokumen terlebih dulu, lalu mengecek ulang dokumen dan approval yang masih pending.
- **Tes:**
  - Semua unit test memakai `createTestDatabase()`. Script `npm test` menggabungkan semuanya.
  - E2E men-spawn server dengan `DATABASE_URL` dari database tes.
  - Script menjadi `test:e2e:postgres` dan `test:e2e:data-entry`.
- **Gate:** lint ✅, build ✅, unit 73/73 ✅, e2e postgres 32 ✅, data-entry 41 ✅, cek promise tanpa temuan baru ✅, grep `better-sqlite3|sqliteDb|.prepare(|sqlite_master|PRAGMA` kosong ✅.

### Fase E: batching baca ✅
- `childArrays(db, entity, rows)` di `normalizedCoreStore.ts` sekarang menjalankan satu query per tabel anak untuk semua parent sekaligus (`WHERE <fk> = ANY(?) ORDER BY position`), lalu hasilnya dikelompokkan di JS. `partner_dd_files` dikelompokkan dengan key `(partner_id, requirement_position)`. Jika tidak ada parent, tidak ada query anak sama sekali.
- Query anak dijalankan berurutan, bukan `Promise.all`. Alasannya: di dalam `sql.tx` semua query memakai satu client, dan query paralel pada satu client sudah deprecated di pg 8.23.
- Jumlah query per list:
  - partners: 1 + K·(3 + jumlah requirement DD) menjadi **5**
  - contracts: 1 + K menjadi **2**
  - spendings: 1 + 2K menjadi **3**
- Tes baru "a list read costs one query per table, not per parent row" (sebelum perbaikan: 11 vs 51 query).
- **Belum dioptimalkan:** jalur tulis `writeChildren` masih menjalankan satu DELETE plus satu INSERT per item anak, tetapi hanya untuk baris yang berubah. Penghapusan baris basi juga masih 2 query per id; ini bisa diganti satu `= ANY(?)` nanti.
- **Gate:** lint ✅, build ✅, unit 74/74 ✅, e2e postgres ✅, data-entry 41 ✅, cek promise ✅.

### Fase F: onboarding (DB dan COS) ✅

**Entry baru `apps/backend/src/main.ts`.** Bundle tetap `dist/server.cjs`; `dev`/`dev:combined` sekarang memakai `src/main.ts`.
- **Urutan boot:**
  1. `dotenv`.
  2. Produksi tanpa `BETTER_AUTH_SECRET` langsung keluar dengan kode 1.
  3. Jika ada config: `testConnection` (5 dtk) → `connect` → `import('./server')` → `init()`. Jika gagal: **exit 1, tidak pernah kembali ke form**.
  4. `/sys`, Vite (dev), lalu `listen`.
- **Urutan middleware shell:**
  1. `POST /api/system/database`, dengan `express.json()` hanya di route ini.
  2. Hand-off ke `realApp`.
  3. `GET /api/system/public-status` mengembalikan `{needsDatabase:true}`.
  4. `/api/*` lainnya mengembalikan 503 `DATABASE_REQUIRED`.
- **`POST /api/system/database`:**
  - 409 jika sudah ada config, app sudah jalan, atau ada percobaan lain yang sedang berjalan.
  - 400 `INVALID_DATABASE_CONFIG` jika input salah (validasi di `parseDatabaseConfig`, `db.ts`).
  - Urutan: `testConnection` → `connect` → `init()` (dengan `ensureSchema`) → **baru** `saveDatabaseConfig` (0600) → 201.
  - Jika gagal: `end()` lalu 400 `DATABASE_CONNECTION_FAILED` dengan pesan pg. Password tidak pernah ikut di pesan maupun log.

**Setup (`server.ts`):**
- `public-status` mengembalikan `needsDatabase:false`.
- `POST /api/system/setup` menerima `storage`. `checkCosInput` (`googleCredentials.ts`: parse + probe) dijalankan **sebelum** tx, lalu `saveCos` dijalankan di dalam tx setup setelah advisory lock. Jika tx di-rollback, `googleCredentials.init()` memuat ulang cache.
- `storage` wajib di luar `APP_TEST_MODE`.
- `init()` dimulai dengan `resetSyncCache`, jadi aman diulang.

**UI (`SignInForm.tsx`, dipakai app dan /sys):**
- Kartu "Hubungkan PostgreSQL": Host, Port 5432, Username, Password, Database, SSL. Error ditampilkan di Alert dengan `role="alert"`.
- Mode setup mendapat fieldset "File storage (Tencent COS)": SecretId, SecretKey, Bucket, Region, Prefix.
- i18n `db_setup.*` untuk en/id/zh. `login.setup_subtitle` diubah agar menyebut file storage.
- `AuthContext` sudah otomatis jatuh ke SignInForm saat menerima 503. Sudah dicek di Chromium untuk `/app` dan `/sys`.

**Lain-lain:** `.gitignore` mendapat `database.json` dan `drive-backup.json`.

**Tes `onboarding.test.ts` (4 tes):**
- input tidak valid (8 jenis)
- password salah: tanpa file dan tanpa password di respons maupun log
- input valid: 201, mode 0600, kemudian 409
- `storage` setup tidak valid
- `DATABASE_URL` menang atas file
- config tidak bisa dihubungi: exit 1
- produksi tanpa secret: exit 1

**Gate:** lint ✅, build ✅, unit 78/78 ✅, e2e postgres 32 ✅, data-entry 41 ✅, promise ✅ (`startServer()` hilang dari baseline), smoke test pada `dist/server.cjs` ✅.

**Belum dites:** rollback tx setup yang memulihkan cache COS, karena butuh probe COS asli yang berhasil.

> **Perilaku baru di dev:** di luar `APP_TEST_MODE`, upload mengembalikan 503 sampai superuser menyimpan COS di /sys (tab Google credentials) atau, setelah fase F, di onboarding. File lama di `uploads/` tidak lagi dilayani; ini sesuai keputusan "tanpa impor".

---

## 4. Yang belum dikerjakan (urutan wajib: C, D, E, F, G)

### Fase C: Tencent COS dan enkripsi kredensial ✅ SELESAI

Hasilnya ada di §3. Spesifikasi asli disimpan di bawah sebagai referensi. Penyimpangan dari spesifikasi:
- Status COS memakai `storageStatus()` dan `GET /api/integrations/storage/cos` terpisah, bukan bagian dari `status()`.
- Baris yang gagal didekripsi dilewati, tidak membuat start gagal.
- Reset org langsung 503 jika COS belum diatur.
- Content type tidak dikirim ke COS.

1. Tambahkan `cos-nodejs-sdk-v5@^3` di `apps/backend/package.json`.
2. **`apps/backend/src/objectStore.ts`** dengan 4 method:
   - `put(key, body: Buffer, contentType?)`
   - `get(key)`, yang mengembalikan `{ body: Buffer, contentType }` atau `null`
   - `delete(key)`
   - `list(prefix)`, yang mengembalikan `[{ key, size, etag, lastModified }]`

   Pakai Buffer, bukan stream: batas file 30 MB (multer) dan 25 MB (JSON), dan backup Drive memang butuh buffer.
   - `memoryStore()`: sekitar 20 baris, untuk tes dan `APP_TEST_MODE`.
   - `cosStore({ secretId, secretKey, bucket, region, prefix })`: semua key diberi prefix, dan `list` membuang prefix-nya. `list` **harus mengikuti halaman** (`IsTruncated`/`NextMarker`), karena COS mengembalikan paling banyak 1000 key per panggilan.
   - `probe(store)`: put, get, lalu delete `.legalio-probe-<uuid>`.
   - `keyFromLink('/uploads/…')`: lakukan decode, lalu tolak `\0`, `..` dan segmen yang diawali `.`.
   - Validasi: bucket `^[a-z0-9-]+-\d+$`; region `^[a-z]+(-[a-z0-9]+)+$`; prefix tanpa `/` di depan dan tanpa `..`, dinormalisasi agar diakhiri `/`. Dengan validasi ini host SDK tidak bisa diarahkan ke endpoint lain.
3. **`apps/backend/src/secretBox.ts`**:
   - `seal(text)` menghasilkan `'v1:' + base64(iv|tag|ciphertext)`; `open(text)` membalikkannya.
   - Algoritma AES-256-GCM.
   - Kunci: `crypto.hkdfSync('sha256', BETTER_AUTH_SECRET || 'insecure-development-secret-change-me', 'legalio', 'integration-credentials', 32)`. Fallback ini harus sama dengan yang ada di `lib/auth.ts`.
   - Catatan untuk dokumentasi: mengganti `BETTER_AUTH_SECRET` membuat kredensial lama tidak terbaca.
4. **`googleCredentials.ts`**:
   - `seal`/`open` dipasang di helper read/save bersama, sehingga semua baris otomatis terenkripsi.
   - Tambah baris `id='tencent_cos'`.
   - `status()` mengembalikan bucket, region, prefix dan 4 karakter terakhir `secretId`. **Jangan pernah mengembalikan `secretKey`.**
   - Endpoint `PUT /api/integrations/storage/cos`: hanya superuser, dengan permission `platform.configuration.update`, dan `probe` dijalankan sebelum menyimpan. Dipakai untuk rotasi kunci dan jalur DEMO_ADMIN. Tanpa `DELETE`.
5. **`server.ts`**:
   - `getStore()` membangun `cosStore` dari cache kredensial yang sudah didekripsi. Di `IS_TEST_MODE` tanpa baris COS, fungsi ini mengembalikan `memoryStore()`. Selain itu ia melempar `503 STORAGE_NOT_CONFIGURED`. Cache di-reset setiap kali kredensial disimpan.
   - `saveLocalFile` (sekitar L435) diganti `async saveUpload(...)` yang memanggil `storage.put`. Jika gagal, **lempar error**; jangan pernah mengembalikan link ke file yang tidak ada. Format URL tetap sama.
   - Semua pemanggil `saveLocalFile` (sekitar 10 tempat) diberi `await`.
   - **Aturan ID:** jangan ada `await` di antara `generateNext*Id()` dan `push`. Kerjakan `put` dulu, atau buat ID setelah `await`. Saat ini kedelapan lokasinya aman; pertahankan.
   - `/uploads`: setelah `authorizeUpload`, ambil objek dengan **key ternormalisasi yang sama dengan yang lolos cek akses**, bukan dari `req.path`. Kembalikan 404 jika objek tidak ada. Pertahankan penolakan segmen titik, header `nosniff`, CSP sandbox dan `no-store`.
   - Hapus `deleteLocalFileFromUrl` karena tidak punya pemanggil, juga `mkdir` uploads dan loop pembuatan folder lokal di `ensureAllPartnersFolders`.
   - Backup Drive (`DRIVE_BACKUP_INDEX`, sekitar L497–590): ambil daftar dari `storage.list('')`, pakai ETag sebagai stamp, baca dengan `storage.get`. Lokasi file index pindah ke `path.join(APP_DATA_DIR, 'drive-backup.json')`.
   - Reset aplikasi: **setelah commit**, jalankan `storage.delete` untuk setiap key di prefix. Error cukup dicatat ke log.
6. **`organizationReset.ts`**: unlink file diganti `storage.delete(keyFromLink(link))`, dengan guard `..` tetap ada. Langkah backup `VACUUM INTO`/`backupPath` dihapus.
7. **`runtimePaths.ts`**: hapus `UPLOADS_DIR`, lalu pastikan `grep -rn "UPLOADS_DIR\|uploadsDir" apps/backend/src` kosong.
8. Console (/sys): tambah kartu kecil "File storage (Tencent COS)" di sebelah panel kredensial Google, dengan pola yang sama.
9. Tes:
   - `objectStore.test.ts`: kontrak `memoryStore`, penolakan traversal di `keyFromLink`, dan penanganan prefix.
   - `secretBox.test.ts`: round trip, tamper ditolak, dan kunci salah ditolak.
   - Bagian reset organisasi di `normalizedCore.test.ts` memakai `memoryStore`.
   - E2E memeriksa upload lewat `GET /uploads/...` (200, atau 404 setelah reset), bukan dengan membaca disk.

### Fase D: ganti engine ke PostgreSQL ✅ SELESAI (D1 + D2; lihat §3)

**Checklist D2, berurutan** (dari hasil D1; melengkapi spesifikasi di bawah):
1. Hapus `better-sqlite3` dan `@types/better-sqlite3` (di backend **dan** root), `@better-auth/cli`, `apps/backend/auth.config.ts`, serta script `auth:generate`/`auth:migrate`.
2. `db.ts`: `sql` menjadi facade pg (rename `pgSql`). Hapus `build`, `plain`, `useSqlite`, `createSql`, import better-sqlite3 dan kode `SQLITE_CONSTRAINT_*`. `db.test.ts` diganti `db.pg.test.ts`.
3. `lib/auth.ts`:
   - Hapus `sqliteDb`, pragma, `useSqlite`, `initAuthDatabase` dan `initializeCoreDataSchema`.
   - `createAuth = () => betterAuth(authOptions(pool()))`.
   - `loadCoreDataFromSqlite` tidak lagi membaca `tenants`/`departments` dan tidak lagi punya cabang `normalizedCoreReady`.
4. `server.ts` `init()`:
   - `connect(resolveDatabaseConfig())`, sampai fase F mengambil alih, lalu `ensureSchema()`.
   - `googleCredentials.init` dan `loadInstallationSettings` tetap memuat baris ke memori, tetapi tanpa CREATE.
   - Hapus import `sqliteDb` mentah, migrasi 003–006, `migrationBlock`/`MIGRATION_REQUIRED`, `LEGACY_DATA_FILE` dan `AUTH_DB_PATH`.
5. Hapus DDL modul yang sekarang dimiliki `schema.ts`: `ensureTenantBoundarySchema` (termasuk `columnsOf` dan PRAGMA), `ensureDocumentSchema`, `ensureApprovalSchema`, `mailTemplateStore.init`, serta CREATE di `googleCredentials.init` dan `loadInstallationSettings`.
6. `normalizedCoreStore.ts`:
   - Hapus cabang SQLite dan flag `postgres`. Hapus `normalizedCoreReady`.
   - `IS NOT excluded.` menjadi `IS DISTINCT FROM excluded.`.
   - `searchBusinessRows` memakai ILIKE di `search_records`, dengan komentar `shortcut:`.
   - `coreDataStore.ts`: hapus `syncTable` legacy, dan ganti `IS NOT excluded` dengan cara yang sama.
7. `organizationReset.ts`: hapus probe `sqlite_master`.
8. Sapu terjemahan SQL sesuai langkah 5 di bawah. Jalankan e2e dengan `NODE_ENV` non-produksi agar assert `toPg` menangkap yang terlewat.
9. Lock sesuai langkah 6 di bawah, termasuk `lockDocument` saat submit approval.
10. Hapus `indexedConfiguration.ts`, `migrations/003`–`006`, dan watch-ignore `*.db` di `apps/frontend/vite.config.ts`.
11. Tes:
    - Semua unit test memakai `createTestDatabase()`.
    - E2E men-spawn server dengan `DATABASE_URL` = URL database tes.
    - `test:sqlite` + `test:pg` digabung menjadi `test`, dan `test:e2e:sqlite` menjadi `test:e2e:postgres`.
12. Gate akhir: `grep -rn "better-sqlite3\|sqliteDb\|\.prepare(\|sqlite_master\|PRAGMA" apps packages` harus kosong.

**Spesifikasi asli fase D:**

1. Tambahkan `pg` sebagai dependency langsung (saat ini hanya transitif) dan `@types/pg` sebagai devDependency. Hapus `better-sqlite3` dan `@types/better-sqlite3` dari `apps/backend/package.json` **dan** `package.json` root. Hapus `auth.config.ts`, script `auth:generate`/`auth:migrate` dan `@better-auth/cli`.
2. **Backend pg di `db.ts`**, dengan API yang sama seperti sekarang:
   - Pool holder: `connect(cfg)`, `pool()`, `end()`.
   - Terjemahan placeholder: `?` menjadi `$n`, `@name` menjadi `$n`. Lewati isi `'…'` dan `"…"`. **Jangan** anggap `\` sebagai escape di dalam kutip, karena `LIKE ? ESCAPE '\'` valid di pg. `@name` yang tidak ada nilainya harus **melempar error**.
   - Type parser per query untuk OID 1184 (`timestamptz`): kembalikan string ISO. Kode yang ada memakai `String(x).slice(0,10)` dan `parseTimestamp`. Untuk OID 20 (int8): Number bila aman, selain itu string. **Jangan** pasang parser global, agar pool better-auth tidak terpengaruh.
   - BigInt boleh dikirim langsung, karena `prepareValue` milik pg sudah memanggil `toString()`.
   - **Assert di luar produksi** (`NODE_ENV !== 'production'`), dijalankan setelah terjemahan placeholder: tolak identifier camelCase tanpa kutip di luar string, serta `\b(FROM|JOIN|INTO|UPDATE)\s+user\b`.
   - `resolveDatabaseConfig()`: env `DATABASE_URL`, lalu `database.json`, lalu `null`.
   - `testConnection(cfg)`: `pg.Client` dengan `connectionTimeoutMillis: 5000`, menjalankan `SELECT 1`.
   - `saveDatabaseConfig(cfg)`: tulis ke `.tmp` dengan mode `0o600`, `chmod`, lalu rename.
   - Toggle SSL dipetakan ke `ssl: { rejectUnauthorized: true }`.
   - **Guard mode tes:** di `APP_TEST_MODE`, tolak start jika nama database tidak diawali `legalio_test_`.
   - `testDatabase.ts` (khusus tes): `CREATE DATABASE legalio_test_<acak>` memakai `TEST_DATABASE_URL`, default `postgres://legalio:legalio@127.0.0.1:5432/legalio`, lalu drop saat teardown.
3. **`schema.ts` → `ensureSchema()`**, dipanggil dari `init()`:
   1. `import { getMigrations } from 'better-auth/db/migration'` (bukan `better-auth/db`). Ubah `createAuth` di `lib/auth.ts` agar `authOptions` dibangun sekali saja, lalu jalankan `getMigrations(authOptions).runMigrations()`. Fungsi ini sudah diuji di pg17: idempoten, dan membuat user, session, account, verification, organization, team, teamMember, member, invitation serta 10 index.
   2. Lalu fungsi `ensure*` milik modul, diterjemahkan ke pg, dengan urutan: tabel inti (`allowed_users`, `branding`, `app_settings`, `news_ticker`, `ai_ocr_cache`, `apikey` yang ditulis tangan), normalized core, tiga index status dari migrasi 005, `ensureDocumentSchema`, `ensureApprovalSchema`, `mail_templates`, `integration_credentials`, `installation_settings`. Isi `initAuthDatabase()`, `googleCredentials.init` dan `mailTemplates.init` dipindah ke sini.
   3. **Tetap buat** unique index `uq_member_org_user` dan `uq_team_member` (`organizationSettingsStore.ts`), tanpa syarat. better-auth tidak membuatnya, padahal `membershipOf` bergantung pada satu baris per pasangan (org, user).
4. **Fakta skema better-auth di pg** yang harus diperhatikan:
   - Semua tanggal bertipe `timestamptz`. `emailVerified` dan `banned` bertipe `boolean`.
   - `member.status` nullable dan **tanpa default di DB**, jadi setiap insert manual wajib menulis `'active'`.
   - **`account.issuer` tidak ada.** Hapus `issuer` dari setiap `INSERT INTO account`: di `authConsoleRoutes.ts` (sekitar L86, 206, 253) dan di `server.ts` (sekitar L2218 dan seterusnya).
   - NOT NULL tanpa default: `organization.slug`/`createdAt`, `team.memberCount`/`createdAt`, `member.createdAt`, `invitation.expiresAt`. Fixture di `invitationApproval.test.ts` dan e2e harus mengisinya.
   - FK memakai `ON DELETE CASCADE`. Menghapus user juga menghapus undangan yang pernah ia kirim.
5. **Aturan terjemahan SQL** (cari semuanya dengan grep):
   - Kolom dan alias camelCase **wajib** diberi kutip ganda (`"organizationId"`, `"createdAt"`, `AS "organizationName"`, …). Jika tidak, pg mengubahnya jadi huruf kecil tanpa error. Contohnya `teamsOf` di `recordScope.ts`, alias di `identity.ts`, `organizationAdminRoutes.ts` dan `mailTemplateStore.ts`.
   - `user` **wajib** ditulis `"user"`. `SELECT COUNT(*) FROM user` di pg diam-diam membaca `current_user` dan mengembalikan 1. Ini ada di `authConsoleRoutes.ts` (sekitar L63, 98–131, `LEFT JOIN user` sekitar L369 dan L404) dan di `server.ts` (overview, reset password, setup). Begitu juga `"teamMember"`.
   - Boolean better-auth: `banned = 0` atau `COALESCE(banned,0)=0` menjadi `banned IS NOT TRUE`; `banned = 1` menjadi `banned IS TRUE`; `emailVerified = 1` menjadi `"emailVerified"`. Literal `0/1` yang ditulis ke kolom boolean menjadi `false/true` (lihat `organizationProvisioning.ts`, authConsole set banned, server.ts, dan admin query di `recalculateStatuses`).
   - `INSERT OR IGNORE` menjadi `ON CONFLICT DO NOTHING`. `INSERT OR REPLACE` di `lib/cheapOcrPipeline.ts` menjadi `ON CONFLICT (cache_key) DO UPDATE SET …`.
   - `IS NOT excluded.x` menjadi `IS DISTINCT FROM excluded.x`. `x IS ?` menjadi `IS NOT DISTINCT FROM ?`.
   - `datetime('now')` sebagai default dihapus, karena nilainya selalu diisi oleh kode.
   - `ORDER BY x COLLATE NOCASE` menjadi `lower(x)`. Index `COLLATE NOCASE` menjadi `lower(...)`.
   - `LIKE` yang dilihat pengguna menjadi `ILIKE`, karena LIKE di SQLite tidak membedakan huruf besar-kecil. Query yang sudah memakai `LOWER` biarkan.
   - `approvalRoutes`: `ORDER BY e.created_at, e.rowid` diganti kolom `seq bigint GENERATED ALWAYS AS IDENTITY` di `approval_events`. `SUM(r.due_at <= @soon)` diganti `COUNT(*) FILTER (WHERE r.due_at <= @soon)`. `file_data BLOB` menjadi `bytea` dan kembali sebagai Buffer.
   - Tipe: `REAL` menjadi `double precision`; `_minor` menjadi `bigint`; `BLOB` menjadi `bytea`. Field boolean bisnis tetap `integer CHECK (… IN (0,1))`.
   - Hapus `json_valid` CHECK, kolom generated `risk_*`, view `v_partner_summary`/`v_contract_summary`/`news_items`, serta tabel dan trigger FTS5.
   - FK komposit `DEFERRABLE INITIALLY DEFERRED` tetap dipakai.
   - Pencarian memakai tabel `search_records` biasa, dengan query `WHERE organization_id=$1 AND (title||' '||body) ILIKE ALL($2)` (pola `%tok%`) dan urutan `entity_type, entity_id`, plus komentar `shortcut:`.
   - Error constraint: `SQLITE_CONSTRAINT*` menjadi `/^23/.test(err.code)`, lalu dipetakan ke 409. Slug `23505` juga menjadi 409.
6. **Lock untuk pola cek-lalu-tulis.** SQLite dulu berjalan serial; pg dengan READ COMMITTED tidak.
   - `/api/system/setup`: statement pertama di dalam tx adalah `SELECT pg_advisory_xact_lock(hashtext('legalio:setup'))`.
   - `patchOrganizationSettings`, `patchIntegration`, `mailTemplateStore.save`: baca baris yang ada dengan `FOR UPDATE`.
   - Pembuatan kode approval: `pg_advisory_xact_lock(hashtext('approval:'||org))`.
   - `assertSuperusersRemainWithout` dan `assertAdminsRemainWithout` (`organizationAdminRoutes.ts`): statement pertama `pg_advisory_xact_lock(hashtext('legalio:admin-invariants'))`. Semua pemanggilnya harus berada di dalam `sql.tx`.
   - `acceptInvitation` tetap memeriksa `changes === 1`.
   - **Submit approval** (`POST /approvals`) masih mengecek dokumen di luar tx. Panggil `lockDocument` lebih dulu di tx submit, lalu cek ulang bahwa dokumen ada dan belum punya approval pending. Tanpa ini, dua submit bisa lolos bersamaan, atau approval bisa menunjuk dokumen yang sudah dihapus.
   - `isUniqueViolation` di `db.ts` perlu ditambah `|| err.code === '23505'`. Pemetaan constraint ke 409 di `saveDb` menjadi `/^23/`.
   - Jika menambah FK di tabel approval, gunakan `ON DELETE CASCADE` atau `DEFERRABLE`. DELETE approval sekarang menghapus parent lebih dulu.
7. **Hapus:** probe `sqlite_master` untuk tabel opsional di `organizationReset.ts`, migrasi 003–006, `indexedConfiguration.ts`, `normalizedCoreReady`/`normalizedCoreApplied` (probe `sqlite_master`), import `sqliteDb` mentah di `server.ts`, `migrationBlock`/`MIGRATION_REQUIRED`, impor `data_store.json` (`LEGACY_DATA_FILE`), `AUTH_DB_PATH`, dan watch-ignore `*.db` di `apps/frontend/vite.config.ts`. better-auth diberi `database: pool()`.
8. Tes:
   - Ganti nama script root: `test:sqlite` menjadi `test`, `test:e2e:sqlite` menjadi `test:e2e:postgres`.
   - Unit test dan e2e berjalan di database `legalio_test_*`.
   - Di `normalizedCore.test.ts`, hapus tes migrasi 003–006, query plan dan view. Pertahankan tes multiple IO, ID stabil, search scoping, rollback lintas org, fingerprint/skip dan presisi desimal.
9. Gate tambahan: `grep -rn "better-sqlite3\|sqliteDb\|\.prepare(\|sqlite_master\|PRAGMA" apps packages` harus kosong.

> **Risiko utama fase D:** case folding identifier (kolom camelCase tanpa kutip) gagal tanpa pesan error. Andalkan assert di `db.ts` dan e2e penuh.

### Fase E: batching baca (performa) ✅ SELESAI (lihat §3)
`readBusinessRows` dan `childArrays` (`normalizedCoreStore.ts`) menjalankan 1 + 3 + (jumlah requirement DD) query **per partner**. Lewat jaringan, ini berarti ratusan sampai ribuan round trip per `GET /api/partners`. Ganti dengan satu query per tabel anak, `WHERE parent = ANY($1) ORDER BY parent, position`, lalu kelompokkan di JS. `partner_dd_files` memakai key `(partner_id, requirement_position)`. Gate sama dengan fase D.

### Fase F: onboarding (rencana setting di halaman onboard) ✅ SELESAI (lihat §3)

Penyimpangan dari rencana di bawah:
- `POST /api/system/database` dipasang **sebelum** hand-off ke `realApp`, supaya tetap menjawab 409 setelah app berjalan.
- Saat boot, `testConnection` dijalankan sebelum `connect`.
- Cache COS dipulihkan dengan reload setelah rollback.

**Catatan untuk fase G:**
- Dalam mode tanpa DB, `/api/health` mengembalikan 503. Healthcheck Docker akan "unhealthy" sampai langkah DB selesai. Compose mengisi `DATABASE_URL`, jadi jalur normal tidak terdampak.
- Password DB kosong menghasilkan pesan pg mentah ("SASL: … client password must be a string").
- Catatan route policy untuk `public-status` di `routePolicies.ts` masih berbunyi "app name + needsSetup only".

**Alur yang dituju:**

```
Kunjungan pertama
  ├─ belum ada DATABASE_URL & belum ada database.json
  │     → Langkah 1: "Hubungkan PostgreSQL" (host, port 5432, user, password, database, SSL)
  │       Tes koneksi → buat skema → simpan database.json (0600) → aplikasi langsung aktif, tanpa restart
  └─ DB tersambung, belum ada superuser
        → Langkah 2: setup seperti sekarang (URL publik + akun superuser)
          + fieldset baru "Penyimpanan file (Tencent COS)": SecretId, SecretKey, Bucket, Region, Prefix (opsional)
          COS diuji (put/get/delete) sebelum disimpan → kredensial disimpan terenkripsi
  → Login
```

**Backend: entry baru `apps/backend/src/main.ts`**
- Baris pertama: `import "dotenv/config"`.
- Di produksi, periksa `BETTER_AUTH_SECRET` saat boot.
- Buat app `express()` dengan urutan berikut:
  1. Pertama, `app.use((q, s, n) => realApp ? realApp(q, s, n) : n())`.
  2. `GET /api/system/public-status` mengembalikan `{ needsDatabase: true }` selama DB belum ada.
  3. `POST /api/system/database`. Pasang `express.json()` **hanya di route ini**. JSON parser global akan memakan body dengan batas 100 kB dan merusak upload JSON 25 MB.
     - Tolak dengan 409 jika config sudah ada, `realApp` sudah terisi, atau masih ada request lain yang sedang berjalan.
     - Validasi host, port 1–65535, user, nama database dan boolean SSL.
     - Urutan: `testConnection` → `connect` → `const m = await import('./server')` → `await m.init()` (menjalankan `ensureSchema`) → baru `saveDatabaseConfig` → set `realApp = m.app`.
     - Jika gagal: `end()` pool, lalu kembalikan 400 dengan pesan pg. **Jangan pernah mengembalikan password.** `init()` harus bisa dijalankan ulang setelah gagal.
  4. Semua `/api/*` lainnya mengembalikan `503 DATABASE_REQUIRED`.
  5. `mountSystemConsole`, middleware Vite, `listen(PORT)` dan handler shutdown dipindah dari `startServer` di `server.ts`.
- Jika config sudah ada saat boot: `connect` lalu import lazy dan `init()`. **Jika DB tidak bisa dihubungi, `process.exit(1)`** (Docker akan me-restart). **Jangan pernah kembali ke form DB**, karena siapa pun bisa mengarahkan instalasi ke DB lain selama DB sedang mati.
- `server.ts` menjadi `export { app, init }` dan tidak lagi memanggil `listen`. Esbuild tidak mendukung top-level await di cjs, karena itu `init()` dibuat async.
- Entry esbuild pindah ke `src/main.ts`, tetapi **outfile tetap `dist/server.cjs`**, jadi `start`, Dockerfile dan e2e tidak berubah. Script `dev`/`dev:combined` juga pindah ke `src/main.ts`.
- `public-status` di `server.ts` (sekitar L7345): hapus `migrationRequired` dan tambahkan `needsDatabase: false`. Tidak perlu `needsStorage`.
- `POST /api/system/setup` (sekitar L7355) menerima `storage: { secretId, secretKey, bucket, region, prefix }`. Field ini wajib, kecuali di `IS_TEST_MODE`.
  - Jalankan `parseCosConfig` lalu `probe(cosStore(cfg))` **sebelum** transaksi (tidak boleh ada I/O jaringan di dalam tx).
  - Baris terenkripsinya ditulis di dalam transaksi setup yang sama, setelah advisory lock. `write()` di store kredensial bersifat internal, jadi pakai `saveCos` dari dalam `sql.tx`. Fungsi itu hanya satu `db.run` ditambah set map, sehingga aman di dalam tx; pastikan cache map tidak berubah jika tx di-rollback.
  - Pakai ulang potongan yang sama dengan route `PUT /api/integrations/storage/cos`.
- `.gitignore`: tambahkan `database.json` dan `drive-backup.json`.

**Frontend: `packages/platform-console/src/components/SignInForm.tsx`**

Komponen ini dipakai oleh app (`apps/frontend/src/components/SignInForm.tsx`) dan oleh `/sys` (`apps/backend/console/src/SystemLogin.tsx`). Saat ini status diambil di sekitar L76 dan mengisi `setSetupMode`.
- Jika `status.needsDatabase`, tampilkan langkah "Hubungkan PostgreSQL" lebih dulu. Pakai komponen yang sudah ada: `Field`/`Input`/`Checkbox`/`PasswordInput`, dan `Alert` untuk error. Setelah berhasil, fetch ulang `public-status`.
- Di `setupMode`, tambahkan fieldset COS dan kirim bersama body setup.
- Tambahkan key i18n untuk en, id dan zh.
- `AuthContext` memanggil `/api/me`. Dalam mode tanpa DB, panggilan ini mendapat 503, nilainya menjadi `null`, lalu jatuh ke SignInForm. Perilaku ini sudah benar, tetapi **belum diverifikasi** di browser.

**Tes: `apps/backend/src/onboarding.test.ts`**
- Shell tanpa config, memakai `APP_DATA_DIR` sementara: `public-status` mengembalikan `needsDatabase: true`.
- Password salah: 400, dan tidak ada file yang ditulis.
- Input valid: file ditulis dengan mode `0o600`, lalu `/api/health` dilayani oleh app asli.
- POST kedua: 409.
- `DATABASE_URL` menang atas file.
- Config ada tetapi DB tidak bisa dihubungi: proses keluar dengan kode 1.

### Fase G: deploy dan dokumentasi
- `compose.yaml`: tambah service `postgres` (`postgres:17`, `POSTGRES_USER`/`POSTGRES_DB` `legalio`, `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-legalio}`, volume `legalio-pg:/var/lib/postgresql/data`, healthcheck `pg_isready`, **tanpa publish port**).
  - Backend: `DATABASE_URL: postgres://legalio:${POSTGRES_PASSWORD:-legalio}@postgres:5432/legalio` dan `depends_on: postgres: condition: service_healthy`. Volume `/data` tetap dipakai untuk `database.json` dan index Drive.
- `apps/backend/Dockerfile`: hapus `AUTH_DB_PATH=/data/kaelyn.db` dan paket `tar`. Hapus `python3 make g++` **hanya jika** `npm ci` masih berhasil tanpanya.
- `.env.example`: tambahkan `DATABASE_URL` sebagai komentar.
- Hapus `SQLITE_STORAGE.md` dan buat `POSTGRES_STORAGE.md` yang singkat. Isinya:
  - urutan prioritas koneksi
  - skema dibuat saat boot
  - pencarian ILIKE
  - layout key di COS
  - enkripsi kredensial dan dampak mengganti `BETTER_AUTH_SECRET`
  - catatan bahwa aplikasi hanya boleh berjalan satu instance
  - `pg_dump` untuk backup
  - **jangan hapus `/data/kaelyn.db`**
  - Layout key COS: `<prefix><Org>/<Partner>/<Folder …>/<file>`. Objek probe `<prefix>.legalio-probe-<uuid>` langsung dihapus.
  - Reset aplikasi menghapus seluruh isi prefix, satu request per objek. Ada komentar `shortcut:` yang merujuk ke `deleteMultipleObject`.
  - Jika `BETTER_AUTH_SECRET` diganti, kredensial Google/COS tidak bisa dibaca (tercatat di log saat boot). Isi ulang di /sys.
  - File lama `uploads.drive-backup.json` sudah tidak dipakai.
- `README.md`: badge SQLite, kalimat "database browser, backup and restore" dan "SQLite database file", teks onboarding (sekitar L50–56 dan L93–96), dan kebutuhan Postgres serta COS di bagian Installation.
- Gate akhir: `docker compose up --build` dengan volume bersih sampai ke langkah superuser + COS. Langkah DB terlewati karena `DATABASE_URL` sudah diisi.

---

## 5. Checklist yang tidak boleh rusak

- **Middleware otorisasi** (`routePolicies.ts`):
  - Urutannya: policy → identity → CSRF (mutasi via cookie) → permission platform atau konteks org → `can()`.
  - Setiap penolakan harus `return` atau memanggil `next(err)`.
  - Konflik header `orgParam` menghasilkan 400.
- **Identity:**
  - Cek `expiresAt` bekerja pada string ISO.
  - `isIdentityBanned` bekerja dengan boolean pg.
  - `PENDING_APPROVAL` menghasilkan 403.
- **Membership:** `status === 'active'` dan `isTenantRole` gagal tertutup (fail closed).
- **Scope departemen:**
  - `/api/search`, `scopedRecords`, `assertRecordAccess` dan `assertRecordWritable` berperilaku sama seperti sebelumnya.
  - Undangan menolak team dari org lain.
- **`/uploads`:**
  - Identity wajib, dan pemilik ditentukan dari record yang tersimpan.
  - `document.view` dan `recordVisible` diperiksa di org milik record.
  - File tanpa pemilik menghasilkan 404.
  - Segmen titik, `..` dan `\0` ditolak.
  - Header `nosniff`, CSP sandbox dan `no-store` tetap ada.
  - Objek yang tidak ada menghasilkan 404.
- **Transaksi:**
  - Setiap transaksi lama menjadi satu `sql.tx` dengan statement yang sama, dan audit di dalam tx yang sama.
  - Lock seperti di fase D, langkah 6.
  - Tidak ada `saveDb` atau I/O jaringan (COS, Drive, Gemini, `hashPassword`) di dalam `sql.tx`.
- **Penyimpanan:**
  - Satu writer, lock di luar tx, dan snapshot sebelum `await` pertama.
  - Cache fingerprint di-reset saat rollback dan saat reset aplikasi.
  - Jika gagal: `Object.assign(db, await loadCoreData())`.
- **Onboarding:**
  - Form DB hanya bisa diakses selama belum ada config.
  - Tidak kembali ke form DB jika DB mati.
  - Password tidak pernah dikembalikan dalam respons.
  - `database.json` bermode `0600` dan masuk `.gitignore`.
  - `secretKey` tidak pernah keluar dari API.
- **Tes** tidak pernah menyentuh database yang namanya tidak diawali `legalio_test_`.

---

## 6. Risiko yang diketahui

1. **Fase B tidak boleh dideploy sendirian.** better-auth masih memakai handle `better-sqlite3` mentah di luar antrean facade, sehingga bisa menulis di tengah transaksi facade yang sedang terbuka. Masalah ini hilang di fase D, saat better-auth memakai pool pg.
2. **Fase A menghapus rename `auth.db` → `kaelyn.db` saat startup.** Instalasi lama yang masih memakai `auth.db` akan start dengan DB kosong. Ini tidak relevan di hasil akhir, tetapi alasan lain untuk tidak merge sebagian.
3. **Hanya satu instance.** Koleksi in-memory `db` dan cache kredensial berlaku per proses. Jangan jalankan dua backend ke DB yang sama.
4. **Endpoint `POST /api/system/database` tidak memerlukan login.** Siapa pun yang pertama mengakses instalasi baru bisa mengisinya. Model kepercayaannya sama dengan setup superuser saat ini. Penguatan opsional (tidak direncanakan): env `SETUP_TOKEN`.
5. **Save pertama setelah boot menulis ulang semua baris**, karena cache fingerprint masih kosong. Ini aman untuk skala demo.
6. **Pencarian ILIKE** tidak menyamakan aksen (diakritik) dan tidak memakai index. Ini cukup untuk nama vendor.

---

## 7. Cek promise (wajib di fase C, D dan F)

Siapkan di luar repo (jangan di-commit):

```bash
mkdir -p ~/promise-lint && cd ~/promise-lint
npm init -y >/dev/null && npm i eslint@9 typescript-eslint@8 typescript@5.8
cat > eslint.config.mjs <<'EOF'
import tseslint from 'typescript-eslint';
export default [{
  files: ['**/*.ts', '**/*.tsx'],
  languageOptions: { parser: tseslint.parser, parserOptions: { project: true, tsconfigRootDir: '/workspaces/Legalio-Lite-CLM/apps/backend' } },
  plugins: { '@typescript-eslint': tseslint.plugin },
  rules: {
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': ['error', { checksConditionals: true, checksVoidReturn: false, checksSpreads: true }],
  },
}];
EOF
cd /workspaces/Legalio-Lite-CLM/apps/backend && ~/promise-lint/node_modules/.bin/eslint --config ~/promise-lint/eslint.config.mjs --no-config-lookup src
grep -rn "forEach(async" src   # harus kosong
```

Baseline setelah fase B: temuan hanya ada pada pemanggilan `test(...)` level atas di file tes, ditambah 2 di `server.ts` (`triggerAutoPushToGoogleSheet(req)` dan `startServer()`). **Tidak boleh ada temuan baru.**

Sebelum dipakai, uji dulu config di atas pada file probe: `if (p)`, `!p`, `p && x` dan `.filter(async …)`. Jika `!p` lolos, cari manual pemanggil fungsi yang sekarang mengembalikan `Promise<boolean>`: `hasApprovalInvitation`, `invitationIsUsable`, `inviterStillAuthorized`, `canAccessOrganization`, `needsFirstRunSetup`, `isEmptyInstall`.

---

## 8. Review fase B: selesai

Sudah dicek dan aman:
- Middleware otorisasi: urutan dan semua jalur penolakannya. `req.teams` yang kosong gagal tertutup.
- Semua `identityOf(req)` berada di belakang policy non-publik.
- `/uploads`, pencarian, undangan dan visibilitas approval.
- Pemetaan transaksi, tanpa self-deadlock.
- Penanganan `COMMIT` yang gagal di `db.ts`.
- Pemindahan ke `init()`.
- Cek promise menangkap `!p`.

Kesepuluh temuan sudah diperbaiki (§3). Batasan yang tersisa:
- **Save gagal saat ada perubahan lain di memori.** Jika save A gagal sementara request B sudah mengubah memori, reload membuang perubahan B, padahal save B tetap melaporkan sukses. Data tetap konsisten, tetapi edit B hilang. Perbaikannya butuh pelacakan perubahan per request; di luar scope.
- **Baris `account` Google bisa dobel.** Login Google bersamaan masih bisa menyisipkan dua baris, karena tidak ada unique key (userId, providerId). Tidak berbahaya.
- **Belum ada tes race** untuk temuan 3, 6 dan 8; tes ini perlu interleave ala pg. Tambahkan di fase D jika murah.
