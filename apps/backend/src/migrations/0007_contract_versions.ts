import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * Contracts become repository-backed (src/repositories/contractRepository.ts): written row by row instead of through the
 * in-memory snapshot. Existing rows stay exactly where they are (same table, same columns); they simply start at version 1.
 * The version is incremented by every repository write and is the optimistic-concurrency token (HTTP 409 on a stale write).
 */
export const migration: Migration = {
  id: '0007_contract_versions',
  name: 'Contracts: optimistic-concurrency version column and lookup indexes',
  async up(sql: Sql) {
    await sql.exec(`
      ALTER TABLE contracts ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
      CREATE INDEX IF NOT EXISTS idx_v7_contracts_number_ci ON contracts (organization_id, lower(btrim(contract_number)));
      CREATE INDEX IF NOT EXISTS idx_v7_contracts_pic ON contracts (organization_id, internal_pic);
    `);
  },
};
