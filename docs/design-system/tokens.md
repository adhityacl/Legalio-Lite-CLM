# 🎨 Token Desain & Sistem Warna

Dokumen ini mendefinisikan aturan warna, variabel CSS, tema gelap, dan kepatuhan kontras aksesibilitas.

---

## 1. Definisi Token CSS

Token didefinisikan di [`packages/ui-components/src/styles/theme.css`](file:///workspaces/NEW-CLM/packages/ui-components/src/styles/theme.css) dan dipetakan ke Tailwind v4 `@theme inline`:

### A. Surfaces & Backgrounds
* `--moduix-background`: `light-dark(#f7f8fa, #0b101b)`
* `--moduix-card`: `light-dark(#ffffff, #131d2e)`
* `--moduix-popover`: `light-dark(#ffffff, #131d2e)`
* `--moduix-secondary`: `light-dark(#f1f4f8, #1c293d)`
* `--moduix-muted`: `light-dark(#f1f4f8, #1c293d)`

### B. Typography & Ink
* `--moduix-foreground`: `light-dark(#172033, #edf2fa)`
* `--moduix-muted-foreground`: `light-dark(#526176, #b4c1d4)`
* Utility semantic: `text-ink`, `text-ink-soft`, `text-ink-faint`

### C. Aksi & Brand Utama
* `--moduix-primary`: `light-dark(#2653f6, #2653f6)` (Dapat dioverride dinamis per organisasi/tenant)
* `--moduix-primary-foreground`: `#ffffff` (atau `#111111` untuk warna terang seperti yellow/mint)
* `--moduix-accent`: `light-dark(#eef2ff, #1c2c59)`
* `--moduix-accent-foreground`: `light-dark(#1d3fc4, #a9bdff)`
* `--moduix-ring`: `light-dark(#1d3fc4, #a9bdff)`

### D. Garis & Batas
* `--moduix-border`: `light-dark(#dce3ed, #33425a)`
* `--moduix-input`: `light-dark(#9aa8bb, #657894)`
* Utility: `border-hairline`, `border-border`

### E. Status Feedback (Wajib WCAG AA $\ge 4.5:1$)
Setiap status memiliki varian solid, soft background, dan border:
* **Success:** `--moduix-success` / `--legalio-success-soft` / `--legalio-success-border`
* **Warning:** `--moduix-warning` / `--legalio-warning-soft` / `--legalio-warning-border`
* **Danger:** `--moduix-destructive` / `--legalio-danger-soft` / `--legalio-danger-border`
* **Info:** `--legalio-info` / `--legalio-info-soft` / `--legalio-info-border`
* **Special:** `--legalio-special` / `--legalio-special-soft` / `--legalio-special-border`
* **Finance:** `--legalio-finance` / `--legalio-finance-soft` / `--legalio-finance-border`

---

## 2. Aturan Larangan & Penggantian (Enforced via Tests)

| ❌ DILARANG (Offender) | ✅ GUNAKAN (Token Resmi) |
| :--- | :--- |
| `text-[#06C755]`, `text-[#048C3B]` | `text-accent-text`, `text-status-success` |
| `text-[#111111]`, `text-[#777777]` | `text-foreground`, `text-muted-foreground`, `text-ink` |
| `bg-[#04803D]`, `bg-[#036B33]` | `bg-primary`, `bg-status-success` |
| `bg-[#EBFBF0]` | `bg-status-success-soft` |
| `border-[#06C755]` | `border-status-success-border`, `border-accent` |
| `border-[#E5E8EB]` | `border-hairline`, `border-border` |
| `bg-emerald-500`, `bg-green-600` | `bg-primary`, `bg-status-success` |
| `bg-slate-100`, `bg-zinc-800` | `bg-muted`, `bg-card`, `bg-secondary` |

*Pengujian otomatis:* [`tests/designTokens.test.ts`](file:///workspaces/NEW-CLM/tests/designTokens.test.ts).

---

## 3. Dark Mode

Dark mode berjalan native via CSS function `light-dark()`. Nilai berubah otomatis berdasarkan atribut:
```html
<html data-moduix-color-scheme="dark">
```
Jangan menulis hardcoded override `@media (prefers-color-scheme)` di komponen lokal. Gunakan token `light-dark()` atau variant `dark:` bawaan sistem.

