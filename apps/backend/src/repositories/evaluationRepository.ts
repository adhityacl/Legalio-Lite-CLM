/**
 * Partner evaluations: explicit SQL for every read and write, scoped by organization, with optimistic concurrency.
 * They are not part of the in-memory snapshot (see normalizedSchema.ts `repository: true`).
 */
import { sql, type Sql } from '../db';
import { searchPatterns } from '../normalizedCoreStore';
import { MAX_PAGE_SIZE } from './contractRepository';
import { createEntityRepository, type Row } from './entityRepository';

export type Evaluation = Row;
export const EVALUATION_SORTS = ['default', 'review_date', 'supplier_name', 'total_score', 'created_at'] as const;
export type EvaluationSort = typeof EVALUATION_SORTS[number];

export interface EvaluationQuery {
  /** Free text: every word must occur in the supplier, type of work, notes, final evaluation or id (case-insensitive). */
  q?: string;
  ids?: string[];
  partnerId?: string[];
  finalEvaluation?: string[];
  sort?: EvaluationSort;
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}
export interface EvaluationPage { rows: Evaluation[]; total: number }

const SORT_SQL: Record<EvaluationSort, string[]> = {
  default: ['e.record_position', 'e.id'],
  review_date: ['e.review_date', 'e.id'],
  supplier_name: ['lower(e.supplier_name)', 'e.id'],
  total_score: ['e.calculated_score', 'e.id'],
  created_at: ['e.created_at', 'e.id'],
};
const HAYSTACK = `(coalesce(e.supplier_name, '') || ' ' || coalesce(e.type_of_work, '') || ' ' || coalesce(e.notes, '') || ' ' || coalesce(e.final_evaluation, '') || ' ' || e.id)`;

export function createEvaluationRepository(db: Sql) {
  const base = createEntityRepository(db, 'evaluations');

  function where(organizationId: string, query: EvaluationQuery) {
    const clauses = ['e.organization_id = ?'];
    const params: unknown[] = [organizationId];
    if (query.ids) { clauses.push('e.id = ANY(?)'); params.push(query.ids); }
    if (query.partnerId?.length) { clauses.push('e.partner_id = ANY(?)'); params.push(query.partnerId); }
    if (query.finalEvaluation?.length) { clauses.push('e.final_evaluation = ANY(?)'); params.push(query.finalEvaluation); }
    for (const pattern of searchPatterns(query.q ?? '')) { clauses.push(`${HAYSTACK} ILIKE ?`); params.push(pattern); }
    return { sql: clauses.join(' AND '), params };
  }

  /** A page of the organization's evaluations plus the total that match (before paging). No `limit` returns everything. */
  async function list(organizationId: string, query: EvaluationQuery = {}): Promise<EvaluationPage> {
    const filter = where(organizationId, query);
    const total = Number((await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM evaluations e WHERE ${filter.sql}`, ...filter.params))?.n ?? 0);
    const order = SORT_SQL[query.sort && query.sort in SORT_SQL ? query.sort : 'default'];
    const orderBy = order.map((part) => (query.dir === 'desc' ? part + ' DESC' : part)).join(', ');
    const paged = query.limit !== undefined;
    const limit = paged ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(query.limit)) || 50)) : undefined;
    const offset = Math.max(0, Math.trunc(Number(query.offset)) || 0);
    const records = await db.all<Row>(
      `SELECT e.* FROM evaluations e WHERE ${filter.sql} ORDER BY ${orderBy}${paged ? ' LIMIT ? OFFSET ?' : ''}`,
      ...filter.params, ...(paged ? [limit, offset] : []));
    return { rows: await base.hydrate(records), total };
  }

  return {
    ...base,
    list,
    /** An evaluation of this supplier on this review date already recorded (trimmed, case-insensitive). */
    async findDuplicate(organizationId: string, supplierName: unknown, reviewDate: unknown): Promise<Evaluation | undefined> {
      const record = await db.get<Row>(
        `SELECT * FROM evaluations WHERE organization_id = ? AND lower(btrim(supplier_name)) = ? AND review_date = ? ORDER BY record_position LIMIT 1`,
        organizationId, String(supplierName ?? '').trim().toLowerCase(), String(reviewDate ?? ''));
      return record ? (await base.hydrate([record]))[0] : undefined;
    },
    async count(organizationId?: string): Promise<number> {
      return Number((await (organizationId === undefined
        ? db.get<{ n: number }>('SELECT COUNT(*) AS n FROM evaluations')
        : db.get<{ n: number }>('SELECT COUNT(*) AS n FROM evaluations WHERE organization_id = ?', organizationId)))?.n ?? 0);
    },
    async anyAtAll(): Promise<boolean> {
      return Boolean(await db.get('SELECT 1 FROM evaluations LIMIT 1'));
    },
    /** A deleted partner leaves its evaluations in place, without the partner link (a new version: the link changed). */
    async detachPartner(organizationId: string, partnerId: string): Promise<number> {
      return db.tx(async () => {
        const ids = (await db.all<{ id: string }>('SELECT id FROM evaluations WHERE organization_id = ? AND partner_id = ? ORDER BY id', organizationId, partnerId)).map((r) => r.id);
        // Through the row (not a bare UPDATE) so the API keeps answering `partner_id: null`, as it always did.
        for (const id of ids) await base.mutate(organizationId, id, (row) => { row.partner_id = null; });
        return ids.length;
      });
    },
  };
}

/** The application's evaluation repository (the shared SQL facade; its transactions are ambient). */
export const evaluationRepository = createEvaluationRepository(sql);
export type EvaluationRepository = ReturnType<typeof createEvaluationRepository>;
