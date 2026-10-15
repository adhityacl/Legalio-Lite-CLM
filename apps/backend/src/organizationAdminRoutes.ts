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
import type Database from 'better-sqlite3';
import crypto from 'crypto';
import {
  assignableTenantRoles, can, checkInvitationAction, checkInvite, checkMemberRemove, checkMemberUpdate,
  isMembershipStatus, isTenantRole, hasOrganizationScope, membershipContext,
  type MemberTarget, type OrgContext, type TenantRole, type Verdict,
} from './rbac';
import {
  RequestDenied, canAccessOrganization, departmentIdsOf, isIdentityBanned, membershipOf, requestIdOf,
  resolveIdentity, resolveOrganizationContext, sendError, type Identity,
} from './identity';
import {
  ApiError, appendAudit, integrationDto, invalid, listAudit, normalizeEmail, patchIntegration,
  patchOrganizationSettings, readIntegration, readOrganizationSettings, defaultSettingsPayload, validateProfilePatch, validatePolicyPatch, type AuditActor,
} from './organizationSettingsStore';

import { addMembershipRecord, createOrganizationRecord } from './organizationProvisioning';

type DB = Database.Database;

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
export function validateDepartmentIds(db: DB, organizationId: string, value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50 || value.some((id) => typeof id !== 'string' || !id)) {
    throw invalid('departmentIds must be a list of department IDs.');
  }
  const ids = value as string[];
  if (new Set(ids).size !== ids.length) throw invalid('departmentIds must be unique.');
  for (const id of ids) {
    if (!db.prepare(`SELECT 1 FROM team WHERE id = ? AND organizationId = ?`).get(id, organizationId)) {
      throw invalid('A department does not belong to this organization.');
    }
  }
  return ids;
}

/* ------------------------------------------------------------------ */
/* Invariants (§4.3 rules 3–4)                                          */
/* ------------------------------------------------------------------ */

/** Active admin memberships whose identity exists and is not banned. */
export function usableAdminIds(db: DB, organizationId: string): string[] {
  const rows = db.prepare(`
    SELECT u.id, u.banned, u.banExpires FROM member m JOIN "user" u ON u.id = m.userId
    WHERE m.organizationId = ? AND m.role = 'admin' AND m.status = 'active'
  `).all(organizationId) as any[];
  return rows.filter((u) => !isIdentityBanned(u)).map((u) => u.id);
}

/** Throws LAST_ADMIN_REQUIRED when removing `userId`'s admin usability would leave an organization without one. */
export function assertAdminsRemainWithout(db: DB, userId: string, organizationIds?: string[]) {
  const orgs = organizationIds ?? (db.prepare(`SELECT organizationId FROM member WHERE userId = ? AND role = 'admin' AND status = 'active'`).all(userId) as any[]).map((r) => r.organizationId);
  for (const orgId of orgs) {
    const admins = usableAdminIds(db, orgId);
    if (admins.includes(userId) && admins.length <= 1) throw new ApiError(409, 'LAST_ADMIN_REQUIRED', 'Every organization needs at least one active administrator.');
  }
}

export function assertSuperusersRemainWithout(db: DB, userId: string) {
  const rows = db.prepare(`SELECT id, banned, banExpires FROM "user" WHERE role = 'superuser'`).all() as any[];
  const usable = rows.filter((u) => !isIdentityBanned(u)).map((u) => u.id);
  if (usable.includes(userId) && usable.length <= 1) throw new ApiError(409, 'LAST_SUPERUSER_REQUIRED', 'At least one active platform superuser is required.');
}

/* ------------------------------------------------------------------ */
/* Members                                                              */
/* ------------------------------------------------------------------ */

interface MemberRow {
  id: string; userId: string; name: string; email: string; role: string; status: string; createdAt: string;
}

function memberDto(db: DB, organizationId: string, row: MemberRow) {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name || '',
    email: row.email || '',
    tenantRole: row.role,
    status: row.status,
    departmentIds: departmentIdsOf(db, row.userId, organizationId),
    createdAt: row.createdAt,
  };
}

const memberSelect = `SELECT m.id, m.userId, u.name, u.email, m.role, m.status, m.createdAt FROM member m JOIN "user" u ON u.id = m.userId`;

function loadMember(db: DB, organizationId: string, membershipId: string): MemberRow {
  const row = db.prepare(`${memberSelect} WHERE m.id = ? AND m.organizationId = ?`).get(membershipId, organizationId) as MemberRow | undefined;
  if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
  return row;
}

