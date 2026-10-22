import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { approvalStatusLock, createApprovalRouter } from './approvalRoutes';
import { sql } from './db';
import { ensureSchema } from './schema';
import { createTestDatabase } from './testDatabase';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(() => database?.drop());

const addUser = async (id: string, name: string, org: string, role = 'editor') => {
  await sql.run(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, true, now(), now())`, id, name, `${id}@example.com`);
  await sql.run(`INSERT INTO member (id, "organizationId", "userId", role, status, "createdAt") VALUES (?, ?, ?, ?, 'active', now())`, `m-${id}`, org, id, role);
};

/** Stands in for the authorization middleware: `x-user` + `x-org` become the verified context. */
async function setup() {
  await sql.exec(`TRUNCATE "user", organization, audit_log, contract_documents, approval_requests, approval_steps, approval_events CASCADE`);
  await sql.exec(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('org-a', 'A', 'a', now()), ('org-b', 'B', 'b', now())`);
  for (const [id, name] of [['al', 'Adhityarul'], ['as', 'Apriliyana'], ['bw', 'Bian'], ['x', 'Outsider']]) await addUser(id, name, id === 'x' ? 'org-b' : 'org-a');
  await sql.run(`INSERT INTO contract_documents (id, organization_id, name, created_by, created_at, modified_at) VALUES ('doc-1', 'org-a', 'ITS-Done', 'al', 'now', 'now')`);

  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use((req, _res, next) => {
    const userId = String(req.headers['x-user'] || '');
    if (userId) {
      (req as any).orgContext = {
        organizationId: String(req.headers['x-org'] || 'org-a'), userId, platformRole: 'user', accessMode: 'membership',
        permissions: ['document.view', 'document.create'],
      };
    }
    next();
  });
  // `beforeTx` runs once, after the handler's checks and before its transaction: a concurrent request landing in that gap.
  const hooks: { beforeTx?: () => Promise<unknown> } = {};
  const racy = { ...sql, tx: async <T>(fn: () => Promise<T>) => { const hook = hooks.beforeTx; hooks.beforeTx = undefined; await hook?.(); return sql.tx(fn); } };
  app.use('/api', createApprovalRouter({ db: racy, tenantOf: (req) => (req as any).orgContext.organizationId }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (user: string, method: string, path: string, body?: unknown, org = 'org-a') => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-user': user, 'x-org': org },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: (res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text()) as any };
  };
  return { call, hooks, close: () => { server.close(); } };
}

const docStatus = async () => (await sql.get(`SELECT status FROM contract_documents WHERE id = 'doc-1'`)).status;

test('sequential approval of a My Documents item', async () => {
  const { call, close } = await setup();
  try {
    const created = await call('al', 'POST', '/approvals', { title: 'ITS Done', category: 'nda', approverIds: ['as', 'bw'], documentId: 'doc-1' });
    assert.equal(created.status, 201);
    const id = created.body.id;
    assert.equal(await docStatus(), 'pending_review');
    // While the flow runs, My Approval owns the document status and blocks deletes.
    assert.ok(await approvalStatusLock(sql, 'doc-1', 'pending_review', 'draft'));
    assert.ok(await approvalStatusLock(sql, 'doc-1', 'pending_review', null));
    // Type and name follow the attached document, even after it changes.
    assert.equal((await call('al', 'GET', `/approvals/${id}`)).body.category, 'contract');
    await sql.run(`UPDATE contract_documents SET type = 'agreement', name = 'ITS-Done v2' WHERE id = 'doc-1'`);
    const live = (await call('al', 'GET', `/approvals/${id}`)).body;
    assert.deepEqual([live.category, live.file_name], ['agreement', 'ITS-Done v2']);
    assert.equal((await call('al', 'GET', '/approvals?category=agreement')).body.items.length, 1);

    assert.equal((await call('as', 'GET', '/approvals?box=inbox')).body.stats.waiting, 1);
    assert.equal((await call('bw', 'GET', '/approvals?box=inbox')).body.items.length, 0);
    assert.equal((await call('bw', 'POST', `/approvals/${id}/decision`, { decision: 'approve' })).status, 403);
    assert.equal((await call('x', 'GET', `/approvals/${id}`, undefined, 'org-b')).status, 404);

    assert.equal((await call('as', 'POST', `/approvals/${id}/decision`, { decision: 'approve' })).status, 200);
    assert.equal((await call('as', 'POST', `/approvals/${id}/decision`, { decision: 'approve' })).status, 403);
    assert.equal((await call('bw', 'POST', `/approvals/${id}/decision`, { decision: 'approve', comment: 'ok' })).status, 200);

    const detail = (await call('al', 'GET', `/approvals/${id}`)).body;
    assert.equal(detail.status, 'approved');
    assert.match(detail.code, /^OA-\d{4}-00001$/);
    assert.deepEqual(detail.events.map((e: any) => e.kind), ['submitted', 'approved', 'approved']);
    assert.equal(await docStatus(), 'approved');
    assert.ok(await approvalStatusLock(sql, 'doc-1', 'approved', 'draft'));
    assert.ok(await approvalStatusLock(sql, 'doc-1', 'draft', 'approved'));
    assert.equal(await approvalStatusLock(sql, 'doc-1', 'approved', 'archived'), null);
    assert.equal(await approvalStatusLock(sql, 'doc-1', 'approved', null), null);
    assert.equal((await sql.get(`SELECT COUNT(*) AS n FROM audit_log`)).n, 3);
  } finally { close(); }
});

