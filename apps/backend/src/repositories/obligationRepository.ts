/**
 * Obligations and key dates: explicit SQL for every read and write, scoped by organization, with optimistic concurrency on `version`
 * (same contract as the other repositories: a stale write is a 409 VERSION_CONFLICT, `mutate` edits the row as it is now).
 */
import crypto from 'node:crypto';
import { sql, type Sql } from '../db';
import { searchPatterns } from '../normalizedCoreStore';
import { daysBetween, effectiveStatus, type ObligationStatus, type ObligationStoredStatus } from '@legalio/shared/obligations';
import { RecordNotFoundError, VersionConflictError } from './errors';

export type Obligation = Record<string, any>;
export const OBLIGATION_SORTS = ['due_date', 'title', 'type', 'status', 'created_at', 'updated_at'] as const;
export type ObligationSort = (typeof OBLIGATION_SORTS)[number];
const MAX_PAGE_SIZE = 500;

export interface ObligationQuery {
  q?: string;
  /** Stored statuses plus the derived `overdue`. */
  status?: ObligationStatus[];
  type?: string[];
  contractId?: string;
  ioId?: string;
  partnerId?: string;
  responsibleUserId?: string;
  department?: string;
  source?: string;
  /** Due date on or after / on or before (YYYY-MM-DD). */
  dueFrom?: string;
  dueTo?: string;
  /** Organization-local "today": the reference for `overdue`. */
  today: string;
  sort?: ObligationSort;
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}
export interface ObligationPage { rows: Obligation[]; total: number }

/** The columns a row carries next to the stored obligation. */
const SELECT = `o.*, c.contract_number, c.contract_title, i.io_number, i.io_title, p.partner_name,
  u.name AS responsible_name, u.email AS responsible_email`;
const FROM = `obligations o
  LEFT JOIN contracts c ON c.contract_id = o.contract_id
  LEFT JOIN insertion_orders i ON i.io_id = o.io_id
  LEFT JOIN partners p ON p.partner_id = o.partner_id
  LEFT JOIN "user" u ON u.id = o.responsible_user_id`;
const SORT_SQL: Record<ObligationSort, string[]> = {
  // Rows without a due date come last whatever the direction.
  due_date: ['o.due_date IS NULL', 'o.due_date', 'o.id'],
  title: ['lower(o.title)', 'o.id'],
  type: ['o.type', 'o.due_date', 'o.id'],
  status: ['o.status', 'o.due_date', 'o.id'],
  created_at: ['o.created_at', 'o.id'],
  updated_at: ['o.updated_at', 'o.id'],
};

/** Stored row -> API record (derived status and numeric fields). */
export function presentObligation(row: Obligation, today: string): Obligation {
  const {
    last_due_soon_cycle: _a, last_overdue_cycle: _b, organization_id, ...rest
  } = row;
  return {
    ...rest,
    organizationId: organization_id,
    status: effectiveStatus(row.status as ObligationStoredStatus, row.due_date, today),
    stored_status: row.status,
    days_until: daysBetween(today, row.due_date),
    source_confidence: row.source_confidence == null ? null : Number(row.source_confidence),
    source_page: row.source_page == null ? null : Number(row.source_page),
    version: Number(row.version),
  };
}

