/** Organization administrators manage webhook endpoints, test them and read the delivery log. Secrets are shown once. All mutations are audited. */
import express from 'express';
import type { Sql } from '../db';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { identityOf, sendError } from '../identity';
import { orgContextOf } from '../recordAccess';
import { auditActorFor } from '../organizationAdminRoutes';
import { appendAudit } from '../organizationSettingsStore';
import {
  WEBHOOK_EVENTS, WebhookInputError, createEndpoint, deleteEndpoint, getDelivery, getEndpoint, listDeliveries, listEndpoints, retryDelivery, rotateSecret,
  sendTestDelivery, updateEndpoint, type WebhookDeps,
} from '../webhooks';

export function createOrgWebhooksRouter({ db, deps = () => ({}) }: { db: Sql; deps?: () => WebhookDeps }) {
  const router = express.Router();
  forwardAsyncRouteErrors(router);
  const base = '/organizations/:organizationId/webhooks';
  const guard = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) => async (req: express.Request, res: express.Response) => {
    try { await fn(req, res); } catch (err) {
      if (err instanceof WebhookInputError) return sendError(req, res, err.status, err.code, err.message);
      throw err;
    }
  };
  const notFound = (req: express.Request, res: express.Response) => sendError(req, res, 404, 'RESOURCE_NOT_FOUND', 'Resource not found.');
  const audit = (req: express.Request, action: string, targetId: string, changedFields?: string[]) => {
    const ctx = orgContextOf(req);
    return appendAudit(db, auditActorFor(req, identityOf(req), ctx), { organizationId: ctx.organizationId, action, targetType: 'webhook', targetId, outcome: 'success', changedFields });
  };
  const org = (req: express.Request) => orgContextOf(req).organizationId;

  router.get(base, guard(async (req, res) => {
    res.json({ webhooks: await listEndpoints(db, org(req)), eventTypes: WEBHOOK_EVENTS });
  }));

  router.post(base, guard(async (req, res) => {
    const ctx = orgContextOf(req);
    const created = await db.tx(async () => {
      const result = await createEndpoint(db, ctx.organizationId, ctx.userId, req.body, deps().policy);
      await audit(req, 'webhook.create', result.endpoint.id, ['url', 'eventTypes']);
      return result;
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ webhook: created.endpoint, secret: created.secret });
  }));

  router.patch(`${base}/:id`, guard(async (req, res) => {
    const updated = await db.tx(async () => {
      const result = await updateEndpoint(db, org(req), req.params.id, req.body, deps().policy);
      if (result) await audit(req, 'webhook.update', result.id, Object.keys(req.body ?? {}));
      return result;
    });
    if (!updated) return notFound(req, res);
    res.json({ webhook: updated });
  }));

  router.delete(`${base}/:id`, guard(async (req, res) => {
    const removed = await db.tx(async () => {
      const ok = await deleteEndpoint(db, org(req), req.params.id);
      if (ok) await audit(req, 'webhook.delete', req.params.id);
      return ok;
    });
    if (!removed) return notFound(req, res);
    res.status(204).end();
  }));

  router.post(`${base}/:id/rotate-secret`, guard(async (req, res) => {
    const secret = await db.tx(async () => {
      const value = await rotateSecret(db, org(req), req.params.id);
      if (value) await audit(req, 'webhook.rotate_secret', req.params.id);
      return value;
    });
    if (!secret) return notFound(req, res);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ secret });
  }));

  router.post(`${base}/:id/test`, guard(async (req, res) => {
    const result = await sendTestDelivery(db, org(req), req.params.id, deps());
    if (!result) return notFound(req, res);
    await audit(req, 'webhook.test', req.params.id);
    res.json(result);
  }));

  router.get(`${base}/:id/deliveries`, guard(async (req, res) => {
    if (!await getEndpoint(db, org(req), req.params.id)) return notFound(req, res);
    const status = typeof req.query.status === 'string' && ['pending', 'sent', 'failed', 'dead', 'skipped'].includes(req.query.status) ? req.query.status : undefined;
    res.json(await listDeliveries(db, org(req), req.params.id, { status, limit: Number(req.query.limit) || undefined, offset: Number(req.query.offset) || undefined }));
  }));

  router.get(`${base}/:id/deliveries/:deliveryId`, guard(async (req, res) => {
    const delivery = await getDelivery(db, org(req), req.params.id, req.params.deliveryId);
    if (!delivery) return notFound(req, res);
    res.json({ delivery });
  }));

  router.post(`${base}/:id/deliveries/:deliveryId/retry`, guard(async (req, res) => {
    if (!await retryDelivery(db, org(req), req.params.id, req.params.deliveryId)) return sendError(req, res, 404, 'RESOURCE_NOT_FOUND', 'No retryable delivery with this id.');
    await audit(req, 'webhook.delivery_retry', req.params.deliveryId);
    res.status(202).json({ ok: true });
  }));

  return router;
}
