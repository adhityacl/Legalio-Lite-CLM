/** The periodic passes added in Phase 3 (export, webhook delivery, approval SLA, digest). Started by server.ts init(), stopped by drain(). */
import { sql } from './db';
import { createPeriodicJob, jobsEnabled } from './jobScheduler';
import { EXPORT_LOCK_KEY, processExports } from './tenantExport';
import { getStore } from './uploadStorage';
import { IS_TEST_MODE } from './runtimePaths';

const enabled = jobsEnabled(process.env, IS_TEST_MODE);

export const exportJob = createPeriodicJob({
  name: 'Export', lockKey: EXPORT_LOCK_KEY, intervalMs: 60_000, startupDelayMs: 20_000, enabled,
  run: () => processExports(sql, { store: getStore }),
});

const jobs = [exportJob];
export const startBackgroundJobs = () => { for (const job of jobs) job.start(); };
export const stopBackgroundJobs = async () => { await Promise.all(jobs.map((job) => job.stop())); };
