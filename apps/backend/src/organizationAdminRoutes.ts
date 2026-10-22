/**
 * Canonical tenant administration API (tenant-boundaries PRD §8–§9).
 *
 * Every route names its organization in the path; context comes from the
 * verified identity plus a current membership (or explicit superuser
 * platform management). Resource lookups always match organization ID and
 * resource ID together, batch inputs are validated before any write, and
 * each mutation commits with its audit event in one SQLite transaction.
 * Email delivery happens only after commit and is reported honestly.
 */
import express from 'express';
import type { Sql } from './db';
import crypto from 'crypto';
import {
  assignableTenantRoles, can, checkInvitationAction, checkInvite, checkMemberRemove, checkMemberUpdate,
  isMembershipStatus, isTenantRole, hasOrganizationScope, membershipContext,
  type MemberTarget, type OrgContext, type TenantRole, type Verdict,
} from './rbac';
import {
  RequestDenied, canAccessOrganization, departmentIdsOf, identityOf, isIdentityBanned, membershipOf, requestIdOf,
  resolveOrganizationContext, sendError, type Identity,
} from './identity';
import {
  ApiError, appendAudit, integrationDto, invalid, listAudit, normalizeEmail, patchIntegration,
  patchOrganizationSettings, readIntegration, readOrganizationSettings, defaultSettingsPayload, validateProfilePatch, validatePolicyPatch, type AuditActor,
} from './organizationSettingsStore';

import { addMembershipRecord, createOrganizationRecord } from './organizationProvisioning';

type DB = Sql;

export const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Shared helpers                                                       */
/* ------------------------------------------------------------------ */

export function auditActorFor(req: express.Request, identity: Identity, ctx?: OrgContext): AuditActor {
  return {
    actorId: identity.userId,
    actorPlatformRole: identity.platformRole,
    accessMode: ctx ? ctx.accessMode : identity.platformRole === 'superuser' ? 'platform' : 'self',
    requestId: requestIdOf(req),
  };
}

const enforce = (verdict: Verdict) => {
  if (verdict.ok === false) throw new ApiError(verdict.status, verdict.error);
};

function requirePermission(ctx: OrgContext, permission: string) {
  if (!can(ctx, permission)) throw new ApiError(403, 'INSUFFICIENT_PERMISSION');
}

export function parseListParams(query: any, defaults: { limit?: number } = {}) {
  const limit = query.limit === undefined ? defaults.limit ?? 25 : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid('limit must be 1–100.');
  if (!Number.isInteger(offset) || offset < 0) throw invalid('offset must be zero or more.');
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  if (search.length > 200) throw invalid('search is too long.');
  return { limit, offset, search };
}

function onlyBodyKeys(body: unknown, allowed: string[]): Record<string, any> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Request body must be an object.');
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw invalid(`Unknown field: ${key}`);
  return body as Record<string, any>;
}

