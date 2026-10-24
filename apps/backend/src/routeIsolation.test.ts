/**
 * HTTP-level isolation and RBAC suite on real PostgreSQL: two organizations, real sessions (Better Auth sign-in),
 * the real Express app with its authorization middleware.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-isolation-'));
const ORIGIN = 'http://localhost:3000';
Object.assign(process.env, {
  APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_URL: ORIGIN, TRUSTED_ORIGINS: ORIGIN, BETTER_AUTH_ENABLE_INFRA: 'false',
  BETTER_AUTH_SECRET: 'isolation-test-secret-0123456789abcdef', SEED_DEMO_ADMIN: 'false', RATE_LIMIT_DISABLED: 'true', LOG_LEVEL: 'silent',
  GEMINI_API_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_APPLICATION_CREDENTIALS: '',
});
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { ensureSchema } = await import('./schema');
const { createOrganizationRecord, createTeamRecord, createIdentityRecord, addMembershipRecord } = await import('./organizationProvisioning');
const { hashPassword } = await import('better-auth/crypto');

const PASSWORD = 'Isolation-test-pw-1234';
const A = 'org-a';
const B = 'org-b';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let server: Server;
let serverModule: typeof import('./server');
let base = '';
const tokens: Record<string, string> = {};
const teams: Record<string, string> = {};

const USERS: Array<[key: string, org: string | null, role: 'admin' | 'manager' | 'editor' | 'viewer' | 'superuser', team?: string]> = [
  ['rootA', null, 'superuser'],
  ['adminA', A, 'admin'],
  ['salesEditorA', A, 'editor', 'sales'],
  ['legalEditorA', A, 'editor', 'legal'],
  ['salesViewerA', A, 'viewer', 'sales'],
  ['viewerA', A, 'viewer'],
  ['adminB', B, 'admin'],
  ['editorB', B, 'editor', 'sales-b'],
];

before(async () => {
  database = await createTestDatabase();
  await ensureSchema();
  await createOrganizationRecord(sql, { id: A, name: 'Org A' });
  await createOrganizationRecord(sql, { id: B, name: 'Org B' });
  teams.sales = await createTeamRecord(sql, A, 'Sales');
  teams.legal = await createTeamRecord(sql, A, 'Legal');
  teams['sales-b'] = await createTeamRecord(sql, B, 'Sales');
  const hash = await hashPassword(PASSWORD);
  const now = new Date().toISOString();
  for (const [key, org, role, team] of USERS) {
    const email = `${key.toLowerCase()}@example.com`;
    await createIdentityRecord(sql, { id: key, name: key, email, platformRole: role === 'superuser' ? 'superuser' : 'user' });
    await sql.run(`INSERT INTO account(id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") VALUES (?, ?, 'credential', ?, ?, ?, ?)`, `acct-${key}`, key, key, hash, now, now);
    if (org && role !== 'superuser') await addMembershipRecord(sql, { userId: key, organizationId: org, tenantRole: role, departmentIds: team ? [teams[team]] : [] });
  }
  serverModule = await import('./server');
  await serverModule.init();
  server = serverModule.app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const [key] of USERS) {
    const res = await fetch(`${base}/api/auth/sign-in/email`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email: `${key.toLowerCase()}@example.com`, password: PASSWORD }),
    });
    assert.equal(res.status, 200, `sign-in ${key}`);
    tokens[key] = ((await res.json()) as any).token;
    assert.ok(tokens[key], key);
  }
});

after(async () => {
  await new Promise<void>((resolve) => { server?.closeAllConnections?.(); server?.close(() => resolve()); });
  await serverModule?.drain();
  await database?.drop();
  fs.rmSync(dir, { recursive: true, force: true });
});

interface Reply { status: number; body: any; raw: string; headers: Headers }
async function api(user: string, method: string, route: string, options: { org?: string; body?: unknown } = {}): Promise<Reply> {
  const res = await fetch(base + route, {
    method,
    headers: {
      'content-type': 'application/json', origin: ORIGIN, authorization: `Bearer ${tokens[user]}`,
      ...(options.org ? { 'x-organization-id': options.org } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const raw = await res.text();
  let body: any = raw;
  try { body = JSON.parse(raw); } catch { /* not JSON */ }
  return { status: res.status, body, raw, headers: res.headers };
}
const ok = (reply: Reply, expected = 200) => { assert.equal(reply.status, expected, reply.raw.slice(0, 300)); return reply.body; };
const denied = (reply: Reply, allowed: number[] = [403, 404]) => assert.ok(allowed.includes(reply.status), `expected ${allowed.join('/')} got ${reply.status}: ${reply.raw.slice(0, 200)}`);
const pdf = () => 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 isolation').toString('base64');

