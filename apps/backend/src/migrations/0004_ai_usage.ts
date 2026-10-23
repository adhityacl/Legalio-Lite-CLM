import type { Sql } from '../db';
import type { Migration } from './types';

export const migration: Migration = {
  id: '0004_ai_usage',
  name: 'Per-organization AI usage counters',
  async up(sql: Sql) {
    await sql.exec(`    -- Per-organization AI usage per UTC day (calls and tokens) for the daily budget.
    CREATE TABLE IF NOT EXISTS ai_usage (
      organization_id text NOT NULL, day text NOT NULL, calls integer NOT NULL DEFAULT 0, tokens bigint NOT NULL DEFAULT 0,
      PRIMARY KEY (organization_id, day));
`);
  },
};
