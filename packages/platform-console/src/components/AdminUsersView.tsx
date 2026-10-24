import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import { apiRequest } from '@legalio/shared/apiClient';
import { useLanguage } from '../context/LanguageContext';
import { useConfirm } from '../context/ConfirmDialogContext';
import { useAlertToast } from '../context/AlertToastContext';
import { useNavigation } from '../context/NavigationContext';
import type { SystemSubmenu } from '../lib/appRoutes';
import type { ConsoleAccount, ConsoleApiKey, ConsoleConfigurationSection, ConsoleMetrics, ConsoleOrganization, ConsoleSession, ConsoleUser } from './admin/types';
import type { PlatformConfigurationSection } from './admin/PlatformConfigurationPanel';
import { AdminDashboardTab } from './admin/AdminDashboardTab';
import { AdminConsoleHeader } from './admin/AdminConsoleHeader';
import { AdminSessionsTab } from './admin/AdminSessionsTab';
import { AdminOrganizationsTab } from './admin/AdminOrganizationsTab';
import { AdminApiKeysTab } from './admin/AdminApiKeysTab';
import { PlatformUsersTab, type PlatformUser } from './admin/PlatformUsersTab';
import { CreateOrganizationModal, DeleteOrganizationModal, EditOrganizationModal, GenerateApiKeyModal, ResetOrganizationModal } from './admin/AdminModals';

import { Button } from '@legalio/ui-components/button';
import { Alert, AlertActions, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Spinner } from '@legalio/ui-components/spinner';
import { Card } from '@legalio/ui-components/card';
import { List, ListItem } from '@legalio/ui-components/list';
const LazyMailer = lazy(() => import('./admin/MailerPanel').then(m => ({ default: m.MailerPanel })));
const LazyPlatformConfigurationPanel = lazy(() => import('./admin/PlatformConfigurationPanel').then((m) => ({ default: m.PlatformConfigurationPanel })));

const CONFIGURATION_SECTIONS: Record<ConsoleConfigurationSection, PlatformConfigurationSection> = {
  google: 'google',
  'google-drive': 'google-drive',
  'google-credentials': 'google-credentials',
  ai: 'ai',
  smtp: 'notifications',
  'ui-texts': 'language',
  reset: 'security',
};

async function consoleApi<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  return apiRequest<T>(`/auth-console${path}`, { method: (init.method || 'GET') as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', body: init.body, cache: 'no-store' });
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
  const [orgForReset, setOrgForReset] = useState<ConsoleOrganization | null>(null);
  const [isCreateApiKeyOpen, setIsCreateApiKeyOpen] = useState(false);
  const showAlert = useAlertToast();
  const configurationSection = CONFIGURATION_SECTIONS[activeTab as ConsoleConfigurationSection];

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    showAlert({ title: message, variant: type === 'success' ? 'success' : 'destructive' });
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
    <div className="flex w-full flex-col space-y-g21 text-foreground">

      {!configurationSection && activeTab !== 'mailer' && (
        <AdminConsoleHeader
          activeTab={activeTab}
          onRefresh={() => loadConsoleData(true)}
          isRefreshing={isRefreshing}
        />
      )}

      <div id={`admin-system-${activeTab}-panel`} role="region" aria-label={activeTab} className="w-full">
        {activeTab === 'mailer' ? (
          <Suspense fallback={<p role="status">Memuat Mailer…</p>}><LazyMailer /></Suspense>
        ) : configurationSection ? (
          <Suspense fallback={<div role="status" className="flex min-h-g233 items-center justify-center text-sm text-muted-foreground"><Spinner size="sm" decorative /></div>}>
            <LazyPlatformConfigurationPanel activeSection={configurationSection} />
          </Suspense>
        ) : loadError ? (
          <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{t('admin.load_error', 'Data gagal dimuat')}: {loadError}</AlertDescription></AlertContent>
            <AlertActions><Button variant="outline" size="sm" type="button" onClick={() => loadConsoleData()}>{t('admin.retry', 'Coba lagi')}</Button></AlertActions></Alert>
        ) : isLoading ? (
          <div role="status" className="flex min-h-g233 items-center justify-center gap-g8 text-sm text-muted-foreground"><Spinner size="sm" decorative />{t('admin.loading', 'Memuat data akses admin...')}</div>
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
              <List size="sm" marker="none" className="divide-y divide-border rounded-xl border border-border bg-card">
                {accounts.map((a) => (
                  <ListItem key={a.id} className="flex flex-wrap items-center justify-between gap-g8 px-g13 py-g13">
                    <span>{a.userName} · {a.userEmail}</span><span className="text-muted-foreground">{a.providerId}</span>
                  </ListItem>
                ))}
              </List>
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
      <EditOrganizationModal org={orgForEdit} isOpen={Boolean(orgForEdit)} onClose={() => setOrgForEdit(null)} onReset={(org) => setOrgForReset(org)}
        onSubmit={async (orgId, data) => {
          await act(() => consoleApi(`/organizations/${orgId}`, { method: 'PUT', body: { name: data.name, slug: data.slug, expectedVersion: orgForEdit?.version, profile: { logoUrl: data.logo || '' } } }), `${t('admin.toast.org', 'Organisasi')} "${data.name}" ${t('admin.toast.updated_success', 'berhasil diperbarui.')}`);
          window.dispatchEvent(new CustomEvent('organization-updated'));
        }} />
      <ResetOrganizationModal isOpen={Boolean(orgForReset)} org={orgForReset} onClose={() => setOrgForReset(null)}
        onConfirm={async (org, confirm) => {
          await act(() => consoleApi(`/organizations/${org.id}/reset`, { method: 'POST', body: { confirm } }), `${t('admin.toast.org', 'Organisasi')} "${org.name}" ${t('admin.toast.org_reset_success', 'berhasil direset.')}`);
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
