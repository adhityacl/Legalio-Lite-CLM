/** Digest preferences (every member, their own), the organization default (admins), the preview, and the public one-click unsubscribe. */
import express from 'express';
import type { Sql } from '../db';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { identityOf, sendError } from '../identity';
import { orgContextOf } from '../recordAccess';
import { auditActorFor } from '../organizationAdminRoutes';
import { appendAudit, readOrganizationSettings } from '../organizationSettingsStore';
import { DigestInputError, buildDigest, getDigestDefaults, getPreference, saveDigestDefaults, savePreference, unsubscribe, verifyUnsubscribeToken } from '../digest';

const PAGE: Record<string, { title: string; body: string; bad: string }> = {
  EN: { title: 'Unsubscribed', body: 'You will no longer receive the digest e-mail. You can turn it back on in Notifications.', bad: 'This unsubscribe link is not valid.' },
  ID: { title: 'Berhenti berlangganan', body: 'Anda tidak akan lagi menerima e-mail ringkasan. Anda dapat mengaktifkannya kembali di Notifikasi.', bad: 'Tautan berhenti berlangganan ini tidak valid.' },
  ZH: { title: '已退订', body: '您将不再收到摘要邮件。您可以在“通知”中重新开启。', bad: '此退订链接无效。' },
};
const page = (language: string, ok: boolean) => {
  const text = PAGE[language] ?? PAGE.EN;
  const message = ok ? text.body : text.bad;
  return `<!doctype html><html lang="${language.toLowerCase()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${text.title}</title></head><body style="font-family:Arial,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#0f172a"><h1 style="font-size:1.4rem">${ok ? text.title : '&#9888;'}</h1><p>${message}</p></body></html>`;
};

export function createOrgDigestRouter({ db }: { db: Sql }) {
  const router = express.Router();
  forwardAsyncRouteErrors(router);
  const base = '/organizations/:organizationId/digest';
  const guard = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) => async (req: express.Request, res: express.Response) => {
    try { await fn(req, res); } catch (err) {
      if (err instanceof DigestInputError) return sendError(req, res, err.status, err.code, err.message);
      throw err;
    }
  };

  router.get(`${base}/preferences`, guard(async (req, res) => {
    const ctx = orgContextOf(req);
    res.json(await getPreference(db, ctx.organizationId, ctx.userId));
  }));
  router.put(`${base}/preferences`, guard(async (req, res) => {
    const ctx = orgContextOf(req);
    const body = req.body ?? {};
    for (const key of Object.keys(body)) if (key !== 'frequency') throw new DigestInputError(`Unknown field: ${key}`);
    res.json(await savePreference(db, ctx.organizationId, ctx.userId, body.frequency));
  }));
  router.get(`${base}/preview`, guard(async (req, res) => {
    const ctx = orgContextOf(req);
    // Platform administrators managing an organization have no membership to build a digest for.
    const content = await buildDigest(db, ctx.organizationId, ctx.userId);
    if (!content) return sendError(req, res, 404, 'RESOURCE_NOT_FOUND', 'There is no digest for this account in this organization.');
    res.json(content);
  }));
  router.get(`${base}/defaults`, guard(async (req, res) => {
    res.json(await getDigestDefaults(db, orgContextOf(req).organizationId));
  }));
  router.put(`${base}/defaults`, guard(async (req, res) => {
    const ctx = orgContextOf(req);
    const saved = await db.tx(async () => {
      const result = await saveDigestDefaults(db, ctx.organizationId, req.body, ctx.userId);
      await appendAudit(db, auditActorFor(req, identityOf(req), ctx), { organizationId: ctx.organizationId, action: 'digest.defaults.update', targetType: 'digest_defaults', targetId: ctx.organizationId, outcome: 'success', changedFields: Object.keys(req.body ?? {}) });
      return result;
    });
    res.json(saved);
  }));

  // Public: possession of the signed token is the credential. GET so the link in the e-mail works with one click; POST for mail clients
  // that implement RFC 8058 one-click unsubscribe. Both are idempotent and answer the same for a valid token.
  const languageOf = async (token: unknown) => {
    const verified = verifyUnsubscribeToken(token);
    if (!verified) return 'EN';
    try { return (await readOrganizationSettings(db, verified.organizationId)).policy.language || 'EN'; } catch { return 'EN'; }
  };
  const secure = (res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  };
  router.get('/digest/unsubscribe', async (req, res) => {
    secure(res);
    const token = req.query.token;
    const done = await unsubscribe(db, token);
    res.status(done ? 200 : 400).type('html').send(page(await languageOf(token), Boolean(done)));
  });
  router.post('/digest/unsubscribe', async (req, res) => {
    secure(res);
    const done = await unsubscribe(db, req.query.token);
    if (!done) return sendError(req, res, 400, 'INVALID_TOKEN', 'This unsubscribe link is not valid.');
    res.json({ ok: true });
  });

  return router;
}
