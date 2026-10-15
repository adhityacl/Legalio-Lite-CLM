/**
 * System Admin console API — platform operations only (tenant-boundaries PRD §6.6, §10.1).
 *
 * Every route here is gated by a platform permission in server/routePolicies.ts.
 * Global accounts are platform identities: tenant membership administration
 * lives in the canonical /api/organizations/:organizationId/* services, and
 * nothing here creates or changes a membership implicitly.
 */
import { Router, Request, Response } from 'express';
import { sqliteDb } from './lib/auth';
import { hashPassword } from 'better-auth/crypto';
import crypto from 'crypto';
import fs from 'fs';
import { buildMatrix, isPlatformRole } from './rbac';
import { RequestDenied, accessibleOrganizations, resolveIdentity, sendError, type Identity } from './identity';
import { AUTH_DB_PATH } from './runtimePaths';
import { isDemoAccountEmail } from './demoAccounts';
import { ApiError, appendAudit, patchOrganizationSettings, readOrganizationSettings } from './organizationSettingsStore';
import { assertAdminsRemainWithout, assertSuperusersRemainWithout, auditActorFor, previewInvitation, acceptInvitation } from './organizationAdminRoutes';
import { addMembershipRecord, createIdentityRecord, createOrganizationRecord } from './organizationProvisioning';

export const authConsoleRouter = Router();

let globalDbRef: any = null;
let saveDbFnRef: (() => void) | null = null;
let organizationChangedRef: ((organizationId?: string) => void) | null = null;

/** server.ts shares its projection (for SMTP/branding reads) and a refresh hook. No hydration happens here. */
export function setConsoleDbReference(dbStore: any, saveFn: () => void, onOrganizationsChanged?: (organizationId?: string) => void) {
  globalDbRef = dbStore;
  saveDbFnRef = saveFn;
  organizationChangedRef = onOrganizationsChanged || null;
}

type Handler = (req: Request, res: Response, identity: Identity) => unknown;
/** Wraps a platform handler: verified identity, uniform errors with requestId. */
const platformHandler = (fn: Handler) => async (req: Request, res: Response) => {
  try {
    await fn(req, res, resolveIdentity(sqliteDb, req));
  } catch (err: any) {
    if (err instanceof ApiError || err instanceof RequestDenied) return sendError(req, res, err.status, err.error, err.message);
    console.error('[auth-console]', err);
    return sendError(req, res, 500, 'INTERNAL_ERROR', 'Unexpected server error.');
  }
};
const bad = (message: string) => new ApiError(400, 'INVALID_INPUT', message);
const EMAIL = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;
const platformAudit = (req: Request, identity: Identity, action: string, targetType: string, targetId: string, changedFields: string[] = []) =>
  appendAudit(sqliteDb, auditActorFor(req, identity), { organizationId: null, action, targetType, targetId, outcome: 'success', changedFields });

/**
 * Gives the env-configured bootstrap admin (`demo-admin`) and the demo-workspace
 * logins a password. Nobody else ever gets one implicitly — this used to hand
 * every password-less user (e.g. an invited colleague) a shared default password.
 * No password configured → no-op; the first admin then comes from the setup page.
 */
