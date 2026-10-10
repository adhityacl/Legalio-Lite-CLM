# Handover Teknis Legalio CLM

Dokumen ini adalah panduan awal untuk engineer yang melanjutkan pengembangan Legalio CLM. Isinya menjelaskan arsitektur yang sedang berjalan, aturan yang harus dijaga, hal yang perlu dihindari, serta prosedur build, test, dan deployment.

**Terakhir diperbarui:** 5 Oktober 2026

## 1. Mulai dari sini

Baca sumber berikut sebelum mengubah sistem:

1. [`README.md`](README.md) — setup lokal, environment, integrasi Google, test, backup, dan deployment.
2. [`apps/frontend/src/lib/appRoutes.ts`](apps/frontend/src/lib/appRoutes.ts) — daftar route SPA, alias lama, dan keputusan akses halaman.
3. [`apps/backend/src/routePolicies.ts`](apps/backend/src/routePolicies.ts) — daftar izin untuk setiap endpoint API. Endpoint yang tidak terdaftar ditolak.
4. [`apps/backend/src/rbac.ts`](apps/backend/src/rbac.ts) — katalog permission, role platform/tenant, dan aturan scope organisasi/departemen.
5. [`docs/button-sizes.md`](docs/button-sizes.md) — standar tinggi field dan tombol.
6. [`docs/AUDIT-GLOBAL-OSS-READINESS.md`](docs/AUDIT-GLOBAL-OSS-READINESS.md) — inventori risiko dan asumsi lokal.

Audit OSS dibuat pada 24 September 2026. Gunakan sebagai daftar pemeriksaan historis, lalu verifikasi setiap temuan terhadap kode terbaru sebelum menyatakan statusnya masih terbuka atau sudah selesai.

## 2. Gambaran arsitektur

### Stack utama

- Frontend: React 19, TypeScript, Vite 6, Tailwind CSS 4.
- UI: komponen lokal berbasis Radix UI, Lucide, Tiptap, Recharts, dan Motion.
- Data fetching: TanStack Query.
- Backend: Express 4 dan TypeScript.
- Autentikasi: Better Auth.
- Database: SQLite melalui `better-sqlite3`.
- Integrasi: Google Drive/Sheets/OAuth, Gemini, SMTP, dan layanan kurs.
- Test: `node:test`/`tsx` dan Playwright.

### Struktur penting

```text
apps/
  frontend/src/     Halaman React, context, fitur dan integrasi browser
  backend/src/      Entry point Express, router, layanan, RBAC dan migrasi
packages/
  ui-components/    Komponen UI mandiri
  types/            Kontrak domain dan API
  shared/           Policy, currency, lifecycle dan template bersama
  ts-config/        Konfigurasi TypeScript frontend/backend
.github/workflows/  CI yang memilih aplikasi berdasarkan perubahan
tests/              Unit, integration, tenant boundary dan browser test
scripts/            Setup environment dan utilitas workspace
tools/              Migrasi data dan verifikasi
docs/               PRD, audit dan keputusan UI/domain
```

`apps/backend/src/server.ts` masih besar. Fitur backend baru sebaiknya ditempatkan dalam router/service terpisah di `apps/backend/src/`, lalu dipasang dari entry point. Hindari menambah blok besar baru langsung ke `apps/backend/src/server.ts`.

## 3. Alur aplikasi frontend

Urutan provider di [`apps/frontend/src/App.tsx`](apps/frontend/src/App.tsx) penting:

```text
QueryClient
└── Auth
    └── Theme
        └── Language
            └── Confirm/Toast
                └── Tenant
                    └── Permission
                        └── Tenant Settings
                            └── Navigation
```

Urutan ini mencerminkan dependensi runtime: identity ditentukan lebih dulu, lalu organisasi aktif, capability, policy tenant, dan route halaman. Jangan memindahkan provider tanpa memeriksa seluruh consumer dan kondisi loading/error-nya.

### Routing SPA

Aplikasi tidak memakai React Router. Halaman aktif disimpan pada query parameter:

```text
/app?tab=login
/app?tab=dashboard
/app?tab=settings-access
/app?tab=admin-system-dashboard
```

Kontrak routing berada di [`apps/frontend/src/context/NavigationContext.tsx`](apps/frontend/src/context/NavigationContext.tsx) dan [`apps/frontend/src/lib/appRoutes.ts`](apps/frontend/src/lib/appRoutes.ts).

