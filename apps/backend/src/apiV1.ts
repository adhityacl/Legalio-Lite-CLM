/**
 * Public API v1 (API keys, no cookie sessions). The authorization middleware has already authenticated the key for the operation's scope
 * (routePolicies.ts, kind `apiKey`) and attached the key's organization context. Reads and writes are served by the existing record
 * routes through an in-process hand-off (same validation, number uniqueness, lifecycle, activity log, version check), with the response
 * reshaped to the v1 envelope; nothing here takes an organization from the request.
 */
import express from 'express';
import { forwardAsyncRouteErrors } from './asyncRoutes';
import { sendError, requestIdOf } from './identity';
import { orgContextOf } from './recordAccess';
import { requestedVersion } from './requestVersion';
import { createContractsRouter } from './routes/contracts';
import { createIoRouter } from './routes/io';
import { createPartnersRouter } from './routes/partners';
import { createSpendingsRouter } from './routes/spendings';
import { contractRepository } from './repositories/contractRepository';
import { ioRepository } from './repositories/ioRepository';
import { partnerRepository } from './repositories/partnerRepository';
import { spendingRepository } from './repositories/spendingRepository';
import { obligationRepository, presentObligation } from './repositories/obligationRepository';
import { createObligationsRouter, organizationToday } from './routes/obligations';
import { V1_OPERATIONS, type V1Operation, type V1Resource } from './apiV1Operations';
import { buildOpenApiDocument } from './apiV1OpenApi';

/** Fields a key must not send: file payloads and tokens belong to the interactive application. */
export const V1_DENIED_BODY_KEYS = ['fileData', 'fileName', 'accessToken', 'termination_document_file', 'invoice_file', 'billing_file', 'redline_analysis', 'redline_analyzed_at', 'dd_documents'];
const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

const repositories: Record<V1Resource, { get: (organizationId: string, id: string) => Promise<any> }> = {
  contracts: contractRepository, partners: partnerRepository, orders: ioRepository, spendings: spendingRepository, obligations: obligationRepository,
};

const defaultCode = (status: number) => (status === 400 ? 'INVALID_REQUEST' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'INSUFFICIENT_PERMISSION' : status === 404 ? 'RESOURCE_NOT_FOUND' : status === 409 ? 'CONFLICT' : 'REQUEST_FAILED');

/** The v1 error body: { error, code, message, status, requestId } like the rest of the API; legacy bodies are mapped onto it. */
function errorBody(req: express.Request, status: number, legacy: any) {
  const message = typeof legacy?.message === 'string' ? legacy.message : typeof legacy?.error === 'string' ? legacy.error : 'The request failed.';
  const code = typeof legacy?.code === 'string' ? legacy.code : typeof legacy?.error === 'string' && /^[A-Z][A-Z0-9_]+$/.test(legacy.error) ? legacy.error : defaultCode(status);
  return { error: message, code, message, status, requestId: requestIdOf(req), ...(Array.isArray(legacy?.issues) ? { issues: legacy.issues } : {}), ...(legacy?.details ? { details: legacy.details } : {}) };
}

