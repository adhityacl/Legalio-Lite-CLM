import { MAILER_TRANSLATIONS } from '../i18n/mailer';
import { TREE_TRANSLATIONS } from '../i18n/hierarchyTree';
import { BACKUP_TRANSLATIONS } from '../i18n/backups';
import { UI_REFINEMENTS } from '../i18n/uiRefinements';
import { DOCUMENT_CALENDAR_TRANSLATIONS } from '../i18n/documentCalendar';
import { CONTRACT_TERMINATION_TRANSLATIONS } from '@legalio/shared/i18n/contractTermination';
import { TENANT_BOUNDARIES_TRANSLATIONS } from '../i18n/tenantBoundaries';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { readPreference, setPreferenceUser, writePreference } from '../lib/userPreferences';
import { useOptionalIdentity } from './AuthContext';
import { EXTRA_TRANSLATIONS } from '../i18n/extraTranslations';
import { ZH_TRANSLATIONS } from '../i18n/zh';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UITextDictionary, UITextLanguage, UITextOverrides } from '@legalio/types/uiTexts';

/** UI languages. `ZH` is Simplified Chinese, shown as "CN" in the language switcher. */
export type Language = UITextLanguage;

export const LANGUAGE_OPTIONS: ReadonlyArray<{ code: Language; label: string; nativeName: string; htmlLang: string }> = [
  { code: 'ID', label: 'ID', nativeName: 'Bahasa Indonesia', htmlLang: 'id' },
  { code: 'EN', label: 'EN', nativeName: 'English', htmlLang: 'en' },
  { code: 'ZH', label: 'ZH', nativeName: '简体中文', htmlLang: 'zh-CN' },
];

const isLanguage = (value: unknown): value is Language => value === 'ID' || value === 'EN' || value === 'ZH';
const emptyCatalogs = (): Record<Language, Record<string, string>> => ({ ID: {}, EN: {}, ZH: {} });
let sharedCustomTranslations = emptyCatalogs();

export interface DocumentTerminology {
  doc: string;
  docs: string;
  docShort: string;
}

const LEGACY_TERMS: DocumentTerminology = { doc: 'Insertion Order', docs: 'Insertion Orders', docShort: 'IO' };

/**
 * Older UI strings hardcode the advertising term "Insertion Order (IO)".
 * For organizations whose industry uses another commercial document
 * (order form, purchase order, statement of work, ...), rewrite the term.
 */
function applyTerminology(text: string, terms: DocumentTerminology): string {
  let out = text
    .replace(/\{docs\}/g, terms.docs)
    .replace(/\{doc\}/g, terms.doc)
    .replace(/\{docShort\}/g, terms.docShort);
  if (terms.doc !== LEGACY_TERMS.doc) {
    out = out
      .replace(/Insertion Orders/g, terms.docs)
      .replace(/Insertion Order/g, terms.doc)
      .replace(/\bIOs\b/g, `${terms.docShort}s`)
      .replace(/\bIO\b/g, terms.docShort);
  }
  return out;
}

export interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  /**
   * Translate `key`. `{name}` placeholders are filled from `vars`; `{doc}`,
   * `{docs}` and `{docShort}` are filled with the active organization's
   * commercial-document terminology (e.g. "Purchase Order").
   */
  t: (key: string, defaultText?: string, vars?: Record<string, string | number>) => string;
  /** Set by the organization settings: the label used for commercial documents. */
  setDocumentTerminology: (terms: DocumentTerminology) => void;
  translations: Record<Language, Record<string, string>>;
  customTranslations: Record<Language, Record<string, string>>;
  exportToCSV: () => void;
  importFromCSV: (csvContent: string) => Promise<{ success: boolean; updatedCount: number; error?: string }>;
  resetCustomTranslations: () => Promise<void>;
  updateSingleTranslation: (key: string, lang: Language, value: string) => Promise<void>;
  translationsBusy: boolean;
  translationsError: string | null;
}

