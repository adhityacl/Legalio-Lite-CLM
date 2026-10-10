# DELIVERY — RBAC Alignment + Obsidian UI (repo `adhityacl/NEW-CLM`)

Indeks semua hasil kerja. Sumber kebenaran RBAC: `Engineering PRD — RBAC Structure & Authorization.md` (35 seksi). Panduan desain: preset **17 Takram**.

> 🔴 **PENTING — temuan QA live:** port-forward Codespaces (port 3000) saat ini membalas **data bisnis & data pengguna ke request anonim**. Lihat [qc/live-qa-report.md](qc/live-qa-report.md). Mitigasi tercepat: jadikan visibilitas port **Private** di Codespaces.

## Mulai dari sini

| Dokumen | Untuk apa |
|---|---|
| [HANDOVER.md](HANDOVER.md) | Changelog, aktivasi, migrasi role, deploy & rollback, status kriteria, risiko |
| [RBAC-Audit-Report.md](RBAC-Audit-Report.md) | Audit baris-per-baris PRD ↔ kode + 12 temuan (4 kritis) |
| [RBAC-Impersonation-QC-Report.md](RBAC-Impersonation-QC-Report.md) | Metode & hasil QC impersonasi (unit + runtime) |
| [ObsidianUI-Integration-Plan.md](ObsidianUI-Integration-Plan.md) | Cara pasang Obsidian UI, pemetaan komponen, design token, hasil uji kontras |
| [RBAC-Role-Permission-Matrix.md](RBAC-Role-Permission-Matrix.md) / [.csv](RBAC-Role-Permission-Matrix.csv) | Matriks 32 permission × 5 peran (dihasilkan dari kode) |
| [design-preview.html](design-preview.html) | Pratinjau desain mandiri (token Takram + pola Obsidian UI) |
| [Laporan-RBAC-ObsidianUI.docx](Laporan-RBAC-ObsidianUI.docx) | **Laporan serah terima final (DOCX)** — 11 tabel, data dibaca langsung dari hasil pengukuran. *Hanya di folder DELIVERY lokal* (format biner tidak dapat dikirim lewat konektor GitHub). |
| [RUNBOOK-perbaikan-Codespaces.docx](RUNBOOK-perbaikan-Codespaces.docx) | **Runbook 1 halaman**: cara menutup kebocoran, perintah perbaikan, cara restart app, verifikasi, dan troubleshooting. *Hanya di DELIVERY lokal.* |

## Bukti eksekusi (qc/)

| Artefak | Isi |
|---|---|
| [qc/live-qa-report.md](qc/live-qa-report.md) · [evidence](qc/live-qa-evidence.json) | 🔴 QA live port-forward: endpoint anonim mengembalikan data nyata |
| [qc/RBAC-QC-Impersonation-Run.md](qc/RBAC-QC-Impersonation-Run.md) · [json](qc/RBAC-QC-Impersonation-Run.json) | QC runtime engine: **30/30 lulus** per level |
| [qc/impersonation-audit-trail.json](qc/impersonation-audit-trail.json) | 4 event impersonasi dengan `impersonatedBy` terisi |
| [qc/scope-enforcement-evidence.json](qc/scope-enforcement-evidence.json) | Penegakan scope PRD §25 (spoof tenant/department) |
| [qc/migration-verification.json](qc/migration-verification.json) | Migrasi idempoten: 6 tabel, 0 FK error, 77 pemetaan |
| [qc/patch-verification.json](qc/patch-verification.json) · [patch](qc/server.ts.secure.patch) | Patcher integrasi: idempoten + lolos syntax check |
| [qc/contrast-report.json](qc/contrast-report.json) | Kontras WCAG 2.1 AA: **28/28** (light + dark) |
| [qc/design-preview-render.json](qc/design-preview-render.json) | Render halaman pratinjau: 5 kartu · 15 baris · 90 sel · LULUS |

## Kode (branch `feat/rbac-alignment`, PR #1)

| File | Fungsi |
|---|---|
| `server/rbac.ts` | Engine RBAC tunggal sesuai PRD |
| `server/rbacRoutes.ts` | Router `/api/rbac/*` + `requirePermission()` (additif) |
| `server/migrations/001_rbac_alignment.sql` | Skema RBAC + `audit_log` (idempoten, dari engine) |
| `tests/rbac.test.ts` | 44 test otorisasi (PRD §30 + §19 + §29) — **44/44 lulus** |
| `tools/gen-rbac-matrix.ts` · `tools/gen-rbac-migration.ts` | Generator matriks & migrasi dari kode (anti-drift) |
| `tools/apply-rbac-integration.mjs` | Patcher `server.ts` 2-tier, idempoten |
| `tools/rbac-devserver.ts` · `scripts/rbac-qc.mjs` | Server standalone + harness QC impersonasi |
| `tools/verify-migration.mjs` · `tools/check-contrast.mjs` | Verifikasi migrasi & kontras |
| `src/lib/permissions.ts` · `src/components/Can` | Helper permission frontend + `<Can>` |
| `src/styles/tokens.css`, `components.json`, `src/components/obsidian/*` | Fondasi Obsidian UI + design token |

## Cara cepat

```bash
# test otorisasi                       → 44/44
npx tsx --test tests/rbac.test.ts
# matriks dari kode                    → 32 × 5
npx tsx tools/gen-rbac-matrix.ts qc-output
# migrasi + verifikasi idempotensi     → 6 tabel, 0 FK error
node tools/verify-migration.mjs server/migrations/001_rbac_alignment.sql
# kontras WCAG AA                      → 28/28
node tools/check-contrast.mjs src/index.css src/styles/tokens.css
# QC impersonasi runtime (engine)      → 30/30
npx tsx tools/rbac-devserver.ts 3999 && node scripts/rbac-qc.mjs --base http://localhost:3999
```

## Aktivasi (idempoten, reversible)

```bash
node tools/apply-rbac-integration.mjs server.ts --tier=additive   # aman: hanya /api/rbac/*
node tools/apply-rbac-integration.mjs server.ts --tier=secure     # + tutup whitelist C4 + guard endpoint admin-inti
```

Terapkan `additive` → smoke test → `secure`. Detail & rollback: §4 & §6 [HANDOVER.md](HANDOVER.md).
