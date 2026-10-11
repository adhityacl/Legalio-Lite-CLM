/**
 * Create Contract documents API + paragraph diff.
 * Run: npx tsx --test tests/documents.test.ts
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import express from 'express';
import { createDocumentRouter } from '../apps/backend/src/documentRoutes';
import { diffParagraphs } from '../apps/frontend/src/lib/paragraphDiff';
import { tenantPermissionsFor } from '../apps/backend/src/rbac';

const db = new Database(':memory:');
db.exec(`CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT);
  INSERT INTO "user" VALUES ('u1', 'Ana'), ('u2', 'Budi'), ('u3', 'Citra');`);

const app = express();
app.use(express.json());
const ACTORS: Record<string, { id: string; role: string; org: string; permissions: string[] }> = {
  ana: { id: 'u1', role: 'editor', org: 'org-a', permissions: tenantPermissionsFor('editor') },
  budi: { id: 'u2', role: 'admin', org: 'org-a', permissions: tenantPermissionsFor('admin') },
  citra: { id: 'u3', role: 'admin', org: 'org-b', permissions: tenantPermissionsFor('admin') },
};
app.use((req, _res, next) => {
  (req as any).actor = ACTORS[String(req.headers['x-test-actor'])] ?? null;
  next();
});
app.use('/api', createDocumentRouter({ db, tenantOf: (req) => (req as any).actor?.org ?? '__none__' }));
const server = app.listen(0);
after(() => server.close());
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

async function call(actor: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-actor': actor },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

test('draft lifecycle: create, dedupe, coalesce autosaves, manual versions, restore', async () => {
  const created = await call('ana', 'POST', '/documents', { name: 'NDA Acme', type: 'nda', content: '<p>v1</p>' });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal(created.body.current_version, 1);
  assert.equal(created.body.created_by_name, 'Ana');

  const same = await call('ana', 'POST', `/documents/${id}/drafts`, { content: '<p>v1</p>', kind: 'auto' });
  assert.equal(same.body.created, false, 'unchanged content must not create a version');

  const manual = await call('ana', 'POST', `/documents/${id}/drafts`, { content: '<p>v2</p>', kind: 'manual' });
  assert.equal(manual.body.version, 2);

  const auto1 = await call('ana', 'POST', `/documents/${id}/drafts`, { content: '<p>v3</p>', kind: 'auto' });
  const auto2 = await call('ana', 'POST', `/documents/${id}/drafts`, { content: '<p>v3b</p>', kind: 'auto' });
  assert.equal(auto1.body.version, 3);
  assert.equal(auto2.body.version, 3, 'consecutive autosaves by the same user coalesce');
  assert.equal(auto2.body.document.content, '<p>v3b</p>');

  const otherUser = await call('budi', 'POST', `/documents/${id}/drafts`, { content: '<p>v4</p>', kind: 'auto', name: 'NDA Acme (rev)' });
  assert.equal(otherUser.body.version, 4, "another user's autosave starts a new version");
  assert.equal(otherUser.body.document.name, 'NDA Acme (rev)');
  assert.equal(otherUser.body.document.modified_by_name, 'Budi');

  const restored = await call('ana', 'POST', `/documents/${id}/drafts/2/restore`);
  assert.equal(restored.body.version, 5);
  assert.equal(restored.body.document.content, '<p>v2</p>');

  const drafts = await call('ana', 'GET', `/documents/${id}/drafts`);
  assert.deepEqual(drafts.body.map((d: any) => d.version_number), [5, 4, 3, 2, 1]);
  assert.equal(drafts.body[0].save_kind, 'restore');
  assert.equal(drafts.body[0].restored_from, 2);

  await call('ana', 'PATCH', `/documents/${id}/drafts/2`, { draft_name: 'legal-reviewed', labels: ['Legal Review', ''] });
  const v2 = await call('ana', 'GET', `/documents/${id}/drafts/2`);
  assert.equal(v2.body.draft_name, 'legal-reviewed');
  assert.deepEqual(v2.body.labels, ['Legal Review']);
});

test('explorer: tenant isolation, search incl. metadata, filters, sorting, paging', async () => {
  for (const name of ['Alpha Lease', 'Beta Supply', 'Gamma Service']) {
    await call('budi', 'POST', '/documents', { name, content: '<p>x</p>' });
  }
  const foreign = await call('citra', 'POST', '/documents', { name: 'Other tenant doc', content: '' });

  assert.equal((await call('ana', 'GET', `/documents/${foreign.body.id}`)).status, 404);
  assert.equal((await call('ana', 'DELETE', `/documents/${foreign.body.id}`)).status, 404);
  assert.equal((await call('citra', 'GET', '/documents')).body.total, 1);

  const sorted = await call('ana', 'GET', '/documents?sort_by=name&sort_dir=asc&limit=50');
  assert.deepEqual(
    sorted.body.documents.map((d: any) => d.name),
    ['Alpha Lease', 'Beta Supply', 'Gamma Service', 'NDA Acme (rev)'],
  );
  assert.equal((await call('ana', 'GET', '/documents?search=beta')).body.total, 1);
  assert.equal((await call('ana', 'GET', '/documents?type=nda')).body.total, 1);
  assert.equal((await call('ana', 'GET', '/documents?created_by=u2')).body.total, 3);

  const paged = await call('ana', 'GET', '/documents?sort_by=name&sort_dir=asc&limit=999&page=1');
  assert.equal(paged.body.limit, 5, 'unsupported page sizes fall back to 5');

  const gamma = sorted.body.documents[2];
  await call('ana', 'PATCH', `/documents/${gamma.id}`, { status: 'archived' });
  assert.equal((await call('ana', 'GET', '/documents')).body.total, 3, 'archived documents are hidden by default');
  assert.equal((await call('ana', 'GET', '/documents?status=archived')).body.total, 1);
  assert.equal((await call('ana', 'PATCH', `/documents/${gamma.id}`, { status: 'bogus' })).status, 400);

  assert.equal((await call('ana', 'POST', '/metadata-fields', { name: 'Client', field_type: 'text' })).status, 403);
  const client = await call('budi', 'POST', '/metadata-fields', { name: 'Client', field_type: 'text' });
  const area = await call('budi', 'POST', '/metadata-fields', { name: 'Area', field_type: 'multi_select', options: ['IP', 'Employment'] });
  assert.equal((await call('budi', 'POST', '/metadata-fields', { name: 'Bad', field_type: 'select', options: [] })).status, 400);

  const beta = sorted.body.documents[1];
  const saved = await call('ana', 'PUT', `/documents/${beta.id}/metadata`, {
    values: { [client.body.id]: 'Acme Corp', [area.body.id]: ['IP', 'Not an option'] },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual((await call('ana', 'GET', `/documents/${beta.id}/metadata`)).body, {
    [client.body.id]: 'Acme Corp',
    [area.body.id]: ['IP'],
  });
  assert.equal((await call('ana', 'GET', '/documents?search=acme%20corp')).body.total, 1, 'search matches metadata values');
  assert.equal((await call('ana', 'GET', `/documents?meta_field=${client.body.id}&meta_value=acme`)).body.total, 1);
  assert.equal((await call('citra', 'GET', '/metadata-fields')).body.length, 0, 'fields are per tenant');
});

test('comments: threading and status transitions', async () => {
  const doc = (await call('ana', 'POST', '/documents', { name: 'Review me', content: '<p>Company</p>' })).body;
  const comment = (await call('ana', 'POST', `/documents/${doc.id}/comments`, { body: 'Define this', quote: 'Company' })).body;
  const suggestion = (
    await call('budi', 'POST', `/documents/${doc.id}/comments`, { comment_type: 'suggestion', quote: 'Company', new_text: 'Company Inc.' })
  ).body;
  assert.equal(suggestion.comment_type, 'suggestion');
  assert.equal(suggestion.author_name, 'Budi');

  const reply = await call('budi', 'POST', `/documents/${doc.id}/comments`, { body: 'Agreed', parent_id: comment.id });
  assert.equal(reply.status, 201);
  const nested = await call('ana', 'POST', `/documents/${doc.id}/comments`, { body: 'x', parent_id: reply.body.id });
  assert.equal(nested.status, 400, 'replies are one level deep');

  assert.equal((await call('ana', 'POST', `/documents/${doc.id}/comments/${comment.id}/accept`)).status, 409);
  const accepted = await call('ana', 'POST', `/documents/${doc.id}/comments/${suggestion.id}/accept`);
  assert.equal(accepted.body.status, 'accepted');
  assert.equal(accepted.body.resolved_by_name, 'Ana');
  assert.equal((await call('ana', 'POST', `/documents/${doc.id}/comments/${suggestion.id}/reject`)).status, 409);

  assert.equal((await call('ana', 'POST', `/documents/${doc.id}/comments/${comment.id}/resolve`)).body.status, 'resolved');
  const reopened = await call('ana', 'POST', `/documents/${doc.id}/comments/${comment.id}/reopen`);
  assert.equal(reopened.body.status, 'open');
  assert.equal(reopened.body.resolved_at, null);

  assert.equal((await call('ana', 'DELETE', `/documents/${doc.id}`)).status, 200);
  const leftovers = db.prepare(`SELECT COUNT(*) AS n FROM contract_comments WHERE contract_id = ?`).get(doc.id) as { n: number };
  assert.equal(leftovers.n, 0, 'deleting a document removes its comments');
});

test('paragraph diff', () => {
  assert.deepEqual(diffParagraphs(['a', 'b', 'c'], ['a', 'x', 'c', 'd']), [
    { kind: 'same', text: 'a' },
    { kind: 'removed', text: 'b' },
    { kind: 'added', text: 'x' },
    { kind: 'same', text: 'c' },
    { kind: 'added', text: 'd' },
  ]);
  assert.deepEqual(diffParagraphs([], ['a']), [{ kind: 'added', text: 'a' }]);
});
