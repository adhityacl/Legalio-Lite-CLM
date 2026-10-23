/** Business schema. API names stay stable at the storage boundary. */
export type FieldKind = 'text' | 'number' | 'boolean' | 'json' | 'money';
export interface Field { api: string; sql: string; kind: FieldKind }
/** `appendOnly` tables are written by dedicated INSERTs, never by the full-projection sync (which deletes rows missing from memory). */
export interface EntitySchema { table: string; key: string; collection: string; fields: Field[]; search: string[]; appendOnly?: boolean }
const snake = (name: string) => name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
const fields = (names: string, kind: FieldKind = 'text'): Field[] => names.split(/\s+/).filter(Boolean).map(api => ({ api, sql: snake(api), kind }));
const dates = fields('created_at updated_at');
const lifecycle = [...fields('lifecycle_mode termination_date termination_reason'), ...fields('termination_document', 'json')];
export const ENTITIES: EntitySchema[] = [
  { table: 'partners', key: 'partner_id', collection: 'partners', search: ['partner_name', 'codename', 'partner_type', 'notes'], fields: [
    ...fields('partner_name country entity_type partner_type pic_name pic_email pic_phone pic_address internal_pic codename status_dd dd_folder_link dd_verified_date notes'), ...dates,
  ] },
  { table: 'contracts', key: 'contract_id', collection: 'contracts', search: ['contract_number', 'contract_title', 'internal_notes', 'change_summary'], fields: [
    ...fields('document_type parent_contract_id contract_number contract_title partner_id start_date end_date completion_date currency notice_type_required status status_approval internal_pic contract_file_link fileName internal_notes change_summary redline_analyzed_at'),
    ...fields('contract_value contract_value_usd', 'money'), ...fields('notice_period_days', 'number'), ...fields('auto_renewal', 'boolean'), ...fields('redline_analysis changed_fields', 'json'), ...lifecycle, ...dates,
  ] },
  { table: 'insertion_orders', key: 'io_id', collection: 'ios', search: ['io_number', 'io_title', 'media_channel', 'deliverables', 'internal_notes'], fields: [
    ...fields('contract_id io_number io_title partner_id media_channel start_date end_date completion_date pricing_model charging_type payment_scheme currency deliverables notice_type_required status internal_notes io_file_link fileName'),
    ...fields('io_value io_value_usd', 'money'), ...fields('notice_period_days', 'number'), ...dates,
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
    ...fields('parent_type parent_id parent_number parent_title notification_type sent_at recipient message'),
    ...fields('is_sent is_read', 'boolean'), ...fields('message_params', 'json'),
  ] },
  { table: 'activity_logs', key: 'id', collection: 'activityLogs', search: [], appendOnly: true, fields: [
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
