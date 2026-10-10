/**
 * Mocked tenant-boundaries API contract for fixture browser tests (PRD §9.1, §11.4).
 *
 * Serves the identity, organization-selection, capability, policy and Settings
 * endpoints from synthetic data. Permission lists come from the server policy
 * catalog (server/rbac.ts) — explicit, never a wildcard. Nothing here opens a
 * database or reaches a real server.
 */
import type { Request } from '@playwright/test';
import { PLATFORM_ORGANIZATION_PERMISSIONS, PLATFORM_PERMISSIONS, TENANT_ROLES, tenantPermissionsFor, type TenantRole } from '../../../apps/backend/src/rbac';
import { defaultTenantSettings, getCountryPack, getIndustryPack } from '@legalio/shared/policy';
import type { Tenant, TenantSettings } from '@legalio/types';

export interface FixtureOrganization extends Tenant { settings: TenantSettings }

export interface TenantApiOptions {
  /** Tenant projection rows (synthetic or from buildDemoDataset); each needs `id`, `name` and `settings`. */
  organizations: Array<Record<string, any>>;
  /** Membership role per organization ID; missing means no membership. */
  roles?: Record<string, TenantRole>;
  platformRole?: 'user' | 'superuser';
  /** Session default organization (the server's validated `activeTenantId`). */
  sessionDefault?: string | null;
  departments?: Array<{ id: string; name: string }>;
  /** Department assignments for non-admin memberships. */
  departmentIds?: string[];
  email?: string;
  name?: string;
  /** Identity ID (default `fixture-user`). */
  userId?: string;
}

export const FIXTURE_USER_ID = 'fixture-user';
export const DEFAULT_DEPARTMENTS = [{ id: 'dept-legal', name: 'Legal' }, { id: 'dept-finance', name: 'Finance' }];

/** One synthetic organization; `settings` defaults to the neutral policy. */
export function fixtureOrganization(id: string, name: string, settings: Partial<TenantSettings> = {}): FixtureOrganization {
  return { id, name, settings: { ...defaultTenantSettings(), ...settings } };
}

/** `GET /api/organizations/:id/policy` (TenantPolicyView). */
export function policyView(organization: Record<string, any>, overrides: Record<string, unknown> = {}) {
  const settings = organization.settings;
  return {
    tenantId: organization.id, tenantName: organization.name, settings,
    country: getCountryPack(settings.countryCode), industry: getIndustryPack(settings.industry),
    dueDiligenceChecklist: [], ...overrides,
  };
}

/** `GET /api/init-data` WorkspaceInitResponse with records scoped to one organization. */
export function workspaceInit(organizationId: string, data: object, services = { aiAvailable: true, googleUploadsAvailable: false }) {
  const scoped = (key: string) => ((data as Record<string, unknown[]>)[key] || []).filter((row: any) => !row.organizationId || row.organizationId === organizationId);
  return {
    organizationId,
    contracts: scoped('contracts'), ios: scoped('ios'), partners: scoped('partners'), notifications: scoped('notifications'),
    evaluations: scoped('evaluations'), spendings: scoped('spendings'), services, timestamp: Date.now(),
  };
}

const ORG_PATH = /^\/api\/organizations\/([^/]+)(\/.*)$/;

/**
 * Returns a handler for the tenant-boundaries endpoints. `handle()` gives the
 * JSON body (or `{ status, json }` for errors) for a known endpoint, and
 * `undefined` for anything else so a spec can serve its own fixtures.
 */
