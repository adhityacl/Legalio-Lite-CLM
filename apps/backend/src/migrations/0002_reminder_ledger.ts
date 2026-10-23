import type { Sql } from '../db';
import type { Migration } from './types';

export const migration: Migration = {
  id: '0002_reminder_ledger',
  name: 'Reminder outbox ledger',
  async up(sql: Sql) {
    await sql.exec(`    -- Reminder outbox: one row per (record, renewal cycle, trigger); status/attempts/last_error track delivery and retry.
    CREATE TABLE IF NOT EXISTS reminder_ledger (
      id text PRIMARY KEY, organization_id text NOT NULL, kind text NOT NULL, record_id text NOT NULL, cycle_end_date text NOT NULL,
      trigger text NOT NULL CHECK (trigger IN ('offset', 'notice')), offset_days integer NOT NULL,
      status text NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'dead', 'skipped')),
      attempts integer NOT NULL DEFAULT 0, last_error text, next_attempt_at text, recipients text, notification_id text,
      created_at text NOT NULL, updated_at text NOT NULL, sent_at text,
      UNIQUE (kind, record_id, cycle_end_date, trigger, offset_days));
    CREATE INDEX IF NOT EXISTS idx_reminder_ledger_due ON reminder_ledger (status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_reminder_ledger_org ON reminder_ledger (organization_id, created_at);
`);
  },
};
