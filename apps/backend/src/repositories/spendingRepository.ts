/**
 * Spendings (vendor invoices): explicit SQL for every read and write, scoped by organization, with optimistic concurrency.
 * They are not part of the in-memory snapshot (see normalizedSchema.ts `repository: true`).
 */
import { sql, type Sql } from '../db';
import { searchPatterns } from '../normalizedCoreStore';
import { MAX_PAGE_SIZE } from './contractRepository';
import { createEntityRepository, type Row } from './entityRepository';

export type Spending = Row;
export const SPENDING_SORTS = ['default', 'invoice_date', 'vendor_name', 'total_amount_usd', 'created_at', 'invoice_number', 'invoice_month', 'attachment'] as const;
export type SpendingSort = typeof SPENDING_SORTS[number];

export interface SpendingQuery {
  /** Free text: every word must occur in the vendor, invoice number, title, description, payment status or id (case-insensitive). */
  q?: string;
  ids?: string[];
  paymentStatus?: string[];
  vendorId?: string[];
  /** Exact vendor name, case-insensitive. */
  vendorName?: string;
  currency?: string[];
  /** Spendings reported in this year (any of their reporting months, or the invoice date's year). */
  year?: string;
  /** Two-digit month (`01`..`12`) of any reporting month (inside `year` when given). */
  month?: string;
  sort?: SpendingSort;
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}
export interface SpendingPage { rows: Spending[]; total: number }

const FIRST_MONTH = `COALESCE((SELECT MIN(rm.month) FROM spending_reporting_months rm WHERE rm.spending_id = s.id), s.invoice_date, '')`;
const SORT_SQL: Record<SpendingSort, string[]> = {
  default: ['s.record_position', 's.id'],
  invoice_date: ['s.invoice_date', 's.id'],
  vendor_name: ['lower(s.vendor_name)', 's.id'],
  total_amount_usd: ['(s.total_amount_usd_minor::numeric / power(10::numeric, coalesce(s.total_amount_usd_scale, 0)))', 's.id'],
  created_at: ['s.created_at', 's.id'],
  invoice_number: ['lower(s.invoice_number)', 's.id'],
  invoice_month: [FIRST_MONTH, 's.id'],
  attachment: ["COALESCE(s.invoice_file_url, '')", 's.id'],
};
const HAYSTACK = `(coalesce(s.vendor_name, '') || ' ' || coalesce(s.invoice_number, '') || ' ' || coalesce(s.invoice_title, '') || ' ' ||
  coalesce(s.invoice_description, '') || ' ' || coalesce(s.payment_status, '') || ' ' || coalesce(s.bank_name, '') || ' ' || s.id)`;
const lower = (value: unknown) => String(value ?? '').trim().toLowerCase();

