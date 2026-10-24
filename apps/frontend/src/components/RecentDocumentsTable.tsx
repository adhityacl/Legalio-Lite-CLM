import React, { useMemo } from 'react';
import { ArrowUpRight, FilePlus2 } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { CONTRACT_STATUS_LABEL_KEY } from '@legalio/types/domainStatus';
import type { DashboardDocument } from '../api/aggregates';
import { TableCardHeader } from '@legalio/ui-components/blocks';
import { Badge, statusTone } from '@legalio/ui-components/badge';
import { TableEmptyState } from './ui/table-empty-state';

import { Table, TableHeader, TableRow, TableColumnHeader, TableBody, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { Button } from '@legalio/ui-components/button';
import { Heading } from '@legalio/ui-components/heading';
import { Checkbox, CheckboxControl, CheckboxHiddenInput } from '@legalio/ui-components/checkbox';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Card } from '@legalio/ui-components/card';
export function RecentDocumentsTable({ contracts, ios, onNavigate }: {
  /** The newest rows of the last three months, already limited and scoped by the server (`recent` of the dashboard aggregate). */
  contracts: DashboardDocument[];
  ios: DashboardDocument[];
  onNavigate: (tab: 'contracts' | 'ios', recordId?: string) => void;
}) {
  const { t, language } = useLanguage();
  const records = useMemo(() => [
    ...contracts.map(contract => ({
      id: contract.id,
      title: contract.title,
      type: contract.document_type === 'Agreement Addendum'
        ? t('contracts.agreement_addendum', 'Agreement Addendum')
        : t('contracts.master_agreement', 'Master Agreement'),
      partner: contract.partner_name || '—', status: contract.status,
      createdAt: contract.created_at, tab: 'contracts' as const,
    })),
    ...ios.map(io => ({
      id: io.id, title: io.title,
      type: t('dashboard.insertion_orders', 'IO / SO / SOW'),
      partner: io.partner_name || '—', status: io.status,
      createdAt: io.created_at, tab: 'ios' as const,
    })),
  ]
    .filter(record => Number.isFinite(Date.parse(record.createdAt)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 5), [contracts, ios, t]);

  return (
    <Card asChild><section aria-label={t('ui.recent_documents')} className="overflow-hidden">
      <TableCardHeader tone="info" icon={<FilePlus2 />} title={t('ui.recent_documents')} />
      <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.scroll_table')}>
        <Table className="dashboard-data-table dashboard-document-table w-full min-w-g610 text-left">
          <TableHeader><TableRow>
            <TableColumnHeader scope="col" className="w-g42">
              <Checkbox aria-label={t('ui.select_all_recent')} disabled><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
            </TableColumnHeader>
            {[t('dashboard.doc_pending_col_name'), t('dashboard.doc_pending_col_type'), t('dashboard.partner'), t('ui.filter_status'), t('dashboard.doc_pending_col_created_at')].map(label => <TableColumnHeader key={label} scope="col">{label}</TableColumnHeader>)}
            <TableColumnHeader scope="col" className="text-right w-g89">
              <div className="flex items-center justify-end">{t('dashboard.action')}</div>
            </TableColumnHeader>
          </TableRow></TableHeader>
          <TableBody>
            {records.length === 0 ? <TableEmptyState colSpan={7} /> : records.map(record => <TableRow key={`${record.tab}-${record.id}`}>
              <TableCell className="w-g42">
                <Checkbox aria-label={t('ui.select_recent', 'Select {name}').replace('{name}', record.title)} disabled><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
              </TableCell>
              <TableCell className="max-w-g233"><Tooltip><TooltipTrigger asChild><span className="block truncate">{record.title}</span></TooltipTrigger><TooltipBody>{record.title}</TooltipBody></Tooltip></TableCell>
              <TableCell>{record.type}</TableCell>
              <TableCell>{record.partner}</TableCell>
              <TableCell><Badge tone={statusTone(record.status)}>{t(CONTRACT_STATUS_LABEL_KEY[record.status], record.status)}</Badge></TableCell>
              <TableCell className="whitespace-nowrap">{new Date(record.createdAt).toLocaleDateString(language === 'EN' ? 'en-GB' : language === 'ZH' ? 'zh-CN' : 'id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</TableCell>
              <TableCell className="text-right w-g89"><Button variant="secondary" size="icon-sm" type="button" onClick={() => onNavigate(record.tab, record.id)} aria-label={`${t('common.open', 'Open')} ${record.title}`}><ArrowUpRight className="size-g16" /></Button></TableCell>
            </TableRow>)}
          </TableBody>
        </Table>
      </TableScrollArea>
    </section></Card>
  );
}
