import React, { useMemo } from 'react';
import { ArrowUpRight, FilePlus2 } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { CONTRACT_STATUS_LABEL_KEY } from '@legalio/types/domainStatus';
import type { Contract, InsertionOrder } from '@legalio/types';
import { Badge, statusTone } from '@legalio/ui-components/badge';
import { TableEmptyState } from './ui/table-empty-state';

import { Table, TableHeader, TableRow, TableColumnHeader, TableBody, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { Button } from '@legalio/ui-components/button';
import { Heading } from '@legalio/ui-components/heading';
import { Checkbox, CheckboxControl, CheckboxHiddenInput } from '@legalio/ui-components/checkbox';
export function RecentDocumentsTable({ contracts, ios, onNavigate }: {
  contracts: Contract[];
  ios: InsertionOrder[];
  onNavigate: (tab: 'contracts' | 'ios') => void;
}) {
  const { t, language } = useLanguage();
  const records = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - 3);
    return [
      ...contracts.map(contract => ({
        id: contract.contract_id,
        title: contract.judul_kontrak,
        type: contract.jenis_dokumen === 'Agreement Addendum'
          ? t('contracts.agreement_addendum', 'Agreement Addendum')
          : t('contracts.master_agreement', 'Master Agreement'),
        partner: contract.partner_nama || '—', status: contract.status,
        createdAt: contract.created_at, tab: 'contracts' as const,
      })),
      ...ios.map(io => ({
        id: io.io_id, title: io.judul_io,
        type: t('dashboard.insertion_orders', 'IO / SO / SOW'),
        partner: io.partner_nama || '—', status: io.status,
        createdAt: io.created_at, tab: 'ios' as const,
      })),
    ]
      .filter(record => {
        const createdAt = Date.parse(record.createdAt);
        return Number.isFinite(createdAt) && createdAt >= cutoff.getTime() && createdAt <= now.getTime();
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [contracts, ios, t]);

  return (
    <section aria-label={t('ui.recent_documents')} className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="p-4 sm:p-6 border-b border-border flex items-center gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-transparent bg-status-info-soft text-status-info border border-status-info-border"><FilePlus2 className="w-5 h-5" /></span>
          <Heading as="h3" size="sm" weight="semibold">{t('ui.recent_documents')}</Heading>
      </div>
      <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.recent_documents')}>
        <Table className="dashboard-data-table dashboard-document-table w-full min-w-[760px] text-left">
          <TableHeader><TableRow>
            <TableColumnHeader scope="col" className="w-12 text-left align-middle">
              <Checkbox aria-label={t('ui.select_all_recent')} disabled><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
            </TableColumnHeader>
            {[t('dashboard.doc_pending_col_name'), t('dashboard.doc_pending_col_type'), t('dashboard.partner'), t('ui.filter_status'), t('dashboard.doc_pending_col_created_at')].map(label => <TableColumnHeader key={label} scope="col">{label}</TableColumnHeader>)}
            <TableColumnHeader scope="col" className="text-right w-20 align-middle">
              <div className="flex items-center justify-end">{t('dashboard.action')}</div>
            </TableColumnHeader>
          </TableRow></TableHeader>
          <TableBody>
            {records.length === 0 ? <TableEmptyState colSpan={7} /> : records.map(record => <TableRow key={`${record.tab}-${record.id}`}>
              <TableCell className="w-12 align-middle">
                <Checkbox aria-label={t('ui.select_recent', 'Select {name}').replace('{name}', record.title)} disabled><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
              </TableCell>
              <TableCell className="max-w-72"><span className="line-clamp-2" title={record.title}>{record.title}</span></TableCell>
              <TableCell>{record.type}</TableCell>
              <TableCell>{record.partner}</TableCell>
              <TableCell><Badge tone={statusTone(record.status)}>{t(CONTRACT_STATUS_LABEL_KEY[record.status], record.status)}</Badge></TableCell>
              <TableCell className="whitespace-nowrap">{new Date(record.createdAt).toLocaleDateString(language === 'EN' ? 'en-GB' : language === 'ZH' ? 'zh-CN' : 'id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</TableCell>
              <TableCell className="text-right align-middle w-20"><Button variant="secondary" size="icon-md" type="button" onClick={() => onNavigate(record.tab)} aria-label={`${t('common.open', 'Open')} ${record.title}`}><ArrowUpRight className="size-4" /></Button></TableCell>
            </TableRow>)}
          </TableBody>
        </Table>
      </TableScrollArea>
    </section>
  );
}
