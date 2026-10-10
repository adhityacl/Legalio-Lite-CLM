# Audit UI/UX seluruh halaman — 3 Oktober 2026

Audit ini memakai kerangka *design critique*: kesan pertama, usability, hierarki visual, konsistensi, dan aksesibilitas. Aturan prioritas dan anti-pattern diambil dari basis data ui-ux-pro-max v2.13.0. Audit sebelumnya ([VISUAL-OPTIMIZATION-2026-10-03.md](VISUAL-OPTIMIZATION-2026-10-03.md)) fokus pada dialog, label, dan geometri. Dokumen ini fokus pada hierarki, konsistensi sistem desain, bahasa visual, dan alur.

## Cakupan dan metode

- Total 74 tampilan. Setiap tampilan diambil di desktop 1440 × 900 dan mobile 390 × 844:
  - 3 halaman publik: login, privasi, dan ketentuan.
  - 23 tab superuser.
  - 4 tab admin organisasi.
  - 2 tab viewer.
  - 5 tab dalam tema gelap.
- Setiap tampilan dibuka langsung lewat URL `/app?tab=…` dengan sesi role hasil seed (`tests/e2e/seed.ts`). Setelah selesai, sesi tersebut dihapus. Data aplikasi tidak diubah.
- Untuk setiap tampilan, pemindai otomatis mengukur:
  - kontras teks (WCAG);
  - teks di bawah 12 px;
  - target klik di bawah 24 px;
  - tombol tanpa nama aksesibel;
  - overflow horizontal;
  - jumlah `h1`;
  - landmark `main`;
  - error di console.
- Pemeriksaan statis pada `src/` mencakup hex mentah, ukuran font arbitrer, pemakaian token, emoji, dan font.
- Screenshot dan `results.json` ada di scratchpad sesi (`…/scratchpad/shots2/`). Folder ini tidak masuk repo.

Batasan: pemindai kontras tidak membaca latar `background-image`/gradien. Temuan "putih di atas putih" pada tombol, avatar, dan hero gradien adalah false positive dan sudah dibuang. Bahasa yang terpakai saat audit adalah Inggris. Data yang dipakai adalah data demo.

## Ringkasan

Kerangka aplikasi sudah konsisten. Semua modul memakai pola yang sama: kartu judul, bar filter, lalu tabel. Hasil pemindai juga bersih:

- tidak ada overflow horizontal di 74 tampilan;
- setiap halaman punya satu `h1`;
- tidak ada tombol tanpa nama aksesibel.

Masalah terbesarnya ada di sistem desain, bukan di layout:

- Warna brand dipakai sebagai warna teks dengan kontras sekitar 2,2:1.
- Token desain hampir tidak dipakai.
- Tombol primer hijau muncul terlalu banyak sehingga tidak ada satu aksi utama yang menonjol.
- Di mobile, chrome di atas tabel menghabiskan dua pertiga layar.

Audit juga menemukan satu bug fungsional serius pada deep link, dan bug itu sudah diperbaiki (lihat F-01).

## Temuan

Skala keparahan: 🔴 kritis, 🟡 sedang, 🟢 minor.

### Usability dan alur

