/**
 * System Admin console API — platform operations only (tenant-boundaries PRD §6.6, §10.1).
 *
 * Every route here is gated by a platform permission in server/routePolicies.ts.
 * Global accounts are platform identities: tenant membership administration
 * lives in the canonical /api/organizations/:organizationId/* services, and
 * nothing here creates or changes a membership implicitly.
 */
import { Router, Request, Response } from 'express';
import { sql } from './db';
import { forwardAsyncRouteErrors } from './asyncRoutes';
import { sendRouteError } from './apiErrors';
import { hashPassword } from 'better-auth/crypto';
import crypto from 'crypto';
import { buildMatrix, isPlatformRole } from './rbac';
import { RequestDenied, accessibleOrganizations, identityOf, sendError, type Identity } from './identity';
import { resetOrganizationData } from './organizationReset';
import type { ObjectStore } from './objectStore';
import { isDemoAccountEmail } from './demoAccounts';
import { ApiError, appendAudit, patchOrganizationSettings, readOrganizationSettings } from './organizationSettingsStore';
import { assertAdminsRemainWithout, assertSuperusersRemainWithout, auditActorFor, previewInvitation, acceptInvitation } from './organizationAdminRoutes';
import { addMembershipRecord, createIdentityRecord, createOrganizationRecord } from './organizationProvisioning';

export const authConsoleRouter = Router();
forwardAsyncRouteErrors(authConsoleRouter);

let globalDbRef: any = null;
let saveDbFnRef: (() => Promise<void>) | null = null;
let organizationChangedRef: ((organizationId?: string) => Promise<void>) | null = null;
let storeRef: (() => ObjectStore) | null = null;

/** server.ts shares its projection (for SMTP/branding reads), upload storage and a refresh hook. No hydration happens here. */
export function setConsoleDbReference(dbStore: any, saveFn: () => Promise<void>, getStore: () => ObjectStore, onOrganizationsChanged?: (organizationId?: string) => Promise<void>) {
  globalDbRef = dbStore;
  saveDbFnRef = saveFn;
  storeRef = getStore;
  organizationChangedRef = onOrganizationsChanged || null;
}

type Handler = (req: Request, res: Response, identity: Identity) => unknown;
/** Wraps a platform handler: verified identity, uniform errors with requestId. */
const platformHandler = (fn: Handler) => async (req: Request, res: Response) => {
  try {
    await fn(req, res, identityOf(req));
  } catch (err: any) {
    if (err instanceof ApiError || err instanceof RequestDenied) return sendError(req, res, err.status, err.error, err.message);
    console.error('[auth-console]', err);
    return sendError(req, res, 500, 'INTERNAL_ERROR', 'Unexpected server error.');
  }
};
const bad = (message: string) => new ApiError(400, 'INVALID_INPUT', message);
const EMAIL = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;
const platformAudit = (req: Request, identity: Identity, action: string, targetType: string, targetId: string, changedFields: string[] = []) =>
  appendAudit(sql, auditActorFor(req, identity), { organizationId: null, action, targetType, targetId, outcome: 'success', changedFields });

/**
 * Gives the env-configured bootstrap admin (`demo-admin`) and the demo-workspace
 * logins a password. Nobody else ever gets one implicitly — this used to hand
 * every password-less user (e.g. an invited colleague) a shared default password.
 * No password configured → no-op; the first admin then comes from the setup page.
 */