export function createObligationRepository(db: Sql) {
  function where(organizationId: string, query: ObligationQuery) {
    const clauses = ['o.organization_id = ?'];
    const params: unknown[] = [organizationId];
    const add = (clause: string, ...values: unknown[]) => { clauses.push(clause); params.push(...values); };
    for (const pattern of query.q ? searchPatterns(query.q) : []) {
      add(`(o.title ILIKE ? OR o.description ILIKE ? OR coalesce(c.contract_number, '') ILIKE ? OR coalesce(c.contract_title, '') ILIKE ? OR coalesce(p.partner_name, '') ILIKE ?)`, pattern, pattern, pattern, pattern, pattern);
    }
    if (query.status?.length) {
      const stored = query.status.filter((s) => s !== 'overdue');
      const parts: string[] = [];
      if (stored.length) {
        // A stored open/in_progress row is "overdue" once its date passed, so it only matches `open`/`in_progress` while it is not.
        parts.push(`(o.status = ANY(?) AND NOT (o.status IN ('open', 'in_progress') AND o.due_date < ?))`);
        params.push(stored, query.today);
      }
      if (query.status.includes('overdue')) {
        parts.push(`(o.status IN ('open', 'in_progress') AND o.due_date < ?)`);
        params.push(query.today);
      }
      clauses.push(`(${parts.join(' OR ')})`);
    }
    if (query.type?.length) add('o.type = ANY(?)', query.type);
    if (query.contractId) add('o.contract_id = ?', query.contractId);
    if (query.ioId) add('o.io_id = ?', query.ioId);
    if (query.partnerId) add('o.partner_id = ?', query.partnerId);
    if (query.responsibleUserId) add('o.responsible_user_id = ?', query.responsibleUserId);
    if (query.department) add('lower(btrim(o.responsible_department)) = ?', query.department.trim().toLowerCase());
    if (query.source) add('o.source = ?', query.source);
    if (query.dueFrom) add('o.due_date >= ?', query.dueFrom);
    if (query.dueTo) add('o.due_date <= ?', query.dueTo);
    return { sql: clauses.join(' AND '), params };
  }

  async function get(organizationId: string, id: string): Promise<Obligation | undefined> {
    return db.get<Obligation>(`SELECT ${SELECT} FROM ${FROM} WHERE o.organization_id = ? AND o.id = ?`, organizationId, id);
  }

  /** A page of the organization's obligations plus the total that match. No `limit` returns everything (department filtering happens after). */
  async function list(organizationId: string, query: ObligationQuery): Promise<ObligationPage> {
    const filter = where(organizationId, query);
    const total = Number((await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${FROM} WHERE ${filter.sql}`, ...filter.params))?.n ?? 0);
    const order = SORT_SQL[query.sort && query.sort in SORT_SQL ? query.sort : 'due_date'];
    const orderBy = order.map((part) => (query.dir === 'desc' && !part.endsWith('IS NULL') ? part + ' DESC' : part)).join(', ');
    const paged = query.limit !== undefined;
    const limit = paged ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(query.limit)) || 50)) : undefined;
    const offset = Math.max(0, Math.trunc(Number(query.offset)) || 0);
    const rows = await db.all<Obligation>(
      `SELECT ${SELECT} FROM ${FROM} WHERE ${filter.sql} ORDER BY ${orderBy}${paged ? ' LIMIT ? OFFSET ?' : ''}`,
      ...filter.params, ...(paged ? [limit, offset] : []));
    return { rows, total };
  }

  /** The fields a client may write; everything else (`version`, ids, completion state, ledger markers) is set by the server. */
  const WRITABLE = ['contract_id', 'io_id', 'partner_id', 'title', 'description', 'type', 'due_date', 'recurrence', 'recurrence_interval', 'recurrence_until',
    'responsible_user_id', 'responsible_department', 'status', 'lead_days', 'source', 'source_quote', 'source_page', 'source_confidence', 'confirmed_by', 'confirmed_at',
    'completed_at', 'completed_by', 'completions'] as const;

  async function insert(organizationId: string, input: Obligation, actorId: string | null): Promise<Obligation> {
    const id = `obl-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const values: Obligation = { id, organization_id: organizationId, created_by: actorId, created_at: now, updated_at: now };
    for (const key of WRITABLE) if (input[key] !== undefined) values[key] = input[key];
    const names = Object.keys(values);
    await db.run(`INSERT INTO obligations (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((n) => '@' + n).join(', ')})`, values);
    return (await get(organizationId, id))!;
  }

  /** Replaces the writable fields if the stored version is still `expectedVersion` (409 otherwise, 404 when gone). */
  async function update(organizationId: string, id: string, patch: Obligation, expectedVersion: number): Promise<Obligation> {
    const values: Obligation = {};
    for (const key of WRITABLE) if (patch[key] !== undefined) values[key] = patch[key];
    const names = Object.keys(values);
    const set = [...names.map((n) => `"${n}" = @${n}`), 'updated_at = @updated_at', 'version = version + 1'].join(', ');
    const result = await db.run(`UPDATE obligations SET ${set} WHERE organization_id = @row_org AND id = @row_id AND version = @row_expected`,
      { ...values, updated_at: new Date().toISOString(), row_org: organizationId, row_id: id, row_expected: expectedVersion });
    if (!result.changes) {
      const current = await db.get('SELECT version FROM obligations WHERE organization_id = ? AND id = ?', organizationId, id);
      throw current ? new VersionConflictError('obligations', id, expectedVersion) : new RecordNotFoundError('obligations', id);
    }
    return (await get(organizationId, id))!;
  }

  /** Locked read-modify-write: `change` gets the row as it is now and returns the patch to write (or null to write nothing). */
  async function mutate(organizationId: string, id: string, change: (row: Obligation) => Obligation | null | Promise<Obligation | null>): Promise<Obligation | undefined> {
    return db.tx(async () => {
      const locked = await db.get<Obligation>('SELECT * FROM obligations WHERE organization_id = ? AND id = ? FOR UPDATE', organizationId, id);
      if (!locked) return undefined;
      const patch = await change(locked);
      if (!patch) return (await get(organizationId, id))!;
      return update(organizationId, id, patch, Number(locked.version));
    });
  }

  /** Several obligations of the organization by id (with the display columns), in no particular order. */
  async function getMany(organizationId: string, ids: string[]): Promise<Obligation[]> {
    if (!ids.length) return [];
    return db.all<Obligation>(`SELECT ${SELECT} FROM ${FROM} WHERE o.organization_id = ? AND o.id = ANY(?)`, organizationId, ids);
  }

  return {
    get, getMany, list, insert, update, mutate,
    async remove(organizationId: string, id: string): Promise<boolean> {
      return (await db.run('DELETE FROM obligations WHERE organization_id = ? AND id = ?', organizationId, id)).changes > 0;
    },
    async count(organizationId: string): Promise<number> {
      return Number((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM obligations WHERE organization_id = ?', organizationId))?.n ?? 0);
    },
    /**
     * The dashboard figures as one SQL aggregate: open work (open / in progress) that is overdue, due today, due within the next
     * 7 days (today included) and open in total. `ids` limits the count to those obligations (department roles).
     */
    async summary(organizationId: string, today: string, weekEnd: string, ids?: string[]) {
      const scope = ids ? ' AND o.id = ANY(?)' : '';
      const row = await db.get<{ overdue: number; due_today: number; due_this_week: number; open_total: number; no_date: number }>(`
        SELECT
          COUNT(*) FILTER (WHERE o.due_date < ?) AS overdue,
          COUNT(*) FILTER (WHERE o.due_date = ?) AS due_today,
          COUNT(*) FILTER (WHERE o.due_date >= ? AND o.due_date <= ?) AS due_this_week,
          COUNT(*) AS open_total,
          COUNT(*) FILTER (WHERE o.due_date IS NULL) AS no_date
        FROM obligations o WHERE o.organization_id = ? AND o.status IN ('open', 'in_progress')${scope}`,
        today, today, today, weekEnd, organizationId, ...(ids ? [ids] : []));
      return {
        overdue: Number(row?.overdue ?? 0), dueToday: Number(row?.due_today ?? 0), dueThisWeek: Number(row?.due_this_week ?? 0),
        open: Number(row?.open_total ?? 0), withoutDate: Number(row?.no_date ?? 0),
      };
    },
    /** Open obligations with the link columns department scoping needs (department roles count these after filtering). */
    async openDirectory(organizationId: string): Promise<Obligation[]> {
      return db.all('SELECT id, contract_id, io_id, partner_id, responsible_department, responsible_user_id FROM obligations WHERE organization_id = ? AND status IN (\'open\', \'in_progress\')', organizationId);
    },
    async getSettings(organizationId: string): Promise<{ leadDays: number | null }> {
      const row = await db.get<{ lead_days: number }>('SELECT lead_days FROM obligation_settings WHERE organization_id = ?', organizationId);
      return { leadDays: row ? Number(row.lead_days) : null };
    },
    async saveSettings(organizationId: string, leadDays: number, actorId: string | null): Promise<void> {
      await db.run(`INSERT INTO obligation_settings (organization_id, lead_days, updated_by, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (organization_id) DO UPDATE SET lead_days = excluded.lead_days, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        organizationId, leadDays, actorId, new Date().toISOString());
    },
  };
}

/** The application's obligation repository (the shared SQL facade; its transactions are ambient). */
export const obligationRepository = createObligationRepository(sql);
export type ObligationRepository = ReturnType<typeof createObligationRepository>;