export async function ensureUserAccountsExist(defaultPassword = process.env.DEMO_ADMIN_PASSWORD || '') {
  if (!defaultPassword) return;
  try {
    const users = (sqliteDb.prepare('SELECT id, email FROM user').all() as any[]).filter(
      (u) => u.id === 'demo-admin' || isDemoAccountEmail(u.email),
    );
    if (users.length === 0) return;
    const now = new Date().toISOString();
    let hashedDef: string | null = null;
    // While the bootstrap admin is still seeded, its credential must track
    // DEMO_ADMIN_PASSWORD on every boot — otherwise editing .env after the
    // account already exists (e.g. kaelyn.db was copied from another install)
    // silently has no effect and the configured login just stops working.
    const reseedBootstrapAdmin = process.env.SEED_DEMO_ADMIN !== 'false' && defaultPassword === process.env.DEMO_ADMIN_PASSWORD;

    for (const u of users) {
      const existing = sqliteDb.prepare("SELECT id FROM account WHERE userId = ? AND providerId = 'credential'").get(u.id) as any;
      if (existing && !(reseedBootstrapAdmin && u.id === 'demo-admin')) continue;
      if (!hashedDef) {
        hashedDef = await hashPassword(defaultPassword);
      }
      if (existing) {
        sqliteDb.prepare('UPDATE account SET password = ?, updatedAt = ? WHERE id = ?').run(hashedDef, now, existing.id);
      } else {
        const accountId = 'acc_' + u.id;
        sqliteDb.prepare(`
          INSERT OR IGNORE INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt, issuer)
          VALUES (?, ?, 'credential', ?, ?, ?, ?, ?)
        `).run(accountId, u.id, u.id, hashedDef, now, now, 'local:credential');
      }
    }
  } catch (err) {
    console.warn('Error ensuring user accounts:', err);
  }
}
// 1. GET /overview - High-level metrics for Console Dashboard
authConsoleRouter.get('/overview', (req: Request, res: Response) => {
  try {
    const totalUsers = (sqliteDb.prepare('SELECT COUNT(*) as count FROM user').get() as any)?.count || 0;
    const activeUsers = (sqliteDb.prepare("SELECT COUNT(*) as count FROM user WHERE banned = 0 OR banned IS NULL").get() as any)?.count || 0;
    const bannedUsers = (sqliteDb.prepare('SELECT COUNT(*) as count FROM user WHERE banned = 1').get() as any)?.count || 0;
    const verifiedUsers = (sqliteDb.prepare('SELECT COUNT(*) as count FROM user WHERE emailVerified = 1').get() as any)?.count || 0;
    
    // Active sessions (not expired)
    const now = new Date().toISOString();
    const activeSessions = (sqliteDb.prepare('SELECT COUNT(*) as count FROM session WHERE expiresAt > ?').get(now) as any)?.count || 0;
    
    // Total accounts & providers
    const totalAccounts = (sqliteDb.prepare('SELECT COUNT(*) as count FROM account').get() as any)?.count || 0;
    const credentialAccounts = (sqliteDb.prepare("SELECT COUNT(*) as count FROM account WHERE providerId = 'credential'").get() as any)?.count || 0;
    const googleAccounts = (sqliteDb.prepare("SELECT COUNT(*) as count FROM account WHERE providerId = 'google'").get() as any)?.count || 0;

    // Organizations & Teams
    const totalOrgs = (sqliteDb.prepare('SELECT COUNT(*) as count FROM organization').get() as any)?.count || 0;
    const totalTeams = (sqliteDb.prepare('SELECT COUNT(*) as count FROM team').get() as any)?.count || 0;
    const pendingInvitations = (sqliteDb.prepare("SELECT COUNT(*) as count FROM invitation WHERE status = 'pending'").get() as any)?.count || 0;
    const totalApiKeys = (sqliteDb.prepare("SELECT COUNT(*) as count FROM apikey WHERE status = 'active'").get() as any)?.count || 0;

    // Platform roles only; tenant roles are per-organization membership data.
    const superusers = (sqliteDb.prepare("SELECT COUNT(*) as count FROM user WHERE role = 'superuser'").get() as any)?.count || 0;
    const roleDistribution: Record<string, number> = { superuser: superusers, user: totalUsers - superusers };

    // Recent users
    const recentUsers = (sqliteDb.prepare('SELECT id, name, email, role, banned, createdAt FROM user ORDER BY createdAt DESC LIMIT 5').all() as any[])
      .map((u) => ({ id: u.id, name: u.name, email: u.email, platformRole: u.role === 'superuser' ? 'superuser' : 'user', banned: Boolean(u.banned), createdAt: u.createdAt }));

    // Recent sessions
    const recentSessions = sqliteDb.prepare(`
      SELECT s.id, s.ipAddress, s.userAgent, s.createdAt, s.expiresAt, u.name as userName, u.email as userEmail
      FROM session s
      LEFT JOIN user u ON s.userId = u.id
      ORDER BY s.createdAt DESC LIMIT 5
    `).all();

    return res.json({
      success: true,
      data: {
        instance: {
          id: 'production',
          name: 'Production',
          env: 'production',
          adapter: 'Better-Auth Native (SQLite)',
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
    return res.status(500).json({ error: err.message || 'Failed to fetch console overview' });
  }
});

/* ------------------------------------------------------------------ */
/* Global accounts (platform identities)                                */
/* ------------------------------------------------------------------ */

const userSelect = `
  SELECT u.id, u.name, u.email, u.emailVerified, u.image, u.createdAt, u.updatedAt, u.role, u.banned, u.banReason, u.banExpires,
    (SELECT COUNT(*) FROM session WHERE userId = u.id) AS sessionCount,
    (SELECT providerId FROM account WHERE userId = u.id LIMIT 1) AS primaryProvider,
    (SELECT COUNT(*) FROM member WHERE userId = u.id) AS membershipCount
  FROM "user" u`;

function platformUserDto(u: any) {
  return {
    id: u.id, name: u.name, email: u.email, emailVerified: Boolean(u.emailVerified), image: u.image || null,
    createdAt: u.createdAt, updatedAt: u.updatedAt, platformRole: u.role === 'superuser' ? 'superuser' : 'user',
    banned: Number(u.banned) === 1, banReason: u.banReason || null, banExpires: u.banExpires || null,
    sessionCount: Number(u.sessionCount) || 0, primaryProvider: u.primaryProvider || null, membershipCount: Number(u.membershipCount) || 0,
  };
}

function loadUser(id: string) {
  const row = sqliteDb.prepare(`${userSelect} WHERE u.id = ?`).get(id) as any;
  if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
  return row;
}

async function setCredentialPassword(userId: string, password: unknown) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 256) throw bad('Password must be 8–256 characters.');
  const hashed = await hashPassword(password);
  const now = new Date().toISOString();
  const existing = sqliteDb.prepare("SELECT id FROM account WHERE userId = ? AND providerId = 'credential'").get(userId) as any;
  if (existing) sqliteDb.prepare('UPDATE account SET password = ?, updatedAt = ? WHERE id = ?').run(hashed, now, existing.id);
  else sqliteDb.prepare(`INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt, issuer) VALUES (?, ?, 'credential', ?, ?, ?, ?, 'local:credential')`)
    .run(`acc_${crypto.randomUUID()}`, userId, userId, hashed, now, now);
}

/** Ban/delete invariants (§4.3 rules 3–4): never strand an organization or the platform. */
function assertAccountRemovable(userId: string) {
  assertSuperusersRemainWithout(sqliteDb, userId);
  assertAdminsRemainWithout(sqliteDb, userId);
}

function setBanned(userId: string, banned: boolean, reason: string | null) {
  if (banned) {
    assertAccountRemovable(userId);
    sqliteDb.prepare('UPDATE "user" SET banned = 1, banReason = ?, banExpires = NULL, updatedAt = ? WHERE id = ?').run(reason, new Date().toISOString(), userId);
    sqliteDb.prepare('DELETE FROM session WHERE userId = ?').run(userId);
  } else {
    sqliteDb.prepare('UPDATE "user" SET banned = 0, banReason = NULL, banExpires = NULL, updatedAt = ? WHERE id = ?').run(new Date().toISOString(), userId);
  }
}

function deleteAccount(userId: string) {
  assertAccountRemovable(userId);
  for (const table of ['session', 'account', 'teamMember', 'member']) sqliteDb.prepare(`DELETE FROM "${table}" WHERE userId = ?`).run(userId);
  sqliteDb.prepare('DELETE FROM "user" WHERE id = ?').run(userId); // audit_log keeps the actor id (no cascade)
}

authConsoleRouter.get('/users', platformHandler((req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase().slice(0, 200) : '';
  const rows = sqliteDb.prepare(`${userSelect} ORDER BY u.createdAt DESC, u.id`).all() as any[];
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
  if (sqliteDb.prepare('SELECT 1 FROM "user" WHERE LOWER(email) = ?').get(cleanEmail)) throw new ApiError(409, 'ACCOUNT_EXISTS', 'An account with this email already exists.');
  if (password !== undefined && (typeof password !== 'string' || password.length < 8)) throw bad('Password must be at least 8 characters.');
  const hashed = typeof password === 'string' ? await hashPassword(password) : null;
  const id = sqliteDb.transaction(() => {
    const userId = createIdentityRecord(sqliteDb, { name: cleanName, email: cleanEmail, platformRole });
    if (hashed) {
      const now = new Date().toISOString();
      sqliteDb.prepare(`INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt, issuer) VALUES (?, ?, 'credential', ?, ?, ?, ?, 'local:credential')`)
        .run(`acc_${crypto.randomUUID()}`, userId, userId, hashed, now, now);
    }
    platformAudit(req, identity, 'platform.user.create', 'user', userId, ['name', 'email', 'platformRole']);
    return userId;
  })();
  res.status(201).json({ success: true, user: platformUserDto(loadUser(id)) });
}));

authConsoleRouter.put('/users/:id', platformHandler((req, res, identity) => {
  const body = req.body || {};
  for (const key of Object.keys(body)) if (!['name', 'email'].includes(key)) throw bad(`Unknown field: ${key}`);
  const user = loadUser(req.params.id);
  const changed: string[] = [];
  sqliteDb.transaction(() => {
    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 200);
      if (!name) throw bad('Name is required.');
      sqliteDb.prepare('UPDATE "user" SET name = ?, updatedAt = ? WHERE id = ?').run(name, new Date().toISOString(), user.id);
      changed.push('name');
    }
    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase();
      if (!EMAIL.test(email)) throw bad('Email is not valid.');
      if (sqliteDb.prepare('SELECT 1 FROM "user" WHERE LOWER(email) = ? AND id <> ?').get(email, user.id)) throw new ApiError(409, 'ACCOUNT_EXISTS', 'Another account uses this email.');
      sqliteDb.prepare('UPDATE "user" SET email = ?, emailVerified = 0, updatedAt = ? WHERE id = ?').run(email, new Date().toISOString(), user.id);
      changed.push('email');
    }
    platformAudit(req, identity, 'platform.user.update', 'user', user.id, changed);
  })();
  res.json({ success: true, user: platformUserDto(loadUser(user.id)) });
}));

