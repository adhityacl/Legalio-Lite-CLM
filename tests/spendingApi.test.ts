import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import Database from 'better-sqlite3';

// Real endpoint and SQLite checks run in a disposable directory, without credentials.
test('spending POST/PUT persist allocations/title, reject invalid writes and preserve legacy attachments', { timeout: 90_000 }, async () => {
  const root = resolve('.');
  const directory = await mkdtemp(join(tmpdir(), 'spending-api-'));
  let child: ReturnType<typeof spawn> | undefined;
  let database: Database.Database | undefined;
  let logs = '';
  try {
    await build({ entryPoints: [join(root, 'apps/backend/src/server.ts')], bundle: true, platform: 'node', format: 'cjs', packages: 'external', alias: { '@legalio/shared': resolve(root, 'packages/shared/src'), '@legalio/types': resolve(root, 'packages/types/src') }, outfile: join(directory, 'server.cjs'), logLevel: 'silent' });
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    child = spawn(process.execPath, [join(directory, 'server.cjs')], {
      cwd: directory, env: { AUTH_DB_PATH: join(directory, 'auth.db'), APP_DATA_DIR: directory, PATH: process.env.PATH, NODE_PATH: join(root, 'node_modules'), API_ONLY: 'true', PORT: String(port), SEED_DEMO_ADMIN: 'false', BETTER_AUTH_SECRET: 'isolated-spending-test-secret-32-characters' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout!.on('data', chunk => { logs += chunk.toString(); });
    child.stderr!.on('data', chunk => { logs += chunk.toString(); });
    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 45_000;
    while (!logs.includes('Server running on')) {
      assert.equal(child.exitCode, null, logs);
      assert.ok(Date.now() < deadline, logs);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    database = new Database(join(directory, 'auth.db'));
    const now = new Date().toISOString();
    const token = 'spending-api-test-token';
    database.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt,role,banned) VALUES (?,?,?,?,?,?,?,?)').run('spending-test', 'Spending Test', 'spending@example.test', 1, now, now, 'superuser', 0);
    database.prepare('INSERT INTO session (id,expiresAt,token,createdAt,updatedAt,userId) VALUES (?,?,?,?,?,?)').run('spending-session', new Date(Date.now() + 60_000).toISOString(), token, now, now, 'spending-test');
    const send = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-organization-id': 'org-demo-bmd' }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, data: await response.json() as any };
    };
    const input = { vendor_name: 'Allocation Test Partner', invoice_number: 'ALLOCATION-1', invoice_title: 'Q4 retainer', invoice_description: 'Service details', invoice_date: '2026-09-29', currency: 'USD', total_amount: 100, total_amount_usd: 100,
      invoice_month: ['2026-09'], month_allocations: [{ month: '2026-10', amount: 33.33 }, { month: '2026-11', amount: 33.33 }, { month: '2026-12', amount: 33.34 }],
      invoice_file: { fileName: 'invoice.png', fileData: 'data:image/png;base64,aW52b2ljZQ==' }, billing_file: { fileName: 'billing.pdf', fileData: 'data:application/pdf;base64,YmlsbGluZw==' },
    };
    const added = await send('/api/partner-spendings', 'POST', input);
    assert.equal(added.status, 200, JSON.stringify(added.data));
    const stored = added.data.spending;
    assert.equal(stored.invoice_title, input.invoice_title);
    assert.deepEqual(stored.invoice_month, ['2026-10-31', '2026-11-30', '2026-12-31']);
    assert.deepEqual(stored.month_allocations, input.month_allocations);
    assert.ok(stored.invoice_file_url);
    assert.ok(stored.billing_file_url);
    const payload = JSON.parse((database.prepare('SELECT payload FROM spendings WHERE id = ?').get(stored.id) as { payload: string }).payload);
    assert.equal(payload.invoice_title, input.invoice_title);
    assert.deepEqual(payload.month_allocations, input.month_allocations);
    const edited = await send(`/api/partner-spendings/${stored.id}`, 'PUT', { invoice_title: 'Updated title' });
    assert.equal(edited.status, 200);
    assert.equal(edited.data.spending.invoice_title, 'Updated title');
    assert.equal(edited.data.spending.invoice_file_url, stored.invoice_file_url);
    assert.equal(edited.data.spending.billing_file_url, stored.billing_file_url);
    assert.equal((await send(`/api/partner-spendings/${stored.id}`, 'PUT', { total_amount: 101, total_amount_usd: 101 })).status, 400);
    assert.equal((await send(`/api/partner-spendings/${stored.id}`, 'PUT', { total_amount: null })).status, 400);
    for (const allocations of [[], [{ month: '', amount: 100 }], [{ month: '2026-10', amount: -1 }], [{ month: '2026-10', amount: 90 }], [{ month: '2026-10', amount: 110 }], [{ month: '2026-10', amount: 50 }, { month: '2026-10', amount: 50 }]]) {
      assert.equal((await send('/api/partner-spendings', 'POST', { ...input, month_allocations: allocations })).status, 400);
      assert.equal((await send(`/api/partner-spendings/${stored.id}`, 'PUT', { month_allocations: allocations })).status, 400);
    }
    const { month_allocations, ...legacyInput } = input;
    const legacy = await send('/api/partner-spendings', 'POST', { ...legacyInput, invoice_number: 'LEGACY', invoice_month: ['102026'] });
    assert.equal(legacy.status, 200);
    assert.equal(legacy.data.spending.month_allocations, undefined);
    const legacyEdited = await send(`/api/partner-spendings/${legacy.data.spending.id}`, 'PUT', { invoice_description: 'Legacy edit', total_amount_usd: 100 });
    assert.equal(legacyEdited.status, 200);
    assert.equal(legacyEdited.data.spending.month_allocations, undefined);
    const listed = await send('/api/partner-spendings');
    assert.ok(listed.data.some((row: any) => row.id === stored.id && row.invoice_title === 'Updated title'));
  } finally {
    database?.close();
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await rm(directory, { recursive: true, force: true });
  }
});
