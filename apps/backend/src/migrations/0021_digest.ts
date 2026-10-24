import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * Scheduled digest e-mails: the organization's default (off unless an admin turns it on), each member's own choice (inherit/off/daily/
 * weekly) and the ledger that makes a digest go out at most once per user and period. `effective_from` keeps a new opt-in from firing
 * for a period whose send time has already passed.
 */
export const migration: Migration = {
  id: '0021_digest',
  name: 'Digest defaults, member preferences and send ledger',
  async up(sql: Sql) {
    await sql.exec(`
      CREATE TABLE IF NOT EXISTS digest_defaults (
        organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
        frequency text NOT NULL DEFAULT 'off' CHECK (frequency IN ('off', 'daily', 'weekly')),
        weekday integer NOT NULL DEFAULT 1 CHECK (weekday BETWEEN 1 AND 7),
        hour integer NOT NULL DEFAULT 8 CHECK (hour BETWEEN 0 AND 23),
        effective_from text NOT NULL, updated_by text, updated_at text NOT NULL);
      CREATE TABLE IF NOT EXISTS digest_preferences (
        organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        user_id text NOT NULL,
        frequency text NOT NULL CHECK (frequency IN ('inherit', 'off', 'daily', 'weekly')),
        effective_from text NOT NULL, updated_at text NOT NULL,
        PRIMARY KEY (organization_id, user_id));
      CREATE TABLE IF NOT EXISTS digest_ledger (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        user_id text NOT NULL, frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly')), period_key text NOT NULL,
        status text NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'dead', 'skipped')),
        attempts integer NOT NULL DEFAULT 0, last_error text, next_attempt_at text,
        created_at text NOT NULL, updated_at text NOT NULL, sent_at text,
        UNIQUE (organization_id, user_id, frequency, period_key));
      CREATE INDEX IF NOT EXISTS idx_digest_ledger_due ON digest_ledger (status, next_attempt_at);
    `);
  },
};