| ID | Temuan | Sev. | Rekomendasi |
|----|--------|------|-------------|
| F-01 | **[Sudah diperbaiki]** Deep link membuka halaman yang salah:<br>• Semua tab `admin-system-*` untuk superuser jatuh ke *Organization Admin › Users*.<br>• `create-contract`, `bulk-import`, dan `activity-logs` jatuh ke dashboard.<br>• Admin organisasi juga ikut terpental.<br>Penyebabnya, render pertama setelah sesi aktif masih membawa nilai izin dari fase belum login (`loading: false`, izin viewer). Guard tab mengalihkan berdasarkan nilai basi itu. | 🔴 | Diperbaiki di `src/lib/permissions.ts`: nilai izin ditandai per user, dan bila user-nya berbeda nilainya dianggap `loading`. Tes regresi ada di `tests/e2e/spa-query-routing.spec.ts`. Pada run ulang, 0 dari 74 tampilan dialihkan dengan salah. |
| F-02 | Terlalu banyak tombol primer:<br>• *Explore* punya tiga tombol hijau di header, ditambah tombol hijau *New Contract* di setiap baris.<br>• *Partner Evaluation* punya tombol hijau *Input Evaluation* di setiap baris.<br>• Di mobile, tiga tombol primer bertumpuk selebar layar. | 🔴 | Pakai satu tombol primer per tampilan. Aksi lain di header jadi `secondary`/`outline`. Aksi per baris jadi tombol ghost atau ikon + menu `…`, seperti yang sudah dipakai di tabel kontrak. |
| F-03 | Chrome vertikal terlalu tinggi:<br>• Banner *Google setup* (~70 px) tampil di **setiap** halaman.<br>• Kartu judul dan kartu filter terpisah.<br>• Di mobile, tabel kontrak baru mulai di y ≈ 565 dari 844, jadi hanya sekitar 3 baris yang terlihat. | 🔴 | • Tampilkan banner hanya di dashboard dan Settings, atau buat bisa ditutup dan diingat per user.<br>• Gabungkan judul dan filter dalam satu kartu.<br>• Di mobile, pindahkan filter ke *sheet* "Filter (n)".<br>• Untuk tabel di bawah 640 px, pakai daftar kartu. |
| F-04 | Tombol chat AI (`AIChatWidget.tsx:165`, `fixed bottom-3 right-3`) menutupi kolom *Action* dan tombol baris terakhir di semua halaman, desktop maupun mobile. | 🟡 | Tambahkan `padding-bottom` pada `main` setinggi FAB + 16 px. Bisa juga perkecil FAB saat discroll, atau pindahkan ke header di mobile. |
| F-05 | Empty state kosong: *My Documents* tanpa data hanya menampilkan area tabel putih ditambah pagination nonaktif. | 🟡 | Tampilkan pesan, ilustrasi kecil atau ikon, dan CTA *New Document*. Sembunyikan pagination ketika data 0. |
| F-06 | Teks notifikasi dari server selalu berbahasa Indonesia ("… berakhir dalam 90 hari"), walaupun UI berbahasa Inggris (`server.ts:1984`, `server.ts:2076`). | 🟡 | Simpan kode pesan dan parameternya, lalu render di klien lewat katalog i18n. |
| F-07 | Error 401 di console pada halaman publik: ada fetch berautentikasi sebelum login. | 🟢 | Jangan panggil endpoint privat saat `user == null`. |

### Hierarki visual

- **Yang pertama menarik mata di dashboard** adalah hero gradien indigo-violet (`index.css:830`, `#4f46e5 → #7668ff`, tinggi minimum 248 px). Isinya hanya salam dan satu kalimat. Data terpenting, yaitu kontrak yang akan berakhir, berada di kartu KPI kecil dan di tabel di bawah lipatan layar.
- **Alur baca:** hero, lalu empat KPI, lalu tabel. Di mobile, KPI ditumpuk satu kolom, sehingga KPI keempat baru terlihat setelah dua kali scroll.
- **Penekanan:** empat kartu KPI memakai empat warna (hijau, biru, violet, amber) tanpa makna. Hanya amber yang membawa arti "perlu tindakan". Label *EXPIRING CONTRACTS* ditulis kapital penuh, sedangkan kartu lain memakai Title Case.

Rekomendasi:

- Ganti hero dengan baris ringkas: salam di kiri, CTA kontekstual di kanan, tinggi sekitar 72 px.
- Jadikan "Kontrak akan berakhir" kartu yang paling menonjol.
- Kartu KPI lain memakai satu warna netral, dan warna dipakai hanya untuk status.
- Di mobile, KPI dibuat 2 × 2.

ui-ux-pro-max mencatat gradien ungu/pink sebagai anti-pattern ("AI purple/pink gradients"). Gradien ini juga tidak sesuai dengan brand hijau.

### Konsistensi

