import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { ENTITIES } from '../normalizedSchema';
import { normalizedCoreReady } from '../normalizedCoreStore';

const MIGRATION = '004_remove_legacy_core';

/** Contract migration 003's snapshots; restore the SQLite backup to undo. */
export function removeLegacyCoreTables(db: Database.Database, backupPath?: string) {
  if (!normalizedCoreReady(db)) throw new Error('Migration 003 must complete before removing legacy tables.');
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(MIGRATION)) return { applied: false, tables: [] };

  const tables = ENTITIES.map(entity => `_legacy_003_${entity.table}`)
    .filter(table => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
  if (tables.length && db.name !== ':memory:') {
    if (!backupPath) throw new Error('A SQLite backup path is required before removing legacy tables.');
    fs.mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
    db.prepare('VACUUM INTO ?').run(backupPath);
    fs.chmodSync(backupPath, 0o600);
  }

  db.pragma('foreign_keys = ON');
  db.transaction(() => {
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign-key validation failed before removing legacy tables.');
    for (const table of [...tables].reverse()) db.exec(`DROP TABLE "${table}"`);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign-key validation failed after removing legacy tables.');
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('SQLite integrity validation failed after removing legacy tables.');
    db.prepare('INSERT INTO schema_migrations (id, appliedAt, summary) VALUES (?, ?, ?)')
      .run(MIGRATION, new Date().toISOString(), JSON.stringify({ tables, backupPath: tables.length ? backupPath || null : null }));
  })();
  return { applied: true, tables };
}
