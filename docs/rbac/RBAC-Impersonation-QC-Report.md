# Laporan QC Impersonasi RBAC

- **Repo:** `adhityacl/NEW-CLM` · branch `feat/rbac-alignment`
- **Harness:** `scripts/rbac-qc.mjs` (tanpa dependensi eksternal, Node 22 fetch)
- **Status:** ✅ **QC runtime sudah dijalankan** pada engine RBAC standalone — **30/30 lulus** (bukti di §3b dan `DELIVERY/qc/`). QC pada app penuh tetap menunggu Codespaces (butuh kredensial).

## 1. Apa yang sudah diverifikasi tanpa runtime (statis)

| Item | Cara verifikasi | Hasil |
|---|---|---|
| Engine RBAC sesuai PRD (hierarki, permission, scope, invite, role-change, error, audit) | `tests/rbac.test.ts` — 36 test | ✅ **36/36 lulus** (`npx tsx --test tests/rbac.test.ts`) |
| Matriks peran×permission sinkron dengan kode | `tools/gen-rbac-matrix.ts` dari `server/rbac.ts` | ✅ 32 permission × 5 peran, tergenerasi |
| Skenario QC per level siap dijalankan | `scripts/rbac-qc.mjs` (6 skenario × 5 level = 30 probe) | ✅ siap |
| Defect pada kode lama teridentifikasi | Audit PRD baris-per-baris | ✅ 12 temuan (4 kritis) |

**Bukti unit test (ringkas):**

```
# tests 36
# pass  36
# fail   0
```

Catatan: pada eksekusi pertama, suite **menemukan 1 bug nyata** di `assignableRoles()` (SUPERUSER ikut dapat menetapkan `superuser`). Sudah diperbaiki → inilah bukti suite benar-benar menjaga aturan, bukan sekadar hijau.

## 2. Skenario QC impersonasi (PRD §30)

Dijalankan harness `scripts/rbac-qc.mjs`: untuk tiap level, harness menyamar sebagai user level tersebut (lewat `POST /api/auth-console/users/:id/impersonate` dengan token SUPERUSER, atau token yang diberikan), lalu memanggil endpoint dan membandingkan hasil dengan matriks izin.

| Skenario | Endpoint | SUPERUSER | ADMIN | MANAGER | EDITOR | VIEWER |
|---|---|:--:|:--:|:--:|:--:|:--:|
| `doc.view` | `GET /api/contracts` | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| `doc.create` | `POST /api/contracts` | ALLOW | ALLOW | ALLOW | ALLOW | **DENY** |
| `users.list` | `GET /api/auth-console/users` | ALLOW | ALLOW | ALLOW | **DENY** | **DENY** |
| `rbac.matrix` | `GET /api/rbac/matrix` | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| `invite.viewer` | `POST /api/rbac/simulate/invite` `{targetRole:"viewer"}` | ALLOW | ALLOW | ALLOW | **DENY** | **DENY** |
| `invite.as.admin` | `POST /api/rbac/simulate/invite` `{targetRole:"admin"}` | ALLOW | **DENY** | **DENY** | **DENY** | **DENY** |

Aturan penilaian: skenario ber-harapan **DENY** hanya dianggap lulus bila HTTP **401/403 dengan kode error standar PRD §29** — bukan `500`, halaman kosong, atau sukses tanpa pesan.

Skenario tambahan yang wajib dicatat manual (PRD §30 negatif):

- Akses lintas tenant: user tenant A membuka dokumen tenant B → `403 TENANT_SCOPE_VIOLATION` (atau `404 RESOURCE_NOT_FOUND` bila sengaja disamarkan, PRD §29).
- Akses lintas departemen: MANAGER/EDITOR/VIEWER membuka dokumen departemen lain → `403 DEPARTMENT_SCOPE_VIOLATION`.
- Manipulasi payload: MANAGER mengirim `tenantId`/`departmentId` palsu → tetap dipaksa ke scope miliknya (PRD §25).
- Tautan dalam (deep link) ke halaman admin oleh EDITOR → UI harus menolak, dan endpoint tetap menolak (backend otoritatif).

## 3b. Hasil eksekusi runtime (SUDAH DIJALANKAN)

Karena app penuh butuh kredensial, engine yang sama dijalankan sebagai server HTTP standalone (`tools/rbac-devserver.ts`, tanpa dependensi, port 3999) dan harness QC menyerangnya sungguhan — **termasuk alur impersonasi nyata** (SUPERUSER meng-impersonate U-ADMIN/U-MANAGER/U-EDITOR/U-VIEWER untuk mendapatkan token tiap level).

```
node scripts/rbac-qc.mjs --base http://localhost:3999
→ Hasil: 30/30 lulus  (exit code 0)
```

| Level | Sumber token | Lulus |
|---|---|---:|
| superuser | super-token | 6/6 |
| admin | impersonation | 6/6 |
| manager | impersonation | 6/6 |
| editor | impersonation | 6/6 |
| viewer | impersonation | 6/6 |

