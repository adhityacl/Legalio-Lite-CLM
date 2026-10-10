/**
 * Authorization policy — tenant-boundaries PRD §4 and §9.3.
 *
 * Two independent role families:
 *   - PlatformRole (`user.role`): authority over this installation.
 *   - TenantRole (`member.role`): authority inside ONE organization.
 * A tenant admin is never a weaker superuser, and a superuser never gets a
 * fabricated membership. Every permission is an explicit, known string;
 * there is no wildcard and unknown permissions are always denied.
 *
 * Dependency-free on purpose so it can be unit-tested in isolation
 * (tests/rbac.test.ts) and imported by both the server and the tools.
 */

export type PlatformRole = 'user' | 'superuser';
export type TenantRole = 'admin' | 'manager' | 'editor' | 'viewer';
export type MembershipStatus = 'active' | 'suspended';
export type AccessMode = 'membership' | 'platform';

export const PLATFORM_ROLES: readonly PlatformRole[] = ['user', 'superuser'];
export const TENANT_ROLES: readonly TenantRole[] = ['admin', 'manager', 'editor', 'viewer'];
export const MEMBERSHIP_STATUSES: readonly MembershipStatus[] = ['active', 'suspended'];

/** Higher = more authority. Only meaningful inside one selected organization. */
export const TENANT_ROLE_RANK: Record<TenantRole, number> = { admin: 4, manager: 3, editor: 2, viewer: 1 };

export const isPlatformRole = (value: unknown): value is PlatformRole =>
  typeof value === 'string' && (PLATFORM_ROLES as readonly string[]).includes(value);
export const isTenantRole = (value: unknown): value is TenantRole =>
  typeof value === 'string' && (TENANT_ROLES as readonly string[]).includes(value);
export const isMembershipStatus = (value: unknown): value is MembershipStatus =>
  typeof value === 'string' && (MEMBERSHIP_STATUSES as readonly string[]).includes(value);

/** Runtime platform role from a stored `user.role`. Anything but an exact `superuser` is an ordinary user. */
export const platformRoleOf = (stored: unknown): PlatformRole => (stored === 'superuser' ? 'superuser' : 'user');

/* ------------------------------------------------------------------ */
/* Permission catalogs                                                  */
/* ------------------------------------------------------------------ */