const likeEscape = (text: string) => `%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Validates a department ID list: strings, unique, every one owned by the organization. */
export async function validateDepartmentIds(db: DB, organizationId: string, value: unknown): Promise<string[]> {
  if (!Array.isArray(value) || value.length > 50 || value.some((id) => typeof id !== 'string' || !id)) {
    throw invalid('departmentIds must be a list of department IDs.');
  }
  const ids = value as string[];
  if (new Set(ids).size !== ids.length) throw invalid('departmentIds must be unique.');
  for (const id of ids) {
    if (!await db.get(`SELECT 1 FROM team WHERE id = ? AND organizationId = ?`, id, organizationId)) {
      throw invalid('A department does not belong to this organization.');
    }
  }
  return ids;
}

/* ------------------------------------------------------------------ */
/* Invariants (§4.3 rules 3–4)                                          */
/* ------------------------------------------------------------------ */

/** Active admin memberships whose identity exists and is not banned. */
export async function usableAdminIds(db: DB, organizationId: string): Promise<string[]> {
  const rows = await db.all(`
    SELECT u.id, u.banned, u.banExpires FROM member m JOIN "user" u ON u.id = m.userId
    WHERE m.organizationId = ? AND m.role = 'admin' AND m.status = 'active'
  `, organizationId) as any[];
  return rows.filter((u) => !isIdentityBanned(u)).map((u) => u.id);
}

/** Throws LAST_ADMIN_REQUIRED when removing `userId`'s admin usability would leave an organization without one. */
export async function assertAdminsRemainWithout(db: DB, userId: string, organizationIds?: string[]) {
  const orgs = organizationIds ?? (await db.all(`SELECT organizationId FROM member WHERE userId = ? AND role = 'admin' AND status = 'active'`, userId) as any[]).map((r) => r.organizationId);
  for (const orgId of orgs) {
    const admins = await usableAdminIds(db, orgId);
    if (admins.includes(userId) && admins.length <= 1) throw new ApiError(409, 'LAST_ADMIN_REQUIRED', 'Every organization needs at least one active administrator.');
  }
}

export async function assertSuperusersRemainWithout(db: DB, userId: string) {
  const rows = await db.all(`SELECT id, banned, banExpires FROM "user" WHERE role = 'superuser'`) as any[];
  const usable = rows.filter((u) => !isIdentityBanned(u)).map((u) => u.id);
  if (usable.includes(userId) && usable.length <= 1) throw new ApiError(409, 'LAST_SUPERUSER_REQUIRED', 'At least one active platform superuser is required.');
}

/* ------------------------------------------------------------------ */
/* Members                                                              */
/* ------------------------------------------------------------------ */

interface MemberRow {
  id: string; userId: string; name: string; email: string; role: string; status: string; createdAt: string;
}

async function memberDto(db: DB, organizationId: string, row: MemberRow) {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name || '',
    email: row.email || '',
    tenantRole: row.role,
    status: row.status,
    departmentIds: await departmentIdsOf(db, row.userId, organizationId),
    createdAt: row.createdAt,
  };
}

const memberSelect = `SELECT m.id, m.userId, u.name, u.email, m.role, m.status, m.createdAt FROM member m JOIN "user" u ON u.id = m.userId`;

async function loadMember(db: DB, organizationId: string, membershipId: string): Promise<MemberRow> {
  const row = await db.get(`${memberSelect} WHERE m.id = ? AND m.organizationId = ?`, membershipId, organizationId) as MemberRow | undefined;
  if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
  return row;
}

async function targetOf(db: DB, organizationId: string, row: MemberRow): Promise<MemberTarget> {
  return {
    userId: row.userId,
    tenantRole: (isTenantRole(row.role) ? row.role : 'viewer') as TenantRole,
    status: isMembershipStatus(row.status) ? row.status : 'active',
    departmentIds: await departmentIdsOf(db, row.userId, organizationId),
  };
}

export async function listMembers(db: DB, ctx: OrgContext, query: any) {
  requirePermission(ctx, 'tenant.member.read');
  const { limit, offset, search } = parseListParams(query);
  const status = query.status === undefined ? 'active' : query.status;
  if (!isMembershipStatus(status)) throw invalid('status must be active or suspended.');
  const where = ['m.organizationId = ?', 'm.status = ?'];
  const params: unknown[] = [ctx.organizationId, status];
  if (!hasOrganizationScope(ctx)) {
    const scope = ctx.departmentIds;
    where.push(`(m.userId = ? OR EXISTS (SELECT 1 FROM teamMember tm JOIN team t ON t.id = tm.teamId
      WHERE tm.userId = m.userId AND t.organizationId = m.organizationId AND tm.teamId IN (${scope.map(() => '?').join(',') || "''"})))`);
    params.push(ctx.userId, ...scope);
  }
  if (query.departmentId !== undefined) {
    if (typeof query.departmentId !== 'string' || !query.departmentId) throw invalid('departmentId is invalid.');
    where.push(`EXISTS (SELECT 1 FROM teamMember tm WHERE tm.userId = m.userId AND tm.teamId = ?)`);
    params.push(query.departmentId);
  }
  if (search) {
    where.push(`(LOWER(u.name) LIKE ? ESCAPE '\\' OR LOWER(u.email) LIKE ? ESCAPE '\\')`);
    params.push(likeEscape(search), likeEscape(search));
  }
  const clause = where.join(' AND ');
  const total = (await db.get(`SELECT COUNT(*) AS n FROM member m JOIN "user" u ON u.id = m.userId WHERE ${clause}`, ...params) as any).n;
  const rows = await db.all(`${memberSelect} WHERE ${clause} ORDER BY m.createdAt DESC, m.id ASC LIMIT ? OFFSET ?`, ...params, limit, offset) as MemberRow[];
  return { members: await Promise.all(rows.map((r) => memberDto(db, ctx.organizationId, r))), total };
}

async function replaceAssignments(db: DB, organizationId: string, userId: string, departmentIds: string[]) {
  await db.run(`DELETE FROM teamMember WHERE userId = ? AND teamId IN (SELECT id FROM team WHERE organizationId = ?)`, userId, organizationId);
  const now = new Date().toISOString();
  for (const teamId of departmentIds) await db.run(`INSERT INTO teamMember (id, teamId, userId, createdAt) VALUES (?, ?, ?, ?)`, `tm_${crypto.randomUUID()}`, teamId, userId, now);
}

export async function updateMember(db: DB, ctx: OrgContext, actor: AuditActor, membershipId: string, body: unknown) {
  const patch = onlyBodyKeys(body, ['tenantRole', 'status', 'departmentIds']);
  const departmentIds = patch.departmentIds === undefined ? undefined : await validateDepartmentIds(db, ctx.organizationId, patch.departmentIds);
  return db.tx(async () => {
    const row = await loadMember(db, ctx.organizationId, membershipId);
    const target = await targetOf(db, ctx.organizationId, row);
    enforce(checkMemberUpdate(ctx, target, { tenantRole: patch.tenantRole, status: patch.status, departmentIds }));
    const nextRole: TenantRole = patch.tenantRole ?? target.tenantRole;
    const nextStatus = patch.status ?? target.status;
    const losesAdmin = target.tenantRole === 'admin' && target.status === 'active' && (nextRole !== 'admin' || nextStatus !== 'active');
    if (losesAdmin) await assertAdminsRemainWithout(db, row.userId, [ctx.organizationId]);
    const changed: string[] = [];
    if (patch.tenantRole !== undefined && patch.tenantRole !== row.role) {
      await db.run(`UPDATE member SET role = ? WHERE id = ? AND organizationId = ?`, nextRole, row.id, ctx.organizationId);
      changed.push('tenantRole');
    }
    if (nextRole === 'admin') {
      if (target.departmentIds.length) { await replaceAssignments(db, ctx.organizationId, row.userId, []); changed.push('departmentIds'); }
    } else if (departmentIds !== undefined) {
      await replaceAssignments(db, ctx.organizationId, row.userId, departmentIds);
      changed.push('departmentIds');
    }
    if (patch.status !== undefined && patch.status !== row.status) {
      await db.run(`UPDATE member SET status = ? WHERE id = ? AND organizationId = ?`, nextStatus, row.id, ctx.organizationId);
      changed.push('status');
    }
    await appendAudit(db, actor, {
      organizationId: ctx.organizationId, action: 'membership.update', targetType: 'membership', targetId: row.id,
      outcome: 'success', changedFields: changed,
    });
    return memberDto(db, ctx.organizationId, await loadMember(db, ctx.organizationId, membershipId));
  });
}

export async function removeMember(db: DB, ctx: OrgContext, actor: AuditActor, membershipId: string) {
  await db.tx(async () => {
    const row = await loadMember(db, ctx.organizationId, membershipId);
    const target = await targetOf(db, ctx.organizationId, row);
    enforce(checkMemberRemove(ctx, target));
    if (target.tenantRole === 'admin' && target.status === 'active') await assertAdminsRemainWithout(db, row.userId, [ctx.organizationId]);
    await replaceAssignments(db, ctx.organizationId, row.userId, []);
    await db.run(`DELETE FROM member WHERE id = ? AND organizationId = ?`, row.id, ctx.organizationId);
    await appendAudit(db, actor, {
      organizationId: ctx.organizationId, action: 'membership.remove', targetType: 'membership', targetId: row.id,
      outcome: 'success', changedFields: [],
    });
  });
}

/* ------------------------------------------------------------------ */
/* Departments                                                          */
/* ------------------------------------------------------------------ */

const departmentDto = (row: any) => ({ id: row.id, organizationId: row.organizationId, name: row.name, createdAt: row.createdAt });

function departmentName(value: unknown): string {
  if (typeof value !== 'string') throw invalid('Department name is required.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 100) throw invalid('Department name must be 1–100 characters.');
  return name;
}

async function assertUniqueDepartmentName(db: DB, organizationId: string, name: string, exceptId?: string) {
  const clash = await db.get(`SELECT id FROM team WHERE organizationId = ? AND LOWER(name) = LOWER(?) AND id <> ?`, organizationId, name, exceptId || '');
  if (clash) throw new ApiError(409, 'DEPARTMENT_EXISTS', 'A department with this name already exists.');
}

export async function listDepartments(db: DB, ctx: OrgContext, query: any) {
  requirePermission(ctx, 'department.view');
  const { limit, offset, search } = parseListParams(query, { limit: 100 });
  const where = ['organizationId = ?'];
  const params: unknown[] = [ctx.organizationId];
  if (!hasOrganizationScope(ctx)) {
    where.push(`id IN (${ctx.departmentIds.map(() => '?').join(',') || "''"})`);
    params.push(...ctx.departmentIds);
  }
  if (search) { where.push(`LOWER(name) LIKE ? ESCAPE '\\'`); params.push(likeEscape(search)); }
  const clause = where.join(' AND ');
  const total = (await db.get(`SELECT COUNT(*) AS n FROM team WHERE ${clause}`, ...params) as any).n;
  const rows = await db.all(`SELECT id, organizationId, name, createdAt FROM team WHERE ${clause} ORDER BY name COLLATE NOCASE, id LIMIT ? OFFSET ?`, ...params, limit, offset);
  return { departments: rows.map(departmentDto), total };
}

export interface DepartmentHooks {
  /** True when persisted business records reference the department (by canonical ID or exact legacy name). */
  departmentReferenced: (organizationId: string, department: { id: string; name: string }) => boolean;
}

export async function createDepartment(db: DB, ctx: OrgContext, actor: AuditActor, body: unknown) {
  requirePermission(ctx, 'department.create');
  const { name: raw } = onlyBodyKeys(body, ['name']);
  const name = departmentName(raw);
  return db.tx(async () => {
    await assertUniqueDepartmentName(db, ctx.organizationId, name);
    const id = `team_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await db.run(`INSERT INTO team (id, name, memberCount, organizationId, createdAt, updatedAt) VALUES (?, ?, 0, ?, ?, ?)`, id, name, ctx.organizationId, now, now);
    await appendAudit(db, actor, { organizationId: ctx.organizationId, action: 'department.create', targetType: 'department', targetId: id, outcome: 'success', changedFields: ['name'] });
    return departmentDto(await db.get(`SELECT * FROM team WHERE id = ?`, id));
  });
}

