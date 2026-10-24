import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * Clause library and playbook (Phase 3B / item 3).
 * - clauses: the organization's approved clauses. `approved_text` is the wording to use, `fallback_texts` (JSON list) the acceptable
 *   alternatives in order of preference, `rules` (JSON) what the playbook check looks for (required / forbidden phrases, numeric thresholds).
 *   `version` is the optimistic-concurrency counter. `starter_key` marks a clause imported from the starter set (baseline or industry pack);
 *   it is unique per organization, which is what makes the import non-destructive and repeatable.
 */
export const migration: Migration = {
  id: '0024_clause_library',
  name: 'Clause library with fallbacks, rules and starter keys',
  async up(sql: Sql) {
    await sql.exec(`
      CREATE TABLE IF NOT EXISTS clauses (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        title text NOT NULL,
        category text NOT NULL DEFAULT '',
        risk_level text NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low', 'medium', 'high')),
        approved_text text NOT NULL DEFAULT '',
        fallback_texts text NOT NULL DEFAULT '[]',
        guidance text NOT NULL DEFAULT '',
        language text NOT NULL DEFAULT '' CHECK (language IN ('', 'en', 'id', 'zh')),
        jurisdiction text NOT NULL DEFAULT '',
        tags text NOT NULL DEFAULT '[]',
        rules text NOT NULL DEFAULT '{}',
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        starter_key text,
        version integer NOT NULL DEFAULT 1,
        created_by text, created_at text NOT NULL, updated_at text NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_clauses_starter ON clauses (organization_id, starter_key) WHERE starter_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_clauses_org_category ON clauses (organization_id, category);
      CREATE INDEX IF NOT EXISTS idx_clauses_org_status ON clauses (organization_id, status, lower(title));
    `);
  },
};