export async function ensureUserAccountsExist(defaultPassword = process.env.DEMO_ADMIN_PASSWORD || '') {
  if (!defaultPassword) return;
  try {
    const users = (await sql.all('SELECT id, email FROM "user"') as any[]).filter(
      (u) => u.id === 'demo-admin' || isDemoAccountEmail(u.email),
    );
    if (users.length === 0) return;
    const now = new Date().toISOString();
    let hashedDef: string | null = null;
    // While the bootstrap admin is still seeded, its credential must track
    // DEMO_ADMIN_PASSWORD on every boot — otherwise editing .env after the
    // account already exists (e.g. the database was copied from another install)
    // silently has no effect and the configured login just stops working.
    const reseedBootstrapAdmin = process.env.SEED_DEMO_ADMIN !== 'false' && defaultPassword === process.env.DEMO_ADMIN_PASSWORD;

    for (const u of users) {
      const existing = await sql.get(`SELECT id FROM account WHERE "userId" = ? AND "providerId" = 'credential'`, u.id) as any;
      if (existing && !(reseedBootstrapAdmin && u.id === 'demo-admin')) continue;
      if (!hashedDef) {
        hashedDef = await hashPassword(defaultPassword);
      }
      if (existing) {
        await sql.run('UPDATE account SET password = ?, "updatedAt" = ? WHERE id = ?', hashedDef, now, existing.id);
      } else {
        const accountId = 'acc_' + u.id;
        await sql.run(`
          INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
          VALUES (?, ?, 'credential', ?, ?, ?, ?) ON CONFLICT DO NOTHING
        `, accountId, u.id, u.id, hashedDef, now, now);
      }
    }
  } catch (err) {
    console.warn('Error ensuring user accounts:', err);
  }
}
// 1. GET /overview - High-level metrics for Console Dashboard
authConsoleRouter.get('/overview', async (req: Request, res: Response) => {
  try {
    const totalUsers = (await sql.get('SELECT COUNT(*) as count FROM "user"') as any)?.count || 0;
    const activeUsers = (await sql.get('SELECT COUNT(*) as count FROM "user" WHERE banned IS NOT TRUE') as any)?.count || 0;
    const bannedUsers = (await sql.get('SELECT COUNT(*) as count FROM "user" WHERE banned IS TRUE') as any)?.count || 0;
    const verifiedUsers = (await sql.get('SELECT COUNT(*) as count FROM "user" WHERE "emailVerified"') as any)?.count || 0;
    
    // Active sessions (not expired)
    const now = new Date().toISOString();
    const activeSessions = (await sql.get('SELECT COUNT(*) as count FROM session WHERE "expiresAt" > ?', now) as any)?.count || 0;
    
    // Total accounts & providers
    const totalAccounts = (await sql.get('SELECT COUNT(*) as count FROM account') as any)?.count || 0;
    const credentialAccounts = (await sql.get(`SELECT COUNT(*) as count FROM account WHERE "providerId" = 'credential'`) as any)?.count || 0;
    const googleAccounts = (await sql.get(`SELECT COUNT(*) as count FROM account WHERE "providerId" = 'google'`) as any)?.count || 0;

    // Organizations & Teams
    const totalOrgs = (await sql.get('SELECT COUNT(*) as count FROM organization') as any)?.count || 0;
    const totalTeams = (await sql.get('SELECT COUNT(*) as count FROM team') as any)?.count || 0;
    const pendingInvitations = (await sql.get("SELECT COUNT(*) as count FROM invitation WHERE status = 'pending'") as any)?.count || 0;
    const totalApiKeys = (await sql.get("SELECT COUNT(*) as count FROM apikey WHERE status = 'active'") as any)?.count || 0;

    // Platform roles only; tenant roles are per-organization membership data.
    const superusers = (await sql.get(`SELECT COUNT(*) as count FROM "user" WHERE role = 'superuser'`) as any)?.count || 0;
    const roleDistribution: Record<string, number> = { superuser: superusers, user: totalUsers - superusers };

    // Recent users
    const recentUsers = (await sql.all('SELECT id, name, email, role, banned, "createdAt" FROM "user" ORDER BY "createdAt" DESC LIMIT 5') as any[])
      .map((u) => ({ id: u.id, name: u.name, email: u.email, platformRole: u.role === 'superuser' ? 'superuser' : 'user', banned: Boolean(u.banned), createdAt: u.createdAt }));

    // Recent sessions
    const recentSessions = await sql.all(`
      SELECT s.id, s."ipAddress", s."userAgent", s."createdAt", s."expiresAt", u.name as "userName", u.email as "userEmail"
      FROM session s
      LEFT JOIN "user" u ON s."userId" = u.id
      ORDER BY s."createdAt" DESC LIMIT 5
    `);

    return res.json({
      success: true,
      data: {
        instance: {
          id: 'production',
          name: 'Production',
          env: 'production',
          adapter: 'Better-Auth Native (PostgreSQL)',
          plugins: ['admin', 'organization', 'teams', 'accessControl'],
        },
        metrics: {
          totalUsers,
          activeUsers,
          bannedUsers,
          verifiedUsers,
          activeSessions,
          totalAccounts,
          credentialAccounts,
          googleAccounts,
          totalOrgs,
          totalTeams,
          pendingInvitations,
          totalApiKeys,
        },
        roleDistribution,
        providerDistribution: {
          credential: credentialAccounts,
          google: googleAccounts,
          other: Math.max(0, totalAccounts - credentialAccounts - googleAccounts),
        },
        recentUsers,
        recentSessions,
      },
    });
  } catch (err: any) {
    console.error('Error fetching console overview:', err);
    return sendRouteError(req, res, err, "request failed", "Failed to fetch console overview", { status: 500 });
  }
});