const passwordHandler = platformHandler(async (req, res, identity) => {
  const user = loadUser(req.params.id);
  await setCredentialPassword(user.id, req.body?.password ?? req.body?.newPassword);
  platformAudit(req, identity, 'platform.user.password.reset', 'user', user.id, ['password']);
  res.json({ success: true });
});
authConsoleRouter.post('/users/:id/reset-password', passwordHandler);
authConsoleRouter.put('/users/:id/password', passwordHandler);

authConsoleRouter.put('/users/:id/role', platformHandler((req, res, identity) => {
  const platformRole = req.body?.platformRole;
  if (!isPlatformRole(platformRole)) throw bad('platformRole must be user or superuser.');
  const user = loadUser(req.params.id);
  if (user.id === identity.userId) throw new ApiError(403, 'INSUFFICIENT_PERMISSION', 'You cannot change your own platform role.');
  sqliteDb.transaction(() => {
    if (user.role === 'superuser' && platformRole !== 'superuser') assertSuperusersRemainWithout(sqliteDb, user.id);
    sqliteDb.prepare('UPDATE "user" SET role = ?, updatedAt = ? WHERE id = ?').run(platformRole, new Date().toISOString(), user.id);
    // Cached privileges end with the role change.
    sqliteDb.prepare('DELETE FROM session WHERE userId = ?').run(user.id);
    platformAudit(req, identity, 'platform.user.role.update', 'user', user.id, ['platformRole']);
  })();
  res.json({ success: true, user: platformUserDto(loadUser(user.id)) });
}));

