import React, { useState } from 'react';
import { notificationMessage } from '../lib/notificationText';
import { getActiveFormattingLocale } from '@legalio/shared/currencyUtils';
import { useAuth } from '../context/AuthContext';
import { AccountProfileDialog } from './account/AccountDialogs';
import { LANGUAGE_OPTIONS, useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { useNavigation } from '../context/NavigationContext';
import { useTenant } from '../context/TenantContext';
import { NotificationLog } from '@legalio/types';
import { Bell, ChevronDown, Search, LogOut, Menu as MenuIcon, Moon, Sun, UserRound } from 'lucide-react';
import { Button } from '@legalio/ui-components/button';
import { Badge } from '@legalio/ui-components/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@legalio/ui-components/avatar';
import { Breadcrumbs, BreadcrumbsItem, BreadcrumbsList, BreadcrumbsPage, BreadcrumbsSeparator } from '@legalio/ui-components/breadcrumbs';
import {
  Menu, MenuContent, MenuItem, MenuItemGroup, MenuItemGroupLabel, MenuItemIndicator, MenuItemText, MenuItemTextContent, MenuItemTextIcon, MenuItemTextLabel,
  MenuPositioner, MenuRadioItem, MenuRadioItemGroup, MenuSeparator, MenuTrigger, MenuViewport,
} from '@legalio/ui-components/menu';
import { Popover, PopoverBody, PopoverContent, PopoverFooter, PopoverHeader, PopoverPositioner, PopoverTitle, PopoverTrigger } from '@legalio/ui-components/popover';
import { Empty, EmptyContent, EmptyDescription } from '@legalio/ui-components/empty';
import { Text } from '@legalio/ui-components/text';
import { CommandPaletteTrigger } from '@legalio/ui-components/command-palette';

import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
interface HeaderProps {
  notifications: NotificationLog[];
  onRefreshData: () => void | Promise<void>;
  onNavigateToTab: (tab: string) => void;
  onOpenMobileMenu?: () => void;
}

/** Application header (moduix App header block): breadcrumbs, preferences, notifications and account menu. */
export const Header: React.FC<HeaderProps> = ({ notifications, onNavigateToTab, onOpenMobileMenu }) => {
  const { user, identity, logout } = useAuth();
  const [accountDialog, setAccountDialog] = useState<null | 'security'>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { language, setLanguage, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { activeTab } = useNavigation();
  const { activeTenant, branding, loading: tenantLoading } = useTenant();

  const tabLabel = (() => {
    switch (activeTab) {
      case 'admin-system-dashboard': return t('admin.tab_dashboard', 'Dashboard');
      case 'admin-system-users': return t('admin.tab_users', 'Users');
      case 'admin-system-sessions': return t('admin.tab_sessions', 'Sessions');
      case 'admin-system-organizations': return t('admin.tab_organizations', 'Organizations');
      case 'admin-system-storage': return t('storage.title', 'Storage');
      case 'admin-system-ai': return t('sys.nav_ai', 'AI Model');
      case 'admin-system-mailer': return t('mailer.nav', 'Mailer');
      case 'admin-system-smtp': return t('tb.config_smtp', 'SMTP relay');
      case 'admin-system-ui-texts': return t('tb.config_texts_short', 'UI texts');
      case 'admin-system-pgreport': return t('pgr.nav', 'PgReport');
      case 'admin-system-reset': return t('sys.nav_reset', 'System reset');
      case 'hierarchy': return t('nav.hierarchy', 'Explore');
      case 'partners': case 'partners-list': return t('nav.partners', 'Mitra Kerja');
      case 'partner-evaluation': return t('nav.partner_eval', 'Evaluasi Mitra');
      case 'partner-spending': return t('nav.partner_spending', 'Pengeluaran Mitra');
      case 'contracts': return t('nav.contracts', 'Kontrak');
      case 'create-contract': return t('nav.create_contract', 'Dokumen Saya');
      case 'document-approval': return t('nav.document_approval', 'My Approval');
      case 'obligations': return t('nav.obligations', 'Obligations');
      case 'ios': return t('nav.ios', 'Insertion Order (IO)');
      case 'notifikasi': return t('nav.notifications', 'Notifikasi & Log');
      case 'bulk-import': return t('nav.bulk_import', 'Import Data');
      case 'settings-organization': case 'settings-access': case 'settings-data': return t('nav.settings', 'Pengaturan Sistem');
      default: return activeTab.startsWith('admin-system-') ? t('nav.system_admin', 'System Admin') : t('nav.dashboard', 'Dashboard');
    }
  })();
  const organization = activeTenant?.brandName || activeTenant?.name || (tenantLoading ? t('common.loading', 'Memuat Data...') : branding.appName);
  const unreadCount = notifications.filter(n => !n.is_read).length;
  const themeLabel = theme === 'dark' ? t('header.beralih_ke_mode_terang', 'Beralih ke Mode Terang') : t('header.beralih_ke_mode_gelap', 'Beralih ke Mode Gelap');
  const openNotifications = () => { setNotificationsOpen(false); onNavigateToTab('notifikasi'); };

  return (
    <header className="sticky top-0 z-20 flex h-g42 shrink-0 items-center justify-between gap-g13 border-b border-border bg-muted px-g13 md:px-g34">
      <div className="flex min-w-0 flex-1 items-center gap-g8">
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" onClick={onOpenMobileMenu} className="md:hidden" aria-label={t('header.buka_menu_navigasi', 'Buka Menu Navigasi')}>
          <MenuIcon aria-hidden="true" />
        </Button></TooltipTrigger><TooltipBody>{t('header.buka_navigasi', 'Buka Navigasi')}</TooltipBody></Tooltip>
        <Breadcrumbs className="min-w-0 flex-1">
          <BreadcrumbsList>
            <BreadcrumbsItem className="hidden sm:inline-flex">{organization}</BreadcrumbsItem>
            <BreadcrumbsSeparator className="hidden sm:inline-flex" />
            <BreadcrumbsItem>
              <BreadcrumbsPage asChild><h1 className="truncate">{tabLabel}</h1></BreadcrumbsPage>
            </BreadcrumbsItem>
          </BreadcrumbsList>
        </Breadcrumbs>
      </div>

      <div className="flex shrink-0 items-center gap-g3 sm:gap-g8">
        <Tooltip ids={{ trigger: 'header-search-trigger' }}><TooltipTrigger asChild><CommandPaletteTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t('nav.search_label', 'Cari menu')}><Search aria-hidden="true" /></Button>
        </CommandPaletteTrigger></TooltipTrigger><TooltipBody>{t('nav.search_label', 'Cari menu')}</TooltipBody></Tooltip>

        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" onClick={toggleTheme} aria-label={themeLabel}>
          {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </Button></TooltipTrigger><TooltipBody>{themeLabel}</TooltipBody></Tooltip>

        <Menu ids={{ trigger: 'header-language-trigger' }} positioning={{ placement: 'bottom-end', gutter: 8 }}>
          <Tooltip ids={{ trigger: 'header-language-trigger' }}><TooltipTrigger asChild><MenuTrigger asChild>
            {/* The accessible name starts with the visible text (WCAG 2.5.3 label in name). */}
            <Button variant="ghost" size="icon-sm" aria-label={`${language}: ${t('header.switch_language', 'Pilih bahasa')}`}>
              {language}
            </Button>
          </MenuTrigger></TooltipTrigger><TooltipBody>{t('header.switch_language', 'Pilih bahasa')}</TooltipBody></Tooltip>
          <MenuPositioner>
            <MenuContent>
              <MenuViewport>
                <MenuItemGroup>
                  <MenuItemGroupLabel>{t('header.switch_language', 'Pilih bahasa')}</MenuItemGroupLabel>
                  <MenuRadioItemGroup value={language} onValueChange={details => setLanguage(details.value as typeof language)}>
                    {LANGUAGE_OPTIONS.map(option => (
                      <MenuRadioItem key={option.code} value={option.code} lang={option.htmlLang}>
                        <MenuItemIndicator />
                        <MenuItemText>{option.nativeName}</MenuItemText>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioItemGroup>
                </MenuItemGroup>
              </MenuViewport>
            </MenuContent>
          </MenuPositioner>
        </Menu>

        <Popover ids={{ trigger: 'header-notifications-trigger' }} open={notificationsOpen} onOpenChange={details => setNotificationsOpen(details.open)} positioning={{ placement: 'bottom-end', gutter: 8 }}>
          <Tooltip ids={{ trigger: 'header-notifications-trigger' }}><TooltipTrigger asChild><PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="relative"
              aria-label={t('header.notifikasi_belum_dibaca', 'Notifikasi: {unreadCount} belum dibaca', { unreadCount })}>
              <Bell aria-hidden="true" />
              {unreadCount > 0 && <Badge tone="danger" className="absolute -end-g5 -top-g5" aria-hidden="true">{unreadCount > 9 ? '9+' : unreadCount}</Badge>}
            </Button>
          </PopoverTrigger></TooltipTrigger><TooltipBody>{t('header.notifikasi', 'Notifikasi')}</TooltipBody></Tooltip>
          <PopoverPositioner>
            <PopoverContent className="w-full max-w-g377 p-0">
              <PopoverHeader className="flex items-center justify-between gap-g8 border-b border-border px-g13 py-g13">
                <PopoverTitle>{t('header.notice_notifications', 'Notifikasi')}</PopoverTitle>
                {unreadCount > 0
                  ? <Badge tone="info">{t('header.baru', '{unreadCount} baru', { unreadCount })}</Badge>
                  : <Text size="xs" tone="muted">{t('header.semua_sudah_dibaca', 'Semua sudah dibaca')}</Text>}
              </PopoverHeader>
              <PopoverBody className="max-h-g377 overflow-y-auto p-g3">
                {notifications.length === 0 ? (
                  <Empty>
                    <EmptyContent><EmptyDescription>{t('header.no_notifications', 'Tidak ada notifikasi saat ini.')}</EmptyDescription></EmptyContent>
                  </Empty>
                ) : notifications.slice(0, 8).map(notif => (
                  <Button key={notif.notif_id} variant="ghost" onClick={openNotifications} className="h-auto w-full flex-col items-stretch gap-g3 whitespace-normal py-g13 text-start">
                    <span className="flex items-center justify-between gap-g8">
                      <Badge tone="danger">{notif.notification_type}</Badge>
                      <Text as="span" size="xs" tone="muted">
                        {new Date(notif.sent_at).toLocaleDateString(getActiveFormattingLocale(), { day: 'numeric', month: 'short' })}
                      </Text>
                    </span>
                    <Text as="span" size="sm" weight="semibold" lineClamp={1}>{notif.parent_number ? `${notif.parent_number} : ` : ''}{notif.parent_title}</Text>
                    <Text as="span" size="xs" tone="muted" lineClamp={2}>{notificationMessage(notif, t)}</Text>
                  </Button>
                ))}
              </PopoverBody>
              <PopoverFooter className="border-t border-border p-g8">
                <Button size="sm" className="w-full" onClick={openNotifications}>{t('dashboard.view_all', 'Lihat Semua Notifikasi')}</Button>
              </PopoverFooter>
            </PopoverContent>
          </PopoverPositioner>
        </Popover>

        <Menu ids={{ trigger: 'header-user-trigger' }} positioning={{ placement: 'bottom-end', gutter: 8 }} onSelect={details => {
          if (details.value === 'security') setAccountDialog('security');
          if (details.value === 'sign-out') void logout();
        }}>
          <Tooltip ids={{ trigger: 'header-user-trigger' }}><TooltipTrigger asChild><MenuTrigger asChild>
            {/* No aria-label: the name is the visible text (WCAG 2.5.3), kept for screen readers below the breakpoint where it is visually hidden. */}
            <Button variant="ghost" size="sm" className="gap-g8">
              <Avatar size="sm" aria-hidden="true">
                {identity?.image && <AvatarImage src={identity.image} alt="" />}
                <AvatarFallback>{user?.name ? user.name.charAt(0).toUpperCase() : <UserRound aria-hidden="true" />}</AvatarFallback>
              </Avatar>
              <span className="sr-only min-w-0 flex-col items-start text-start lg:not-sr-only lg:flex">
                <Text as="strong" size="sm" truncate>{user?.name || t('admin.generic_user', 'Pengguna')}</Text>
              </span>
              <ChevronDown className="hidden sm:block" aria-hidden="true" />
            </Button>
          </MenuTrigger></TooltipTrigger><TooltipBody>{user?.name || t('header.profil_pengguna', 'Profil Pengguna')}</TooltipBody></Tooltip>
          <MenuPositioner>
            <MenuContent className="w-g233">
              <MenuViewport>
                <MenuItemGroup>
                  <MenuItemGroupLabel className="flex flex-col gap-g2 px-g13">
                    <Text as="span" size="sm" weight="semibold" truncate className="text-foreground">{user?.name || t('admin.generic_user', 'Pengguna')}</Text>
                    <Text as="span" size="xs" tone="muted" truncate>{user?.email}</Text>
                  </MenuItemGroupLabel>
                  <MenuItem value="security">
                    <MenuItemText><MenuItemTextContent><MenuItemTextIcon><UserRound /></MenuItemTextIcon><MenuItemTextLabel>{t('tb.account_profile', 'Account Profile')}</MenuItemTextLabel></MenuItemTextContent></MenuItemText>
                  </MenuItem>
                </MenuItemGroup>
                <MenuSeparator />
                <MenuItem value="sign-out" tone="destructive">
                  <MenuItemText><MenuItemTextContent><MenuItemTextIcon><LogOut /></MenuItemTextIcon><MenuItemTextLabel>{t('header.keluar_sign_out', 'Keluar (Sign Out)')}</MenuItemTextLabel></MenuItemTextContent></MenuItemText>
                </MenuItem>
              </MenuViewport>
            </MenuContent>
          </MenuPositioner>
        </Menu>
      </div>
      {accountDialog === 'security' && <AccountProfileDialog onClose={() => setAccountDialog(null)} />}
    </header>
  );
};
