# Handover — RBAC Alignment + Obsidian UI Integration

Repo: `adhityacl/NEW-CLM` · Branch kerja: `feat/rbac-alignment` · Baseline: `0368290` (`main`)

## 1. Changelog (perubahan yang terlihat pengguna)

| Area | Sebelum | Sesudah |
|---|---|---|
| Hierarki role | 3 bucket kasar (`Admin/Editor/Viewer`); `manager`→editor, `superuser`→admin | 5 peran PRD dengan level 1–5 dan aturan `target_level > actor_level` |
| Permission | String deskriptif, tidak pernah dicek | 32 permission code `resource.action` yang benar-benar dievaluasi |
| Invitation | Siapa pun bisa mengundang `superuser`/`admin` | Dibatasi hierarki + scope tenant/departemen |
| Perubahan role | Bisa eskalasi ke `superuser` tanpa cek | Dibatasi hierarki; tidak bisa mengubah role sendiri |
| Scope departemen | Tidak berjalan | `checkScope` + `buildScopeFilter` siap dipakai di query |
| Nilai dari client | `tenantId`/`departmentId` dipercaya | `resolveTrustedScope` memaksa scope milik user (PRD §25) |
| Error otorisasi | Pesan ad-hoc | Kode standar PRD §29 (`401/403/404`) |
| Frontend gating | `isAdmin` boolean | `hasPermission()` / `can()` / `<Can permission>` |
| Design token | Tanpa token radius/shadow/spacing/mono/data | Token Takram + jembatan shadcn/Obsidian UI |

## 2. File baru di PR ini

| File | Fungsi |
|---|---|
| `server/rbac.ts` | Engine RBAC tunggal (peran, permission, scope, invite, role-change, audit, error) |
| `server/rbacRoutes.ts` | Router additif `/api/rbac/*` + middleware `requirePermission()` |
| `tests/rbac.test.ts` | 36 test otorisasi (PRD §30) — **36/36 lulus** |
| `tools/gen-rbac-matrix.ts` | Generator matriks dari kode (anti-drift) |
| `src/lib/permissions.ts` | Helper permission frontend + `<Can>` + route map |
| `src/styles/tokens.css` | Design token (Takram) + jembatan token shadcn |
| `components.json` | Konfigurasi shadcn + registry Obsidian UI (`rsc: false` untuk Vite) |
| `src/components/obsidian/table.tsx`, `separator.tsx` | Komponen Obsidian UI (vendored, MIT) |
| `scripts/rbac-qc.mjs` | Harness QC impersonasi (6 skenario × 5 level) |
| `tools/rbac-devserver.ts` | Server RBAC standalone (tanpa dependensi) untuk eksekusi QC runtime |

## 3. Cara menjalankan

```bash
# Codespaces (devcontainer sudah ada)
npm install
cp .env.example .env      # isi GEMINI_API_KEY, BETTER_AUTH_SECRET, BETTER_AUTH_URL, GOOGLE_*
npm run dev               # → http://localhost:3000  (Vite dimount sebagai middleware Express)
```
Port-forward: **3000** (dikonfigurasi di `.devcontainer/devcontainer.json`).

### Menjalankan test RBAC
```bash
npx tsx --test tests/rbac.test.ts        # 36 test, exit 0 bila lulus
```
### Menghasilkan ulang matriks
```bash
npx tsx tools/gen-rbac-matrix.ts qc-output
```
### Menjalankan QC impersonasi (setelah C1–C4 ditutup)
```bash
node scripts/rbac-qc.mjs --base http://localhost:3000 --super-token "<TOKEN>" \
  --accounts '{"admin":"<id>","manager":"<id>","editor":"<id>","viewer":"<id>"}'
```

## 4. ⚠️ Aktivasi (otomatis, idempoten, reversible)

Jangan edit `server.ts` manual — pakai patcher idempoten:

```bash
node tools/apply-rbac-integration.mjs server.ts --tier=additive   # DEFAULT: hanya mount /api/rbac/* — NOL perubahan perilaku
node tools/apply-rbac-integration.mjs server.ts --tier=secure     # + tutup whitelist C4 + guard endpoint admin-inti
node tools/apply-rbac-integration.mjs server.ts --tier=strict     # + WAJIB sesi terverifikasi (401 untuk anonim) + hapus fallback email superadmin
node tools/apply-rbac-integration.mjs server.ts --tier=strict2    # + persempit whitelist /api/auth (auth-console ikut dijaga)
node tools/apply-rbac-integration.mjs server.ts --tier=strict3    # + gerbangi sisa endpoint area admin (sessions/teams/invitations/api-keys/organizations/rbac-matrix + activity-logs)
```

