/** Partner-specific repository behaviour on real PostgreSQL: list filters, text search, sorting, paging, lookups and the scope directory. */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-partner-repo-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false', LOG_LEVEL: 'silent' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { ensureSchema } = await import('./schema');
const { partnerRepository } = await import('./repositories/partnerRepository');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => {
  await sql.exec(`TRUNCATE organization, search_records CASCADE`);
  await sql.exec(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('org-a', 'A', 'a', now()), ('org-b', 'B', 'b', now())`);
});
const partner = (id: string, org = 'org-a', extra: Record<string, unknown> = {}) => ({ partner_id: id, organizationId: org, partner_name: `Partner ${id}`, tags: [], identifiers: [], dd_documents: [], ...extra });

test('list: newest first, filters, text search over name/owner/country/notes/id, sorting and paging with the total before paging', async () => {
  const rows = [
    partner('P1', 'org-a', { partner_name: 'Zeta Media', internal_pic: 'Sales', country: 'ID', partner_type: 'Vendor', status_dd: 'Complete', notes: 'orchard supplier', pic_name: 'Budi' }),
    partner('P2', 'org-a', { partner_name: 'alpha Studio', internal_pic: 'Legal', country: 'SG', partner_type: 'Client', status_dd: 'Incomplete' }),
    partner('P3', 'org-a', { partner_name: 'Mid Corp', internal_pic: 'Sales', country: 'ID', partner_type: 'Vendor', status_dd: 'Incomplete' }),
    partner('P4', 'org-b', { partner_name: 'Zeta Media Other Tenant', internal_pic: 'Sales' }),
  ];
  for (const row of rows) await partnerRepository.insert(row);
  assert.deepEqual((await partnerRepository.list('org-a')).rows.map((r) => r.partner_id), ['P3', 'P2', 'P1'], 'newest first, like the old unshift');
  assert.deepEqual((await partnerRepository.list('org-a', { internalPic: ['Sales'] })).rows.map((r) => r.partner_id).sort(), ['P1', 'P3']);
  assert.deepEqual((await partnerRepository.list('org-a', { partnerType: ['Client'], country: ['SG'] })).rows.map((r) => r.partner_id), ['P2']);
  assert.deepEqual((await partnerRepository.list('org-a', { statusDd: ['Incomplete', 'Complete'] })).total, 3);
  assert.deepEqual((await partnerRepository.list('org-a', { q: 'ORCHARD zeta' })).rows.map((r) => r.partner_id), ['P1'], 'every word must match, case-insensitively');
  assert.deepEqual((await partnerRepository.list('org-a', { q: 'budi' })).rows.map((r) => r.partner_id), ['P1'], 'PIC name is searched');
  assert.deepEqual((await partnerRepository.list('org-a', { q: 'p2' })).rows.map((r) => r.partner_id), ['P2'], 'so is the id');
  assert.equal((await partnerRepository.list('org-a', { q: '%_\\' })).total, 0, 'LIKE wildcards are literals');
  assert.equal((await partnerRepository.list('org-a', { q: 'other tenant' })).total, 0, 'search never crosses organizations');
  const page = await partnerRepository.list('org-a', { sort: 'partner_name', limit: 2, offset: 1 });
  assert.deepEqual(page.rows.map((r) => r.partner_name), ['Mid Corp', 'Zeta Media'], 'case-insensitive name order');
  assert.equal(page.total, 3);
  assert.deepEqual((await partnerRepository.list('org-a', { sort: 'partner_name', dir: 'desc', limit: 1 })).rows.map((r) => r.partner_id), ['P1']);
});

test('lookups: by name (trimmed, case-insensitive, per organization), by id or name, directory and names', async () => {
  await partnerRepository.insert(partner('P1', 'org-a', { partner_name: '  Acme Ltd ', internal_pic: 'Sales' }));
  await partnerRepository.insert(partner('P2', 'org-b', { partner_name: 'Acme Ltd' }));
  assert.equal((await partnerRepository.findByName('org-a', 'acme ltd'))?.partner_id, 'P1');
  assert.equal((await partnerRepository.findByName('org-b', 'ACME LTD'))?.partner_id, 'P2');
  assert.equal(await partnerRepository.findByName('org-a', ''), undefined);
  assert.equal((await partnerRepository.findByIdOrName('org-a', 'nope', 'Acme Ltd'))?.partner_id, 'P1');
  assert.equal((await partnerRepository.findByIdOrName('org-a', 'P1', 'unrelated'))?.partner_id, 'P1');
  assert.equal(await partnerRepository.findByIdOrName('org-a', 'P2', ''), undefined, 'another organization\'s id never resolves');
  assert.deepEqual(await partnerRepository.directory('org-a'), [{ partner_id: 'P1', organizationId: 'org-a', partner_name: '  Acme Ltd ', internal_pic: 'Sales' }]);
  assert.deepEqual([...(await partnerRepository.names('org-a', ['P1', 'P2'])).entries()], [['P1', '  Acme Ltd ']]);
  assert.equal(await partnerRepository.departmentReferenced('org-a', 'sales'), true);
  assert.equal(await partnerRepository.departmentReferenced('org-b', 'sales'), false);
});

test('imports append after the existing partners instead of taking the first position', async () => {
  await partnerRepository.insert(partner('P1'));
  await partnerRepository.insert(partner('P2'), { position: 'last' } as any);
  await partnerRepository.insert(partner('P3'));
  assert.deepEqual((await partnerRepository.list('org-a')).rows.map((r) => r.partner_id), ['P3', 'P1', 'P2']);
});
