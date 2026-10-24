import React, { useState } from 'react';
import { Plus, Search, Check, Edit2, Trash2, ArrowUpRight } from 'lucide-react';
import { ConsoleOrganization } from './types';
import { useLanguage } from '../../context/LanguageContext';

import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Text } from '@legalio/ui-components/text';
import { Table, TableHeader, TableRow, TableColumnHeader, TableBody, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { TableEmptyState } from '../ui/table-empty-state';
import { Avatar, AvatarFallback, AvatarImage } from '@legalio/ui-components/avatar';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Badge } from '@legalio/ui-components/badge';
interface AdminOrganizationsTabProps {
  organizations: ConsoleOrganization[];
  activeOrg: ConsoleOrganization | null;
  onSelectOrg?: (org: ConsoleOrganization) => void | Promise<void>;
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
  const { t } = useLanguage();
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
          <Plus className="w-g16 h-g16" aria-hidden="true" />
          <span>{t('admin.btn_create_org', 'Buat Organisasi Baru')}</span>
        </Button>
      </Card>

      <Card className="overflow-hidden">
        <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.scroll_table')}>
          <Table className="min-w-g987">
            <TableHeader><TableRow>
              <TableColumnHeader scope="col">{t('documents.info.organization', 'Organization')}</TableColumnHeader>
              <TableColumnHeader scope="col">{t('tb.slug', 'Slug')}</TableColumnHeader>
              <TableColumnHeader scope="col">ID</TableColumnHeader>
              <TableColumnHeader scope="col">{t('admin.org_departments', 'Departments')}</TableColumnHeader>
              <TableColumnHeader scope="col">{t('admin.org_currency', 'Default currency')}</TableColumnHeader>
              <TableColumnHeader scope="col">{t('admin.org_folder_iso', 'Folder isolation')}</TableColumnHeader>
              <TableColumnHeader scope="col" className="text-right">{t('tb.col_action', 'Action')}</TableColumnHeader>
            </TableRow></TableHeader>
            <TableBody>
              {filteredOrgs.map((org) => {
                const isActive = activeOrg?.id === org.id;
                const deleteDisabled = isActive || Boolean(org.metadata?.isDefault);
                const deleteLabel = org.metadata?.isDefault
                  ? t('admin.cant_delete_default_org', 'Organisasi default sistem tidak dapat dihapus.')
                  : isActive
                  ? t('admin.cant_delete_active_org', 'Beralih ke organisasi lain terlebih dahulu sebelum menghapus.')
                  : t('admin.btn_delete_org', 'Hapus Organisasi');
                return (
                  <TableRow key={org.id} className={isActive ? 'bg-accent/50' : undefined}>
                    <TableCell>
                      <div className="flex items-center gap-g8">
                        <Avatar className="size-g26 shrink-0 text-xs">
                          {org.logo && org.logo !== '/favicon.png' && <AvatarImage src={org.logo} alt={org.name || t('documents.info.organization', 'Organization')} />}
                          <AvatarFallback>{(org.name || 'O').charAt(0).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 max-w-g233">
                          <Text size="sm" weight="semibold">{org.name || t('documents.info.organization', 'Organization')}</Text>
                          {isActive && <Badge tone="success" className="mt-g3"><Check className="size-g13" aria-hidden="true" />{t('admin.badge_active', 'Active')}</Badge>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">@{org.slug}</TableCell>
                    <TableCell className="font-mono text-xs">{org.id}</TableCell>
                    <TableCell className="tabular-nums">{org.teamCount ?? 0}</TableCell>
                    <TableCell className="font-mono text-xs">{org.metadata?.settings?.defaultCurrency || org.metadata?.currency || '—'}</TableCell>
                    <TableCell className="max-w-g233 text-xs">{t('admin.vendors_4', '/{name}/[Vendors]', { name: org.name })}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-g3 whitespace-nowrap">
                        <Tooltip><TooltipTrigger asChild>
                          <Button type="button" variant="ghost" size="icon-sm" onClick={() => onOpenEditOrg(org)} aria-label={`${t('admin.btn_edit', 'Edit')}: ${org.name}`}><Edit2 className="size-g13" aria-hidden="true" /></Button>
                        </TooltipTrigger><TooltipBody>{t('admin.btn_edit', 'Edit')}</TooltipBody></Tooltip>
                        <Tooltip><TooltipTrigger asChild>
                          <Button type="button" variant="ghost" size="icon-sm" onClick={() => onDeleteOrg(org)} disabled={deleteDisabled} aria-label={`${deleteLabel}: ${org.name}`}><Trash2 className="size-g13" aria-hidden="true" /></Button>
                        </TooltipTrigger><TooltipBody>{deleteLabel}</TooltipBody></Tooltip>
                        {onSelectOrg && <Tooltip><TooltipTrigger asChild>
                          <Button type="button" variant="secondary" size="icon-sm" onClick={() => void onSelectOrg(org)} aria-label={`${t('tb.manage_organization', 'Manage organization')}: ${org.name}`}><ArrowUpRight className="size-g16" aria-hidden="true" /></Button>
                        </TooltipTrigger><TooltipBody>{t('tb.manage_organization', 'Manage organization')}</TooltipBody></Tooltip>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredOrgs.length === 0 && <TableEmptyState colSpan={7} />}
            </TableBody>
          </Table>
        </TableScrollArea>
      </Card>
    </div>
  );
};
