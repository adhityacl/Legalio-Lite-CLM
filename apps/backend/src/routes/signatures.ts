/**
 * E-signature routes.
 *  - Tenant API (`/api/signatures...`): requests on a contract, status timeline, manual progress (mark signed / declined / signed copy / evidence), cancel and resend.
 *    Reads need `document.view`, writes `document.edit`, and the caller must be able to see (and for writes, change) the contract.
 *  - Inbound webhook (`POST /api/signatures/webhook/:endpointId`): public route, authenticated by an HMAC over the raw body (see signatures.ts `receiveInbound`).
 *  - Endpoint administration (`/api/organizations/:id/signature-endpoints`, permission `tenant.signature.manage`): create, rename, disable, rotate the secret, delete.
 */
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { sql } from '../db';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { sendApiError } from '../apiErrors';
import { identityOf, sendError } from '../identity';
import { hasOrganizationScope } from '../rbac';
import { assertRecordAccess, assertRecordWritable, getRequestTenantId, orgContextOf, scopedRecords } from '../recordAccess';
import { auditActorFor } from '../organizationAdminRoutes';
import { appendAudit } from '../organizationSettingsStore';
import { getPublicBaseUrl } from '../installationSettings';
import { contractRepository } from '../repositories/contractRepository';
import { listSignatureProviders } from '../signatureProviders';
import { SIGNATURE_STATUSES, isSignatureStatus } from '../signatureStates';
import {
  MAX_FILE_BYTES, SignatureError, addFiles, cancelRequest, completeWithSignedCopy, createEndpoint, createRequest, deleteEndpoint, getRequest, getRequestRow, listEndpoints, listRequests,
  parseFileInput, readFile, receiveInbound, resendRequest, rotateEndpointSecret, sendRequest, signerDeclined, signerSigned, toDto, updateEndpoint, type Actor,
} from '../signatures';

