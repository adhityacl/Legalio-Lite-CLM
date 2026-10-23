import type { Sql } from '../db';
import type { Migration } from './types';

export const migration: Migration = {
  id: '0003_upload_owners',
  name: 'Upload ownership table',
  async up(sql: Sql) {
    await sql.exec(`    -- Server-written ownership of stored upload objects (key without the /uploads/ prefix).
    CREATE TABLE IF NOT EXISTS upload_owners (
      storage_key text PRIMARY KEY, organization_id text NOT NULL, source text NOT NULL DEFAULT 'upload', created_at text NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_upload_owners_org ON upload_owners (organization_id);
`);
  },
};