export const PLATFORM_PERMISSIONS = [
  'platform.access',
  'platform.user.read', 'platform.user.create', 'platform.user.update',
  'platform.user.role.update', 'platform.user.ban', 'platform.user.delete',
  'platform.user.password.reset',
  'platform.session.read', 'platform.session.revoke',
  'platform.organization.read', 'platform.organization.create',
  'platform.organization.update', 'platform.organization.delete',
  'platform.organization.manage',
  'platform.apikey.read', 'platform.apikey.create',
  'platform.apikey.revoke', 'platform.apikey.delete',
  'platform.policy.read',
  'platform.configuration.read', 'platform.configuration.update',
  'platform.database.read', 'platform.database.optimize',
  'platform.application.reset', 'platform.audit.read',
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

/** §4.4 — operational grants, unchanged from the previous matrix. */
export const OPERATIONAL_PERMISSIONS: Record<TenantRole, readonly string[]> = {
  admin: ['document.view', 'document.create', 'document.edit', 'document.delete', 'document.export', 'document.download', 'export.csv', 'export.document'],
  manager: ['document.view', 'document.create', 'document.edit', 'document.delete', 'document.export', 'document.download', 'export.csv', 'export.document'],
  editor: ['document.view', 'document.create', 'document.edit', 'document.delete', 'document.download'],
  viewer: ['document.view'],
};

/** §9.3 — fixed administrative catalog. Scope limits are enforced by the check functions below. */
export const ADMINISTRATIVE_PERMISSIONS: Record<TenantRole, readonly string[]> = {
  admin: [
    'tenant.settings.read', 'tenant.settings.update',
    'tenant.member.read', 'tenant.member.invite',
    'tenant.member.role.update', 'tenant.member.status.update',
    'tenant.member.departments.update', 'tenant.member.remove',
    'tenant.invitation.read', 'tenant.invitation.resend', 'tenant.invitation.cancel',
    'department.view', 'department.create', 'department.edit', 'department.delete',
    'tenant.integration.read', 'tenant.integration.update', 'tenant.audit.read',
    'tenant.data.import',
    'workspace.view', 'workspace.switch',
  ],
  manager: [
    'tenant.member.read', 'tenant.member.invite',
    'tenant.member.role.update', 'tenant.member.status.update',
    'tenant.invitation.read', 'tenant.invitation.resend', 'tenant.invitation.cancel',
    'department.view',
    'workspace.view', 'workspace.switch',
  ],
  editor: ['workspace.view', 'workspace.switch'],
  viewer: ['workspace.view', 'workspace.switch'],
};

export const TENANT_PERMISSIONS: readonly string[] = Array.from(
  new Set(TENANT_ROLES.flatMap((r) => [...OPERATIONAL_PERMISSIONS[r], ...ADMINISTRATIVE_PERMISSIONS[r]])),
);

const KNOWN = new Set<string>([...PLATFORM_PERMISSIONS, ...TENANT_PERMISSIONS]);
export const isKnownPermission = (permission: string): boolean => KNOWN.has(permission);

export function tenantPermissionsFor(role: TenantRole): string[] {
  return [...OPERATIONAL_PERMISSIONS[role], ...ADMINISTRATIVE_PERMISSIONS[role]];
}

export function platformPermissionsFor(role: PlatformRole): string[] {
  return role === 'superuser' ? [...PLATFORM_PERMISSIONS] : [];
}

/** Effective tenant permissions of a superuser in explicit organization-management context (§5.3). */
export const PLATFORM_ORGANIZATION_PERMISSIONS: readonly string[] = tenantPermissionsFor('admin');

/* ------------------------------------------------------------------ */
/* Organization context                                                 */
/* ------------------------------------------------------------------ */

export interface OrgContext {
  organizationId: string;
  accessMode: AccessMode;
  userId: string;
  platformRole: PlatformRole;
  membershipId: string | null;
  tenantRole: TenantRole | null;
  departmentIds: string[];
  permissions: string[];
}

export function membershipContext(input: {
  organizationId: string; userId: string; platformRole: PlatformRole;
  membershipId: string; tenantRole: TenantRole; departmentIds: string[];
}): OrgContext {
  return {
    ...input,
    accessMode: 'membership',
    departmentIds: input.tenantRole === 'admin' ? [] : [...input.departmentIds],
    permissions: tenantPermissionsFor(input.tenantRole),
  };
}

export function platformContext(input: { organizationId: string; userId: string }): OrgContext {
  return {
    organizationId: input.organizationId,
    userId: input.userId,
    platformRole: 'superuser',
    accessMode: 'platform',
    membershipId: null,
    tenantRole: null,
    departmentIds: [],
    permissions: [...PLATFORM_ORGANIZATION_PERMISSIONS],
  };
}

/** Explicit known permission check. Unknown codes are always denied. */
export function can(ctx: OrgContext | null | undefined, permission: string): boolean {
  return Boolean(ctx && isKnownPermission(permission) && ctx.permissions.includes(permission));
}

/** True when the context sees the whole organization (tenant admin or platform management). */
export const hasOrganizationScope = (ctx: OrgContext): boolean =>
  ctx.accessMode === 'platform' || ctx.tenantRole === 'admin';

/** Department IDs the context is limited to, or null for organization scope. */
export const departmentScope = (ctx: OrgContext): string[] | null =>
  hasOrganizationScope(ctx) ? null : ctx.departmentIds;

/** Whether a record owned by `departmentId` (null = unverifiable) is visible to the context. */
export function inDepartmentScope(ctx: OrgContext, departmentId: string | null | undefined): boolean {
  const scope = departmentScope(ctx);
  if (scope === null) return true;
  return Boolean(departmentId) && scope.includes(departmentId as string);
}

/* ------------------------------------------------------------------ */
/* Administration rules (§4.3)                                          */
/* ------------------------------------------------------------------ */

export type Denial = {
  ok: false;
  status: 400 | 403 | 404 | 409;
  error: 'INSUFFICIENT_PERMISSION' | 'INVALID_INPUT' | 'RESOURCE_NOT_FOUND';
};
export type Verdict = { ok: true } | Denial;

const ALLOW: Verdict = { ok: true };
const deny = (status: Denial['status'], error: Denial['error']): Denial => ({ ok: false, status, error });
const FORBIDDEN = deny(403, 'INSUFFICIENT_PERMISSION');
const INVALID = deny(400, 'INVALID_INPUT');

const below = (role: TenantRole, ceiling: TenantRole) => TENANT_ROLE_RANK[role] < TENANT_ROLE_RANK[ceiling];
const fullyInside = (ids: string[], scope: string[]) => ids.length > 0 && ids.every((id) => scope.includes(id));
const intersects = (a: string[], b: string[]) => a.some((id) => b.includes(id));

/** Roles the context may assign through invitation or role change. */
export function assignableTenantRoles(ctx: OrgContext): TenantRole[] {
  if (ctx.accessMode === 'platform') return [...TENANT_ROLES];
  if (ctx.tenantRole === 'admin') return ['manager', 'editor', 'viewer'];
  if (ctx.tenantRole === 'manager') return ['editor', 'viewer'];
  return [];
}

export interface MemberTarget {
  userId: string;
  tenantRole: TenantRole;
  status: MembershipStatus;
  departmentIds: string[];
}

/** Member-list visibility: admin/platform see all, a manager sees self plus intersecting departments. */
export function canSeeMember(ctx: OrgContext, target: MemberTarget): boolean {
  if (!can(ctx, 'tenant.member.read')) return false;
  if (hasOrganizationScope(ctx)) return true;
  return target.userId === ctx.userId || intersects(target.departmentIds, ctx.departmentIds);
}

/** Role/department combination rule (§4.3 rules 5–6). `departmentIds` must already be organization-owned. */
export function checkRoleDepartments(role: TenantRole, departmentIds: string[]): Verdict {
  if (role === 'admin') return departmentIds.length === 0 ? ALLOW : INVALID;
  return departmentIds.length > 0 ? ALLOW : INVALID;
}

/** May the context act on this target at all (hierarchy + scope)? Visibility is checked separately. */
function outranks(ctx: OrgContext, target: MemberTarget): boolean {
  if (ctx.accessMode === 'platform') return true;
  if (ctx.tenantRole === 'admin') return below(target.tenantRole, 'admin');
  if (ctx.tenantRole === 'manager') {
    return below(target.tenantRole, 'manager') && fullyInside(target.departmentIds, ctx.departmentIds);
  }
  return false;
}

export function checkInvite(ctx: OrgContext, role: unknown, departmentIds: string[]): Verdict {
  if (!can(ctx, 'tenant.member.invite')) return FORBIDDEN;
  if (!isTenantRole(role)) return INVALID;
  if (!assignableTenantRoles(ctx).includes(role)) return FORBIDDEN;
  const combo = checkRoleDepartments(role, departmentIds);
  if (!combo.ok) return combo;
  if (ctx.tenantRole === 'manager' && ctx.accessMode === 'membership' && !fullyInside(departmentIds, ctx.departmentIds)) {
    return FORBIDDEN;
  }
  return ALLOW;
}

export interface MemberChange {
  tenantRole?: unknown;
  status?: unknown;
  departmentIds?: string[];
}

/**
 * §4.3 update rules. Returns the verdict for the combined change; every
 * changed field needs its own permission and the target must be below the
 * actor (and, for a manager, wholly inside its departments).
 */
export function checkMemberUpdate(ctx: OrgContext, target: MemberTarget, change: MemberChange): Verdict {
  const fields = (['tenantRole', 'status', 'departmentIds'] as const).filter((f) => change[f] !== undefined);
  if (fields.length === 0) return INVALID;
  if (change.tenantRole !== undefined && !isTenantRole(change.tenantRole)) return INVALID;
  if (change.status !== undefined && !isMembershipStatus(change.status)) return INVALID;
  if (change.departmentIds !== undefined && !Array.isArray(change.departmentIds)) return INVALID;
  if (target.userId === ctx.userId) return FORBIDDEN; // never self-administer (rule 2)
  if (!canSeeMember(ctx, target)) return deny(404, 'RESOURCE_NOT_FOUND');
  if (!outranks(ctx, target)) return FORBIDDEN;

  if (change.tenantRole !== undefined) {
    if (!can(ctx, 'tenant.member.role.update')) return FORBIDDEN;
    if (!assignableTenantRoles(ctx).includes(change.tenantRole as TenantRole)) return FORBIDDEN;
  }
  if (change.status !== undefined && !can(ctx, 'tenant.member.status.update')) return FORBIDDEN;
  if (change.departmentIds !== undefined && !can(ctx, 'tenant.member.departments.update')) return FORBIDDEN;

  const nextRole = (change.tenantRole as TenantRole | undefined) ?? target.tenantRole;
  if (change.tenantRole !== undefined || change.departmentIds !== undefined) {
    // Promotion to admin drops this organization's assignments (rule 5).
    const nextDepartments = nextRole === 'admin' ? [] : change.departmentIds ?? target.departmentIds;
    const combo = checkRoleDepartments(nextRole, nextDepartments);
    if (!combo.ok) return combo;
  }
  return ALLOW;
}

export function checkMemberRemove(ctx: OrgContext, target: MemberTarget): Verdict {
  if (target.userId === ctx.userId) return FORBIDDEN;
  if (!canSeeMember(ctx, target)) return deny(404, 'RESOURCE_NOT_FOUND');
  if (!can(ctx, 'tenant.member.remove')) return FORBIDDEN;
  return outranks(ctx, target) ? ALLOW : FORBIDDEN;
}

export interface InvitationTarget {
  tenantRole: TenantRole;
  departmentIds: string[];
}

/** Invitation visibility and resend/cancel authority (§4.3). */
export function checkInvitationAction(
  ctx: OrgContext,
  invitation: InvitationTarget,
  action: 'read' | 'resend' | 'cancel',
): Verdict {
  if (!can(ctx, `tenant.invitation.${action}`)) return FORBIDDEN;
  if (ctx.accessMode === 'platform') return ALLOW;
  if (!assignableTenantRoles(ctx).includes(invitation.tenantRole)) {
    return action === 'read' ? deny(404, 'RESOURCE_NOT_FOUND') : FORBIDDEN;
  }
  if (ctx.tenantRole === 'manager' && !fullyInside(invitation.departmentIds, ctx.departmentIds)) {
    return action === 'read' ? deny(404, 'RESOURCE_NOT_FOUND') : FORBIDDEN;
  }
  return ALLOW;
}

/* ------------------------------------------------------------------ */
/* Legacy membership role normalization (migration only)                */
/* ------------------------------------------------------------------ */

/** §14.2 rule 2 — documented legacy membership values. Unknown or combined values return null. */
export function legacyMembershipRole(value: unknown): TenantRole | null {
  const raw = String(value ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
  if (isTenantRole(raw)) return raw;
  const map: Record<string, TenantRole> = { owner: 'admin', legal: 'manager', finance: 'editor', staff: 'viewer', member: 'viewer' };
  return map[raw] ?? null;
}

/** §14.2 rules 3–4 — legacy global role. `null` means an explicit reviewed resolution is required. */
export function legacyPlatformRole(value: unknown): PlatformRole | null {
  const raw = String(value ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (raw === 'superuser' || raw === 'super_admin') return 'superuser';
  if (['user', 'admin', 'manager', 'editor', 'viewer', 'legal', 'finance', 'staff', 'member'].includes(raw)) return 'user';
  return null;
}

/* ------------------------------------------------------------------ */
/* Matrix (generated docs / platform-only matrix endpoint)              */
/* ------------------------------------------------------------------ */

export function buildMatrix() {
  return {
    platformRoles: PLATFORM_ROLES.map((role) => ({ role, permissions: platformPermissionsFor(role) })),
    tenantRoles: TENANT_ROLES.map((role) => ({ role, permissions: tenantPermissionsFor(role) })),
    platformPermissions: [...PLATFORM_PERMISSIONS],
    tenantPermissions: [...TENANT_PERMISSIONS],
  };
}
