/**
 * Partners: explicit SQL for every read and write, scoped by organization, with optimistic concurrency.
 * Partners are not part of the in-memory snapshot (see normalizedSchema.ts `repository: true`).
 */
import { sql, type Sql } from '../db';
import { searchPatterns } from '../normalizedCoreStore';
import { MAX_PAGE_SIZE } from './contractRepository';
import { createEntityRepository, type Row } from './entityRepository';

export type Partner = Row;
export const PARTNER_SORTS = ['default', 'partner_name', 'created_at', 'updated_at', 'internal_pic', 'status_dd'] as const;
export type PartnerSort = typeof PARTNER_SORTS[number];

export interface PartnerQuery {
  /** Free text: every word must occur in the name, codename, type, owner, country, notes, id or PIC name (case-insensitive). */
  q?: string;
  ids?: string[];
  internalPic?: string[];
  partnerType?: string[];
  statusDd?: string[];
  country?: string[];
  sort?: PartnerSort;
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}
export interface PartnerPage { rows: Partner[]; total: number }
/** The columns department scoping reads from partners (the owning department is `internal_pic`). */
export interface PartnerDirectoryEntry { partner_id: string; organizationId: string; partner_name: string | null; internal_pic: string | null }

const SORT_SQL: Record<PartnerSort, string> = {
  default: 'p.record_position, p.partner_id',
  partner_name: 'lower(p.partner_name), p.partner_id',
  created_at: 'p.created_at, p.partner_id',
  updated_at: 'p.updated_at, p.partner_id',
  internal_pic: 'lower(p.internal_pic), p.partner_id',
  status_dd: 'p.status_dd, p.partner_id',
};
const HAYSTACK = `(coalesce(p.partner_name, '') || ' ' || coalesce(p.codename, '') || ' ' || coalesce(p.partner_type, '') || ' ' || coalesce(p.internal_pic, '') || ' ' ||
  coalesce(p.country, '') || ' ' || coalesce(p.notes, '') || ' ' || p.partner_id || ' ' || coalesce(p.pic_name, ''))`;
const lower = (value: unknown) => String(value ?? '').trim().toLowerCase();

