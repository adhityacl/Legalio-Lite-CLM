/**
 * Trusted setup service (tenant-boundaries PRD §8.4, §14.5).
 *
 * The only code that creates organizations, identities and memberships
 * outside the request-scoped administration API: first-run seeding,
 * demo/empty reset, platform creation, and explicit self-service onboarding. Memberships are
 * always explicit — an identity never gains organization access because it
 * exists, signed up first, or was approved.
 */
import type { Sql } from './db';
import crypto from 'crypto';
import { legacyMembershipRole, type PlatformRole, type TenantRole } from './rbac';
import { normalizeDepartmentName } from './recordScope';
import { defaultSettingsPayload, writeIntegrationRow, writeSettingsRow } from './organizationSettingsStore';

type DB = Sql;

export async function uniqueSlug(db: DB, name: string, preferred?: string): Promise<string> {
  const base = (preferred || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'organization';
  let slug = base;
  for (let i = 2; await db.get(`SELECT 1 FROM organization WHERE slug = ?`, slug); i++) slug = `${base}-${i}`;
  return slug;
}

export interface OrganizationSeed {
  id?: string;
  name: string;
  slug?: string;
  legalEntity?: string;
  brandName?: string;
  tagline?: string;
  logoUrl?: string;
  primaryColor?: string;
  settings?: any;
  createdAt?: string;
}

export async function createOrganizationRecord(db: DB, seed: OrganizationSeed, actorId: string | null = null): Promise<string> {
  const id = seed.id || `org_${crypto.randomUUID()}`;
  const name = String(seed.name || '').trim().slice(0, 200);
  if (!name) throw new Error('Organization name is required.');
  const payload = defaultSettingsPayload({
    legalEntity: seed.legalEntity, brandName: seed.brandName, tagline: seed.tagline,
    logoUrl: seed.logoUrl && seed.logoUrl !== '/favicon.png' ? seed.logoUrl : '', primaryColor: seed.primaryColor, policy: seed.settings,
  });
  await db.run(`INSERT INTO organization (id, name, slug, logo, "createdAt", metadata) VALUES (?, ?, ?, ?, ?, NULL)`, id, name, await uniqueSlug(db, name, seed.slug), payload.profile.logoUrl || null, seed.createdAt || new Date().toISOString());
  await writeSettingsRow(db, id, payload, 1, actorId);
  await writeIntegrationRow(db, { organizationId: id, driveFolderId: null, spreadsheetId: null, legacyAutoSync: 0, version: 1 }, actorId);
  return id;
}

export async function createTeamRecord(db: DB, organizationId: string, name: string, id?: string, createdAt?: string): Promise<string> {
  const teamId = id || `team_${crypto.randomUUID()}`;
  const at = createdAt || new Date().toISOString();
  await db.run(`INSERT INTO team (id, name, "memberCount", "organizationId", "createdAt", "updatedAt") VALUES (?, ?, 0, ?, ?, ?)`, teamId, name.trim(), organizationId, at, at);
  return teamId;
}

export async function createIdentityRecord(db: DB, input: { id?: string; name: string; email: string; platformRole: PlatformRole; emailVerified?: boolean }): Promise<string> {
  const id = input.id || `usr_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.run(`
    INSERT INTO "user" (id, name, email, "emailVerified", role, banned, "createdAt", "updatedAt")
    VALUES (?, ?, ?, ?, ?, false, ?, ?)
  `, id, input.name || input.email.split('@')[0], input.email.trim().toLowerCase(), input.emailVerified !== false, input.platformRole, now, now);
  return id;
}

export async function addMembershipRecord(db: DB, input: { userId: string; organizationId: string; tenantRole: TenantRole; departmentIds?: string[] }): Promise<string> {
  const id = `mem_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.run(`INSERT INTO member (id, "organizationId", "userId", role, "createdAt", status) VALUES (?, ?, ?, ?, ?, 'active')`, id, input.organizationId, input.userId, input.tenantRole, now);
  if (input.tenantRole !== 'admin') {
    for (const teamId of input.departmentIds || []) await db.run(`INSERT INTO "teamMember" (id, "teamId", "userId", "createdAt") VALUES (?, ?, ?, ?)`, `tm_${crypto.randomUUID()}`, teamId, input.userId, now);
  }
  return id;
}

export interface DatasetSeed {
  tenants: any[];
  departments: any[];
  allowedUsers: any[];
}

/**
 * Creates the dataset's organizations, departments and explicit fixture
 * memberships. Dataset roles are converted: a legacy global "Superuser"
 * becomes a platform superuser without membership; every other dataset
 * login is a platform user with a membership role in its own organization.
 */
export async function seedOrganizationsFromDataset(db: DB, dataset: DatasetSeed, options: { bootstrapSuperuser?: { id: string; email: string; name: string } } = {}) {
  await db.tx(async () => {
    for (const tenant of dataset.tenants) {
      await createOrganizationRecord(db, {
        id: tenant.id, name: tenant.name, slug: tenant.domainSlug, legalEntity: tenant.legalEntity,
        brandName: tenant.brandName, tagline: tenant.tagline, logoUrl: tenant.logoUrl,
        primaryColor: tenant.primaryColor, settings: tenant.settings, createdAt: tenant.created_at,
      });
    }
    for (const dept of dataset.departments) {
      if (!dataset.tenants.some((t) => t.id === dept.organizationId)) continue;
      await createTeamRecord(db, dept.organizationId, dept.name, dept.id, dept.created_at);
    }
    for (const u of dataset.allowedUsers) {
      const email = String(u.email || '').trim().toLowerCase();
      if (!email || await db.get(`SELECT 1 FROM "user" WHERE LOWER(email) = ?`, email)) continue;
      const isSuper = String(u.role || '').toLowerCase() === 'superuser';
      const userId = await createIdentityRecord(db, { id: u.id, name: u.name, email, platformRole: isSuper ? 'superuser' : 'user' });
      const tenantRole = legacyMembershipRole(u.role);
      if (isSuper || !tenantRole || !dataset.tenants.some((t) => t.id === u.organizationId)) continue;
      const teamId = (await db.all(`SELECT id, name FROM team WHERE "organizationId" = ?`, u.organizationId) as any[])
        .find((t) => normalizeDepartmentName(t.name) === normalizeDepartmentName(u.department))?.id;
      await addMembershipRecord(db, { userId, organizationId: u.organizationId, tenantRole, departmentIds: teamId ? [teamId] : [] });
    }
    const boot = options.bootstrapSuperuser;
    if (boot && !await db.get(`SELECT 1 FROM "user" WHERE id = ? OR LOWER(email) = ?`, boot.id, boot.email.toLowerCase())) {
      await createIdentityRecord(db, { id: boot.id, name: boot.name, email: boot.email, platformRole: 'superuser' });
    }
  });
}
