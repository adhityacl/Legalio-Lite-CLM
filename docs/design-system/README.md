# 🎨 Legalio Design System

> **Single Source of Truth** untuk seluruh pembuatan antarmuka (UI), komponen, token desain, dan aturan aksesibilitas di Legalio CLM.
> **Wajib dipatuhi oleh seluruh developer dan AI Agent (OpenAI, Claude, Gemini/Antigravity, Cursor, Copilot, dll.).**

---

## 🏛️ Arsitektur Design System

Design System Legalio CLM dibangun dengan prinsip **Zero Dependency Risk** (In-Tree / Copy-Owned Component Model):

1. **Paket Komponen Internal:**  
   [`packages/ui-components/`](file:///workspaces/NEW-CLM/packages/ui-components/) (`@legalio/ui-components`)  
   Seluruh komponen UI wajib diimpor dari `@legalio/ui-components/<komponen>`. Dilarang mengimpor library UI eksternal langsung di aplikasi konsumen (`apps/frontend`).

2. **Primitive & Accessibility Engine:**  
   Menggunakan headless primitives standar industri: `@ark-ui/react`, `@radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, dan `lucide-react`.

3. **Styling & CSS Engine:**  
   Tailwind CSS v4 dengan token desain CSS Variables native yang mendukung **Dark Mode** (`light-dark()`) dan **Multi-Tenant / White-label Theming**.

---

## 📑 Daftar Panduan Standar

| Panduan | File Rujukan | Ringkasan Aturan |
| :--- | :--- | :--- |
| **STANDAR UTAMA (wajib)** | [STANDARD.md](STANDARD.md) | Golden ratio (φ) murni: tangga `g*`, tipografi, tinggi kontrol 21/26/34/42/55, layout 38,2/61,8, komponen, motion. Mengalahkan semua dokumen lain. |
| **Tokens & Warna** | [tokens.md](tokens.md) | Dilarang raw hex. Gunakan semantic tokens (`accent`, `surface`, `hairline`, `ink`, status). Kontras WCAG AA $\ge 4.5:1$. |
| **Katalog Komponen** | [components.md](components.md) | Daftar komponen yang tersedia di `@legalio/ui-components` dan contoh penggunaannya. |
| **Aturan untuk AI** | [ai-rules.md](ai-rules.md) | Checklist ketat yang harus diverifikasi oleh setiap AI agent sebelum menyelesaikan tugas UI. |

---

## 🚫 5 Aturan Emas (Golden Rules) yang Dilarang Dilanggar

1. ❌ **Jangan gunakan Raw Hex atau Tailwind Palette Utilities:**  
   Dilarang menulis `text-[#06C755]`, `bg-[#123456]`, `bg-emerald-500`, atau `text-gray-700`. Gunakan semantic token seperti `text-accent-text`, `bg-accent-strong`, `border-hairline`, `bg-muted`.
2. ❌ **Jangan gunakan font di bawah 13px:**  
   Dilarang menggunakan `text-2xs`, `text-[10px]`, `text-[11px]`, atau `text-[12px]`. Ukuran terkecil adalah `text-xs` (13px).
3. ❌ **Jangan ubah tinggi tombol/field secara acak:**  
   Dilarang menambahkan `h-8`, `h-10`, `py-1.5`, `rounded-full` sembarangan pada `Button` atau `Input`. Selalu gunakan `size="md"` (34px) atau `size="sm"` (26px). Spacing dan ukuran lain hanya dari tangga golden `g*` (`p-g13`, `gap-g21`, `h-g42`).
4. ❌ **Field dan tombol sejajar wajib sama tinggi:**  
   Jika tombol berada di baris yang sama dengan input field / search bar, tingginya harus sama (`md` 34px).
5. ❌ **Jangan mengimpor library UI pihak ketiga langsung di `apps/`:**  
   Semua impor komponen UI harus melalui `@legalio/ui-components/<komponen>`.