function targetOf(db: DB, organizationId: string, row: MemberRow): MemberTarget {
  return {
    userId: row.userId,
    tenantRole: (isTenantRole(row.role) ? row.role : 'viewer') as TenantRole,
    status: isMembershipStatus(row.status) ? row.status : 'active',
    departmentIds: departmentIdsOf(db, row.userId, organizationId),
  };
}

export function listMembers(db: DB, ctx: OrgContext, query: any) {
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
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM member m JOIN "user" u ON u.id = m.userId WHERE ${clause}`).get(...params) as any).n;
  const rows = db.prepare(`${memberSelect} WHERE ${clause} ORDER BY m.createdAt DESC, m.id ASC LIMIT ? OFFSET ?`).all(...params, limit, offset) as MemberRow[];
  return { members: rows.map((r) => memberDto(db, ctx.organizationId, r)), total };
}

function replaceAssignments(db: DB, organizationId: string, userId: string, departmentIds: string[]) {
  db.prepare(`DELETE FROM teamMember WHERE userId = ? AND teamId IN (SELECT id FROM team WHERE organizationId = ?)`).run(userId, organizationId);
  const now = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO teamMember (id, teamId, userId, createdAt) VALUES (?, ?, ?, ?)`);
  for (const teamId of departmentIds) insert.run(`tm_${crypto.randomUUID()}`, teamId, userId, now);
}

export function updateMember(db: DB, ctx: OrgContext, actor: AuditActor, membershipId: string, body: unknown) {
  const patch = onlyBodyKeys(body, ['tenantRole', 'status', 'departmentIds']);
  const departmentIds = patch.departmentIds === undefined ? undefined : validateDepartmentIds(db, ctx.organizationId, patch.departmentIds);
  return db.transaction(() => {
    const row = loadMember(db, ctx.organizationId, membershipId);
    const target = targetOf(db, ctx.organizationId, row);
    enforce(checkMemberUpdate(ctx, target, { tenantRole: patch.tenantRole, status: patch.status, departmentIds }));
    const nextRole: TenantRole = patch.tenantRole ?? target.tenantRole;
    const nextStatus = patch.status ?? target.status;
    const losesAdmin = target.tenantRole === 'admin' && target.status === 'active' && (nextRole !== 'admin' || nextStatus !== 'active');
    if (losesAdmin) assertAdminsRemainWithout(db, row.userId, [ctx.organizationId]);
    const changed: string[] = [];
    if (patch.tenantRole !== undefined && patch.tenantRole !== row.role) {
      db.prepare(`UPDATE member SET role = ? WHERE id = ? AND organizationId = ?`).run(nextRole, row.id, ctx.organizationId);
      changed.push('tenantRole');
    }
    if (nextRole === 'admin') {
      if (target.departmentIds.length) { replaceAssignments(db, ctx.organizationId, row.userId, []); changed.push('departmentIds'); }
    } else if (departmentIds !== undefined) {
      replaceAssignments(db, ctx.organizationId, row.userId, departmentIds);
      changed.push('departmentIds');
    }
    if (patch.status !== undefined && patch.status !== row.status) {
      db.prepare(`UPDATE member SET status = ? WHERE id = ? AND organizationId = ?`).run(nextStatus, row.id, ctx.organizationId);
      changed.push('status');
    }
    appendAudit(db, actor, {
      organizationId: ctx.organizationId, action: 'membership.update', targetType: 'membership', targetId: row.id,
      outcome: 'success', changedFields: changed,
    });
    return memberDto(db, ctx.organizationId, loadMember(db, ctx.organizationId, membershipId));
  })();
}

