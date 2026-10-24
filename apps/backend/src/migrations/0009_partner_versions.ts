import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * Partners become repository-backed (src/repositories/partnerRepository.ts). Existing rows are adopted in place (same table, same
 * columns, same child tables) and start at version 1; the version is the optimistic-concurrency token of every write.
 */
export const migration: Migration = {
  id: '0009_partner_versions',
  name: 'Partners: optimistic-concurrency version column and list filter indexes',
  async up(sql: Sql) {
    await sql.exec(`
      ALTER TABLE partners ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
      CREATE INDEX IF NOT EXISTS idx_v9_partners_status ON partners (organization_id, status_dd);
      CREATE INDEX IF NOT EXISTS idx_v9_partners_type ON partners (organization_id, partner_type);
    `);
  },
};
