import express from 'express';
import { OrgContext, hasOrganizationScope } from './rbac';
import { RequestDenied } from './identity';
import { createOrganizationScope, RecordKind, filterRecords, recordVisible } from './recordScope';
import { readBusinessRows } from './normalizedCoreStore';
import { contractRepository } from './repositories/contractRepository';
import { partnerRepository } from './repositories/partnerRepository';
import { EMPTY_SCOPE_COLLECTIONS, scopeCollectionsFor, type ScopeCollections } from './repositories/scopeDirectory';
import { sql } from './db';
import { appendActivity } from './activityLog';
/** Request-scoped record access: verified organization context, department scope, and attribution of activity to the session. */


/** Verified organization context attached by the route policy (tenant/orgParam routes only). */
export function orgContextOf(req: express.Request): OrgContext {
  const ctx = (req as any).orgContext as OrgContext | undefined;
  if (!ctx) throw new RequestDenied(409, "ORGANIZATION_REQUIRED");
  return ctx;
}
/** Exact canonical ownership. Records without an organization belong to nobody (PRD §14.3). */
export function isMatchingOrg(entityOrgId, targetTenantId) {
  return Boolean(entityOrgId) && Boolean(targetTenantId) && entityOrgId === targetTenantId;
}
/** Record collections the scope resolver reads: the request's directory of partners, contracts and insertion orders (department roles only). */
export function scopeCollectionsOf(req: express.Request): ScopeCollections {
  return ((req as any).scopeCollections as ScopeCollections | undefined) ?? EMPTY_SCOPE_COLLECTIONS;
}
/** Same for callers outside a request (upload authorization). */
export async function scopeCollections(ctx: OrgContext): Promise<ScopeCollections> {
  return scopeCollectionsFor(sql, ctx);
}
/** Request-local department resolver for the verified organization. */
export function scopeOf(req: express.Request) {
  const r = req as any;
  if (!r.recordScope) r.recordScope = createOrganizationScope(r.teams || [], orgContextOf(req).organizationId, scopeCollectionsOf(req));
  return r.recordScope as ReturnType<typeof createOrganizationScope>;
}
/** Records of `kind` the caller may see: own organization, department scope, before any aggregation. */
export async function scopedRecords<T = any>(req: express.Request, kind: RecordKind): Promise<T[]> {
  const tables: Record<RecordKind, string> = { partner: 'partners', contract: 'contracts', io: 'insertion_orders', spending: 'spendings', evaluation: 'evaluations', notification: 'notifications' };
  const organizationId = orgContextOf(req).organizationId;
  const records = (kind === 'contract' ? (await contractRepository.list(organizationId)).rows
    : kind === 'partner' ? (await partnerRepository.list(organizationId)).rows
    : await readBusinessRows(sql, tables[kind], organizationId)) as T[];
  return filterRecords(orgContextOf(req), scopeOf(req), kind, records);
}
/**
 * Resource boundary for reads/updates/deletes (PRD §5.4): the persisted
 * record must belong to the verified organization and, for department roles,
 * to one of the caller's departments. Anything else answers 404 so IDs of
 * other tenants/departments cannot be probed.
 */
export function assertRecordAccess(
  req: express.Request,
  kind: RecordKind,
  record: any,
): { status: number; body: { error: string; message: string } } | null {
  if (record && recordVisible(orgContextOf(req), scopeOf(req), kind, record)) return null;
  return { status: 404, body: { error: "RESOURCE_NOT_FOUND", message: "Resource not found." } };
}
/** Creates/updates may not place a record outside the caller's department scope. */
export function assertRecordWritable(req: express.Request, kind: RecordKind, record: any) {
  const ctx = orgContextOf(req);
  if (hasOrganizationScope(ctx)) return null;
  // Rebuild so a just-edited partner/contract name or PIC is resolved fresh.
  const fresh = createOrganizationScope((req as any).teams || [], ctx.organizationId, scopeCollectionsOf(req));
  if (recordVisible(ctx, fresh, kind, { ...record, organizationId: ctx.organizationId })) return null;
  return { status: 403, body: { error: "INSUFFICIENT_PERMISSION", message: "The record must belong to one of your departments." } };
}
/** Organization a tenant request operates on: always the verified context, never a default. */
export function getRequestTenantId(req: express.Request): string {
  return orgContextOf(req).organizationId;
}
/**
 * Operational activity entry (the History drawer's "activity" dataset). The
 * actor comes from the verified identity and the organization from the
 * verified context; caller-supplied names/roles are ignored when either exists.
 */
export async function addActivityLog(
  userEmail,
  userName,
  role,
  actionType,
  moduleName,
  description,
  req,
  organizationId?: string | null,
  details?: Record<string, unknown>,
) {
  const identity = req?.identity;
  const ctx: OrgContext | undefined = req?.orgContext;
  if (identity) {
    userEmail = identity.email;
    userName = identity.name;
    role = identity.apiKey ? "API key"
      : ctx?.tenantRole
      ? ctx.tenantRole.replace(/^./, (c: string) => c.toUpperCase())
      : identity.platformRole === "superuser" ? "Platform administrator" : "User";
  }
  // One INSERT, no full-database save: the log is append-only and uncapped.
  return await appendActivity(sql, {
    organizationId: organizationId !== undefined ? organizationId : ctx?.organizationId ?? null,
    userEmail, userName, role, actionType, module: moduleName, description,
    ipAddress: req?.ip || "127.0.0.1",
    userAgent: req?.headers["user-agent"] || "Browser Client",
    details,
  });
}
/** Activity entry attributed to the verified session identity; names or roles in the request body or query are never used. */
export function logActivity(req: express.Request, actionType: string, moduleName: string, description: string) {
  return addActivityLog("", "", "", actionType, moduleName, description, req);
}
