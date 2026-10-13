import React, { useId } from 'react';
import { ChevronsUpDown } from 'lucide-react';
import { useIdentity } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { useLanguage } from '../context/LanguageContext';
import { Avatar, AvatarFallback, AvatarImage } from '@legalio/ui-components/avatar';
import { SidebarLabel, SidebarNavigationButton } from '@legalio/ui-components/sidebar';
import {
  Menu, MenuContent, MenuIndicator, MenuItemGroup, MenuItemGroupLabel, MenuItemIndicator, MenuItemText, MenuItemTextContent,
  MenuItemTextIcon, MenuItemTextLabel, MenuPositioner, MenuRadioItem, MenuRadioItemGroup, MenuTrigger, MenuViewport,
} from '@legalio/ui-components/menu';

import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
interface WorkspaceSwitcherProps {
  isCollapsed?: boolean;
  onNavigateToSettings?: () => void;
  className?: string;
}

const visibleLogo = (url?: string) => (url && url !== '/favicon.png' ? url : undefined);

function WorkspaceAvatar({ name, letter, logoUrl, size = 'md' }: { name: string; letter: string; logoUrl?: string; size?: 'sm' | 'md' }) {
  return (
    <Avatar size={size} className={logoUrl ? 'rounded-none bg-transparent' : undefined} data-sidebar-icon>
      {logoUrl && <AvatarImage src={logoUrl} alt={name} className="rounded-none object-contain" />}
      <AvatarFallback className="bg-primary text-primary-foreground">{letter}</AvatarFallback>
    </Avatar>
  );
}

/** Organization switcher (moduix Sidebar "workspace select" pattern): one Menu with radio items. */
export const WorkspaceSwitcher: React.FC<WorkspaceSwitcherProps> = ({ className }) => {
  const { organizations, activeTenant, activeTenantId, branding, loading: tenantLoading, switchTenant } = useTenant();
  const { t } = useLanguage();
  const { identity } = useIdentity();
  const isPlatform = identity?.platformRole === 'superuser' && !activeTenantId;
  // Every role may switch between its own active memberships (PRD §4.5.1).
  const canSwitch = organizations.length > 1 || (organizations.length === 1 && !activeTenantId);

  const active = organizations.find(org => org.organizationId === activeTenantId);
  // Never present the first organization as the current one when none is selected.
  const name = active?.organizationName
    || activeTenant?.brandName || activeTenant?.name
    || (tenantLoading ? t('common.loading', 'Memuat Data...') : isPlatform ? branding.appName : t('tb.choose_organization', 'Choose an organization'));
  const letter = tenantLoading ? '-' : (name || 'W').charAt(0).toUpperCase();
  const logoUrl = active
    ? visibleLogo(active.logoUrl)
    : isPlatform
    ? (branding.logoUrl === '/favicon.png' ? new URL('../assets/favicon.png', import.meta.url).href : branding.logoUrl)
    : visibleLogo(activeTenant?.logoUrl);

  // Tooltip and Menu share one trigger id; MenuTrigger must wrap the button itself so it receives aria-haspopup and the click handler.
  const triggerId = `workspace-switcher-${useId()}`;
  const button = (
    <SidebarNavigationButton size="md" className={className}>
      <WorkspaceAvatar size="sm" name={name} letter={letter} logoUrl={logoUrl} />
      <SidebarLabel className="min-w-0">
        <span className="truncate text-sm font-semibold">{name}</span>
      </SidebarLabel>
      {canSwitch && <MenuIndicator><ChevronsUpDown /></MenuIndicator>}
    </SidebarNavigationButton>
  );
  if (!canSwitch) return button;

  return (
    <Menu ids={{ trigger: triggerId }} positioning={{ placement: 'bottom-start', gutter: 8 }}>
      <Tooltip ids={{ trigger: triggerId }}><TooltipTrigger asChild><MenuTrigger asChild>{button}</MenuTrigger></TooltipTrigger><TooltipBody>{name}</TooltipBody></Tooltip>
      <MenuPositioner>
        <MenuContent className="min-w-g233" aria-label={t('workspace.pilih_ruang_kerja', 'Pilih Ruang Kerja')}>
          <MenuViewport className="max-h-g233">
            <MenuItemGroup>
              <MenuItemGroupLabel>{t('workspace.switch_title', 'Pilih Ruang Kerja:')}</MenuItemGroupLabel>
              <MenuRadioItemGroup value={activeTenantId ?? ''} onValueChange={details => { if (details.value !== activeTenantId) void switchTenant(details.value); }}>
                {organizations.map(org => {
                  const orgName = org.organizationName;
                  return (
                    <MenuRadioItem key={org.organizationId} value={org.organizationId} indicator="end">
                      <MenuItemText>
                        <MenuItemTextContent>
                          <MenuItemTextIcon className="size-g26"><WorkspaceAvatar size="sm" name={orgName} letter={(orgName || 'W').charAt(0).toUpperCase()} logoUrl={visibleLogo(org.logoUrl)} /></MenuItemTextIcon>
                          <MenuItemTextLabel>{orgName}</MenuItemTextLabel>
                        </MenuItemTextContent>
                      </MenuItemText>
                      <MenuItemIndicator />
                    </MenuRadioItem>
                  );
                })}
              </MenuRadioItemGroup>
            </MenuItemGroup>
          </MenuViewport>
        </MenuContent>
      </MenuPositioner>
    </Menu>
  );
};