authConsoleRouter.post('/users/:id/ban', platformHandler((req, res, identity) => {
  const banned = req.body?.banned !== false;
  const user = loadUser(req.params.id);
  if (user.id === identity.userId) throw new ApiError(403, 'INSUFFICIENT_PERMISSION', 'You cannot disable your own account.');
  const reason = typeof req.body?.banReason === 'string' ? req.body.banReason.slice(0, 500) : null;
  sqliteDb.transaction(() => {
    setBanned(user.id, banned, reason);
    platformAudit(req, identity, banned ? 'platform.user.ban' : 'platform.user.unban', 'user', user.id, ['banned']);
  })();
  res.json({ success: true, user: platformUserDto(loadUser(user.id)) });
}));

authConsoleRouter.delete('/users/:id', platformHandler((req, res, identity) => {
  const user = loadUser(req.params.id);
  if (user.id === identity.userId) throw new ApiError(403, 'INSUFFICIENT_PERMISSION', 'You cannot delete your own account.');
  sqliteDb.transaction(() => {
    deleteAccount(user.id);
    platformAudit(req, identity, 'platform.user.delete', 'user', user.id);
  })();
  res.json({ success: true });
}));

/** All targets validated first; the whole batch commits or nothing does. */
authConsoleRouter.post('/users/bulk-action', platformHandler((req, res, identity) => {
  const { action, userIds } = req.body || {};
  const needs: Record<string, string> = { ban: 'platform.user.ban', unban: 'platform.user.ban', delete: 'platform.user.delete' };
  if (!needs[action]) throw bad('action must be ban, unban or delete.');
  if (!identity.platformPermissions.includes(needs[action])) throw new ApiError(403, 'INSUFFICIENT_PERMISSION');
  if (!Array.isArray(userIds) || userIds.length === 0 || userIds.length > 500 || userIds.some((id) => typeof id !== 'string')) throw bad('userIds must be a non-empty list.');
  if (userIds.includes(identity.userId)) throw new ApiError(403, 'INSUFFICIENT_PERMISSION', 'You cannot include your own account.');
  for (const id of userIds) loadUser(id);
  sqliteDb.transaction(() => {
    for (const id of userIds) {
      if (action === 'delete') deleteAccount(id);
      else setBanned(id, action === 'ban', action === 'ban' ? 'Bulk action' : null);
      platformAudit(req, identity, `platform.user.${action}`, 'user', id, action === 'delete' ? [] : ['banned']);
    }
  })();
  res.json({ success: true, count: userIds.length });
}));

