/**
 * Tenant data export API (organization administrators): queue an export, poll its status, download the ZIP until it expires.
 * Every route is declared in routePolicies.ts (permission tenant.data.export; the organization is the path segment) and audited.
 */
import express from 'express';
import type { Sql } from '../db';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { identityOf, sendError } from '../identity';
import { orgContextOf } from '../recordAccess';
import { auditActorFor } from '../organizationAdminRoutes';
import { ApiError, appendAudit, invalid } from '../organizationSettingsStore';
import { ExportError, createExportJob, exportChunks, getExportJob, isDownloadable, listExportJobs, processExports, type ExportDeps, type ExportJob } from '../tenantExport';
import { componentLog } from '../logger';

const log = componentLog('dataExport');

export interface DataExportRouterOptions { db: Sql; deps: () => ExportDeps; autoRun?: boolean }

export function createDataExportRouter({ db, deps, autoRun = true }: DataExportRouterOptions) {
  const router = express.Router();
  forwardAsyncRouteErrors(router);
  const base = '/organizations/:organizationId/exports';
  const respond = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) => async (req: express.Request, res: express.Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof ExportError || err instanceof ApiError) return sendError(req, res, err.status, err instanceof ExportError ? err.code : err.error, err.message);
      throw err;
    }
  };
  const present = (organizationId: string, job: ExportJob) => ({
    ...job,
    downloadUrl: isDownloadable(job) ? `/api/organizations/${encodeURIComponent(organizationId)}/exports/${encodeURIComponent(job.id)}/download` : null,
  });
  const audit = (req: express.Request, action: string, targetId: string) => {
    const ctx = orgContextOf(req);
    return appendAudit(db, auditActorFor(req, identityOf(req), ctx), { organizationId: ctx.organizationId, action, targetType: 'export', targetId, outcome: 'success' });
  };

  router.post(base, respond(async (req, res) => {
    const ctx = orgContextOf(req);
    const body = req.body ?? {};
    if (typeof body !== 'object' || Array.isArray(body)) throw invalid('Request body must be an object.');
    for (const key of Object.keys(body)) if (key !== 'includeFiles') throw invalid(`Unknown field: ${key}`);
    if (body.includeFiles !== undefined && typeof body.includeFiles !== 'boolean') throw invalid('includeFiles must be true or false.');
    const job = await db.tx(async () => {
      const created = await createExportJob(db, { organizationId: ctx.organizationId, requestedBy: ctx.userId, includeFiles: body.includeFiles === true });
      await audit(req, body.includeFiles === true ? 'export.request.with_files' : 'export.request', created.id);
      return created;
    });
    // The job starts at once in this process; the periodic pass picks up whatever is left (restart, other instance).
    if (autoRun) setImmediate(() => { processExports(db, deps()).catch((err) => log.error('Export pass failed:', err)); });
    res.status(202).json(present(ctx.organizationId, job));
  }));

  router.get(base, respond(async (req, res) => {
    const ctx = orgContextOf(req);
    res.json({ exports: (await listExportJobs(db, ctx.organizationId)).map((job) => present(ctx.organizationId, job)) });
  }));

  router.get(`${base}/:jobId`, respond(async (req, res) => {
    const ctx = orgContextOf(req);
    const job = await getExportJob(db, ctx.organizationId, req.params.jobId);
    if (!job) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource not found.');
    res.json(present(ctx.organizationId, job));
  }));

  router.get(`${base}/:jobId/download`, respond(async (req, res) => {
    const ctx = orgContextOf(req);
    const job = await getExportJob(db, ctx.organizationId, req.params.jobId);
    if (!job) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource not found.');
    if (job.status === 'expired' || (job.status === 'succeeded' && !isDownloadable(job))) throw new ExportError(410, 'EXPORT_EXPIRED', 'This export has expired. Request a new one.');
    if (!isDownloadable(job)) throw new ExportError(409, 'EXPORT_NOT_READY', 'This export is not ready for download.');
    await audit(req, 'export.download', job.id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="legalio-export-${job.createdAt.slice(0, 10)}.zip"`);
    res.setHeader('Content-Length', String(job.sizeBytes));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    for await (const chunk of exportChunks(db, job.id)) {
      if (!res.write(chunk)) await new Promise<void>((resolve) => { res.once('drain', resolve); res.once('close', resolve); });
      if (res.destroyed) return;
    }
    res.end();
  }));

  return router;
}
