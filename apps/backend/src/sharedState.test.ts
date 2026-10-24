/** Shared-state announcements between instances: NOTIFY reaches registered loaders, the periodic reload covers a missed one, stop is clean. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-shared-state-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false', LOG_LEVEL: 'silent', SHARED_STATE_POLL_MS: '300' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const state = await import('./sharedState');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); });
after(async () => { await state.stopSharedStateSync(); await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });
const until = async (check: () => boolean, what: string) => {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 25)); }
};

test('a notification from another instance reloads exactly the named part; a failing loader does not stop the others', async () => {
  const calls: string[] = [];
  state.registerSharedState('alpha', async () => { calls.push('alpha'); });
  state.registerSharedState('beta', async () => { calls.push('beta'); });
  state.registerSharedState('broken', async () => { throw new Error('boom'); });
  process.env.SHARED_STATE_POLL_MS = '0'; // notifications only in this test
  state.startSharedStateSync();
  await new Promise((r) => setTimeout(r, 300)); // the listener connects asynchronously
  await sql.get(`SELECT pg_notify(?, ?)`, state.SHARED_STATE_CHANNEL, 'alpha:some-other-instance');
  await until(() => calls.includes('alpha'), 'alpha reload');
  assert.deepEqual(calls, ['alpha']);
  await state.refreshSharedState();
  assert.deepEqual(calls.slice(1).sort(), ['alpha', 'beta'], 'a manual full reload runs every loader and survives the broken one');
  await sql.get(`SELECT pg_notify(?, ?)`, state.SHARED_STATE_CHANNEL, 'unknown:other');
  await state.stopSharedStateSync();
  const before = calls.length;
  await sql.get(`SELECT pg_notify(?, ?)`, state.SHARED_STATE_CHANNEL, 'beta:other');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(calls.length, before, 'nothing is reloaded after stop');
});

test('the periodic reload covers a notification that never arrived', async () => {
  let reloads = 0;
  state.registerSharedState('gamma', async () => { reloads++; });
  process.env.SHARED_STATE_POLL_MS = '200';
  state.startSharedStateSync();
  await until(() => reloads >= 2, 'two periodic reloads');
  await state.stopSharedStateSync();
});
