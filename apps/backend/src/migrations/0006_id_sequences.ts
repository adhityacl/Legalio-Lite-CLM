import type { Sql } from '../db';
import type { Migration } from './types';

/**
 * Record ids keep their public shape (P0001, C0001, IO0001, SP0001, EVAL-2026-001) but come from PostgreSQL sequences
 * instead of "highest number in memory + 1". The sequences start at 1 here; `syncIdSequences` (ids.ts) moves each one past
 * the highest number already stored every time the server starts, so existing installations continue without gaps or clashes.
 */
export const migration: Migration = {
  id: '0006_id_sequences',
  name: 'Sequences for partner, contract, IO, spending and evaluation ids',
  async up(sql: Sql) {
    await sql.exec(`
      CREATE SEQUENCE IF NOT EXISTS legalio_partner_id_seq;
      CREATE SEQUENCE IF NOT EXISTS legalio_contract_id_seq;
      CREATE SEQUENCE IF NOT EXISTS legalio_io_id_seq;
      CREATE SEQUENCE IF NOT EXISTS legalio_spending_id_seq;
      CREATE SEQUENCE IF NOT EXISTS legalio_evaluation_id_seq;
    `);
  },
};
