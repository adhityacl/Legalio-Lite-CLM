# Hasil optimasi visual — 3 Oktober 2026

## Perubahan

Optimasi mengikuti temuan audit visual sebelumnya dan mempertahankan alur bisnis yang ada. Panduan frontend patterns, frontend accessibility, dan frontend design direction digunakan untuk menyatukan perilaku dialog, menjaga hierarki informasi, dan memperbaiki penggunaan pada layar kecil.

- Semua 12 dialog administrasi menggunakan komponen modal bersama. Dialog memiliki judul aksesibel, focus trap, penutupan dengan Escape, dan pemulihan fokus ke pemicu. Dialog detail, upload, redlining, amendment, pengaturan, dan editor teks juga menggunakan pola yang sama.
- Label form terhubung ke field. Pencarian, filter, pagination, checkbox notifikasi, tombol ikon, dan ekspansi pohon memiliki nama aksesibel. Switch SMTP menggunakan kontrol semantik.
- Header mobile menampilkan judul pada baris tersendiri tanpa pemotongan. Navigasi tab administrasi dapat membungkus ke baris berikutnya.
- Banner konfigurasi Google menjadi disclosure ringkas. Peringatan password administrator bawaan tetap ditampilkan penuh.
- Kontrol mendapat batas ukuran minimum 24 px; tombol dan sebagian besar field mobile memiliki tinggi minimum 44 px.
- Kolom aksi tabel partner, kontrak, service order, dan spending tetap terlihat saat tabel digeser horizontal pada mobile.
- Heading komponen mengikuti hierarki halaman. Tombol submit administrasi menggunakan token warna utama; aksi destruktif mempertahankan warna berbeda.
- Field organisasi yang semula dua kolom menjadi satu kolom pada mobile. Modal dapat digulir dan footer form administrasi tetap mudah dijangkau.
- Label baru tersedia pada katalog ID, EN, dan ZH.

## Verifikasi

- TypeScript (`npm run lint`): lulus.
- Tes aplikasi (`npm test`): 83 lulus, tidak ada kegagalan.
- Tes katalog bahasa setelah penambahan label: 4 lulus.
- Suite browser fixture: 25 lulus, tanpa skipped atau flaky test. Termasuk dua tes baru untuk fokus, label, Escape, dan ukuran dialog administrasi serta editor teks.
- Empat tes aksesibilitas browser dijalankan ulang pada build terakhir dan seluruhnya lulus.
- Build frontend: berhasil. Peringatan ukuran chunk JavaScript masih ada; optimasi bundling tidak termasuk perubahan visual ini.
- Pemeriksaan halaman superuser: 23 tampilan, masing-masing desktop 1440 × 1000 dan mobile 390 × 844. Tidak ditemukan overflow horizontal halaman atau target kontrol berukuran di bawah 24 px oleh pemindai geometri.
- Halaman publik: login, registrasi, privasi, dan ketentuan pada kedua viewport; tidak ditemukan field tanpa label atau overflow horizontal halaman.
- Tenant admin: halaman pengguna, departemen, dan undangan, serta enam state dialog pada kedua viewport. Seluruh 12 jenis dialog administrasi dibuka dalam verifikasi gabungan superuser dan tenant; fokus berada di dalam dialog dan field memiliki label.
- Cakupan screenshot akhir: 30 tampilan unik pada dua viewport, ditambah 78 state interaktif, menghasilkan 138 screenshot. Semua skenario akhir berhasil, tanpa overflow horizontal halaman atau field tanpa label yang ditemukan oleh pemindai. Tabel lebar tetap menggunakan scroll internal, bukan dipaksa memuat seluruh kolom sekaligus.
- Tes dialog administrasi juga memeriksa viewport 320 px.

Screenshot dan hasil pengukuran dibuat pada server audit terisolasi, tersimpan di `/tmp/legalio-ui-optimized`. Data aplikasi utama tidak digunakan untuk membuat akun audit, tidak direset, dan tidak diubah oleh verifikasi ini.

Contoh hasil:

- [Tabel kontrak mobile](/tmp/legalio-ui-optimized/mobile/contracts.png)
- [Form organisasi mobile](/tmp/legalio-ui-optimized/mobile-states/admin-create-organization.png)
- [Editor teks mobile](/tmp/legalio-ui-optimized/mobile-states/settings-ui-text-editor.png)
- [Edit departemen mobile](/tmp/legalio-ui-optimized/mobile-tenant/tenant-edit-department.png)

Beberapa sesi screenshot menggunakan headless-shell sempat terhenti. Skenario tersebut diulang dalam batch singkat dan dengan Chromium lokal lengkap; jumlah cakupan di atas hanya menghitung hasil akhir yang berhasil.

