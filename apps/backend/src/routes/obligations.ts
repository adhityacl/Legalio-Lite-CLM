/**
 * Obligations and key dates. Tenant-scoped; department roles see the obligations of records their departments own (the record scope
 * resolves an obligation through its contract, order or partner). Reads need `document.view`, writes `document.edit`, delete `document.delete`.
 * The list always answers a bare array with `X-Total-Count` (default page 50, at most 500), like the other paged lists.
 */
import express from 'express';
import { sql } from '../db';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { PublicError, sendApiError } from '../apiErrors';
import { validateBody } from '../validation';
import { requestedVersion } from '../requestVersion';
import { hasOrganizationScope } from '../rbac';
import { recordVisible } from '../recordScope';
import { assertRecordWritable, getRequestTenantId, logActivity, orgContextOf, scopeOf } from '../recordAccess';
import { getTenantSettings } from '../tenantPolicy';
import { todayInTimezone } from '@legalio/shared/policy';
import { addDays, DEFAULT_LEAD_DAYS, OBLIGATION_SOURCES, OBLIGATION_STATUSES, OBLIGATION_TYPES, type ObligationStatus } from '@legalio/shared/obligations';
import { OBLIGATION_SORTS, obligationRepository, presentObligation, type Obligation, type ObligationQuery } from '../repositories/obligationRepository';
import { completeObligation, createObligation, updateObligation } from '../obligations';
import * as schemas from '../obligationSchemas';