| Elemen | Masalah | Rekomendasi |
|--------|---------|-------------|
| Warna (🔴) | Token tidak dipakai. Selain itu, `src/styles/tokens.css` tidak diimpor di mana pun, sehingga utilitas yang hanya didefinisikan di sana (`text-accent-text`, `bg-surface-2`) tidak pernah dihasilkan. `tokens.css` melarang hex hardcoded, tetapi hex mentah muncul di 39 file, termasuk `text-[#06C755]` ×157, `border-[#06C755]` ×183, `ring-[#06C755]` ×112, dan `bg-[#04803D]` ×73. Kelas `slate-*` muncul 5.550 kali. Sebaliknya, utilitas token (`text-accent-text`, `bg-surface`, `text-ink-soft`, dan sejenisnya) hanya terpakai sekitar 35 kali. | Lakukan codemod bertahap: `text-[#06C755]` → `text-accent-text`, `bg-[#06C755]`/`bg-[#04803D]` → `bg-accent`/`bg-accent-dark`, `slate-500/600` → `ink-soft`, dan seterusnya. Setelah itu, tambahkan lint (misalnya `eslint-plugin-tailwindcss` `no-arbitrary-value`) untuk warna. |
| Tipografi | Ukuran arbitrer `text-[11px]` ×187, `text-[10px]` ×162, `text-[9px]` ×9, `text-[8px]` ×1. Saat runtime, sekitar 1.640 elemen tampil di 9–11 px. | Gunakan skala tetap: 12 / 13 / 14 / 16 / 20 / 24 / 32. Batas minimum 12 px, termasuk label sidebar, versi, dan sub-teks KPI. |
| Font | Inter dimuat (lima bobot) tetapi tidak terpakai. JetBrains Mono dideklarasikan di token tetapi tidak dimuat, sehingga jatuh ke `ui-monospace`. | Hapus Inter dari `index.html`. Untuk angka di tabel, ganti `font-mono` dengan `tabular-nums`. |
| Penamaan | • Menu *Explore* membuka halaman berjudul *Legal Document Structure*.<br>• Menu *Create Document* membuka halaman *My Documents*, dengan tombol *New Document*.<br>• Menu *System Admin* berbreadcrumb *Manage Admin Access*.<br>• Pemilih bahasa menulis "CN" untuk bahasa Mandarin (kode `ZH`, `LanguageContext.tsx:12`). | Samakan label menu, breadcrumb, dan `h1`, misalnya *Struktur Dokumen* dan *Dokumen Saya*. Untuk Mandarin, pakai label "中文" atau "ZH". "CN" adalah kode negara. |
| Format tanggal | Notifikasi memakai `10/02/2026, 03:55:57 AM` (numerik, ambigu antara bulan/hari dan hari/bulan). Halaman lain memakai `Dec 31, 2026`. | Pakai satu formatter (`dd MMM yyyy, HH:mm`) di semua tabel. |
| Copy | "1 sessions"; tanda kosong bercampur antara `-` dan `—` di tabel evaluasi. | Pakai pluralisasi i18n dan satu simbol kosong (`—`). |
| Emoji | Emoji 💡 dan 📄 dipakai di `PartnerSpendingView.tsx`, serta 🏷️📅💰🏢👤 di `ContractDocumentEditor.tsx:163`. | Ganti dengan ikon Lucide, sesuai aturan ui-ux-pro-max "no emoji as icons". |
| Warna peran | ~~Warna peran di matriks RBAC berbeda dengan badge di tabel pengguna.~~ **Koreksi:** keduanya sudah memakai peta yang sama: superuser merah, admin ungu, manager biru, editor hijau, viewer abu-abu. Temuan ini dibatalkan. | — |

### Aksesibilitas

- **Kontras warna:**
  - Gagal: brand `#06C755` sebagai teks di atas putih atau `#F5F6F6`, sekitar 2,1–2,2:1. Ini terukur pada inisial avatar organisasi dan tersebar lewat `text-[#06C755]` ×157.
  - Gagal: teks putih di atas `#06C755`, 2,26:1, pada avatar organisasi yang memakai `primaryColor` tenant sebagai latar. (Koreksi: versi awal laporan ini menyebut `--primary-foreground` di `tokens.css` sebagai penyebab. Ternyata `tokens.css` tidak pernah dimuat. `--primary` yang aktif berasal dari `shadcn-tokens.css` (`#04803d` dengan teks putih) dan sudah lolos AA.)
  - Nyaris lolos: `#A16207` di atas `#FFF3DB` 4,48:1 ("Extension / Termination", 11 px). `#777777` di atas putih 4,48:1 (teks bantuan Settings › AI, 10–11 px).
  - Lolos: teks utama, header tabel, sidebar, dan seluruh tema gelap yang dipindai.