async function loadDepartment(db: DB, organizationId: string, departmentId: string) {
  const row = await db.get(`SELECT id, organizationId, name, createdAt FROM team WHERE id = ? AND organizationId = ?`, departmentId, organizationId) as any;
  if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
  return row;
}

export async function renameDepartment(db: DB, ctx: OrgContext, actor: AuditActor, departmentId: string, body: unknown, hooks: DepartmentHooks) {
  requirePermission(ctx, 'department.edit');
  const { name: raw } = onlyBodyKeys(body, ['name']);
  const name = departmentName(raw);
  return db.tx(async () => {
    const row = await loadDepartment(db, ctx.organizationId, departmentId);
    if (row.name === name) return departmentDto(row);
    await assertUniqueDepartmentName(db, ctx.organizationId, name, row.id);
    // Legacy records point at departments by name; renaming would silently detach them.
    if (hooks.departmentReferenced(ctx.organizationId, row)) throw new ApiError(409, 'DEPARTMENT_IN_USE', 'Records still reference this department.');
    await db.run(`UPDATE team SET name = ?, updatedAt = ? WHERE id = ? AND organizationId = ?`, name, new Date().toISOString(), row.id, ctx.organizationId);
    await appendAudit(db, actor, { organizationId: ctx.organizationId, action: 'department.update', targetType: 'department', targetId: row.id, outcome: 'success', changedFields: ['name'] });
    return departmentDto(await loadDepartment(db, ctx.organizationId, departmentId));
  });
}