/* One record of each kind per scenario. Sales/Legal partners differ by internal_pic (the department). */
interface Fixture { partner: any; contract: any; io: any; spending: any; evaluation: any }
async function seed(org: string, user: string, tag: string, department: string): Promise<Fixture> {
  const partner = ok(await api(user, 'POST', '/api/partners', { org, body: { partner_name: `Partner ${tag}`, internal_pic: department, country: 'ID' } })).partner;
  const contract = ok(await api(user, 'POST', '/api/contracts', { org, body: {
    partner_id: partner.partner_id, contract_number: `CTR-${tag}`, contract_title: `Contract ${tag}`, start_date: '2026-01-01', end_date: '2099-12-31',
    currency: 'USD', contract_value: 100, internal_pic: department, fileName: `${tag}.pdf`, fileData: pdf(),
  } })).contract;
  const io = ok(await api(user, 'POST', '/api/ios', { org, body: {
    partner_id: partner.partner_id, contract_id: contract.contract_id, io_number: `IO-${tag}`, io_title: `IO ${tag}`, start_date: '2026-01-01', end_date: '2099-12-31',
    currency: 'USD', io_value: 10, pricing_model: 'Fixed', charging_type: 'Postpaid', media_channel: 'Digital',
  } })).io;
  const spending = ok(await api(user, 'POST', '/api/partner-spendings', { org, body: {
    vendor_id: partner.partner_id, vendor_name: partner.partner_name, invoice_number: `INV-${tag}`, invoice_date: '2026-10-01', invoice_month: ['2026-10-31'], currency: 'USD', total_amount: 5,
  } })).spending;
  const evaluation = ok(await api(user, 'POST', '/api/partner-evaluations', { org, body: {
    partner_id: partner.partner_id, supplier_name: partner.partner_name, review_date: '2026-10-01', obligation_target: 'Sangat baik', incident_frequency: 'Never',
    communication: 'Sangat baik', pricing: 'Moderate', final_evaluation: 'Recommended',
  } })).evaluation;
  return { partner, contract, io, spending, evaluation };
}

const ENTITIES = [
  { name: 'partners', list: '/api/partners', item: (f: Fixture) => ({ id: f.partner.partner_id, key: 'partner_id', route: `/api/partners/${f.partner.partner_id}`, put: { notes: 'hijack' } }) },
  { name: 'contracts', list: '/api/contracts', item: (f: Fixture) => ({ id: f.contract.contract_id, key: 'contract_id', route: `/api/contracts/${f.contract.contract_id}`, put: { contract_title: 'hijack' } }) },
  { name: 'ios', list: '/api/ios', item: (f: Fixture) => ({ id: f.io.io_id, key: 'io_id', route: `/api/ios/${f.io.io_id}`, put: { io_title: 'hijack' } }) },
  { name: 'spendings', list: '/api/partner-spendings', item: (f: Fixture) => ({ id: f.spending.id, key: 'id', route: `/api/partner-spendings/${f.spending.id}`, put: { invoice_title: 'hijack' } }) },
  { name: 'evaluations', list: '/api/partner-evaluations', item: (f: Fixture) => ({ id: f.evaluation.id, key: 'id', route: `/api/partner-evaluations/${f.evaluation.id}`, put: { notes: 'hijack' } }) },
];

let fixtureA: Fixture;
let fixtureLegal: Fixture;
let fixtureB: Fixture;
let documentA = '';
let approvalA = '';

test('setup: records in both organizations and in two departments of organization A', async () => {
  fixtureA = await seed(A, 'adminA', 'A1', 'Sales');
  fixtureLegal = await seed(A, 'adminA', 'A2', 'Legal');
  fixtureB = await seed(B, 'adminB', 'B1', 'Sales');
  documentA = ok(await api('adminA', 'POST', '/api/documents', { org: A, body: { name: 'Doc A', content: '<p>secret A</p>' } }), 201).id;
  approvalA = ok(await api('adminA', 'POST', '/api/approvals', { org: A, body: { title: 'Approve A', approverIds: ['salesEditorA'], file: { name: 'a.pdf', base64: Buffer.from('%PDF-1.4 approval').toString('base64') }, category: 'contract' } }), 201).id;
  assert.ok(fixtureA.contract.contract_file_link?.startsWith('/uploads/'));
});

for (const entity of ENTITIES) {
  test(`${entity.name}: organization B cannot list, update or delete organization A records`, async () => {
    const target = entity.item(fixtureA);
    const listB = ok(await api('adminB', 'GET', entity.list, { org: B }));
    assert.ok(!listB.some((row: any) => row[target.key] === target.id), 'A record leaked into B list');
    assert.ok(!JSON.stringify(listB).includes('Partner A1'), 'A data leaked into B list');
    // Through B's own organization the id does not exist.
    denied(await api('adminB', 'PUT', target.route, { org: B, body: target.put }), [404]);
    denied(await api('adminB', 'DELETE', target.route, { org: B }), [404]);
    // Naming A's organization requires membership of A.
    denied(await api('adminB', 'GET', entity.list, { org: A }), [403, 404]);
    denied(await api('adminB', 'PUT', target.route, { org: A, body: target.put }), [403, 404]);
    denied(await api('adminB', 'DELETE', target.route, { org: A }), [403, 404]);
    // Still intact and unchanged for A.
    const listA = ok(await api('adminA', 'GET', entity.list, { org: A }));
    const row = listA.find((r: any) => r[target.key] === target.id);
    assert.ok(row, 'record disappeared');
    assert.ok(!JSON.stringify(row).includes('hijack'));
  });

  test(`${entity.name}: a viewer can read but not create, update or delete`, async () => {
    const target = entity.item(fixtureA);
    ok(await api('viewerA', 'GET', entity.list, { org: A }));
    denied(await api('viewerA', 'PUT', target.route, { org: A, body: target.put }), [403]);
    denied(await api('viewerA', 'DELETE', target.route, { org: A }), [403]);
    denied(await api('viewerA', 'POST', entity.list, { org: A, body: { partner_name: 'x', supplier_name: 'x', vendor_name: 'x', invoice_number: 'x', total_amount: 1 } }), [403]);
  });

  test(`${entity.name}: department scope hides and protects other departments' records`, async () => {
    const legal = entity.item(fixtureLegal);
    const sales = entity.item(fixtureA);
    const salesList = ok(await api('salesEditorA', 'GET', entity.list, { org: A }));
    assert.ok(salesList.some((r: any) => r[sales.key] === sales.id), 'own department record missing');
    assert.ok(!salesList.some((r: any) => r[legal.key] === legal.id), 'other department record visible');
    denied(await api('salesEditorA', 'PUT', legal.route, { org: A, body: legal.put }), [404]);
    denied(await api('salesEditorA', 'DELETE', legal.route, { org: A }), [404]);
    const adminList = ok(await api('adminA', 'GET', entity.list, { org: A }));
    assert.ok(adminA_sees(adminList, legal.key, legal.id), 'organization admin sees every department');
  });
}
const adminA_sees = (rows: any[], key: string, id: string) => rows.some((r) => r[key] === id);

