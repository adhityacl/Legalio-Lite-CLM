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
import { Heading } from '@legalio/ui-components/heading';
import { Avatar, AvatarFallback, AvatarImage } from '@legalio/ui-components/avatar';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Badge } from '@legalio/ui-components/badge';
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
    <div className="space-y-g13">
      {/* Controls Bar */}
      <Card className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-g13 p-g13">
        <InputGroup className="relative flex-1 min-w-g233 max-w-g377">
          <InputGroupAddon><Search className="size-g16" aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput aria-label={t('admin.org_search_ph', 'Cari nama atau slug organisasi...')}
            type="text"
            placeholder={t('admin.org_search_ph', 'Cari nama atau slug organisasi...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </InputGroup>

        <Button
          type="button"
          onClick={onOpenCreateOrg}
        >
          <Plus className="w-g16 h-g16" />
          <span>{t('admin.btn_create_org', 'Buat Organisasi Baru')}</span>
        </Button>
      </Card>

      {/* Organizations Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-g13">
        {filteredOrgs.map((org) => {
          const isActive = activeOrg?.id === org.id;

          return (
            <Card
              key={org.id}
              className={` p-g21 transition-all flex flex-col justify-between overflow-hidden relative ${
 isActive
 ? 'ring-1 ring-ring/20 bg-accent'
 : ''
 }`}
            >
              <div className="min-w-0">
                {/* Header info */}
                <div className="flex items-start justify-between gap-g8 mb-g13">
                  <div className="flex items-start gap-g13 min-w-0 flex-1">
                    <Avatar className="mt-g2 shrink-0">
                      {org.logo && org.logo !== '/favicon.png' && <AvatarImage src={org.logo} alt={org.name || t('documents.info.organization', 'Organization')} />}
                      <AvatarFallback>{(org.name || 'O').charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <Tooltip><TooltipTrigger asChild><Heading as="h3" size="xs" weight="semibold" className="truncate">
                        {org.name || t('documents.info.organization', 'Organisasi')}
                      </Heading></TooltipTrigger><TooltipBody>{org.name || ''}</TooltipBody></Tooltip>
                      <div className="flex flex-wrap items-center gap-x-g5 gap-y-g3 text-xs font-mono text-muted-foreground mt-g3">
                        <Tooltip><TooltipTrigger asChild><span className="truncate max-w-g110">@{org.slug}</span></TooltipTrigger><TooltipBody>{`@${org.slug}`}</TooltipBody></Tooltip>
                        <span className="text-primary-foreground select-none">•</span>
                        <Tooltip><TooltipTrigger asChild><Badge tone="neutral" className="font-mono max-w-full truncate">{t('admin.id_2', 'ID: {id}', { id: org.id })}</Badge></TooltipTrigger><TooltipBody>{org.id}</TooltipBody></Tooltip>
                      </div>
                    </div>
                  </div>

                  {isActive && (
                    <Badge tone="success" className="shrink-0 whitespace-nowrap self-start"><Check className="w-g13 h-g13 shrink-0" /><span>{t('admin.badge_active', 'Aktif')}</span></Badge>
                  )}
                </div>

                {/* Metrics pill */}
                <div className="grid grid-cols-2 gap-g8 mb-g13 p-g8 rounded-lg bg-card text-xs">
                  <div className="flex items-center gap-g8">
                    <Layers className="w-g13 h-g13 text-muted-foreground" />
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">{t('admin.org_departments', 'Departemen')}</div>
                      <div className="font-semibold text-foreground font-mono">
                        {org.teamCount ?? 0} {t('admin.teams', 'Teams')}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-g8">
                    <ShieldCheck className="w-g13 h-g13 text-muted-foreground" />
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">{t('admin.org_currency', 'Mata Uang')}</div>
                      <div className="font-semibold text-foreground font-mono">
                        {org.metadata?.settings?.defaultCurrency || org.metadata?.currency || '—'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Storage structure info */}
                <div className="text-xs text-muted-foreground flex items-center gap-g5 mb-g13">
                  <FolderTree className="w-g13 h-g13 text-accent-foreground" />
                  <span>{t('admin.org_folder_iso', 'Isolasi Folder')}: <strong>{t('admin.vendors_4', '/{name}/[Vendors]', { name: org.name })}</strong></span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-g13 border-t border-border flex items-center justify-between gap-g8">
                <div className="flex items-center gap-g5">
                  <Button variant="secondary" size="sm"
                    type="button"
                    onClick={() => onOpenEditOrg(org)}
                  >
                    <Edit2 className="w-g13 h-g13" />
                    <span>{t('admin.btn_edit', 'Edit')}</span>
                  </Button>

                  <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm"
                    type="button"
                    onClick={() => onDeleteOrg(org)}
                    disabled={isActive || Boolean(org.metadata?.isDefault)} aria-label={Boolean(org.metadata?.isDefault)
                        ? t('admin.cant_delete_default_org', 'Organisasi default sistem tidak dapat dihapus.')
                        : isActive
                        ? t('admin.cant_delete_active_org', 'Beralih ke organisasi lain terlebih dahulu sebelum menghapus.')
                        : t('admin.btn_delete_org', 'Hapus Organisasi')}
                    className={ /*extra*/` ${
 isActive || Boolean(org.metadata?.isDefault)
 ? ''
 : ''
 }`}
                  >
                    <Trash2 className="w-g13 h-g13" />
                    <span>{t('admin.btn_delete', 'Hapus')}</span>
                  </Button></TooltipTrigger><TooltipBody>{Boolean(org.metadata?.isDefault)
                        ? t('admin.cant_delete_default_org', 'Organisasi default sistem tidak dapat dihapus.')
                        : isActive
                        ? t('admin.cant_delete_active_org', 'Beralih ke organisasi lain terlebih dahulu sebelum menghapus.')
                        : t('admin.btn_delete_org', 'Hapus Organisasi')}</TooltipBody></Tooltip>
                </div>

                {onSelectOrg && (
                  <Button variant="outline" size="sm"
                    type="button"
                    onClick={() => onSelectOrg(org)}
                   
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