test('uploaded file: validation, rejection stops the chain, file is served to participants only', async () => {
  const { call, close } = await setup();
  try {
    const pdf = { name: 'ITS-Done.pdf', base64: Buffer.from('%PDF-1.4 test').toString('base64') };
    const base = { title: 'Upload', category: 'nda', approverIds: ['as', 'bw'] };
    assert.equal((await call('al', 'POST', '/approvals', { ...base, file: { ...pdf, name: 'x.exe' } })).status, 400);
    assert.equal((await call('al', 'POST', '/approvals', { ...base, file: pdf, documentId: 'doc-1' })).status, 400);
    assert.equal((await call('al', 'POST', '/approvals', { ...base, approverIds: ['al'], file: pdf })).status, 400);
    assert.equal((await call('al', 'POST', '/approvals', { ...base, approverIds: ['x'], file: pdf })).status, 400);
    assert.equal((await call('al', 'POST', '/approvals', { ...base, approverIds: ['as', 'as'], file: pdf })).status, 400);

    const { body } = await call('al', 'POST', '/approvals', { ...base, file: pdf });
    assert.equal((await call('bw', 'GET', `/approvals/${body.id}/file`)).body, '%PDF-1.4 test');
    assert.equal((await call('as', 'POST', `/approvals/${body.id}/decision`, { decision: 'reject' })).status, 400);
    assert.equal((await call('as', 'POST', `/approvals/${body.id}/decision`, { decision: 'reject', comment: 'Wrong file' })).status, 200);
    const detail = (await call('al', 'GET', `/approvals/${body.id}`)).body;
    assert.equal(detail.status, 'rejected');
    assert.equal(detail.steps[1].status, 'waiting');
    assert.equal((await call('bw', 'POST', `/approvals/${body.id}/decision`, { decision: 'approve' })).status, 403);
    assert.equal((await call('al', 'GET', '/approvals?box=mine')).body.items.length, 1);
    assert.equal((await call('al', 'GET', '/approvals')).body.items.length, 1);
    assert.equal((await call('bw', 'GET', '/approvals?box=all')).body.items.length, 1);
    assert.equal((await call('bw', 'GET', '/approvals?box=inbox')).body.items.length, 0);

    assert.equal((await call('al', 'DELETE', `/approvals/${body.id}`)).status, 409); // decided: kept as record
    assert.equal((await call('al', 'GET', `/approvals/${body.id}`)).status, 200);

    const first = (await call('al', 'POST', '/approvals', { ...base, file: pdf })).body;
    const second = (await call('al', 'POST', '/approvals', { ...base, file: pdf })).body;
    assert.equal((await call('as', 'DELETE', `/approvals/${first.id}`)).status, 403);
    assert.equal((await call('al', 'DELETE', `/approvals/${first.id}`)).status, 200);
    assert.equal((await call('al', 'GET', `/approvals/${first.id}`)).status, 404);
    const third = (await call('al', 'POST', '/approvals', { ...base, file: pdf })).body;
    const codes = [body.id, second.id, third.id].map(async (id) => (await call('al', 'GET', `/approvals/${id}`)).body.code);
    assert.equal(new Set(await Promise.all(codes)).size, 3); // a delete must not make a code repeat
  } finally { close(); }
});

