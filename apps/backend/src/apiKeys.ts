/**
 * Organization API keys for the public API (/api/v1). A key belongs to one organization and carries explicit scopes
 * (`<resource>:read|write`), an optional expiry and its own rate limit. It is accepted only by routes whose policy kind is `apiKey`
 * (routePolicies.ts): every other route resolves a browser/session identity and answers 401 to a key.
 */
import crypto from 'node:crypto';
import type express from 'express';
import type { Sql } from './db';
import { RequestDenied, type Identity } from './identity';
import type { OrgContext } from './rbac';

export const API_RESOURCES = ['contracts', 'partners', 'orders', 'spendings'] as const;
/** Resources a key can only read (no write scope exists for them). */
export const API_READ_ONLY_RESOURCES = ['obligations', 'clauses', 'signatures'] as const;
export const API_SCOPES = [
  ...API_RESOURCES.flatMap((resource) => [`${resource}:read`, `${resource}:write`]),
  ...API_READ_ONLY_RESOURCES.map((resource) => `${resource}:read`),
];
export type ApiScope = (typeof API_SCOPES)[number];
export const MAX_ACTIVE_KEYS = 50;
export const KEY_PATTERN = /^lgk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/;

export const defaultRateLimit = (env: NodeJS.ProcessEnv = process.env) => {
  const value = Number(env.API_RATE_LIMIT_PER_MINUTE);
  return Number.isInteger(value) && value > 0 ? value : 600;
};

export const hashApiKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex');

export interface ApiKeyRecord {
  id: string; organizationId: string; name: string; prefix: string; scopes: string[]; rateLimitPerMinute: number;
  createdBy: string | null; createdAt: string; expiresAt: string | null; revokedAt: string | null; lastUsedAt: string | null;
}
const toRecord = (row: any): ApiKeyRecord => ({
  id: row.id, organizationId: row.organization_id, name: row.name, prefix: row.key_prefix, scopes: JSON.parse(row.scopes),
  rateLimitPerMinute: row.rate_limit_per_minute, createdBy: row.created_by, createdAt: row.created_at, expiresAt: row.expires_at,
  revokedAt: row.revoked_at, lastUsedAt: row.last_used_at,
});
export const keyStatus = (key: ApiKeyRecord, now = Date.now()): 'active' | 'revoked' | 'expired' =>
  key.revokedAt ? 'revoked' : key.expiresAt && new Date(key.expiresAt).getTime() <= now ? 'expired' : 'active';

export class ApiKeyInputError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'INVALID_INPUT') { super(message); }
}

export function parseCreateInput(body: unknown, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiKeyInputError('Request body must be an object.');
  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!['name', 'scopes', 'expiresAt', 'rateLimitPerMinute'].includes(key)) throw new ApiKeyInputError(`Unknown field: ${key}`);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 100) throw new ApiKeyInputError('name is required (at most 100 characters).');
  if (!Array.isArray(input.scopes) || !input.scopes.length) throw new ApiKeyInputError('Choose at least one scope.');
  const scopes = [...new Set(input.scopes.map(String))];
  const unknown = scopes.find((scope) => !API_SCOPES.includes(scope));
  if (unknown) throw new ApiKeyInputError(`Unknown scope: ${unknown}`);
  let expiresAt: string | null = null;
  if (input.expiresAt !== undefined && input.expiresAt !== null && input.expiresAt !== '') {
    const time = typeof input.expiresAt === 'string' ? Date.parse(input.expiresAt) : NaN;
    if (Number.isNaN(time)) throw new ApiKeyInputError('expiresAt must be a date.');
    if (time <= now) throw new ApiKeyInputError('expiresAt must be in the future.');
    if (time > now + 5 * 365 * 86_400_000) throw new ApiKeyInputError('expiresAt is more than five years away.');
    expiresAt = new Date(time).toISOString();
  }
  let rateLimitPerMinute = defaultRateLimit();
  if (input.rateLimitPerMinute !== undefined && input.rateLimitPerMinute !== null) {
    const limit = Number(input.rateLimitPerMinute);
    if (!Number.isInteger(limit) || limit < 1 || limit > 6000) throw new ApiKeyInputError('rateLimitPerMinute must be a whole number from 1 to 6000.');
    rateLimitPerMinute = limit;
  }
  return { name, scopes, expiresAt, rateLimitPerMinute };
}

