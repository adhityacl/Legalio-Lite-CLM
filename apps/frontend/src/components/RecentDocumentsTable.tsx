import React, { useMemo } from 'react';
import { ArrowUpRight, FilePlus2 } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { CONTRACT_STATUS_LABEL_KEY } from '@legalio/types/domainStatus';
import type { Contract, InsertionOrder } from '@legalio/types';
import { getStatusBadgeClass } from '@legalio/ui-components/badge';
import { TableEmptyState } from './ui/table-empty-state';

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
    <section aria-label={t('ui.recent_documents')} className="bg-surface border border-hairline rounded-2xl shadow-sm overflow-hidden">
      <div className="p-4 sm:p-6 border-b border-hairline flex items-center gap-3">
          <span className="ds-icon-tile bg-status-info-soft dark:bg-status-info-soft/60 text-status-info border border-status-info-border"><FilePlus2 className="w-5 h-5" /></span>
          <h3 className="ds-section-title">{t('ui.recent_documents')}</h3>
      </div>
      <div className="overflow-x-auto ds-table-surface" role="region" tabIndex={0} aria-label={t('ui.recent_documents')}>
        <table className="ds-table dashboard-data-table dashboard-document-table w-full min-w-[760px] text-left text-xs">
          <thead className="bg-surface dark:bg-surface-2/50 text-ink"><tr>
            <th scope="col" className="pl-6 pr-2 py-4 w-12 text-left align-middle">
              <input
                type="checkbox"
                aria-label={t('ui.select_all_recent')}
                className="rounded-sm border-hairline text-accent-text focus:ring-accent"
                disabled
              />
            </th>
            {[t('dashboard.doc_pending_col_name'), t('dashboard.doc_pending_col_type'), t('dashboard.partner'), t('ui.filter_status'), t('dashboard.doc_pending_col_created_at')].map(label => <th key={label} scope="col" className="px-6 py-4 font-bold">{label}</th>)}
            <th scope="col" className="pl-2 pr-6 py-4 text-right w-20 font-bold align-middle">
              <div className="flex items-center justify-end">{t('dashboard.action')}</div>
            </th>
          </tr></thead>
          <tbody className="divide-y divide-hairline">
            {records.length === 0 ? <TableEmptyState colSpan={7} /> : records.map(record => <tr key={`${record.tab}-${record.id}`} className="hover:bg-surface dark:hover:bg-surface-2/50">
              <td className="pl-6 pr-2 py-4 w-12 align-middle">
                <input
                  type="checkbox"
                  aria-label={t('ui.select_recent', 'Select {name}').replace('{name}', record.title)}
                  className="rounded-sm border-hairline text-accent-text focus:ring-accent"
                  disabled
                />
              </td>
              <td className="px-6 py-4 max-w-72 font-semibold text-ink"><span className="line-clamp-2" title={record.title}>{record.title}</span></td>
              <td className="px-6 py-4 text-ink">{record.type}</td>
              <td className="px-6 py-4 text-ink">{record.partner}</td>
              <td className="px-6 py-4"><span className={`inline-flex rounded-full border px-3 py-0.5 whitespace-nowrap ${getStatusBadgeClass(record.status)}`}>{t(CONTRACT_STATUS_LABEL_KEY[record.status], record.status)}</span></td>
              <td className="px-6 py-4 whitespace-nowrap text-ink">{new Date(record.createdAt).toLocaleDateString(language === 'EN' ? 'en-GB' : language === 'ZH' ? 'zh-CN' : 'id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
              <td className="pl-2 pr-6 py-4 text-right align-middle w-20"><button type="button" onClick={() => onNavigate(record.tab)} aria-label={`${t('common.open', 'Open')} ${record.title}`} className="inline-flex size-10 items-center justify-center rounded-md text-ink-soft hover:bg-surface-2 hover:text-status-success dark:hover:bg-surface-2 dark:hover:text-status-success cursor-pointer"><ArrowUpRight className="size-4" /></button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>
  );
}