export async function deleteDepartment(db: DB, ctx: OrgContext, actor: AuditActor, departmentId: string, hooks: DepartmentHooks) {
  requirePermission(ctx, 'department.delete');
  await db.tx(async () => {
    const row = await loadDepartment(db, ctx.organizationId, departmentId);
    const hasMembers = await db.get(`SELECT 1 FROM teamMember WHERE teamId = ? LIMIT 1`, row.id);
    const pendingInvites = (await db.all(`SELECT departmentIds, teamId FROM invitation WHERE organizationId = ? AND status = 'pending'`, ctx.organizationId) as any[])
      .some((inv) => invitationDepartmentIds(inv).includes(row.id));
    if (hasMembers || pendingInvites || hooks.departmentReferenced(ctx.organizationId, row)) {
      throw new ApiError(409, 'DEPARTMENT_IN_USE', 'Members, invitations or records still reference this department.');
    }
    await db.run(`DELETE FROM team WHERE id = ? AND organizationId = ?`, row.id, ctx.organizationId);
    await appendAudit(db, actor, { organizationId: ctx.organizationId, action: 'department.delete', targetType: 'department', targetId: row.id, outcome: 'success', changedFields: [] });
  });
}

/* ------------------------------------------------------------------ */
/* Invitations                                                          */
/* ------------------------------------------------------------------ */

export type InvitationStatus = 'pending' | 'accepted' | 'canceled' | 'expired';

function invitationDepartmentIds(row: { departmentIds?: string | null; teamId?: string | null }): string[] {
  if (row.departmentIds) {
    try {
      const parsed = JSON.parse(row.departmentIds);
      if (Array.isArray(parsed)) return parsed.filter((id) => typeof id === 'string');
    } catch { /* fall through to the projection */ }
  }
  return row.teamId ? [row.teamId] : [];
}

export function invitationStatus(row: { status: string; expiresAt: unknown }, now = Date.now()): InvitationStatus {
  if (row.status === 'accepted' || row.status === 'canceled') return row.status;
  if (row.status !== 'pending') return 'canceled';
  const expires = Date.parse(String(row.expiresAt || ''));
  return Number.isNaN(expires) || expires <= now ? 'expired' : 'pending';
}

function invitationDto(row: any) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    tenantRole: row.role,
    departmentIds: invitationDepartmentIds(row),
    status: invitationStatus(row),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

const invitationTarget = (row: any) => ({
  tenantRole: (isTenantRole(row.role) ? row.role : 'admin') as TenantRole,
  departmentIds: invitationDepartmentIds(row),
});

export async function listInvitations(db: DB, ctx: OrgContext, query: any) {
  requirePermission(ctx, 'tenant.invitation.read');
  const { limit, offset, search } = parseListParams(query);
  const status = query.status === undefined ? 'pending' : query.status;
  if (!['pending', 'accepted', 'canceled', 'expired'].includes(status)) throw invalid('Unknown invitation status.');
  const rows = (await db.all(`SELECT * FROM invitation WHERE organizationId = ? ORDER BY createdAt DESC, id ASC`, ctx.organizationId) as any[])
    .filter((row) => invitationStatus(row) === status)
    .filter((row) => checkInvitationAction(ctx, invitationTarget(row), 'read').ok)
    .filter((row) => !search || String(row.email).toLowerCase().includes(search.toLowerCase()));
  return { invitations: rows.slice(offset, offset + limit).map(invitationDto), total: rows.length };
}

export interface InvitationHooks {
  /** Sends the invitation email after commit; resolves false when not delivered. */
  sendInvitation: (input: { email: string; organizationName: string; tenantRole: TenantRole; inviteUrl: string; expiresAt: string; inviterName: string }) => Promise<boolean>;
  inviteUrl: (req: express.Request, token: string) => string;
}

async function deliver(db: DB, req: express.Request, hooks: InvitationHooks, row: any, identity: Identity) {
  const inviteUrl = hooks.inviteUrl(req, row.id);
  const org = await db.get(`SELECT name FROM organization WHERE id = ?`, row.organizationId) as any;
  let sent = false;
  try {
    sent = Boolean(row.email) && await hooks.sendInvitation({
      email: row.email, organizationName: org?.name || '', tenantRole: row.role, inviteUrl, expiresAt: row.expiresAt, inviterName: identity.name,
    });
  } catch {
    sent = false;
  }
  return { invitation: invitationDto(row), inviteUrl, delivery: sent ? 'sent' as const : 'not_sent' as const,
    ...(!row.email ? { inviteCode: row.id, expiresAt: row.expiresAt } : {}) };
}

export async function createInvitation(db: DB, ctx: OrgContext, actor: AuditActor, body: unknown, codeOnly = false) {
  if (codeOnly && ctx.tenantRole !== 'admin' && ctx.accessMode !== 'platform') throw new ApiError(403, 'INSUFFICIENT_PERMISSION');
  const input = onlyBodyKeys(body, codeOnly ? ['tenantRole', 'departmentIds'] : ['email', 'tenantRole', 'departmentIds']);
  const email = codeOnly ? '' : normalizeEmail(input.email);
  const departmentIds = await validateDepartmentIds(db, ctx.organizationId, input.departmentIds ?? []);
  enforce(checkInvite(ctx, input.tenantRole, departmentIds));
  return db.tx(async () => {
    const existingMember = await db.get(`
      SELECT 1 FROM member m JOIN "user" u ON u.id = m.userId WHERE m.organizationId = ? AND LOWER(u.email) = ?
    `, ctx.organizationId, email);
    if (existingMember) throw new ApiError(409, 'MEMBERSHIP_EXISTS', 'This person is already a member of the organization.');
    const pending = (await db.all(`SELECT status, expiresAt FROM invitation WHERE organizationId = ? AND LOWER(email) = ? AND status = 'pending'`, ctx.organizationId, email) as any[])
      .some((row) => invitationStatus(row) === 'pending');
    if (email && pending) throw new ApiError(409, 'INVITATION_EXISTS', 'A pending invitation already exists for this email.');
    const id = crypto.randomBytes(24).toString('base64url'); // 192-bit opaque token
    const now = new Date();
    await db.run(`
      INSERT INTO invitation (id, organizationId, email, role, teamId, status, expiresAt, createdAt, inviterId, departmentIds)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `, id, ctx.organizationId, email, input.tenantRole, departmentIds[0] ?? null, new Date(now.getTime() + INVITATION_TTL_MS).toISOString(), now.toISOString(), ctx.userId, JSON.stringify(departmentIds));
    await appendAudit(db, actor, { organizationId: ctx.organizationId, action: 'invitation.create', targetType: 'invitation', targetId: id, outcome: 'success', changedFields: ['tenantRole', 'departmentIds'] });
    return await db.get(`SELECT * FROM invitation WHERE id = ?`, id) as any;
  });
}

