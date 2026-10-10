import React, { useEffect, useState } from 'react';
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
  Settings,
  Upload,
  Sliders,
  Mail,
  Database,
  Languages,
} from 'lucide-react';
import { AiIcon } from './icons/AiIcon';
import { useLanguage } from '../context/LanguageContext';
import { GoogleSheetsConfig } from '@legalio/types';
import { isGoogleTokenValid, getGoogleTokenRemainingMinutes } from '../lib/googleAuthService';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { usePermissions } from '../lib/permissions';
import { useTenantSettings } from '../context/TenantSettingsContext';
import {
  Sidebar,
  SidebarCollapsedContent,
  SidebarContent,
  SidebarExpandedContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarLabel,
  SidebarNavigationBadge,
  SidebarNavigationButton,
  SidebarNavigationItem,
  SidebarNavigationList,
  SidebarNavigationSubButton,
  SidebarNavigationSubItem,
  SidebarNavigationSubList,
  SidebarPanel,
  SidebarResizeTrigger,
  SidebarTooltip,
  SidebarTrigger,
} from '@legalio/ui-components/sidebar';
import { Collapsible, CollapsibleContent, CollapsibleIndicator, CollapsibleTrigger } from '@legalio/ui-components/collapsible';
import { Menu, MenuContent, MenuItem, MenuPositioner, MenuTrigger, MenuViewport } from '@legalio/ui-components/menu';
import { Drawer, DrawerBackdrop, DrawerBody, DrawerCloseIcon, DrawerContent, DrawerFooter, DrawerHeader, DrawerPositioner, DrawerTitle } from '@legalio/ui-components/drawer';