## Batasan

Verifikasi visual menggunakan bahasa Inggris, tema terang, dan reduced motion. Ini bukan sertifikasi WCAG menyeluruh atau bukti bahwa setiap variasi data, tema, bahasa, dan integrasi eksternal sudah diuji. Peringatan bundle dan respons API 401 yang tercatat dalam audit sebelumnya tidak dinyatakan selesai oleh pekerjaan visual ini. Tidak ada deploy, commit, atau push yang dilakukan.

Catatan koreksi audit: switcher workspace mobile sudah tersedia melalui drawer navigasi. Fitur tersebut diverifikasi, bukan ditambahkan sebagai fitur baru.

## Tindak lanjut regresi New Document

Pengujian pada server development mereproduksi error `Duplicate use of selection JSON ID cell` ketika New Document dibuka. Tes produksi sebelumnya tidak menemukan masalah ini. Registrasi seleksi tabel ProseMirror dievaluasi dua kali; workspace audit menggunakan symlink `node_modules`, sehingga cache optimizer Vite tidak terisolasi dari server utama.

Cache Vite sekarang berada di `.vite` milik masing-masing workspace. Entry tabel dan menu editor dioptimalkan bersama sejak awal. Plugin React tidak mentransformasi ulang hasil optimizer. Tidak ada reset session, penghapusan dokumen, atau perubahan data pengguna yang diperlukan.

Tombol New Document memiliki tinggi eksplisit 36 px pada desktop dan minimum 44 px pada mobile, serta pembungkus label yang konsisten dengan tombol Add Contract. Tes membandingkan tinggi, radius, ukuran dan ketebalan font, warna latar, serta warna teks pada desktop/mobile dan tema terang/gelap.

Tes regresi baru membuka dokumen baru, mengetik, memasukkan tabel, menyimpan melalui API fixture, dan membuka ulang dokumen. Konfigurasi `playwright.fixtures.dev.config.ts` menambahkan verifikasi development agar pengujian tidak hanya mencakup preview produksi. Semua API dalam tes ini dimock; data pengguna tidak disentuh.

Hasil tindak lanjut: tiga tes regresi lulus di development dan tiga tes yang sama lulus pada preview produksi. Build frontend berhasil. Pemeriksaan seluruh source TypeScript dengan `tsc --noEmit --allowJs false` lulus. Pemeriksaan lint penuh, yang juga mencakup JavaScript, terhenti karena kendala memori; percobaan dengan heap 1 GB dan 2 GB menghasilkan JavaScript heap out of memory. Status lint lulus pada bagian verifikasi sebelumnya merujuk ke pekerjaan optimasi awal, bukan pemeriksaan ulang regresi ini.

## Penyesuaian kontrol visual berdasarkan masukan pengguna

- Kontrol utama header memakai ukuran 44 × 44 px dan ikon SVG 18 × 18 px. Grup bahasa memiliki tinggi luar 44 px; tombol bahasa menyesuaikan ruang di dalam grup. Tinggi ditetapkan eksplisit supaya aturan minimum global tidak membuat kontrol terpipihkan.
- Checkbox desktop dibatasi tepat 14 × 14 px, termasuk batas minimum dan maksimum. Checkbox tersembunyi untuk kontrol lain tidak diubah. Ukuran mobile dipertahankan.
- Dropdown native menggunakan satu aturan tampilan yang mengikuti filter tabel Contracts: tinggi desktop 36 px, radius 12 px, border, warna, font, padding, dan satu panah segitiga yang sama. Mobile memakai tinggi 44 px. Lebar, nilai, event, opsi, dan navigasi keyboard tetap mengikuti komponen pemiliknya. Ikon panah tambahan pada Select dan pagination dihapus agar tidak muncul dua panah.
- Pemicu submenu Partners, administrasi, dan Settings tidak lagi menampilkan kotak latar saat hover. Indikator fokus keyboard dan highlight item navigasi aktif dipertahankan.

Tes regresi memeriksa ukuran header, ukuran checkbox, kesamaan dropdown halaman dan modal dalam tema terang/gelap, serta transparansi pemicu submenu saat hover.

Seluruh 28 tes browser fixture produksi lulus setelah penyesuaian ini. Screenshot desktop dan mobile pada tema gelap diperiksa secara visual. Checkbox 14 px merupakan perubahan ukuran visual desktop yang diminta pengguna; laporan target minimum 24 px pada audit awal tidak lagi berlaku untuk ukuran visual checkbox desktop.

## Perbaikan khusus mobile

Perubahan berikut dibatasi oleh media query di bawah 768 px. Layout dan ukuran desktop tidak diubah.