- **Target sentuh:** checkbox tabel dan checkbox Settings › Region berukuran 14 × 14 px. Ukuran ini lolos WCAG 2.5.8 hanya lewat pengecualian jarak. Perbesar kotak ke 18–20 px dengan area klik ≥ 44 px lewat padding pada sel atau label. Tautan daftar isi di halaman Privasi tingginya 16 px.
- **Keterbacaan teks:** 12 px adalah ukuran dominan (sekitar 10.400 elemen). Untuk UI padat ini masih wajar, tetapi isi utama tabel sebaiknya 13–14 px. Ukuran 9–11 px perlu dihapus (lihat tabel Konsistensi).
- **Struktur:** tidak ada *skip link* di halaman mana pun. Halaman publik (login, privasi, ketentuan) tidak punya landmark `main`.
- **Tema gelap:** checkbox header tabel tampak terisi abu-abu, sehingga terlihat seperti sudah tercentang. Gunakan latar transparan dan border `ink-faint`.

### Yang sudah berjalan baik

- Pola halaman konsisten: kartu judul, filter, lalu tabel, dengan kolom *Action* yang tetap terlihat saat tabel digeser di mobile.
- Sidebar dikelompokkan dengan jelas (Main / Document / Admin), dengan submenu dan badge jumlah.
- Tidak ada overflow horizontal, setiap halaman punya satu `h1`, dan semua tombol ikon punya nama aksesibel.
- Tampilan login bersih, dengan hierarki CTA yang benar (satu primer, Google sebagai sekunder).
- Tema gelap lengkap dan lolos kontras pada semua tampilan yang dipindai.
- Routing `?tab=` sekarang mendukung deep link, reload, serta tombol back dan forward.

## Catatan tentang rekomendasi design system ui-ux-pro-max

Query `legal contract management SaaS dashboard --design-system --density 8` mengembalikan:

- gaya *Accessible & Ethical*;
- palet navy/gold;
- font EB Garamond dengan Lato;
- pola *Trust & Authority + Conversion*.

Pola tersebut ditujukan untuk landing page (CTA "Contact Sales", logo pelanggan), jadi hanya cocok sebagian untuk aplikasi internal. Yang layak diadopsi adalah aturan aksesibilitas dan densitasnya: focus ring 3–4 px, target 44 px, `prefers-reduced-motion`, dan skala spasi 8–32 px. Palet dan font **tidak** disarankan untuk diganti. Brand hijau dan Plus Jakarta Sans sudah dipakai di seluruh aplikasi. Yang perlu diperbaiki adalah cara token dipakai, bukan pemilihannya.

## Prioritas perbaikan

1. **Kontras dan token brand.** Kerjakan dulu F-Warna dan kegagalan kontras di bagian Aksesibilitas:
   - Set `--primary-foreground` ke `var(--line-on-accent)`.
   - Lakukan codemod `text-[#06C755]` → `text-accent-text`.
   - Tambahkan lint untuk hex arbitrer.

   Ini memperbaiki kegagalan AA terbesar dan menghentikan penyimpangan tema.
2. **Satu aksi primer per tampilan (F-02) dan chrome yang lebih ringkas (F-03).** Dampaknya paling terasa, terutama di mobile.
3. **Dashboard.** Ganti hero gradien dengan baris ringkas, KPI netral dengan amber hanya untuk status yang mendesak, dan KPI 2 × 2 di mobile.
4. **Skala tipografi.** Hapus ukuran 8–11 px dan Inter, lalu ganti `font-mono` dengan `tabular-nums`.
5. **Penamaan, tanggal, i18n server (F-06), empty state (F-05), FAB (F-04), skip link, dan checkbox.**

## Verifikasi perbaikan F-01

