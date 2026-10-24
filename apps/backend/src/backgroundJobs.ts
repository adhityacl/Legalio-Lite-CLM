/** The periodic passes added in Phase 3 (export, webhook delivery, approval SLA, digest). Started by server.ts init(), stopped by drain(). */
import { sql, withAdvisoryLock } from './db';
import { createPeriodicJob, jobsEnabled } from './jobScheduler';
import { EXPORT_LOCK_KEY, processExports } from './tenantExport';
import { getStore } from './uploadStorage';
import { IS_TEST_MODE } from './runtimePaths';
import { componentLog } from './logger';
import { DIGEST_LOCK_KEY, runDigestPass, type DigestDeps } from './digest';
import { APPROVAL_SLA_LOCK_KEY, deliverApprovalNotices, onApprovalNoticeQueued, runApprovalSlaPass, type ApprovalNoticeDeps } from './approvalNotifications';
import { OBLIGATION_LOCK_KEY, deliverObligationNotices, onObligationNoticeQueued, runObligationPass, type ObligationNoticeDeps } from './obligationJobs';
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

/** Production wiring of the approval mailer: the platform SMTP relay and the editable mail templates. */
async function approvalDeps(): Promise<ApprovalNoticeDeps> {
  const { mailTemplates, sendSmtpEmail } = await import('./mailHelpers');
  const { db: memory } = await import('./memoryDb');
  const { getPublicBaseUrl } = await import('./installationSettings');
  return {
    smtpAvailable: () => Boolean(memory.googleConfig?.smtpEnabled),
    send: async (input) => { const result = await sendSmtpEmail(input); return { success: Boolean(result?.success), error: result?.success ? undefined : String((result as { error?: unknown })?.error ?? '') }; },
    render: (id, values, trusted) => mailTemplates.render(id, values, trusted),
    publicUrl: () => getPublicBaseUrl() || process.env.PUBLIC_URL || '',
  };
}
export const approvalJob = createPeriodicJob({
  name: 'Approval notices and SLA', lockKey: APPROVAL_SLA_LOCK_KEY, intervalMs: 5 * 60_000, startupDelayMs: 45_000, enabled,
  run: async () => { await runApprovalSlaPass(sql); await deliverApprovalNotices(sql, await approvalDeps()); },
});

async function digestDeps(): Promise<DigestDeps> {
  const { mailTemplates, sendSmtpEmail } = await import('./mailHelpers');
  const { db: memory } = await import('./memoryDb');
  const { getPublicBaseUrl } = await import('./installationSettings');
  return {
    smtpAvailable: () => Boolean(memory.googleConfig?.smtpEnabled),
    send: async (input) => { const result = await sendSmtpEmail(input); return { success: Boolean(result?.success), error: result?.success ? undefined : String((result as { error?: unknown })?.error ?? '') }; },
    render: (values) => mailTemplates.render('digest', values, ['details']),
    publicUrl: () => getPublicBaseUrl() || process.env.PUBLIC_URL || '',
  };
}
/** Every 15 minutes: enqueue the digests whose send time has come (once per member and period) and deliver them. */
export const digestJob = createPeriodicJob({
  name: 'Digest', lockKey: DIGEST_LOCK_KEY, intervalMs: 15 * 60_000, startupDelayMs: 90_000, enabled,
  run: async () => { await runDigestPass(sql, await digestDeps()); },
});

async function obligationDeps(): Promise<ObligationNoticeDeps> {
  const { mailTemplates, sendSmtpEmail } = await import('./mailHelpers');
  const { db: memory } = await import('./memoryDb');
  const { getPublicBaseUrl } = await import('./installationSettings');
  return {
    smtpAvailable: () => Boolean(memory.googleConfig?.smtpEnabled),
    send: async (input) => { const result = await sendSmtpEmail(input); return { success: Boolean(result?.success), error: result?.success ? undefined : String((result as { error?: unknown })?.error ?? '') }; },
    render: (id, values, trusted) => mailTemplates.render(id, values, trusted),
    publicUrl: () => getPublicBaseUrl() || process.env.PUBLIC_URL || '',
  };
}
const obligationPass = async () => ({ pass: await runObligationPass(sql), delivery: await deliverObligationNotices(sql, await obligationDeps()) });
/** Every 15 minutes: raise the due-soon / overdue events that have come due and deliver their reminders (also the retry of failed ones). */
export const obligationJob = createPeriodicJob({
  name: 'Obligation reminders', lockKey: OBLIGATION_LOCK_KEY, intervalMs: 15 * 60_000, startupDelayMs: 100_000, enabled, run: obligationPass,
});
/** The same pass on demand (POST /api/cron/trigger-check), under the same advisory lock. */
export const runObligationReminders = () => withAdvisoryLock(OBLIGATION_LOCK_KEY, obligationPass);

const jobs = [exportJob, webhookJob, approvalJob, digestJob, obligationJob];
export const startBackgroundJobs = () => {
  const policy = outboundPolicyFromEnv();
  if (process.env.NODE_ENV === 'production' && (policy.allowHttp || policy.allowPrivateNetworks)) {
    componentLog('jobs').warn('WEBHOOK_ALLOW_HTTP / WEBHOOK_ALLOW_PRIVATE_NETWORKS are set in production: webhooks can reach plain-http and internal addresses. These switches are for development only.');
  }
  for (const job of jobs) job.start();
  // A freshly queued event is delivered at once (still under the advisory lock) instead of at the next tick.
  if (enabled) {
    onWebhookQueued(() => { void webhookJob.runOnce(); });
    onApprovalNoticeQueued(() => { void approvalJob.runOnce(); });
    onObligationNoticeQueued(() => { void obligationJob.runOnce(); });
  }
};
export const stopBackgroundJobs = async () => { onWebhookQueued(null); onApprovalNoticeQueued(null); onObligationNoticeQueued(null); await Promise.all(jobs.map((job) => job.stop())); };
