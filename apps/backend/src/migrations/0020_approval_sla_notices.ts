import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * Approval e-mails and SLA escalation.
 * - approval_settings: the organization's SLA (hours, default 48 = the former fixed value) and who hears about a breach.
 * - approval_notices: the ledger/outbox, one row per (request, step, kind, recipient); the unique key makes every e-mail idempotent.
 * - user_notifications: personal in-app entries (shown in My Approval), written together with the ledger row.
 */
export const migration: Migration = {
  id: '0020_approval_sla_notices',
  name: 'Approval SLA settings, e-mail notice ledger and personal in-app notifications',
  async up(sql: Sql) {
    await sql.exec(`
      CREATE TABLE IF NOT EXISTS approval_settings (
        organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
        sla_hours integer NOT NULL DEFAULT 48 CHECK (sla_hours BETWEEN 1 AND 720),
        escalation text NOT NULL DEFAULT 'admins' CHECK (escalation IN ('admins', 'next_approver')),
        updated_by text, updated_at text NOT NULL);
      CREATE TABLE IF NOT EXISTS approval_notices (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        request_id text NOT NULL, step_no integer NOT NULL,
        kind text NOT NULL CHECK (kind IN ('requested', 'decided', 'sla_reminder', 'sla_breach')),
        recipient_id text NOT NULL, payload text NOT NULL DEFAULT '{}',
        status text NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'dead', 'skipped')),
        attempts integer NOT NULL DEFAULT 0, last_error text, next_attempt_at text,
        created_at text NOT NULL, updated_at text NOT NULL, sent_at text,
        UNIQUE (request_id, step_no, kind, recipient_id));
      CREATE INDEX IF NOT EXISTS idx_approval_notices_due ON approval_notices (status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_approval_notices_org ON approval_notices (organization_id, created_at);
      CREATE TABLE IF NOT EXISTS user_notifications (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        user_id text NOT NULL, kind text NOT NULL, params text NOT NULL DEFAULT '{}', link text,
        is_read boolean NOT NULL DEFAULT false, created_at text NOT NULL, read_at text);
      CREATE INDEX IF NOT EXISTS idx_user_notifications_user ON user_notifications (organization_id, user_id, created_at DESC);
    `);
  },
};
