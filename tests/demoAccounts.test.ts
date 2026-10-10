/**
 * Demo-dataset login accounts are removed completely (production boot, empty-workspace reset).
 * Run: npx tsx --test tests/demoAccounts.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { DEMO_ACCOUNT_EMAILS, isDemoAccountEmail, removeDemoAccounts } from '../apps/backend/src/demoAccounts';

function authDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT);
    CREATE TABLE session (id TEXT, userId TEXT);
    CREATE TABLE account (id TEXT, userId TEXT);
    CREATE TABLE member (id TEXT, userId TEXT);
    CREATE TABLE teamMember (id TEXT, userId TEXT);
  `);
  const add = (id: string, email: string) => {
    db.prepare(`INSERT INTO "user" VALUES (?, ?)`).run(id, email);
    for (const t of ['session', 'account', 'member', 'teamMember']) db.prepare(`INSERT INTO ${t} VALUES (?, ?)`).run(`${t}-${id}`, id);
  };
  add('admin', 'admin@legalio.com');
  add('real', 'owner@company.com');
  add('usr-demo-id-admin', 'Admin.ID@example.com');
  add('usr-demo-my-admin', 'admin.my@example.com');
  return db;
}

const count = (db: Database.Database, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;

test('the demo dataset account is the ones targeted', () => {
  assert.equal(DEMO_ACCOUNT_EMAILS.size, 1);
  for (const email of DEMO_ACCOUNT_EMAILS) assert.ok(email.endsWith('@example.com'), email);
});

test('legacy demo accounts remain removable after the dataset changes', () => {
  assert.equal(isDemoAccountEmail('legal.sg@example.com'), true);
  assert.equal(isDemoAccountEmail('finance.id@example.com'), true);
});

test('removes demo logins with their sessions, credentials and memberships; keeps everyone else', () => {
  const db = authDb();
  const allowedUsers = [
    { id: 'admin', email: 'admin@legalio.com' },
    { id: 'real', email: 'owner@company.com' },
    { id: 'usr-demo-id-admin', email: 'admin.id@example.com' },
    { id: 'usr-demo-ph-admin', email: 'admin.ph@example.com' },
  ];
  const result = removeDemoAccounts(db, allowedUsers);
  assert.equal(result.removed, 2, 'case-insensitive email match');
  assert.deepEqual(result.allowedUsers.map((u) => u.id), ['admin', 'real']);
  assert.deepEqual((db.prepare(`SELECT id FROM "user" ORDER BY id`).all() as { id: string }[]).map((r) => r.id), ['admin', 'real']);
  for (const table of ['session', 'account', 'member', 'teamMember']) assert.equal(count(db, table), 2, table);
  assert.equal(removeDemoAccounts(db, result.allowedUsers).removed, 0, 'idempotent');
});

test('never removes the acting user', () => {
  const db = authDb();
  const result = removeDemoAccounts(db, [{ id: 'usr-demo-my-admin', email: 'admin.my@example.com' }], 'usr-demo-my-admin');
  assert.equal(result.removed, 1);
  assert.deepEqual(result.allowedUsers.map((u) => u.id), ['usr-demo-my-admin']);
  assert.ok(db.prepare(`SELECT 1 FROM "user" WHERE id = 'usr-demo-my-admin'`).get());
});
