/** Approval SLA settings (organization admins) and the caller's own in-app notifications. */
import express from 'express';
import type { Sql } from '../db';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { identityOf, sendError } from '../identity';
import { orgContextOf } from '../recordAccess';
import { auditActorFor } from '../organizationAdminRoutes';
import { appendAudit } from '../organizationSettingsStore';
import { ApprovalSettingsError, getApprovalSettings, listInbox, markInboxRead, saveApprovalSettings } from '../approvalNotifications';

export function createOrgApprovalsRouter({ db }: { db: Sql }) {
  const router = express.Router();
  forwardAsyncRouteErrors(router);
  const base = '/organizations/:organizationId';

  router.get(`${base}/approval-settings`, async (req, res) => {
    res.json(await getApprovalSettings(db, orgContextOf(req).organizationId));
  });

  router.put(`${base}/approval-settings`, async (req, res) => {
    const ctx = orgContextOf(req);
    try {
      const saved = await db.tx(async () => {
        const settings = await saveApprovalSettings(db, ctx.organizationId, req.body, ctx.userId);
        await appendAudit(db, auditActorFor(req, identityOf(req), ctx), { organizationId: ctx.organizationId, action: 'approval.settings.update', targetType: 'approval_settings', targetId: ctx.organizationId, outcome: 'success', changedFields: Object.keys(req.body ?? {}) });
        return settings;
      });
      res.json(saved);
    } catch (err) {
      if (err instanceof ApprovalSettingsError) return sendError(req, res, err.status, err.code, err.message);
      throw err;
    }
  });

  // Only the caller's own entries: the user id comes from the verified context, never from the request.
  router.get(`${base}/my-notifications`, async (req, res) => {
    const ctx = orgContextOf(req);
    res.json(await listInbox(db, ctx.organizationId, ctx.userId));
  });

  router.post(`${base}/my-notifications/read`, async (req, res) => {
    const ctx = orgContextOf(req);
    const body = req.body ?? {};
    const ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown) => typeof id === 'string').slice(0, 200) : undefined;
    if (!ids && body.all !== true) return sendError(req, res, 400, 'INVALID_INPUT', 'Send "ids" or "all": true.');
    res.json({ updated: await markInboxRead(db, ctx.organizationId, ctx.userId, body.all === true ? undefined : ids) });
  });

  return router;
}
