/**
 * Insertion orders (service orders, commercial documents): explicit SQL for every read and write, scoped by organization, with
 * optimistic concurrency. They are not part of the in-memory snapshot (see normalizedSchema.ts `repository: true`).
 */
import { sql, type Sql } from '../db';
import { searchPatterns } from '../normalizedCoreStore';
import { MAX_PAGE_SIZE } from './contractRepository';
import { DuplicateValueError } from './errors';
import { createEntityRepository, type Row, type UpdateOptions } from './entityRepository';

export type InsertionOrder = Row;
export const IO_SORTS = ['default', 'end_date', 'io_number', 'start_date', 'created_at'] as const;
export type IoSort = typeof IO_SORTS[number];

export interface IoQuery {
  /** Free text: every word must occur in the number, title, channel, deliverables, notes, id or the linked contract's number. */
  q?: string;
  ids?: string[];
  status?: string[];
  partnerId?: string[];
  contractId?: string[];
  sort?: IoSort;
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}
export interface IoPage { rows: InsertionOrder[]; total: number }
/** The columns department scoping reads from orders (the owner comes from the partner, else from the contract). */
export interface IoDirectoryEntry { io_id: string; organizationId: string; partner_id: string | null; contract_id: string | null; partner_name?: string }

const SORT_SQL: Record<IoSort, string> = {
  default: 'i.record_position, i.io_id',
  end_date: 'i.end_date, i.io_id',
  io_number: 'lower(i.io_number), i.io_id',
  start_date: 'i.start_date, i.io_id',
  created_at: 'i.created_at, i.io_id',
};
const HAYSTACK = `(coalesce(i.io_number, '') || ' ' || coalesce(i.io_title, '') || ' ' || coalesce(i.media_channel, '') || ' ' || coalesce(i.deliverables, '') || ' ' ||
  coalesce(i.internal_notes, '') || ' ' || i.io_id || ' ' || coalesce(c.contract_number, ''))`;
const lowerNumber = (value: unknown) => String(value ?? '').trim().toLowerCase();

