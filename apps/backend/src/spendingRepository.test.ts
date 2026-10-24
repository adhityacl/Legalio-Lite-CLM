/** Spending-specific repository behaviour on real PostgreSQL: list filters/search/sorting by USD amount, duplicate lookup, vendor detach, legacy ids. */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-spending-repo-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false', LOG_LEVEL: 'silent' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { ensureSchema } = await import('./schema');
const { spendingRepository } = await import('./repositories/spendingRepository');
const { migrateLegacySpendingIds } = await import('./memoryDb');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => {
  await sql.exec(`TRUNCATE organization, search_records CASCADE`);
  await sql.exec(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('org-a', 'A', 'a', now()), ('org-b', 'B', 'b', now())`);
  await sql.exec(`INSERT INTO partners (partner_id, organization_id, record_position) VALUES ('p1', 'org-a', 0), ('p2', 'org-b', 0)`);
});
const spending = (id: string, org = 'org-a', extra: Record<string, unknown> = {}) => ({ id, organizationId: org, vendor_id: org === 'org-a' ? 'p1' : 'p2', vendor_name: `Vendor ${id}`, invoice_number: `INV-${id}`, invoice_date: '2026-10-01', currency: 'USD', total_amount: 10, total_amount_usd: 10, ...extra });

test('list: newest first, filters, text search, USD-amount and date sorting, paging with the total', async () => {
  await spendingRepository.insert(spending('S1', 'org-a', { total_amount_usd: 1000.5, invoice_date: '2026-03-01', payment_status: 'Paid', invoice_description: 'Orchard hosting' }));
  await spendingRepository.insert(spending('S2', 'org-a', { total_amount_usd: 20, invoice_date: '2026-01-01', currency: 'IDR', payment_status: 'Unpaid', vendor_id: null }));
  await spendingRepository.insert(spending('S3', 'org-a', { total_amount_usd: 300.25, invoice_date: '2026-02-01', payment_status: 'Paid' }));
  await spendingRepository.insert(spending('S4', 'org-b', { invoice_description: 'Orchard other tenant' }));
  assert.deepEqual((await spendingRepository.list('org-a')).rows.map((r) => r.id), ['S3', 'S2', 'S1']);
  assert.deepEqual((await spendingRepository.list('org-a', { paymentStatus: ['Unpaid'] })).rows.map((r) => r.id), ['S2']);
  assert.deepEqual((await spendingRepository.list('org-a', { currency: ['IDR'] })).rows.map((r) => r.id), ['S2']);
  assert.deepEqual((await spendingRepository.list('org-a', { vendorId: ['p1'] })).rows.map((r) => r.id).sort(), ['S1', 'S3']);
  assert.deepEqual((await spendingRepository.list('org-a', { q: 'orchard hosting' })).rows.map((r) => r.id), ['S1']);
  assert.equal((await spendingRepository.list('org-a', { q: 'other tenant' })).total, 0, 'search never crosses organizations');
  assert.deepEqual((await spendingRepository.list('org-a', { sort: 'total_amount_usd' })).rows.map((r) => r.id), ['S2', 'S3', 'S1'], 'numeric, not textual');
  assert.deepEqual((await spendingRepository.list('org-a', { sort: 'total_amount_usd', dir: 'desc', limit: 1 })).rows.map((r) => r.id), ['S1']);
  const page = await spendingRepository.list('org-a', { sort: 'invoice_date', limit: 2, offset: 1 });
  assert.deepEqual(page.rows.map((r) => r.id), ['S3', 'S1']);
  assert.equal(page.total, 3);
});

test('duplicate lookup, currencies and vendor detach (the link answers null, version moves)', async () => {
  await spendingRepository.insert(spending('S1', 'org-a', { invoice_number: ' Inv-77 ', vendor_name: 'Acme Ltd' }));
  await spendingRepository.insert(spending('S2', 'org-a', { vendor_id: 'p1', currency: 'IDR' }));
  assert.equal((await spendingRepository.findDuplicate('org-a', 'inv-77', 'ACME LTD'))?.id, 'S1');
  assert.equal(await spendingRepository.findDuplicate('org-b', 'inv-77', 'Acme Ltd'), undefined);
  assert.deepEqual((await spendingRepository.currencies()).sort(), ['IDR', 'USD']);
  assert.equal(await spendingRepository.detachVendor('org-a', 'p1'), 2);
  const detached = (await spendingRepository.get('org-a', 'S2'))!;
  assert.equal(detached.vendor_id, null);
  assert.equal(detached.version, 2);
});

test('ids of the earliest releases ("spd-…") are replaced by numbers from the sequence, keeping every other field', async () => {
  await spendingRepository.insert(spending('spd-1234', 'org-a', { total_amount: 12.5, month_allocations: [{ month: '2026-10', amount: 12.5 }] }));
  await spendingRepository.insert(spending('SP0001', 'org-a'));
  assert.equal(await migrateLegacySpendingIds(), 1);
  const ids = (await spendingRepository.list('org-a')).rows.map((r) => r.id);
  assert.equal(ids.length, 2);
  assert.ok(!ids.some((id) => id.startsWith('spd-')));
  const moved = (await spendingRepository.list('org-a')).rows.find((r) => r.id !== 'SP0001')!;
  assert.equal(moved.total_amount, 12.5);
  assert.deepEqual(moved.month_allocations, [{ month: '2026-10', amount: 12.5 }]);
  assert.equal(await migrateLegacySpendingIds(), 0, 'idempotent');
});