- Dropdown bahasa diberi lebar 72 px dan ruang panah terpisah agar label EN tidak tertutup.
- Breadcrumb/judul navigasi header disembunyikan secara visual. Heading halaman tetap tersedia untuk pembaca layar.
- Tombol Export CSV dan Add Contract memakai dua kolom sama lebar. Jika hanya satu aksi tersedia, tombol memakai lebar penuh.
- Search Contracts memakai satu baris penuh; tiga filter dan tombol View memakai grid dua kolom yang rata.
- Teks bantuan scroll di atas tabel disembunyikan pada mobile, tanpa menambahkan teks pengganti.
- Freeze kolom identitas pertama pada tabel mobile dihapus. Tabel tetap dapat digeser horizontal; kolom aksi kanan yang sudah ada tidak termasuk permintaan penghapusan freeze kolom pertama.

Tes mobile memeriksa lebar 320, 390, dan 430 px pada tema terang/gelap, ruang label bahasa, geometri tombol/filter, tidak adanya overflow halaman, serta kolom identitas tanpa sticky positioning. Tes resize kembali ke desktop memeriksa bahwa layout desktop kembali ke baseline yang sama.

Hasil: seluruh 29 tes browser fixture produksi lulus. Screenshot Contracts mobile diperiksa secara visual, dan build frontend berhasil.

## Perluasan perbaikan mobile lintas halaman

Implementasi sebelumnya sudah memperbaiki header dan perilaku kolom tabel secara bersama, tetapi layout aksi serta search/filter baru diterapkan pada Contracts. Cakupan toolbar tersebut belum memenuhi permintaan lintas halaman. Perbaikan sekarang menggunakan kelas bersama di dalam media query di bawah 768 px; tidak mengubah aturan layout desktop.

- Toolbar aksi dan search/filter diterapkan pada Partners, Order Forms/Service Orders, Partner Spending, Partner Evaluation, Notifications, Activity Logs, Document Explorer/Create Document, Amendments, dan Explore. Dashboard memakai filter dua kolom dengan pemilih mata uang satu baris penuh.
- Explore mencakup tombol utama, pemilih mode, serta toolbar tabel Structure Audit. Import Data mencakup pemilih jenis import, tombol import/reset, dan tabel preview CSV.
- Kontrol pencarian dan aksi administrasi mencakup Users, Accounts, Sessions, Organizations, Departments, Invitations, dan API Keys. Tabel RBAC menggunakan aturan scroll mobile bersama.
- Pengaturan mencakup aksi konfigurasi AI, kamus teks UI, toolbar database SQLite, serta aksi di modal editor teks UI. Search database memakai ruang fleksibel di samping tombol Go.
- Pagination bersama menggunakan lebar penuh dan pembagian ruang yang konsisten pada mobile.
- Pembungkus tabel di area halaman dan modal memakai scroll horizontal. Dua sel awal tidak menggunakan sticky positioning pada mobile. Kolom aksi kanan tetap mengikuti perilaku yang sudah ada. Aturan ini tidak mengubah tata letak tabel konten editor ProseMirror.
- Aksi dan filter memakai kolom sama lebar; kontrol terakhir yang tidak memiliki pasangan memakai satu baris penuh. Search memakai satu baris penuh. Label khusus pembaca layar tetap tersembunyi dan tidak diubah menjadi sel grid berukuran penuh.

Pengujian tambahan memeriksa dashboard dan sembilan modul bisnis/dokumen, delapan tab System Admin, enam halaman Settings, modal teks UI, tabel database berisi fixture, serta preview CSV tanpa mengirim import. Pemeriksaan dilakukan pada lebar 320, 390, dan 430 px. Modul bisnis/dokumen diuji dalam tema terang dan gelap; layout toolbar desktop dibandingkan lagi setelah resize. Pengujian ini bukan bukti bahwa setiap kombinasi data, bahasa, izin, dan keadaan modal sudah diuji. Semua API dimock dan database pengguna tidak disentuh.

Hasil akhir browser: seluruh 41 tes fixture produksi lulus dan build frontend berhasil. Lima tes tambahan yang menyasar layout terakhir juga lulus pada server development. Screenshot admin Users, modal teks UI, tabel audit Explore, dan Import Data diperiksa secara visual. Peringatan ukuran chunk build yang sudah ada masih muncul; pekerjaan ini tidak mencakup optimasi bundle.

Pemeriksaan source TypeScript awal pada pekerjaan ini lulus. Pemeriksaan ulang setelah perubahan terakhir tidak selesai: proses dengan heap 4 GB dihentikan dengan SIGTERM, lalu percobaan heap 2 GB menghasilkan JavaScript heap out of memory. Karena itu, pemeriksaan TypeScript akhir tidak dinyatakan lulus. `git diff --check` lulus.
