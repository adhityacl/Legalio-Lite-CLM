import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * Templates become repository-backed (src/repositories/templateRepository.ts). A template already carried a `version` that grew by one
 * with every save: it becomes the optimistic-concurrency token as it is. Rows written without one start at 1.
 */
export const migration: Migration = {
  id: '0014_template_versions',
  name: 'Templates: version is never empty (default 1)',
  async up(sql: Sql) {
    await sql.exec(`
      UPDATE templates SET version = 1 WHERE version IS NULL OR version < 1;
      ALTER TABLE templates ALTER COLUMN version SET DEFAULT 1;
      ALTER TABLE templates ALTER COLUMN version SET NOT NULL;
    `);
  },
};
