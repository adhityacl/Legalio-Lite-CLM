import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Needs PostgreSQL at TEST_DATABASE_URL (see testDatabase.ts).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-reminders-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false' });
const { sql, withAdvisoryLock } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { ensureSchema } = await import('./schema');
const reminders = await import('./reminders');
const { planReminders, ledgerKey, enqueue, existingKeys, deliverDue, backoffMs, createReminderScheduler, schedulerOptionsFromEnv, seedLedgerFromLegacy, REMINDER_LOCK_KEY } = reminders;

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });

const plan = (daysRemaining: number | null, existing: string[] = [], extra: Partial<Parameters<typeof planReminders>[0]> = {}) =>
  planReminders({ daysRemaining, offsets: [90, 60, 30, 14], noticeLeadDays: 7, existing: new Set(existing), ...extra });

test('an exact-day match is no longer required: a missed day still sends the reminder', () => {
  assert.deepEqual(plan(29), [{ trigger: 'offset', offsetDays: 30 }, { trigger: 'offset', offsetDays: 60, skip: true }, { trigger: 'offset', offsetDays: 90, skip: true }]);
  assert.deepEqual(plan(30, [ledgerKey('offset', 30)]).filter((p) => !p.skip), []);
});

test('only the most urgent crossed offset is sent, once per cycle', () => {
  const first = plan(20);
  assert.deepEqual(first.filter((p) => !p.skip).map((p) => p.offsetDays), [30]);
  assert.deepEqual(plan(20, ['offset:30', 'offset:60', 'offset:90']), []);
  // Later the next offset comes due.
  assert.deepEqual(plan(13, ['offset:30', 'offset:60', 'offset:90']).filter((p) => !p.skip).map((p) => p.offsetDays), [14]);
});

test('nothing is planned for ended, unknown or far-future end dates', () => {
  assert.deepEqual(plan(-1), []);
  assert.deepEqual(plan(null), []);
  assert.deepEqual(plan(400), []);
});

test('the notice deadline (end date minus notice period) is its own trigger', () => {
  assert.deepEqual(plan(100, [], { noticeDays: 90 }), []); // 10 days to the deadline: outside the 7-day lead
  assert.deepEqual(plan(95, [], { noticeDays: 90 }).map((p) => p.trigger), ['notice']); // 5 days to the deadline
  assert.deepEqual(plan(95, ['notice:90'], { noticeDays: 90 }), []);
  assert.deepEqual(plan(500, [], { noticeDays: 90 }), []);
});

test('the ledger is keyed by record and cycle: a renewal starts fresh, a repeat is a no-op', async () => {
  const entry = { organizationId: 'org-a', kind: 'contract' as const, recordId: 'c1', cycleEnd: '2026-12-31', trigger: 'offset' as const, offsetDays: 30, recipients: 'a@x.com' };
  assert.ok(await enqueue(sql, entry));
  assert.equal(await enqueue(sql, entry), null);
  assert.deepEqual([...await existingKeys(sql, 'contract', 'c1', '2026-12-31')], ['offset:30']);
  // Renewed: new end date, same record -> empty cycle.
  assert.deepEqual([...await existingKeys(sql, 'contract', 'c1', '2027-12-31')], []);
  assert.ok(await enqueue(sql, { ...entry, cycleEnd: '2027-12-31' }));
});

test('is_sent semantics: a row is sent only after success; failures back off and retry; the last attempt is abandoned', async () => {
  await sql.exec('TRUNCATE reminder_ledger');
  const id = (await enqueue(sql, { organizationId: 'org-a', kind: 'commercial', recordId: 'io1', cycleEnd: '2026-11-30', trigger: 'offset', offsetDays: 14, recipients: 'a@x.com', notificationId: 'n1' }))!;
  const sent: string[] = [];
  const t0 = new Date(Date.now() + 1000); // after the row's own next_attempt_at
  const failing = async () => ({ ok: false, error: 'connect ECONNREFUSED' });

  let result = await deliverDue(sql, failing, { now: t0, onSent: (row) => { sent.push(row.id); } });
  assert.equal(result.failed, 1);
  let row = (await sql.get<any>('SELECT * FROM reminder_ledger WHERE id = ?', id));
  assert.equal(row.status, 'failed');
  assert.equal(row.attempts, 1);
  assert.match(row.last_error, /ECONNREFUSED/);
  assert.equal(row.next_attempt_at, new Date(t0.getTime() + backoffMs(1)).toISOString());
  assert.equal(sent.length, 0, 'onSent (is_sent = true) must not run on failure');

  // Not due yet: nothing is attempted.
  assert.equal((await deliverDue(sql, failing, { now: new Date(t0.getTime() + 60_000) })).attempted, 0);

  // After the backoff a working relay delivers it.
  const later = new Date(t0.getTime() + backoffMs(1) + 1000);
  result = await deliverDue(sql, async () => ({ ok: true }), { now: later, onSent: (r) => { sent.push(r.id); } });
  assert.equal(result.sent, 1);
  row = (await sql.get<any>('SELECT * FROM reminder_ledger WHERE id = ?', id));
  assert.equal(row.status, 'sent');
  assert.equal(row.attempts, 2);
  assert.ok(row.sent_at);
  assert.deepEqual(sent, [id]);

  // Sent rows are never sent again.
  assert.equal((await deliverDue(sql, async () => ({ ok: true }), { now: later })).attempted, 0);
});