export function removeMember(db: DB, ctx: OrgContext, actor: AuditActor, membershipId: string) {
  db.transaction(() => {
    const row = loadMember(db, ctx.organizationId, membershipId);
    const target = targetOf(db, ctx.organizationId, row);
    enforce(checkMemberRemove(ctx, target));
    if (target.tenantRole === 'admin' && target.status === 'active') assertAdminsRemainWithout(db, row.userId, [ctx.organizationId]);
    replaceAssignments(db, ctx.organizationId, row.userId, []);
    db.prepare(`DELETE FROM member WHERE id = ? AND organizationId = ?`).run(row.id, ctx.organizationId);
    appendAudit(db, actor, {
      organizationId: ctx.organizationId, action: 'membership.remove', targetType: 'membership', targetId: row.id,
      outcome: 'success', changedFields: [],
    });
  })();
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

function assertUniqueDepartmentName(db: DB, organizationId: string, name: string, exceptId?: string) {
  const clash = db.prepare(`SELECT id FROM team WHERE organizationId = ? AND LOWER(name) = LOWER(?) AND id <> ?`).get(organizationId, name, exceptId || '');
  if (clash) throw new ApiError(409, 'DEPARTMENT_EXISTS', 'A department with this name already exists.');
}

export function listDepartments(db: DB, ctx: OrgContext, query: any) {
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
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM team WHERE ${clause}`).get(...params) as any).n;
  const rows = db.prepare(`SELECT id, organizationId, name, createdAt FROM team WHERE ${clause} ORDER BY name COLLATE NOCASE, id LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { departments: rows.map(departmentDto), total };
}

export interface DepartmentHooks {
  /** True when persisted business records reference the department (by canonical ID or exact legacy name). */
  departmentReferenced: (organizationId: string, department: { id: string; name: string }) => boolean;
}

export function createDepartment(db: DB, ctx: OrgContext, actor: AuditActor, body: unknown) {
  requirePermission(ctx, 'department.create');
  const { name: raw } = onlyBodyKeys(body, ['name']);
  const name = departmentName(raw);
  return db.transaction(() => {
    assertUniqueDepartmentName(db, ctx.organizationId, name);
    const id = `team_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO team (id, name, memberCount, organizationId, createdAt, updatedAt) VALUES (?, ?, 0, ?, ?, ?)`).run(id, name, ctx.organizationId, now, now);
    appendAudit(db, actor, { organizationId: ctx.organizationId, action: 'department.create', targetType: 'department', targetId: id, outcome: 'success', changedFields: ['name'] });
    return departmentDto(db.prepare(`SELECT * FROM team WHERE id = ?`).get(id));
  })();
}

function loadDepartment(db: DB, organizationId: string, departmentId: string) {
  const row = db.prepare(`SELECT id, organizationId, name, createdAt FROM team WHERE id = ? AND organizationId = ?`).get(departmentId, organizationId) as any;
  if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
  return row;
}

export function renameDepartment(db: DB, ctx: OrgContext, actor: AuditActor, departmentId: string, body: unknown, hooks: DepartmentHooks) {
  requirePermission(ctx, 'department.edit');
  const { name: raw } = onlyBodyKeys(body, ['name']);
  const name = departmentName(raw);
  return db.transaction(() => {
    const row = loadDepartment(db, ctx.organizationId, departmentId);
    if (row.name === name) return departmentDto(row);
    assertUniqueDepartmentName(db, ctx.organizationId, name, row.id);
    // Legacy records point at departments by name; renaming would silently detach them.
    if (hooks.departmentReferenced(ctx.organizationId, row)) throw new ApiError(409, 'DEPARTMENT_IN_USE', 'Records still reference this department.');
    db.prepare(`UPDATE team SET name = ?, updatedAt = ? WHERE id = ? AND organizationId = ?`).run(name, new Date().toISOString(), row.id, ctx.organizationId);
    appendAudit(db, actor, { organizationId: ctx.organizationId, action: 'department.update', targetType: 'department', targetId: row.id, outcome: 'success', changedFields: ['name'] });
    return departmentDto(loadDepartment(db, ctx.organizationId, departmentId));
  })();
}

