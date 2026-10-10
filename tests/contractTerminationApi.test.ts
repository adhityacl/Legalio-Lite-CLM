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
import { todayInTimezone } from '@legalio/shared/policy';

test('contract API persists termination date, separate document and reason; rejects invalid writes and preserves evidence', { timeout: 90_000 }, async () => {
  const root = resolve('.');
  const directory = await mkdtemp(join(tmpdir(), 'contract-termination-api-'));
  let child: ReturnType<typeof spawn> | undefined;
  let database: Database.Database | undefined;
  let logs = '';
  try {
    await build({ entryPoints: [join(root, 'apps/backend/src/server.ts')], bundle: true, platform: 'node', format: 'cjs', packages: 'external', alias: { '@legalio/shared': resolve(root, 'packages/shared/src'), '@legalio/types': resolve(root, 'packages/types/src') }, outfile: join(directory, 'server.cjs'), logLevel: 'silent' });
    const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    const launch = async () => {
      logs = '';
      child = spawn(process.execPath, [join(directory, 'server.cjs')], { cwd: directory,
        env: { AUTH_DB_PATH: join(directory, 'auth.db'), APP_DATA_DIR: directory, PATH: process.env.PATH, NODE_PATH: join(root, 'node_modules'), API_ONLY: 'true', PORT: String(port), SEED_DEMO_ADMIN: 'false', BETTER_AUTH_SECRET: 'isolated-contract-termination-test-32-characters' }, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout!.on('data', chunk => { logs += chunk.toString(); });
      child.stderr!.on('data', chunk => { logs += chunk.toString(); });
      const deadline = Date.now() + 45_000;
      while (!logs.includes('Server running on')) {
        assert.equal(child.exitCode, null, logs); assert.ok(Date.now() < deadline, logs);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    };
    await launch();
    database = new Database(join(directory, 'auth.db'));
    const now = new Date().toISOString();
    const token = 'contract-termination-api-test-token';
    database.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt,role,banned) VALUES (?,?,?,?,?,?,?,?)').run('termination-test', 'Termination Test', 'termination@example.test', 1, now, now, 'superuser', 0);
    database.prepare('INSERT INTO session (id,expiresAt,token,createdAt,updatedAt,userId) VALUES (?,?,?,?,?,?)').run('termination-session', new Date(Date.now() + 300_000).toISOString(), token, now, now, 'termination-test');
    const base = `http://127.0.0.1:${port}`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-organization-id': 'org-demo-bmd' };
    const send = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, data: await response.json() };
    };
    const workspace = await send('/api/init-data');
    const today = todayInTimezone('Asia/Jakarta');
    const futureEnd = `${Number(today.slice(0, 4)) + 1}-12-31`;
    const input = { nomor_kontrak: 'TERMINATION-API-TEST', judul_kontrak: 'Termination API test', partner_id: workspace.data.partners[0].partner_id,
      tanggal_mulai: '2020-01-01', tanggal_berakhir: futureEnd, currency: 'USD', nilai_kontrak: 100, auto_renewal: true,
      lifecycle_mode: 'terminated', termination_date: today, termination_reason: 'Mutual agreement',
      fileName: 'original-contract.pdf', fileData: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\noriginal contract').toString('base64'),
      termination_document_file: { fileName: 'notice.pdf', fileData: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\ntermination notice').toString('base64') } };
    const added = await send('/api/contracts', 'POST', input);
    assert.equal(added.status, 200, JSON.stringify(added.data));
    const contract = added.data.contract;
    assert.equal(contract.status, 'Terminated');
    assert.equal(contract.auto_renewal, false);
    assert.equal(contract.termination_date, today);
    assert.equal(contract.tanggal_berakhir, futureEnd);
    assert.equal(contract.termination_document.fileName, 'notice.pdf');
    assert.ok(contract.termination_document.url.startsWith('/uploads/'));
    assert.notEqual(contract.termination_document.url, contract.link_file_kontrak);
    assert.equal(contract.termination_document_file, undefined);
    const evidence = await fetch(base + contract.termination_document.url, { headers });
    assert.equal(evidence.status, 200);
    assert.match(await evidence.text(), /termination notice/);
    assert.equal((await fetch(base + contract.termination_document.url)).status, 401);
    const edited = await send(`/api/contracts/${contract.contract_id}`, 'PUT', { termination_reason: 'Updated reason' });
    assert.equal(edited.status, 200);
    assert.deepEqual(edited.data.contract.termination_document, contract.termination_document);
    assert.equal((await send(`/api/contracts/${contract.contract_id}`, 'PUT', { termination_date: '2026-02-30' })).status, 400);
    assert.equal((await send(`/api/contracts/${contract.contract_id}`, 'PUT', { termination_document_file: { fileName: 'notice.pdf', fileData: 'data:application/pdf;base64,aHRtbA==' } })).status, 400);
    const payload = JSON.parse((database.prepare('SELECT payload FROM contracts WHERE id = ?').get(contract.contract_id) as { payload: string }).payload);
    assert.equal(payload.termination_reason, 'Updated reason');
    assert.deepEqual(payload.termination_document, contract.termination_document);
    const scheduled = await send(`/api/contracts/${contract.contract_id}`, 'PUT', { termination_date: futureEnd });
    assert.equal(scheduled.data.contract.status, 'Active');
    assert.equal(scheduled.data.contract.lifecycle_mode, 'terminated');
    const expired = await send(`/api/contracts/${contract.contract_id}`, 'PUT', { lifecycle_mode: 'normal', tanggal_berakhir: '2021-12-31' });
    assert.equal(expired.data.contract.status, 'Expired');
    assert.equal(expired.data.contract.termination_date, null);
    assert.deepEqual(expired.data.contract.termination_document, contract.termination_document);
    child!.kill('SIGTERM'); await once(child!, 'exit');
    await launch();
    const reloaded = await send('/api/contracts');
    const saved = reloaded.data.find((record: { contract_id: string }) => record.contract_id === contract.contract_id);
    assert.equal(saved.status, 'Expired');
    assert.equal(saved.termination_reason, 'Updated reason');
    assert.deepEqual(saved.termination_document, contract.termination_document);
  } finally {
    database?.close();
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await rm(directory, { recursive: true, force: true });
  }
});