export function createSpendingRepository(db: Sql) {
  const base = createEntityRepository(db, 'spendings');

  function where(organizationId: string, query: SpendingQuery) {
    const clauses = ['s.organization_id = ?'];
    const params: unknown[] = [organizationId];
    if (query.ids) { clauses.push('s.id = ANY(?)'); params.push(query.ids); }
    if (query.paymentStatus?.length) { clauses.push('s.payment_status = ANY(?)'); params.push(query.paymentStatus); }
    if (query.vendorId?.length) { clauses.push('s.vendor_id = ANY(?)'); params.push(query.vendorId); }
    if (query.currency?.length) { clauses.push('s.currency = ANY(?)'); params.push(query.currency); }
    if (query.vendorName) { clauses.push('lower(btrim(s.vendor_name)) = ?'); params.push(query.vendorName.trim().toLowerCase()); }
    if (query.year || query.month) {
      const year = /^\d{4}$/.test(query.year ?? '') ? query.year! : '____';
      const month = /^\d{2}$/.test(query.month ?? '') ? query.month! : '__';
      const monthPattern = `${year}-${month}%`;
      clauses.push(`(EXISTS (SELECT 1 FROM spending_reporting_months rm WHERE rm.spending_id = s.id AND rm.month LIKE ?)${query.month ? '' : ' OR s.invoice_date LIKE ?'})`);
      params.push(monthPattern);
      if (!query.month) params.push(`${year}%`);
    }
    for (const pattern of searchPatterns(query.q ?? '')) { clauses.push(`${HAYSTACK} ILIKE ?`); params.push(pattern); }
    return { sql: clauses.join(' AND '), params };
  }

  /** A page of the organization's spendings plus the total that match (before paging). No `limit` returns everything. */
  async function list(organizationId: string, query: SpendingQuery = {}): Promise<SpendingPage> {
    const filter = where(organizationId, query);
    const total = Number((await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM spendings s WHERE ${filter.sql}`, ...filter.params))?.n ?? 0);
    const order = SORT_SQL[query.sort && query.sort in SORT_SQL ? query.sort : 'default'];
    const orderBy = order.map((part) => (query.dir === 'desc' ? part + ' DESC' : part)).join(', ');
    const paged = query.limit !== undefined;
    const limit = paged ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(query.limit)) || 50)) : undefined;
    const offset = Math.max(0, Math.trunc(Number(query.offset)) || 0);
    const records = await db.all<Row>(
      `SELECT s.* FROM spendings s WHERE ${filter.sql} ORDER BY ${orderBy}${paged ? ' LIMIT ? OFFSET ?' : ''}`,
      ...filter.params, ...(paged ? [limit, offset] : []));
    return { rows: await base.hydrate(records), total };
  }

  return {
    ...base,
    list,
    /** An invoice of this vendor with this number already recorded (trimmed, case-insensitive). */
    async findDuplicate(organizationId: string, invoiceNumber: unknown, vendorName: unknown): Promise<Spending | undefined> {
      const record = await db.get<Row>(
        `SELECT * FROM spendings WHERE organization_id = ? AND lower(btrim(invoice_number)) = ? AND lower(btrim(vendor_name)) = ? ORDER BY record_position LIMIT 1`,
        organizationId, lower(invoiceNumber), lower(vendorName));
      return record ? (await base.hydrate([record]))[0] : undefined;
    },
    async count(organizationId?: string): Promise<number> {
      return Number((await (organizationId === undefined
        ? db.get<{ n: number }>('SELECT COUNT(*) AS n FROM spendings')
        : db.get<{ n: number }>('SELECT COUNT(*) AS n FROM spendings WHERE organization_id = ?', organizationId)))?.n ?? 0);
    },
    async anyAtAll(): Promise<boolean> {
      return Boolean(await db.get('SELECT 1 FROM spendings LIMIT 1'));
    },
    /** Distinct currencies in use (all organizations), for the exchange-rate preload. */
    async currencies(): Promise<string[]> {
      return (await db.all<{ currency: string }>(`SELECT DISTINCT currency FROM spendings WHERE currency IS NOT NULL AND currency <> ''`)).map((r) => r.currency);
    },
    /** A deleted partner leaves its invoices in place, without the vendor link (a new version: the link changed). */
    async detachVendor(organizationId: string, vendorId: string): Promise<number> {
      return db.tx(async () => {
        const ids = (await db.all<{ id: string }>('SELECT id FROM spendings WHERE organization_id = ? AND vendor_id = ? ORDER BY id', organizationId, vendorId)).map((r) => r.id);
        // Through the row (not a bare UPDATE) so the API keeps answering `vendor_id: null`, as it always did.
        for (const id of ids) await base.mutate(organizationId, id, (row) => { row.vendor_id = null; });
        return ids.length;
      });
    },
  };
}

/** The application's spending repository (the shared SQL facade; its transactions are ambient). */
export const spendingRepository = createSpendingRepository(sql);
export type SpendingRepository = ReturnType<typeof createSpendingRepository>;