// 3. GET /accounts - List all linked auth provider accounts
authConsoleRouter.get('/accounts', (req: Request, res: Response) => {
  try {
    const accounts = sqliteDb.prepare(`
      SELECT 
        a.id, 
        a.accountId, 
        a.providerId, 
        a.userId, 
        a.createdAt, 
        a.updatedAt,
        CASE WHEN a.password IS NOT NULL THEN 1 ELSE 0 END as hasPassword,
        u.name as userName,
        u.email as userEmail,
        CASE WHEN u.role = 'superuser' THEN 'superuser' ELSE 'user' END as platformRole
      FROM account a
      LEFT JOIN user u ON a.userId = u.id
      ORDER BY a.createdAt DESC
    `).all();

    return res.json({
      success: true,
      accounts: accounts.map((a: any) => ({
        ...a,
        hasPassword: Boolean(a.hasPassword),
      })),
    });
  } catch (err: any) {
    console.error('Error listing accounts:', err);
    return res.status(500).json({ error: err.message || 'Failed to list accounts' });
  }
});

// 4. GET /sessions - List active sessions
authConsoleRouter.get('/sessions', (req: Request, res: Response) => {
  try {
    const sessions = sqliteDb.prepare(`
      SELECT 
        s.id, 
        s.createdAt, 
        s.updatedAt, 
        s.expiresAt, 
        s.ipAddress, 
        s.userAgent, 
        s.userId,
        s.impersonatedBy,
        s.activeOrganizationId,
        u.name as userName,
        u.email as userEmail,
        CASE WHEN u.role = 'superuser' THEN 'superuser' ELSE 'user' END as platformRole
      FROM session s
      LEFT JOIN user u ON s.userId = u.id
      ORDER BY s.createdAt DESC
    `).all();

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
    return res.status(500).json({ error: err.message || 'Failed to list sessions' });
  }
});

// DELETE /sessions/:id - Revoke single session
authConsoleRouter.delete('/sessions/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    sqliteDb.prepare('DELETE FROM session WHERE id = ?').run(id);
    return res.json({ success: true, message: 'Session revoked successfully' });
  } catch (err: any) {
    console.error('Error revoking session:', err);
    return res.status(500).json({ error: err.message || 'Failed to revoke session' });
  }
});

// POST /sessions/revoke-user - Revoke all sessions for a user
authConsoleRouter.post('/sessions/revoke-user', (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    sqliteDb.prepare('DELETE FROM session WHERE userId = ?').run(userId);
    return res.json({ success: true, message: `All sessions revoked for user ${userId}` });
  } catch (err: any) {
    console.error('Error revoking user sessions:', err);
    return res.status(500).json({ error: err.message || 'Failed to revoke user sessions' });
  }
});

// POST /sessions/revoke-all/:userId - Param-based alias for revoking all sessions of a user
authConsoleRouter.post('/sessions/revoke-all/:userId', (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    sqliteDb.prepare('DELETE FROM session WHERE userId = ?').run(userId);
    return res.json({ success: true, message: `All sessions revoked for user ${userId}` });
  } catch (err: any) {
    console.error('Error revoking user sessions:', err);
    return res.status(500).json({ error: err.message || 'Failed to revoke user sessions' });
  }
});


/* ------------------------------------------------------------------ */
/* Organization directory (platform) / accessible summaries (others)    */
/* ------------------------------------------------------------------ */

authConsoleRouter.get('/organizations', platformHandler((req, res, identity) => {
  const accessible = new Set(accessibleOrganizations(sqliteDb, identity).map((o) => o.organizationId));
  const rows = sqliteDb.prepare(`
    SELECT o.id, o.name, o.slug, o.logo, o.createdAt,
      (SELECT COUNT(*) FROM member WHERE organizationId = o.id AND status = 'active') AS memberCount,
      (SELECT COUNT(*) FROM team WHERE organizationId = o.id) AS teamCount
    FROM organization o ORDER BY o.name COLLATE NOCASE, o.id
  `).all() as any[];
  const isPlatform = identity.platformPermissions.includes('platform.organization.read');
  const organizations = rows.filter((o) => accessible.has(o.id)).map((o) => {
    if (!isPlatform) return { id: o.id, name: o.name, slug: o.slug, logo: o.logo };
    const settings = readOrganizationSettings(sqliteDb, o.id);
    return { id: o.id, name: o.name, slug: o.slug, logo: o.logo, createdAt: o.createdAt, memberCount: o.memberCount, teamCount: o.teamCount, version: settings.version, metadata: { ...settings.profile, currency: settings.policy.defaultCurrency } };
  });
  res.json({ success: true, organizations });
}));

