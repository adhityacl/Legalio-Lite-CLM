# Review Adversarial — RBAC Structure & Authorization

- **Reviewer mode:** adversarial (berusaha membantah, bukan menyetujui)
- **Tanggal:** 2026-09-21
- **Sumber kebenaran:** `Engineering PRD — RBAC Structure & Authorization.md` v1.0
- **Bahan diuji:** `artifacts/server/rbac.ts`, `artifacts/tests/rbac.test.ts`, `DELIVERY/RBAC-Audit-Report.md`
- **Verifikasi kode asli:** `adhityacl/NEW-CLM` — `main@0368290`, branch `feat/rbac-alignment@52fbd00` (hasil `list_branches`, cocok dengan klaim audit)
- **Metode:** pembacaan langsung `server.ts` (7.791 baris), `src/server/authConsoleRoutes.ts`, `src/lib/rbacScoping.ts`, `src/context/AuthContext.tsx`, `src/components/Sidebar.tsx`; eksekusi `npx tsx@4 --test tests/rbac.test.ts` (36/36 lulus — dikonfirmasi); plus probe adversarial buatan sendiri terhadap `rbac.ts`.

---

## 0. Tabel Verdict

| # | Item | Verdict | Ringkas |
|---|---|:--:|---|
| A1 | C1 impersonate tanpa gerbang/audit, `impersonatedBy` kosong | **BENAR (dengan nuansa)** | Handler benar-benar tanpa cek hierarki & tanpa audit; `impersonatedBy` tidak diisi. Nuansa: middleware global tetap memblokir Viewer. |
| A2 | C2 role change tanpa hierarki | **SEBAGIAN** | Hierarki memang tidak ada (bisa eskalasi ke `superuser`). Tapi frasa "pemanggil mana pun" berlebihan: Viewer diblokir middleware global. |
| A3 | C3 invitation tanpa hierarki/scope; accept tanpa auth | **SEBAGIAN** | Create invitation tanpa hierarki/scope = benar. "Accept tanpa autentikasi" tidak sepenuhnya: POST anonim diblokir middleware (default Viewer). |
| A4 | C4 whitelist `/api/tenants/switch` & `/api/audit-logs` | **SEBAGIAN** | Whitelist memang ada, tetapi `/api/audit-logs` (dan `/api/export-csv`) **tidak punya route** → entri inert, bukan kebocoran. `/api/tenants/switch` & `/api/auth-console/organizations/*` nyata berbahaya. |
| A5 | C7 `rbacScoping.ts` tidak diimpor (dead code) | **SEBAGIAN** | Backend memang 0 impor (klaim inti benar), tetapi `AuthContext.tsx:6` mengimpornya → label "dead code" tidak akurat. |
| A6 | C12 flag kumulatif `isEditor`/`isManager` | **SEBAGIAN (arah contoh SALAH)** | Pola flag kumulatif benar ada & memang bertentangan dengan model permission. Tetapi contoh "Editor mewarisi Manager" **terbalik**. |
| **B** | Engine `server/rbac.ts` sesuai PRD? | **SEBAGIAN** | Matriks manager/editor/viewer persis §33 & hierarki benar. Menyimpang: 2 permission ekstra untuk ADMIN, dan **celah pelebaran scope** (argumen `scope` dikendalikan pemanggil) + fail-open saat scope resource kosong. |
| **C** | Suite test tautologis? | **SEBAGIAN** | Bukan tautologis murni (ekspektasi diambil dari PRD), tetapi lemah: sebagian tes = konsistensi internal, dan menguji modul yang **belum terpasang** di server → tidak membuktikan enforcement nyata. |
| **D** | Overclaim di dokumen DELIVERY | **SEBAGIAN** | Klaim terukur (36/36, 32 permission, commit/branch) benar. Ada ≤6 overclaim/penggeseran bukti (lihat §D). |

---

## A. Uji bantah atas temuan audit kritis