/* ------------------------------------------------------------------ */
/* Global accounts (platform identities)                                */
/* ------------------------------------------------------------------ */

const userSelect = `
  SELECT u.id, u.name, u.email, u."emailVerified", u.image, u."createdAt", u."updatedAt", u.role, u.banned, u."banReason", u."banExpires",
    (SELECT COUNT(*) FROM session WHERE "userId" = u.id) AS "sessionCount",
    (SELECT "providerId" FROM account WHERE "userId" = u.id LIMIT 1) AS "primaryProvider",
    (SELECT COUNT(*) FROM member WHERE "userId" = u.id) AS "membershipCount"
  FROM "user" u`;

function platformUserDto(u: any) {
  return {
    id: u.id, name: u.name, email: u.email, emailVerified: Boolean(u.emailVerified), image: u.image || null,
    createdAt: u.createdAt, updatedAt: u.updatedAt, platformRole: u.role === 'superuser' ? 'superuser' : 'user',
    banned: Number(u.banned) === 1, banReason: u.banReason || null, banExpires: u.banExpires || null,
    sessionCount: Number(u.sessionCount) || 0, primaryProvider: u.primaryProvider || null, membershipCount: Number(u.membershipCount) || 0,
  };
}

async function loadUser(id: string) {
  const row = await sql.get(`${userSelect} WHERE u.id = ?`, id) as any;
  if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
  return row;
}

async function setCredentialPassword(userId: string, password: unknown) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 256) throw bad('Password must be 8–256 characters.');
  const hashed = await hashPassword(password);
  const now = new Date().toISOString();
  const existing = await sql.get(`SELECT id FROM account WHERE "userId" = ? AND "providerId" = 'credential'`, userId) as any;
  if (existing) await sql.run('UPDATE account SET password = ?, "updatedAt" = ? WHERE id = ?', hashed, now, existing.id);
  else await sql.run(`INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") VALUES (?, ?, 'credential', ?, ?, ?, ?)`, `acc_${crypto.randomUUID()}`, userId, userId, hashed, now, now);
}

/** Ban/delete invariants (§4.3 rules 3–4): never strand an organization or the platform. */
async function assertAccountRemovable(userId: string) {
  await assertSuperusersRemainWithout(sql, userId);
  await assertAdminsRemainWithout(sql, userId);
}

async function setBanned(userId: string, banned: boolean, reason: string | null) {
  if (banned) {
    await assertAccountRemovable(userId);
    await sql.run('UPDATE "user" SET banned = true, "banReason" = ?, "banExpires" = NULL, "updatedAt" = ? WHERE id = ?', reason, new Date().toISOString(), userId);
    await sql.run('DELETE FROM session WHERE "userId" = ?', userId);
  } else {
    await sql.run('UPDATE "user" SET banned = false, "banReason" = NULL, "banExpires" = NULL, "updatedAt" = ? WHERE id = ?', new Date().toISOString(), userId);
  }
}

async function deleteAccount(userId: string) {
  await assertAccountRemovable(userId);
  for (const table of ['session', 'account', 'teamMember', 'member']) await sql.run(`DELETE FROM "${table}" WHERE "userId" = ?`, userId);
  await sql.run('DELETE FROM "user" WHERE id = ?', userId); // audit_log keeps the actor id (no cascade)
}

authConsoleRouter.get('/users', platformHandler(async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase().slice(0, 200) : '';
  const rows = await sql.all(`${userSelect} ORDER BY u."createdAt" DESC, u.id`) as any[];
  const users = rows.filter((u) => !search || String(u.name).toLowerCase().includes(search) || String(u.email).toLowerCase().includes(search));
  res.json({ success: true, users: users.map(platformUserDto) });
}));

