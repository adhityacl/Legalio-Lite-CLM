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
 *   orgParam  — route whose `:id` (or `:organizationId`) path segment is the organization
 *   apiKey    — public API (/api/v1): `Authorization: Bearer <organization API key>` with the named scope; cookie sessions are not accepted
 */
import type express from 'express';
import type { Sql } from './db';
import { teamsOf } from './recordScope';
import { scopeCollectionsFor } from './repositories/scopeDirectory';
import {
  RequestDenied, isSameOriginRequest, legacyActorOf, resolveIdentity, resolveLegacyContext,
  resolveOrganizationContext, sendError,
} from './identity';
import { can, type PlatformPermission } from './rbac';
import { authenticateApiKey } from './apiKeys';

export type RoutePolicy =
  | { kind: 'public'; note?: string }
  | { kind: 'identity'; note?: string }
  | { kind: 'router'; note?: string }
  | { kind: 'platform'; permission: PlatformPermission; note?: string }
  | { kind: 'tenant'; permissions: string[]; includeBody?: boolean; note?: string }
  | { kind: 'orgParam'; permissions: string[]; note?: string }
  | { kind: 'apiKey'; scope: string | null; note?: string };

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | '*';
export type PolicyEntry = [Method, string, RoutePolicy];

const pub = (note?: string): RoutePolicy => ({ kind: 'public', note });
const self = (note?: string): RoutePolicy => ({ kind: 'identity', note });
const router = (note?: string): RoutePolicy => ({ kind: 'router', note });
const platform = (permission: PlatformPermission, note?: string): RoutePolicy => ({ kind: 'platform', permission, note });
const tenant = (permissions: string | string[], note?: string, includeBody = true): RoutePolicy =>
  ({ kind: 'tenant', permissions: Array.isArray(permissions) ? permissions : [permissions], note, includeBody });
const apiKey = (scope: string | null, note?: string): RoutePolicy => ({ kind: 'apiKey', scope, note });
const orgParam = (permissions: string | string[], note?: string): RoutePolicy =>
  ({ kind: 'orgParam', permissions: Array.isArray(permissions) ? permissions : [permissions], note });

