/** The periodic passes added in Phase 3 (export, webhook delivery, approval SLA, digest). Started by server.ts init(), stopped by drain(). */
import { sql } from './db';
import { createPeriodicJob, jobsEnabled } from './jobScheduler';
import { EXPORT_LOCK_KEY, processExports } from './tenantExport';
import { getStore } from './uploadStorage';
import { IS_TEST_MODE } from './runtimePaths';
import { componentLog } from './logger';
import { outboundPolicyFromEnv } from './ssrfGuard';
import { WEBHOOK_LOCK_KEY, deliverDueWebhooks, onWebhookQueued, pruneDeliveries } from './webhooks';

const enabled = jobsEnabled(process.env, IS_TEST_MODE);

export const exportJob = createPeriodicJob({
  name: 'Export', lockKey: EXPORT_LOCK_KEY, intervalMs: 60_000, startupDelayMs: 20_000, enabled,
  run: () => processExports(sql, { store: getStore }),
});

let lastPrune = 0;
export const webhookJob = createPeriodicJob({
  name: 'Webhook delivery', lockKey: WEBHOOK_LOCK_KEY, intervalMs: 15_000, startupDelayMs: 10_000, enabled,
  run: async () => {
    await deliverDueWebhooks(sql);
    if (Date.now() - lastPrune > 6 * 3600_000) { lastPrune = Date.now(); await pruneDeliveries(sql); }
  },
});

const jobs = [exportJob, webhookJob];
export const startBackgroundJobs = () => {
  const policy = outboundPolicyFromEnv();
  if (process.env.NODE_ENV === 'production' && (policy.allowHttp || policy.allowPrivateNetworks)) {
    componentLog('jobs').warn('WEBHOOK_ALLOW_HTTP / WEBHOOK_ALLOW_PRIVATE_NETWORKS are set in production: webhooks can reach plain-http and internal addresses. These switches are for development only.');
  }
  for (const job of jobs) job.start();
  // A freshly queued event is delivered at once (still under the advisory lock) instead of at the next tick.
  if (enabled) onWebhookQueued(() => { void webhookJob.runOnce(); });
};
export const stopBackgroundJobs = async () => { onWebhookQueued(null); await Promise.all(jobs.map((job) => job.stop())); };
