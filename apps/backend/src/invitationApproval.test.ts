import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type express from 'express';

// Exercise the actual Better Auth hooks without touching the development database.
test('tenant invitations approve registration and existing pending accounts without bypassing bans', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'legalio-invite-'));
  const envKeys = ['APP_TEST_MODE', 'APP_DATA_DIR', 'BETTER_AUTH_URL', 'BETTER_AUTH_ENABLE_INFRA'] as const;
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    APP_TEST_MODE: '1', APP_DATA_DIR: dir,
    BETTER_AUTH_URL: 'http://localhost:3000', BETTER_AUTH_ENABLE_INFRA: 'false',
  });
  const database = await (await import('./testDatabase')).createTestDatabase();
  await (await import('./schema')).ensureSchema();
  const authModule = await import('./lib/auth');
  await authModule.reloadAuthConfiguration();
  const { auth } = authModule;
  const { sql } = await import('./db');
  const { acceptInvitation, createInvitation, hasApprovalInvitation, previewInvitation } = await import('./organizationAdminRoutes');
  const { resolveIdentity } = await import('./identity');
  const { membershipContext } = await import('./rbac');
  const password = 'test-password-1234';
  const request = async (route: string, email: string, token?: string, enteredPassword = password) => {
    const response = await auth.handler(new Request(`http://localhost:3000/api/auth/${route}`, {
      method: 'POST', headers: {
        'Content-Type': 'application/json', Origin: 'http://localhost:3000',
        ...(token ? { 'x-invitation-token': token } : {}),
      }, body: JSON.stringify({ email, password: enteredPassword, ...(route === 'sign-up/email' ? { name: 'Invitee' } : {}) }),
    }));
    return { status: response.status, body: await response.json() as any };
  };
  const user = (email: string) => sql.get('SELECT * FROM "user" WHERE email = ?', email);
  const ctx = membershipContext({ organizationId: 'org', userId: 'admin', platformRole: 'user', membershipId: 'admin-member', tenantRole: 'admin', departmentIds: [] });
  const actor = { actorId: 'admin', actorPlatformRole: 'user' as const, accessMode: 'membership' as const, requestId: 'test' };
  const invite = (email: string, codeOnly = false) => createInvitation(sql, ctx, actor, { ...(codeOnly ? {} : { email }), tenantRole: 'manager', departmentIds: ['marketing'] }, codeOnly);
  try {
    await sql.run('INSERT INTO organization (id, name, slug, "createdAt") VALUES (?, ?, ?, now())', 'org', 'ITS', 'its');
    await sql.run('INSERT INTO team (id, name, "organizationId", "memberCount", "createdAt") VALUES (?, ?, ?, 0, now())', 'marketing', 'Marketing', 'org');
    await sql.run('INSERT INTO "user" (id, name, email, "emailVerified", role, banned, "createdAt", "updatedAt") VALUES (?, ?, ?, true, ?, false, now(), now())',
      'admin', 'Tenant Admin', 'admin@example.com', 'user');
    await sql.run('INSERT INTO member (id, "organizationId", "userId", role, status, "createdAt") VALUES (?, ?, ?, ?, ?, now())', 'admin-member', 'org', 'admin', 'admin', 'active');

    const emailInvite = await invite('invited@example.com');
    assert.equal((await previewInvitation(sql, emailInvite.id)).email, 'invited@example.com');
    const registered = await request('sign-up/email', 'invited@example.com');
    assert.equal(registered.status, 200);
    assert.equal(registered.body.user.banned, false);
    assert.equal((await user('invited@example.com')).role, 'user');
    assert.equal((await user('invited@example.com')).emailVerified, false);
    const signedIn = await request('sign-in/email', 'invited@example.com');
    assert.equal(signedIn.status, 200);
    const req = { headers: { authorization: `Bearer ${signedIn.body.token}` } } as express.Request;
    const membership = await acceptInvitation(sql, await resolveIdentity(sql, req), emailInvite.id, req);
    assert.equal(membership.tenantRole, 'manager');
    assert.deepEqual(membership.departmentIds, ['marketing']);
    assert.equal(membership.status, 'active');
    await assert.rejects(acceptInvitation(sql, await resolveIdentity(sql, req), emailInvite.id, req));

    const codeInvite = await invite('', true);
    assert.equal((await previewInvitation(sql, codeInvite.id)).email, null);
    assert.equal(await hasApprovalInvitation(sql, 'code@example.com'), false);
    assert.equal((await request('sign-up/email', 'code@example.com', codeInvite.id)).body.user.banned, false);
    const codeSignIn = await request('sign-in/email', 'code@example.com', codeInvite.id);
    assert.equal(codeSignIn.status, 200);
    const codeReq = { headers: { authorization: `Bearer ${codeSignIn.body.token}` } } as express.Request;
    assert.deepEqual((await acceptInvitation(sql, await resolveIdentity(sql, codeReq), codeInvite.id, codeReq)).departmentIds, ['marketing']);
    assert.equal(await hasApprovalInvitation(sql, 'another@example.com', codeInvite.id), false);
    const pendingCodeInvite = await invite('', true);

    assert.equal((await request('sign-up/email', 'pending@example.com')).body.user.banned, true);
    assert.equal((await request('sign-in/email', 'pending@example.com')).status, 403);
    await invite('pending@example.com');
    assert.equal((await request('sign-in/email', 'pending@example.com', undefined, 'wrong-password')).status, 401);
    assert.equal((await user('pending@example.com')).banReason, 'PENDING_APPROVAL');
    assert.equal((await request('sign-in/email', 'pending@example.com')).status, 200);
    assert.equal((await user('pending@example.com')).banReason, null);

    await request('sign-up/email', 'pending-code@example.com');
    assert.equal((await request('sign-in/email', 'pending-code@example.com', pendingCodeInvite.id)).status, 200);
    await sql.run('UPDATE "user" SET banned = true, "banReason" = ? WHERE email = ?', 'Disabled by administrator', 'pending-code@example.com');
    assert.equal((await request('sign-in/email', 'pending-code@example.com', pendingCodeInvite.id)).status, 403);
    assert.equal((await user('pending-code@example.com')).banReason, 'Disabled by administrator');

    const mismatched = await invite('recipient@example.com');
    assert.equal((await request('sign-up/email', 'other@example.com', mismatched.id)).status, 400);
    assert.equal((await request('sign-up/email', 'invalid@example.com', 'invalid-token')).status, 400);
    assert.equal(await user('invalid@example.com'), undefined);
    for (const status of ['expired', 'canceled', 'accepted']) {
      const email = `${status}@example.com`;
      const row = await invite(email);
      if (status === 'expired') await sql.run('UPDATE invitation SET "expiresAt" = ? WHERE id = ?', '2000-01-01', row.id);
      else await sql.run('UPDATE invitation SET status = ? WHERE id = ?', status, row.id);
      assert.equal(await hasApprovalInvitation(sql, email, row.id), false);
      assert.equal((await request('sign-up/email', email)).body.user.banned, true);
    }
    const revoked = await invite('revoked@example.com');
    await sql.run("UPDATE member SET status = 'suspended' WHERE id = 'admin-member'");
    assert.equal(await hasApprovalInvitation(sql, 'revoked@example.com', revoked.id), false);
    assert.equal((await request('sign-up/email', 'revoked@example.com')).body.user.banned, true);
    await sql.run("UPDATE member SET status = 'active' WHERE id = 'admin-member'");
    await sql.run(`UPDATE invitation SET "departmentIds" = '["another-tenant-team"]' WHERE id = ?`, revoked.id);
    assert.equal(await hasApprovalInvitation(sql, 'revoked@example.com', revoked.id), false);
  } finally {
    await database.drop();
    rmSync(dir, { recursive: true, force: true });
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