### A1 — C1 impersonasi · **BENAR (dengan nuansa)**
- `authConsoleRoutes.ts:658` `POST /users/:id/impersonate` → tidak ada pemeriksaan peran pemanggil di handler. **Benar.**
- `authConsoleRoutes.ts:670-676`: INSERT `session` dengan masa berlaku **2 jam** (`+ 2*60*60*1000`) dan token `imp_...` yang langsung dipakai middleware (`server.ts:130` `SELECT userId FROM session WHERE token = ?`). **Benar — token impersonasi adalah sesi asli.**
- Audit: tidak ada pemanggilan `addActivityLog`/tulis audit di handler. **Benar.**
- `impersonatedBy` benar-benar tidak diisi: `authConsoleRoutes.ts:823` (`GET /sessions`) men-*select* `s.impersonatedBy`, tetapi INSERT impersonasi (baris 672-674) **tidak menyertakan kolom itu** → selalu NULL. **Benar** (keberadaan kolom diinferensikan dari SELECT; tidak ada migrasi di `server.ts`).
- **Nuansa yang audit lewatkan:** bukan "tanpa gerbang" mutlak — `rbacAuthMiddleware` (`server.ts:87-217`) menolak `POST` untuk bucket Viewer. Artinya **Editor dapat mengimpersonasi Superuser** (bucket Editor lolos), dan siapa pun yang memalsukan `x-user-email` admin (lih. C5) juga bisa. Jadi eksposur nyata, tapi jalur masuknya lebih sempit dari yang tersirat.

### A2 — C2 perubahan role tanpa hierarki · **SEBAGIAN**
- `authConsoleRoutes.ts:521-624` `PUT /users/:id/role`: tidak ada cek hierarki (tidak memanggil `canChangeRole`), tidak ada validasi peran pemanggil, dan **menerima `role: "superuser"`** secara langsung (`normRole` ditulis apa adanya ke `user.role`). **Klaim hierarki = benar.**
- **Bantahan sebagian:** "pemanggil **mana pun** bisa mengangkat akun ke superuser" berlebihan. Endpoint adalah `PUT` (write) → bucket Viewer ditolak middleware `server.ts:205-213`. Pelakunya = Admin/Editor, atau identitas palsu (C5). Severity tetap kritis, tapi klaim cakupan perlu dikoreksi.

### A3 — C3 invitation · **SEBAGIAN**
- Create: `authConsoleRoutes.ts:1511-1532` — default `role = 'staff'`, `inviterId` literal `'admin'`, **tanpa** cek hierarki maupun tenant/department. Undangan ke `superuser` bisa dibuat. **Benar.**
- Accept: `authConsoleRoutes.ts:1624-1672` — handler **tidak membaca sesi/aktor sama sekali**; hanya butuh `code`. Pada level handler klaim "tanpa autentikasi" benar.
- **Bantahan sebagian:** rute ini **bukan** `/api/auth-console/organizations/*`, jadi middleware global berlaku. Pemanggil anonim → default bucket `Viewer` → `POST` ditolak 403 (`server.ts:205`). Jadi "siapa pun tanpa autentikasi bisa accept" tidak akurat; eksploitasi butuh (a) sesi non-Viewer, atau (b) spoof `x-user-email` (C5). Eksposur sebenarnya: accept **tidak mengikat** kode undangan ke identitas pemanggil (`inv.email` dipercaya sepenuhnya).

### A4 — C4 whitelist · **SEBAGIAN**
- `server.ts:100` `/api/tenants/switch` → di-whitelist; handler `server.ts:7442-7477` menulis `db.activeTenantId` global **tanpa** cek peran. **Benar & kritis.**
- `server.ts:101` `/api/auth-console/organizations/*` → di-whitelist. **Benar.**
- `server.ts:105` `/api/audit-logs` → di-whitelist **tetapi tidak ada route**-nya di `server.ts` (hanya 1 kemunculan, yaitu di whitelist) → jatuh ke catch-all 404 (`server.ts:7865`). **Overclaim: entri inert, bukan kebocoran.**
- **Temuan tambahan yang tidak dilaporkan:** `server.ts:99` `/api/export-csv` juga di-whitelist dan juga **tidak punya route** (inert). Sebaliknya audit melewatkan bahwa whitelist memuat entri mati lain. Justru yang benar-benar hidup & berisiko: `tenants/switch` dan `organizations/*`.

### A5 — C7 dead code `rbacScoping.ts` · **SEBAGIAN**
- Klaim inti (backend tidak mengimpor; isolasi departemen tidak ditegakkan di server) **benar**: `rg "rbacScoping" server.ts` → **0 match**.
- **Bantahan:** `src/context/AuthContext.tsx:6` `import { normalizeRole, StandardRole } from '../lib/rbacScoping';` (dipakai di baris 218-225). Jadi modul ini **tidak** dead code secara global. Frasa yang tepat: "tidak digunakan oleh lapisan backend".

### A6 — C12 flag kumulatif · **SEBAGIAN — contoh arah SALAH**
- `AuthContext.tsx:219-222` (persis rentang 218-225 yang dikutip audit): benar ada pola kumulatif.
- **Bantahan:** contoh audit "Editor mewarisi Manager" **terbalik**. Realitanya flag naik ke atas:
  - `isAdmin = admin || superuser`
  - `isManager = manager || isAdmin` → **Admin/Superuser ikut lolos gate Manager**
  - `isEditor = editor || isManager` → **Manager/Admin/Superuser ikut lolos gate Editor**
  - Editor hanya `isEditor=true` (tidak mewarisi Manager).
