import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Needs PostgreSQL at TEST_DATABASE_URL (see testDatabase.ts).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-ai-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { ensureSchema } = await import('./schema');
const ai = await import('./aiLimits');
const { globalOcrCache, setCachedTranscript, getCachedTranscript } = await import('./lib/cheapOcrPipeline');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });

const limits = { ...ai.aiLimitsFromEnv({}), perMinute: 3, dailyCalls: 4, dailyTokens: 1000 };

test('defaults are bounded and env-configurable', () => {
  const d = ai.aiLimitsFromEnv({});
  assert.deepEqual([d.maxAttempts, d.timeoutMs, d.perMinute, d.dailyCalls], [3, 35_000, 30, 1000]);
  assert.equal(ai.aiLimitsFromEnv({ AI_MAX_MODEL_ATTEMPTS: '9' }).maxAttempts, 3, 'the fallback chain never exceeds 3 attempts');
  assert.equal(ai.aiLimitsFromEnv({ AI_ORG_DAILY_CALLS: '50' }).dailyCalls, 50);
});

test('per-organization rate limit is a sliding minute and isolated per organization', () => {
  const limiter = new ai.AiRateLimiter();
  const t = 1_000_000;
  for (let i = 0; i < 3; i++) limiter.hit('org-a', 3, t + i);
  assert.throws(() => limiter.hit('org-a', 3, t + 10), (e: any) => e instanceof ai.AiLimitError && e.code === 'AI_RATE_LIMITED' && e.status === 429 && e.retryAfterSeconds >= 1);
  limiter.hit('org-b', 3, t + 10);
  limiter.hit('org-a', 3, t + 61_000); // window moved on
});

test('daily call budget is persisted per organization and day', async () => {
  const limiter = new ai.AiRateLimiter();
  const wide = { ...limits, perMinute: 100 };
  const now = new Date('2026-10-23T10:00:00Z');
  for (let i = 0; i < 4; i++) await ai.reserveAiCall(sql, 'org-a', wide, limiter, now);
  await assert.rejects(ai.reserveAiCall(sql, 'org-a', wide, limiter, now), (e: any) => e.code === 'AI_DAILY_BUDGET' && e.status === 429 && e.retryAfterSeconds > 0);
  await ai.reserveAiCall(sql, 'org-b', wide, limiter, now); // other organization unaffected
  await ai.reserveAiCall(sql, 'org-a', wide, limiter, new Date('2026-10-24T00:00:01Z')); // next UTC day
  assert.equal((await sql.get<any>(`SELECT calls FROM ai_usage WHERE organization_id = 'org-a' AND day = '2026-10-23'`)).calls, 4, 'refused calls are not counted');
});

test('daily token budget blocks once consumed', async () => {
  const limiter = new ai.AiRateLimiter();
  const wide = { ...limits, perMinute: 100, dailyCalls: 100 };
  const now = new Date('2026-11-01T10:00:00Z');
  await ai.reserveAiCall(sql, 'org-t', wide, limiter, now);
  await ai.recordAiTokens(sql, 'org-t', 1500, now);
  await assert.rejects(ai.reserveAiCall(sql, 'org-t', wide, limiter, now), (e: any) => e.code === 'AI_DAILY_BUDGET');
  await ai.recordAiTokens(sql, 'org-t', 0, now);
  await ai.recordAiTokens(sql, 'org-t', Number.NaN, now);
});

