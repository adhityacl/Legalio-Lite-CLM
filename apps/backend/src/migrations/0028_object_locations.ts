import type { Sql } from '../db';
import type { Migration } from './types';

export const migration: Migration = {
  id: '0028_object_locations',
  name: 'Storage provider of each stored object',
  async up(sql: Sql) {
    await sql.exec(`    -- Which storage provider holds an object (key without the /uploads/ prefix). A missing row means an object written when
    -- Tencent COS was the only provider.
    CREATE TABLE IF NOT EXISTS object_locations (
      storage_key text PRIMARY KEY, provider text NOT NULL, created_at text NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_object_locations_provider ON object_locations (provider);
`);
  },
};
