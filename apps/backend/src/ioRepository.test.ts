/** Insertion-order-specific repository behaviour on real PostgreSQL: list filters/search/paging, number uniqueness, detaching and bulk removal. */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-io-repo-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false', LOG_LEVEL: 'silent' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { ensureSchema } = await import('./schema');
const { ioRepository } = await import('./repositories/ioRepository');
const { contractRepository } = await import('./repositories/contractRepository');
const { DuplicateValueError } = await import('./repositories/errors');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => {
  await sql.exec(`TRUNCATE organization, search_records CASCADE`);
  await sql.exec(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('org-a', 'A', 'a', now()), ('org-b', 'B', 'b', now())`);
  await sql.exec(`INSERT INTO partners (partner_id, organization_id, record_position) VALUES ('p1', 'org-a', 0), ('p2', 'org-a', 1), ('p3', 'org-b', 0)`);
  await contractRepository.insert({ contract_id: 'C1', organizationId: 'org-a', partner_id: 'p1', contract_number: 'CTR-ORCHARD-1', contract_title: 'Master', status: 'Active' });
});
const io = (id: string, org = 'org-a', extra: Record<string, unknown> = {}) => ({ io_id: id, organizationId: org, io_number: `IO-${id}`, io_title: `Order ${id}`, partner_id: org === 'org-a' ? 'p1' : 'p3', status: 'Active', currency: 'USD', ...extra });

test('list: newest first, filters, text search (including the linked contract number), sorting and paging with the total', async () => {
  await ioRepository.insert(io('I1', 'org-a', { end_date: '2030-03-01', contract_id: 'C1', media_channel: 'Radio', deliverables: 'Jingles' }));
  await ioRepository.insert(io('I2', 'org-a', { end_date: '2030-01-01', partner_id: 'p2', status: 'Expired', io_number: 'zz-last' }));
  await ioRepository.insert(io('I3', 'org-a', { end_date: '2030-02-01', io_title: 'Special Orchard' }));
  await ioRepository.insert(io('I4', 'org-b', { io_title: 'Special Orchard Other' }));
  assert.deepEqual((await ioRepository.list('org-a')).rows.map((r) => r.io_id), ['I3', 'I2', 'I1']);
  assert.deepEqual((await ioRepository.list('org-a', { status: ['Expired'] })).rows.map((r) => r.io_id), ['I2']);
  assert.deepEqual((await ioRepository.list('org-a', { partnerId: ['p1'] })).rows.map((r) => r.io_id).sort(), ['I1', 'I3']);
  assert.deepEqual((await ioRepository.list('org-a', { contractId: ['C1'] })).rows.map((r) => r.io_id), ['I1']);
  assert.deepEqual((await ioRepository.list('org-a', { q: 'jingles radio' })).rows.map((r) => r.io_id), ['I1']);
  assert.deepEqual((await ioRepository.list('org-a', { q: 'orchard' })).rows.map((r) => r.io_id).sort(), ['I1', 'I3'], 'the parent contract\'s number is searchable too');
  assert.equal((await ioRepository.list('org-a', { q: 'other' })).total, 0, 'search never crosses organizations');
  const page = await ioRepository.list('org-a', { sort: 'end_date', limit: 2, offset: 1 });
  assert.deepEqual(page.rows.map((r) => r.io_id), ['I3', 'I1']);
  assert.equal(page.total, 3);
  assert.deepEqual((await ioRepository.list('org-a', { sort: 'io_number', dir: 'desc', limit: 1 })).rows.map((r) => r.io_id), ['I2']);
});

test('order numbers are unique per organization even under a concurrent race', async () => {
  const attempts = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => ioRepository.insert(io(`R${i}`, 'org-a', { io_number: ' Race-1 ' }))));
  assert.equal(attempts.filter((a) => a.status === 'fulfilled').length, 1);
  assert.ok(attempts.filter((a): a is PromiseRejectedResult => a.status === 'rejected').every((a) => a.reason instanceof DuplicateValueError));
  assert.equal((await ioRepository.findByNumber('org-a', 'race-1'))?.io_number, ' Race-1 ');
  await ioRepository.insert(io('Other', 'org-b', { io_number: 'Race-1' })); // another organization: allowed
});

test('detaching a deleted contract keeps the orders and bumps their version; removeMany deletes with children and search entries', async () => {
  await ioRepository.insert(io('I1', 'org-a', { contract_id: 'C1' }));
  await ioRepository.insert(io('I2', 'org-a', { contract_id: 'C1' }));
  await ioRepository.insert(io('I3', 'org-a', { partner_id: 'p2' }));
  assert.equal(await ioRepository.detachContract('org-a', 'C1'), 2);
  const detached = (await ioRepository.get('org-a', 'I1'))!;
  assert.ok(!detached.contract_id);
  assert.equal(detached.version, 2);
  assert.deepEqual(await ioRepository.idsByPartnerOrContracts('org-a', 'p2', []), ['I3']);
  assert.equal(await ioRepository.removeMany('org-a', ['I1', 'I3']), 2);
  assert.deepEqual((await ioRepository.list('org-a')).rows.map((r) => r.io_id), ['I2']);
  assert.equal((await sql.get(`SELECT COUNT(*) AS n FROM search_records WHERE entity_type = 'insertion_orders'`)).n, 1);
  assert.equal(await ioRepository.removeMany('org-b', ['I2']), 0, 'another organization cannot delete it');
});

test('the scope directory carries partner, contract and the stored partner name of each order', async () => {
  await ioRepository.insert(io('I1', 'org-a', { contract_id: 'C1', partner_name: 'Named Partner' }));
  assert.deepEqual(await ioRepository.directory('org-a'), [{ io_id: 'I1', organizationId: 'org-a', partner_id: 'p1', contract_id: 'C1', partner_name: 'Named Partner' }]);
  assert.deepEqual(await ioRepository.directory('org-b'), []);
});
