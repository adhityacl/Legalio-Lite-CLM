import React, { Suspense, lazy, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTenant } from '../context/TenantContext';
import { useTenantSettings } from '../context/TenantSettingsContext';
import { useNavigation } from '../context/NavigationContext';
import { Header } from '../components/Header';
import { AppShell } from '../components/Sidebar';
import { DefaultPasswordBanner } from '../components/DefaultPasswordBanner';
import { AIChatLauncher } from '../components/AIChatLauncher';
import { Watermark } from '../components/Watermark';
import { OrganizationOnboarding } from '../components/account/OrganizationOnboarding';
import { LoadingState, StateScreen } from '../components/StateScreen';
import { usePermissions } from '../lib/permissions';
import { SYSTEM_TABS } from '../lib/appRoutes';
import { useBadgeAggregate } from '../features/aggregates/useAggregates';
import { useWorkspaceSearch } from '../features/aggregates/useWorkspaceSearch';
import { useNotifications } from '../features/notifications/useNotifications';
import { WorkspaceProvider, useWorkspace } from '../features/workspace/WorkspaceContext';
import { ROUTES } from '../routes/registry';
import { RouteBoundary } from '../routes/RouteBoundary';
import { useRouteGate } from '../routes/useRouteGate';
import { Button } from '@legalio/ui-components/button';
import { List, ListItem } from '@legalio/ui-components/list';

const ContractModal = lazy(() => import('../components/ContractModal').then((m) => ({ default: m.ContractModal })));
const IOModal = lazy(() => import('../components/IOModal').then((m) => ({ default: m.IOModal })));
const PartnerModal = lazy(() => import('../components/PartnerModal').then((m) => ({ default: m.PartnerModal })));
const AmendmentModal = lazy(() => import('../components/AmendmentModal').then((m) => ({ default: m.AmendmentModal })));

type SignedInUser = NonNullable<ReturnType<typeof useAuth>['user']>;

/** Signed-in application: decides whether the requested page may be shown, then mounts the workspace and its shell. */
export const AuthenticatedApp: React.FC<{ user: SignedInUser }> = ({ user }) => {
  const { logout } = useAuth();
  const { t } = useLanguage();
  const caps = usePermissions();
  const { hasPermission, hasPlatformPermission } = caps;
  const isPlatformAdmin = hasPlatformPermission('platform.access');
  const { activeTenantId, selectionStatus, organizations, switchTenant } = useTenant();
  const { activeTab, replaceActiveTab } = useNavigation();
  const { policy, status: tenantSettingsStatus } = useTenantSettings();

  useEffect(() => {
    if (isPlatformAdmin && SYSTEM_TABS.includes(activeTab)) {
      window.location.assign(`/sys?tab=${encodeURIComponent(activeTab)}`);
    }
  }, [isPlatformAdmin, activeTab]);

  const gate = useRouteGate({
    tab: activeTab, isPlatformAdmin, selectionStatus, activeTenantId, capabilityStatus: caps.status,
    can: hasPermission, modules: policy.settings.modules, tenantSettingsReady: tenantSettingsStatus === 'ready',
  });

  useEffect(() => {
    if (gate.kind === 'redirect') replaceActiveTab(gate.tab, gate.intent);
  }, [gate, replaceActiveTab]);

  // After a switch the new organization's role governs: administrative screens close (their drafts are
  // discarded); operational tabs stay and the route gate re-checks them against the new capabilities.
  useEffect(() => {
    const onSwitched = () => {
      if (activeTab.startsWith('settings-') || activeTab === 'bulk-import') replaceActiveTab('dashboard');
    };
    window.addEventListener('organization-switched', onSwitched);
    return () => window.removeEventListener('organization-switched', onSwitched);
  }, [activeTab, replaceActiveTab]);

  if (gate.kind === 'no-org') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-(--moduix-color-background) text-(--moduix-color-foreground)">
        {selectionStatus === 'choose' ? (
          <StateScreen standalone title={t('tb.choose_organization', 'Choose an organization')} message={t('tb.choose_organization_desc', 'You belong to several organizations. Choose the one to work in for this tab.')}>
            <List marker="none" className="grid w-full gap-g8">
              {organizations.map((org) => (
                <ListItem key={org.organizationId}>
                  <Button variant="outline" className="w-full justify-start" onClick={() => void switchTenant(org.organizationId)}>
                    {org.organizationName}
                  </Button>
                </ListItem>
              ))}
            </List>
            <Button variant="link" type="button" onClick={() => void logout()}>{t('app.kembali_ke_login', 'Kembali ke login')}</Button>
          </StateScreen>
        ) : (
          <OrganizationOnboarding />
        )}
      </div>
    );
  }

  return (
    <WorkspaceProvider>
      <WorkspaceShell user={user} gate={gate} isPlatformAdmin={isPlatformAdmin} />
    </WorkspaceProvider>
  );
};