export const ROUTE_POLICIES: PolicyEntry[] = [
  /* ---------------- public ---------------- */
  ['GET', '/api/health', pub()],
  ['GET', '/api/health/ready', pub('liveness plus PostgreSQL SELECT 1; Docker healthcheck')],
  ['GET', '/api/system/public-status', pub('first-run probe: app name + needsDatabase + needsSetup only')],
  ['POST', '/api/system/setup', pub('atomic; only while no superuser exists')],
  ['GET', '/api/exchange-rates', pub('public reference data')],
  ['GET', '/api/exchange-rate-historical', pub('public reference data')],
  ['GET', '/api/branding', pub('public presentation fields only')],
  ['GET', '/api/system/ui-texts', pub('shared UI dictionary; no platform secrets')],
  ['GET', '/api/sso/lookup', pub('sign-in page: organizations with SSO for an e-mail domain or slug; empty for unknown and non-SSO organizations alike')],
  ['GET', '/api/sso/callback', pub('OIDC redirect URI: single-use state, PKCE, nonce and a browser-binding cookie are all verified')],
  ['GET', '/api/sso/:slug/start', pub('starts the authorization-code flow for an organization that enabled SSO')],
  ['POST', '/api/signatures/webhook/:endpointId', pub('signed inbound delivery: HMAC-SHA256 over the raw body with the endpoint\'s sealed secret, 5-minute timestamp window, idempotency key')],
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

  /* ---------------- organization data, integrations and digests (the organization is the :organizationId path segment) ---------------- */
  ['POST', '/api/organizations/:organizationId/exports', orgParam('tenant.data.export', 'queues a tenant data export; audited')],
  ['GET', '/api/organizations/:organizationId/exports', orgParam('tenant.data.export')],
  ['GET', '/api/organizations/:organizationId/exports/:jobId', orgParam('tenant.data.export')],
  ['GET', '/api/organizations/:organizationId/exports/:jobId/download', orgParam('tenant.data.export', 'streams the finished ZIP until it expires; audited')],

  ['GET', '/api/organizations/:organizationId/api-keys', orgParam('tenant.apikey.manage', 'never returns secrets or hashes')],
  ['POST', '/api/organizations/:organizationId/api-keys', orgParam('tenant.apikey.manage', 'the secret is returned once, hashed at rest; audited')],
  ['POST', '/api/organizations/:organizationId/api-keys/:keyId/revoke', orgParam('tenant.apikey.manage', 'audited')],

  ['GET', '/api/organizations/:organizationId/webhooks', orgParam('tenant.webhook.manage', 'never returns secrets')],
  ['POST', '/api/organizations/:organizationId/webhooks', orgParam('tenant.webhook.manage', 'URL checked against SSRF rules; the signing secret is returned once; audited')],
  ['PATCH', '/api/organizations/:organizationId/webhooks/:id', orgParam('tenant.webhook.manage', 'audited')],
  ['DELETE', '/api/organizations/:organizationId/webhooks/:id', orgParam('tenant.webhook.manage', 'audited')],
  ['POST', '/api/organizations/:organizationId/webhooks/:id/rotate-secret', orgParam('tenant.webhook.manage', 'new secret returned once; audited')],
  ['POST', '/api/organizations/:organizationId/webhooks/:id/test', orgParam('tenant.webhook.manage', 'sends one signed test event now; audited')],
  ['GET', '/api/organizations/:organizationId/webhooks/:id/deliveries', orgParam('tenant.webhook.manage')],
  ['GET', '/api/organizations/:organizationId/webhooks/:id/deliveries/:deliveryId', orgParam('tenant.webhook.manage')],
  ['POST', '/api/organizations/:organizationId/webhooks/:id/deliveries/:deliveryId/retry', orgParam('tenant.webhook.manage', 'audited')],

  ['GET', '/api/organizations/:organizationId/sso', orgParam('tenant.sso.manage', 'never returns the client secret')],
  ['PUT', '/api/organizations/:organizationId/sso', orgParam('tenant.sso.manage', 'issuer checked against SSRF rules and discovered; secret sealed; audited')],
  ['POST', '/api/organizations/:organizationId/sso/test', orgParam('tenant.sso.manage', 'runs OIDC discovery for the saved issuer')],
  ['DELETE', '/api/organizations/:organizationId/sso', orgParam('tenant.sso.manage', 'removes the provider and its linked identities; audited')],

  ['GET', '/api/organizations/:organizationId/signature-endpoints', orgParam('tenant.signature.manage', 'never returns secrets')],
  ['POST', '/api/organizations/:organizationId/signature-endpoints', orgParam('tenant.signature.manage', 'the HMAC secret is returned once, sealed at rest; audited')],
  ['PATCH', '/api/organizations/:organizationId/signature-endpoints/:id', orgParam('tenant.signature.manage', 'audited')],
  ['DELETE', '/api/organizations/:organizationId/signature-endpoints/:id', orgParam('tenant.signature.manage', 'audited')],
  ['POST', '/api/organizations/:organizationId/signature-endpoints/:id/rotate-secret', orgParam('tenant.signature.manage', 'new secret returned once; audited')],

  ['GET', '/api/organizations/:organizationId/approval-settings', orgParam('tenant.settings.read')],
  ['PUT', '/api/organizations/:organizationId/approval-settings', orgParam('tenant.settings.update', 'SLA hours and escalation target; audited')],
  ['GET', '/api/organizations/:organizationId/my-notifications', orgParam('document.create', 'the caller\'s own in-app notifications only')],
  ['POST', '/api/organizations/:organizationId/my-notifications/read', orgParam('document.create', 'marks only the caller\'s own entries')],

  ['GET', '/api/organizations/:organizationId/digest/preferences', orgParam('document.view', 'the caller\'s own preference')],
  ['PUT', '/api/organizations/:organizationId/digest/preferences', orgParam('document.view', 'changes only the caller\'s own preference (opt-in or out of a read-only e-mail)')],
  ['GET', '/api/organizations/:organizationId/digest/preview', orgParam('document.view', 'built from what the caller may see')],
  ['GET', '/api/organizations/:organizationId/digest/defaults', orgParam('tenant.settings.read')],
  ['PUT', '/api/organizations/:organizationId/digest/defaults', orgParam('tenant.settings.update', 'audited')],
  ['GET', '/api/digest/unsubscribe', pub('signed token possession; turns off one member\'s digest')],
  ['POST', '/api/digest/unsubscribe', pub('RFC 8058 one-click; signed token possession')],

  /* ---------------- public API v1 (organization API keys) ---------------- */
  ['GET', '/api/v1/openapi.json', pub('API description; no data')],
  ['GET', '/api/v1/whoami', apiKey(null, 'any valid key; returns its own organization and scopes')],
  ['GET', '/api/v1/contracts', apiKey('contracts:read')],
  ['GET', '/api/v1/contracts/:id', apiKey('contracts:read')],
  ['POST', '/api/v1/contracts', apiKey('contracts:write')],
  ['PATCH', '/api/v1/contracts/:id', apiKey('contracts:write', 'version required')],
  ['GET', '/api/v1/partners', apiKey('partners:read')],
  ['GET', '/api/v1/partners/:id', apiKey('partners:read')],
  ['POST', '/api/v1/partners', apiKey('partners:write')],
  ['PATCH', '/api/v1/partners/:id', apiKey('partners:write', 'version required')],
  ['GET', '/api/v1/orders', apiKey('orders:read')],
  ['GET', '/api/v1/orders/:id', apiKey('orders:read')],
  ['POST', '/api/v1/orders', apiKey('orders:write')],
  ['PATCH', '/api/v1/orders/:id', apiKey('orders:write', 'version required')],
  ['GET', '/api/v1/spendings', apiKey('spendings:read')],
  ['GET', '/api/v1/spendings/:id', apiKey('spendings:read')],
  ['POST', '/api/v1/spendings', apiKey('spendings:write')],
  ['PATCH', '/api/v1/spendings/:id', apiKey('spendings:write', 'version required')],

  ['GET', '/api/v1/obligations', apiKey('obligations:read')],
  ['GET', '/api/v1/obligations/:id', apiKey('obligations:read')],
  ['GET', '/api/v1/clauses', apiKey('clauses:read')],
  ['GET', '/api/v1/clauses/:id', apiKey('clauses:read')],
  ['GET', '/api/v1/signatures', apiKey('signatures:read', 'signature requests with signers, status and timeline links; no files')],
  ['GET', '/api/v1/signatures/:id', apiKey('signatures:read', 'status, signers and the event timeline')],

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
  ['GET', '/api/platform-settings', platform('platform.configuration.read')],
  ['POST', '/api/platform-settings', platform('platform.configuration.update')],
  ['GET', '/api/mailer/templates', platform('platform.configuration.read')],
  ['PUT', '/api/mailer/templates/:id', platform('platform.configuration.update')],
  ['POST', '/api/smtp/test', platform('platform.configuration.update')],
  ['POST', '/api/ai/test-key', platform('platform.configuration.update')],
  ['GET', '/api/integrations/storage/cos', platform('platform.configuration.read')],
  ['PUT', '/api/integrations/storage/cos', platform('platform.configuration.update')],
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
  ['POST', '/api/auth-console/organizations/:id/reset', platform('platform.application.reset')],
  ['GET', '/api/auth-console/api-keys', platform('platform.apikey.read')],
  ['POST', '/api/auth-console/api-keys', platform('platform.apikey.create')],
  ['POST', '/api/auth-console/api-keys/:id/revoke', platform('platform.apikey.revoke')],
  ['DELETE', '/api/auth-console/api-keys/:id', platform('platform.apikey.delete')],
  ['GET', '/api/auth-console/rbac-matrix', platform('platform.policy.read')],

  /* ---------------- legacy tenant operations ---------------- */
  ['GET', '/api/init-data', tenant('document.view')],
  ['GET', '/api/tenant-settings', tenant('workspace.view', 'runtime policy view')],
  ['PUT', '/api/tenant-settings', tenant('tenant.settings.update', 'adapter to settings service')],
  ['GET', '/api/departments', tenant('workspace.view', 'scoped department names for operational forms')],
  ['GET', '/api/activity-logs', tenant('tenant.audit.read', 'scoped operational activity')],
  ['GET', '/api/dashboard/news-ticker', tenant('document.view', 'requires newsTicker + aiAssistant modules')],
  ['POST', '/api/chat', tenant('document.view', 'AI over permitted records only')],
  ['POST', '/api/bulk-import', tenant('tenant.data.import')],

  ['GET', '/api/search', tenant('document.view', 'search over permitted records only')],
  ['GET', '/api/aggregates/dashboard', tenant('document.view', 'SQL aggregates over permitted records only')],
  ['GET', '/api/aggregates/badges', tenant('document.view', 'SQL aggregates over permitted records only')],
  ['GET', '/api/aggregates/facets', tenant('document.view', 'distinct filter values of permitted records only')],
  ['GET', '/api/aggregates/partners', tenant('document.view', 'per-partner roll-ups of permitted records only')],
  ['GET', '/api/partners', tenant('document.view')],
  ['POST', '/api/partners', tenant('document.create')],
  ['POST', '/api/partners/parse', tenant('document.create', 'AI extraction')],
  ['POST', '/api/partners/review-analysis', tenant('document.create', 'AI review')],
  ['POST', '/api/partners/generate-dd-notes', tenant('document.edit', 'AI drafting')],
  ['PUT', '/api/partners/:id', tenant('document.edit')],
  ['DELETE', '/api/partners/:id', tenant('document.delete')],
  ['POST', '/api/partners/:id/upload-dd', tenant('document.edit')],
  ['DELETE', '/api/partners/:id/dd-file', tenant('document.edit')],
  ['GET', '/api/partner-evaluations', tenant('document.view')],
  ['POST', '/api/partner-evaluations', tenant('document.create')],
  ['POST', '/api/partner-evaluations/review-analysis', tenant('document.create', 'AI review')],
  ['PUT', '/api/partner-evaluations/:id', tenant('document.edit')],
  ['DELETE', '/api/partner-evaluations/:id', tenant('document.delete')],
  ['GET', '/api/partner-spendings', tenant('document.view')],
  ['POST', '/api/partner-spendings', tenant('document.create')],
  ['PUT', '/api/partner-spendings/:id', tenant('document.edit')],
  ['DELETE', '/api/partner-spendings/:id', tenant('document.delete')],
  ['POST', '/api/spendings/parse', tenant('document.create', 'AI extraction')],
  ['POST', '/api/spendings/review-analysis', tenant('document.create', 'AI review')],
  ['GET', '/api/contracts', tenant('document.view')],
  ['POST', '/api/contracts', tenant('document.create')],
  ['POST', '/api/contracts/parse', tenant('document.create', 'AI extraction')],
  ['PUT', '/api/contracts/:id', tenant('document.edit')],
  ['DELETE', '/api/contracts/:id', tenant('document.delete')],
  ['POST', '/api/contracts/redline-analysis', tenant('document.create', 'AI review')],
  ['GET', '/api/contracts/:id/redline-analysis', tenant('document.view')],
  ['POST', '/api/contracts/:id/redline-analysis', tenant('document.edit', 'AI review')],
  ['GET', '/api/ios', tenant('document.view')],
  ['POST', '/api/ios', tenant('document.create')],
  ['POST', '/api/ios/parse', tenant('document.create', 'AI extraction')],
  ['POST', '/api/ios/review-analysis', tenant('document.create', 'AI review')],
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
  ['GET', '/api/approvals', tenant('document.create')],
  ['POST', '/api/approvals', tenant('document.create')],
  ['GET', '/api/approvals/:id', tenant('document.create', 'requester, chain approver or tenant.audit.read; checked in approvalRoutes')],
  ['GET', '/api/approvals/:id/file', tenant('document.create', 'same visibility as the detail')],
  ['DELETE', '/api/approvals/:id', tenant('document.create', 'requester only; checked in approvalRoutes')],
  ['POST', '/api/approvals/:id/decision', tenant('document.create', 'only the current step approver; checked in approvalRoutes')],
  ['GET', '/api/obligations', tenant('document.view', 'obligations of permitted records only')],
  ['GET', '/api/obligations/summary', tenant('document.view', 'SQL aggregate over permitted obligations only')],
  ['GET', '/api/obligations/settings', tenant('document.view', 'reminder lead time of the organization')],
  ['PUT', '/api/obligations/settings', tenant('tenant.settings.update', 'audited')],
  ['GET', '/api/obligations/assignees', tenant('document.edit', 'active members who can be made responsible')],
  ['GET', '/api/obligations/:id', tenant('document.view')],
  ['POST', '/api/obligations', tenant('document.edit')],
  ['PUT', '/api/obligations/:id', tenant('document.edit', 'version checked')],
  ['POST', '/api/obligations/:id/complete', tenant('document.edit', 'rolls recurring obligations forward')],
  ['DELETE', '/api/obligations/:id', tenant('document.delete')],
  ['POST', '/api/contracts/:id/extract', tenant('document.edit', 'AI extraction; only queues suggestions for review')],
  ['GET', '/api/contracts/:id/key-terms', tenant('document.view', 'key clauses accepted from AI suggestions, with provenance')],
  ['DELETE', '/api/contracts/:id/key-terms/:termKey', tenant('document.edit')],
  ['GET', '/api/suggestions', tenant('document.edit', 'review queue of the contracts the caller may see')],
  ['GET', '/api/suggestions/summary', tenant('document.edit', 'pending counts of the contracts the caller may see')],
  ['POST', '/api/suggestions/:id/accept', tenant('document.edit', 'a person confirms: creates the obligation / key term with provenance; audited')],
  ['POST', '/api/suggestions/:id/reject', tenant('document.edit', 'audited')],
  ['GET', '/api/clauses', tenant('document.view', 'clause library of the organization')],
  ['GET', '/api/clauses/facets', tenant('document.view')],
  ['GET', '/api/clauses/starter', tenant('document.view', 'starter set with what the organization already imported')],
  ['POST', '/api/clauses/starter/import', tenant('tenant.settings.update', 'explicit per-organization opt-in; never overwrites existing clauses; audited')],
  ['GET', '/api/clauses/:id', tenant('document.view')],
  ['POST', '/api/clauses', tenant('document.edit', 'audited')],
  ['PUT', '/api/clauses/:id', tenant('document.edit', 'version checked; audited')],
  ['DELETE', '/api/clauses/:id', tenant('document.delete', 'audited')],
  ['POST', '/api/playbook/check', tenant('document.view', 'read-only advisory check; the optional AI step uses the organization AI budget')],
  ['GET', '/api/signatures/providers', tenant('document.view')],
  ['GET', '/api/signatures', tenant('document.view', 'signature requests of the contracts the caller may see')],
  ['POST', '/api/signatures', tenant('document.edit', 'a request on a contract the caller may change')],
  ['GET', '/api/signatures/:id', tenant('document.view', 'contract visibility checked')],
  ['POST', '/api/signatures/:id/send', tenant('document.edit', 'contract writability checked')],
  ['POST', '/api/signatures/:id/resend', tenant('document.edit')],
  ['POST', '/api/signatures/:id/cancel', tenant('document.edit')],
  ['POST', '/api/signatures/:id/signers/:signerId/signed', tenant('document.edit', 'manual progress; sequence enforced')],
  ['POST', '/api/signatures/:id/signers/:signerId/declined', tenant('document.edit')],
  ['POST', '/api/signatures/:id/complete', tenant('document.edit', 'signed copy required; completion updates the contract')],
  ['POST', '/api/signatures/:id/files', tenant('document.edit', 'evidence or a late signed copy; magic bytes and size validated')],
  ['GET', '/api/signatures/:id/files/:fileId', tenant('document.view', 'contract visibility checked; served as an attachment')],
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
 * It also loads the organization's departments once (`req.teams`) so record scoping stays synchronous.
 */
export function createAuthorizationMiddleware(db: Sql) {
  const run = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.path.startsWith('/api/')) return next();
    if (req.method === 'OPTIONS') return res.status(204).end();
    const found = findPolicy(req.method, req.path);
    if (!found) return sendError(req, res, 404, 'RESOURCE_NOT_FOUND', 'Unknown or unclassified API route.');
    const { policy, params } = found;
    if (policy.kind === 'public') return next();
    if (policy.kind === 'apiKey') {
      // An organization API key, never a session: the key's own organization and scopes are the whole context.
      try {
        const principal = await authenticateApiKey(db, req, res, policy.scope);
        (req as any).identity = principal.identity;
        (req as any).orgContext = principal.context;
        (req as any).actor = legacyActorOf(principal.context);
        (req as any).teams = [];
        return next();
      } catch (err: any) {
        if (err instanceof RequestDenied) return sendError(req, res, err.status, err.error, err.message);
        return next(err);
      }
    }
    try {
      const identity = await resolveIdentity(db, req);
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
        // `/api/organizations/:organizationId/...` names the organization `organizationId` (other path ids belong to the resource); the older `/api/tenants/:id/...` routes use `id`.
        const organizationId = params.organizationId ?? params.id;
        const headers = [req.headers['x-organization-id'], req.headers['x-tenant-id']].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
        if (headers.some((v) => v !== organizationId)) throw new RequestDenied(400, 'ORGANIZATION_SELECTOR_CONFLICT');
        ctx = await resolveOrganizationContext(db, identity, organizationId);
      } else {
        ctx = await resolveLegacyContext(db, identity, req, { includeBody: policy.includeBody });
      }
      if (!policy.permissions.every((p) => can(ctx, p))) return sendError(req, res, 403, 'INSUFFICIENT_PERMISSION');
      (req as any).teams = await teamsOf(db, ctx.organizationId);
      (req as any).scopeCollections = await scopeCollectionsFor(db, ctx);
      (req as any).orgContext = ctx;
      (req as any).actor = legacyActorOf(ctx);
      return next();
    } catch (err: any) {
      if (err instanceof RequestDenied) return sendError(req, res, err.status, err.error);
      return next(err);
    }
  };
  return (req: express.Request, res: express.Response, next: express.NextFunction) => { run(req, res, next).catch(next); };
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
