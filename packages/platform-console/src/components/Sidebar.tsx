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
  ShieldAlert,
  Radio,
} from 'lucide-react';
import { AiIcon } from './icons/AiIcon';
import { useLanguage } from '../context/LanguageContext';
import { GoogleSheetsConfig } from '@legalio/types';
import { isGoogleTokenValid, getGoogleTokenRemainingMinutes } from '../lib/googleAuthService';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { usePermissions } from '../lib/permissions';
import { useTenantSettings } from '../context/TenantSettingsContext';
import { matchesWorkspaceSearch, type WorkspaceSearchResult } from '../lib/workspaceSearch';
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

import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { CommandPalette, CommandPaletteCombobox, CommandPaletteEmpty, CommandPaletteItem, CommandPaletteItemDescription, CommandPaletteItemGroup, CommandPaletteItemGroupLabel, CommandPaletteItemIcon, CommandPaletteItemLabel, CommandPaletteItemText, CommandPaletteList, CommandPalettePanel, CommandPaletteSearch } from '@legalio/ui-components/command-palette';
import { useListCollection } from '@legalio/ui-components/combobox';
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
const SIZE_KEY = 'sidebar_size_v2'; // v2: STANDARD.md widths; older saved sizes are ignored

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
  const systemLeaf = (id: string, label: string, icon: Icon): NavLeaf => ({ id: `admin-system-${id}`, label, icon, active: activeTab === `admin-system-${id}` });
  const systemGroup = (id: string, label: string, icon: Icon, children: NavLeaf[]): NavEntry => ({ id, label, icon, children, active: children.some(child => child.active) });
  const systemItems: NavEntry[] = [
    systemLeaf('dashboard', t('admin.tab_dashboard', 'Dashboard'), LayoutDashboard),
    systemGroup('system-tenant', t('sys.nav_tenant', 'Tenant'), Users, [
      systemLeaf('users', t('admin.tab_users', 'Users'), Users),
      systemLeaf('sessions', t('admin.tab_sessions', 'Sessions'), Radio),
      systemLeaf('organizations', t('admin.tab_organizations', 'Organizations'), Building2),
    ]),
    systemGroup('system-google', t('sys.nav_google', 'Google'), Globe2, [
      systemLeaf('google', t('settings.google_auth_title', 'Google Workspace Account Authentication'), Globe2),
      systemLeaf('google-drive', t('settings.penyimpanan_file_dokumen_google_drive', 'Document File Storage (Google Drive)'), FileText),
      systemLeaf('google-credentials', t('google_setup.settings_title', 'Google Cloud Credentials'), Settings),
    ]),
    systemGroup('system-database', t('sys.nav_database', 'Database'), Database, [
      systemLeaf('database', t('sqlite.sqlite_database', 'SQLite Database'), Database),
      systemLeaf('backups', t('backup.title', 'Backup & Restore'), Database),
    ]),
    systemLeaf('ai', t('sys.nav_ai', 'AI Model'), AiIcon),
    systemLeaf('smtp', t('tb.config_smtp', 'SMTP relay'), Mail),
    systemLeaf('ui-texts', t('tb.config_texts_short', 'UI texts'), Languages),
    systemLeaf('reset', t('sys.nav_reset', 'System reset'), ShieldAlert),
  ];
  if (showSystemAdmin && hasPlatformPermission('platform.access')) {
    return [{ id: 'admin', title: t('nav.system_admin', 'System Admin'), items: systemItems }];
  }

  const main: NavEntry[] = [
    can('document.view') && { id: 'dashboard', label: t('nav.dashboard', 'Dashboard'), icon: LayoutDashboard, active: activeTab === 'dashboard' },
    can('document.view') && { id: 'hierarchy', label: t('nav.hierarchy', 'Explore'), icon: GitFork, active: activeTab === 'hierarchy' },
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
    can('tenant.data.import') && { id: 'bulk-import', label: t('nav.bulk_import', 'Import Data'), icon: Upload, active: activeTab === 'bulk-import' },
    (hasPermission('tenant.settings.read') || hasPermission('tenant.member.read')) && { id: 'settings', label: t('nav.settings', 'Pengaturan'), icon: Settings, active: activeTab.startsWith('settings') },
  ].filter(Boolean) as NavEntry[];

  return [
    { id: 'main', title: t('nav.main_title', 'Menu Utama'), items: main },
    { id: 'documents', title: t('nav.doc_title', 'Dokumen'), items: documents },
    { id: 'admin', title: t('nav.admin_title', 'Administrasi'), items: admin },
  ].filter(section => section.items.length > 0);
}