test('viewers are not offered or accepted as approvers', async () => {
  const { call, close } = await setup();
  try {
    await addUser('vw', 'Viewer', 'org-a', 'viewer');
    const approvers = (await call('al', 'GET', '/approvals/approvers')).body.approvers.map((a: { id: string }) => a.id);
    assert.ok(approvers.includes('as'));
    assert.ok(!approvers.includes('vw'));
    const created = await call('al', 'POST', '/approvals', { title: 'NDA', category: 'nda', approverIds: ['vw'], documentId: 'doc-1' });
    assert.equal(created.status, 400);
  } finally { close(); }
});

test('a double-submitted decision cannot skip the next approver', async () => {
  const { call, hooks, close } = await setup();
  try {
    const { id } = (await call('al', 'POST', '/approvals', { title: 'NDA', category: 'nda', approverIds: ['as', 'bw'], documentId: 'doc-1' })).body;
    let twin: Awaited<ReturnType<typeof call>> | undefined;
    hooks.beforeTx = async () => { twin = await call('as', 'POST', `/approvals/${id}/decision`, { decision: 'approve' }); };
    const first = await call('as', 'POST', `/approvals/${id}/decision`, { decision: 'approve' });
    assert.deepEqual([twin?.status, first.status], [200, 409]);
    const detail = (await call('al', 'GET', `/approvals/${id}`)).body;
    assert.deepEqual([detail.status, detail.current_step, detail.steps.map((s: any) => s.status)], ['pending', 2, ['approved', 'waiting']]);
    assert.equal((await call('bw', 'POST', `/approvals/${id}/decision`, { decision: 'approve' })).status, 200);
    assert.equal((await call('al', 'GET', `/approvals/${id}`)).body.status, 'approved');
  } finally { close(); }
});

test('an approval decided while its delete is in flight is kept', async () => {
  const { call, hooks, close } = await setup();
  try {
    const { id } = (await call('al', 'POST', '/approvals', { title: 'NDA', category: 'nda', approverIds: ['as'], documentId: 'doc-1' })).body;
    hooks.beforeTx = () => call('as', 'POST', `/approvals/${id}/decision`, { decision: 'approve' });
    assert.equal((await call('al', 'DELETE', `/approvals/${id}`)).status, 409);
    assert.equal((await call('al', 'GET', `/approvals/${id}`)).body.status, 'approved');
    assert.equal(await docStatus(), 'approved');
  } finally { close(); }
});

test('two submits of one document: the one landing after the checks is refused, codes never repeat', async () => {
  const { call, hooks, close } = await setup();
  try {
    const submit = () => call('al', 'POST', '/approvals', { title: 'NDA', category: 'nda', approverIds: ['as'], documentId: 'doc-1' });
    let twin: Awaited<ReturnType<typeof call>> | undefined;
    hooks.beforeTx = async () => { twin = await submit(); };
    const first = await submit();
    assert.deepEqual([twin?.status, first.status, first.body.error], [201, 409, 'APPROVAL_PENDING']);
    const pdf = { name: 'a.pdf', base64: Buffer.from('%PDF').toString('base64') };
    const uploads = await Promise.all([1, 2, 3].map(() => call('al', 'POST', '/approvals', { title: 'Up', category: 'nda', approverIds: ['as'], file: pdf })));
    assert.deepEqual(uploads.map((u) => u.status), [201, 201, 201]);
    assert.equal((await sql.get(`SELECT COUNT(DISTINCT code) AS n FROM approval_requests`)).n, 4);
  } finally { close(); }
});