authConsoleRouter.post('/users', platformHandler(async (req, res, identity) => {
  const { name, email, platformRole = 'user', password } = req.body || {};
  for (const key of Object.keys(req.body || {})) if (!['name', 'email', 'platformRole', 'password'].includes(key)) throw bad(`Unknown field: ${key}`);
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || '').trim().slice(0, 200);
  if (!cleanName || !EMAIL.test(cleanEmail)) throw bad('Name and a valid email are required.');
  if (!isPlatformRole(platformRole)) throw bad('platformRole must be user or superuser.');
  if (platformRole === 'superuser' && !identity.platformPermissions.includes('platform.user.role.update')) throw new ApiError(403, 'INSUFFICIENT_PERMISSION');
  if (await sql.get('SELECT 1 FROM "user" WHERE LOWER(email) = ?', cleanEmail)) throw new ApiError(409, 'ACCOUNT_EXISTS', 'An account with this email already exists.');
  if (password !== undefined && (typeof password !== 'string' || password.length < 8)) throw bad('Password must be at least 8 characters.');
  const hashed = typeof password === 'string' ? await hashPassword(password) : null;
  const id = await sql.tx(async () => {
    const userId = await createIdentityRecord(sql, { name: cleanName, email: cleanEmail, platformRole });
    if (hashed) {
      const now = new Date().toISOString();
      await sql.run(`INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") VALUES (?, ?, 'credential', ?, ?, ?, ?)`, `acc_${crypto.randomUUID()}`, userId, userId, hashed, now, now);
    }
    await platformAudit(req, identity, 'platform.user.create', 'user', userId, ['name', 'email', 'platformRole']);
    return userId;
  });
  res.status(201).json({ success: true, user: platformUserDto(await loadUser(id)) });
}));

authConsoleRouter.put('/users/:id', platformHandler(async (req, res, identity) => {
  const body = req.body || {};
  for (const key of Object.keys(body)) if (!['name', 'email'].includes(key)) throw bad(`Unknown field: ${key}`);
  const user = await loadUser(req.params.id);
  const changed: string[] = [];
  await sql.tx(async () => {
    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 200);
      if (!name) throw bad('Name is required.');
      await sql.run('UPDATE "user" SET name = ?, "updatedAt" = ? WHERE id = ?', name, new Date().toISOString(), user.id);
      changed.push('name');
    }
    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase();
      if (!EMAIL.test(email)) throw bad('Email is not valid.');
      if (await sql.get('SELECT 1 FROM "user" WHERE LOWER(email) = ? AND id <> ?', email, user.id)) throw new ApiError(409, 'ACCOUNT_EXISTS', 'Another account uses this email.');
      await sql.run('UPDATE "user" SET email = ?, "emailVerified" = false, "updatedAt" = ? WHERE id = ?', email, new Date().toISOString(), user.id);
      changed.push('email');
    }
    await platformAudit(req, identity, 'platform.user.update', 'user', user.id, changed);
  });
  res.json({ success: true, user: platformUserDto(await loadUser(user.id)) });
}));

const passwordHandler = platformHandler(async (req, res, identity) => {
  const user = await loadUser(req.params.id);
  await setCredentialPassword(user.id, req.body?.password ?? req.body?.newPassword);
  await platformAudit(req, identity, 'platform.user.password.reset', 'user', user.id, ['password']);
  res.json({ success: true });
});
authConsoleRouter.post('/users/:id/reset-password', passwordHandler);
authConsoleRouter.put('/users/:id/password', passwordHandler);

authConsoleRouter.put('/users/:id/role', platformHandler(async (req, res, identity) => {
  const platformRole = req.body?.platformRole;
  if (!isPlatformRole(platformRole)) throw bad('platformRole must be user or superuser.');
  const user = await loadUser(req.params.id);
  if (user.id === identity.userId) throw new ApiError(403, 'INSUFFICIENT_PERMISSION', 'You cannot change your own platform role.');
  await sql.tx(async () => {
    if (user.role === 'superuser' && platformRole !== 'superuser') await assertSuperusersRemainWithout(sql, user.id);
    await sql.run('UPDATE "user" SET role = ?, "updatedAt" = ? WHERE id = ?', platformRole, new Date().toISOString(), user.id);
    // Cached privileges end with the role change.
    await sql.run('DELETE FROM session WHERE "userId" = ?', user.id);
    await platformAudit(req, identity, 'platform.user.role.update', 'user', user.id, ['platformRole']);
  });
  res.json({ success: true, user: platformUserDto(await loadUser(user.id)) });
}));

