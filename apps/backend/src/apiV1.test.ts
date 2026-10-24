import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { bootApp, type Harness } from './testHarness';

let h: Harness;
const ALL_SCOPES = ['contracts', 'partners', 'orders', 'spendings'].flatMap((r) => [`${r}:read`, `${r}:write`]);
const secrets: Record<string, string> = {};

before(async () => {
  h = await bootApp({
    tag: 'apiv1', orgs: [{ id: 'org-a', name: 'Org A' }, { id: 'org-b', name: 'Org B' }],
    users: [['adminA', 'org-a', 'admin'], ['editorA', 'org-a', 'editor'], ['adminB', 'org-b', 'admin']],
  });
});
after(() => h?.close());

const v1 = (key: string, method: string, route: string, body?: unknown, headers: Record<string, string> = {}) =>
  h.request(method, `/api/v1${route}`, { body, headers: { authorization: `Bearer ${secrets[key] ?? key}`, ...headers } });

async function makeKey(user: string, org: string, name: string, scopes: string[], extra: Record<string, unknown> = {}) {
  const reply = await h.api(user, 'POST', `/api/organizations/${org}/api-keys`, { body: { name, scopes, ...extra } });
  assert.equal(reply.status, 201, reply.raw);
  secrets[name] = reply.body.secret;
  return reply.body;
}

