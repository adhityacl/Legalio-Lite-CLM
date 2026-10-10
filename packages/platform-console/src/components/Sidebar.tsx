import React, { useState, useRef, useEffect } from 'react';
import { Dialog } from 'radix-ui';
import {
  Globe2,
  LayoutDashboard,
  Building2,
  ClipboardCheck,
  CreditCard,
  FileText,
  FileSignature,
  FileSpreadsheet,
  GitFork,
  Bell,
  Users,
  Clock,
  Settings,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Moon,
  Sun,
  Upload,
  X,
  Sliders,
  Mail,
  Database,
  Languages,
  ShieldAlert,
} from 'lucide-react';
import { AiIcon } from './icons/AiIcon';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { GoogleSheetsConfig } from '@legalio/types';
import { isGoogleTokenValid, getGoogleTokenRemainingMinutes } from '../lib/googleAuthService';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { usePermissions } from '../lib/permissions';
import { useTenantSettings } from '../context/TenantSettingsContext';

interface SidebarProps {
  showSystemAdmin?: boolean;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  unresolvedNotifsCount: number;
  expiringContractsCount: number;
  googleConfig?: GoogleSheetsConfig;
  lastSyncTimestamp?: number;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

interface SidebarNavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | null;
  badgeColor?: string;
  adminOnly?: boolean;
  systemOnly?: boolean;
  tenantOnly?: boolean;
  permission?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  showSystemAdmin = false,
  activeTab,
  setActiveTab,
  unresolvedNotifsCount,
  expiringContractsCount,
  googleConfig,
  lastSyncTimestamp: _lastSyncTimestamp,
  isMobileOpen = false,
  onCloseMobile,
}) => {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!isMobileOpen) return;
    const desktop = window.matchMedia('(min-width: 768px)');
    const closeOnDesktop = () => { if (desktop.matches) onCloseMobile?.(); };
    closeOnDesktop();
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, [isMobileOpen, onCloseMobile]);
  const { hasPermission, hasPlatformPermission } = usePermissions();
  const { t } = useLanguage();
  const { policy } = useTenantSettings();
  const modules = policy.settings.modules;
  const { theme, toggleTheme } = useTheme();

  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });

  const [isPartnerExpanded, setIsPartnerExpanded] = useState<boolean>(() => {
    return activeTab === 'partners' || activeTab === 'partner-evaluation' || activeTab === 'partner-spending';
  });

  const [isAdminExpanded, setIsAdminExpanded] = useState<boolean>(() => {
    return activeTab.startsWith('admin-system-');
  });

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar_collapsed', String(next));
      return next;
    });
  };

  // Google OAuth Drive Storage Status
  const isDriveConfigured = Boolean(googleConfig?.isConnected);
  const hasGoogleToken = typeof window !== 'undefined' && Boolean(localStorage.getItem('google_access_token'));
  const isTokenValid = isGoogleTokenValid();
  const tokenMinutes = getGoogleTokenRemainingMinutes();

  let driveDotClass = 'bg-ink-faint ring-hairline/20';
  let driveTooltip = 'Google Drive: Belum Dikonfigurasi (Unggahan file disimpan lokal)';

  if (isDriveConfigured) {
    if (!hasGoogleToken || !isTokenValid || tokenMinutes <= 0) {
      driveDotClass = 'bg-status-danger ring-status-danger-border/20';
      driveTooltip = 'Google Drive: Sesi Google kadaluarsa atau belum terhubung';
    } else if (tokenMinutes <= 10) {
      driveDotClass = 'bg-status-warning ring-status-warning-border/20';
      driveTooltip = `Google Drive: Token akan kadaluarsa (Sisa ~${tokenMinutes} menit)`;
    } else {
      driveDotClass = 'bg-status-success ring-status-success-border/20';
      driveTooltip = `Google Drive: Terhubung & Siap (Sisa ~${tokenMinutes} menit)`;
    }
  }

  // Navigation Items
  const mainNavItems: SidebarNavItem[] = [
    {
      id: 'dashboard',
      label: t('nav.dashboard', 'Dashboard'),
      icon: LayoutDashboard,
      permission: 'document.view',
    },
    {
      id: 'hierarchy',
      label: t('nav.hierarchy', 'Struktur Dokumen'),
      icon: GitFork,
      permission: 'document.view',
    },
    {
      id: 'partners',
      label: t('nav.partners', 'Mitra Kerja'),
      icon: Building2,
      permission: 'document.view',
    },
    {
      id: 'contracts',
      label: t('nav.contracts', 'Kontrak'),
      icon: FileText,
      permission: 'document.view',
      badge: expiringContractsCount > 0 ? `${expiringContractsCount}` : null,
      badgeColor: 'bg-status-warning-soft text-status-warning dark:bg-status-warning-soft/60  border border-status-warning-border ',
    },
    ...(modules.commercialDocuments
      ? [{
          id: 'ios',
          label: t('nav.ios', '{docs}'),
          icon: FileSpreadsheet,
          permission: 'document.view',
        }]
      : []),
    {
      id: 'notifikasi',
      label: t('nav.notifications', 'Notifikasi'),
      icon: Bell,
      permission: 'document.view',
      badge: unresolvedNotifsCount > 0 ? `${unresolvedNotifsCount}` : null,
      badgeColor: 'bg-status-danger-soft text-status-danger dark:bg-status-danger-soft/60  border border-status-danger-border ',
    },
  ];

  const docNavItems: SidebarNavItem[] = [
    {
      id: 'create-contract',
      label: t('nav.create_contract', 'Dokumen Saya'),
      icon: FileSignature,
      permission: 'document.create',
    },
  ];

  /*
   * Administration (PRD §6.1): System Admin only in the standalone console for platform administrators,
   * Import Data for tenant admins, and exactly one Settings entry for
   * whoever may open at least one of its tabs.
   */
  const adminNavItems: SidebarNavItem[] = [
    { id: 'admin-system', label: t('nav.system_admin', 'System Admin'), icon: Users, systemOnly: true },
    { id: 'bulk-import', label: t('nav.bulk_import', 'Import Data'), icon: Upload, permission: 'tenant.data.import' },
    ...(hasPermission('tenant.settings.read') || hasPermission('tenant.member.read')
      ? [{ id: 'settings', label: t('nav.settings', 'Pengaturan'), icon: Settings }]
      : []),
  ];

  const visible = (item: SidebarNavItem) =>
    (!item.systemOnly || (showSystemAdmin && hasPlatformPermission('platform.access'))) &&
    (!item.permission || hasPermission(item.permission));

  const navSections = [
    { id: 'main', title: t('nav.main_title', 'Menu Utama'), items: mainNavItems.filter(visible) },
    { id: 'documents', title: t('nav.doc_title', 'Dokumen'), items: docNavItems.filter(visible) },
    { id: 'admin', title: t('nav.admin_title', 'Administrasi'), items: adminNavItems.filter(visible) },
  ].filter((section) => section.items.length > 0);

  const systemDashboardTabs = [
    'admin-system-dashboard',
    'admin-system-users',
    'admin-system-accounts',
    'admin-system-sessions',
    'admin-system-organizations',
    'admin-system-apikeys',
  ];

  const systemAdminSubItems = [
    { id: 'admin-system-dashboard', label: t('admin.tab_dashboard', 'Dashboard'), icon: Sliders },
    { id: 'admin-system-google', label: t('tb.config_google', 'Google & storage'), icon: Globe2 },
    { id: 'admin-system-ai', label: t('settings.nav_ai', 'AI Model & Parser'), icon: AiIcon },
    { id: 'admin-system-smtp', label: t('tb.config_smtp', 'SMTP relay'), icon: Mail },
    { id: 'admin-system-ui-texts', label: t('tb.config_texts_short', 'UI texts'), icon: Languages },
    { id: 'admin-system-design-system', label: t('designSystem.title', 'Design System'), icon: Sliders },
    { id: 'admin-system-backups', label: t('backup.title', 'Backup & Restore'), icon: Database },
    { id: 'admin-system-database', label: t('tb.config_maintenance', 'Database & reset'), icon: Database },
  ];

  // Submenu definition for Partners
  const partnerSubItems = [
    { id: 'partners', label: t('nav.partners_list', 'Daftar Mitra'), icon: Building2 },
    ...(modules.evaluation ? [{ id: 'partner-evaluation', label: t('nav.partner_eval', 'Evaluasi Kinerja'), icon: ClipboardCheck }] : []),
    ...(modules.spending ? [{ id: 'partner-spending', label: t('nav.partner_spending', 'Pengeluaran Mitra'), icon: CreditCard }] : []),
  ];

  const handleNavClick = (tabId: string) => {
    setActiveTab(tabId);
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  // Reusable Nav List Renderer for both Desktop and Mobile
  const renderNavList = (isMobile: boolean) => {
    return (
      <div className="space-y-4">
        {navSections.map((section, sectionIdx) => (
          <div key={section.id} className="space-y-1">
            {!isCollapsed || isMobile ? (
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft px-3 pt-1 pb-1">
                {section.title}
              </p>
            ) : (
              sectionIdx > 0 && <div className="w-8 h-px bg-surface-2 mx-auto my-2" />
            )}

            <nav className="space-y-1" role="navigation" aria-label={section.title}>
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === 'settings' ? activeTab.startsWith('settings-') : activeTab === item.id;
                const isPartnerActive =
                  activeTab === 'partners' ||
                  activeTab === 'partner-evaluation' ||
                  activeTab === 'partner-spending';
                const isAdminActive = activeTab.startsWith('admin-system-');
                const isSettingsActive = activeTab.startsWith('settings-');

                // Collapsed desktop mode
                if (isCollapsed && !isMobile) {
                  const collapsedActive =
                    item.id === 'partners'
                      ? isPartnerActive
                      : item.id === 'admin-system'
                      ? isAdminActive
                      : item.id === 'settings'
                      ? isSettingsActive
                      : isActive;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        handleNavClick(
                          item.id === 'admin-system'
                            ? 'admin-system-dashboard'
                            : item.id
                        )
                      }
                      title={item.label}
                      aria-label={item.label}
                      aria-current={collapsedActive ? 'page' : undefined}
                      className={`relative w-10 h-10 mx-auto flex items-center justify-center rounded-xl transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none ${
                        collapsedActive
                          ? 'bg-accent-strong text-white shadow-2xs font-semibold'
                          : 'text-ink-soft hover:bg-surface-2 dark:hover:bg-surface-2 hover:text-ink dark:hover:text-white'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {item.badge && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 bg-status-danger text-white text-xs font-bold rounded-full flex items-center justify-center border-2 border-white">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                }

                // Partner Item with Submenu
                if (item.id === 'partners') {
                  return (
                    <div key={item.id} className="space-y-0.5">
                      <div
                        className={`w-full flex items-center justify-between px-3 ${
                          isMobile ? 'min-h-11' : 'min-h-9.5'
                        } rounded-xl text-xs font-semibold transition-colors cursor-pointer select-none ${
                          isPartnerActive
                            ? 'bg-accent-strong text-white shadow-2xs'
                            : 'text-ink hover:bg-surface-2 dark:hover:bg-surface-2 hover:text-ink dark:hover:text-white'
                        }`}
                      >
                        <button type="button" onClick={() => {
                          handleNavClick('partners');
                          setIsPartnerExpanded(true);
                        }} className="flex flex-1 self-stretch min-w-0 items-center gap-2.5 text-left">
                          <Icon className="w-4 h-4 shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsPartnerExpanded((prev) => !prev);
                          }}
                          className={`${isMobile ? 'size-11' : 'size-9'} shrink-0 inline-flex items-center justify-center bg-transparent focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none`}
                          aria-label={isPartnerExpanded ? t('nav.tutup_submenu', 'Tutup Submenu') : t('nav.buka_submenu', 'Buka Submenu')}
                          aria-expanded={isPartnerExpanded}
                        >
                          <ChevronRight
                            className={`w-3.5 h-3.5 transition-transform duration-200 ${isPartnerExpanded ? 'rotate-90' : ''}`}
                          />
                        </button>
                      </div>

                      {isPartnerExpanded && (
                        <div className="pl-3.5 pr-1 space-y-0.5 border-l border-hairline ml-3.5 mt-0.5 animate-in fade-in duration-150">
                          {partnerSubItems.map((sub) => {
                            const SubIcon = sub.icon;
                            const isSubActive = activeTab === sub.id;
                            return (
                              <button
                                key={sub.id}
                                type="button"
                                onClick={() => handleNavClick(sub.id)}
                                aria-current={isSubActive ? 'page' : undefined}
                                className={`w-full flex items-center gap-2 px-2.5 py-1.5 ${
                                  isMobile ? 'min-h-10' : 'min-h-8'
                                } rounded-lg text-xs font-medium transition-colors cursor-pointer text-left focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none ${
                                  isSubActive
                                    ? 'bg-accent-soft text-accent-text font-semibold'
                                    : 'text-ink-soft hover:text-ink dark:hover:text-white hover:bg-surface-2 dark:hover:bg-surface-2/60'
                                }`}
                              >
                                <SubIcon className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{sub.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }

                // Admin Item with Submenu
                if (item.id === 'admin-system') {
                  const submenuItems = systemAdminSubItems;
                  return (
                    <div key={item.id} className="space-y-0.5">
                      <div
                        className={`w-full flex items-center justify-between px-3 ${
                          isMobile ? 'min-h-11' : 'min-h-9.5'
                        } rounded-xl text-xs font-semibold transition-colors cursor-pointer select-none ${
                          isAdminActive
                            ? 'bg-accent-strong text-white shadow-2xs'
                            : 'text-ink hover:bg-surface-2 dark:hover:bg-surface-2 hover:text-ink dark:hover:text-white'
                        }`}
                      >
                        <button type="button" onClick={() => {
                          handleNavClick('admin-system-dashboard');
                          setIsAdminExpanded(true);
                        }} className="flex flex-1 self-stretch min-w-0 items-center gap-2.5 text-left">
                          <Icon className="w-4 h-4 shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsAdminExpanded((prev) => !prev);
                          }}
                          className={`${isMobile ? 'size-11' : 'size-9'} shrink-0 inline-flex items-center justify-center bg-transparent focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none`}
                          aria-label={isAdminExpanded ? t('nav.tutup_submenu', 'Tutup Submenu') : t('nav.buka_submenu', 'Buka Submenu')}
                          aria-expanded={isAdminExpanded}
                        >
                          <ChevronRight
                            className={`w-3.5 h-3.5 transition-transform duration-200 ${isAdminExpanded ? 'rotate-90' : ''}`}
                          />
                        </button>
                      </div>

                      {isAdminExpanded && (
                        <div className="pl-3.5 pr-1 space-y-0.5 border-l border-hairline ml-3.5 mt-0.5 animate-in fade-in duration-150">
                          {submenuItems.map((sub) => {
                            const SubIcon = sub.icon;
                            const subTab = sub.id;
                            const isSubActive = subTab === 'admin-system-dashboard'
                              ? systemDashboardTabs.includes(activeTab)
                              : activeTab === subTab;
                            return (
                              <button
                                key={sub.id}
                                type="button"
                                onClick={() => handleNavClick(subTab)}
                                aria-current={isSubActive ? 'page' : undefined}
                                className={`w-full flex items-center gap-2 px-2.5 py-1.5 ${
                                  isMobile ? 'min-h-10' : 'min-h-8'
                                } rounded-lg text-xs font-medium transition-colors cursor-pointer text-left focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none ${
                                  isSubActive
                                    ? 'bg-accent-soft text-accent-text font-semibold'
                                    : 'text-ink-soft hover:text-ink dark:hover:text-white hover:bg-surface-2 dark:hover:bg-surface-2/60'
                                }`}
                              >
                                <SubIcon className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{sub.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }

                // Regular Nav Item
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavClick(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`w-full flex items-center justify-between px-3 py-2 ${
                      isMobile ? 'min-h-11' : 'min-h-9.5'
                    } rounded-xl text-xs font-semibold transition-colors cursor-pointer select-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none ${
                      isActive
                        ? 'bg-accent-strong text-white shadow-2xs'
                        : 'text-ink hover:bg-surface-2 dark:hover:bg-surface-2 hover:text-ink dark:hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </div>

                    {item.badge && (
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          item.badgeColor ||
                          'bg-status-danger-soft text-status-danger dark:bg-status-danger-soft/50 border border-status-danger-border dark:border-status-danger-border/50'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden md:flex ${
          isCollapsed ? 'w-18' : 'w-64'
        } bg-surface flex-col shrink-0 text-ink border-r border-hairline/80 transition-all duration-300 ease-in-out z-30 sticky top-0 h-screen`}
      >
        {/* Workspace Switcher + Collapse Button */}
        <div
          className={`h-16 px-3 flex items-center ${
            isCollapsed ? 'justify-center' : 'justify-between gap-1.5'
          } border-b border-hairline/80 shrink-0 relative`}
        >
          {isCollapsed ? (
            <button
              type="button"
              onClick={toggleCollapse}
              className="min-w-11 min-h-11 rounded-md hover:bg-surface-2 dark:hover:bg-surface-2 text-ink-soft hover:text-accent-text dark:hover:text-accent-strong flex items-center justify-center transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none"
              title={t('nav.expand_menu', 'Perluas Menu')}
              aria-label={t('nav.expand_menu', 'Perluas Menu')}
            >
              <PanelLeftOpen className="w-5 h-5" />
            </button>
          ) : (
            <>
              <div className="flex-1 min-w-0">
                <WorkspaceSwitcher
                  isCollapsed={false}
                  onNavigateToSettings={() => setActiveTab('settings')}
                />
              </div>

              <button
                type="button"
                onClick={toggleCollapse}
                className="min-w-11 min-h-11 flex items-center justify-center p-2 hover:bg-surface-2 dark:hover:bg-surface-2 rounded-md text-ink-soft hover:text-ink dark:hover:text-white transition-colors cursor-pointer shrink-0 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none"
                title={t('nav.collapse_menu', 'Kecilkan Menu')}
                aria-label={t('nav.collapse_menu', 'Kecilkan Menu')}
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </>
          )}
        </div>

        {/* Desktop Navigation Scroll Container */}
        <div className="flex-1 p-3 overflow-y-auto">
          {renderNavList(false)}
        </div>

        {/* Footer: System Status Indicators & Version */}
        <div className="p-3 border-t border-hairline/80 text-xs text-ink-soft select-none">
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-1.5 py-1">
              <div
                title={driveTooltip}
                className={`w-2.5 h-2.5 rounded-full ring-2 ${driveDotClass} transition-colors`}
              />
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  title={driveTooltip}
                  className={`w-2.5 h-2.5 rounded-full ring-2 ${driveDotClass} transition-colors cursor-help`}
                />
              </div>

              <span className="text-xs font-medium text-ink-soft">
                {t('nav.version', 'v2.5.0 • ACL')}
              </span>
            </div>
          )}
        </div>
      </aside>

      <Dialog.Root open={isMobileOpen} onOpenChange={(open) => { if (!open) onCloseMobile?.(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-ink/50 backdrop-blur-xs z-40 md:hidden animate-in" />
          <Dialog.Content
            onOpenAutoFocus={() => { returnFocusRef.current = document.activeElement as HTMLElement; }}
            onCloseAutoFocus={(event) => { event.preventDefault(); returnFocusRef.current?.focus(); }}
            aria-describedby={undefined}
            className="mobile-drawer fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-surface z-50 flex flex-col shadow-2xl border-r border-hairline md:hidden"
          >
            <Dialog.Title className="ds-modal-title flex items-center gap-2">{t('nav.menu_navigasi_mobile', 'Menu Navigasi Mobile')}</Dialog.Title>
        {/* Mobile Header: Workspace Switcher + Close Button */}
        <div className="h-16 px-3 flex items-center justify-between gap-2 border-b border-hairline/80 shrink-0">
          <div className="flex-1 min-w-0">
            <WorkspaceSwitcher
              isCollapsed={false}
              onNavigateToSettings={() => {
                setActiveTab('settings');
                onCloseMobile?.();
              }}
            />
          </div>

          <button
            type="button"
            onClick={onCloseMobile}
            className="min-w-11 min-h-11 rounded-md text-ink-soft hover:text-ink dark:hover:text-white hover:bg-surface-2 dark:hover:bg-surface-2 flex items-center justify-center transition-colors cursor-pointer shrink-0 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none"
            aria-label={t('nav.tutup_menu', 'Tutup Menu')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mobile Nav Menu List */}
        <div className="flex-1 p-3 overflow-y-auto">
          {renderNavList(true)}
        </div>

        {/* Mobile Drawer Footer */}
        <div className="p-3 border-t border-hairline/80 flex items-center justify-between text-xs text-ink-soft">
          <div className="flex items-center gap-2">
            <div
              title={driveTooltip}
              className={`w-2.5 h-2.5 rounded-full ring-2 ${driveDotClass}`}
            />
          </div>

          <span className="text-xs font-medium">
            {t('nav.version', 'v2.5.0 • ACL')}
          </span>
        </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
};