export function createPartnerRepository(db: Sql) {
  const base = createEntityRepository(db, 'partners');

  function where(organizationId: string, query: PartnerQuery) {
    const clauses = ['p.organization_id = ?'];
    const params: unknown[] = [organizationId];
    if (query.ids) { clauses.push('p.partner_id = ANY(?)'); params.push(query.ids); }
    if (query.internalPic?.length) { clauses.push('p.internal_pic = ANY(?)'); params.push(query.internalPic); }
    if (query.partnerType?.length) { clauses.push('p.partner_type = ANY(?)'); params.push(query.partnerType); }
    if (query.statusDd?.length) { clauses.push('p.status_dd = ANY(?)'); params.push(query.statusDd); }
    if (query.country?.length) { clauses.push('p.country = ANY(?)'); params.push(query.country); }
    for (const pattern of searchPatterns(query.q ?? '')) { clauses.push(`${HAYSTACK} ILIKE ?`); params.push(pattern); }
    return { sql: clauses.join(' AND '), params };
  }

  /** A page of the organization's partners plus the total that match (before paging). No `limit` returns everything. */
  async function list(organizationId: string, query: PartnerQuery = {}): Promise<PartnerPage> {
    const filter = where(organizationId, query);
    const total = Number((await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM partners p WHERE ${filter.sql}`, ...filter.params))?.n ?? 0);
    const order = SORT_SQL[query.sort && query.sort in SORT_SQL ? query.sort : 'default'];
    const orderBy = query.dir === 'desc' ? order.split(', ').map((part) => part + ' DESC').join(', ') : order;
    const paged = query.limit !== undefined;
    const limit = paged ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(query.limit)) || 50)) : undefined;
    const offset = Math.max(0, Math.trunc(Number(query.offset)) || 0);
    const records = await db.all<Row>(
      `SELECT p.* FROM partners p WHERE ${filter.sql} ORDER BY ${orderBy}${paged ? ' LIMIT ? OFFSET ?' : ''}`,
      ...filter.params, ...(paged ? [limit, offset] : []));
    return { rows: await base.hydrate(records), total };
  }

  return {
    ...base,
    list,
    async exists(organizationId: string, id: string): Promise<boolean> {
      return Boolean(await db.get('SELECT 1 FROM partners WHERE organization_id = ? AND partner_id = ?', organizationId, id));
    },
    /** First partner of the organization with this name (compared trimmed and case-insensitively). */
    async findByName(organizationId: string, name: unknown): Promise<Partner | undefined> {
      const key = lower(name);
      if (!key) return undefined;
      const record = await db.get<Row>(
        `SELECT * FROM partners WHERE organization_id = ? AND lower(btrim(partner_name)) = ? ORDER BY record_position, partner_id LIMIT 1`, organizationId, key);
      return record ? (await base.hydrate([record]))[0] : undefined;
    },
    /** The partner with this id, else the one with this name (trimmed, case-insensitive), inside the organization. */
    async findByIdOrName(organizationId: string, id: unknown, name: unknown): Promise<Partner | undefined> {
      const wantedId = String(id ?? '');
      const wantedName = lower(name);
      if (!wantedId && !wantedName) return undefined;
      const record = await db.get<Row>(
        `SELECT * FROM partners WHERE organization_id = ? AND (partner_id = ? OR (? <> '' AND lower(btrim(partner_name)) = ?))
         ORDER BY (partner_id = ?) DESC, record_position, partner_id LIMIT 1`, organizationId, wantedId, wantedName, wantedName, wantedId);
      return record ? (await base.hydrate([record]))[0] : undefined;
    },
    /** Partner by id without knowing its organization (route handlers check ownership afterwards, answering 404 for strangers). */
    async getAnyOrganization(id: string): Promise<Partner | undefined> {
      const record = await db.get<Row>('SELECT * FROM partners WHERE partner_id = ?', id);
      return record ? (await base.hydrate([record]))[0] : undefined;
    },
    async count(organizationId?: string): Promise<number> {
      return Number((await (organizationId === undefined
        ? db.get<{ n: number }>('SELECT COUNT(*) AS n FROM partners')
        : db.get<{ n: number }>('SELECT COUNT(*) AS n FROM partners WHERE organization_id = ?', organizationId)))?.n ?? 0);
    },
    async anyIn(organizationId: string): Promise<boolean> {
      return Boolean(await db.get('SELECT 1 FROM partners WHERE organization_id = ? LIMIT 1', organizationId));
    },
    async anyAtAll(): Promise<boolean> {
      return Boolean(await db.get('SELECT 1 FROM partners LIMIT 1'));
    },
    /** Does any partner of the organization name this department as `internal_pic`? */
    async departmentReferenced(organizationId: string, normalizedName: string): Promise<boolean> {
      return Boolean(await db.get(
        `SELECT 1 FROM partners WHERE organization_id = ? AND lower(regexp_replace(btrim(coalesce(internal_pic, '')), '\\s+', ' ', 'g')) = ? LIMIT 1`,
        organizationId, normalizedName));
    },
    /** The department-relevant columns of every partner of an organization (narrow read; no child tables). */
    async directory(organizationId: string): Promise<PartnerDirectoryEntry[]> {
      return (await db.all<{ partner_id: string; partner_name: string | null; internal_pic: string | null }>(
        'SELECT partner_id, partner_name, internal_pic FROM partners WHERE organization_id = ?', organizationId))
        .map((r) => ({ partner_id: r.partner_id, organizationId, partner_name: r.partner_name, internal_pic: r.internal_pic }));
    },
    /** Names for display next to other records. */
    async names(organizationId: string, ids: string[]): Promise<Map<string, string>> {
      const list = [...new Set(ids.filter(Boolean))];
      if (!list.length) return new Map();
      const rows = await db.all<{ partner_id: string; partner_name: string | null }>(
        'SELECT partner_id, partner_name FROM partners WHERE organization_id = ? AND partner_id = ANY(?)', organizationId, list);
      return new Map(rows.map((r) => [r.partner_id, r.partner_name ?? '']));
    },
  };
}

/** The application's partner repository (the shared SQL facade; its transactions are ambient). */
export const partnerRepository = createPartnerRepository(sql);
export type PartnerRepository = ReturnType<typeof createPartnerRepository>;