const queryText = (value: unknown, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function createSignaturesRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);
  const actorOf = (req: express.Request): Actor => {
    const identity = identityOf(req);
    return { id: identity.userId, label: `user:${identity.userId}`, email: identity.email, name: identity.name, req };
  };
  const notFound = (req: express.Request, res: express.Response) => sendApiError(req, res, 404, 'RESOURCE_NOT_FOUND', 'Resource not found.');
  const parsedFile = (raw: any, kind: 'signed' | 'evidence') => ({ file: parseFileInput(raw?.fileData ?? raw?.contentBase64, kind), name: raw?.fileName });

  /** The request and its contract, only when the caller can see that contract; otherwise null (a 404 for the caller). */
  async function visibleRequest(req: express.Request, id: string, write = false) {
    const organizationId = getRequestTenantId(req);
    const row = await getRequestRow(sql, organizationId, id);
    if (!row) return null;
    const contract = await contractRepository.get(organizationId, row.contract_id);
    if (!contract || assertRecordAccess(req, 'contract', contract)) return null;
    if (write) {
      const denied = assertRecordWritable(req, 'contract', contract);
      if (denied) throw new SignatureError(denied.status, 'INSUFFICIENT_PERMISSION', 'You cannot change this contract.');
    }
    return { organizationId, row, contract };
  }

  app.get('/api/signatures/providers', (_req, res) => { res.json(listSignatureProviders()); });

  app.get('/api/signatures', async (req, res) => {
    const organizationId = getRequestTenantId(req);
    const contractId = queryText(req.query.contract_id, 100);
    const status = queryText(req.query.status, 200).split(',').map((value) => value.trim()).filter(isSignatureStatus);
    let contractIds: string[] | undefined;
    if (contractId) {
      const contract = await contractRepository.get(organizationId, contractId);
      if (!contract || assertRecordAccess(req, 'contract', contract)) return notFound(req, res);
    } else if (!hasOrganizationScope(orgContextOf(req))) {
      contractIds = (await scopedRecords(req, 'contract')).map((contract: any) => contract.contract_id);
    }
    const { rows, total } = await listRequests(sql, organizationId, { contractId: contractId || undefined, contractIds, status: status.length ? status : undefined, limit: Number(req.query.limit), offset: Number(req.query.offset) });
    res.setHeader('X-Total-Count', String(total));
    res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count');
    res.json(await Promise.all(rows.map((row) => toDto(sql, row))));
  });

  app.get('/api/signatures/:id', async (req, res) => {
    const found = await visibleRequest(req, req.params.id);
    if (!found) return notFound(req, res);
    res.json({ request: await getRequest(sql, found.organizationId, req.params.id) });
  });

  app.post('/api/signatures', async (req, res) => {
    const organizationId = getRequestTenantId(req);
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const contractId = queryText(body.contract_id ?? body.contractId, 100);
    const contract = contractId ? await contractRepository.get(organizationId, contractId) : undefined;
    if (!contract || assertRecordAccess(req, 'contract', contract)) return notFound(req, res);
    const denied = assertRecordWritable(req, 'contract', contract);
    if (denied) return res.status(denied.status).json(denied.body);
    const request = await createRequest(sql, organizationId, contract, { ...body, contractId }, actorOf(req));
    res.status(201).json({ success: true, request });
  });

  app.post('/api/signatures/:id/send', async (req, res) => {
    const found = await visibleRequest(req, req.params.id, true);
    if (!found) return notFound(req, res);
    res.json({ success: true, request: await sendRequest(sql, found.organizationId, req.params.id, actorOf(req)) });
  });
  app.post('/api/signatures/:id/resend', async (req, res) => {
    const found = await visibleRequest(req, req.params.id, true);
    if (!found) return notFound(req, res);
    res.json({ success: true, request: await resendRequest(sql, found.organizationId, req.params.id, actorOf(req)) });
  });
  app.post('/api/signatures/:id/cancel', async (req, res) => {
    const found = await visibleRequest(req, req.params.id, true);
    if (!found) return notFound(req, res);
    res.json({ success: true, request: await cancelRequest(sql, found.organizationId, req.params.id, actorOf(req), req.body?.reason) });
  });

  // Manual progress: the person records what happened outside Legalio.
  app.post('/api/signatures/:id/signers/:signerId/signed', async (req, res) => {
    const found = await visibleRequest(req, req.params.id, true);
    if (!found) return notFound(req, res);
    const evidence = req.body?.fileData ? [parsedFile(req.body, 'evidence')] : [];
    const outcome = await signerSigned(sql, found.organizationId, req.params.id, { signerId: req.params.signerId }, actorOf(req), { evidence: evidence.map((item) => ({ file: item.file, name: item.name })), enforceOrder: true });
    res.json({ success: true, duplicate: outcome.duplicate, request: outcome.request });
  });
  app.post('/api/signatures/:id/signers/:signerId/declined', async (req, res) => {
    const found = await visibleRequest(req, req.params.id, true);
    if (!found) return notFound(req, res);
    res.json({ success: true, request: await signerDeclined(sql, found.organizationId, req.params.id, { signerId: req.params.signerId }, actorOf(req), req.body?.reason) });
  });
  app.post('/api/signatures/:id/complete', async (req, res) => {
    const found = await visibleRequest(req, req.params.id, true);
    if (!found) return notFound(req, res);
    const signed = parsedFile(req.body, 'signed');
    const evidence = (Array.isArray(req.body?.evidence) ? req.body.evidence.slice(0, 5) : []).map((item: any) => parsedFile(item, 'evidence'));
    res.json({ success: true, request: await completeWithSignedCopy(sql, found.organizationId, req.params.id, actorOf(req), { file: signed.file, fileName: signed.name, evidence: evidence.map((e: any) => ({ file: e.file, name: e.name })) }) });
  });
  app.post('/api/signatures/:id/files', async (req, res) => {
    const found = await visibleRequest(req, req.params.id, true);
    if (!found) return notFound(req, res);
    const list = Array.isArray(req.body?.files) ? req.body.files : [req.body];
    const items = list.slice(0, 6).map((item: any) => {
      const kind = item?.kind === 'signed' ? 'signed' : 'evidence';
      const parsed = parsedFile(item, kind);
      return { kind: kind as 'signed' | 'evidence', file: parsed.file, name: parsed.name };
    });
    res.status(201).json({ success: true, request: await addFiles(sql, found.organizationId, req.params.id, actorOf(req), items) });
  });
  app.get('/api/signatures/:id/files/:fileId', async (req, res) => {
    const found = await visibleRequest(req, req.params.id);
    if (!found) return notFound(req, res);
    const file = await readFile(sql, found.organizationId, req.params.id, req.params.fileId);
    if (!file) return notFound(req, res);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.row.file_name)}`);
    res.type(file.row.content_type).send(file.body);
  });

  /* -------- inbound webhook (public; the HMAC is the authentication) -------- */

  const limiter = process.env.RATE_LIMIT_DISABLED === 'true' || process.env.APP_TEST_MODE === '1'
    ? ((_req, _res, next) => next()) as express.RequestHandler
    : rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'RATE_LIMITED', code: 'RATE_LIMITED', message: 'Too many requests.' } });
  app.post('/api/signatures/webhook/:endpointId', limiter, async (req, res) => {
    const raw: Buffer | undefined = (req as any).rawBody;
    res.setHeader('Cache-Control', 'no-store');
    if (!raw || !raw.length) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', message: 'The body must be JSON.' });
    const outcome = await receiveInbound(sql, req.params.endpointId, raw, req.headers);
    res.status(outcome.status).json(outcome.body);
  });

  /* -------- endpoint administration -------- */

  const base = '/api/organizations/:organizationId/signature-endpoints';
  const org = (req: express.Request) => orgContextOf(req).organizationId;
  const audit = (req: express.Request, action: string, targetId: string, changedFields?: string[]) => {
    const ctx = orgContextOf(req);
    return appendAudit(sql, auditActorFor(req, identityOf(req), ctx), { organizationId: ctx.organizationId, action, targetType: 'signature_endpoint', targetId, outcome: 'success', changedFields });
  };
  const urlOf = (req: express.Request, id: string) => `${(getPublicBaseUrl() || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '')}/api/signatures/webhook/${id}`;
  const withUrl = (req: express.Request, endpoint: any) => ({ ...endpoint, url: urlOf(req, endpoint.id) });

  app.get(base, async (req, res) => {
    res.json({ endpoints: (await listEndpoints(sql, org(req))).map((endpoint) => withUrl(req, endpoint)), providers: listSignatureProviders(), maxFileBytes: MAX_FILE_BYTES(), statuses: SIGNATURE_STATUSES });
  });
  app.post(base, async (req, res) => {
    const created = await sql.tx(async () => {
      const result = await createEndpoint(sql, org(req), identityOf(req).userId, req.body);
      await audit(req, 'signature_endpoint.create', result.endpoint.id, ['name']);
      return result;
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ endpoint: withUrl(req, created.endpoint), secret: created.secret });
  });
  app.patch(`${base}/:id`, async (req, res) => {
    const updated = await sql.tx(async () => {
      const result = await updateEndpoint(sql, org(req), req.params.id, req.body);
      if (result) await audit(req, 'signature_endpoint.update', result.id, Object.keys(req.body ?? {}));
      return result;
    });
    if (!updated) return sendError(req, res, 404, 'RESOURCE_NOT_FOUND', 'Resource not found.');
    res.json({ endpoint: withUrl(req, updated) });
  });
  app.delete(`${base}/:id`, async (req, res) => {
    const removed = await sql.tx(async () => {
      const ok = await deleteEndpoint(sql, org(req), req.params.id);
      if (ok) await audit(req, 'signature_endpoint.delete', req.params.id);
      return ok;
    });
    if (!removed) return sendError(req, res, 404, 'RESOURCE_NOT_FOUND', 'Resource not found.');
    res.status(204).end();
  });
  app.post(`${base}/:id/rotate-secret`, async (req, res) => {
    const secret = await sql.tx(async () => {
      const value = await rotateEndpointSecret(sql, org(req), req.params.id);
      if (value) await audit(req, 'signature_endpoint.rotate_secret', req.params.id);
      return value;
    });
    if (!secret) return sendError(req, res, 404, 'RESOURCE_NOT_FOUND', 'Resource not found.');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ secret });
  });

  return app;
}
