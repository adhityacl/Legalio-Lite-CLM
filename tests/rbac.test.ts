/**
 * Policy unit tests — tenant-boundaries PRD §4.3 (administration matrix),
 * §4.4 (operational grants), §9.3 (catalog), §14.2 (legacy role mapping)
 * and §4.5.3 (department ownership by exact match).
 *
 * Run: npx tsx --test tests/rbac.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import {
  PLATFORM_PERMISSIONS, TENANT_ROLES, assignableTenantRoles, can, canSeeMember, checkInvitationAction, checkInvite,
  checkMemberRemove, checkMemberUpdate, departmentScope, inDepartmentScope, isKnownPermission, legacyMembershipRole,
  legacyPlatformRole, membershipContext, platformContext, platformPermissionsFor, platformRoleOf, tenantPermissionsFor,
  type MemberTarget, type OrgContext, type TenantRole,
} from '../apps/backend/src/rbac';
import { createOrganizationScope, filterRecords, normalizeDepartmentName } from '../apps/backend/src/recordScope';

const ORG = 'org-a';
const ctx = (tenantRole: TenantRole, departmentIds: string[] = [], userId = `u-${tenantRole}`): OrgContext =>
  membershipContext({ organizationId: ORG, userId, platformRole: 'user', membershipId: `m-${userId}`, tenantRole, departmentIds });
const SUPER = platformContext({ organizationId: ORG, userId: 'u-super' });
const ADMIN = ctx('admin');
const MANAGER = ctx('manager', ['legal']);
const EDITOR = ctx('editor', ['legal']);
const VIEWER = ctx('viewer', ['legal']);
const target = (tenantRole: TenantRole, departmentIds: string[], userId = `t-${tenantRole}-${departmentIds.join('+')}`): MemberTarget =>
  ({ userId, tenantRole, status: 'active', departmentIds });
const ok = (v: { ok: boolean }) => v.ok;

/* ----------------------------- roles & catalog ----------------------------- */

test('§4.2 platform role is user unless exactly superuser', () => {
  assert.equal(platformRoleOf('superuser'), 'superuser');
  for (const value of ['admin', 'Superuser', 'owner', '', null, 'super_admin']) assert.equal(platformRoleOf(value), 'user');
});

test('§9.3 only superuser holds platform permissions; ordinary identities hold none', () => {
  assert.deepEqual(platformPermissionsFor('superuser'), [...PLATFORM_PERMISSIONS]);
  assert.deepEqual(platformPermissionsFor('user'), []);
});

test('§4.2 no wildcard: unknown permissions are denied even in platform context', () => {
  assert.equal(isKnownPermission('*'), false);
  assert.equal(can(SUPER, '*'), false);
  assert.equal(can(SUPER, 'tenant.anything'), false);
  assert.equal(can(ADMIN, 'platform.configuration.update'), false);
});

test('§4.4 operational grants are unchanged (editor deletes, viewer only views)', () => {
  assert.ok(can(EDITOR, 'document.delete'));
  assert.equal(can(EDITOR, 'document.export'), false);
  assert.equal(can(VIEWER, 'document.download'), false);
  assert.deepEqual(tenantPermissionsFor('viewer').filter((p) => p.startsWith('document.')), ['document.view']);
  assert.ok(can(MANAGER, 'export.csv'));
});

test('§9.3 administrative catalog per tenant role', () => {
  for (const p of ['tenant.settings.update', 'tenant.integration.update', 'tenant.audit.read', 'department.create', 'tenant.member.remove', 'tenant.data.import']) {
    assert.ok(can(ADMIN, p), p);
    assert.equal(can(MANAGER, p), false, p);
  }
  for (const p of ['tenant.member.read', 'tenant.member.invite', 'tenant.member.role.update', 'tenant.invitation.cancel']) assert.ok(can(MANAGER, p), p);
  for (const role of [EDITOR, VIEWER]) assert.equal(can(role, 'tenant.member.read'), false);
});

test('§5.3 platform context: no fabricated membership, admin-equivalent tenant permissions', () => {
  assert.equal(SUPER.tenantRole, null);
  assert.equal(SUPER.membershipId, null);
  assert.equal(SUPER.accessMode, 'platform');
  assert.ok(can(SUPER, 'tenant.settings.update'));
  assert.deepEqual(assignableTenantRoles(SUPER), [...TENANT_ROLES]);
});

/* ----------------------------- §4.3 invitations ----------------------------- */