Aturan saat ini:

- Pengguna yang belum login selalu diarahkan ke `/app?tab=login`.
- Setelah login, semua user biasa masuk ke `/app?tab=dashboard`.
- Superuser masuk ke `/app?tab=admin-system-dashboard`.
- Deep link user yang sudah login dipertahankan bila route dan permission valid.
- Route tidak dikenal menampilkan akses ditolak; jangan membuat allowlist berbasis prefix.
- Alias lama memakai `replaceState` agar bookmark lama tetap bekerja tanpa menambah history palsu.

Jika menambah halaman:

1. Tambahkan ID route eksplisit ke katalog yang sesuai di `appRoutes.ts`.
2. Tentukan permission dan kebutuhan organization context.
3. Tambahkan render lazy di `App.tsx` bila halaman besar.
4. Tambahkan item navigasi hanya bila pengguna memiliki permission terkait.
5. Uji direct URL, reload, back/forward, akses ditolak, dan tampilan mobile.

### Navigasi System Admin

Sidebar System Admin terdiri dari:

- Dashboard, dengan tab Dashboard, Users, Sessions, Organizations, dan API Keys.
- Google & storage.
- AI Model & Parser.
- SMTP relay.
- UI texts.
- Database & reset.

Halaman konfigurasi memakai route tersendiri. URL lama `admin-system-settings` diarahkan ke `admin-system-google`. RBAC Matrix tidak lagi memiliki halaman UI, tetapi RBAC dan permission server tetap merupakan bagian inti keamanan aplikasi.

## 4. Autentikasi, tenancy, dan RBAC

Bagian ini tidak boleh dianggap sebagai detail UI.

### Identity dan organization context

- `/api/me` adalah sumber identity terverifikasi.
- Tenant role berasal dari capability organisasi aktif, bukan dari nilai role yang dikirim browser.
- Superuser mengelola organisasi melalui explicit platform context; proses ini tidak membuat membership baru.
- Admin/platform memiliki organization-wide scope.
- Manager/editor/viewer dapat dibatasi oleh department assignment.
- Pergantian organisasi harus membuang data dan capability organisasi sebelumnya.

### Aturan endpoint

Setiap operasi `/api` harus terdaftar di [`apps/backend/src/routePolicies.ts`](apps/backend/src/routePolicies.ts). Pilih policy yang paling sempit:

- `public`: benar-benar tidak memerlukan identity.
- `identity`: hanya data milik identity tersebut.
- `router`: router kanonik menyelesaikan context sendiri.
- `platform`: memerlukan platform permission spesifik.
- `tenant`: memerlukan organization context dan semua permission yang dicantumkan.
- `orgParam`: organization ID berasal dari path dan tetap diverifikasi server.

Checklist endpoint baru:

1. Daftarkan method dan path secara eksplisit.
2. Gunakan permission `resource.action` yang sudah dikenal atau tambahkan ke katalog RBAC.
3. Resolve organization context di server.
4. Filter record berdasarkan organization dan department scope.
5. Abaikan actor, role, atau organization scope yang diklaim body/header client bila server dapat menentukannya sendiri.
6. Tambahkan tes negatif lintas tenant dan lintas department.
7. Pastikan error tidak membocorkan keberadaan resource yang tidak boleh dilihat.

### Hal yang harus dihindari

- Jangan mengandalkan penyembunyian tombol sebagai mekanisme keamanan.
- Jangan membaca seluruh data lalu memfilter hanya di frontend.
- Jangan memakai fallback organisasi implisit untuk operasi tenant.
- Jangan menerima `userId`, role, atau permission dari request sebagai identitas actor.
- Jangan menambah endpoint ke daftar public hanya agar integrasi lebih mudah.
- Jangan memakai wildcard permission. Permission tidak dikenal harus tetap ditolak.
- Jangan membuat superuser menjadi anggota organisasi secara otomatis.

## 5. Data dan file runtime

Lokasi runtime dikendalikan oleh [`apps/backend/src/runtimePaths.ts`](apps/backend/src/runtimePaths.ts):

- `auth.db`, `auth.db-wal`, dan `auth.db-shm` untuk SQLite.
- `uploads/` untuk file lokal.
- `data_store.json` sebagai data legacy/kompatibilitas.
- `apps/backend/.env` untuk konfigurasi proses.