test('keys are managed by organization admins only; the secret is shown once and stored hashed', async () => {
  assert.equal((await h.api('editorA', 'POST', '/api/organizations/org-a/api-keys', { body: { name: 'x', scopes: ['contracts:read'] } })).status, 403);
  assert.equal((await h.api('editorA', 'GET', '/api/organizations/org-a/api-keys')).status, 403);
  assert.equal((await h.api('adminB', 'GET', '/api/organizations/org-a/api-keys')).status, 404);
  for (const body of [{}, { name: 'x' }, { name: 'x', scopes: [] }, { name: 'x', scopes: ['contracts:delete'] }, { name: 'x', scopes: ['contracts:read'], expiresAt: '2001-01-01' }, { name: 'x', scopes: ['contracts:read'], rateLimitPerMinute: 0 }, { name: 'x', scopes: ['contracts:read'], organizationId: 'org-b' }]) {
    assert.equal((await h.api('adminA', 'POST', '/api/organizations/org-a/api-keys', { body })).status, 400, JSON.stringify(body));
  }
  const created = await makeKey('adminA', 'org-a', 'full-a', ALL_SCOPES);
  assert.match(created.secret, /^lgk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
  assert.equal(created.apiKey.prefix, created.secret.slice(0, 12));
  assert.equal(created.apiKey.status, 'active');
  const list = await h.api('adminA', 'GET', '/api/organizations/org-a/api-keys');
  assert.equal(list.status, 200);
  assert.ok(!list.raw.includes(created.secret) && !/key_?hash|secret/i.test(list.raw), 'the list never carries the secret or hash');
  const row = await h.sql.get(`SELECT * FROM api_keys WHERE id = ?`, created.apiKey.id);
  assert.equal(JSON.stringify(row).includes(created.secret), false, 'the secret is not stored');
  assert.match(row.key_hash, /^[0-9a-f]{64}$/);
  const audit = await h.sql.all(`SELECT action FROM audit_log WHERE tenant_id = 'org-a' AND target_type = 'api_key'`);
  assert.deepEqual(audit.map((a: any) => a.action), ['api_key.create']);
  await makeKey('adminB', 'org-b', 'full-b', ALL_SCOPES);
});

test('a key authenticates /api/v1 only; sessions and keys are not interchangeable', async () => {
  const who = await v1('full-a', 'GET', '/whoami');
  assert.equal(who.status, 200, who.raw);
  assert.equal(who.body.data.organizationId, 'org-a');
  assert.equal(who.headers.get('x-ratelimit-limit'), '600');
  assert.equal((await h.request('GET', '/api/v1/whoami')).body.code, 'API_KEY_REQUIRED');
  assert.equal((await v1(h.tokens.adminA, 'GET', '/whoami')).body.code, 'API_KEY_INVALID', 'a session token is not an API key');
  assert.equal((await v1('ba_live_' + 'a'.repeat(48), 'GET', '/whoami')).body.code, 'API_KEY_UNSUPPORTED');
  assert.equal((await v1('lgk_deadbeef_' + 'A'.repeat(43), 'GET', '/whoami')).body.code, 'API_KEY_INVALID');
  // The key is rejected on every cookie-session route.
  for (const route of ['/api/contracts', '/api/partners', '/api/init-data', '/api/me', '/api/organizations/org-a/api-keys', '/api/organizations/org-a/members']) {
    const reply = await h.request('GET', route, { headers: { authorization: `Bearer ${secrets['full-a']}`, 'x-organization-id': 'org-a' } });
    assert.equal(reply.status, 401, `${route}: ${reply.raw.slice(0, 120)}`);
  }
  const mutate = await h.request('POST', '/api/contracts', { headers: { authorization: `Bearer ${secrets['full-a']}`, origin: 'http://localhost:3000', 'x-organization-id': 'org-a' }, body: { contract_number: 'X' } });
  assert.equal(mutate.status, 401);
  // A session cannot call a v1 write either (no key, no access).
  assert.equal((await h.api('adminA', 'POST', '/api/v1/partners', { body: { partner_name: 'No' } })).status, 401);
});

test('create, list, get and update through v1 with paging, filters and version checks', async () => {
  const partner = await v1('full-a', 'POST', '/partners', { partner_name: 'Acme Ltd', country: 'ID', internal_pic: 'Legal', fileData: 'ignored', accessToken: 'ignored' });
  assert.equal(partner.status, 201, partner.raw);
  const partnerId = partner.body.data.partner_id;
  assert.equal(partner.body.data.version, 1);
  assert.equal((await v1('full-a', 'POST', '/partners', { country: 'ID' })).status, 400);
  assert.equal((await v1('full-a', 'POST', '/partners', { partner_name: 'Other', organizationId: 'org-b', partner_id: 'forged' })).body.data.partner_id !== 'forged', true, 'mass assignment is ignored');

  for (const n of [1, 2, 3]) {
    const reply = await v1('full-a', 'POST', '/contracts', { partner_id: partnerId, contract_number: `API-${n}`, contract_title: `Contract ${n}`, start_date: '2026-01-01', end_date: '2099-12-31', currency: 'USD', contract_value: 100 * n });
    assert.equal(reply.status, 201, reply.raw);
  }
  const dup = await v1('full-a', 'POST', '/contracts', { partner_id: partnerId, contract_number: 'API-1', contract_title: 'dup', start_date: '2026-01-01', end_date: '2099-12-31' });
  assert.equal(dup.status, 400);
  assert.ok(dup.body.code && dup.body.requestId && dup.body.message);

  const page = await v1('full-a', 'GET', '/contracts?limit=2&offset=0&sort=contract_number&dir=asc');
  assert.equal(page.status, 200, page.raw);
  assert.equal(page.body.total, 3);
  assert.equal(page.body.data.length, 2);
  assert.deepEqual(page.body.data.map((c: any) => c.contract_number), ['API-1', 'API-2']);
  assert.equal(page.body.limit, 2);
  const filtered = await v1('full-a', 'GET', '/contracts?q=API-3');
  assert.deepEqual(filtered.body.data.map((c: any) => c.contract_number), ['API-3']);
  assert.equal(filtered.body.limit, 50, 'default page size');
  assert.equal((await v1('full-a', 'GET', '/contracts?limit=100000')).body.limit, 200, 'page size is capped');

  const one = filtered.body.data[0];
  const got = await v1('full-a', 'GET', `/contracts/${one.contract_id}`);
  assert.equal(got.body.data.contract_number, 'API-3');
  assert.equal((await v1('full-a', 'GET', '/contracts/nope')).status, 404);

  const noVersion = await v1('full-a', 'PATCH', `/contracts/${one.contract_id}`, { contract_title: 'Renamed' });
  assert.equal(noVersion.status, 428);
  assert.equal(noVersion.body.code, 'VERSION_REQUIRED');
  const updated = await v1('full-a', 'PATCH', `/contracts/${one.contract_id}`, { contract_title: 'Renamed', version: got.body.data.version });
  assert.equal(updated.status, 200, updated.raw);
  assert.equal(updated.body.data.contract_title, 'Renamed');
  assert.equal(updated.body.data.version, got.body.data.version + 1);
  const stale = await v1('full-a', 'PATCH', `/contracts/${one.contract_id}`, { contract_title: 'Again', version: got.body.data.version });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'VERSION_CONFLICT');
  const viaHeader = await v1('full-a', 'PATCH', `/contracts/${one.contract_id}`, { contract_title: 'Header' }, { 'if-match': `"${updated.body.data.version}"` });
  assert.equal(viaHeader.status, 200, viaHeader.raw);

  const order = await v1('full-a', 'POST', '/orders', { partner_id: partnerId, contract_id: one.contract_id, io_number: 'IO-API-1', io_title: 'Order', start_date: '2026-01-01', end_date: '2099-12-31', currency: 'USD', io_value: 10, pricing_model: 'Fixed', charging_type: 'Postpaid' });
  assert.equal(order.status, 201, order.raw);
  assert.equal((await v1('full-a', 'GET', `/orders?contract_id=${one.contract_id}`)).body.total, 1);
  const spending = await v1('full-a', 'POST', '/spendings', { vendor_id: partnerId, vendor_name: 'Acme Ltd', invoice_number: 'INV-API-1', invoice_date: '2026-10-01', invoice_month: ['2026-10-31'], currency: 'USD', total_amount: 5 });
  assert.equal(spending.status, 201, spending.raw);
  assert.equal((await v1('full-a', 'GET', '/spendings?year=2026')).body.total, 1);
  const spendingUpdate = await v1('full-a', 'PATCH', `/spendings/${spending.body.data.id}`, { total_amount: 7, version: spending.body.data.version });
  assert.equal(spendingUpdate.status, 200, spendingUpdate.raw);

  // Changes made with a key are attributed to it in the activity history.
  const activity = await h.sql.get(`SELECT user_email, role FROM activity_logs WHERE organization_id = 'org-a' AND action_type = 'CREATE' ORDER BY timestamp DESC LIMIT 1`);
  assert.match(activity.user_email, /^lgk_[0-9a-f]{8}@api-key\.invalid$/);
  assert.equal(activity.role, 'API key');
});

