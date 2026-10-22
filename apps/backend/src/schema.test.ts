import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Needs PostgreSQL at TEST_DATABASE_URL (default postgres://legalio:legalio@127.0.0.1:5432/legalio).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-schema-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { ensureSchema } = await import('./schema');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); });
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });

const columns = async (table: string) => Object.fromEntries((await sql.all<{ name: string; type: string }>(
  `SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?`, table)).map((c) => [c.name, c.type]));

test('ensureSchema creates the better-auth and module schema on an empty database and can run again', async () => {
  await ensureSchema();
  await ensureSchema();
  assert.equal((await columns('member')).status, 'text');
  assert.equal('issuer' in await columns('account'), false);
  assert.equal((await columns('user')).emailVerified, 'boolean');
  assert.equal((await columns('session')).expiresAt, 'timestamp with time zone');
  assert.equal((await columns('approval_events')).seq, 'bigint');
  assert.equal((await columns('approval_requests')).file_data, 'bytea');
  assert.equal((await columns('contracts')).contract_value_minor, 'bigint');
  assert.equal('risk_score' in await columns('contracts'), false);
  assert.equal((await columns('evaluations')).sla_score, 'double precision');
  assert.equal('rowid' in await columns('search_records'), false);
  assert.equal((await columns('contract_documents')).page_layout, 'text');
  const indexes = (await sql.all<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`)).map((row) => row.indexname);
  for (const name of ['uq_member_org_user', 'uq_team_member', 'idx_v5_contracts_status', 'idx_v3_partners_name']) assert.ok(indexes.includes(name), name);
});
