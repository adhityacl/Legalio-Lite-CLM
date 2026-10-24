import React from 'react';
import { RefreshCw } from 'lucide-react';
import type { SystemSubmenu } from '../../lib/appRoutes';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { Heading } from '@legalio/ui-components/heading';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Spinner } from '@legalio/ui-components/spinner';

export const AdminConsoleHeader: React.FC<{
  activeTab: SystemSubmenu;
  onRefresh: () => void | Promise<void>;
  isRefreshing: boolean;
}> = ({ activeTab, onRefresh, isRefreshing }) => {
  const { t } = useLanguage();
  const titles: Partial<Record<SystemSubmenu, string>> = {
    dashboard: t('admin.tab_dashboard', 'Dashboard'),
    users: t('admin.tab_users', 'Users'),
    sessions: t('admin.tab_sessions', 'Sessions'),
    organizations: t('admin.tab_organizations', 'Organizations'),
    accounts: t('sys.nav_accounts', 'Accounts'),
    apikeys: t('admin.tab_apikeys', 'API Keys'),
  };
  return (
    <div className="flex items-center justify-between gap-g8">
      <Heading as="h2" size="md" weight="semibold">{titles[activeTab]}</Heading>
      <Tooltip><TooltipTrigger asChild>
        <Button variant="ghost" size="icon-md" onClick={() => void onRefresh()} disabled={isRefreshing} aria-label={t('admin.refresh_btn', 'Refresh Data')}>
          {isRefreshing ? <Spinner size="sm" decorative /> : <RefreshCw aria-hidden="true" />}
        </Button>
      </TooltipTrigger><TooltipBody>{t('admin.refresh_btn', 'Refresh Data')}</TooltipBody></Tooltip>
    </div>
  );
};