test('department-scoped editors cannot create records that belong to another department', async () => {
  denied(await api('salesEditorA', 'POST', '/api/partners', { org: A, body: { partner_name: 'Legal-owned', internal_pic: 'Legal' } }), [403]);
  ok(await api('salesEditorA', 'POST', '/api/partners', { org: A, body: { partner_name: 'Sales-owned', internal_pic: 'Sales' } }));
  denied(await api('salesEditorA', 'POST', '/api/contracts', { org: A, body: {
    partner_id: fixtureLegal.partner.partner_id, contract_number: 'CTR-SNEAK', contract_title: 'Sneak', start_date: '2026-01-01', end_date: '2099-12-31', currency: 'USD', contract_value: 1,
  } }), [400, 403]);
});

test('a department viewer reads only their own department; a viewer without a department sees nothing', async () => {
  const sales = ok(await api('salesViewerA', 'GET', '/api/partners', { org: A }));
  assert.ok(sales.some((p: any) => p.partner_id === fixtureA.partner.partner_id));
  assert.ok(!sales.some((p: any) => p.partner_id === fixtureLegal.partner.partner_id));
  assert.equal(ok(await api('viewerA', 'GET', '/api/partners', { org: A })).length, 0);
});

test('aggregate reads (init-data, search, notifications) never include another organization', async () => {
  const init = ok(await api('adminB', 'GET', '/api/init-data', { org: B }));
  const dump = JSON.stringify(init);
  for (const needle of ['Partner A1', 'Partner A2', 'CTR-A1', 'IO-A1', 'INV-A1']) assert.ok(!dump.includes(needle), `${needle} leaked via init-data`);
  const search = ok(await api('adminB', 'GET', '/api/search?q=Partner', { org: B }));
  assert.ok(!JSON.stringify(search).includes('Partner A'), 'search leaked another organization');
  assert.ok(JSON.stringify(search).includes('Partner B1'));
});

test('documents: other organizations get 404 on read, update, delete and every sub-resource', async () => {
  for (const [method, route, body] of [
    ['GET', `/api/documents/${documentA}`], ['PATCH', `/api/documents/${documentA}`, { name: 'hijack' }], ['DELETE', `/api/documents/${documentA}`],
    ['GET', `/api/documents/${documentA}/drafts`], ['POST', `/api/documents/${documentA}/drafts`, { content: 'x' }],
    ['GET', `/api/documents/${documentA}/comments`], ['GET', `/api/documents/${documentA}/metadata`], ['PUT', `/api/documents/${documentA}/metadata`, { values: {} }],
  ] as Array<[string, string, unknown?]>) {
    denied(await api('adminB', method, route, { org: B, body }), [404]);
    denied(await api('adminB', method, route, { org: A, body }), [403, 404]);
  }
  const listB = ok(await api('adminB', 'GET', '/api/documents', { org: B }));
  assert.ok(!listB.documents.some((d: any) => d.id === documentA));
  assert.equal(ok(await api('adminA', 'GET', `/api/documents/${documentA}`, { org: A })).name, 'Doc A');
  denied(await api('viewerA', 'PATCH', `/api/documents/${documentA}`, { org: A, body: { name: 'viewer edit' } }), [403]);
  denied(await api('viewerA', 'DELETE', `/api/documents/${documentA}`, { org: A }), [403]);
  denied(await api('viewerA', 'POST', '/api/documents', { org: A, body: { name: 'viewer doc' } }), [403]);
});

test('approvals: other organizations and uninvolved members get 404; viewers cannot submit', async () => {
  for (const [method, route, body] of [
    ['GET', `/api/approvals/${approvalA}`], ['GET', `/api/approvals/${approvalA}/file`], ['DELETE', `/api/approvals/${approvalA}`],
    ['POST', `/api/approvals/${approvalA}/decision`, { decision: 'approve' }],
  ] as Array<[string, string, unknown?]>) {
    denied(await api('adminB', method, route, { org: B, body }), [404]);
    denied(await api('adminB', method, route, { org: A, body }), [403, 404]);
    denied(await api('legalEditorA', method, route, { org: A, body }), [404]);
  }
  assert.ok(!ok(await api('adminB', 'GET', '/api/approvals', { org: B })).items.some((i: any) => i.id === approvalA));
  assert.equal(ok(await api('adminA', 'GET', `/api/approvals/${approvalA}`, { org: A })).id, approvalA);
  denied(await api('viewerA', 'POST', '/api/approvals', { org: A, body: { title: 'x', approverIds: ['adminA'], category: 'contract', file: { name: 'a.pdf', base64: 'AAAA' } } }), [403]);
  // An approver can never come from another organization.
  const crossApprover = await api('adminA', 'POST', '/api/approvals', { org: A, body: { title: 'x', approverIds: ['adminB'], category: 'contract', file: { name: 'a.pdf', base64: Buffer.from('%PDF-1.4').toString('base64') } } });
  assert.equal(crossApprover.status, 400);
});

