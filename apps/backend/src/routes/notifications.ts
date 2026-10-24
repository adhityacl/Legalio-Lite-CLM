import { scopedRecords, orgContextOf } from '../recordAccess';
import { notificationRepository } from '../repositories/notificationRepository';
import { withAdvisoryLock } from '../db';
import { REMINDER_LOCK_KEY } from '../reminders';
import { runReminderPass } from '../reminderJobs';
import { runObligationReminders, runSignaturePass } from '../backgroundJobs';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
export function createNotificationsRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

app.get("/api/notification-logs", async (req: express.Request, res: express.Response) => {
  res.json(await scopedRecords(req, "notification"));
});
/** Ids of the notifications the caller may touch: attached to records they can see (PRD §4.5.2). */
async function visibleNotificationIds(req: express.Request): Promise<string[]> {
  return (await scopedRecords(req, "notification")).map((n: any) => n.notif_id);
}
app.post("/api/notification-logs/mark-read", async (req: express.Request, res: express.Response) => {
  const { notif_id, markAll } = req.body || {};
  const org = orgContextOf(req).organizationId;
  const visible = await visibleNotificationIds(req);
  const chosen = markAll ? visible : notif_id ? visible.filter((id) => id === notif_id) : [];
  await notificationRepository.markRead(org, chosen);
  res.json({ success: true, notifications: await scopedRecords(req, "notification") });
});
app.post("/api/notification-logs/delete", async (req: express.Request, res: express.Response) => {
  const { notif_id, notif_ids, deleteAll } = req.body || {};
  const org = orgContextOf(req).organizationId;
  const visible = await visibleNotificationIds(req);
  const wanted = new Set<string>(Array.isArray(notif_ids) ? notif_ids : notif_id ? [notif_id] : []);
  await notificationRepository.removeMany(org, deleteAll ? visible : visible.filter((id) => wanted.has(id)));
  res.json({ success: true, notifications: await scopedRecords(req, "notification") });
});
app.post("/api/cron/trigger-check", async (req: express.Request, res: express.Response) => {
  // Same pass as the scheduler, under the same lock: a concurrent run on another instance makes this one a no-op.
  const outcome = await withAdvisoryLock(REMINDER_LOCK_KEY, runReminderPass);
  if (!outcome.ran) return res.status(202).json({ success: true, newNotificationsGenerated: 0, skipped: "another reminder pass is running" });
  const { queued, delivery } = outcome.value!;
  // The obligation reminder pass (due soon / overdue) runs on demand too, under its own lock.
  const obligations = await runObligationReminders();
  const signatures = await runSignaturePass();
  res.json({ success: true, newNotificationsGenerated: queued, delivery, obligations: obligations.ran ? obligations.value : { skipped: 'another obligation pass is running' },
    signatures: signatures.ran ? signatures.value : { skipped: 'another signature pass is running' } });
});
  return app;
}
