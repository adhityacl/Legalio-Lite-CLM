import { listActivity } from '../activityLog';
import { sql } from '../db';
import { getRequestTenantId } from '../recordAccess';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
export function createActivityLogsRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

/** Operational activity for the selected organization only (History drawer, tenant.audit.read). */
app.get("/api/activity-logs", async (req: express.Request, res: express.Response) => {
  const page = await listActivity(sql, getRequestTenantId(req), { limit: req.query.limit, offset: req.query.offset });
  // Body stays the array older clients expect (newest first); paging metadata travels in headers.
  res.set({ "X-Total-Count": String(page.total), "X-Limit": String(page.limit), "X-Offset": String(page.offset) });
  res.json(page.rows);
});
  return app;
}
