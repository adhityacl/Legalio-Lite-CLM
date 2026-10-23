import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * Workspace search and the contract text filter match `title || ' ' || body` of `search_records` with ILIKE. A pg_trgm GIN index
 * on exactly that expression makes those lookups index-assisted. The extension is created if the database user may; when it
 * cannot be (no privilege, extension not installed) the migration still succeeds and search keeps working through a plain scan.
 */
export const migration: Migration = {
  id: '0008_search_trigram',
  name: 'pg_trgm GIN index for workspace search (skipped when the extension is unavailable)',
  async up(sql: Sql) {
    await sql.exec(`
      DO $$
      BEGIN
        BEGIN
          CREATE EXTENSION IF NOT EXISTS pg_trgm;
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'pg_trgm is not available (%); search will use a sequential scan', SQLERRM;
        END;
        IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
          EXECUTE 'CREATE INDEX IF NOT EXISTS idx_v8_search_records_trgm ON search_records USING gin ((title || '' '' || body) gin_trgm_ops)';
        END IF;
      END
      $$;
    `);
  },
};
