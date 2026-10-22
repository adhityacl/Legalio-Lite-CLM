import { createHash } from 'node:crypto';
import type { Sql } from './db';
import { ENTITIES, entityFor, NORMALIZED_MIGRATION, type EntitySchema, type Field } from './normalizedSchema';
import { migratePartnerContact } from './partnerContact';

type DB = Sql;
type Row = Record<string, any>;
const q = (name: string) => `"${name.replaceAll('"', '""')}"`;
export const normalizedCoreReady = async (db: DB) => Boolean(await db.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'")) && Boolean(await db.get('SELECT 1 FROM schema_migrations WHERE id = ?', NORMALIZED_MIGRATION));

// Integer coefficient + decimal scale preserves existing decimal amounts without rounding.
export function decimalParts(value: unknown): { minor: bigint; scale: number } {
  const text = String(value);
  const match = text.match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new Error(`Invalid decimal amount: ${text}`);
  let scale = (match[3]?.length || 0) - Number(match[4] || 0);
  let minor = BigInt(`${match[1]}${match[2]}${match[3] || ''}`);
  if (scale < 0) { minor *= 10n ** BigInt(-scale); scale = 0; }
  while (scale > 0 && minor % 10n === 0n) { minor /= 10n; scale--; }
  if (scale > 30 || minor > 9223372036854775807n || minor < -9223372036854775808n) throw new Error('Amount exceeds supported decimal precision.');
  return { minor, scale };
}
function fieldDDL(field: Field): string {
  if (field.kind === 'money') return `${q(field.sql + '_minor')} INTEGER, ${q(field.sql + '_scale')} INTEGER CHECK (${q(field.sql + '_scale')} BETWEEN 0 AND 30)`;
  const type = field.kind === 'number' ? 'REAL' : field.kind === 'boolean' ? 'INTEGER' : 'TEXT';
  const check = field.kind === 'boolean' ? ` CHECK (${q(field.sql)} IN (0,1))` : field.kind === 'json' ? ` CHECK (${q(field.sql)} IS NULL OR json_valid(${q(field.sql)}))` : '';
  return `${q(field.sql)} ${type}${check}`;
}
export async function createNormalizedCoreSchema(db: DB) {
  for (const entity of ENTITIES) {
    const relations = entity.table === 'contracts' ? [
      'FOREIGN KEY (organization_id, partner_id) REFERENCES partners(organization_id, partner_id) DEFERRABLE INITIALLY DEFERRED',
      'FOREIGN KEY (organization_id, parent_contract_id) REFERENCES contracts(organization_id, contract_id) DEFERRABLE INITIALLY DEFERRED',
    ] : entity.table === 'insertion_orders' ? [
      'FOREIGN KEY (organization_id, partner_id) REFERENCES partners(organization_id, partner_id) DEFERRABLE INITIALLY DEFERRED',
      'FOREIGN KEY (organization_id, contract_id) REFERENCES contracts(organization_id, contract_id) DEFERRABLE INITIALLY DEFERRED',
    ] : entity.table === 'spendings' ? ['FOREIGN KEY (organization_id, vendor_id) REFERENCES partners(organization_id, partner_id) DEFERRABLE INITIALLY DEFERRED']
      : entity.table === 'evaluations' ? ['FOREIGN KEY (organization_id, partner_id) REFERENCES partners(organization_id, partner_id) DEFERRABLE INITIALLY DEFERRED'] : [];
    // Global operational activity may have no organization; business ownership never gets guessed.
    const optionalOrg = entity.table === 'activity_logs';
    await db.exec(`CREATE TABLE IF NOT EXISTS ${q(entity.table)} (
      ${q(entity.key)} TEXT PRIMARY KEY NOT NULL CHECK(length(trim(${q(entity.key)})) > 0),
      organization_id TEXT ${optionalOrg ? '' : 'NOT NULL'} REFERENCES organization(id) DEFERRABLE INITIALLY DEFERRED,
      record_position INTEGER NOT NULL,
      extra_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra_json)),
      ${entity.fields.map(fieldDDL).join(',\n')},
      ${entity.table === 'contracts' ? "risk_score REAL GENERATED ALWAYS AS (json_extract(redline_analysis,'$.overallRiskScore')) VIRTUAL, risk_level TEXT GENERATED ALWAYS AS (json_extract(redline_analysis,'$.riskLevel')) VIRTUAL," : ''}
      UNIQUE(organization_id, ${q(entity.key)})${relations.length ? ',\n' + relations.join(',\n') : ''}
    )`);
    await db.exec(`CREATE INDEX IF NOT EXISTS ${q('idx_v3_' + entity.table + '_org_order')} ON ${q(entity.table)}(organization_id, record_position, ${q(entity.key)})`);
  }
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_v3_partners_name ON partners(organization_id, partner_name COLLATE NOCASE, partner_id);
    CREATE INDEX IF NOT EXISTS idx_v3_partners_owner ON partners(organization_id, internal_pic, partner_id);
    CREATE INDEX IF NOT EXISTS idx_v3_contracts_partner ON contracts(organization_id, partner_id);
    CREATE INDEX IF NOT EXISTS idx_v3_contracts_expiry ON contracts(organization_id, end_date, contract_id);
    CREATE INDEX IF NOT EXISTS idx_v3_contracts_risk ON contracts(organization_id, risk_level, risk_score);
    CREATE INDEX IF NOT EXISTS idx_v3_contracts_reference ON contracts(organization_id, contract_number);
    CREATE INDEX IF NOT EXISTS idx_v3_ios_contract ON insertion_orders(organization_id, contract_id, io_id);
    CREATE INDEX IF NOT EXISTS idx_v3_ios_partner ON insertion_orders(organization_id, partner_id);
    CREATE INDEX IF NOT EXISTS idx_v3_ios_expiry ON insertion_orders(organization_id, end_date, io_id);
    CREATE INDEX IF NOT EXISTS idx_v3_spendings_vendor_date ON spendings(organization_id, vendor_id, invoice_date, id);
    CREATE INDEX IF NOT EXISTS idx_v3_spendings_invoice ON spendings(organization_id, invoice_number);
    CREATE INDEX IF NOT EXISTS idx_v3_evaluations_partner_date ON evaluations(organization_id, partner_id, review_date, id);
    CREATE INDEX IF NOT EXISTS idx_v3_notifications_parent ON notifications(organization_id, parent_type, parent_id);
    CREATE INDEX IF NOT EXISTS idx_v3_activity_time ON activity_logs(organization_id, timestamp);
    CREATE TABLE IF NOT EXISTS partner_categories (
      partner_id TEXT NOT NULL REFERENCES partners(partner_id) ON DELETE CASCADE, position INTEGER NOT NULL,
      category TEXT NOT NULL, PRIMARY KEY(partner_id, position));
    CREATE INDEX IF NOT EXISTS idx_v3_partner_category ON partner_categories(category, partner_id);
    CREATE TABLE IF NOT EXISTS contract_categories (
      contract_id TEXT NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE, position INTEGER NOT NULL,
      category TEXT NOT NULL, PRIMARY KEY(contract_id, position));
    CREATE INDEX IF NOT EXISTS idx_v3_contract_category ON contract_categories(category, contract_id);
    CREATE TABLE IF NOT EXISTS partner_identifiers (
      partner_id TEXT NOT NULL REFERENCES partners(partner_id) ON DELETE CASCADE, position INTEGER NOT NULL,
      scheme TEXT, value TEXT, country TEXT, extra_json TEXT NOT NULL CHECK(json_valid(extra_json)), PRIMARY KEY(partner_id, position));
    CREATE INDEX IF NOT EXISTS idx_v3_identifier_value ON partner_identifiers(scheme, value, partner_id);
    CREATE TABLE IF NOT EXISTS partner_dd_requirements (
      partner_id TEXT NOT NULL REFERENCES partners(partner_id) ON DELETE CASCADE, position INTEGER NOT NULL,
      key TEXT, name TEXT, required INTEGER CHECK(required IN (0,1)), expires INTEGER CHECK(expires IN (0,1)), status TEXT,
      document_number TEXT, expiry_date TEXT, link_drive TEXT, file_id TEXT, file_size TEXT, uploaded_at TEXT,
      extra_json TEXT NOT NULL CHECK(json_valid(extra_json)), PRIMARY KEY(partner_id, position));
    CREATE INDEX IF NOT EXISTS idx_v3_dd_expiry ON partner_dd_requirements(expiry_date, partner_id);
    CREATE TABLE IF NOT EXISTS partner_dd_files (
      partner_id TEXT NOT NULL, requirement_position INTEGER NOT NULL, position INTEGER NOT NULL,
      id TEXT, file_name TEXT, link_drive TEXT, file_size TEXT, uploaded_at TEXT, year TEXT, expiry_date TEXT,
      extra_json TEXT NOT NULL CHECK(json_valid(extra_json)), PRIMARY KEY(partner_id, requirement_position, position),
      FOREIGN KEY(partner_id, requirement_position) REFERENCES partner_dd_requirements(partner_id, position) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS spending_allocations (
      spending_id TEXT NOT NULL REFERENCES spendings(id) ON DELETE CASCADE, position INTEGER NOT NULL,
      month TEXT NOT NULL, amount_minor INTEGER NOT NULL, amount_scale INTEGER NOT NULL,
      extra_json TEXT NOT NULL CHECK(json_valid(extra_json)), PRIMARY KEY(spending_id, position), UNIQUE(spending_id, month));
    CREATE INDEX IF NOT EXISTS idx_v3_allocations_month ON spending_allocations(month, spending_id);
    CREATE TABLE IF NOT EXISTS spending_reporting_months (
      spending_id TEXT NOT NULL REFERENCES spendings(id) ON DELETE CASCADE, position INTEGER NOT NULL,
      month TEXT NOT NULL, PRIMARY KEY(spending_id, position));
    CREATE INDEX IF NOT EXISTS idx_v3_reporting_month ON spending_reporting_months(month, spending_id);
    CREATE TABLE IF NOT EXISTS search_records (
      rowid INTEGER PRIMARY KEY, organization_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(entity_type, entity_id));
    CREATE VIEW IF NOT EXISTS v_partner_summary AS
      SELECT p.partner_id,p.organization_id,p.partner_name,p.country,p.entity_type,p.partner_type,p.internal_pic,p.status_dd,p.notes,
        (SELECT count(*) FROM contracts c WHERE c.organization_id=p.organization_id AND c.partner_id=p.partner_id) AS contract_count
      FROM partners p;
    CREATE VIEW IF NOT EXISTS v_contract_summary AS
      SELECT c.contract_id,c.organization_id,c.partner_id,p.partner_name,c.contract_number,c.contract_title,c.parent_contract_id,
        parent.contract_number AS parent_contract_number,c.start_date,c.end_date,c.currency,c.contract_value_minor,c.contract_value_scale,
        c.status,c.status_approval,c.internal_pic,c.internal_notes,c.risk_level,c.risk_score
      FROM contracts c JOIN partners p ON p.partner_id=c.partner_id AND p.organization_id=c.organization_id
      LEFT JOIN contracts parent ON parent.contract_id=c.parent_contract_id AND parent.organization_id=c.organization_id;
    CREATE INDEX IF NOT EXISTS idx_v3_search_org ON search_records(organization_id, entity_type, entity_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS business_search USING fts5(title, body, content='search_records', content_rowid='rowid', tokenize='unicode61');
    CREATE TRIGGER IF NOT EXISTS business_search_insert AFTER INSERT ON search_records BEGIN
      INSERT INTO business_search(rowid,title,body) VALUES(new.rowid,new.title,new.body); END;
    CREATE TRIGGER IF NOT EXISTS business_search_delete AFTER DELETE ON search_records BEGIN
      INSERT INTO business_search(business_search,rowid,title,body) VALUES('delete',old.rowid,old.title,old.body); END;
    CREATE TRIGGER IF NOT EXISTS business_search_update AFTER UPDATE ON search_records BEGIN
      INSERT INTO business_search(business_search,rowid,title,body) VALUES('delete',old.rowid,old.title,old.body);
      INSERT INTO business_search(rowid,title,body) VALUES(new.rowid,new.title,new.body); END;
  `);
}

function canonicalize(entity: EntitySchema, input: Row): Row {
  const row = { ...input };
  if (entity.table === 'partners') {
    migratePartnerContact(row);
    if (row.codename === undefined && row.partner_channel !== undefined) row.codename = row.partner_channel;
    // Preserve legacy aliases in extra_json until every older client is retired.
  }
  if (entity.table === 'insertion_orders') {

  }
  // Human-readable names/references remain snapshots until the read adapter can join them.
  return row;
}
const apiField = (api: string, sql = api, kind: Field['kind'] = 'text'): Field => ({ api, sql, kind });
const identifierFields = ['scheme','value','country'].map(api => apiField(api));
const ddFields = [apiField('key'), apiField('name'), apiField('required','required','boolean'), apiField('expires','expires','boolean'), apiField('status'), apiField('documentNumber','document_number'), apiField('expiryDate','expiry_date'), apiField('linkDrive','link_drive'), apiField('fileId','file_id'), apiField('fileSize','file_size'), apiField('uploadedAt','uploaded_at')];
const fileFields = [apiField('id'), apiField('fileName','file_name'), apiField('linkDrive','link_drive'), apiField('fileSize','file_size'), apiField('uploadedAt','uploaded_at'), apiField('year'), apiField('expiryDate','expiry_date')];
function encodeFields(row: Row, fields: Field[], omitted: string[] = []) {
  const known = new Set([...fields.map(field => field.api), ...omitted]);
  const extra: Row = Object.fromEntries(Object.entries(row).filter(([key, value]) => !known.has(key) || value === null));
  const values: Row = {};
  for (const field of fields) {
    let value = row[field.api];
    if (['partner_id', 'contract_id', 'parent_contract_id', 'vendor_id'].includes(field.api) && value === '') { extra[field.api] = value; value = null; }
    if (field.kind === 'money') {
      const amount = value == null ? null : decimalParts(value);
      values[field.sql + '_minor'] = amount?.minor ?? null;
      values[field.sql + '_scale'] = amount?.scale ?? null;
    } else values[field.sql] = value == null ? null : field.kind === 'json' ? JSON.stringify(value) : field.kind === 'boolean' ? Number(Boolean(value)) : field.kind === 'number' ? Number(value) : String(value);
  }
  values.extra_json = JSON.stringify(extra);
  return values;
}
function decodeFields(record: Row, fields: Field[]) {
  const row: Row = JSON.parse(record.extra_json || '{}');
  for (const field of fields) {
    if (field.kind === 'money') {
      const minor = record[field.sql + '_minor'];
      if (minor != null) row[field.api] = Number(`${minor}e-${record[field.sql + '_scale']}`);
    } else if (record[field.sql] != null) row[field.api] = field.kind === 'json' ? JSON.parse(record[field.sql]) : field.kind === 'boolean' ? Boolean(Number(record[field.sql])) : field.kind === 'number' ? Number(record[field.sql]) : record[field.sql];
  }
  return row;
}
function upsert(db: DB, table: string, key: string[], values: Row) {
  const columns = Object.keys(values);
  const changed = columns.filter(column => !key.includes(column));
  return db.run(`INSERT INTO ${q(table)} (${columns.map(q).join(',')}) VALUES (${columns.map(column => '@' + column).join(',')})
    ON CONFLICT(${key.map(q).join(',')}) DO UPDATE SET ${changed.map(column => `${q(column)}=excluded.${q(column)}`).join(',')}
    WHERE ${changed.map(column => `${q(table)}.${q(column)} IS NOT excluded.${q(column)}`).join(' OR ')}`, values);
}
function arrayMarkers(row: Row, keys: string[]) {
  const copy = { ...row };
  for (const key of keys) if (Array.isArray(copy[key])) copy[key] = [];
  return copy;
}
async function writeChildren(db: DB, entity: EntitySchema, row: Row) {
  const id = String(row[entity.key]);
  const insert = (table: string, record: Row) => { const columns = Object.keys(record); return db.run(`INSERT INTO ${q(table)} (${columns.map(q).join(',')}) VALUES (${columns.map(column => '@' + column).join(',')})`, record); };
  const replaceList = async (table: string, parentKey: string, list: any[], make: (value: any, index: number) => Row) => {
    await db.run(`DELETE FROM ${q(table)} WHERE ${q(parentKey)} = ?`, id);
    for (const [position, value] of list.entries()) await insert(table, { [parentKey]: id, position, ...make(value, position) });
  };
  if (entity.table === 'partners') {
    await replaceList('partner_categories','partner_id',row.tags || [], value => ({ category: value }));
    await replaceList('partner_identifiers','partner_id',row.identifiers || [], value => encodeFields(value,identifierFields));
    await replaceList('partner_dd_requirements','partner_id',row.dd_documents || [], value => encodeFields(arrayMarkers(value,['files']),ddFields));
    for (const [index, requirement] of (row.dd_documents || []).entries()) {
      for (const [position, file] of (requirement.files || []).entries()) {
        await insert('partner_dd_files', { partner_id: id, requirement_position: index, position, ...encodeFields(file,fileFields) });
      }
    }
  }
  if (entity.table === 'contracts') await replaceList('contract_categories','contract_id',row.cooperation_categories || [], value => ({ category: value }));
  if (entity.table === 'spendings') {
    await replaceList('spending_allocations','spending_id',row.month_allocations || [], value => ({ month: value.month, amount_minor: decimalParts(value.amount).minor, amount_scale: decimalParts(value.amount).scale, extra_json: JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => !['month','amount'].includes(key)))) }));
    await replaceList('spending_reporting_months','spending_id',row.invoice_month || [], value => ({ month: value }));
  }
}
async function childArrays(db: DB, entity: EntitySchema, row: Row) {
  const list = (table: string, parentKey: string) => db.all<Row>(`SELECT * FROM ${q(table)} WHERE ${q(parentKey)} = ? ORDER BY position`, row[entity.key]);
  const assign = (key: string, value: any[]) => { if (value.length || key in row) row[key] = value; };
  if (entity.table === 'partners') {
    assign('tags',(await list('partner_categories','partner_id')).map(record => record.category));
    assign('identifiers',(await list('partner_identifiers','partner_id')).map(record => decodeFields(record,identifierFields)));
    const requirements = [];
    for (const record of await list('partner_dd_requirements','partner_id')) {
      const requirement = decodeFields(record,ddFields);
      const files = await db.all<Row>('SELECT * FROM partner_dd_files WHERE partner_id = ? AND requirement_position = ? ORDER BY position', row.partner_id, record.position);
      if (files.length || 'files' in requirement) requirement.files = files.map(file => decodeFields(file,fileFields));
      requirements.push(requirement);
    }
    assign('dd_documents',requirements);
    if (!('pic_contact' in row) && (row.pic_email || row.pic_phone)) row.pic_contact = [row.pic_email,row.pic_phone].filter(Boolean).join(' / ');
  }
  if (entity.table === 'contracts') assign('cooperation_categories',(await list('contract_categories','contract_id')).map(record => record.category));
  if (entity.table === 'spendings') {
    assign('month_allocations',(await list('spending_allocations','spending_id')).map(record => ({ ...JSON.parse(record.extra_json), month: record.month, amount: Number(`${record.amount_minor}e-${record.amount_scale}`) })));
    assign('invoice_month',(await list('spending_reporting_months','spending_id')).map(record => record.month));
  }
}
export async function readBusinessRows(db: DB, table: string, organizationId?: string, searchIds?: string[]): Promise<Row[]> {
  const entity = entityFor(table);
  const clauses: string[] = []; const params: any[] = [];
  if (organizationId !== undefined) { clauses.push('organization_id = ?'); params.push(organizationId); }
  if (searchIds) {
    if (!searchIds.length) return [];
    clauses.push(`${q(entity.key)} IN (${searchIds.map(() => '?').join(',')})`); params.push(...searchIds);
  }
  const records = await db.all<Row>(`SELECT * FROM ${q(table)}${clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''} ORDER BY record_position, ${q(entity.key)}`, ...params);
  const rows: Row[] = [];
  for (const record of records) { const row = decodeFields(record,entity.fields); row[entity.key] = record[entity.key]; row.organizationId = record.organization_id; await childArrays(db,entity,row); rows.push(row); }
  return rows;
}
// Fingerprints of rows as last written, so an unchanged row costs one hash instead of several SQL round trips.
// Business tables are written only through this function, so the cache stays valid until a rollback or a direct
// delete (application reset) calls resetSyncCache. Callers whose outer transaction fails must reset it too.
const syncedRows = new WeakMap<DB, Map<string, string>>();
const fingerprintOf = (table: string, position: number, input: Row) =>
  table + '\u0000' + createHash('sha1').update(position + ':' + JSON.stringify(input)).digest('base64');
export const resetSyncCache = (db: DB) => { syncedRows.delete(db); };
export async function synchronizeBusinessRows(db: DB, data: Row) {
  const known = syncedRows.get(db) ?? new Map<string, string>();
  const written = new Map<string, string>();
  // All tables commit together. Deferred constraints support reparenting and full replacement.
  try {
  await db.tx(async () => {
    for (const entity of ENTITIES) {
      const rows = Array.isArray(data[entity.collection]) ? data[entity.collection] : [];
      const seen = new Set<string>();
      for (const [position,input] of rows.entries()) {
        const fingerprint = fingerprintOf(entity.table,position,input);
        const unchanged = known.get(fingerprint);
        if (unchanged !== undefined) {
          if (seen.has(unchanged)) throw new Error(`Duplicate ${entity.key} in ${entity.table}: ${unchanged}`);
          seen.add(unchanged);
          written.set(fingerprint,unchanged);
          continue;
        }
        const row = canonicalize(entity,input);
        const id = String(row[entity.key] || '');
        if (!id.trim()) throw new Error(`Missing ${entity.key} in ${entity.table}`);
        if (seen.has(id)) throw new Error(`Duplicate ${entity.key} in ${entity.table}: ${id}`);
        seen.add(id);
        written.set(fingerprint,id);
        const markerKeys = entity.table === 'partners' ? ['tags','identifiers','dd_documents'] : entity.table === 'contracts' ? ['cooperation_categories'] : entity.table === 'spendings' ? ['month_allocations','invoice_month'] : [];
        const values = { [entity.key]: id, organization_id: row.organizationId ?? null, record_position: position, ...encodeFields(arrayMarkers(row,markerKeys), entity.fields, [entity.key,'organizationId']) };
        await upsert(db,entity.table,[entity.key],values);
        await writeChildren(db,entity,row);
        if (entity.search.length) {
          const texts = entity.search.map(key => String(row[key] || ''));
          await upsert(db,'search_records',['entity_type','entity_id'],{ organization_id: row.organizationId, entity_type: entity.table, entity_id: id, title: texts[0], body: texts.slice(1).join('\n') });
        }
      }
      const stored = await db.all<{id:string}>(`SELECT ${q(entity.key)} AS id FROM ${q(entity.table)}`);
      for (const {id} of stored) if (!seen.has(id)) {
        await db.run(`DELETE FROM ${q(entity.table)} WHERE ${q(entity.key)} = ?`, id);
        await db.run('DELETE FROM search_records WHERE entity_type = ? AND entity_id = ?', entity.table,id);
      }
    }
  });
  } catch (error) {
    syncedRows.delete(db); // rolled back: nothing about the cache can be trusted
    throw error;
  }
  syncedRows.set(db,written);
}
export interface SearchHit { entity_type: string; entity_id: string; title: string; score: number }
export async function searchBusinessRows(db: DB, organizationId: string, query: string): Promise<SearchHit[]> {
  const tokens = query.match(/[\p{L}\p{N}_]+/gu)?.slice(0,16) || [];
  if (!tokens.length) return [];
  const match = tokens.map(token => '"' + token.replaceAll('"','""') + '"*').join(' AND ');
  // Authorization by department is applied by the caller before returning any text/counts.
  return db.all<SearchHit>(`SELECT s.entity_type,s.entity_id,s.title,bm25(business_search) AS score
    FROM business_search JOIN search_records s ON s.rowid=business_search.rowid
    WHERE business_search MATCH ? AND s.organization_id = ? ORDER BY score,s.entity_type,s.entity_id`, match,organizationId);
}
