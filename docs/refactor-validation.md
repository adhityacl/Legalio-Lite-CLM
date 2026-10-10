# Validasi optimisasi branch Refactor

Tanggal: 2 Oktober 2026. Dasar perubahan: `1ad11b9` pada `FE/BE-Split`.

Perubahan mengurangi pekerjaan saat membuka aplikasi, memisahkan kepemilikan data dari state UI, dan memperbaiki akses keyboard. Layout, warna, ukuran chart, kolom default, checkbox dashboard, dan pagination tetap mengikuti desain yang ada.

## Perubahan

- Data workspace dikelola langsung oleh React Query melalui `useWorkspaceData`, tanpa salinan tujuh dataset di state `App`. Cache dibatasi berdasarkan pengguna dan workspace. Permintaan yang sedang berlangsung dibatalkan sebelum update optimistis; kegagalan API memulihkan data apabila belum ada update yang lebih baru.
- Daftar dokumen dan dokumen pending review menggunakan query bersama dengan identitas workspace, pembatalan permintaan, serta invalidasi setelah dokumen disimpan. Editor direset saat berpindah workspace; penyimpanan draft yang keluar tetap memakai workspace asal.
- Editor dipindahkan ke `features/documents/ContractDocumentEditor`. Daftar dokumen tidak memuat Tiptap sampai pengguna membuka atau membuat dokumen. Chat dan empat dialog utama dimuat saat digunakan. Draft, autosave, preview, dan riwayat tetap memakai implementasi yang ada.
- Header API dipindahkan ke `lib/apiFetch` sehingga komponen tidak lagi mengimpor `App`. Interceptor dan format autentikasi tetap dipertahankan.
- Filter kontrak dimemoisasi. Pencarian partner saat sorting menggunakan Map. Activity logs diambil hanya saat halaman log dibuka dan tidak lagi menjadi state global autentikasi. Cache query dibersihkan saat logout.
- Tujuh menu View memakai satu komponen popover dari Radix yang sudah terpasang. Tab, Space, Escape, klik di luar, dan pengembalian fokus bekerja konsisten. Tombol kalender kini masuk urutan Tab.
- Sinkronisasi SQLite dipisahkan ke `server/coreDataStore`. Statement disiapkan sekali per tabel dan hanya record yang berubah atau hilang yang ditulis/dihapus. Payload, identitas record, pemisahan organisasi, constraint email, dan transaksi per tabel tetap dipertahankan. Tidak ada migrasi schema atau dependency baru.

## Hasil pengukuran

Build produksi sebelum dan sesudah memakai fixture API yang sama, browser baru, serta viewport 1440 dan 390 px. Angka berikut merupakan jumlah byte file JavaScript unik yang dimuat, bukan pengukuran waktu respons jaringan.

| Alur | Sebelum | Sesudah | Penurunan |
| --- | ---: | ---: | ---: |
| Membuka dashboard, sebelum kompresi | 1.96 MB | 1.62 MB | 17.3% |
| Membuka dashboard, estimasi gzip | 586 kB | 491 kB | 16.1% |
| Dashboard lalu daftar dokumen, kumulatif sebelum kompresi | 2.68 MB | 1.71 MB | 36.3% |
| Dashboard lalu daftar dokumen, kumulatif estimasi gzip | 799 kB | 522 kB | 34.6% |

Chat tidak lagi dimuat pada dashboard sebelum dibuka. Editor tidak lagi dimuat ketika hanya menampilkan daftar dokumen. Tidak ditemukan error JavaScript pada perbandingan tersebut. Screenshot dashboard desktop/mobile dan daftar dokumen diperiksa secara visual; susunan utama tetap sama.

Tes SQLite di memori membuktikan bahwa sinkronisasi payload yang sama menghasilkan nol write, satu edit kontrak menghasilkan satu write, dan satu penghapusan kontrak menghasilkan satu delete. Tes juga memeriksa dua organisasi, pertukaran email pengguna, serta rollback untuk ID/email duplikat.

## Verifikasi

- `npm run lint`: lolos.
- `npm test`: 83 tes lolos.
- `npm run test:e2e:fixtures`: 23 tes Chromium lolos pada build produksi. API dimock dan server preview tidak membuka database aplikasi.
- Build frontend dan bundle backend: lolos.
- `git diff --check`: lolos.

Tes browser mencakup loading komponen sesuai penggunaan, membuka dan menyimpan dokumen, kembali ke daftar, pergantian workspace, penyimpanan draft ke workspace asal, rollback ketika API dan refresh gagal, menu View di tujuh halaman, kalender, dialog form, fokus pada mobile, chart, serta preferensi reduced motion.

## Batas verifikasi

Backend diuji dengan database di memori dan tes unit yang sudah tersedia; integrasi Google, email, dan layanan AI langsung tidak dijalankan. Entry bundle masih sekitar 1.20 MB sebelum kompresi dan Vite masih memberikan warning ukuran chunk. Sinkronisasi SQLite tetap membaca seluruh payload setiap kali dipanggil; pengurangan yang dibuktikan adalah jumlah write. Pemecahan server dan provider secara menyeluruh dapat dilakukan sebagai perubahan terpisah setelah profiling tambahan.
