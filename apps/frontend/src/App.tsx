import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SignInForm } from './components/SignInForm';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { ConfirmDialogProvider, useConfirm } from './context/ConfirmDialogContext';
import { AlertToastProvider, useAlertToast } from './context/AlertToastContext';
import { ThemeProvider } from './context/ThemeContext';
import { TenantProvider, useTenant } from './context/TenantContext';
import { TenantSettingsProvider, useTenantSettings } from './context/TenantSettingsContext';
import { DefaultPasswordBanner } from './components/DefaultPasswordBanner';
import { NavigationProvider, useNavigation, buildAppUrl } from './context/NavigationContext';
import { Header } from './components/Header';
import { AppShell } from './components/Sidebar';

import { ConsoleSubmenu } from './components/admin/types';

const LazyDashboardView = lazy(() => import('./components/DashboardView').then((m) => ({ default: m.DashboardView })));
const LazyHierarchyTreemapView = lazy(() => import('./components/HierarchyTreemapView').then((m) => ({ default: m.HierarchyTreemapView })));
const LazyContractsView = lazy(() => import('./components/ContractsView').then((m) => ({ default: m.ContractsView })));
const LazyContractCreatorView = lazy(() => import('./components/ContractCreatorView').then((m) => ({ default: m.ContractCreatorView })));
const LazyApprovalView = lazy(() => import('./features/approvals/ApprovalView').then((m) => ({ default: m.ApprovalView })));
const LazyIOView = lazy(() => import('./components/IOView').then((m) => ({ default: m.IOView })));
const LazyPartnersView = lazy(() => import('./components/PartnersView').then((m) => ({ default: m.PartnersView })));
const LazyPartnerSpendingView = lazy(() => import('./components/PartnerSpendingView').then((m) => ({ default: m.PartnerSpendingView })));
const LazyNotificationsView = lazy(() => import('./components/NotificationsView').then((m) => ({ default: m.NotificationsView })));
const LazyBulkImportView = lazy(() => import('./components/BulkImportView').then((m) => ({ default: m.BulkImportView })));
const LazySettingsView = lazy(() => import('./components/SettingsView').then((m) => ({ default: m.SettingsView })));
const LazyPrivacyPolicyView = lazy(() => import('./components/PrivacyPolicyView').then((m) => ({ default: m.PrivacyPolicyView })));
const LazyTermsOfServiceView = lazy(() => import('./components/TermsOfServiceView').then((m) => ({ default: m.TermsOfServiceView })));

const ContractModal = lazy(() => import('./components/ContractModal').then(m => ({ default: m.ContractModal })));
const IOModal = lazy(() => import('./components/IOModal').then(m => ({ default: m.IOModal })));
const PartnerModal = lazy(() => import('./components/PartnerModal').then(m => ({ default: m.PartnerModal })));
const AmendmentModal = lazy(() => import('./components/AmendmentModal').then(m => ({ default: m.AmendmentModal })));

import {
  Contract,
  InsertionOrder,
  Partner,
  NotificationLog,
  GoogleSheetsConfig,
  PartnerEvaluation,
  PartnerSpending,
} from '@legalio/types';
import { getCachedAccessToken, invalidateGoogleToken } from './lib/googleAuthService';
import { getAuthHeaders } from './lib/apiFetch';
import { deleteRecords } from './lib/bulkDelete';
import { useWorkspaceData } from './features/workspace/useWorkspaceData';
import { buildWorkspaceSearchResults, type WorkspaceSearchResult } from '@legalio/platform-console/lib/workspaceSearch';
import { AIChatLauncher } from './components/AIChatLauncher';
import { Watermark } from './components/Watermark';
import { PermissionProvider, usePermissions } from './lib/permissions';
import { OrganizationOnboarding } from './components/account/OrganizationOnboarding';
import { InvitationPrompt } from './components/account/InvitationPrompt';
import { SETTINGS_TABS, SYSTEM_TABS, needsOrganization, resolveRoute, type SettingsTabId } from './lib/appRoutes';

