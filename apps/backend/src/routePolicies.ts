/**
 * Declared policy for every /api operation (tenant-boundaries PRD §5.5).
 *
 * The session middleware is not a permission: each method+path needs an
 * entry here, and anything unlisted is denied. The table is also the source
 * of docs/rbac/tenant-boundaries-endpoint-inventory.md.
 *
 * Kinds:
 *   public    — no identity (login, health, public status, first-run setup, …)
 *   identity  — verified identity; the handler scopes to that identity
 *   router    — verified identity; the canonical router resolves path context
 *   platform  — platform permission (superuser only)
 *   tenant    — legacy route: verified organization context with ALL listed permissions
 *   orgParam  — legacy route whose `:id` path segment is the organization
 */
import type express from 'express';
import type Database from 'better-sqlite3';
import {
  RequestDenied, isSameOriginRequest, legacyActorOf, resolveIdentity, resolveLegacyContext,
  resolveOrganizationContext, sendError,
} from './identity';
import { can, type PlatformPermission } from './rbac';

export type RoutePolicy =
  | { kind: 'public'; note?: string }
  | { kind: 'identity'; note?: string }
  | { kind: 'router'; note?: string }
  | { kind: 'platform'; permission: PlatformPermission; note?: string }
  | { kind: 'tenant'; permissions: string[]; includeBody?: boolean; note?: string }
  | { kind: 'orgParam'; permissions: string[]; note?: string };

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | '*';
export type PolicyEntry = [Method, string, RoutePolicy];

const pub = (note?: string): RoutePolicy => ({ kind: 'public', note });
const self = (note?: string): RoutePolicy => ({ kind: 'identity', note });
const router = (note?: string): RoutePolicy => ({ kind: 'router', note });
const platform = (permission: PlatformPermission, note?: string): RoutePolicy => ({ kind: 'platform', permission, note });
const tenant = (permissions: string | string[], note?: string, includeBody = true): RoutePolicy =>
  ({ kind: 'tenant', permissions: Array.isArray(permissions) ? permissions : [permissions], note, includeBody });
const orgParam = (permissions: string | string[], note?: string): RoutePolicy =>
  ({ kind: 'orgParam', permissions: Array.isArray(permissions) ? permissions : [permissions], note });

