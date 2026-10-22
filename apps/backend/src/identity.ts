/**
 * Shared identity and organization-context resolution (tenant-boundaries PRD §5).
 *
 * One resolver for custom Express routes, the Better Auth boundary and
 * uploads: the session token must exist, be unexpired, belong to an existing
 * identity, and that identity must not be banned. Identity never comes from
 * x-user-email / x-role style headers or request bodies.
 */
import type express from 'express';
import type { Sql } from './db';
import crypto from 'crypto';
import { getPublicBaseUrl } from './installationSettings';
import {
  isTenantRole, membershipContext, platformContext, platformPermissionsFor, platformRoleOf,
  type OrgContext, type PlatformRole,
} from './rbac';

type DB = Sql;

export interface Identity {
  userId: string;
  email: string;
  name: string;
  image: string | null;
  emailVerified: boolean;
  platformRole: PlatformRole;
  platformPermissions: string[];
  sessionId: string;
  sessionToken: string;
  sessionDefaultOrganizationId: string | null;
  viaCookie: boolean;
}

export class RequestDenied extends Error {
  constructor(public status: number, public error: string, message?: string) {
    super(message || error);
  }
}

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'Authentication is required.',
  ACCOUNT_DISABLED: 'This account is disabled.',
  ACCOUNT_PENDING_APPROVAL: 'Your account is waiting for manual superuser approval.',
  RESOURCE_NOT_FOUND: 'Resource not found.',
  INSUFFICIENT_PERMISSION: 'You do not have permission to perform this action.',
  ORGANIZATION_SELECTOR_CONFLICT: 'The request names more than one organization.',
  ORGANIZATION_REQUIRED: 'Select an organization first.',
  INVALID_INPUT: 'Invalid input.',
  CSRF_REJECTED: 'Cross-site request rejected.',
};

export function requestIdOf(req: express.Request): string {
  const r = req as any;
  if (!r.requestId) r.requestId = crypto.randomUUID();
  return r.requestId;
}

/** Standard error body (§5.6): `{ error, message, requestId }`. */
export function sendError(req: express.Request, res: express.Response, status: number, error: string, message?: string) {
  return res.status(status).json({ error, message: message || MESSAGES[error] || error, requestId: requestIdOf(req) });
}

/* ------------------------------------------------------------------ */
/* Identity                                                             */
/* ------------------------------------------------------------------ */

function readCookieToken(req: express.Request): string {
  const cookie = String(req.headers.cookie || '');
  const match = cookie.match(/(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]).split('.')[0];
  } catch {
    return '';
  }
}

export function readSessionToken(req: express.Request): { token: string; viaCookie: boolean } {
  const header = String(req.headers.authorization || req.headers['x-session-token'] || '').trim();
  if (header) return { token: header.replace(/^Bearer\s+/i, '').trim(), viaCookie: false };
  return { token: readCookieToken(req), viaCookie: true };
}

