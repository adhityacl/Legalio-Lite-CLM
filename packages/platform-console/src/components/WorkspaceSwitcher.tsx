import React, { useState, useRef, useEffect } from 'react';
import { ChevronsUpDown, Check, Building2 } from 'lucide-react';
import { useIdentity } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { useLanguage } from '../context/LanguageContext';

import { Card } from '@legalio/ui-components/card';
export interface WorkspaceItem {
  id: string;
  name: string;
  brandName?: string;
  badgeClass: string;
  iconLetter?: string;
  logoUrl?: string;
}

const BADGE_COLOR_PALETTES = [
  'bg-status-success text-white',
  'bg-foreground  text-white',
  'bg-status-info text-white',
  'bg-status-finance text-white',
  'bg-foreground text-white',
  'bg-status-special text-white',
];

interface WorkspaceSwitcherProps {
  isCollapsed?: boolean;
  onNavigateToSettings?: () => void;
  className?: string;
}

export const WorkspaceSwitcher: React.FC<WorkspaceSwitcherProps> = ({
  isCollapsed = false,
  onNavigateToSettings: _onNavigateToSettings,
  className = '',
}) => {
  const { organizations, activeTenant, activeTenantId, branding, loading: tenantLoading, switchTenant } = useTenant();
  const { t } = useLanguage();
  const { identity } = useIdentity();
  const isPlatform = identity?.platformRole === 'superuser' && !activeTenantId;
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Every role may switch between its OWN active memberships (PRD §4.5.1);
  // a platform administrator sees the organization directory instead.
  const canSwitch = organizations.length > 1 || (organizations.length === 1 && !activeTenantId);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close dropdown on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Build workspace list with purposeful badge styling
  const workspaces: WorkspaceItem[] = organizations.map((org, idx) => {
    const badgeClass = BADGE_COLOR_PALETTES[idx % BADGE_COLOR_PALETTES.length];
    const displayName = org.organizationName;
    const iconLetter = (displayName || 'W').charAt(0).toUpperCase();
    return {
      id: org.organizationId,
      name: displayName,
      badgeClass,
      iconLetter,
      logoUrl: org.logoUrl && org.logoUrl !== '/favicon.png' ? org.logoUrl : undefined,
    };
  });

  // Never present the first organization as the current one when none is selected.
  const currentWorkspace =
    workspaces.find((w) => w.id === activeTenantId) || {
      id: 'none',
      name: activeTenant?.brandName || activeTenant?.name || (tenantLoading ? t('common.loading', 'Memuat Data...') : isPlatform ? branding.appName : t('tb.choose_organization', 'Choose an organization')),
      badgeClass: BADGE_COLOR_PALETTES[0],
      iconLetter: tenantLoading ? '-' : isPlatform ? branding.appName.charAt(0).toUpperCase() : '?',
      logoUrl: isPlatform ? (branding.logoUrl === '/favicon.png' ? new URL('../assets/favicon.png', import.meta.url).href : branding.logoUrl) : activeTenant?.logoUrl && activeTenant.logoUrl !== '/favicon.png' ? activeTenant.logoUrl : undefined,
    };

  const handleSelect = async (workspaceId: string) => {
    if (!canSwitch) return;
    if (workspaceId === activeTenantId) {
      setIsOpen(false);
      return;
    }
    await switchTenant(workspaceId);
    setIsOpen(false);
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => {
          if (canSwitch) setIsOpen((prev) => !prev);
        }}
        aria-expanded={canSwitch ? isOpen : false}
        aria-haspopup={canSwitch ? "listbox" : false}
        className={`w-full flex items-center gap-2.5 p-1.5 rounded-md transition-colors text-left group focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
 canSwitch
 ? 'hover:bg-muted cursor-pointer'
 : 'cursor-default select-none'
 } ${isCollapsed ? 'justify-center' : 'justify-between'}`}
        title={
          canSwitch
            ? currentWorkspace.name
            : t('workspace.akses_switch_workspace_terkunci', '{name} (Akses Switch Workspace Terkunci)', { name: currentWorkspace.name })
        }
      >
        <div className="flex items-center gap-2.5 min-w-0 overflow-hidden">
          {/* Workspace Monogram / Logo Icon */}
          <div
            className={`w-10 h-10 rounded-full ${
 currentWorkspace.logoUrl
 ? 'bg-card border border-border '
 : 'bg-primary text-white shadow-2xs'
 } flex items-center justify-center font-bold text-sm shrink-0 select-none overflow-hidden transition-transform`}
          >
            {currentWorkspace.logoUrl ? (
              <img
                src={currentWorkspace.logoUrl}
                alt={currentWorkspace.name}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              currentWorkspace.iconLetter
            )}
          </div>

          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              <span className="block font-semibold text-xs text-foreground tracking-tight truncate leading-tight">
                {currentWorkspace.name}
              </span>
              <span className="block text-xs text-muted-foreground truncate">
                {isPlatform ? t('nav.system_admin', 'System Admin') : t('workspace.workspace', 'Workspace')}
              </span>
            </div>
          )}
        </div>

        {!isCollapsed && canSwitch && (
          <ChevronsUpDown
            className={`w-4 h-4 text-muted-foreground shrink-0 group-hover:text-foreground transition-colors ${
 isOpen ? 'text-foreground ' : ''
 }`}
          />
        )}
      </button>

      {/* Popover Dropdown Menu */}
      {isOpen && canSwitch && (
        <Card
          role="listbox"
          aria-label={t('workspace.pilih_ruang_kerja', 'Pilih Ruang Kerja')}
          className={` absolute z-50 mt-1.5 ${
 isCollapsed ? 'left-14 top-0' : 'left-0 right-0'
 } min-w-[240px] p-1.5 animate-in fade-in zoom-in-95 duration-150`}
          style={{ transformOrigin: 'top left' }}
        >
          {/* Popover Header */}
          <div className="px-3 py-2 border-b border-border mb-1 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground tracking-tight">
              {t('workspace.switch_title', 'Pilih Ruang Kerja:')}
            </p>
          </div>

          {/* List of Workspaces */}
          <div className="space-y-0.5 max-h-64 overflow-y-auto py-0.5">
            {workspaces.map((workspace) => {
              const isSelected = workspace.id === activeTenantId;
              return (
                <button
                  key={workspace.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(workspace.id)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs transition-colors cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
 isSelected
 ? 'bg-muted text-foreground font-semibold'
 : 'text-foreground hover:bg-card hover:text-foreground '
 }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <div
                      className={`w-7 h-7 rounded-full ${
 workspace.logoUrl
 ? 'bg-card border border-border '
 : `${isSelected ? 'bg-primary text-white' : workspace.badgeClass} shadow-2xs`
                      } flex items-center justify-center font-bold text-xs shrink-0 select-none overflow-hidden`}
                    >
                      {workspace.logoUrl ? (
                        <img
                          src={workspace.logoUrl}
                          alt={workspace.name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        workspace.iconLetter
                      )}
                    </div>
                    <span className="truncate text-left text-xs">{workspace.name}</span>
                  </div>

                  {isSelected && (
                    <Check className="w-4 h-4 text-accent-foreground shrink-0 stroke-[2.5]" />
                  )}
                </button>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
};