import { Button } from '@legalio/ui-components/button';
import { Text } from '@legalio/ui-components/text';
import { Spinner } from '@legalio/ui-components/spinner';
import { List, ListItem } from '@legalio/ui-components/list';
/** Full-page state shown instead of any privileged view (PRD §4.5.4, §6.2, §11.3). */
/** `standalone` screens have no app header, so they carry the page's only h1. */
const StateScreen: React.FC<{ title: string; message?: string; children?: React.ReactNode; busy?: boolean; standalone?: boolean }> = ({ title, message, children, busy, standalone }) => {
  const Heading = standalone ? 'h1' : 'h2';
  // A transient load is a quiet status line, not a headline.
  if (busy) return <LoadingState label={title} />;
  return (
  <div className="relative flex min-h-[70dvh] items-center justify-center overflow-hidden px-g21 py-g42" aria-busy={busy || undefined}>
    {/* Soft decoration only: a pale sun and a few drifting bars, no box around the content. */}
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div className="absolute top-[7%] right-[12%] size-[min(26rem,60vw)] rounded-full bg-accent opacity-70" />
      <div className="absolute right-0 bottom-[22%] h-g21 w-[min(18rem,40vw)] rounded-l-full bg-accent opacity-50" />
      <div className="absolute right-[12%] bottom-[14%] h-g21 w-[min(13rem,30vw)] rounded-full bg-accent opacity-50" />
      <div className="absolute bottom-[26%] left-0 h-g26 w-[min(22rem,45vw)] rounded-r-full bg-accent opacity-50" />
      <div className="absolute bottom-[17%] left-[6%] h-g26 w-[min(28rem,55vw)] rounded-full bg-accent opacity-50" />
      <div className="absolute bottom-[10%] left-[14%] h-g21 w-[min(12rem,28vw)] rounded-full bg-accent opacity-50" />
    </div>
    <div className="relative z-10 flex max-w-g610 flex-col items-center gap-g21 text-center">
      <span className="text-base font-semibold text-foreground">Legalio.</span>
      <Heading className="text-3xl font-bold leading-tight tracking-tight text-foreground text-balance sm:text-5xl">{title}</Heading>
      {message && <Text size="md" tone="muted" align="center" className="max-w-g377 text-balance">{message}</Text>}
      {children && <div className="mt-g8 flex w-full flex-wrap justify-center gap-g13">{children}</div>}
    </div>
  </div>
  );
};

/**
 * Page-level loading: small spinner and a 13px muted label, centred.
 * `delayed` hides it for the first 800 ms so a fast session check does not
 * flash a second loader before the in-shell one.
 */
const LoadingState: React.FC<{ label: string; delayed?: boolean }> = ({ label, delayed = false }) => {
  const [visible, setVisible] = useState(!delayed);
  useEffect(() => {
    if (!delayed) return;
    const timer = setTimeout(() => setVisible(true), 800);
    return () => clearTimeout(timer);
  }, [delayed]);
  return (
    <div role="status" aria-label={label} className="flex min-h-g233 flex-1 items-center justify-center gap-g8 p-g21 text-sm text-muted-foreground">
      {visible && <><Spinner size="sm" decorative />{label}</>}
    </div>
  );
};

