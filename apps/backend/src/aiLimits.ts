import { AsyncLocalStorage } from 'node:async_hooks';
import type { Sql } from './db';

/** Organization the current request belongs to, for AI budgets and caches (set by a middleware after authorization). */
export const aiContext = new AsyncLocalStorage<{ organizationId: string | null }>();
export const currentAiOrganization = () => aiContext.getStore()?.organizationId ?? null;

export interface AiLimits {
  /** Calls per organization per minute (in-memory sliding window). */
  perMinute: number;
  /** Calls and tokens per organization per UTC day (persisted in ai_usage). 0 disables a budget. */
  dailyCalls: number;
  dailyTokens: number;
  /** Model attempts per request, including the primary model. */
  maxAttempts: number;
  timeoutMs: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  chatHistoryMessages: number;
  chatContextChars: number;
}

export function aiLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): AiLimits {
  const int = (name: string, fallback: number, min = 0) => { const v = Number(env[name]); return Number.isFinite(v) && v >= min ? Math.trunc(v) : fallback; };
  return {
    perMinute: int('AI_ORG_CALLS_PER_MINUTE', 30),
    dailyCalls: int('AI_ORG_DAILY_CALLS', 1000),
    dailyTokens: int('AI_ORG_DAILY_TOKENS', 3_000_000),
    maxAttempts: Math.max(1, Math.min(3, int('AI_MAX_MODEL_ATTEMPTS', 3, 1))),
    timeoutMs: Math.max(1000, int('AI_ATTEMPT_TIMEOUT_MS', 35_000)),
    baseBackoffMs: int('AI_BACKOFF_BASE_MS', 1000),
    maxBackoffMs: int('AI_BACKOFF_MAX_MS', 15_000),
    chatHistoryMessages: Math.max(1, int('AI_CHAT_HISTORY_MESSAGES', 12, 1)),
    chatContextChars: Math.max(2000, int('AI_CHAT_CONTEXT_CHARS', 60_000)),
  };
}

export class AiLimitError extends Error {
  readonly status = 429;
  constructor(readonly code: 'AI_RATE_LIMITED' | 'AI_DAILY_BUDGET', message: string, readonly retryAfterSeconds: number) { super(message); }
}

/** Sliding one-minute window per key. */
export class AiRateLimiter {
  private hits = new Map<string, number[]>();
  hit(key: string, limit: number, now = Date.now()): void {
    if (limit <= 0) return;
    const recent = (this.hits.get(key) ?? []).filter(t => now - t < 60_000);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      throw new AiLimitError('AI_RATE_LIMITED', 'Too many AI requests for this organization. Please wait a moment and try again.', Math.max(1, Math.ceil((60_000 - (now - recent[0])) / 1000)));
    }
    recent.push(now);
    this.hits.set(key, recent);
  }
}

const dayOf = (now: Date) => now.toISOString().slice(0, 10);
const secondsToUtcMidnight = (now: Date) => Math.max(1, Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000));

/** Counts one call against the organization's rate limit and daily budget, or throws AiLimitError (HTTP 429). */
export async function reserveAiCall(db: Sql, organizationId: string | null, limits: AiLimits, limiter: AiRateLimiter, now = new Date()) {
  const key = organizationId ?? 'platform';
  limiter.hit(key, limits.perMinute, now.getTime());
  const updated = await db.get(`
    INSERT INTO ai_usage (organization_id, day, calls, tokens) VALUES (@key, @day, 1, 0)
    ON CONFLICT (organization_id, day) DO UPDATE SET calls = ai_usage.calls + 1
      WHERE (@maxCalls <= 0 OR ai_usage.calls < @maxCalls) AND (@maxTokens <= 0 OR ai_usage.tokens < @maxTokens)
    RETURNING calls`, { key, day: dayOf(now), maxCalls: limits.dailyCalls, maxTokens: limits.dailyTokens });
  if (!updated) throw new AiLimitError('AI_DAILY_BUDGET', 'The daily AI budget for this organization has been used up. It resets at 00:00 UTC.', secondsToUtcMidnight(now));
}

export async function recordAiTokens(db: Sql, organizationId: string | null, tokens: number, now = new Date()) {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  await db.run(`INSERT INTO ai_usage (organization_id, day, calls, tokens) VALUES (@key, @day, 0, @tokens)
    ON CONFLICT (organization_id, day) DO UPDATE SET tokens = ai_usage.tokens + @tokens`, { key: organizationId ?? 'platform', day: dayOf(now), tokens: Math.trunc(tokens) });
}

/* ------------------------------ model chain ------------------------------ */

const text = (err: any) => String(err?.message ?? err ?? '').toLowerCase();
export const isRateLimited = (err: any) => err?.status === 429 || err?.code === 429 || /\b429\b|resource_exhausted|rate limit|quota/.test(text(err));
/** The key or project is wrong; another model will not help. */
export const isFatalForAllModels = (err: any) => [401, 403].includes(err?.status) || /api key not valid|api_key_invalid|invalid api key|permission_denied/.test(text(err));