/** Platform creation with an explicitly selected first tenant admin (PRD §10.2). */
authConsoleRouter.post('/organizations', platformHandler((req, res, identity) => {
  const body = req.body || {};
  for (const key of Object.keys(body)) if (!['name', 'slug', 'countryCode', 'industry', 'defaultCurrency', 'legalEntity', 'adminUserId'].includes(key)) throw bad(`Unknown field: ${key}`);
  const name = String(body.name || '').trim();
  if (!name || name.length > 200) throw bad('Organization name is required (1–200 characters).');
  if (body.adminUserId !== undefined) {
    const admin = sqliteDb.prepare('SELECT id, role, banned FROM "user" WHERE id = ?').get(body.adminUserId) as any;
    if (!admin || Number(admin.banned) === 1) throw bad('The selected administrator does not exist or is disabled.');
  }
  const id = sqliteDb.transaction(() => {
    const orgId = createOrganizationRecord(sqliteDb, {
      name, slug: typeof body.slug === 'string' ? body.slug : undefined,
      legalEntity: typeof body.legalEntity === 'string' ? body.legalEntity.slice(0, 200) : '',
      settings: { countryCode: body.countryCode, industry: body.industry, defaultCurrency: body.defaultCurrency },
    }, identity.userId);
    if (body.adminUserId) addMembershipRecord(sqliteDb, { userId: body.adminUserId, organizationId: orgId, tenantRole: 'admin' });
    appendAudit(sqliteDb, auditActorFor(req, identity), { organizationId: orgId, action: 'organization.create', targetType: 'organization', targetId: orgId, outcome: 'success', changedFields: ['name', ...(body.adminUserId ? ['admin'] : [])] });
    return orgId;
  })();
  organizationChangedRef?.(id);
  res.status(201).json({ success: true, organization: { id, ...readOrganizationSettings(sqliteDb, id) } });
}));

authConsoleRouter.put('/organizations/:id', platformHandler((req, res, identity) => {
  const current = readOrganizationSettings(sqliteDb, req.params.id);
  const body = req.body || {};
  for (const key of Object.keys(body)) if (!['name', 'slug', 'expectedVersion', 'profile'].includes(key)) throw bad(`Unknown field: ${key}`);
  sqliteDb.transaction(() => {
    if (typeof body.slug === 'string' && body.slug !== current.slug) {
      const slug = body.slug.trim().toLowerCase();
      if (!/^[a-z0-9-]{1,48}$/.test(slug)) throw bad('Slug may contain lowercase letters, digits and dashes.');
      if (sqliteDb.prepare('SELECT 1 FROM organization WHERE slug = ? AND id <> ?').get(slug, current.organizationId)) throw new ApiError(409, 'SLUG_EXISTS');
      sqliteDb.prepare('UPDATE organization SET slug = ? WHERE id = ?').run(slug, current.organizationId);
    }
    if (body.name !== undefined || body.profile !== undefined) {
      patchOrganizationSettings(sqliteDb, current.organizationId,
        { expectedVersion: typeof body.expectedVersion === 'number' ? body.expectedVersion : current.version, ...(body.name !== undefined ? { name: body.name } : {}), ...(body.profile !== undefined ? { profile: body.profile } : {}) },
        auditActorFor(req, identity));
    }
  })();
  organizationChangedRef?.(current.organizationId);
  res.json({ success: true, organization: readOrganizationSettings(sqliteDb, current.organizationId) });
}));

authConsoleRouter.delete('/organizations/:id', platformHandler((req, res, identity) => {
  const id = req.params.id;
  readOrganizationSettings(sqliteDb, id); // 404 for unknown IDs
  const owned = ['partners', 'contracts', 'ios', 'spendings', 'evaluations', 'notifications', 'templates']
    .some((key) => (globalDbRef?.[key] || []).some((row: any) => row?.organizationId === id));
  if (owned) throw new ApiError(409, 'ORGANIZATION_IN_USE', "Move or remove this organization's records first.");
  sqliteDb.transaction(() => {
    sqliteDb.prepare('DELETE FROM teamMember WHERE teamId IN (SELECT id FROM team WHERE organizationId = ?)').run(id);
    for (const table of ['member', 'team', 'invitation', 'organization_settings', 'organization_integrations']) sqliteDb.prepare(`DELETE FROM ${table} WHERE organizationId = ?`).run(id);
    sqliteDb.prepare('UPDATE session SET activeOrganizationId = NULL WHERE activeOrganizationId = ?').run(id);
    sqliteDb.prepare('DELETE FROM organization WHERE id = ?').run(id);
    appendAudit(sqliteDb, auditActorFor(req, identity), { organizationId: id, action: 'organization.delete', targetType: 'organization', targetId: id, outcome: 'success', changedFields: [] });
  })();
  organizationChangedRef?.(id);
  res.json({ success: true });
}));