- Jadi risikonya bukan "Editor mewarisi Manager", melainkan **peran tinggi mewarisi gate peran bawah** (Manager lolos gate Editor, dst.) — tetap penyimpangan dari model permission PRD §20-§22, tetapi contoh di laporan menyesatkan.

---

## B. Apakah `server/rbac.ts` sesuai PRD?

**Verdict: SEBAGIAN.**

### Yang sudah sesuai (dibuktikan)
- `ROLE_LEVEL` identik §3.1; seed 5 peran identik §7 (nama/level/scope). **Sesuai.**
- Delta matriks terhadap §33 (dihitung programatis): **manager, editor, viewer = 0 perbedaan**; ADMIN **+2 ekstra**.
- `target_level > actor_level` ditegakkan di `canInvite` (`rbac.ts` cek `ROLE_LEVEL[tRole] <= ROLE_LEVEL[actorRole]`) → sesuai §13.
- Scope ADMIN vs MANAGER: `checkScope` → admin lolos tanpa cek departemen, manager/editor/viewer dikunci ke `departmentId` → sesuai §19.
- `canChangeRole` mengikuti pseudo §26 (termasuk guard self-change yang benar).

### Penyimpangan / celah (temuan baru)
1. **Permission ekstra untuk ADMIN (vs §33 literal).** `permissionsFor('admin')` menghasilkan `tenant.view` dan `audit.view` di luar daftar §12/§33. `tenant.view` masih bisa dibela lewat §18 ("Admin: *Limited*"), tetapi **`audit.view` sama sekali tidak ada di PRD** (§10/§12/§18/§33/§21) → pemberian tanpa dasar. Katalog juga menambah permission `audit.view` yang tidak ada di §10.
2. **Pelebaran scope oleh pemanggil (pelanggaran §4/§25).** `checkScope(actor, resource, scope)` dan `decide({..., scope})` menerima `scope` **dari pemanggil**, bukan menurunkannya dari peran. Probe:
   - `checkScope(editor, {tenantId:'t1', departmentId:'d2'}, 'tenant')` → **allowed:true** (isolasi departemen dilewati) — PRD §19/§24 mensyaratkan editor terikat departemen.
   - `decide({actor:viewer, permission:'document.view', resource:{tenantId:'t1',departmentId:'d2'}, scope:'tenant'})` → **allow:true**.
   - `buildScopeFilter(editor, 'tenant')` → `{tenantId:'t1', departmentId:null}` → query lintas-departemen.
   Test suite justru **mengunci** perilaku ini sebagai benar (`assert.deepEqual(buildScopeFilter(ED,'tenant'), {...departmentId:null})`).
3. **Fail-open saat scope resource kosong (§32.4 "Scope Is Mandatory" dilanggar).** `checkScope(editor, {}, 'department')` → **allowed:true**; `canInvite(manager,'editor')` **tanpa** `target` → **allowed:true**. Resource tanpa `tenantId`/`departmentId` tidak pernah ditolak → validasi scope menjadi opsional.
4. **`requirePermission()` di `rbacroutes.ts` melanggar §25.** Ia membangun `resource` dari `req.body`/`req.query`/`req.params` (tenant/department **dari client**) dan memanggil `decide()`, **tanpa** `resolveTrustedScope`. Ini persis pola yang audit sendiri cap sebagai pelanggaran §25. Ironisnya, audit merekomendasikan middleware inilah untuk menutup C1-C4 (laporan §6.2).
5. **Inkonsistensi internal PRD yang tidak dicatat:** `canInvite(superuser,'superuser')` → **ditolak** (INVALID_ROLE_ASSIGNMENT, ikut §13), tetapi `canChangeRole(superuser, x, 'superuser')` → **allowed** (ikut §26 early-return). Dua aturan PRD memang bertentangan; engine mereplikasi keduanya apa adanya → perlu keputusan produk.
6. Minor: `resolveTrustedScope` untuk admin mempercayai `clientSupplied.departmentId` **tanpa memverifikasi** bahwa departemen itu milik tenant aktor. `ScopedResource.ownerId` didefinisikan tetapi tidak pernah dipakai (§19 ownership). `RESOURCE_NOT_FOUND` (§29 anti-enumeration) didefinisikan tetapi tidak pernah dikembalikan.

---

## C. Apakah suite test tautologis?

**Verdict: SEBAGIAN (bukan tautologis murni, tapi berkelemahan).**

