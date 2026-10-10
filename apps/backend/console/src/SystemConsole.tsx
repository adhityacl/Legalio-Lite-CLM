import { lazy, Suspense, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@legalio/ui-components/button';
import { SYSTEM_TABS, type SystemSubmenu } from '@legalio/shared/systemConsole';
import { useIdentity } from '@legalio/platform-console/context/AuthContext';
import { useLanguage } from '@legalio/platform-console/context/LanguageContext';
import { Header } from '@legalio/platform-console/components/Header';
import { AppShell } from '@legalio/platform-console/components/Sidebar';
import { useNavigation } from '@legalio/platform-console/context/NavigationContext';
import { SystemLogin } from './SystemLogin';

import { Card } from '@legalio/ui-components/card';
const AdminConsole = lazy(() => import('@legalio/platform-console/components/AdminUsersView').then((m) => ({ default: m.AdminUsersView })));
export function SystemConsole() {
  const { identity, loading, logout } = useIdentity();
  const { t } = useLanguage();
  const { activeTab, setActiveTab, replaceActiveTab } = useNavigation();
  const [menuOpen, setMenuOpen] = useState(false);
  const validTab = SYSTEM_TABS.includes(activeTab);
  useEffect(() => { if (!validTab) replaceActiveTab('admin-system-dashboard'); }, [validTab, replaceActiveTab]);
  if (loading || !validTab) return <div className="flex h-full items-center justify-center" role="status"><Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />{t('sys.loading', 'Loading…')}</div>;
  if (!identity) return <SystemLogin />;
  if (identity.platformRole !== 'superuser' || !identity.platformPermissions.includes('platform.access')) return (
    <main className="flex h-full items-center justify-center bg-background p-6 text-foreground"><Card className="max-w-md space-y-4 p-6"><h1 className="text-xl font-semibold">{t('sys.access_denied', 'System Console access denied')}</h1><p>{t('sys.superuser_only', 'Sign in with a superuser account to access this console.')}</p><Button onClick={() => void logout()}>{t('sys.sign_out', 'Sign out')}</Button></Card></main>
  );
  return (
    <div className="h-screen w-full bg-background font-sans text-foreground">
      <a href="#sys-content" className="skip-link">{t('app.skip_to_content', 'Skip to content')}</a>
      <AppShell
        navigation={{ showSystemAdmin: true, activeTab, setActiveTab, unresolvedNotifsCount: 0, expiringContractsCount: 0, isMobileOpen: menuOpen, onCloseMobile: () => setMenuOpen(false) }}
        header={<Header notifications={[]} onRefreshData={() => {}} onNavigateToTab={setActiveTab} onOpenMobileMenu={() => setMenuOpen(true)} />}
      >
        <main data-table-design="standard" id="sys-content" tabIndex={-1} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-3.5 focus:outline-none sm:p-5 md:p-7">
          <Suspense fallback={<p role="status">{t('sys.loading', 'Loading…')}</p>}>
            {validTab && <AdminConsole initialTab={activeTab.slice('admin-system-'.length) as SystemSubmenu} onManageOrganization={async (org) => {
              // Open during the click so browser popup blockers allow the new tab.
              const workspace = window.open('about:blank', '_blank');
              if (!workspace) throw new Error(t('sys.popup_blocked', 'Allow pop-ups to open the organization in a new tab.'));
              workspace.opener = null;
              try {
                const res = await fetch(`/api/organizations/${encodeURIComponent(org.id)}/capabilities`, { cache: 'no-store' });
                if (!res.ok) throw new Error(t('sys.organization_denied', 'Organization access denied.'));
                workspace.sessionStorage.setItem(`activeOrganizationId:${identity.id}`, org.id);
                workspace.location.replace('/app?tab=settings-organization');
              } catch (error) {
                workspace.close();
                throw error;
              }
            }} />}
          </Suspense>
        </main>
      </AppShell>
    </div>
  );
}
