import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-ids-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false', LOG_LEVEL: 'silent' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { ensureSchema } = await import('./schema');
const { nextEntityId, syncIdSequences } = await import('./ids');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => {
  database = await createTestDatabase();
  await ensureSchema();
  await sql.run(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('o', 'O', 'o', now())`);
});
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });

test('a fresh database hands out the first number of each kind in the familiar shape', async () => {
  assert.equal(await nextEntityId('partner'), 'P0001');
  assert.equal(await nextEntityId('contract'), 'C0001');
  assert.equal(await nextEntityId('io'), 'IO0001');
  assert.equal(await nextEntityId('spending'), 'SP0001');
  assert.equal(await nextEntityId('evaluation', '2026'), 'EVAL-2026-001');
});

test('syncIdSequences moves past stored ids (including ids that were never drawn from the sequence) and never backwards', async () => {
  await sql.run(`INSERT INTO partners (partner_id, organization_id, record_position) VALUES ('P0007', 'o', 1), ('legacy-20', 'o', 2), ('X1234567', 'o', 3)`);
  await sql.run(`INSERT INTO evaluations (id, organization_id, record_position) VALUES ('EVAL-2026-004', 'o', 1)`);
  await syncIdSequences();
  assert.equal(await nextEntityId('partner'), 'P0021'); // 20 from "legacy-20"; the 7-digit number is ignored as before
  assert.equal(await nextEntityId('evaluation', '2026'), 'EVAL-2026-005');
  await syncIdSequences();
  assert.equal(await nextEntityId('partner'), 'P0022');
});

test('an id that already exists (explicit insert, restore) is skipped; contracts are checked in their table', async () => {
  await sql.run(`INSERT INTO contracts (contract_id, organization_id, record_position) VALUES ('C0002', 'o', 1), ('C0003', 'o', 2)`);
  assert.equal(await nextEntityId('contract'), 'C0004');
});

test('concurrent requests never draw the same id', async () => {
  const ids = await Promise.all(Array.from({ length: 40 }, () => nextEntityId('io')));
  assert.equal(new Set(ids).size, 40);
});

test('numbers of deleted records are not reused', async () => {
  const first = await nextEntityId('spending');
  await sql.run(`INSERT INTO spendings (id, organization_id, record_position) VALUES (?, 'o', 1)`, first);
  await sql.run('DELETE FROM spendings WHERE id = ?', first); // deleted
  assert.notEqual(await nextEntityId('spending'), first);
});
