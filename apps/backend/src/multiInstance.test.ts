/**
 * Two real server processes against one PostgreSQL database: ids stay unique, a lost update is a 409, parallel edits of different rows
 * all land, reminders are produced once, and changes to the in-memory parts (allowlist, branding, organizations) reach the other instance.
 * The servers are started from source (`node --import tsx src/main.ts`), so no build is needed.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const dirs = [fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-multi-a-')), fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-multi-b-')), fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-multi-t-'))];
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dirs[2], BETTER_AUTH_ENABLE_INFRA: 'false', LOG_LEVEL: 'silent' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { ensureSchema } = await import('./schema');
const { createOrganizationRecord, createTeamRecord, createIdentityRecord, addMembershipRecord } = await import('./organizationProvisioning');
const { hashPassword } = await import('better-auth/crypto');

const freePort = () => new Promise<number>((resolve, reject) => { const s = net.createServer(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });
const PASSWORD = 'Multi-instance-pw-1234';
const ORG = 'org-multi';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
const servers: Array<{ child: ChildProcess; base: string; log: string[] }> = [];
let token = '';
let rootToken = '';

async function start(index: number, port: number) {
  const base = `http://127.0.0.1:${port}`;
  const log: string[] = [];
  const child = spawn('node', ['--import', 'tsx', 'apps/backend/src/main.ts'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, DATABASE_URL: database.url, APP_DATA_DIR: dirs[index], PORT: String(port), API_ONLY: 'true', NODE_ENV: 'development',
      BETTER_AUTH_URL: base, TRUSTED_ORIGINS: servers.map((s) => s.base).concat(base).join(','), BETTER_AUTH_SECRET: 'multi-instance-test-secret-0123456789abcdef',
      SEED_DEMO_ADMIN: 'false', RATE_LIMIT_DISABLED: 'true', GEMINI_API_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_APPLICATION_CREDENTIALS: '',
      SHARED_STATE_POLL_MS: '2000', LOG_LEVEL: 'warn',
    },
  });
  child.stdout?.on('data', (c) => log.push(String(c)));
  child.stderr?.on('data', (c) => log.push(String(c)));
  servers.push({ child, base, log });
  return { child, base, log };
}
async function waitHealthy(s: { child: ChildProcess; base: string; log: string[] }) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (s.child.exitCode !== null) throw new Error(`server exited ${s.child.exitCode}: ${s.log.join('').slice(-2000)}`);
    try { if ((await fetch(`${s.base}/api/health/ready`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server did not become ready: ${s.log.join('').slice(-2000)}`);
}
interface Reply { status: number; body: any; raw: string }
async function api(server: 0 | 1, method: string, route: string, body?: unknown, auth = token): Promise<Reply> {
  const base = servers[server].base;
  const res = await fetch(base + route, {
    method, headers: { 'content-type': 'application/json', origin: base, authorization: `Bearer ${auth}`, 'x-organization-id': ORG },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await res.text();
  let parsed: any = raw;
  try { parsed = JSON.parse(raw); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, raw };
}
const eventually = async <T>(fn: () => Promise<T | undefined | false>, what: string, timeoutMs = 15_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value as T;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
};

before(async () => {
  database = await createTestDatabase();
  await ensureSchema();
  await createOrganizationRecord(sql, { id: ORG, name: 'Multi Org' });
  const hash = await hashPassword(PASSWORD);
  const now = new Date().toISOString();
  for (const [id, platformRole, member] of [['multi-admin', 'user', true], ['multi-root', 'superuser', false]] as const) {
    await createIdentityRecord(sql, { id, name: id, email: `${id}@example.com`, platformRole });
    await sql.run(`INSERT INTO account(id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") VALUES (?, ?, 'credential', ?, ?, ?, ?)`, `acct-${id}`, id, id, hash, now, now);
    if (member) await addMembershipRecord(sql, { userId: id, organizationId: ORG, tenantRole: 'admin', departmentIds: [] });
  }
  void createTeamRecord;
  const ports = [await freePort(), await freePort()];
  // Both processes start at the same moment: startup, migrations check and shared-state setup must not trip over each other.
  const started = [await start(0, ports[0]), await start(1, ports[1])];
  await Promise.all(started.map(waitHealthy));
  const signIn = async (id: string) => {
    const res = await fetch(`${servers[0].base}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: servers[0].base }, body: JSON.stringify({ email: `${id}@example.com`, password: PASSWORD }) });
    const payload = await res.text();
    assert.equal(res.status, 200, payload);
    return (JSON.parse(payload) as any).token as string;
  };
  token = await signIn('multi-admin');
  rootToken = await signIn('multi-root');
});

after(async () => {
  for (const { child } of servers) {
    if (child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), new Promise((r) => setTimeout(r, 8000))]); if (child.exitCode === null) child.kill('SIGKILL'); }
  }
  await database?.drop();
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

test('a session created on one instance is accepted by the other, and a record written on one is read on the other at once', async () => {
  const created = await api(0, 'POST', '/api/partners', { partner_name: 'Written on A', internal_pic: '' });
  assert.equal(created.status, 200, created.raw);
  const onB = await api(1, 'GET', '/api/partners');
  assert.equal(onB.status, 200, onB.raw);
  assert.ok(onB.body.some((p: any) => p.partner_id === created.body.partner.partner_id), 'no snapshot to wait for');
  const updated = await api(1, 'PUT', `/api/partners/${created.body.partner.partner_id}`, { notes: 'edited on B', version: 1 });
  assert.equal(updated.status, 200, updated.raw);
  assert.equal((await api(0, 'GET', '/api/partners')).body.find((p: any) => p.partner_id === created.body.partner.partner_id).notes, 'edited on B');
});

test('concurrent creates on both instances get unique ids and every record is stored once', async () => {
  const total = 24;
  const replies = await Promise.all(Array.from({ length: total }, (_, i) => api((i % 2) as 0 | 1, 'POST', '/api/partners', { partner_name: `Parallel ${i}`, internal_pic: '' })));
  assert.ok(replies.every((r) => r.status === 200), replies.map((r) => r.raw.slice(0, 80)).join(' | '));
  const ids = replies.map((r) => r.body.partner.partner_id);
  assert.equal(new Set(ids).size, total, 'ids are unique across instances');
  const stored = (await api(1, 'GET', '/api/partners')).body.filter((p: any) => p.partner_name.startsWith('Parallel '));
  assert.equal(stored.length, total);
});

test('the same contract number written on both instances at once is accepted once', async () => {
  const partner = (await api(0, 'POST', '/api/partners', { partner_name: 'Numbers', internal_pic: '' })).body.partner;
  const body = (n: number) => ({ partner_id: partner.partner_id, contract_number: 'MULTI-NUMBER-1', contract_title: `Writer ${n}`, start_date: '2026-01-01', end_date: '2099-12-31', currency: 'USD', contract_value: 1 });
  const replies = await Promise.all([0, 1, 0, 1].map((server, n) => api(server as 0 | 1, 'POST', '/api/contracts', body(n))));
  assert.equal(replies.filter((r) => r.status === 200).length, 1, replies.map((r) => `${r.status} ${r.raw.slice(0, 80)}`).join(' | '));
  assert.ok(replies.filter((r) => r.status !== 200).every((r) => [400, 409].includes(r.status)));
});

test('a lost update across instances is a 409; edits of different rows on both instances all land', async () => {
  const partner = (await api(0, 'POST', '/api/partners', { partner_name: 'Race', internal_pic: '' })).body.partner;
  const race = await Promise.all([
    api(0, 'PUT', `/api/partners/${partner.partner_id}`, { notes: 'writer A', version: partner.version }),
    api(1, 'PUT', `/api/partners/${partner.partner_id}`, { notes: 'writer B', version: partner.version }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409], race.map((r) => r.raw.slice(0, 100)).join(' | '));
  assert.equal(race.find((r) => r.status === 409)!.body.code, 'VERSION_CONFLICT');
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push((await api(0, 'POST', '/api/partners', { partner_name: `Different ${i}`, internal_pic: '' })).body.partner);
  const replies = await Promise.all(rows.map((row, i) => api((i % 2) as 0 | 1, 'PUT', `/api/partners/${row.partner_id}`, { notes: `edit ${i}`, version: row.version })));
  assert.deepEqual(replies.map((r) => r.status), [200, 200, 200, 200, 200, 200]);
});

test('reminders are queued once even when both instances run a pass at the same time', async () => {
  const partner = (await api(0, 'POST', '/api/partners', { partner_name: 'Reminders', internal_pic: '' })).body.partner;
  const settings = await sql.get<{ payload: string }>(`SELECT payload FROM organization_settings WHERE "organizationId" = ?`, ORG);
  const offsets: number[] = JSON.parse(settings!.payload).policy?.reminderOffsetsDays ?? [30];
  const due = new Date(Date.now() + Math.max(...offsets) * 86_400_000).toISOString().slice(0, 10);
  for (let i = 0; i < 4; i++) {
    const created = await api(0, 'POST', '/api/contracts', { partner_id: partner.partner_id, contract_number: `REM-${i}`, contract_title: `Due ${i}`, start_date: '2020-01-01', end_date: due, currency: 'USD', contract_value: 1 });
    assert.equal(created.status, 200, created.raw);
  }
  // While one process holds the reminder lock (here: this test), no instance runs a pass.
  const { withAdvisoryLock } = await import('./db');
  const { REMINDER_LOCK_KEY } = await import('./reminders');
  const held = await withAdvisoryLock(REMINDER_LOCK_KEY, async () => Promise.all([0, 1].map((server) => api(server as 0 | 1, 'POST', '/api/cron/trigger-check', {}, rootToken))));
  assert.ok(held.ran);
  assert.deepEqual(held.value!.map((r) => r.status), [202, 202], 'both instances refuse while the lock is held');
  assert.equal(Number((await sql.get(`SELECT COUNT(*) AS n FROM notifications WHERE organization_id = ?`, ORG))!.n), 0);
  const passes = await Promise.all([api(0, 'POST', '/api/cron/trigger-check', {}, rootToken), api(1, 'POST', '/api/cron/trigger-check', {}, rootToken), api(0, 'POST', '/api/cron/trigger-check', {}, rootToken), api(1, 'POST', '/api/cron/trigger-check', {}, rootToken)]);
  assert.ok(passes.every((r) => [200, 202].includes(r.status)), passes.map((r) => r.raw.slice(0, 100)).join(' | '));
  const count = async () => Number((await sql.get(`SELECT COUNT(*) AS n FROM notifications WHERE parent_id LIKE 'C%' AND organization_id = ?`, ORG))!.n);
  const first = await count();
  assert.ok(first >= 4, `at least one reminder per contract, got ${first}`);
  assert.equal(first, Number((await sql.get(`SELECT COUNT(*) AS n FROM reminder_ledger WHERE notification_id IS NOT NULL AND organization_id = ?`, ORG))!.n), 'one notification per ledger entry');
  assert.equal((await sql.get(`SELECT COUNT(*) AS n FROM (SELECT record_id, cycle_end_date, trigger, offset_days FROM reminder_ledger WHERE organization_id = ? GROUP BY 1,2,3,4 HAVING COUNT(*) > 1) d`, ORG))!.n, 0, 'no reminder twice');
  await api(1, 'POST', '/api/cron/trigger-check', {}, rootToken);
  await api(0, 'POST', '/api/cron/trigger-check', {}, rootToken);
  assert.equal(await count(), first, 'later passes add nothing');
});

test('the allowlist is shared: an entry added on one instance is listed by the other', async () => {
  const added = await api(0, 'POST', '/api/user/allowed-users', { email: 'Shared.Person@example.com', name: 'Shared Person', role: 'Editor', adminEmail: 'multi-admin@example.com', adminName: 'multi-admin' }, rootToken);
  assert.equal(added.status, 200, added.raw);
  const listed = await api(1, 'GET', '/api/user/allowed-users', undefined, rootToken);
  assert.ok(listed.body.some((u: any) => u.email === 'shared.person@example.com'));
  const removed = await api(1, 'DELETE', `/api/user/allowed-users/${added.body.user.id}?adminEmail=multi-root@example.com`, undefined, rootToken);
  assert.ok([200, 400].includes(removed.status), removed.raw);
});

test('configuration changed on one instance (branding, an organization\'s name) reaches the other without a restart', async () => {
  const branding = await api(0, 'POST', '/api/branding', { appName: 'Renamed By A' }, rootToken);
  assert.equal(branding.status, 200, branding.raw);
  await eventually(async () => (await api(1, 'GET', '/api/branding', undefined, rootToken)).body?.branding?.appName === 'Renamed By A', 'branding on instance B');
  const org = await api(0, 'PUT', `/api/tenants/${ORG}`, { name: 'Multi Org Renamed' }, rootToken);
  assert.equal(org.status, 200, org.raw);
  await eventually(async () => (await api(1, 'GET', '/api/tenants', undefined, rootToken)).body?.tenants?.some?.((t: any) => t.id === ORG && t.name === 'Multi Org Renamed')
    || (await api(1, 'GET', '/api/tenants', undefined, rootToken)).raw.includes('Multi Org Renamed'), 'the organization name on instance B');
  // And the other way round, so neither instance is special.
  assert.equal((await api(1, 'POST', '/api/branding', { appName: 'Renamed By B' }, rootToken)).status, 200);
  await eventually(async () => (await api(0, 'GET', '/api/branding', undefined, rootToken)).body?.branding?.appName === 'Renamed By B', 'branding on instance A');
});
