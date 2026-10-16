import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Tenant, TenantBranding } from '@legalio/types';
import { useIdentity } from './AuthContext';
import { useConfirm } from './ConfirmDialogContext';
import { useLanguage } from './LanguageContext';
import { useTheme } from './ThemeContext';
import { findAccentPalette, organizationThemeTokens } from '../lib/organizationColors';
import { getSavedSelection, setSelectedOrganizationId } from '../lib/organizationSelection';
import { confirmLeave } from '../lib/unsavedChanges';

/** Accessible organization summary (`GET /api/tenants` → organizations). */
export interface AccessibleOrganization {
  organizationId: string;
  organizationName: string;
  slug: string;
  logoUrl: string | null;
  tenantRole: 'admin' | 'manager' | 'editor' | 'viewer' | null;
  accessMode: 'membership' | 'platform';
}

/**
 * - loading: identity/organizations still resolving
 * - selected: a validated organization is active in this tab
 * - choose: several organizations, no valid selection (show chooser)
 * - none: no accessible organization (no-access state, or System Admin for a superuser)
 */
export type SelectionStatus = 'loading' | 'selected' | 'choose' | 'none';

interface TenantContextType {
  organizations: AccessibleOrganization[];
  tenants: Tenant[];
  activeTenant: Tenant | null;
  activeTenantId: string;
  selectionStatus: SelectionStatus;
  branding: TenantBranding;
  loading: boolean;
  /** Validated switch; asks before discarding unsaved changes. */
  switchTenant: (tenantId: string) => Promise<boolean>;
  /** Leave organization context (superuser "Back to System Admin"). */
  leaveOrganization: () => Promise<boolean>;
  createTenant: (tenantData: Omit<Tenant, 'id' | 'created_at'>) => Promise<boolean>;
  updateTenant: (id: string, updates: Partial<Tenant>) => Promise<boolean>;
  deleteTenant: (id: string) => Promise<boolean>;
  updateBranding: (brandingData: Partial<TenantBranding>) => Promise<boolean>;
  refreshTenants: () => Promise<void>;
}

const DEFAULT_BRANDING: TenantBranding = {
  appName: 'Legalio CLM',
  logoUrl: '/favicon.png',
  primaryColor: '#0090FF',
  footerText: 'Legalio — open-source contract lifecycle management.',
  loginHeadline: 'Contract, partner and commercial document management',
};

