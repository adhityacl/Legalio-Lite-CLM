/**
 * Contracts: explicit SQL for every read and write, scoped by organization, with optimistic concurrency.
 * Contracts are not part of the in-memory snapshot (see normalizedSchema.ts `repository: true`).
 */
import { sql, type Sql } from '../db';
import { departmentScope, type OrgContext } from '../rbac';
import { SEARCH_TEXT, searchClauses, searchPatterns } from '../normalizedCoreStore';
import { DuplicateValueError } from './errors';
import { createEntityRepository, type Row, type UpdateOptions } from './entityRepository';

export type Contract = Row;

export const CONTRACT_SORTS = ['default', 'contract_number', 'contract_title', 'start_date', 'end_date', 'status', 'updated_at', 'created_at', 'partner_name', 'contract_value_usd', 'document_type', 'file'] as const;
export type ContractSort = typeof CONTRACT_SORTS[number];

export interface ContractQuery {
  /** Free text: every word must occur in the number, title, notes, change summary, owner, partner name, parent number or id (case-insensitive). */
  q?: string;
  ids?: string[];
  /** Any of these cooperation categories. */
  categories?: string[];
  parentContractId?: string;
  /** Contracts that start, end or (with their notice period, at most a year) fall due inside the window, for the calendar. */
  window?: { from: string; to: string };
  partnerIds?: string[];
  status?: string[];
  statusApproval?: string[];
  documentType?: string;
  partnerId?: string;
  internalPic?: string;
  /** end_date range, YYYY-MM-DD, inclusive. */
  endFrom?: string;
  endTo?: string;
  sort?: ContractSort;
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface ContractPage { rows: Contract[]; total: number }
/** The few columns that department scoping reads from contracts (via the partner / internal_pic of the contract). */
export interface ContractDirectoryEntry { contract_id: string; organizationId: string; partner_id: string | null; internal_pic: string | null; partner_name?: string }

export const MAX_PAGE_SIZE = 500;
const USD_VALUE = `COALESCE(c.contract_value_usd_minor::numeric / power(10::numeric, COALESCE(c.contract_value_usd_scale, 0)), c.contract_value_minor::numeric / power(10::numeric, COALESCE(c.contract_value_scale, 0)))`;
const SORT_SQL: Record<ContractSort, string[]> = {
  default: ['c.record_position', 'c.contract_id'],
  contract_number: ['lower(c.contract_number)', 'c.contract_id'],
  contract_title: ['lower(c.contract_title)', 'c.contract_id'],
  start_date: ['c.start_date', 'c.contract_id'],
  end_date: ['c.end_date', 'c.contract_id'],
  status: ['c.status', 'c.contract_id'],
  updated_at: ['c.updated_at', 'c.contract_id'],
  created_at: ['c.created_at', 'c.contract_id'],
  partner_name: ['lower(p.partner_name)', 'c.contract_id'],
  contract_value_usd: [USD_VALUE, 'c.contract_id'],
  document_type: ["COALESCE(c.document_type, 'Master Agreement')", 'lower(c.contract_number)', 'c.contract_id'],
  file: ["COALESCE(c.contract_file_link, '')", 'c.contract_id'],
};
const FROM = `contracts c LEFT JOIN partners p ON p.organization_id = c.organization_id AND p.partner_id = c.partner_id`;
const lowerNumber = (value: unknown) => String(value ?? '').trim().toLowerCase();

export function createContractRepository(db: Sql) {
  const base = createEntityRepository(db, 'contracts');

  /** Serializes concurrent writers of the same contract number inside the write transaction, then rejects a taken number. */
  async function assertNumberFree(row: Row) {
    const number = lowerNumber(row.contract_number);
    if (!number) return;
    await db.get('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', `contracts:number:${row.organizationId}:${number}`);
    const taken = await db.get(
      `SELECT contract_id FROM contracts WHERE organization_id = ? AND lower(btrim(contract_number)) = ? AND contract_id <> ? LIMIT 1`,
      row.organizationId, number, String(row.contract_id));
    if (taken) throw new DuplicateValueError('contract_number', `Nomor Kontrak '${String(row.contract_number).trim()}' sudah terdaftar dalam sistem.`);
  }

  function where(organizationId: string, query: ContractQuery) {
    const clauses = ['c.organization_id = ?'];
    const params: unknown[] = [organizationId];
    if (query.ids) { clauses.push('c.contract_id = ANY(?)'); params.push(query.ids); }
    if (query.status?.length) { clauses.push('c.status = ANY(?)'); params.push(query.status); }
    if (query.statusApproval?.length) { clauses.push('c.status_approval = ANY(?)'); params.push(query.statusApproval); }
    if (query.documentType) { clauses.push('c.document_type = ?'); params.push(query.documentType); }
    if (query.partnerId) { clauses.push('c.partner_id = ?'); params.push(query.partnerId); }
    if (query.partnerIds?.length) { clauses.push('c.partner_id = ANY(?)'); params.push(query.partnerIds); }
    if (query.parentContractId) { clauses.push('c.parent_contract_id = ?'); params.push(query.parentContractId); }
    if (query.categories?.length) { clauses.push('EXISTS (SELECT 1 FROM contract_categories cc WHERE cc.contract_id = c.contract_id AND cc.category = ANY(?))'); params.push(query.categories); }
    if (query.window) {
      clauses.push(`(c.start_date BETWEEN ? AND ? OR c.end_date BETWEEN ? AND (?::date + 400)::text OR c.completion_date BETWEEN ? AND ?)`);
      params.push(query.window.from, query.window.to, query.window.from, query.window.to, query.window.from, query.window.to);
    }
    if (query.internalPic) { clauses.push('c.internal_pic = ?'); params.push(query.internalPic); }
    if (query.endFrom) { clauses.push('c.end_date >= ?'); params.push(query.endFrom); }
    if (query.endTo) { clauses.push('c.end_date <= ?'); params.push(query.endTo); }
    for (const pattern of searchPatterns(query.q ?? '')) {
      clauses.push(`(c.contract_id ILIKE ? OR c.internal_pic ILIKE ? OR p.partner_name ILIKE ? OR (c.extra_json::jsonb ->> 'parent_contract_number') ILIKE ?
        OR c.contract_id IN (SELECT entity_id FROM search_records WHERE entity_type = 'contracts' AND organization_id = ? AND ${searchClauses(SEARCH_TEXT, [pattern])}))`);
      params.push(pattern, pattern, pattern, pattern, organizationId, pattern);
    }
    return { sql: clauses.join(' AND '), params };
  }

  /** A page of the organization's contracts plus the total number that match (before paging). No `limit` returns everything. */
  async function list(organizationId: string, query: ContractQuery = {}): Promise<ContractPage> {
    const filter = where(organizationId, query);
    const total = Number((await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${FROM} WHERE ${filter.sql}`, ...filter.params))?.n ?? 0);
    const order = SORT_SQL[query.sort && query.sort in SORT_SQL ? query.sort : 'default'];
    const orderBy = order.map((part) => (query.dir === 'desc' ? part + ' DESC' : part)).join(', ');
    const paged = query.limit !== undefined;
    const limit = paged ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(query.limit)) || 50)) : undefined;
    const offset = Math.max(0, Math.trunc(Number(query.offset)) || 0);
    const records = await db.all<Row>(
      `SELECT c.* FROM ${FROM} WHERE ${filter.sql} ORDER BY ${orderBy}${paged ? ' LIMIT ? OFFSET ?' : ''}`,
      ...filter.params, ...(paged ? [limit, offset] : []));
    return { rows: await base.hydrate(records), total };
  }

  return {
    ...base,
    list,
    /** First contract of the organization with this number (compared trimmed and case-insensitively). */
    async findByNumber(organizationId: string, number: unknown, exceptId?: string): Promise<Contract | undefined> {
      const key = lowerNumber(number);
      if (!key) return undefined;
      const record = await db.get<Row>(
        `SELECT * FROM contracts WHERE organization_id = ? AND lower(btrim(contract_number)) = ? AND contract_id <> ? ORDER BY record_position LIMIT 1`,
        organizationId, key, exceptId ?? '');
      return record ? (await base.hydrate([record]))[0] : undefined;
    },
    async exists(id: string): Promise<boolean> {
      return Boolean(await db.get('SELECT 1 FROM contracts WHERE contract_id = ?', id));
    },
    /** Contract by id without knowing its organization (route handlers check ownership afterwards, answering 404 for strangers). */
    async getAnyOrganization(id: string): Promise<Contract | undefined> {
      const record = await db.get<Row>('SELECT * FROM contracts WHERE contract_id = ?', id);
      return record ? (await base.hydrate([record]))[0] : undefined;
    },
    /**
     * Atomic server-side change of one contract: the row is locked, `change` edits the current content, and the result is written
     * with the version just read, so it never fails on (or overwrites) a concurrent edit of other fields. For derived values
     * (analysis results, lifecycle refresh); user edits go through `update` with the version the user saw.
     */
    async mutate(
      organizationId: string, id: string,
      /** Edits the row in place; returning `false` leaves the stored row untouched. */
      change: (row: Contract) => void | false | Promise<void | false>,
      options: Omit<UpdateOptions, 'bumpVersion'> & { bumpVersion?: boolean | (() => boolean) } = {},
    ): Promise<Contract | undefined> {
      return db.tx(async () => {
        const record = await db.get<Row>('SELECT * FROM contracts WHERE organization_id = ? AND contract_id = ? FOR UPDATE', organizationId, id);
        if (!record) return undefined;
        const [row] = await base.hydrate([record]);
        const version = row.version;
        if (await change(row) === false) return row;
        const bumpVersion = typeof options.bumpVersion === 'function' ? options.bumpVersion() : options.bumpVersion;
        return base.update(row, version, { ...options, bumpVersion });
      });
    },
    insert: (row: Contract) => base.insert(row, { beforeWrite: assertNumberFree }),
    update: (row: Contract, expectedVersion: number, options: UpdateOptions = {}) =>
      base.update(row, expectedVersion, { ...options, beforeWrite: options.bumpVersion === false ? options.beforeWrite : assertNumberFree }),
    async idsByPartner(organizationId: string, partnerId: string): Promise<string[]> {
      return (await db.all<{ contract_id: string }>('SELECT contract_id FROM contracts WHERE organization_id = ? AND partner_id = ? ORDER BY contract_id', organizationId, partnerId)).map((r) => r.contract_id);
    },
    async count(organizationId?: string): Promise<number> {
      return Number((await (organizationId === undefined
        ? db.get<{ n: number }>('SELECT COUNT(*) AS n FROM contracts')
        : db.get<{ n: number }>('SELECT COUNT(*) AS n FROM contracts WHERE organization_id = ?', organizationId)))?.n ?? 0);
    },
    async anyIn(organizationId: string): Promise<boolean> {
      return Boolean(await db.get('SELECT 1 FROM contracts WHERE organization_id = ? LIMIT 1', organizationId));
    },
    async anyAtAll(): Promise<boolean> {
      return Boolean(await db.get('SELECT 1 FROM contracts LIMIT 1'));
    },
    /** Does any contract of the organization name this department as `internal_pic`? */
    async departmentReferenced(organizationId: string, normalizedName: string): Promise<boolean> {
      return Boolean(await db.get(
        `SELECT 1 FROM contracts WHERE organization_id = ? AND lower(regexp_replace(btrim(coalesce(internal_pic, '')), '\\s+', ' ', 'g')) = ? LIMIT 1`,
        organizationId, normalizedName));
    },
    /** Distinct currencies in use (all organizations), for the exchange-rate preload. */
    async currencies(): Promise<string[]> {
      return (await db.all<{ currency: string }>(`SELECT DISTINCT currency FROM contracts WHERE currency IS NOT NULL AND currency <> ''`)).map((r) => r.currency);
    },
    /** Deletes the contract, detaching its children first; both inside the caller's transaction when there is one. */
    async removeWithChildren(organizationId: string, id: string): Promise<boolean> {
      return db.tx(async () => {
        await db.run(`UPDATE contracts SET parent_contract_id = NULL, version = version + 1 WHERE organization_id = ? AND parent_contract_id = ?`, organizationId, id);
        return base.remove(organizationId, id);
      });
    },
    async removeByPartner(organizationId: string, partnerId: string): Promise<number> {
      return db.tx(async () => {
        const ids = await db.all<{ contract_id: string }>('SELECT contract_id FROM contracts WHERE organization_id = ? AND partner_id = ?', organizationId, partnerId);
        if (!ids.length) return 0;
        const list = ids.map((r) => r.contract_id);
        // A contract of another partner may name one of these as its parent.
        await db.run(`UPDATE contracts SET parent_contract_id = NULL, version = version + 1 WHERE organization_id = ? AND parent_contract_id = ANY(?) AND NOT (contract_id = ANY(?))`, organizationId, list, list);
        await db.run('DELETE FROM search_records WHERE entity_type = ? AND entity_id = ANY(?)', 'contracts', list);
        return (await db.run('DELETE FROM contracts WHERE organization_id = ? AND contract_id = ANY(?)', organizationId, list)).changes;
      });
    },
    /** The department-relevant columns of every contract of an organization (narrow read; no child tables). */
    async directory(organizationId: string): Promise<ContractDirectoryEntry[]> {
      const rows = await db.all<{ contract_id: string; partner_id: string | null; internal_pic: string | null; partner_name: string | null }>(
        `SELECT contract_id, partner_id, internal_pic, nullif(extra_json::jsonb ->> 'partner_name', '') AS partner_name FROM contracts WHERE organization_id = ?`, organizationId);
      return rows.map((r) => ({ contract_id: r.contract_id, organizationId, partner_id: r.partner_id, internal_pic: r.internal_pic, ...(r.partner_name ? { partner_name: r.partner_name } : {}) }));
    },
    /** Reference number and title for display next to other records (insertion orders). */
    async labels(organizationId: string, ids: string[]): Promise<Map<string, { contract_number: string | null; contract_title: string | null }>> {
      const list = [...new Set(ids.filter(Boolean))];
      if (!list.length) return new Map();
      const rows = await db.all<{ contract_id: string; contract_number: string | null; contract_title: string | null }>(
        'SELECT contract_id, contract_number, contract_title FROM contracts WHERE organization_id = ? AND contract_id = ANY(?)', organizationId, list);
      return new Map(rows.map((r) => [r.contract_id, r]));
    },
  };
}

/** The application's contract repository (the shared SQL facade; its transactions are ambient). */
export const contractRepository = createContractRepository(sql);
export type ContractRepository = ReturnType<typeof createContractRepository>;

/**
 * Contracts that department scoping needs to resolve the owner of insertion orders and notifications (the contract's
 * partner and internal_pic). Organization-scope roles never consult it, so they get an empty list and no query.
 */
export async function contractDirectoryFor(db: Sql, ctx: OrgContext): Promise<ContractDirectoryEntry[]> {
  return departmentScope(ctx) === null ? [] : createContractRepository(db).directory(ctx.organizationId);
}
