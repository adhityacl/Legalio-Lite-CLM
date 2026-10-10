import { DesignSystemCatalog } from '@legalio/ui-components/catalog';
import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useConfirm } from '../context/ConfirmDialogContext';
import { useNavigation } from '../context/NavigationContext';
import type { SystemSubmenu } from '../lib/appRoutes';
import type { ConsoleAccount, ConsoleApiKey, ConsoleConfigurationSection, ConsoleDashboardTab, ConsoleMetrics, ConsoleOrganization, ConsoleSession, ConsoleUser } from './admin/types';
import type { PlatformConfigurationSection } from './admin/PlatformConfigurationPanel';
import { AdminDashboardTab } from './admin/AdminDashboardTab';
import { AdminConsoleHeader } from './admin/AdminConsoleHeader';
import { AdminSessionsTab } from './admin/AdminSessionsTab';
import { AdminOrganizationsTab } from './admin/AdminOrganizationsTab';
import { AdminApiKeysTab } from './admin/AdminApiKeysTab';
import { PlatformUsersTab, type PlatformUser } from './admin/PlatformUsersTab';
import { CreateOrganizationModal, DeleteOrganizationModal, EditOrganizationModal, GenerateApiKeyModal } from './admin/AdminModals';

const LazySQLiteBackups = lazy(() => import('./SQLiteBackupsPanel').then((m) => ({ default: m.SQLiteBackupsPanel })));
const LazyPlatformConfigurationPanel = lazy(() => import('./admin/PlatformConfigurationPanel').then((m) => ({ default: m.PlatformConfigurationPanel })));

const CONFIGURATION_SECTIONS: Record<ConsoleConfigurationSection, PlatformConfigurationSection> = {
  google: 'google',
  ai: 'ai',
  smtp: 'notifications',
  'ui-texts': 'language',
  database: 'security',
};

