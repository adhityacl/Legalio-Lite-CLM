/**
 * Exact application route IDs and legacy aliases (tenant-boundaries PRD §6.2).
 *
 * Every `?tab=` value is either a canonical ID, a documented legacy alias
 * mapped with replaceState, or rejected. There is no prefix allowlist.
 * Guards run before any lazy view mounts or loads data.
 */
export const OPERATIONAL_TABS = [
  'dashboard', 'hierarchy', 'contracts', 'obligations', 'create-contract', 'document-approval', 'ios', 'io', 'partners',
  'partner-evaluation', 'partner-spending', 'notifikasi', 'bulk-import', 'privacy', 'terms',
] as const;

export const SETTINGS_TABS = ['settings-organization', 'settings-access', 'settings-data'] as const;
export type SettingsTabId = (typeof SETTINGS_TABS)[number];

import { SYSTEM_SUBMENUS, SYSTEM_TABS } from '@legalio/shared/systemConsole';
export { SYSTEM_SUBMENUS, SYSTEM_TABS };
export type { SystemSubmenu } from '@legalio/shared/systemConsole';

/** Optional UI state carried by an alias (opens an existing dialog/filter on the Access tab). */
export type AccessIntent = 'departments' | 'pending-invitations' | 'history';

export interface RouteContext {
  isPlatformAdmin: boolean;
  /** Capabilities of the selected organization are loaded. */
  organizationReady: boolean;
  can: (permission: string) => boolean;
}

export type RouteDecision =
  | { kind: 'allow'; tab: string }
  | { kind: 'redirect'; tab: string; intent?: AccessIntent }
  | { kind: 'denied' };

/** Settings landing for the selected organization: Organization for admin/platform, Access for manager. */
export function defaultSettingsTab(ctx: RouteContext): SettingsTabId | null {
  if (ctx.can('tenant.settings.read')) return 'settings-organization';
  if (ctx.can('tenant.member.read')) return 'settings-access';
  if (ctx.can('tenant.data.export')) return 'settings-data';
  return null;
}

const SETTINGS_PERMISSION: Record<SettingsTabId, string> = {
  'settings-organization': 'tenant.settings.read',
  'settings-access': 'tenant.member.read',
  'settings-data': 'tenant.data.export',
};

/**
 * Decides what a requested tab resolves to. Organization-scoped decisions
 * need ready capabilities; callers must show loading (not redirect) until then.
 */
const OPERATIONAL_PERMISSION: Record<string, string> = {
  'create-contract': 'document.create',
  'document-approval': 'document.create',
  'bulk-import': 'tenant.data.import',
};

export function resolveRoute(tab: string, ctx: RouteContext): RouteDecision {
  if (tab === 'privacy' || tab === 'terms') return { kind: 'allow', tab };
  if ((OPERATIONAL_TABS as readonly string[]).includes(tab)) {
    return ctx.can(OPERATIONAL_PERMISSION[tab] || 'document.view') ? { kind: 'allow', tab } : { kind: 'denied' };
  }
  if ((SETTINGS_TABS as readonly string[]).includes(tab)) {
    return ctx.can(SETTINGS_PERMISSION[tab as SettingsTabId]) ? { kind: 'allow', tab } : { kind: 'denied' };
  }
  if (SYSTEM_TABS.includes(tab)) return ctx.isPlatformAdmin ? { kind: 'allow', tab } : { kind: 'denied' };

  // Legacy aliases.
  switch (tab) {
    case 'settings':
    case 'settings-region':
    case 'settings-notifications': {
      const target = defaultSettingsTab(ctx);
      if (tab === 'settings' && target) return { kind: 'redirect', tab: target };
      return ctx.can('tenant.settings.read') ? { kind: 'redirect', tab: 'settings-organization' } : { kind: 'denied' };
    }
    // The Integrations tab was removed from Settings; old links land on the Settings default.
    case 'settings-integrations':
    case 'settings-google': {
      const target = defaultSettingsTab(ctx);
      return target ? { kind: 'redirect', tab: target } : { kind: 'denied' };
    }
    case 'settings-ai':
      return ctx.isPlatformAdmin ? { kind: 'redirect', tab: 'admin-system-ai' } : { kind: 'denied' };
    case 'settings-language':
      return ctx.isPlatformAdmin ? { kind: 'redirect', tab: 'admin-system-ui-texts' } : { kind: 'denied' };
    // Removed pages (Design System catalog, SQLite database and backups); old links land on the System Console dashboard.
    case 'admin-system-design-system':
    case 'admin-system-database':
    case 'admin-system-backups':
    case 'settings-security':
      return ctx.isPlatformAdmin ? { kind: 'redirect', tab: 'admin-system-dashboard' } : { kind: 'denied' };
    case 'admin-system-settings':
      return ctx.isPlatformAdmin ? { kind: 'redirect', tab: 'admin-system-google' } : { kind: 'denied' };
    case 'admin-organization-dashboard':
    case 'admin-organization-users':
    case 'admin-organization-teams':
    case 'admin-organization-invitations':
      if (!ctx.can('tenant.member.read')) return { kind: 'denied' };
      return {
        kind: 'redirect', tab: 'settings-access',
        intent: tab.endsWith('teams') ? 'departments' : tab.endsWith('invitations') ? 'pending-invitations' : undefined,
      };
    case 'activity-logs':
      return ctx.can('tenant.audit.read') ? { kind: 'redirect', tab: 'settings-access', intent: 'history' } : { kind: 'denied' };
  }
  if (tab === 'admin-users' || tab.startsWith('admin-users-')) {
    if (ctx.isPlatformAdmin) return { kind: 'redirect', tab: 'admin-system-users' };
    return ctx.can('tenant.member.read') ? { kind: 'redirect', tab: 'settings-access' } : { kind: 'denied' };
  }
  return { kind: 'denied' };
}

/** Whether deciding this tab needs the selected organization's capabilities. */
export function needsOrganization(tab: string, isPlatformAdmin: boolean): boolean {
  if (tab === 'login' || tab === 'privacy' || tab === 'terms' || SYSTEM_TABS.includes(tab)) return false;
  if (isPlatformAdmin && (['settings-ai', 'settings-security', 'settings-language', 'admin-users', 'admin-system-settings', 'admin-system-rbac'].includes(tab) || tab.startsWith('admin-users-'))) return false;
  return true;
}
