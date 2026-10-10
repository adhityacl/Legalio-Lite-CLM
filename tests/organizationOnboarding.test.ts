import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IsolatedServer, seedFixtures } from './tenant-boundaries/harness';
import { createIdentityRecord } from '../apps/backend/src/organizationProvisioning';
import { readOrganizationSettings } from '../apps/backend/src/organizationSettingsStore';

let server: IsolatedServer;
let ids: Record<string, string>;
const input = { name: 'New Workspace', legalEntity: 'PT New Workspace', brandName: 'New Brand', countryCode: 'ID', industry: 'general', language: 'EN' };
before(async () => { server = await IsolatedServer.start(); ids = seedFixtures(server); });
after(async () => { await server?.stop(); });

test('onboarding requires a valid session and manual approval and never changes platform privileges', async () => {
  for (const [who, status] of [[null, 401], [server.session(ids.banned), 403]] as const) {
    const before = server.snapshot();
    const result = await server.call(who, '/api/me/organization', { method: 'POST', body: input });
    assert.equal(result.status, status, JSON.stringify(result.data));
    assert.equal(server.snapshot(), before);
  }
});

test('validates all onboarding fields before writing anything', async () => {
  const who = server.session(ids.nomember);
  for (const body of [undefined, [], { ...input, countryCode: undefined }]) {
    const before = server.snapshot();
    assert.equal((await server.call(who, '/api/me/organization', { method: 'POST', body })).status, 400);
    assert.equal(server.snapshot(), before);
  }
  for (const patch of [{ name: ' ' }, { legalEntity: '' }, { brandName: '' }, { name: 'x'.repeat(201) }, { legalEntity: 7 }, { countryCode: 'XX' }, { industry: 'unknown' }, { language: 'XX' }, { adminUserId: ids.super }, { role: 'superuser' }]) {
    const before = server.snapshot();
    const result = await server.call(who, '/api/me/organization', { method: 'POST', body: { ...input, ...patch } });
    assert.equal(result.status, 400, JSON.stringify(patch));
    assert.equal(server.snapshot(), before);
  }
});

