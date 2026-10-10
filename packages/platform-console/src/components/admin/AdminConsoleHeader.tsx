import React from 'react';
import {
  Building2,
  RefreshCw,
  Sliders,
  Shield,
  Users,
  Layers,
  Radio,
  Mail,
  Lock,
} from 'lucide-react';
import { ConsoleDashboardTab } from './types';
import { useLanguage } from '../../context/LanguageContext';
import { usePermissions } from '../../lib/permissions';
import { Button } from '@legalio/ui-components/button';
import { Badge, type StatusTone } from '@legalio/ui-components/badge';
import { ContextHeader } from '@legalio/ui-components/blocks';
import { Tabs, TabsList, TabsTrigger } from '@legalio/ui-components/tabs';
interface AdminConsoleHeaderProps {
  area: 'system' | 'organization';
  activeTab: ConsoleDashboardTab;
  onTabChange: (tab: ConsoleDashboardTab) => void;
  onCreateOrgClick: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  userCounts: {
    users: number;
    sessions: number;
    orgs: number;
    teams: number;
    invites: number;
    apiKeys: number;
  };
}

export const AdminConsoleHeader: React.FC<AdminConsoleHeaderProps> = ({
  area,
  activeTab,
  onTabChange,
  onCreateOrgClick: _onCreateOrgClick,
  onRefresh,
  isRefreshing,
  userCounts,
}) => {
  const { t } = useLanguage();
  const { hasPlatformPermission } = usePermissions();
  const isSystemArea = area === 'system';

  const navItems: Array<{
    id: ConsoleDashboardTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
    badgeVariant?: StatusTone;
  }> = [
    { id: 'dashboard', label: t('admin.tab_dashboard', 'Dashboard'), icon: Sliders },
    { id: 'users', label: t('admin.tab_users', 'Pengguna'), icon: Users, count: userCounts.users },
    { id: 'sessions', label: t('admin.tab_sessions', 'Sesi'), icon: Radio, count: userCounts.sessions, badgeVariant: 'success' },
    { id: 'organizations', label: t('admin.tab_organizations', 'Organisasi'), icon: Building2, count: userCounts.orgs },
    { id: 'apikeys', label: t('admin.tab_apikeys', 'API Keys'), icon: Lock, count: userCounts.apiKeys },
  ];

  // Platform console only: each tab needs its explicit platform permission (PRD §9.3).
  const requiredPermission: Record<ConsoleDashboardTab, string> = {
    dashboard: 'platform.access',
    users: 'platform.user.read',
    sessions: 'platform.session.read',
    organizations: 'platform.organization.read',
    apikeys: 'platform.apikey.read',
  };
  const visibleNavItems = navItems.filter((item) => isSystemArea && hasPlatformPermission(requiredPermission[item.id]));

  const label = isSystemArea ? t('admin.system_admin', 'System Admin') : t('admin.organization_admin', 'Organization Admin');
  return (
    <ContextHeader
      icon={isSystemArea ? <Shield /> : <Building2 />}
      title={label}
      description={isSystemArea ? undefined : t('admin.active_organization_controls', 'Active organization controls')}
      actions={
        <Button variant="ghost" size="icon-md" onClick={onRefresh} disabled={isRefreshing}
          aria-label={t('admin.refresh_btn', 'Segarkan Data')} title={t('admin.refresh_btn', 'Segarkan Data')}>
          <RefreshCw aria-hidden="true" className={isRefreshing ? 'animate-spin' : undefined} />
        </Button>
      }
    >
      {/* Panels render in the console view; ids keep the tab/panel relationship (WAI-ARIA tabs). */}
      <Tabs
        variant="line"
        value={activeTab}
        onValueChange={details => onTabChange(details.value as ConsoleDashboardTab)}
        ids={{ trigger: value => `admin-${area}-${value}-tab`, content: value => `admin-${area}-${value}-panel` }}
      >
        <TabsList aria-label={label} className="admin-tab-list overflow-x-auto border-t border-border px-4">
          {visibleNavItems.map(item => {
            const Icon = item.icon;
            return (
              <TabsTrigger key={item.id} value={item.id}>
                <Icon aria-hidden="true" />
                {item.label}
                {typeof item.count === 'number' && <Badge tone={item.badgeVariant || 'neutral'} className="font-mono">{item.count}</Badge>}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
    </ContextHeader>
  );
};
