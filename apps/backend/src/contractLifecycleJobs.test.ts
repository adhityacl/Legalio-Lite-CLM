/** Lifecycle refresh, reminders and startup normalization of contracts stored in their repository (real PostgreSQL). */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-lifecycle-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false', LOG_LEVEL: 'silent' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { ensureSchema } = await import('./schema');
const { contractRepository } = await import('./repositories/contractRepository');
const jobs = await import('./reminderJobs');
const { normalizeStoredContracts, db } = await import('./memoryDb');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });

const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const contract = (id: string, extra: Record<string, unknown> = {}) => ({
  contract_id: id, organizationId: 'org-a', partner_id: 'p1', contract_number: `N-${id}`, contract_title: `T-${id}`,
  start_date: '2020-01-01', end_date: isoDay(400), currency: 'USD', contract_value: 1, status: 'Active', status_approval: 'Signed', days_remaining: 400, ...extra,
});

beforeEach(async () => {
  await sql.exec('TRUNCATE organization, search_records CASCADE');
  await sql.exec(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('org-a', 'A', 'a', now())`);
  await sql.exec(`INSERT INTO partners (partner_id, organization_id, record_position) VALUES ('p1', 'org-a', 0)`);
  // recalculateStatuses also saves the snapshot (orders); the partner must be in memory or that save would delete it.
  db.ios = [];
});

test('a refresh corrects stale status and days without a new version, and rolls an auto-renewal forward with one', async () => {
  await contractRepository.insert(contract('EXPIRED', { end_date: isoDay(-5), status: 'Active', days_remaining: 10 }));
  await contractRepository.insert(contract('SOON', { end_date: isoDay(10), status: 'Active', days_remaining: 300 }));
  await contractRepository.insert(contract('FINE', { end_date: isoDay(900), days_remaining: 900 }));
  await contractRepository.insert(contract('RENEWS', { start_date: '2022-01-01', end_date: '2023-12-31', auto_renewal: true, status: 'Expired', days_remaining: -5 }));
  await jobs.recalculateStatuses();
  const byId = new Map((await contractRepository.list('org-a')).rows.map((row) => [row.contract_id, row]));
  assert.equal(byId.get('EXPIRED')!.status, 'Expired');
  assert.equal(byId.get('EXPIRED')!.version, 1, 'a display refresh does not invalidate an editor\'s copy');
  assert.equal(byId.get('SOON')!.status, 'Expiring');
  assert.equal(byId.get('SOON')!.days_remaining, 10);
  assert.equal(byId.get('FINE')!.status, 'Active');
  const renewed = byId.get('RENEWS')!;
  assert.ok(renewed.end_date > isoDay(0), `end date rolled forward (${renewed.end_date})`);
  assert.equal(renewed.version, 2, 'a moved end date is a real change');
});

test('a refresh that races a user edit neither fails nor overwrites it', async () => {
  const created = await contractRepository.insert(contract('RACE', { end_date: isoDay(-3), status: 'Active' }));
  await contractRepository.update({ ...created, contract_title: 'Edited by a person' }, 1);
  await jobs.refreshLifecyclesOnce().catch(() => undefined);
  await jobs.recalculateStatuses();
  const row = (await contractRepository.get('org-a', 'RACE'))!;
  assert.equal(row.contract_title, 'Edited by a person');
  assert.equal(row.status, 'Expired');
  assert.equal(row.version, 2);
});

test('reminders are planned from the stored contracts of every organization, terminated ones excluded', async () => {
  await sql.exec(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('org-b', 'B', 'b', now())`);
  await sql.exec(`INSERT INTO partners (partner_id, organization_id, record_position) VALUES ('p2', 'org-b', 0)`);
  await contractRepository.insert(contract('A1', { end_date: isoDay(20) }));
  await contractRepository.insert({ ...contract('B1', { end_date: isoDay(25) }), organizationId: 'org-b', partner_id: 'p2' });
  await contractRepository.insert(contract('T1', { end_date: isoDay(20), status: 'Terminated', lifecycle_mode: 'terminated', termination_date: isoDay(-2) }));
  const records = await jobs.reminderRecords();
  const ids = records.filter((item) => item.kind === 'contract').map((item) => item.recordId).sort();
  assert.deepEqual(ids, ['A1', 'B1']);
  assert.equal(records.find((item) => item.recordId === 'B1')!.record.organizationId, 'org-b');
});

test('contracts written by earlier releases (Indonesian status labels, bad currency) are normalized at startup, once', async () => {
  const legacy = await contractRepository.insert(contract('OLD', { status: 'Aktif', status_approval: 'Ditandatangani', currency: 'rupiah?' }));
  await contractRepository.insert(contract('NEW'));
  assert.equal(await normalizeStoredContracts(), 1);
  const row = (await contractRepository.get('org-a', 'OLD'))!;
  assert.equal(row.status, 'Active');
  assert.equal(row.status_approval, 'Signed');
  assert.match(row.currency, /^[A-Z]{3}$/);
  assert.equal(row.version, legacy.version, 'normalization is not a user edit');
  assert.equal(await normalizeStoredContracts(), 0, 'idempotent');
});
