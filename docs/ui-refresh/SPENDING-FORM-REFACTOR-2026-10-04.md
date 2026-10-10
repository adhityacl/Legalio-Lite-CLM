# Refactor form Partner Spending

Perubahan mengikuti `spending-form-refactor-prompt.md` dan referensi visual `spending-form-uiux-pro-max-v3.html`. Implementasi React tetap menjadi sumber perilaku produksi. JavaScript demo pada HTML tidak dipindahkan ke aplikasi.

## 1. File yang berubah

- `src/components/PartnerSpendingView.tsx`: modal, state form, hidrasi edit, upload, pemetaan AI, dan payload submit.
- `src/lib/spendingAllocations.ts`: validasi bersama frontend/backend, hidrasi legacy, pembagian nominal, pemetaan periode AI, dan normalisasi bulan pelaporan.
- `src/types.ts`: tipe `SpendingMonthAllocation` serta properti opsional `invoice_title` dan `month_allocations`.
- `server.ts`: POST/PUT spending dan schema/prompt/cache parser invoice.
- `src/i18n/extraTranslations.ts` dan `src/i18n/zh.ts`: label dan status baru dalam ID, EN, dan ZH.
- `tests/spendingAllocations.test.ts`: kasus nominal, pembulatan, bulan legacy, dan periode AI.
- `tests/spendingApi.test.ts`: endpoint nyata dengan SQLite dan upload lokal dalam direktori temporer.
- `tests/e2e/spending-form.spec.ts`: tujuh uji browser form.
- `playwright.fixtures.config.ts`: menyertakan uji form baru dalam suite fixture.
- Laporan ini.

Perubahan lokal yang sudah ada sebelum pekerjaan dipertahankan. Tabel, filter, CSV, pelaporan, izin, dan RBAC tidak direfactor.

## 2. UI

Modal putih menggunakan panel abu-abu netral untuk Partner Details dan Bank Account Information, berdampingan pada desktop. Invoice Date, Currency, dan Total Amount berada dalam grid metadata. Konversi USD tampil di bawah nominal. Alokasi bulan menampilkan baris bulan dan nominal dengan Add Month, Split Equally, dan tombol hapus berlabel aksesibel. Invoice Description berada tepat setelah alokasi. Documents berisi satu uploader invoice dengan aksi AI serta satu uploader billing.

Layout menumpuk pada mobile. Modal Radix yang tersedia tetap menangani fokus, Escape, dan pengembalian fokus. Label, ring fokus, status inline, tampilan tombol Save nonaktif, dark mode, dan terjemahan dipertahankan.

## 3. State dan model

`formInvoiceTitle` terpisah dari `formInvoiceDesc`. State `monthAllocations` menyimpan bulan `YYYY-MM` dan nominal, dengan string kosong hanya untuk nilai form yang belum dikonfirmasi. State month tag lama dan `monthInput` dihapus dari modal. State file tetap `invoiceFileObj` dan `billingFileObj`.

Pemilihan partner mempertahankan hubungan ID/nama. Informasi bank yang tersedia dari spending partner sebelumnya dapat mengisi form. Nilai yang diedit manual dilindungi saat pilihan partner berubah.

## 4. API

Endpoint tetap `POST /api/partner-spendings` dan `PUT /api/partner-spendings/:id`. Payload diperluas dengan `invoice_title` dan `month_allocations`. `invoice_month` diturunkan dari alokasi dan dinormalisasi menjadi tanggal akhir bulan melalui utilitas yang tersedia.

Backend memvalidasi alokasi sebelum penyimpanan/upload. PUT pada record yang sudah memiliki alokasi juga memvalidasi total baru ketika alokasi tidak dikirim ulang, sehingga perubahan total tidak dapat melewati validasi. URL/nama attachment lama tetap dipertahankan ketika file pengganti tidak dikirim.

## 5. Database/schema

Spending disimpan sebagai objek JSON melalui `saveDb()` dan kolom SQLite `spendings.payload`. Properti baru ikut disimpan dalam payload tersebut. Tidak diperlukan ALTER TABLE atau migrasi SQL. Uji endpoint memeriksa title dan alokasi yang tersimpan langsung di SQLite temporer.

