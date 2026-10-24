/**
 * SSO routes. Public: provider lookup for the sign-in page, login start and the provider callback. Administrators (permission
 * `tenant.sso.manage`) configure the organization's provider; the client secret is sealed and never returned.
 */
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { serializeSignedCookie } from 'better-call';
import type { Sql } from '../db';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { identityOf, requestIdOf, sendError } from '../identity';
import { orgContextOf } from '../recordAccess';
import { auditActorFor } from '../organizationAdminRoutes';
import { appendAudit } from '../organizationSettingsStore';
import { getPublicBaseUrl } from '../installationSettings';
import { auth } from '../lib/auth';
import {
  SsoError, SsoLoginDenied, auditSso, completeSsoLogin, deleteSsoConfig, getSsoConfig, lookupSsoOrganizations, redirectUriFor, saveSsoConfig, startSsoLogin, testSsoConfig,
  STATE_TTL_MS,
} from '../sso';
import type { OidcDeps } from '../oidc';
import { componentLog } from '../logger';

const log = componentLog('sso');
const BINDING_COOKIE = 'legalio_sso_bind';

function readCookie(req: express.Request, name: string): string {
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(String(req.headers.cookie || ''));
  try { return match ? decodeURIComponent(match[1]) : ''; } catch { return ''; }
}

export function createSsoRouter({ db, deps = () => ({}) }: { db: Sql; deps?: () => OidcDeps }) {
  const router = express.Router();
  forwardAsyncRouteErrors(router);
  const limiter = process.env.RATE_LIMIT_DISABLED === 'true' || process.env.APP_TEST_MODE === '1'
    ? ((_req, _res, next) => next()) as express.RequestHandler
    : rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' } });
  const appUrl = (path: string) => `${getPublicBaseUrl().replace(/\/+$/, '')}${path}`;

  /* -------- public -------- */

  router.get('/sso/lookup', limiter, async (req, res) => {
    const email = typeof req.query.email === 'string' ? req.query.email : undefined;
    const slug = typeof req.query.slug === 'string' ? req.query.slug : undefined;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ organizations: email || slug ? await lookupSsoOrganizations(db, { email, slug }) : [] });
  });

  router.get('/sso/:slug/start', limiter, async (req, res) => {
    const fail = (code: string) => res.redirect(302, appUrl(`/?sso_error=${encodeURIComponent(code)}`));
    try {
      const redirectUri = redirectUriFor(req, getPublicBaseUrl());
      const started = await startSsoLogin(db, { slug: req.params.slug, redirectUri, returnTo: req.query.returnTo, loginHint: req.query.login_hint }, deps());
      res.cookie(BINDING_COOKIE, started.bindingToken, { httpOnly: true, sameSite: 'lax', secure: redirectUri.startsWith('https:'), path: '/api/sso', maxAge: STATE_TTL_MS });
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, started.location);
    } catch (err) {
      if (err instanceof SsoError) return fail(err.code === 'SSO_NOT_ENABLED' ? 'SSO_NOT_ENABLED' : 'SSO_PROVIDER_UNREACHABLE');
      throw err;
    }
  });

  router.get('/sso/callback', limiter, async (req, res) => {
    const requestId = requestIdOf(req);
    res.setHeader('Cache-Control', 'no-store');
    res.clearCookie(BINDING_COOKIE, { path: '/api/sso' });
    const redirectUri = redirectUriFor(req, getPublicBaseUrl());
    try {
      const done = await completeSsoLogin(db, {
        code: req.query.code, state: req.query.state, error: req.query.error, bindingToken: readCookie(req, BINDING_COOKIE), redirectUri,
      }, deps());
      const context = await auth.$context;
      let session;
      try {
        session = await context.internalAdapter.createSession(done.userId, false, {
          ipAddress: req.ip || '', userAgent: String(req.headers['user-agent'] || '').slice(0, 500), activeOrganizationId: done.organizationId,
        });
      } catch (err) {
        // Better Auth's session hooks refuse banned accounts.
        log.warn('SSO session refused:', (err as Error)?.message);
        await auditSso(db, requestId, done.organizationId, done.userId, 'sso.login_denied', 'denied', 'SSO_ACCOUNT_DISABLED');
        return res.redirect(302, appUrl('/?sso_error=SSO_ACCOUNT_DISABLED'));
      }
      if (!session) return res.redirect(302, appUrl('/?sso_error=SSO_ACCOUNT_DISABLED'));
      res.append('Set-Cookie', await serializeSignedCookie(context.authCookies.sessionToken.name, session.token, context.secret, {
        ...(context.authCookies.sessionToken.attributes as object), maxAge: context.sessionConfig.expiresIn,
      }));
      await auditSso(db, requestId, done.organizationId, done.userId, done.provisioned ? 'sso.provision' : done.linked ? 'sso.link' : 'sso.login', 'success');
      res.redirect(302, appUrl(done.returnTo));
    } catch (err) {
      if (err instanceof SsoLoginDenied) {
        await auditSso(db, requestId, err.organizationId, err.userId, 'sso.login_denied', 'denied', err.code);
        // Back to the organization's own sign-in page, where the message is shown next to the button to try again.
        const slug = err.organizationId ? (await db.get<{ slug: string }>(`SELECT slug FROM organization WHERE id = ?`, err.organizationId))?.slug : null;
        return res.redirect(302, appUrl(`${slug ? `/sso/${encodeURIComponent(slug)}` : '/'}?sso_error=${encodeURIComponent(err.code)}`));
      }
      throw err;
    }
  });

  /* -------- administration -------- */

  const base = '/organizations/:organizationId/sso';
  const guard = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) => async (req: express.Request, res: express.Response) => {
    try { await fn(req, res); } catch (err) {
      if (err instanceof SsoError) return sendError(req, res, err.status, err.code, err.message);
      throw err;
    }
  };
  const org = (req: express.Request) => orgContextOf(req).organizationId;
  const audit = (req: express.Request, action: string, changedFields?: string[]) => {
    const ctx = orgContextOf(req);
    return appendAudit(db, auditActorFor(req, identityOf(req), ctx), { organizationId: ctx.organizationId, action, targetType: 'sso', targetId: ctx.organizationId, outcome: 'success', changedFields });
  };

  router.get(base, guard(async (req, res) => {
    const slug = (await db.get<{ slug: string }>(`SELECT slug FROM organization WHERE id = ?`, org(req)))?.slug || '';
    res.setHeader('Cache-Control', 'no-store');
    res.json({ sso: await getSsoConfig(db, org(req)), redirectUri: redirectUriFor(req, getPublicBaseUrl()), loginPath: `/sso/${slug}`, slug });
  }));

  router.put(base, guard(async (req, res) => {
    const saved = await db.tx(async () => {
      const result = await saveSsoConfig(db, org(req), req.body, { actorUserId: identityOf(req).userId, deps: deps() });
      await audit(req, 'sso.configure', Object.keys(req.body ?? {}).filter((key) => key !== 'clientSecret').concat(req.body?.clientSecret ? ['clientSecret'] : []));
      return result;
    });
    res.json({ sso: saved });
  }));

  router.post(`${base}/test`, guard(async (req, res) => {
    res.json(await testSsoConfig(db, org(req), deps()));
  }));

  router.delete(base, guard(async (req, res) => {
    const removed = await db.tx(async () => {
      const ok = await deleteSsoConfig(db, org(req));
      if (ok) await audit(req, 'sso.delete');
      return ok;
    });
    if (!removed) return sendError(req, res, 404, 'RESOURCE_NOT_FOUND', 'Resource not found.');
    res.status(204).end();
  }));

  return router;
}
