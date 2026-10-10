# Laporan Audit RBAC — PRD vs Implementasi

- **Repo:** `adhityacl/NEW-CLM` (app *legalio*)
- **Baseline commit:** `0368290` (branch `main`, setelah devcontainer) → perubahan di branch `feat/rbac-alignment`
- **Sumber kebenaran:** `Engineering PRD — RBAC Structure & Authorization.md` v1.0 (35 seksi)
- **Metode:** pembacaan kode langsung (`server.ts` 7.791 baris, `src/server/authConsoleRoutes.ts` 1.877 baris, `src/lib/rbacScoping.ts`, `src/lib/auth.ts`, context & komponen UI) + pengujian otorisasi otomatis (`tests/rbac.test.ts`).

## 1. Ringkasan eksekutif

Sistem RBAC saat ini **tidak sesuai PRD**. Bukan karena kurang detail, tetapi karena ada **tiga sumber kebenaran yang saling bertentangan**:

1. **Matriks deskriptif 5-peran** di `GET /api/auth-console/rbac-matrix` — hanya untuk ditampilkan, **tidak ditegakkan**.
2. **`src/lib/rbacScoping.ts`** (5 peran + helper departemen/approval) — **tidak diimpor** di backend (dead code).
3. **`rbacAuthMiddleware`** (`server.ts:84-217`) — satu-satunya yang benar-benar berjalan, tetapi hanya **3 bucket kasar** (`Admin`/`Editor`/`Viewer`).

Konsekuensi utama: hierarki 5-peran PRD tidak ada, permission code tidak pernah dicek, isolasi departemen tidak berjalan, dan beberapa endpoint sensitif justru **di-whitelist agar lolos tanpa otorisasi**.

**Verdict:** `rbac-guide-alignment` ❌ belum terpenuhi (butuh implementasi, bukan penyesuaian kecil).

## 2. Audit baris-per-baris terhadap PRD

Status: ✅ sesuai · ⚠️ sebagian · ❌ tidak ada/bertentangan