export interface AppNavigationProps {
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

type Icon = React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
interface NavLeaf { id: string; label: string; icon: Icon; active: boolean }
interface NavEntry extends NavLeaf { badge?: number; children?: NavLeaf[]; target?: string }
interface NavSection { id: string; title: string; items: NavEntry[] }

const DESKTOP_QUERY = '(min-width: 768px)';
const SIZE_KEY = 'sidebar_size';

function useIsDesktop() {
  const [desktop, setDesktop] = useState(() => typeof window === 'undefined' || window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const update = () => setDesktop(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return desktop;
}

function savedSize(): number[] | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(SIZE_KEY) || 'null');
    return Array.isArray(value) && value.every(n => typeof n === 'number') ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Navigation model shared by the desktop sidebar and the mobile drawer. */
function useNavigation({ showSystemAdmin = false, activeTab, unresolvedNotifsCount, expiringContractsCount }: AppNavigationProps): NavSection[] {
  const { hasPermission, hasPlatformPermission } = usePermissions();
  const { t } = useLanguage();
  const modules = useTenantSettings().policy.settings.modules;
  const can = (permission?: string) => !permission || hasPermission(permission);

  const partnerChildren: NavLeaf[] = [
    { id: 'partners', label: t('nav.partners_list', 'Daftar Mitra'), icon: Building2, active: activeTab === 'partners' },
    ...(modules.evaluation ? [{ id: 'partner-evaluation', label: t('nav.partner_eval', 'Evaluasi Kinerja'), icon: ClipboardCheck, active: activeTab === 'partner-evaluation' }] : []),
    ...(modules.spending ? [{ id: 'partner-spending', label: t('nav.partner_spending', 'Pengeluaran Mitra'), icon: CreditCard, active: activeTab === 'partner-spending' }] : []),
  ];
  const systemDashboardTabs = ['admin-system-dashboard', 'admin-system-users', 'admin-system-accounts', 'admin-system-sessions', 'admin-system-organizations', 'admin-system-apikeys'];
  const systemChildren: NavLeaf[] = [
    { id: 'admin-system-dashboard', label: t('admin.tab_dashboard', 'Dashboard'), icon: Sliders },
    { id: 'admin-system-google', label: t('tb.config_google', 'Google & storage'), icon: Globe2 },
    { id: 'admin-system-ai', label: t('settings.nav_ai', 'AI Model & Parser'), icon: AiIcon },
    { id: 'admin-system-smtp', label: t('tb.config_smtp', 'SMTP relay'), icon: Mail },
    { id: 'admin-system-ui-texts', label: t('tb.config_texts_short', 'UI texts'), icon: Languages },
    { id: 'admin-system-design-system', label: t('designSystem.title', 'Design System'), icon: Sliders },
    { id: 'admin-system-backups', label: t('backup.title', 'Backup & Restore'), icon: Database },
    { id: 'admin-system-database', label: t('tb.config_maintenance', 'Database & reset'), icon: Database },
  ].map(item => ({ ...item, active: item.id === 'admin-system-dashboard' ? systemDashboardTabs.includes(activeTab) : activeTab === item.id }));

  const main: NavEntry[] = [
    can('document.view') && { id: 'dashboard', label: t('nav.dashboard', 'Dashboard'), icon: LayoutDashboard, active: activeTab === 'dashboard' },
    can('document.view') && { id: 'hierarchy', label: t('nav.hierarchy', 'Struktur Dokumen'), icon: GitFork, active: activeTab === 'hierarchy' },
    can('document.view') && { id: 'partners', label: t('nav.partners', 'Mitra Kerja'), icon: Building2, active: partnerChildren.some(c => c.active), children: partnerChildren },
    can('document.view') && { id: 'contracts', label: t('nav.contracts', 'Kontrak'), icon: FileText, active: activeTab === 'contracts', badge: expiringContractsCount },
    can('document.view') && modules.commercialDocuments && { id: 'ios', label: t('nav.ios', '{docs}'), icon: FileSpreadsheet, active: activeTab === 'ios' },
    can('document.view') && { id: 'notifikasi', label: t('nav.notifications', 'Notifikasi'), icon: Bell, active: activeTab === 'notifikasi', badge: unresolvedNotifsCount },
  ].filter(Boolean) as NavEntry[];
  const documents: NavEntry[] = [
    can('document.create') && { id: 'create-contract', label: t('nav.create_contract', 'Dokumen Saya'), icon: FileSignature, active: activeTab === 'create-contract' },
  ].filter(Boolean) as NavEntry[];
  /* Administration (PRD §6.1): System Admin only in the standalone console for platform administrators,
     Import Data for tenant admins, and exactly one Settings entry for whoever may open one of its tabs. */
  const admin: NavEntry[] = [
    showSystemAdmin && hasPlatformPermission('platform.access') && { id: 'admin-system', label: t('nav.system_admin', 'System Admin'), icon: Users, active: activeTab.startsWith('admin-system-'), children: systemChildren, target: 'admin-system-dashboard' },
    can('tenant.data.import') && { id: 'bulk-import', label: t('nav.bulk_import', 'Import Data'), icon: Upload, active: activeTab === 'bulk-import' },
    (hasPermission('tenant.settings.read') || hasPermission('tenant.member.read')) && { id: 'settings', label: t('nav.settings', 'Pengaturan'), icon: Settings, active: activeTab.startsWith('settings') },
  ].filter(Boolean) as NavEntry[];

  return [
    { id: 'main', title: t('nav.main_title', 'Menu Utama'), items: main },
    { id: 'documents', title: t('nav.doc_title', 'Dokumen'), items: documents },
    { id: 'admin', title: t('nav.admin_title', 'Administrasi'), items: admin },
  ].filter(section => section.items.length > 0);
}

function NavigationGroups({ sections, onNavigate, rail }: { sections: NavSection[]; onNavigate: (tab: string) => void; rail: boolean }) {
  const { t } = useLanguage();
  const leaf = (item: NavEntry) => (
    <SidebarNavigationButton active={item.active} onClick={() => onNavigate(item.target || item.id)}>
      <item.icon aria-hidden />
      <SidebarLabel>{item.label}</SidebarLabel>
    </SidebarNavigationButton>
  );
  const withTooltip = (item: NavEntry, node: React.ReactElement) => rail ? <SidebarTooltip content={item.label}>{node}</SidebarTooltip> : node;
  const subList = (item: NavEntry) => (
    <SidebarNavigationSubList>
      {item.children!.map(child => (
        <SidebarNavigationSubItem key={child.id}>
          <SidebarNavigationSubButton active={child.active} aria-current={child.active ? 'page' : undefined} onClick={() => onNavigate(child.id)}>
            {child.label}
          </SidebarNavigationSubButton>
        </SidebarNavigationSubItem>
      ))}
    </SidebarNavigationSubList>
  );
  const group = (item: NavEntry) => (
    <Collapsible defaultOpen={item.active}>
      {withTooltip(item, (
        <CollapsibleTrigger asChild>
          <SidebarNavigationButton active={item.active} aria-label={item.label}>
            <item.icon aria-hidden />
            <SidebarLabel>{item.label}</SidebarLabel>
            <CollapsibleIndicator aria-label={t('nav.buka_submenu', 'Buka Submenu')} />
          </SidebarNavigationButton>
        </CollapsibleTrigger>
      ))}
      <CollapsibleContent>{subList(item)}</CollapsibleContent>
    </Collapsible>
  );
  return (
    <>
      {sections.map(section => (
        <SidebarGroup key={section.id} aria-label={section.title}>
          <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
          <SidebarNavigationList>
            {section.items.map(item => (
              <SidebarNavigationItem key={item.id}>
                {!item.children ? (
                  <>
                    {withTooltip(item, leaf(item))}
                    {!!item.badge && <SidebarNavigationBadge>{item.badge}</SidebarNavigationBadge>}
                  </>
                ) : rail ? (
                  <>
                    <SidebarExpandedContent>{group(item)}</SidebarExpandedContent>
                    <SidebarCollapsedContent>
                      <Menu positioning={{ placement: 'right-start', gutter: 8 }} onSelect={details => onNavigate(details.value)}>
                        <MenuTrigger asChild>
                          <SidebarNavigationButton active={item.active} aria-label={item.label} title={item.label}>
                            <item.icon aria-hidden />
                          </SidebarNavigationButton>
                        </MenuTrigger>
                        <MenuPositioner>
                          <MenuContent>
                            <MenuViewport>
                              {item.children.map(child => <MenuItem key={child.id} value={child.id}>{child.label}</MenuItem>)}
                            </MenuViewport>
                          </MenuContent>
                        </MenuPositioner>
                      </Menu>
                    </SidebarCollapsedContent>
                  </>
                ) : group(item)}
              </SidebarNavigationItem>
            ))}
          </SidebarNavigationList>
        </SidebarGroup>
      ))}
    </>
  );
}

function StatusFooter({ googleConfig }: { googleConfig?: GoogleSheetsConfig }) {
  const { t } = useLanguage();
  // Google OAuth Drive storage status.
  const hasToken = typeof window !== 'undefined' && Boolean(localStorage.getItem('google_access_token'));
  const minutes = getGoogleTokenRemainingMinutes();
  const [tone, tooltip] = !googleConfig?.isConnected
    ? ['bg-muted-foreground', 'Google Drive: Belum Dikonfigurasi (Unggahan file disimpan lokal)']
    : !hasToken || !isGoogleTokenValid() || minutes <= 0
    ? ['bg-status-danger', 'Google Drive: Sesi Google kadaluarsa atau belum terhubung']
    : minutes <= 10
    ? ['bg-status-warning', `Google Drive: Token akan kadaluarsa (Sisa ~${minutes} menit)`]
    : ['bg-status-success', `Google Drive: Terhubung & Siap (Sisa ~${minutes} menit)`];
  return (
    <div className="flex items-center justify-between gap-2 px-2 text-xs text-muted-foreground">
      <span data-sidebar-icon title={tooltip} role="img" aria-label={tooltip} className={`size-2.5 shrink-0 rounded-full ${tone}`} />
      <SidebarLabel>{t('nav.version', 'v2.5.0 • ACL')}</SidebarLabel>
    </div>
  );
}

/**
 * Application shell (moduix Sidebar dashboard block): a resizable, collapsible navigation panel beside
 * the content inset on desktop, and the same navigation in a moduix Drawer on small screens.
 */
export function AppShell({ navigation, header, children, className }: {
  navigation: AppNavigationProps;
  header: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const { t } = useLanguage();
  const desktop = useIsDesktop();
  const sections = useNavigation(navigation);
  const { setActiveTab, isMobileOpen = false, onCloseMobile, googleConfig } = navigation;
  const navigate = (tab: string) => { setActiveTab(tab); onCloseMobile?.(); };
  const switcher = (
    <WorkspaceSwitcher isCollapsed={false} onNavigateToSettings={() => navigate('settings')} />
  );

  if (desktop) {
    return (
      <Sidebar className={`h-screen w-full ${className ?? ''}`} defaultSize={savedSize()} onResizeEnd={details => localStorage.setItem(SIZE_KEY, JSON.stringify(details.size))}>
        <SidebarPanel aria-label={t('nav.main_title', 'Menu Utama')}>
          <SidebarHeader>{switcher}</SidebarHeader>
          <SidebarContent>
            <NavigationGroups sections={sections} onNavigate={navigate} rail />
          </SidebarContent>
          <SidebarFooter><StatusFooter googleConfig={googleConfig} /></SidebarFooter>
        </SidebarPanel>
        <SidebarResizeTrigger aria-label={t('nav.resize_menu', 'Ubah lebar menu')} />
        <SidebarTrigger aria-label={t('nav.collapse_menu', 'Kecilkan Menu')} />
        <SidebarInset className="flex min-w-0 flex-col overflow-hidden">
          {header}
          {children}
        </SidebarInset>
      </Sidebar>
    );
  }

  return (
    <div className={`flex h-screen w-full flex-col overflow-hidden ${className ?? ''}`}>
      {header}
      {children}
      <Drawer swipeDirection="start" open={isMobileOpen} onOpenChange={details => { if (!details.open) onCloseMobile?.(); }}>
        <DrawerBackdrop />
        <DrawerPositioner>
          <DrawerContent className="mobile-drawer w-72 max-w-[85vw]">
            <DrawerHeader>
              <DrawerTitle className="sr-only">{t('nav.menu_navigasi_mobile', 'Menu Navigasi Mobile')}</DrawerTitle>
              {switcher}
              <DrawerCloseIcon aria-label={t('nav.tutup_menu', 'Tutup Menu')} />
            </DrawerHeader>
            <DrawerBody>
              <nav aria-label={t('nav.main_title', 'Menu Utama')}>
                <NavigationGroups sections={sections} onNavigate={navigate} rail={false} />
              </nav>
            </DrawerBody>
            <DrawerFooter><StatusFooter googleConfig={googleConfig} /></DrawerFooter>
          </DrawerContent>
        </DrawerPositioner>
      </Drawer>
    </div>
  );
}