/* Legacy invitation adapters → canonical preview/acceptance (PRD §10.1). */
authConsoleRouter.get('/invitations/verify', (req: Request, res: Response) => {
  try {
    const code = String(req.query.code || req.query.accept_invite || '');
    return res.json({ success: true, invitation: previewInvitation(sqliteDb, code) });
  } catch (err: any) {
    if (err instanceof ApiError) return sendError(req, res, err.status, err.error, err.message);
    throw err;
  }
});
authConsoleRouter.post('/invitations/accept', platformHandler((req, res, identity) => {
  const membership = acceptInvitation(sqliteDb, identity, String(req.body?.code || ''), req);
  res.status(201).json({ success: true, membership });
}));

// 8. GET /api-keys - List API Keys
authConsoleRouter.get('/api-keys', (req: Request, res: Response) => {
  try {
    const keys = sqliteDb.prepare(`
      SELECT id, name, keyPreview, scopes, createdAt, expiresAt, status
      FROM apikey
      ORDER BY createdAt DESC
    `).all();

    return res.json({
      success: true,
      apiKeys: keys.map((k: any) => ({
        ...k,
        scopes: k.scopes ? k.scopes.split(',').map((s: string) => s.trim()) : [],
      })),
    });
  } catch (err: any) {
    console.error('Error listing API keys:', err);
    return res.status(500).json({ error: err.message || 'Failed to list API keys' });
  }
});