async function safeJson<T = any>(res: Response): Promise<T | null> {
  try {
    const text = await res.text();
    if (!text || text.trim().startsWith('<')) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const json = { 'Content-Type': 'application/json' };
const TenantContext = createContext<TenantContextType | undefined>(undefined);

/**
 * Accessible organizations and the tab's validated selection (PRD §11.2).
 * Initial selection: saved tab choice → valid session default → the only
 * membership → chooser. Never the "first" organization of several.
 */
export const TenantProvider: React.FC<{ children: React.ReactNode; platformOnly?: boolean }> = ({ children, platformOnly = false }) => {
  const { identity, loading: identityLoading } = useIdentity();
  const confirm = useConfirm();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  const [organizations, setOrganizations] = useState<AccessibleOrganization[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [activeTenantId, setActiveTenantId] = useState('');
  const [selectionStatus, setSelectionStatus] = useState<SelectionStatus>('loading');
  const [branding, setBranding] = useState<TenantBranding>(DEFAULT_BRANDING);
  const switching = useRef(false);

  const commit = useCallback((organizationId: string | null) => {
    setSelectedOrganizationId(organizationId);
    setActiveTenantId(organizationId || '');
  }, []);

  /** Server-validated session default; the tab selection is committed only on success. */
  const validate = useCallback(async (organizationId: string) => {
    const res = await fetch('/api/me/active-organization', {
      method: 'POST', headers: json, credentials: 'include', body: JSON.stringify({ organizationId }),
    });
    return res.ok;
  }, []);

  // Public presentation branding is available before sign-in.
  useEffect(() => {
    fetch('/api/branding', { cache: 'no-store' })
      .then((res) => (res.ok ? safeJson(res) : null))
      .then((data) => { if (data?.branding) setBranding({ ...DEFAULT_BRANDING, ...data.branding }); })
      .catch(() => {});
  }, []);

  const load = useCallback(async (options: { keepSelection?: boolean } = {}) => {
    // The standalone console uses branding without selecting or loading an organization.
    if (platformOnly) { setSelectionStatus('none'); return; }
    if (!identity) {
      setOrganizations([]);
      setTenants([]);
      commit(null);
      setSelectionStatus('none');
      return;
    }
    const tenantsRes = await fetch('/api/tenants', { credentials: 'include', cache: 'no-store' });
    const data = tenantsRes.ok ? await safeJson(tenantsRes) : null;
    const orgs: AccessibleOrganization[] = Array.isArray(data?.organizations) ? data.organizations : [];
    setOrganizations(orgs);
    setTenants(Array.isArray(data?.tenants) ? data.tenants : []);
    const ids = new Set(orgs.map((o) => o.organizationId));
    if (options.keepSelection && activeTenantId && ids.has(activeTenantId)) return;

    const saved = getSavedSelection();
    const isPlatform = identity.platformRole === 'superuser';
    const candidate = (saved && ids.has(saved) && saved)
      || (!isPlatform && data?.activeTenantId && ids.has(data.activeTenantId) && data.activeTenantId)
      || (!isPlatform && orgs.length === 1 && orgs[0].organizationId)
      || null;
    if (candidate && (candidate === data?.activeTenantId || (await validate(candidate)))) {
      commit(candidate);
      setSelectionStatus('selected');
      return;
    }
    commit(null);
    setSelectionStatus(orgs.length > 1 && !isPlatform ? 'choose' : 'none');
  }, [identity, activeTenantId, commit, validate, platformOnly]);

  useEffect(() => {
    if (identityLoading) return;
    setSelectionStatus('loading');
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityLoading, identity?.id, platformOnly]);

  // A denied request (suspended/removed membership) drops this organization from the tab.
  useEffect(() => {
    const onLost = (event: Event) => {
      const lost = (event as CustomEvent).detail;
      if (lost && lost === activeTenantId) {
        commit(null);
        queryClient.removeQueries();
        void load();
      }
    };
    const onUpdated = () => { void load({ keepSelection: true }); };
    window.addEventListener('organization-access-lost', onLost);
    window.addEventListener('organization-updated', onUpdated);
    return () => {
      window.removeEventListener('organization-access-lost', onLost);
      window.removeEventListener('organization-updated', onUpdated);
    };
  }, [activeTenantId, commit, load, queryClient]);

  const askLeave = useCallback(() => confirmLeave(() => confirm({
    title: t('settings.unsaved_title', 'Unsaved changes'),
    description: t('settings.unsaved_description', 'You have unsaved changes. Discard them and continue?'),
    confirmLabel: t('settings.discard_changes', 'Discard changes'),
    cancelLabel: t('settings.stay', 'Stay'),
    tone: 'danger',
  })), [confirm, t]);

  const switchTenant = useCallback(async (tenantId: string): Promise<boolean> => {
    if (switching.current || tenantId === activeTenantId) return tenantId === activeTenantId;
    if (!(await askLeave())) return false;
    switching.current = true;
    try {
      await queryClient.cancelQueries();
      if (!(await validate(tenantId))) return false; // old valid selection stays
      commit(tenantId);
      setSelectionStatus('selected');
      window.dispatchEvent(new CustomEvent('organization-switched', { detail: tenantId }));
      return true;
    } catch {
      return false;
    } finally {
      switching.current = false;
    }
  }, [activeTenantId, askLeave, commit, queryClient, validate]);

  const leaveOrganization = useCallback(async () => {
    if (!(await askLeave())) return false;
    await queryClient.cancelQueries();
    commit(null);
    setSelectionStatus(identity?.platformRole === 'superuser' || organizations.length <= 1 ? 'none' : 'choose');
    window.dispatchEvent(new CustomEvent('organization-switched', { detail: null }));
    return true;
  }, [askLeave, commit, identity?.platformRole, organizations.length, queryClient]);

  const activeTenant = tenants.find((tenant) => tenant.id === activeTenantId) || null;

  useEffect(() => {
    document.title = activeTenant?.name ? `${activeTenant.brandName || activeTenant.name} | ${branding.appName}` : branding.appName;
  }, [branding, activeTenant]);

  useEffect(() => {
    const root = document.documentElement;
    if (!activeTenant) return;
    const color = activeTenant.primaryColor || branding.primaryColor;
    const tokens = organizationThemeTokens(color, theme === 'dark');
    for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
    root.dataset.organizationPalette = findAccentPalette(color)?.name || 'custom';
    return () => {
      for (const name of Object.keys(tokens)) root.style.removeProperty(name);
      delete root.dataset.organizationPalette;
    };
  }, [activeTenant, branding.primaryColor, theme]);

  /* Platform organization lifecycle (System Admin). */
  const platformWrite = async (url: string, method: string, body?: unknown) => {
    try {
      const res = await fetch(url, { method, headers: json, credentials: 'include', body: body === undefined ? undefined : JSON.stringify(body) });
      if (!res.ok) return false;
      await load({ keepSelection: true });
      return true;
    } catch {
      return false;
    }
  };

  const updateBranding = async (brandingData: Partial<TenantBranding>) => {
    const res = await fetch('/api/platform/configuration', {
      method: 'PATCH', headers: json, credentials: 'include', body: JSON.stringify({ section: 'branding', values: brandingData }),
    });
    if (!res.ok) return false;
    const next = await safeJson(res);
    if (next) setBranding({ ...DEFAULT_BRANDING, ...next });
    return true;
  };

  return (
    <TenantContext.Provider
      value={{
        organizations,
        tenants,
        activeTenant,
        activeTenantId,
        selectionStatus,
        branding,
        loading: selectionStatus === 'loading',
        switchTenant,
        leaveOrganization,
        createTenant: (data) => platformWrite('/api/tenants', 'POST', data),
        updateTenant: (id, updates) => platformWrite(`/api/tenants/${encodeURIComponent(id)}`, 'PUT', updates),
        deleteTenant: (id) => platformWrite(`/api/tenants/${encodeURIComponent(id)}`, 'DELETE'),
        updateBranding,
        refreshTenants: () => load({ keepSelection: true }),
      }}
    >
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = (): TenantContextType => {
  const context = useContext(TenantContext);
  if (!context) throw new Error('useTenant must be used within a TenantProvider');
  return context;
};
