import crypto from 'node:crypto';
import { withAdvisoryLock, type Sql } from './db';
import { componentLog } from './logger';

const log = componentLog('reminders');

/*
 * Reminder engine: which reminders are due (pure planning), a persisted ledger/outbox with retry, and an
 * in-process scheduler guarded by a PostgreSQL advisory lock so only one instance runs a pass.
 *
 * Ledger identity is (kind, record, cycle end date, trigger, offset): a renewal that moves the end date starts a new
 * cycle with fresh reminders, and a pass that runs late still sends the reminder it missed.
 */

export type ReminderKind = 'contract' | 'commercial';
export type ReminderTrigger = 'offset' | 'notice';
export type LedgerStatus = 'pending' | 'sent' | 'failed' | 'dead' | 'skipped';

export interface PlanInput {
  daysRemaining: number | null;
  /** Tenant reminder offsets in days before the end date (any order). */
  offsets: number[];
  noticeDays?: number | null;
  /** The notice reminder is sent from this many days before the notice deadline. */
  noticeLeadDays: number;
  /** Ledger keys (`trigger:offset`) that already exist for this record's current cycle, whatever their status. */
  existing: Set<string>;
}
export interface PlannedReminder { trigger: ReminderTrigger; offsetDays: number; /** Superseded: counts as handled, nothing is sent. */ skip?: boolean }

export const ledgerKey = (trigger: ReminderTrigger, offsetDays: number) => `${trigger}:${offsetDays}`;

/**
 * Offsets: every offset at or beyond the remaining days has been crossed. Only the most urgent crossed offset is sent
 * (a record that first appears with 20 days left gets the 30-day reminder, not 90, 60 and 30 at once); the larger
 * crossed offsets are recorded as skipped. A past end date (negative days) sends nothing.
 * Notice: once the notice deadline (end date minus notice period) is within `noticeLeadDays` and the contract has not ended.
 */
export function planReminders(input: PlanInput): PlannedReminder[] {
  const { daysRemaining, noticeDays, noticeLeadDays, existing } = input;
  if (daysRemaining === null || daysRemaining < 0) return [];
  const planned: PlannedReminder[] = [];
  const crossed = [...new Set(input.offsets.filter(o => Number.isFinite(o) && o > 0))].filter(o => o >= daysRemaining).sort((a, b) => a - b);
  crossed.forEach((offset, index) => {
    if (existing.has(ledgerKey('offset', offset))) return;
    planned.push({ trigger: 'offset', offsetDays: offset, ...(index === 0 ? {} : { skip: true }) });
  });
  // The smallest crossed offset must be the one that is sent; if it already exists, larger ones are still marked handled.
  if (crossed.length && existing.has(ledgerKey('offset', crossed[0]))) {
    for (const p of planned) p.skip = true;
  }
  if (noticeDays && noticeDays > 0 && daysRemaining - noticeDays <= noticeLeadDays && !existing.has(ledgerKey('notice', noticeDays))) {
    planned.push({ trigger: 'notice', offsetDays: noticeDays });
  }
  return planned;
}

export interface LedgerRow {
  id: string; organization_id: string; kind: ReminderKind; record_id: string; cycle_end_date: string;
  trigger: ReminderTrigger; offset_days: number; status: LedgerStatus; attempts: number; last_error: string | null;
  next_attempt_at: string | null; recipients: string | null; notification_id: string | null;
  created_at: string; updated_at: string; sent_at: string | null;
}

export const MAX_ATTEMPTS = 5;
/** 5 min, 10, 20, 40 ... capped at 6 h. */
export const backoffMs = (attempts: number) => Math.min(6 * 3600_000, 5 * 60_000 * 2 ** Math.max(0, attempts - 1));

export async function existingKeys(db: Sql, kind: ReminderKind, recordId: string, cycleEnd: string): Promise<Set<string>> {
  const rows = await db.all<{ trigger: string; offset_days: number }>(
    'SELECT trigger, offset_days FROM reminder_ledger WHERE kind = ? AND record_id = ? AND cycle_end_date = ?', kind, recordId, cycleEnd);
  return new Set(rows.map(r => ledgerKey(r.trigger as ReminderTrigger, Number(r.offset_days))));
}