Probe negatif yang terbukti ditolak dengan kode error standar PRD §29:

| Probe | Level | HTTP | Kode error |
|---|---|---:|---|
| `POST /api/contracts` | viewer | 403 | `INSUFFICIENT_PERMISSION` |
| `GET /api/auth-console/users` | editor | 403 | `INSUFFICIENT_PERMISSION` |
| `GET /api/auth-console/users` | viewer | 403 | `INSUFFICIENT_PERMISSION` |
| `POST /api/rbac/simulate/invite {targetRole:"viewer"}` | editor | 403 | `INSUFFICIENT_PERMISSION` |
| `POST /api/rbac/simulate/invite {targetRole:"admin"}` | admin | 403 | `INVALID_ROLE_ASSIGNMENT` |
| `POST /api/rbac/simulate/invite {targetRole:"admin"}` | manager | 403 | `INVALID_ROLE_ASSIGNMENT` |

**Jejak audit impersonasi (4 entri, `impersonatedBy` terisi):**

```
actor=U-SUPER action=user.impersonate target=U-ADMIN   impersonatedBy=U-SUPER
actor=U-SUPER action=user.impersonate target=U-MANAGER impersonatedBy=U-SUPER
actor=U-SUPER action=user.impersonate target=U-EDITOR  impersonatedBy=U-SUPER
actor=U-SUPER action=user.impersonate target=U-VIEWER  impersonatedBy=U-SUPER
```

Artefak bukti: `DELIVERY/qc/RBAC-QC-Impersonation-Run.md`, `.json`, dan `impersonation-audit-trail.json`.

**Bukti penegakan scope (PRD §25) — client memalsukan `tenantId=t-999&departmentId=d-9`:**

| Level | Diminta | Dipaksa menjadi |
|---|---|---|
| manager | t-999 / d-9 | **t1 / d1** (miliknya) |
| editor | t-999 / d-9 | **t1 / d1** (miliknya) |
| admin | t-999 / d-9 | **t1 / d-9** (tenant dipaksa, departemen bebas dalam tenant) |
| superuser | t-999 / d-9 | t-999 / d-9 (global, apa adanya) |

Artefak: `DELIVERY/qc/scope-enforcement-evidence.json`.

## 3. Cara menjalankan ulang

```bash
# 1. Nyalakan app
npm run dev            # server di http://localhost:3000

# 2. Ambil token SUPERUSER dari sesi login browser (DevTools → Application → Cookies/localStorage),
#    lalu jalankan harness. Isi id akun untuk tiap level agar impersonasi otomatis:
node scripts/rbac-qc.mjs \
  --base http://localhost:3000 \
  --super-token "<TOKEN_SUPERUSER>" \
  --accounts '{"admin":"<userId>","manager":"<userId>","editor":"<userId>","viewer":"<userId>"}'
```

Hasil: `qc-output/rbac-qc-report.md` dan `qc-output/rbac-qc-report.json` (tabel lulus/gagal per level + kode error tiap probe). Exit code `0` bila semua lulus.

### Mengapa belum dijalankan di sini (jujur)

App ini **full-stack** dan butuh runtime Express + better-auth + SQLite + kredensial (`GEMINI_API_KEY`, `BETTER_AUTH_SECRET`, `GOOGLE_*`). Lingkungan kerja agen tidak memiliki kredensial tersebut dan kanal preview AutoClaw hanya mendukung situs statis — jadi QC runtime **tidak dapat** dieksekusi di sisi agen tanpa membocorkan rahasia. Karena itu:

- Yang bisa diverifikasi tanpa runtime (logika otorisasi, matriks, skenario) → **sudah diverifikasi dan lulus**.
- Yang butuh runtime (HTTP + sesi + impersonasi nyata) → harness sudah disiapkan, **dijalankan oleh Anda di Codespaces**, hasilnya deterministic.

> Catatan: terhadap **app penuh**, beberapa skenario akan gagal sampai C1–C4 pada laporan audit ditutup (endpoint masih di-whitelist dan impersonasi belum digerbangi). Urutan yang benar: pasang engine → tutup C1–C4 → jalankan harness di app penuh.

## 4. Bukti jejak audit impersonasi (target PRD §27)

Setelah implementasi penuh, tiap sesi impersonasi harus menghasilkan event:

```json
{
  "actorId": "u-editor-01",
  "action": "document.edit",
  "targetType": "DOCUMENT",
  "targetId": "doc-1",
  "tenantId": "t1",
  "departmentId": "d1",
  "impersonatedBy": "u-superuser-01",
  "timestamp": "2026-09-21T10:30:00Z"
}
```

Hal ini sudah dijamin di level engine (`buildAuditEvent`, diuji di `tests/rbac.test.ts`: identitas pelaku efektif dan admin asli **tidak tercampur**). Yang belum: kolom `impersonatedBy` pada tabel `session` masih kosong saat impersonasi (`authConsoleRoutes.ts:658`) — perbaikan ada di rencana §6 audit report.
