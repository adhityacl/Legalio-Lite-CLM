# 🤖 Aturan Wajib untuk Semua AI Agent (OpenAI, Claude, Gemini, Cursor, Copilot)

Setiap AI yang menulis, mengedit, atau merefaktor kode UI di repositori Legalio CLM **wajib membaca [`STANDARD.md`](STANDARD.md)** (sumber kebenaran tunggal untuk ukuran, spacing, tipografi, layout, motion) **dan mematuhi checklist berikut**:

---

## ✅ Pre-Generation Checklist

Sebelum menghasilkan atau memodifikasi kode UI:
1. **Periksa Impor Komponen:**  
   Pastikan komponen UI diimpor dari `@legalio/ui-components/<komponen>`. Jangan pernah menambahkan dependensi UI baru ke `package.json` tanpa izin.
2. **Cek Palet Warna & Hex:**  
   * DILARANG menulis raw hex: `text-[#...]`, `bg-[#...]`, `border-[#...]`.
   * DILARANG menulis kelas warna Tailwind bawaan langsung: `bg-green-*`, `text-slate-*`, `border-gray-*`.
   * WAJIB gunakan semantic token: `text-foreground`, `text-muted-foreground`, `bg-card`, `bg-muted`, `border-hairline`, `border-border`, `text-status-*`, `bg-status-*-soft`.
3. **Cek Ukuran Teks (STANDARD.md §1):**
   * Skala: `text-xs`·`text-sm` 13 (UI) / `text-md` 16 (reading) / `text-lg` 21 / `text-xl` 26 / `text-2xl` 34 / `text-3xl` 42 px (68 hanya untuk marketing).
   * Batas bawah **13px**. `text-2xs`, `text-[10px]`, `text-[11px]`, `text-[12px]` dilarang keras. Pakai `Heading` / `Text`.
4. **Cek Ukuran, Spacing & Layout (STANDARD.md §0, §2–§4):**
   * Ukuran kontrol hanya lewat prop `size`: `sm` 26 (row action), `md` 34 (field dan aksi form/page), `lg` 42. Jangan beri `h-*`, `min-h-*`, `py-*`, `px-*` pada kontrol.
   * Semua ukuran/spacing memakai tangga golden `g*`: `g2 g3 g5 g8 g13 g16 g21 g26 g34 g42 g55 g68 g89 g110 g144 g233 g377 g610 g987 g1597` (contoh `p-g13`, `gap-g21`, `h-g34`, `max-w-g610`).
   * Tabel: sel pertama dan terakhir tiap baris `g21` (sejajar dengan padding Card), sel lain `g13`. Header Card berisi tabel pakai `TableCardHeader` dari `@legalio/ui-components/blocks` (STANDARD.md §5).
   * Tampilan harus compact: dialog form isian data pakai `ModalFrame size="form"` (720), dialog lain `md` (610) ke bawah, maksimal dua kolom; `lg`/`xl` hanya untuk tabel, perbandingan, atau review penuh.
   * Tanggal/bulan: pakai `DateInput` / `MonthInput` (moduix DatePicker), jangan `<input type="date|month|time">` bawaan browser (dijaga test).
   * Judul halaman = `Heading as="h2" size="md"` (21), baris polos tanpa Card (STANDARD.md §1.2, §5). `TabsContent` dan `Empty` tanpa bingkai sendiri.
   * Tooltip yang membungkus `MenuTrigger`/`PopoverTrigger` wajib berbagi `ids={{ trigger }}` dengan overlay-nya; kalau tidak, popup muncul di pojok kiri atas.
   * Setiap perubahan UI diperiksa di browser nyata (screenshot Playwright) dan tinggi kontrol diukur terhadap §3 sebelum dinyatakan selesai.
   * DILARANG: langkah numerik Tailwind (`p-4`, `h-10`, `gap-3`), ukuran container (`max-w-md`), dan nilai arbitrer `[..px]`/`[..rem]`. Boleh: `0`, `px`, pecahan, `full`/`screen`.
   * Layout dua panel memakai rasio 38,2% / 61,8% (`grid-cols-[1fr_1.618fr]`).
   * Dialog: `ModalFrame size` `sm` 377 / `md` 610 / `lg` 987 / `xl` 1597.
5. **Cek Kontras Aksesibilitas:**  
   * Pastikan rasio kontras teks memenuhi WCAG AA ($\ge 4.5:1$).
   * Jika menampilkan teks di atas warna brand tenant dinamis, gunakan utilitas `readableTextOn(color)`.

---

## 🧪 Verifikasi Otomatis (CI Gate)
Kode UI Anda akan diverifikasi oleh test berikut. Pastikan perubahan Anda lolos:
```bash
npx tsx --test tests/designTokens.test.ts
npx tsx --test tests/organizationColors.test.ts
```
`designTokens.test.ts` gagal bila ada ukuran di luar tangga golden, atau teks di bawah 13px.