test('uploads: files are served only to members who can see the owning record', async () => {
  const link = fixtureA.contract.contract_file_link as string;
  const get = async (user: string) => (await fetch(base + link, { headers: { authorization: `Bearer ${tokens[user]}`, 'x-organization-id': A } })).status;
  assert.equal(await get('adminA'), 200);
  assert.equal(await get('salesEditorA'), 200);
  assert.equal(await get('salesViewerA'), 200);
  assert.equal(await get('legalEditorA'), 404, 'other department');
  assert.equal(await get('viewerA'), 404, 'no department');
  assert.equal(await get('adminB'), 404, 'other organization');
  assert.equal(await get('editorB'), 404, 'other organization');
  assert.equal((await fetch(base + link)).status, 401);
  // A record in B that merely contains A's path string must not grant access (server-written ownership).
  const sneaky = await api('adminB', 'PUT', `/api/contracts/${fixtureB.contract.contract_id}`, { org: B, body: { internal_notes: link, contract_file_link: link } });
  ok(sneaky);
  assert.equal(await (async () => (await fetch(base + link, { headers: { authorization: `Bearer ${tokens.adminB}` } })).status)(), 404);
});

test('mass assignment: the client cannot rewrite ids, ownership, timestamps, file links or derived fields', async () => {
  const before = fixtureA.contract;
  const updated = ok(await api('adminA', 'PUT', `/api/contracts/${before.contract_id}`, { org: A, body: {
    contract_title: 'Renamed', contract_id: 'C9999', created_at: '2000-01-01T00:00:00.000Z', created_by: 'attacker',
    contract_file_link: '/uploads/someone/elses.pdf', days_remaining: 999999, status_approval: 'Signed', termination_document: { url: '/uploads/x' },
    userEmail: 'forged@example.com', userRole: 'Admin',
  } })).contract;
  assert.equal(updated.contract_title, 'Renamed');
  assert.equal(updated.contract_id, before.contract_id);
  assert.equal(updated.organizationId, A);
  assert.equal(updated.created_at, before.created_at);
  assert.equal(updated.contract_file_link, before.contract_file_link);
  assert.notEqual(updated.days_remaining, 999999);
  assert.equal(updated.status_approval, before.status_approval);
  assert.equal('created_by' in updated, false);
  // A body that names another organization is refused outright by the route policy.
  const conflict = await api('adminA', 'PUT', `/api/contracts/${before.contract_id}`, { org: A, body: { contract_title: 'x', organizationId: B } });
  assert.equal(conflict.status, 400);
  assert.equal(conflict.body.code, 'ORGANIZATION_SELECTOR_CONFLICT');
  assert.equal((await api('adminA', 'GET', '/api/contracts', { org: A })).body.filter((c: any) => c.contract_id === 'C9999').length, 0);
  const spendingUpdated = ok(await api('adminA', 'PUT', `/api/partner-spendings/${fixtureA.spending.id}`, { org: A, body: {
    invoice_title: 'T', id: 'SP9999', invoice_file_url: '/uploads/other.pdf', folder_link: 'http://evil',
  } })).spending;
  assert.equal(spendingUpdated.id, fixtureA.spending.id);
  assert.equal(spendingUpdated.organizationId, A);
  assert.notEqual(spendingUpdated.invoice_file_url, '/uploads/other.pdf');
  assert.equal(spendingUpdated.folder_link, fixtureA.spending.folder_link);
  const evaluation = ok(await api('adminA', 'PUT', `/api/partner-evaluations/${fixtureA.evaluation.id}`, { org: A, body: { notes: 'n', evaluator_email: 'forged@example.com', id: 'EVAL-X' } })).evaluation;
  assert.equal(evaluation.evaluator_email, 'adminA@example.com'.toLowerCase());
  assert.equal(evaluation.id, fixtureA.evaluation.id);
});

test('identity comes from the session: forged userEmail/userName/userRole are ignored', async () => {
  const created = ok(await api('adminA', 'POST', '/api/partner-evaluations', { org: A, body: {
    partner_id: fixtureA.partner.partner_id, supplier_name: 'Forge', review_date: '2026-10-02', obligation_target: 'Baik', incident_frequency: 'Rare', communication: 'Baik', pricing: 'Cheap',
    final_evaluation: 'Recommended', userEmail: 'forged@example.com', userName: 'Forged Name', userRole: 'Superuser',
  } })).evaluation;
  assert.equal(created.evaluator_email, 'admina@example.com');
  assert.equal(created.evaluator_name, 'adminA');
  const logs = ok(await api('adminA', 'GET', '/api/activity-logs', { org: A }));
  const rows = Array.isArray(logs) ? logs : logs.items || logs.logs || [];
  assert.ok(rows.length > 0);
  assert.ok(!JSON.stringify(rows).includes('forged@example.com'));
  assert.ok(!JSON.stringify(rows).includes('Forged Name'));
});

