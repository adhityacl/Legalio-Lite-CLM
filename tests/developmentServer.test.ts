import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('combined workspace development serves the frontend through the isolated backend', { timeout: 60_000 }, async () => {
  const root = resolve('.');
  const dir = await mkdtemp(join(tmpdir(), 'legalio-dev-'));
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((done) => probe.close(() => done()));
  const child = spawn(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), 'src/server.ts'], {
    cwd: join(root, 'apps/backend'), detached: true,
    env: { PATH: process.env.PATH, PORT: String(port), APP_TEST_MODE: '1', AUTH_DB_PATH: join(dir, 'auth.db'), APP_DATA_DIR: dir, BETTER_AUTH_SECRET: 'isolated-development-test-secret-0123456789', SEED_DEMO_ADMIN: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout!.on('data', (chunk) => { logs += chunk; });
  child.stderr!.on('data', (chunk) => { logs += chunk; });
  try {
    const deadline = Date.now() + 45_000;
    while (!logs.includes('Server running on')) {
      assert.equal(child.exitCode, null, logs);
      assert.ok(Date.now() < deadline, logs);
      await new Promise((done) => setTimeout(done, 100));
    }
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 200, logs);
    const html = await response.text();
    assert.match(html, /\/src\/main.tsx/);
    assert.match(html, /@vite\/client/);
    const entry = await fetch(`http://127.0.0.1:${port}/src/main.tsx`);
    assert.equal(entry.status, 200);
    assert.match(await entry.text(), /App/);
  } finally {
    if (child.exitCode === null) {
      process.kill(-child.pid!, 'SIGTERM');
      await once(child, 'exit');
    }
    await rm(dir, { recursive: true, force: true });
  }
});
