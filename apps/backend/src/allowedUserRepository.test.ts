/** The allowlist on real PostgreSQL: row-level writes, unique e-mails, the last-Admin rule under concurrency, and independence from the configuration save. */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-allowlist-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false', LOG_LEVEL: 'silent' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { ensureSchema } = await import('./schema');
const { createCoreSaver } = await import('./coreDataStore');
const { allowedUserRepository, withAdderNames, LastAdminError } = await import('./repositories/allowedUserRepository');
const { DuplicateValueError, RecordNotFoundError } = await import('./repositories/errors');
const { removeDemoAccounts } = await import('./demoAccounts');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => { await allowedUserRepository.removeAll(); });
const user = (id: string, extra: Record<string, unknown> = {}): Record<string, any> => ({ id, email: `${id}@example.com`, name: `User ${id}`, role: 'Editor', status: 'Active', createdAt: `2026-01-0${id.length}T00:00:00.000Z`, ...extra });

test('insert, list newest first, find by e-mail; the same e-mail twice is a conflict', async () => {
  await allowedUserRepository.insert(user('a', { createdAt: '2026-01-01T00:00:00.000Z' }));
  await allowedUserRepository.insert(user('b', { createdAt: '2026-02-01T00:00:00.000Z' }));
  assert.deepEqual((await allowedUserRepository.list()).map((u) => u.id), ['b', 'a']);
  assert.equal((await allowedUserRepository.findByEmail(' A@Example.com '))?.id, 'a');
  await assert.rejects(() => allowedUserRepository.insert(user('c', { email: 'A@example.com' })), DuplicateValueError);
});

test('the last Admin can neither be demoted nor removed, also when two requests race', async () => {
  await allowedUserRepository.insert(user('a', { role: 'Admin' }));
  await allowedUserRepository.insert(user('b', { role: 'Admin' }));
  const outcomes = await Promise.allSettled([
    allowedUserRepository.mutate('a', (u) => { u.role = 'Editor'; }),
    allowedUserRepository.mutate('b', (u) => { u.role = 'Editor'; }),
  ]);
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1, 'exactly one demotion wins');
  const lost = outcomes.find((o): o is PromiseRejectedResult => o.status === 'rejected')!;
  assert.ok(lost.reason instanceof LastAdminError);
  assert.equal((await allowedUserRepository.list()).filter((u) => u.role === 'Admin').length, 1);
  const remaining = (await allowedUserRepository.list()).find((u) => u.role === 'Admin')!;
  await assert.rejects(() => allowedUserRepository.remove(remaining.id), LastAdminError);
  await assert.rejects(() => allowedUserRepository.mutate('missing', () => undefined), RecordNotFoundError);
});

test('removal runs the caller\'s guard under the lock and reports unknown entries', async () => {
  await allowedUserRepository.insert(user('a', { role: 'Admin' }));
  await allowedUserRepository.insert(user('b'));
  await assert.rejects(() => allowedUserRepository.remove('b', () => { throw new Error('self'); }), /self/);
  assert.equal((await allowedUserRepository.list()).length, 2);
  assert.equal((await allowedUserRepository.remove('b')).id, 'b');
  await assert.rejects(() => allowedUserRepository.remove('b'), RecordNotFoundError);
});

test('the configuration save never deletes or rewrites allowlist entries (another instance may have added them)', async () => {
  await allowedUserRepository.insert(user('a'));
  const before = await sql.all(`SELECT id, xmin::text AS xmin FROM allowed_users`);
  const saver = createCoreSaver(sql, () => ({ allowedUsers: [], branding: { appName: 'X' } }));
  await saver.save();
  assert.deepEqual(await sql.all(`SELECT id, xmin::text AS xmin FROM allowed_users`), before);
});

test('adder names are derived when listing and nothing is written back', async () => {
  const listed = withAdderNames([user('a', { name: 'Alice Renamed', email: 'alice@example.com' }), user('b', { addedByEmail: 'ALICE@example.com', addedBy: 'Old Name' }), user('c', { addedBy: 'alice renamed' }), user('d', { addedBy: 'System' })]);
  assert.equal(listed[1].addedBy, 'Alice Renamed');
  assert.equal(listed[2].addedByEmail, 'alice@example.com');
  assert.equal(listed[3].addedBy, 'System');
});

test('demo accounts are removed from the allowlist together with their logins', async () => {
  const { buildDemoDataset } = await import('@legalio/shared/data/demoDataset');
  const demoEmail = String(buildDemoDataset().allowedUsers[0].email).toLowerCase();
  await allowedUserRepository.insert(user('demo', { email: demoEmail }));
  await allowedUserRepository.insert(user('real'));
  await removeDemoAccounts(sql);
  assert.deepEqual((await allowedUserRepository.list()).map((u) => u.id), ['real']);
});