const baseTranslations: Record<'ID' | 'EN', Record<string, string>> = {
  ID: {
    'status.aktif': 'Aktif',
    'status.nonaktif': 'Nonaktif',
    'status.akan_berakhir': 'Akan Berakhir',
    'status.expired': 'Expired',
    'status.terminated': 'Terminated',
    'status.draft': 'Draf',
    'status.review': 'Review',
    'status.signed': 'Ditandatangani',
    'status.ada': 'Ada',
    'status.tidak_ada': 'Tidak Ada',
    'status.kadaluarsa': 'Kadaluarsa',
    // Nav & Sidebar
    'nav.main_title': 'Navigasi utama',
    'nav.doc_title': 'Navigasi dokumen',
    'nav.admin_title': 'Navigasi admin',
    'nav.dashboard': 'Dashboard',
    'nav.hierarchy': 'Explore',
    'nav.partners': 'Partner',
    'nav.partners_list': 'Daftar Partner & DD',
    'nav.partner_eval': 'Evaluasi Partner',
    'nav.partner_spending': 'Spending Partner',
    'nav.contracts': 'Kontrak',
    'nav.create_contract': 'Dokumen Saya',
    'nav.ios': 'Insertion Order',
    'nav.notifications': 'Notifikasi',
    'nav.admin_users': 'Kelola Akses Admin',
    'nav.activity_logs': 'Log Aktivitas Sesi',
    'nav.settings': 'Pengaturan',
    'nav.bulk_import': 'Impor Data',
    'nav.version': 'v2.5.0 • ACL',
    'nav.expand_menu': 'Perluas Menu',
    'nav.collapse_menu': 'Mengecilkan Navbar',

    // Header
    'header.notice_notifications': 'Notifikasi Notice Period',
    'header.no_notifications': 'Tidak ada peringatan baru',
    'header.switch_language': 'Ganti Bahasa',

    // Dashboard
    'dashboard.view_all': 'Lihat Semua',
    'dashboard.status': 'Status',
    'dashboard.action': 'Aksi',
    'dashboard.partner': 'Partner',
    'dashboard.value': 'Nilai',
    'dashboard.active_partners': 'Partner Aktif',
    'dashboard.active_contracts': 'Kontrak Aktif',
    'dashboard.expiring_contracts': 'KONTRAK TENGGANG',
    'dashboard.insertion_orders': 'Insertion Order (IO)',
    'dashboard.end_date': 'Tanggal Berakhir',
    'dashboard.remaining_time': 'Sisa Waktu',
    'dashboard.min_one_contract': 'Minimal 1 Kontrak Aktif',
    'dashboard.need_notice': 'Perlu Notice',
    'dashboard.expiring_table_title': 'Dokumen Akan Berakhir',
    'dashboard.no_expiring': 'Tidak ada kontrak atau IO yang memerlukan tindakan.',
    'dashboard.select_all_requiring_action': 'Pilih semua dokumen yang memerlukan tindakan',
    'dashboard.select_requiring_action': 'Pilih {name}',
    'dashboard.spending_title': 'Tren Spending',
    'dashboard.all_years': 'Semua Tahun',
    'dashboard.year_prefix': 'Tahun',
    'dashboard.all_categories': 'Semua Kategori',
    'dashboard.no_spending_data': 'Belum ada data spending untuk ditampilkan pada filter ini.',

    // Bulk Import
    'import.title': 'Import Data Massal (Excel / CSV)',
    'import.download_template': 'Unduh Template CSV',
    'import.upload_label': 'Unggah File CSV',
    'import.choose_file': 'Pilih File CSV',
    'import.preview_title': 'Pratinjau Data CSV',
    'import.preview_rows': 'baris data ditemukan',
    'import.start_import': 'Mulai Import',
    'import.importing': 'Mengimpor...',
    'import.result_title': 'Laporan Hasil Import',
    'import.succeeded': 'Berhasil Dibuat',
    'import.skipped': 'Dilewati (Duplikat)',
    'import.failed': 'Gagal Diimpor',
    'import.col_row': 'Baris',
    'import.col_identifier': 'Identifikasi',
    'import.col_reason': 'Keterangan',
    'import.invalid_csv': 'Format CSV tidak valid atau file kosong.',
    'import.reset': 'Reset & Mulai Lagi',
    'import.type_partner': 'Partner',
    'import.type_contract': 'Kontrak',
    'import.type_io': 'Insertion Order (IO)',
    'import.type_evaluation': 'Evaluasi Partner',
    'import.type_spending': 'Spending Partner',

    // Contracts
    'contracts.title': 'Manajemen Kontrak Komersial',
    'contracts.export_csv': 'Ekspor CSV',
    'contracts.search_placeholder': 'Cari nomor kontrak, judul, partner...',
    'contracts.all_status': 'Semua Status',
    'contracts.active': 'Aktif',
    'contracts.expiring': 'Akan Berakhir',
    'contracts.expired': 'Kadaluarsa',
    'contracts.terminated': 'Dihentikan',
    'contracts.col_no': 'No. Perjanjian',
    'contracts.col_title': 'Judul Kontrak',
    'contracts.col_doc_type': 'Jenis Perjanjian',
    'contracts.col_partner': 'Partner',
    'contracts.col_category': 'Kategori',
    'contracts.col_start_date': 'Tanggal Mulai',
    'contracts.col_end_date': 'Tanggal Selesai',
    'contracts.col_value': 'Nilai Kontrak',
    'contracts.col_status': 'Status',
    'contracts.col_document': 'Dokumen',
    'contracts.col_action': 'Aksi',
    'contracts.all_types': 'Semua Jenis Dokumen',
    'contracts.all_categories': 'Semua Kategori',
    'contracts.no_data': 'Tidak ada data kontrak yang cocok dengan filter.',
    'contracts.action_redline': 'Redlining',
    'redline.modal_title': 'Analisis Risiko & Kepatuhan Kontrak AI (AI Redlining)',
    'redline.risk_score': 'Skor Risiko Hukum',
    'redline.risk_level_low': 'Risiko Rendah (Aman)',
    'redline.risk_level_medium': 'Risiko Sedang (Perlu Penyesuaian)',
    'redline.risk_level_high': 'Risiko Tinggi (Klausul Perlu Diwaspadai)',
    'redline.risk_level_critical': 'Risiko Kritis (Wajib Negosiasi Ulang)',
    'redline.tab_clauses': 'Analisis Klausul & Redlining',
    'redline.tab_summary': 'Ringkasan & Kepatuhan',
    'redline.executive_summary': 'Ringkasan Eksekutif Legal',
    'redline.key_findings': 'Temuan Risiko Utama',
    'redline.filter_all': 'Semua Klausul',
    'redline.filter_critical': 'Kritis',
    'redline.original_issue': 'Klausul Asal / Masalah Teridentifikasi',
    'redline.recommended_redline': 'Rekomendasi Redlining (Revisi Lebih Adil)',
    'redline.copy_clause': 'Salin Revisi',
    'redline.copied': 'Tersalin!',
    'redline.copy_full_report': 'Salin Seluruh Laporan',
    'redline.reanalyze': 'Analisis Ulang',
    'redline.analyzing': 'Menganalisis Kontrak...',
    'redline.analyzing_desc': 'Google Gemini sedang membedah klausul dan menakar risiko hukum...',
    'redline.close': 'Tutup',

    // Hierarchy / Legal Document Structure View
    'hierarchy.title': 'Explore',
    'hierarchy.new_partner': 'Partner Baru',
    'hierarchy.new_contract': 'Kontrak Baru',
    'hierarchy.new_io': 'Insertion Order Baru',
    'hierarchy.tree_view': 'Tampilan Pohon',
    'hierarchy.audit_table_title': 'Tampilan Audit Lengkap',
    'hierarchy.audit_view': 'Tampilan Tabel',
    'hierarchy.view_flat': 'Tampilan: Flat (Dapat Diurutkan)',
    'hierarchy.view_grouped': 'Tampilan: Baris Terkelompok',
    'hierarchy.custom_columns': 'Kustomisasi Kolom',
    'hierarchy.custom_columns_title': 'Pengaturan Kolom',
    'hierarchy.reset': 'Reset',
    'hierarchy.select_all': 'Pilih Semua / Kosongkan',
    'hierarchy.export_csv': 'Ekspor CSV',
    'hierarchy.months': 'Bulan',
    'hierarchy.search_placeholder': 'Cari partner, nomor kontrak, atau IO...',
    'hierarchy.no_data': 'Tidak ada data partner/kontrak ditemukan',
    'hierarchy.search_hint': 'Coba sesuaikan kata kunci pencarian Anda.',
    'hierarchy.detail_legal': 'Detail Legal',
    'hierarchy.kontrak_induk_short': 'Kontrak Baru',
    'hierarchy.dd_verification_title': 'Verifikasi Dokumen Legal Due Diligence (Level 1 Checklist):',
    'hierarchy.contracts_linked': 'Kontrak Terhubung',
    'hierarchy.no_document': 'Tidak Ada Dokumen',
    'hierarchy.standard_dd_docs_hint': 'Dokumen standar: NIB, NPWP, Akta Pendirian, KTP Direksi (Belum dikonfigurasi).',
    'hierarchy.no_master_contract_for_partner': 'Belum ada Kontrak Induk terdaftar untuk Partner',
    'hierarchy.commercial_contract_hint': 'Setiap kerjasama komersial membutuhkan kontrak induk sebelum rincian IO.',
    'hierarchy.create_new_master_contract': 'Buat Kontrak Induk Baru',
    'hierarchy.master_agreement_badge': 'KONTRAK INDUK (MASTER AGREEMENT)',
    'hierarchy.agreement_addendum_badge': 'ADDENDUM PERJANJIAN',
    'hierarchy.edit_btn': 'Edit',
    'hierarchy.insertion_order_badge': 'INSERTION ORDER (IO)',
    'hierarchy.commercial_value': 'Nilai Komersial:',
    'hierarchy.validity_period': 'Masa Berlaku:',
    'hierarchy.notice_period': 'Notice Period:',
    'hierarchy.executions_detail': 'Rincian Executions (IOs):',
    'hierarchy.executions_count': 'Eksekusi',
    'hierarchy.contract_notes': 'Catatan Kontrak / Internal Notes',
    'hierarchy.io_notes': 'Catatan Deliverables / Scope IO',
    'hierarchy.pricing_model': 'Model Biaya (Pricing Model):',
    'hierarchy.charging_type': 'Skema Penagihan (Charging Type):',
    'hierarchy.no_io_connected': 'Belum ada Insertion Order terhubung ke Kontrak ini.',
    'hierarchy.add_new_io': 'Tambah IO Baru',
    'hierarchy.download_doc': 'Unduh Dokumen',
    'hierarchy.download_contract_doc': 'Unduh Dokumen Kontrak',
    'hierarchy.download_io_doc': 'Unduh Dokumen Insertion Order',

    // IO View
    'io.title': 'Manajemen Insertion Order',
    'io.add_btn': 'Tambah',
    'io.export_csv': 'Ekspor CSV',
    'io.search_ph': 'Cari insertion orders...',
    'io.all_status': 'Semua Status',
    'io.status_berjalan': 'Berjalan',
    'io.status_selesai': 'Selesai',
    'io.status_draft': 'Draf',
    'io.status_dibatalkan': 'Dibatalkan',
    'io.all_pricing_models': 'Semua Model Pricing',
    'io.all_charging_types': 'Semua Skema Pembayaran',
    'io.view': 'Tampilan',
    'io.toggle_columns': 'Toggle Kolom',
    'io.view_settings': 'Pengaturan Tampilan Kolom',
    'io.empty_filter_match': 'Tidak ada Insertion Order yang cocok dengan filter pencarian.',
    'io.col_no': 'No. IO',
    'io.col_title': 'Judul IO',
    'io.col_partner': 'Partner',
    'io.col_channel': 'Kanal Media',
    'io.col_pricing_model': 'Model Pembayaran',
    'io.col_charging_type': 'Skema Pembayaran',
    'io.col_start_date': 'Tgl Mulai',
    'io.col_end_date': 'Tgl Selesai',
    'io.col_status': 'Status',
    'io.col_value': 'Nilai Order',
    'io.col_action': 'Aksi',
    'io.col_document': 'File PDF',
    'io.action_detail': 'Detail',
    'io.action_edit': 'Edit',
    'io.action_delete': 'Hapus',
    'io.detail_partner_label': 'Partner / Vendor:',
    'io.detail_channel_label': 'Kanal Media Placement:',
    'io.detail_total_value_label': 'Nilai Total IO:',
    'io.detail_pricing_scheme_label': 'Model Pembayaran & Skema:',
    'io.detail_deliverables_label': 'Deliverables & Lingkup Pekerjaan',
    'io.detail_no_deliverables': 'Tidak ada catatan deliverables khusus.',
    'io.detail_open_drive': 'Buka Berkas IO di Google Drive',
    'io.detail_close': 'Tutup Detail',

    // Partners View
    'partners.header_title': 'Manajemen Partner',
    'partners.search_placeholder': 'Cari nama partner, PIC, jenis partner...',
    'partners.all_status': 'Semua Status Partner',
    'partners.active': 'Partner Aktif',
    'partners.inactive': 'Partner Nonaktif',
    'partners.all_dd_status': 'Semua Status Audit Due Diligence',
    'partners.dd_complete': 'DD Lengkap Terverifikasi',
    'partners.dd_incomplete': 'DD Belum Lengkap',
    'partners.dd_expired': 'DD Kadaluarsa',
    'partners.all_legal_entity': 'Semua Badan Hukum (BHI & BHA)',
    'partners.table_view': 'Tabel',
    'partners.col_name': 'Nama Partner',
    'partners.col_channel': 'Nama Channel',
    'partners.col_category': 'Kategori Kerjasama',
    'partners.col_email': 'Email',
    'partners.col_phone': 'Telepon',
    'partners.col_status': 'Status Partner',
    'partners.col_pic': 'PIC & Kontak',
    'partners.col_dd_status': 'Status Audit DD',
    'partners.col_action': 'Aksi',
    'partners.no_data': 'Tidak ditemukan data partner yang sesuai dengan pencarian/filter.',
    'partners.req_docs_title': 'Daftar Persyaratan Dokumen Legalitas:',
    'partners.audit_done': 'Selesai Audit',
    'partners.view_file': 'Lihat File',
    'partners.upload_file': 'Unggah File',
    'partners.upload_dd_modal_title': 'Upload Dokumen Due Diligence',
    'partners.expiry_date_label': 'Tanggal Kadaluarsa (Opsional)',
    'partners.drag_file': 'Pilih atau drag file dokumen ke sini',
    'partners.uploading_to_drive': 'Mengunggah ke Folder DD Google Drive...',
    'partners.upload_to_drive_btn': 'Upload ke Google Drive',

    // Partner Evaluation View
    'eval.annual_title': 'Evaluasi Vendor Tahunan',
    'eval.export_csv': 'Ekspor CSV',
    'eval.add_btn': 'Tambah',
    'eval.rec_with_notes': 'Tinjauan Khusus',
    'eval.search_placeholder': 'Cari vendor, reviewer, atau notes...',
    'eval.year_prefix': 'Tahun',
    'eval.all_decisions': 'Semua Keputusan',
    'eval.decision_recommended': 'Lanjutkan Kerjasama',
    'eval.decision_rec_notes': 'Tinjauan Khusus',
    'eval.decision_not_rec': 'Putuskan Kerjasama',
    'eval.decision_not_reviewed': 'Belum Dinilai',
    'eval.all_obligation_targets': 'Semua Target Kewajiban',
    'eval.view': 'Tampilan',
    'eval.toggle_columns': 'Toggle Kolom',
    'eval.view_settings': 'Pengaturan Tampilan Kolom',
    'eval.status_rec': 'Lanjutkan Kerjasama',
    'eval.status_rec_notes': 'Tinjauan Khusus',
    'eval.status_not_rec': 'Putuskan Kerjasama',
    'eval.status_not_reviewed': 'Belum Dinilai',
    'eval.col_calculated_score': 'Skor',
    'eval.col_final_eval': 'Hasil Rekomendasi',
    'eval.col_action': 'Aksi',
    'eval.col_review_date': 'Tanggal Review',
    'eval.col_id_date': 'ID & Tanggal Review',
    'eval.col_vendor': 'Partner',
    'eval.col_target': 'Target Kewajiban',
    'eval.col_recommendation': 'Hasil Rekomendasi',
    'eval.no_data': 'Tidak ada data evaluasi yang sesuai filter pada tahun',
    'eval.input_eval': 'Input Evaluasi',
    'eval.action_detail': 'Detail',
    'eval.action_edit': 'Edit',
    'eval.action_delete': 'Hapus',
    'pagination.rows_per_page': 'Baris per halaman',
    'pagination.page': 'Halaman',
    'pagination.of': 'dari',
    'pagination.first_page': 'Halaman Pertama',
    'pagination.prev_page': 'Halaman Sebelumnya',
    'pagination.next_page': 'Halaman Berikutnya',
    'pagination.last_page': 'Halaman Terakhir',
    'eval.auto_score_text': 'Penghitungan Otomatis',
    'eval.rec_result': 'Hasil Rekomendasi',
    'eval.notes_title': 'Catatan Evaluasi',
    'eval.section1': 'Informasi Dasar',
    'eval.section2': 'Kriteria Penilaian',
    'eval.section3': 'Evaluasi Akhir & Catatan',
    'eval.review_date': '1. Review Date (Tanggal Review)',
    'eval.supplier_name': '2. Nama Partner',
    'eval.obligation_target': '1. Kewajiban',
    'eval.incident_freq': '2. Insiden',
    'eval.communication': '3. Komunikasi',
    'eval.pricing': '4. Harga',
    'eval.calc_score_breakdown': 'Hasil Penghitungan Otomatis Score',
    'eval.select_partner_ph': '-- Pilih Partner Terdaftar --',
    'eval.no_partners_warning': 'Belum ada data Partner terdaftar di sistem. Harap tambahkan Partner terlebih dahulu.',
    'eval.points': 'Poin',
    'eval.opt_sangat_baik': 'Sangat baik',
    'eval.opt_baik': 'Baik',
    'eval.opt_kurang_baik': 'Kurang',
    'eval.opt_never': 'Never (Tidak Pernah)',
    'eval.opt_rare': 'Rare (Jarang)',
    'eval.opt_frequent': 'Frequent (Sering)',
    'eval.opt_cheap': 'Cheap (Murah)',
    'eval.opt_moderate': 'Moderate (Sedang)',
    'eval.opt_expensive': 'Expensive (Mahal)',
    'eval.opt_rec_desc': 'Sangat direkomendasikan',
    'eval.opt_rec_notes_desc': 'Direkomendasikan dengan catatan',
    'eval.opt_not_rec_desc': 'Tidak direkomendasikan',
    'eval.notes_label': 'Catatan',
    'eval.notes_ph': 'Tuliskan catatan evaluasi lengkap, performa penayangan, kendala yang timbul, atau alasan rekomendasi...',
    'eval.modal_title_add': 'Form Evaluasi Partner',
    'eval.modal_title_edit': 'Edit Evaluasi Partner',
    'eval.detail_modal_title': 'Laporan Evaluasi Partner',
    'eval.btn_cancel': 'Batal',
    'eval.btn_saving': 'Menyimpan...',
    'eval.btn_update': 'Perbarui Evaluasi',
    'eval.btn_submit': 'Submit Evaluasi Partner',
    'eval.btn_close': 'Tutup',

    // Amendments View
    'amendments.title': 'Pembaruan & Amendment Kontrak',
    'amendments.filter_all': 'Semua Induk Perjanjian (Kontrak & IO)',
    'amendments.filter_contract': 'Addendum Kontrak Utama',
    'amendments.filter_io': 'Addendum Insertion Order (IO)',
    'amendments.no_data': 'Belum ada data Addendum/Amendment yang tercatat.',
    'amendments.parent_doc': 'Dokumen Induk',
    'amendments.date': 'Tanggal:',
    'amendments.pdf_btn': 'PDF Addendum',
    'amendments.changed_elements': 'Elemen Perubahan:',
    'amendments.summary_label': 'Ringkasan Track-Change Perubahan:',

    // Notifications View
    'notifications.title': 'Pusat Notifikasi & Alarm Notice Period',
    'notifications.unread_badge': 'Belum Dibaca',
    'notifications.mark_all': 'Tandai Semua Dibaca',
    'notifications.processing': 'Memproses...',
    'notifications.refresh_logs': 'Muat Ulang Log',
    'notifications.search_ph': 'Cari nomor kontrak, partner, atau IO...',
    'notifications.all_status': 'Semua Status',
    'notifications.status_unread': 'Belum Dibaca',
    'notifications.status_read': 'Sudah Dibaca',
    'notifications.all_types': 'Semua Jenis Notifikasi',
    'notifications.all_time_periods': 'Semua Periode Waktu',
    'notifications.time_today': 'Hari Ini (24 Jam Terakhir)',
    'notifications.time_7_days': '7 Hari Terakhir',
    'notifications.time_30_days': '30 Hari Terakhir',
    'notifications.view_settings': 'Pengaturan Tampilan Kolom',
    'notifications.view': 'Tampilan',
    'notifications.toggle_columns': 'Toggle Kolom',
    'notifications.col_time': 'Waktu',
    'notifications.col_type_header': 'Tipe Notifikasi',
    'notifications.col_recipient': 'Penerima',
    'notifications.col_actions': 'Aksi',
    'notifications.selected_count': 'notifikasi dipilih',
    'notifications.mark_read_btn': 'Tandai Dibaca',
    'notifications.no_data': 'Belum ada notifikasi atau peringatan notice period yang tercatat.',
    'notifications.mark_read': 'Tandai Dibaca',
    'notifications.col_created_time': 'Waktu dibuat',
    'notifications.col_type_short': 'Tipe',
    'notifications.col_subject': 'Subjek',
    'notifications.col_message': 'Pesan',
    'notifications.delete_selected': 'Hapus Terpilih',
    'notifications.delete_notif': 'Hapus Notifikasi',
    'notifications.confirm_delete': 'Hapus notifikasi ini?',
    'notifications.confirm_delete_selected': 'Hapus notifikasi yang dipilih?',

    // Admin Users View & Better Auth Console
    'admin.instance_config_btn': 'instances.config.ts',
    'admin.refresh_btn': 'Segarkan Data',

    // Console Tabs
    'admin.tab_dashboard': 'Dashboard',
    'admin.tab_users': 'Pengguna',
    'admin.tab_sessions': 'Sesi',
    'admin.tab_organizations': 'Organisasi',
    'admin.tab_teams': 'Departemen',
    'admin.tab_invitations': 'Undangan',
    'admin.tab_apikeys': 'API Keys',
    'admin.tab_rbac': 'Matriks RBAC',

    // Dashboard metrics & cards
    'admin.card_total_users': 'Total Pengguna',
    'admin.card_active_sessions': 'Sesi Aktif',
    'admin.card_enterprise_orgs': 'Organisasi Enterprise',
    'admin.card_departments_teams': 'Departemen / Teams',
    'admin.card_verified_accounts': 'Akun Terverifikasi',
    'admin.card_active_apikeys': 'API Keys Aktif',
    'admin.status_active': 'aktif',
    'admin.status_banned': 'dicekal',
    'admin.sub_valid_tokens': 'Token valid realtime',
    'admin.sub_tenant_isolate': 'Isolasi multi-tenant',
    'admin.active_prefix': 'Aktif:',
    'admin.sub_machine_integration': 'Integrasi mesin & webhook',
    'admin.quick_actions_title': 'TINDAKAN CEPAT (QUICK ACTIONS)',
    'admin.quick_add_user': 'Tambah User Baru',
    'admin.quick_create_org': 'Buat Organisasi',
    'admin.quick_create_team': 'Buat Tim/Divisi',
    'admin.btn_generate_key': 'Buat API Key',
    'admin.recent_users_title': 'Pengguna Terbaru',
    'admin.active_login_sessions_title': 'Sesi Login Aktif',
    'admin.view_all': 'Lihat Semua',
    'admin.online_status': 'Online',
    'admin.generic_user': 'Pengguna',
    'admin.expires_prefix': 'Kadaluarsa:',
    'admin.btn_revoke': 'Cabut',
    'admin.btn_revoke_session': 'Cabut sesi login ini',

    // Users Tab
    'admin.users_search_ph': 'Cari nama, email, atau role pengguna...',
    'admin.filter_role_all': 'Semua Role',
    'admin.filter_status_all': 'Semua Status',
    'admin.filter_active': 'Aktif',
    'admin.filter_banned': 'Dicekal',
    'admin.col_identifier': 'Pengguna',
    'admin.col_account_status': 'Status Akun',
    'admin.col_sessions_count': 'Sesi Aktif',
    'admin.col_created': 'Terdaftar',
    'admin.action_reset_pwd': 'Reset Kata Sandi',
    'admin.action_ban': 'Cekal Pengguna',
    'admin.action_unban': 'Buka Cekal',
    'admin.action_delete': 'Hapus Pengguna',
    'admin.no_users_found': 'Tidak ada pengguna yang cocok dengan kriteria pencarian.',
    'admin.add_user_btn': 'Tambah Pengguna Baru',

    // Accounts Tab
    'admin.acc_total_linked': 'Total Akun Terhubung',
    'admin.acc_multi_provider': 'Autentikasi multi-provider',
    'admin.acc_pwd_label': 'Email & Kata Sandi',
    'admin.acc_pwd_desc': 'Terenkripsi Argon2 / SHA-256',
    'admin.acc_google_label': 'Google Workspace SSO',
    'admin.acc_google_desc': 'OAuth 2.0 OpenID Connect',
    'admin.acc_search_ph': 'Cari user, email, atau account ID...',
    'admin.filter_prov_all': 'Semua Provider',
    'admin.col_provider': 'Provider Auth',
    'admin.col_acc_id': 'Identifier Akun',
    'admin.col_pwd_hash': 'Enkripsi Kata Sandi',
    'admin.col_created_at': 'Dibuat Pada',
    'admin.no_accounts_found': 'Tidak ada akun terhubung yang cocok.',

    // Sessions Tab
    'admin.sess_search_ph': 'Cari sesi berdasarkan email, IP, browser, token...',
    'admin.col_token': 'Token Sesi',
    'admin.col_ip_agent': 'Alamat IP & Perangkat',
    'admin.col_started': 'Mulai Login',
    'admin.col_expires': 'Kadaluarsa',
    'admin.revoke_session': 'Cabut Sesi',
    'admin.revoke_all_user_sessions': 'Cabut Semua Sesi User',
    'admin.no_sessions_found': 'Tidak ada sesi aktif yang ditemukan.',

    // Organizations Tab
    'admin.org_search_ph': 'Cari nama organisasi atau slug...',
    'admin.org_currency': 'Mata Uang Default',

    // Teams Tab
    'admin.team_search_ph': 'Cari tim atau departemen...',
    'admin.team_add_member': 'Tambah Anggota',

    // Invitations Tab
    'admin.inv_search_ph': 'Cari email undangan...',
    'admin.inv_col_role': 'Peran Diminta',

    // API Keys Tab
    'admin.api_generate_btn': 'Buat API Key',
    'admin.api_col_scopes': 'Cakupan Izin (Scopes)',

    // RBAC Matrix Tab
    'admin.rbac_tester_title': 'Simulator Izin RBAC Realtime',

    // Modals
    'admin.modal_add_user': 'Tambah Pengguna Sistem Baru',
    'admin.modal_reset_pwd': 'Reset Kata Sandi Pengguna',
    'admin.modal_create_org': 'Buat Organisasi Enterprise Baru',
    'admin.modal_create_team': 'Buat Tim / Departemen',
    'admin.modal_add_team_member': 'Tambah Anggota ke Tim',
    'admin.modal_create_inv': 'Kirim Undangan Akses Organisasi',
    'admin.modal_gen_key': 'Buat Enterprise API Key',
    'admin.key_generated_success': 'API Key Berhasil Dibuat!',
    'admin.key_copy_warn': 'PENTING: Salin kunci sekarang. Anda tidak akan dapat melihatnya lagi setelah menutup jendela ini.',

    // Legacy Whitelist compat
    'admin.col_role': 'Role Hak Akses',
    'admin.col_dept': 'Departemen',
    'admin.col_status': 'Status SSO',
    'admin.col_action': 'Aksi',
    'admin.system': 'Sistem',
    'admin.email_label': 'Alamat Email (Google / Corporate) *',
    'admin.fullname_label': 'Nama Lengkap Pengguna *',
    'admin.role_label': 'Role Hak Akses Aplikasi *',
    'admin.btn_cancel': 'Batal',
    'admin.err_required': 'Alamat Email dan Nama Lengkap Pengguna wajib diisi.',
    'admin.btn_save_changes': 'Simpan Perubahan',
    'admin.btn_delete_org': 'Hapus Organisasi',
    'admin.delete_org_title': 'Hapus Organisasi',
    'admin.delete_org_confirm_msg': 'Apakah Anda yakin ingin menghapus organisasi ini secara permanen?',
    'admin.delete_org_warning': 'Tindakan ini tidak dapat dibatalkan. Seluruh data tim, undangan, dan relasi pengguna dalam organisasi ini akan dihapus.',
    'admin.cant_delete_default_org': 'Organisasi default sistem tidak dapat dihapus.',
    'admin.cant_delete_active_org': 'Beralih ke organisasi lain terlebih dahulu sebelum menghapus.',
    'admin.btn_confirm_delete': 'Hapus Permanen',
    'admin.toast.org_deleted_success': 'Organisasi berhasil dihapus.',
    'admin.toast.delete_org_failed': 'Gagal menghapus organisasi.',
    'admin.delete_department_title': 'Hapus Departemen / Tim',
    'admin.delete_department_confirm_msg': 'Apakah Anda yakin ingin menghapus departemen ini secara permanen?',
    'admin.delete_department_warning': 'Tindakan ini tidak dapat dibatalkan. Seluruh anggota dalam departemen ini akan dilepaskan dari penugasan tim.',
    'admin.btn_confirm_delete_department': 'Hapus Departemen',
    'admin.toast.department_deleted_success': 'Departemen berhasil dihapus.',
    'admin.toast.delete_department_failed': 'Gagal menghapus departemen.',
    'admin.toast.department': 'Departemen',
    'admin.department_members_count': 'Jumlah Anggota',

    // Activity Logs View
    'logs.title': 'Log Aktivitas Sesi System',
    'logs.refresh_btn': 'Refresh Log',
    'logs.all_actions': 'Semua Jenis Aksi',
    'logs.col_user': 'Pengguna & Email',
    'logs.col_action': 'Jenis Aksi',
    'logs.col_module': 'Modul / Fitur',
    'logs.col_detail': 'Rincian Aktivitas',
    'logs.col_time': 'Waktu Operasi',
    'logs.search_placeholder': 'Cari aktivitas, email, atau deskripsi...',
    'logs.loading': 'Memuat log aktivitas...',
    'logs.no_data': 'Belum ada data log aktivitas.',

    // Settings View
    'settings.master_root_id_label': 'ID Folder Root Penyimpanan Google Drive Master',
    'settings.org_folder_label': 'Folder Organisasi',
    'settings.org_auto_provision_btn': 'Buat Otomatis di Drive',
    'settings.org_default_entity': 'Entitas Default',
    'settings.org_open_folder': 'Buka',
    'settings.org_creating': 'Membuat...',
    'settings.org_connect_google_first': 'Hubungkan akun Google terlebih dahulu',
    'settings.org_auto_provision_tooltip': 'Buat Folder dan Spreadsheet otomatis di Google Drive',
    'settings.manage_org_modal_title': 'Konfigurasi Drive & Sheet Organisasi',
    'settings.manage_org_modal_desc': 'Atur atau hubungkan ID Google Drive Folder dan Spreadsheet spesifik untuk organisasi ini.',
    'settings.save_tenant_google_btn': 'Simpan Konfigurasi Organisasi',
    'settings.not_configured': 'Belum Dikonfigurasi',
    'settings.edit_config_btn': 'Ubah Konfigurasi',
    'settings.edit_confirm_title': 'Ubah Konfigurasi Database',
    'settings.edit_confirm_desc': 'Mengubah Spreadsheet ID atau Folder Storage akan mengalihkan sinkronisasi ke berkas baru. Pastikan ID sheet tujuan valid.',
    'settings.edit_confirm_cancel': 'Batal',
    'settings.edit_confirm_proceed': 'Lanjutkan Edit',
    'settings.save_config_btn': 'Simpan Konfigurasi',
    'settings.saving_and_provisioning': 'Menyimpan & Membuat Resource...',
    'settings.save_config_success_provisioned': 'Konfigurasi Master Root Folder tersimpan dan Folder Organisasi berhasil disinkronkan ke Google Drive!',
    'settings.cancel_edit_btn': 'Batal',
    'settings.no_folder_selected': 'Belum ada Folder Storage dipilih',
    'settings.reset_success': 'Seluruh data sistem dan partner spending berhasil direset ke kondisi awal kosong.',
    'settings.nav_google': 'Google & Database',
    'settings.nav_google_desc': 'Spreadsheet ID, Drive storage, dan OAuth',
    'settings.nav_ai': 'Model AI & Parser',
    'settings.nav_ai_desc': 'Konfigurasi Google Gemini Extractor',
    'settings.nav_notifications': 'Penerima Notifikasi',
    'settings.nav_notifications_desc': 'Email alert legal & finance H-90, H-60, H-30',
    'settings.nav_language': 'Teks UI & Lokalisasi',
    'settings.nav_language_desc': 'Kustomisasi label dan kamus antarmuka',
    'settings.nav_security': 'Keamanan & Maintenance',
    'settings.nav_security_desc': 'Kunci konfigurasi dan reset data transaksi',
    'settings.sync_push_success': 'Berhasil menyimpan data ke Google Sheet!',
    'settings.sync_fetch_success': 'Berhasil menarik data dari Google Sheet!',
    'settings.google_auth_title': 'Autentikasi Akun Google Workspace',
    'settings.oauth_active': 'OAuth Aktif',
    'settings.oauth_inactive': 'Belum Terhubung',
    'settings.no_google_connected': 'Belum Ada Akun Google Terhubung',
    'settings.refresh_session': 'Refresh Sesi',
    'settings.disconnect': 'Putuskan',
    'settings.connect_google_btn': 'Hubungkan Akun Google',
    'settings.picker_tab': 'Pilih dari Google Drive',
    'settings.manual_tab': 'Input ID Manual',
    'settings.pick_folder_btn': 'Pilih Folder',
    'settings.ai_config_title': 'Pilihan Model Google Gemini',
    'settings.gemini_api_key_title': 'Google Gemini API Key',
    'settings.api_key_active': 'API Key Aktif',
    'settings.api_key_empty': 'Belum Diatur',
    'settings.gemini_api_key_label': 'Gemini API Key (AI Studio)',
    'settings.get_api_key_link': 'Dapatkan API Key di Google AI Studio',
    'settings.gemini_api_key_ph': 'Masukkan Google Gemini API Key (misal: AIzaSy...)',
    'settings.save_api_key_btn': 'Simpan API Key',
    'settings.test_api_key_btn': 'Uji Koneksi API',
    'settings.notif_recipients_title': 'Daftar Email Penerima Alert Notice Period',
    'settings.legal_email_label': 'Email Tim Legal (Master Notice Period Alert)',
    'settings.legal_email_hint': 'Gunakan tanda koma (,) untuk memisahkan beberapa alamat email.',
    'settings.finance_email_label': 'Email Tim Finance (Commercial & Spending Alert)',
    'settings.save_notif_emails_btn': 'Simpan Email Notifikasi',
    'settings.smtp_card_title': 'Konfigurasi SMTP Relay Server (Email Nyata)',
    'settings.smtp_enable_label': 'Aktifkan Pengiriman Email via SMTP Relay',
    'settings.smtp_host_label': 'Host / Server SMTP',
    'settings.smtp_port_label': 'Port SMTP',
    'settings.smtp_user_label': 'SMTP Username / Akun Email',
    'settings.smtp_password_label': 'Password SMTP / Google App Password',
    'settings.smtp_from_email_label': 'Alamat Email Pengirim (From Email)',
    'settings.smtp_from_name_label': 'Nama Pengirim (From Name)',
    'settings.smtp_test_title': 'Uji Koneksi & Kirim Email Percobaan',
    'settings.smtp_test_recipient_ph': 'Masukkan email tujuan uji coba...',
    'settings.smtp_test_btn': 'Uji Koneksi SMTP',
    'settings.smtp_testing_btn': 'Mengirim Email Uji Coba...',
    'settings.smtp_save_btn': 'Simpan Konfigurasi SMTP',
    'settings.smtp_saving_btn': 'Menyimpan...',
    'settings.ui_customization_title': 'Kustomisasi Teks UI & Kamus Antarmuka',
    'settings.ui_editor_card_title': 'Editor Teks Antarmuka Lengkap',
    'settings.ui_editor_card_desc': 'Buka jendela dialog untuk mengubah setiap teks tombol, menu, tabel, atau pesan error.',
    'settings.open_ui_editor_btn': 'Buka Editor Teks UI',
    'settings.export_csv_dict': 'Ekspor Kamus CSV',
    'settings.import_csv_dict': 'Impor Kamus CSV',
    'settings.reset_dict_btn': 'Reset ke Bawaan',
    'settings.danger_zone_title': 'Danger Zone: Reset Database Sistem',
    'settings.danger_zone_desc': 'Mereset seluruh pengaturan sistem ke kondisi awal bawaan (Manage Admin Access, Organisasi, Departemen, AI, Notifikasi, Penyimpanan) serta menghapus seluruh data transaksi.',
    'settings.delete_all_transactions': 'Reset Seluruh Pengaturan & Data Transaksi',
    'settings.reset_db_btn': 'Reset Database Sistem',
    'settings.resetting_db': 'Mereset Database...',
    'settings.reset_modal_title': 'Reset Database Sistem',
    'settings.reset_modal_warning': 'Tindakan ini permanen dan tidak dapat dibatalkan.',
    'settings.reset_modal_input_placeholder': 'RESET NOW',
    'settings.confirm_reset_btn': 'Reset Database',
    'partners.col_entity': 'Badan Hukum',

    // Hierarchy View

    // Greetings
    'greeting.morning': 'Selamat Pagi',
    'greeting.afternoon': 'Selamat Siang',
    'greeting.evening': 'Selamat Sore',
    'greeting.night': 'Selamat Malam',

    // Login Page
    'login.google_button': 'Masuk dengan Akun Google',
    'login.welcome': 'Selamat Datang',
    'login.welcome_app': 'Selamat Datang di {appName}',
    'login.setup_title': 'Buat Akun Admin',
    'login.setup_subtitle': 'Atur URL website dan buat akun superuser pertama.',
    'login.setup_submit': 'Buat Akun Admin',
    'login.setup_failed': 'Gagal membuat akun admin.',
    'login.public_url_label': 'URL website',
    'login.public_url_help': 'Sertakan http:// atau https:// dan port publik jika diperlukan.',
    'login.create_account': 'Buat Akun',
    'login.fill_form_reg': 'Silakan isi formulir untuk registrasi',
    'login.fill_form_login': 'Silakan masuk untuk mengakses aplikasi',
    'login.account_created_title': 'Akun Berhasil Dibuat!',
    'login.account_pending_approval': 'Akun Anda sedang menunggu persetujuan Administrator.',
    'login.account_pending_approval_desc': 'Anda dapat masuk setelah Administrator menyetujui akun Anda.',
    'login.back_to_login': 'Kembali ke halaman Masuk',
    'login.fullname_label': 'Nama Lengkap',
    'login.fullname_placeholder': 'Nama Lengkap',
    'login.email_label': 'Email',
    'login.email_placeholder': 'nama@email.com',
    'login.password_label': 'Kata Sandi',
    'login.btn_register': 'Daftar',
    'login.btn_login': 'Masuk',
    'login.has_account_prompt': 'Sudah punya akun? Masuk',
    'login.no_account_prompt': 'Belum punya akun? Daftar',
    'login.err_pending': 'Akun Anda menunggu persetujuan Administrator. Silakan hubungi Admin.',
    'login.err_failed': 'Gagal masuk. Periksa email dan kata sandi Anda.',
    'login.err_register_failed': 'Gagal mendaftar. Silakan periksa kembali data Anda (pastikan kata sandi minimal 8 karakter) dan coba lagi.',

    // Modals

    // Common Buttons & Labels
    'common.reset': 'Reset',
    'common.save': 'Simpan',
    'common.cancel': 'Batal',
    'common.close': 'Tutup',
    'common.loading': 'Memuat Data...',
    'common.yes': 'Ya',
    'common.no': 'Tidak',

    // Form Entry Translations (Partner, Contract, IO Modals)
    'form.partner.title_add': 'Tambah Partner Baru',
    'form.partner.title_edit': 'Edit Data Partner',
    'form.partner.nama_legal': 'Nama Legal *',
    'form.partner.nama_legal_placeholder': 'contoh: PT Telekomunikasi Selular',
    'form.partner.nama_channel': 'Nama Channel',
    'form.partner.nama_channel_placeholder': 'mis. TSEL, XL, INDOSAT',
    'form.partner.internal_pic': 'PIC Internal',
    'form.partner.contact_section_title': 'Informasi Kontak PIC (Person In Charge)',
    'form.partner.nama_pic': 'Nama PIC *',
    'form.partner.nama_pic_placeholder': 'contoh: Andi Hermawan',
    'form.partner.email_pic': 'Email PIC *',
    'form.partner.email_pic_placeholder': 'contoh: andi@telkomsel.co.id',
    'form.partner.telepon_pic': 'Nomor Telepon / WA PIC *',
    'form.partner.telepon_pic_placeholder': 'contoh: 0811-2233-4455',
    'form.partner.alamat_pic': 'Alamat PIC *',
    'form.partner.alamat_pic_placeholder': 'contoh: Jl. Jend. Sudirman Kav 52-53...',
    'form.partner.kategori_kerjasama': 'Kategori Kerjasama *',
    'form.partner.tag_placeholder': 'Tambah tag kategori (mis. Advertising, IT, Logistics)...',
    'form.partner.add_tag_btn': 'Tambah Tag',
    'form.partner.notes_label': 'Catatan Due Diligence / Internal',
    'form.partner.save_btn': 'Simpan Partner',
    'form.partner.saving_btn': 'Menyimpan Partner...',

    'form.contract.title_edit_addendum': 'Edit Addendum Perjanjian',
    'form.contract.title_edit_master': 'Edit Kontrak Induk',
    'form.contract.title_add_addendum': 'Buat & Upload Agreement Addendum Baru',
    'form.contract.title_add_master': 'Buat & Upload Kontrak Baru',
    'form.contract.jenis_dokumen': 'Jenis Dokumen Perjanjian *',
    'form.contract.master_agreement_opt': 'Master Agreement (Kontrak Induk Utama)',
    'form.contract.agreement_addendum_opt': 'Agreement Addendum (Perubahan / Adendum)',
    'form.contract.partner_vendor': 'Partner *',
    'form.contract.ref_master_agreement': 'Referensi Master Agreement (Kontrak Induk) *',
    'form.contract.select_master_placeholder': '-- Pilih Master Agreement Induk --',
    'form.contract.no_master_warning': 'Harap pilih partner lain atau buat Master Agreement terlebih dahulu.',
    'form.contract.changed_fields': 'Elemen / Field Yang Berubah *',
    'form.contract.track_change_summary': 'Ringkasan Detail Track-Change Perubahan * (Wajib)',
    'form.contract.track_change_placeholder': 'Jelaskan secara eksplisit nilai lama -> nilai baru, tanggal lama -> tanggal baru, atau perubahan pasal...',
    'form.contract.nomor_addendum': 'Nomor Addendum *',
    'form.contract.nomor_kontrak': 'Nomor Kontrak Legal *',
    'form.contract.judul_addendum': 'Judul Perjanjian Addendum *',
    'form.contract.judul_kontrak': 'Judul Perjanjian Kontrak *',
    'form.contract.judul_ph': 'contoh: PT Telkomsel_Master Agreement_Advertising-Content_2026-08-01',
    'form.contract.kategori_tag': 'Kategori Kerjasama Tag *',
    'form.contract.tanggal_mulai': 'Tanggal Mulai *',
    'form.contract.tanggal_berakhir': 'Tanggal Berakhir *',
    'form.contract.nilai_kontrak': 'Nilai Kontrak *',
    'form.contract.masa_notice': 'Masa Notice (Hari) *',
    'form.contract.notice_type': 'Jenis Notice yang Diperlukan *',
    'form.contract.auto_renewal': 'Perpanjangan Otomatis',
    'form.contract.status_kontrak': 'Status Kontrak *',
    'form.contract.status_normal': 'Normal (Sesuai tanggal berlaku)',
    'form.contract.status_terminated': 'Dihentikan (Penghentian Perjanjian)',
    'form.contract.upload_label': 'Dokumen Asli Kontrak (Drive PDF Upload)',
    'form.contract.drag_pdf': 'Pilih atau Drag Dokumen Kontrak ke sini',
    'form.partner.drag_ref': 'Pilih atau Drag Dokumen Referensi ke sini',
    'form.contract.file_selected': 'File terpilih:',
    'form.contract.save_btn': 'Simpan Data Kontrak',
    'form.contract.saving_btn': 'Menyimpan Kontrak...',

    'form.io.title_edit': 'Edit Insertion Order',
    'form.io.title_add': 'Tambah Insertion Order Baru',
    'form.io.nomor_io': 'Nomor IO *',
    'form.io.nomor_io_ph': 'contoh: IO/DETIK/2026/012',
    'form.io.select_master': 'Pilih Induk Kontrak (Opsional)',
    'form.io.standalone_opt': '-- IO Standalone (Tanpa Kontrak Induk) --',
    'form.io.judul_campaign': 'Judul Insertion Order / Campaign *',
    'form.io.judul_ph': 'contoh: PT Telkomsel_IO_Digital Banner & Social Media_2026-08-01',
    'form.io.partner_media': 'Partner / Kanal Media *',
    'form.io.kanal_media': 'Kanal Media / Placement *',
    'form.io.kanal_ph': 'contoh: Homepage Masthead & Instagram Live Sesi',
    'form.io.pricing_model': 'Model Harga *',
    'form.io.pricing_model_custom_ph': 'Ketik nama pricing model baru (misal: CPV, Hybrid)...',
    'form.io.charging_type': 'Skema Penagihan (Charging Type) *',
    'form.io.currency': 'Mata Uang',
    'form.io.tanggal_mulai': 'Tanggal Mulai *',
    'form.io.tanggal_selesai': 'Tanggal Selesai *',
    'form.io.nilai_io': 'Nilai IO *',
    'form.io.deliverables': 'Rincian Terstruktur Deliverables *',
    'form.io.deliverables_ph': 'Sebutkan detail garansi impresi, kuota SMS, tayangan banner, atau jumlah artikel...',
    'form.io.upload_label': 'Dokumen Asli IO (Drive PDF Upload)',
    'form.io.select_pdf': 'Pilih atau Drag Dokumen Insertion Order ke sini',
    'form.io.save_btn': 'Simpan Insertion Order',
    'form.io.saving_btn': 'Menyimpan IO...',

    'form.common.cancel': 'Batal',
    'form.common.required_hint': 'Lengkapi semua kolom wajib (*) untuk menyimpan',

    // Partner Spending
    'spending.invoice_suffix': 'Invoice',
    'spending.search_placeholder': 'Cari No. Invoice, Partner, deskripsi...',
    'spending.all_vendors': 'Semua Partner',
    'spending.col_invoice_no': 'No. Invoice',
    'spending.col_vendor': 'Partner',
    'spending.col_month': 'Periode Bulan',
    'spending.col_amount': 'Total Nilai',
    'spending.col_date': 'Tanggal Invoice',
    'spending.col_invoice_doc': 'Invoice',
    'spending.col_billing_doc': 'Tagihan',
    'spending.col_action': 'Aksi',
    'spending.no_data': 'Belum ada data spending yang tercatat.',
    'spending.modal_title': 'Input Data Spending',
    'spending.modal_edit_title': 'Edit Data Spending',
    'spending.vendor_name_label': 'Nama Partner',
    'spending.vendor_select_ph': '-- Pilih Partner --',
    'spending.invoice_no_label': 'Nomor Invoice',
    'spending.invoice_no_ph': 'Contoh: INV-2026-0801',
    'spending.invoice_date_label': 'Tanggal Invoice',
    'spending.invoice_month_label': 'Bulan Invoice',
    'spending.add_month_btn': '+ Tambah Bulan',
    'spending.invoice_desc_label': 'Deskripsi Invoice',
    'spending.invoice_desc_ph': 'Keterangan singkat pengeluaran...',
    'spending.currency_label': 'Mata Uang',
    'spending.total_amount_label': 'Total Nilai',
    'spending.total_amount_ph': '150000000',
    'spending.bank_info_title': 'Informasi Rekening Bank (Terisi otomatis jika pernah diisi)',
    'spending.bank_name_label': 'Nama Bank',
    'spending.bank_account_no_label': 'Nomor Rekening',
    'spending.bank_account_holder_label': 'Atas Nama Rekening',
    'spending.upload_invoice_label': 'Unggah Invoice',
    'spending.upload_billing_label': 'Unggah Tagihan',
    'spending.cancel_btn': 'Batal',
    'spending.save_btn': 'Simpan Spending',
    'spending.saving_btn': 'Menyimpan...',
    'form.amendment.notes_ph': 'Jelaskan secara eksplisit nilai lama -> nilai baru, tanggal lama -> tanggal baru, atau perubahan pasal...',
    'contract.addendum_list': 'Daftar Addendum Perjanjian Turunan',
    'form.partner.err_nama_legal': 'Nama legal partner wajib diisi.',
    'form.partner.err_nama_pic': 'Nama PIC partner wajib diisi.',
    'form.partner.err_email_pic': 'Email PIC partner wajib diisi.',
    'form.partner.err_telepon_pic': 'Nomor telepon PIC partner wajib diisi.',
    'form.partner.err_tags': 'Minimal 1 tag kategori kemitraan wajib dipilih.',
    'settings.search_ui_text': 'Cari kata kunci, ID key, atau teks UI...',

    // Audit Table Keys
    'audit_col_vendorName': 'Nama Partner',
    'audit_col_vendorType': 'Jenis Partner',
    'audit_col_vendorStatus': 'Status Partner',
    'audit_col_vendorStartDate': 'Start Date Partner',
    'audit_col_vendorEndDate': 'End Date Partner',
    'audit_col_vendorDuration': 'Durasi Aktif Partner',
    'audit_col_vendorPic': 'PIC Eksternal',
    'audit_col_vendorPicInternal': 'PIC Internal',
    'audit_col_vendorBadanHukum': 'Badan Hukum',
    'audit_col_vendorStatusDD': 'Status Due Diligence',
    'audit_col_evalReviewDate': 'Tanggal Review Evaluasi',
    'audit_col_evalTypeOfWork': 'Jenis Pekerjaan (Eval)',
    'audit_col_evalSlaScore': 'Skor SLA',
    'audit_col_evalObligation': 'Target Kewajiban',
    'audit_col_evalIncident': 'Frekuensi Insiden',
    'audit_col_evalCommunication': 'Komunikasi',
    'audit_col_evalPricing': 'Kesesuaian Harga',
    'audit_col_evalFinal': 'Evaluasi Final',
    'audit_col_evalNotes': 'Catatan Evaluasi',
    'audit_col_spendInvoiceNo': 'Nomor Invoice',
    'audit_col_spendInvDate': 'Tanggal Invoice',
    'audit_col_spendAmount': 'Nominal Spending',
    'audit_col_spendInvoiceLink': 'Link Invoice',
    'audit_col_spendBillingLink': 'Link Billing',
    'audit_col_contractNo': 'Nomor Kontrak',
    'audit_col_contractTitle': 'Judul Kontrak',
    'audit_col_contractStatus': 'Status Kontrak',
    'audit_col_contractStartDate': 'Start Date Kontrak',
    'audit_col_contractEndDate': 'End Date Kontrak',
    'audit_col_contractDuration': 'Durasi Kontrak',
    'audit_col_contractValue': 'Nilai Kontrak',
    'audit_col_contractKategori': 'Kategori Kerjasama',
    'audit_col_contractAutoRenewal': 'Perpanjangan Otomatis',
    'audit_col_contractNoticePeriod': 'Notice Period (Hari)',
    'audit_col_contractStatusApproval': 'Status Approval Kontrak',
    'audit_col_contractLink': 'Link Dok. Kontrak',
    'audit_col_ioNo': 'Nomor IO',
    'audit_col_ioTitle': 'Judul IO',
    'audit_col_ioStatus': 'Status IO',
    'audit_col_ioChannel': 'Kanal Media',
    'audit_col_ioStartDate': 'Start Date IO',
    'audit_col_ioEndDate': 'End Date IO',
    'audit_col_ioDuration': 'Durasi IO',
    'audit_col_ioPricingModel': 'Pricing Model IO',
    'audit_col_ioPricingDetail': 'Pricing Detail IO',
    'audit_col_ioChargingType': 'Charging Type IO',
    'audit_col_ioValue': 'Nilai IO',
    'audit_col_ioLink': 'Link Dok. IO',
    'hierarchy.data_not_found': 'Data tidak ditemukan.',
    'audit_group_vendor': 'Partner',
    'audit_group_evaluation': 'Evaluasi',
    'audit_group_spending': 'Spending',
    'audit_group_contract': 'Kontrak',
    'audit_group_io': 'IO',
    'admin.test_connection_testing': 'Menguji Koneksi...',
    'admin.copied': 'Tersalin!',

    // Contract Creator — UI chrome (Panel Asisten Kontrak, toolbar, footer)
    'contract_creator.title_input_title': 'Klik untuk mengubah judul dokumen',
    'contract_creator.title_input_placeholder': 'Judul Dokumen Perjanjian',
    'contract_creator.mode_edit_title': 'Sunting langsung teks kontrak dalam Bahasa Indonesia',
    'contract_creator.mode_edit_label': 'Edit',
    'contract_creator.mode_preview_title': 'Pratinjau tampilan dokumen final',
    'contract_creator.mode_preview_label': 'Pratinjau',
    'contract_creator.download_title': 'Download file Word (.doc)',
    'contract_creator.download_label': 'Unduh',
    'contract_creator.enter_fullscreen': 'Tampilan Fullscreen',
    'contract_creator.exit_fullscreen': 'Keluar dari Fullscreen',
    'contract_creator.sidebar_toggle_title': 'Buka / Tutup Panel Pintasan Form & Klausul',
    'contract_creator.reset_template_title': 'Kembalikan isi ke template awal 15 pasal Perjanjian Kerjasama',
    'contract_creator.reset_template_label': 'Reset Template',

    'contract_creator.msg.custom_field_name_required': 'Nama kolom isian belum diisi',
    'contract_creator.msg.template_name_required': 'Nama template belum diisi',
    'contract_creator.msg.template_content_empty': 'Konten template masih kosong',
    'contract_creator.msg.template_saved': 'Template kerjasama berhasil disimpan',
    'contract_creator.msg.template_save_failed': 'Gagal menyimpan template',
    'contract_creator.msg.template_save_error': 'Terjadi kesalahan saat menyimpan template',
    'contract_creator.msg.template_loaded_prefix': 'Template',
    'contract_creator.msg.template_loaded_suffix': 'berhasil dimuat ke editor.',
    'contract_creator.msg.partner_synced_prefix': 'Data mitra',
    'contract_creator.msg.partner_synced_suffix': 'berhasil disinkronkan ke dalam 15 pasal Perjanjian Kerjasama!',
    'contract_creator.msg.partner_synced_fields': 'berhasil diisikan ke kolom isian dokumen.',
    'contract_creator.msg.reset_done': 'Template 15 Pasal Perjanjian Kerjasama berhasil direset ke kondisi awal.',
    'contract_creator.msg.docx_downloaded': 'File dokumen Word (.doc) versi Bahasa Indonesia berhasil diunduh!',
    'contract_creator.msg.docx_download_failed': 'Gagal mengunduh dokumen',
    'contract_creator.msg.template_deleted': 'Template kerjasama berhasil dihapus',
    'contract_creator.msg.template_delete_failed': 'Gagal menghapus template',
    'contract_creator.msg.template_delete_error': 'Terjadi kesalahan saat menghapus template',

    'contract_creator.confirm.use_template_prefix': 'Gunakan template',
    'contract_creator.confirm.use_template_suffix': '? Teks kontrak saat ini akan diganti.',
    'contract_creator.confirm.reset_desc': 'Reset dokumen ke template awal? Perubahan yang belum disimpan akan hilang.',
    'contract_creator.confirm.reset_label': 'Reset',
    'contract_creator.confirm.delete_template_desc': 'Hapus template kerjasama ini?',
    'contract_creator.confirm.delete_label': 'Hapus',

    'contract_creator.panel_title': 'Panel Asisten Kontrak',
    'contract_creator.tab.fields': 'Kolom Isian',
    'contract_creator.tab.partners': 'Mitra',
    'contract_creator.tab.templates': 'Template',

    'contract_creator.field.contract_no.title': 'Nomor referensi atau nomor surat resmi perjanjian kerjasama',
    'contract_creator.field.contract_no.label': 'Nomor Perjanjian Kerjasama',
    'contract_creator.filled_badge': 'Terisi',
    'contract_creator.jump_to_slot': 'Lompat ke posisi isian di dokumen',
    'contract_creator.custom_fields_section_title': 'Kolom Isian Kustom Anda',
    'contract_creator.custom_badge': 'Kustom',
    'contract_creator.optional_badge': 'Opsional',
    'contract_creator.custom_field_recovered_desc': 'Kolom kustom dipulihkan otomatis dari dokumen (label asli tidak tersimpan).',
    'contract_creator.delete_custom_field_title': 'Hapus kolom isian kustom',

    'contract_creator.partners.select_label_title': 'Mengisi otomatis nama badan hukum, domisili kantor, direktur penandatangan, dan email resmi ke seluruh pasal perjanjian',
    'contract_creator.partners.select_label': 'Pilih Partner yang Ada',
    'contract_creator.partners.select_placeholder': 'Pilih Partner',
    'contract_creator.partners.default_address': 'Alamat Terdaftar',
    'contract_creator.partners.default_position': 'Direktur',
    'contract_creator.partners.resync_button': 'Sinkronkan Ulang ke Dokumen',

    'contract_creator.templates.save_section_title_attr': 'Simpan seluruh teks kontrak kustom saat ini sebagai master template yang siap dipakai ulang',
    'contract_creator.templates.save_section_title': 'Simpan Draf Sebagai Template',
    'contract_creator.templates.name_placeholder': 'Nama template (misal: Template Sewa Server)',
    'contract_creator.templates.saving': 'Menyimpan...',
    'contract_creator.templates.save_button': 'Simpan Template',
    'contract_creator.templates.library_title': 'Pustaka Template Terdaftar',
    'contract_creator.templates.loading': 'Memuat pustaka...',
    'contract_creator.templates.empty': 'Belum ada template yang disimpan.',
    'contract_creator.templates.use_button': 'Gunakan',
    'contract_creator.templates.delete_title': 'Hapus Template',

    'contract_creator.ai_template.section_title_attr': 'Buat draf template baru dari deskripsi singkat',
    'contract_creator.ai_template.section_title': 'Buat Template dengan AI',
    'contract_creator.ai_template.type_contract': 'Kontrak',
    'contract_creator.ai_template.type_agreement': 'Perjanjian (Agreement)',
    'contract_creator.ai_template.type_so': 'Surat Pesanan (SO)',
    'contract_creator.ai_template.prompt_placeholder': 'Contoh: NDA mutual dua perusahaan teknologi, kerahasiaan 3 tahun',
    'contract_creator.ai_template.generate_button': 'Buatkan Template',
    'contract_creator.ai_template.generating': 'Membuat draf...',
    'contract_creator.ai_template.prompt_required': 'Deskripsi template belum diisi',
    'contract_creator.ai_template.confirm_overwrite': 'Draf saat ini punya perubahan belum disimpan dan akan diganti oleh hasil AI. Lanjutkan?',
    'contract_creator.ai_template.failed': 'Gagal membuat template',
    'contract_creator.ai_template.generated': 'Draf AI siap — tinjau isinya lalu klik Simpan Template',
    'contract_creator.ai_template.error': 'Terjadi kesalahan saat membuat template',

    'contract_creator.custom_field_builder.create_button': 'Buat Kolom Isian Kustom Baru',
    'contract_creator.custom_field_builder.close': 'Tutup',
    'contract_creator.custom_field_builder.add': 'Tambah',
    'contract_creator.custom_field_builder.name_label': 'Nama Kolom Isian',
    'contract_creator.custom_field_builder.name_placeholder': 'Contoh: Kompensasi Tambahan',
    'contract_creator.custom_field_builder.type_label': 'Tipe Isian',
    'contract_creator.custom_field_builder.type_text': 'Teks biasa',
    'contract_creator.custom_field_builder.type_date': 'Tanggal',
    'contract_creator.custom_field_builder.type_currency': 'Mata Uang',
    'contract_creator.custom_field_builder.type_textarea': 'Paragraf / Textarea',
    'contract_creator.custom_field_builder.placeholder_label': 'Placeholder Default',
    'contract_creator.custom_field_builder.placeholder_placeholder': 'Contoh: Rp 50.000.000 (Lima Puluh Juta)',
    'contract_creator.custom_field_builder.description_label': 'Keterangan / Deskripsi',
    'contract_creator.custom_field_builder.description_placeholder': 'Deskripsi singkat fungsi kolom isian ini',
    'contract_creator.custom_field_builder.submit_button': 'Buat Kolom Isian Baru',

    'contract_creator.dragdrop.section_title_attr': 'Seret elemen ke posisi kursor di dokumen untuk menempatkan kolom isian dinamis',
    'contract_creator.dragdrop.section_title': 'Kolom Isian Drag & Drop',
    'contract_creator.dragdrop.cat_all': 'Semua',
    'contract_creator.dragdrop.cat_first_party': 'Pihak I',
    'contract_creator.dragdrop.cat_partner': 'Pihak II',
    'contract_creator.dragdrop.cat_operational': 'Ketentuan',
    'contract_creator.dragdrop.empty_category': 'Tidak ada kolom isian di kategori ini.',
    'contract_creator.dragdrop.item_title_attr': 'Seret elemen ini ke editor',

    'contract_creator.footer.words': 'kata',
    'contract_creator.footer.chars': 'karakter',
    'contract_creator.footer.read_estimate': 'Estimasi baca',
    'contract_creator.footer.minutes': 'menit',
    'contract_creator.footer.custom_template_active': 'Template Kerjasama Kustom Aktif',
    'contract_creator.footer.default_template_active': '15 Pasal Perjanjian Kerjasama',
    'contract_creator.footer.zoom_out': 'Perkecil',
    'contract_creator.footer.zoom_in': 'Perbesar',
    'contract_creator.footer.zoom_reset': 'Reset Zoom 100%',

    // Contract Creator — field labels/placeholders/descriptions (Kolom Isian tab)
    'contract_creator.field.firstPartyName.label': 'Nama Perusahaan Pihak Pertama',
    'contract_creator.field.firstPartyName.placeholder': 'PT Nama Perusahaan Pihak Pertama',
    'contract_creator.field.firstPartyName.description': 'Badan hukum atau perusahaan Pihak Pertama pembuat perjanjian',
    'contract_creator.field.firstPartyAlias.label': 'Singkatan / Sebutan Pihak Pertama',
    'contract_creator.field.firstPartyAlias.placeholder': 'Singkatan / Sebutan Singkat Pihak Pertama',
    'contract_creator.field.firstPartyAlias.description': 'Sebutan singkat pihak pertama di dalam klausul perjanjian',
    'contract_creator.field.firstPartyAddress.label': 'Alamat Kantor Pihak Pertama',
    'contract_creator.field.firstPartyAddress.placeholder': 'Alamat lengkap domisili kantor resmi pihak pertama',
    'contract_creator.field.firstPartyAddress.description': 'Alamat domisili hukum pihak pertama untuk korespondensi resmi',
    'contract_creator.field.firstPartyPic.label': 'Nama Penandatangan Pihak Pertama',
    'contract_creator.field.firstPartyPic.placeholder': 'Nama Direktur / Pejabat Berwenang Pihak Pertama',
    'contract_creator.field.firstPartyPic.description': 'Wakil sah pihak pertama yang menandatangani perjanjian',
    'contract_creator.field.firstPartyPosition.label': 'Jabatan Penandatangan Pihak Pertama',
    'contract_creator.field.firstPartyPosition.placeholder': 'Direktur Utama / Direktur',
    'contract_creator.field.firstPartyPosition.description': 'Kapasitas hukum pejabat pihak pertama',
    'contract_creator.field.firstPartyEmail.label': 'Email Resmi Pihak Pertama',
    'contract_creator.field.firstPartyEmail.placeholder': 'legal@perusahaan-pihak1.co.id',
    'contract_creator.field.firstPartyEmail.description': 'Alamat email korespondensi dan notifikasi resmi pihak pertama (Pasal 13)',
    'contract_creator.field.firstPartyBusinessDesc.label': 'Keterangan Bisnis Pihak Pertama (Konsiderans)',
    'contract_creator.field.firstPartyBusinessDesc.placeholder': 'Uraian izin dan bidang usaha pihak pertama...',
    'contract_creator.field.firstPartyBusinessDesc.description': 'Deskripsi bidang usaha pihak pertama pada bagian konsiderans',
    'contract_creator.field.partnerName.label': 'Nama Perusahaan Pihak Kedua',
    'contract_creator.field.partnerName.placeholder': 'PT Nama Mitra Usaha',
    'contract_creator.field.partnerName.description': 'Badan hukum atau perusahaan mitra yang mengadakan kerjasama',
    'contract_creator.field.partnerAddress.label': 'Alamat Kantor Pihak Kedua',
    'contract_creator.field.partnerAddress.placeholder': 'Alamat lengkap domisili kantor resmi mitra',
    'contract_creator.field.partnerAddress.description': 'Alamat korespondensi dan hukum pihak kedua',
    'contract_creator.field.partnerPic.label': 'Nama Penandatangan Pihak Kedua',
    'contract_creator.field.partnerPic.placeholder': 'Nama Lengkap Direktur / Wakil Sah',
    'contract_creator.field.partnerPic.description': 'Pejabat berwenang mewakili mitra menandatangani perjanjian',
    'contract_creator.field.partnerPosition.label': 'Jabatan Penandatangan Pihak Kedua',
    'contract_creator.field.partnerPosition.placeholder': 'Direktur Utama / Direktur',
    'contract_creator.field.partnerPosition.description': 'Kapasitas hukum pejabat penandatangan mitra',
    'contract_creator.field.partnerEmail.label': 'Email Resmi Pihak Kedua',
    'contract_creator.field.partnerEmail.placeholder': 'legal@mitra.co.id',
    'contract_creator.field.partnerEmail.description': 'Email resmi pemberitahuan dan korespondensi hukum mitra (Pasal 13)',
    'contract_creator.field.dateStr.label': 'Tanggal Penandatanganan',
    'contract_creator.field.dateStr.placeholder': '19 September 2026',
    'contract_creator.field.dateStr.description': 'Tanggal efektif pengikatan perjanjian kerjasama',
    'contract_creator.field.startDate.label': 'Tanggal Mulai Berlaku',
    'contract_creator.field.startDate.placeholder': '19 September 2026',
    'contract_creator.field.startDate.description': 'Awal periode pelaksanaan kerjasama (Pasal 3)',
    'contract_creator.field.endDate.label': 'Tanggal Berakhir',
    'contract_creator.field.endDate.placeholder': '18 September 2027',
    'contract_creator.field.endDate.description': 'Akhir periode kerjasama sebelum perpanjangan (Pasal 3)',
    'contract_creator.field.scopeDescId.label': 'Ruang Lingkup Kerjasama',
    'contract_creator.field.scopeDescId.placeholder': 'penyediaan layanan teknologi, integrasi sistem informasi, dan dukungan operasional bersama',
    'contract_creator.field.scopeDescId.description': 'Uraian pokok aktivitas dan hasil kerja yang disepakati (Pasal 2)',
    'contract_creator.field.feeAmountId.label': 'Nilai Kerjasama / Biaya Jasa',
    'contract_creator.field.feeAmountId.placeholder': 'Rp 100.000.000 (Seratus Juta Rupiah) belum termasuk PPN',
    'contract_creator.field.feeAmountId.description': 'Kompensasi atau imbalan jasa yang disepakati (Pasal 5)',
    'contract_creator.field.bankName.label': 'Nama Bank Pembayaran',
    'contract_creator.field.bankName.placeholder': 'PT Bank Central Asia Tbk (BCA)',
    'contract_creator.field.bankName.description': 'Bank penampung pembayaran resmi (Pasal 5)',
    'contract_creator.field.bankAccount.label': 'Nomor Rekening Bank',
    'contract_creator.field.bankAccount.placeholder': '5271-889-001',
    'contract_creator.field.bankAccount.description': 'Nomor rekening tujuan pembayaran transfer',
    'contract_creator.field.bankHolder.label': 'Atas Nama Rekening',
    'contract_creator.field.bankHolder.placeholder': 'Nama Pemilik Rekening Bank',
    'contract_creator.field.bankHolder.description': 'Nama pemilik rekening bank resmi pihak penerima',
  },
  EN: {
    'status.aktif': 'Active',
    'status.nonaktif': 'Inactive',
    'status.akan_berakhir': 'Will Expire',
    'status.expired': 'Expired',
    'status.terminated': 'Terminated',
    'status.draft': 'Draft',
    'status.review': 'Review',
    'status.signed': 'Signed',
    'status.ada': 'Available',
    'status.tidak_ada': 'Not Available',
    'status.kadaluarsa': 'Expired',
    // Nav & Sidebar
    'nav.main_title': 'Main navigation',
    'nav.doc_title': 'Document navigation',
    'nav.admin_title': 'Admin navigation',
    'nav.dashboard': 'Dashboard',
    'nav.hierarchy': 'Explore',
    'nav.partners': 'Partners',
    'nav.partners_list': 'Partner List & DD',
    'nav.partner_eval': 'Partner Evaluation',
    'nav.partner_spending': 'Partner Spending',
    'nav.contracts': 'Contracts',
    'nav.create_contract': 'My Documents',
    'nav.ios': 'Insertion Orders',
    'nav.notifications': 'Notifications',
    'nav.admin_users': 'Manage Admin Access',
    'nav.activity_logs': 'Session Activity Logs',
    'nav.settings': 'Settings',
    'nav.bulk_import': 'Import Data',
    'nav.version': 'v2.5.0 • ACL',
    'nav.expand_menu': 'Expand Menu',
    'nav.collapse_menu': 'Collapse Menu',

    // Header
    'header.notice_notifications': 'Notice Period Notifications',
    'header.no_notifications': 'No new alerts',
    'header.switch_language': 'Switch Language',

    // Dashboard
    'dashboard.view_all': 'View All',
    'dashboard.status': 'Status',
    'dashboard.action': 'Action',
    'dashboard.partner': 'Partner',
    'dashboard.value': 'Value',
    'dashboard.active_partners': 'Active Partners',
    'dashboard.active_contracts': 'Active Contracts',
    'dashboard.expiring_contracts': 'EXPIRING CONTRACTS',
    'dashboard.insertion_orders': 'Insertion Orders (IO)',
    'dashboard.end_date': 'End Date',
    'dashboard.remaining_time': 'Remaining Time',
    'dashboard.min_one_contract': 'Min. 1 Active Contract',
    'dashboard.need_notice': 'Requires Notice',
    'dashboard.expiring_table_title': 'Expiring Documents',
    'dashboard.no_expiring': 'No contracts or IOs require action.',
    'dashboard.select_all_requiring_action': 'Select all documents requiring action',
    'dashboard.select_requiring_action': 'Select {name}',
    'dashboard.spending_title': 'Spending Trend',
    'dashboard.all_years': 'All Years',
    'dashboard.year_prefix': 'Year',
    'dashboard.all_categories': 'All Categories',
    'dashboard.no_spending_data': 'No spending data to display for this filter.',

    // Bulk Import
    'import.title': 'Bulk Data Import (Excel / CSV)',
    'import.download_template': 'Download CSV Template',
    'import.upload_label': 'Upload CSV File',
    'import.choose_file': 'Choose CSV File',
    'import.preview_title': 'CSV Data Preview',
    'import.preview_rows': 'data rows found',
    'import.start_import': 'Start Import',
    'import.importing': 'Importing...',
    'import.result_title': 'Import Result Report',
    'import.succeeded': 'Successfully Created',
    'import.skipped': 'Skipped (Duplicate)',
    'import.failed': 'Failed to Import',
    'import.col_row': 'Row',
    'import.col_identifier': 'Identifier',
    'import.col_reason': 'Reason',
    'import.invalid_csv': 'Invalid CSV format or empty file.',
    'import.reset': 'Reset & Start Over',
    'import.type_partner': 'Partner',
    'import.type_contract': 'Contract',
    'import.type_io': 'Insertion Order (IO)',
    'import.type_evaluation': 'Partner Evaluation',
    'import.type_spending': 'Partner Spending',

    // Contracts
    'contracts.title': 'Commercial Contract Management',
    'contracts.export_csv': 'Export CSV',
    'contracts.search_placeholder': 'Search contract number, title, partner...',
    'contracts.all_status': 'All Statuses',
    'contracts.active': 'Active',
    'contracts.expiring': 'Expiring Soon',
    'contracts.expired': 'Expired',
    'contracts.terminated': 'Terminated',
    'contracts.col_no': 'Agreement No.',
    'contracts.col_title': 'Agreement Title',
    'contracts.col_doc_type': 'Agreement Type',
    'contracts.col_partner': 'Partner',
    'contracts.col_category': 'Category',
    'contracts.col_start_date': 'Start Date',
    'contracts.col_end_date': 'End Date',
    'contracts.col_value': 'Contract Value',
    'contracts.col_status': 'Status',
    'contracts.col_document': 'Document',
    'contracts.col_action': 'Action',
    'contracts.all_types': 'All Document Types',
    'contracts.all_categories': 'All Categories',
    'contracts.no_data': 'No contract data matching the filter.',
    'contracts.action_redline': 'Redlining',
    'redline.modal_title': 'AI Contract Risk & Compliance Analyzer (AI Redlining)',
    'redline.risk_score': 'Legal Risk Score',
    'redline.risk_level_low': 'Low Risk (Safe)',
    'redline.risk_level_medium': 'Medium Risk (Needs Adjustment)',
    'redline.risk_level_high': 'High Risk (Review Closely)',
    'redline.risk_level_critical': 'Critical Risk (Must Renegotiate)',
    'redline.tab_clauses': 'Clause Analysis & Redlining',
    'redline.tab_summary': 'Summary & Compliance',
    'redline.executive_summary': 'Legal Executive Summary',
    'redline.key_findings': 'Key Risk Findings',
    'redline.filter_all': 'All Clauses',
    'redline.filter_critical': 'Critical',
    'redline.original_issue': 'Original Clause / Identified Issue',
    'redline.recommended_redline': 'Recommended Redline (Fairer Revision)',
    'redline.copy_clause': 'Copy Redline',
    'redline.copied': 'Copied!',
    'redline.copy_full_report': 'Copy Full Report',
    'redline.reanalyze': 'Re-Analyze',
    'redline.analyzing': 'Analyzing Contract...',
    'redline.analyzing_desc': 'Google Gemini is examining clauses and evaluating legal risks...',
    'redline.close': 'Close',

    // Hierarchy / Legal Document Structure View
    'hierarchy.title': 'Explore',
    'hierarchy.new_partner': 'New Partner',
    'hierarchy.new_contract': 'New Contract',
    'hierarchy.new_io': 'New IO',
    'hierarchy.tree_view': 'Tree View',
    'hierarchy.audit_view': 'Table View',
    'hierarchy.audit_table_title': 'Complete Audit View',
    'hierarchy.view_flat': 'View: Flat (Sortable)',
    'hierarchy.view_grouped': 'View: Grouped Row',
    'hierarchy.custom_columns': 'Custom Columns',
    'hierarchy.custom_columns_title': 'Column Customization',
    'hierarchy.reset': 'Reset',
    'hierarchy.select_all': 'Select All / Deselect All',
    'hierarchy.export_csv': 'Export CSV',
    'hierarchy.months': 'Months',

    'hierarchy.search_placeholder': 'Search partner, contract, or IO...',
    'hierarchy.no_data': 'No partner/contract data found',
    'hierarchy.search_hint': 'Try adjusting your search keywords.',
    'hierarchy.detail_legal': 'Legal Details',
    'hierarchy.kontrak_induk_short': 'New Contract',
    'hierarchy.dd_verification_title': 'Due Diligence Legal Document Verification (Level 1 Checklist):',
    'hierarchy.contracts_linked': 'Contracts Linked',
    'hierarchy.no_document': 'No Document',
    'hierarchy.standard_dd_docs_hint': 'Standard documents: NIB, NPWP, Deed of Establishment, Directors ID (Not configured yet).',
    'hierarchy.no_master_contract_for_partner': 'No Master Contract registered for Partner',
    'hierarchy.commercial_contract_hint': 'Every commercial partnership requires a master contract prior to IO execution details.',
    'hierarchy.create_new_master_contract': 'Create New Master Contract',
    'hierarchy.master_agreement_badge': 'MASTER AGREEMENT',
    'hierarchy.agreement_addendum_badge': 'AGREEMENT ADDENDUM',
    'hierarchy.edit_btn': 'Edit',
    'hierarchy.insertion_order_badge': 'INSERTION ORDER (IO)',
    'hierarchy.commercial_value': 'Commercial Value:',
    'hierarchy.validity_period': 'Validity Period:',
    'hierarchy.notice_period': 'Notice Period:',
    'hierarchy.executions_detail': 'Executions Detail (IOs):',
    'hierarchy.executions_count': 'Executions',
    'hierarchy.contract_notes': 'Contract Notes / Internal Notes',
    'hierarchy.io_notes': 'Deliverables & IO Scope Notes',
    'hierarchy.pricing_model': 'Pricing Model:',
    'hierarchy.charging_type': 'Charging Type:',
    'hierarchy.no_io_connected': 'No Insertion Order connected to this Contract.',
    'hierarchy.add_new_io': 'Add New IO',
    'hierarchy.download_doc': 'Download Document',
    'hierarchy.download_contract_doc': 'Download Contract Document',
    'hierarchy.download_io_doc': 'Download Insertion Order Document',

    // IO View
    'io.title': 'Insertion Order Management',
    'io.add_btn': 'Add',
    'io.export_csv': 'Export CSV',
    'io.search_ph': 'Search insertion orders...',
    'io.all_status': 'All Statuses',
    'io.status_berjalan': 'In Progress',
    'io.status_selesai': 'Completed',
    'io.status_draft': 'Draft',
    'io.status_dibatalkan': 'Cancelled',
    'io.all_pricing_models': 'All Pricing Models',
    'io.all_charging_types': 'All Payment Schemes',
    'io.view': 'View',
    'io.toggle_columns': 'Toggle Columns',
    'io.view_settings': 'Column View Settings',
    'io.empty_filter_match': 'No insertion orders match the search filter.',
    'io.col_no': 'IO No.',
    'io.col_title': 'IO Title',
    'io.col_partner': 'Partner',
    'io.col_channel': 'Media Channel',
    'io.col_pricing_model': 'Pricing Model',
    'io.col_charging_type': 'Payment Scheme',
    'io.col_start_date': 'Start Date',
    'io.col_end_date': 'End Date',
    'io.col_status': 'Status',
    'io.col_value': 'Order Value',
    'io.col_action': 'Action',
    'io.col_document': 'PDF File',
    'io.action_detail': 'Detail',
    'io.action_edit': 'Edit',
    'io.action_delete': 'Delete',
    'io.detail_partner_label': 'Partner / Vendor:',
    'io.detail_channel_label': 'Media Channel Placement:',
    'io.detail_total_value_label': 'Total IO Value:',
    'io.detail_pricing_scheme_label': 'Pricing Model & Scheme:',
    'io.detail_deliverables_label': 'Deliverables & Scope of Work',
    'io.detail_no_deliverables': 'No specific deliverables notes.',
    'io.detail_open_drive': 'Open IO Document in Google Drive',
    'io.detail_close': 'Close Detail',

    // Partners View
    'partners.header_title': 'Partner Management',
    'partners.search_placeholder': 'Search partner name, PIC, partner type...',
    'partners.all_status': 'All Partner Statuses',
    'partners.active': 'Active Partner',
    'partners.inactive': 'Inactive Partner',
    'partners.all_dd_status': 'All Audit Due Diligence Statuses',
    'partners.dd_complete': 'DD Complete Verified',
    'partners.dd_incomplete': 'DD Incomplete',
    'partners.dd_expired': 'DD Expired',
    'partners.all_legal_entity': 'All Legal Entities (BHI & BHA)',
    'partners.table_view': 'Table',
    'partners.col_name': 'Partner Name',
    'partners.col_channel': 'Channel Name',
    'partners.col_category': 'Partnership Category',
    'partners.col_email': 'Email',
    'partners.col_phone': 'Phone',
    'partners.col_status': 'Partner Status',
    'partners.col_pic': 'PIC & Contact',
    'partners.col_dd_status': 'Audit Status DD',
    'partners.col_action': 'Actions',
    'partners.no_data': 'No partner data found matching search/filter.',
    'partners.req_docs_title': 'Legal Compliance Document Requirements:',
    'partners.audit_done': 'Audit Complete',
    'partners.view_file': 'View File',
    'partners.upload_file': 'Upload File',
    'partners.upload_dd_modal_title': 'Upload Due Diligence Document',
    'partners.expiry_date_label': 'Expiration Date (Optional)',
    'partners.drag_file': 'Choose or drag document file here',
    'partners.uploading_to_drive': 'Uploading to Google Drive DD Folder...',
    'partners.upload_to_drive_btn': 'Upload to Google Drive',

    // Partner Evaluation View
    'eval.annual_title': 'Annual Partner Evaluation',
    'eval.export_csv': 'Export CSV',
    'eval.add_btn': 'Add',
    'eval.rec_with_notes': 'Rec. w/ Notes',
    'eval.search_placeholder': 'Search vendor, reviewer, or notes...',
    'eval.year_prefix': 'Year',
    'eval.all_decisions': 'All Decisions',
    'eval.decision_recommended': 'Recommended',
    'eval.decision_rec_notes': 'Recommended with notes',
    'eval.decision_not_rec': 'Not recommended',
    'eval.decision_not_reviewed': 'Not reviewed',
    'eval.all_obligation_targets': 'All Obligation Targets',
    'eval.view': 'View',
    'eval.toggle_columns': 'Toggle Columns',
    'eval.view_settings': 'Column View Settings',
    'eval.status_rec': 'Recommended',
    'eval.status_rec_notes': 'Recommended with notes',
    'eval.status_not_rec': 'Not recommended',
    'eval.status_not_reviewed': 'Not reviewed',
    'eval.col_calculated_score': 'Score',
    'eval.col_final_eval': 'Recommendation Result',
    'eval.col_action': 'Action',
    'eval.col_review_date': 'Review Date',
    'eval.col_id_date': 'ID & Review Date',
    'eval.col_vendor': 'Partner',
    'eval.col_target': 'Obligation Target',
    'eval.col_recommendation': 'Recommendation Result',
    'eval.no_data': 'No partner evaluation data matching filter in year',
    'eval.input_eval': 'Input Evaluation',
    'eval.action_detail': 'Detail',
    'eval.action_edit': 'Edit',
    'eval.action_delete': 'Delete',
    'pagination.rows_per_page': 'Rows per page',
    'pagination.page': 'Page',
    'pagination.of': 'of',
    'pagination.first_page': 'First Page',
    'pagination.prev_page': 'Previous Page',
    'pagination.next_page': 'Next Page',
    'pagination.last_page': 'Last Page',
    'eval.auto_score_text': 'Automatic Calculation',
    'eval.rec_result': 'Recommendation Result',
    'eval.notes_title': 'Evaluation Notes',
    'eval.section1': 'Basic Information',
    'eval.section2': 'Evaluation Criteria',
    'eval.section3': 'Final Evaluation & Notes',
    'eval.review_date': '1. Review Date',
    'eval.supplier_name': '2. Partner Name',
    'eval.obligation_target': '1. Obligation',
    'eval.incident_freq': '2. Incident',
    'eval.communication': '3. Communication',
    'eval.pricing': '4. Pricing',
    'eval.calc_score_breakdown': 'Automated Score Calculation Result',
    'eval.select_partner_ph': '-- Select Registered Partner --',
    'eval.no_partners_warning': 'No registered partners found in system. Please add a Partner first.',
    'eval.points': 'Points',
    'eval.opt_sangat_baik': 'Very Good',
    'eval.opt_baik': 'Good',
    'eval.opt_kurang_baik': 'Poor',
    'eval.opt_never': 'Never',
    'eval.opt_rare': 'Rare',
    'eval.opt_frequent': 'Frequent',
    'eval.opt_cheap': 'Cheap',
    'eval.opt_moderate': 'Moderate',
    'eval.opt_expensive': 'Expensive',
    'eval.opt_rec_desc': 'Highly recommended',
    'eval.opt_rec_notes_desc': 'Recommended with notes',
    'eval.opt_not_rec_desc': 'Not recommended',
    'eval.notes_label': 'Notes',
    'eval.notes_ph': 'Write detailed evaluation notes, campaign performance, issues encountered, or recommendation grounds...',
    'eval.modal_title_add': 'Partner Evaluation Form',
    'eval.modal_title_edit': 'Edit Partner Evaluation',
    'eval.detail_modal_title': 'Partner Evaluation Report',
    'eval.btn_cancel': 'Cancel',
    'eval.btn_saving': 'Saving...',
    'eval.btn_update': 'Update Evaluation',
    'eval.btn_submit': 'Submit Partner Evaluation',
    'eval.btn_close': 'Close',

    // Amendments View
    'amendments.title': 'Contract Amendments & Renewals',
    'amendments.filter_all': 'All Parent Agreements (Contracts & IOs)',
    'amendments.filter_contract': 'Master Contract Addendum',
    'amendments.filter_io': 'Insertion Order (IO) Addendum',
    'amendments.no_data': 'No Addendum/Amendment records logged yet.',
    'amendments.parent_doc': 'Parent Document',
    'amendments.date': 'Date:',
    'amendments.pdf_btn': 'PDF Addendum',
    'amendments.changed_elements': 'Changed Elements:',
    'amendments.summary_label': 'Track-Change Summary of Changes:',

    // Notifications View
    'notifications.title': 'Notification Center & Notice Period Alerts',
    'notifications.unread_badge': 'Unread',
    'notifications.mark_all': 'Mark All as Read',
    'notifications.processing': 'Processing...',
    'notifications.refresh_logs': 'Refresh Logs',
    'notifications.search_ph': 'Search contract, partner, or IO number...',
    'notifications.all_status': 'All Statuses',
    'notifications.status_unread': 'Unread',
    'notifications.status_read': 'Read',
    'notifications.all_types': 'All Notification Types',
    'notifications.all_time_periods': 'All Time Periods',
    'notifications.time_today': 'Today (Last 24 Hours)',
    'notifications.time_7_days': 'Last 7 Days',
    'notifications.time_30_days': 'Last 30 Days',
    'notifications.view_settings': 'Column Display Settings',
    'notifications.view': 'View',
    'notifications.toggle_columns': 'Toggle Columns',
    'notifications.col_time': 'Time',
    'notifications.col_type_header': 'Notification Type',
    'notifications.col_recipient': 'Recipient',
    'notifications.col_actions': 'Action',
    'notifications.selected_count': 'notifications selected',
    'notifications.mark_read_btn': 'Mark as Read',
    'notifications.no_data': 'No notifications or notice period warnings recorded yet.',
    'notifications.mark_read': 'Mark as Read',
    'notifications.col_created_time': 'Created time',
    'notifications.col_type_short': 'Type',
    'notifications.col_subject': 'Subject',
    'notifications.col_message': 'Message',
    'notifications.delete_selected': 'Delete Selected',
    'notifications.delete_notif': 'Delete Notification',
    'notifications.confirm_delete': 'Are you sure you want to delete this notification?',
    'notifications.confirm_delete_selected': 'Are you sure you want to delete selected notifications?',

    // Admin Users View & Better Auth Console
    'admin.instance_config_btn': 'instances.config.ts',
    'admin.refresh_btn': 'Refresh Data',

    // Console Tabs
    'admin.tab_dashboard': 'Dashboard',
    'admin.tab_users': 'Users',
    'admin.tab_sessions': 'Sessions',
    'admin.tab_organizations': 'Organizations',
    'admin.tab_teams': 'Departments',
    'admin.tab_invitations': 'Invitations',
    'admin.tab_apikeys': 'API Keys',
    'admin.tab_rbac': 'RBAC Matrix',

    // Dashboard metrics & cards
    'admin.card_total_users': 'Total Users',
    'admin.card_active_sessions': 'Active Sessions',
    'admin.card_enterprise_orgs': 'Enterprise Organizations',
    'admin.card_departments_teams': 'Departments / Teams',
    'admin.card_verified_accounts': 'Verified Accounts',
    'admin.card_active_apikeys': 'Active API Keys',
    'admin.status_active': 'active',
    'admin.status_banned': 'banned',
    'admin.sub_valid_tokens': 'Realtime valid tokens',
    'admin.sub_tenant_isolate': 'Multi-tenant isolate',
    'admin.active_prefix': 'Active:',
    'admin.sub_machine_integration': 'Machine & webhook integrations',
    'admin.quick_actions_title': 'QUICK ACTIONS',
    'admin.quick_add_user': 'Add New User',
    'admin.quick_create_org': 'Create Organization',
    'admin.quick_create_team': 'Create Team / Division',
    'admin.btn_generate_key': 'Generate API Key',
    'admin.recent_users_title': 'Recent Users',
    'admin.active_login_sessions_title': 'Active Login Sessions',
    'admin.view_all': 'View All',
    'admin.online_status': 'Online',
    'admin.generic_user': 'User',
    'admin.expires_prefix': 'Expires:',
    'admin.btn_revoke': 'Revoke',
    'admin.btn_revoke_session': 'Revoke this login session',

    // Users Tab
    'admin.users_search_ph': 'Search users by name, email, or role...',
    'admin.filter_role_all': 'All Roles',
    'admin.filter_status_all': 'All Statuses',
    'admin.filter_active': 'Active',
    'admin.filter_banned': 'Banned',
    'admin.col_identifier': 'User',
    'admin.col_account_status': 'Account Status',
    'admin.col_sessions_count': 'Active Sessions',
    'admin.col_created': 'Registered',
    'admin.action_reset_pwd': 'Reset Password',
    'admin.action_ban': 'Ban User',
    'admin.action_unban': 'Unban User',
    'admin.action_delete': 'Delete User',
    'admin.no_users_found': 'No users found matching the search criteria.',
    'admin.add_user_btn': 'Add New User',

    // Accounts Tab
    'admin.acc_total_linked': 'Total Linked Accounts',
    'admin.acc_multi_provider': 'Multi-provider authentication',
    'admin.acc_pwd_label': 'Email & Password',
    'admin.acc_pwd_desc': 'Encrypted Argon2 / SHA-256',
    'admin.acc_google_label': 'Google Workspace SSO',
    'admin.acc_google_desc': 'OAuth 2.0 OpenID Connect',
    'admin.acc_search_ph': 'Search user, email, or account ID...',
    'admin.filter_prov_all': 'All Providers',
    'admin.col_provider': 'Auth Provider',
    'admin.col_acc_id': 'Account Identifier',
    'admin.col_pwd_hash': 'Password Encryption',
    'admin.col_created_at': 'Created At',
    'admin.no_accounts_found': 'No matching linked accounts found.',

    // Sessions Tab
    'admin.sess_search_ph': 'Search sessions by email, IP, browser, token...',
    'admin.col_token': 'Session Token',
    'admin.col_ip_agent': 'IP Address & Device',
    'admin.col_started': 'Started At',
    'admin.col_expires': 'Expires At',
    'admin.revoke_session': 'Revoke Session',
    'admin.revoke_all_user_sessions': 'Revoke All User Sessions',
    'admin.no_sessions_found': 'No active sessions found.',

    // Organizations Tab
    'admin.org_search_ph': 'Search organization name or slug...',
    'admin.org_currency': 'Default Currency',

    // Teams Tab
    'admin.team_search_ph': 'Search teams or departments...',
    'admin.team_add_member': 'Add Member',

    // Invitations Tab
    'admin.inv_search_ph': 'Search invitation emails...',
    'admin.inv_col_role': 'Requested Role',

    // API Keys Tab
    'admin.api_generate_btn': 'Generate API Key',
    'admin.api_col_scopes': 'Permission Scopes',

    // RBAC Matrix Tab
    'admin.rbac_tester_title': 'Realtime RBAC Permission Simulator',

    // Modals
    'admin.modal_add_user': 'Add New System User',
    'admin.modal_reset_pwd': 'Reset User Password',
    'admin.modal_create_org': 'Create New Enterprise Organization',
    'admin.modal_create_team': 'Create Team / Department',
    'admin.modal_add_team_member': 'Add Member to Team',
    'admin.modal_create_inv': 'Send Organization Access Invitation',
    'admin.modal_gen_key': 'Generate Enterprise API Key',
    'admin.key_generated_success': 'API Key Successfully Generated!',
    'admin.key_copy_warn': 'IMPORTANT: Copy this key now. You will not be able to see it again after closing this dialog.',

    // Legacy Whitelist compat
    'admin.col_role': 'Access Role',
    'admin.col_dept': 'Department',
    'admin.col_status': 'SSO Status',
    'admin.col_action': 'Actions',
    'admin.system': 'System',
    'admin.email_label': 'Email Address (Google / Corporate) *',
    'admin.fullname_label': 'Full User Name *',
    'admin.role_label': 'Application Access Role *',
    'admin.btn_cancel': 'Cancel',
    'admin.err_required': 'Email Address and Full Name are required.',
    'admin.btn_save_changes': 'Save Changes',
    'admin.btn_delete_org': 'Delete Organization',
    'admin.delete_org_title': 'Delete Organization',
    'admin.delete_org_confirm_msg': 'Are you sure you want to permanently delete this organization?',
    'admin.delete_org_warning': 'This action cannot be undone. All teams, invitations, and member associations in this organization will be permanently removed.',
    'admin.cant_delete_default_org': 'Default system organization cannot be deleted.',
    'admin.cant_delete_active_org': 'Switch to another organization before deleting.',
    'admin.btn_confirm_delete': 'Permanently Delete',
    'admin.toast.org_deleted_success': 'Organization deleted successfully.',
    'admin.toast.delete_org_failed': 'Failed to delete organization.',
    'admin.delete_department_title': 'Delete Department / Team',
    'admin.delete_department_confirm_msg': 'Are you sure you want to permanently delete this department?',
    'admin.delete_department_warning': 'This action cannot be undone. All members assigned to this department will be unassigned from this team.',
    'admin.btn_confirm_delete_department': 'Delete Department',
    'admin.toast.department_deleted_success': 'Department deleted successfully.',
    'admin.toast.delete_department_failed': 'Failed to delete department.',
    'admin.toast.department': 'Department',
    'admin.department_members_count': 'Members Count',

    // Activity Logs View
    'logs.title': 'System Session Activity Logs',
    'logs.refresh_btn': 'Refresh Logs',
    'logs.all_actions': 'All Action Types',
    'logs.col_user': 'User & Email',
    'logs.col_action': 'Action Type',
    'logs.col_module': 'Module / Feature',
    'logs.col_detail': 'Activity Details',
    'logs.col_time': 'Operation Time',
    'logs.search_placeholder': 'Search activity, email, or description...',
    'logs.loading': 'Loading activity logs...',
    'logs.no_data': 'No activity logs found.',

    // Settings View
    'settings.not_configured': 'Not Configured',
    'settings.edit_config_btn': 'Edit Configuration',
    'settings.edit_confirm_title': 'Change Database Configuration',
    'settings.edit_confirm_desc': 'Changing the Spreadsheet ID or Storage Folder will redirect cloud synchronization to a new file. Ensure the target ID is valid.',
    'settings.edit_confirm_cancel': 'Cancel',
    'settings.edit_confirm_proceed': 'Proceed to Edit',
    'settings.save_config_btn': 'Save Configuration',
    'settings.saving_and_provisioning': 'Saving & Provisioning Org Resources...',
    'settings.save_config_success_provisioned': 'Master Root Folder configuration saved and Organization Folder synced successfully to Google Drive!',
    'settings.cancel_edit_btn': 'Cancel',
    'settings.no_folder_selected': 'No Storage Folder selected yet',
    'settings.reset_success': 'All system data and partner spending have been reset to an empty initial state.',
    'settings.nav_google': 'Google & Database',
    'settings.nav_google_desc': 'Spreadsheet ID, Drive storage, and OAuth',
    'settings.nav_ai': 'AI Model & Parser',
    'settings.nav_ai_desc': 'Google Gemini Extractor configuration',
    'settings.nav_notifications': 'Notification Recipients',
    'settings.nav_notifications_desc': 'Legal & finance email alerts D-90, D-60, D-30',
    'settings.nav_language': 'UI Text & Localization',
    'settings.nav_language_desc': 'Custom labels & translation dictionary',
    'settings.nav_security': 'Security & Maintenance',
    'settings.nav_security_desc': 'Configuration lock & transaction data reset',
    'settings.sync_push_success': 'Successfully saved data to Google Sheets!',
    'settings.sync_fetch_success': 'Successfully fetched data from Google Sheets!',
    'settings.google_auth_title': 'Google Workspace Account Authentication',
    'settings.oauth_active': 'OAuth Active',
    'settings.oauth_inactive': 'Not Connected',
    'settings.no_google_connected': 'No Google Account Connected',
    'settings.refresh_session': 'Refresh Session',
    'settings.disconnect': 'Disconnect',
    'settings.connect_google_btn': 'Connect Google Account',
    'settings.master_root_id_label': 'Master Google Drive Storage Root Folder ID',
    'settings.org_folder_label': 'Organization Folder',
    'settings.org_auto_provision_btn': 'Auto-Create in Drive',
    'settings.org_default_entity': 'Default Entity',
    'settings.org_open_folder': 'Open',
    'settings.org_creating': 'Creating...',
    'settings.org_connect_google_first': 'Connect Google account first',
    'settings.org_auto_provision_tooltip': 'Create Folder and Spreadsheet automatically in Google Drive',
    'settings.manage_org_modal_title': 'Configure Organization Drive & Sheet',
    'settings.manage_org_modal_desc': 'Configure or connect specific Google Drive Folder ID and Spreadsheet ID for this organization.',
    'settings.save_tenant_google_btn': 'Save Organization Config',
    'settings.picker_tab': 'Select from Google Drive',
    'settings.manual_tab': 'Input Manual ID',
    'settings.pick_folder_btn': 'Choose Folder',
    'settings.ai_config_title': 'Google Gemini AI Model Selection',
    'settings.gemini_api_key_title': 'Google Gemini API Key',
    'settings.api_key_active': 'API Key Active',
    'settings.api_key_empty': 'Not Configured',
    'settings.gemini_api_key_label': 'Gemini API Key (AI Studio)',
    'settings.get_api_key_link': 'Get API Key from Google AI Studio',
    'settings.gemini_api_key_ph': 'Enter Google Gemini API Key (e.g. AIzaSy...)',
    'settings.save_api_key_btn': 'Save API Key',
    'settings.test_api_key_btn': 'Test API Connection',
    'settings.notif_recipients_title': 'Notice Period Alert Email Recipients',
    'settings.legal_email_label': 'Legal Team Email (Master Notice Period Alert)',
    'settings.legal_email_hint': 'Use comma (,) to separate multiple email addresses.',
    'settings.finance_email_label': 'Finance Team Email (Commercial & Spending Alert)',
    'settings.save_notif_emails_btn': 'Save Notification Emails',
    'settings.smtp_card_title': 'SMTP Relay Server Configuration (Live Email)',
    'settings.smtp_enable_label': 'Enable Email Sending via SMTP Relay',
    'settings.smtp_host_label': 'SMTP Host / Server',
    'settings.smtp_port_label': 'SMTP Port',
    'settings.smtp_user_label': 'SMTP Username / Email Account',
    'settings.smtp_password_label': 'SMTP Password / Google App Password',
    'settings.smtp_from_email_label': 'Sender Email (From Email)',
    'settings.smtp_from_name_label': 'Sender Display Name (From Name)',
    'settings.smtp_test_title': 'Test Connection & Send Trial Email',
    'settings.smtp_test_recipient_ph': 'Enter test recipient email...',
    'settings.smtp_test_btn': 'Test SMTP Connection',
    'settings.smtp_testing_btn': 'Sending Test Email...',
    'settings.smtp_save_btn': 'Save SMTP Configuration',
    'settings.smtp_saving_btn': 'Saving...',
    'settings.ui_customization_title': 'UI Text & Interface Dictionary Customization',
    'settings.ui_editor_card_title': 'Full Interface Text Editor',
    'settings.ui_editor_card_desc': 'Open dialog window to customize button texts, menus, tables, or error messages.',
    'settings.open_ui_editor_btn': 'Open UI Text Editor',
    'settings.export_csv_dict': 'Export CSV Dictionary',
    'settings.import_csv_dict': 'Import CSV Dictionary',
    'settings.reset_dict_btn': 'Reset to Default',
    'settings.danger_zone_title': 'Danger Zone: System Database Reset',
    'settings.danger_zone_desc': 'Resets all system settings and configurations to initial defaults (Manage Admin Access, Organizations, Departments, AI, Notifications, Storage) and clears all transaction data.',
    'settings.delete_all_transactions': 'Reset Entire System & All Settings',
    'settings.reset_db_btn': 'Reset System Database',
    'settings.resetting_db': 'Resetting Database...',
    'settings.reset_modal_title': 'Reset System Database',
    'settings.reset_modal_warning': 'This action is permanent and cannot be undone.',
    'settings.reset_modal_input_placeholder': 'RESET NOW',
    'settings.confirm_reset_btn': 'Reset Database',
    'partners.col_entity': 'Legal Entity',

    // Hierarchy View

    // Greetings
    'greeting.morning': 'Good Morning',
    'greeting.afternoon': 'Good Afternoon',
    'greeting.evening': 'Good Evening',
    'greeting.night': 'Good Night',

    // Login Page
    'login.google_button': 'Sign in with Google Account',
    'login.welcome': 'Welcome',
    'login.welcome_app': 'Welcome to {appName}',
    'login.setup_title': 'Create your admin account',
    'login.setup_subtitle': 'Set your website URL and create the first superuser.',
    'login.setup_submit': 'Create admin account',
    'login.setup_failed': 'Could not create the admin account.',
    'login.public_url_label': 'Website URL',
    'login.public_url_help': 'Include http:// or https:// and the public port if needed.',
    'login.create_account': 'Create Account',
    'login.fill_form_reg': 'Please fill in the form to register',
    'login.fill_form_login': 'Please sign in to access the application',
    'login.account_created_title': 'Account Created Successfully!',
    'login.account_pending_approval': 'Your account is pending Administrator approval.',
    'login.account_pending_approval_desc': 'You will be able to sign in once the Administrator approves your account.',
    'login.back_to_login': 'Back to Sign In',
    'login.fullname_label': 'Full Name',
    'login.fullname_placeholder': 'Full Name',
    'login.email_label': 'Email',
    'login.email_placeholder': 'name@email.com',
    'login.password_label': 'Password',
    'login.btn_register': 'Register',
    'login.btn_login': 'Sign In',
    'login.has_account_prompt': 'Already have an account? Sign In',
    'login.no_account_prompt': "Don't have an account? Register",
    'login.err_pending': 'Your account is pending Administrator approval. Please contact an Admin.',
    'login.err_failed': 'Failed to sign in. Please check your email and password.',
    'login.err_register_failed': 'Registration failed. Please check your details (password must be at least 8 characters) and try again.',

    // Modals

    // Common Buttons & Labels
    'common.reset': 'Reset',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.loading': 'Loading Data...',
    'common.yes': 'Yes',
    'common.no': 'No',

    // Form Entry Translations (Partner, Contract, IO Modals)
    'form.partner.title_add': 'Add New Partner',
    'form.partner.title_edit': 'Edit Partner Data',
    'form.partner.nama_legal': 'Legal Name *',
    'form.partner.nama_legal_placeholder': 'e.g., PT Telekomunikasi Selular',
    'form.partner.nama_channel': 'Channel Name',
    'form.partner.nama_channel_placeholder': 'e.g., TSEL, XL, INDOSAT',
    'form.partner.internal_pic': 'Internal PIC',
    'form.partner.contact_section_title': 'PIC Contact Information (Person In Charge)',
    'form.partner.nama_pic': 'PIC Name *',
    'form.partner.nama_pic_placeholder': 'e.g., Andi Hermawan',
    'form.partner.email_pic': 'PIC Email *',
    'form.partner.email_pic_placeholder': 'e.g., andi@telkomsel.co.id',
    'form.partner.telepon_pic': 'PIC Phone / WA Number *',
    'form.partner.telepon_pic_placeholder': 'e.g., 0811-2233-4455',
    'form.partner.alamat_pic': 'PIC Address *',
    'form.partner.alamat_pic_placeholder': 'e.g., Jl. Jend. Sudirman Kav 52-53...',
    'form.partner.kategori_kerjasama': 'Partnership Category *',
    'form.partner.tag_placeholder': 'Add category tag (e.g. Advertising, IT, Logistics)...',
    'form.partner.add_tag_btn': 'Add Tag',
    'form.partner.notes_label': 'Due Diligence / Internal Notes',
    'form.partner.save_btn': 'Save Partner',
    'form.partner.saving_btn': 'Saving Partner...',

    'form.contract.title_edit_addendum': 'Edit Agreement Addendum',
    'form.contract.title_edit_master': 'Edit Master Contract',
    'form.contract.title_add_addendum': 'Create & Upload New Agreement Addendum',
    'form.contract.title_add_master': 'Create & Upload New Contract',
    'form.contract.jenis_dokumen': 'Agreement Document Type *',
    'form.contract.master_agreement_opt': 'Master Agreement (Primary Master Contract)',
    'form.contract.agreement_addendum_opt': 'Agreement Addendum (Modification / Amendment)',
    'form.contract.partner_vendor': 'Partner *',
    'form.contract.ref_master_agreement': 'Reference Master Agreement *',
    'form.contract.select_master_placeholder': '-- Select Parent Master Agreement --',
    'form.contract.no_master_warning': 'Please select another partner or create a Master Agreement first.',
    'form.contract.changed_fields': 'Elements / Fields Changed *',
    'form.contract.track_change_summary': 'Track-Change Summary of Changes * (Required)',
    'form.contract.track_change_placeholder': 'Explicitly describe old value -> new value, old date -> new date, or clause modifications...',
    'form.contract.nomor_addendum': 'Addendum Number *',
    'form.contract.nomor_kontrak': 'Legal Contract Number *',
    'form.contract.judul_addendum': 'Addendum Agreement Title *',
    'form.contract.judul_kontrak': 'Contract Agreement Title *',
    'form.contract.judul_ph': 'e.g., PT Telkomsel_Master Agreement_Advertising-Content_2026-08-01',
    'form.contract.kategori_tag': 'Partnership Category Tags *',
    'form.contract.tanggal_mulai': 'Start Date *',
    'form.contract.tanggal_berakhir': 'End Date *',
    'form.contract.nilai_kontrak': 'Contract Value *',
    'form.contract.masa_notice': 'Notice Period (Days) *',
    'form.contract.notice_type': 'Notice Type Required *',
    'form.contract.auto_renewal': 'Auto Renewal',
    'form.contract.status_kontrak': 'Contract Status *',
    'form.contract.status_normal': 'Normal (As per effective date)',
    'form.contract.status_terminated': 'Terminated (Agreement Termination)',
    'form.contract.upload_label': 'Original Contract Document (Drive PDF Upload)',
    'form.contract.drag_pdf': 'Select or Drag Contract Document Here',
    'form.partner.drag_ref': 'Select or Drag Reference Document Here',
    'form.contract.file_selected': 'File selected:',
    'form.contract.save_btn': 'Save Contract Data',
    'form.contract.saving_btn': 'Saving Contract...',

    'form.io.title_edit': 'Edit Insertion Order',
    'form.io.title_add': 'Add New Insertion Order',
    'form.io.nomor_io': 'IO Number *',
    'form.io.nomor_io_ph': 'e.g., IO/DETIK/2026/012',
    'form.io.select_master': 'Select Parent Contract (Optional)',
    'form.io.standalone_opt': '-- Standalone IO (No Master Contract) --',
    'form.io.judul_campaign': 'Insertion Order / Campaign Title *',
    'form.io.judul_ph': 'e.g., PT Telkomsel_IO_Digital Banner & Social Media_2026-08-01',
    'form.io.partner_media': 'Partner / Media Channel *',
    'form.io.kanal_media': 'Media Channel / Placement *',
    'form.io.kanal_ph': 'e.g., Homepage Masthead & Instagram Live Session',
    'form.io.pricing_model': 'Pricing Model *',
    'form.io.pricing_model_custom_ph': 'Enter new pricing model name (e.g. CPV, Hybrid)...',
    'form.io.charging_type': 'Charging Type *',
    'form.io.currency': 'Currency',
    'form.io.tanggal_mulai': 'Start Date *',
    'form.io.tanggal_selesai': 'End Date *',
    'form.io.nilai_io': 'IO Value *',
    'form.io.deliverables': 'Structured Deliverables Details *',
    'form.io.deliverables_ph': 'Specify impression guarantee details, SMS quota, banner views, or article count...',
    'form.io.upload_label': 'Original IO Document (Drive PDF Upload)',
    'form.io.select_pdf': 'Select or Drag Insertion Order Document Here',
    'form.io.save_btn': 'Save Insertion Order',
    'form.io.saving_btn': 'Saving IO...',

    'form.common.cancel': 'Cancel',
    'form.common.required_hint': 'Fill out all required fields (*) to save',

    // Partner Spending
    'spending.invoice_suffix': 'Invoices',
    'spending.search_placeholder': 'Search Invoice Number, Partner, description...',
    'spending.all_vendors': 'All Partners',
    'spending.col_invoice_no': 'Invoice No.',
    'spending.col_vendor': 'Partner',
    'spending.col_month': 'Month Period',
    'spending.col_amount': 'Total Amount',
    'spending.col_date': 'Invoice Date',
    'spending.col_invoice_doc': 'Invoice',
    'spending.col_billing_doc': 'Billing',
    'spending.col_action': 'Action',
    'spending.no_data': 'No spending data recorded.',
    'spending.modal_title': 'Input Spending Data',
    'spending.modal_edit_title': 'Edit Spending Data',
    'spending.vendor_name_label': 'Partner Name',
    'spending.vendor_select_ph': '-- Select Partner --',
    'spending.invoice_no_label': 'Invoice Number',
    'spending.invoice_no_ph': 'e.g., INV-2026-0801',
    'spending.invoice_date_label': 'Invoice Date',
    'spending.invoice_month_label': 'Invoice Month',
    'spending.add_month_btn': '+ Add Month',
    'spending.invoice_desc_label': 'Invoice Description',
    'spending.invoice_desc_ph': 'Short spending description...',
    'spending.currency_label': 'Currency',
    'spending.total_amount_label': 'Total Amount',
    'spending.total_amount_ph': '150000000',
    'spending.bank_info_title': 'Bank Account Information (Auto-filled if previously entered)',
    'spending.bank_name_label': 'Bank Name',
    'spending.bank_account_no_label': 'Account Number',
    'spending.bank_account_holder_label': 'Account Holder',
    'spending.upload_invoice_label': 'Upload Invoice',
    'spending.upload_billing_label': 'Upload Billing',
    'spending.cancel_btn': 'Cancel',
    'spending.save_btn': 'Save Spending',
    'spending.saving_btn': 'Saving...',
    'form.amendment.notes_ph': 'Explain explicitly old value -> new value, old date -> new date, or clause changes...',
    'contract.addendum_list': 'Derived Agreement Addendum List',
    'form.partner.err_nama_legal': 'Legal Name is required.',
    'form.partner.err_nama_pic': 'PIC Name is required.',
    'form.partner.err_email_pic': 'PIC Email is required.',
    'form.partner.err_telepon_pic': 'PIC Phone Number is required.',
    'form.partner.err_tags': 'At least 1 partnership category tag is required.',
    'settings.search_ui_text': 'Search keyword, key ID, or UI text...',

    // Audit Table Keys
    'audit_col_vendorName': 'Partner Name',
    'audit_col_vendorType': 'Partner Type',
    'audit_col_vendorStatus': 'Partner Status',
    'audit_col_vendorStartDate': 'Partner Start Date',
    'audit_col_vendorEndDate': 'Partner End Date',
    'audit_col_vendorDuration': 'Partner Active Duration',
    'audit_col_vendorPic': 'External PIC',
    'audit_col_vendorPicInternal': 'Internal PIC',
    'audit_col_vendorBadanHukum': 'Legal Entity',
    'audit_col_vendorStatusDD': 'Due Diligence Status',
    'audit_col_evalReviewDate': 'Eval Review Date',
    'audit_col_evalTypeOfWork': 'Type of Work (Eval)',
    'audit_col_evalSlaScore': 'SLA Score',
    'audit_col_evalObligation': 'Obligation Target',
    'audit_col_evalIncident': 'Incident Frequency',
    'audit_col_evalCommunication': 'Communication',
    'audit_col_evalPricing': 'Pricing Suitability',
    'audit_col_evalFinal': 'Final Evaluation',
    'audit_col_evalNotes': 'Evaluation Notes',
    'audit_col_spendInvoiceNo': 'Invoice Number',
    'audit_col_spendInvDate': 'Invoice Date',
    'audit_col_spendAmount': 'Spending Amount',
    'audit_col_spendInvoiceLink': 'Invoice Link',
    'audit_col_spendBillingLink': 'Billing Link',
    'audit_col_contractNo': 'Contract Number',
    'audit_col_contractTitle': 'Contract Title',
    'audit_col_contractStatus': 'Contract Status',
    'audit_col_contractStartDate': 'Contract Start Date',
    'audit_col_contractEndDate': 'Contract End Date',
    'audit_col_contractDuration': 'Contract Duration',
    'audit_col_contractValue': 'Contract Value',
    'audit_col_contractKategori': 'Partnership Category',
    'audit_col_contractAutoRenewal': 'Auto Renewal',
    'audit_col_contractNoticePeriod': 'Notice Period (Days)',
    'audit_col_contractStatusApproval': 'Contract Approval Status',
    'audit_col_contractLink': 'Contract Doc Link',
    'audit_col_ioNo': 'IO Number',
    'audit_col_ioTitle': 'IO Title',
    'audit_col_ioStatus': 'IO Status',
    'audit_col_ioChannel': 'Media Channel',
    'audit_col_ioStartDate': 'IO Start Date',
    'audit_col_ioEndDate': 'IO End Date',
    'audit_col_ioDuration': 'IO Duration',
    'audit_col_ioPricingModel': 'IO Pricing Model',
    'audit_col_ioPricingDetail': 'IO Pricing Detail',
    'audit_col_ioChargingType': 'IO Charging Type',
    'audit_col_ioValue': 'IO Value',
    'audit_col_ioLink': 'IO Doc Link',
    'hierarchy.data_not_found': 'Data not found.',
    'audit_group_vendor': 'Partner',
    'audit_group_evaluation': 'Evaluation',
    'audit_group_spending': 'Spending',
    'audit_group_contract': 'Contract',
    'audit_group_io': 'IO',
    'admin.test_connection_testing': 'Testing Connection...',
    'admin.copied': 'Copied!',

    // Contract Creator — UI chrome (Panel Asisten Kontrak, toolbar, footer)
    'contract_creator.title_input_title': 'Click to edit the document title',
    'contract_creator.title_input_placeholder': 'Agreement Document Title',
    'contract_creator.mode_edit_title': 'Edit the contract text directly in Indonesian',
    'contract_creator.mode_edit_label': 'Edit',
    'contract_creator.mode_preview_title': 'Preview the final document layout',
    'contract_creator.mode_preview_label': 'Preview',
    'contract_creator.download_title': 'Download Word (.doc) file',
    'contract_creator.download_label': 'Download',
    'contract_creator.enter_fullscreen': 'Fullscreen View',
    'contract_creator.exit_fullscreen': 'Exit Fullscreen',
    'contract_creator.sidebar_toggle_title': 'Open / Close the Form & Clause Shortcut Panel',
    'contract_creator.reset_template_title': 'Restore the content to the original 15-article Cooperation Agreement template',
    'contract_creator.reset_template_label': 'Reset Template',

    'contract_creator.msg.custom_field_name_required': 'Field name has not been entered',
    'contract_creator.msg.template_name_required': 'Template name has not been entered',
    'contract_creator.msg.template_content_empty': 'Template content is still empty',
    'contract_creator.msg.template_saved': 'Cooperation template saved successfully',
    'contract_creator.msg.template_save_failed': 'Failed to save template',
    'contract_creator.msg.template_save_error': 'An error occurred while saving the template',
    'contract_creator.msg.template_loaded_prefix': 'Template',
    'contract_creator.msg.template_loaded_suffix': 'was loaded into the editor successfully.',
    'contract_creator.msg.partner_synced_prefix': 'Partner data',
    'contract_creator.msg.partner_synced_suffix': 'was synced into the 15-article Cooperation Agreement successfully!',
    'contract_creator.msg.partner_synced_fields': 'was filled into the document fields.',
    'contract_creator.msg.reset_done': 'The 15-article Cooperation Agreement template has been reset to its original state.',
    'contract_creator.msg.docx_downloaded': 'Word (.doc) document file downloaded successfully!',
    'contract_creator.msg.docx_download_failed': 'Failed to download document',
    'contract_creator.msg.template_deleted': 'Cooperation template deleted successfully',
    'contract_creator.msg.template_delete_failed': 'Failed to delete template',
    'contract_creator.msg.template_delete_error': 'An error occurred while deleting the template',

    'contract_creator.confirm.use_template_prefix': 'Use template',
    'contract_creator.confirm.use_template_suffix': '? The current contract text will be replaced.',
    'contract_creator.confirm.reset_desc': 'Reset the document to its original template? Unsaved changes will be lost.',
    'contract_creator.confirm.reset_label': 'Reset',
    'contract_creator.confirm.delete_template_desc': 'Delete this cooperation template?',
    'contract_creator.confirm.delete_label': 'Delete',

    'contract_creator.panel_title': 'Contract Assistant Panel',
    'contract_creator.tab.fields': 'Fields',
    'contract_creator.tab.partners': 'Partners',
    'contract_creator.tab.templates': 'Templates',

    'contract_creator.field.contract_no.title': 'Reference number or official letter number for the cooperation agreement',
    'contract_creator.field.contract_no.label': 'Cooperation Agreement Number',
    'contract_creator.filled_badge': 'Filled',
    'contract_creator.jump_to_slot': 'Jump to the field position in the document',
    'contract_creator.custom_fields_section_title': 'Your Custom Fields',
    'contract_creator.custom_badge': 'Custom',
    'contract_creator.optional_badge': 'Optional',
    'contract_creator.custom_field_recovered_desc': 'Custom field recovered automatically from the document (original label was not saved).',
    'contract_creator.delete_custom_field_title': 'Delete custom field',

    'contract_creator.partners.select_label_title': 'Automatically fills in the legal entity name, office domicile, signing director, and official email across all agreement articles',
    'contract_creator.partners.select_label': 'Select Existing Partner',
    'contract_creator.partners.select_placeholder': 'Select Partner',
    'contract_creator.partners.default_address': 'Registered Address',
    'contract_creator.partners.default_position': 'Director',
    'contract_creator.partners.resync_button': 'Re-sync to Document',

    'contract_creator.templates.save_section_title_attr': 'Save all of the current custom contract text as a reusable master template',
    'contract_creator.templates.save_section_title': 'Save Draft As Template',
    'contract_creator.templates.name_placeholder': 'Template name (e.g. Server Lease Template)',
    'contract_creator.templates.saving': 'Saving...',
    'contract_creator.templates.save_button': 'Save Template',
    'contract_creator.templates.library_title': 'Registered Template Library',
    'contract_creator.templates.loading': 'Loading library...',
    'contract_creator.templates.empty': 'No templates have been saved yet.',
    'contract_creator.templates.use_button': 'Use',
    'contract_creator.templates.delete_title': 'Delete Template',

    'contract_creator.ai_template.section_title_attr': 'Draft a new template from a short description',
    'contract_creator.ai_template.section_title': 'Generate Template with AI',
    'contract_creator.ai_template.type_contract': 'Contract',
    'contract_creator.ai_template.type_agreement': 'Agreement',
    'contract_creator.ai_template.type_so': 'Service Order (SO)',
    'contract_creator.ai_template.prompt_placeholder': 'Example: mutual NDA between two tech companies, 3-year confidentiality',
    'contract_creator.ai_template.generate_button': 'Generate Template',
    'contract_creator.ai_template.generating': 'Generating draft...',
    'contract_creator.ai_template.prompt_required': 'Template description is required',
    'contract_creator.ai_template.confirm_overwrite': 'The current draft has unsaved changes that will be replaced by the AI result. Continue?',
    'contract_creator.ai_template.failed': 'Failed to generate template',
    'contract_creator.ai_template.generated': 'AI draft ready — review it, then click Save Template',
    'contract_creator.ai_template.error': 'An error occurred while generating the template',

    'contract_creator.custom_field_builder.create_button': 'Create New Custom Field',
    'contract_creator.custom_field_builder.close': 'Close',
    'contract_creator.custom_field_builder.add': 'Add',
    'contract_creator.custom_field_builder.name_label': 'Field Name',
    'contract_creator.custom_field_builder.name_placeholder': 'Example: Additional Compensation',
    'contract_creator.custom_field_builder.type_label': 'Field Type',
    'contract_creator.custom_field_builder.type_text': 'Plain text',
    'contract_creator.custom_field_builder.type_date': 'Date',
    'contract_creator.custom_field_builder.type_currency': 'Currency',
    'contract_creator.custom_field_builder.type_textarea': 'Paragraph / Textarea',
    'contract_creator.custom_field_builder.placeholder_label': 'Default Placeholder',
    'contract_creator.custom_field_builder.placeholder_placeholder': 'Example: Rp 50,000,000 (Fifty Million)',
    'contract_creator.custom_field_builder.description_label': 'Notes / Description',
    'contract_creator.custom_field_builder.description_placeholder': 'A short description of what this field is for',
    'contract_creator.custom_field_builder.submit_button': 'Create New Field',

    'contract_creator.dragdrop.section_title_attr': 'Drag an element to the cursor position in the document to place a dynamic field',
    'contract_creator.dragdrop.section_title': 'Drag & Drop Fields',
    'contract_creator.dragdrop.cat_all': 'All',
    'contract_creator.dragdrop.cat_first_party': 'Party I',
    'contract_creator.dragdrop.cat_partner': 'Party II',
    'contract_creator.dragdrop.cat_operational': 'Terms',
    'contract_creator.dragdrop.empty_category': 'No fields in this category.',
    'contract_creator.dragdrop.item_title_attr': 'Drag this element into the editor',

    'contract_creator.footer.words': 'words',
    'contract_creator.footer.chars': 'characters',
    'contract_creator.footer.read_estimate': 'Estimated read',
    'contract_creator.footer.minutes': 'min',
    'contract_creator.footer.custom_template_active': 'Custom Cooperation Template Active',
    'contract_creator.footer.default_template_active': '15-Article Cooperation Agreement',
    'contract_creator.footer.zoom_out': 'Zoom Out',
    'contract_creator.footer.zoom_in': 'Zoom In',
    'contract_creator.footer.zoom_reset': 'Reset Zoom to 100%',

    // Contract Creator — field labels/placeholders/descriptions (Fields tab)
    'contract_creator.field.firstPartyName.label': 'First Party Company Name',
    'contract_creator.field.firstPartyName.placeholder': 'PT First Party Company Name',
    'contract_creator.field.firstPartyName.description': 'The legal entity or company of the First Party entering into the agreement',
    'contract_creator.field.firstPartyAlias.label': 'First Party Abbreviation / Alias',
    'contract_creator.field.firstPartyAlias.placeholder': 'Short abbreviation / alias for the First Party',
    'contract_creator.field.firstPartyAlias.description': 'Short designation for the First Party used within the agreement clauses',
    'contract_creator.field.firstPartyAddress.label': 'First Party Office Address',
    'contract_creator.field.firstPartyAddress.placeholder': 'Full registered office address of the First Party',
    'contract_creator.field.firstPartyAddress.description': 'Legal domicile address of the First Party for official correspondence',
    'contract_creator.field.firstPartyPic.label': 'First Party Signatory Name',
    'contract_creator.field.firstPartyPic.placeholder': 'Name of the Director / Authorized Officer of the First Party',
    'contract_creator.field.firstPartyPic.description': "The First Party's authorized representative who signs the agreement",
    'contract_creator.field.firstPartyPosition.label': 'First Party Signatory Position',
    'contract_creator.field.firstPartyPosition.placeholder': 'President Director / Director',
    'contract_creator.field.firstPartyPosition.description': "Legal capacity of the First Party's officer",
    'contract_creator.field.firstPartyEmail.label': 'First Party Official Email',
    'contract_creator.field.firstPartyEmail.placeholder': 'legal@firstparty-company.co.id',
    'contract_creator.field.firstPartyEmail.description': 'Official correspondence and notification email address of the First Party (Article 13)',
    'contract_creator.field.firstPartyBusinessDesc.label': 'First Party Business Description (Recitals)',
    'contract_creator.field.firstPartyBusinessDesc.placeholder': "Description of the First Party's permits and line of business...",
    'contract_creator.field.firstPartyBusinessDesc.description': "Description of the First Party's line of business in the recitals section",
    'contract_creator.field.partnerName.label': 'Second Party Company Name',
    'contract_creator.field.partnerName.placeholder': 'PT Partner Company Name',
    'contract_creator.field.partnerName.description': 'The legal entity or partner company entering into the cooperation',
    'contract_creator.field.partnerAddress.label': 'Second Party Office Address',
    'contract_creator.field.partnerAddress.placeholder': 'Full registered office address of the partner',
    'contract_creator.field.partnerAddress.description': 'Legal and correspondence address of the Second Party',
    'contract_creator.field.partnerPic.label': 'Second Party Signatory Name',
    'contract_creator.field.partnerPic.placeholder': 'Full Name of the Director / Authorized Representative',
    'contract_creator.field.partnerPic.description': 'The authorized officer representing the partner who signs the agreement',
    'contract_creator.field.partnerPosition.label': 'Second Party Signatory Position',
    'contract_creator.field.partnerPosition.placeholder': 'President Director / Director',
    'contract_creator.field.partnerPosition.description': "Legal capacity of the partner's signing officer",
    'contract_creator.field.partnerEmail.label': 'Second Party Official Email',
    'contract_creator.field.partnerEmail.placeholder': 'legal@partner.co.id',
    'contract_creator.field.partnerEmail.description': 'Official notification and legal correspondence email of the partner (Article 13)',
    'contract_creator.field.dateStr.label': 'Signing Date',
    'contract_creator.field.dateStr.placeholder': 'September 19, 2026',
    'contract_creator.field.dateStr.description': 'Effective date the cooperation agreement is executed',
    'contract_creator.field.startDate.label': 'Effective Start Date',
    'contract_creator.field.startDate.placeholder': 'September 19, 2026',
    'contract_creator.field.startDate.description': 'Start of the cooperation period (Article 3)',
    'contract_creator.field.endDate.label': 'End Date',
    'contract_creator.field.endDate.placeholder': 'September 18, 2027',
    'contract_creator.field.endDate.description': 'End of the cooperation period before renewal (Article 3)',
    'contract_creator.field.scopeDescId.label': 'Scope of Cooperation',
    'contract_creator.field.scopeDescId.placeholder': 'provision of technology services, information system integration, and joint operational support',
    'contract_creator.field.scopeDescId.description': 'Description of the main activities and deliverables agreed upon (Article 2)',
    'contract_creator.field.feeAmountId.label': 'Cooperation Value / Service Fee',
    'contract_creator.field.feeAmountId.placeholder': 'Rp 100,000,000 (One Hundred Million Rupiah) excluding VAT',
    'contract_creator.field.feeAmountId.description': 'Agreed compensation or service fee (Article 5)',
    'contract_creator.field.bankName.label': 'Payment Bank Name',
    'contract_creator.field.bankName.placeholder': 'PT Bank Central Asia Tbk (BCA)',
    'contract_creator.field.bankName.description': 'Official bank receiving payment (Article 5)',
    'contract_creator.field.bankAccount.label': 'Bank Account Number',
    'contract_creator.field.bankAccount.placeholder': '5271-889-001',
    'contract_creator.field.bankAccount.description': 'Destination account number for payment transfers',
    'contract_creator.field.bankHolder.label': 'Account Holder Name',
    'contract_creator.field.bankHolder.placeholder': 'Bank Account Holder Name',
    'contract_creator.field.bankHolder.description': 'Name of the official bank account holder for the receiving party',
  }
};

