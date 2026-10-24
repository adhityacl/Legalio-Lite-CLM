import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * Insertion orders become repository-backed (src/repositories/ioRepository.ts). Existing rows are adopted in place and start at
 * version 1; the version is the optimistic-concurrency token of every write.
 */
export const migration: Migration = {
  id: '0010_order_versions',
  name: 'Insertion orders: optimistic-concurrency version column and lookup indexes',
  async up(sql: Sql) {
    await sql.exec(`
      ALTER TABLE insertion_orders ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
      CREATE INDEX IF NOT EXISTS idx_v10_ios_number_ci ON insertion_orders (organization_id, lower(btrim(io_number)));
      CREATE INDEX IF NOT EXISTS idx_v10_ios_status ON insertion_orders (organization_id, status);
    `);
  },
};