test('cross-tenant references on create are refused and never described', async () => {
  // Partner of A used from B: contract create must not find it.
  const contract = await api('adminB', 'POST', '/api/contracts', { org: B, body: {
    partner_id: fixtureA.partner.partner_id, contract_number: 'CTR-X', contract_title: 'x', start_date: '2026-01-01', end_date: '2099-12-31', currency: 'USD', contract_value: 1,
  } });
  assert.equal(contract.status, 400);
  assert.ok(!contract.raw.includes('Partner A1'));
  const io = await api('adminB', 'POST', '/api/ios', { org: B, body: {
    partner_id: fixtureA.partner.partner_id, io_number: 'IO-X', io_title: 'x', start_date: '2026-01-01', end_date: '2099-12-31', pricing_model: 'Fixed', charging_type: 'Postpaid', currency: 'USD', io_value: 1,
  } });
  assert.equal(io.status, 400);
  // A spending in B whose vendor name equals A's partner must not link to A's partner nor leak its folder.
  const created = ok(await api('adminB', 'POST', '/api/partner-spendings', { org: B, body: {
    vendor_name: fixtureA.partner.partner_name, invoice_number: 'INV-X', invoice_date: '2026-10-01', currency: 'USD', total_amount: 1,
  } })).spending;
  assert.notEqual(created.vendor_id, fixtureA.partner.partner_id);
  assert.equal(created.folder_link, undefined);
  // An IO of B pointing at A's contract: refused by the composite foreign key, never accepted, nothing of A's described.
  const badIo = await api('adminB', 'POST', '/api/ios', { org: B, body: {
    partner_id: fixtureB.partner.partner_id, contract_id: fixtureA.contract.contract_id, io_number: 'IO-Y', io_title: 'y', start_date: '2026-01-01', end_date: '2099-12-31', pricing_model: 'Fixed', charging_type: 'Postpaid', currency: 'USD', io_value: 1,
  } });
  assert.ok([400, 409].includes(badIo.status), badIo.raw.slice(0, 200));
  assert.ok(!badIo.raw.includes('CTR-A1'));
  const dup = await api('adminB', 'PUT', `/api/contracts/${fixtureB.contract.contract_id}`, { org: B, body: { contract_number: 'CTR-A1' } });
  assert.equal(dup.status, 200, 'a contract number used in another organization is not a duplicate here');
});

test('validation errors use the unified error shape', async () => {
  const reply = await api('adminA', 'POST', '/api/contracts', { org: A, body: { contract_number: 'only-number' } });
  assert.equal(reply.status, 400);
  for (const key of ['error', 'code', 'message', 'status', 'requestId']) assert.ok(key in reply.body, key);
  assert.equal(reply.body.code, 'VALIDATION_FAILED');
  const type = await api('adminA', 'PUT', `/api/partners/${fixtureA.partner.partner_id}`, { org: A, body: { notes: { $gt: '' } } });
  assert.equal(type.status, 400);
  assert.equal(type.body.code, 'VALIDATION_FAILED');
});

test('unknown API routes are denied by default', async () => {
  const reply = await api('adminA', 'GET', '/api/not-a-real-route', { org: A });
  assert.equal(reply.status, 404);
  const unauth = await fetch(`${base}/api/partners`);
  assert.equal(unauth.status, 401);
  const noOrgMember = await api('rootA', 'GET', '/api/partners', {});
  assert.ok([400, 409].includes(noOrgMember.status), `superuser without a selected organization: ${noOrgMember.status}`);
});

/* ------------------------------ contract persistence (repository) ------------------------------ */

test('contracts carry a version; concurrent edits of one contract never lose an update (409 VERSION_CONFLICT)', async () => {
  const created = ok(await api('adminA', 'POST', '/api/contracts', { org: A, body: {
    partner_id: fixtureA.partner.partner_id, contract_number: 'CTR-CONC', contract_title: 'Concurrent', start_date: '2026-01-01', end_date: '2099-12-31', currency: 'USD', contract_value: 1, internal_pic: 'Sales',
  } })).contract;
  assert.equal(created.version, 1);
  const race = await Promise.all([
    api('adminA', 'PUT', `/api/contracts/${created.contract_id}`, { org: A, body: { contract_title: 'Writer one', version: created.version } }),
    api('adminA', 'PUT', `/api/contracts/${created.contract_id}`, { org: A, body: { contract_title: 'Writer two', version: created.version } }),
  ]);
  const statuses = race.map((reply) => reply.status).sort();
  assert.deepEqual(statuses, [200, 409], race.map((r) => r.raw.slice(0, 120)).join(' | '));
  const loser = race.find((reply) => reply.status === 409)!;
  assert.equal(loser.body.code, 'VERSION_CONFLICT');
  for (const key of ['error', 'code', 'message', 'status', 'requestId']) assert.ok(key in loser.body, key);
  const winner = race.find((reply) => reply.status === 200)!.body.contract;
  assert.equal(winner.version, 2);
  const stored = ok(await api('adminA', 'GET', '/api/contracts', { org: A })).find((c: any) => c.contract_id === created.contract_id);
  assert.equal(stored.contract_title, winner.contract_title);
  assert.equal(stored.version, 2);
  // A client that kept the old copy is told so, even long after the race.
  const stale = await api('adminA', 'PUT', `/api/contracts/${created.contract_id}`, { org: A, body: { contract_title: 'Old copy', version: 1 } });
  assert.equal(stale.status, 409);
  // A client without a version is still protected inside its own request and simply overwrites the current row.
  assert.equal((await api('adminA', 'PUT', `/api/contracts/${created.contract_id}`, { org: A, body: { contract_title: 'No version' } })).status, 200);
});

test('concurrent edits of different contracts all succeed', async () => {
  const made = [];
  for (const n of [1, 2, 3, 4]) {
    made.push(ok(await api('adminA', 'POST', '/api/contracts', { org: A, body: {
      partner_id: fixtureA.partner.partner_id, contract_number: `CTR-PAR-${n}`, contract_title: `Parallel ${n}`, start_date: '2026-01-01', end_date: '2099-12-31', currency: 'USD', contract_value: n, internal_pic: 'Sales',
    } })).contract);
  }
  const replies = await Promise.all(made.map((c) => api('adminA', 'PUT', `/api/contracts/${c.contract_id}`, { org: A, body: { contract_title: `Edited ${c.contract_id}`, version: c.version } })));
  assert.deepEqual(replies.map((r) => r.status), [200, 200, 200, 200]);
});