authConsoleRouter.post('/users/:id/ban', platformHandler(async (req, res, identity) => {
  const banned = req.body?.banned !== false;
  const user = await loadUser(req.params.id);
  if (user.id === identity.userId) throw new ApiError(403, 'INSUFFICIENT_PERMISSION', 'You cannot disable your own account.');
  const reason = typeof req.body?.banReason === 'string' ? req.body.banReason.slice(0, 500) : null;
  await sql.tx(async () => {
    await setBanned(user.id, banned, reason);
    await platformAudit(req, identity, banned ? 'platform.user.ban' : 'platform.user.unban', 'user', user.id, ['banned']);
  });
  res.json({ success: true, user: platformUserDto(await loadUser(user.id)) });
}));

authConsoleRouter.delete('/users/:id', platformHandler(async (req, res, identity) => {
  const user = await loadUser(req.params.id);
  if (user.id === identity.userId) throw new ApiError(403, 'INSUFFICIENT_PERMISSION', 'You cannot delete your own account.');
  await sql.tx(async () => {
    await deleteAccount(user.id);
    await platformAudit(req, identity, 'platform.user.delete', 'user', user.id);
  });
  res.json({ success: true });
}));

/** All targets validated first; the whole batch commits or nothing does. */
authConsoleRouter.post('/users/bulk-action', platformHandler(async (req, res, identity) => {
  const { action, userIds } = req.body || {};
  const needs: Record<string, string> = { ban: 'platform.user.ban', unban: 'platform.user.ban', delete: 'platform.user.delete' };
  if (!needs[action]) throw bad('action must be ban, unban or delete.');
  if (!identity.platformPermissions.includes(needs[action])) throw new ApiError(403, 'INSUFFICIENT_PERMISSION');
  if (!Array.isArray(userIds) || userIds.length === 0 || userIds.length > 500 || userIds.some((id) => typeof id !== 'string')) throw bad('userIds must be a non-empty list.');
  if (userIds.includes(identity.userId)) throw new ApiError(403, 'INSUFFICIENT_PERMISSION', 'You cannot include your own account.');
  for (const id of userIds) await loadUser(id);
  await sql.tx(async () => {
    for (const id of userIds) {
      if (action === 'delete') await deleteAccount(id);
      else await setBanned(id, action === 'ban', action === 'ban' ? 'Bulk action' : null);
      await platformAudit(req, identity, `platform.user.${action}`, 'user', id, action === 'delete' ? [] : ['banned']);
    }
  });
  res.json({ success: true, count: userIds.length });
}));

// 3. GET /accounts - List all linked auth provider accounts
authConsoleRouter.get('/accounts', async (req: Request, res: Response) => {
  try {
    const accounts = await sql.all(`
      SELECT 
        a.id, 
        a."accountId", 
        a."providerId", 
        a."userId", 
        a."createdAt", 
        a."updatedAt",
        CASE WHEN a.password IS NOT NULL THEN 1 ELSE 0 END as "hasPassword",
        u.name as "userName",
        u.email as "userEmail",
        CASE WHEN u.role = 'superuser' THEN 'superuser' ELSE 'user' END as "platformRole"
      FROM account a
      LEFT JOIN "user" u ON a."userId" = u.id
      ORDER BY a."createdAt" DESC
    `);

    return res.json({
      success: true,
      accounts: accounts.map((a: any) => ({
        ...a,
        hasPassword: Boolean(a.hasPassword),
      })),
    });
  } catch (err: any) {
    console.error('Error listing accounts:', err);
    return sendRouteError(req, res, err, "request failed", "Failed to list accounts", { status: 500 });
  }
});

// 4. GET /sessions - List active sessions
authConsoleRouter.get('/sessions', async (req: Request, res: Response) => {
  try {
    const sessions = await sql.all(`
      SELECT 
        s.id, 
        s."createdAt", 
        s."updatedAt", 
        s."expiresAt", 
        s."ipAddress", 
        s."userAgent", 
        s."userId",
        s."impersonatedBy",
        s."activeOrganizationId",
        u.name as "userName",
        u.email as "userEmail",
        CASE WHEN u.role = 'superuser' THEN 'superuser' ELSE 'user' END as "platformRole"
      FROM session s
      LEFT JOIN "user" u ON s."userId" = u.id
      ORDER BY s."createdAt" DESC
    `);

    const now = new Date();
    return res.json({
      success: true,
      sessions: sessions.map((s: any) => ({
        ...s,
        isExpired: s.expiresAt ? new Date(s.expiresAt) < now : false,
      })),
    });
  } catch (err: any) {
    console.error('Error listing sessions:', err);
    return sendRouteError(req, res, err, "request failed", "Failed to list sessions", { status: 500 });
  }
});

