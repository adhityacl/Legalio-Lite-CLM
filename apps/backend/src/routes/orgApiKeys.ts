/** Organization administrators manage the organization's API keys: create (the secret is returned once), list, revoke. All audited. */
import express from 'express';
import type { Sql } from '../db';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { identityOf, sendError } from '../identity';
import { orgContextOf } from '../recordAccess';
import { auditActorFor } from '../organizationAdminRoutes';
import { appendAudit } from '../organizationSettingsStore';
import { ApiKeyInputError, createApiKey, keyStatus, listApiKeys, revokeApiKey, type ApiKeyRecord } from '../apiKeys';

const present = (key: ApiKeyRecord) => ({ ...key, status: keyStatus(key) });

export function createOrgApiKeysRouter({ db }: { db: Sql }) {
  const router = express.Router();
  forwardAsyncRouteErrors(router);
  const base = '/organizations/:organizationId/api-keys';
  const guard = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) => async (req: express.Request, res: express.Response) => {
    try { await fn(req, res); } catch (err) {
      if (err instanceof ApiKeyInputError) return sendError(req, res, err.status, err.code, err.message);
      throw err;
    }
  };
  const audit = (req: express.Request, action: string, targetId: string, changedFields?: string[]) => {
    const ctx = orgContextOf(req);
    return appendAudit(db, auditActorFor(req, identityOf(req), ctx), { organizationId: ctx.organizationId, action, targetType: 'api_key', targetId, outcome: 'success', changedFields });
  };

  router.get(base, guard(async (req, res) => {
    res.json({ apiKeys: (await listApiKeys(db, orgContextOf(req).organizationId)).map(present) });
  }));

  router.post(base, guard(async (req, res) => {
    const ctx = orgContextOf(req);
    const { key, secret } = await db.tx(async () => {
      const created = await createApiKey(db, ctx.organizationId, ctx.userId, req.body);
      await audit(req, 'api_key.create', created.key.id, ['name', 'scopes', 'expiresAt', 'rateLimitPerMinute']);
      return created;
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ apiKey: present(key), secret });
  }));

  router.post(`${base}/:keyId/revoke`, guard(async (req, res) => {
    const ctx = orgContextOf(req);
    const revoked = await db.tx(async () => {
      if (!await revokeApiKey(db, ctx.organizationId, req.params.keyId, ctx.userId)) return null;
      await audit(req, 'api_key.revoke', req.params.keyId);
      return (await listApiKeys(db, ctx.organizationId)).find((key) => key.id === req.params.keyId)!;
    });
    if (!revoked) return sendError(req, res, 404, 'RESOURCE_NOT_FOUND', 'Resource not found.');
    res.json({ apiKey: present(revoked) });
  }));

  return router;
}
