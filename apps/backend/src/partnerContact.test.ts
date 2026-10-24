import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { migratePartnerContact } from './partnerContact';
import { partnerRepository } from './repositories/partnerRepository';
import { sql } from './db';
import { readBusinessRows } from './normalizedCoreStore';
import { ensureSchema } from './schema';
import { createTestDatabase } from './testDatabase';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(() => database?.drop());

test('migrates legacy contacts, preserves explicit fields, and is idempotent', () => {
  const partner = migratePartnerContact({ pic_partner: 'Budi Santoso (budi@example.com | +628123456)', pic_email: 'new@example.com' });
  assert.deepEqual(partner, { pic_name: 'Budi Santoso', pic_email: 'new@example.com', pic_phone: '+628123456' });
  assert.deepEqual(migratePartnerContact({ ...partner }), partner);
  assert.equal(migratePartnerContact({ pic_partner: 'Jane Tan' }).pic_name, 'Jane Tan');
});

test('persistence removes the legacy field while retaining contacts and unrelated data', async () => {
  await sql.run(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('org1', 'Org', 'org1', now())`);
  const row = { partner_id: 'p1', organizationId: 'org1', pic_partner: 'Jane (jane@example.com | +6512345678)', notes: 'Keep this' };
  await partnerRepository.insert(row);
  const [partner] = await readBusinessRows(sql, 'partners');
  assert.equal('pic_partner' in partner, false);
  assert.equal(partner.pic_email, 'jane@example.com');
  assert.equal(partner.notes, 'Keep this');
  assert.equal(partner.organizationId, 'org1');
  await partnerRepository.update(row, 1);
  assert.equal((await sql.get('SELECT COUNT(*) AS n FROM partners')).n, 1);
});