| PRD | Aturan | Status | Bukti di kode |
|---|---|:--:|---|
| §3/§3.1 | Hierarki 5 peran, `level` menentukan otoritas | ❌ | `server.ts:186-198` hanya memetakan ke `Admin/Editor/Viewer`; `manager`→`Editor`, `superuser`→`Admin` |
| §3.1 | `target_role.level > actor_role.level` | ❌ | Tidak ada di mana pun |
| §4 | Authorization = Role + Permission + Tenant + Department + Resource | ❌ | Hanya role kasar; departemen tidak ada |
| §5/§6 | Skema tabel users/roles/permissions/role_permissions/tenants/departments/invitations/audit | ⚠️ | Tabel better-auth ada (`user`, `session`, `member`, `invitation`); **tidak ada** `permissions`, `role_permissions`, `departments`, `audit_log` |
| §6.1 | Constraint scope per role (ADMIN tanpa dept, MANAGER wajib dept) | ❌ | Tidak divalidasi |
| §7 | Seed 5 role | ⚠️ | Role ada sebagai string di `src/lib/auth.ts` + legacy `legal/finance/staff`; tidak ada tabel `roles` |
| §8/§9 | Permission machine-readable `<resource>.<action>` | ❌ | Format yang ada `resource:['action']` (colon) dan hanya deskriptif |
| §10 | Katalog permission | ❌ | Tidak ada katalog; string tersebar |
| §11/§12 | Pemetaan role→permission | ❌ | `/rbac-matrix` deskriptif saja (`authConsoleRoutes.ts:1780-1918`) |
| §13 | Invitation hierarchy | ❌ | `authConsoleRoutes.ts:1511` — tanpa cek hierarki; `inviterId` hardcode `'admin'` |
| §14 | Invitation scope (tenant/department) | ❌ | Tidak divalidasi |
| §15 | Endpoint `POST /api/users/invite` + 11 langkah otorisasi | ❌ | Endpoint ada (`/api/auth-console/invitations`) tapi tanpa langkah 5–8 |
| §16 | Error standar invitation | ❌ | Error generik; tidak ada `INVALID_ROLE_ASSIGNMENT` dll. |
| §17 | Middleware `authorize({permission,resource,scope})` | ❌ | Tidak ada; hanya `requireTenantRole` dipakai 1 endpoint |
| §18 | Matriks API (14 endpoint × 5 peran) | ❌ | Hanya 1 guard nyata (`/api/tenant-data`) |
| §19 | `canEditDocument` (ownership + scope) | ❌ | `rbacScoping.ts` ada, tidak dipakai backend |
| §20 | Permission object ter-normalisasi ke frontend | ❌ | Frontend hanya dapat `role` mentah; tidak ada daftar permission |
| §21 | Permission→UI mapping | ⚠️ | Ada tab "Matriks Hak Akses" (`AdminRbacMatrixTab`) yang **menampilkan** matriks, tapi UI tidak memakainya untuk gating |
| §22 | `<Can permission="...">` | ❌ | Tidak ada; gating pakai `isAdmin` |
| §23 | Route protection | ❌ | Routing = state tab, tanpa guard |
| §24 | Setiap query tenant-scoped difilter | ⚠️ | Tenant difilter (`server.ts:4122`), tapi `?all=true` melewatinya |
| §24 | Department-scoped query | ❌ | Tidak ada filter departemen di query mana pun |
| §25 | Jangan percaya tenant/department dari client | ❌ | `x-user-email`/`?userEmail` dapat dipalsukan (`server.ts:110`) |
| §26 | Aturan perubahan role | ❌ | `authConsoleRoutes.ts:521` — tanpa hierarki; bisa eskalasi ke `superuser` |
| §27 | Audit log (18 aksi) | ⚠️/❌ | `addActivityLog` in-memory cap 500 (`server.ts:1890`); **tanpa tabel SQLite**; aksi console (role/ban/impersonate) **tidak** diaudit; `GET /api/activity-logs` tanpa auth |
| §28 | Backend otoritatif, tidak bisa self-elevate | ❌ | `/api/tenants/switch` & `/api/audit-logs` di-whitelist (`server.ts:100,105`) |
| §29 | Error standar otorisasi | ❌ | Pesan ad-hoc, sebagian membocorkan konteks |
| §30 | QA test matrix | ⚠️ | Belum ada; **kini tersedia** (36 test) untuk engine baru |
| §31/§32 | Authorization service terpusat, deny-by-default | ❌ | Logika tersebar di 3 lapisan |
| §33 | Final permission matrix | ❌ | Tidak ditegakkan |
| §34 | 8 keputusan produk terbuka | ❌ | Belum diputuskan (lihat §5 di bawah) |
| §35 | Definition of Done (19 item) | ❌ | Mayoritas belum terpenuhi |

## 3. Selisih kritis (severity-ranked)

| # | Severity | Temuan | Lokasi |
|---|---|---|---|
| C1 | 🔴 Kritis | `POST /users/:id/impersonate` membuat **session token asli 2 jam** tanpa cek peran pemanggil, **tanpa audit**; kolom `impersonatedBy` ada tapi tidak diisi | `authConsoleRoutes.ts:657-692` |
| C2 | 🔴 Kritis | `PUT /users/:id/role` tanpa hierarki — pemanggil mana pun bisa mengangkat akun ke `superuser` | `authConsoleRoutes.ts:521-625` |
| C3 | 🔴 Kritis | Invitation tanpa hierarki/scope; siapa pun bisa mengundang `superuser`; accept **tanpa autentikasi** | `authConsoleRoutes.ts:1511, 1623` |
| C4 | 🔴 Kritis | `/api/tenants/switch` + `/api/auth-console/organizations/*` di-whitelist → lolos tanpa otorisasi. **Koreksi:** `/api/audit-logs` & `/api/export-csv` juga di-whitelist tetapi **tidak punya route** → entri inert (bukan kebocoran) | `server.ts:100-101` |
| C5 | 🟠 Tinggi | Identitas dari header `x-user-email`/`?userEmail` yang dapat dipalsukan; admin di-hardcode ke `adhitcl@gmail.com` | `server.ts:110,188,2239` |
| C6 | 🟠 Tinggi | `authConsoleRouter` (40+ endpoint admin) tanpa guard per-route | `server.ts:7864` |
| C7 | 🟠 Tinggi | Isolasi departemen tidak berjalan di backend (`rbacScoping.ts` **tidak diimpor oleh `server.ts`**, 0 match). **Koreksi:** modul tetap dipakai frontend (`AuthContext.tsx:6`), jadi label "dead code" tidak akurat | `server.ts` (0 match) |
| C8 | 🟠 Tinggi | `?all=true` pada `GET /api/contracts` melewati filter tenant | `server.ts:4122-4134` |
| C9 | 🟡 Sedang | Audit log in-memory cap 500, tanpa tabel; aksi admin tidak tercatat | `server.ts:1890-1915` |
| C10 | 🟡 Sedang | Role legacy (`legal/finance/staff`, `Admin/Editor/Viewer`) jadi default user & invitation | `authConsoleRoutes.ts:311,1513` |
| C11 | 🟡 Sedang | UI gating berbasis `isAdmin`; `partner-spending` & `settings-google` tanpa proteksi | `Sidebar.tsx:213-236` |
| C12 | 🟡 Sedang | Flag kumulatif berarah **ke atas**: `isManager`/`isEditor` juga bernilai true untuk peran di atasnya (Admin/Superuser lolos gate Manager; Manager lolos gate Editor) — bukan "Editor mewarisi Manager" | `AuthContext.tsx:218-225` |