async function loadInvitation(db: DB, organizationId: string, invitationId: string) {
  const row = await db.get(`SELECT * FROM invitation WHERE id = ? AND organizationId = ?`, invitationId, organizationId) as any;
  if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
  return row;
}

export async function resendInvitation(db: DB, ctx: OrgContext, actor: AuditActor, invitationId: string) {
  return db.tx(async () => {
    const row = await loadInvitation(db, ctx.organizationId, invitationId);
    const read = checkInvitationAction(ctx, invitationTarget(row), 'read');
    if (!read.ok) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    enforce(checkInvitationAction(ctx, invitationTarget(row), 'resend'));
    if (!['pending', 'expired'].includes(invitationStatus(row))) throw new ApiError(409, 'INVITATION_NOT_ACCEPTABLE', 'Only pending or expired invitations can be resent.');
    await db.run(`UPDATE invitation SET status = 'pending', expiresAt = ? WHERE id = ? AND organizationId = ?`, new Date(Date.now() + INVITATION_TTL_MS).toISOString(), row.id, ctx.organizationId);
    await appendAudit(db, actor, { organizationId: ctx.organizationId, action: 'invitation.resend', targetType: 'invitation', targetId: row.id, outcome: 'success', changedFields: ['expiresAt'] });
    return loadInvitation(db, ctx.organizationId, invitationId);
  });
}

export async function cancelInvitation(db: DB, ctx: OrgContext, actor: AuditActor, invitationId: string) {
  await db.tx(async () => {
    const row = await loadInvitation(db, ctx.organizationId, invitationId);
    if (!checkInvitationAction(ctx, invitationTarget(row), 'read').ok) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    enforce(checkInvitationAction(ctx, invitationTarget(row), 'cancel'));
    if (!['pending', 'expired'].includes(invitationStatus(row))) throw new ApiError(409, 'INVITATION_NOT_ACCEPTABLE', 'This invitation can no longer be canceled.');
    await db.run(`UPDATE invitation SET status = 'canceled' WHERE id = ? AND organizationId = ?`, row.id, ctx.organizationId);
    await appendAudit(db, actor, { organizationId: ctx.organizationId, action: 'invitation.cancel', targetType: 'invitation', targetId: row.id, outcome: 'success', changedFields: ['status'] });
  });
}

const tokenOk = (token: unknown): token is string => typeof token === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(token);

/** Minimal token preview (§8.3). No mutation. */
export async function previewInvitation(db: DB, token: string) {
  if (!tokenOk(token)) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
  const row = await db.get(`SELECT i.email, i.role, i.status, i.expiresAt, o.name AS organizationName FROM invitation i JOIN organization o ON o.id = i.organizationId WHERE i.id = ?`, token) as any;
  if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
  return { organizationName: row.organizationName, email: row.email || null, tenantRole: row.role, expiresAt: row.expiresAt, status: invitationStatus(row) };
}

/** Whether the inviter could still issue this invitation today (§8.3: revoked/demoted inviters lose outstanding invitations). */
async function inviterStillAuthorized(db: DB, row: any): Promise<boolean> {
  const inviter = await db.get(`SELECT id, role, banned, banExpires FROM "user" WHERE id = ?`, row.inviterId) as any;
  if (!inviter || isIdentityBanned(inviter)) return false;
  if (inviter.role === 'superuser') return true;
  const membership = await membershipOf(db, inviter.id, row.organizationId);
  if (!membership || membership.status !== 'active' || !isTenantRole(membership.role)) return false;
  if (!row.email && membership.role !== 'admin') return false;
  const ctx = membershipContext({
    organizationId: row.organizationId, userId: inviter.id, platformRole: 'user', membershipId: membership.id,
    tenantRole: membership.role, departmentIds: await departmentIdsOf(db, inviter.id, row.organizationId),
  });
  return checkInvite(ctx, row.role, invitationDepartmentIds(row)).ok;
}

/** Approval and acceptance use the same current invitation checks. */
async function invitationIsUsable(db: DB, row: any): Promise<boolean> {
  if (invitationStatus(row) !== 'pending' || !isTenantRole(row.role)) return false;
  if (!await db.get('SELECT 1 FROM organization WHERE id = ?', row.organizationId)) return false;
  const departmentIds = invitationDepartmentIds(row);
  for (const id of departmentIds) {
    if (!await db.get(`SELECT 1 FROM team WHERE id = ? AND organizationId = ?`, id, row.organizationId)) return false;
  }
  const comboValid = row.role === 'admin' ? departmentIds.length === 0 : departmentIds.length > 0;
  return comboValid && await inviterStillAuthorized(db, row);
}

