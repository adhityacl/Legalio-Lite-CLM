import React, { useState } from 'react';
import {
  Building2,
  Plus,
  Search,
  Check,
  Edit2,
  Trash2,
  Users,
  Layers,
  ExternalLink,
  ShieldCheck,
  FolderTree,
} from 'lucide-react';
import { ConsoleOrganization } from './types';
import { useLanguage } from '../../context/LanguageContext';

import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
interface AdminOrganizationsTabProps {
  organizations: ConsoleOrganization[];
  activeOrg: ConsoleOrganization | null;
  onSelectOrg?: (org: ConsoleOrganization) => void;
  onOpenCreateOrg: () => void;
  onOpenEditOrg: (org: ConsoleOrganization) => void;
  onDeleteOrg: (org: ConsoleOrganization) => void;
}

export const AdminOrganizationsTab: React.FC<AdminOrganizationsTabProps> = ({
  organizations,
  activeOrg,
  onSelectOrg,
  onOpenCreateOrg,
  onOpenEditOrg,
  onDeleteOrg,
}) => {
  const { t, language } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredOrgs = (organizations || []).filter(
    (org) =>
      (org?.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (org?.slug || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (org?.id || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Controls Bar */}
      <Card className="mobile-controls-bar flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4">
        <InputGroup className="relative flex-1 min-w-[220px] max-w-md">
          <InputGroupAddon><Search className="size-4" aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput aria-label={t('admin.org_search_ph', 'Cari nama atau slug organisasi...')}
            type="text"
            placeholder={t('admin.org_search_ph', 'Cari nama atau slug organisasi...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </InputGroup>

        <Button variant="ghost"
          type="button"
          onClick={onOpenCreateOrg}
        >
          <Plus className="w-4 h-4" />
          <span>{t('admin.btn_create_org', 'Buat Organisasi Baru')}</span>
        </Button>
      </Card>

      {/* Organizations Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredOrgs.map((org) => {
          const isActive = activeOrg?.id === org.id;

          return (
            <Card
              key={org.id}
              className={` p-5 transition-all flex flex-col justify-between overflow-hidden relative ${
 isActive
 ? 'ring-1 ring-ring/20 bg-accent'
 : ''
 }`}
            >
              <div className="min-w-0">
                {/* Header info */}
                <div className="flex items-start justify-between gap-2.5 mb-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-foreground font-bold text-base shrink-0 border border-border overflow-hidden shadow-2xs mt-0.5">
                      {org.logo && org.logo !== '/favicon.png' ? (
                        <img
                          src={org.logo}
                          alt={org.name || t('documents.info.organization', 'Organization')}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <span>{(org.name || 'O').charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-foreground text-sm truncate" title={org.name || ''}>
                        {org.name || t('documents.info.organization', 'Organisasi')}
                      </h3>
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-mono text-muted-foreground mt-1">
                        <span className="truncate max-w-[120px]" title={`@${org.slug}`}>@{org.slug}</span>
                        <span className="text-primary-foreground select-none">•</span>
                        <span
                          className="text-xs bg-muted px-1.5 py-0.5 rounded-sm border border-border/80 text-muted-foreground font-mono inline-block max-w-full truncate"
                          title={org.id}
                        >
                          {t('admin.id_2', 'ID: {id}', { id: org.id })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {isActive && (
                    <span className="theme-soft shrink-0 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap self-start">
                      <Check className="w-3 h-3 shrink-0" />
                      <span>{t('admin.badge_active', 'Aktif')}</span>
                    </span>
                  )}
                </div>

                {/* Metrics pill */}
                <div className="grid grid-cols-2 gap-2 mb-4 p-2.5 rounded-lg bg-card text-xs">
                  <div className="flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">{t('admin.org_departments', 'Departemen')}</div>
                      <div className="font-semibold text-foreground font-mono">
                        {org.teamCount ?? 0} {t('admin.teams', 'Teams')}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" />
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">{t('admin.org_currency', 'Mata Uang')}</div>
                      <div className="font-semibold text-foreground font-mono">
                        {org.metadata?.settings?.defaultCurrency || org.metadata?.currency || '—'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Storage structure info */}
                <div className="text-xs text-muted-foreground flex items-center gap-1.5 mb-4">
                  <FolderTree className="w-3.5 h-3.5 text-accent-foreground" />
                  <span>{t('admin.org_folder_iso', 'Isolasi Folder')}: <strong>{t('admin.vendors_4', '/{name}/[Vendors]', { name: org.name })}</strong></span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-border flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Button variant="secondary" size="sm"
                    type="button"
                    onClick={() => onOpenEditOrg(org)}
                  >
                    <Edit2 className="w-3 h-3" />
                    <span>{t('admin.btn_edit', 'Edit')}</span>
                  </Button>

                  <Button variant="ghost" size="sm"
                    type="button"
                    onClick={() => onDeleteOrg(org)}
                    disabled={isActive || Boolean(org.metadata?.isDefault)}
                    title={
                      Boolean(org.metadata?.isDefault)
                        ? t('admin.cant_delete_default_org', 'Organisasi default sistem tidak dapat dihapus.')
                        : isActive
                        ? t('admin.cant_delete_active_org', 'Beralih ke organisasi lain terlebih dahulu sebelum menghapus.')
                        : t('admin.btn_delete_org', 'Hapus Organisasi')
                    }
                    className={ /*extra*/` ${
 isActive || Boolean(org.metadata?.isDefault)
 ? ''
 : ''
 }`}
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>{t('admin.btn_delete', 'Hapus')}</span>
                  </Button>
                </div>

                {onSelectOrg && (
                  <Button variant="outline" size="sm"
                    type="button"
                    onClick={() => onSelectOrg(org)}
                    className="theme-soft"
                  >
                    {t('tb.manage_organization', 'Manage organization')}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
