/**
 * Outbound webhooks (Phase 3 / item 3).
 *
 * Events are written to `webhook_deliveries` (one row per subscribed endpoint) and delivered by an advisory-locked pass with the same
 * ledger pattern as the reminders: claim by bumping `attempts`, 2xx = sent, otherwise retry with exponential backoff and finally
 * dead-letter. Every request is signed (HMAC-SHA256 over `<timestamp>.<body>` with the endpoint's secret, which is sealed at rest and
 * shown once) and goes through the SSRF guard (ssrfGuard.ts).
 */
import crypto from 'node:crypto';
import type { Sql } from './db';
import { componentLog } from './logger';
import { open, seal } from './secretBox';
import { outboundPolicyFromEnv, outboundRequest, parseOutboundUrl, resolvePublicAddresses, SsrfError, type OutboundOptions, type OutboundPolicy, type OutboundResult } from './ssrfGuard';

const log = componentLog('webhooks');

export const WEBHOOK_LOCK_KEY = 0x4c475748; // "LGWH"
export const API_VERSION = '2026-10-01';
/** Subscribable events. The `signature.*` events are raised by the e-signature requests (signatures.ts). */
export const WEBHOOK_EVENTS = [
  'contract.created', 'contract.updated', 'contract.status_changed', 'contract.terminated',
  'reminder.sent', 'approval.requested', 'approval.decided', 'document.exported', 'signature.sent', 'signature.completed', 'signature.declined', 'signature.expired',
  'obligation.created', 'obligation.due_soon', 'obligation.overdue', 'obligation.completed',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];
export const MAX_ENDPOINTS_PER_ORGANIZATION = 20;
export const MAX_PAYLOAD_BYTES = 256 * 1024;
export const MAX_ATTEMPTS = Math.max(1, Number(process.env.WEBHOOK_MAX_ATTEMPTS) || 8);
export const DISABLE_AFTER_DEAD = 20;
/** 30 s, 1 min, 2 min ... capped at 6 h. */
export const webhookBackoffMs = (attempts: number) => Math.min(6 * 3600_000, 30_000 * 2 ** Math.max(0, attempts - 1));

export class WebhookInputError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'INVALID_INPUT') { super(message); }
}

/* ------------------------------ signing ------------------------------ */

export const newWebhookSecret = () => `whsec_${crypto.randomBytes(32).toString('base64url')}`;
export const signPayload = (secret: string, timestamp: number, body: string) => crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
export const signatureHeader = (secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) => `t=${timestamp},v1=${signPayload(secret, timestamp, body)}`;

/** What a receiver does: recompute, compare in constant time, reject old timestamps. Exported for tests and the docs. */
export function verifySignature(secret: string, header: string, body: string, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const parts = Object.fromEntries(header.split(',').map((part) => part.trim().split('=') as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds || !parts.v1) return false;
  const expected = Buffer.from(signPayload(secret, timestamp, body), 'hex');
  const given = Buffer.from(parts.v1, 'hex');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/* ------------------------------ endpoints ------------------------------ */

export interface WebhookEndpoint {
  id: string; organizationId: string; url: string; description: string; eventTypes: string[]; enabled: boolean; disabledReason: string | null;
  consecutiveFailures: number; createdBy: string | null; createdAt: string; updatedAt: string;
}
const toEndpoint = (row: any): WebhookEndpoint => ({
  id: row.id, organizationId: row.organization_id, url: row.url, description: row.description, eventTypes: JSON.parse(row.event_types), enabled: row.enabled,
  disabledReason: row.disabled_reason, consecutiveFailures: row.consecutive_failures, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
});

const parseEventTypes = (value: unknown): string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new WebhookInputError('eventTypes must be a list.');
  const types = [...new Set(value.map(String))];
  const unknown = types.find((type) => !(WEBHOOK_EVENTS as readonly string[]).includes(type));
  if (unknown) throw new WebhookInputError(`Unknown event type: ${unknown}`);
  return types;
};
const validateUrl = (value: unknown, policy: OutboundPolicy): string => {
  try { return parseOutboundUrl(value, policy).toString(); } catch (err) {
    if (err instanceof SsrfError) throw new WebhookInputError(err.message, 400, `WEBHOOK_${err.code}`);
    throw err;
  }
};
const parseDescription = (value: unknown) => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > 300) throw new WebhookInputError('description must be text of at most 300 characters.');
  return value.trim();
};
const onlyKeys = (body: unknown, allowed: string[]): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new WebhookInputError('Request body must be an object.');
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw new WebhookInputError(`Unknown field: ${key}`);
  return body as Record<string, unknown>;
};