type Gate = ReturnType<typeof useRouteGate>;

const WorkspaceShell: React.FC<{ user: SignedInUser; gate: Gate; isPlatformAdmin: boolean }> = ({ user, gate, isPlatformAdmin }) => {
  const { t } = useLanguage();
  const caps = usePermissions();
  const { hasPermission } = caps;
  const { activeTenantId, organizations } = useTenant();
  const { activeTab, setActiveTab, replaceActiveTab } = useNavigation();
  const { policy } = useTenantSettings();
  const modules = policy.settings.modules;
  const workspace = useWorkspace();
  // The editors and the amendment dialog pick from every partner/contract/order: the workspace snapshot is loaded while one is open.
  const { contracts, ios, partners, googleConfig, loadAllData, workspaceError, snapshotLoaded, editor, closeEditor, amendmentOpen, amendmentParent, closeAmendment, actions } = workspace;
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Search palette, navigation badges and the bell come from the server (search, aggregates, notification list), not from a snapshot.
  const search = useWorkspaceSearch();
  const badges = useBadgeAggregate();
  const { notifications } = useNotifications();
  const expiringContractsCount = badges.data?.expiringContracts ?? 0;
  const unreadNotifsCount = badges.data?.unreadNotifications ?? 0;
  const lastSyncTimestamp = badges.dataUpdatedAt || 0;
  const editorWaiting = Boolean(editor) && !snapshotLoaded;

  const permittedHome = hasPermission('document.view') ? 'dashboard' : isPlatformAdmin ? 'admin-system-dashboard' : null;
  const gateScreen =
    gate.kind === 'pending' || gate.kind === 'redirect' ? (
      <StateScreen busy title={t('app.memuat_halaman', 'Memuat halaman...')} />
    ) : gate.kind === 'caps-error' ? (
      <StateScreen title={t('tb.access_check_failed', 'Your access could not be checked')} message={t('tb.access_check_failed_desc', 'Nothing is shown until your permissions for this organization load.')}>
        <Button variant="outline" size="lg" type="button" onClick={caps.retry}>{t('tb.retry', 'Retry')}</Button>
      </StateScreen>
    ) : gate.kind === 'denied' ? (
      <StateScreen title={t('tb.access_denied', 'You do not have access to this page')} message={t('tb.access_denied_desc', 'Your role in this organization does not include this page.')}>
        {permittedHome && <Button variant="outline" size="lg" type="button" onClick={() => replaceActiveTab(permittedHome)}>{t('tb.go_to_permitted', 'Go to an allowed page')}</Button>}
      </StateScreen>
    ) : null;

  const route = ROUTES[activeTab];
  const Page = route?.component;

  let content: React.ReactNode = gateScreen;
  if (!content) {
    if (editorWaiting) {
      content = workspaceError ? (
        <StateScreen title={t('app.failed_to_fetch_initial_data', 'Failed to fetch initial data')}>
          <Button variant="outline" size="lg" type="button" onClick={() => void loadAllData()}>{t('tb.retry', 'Retry')}</Button>
          <Button variant="link" type="button" onClick={closeEditor}>{t('common.close', 'Tutup')}</Button>
        </StateScreen>
      ) : <LoadingState label={t('app.memuat_halaman', 'Memuat halaman...')} />;
    } else if (editor?.kind === 'contract') {
      content = (
        <ContractModal
          key={editor.record?.contract_id || 'new'}
          contractToEdit={editor.record}
          partners={partners}
          contracts={contracts}
          onClose={closeEditor}
          onSave={(data: Record<string, any>) => actions.saveContract(data, editor.record)}
          onRedlineSaved={(id, analysis, at) => workspace.updateData('contracts', (prev) =>
            prev.map((c) => (c.contract_id === id ? { ...c, redline_analysis: analysis, redline_analyzed_at: at } : c)))}
        />
      );
    } else if (editor?.kind === 'partner') {
      content = (
        <PartnerModal
          key={editor.record?.partner_id || 'new'}
          partnerToEdit={editor.record}
          partners={partners}
          onClose={closeEditor}
          onSave={(data: Record<string, any>) => actions.savePartner(data, editor.record)}
          onRedlineSaved={(id, analysis, at) => workspace.updateData('partners', (prev) =>
            prev.map((p) => (p.partner_id === id ? { ...p, redline_analysis: analysis, redline_analyzed_at: at } : p)))}
        />
      );
    } else if (editor?.kind === 'io') {
      content = (
        <IOModal
          key={editor.record?.io_id || 'new'}
          ioToEdit={editor.record}
          contracts={contracts}
          partners={partners}
          ios={ios}
          onClose={closeEditor}
          onSave={(data: Record<string, any>) => actions.saveOrder(data, editor.record)}
          onRedlineSaved={(id, analysis, at) => workspace.updateData('ios', (prev) =>
            prev.map((i) => (i.io_id === id ? { ...i, redline_analysis: analysis, redline_analyzed_at: at } : i)))}
        />
      );
    } else if (Page) {
      content = (
        <section className="w-full space-y-g21">
          <Page {...(route.props ?? {})} />
        </section>
      );
    } else if (activeTab.startsWith('admin-system-') && isPlatformAdmin) {
      content = <StateScreen title={t('sys.opening', 'Opening System Console…')} busy />;
    }
  }

  return (
    <div className="h-screen w-full bg-background font-sans text-foreground">
      <a href="#main-content" className="skip-link">
        {t('app.skip_to_content', 'Lewati ke konten utama')}
      </a>
      <AppShell
        searchResults={search.results}
        searchLoading={search.loading}
        onSearchQueryChange={search.setQuery}
        // The record id goes into the URL (`?tab=contracts&id=C0001`), so the opened record can be shared and reloaded.
        onSelectSearchResult={result => setActiveTab(result.tab, undefined, { recordId: result.recordId })}
        navigation={{
          activeTab,
          setActiveTab,
          unresolvedNotifsCount: unreadNotifsCount,
          expiringContractsCount,
          lastSyncTimestamp,
          isMobileOpen: isMobileMenuOpen,
          onCloseMobile: () => setIsMobileMenuOpen(false),
        }}
        header={
          <Header
            notifications={notifications}
            googleConfig={googleConfig}
            onRefreshData={loadAllData}
            onNavigateToTab={setActiveTab}
            onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          />
        }
      >
        <main
          id="main-content"
          tabIndex={-1}
          // The AI chat launcher is fixed bottom-right; reserve room so it never covers the last row's actions.
          className={`flex-1 min-h-0 p-g13 sm:p-g21 md:p-g34 ${modules.aiAssistant ? 'pb-g89 sm:pb-g89 md:pb-g89' : ''} overflow-y-auto overflow-x-hidden bg-background overscroll-contain focus:outline-none`}
        >
          {isPlatformAdmin && (
            <DefaultPasswordBanner
              onOpenSecurity={() => setActiveTab('admin-system-users')}
              showGoogleSetup={activeTab === 'admin-system-dashboard' || [
                'admin-system-google',
                'admin-system-ai',
                'admin-system-smtp',
                'admin-system-ui-texts',
              ].includes(activeTab)}
            />
          )}
          {/* One boundary per page: a crash or a failed chunk shows here and clears when another page is opened. */}
          <RouteBoundary key={`${activeTenantId}:${editor ? `edit-${editor.kind}` : activeTab}`} routeId={editor ? `edit-${editor.kind}` : activeTab} onGoHome={() => replaceActiveTab('dashboard')}>
            <Suspense fallback={<LoadingState label={t('app.memuat_halaman', 'Memuat halaman...')} />}>
              {content}
            </Suspense>
          </RouteBoundary>
        </main>
      </AppShell>

      <Suspense fallback={null}>
        {amendmentOpen && snapshotLoaded && (
          <AmendmentModal
            initialParent={amendmentParent}
            contracts={contracts}
            ios={ios}
            partners={partners}
            onClose={closeAmendment}
            onSave={actions.saveAmendment}
          />
        )}
      </Suspense>

      {modules.aiAssistant && <AIChatLauncher />}

      {modules.watermark && (
        <Watermark text={[organizations.find((org) => org.organizationId === activeTenantId)?.organizationName, user.email, new Date().toLocaleDateString('sv-SE')].filter(Boolean).join(' ')} />
      )}
    </div>
  );
};

