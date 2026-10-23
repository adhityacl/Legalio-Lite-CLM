/**
 * Generic row-level persistence for one normalized business table: explicit INSERT / UPDATE / DELETE statements per row,
 * each inside its own transaction (or the caller's), with optimistic concurrency on the `version` column.
 *
 * Contrast with the in-memory snapshot sync (normalizedCoreStore.synchronizeBusinessRows), which loads every row of every
 * tenant, fingerprints all of them on every save and deletes rows that are missing from memory. A repository-backed
 * entity (`repository: true` in normalizedSchema.ts) is never touched by that sync, and absence from memory deletes nothing.
 * Entity-specific repositories (contractRepository.ts) wrap this with their own filters and list queries.
 */
import { isConstraintViolation, isUniqueViolation, type Sql } from '../db';
import { entityFor } from '../normalizedSchema';
import { arrayMarkers, canonicalize, childMarkerKeys, encodeFields, hydrateRecords, writeChildren, writeSearchRecord } from '../normalizedCoreStore';
import { DuplicateValueError, RecordNotFoundError, RepositoryError, VersionConflictError } from './errors';

export type Row = Record<string, any>;
export const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

export interface WriteOptions {
  /** Runs inside the write transaction before the statement: take locks and check cross-row rules here. */
  beforeWrite?: (row: Row) => Promise<void>;
}
export interface UpdateOptions extends WriteOptions {
  /** `false` keeps the version (derived-field refreshes that must not invalidate an editor's copy). Default: increment. */
  bumpVersion?: boolean;
}

