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

interface Reply { status: number; body: any; raw: string }
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
  return { status: res.status, body, raw };
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
