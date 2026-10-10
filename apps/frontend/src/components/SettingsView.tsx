import React, { useEffect, useState } from 'react';
import { ArrowLeft, Building2, Plug, Users, type LucideIcon } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useTenant } from '../context/TenantContext';
import { useNavigation } from '../context/NavigationContext';
import { useConfirm } from '../context/ConfirmDialogContext';
import { usePermissions } from '../lib/permissions';
import { confirmLeave, hasUnsavedChanges } from '../lib/unsavedChanges';
import type { SettingsTabId } from '../lib/appRoutes';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@legalio/ui-components/tabs';
import { Button, buttonVariants } from '@legalio/ui-components/button';
import { OrganizationTab } from './settings/OrganizationTab';
import { MembersAccessTab } from './settings/MembersAccessTab';
import { IntegrationsTab } from './settings/IntegrationsTab';

import { Heading } from '@legalio/ui-components/heading';
/**
 * Tenant Settings (PRD §6.1): one screen, at most three tabs —
 * Organization, Members & Access, Integrations — filtered by the selected
 * organization's capabilities. Hidden tabs are never mounted or fetched.
 */
export const SettingsView: React.FC<{ tab: SettingsTabId }> = ({ tab }) => {
  const { t } = useLanguage();
  const { activeTenant, activeTenantId, leaveOrganization } = useTenant();
  const { setActiveTab, consumeIntent } = useNavigation();
  const confirm = useConfirm();
  const { hasPermission, accessMode, tenantRole } = usePermissions();
  const [intent] = useState(() => consumeIntent());

  const tabs: Array<{ id: SettingsTabId; label: string; icon: LucideIcon; visible: boolean }> = [
    { id: 'settings-organization', label: t('tb.tab_organization', 'Organization'), icon: Building2, visible: hasPermission('tenant.settings.read') },
    { id: 'settings-access', label: t('tb.tab_access', 'Members & Access'), icon: Users, visible: hasPermission('tenant.member.read') },
    { id: 'settings-integrations', label: t('tb.tab_integrations', 'Integrations'), icon: Plug, visible: hasPermission('tenant.integration.read') },
  ];
  const visible = tabs.filter((item) => item.visible);
  const orgName = activeTenant?.name || '';

  // Leaving a tab with unsaved changes asks first; nothing is saved silently.
  const go = async (next: string) => {
    if (next === tab) return;
    const ok = await confirmLeave(() => confirm({
      title: t('settings.unsaved_title', 'Unsaved changes'),
      description: t('settings.unsaved_description', 'You have unsaved changes. Discard them and continue?'),
      confirmLabel: t('settings.discard_changes', 'Discard changes'),
      cancelLabel: t('settings.stay', 'Stay'),
      tone: 'danger',
    }));
    if (ok) setActiveTab(next);
  };

  // Unsaved changes also guard closing or reloading the browser tab.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const roleLabel = tenantRole ? ({
    admin: t('tb.role_admin', 'Admin'), manager: t('tb.role_manager', 'Manager'), editor: t('tb.role_editor', 'Editor'), viewer: t('tb.role_viewer', 'Viewer'),
  } as Record<string, string>)[tenantRole] : '';

  return (
    <Tabs value={tab} onValueChange={(value) => void go(value)} id="settings" className="min-w-0 gap-5">
      <header>
        <div className="ds-context-bar">
          <div className="flex min-w-0 items-center gap-3">
            <div className="ds-context-bar-icon">
              <Building2 className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <Heading as="h2" size="lg" weight="semibold" className="truncate">
                {t('tb.settings_title', 'Settings — {org}', { org: orgName })}
              </Heading>
              {accessMode !== 'platform' && (
                <p className="text-sm text-muted-foreground truncate">
                  {t('tb.role_in_org', 'Role in this organization: {role}', { role: roleLabel })}
                </p>
              )}
            </div>
          </div>
          {accessMode === 'platform' && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={async () => { if (await leaveOrganization()) setActiveTab('admin-system-organizations'); }}
              aria-label={t('tb.back_to_system_admin', 'Back to System Admin')}
              title={t('tb.back_to_system_admin', 'Back to System Admin')}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t('tb.back_to_system_admin', 'Back to System Admin')}</span>
            </Button>
          )}
        </div>

        <TabsList
          aria-label={t('tb.settings_sections', 'Settings sections')}
          className="admin-tab-list flex h-auto w-full flex-wrap items-center justify-start gap-1 rounded-none bg-card/70 px-3 py-2 text-muted-foreground sm:px-4"
        >
          {visible.map((item) => {
            const Icon = item.icon;
            const isActive = tab === item.id;
            return (
              <TabsTrigger
                key={item.id}
                value={item.id}
                className={buttonVariants('ghost', 'sm', isActive
                  ? 'bg-card  text-accent-foreground shadow-xs font-semibold hover:bg-card '
                  : 'text-muted-foreground hover:text-foreground  hover:bg-card/60 ')}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </header>

      {/* key: switching organization remounts the tab and drops drafts (PRD §6.8). */}
      <TabsContent value="settings-organization">
        {hasPermission('tenant.settings.read') && <OrganizationTab key={activeTenantId} organizationId={activeTenantId} />}
      </TabsContent>
      <TabsContent value="settings-access">
        {hasPermission('tenant.member.read') && <MembersAccessTab key={activeTenantId} organizationId={activeTenantId} intent={intent} />}
      </TabsContent>
      <TabsContent value="settings-integrations">
        {hasPermission('tenant.integration.read') && <IntegrationsTab key={activeTenantId} organizationId={activeTenantId} />}
      </TabsContent>
    </Tabs>
  );
};
