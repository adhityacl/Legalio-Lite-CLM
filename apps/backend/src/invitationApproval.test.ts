import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type express from 'express';

// Exercise the actual Better Auth hooks without touching the development database.
test('tenant invitations approve registration and existing pending accounts without bypassing bans', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'legalio-invite-'));
  const envKeys = ['APP_TEST_MODE', 'AUTH_DB_PATH', 'APP_DATA_DIR', 'BETTER_AUTH_URL', 'BETTER_AUTH_ENABLE_INFRA'] as const;
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    APP_TEST_MODE: '1', AUTH_DB_PATH: path.join(dir, 'auth.db'), APP_DATA_DIR: dir,
    BETTER_AUTH_URL: 'http://localhost:3000', BETTER_AUTH_ENABLE_INFRA: 'false',
  });
  const { auth, sqliteDb: db } = await import('./lib/auth');
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
  const user = (email: string) => db.prepare('SELECT * FROM "user" WHERE email = ?').get(email) as any;
  const ctx = membershipContext({ organizationId: 'org', userId: 'admin', platformRole: 'user', membershipId: 'admin-member', tenantRole: 'admin', departmentIds: [] });
  const actor = { actorId: 'admin', actorPlatformRole: 'user' as const, accessMode: 'membership' as const, requestId: 'test' };
  const invite = (email: string, codeOnly = false) => createInvitation(db, ctx, actor, { ...(codeOnly ? {} : { email }), tenantRole: 'manager', departmentIds: ['marketing'] }, codeOnly);
  try {
    db.prepare('INSERT INTO organization (id, name, slug) VALUES (?, ?, ?)').run('org', 'ITS', 'its');
    db.prepare('INSERT INTO team (id, name, organizationId) VALUES (?, ?, ?)').run('marketing', 'Marketing', 'org');
    db.prepare('INSERT INTO "user" (id, name, email, emailVerified, role, banned, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, 0, ?, ?)')
      .run('admin', 'Tenant Admin', 'admin@example.com', 'user', new Date().toISOString(), new Date().toISOString());
    db.prepare('INSERT INTO member (id, organizationId, userId, role, status) VALUES (?, ?, ?, ?, ?)').run('admin-member', 'org', 'admin', 'admin', 'active');

    const emailInvite = invite('invited@example.com');
    assert.equal(previewInvitation(db, emailInvite.id).email, 'invited@example.com');
    const registered = await request('sign-up/email', 'invited@example.com');
    assert.equal(registered.status, 200);
    assert.equal(registered.body.user.banned, false);
    assert.equal(user('invited@example.com').role, 'user');
    assert.equal(user('invited@example.com').emailVerified, 0);
    const signedIn = await request('sign-in/email', 'invited@example.com');
    assert.equal(signedIn.status, 200);
    const req = { headers: { authorization: `Bearer ${signedIn.body.token}` } } as express.Request;
    const membership = acceptInvitation(db, resolveIdentity(db, req), emailInvite.id, req);
    assert.equal(membership.tenantRole, 'manager');
    assert.deepEqual(membership.departmentIds, ['marketing']);
    assert.equal(membership.status, 'active');
    assert.throws(() => acceptInvitation(db, resolveIdentity(db, req), emailInvite.id, req));

    const codeInvite = invite('', true);
    assert.equal(previewInvitation(db, codeInvite.id).email, null);
    assert.equal(hasApprovalInvitation(db, 'code@example.com'), false);
    assert.equal((await request('sign-up/email', 'code@example.com', codeInvite.id)).body.user.banned, false);
    const codeSignIn = await request('sign-in/email', 'code@example.com', codeInvite.id);
    assert.equal(codeSignIn.status, 200);
    const codeReq = { headers: { authorization: `Bearer ${codeSignIn.body.token}` } } as express.Request;
    assert.deepEqual(acceptInvitation(db, resolveIdentity(db, codeReq), codeInvite.id, codeReq).departmentIds, ['marketing']);
    assert.equal(hasApprovalInvitation(db, 'another@example.com', codeInvite.id), false);
    const pendingCodeInvite = invite('', true);

    assert.equal((await request('sign-up/email', 'pending@example.com')).body.user.banned, true);
    assert.equal((await request('sign-in/email', 'pending@example.com')).status, 403);
    invite('pending@example.com');
    assert.equal((await request('sign-in/email', 'pending@example.com', undefined, 'wrong-password')).status, 401);
    assert.equal(user('pending@example.com').banReason, 'PENDING_APPROVAL');
    assert.equal((await request('sign-in/email', 'pending@example.com')).status, 200);
    assert.equal(user('pending@example.com').banReason, null);

    await request('sign-up/email', 'pending-code@example.com');
    assert.equal((await request('sign-in/email', 'pending-code@example.com', pendingCodeInvite.id)).status, 200);
    db.prepare('UPDATE "user" SET banned = 1, banReason = ? WHERE email = ?').run('Disabled by administrator', 'pending-code@example.com');
    assert.equal((await request('sign-in/email', 'pending-code@example.com', pendingCodeInvite.id)).status, 403);
    assert.equal(user('pending-code@example.com').banReason, 'Disabled by administrator');

    const mismatched = invite('recipient@example.com');
    assert.equal((await request('sign-up/email', 'other@example.com', mismatched.id)).status, 400);
    assert.equal((await request('sign-up/email', 'invalid@example.com', 'invalid-token')).status, 400);
    assert.equal(user('invalid@example.com'), undefined);
    for (const status of ['expired', 'canceled', 'accepted']) {
      const email = `${status}@example.com`;
      const row = invite(email);
      if (status === 'expired') db.prepare('UPDATE invitation SET expiresAt = ? WHERE id = ?').run('2000-01-01', row.id);
      else db.prepare('UPDATE invitation SET status = ? WHERE id = ?').run(status, row.id);
      assert.equal(hasApprovalInvitation(db, email, row.id), false);
      assert.equal((await request('sign-up/email', email)).body.user.banned, true);
    }
    const revoked = invite('revoked@example.com');
    db.prepare("UPDATE member SET status = 'suspended' WHERE id = 'admin-member'").run();
    assert.equal(hasApprovalInvitation(db, 'revoked@example.com', revoked.id), false);
    assert.equal((await request('sign-up/email', 'revoked@example.com')).body.user.banned, true);
    db.prepare("UPDATE member SET status = 'active' WHERE id = 'admin-member'").run();
    db.prepare("UPDATE invitation SET departmentIds = '[\"another-tenant-team\"]' WHERE id = ?").run(revoked.id);
    assert.equal(hasApprovalInvitation(db, 'revoked@example.com', revoked.id), false);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
