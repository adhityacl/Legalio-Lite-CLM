import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * Finding who owns an uploaded file that has no ownership row yet (files from before the ownership table) matches the file name against
 * the link columns of the contract with `LIKE '%name%'`. A pg_trgm GIN index per column lets PostgreSQL answer that from the index
 * instead of reading every contract. Like the search index (0008), the migration succeeds without the extension; the lookup then
 * simply scans, as it did before.
 */
export const migration: Migration = {
  id: '0016_upload_owner_trigram',
  name: 'pg_trgm GIN indexes for upload-owner lookups on contracts (skipped when the extension is unavailable)',
  async up(sql: Sql) {
    await sql.exec(`
      DO $$
      BEGIN
        BEGIN
          CREATE EXTENSION IF NOT EXISTS pg_trgm;
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'pg_trgm is not available (%); upload-owner lookups will scan the contracts', SQLERRM;
        END;
        IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
          CREATE INDEX IF NOT EXISTS idx_v16_contracts_file_link_trgm ON contracts USING gin (contract_file_link gin_trgm_ops);
          CREATE INDEX IF NOT EXISTS idx_v16_contracts_termination_document_trgm ON contracts USING gin (termination_document gin_trgm_ops);
          CREATE INDEX IF NOT EXISTS idx_v16_contracts_extra_json_trgm ON contracts USING gin (extra_json gin_trgm_ops);
        END IF;
      END
      $$;
    `);
  },
};