const queryText = (value: unknown, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const queryList = (value: unknown) => queryText(value, 500).split(',').map((v) => v.trim()).filter(Boolean).slice(0, 20);
const queryDate = (value: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(queryText(value, 10)) ? queryText(value, 10) : undefined);

/** The organization's calendar date today (its own time zone), the reference for "overdue". */
export const organizationToday = (organizationId: string) => todayInTimezone(getTenantSettings(organizationId).timezone);

/** The default reminder lead time: the organization's setting, else OBLIGATION_LEAD_DAYS, else 7. */
export async function leadDaysFor(organizationId: string): Promise<number> {
  const stored = (await obligationRepository.getSettings(organizationId)).leadDays;
  if (stored !== null) return stored;
  const env = Number(process.env.OBLIGATION_LEAD_DAYS);
  return Number.isInteger(env) && env >= 0 && env <= 365 ? env : DEFAULT_LEAD_DAYS;
}

export function createObligationsRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

  /** The caller's department owns the record the obligation is attached to, or the caller is the person responsible for it. */
  const isResponsible = (req: express.Request, row: Obligation) => Boolean(row.responsible_user_id) && row.responsible_user_id === actorId(req);
  const visible = (req: express.Request, row: Obligation) =>
    recordVisible(orgContextOf(req), scopeOf(req), 'obligation', { ...row, organizationId: row.organization_id }) || isResponsible(req, row);
  const notFound = (req: express.Request, res: express.Response) => sendApiError(req, res, 404, 'RESOURCE_NOT_FOUND', 'Resource not found.');
  const actorId = (req: express.Request) => (req as any).identity?.userId ?? orgContextOf(req).userId ?? null;

  function listQuery(req: express.Request, today: string): ObligationQuery & { limit: number } {
    const q = req.query;
    const sort = queryText(q.sort, 30);
    const status = queryList(q.status).filter((s): s is ObligationStatus => (OBLIGATION_STATUSES as readonly string[]).includes(s));
    const responsible = queryText(q.responsible, 100);
    return {
      q: queryText(q.q) || undefined,
      status: status.length ? status : undefined,
      type: queryList(q.type).filter((t) => (OBLIGATION_TYPES as readonly string[]).includes(t)),
      contractId: queryText(q.contract_id, 100) || undefined,
      ioId: queryText(q.io_id, 100) || undefined,
      partnerId: queryText(q.partner_id, 100) || undefined,
      responsibleUserId: responsible === 'me' ? String(actorId(req) ?? '') || undefined : responsible || undefined,
      department: queryText(q.department, 200) || undefined,
      source: (OBLIGATION_SOURCES as readonly string[]).includes(queryText(q.source, 20)) ? queryText(q.source, 20) : undefined,
      dueFrom: queryDate(q.due_from), dueTo: queryDate(q.due_to), today,
      sort: (OBLIGATION_SORTS as readonly string[]).includes(sort) ? sort as ObligationQuery['sort'] : 'due_date',
      dir: queryText(q.dir, 4).toLowerCase() === 'desc' ? 'desc' : 'asc',
      limit: Math.min(500, Math.max(1, Math.trunc(Number(q.limit)) || 50)),
      offset: Math.max(0, Math.trunc(Number(q.offset)) || 0),
    };
  }

  app.get('/api/obligations', async (req: express.Request, res: express.Response) => {
    const organizationId = getRequestTenantId(req);
    const today = organizationToday(organizationId);
    const query = listQuery(req, today);
    let rows: Obligation[];
    let total: number;
    if (hasOrganizationScope(orgContextOf(req))) {
      ({ rows, total } = await obligationRepository.list(organizationId, query));
    } else {
      // Department roles: the match is decided by record ownership, so filter first and page afterwards.
      const matched = (await obligationRepository.list(organizationId, { ...query, limit: undefined, offset: 0 })).rows.filter((row) => visible(req, row));
      total = matched.length;
      rows = matched.slice(query.offset ?? 0, (query.offset ?? 0) + query.limit);
    }
    res.setHeader('X-Total-Count', String(total));
    res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count');
    res.json(rows.map((row) => presentObligation(row, today)));
  });

  /** Dashboard figures: one SQL aggregate (department roles: counted over the obligations they may see). */
  app.get('/api/obligations/summary', async (req: express.Request, res: express.Response) => {
    const organizationId = getRequestTenantId(req);
    const today = organizationToday(organizationId);
    const weekEnd = addDays(today, 6);
    let ids: string[] | undefined;
    if (!hasOrganizationScope(orgContextOf(req))) {
      ids = (await obligationRepository.openDirectory(organizationId)).filter((row) => visible(req, { ...row, organization_id: organizationId })).map((row) => row.id);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ today, weekEnd, ...(await obligationRepository.summary(organizationId, today, weekEnd, ids)) });
  });

  app.get('/api/obligations/settings', async (req: express.Request, res: express.Response) => {
    const organizationId = getRequestTenantId(req);
    res.json({ leadDays: await leadDaysFor(organizationId), configured: (await obligationRepository.getSettings(organizationId)).leadDays !== null });
  });
  app.put('/api/obligations/settings', validateBody(schemas.obligationSettingsBody), async (req: express.Request, res: express.Response) => {
    const organizationId = getRequestTenantId(req);
    await obligationRepository.saveSettings(organizationId, req.body.leadDays, actorId(req));
    await logActivity(req, 'OBLIGATION_SETTINGS', 'OBLIGATIONS', `Set the obligation reminder lead time to ${req.body.leadDays} days`);
    res.json({ leadDays: req.body.leadDays, configured: true });
  });

  /** Active members who can be made responsible (id, name, e-mail). */
  app.get('/api/obligations/assignees', async (req: express.Request, res: express.Response) => {
    const rows = await sql.all<{ id: string; name: string; email: string }>(
      `SELECT u.id, u.name, u.email FROM member m JOIN "user" u ON u.id = m."userId"
       WHERE m."organizationId" = ? AND m.status = 'active' AND u.banned IS NOT TRUE ORDER BY lower(u.name), u.id LIMIT 500`, getRequestTenantId(req));
    res.json(rows);
  });

  app.get('/api/obligations/:id', async (req: express.Request, res: express.Response) => {
    const organizationId = getRequestTenantId(req);
    const row = await obligationRepository.get(organizationId, req.params.id);
    if (!row || !visible(req, row)) return notFound(req, res);
    res.json(presentObligation(row, organizationToday(organizationId)));
  });

  app.post('/api/obligations', validateBody(schemas.obligationCreateBody), async (req: express.Request, res: express.Response) => {
    const organizationId = getRequestTenantId(req);
    const candidate = { ...req.body, organization_id: organizationId };
    const denied = assertRecordWritable(req, 'obligation', { ...candidate, organizationId });
    if (denied) return res.status(denied.status).json(denied.body);
    const created = await createObligation(sql, organizationId, actorId(req), req.body);
    await logActivity(req, 'OBLIGATION_CREATE', 'OBLIGATIONS', `Created obligation '${created.title}'${created.due_date ? ` due ${created.due_date}` : ''}`);
    res.status(201).json({ success: true, obligation: presentObligation(created, organizationToday(organizationId)) });
  });

  app.put('/api/obligations/:id', validateBody(schemas.obligationUpdateBody), async (req: express.Request, res: express.Response) => {
    const organizationId = getRequestTenantId(req);
    const existing = await obligationRepository.get(organizationId, req.params.id);
    if (!existing || !visible(req, existing)) return notFound(req, res);
    const { version: clientVersion, ...patch } = req.body;
    const denied = assertRecordWritable(req, 'obligation', { ...existing, ...patch, organizationId });
    if (denied) return res.status(denied.status).json(denied.body);
    const expected = requestedVersion(req, clientVersion) ?? Number(existing.version);
    const updated = await updateObligation(sql, organizationId, req.params.id, expected, patch, actorId(req));
    await logActivity(req, 'OBLIGATION_UPDATE', 'OBLIGATIONS', `Updated obligation '${updated.title}'`);
    res.json({ success: true, obligation: presentObligation(updated, organizationToday(organizationId)) });
  });

  /** "Mark done": completes the occurrence; a recurring obligation rolls forward to its next date. */
  app.post('/api/obligations/:id/complete', validateBody(schemas.obligationCompleteBody), async (req: express.Request, res: express.Response) => {
    const organizationId = getRequestTenantId(req);
    const existing = await obligationRepository.get(organizationId, req.params.id);
    if (!existing || !visible(req, existing)) return notFound(req, res);
    // The person responsible may close their own obligation whatever department owns the record it is attached to.
    const denied = isResponsible(req, existing) ? null : assertRecordWritable(req, 'obligation', { ...existing, organizationId });
    if (denied) return res.status(denied.status).json(denied.body);
    const done = await completeObligation(sql, organizationId, req.params.id, actorId(req), requestedVersion(req, req.body?.version));
    await logActivity(req, 'OBLIGATION_COMPLETE', 'OBLIGATIONS', `Completed obligation '${done.title}'${done.status === 'open' ? ` (next due ${done.due_date})` : ''}`);
    res.json({ success: true, obligation: presentObligation(done, organizationToday(organizationId)) });
  });

  app.delete('/api/obligations/:id', async (req: express.Request, res: express.Response) => {
    const organizationId = getRequestTenantId(req);
    const existing = await obligationRepository.get(organizationId, req.params.id);
    if (!existing || !visible(req, existing)) return notFound(req, res);
    const denied = assertRecordWritable(req, 'obligation', { ...existing, organizationId });
    if (denied) return res.status(denied.status).json(denied.body);
    if (!(await obligationRepository.remove(organizationId, req.params.id))) throw new PublicError('Resource not found.', 404, 'RESOURCE_NOT_FOUND');
    await logActivity(req, 'OBLIGATION_DELETE', 'OBLIGATIONS', `Deleted obligation '${existing.title}'`);
    res.json({ success: true });
  });

  return app;
}