test('a reminder that keeps failing is abandoned after the maximum attempts and logged as dead', async () => {
  await sql.exec('TRUNCATE reminder_ledger');
  const id = (await enqueue(sql, { organizationId: 'org-a', kind: 'contract', recordId: 'c-dead', cycleEnd: '2026-11-30', trigger: 'notice', offsetDays: 30 }))!;
  let now = new Date(Date.now() + 1000);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await deliverDue(sql, async () => { throw new Error('boom'); }, { now, maxAttempts: 3 });
    now = new Date(now.getTime() + 7 * 3600_000);
  }
  const row = await sql.get<any>('SELECT status, attempts, last_error FROM reminder_ledger WHERE id = ?', id);
  assert.deepEqual({ ...row }, { status: 'dead', attempts: 3, last_error: 'boom' });
});

test('a sender that reports "nothing to send" settles the row without retry', async () => {
  await sql.exec('TRUNCATE reminder_ledger');
  const id = (await enqueue(sql, { organizationId: 'org-a', kind: 'contract', recordId: 'c-skip', cycleEnd: '2026-11-30', trigger: 'offset', offsetDays: 30 }))!;
  const result = await deliverDue(sql, async () => ({ ok: false, skipped: true, error: 'SMTP relay disabled' }));
  assert.equal(result.skipped, 1);
  assert.equal((await sql.get<any>('SELECT status FROM reminder_ledger WHERE id = ?', id)).status, 'skipped');
});

test('legacy notifications are seeded once as sent', async () => {
  const entries = [{ organizationId: 'org-a', kind: 'contract' as const, recordId: 'legacy1', cycleEnd: '2026-12-01', offsetDays: 30 }];
  assert.equal(await seedLedgerFromLegacy(sql, entries), 1);
  assert.equal(await seedLedgerFromLegacy(sql, entries), 0);
  assert.equal((await sql.get<any>(`SELECT status FROM reminder_ledger WHERE record_id = 'legacy1'`)).status, 'sent');
  assert.deepEqual(plan(20, [...await existingKeys(sql, 'contract', 'legacy1', '2026-12-01')]).filter((p) => !p.skip), []);
});

test('only one process runs a pass: the advisory lock is exclusive', async () => {
  const outcome = await withAdvisoryLock(REMINDER_LOCK_KEY, async () => {
    const inner = await withAdvisoryLock(REMINDER_LOCK_KEY, async () => 'second');
    assert.equal(inner.ran, false);
    return 'first';
  });
  assert.deepEqual(outcome, { ran: true, value: 'first' });
  assert.equal((await withAdvisoryLock(REMINDER_LOCK_KEY, async () => 1)).ran, true, 'released afterwards');
});

test('the scheduler runs a pass shortly after start, repeats, and stops', async () => {
  let full = 0, retry = 0;
  const scheduler = createReminderScheduler({
    enabled: true, intervalMs: 40, startupDelayMs: 10, retryIntervalMs: 25,
    fullPass: async () => { full++; }, retryPass: async () => { retry++; },
    lock: async (fn) => ({ ran: true, value: await fn() }),
  });
  assert.equal(scheduler.start(), true);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await scheduler.stop();
  assert.ok(full >= 2, `full passes: ${full}`);
  assert.ok(retry >= 1, `retry passes: ${retry}`);
  const seen = full;
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(full, seen, 'no passes after stop');
});

test('a held lock skips the pass instead of running it twice', async () => {
  let ran = 0;
  const scheduler = createReminderScheduler({
    enabled: true, intervalMs: 1000, startupDelayMs: 1000, retryIntervalMs: 1000,
    fullPass: async () => { ran++; }, retryPass: async () => undefined, lock: async () => ({ ran: false }),
  });
  await scheduler.runFull();
  assert.equal(ran, 0);
});

test('scheduler configuration: daily by default, off in test mode, configurable', () => {
  assert.deepEqual(schedulerOptionsFromEnv({}, false), { enabled: true, intervalMs: 24 * 3600_000, startupDelayMs: 60_000, retryIntervalMs: 15 * 60_000 });
  assert.equal(schedulerOptionsFromEnv({}, true).enabled, false);
  assert.equal(schedulerOptionsFromEnv({ REMINDER_SCHEDULER_ENABLED: 'false' }, false).enabled, false);
  assert.equal(schedulerOptionsFromEnv({ REMINDER_INTERVAL_MINUTES: '60' }, false).intervalMs, 3600_000);
  assert.equal(createReminderScheduler({ ...schedulerOptionsFromEnv({}, true), fullPass: async () => undefined, retryPass: async () => undefined }).start(), false);
});
