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
import { Badge, type BadgeVariant } from '@legalio/ui-components/badge';

import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
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
    badgeVariant?: BadgeVariant;
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

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % visibleNavItems.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + visibleNavItems.length) % visibleNavItems.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = visibleNavItems.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = visibleNavItems[nextIndex].id;
    onTabChange(nextTab);
    requestAnimationFrame(() => document.getElementById(`admin-${area}-${nextTab}-tab`)?.focus());
  };

  return (
    <Card>
      <div className="ds-context-bar">
        <div className="flex min-w-0 items-center gap-3">
          <div className="ds-context-bar-icon">
            {isSystemArea ? <Shield className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
            <Heading as="h2" size="lg" weight="semibold">
              {isSystemArea ? t('admin.system_admin', 'System Admin') : t('admin.organization_admin', 'Organization Admin')}
            </Heading>
            {!isSystemArea && (
              <p className="text-sm text-muted-foreground truncate">
                {t('admin.active_organization_controls', 'Active organization controls')}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-md"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label={t('admin.refresh_btn', 'Segarkan Data')}
            title={t('admin.refresh_btn', 'Segarkan Data')}
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-accent-foreground' : ''}`} />
          </Button>
        </div>
      </div>

      <div
        role="tablist"
        aria-label={isSystemArea ? t('admin.system_admin', 'System Admin') : t('admin.organization_admin', 'Organization Admin')}
        className="admin-tab-list flex flex-wrap items-center gap-1 bg-card/70 px-3 py-2 sm:px-4"
      >
        {visibleNavItems.map((item, index) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <Button
              key={item.id}
              type="button"
              variant="ghost"
              size="sm"
              role="tab"
              id={`admin-${area}-${item.id}-tab`}
              aria-controls={`admin-${area}-${item.id}-panel`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onTabChange(item.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className={
                isActive
                  ? ''
                  : ''
              }
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{item.label}</span>
              {typeof item.count === 'number' && (
                <Badge tone={item.badgeVariant || (isActive ? 'success' : 'neutral')} className="font-mono">
                  {item.count}
                </Badge>
              )}
            </Button>
          );
        })}
      </div>
    </Card>
  );
};
