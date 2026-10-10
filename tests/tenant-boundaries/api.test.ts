/**
 * Live API acceptance tests against an isolated server (tenant-boundaries PRD §16).
 * Run through `npm run test:tenant-boundaries` (tools/run-tenant-boundaries-tests.mjs).
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IsolatedServer, membershipIdOf, seedFixtures, type Session } from './harness';
import { betterAuthEndpoints } from '../../tools/gen-endpoint-inventory';
import { isBetterAuthPathAllowed } from '../../apps/backend/src/routePolicies';

let server: IsolatedServer;
let ids: Record<string, string>;
const S: Record<string, Session> = {};
const A = 'org-a';
const B = 'org-b';

before(async () => {
  server = await IsolatedServer.start();
  ids = seedFixtures(server);
  await server.restart(); // rebuild the read projection from the seeded canonical rows
  for (const key of ['super', 'adminA', 'adminB', 'managerA', 'editorA', 'viewerA', 'financeViewerA', 'multi', 'targetEditor', 'noDept', 'suspended', 'nomember', 'banned', 'unverified']) {
    S[key] = server.session(ids[key]);
  }
  // Operational fixtures through the API itself (admin in A, platform context in B).
  const partner = async (who: Session, org: string, name: string, pic: string) => {
    const res = await server.call(who, '/api/partners', { method: 'POST', org, body: { nama_partner: name, pic_internal: pic } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    return res.data.partner;
  };
  ids.pLegal = (await partner(S.adminA, A, 'Acme Legal Services', 'Legal')).partner_id;
  ids.pFinance = (await partner(S.adminA, A, 'Finance Vendor', 'Finance')).partner_id;
  ids.pNone = (await partner(S.adminA, A, 'Unassigned Vendor', '')).partner_id;
  ids.pB = (await partner(S.super, B, 'Beta Legal Partner', 'Legal')).partner_id;
});

after(async () => {
  await server?.stop();
});

describe('identity and session boundary (AC-020)', () => {
  it('rejects missing, expired, revoked and banned sessions on every path family', async () => {
    const expired = server.session(ids.viewerA, { expiresInMs: -1000 });
    for (const path of ['/api/me', '/api/init-data', `/api/organizations/${A}/capabilities`, '/api/auth/list-sessions']) {
      assert.equal((await server.call(null, path, { org: A })).status, 401, path);
      assert.equal((await server.call(expired, path, { org: A })).status, 401, path);
      const banned = await server.call(S.banned, path, { org: A });
      assert.equal(banned.status, 403, path);
      assert.equal(banned.data.error, 'ACCOUNT_DISABLED');
    }
    assert.equal((await server.call(null, '/uploads/anything.pdf')).status, 401);
  });

  it('never trusts identity or role headers', async () => {
    const res = await server.call(null, '/api/me', { headers: { 'x-user-email': 'super@example.test', 'x-user-role': 'superuser' } });
    assert.equal(res.status, 401);
  });

  it('uses the standard error envelope with a request id', async () => {
    const res = await server.call(S.viewerA, `/api/organizations/${A}/settings`);
    assert.equal(res.status, 403);
    assert.equal(res.data.error, 'INSUFFICIENT_PERMISSION');
    assert.equal(typeof res.data.message, 'string');
    assert.equal(typeof res.data.requestId, 'string');
  });

  it('denies unclassified API routes', async () => {
    assert.equal((await server.call(S.adminA, '/api/not-a-route', { org: A })).status, 404);
    assert.equal((await server.call(S.adminA, '/api/tenant-data', { org: A })).status, 404);
  });
});

describe('identity DTO and side-effect-free reads (AC-008, AC-043)', () => {
  it('/api/me lists only own memberships, including suspended ones', async () => {
    const me = await server.call(S.multi, '/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.data.identity.platformRole, 'user');
    assert.deepEqual(me.data.memberships.map((m: any) => [m.organizationId, m.tenantRole]).sort(), [[A, 'admin'], [B, 'viewer']]);
    assert.deepEqual(me.data.platformPermissions, []);
    const suspended = await server.call(S.suspended, '/api/me');
    assert.equal(suspended.data.memberships.find((m: any) => m.organizationId === A).status, 'suspended');
    const sup = await server.call(S.super, '/api/me');
    assert.equal(sup.data.identity.platformRole, 'superuser');
    assert.deepEqual(sup.data.memberships, []);
    assert.ok(sup.data.platformPermissions.includes('platform.configuration.update'));
  });

  it('repeated GETs create no membership, allowlist row, team, selection or mapping', async () => {
    const before = server.snapshot();
    for (let i = 0; i < 2; i++) {
      for (const who of [S.adminA, S.nomember, S.super, S.multi]) {
        await server.call(who, '/api/me');
        await server.call(who, '/api/user/my-role');
        await server.call(who, '/api/tenants');
        await server.call(who, '/api/departments', { org: A });
        await server.call(who, `/api/organizations/${A}/capabilities`);
        await server.call(who, '/api/google-integration/sync-status', { org: A });
        await server.call(who, '/api/system/status');
      }
    }
    assert.equal(server.snapshot(), before);
  });

  it('no-membership identity sees no organizations and no business data', async () => {
    const tenants = await server.call(S.nomember, '/api/tenants');
    assert.deepEqual(tenants.data.tenants, []);
    assert.equal((await server.call(S.nomember, '/api/init-data')).status, 409);
    assert.equal((await server.call(S.nomember, '/api/init-data', { org: A })).status, 404);
  });

  it('superuser switcher is the platform directory without fabricated memberships', async () => {
    const tenants = await server.call(S.super, '/api/tenants');
    assert.deepEqual(tenants.data.organizations.map((o: any) => [o.organizationId, o.accessMode, o.tenantRole]).sort(), [[A, 'platform', null], [B, 'platform', null]]);
  });
});

describe('organization selection (AC-005, AC-006, AC-007)', () => {
  it('foreign selectors in header, query, body or path reveal nothing', async () => {
    for (const res of [
      await server.call(S.adminA, '/api/init-data', { org: B }),
      await server.call(S.adminA, `/api/init-data?tenantId=${B}`),
      await server.call(S.adminA, `/api/organizations/${B}/capabilities`),
      await server.call(S.adminA, `/api/organizations/${B}/members`),
      await server.call(S.adminA, '/api/partners', { method: 'POST', body: { nama_partner: 'x', organizationId: B } }),
    ]) {
      assert.equal(res.status, 404, JSON.stringify(res.data));
      assert.ok(!JSON.stringify(res.data).includes('Beta'));
    }
  });

  it('disagreeing selectors are rejected without mutation', async () => {
    const before = (server.db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as any).n;
    const res = await server.call(S.multi, `/api/init-data?tenantId=${B}`, { org: A });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'ORGANIZATION_SELECTOR_CONFLICT');
    const patch = await server.call(S.multi, `/api/organizations/${A}/settings`, { method: 'PATCH', headers: { 'x-organization-id': B }, body: { expectedVersion: 1, name: 'x' } });
    assert.equal(patch.status, 400);
    assert.equal((server.db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as any).n, before);
  });

  it('an explicit permitted selector beats the session default and its role governs', async () => {
    const tab = server.session(ids.multi, { activeOrganizationId: A });
    const caps = await server.call(tab, `/api/organizations/${B}/capabilities`);
    assert.equal(caps.data.tenantRole, 'viewer');
    assert.equal((await server.call(tab, '/api/tenant-settings', { method: 'PUT', org: B, body: { settings: { expiryWarningDays: 40 } } })).status, 403);
    assert.equal((await server.call(tab, '/api/init-data')).data.organizationId, A); // default only without selector
    assert.equal((await server.call(tab, '/api/init-data', { org: B })).data.organizationId, B);
  });

  it('switching changes only the calling session default; no global active tenant', async () => {
    const one = server.session(ids.multi, { activeOrganizationId: A });
    const two = server.session(ids.multi, { activeOrganizationId: A });
    const res = await server.call(one, '/api/me/active-organization', { method: 'POST', body: { organizationId: B } });
    assert.equal(res.status, 200);
    const rows = server.db.prepare('SELECT token, activeOrganizationId FROM session WHERE token IN (?, ?)').all(one.token, two.token) as any[];
    assert.deepEqual(rows.map((r) => [r.token === one.token, r.activeOrganizationId]).sort(), [[false, A], [true, B]]);
    assert.equal((await server.call(S.adminA, '/api/me/active-organization', { method: 'POST', body: { organizationId: B } })).status, 404);
    assert.equal((await server.call(one, '/api/me/active-organization', { method: 'POST', org: A, body: { organizationId: B } })).status, 400);
  });

  it('suspension ends access to that organization only (AC-019)', async () => {
    const res = await server.call(S.suspended, '/api/init-data', { org: A });
    assert.equal(res.status, 404);
    const other = await server.call(S.suspended, '/api/init-data', { org: B, headers: {} });
    assert.equal(other.status, 404); // suspended user has no active B membership either; see suspended2 fixture
    const s2 = server.session(ids.suspended2);
    assert.equal((await server.call(s2, '/api/init-data', { org: B })).status, 200);
  });
});

describe('scoped operational data (AC-009, AC-045)', () => {
  it('init-data returns the scoped DTO without tenants or provider configuration', async () => {
    const res = await server.call(S.adminA, '/api/init-data', { org: A });
    assert.deepEqual(Object.keys(res.data).sort(), ['contracts', 'evaluations', 'ios', 'notifications', 'organizationId', 'partners', 'services', 'spendings', 'timestamp']);
    assert.deepEqual(Object.keys(res.data.services).sort(), ['aiAvailable', 'googleUploadsAvailable']);
    assert.deepEqual(res.data.partners.map((p: any) => p.partner_id).sort(), [ids.pFinance, ids.pLegal, ids.pNone].sort());
  });

  it('department roles see only exact-department records; no-department members see none', async () => {
    const legal = await server.call(S.viewerA, '/api/init-data', { org: A });
    assert.deepEqual(legal.data.partners.map((p: any) => p.partner_id), [ids.pLegal]);
    const finance = await server.call(S.financeViewerA, '/api/partners', { org: A });
    assert.deepEqual(finance.data.map((p: any) => p.partner_id), [ids.pFinance]);
    const none = await server.call(S.noDept, '/api/init-data', { org: A });
    assert.equal(none.status, 200);
    assert.deepEqual(none.data.partners, []);
    const b = await server.call(S.multi, '/api/partners', { org: B });
    assert.deepEqual(b.data.map((p: any) => p.partner_id), [ids.pB]); // same department name, other organization
  });

  it('records outside department scope cannot be read or written by ID', async () => {
    const res = await server.call(S.editorA, `/api/partners/${ids.pFinance}`, { method: 'PUT', org: A, body: { catatan: 'x' } });
    assert.equal(res.status, 404);
    const move = await server.call(S.editorA, `/api/partners/${ids.pLegal}`, { method: 'PUT', org: A, body: { pic_internal: 'Finance' } });
    assert.equal(move.status, 403);
    const create = await server.call(S.editorA, '/api/partners', { method: 'POST', org: A, body: { nama_partner: 'Outside', pic_internal: 'Finance' } });
    assert.equal(create.status, 403);
    assert.equal((await server.call(S.viewerA, '/api/partners', { method: 'POST', org: A, body: { nama_partner: 'V' } })).status, 403);
  });

  it('settings and integration DTOs carry no platform secrets', async () => {
    const settings = await server.call(S.adminA, `/api/organizations/${A}/settings`);
    const integration = await server.call(S.adminA, `/api/organizations/${A}/integrations/google`);
    const text = JSON.stringify([settings.data, integration.data]);
    for (const secret of ['geminiApiKey', 'smtpPassword', 'accessToken', 'refreshToken', 'masterSpreadsheetId', 'smtpHost']) assert.ok(!text.includes(secret), secret);
    assert.equal(integration.data.syncSupported, false);
    assert.equal(integration.data.effectiveAutoSync, false);
  });
});

describe('platform boundary (AC-010, AC-011, AC-013, AC-033)', () => {
  it('raw Better Auth admin and organization plugin routes are denied', async () => {
    for (const [method, path] of [
      ['GET', '/api/auth/admin/list-users'], ['POST', '/api/auth/admin/set-role'], ['POST', '/api/auth/admin/ban-user'],
      ['POST', '/api/auth/admin/set-user-password'], ['POST', '/api/auth/admin/list-user-sessions'],
      ['POST', '/api/auth/organization/create'], ['POST', '/api/auth/organization/invite-member'],
      ['POST', '/api/auth/organization/update-member-role'], ['POST', '/api/auth/organization/set-active'],
      ['GET', '/api/auth/organization/list-members'], ['POST', '/api/auth/organization/accept-invitation'],
    ]) {
      const res = await server.call(S.adminA, path, { method, body: method === 'POST' ? { userId: ids.adminA, role: 'superuser', organizationId: A } : undefined });
      assert.equal(res.status, 404, path);
    }
    assert.equal((server.db.prepare(`SELECT role FROM "user" WHERE id = ?`).get(ids.adminA) as any).role, 'user');
  });

  it('every installed Better Auth route outside the allowlist is denied', async () => {
    const denied = betterAuthEndpoints().filter(({ path }) => !isBetterAuthPathAllowed(path.replace(/\/:[^/]+$/, '/x')));
    assert.ok(denied.some(({ family }) => family === 'admin plugin') && denied.some(({ family }) => family === 'organization plugin'));
    for (const { path } of denied) {
      const concrete = path.replace(/:[^/]+/g, 'x');
      for (const who of [S.adminA, S.super]) {
        const res = await server.call(who, concrete, { method: 'POST', body: { userId: ids.adminA, role: 'superuser', organizationId: A } });
        assert.equal(res.status, 404, concrete);
      }
    }
    assert.equal((server.db.prepare(`SELECT role FROM "user" WHERE id = ?`).get(ids.adminA) as any).role, 'user');
  });

  it('tenant admins are denied every platform configuration, credential, database and reset route', async () => {
    for (const [method, path] of [
      ['GET', '/api/platform/configuration'], ['PATCH', '/api/platform/configuration'], ['GET', '/api/google-integration'],
      ['POST', '/api/google-integration'], ['POST', '/api/smtp/test'], ['POST', '/api/ai/test-key'], ['GET', '/api/integrations/google/credentials'],
      ['POST', '/api/admin/reset-database'], ['GET', '/api/auth-console/sqlite/status'], ['GET', '/api/auth-console/users'],
      ['PUT', `/api/auth-console/users/${ids.adminA}/role`], ['POST', `/api/auth-console/users/${ids.viewerA}/ban`],
      ['GET', '/api/rbac/matrix'], ['POST', '/api/branding'], ['GET', '/api/auth/google/token'], ['POST', '/api/cron/trigger-check'],
      ['GET', '/api/platform/audit'],
    ]) {
      const res = await server.call(S.adminA, path, { method, org: A, body: method === 'GET' ? undefined : { section: 'ai', values: {}, platformRole: 'superuser', confirmKeyword: 'RESET NOW' } });
      assert.equal(res.status, 403, `${method} ${path}`);
    }
  });

  it('superuser platform configuration hides secrets and validates sections', async () => {
    const set = await server.call(S.super, '/api/platform/configuration', { method: 'PATCH', body: { section: 'ai', values: { geminiApiKey: 'test-key-123456' } } });
    assert.equal(set.status, 200);
    const read = await server.call(S.super, '/api/platform/configuration');
    assert.equal(read.data.ai.hasGeminiApiKey, true);
    assert.ok(!JSON.stringify(read.data).includes('test-key-123456'));
    assert.equal((await server.call(S.super, '/api/platform/configuration', { method: 'PATCH', body: { section: 'ai', values: { notificationEmails: 'x' } } })).status, 400);
    assert.equal((await server.call(S.super, '/api/platform/configuration', { method: 'PATCH', body: { section: 'tenant', values: {} } })).status, 400);
  });

  it('System Admin can read, upload and remove Google JSON credentials through the real authorization boundary', async () => {
    const base = '/api/integrations/google/credentials';
    const initial = await server.call(S.super, base);
    assert.equal(initial.status, 200, JSON.stringify(initial.data));
    assert.equal(initial.data.serviceAccount.source, null);
    assert.equal(initial.data.oauthClient.source, null);
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const serviceAccount = {
      type: 'service_account', project_id: 'test-project',
      client_email: 'test@test-project.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
    const oauthClient = { web: { client_id: '42-test.apps.googleusercontent.com', client_secret: 'test-oauth-secret', javascript_origins: ['http://localhost:3000'] } };
    for (const [method, path] of [['GET', base], ['PUT', `${base}/oauth-client`], ['DELETE', `${base}/oauth-client`]]) {
      const init = { method, body: method === 'PUT' ? { file: oauthClient } : undefined };
      assert.equal((await server.call(null, path, init)).status, 401);
      for (const who of [S.adminA, S.managerA, S.editorA, S.viewerA, S.nomember]) {
        assert.equal((await server.call(who, path, { ...init, headers: { 'x-user-role': 'superuser' } })).status, 403);
      }
    }
    const invalid = await server.call(S.super, `${base}/service-account`, { method: 'PUT', body: { file: { ...serviceAccount, private_key: '-----BEGIN PRIVATE KEY-----\ninvalid\n-----END PRIVATE KEY-----' } } });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.data.error, 'invalid_private_key');
    for (const [kind, file] of [['service-account', serviceAccount], ['oauth-client', oauthClient]] as const) {
      const uploaded = await server.call(S.super, `${base}/${kind}`, { method: 'PUT', body: { file } });
      assert.equal(uploaded.status, 200, JSON.stringify(uploaded.data));
      const status = await server.call(S.super, base);
      assert.equal(status.data[kind === 'service-account' ? 'serviceAccount' : 'oauthClient'].source, 'upload');
      assert.ok(!JSON.stringify(status.data).includes('PRIVATE KEY'));
      assert.ok(!JSON.stringify(status.data).includes('test-oauth-secret'));
    }
    assert.equal((server.db.prepare('SELECT COUNT(*) AS n FROM integration_credentials').get() as any).n, 2);
    for (const kind of ['service-account', 'oauth-client']) {
      assert.equal((await server.call(S.super, `${base}/${kind}`, { method: 'DELETE' })).status, 200);
    }
    assert.equal((server.db.prepare('SELECT COUNT(*) AS n FROM integration_credentials').get() as any).n, 0);
    const removed = await server.call(S.super, base);
    assert.equal(removed.data.serviceAccount.source, null);
    assert.equal(removed.data.oauthClient.source, null);
  });

  it('public branding exposes presentation fields only', async () => {
    const res = await server.call(null, '/api/branding');
    assert.deepEqual(Object.keys(res.data.branding).sort(), ['appName', 'footerText', 'loginHeadline', 'logoUrl', 'primaryColor']);
  });
});

describe('membership administration (AC-012, AC-013, AC-014, AC-031)', () => {
  it('manager lists self plus intersecting departments; editors get no list', async () => {
    const list = await server.call(S.managerA, `/api/organizations/${A}/members`);
    assert.equal(list.status, 200);
    const emails = list.data.members.map((m: any) => m.email).sort();
    assert.ok(emails.includes('targeteditor@example.test'), JSON.stringify(emails));
    assert.ok(!emails.includes('financeviewera@example.test'), JSON.stringify(emails));
    assert.ok(!JSON.stringify(list.data).match(/"(platformRole|banned|banReason|sessionCount)":/));
    assert.equal((await server.call(S.editorA, `/api/organizations/${A}/members`)).status, 403);
  });

  it('manager cannot change a partially overlapping target (AC-014)', async () => {
    const target = membershipIdOf(server, ids.targetEditor, A)!;
    const res = await server.call(S.managerA, `/api/organizations/${A}/members/${target}`, { method: 'PATCH', body: { status: 'suspended' } });
    assert.equal(res.status, 403);
    assert.equal((server.db.prepare('SELECT status FROM member WHERE id = ?').get(target) as any).status, 'active');
  });

  it('tenant admin cannot appoint a peer admin or change its own role (AC-013)', async () => {
    const viewer = membershipIdOf(server, ids.viewerA, A)!;
    assert.equal((await server.call(S.adminA, `/api/organizations/${A}/members/${viewer}`, { method: 'PATCH', body: { tenantRole: 'admin' } })).status, 403);
    const self = membershipIdOf(server, ids.adminA, A)!;
    assert.equal((await server.call(S.adminA, `/api/organizations/${A}/members/${self}`, { method: 'PATCH', body: { tenantRole: 'viewer', departmentIds: ['team-a-legal'] } })).status, 403);
    assert.equal((await server.call(S.adminA, `/api/organizations/${A}/members/${viewer}`, { method: 'PATCH', body: { tenantRole: 'owner' } })).status, 400);
  });

  it('department assignment rejects foreign departments atomically', async () => {
    const viewer = membershipIdOf(server, ids.viewerA, A)!;
    const res = await server.call(S.adminA, `/api/organizations/${A}/members/${viewer}`, { method: 'PATCH', body: { departmentIds: ['team-a-legal', 'team-b-legal'] } });
    assert.equal(res.status, 400);
    assert.deepEqual((server.db.prepare(`SELECT teamId FROM teamMember WHERE userId = ?`).all(ids.viewerA) as any[]).map((r) => r.teamId), ['team-a-legal']);
  });

  it('removing a multi-organization member touches only that organization (AC-012)', async () => {
    const session = server.session(ids.multi);
    const sup = server.session(ids.super);
    const membership = membershipIdOf(server, ids.multi, A)!;
    const res = await server.call(sup, `/api/organizations/${A}/members/${membership}`, { method: 'DELETE' });
    assert.equal(res.status, 204);
    assert.equal(membershipIdOf(server, ids.multi, A), undefined);
    assert.ok(membershipIdOf(server, ids.multi, B));
    assert.ok(server.db.prepare(`SELECT 1 FROM "user" WHERE id = ?`).get(ids.multi));
    assert.equal((await server.call(session, '/api/init-data', { org: B })).status, 200);
    assert.equal((await server.call(session, '/api/init-data', { org: A })).status, 404);
    const audit = server.db.prepare(`SELECT metadata FROM audit_log WHERE action = 'membership.remove' AND target_id = ?`).get(membership) as any;
    assert.equal(JSON.parse(audit.metadata).accessMode, 'platform');
  });

  it('the last usable admin cannot be removed, suspended, demoted or banned (AC-031)', async () => {
    const adminB = membershipIdOf(server, ids.adminB, B)!;
    const demote = await server.call(S.super, `/api/organizations/${B}/members/${adminB}`, { method: 'PATCH', body: { tenantRole: 'viewer', departmentIds: ['team-b-legal'] } });
    assert.equal(demote.status, 409);
    assert.equal(demote.data.error, 'LAST_ADMIN_REQUIRED');
    assert.equal((await server.call(S.super, `/api/organizations/${B}/members/${adminB}`, { method: 'DELETE' })).status, 409);
    assert.equal((await server.call(S.super, `/api/auth-console/users/${ids.adminB}/ban`, { method: 'POST', body: { banned: true } })).status, 409);
    const lastSuper = await server.call(S.super, `/api/auth-console/users/${ids.super}/role`, { method: 'PUT', body: { platformRole: 'user' } });
    assert.equal(lastSuper.status, 403); // self-change is never allowed

    // Concurrent demotions of B's only two admins: the invariant lets at most one through.
    const second = membershipIdOf(server, ids.suspended2, B)!;
    assert.equal((await server.call(S.super, `/api/organizations/${B}/members/${second}`, { method: 'PATCH', body: { tenantRole: 'admin' } })).status, 200);
    const demotions = await Promise.all([adminB, second].map((id) => server.call(S.super, `/api/organizations/${B}/members/${id}`, {
      method: 'PATCH', body: { tenantRole: 'viewer', departmentIds: ['team-b-legal'] },
    })));
    assert.deepEqual(demotions.map((r) => r.status).sort(), [200, 409]);
    const admins = (server.db.prepare(`SELECT COUNT(*) AS n FROM member WHERE organizationId = ? AND role = 'admin' AND status = 'active'`).get(B) as any).n;
    assert.equal(admins, 1);
    // Restore the fixture: adminB is B's admin again, suspended2 a Legal viewer.
    if (demotions[0].status === 200) {
      assert.equal((await server.call(S.super, `/api/organizations/${B}/members/${adminB}`, { method: 'PATCH', body: { tenantRole: 'admin' } })).status, 200);
      assert.equal((await server.call(S.super, `/api/organizations/${B}/members/${second}`, { method: 'PATCH', body: { tenantRole: 'viewer', departmentIds: ['team-b-legal'] } })).status, 200);
    }
  });

  it('platform account creation never grants a membership', async () => {
    const res = await server.call(S.super, '/api/auth-console/users', { method: 'POST', body: { name: 'New Person', email: 'new.person@example.test', platformRole: 'user' } });
    assert.equal(res.status, 201);
    assert.equal((server.db.prepare('SELECT COUNT(*) AS n FROM member WHERE userId = ?').get(res.data.user.id) as any).n, 0);
  });
});

describe('departments (AC-032)', () => {
  it('creates, rejects duplicates case-insensitively, and refuses to delete a department in use', async () => {
    const created = await server.call(S.adminA, `/api/organizations/${A}/departments`, { method: 'POST', body: { name: 'Procurement' } });
    assert.equal(created.status, 201);
    assert.equal((await server.call(S.adminA, `/api/organizations/${A}/departments`, { method: 'POST', body: { name: 'procurement' } })).status, 409);
    assert.equal((await server.call(S.adminB, `/api/organizations/${B}/departments`, { method: 'POST', body: { name: 'Procurement' } })).status, 201);
    const inUse = await server.call(S.adminA, `/api/organizations/${A}/departments/team-a-legal`, { method: 'DELETE' });
    assert.equal(inUse.status, 409);
    assert.equal(inUse.data.error, 'DEPARTMENT_IN_USE');
    assert.equal((await server.call(S.adminA, `/api/organizations/${A}/departments/${created.data.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await server.call(S.managerA, `/api/organizations/${A}/departments`, { method: 'POST', body: { name: 'X' } })).status, 403);
    const visible = await server.call(S.managerA, `/api/organizations/${A}/departments`);
    assert.deepEqual(visible.data.departments.map((d: any) => d.id), ['team-a-legal']);
  });
});

describe('invitations (AC-015, AC-016, AC-017, AC-018)', () => {
  it('rejects invalid targets before any invitation exists', async () => {
    const count = () => (server.db.prepare('SELECT COUNT(*) AS n FROM invitation').get() as any).n;
    const before = count();
    for (const body of [
      { email: 'x1@example.test', tenantRole: 'superuser', departmentIds: [] },
      { email: 'x2@example.test', tenantRole: 'viewer', departmentIds: ['team-b-legal'] },
      { email: 'x3@example.test', tenantRole: 'viewer', departmentIds: ['team-a-legal'], organizationId: B },
      { email: 'x4@example.test', tenantRole: 'owner', departmentIds: [] },
      { email: 'x5@example.test', tenantRole: 'admin', departmentIds: [] },
    ]) {
      const res = await server.call(S.adminA, `/api/organizations/${A}/invitations`, { method: 'POST', body });
      assert.ok([400, 403].includes(res.status), JSON.stringify([body, res.data]));
    }
    assert.equal((await server.call(S.managerA, `/api/organizations/${A}/invitations`, { method: 'POST', body: { email: 'x6@example.test', tenantRole: 'editor', departmentIds: ['team-a-finance'] } })).status, 403);
    assert.equal(count(), before);
  });

  it('accepts exactly once for the verified invited identity', async () => {
    const created = await server.call(S.adminA, `/api/organizations/${A}/invitations`, { method: 'POST', body: { email: 'nomember@example.test', tenantRole: 'editor', departmentIds: ['team-a-legal'] } });
    assert.equal(created.status, 201);
    assert.equal(created.data.delivery, 'not_sent');
    const token = new URL(created.data.inviteUrl).searchParams.get('accept_invite')!;
    assert.ok(token.length >= 22);
    const preview = await server.call(null, `/api/invitations/${token}/preview`);
    assert.deepEqual(Object.keys(preview.data).sort(), ['expiresAt', 'organizationName', 'status', 'tenantRole']);
    assert.equal((await server.call(S.viewerA, `/api/invitations/${token}/accept`, { method: 'POST' })).data.error, 'INVITATION_IDENTITY_MISMATCH');
    assert.equal((await server.call(S.adminA, `/api/organizations/${A}/invitations`, { method: 'POST', body: { email: 'nomember@example.test', tenantRole: 'viewer', departmentIds: ['team-a-legal'] } })).data.error, 'INVITATION_EXISTS');
    const [first, second] = await Promise.all([
      server.call(S.nomember, `/api/invitations/${token}/accept`, { method: 'POST' }),
      server.call(S.nomember, `/api/invitations/${token}/accept`, { method: 'POST' }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [201, 409]);
    assert.equal((server.db.prepare('SELECT COUNT(*) AS n FROM member WHERE userId = ? AND organizationId = ?').get(ids.nomember, A) as any).n, 1);
    assert.equal((server.db.prepare(`SELECT role FROM "user" WHERE id = ?`).get(ids.nomember) as any).role, 'user');
    assert.equal((await server.call(S.nomember, `/api/invitations/${token}/accept`, { method: 'POST' })).status, 409);
  });

  it('refuses canceled, expired and revoked-inviter invitations without email verification', async () => {
    const make = async (who: Session, email: string, role = 'viewer') => {
      const res = await server.call(who, `/api/organizations/${A}/invitations`, { method: 'POST', body: { email, tenantRole: role, departmentIds: ['team-a-legal'] } });
      assert.equal(res.status, 201, JSON.stringify(res.data));
      return { id: res.data.invitation.id as string, token: new URL(res.data.inviteUrl).searchParams.get('accept_invite')! };
    };
    const unverified = await make(S.adminA, 'unverified@example.test');
    assert.equal((await server.call(S.adminA, `/api/organizations/${A}/invitations/${unverified.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await server.call(S.unverified, `/api/invitations/${unverified.token}/accept`, { method: 'POST' })).data.error, 'INVITATION_NOT_ACCEPTABLE');
    const expired = await make(S.adminA, 'unverified@example.test');
    server.db.prepare(`UPDATE invitation SET expiresAt = ? WHERE id = ?`).run(new Date(Date.now() - 1000).toISOString(), expired.id);
    assert.equal((await server.call(S.unverified, `/api/invitations/${expired.token}/accept`, { method: 'POST' })).data.error, 'INVITATION_NOT_ACCEPTABLE');
    assert.equal((await server.call(S.adminA, `/api/organizations/${A}/invitations/${expired.id}/resend`, { method: 'POST' })).status, 200);
    // Revoked inviter: the manager who issued the invitation is suspended before acceptance.
    const byManager = await make(S.managerA, 'financeviewera2@example.test');
    server.db.prepare(`UPDATE member SET status = 'suspended' WHERE id = ?`).run(membershipIdOf(server, ids.managerA, A));
    const invitee = server.session((server.db.prepare(`SELECT id FROM "user" WHERE id = ?`).get(ids.nomember) as any).id);
    server.db.prepare(`UPDATE invitation SET email = 'nomember@example.test' WHERE id = ?`).run(byManager.id);
    server.db.prepare(`DELETE FROM member WHERE userId = ? AND organizationId = ?`).run(ids.nomember, A);
    assert.equal((await server.call(invitee, `/api/invitations/${byManager.token}/accept`, { method: 'POST' })).data.error, 'INVITATION_NOT_ACCEPTABLE');
    server.db.prepare(`UPDATE member SET status = 'active' WHERE id = ?`).run(membershipIdOf(server, ids.managerA, A));
    assert.equal((await server.call(null, '/api/invitations/not-a-token-xyz/preview')).status, 404);
  });

  it('email/password signup always waits for superuser approval, including invited accounts', async () => {
    const signup = async (email: string) => fetch(`${server.base}/api/auth/sign-up/email`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: server.base }, body: JSON.stringify({ name: 'Sign Up', email, password: 'correct-horse-9' }),
    });
    await signup('stranger@example.test');
    const stranger = server.db.prepare(`SELECT id, role, banned, banReason, emailVerified FROM "user" WHERE email = ?`).get('stranger@example.test') as any;
    assert.deepEqual([stranger.role, stranger.banned, stranger.banReason, stranger.emailVerified], ['user', 1, 'PENDING_APPROVAL', 0]);
    assert.equal((server.db.prepare('SELECT COUNT(*) AS n FROM member WHERE userId = ?').get(stranger.id) as any).n, 0);
    await server.call(S.adminA, `/api/organizations/${A}/invitations`, { method: 'POST', body: { email: 'invited.signup@example.test', tenantRole: 'viewer', departmentIds: ['team-a-legal'] } });
    await signup('invited.signup@example.test');
    const invited = server.db.prepare(`SELECT id, role, banned, emailVerified FROM "user" WHERE email = ?`).get('invited.signup@example.test') as any;
    assert.deepEqual([invited.role, invited.banned, invited.emailVerified], ['user', 1, 0]);
    assert.equal((server.db.prepare('SELECT COUNT(*) AS n FROM member WHERE userId = ?').get(invited.id) as any).n, 0);
  });
});

describe('settings and integrations (AC-021, AC-022, AC-023, AC-024, AC-038)', () => {
  it('platform organization cards use the canonical default currency before and after region changes', async () => {
    const initial = await server.call(S.adminA, `/api/organizations/${A}/settings`);
    const directoryCurrency = async (id: string) => {
      const response = await server.call(S.super, '/api/auth-console/organizations');
      assert.equal(response.status, 200);
      return response.data.organizations.find((org: any) => org.id === id).metadata.currency;
    };
    assert.equal(await directoryCurrency(A), initial.data.policy.defaultCurrency);
    const other = await directoryCurrency(B);
    const currency = initial.data.policy.defaultCurrency === 'EUR' ? 'JPY' : 'EUR';
    const saved = await server.call(S.adminA, `/api/organizations/${A}/settings`, {
      method: 'PATCH', body: { expectedVersion: initial.data.version, policy: { defaultCurrency: currency } },
    });
    assert.equal(saved.status, 200);
    assert.equal(await directoryCurrency(A), saved.data.policy.defaultCurrency);
    assert.equal(await directoryCurrency(B), other, 'changing A does not affect B');
    const summary = await server.call(S.viewerA, '/api/auth-console/organizations');
    assert.equal(summary.data.organizations.find((org: any) => org.id === A).metadata, undefined, 'ordinary summaries do not expose settings');
    await server.call(S.adminA, `/api/organizations/${A}/settings`, {
      method: 'PATCH', body: { expectedVersion: saved.data.version, policy: { defaultCurrency: initial.data.policy.defaultCurrency } },
    });
  });

  it('organization logo and tagline stay synchronized across tenant settings and the platform console', async () => {
    const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4U8AAAAASUVORK5CYII=';
    const initial = await server.call(S.adminA, `/api/organizations/${A}/settings`);
    const saved = await server.call(S.adminA, `/api/organizations/${A}/settings`, { method: 'PATCH', body: { expectedVersion: initial.data.version, profile: { logoUrl: logo, tagline: 'Tenant tagline' } } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const list = await server.call(S.super, '/api/auth-console/organizations');
    const org = list.data.organizations.find((item: any) => item.id === A);
    assert.equal(org.logo, logo);
    assert.equal(org.metadata.tagline, 'Tenant tagline');
    assert.equal(org.version, saved.data.version);
    const edited = await server.call(S.super, `/api/auth-console/organizations/${A}`, { method: 'PUT', body: { expectedVersion: org.version, name: initial.data.name, slug: initial.data.slug, profile: { logoUrl: '', tagline: 'Platform tagline' } } });
    assert.equal(edited.status, 200, JSON.stringify(edited.data));
    const reloaded = await server.call(S.adminA, `/api/organizations/${A}/settings`);
    assert.equal(reloaded.data.profile.logoUrl, '');
    assert.equal(reloaded.data.profile.tagline, 'Platform tagline');
    assert.deepEqual(reloaded.data.policy, initial.data.policy);
    const stale = await server.call(S.super, `/api/auth-console/organizations/${A}`, { method: 'PUT', body: { expectedVersion: org.version, name: 'Stale name', slug: 'stale-slug', profile: { logoUrl: logo } } });
    assert.equal(stale.status, 409);
    assert.equal((await server.call(S.adminA, `/api/organizations/${A}/settings`)).data.slug, initial.data.slug);
    const invalid = await server.call(S.adminA, `/api/organizations/${A}/settings`, { method: 'PATCH', body: { expectedVersion: reloaded.data.version, profile: { logoUrl: 'data:image/png;base64,YmFk' } } });
    assert.equal(invalid.status, 400);
  });
  it('section saves change only their fields and append audit', async () => {
    const current = await server.call(S.adminA, `/api/organizations/${A}/settings`);
    const res = await server.call(S.adminA, `/api/organizations/${A}/settings`, { method: 'PATCH', body: { expectedVersion: current.data.version, notifications: { notificationEmails: ['legal@example.test'] } } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.policy, current.data.policy);
    assert.deepEqual(res.data.profile, current.data.profile);
    assert.deepEqual(res.data.notifications.notificationEmails, ['legal@example.test']);
    const audit = await server.call(S.adminA, `/api/organizations/${A}/audit?action=organization.settings.update`);
    assert.ok(audit.data.events.some((e: any) => e.changedFields.includes('notifications.notificationEmails')));
    assert.ok(!JSON.stringify(audit.data).includes('legal@example.test'));
    const other = await server.call(S.adminB, `/api/organizations/${B}/settings`);
    assert.deepEqual(other.data.notifications.notificationEmails, []);
    assert.equal((await server.call(S.adminA, `/api/organizations/${A}/settings`, { method: 'PATCH', body: { expectedVersion: res.data.version, policy: { modules: { unknown: true } } } })).status, 400);
    assert.equal((await server.call(S.adminA, `/api/organizations/${A}/settings`, { method: 'PATCH', body: { expectedVersion: res.data.version, geminiApiKey: 'x' } })).status, 400);
  });

  it('concurrent saves with the same version: one commits, one conflicts', async () => {
    const current = await server.call(S.adminA, `/api/organizations/${A}/settings`);
    const [x, y] = await Promise.all([
      server.call(S.adminA, `/api/organizations/${A}/settings`, { method: 'PATCH', body: { expectedVersion: current.data.version, policy: { expiryWarningDays: 45 } } }),
      server.call(S.adminA, `/api/organizations/${A}/settings`, { method: 'PATCH', body: { expectedVersion: current.data.version, policy: { expiryWarningDays: 60 } } }),
    ]);
    assert.deepEqual([x.status, y.status].sort(), [200, 409]);
    assert.equal([x, y].find((r) => r.status === 409)!.data.error, 'VERSION_CONFLICT');
  });

  it('integration mappings are validated, unique across organizations, and survive restart', async () => {
    const a = await server.call(S.adminA, `/api/organizations/${A}/integrations/google`);
    const set = await server.call(S.adminA, `/api/organizations/${A}/integrations/google`, { method: 'PATCH', body: { expectedVersion: a.data.version, driveFolderId: 'driveFolderAlpha_123', spreadsheetId: 'sheetAlpha_123456' } });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    const b = await server.call(S.adminB, `/api/organizations/${B}/integrations/google`);
    const steal = await server.call(S.adminB, `/api/organizations/${B}/integrations/google`, { method: 'PATCH', body: { expectedVersion: b.data.version, driveFolderId: 'driveFolderAlpha_123' } });
    assert.equal(steal.status, 400);
    assert.equal((await server.call(S.adminB, `/api/organizations/${B}/integrations/google`, { method: 'PATCH', body: { expectedVersion: b.data.version, driveFolderId: 'Folder_legacy_value' } })).status, 400);
    const legacy = await server.call(S.adminA, `/api/tenants/${A}/setup-google`, { method: 'POST', body: { spreadsheetId: 'sheetAlpha_999999' } });
    assert.equal(legacy.status, 200);
    await server.restart();
    const after = await server.call(S.adminA, `/api/organizations/${A}/integrations/google`);
    assert.deepEqual([after.data.driveFolderId, after.data.spreadsheetId], ['driveFolderAlpha_123', 'sheetAlpha_999999']);
    const settings = await server.call(S.adminA, `/api/organizations/${A}/settings`);
    assert.deepEqual(settings.data.notifications.notificationEmails, ['legal@example.test']);
  });

  it('placeholder Google sync is honest and scoped', async () => {
    for (const path of ['/api/google-integration/sync', '/api/google-integration/sync-flush', `/api/tenants/${A}/sync-google`]) {
      const res = await server.call(S.adminA, path, { method: 'POST', org: A });
      assert.equal(res.status, 409, path);
      assert.equal(res.data.error, 'SYNC_UNAVAILABLE');
    }
    assert.equal((await server.call(S.viewerA, '/api/google-integration/sync', { method: 'POST', org: A })).status, 403);
    const status = await server.call(S.adminA, '/api/google-integration/sync-status', { org: A });
    assert.deepEqual(status.data, { organizationId: A, active: false, queueLength: 0, status: 'unavailable', syncSupported: false });
  });
});

describe('uploads (AC-028)', () => {
  it('serves files only through owning records in scope; unowned root files are denied', async () => {
    const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\nalpha contract').toString('base64');
    const created = await server.call(S.adminA, '/api/contracts', { method: 'POST', org: A, body: {
      nomor_kontrak: 'A-001', judul_kontrak: 'Alpha contract', partner_id: ids.pLegal, tanggal_mulai: '2026-01-01', tanggal_berakhir: '2027-12-31',
      currency: 'IDR', nilai_kontrak: 10, fileName: 'alpha.pdf', fileData: pdf } });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const url = created.data.contract.link_file_kontrak as string;
    assert.ok(url.startsWith('/uploads/'));
    assert.equal((await server.call(S.viewerA, url)).status, 200);
    assert.equal((await server.call(S.financeViewerA, url)).status, 404);
    assert.equal((await server.call(S.adminB, url)).status, 404);
    await mkdir(join(server.dir, 'data', 'uploads'), { recursive: true });
    await writeFile(join(server.dir, 'data', 'uploads', 'root-secret.pdf'), 'secret');
    assert.equal((await server.call(S.adminA, '/uploads/root-secret.pdf')).status, 404);
    assert.equal((await server.call(S.super, '/uploads/root-secret.pdf')).status, 404);
    assert.notEqual((await server.call(S.adminA, '/uploads/%2e%2e/auth.db')).status, 200);
    assert.notEqual((await server.call(S.adminA, '/uploads/..%2fauth.db')).status, 200);
  });
});

describe('platform organization management (AC-030)', () => {
  it('superuser manages A in platform context without a membership; audit names the platform actor', async () => {
    const caps = await server.call(S.super, `/api/organizations/${A}/capabilities`);
    assert.deepEqual([caps.data.accessMode, caps.data.tenantRole, caps.data.membershipId], ['platform', null, null]);
    assert.ok(caps.data.assignableTenantRoles.includes('admin'));
    const invite = await server.call(S.super, `/api/organizations/${A}/invitations`, { method: 'POST', body: { email: 'second.admin@example.test', tenantRole: 'admin', departmentIds: [] } });
    assert.equal(invite.status, 201);
    assert.equal((server.db.prepare(`SELECT COUNT(*) AS n FROM member WHERE userId = ?`).get(ids.super) as any).n, 0);
    const audit = await server.call(S.super, `/api/platform/audit?organizationId=${A}&action=invitation.create`);
    assert.ok(audit.data.events.some((e: any) => e.actorId === ids.super && e.accessMode === 'platform'));
  });
});

describe('first-run setup (AC-041)', () => {
  it('concurrent public setup creates at most one superuser, and only while none exists', async () => {
    const fresh = await IsolatedServer.start();
    try {
      const attempts = await Promise.all(Array.from({ length: 5 }, (_, i) => fetch(`${fresh.base}/api/system/setup`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `Admin ${i}`, email: `admin${i}@example.test`, password: 'correct-horse-9' }),
      }).then((r) => r.status)));
      assert.equal(attempts.filter((s) => s === 201).length, 1, JSON.stringify(attempts));
      assert.equal((fresh.db.prepare(`SELECT COUNT(*) AS n FROM "user" WHERE role = 'superuser'`).get() as any).n, 1);
      assert.equal((fresh.db.prepare(`SELECT COUNT(*) AS n FROM member`).get() as any).n, 0);
    } finally {
      await fresh.stop();
    }
  });
});
