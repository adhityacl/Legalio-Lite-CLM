/**
 * Client capability context (tenant-boundaries PRD §11.1, §11.3).
 *
 * Loads `GET /api/organizations/:id/capabilities` for the tab's selected
 * organization. Visibility only — the server stays authoritative. Fail
 * closed: until the response for the CURRENT selection is ready, and after
 * any error, the permission list is empty. There is no role-based bootstrap
 * matrix and no wildcard.
 */
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '@legalio/shared/apiClient';
import { useIdentity } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { getSelectionRevision } from './organizationSelection';

export type TenantRole = 'admin' | 'manager' | 'editor' | 'viewer';
/** Legacy name kept for views; `superuser` here only means explicit platform management. */
export type RoleCode = 'superuser' | TenantRole;

export interface PermissionContextValue {
  status: 'idle' | 'loading' | 'ready' | 'error';
  organizationId: string | null;
  accessMode: 'membership' | 'platform' | null;
  tenantRole: TenantRole | null;
  membershipId: string | null;
  departmentIds: string[];
  departmentNames: string[];
  permissions: string[];
  assignableTenantRoles: TenantRole[];
  platformPermissions: string[];
  /** Legacy role code for views; `superuser` only in explicit platform management. */
  role: RoleCode;
  /** @deprecated use organizationId */
  tenantId: string | null;
  loading: boolean;
  retry: () => void;
}

const EMPTY: PermissionContextValue = {
  status: 'idle', organizationId: null, accessMode: null, tenantRole: null, membershipId: null,
  departmentIds: [], departmentNames: [], permissions: [], assignableTenantRoles: [], platformPermissions: [],
  role: 'viewer', tenantId: null, loading: false, retry: () => {},
};

export const PermissionContext = createContext<PermissionContextValue>(EMPTY);

export function PermissionProvider({ children }: { children: ReactNode }) {
  const { identity } = useIdentity();
  const { activeTenantId } = useTenant();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<PermissionContextValue, 'retry' | 'platformPermissions'>>({ ...EMPTY });
  const requestRef = useRef(0);
  /** `<identity>:<organization>` whose capabilities the ready state holds. */
  const loadedFor = useRef('');

  useEffect(() => {
    const request = ++requestRef.current;
    const selection = getSelectionRevision();
    if (!identity || !activeTenantId) {
      loadedFor.current = '';
      setState({ ...EMPTY });
      return;
    }
    // Never keep the previous organization's (or identity's) permissions while loading (§11.3).
    // Refreshing the same identity and organization (after a save) keeps the screen mounted.
    const key = `${identity.id}:${activeTenantId}`;
    setState((prev) => (prev.status === 'ready' && loadedFor.current === key
      ? prev
      : { ...EMPTY, status: 'loading', loading: true, organizationId: activeTenantId, tenantId: activeTenantId }));
    const controller = new AbortController();
    void (async () => {
      try {
        const caps = await api.get<any>(`/organizations/${encodeURIComponent(activeTenantId)}/capabilities`, { cache: 'no-store', signal: controller.signal });
        const depts = await api.get<{ items?: Array<{ id: string; name: string }> }>('/departments', { cache: 'no-store', signal: controller.signal, organizationId: activeTenantId })
          .catch(() => ({ items: [] as Array<{ id: string; name: string }> }));
        // Ignore responses for an organization that is no longer selected (AC-026).
        if (request !== requestRef.current || caps.organizationId !== activeTenantId || selection !== getSelectionRevision()) return;
        const names = new Map<string, string>((depts.items || []).map((d: { id: string; name: string }) => [d.id, d.name]));
        loadedFor.current = key;
        setState({
          status: 'ready',
          loading: false,
          organizationId: caps.organizationId,
          tenantId: caps.organizationId,
          accessMode: caps.accessMode,
          tenantRole: caps.tenantRole,
          membershipId: caps.membershipId,
          departmentIds: Array.isArray(caps.departmentIds) ? caps.departmentIds : [],
          departmentNames: (caps.departmentIds || []).map((id: string) => names.get(id)).filter(Boolean),
          permissions: Array.isArray(caps.permissions) ? caps.permissions : [],
          assignableTenantRoles: Array.isArray(caps.assignableTenantRoles) ? caps.assignableTenantRoles : [],
          role: caps.accessMode === 'platform' ? 'superuser' : (caps.tenantRole || 'viewer'),
        });
      } catch (err: any) {
        if (controller.signal.aborted || request !== requestRef.current) return;
        loadedFor.current = '';
        setState({ ...EMPTY, status: 'error', organizationId: activeTenantId, tenantId: activeTenantId });
        if (err?.status === 404) {
          window.dispatchEvent(new CustomEvent('organization-access-lost', { detail: activeTenantId }));
        }
      }
    })();
    const onUpdated = () => setAttempt((n) => n + 1);
    window.addEventListener('organization-updated', onUpdated);
    return () => {
      controller.abort();
      window.removeEventListener('organization-updated', onUpdated);
    };
  }, [identity?.id, activeTenantId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const value = useMemo<PermissionContextValue>(
    () => ({ ...state, platformPermissions: identity?.platformPermissions || [], retry }),
    [state, identity?.platformPermissions, retry],
  );
  return createElement(PermissionContext.Provider, { value }, children);
}

export function PlatformPermissionProvider({ children }: { children: ReactNode }) {
  const { identity } = useIdentity();
  return createElement(PermissionContext.Provider, { value: { ...EMPTY, platformPermissions: identity?.platformPermissions || [] } }, children);
}

const allowed = (ctx: PermissionContextValue, permission: string) =>
  ctx.status === 'ready' && ctx.permissions.includes(permission);

/** Tenant permission in the selected organization; false until capabilities are ready. */
export function useHasPermission(permission: string): boolean {
  return allowed(useContext(PermissionContext), permission);
}

export function useCan(resource: string, action: string): boolean {
  return useHasPermission(`${resource}.${action}`);
}

export function usePermissions(): PermissionContextValue & {
  hasPermission: (p: string) => boolean;
  hasPlatformPermission: (p: string) => boolean;
  can: (r: string, a: string) => boolean;
} {
  const ctx = useContext(PermissionContext);
  const has = (p: string) => allowed(ctx, p);
  return {
    ...ctx,
    hasPermission: has,
    hasPlatformPermission: (p: string) => ctx.platformPermissions.includes(p),
    can: (r, a) => has(`${r}.${a}`),
  };
}

/** Visibility wrapper; never a substitute for server authorization. */
export function Can({ permission, anyOf, fallback = null, children }: {
  permission?: string; anyOf?: string[]; fallback?: ReactNode; children: ReactNode;
}) {
  const ctx = useContext(PermissionContext);
  const ok = (permission ? allowed(ctx, permission) : false) || (anyOf ? anyOf.some((p) => allowed(ctx, p)) : false);
  return (ok ? children : fallback) as any;
}
