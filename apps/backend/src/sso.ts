/**
 * Per-organization OIDC single sign-on: configuration, the login flow and the user-matching rules.
 *
 * Who may sign in through SSO (decided after the ID token has been verified, see oidc.ts):
 *  1. The e-mail must be `email_verified` at the provider and its domain must be one of the organization's allowed domains.
 *  2. A previously linked (issuer, subject) pair resolves to its user, who must still be an active member of the organization.
 *  3. Otherwise an existing local account is linked ONLY if it is already an active member of this organization. A local account that
 *     merely has the same e-mail is never taken over (it could have been registered by someone who does not control the mailbox).
 *  4. A brand-new e-mail becomes a new user only through a pending invitation to this organization, or, when the administrator enabled
 *     just-in-time provisioning, with the role and departments from the claim mapping (default role otherwise). Never `admin` by default.
 */
import crypto from 'node:crypto';
import type express from 'express';
import type { Sql } from './db';
import { isUniqueViolation } from './db';
import { open, seal } from './secretBox';
import { isIdentityBanned } from './identity';
import { TENANT_ROLES, TENANT_ROLE_RANK, isTenantRole, type TenantRole } from './rbac';
import { addMembershipRecord, createIdentityRecord } from './organizationProvisioning';
import { appendAudit, type AuditActor } from './organizationSettingsStore';
import { invitationDepartmentIds, invitationIsUsable, replaceAssignments } from './organizationAdminRoutes';
import {
  OidcError, buildAuthorizationUrl, discover, exchangeCode, isTrue, randomToken, sha256Hex, timingSafeEqual, verifyIdToken, checkEndpointUrl,
  type IdTokenClaims, type OidcDeps,
} from './oidc';
import { outboundPolicyFromEnv } from './ssrfGuard';
import { componentLog } from './logger';

const log = componentLog('sso');

export class SsoError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}

export const STATE_TTL_MS = 10 * 60_000;
const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
const SCOPE_RE = /^[A-Za-z0-9:._\-/]{1,100}$/;

/* ------------------------------ configuration ------------------------------ */

export interface RoleMappingEntry { value: string; role: TenantRole; departmentIds: string[] }
export interface SsoConfig {
  organizationId: string; enabled: boolean; issuerUrl: string; clientId: string; clientSecretSet: boolean; scopes: string; allowedDomains: string[];
  jitEnabled: boolean; defaultRole: TenantRole; defaultDepartmentIds: string[]; roleClaim: string; roleMapping: RoleMappingEntry[]; syncRoles: boolean;
  requireSso: boolean; breakGlassUserIds: string[]; version: number; updatedAt: string;
}

const parseJson = <T>(text: string, fallback: T): T => { try { return JSON.parse(text) as T; } catch { return fallback; } };

const toConfig = (row: any): SsoConfig => ({
  organizationId: row.organization_id, enabled: row.enabled, issuerUrl: row.issuer, clientId: row.client_id, clientSecretSet: Boolean(row.client_secret_sealed),
  scopes: row.scopes, allowedDomains: parseJson(row.allowed_domains, []), jitEnabled: row.jit_enabled, defaultRole: row.default_role,
  defaultDepartmentIds: parseJson(row.default_department_ids, []), roleClaim: row.role_claim, roleMapping: parseJson(row.role_mapping, []), syncRoles: row.sync_roles,
  requireSso: row.require_sso, breakGlassUserIds: parseJson(row.break_glass_user_ids, []), version: row.version, updatedAt: row.updated_at,
});

export async function getSsoConfig(db: Sql, organizationId: string): Promise<SsoConfig | null> {
  const row = await db.get(`SELECT * FROM sso_providers WHERE organization_id = ?`, organizationId);
  return row ? toConfig(row) : null;
}