test('scopes are enforced per resource and per verb', async () => {
  await makeKey('adminA', 'org-a', 'read-contracts', ['contracts:read']);
  await makeKey('adminA', 'org-a', 'write-only', ['partners:write']);
  assert.equal((await v1('read-contracts', 'GET', '/contracts')).status, 200);
  const noWrite = await v1('read-contracts', 'POST', '/contracts', { partner_id: 'x', contract_number: 'N', contract_title: 'T', start_date: '2026-01-01', end_date: '2027-01-01' });
  assert.equal(noWrite.status, 403);
  assert.equal(noWrite.body.code, 'INSUFFICIENT_SCOPE');
  assert.equal((await v1('read-contracts', 'GET', '/partners')).status, 403);
  assert.equal((await v1('read-contracts', 'GET', '/orders')).status, 403);
  assert.equal((await v1('write-only', 'GET', '/partners')).status, 403, 'write does not imply read');
  assert.equal((await v1('write-only', 'POST', '/partners', { partner_name: 'Write only' })).status, 201);
  assert.equal((await v1('read-contracts', 'PATCH', '/contracts/x', { version: 1 })).status, 403);
});

test('a key never reaches another organization, in reads, updates or references', async () => {
  const bPartner = await v1('full-b', 'POST', '/partners', { partner_name: 'Beta Corp', country: 'ID' });
  assert.equal(bPartner.status, 201);
  const bContract = await v1('full-b', 'POST', '/contracts', { partner_id: bPartner.body.data.partner_id, contract_number: 'B-1', contract_title: 'Beta contract', start_date: '2026-01-01', end_date: '2099-12-31' });
  assert.equal(bContract.status, 201, bContract.raw);
  const aList = await v1('full-a', 'GET', '/contracts');
  assert.ok(aList.body.data.every((c: any) => c.contract_number.startsWith('API-')), 'org A sees only its own');
  assert.ok(!aList.raw.includes('Beta'), 'no data of org B');
  const bList = await v1('full-b', 'GET', '/contracts');
  assert.deepEqual(bList.body.data.map((c: any) => c.contract_number), ['B-1']);
  const aContractId = aList.body.data[0].contract_id;
  assert.equal((await v1('full-b', 'GET', `/contracts/${aContractId}`)).status, 404);
  assert.equal((await v1('full-b', 'PATCH', `/contracts/${aContractId}`, { contract_title: 'Hijack', version: 1 })).status, 404);
  const aPartnerId = (await v1('full-a', 'GET', '/partners')).body.data[0].partner_id;
  const cross = await v1('full-b', 'POST', '/contracts', { partner_id: aPartnerId, contract_number: 'B-2', contract_title: 'Cross', start_date: '2026-01-01', end_date: '2099-12-31' });
  assert.equal(cross.status, 400, 'a partner of another organization cannot be referenced');
  assert.ok(!(await h.sql.get(`SELECT 1 FROM contracts WHERE contract_number = 'B-2'`)));
  // The organization cannot be chosen by the caller.
  assert.equal((await v1('full-b', 'GET', '/contracts?organizationId=org-a&tenantId=org-a', undefined, { 'x-organization-id': 'org-a' })).body.data.length, 1);
  // Management endpoints of another organization stay hidden.
  assert.equal((await h.api('adminB', 'POST', `/api/organizations/org-a/api-keys/${(await h.sql.get(`SELECT id FROM api_keys WHERE organization_id = 'org-a' LIMIT 1`)).id}/revoke`)).status, 404);
});

