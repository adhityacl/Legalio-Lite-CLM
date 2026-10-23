import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

// Spawns the real entry (src/main.ts) as a child process. Needs PostgreSQL at TEST_DATABASE_URL (see testDatabase.ts).
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-onboarding-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: root });
delete process.env.DATABASE_URL;
const { createTestDatabase } = await import('./testDatabase');
const { end } = await import('./db');

const repository = path.resolve(import.meta.dirname, '../../..');
const freePort = () => new Promise<number>((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); });
});
const children: ChildProcess[] = [];
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let target: { host: string; port: number; user: string; password: string; database: string; ssl: boolean };
before(async () => {
  database = await createTestDatabase();
  await end(); // the child owns the only pool on this database
  const url = new URL(database.url);
  target = { host: url.hostname, port: Number(url.port || 5432), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: database.name, ssl: false };
});
after(async () => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  await database?.drop();
  fs.rmSync(root, { recursive: true, force: true });
});

/** `DATABASE_URL: ''` (not unset) so a developer's .env cannot supply one through dotenv. */
async function start(env: Record<string, string> = {}) {
  const dir = env.APP_DATA_DIR ?? fs.mkdtempSync(path.join(root, 'data-'));
  const port = await freePort();
  const child = spawn('node', ['--import', 'tsx', 'apps/backend/src/main.ts'], {
    cwd: repository,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, APP_TEST_MODE: '1', APP_DATA_DIR: dir, PORT: String(port), API_ONLY: 'true', DATABASE_URL: '',
      BETTER_AUTH_SECRET: 'test-only-secret-for-onboarding-123456789', BETTER_AUTH_ENABLE_INFRA: 'false', SEED_DEMO_ADMIN: 'false',
      GEMINI_API_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_APPLICATION_CREDENTIALS: '', ...env,
    },
  });
  children.push(child);
  let log = '';
  child.stdout?.on('data', (c) => { log += c; });
  child.stderr?.on('data', (c) => { log += c; });
  const base = `http://127.0.0.1:${port}`;
  const call = async (route: string, body?: unknown) => {
    const response = await fetch(base + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: (await response.json().catch(() => null)) as any };
  };
  const ready = async () => {
    for (const deadline = Date.now() + 60000; Date.now() < deadline; await new Promise((r) => setTimeout(r, 200))) {
      if (child.exitCode !== null) throw new Error(`Server exited ${child.exitCode}: ${log}`);
      try { await fetch(base); return; } catch { /* not listening yet */ }
    }
    throw new Error(`Timed out: ${log}`);
  };
  const stop = async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } };
  const exitCode = async () => (child.exitCode ?? (await once(child, 'exit'))[0]) as number;
  return { dir, child, call, ready, stop, exitCode, log: () => log };
}

test('a fresh install asks for PostgreSQL first and only saves a working connection', async () => {
  const server = await start();
  await server.ready();
  const file = path.join(server.dir, 'database.json');
  assert.deepEqual((await server.call('/api/system/public-status')).body, { needsDatabase: true });
  assert.equal((await server.call('/api/health')).body.error, 'DATABASE_REQUIRED');
  for (const bad of [{ host: '' }, { port: 0 }, { port: 65536 }, { port: '5432' }, { port: 54.5 }, { user: ' ' }, { database: '' }, { ssl: 'yes' }]) {
    const response = await server.call('/api/system/database', { ...target, ...bad });
    assert.equal(response.status, 400, JSON.stringify(bad));
    assert.equal(response.body.error, 'INVALID_DATABASE_CONFIG');
  }
  const wrong = await server.call('/api/system/database', { ...target, password: 'wrong-onboarding-password' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, 'DATABASE_CONNECTION_FAILED');
  assert.doesNotMatch(JSON.stringify(wrong.body), /wrong-onboarding-password/);
  assert.equal(fs.existsSync(file), false);

  const connected = await server.call('/api/system/database', target);
  assert.equal(connected.status, 201, JSON.stringify(connected.body));
  assert.deepEqual(connected.body, { success: true });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), target);
  assert.equal((await server.call('/api/health')).body.status, 'ok');
  const status = (await server.call('/api/system/public-status')).body;
  assert.equal(status.needsDatabase, false);
  assert.equal(status.needsSetup, true);
  assert.equal((await server.call('/api/system/database', target)).status, 409);
  // A storage block is validated even in test mode, before anything touches the network.
  const setup = await server.call('/api/system/setup', { publicUrl: 'http://127.0.0.1', name: 'Root', email: 'root@example.com', password: 'onboarding-pass-1', storage: { bucket: 'evil.example.com/x-1' } });
  assert.equal(setup.status, 400);
  assert.equal(setup.body.error, 'invalid_storage_config');
  assert.doesNotMatch(server.log(), /wrong-onboarding-password/);
  await server.stop();
});

test('DATABASE_URL wins over database.json, and outside test mode setup requires Tencent COS', async () => {
  const dir = fs.mkdtempSync(path.join(root, 'env-'));
  fs.writeFileSync(path.join(dir, 'database.json'), JSON.stringify({ ...target, port: 1 }), { mode: 0o600 });
  const server = await start({ APP_DATA_DIR: dir, APP_TEST_MODE: '0', NODE_ENV: 'development', DATABASE_URL: database.url });
  await server.ready();
  assert.equal((await server.call('/api/health')).body.status, 'ok');
  assert.equal((await server.call('/api/system/database', target)).status, 409);
  const setup = await server.call('/api/system/setup', { publicUrl: 'http://127.0.0.1', name: 'Root', email: 'root@example.com', password: 'onboarding-pass-1' });
  assert.equal(setup.status, 400);
  assert.equal(setup.body.error, 'invalid_storage_config');
  assert.equal((await server.call('/api/system/public-status')).body.needsSetup, true);
  await server.stop();
});

test('a saved database that cannot be reached stops the process instead of reopening the form', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(root, 'saved-'));
  fs.writeFileSync(path.join(dir, 'database.json'), JSON.stringify({ ...target, port: 1 }), { mode: 0o600 });
  const server = await start({ APP_DATA_DIR: dir });
  assert.equal(await server.exitCode(), 1);
});

test('production refuses to start without BETTER_AUTH_SECRET', { timeout: 60000 }, async () => {
  const server = await start({ NODE_ENV: 'production', BETTER_AUTH_SECRET: '' });
  assert.equal(await server.exitCode(), 1);
  assert.match(server.log(), /BETTER_AUTH_SECRET/);
});
