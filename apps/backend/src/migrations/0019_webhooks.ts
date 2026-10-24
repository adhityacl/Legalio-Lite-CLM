import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * Outbound webhooks. `webhook_endpoints` holds the organization's receivers (the signing secret sealed with secretBox, never returned
 * after creation); `webhook_deliveries` is both the outbox (pending/failed rows are retried with backoff, then dead-lettered) and the
 * delivery log shown to administrators. (endpoint, event) is unique so an event is queued at most once per endpoint.
 */
export const migration: Migration = {
  id: '0019_webhooks',
  name: 'Webhook endpoints and delivery outbox/log',
  async up(sql: Sql) {
    await sql.exec(`
      CREATE TABLE IF NOT EXISTS webhook_endpoints (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        url text NOT NULL, description text NOT NULL DEFAULT '',
        secret_sealed text NOT NULL,
        event_types text NOT NULL DEFAULT '[]',
        enabled boolean NOT NULL DEFAULT true, disabled_reason text,
        consecutive_failures integer NOT NULL DEFAULT 0,
        created_by text, created_at text NOT NULL, updated_at text NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_org ON webhook_endpoints (organization_id, created_at);
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        endpoint_id text NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
        event_id text NOT NULL, event_type text NOT NULL, payload text NOT NULL,
        status text NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'dead', 'skipped')),
        attempts integer NOT NULL DEFAULT 0, next_attempt_at text,
        last_status_code integer, last_error text, response_snippet text, duration_ms integer,
        created_at text NOT NULL, updated_at text NOT NULL, sent_at text,
        UNIQUE (endpoint_id, event_id));
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON webhook_deliveries (status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint ON webhook_deliveries (endpoint_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org ON webhook_deliveries (organization_id, created_at DESC);
    `);
  },
};