- **Bukan tautologis murni:** banyak assertion menuliskan nilai ekspektasi dari PRD (§30 QA matrix) secara eksplisit, bukan menurunkan dari fungsi yang diuji. Ex: `assert.deepEqual(ROLE_LEVEL, {superuser:1,...})`, `err(canInvite(AD,'admin',...)) === 'INVALID_ROLE_ASSIGNMENT'`.
- **Tes yang lemah / hanya konsistensi internal (tidak menguji PRD):**
  - `matriks: setiap permission role valid & terdaftar di katalog` — hanya cek `matrix ⊆ katalog` (implementasi vs dirinya sendiri).
  - `matriks: 5 role, katalog permission lengkap` — hanya `roles.length===5` & `permissions.length>=30`.
  - `setiap role punya minimal document.view` — `ALL.map(hasPermission)` (sirkular, dibandingkan dengan `[true×5]`).
- **Kelemahan struktural terbesar:** seluruh suite menguji modul `server/rbac.ts` yang **belum terpasang** ke `server.ts` (audit sendiri menyebut "router additive", dan `rg rbac.ts server.ts` menunjukkan engine tidak dipakai). Jadi 36/36 hijau **tidak membuktikan** satu pun endpoint produksi menegakkan PRD → berpotensi *false confidence*.
- **Celah yang lolos dari suite (ditemukan lewat probe saya, semua lolos test):**
  - pelebaran scope via `scope='tenant'` (B#2);
  - fail-open saat resource/target scope kosong (B#3);
  - `canInvite(superuser,'superuser')` tidak diuji;
  - toggle `EDITOR_CAN_DELETE_DOCUMENT` (§34.2) tidak diuji;
  - tidak ada tes untuk `requirePermission()` (yang justru melanggar §25);
  - tidak ada tes §19 ownership/`ownerId`, tidak ada tes anti-enumeration 404.
- Header test mengklaim "GAGAL bila matriks berubah tanpa sengaja" — **tidak sepenuhnya benar** (perubahan hanya pada flag `document.delete` editor tidak akan tertangkap).

---

## D. Overclaim di dokumen DELIVERY

**Verdict: SEBAGIAN.**

Dikonfirmasi benar:
- "36 test, 36/36 lulus" — **benar** (dijalankan ulang).
- "katalog 32 permission" — **benar** (dihitung: 7+6+4+4+2+2+6+1 = 32).
- Repo/commit/branch (`adhityacl/NEW-CLM`, `main@0368290`, `feat/rbac-alignment`) — **benar**.
- `requireTenantRole` dipakai 1 endpoint (def `server.ts:220`, dipakai `server.ts:265`) — **benar**.
- "`?all=true` melewati filter tenant" — **benar** (`server.ts:4122` `const filterTenant = req.query.all !== "true";`).

Overclaim / bukti bergeser:
1. **C4 menuduh `/api/audit-logs` sebagai kebocoran kritis** — route-nya tidak ada (`server.ts` hanya punya 1 kemunculan: whitelist baris 105). Status sebenarnya: entri whitelist **inert**.
2. **C7 "dead code"** — `rbacScoping.ts` diimpor oleh `AuthContext.tsx:6`.
3. **C12 arah warisan terbalik** — lihat A6.
4. **Geser nomor baris (C5):** laporan menulis `server.ts:110,188,2239`; aktual `112` (`x-user-email`), `195`/`2240` (hardcode `adhitcl@gmail.com`). Bergeser ~2-7 baris → dokumen tampaknya ditulis terhadap revisi berbeda.
5. **Nama berkas:** laporan §4 menulis `server/rbacRoutes.ts`; artefak aktual `artifacts/server/rbacroutes.ts` (huruf kecil semua). Signifikan di lingkungan Linux (case-sensitive import).
6. **Kontradiksi internal:** §6.2 merekomendasikan memasang `requirePermission()` untuk menutup C1-C4, padahal `requirePermission()` sendiri membaca tenant/department dari client → **melanggar §25** yang dijadikan dasar temuan C-level lain. Rekomendasi perlu direvisi (harus melewati `resolveTrustedScope`).
7. Minor: `permissions.ts` (produk PR ini) **menduplikasi** matriks `ROLE_PERMISSIONS` di klien — bertentangan dengan §20 ("Frontend should not independently hardcode complex authorization logic") walau diberi label "fallback"; dan matriks klien untuk editor selalu memuat `document.delete` sehingga **akan drift** bila `EDITOR_CAN_DELETE_DOCUMENT=false`.
8. Minor: klaim C9 "`GET /api/activity-logs` tanpa auth" — rute ini **di belakang** `rbacAuthMiddleware` (tidak di-whitelist); kebocoran terjadi karena default peran = Viewer & GET diizinkan, bukan karena absennya middleware. Frasa perlu diperbaiki.

---

## E. Temuan tambahan (tidak ada di laporan audit)

1. **Whitelist memuat entri mati** (`/api/audit-logs`, `/api/export-csv`) → menandakan whitelist tidak dipelihara; berisiko bila suatu hari route dengan nama itu dibuat.
2. **`buildScopeFilter` mengembalikan `{tenantId: null}`** untuk non-superuser yang kehilangan tenant. Karena `null` juga bermakna "tanpa filter" untuk superuser, consumer query yang salah menafsirkan bisa **membocorkan lintas tenant**. Perlu sentinel/throw, bukan `null`.
3. **`permissionsFor('superuser')` mengembalikan 32/32** dan `hasPermission('superuser','<apa pun>')` → `true`, termasuk permission tak dikenal (`document.nuke`). Dapat diterima menurut §12 ("ALL"), tetapi bertabrakan dengan prinsip deny-by-default §32.1 — perlu keputusan eksplisit.
4. **Verifikasi identitas ganda**: `server.ts:112` (`x-user-email`) & `server.ts:2157` (kemunculan kedua) → ada dua tempat mempercayai header email; §25 mensyaratkan identitas dari sesi terverifikasi saja.

---

## F. Rekomendasi perbaikan (berurutan)

1. **Scope wajib diturunkan dari peran, bukan dari pemanggil.** Buang parameter `scope` dari API publik (`checkScope`/`decide`), ganti dengan fungsi internal `scopeKindFor(role)`; atau tolak `scope` yang lebih lebar dari milik peran. Tambahkan tes negatif untuk `scope='tenant'` pada manager/editor/viewer.
2. **Fail-closed**: bila `resource.tenantId`/`departmentId` tidak ada untuk peran non-superuser → **tolak**, jangan lolos. Sama untuk `canInvite` bila target scope kosong (§32.4).
3. **Perbaiki `requirePermission()`**: derive scope via `resolveTrustedScope(actor, ...)` sebelum `decide()`; jangan pernah membaca `tenantId`/`departmentId` dari `req.body`/`req.query` untuk non-superuser.
4. **Koreksi matriks**: hapus `audit.view` dari ADMIN (atau putuskan resmi sebagai keputusan produk), dan putuskan `tenant.view` (+catat di §34).
5. **Konsistensi hierarki**: putuskan satu aturan untuk SUPERUSER→SUPERUSER (invite vs role-change tidak boleh berbeda).
6. **Tutup jalur kritis di kode nyata**, bukan hanya di engine: pasang cek hierarki pada `PUT /users/:id/role` (`authConsoleRoutes.ts:521`), cek peran + audit pada `impersonate` (`:658`) dan isi `impersonatedBy`, hapus whitelist `tenants/switch` & `organizations/*` (`server.ts:100-101`), tambah cek hierarki/scope pada `POST /invitations` (`:1511`), dan ikat accept ke identitas (`:1624`).
7. **Perkuat suite**: tambah tes integrasi terhadap endpoint Express asli (bukan hanya modul), plus tes negatif untuk celah di B#2-B#4, toggling `EDITOR_CAN_DELETE_DOCUMENT`, dan anti-enumeration 404.
8. **Perbaiki laporan** agar cocok dengan bukti: koreksi arah C12, turunkan C4 untuk entri inert, ganti label "dead code", samakan nama berkas, dan perbarui nomor baris.

---

## G. Batasan review ini

- Tidak ada server berjalan; seluruh verdict berbasis pembacaan kode + eksekusi unit test, **bukan** uji runtime endpoint.
- Keberadaan kolom `session.impersonatedBy` disimpulkan dari `SELECT s.impersonatedBy` (`authConsoleRoutes.ts:823`); tidak ada file migrasi/skema yang bisa dibaca langsung.
- GitHub code search untuk repo ini tidak terindeks → daftar lengkap pengimpor `rbacScoping.ts` di frontend tidak dapat dienumerasi; verdict C7 dibatasi pada `server.ts` (0) vs `AuthContext.tsx` (import).
- Hanya 5 berkas repo yang diperiksa (server.ts, authConsoleRoutes.ts, rbacScoping.ts, AuthContext.tsx, Sidebar.tsx); mungkin ada jalur otorisasi lain yang tidak tercakup.
- Prober adversarial disimpan sementara di `artifacts/.openclaw/tmp/adv.ts` dan dihapus setelah review.
