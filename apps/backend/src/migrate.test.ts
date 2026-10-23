import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Needs PostgreSQL at TEST_DATABASE_URL (default postgres://legalio:legalio@127.0.0.1:5432/legalio).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-migrate-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { runMigrations, migrationStatus, validateMigrations } = await import('./migrate');
const { MIGRATIONS } = await import('./migrations');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); });
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });

const ids = MIGRATIONS.map((migration) => migration.id);
const tableExists = async (name: string) => Boolean((await sql.get(`SELECT to_regclass(?) AS t`, `public.${name}`))?.t);

test('the migration list is ordered, uniquely numbered and starts at the baseline', () => {
  validateMigrations(MIGRATIONS);
  assert.equal(ids[0], '0001_baseline');
  assert.throws(() => validateMigrations([MIGRATIONS[1], MIGRATIONS[0]]), /out of order/);
  assert.throws(() => validateMigrations([MIGRATIONS[0], MIGRATIONS[0]]), /Duplicate|out of order/);
  assert.throws(() => validateMigrations([{ ...MIGRATIONS[0], id: 'baseline' }]), /Invalid migration id/);
});

test('concurrent runners on an empty database apply each migration exactly once', async () => {
  assert.equal((await migrationStatus()).pending, ids.length);
  const reports = await Promise.all([runMigrations(), runMigrations(), runMigrations()]);
  const applied = reports.flatMap((report) => report.applied);
  assert.deepEqual([...applied].sort(), [...ids].sort());
  assert.equal(reports.filter((report) => report.applied.length === 0).length, 2);
  const recorded = (await sql.all<{ id: string }>(`SELECT id FROM schema_migrations WHERE id ~ '^[0-9]{4}_' ORDER BY id`)).map((row) => row.id);
  assert.deepEqual(recorded, ids);
  for (const table of ['member', 'contracts', 'contract_documents', 'reminder_ledger', 'upload_owners', 'ai_usage', 'audit_log']) assert.ok(await tableExists(table), table);
  const trigger = await sql.get(`SELECT 1 AS ok FROM pg_trigger WHERE tgname = 'audit_log_immutable'`);
  assert.ok(trigger);
});

test('running again is a no-op and status reports everything applied', async () => {
  const report = await runMigrations();
  assert.deepEqual(report.applied, []);
  assert.deepEqual(report.alreadyApplied, ids);
  const status = await migrationStatus();
  assert.equal(status.pending, 0);
  assert.deepEqual(status.unknown, []);
  assert.ok(status.migrations.every((row) => row.applied && row.appliedAt));
});

test('an already-initialized database (Phase 1 schema, no numbered records) adopts the migrations without changing its data', async () => {
  await sql.run(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('org-keep', 'Keep', 'keep', now())`);
  await sql.run(`INSERT INTO upload_owners (storage_key, organization_id, source, created_at) VALUES ('k1', 'org-keep', 'upload', 'now')`);
  await sql.run(`INSERT INTO schema_migrations (id, "appliedAt", summary) VALUES ('uploads-ownership-backfill-v1', 'then', 'marker')`);
  // What a database created by the old boot-time DDL looks like: every object present, no numbered migration recorded.
  await sql.run(`DELETE FROM schema_migrations WHERE id ~ '^[0-9]{4}_'`);
  assert.equal((await migrationStatus()).pending, ids.length);
  const report = await runMigrations();
  assert.deepEqual(report.applied, ids);
  assert.equal((await sql.get(`SELECT name FROM organization WHERE id = 'org-keep'`))?.name, 'Keep');
  assert.equal((await sql.get(`SELECT organization_id FROM upload_owners WHERE storage_key = 'k1'`))?.organization_id, 'org-keep');
  // Application data markers share the table and are untouched.
  assert.equal((await sql.get(`SELECT summary FROM schema_migrations WHERE id = 'uploads-ownership-backfill-v1'`))?.summary, 'marker');
  assert.equal((await migrationStatus()).pending, 0);
});

test('a failing migration rolls back completely and is retried next time', async () => {
  const broken = [...MIGRATIONS, {
    id: '9999_broken', name: 'broken',
    up: async (db: typeof sql) => { await db.exec('CREATE TABLE half_done (id text)'); throw new Error('boom'); },
  }];
  await assert.rejects(runMigrations({ migrations: broken }), /boom/);
  assert.equal(await tableExists('half_done'), false);
  assert.equal(await sql.get(`SELECT 1 FROM schema_migrations WHERE id = '9999_broken'`), undefined);
  // The lock was released: a normal run still works.
  assert.deepEqual((await runMigrations()).applied, []);
});

test('a migration unknown to this version is reported, not applied or removed', async () => {
  await sql.run(`INSERT INTO schema_migrations (id, "appliedAt", summary) VALUES ('0099_from_newer_release', 'x', 'future')`);
  assert.deepEqual((await migrationStatus()).unknown, ['0099_from_newer_release']);
  assert.deepEqual((await runMigrations()).applied, []);
});
