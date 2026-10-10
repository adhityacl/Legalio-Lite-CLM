import { AlphabeticalSelect } from './ui/alphabetical-select';
import React, { useState } from 'react';
import { getActiveFormattingLocale } from '@legalio/shared/currencyUtils';
import { Contract, InsertionOrder } from '@legalio/types';
import {
  GitCommit,
  Search,
  Plus,
  FileDown,
  Calendar,
  Layers,
  FileText,
  FileSpreadsheet,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

interface AmendmentsViewProps {
  contracts: Contract[];
  ios: InsertionOrder[];
  onOpenAddendumModal: (parentItem?: Contract | InsertionOrder) => void;
}

export const AmendmentsView: React.FC<AmendmentsViewProps> = ({
  contracts,
  ios,
  onOpenAddendumModal,
}) => {
  const { isLegal } = useAuth();
  const { t, language } = useLanguage();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'Contract' | 'IO'>('ALL');

  const amendments = contracts.filter(c => c.jenis_dokumen === 'Agreement Addendum');
  
  const filteredAmendments = amendments.filter((a) => {
    const matchSearch =
      a.nomor_kontrak.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (a.parent_contract_nomor && a.parent_contract_nomor.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (a.ringkasan_perubahan || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchType = filterType === 'ALL' || (filterType === 'Contract' ? true : false); // Since they are now all Contracts, or IOs. But actually, if they are IO addendums, they might still be stored as Contracts. 

    return matchSearch && matchType;
  });

  return (
    <div className="ds-page animate-in fade-in-50 duration-200">
      {/* Header */}
      <div className="ds-panel p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 transition-colors">
        <div>
          <h2 className="ds-page-heading">
            <span>{t('amendments.title')}</span>
          </h2>
        </div>

        {isLegal && (
          <button
            onClick={() => onOpenAddendumModal()}
            className="ui-button ui-button-lg mobile-page-action cursor-pointer flex items-center shrink-0 ds-button ds-button-lg ds-button-default"
          >
            <Plus className="w-4 h-4 text-white" />
            <span>{t('io.add_btn', 'Tambah')}</span>
          </button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="ds-panel p-6 mb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-2.5 transition-colors">
        <div className="mobile-filter-grid flex flex-1 flex-wrap items-center gap-2 w-full ds-grid">
          <div className="relative flex-1 min-w-[200px] md:max-w-xs">
            <Search className="w-4 h-4 text-ink-soft absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={t('amendments.search_placeholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="ds-input w-full pl-9 pr-3"
            />
          </div>

          <AlphabeticalSelect
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="ds-input flex-1 min-w-[140px] appearance-none pr-8"
          >
            <option value="ALL">{t('amendments.filter_all')}</option>
            <option value="Contract">{t('amendments.filter_contract')}</option>
            <option value="IO">{t('amendments.filter_io')}</option>
          </AlphabeticalSelect>
        </div>
      </div>

      {/* Amendments List */}
      <div className="space-y-4">
        {filteredAmendments.length === 0 ? (
          <div className="ds-panel p-8 text-center text-ink-soft text-xs">
            {t('amendments.no_data')}
          </div>
        ) : (
          filteredAmendments.map((add) => (
            <div
              key={add.contract_id || add.addendum_id}
              className="ds-panel p-5 transition-all space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-hairline">
                <div className="flex items-center gap-2">
                  <div className="ds-icon-tile ds-icon-tile-sm bg-accent-soft text-accent-text">
                    <GitCommit className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="ds-section-title">{add.nomor_kontrak || add.nomor_addendum}</h3>
                    <p className="text-xs text-ink-soft flex items-center gap-1 mt-0.5">
                      <span>{t('amendments.parent_doc')} ({add.parent_type || t('import.type_contract', 'Contract')}):</span>
                      <strong className="text-ink font-mono">{add.parent_contract_nomor || add.parent_nomor || add.parent_contract_id || add.parent_id}</strong>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-ink-soft font-mono text-xs">
                    {t('amendments.date')} {new Date(add.tanggal_mulai || add.tanggal_addendum).toLocaleDateString(getActiveFormattingLocale())}
                  </span>
                  {(add.link_file_kontrak || add.link_file_addendum) && (
                    <a
                      href={add.link_file_kontrak || add.link_file_addendum}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 bg-surface-2 hover:bg-surface-2 dark:hover:bg-surface-2 text-ink rounded-lg text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <FileDown className="w-3.5 h-3.5 text-accent-text" />
                      <span>{t('amendments.pdf_btn')}</span>
                    </a>
                  )}
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  <span className="text-xs font-semibold text-ink-soft">{t('amendments.changed_elements')}</span>
                  {(Array.isArray(add.field_yang_berubah) ? add.field_yang_berubah : []).map((f) => (
                    <span
                      key={f}
                      className="bg-status-warning-soft dark:bg-status-warning-soft/60 text-status-warning border border-status-warning-border dark:border-status-warning-border/50 text-xs font-bold px-2 py-0.5 rounded-sm"
                    >
                      {f}
                    </span>
                  ))}
                </div>

                <div className="ds-panel p-3 text-ink font-mono text-xs leading-relaxed">
                  <span className="text-ink-soft block text-xs font-sans font-bold uppercase mb-1">
                    {t('amendments.summary_label')}
                  </span>
                  {add.ringkasan_perubahan}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