// DELETE /sessions/:id - Revoke single session
authConsoleRouter.delete('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await sql.run('DELETE FROM session WHERE id = ?', id);
    return res.json({ success: true, message: 'Session revoked successfully' });
  } catch (err: any) {
    console.error('Error revoking session:', err);
    return sendRouteError(req, res, err, "request failed", "Failed to revoke session", { status: 500 });
  }
});

// POST /sessions/revoke-user - Revoke all sessions for a user
authConsoleRouter.post('/sessions/revoke-user', async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    await sql.run('DELETE FROM session WHERE "userId" = ?', userId);
    return res.json({ success: true, message: `All sessions revoked for user ${userId}` });
  } catch (err: any) {
    console.error('Error revoking user sessions:', err);
    return sendRouteError(req, res, err, "request failed", "Failed to revoke user sessions", { status: 500 });
  }
});

// POST /sessions/revoke-all/:userId - Param-based alias for revoking all sessions of a user
authConsoleRouter.post('/sessions/revoke-all/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    await sql.run('DELETE FROM session WHERE "userId" = ?', userId);
    return res.json({ success: true, message: `All sessions revoked for user ${userId}` });
  } catch (err: any) {
    console.error('Error revoking user sessions:', err);
    return sendRouteError(req, res, err, "request failed", "Failed to revoke user sessions", { status: 500 });
  }
});


/* ------------------------------------------------------------------ */
/* Organization directory (platform) / accessible summaries (others)    */
/* ------------------------------------------------------------------ */

authConsoleRouter.get('/organizations', platformHandler(async (req, res, identity) => {
  const accessible = new Set((await accessibleOrganizations(sql, identity)).map((o) => o.organizationId));
  const rows = await sql.all(`
    SELECT o.id, o.name, o.slug, o.logo, o."createdAt",
      (SELECT COUNT(*) FROM member WHERE "organizationId" = o.id AND status = 'active') AS "memberCount",
      (SELECT COUNT(*) FROM team WHERE "organizationId" = o.id) AS "teamCount"
    FROM organization o ORDER BY lower(o.name), o.id
  `) as any[];
  const isPlatform = identity.platformPermissions.includes('platform.organization.read');
  const organizations = [];
  for (const o of rows.filter((row) => accessible.has(row.id))) {
    if (!isPlatform) { organizations.push({ id: o.id, name: o.name, slug: o.slug, logo: o.logo }); continue; }
    const settings = await readOrganizationSettings(sql, o.id);
    organizations.push({ id: o.id, name: o.name, slug: o.slug, logo: o.logo, createdAt: o.createdAt, memberCount: o.memberCount, teamCount: o.teamCount, version: settings.version, metadata: { ...settings.profile, currency: settings.policy.defaultCurrency } });
  }
  res.json({ success: true, organizations });
}));

/** Platform creation with an explicitly selected first tenant admin (PRD §10.2). */
authConsoleRouter.post('/organizations', platformHandler(async (req, res, identity) => {
  const body = req.body || {};
  for (const key of Object.keys(body)) if (!['name', 'slug', 'countryCode', 'industry', 'defaultCurrency', 'legalEntity', 'adminUserId'].includes(key)) throw bad(`Unknown field: ${key}`);
  const name = String(body.name || '').trim();
  if (!name || name.length > 200) throw bad('Organization name is required (1–200 characters).');
  if (body.adminUserId !== undefined) {
    const admin = await sql.get('SELECT id, role, banned FROM "user" WHERE id = ?', body.adminUserId) as any;
    if (!admin || Number(admin.banned) === 1) throw bad('The selected administrator does not exist or is disabled.');
  }
  const id = await sql.tx(async () => {
    const orgId = await createOrganizationRecord(sql, {
      name, slug: typeof body.slug === 'string' ? body.slug : undefined,
      legalEntity: typeof body.legalEntity === 'string' ? body.legalEntity.slice(0, 200) : '',
      settings: { countryCode: body.countryCode, industry: body.industry, defaultCurrency: body.defaultCurrency },
    }, identity.userId);
    if (body.adminUserId) await addMembershipRecord(sql, { userId: body.adminUserId, organizationId: orgId, tenantRole: 'admin' });
    await appendAudit(sql, auditActorFor(req, identity), { organizationId: orgId, action: 'organization.create', targetType: 'organization', targetId: orgId, outcome: 'success', changedFields: ['name', ...(body.adminUserId ? ['admin'] : [])] });
    return orgId;
  });
  await organizationChangedRef?.(id);
  res.status(201).json({ success: true, organization: { id, ...await readOrganizationSettings(sql, id) } });
}));