## 4. Yang sudah dikerjakan oleh PR ini (`feat/rbac-alignment`)

- `server/rbac.ts` — engine tunggal sesuai PRD: 5 peran + level, katalog 32 permission (`resource.action`), matriks role→permission + denylist, `hasPermission`, `canInvite`, `canChangeRole`, `checkScope`, `buildScopeFilter`, `resolveTrustedScope`, `decide`, audit builder, error standar §29, `buildMatrix`.
- `tests/rbac.test.ts` — **36 test otorisasi** (positif + negatif) memetakan langsung ke PRD §30. **Status: 36/36 lulus.**
- `server/rbacRoutes.ts` — router additif: `/api/rbac/matrix`, `/roles`, `/me`, `/check`, `/simulate/invite`, `/simulate/role-change` + middleware `requirePermission()`.
- `tools/gen-rbac-matrix.ts` — generator matriks dari kode (anti-drift).
- `src/lib/permissions.ts` — helper frontend (`hasPermission`, `can`, `usePermissions`, `<Can>`, `ROUTE_PERMISSIONS`).
- `tools/rbac-devserver.ts` + `scripts/rbac-qc.mjs` — eksekusi QC runtime nyata: **30/30 lulus** + bukti penegakan scope §25.

## 5. Keputusan produk terbuka (PRD §34) — perlu diputuskan pemilik produk

| # | Keputusan | Dampak pada implementasi |
|---|---|---|
| 1 | Viewer: sembunyikan nav, atau tampilkan read-only? | PRD merekomendasikan **read-only** → `viewer` tetap punya `document.view` (sudah diterapkan) |
| 2 | `document.delete` untuk EDITOR? | **Konflik internal PRD**: §18/§21 = TBD, §12/§33 = diberikan. Kami memilih **diberikan**, dapat dimatikan lewat `EDITOR_CAN_DELETE_DOCUMENT` |
| 3 | Manager boleh hapus dokumen permanen? | Saat ini `manager` punya `document.delete` (sesuai §33) |
| 4 | Admin akses semua departemen dalam tenant? | Ya (diterapkan; §19) |
| 5 | Superuser pakai tenant aktif atau global view? | Diterapkan: global (`scope: Global`) |
| 6 | Admin boleh undang Admin? | Tidak (diterapkan) |
| 7 | Manager boleh edit profil Editor/Viewer atau hanya invite? | Untuk sementara: `user.edit` diberikan (sesuai §33) |
| 8 | Custom role? | Tidak (fixed system roles, sesuai §34.8) |

## 6. Rekomendasi urutan perbaikan

1. **Pasang engine baru** (`server/rbac.ts`) + mount `server/rbacRoutes.ts` (1 baris di `server.ts`).
2. **Tutup C1–C4**: pasang `requirePermission()` pada route `auth-console` (impersonate, role, invite, ban); hapus whitelist `/api/tenants/switch` & `/api/auth-console/organizations/*` (entri `/api/audit-logs` & `/api/export-csv` inert, tetap sebaiknya dibersihkan). `requirePermission()` **wajib** melewati `resolveTrustedScope()` agar tidak mempercayai tenant/department dari client (PRD §25) — sudah diperbaiki di `server/rbacRoutes.ts`.
3. **Ganti identitas header** dengan sesi better-auth sebagai satu-satunya sumber; hapus hardcode email admin.
4. **Audit log**: buat tabel `audit_log` di SQLite; catat 18 aksi PRD §27 termasuk impersonasi (isi `impersonatedBy`).
5. **Isolasi departemen**: impor `buildScopeFilter`/`checkScope` ke query dokumen.
6. **Frontend**: pasang `PermissionContext` dari `GET /api/rbac/me`, ganti semua `isAdmin` dengan `<Can>`.
7. Jalankan `scripts/rbac-qc.mjs` di staging untuk QC per level.

