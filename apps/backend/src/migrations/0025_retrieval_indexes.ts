import type { Sql } from '../db';
import type { Migration } from './types';
import { RETRIEVAL_CONFIG, RETRIEVAL_TEXT, type RetrievalTable } from '../retrievalText';

/**
 * Retrieval for the AI chat (Phase 3B / item 4): PostgreSQL full-text indexes over the text of the records the assistant may cite
 * (workspace search records of contracts, partners, orders, spendings and evaluations, obligations, clauses, accepted key terms and the
 * text of editor documents). They are expression indexes on `to_tsvector('simple', <text>)`, so no table is rewritten and no column is
 * added; the queries repeat the same expression (retrievalText.ts). `IF NOT EXISTS` makes the migration repeatable.
 */
export const migration: Migration = {
  id: '0025_retrieval_indexes',
  name: 'Full-text (tsvector) indexes for AI chat retrieval',
  async up(sql: Sql) {
    for (const table of Object.keys(RETRIEVAL_TEXT) as RetrievalTable[]) {
      await sql.exec(`CREATE INDEX IF NOT EXISTS idx_retrieval_fts_${table} ON ${table} USING gin (to_tsvector('${RETRIEVAL_CONFIG}', ${RETRIEVAL_TEXT[table]}))`);
    }
  },
};