authConsoleRouter.put('/organizations/:id', platformHandler(async (req, res, identity) => {
  const current = await readOrganizationSettings(sql, req.params.id);
  const body = req.body || {};
  for (const key of Object.keys(body)) if (!['name', 'slug', 'expectedVersion', 'profile'].includes(key)) throw bad(`Unknown field: ${key}`);
  await sql.tx(async () => {
    if (typeof body.slug === 'string' && body.slug !== current.slug) {
      const slug = body.slug.trim().toLowerCase();
      if (!/^[a-z0-9-]{1,48}$/.test(slug)) throw bad('Slug may contain lowercase letters, digits and dashes.');
      if (await sql.get('SELECT 1 FROM organization WHERE slug = ? AND id <> ?', slug, current.organizationId)) throw new ApiError(409, 'SLUG_EXISTS');
      await sql.run('UPDATE organization SET slug = ? WHERE id = ?', slug, current.organizationId);
    }
    if (body.name !== undefined || body.profile !== undefined) {
      await patchOrganizationSettings(sql, current.organizationId,
        { expectedVersion: typeof body.expectedVersion === 'number' ? body.expectedVersion : current.version, ...(body.name !== undefined ? { name: body.name } : {}), ...(body.profile !== undefined ? { profile: body.profile } : {}) },
        auditActorFor(req, identity));
    }
  });
  await organizationChangedRef?.(current.organizationId);
  res.json({ success: true, organization: await readOrganizationSettings(sql, current.organizationId) });
}));

/** Empties the organization's business data (a superuser tool); the organization itself, members and settings stay. */
authConsoleRouter.post('/organizations/:id/reset', platformHandler(async (req, res, identity) => {
  const id = req.params.id;
  await readOrganizationSettings(sql, id); // 404 for unknown IDs
  if (!globalDbRef || !saveDbFnRef || !storeRef) throw new ApiError(503, 'NOT_READY', 'Business data is not ready.');
  const organization = await sql.get('SELECT slug FROM organization WHERE id = ?', id) as { slug?: string } | undefined;
  const confirmation = String(req.body?.confirm ?? '').trim().toLowerCase();
  if (!organization?.slug || confirmation !== organization.slug.toLowerCase()) throw bad('Type the organization slug to confirm the reset.');
  const result = await resetOrganizationData({
    db: sql,
    memory: globalDbRef,
    organizationId: id,
    storage: storeRef(),
    save: saveDbFnRef,
  });
  await appendAudit(sql, auditActorFor(req, identity), {
    organizationId: id, action: 'organization.reset', targetType: 'organization', targetId: id, outcome: 'success',
    changedFields: Object.keys(result.removed).filter(key => result.removed[key] > 0),
  });
  await organizationChangedRef?.(id);
  res.json({ success: true, ...result });
}));

authConsoleRouter.delete('/organizations/:id', platformHandler(async (req, res, identity) => {
  const id = req.params.id;
  await readOrganizationSettings(sql, id); // 404 for unknown IDs
  const owned = ['partners', 'contracts', 'ios', 'spendings', 'evaluations', 'notifications', 'templates']
    .some((key) => (globalDbRef?.[key] || []).some((row: any) => row?.organizationId === id));
  if (owned) throw new ApiError(409, 'ORGANIZATION_IN_USE', "Move or remove this organization's records first.");
  await sql.tx(async () => {
    await sql.run('DELETE FROM "teamMember" WHERE "teamId" IN (SELECT id FROM team WHERE "organizationId" = ?)', id);
    for (const table of ['member', 'team', 'invitation', 'organization_settings', 'organization_integrations']) await sql.run(`DELETE FROM ${table} WHERE "organizationId" = ?`, id);
    await sql.run('UPDATE session SET "activeOrganizationId" = NULL WHERE "activeOrganizationId" = ?', id);
    await sql.run('DELETE FROM organization WHERE id = ?', id);
    await appendAudit(sql, auditActorFor(req, identity), { organizationId: id, action: 'organization.delete', targetType: 'organization', targetId: id, outcome: 'success', changedFields: [] });
  });
  await organizationChangedRef?.(id);
  res.json({ success: true });
}));

