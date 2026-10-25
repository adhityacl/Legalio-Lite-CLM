import React, { useEffect, useState } from 'react';
import { ArrowLeft, Building2, DatabaseZap, Users, type LucideIcon } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useTenant } from '../context/TenantContext';
import { useNavigation } from '../context/NavigationContext';
import { useConfirm } from '../context/ConfirmDialogContext';
import { usePermissions } from '../lib/permissions';
import { confirmLeave, hasUnsavedChanges } from '../lib/unsavedChanges';
import type { SettingsTabId } from '../lib/appRoutes';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@legalio/ui-components/tabs';
import { Button } from '@legalio/ui-components/button';
import { ContextHeader } from '@legalio/ui-components/blocks';
import { OrganizationTab } from './settings/OrganizationTab';
import { MembersAccessTab } from './settings/MembersAccessTab';
import { DataApiTab } from './settings/DataApiTab';

import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { voidHandler } from '@legalio/shared/voidHandler';
/**
 * Tenant Settings (PRD §6.1): one screen, at most three tabs —
 * Organization, Members & Access and Data & API — filtered by the selected
 * organization's capabilities. Hidden tabs are never mounted or fetched.
 */
export const SettingsView: React.FC<{ tab: SettingsTabId }> = ({ tab }) => {
  const { t } = useLanguage();
  const { activeTenant, activeTenantId, leaveOrganization } = useTenant();
  const { setActiveTab, intent: pendingIntent, consumeIntent } = useNavigation();
  const confirm = useConfirm();
  const { hasPermission, accessMode, tenantRole } = usePermissions();
  // Read the alias intent during render, clear it after commit: clearing it while rendering could drop it if React re-renders.
  const [intent] = useState(pendingIntent);
  useEffect(() => { if (pendingIntent) consumeIntent(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs: Array<{ id: SettingsTabId; label: string; icon: LucideIcon; visible: boolean }> = [
    { id: 'settings-organization', label: t('tb.tab_organization', 'Organization'), icon: Building2, visible: hasPermission('tenant.settings.read') },
    { id: 'settings-access', label: t('tb.tab_access', 'Members & Access'), icon: Users, visible: hasPermission('tenant.member.read') },
    { id: 'settings-data', label: t('tb.tab_data', 'Data & API'), icon: DatabaseZap, visible: hasPermission('tenant.data.export') },
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
    <Tabs value={tab} onValueChange={details => void go(details.value as SettingsTabId)} lazyMount unmountOnExit id="settings" className="min-w-0 gap-g21">
      <ContextHeader
        title={t('tb.settings_title', 'Settings / {org}', { org: orgName })}
        description={accessMode !== 'platform' ? t('tb.role_in_org', 'Role in this organization: {role}', { role: roleLabel }) : undefined}
        actions={accessMode === 'platform' && (
          <Tooltip><TooltipTrigger asChild><Button size="sm" variant="ghost" onClick={voidHandler(async () => { if (await leaveOrganization()) setActiveTab('admin-system-organizations'); })}
            aria-label={t('tb.back_to_system_admin', 'Back to System Admin')}>
            <ArrowLeft aria-hidden="true" />
            <span className="hidden sm:inline">{t('tb.back_to_system_admin', 'Back to System Admin')}</span>
          </Button></TooltipTrigger><TooltipBody>{t('tb.back_to_system_admin', 'Back to System Admin')}</TooltipBody></Tooltip>
        )}
      >
        <TabsList aria-label={t('tb.settings_sections', 'Settings sections')} className="mx-g21 mb-g21 w-fit max-w-full overflow-x-auto">
          {visible.map(item => {
            const Icon = item.icon;
            return (
              <TabsTrigger key={item.id} value={item.id}>
                <Icon aria-hidden="true" />
                {item.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </ContextHeader>

      {/* key: switching organization remounts the tab and drops drafts (PRD §6.8). */}
      <TabsContent value="settings-organization">
        {hasPermission('tenant.settings.read') && <OrganizationTab key={activeTenantId} organizationId={activeTenantId} />}
      </TabsContent>
      <TabsContent value="settings-access">
        {hasPermission('tenant.member.read') && <MembersAccessTab key={activeTenantId} organizationId={activeTenantId} intent={intent} />}
      </TabsContent>
      <TabsContent value="settings-data">
        {hasPermission('tenant.data.export') && <DataApiTab key={activeTenantId} organizationId={activeTenantId} />}
      </TabsContent>
    </Tabs>
  );
};