export async function createEndpoint(db: Sql, organizationId: string, createdBy: string | null, body: unknown, policy = outboundPolicyFromEnv()) {
  const input = onlyKeys(body, ['url', 'description', 'eventTypes', 'enabled']);
  const url = validateUrl(input.url, policy);
  const eventTypes = parseEventTypes(input.eventTypes);
  const description = parseDescription(input.description);
  const secret = newWebhookSecret();
  const id = `whk_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.tx(async () => {
    await db.get(`SELECT pg_advisory_xact_lock(hashtext('webhooks:' || ?))`, organizationId);
    const { n } = await db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM webhook_endpoints WHERE organization_id = ?`, organizationId) as { n: number };
    if (n >= MAX_ENDPOINTS_PER_ORGANIZATION) throw new WebhookInputError(`An organization can have at most ${MAX_ENDPOINTS_PER_ORGANIZATION} webhook endpoints.`, 409, 'WEBHOOK_LIMIT');
    await db.run(`INSERT INTO webhook_endpoints (id, organization_id, url, description, secret_sealed, event_types, enabled, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, organizationId, url, description, seal(secret), JSON.stringify(eventTypes), input.enabled === false ? false : true, createdBy, now, now);
  });
  return { endpoint: (await getEndpoint(db, organizationId, id))!, secret };
}

export async function getEndpoint(db: Sql, organizationId: string, id: string): Promise<WebhookEndpoint | null> {
  const row = await db.get(`SELECT * FROM webhook_endpoints WHERE organization_id = ? AND id = ?`, organizationId, id);
  return row ? toEndpoint(row) : null;
}
export async function listEndpoints(db: Sql, organizationId: string): Promise<WebhookEndpoint[]> {
  return (await db.all(`SELECT * FROM webhook_endpoints WHERE organization_id = ? ORDER BY created_at, id`, organizationId)).map(toEndpoint);
}

export async function updateEndpoint(db: Sql, organizationId: string, id: string, body: unknown, policy = outboundPolicyFromEnv()): Promise<WebhookEndpoint | null> {
  const input = onlyKeys(body, ['url', 'description', 'eventTypes', 'enabled']);
  const current = await getEndpoint(db, organizationId, id);
  if (!current) return null;
  const next = {
    url: input.url !== undefined ? validateUrl(input.url, policy) : current.url,
    description: input.description !== undefined ? parseDescription(input.description) : current.description,
    eventTypes: input.eventTypes !== undefined ? parseEventTypes(input.eventTypes) : current.eventTypes,
    enabled: input.enabled !== undefined ? input.enabled === true : current.enabled,
  };
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new WebhookInputError('enabled must be true or false.');
  // Re-enabling clears the automatic-disable bookkeeping.
  const reenabled = next.enabled && !current.enabled;
  await db.run(`UPDATE webhook_endpoints SET url = ?, description = ?, event_types = ?, enabled = ?, disabled_reason = ?, consecutive_failures = ?, updated_at = ? WHERE organization_id = ? AND id = ?`,
    next.url, next.description, JSON.stringify(next.eventTypes), next.enabled, next.enabled ? null : current.disabledReason ?? 'disabled_by_admin', reenabled ? 0 : current.consecutiveFailures, new Date().toISOString(), organizationId, id);
  return getEndpoint(db, organizationId, id);
}

export async function deleteEndpoint(db: Sql, organizationId: string, id: string): Promise<boolean> {
  return (await db.run(`DELETE FROM webhook_endpoints WHERE organization_id = ? AND id = ?`, organizationId, id)).changes > 0;
}

export async function rotateSecret(db: Sql, organizationId: string, id: string): Promise<string | null> {
  const secret = newWebhookSecret();
  const result = await db.run(`UPDATE webhook_endpoints SET secret_sealed = ?, updated_at = ? WHERE organization_id = ? AND id = ?`, seal(secret), new Date().toISOString(), organizationId, id);
  return result.changes ? secret : null;
}

/* ------------------------------ events ------------------------------ */

let queuedListener: (() => void) | null = null;
/** The background worker registers here so a new event is delivered within moments instead of at the next tick. */
export const onWebhookQueued = (listener: (() => void) | null) => { queuedListener = listener; };

export interface EmittedEvent { id: string; type: string; apiVersion: string; created: string; organizationId: string; data: unknown }

/**
 * Queues `type` for every enabled endpoint of the organization that subscribes to it. Never throws into the caller's business flow:
 * an error is logged and the operation that raised the event continues. Inside a transaction the rows commit (or not) with it.
 */
export async function emitWebhookEvent(db: Sql, organizationId: string | null | undefined, type: WebhookEventType, data: unknown): Promise<number> {
  if (!organizationId) return 0;
  try {
    const endpoints = (await db.all(`SELECT id, event_types FROM webhook_endpoints WHERE organization_id = ? AND enabled`, organizationId))
      .filter((row: any) => { const types: string[] = JSON.parse(row.event_types); return types.length === 0 || types.includes(type); });
    if (!endpoints.length) return 0;
    const event: EmittedEvent = { id: `evt_${crypto.randomUUID()}`, type, apiVersion: API_VERSION, created: new Date().toISOString(), organizationId, data };
    const payload = JSON.stringify(event);
    if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) { log.warn(`Webhook event ${type} is larger than ${MAX_PAYLOAD_BYTES} bytes and was not queued.`); return 0; }
    const now = event.created;
    let queued = 0;
    for (const endpoint of endpoints) {
      const result = await db.run(`INSERT INTO webhook_deliveries (id, organization_id, endpoint_id, event_id, event_type, payload, status, attempts, next_attempt_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?) ON CONFLICT (endpoint_id, event_id) DO NOTHING`, `whd_${crypto.randomUUID()}`, organizationId, endpoint.id, event.id, type, payload, now, now, now);
      queued += result.changes;
    }
    if (queued) setImmediate(() => queuedListener?.());
    return queued;
  } catch (err) {
    log.error(`Could not queue webhook event ${type}:`, err);
    return 0;
  }
}

/* ------------------------------ delivery ------------------------------ */

export interface WebhookDeps {
  policy?: OutboundPolicy;
  /** Tests inject; defaults to the SSRF-guarded pinned request. */
  request?: (url: string, options: OutboundOptions) => Promise<OutboundResult>;
  lookup?: OutboundOptions['lookup'];
  timeoutMs?: number;
  now?: () => Date;
  maxAttempts?: number;
}
const timeoutMs = (deps: WebhookDeps) => deps.timeoutMs ?? (Number(process.env.WEBHOOK_TIMEOUT_MS) || 10_000);

interface SendOutcome { ok: boolean; statusCode: number | null; error: string | null; snippet: string | null; durationMs: number | null }

async function sendOnce(endpointUrl: string, secret: string, delivery: { id: string; event_id: string; event_type: string; payload: string }, deps: WebhookDeps): Promise<SendOutcome> {
  const started = Date.now();
  try {
    const timestamp = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
    const result = await (deps.request ?? outboundRequest)(endpointUrl, {
      method: 'POST', body: delivery.payload, timeoutMs: timeoutMs(deps), maxResponseBytes: 16 * 1024, policy: deps.policy, lookup: deps.lookup,
      headers: {
        'content-type': 'application/json', 'user-agent': 'Legalio-Webhooks/1', accept: '*/*',
        'legalio-signature': signatureHeader(secret, delivery.payload, timestamp), 'legalio-event-id': delivery.event_id, 'legalio-event-type': delivery.event_type, 'legalio-delivery-id': delivery.id,
      },
    });
    const ok = result.statusCode >= 200 && result.statusCode < 300;
    const redirect = result.statusCode >= 300 && result.statusCode < 400;
    return {
      ok, statusCode: result.statusCode, durationMs: result.durationMs, snippet: result.body.slice(0, 500) || null,
      error: ok ? null : redirect ? `The receiver answered with a redirect (HTTP ${result.statusCode}); redirects are not followed.` : `The receiver answered HTTP ${result.statusCode}.`,
    };
  } catch (err) {
    const message = err instanceof SsrfError ? `Blocked: ${err.message}` : (err as Error)?.message || String(err);
    return { ok: false, statusCode: null, error: message.slice(0, 500), snippet: null, durationMs: Date.now() - started };
  }
}

const openSecret = (sealed: string) => { try { return open(sealed); } catch { return null; } };

/** Delivers every due pending/failed row once; failures are rescheduled with backoff or dead-lettered. */
export async function deliverDueWebhooks(db: Sql, deps: WebhookDeps = {}, limit = 50) {
  const now = deps.now?.() ?? new Date();
  const maxAttempts = deps.maxAttempts ?? MAX_ATTEMPTS;
  const rows = await db.all(`SELECT d.*, e.url AS endpoint_url, e.secret_sealed, e.enabled AS endpoint_enabled FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
    WHERE d.status IN ('pending', 'failed') AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= ?) ORDER BY d.created_at LIMIT ?`, now.toISOString(), limit);
  const result = { attempted: 0, sent: 0, failed: 0, dead: 0, skipped: 0 };
  for (const row of rows) {
    // Claim by bumping attempts; a concurrent pass that loses the race changes nothing and moves on.
    const claimed = await db.run(`UPDATE webhook_deliveries SET attempts = attempts + 1, updated_at = ? WHERE id = ? AND attempts = ? AND status IN ('pending', 'failed')`, new Date().toISOString(), row.id, row.attempts);
    if (!claimed.changes) continue;
    result.attempted++;
    const attempts = row.attempts + 1;
    const at = () => new Date().toISOString();
    const secret = openSecret(row.secret_sealed);
    if (!row.endpoint_enabled || !secret) {
      await db.run(`UPDATE webhook_deliveries SET status = 'skipped', last_error = ?, next_attempt_at = NULL, updated_at = ? WHERE id = ?`, !secret ? 'The signing secret cannot be read (BETTER_AUTH_SECRET changed?). Rotate the secret.' : 'The endpoint is disabled.', at(), row.id);
      result.skipped++;
      continue;
    }
    const outcome = await sendOnce(row.endpoint_url, secret, row, deps);
    if (outcome.ok) {
      await db.run(`UPDATE webhook_deliveries SET status = 'sent', sent_at = ?, last_status_code = ?, last_error = NULL, response_snippet = ?, duration_ms = ?, next_attempt_at = NULL, updated_at = ? WHERE id = ?`, at(), outcome.statusCode, outcome.snippet, outcome.durationMs, at(), row.id);
      await db.run(`UPDATE webhook_endpoints SET consecutive_failures = 0 WHERE id = ? AND consecutive_failures <> 0`, row.endpoint_id);
      result.sent++;
    } else if (attempts >= maxAttempts) {
      await db.run(`UPDATE webhook_deliveries SET status = 'dead', last_status_code = ?, last_error = ?, response_snippet = ?, duration_ms = ?, next_attempt_at = NULL, updated_at = ? WHERE id = ?`, outcome.statusCode, outcome.error, outcome.snippet, outcome.durationMs, at(), row.id);
      const endpoint = await db.get<{ consecutive_failures: number }>(`UPDATE webhook_endpoints SET consecutive_failures = consecutive_failures + 1 WHERE id = ? RETURNING consecutive_failures`, row.endpoint_id);
      if (endpoint && endpoint.consecutive_failures >= DISABLE_AFTER_DEAD) {
        await db.run(`UPDATE webhook_endpoints SET enabled = false, disabled_reason = 'too_many_failures', updated_at = ? WHERE id = ?`, at(), row.endpoint_id);
        log.warn(`Webhook endpoint ${row.endpoint_id} disabled after ${endpoint.consecutive_failures} abandoned deliveries.`);
      }
      result.dead++;
      log.warn(`Webhook delivery abandoned after ${attempts} attempts: ${row.event_type} -> ${row.endpoint_id}: ${outcome.error}`);
    } else {
      await db.run(`UPDATE webhook_deliveries SET status = 'failed', last_status_code = ?, last_error = ?, response_snippet = ?, duration_ms = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?`,
        outcome.statusCode, outcome.error, outcome.snippet, outcome.durationMs, new Date(now.getTime() + webhookBackoffMs(attempts)).toISOString(), at(), row.id);
      result.failed++;
    }
  }
  return result;
}

/** Test delivery: a signed `webhook.test` event sent right now, logged like any delivery but never retried. */
export async function sendTestDelivery(db: Sql, organizationId: string, endpointId: string, deps: WebhookDeps = {}) {
  const row = await db.get(`SELECT * FROM webhook_endpoints WHERE organization_id = ? AND id = ?`, organizationId, endpointId);
  if (!row) return null;
  const secret = openSecret(row.secret_sealed);
  if (!secret) throw new WebhookInputError('The signing secret cannot be read. Rotate the secret first.', 409, 'WEBHOOK_SECRET_UNREADABLE');
  const now = new Date().toISOString();
  const event = { id: `evt_${crypto.randomUUID()}`, type: 'webhook.test', apiVersion: API_VERSION, created: now, organizationId, data: { message: 'This is a test delivery from Legalio.' } };
  const delivery = { id: `whd_${crypto.randomUUID()}`, event_id: event.id, event_type: event.type, payload: JSON.stringify(event) };
  const outcome = await sendOnce(row.url, secret, delivery, deps);
  await db.run(`INSERT INTO webhook_deliveries (id, organization_id, endpoint_id, event_id, event_type, payload, status, attempts, next_attempt_at, last_status_code, last_error, response_snippet, duration_ms, created_at, updated_at, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, ?, ?, ?, ?, ?)`, delivery.id, organizationId, endpointId, event.id, event.type, delivery.payload, outcome.ok ? 'sent' : 'dead',
    outcome.statusCode, outcome.error, outcome.snippet, outcome.durationMs, now, now, outcome.ok ? now : null);
  return { deliveryId: delivery.id, ok: outcome.ok, statusCode: outcome.statusCode, durationMs: outcome.durationMs, error: outcome.error };
}

/* ------------------------------ delivery log ------------------------------ */

export interface DeliveryRow {
  id: string; endpointId: string; eventId: string; eventType: string; status: string; attempts: number; nextAttemptAt: string | null;
  lastStatusCode: number | null; lastError: string | null; responseSnippet: string | null; durationMs: number | null; createdAt: string; sentAt: string | null;
}
const toDelivery = (row: any): DeliveryRow => ({
  id: row.id, endpointId: row.endpoint_id, eventId: row.event_id, eventType: row.event_type, status: row.status, attempts: row.attempts, nextAttemptAt: row.next_attempt_at,
  lastStatusCode: row.last_status_code, lastError: row.last_error, responseSnippet: row.response_snippet, durationMs: row.duration_ms, createdAt: row.created_at, sentAt: row.sent_at,
});

export async function listDeliveries(db: Sql, organizationId: string, endpointId: string, query: { status?: string; limit?: number; offset?: number } = {}) {
  const limit = Math.min(100, Math.max(1, Math.trunc(query.limit ?? 25) || 25));
  const offset = Math.max(0, Math.trunc(query.offset ?? 0) || 0);
  const params: unknown[] = [organizationId, endpointId];
  let where = 'organization_id = ? AND endpoint_id = ?';
  if (query.status) { where += ' AND status = ?'; params.push(query.status); }
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM webhook_deliveries WHERE ${where}`, ...params))!.n;
  const rows = await db.all(`SELECT * FROM webhook_deliveries WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  return { deliveries: rows.map(toDelivery), total, limit, offset };
}

export async function getDelivery(db: Sql, organizationId: string, endpointId: string, id: string) {
  const row = await db.get(`SELECT * FROM webhook_deliveries WHERE organization_id = ? AND endpoint_id = ? AND id = ?`, organizationId, endpointId, id);
  return row ? { ...toDelivery(row), payload: JSON.parse(row.payload) } : null;
}

/** Puts a dead or failed delivery back in the queue (an administrator's explicit retry). */
export async function retryDelivery(db: Sql, organizationId: string, endpointId: string, id: string): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db.run(`UPDATE webhook_deliveries SET status = 'pending', attempts = 0, next_attempt_at = ?, updated_at = ? WHERE organization_id = ? AND endpoint_id = ? AND id = ? AND status IN ('dead', 'failed', 'skipped') AND event_type <> 'webhook.test'`, now, now, organizationId, endpointId, id);
  if (result.changes) setImmediate(() => queuedListener?.());
  return result.changes > 0;
}

/** Old delivery rows are removed after 30 days (sent) / 90 days (dead), so the log does not grow without bound. */
export async function pruneDeliveries(db: Sql, now = new Date()) {
  const day = 86_400_000;
  const sent = await db.run(`DELETE FROM webhook_deliveries WHERE status IN ('sent', 'skipped') AND created_at < ?`, new Date(now.getTime() - 30 * day).toISOString());
  const dead = await db.run(`DELETE FROM webhook_deliveries WHERE status = 'dead' AND created_at < ?`, new Date(now.getTime() - 90 * day).toISOString());
  return sent.changes + dead.changes;
}

export { resolvePublicAddresses };
