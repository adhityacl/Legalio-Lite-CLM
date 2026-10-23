import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Needs PostgreSQL at TEST_DATABASE_URL (see testDatabase.ts).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-activity-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { ensureSchema } = await import('./schema');
const { appendActivity, listActivity } = await import('./activityLog');
const { createCoreSaver } = await import('./coreDataStore');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => {
  database = await createTestDatabase();
  await ensureSchema();
  await sql.exec(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('org-a', 'A', 'a', now()), ('org-b', 'B', 'b', now())`);
});
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });

test('activity is appended per organization, uncapped, and paged newest first', async () => {
  for (let i = 0; i < 620; i++) await appendActivity(sql, { organizationId: 'org-a', userEmail: 'u@x.com', actionType: 'T', module: 'M', description: `event ${i}` });
  await appendActivity(sql, { organizationId: 'org-b', actionType: 'T', module: 'M', description: 'other tenant' });
  const all = await listActivity(sql, 'org-a', { limit: 1000 });
  assert.equal(all.total, 620);
  assert.equal(all.rows.length, 620);
  assert.ok(all.rows.every((row) => row.organizationId === 'org-a'));
  const page = await listActivity(sql, 'org-a', { limit: 50, offset: 600 });
  assert.equal(page.rows.length, 20);
  assert.equal(page.total, 620);
  assert.equal((await listActivity(sql, 'org-a')).rows.length, 500); // compatible default page
  assert.equal((await listActivity(sql, 'org-b')).rows[0].description, 'other tenant');
});

test('details are stored with the event', async () => {
  await appendActivity(sql, { organizationId: 'org-b', actionType: 'DOCUMENT_VIEW', module: 'DOCUMENTS', description: 'Viewed', details: { documentId: 'doc-1' } });
  const [latest] = (await listActivity(sql, 'org-b', { limit: 1 })).rows;
  assert.deepEqual(latest.details, { documentId: 'doc-1' });
});

test('the full-projection save neither writes nor prunes the activity log', async () => {
  const memory: Record<string, any> = { activityLogs: [], partners: [], contracts: [], ios: [], spendings: [], evaluations: [], notifications: [], templates: [], allowedUsers: [] };
  const saver = createCoreSaver(sql, () => memory);
  await saver.save();
  assert.equal((await listActivity(sql, 'org-a')).total, 620);
});

test('audit_log rejects UPDATE and DELETE unless a transaction explicitly lifts the guard', async () => {
  await sql.run(`INSERT INTO audit_log (id, actor_id, action, target_type, target_id, created_at) VALUES ('a1', 'u', 'x', 't', 'i', 'now')`);
  await assert.rejects(sql.run(`UPDATE audit_log SET action = 'y' WHERE id = 'a1'`), /append-only/);
  await assert.rejects(sql.run(`DELETE FROM audit_log WHERE id = 'a1'`), /append-only/);
  assert.equal((await sql.get(`SELECT action FROM audit_log WHERE id = 'a1'`)).action, 'x');
  await sql.tx(async () => {
    await sql.get(`SELECT set_config('legalio.allow_audit_mutation', 'on', true)`);
    assert.equal((await sql.run(`DELETE FROM audit_log WHERE id = 'a1'`)).changes, 1);
  });
  // The setting was transaction-local.
  await sql.run(`INSERT INTO audit_log (id, actor_id, action, target_type, target_id, created_at) VALUES ('a2', 'u', 'x', 't', 'i', 'now')`);
  await assert.rejects(sql.run(`DELETE FROM audit_log WHERE id = 'a2'`), /append-only/);
});