/** The callback URL to register at the provider. The configured public URL wins; the request's own origin is the development fallback. */
export function redirectUriFor(req: express.Request, publicBaseUrl: string): string {
  const base = publicBaseUrl || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/+$/, '')}/api/sso/callback`;
}

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SsoError('INVALID_INPUT', 'The request body must be an object.');
  return value as Record<string, unknown>;
};
const asString = (value: unknown, label: string, max: number, required = false): string => {
  if (value === undefined || value === null || value === '') { if (required) throw new SsoError('INVALID_INPUT', `${label} is required.`); return ''; }
  if (typeof value !== 'string' || value.trim().length > max) throw new SsoError('INVALID_INPUT', `${label} must be text of at most ${max} characters.`);
  return value.trim();
};
const asBool = (value: unknown, fallback: boolean): boolean => (value === undefined ? fallback : value === true);
const asStringArray = (value: unknown, label: string, max: number): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== 'string')) throw new SsoError('INVALID_INPUT', `${label} must be a list of at most ${max} entries.`);
  return Array.from(new Set((value as string[]).map((item) => item.trim()).filter(Boolean)));
};

async function validDepartments(db: Sql, organizationId: string, ids: string[], label: string): Promise<string[]> {
  for (const id of ids) {
    if (!await db.get(`SELECT 1 FROM team WHERE id = ? AND "organizationId" = ?`, id, organizationId)) throw new SsoError('INVALID_INPUT', `${label}: unknown department.`);
  }
  return ids;
}

function checkRoleDepartments(role: TenantRole, departmentIds: string[], label: string) {
  if (role === 'admin' && departmentIds.length) throw new SsoError('INVALID_INPUT', `${label}: an administrator has no departments.`);
  if (role !== 'admin' && !departmentIds.length) throw new SsoError('INVALID_INPUT', `${label}: choose at least one department for this role.`);
}

export interface SaveOptions { actorUserId: string; deps?: OidcDeps }

/** Validates the whole configuration (including discovery when SSO is enabled) and stores it. The client secret is sealed and never read back. */
export async function saveSsoConfig(db: Sql, organizationId: string, body: unknown, options: SaveOptions): Promise<SsoConfig> {
  const input = asObject(body);
  const existing = await db.get<any>(`SELECT * FROM sso_providers WHERE organization_id = ?`, organizationId);
  const enabled = asBool(input.enabled, false);
  const issuer = asString(input.issuerUrl, 'Issuer URL', 500, true).replace(/\/+$/, '');
  const policy = options.deps?.policy ?? outboundPolicyFromEnv();
  try { checkEndpointUrl(issuer, 'Issuer URL', policy); } catch (err) { throw new SsoError('INVALID_INPUT', (err as Error).message); }
  const clientId = asString(input.clientId, 'Client ID', 300, true);
  const secretInput = asString(input.clientSecret, 'Client secret', 2000);
  if (!secretInput && !existing) throw new SsoError('INVALID_INPUT', 'The client secret is required.');
  const scopeList = asString(input.scopes ?? 'openid email profile', 'Scopes', 500).split(/\s+/).filter(Boolean);
  if (!scopeList.includes('openid')) scopeList.unshift('openid');
  if (scopeList.length > 12 || scopeList.some((scope) => !SCOPE_RE.test(scope))) throw new SsoError('INVALID_INPUT', 'Scopes must be up to 12 space-separated scope names.');
  const domains = asStringArray(input.allowedDomains, 'Allowed domains', 20).map((domain) => domain.toLowerCase().replace(/^@/, ''));
  for (const domain of domains) if (!DOMAIN_RE.test(domain)) throw new SsoError('INVALID_INPUT', `"${domain}" is not a valid e-mail domain.`);
  if (enabled && !domains.length) throw new SsoError('INVALID_INPUT', 'Enter at least one allowed e-mail domain before enabling SSO.');
  const jit = asBool(input.jitEnabled, false);
  const defaultRoleRaw = input.defaultRole === undefined ? 'viewer' : input.defaultRole;
  if (!isTenantRole(defaultRoleRaw)) throw new SsoError('INVALID_INPUT', `The default role must be one of ${TENANT_ROLES.join(', ')}.`);
  if (jit && defaultRoleRaw === 'admin') throw new SsoError('INVALID_INPUT', 'Just-in-time provisioning cannot create administrators by default; map a claim value to the admin role instead.');
  const defaultDepartments = await validDepartments(db, organizationId, asStringArray(input.defaultDepartmentIds, 'Default departments', 50), 'Default departments');
  if (jit) checkRoleDepartments(defaultRoleRaw, defaultDepartments, 'Default role');
  const roleClaim = asString(input.roleClaim, 'Role claim', 100);
  if (roleClaim && !/^[A-Za-z0-9:._\-/]+$/.test(roleClaim)) throw new SsoError('INVALID_INPUT', 'The role claim name contains invalid characters.');
  const mappingInput = input.roleMapping === undefined ? [] : input.roleMapping;
  if (!Array.isArray(mappingInput) || mappingInput.length > 50) throw new SsoError('INVALID_INPUT', 'The role mapping can have at most 50 entries.');
  const mapping: RoleMappingEntry[] = [];
  for (const [index, raw] of mappingInput.entries()) {
    const entry = asObject(raw);
    const value = asString(entry.value, `Mapping ${index + 1} claim value`, 200, true);
    if (!isTenantRole(entry.role)) throw new SsoError('INVALID_INPUT', `Mapping ${index + 1}: unknown role.`);
    const departmentIds = await validDepartments(db, organizationId, asStringArray(entry.departmentIds, `Mapping ${index + 1} departments`, 50), `Mapping ${index + 1}`);
    checkRoleDepartments(entry.role, departmentIds, `Mapping ${index + 1}`);
    mapping.push({ value, role: entry.role, departmentIds });
  }
  if (mapping.length && !roleClaim) throw new SsoError('INVALID_INPUT', 'Name the claim that carries the group or role values.');
  const syncRoles = asBool(input.syncRoles, false);
  const requireSso = asBool(input.requireSso, false);
  const breakGlass = asStringArray(input.breakGlassUserIds, 'Break-glass administrators', 5);
  for (const userId of breakGlass) {
    const member = await db.get<{ role: string; status: string }>(`SELECT role, status FROM member WHERE "userId" = ? AND "organizationId" = ?`, userId, organizationId);
    if (!member || member.role !== 'admin' || member.status !== 'active') throw new SsoError('INVALID_INPUT', 'Break-glass administrators must be active administrators of this organization.');
  }
  if (requireSso && !enabled) throw new SsoError('INVALID_INPUT', 'Enable SSO before requiring it.');
  if (requireSso && !breakGlass.length) throw new SsoError('INVALID_INPUT', 'Choose at least one break-glass administrator who can still sign in with a password.');
  if (input.expectedVersion !== undefined && existing && Number(input.expectedVersion) !== existing.version) throw new SsoError('VERSION_CONFLICT', 'The SSO settings changed meanwhile. Reload and try again.', 409);

  if (enabled) {
    try { await discover(issuer, options.deps ?? {}, { fresh: true }); } catch (err) {
      if (err instanceof OidcError) throw new SsoError(err.code, err.message, 422);
      throw err;
    }
  }
  const now = new Date().toISOString();
  const sealed = secretInput ? seal(secretInput) : existing.client_secret_sealed;
  await db.run(`
    INSERT INTO sso_providers (organization_id, enabled, issuer, client_id, client_secret_sealed, scopes, allowed_domains, jit_enabled, default_role, default_department_ids,
      role_claim, role_mapping, sync_roles, require_sso, break_glass_user_ids, version, created_at, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT (organization_id) DO UPDATE SET enabled = excluded.enabled, issuer = excluded.issuer, client_id = excluded.client_id,
      client_secret_sealed = excluded.client_secret_sealed, scopes = excluded.scopes, allowed_domains = excluded.allowed_domains, jit_enabled = excluded.jit_enabled,
      default_role = excluded.default_role, default_department_ids = excluded.default_department_ids, role_claim = excluded.role_claim, role_mapping = excluded.role_mapping,
      sync_roles = excluded.sync_roles, require_sso = excluded.require_sso, break_glass_user_ids = excluded.break_glass_user_ids,
      version = sso_providers.version + 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    organizationId, enabled, issuer, clientId, sealed, scopeList.join(' '), JSON.stringify(domains), jit, defaultRoleRaw, JSON.stringify(defaultDepartments),
    roleClaim, JSON.stringify(mapping), syncRoles, requireSso, JSON.stringify(breakGlass), now, now, options.actorUserId);
  return (await getSsoConfig(db, organizationId))!;
}

