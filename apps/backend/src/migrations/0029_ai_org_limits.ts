import type { Sql } from '../db';
import type { Migration } from './types';

export const migration: Migration = {
  id: '0029_ai_org_limits',
  name: 'Per-organization monthly AI token limit',
  async up(sql: Sql) {
    await sql.exec(`    -- Monthly AI token limit chosen for one organization by a platform administrator; 0 means unlimited. No row: the platform default.
    CREATE TABLE IF NOT EXISTS ai_org_limits (
      organization_id text PRIMARY KEY, monthly_tokens bigint NOT NULL, updated_at text NOT NULL, updated_by text);
`);
  },
};
