import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * Evaluations become repository-backed (src/repositories/evaluationRepository.ts). Existing rows are adopted in place and start at
 * version 1; the version is the optimistic-concurrency token of every write.
 */
export const migration: Migration = {
  id: '0012_evaluation_versions',
  name: 'Evaluations: optimistic-concurrency version column',
  async up(sql: Sql) {
    await sql.exec(`ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;`);
  },
};