export async function deleteSsoConfig(db: Sql, organizationId: string): Promise<boolean> {
  const result = await db.run(`DELETE FROM sso_providers WHERE organization_id = ?`, organizationId);
  await db.run(`DELETE FROM sso_identities WHERE organization_id = ?`, organizationId);
  return result.changes > 0;
}

/** Runs discovery for the saved configuration so an administrator can check it without logging in. */
export async function testSsoConfig(db: Sql, organizationId: string, deps: OidcDeps = {}) {
  const config = await getSsoConfig(db, organizationId);
  if (!config) throw new SsoError('RESOURCE_NOT_FOUND', 'SSO is not configured.', 404);
  try {
    const doc = await discover(config.issuerUrl, deps, { fresh: true });
    return { ok: true, issuer: doc.issuer, authorizationEndpoint: doc.authorization_endpoint, tokenEndpoint: doc.token_endpoint, jwksUri: doc.jwks_uri, algorithms: doc.id_token_signing_alg_values_supported ?? [] };
  } catch (err) {
    if (err instanceof OidcError) return { ok: false, code: err.code, message: err.message };
    throw err;
  }
}

/* ------------------------------ public lookup ------------------------------ */

export interface SsoOrganizationHint { slug: string; name: string }

/**
 * What the sign-in page may learn: the organizations (at most five) with SSO enabled that match an e-mail domain or a slug. Unknown
 * organizations and organizations without SSO look identical (an empty list), so this does not reveal that an organization exists.
 */