export function createIoRepository(db: Sql) {
  const base = createEntityRepository(db, 'insertion_orders');

  /** Serializes concurrent writers of the same order number inside the write transaction, then rejects a taken number. */
  async function assertNumberFree(row: Row) {
    const number = lowerNumber(row.io_number);
    if (!number) return;
    await db.get('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', `insertion_orders:number:${row.organizationId}:${number}`);
    const taken = await db.get(
      `SELECT io_id FROM insertion_orders WHERE organization_id = ? AND lower(btrim(io_number)) = ? AND io_id <> ? LIMIT 1`,
      row.organizationId, number, String(row.io_id));
    if (taken) throw new DuplicateValueError('io_number', `Nomor IO '${String(row.io_number).trim()}' sudah terdaftar dalam sistem.`);
  }

  const FROM = 'insertion_orders i LEFT JOIN contracts c ON c.organization_id = i.organization_id AND c.contract_id = i.contract_id';
  function where(organizationId: string, query: IoQuery) {
    const clauses = ['i.organization_id = ?'];
    const params: unknown[] = [organizationId];
    if (query.ids) { clauses.push('i.io_id = ANY(?)'); params.push(query.ids); }
    if (query.status?.length) { clauses.push('i.status = ANY(?)'); params.push(query.status); }
    if (query.partnerId?.length) { clauses.push('i.partner_id = ANY(?)'); params.push(query.partnerId); }
    if (query.contractId?.length) { clauses.push('i.contract_id = ANY(?)'); params.push(query.contractId); }
    for (const pattern of searchPatterns(query.q ?? '')) { clauses.push(`${HAYSTACK} ILIKE ?`); params.push(pattern); }
    return { sql: clauses.join(' AND '), params };
  }

  /** A page of the organization's orders plus the total that match (before paging). No `limit` returns everything. */
  async function list(organizationId: string, query: IoQuery = {}): Promise<IoPage> {
    const filter = where(organizationId, query);
    const total = Number((await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${FROM} WHERE ${filter.sql}`, ...filter.params))?.n ?? 0);
    const order = SORT_SQL[query.sort && query.sort in SORT_SQL ? query.sort : 'default'];
    const orderBy = query.dir === 'desc' ? order.split(', ').map((part) => part + ' DESC').join(', ') : order;
    const paged = query.limit !== undefined;
    const limit = paged ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(query.limit)) || 50)) : undefined;
    const offset = Math.max(0, Math.trunc(Number(query.offset)) || 0);
    const records = await db.all<Row>(
      `SELECT i.* FROM ${FROM} WHERE ${filter.sql} ORDER BY ${orderBy}${paged ? ' LIMIT ? OFFSET ?' : ''}`,
      ...filter.params, ...(paged ? [limit, offset] : []));
    return { rows: await base.hydrate(records), total };
  }

  return {
    ...base,
    list,
    insert: (row: InsertionOrder, options: { position?: 'first' | 'last' } = {}) => base.insert(row, { ...options, beforeWrite: assertNumberFree }),
    update: (row: InsertionOrder, expectedVersion: number, options: UpdateOptions = {}) =>
      base.update(row, expectedVersion, { ...options, beforeWrite: options.bumpVersion === false ? options.beforeWrite : assertNumberFree }),
    /** First order of the organization with this number (compared trimmed and case-insensitively). */
    async findByNumber(organizationId: string, number: unknown, exceptId?: string): Promise<InsertionOrder | undefined> {
      const key = lowerNumber(number);
      if (!key) return undefined;
      const record = await db.get<Row>(
        `SELECT * FROM insertion_orders WHERE organization_id = ? AND lower(btrim(io_number)) = ? AND io_id <> ? ORDER BY record_position LIMIT 1`, organizationId, key, exceptId ?? '');
      return record ? (await base.hydrate([record]))[0] : undefined;
    },
    async exists(organizationId: string, id: string): Promise<boolean> {
      return Boolean(await db.get('SELECT 1 FROM insertion_orders WHERE organization_id = ? AND io_id = ?', organizationId, id));
    },
    async count(organizationId?: string): Promise<number> {
      return Number((await (organizationId === undefined
        ? db.get<{ n: number }>('SELECT COUNT(*) AS n FROM insertion_orders')
        : db.get<{ n: number }>('SELECT COUNT(*) AS n FROM insertion_orders WHERE organization_id = ?', organizationId)))?.n ?? 0);
    },
    async anyAtAll(): Promise<boolean> {
      return Boolean(await db.get('SELECT 1 FROM insertion_orders LIMIT 1'));
    },
    /** Distinct currencies in use (all organizations), for the exchange-rate preload. */
    async currencies(): Promise<string[]> {
      return (await db.all<{ currency: string }>(`SELECT DISTINCT currency FROM insertion_orders WHERE currency IS NOT NULL AND currency <> ''`)).map((r) => r.currency);
    },
    /** Orders of a partner, or of any of the given contracts (what disappears together with a partner). */
    async idsByPartnerOrContracts(organizationId: string, partnerId: string, contractIds: string[]): Promise<string[]> {
      return (await db.all<{ io_id: string }>(
        'SELECT io_id FROM insertion_orders WHERE organization_id = ? AND (partner_id = ? OR contract_id = ANY(?)) ORDER BY io_id', organizationId, partnerId, contractIds)).map((r) => r.io_id);
    },
    /** Deletes the orders (children and search entries included); inside the caller's transaction when there is one. */
    async removeMany(organizationId: string, ids: string[]): Promise<number> {
      if (!ids.length) return 0;
      return db.tx(async () => {
        await db.run('DELETE FROM search_records WHERE entity_type = ? AND organization_id = ? AND entity_id = ANY(?)', 'insertion_orders', organizationId, ids);
        return (await db.run('DELETE FROM insertion_orders WHERE organization_id = ? AND io_id = ANY(?)', organizationId, ids)).changes;
      });
    },
    /** A deleted contract leaves its orders in place, detached from it (a new version: the link changed). */
    async detachContract(organizationId: string, contractId: string): Promise<number> {
      return db.tx(async () => {
        const ids = (await db.all<{ io_id: string }>('SELECT io_id FROM insertion_orders WHERE organization_id = ? AND contract_id = ? ORDER BY io_id', organizationId, contractId)).map((r) => r.io_id);
        // Through the row (not a bare UPDATE) so the API keeps answering `contract_id: null`, as it always did.
        for (const id of ids) await base.mutate(organizationId, id, (row) => { row.contract_id = null; });
        return ids.length;
      });
    },
    /** The department-relevant columns of every order of an organization (narrow read; no child tables). */
    async directory(organizationId: string): Promise<IoDirectoryEntry[]> {
      const rows = await db.all<{ io_id: string; partner_id: string | null; contract_id: string | null; partner_name: string | null }>(
        `SELECT io_id, partner_id, contract_id, nullif(extra_json::jsonb ->> 'partner_name', '') AS partner_name FROM insertion_orders WHERE organization_id = ?`, organizationId);
      return rows.map((r) => ({ io_id: r.io_id, organizationId, partner_id: r.partner_id, contract_id: r.contract_id, ...(r.partner_name ? { partner_name: r.partner_name } : {}) }));
    },
  };
}

/** The application's order repository (the shared SQL facade; its transactions are ambient). */
export const ioRepository = createIoRepository(sql);
export type IoRepository = ReturnType<typeof createIoRepository>;