test('the model chain stops at 3 attempts, backs off exponentially on 429, and returns the first success', async () => {
  const slept: number[] = [];
  const tried: string[] = [];
  const rate = Object.assign(new Error('RESOURCE_EXHAUSTED 429'), { status: 429 });
  const result = await ai.runModelChain({
    models: ['m1', 'm2', 'm3', 'm4', 'm5'], limits: { maxAttempts: 3, timeoutMs: 1000, baseBackoffMs: 100, maxBackoffMs: 10_000 },
    sleep: async (ms) => { slept.push(ms); },
    call: async (model) => { tried.push(model); if (model !== 'm3') throw rate; return 'ok'; },
  });
  assert.equal(result, 'ok');
  assert.deepEqual(tried, ['m1', 'm2', 'm3']);
  assert.deepEqual(slept, [100, 200]);

  tried.length = 0;
  await assert.rejects(ai.runModelChain({
    models: ['m1', 'm2', 'm3', 'm4'], limits: { maxAttempts: 3, timeoutMs: 1000, baseBackoffMs: 1, maxBackoffMs: 5 },
    sleep: async () => undefined, call: async (model) => { tried.push(model); throw new Error('boom'); },
  }), /boom/);
  assert.deepEqual(tried, ['m1', 'm2', 'm3'], 'never more than 3 attempts');
});

test('an invalid key stops the chain at once (no point trying other models)', async () => {
  const tried: string[] = [];
  await assert.rejects(ai.runModelChain({
    models: ['m1', 'm2', 'm3'], limits: { maxAttempts: 3, timeoutMs: 1000, baseBackoffMs: 1, maxBackoffMs: 5 },
    call: async (model) => { tried.push(model); throw new Error('API key not valid. Please pass a valid API key.'); },
  }), /API key not valid/);
  assert.deepEqual(tried, ['m1']);
});

test('timeout really aborts the request (AbortSignal fires) and the timer is cleared', async () => {
  let aborted = false;
  const started = Date.now();
  await assert.rejects(ai.runModelChain({
    models: ['slow'], limits: { maxAttempts: 1, timeoutMs: 30, baseBackoffMs: 1, maxBackoffMs: 1 },
    call: (_model, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }); }),
  }), /Timeout: model slow/);
  assert.equal(aborted, true);
  assert.ok(Date.now() - started < 1000);
  // A fast success leaves no pending timer behind: the process would otherwise hang on the 60 s timer below.
  await ai.runModelChain({ models: ['fast'], limits: { maxAttempts: 1, timeoutMs: 60_000, baseBackoffMs: 1, maxBackoffMs: 1 }, call: async () => 'done' });
});

test('chat history is limited to the last messages and clipped', () => {
  const history = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'ai' : 'user', text: `message ${i} ${'x'.repeat(10_000)}` }));
  const bounded = ai.boundChatHistory<any>(history, { chatHistoryMessages: 12 });
  assert.equal(bounded.length, 12);
  assert.ok(bounded[0].text.startsWith('message 28'));
  assert.ok(bounded.every((m: any) => m.text.length <= 4001));
  assert.deepEqual(ai.boundChatHistory('nope' as any, { chatHistoryMessages: 12 }), []);
});

test('workspace context is bounded and keeps the rows relevant to the question', () => {
  const workspace = {
    organization: { name: 'Acme' },
    partners: Array.from({ length: 300 }, (_, i) => ({ partner_id: `p${i}`, name: i === 250 ? 'Zebra Logistics' : `Vendor ${i}`, internal_notes: 'n'.repeat(2000) })),
    contracts: Array.from({ length: 300 }, (_, i) => ({ contract_id: `c${i}`, title: i === 280 ? 'Zebra framework agreement' : `Contract ${i}` })),
  };
  const bounded: any = ai.boundWorkspaceContext(workspace, 'What does the Zebra agreement say?', [], { chatContextChars: 20_000 });
  const size = JSON.stringify(bounded).length;
  assert.ok(size <= 21_000, `context is ${size} chars`);
  assert.deepEqual(bounded.record_counts, { partners: 300, contracts: 300 });
  assert.ok(bounded.partners.some((p: any) => p.name === 'Zebra Logistics'));
  assert.ok(bounded.contracts.some((c: any) => c.title === 'Zebra framework agreement'));
  assert.ok(bounded.partners.length > 0 && bounded.contracts.length > 0, 'no collection is starved');
  assert.match(bounded.context_note, /most relevant/);
  assert.equal(workspace.partners[0].internal_notes.length, 2000, 'input is not modified');
  assert.ok(bounded.partners.every((p: any) => p.internal_notes.length <= 601));
  const small: any = ai.boundWorkspaceContext({ partners: [{ partner_id: 'p1', name: 'A' }] }, 'hi', [], { chatContextChars: 20_000 });
  assert.equal(small.context_note, undefined);
});

