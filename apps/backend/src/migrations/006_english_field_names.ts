import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { LEGACY_FIELD_NAMES, renameLegacyKeys } from '@legalio/shared/fieldNames';
import { normalizedCoreReady } from '../normalizedCoreStore';

const MIGRATION = '006_english_field_names';
const TABLES = [
  'partners', 'contracts', 'insertion_orders', 'spendings', 'evaluations', 'notifications', 'activity_logs', 'templates',
  'partner_dd_requirements', 'partner_dd_files',
];
const MONEY_SUFFIX = /(_minor|_scale)$/;

const columnsOf = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map(column => column.name);

/** Target name for a stored column, keeping the `_minor`/`_scale` suffix of money columns. */
function renamedColumn(column: string): string | undefined {
  const suffix = MONEY_SUFFIX.exec(column)?.[0] ?? '';
  const target = LEGACY_FIELD_NAMES[suffix ? column.slice(0, -suffix.length) : column];
  return target ? target + suffix : undefined;
}

/**
 * Renames the Indonesian business columns to English (see LEGACY_FIELD_NAMES) and rewrites the same keys inside
 * `extra_json`. Indexes, views and generated columns follow automatically. A backup is written first; restore it to undo.
 */
export function renameFieldsToEnglish(db: Database.Database, backupPath?: string) {
  if (!normalizedCoreReady(db)) throw new Error('Migration 003 must complete before renaming fields.');
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(MIGRATION)) return { applied: false, renamed: 0 };

  const tables = TABLES.filter(table => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
  if (db.name !== ':memory:') {
    if (!backupPath) throw new Error('A SQLite backup path is required before renaming fields.');
    fs.mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
    db.prepare('VACUUM INTO ?').run(backupPath);
    fs.chmodSync(backupPath, 0o600);
  }

  let renamed = 0;
  db.pragma('foreign_keys = ON');
  db.transaction(() => {
    for (const table of tables) {
      for (const column of columnsOf(db, table)) {
        const target = renamedColumn(column);
        if (!target) continue;
        if (columnsOf(db, table).includes(target)) throw new Error(`Cannot rename ${table}.${column}: ${target} already exists.`);
        db.exec(`ALTER TABLE "${table}" RENAME COLUMN "${column}" TO "${target}"`);
        renamed++;
      }
      if (!columnsOf(db, table).includes('extra_json')) continue;
      const known = new Set(columnsOf(db, table));
      const update = db.prepare(`UPDATE "${table}" SET extra_json = ? WHERE rowid = ?`);
      for (const row of db.prepare(`SELECT rowid, extra_json FROM "${table}" WHERE extra_json != '{}'`).all() as { rowid: number; extra_json: string }[]) {
        const extra = JSON.parse(row.extra_json) as Record<string, unknown>;
        const next: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(extra)) {
          const target = LEGACY_FIELD_NAMES[key] ?? key;
          // A stored column is authoritative: an alias that now collides with it is dropped.
          if (target !== key && known.has(target)) continue;
          next[target] = renameLegacyKeys(value);
        }
        const json = JSON.stringify(next);
        if (json !== row.extra_json) update.run(json, row.rowid);
      }
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign-key validation failed after renaming fields.');
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('SQLite integrity validation failed after renaming fields.');
    db.prepare('INSERT INTO schema_migrations (id, appliedAt, summary) VALUES (?, ?, ?)')
      .run(MIGRATION, new Date().toISOString(), JSON.stringify({ renamedColumns: renamed, backupPath: backupPath || null }));
  })();
  return { applied: true, renamed };
}