test('deleting a contract detaches its orders and children in one step; another organization cannot see the id', async () => {
  const parent = ok(await api('adminA', 'POST', '/api/contracts', { org: A, body: {
    partner_id: fixtureA.partner.partner_id, contract_number: 'CTR-DEL-P', contract_title: 'Parent', start_date: '2026-01-01', end_date: '2099-12-31', currency: 'USD', contract_value: 1, internal_pic: 'Sales',
  } })).contract;
  const child = ok(await api('adminA', 'POST', '/api/contracts', { org: A, body: {
    partner_id: fixtureA.partner.partner_id, contract_number: 'CTR-DEL-C', contract_title: 'Child', document_type: 'Agreement Addendum', parent_contract_id: parent.contract_id,
    start_date: '2026-01-01', end_date: '2099-12-31', currency: 'USD', contract_value: 1, internal_pic: 'Sales',
  } })).contract;
  const io = ok(await api('adminA', 'POST', '/api/ios', { org: A, body: {
    partner_id: fixtureA.partner.partner_id, contract_id: parent.contract_id, io_number: 'IO-DEL', io_title: 'order', start_date: '2026-01-01', end_date: '2099-12-31',
    currency: 'USD', io_value: 1, pricing_model: 'Fixed', charging_type: 'Postpaid', media_channel: 'Digital',
  } })).io;
  denied(await api('adminB', 'DELETE', `/api/contracts/${parent.contract_id}`, { org: B }), [404]);
  ok(await api('adminA', 'DELETE', `/api/contracts/${parent.contract_id}`, { org: A }));
  const contracts = ok(await api('adminA', 'GET', '/api/contracts', { org: A }));
  assert.ok(!contracts.some((c: any) => c.contract_id === parent.contract_id));
  assert.ok(!contracts.find((c: any) => c.contract_id === child.contract_id).parent_contract_id);
  assert.ok(!ok(await api('adminA', 'GET', '/api/ios', { org: A })).find((i: any) => i.io_id === io.io_id).contract_id);
});

test('saving other entities does not touch contract rows', async () => {
  const before = await sql.all(`SELECT contract_id, xmin::text AS xmin, version FROM contracts ORDER BY contract_id`);
  ok(await api('adminA', 'PUT', `/api/partners/${fixtureA.partner.partner_id}`, { org: A, body: { notes: 'snapshot save' } }));
  ok(await api('adminA', 'PUT', `/api/ios/${fixtureA.io.io_id}`, { org: A, body: { io_title: 'snapshot save' } }));
  const after = await sql.all(`SELECT contract_id, xmin::text AS xmin, version FROM contracts ORDER BY contract_id`);
  assert.deepEqual(after, before);
});

/* ------------------------------ repository-backed entities: versions, races, snapshot isolation ------------------------------ */

interface Persisted { name: string; route: string; key: string; field: string; create: (tag: string) => Promise<any>; table: string; idColumn: string; responseKey: string }
const PERSISTED_ENTITIES: Persisted[] = [
  {
    name: 'partners', route: '/api/partners', key: 'partner_id', field: 'notes', table: 'partners', idColumn: 'partner_id', responseKey: 'partner',
    create: async (tag) => ok(await api('adminA', 'POST', '/api/partners', { org: A, body: { partner_name: `Race Partner ${tag}`, internal_pic: 'Sales' } })).partner,
  },
  {
    name: 'ios', route: '/api/ios', key: 'io_id', field: 'io_title', table: 'insertion_orders', idColumn: 'io_id', responseKey: 'io',
    create: async (tag) => ok(await api('adminA', 'POST', '/api/ios', { org: A, body: {
      partner_id: fixtureA.partner.partner_id, io_number: `IO-${tag}`, io_title: `Order ${tag}`, start_date: '2026-01-01', end_date: '2099-12-31',
      currency: 'USD', io_value: 10, pricing_model: 'Fixed', charging_type: 'Postpaid', media_channel: 'Digital',
    } })).io,
  },
  {
    name: 'spendings', route: '/api/partner-spendings', key: 'id', field: 'invoice_title', table: 'spendings', idColumn: 'id', responseKey: 'spending',
    create: async (tag) => ok(await api('adminA', 'POST', '/api/partner-spendings', { org: A, body: {
      vendor_id: fixtureA.partner.partner_id, vendor_name: fixtureA.partner.partner_name, invoice_number: `INV-${tag}`, invoice_date: '2026-10-01', invoice_month: ['2026-10-31'], currency: 'USD', total_amount: 5,
    } })).spending,
  },
];
for (const entity of PERSISTED_ENTITIES) {
  test(`${entity.name}: rows carry a version; concurrent edits of one row never lose an update (409 VERSION_CONFLICT)`, async () => {
    const created = await entity.create(`race-${entity.name}`);
    assert.equal(created.version, 1);
    const url = `${entity.route}/${created[entity.key]}`;
    const race = await Promise.all([
      api('adminA', 'PUT', url, { org: A, body: { [entity.field]: 'Writer one', version: created.version } }),
      api('adminA', 'PUT', url, { org: A, body: { [entity.field]: 'Writer two', version: created.version } }),
    ]);
    assert.deepEqual(race.map((reply) => reply.status).sort(), [200, 409], race.map((r) => r.raw.slice(0, 120)).join(' | '));
    const loser = race.find((reply) => reply.status === 409)!;
    assert.equal(loser.body.code, 'VERSION_CONFLICT');
    for (const key of ['error', 'code', 'message', 'status', 'requestId']) assert.ok(key in loser.body, key);
    const winner = race.find((reply) => reply.status === 200)!.body[entity.responseKey];
    assert.equal(winner.version, 2);
    const stored = ok(await api('adminA', 'GET', entity.route, { org: A })).find((row: any) => row[entity.key] === created[entity.key]);
    assert.equal(stored[entity.field], winner[entity.field]);
    assert.equal(stored.version, 2);
    assert.equal((await api('adminA', 'PUT', url, { org: A, body: { [entity.field]: 'Old copy', version: 1 } })).status, 409, 'a stale copy is told so later too');
    assert.equal((await api('adminA', 'PUT', url, { org: A, body: { [entity.field]: 'No version' } })).status, 200, 'a client without a version simply overwrites the current row');
  });

  test(`${entity.name}: concurrent edits of different rows all succeed`, async () => {
    const made = [];
    for (const n of [1, 2, 3, 4]) made.push(await entity.create(`par-${entity.name}-${n}`));
    const replies = await Promise.all(made.map((row) => api('adminA', 'PUT', `${entity.route}/${row[entity.key]}`, { org: A, body: { [entity.field]: `Edited ${row[entity.key]}`, version: row.version } })));
    assert.deepEqual(replies.map((r) => r.status), [200, 200, 200, 200]);
  });

  test(`${entity.name}: saving other entities does not touch these rows`, async () => {
    const stamp = () => sql.all(`SELECT ${entity.idColumn} AS id, xmin::text AS xmin, version FROM ${entity.table} ORDER BY ${entity.idColumn}`);
    const before = await stamp();
    // Writes of entities that still travel with the snapshot, and of contracts, must leave this table alone.
    ok(await api('adminA', 'PUT', `/api/contracts/${fixtureA.contract.contract_id}`, { org: A, body: { internal_notes: `nudge ${entity.table.length}` } }));
    if (entity.name !== 'ios') ok(await api('adminA', 'PUT', `/api/ios/${fixtureA.io.io_id}`, { org: A, body: { io_title: `nudge ${entity.table.length}` } }));
    if (entity.name !== 'partners') ok(await api('adminA', 'PUT', `/api/partners/${fixtureA.partner.partner_id}`, { org: A, body: { notes: `nudge ${entity.table.length}` } }));
    if (entity.name !== 'spendings') ok(await api('adminA', 'PUT', `/api/partner-spendings/${fixtureA.spending.id}`, { org: A, body: { invoice_title: `nudge ${entity.table.length}` } }));
    assert.deepEqual(await stamp(), before);
  });
}