/** An email invitation approves its recipient; an invite code requires possession. */
export async function hasApprovalInvitation(db: DB, email: string, token?: string | null): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  if (token) {
    if (!tokenOk(token)) return false;
    const row = await db.get('SELECT * FROM invitation WHERE id = ?', token) as any;
    return Boolean(row && (!row.email || String(row.email).toLowerCase() === normalizedEmail) && await invitationIsUsable(db, row));
  }
  for (const row of await db.all("SELECT * FROM invitation WHERE LOWER(email) = ? AND email <> '' AND status = 'pending'", normalizedEmail)) {
    if (await invitationIsUsable(db, row)) return true;
  }
  return false;
}

export async function acceptInvitation(db: DB, identity: Identity, token: string, req: express.Request) {
  if (!tokenOk(token)) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
  return db.tx(async () => {
    const row = await db.get(`SELECT * FROM invitation WHERE id = ?`, token) as any;
    if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    if (invitationStatus(row) !== 'pending') throw new ApiError(409, 'INVITATION_NOT_ACCEPTABLE', 'This invitation can no longer be accepted.');
    if (row.email && identity.email !== String(row.email).toLowerCase()) throw new ApiError(403, 'INVITATION_IDENTITY_MISMATCH', 'This invitation was issued to a different account.');
    if (!isTenantRole(row.role)) throw new ApiError(409, 'INVITATION_NOT_ACCEPTABLE', 'This invitation can no longer be accepted.');
    const departmentIds = invitationDepartmentIds(row);
    if (!await invitationIsUsable(db, row)) {
      throw new ApiError(409, 'INVITATION_NOT_ACCEPTABLE', 'This invitation can no longer be accepted.');
    }
    if (await membershipOf(db, identity.userId, row.organizationId)) throw new ApiError(409, 'MEMBERSHIP_EXISTS', 'You are already a member of this organization.');
    const claimed = await db.run(`UPDATE invitation SET status = 'accepted' WHERE id = ? AND status = 'pending'`, row.id);
    if (claimed.changes !== 1) throw new ApiError(409, 'INVITATION_NOT_ACCEPTABLE', 'This invitation can no longer be accepted.');
    const membershipId = `mem_${crypto.randomUUID()}`;
    await db.run(`INSERT INTO member (id, organizationId, userId, role, createdAt, status) VALUES (?, ?, ?, ?, ?, 'active')`, membershipId, row.organizationId, identity.userId, row.role, new Date().toISOString());
    await replaceAssignments(db, row.organizationId, identity.userId, departmentIds);
    await appendAudit(db, { actorId: identity.userId, actorPlatformRole: identity.platformRole, accessMode: 'membership', requestId: requestIdOf(req) }, {
      organizationId: row.organizationId, action: 'invitation.accept', targetType: 'invitation', targetId: row.id, outcome: 'success', changedFields: ['status'],
    });
    const org = await db.get(`SELECT name FROM organization WHERE id = ?`, row.organizationId) as any;
    return {
      id: membershipId, organizationId: row.organizationId, organizationName: org?.name || '',
      tenantRole: row.role as TenantRole, status: 'active' as const, departmentIds,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Identity DTOs                                                        */
/* ------------------------------------------------------------------ */

export async function identityResponse(db: DB, identity: Identity) {
  const rows = (await db.all(`
    SELECT m.id, m.organizationId, o.name AS organizationName, m.role, m.status
    FROM member m JOIN organization o ON o.id = m.organizationId
    WHERE m.userId = ? ORDER BY o.name COLLATE NOCASE, m.id
  `, identity.userId) as any[])
    .filter((m) => isTenantRole(m.role));
  const memberships = [];
  for (const m of rows) memberships.push({
    id: m.id, organizationId: m.organizationId, organizationName: m.organizationName,
    tenantRole: m.role as TenantRole, status: isMembershipStatus(m.status) ? m.status : 'active',
    departmentIds: await departmentIdsOf(db, identity.userId, m.organizationId),
  });
  const defaultOrganizationId = identity.sessionDefaultOrganizationId && await canAccessOrganization(db, identity, identity.sessionDefaultOrganizationId)
    ? identity.sessionDefaultOrganizationId : null;
  const signInMethods = (await db.all(`SELECT DISTINCT providerId FROM account WHERE userId = ?`, identity.userId) as any[])
    .map((r) => (r.providerId === 'credential' ? 'password' : String(r.providerId)));
  const profile = await db.get('SELECT * FROM "user" WHERE id = ?', identity.userId) as { bio?: string | null } | undefined;
  return {
    identity: {
      id: identity.userId, email: identity.email, name: identity.name, image: identity.image,
      bio: profile?.bio || '',
      emailVerified: identity.emailVerified, platformRole: identity.platformRole,
    },
    signInMethods,
    memberships,
    platformPermissions: identity.platformPermissions,
    defaultOrganizationId,
  };
}

export function capabilitiesOf(ctx: OrgContext) {
  return {
    organizationId: ctx.organizationId,
    accessMode: ctx.accessMode,
    membershipId: ctx.membershipId,
    tenantRole: ctx.tenantRole,
    departmentIds: ctx.departmentIds,
    permissions: ctx.permissions,
    assignableTenantRoles: assignableTenantRoles(ctx),
  };
}

/** Updates only this session's default selection (§9.1). */
export async function selectActiveOrganization(db: DB, identity: Identity, req: express.Request) {
  const { organizationId } = onlyBodyKeys(req.body, ['organizationId']);
  if (typeof organizationId !== 'string' || !organizationId) throw invalid('organizationId is required.');
  const headerSelectors = [req.headers['x-organization-id'], req.headers['x-tenant-id'], (req.query as any).tenantId, (req.query as any).organizationId]
    .map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
  if (headerSelectors.some((s) => s !== organizationId)) throw new ApiError(400, 'ORGANIZATION_SELECTOR_CONFLICT');
  await resolveOrganizationContext(db, identity, organizationId); // 404 when not accessible

  await db.run(`UPDATE session SET activeOrganizationId = ?, updatedAt = ? WHERE id = ?`, organizationId, new Date().toISOString(), identity.sessionId);
  return { organizationId };
}

/* ------------------------------------------------------------------ */
/* Router                                                               */
/* ------------------------------------------------------------------ */

export interface OrganizationAdminRouterOptions extends InvitationHooks, DepartmentHooks {
  db: DB;
  /** Non-secret runtime policy view (`TenantPolicyView`). */
  policyView: (organizationId: string) => unknown;
  providerConfigured: () => boolean;
  /** Called after a committed organization-scoped change so server projections can refresh. */
  onOrganizationChanged: (organizationId: string) => Promise<void>;
  platformConfiguration: {
    read: () => unknown;
    patch: (section: string, values: unknown, actor: AuditActor) => Promise<unknown>;
  };
}

export function createOrganizationAdminRouter(options: OrganizationAdminRouterOptions) {
  const { db } = options;
  const router = express.Router();

  type Handler = (req: express.Request, res: express.Response) => unknown;
  const handle = (fn: Handler) => async (req: express.Request, res: express.Response) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      if (err instanceof ApiError || err instanceof RequestDenied) return sendError(req, res, err.status, err.error, err.message);
      console.error('[organization-admin]', err);
      return sendError(req, res, 500, 'INTERNAL_ERROR', 'Unexpected server error.');
    }
  };
  const contextOf = async (req: express.Request) => {
    const identity = identityOf(req);
    // New schemas forbid redundant organization selectors in body/query.
    const extra = [req.headers['x-organization-id'], req.headers['x-tenant-id']].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
    if (extra.some((v) => v !== req.params.organizationId)) throw new RequestDenied(400, 'ORGANIZATION_SELECTOR_CONFLICT');
    const ctx = await resolveOrganizationContext(db, identity, req.params.organizationId);
    return { identity, ctx, actor: auditActorFor(req, identity, ctx) };
  };
  const changed = async (organizationId: string) => {
    try { await options.onOrganizationChanged(organizationId); } catch (err) { console.error('[organization-admin] projection refresh failed', err); }
  };

  router.get('/me', handle(async (req, res) => res.json(await identityResponse(db, identityOf(req)))));
  router.post('/me/organization', handle(async (req, res) => {
    const identity = identityOf(req);
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Organization must be an object.');
    const fields = ['name', 'legalEntity', 'brandName', 'countryCode', 'industry', 'language'];
    for (const key of Object.keys(body)) if (!fields.includes(key)) throw invalid(`Unknown field: ${key}`);
    for (const key of fields) if (typeof body[key] !== 'string' || !body[key].trim()) throw invalid(`${key} is required.`);
    const name = body.name.trim();
    if (name.length > 200) throw invalid('Organization name must be at most 200 characters.');
    const defaults = defaultSettingsPayload();
    const { profile } = validateProfilePatch({ legalEntity: body.legalEntity, brandName: body.brandName }, defaults.profile);
    const { policy } = validatePolicyPatch({ countryCode: body.countryCode, industry: body.industry, language: body.language }, defaults.policy);
    const organizationId = await db.tx(async () => {
      if (await db.get("SELECT 1 FROM member WHERE userId = ? AND status = 'active'", identity.userId)) {
        throw new ApiError(409, 'MEMBERSHIP_EXISTS', 'You already have an organization.');
      }
      const id = await createOrganizationRecord(db, { name, legalEntity: profile.legalEntity, brandName: profile.brandName,
        settings: { countryCode: policy.countryCode, industry: policy.industry, language: policy.language } }, identity.userId);
      await addMembershipRecord(db, { userId: identity.userId, organizationId: id, tenantRole: 'admin' });
      await appendAudit(db, auditActorFor(req, identity), { organizationId: id, action: 'organization.create', targetType: 'organization', targetId: id,
        outcome: 'success', changedFields: [...fields, 'admin'] });
      return id;
    });
    await changed(organizationId);
    res.status(201).json({ organizationId });
  }));

  router.post('/me/active-organization', handle(async (req, res) => res.json(await selectActiveOrganization(db, identityOf(req), req))));
  /* Account Security: the caller's own sessions only (PRD §6.7). */
  router.get('/me/sessions', handle(async (req, res) => {
    const identity = identityOf(req);
    const rows = await db.all(`SELECT id, createdAt, updatedAt, expiresAt, ipAddress, userAgent FROM session WHERE userId = ? ORDER BY updatedAt DESC`, identity.userId) as any[];
    res.json({ sessions: rows.map((r) => ({ ...r, current: r.id === identity.sessionId })) });
  }));
  router.delete('/me/sessions/:sessionId', handle(async (req, res) => {
    const identity = identityOf(req);
    const result = await db.run(`DELETE FROM session WHERE id = ? AND userId = ?`, req.params.sessionId, identity.userId);
    if (result.changes !== 1) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    res.status(204).end();
  }));

  const org = '/organizations/:organizationId';
  router.get(`${org}/capabilities`, handle(async (req, res) => res.json(capabilitiesOf((await contextOf(req)).ctx))));
  router.get(`${org}/policy`, handle(async (req, res) => {
    const { ctx } = await contextOf(req);
    res.json(options.policyView(ctx.organizationId));
  }));

  router.get(`${org}/settings`, handle(async (req, res) => {
    const { ctx } = await contextOf(req);
    requirePermission(ctx, 'tenant.settings.read');
    res.json(await readOrganizationSettings(db, ctx.organizationId));
  }));
  router.patch(`${org}/settings`, handle(async (req, res) => {
    const { ctx, actor } = await contextOf(req);
    requirePermission(ctx, 'tenant.settings.update');
    const dto = await patchOrganizationSettings(db, ctx.organizationId, req.body, actor);
    await changed(ctx.organizationId);
    res.json(dto);
  }));

  router.get(`${org}/members`, handle(async (req, res) => res.json(await listMembers(db, (await contextOf(req)).ctx, req.query))));
  router.patch(`${org}/members/:membershipId`, handle(async (req, res) => {
    const { ctx, actor } = await contextOf(req);
    res.json(await updateMember(db, ctx, actor, req.params.membershipId, req.body));
  }));
  router.delete(`${org}/members/:membershipId`, handle(async (req, res) => {
    const { ctx, actor } = await contextOf(req);
    await removeMember(db, ctx, actor, req.params.membershipId);
    res.status(204).end();
  }));

  router.get(`${org}/departments`, handle(async (req, res) => res.json(await listDepartments(db, (await contextOf(req)).ctx, req.query))));
  router.post(`${org}/departments`, handle(async (req, res) => {
    const { ctx, actor } = await contextOf(req);
    const dto = await createDepartment(db, ctx, actor, req.body);
    await changed(ctx.organizationId);
    res.status(201).json(dto);
  }));
  router.patch(`${org}/departments/:departmentId`, handle(async (req, res) => {
    const { ctx, actor } = await contextOf(req);
    const dto = await renameDepartment(db, ctx, actor, req.params.departmentId, req.body, options);
    await changed(ctx.organizationId);
    res.json(dto);
  }));
  router.delete(`${org}/departments/:departmentId`, handle(async (req, res) => {
    const { ctx, actor } = await contextOf(req);
    await deleteDepartment(db, ctx, actor, req.params.departmentId, options);
    await changed(ctx.organizationId);
    res.status(204).end();
  }));

  router.get(`${org}/invitations`, handle(async (req, res) => res.json(await listInvitations(db, (await contextOf(req)).ctx, req.query))));
  router.post(`${org}/invite-codes`, handle(async (req, res) => {
    const { identity, ctx, actor } = await contextOf(req);
    const row = await createInvitation(db, ctx, actor, req.body, true);
    res.status(201).json(await deliver(db, req, options, row, identity));
  }));
  router.post(`${org}/invitations`, handle(async (req, res) => {
    const { identity, ctx, actor } = await contextOf(req);
    const row = await createInvitation(db, ctx, actor, req.body);
    res.status(201).json(await deliver(db, req, options, row, identity));
  }));
  router.post(`${org}/invitations/:invitationId/resend`, handle(async (req, res) => {
    const { identity, ctx, actor } = await contextOf(req);
    const row = await resendInvitation(db, ctx, actor, req.params.invitationId);
    res.json(await deliver(db, req, options, row, identity));
  }));
  router.delete(`${org}/invitations/:invitationId`, handle(async (req, res) => {
    const { ctx, actor } = await contextOf(req);
    await cancelInvitation(db, ctx, actor, req.params.invitationId);
    res.status(204).end();
  }));

  router.get('/invitations/:token/preview', handle(async (req, res) => res.json(await previewInvitation(db, req.params.token))));
  router.post('/invitations/:token/accept', handle(async (req, res) => {
    const membership = await acceptInvitation(db, identityOf(req), req.params.token, req);
    res.status(201).json(membership);
  }));

  router.get(`${org}/integrations/google`, handle(async (req, res) => {
    const { ctx } = await contextOf(req);
    requirePermission(ctx, 'tenant.integration.read');
    res.json(integrationDto(await readIntegration(db, ctx.organizationId), options.providerConfigured()));
  }));
  router.patch(`${org}/integrations/google`, handle(async (req, res) => {
    const { ctx, actor } = await contextOf(req);
    requirePermission(ctx, 'tenant.integration.update');
    const row = await patchIntegration(db, ctx.organizationId, req.body, actor);
    await changed(ctx.organizationId);
    res.json(integrationDto(row, options.providerConfigured()));
  }));

  router.get(`${org}/audit`, handle(async (req, res) => {
    const { ctx } = await contextOf(req);
    requirePermission(ctx, 'tenant.audit.read');
    const { limit, offset } = parseListParams(req.query);
    const action = typeof req.query.action === 'string' ? req.query.action : undefined;
    const targetType = typeof req.query.targetType === 'string' ? req.query.targetType : undefined;
    res.json(await listAudit(db, { organizationId: ctx.organizationId, action, targetType, limit, offset }));
  }));

  /* -------------------------- platform -------------------------- */
  const platform = (permission: string) => (req: express.Request) => {
    const identity = identityOf(req);
    if (!identity.platformPermissions.includes(permission)) throw new RequestDenied(403, 'INSUFFICIENT_PERMISSION');
    return identity;
  };
  router.get('/platform/configuration', handle((req, res) => {
    platform('platform.configuration.read')(req);
    res.json(options.platformConfiguration.read());
  }));
  router.patch('/platform/configuration', handle(async (req, res) => {
    const identity = platform('platform.configuration.update')(req);
    const { section, values } = onlyBodyKeys(req.body, ['section', 'values']);
    res.json(await options.platformConfiguration.patch(section, values, auditActorFor(req, identity)));
  }));
  router.get('/platform/audit', handle(async (req, res) => {
    platform('platform.audit.read')(req);
    const { limit, offset } = parseListParams(req.query);
    const organizationId = typeof req.query.organizationId === 'string' && req.query.organizationId ? req.query.organizationId : undefined;
    res.json(await listAudit(db, {
      organizationId, limit, offset,
      action: typeof req.query.action === 'string' ? req.query.action : undefined,
      targetType: typeof req.query.targetType === 'string' ? req.query.targetType : undefined,
    }));
  }));

  return router;
}