Terapkan `additive` dulu, smoke test di staging, lalu `secure`, terakhir `strict`. Dijalankan ulang = tidak ada perubahan (aman).

Verifikasi lokal (dijalankan di sini; bukti `DELIVERY/qc/patch-verification.json`):

| Tier | Perubahan | Idempoten | Syntax (esbuild) |
|---|---|:--:|:--:|
| additive | +34 baris | ✅ | ✅ exit 0 |
| secure | +40 / −2 baris | ✅ | ✅ exit 0 |
| strict | +57 / −7 baris | ✅ | ✅ exit 0 |
| strict2 | +59 / -8 baris | ✅ | ✅ exit 0 |
| strict3 | +68 / -8 baris | ✅ | ✅ exit 0 |

Patch untuk review: `DELIVERY/qc/server.ts.additive.patch`, `server.ts.secure.patch`, `server.ts.strict.patch`.

> **`strict` = penutup kebocoran QA live.** Terbukti dari QA (12 endpoint bocor ke anonim); `strict` mewajibkan token sesi valid di tabel `session`, sehingga request anonim memperoleh **401 UNAUTHENTICATED** dan header `x-user-email` tidak lagi bisa dipakai memalsukan identitas. Frontend sudah mengirim `Authorization: Bearer <sessionToken>` dari `localStorage.auth_session_token`, jadi pengguna asli tidak terpengaruh.

Setelah aktif, verifikasi cepat:
```bash
curl http://localhost:3000/api/rbac/matrix   # harus HTTP 200 + katalog 32 permission
```

> Catatan: file `server.ts` (287 KB) melebihi batas transport konektor, sehingga perubahan dikirim sebagai **patcher + patch**, bukan sebagai file penuh. Base yang diverifikasi: 287.072 byte (identik dengan `main`).

## 5. Catatan migrasi role (legacy → standar)

Data lama masih memakai role legacy. Pemetaan yang diterapkan otomatis oleh `normalizeRole()`:

| Legacy | Standar |
|---|---|
| `owner`, `super admin`, `super_admin` | `superuser` |
| `admin` | `admin` |
| `legal` | `manager` |
| `finance` | `editor` |
| `staff`, `member` | `viewer` |
| nilai tak dikenal | `viewer` (deny by default) |

### 5.1 Migrasi skema RBAC (baru — dihasilkan dari engine)

`server/migrations/001_rbac_alignment.sql` (185 baris, **aditif & idempoten**) membuat tabel yang sebelumnya tidak ada: `rbac_roles`, `rbac_permissions`, `rbac_role_permissions`, `rbac_departments`, `rbac_user_roles`, dan `audit_log` (PRD §27). File ini di-generate dari `server/rbac.ts` lewat `tools/gen-rbac-migration.ts`, jadi tidak bisa menyimpang dari matriks izin.

Verifikasi eksekusi nyata (`node tools/verify-migration.mjs`, SQLite via `node:sqlite`):

| Pemeriksaan | Hasil |
|---|---|
| Dijalankan 2× (idempotensi) | ✅ jumlah baris identik |
| Pelanggaran foreign key | ✅ 0 |
| Tabel terbentuk | 6 |
| Role / permission / pemetaan | 5 / 32 / 77 baris |
| SUPERUSER mendapat semua permission | ✅ 32 |
| ADMIN | 22 (tanpa `audit.view`) |
| `audit_log` tulis+baca (`impersonated_by` terisi) | ✅ |

Bukti: `DELIVERY/qc/migration-verification.json`.

### 5.2 Migrasi data role legacy

Migrasi data (idempotent, **jalankan di staging dulu**):
```sql
UPDATE user SET role='superuser' WHERE lower(role) IN ('owner','super admin','super_admin');
UPDATE user SET role='manager'   WHERE lower(role)='legal';
UPDATE user SET role='editor'    WHERE lower(role)='finance';
UPDATE user SET role='viewer'    WHERE lower(role) IN ('staff','member');
```
Sebelum migrasi, pastikan setiap user non-superuser punya `tenantId` + `departmentId` valid (constraint PRD §6.1).

## 6. Rencana deploy & rollback