const MainApp: React.FC = () => {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const showAlert = useAlertToast();

  if (!user) {
    return null;
  }

  const caps = usePermissions();
  const { hasPermission, hasPlatformPermission } = caps;
  const isPlatformAdmin = hasPlatformPermission('platform.access');
  const { activeTenantId, selectionStatus, organizations, switchTenant } = useTenant();
  const { activeTab, setActiveTab, replaceActiveTab } = useNavigation();
  useEffect(() => {
    if (isPlatformAdmin && SYSTEM_TABS.includes(activeTab)) {
      window.location.assign(`/sys?tab=${encodeURIComponent(activeTab)}`);
    }
  }, [isPlatformAdmin, activeTab]);

  const { policy, status: tenantSettingsStatus } = useTenantSettings();
  const modules = policy.settings.modules;
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const confirmDialog = useConfirm();

  /*
   * Route decision runs before any lazy view mounts or loads data. Tabs that
   * need an organization wait for its capabilities; nothing privileged is
   * rendered from a previous organization's or a failed capability state.
   */
  const orgNeeded = needsOrganization(activeTab, isPlatformAdmin);
  type Gate = { kind: 'pending' } | { kind: 'no-org' } | { kind: 'caps-error' } | { kind: 'denied' } | { kind: 'allow' } | { kind: 'redirect'; tab: string; intent?: string };
  const gate: Gate = (() => {
    if (selectionStatus === 'loading') return { kind: 'pending' };
    if (orgNeeded) {
      if (!activeTenantId) return isPlatformAdmin ? { kind: 'redirect', tab: 'admin-system-dashboard' } : { kind: 'no-org' };
      if (caps.status === 'idle' || caps.status === 'loading') return { kind: 'pending' };
      if (caps.status === 'error') return { kind: 'caps-error' };
    }
    const decision = resolveRoute(activeTab, { isPlatformAdmin, organizationReady: caps.status === 'ready', can: hasPermission });
    if (decision.kind !== 'allow') return decision;
    const moduleOff =
      ((activeTab === 'ios' || activeTab === 'io') && !modules.commercialDocuments) ||
      (activeTab === 'partner-spending' && !modules.spending) ||
      (activeTab === 'partner-evaluation' && !modules.evaluation);
    if (moduleOff) return tenantSettingsStatus === 'ready' ? { kind: 'denied' } : { kind: 'pending' };
    return { kind: 'allow' };
  })();

  useEffect(() => {
    if (gate.kind === 'redirect') replaceActiveTab(gate.tab, gate.intent);
  }, [gate.kind, (gate as any).tab, (gate as any).intent, replaceActiveTab]);

  // After a switch the new organization's role governs: administrative screens close (their drafts are
  // discarded); operational tabs stay and the route gate re-checks them against the new capabilities.
  useEffect(() => {
    const onSwitched = () => {
      if (activeTab.startsWith('settings-') || activeTab === 'bulk-import') replaceActiveTab('dashboard');
    };
    window.addEventListener('organization-switched', onSwitched);
    return () => window.removeEventListener('organization-switched', onSwitched);
  }, [activeTab, replaceActiveTab]);

  const { organizationId: dataOrganizationId, contracts, ios, partners, notifications, evaluations, spendings, googleConfig,
    timestamp: lastSyncTimestamp, updateData, cancelPendingLoad, loadAllData, workspaceLoading, workspaceError } = useWorkspaceData();
  const [recordToOpen, setRecordToOpen] = useState<{ kind: WorkspaceSearchResult['kind']; id: string } | null>(null);
  useEffect(() => { setRecordToOpen(null); }, [activeTenantId]);
  const searchResults = useMemo(() => caps.status === 'ready' && dataOrganizationId === activeTenantId
    ? buildWorkspaceSearchResults({ organizationId: activeTenantId, partners, contracts, ios, evaluations, spendings }, user)
    : [], [caps.status, dataOrganizationId, activeTenantId, partners, contracts, ios, evaluations, spendings, user]);

  // Modal States
  const [showContractModal, setShowContractModal] = useState(false);
  const [contractToEdit, setContractToEdit] = useState<Contract | null>(null);

  const [showIOModal, setShowIOModal] = useState(false);
  const [ioToEdit, setIoToEdit] = useState<InsertionOrder | null>(null);

  const [showPartnerModal, setShowPartnerModal] = useState(false);
  const [partnerToEdit, setPartnerToEdit] = useState<Partner | null>(null);
  // The contract, service order and partner forms are pages now; leaving via the sidebar must close them.
  useEffect(() => { setShowContractModal(false); setShowIOModal(false); setShowPartnerModal(false); }, [activeTab]);

  const [showAmendmentModal, setShowAmendmentModal] = useState(false);
  const [amendmentParent, setAmendmentParent] = useState<Contract | InsertionOrder | undefined>(undefined);

  // Notifications go through the shared moduix toaster (AlertToastProvider).
  const showToast = (toast: { type: 'success' | 'warning' | 'error' | 'info'; title: string; message: string }) => {
    const variant = ({ success: 'success', warning: 'warning', error: 'destructive', info: 'default' } as const)[toast.type];
    showAlert({ title: toast.title, description: toast.message, variant });
  };

  // One confirmation for the whole selection; the server refresh below replaces optimistic updates.
  const handleBulkDelete = async (path: string, ids: string[], confirmation: string) => {
    if (ids.length === 0) return;
    const ok = await confirmDialog({ description: confirmation, tone: 'danger', confirmLabel: t('io.action_delete', 'Hapus') });
    if (!ok) return;
    await cancelPendingLoad();
    const failed = await deleteRecords(path, ids, { userEmail: user.email, userName: user.name, userRole: user.role });
    loadAllData();
    if (failed.length > 0) {
      showToast({
        type: 'error',
        title: t('bulk.delete_failed_title', 'Sebagian gagal dihapus'),
        message: t('bulk.delete_failed_message', '{failed} dari {total} gagal dihapus.', { failed: failed.length, total: ids.length }),
      });
    }
  };
  const bulkConfirmation = (count: number, nounKey: string, nounFallback: string) =>
    t('bulk.confirm_delete', 'Hapus {count} {noun} terpilih? Tindakan ini tidak dapat dibatalkan.', { count, noun: t(nounKey, nounFallback) });

  // Contract CRUD Handlers (Optimistic UI)
  const handleSaveContract = async (contractData: any) => {
    await cancelPendingLoad();
    let rollback = () => {};
    const isEditing = Boolean(contractToEdit && contractToEdit.contract_id);
    const url = isEditing ? `/api/contracts/${contractToEdit!.contract_id}` : '/api/contracts';
    const method = isEditing ? 'PUT' : 'POST';

    // 1. Optimistic UI Update (Client side instant update 0ms)
    if (isEditing && contractToEdit) {
      rollback = updateData('contracts', (prev) =>
        prev.map((c) =>
          c.contract_id === contractToEdit.contract_id
            ? { ...c, ...contractData, updated_at: new Date().toISOString() }
            : c
        )
      );
    } else {
      const tempId = contractData.contract_id || `CTR-${Date.now()}`;
      const optimisticContract: Contract = {
        contract_id: tempId,
        ...contractData,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      rollback = updateData('contracts', (prev) => [optimisticContract, ...prev]);
    }

    // 2. Dispatch background API call
    try {
      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ...contractData,
          userEmail: user.email,
          userName: user.name,
          userRole: user.role,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.code ? t(errData.code, errData.error) : errData.error || t('app.terjadi_kesalahan_saat_menyimpan_ke_backend'));
      }
      loadAllData();
    } catch (err: any) {
      rollback();
      showToast({
        type: 'error',
        title: t('app.gagal_menyimpan_kontrak', 'Gagal Menyimpan Kontrak'),
        message: err?.message || t('app.gagal_terhubung_ke_server', 'Gagal terhubung ke server.'),
      });
      loadAllData();
      throw err;
    }
  };

  const handleDeleteContract = async (id: string) => {
    if (
      await confirmDialog({
        description: t('app.hapus_data_kontrak_ini', 'Hapus data kontrak ini?'),
        tone: 'danger',
        confirmLabel: t('io.action_delete', 'Hapus'),
      })
    ) {
      // 1. Optimistic UI update
      await cancelPendingLoad();
      const rollback = updateData('contracts', (prev) => prev.filter((c) => c.contract_id !== id));

      const headers = getAuthHeaders();
      try {
        const res = await fetch(
          `/api/contracts/${id}?userEmail=${encodeURIComponent(user.email)}&userName=${encodeURIComponent(
            user.name
          )}&userRole=${encodeURIComponent(user.role)}`,
          { method: 'DELETE', headers }
        );
        if (!res.ok) {
          rollback();
          showToast({
            type: 'error',
            title: t('app.gagal_menghapus_kontrak', 'Gagal Menghapus Kontrak'),
            message: (await res.json()).error || t('app.gagal_menghapus', 'Gagal menghapus'),
          });
        }
        loadAllData();
      } catch (err: any) {
        rollback();
        showToast({
          type: 'error',
          title: t('app.error', 'Error'),
          message: err?.message || t('app.gagal_menghapus_kontrak_2', 'Gagal menghapus kontrak.'),
        });
        loadAllData();
      }
    }
  };

  // IO CRUD Handlers (Optimistic UI)
  const handleSaveIO = async (ioData: any) => {
    await cancelPendingLoad();
    let rollback = () => {};
    const isEditing = Boolean(ioToEdit && ioToEdit.io_id);
    const url = isEditing ? `/api/ios/${ioToEdit!.io_id}` : '/api/ios';
    const method = isEditing ? 'PUT' : 'POST';

    // 1. Optimistic UI update
    if (isEditing && ioToEdit) {
      rollback = updateData('ios', (prev) =>
        prev.map((i) =>
          i.io_id === ioToEdit.io_id
            ? { ...i, ...ioData, updated_at: new Date().toISOString() }
            : i
        )
      );
    } else {
      const tempId = ioData.io_id || `IO-${Date.now()}`;
      const optimisticIO: InsertionOrder = {
        io_id: tempId,
        ...ioData,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      rollback = updateData('ios', (prev) => [optimisticIO, ...prev]);
    }

    try {
      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ...ioData,
          userEmail: user.email,
          userName: user.name,
          userRole: user.role,
        }),
      });

      if (!res.ok) {

        rollback();
        const errData = await res.json().catch(() => ({}));
        showToast({
          type: 'error',
          title: t('app.gagal_menyimpan_io', 'Gagal Menyimpan IO'),
          message: errData.error || t('app.gagal_menyimpan_insertion_order', 'Gagal menyimpan Insertion Order.'),
        });
      }
      loadAllData();
    } catch (err: any) {
      rollback();
      showToast({
        type: 'error',
        title: t('app.error_koneksi', 'Error Koneksi'),
        message: err?.message || t('app.gagal_menghubungi_server', 'Gagal menghubungi server.'),
      });
      loadAllData();
    }
  };

  const handleDeleteIO = async (id: string) => {
    if (
      await confirmDialog({
        description: t('app.hapus_data_insertion_order_io_ini', 'Hapus data Insertion Order (IO) ini?'),
        tone: 'danger',
        confirmLabel: t('io.action_delete', 'Hapus'),
      })
    ) {
      await cancelPendingLoad();
      const rollback = updateData('ios', (prev) => prev.filter((i) => i.io_id !== id));

      const headers = getAuthHeaders();
      try {
        const res = await fetch(
          `/api/ios/${id}?userEmail=${encodeURIComponent(user.email)}&userName=${encodeURIComponent(
            user.name
          )}&userRole=${encodeURIComponent(user.role)}`,
          { method: 'DELETE', headers }
        );
        if (!res.ok) {
          rollback();
          showToast({
            type: 'error',
            title: t('app.gagal_menghapus_io', 'Gagal Menghapus IO'),
            message: (await res.json()).error || t('app.gagal_menghapus', 'Gagal menghapus'),
          });
        }
        loadAllData();
      } catch (e: any) {
        rollback();
        showToast({
          type: 'error',
          title: t('app.error', 'Error'),
          message: e.message,
        });
        loadAllData();
      }
    }
  };

  // Partner CRUD Handlers (Optimistic UI)
  const handleSavePartner = async (partnerData: any) => {
    await cancelPendingLoad();
    let rollback = () => {};
    const isEditing = Boolean(partnerToEdit && partnerToEdit.partner_id);
    const url = isEditing ? `/api/partners/${partnerToEdit!.partner_id}` : '/api/partners';
    const method = isEditing ? 'PUT' : 'POST';

    // Optimistic UI update
    if (isEditing && partnerToEdit) {
      rollback = updateData('partners', (prev) =>
        prev.map((p) =>
          p.partner_id === partnerToEdit.partner_id
            ? { ...p, ...partnerData, updated_at: new Date().toISOString() }
            : p
        )
      );
    } else {
      const tempId = partnerData.partner_id || `PTR-${Date.now()}`;
      const optimisticPartner: Partner = {
        partner_id: tempId,
        ...partnerData,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      rollback = updateData('partners', (prev) => [optimisticPartner, ...prev]);
    }

    try {
      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ...partnerData,
          userEmail: user.email,
          userName: user.name,
          userRole: user.role,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      loadAllData();
    } catch (err: any) {
      rollback();
      showToast({
        type: 'error',
        title: t('app.error', 'Error'),
        message: err?.message || t('app.gagal_menyimpan_partner', 'Gagal menyimpan partner.'),
      });
      loadAllData();
    }
  };

  const handleDeletePartner = async (id: string, name: string) => {
    if (
      await confirmDialog({
        description: t('app.hapus_partner_kontrak_io_adendum_notifikasi', 'Hapus partner "{name}"? Kontrak, IO, Adendum & Notifikasi terkait ikut terhapus.', { name }),
        tone: 'danger',
        confirmLabel: t('admin.btn_confirm_delete', 'Hapus Permanen'),
      })
    ) {
      // Optimistic delete
      await cancelPendingLoad();
      const restorePartners = updateData('partners', (prev) => prev.filter((p) => p.partner_id !== id));
      const restoreContracts = updateData('contracts', (prev) => prev.filter((c) => c.partner_id !== id));
      const restoreOrders = updateData('ios', (prev) => prev.filter((i) => i.partner_id !== id));

      const rollback = () => { restorePartners(); restoreContracts(); restoreOrders(); };

      const headers = getAuthHeaders();
      try {
        const res = await fetch(
          `/api/partners/${id}?userEmail=${encodeURIComponent(user.email)}&userName=${encodeURIComponent(
            user.name
          )}&userRole=${encodeURIComponent(user.role)}`,
          { method: 'DELETE', headers }
        );
        if (!res.ok) {
          rollback();
          showToast({
            type: 'error',
            title: t('app.gagal_menghapus_partner', 'Gagal Menghapus Partner'),
            message: (await res.json()).error || t('app.gagal_menghapus', 'Gagal menghapus'),
          });
        }
        loadAllData();
      } catch (e: any) {
        rollback();
        showToast({
          type: 'error',
          title: t('app.error', 'Error'),
          message: e.message,
        });
        loadAllData();
      }
    }
  };

  const handleUploadDDDoc = async (_partnerId: string, _docName: string) => {
    loadAllData();
  };

  // Amendment CRUD Handler
  const handleSaveAmendment = async (amendmentData: any) => {
    await cancelPendingLoad();
    let rollback = () => {};
    const tempId = amendmentData.contract_id || `AMD-${Date.now()}`;
    const optimisticAmd: Contract = {
      contract_id: tempId,
      ...amendmentData,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    rollback = updateData('contracts', (prev) => [optimisticAmd, ...prev]);

    try {
      const res = await fetch('/api/contracts', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ...amendmentData,
          userEmail: user.email,
          userName: user.name,
          userRole: user.role,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      loadAllData();
    } catch (err: any) {
      rollback();
      showToast({
        type: 'error',
        title: t('app.error', 'Error'),
        message: err?.message || t('app.gagal_menyimpan_adendum', 'Gagal menyimpan adendum.'),
      });
      loadAllData();
    }
  };

  // Reminder generation is a platform system job; tenant users only refresh their scoped view.
  const handleTriggerCheck = async () => {
    loadAllData();
  };

  const handleMarkReadNotifications = async (notifId?: string, markAll?: boolean) => {
    await fetch('/api/notification-logs/mark-read', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ notif_id: notifId, markAll }),
    });
    loadAllData();
  };

  const handleDeleteNotifications = async (notifId?: string, notifIds?: string[], deleteAll?: boolean) => {
    await fetch('/api/notification-logs/delete', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ notif_id: notifId, notif_ids: notifIds, deleteAll }),
    });
    loadAllData();
  };

  const expiringContractsCount = contracts.filter((c) => c.status === 'Expiring').length;
  const unreadNotifsCount = notifications.filter((n) => !n.is_read).length;

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

  return (
    <div className="h-screen w-full bg-background font-sans text-foreground">
      <a href="#main-content" className="skip-link">
        {t('app.skip_to_content', 'Lewati ke konten utama')}
      </a>
      <AppShell
        searchResults={searchResults}
        searchLoading={workspaceLoading}
        onSelectSearchResult={result => {
          setRecordToOpen({ kind: result.kind, id: result.recordId });
          setActiveTab(result.tab);
        }}
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
                'admin-system-database',
              ].includes(activeTab)}
            />
          )}
          <Suspense fallback={<LoadingState label={t('app.memuat_halaman', 'Memuat halaman...')} />}>
            {gateScreen ?? (showContractModal ? (
              <ContractModal
                key={contractToEdit?.contract_id || 'new'}
                contractToEdit={contractToEdit}
                partners={partners}
                contracts={contracts}
                onClose={() => setShowContractModal(false)}
                onSave={handleSaveContract}
                onRedlineSaved={(id, analysis, at) => updateData('contracts', (prev) =>
                  prev.map((c) => (c.contract_id === id ? { ...c, redline_analysis: analysis, redline_analyzed_at: at } : c))
                )}
              />
            ) : showPartnerModal ? (
              <PartnerModal
                key={partnerToEdit?.partner_id || 'new'}
                partnerToEdit={partnerToEdit}
                partners={partners}
                onClose={() => setShowPartnerModal(false)}
                onSave={handleSavePartner}
                onRedlineSaved={(id, analysis, at) => updateData('partners', (prev) =>
                  prev.map((p) => (p.partner_id === id ? { ...p, redline_analysis: analysis, redline_analyzed_at: at } : p))
                )}
              />
            ) : showIOModal ? (
              <IOModal
                key={ioToEdit?.io_id || 'new'}
                ioToEdit={ioToEdit}
                contracts={contracts}
                partners={partners}
                ios={ios}
                onClose={() => setShowIOModal(false)}
                onSave={handleSaveIO}
                onRedlineSaved={(id, analysis, at) => updateData('ios', (prev) =>
                  prev.map((i) => (i.io_id === id ? { ...i, redline_analysis: analysis, redline_analyzed_at: at } : i))
                )}
              />
            ) : (
            <section className="w-full space-y-g21">
              {activeTab === 'dashboard' && (
                <LazyDashboardView
                  contracts={contracts}
                  ios={ios}
                  partners={partners}
                  spendings={spendings}
                  notifications={notifications}
                  onNavigateTab={setActiveTab}
                  onSelectContract={() => {
                    setActiveTab('contracts');
                  }}
                  onSelectPartner={() => {
                    setActiveTab('partners');
                  }}
                />
              )}

              {activeTab === 'hierarchy' && (
                <LazyHierarchyTreemapView
                  loading={workspaceLoading}
                  error={workspaceError}
                  onRetry={loadAllData}
                  onOpenCalendarDocument={(kind, id) => {
                    setRecordToOpen({ kind, id });
                    setActiveTab(kind === 'contract' ? 'contracts' : 'ios');
                  }}
                  partners={partners}
                  contracts={contracts}
                  ios={ios}
                  evaluations={evaluations}
                  spendings={spendings}
                  onOpenAddPartner={() => {
                    setPartnerToEdit(null);
                    setShowPartnerModal(true);
                  }}
                  onOpenAddContract={(partnerId) => {
                    setContractToEdit(partnerId ? ({ partner_id: partnerId } as any) : null);
                    setShowContractModal(true);
                  }}
                  onOpenAddIO={(contractId, partnerId) => {
                    setIoToEdit(
                      contractId || partnerId
                        ? ({ contract_id: contractId, partner_id: partnerId } as any)
                        : null
                    );
                    setShowIOModal(true);
                  }}
                  onSelectPartner={(p) => {
                    setPartnerToEdit(p);
                    setShowPartnerModal(true);
                  }}
                  onSelectContract={(ctr) => {
                    setContractToEdit(ctr);
                    setShowContractModal(true);
                  }}
                  onSelectIO={(io) => {
                    setIoToEdit(io);
                    setShowIOModal(true);
                  }}
                />
              )}

              {activeTab === 'contracts' && (
                <LazyContractsView
                  openDocumentId={recordToOpen?.kind === 'contract' ? recordToOpen.id : undefined}
                  onDocumentOpened={() => setRecordToOpen(null)}
                  contracts={contracts}
                  partners={partners}
                  ios={ios}
                  onAddContract={() => {
                    setContractToEdit(null);
                    setShowContractModal(true);
                  }}
                  onEditContract={(ctr) => {
                    setContractToEdit(ctr);
                    setShowContractModal(true);
                  }}
                  onDeleteContract={handleDeleteContract}
                  onDeleteContracts={(ids) => handleBulkDelete('/api/contracts', ids, bulkConfirmation(ids.length, 'bulk.noun_contract', 'kontrak'))}
                  onOpenAddendumModal={(ctr) => {
                    setAmendmentParent(ctr);
                    setShowAmendmentModal(true);
                  }}
                />
              )}

              {activeTab === 'create-contract' && (
                <LazyContractCreatorView
                  key={activeTenantId}
                  partners={partners}
                  contracts={contracts}
                  onSaveToSystem={async (data) => {
                    await handleSaveContract(data);
                  }}
                  onNavigateToContracts={() => setActiveTab('contracts')}
                />
              )}

              {activeTab === 'document-approval' && <LazyApprovalView key={activeTenantId} />}

              {(activeTab === 'ios' || activeTab === 'io') && modules.commercialDocuments && (
                <LazyIOView
                  openDocumentId={recordToOpen?.kind === 'io' ? recordToOpen.id : undefined}
                  onDocumentOpened={() => setRecordToOpen(null)}
                  ios={ios}
                  contracts={contracts}
                  partners={partners}
                  onAddIO={() => {
                    setIoToEdit(null);
                    setShowIOModal(true);
                  }}
                  onEditIO={(io) => {
                    setIoToEdit(io);
                    setShowIOModal(true);
                  }}
                  onDeleteIO={handleDeleteIO}
                  onDeleteIOs={(ids) => handleBulkDelete('/api/ios', ids, bulkConfirmation(ids.length, 'bulk.noun_io', 'IO'))}
                />
              )}

              {(activeTab === 'partners' || activeTab === 'partner-evaluation') && (
                <LazyPartnersView
                  openEvaluationId={recordToOpen?.kind === 'evaluation' ? recordToOpen.id : undefined}
                  onEvaluationOpened={() => setRecordToOpen(null)}
                  partners={partners}
                  contracts={contracts}
                  ios={ios}
                  spendings={spendings}
                  evaluations={evaluations}
                  onRefreshData={loadAllData}
                  initialSubTab={activeTab === 'partner-evaluation' ? 'evaluation' : 'list'}
                  onAddPartner={() => {
                    setPartnerToEdit(null);
                    setShowPartnerModal(true);
                  }}
                  onEditPartner={(p) => {
                    setPartnerToEdit(p);
                    setShowPartnerModal(true);
                  }}
                  onDeletePartner={handleDeletePartner}
                  onDeletePartners={(ids) => handleBulkDelete('/api/partners', ids, t('bulk.confirm_delete_partners', 'Hapus {count} partner terpilih? Kontrak, IO, adendum & notifikasi terkait ikut terhapus.', { count: ids.length }))}
                  onUploadDDDoc={handleUploadDDDoc}
                />
              )}

              {activeTab === 'partner-spending' && modules.spending && (
                <LazyPartnerSpendingView
                  openSpendingId={recordToOpen?.kind === 'spending' ? recordToOpen.id : undefined}
                  onSpendingOpened={() => setRecordToOpen(null)}
                  partners={partners}
                  spendings={spendings}
                  contracts={contracts}
                  ios={ios}
                  onRefreshData={loadAllData}
                  userEmail={user.email}
                  userName={user.name}
                  userRole={user.role}
                />
              )}

              {activeTab === 'notifikasi' && (
                <LazyNotificationsView
                  notifications={notifications}
                  onTriggerCheck={handleTriggerCheck}
                  onMarkRead={handleMarkReadNotifications}
                  onDeleteNotif={handleDeleteNotifications}
                />
              )}

              {activeTab.startsWith('admin-system-') && isPlatformAdmin && (
                <StateScreen title={t('sys.opening', 'Opening System Console…')} busy />
              )}

              {activeTab === 'bulk-import' && hasPermission('tenant.data.import') && (
                <LazyBulkImportView
                  partners={partners}
                  contracts={contracts}
                  ios={ios}
                  onRefreshData={loadAllData}
                  userEmail={user.email}
                  userName={user.name}
                  userRole={user.role}
                />
              )}

              {(SETTINGS_TABS as readonly string[]).includes(activeTab) && (
                <LazySettingsView tab={activeTab as SettingsTabId} />
              )}

              {activeTab === 'privacy' && (
                <LazyPrivacyPolicyView onBack={() => setActiveTab('dashboard')} />
              )}

              {activeTab === 'terms' && (
                <LazyTermsOfServiceView onBack={() => setActiveTab('dashboard')} />
              )}
            </section>
            ))}
          </Suspense>
        </main>
      </AppShell>

      {/* Modals */}
      <Suspense fallback={null}>
      {showAmendmentModal && (
        <AmendmentModal
          initialParent={amendmentParent}
          contracts={contracts}
          ios={ios}
          partners={partners}
          onClose={() => setShowAmendmentModal(false)}
          onSave={handleSaveAmendment}
        />
      )}

      </Suspense>

      {modules.aiAssistant && (
        <AIChatLauncher />
      )}

      {modules.watermark && (
        <Watermark text={[organizations.find((org) => org.organizationId === activeTenantId)?.organizationName, user.email, new Date().toLocaleDateString('sv-SE')].filter(Boolean).join(' ')} />
      )}
    </div>
  );
};