/** Inserts a ledger row; false when the cycle already has it (another instance or an earlier pass). */
export async function enqueue(db: Sql, entry: {
  organizationId: string; kind: ReminderKind; recordId: string; cycleEnd: string; trigger: ReminderTrigger; offsetDays: number;
  recipients?: string; notificationId?: string | null; skip?: boolean;
}): Promise<string | null> {
  const id = `rem-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const result = await db.run(`
    INSERT INTO reminder_ledger (id, organization_id, kind, record_id, cycle_end_date, trigger, offset_days, status, attempts, last_error, next_attempt_at,
      recipients, notification_id, created_at, updated_at)
    VALUES (@id, @organizationId, @kind, @recordId, @cycleEnd, @trigger, @offsetDays, @status, 0, @lastError, @next, @recipients, @notificationId, @now, @now)
    ON CONFLICT (kind, record_id, cycle_end_date, trigger, offset_days) DO NOTHING`, {
    id, organizationId: entry.organizationId, kind: entry.kind, recordId: entry.recordId, cycleEnd: entry.cycleEnd, trigger: entry.trigger,
    offsetDays: entry.offsetDays, status: entry.skip ? 'skipped' : 'pending', lastError: entry.skip ? 'superseded by a more urgent reminder' : null,
    next: entry.skip ? null : now, recipients: entry.recipients ?? null, notificationId: entry.notificationId ?? null, now,
  });
  return result.changes ? id : null;
}

export interface SendOutcome { ok: boolean; error?: string; /** Nothing to send (no recipients, SMTP off, record gone): settled without retry. */ skipped?: boolean }
export type ReminderSender = (row: LedgerRow) => Promise<SendOutcome>;

export interface DeliveryResult { attempted: number; sent: number; failed: number; dead: number; skipped: number }

/** Delivers every pending/failed row whose retry time has come. A row is `sent` only after the sender reports success. */
export async function deliverDue(db: Sql, send: ReminderSender, options: { now?: Date; limit?: number; maxAttempts?: number; onSent?: (row: LedgerRow) => Promise<void> | void } = {}): Promise<DeliveryResult> {
  const now = options.now ?? new Date();
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const rows = await db.all<LedgerRow>(
    `SELECT * FROM reminder_ledger WHERE status IN ('pending', 'failed') AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at LIMIT ?`,
    now.toISOString(), options.limit ?? 200);
  const result: DeliveryResult = { attempted: 0, sent: 0, failed: 0, dead: 0, skipped: 0 };
  for (const row of rows) {
    // Claim by bumping attempts; a concurrent pass that loses the race sees no change and moves on.
    const claimed = await db.run(`UPDATE reminder_ledger SET attempts = attempts + 1, updated_at = ? WHERE id = ? AND attempts = ? AND status IN ('pending', 'failed')`,
      new Date().toISOString(), row.id, row.attempts);
    if (!claimed.changes) continue;
    result.attempted++;
    const attempts = row.attempts + 1;
    let outcome: SendOutcome;
    try {
      outcome = await send({ ...row, attempts });
    } catch (err) {
      outcome = { ok: false, error: (err as Error)?.message || String(err) };
    }
    const at = new Date().toISOString();
    if (outcome.ok) {
      await db.run(`UPDATE reminder_ledger SET status = 'sent', sent_at = ?, last_error = NULL, next_attempt_at = NULL, updated_at = ? WHERE id = ?`, at, at, row.id);
      await options.onSent?.(row);
      result.sent++;
      log.info(`Reminder delivered: ${row.kind} ${row.record_id} ${row.trigger}:${row.offset_days} (attempt ${attempts}) to ${row.recipients}`);
    } else if (outcome.skipped) {
      await db.run(`UPDATE reminder_ledger SET status = 'skipped', last_error = ?, next_attempt_at = NULL, updated_at = ? WHERE id = ?`, outcome.error ?? 'skipped', at, row.id);
      result.skipped++;
      log.info(`Reminder not sent: ${row.kind} ${row.record_id} ${row.trigger}:${row.offset_days}: ${outcome.error}`);
    } else if (attempts >= maxAttempts) {
      await db.run(`UPDATE reminder_ledger SET status = 'dead', last_error = ?, next_attempt_at = NULL, updated_at = ? WHERE id = ?`, outcome.error ?? 'unknown error', at, row.id);
      result.dead++;
      log.error(`Reminder abandoned after ${attempts} attempts: ${row.kind} ${row.record_id} ${row.trigger}:${row.offset_days}: ${outcome.error}`);
    } else {
      const retryAt = new Date(now.getTime() + backoffMs(attempts)).toISOString();
      await db.run(`UPDATE reminder_ledger SET status = 'failed', last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?`, outcome.error ?? 'unknown error', retryAt, at, row.id);
      result.failed++;
      log.warn(`Reminder delivery failed (attempt ${attempts}/${maxAttempts}), retry at ${retryAt}: ${row.kind} ${row.record_id} ${row.trigger}:${row.offset_days}: ${outcome.error}`);
    }
  }
  return result;
}

/**
 * One-time upgrade step: reminders the old code already created (notifications "Reminder 30d") enter the ledger as sent for the
 * record's current cycle, so the first scheduled pass does not repeat them.
 */
export async function seedLedgerFromLegacy(db: Sql, entries: Array<{ organizationId: string; kind: ReminderKind; recordId: string; cycleEnd: string; offsetDays: number }>) {
  const marker = 'reminder-ledger-seed-v1';
  if (await db.get('SELECT 1 FROM schema_migrations WHERE id = ?', marker)) return 0;
  let seeded = 0;
  await db.tx(async () => {
    const now = new Date().toISOString();
    for (const entry of entries) {
      const id = await enqueue(db, { ...entry, trigger: 'offset' });
      if (!id) continue;
      await db.run(`UPDATE reminder_ledger SET status = 'sent', sent_at = ?, next_attempt_at = NULL, last_error = 'legacy reminder (pre-ledger)', updated_at = ? WHERE id = ?`, now, now, id);
      seeded++;
    }
    await db.run('INSERT INTO schema_migrations (id, "appliedAt", summary) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING', marker, now, `seeded ${seeded}`);
  });
  return seeded;
}

/* ------------------------------ scheduler ------------------------------ */

export interface SchedulerOptions {
  enabled: boolean;
  /** Full pass (status refresh, enqueue, deliver). Default one day. */
  intervalMs: number;
  /** First pass after start. */
  startupDelayMs: number;
  /** Delivery-only pass so retries do not wait for the next full pass. */
  retryIntervalMs: number;
  fullPass: () => Promise<unknown>;
  retryPass: () => Promise<unknown>;
  /** Defaults to a PostgreSQL session advisory lock; tests may inject. */
  lock?: <T>(fn: () => Promise<T>) => Promise<{ ran: boolean; value?: T }>;
}

export const REMINDER_LOCK_KEY = 0x4c474c52; // "LGLR"

export function schedulerOptionsFromEnv(env: NodeJS.ProcessEnv, testMode: boolean): Pick<SchedulerOptions, 'enabled' | 'intervalMs' | 'startupDelayMs' | 'retryIntervalMs'> {
  const minutes = (name: string, fallback: number) => { const v = Number(env[name]); return Number.isFinite(v) && v > 0 ? v : fallback; };
  const flag = env.REMINDER_SCHEDULER_ENABLED?.trim().toLowerCase();
  return {
    enabled: !testMode && flag !== 'false' && flag !== '0',
    intervalMs: minutes('REMINDER_INTERVAL_MINUTES', 24 * 60) * 60_000,
    startupDelayMs: minutes('REMINDER_STARTUP_DELAY_SECONDS', 60) * 1000,
    retryIntervalMs: minutes('REMINDER_RETRY_INTERVAL_MINUTES', 15) * 60_000,
  };
}

export function createReminderScheduler(options: SchedulerOptions) {
  const timers = new Set<NodeJS.Timeout>();
  let stopped = true;
  let running: Promise<unknown> = Promise.resolve();
  const lock = options.lock ?? (<T>(fn: () => Promise<T>) => withAdvisoryLock(REMINDER_LOCK_KEY, fn));
  const guarded = (name: string, pass: () => Promise<unknown>) => async () => {
    try {
      const outcome = await lock(pass);
      if (!outcome.ran) log.info(`Reminder ${name} pass skipped: another instance holds the lock.`);
    } catch (err) {
      log.error(`Reminder ${name} pass failed:`, err);
    }
  };
  const loop = (delay: number, every: number, task: () => Promise<unknown>) => {
    const schedule = (ms: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (stopped) return;
        running = task().finally(() => { if (!stopped) schedule(every); });
      }, ms);
      timer.unref();
      timers.add(timer);
    };
    schedule(delay);
  };
  return {
    start() {
      if (!options.enabled || !stopped) return false;
      stopped = false;
      const full = guarded('full', options.fullPass);
      const retry = guarded('retry', options.retryPass);
      loop(options.startupDelayMs, options.intervalMs, full);
      loop(options.startupDelayMs + options.retryIntervalMs, options.retryIntervalMs, retry);
      log.info(`Reminder scheduler started (every ${Math.round(options.intervalMs / 60000)} min, first run in ${Math.round(options.startupDelayMs / 1000)} s).`);
      return true;
    },
    /** Stops scheduling and resolves once a pass in progress has finished. */
    async stop() {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      await running.catch(() => undefined);
    },
    runFull: guarded('full', options.fullPass),
    runRetry: guarded('retry', options.retryPass),
  };
}
