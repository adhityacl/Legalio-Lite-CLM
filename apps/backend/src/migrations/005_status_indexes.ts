import type Database from 'better-sqlite3';
import { normalizedCoreReady } from '../normalizedCoreStore';

const MIGRATION = '005_status_indexes';

/**
 * Dashboard and list views filter by organization + status (and sort by end/invoice date); the
 * existing indexes only narrowed by organization. Additive and idempotent: no table is rebuilt.
 */
export function addStatusIndexes(db: Database.Database) {
  if (!normalizedCoreReady(db)) throw new Error('Migration 003 must complete before adding status indexes.');
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(MIGRATION)) return { applied: false };
  db.transaction(() => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_v5_contracts_status ON contracts(organization_id, status, end_date);
      CREATE INDEX IF NOT EXISTS idx_v5_ios_status ON insertion_orders(organization_id, status, end_date);
      CREATE INDEX IF NOT EXISTS idx_v5_spendings_payment ON spendings(organization_id, payment_status, invoice_date);
    `);
    db.prepare('INSERT INTO schema_migrations (id, appliedAt, summary) VALUES (?, ?, ?)')
      .run(MIGRATION, new Date().toISOString(), JSON.stringify({ indexes: 3 }));
  })();
  db.exec('ANALYZE');
  return { applied: true };
}