const isPrivacyRoute = (): boolean => {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.toLowerCase().replace(/\/$/, '');
  const hash = window.location.hash.toLowerCase();
  return (
    path === '/privacy' ||
    path === '/privacy-policy' ||
    hash === '#privacy' ||
    hash === '#privacy-policy'
  );
};

const isTermsRoute = (): boolean => {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.toLowerCase().replace(/\/$/, '');
  const hash = window.location.hash.toLowerCase();
  return (
    path === '/tos' ||
    path === '/terms' ||
    path === '/terms-of-service' ||
    hash === '#tos' ||
    hash === '#terms' ||
    hash === '#terms-of-service'
  );
};

const AppContent = () => {
  const { user, loading } = useAuth();
  const { activeTab, replaceActiveTab } = useNavigation();
  const { t } = useLanguage();
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState<boolean>(isPrivacyRoute);
  const [showTermsOfService, setShowTermsOfService] = useState<boolean>(isTermsRoute);

  useEffect(() => {
    const handleLocationChange = () => {
      setShowPrivacyPolicy(isPrivacyRoute());
      setShowTermsOfService(isTermsRoute());
    };

    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, []);

  useEffect(() => {
    if (loading || showPrivacyPolicy || showTermsOfService) return;
    if (!user) {
      if (activeTab !== 'login') replaceActiveTab('login');
      return;
    }
    if (activeTab === 'login') {
      replaceActiveTab(user.platformRole === 'superuser' ? 'admin-system-dashboard' : 'dashboard');
    }
  }, [activeTab, loading, replaceActiveTab, showPrivacyPolicy, showTermsOfService, user]);

  const handleOpenPrivacy = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', '/privacy');
    }
    setShowPrivacyPolicy(true);
    setShowTermsOfService(false);
  };

  const handleOpenTerms = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', '/tos');
    }
    setShowTermsOfService(true);
    setShowPrivacyPolicy(false);
  };

  const handleBackToMain = () => {
    setShowPrivacyPolicy(false);
    setShowTermsOfService(false);
    if (typeof window !== 'undefined') {
      const path = window.location.pathname.toLowerCase().replace(/\/$/, '');
      if (
        path === '/privacy' ||
        path === '/privacy-policy' ||
        path === '/tos' ||
        path === '/terms' ||
        path === '/terms-of-service' ||
        window.location.hash
      ) {
        window.history.pushState(null, '', buildAppUrl(activeTab));
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground ">
        <LoadingState delayed label={t('app.memuat', 'Memuat...')} />
      </div>
    );
  }

  if (showPrivacyPolicy) {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted-foreground">{t('app.memuat_kebijakan', 'Memuat kebijakan...')}</div>}>
        <LazyPrivacyPolicyView onBack={handleBackToMain} />
      </Suspense>
    );
  }

  if (showTermsOfService) {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted-foreground">{t('app.memuat_syarat_ketentuan', 'Memuat syarat & ketentuan...')}</div>}>
        <LazyTermsOfServiceView onBack={handleBackToMain} />
      </Suspense>
    );
  }

  if (!user) {
    return (
        <SignInForm
          onOpenPrivacyPolicy={handleOpenPrivacy}
          onOpenTermsOfService={handleOpenTerms}
        />
    );
  }

  if (activeTab === 'login') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground ">
        <LoadingState delayed label={t('app.memuat', 'Memuat...')} />
      </div>
    );
  }

  return (
    <>
      <InvitationPrompt />
      <MainApp />
    </>
  );
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 10000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    // Identity → organization selection → capabilities → runtime policy (PRD §11.1).
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <LanguageProvider>
            <ConfirmDialogProvider>
              <AlertToastProvider>
                <TenantProvider>
                  <PermissionProvider>
                    <TenantSettingsProvider>
                      <NavigationProvider>
                        <AppContent />
                      </NavigationProvider>
                    </TenantSettingsProvider>
                  </PermissionProvider>
                </TenantProvider>
              </AlertToastProvider>
            </ConfirmDialogProvider>
          </LanguageProvider>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