export function createTenantApi(options: TenantApiOptions) {
  const state = {
    ...options,
    organizations: options.organizations as FixtureOrganization[],
    roles: options.roles ?? Object.fromEntries(options.organizations.map((org) => [org.id, 'admin' as TenantRole])),
    platformRole: options.platformRole ?? 'user',
    sessionDefault: options.sessionDefault === undefined ? (options.organizations.length === 1 ? options.organizations[0].id : null) : options.sessionDefault,
    departments: options.departments ?? DEFAULT_DEPARTMENTS,
    departmentIds: options.departmentIds ?? [DEFAULT_DEPARTMENTS[0].id],
    settingsVersion: {} as Record<string, number>,
  };
  const org = (id: string) => state.organizations.find((item) => item.id === id);
  const isSuperuser = () => state.platformRole === 'superuser';
  const accessible = () => state.organizations.filter((item) => isSuperuser() || state.roles[item.id]);
  const deptsFor = (role: TenantRole) => (role === 'admin' ? [] : state.departmentIds);

  const capabilities = (organizationId: string) => {
    const role = state.roles[organizationId];
    if (role) {
      const higher = TENANT_ROLES.filter((r) => r !== 'admin' && (role === 'admin' || (role === 'manager' && (r === 'editor' || r === 'viewer'))));
      return {
        organizationId, accessMode: 'membership', membershipId: `m-${organizationId}`, tenantRole: role,
        departmentIds: deptsFor(role), permissions: tenantPermissionsFor(role),
        assignableTenantRoles: role === 'admin' || role === 'manager' ? higher : [],
      };
    }
    return {
      organizationId, accessMode: 'platform', membershipId: null, tenantRole: null, departmentIds: [],
      permissions: [...PLATFORM_ORGANIZATION_PERMISSIONS], assignableTenantRoles: [...TENANT_ROLES],
    };
  };

  const settingsDto = (organization: FixtureOrganization) => ({
    organizationId: organization.id, name: organization.name, slug: organization.domainSlug || organization.id,
    profile: {
      legalEntity: organization.legalEntity || '', brandName: organization.brandName || organization.name,
      tagline: organization.tagline || '', logoUrl: organization.logoUrl || '', primaryColor: organization.primaryColor || '#06C755',
    },
    policy: organization.settings,
    notifications: { notificationEmails: [], legalNotificationEmail: null, financeNotificationEmail: null },
    version: state.settingsVersion[organization.id] ?? 1,
  });

  const handle = (request: Request): unknown => {
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path === '/api/me') {
      return {
        identity: {
          id: state.userId ?? FIXTURE_USER_ID, email: state.email ?? 'audit@example.test', name: state.name ?? 'UI Audit', image: null,
          emailVerified: true, platformRole: state.platformRole,
        },
        signInMethods: ['password'],
        memberships: state.organizations.filter((item) => state.roles[item.id]).map((item) => ({
          id: `m-${item.id}`, organizationId: item.id, organizationName: item.name, tenantRole: state.roles[item.id],
          status: 'active', departmentIds: deptsFor(state.roles[item.id]),
        })),
        platformPermissions: isSuperuser() ? [...PLATFORM_PERMISSIONS] : [],
        defaultOrganizationId: state.sessionDefault,
      };
    }
    if (path === '/api/tenants' && method === 'GET') {
      return {
        success: true,
        tenants: accessible(),
        organizations: accessible().map((item) => ({
          organizationId: item.id, organizationName: item.name, slug: item.domainSlug || item.id, logoUrl: item.logoUrl || null,
          tenantRole: state.roles[item.id] ?? null, accessMode: state.roles[item.id] && !isSuperuser() ? 'membership' : 'platform',
        })),
        activeTenantId: state.sessionDefault,
      };
    }
    if ((path === '/api/me/active-organization' || path === '/api/tenants/switch') && method === 'POST') {
      const body = request.postDataJSON() || {};
      const id = body.organizationId ?? body.tenantId;
      if (!accessible().some((item) => item.id === id)) return { status: 404, json: { error: 'RESOURCE_NOT_FOUND', message: 'Not found', requestId: 'fixture' } };
      state.sessionDefault = id;
      return path === '/api/tenants/switch' ? { success: true, activeTenantId: id } : { organizationId: id };
    }
    if (path === '/api/departments') {
      const id = request.headers()['x-organization-id'];
      const role = id ? state.roles[id] : undefined;
      const items = !role || role === 'admin' ? state.departments : state.departments.filter((d) => state.departmentIds.includes(d.id));
      return { success: true, departments: items.map((d) => d.name), items };
    }
    if (path === '/api/policy-packs') return { countries: [], industries: [] };
    const match = path.match(ORG_PATH);
    if (!match) return undefined;
    const [, rawId, suffix] = match;
    const organization = org(decodeURIComponent(rawId));
    if (!organization || !accessible().includes(organization)) return { status: 404, json: { error: 'RESOURCE_NOT_FOUND', message: 'Not found', requestId: 'fixture' } };
    const caps = capabilities(organization.id);
    const denied = { status: 403, json: { error: 'INSUFFICIENT_PERMISSION', message: 'Not allowed', requestId: 'fixture' } };
    const need = (permission: string) => caps.permissions.includes(permission);
    if (suffix === '/capabilities') return caps;
    if (suffix === '/policy') return policyView(organization);
    if (suffix === '/settings') {
      if (!need('tenant.settings.read')) return denied;
      if (method === 'PATCH') {
        const body = request.postDataJSON() || {};
        if (body.expectedVersion !== (state.settingsVersion[organization.id] ?? 1)) {
          return { status: 409, json: { error: 'VERSION_CONFLICT', message: 'Stale version', requestId: 'fixture' } };
        }
        if (body.name) organization.name = body.name;
        if (body.profile) Object.assign(organization, body.profile);
        if (body.policy) organization.settings = { ...organization.settings, ...body.policy };
        state.settingsVersion[organization.id] = (state.settingsVersion[organization.id] ?? 1) + 1;
      }
      return settingsDto(organization);
    }
    if (suffix.startsWith('/members')) {
      if (!need('tenant.member.read')) return denied;
      return {
        members: [{
          id: `m-${organization.id}`, userId: state.userId ?? FIXTURE_USER_ID, name: state.name ?? 'UI Audit', email: state.email ?? 'audit@example.test',
          tenantRole: state.roles[organization.id] ?? 'admin', status: 'active', departmentIds: deptsFor(state.roles[organization.id] ?? 'admin'), createdAt: new Date(0).toISOString(),
        }],
        total: 1,
      };
    }
    if (suffix.startsWith('/departments')) {
      if (!need('department.view')) return denied;
      const role = state.roles[organization.id];
      const items = (!role || role === 'admin' ? state.departments : state.departments.filter((d) => state.departmentIds.includes(d.id)))
        .map((d) => ({ ...d, organizationId: organization.id, createdAt: new Date(0).toISOString() }));
      return { departments: items, total: items.length };
    }
    if (suffix.startsWith('/invitations')) return need('tenant.invitation.read') ? { invitations: [], total: 0 } : denied;
    if (suffix.startsWith('/audit')) return need('tenant.audit.read') ? { events: [], total: 0 } : denied;
    if (suffix.startsWith('/integrations/google')) {
      if (!need('tenant.integration.read')) return denied;
      return {
        organizationId: organization.id, driveFolderId: null, spreadsheetId: null, providerConfigured: false,
        mappingConfigured: false, syncSupported: false, effectiveAutoSync: false, version: 1,
      };
    }
    return undefined;
  };

  return { state, handle };
}

/**
 * Same synthetic identity as a platform superuser. The tab keeps its validated
 * organization selection, so the page reopens in explicit platform-management
 * context for that organization (PRD §5.3) — no membership is fabricated.
 */
export async function becomeSuperuser(page: import('@playwright/test').Page, api: ReturnType<typeof createTenantApi>) {
  api.state.platformRole = 'superuser';
  api.state.roles = {};
  await page.reload();
}

/** Settings › Members & Access › History › Operational activity (the former Activity Logs page). */
export async function openActivityHistory(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Members & Access', exact: true }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'History' });
  await dialog.getByRole('tab', { name: 'Operational activity', exact: true }).click();
  return dialog;
}

/** Fulfills `route` from `api` when it knows the endpoint; returns false otherwise. */
export async function fulfillTenantApi(route: import('@playwright/test').Route, api: ReturnType<typeof createTenantApi>): Promise<boolean> {
  const result = api.handle(route.request()) as any;
  if (result === undefined) return false;
  if (result && typeof result.status === 'number' && 'json' in result) await route.fulfill({ status: result.status, json: result.json });
  else await route.fulfill({ json: result });
  return true;
}
