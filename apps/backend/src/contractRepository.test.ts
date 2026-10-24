/** Contract repository on real PostgreSQL: row-level writes, optimistic concurrency, and independence from the snapshot sync. */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-contract-repo-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false', LOG_LEVEL: 'silent' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { runMigrations } = await import('./migrate');
const { MIGRATIONS } = await import('./migrations');
const { contractRepository } = await import('./repositories/contractRepository');
const { DuplicateValueError, VersionConflictError } = await import('./repositories/errors');
const { synchronizeBusinessRows, resetSyncCache } = await import('./normalizedCoreStore');
const { entityFor } = await import('./normalizedSchema');
const { ensureSchema } = await import('./schema');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });

const contract = (id: string, org = 'org-a', extra: Record<string, unknown> = {}) => ({
  contract_id: id, organizationId: org, partner_id: org === 'org-a' ? 'p1' : 'p2', contract_number: `CTR-${id}`, contract_title: `Title ${id}`,
  start_date: '2026-01-01', end_date: '2030-01-01', currency: 'USD', contract_value: 100.5, cooperation_categories: ['Services', 'IT'],
  status: 'Active', status_approval: 'Signed', days_remaining: 1200, ...extra,
});

beforeEach(async () => {
  await sql.exec(`TRUNCATE organization, search_records CASCADE`);
  await sql.exec(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('org-a', 'A', 'a', now()), ('org-b', 'B', 'b', now())`);
  await sql.exec(`INSERT INTO partners (partner_id, organization_id, record_position) VALUES ('p1', 'org-a', 0), ('p2', 'org-b', 0)`);
});

test('insert, get, list: newest first, version 1, children and extra fields round-trip, organizations are isolated', async () => {
  const first = await contractRepository.insert(contract('C1'));
  await contractRepository.insert(contract('C2', 'org-a', { custom_field: { keep: true } }));
  await contractRepository.insert(contract('C3', 'org-b'));
  assert.equal(first.version, 1);
  assert.deepEqual(first.cooperation_categories, ['Services', 'IT']);
  assert.equal(first.contract_value, 100.5);
  const listed = await contractRepository.list('org-a');
  assert.deepEqual(listed.rows.map((r) => r.contract_id), ['C2', 'C1'], 'newest first, like the old unshift');
  assert.equal(listed.total, 2);
  assert.deepEqual(listed.rows[0].custom_field, { keep: true });
  assert.equal(await contractRepository.get('org-a', 'C3'), undefined, 'another organization cannot read it by id');
  assert.equal((await contractRepository.get('org-b', 'C3'))?.contract_id, 'C3');
  assert.equal(await contractRepository.remove('org-a', 'C3'), false, 'and cannot delete it');
});

test('list filters, text search, sorting and paging report the total before paging', async () => {
  for (let i = 1; i <= 7; i++) {
    await contractRepository.insert(contract(`C${i}`, 'org-a', { status: i % 2 ? 'Active' : 'Expired', end_date: `2030-01-0${i}`, contract_title: i === 3 ? 'Special Orchard Agreement' : `Title ${i}` }));
  }
  const page = await contractRepository.list('org-a', { limit: 3, offset: 3, sort: 'end_date', dir: 'asc' });
  assert.deepEqual(page.rows.map((r) => r.contract_id), ['C4', 'C5', 'C6']);
  assert.equal(page.total, 7);
  assert.deepEqual((await contractRepository.list('org-a', { status: ['Expired'] })).rows.map((r) => r.contract_id).sort(), ['C2', 'C4', 'C6']);
  assert.deepEqual((await contractRepository.list('org-a', { q: 'orchard special' })).rows.map((r) => r.contract_id), ['C3']);
  assert.deepEqual((await contractRepository.list('org-a', { q: 'ctr-c5' })).rows.map((r) => r.contract_id), ['C5']);
  assert.deepEqual((await contractRepository.list('org-b', { q: 'orchard' })).rows, [], 'search never crosses organizations');
  assert.equal((await contractRepository.list('org-a', { q: '%_\\' })).total, 0, 'LIKE wildcards are literals');
  assert.deepEqual((await contractRepository.list('org-a', { endFrom: '2030-01-06' })).rows.map((r) => r.contract_id).sort(), ['C6', 'C7']);
});

test('update increments the version; a stale version is rejected with a 409 conflict and changes nothing', async () => {
  const created = await contractRepository.insert(contract('C1'));
  const updated = await contractRepository.update({ ...created, contract_title: 'Edited', cooperation_categories: ['Only'] }, 1);
  assert.equal(updated.version, 2);
  assert.equal(updated.contract_title, 'Edited');
  assert.deepEqual(updated.cooperation_categories, ['Only']);
  await assert.rejects(() => contractRepository.update({ ...created, contract_title: 'Stale write' }, 1), (error: any) => {
    assert.ok(error instanceof VersionConflictError);
    assert.equal(error.status, 409);
    assert.equal(error.apiCode, 'VERSION_CONFLICT');
    return true;
  });
  assert.equal((await contractRepository.get('org-a', 'C1'))?.contract_title, 'Edited');
  assert.equal((await contractRepository.get('org-a', 'C1'))?.version, 2);
});

test('two concurrent updates of the same contract: exactly one wins, the other is detected (no lost update)', async () => {
  const created = await contractRepository.insert(contract('C1'));
  const outcomes = await Promise.allSettled([
    contractRepository.update({ ...created, contract_title: 'Writer one', internal_notes: 'one' }, created.version),
    contractRepository.update({ ...created, contract_title: 'Writer two', internal_notes: 'two' }, created.version),
  ]);
  const won = outcomes.filter((o) => o.status === 'fulfilled');
  const lost = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
  assert.equal(won.length, 1);
  assert.equal(lost.length, 1);
  assert.ok(lost[0].reason instanceof VersionConflictError);
  const stored = (await contractRepository.get('org-a', 'C1'))!;
  assert.equal(stored.version, 2);
  assert.equal(stored.contract_title, (won[0] as PromiseFulfilledResult<any>).value.contract_title, 'the stored content is the winner\'s, never a mix');
});

test('concurrent updates of different contracts proceed independently', async () => {
  const rows = await Promise.all(Array.from({ length: 8 }, (_, i) => contractRepository.insert(contract(`C${i}`))));
  const results = await Promise.all(rows.map((row) => contractRepository.update({ ...row, contract_title: `Edited ${row.contract_id}` }, row.version)));
  assert.ok(results.every((row) => row.version === 2));
  assert.deepEqual((await contractRepository.list('org-a')).rows.map((r) => r.contract_title).sort(), rows.map((r) => `Edited ${r.contract_id}`).sort());
});

test('mutate edits the row as it is now, so a derived-field write never fails on or overwrites a concurrent edit', async () => {
  const created = await contractRepository.insert(contract('C1'));
  await contractRepository.update({ ...created, contract_title: 'User edit' }, 1);
  const derived = await contractRepository.mutate('org-a', 'C1', (row) => { row.days_remaining = 5; row.status = 'Expiring'; }, { bumpVersion: false });
  assert.equal(derived?.contract_title, 'User edit');
  assert.equal(derived?.version, 2, 'a display refresh keeps the version');
  assert.equal(derived?.status, 'Expiring');
  assert.equal(await contractRepository.mutate('org-a', 'missing', () => undefined), undefined);
});

test('contract numbers are unique per organization even under a concurrent race', async () => {
  const attempts = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => contractRepository.insert(contract(`R${i}`, 'org-a', { contract_number: ' Race-1 ' }))));
  assert.equal(attempts.filter((a) => a.status === 'fulfilled').length, 1);
  assert.ok(attempts.filter((a): a is PromiseRejectedResult => a.status === 'rejected').every((a) => a.reason instanceof DuplicateValueError));
  assert.equal((await contractRepository.findByNumber('org-a', 'race-1'))?.contract_number, ' Race-1 ');
  await contractRepository.insert(contract('Other', 'org-b', { contract_number: 'Race-1' })); // other organization: allowed
});

test('delete removes the row, its categories and search entry; children lose their parent link', async () => {
  await contractRepository.insert(contract('C1'));
  await contractRepository.insert(contract('C2', 'org-a', { parent_contract_id: 'C1' }));
  assert.equal(await contractRepository.removeWithChildren('org-a', 'C1'), true);
  assert.equal(await contractRepository.get('org-a', 'C1'), undefined);
  assert.equal((await sql.get(`SELECT COUNT(*) AS n FROM contract_categories WHERE contract_id = 'C1'`)).n, 0);
  assert.equal((await sql.get(`SELECT COUNT(*) AS n FROM search_records WHERE entity_id = 'C1'`)).n, 0);
  const child = (await contractRepository.get('org-a', 'C2'))!;
  assert.ok(!child.parent_contract_id);
  assert.equal(child.version, 2);
});

test('the snapshot sync never writes, reads or deletes contracts', async () => {
  await contractRepository.insert(contract('C1'));
  await contractRepository.insert(contract('C2'));
  const stamp = async () => (await sql.all(`SELECT contract_id, xmin::text AS xmin, version FROM contracts ORDER BY contract_id`));
  const before = await stamp();
  resetSyncCache(sql);
  // Memory holds neither contracts nor partners, by design: absence must not delete them, and an unrelated save must not touch them.
  const partner = { partner_id: 'p1', organizationId: 'org-a', partner_name: 'Renamed', tags: [], identifiers: [], dd_documents: [] };
  const partners = async () => (await sql.all(`SELECT partner_id, xmin::text AS xmin, version FROM partners ORDER BY partner_id`));
  const partnersBefore = await partners();
  await synchronizeBusinessRows(sql, { partners: [], contracts: [], ios: [], spendings: [], evaluations: [], notifications: [], templates: [] });
  await synchronizeBusinessRows(sql, { partners: [partner, { ...partner, partner_id: 'p2', organizationId: 'org-b', partner_name: 'Another edit' }], contracts: [contract('GHOST')] });
  assert.deepEqual(await stamp(), before, 'contract rows are byte-for-byte untouched (same xmin, same version)');
  assert.deepEqual(await partners(), partnersBefore, 'partner rows are byte-for-byte untouched too');
  assert.equal(await contractRepository.get('org-a', 'GHOST'), undefined, 'contracts passed to the sync are ignored, not inserted');
});

test('rows written by the old snapshot format are adopted by migration 0007 without loss', async () => {
  // A database exactly as the previous release left it: migrations up to 0006, contracts written by the full-snapshot sync.
  const legacyName = `legalio_test_legacy_${Date.now().toString(36)}`;
  const { default: pg } = await import('pg');
  const admin = new pg.Client(process.env.TEST_DATABASE_URL || 'postgres://legalio:legalio@127.0.0.1:5432/legalio');
  await admin.connect();
  await admin.query(`CREATE DATABASE ${legacyName}`);
  const { connect, end, sql: appSql } = await import('./db');
  const { createContractRepository } = await import('./repositories/contractRepository');
  await end();
  const url = new URL(process.env.TEST_DATABASE_URL || 'postgres://legalio:legalio@127.0.0.1:5432/legalio');
  url.pathname = `/${legacyName}`;
  connect({ connectionString: url.href });
  try {
    await runMigrations({ migrations: MIGRATIONS.slice(0, 6) });
    assert.equal((await appSql.get(`SELECT 1 AS present FROM information_schema.columns WHERE table_name = 'contracts' AND column_name = 'version'`)), undefined);
    await appSql.exec(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('org-a', 'A', 'a', now())`);
    const entity = entityFor('contracts');
    const partnerEntity = entityFor('partners');
    entity.repository = false; // the old behaviour: contracts and partners travel with the snapshot
    partnerEntity.repository = false;
    try {
      const legacy = [contract('C1', 'org-a', { status: 'Active' }), contract('C2', 'org-a', { contract_value: 0.29, termination_date: null, termination_document: { fileName: 'x.pdf', url: '/uploads/org-a/abc/Folder Termination/x.pdf' } })];
      await synchronizeBusinessRows(appSql, { partners: [{ partner_id: 'p1', organizationId: 'org-a', partner_name: 'P', tags: [], identifiers: [], dd_documents: [] }], contracts: legacy });
    } finally { entity.repository = true; partnerEntity.repository = true; }
    await runMigrations();
    const repository = createContractRepository(appSql);
    const adopted = await repository.list('org-a');
    assert.deepEqual(adopted.rows.map((r) => r.contract_id), ['C1', 'C2'], 'snapshot order is kept');
    assert.ok(adopted.rows.every((r) => r.version === 1));
    assert.equal(adopted.rows[1].contract_value, 0.29);
    assert.deepEqual(adopted.rows[0].cooperation_categories, ['Services', 'IT']);
    assert.equal(adopted.rows[1].termination_document.url, '/uploads/org-a/abc/Folder Termination/x.pdf');
    assert.equal((await repository.list('org-a', { q: 'Title C2' })).total, 1, 'the search index written by the old sync still serves the new queries');
    const edited = await repository.update({ ...adopted.rows[0], contract_title: 'Edited after adoption' }, 1);
    assert.equal(edited.version, 2);
  } finally {
    await end();
    connect({ connectionString: database.url });
    await admin.query(`DROP DATABASE IF EXISTS ${legacyName} WITH (FORCE)`);
    await admin.end();
  }
});