test('§4.3 invite: admin → manager/editor/viewer only; manager → editor/viewer in own departments', () => {
  assert.ok(ok(checkInvite(ADMIN, 'manager', ['legal'])));
  assert.equal(checkInvite(ADMIN, 'admin', []).ok, false);
  assert.ok(ok(checkInvite(MANAGER, 'viewer', ['legal'])));
  assert.equal(checkInvite(MANAGER, 'manager', ['legal']).ok, false);
  assert.equal(checkInvite(MANAGER, 'editor', ['finance']).ok, false);
  assert.equal(checkInvite(MANAGER, 'editor', ['legal', 'finance']).ok, false);
  assert.equal(checkInvite(EDITOR, 'viewer', ['legal']).ok, false);
  assert.ok(ok(checkInvite(SUPER, 'admin', [])));
});

test('§8.3 invite: role/department combination and unknown roles', () => {
  assert.equal(checkInvite(SUPER, 'admin', ['legal']).ok, false);
  assert.equal(checkInvite(ADMIN, 'viewer', []).ok, false);
  assert.equal(checkInvite(SUPER, 'superuser', []).ok, false);
  assert.equal(checkInvite(ADMIN, 'viewer,editor', ['legal']).ok, false);
});

/* ----------------------------- §4.3 member changes ----------------------------- */

test('§4.3 rule 1: tenant admin cannot appoint or demote a peer admin', () => {
  assert.equal(checkMemberUpdate(ADMIN, target('manager', ['legal']), { tenantRole: 'admin' }).ok, false);
  assert.equal(checkMemberUpdate(ADMIN, target('admin', []), { tenantRole: 'viewer', departmentIds: ['legal'] }).ok, false);
  assert.equal(checkMemberRemove(ADMIN, target('admin', [])).ok, false);
  assert.ok(ok(checkMemberUpdate(SUPER, target('manager', ['legal']), { tenantRole: 'admin' })));
});

test('§4.3 rule 2: never self-administer through member administration', () => {
  const self = target('manager', ['legal'], ADMIN.userId);
  assert.equal(checkMemberUpdate(ADMIN, self, { status: 'suspended' }).ok, false);
  assert.equal(checkMemberRemove(ADMIN, self).ok, false);
});

test('§4.3 rule 6: non-admin roles need at least one department', () => {
  assert.equal(checkMemberUpdate(ADMIN, target('viewer', ['legal']), { departmentIds: [] }).ok, false);
  assert.ok(ok(checkMemberUpdate(ADMIN, target('viewer', ['legal']), { departmentIds: ['finance'] })));
  // Promotion to admin drops assignments, so no department is required.
  assert.ok(ok(checkMemberUpdate(SUPER, target('viewer', ['legal']), { tenantRole: 'admin' })));
});

test('AC-014 manager with partial overlap: sees target, cannot change it', () => {
  const both = target('editor', ['legal', 'finance']);
  assert.ok(canSeeMember(MANAGER, both));
  assert.equal(checkMemberUpdate(MANAGER, both, { status: 'suspended' }).ok, false);
  assert.equal(checkMemberUpdate(MANAGER, both, { tenantRole: 'viewer' }).ok, false);
  const inside = target('editor', ['legal']);
  assert.ok(ok(checkMemberUpdate(MANAGER, inside, { tenantRole: 'viewer' })));
  assert.ok(ok(checkMemberUpdate(MANAGER, inside, { status: 'suspended' })));
});

test('§4.3 manager: no department reassignment, no removal, no promotion to manager', () => {
  const inside = target('viewer', ['legal']);
  assert.equal(checkMemberUpdate(MANAGER, inside, { departmentIds: ['legal'] }).ok, false);
  assert.equal(checkMemberRemove(MANAGER, inside).ok, false);
  assert.equal(checkMemberUpdate(MANAGER, inside, { tenantRole: 'manager' }).ok, false);
  assert.equal(checkMemberUpdate(MANAGER, target('manager', ['legal']), { status: 'suspended' }).ok, false);
});

test('§4.3 manager visibility: self + intersecting departments only', () => {
  assert.ok(canSeeMember(MANAGER, target('viewer', ['legal'])));
  assert.ok(canSeeMember(MANAGER, target('manager', ['finance'], MANAGER.userId)));
  assert.equal(canSeeMember(MANAGER, target('viewer', ['finance'])), false);
  assert.equal(canSeeMember(EDITOR, target('viewer', ['legal'])), false);
  // invisible targets answer as not found, not forbidden
  assert.equal((checkMemberUpdate(MANAGER, target('viewer', ['finance']), { status: 'suspended' }) as any).status, 404);
});

test('§4.3 invalid inputs on writes are rejected', () => {
  assert.equal(checkMemberUpdate(ADMIN, target('viewer', ['legal']), {}).ok, false);
  assert.equal(checkMemberUpdate(ADMIN, target('viewer', ['legal']), { tenantRole: 'owner' }).ok, false);
  assert.equal(checkMemberUpdate(ADMIN, target('viewer', ['legal']), { status: 'banned' }).ok, false);
});

