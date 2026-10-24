import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * Per-organization API keys for /api/v1. Only the SHA-256 of the key is stored (the key is 256 bits of randomness, so a plain hash is
 * enough) plus a short display prefix; the key itself is shown once at creation. This replaces nothing: the platform console's older
 * `apikey` table is untouched and never authenticated anything.
 */
export const migration: Migration = {
  id: '0018_api_keys',
  name: 'Organization API keys (hashed) for the public API',
  async up(sql: Sql) {
    await sql.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        name text NOT NULL,
        key_prefix text NOT NULL,
        key_hash text NOT NULL UNIQUE,
        scopes text NOT NULL,
        rate_limit_per_minute integer NOT NULL DEFAULT 600 CHECK (rate_limit_per_minute > 0),
        created_by text, created_at text NOT NULL, expires_at text, revoked_at text, revoked_by text, last_used_at text);
      CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys (organization_id, created_at DESC);
    `);
  },
};