test('revoked and expired keys are refused with their own codes; last use is recorded', async () => {
  const created = await makeKey('adminA', 'org-a', 'to-revoke', ['contracts:read']);
  assert.equal((await v1('to-revoke', 'GET', '/contracts')).status, 200);
  const used = await h.sql.get(`SELECT last_used_at FROM api_keys WHERE id = ?`, created.apiKey.id);
  assert.ok(used.last_used_at, 'last_used_at is set on first use');
  assert.equal((await h.api('adminA', 'POST', `/api/organizations/org-a/api-keys/${created.apiKey.id}/revoke`)).status, 200);
  assert.equal((await h.api('adminA', 'POST', `/api/organizations/org-a/api-keys/${created.apiKey.id}/revoke`)).status, 200, 'idempotent');
  const revoked = await v1('to-revoke', 'GET', '/contracts');
  assert.equal(revoked.status, 401);
  assert.equal(revoked.body.code, 'API_KEY_REVOKED');
  const expiring = await makeKey('adminA', 'org-a', 'to-expire', ['contracts:read'], { expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  assert.equal((await v1('to-expire', 'GET', '/contracts')).status, 200);
  await h.sql.run(`UPDATE api_keys SET expires_at = ? WHERE id = ?`, new Date(Date.now() - 1000).toISOString(), expiring.apiKey.id);
  assert.equal((await v1('to-expire', 'GET', '/contracts')).body.code, 'API_KEY_EXPIRED');
  const list = (await h.api('adminA', 'GET', '/api/organizations/org-a/api-keys')).body.apiKeys;
  assert.equal(list.find((k: any) => k.id === created.apiKey.id).status, 'revoked');
  assert.equal(list.find((k: any) => k.id === expiring.apiKey.id).status, 'expired');
  assert.equal((await h.sql.all(`SELECT action FROM audit_log WHERE target_type = 'api_key' AND action = 'api_key.revoke' AND target_id = ?`, created.apiKey.id)).length, 2, 'each revoke request is audited');
});

test('each key has its own rate limit', async () => {
  await makeKey('adminA', 'org-a', 'limited', ['contracts:read'], { rateLimitPerMinute: 3 });
  for (let i = 0; i < 3; i++) assert.equal((await v1('limited', 'GET', '/contracts')).status, 200);
  const blocked = await v1('limited', 'GET', '/contracts');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'RATE_LIMITED');
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
  assert.equal(blocked.headers.get('x-ratelimit-remaining'), '0');
  assert.equal((await v1('full-a', 'GET', '/contracts')).status, 200, 'other keys are unaffected');
});

test('the limiter and failure throttle behave over time', async () => {
  const { createWindowLimiter } = await import('./apiKeys');
  let time = 0;
  const limiter = createWindowLimiter(1000, () => time);
  assert.equal(limiter.hit('k', 2).allowed, true);
  assert.equal(limiter.hit('k', 2).allowed, true);
  assert.equal(limiter.hit('k', 2).allowed, false);
  time = 1001;
  assert.equal(limiter.hit('k', 2).allowed, true, 'a new window starts');
  assert.equal(limiter.count('k'), 1);
});