export interface ChainOptions<T> {
  models: string[];
  limits: Pick<AiLimits, 'maxAttempts' | 'timeoutMs' | 'baseBackoffMs' | 'maxBackoffMs'>;
  /** Must honor `signal`: it is aborted when the attempt times out. */
  call: (model: string, signal: AbortSignal) => Promise<T>;
  sleep?: (ms: number) => Promise<void>;
  onAttemptFailed?: (model: string, err: unknown, attempt: number) => void;
}

/**
 * Tries the primary model, then fallbacks, at most `maxAttempts` times. Every attempt has an AbortController that really
 * cancels the request on timeout (and its timer is always cleared). After a 429 the next attempt waits 2^n * base (capped).
 */
export async function runModelChain<T>(options: ChainOptions<T>): Promise<T> {
  const { limits } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const queue = options.models.slice(0, Math.max(1, limits.maxAttempts));
  let lastError: unknown;
  let rateLimitedAttempts = 0;
  for (const [index, model] of queue.entries()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Timeout: model ${model} took longer than ${limits.timeoutMs / 1000}s`)), limits.timeoutMs);
    try {
      return await options.call(model, controller.signal);
    } catch (err) {
      lastError = controller.signal.aborted ? (controller.signal.reason ?? err) : err;
      options.onAttemptFailed?.(model, lastError, index + 1);
      if (isFatalForAllModels(lastError)) break;
      if (index < queue.length - 1 && isRateLimited(lastError)) {
        await sleep(Math.min(limits.maxBackoffMs, limits.baseBackoffMs * 2 ** rateLimitedAttempts++));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error('No AI model attempt was made.');
}

/* ------------------------- bounded chat inputs ------------------------- */

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);

/** Last N messages, each clipped; keeps the model's context small and the cost predictable. */
export function boundChatHistory<T extends { text?: unknown }>(history: unknown, limits: Pick<AiLimits, 'chatHistoryMessages'>, perMessageChars = 4000): T[] {
  if (!Array.isArray(history)) return [];
  return (history as T[]).filter(m => m && typeof m.text === 'string' && m.text.trim()).slice(-limits.chatHistoryMessages)
    .map(m => ({ ...m, text: clip(String(m.text).trim(), perMessageChars) }));
}

const WORD = /[\p{L}\p{N}]{3,}/gu;
const wordsOf = (value: string) => new Set(value.toLowerCase().match(WORD) ?? []);

/**
 * Selects the part of the workspace that fits `chatContextChars`: rows are ranked by overlap with the question and the
 * recent conversation (ties keep the stored order), long text is clipped, and the totals of every collection are kept
 * so the model knows when rows were left out. Returns a new object; the input is not modified.
 */
export function boundWorkspaceContext<T extends Record<string, unknown>>(workspace: T, question: string, recentTexts: string[], limits: Pick<AiLimits, 'chatContextChars'>) {
  const interest = wordsOf([question, ...recentTexts].join(' '));
  const collections = Object.entries(workspace).filter(([, v]) => Array.isArray(v)) as Array<[string, any[]]>;
  const base: Record<string, unknown> = Object.fromEntries(Object.entries(workspace).filter(([, v]) => !Array.isArray(v)));
  const shrink = (row: any) => JSON.parse(JSON.stringify(row, (_k, v) => (typeof v === 'string' ? clip(v, 600) : v)));
  const ranked = collections.map(([name, rows]) => ({
    name,
    rows: rows.map((row, order) => {
      const clipped = shrink(row);
      const json = JSON.stringify(clipped);
      let score = 0;
      for (const word of wordsOf(json)) if (interest.has(word)) score++;
      return { clipped, size: json.length, score, order };
    }).sort((a, b) => b.score - a.score || a.order - b.order),
  }));
  const totals = Object.fromEntries(collections.map(([name, rows]) => [name, rows.length]));
  const included: Record<string, any[]> = Object.fromEntries(collections.map(([name]) => [name, []]));
  let used = JSON.stringify({ ...base, record_counts: totals }).length + 200;
  // Round-robin so one large collection cannot starve the others.
  const cursors = ranked.map(() => 0);
  let progressed = true;
  while (progressed) {
    progressed = false;
    ranked.forEach((entry, i) => {
      const next = entry.rows[cursors[i]];
      if (!next || used + next.size + 2 > limits.chatContextChars) return;
      included[entry.name].push({ row: next.clipped, order: next.order });
      used += next.size + 2;
      cursors[i]++;
      progressed = true;
    });
  }
  const result: Record<string, unknown> = { ...base, record_counts: totals };
  let truncated = false;
  for (const [name, rows] of collections) {
    const kept = included[name].sort((a: any, b: any) => a.order - b.order).map((e: any) => e.row);
    result[name] = kept;
    if (kept.length < rows.length) truncated = true;
  }
  if (truncated) result.context_note = 'The workspace is larger than shown: only the rows most relevant to the question are included. record_counts has the full totals; ask the user to narrow the question for records not listed.';
  return result;
}