test('partners: two document uploads to different due-diligence documents on one partner both land', async () => {
  const partner = ok(await api('adminA', 'POST', '/api/partners', { org: A, body: { partner_name: 'DD Race Partner', internal_pic: 'Sales', country: 'ID' } })).partner;
  const docs = (partner.dd_documents as any[]).slice(0, 2).map((d) => d.name);
  assert.equal(docs.length, 2);
  const replies = await Promise.all(docs.map((docName, i) => api('adminA', 'POST', `/api/partners/${partner.partner_id}/upload-dd`, { org: A, body: { docName, fileName: `dd-${i}.pdf`, fileData: pdf(), documentNumber: `N${i}` } })));
  assert.deepEqual(replies.map((r) => r.status), [200, 200], replies.map((r) => r.raw.slice(0, 160)).join(' | '));
  const stored = ok(await api('adminA', 'GET', '/api/partners', { org: A })).find((p: any) => p.partner_id === partner.partner_id);
  for (const docName of docs) {
    const doc = stored.dd_documents.find((d: any) => d.name === docName);
    assert.equal(doc.files.length, 1, `${docName} kept its uploaded file`);
  }
  assert.equal(stored.version, 3, 'each upload is its own versioned write');
});

test('partners: deleting one removes its contracts, orders, notifications and children, and nulls the links of spendings and evaluations', async () => {
  const f = await seed(A, 'adminA', 'DEL1', 'Sales');
  ok(await api('adminA', 'DELETE', `/api/partners/${f.partner.partner_id}`, { org: A }));
  assert.equal((await sql.get(`SELECT COUNT(*) AS n FROM partners WHERE partner_id = ?`, f.partner.partner_id)).n, 0);
  assert.equal((await sql.get(`SELECT COUNT(*) AS n FROM contracts WHERE contract_id = ?`, f.contract.contract_id)).n, 0);
  assert.equal((await sql.get(`SELECT COUNT(*) AS n FROM insertion_orders WHERE io_id = ?`, f.io.io_id)).n, 0);
  assert.equal((await sql.get(`SELECT COUNT(*) AS n FROM partner_dd_requirements WHERE partner_id = ?`, f.partner.partner_id)).n, 0);
  const spending = (await sql.get(`SELECT vendor_id FROM spendings WHERE id = ?`, f.spending.id));
  assert.equal(spending.vendor_id, null);
  denied(await api('adminB', 'DELETE', `/api/partners/${fixtureA.partner.partner_id}`, { org: B }), [404]);
});

/* ------------------------------ server-side paging and search ------------------------------ */

test('GET /api/contracts pages, filters and sorts on the server and reports the total', async () => {
  const all = ok(await api('adminA', 'GET', '/api/contracts', { org: A }));
  assert.ok(Array.isArray(all) && all.length >= 6, 'without parameters the classic array is returned');
  assert.equal(all[0].version >= 1, true);
  const first = await api('adminA', 'GET', '/api/contracts?limit=2&offset=0&sort=contract_number&dir=asc', { org: A });
  assert.equal(first.status, 200);
  assert.equal(Number(first.headers.get('x-total-count')), all.length);
  assert.equal(first.body.length, 2);
  const second = await api('adminA', 'GET', '/api/contracts?limit=2&offset=2&sort=contract_number&dir=asc', { org: A });
  const numbers = [...first.body, ...second.body].map((c: any) => c.contract_number);
  assert.deepEqual(numbers, [...numbers].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase())), 'pages continue each other in sort order');
  assert.ok(!first.body.some((c: any) => second.body.some((d: any) => d.contract_id === c.contract_id)), 'pages do not overlap');
  const filtered = await api('adminA', 'GET', '/api/contracts?q=ctr-par&limit=10', { org: A });
  assert.ok(filtered.body.length >= 4 && filtered.body.every((c: any) => /CTR-PAR-/.test(c.contract_number)));
  assert.equal(Number(filtered.headers.get('x-total-count')), filtered.body.length);
  const byStatus = await api('adminA', 'GET', '/api/contracts?status=Terminated&limit=10', { org: A });
  assert.equal(byStatus.body.length, 0);
  assert.equal(Number(byStatus.headers.get('x-total-count')), 0);
});

