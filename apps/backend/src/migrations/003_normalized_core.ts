import { renameLegacyKeys } from '@legalio/shared/fieldNames';
import { indexConfiguration } from '../indexedConfiguration';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { ENTITIES, NORMALIZED_MIGRATION } from '../normalizedSchema';
import { createNormalizedCoreSchema, normalizedCoreReady, readBusinessRows, synchronizeBusinessRows } from '../normalizedCoreStore';

/** Atomic upgrade. Legacy snapshots stay intact for diagnosis; rollback uses the SQLite backup. */
export function migrateNormalizedCore(db: Database.Database, backupPath?: string) {
  if (normalizedCoreReady(db)) return { applied: false, counts: {} };
  db.pragma('foreign_keys = ON');
  const data: Record<string, any[]> = {};
  const counts: Record<string, number> = {};
  for (const entity of ENTITIES) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(entity.table);
    data[entity.collection] = exists ? (db.prepare(`SELECT id, organizationId, payload FROM "${entity.table}" ORDER BY rowid`).all() as any[]).map(record => {
      const row = renameLegacyKeys(JSON.parse(record.payload));
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Invalid record in ${entity.table}: ${record.id}`);
      // The domain key wins over the buggy legacy generic id (notably IO -> contract_id).
      row[entity.key] = row[entity.key] || record.id;
      row.organizationId = row.organizationId ?? record.organizationId;
      return row;
    }) : [];
    counts[entity.table] = data[entity.collection].length;
  }
  if (backupPath && db.name !== ':memory:') {
    fs.mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
    db.prepare('VACUUM INTO ?').run(backupPath);
    fs.chmodSync(backupPath,0o600);
  }
  db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, appliedAt TEXT NOT NULL, summary TEXT)');
    for (const entity of ENTITIES) {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(entity.table)) db.exec(`ALTER TABLE "${entity.table}" RENAME TO "_legacy_003_${entity.table}"`);
    }
    createNormalizedCoreSchema(db);
    indexConfiguration(db);
    synchronizeBusinessRows(db,data);
    for (const entity of ENTITIES) {
      const restored = readBusinessRows(db,entity.table);
      if (restored.length !== counts[entity.table]) throw new Error(`Migration row-count mismatch: ${entity.table}`);
      for (const [position, source] of data[entity.collection].entries()) {
        for (const [key, value] of Object.entries(source)) {
          if (key === 'pic_partner') continue; // Removed in the preceding contact migration.
          const stable = (item: any): string => JSON.stringify(item, (_key, current) => current && typeof current === 'object' && !Array.isArray(current) ? Object.fromEntries(Object.entries(current).sort(([a],[b]) => a.localeCompare(b))) : current);
          if (stable(value) !== stable(restored[position][key])) throw new Error(`Migration value mismatch: ${entity.table}.${key} (${source[entity.key]})`);
        }
      }
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign-key validation failed after normalization.');
    db.prepare('INSERT INTO schema_migrations (id, appliedAt, summary) VALUES (?, ?, ?)').run(NORMALIZED_MIGRATION,new Date().toISOString(),JSON.stringify({ counts, backupPath: backupPath || null }));
  })();
  return { applied: true, counts };
}