export function deleteDepartment(db: DB, ctx: OrgContext, actor: AuditActor, departmentId: string, hooks: DepartmentHooks) {
  requirePermission(ctx, 'department.delete');
  db.transaction(() => {
    const row = loadDepartment(db, ctx.organizationId, departmentId);
    const hasMembers = db.prepare(`SELECT 1 FROM teamMember WHERE teamId = ? LIMIT 1`).get(row.id);
    const pendingInvites = (db.prepare(`SELECT departmentIds, teamId FROM invitation WHERE organizationId = ? AND status = 'pending'`).all(ctx.organizationId) as any[])
      .some((inv) => invitationDepartmentIds(inv).includes(row.id));
    if (hasMembers || pendingInvites || hooks.departmentReferenced(ctx.organizationId, row)) {
      throw new ApiError(409, 'DEPARTMENT_IN_USE', 'Members, invitations or records still reference this department.');
    }
    db.prepare(`DELETE FROM team WHERE id = ? AND organizationId = ?`).run(row.id, ctx.organizationId);
    appendAudit(db, actor, { organizationId: ctx.organizationId, action: 'department.delete', targetType: 'department', targetId: row.id, outcome: 'success', changedFields: [] });
  })();
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

export function listInvitations(db: DB, ctx: OrgContext, query: any) {
  requirePermission(ctx, 'tenant.invitation.read');
  const { limit, offset, search } = parseListParams(query);
  const status = query.status === undefined ? 'pending' : query.status;
  if (!['pending', 'accepted', 'canceled', 'expired'].includes(status)) throw invalid('Unknown invitation status.');
  const rows = (db.prepare(`SELECT * FROM invitation WHERE organizationId = ? ORDER BY createdAt DESC, id ASC`).all(ctx.organizationId) as any[])
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
  const org = db.prepare(`SELECT name FROM organization WHERE id = ?`).get(row.organizationId) as any;
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

export function createInvitation(db: DB, ctx: OrgContext, actor: AuditActor, body: unknown, codeOnly = false) {
  if (codeOnly && ctx.tenantRole !== 'admin' && ctx.accessMode !== 'platform') throw new ApiError(403, 'INSUFFICIENT_PERMISSION');
  const input = onlyBodyKeys(body, codeOnly ? ['tenantRole', 'departmentIds'] : ['email', 'tenantRole', 'departmentIds']);
  const email = codeOnly ? '' : normalizeEmail(input.email);
  const departmentIds = validateDepartmentIds(db, ctx.organizationId, input.departmentIds ?? []);
  enforce(checkInvite(ctx, input.tenantRole, departmentIds));
  return db.transaction(() => {
    const existingMember = db.prepare(`
      SELECT 1 FROM member m JOIN "user" u ON u.id = m.userId WHERE m.organizationId = ? AND LOWER(u.email) = ?
    `).get(ctx.organizationId, email);
    if (existingMember) throw new ApiError(409, 'MEMBERSHIP_EXISTS', 'This person is already a member of the organization.');
    const pending = (db.prepare(`SELECT status, expiresAt FROM invitation WHERE organizationId = ? AND LOWER(email) = ? AND status = 'pending'`).all(ctx.organizationId, email) as any[])
      .some((row) => invitationStatus(row) === 'pending');
    if (email && pending) throw new ApiError(409, 'INVITATION_EXISTS', 'A pending invitation already exists for this email.');
    const id = crypto.randomBytes(24).toString('base64url'); // 192-bit opaque token
    const now = new Date();
    db.prepare(`
      INSERT INTO invitation (id, organizationId, email, role, teamId, status, expiresAt, createdAt, inviterId, departmentIds)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `).run(id, ctx.organizationId, email, input.tenantRole, departmentIds[0] ?? null,
      new Date(now.getTime() + INVITATION_TTL_MS).toISOString(), now.toISOString(), ctx.userId, JSON.stringify(departmentIds));
    appendAudit(db, actor, { organizationId: ctx.organizationId, action: 'invitation.create', targetType: 'invitation', targetId: id, outcome: 'success', changedFields: ['tenantRole', 'departmentIds'] });
    return db.prepare(`SELECT * FROM invitation WHERE id = ?`).get(id) as any;
  })();
}

function loadInvitation(db: DB, organizationId: string, invitationId: string) {
  const row = db.prepare(`SELECT * FROM invitation WHERE id = ? AND organizationId = ?`).get(invitationId, organizationId) as any;
  if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
  return row;
}

export function resendInvitation(db: DB, ctx: OrgContext, actor: AuditActor, invitationId: string) {
  return db.transaction(() => {
    const row = loadInvitation(db, ctx.organizationId, invitationId);
    const read = checkInvitationAction(ctx, invitationTarget(row), 'read');
    if (!read.ok) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    enforce(checkInvitationAction(ctx, invitationTarget(row), 'resend'));
    if (!['pending', 'expired'].includes(invitationStatus(row))) throw new ApiError(409, 'INVITATION_NOT_ACCEPTABLE', 'Only pending or expired invitations can be resent.');
    db.prepare(`UPDATE invitation SET status = 'pending', expiresAt = ? WHERE id = ? AND organizationId = ?`)
      .run(new Date(Date.now() + INVITATION_TTL_MS).toISOString(), row.id, ctx.organizationId);
    appendAudit(db, actor, { organizationId: ctx.organizationId, action: 'invitation.resend', targetType: 'invitation', targetId: row.id, outcome: 'success', changedFields: ['expiresAt'] });
    return loadInvitation(db, ctx.organizationId, invitationId);
  })();
}

export function cancelInvitation(db: DB, ctx: OrgContext, actor: AuditActor, invitationId: string) {
  db.transaction(() => {
    const row = loadInvitation(db, ctx.organizationId, invitationId);
    if (!checkInvitationAction(ctx, invitationTarget(row), 'read').ok) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    enforce(checkInvitationAction(ctx, invitationTarget(row), 'cancel'));
    if (!['pending', 'expired'].includes(invitationStatus(row))) throw new ApiError(409, 'INVITATION_NOT_ACCEPTABLE', 'This invitation can no longer be canceled.');
    db.prepare(`UPDATE invitation SET status = 'canceled' WHERE id = ? AND organizationId = ?`).run(row.id, ctx.organizationId);
    appendAudit(db, actor, { organizationId: ctx.organizationId, action: 'invitation.cancel', targetType: 'invitation', targetId: row.id, outcome: 'success', changedFields: ['status'] });
  })();
}

const tokenOk = (token: unknown): token is string => typeof token === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(token);

/** Minimal token preview (§8.3). No mutation. */
export function previewInvitation(db: DB, token: string) {
  if (!tokenOk(token)) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
  const row = db.prepare(`SELECT i.email, i.role, i.status, i.expiresAt, o.name AS organizationName FROM invitation i JOIN organization o ON o.id = i.organizationId WHERE i.id = ?`).get(token) as any;
  if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
  return { organizationName: row.organizationName, email: row.email || null, tenantRole: row.role, expiresAt: row.expiresAt, status: invitationStatus(row) };
}

/** Whether the inviter could still issue this invitation today (§8.3: revoked/demoted inviters lose outstanding invitations). */
function inviterStillAuthorized(db: DB, row: any): boolean {
  const inviter = db.prepare(`SELECT id, role, banned, banExpires FROM "user" WHERE id = ?`).get(row.inviterId) as any;
  if (!inviter || isIdentityBanned(inviter)) return false;
  if (inviter.role === 'superuser') return true;
  const membership = membershipOf(db, inviter.id, row.organizationId);
  if (!membership || membership.status !== 'active' || !isTenantRole(membership.role)) return false;
  if (!row.email && membership.role !== 'admin') return false;
  const ctx = membershipContext({
    organizationId: row.organizationId, userId: inviter.id, platformRole: 'user', membershipId: membership.id,
    tenantRole: membership.role, departmentIds: departmentIdsOf(db, inviter.id, row.organizationId),
  });
  return checkInvite(ctx, row.role, invitationDepartmentIds(row)).ok;
}

/** Approval and acceptance use the same current invitation checks. */
function invitationIsUsable(db: DB, row: any): boolean {
  if (invitationStatus(row) !== 'pending' || !isTenantRole(row.role)) return false;
  if (!db.prepare('SELECT 1 FROM organization WHERE id = ?').get(row.organizationId)) return false;
  const departmentIds = invitationDepartmentIds(row);
  const departmentsValid = departmentIds.every((id) => db.prepare(`SELECT 1 FROM team WHERE id = ? AND organizationId = ?`).get(id, row.organizationId));
  const comboValid = row.role === 'admin' ? departmentIds.length === 0 : departmentIds.length > 0;
  return departmentsValid && comboValid && inviterStillAuthorized(db, row);
}

/** An email invitation approves its recipient; an invite code requires possession. */
export function hasApprovalInvitation(db: DB, email: string, token?: string | null): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  if (token) {
    if (!tokenOk(token)) return false;
    const row = db.prepare('SELECT * FROM invitation WHERE id = ?').get(token) as any;
    return Boolean(row && (!row.email || String(row.email).toLowerCase() === normalizedEmail) && invitationIsUsable(db, row));
  }
  return (db.prepare("SELECT * FROM invitation WHERE LOWER(email) = ? AND email <> '' AND status = 'pending'").all(normalizedEmail) as any[])
    .some((row) => invitationIsUsable(db, row));
}

export function acceptInvitation(db: DB, identity: Identity, token: string, req: express.Request) {
  if (!tokenOk(token)) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
  return db.transaction(() => {
    const row = db.prepare(`SELECT * FROM invitation WHERE id = ?`).get(token) as any;
    if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    if (invitationStatus(row) !== 'pending') throw new ApiError(409, 'INVITATION_NOT_ACCEPTABLE', 'This invitation can no longer be accepted.');
    if (row.email && identity.email !== String(row.email).toLowerCase()) throw new ApiError(403, 'INVITATION_IDENTITY_MISMATCH', 'This invitation was issued to a different account.');
    if (!isTenantRole(row.role)) throw new ApiError(409, 'INVITATION_NOT_ACCEPTABLE', 'This invitation can no longer be accepted.');
    const departmentIds = invitationDepartmentIds(row);
    if (!invitationIsUsable(db, row)) {
      throw new ApiError(409, 'INVITATION_NOT_ACCEPTABLE', 'This invitation can no longer be accepted.');
    }
    if (membershipOf(db, identity.userId, row.organizationId)) throw new ApiError(409, 'MEMBERSHIP_EXISTS', 'You are already a member of this organization.');
    const claimed = db.prepare(`UPDATE invitation SET status = 'accepted' WHERE id = ? AND status = 'pending'`).run(row.id);
    if (claimed.changes !== 1) throw new ApiError(409, 'INVITATION_NOT_ACCEPTABLE', 'This invitation can no longer be accepted.');
    const membershipId = `mem_${crypto.randomUUID()}`;
    db.prepare(`INSERT INTO member (id, organizationId, userId, role, createdAt, status) VALUES (?, ?, ?, ?, ?, 'active')`)
      .run(membershipId, row.organizationId, identity.userId, row.role, new Date().toISOString());
    replaceAssignments(db, row.organizationId, identity.userId, departmentIds);
    appendAudit(db, { actorId: identity.userId, actorPlatformRole: identity.platformRole, accessMode: 'membership', requestId: requestIdOf(req) }, {
      organizationId: row.organizationId, action: 'invitation.accept', targetType: 'invitation', targetId: row.id, outcome: 'success', changedFields: ['status'],
    });
    const org = db.prepare(`SELECT name FROM organization WHERE id = ?`).get(row.organizationId) as any;
    return {
      id: membershipId, organizationId: row.organizationId, organizationName: org?.name || '',
      tenantRole: row.role as TenantRole, status: 'active' as const, departmentIds,
    };
  })();
}

/* ------------------------------------------------------------------ */
/* Identity DTOs                                                        */
/* ------------------------------------------------------------------ */

export function identityResponse(db: DB, identity: Identity) {
  const memberships = (db.prepare(`
    SELECT m.id, m.organizationId, o.name AS organizationName, m.role, m.status
    FROM member m JOIN organization o ON o.id = m.organizationId
    WHERE m.userId = ? ORDER BY o.name COLLATE NOCASE, m.id
  `).all(identity.userId) as any[])
    .filter((m) => isTenantRole(m.role))
    .map((m) => ({
      id: m.id, organizationId: m.organizationId, organizationName: m.organizationName,
      tenantRole: m.role as TenantRole, status: isMembershipStatus(m.status) ? m.status : 'active',
      departmentIds: departmentIdsOf(db, identity.userId, m.organizationId),
    }));
  const defaultOrganizationId = identity.sessionDefaultOrganizationId && canAccessOrganization(db, identity, identity.sessionDefaultOrganizationId)
    ? identity.sessionDefaultOrganizationId : null;
  const signInMethods = (db.prepare(`SELECT DISTINCT providerId FROM account WHERE userId = ?`).all(identity.userId) as any[])
    .map((r) => (r.providerId === 'credential' ? 'password' : String(r.providerId)));
  const profile = db.prepare('SELECT * FROM "user" WHERE id = ?').get(identity.userId) as { bio?: string | null } | undefined;
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
export function selectActiveOrganization(db: DB, identity: Identity, req: express.Request) {
  const { organizationId } = onlyBodyKeys(req.body, ['organizationId']);
  if (typeof organizationId !== 'string' || !organizationId) throw invalid('organizationId is required.');
  const headerSelectors = [req.headers['x-organization-id'], req.headers['x-tenant-id'], (req.query as any).tenantId, (req.query as any).organizationId]
    .map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
  if (headerSelectors.some((s) => s !== organizationId)) throw new ApiError(400, 'ORGANIZATION_SELECTOR_CONFLICT');
  resolveOrganizationContext(db, identity, organizationId); // 404 when not accessible
  db.prepare(`UPDATE session SET activeOrganizationId = ?, updatedAt = ? WHERE id = ?`).run(organizationId, new Date().toISOString(), identity.sessionId);
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
  onOrganizationChanged: (organizationId: string) => void;
  platformConfiguration: {
    read: () => unknown;
    patch: (section: string, values: unknown, actor: AuditActor) => unknown;
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
  const identityOf = (req: express.Request) => resolveIdentity(db, req);
  const contextOf = (req: express.Request) => {
    const identity = identityOf(req);
    // New schemas forbid redundant organization selectors in body/query.
    const extra = [req.headers['x-organization-id'], req.headers['x-tenant-id']].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
    if (extra.some((v) => v !== req.params.organizationId)) throw new RequestDenied(400, 'ORGANIZATION_SELECTOR_CONFLICT');
    const ctx = resolveOrganizationContext(db, identity, req.params.organizationId);
    return { identity, ctx, actor: auditActorFor(req, identity, ctx) };
  };
  const changed = (organizationId: string) => {
    try { options.onOrganizationChanged(organizationId); } catch (err) { console.error('[organization-admin] projection refresh failed', err); }
  };

  router.get('/me', handle((req, res) => res.json(identityResponse(db, identityOf(req)))));
  router.post('/me/organization', handle((req, res) => {
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
    const organizationId = db.transaction(() => {
      if (db.prepare("SELECT 1 FROM member WHERE userId = ? AND status = 'active'").get(identity.userId)) {
        throw new ApiError(409, 'MEMBERSHIP_EXISTS', 'You already have an organization.');
      }
      const id = createOrganizationRecord(db, { name, legalEntity: profile.legalEntity, brandName: profile.brandName,
        settings: { countryCode: policy.countryCode, industry: policy.industry, language: policy.language } }, identity.userId);
      addMembershipRecord(db, { userId: identity.userId, organizationId: id, tenantRole: 'admin' });
      appendAudit(db, auditActorFor(req, identity), { organizationId: id, action: 'organization.create', targetType: 'organization', targetId: id,
        outcome: 'success', changedFields: [...fields, 'admin'] });
      return id;
    })();
    changed(organizationId);
    res.status(201).json({ organizationId });
  }));

  router.post('/me/active-organization', handle((req, res) => res.json(selectActiveOrganization(db, identityOf(req), req))));
  /* Account Security: the caller's own sessions only (PRD §6.7). */
  router.get('/me/sessions', handle((req, res) => {
    const identity = identityOf(req);
    const rows = db.prepare(`SELECT id, createdAt, updatedAt, expiresAt, ipAddress, userAgent FROM session WHERE userId = ? ORDER BY updatedAt DESC`).all(identity.userId) as any[];
    res.json({ sessions: rows.map((r) => ({ ...r, current: r.id === identity.sessionId })) });
  }));
  router.delete('/me/sessions/:sessionId', handle((req, res) => {
    const identity = identityOf(req);
    const result = db.prepare(`DELETE FROM session WHERE id = ? AND userId = ?`).run(req.params.sessionId, identity.userId);
    if (result.changes !== 1) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    res.status(204).end();
  }));

  const org = '/organizations/:organizationId';
  router.get(`${org}/capabilities`, handle((req, res) => res.json(capabilitiesOf(contextOf(req).ctx))));
  router.get(`${org}/policy`, handle((req, res) => {
    const { ctx } = contextOf(req);
    res.json(options.policyView(ctx.organizationId));
  }));

  router.get(`${org}/settings`, handle((req, res) => {
    const { ctx } = contextOf(req);
    requirePermission(ctx, 'tenant.settings.read');
    res.json(readOrganizationSettings(db, ctx.organizationId));
  }));
  router.patch(`${org}/settings`, handle((req, res) => {
    const { ctx, actor } = contextOf(req);
    requirePermission(ctx, 'tenant.settings.update');
    const dto = patchOrganizationSettings(db, ctx.organizationId, req.body, actor);
    changed(ctx.organizationId);
    res.json(dto);
  }));

  router.get(`${org}/members`, handle((req, res) => res.json(listMembers(db, contextOf(req).ctx, req.query))));
  router.patch(`${org}/members/:membershipId`, handle((req, res) => {
    const { ctx, actor } = contextOf(req);
    res.json(updateMember(db, ctx, actor, req.params.membershipId, req.body));
  }));
  router.delete(`${org}/members/:membershipId`, handle((req, res) => {
    const { ctx, actor } = contextOf(req);
    removeMember(db, ctx, actor, req.params.membershipId);
    res.status(204).end();
  }));

  router.get(`${org}/departments`, handle((req, res) => res.json(listDepartments(db, contextOf(req).ctx, req.query))));
  router.post(`${org}/departments`, handle((req, res) => {
    const { ctx, actor } = contextOf(req);
    const dto = createDepartment(db, ctx, actor, req.body);
    changed(ctx.organizationId);
    res.status(201).json(dto);
  }));
  router.patch(`${org}/departments/:departmentId`, handle((req, res) => {
    const { ctx, actor } = contextOf(req);
    const dto = renameDepartment(db, ctx, actor, req.params.departmentId, req.body, options);
    changed(ctx.organizationId);
    res.json(dto);
  }));
  router.delete(`${org}/departments/:departmentId`, handle((req, res) => {
    const { ctx, actor } = contextOf(req);
    deleteDepartment(db, ctx, actor, req.params.departmentId, options);
    changed(ctx.organizationId);
    res.status(204).end();
  }));

  router.get(`${org}/invitations`, handle((req, res) => res.json(listInvitations(db, contextOf(req).ctx, req.query))));
  router.post(`${org}/invite-codes`, handle(async (req, res) => {
    const { identity, ctx, actor } = contextOf(req);
    const row = createInvitation(db, ctx, actor, req.body, true);
    res.status(201).json(await deliver(db, req, options, row, identity));
  }));
  router.post(`${org}/invitations`, handle(async (req, res) => {
    const { identity, ctx, actor } = contextOf(req);
    const row = createInvitation(db, ctx, actor, req.body);
    res.status(201).json(await deliver(db, req, options, row, identity));
  }));
  router.post(`${org}/invitations/:invitationId/resend`, handle(async (req, res) => {
    const { identity, ctx, actor } = contextOf(req);
    const row = resendInvitation(db, ctx, actor, req.params.invitationId);
    res.json(await deliver(db, req, options, row, identity));
  }));
  router.delete(`${org}/invitations/:invitationId`, handle((req, res) => {
    const { ctx, actor } = contextOf(req);
    cancelInvitation(db, ctx, actor, req.params.invitationId);
    res.status(204).end();
  }));

  router.get('/invitations/:token/preview', handle((req, res) => res.json(previewInvitation(db, req.params.token))));
  router.post('/invitations/:token/accept', handle((req, res) => {
    const membership = acceptInvitation(db, identityOf(req), req.params.token, req);
    res.status(201).json(membership);
  }));

  router.get(`${org}/integrations/google`, handle((req, res) => {
    const { ctx } = contextOf(req);
    requirePermission(ctx, 'tenant.integration.read');
    res.json(integrationDto(readIntegration(db, ctx.organizationId), options.providerConfigured()));
  }));
  router.patch(`${org}/integrations/google`, handle((req, res) => {
    const { ctx, actor } = contextOf(req);
    requirePermission(ctx, 'tenant.integration.update');
    const row = patchIntegration(db, ctx.organizationId, req.body, actor);
    changed(ctx.organizationId);
    res.json(integrationDto(row, options.providerConfigured()));
  }));

  router.get(`${org}/audit`, handle((req, res) => {
    const { ctx } = contextOf(req);
    requirePermission(ctx, 'tenant.audit.read');
    const { limit, offset } = parseListParams(req.query);
    const action = typeof req.query.action === 'string' ? req.query.action : undefined;
    const targetType = typeof req.query.targetType === 'string' ? req.query.targetType : undefined;
    res.json(listAudit(db, { organizationId: ctx.organizationId, action, targetType, limit, offset }));
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
  router.patch('/platform/configuration', handle((req, res) => {
    const identity = platform('platform.configuration.update')(req);
    const { section, values } = onlyBodyKeys(req.body, ['section', 'values']);
    res.json(options.platformConfiguration.patch(section, values, auditActorFor(req, identity)));
  }));
  router.get('/platform/audit', handle((req, res) => {
    platform('platform.audit.read')(req);
    const { limit, offset } = parseListParams(req.query);
    const organizationId = typeof req.query.organizationId === 'string' && req.query.organizationId ? req.query.organizationId : undefined;
    res.json(listAudit(db, {
      organizationId, limit, offset,
      action: typeof req.query.action === 'string' ? req.query.action : undefined,
      targetType: typeof req.query.targetType === 'string' ? req.query.targetType : undefined,
    }));
  }));

  return router;
}