test('§4.3 invitation actions follow the same hierarchy and scope', () => {
  assert.ok(ok(checkInvitationAction(ADMIN, { tenantRole: 'viewer', departmentIds: ['legal'] }, 'cancel')));
  assert.equal(checkInvitationAction(ADMIN, { tenantRole: 'admin', departmentIds: [] }, 'resend').ok, false);
  assert.ok(ok(checkInvitationAction(MANAGER, { tenantRole: 'editor', departmentIds: ['legal'] }, 'resend')));
  assert.equal(checkInvitationAction(MANAGER, { tenantRole: 'editor', departmentIds: ['legal', 'finance'] }, 'cancel').ok, false);
  assert.equal(checkInvitationAction(VIEWER, { tenantRole: 'viewer', departmentIds: ['legal'] }, 'read').ok, false);
});

/* ----------------------------- scope ----------------------------- */

test('§4.5.2 department scope: admin/platform organization-wide, others need a verifiable department', () => {
  assert.equal(departmentScope(ADMIN), null);
  assert.equal(departmentScope(SUPER), null);
  assert.deepEqual(departmentScope(VIEWER), ['legal']);
  assert.equal(inDepartmentScope(VIEWER, null), false);
  assert.equal(inDepartmentScope(VIEWER, 'finance'), false);
  assert.ok(inDepartmentScope(VIEWER, 'legal'));
  // legacy membership with no departments sees nothing operational
  assert.equal(inDepartmentScope(ctx('viewer', []), 'legal'), false);
});

test('§4.5.3 record ownership resolves by exact normalized department name, never substrings', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE team (id TEXT, name TEXT, organizationId TEXT)`);
  db.prepare('INSERT INTO team VALUES (?, ?, ?)').run('legal', 'Legal', ORG);
  db.prepare('INSERT INTO team VALUES (?, ?, ?)').run('finance', 'Finance  & Tax', ORG);
  db.prepare('INSERT INTO team VALUES (?, ?, ?)').run('b-legal', 'Legal', 'org-b');
  const partners = [
    { partner_id: 'P1', organizationId: ORG, nama_partner: 'Acme', pic_internal: '  legal ' },
    { partner_id: 'P2', organizationId: ORG, nama_partner: 'Beta', pic_internal: 'Finance & Tax' },
    { partner_id: 'P3', organizationId: ORG, nama_partner: 'Gamma', pic_internal: 'Legal & Compliance' },
    { partner_id: 'P4', organizationId: 'org-b', nama_partner: 'Delta', pic_internal: 'Legal' },
    { partner_id: 'P5', organizationId: null, nama_partner: 'Orphan', pic_internal: 'Legal' },
  ];
  const contracts = [
    { contract_id: 'C1', organizationId: ORG, partner_id: 'P1' },
    { contract_id: 'C2', organizationId: ORG, partner_id: 'PX', pic_internal: 'Legal' },
  ];
  const scope = createOrganizationScope(db, ORG, { partners, contracts, ios: [] });
  assert.equal(normalizeDepartmentName('  Finance   &  Tax '), 'finance & tax');
  assert.deepEqual(filterRecords(VIEWER, scope, 'partner', partners).map((p) => p.partner_id), ['P1']);
  assert.deepEqual(filterRecords(ctx('viewer', ['finance']), scope, 'partner', partners).map((p) => p.partner_id), ['P2']);
  assert.deepEqual(filterRecords(ADMIN, scope, 'partner', partners).map((p) => p.partner_id), ['P1', 'P2', 'P3']);
  assert.deepEqual(filterRecords(VIEWER, scope, 'contract', contracts).map((c) => c.contract_id), ['C1', 'C2']);
});

/* ----------------------------- §14.2 legacy mapping ----------------------------- */

test('§14.2 membership roles: documented legacy values only', () => {
  assert.equal(legacyMembershipRole('owner'), 'admin');
  assert.equal(legacyMembershipRole(' Legal '), 'manager');
  assert.equal(legacyMembershipRole('finance'), 'editor');
  assert.equal(legacyMembershipRole('staff'), 'viewer');
  assert.equal(legacyMembershipRole('member'), 'viewer');
  assert.equal(legacyMembershipRole('editor,viewer'), null);
  assert.equal(legacyMembershipRole('superuser'), null);
  assert.equal(legacyMembershipRole(''), null);
});

test('§14.2 global roles: tenant-shaped values become platform user, bare owner is ambiguous', () => {
  assert.equal(legacyPlatformRole('superuser'), 'superuser');
  assert.equal(legacyPlatformRole('Super Admin'), 'superuser');
  assert.equal(legacyPlatformRole('admin'), 'user');
  assert.equal(legacyPlatformRole('staff'), 'user');
  assert.equal(legacyPlatformRole('owner'), null);
  assert.equal(legacyPlatformRole(null), null);
  assert.equal(legacyPlatformRole('nonsense'), null);
});
