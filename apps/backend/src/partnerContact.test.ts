import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { migratePartnerContact } from './partnerContact';
import { synchronizeCoreData } from './coreDataStore';

test('migrates legacy contacts, preserves explicit fields, and is idempotent', () => {
  const partner = migratePartnerContact({ pic_partner: 'Budi Santoso (budi@example.com | +628123456)', pic_email: 'new@example.com' });
  assert.deepEqual(partner, { pic_name: 'Budi Santoso', pic_email: 'new@example.com', pic_phone: '+628123456' });
  assert.deepEqual(migratePartnerContact({ ...partner }), partner);
  assert.equal(migratePartnerContact({ pic_partner: 'Jane Tan' }).pic_name, 'Jane Tan');
});

test('persistence removes the legacy field while retaining contacts and unrelated data', () => {
  const db = new Database(':memory:');
  try {
    for (const table of ['allowed_users', 'partners', 'contracts', 'insertion_orders', 'notifications', 'activity_logs', 'evaluations', 'spendings', 'templates']) {
      db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, organizationId TEXT, payload TEXT, createdAt TEXT, updatedAt TEXT, email TEXT, name TEXT, role TEXT, status TEXT)`);
    }
    const data = { partners: [{ partner_id: 'p1', organizationId: 'org1', pic_partner: 'Jane (jane@example.com | +6512345678)', notes: 'Keep this' }] };
    synchronizeCoreData(db, data);
    const payload = JSON.parse((db.prepare('SELECT payload FROM partners').get() as { payload: string }).payload);
    assert.equal('pic_partner' in payload, false);
    assert.equal(payload.pic_email, 'jane@example.com');
    assert.equal(payload.notes, 'Keep this');
    assert.equal(payload.organizationId, 'org1');
    assert.deepEqual(payload, data.partners[0]);
    synchronizeCoreData(db, data);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM partners').get() as { n: number }).n, 1);
  } finally {
    db.close();
  }
});