**Deploy (bertahap):**
1. Deploy kode (engine + route) **tanpa** memanggil `requirePermission` di route lama → tidak ada perubahan perilaku. Verifikasi `/api/rbac/matrix` 200.
2. Pasang `requirePermission()` pada route `auth-console` **satu per satu** (mulai dari `impersonate`, `role`, `invite`, `ban`), uji tiap langkah.
3. Tambah tabel `audit_log` + isi `impersonatedBy` pada sesi impersonasi.
4. Aktifkan filter departemen pada query dokumen.
5. Ganti gating UI `isAdmin` → `<Can>`; hapus whitelist `/api/tenants/switch` & `/api/audit-logs`.
6. Jalankan `scripts/rbac-qc.mjs`; semua lulus → siap rilis.

**Rollback (urutan terbalik):**
1. Lepas `requirePermission()` dari route (kembali ke perilaku lama) — tidak perlu deploy ulang DB.
2. `git revert` commit RBAC; engine bersifat aditif sehingga revert aman.
3. Migrasi role bersifat data — siapkan pemetaan balik (`superuser`→`owner`, `manager`→`legal`, `editor`→`finance`, `viewer`→`staff`) bila perlu.
4. Tabel `audit_log` tidak mengganggu bila dibiarkan (read-only saat rollback).

**Titik pemeriksaan:** `/api/rbac/matrix` 200 · 36 test lulus · QC impersonasi lulus · login admin & superuser normal · Editor tidak bisa membuka `/api/auth-console/users`.

## 7. Status kriteria penerimaan (jujur)

| Kriteria | Status |
|---|---|
| RBAC sesuai panduan | 🟡 Engine + matriks + test (44/44) + migrasi + patcher selesai; **terapan ke app menunggu eksekusi di Codespaces** |
| Matriks peran–permission | ✅ Tergenerasi dari kode (32×5) |
| QC impersonasi tiap level | 🟢 Runtime pada engine: **30/30 lulus** + jejak audit impersonasi terisi. App penuh: menunggu Codespaces |
| Akses terlarang benar-benar ditolak | 🟢 Terbukti runtime pada engine (6 probe negatif → 403 + kode standar §29). App penuh menunggu C1–C4 ditutup |
| Jejak audit impersonasi | 🟢 Terbukti runtime (4 event, `impersonatedBy` terisi) + tabel `audit_log` terverifikasi. Sisa: isi kolom di `authConsoleRoutes.ts:658` |
| Skema RBAC sesuai PRD §5–§12 | 🟢 Migrasi idempoten terverifikasi (6 tabel, 5 role, 32 permission, 77 pemetaan, 0 FK error) |
| Test otorisasi otomatis lulus | ✅ 44/44 |
| Integrasi Obsidian UI | 🟡 Config + token + 2 komponen vendored; sisanya via CLI/`npm i` |
| Kode RBAC terpasang di app | 🟡 Patcher idempoten siap & terverifikasi (patch lolos syntax check); eksekusi di Codespaces/staging |
| Token desain konsisten | 🟡 Token lengkap + kontras terverifikasi; migrasi komponen lama bertahap |
| Responsif & aksesibilitas | 🟡 Kontras WCAG 2.1 AA **terukur & lolos 28/28** (dari 23/28) + fokus keyboard & `prefers-reduced-motion` tersedia. Verifikasi piksel/responsif penuh butuh runtime |
| Anggaran performa | ⚪ Belum diukur (butuh `npm run build` + runtime) |
| Anggaran performa | ⚪ Belum diukur (butuh `npm run build` + runtime) |
| Rencana deploy & rollback | ✅ Dokumen §6 |
| Dokumentasi serah terima | ✅ Dokumen ini + 4 dokumen di `DELIVERY/` |

## 8. Risiko yang diketahui

1. **K1:** `server.ts` adalah monolit 287 KB — perubahan auth berisiko tinggi tanpa runtime; karena itu integrasi dibuat additif + bertahap.
2. **K2:** Identitas berbasis header email (C5) masih ada sampai hermetisasi sesi dikerjakan; jangan taruh data sensitif di balik header saja.
3. **K3:** Obsidian UI masih sangat baru — pantau rilis; API setara shadcn sehingga mudah dibalik.
4. **K4:** Konflik internal PRD §34.2 (`document.delete` untuk Editor). Diputuskan **diberikan**, dapat dimatikan lewat konstanta `EDITOR_CAN_DELETE_DOCUMENT` di `server/rbac.ts`.
