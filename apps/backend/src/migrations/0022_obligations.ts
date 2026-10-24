import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * Obligations and key dates (Phase 3B / item 1).
 * - obligations: tenant-scoped, optimistic-concurrency (`version`), linked to a contract, an order and/or a partner. A link is a real
 *   foreign key with ON DELETE CASCADE: an obligation lives and dies with the record it belongs to. `due_date` is the next occurrence;
 *   `last_due_soon_cycle` / `last_overdue_cycle` remember for which due date the scheduler has already raised the event (derived state,
 *   written without a new version).
 * - obligation_settings: the organization's default reminder lead time.
 * - obligation_notices: the e-mail ledger/outbox, unique per (obligation, cycle due date, kind, recipient) so nothing is sent twice.
 */
export const migration: Migration = {
  id: '0022_obligations',
  name: 'Obligations and key dates, reminder lead time and notice ledger',
  async up(sql: Sql) {
    await sql.exec(`
      CREATE TABLE IF NOT EXISTS obligations (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        contract_id text REFERENCES contracts(contract_id) ON DELETE CASCADE,
        io_id text REFERENCES insertion_orders(io_id) ON DELETE CASCADE,
        partner_id text REFERENCES partners(partner_id) ON DELETE CASCADE,
        title text NOT NULL,
        description text NOT NULL DEFAULT '',
        type text NOT NULL DEFAULT 'other' CHECK (type IN ('payment', 'delivery', 'renewal_notice', 'reporting', 'compliance', 'other')),
        due_date text,
        recurrence text NOT NULL DEFAULT 'once' CHECK (recurrence IN ('once', 'monthly', 'quarterly', 'yearly', 'every_n_days')),
        recurrence_interval integer CHECK (recurrence_interval IS NULL OR recurrence_interval BETWEEN 1 AND 3650),
        recurrence_until text,
        responsible_user_id text,
        responsible_department text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'waived')),
        lead_days integer CHECK (lead_days IS NULL OR lead_days BETWEEN 0 AND 365),
        source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai_extracted')),
        source_quote text, source_page integer, source_confidence real, confirmed_by text, confirmed_at text,
        completed_at text, completed_by text, completions integer NOT NULL DEFAULT 0,
        last_due_soon_cycle text, last_overdue_cycle text,
        version integer NOT NULL DEFAULT 1,
        created_by text, created_at text NOT NULL, updated_at text NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_obligations_org_due ON obligations (organization_id, due_date);
      CREATE INDEX IF NOT EXISTS idx_obligations_org_status ON obligations (organization_id, status);
      CREATE INDEX IF NOT EXISTS idx_obligations_contract ON obligations (contract_id) WHERE contract_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_obligations_io ON obligations (io_id) WHERE io_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_obligations_partner ON obligations (partner_id) WHERE partner_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_obligations_responsible ON obligations (organization_id, responsible_user_id) WHERE responsible_user_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_obligations_open_due ON obligations (due_date) WHERE status IN ('open', 'in_progress') AND due_date IS NOT NULL;
      CREATE TABLE IF NOT EXISTS obligation_settings (
        organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
        lead_days integer NOT NULL DEFAULT 7 CHECK (lead_days BETWEEN 0 AND 365),
        updated_by text, updated_at text NOT NULL);
      CREATE TABLE IF NOT EXISTS obligation_notices (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        obligation_id text NOT NULL REFERENCES obligations(id) ON DELETE CASCADE,
        cycle_due_date text NOT NULL,
        kind text NOT NULL CHECK (kind IN ('due_soon', 'overdue')),
        recipient_id text NOT NULL, payload text NOT NULL DEFAULT '{}',
        status text NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'dead', 'skipped')),
        attempts integer NOT NULL DEFAULT 0, last_error text, next_attempt_at text,
        created_at text NOT NULL, updated_at text NOT NULL, sent_at text,
        UNIQUE (obligation_id, cycle_due_date, kind, recipient_id));
      CREATE INDEX IF NOT EXISTS idx_obligation_notices_due ON obligation_notices (status, next_attempt_at);
    `);
  },
};
