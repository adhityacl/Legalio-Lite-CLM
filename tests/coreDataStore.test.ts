import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { synchronizeCoreData } from '../apps/backend/src/coreDataStore';

test('core synchronization writes only changes, preserves tenant records and rolls back invalid replacement', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE allowed_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, role TEXT, status TEXT, organizationId TEXT, payload TEXT, createdAt TEXT, updatedAt TEXT)`);
    for (const table of ['partners', 'contracts', 'insertion_orders', 'notifications', 'activity_logs', 'evaluations', 'spendings', 'tenants', 'departments', 'templates']) {
      db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, organizationId TEXT, payload TEXT, createdAt TEXT, updatedAt TEXT)`);
    }
    for (const table of ['branding', 'app_settings', 'news_ticker']) {
      db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, organizationId TEXT, payload TEXT, updatedAt TEXT)`);
    }
    const data = {
      allowedUsers: [{ id: 'u1', email: 'one@example.com' }, { id: 'u2', emailAddress: 'two@example.com' }, { id: 'invalid' }],
      contracts: [{ contract_id: 'a', organizationId: 'tenant-a', title: 'A' }, { contract_id: 'b', organizationId: 'tenant-b', title: 'B' }],
      partners: [{ partner_id: 'p1', organizationId: 'tenant-a' }],
      ios: [{ io_id: 'io1', organizationId: 'tenant-b' }],
      branding: { organizationId: 'tenant-a', name: 'Brand' },
      appSettings: { autoSync: true }, newsTicker: { items: ['News'] },
    };
    const changes = () => (db.prepare('SELECT total_changes() AS count').get() as { count: number }).count;
    synchronizeCoreData(db, data);
    let before = changes();
    synchronizeCoreData(db, data);
    assert.equal(changes() - before, 0, 'unchanged records must not be rewritten');
    before = changes();
    data.contracts[0].title = 'Updated A';
    synchronizeCoreData(db, data);
    assert.equal(changes() - before, 1, 'one contract edit requires one write');
    assert.deepEqual(db.prepare('SELECT id, organizationId FROM contracts ORDER BY id').all(), [
      { id: 'a', organizationId: 'tenant-a' }, { id: 'b', organizationId: 'tenant-b' },
    ]);
    const previous = db.prepare('SELECT * FROM contracts ORDER BY id').all();
    assert.throws(() => synchronizeCoreData(db, { ...data, contracts: [data.contracts[0], data.contracts[0]] }), /Duplicate id/);
    assert.deepEqual(db.prepare('SELECT * FROM contracts ORDER BY id').all(), previous);
    before = changes();
    data.contracts.pop();
    synchronizeCoreData(db, data);
    assert.equal(changes() - before, 1, 'removal deletes only the missing contract');
    data.allowedUsers = [{ id: 'u1', email: 'two@example.com' }, { id: 'u2', emailAddress: 'one@example.com' }];
    synchronizeCoreData(db, data);
    assert.deepEqual(db.prepare('SELECT id, email FROM allowed_users ORDER BY id').all(), [
      { id: 'u1', email: 'two@example.com' }, { id: 'u2', email: 'one@example.com' },
    ]);
    assert.throws(() => synchronizeCoreData(db, { ...data, allowedUsers: [{ id: 'u1', email: 'same@example.com' }, { id: 'u2', email: 'same@example.com' }] }), /UNIQUE/);
    assert.deepEqual(db.prepare('SELECT id, email FROM allowed_users ORDER BY id').all(), [
      { id: 'u1', email: 'two@example.com' }, { id: 'u2', email: 'one@example.com' },
    ]);
  } finally {
    db.close();
  }
});
