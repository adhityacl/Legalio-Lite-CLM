/** SQLite business schema. API names stay stable at the storage boundary. */
export type FieldKind = 'text' | 'number' | 'boolean' | 'json' | 'money';
export interface Field { api: string; sql: string; kind: FieldKind }
export interface EntitySchema { table: string; key: string; collection: string; fields: Field[]; search: string[] }
const snake = (name: string) => name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
const fields = (names: string, kind: FieldKind = 'text'): Field[] => names.split(/\s+/).filter(Boolean).map(api => ({ api, sql: snake(api), kind }));
const dates = fields('created_at updated_at');
const lifecycle = [...fields('lifecycle_mode termination_date termination_reason'), ...fields('termination_document', 'json')];
export const ENTITIES: EntitySchema[] = [
  { table: 'partners', key: 'partner_id', collection: 'partners', search: ['nama_partner', 'codename', 'jenis_partner', 'catatan'], fields: [
    ...fields('nama_partner country entity_type jenis_partner nama_pic email_pic telepon_pic alamat_pic pic_internal codename status_dd link_folder_dd tanggal_dd_diverifikasi catatan'), ...dates,
  ] },
  { table: 'contracts', key: 'contract_id', collection: 'contracts', search: ['nomor_kontrak', 'judul_kontrak', 'internal_notes', 'ringkasan_perubahan'], fields: [
    ...fields('jenis_dokumen parent_contract_id nomor_kontrak judul_kontrak partner_id tanggal_mulai tanggal_berakhir tanggal_selesai currency notice_type_required status status_approval pic_internal link_file_kontrak fileName internal_notes ringkasan_perubahan redline_analyzed_at'),
    ...fields('nilai_kontrak nilai_kontrak_usd', 'money'), ...fields('notice_period_hari', 'number'), ...fields('auto_renewal', 'boolean'), ...fields('redline_analysis field_yang_berubah', 'json'), ...lifecycle, ...dates,
  ] },
  { table: 'insertion_orders', key: 'io_id', collection: 'ios', search: ['nomor_io', 'judul_io', 'kanal_media', 'deliverables', 'internal_notes'], fields: [
    ...fields('contract_id nomor_io judul_io partner_id kanal_media tanggal_mulai tanggal_berakhir tanggal_selesai pricing_model charging_type skema_pembayaran currency deliverables notice_type_required status internal_notes link_file_io fileName'),
    ...fields('nilai_io nilai_io_usd', 'money'), ...fields('notice_period_hari', 'number'), ...dates,
  ] },
  { table: 'spendings', key: 'id', collection: 'spendings', search: ['vendor_name', 'invoice_number', 'invoice_title', 'invoice_description'], fields: [
    ...fields('vendor_id vendor_name invoice_number invoice_date invoice_title invoice_description currency payment_status bank_name bank_account_number bank_account_holder_name invoice_file_url invoice_file_name billing_file_url billing_file_name folder_link'),
    ...fields('total_amount total_amount_usd', 'money'), ...dates,
  ] },
  { table: 'evaluations', key: 'id', collection: 'evaluations', search: ['supplier_name', 'type_of_work', 'notes', 'final_evaluation'], fields: [
    ...fields('partner_id review_date supplier_name type_of_work obligation_target incident_frequency communication pricing final_evaluation recommendation_status notes evaluator_email evaluator_name'),
    ...fields('sla_score calculated_score total_score', 'number'), ...dates,
  ] },
  { table: 'notifications', key: 'notif_id', collection: 'notifications', search: [], fields: [
    ...fields('parent_type parent_id parent_nomor parent_judul jenis_notifikasi tanggal_terkirim penerima pesan'),
    ...fields('status_terkirim is_read', 'boolean'), ...fields('pesan_params', 'json'),
  ] },
  { table: 'activity_logs', key: 'id', collection: 'activityLogs', search: [], fields: [
    ...fields('timestamp userEmail userName role actionType module description ipAddress userAgent'),
  ] },
  { table: 'templates', key: 'id', collection: 'templates', search: ['name'], fields: [
    ...fields('name contentId'), ...fields('version', 'number'), ...fields('customFields', 'json'),
    { api: 'createdAt', sql: 'created_at', kind: 'text' }, { api: 'updatedAt', sql: 'updated_at', kind: 'text' },
  ] },
];
export const entityFor = (table: string) => {
  const entity = ENTITIES.find(item => item.table === table);
  if (!entity) throw new Error(`Unknown business table: ${table}`);
  return entity;
};
export const NORMALIZED_MIGRATION = '003_normalized_core';