export const ROUTE_POLICIES: PolicyEntry[] = [
  /* ---------------- public ---------------- */
  ['GET', '/api/health', pub()],
  ['GET', '/api/system/public-status', pub('first-run probe: app name + needsSetup only')],
  ['POST', '/api/system/setup', pub('atomic; only while no superuser exists')],
  ['GET', '/api/exchange-rates', pub('public reference data')],
  ['GET', '/api/exchange-rate-historical', pub('public reference data')],
  ['GET', '/api/branding', pub('public presentation fields only')],
  ['GET', '/api/system/ui-texts', pub('shared UI dictionary; no platform secrets')],
  ['GET', '/api/auth/google/client-id', pub('OAuth client id for the sign-in button')],
  ['GET', '/api/google-auth/client-id', pub('OAuth client id for the sign-in button')],
  ['POST', '/api/auth/google/sync-session', pub('Google sign-in: verified Google identity, onboarding rules')],
  ['POST', '/api/google-auth/sync-session', pub('Google sign-in: verified Google identity, onboarding rules')],
  ['GET', '/api/invitations/:token/preview', pub('token possession; minimal preview')],
  ['GET', '/api/auth-console/invitations/verify', pub('legacy adapter to invitation preview')],

  /* ---------------- identity-scoped ---------------- */
  ['GET', '/api/me', router()],
  ['POST', '/api/me/organization', router('explicit onboarding: approved creator becomes tenant admin')],
  ['POST', '/api/me/active-organization', router('session default only')],
  ['GET', '/api/me/sessions', router('own sessions only')],
  ['DELETE', '/api/me/sessions/:sessionId', router('own sessions only')],
  ['POST', '/api/invitations/:token/accept', router('approved identity; matching email or valid invite code')],
  ['POST', '/api/auth-console/invitations/accept', self('legacy adapter to invitation acceptance')],
  ['GET', '/api/user/my-role', self('identity adapter to /api/me')],
  ['GET', '/api/rbac/me', self('identity + optional selected-organization capabilities')],
  ['POST', '/api/rbac/check', self('server-resolved actor in selected organization')],
  ['GET', '/api/tenants', self('own memberships / platform directory; side-effect free')],
  ['POST', '/api/tenants/switch', self('adapter to session default selection')],
  ['GET', '/api/auth-console/organizations', self('accessible organization summaries')],
  ['GET', '/api/system/status', self('platform fields only for superuser')],
  ['GET', '/api/policy-packs', self('pack catalog (non-secret reference data)')],
  ['POST', '/api/user/log-activity', self('login/logout activity of the caller')],

  /* ---------------- canonical tenant API ---------------- */
  ['*', '/api/organizations/:organizationId/*', router('path organization + membership/platform context')],
  ['GET', '/api/platform/configuration', router('platform.configuration.read')],
  ['PATCH', '/api/platform/configuration', router('platform.configuration.update')],
  ['GET', '/api/platform/audit', router('platform.audit.read')],

  /* ---------------- platform ---------------- */
  ['GET', '/api/rbac/matrix', platform('platform.policy.read')],
  ['GET', '/api/rbac/roles', platform('platform.policy.read')],
  ['POST', '/api/tenants', platform('platform.organization.create')],
  ['PUT', '/api/tenants/:id', platform('platform.organization.update')],
  ['DELETE', '/api/tenants/:id', platform('platform.organization.delete')],
  ['POST', '/api/branding', platform('platform.configuration.update')],
  ['GET', '/api/google-integration', platform('platform.configuration.read')],
  ['POST', '/api/google-integration', platform('platform.configuration.update')],
  ['POST', '/api/google-integration/connect', platform('platform.configuration.update')],
  ['POST', '/api/auth/google/connect', platform('platform.configuration.update')],
  ['POST', '/api/google-integration/disconnect', platform('platform.configuration.update')],
  ['POST', '/api/auth/google/disconnect', platform('platform.configuration.update')],
  ['POST', '/api/auth/google/exchange-code', pub('OAuth code exchange for the caller only; nothing is stored')],
  ['POST', '/api/google-auth/exchange-code', pub('OAuth code exchange for the caller only; nothing is stored')],
  ['GET', '/api/auth/google/token', platform('platform.configuration.read', 'platform Google token')],
  ['GET', '/api/google-auth/token', platform('platform.configuration.read', 'platform Google token')],
  ['POST', '/api/auth/google/refresh-token', platform('platform.configuration.read')],
  ['POST', '/api/google-auth/refresh-token', platform('platform.configuration.read')],
  ['GET', '/api/mailer/templates', platform('platform.configuration.read')],
  ['PUT', '/api/mailer/templates/:id', platform('platform.configuration.update')],
  ['POST', '/api/smtp/test', platform('platform.configuration.update')],
  ['POST', '/api/ai/test-key', platform('platform.configuration.update')],
  ['POST', '/api/google-integration/auto-provision-master', platform('platform.configuration.update')],
  ['POST', '/api/tenants/auto-provision-folders', platform('platform.configuration.update')],
  ['POST', '/api/google-integration/provision-folders', platform('platform.configuration.update')],
  ['POST', '/api/partners/provision-folders', platform('platform.configuration.update')],
  ['GET', '/api/google-service-account/status', platform('platform.configuration.read')],
  ['GET', '/api/integrations/google/credentials', platform('platform.configuration.read')],
  ['PUT', '/api/integrations/google/credentials/:kind', platform('platform.configuration.update')],
  ['DELETE', '/api/integrations/google/credentials/:kind', platform('platform.configuration.update')],
  ['POST', '/api/admin/reset-database', platform('platform.application.reset', 'explicit confirmation retained')],
  ['POST', '/api/cron/trigger-check', platform('platform.database.optimize', 'all-organization system job')],
  ['GET', '/api/user/allowed-users', platform('platform.user.read', 'onboarding allowlist')],
  ['POST', '/api/user/allowed-users', platform('platform.user.create', 'onboarding allowlist')],
  ['PUT', '/api/user/allowed-users/:id', platform('platform.user.update', 'onboarding allowlist')],
  ['DELETE', '/api/user/allowed-users/:id', platform('platform.user.delete', 'onboarding allowlist')],
  ['POST', '/api/user/reset-password', platform('platform.user.password.reset')],
  ['GET', '/api/auth-console/overview', platform('platform.access')],
  ['GET', '/api/auth-console/users', platform('platform.user.read')],
  ['POST', '/api/auth-console/users', platform('platform.user.create')],
  ['PUT', '/api/auth-console/users/:id', platform('platform.user.update')],
  ['POST', '/api/auth-console/users/:id/reset-password', platform('platform.user.password.reset')],
  ['PUT', '/api/auth-console/users/:id/password', platform('platform.user.password.reset')],
  ['PUT', '/api/auth-console/users/:id/role', platform('platform.user.role.update')],
  ['POST', '/api/auth-console/users/:id/ban', platform('platform.user.ban')],
  ['DELETE', '/api/auth-console/users/:id', platform('platform.user.delete')],
  ['POST', '/api/auth-console/users/bulk-action', platform('platform.user.update', 'each action rechecks its own permission')],
  ['GET', '/api/auth-console/accounts', platform('platform.user.read')],
  ['GET', '/api/auth-console/sessions', platform('platform.session.read')],
  ['DELETE', '/api/auth-console/sessions/:id', platform('platform.session.revoke')],
  ['POST', '/api/auth-console/sessions/revoke-user', platform('platform.session.revoke')],
  ['POST', '/api/auth-console/sessions/revoke-all/:userId', platform('platform.session.revoke')],
  ['POST', '/api/auth-console/organizations', platform('platform.organization.create')],
  ['PUT', '/api/auth-console/organizations/:id', platform('platform.organization.update')],
  ['DELETE', '/api/auth-console/organizations/:id', platform('platform.organization.delete')],
  ['GET', '/api/auth-console/api-keys', platform('platform.apikey.read')],
  ['POST', '/api/auth-console/api-keys', platform('platform.apikey.create')],
  ['POST', '/api/auth-console/api-keys/:id/revoke', platform('platform.apikey.revoke')],
  ['DELETE', '/api/auth-console/api-keys/:id', platform('platform.apikey.delete')],
  ['GET', '/api/auth-console/rbac-matrix', platform('platform.policy.read')],
  ['GET', '/api/auth-console/backups', platform('platform.database.read')],
  ['POST', '/api/auth-console/backups', platform('platform.database.optimize')],
  ['GET', '/api/auth-console/backups/:id/download', platform('platform.database.read')],
  ['POST', '/api/auth-console/backups/restore-file', platform('platform.application.reset')],
  ['POST', '/api/auth-console/backups/:id/restore', platform('platform.application.reset')],
  ['GET', '/api/auth-console/sqlite/status', platform('platform.database.read')],
  ['GET', '/api/auth-console/sqlite/tables', platform('platform.database.read')],
  ['GET', '/api/auth-console/sqlite/table-data', platform('platform.database.read')],
  ['PATCH', '/api/auth-console/sqlite/table-data', platform('platform.database.update')],
  ['POST', '/api/auth-console/sqlite/optimize', platform('platform.database.optimize')],

  /* ---------------- legacy tenant operations ---------------- */
  ['GET', '/api/init-data', tenant('document.view')],
  ['GET', '/api/tenant-settings', tenant('workspace.view', 'runtime policy view')],
  ['PUT', '/api/tenant-settings', tenant('tenant.settings.update', 'adapter to settings service')],
  ['GET', '/api/departments', tenant('workspace.view', 'scoped department names for operational forms')],
  ['GET', '/api/activity-logs', tenant('tenant.audit.read', 'scoped operational activity')],
  ['GET', '/api/dashboard/news-ticker', tenant('document.view', 'requires newsTicker + aiAssistant modules')],
  ['POST', '/api/chat', tenant('document.view', 'AI over permitted records only')],
  ['POST', '/api/bulk-import', tenant('tenant.data.import')],
  ['POST', '/api/google-integration/sync', tenant('tenant.integration.update', 'SYNC_UNAVAILABLE')],
  ['POST', '/api/google-integration/sync-flush', tenant('tenant.integration.update', 'SYNC_UNAVAILABLE')],
  ['GET', '/api/google-integration/sync-status', tenant('tenant.integration.read')],
  ['POST', '/api/tenants/:id/setup-google', orgParam('tenant.integration.update')],
  ['POST', '/api/tenants/:id/sync-google', orgParam('tenant.integration.update', 'SYNC_UNAVAILABLE')],

  ['GET', '/api/search', tenant('document.view', 'search over permitted records only')],
  ['GET', '/api/partners', tenant('document.view')],
  ['POST', '/api/partners', tenant('document.create')],
  ['POST', '/api/partners/parse', tenant('document.create', 'AI extraction')],
  ['POST', '/api/partners/generate-dd-notes', tenant('document.edit', 'AI drafting')],
  ['PUT', '/api/partners/:id', tenant('document.edit')],
  ['DELETE', '/api/partners/:id', tenant('document.delete')],
  ['POST', '/api/partners/:id/upload-dd', tenant('document.edit')],
  ['DELETE', '/api/partners/:id/dd-file', tenant('document.edit')],
  ['GET', '/api/partner-evaluations', tenant('document.view')],
  ['POST', '/api/partner-evaluations', tenant('document.create')],
  ['PUT', '/api/partner-evaluations/:id', tenant('document.edit')],
  ['DELETE', '/api/partner-evaluations/:id', tenant('document.delete')],
  ['GET', '/api/partner-spendings', tenant('document.view')],
  ['POST', '/api/partner-spendings', tenant('document.create')],
  ['PUT', '/api/partner-spendings/:id', tenant('document.edit')],
  ['DELETE', '/api/partner-spendings/:id', tenant('document.delete')],
  ['POST', '/api/spendings/parse', tenant('document.create', 'AI extraction')],
  ['GET', '/api/contracts', tenant('document.view')],
  ['POST', '/api/contracts', tenant('document.create')],
  ['POST', '/api/contracts/parse', tenant('document.create', 'AI extraction')],
  ['PUT', '/api/contracts/:id', tenant('document.edit')],
  ['DELETE', '/api/contracts/:id', tenant('document.delete')],
  ['GET', '/api/contracts/:id/redline-analysis', tenant('document.view')],
  ['POST', '/api/contracts/:id/redline-analysis', tenant('document.edit', 'AI review')],
  ['POST', '/api/contracts/export-google-docs', tenant('export.document')],
  ['GET', '/api/ios', tenant('document.view')],
  ['POST', '/api/ios', tenant('document.create')],
  ['POST', '/api/ios/parse', tenant('document.create', 'AI extraction')],
  ['PUT', '/api/ios/:id', tenant('document.edit')],
  ['DELETE', '/api/ios/:id', tenant('document.delete')],
  ['GET', '/api/notification-logs', tenant('document.view')],
  ['POST', '/api/notification-logs/mark-read', tenant('document.create', 'unchanged from the previous method floor')],
  ['POST', '/api/notification-logs/delete', tenant('document.delete')],
  ['GET', '/api/templates', tenant('document.view')],
  ['POST', '/api/templates', tenant('document.create')],
  ['DELETE', '/api/templates/:id', tenant('document.delete')],
  ['POST', '/api/templates/ai-generate', tenant('document.create', 'additionally admin/manager/platform only')],
  ['GET', '/api/documents', tenant('document.view')],
  ['POST', '/api/documents', tenant('document.create')],
  ['GET', '/api/documents/:id', tenant('document.view')],
  ['PATCH', '/api/documents/:id', tenant('document.edit')],
  ['DELETE', '/api/documents/:id', tenant('document.delete')],
  ['GET', '/api/documents/:id/*', tenant('document.view')],
  ['POST', '/api/documents/:id/ai-redline', tenant('document.edit', 'AI review')],
  ['POST', '/api/documents/:id/*', tenant('document.edit')],
  ['PATCH', '/api/documents/:id/*', tenant('document.edit')],
  ['PUT', '/api/documents/:id/*', tenant('document.edit')],
  ['GET', '/api/metadata-fields', tenant('document.view')],
  ['POST', '/api/metadata-fields', tenant('tenant.settings.update')],
  ['DELETE', '/api/metadata-fields/:fieldId', tenant('tenant.settings.update')],
];