## 6. Kompatibilitas lama

Record tanpa `month_allocations` dimuat dari `invoice_month`, termasuk format legacy dan beberapa bulan dalam satu string. Nominal alokasi dibiarkan kosong untuk konfirmasi manual atau tindakan Split Equally oleh pengguna. Membuka atau membatalkan edit tidak mengubah record historis.

Klien API lama yang tidak mengirim alokasi tetap didukung untuk record legacy. Form baru selalu mengirim alokasi tervalidasi. Representasi `invoice_month` tetap tersedia bagi filter, sorting, ekspor, dan laporan yang sudah ada.

## 7. Parser AI

Parser `/api/spendings/parse` menambahkan `invoice_title`, `spending_months`, dan `month_allocations`. Prompt meminta semua bulan pada periode layanan/billing yang tercetak, termasuk ekspansi rentang bulan. Nominal bulanan hanya diminta apabila tercetak secara eksplisit.

Fallback bulan dari tanggal invoice dihapus. Form tidak menggunakan `invoice_date` atau field `invoice_month` lama untuk membuat alokasi AI. Tanpa periode eksplisit, alokasi dikosongkan untuk input manual. Scope cache parser diberi versi baru agar hasil lama yang memakai fallback tanggal tidak digunakan kembali. File invoice yang diparsing tetap file attachment yang dikirim saat Save.

## 8. Validasi

Save diblokir untuk total tidak valid/negatif, alokasi kosong, bulan tidak valid/duplikat, nominal kosong/negatif/tidak finite, dan selisih total di luar toleransi `0.000001`. Status menampilkan kecocokan, sisa, atau kelebihan alokasi. Pembagian rata memakai minor unit mata uang yang tersedia dan menaruh residu pembulatan pada baris terakhir.

Batas upload tetap 20 MB. Pembacaan file dan parsing memiliki state loading. Form tidak dapat disubmit atau ditutup selama operasi aktif. Kegagalan parse/save mempertahankan data dan attachment untuk percobaan ulang.

## 9. Pemeriksaan

- `npm run build`: lulus, frontend dan backend.
- `npm test`: 98 test lulus, termasuk endpoint nyata pada database temporer.
- Uji Playwright form pada preview produksi: tujuh test lulus. API browser menggunakan fixture; database aplikasi tidak dibuka oleh uji browser.
- Typecheck terarah menggunakan `tsc --noEmit -p /tmp/spending-typecheck.config.json`: lulus. Konfigurasi memperluas tsconfig proyek, mematikan `allowJs`, dan mencakup seluruh file berubah, `server.ts`, serta seluruh impor transitifnya.
- `git diff --check`: lulus.
- Screenshot desktop terang dan mobile gelap ditinjau. Uji mobile 375 px memastikan kontrol tidak keluar dari modal.

`npm run lint` adalah typecheck seluruh proyek dengan JavaScript turut disertakan. Percobaan penuh terhenti dengan SIGTERM; percobaan heap kecil mengalami kehabisan memori. Kendala ini juga sudah tercatat dalam audit repo sebelumnya. Lint penuh tidak dinyatakan lulus.

Uji browser dapat diulang dengan `npx playwright test --config playwright.fixtures.config.ts spending-form.spec.ts --workers=1`. Ekstraksi Gemini langsung tidak dipanggil; uji AI memverifikasi integrasi melalui respons fixture, bukan akurasi model pada invoice nyata.

## 10. File backend/schema yang hilang

Tidak ada file backend atau schema wajib yang hilang. Semua perubahan API, model, dan penyimpanan yang diperlukan telah dilakukan.

## 11. Add dan Edit

Add Spending berhasil mengirim title, description, ID partner, alokasi tepat, konversi USD, dan attachment invoice yang sama dengan file parsing. Edit Spending berhasil untuk record legacy maupun record baru, termasuk penyimpanan ulang, pembukaan kembali, dan preservasi kedua attachment. POST/PUT nyata juga lulus pada backend dengan SQLite temporer.

Backend yang berjalan tanpa watch perlu direstart untuk memuat perubahan API dan parser.
