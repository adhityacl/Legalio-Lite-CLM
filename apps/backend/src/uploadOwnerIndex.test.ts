/** Upload-owner lookups on contracts: a trigram index answers the file-name filter, results are unchanged, and the migration is harmless without pg_trgm. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-upload-index-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false', LOG_LEVEL: 'silent' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { runMigrations } = await import('./migrate');
const { MIGRATIONS } = await import('./migrations');
const { migration } = await import('./migrations/0016_upload_owner_trigram');
const { contractRepository } = await import('./repositories/contractRepository');
const { uploadOwners } = await import('./uploadStorage');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const INDEXES = ['idx_v16_contracts_file_link_trgm', 'idx_v16_contracts_termination_document_trgm', 'idx_v16_contracts_extra_json_trgm'];
const indexCount = async () => Number((await sql.get(`SELECT COUNT(*) AS n FROM pg_indexes WHERE indexname = ANY(?)`, INDEXES))?.n);

// Migrated up to 0007 only: pg_trgm is not installed yet (0008 creates it), as on a server where it can never be created.
before(async () => {
  database = await createTestDatabase();
  await runMigrations({ migrations: MIGRATIONS.filter((m) => m.id < '0008') });
  await sql.exec(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('org-a', 'A', 'a', now())`);
  await sql.exec(`INSERT INTO partners (partner_id, organization_id, record_position) VALUES ('p1', 'org-a', 0)`);
  for (let i = 0; i < 400; i += 1) {
    await contractRepository.insert({
      contract_id: `C${i}`, organizationId: 'org-a', partner_id: 'p1', contract_number: `CTR-${i}`, contract_title: `Title ${i}`, start_date: '2026-01-01', end_date: '2030-01-01',
      currency: 'USD', contract_value: 1, status: 'Active', status_approval: 'Signed',
      contract_file_link: `/uploads/org-a/key${i}/Folder Contract/file-${i}.pdf`,
      ...(i === 7 ? { termination_document: '/uploads/org-a/keyT/Folder Contract/termination-7.pdf' } : {}),
      ...(i === 9 ? { attachments_note: { link: '/uploads/org-a/keyX/Folder Contract/extra-9.pdf' } } : {}),
    });
  }
});
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });

test('without pg_trgm the migration succeeds and lookups still work through a scan', async () => {
  const unavailable = { ...sql, exec: (text: string) => sql.exec(text.replace('CREATE EXTENSION IF NOT EXISTS pg_trgm', 'CREATE EXTENSION IF NOT EXISTS pg_trgm_missing_for_test')) };
  await migration.up(unavailable as typeof sql);
  assert.equal(await indexCount(), 0);
  const owners = await uploadOwners('/uploads/org-a/key3/Folder Contract/file-3.pdf');
  assert.deepEqual(owners.map((o) => o.record.contract_id), ['C3']);
});

test('the migration adds a trigram index per link column and lookups find the same owners', async () => {
  await runMigrations();
  assert.equal(await indexCount(), 3);
  assert.deepEqual((await uploadOwners('/uploads/org-a/key3/Folder Contract/file-3.pdf')).map((o) => o.record.contract_id), ['C3']);
  assert.deepEqual((await uploadOwners('/uploads/org-a/keyT/Folder Contract/termination-7.pdf')).map((o) => o.record.contract_id), ['C7']);
  assert.deepEqual((await uploadOwners('/uploads/org-a/keyX/Folder Contract/extra-9.pdf')).map((o) => o.record.contract_id), ['C9'], 'links kept in the JSON remainder are found too');
  assert.deepEqual(await uploadOwners('/uploads/org-a/none/Folder Contract/missing.pdf'), []);
});

test('the file-name filter of the lookup is served by the indexes', async () => {
  const variants = ['%file-3.pdf%'];
  const plan = await sql.tx(async () => {
    await sql.exec('SET LOCAL enable_seqscan = off');
    return (await sql.all(
      `EXPLAIN SELECT * FROM contracts WHERE contract_file_link LIKE ANY(?) OR termination_document LIKE ANY(?) OR extra_json LIKE ANY(?)`, variants, variants, variants))
      .map((row) => row['QUERY PLAN']).join('\n');
  });
  for (const name of INDEXES) assert.match(plan, new RegExp(name), `${name} in the plan:\n${plan}`);
});