## 7. Koreksi pasca review adversarial independen

Sebuah reviewer independen (mode adversarial) menguji ulang temuan di atas dan engine `server/rbac.ts`. Verdict: temuan inti **valid**, dengan beberapa koreksi dan **3 bug nyata pada engine yang sudah diperbaiki**.

### 7.1 Koreksi klaim laporan

| Klaim awal | Koreksi |
|---|---|
| C4 menyebut `/api/audit-logs` sebagai kebocoran kritis | Route-nya tidak ada → entri whitelist **inert**. Yang nyata berbahaya: `tenants/switch` & `organizations/*` |
| C7 menyebut `rbacScoping.ts` "dead code" | Dijmpor frontend (`AuthContext.tsx:6`) → istilah tepat: "tidak dipakai lapisan backend" |
| C12 contoh arah warisan terbalik | Flag kumulatif berarah **ke atas** (peran tinggi lolos gate peran bawah) |
| C2/C3 "pemanggil mana pun" | Berlebihan: middleware global tetap memblokir bucket Viewer; pelaku = Admin/Editor atau identitas palsu (C5) |
| C9 "`/api/activity-logs` tanpa auth" | Frasa tepat: di belakang middleware, tetapi default peran = Viewer & GET diizinkan |
| Nomor baris C5 | Bergeser 2–7 baris vs commit yang dibaca |

### 7.2 Bug engine yang diperbaiki (ditemukan reviewer)

| # | Bug | Perbaikan |
|---|---|---|
| 1 | **Pelebaran scope oleh pemanggil** — `checkScope(editor, res, 'tenant')` lolos; `decide` menerima `scope` dari pemanggil | Tambah `maxScopeFor()` + `clampScope()`; scope yang diminta dipersempit otomatis sesuai peran |
| 2 | **Fail-open** — resource tanpa `departmentId` lolos untuk peran ber-scope departemen | `checkScope` kini fail-closed; `canInvite`/`canChangeRole` mewajibkan tenant/department target |
| 3 | **`audit.view` tanpa dasar** diberikan ke ADMIN (tidak ada di PRD §10/§12/§33) | Dihapus dari ADMIN; dicatat sebagai keputusan |
| 4 | `requirePermission()` membaca tenant/department dari client (melanggar §25) | Diderivasi lewat `resolveTrustedScope()` |
| 5 | `buildScopeFilter` mengembalikan `{tenantId:null}` untuk non-superuser tanpa tenant (ambigu dengan "tanpa filter") | Kini **melempar** (fail-closed) |

Suite diperluas: **36 → 40 test**, semuanya lulus. QC runtime dijalankan ulang: **30/30 lulus**.

### 7.3 Sisa keputusan produk (dari review)

1. `audit.view` untuk ADMIN: hapus permanen, atau tambahkan resmi ke PRD?
2. `canInvite(superuser,'superuser')` ditolak, tetapi `canChangeRole(superuser,x,'superuser')` diizinkan (PRD §13 vs §26 bertentangan) → perlu satu aturan.
3. `hasPermission('superuser', <apa pun>)` = true (termasuk permission tak dikenal) — sesuai §12 "ALL", tetapi bertabrakan dengan deny-by-default §32.1.
4. `ScopedResource.ownerId` (§19 ownership) dan `RESOURCE_NOT_FOUND` (§29 anti-enumeration) belum dipakai di engine — perlu diimplementasikan saat query nyata sudah terpasang.

### 7.4 Batasan review

Reviewer tidak memiliki runtime app (tanpa kredensial); verdict berbasis pembacaan kode + eksekusi unit test, bukan uji endpoint produksi. Uji runtime endpoint **telah** dijalankan terpisah terhadap engine standalone (30/30) — lihat `RBAC-Impersonation-QC-Report.md`.
