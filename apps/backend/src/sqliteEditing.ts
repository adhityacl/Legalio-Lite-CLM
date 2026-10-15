import type Database from 'better-sqlite3';
import { ENTITIES } from './normalizedSchema';
import { readBusinessRows } from './normalizedCoreStore';
import { ApiError } from './organizationSettingsStore';

const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
// Ownership, keys, provenance and paired monetary coefficients are not raw-cell edits.
const locked = new Set(['created_at', 'updated_at', 'partner_id', 'contract_id', 'parent_contract_id', 'vendor_id', 'parent_id', 'parent_type']);
export function editableColumns(table: string) {
  const entity = ENTITIES.find(item => item.table === table && item.table !== 'activity_logs');
  return entity?.fields.filter(field => field.kind !== 'money' && !locked.has(field.sql)) ?? [];
}
const invalid = (message: string) => new ApiError(400, 'INVALID_INPUT', message);

/** Caller wraps this operation and its audit event in one immediate transaction. */
export function editBusinessRow(db: Database.Database, input: any) {
  const { table, key, original, changes } = input ?? {};
  const fields = editableColumns(table);
  if (!fields.length) throw new ApiError(403, 'READ_ONLY_TABLE', 'This table is read-only.');
  const entity = ENTITIES.find(item => item.table === table)!;
  if (typeof key !== 'string' || !key || !original || typeof original !== 'object' || Array.isArray(original) ||
      !changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) throw invalid('A row key, original row and changes are required.');
  const current = db.prepare(`SELECT * FROM ${quote(table)} WHERE ${quote(entity.key)} = ?`).get(key) as Record<string, any> | undefined;
  if (!current) throw new ApiError(404, 'ROW_NOT_FOUND', 'The row no longer exists. Refresh the table.');
  if (Object.keys(current).some(column => !Object.hasOwn(original, column) || JSON.stringify(current[column]) !== JSON.stringify(original[column]))) {
    throw new ApiError(409, 'ROW_CHANGED', 'This row changed since you loaded it. Refresh the table before editing again.');
  }
  const extra = JSON.parse(current.extra_json);
  const assignments: string[] = [];
  const params: any[] = [];
  for (const [column, value] of Object.entries(changes)) {
    const field = fields.find(item => item.sql === column);
    if (!field) throw invalid(`Column ${column} is read-only.`);
    if (value !== null) {
      if (field.kind === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw invalid(`${column} requires a finite number.`);
      if (field.kind === 'boolean' && value !== 0 && value !== 1) throw invalid(`${column} requires 0 or 1.`);
      if ((field.kind === 'text' || field.kind === 'json') && (typeof value !== 'string' || value.length > 100_000)) throw invalid(`${column} requires text of at most 100,000 characters.`);
      if (field.kind === 'json') { try { JSON.parse(value as string); } catch { throw invalid(`${column} requires valid JSON.`); } }
    }
    // decodeFields uses extra_json for explicit nulls; keep it consistent with the SQL cell.
    delete extra[field.api];
    if (value === null) extra[field.api] = null;
    assignments.push(`${quote(column)} = ?`); params.push(value);
  }
  assignments.push('extra_json = ?'); params.push(JSON.stringify(extra));
  if (Object.hasOwn(current, 'updated_at')) { assignments.push('updated_at = ?'); params.push(new Date().toISOString()); }
  db.prepare(`UPDATE ${quote(table)} SET ${assignments.join(', ')} WHERE ${quote(entity.key)} = ?`).run(...params, key);
  const record = readBusinessRows(db, table, undefined, [key])[0];
  if (entity.search.length) {
    const texts = entity.search.map(field => String(record[field] || ''));
    db.prepare('UPDATE search_records SET title = ?, body = ? WHERE entity_type = ? AND entity_id = ?').run(texts[0], texts.slice(1).join('\n'), table, key);
  }
  return { entity, rows: readBusinessRows(db, table), changedFields: Object.keys(changes) };
}