/**
 * A navigation entry with children: activating it from another section opens its first page and
 * expands the submenu; inside the section it only toggles the submenu.
 */
function NavigationGroupItem({ item, onNavigate, withTooltip }: {
  item: NavEntry;
  onNavigate: (tab: string) => void;
  withTooltip: (item: NavEntry, node: React.ReactElement) => React.ReactNode;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(item.active);
  useEffect(() => { if (item.active) setOpen(true); }, [item.active]);
  return (
    <Collapsible open={open} onOpenChange={details => setOpen(item.active ? details.open : true)}>
      {withTooltip(item, (
        <CollapsibleTrigger asChild>
          <SidebarNavigationButton active={item.active} aria-label={item.label} onClick={() => { if (!item.active) onNavigate(item.target || item.children![0].id); }}>
            <item.icon aria-hidden />
            <SidebarLabel>{item.label}</SidebarLabel>
            <CollapsibleIndicator aria-label={t('nav.buka_submenu', 'Buka Submenu')} />
          </SidebarNavigationButton>
        </CollapsibleTrigger>
      ))}
      <CollapsibleContent>
        <SidebarNavigationSubList>
          {item.children!.map(child => (
            <SidebarNavigationSubItem key={child.id}>
              {/* moduix renders an <a>; without an href it is not focusable, so use a real button. */}
              <Tooltip><TooltipTrigger asChild>
                <SidebarNavigationSubButton asChild active={child.active} aria-current={child.active ? 'page' : undefined}>
                  <button type="button" onClick={() => onNavigate(child.id)}><span className="truncate">{child.label}</span></button>
                </SidebarNavigationSubButton>
              </TooltipTrigger><TooltipBody>{child.label}</TooltipBody></Tooltip>
            </SidebarNavigationSubItem>
          ))}
        </SidebarNavigationSubList>
      </CollapsibleContent>
    </Collapsible>
  );
}

function NavigationGroups({ sections, onNavigate, rail }: { sections: NavSection[]; onNavigate: (tab: string) => void; rail: boolean }) {
  const leaf = (item: NavEntry) => (
    <SidebarNavigationButton active={item.active} onClick={() => onNavigate(item.target || item.id)}>
      <item.icon aria-hidden />
      <SidebarLabel>{item.label}</SidebarLabel>
    </SidebarNavigationButton>
  );
  const withTooltip = (item: NavEntry, node: React.ReactElement) => rail ? <SidebarTooltip content={item.label}>{node}</SidebarTooltip> : node;
  const group = (item: NavEntry) => <NavigationGroupItem item={item} onNavigate={onNavigate} withTooltip={withTooltip} />;
  return (
    <>
      {sections.map((section, index) => (
        <SidebarGroup key={section.id} aria-label={section.title} className={index === 0 ? 'pt-g34' : undefined}>
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
                      <Menu ids={{ trigger: `rail-${item.id}-trigger` }} positioning={{ placement: 'right-start', gutter: 8 }} onSelect={details => onNavigate(details.value)}>
                        <Tooltip ids={{ trigger: `rail-${item.id}-trigger` }}><TooltipTrigger asChild><MenuTrigger asChild>
                          <SidebarNavigationButton active={item.active} aria-label={item.label}>
                            <item.icon aria-hidden />
                          </SidebarNavigationButton>
                        </MenuTrigger></TooltipTrigger><TooltipBody>{item.label}</TooltipBody></Tooltip>
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
    <div className="flex items-center justify-between gap-g8 px-g8 text-xs text-muted-foreground">
      <Tooltip><TooltipTrigger asChild><span data-sidebar-icon role="img" aria-label={tooltip} className={`size-g8 shrink-0 rounded-full ${tone}`} /></TooltipTrigger><TooltipBody>{tooltip}</TooltipBody></Tooltip>
      <SidebarLabel>{new Date().getFullYear()} ACL</SidebarLabel>
    </div>
  );
}

interface PaletteItem {
  id: string;
  label: string;
  section: string;
  icon: Icon;
  target: string;
  description?: string;
  keywords?: string;
  record?: WorkspaceSearchResult;
}
const EMPTY_SEARCH_RESULTS: WorkspaceSearchResult[] = [];

/** Search available navigation and the current workspace's visible records. */
function NavigationCommandPalette({ sections, onNavigate, searchResults = EMPTY_SEARCH_RESULTS, searchLoading, onSelectSearchResult }: {
  sections: NavSection[];
  onNavigate: (tab: string) => void;
  searchResults?: WorkspaceSearchResult[];
  searchLoading?: boolean;
  onSelectSearchResult?: (result: WorkspaceSearchResult) => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const menus = React.useMemo<PaletteItem[]>(() => sections.flatMap(section => section.items.flatMap(item => (
    item.children?.length
      ? item.children.map(child => ({ id: child.id, target: child.id, label: child.label, section: section.title, icon: child.icon }))
      : [{ id: item.target || item.id, target: item.target || item.id, label: item.label, section: section.title, icon: item.icon }]
  ))), [sections]);
  const items = React.useMemo<PaletteItem[]>(() => {
    const destinations = new Map(menus.map(item => [item.target, item]));
    const records = query.trim() && onSelectSearchResult ? searchResults.flatMap(record => {
      const destination = destinations.get(record.tab);
      return destination ? [{
        id: `record:${record.kind}:${record.recordId}`, target: record.tab, label: record.label,
        section: destination.label, icon: destination.icon, description: record.description, keywords: record.keywords, record,
      }] : [];
    }) : [];
    return [...menus, ...records].filter(item => matchesWorkspaceSearch(`${item.label} ${item.section} ${item.description || ''} ${item.keywords || ''}`, query));
  }, [menus, searchResults, onSelectSearchResult, query]);
  const { collection, set } = useListCollection<PaletteItem>({
    initialItems: items, itemToString: item => item.label, itemToValue: item => item.id, groupBy: item => item.section,
  });
  useEffect(() => { set(items); }, [items, set]);
  return (
    <CommandPalettePanel>
      <CommandPaletteCombobox collection={collection} inputValue={query} onInputValueChange={details => setQuery(details.inputValue)}
        onSelect={details => {
          const item = items.find(candidate => candidate.id === details.itemValue);
          if (item?.record) onSelectSearchResult?.(item.record);
          else if (item) onNavigate(item.target);
          setQuery('');
        }}>
        <CommandPaletteSearch placeholder={onSelectSearchResult ? t('nav.workspace_search_placeholder', 'Search menu, vendor, or document...') : t('nav.search_placeholder', 'Cari menu...')} />
        <CommandPaletteList>
          <CommandPaletteEmpty>{query.trim() && searchLoading
            ? t('nav.search_loading', 'Loading documents...')
            : onSelectSearchResult ? t('nav.workspace_search_empty', 'No matching menu or documents.') : t('nav.search_empty', 'Menu tidak ditemukan.')}</CommandPaletteEmpty>
          {collection.group().map(([section, group]) => (
            <CommandPaletteItemGroup key={section}>
              <CommandPaletteItemGroupLabel>{section}</CommandPaletteItemGroupLabel>
              {group.map(item => {
                const Icon = item.icon;
                return (
                  <CommandPaletteItem key={item.id} item={item}>
                    <CommandPaletteItemIcon><Icon aria-hidden /></CommandPaletteItemIcon>
                    <CommandPaletteItemText>
                      <CommandPaletteItemLabel>{item.label}</CommandPaletteItemLabel>
                      {item.description && <CommandPaletteItemDescription>{item.description}</CommandPaletteItemDescription>}
                    </CommandPaletteItemText>
                  </CommandPaletteItem>
                );
              })}
            </CommandPaletteItemGroup>
          ))}
        </CommandPaletteList>
      </CommandPaletteCombobox>
    </CommandPalettePanel>
  );
}

/**
 * Application shell (moduix Sidebar dashboard block): a resizable, collapsible navigation panel beside
 * the content inset on desktop, and the same navigation in a moduix Drawer on small screens.
 */
export function AppShell({ navigation, header, children, className, searchResults, searchLoading, onSelectSearchResult }: {
  navigation: AppNavigationProps;
  header: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  searchResults?: WorkspaceSearchResult[];
  searchLoading?: boolean;
  onSelectSearchResult?: (result: WorkspaceSearchResult) => void;
}) {
  const { t } = useLanguage();
  const desktop = useIsDesktop();
  const sections = useNavigation(navigation);
  const { setActiveTab, isMobileOpen = false, onCloseMobile, googleConfig } = navigation;
  const navigate = (tab: string) => { setActiveTab(tab); onCloseMobile?.(); };
  const switcher = (
    <WorkspaceSwitcher isCollapsed={false} onNavigateToSettings={() => navigate('settings')} />
  );

  // One tree for every breakpoint: swapping layouts at 768px would remount the page and drop its state.
  // Below md the panel (left empty) and its triggers are hidden and the navigation lives in a Drawer.
  // The CommandPalette root spans the shell so the header's search trigger and the palette share state.
  return (
    <CommandPalette aria-label={t('nav.search_label', 'Cari menu')} onOpenChange={details => { if (!details.open) return; }}>
      <Sidebar className={`h-screen w-full ${className ?? ''}`} defaultSize={savedSize()} onResizeEnd={details => localStorage.setItem(SIZE_KEY, JSON.stringify(details.size))}>
        <SidebarPanel role="navigation" aria-label={t('nav.main_title', 'Menu Utama')} className="hidden bg-muted md:flex">
          {desktop && <>
            <SidebarHeader className="h-g42 border-b border-border py-0">{switcher}</SidebarHeader>
            <SidebarContent>
              <NavigationGroups sections={sections} onNavigate={navigate} rail />
            </SidebarContent>
            <SidebarFooter><StatusFooter googleConfig={googleConfig} /></SidebarFooter>
          </>}
        </SidebarPanel>
        <SidebarResizeTrigger aria-label={t('nav.resize_menu', 'Ubah lebar menu')} className="hidden md:flex" />
        <SidebarTrigger aria-label={t('nav.collapse_menu', 'Kecilkan Menu')} className="hidden md:inline-flex" />
        <SidebarInset className="flex min-w-0 flex-col overflow-hidden">
          {header}
          {children}
        </SidebarInset>
      </Sidebar>
      {!desktop && (
        <Drawer swipeDirection="start" open={isMobileOpen} onOpenChange={details => { if (!details.open) onCloseMobile?.(); }}>
          <DrawerBackdrop />
          <DrawerPositioner>
            <DrawerContent className="w-g233 max-w-5/6">
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
      )}
      <NavigationCommandPalette sections={sections} onNavigate={navigate} searchResults={searchResults} searchLoading={searchLoading} onSelectSearchResult={onSelectSearchResult} />
    </CommandPalette>
  );
}
