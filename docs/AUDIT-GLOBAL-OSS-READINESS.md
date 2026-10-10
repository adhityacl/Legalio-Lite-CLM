# Audit Kesiapan Global & Open-Source — Legalio CLM

**Tanggal audit:** 2026-09-24
**Acuan:** [PRODUCT-REQUIREMENTS-GLOBAL-OSS.md](PRODUCT-REQUIREMENTS-GLOBAL-OSS.md)
**Cakupan:** `server.ts`, `server/`, `src/` (UI, lib, context, data seed), konfigurasi root, dan `docs/`.
**Sifat dokumen:** Inventori asumsi lokal (PRD §7 Phase 1, deliverable #1) dan pemeriksaan terhadap Generalization Gate (PRD §6.1). Belum ada kode yang diubah.

---

## 1. Ringkasan Eksekutif

**Verdict: belum siap untuk dirilis sebagai open-source dan belum dapat dipakai organisasi di luar Indonesia/fintech tanpa fork.**

Aplikasi ini saat ini adalah sistem internal untuk satu perusahaan tertentu (Adapundi / PT Info Tekno Siaga). Asumsinya tidak hanya ada di data seed, tetapi juga tertanam di model data, logika server, prompt AI, template kontrak, dan pemeriksaan hak akses.

| Indikator | Jumlah |
|---|---:|
| Referensi ID tenant hardcoded `org-adapundi` | 110 |
| Fallback mata uang `IDR` di kode | 86 |
| Kurs IDR→USD hardcoded (`62e-6` / `0.000062`) | 27 |
| Format hardcoded `id-ID` untuk angka/tanggal | 37 |
| Literal status berbahasa Indonesia dalam logika (`Aktif`, `Lengkap`, dst.) | 89 |
| Referensi Gemini di server | 38 |
| Referensi Google Drive/Sheets di server | 269 |

Status Generalization Gate PRD §6.1: **0 dari 5 kriteria terpenuhi** (detail di §4).

Ada **empat temuan keamanan/privasi yang harus ditutup sebelum repository dibuat publik**, terlepas dari pekerjaan generalisasi (§2).

---

## 2. Pemblokir Rilis (P0) — Keamanan dan Data

Temuan ini tidak terkait lokalisasi, tetapi melanggar PRD §3.4.1, §5.1, §6.3, dan §7 Phase 3 deliverable #1. Semuanya akan terekspos begitu kode dipublikasikan.

| # | Temuan | Bukti | Dampak |
|---|---|---|---|
| P0-1 | Email pribadi `adhitcl@gmail.com` otomatis diberi hak admin di `checkIsAdmin`. Fungsi ini menjaga reset password, kelola user, konfigurasi Google, dan SMTP. | [server.ts:2560](../server.ts#L2560) | Di deployment mana pun yang membuka sign-up, siapa pun yang mendaftar dengan email itu menjadi admin. Middleware sesi global mengurangi risiko serangan anonim, tetapi tidak menghapus backdoor identitas ini. |
| P0-2 | `/api/chat` dikecualikan dari autentikasi dan mengirim **seluruh** partner, kontrak, dan IO dari **semua tenant** ke Gemini, termasuk telepon, alamat, dan nomor dokumen (NPWP/KTP). | [server.ts:103](../server.ts#L103), [server.ts:7925](../server.ts#L7925) | Kebocoran data lintas tenant tanpa login. Melanggar PRD §3.4.1 (isolasi AI context) dan §5.1 (redaksi PII dari prompt AI). |
| P0-3 | Folder `uploads/` disajikan statis tanpa pemeriksaan sesi. Path mudah ditebak: `/uploads/<nama org>/<nama vendor>/Folder DD/<file>`. | [server.ts:632](../server.ts#L632), [server.ts:641](../server.ts#L641) | Dokumen due diligence (KTP, NPWP, akta) dapat diunduh publik. |
| P0-4 | Rute tanpa autentikasi dan tanpa scope tenant: `/api/templates` (baca/tulis/hapus), `GET /api/contracts/:id/redline-analysis`, semua `/parse`, `/api/partners/generate-dd-notes`, `/api/export-csv`, `/api/audit-logs`. | [server.ts:96-111](../server.ts#L96-L111), [server.ts:4852](../server.ts#L4852), [server.ts:4681](../server.ts#L4681) | Pengguna anonim dapat menghapus template, membaca hasil analisis kontrak, dan memakai kuota AI. |
| P0-5 | Data pribadi dan identitas cloud nyata ada di repo: email karyawan `@adapundi.com` dan email pribadi di `docs/rbac/qc/*`, `src/data/initialData.ts`, dan placeholder UI. Ada juga ID Google Drive/Sheets produksi dan konfigurasi Firebase project `safeforwork-47`. | [server.ts:1076](../server.ts#L1076), [server.ts:1100-1101](../server.ts#L1100-L1101), [firebase-applet-config.json](../firebase-applet-config.json), [AdminModals.tsx:200](../src/components/admin/AdminModals.tsx#L200) | Melanggar PRD Phase 3 #1 ("no secret, no production data"). Riwayat Git juga perlu dibersihkan, bukan hanya HEAD. |
| P0-6 | Nama user dan email di-rewrite saat startup berdasarkan string "Adhitia"/"adhit". Fallback bootstrap memakai nama "Aditya Pratama". | [server.ts:1771-1810](../server.ts#L1771-L1810), [server.ts:7081-7082](../server.ts#L7081-L7082) | Logika spesifik orang tertentu di core. |

---

## 3. Inventori Asumsi Lokal per Area

Prioritas: **P1** memblokir penggunaan non-Indonesia. **P2** membuat hasil salah atau janggal untuk tenant global. **P3** kosmetik atau cukup dipindah ke policy pack.

### 3.1 Identitas deployment dan branding

| Temuan | Bukti | Target PRD | Prio |
|---|---|---|---|
| Tenant default "Adapundi", `legalEntity: "PT"`, `currency: "IDR"`, warna merek, dan folder Drive produksi ditanam sebagai konstanta. | [server.ts:1057-1080](../server.ts#L1057-L1080), [server.ts:6967-6973](../server.ts#L6967-L6973) | §3.1 `Tenant` generik, dibuat lewat setup wizard | P1 |
| `org-adapundi` dipakai sebagai fallback tenant di 110 tempat, termasuk keputusan otorisasi dan `isDefault`. | [server.ts:436](../server.ts#L436), [server.ts:921-925](../server.ts#L921-L925), [server.ts:7610-7645](../server.ts#L7610-L7645) | §3.4.1 tenant scope tidak boleh implisit | P1 |
| Nama folder fallback "PT Info Tekno Siaga". Footer "© 2026 PT Info Tekno Siaga (Adapundi)". | [server.ts:641](../server.ts#L641), [server.ts:1061](../server.ts#L1061) | Branding sebagai konfigurasi tenant | P1 |
| Email notifikasi default `@perusahaan.co.id`. | [server.ts:1105-1108](../server.ts#L1105-L1108) | Kosong secara default | P3 |
| `<html lang="id">` dan `metadata.json` berbahasa Indonesia. | [index.html:2](../index.html#L2), [metadata.json](../metadata.json) | §5.8 locale runtime | P3 |

### 3.2 Model data domain

| Temuan | Bukti | Target PRD | Prio |
|---|---|---|---|
| Nama field dan tipe memakai bahasa Indonesia: `nama_partner`, `nilai_kontrak`, `tanggal_berakhir`, `kanal_media`, `badan_hukum`, `status_dd`, `sisa_hari`. | [src/types.ts](../src/types.ts) | §3.1 model universal berbahasa netral | P2 |
| `BadanHukum = 'BHI' \| 'BHA'` (Badan Hukum Indonesia/Asing) dijadikan dikotomi tipe entitas. Server memaksa semua nilai selain BHA menjadi BHI. | [src/types.ts:1](../src/types.ts#L1), [server.ts:1755](../server.ts#L1755) | §3.2.2 `Party` + `Identifier` dengan `issuingCountry` | P1 |
| Enum status disimpan sebagai label tampilan berbahasa Indonesia: `ContractStatus` (`Aktif`, `Akan Berakhir`), `StatusDD` (`Lengkap`, `Belum Lengkap`, `Kadaluarsa`), `DDDokumenItem.status` (`Ada`, `Belum`). | [src/types.ts:5-11](../src/types.ts#L5-L11) | §3.2.3 dan §3.3.1 state machine dengan kode stabil, label per locale | P1 |
| `jenis_notifikasi: 'Reminder H-90' \| 'H-60' \| 'H-30'` memakai notasi "H-" khas Indonesia. | [src/types.ts:163](../src/types.ts#L163) | Kode event (`contract.renewal.due`) + offset konfigurabel | P2 |
| Hanya dua tipe kontrak (`Master Agreement`, `Agreement Addendum`). | [src/types.ts:77](../src/types.ts#L77) | §3.3.1 lifecycle per NDA/MSA/SOW/DPA/lease | P1 |
| Nilai uang disimpan sebagai `number` float, dengan `*_usd` sebagai kolom turunan tanpa rate, sumber, dan timestamp. | [src/types.ts:94-95](../src/types.ts#L94-L95) | §3.3.5 minor unit + metadata konversi | P1 |
| `invoice_date` menerima format `DDMMYYYY`. `invoice_month` memakai `MMYYYY`. | [src/types.ts:225-226](../src/types.ts#L225-L226) | ISO 8601 | P2 |

### 3.3 Due diligence dan vendor onboarding

| Temuan | Bukti | Target PRD | Prio |
|---|---|---|---|
| Checklist DD standar di-hardcode: `NIB/SIUP`, `NPWP`, `Akta Pendirian`, `COR`, `DGT`, `Placement Documentation`. Dokumen lain dicocokkan dengan substring (`includes("NIB")`). | [server.ts:1524-1552](../server.ts#L1524-L1552) | §3.2.1 dynamic form + policy pack | P1 |
| Status DD dihitung dari aturan tetap "semua wajib = Ada → Lengkap". Tidak ada tahap review, remediation, atau approval. | [server.ts:1606](../server.ts#L1606), [server.ts:3125-3135](../server.ts#L3125-L3135) | §3.2.3 vendor lifecycle konfigurabel | P1 |
| Kolom export Explore memuat "Link NIB/SIUP" dan "Link Akta Pendirian". Petunjuk UI menyebut "NIB, NPWP, Akta Pendirian, KTP Direksi". | [HierarchyTreemapView.tsx:28-31](../src/components/HierarchyTreemapView.tsx#L28-L31), [LanguageContext.tsx:244](../src/context/LanguageContext.tsx#L244) | Kolom dari form schema aktif | P2 |
| Form partner hanya punya pilihan BHI/BHA dan telepon wajib dengan contoh `0811-2233-4455`, tanpa validasi E.164. | [PartnerModal.tsx:268-269](../src/components/PartnerModal.tsx#L268-L269), [PartnerModal.tsx:371-372](../src/components/PartnerModal.tsx#L371-L372), [PartnerModal.tsx:488](../src/components/PartnerModal.tsx#L488) | §2.4 E.164 dan field opsional | P1 |
| Template bulk import memakai contoh `081234567890`, `Jl. Sudirman No. 1`, dan `BHI`. | [BulkImportView.tsx:52-56](../src/components/BulkImportView.tsx#L52-L56) | Template netral dari schema | P3 |
| Tag partner default adalah `"Advertising"` bila kosong. | [server.ts:1728](../server.ts#L1728), [server.ts:1750](../server.ts#L1750) | Tanpa default kategori | P2 |
| Tidak ada model `Identifier` (scheme, negara penerbit, verifikasi). Nomor pajak/KTP disimpan sebagai `nomorDokumen` teks biasa tanpa enkripsi. | [src/types.ts:38-49](../src/types.ts#L38-L49) | §3.2.2 dan §5.1 field-level encryption | P1 |

### 3.4 Kontrak, template, dan hukum yang berlaku

| Temuan | Bukti | Target PRD | Prio |
|---|---|---|---|
| Template kerja sama bawaan mengunci hukum Republik Indonesia, PN Jakarta Selatan, UU PDP No. 27/2022, PPN/PPh, hari kerja libur nasional RI, dan meterai. Tidak ada pilihan yurisdiksi. | [cooperationAgreementTemplate.ts:279-329](../src/data/cooperationAgreementTemplate.ts#L279-L329), [:581](../src/data/cooperationAgreementTemplate.ts#L581), [:748-763](../src/data/cooperationAgreementTemplate.ts#L748-L763), [:810](../src/data/cooperationAgreementTemplate.ts#L810) | §3.3.3 clause library versioned + governing law sebagai metadata | P1 |
| Nilai default biaya "Rp 100.000.000 (Seratus Juta Rupiah) belum termasuk PPN" dan bank "PT Bank Central Asia Tbk (BCA)". | [cooperationAgreementTemplate.ts:175-185](../src/data/cooperationAgreementTemplate.ts#L175-L185) | Default kosong dari policy pack | P1 |
| Generator DOCX memakai fallback hukum Indonesia, pengesampingan Pasal 1266 KUHPerdata, dan klausul bahasa UU 24/2009 dengan versi Indonesia yang berlaku. | [docxGenerator.ts:239-250](../src/lib/docxGenerator.ts#L239-L250), [:338-343](../src/lib/docxGenerator.ts#L338-L343), [:352-371](../src/lib/docxGenerator.ts#L352-L371) | Klausul yurisdiksi sebagai modul policy pack | P1 |
| Fungsi pembangun template bernama `buildIndonesianAgreementHtml` dan menjadi default Contract Creator. Nama pihak pertama fallback `PT INFO TEKNO SIAGA`. | [ContractCreatorView.tsx:51](../src/components/ContractCreatorView.tsx#L51), [:183](../src/components/ContractCreatorView.tsx#L183), [:539](../src/components/ContractCreatorView.tsx#L539) | Template dipilih dari library tenant | P1 |
| Template disimpan global (`db.templates`), tidak per tenant, dan tanpa versi. | [server.ts:4852-4912](../server.ts#L4852-L4912) | §3.3.3 template versioned + §3.4.1 isolasi | P1 |
| Tidak ada `ContractVersion`, e-signature adapter, atau evidence package. Status approval hanya 4 nilai tetap. | [src/types.ts:11](../src/types.ts#L11) | §3.3.3–§3.3.4 | P2 (Phase 2) |
| Contoh nama file kontrak mengikuti skema internal `01A_ITS_I_2023`. | [fileNaming.ts:124-139](../src/lib/fileNaming.ts#L124-L139) | Pola nomor konfigurabel | P3 |

### 3.5 Commercial document (Insertion Order)

| Temuan | Bukti | Target PRD | Prio |
|---|---|---|---|
| IO adalah modul tingkat atas dengan field khusus periklanan: `kanal_media`, pricing `CPM/CPC/Revenue Share`, default kanal "Digital Banner & Social Media". | [src/types.ts:122-155](../src/types.ts#L122-L155), [IOModal.tsx:29](../src/components/IOModal.tsx#L29), [IOModal.tsx:106](../src/components/IOModal.tsx#L106) | §2.3 `CommercialDocument` dengan type profile; IO hanya satu profil | P1 |
| Reminder IO dikirim ke "PIC Marketing / BizDev" dan meminta "cek deliverable & penagihan". | [server.ts:2033-2034](../server.ts#L2033-L2034) | Penerima dari workflow assignee | P2 |
| Menu IO selalu tampil. Tidak ada feature flag atau pengaturan modul per tenant. | [Sidebar.tsx:151](../src/components/Sidebar.tsx#L151) | §4.3 plugin/capability yang bisa dinonaktifkan | P2 |
| Prompt parsing IO berperan sebagai "advertising and media Insertion Order analyst". | [server.ts:5434](../server.ts#L5434) | Prompt per document type | P2 |

### 3.6 Mata uang dan kurs

| Temuan | Bukti | Target PRD | Prio |
|---|---|---|---|
| Kurs IDR→USD `0.000062` di-hardcode di 27 tempat sebagai fallback konversi. | [currencyRates.ts](../src/lib/currencyRates.ts), [server.ts:3453](../server.ts#L3453), [server.ts:4997](../server.ts#L4997), [DashboardView.tsx:177](../src/components/DashboardView.tsx#L177) | §4.1 `ExchangeRateProvider` + rate, source, timestamp | P1 |
| Mata uang yang didukung dibatasi 9 kode, dengan IDR di urutan pertama sebagai default. | [currencyUtils.ts:1-11](../src/lib/currencyUtils.ts#L1-L11) | ISO 4217 penuh | P1 |
| `formatMoney` memilih `id-ID` hanya untuk IDR, `en-US` untuk lainnya, dan menentukan desimal manual (IDR/JPY = 0). | [currencyUtils.ts:13-22](../src/lib/currencyUtils.ts#L13-L22) | Locale user + minor unit ISO 4217 | P2 |
| Pilihan mata uang laporan Dashboard hanya `USD \| IDR`. Mata uang pelaporan tenant selalu USD. | [DashboardView.tsx:96](../src/components/DashboardView.tsx#L96) | Reporting currency per tenant | P1 |
| Log aktivitas menulis "senilai Rp …" dengan `id-ID` walau kontrak berdenominasi lain. | [server.ts:5163](../server.ts#L5163), [server.ts:5798](../server.ts#L5798) | Format sesuai currency asli | P2 |
| Kurs diambil dari `api.exchangerate-api.com` tanpa konfigurasi provider, dan jatuh diam-diam ke kurs hardcoded. | [currencyRates.ts](../src/lib/currencyRates.ts) | Provider adapter + status fallback yang tercatat | P2 |

### 3.7 Tanggal, zona waktu, dan reminder

| Temuan | Bukti | Target PRD | Prio |
|---|---|---|---|
| Status kontrak dihitung dengan `setHours(0,0,0,0)` pada zona waktu proses server. Tidak ada timezone tenant. | [server.ts:1874-1876](../server.ts#L1874-L1876), [server.ts:1904](../server.ts#L1904) | §3.3.5 UTC + display timezone per tenant/user | P1 |
| Ambang "Akan Berakhir" 90 hari dan titik reminder H-90/60/30/14 tertanam di kode, diulang di 6 lokasi. | [server.ts:1908-1923](../server.ts#L1908-L1923), [server.ts:5112](../server.ts#L5112), [server.ts:5340](../server.ts#L5340), [server.ts:5762](../server.ts#L5762), [server.ts:5954](../server.ts#L5954), [server.ts:8001](../server.ts#L8001) | §3.3.2 SLA/reminder konfigurabel | P1 |
| Email reminder hanya berbahasa Indonesia ("Halo Tim Legal & PIC Internal") dengan warna merek Adapundi. | [server.ts:1953-1957](../server.ts#L1953-L1957), [server.ts:2043-2047](../server.ts#L2043-L2047) | §5.8 template email per locale | P1 |
| `id-ID` di-hardcode di 37 tempat untuk format tanggal/angka, termasuk seluruh tab admin console. | `grep -rn "id-ID" src server.ts` | §5.8 locale runtime | P2 |
| Input tanggal UI memakai `DD/MM/YYYY` tetap. Nama bulan Indonesia di utilitas bulan. | [DateInput.tsx:21-40](../src/components/DateInput.tsx#L21-L40), [monthUtils.ts:17-30](../src/lib/monthUtils.ts#L17-L30) | Format dari locale | P2 |
| Tidak ada kalender hari libur, hari kerja, atau fiscal calendar. | — | §3.3.5 | P2 (Phase 2) |

### 3.8 Internasionalisasi (i18n)

| Temuan | Bukti | Target PRD | Prio |
|---|---|---|---|
| Bahasa default adalah `ID`. Hanya dua bahasa (`'ID' \| 'EN'`) sebagai union tipe, sehingga menambah locale memerlukan perubahan kode. | [LanguageContext.tsx:3](../src/context/LanguageContext.tsx#L3), [:3587](../src/context/LanguageContext.tsx#L3587) | §5.8 locale key catalog terbuka, default EN | P1 |
| Katalog 1.669 key per bahasa disimpan inline dalam satu file TSX berukuran 3.765 baris. Override disimpan di `localStorage` per browser. | [LanguageContext.tsx](../src/context/LanguageContext.tsx) | File locale terpisah (JSON) + override per tenant di server | P2 |
| Fallback `t(key, 'teks Indonesia')` membuat mode EN menampilkan bahasa Indonesia bila key hilang. | 1.363 pemanggilan `t()` | Fallback ke EN, dengan uji key yang hilang | P2 |
| Teks Indonesia masih hardcoded di luar `t()`. Terbanyak di SettingsView (±72 baris), App.tsx (±26), ContractsView (±24). | Heuristik grep | §5.8 "UI text tidak boleh hardcode" | P2 |
| Pesan error API (±33) dan deskripsi activity log (±18) di server berbahasa Indonesia. | [server.ts](../server.ts) | Kode error + pesan per locale | P2 |
| Nilai enum tersimpan adalah teks tampilan (lihat 3.2), sehingga ganti bahasa juga mengubah data. | [PartnerEvaluationView.tsx:50-62](../src/components/PartnerEvaluationView.tsx#L50-L62) | Kode stabil, label terpisah | P1 |

### 3.9 Prompt AI

Seluruh prompt Gemini ditulis untuk konteks satu perusahaan fintech Indonesia. PRD §4.1 meminta `AIProviderAdapter`, dan §5.1 meminta redaksi PII.

| Prompt | Asumsi yang tertanam | Bukti | Prio |
|---|---|---|---|
| News ticker dashboard | Regulasi Pindar/Pinjol OJK, bahasa Indonesia, Google Search grounding | [server.ts:2292-2312](../server.ts#L2292-L2312) | P1 |
| Analisis redline | Kepatuhan OJK/POJK wajib ada di checklist, hukum bisnis Indonesia | [server.ts:4747-4765](../server.ts#L4747-L4765) | P1 |
| Parsing kontrak | Pihak pertama selalu "PT Info Tekno Siaga / Adapundi". Pola nomor `xx/PKS-ITS/xx/xxxx`. Mata uang hanya IDR/USD. | [server.ts:4479-4510](../server.ts#L4479-L4510) | P1 |
| Parsing partner & DD notes | Kecualikan Adapundi, klasifikasi BHI/BHA, contoh alamat Jakarta, vendor ad-tech | [server.ts:2870-2876](../server.ts#L2870-L2876), [server.ts:2953-2955](../server.ts#L2953-L2955) | P1 |
| Parsing invoice | Nama bulan Indonesia | [server.ts:3523](../server.ts#L3523) | P2 |
| Draft kontrak | Struktur "Pihak Pertama/Kedua", PPN/PPh | [server.ts:4537-4557](../server.ts#L4537-L4557) | P1 |
| Chatbot | Jawab dalam bahasa Indonesia | [server.ts:8103](../server.ts#L8103) | P2 |

### 3.10 Integrasi dan provider

| Area | Kondisi saat ini | Target PRD | Prio |
|---|---|---|---|
| AI | `@google/genai` dipanggil langsung. Daftar model Gemini di-hardcode. Tidak ada feature flag global untuk mematikan AI. | §4.1 `AIProviderAdapter`, opt-in eksplisit | P1 |
| Storage | Disk lokal `uploads/` + Google Drive (269 referensi). Struktur folder "Folder Contract / Folder IO / Folder DD" tetap. | §6.1 local FS + S3-compatible via `DocumentStorageAdapter` | P1 |
| Identitas | Better Auth + Firebase Google Sign-In dengan konfigurasi project yang di-commit. | §3.4.3 OIDC/SAML via adapter | P2 |
| Email | `nodemailer` langsung di server, kredensial SMTP di `googleConfig`. | §4.1 `NotificationAdapter` | P2 |
| Kurs | exchangerate-api.com langsung. | §4.1 `ExchangeRateProvider` | P2 |
| Konfigurasi | `.env.example` tidak memiliki variabel locale, timezone, currency, storage driver, atau AI provider. | §5.4 environment schema terdokumentasi | P2 |

### 3.11 Organisasi, RBAC, dan tenancy

| Temuan | Bukti | Target PRD | Prio |
|---|---|---|---|
| Role tetap 5 kode (`superuser…viewer`) sebagai union tipe. Tidak ada custom role. | [server/rbac.ts:17](../server/rbac.ts#L17) | §3.4.2 preset + custom role | P2 |
| Permission katalog sudah berformat `resource.action` dan ada scope tenant/departemen. Ini fondasi yang baik. | [server/rbac.ts:84-165](../server/rbac.ts#L84-L165) | §3.4.2 | — |
| Middleware tulis memetakan semua POST/PUT/DELETE ke `document.*`, bukan permission per resource. | [server.ts:221-232](../server.ts#L221-L232) | §6.2 transition ditolak di server per permission | P2 |
| Tidak ada model `OrganizationEntity` (subsidiary/branch). Tenant dan organisasi Better Auth tercampur. | [server.ts:7595-7645](../server.ts#L7595-L7645) | §3.1, §3.4.1 | P2 |
| Tidak ada uji otomatis isolasi tenant A vs B untuk data domain (hanya uji RBAC matrix). | [tests/rbac.test.ts](../tests/rbac.test.ts) | §6.3 | P1 |

### 3.12 Evaluasi dan spending partner

| Temuan | Bukti | Target PRD | Prio |
|---|---|---|---|
| Kriteria dan bobot skor evaluasi (30/20/…) di-hardcode dan diduplikasi di dua fungsi. Nilai campuran ID/EN (`Sangat baik`, `Met`, `Very Good`). | [PartnerEvaluationView.tsx:50-62](../src/components/PartnerEvaluationView.tsx#L50-L62), [:212-220](../src/components/PartnerEvaluationView.tsx#L212-L220) | Scorecard dari form schema | P2 |
| Field rekening bank sebagai teks biasa tanpa enkripsi. | [src/types.ts:232-234](../src/types.ts#L232-L234) | §5.1 field-level encryption data bank | P1 |

### 3.13 Konten legal aplikasi

| Temuan | Bukti | Prio |
|---|---|---|
| Halaman Privacy Policy dan Terms of Service menyatakan tunduk pada hukum RI, domisili Jakarta, dan UU PDP. Isinya menggambarkan operasional internal satu perusahaan. | [TermsOfServiceView.tsx:415-428](../src/components/TermsOfServiceView.tsx#L415-L428), [PrivacyPolicyView.tsx:509-545](../src/components/PrivacyPolicyView.tsx#L509-L545) | P1 |

Untuk proyek open-source, halaman ini sebaiknya menjadi template yang diisi operator deployment, bukan teks bawaan core.

---

## 4. Status Generalization Gate (PRD §6.1)

| Kriteria | Status | Alasan |
|---|---|---|
| Tidak ada field default yang mewajibkan NIK, NPWP, NIB, IDR, atau timezone Indonesia | ❌ Gagal | Checklist DD, fallback IDR, dan timezone server (§3.3, §3.6, §3.7) |
| Validasi country/industry-specific berasal dari policy pack atau plugin | ❌ Gagal | Belum ada registry policy pack. Semua aturan ada di core. |
| Contract, party, evidence, dan workflow dapat dibuat tanpa Google, Gemini, atau e-sign | ⚠️ Sebagian | Kontrak bisa dibuat manual dengan storage lokal. Namun status sync Google aktif secara default, dan belum ada workflow engine. |
| Storage adapter local FS dan S3-compatible dapat dipilih | ❌ Gagal | Hanya disk lokal dan Google Drive, tanpa abstraksi |
| Identity local dev dapat diganti OIDC | ❌ Gagal | Belum ada adapter OIDC generik |

Kriteria §6.3 (tenant & security) juga gagal karena temuan P0-2 hingga P0-4.

---

## 5. Urutan Remediasi yang Disarankan

Urutan ini mengikuti Phase 1 PRD dan menaruh pemblokir keamanan paling depan.

1. **Tutup P0 sebelum repo dipublikasikan.** Hapus email hardcoded dari `checkIsAdmin`. Wajibkan sesi dan scope tenant di semua rute yang saat ini dikecualikan. Sajikan `uploads/` lewat endpoint yang memeriksa izin. Bersihkan PII, ID Drive/Sheets, dan konfigurasi Firebase dari kode dan riwayat Git.
2. **Pisahkan kode dari label.** Ganti enum status berbahasa Indonesia dengan kode stabil (`active`, `expiring`, `complete`) dan migrasikan data lama. Label ditampilkan lewat i18n.
3. **Buat model universal.** Tambahkan `Money` (minor unit + ISO 4217), `Identifier`, dan `Party`, lalu ganti `badan_hukum` BHI/BHA dengan `jurisdiction` + `entityType`.
4. **Buat registry policy pack dan pindahkan Indonesia ke sana.** Isinya checklist DD (NIB/NPWP/Akta/KTP), validator format, template kerja sama Indonesia, klausul hukum RI, default IDR dan Asia/Jakarta, serta prompt AI OJK. Struktur mengikuti `plugins/indonesia-fintech/` di PRD §4.2.
5. **Jadikan pengaturan tenant sebagai sumber default.** Mata uang pelaporan, timezone, locale, ambang expiry, titik reminder, dan modul aktif (IO, spending, evaluasi) dibaca dari konfigurasi tenant.
6. **Generalisasi IO menjadi `CommercialDocument`** dengan type profile. Profil "Insertion Order (advertising)" pindah ke policy pack.
7. **Pasang adapter.** Mulai dari `DocumentStorageAdapter` (local + S3), `AIProviderAdapter` dengan redaksi PII dan opt-in, `ExchangeRateProvider`, dan `NotificationAdapter`.
8. **Rapikan i18n.** Pindahkan katalog ke file JSON per locale, jadikan EN default, hapus fallback teks Indonesia di `t()`, dan tambahkan uji key hilang di CI.
9. **Tambah uji isolasi tenant** untuk kontrak, partner, IO, template, export, dan konteks AI.

Exit criteria Phase 1 PRD tetap berlaku: dua use case non-Indonesia harus berjalan tanpa fork, dan demo Indonesia harus tetap berjalan sebagai policy pack.

---

## 6. Metodologi dan Batasan

- Audit dilakukan dengan pembacaan kode statis dan pencarian pola (NPWP, NIB, NIK, OJK, IDR, `id-ID`, `org-adapundi`, literal status, nama provider).
- Temuan keamanan P0 diverifikasi dengan membaca rantai middleware di `server.ts`. Belum ada uji eksploitasi pada server yang berjalan.
- Hitungan teks hardcoded di UI adalah perkiraan heuristik, bukan hitungan pasti.
- Folder `docs/rbac/` hanya diperiksa untuk PII. Isinya tidak diaudit lebih jauh.