async function consoleApi<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/auth-console${path}`, {
    method: init.method || 'GET',
    headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'include',
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  return data as T;
}

/**
 * System Admin console (PRD §6.6): platform-only. Global accounts, sessions,
 * the organization directory with "Manage organization", API keys, the full
 * configuration pages. Tenant membership, departments and invitations are
 * handled in the managed organization's Settings.
 */
export const AdminUsersView: React.FC<{ initialTab?: SystemSubmenu; onManageOrganization: (organization: ConsoleOrganization) => Promise<void> }> = ({ initialTab = 'dashboard', onManageOrganization }) => {
  const { t } = useLanguage();
  const confirmDialog = useConfirm();
  const { setActiveTab: setNavigationTab } = useNavigation();
  const [activeTab, setActiveTab] = useState<SystemSubmenu>(initialTab);
  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<ConsoleMetrics | null>(null);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [accounts, setAccounts] = useState<ConsoleAccount[]>([]);
  const [sessions, setSessions] = useState<ConsoleSession[]>([]);
  const [organizations, setOrganizations] = useState<ConsoleOrganization[]>([]);
  const [apiKeys, setApiKeys] = useState<ConsoleApiKey[]>([]);
  const [isCreateOrgOpen, setIsCreateOrgOpen] = useState(false);
  const [orgForEdit, setOrgForEdit] = useState<ConsoleOrganization | null>(null);
  const [orgForDelete, setOrgForDelete] = useState<ConsoleOrganization | null>(null);
  const [isCreateApiKeyOpen, setIsCreateApiKeyOpen] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const configurationSection = CONFIGURATION_SECTIONS[activeTab as ConsoleConfigurationSection];

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };
  const navigateToTab = useCallback((tab: string) => {
    setActiveTab(tab as SystemSubmenu);
    setNavigationTab(`admin-system-${tab}`);
  }, [setNavigationTab]);

  const loadConsoleData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setIsRefreshing(true);
    setLoadError(null);
    try {
      const [overview, usersRes, accountsRes, sessionsRes, orgsRes, keysRes] = await Promise.all([
        consoleApi('/overview'), consoleApi('/users'), consoleApi('/accounts'), consoleApi('/sessions'),
        consoleApi('/organizations'), consoleApi('/api-keys'),
      ]);
      setMetrics(overview.data?.metrics || null);
      setUsers(usersRes.users || []);
      setAccounts(accountsRes.accounts || []);
      setSessions(sessionsRes.sessions || []);
      setOrganizations(orgsRes.organizations || []);
      setApiKeys(keysRes.apiKeys || []);
    } catch (err: any) {
      const message = err?.message || t('admin.toast.load_failed', 'Gagal memuat data konsol autentikasi');
      setLoadError(message);
      showToast(message, 'error');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [t]);
  useEffect(() => { void loadConsoleData(); }, [loadConsoleData]);

  const act = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      showToast(success);
      await loadConsoleData(true);
    } catch (err: any) {
      showToast(err.message, 'error');
      throw err;
    }
  };

  /** Explicit platform-management context; no membership is created (PRD §6.6). */
  const manageOrganization = async (org: ConsoleOrganization) => {
    try { await onManageOrganization(org); }
    catch (err: any) { showToast(err.message || t('admin.toast.switch_org_failed', 'Could not open organization.'), 'error'); }
  };

  const consoleUsers: ConsoleUser[] = users.map((u) => ({
    id: u.id, name: u.name, email: u.email, emailVerified: u.emailVerified, role: u.platformRole, banned: u.banned,
    banReason: u.banReason || undefined, createdAt: u.createdAt, sessionCount: u.sessionCount, primaryProvider: u.primaryProvider || undefined,
  }));

  return (
    <div className="flex w-full flex-col space-y-6 text-ink">
      {toast && (
        <div role="status" aria-live="polite" className={`fixed right-4 top-4 z-50 flex items-center gap-2.5 rounded-xl border px-4 py-2.5 text-xs font-medium shadow-lg ${toast.type === 'success'
          ? 'border-status-success-border bg-status-success-soft text-status-success dark:bg-status-success-soft/90 '
          : 'border-status-danger-border bg-status-danger-soft text-status-danger dark:bg-status-danger-soft/90 '}`}>
          {toast.type === 'success' ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />}
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label={t('admin.toast.dismiss', 'Tutup notifikasi')} className="inline-flex items-center justify-center ml-2 rounded-md size-8 hover:bg-surface-2/50"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {!configurationSection && activeTab !== 'backups' && activeTab !== 'design-system' && (
        <AdminConsoleHeader
          area="system"
          activeTab={activeTab as ConsoleDashboardTab}
          onTabChange={navigateToTab}
          onCreateOrgClick={() => setIsCreateOrgOpen(true)}
          onRefresh={() => loadConsoleData(true)}
          isRefreshing={isRefreshing}
          userCounts={{ users: users.length, sessions: sessions.length, orgs: organizations.length, teams: 0, invites: 0, apiKeys: apiKeys.length }}
        />
      )}

      <div id={`admin-system-${activeTab}-panel`} role="tabpanel" aria-labelledby={`admin-system-${activeTab}-tab`} className="w-full">
        {activeTab === 'design-system' ? <DesignSystemCatalog /> : activeTab === 'backups' ? (
          <Suspense fallback={<p role="status">{t('sys.loading', 'Loading…')}</p>}><LazySQLiteBackups /></Suspense>
        ) : configurationSection ? (
          <Suspense fallback={<div role="status" className="flex min-h-56 items-center justify-center text-sm text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /></div>}>
            <LazyPlatformConfigurationPanel activeSection={configurationSection} />
          </Suspense>
        ) : loadError ? (
          <div role="alert" className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-status-danger-border bg-status-danger-soft p-4 text-sm text-status-danger dark:bg-status-danger-soft/40">
            <span>{t('admin.load_error', 'Data gagal dimuat')}: {loadError}</span>
            <button type="button" onClick={() => loadConsoleData()} className="shrink-0 font-semibold underline underline-offset-2">{t('admin.retry', 'Coba lagi')}</button>
          </div>
        ) : isLoading ? (
          <div role="status" className="flex min-h-56 items-center justify-center gap-2 text-sm text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" />{t('admin.loading', 'Memuat data akses admin...')}</div>
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <AdminDashboardTab metrics={metrics} activeOrg={null} recentUsers={consoleUsers} recentSessions={sessions}
                onNavigateTab={navigateToTab as any} onOpenCreateOrg={() => setIsCreateOrgOpen(true)} onOpenCreateTeam={() => navigateToTab('organizations')}
                onOpenCreateApiKey={() => setIsCreateApiKeyOpen(true)}
                onRevokeSession={(id) => act(() => consoleApi(`/sessions/${id}`, { method: 'DELETE' }), t('admin.toast.revoke_session_success', 'Login session successfully revoked.')).catch(() => {})} />
            )}
            {activeTab === 'users' && (
              <PlatformUsersTab
                users={users}
                onCreate={(v) => act(() => consoleApi('/users', { method: 'POST', body: v }), t('tb.account_created', 'Account created.'))}
                onUpdate={(u, v) => act(async () => {
                  if (v.name !== u.name || v.email !== u.email) await consoleApi(`/users/${u.id}`, { method: 'PUT', body: { name: v.name, email: v.email } });
                  if (v.platformRole !== u.platformRole) await consoleApi(`/users/${u.id}/role`, { method: 'PUT', body: { platformRole: v.platformRole } });
                }, t('tb.account_updated', 'Account updated.'))}
                onResetPassword={(u, password) => act(() => consoleApi(`/users/${u.id}/password`, { method: 'PUT', body: { password } }), t('admin.toast.reset_pass_success', 'New password successfully saved and encrypted.'))}
                onToggleBan={async (u) => {
                  if (!u.banned && !(await confirmDialog({ description: t('tb.disable_account_confirm', 'Disable {name}? They are signed out everywhere and cannot sign in until enabled again.', { name: u.name }), tone: 'danger', confirmLabel: t('tb.disable', 'Disable') }))) return;
                  await act(() => consoleApi(`/users/${u.id}/ban`, { method: 'POST', body: { banned: !u.banned } }), u.banned ? t('tb.account_enabled', 'Account enabled.') : t('tb.account_disabled', 'Account disabled.')).catch(() => {});
                }}
                onDelete={async (u) => {
                  if (!(await confirmDialog({ description: t('admin.hapus_pengguna_akun_ini_akan_dihapus', 'Hapus pengguna "{name}"? Akun ini akan dihapus permanen.', { name: u.name }), tone: 'danger', confirmLabel: t('admin.action_delete', 'Hapus') }))) return;
                  await act(() => consoleApi(`/users/${u.id}`, { method: 'DELETE' }), t('tb.account_deleted', 'Account deleted.')).catch(() => {});
                }}
              />
            )}
            {activeTab === 'sessions' && (
              <AdminSessionsTab sessions={sessions}
                onRevokeSession={(id) => act(() => consoleApi(`/sessions/${id}`, { method: 'DELETE' }), t('admin.toast.revoke_session_success', 'Login session successfully revoked.')).catch(() => {})}
                onRevokeAllUserSessions={(userId) => act(() => consoleApi(`/sessions/revoke-all/${userId}`, { method: 'POST' }), t('admin.toast.revoke_all_sessions_success', 'All active sessions for user successfully revoked.')).catch(() => {})} />
            )}
            {activeTab === 'accounts' && (
              <ul className="divide-y divide-hairline rounded-2xl border border-hairline bg-surface text-sm">
                {accounts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <span>{a.userName} · {a.userEmail}</span><span className="text-ink-soft">{a.providerId}</span>
                  </li>
                ))}
              </ul>
            )}
            {activeTab === 'organizations' && (
              <AdminOrganizationsTab organizations={organizations} activeOrg={null} onSelectOrg={manageOrganization}
                onOpenCreateOrg={() => setIsCreateOrgOpen(true)} onOpenEditOrg={setOrgForEdit} onDeleteOrg={setOrgForDelete} />
            )}
            {activeTab === 'apikeys' && (
              <AdminApiKeysTab apiKeys={apiKeys} onOpenCreateKey={() => setIsCreateApiKeyOpen(true)}
                onRevokeKey={(id) => act(() => consoleApi(`/api-keys/${id}/revoke`, { method: 'POST' }), t('admin.toast.revoke_key_success', 'API Key has been revoked.')).catch(() => {})}
                onDeleteKey={async (id) => {
                  if (!(await confirmDialog({ description: t('admin.confirm.delete_key', 'Hapus API Key ini? Aplikasi yang memakainya akan berhenti berfungsi.'), tone: 'danger', confirmLabel: t('admin.action_delete', 'Hapus') }))) return;
                  await act(() => consoleApi(`/api-keys/${id}`, { method: 'DELETE' }), t('admin.toast.delete_key_success', 'API Key has been deleted.')).catch(() => {});
                }} />
            )}
          </>
        )}
      </div>

      <CreateOrganizationModal isOpen={isCreateOrgOpen} onClose={() => setIsCreateOrgOpen(false)}
        onSubmit={async (data) => {
          await act(() => consoleApi('/organizations', { method: 'POST', body: {
            name: data.name, slug: data.slug, countryCode: data.countryCode, industry: data.industry, defaultCurrency: data.currency,
          } }), `${t('admin.toast.org', 'Organization')} "${data.name}" ${t('admin.toast.created_success', 'successfully created.')}`);
          window.dispatchEvent(new CustomEvent('organization-updated'));
        }} />
      <EditOrganizationModal org={orgForEdit} isOpen={Boolean(orgForEdit)} onClose={() => setOrgForEdit(null)} onDelete={(org) => setOrgForDelete(org)}
        onSubmit={async (orgId, data) => {
          await act(() => consoleApi(`/organizations/${orgId}`, { method: 'PUT', body: { name: data.name, slug: data.slug, expectedVersion: orgForEdit?.version, profile: { logoUrl: data.logo || '' } } }), `${t('admin.toast.org', 'Organisasi')} "${data.name}" ${t('admin.toast.updated_success', 'berhasil diperbarui.')}`);
          window.dispatchEvent(new CustomEvent('organization-updated'));
        }} />
      <DeleteOrganizationModal isOpen={Boolean(orgForDelete)} org={orgForDelete} isActive={false} onClose={() => setOrgForDelete(null)}
        onConfirm={async (org) => {
          await act(() => consoleApi(`/organizations/${org.id}`, { method: 'DELETE' }), `${t('admin.toast.org', 'Organisasi')} "${org.name}" ${t('admin.toast.org_deleted_success', 'berhasil dihapus.')}`);
          window.dispatchEvent(new CustomEvent('organization-updated'));
        }} />
      <GenerateApiKeyModal isOpen={isCreateApiKeyOpen} onClose={() => setIsCreateApiKeyOpen(false)}
        onSubmit={async (data) => {
          const result = await consoleApi('/api-keys', { method: 'POST', body: data });
          showToast(t('admin.toast.generate_key_success', 'API Key successfully generated.'));
          void loadConsoleData(true);
          return { secret: result.apiKey.secret };
        }} />
    </div>
  );
};
