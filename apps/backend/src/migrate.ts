/**
 * Versioned schema migrations. Each migration in ./migrations has a unique `NNNN_name` id and is applied once, in id order,
 * inside one transaction that also records it in `schema_migrations`. A PostgreSQL advisory lock serializes runners, so
 * several instances booting together apply each migration exactly once (the others wait, then find nothing left to do).
 * `schema_migrations` also holds one-time data-backfill markers written by the application (ids not shaped NNNN_name);
 * they are ignored here.
 */
import { pool, sql, type Sql } from './db';
import { componentLog } from './logger';
import { MIGRATIONS, type Migration } from './migrations';

const log = componentLog('migrate');

export const MIGRATION_LOCK_KEY = 0x4c474d47; // "LGMG"
const ID_PATTERN = /^\d{4}_[a-z0-9_]+$/;
const LOCK_POLL_MS = 250;

export function validateMigrations(list: Migration[]) {
  const seen = new Set<string>();
  let previous = '';
  for (const migration of list) {
    if (!ID_PATTERN.test(migration.id)) throw new Error(`Invalid migration id "${migration.id}" (expected NNNN_snake_case).`);
    if (seen.has(migration.id)) throw new Error(`Duplicate migration id ${migration.id}.`);
    if (migration.id <= previous) throw new Error(`Migration ${migration.id} is out of order (after ${previous}).`);
    seen.add(migration.id);
    previous = migration.id;
  }
}

async function ensureLedger(db: Sql) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, "appliedAt" text NOT NULL, summary text)');
}

/** Waits for the session lock on a dedicated connection (polling, so the pool's statement timeout never cuts the wait). */
async function withMigrationLock<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  const client = await pool().connect();
  try {
    const started = Date.now();
    for (;;) {
      const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [MIGRATION_LOCK_KEY]);
      if (rows[0]?.locked) break;
      if (Date.now() - started > timeoutMs) throw new Error(`Timed out after ${timeoutMs} ms waiting for another process to finish migrating.`);
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

export interface MigrationReport { applied: string[]; alreadyApplied: string[] }

/** Applies every pending migration in order. Safe to call from any number of processes at once. */
export async function runMigrations(options: { db?: Sql; migrations?: Migration[]; lockTimeoutMs?: number } = {}): Promise<MigrationReport> {
  const db = options.db ?? sql;
  const list = options.migrations ?? MIGRATIONS;
  validateMigrations(list);
  return withMigrationLock(async () => {
    await ensureLedger(db);
    const done = new Set((await db.all<{ id: string }>('SELECT id FROM schema_migrations')).map((row) => row.id));
    const report: MigrationReport = { applied: [], alreadyApplied: [] };
    const known = new Set(list.map((migration) => migration.id));
    for (const id of done) {
      if (ID_PATTERN.test(id) && !known.has(id)) log.warn(`Database has migration ${id} that this version does not know; it was applied by a newer release.`);
    }
    for (const migration of list) {
      if (done.has(migration.id)) { report.alreadyApplied.push(migration.id); continue; }
      const started = Date.now();
      await migration.before?.();
      await db.tx(async () => {
        await db.exec('SET LOCAL statement_timeout = 0');
        await migration.up(db);
        await db.run('INSERT INTO schema_migrations (id, "appliedAt", summary) VALUES (?, ?, ?)', migration.id, new Date().toISOString(), migration.name);
      });
      report.applied.push(migration.id);
      log.info({ migration: migration.id, ms: Date.now() - started }, `Applied migration ${migration.id}: ${migration.name}`);
    }
    return report;
  }, options.lockTimeoutMs ?? 300_000);
}

export interface MigrationStatusRow { id: string; name: string; applied: boolean; appliedAt: string | null }

/** Read-only: each known migration with whether and when it was applied, plus migrations the database has but this version lacks. */
export async function migrationStatus(options: { db?: Sql; migrations?: Migration[] } = {}): Promise<{ migrations: MigrationStatusRow[]; unknown: string[]; pending: number }> {
  const db = options.db ?? sql;
  const list = options.migrations ?? MIGRATIONS;
  const exists = await db.get(`SELECT to_regclass('public.schema_migrations') AS t`);
  const rows = exists?.t ? await db.all<{ id: string; appliedAt: string }>('SELECT id, "appliedAt" FROM schema_migrations') : [];
  const applied = new Map(rows.map((row) => [row.id, row.appliedAt]));
  const migrations = list.map((migration) => ({ id: migration.id, name: migration.name, applied: applied.has(migration.id), appliedAt: applied.get(migration.id) ?? null }));
  const known = new Set(list.map((migration) => migration.id));
  return { migrations, unknown: [...applied.keys()].filter((id) => ID_PATTERN.test(id) && !known.has(id)).sort(), pending: migrations.filter((row) => !row.applied).length };
}