test('creates settings, explicit admin membership and audit atomically, then prevents repeated onboarding', async () => {
  const who = server.session(ids.nomember);
  const result = await server.call(who, '/api/me/organization', { method: 'POST', body: input });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  const org = result.data.organizationId;
  const settings = readOrganizationSettings(server.db, org);
  assert.equal(settings.name, input.name);
  assert.equal(settings.profile.legalEntity, input.legalEntity);
  assert.equal(settings.profile.brandName, input.brandName);
  assert.equal(settings.policy.countryCode, 'ID');
  assert.equal(settings.policy.language, 'EN');
  assert.equal(settings.policy.industry, 'general');
  assert.equal(settings.policy.defaultCurrency, 'IDR');
  assert.equal((server.db.prepare('SELECT role FROM member WHERE userId = ? AND organizationId = ?').get(ids.nomember, org) as any).role, 'admin');
  assert.equal((server.db.prepare('SELECT role FROM "user" WHERE id = ?').get(ids.nomember) as any).role, 'user');
  assert.equal((await server.call(who, `/api/organizations/${org}/settings`)).status, 200);
  assert.equal((await server.call(who, `/api/organizations/${ids.orgA}/settings`)).status, 404);
  assert.equal((server.db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE tenant_id = ? AND action = ?').get(org, 'organization.create') as any).n, 1);
  const before = server.snapshot();
  assert.equal((await server.call(who, '/api/me/organization', { method: 'POST', body: input })).status, 409);
  assert.equal(server.snapshot(), before);
});

test('registration needs superuser approval; approved users can onboard without verifying email', async () => {
  const email = 'fresh.registration@example.test';
  const signup = await server.call(null, '/api/auth/sign-up/email', { method: 'POST', headers: { origin: server.base },
    body: { name: 'Fresh User', email, password: 'correct-horse-9' } });
  assert.equal(signup.status, 200, JSON.stringify(signup.data));
  const user = server.db.prepare('SELECT id, banned, banReason, emailVerified FROM "user" WHERE email = ?').get(email) as any;
  assert.equal(user.banned, 1);
  assert.equal(user.banReason, 'PENDING_APPROVAL');
  assert.equal(user.emailVerified, 0);
  const session = server.session(user.id);
  assert.equal((await server.call(session, '/api/me/organization', { method: 'POST', body: input })).status, 403);
  const path = `/api/auth-console/users/${user.id}/ban`;
  assert.equal((await server.call(server.session(ids.adminA), path, { method: 'POST', body: { banned: false } })).status, 403);
  assert.equal((await server.call(server.session(ids.super), path, { method: 'POST', body: { banned: false } })).status, 200);
  const signin = await server.call(null, '/api/auth/sign-in/email', { method: 'POST', headers: { origin: server.base }, body: { email, password: 'correct-horse-9' } });
  assert.equal(signin.status, 200, JSON.stringify(signin.data));
  const created = await server.call({ userId: user.id, token: signin.data.token }, '/api/me/organization', { method: 'POST', body: { ...input, name: 'Registered Workspace' } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal((server.db.prepare('SELECT emailVerified FROM "user" WHERE id = ?').get(user.id) as any).emailVerified, 0);
});

test('a failed audit rolls back organization and membership creation', async () => {
  const userId = createIdentityRecord(server.db, { name: 'Rollback', email: 'rollback@example.test', platformRole: 'user' });
  const who = server.session(userId);
  const before = server.snapshot();
  server.db.exec("CREATE TRIGGER fail_onboarding_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'test audit failure'); END");
  try {
    assert.equal((await server.call(who, '/api/me/organization', { method: 'POST', body: input })).status, 500);
    assert.equal(server.snapshot(), before);
    assert.equal((server.db.prepare('SELECT COUNT(*) AS n FROM organization WHERE name = ?').get(input.name) as any).n, 1);
  } finally { server.db.exec('DROP TRIGGER fail_onboarding_audit'); }
});

test('admins generate 24-hour invite codes; unverified approved users can join exactly once', async () => {
  const path = '/api/organizations/org-a/invite-codes';
  const body = { tenantRole: 'viewer', departmentIds: ['team-a-legal'] };
  for (const key of ['viewerA', 'managerA']) assert.equal((await server.call(server.session(ids[key]), path, { method: 'POST', body })).status, 403);
  const start = Date.now();
  const created = await server.call(server.session(ids.adminA), path, { method: 'POST', body });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const { inviteCode, expiresAt } = created.data;
  assert.match(inviteCode, /^[A-Za-z0-9_-]{32}$/);
  assert.ok(Date.parse(expiresAt) >= start + 86400000 && Date.parse(expiresAt) <= Date.now() + 86400000);
  const blockedId = createIdentityRecord(server.db, { name: 'Pending', email: 'pending.code@example.test', platformRole: 'user', emailVerified: false });
  server.db.prepare("UPDATE user SET banned = 1, banReason = 'PENDING_APPROVAL' WHERE id = ?").run(blockedId);
  const blocked = await server.call(server.session(blockedId), `/api/invitations/${inviteCode}/accept`, { method: 'POST' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error, 'ACCOUNT_PENDING_APPROVAL');
  assert.equal((server.db.prepare('SELECT status FROM invitation WHERE id = ?').get(inviteCode) as any).status, 'pending');
  const user = server.session(ids.unverified);
  assert.equal((await server.call(user, `/api/invitations/${inviteCode}/accept`, { method: 'POST' })).status, 201);
  assert.equal((await server.call(user, `/api/invitations/${inviteCode}/accept`, { method: 'POST' })).status, 409);
  const expired = await server.call(server.session(ids.adminA), path, { method: 'POST', body });
  assert.equal(expired.status, 201);
  server.db.prepare('UPDATE invitation SET expiresAt = ? WHERE id = ?').run(new Date(Date.now() - 1).toISOString(), expired.data.inviteCode);
  assert.equal((await server.call(server.session(ids.nomember), `/api/invitations/${expired.data.inviteCode}/accept`, { method: 'POST' })).status, 409);
  const revoked = await server.call(server.session(ids.adminA), path, { method: 'POST', body });
  server.db.prepare("UPDATE member SET status = 'suspended' WHERE userId = ? AND organizationId = 'org-a'").run(ids.adminA);
  assert.equal((await server.call(server.session(ids.nomember), `/api/invitations/${revoked.data.inviteCode}/accept`, { method: 'POST' })).status, 409);
});