/** Parses a stored timestamp (ISO text or epoch ms/s). Malformed values are invalid (null). */
export function parseTimestamp(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : null;
  const text = String(value);
  if (/^\d+$/.test(text)) return parseTimestamp(Number(text));
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

export function isIdentityBanned(user: { banned?: unknown; banExpires?: unknown }, now = Date.now()): boolean {
  if (Number(user.banned) !== 1 && user.banned !== true) return false;
  const until = parseTimestamp(user.banExpires);
  return until === null || until > now;
}

/** The identity the authorization middleware verified for this request, or 401. */
export function identityOf(req: express.Request): Identity {
  const identity = (req as any).identity as Identity | undefined;
  if (!identity) throw new RequestDenied(401, 'UNAUTHENTICATED');
  return identity;
}

/** Resolves the caller's identity, or throws RequestDenied (401/403). */
export async function resolveIdentity(db: DB, req: express.Request): Promise<Identity> {
  const cached = (req as any).identity as Identity | undefined;
  if (cached) return cached;
  const { token, viaCookie } = readSessionToken(req);
  if (!token || token.length > 512) throw new RequestDenied(401, 'UNAUTHENTICATED');
  const session = await db.get(`SELECT id, "userId", "expiresAt", "activeOrganizationId" FROM session WHERE token = ?`, token) as any;
  if (!session) throw new RequestDenied(401, 'UNAUTHENTICATED');
  const expires = parseTimestamp(session.expiresAt);
  if (expires === null || expires <= Date.now()) throw new RequestDenied(401, 'UNAUTHENTICATED');
  const user = await db.get(`SELECT id, email, name, image, "emailVerified", role, banned, "banReason", "banExpires" FROM "user" WHERE id = ?`, session.userId) as any;
  if (!user) throw new RequestDenied(401, 'UNAUTHENTICATED');
  if (isIdentityBanned(user)) throw new RequestDenied(403, user.banReason === 'PENDING_APPROVAL' ? 'ACCOUNT_PENDING_APPROVAL' : 'ACCOUNT_DISABLED');
  const platformRole = platformRoleOf(user.role);
  const identity: Identity = {
    userId: user.id,
    email: String(user.email || '').toLowerCase(),
    name: user.name || '',
    image: user.image || null,
    emailVerified: Number(user.emailVerified) === 1 || user.emailVerified === true,
    platformRole,
    platformPermissions: platformPermissionsFor(platformRole),
    sessionId: session.id,
    sessionToken: token,
    sessionDefaultOrganizationId: session.activeOrganizationId || null,
    viaCookie,
  };
  (req as any).identity = identity;
  return identity;
}

/* ------------------------------------------------------------------ */
/* Same-origin protection for cookie-authenticated mutations            */
/* ------------------------------------------------------------------ */

const extraOrigins = (process.env.TRUSTED_ORIGINS || '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);

export function isSameOriginRequest(req: express.Request): boolean {
  const origin = String(req.headers.origin || '') || (() => {
    try { return new URL(String(req.headers.referer || '')).origin; } catch { return ''; }
  })();
  if (!origin) return false;
  const publicBaseUrl = getPublicBaseUrl();
  if (extraOrigins.includes(origin) || (publicBaseUrl && origin === publicBaseUrl)) return true;
  try {
    const host = new URL(origin).host;
    const hosts = [String(req.headers['x-forwarded-host'] || '').split(',')[0].trim(), String(req.headers.host || '')];
    return hosts.includes(host);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Organization selection and context                                   */
/* ------------------------------------------------------------------ */

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Every explicit organization selector on a legacy request (§5.2 rule 1).
 * Distinct values mean a conflict; the caller decides precedence of none.
 */
export function collectSelectors(req: express.Request, options: { includeBody?: boolean } = {}): string[] {
  const values = [
    clean(req.headers['x-organization-id']),
    clean(req.headers['x-tenant-id']),
    clean((req.query as any)?.tenantId),
    clean((req.query as any)?.organizationId),
  ];
  if (options.includeBody !== false && req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    values.push(clean(req.body.organizationId));
  }
  return Array.from(new Set(values.filter(Boolean)));
}

export async function departmentIdsOf(db: DB, userId: string, organizationId: string): Promise<string[]> {
  return (await db.all(`
    SELECT t.id FROM "teamMember" tm JOIN team t ON t.id = tm."teamId"
    WHERE tm."userId" = ? AND t."organizationId" = ? ORDER BY t."createdAt" ASC, t.id ASC
  `, userId, organizationId) as Array<{ id: string }>).map((r) => r.id);
}

export interface MembershipRow {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  status: string;
}

export async function membershipOf(db: DB, userId: string, organizationId: string): Promise<MembershipRow | null> {
  return (await db.get(`SELECT id, "organizationId", "userId", role, status FROM member WHERE "userId" = ? AND "organizationId" = ?`, userId, organizationId) as MembershipRow | undefined) || null;
}

/**
 * Context for one explicit organization. Ordinary identities need a current
 * active membership with a valid tenant role (checked in the database on every
 * request); a superuser gets explicit platform-management context. Anything
 * else is indistinguishable from a missing organization (404).
 */
export async function resolveOrganizationContext(db: DB, identity: Identity, organizationId: string): Promise<OrgContext> {
  if (!organizationId || organizationId.length > 200 || !await db.get(`SELECT 1 FROM organization WHERE id = ?`, organizationId)) {
    throw new RequestDenied(404, 'RESOURCE_NOT_FOUND');
  }
  if (identity.platformRole === 'superuser') {
    return platformContext({ organizationId, userId: identity.userId });
  }
  const membership = await membershipOf(db, identity.userId, organizationId);
  if (!membership || membership.status !== 'active' || !isTenantRole(membership.role)) {
    throw new RequestDenied(404, 'RESOURCE_NOT_FOUND');
  }
  return membershipContext({
    organizationId,
    userId: identity.userId,
    platformRole: identity.platformRole,
    membershipId: membership.id,
    tenantRole: membership.role,
    departmentIds: await departmentIdsOf(db, identity.userId, organizationId),
  });
}

/** Whether the identity may select the organization (same rule, no context built). */
export async function canAccessOrganization(db: DB, identity: Identity, organizationId: string): Promise<boolean> {
  try {
    await resolveOrganizationContext(db, identity, organizationId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Legacy-route selection (§5.2): explicit selectors win and must agree;
 * otherwise the session default is used only if still accessible; otherwise
 * ORGANIZATION_REQUIRED. Never the first/default organization.
 */
export async function resolveLegacyContext(db: DB, identity: Identity, req: express.Request, options: { includeBody?: boolean } = {}): Promise<OrgContext> {
  const selectors = collectSelectors(req, options);
  if (selectors.length > 1) throw new RequestDenied(400, 'ORGANIZATION_SELECTOR_CONFLICT');
  if (selectors.length === 1) return resolveOrganizationContext(db, identity, selectors[0]);
  if (identity.sessionDefaultOrganizationId && await canAccessOrganization(db, identity, identity.sessionDefaultOrganizationId)) {
    return resolveOrganizationContext(db, identity, identity.sessionDefaultOrganizationId);
  }
  throw new RequestDenied(409, 'ORGANIZATION_REQUIRED');
}

/**
 * Legacy handlers read `req.actor`. It is derived from the verified context
 * only; a platform role is never written into `role`/`tenantRole`.
 */
export interface LegacyActor {
  id: string;
  role: string;
  tenantId: string;
  departmentId: string | null;
  departmentIds: string[];
  permissions: string[];
  accessMode: OrgContext['accessMode'];
  platformRole: PlatformRole;
  tenantRole: OrgContext['tenantRole'];
}

export function legacyActorOf(ctx: OrgContext): LegacyActor {
  return {
    id: ctx.userId,
    role: ctx.tenantRole ?? 'platform',
    tenantId: ctx.organizationId,
    departmentId: ctx.departmentIds[0] ?? null,
    departmentIds: ctx.departmentIds,
    permissions: ctx.permissions,
    accessMode: ctx.accessMode,
    platformRole: ctx.platformRole,
    tenantRole: ctx.tenantRole,
  };
}

/** Accessible organizations for the switcher: own active memberships, plus the directory for a superuser. */
export async function accessibleOrganizations(db: DB, identity: Identity) {
  // A superuser always works in platform-management context (§5.3), so its
  // switcher is the deduplicated directory rather than membership rows.
  if (identity.platformRole === 'superuser') {
    return (await db.all(`SELECT id, name, slug, logo FROM organization ORDER BY lower(name), id`) as any[])
      .map((o) => ({ organizationId: o.id as string, organizationName: o.name as string, slug: (o.slug || '') as string, logoUrl: (o.logo || null) as string | null, tenantRole: null, accessMode: 'platform' as const }));
  }
  const own = await db.all(`
    SELECT o.id, o.name, o.slug, o.logo, m.role AS "tenantRole"
    FROM member m JOIN organization o ON o.id = m."organizationId"
    WHERE m."userId" = ? AND m.status = 'active'
    ORDER BY lower(o.name), o.id
  `, identity.userId) as any[];
  return own.filter((r) => isTenantRole(r.tenantRole)).map((r) => ({
    organizationId: r.id as string, organizationName: r.name as string, slug: (r.slug || '') as string, logoUrl: (r.logo || null) as string | null,
    tenantRole: r.tenantRole, accessMode: 'membership' as const,
  }));
}
