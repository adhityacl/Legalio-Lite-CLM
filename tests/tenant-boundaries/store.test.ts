/**
 * Canonical store transactions (PRD §5.4, §7.4, AC-035): a mutation and its
 * audit event commit together or not at all; validation rejects unknown fields.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { ensureTenantBoundarySchema, patchIntegration, patchOrganizationSettings, readOrganizationSettings } from '../../apps/backend/src/organizationSettingsStore';
import { addMembershipRecord, createIdentityRecord, createOrganizationRecord, createTeamRecord } from '../../apps/backend/src/organizationProvisioning';
import { updateMember } from '../../apps/backend/src/organizationAdminRoutes';
import { platformContext } from '../../apps/backend/src/rbac';

const actor = { actorId: 'u-admin', actorPlatformRole: 'user' as const, accessMode: 'membership' as const, requestId: 'req-test' };

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL, image TEXT, createdAt DATE NOT NULL, updatedAt DATE NOT NULL, role TEXT, banned INTEGER, banReason TEXT, banExpires DATE);
    CREATE TABLE organization (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE, logo TEXT, createdAt DATE, metadata TEXT);
    CREATE TABLE team (id TEXT PRIMARY KEY, name TEXT NOT NULL, memberCount INTEGER DEFAULT 0, organizationId TEXT NOT NULL, createdAt DATE, updatedAt DATE);
    CREATE TABLE teamMember (id TEXT PRIMARY KEY, teamId TEXT NOT NULL, userId TEXT NOT NULL, membershipKey TEXT, createdAt DATE);
    CREATE TABLE member (id TEXT PRIMARY KEY, organizationId TEXT NOT NULL, userId TEXT NOT NULL, role TEXT NOT NULL, createdAt DATE);
    CREATE TABLE invitation (id TEXT PRIMARY KEY, organizationId TEXT NOT NULL, email TEXT NOT NULL, role TEXT, teamId TEXT, status TEXT NOT NULL, expiresAt DATE, createdAt DATE, inviterId TEXT NOT NULL);
  `);
  ensureTenantBoundarySchema(db);
  createIdentityRecord(db, { id: 'u-admin', name: 'Admin', email: 'admin@example.test', platformRole: 'user' });
  createIdentityRecord(db, { id: 'u-viewer', name: 'Viewer', email: 'viewer@example.test', platformRole: 'user' });
  createOrganizationRecord(db, { id: 'org-a', name: 'Alpha' });
  createOrganizationRecord(db, { id: 'org-b', name: 'Beta' });
  createTeamRecord(db, 'org-a', 'Legal', 't-legal');
  addMembershipRecord(db, { userId: 'u-admin', organizationId: 'org-a', tenantRole: 'admin' });
  addMembershipRecord(db, { userId: 'u-viewer', organizationId: 'org-a', tenantRole: 'viewer', departmentIds: ['t-legal'] });
  return db;
}

describe('atomic mutation + audit (AC-035)', () => {
  it('settings write rolls back when the audit insert fails', () => {
    const db = freshDb();
    db.exec(`DROP TABLE audit_log`);
    assert.throws(() => patchOrganizationSettings(db, 'org-a', { expectedVersion: 1, name: 'Renamed' }, actor));
    const after = readOrganizationSettings(db, 'org-a');
    assert.equal(after.name, 'Alpha');
    assert.equal(after.version, 1);
  });

  it('membership change rolls back when the audit insert fails', () => {
    const db = freshDb();
    db.exec(`DROP TABLE audit_log`);
    const membershipId = (db.prepare(`SELECT id FROM member WHERE userId = 'u-viewer'`).get() as any).id;
    assert.throws(() => updateMember(db, platformContext({ organizationId: 'org-a', userId: 'u-super' }), actor, membershipId, { status: 'suspended' }));
    assert.equal((db.prepare(`SELECT status FROM member WHERE id = ?`).get(membershipId) as any).status, 'active');
  });
});

describe('strict validation (§7.4)', () => {
  it('rejects unknown fields, stale versions and other organizations’ resources', () => {
    const db = freshDb();
    assert.throws(() => patchOrganizationSettings(db, 'org-a', { expectedVersion: 1, smtpHost: 'x' }, actor), /Unknown field/);
    assert.throws(() => patchOrganizationSettings(db, 'org-a', { expectedVersion: 1, policy: { timezone: 'Mars/Base' } }, actor), /timezone/i);
    assert.throws(() => patchOrganizationSettings(db, 'org-a', { expectedVersion: 1, profile: { logoUrl: 'javascript:alert(1)' } }, actor), /Logo/);
    assert.throws(() => patchOrganizationSettings(db, 'org-a', { expectedVersion: 1, notifications: { notificationEmails: ['not-an-email'] } }, actor), /email/i);
    assert.throws(() => patchOrganizationSettings(db, 'org-a', { expectedVersion: 7, name: 'x' }, actor), /changed by someone else/);
    const ok = patchOrganizationSettings(db, 'org-a', { expectedVersion: 1, policy: { modules: { spending: false }, reminderOffsetsDays: [7, 30] } }, actor);
    assert.equal(ok.policy.modules.spending, false);
    assert.equal(ok.policy.modules.commercialDocuments, true); // nested merge keeps unrelated keys
    assert.deepEqual(ok.policy.reminderOffsetsDays, [30, 7]);
    patchIntegration(db, 'org-a', { expectedVersion: 1, driveFolderId: 'folderAlpha_0001' }, actor);
    assert.throws(() => patchIntegration(db, 'org-b', { expectedVersion: 1, driveFolderId: 'folderAlpha_0001' }, actor), /cannot be used/);
  });
});