/** Creates a key and returns it together with the secret, which exists nowhere else afterwards. */
export async function createApiKey(db: Sql, organizationId: string, createdBy: string | null, body: unknown) {
  const input = parseCreateInput(body);
  const id = `key_${crypto.randomUUID()}`;
  const prefix = `lgk_${crypto.randomBytes(4).toString('hex')}`;
  const secret = `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
  await db.tx(async () => {
    // Serializes the per-organization cap.
    await db.get(`SELECT pg_advisory_xact_lock(hashtext('api-keys:' || ?))`, organizationId);
    const active = await db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM api_keys WHERE organization_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`, organizationId, new Date().toISOString());
    if ((active?.n ?? 0) >= MAX_ACTIVE_KEYS) throw new ApiKeyInputError(`An organization can have at most ${MAX_ACTIVE_KEYS} active API keys.`, 409, 'API_KEY_LIMIT');
    await db.run(`INSERT INTO api_keys (id, organization_id, name, key_prefix, key_hash, scopes, rate_limit_per_minute, created_by, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, organizationId, input.name, prefix, hashApiKey(secret), JSON.stringify(input.scopes), input.rateLimitPerMinute, createdBy, new Date().toISOString(), input.expiresAt);
  });
  return { key: (await getApiKey(db, organizationId, id))!, secret };
}

export async function getApiKey(db: Sql, organizationId: string, id: string): Promise<ApiKeyRecord | null> {
  const row = await db.get(`SELECT * FROM api_keys WHERE organization_id = ? AND id = ?`, organizationId, id);
  return row ? toRecord(row) : null;
}
export async function listApiKeys(db: Sql, organizationId: string): Promise<ApiKeyRecord[]> {
  return (await db.all(`SELECT * FROM api_keys WHERE organization_id = ? ORDER BY created_at DESC, id`, organizationId)).map(toRecord);
}
/** Idempotent; false when the key does not exist in this organization. */
export async function revokeApiKey(db: Sql, organizationId: string, id: string, by: string | null): Promise<boolean> {
  if (!await getApiKey(db, organizationId, id)) return false;
  await db.run(`UPDATE api_keys SET revoked_at = ?, revoked_by = ? WHERE organization_id = ? AND id = ? AND revoked_at IS NULL`, new Date().toISOString(), by, organizationId, id);
  return true;
}

/* ------------------------------ rate limiting ------------------------------ */

/** Fixed one-minute window per key, in memory: with N instances a key can use up to N times its limit (like the other limiters). */
export function createWindowLimiter(windowMs = 60_000, now: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(id: string, limit: number) {
      const time = now();
      if (windows.size > 10_000) for (const [key, w] of windows) if (time - w.start >= windowMs) windows.delete(key);
      let w = windows.get(id);
      if (!w || time - w.start >= windowMs) windows.set(id, w = { start: time, count: 0 });
      const allowed = w.count < limit;
      if (allowed) w.count++;
      return { allowed, limit, remaining: Math.max(0, limit - w.count), resetAt: w.start + windowMs, retryAfterSeconds: Math.max(1, Math.ceil((w.start + windowMs - time) / 1000)) };
    },
    /** Hits recorded in the current window, without counting one. */
    count(id: string) {
      const w = windows.get(id);
      return w && now() - w.start < windowMs ? w.count : 0;
    },
  };
}
export const keyLimiter = createWindowLimiter();
/** Failed authentications per client address: a guessing client is slowed down before it costs database lookups. */
export const failureLimiter = createWindowLimiter();
const MAX_FAILURES_PER_MINUTE = 60;
const lastUsedWrites = new Map<string, number>();

/* ------------------------------ authentication ------------------------------ */

export interface ApiKeyPrincipal { key: ApiKeyRecord; identity: Identity; context: OrgContext }

const bearerOf = (req: express.Request): string => {
  const header = String(req.headers.authorization || '');
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : '';
};

/** The synthetic caller a key acts as: organization scope (the key's scopes are enforced per route), no platform rights. */
export function principalFor(key: ApiKeyRecord): ApiKeyPrincipal {
  const userId = `apikey:${key.id}`;
  const permissions = new Set<string>();
  for (const scope of key.scopes) {
    if (scope.endsWith(':read')) permissions.add('document.view');
    if (scope.endsWith(':write')) { permissions.add('document.create'); permissions.add('document.edit'); }
  }
  return {
    key,
    identity: {
      userId, email: `${key.prefix}@api-key.invalid`, name: `API key: ${key.name}`, image: null, emailVerified: true, platformRole: 'user', platformPermissions: [],
      sessionId: userId, sessionToken: '', sessionDefaultOrganizationId: key.organizationId, viaCookie: false,
      apiKey: { id: key.id, name: key.name, prefix: key.prefix, scopes: key.scopes },
    },
    context: {
      organizationId: key.organizationId, accessMode: 'membership', userId, platformRole: 'user', membershipId: null,
      // Organization-wide reach: a key is not tied to a department. What it may do is the scope list, checked per route.
      tenantRole: 'admin', departmentIds: [], permissions: [...permissions],
    },
  };
}

/**
 * Authenticates `Authorization: Bearer lgk_...` for a route that requires `scope` (null: any valid key). Throws RequestDenied with
 * 401 (missing/unknown/revoked/expired), 403 (scope missing) or 429 (rate limit). Sets the rate-limit headers on the response.
 */
export async function authenticateApiKey(db: Sql, req: express.Request, res: express.Response, scope: string | null, now = Date.now()): Promise<ApiKeyPrincipal> {
  const address = req.ip || 'unknown';
  const token = bearerOf(req);
  const fail = (status: number, code: string, message?: string): never => {
    if (status === 401) failureLimiter.hit(address, Number.MAX_SAFE_INTEGER);
    throw new RequestDenied(status, code, message);
  };
  if (!token) return fail(401, 'API_KEY_REQUIRED', 'Send the API key as "Authorization: Bearer <key>".');
  if (token.startsWith('ba_live_')) return fail(401, 'API_KEY_UNSUPPORTED', 'Platform console keys cannot call the API. Create an organization API key in Settings > Data & API.');
  if (!KEY_PATTERN.test(token)) return fail(401, 'API_KEY_INVALID', 'The API key is not valid.');
  if (failureLimiter.count(address) >= MAX_FAILURES_PER_MINUTE) {
    res.setHeader('Retry-After', '60');
    throw new RequestDenied(429, 'RATE_LIMITED', 'Too many invalid API keys from this address. Retry in a minute.');
  }
  const row = await db.get(`SELECT * FROM api_keys WHERE key_hash = ?`, hashApiKey(token));
  if (!row) return fail(401, 'API_KEY_INVALID', 'The API key is not valid.');
  const key = toRecord(row);
  const status = keyStatus(key, now);
  if (status === 'revoked') return fail(401, 'API_KEY_REVOKED', 'This API key has been revoked.');
  if (status === 'expired') return fail(401, 'API_KEY_EXPIRED', 'This API key has expired.');
  if (!await db.get(`SELECT 1 FROM organization WHERE id = ?`, key.organizationId)) return fail(401, 'API_KEY_INVALID', 'The API key is not valid.');
  if (scope && !key.scopes.includes(scope)) throw new RequestDenied(403, 'INSUFFICIENT_SCOPE', `This API key lacks the "${scope}" scope.`);
  const verdict = keyLimiter.hit(key.id, key.rateLimitPerMinute);
  res.setHeader('X-RateLimit-Limit', String(verdict.limit));
  res.setHeader('X-RateLimit-Remaining', String(verdict.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(verdict.resetAt / 1000)));
  if (!verdict.allowed) {
    res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
    throw new RequestDenied(429, 'RATE_LIMITED', 'The API key exceeded its rate limit. Retry after the time in Retry-After.');
  }
  // last_used_at is written at most once a minute per key and process.
  if (now - (lastUsedWrites.get(key.id) ?? 0) >= 60_000) {
    lastUsedWrites.set(key.id, now);
    await db.run(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`, new Date(now).toISOString(), key.id);
    key.lastUsedAt = new Date(now).toISOString();
  }
  return principalFor(key);
}