export async function lookupSsoOrganizations(db: Sql, query: { email?: string; slug?: string }): Promise<SsoOrganizationHint[]> {
  if (query.slug) {
    const slug = query.slug.toLowerCase().slice(0, 80);
    const row = await db.get<SsoOrganizationHint>(`SELECT o.slug, o.name FROM organization o JOIN sso_providers p ON p.organization_id = o.id WHERE o.slug = ? AND p.enabled`, slug);
    return row ? [row] : [];
  }
  const email = (query.email || '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1 || email.length > 320) return [];
  const domain = email.slice(at + 1);
  if (!DOMAIN_RE.test(domain)) return [];
  const rows = await db.all<{ slug: string; name: string; allowed_domains: string }>(
    `SELECT o.slug, o.name, p.allowed_domains FROM organization o JOIN sso_providers p ON p.organization_id = o.id WHERE p.enabled AND p.allowed_domains LIKE ? ORDER BY lower(o.name) LIMIT 50`,
    `%"${domain}"%`);
  return rows.filter((row) => parseJson<string[]>(row.allowed_domains, []).includes(domain)).slice(0, 5).map((row) => ({ slug: row.slug, name: row.name }));
}

/* ------------------------------ login flow ------------------------------ */

/** Only same-site relative paths survive; anything else (absolute URLs, `//host`, `/\host`, control characters) falls back to the root. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || /[\u0000-\u001f\\]/.test(value)) return '/';
  return value;
}

export interface StartedLogin { location: string; bindingToken: string }

export async function startSsoLogin(db: Sql, input: { slug: string; redirectUri: string; returnTo?: unknown; loginHint?: unknown }, deps: OidcDeps = {}): Promise<StartedLogin> {
  const row = await db.get<any>(`SELECT p.*, o.id AS org_id FROM sso_providers p JOIN organization o ON o.id = p.organization_id WHERE o.slug = ? AND p.enabled`, String(input.slug).toLowerCase().slice(0, 80));
  if (!row) throw new SsoError('SSO_NOT_ENABLED', 'Single sign-on is not available for this organization.', 404);
  let doc;
  try { doc = await discover(row.issuer, deps); } catch (err) {
    if (err instanceof OidcError) { log.warn(`SSO discovery failed for ${row.org_id}: ${err.code}`); throw new SsoError(err.code, 'The identity provider is not reachable right now.', 502); }
    throw err;
  }
  const state = randomToken(32);
  const nonce = randomToken(24);
  const codeVerifier = randomToken(48);
  const bindingToken = randomToken(32);
  const now = Date.now();
  await db.run(`DELETE FROM sso_login_states WHERE expires_at < ?`, new Date(now - 3600_000).toISOString());
  await db.run(`INSERT INTO sso_login_states (state_hash, organization_id, nonce, code_verifier_sealed, binding_hash, return_to, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    sha256Hex(state), row.org_id, nonce, seal(codeVerifier), sha256Hex(bindingToken), safeReturnTo(input.returnTo), new Date(now).toISOString(), new Date(now + STATE_TTL_MS).toISOString());
  const hint = typeof input.loginHint === 'string' && input.loginHint.length <= 320 && !/[\u0000-\u001f]/.test(input.loginHint) ? input.loginHint : undefined;
  return { location: buildAuthorizationUrl(doc, { clientId: row.client_id, redirectUri: input.redirectUri, scopes: row.scopes, state, nonce, codeVerifier, loginHint: hint }), bindingToken };
}

export interface CompletedLogin { userId: string; organizationId: string; returnTo: string; provisioned: boolean; linked: boolean }

export interface CallbackInput { code?: unknown; state?: unknown; error?: unknown; bindingToken?: unknown; redirectUri: string }

/** The failure that is shown to the person, with a stable code (the details stay in the log). */
export class SsoLoginDenied extends Error {
  constructor(readonly code: string, readonly organizationId: string | null = null, readonly userId: string | null = null) { super(code); }
}

export async function completeSsoLogin(db: Sql, input: CallbackInput, deps: OidcDeps = {}): Promise<CompletedLogin> {
  if (typeof input.state !== 'string' || input.state.length < 16 || input.state.length > 200 || typeof input.bindingToken !== 'string' || !input.bindingToken) throw new SsoLoginDenied('SSO_STATE_INVALID');
  const nowIso = new Date().toISOString();
  // Single use: the first callback with this state consumes it, whatever happens next.
  const state = await db.get<any>(`UPDATE sso_login_states SET consumed_at = ? WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ? RETURNING *`, nowIso, sha256Hex(input.state), nowIso);
  if (!state) throw new SsoLoginDenied('SSO_STATE_INVALID');
  if (!timingSafeEqual(state.binding_hash, sha256Hex(input.bindingToken))) throw new SsoLoginDenied('SSO_STATE_INVALID', state.organization_id);
  const organizationId: string = state.organization_id;
  if (typeof input.error === 'string' && input.error) throw new SsoLoginDenied('SSO_PROVIDER_ERROR', organizationId);
  if (typeof input.code !== 'string' || !input.code || input.code.length > 2000) throw new SsoLoginDenied('SSO_CODE_REJECTED', organizationId);
  const provider = await db.get<any>(`SELECT * FROM sso_providers WHERE organization_id = ? AND enabled`, organizationId);
  if (!provider) throw new SsoLoginDenied('SSO_NOT_ENABLED', organizationId);
  let claims: IdTokenClaims;
  try {
    const doc = await discover(provider.issuer, deps);
    const idToken = await exchangeCode(doc, { clientId: provider.client_id, clientSecret: open(provider.client_secret_sealed), code: input.code, redirectUri: input.redirectUri, codeVerifier: open(state.code_verifier_sealed) }, deps);
    claims = await verifyIdToken(idToken, { issuer: provider.issuer, clientId: provider.client_id, nonce: state.nonce, jwksUri: doc.jwks_uri, allowedAlgs: doc.id_token_signing_alg_values_supported }, deps);
  } catch (err) {
    if (err instanceof OidcError) { log.warn(`SSO login rejected for ${organizationId}: ${err.code} ${err.message}`); throw new SsoLoginDenied(err.code, organizationId); }
    throw err;
  }
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (!email || email.length > 320 || !email.includes('@')) throw new SsoLoginDenied('SSO_EMAIL_MISSING', organizationId);
  if (!isTrue(claims.email_verified)) throw new SsoLoginDenied('SSO_EMAIL_UNVERIFIED', organizationId);
  const domains = parseJson<string[]>(provider.allowed_domains, []);
  if (!domains.includes(email.slice(email.lastIndexOf('@') + 1))) throw new SsoLoginDenied('SSO_DOMAIN_NOT_ALLOWED', organizationId);
  const result = await db.tx(() => resolveUser(db, provider, claims, email));
  return { ...result, organizationId, returnTo: safeReturnTo(state.return_to) };
}

/** Role/department decision from the configured claim (highest ranked match wins), or null when nothing matched. */
export function mapRoleClaim(provider: { role_claim: string; role_mapping: string }, claims: Record<string, unknown>): { role: TenantRole; departmentIds: string[] } | null {
  if (!provider.role_claim) return null;
  const raw = claims[provider.role_claim];
  const values = (Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw]).filter((value): value is string => typeof value === 'string');
  if (!values.length) return null;
  const matches = parseJson<RoleMappingEntry[]>(provider.role_mapping, []).filter((entry) => values.includes(entry.value));
  if (!matches.length) return null;
  const best = Math.max(...matches.map((entry) => TENANT_ROLE_RANK[entry.role]));
  const top = matches.filter((entry) => TENANT_ROLE_RANK[entry.role] === best);
  return { role: top[0].role, departmentIds: Array.from(new Set(top.flatMap((entry) => entry.departmentIds))) };
}

