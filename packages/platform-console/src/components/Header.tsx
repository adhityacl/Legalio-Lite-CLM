import React, { useState } from 'react';
import { notificationMessage } from '../lib/notificationText';
import { getActiveFormattingLocale } from '@legalio/shared/currencyUtils';
import { useAuth } from '../context/AuthContext';
import { AccountProfileDialog, PreferencesDialog } from './account/AccountDialogs';
import { LANGUAGE_OPTIONS, useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { useNavigation } from '../context/NavigationContext';
import { useTenant } from '../context/TenantContext';
import { NotificationLog, GoogleSheetsConfig } from '@legalio/types';
import { Bell, ChevronDown, LogOut, Menu as MenuIcon, Moon, Shield, SlidersHorizontal, Sun, UserRound } from 'lucide-react';
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

interface HeaderProps {
  notifications: NotificationLog[];
  googleConfig?: GoogleSheetsConfig;
  onRefreshData: () => void;
  onNavigateToTab: (tab: string) => void;
  onOpenMobileMenu?: () => void;
}

/** Application header (moduix App header block): breadcrumbs, preferences, notifications and account menu. */
export const Header: React.FC<HeaderProps> = ({ notifications, onNavigateToTab, onOpenMobileMenu }) => {
  const { user, identity, logout, isPlatformAdmin } = useAuth();
  const [accountDialog, setAccountDialog] = useState<null | 'preferences' | 'security'>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { language, setLanguage, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { activeTab } = useNavigation();
  const { activeTenant, branding, loading: tenantLoading } = useTenant();

  const tabLabel = (() => {
    switch (activeTab) {
      case 'hierarchy': return t('nav.hierarchy', 'Struktur Dokumen');
      case 'partners': case 'partners-list': return t('nav.partners', 'Mitra Kerja');
      case 'partner-evaluation': return t('nav.partner_eval', 'Evaluasi Mitra');
      case 'partner-spending': return t('nav.partner_spending', 'Pengeluaran Mitra');
      case 'contracts': return t('nav.contracts', 'Kontrak');
      case 'create-contract': return t('nav.create_contract', 'Dokumen Saya');
      case 'ios': return t('nav.ios', 'Insertion Order (IO)');
      case 'notifikasi': return t('nav.notifications', 'Notifikasi & Log');
      case 'bulk-import': return t('nav.bulk_import', 'Import Data');
      case 'settings-organization': case 'settings-access': case 'settings-integrations': return t('nav.settings', 'Pengaturan Sistem');
      default: return activeTab.startsWith('admin-system-') ? t('nav.system_admin', 'System Admin') : t('nav.dashboard', 'Dashboard');
    }
  })();
  const organization = activeTenant?.brandName || activeTenant?.name || (tenantLoading ? t('common.loading', 'Memuat Data...') : branding.appName);
  const unreadCount = notifications.filter(n => !n.is_read).length;
  const themeLabel = theme === 'dark' ? t('header.beralih_ke_mode_terang', 'Beralih ke Mode Terang') : t('header.beralih_ke_mode_gelap', 'Beralih ke Mode Gelap');
  const openNotifications = () => { setNotificationsOpen(false); onNavigateToTab('notifikasi'); };

  return (
    <header className="app-header sticky top-0 z-20 flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="icon-md" onClick={onOpenMobileMenu} className="md:hidden"
          title={t('header.buka_navigasi', 'Buka Navigasi')} aria-label={t('header.buka_menu_navigasi', 'Buka Menu Navigasi')}>
          <MenuIcon aria-hidden="true" />
        </Button>
        <Breadcrumbs>
          <BreadcrumbsList>
            <BreadcrumbsItem className="hidden sm:inline-flex">{organization}</BreadcrumbsItem>
            <BreadcrumbsSeparator className="hidden sm:inline-flex" />
            <BreadcrumbsItem>
              <BreadcrumbsPage asChild><h1 className="app-page-title truncate">{tabLabel}</h1></BreadcrumbsPage>
            </BreadcrumbsItem>
          </BreadcrumbsList>
        </Breadcrumbs>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <Button variant="ghost" size="icon-md" onClick={toggleTheme} title={themeLabel} aria-label={themeLabel}>
          {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </Button>

        <Menu positioning={{ placement: 'bottom-end', gutter: 8 }}>
          <MenuTrigger asChild>
            <Button variant="ghost" size="icon-md" title={t('header.switch_language', 'Pilih bahasa')} aria-label={t('header.switch_language', 'Pilih bahasa')}>
              {language}
            </Button>
          </MenuTrigger>
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

        <Popover open={notificationsOpen} onOpenChange={details => setNotificationsOpen(details.open)} positioning={{ placement: 'bottom-end', gutter: 8 }}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-md" className="relative" title={t('header.notifikasi', 'Notifikasi')}
              aria-label={t('header.notifikasi_belum_dibaca', 'Notifikasi: {unreadCount} belum dibaca', { unreadCount })}>
              <Bell aria-hidden="true" />
              {unreadCount > 0 && <span className="absolute end-2 top-2 size-2 rounded-full bg-destructive" aria-hidden="true" />}
            </Button>
          </PopoverTrigger>
          <PopoverPositioner>
            <PopoverContent className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
              <PopoverHeader className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <PopoverTitle>{t('header.notice_notifications', 'Notifikasi')}</PopoverTitle>
                {unreadCount > 0
                  ? <Badge tone="info">{t('header.baru', '{unreadCount} baru', { unreadCount })}</Badge>
                  : <Text size="xs" tone="muted">{t('header.semua_sudah_dibaca', 'Semua sudah dibaca')}</Text>}
              </PopoverHeader>
              <PopoverBody className="max-h-80 overflow-y-auto p-1">
                {notifications.length === 0 ? (
                  <Empty>
                    <EmptyContent><EmptyDescription>{t('header.no_notifications', 'Tidak ada notifikasi saat ini.')}</EmptyDescription></EmptyContent>
                  </Empty>
                ) : notifications.slice(0, 8).map(notif => (
                  <Button key={notif.notif_id} variant="ghost" onClick={openNotifications} className="h-auto w-full flex-col items-stretch gap-1 whitespace-normal py-3 text-start">
                    <span className="flex items-center justify-between gap-2">
                      <Badge tone="danger">{notif.jenis_notifikasi}</Badge>
                      <Text as="span" size="xs" tone="muted">
                        {new Date(notif.tanggal_terkirim).toLocaleDateString(getActiveFormattingLocale(), { day: 'numeric', month: 'short' })}
                      </Text>
                    </span>
                    <Text as="span" size="sm" weight="semibold" lineClamp={1}>{notif.parent_nomor ? `${notif.parent_nomor} : ` : ''}{notif.parent_judul}</Text>
                    <Text as="span" size="xs" tone="muted" lineClamp={2}>{notificationMessage(notif, t)}</Text>
                  </Button>
                ))}
              </PopoverBody>
              <PopoverFooter className="border-t border-border p-2">
                <Button size="sm" className="w-full" onClick={openNotifications}>{t('dashboard.view_all', 'Lihat Semua Notifikasi')}</Button>
              </PopoverFooter>
            </PopoverContent>
          </PopoverPositioner>
        </Popover>

        <Menu positioning={{ placement: 'bottom-end', gutter: 8 }} onSelect={details => {
          if (details.value === 'preferences' || details.value === 'security') setAccountDialog(details.value);
          if (details.value === 'sign-out') logout();
        }}>
          <MenuTrigger asChild>
            <Button variant="ghost" className="gap-2 px-1.5" title={user?.name || t('header.profil_pengguna', 'Profil Pengguna')} aria-label={t('header.menu_pengguna', 'Menu Pengguna')}>
              <Avatar size="sm">
                {identity?.image && <AvatarImage src={identity.image} alt="" />}
                <AvatarFallback>{user?.name ? user.name.charAt(0).toUpperCase() : <UserRound aria-hidden="true" />}</AvatarFallback>
              </Avatar>
              <ChevronDown className="hidden sm:block" aria-hidden="true" />
            </Button>
          </MenuTrigger>
          <MenuPositioner>
            <MenuContent className="w-60">
              <MenuViewport>
                <MenuItemGroup>
                  <MenuItemGroupLabel className="flex flex-col gap-0.5">
                    <Text as="span" size="sm" weight="semibold" truncate className="text-foreground">{user?.name || t('admin.generic_user', 'Pengguna')}</Text>
                    <Text as="span" size="xs" tone="muted" truncate>{user?.email}</Text>
                    {isPlatformAdmin && <Badge tone="info" className="mt-1 self-start"><Shield aria-hidden="true" />{t('tb.platform_administrator', 'Platform administrator')}</Badge>}
                  </MenuItemGroupLabel>
                  <MenuItem value="preferences">
                    <MenuItemText><MenuItemTextContent><MenuItemTextIcon><SlidersHorizontal /></MenuItemTextIcon><MenuItemTextLabel>{t('tb.preferences', 'Preferences')}</MenuItemTextLabel></MenuItemTextContent></MenuItemText>
                  </MenuItem>
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
      {accountDialog === 'preferences' && <PreferencesDialog onClose={() => setAccountDialog(null)} />}
      {accountDialog === 'security' && <AccountProfileDialog onClose={() => setAccountDialog(null)} />}
    </header>
  );
};