export function createApiV1Router() {
  const router = express.Router();
  forwardAsyncRouteErrors(router);
  const legacy = express.Router();
  for (const factory of [createPartnersRouter, createContractsRouter, createIoRouter, createSpendingsRouter, createObligationsRouter]) legacy.use(factory());

  /** Runs the existing handler for `legacyPath` and reshapes its JSON answer. */
  const handOff = (req: express.Request, res: express.Response, next: express.NextFunction, legacyPath: string, shape: (status: number, body: any) => { status: number; body: unknown }, legacyMethod = req.method) => {
    const saved = { url: req.url, baseUrl: req.baseUrl, method: req.method };
    const restore = () => { req.url = saved.url; req.baseUrl = saved.baseUrl; req.method = saved.method; };
    req.method = legacyMethod;
    const json = res.json.bind(res);
    res.json = ((body: unknown) => {
      res.json = json;
      const shaped = shape(res.statusCode, body);
      res.status(shaped.status);
      return json(shaped.body);
    }) as typeof res.json;
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    req.url = legacyPath + query;
    req.baseUrl = '';
    legacy(req, res, (err?: unknown) => {
      restore();
      res.json = json;
      next(err ?? Object.assign(new Error('Not found'), { status: 404 }));
    });
  };

  const handlers: Record<string, express.RequestHandler> = {};
  const register = (operation: V1Operation, handler: express.RequestHandler) => {
    handlers[`${operation.method} ${operation.path}`] = handler;
  };

  for (const operation of V1_OPERATIONS) {
    const spec = operation.spec;
    if (operation.kind === 'whoami') {
      register(operation, (req, res) => {
        const ctx = orgContextOf(req);
        const key = (req as any).identity.apiKey;
        res.json({ data: { organizationId: ctx.organizationId, keyId: key.id, keyName: key.name, keyPrefix: key.prefix, scopes: key.scopes } });
      });
    } else if (spec && operation.kind === 'list') {
      register(operation, (req, res, next) => {
        const limit = Math.min(MAX_PAGE, Math.max(1, Math.trunc(Number(req.query.limit)) || DEFAULT_PAGE));
        const offset = Math.max(0, Math.trunc(Number(req.query.offset)) || 0);
        const params = new URLSearchParams();
        for (const [name, value] of Object.entries(req.query)) if (typeof value === 'string' && name !== 'limit' && name !== 'offset') params.set(name, value);
        params.set('limit', String(limit));
        params.set('offset', String(offset));
        req.url = `${req.path}?${params}`;
        handOff(req, res, next, spec.legacy, (status, body) => status >= 400 ? { status, body: errorBody(req, status, body) }
          : { status, body: { data: Array.isArray(body) ? body : [], total: Number(res.getHeader('X-Total-Count') ?? (Array.isArray(body) ? body.length : 0)), limit, offset } });
      });
    } else if (spec && operation.kind === 'get') {
      register(operation, async (req, res) => {
        const record = await repositories[spec.resource].get(orgContextOf(req).organizationId, req.params.id);
        if (!record) return sendError(req, res, 404, 'RESOURCE_NOT_FOUND', 'Resource not found.');
        const organizationId = orgContextOf(req).organizationId;
        res.json({ data: spec.resource === 'obligations' ? presentObligation(record, organizationToday(organizationId)) : record });
      });
    } else if (spec && operation.kind === 'create') {
      register(operation, (req, res, next) => {
        req.body = stripDenied(req.body);
        handOff(req, res, next, spec.legacy, (status, body) => status >= 400 ? { status, body: errorBody(req, status, body) } : { status: 201, body: { data: body?.[spec.responseKey] } });
      });
    } else if (spec && operation.kind === 'update') {
      register(operation, (req, res, next) => {
        const body = stripDenied(req.body);
        const version = requestedVersion(req, body?.version);
        if (version === undefined) {
          return void res.status(428).json({ ...errorBody(req, 428, { code: 'VERSION_REQUIRED', message: 'Send the record version you last read as "version" in the body or in the If-Match header.' }) });
        }
        req.body = { ...body, version };
        handOff(req, res, next, `${spec.legacy}/${encodeURIComponent(req.params.id)}`, (status, legacyBody) => status >= 400 ? { status, body: errorBody(req, status, legacyBody) } : { status, body: { data: legacyBody?.[spec.responseKey] } }, 'PUT');
      });
    }
  }

  const stripDenied = (body: unknown) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
    return Object.fromEntries(Object.entries(body as Record<string, unknown>).filter(([key]) => !V1_DENIED_BODY_KEYS.includes(key)));
  };

  // The OpenAPI document is public documentation.
  router.get('/api/v1/openapi.json', (req, res) => {
    const base = `${req.protocol}://${req.get('host')}`;
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(buildOpenApiDocument(base));
  });
  for (const operation of V1_OPERATIONS) {
    const handler = handlers[`${operation.method} ${operation.path}`];
    (router as any)[operation.method.toLowerCase()](operation.path, handler);
  }
  return router;
}