/** Built-in catalog: base keys plus newer feature keys kept in src/i18n. */
export const translations: Record<Language, Record<string, string>> = {
  ID: { ...baseTranslations.ID, ...EXTRA_TRANSLATIONS.ID, ...UI_REFINEMENTS.ID, ...BACKUP_TRANSLATIONS.ID, ...MAILER_TRANSLATIONS.ID, ...DOCUMENT_CALENDAR_TRANSLATIONS.ID, ...CONTRACT_TERMINATION_TRANSLATIONS.ID, ...TENANT_BOUNDARIES_TRANSLATIONS.ID, ...TREE_TRANSLATIONS.ID },
  EN: { ...baseTranslations.EN, ...EXTRA_TRANSLATIONS.EN, ...UI_REFINEMENTS.EN, ...BACKUP_TRANSLATIONS.EN, ...MAILER_TRANSLATIONS.EN, ...DOCUMENT_CALENDAR_TRANSLATIONS.EN, ...CONTRACT_TERMINATION_TRANSLATIONS.EN, ...TENANT_BOUNDARIES_TRANSLATIONS.EN, ...TREE_TRANSLATIONS.EN },
  ZH: { ...ZH_TRANSLATIONS, ...UI_REFINEMENTS.ZH, ...BACKUP_TRANSLATIONS.ZH, ...MAILER_TRANSLATIONS.ZH, ...DOCUMENT_CALENDAR_TRANSLATIONS.ZH, ...CONTRACT_TERMINATION_TRANSLATIONS.ZH, ...TENANT_BOUNDARIES_TRANSLATIONS.ZH, ...TREE_TRANSLATIONS.ZH },
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

/**
 * Translation for code that runs outside the React tree (error boundary, library errors).
 * Uses the personal language and the latest shared dictionary; no document terminology.
 */
export function translateStatic(key: string, defaultText?: string, vars?: Record<string, string | number>): string {
  let language: Language = 'EN';
  let custom: Record<string, string> = {};
  try {
    const saved = readPreference('language');
    if (isLanguage(saved)) language = saved;
    custom = sharedCustomTranslations[language];
  } catch {
    /* storage unavailable — English catalog */
  }
  let text = custom[key] || translations[language][key] || (language !== 'EN' ? translations.EN[key] : '') || defaultText || key;
  for (const [name, value] of Object.entries(vars || {})) text = text.split(`{${name}}`).join(String(value));
  return text;
}

/** Column headers of the UI text CSV (export and re-import). */
const CSV_HEADERS = ['Key', 'Module', 'Bahasa_Indonesia', 'English', 'Chinese_简体中文'];

// Utility functions for CSV parsing
function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function splitCSVLines(text: string): string[] {
  const lines: string[] = [];
  let currentLine = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      currentLine += char;
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') {
        i++;
      }
      if (currentLine.trim()) {
        lines.push(currentLine);
      }
      currentLine = '';
    } else {
      currentLine += char;
    }
  }
  if (currentLine.trim()) {
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Language stays personal. System Admin edits the server dictionary shared
 * by all users; active pages refresh it every five seconds and on focus.
 */
export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const identity = useOptionalIdentity();
  const userId = identity?.id ?? null;
  const [language, setLanguageState] = useState<Language>('EN');
  const queryClient = useQueryClient();
  const queryKey = ['platform', 'ui-texts'];
  const dictionary = useQuery<UITextDictionary>({
    queryKey,
    queryFn: async () => {
      const response = await fetch('/api/system/ui-texts', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load shared UI texts.');
      return response.json();
    },
    // ponytail: one read per active browser every 5s; use SSE if polling load becomes significant.
    refetchInterval: 5_000,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const customTranslations = dictionary.data?.overrides || emptyCatalogs();
  useEffect(() => { sharedCustomTranslations = customTranslations; }, [customTranslations]);
  const saveDictionary = useMutation({
    mutationFn: async (values: { overrides?: Partial<UITextOverrides>; reset?: true }): Promise<UITextDictionary> => {
      const response = await fetch('/api/platform/configuration', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'uiTexts', values }),
      });
      if (!response.ok) throw new Error(translations[language]['tb.texts_save_failed']);
      return response.json();
    },
    onSuccess: (data) => {
      sharedCustomTranslations = data.overrides;
      queryClient.setQueryData(queryKey, data);
    },
  });
  const translationsBusy = !dictionary.isSuccess || saveDictionary.isPending;

  // Switching identity loads that identity's preferences (or the defaults).
  useEffect(() => {
    setPreferenceUser(userId);
    const saved = readPreference('language');
    setLanguageState((current) => (isLanguage(saved) ? saved : userId ? 'EN' : current));
  }, [userId]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    writePreference('language', lang);
  };

  // Screen readers pick pronunciation from <html lang>.
  useEffect(() => {
    document.documentElement.lang = LANGUAGE_OPTIONS.find((o) => o.code === language)?.htmlLang || 'en';
  }, [language]);

  const [terms, setTerms] = useState<DocumentTerminology>(LEGACY_TERMS);
  const setDocumentTerminology = useCallback((next: DocumentTerminology) => {
    setTerms((prev) => (prev.doc === next.doc && prev.docs === next.docs && prev.docShort === next.docShort ? prev : next));
  }, []);

  const resolve = (key: string, defaultText?: string): string => {
    // 1. Custom overrides for the current language
    const customPrimary = customTranslations[language]?.[key];
    if (customPrimary !== undefined && customPrimary !== '') return customPrimary;

    // 2. Built-in catalog for the current language
    const primary = translations[language]?.[key];
    if (primary !== undefined && primary !== '') return primary;

    // 3. English UI with no English entry: use the caller's default text,
    //    then the Indonesian catalog as a last resort.
    if (language === 'EN') {
      return defaultText || translations.ID[key] || key;
    }
    // 4. Indonesian and Chinese UIs fall back to English.
    const customFallback = customTranslations.EN?.[key];
    if (customFallback !== undefined && customFallback !== '') return customFallback;
    const fallback = translations.EN?.[key];
    if (fallback !== undefined && fallback !== '') return fallback;
    return defaultText || key;
  };

  const t = (key: string, defaultText?: string, vars?: Record<string, string | number>): string => {
    let text = applyTerminology(resolve(key, defaultText), terms);
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.split(`{${name}}`).join(String(value));
      }
    }
    return text;
  };

  const exportToCSV = () => {
    const codes: Language[] = ['ID', 'EN', 'ZH'];
    const allKeys = Array.from(
      new Set(codes.flatMap((code) => [...Object.keys(translations[code]), ...Object.keys(customTranslations[code] || {})])),
    ).sort();

    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = [CSV_HEADERS.join(',')];
    for (const key of allKeys) {
      const module = key.split('.')[0] || 'General';
      const texts = codes.map((code) => customTranslations[code]?.[key] || translations[code]?.[key] || '');
      rows.push([key, module, ...texts].map(quote).join(','));
    }

    // UTF-8 BOM so Excel opens with proper UTF-8 encoding
    const csvContent = '\uFEFF' + rows.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `LMS_UI_Texts_Structure_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const importFromCSV = async (csvContent: string): Promise<{ success: boolean; updatedCount: number; error?: string }> => {
    try {
      const cleanContent = csvContent.replace(/^\uFEFF/, '');
      const lines = splitCSVLines(cleanContent);
      if (lines.length < 2) {
        return { success: false, updatedCount: 0, error: t('ui_text.import_empty', 'File CSV kosong atau tidak memiliki baris data.') };
      }

      const headerRow = parseCSVRow(lines[0]).map((h) => h.toLowerCase().replace(/^"|"$/g, '').trim());
      const findColumn = (names: string[], fallback: number) => {
        const index = headerRow.findIndex((h) => names.some((name) => h === name || h.startsWith(`${name}_`) || h.startsWith(`${name} `)));
        return index === -1 ? fallback : index;
      };
      const keyIdx = findColumn(['key'], 0);
      const columns: Array<[Language, number]> = [
        ['ID', findColumn(['bahasa_indonesia', 'bahasa indonesia', 'indonesian', 'id'], 2)],
        ['EN', findColumn(['english', 'en'], 3)],
        ['ZH', findColumn(['chinese', 'zh', 'cn', '中文', '简体中文'], 4)],
      ];

      let updatedCount = 0;
      const newCustom = emptyCatalogs();

      for (let i = 1; i < lines.length; i++) {
        const row = parseCSVRow(lines[i]);
        if (row.length <= keyIdx) continue;
        const key = row[keyIdx]?.replace(/^"|"$/g, '').trim();
        if (!key) continue;
        for (const [code, index] of columns) {
          const value = index < row.length ? row[index]?.replace(/^"|"$/g, '').trim() : undefined;
          if (value) newCustom[code][key] = value === translations[code][key] ? '' : value;
        }
        updatedCount++;
      }

      await saveDictionary.mutateAsync({ overrides: newCustom });
      return { success: true, updatedCount };
    } catch (err: any) {
      return { success: false, updatedCount: 0, error: err.message || t('ui_text.import_failed', 'Gagal memproses file CSV.') };
    }
  };

  const resetCustomTranslations = async () => {
    await saveDictionary.mutateAsync({ reset: true });
  };

  const updateSingleTranslation = async (key: string, lang: Language, value: string) => {
    await saveDictionary.mutateAsync({ overrides: { [lang]: { [key]: value === translations[lang][key] ? '' : value } } });
  };

  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        t,
        setDocumentTerminology,
        translations,
        customTranslations,
        exportToCSV,
        importFromCSV,
        resetCustomTranslations,
        updateSingleTranslation,
        translationsBusy,
        translationsError: dictionary.isError ? t('tb.texts_load_failed') : null,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