- `tsc --noEmit`: lulus.
- `tests/e2e/spa-query-routing.spec.ts` (8 tes, termasuk 3 tes regresi baru) dijalankan dengan `--repeat-each 2`:
  - Run pertama: 13 dari 16 lulus. Run kedua: 12 dari 16 lulus.
  - Semua kegagalan berasal dari crash Chromium (`Target crashed` / `Page crashed`), tidak ada kegagalan assertion. Lingkungan audit hanya punya sekitar 1 GB RAM tersisa.
  - Saat dijalankan terpisah, ketiga tes regresi lulus 3 dari 3.
- Run screenshot ulang setelah perbaikan: 74 dari 74 tampilan mendarat di tab yang diminta.

## Status perbaikan (putaran kedua, 3 Oktober 2026)

Lingkup: semua temuan diperbaiki, **kecuali hierarki visual dashboard**. Hero, susunan dan warna kartu KPI, serta urutan blok dashboard tidak diubah atas permintaan pengguna. Rekomendasi prioritas 3 di atas ditunda.

### Sudah diperbaiki

| Temuan | Perubahan |
|--------|-----------|
| Kontras brand + token | • Codemod 804 kelas di 37 file, misalnya `text-[#06C755]`/`text-[#048C3B]` → `text-accent-text`, `bg-[#04803D]` → `bg-accent-strong`, `border/ring-[#06C755]` → `border/ring-accent`, `text-[#111111]`/`[#777777]` → `text-ink`/`text-ink-soft`, `border/divide-[#E5E8EB]` → `*-hairline`.<br>• Hex netral yang tidak punya padanan persis di tema gelap (`bg-[#F7F8FA]`, `bg-[#F5F6F6]`, `border-[#EBEBEB]`) sengaja dibiarkan, karena override `.dark` di `index.css` memetakannya ke warna lain.<br>• Token `accent-text`, `accent-strong`, `accent-strong-hover`, dan `surface-2` didaftarkan di `@theme` milik `src/index.css`, yaitu satu-satunya stylesheet yang menghasilkan utilitas. Nilainya didefinisikan di `:root`/`.dark` file yang sama. |
| Avatar tenant | Warna teks dipilih otomatis dari luminans latar (`readableTextOn` di `src/lib/utils.ts`). Tombol pada e-mail undangan memakai `#04803D`. |
| Kontras nyaris lolos | Amber KPI `#a16207` → `#9c5e07` (4,75:1). Ini hanya perubahan warna; hierarki tidak berubah. `#777777` → `ink-soft` (`#666666`). |
| F-02 tombol primer | *Document Structure*: hanya *New Partner* yang terisi. *New Contract* dan *New OF/SO* di header, serta tombol per baris di pohon, menjadi outline. *Input Evaluation* per baris juga menjadi outline. |
| F-03 chrome vertikal | Banner *Google setup* (beserta tombol *Connect Google*) kini hanya tampil di dashboard dan Settings. Peringatan password admin bawaan tetap tampil di semua halaman. |
| F-04 FAB chat | `main` mendapat ruang bawah (`pb-24`/`pb-28`) saat asisten AI aktif. |
| F-05 empty state | `TableEmptyState` bersama sekarang memakai i18n (`common.no_data`) dan ikon. Pesannya *sticky* sehingga tetap terlihat saat tabel lebar digeser. *My Documents* menampilkan CTA *New Document*, dan pagination disembunyikan saat data kosong. |
| F-06 i18n notifikasi | Server menyimpan `pesan_params` (`kind`, `daysRemaining`, `noticeType`, `noticeDays`). UI merender pesan dalam bahasa penampil lewat `src/lib/notificationText.ts`. Pengingat kontrak lama yang tidak punya parameter tetap memakai `pesan`. |
| F-07 401 | Probe sesi memakai `/api/user/my-role?probe=1`. Saat belum login, server membalas `204`. Pemanggilan tanpa `probe` tetap mendapat `401`. |
| Tipografi | `text-[8–11px]` dan `text-2xs` → `text-xs` (359 kelas, di luar `DashboardView.tsx`). Inter dihapus dari `index.html`. Angka KPI di admin dan kolom sesi memakai `tabular-nums`, bukan `font-mono`. |
| Penamaan | Menu, breadcrumb, dan judul halaman kini seragam:<br>• *Document Structure / Struktur Dokumen / 文档结构*.<br>• *My Documents / Dokumen Saya / 我的文档*.<br>• Breadcrumb admin mengikuti menu (*System Admin*, *Organization Admin*).<br>• Pemilih bahasa: `ZH`. |
| Tanggal dan copy | Notifikasi memakai `formatDateTime` (`2 Oct 2026, 03:55`). Muncul "1 session" untuk bentuk tunggal. Tanda kosong diseragamkan menjadi `—`. |
| Emoji | Badge slot editor memakai SVG berbasis geometri Lucide. Emoji di PartnerSpending diganti `Lightbulb`/`FileText`. Field `icon` emoji di data template tidak dirender di UI mana pun, jadi tidak diubah. |
| Aksesibilitas | Skip link *Lewati ke konten utama* ditambahkan sebelum sidebar dan menuju `#main-content`. Halaman login, privasi, dan ketentuan kini memakai landmark `main`. Tautan daftar isi minimal 24 px. `color-scheme` dan `accent-color` mengikuti tema, sehingga checkbox di tema gelap tidak lagi tampak sudah tercentang. |

