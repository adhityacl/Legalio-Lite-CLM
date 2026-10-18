/**
 * Data field names were Indonesian (`nomor_kontrak`, `tanggal_berakhir`, ...) and are now English.
 * This map is the single record of old -> new, used by the SQLite migration, by import (old CSV headers),
 * by API request bodies from older clients and by legacy payload migration. Responses only ever use new names.
 */
export const LEGACY_FIELD_NAMES: Readonly<Record<string, string>> = {
  // partners
  nama_partner: 'partner_name',
  partner_nama: 'partner_name',
  jenis_partner: 'partner_type',
  nama_pic: 'pic_name',
  email_pic: 'pic_email',
  telepon_pic: 'pic_phone',
  alamat_pic: 'pic_address',
  kontak_pic: 'pic_contact',
  pic_internal: 'internal_pic',
  link_folder_dd: 'dd_folder_link',
  daftar_dokumen_dd: 'dd_documents',
  tanggal_dd_diverifikasi: 'dd_verified_date',
  badan_hukum: 'legal_status_flag',
  catatan: 'notes',
  // due-diligence documents and files
  nama: 'name',
  wajib: 'required',
  nomor_dokumen: 'document_number',
  tanggal_kadaluarsa: 'expiry_date',
  nomorDokumen: 'documentNumber',
  tanggalKadaluarsa: 'expiryDate',
  // contracts
  jenis_dokumen: 'document_type',
  parent_contract_nomor: 'parent_contract_number',
  nomor_kontrak: 'contract_number',
  judul_kontrak: 'contract_title',
  kategori_kerjasama: 'cooperation_categories',
  tanggal_mulai: 'start_date',
  tanggal_berakhir: 'end_date',
  tanggal_selesai: 'completion_date',
  nilai_kontrak: 'contract_value',
  nilai_kontrak_usd: 'contract_value_usd',
  notice_period_hari: 'notice_period_days',
  link_file_kontrak: 'contract_file_link',
  field_yang_berubah: 'changed_fields',
  ringkasan_perubahan: 'change_summary',
  sisa_hari: 'days_remaining',
  nomor_addendum: 'addendum_number',
  tanggal_addendum: 'addendum_date',
  link_file_addendum: 'addendum_file_link',
  // insertion orders
  nomor_io: 'io_number',
  judul_io: 'io_title',
  kanal_media: 'media_channel',
  skema_pembayaran: 'payment_scheme',
  model_pembayaran: 'pricing_model',
  mata_uang: 'currency',
  nilai_io: 'io_value',
  nilai_io_usd: 'io_value_usd',
  link_file_io: 'io_file_link',
  contract_nomor: 'contract_number',
  // notifications
  parent_nomor: 'parent_number',
  parent_judul: 'parent_title',
  jenis_notifikasi: 'notification_type',
  tanggal_terkirim: 'sent_at',
  status_terkirim: 'is_sent',
  penerima: 'recipient',
  pesan: 'message',
  pesan_params: 'message_params',
};

/**
 * Returns `value` with every legacy key renamed, at any depth. When a record carries both the old and the new
 * key, the new one wins. Non-plain values (strings, Dates, class instances) are returned untouched.
 */
export function renameLegacyKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(renameLegacyKeys) as unknown as T;
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    const target = LEGACY_FIELD_NAMES[key] ?? key;
    if (target !== key && Object.prototype.hasOwnProperty.call(source, target)) continue;
    result[target] = renameLegacyKeys(child);
  }
  return result as T;
}

const COMPOUND_RENAMES = Object.entries(LEGACY_FIELD_NAMES)
  // Generic words (nama, catatan, ...) also occur in ordinary text, so only compound names are rewritten inside keys.
  .filter(([old]) => old.includes('_') || /[A-Z]/.test(old))
  .sort((a, b) => b[0].length - a[0].length)
  .map(([old, current]) => [new RegExp(`(?<![A-Za-z0-9_])${old}(?![A-Za-z0-9_])`, 'g'), current] as const);

/** Renames legacy field names inside a dotted UI-text key, e.g. `form.contract.nomor_kontrak` -> `form.contract.contract_number`. */
export function renameLegacyKeyTokens(key: string): string {
  return COMPOUND_RENAMES.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), key);
}