test('paged lists keep tenant and department scoping (totals included) and never reveal other organizations', async () => {
  const bList = await api('adminB', 'GET', '/api/contracts?limit=50&q=ctr', { org: B });
  assert.ok(bList.body.every((c: any) => c.organizationId === B));
  assert.equal(Number(bList.headers.get('x-total-count')), bList.body.length);
  const bSearchesA = await api('adminB', 'GET', `/api/contracts?q=${fixtureA.contract.contract_id}&limit=10`, { org: B });
  assert.deepEqual(bSearchesA.body, []);
  denied(await api('adminB', 'GET', '/api/contracts?limit=5', { org: A }), [403, 404]);
  // Sales editor: only the Sales department's contracts, and the total counts only those.
  const sales = await api('salesEditorA', 'GET', '/api/contracts?limit=2&offset=0', { org: A });
  const salesAll = ok(await api('salesEditorA', 'GET', '/api/contracts', { org: A }));
  assert.equal(Number(sales.headers.get('x-total-count')), salesAll.length);
  assert.ok(!sales.raw.includes(fixtureLegal.contract.contract_id) && !sales.raw.includes('CTR-A2'));
  const salesPage2 = await api('salesEditorA', 'GET', `/api/contracts?limit=2&offset=2`, { org: A });
  assert.equal(sales.body.length + salesPage2.body.length <= salesAll.length, true);
  const legalSeen = await api('salesEditorA', 'GET', '/api/contracts?q=CTR-A2&limit=5', { org: A });
  assert.deepEqual(legalSeen.body, []);
  assert.equal(Number(legalSeen.headers.get('x-total-count')), 0);
  const viewerNoDept = await api('viewerA', 'GET', '/api/contracts?limit=5', { org: A });
  assert.equal(viewerNoDept.status, 200);
  assert.equal(Number(viewerNoDept.headers.get('x-total-count')), 0);
});

test('partners, orders and spendings support the same server-side paging and filtering', async () => {
  for (const [route, key, search, sort] of [
    ['/api/partners', 'partner_id', 'Partner A', 'partner_name'],
    ['/api/ios', 'io_id', 'IO-A', 'io_number'],
    ['/api/partner-spendings', 'id', 'INV-A', 'invoice_date'],
  ] as const) {
    const all = ok(await api('adminA', 'GET', route, { org: A }));
    assert.ok(Array.isArray(all) && all.length >= 2, route);
    const page = await api('adminA', 'GET', `${route}?limit=1&offset=1&sort=${sort}`, { org: A });
    assert.equal(page.body.length, 1, route);
    assert.equal(Number(page.headers.get('x-total-count')), all.length, route);
    const found = await api('adminA', 'GET', `${route}?q=${encodeURIComponent(search)}&limit=20`, { org: A });
    assert.ok(found.body.length >= 2 && found.body.length === Number(found.headers.get('x-total-count')), route);
    const otherOrg = await api('adminB', 'GET', `${route}?q=${encodeURIComponent(search)}&limit=20`, { org: B });
    assert.ok(!otherOrg.body.some((row: any) => all.some((a: any) => a[key] === row[key])), `${route} leaked across organizations`);
    const salesOnly = await api('salesEditorA', 'GET', `${route}?limit=50`, { org: A });
    assert.ok(!salesOnly.raw.includes(' A2'), `${route} department scope`);
  }
});

test('GET /api/search is tenant- and department-scoped, filterable by type and limited', async () => {
  const adminA = ok(await api('adminA', 'GET', '/api/search?q=CTR-A1', { org: A }));
  assert.ok(adminA.results.some((r: any) => r.entity_type === 'contracts' && r.entity_id === fixtureA.contract.contract_id));
  assert.equal(adminA.total, adminA.results.length);
  const onlyContracts = ok(await api('adminA', 'GET', '/api/search?q=A1&type=contracts', { org: A }));
  assert.ok(onlyContracts.results.length >= 1 && onlyContracts.results.every((r: any) => r.entity_type === 'contracts'));
  const limited = ok(await api('adminA', 'GET', '/api/search?q=A&limit=1', { org: A }));
  assert.equal(limited.results.length, 1);
  assert.ok(limited.total >= 1);
  const fromB = ok(await api('adminB', 'GET', '/api/search?q=A1', { org: B }));
  assert.ok(!JSON.stringify(fromB).includes(fixtureA.contract.contract_id), 'organization B never sees A records');
  const legalRecord = ok(await api('salesEditorA', 'GET', '/api/search?q=A2', { org: A }));
  assert.equal(legalRecord.total, 0, 'a Sales editor cannot find Legal department records');
  const none = ok(await api('adminA', 'GET', '/api/search?q=%25_%5C', { org: A }));
  assert.equal(none.total, 0, 'wildcard characters are literal');
  denied(await api('adminB', 'GET', '/api/search?q=A1', { org: A }), [403, 404]);
});