### Tidak diubah, dengan alasan

- **Checkbox desktop 14 × 14 px.** Ukuran ini permintaan eksplisit pengguna (lihat [VISUAL-OPTIMIZATION-2026-10-03.md](VISUAL-OPTIMIZATION-2026-10-03.md), "Penyesuaian kontrol visual"). WCAG 2.5.8 tetap terpenuhi lewat pengecualian jarak.
- **Filter mobile ke *sheet*, daftar kartu untuk tabel, dan penggabungan kartu judul dengan kartu filter.** Layout mobile saat ini (grid filter dua kolom, tabel yang bisa digeser, tanpa freeze kolom pertama) disetujui pengguna di dokumen yang sama. Banner Google yang dibatasi sudah mengembalikan sekitar 70 px di setiap halaman list.
- **Hierarki dashboard.** Dikecualikan atas permintaan pengguna.

### Verifikasi

- Type-check (`tsc`) pada 72 file sumber yang berubah beserta seluruh impornya, `server.ts`, dan tes yang berubah: lulus.
  - `tsc --noEmit` untuk seluruh proyek terus terhenti oleh SIGTERM sekitar 32 detik setelah mulai di lingkungan ini, bahkan dengan `--allowJs false`. Pemeriksaan penuh belum berhasil dijalankan di sini.
- Unit test (`tests/*.test.ts`): 91/91 lulus, termasuk tes baru `tests/uiHelpers.test.ts` dan `tests/designTokens.test.ts`. Tes token juga memastikan setiap utilitas token yang dipakai sudah terdaftar di `@theme`.
- E2E fixture terhadap build produksi (`playwright.fixtures.config.ts`): 41/41 lulus. `tests/e2e/spa-query-routing.spec.ts` di server dev: 8/8 lulus. Ada tiga penyesuaian tes:
  - Label diganti mengikuti nama baru (*My Documents*, *Document Structure*).
  - Locator *New Document* memakai `.first()`, karena empty state kini juga punya CTA dengan nama yang sama.
  - Tes kontrol header memakai `reducedMotion: 'reduce'`. Tanpa itu, perbandingan warna `select` di tema gelap bisa mengambil nilai di tengah transisi `transition-colors`.
- Audit screenshot ulang, 74 tampilan:
  - 0 overflow horizontal dan 0 redirect yang salah.
  - Teks di bawah 12 px turun dari 159 menjadi 48 temuan. Ke-48 temuan itu adalah sub-teks kartu KPI dashboard, yang dikecualikan.
  - Target di bawah 24 px turun dari 274 menjadi 106. Sisanya checkbox desktop 14 px.
  - Kegagalan kontras yang nyata hilang. Sisa temuan kontras adalah false positive pada latar gradien.
- Perubahan `server.ts` (`204` untuk probe, `pesan_params`) baru aktif setelah server dev di-restart. Server yang sedang berjalan di terminal pengguna tidak dihentikan, sehingga audit ulang masih mencatat 401 di halaman publik.