Semua file tersebut adalah data deployment dan tidak boleh di-commit. Jangan menjalankan test yang membuka database workspace secara langsung. Suite tenant-boundary memakai `APP_TEST_MODE=1` dan direktori sementara agar database, upload, dan data lokal tidak berubah.

Saat memindahkan atau memulihkan instalasi, ikuti prosedur backup di `README.md`. Jangan menyalin hanya `auth.db` dari proses yang masih aktif tanpa mempertimbangkan file WAL/SHM atau prosedur SQLite yang aman.

Kredensial Google yang diunggah disimpan melalui credential store dan memiliki prioritas atas environment fallback. Secret tidak boleh dikirim kembali ke browser atau ditulis ke log.

## 6. Build dan pengembangan lokal

### Persyaratan

- Node.js minimal `20.19.0`; Node 22 LTS direkomendasikan.
- npm.
- Toolchain native (`build-essential`, Python) mungkin diperlukan untuk `better-sqlite3`.

### Setup awal

```bash
npm install
npm run dev
```

`npm install` menjalankan `scripts/setup-env.mjs`. Script ini membuat `apps/backend/.env` dari `apps/backend/.env.example` dan mengisi `BETTER_AUTH_SECRET` lokal bila belum tersedia. Jangan menimpa secret deployment yang sudah aktif; menggantinya akan mengakhiri seluruh sesi login.

Mode pengembangan:

```bash
npm run dev           # Express + Vite dalam satu proses pada port backend
npm run dev:backend   # Express API saja
npm run dev:frontend  # Vite; proxy /api dan /uploads ke backend
```

Frontend selalu memakai URL relatif seperti `/api/...`. Pertahankan pola ini agar mode gabungan, mode dua proses, reverse proxy, dan deployment satu domain tetap bekerja.

### Build produksi

```bash
npm run build
```

Hasil penting:

- Frontend Vite berada di `apps/frontend/dist/`.
- Backend dibundle menjadi `apps/backend/dist/server.cjs` beserta sourcemap, di luar static root frontend.
- Saat upgrade instalasi lama, ubah `ExecStart` systemd dan static root nginx mengikuti README sebelum reload/restart layanan.
- Package eksternal backend tidak dibundle; deployment tetap memerlukan dependency production yang sesuai.

Menjalankan hasil build:

```bash
npm start
```

### Jebakan build yang harus dijaga

- Jangan menambahkan strategi `manualChunks` berbasis substring. Konfigurasi lama pernah memisahkan React dan `scheduler` ke chunk yang saling bergantung dan menghasilkan halaman kosong di production.
- Jangan menghapus `optimizeDeps.include` untuk modul tabel Tiptap. Editor membutuhkan registry `CellSelection` yang sama.
- Warning chunk lebih dari 800 kB bukan otomatis kegagalan build. Atasi dengan lazy route/component yang terukur, bukan pemisahan vendor sembarang.
- Vite mengabaikan file SQLite dan `data_store.json` untuk HMR. Jangan hapus ignore ini karena write runtime dapat memicu reload terus-menerus.
- `npm run lint` saat ini adalah TypeScript `tsc --noEmit`, bukan ESLint.
- Jangan berasumsi build frontend membuktikan keamanan backend; jalankan test tenant-boundary terpisah.

## 7. Test yang harus dijalankan

Pilih test sesuai area perubahan:

```bash
npm run lint                     # TypeScript seluruh proyek
npm test                         # seluruh tests/*.test.ts
npm run test:rbac                # katalog role dan permission
npm run test:documents           # API Document Editor
npm run test:credentials         # credential Google
npm run test:tenant-boundaries   # API, migration, store, dan RBAC terisolasi
npm run test:e2e:fixtures        # browser test dengan API mock
npm run test:e2e:tenant-boundaries # browser + server/database terisolasi
npm run build                    # frontend dan backend production build
```

Panduan minimum:

| Perubahan | Verifikasi minimum |
| --- | --- |
| Komponen atau styling UI | `npm run lint`, fixture Playwright terkait, `npm run build:frontend` |
| Route SPA/navigation | `npm run lint`, `spa-query-routing.spec.ts`, test peran terkait |
| Permission/RBAC | `npm run test:rbac`, `npm run test:tenant-boundaries` |
| Endpoint atau scope data | unit/integration terkait dan tenant-boundary negatif |
| Auth/session/onboarding | tenant-boundary live E2E |
| Database/migration | migration/store tests dan backup/restore rehearsal |
| Document Editor | `npm run test:documents` dan E2E editor yang relevan |
| Integrasi Google | `npm run test:credentials` dan test tanpa credential nyata |
| Perubahan lintas modul | seluruh lint, unit test, build, dan kedua suite E2E |