export function createEntityRepository(db: Sql, table: string) {
  const entity = entityFor(table);
  const t = quote(table);
  const key = quote(entity.key);

  /** Column values of an API row; `version` and the organization never travel in extra_json. */
  const columns = (input: Row): Row => {
    const { version: _version, ...row } = input;
    return encodeFields(arrayMarkers(canonicalize(entity, row), childMarkerKeys(table)), entity.fields, [entity.key, 'organizationId']);
  };
  const children = (input: Row) => {
    const { version: _version, ...row } = input;
    return canonicalize(entity, row);
  };
  const translate = (error: unknown): never => {
    if (error instanceof RepositoryError) throw error;
    if (isUniqueViolation(error)) throw new DuplicateValueError(entity.key, 'A record with this identifier already exists.');
    if (isConstraintViolation(error)) throw Object.assign(new RepositoryError(409, 'CONSTRAINT_VIOLATION', 'The record conflicts with related data.'), { cause: error });
    throw error;
  };

  async function getMany(organizationId: string, ids: string[]): Promise<Row[]> {
    if (!ids.length) return [];
    const records = await db.all<Row>(`SELECT * FROM ${t} WHERE organization_id = ? AND ${key} = ANY(?) ORDER BY record_position, ${key}`, organizationId, ids);
    return hydrateRecords(db, entity, records);
  }
  async function get(organizationId: string, id: string): Promise<Row | undefined> {
    return (await getMany(organizationId, [id]))[0];
  }

  /** Inserts `row` (newest first: it takes the position before every existing row of the organization). Returns the stored row. */
  async function insert(row: Row, options: WriteOptions = {}): Promise<Row> {
    const id = String(row[entity.key] ?? '').trim();
    const organizationId = String(row.organizationId ?? '').trim();
    if (!id) throw new Error(`Missing ${entity.key} in ${table}`);
    if (!organizationId) throw new Error(`Missing organizationId for ${table} ${id}`);
    try {
      return await db.tx(async () => {
        await options.beforeWrite?.(row);
        const first = await db.get<{ position: number }>(`SELECT COALESCE(MIN(record_position), 1) - 1 AS position FROM ${t} WHERE organization_id = ?`, organizationId);
        const values: Row = { [entity.key]: id, organization_id: organizationId, record_position: Number(first?.position ?? 0), ...columns(row) };
        const names = Object.keys(values);
        await db.run(`INSERT INTO ${t} (${names.map(quote).join(',')}) VALUES (${names.map((name) => '@' + name).join(',')})`, values);
        await writeChildren(db, entity, children(row));
        await writeSearchRecord(db, entity, { ...row, organizationId }, id);
        return (await get(organizationId, id))!;
      });
    } catch (error) { return translate(error); }
  }

  /**
   * Replaces the row's content if its stored version is still `expectedVersion`. A concurrent writer that got there first
   * makes this throw VersionConflictError (HTTP 409); a row that no longer exists throws RecordNotFoundError.
   */
  async function update(row: Row, expectedVersion: number, options: UpdateOptions = {}): Promise<Row> {
    const id = String(row[entity.key] ?? '').trim();
    const organizationId = String(row.organizationId ?? '').trim();
    if (!id || !organizationId) throw new Error(`Update of ${table} needs ${entity.key} and organizationId.`);
    try {
      return await db.tx(async () => {
        await options.beforeWrite?.(row);
        const values = columns(row);
        const set = Object.keys(values).map((name) => `${quote(name)} = @${name}`).join(', ');
        const bump = options.bumpVersion === false ? '' : ', version = version + 1';
        const result = await db.run(
          `UPDATE ${t} SET ${set}${bump} WHERE organization_id = @row_org AND ${key} = @row_id AND version = @row_expected`,
          { ...values, row_org: organizationId, row_id: id, row_expected: expectedVersion });
        if (result.changes === 0) {
          const current = await db.get(`SELECT version FROM ${t} WHERE organization_id = ? AND ${key} = ?`, organizationId, id);
          throw current ? new VersionConflictError(table, id, expectedVersion) : new RecordNotFoundError(table, id);
        }
        await writeChildren(db, entity, children(row));
        await writeSearchRecord(db, entity, { ...row, organizationId }, id);
        return (await get(organizationId, id))!;
      });
    } catch (error) { return translate(error); }
  }

  /** Deletes one row (children cascade). False when it did not exist. */
  async function remove(organizationId: string, id: string): Promise<boolean> {
    return db.tx(async () => {
      const result = await db.run(`DELETE FROM ${t} WHERE organization_id = ? AND ${key} = ?`, organizationId, id);
      if (result.changes) await db.run('DELETE FROM search_records WHERE entity_type = ? AND entity_id = ?', table, id);
      return result.changes > 0;
    });
  }

  /** Every row of one organization (children cascade); used by the organization reset. Returns the number removed. */
  async function removeOrganization(organizationId: string): Promise<number> {
    return db.tx(async () => {
      await db.run('DELETE FROM search_records WHERE entity_type = ? AND organization_id = ?', table, organizationId);
      return (await db.run(`DELETE FROM ${t} WHERE organization_id = ?`, organizationId)).changes;
    });
  }

  /** Every row of every organization; for the full-database reset only. */
  async function removeAll(): Promise<number> {
    return db.tx(async () => {
      await db.run('DELETE FROM search_records WHERE entity_type = ?', table);
      return (await db.run(`DELETE FROM ${t}`)).changes;
    });
  }

  /** Rows of all organizations in key order, `size` at a time (keyset paging), for background jobs. */
  async function* batches(size = 500, where = 'TRUE', params: unknown[] = []): AsyncGenerator<Row[]> {
    let after = '';
    for (;;) {
      const records = await db.all<Row>(`SELECT * FROM ${t} WHERE ${key} > ? AND (${where}) ORDER BY ${key} LIMIT ?`, after, ...params, size);
      if (!records.length) return;
      yield await hydrateRecords(db, entity, records);
      after = records[records.length - 1][entity.key];
      if (records.length < size) return;
    }
  }

  return { entity, table, get, getMany, insert, update, remove, removeOrganization, removeAll, batches, hydrate: (records: Row[]) => hydrateRecords(db, entity, records) };
}

export type EntityRepository = ReturnType<typeof createEntityRepository>;