/* Legacy invitation adapters → canonical preview/acceptance (PRD §10.1). */
authConsoleRouter.get('/invitations/verify', async (req: Request, res: Response) => {
  try {
    const code = String(req.query.code || req.query.accept_invite || '');
    return res.json({ success: true, invitation: await previewInvitation(sql, code) });
  } catch (err: any) {
    if (err instanceof ApiError) return sendError(req, res, err.status, err.error, err.message);
    throw err;
  }
});
authConsoleRouter.post('/invitations/accept', platformHandler(async (req, res, identity) => {
  const membership = await acceptInvitation(sql, identity, String(req.body?.code || ''), req);
  res.status(201).json({ success: true, membership });
}));

// 8. GET /api-keys - List API Keys
authConsoleRouter.get('/api-keys', async (req: Request, res: Response) => {
  try {
    const keys = await sql.all(`
      SELECT id, name, "keyPreview", scopes, "createdAt", "expiresAt", status
      FROM apikey
      ORDER BY "createdAt" DESC
    `);

    return res.json({
      success: true,
      apiKeys: keys.map((k: any) => ({
        ...k,
        scopes: k.scopes ? k.scopes.split(',').map((s: string) => s.trim()) : [],
      })),
    });
  } catch (err: any) {
    console.error('Error listing API keys:', err);
    return sendRouteError(req, res, err, "request failed", "Failed to list API keys", { status: 500 });
  }
});

// POST /api-keys - Generate new enterprise API key
authConsoleRouter.post('/api-keys', async (req: Request, res: Response) => {
  try {
    const { name, scopes = ['contract:read'], expiresInDays = 90 } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'API Key name is required' });
    }

    const keyId = `key_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const rawSecret = `ba_live_${crypto.randomBytes(24).toString('hex')}`;
    const keyPreview = `${rawSecret.slice(0, 11)}...${rawSecret.slice(-4)}`;
    const keyHash = crypto.createHash('sha256').update(rawSecret).digest('hex');

    const now = new Date();
    const expires = expiresInDays ? new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000) : null;
    const scopeString = Array.isArray(scopes) ? scopes.join(',') : String(scopes);

    await sql.run(`
      INSERT INTO apikey (id, name, "keyPreview", "keyHash", scopes, "createdAt", "expiresAt", status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `, keyId, name, keyPreview, keyHash, scopeString, now.toISOString(), expires ? expires.toISOString() : null);

    // Return the rawSecret ONCE so user can copy it
    return res.json({
      success: true,
      apiKey: {
        id: keyId,
        name,
        keyPreview,
        rawSecret, // ONLY SHOWN ONCE
        secret: rawSecret,
        scopes: Array.isArray(scopes) ? scopes : [scopes],
        createdAt: now.toISOString(),
        expiresAt: expires ? expires.toISOString() : null,
      },
    });
  } catch (err: any) {
    console.error('Error generating API key:', err);
    return sendRouteError(req, res, err, "request failed", "Failed to generate API key", { status: 500 });
  }
});

// POST /api-keys/:id/revoke - Revoke API key (set status = 'revoked')
authConsoleRouter.post('/api-keys/:id/revoke', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await sql.run('UPDATE apikey SET status = ? WHERE id = ?', 'revoked', id);
    return res.json({ success: true, message: 'API key revoked successfully' });
  } catch (err: any) {
    console.error('Error revoking API key:', err);
    return sendRouteError(req, res, err, "request failed", "Failed to revoke API key", { status: 500 });
  }
});

// DELETE /api-keys/:id - Delete API key permanently or revoke if active
authConsoleRouter.delete('/api-keys/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await sql.run('DELETE FROM apikey WHERE id = ?', id);
    return res.json({ success: true, message: 'API key deleted successfully' });
  } catch (err: any) {
    console.error('Error deleting API key:', err);
    return sendRouteError(req, res, err, "request failed", "Failed to delete API key", { status: 500 });
  }
});


authConsoleRouter.get('/rbac-matrix', platformHandler(async (_req, res) => {
  res.json({ success: true, matrix: buildMatrix() });
}));
