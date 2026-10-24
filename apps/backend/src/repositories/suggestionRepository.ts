/**
 * The AI review queue and the key terms accepted from it. Explicit SQL, always scoped by organization; a suggestion is decided at most
 * once (the decision locks the row), and a key term keeps the provenance of the suggestion it came from.
 */
import crypto from 'node:crypto';
import { sql, type Sql } from '../db';
import type { SuggestionDraft } from '../contractExtraction';

export type SuggestionRow = Record<string, any>;
export interface SuggestionQuery { status?: string; kind?: string; contractId?: string; contractIds?: string[]; limit?: number; offset?: number }

const SELECT = `s.*, c.contract_number, c.contract_title`;
const FROM = `ai_suggestions s JOIN contracts c ON c.contract_id = s.contract_id`;

export const presentSuggestion = (row: SuggestionRow) => {
  const { organization_id, payload, ...rest } = row;
  return { ...rest, organizationId: organization_id, payload: JSON.parse(payload), source_page: row.source_page == null ? null : Number(row.source_page), confidence: row.confidence == null ? null : Number(row.confidence), version: Number(row.version) };
};

export function createSuggestionRepository(db: Sql) {
  function where(organizationId: string, query: SuggestionQuery) {
    const clauses = ['s.organization_id = ?'];
    const params: unknown[] = [organizationId];
    if (query.status) { clauses.push('s.status = ?'); params.push(query.status); }
    if (query.kind) { clauses.push('s.kind = ?'); params.push(query.kind); }
    if (query.contractId) { clauses.push('s.contract_id = ?'); params.push(query.contractId); }
    if (query.contractIds) { clauses.push('s.contract_id = ANY(?)'); params.push(query.contractIds); }
    return { sql: clauses.join(' AND '), params };
  }
  return {
    /** Queues the drafts of one extraction; those already pending or accepted for the contract are skipped. */
    async insertMany(organizationId: string, contractId: string, extractionId: string, drafts: SuggestionDraft[], meta: { createdBy: string | null; sourceName: string | null; model: string }) {
      const created: string[] = [];
      const now = new Date().toISOString();
      await db.tx(async () => {
        for (const draft of drafts) {
          const id = `sug-${crypto.randomUUID()}`;
          const result = await db.run(`INSERT INTO ai_suggestions (id, organization_id, contract_id, extraction_id, kind, payload, source_quote, source_page, confidence, quote_verified, dedupe_key, source_name, model, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (contract_id, dedupe_key) WHERE status IN ('pending', 'accepted') DO NOTHING`,
            id, organizationId, contractId, extractionId, draft.kind, JSON.stringify(draft.payload), draft.source_quote, draft.source_page, draft.confidence, draft.quote_verified, draft.dedupe_key, meta.sourceName, meta.model, meta.createdBy, now);
          if (result.changes) created.push(id);
        }
      });
      return { created, duplicates: drafts.length - created.length };
    },
    async get(organizationId: string, id: string): Promise<SuggestionRow | undefined> {
      return db.get(`SELECT ${SELECT} FROM ${FROM} WHERE s.organization_id = ? AND s.id = ?`, organizationId, id);
    },
    async getMany(organizationId: string, ids: string[]): Promise<SuggestionRow[]> {
      if (!ids.length) return [];
      return db.all(`SELECT ${SELECT} FROM ${FROM} WHERE s.organization_id = ? AND s.id = ANY(?) ORDER BY s.created_at, s.id`, organizationId, ids);
    },
    async list(organizationId: string, query: SuggestionQuery): Promise<{ rows: SuggestionRow[]; total: number }> {
      const filter = where(organizationId, query);
      const total = Number((await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${FROM} WHERE ${filter.sql}`, ...filter.params))?.n ?? 0);
      const paged = query.limit !== undefined;
      const rows = await db.all(`SELECT ${SELECT} FROM ${FROM} WHERE ${filter.sql} ORDER BY s.status = 'pending' DESC, s.created_at DESC, s.kind, s.id${paged ? ' LIMIT ? OFFSET ?' : ''}`,
        ...filter.params, ...(paged ? [Math.min(500, Math.max(1, query.limit!)), Math.max(0, query.offset ?? 0)] : []));
      return { rows, total };
    },
    async pendingCounts(organizationId: string, contractIds?: string[]) {
      const rows = await db.all<{ kind: string; n: number }>(`SELECT kind, COUNT(*)::int AS n FROM ai_suggestions WHERE organization_id = ? AND status = 'pending'${contractIds ? ' AND contract_id = ANY(?)' : ''} GROUP BY kind`,
        organizationId, ...(contractIds ? [contractIds] : []));
      const by = Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)]));
      return { obligation: by.obligation ?? 0, key_term: by.key_term ?? 0, total: (by.obligation ?? 0) + (by.key_term ?? 0) };
    },
    async lockPending(organizationId: string, id: string): Promise<SuggestionRow | undefined | 'decided'> {
      const row = await db.get<SuggestionRow>('SELECT * FROM ai_suggestions WHERE organization_id = ? AND id = ? FOR UPDATE', organizationId, id);
      if (!row) return undefined;
      return row.status === 'pending' ? row : 'decided';
    },
    async markDecided(organizationId: string, id: string, status: 'accepted' | 'rejected', decidedBy: string | null, resultRef: string | null) {
      await db.run(`UPDATE ai_suggestions SET status = ?, decided_by = ?, decided_at = ?, result_ref = ?, version = version + 1 WHERE organization_id = ? AND id = ?`,
        status, decidedBy, new Date().toISOString(), resultRef, organizationId, id);
    },
    async listKeyTerms(organizationId: string, contractId: string) {
      return db.all(`SELECT * FROM contract_key_terms WHERE organization_id = ? AND contract_id = ? ORDER BY label, id`, organizationId, contractId);
    },
    async upsertKeyTerm(organizationId: string, contractId: string, term: { key: string; label: string; value: string; summary: string; quote: string | null; page: number | null; confidence: number | null; confirmedBy: string | null }) {
      const now = new Date().toISOString();
      return db.get<SuggestionRow>(`INSERT INTO contract_key_terms (id, organization_id, contract_id, term_key, label, value, summary, source, source_quote, source_page, source_confidence, confirmed_by, confirmed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ai_extracted', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (contract_id, term_key) DO UPDATE SET label = excluded.label, value = excluded.value, summary = excluded.summary, source_quote = excluded.source_quote,
          source_page = excluded.source_page, source_confidence = excluded.source_confidence, confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at,
          updated_at = excluded.updated_at, version = contract_key_terms.version + 1 RETURNING *`,
        `ckt-${crypto.randomUUID()}`, organizationId, contractId, term.key, term.label, term.value, term.summary, term.quote, term.page, term.confidence, term.confirmedBy, now, now, now);
    },
    async removeKeyTerm(organizationId: string, contractId: string, termKey: string): Promise<boolean> {
      return (await db.run('DELETE FROM contract_key_terms WHERE organization_id = ? AND contract_id = ? AND term_key = ?', organizationId, contractId, termKey)).changes > 0;
    },
  };
}

export const suggestionRepository = createSuggestionRepository(sql);