test('OCR/transcript caches are keyed by organization', async () => {
  await ai.aiContext.run({ organizationId: 'org-a' }, () => setCachedTranscript('hash1', 'text of org a'));
  assert.equal(await ai.aiContext.run({ organizationId: 'org-a' }, () => getCachedTranscript('hash1')), 'text of org a');
  assert.equal(await ai.aiContext.run({ organizationId: 'org-b' }, () => getCachedTranscript('hash1')), null);
  assert.equal(await getCachedTranscript('hash1'), null);
  const key = (await sql.get<any>(`SELECT cache_key FROM ai_ocr_cache WHERE cache_key LIKE 'transcript:%'`)).cache_key;
  assert.equal(key, 'transcript:org-a:hash1');
  await globalOcrCache.set('h', 'contracts:org-a', { x: 1 });
  assert.equal(await globalOcrCache.get('h', 'contracts:org-b'), null);
});

test('monthly token limit: the organization choice beats the platform default, tokens add up over the month, the next month starts clean', async () => {
  const limiter = new ai.AiRateLimiter();
  const wide = { ...limits, perMinute: 100, dailyCalls: 0, dailyTokens: 0, monthlyTokens: 0 };
  const mid = new Date('2026-11-10T12:00:00Z');
  // No limit anywhere: never refused.
  await ai.recordAiTokens(sql, 'org-m', 5_000_000, mid);
  await ai.reserveAiCall(sql, 'org-m', wide, limiter, mid);
  // The platform default applies until the organization has its own choice.
  await assert.rejects(ai.reserveAiCall(sql, 'org-m', { ...wide, monthlyTokens: 1_000_000 }, limiter, mid), (e: any) => e.code === 'AI_MONTHLY_BUDGET' && e.status === 429 && e.retryAfterSeconds > 0);
  await sql.run(`INSERT INTO ai_org_limits (organization_id, monthly_tokens, updated_at) VALUES ('org-m', 10000000, 'now')`);
  await ai.reserveAiCall(sql, 'org-m', { ...wide, monthlyTokens: 1_000_000 }, limiter, mid); // own limit 10M > 5M used
  await sql.run(`UPDATE ai_org_limits SET monthly_tokens = 5000000 WHERE organization_id = 'org-m'`);
  await assert.rejects(ai.reserveAiCall(sql, 'org-m', wide, limiter, mid), (e: any) => e.code === 'AI_MONTHLY_BUDGET');
  assert.equal(await ai.monthlyTokenLimit(sql, 'org-m', 7), 5_000_000);
  assert.equal(await ai.monthlyTokenLimit(sql, 'org-none', 7), 7);
  // Usage from earlier days of the month counts, usage from the previous month does not, other organizations are unaffected.
  await ai.recordAiTokens(sql, 'org-m', 1, new Date('2026-11-01T00:00:01Z'));
  assert.equal(await ai.monthTokensUsed(sql, 'org-m', mid), 5_000_001);
  assert.equal(await ai.monthTokensUsed(sql, 'org-m', new Date('2026-12-02T00:00:00Z')), 0);
  await ai.reserveAiCall(sql, 'org-m', wide, limiter, new Date('2026-12-02T00:00:00Z'));
  await ai.reserveAiCall(sql, 'org-other', wide, limiter, mid);
  // 0 chosen for the organization means unlimited even when the default is set.
  await sql.run(`UPDATE ai_org_limits SET monthly_tokens = 0 WHERE organization_id = 'org-m'`);
  await ai.reserveAiCall(sql, 'org-m', { ...wide, monthlyTokens: 1 }, limiter, mid);
  assert.deepEqual(ai.MONTHLY_TOKEN_OPTIONS, [100_000, 500_000, 1_000_000, 5_000_000, 10_000_000, 0]);
});