Playwright memiliki dua lingkungan berbeda:

- `playwright.fixtures.config.ts`: API dimock, aman untuk regresi UI cepat.
- `playwright.tenant-boundaries.config.ts`: server dan SQLite sementara, satu worker karena beberapa tes mengubah state bersama.

Jangan mengarahkan suite E2E ke database produksi atau `auth.db` workspace.

## 8. Standar UI dan UX

### Design system

- Gunakan token di `apps/frontend/src/index.css`; jangan menambah warna brand mentah bila token sudah tersedia.
- Gunakan komponen `src/components/ui/` sebelum membuat primitive baru.
- Ikuti [`docs/button-sizes.md`](docs/button-sizes.md).
- Field satu baris dan primary/form actions berukuran 44 px.
- Toolbar tanpa field dapat memakai tombol medium 36 px.
- Aksi tabel/kartu yang ringkas dapat memakai 28 px.
- Pada mobile, target sentuh minimum 44 px.
- Jangan memaksa ukuran `Button` dengan kombinasi `h-*`, `min-h-*`, `py-*`, dan radius acak. Gunakan `size="lg|md|sm"`.
- Gunakan Lucide atau ikon bersama yang sudah tersedia. Jangan menggambar SVG baru tanpa kebutuhan khusus.

### Pola tampilan

- Toolbar utama menggunakan kartu putih, border netral, radius konsisten, dan layout responsif.
- Kontrol pencarian memakai label aksesibel dan placeholder singkat; label visual tidak perlu bila konteks sudah jelas.
- Empty, loading, error, denied, dan retry state harus terlihat dan dapat dibaca screen reader.
- Modal harus mengunci fokus, dapat ditutup dengan Escape, dan mengembalikan fokus ke trigger.
- Tabel harus tetap dapat di-scroll horizontal pada mobile tanpa membuat document overflow.
- Uji minimal pada lebar 390 px dan desktop 1440 px.

### Bahasa

- Semua teks produk baru harus melalui `useLanguage().t()`.
- Gunakan key stabil dan fallback bahasa Inggris yang jelas.
- Jangan menyimpan label terjemahan sebagai status domain; simpan kode stabil lalu terjemahkan saat render.
- Katalog bahasa masih besar dan tersebar. Cari key yang sudah ada sebelum menambah key baru.

## 9. Integrasi eksternal

### Google

Ada dua jenis credential:

- Service Account untuk Drive/Sheets server-side.
- OAuth Client untuk login Google dan koneksi user.

Credential upload dalam aplikasi memiliki prioritas atas environment. Jangan commit file JSON Google, client secret, private key, access token, refresh token, folder ID produksi, atau spreadsheet ID produksi.

### Gemini dan SMTP

- API key Gemini dan konfigurasi SMTP dikelola dari System Admin.
- Secret harus bersifat write-only di UI/API.
- Jangan mengirim PII atau data tenant lain ke AI provider.
- Setiap prompt AI harus memakai record yang sudah lolos scope organisasi/departemen.
- Test SMTP dan AI harus memerlukan platform permission yang sesuai.

### Upload

- Validasi ukuran, tipe, nama, dan authorization di server.
- Jangan membangun path langsung dari input user tanpa sanitasi.
- Jangan menjadikan folder upload public tanpa kontrol akses yang setara dengan record pemiliknya.

## 10. Hal yang harus diperhatikan

- Perubahan organisasi aktif harus mengosongkan cache/data organisasi lama sebelum menampilkan data baru.
- Query key TanStack harus memasukkan organization ID bila hasilnya tenant-scoped.
- Form dengan perubahan belum tersimpan harus mempertahankan navigation guard.
- Mutation harus memperbarui/invalidate query yang tepat dan menampilkan hasil yang jelas.
- Date/time harus mempertimbangkan timezone tenant; jangan bergantung pada timezone proses secara tidak sengaja.
- Nilai uang harus selalu membawa kode currency dan metadata konversi bila dikonversi.
- Route legacy masih ada untuk kompatibilitas. Jangan menghapusnya tanpa inventori bookmark, test, dan rencana migrasi.
- `apps/backend/src/server.ts`, model legacy, dan katalog bahasa masih memiliki technical debt. Refactor secara bertahap dengan tes karakterisasi.
- Selalu periksa `git diff` sebelum mengubah file besar. Repository sering memiliki pekerjaan paralel yang belum di-commit.

