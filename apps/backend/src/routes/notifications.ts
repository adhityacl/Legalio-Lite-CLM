import { scopedRecords, orgContextOf } from '../recordAccess';
import { db, saveDb } from '../memoryDb';
import { withAdvisoryLock } from '../db';
import { REMINDER_LOCK_KEY } from '../reminders';
import { runReminderPass } from '../reminderJobs';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
export function createNotificationsRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

app.get("/api/notification-logs", async (req: express.Request, res: express.Response) => {
  res.json(await scopedRecords(req, "notification"));
});
/**
 * Matches in-memory notifications the caller may touch. scopedRecords re-reads rows from the database,
 * so this matches by organization + notif_id; object identity never matches db.notifications.
 */
async function visibleNotificationFilter(req: express.Request) {
  const org = orgContextOf(req).organizationId;
  const ids = new Set((await scopedRecords(req, "notification")).map((n: any) => n.notif_id));
  return { has: (n: any) => n.organizationId === org && ids.has(n.notif_id) };
}
/** Only notifications attached to records the caller can see are touched (PRD §4.5.2). */
app.post("/api/notification-logs/mark-read", async (req: express.Request, res: express.Response) => {
  const { notif_id, markAll } = req.body || {};
  const visible = await visibleNotificationFilter(req);
  db.notifications = (db.notifications || []).map((n) =>
    visible.has(n) && (markAll || (notif_id && n.notif_id === notif_id)) ? { ...n, is_read: true } : n,
  );
  await saveDb();
  res.json({ success: true, notifications: await scopedRecords(req, "notification") });
});
app.post("/api/notification-logs/delete", async (req: express.Request, res: express.Response) => {
  const { notif_id, notif_ids, deleteAll } = req.body || {};
  const visible = await visibleNotificationFilter(req);
  const chosen = new Set<string>(Array.isArray(notif_ids) ? notif_ids : notif_id ? [notif_id] : []);
  db.notifications = (db.notifications || []).filter((n) => !(visible.has(n) && (deleteAll || chosen.has(n.notif_id))));
  await saveDb();
  res.json({ success: true, notifications: await scopedRecords(req, "notification") });
});
app.post("/api/cron/trigger-check", async (req: express.Request, res: express.Response) => {
  // Same pass as the scheduler, under the same lock: a concurrent run on another instance makes this one a no-op.
  const outcome = await withAdvisoryLock(REMINDER_LOCK_KEY, runReminderPass);
  if (!outcome.ran) return res.status(202).json({ success: true, newNotificationsGenerated: 0, skipped: "another reminder pass is running" });
  const { queued, delivery } = outcome.value!;
  res.json({ success: true, newNotificationsGenerated: queued, delivery });
});
  return app;
}
