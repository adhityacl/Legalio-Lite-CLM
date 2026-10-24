import { withAdvisoryLock } from './db';
import { componentLog } from './logger';

const log = componentLog('jobs');

/**
 * A periodic background pass guarded by a PostgreSQL session advisory lock (same pattern as the reminder scheduler): every instance
 * runs the timer, only the one that gets the lock does the work, a pass never overlaps itself, and a failing pass is logged and retried
 * at the next tick. Ledgers and claims inside the pass make the work idempotent even if the lock is lost.
 */
export interface PeriodicJobOptions {
  name: string;
  lockKey: number;
  intervalMs: number;
  startupDelayMs?: number;
  enabled: boolean;
  run: () => Promise<unknown>;
  /** Tests may inject; defaults to the advisory lock. */
  lock?: <T>(fn: () => Promise<T>) => Promise<{ ran: boolean; value?: T }>;
}

export function createPeriodicJob(options: PeriodicJobOptions) {
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<unknown> = Promise.resolve();
  let stopped = true;
  const lock = options.lock ?? (<T>(fn: () => Promise<T>) => withAdvisoryLock(options.lockKey, fn));
  const pass = async () => {
    try {
      const outcome = await lock(options.run);
      if (!outcome.ran) log.debug(`${options.name} pass skipped: another instance holds the lock.`);
    } catch (err) {
      log.error(`${options.name} pass failed:`, err);
    }
  };
  const schedule = (ms: number) => {
    timer = setTimeout(() => {
      timer = null;
      if (stopped) return;
      running = pass().finally(() => { if (!stopped) schedule(options.intervalMs); });
    }, ms);
    timer.unref();
  };
  return {
    start() {
      if (!options.enabled || !stopped) return false;
      stopped = false;
      schedule(options.startupDelayMs ?? Math.min(options.intervalMs, 30_000));
      return true;
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await running.catch(() => undefined);
    },
    /** One pass now (still under the lock). */
    runOnce: pass,
  };
}

/** Background jobs follow the reminder scheduler's switches: off in test mode and with REMINDER_SCHEDULER_ENABLED=false. */
export function jobsEnabled(env: NodeJS.ProcessEnv, testMode: boolean) {
  const flag = env.REMINDER_SCHEDULER_ENABLED?.trim().toLowerCase();
  return !testMode && flag !== 'false' && flag !== '0';
}
