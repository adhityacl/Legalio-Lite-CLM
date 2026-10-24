import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * Spendings (vendor invoices) become repository-backed (src/repositories/spendingRepository.ts). Existing rows are adopted in place
 * and start at version 1; the version is the optimistic-concurrency token of every write.
 */
export const migration: Migration = {
  id: '0011_spending_versions',
  name: 'Spendings: optimistic-concurrency version column and list filter indexes',
  async up(sql: Sql) {
    await sql.exec(`
      ALTER TABLE spendings ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
      CREATE INDEX IF NOT EXISTS idx_v11_spendings_status ON spendings (organization_id, payment_status);
      CREATE INDEX IF NOT EXISTS idx_v11_spendings_invoice_ci ON spendings (organization_id, lower(btrim(invoice_number)));
    `);
  },
};