/* ------------------------------------------------------------------ */
/* Matching                                                             */
/* ------------------------------------------------------------------ */

interface Compiled { method: Method; regex: RegExp; keys: string[]; policy: RoutePolicy; pattern: string }

function compile(pattern: string): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      if (segment === '*') return '.+';
      if (segment.startsWith(':')) { keys.push(segment.slice(1)); return '([^/]+)'; }
      return segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${source}/?$`), keys };
}

const COMPILED: Compiled[] = ROUTE_POLICIES.map(([method, pattern, policy]) => ({ method, pattern, policy, ...compile(pattern) }));

export function findPolicy(method: string, path: string): { policy: RoutePolicy; params: Record<string, string>; pattern: string } | null {
  const m = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  for (const entry of COMPILED) {
    if (entry.method !== '*' && entry.method !== m) continue;
    const match = entry.regex.exec(path);
    if (!match) continue;
    const params: Record<string, string> = {};
    entry.keys.forEach((key, i) => {
      try { params[key] = decodeURIComponent(match[i + 1]); } catch { params[key] = ''; }
    });
    return { policy: entry.policy, params, pattern: entry.pattern };
  }
  return null;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Authorization floor for every /api request: declared policy, verified
 * identity, same-origin check for cookie mutations, then platform or
 * organization context with explicit permissions. Better Auth's own
 * /api/auth/* endpoints are filtered separately (betterAuthBoundary).
 */
export function createAuthorizationMiddleware(db: Database.Database, options: { blocked?: () => string | null } = {}) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.path.startsWith('/api/')) return next();
    if (req.method === 'OPTIONS') return res.status(204).end();
    const found = findPolicy(req.method, req.path);
    if (!found) return sendError(req, res, 404, 'RESOURCE_NOT_FOUND', 'Unknown or unclassified API route.');
    const { policy, params } = found;
    const blocked = options.blocked?.();
    if (blocked && !(policy.kind === 'public' && (req.path === '/api/health' || req.path === '/api/system/public-status'))) {
      return sendError(req, res, 503, blocked, 'The database must be migrated before this version can serve requests.');
    }
    if (policy.kind === 'public') return next();
    try {
      const identity = resolveIdentity(db, req);
      if (identity.viaCookie && !SAFE_METHODS.has(req.method) && !isSameOriginRequest(req)) {
        return sendError(req, res, 403, 'CSRF_REJECTED');
      }
      if (policy.kind === 'identity' || policy.kind === 'router') return next();
      if (policy.kind === 'platform') {
        if (!identity.platformPermissions.includes(policy.permission)) return sendError(req, res, 403, 'INSUFFICIENT_PERMISSION');
        return next();
      }
      let ctx;
      if (policy.kind === 'orgParam') {
        const headers = [req.headers['x-organization-id'], req.headers['x-tenant-id']].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
        if (headers.some((v) => v !== params.id)) throw new RequestDenied(400, 'ORGANIZATION_SELECTOR_CONFLICT');
        ctx = resolveOrganizationContext(db, identity, params.id);
      } else {
        ctx = resolveLegacyContext(db, identity, req, { includeBody: policy.includeBody });
      }
      if (!policy.permissions.every((p) => can(ctx, p))) return sendError(req, res, 403, 'INSUFFICIENT_PERMISSION');
      (req as any).orgContext = ctx;
      (req as any).actor = legacyActorOf(ctx);
      return next();
    } catch (err: any) {
      if (err instanceof RequestDenied) return sendError(req, res, err.status, err.error);
      return next(err);
    }
  };
}

/* ------------------------------------------------------------------ */
/* Better Auth boundary (§10.2)                                         */
/* ------------------------------------------------------------------ */

/**
 * Better Auth endpoints reachable over HTTP. Admin-plugin and
 * Organization-plugin routes are denied outright: tenant and platform
 * administration go through the canonical services above, which enforce
 * membership status, ownership and hierarchy that the plugin cannot.
 */
export const BETTER_AUTH_ALLOWED: Record<string, 'public' | 'self'> = {
  '/api/auth/sign-in/email': 'public',
  '/api/auth/sign-up/email': 'public',
  '/api/auth/sign-in/social': 'public',
  '/api/auth/get-session': 'public',
  '/api/auth/sign-out': 'public',
  '/api/auth/verify-email': 'public',
  '/api/auth/send-verification-email': 'public',
  '/api/auth/error': 'public',
  '/api/auth/ok': 'public',
  '/api/auth/change-password': 'self',
  '/api/auth/list-sessions': 'self',
  '/api/auth/revoke-session': 'self',
  '/api/auth/revoke-other-sessions': 'self',
  '/api/auth/update-user': 'self',
};

export function isBetterAuthPathAllowed(path: string): boolean {
  if (path.startsWith('/api/auth/callback/')) return true;
  return Object.prototype.hasOwnProperty.call(BETTER_AUTH_ALLOWED, path.replace(/\/$/, ''));
}
