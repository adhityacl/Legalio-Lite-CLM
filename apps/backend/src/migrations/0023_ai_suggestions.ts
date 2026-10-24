import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * Review queue for AI extraction (Phase 3B / item 2).
 * - ai_suggestions: what the model proposed for a contract, with its provenance (quote, page, confidence, whether the quote was found in
 *   the document). Nothing here is a business record: a person accepts (which creates the obligation / key term), edits and accepts, or rejects.
 *   `dedupe_key` keeps a second extraction of the same document from queueing what is already pending or accepted.
 * - contract_key_terms: key clauses a person accepted from a suggestion (one per contract and term), with the provenance retained.
 */
export const migration: Migration = {
  id: '0023_ai_suggestions',
  name: 'AI extraction review queue and accepted contract key terms',
  async up(sql: Sql) {
    await sql.exec(`
      CREATE TABLE IF NOT EXISTS ai_suggestions (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        contract_id text NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
        extraction_id text NOT NULL,
        kind text NOT NULL CHECK (kind IN ('obligation', 'key_term')),
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
        payload text NOT NULL,
        source_quote text NOT NULL DEFAULT '', source_page integer, confidence real, quote_verified boolean,
        dedupe_key text NOT NULL, source_name text, model text,
        created_by text, created_at text NOT NULL,
        decided_by text, decided_at text, result_ref text,
        version integer NOT NULL DEFAULT 1);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_suggestions_open ON ai_suggestions (contract_id, dedupe_key) WHERE status IN ('pending', 'accepted');
      CREATE INDEX IF NOT EXISTS idx_ai_suggestions_org_status ON ai_suggestions (organization_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_suggestions_contract ON ai_suggestions (contract_id, status);
      CREATE TABLE IF NOT EXISTS contract_key_terms (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        contract_id text NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
        term_key text NOT NULL, label text NOT NULL, value text NOT NULL, summary text NOT NULL DEFAULT '',
        source text NOT NULL DEFAULT 'ai_extracted' CHECK (source IN ('manual', 'ai_extracted')),
        source_quote text, source_page integer, source_confidence real, confirmed_by text, confirmed_at text,
        version integer NOT NULL DEFAULT 1, created_at text NOT NULL, updated_at text NOT NULL,
        UNIQUE (contract_id, term_key));
      CREATE INDEX IF NOT EXISTS idx_contract_key_terms_org ON contract_key_terms (organization_id, contract_id);
    `);
  },
};