## 11. Hal yang harus dihindari

- Jangan melakukan `git reset --hard`, checkout massal, atau menghapus perubahan yang bukan milik tugas Anda.
- Jangan mengedit `dist/`, `.vite/`, database, WAL/SHM, upload, atau file hasil test sebagai source.
- Jangan menambah dependency untuk masalah yang dapat diselesaikan dengan komponen/utilitas yang sudah ada.
- Jangan mengubah schema SQLite langsung saat startup tanpa migration idempotent dan test rollback/forward.
- Jangan mencampur platform permission dengan tenant permission.
- Jangan memakai nama organisasi, email, currency, locale, atau yurisdiksi tertentu sebagai fallback core baru.
- Jangan menyimpan uang sebagai hasil konversi tanpa rate, sumber, dan waktu kurs.
- Jangan menulis secret, token, payload dokumen, atau PII ke console/log.
- Jangan menghapus test karena gagal setelah perubahan; tentukan apakah implementasi atau ekspektasi yang harus diperbaiki.
- Jangan menganggap audit lama, screenshot, atau dokumentasi sebagai bukti final. Cocokkan dengan kode dan test aktif.

## 12. Risiko dan technical debt

Area yang perlu perhatian khusus:

1. `apps/backend/src/server.ts` masih memuat banyak route dan logika domain legacy.
2. Ada jalur kompatibilitas antara data core lama dan SQLite.
3. Bundle utama frontend masih besar; lakukan code splitting berdasarkan halaman/fitur.
4. Katalog terjemahan dan fallback belum sepenuhnya modular.
5. Beberapa model domain lama masih memakai istilah atau asumsi lokal.
6. Integrasi AI, Google, email, dan kurs membutuhkan error handling ketika provider tidak tersedia.
7. Kesiapan open-source harus diaudit ulang, termasuk secret scan, data produksi, lisensi dependency, konfigurasi default, dan riwayat Git.

Jangan membuka repository ke publik hanya berdasarkan build/test yang lulus. Lakukan security review dan verifikasi ulang audit OSS terlebih dahulu.

## 13. Checklist sebelum merge

- [ ] Scope tugas dan perilaku akhir sudah jelas.
- [ ] Tidak ada data lintas tenant/department yang dapat bocor.
- [ ] Endpoint baru sudah masuk route policy.
- [ ] UI permission sesuai dengan enforcement server.
- [ ] Loading, empty, error, denied, dan retry state ditangani.
- [ ] Mobile, keyboard, focus, dan dark mode diperiksa.
- [ ] Teks baru masuk i18n.
- [ ] Tidak ada secret, PII, atau data produksi di diff.
- [ ] `git diff --check` lulus.
- [ ] `npm run lint` lulus.
- [ ] Test relevan lulus.
- [ ] Build relevan lulus.
- [ ] Dokumentasi/alias/migration diperbarui bila kontrak berubah.

## 14. Checklist deployment

- [ ] Gunakan Node versi yang didukung.
- [ ] Jalankan install dependency dari lockfile.
- [ ] Pastikan `BETTER_AUTH_SECRET` stabil dan bukan placeholder.
- [ ] Pastikan origin, reverse proxy, HTTPS, dan forwarded headers benar.
- [ ] Jalankan migration sesuai panduan.
- [ ] Backup database dan upload sebelum upgrade.
- [ ] Jalankan `npm run build` dan smoke test hasil production.
- [ ] Verifikasi login email dan Google bila digunakan.
- [ ] Verifikasi akses superuser, tenant admin, manager, editor, dan viewer.
- [ ] Verifikasi pergantian organisasi dan isolasi datanya.
- [ ] Verifikasi Google, AI, SMTP, upload, dan scheduled task sesuai konfigurasi deployment.
- [ ] Pantau log startup, migration, auth failure, dan provider failure tanpa merekam secret.

## 15. Definition of done

Pekerjaan dianggap selesai bila perilaku yang diminta tersedia, permission server benar, data tetap terisolasi, UI konsisten dan aksesibel, test relevan lulus, build yang terdampak lulus, serta dokumentasi diperbarui bila kontrak route/API/schema berubah.