// POST /api-keys - Generate new enterprise API key
authConsoleRouter.post('/api-keys', (req: Request, res: Response) => {
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

    sqliteDb.prepare(`
      INSERT INTO apikey (id, name, keyPreview, keyHash, scopes, createdAt, expiresAt, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(keyId, name, keyPreview, keyHash, scopeString, now.toISOString(), expires ? expires.toISOString() : null);

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
    return res.status(500).json({ error: err.message || 'Failed to generate API key' });
  }
});

// POST /api-keys/:id/revoke - Revoke API key (set status = 'revoked')
authConsoleRouter.post('/api-keys/:id/revoke', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    sqliteDb.prepare('UPDATE apikey SET status = ? WHERE id = ?').run('revoked', id);
    return res.json({ success: true, message: 'API key revoked successfully' });
  } catch (err: any) {
    console.error('Error revoking API key:', err);
    return res.status(500).json({ error: err.message || 'Failed to revoke API key' });
  }
});

// DELETE /api-keys/:id - Delete API key permanently or revoke if active
authConsoleRouter.delete('/api-keys/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    sqliteDb.prepare('DELETE FROM apikey WHERE id = ?').run(id);
    return res.json({ success: true, message: 'API key deleted successfully' });
  } catch (err: any) {
    console.error('Error deleting API key:', err);
    return res.status(500).json({ error: err.message || 'Failed to delete API key' });
  }
});


authConsoleRouter.get('/rbac-matrix', platformHandler((_req, res) => {
  res.json({ success: true, matrix: buildMatrix() });
}));

// 10. SQLite Database Status & Metrics
authConsoleRouter.get('/sqlite/status', (req: Request, res: Response) => {
  try {
    const dbPath = AUTH_DB_PATH;
    let fileSizeBytes = 0;
    let modifiedAt: string | null = null;
    if (fs.existsSync(dbPath)) {
      const stat = fs.statSync(dbPath);
      fileSizeBytes = stat.size;
      modifiedAt = stat.mtime.toISOString();
    }

    const journalModeRow = sqliteDb.prepare('PRAGMA journal_mode').get() as any;
    const versionRow = sqliteDb.prepare('SELECT sqlite_version() as version').get() as any;
    const pageCountRow = sqliteDb.prepare('PRAGMA page_count').get() as any;
    const pageSizeRow = sqliteDb.prepare('PRAGMA page_size').get() as any;

    const tables = sqliteDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];

    const tableSummaries: Record<string, number> = {};
    let totalRecords = 0;
    for (const t of tables) {
      try {
        const countRow = sqliteDb.prepare(`SELECT COUNT(*) as count FROM "${t.name}"`).get() as any;
        const count = countRow?.count || 0;
        tableSummaries[t.name] = count;
        totalRecords += count;
      } catch (e) {
        tableSummaries[t.name] = 0;
      }
    }

    return res.json({
      success: true,
      status: 'active',
      journalMode: journalModeRow?.journal_mode || 'wal',
      version: versionRow?.version || '3.x',
      fileSizeBytes,
      pageCount: pageCountRow?.page_count || 0,
      pageSize: pageSizeRow?.page_size || 4096,
      modifiedAt,
      tablesCount: tables.length,
      totalRecords,
      tableSummaries,
    });
  } catch (err: any) {
    console.error('Error fetching SQLite status:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch SQLite status' });
  }
});

// 11. SQLite Database Tables List
authConsoleRouter.get('/sqlite/tables', (req: Request, res: Response) => {
  try {
    const tables = sqliteDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];

    const result = tables.map((t) => {
      let count = 0;
      let columnsCount = 0;
      try {
        const countRow = sqliteDb.prepare(`SELECT COUNT(*) as count FROM "${t.name}"`).get() as any;
        count = countRow?.count || 0;
        const cols = sqliteDb.prepare(`PRAGMA table_xinfo("${t.name}")`).all() as any[];
        columnsCount = cols.length;
      } catch (e) {}
      return {
        name: t.name,
        count,
        columnsCount,
      };
    });

    return res.json({ success: true, tables: result });
  } catch (err: any) {
    console.error('Error fetching SQLite tables:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch SQLite tables' });
  }
});

// Columns that hold live credentials rather than ordinary application data —
// masked in the raw-row browser below even for Superuser, so this debugging
// tool can't be used to lift a working session token or a password hash out
// of the database (QA/QC audit finding L1).
const SQLITE_BROWSER_REDACTED_COLUMNS: Record<string, string[]> = {
  session: ['token'],
  account: ['password', 'accessToken', 'refreshToken', 'idToken'],
  verification: ['value'],
  apikey: ['keyHash'],
  integration_credentials: ['payload'],
  app_settings: ['payload'],
};
function redactSensitiveColumns(tableName: string, rows: any[]): any[] {
  const columnsToRedact = SQLITE_BROWSER_REDACTED_COLUMNS[tableName];
  if (!columnsToRedact || columnsToRedact.length === 0) return rows;
  return rows.map((row) => {
    const redacted = { ...row };
    for (const col of columnsToRedact) {
      if (redacted[col] != null && redacted[col] !== '') redacted[col] = '[redacted]';
    }
    return redacted;
  });
}

// 12. SQLite Database Table Data & Records Browser
authConsoleRouter.get('/sqlite/table-data', (req: Request, res: Response) => {
  try {
    const tableName = String(req.query.table || '').trim();
    if (!tableName || !/^[a-zA-Z0-9_]+$/.test(tableName)) {
      return res.status(400).json({ error: 'Invalid table name' });
    }

    const tableExists = sqliteDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
    if (!tableExists) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);
    const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);
    const search = String(req.query.search || '').trim();

    const columns = sqliteDb.prepare(`PRAGMA table_xinfo("${tableName}")`).all() as {
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: any;
      pk: number;
    }[];

    let rows: any[] = [];
    let total = 0;

    // Redacted columns are not searchable either: match counts would leak their contents.
    const redacted = new Set(SQLITE_BROWSER_REDACTED_COLUMNS[tableName] ?? []);
    const searchable = columns.filter((c) => !redacted.has(c.name));

    if (search && searchable.length > 0) {
      const searchConditions = searchable.map((c) => `CAST("${c.name}" AS TEXT) LIKE ?`).join(' OR ');
      const searchParam = `%${search}%`;
      const searchParams = searchable.map(() => searchParam);

      const totalRow = sqliteDb.prepare(`SELECT COUNT(*) as count FROM "${tableName}" WHERE ${searchConditions}`).get(...searchParams) as any;
      total = totalRow?.count || 0;

      rows = sqliteDb
        .prepare(`SELECT * FROM "${tableName}" WHERE ${searchConditions} LIMIT ? OFFSET ?`)
        .all(...searchParams, limit, offset);
    } else {
      const totalRow = sqliteDb.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get() as any;
      total = totalRow?.count || 0;

      rows = sqliteDb.prepare(`SELECT * FROM "${tableName}" LIMIT ? OFFSET ?`).all(limit, offset);
    }

    return res.json({
      success: true,
      table: tableName,
      columns,
      rows: redactSensitiveColumns(tableName, rows),
      total,
      limit,
      offset,
    });
  } catch (err: any) {
    console.error('Error fetching SQLite table data:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch SQLite table data' });
  }
});

// 13. SQLite DB Maintenance (Optimize / PRAGMA optimize)
authConsoleRouter.post('/sqlite/optimize', (req: Request, res: Response) => {
  try {
    sqliteDb.prepare('PRAGMA optimize').run();
    return res.json({ success: true, message: 'Database optimized successfully' });
  } catch (err: any) {
    console.error('Error optimizing SQLite:', err);
    return res.status(500).json({ error: err.message || 'Failed to optimize SQLite database' });
  }
});