async function existingDepartments(db: Sql, organizationId: string, ids: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const id of ids) if (await db.get(`SELECT 1 FROM team WHERE id = ? AND "organizationId" = ?`, id, organizationId)) found.push(id);
  return found;
}

async function resolveUser(db: Sql, provider: any, claims: IdTokenClaims, email: string): Promise<{ userId: string; provisioned: boolean; linked: boolean }> {
  const organizationId: string = provider.organization_id;
  const issuer: string = provider.issuer;
  const now = new Date().toISOString();
  const link = await db.get<{ id: string; user_id: string }>(`SELECT id, user_id FROM sso_identities WHERE organization_id = ? AND issuer = ? AND subject = ?`, organizationId, issuer, claims.sub);
  const loadUser = (where: string, value: string) => db.get<any>(`SELECT id, name, role, banned, "banReason", "banExpires" FROM "user" WHERE ${where}`, value);

  const activeMember = async (userId: string) => {
    const member = await db.get<{ id: string; role: string; status: string }>(`SELECT id, role, status FROM member WHERE "userId" = ? AND "organizationId" = ?`, userId, organizationId);
    return member && member.status === 'active' && isTenantRole(member.role) ? member : null;
  };
  const syncMembership = async (userId: string, member: { id: string; role: string }) => {
    if (!provider.sync_roles) return;
    const mapped = mapRoleClaim(provider, claims);
    if (!mapped) return;
    const departments = mapped.role === 'admin' ? [] : await existingDepartments(db, organizationId, mapped.departmentIds);
    if (mapped.role !== 'admin' && !departments.length) return;
    if (member.role === 'admin' && mapped.role !== 'admin') {
      const admins = await db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM member WHERE "organizationId" = ? AND role = 'admin' AND status = 'active'`, organizationId);
      if ((admins?.n ?? 0) <= 1) return; // never demote the last administrator
    }
    if (member.role !== mapped.role) await db.run(`UPDATE member SET role = ? WHERE id = ?`, mapped.role, member.id);
    await replaceAssignments(db, organizationId, userId, departments);
  };

  if (link) {
    const user = await loadUser('id = ?', link.user_id);
    if (!user) throw new SsoLoginDenied('SSO_NOT_PROVISIONED', organizationId);
    if (isIdentityBanned(user)) throw new SsoLoginDenied('SSO_ACCOUNT_DISABLED', organizationId, user.id);
    const member = await activeMember(user.id);
    if (!member) throw new SsoLoginDenied('SSO_NOT_MEMBER', organizationId, user.id);
    await db.run(`UPDATE sso_identities SET last_login_at = ?, email = ? WHERE id = ?`, now, email, link.id);
    await syncMembership(user.id, member);
    return { userId: user.id, provisioned: false, linked: false };
  }

  const local = await loadUser('LOWER(email) = ?', email);
  if (local) {
    if (isIdentityBanned(local)) throw new SsoLoginDenied('SSO_ACCOUNT_DISABLED', organizationId, local.id);
    const member = await activeMember(local.id);
    // Same address but not a member here: never auto-link (see the module comment).
    if (!member) throw new SsoLoginDenied('SSO_ACCOUNT_NOT_LINKED', organizationId, local.id);
    await insertLink(db, organizationId, issuer, claims.sub, local.id, email, now);
    await syncMembership(local.id, member);
    return { userId: local.id, provisioned: false, linked: true };
  }

  // No local account: invitation first, then just-in-time provisioning.
  let role: TenantRole | null = null;
  let departmentIds: string[] = [];
  let invitationId: string | null = null;
  for (const row of await db.all<any>(`SELECT * FROM invitation WHERE "organizationId" = ? AND LOWER(email) = ? AND status = 'pending' ORDER BY "expiresAt" DESC`, organizationId, email)) {
    if (await invitationIsUsable(db, row)) { invitationId = row.id; role = row.role as TenantRole; departmentIds = invitationDepartmentIds(row); break; }
  }
  if (!invitationId) {
    if (!provider.jit_enabled) throw new SsoLoginDenied('SSO_NOT_PROVISIONED', organizationId);
    const mapped = mapRoleClaim(provider, claims);
    role = mapped ? mapped.role : provider.default_role;
    departmentIds = await existingDepartments(db, organizationId, mapped ? mapped.departmentIds : parseJson<string[]>(provider.default_department_ids, []));
    if (!role || !isTenantRole(role)) throw new SsoLoginDenied('SSO_NOT_PROVISIONED', organizationId);
    if (role === 'admin') departmentIds = [];
    else if (!departmentIds.length) {
      departmentIds = await existingDepartments(db, organizationId, parseJson<string[]>(provider.default_department_ids, []));
      if (!departmentIds.length) throw new SsoLoginDenied('SSO_NOT_PROVISIONED', organizationId);
    }
  }
  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim().slice(0, 200) : email.split('@')[0];
  let userId: string;
  try {
    userId = await createIdentityRecord(db, { name, email, platformRole: 'user', emailVerified: true });
  } catch (err) {
    if (isUniqueViolation(err)) throw new SsoLoginDenied('SSO_ACCOUNT_NOT_LINKED', organizationId); // created concurrently by someone else
    throw err;
  }
  await db.run(`INSERT INTO account (id, "accountId", "providerId", "userId", "createdAt", "updatedAt") VALUES (?, ?, 'sso', ?, ?, ?)`, `acc_${crypto.randomUUID()}`, `${organizationId}:${claims.sub}`, userId, now, now);
  await addMembershipRecord(db, { userId, organizationId, tenantRole: role!, departmentIds });
  if (invitationId) await db.run(`UPDATE invitation SET status = 'accepted' WHERE id = ? AND status = 'pending'`, invitationId);
  await insertLink(db, organizationId, issuer, claims.sub, userId, email, now);
  return { userId, provisioned: true, linked: true };
}

async function insertLink(db: Sql, organizationId: string, issuer: string, subject: string, userId: string, email: string, now: string) {
  await db.run(`INSERT INTO sso_identities (id, organization_id, issuer, subject, user_id, email, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    `ssoid_${crypto.randomUUID()}`, organizationId, issuer, subject, userId, email, now, now);
}

export async function auditSso(db: Sql, requestId: string, organizationId: string | null, userId: string | null, action: string, outcome: 'success' | 'denied', detail?: string) {
  const actor: AuditActor = { actorId: userId || 'system:sso', actorPlatformRole: 'user', accessMode: userId ? 'self' : 'system', requestId };
  try {
    await appendAudit(db, actor, { organizationId, action, targetType: 'user', targetId: userId || detail || 'unknown', outcome, changedFields: detail ? [detail] : undefined });
  } catch (err) { log.warn('Could not write the SSO audit entry:', err); }
}
