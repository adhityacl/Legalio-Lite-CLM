import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { authClient } from '../lib/auth-client';
import { UserSession } from '@legalio/types';
import { useQueryClient } from '@tanstack/react-query';
import { normalizeRole, StandardRole } from '../lib/rbacScoping';
import { bindSelectionToUser, clearSelection } from '../lib/organizationSelection';
import { PermissionContext } from '../lib/permissions';

/** `GET /api/me` (tenant-boundaries PRD §9.1). */
export interface IdentityMembership {
  id: string;
  organizationId: string;
  organizationName: string;
  tenantRole: 'admin' | 'manager' | 'editor' | 'viewer';
  status: 'active' | 'suspended';
  departmentIds: string[];
}

export interface Identity {
  id: string;
  email: string;
  name: string;
  image: string | null;
  bio?: string | null;
  emailVerified: boolean;
  platformRole: 'user' | 'superuser';
  platformPermissions: string[];
  memberships: IdentityMembership[];
  defaultOrganizationId: string | null;
  /** `password`, `google`, … — OAuth-only accounts have no password to change. */
  signInMethods: string[];
  loginTime: string;
}

interface IdentityContextType {
  identity: Identity | null;
  loading: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  updateUserName: (newName: string) => void;
  refreshUser: () => Promise<void>;
}

const IdentityContext = createContext<IdentityContextType | undefined>(undefined);

const authHeaders = (token?: string | null): Record<string, string> => {
  const stored = token ?? (typeof window !== 'undefined' ? localStorage.getItem('auth_session_token') : null);
  return stored ? { Authorization: `Bearer ${stored}` } : {};
};

async function fetchIdentity(token?: string | null): Promise<Identity | null> {
  try {
    const res = await fetch('/api/me', { headers: authHeaders(token), credentials: 'include', cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.identity?.id) return null;
    return {
      ...data.identity,
      platformPermissions: Array.isArray(data.platformPermissions) ? data.platformPermissions : [],
      memberships: Array.isArray(data.memberships) ? data.memberships : [],
      defaultOrganizationId: data.defaultOrganizationId ?? null,
      signInMethods: Array.isArray(data.signInMethods) ? data.signInMethods : [],
      loginTime: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Verified identity and session lifecycle only (PRD §11.1). Organization
 * privileges come from the selected organization's capability DTO, never
 * from this provider.
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const queryClient = useQueryClient();

  const adopt = useCallback((next: Identity | null) => {
    setIdentity((previous) => {
      if (previous?.id !== next?.id) bindSelectionToUser(next?.id ?? null);
      return next;
    });
  }, []);

  const refreshUser = useCallback(async () => {
    const next = await fetchIdentity();
    adopt(next);
    if (!next) localStorage.removeItem('auth_session_token');
  }, [adopt]);

  useEffect(() => {
    let mounted = true;
    fetchIdentity()
      .then((next) => { if (mounted) adopt(next); })
      .finally(() => { if (mounted) setLoading(false); });
    // A revoked/expired session elsewhere (another tab, an admin action) ends here too.
    const onDenied = () => { void refreshUser(); };
    window.addEventListener('auth-session-invalid', onDenied);
    return () => {
      mounted = false;
      window.removeEventListener('auth-session-invalid', onDenied);
    };
  }, [adopt, refreshUser]);

  const login = async (email: string, password: string, rememberMe = true) => {
    const { data, error } = await authClient.signIn.email({ email, password, rememberMe });
    if (error) throw error;
    const token = data?.token || (data as any)?.session?.token;
    if (token) localStorage.setItem('auth_session_token', token);
    adopt(await fetchIdentity(token));
    window.dispatchEvent(new CustomEvent('auth-state-changed'));
  };

  const logout = async () => {
    try {
      await fetch('/api/user/log-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        credentials: 'include',
        body: JSON.stringify({ actionType: 'LOGOUT' }),
      });
    } catch {
      /* best effort */
    }
    clearSelection();
    localStorage.removeItem('auth_session_token');
    localStorage.removeItem('auth_user');
    await (authClient.signOut as any)().catch(() => {});
    adopt(null);
    await queryClient.cancelQueries();
    queryClient.clear();
  };

  const updateUserName = (newName: string) => {
    setIdentity((current) => (current ? { ...current, name: newName } : current));
  };

  return (
    <IdentityContext.Provider value={{ identity, loading, login, logout, updateUserName, refreshUser }}>
      {children}
    </IdentityContext.Provider>
  );
};

/** Identity if an AuthProvider is present (preferences/language work outside it too). */
export const useOptionalIdentity = (): Identity | null => useContext(IdentityContext)?.identity ?? null;

export const useIdentity = (): IdentityContextType => {
  const context = useContext(IdentityContext);
  if (!context) throw new Error('useIdentity must be used within an AuthProvider');
  return context;
};

const label = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);

/**
 * Compatibility adapter for operational views (PRD §11.1). Role flags derive
 * from the verified capability context of the selected organization:
 * `standardRole` is the membership role, or `superuser` only while a platform
 * administrator explicitly manages an organization (tenantRole stays null).
 * Without a ready context every flag is false.
 */
export const useAuth = () => {
  const { identity, loading, login, logout, updateUserName, refreshUser } = useIdentity();
  const capabilities = useContext(PermissionContext);
  return useMemo(() => {
    const ready = capabilities.status === 'ready' && Boolean(capabilities.organizationId);
    const standardRole: StandardRole = !ready
      ? 'viewer'
      : capabilities.accessMode === 'platform'
        ? 'superuser'
        : normalizeRole(capabilities.tenantRole || 'viewer');
    const user: UserSession | null = identity
      ? {
          id: identity.id,
          email: identity.email,
          name: identity.name || identity.email.split('@')[0],
          role: (ready ? (capabilities.accessMode === 'platform' ? 'Superuser' : label(capabilities.tenantRole || 'viewer')) : 'Viewer') as UserSession['role'],
          department: capabilities.departmentNames.join(', '),
          departmentIds: capabilities.departmentIds,
          organizationId: capabilities.organizationId || undefined,
          platformRole: identity.platformRole,
          loginTime: identity.loginTime,
        }
      : null;
    const isAdmin = ready && (standardRole === 'admin' || standardRole === 'superuser');
    const isManager = isAdmin || (ready && standardRole === 'manager');
    const isEditor = isManager || (ready && standardRole === 'editor');
    return {
      user,
      identity,
      loading,
      standardRole,
      isPlatformAdmin: identity?.platformRole === 'superuser',
      isSuperuser: identity?.platformRole === 'superuser',
      isAdmin,
      isManager,
      isEditor,
      isViewer: ready && standardRole === 'viewer',
      isLegal: isEditor,
      isFinance: isEditor,
      login,
      logout,
      updateUserName,
      refreshUser,
    };
  }, [identity, loading, capabilities, login, logout, updateUserName, refreshUser]);
};
