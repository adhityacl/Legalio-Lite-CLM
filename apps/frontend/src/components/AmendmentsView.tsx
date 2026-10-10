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

import { Button } from '@legalio/ui-components/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
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
    <div className="flex flex-col gap-6 animate-in fade-in-50 duration-200">
      {/* Header */}
      <Card className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 transition-colors">
        <div>
          <Heading as="h2" size="lg" weight="semibold">
            <span>{t('amendments.title')}</span>
          </Heading>
        </div>

        {isLegal && (
          <Button
            onClick={() => onOpenAddendumModal()}
            className="mobile-page-action shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>{t('io.add_btn', 'Tambah')}</span>
          </Button>
        )}
      </Card>

      {/* Filter Bar */}
      <Card className="p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-2.5 transition-colors">
        <div className="mobile-filter-grid flex flex-1 flex-wrap items-center gap-2 w-full">
          <InputGroup className="relative flex-1 min-w-[200px] md:max-w-xs">
            <InputGroupAddon><Search className="size-4" aria-hidden="true" /></InputGroupAddon>
            <InputGroupInput
              type="text"
              placeholder={t('amendments.search_placeholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </InputGroup>

          <AlphabeticalSelect
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="flex-1 min-w-[140px] appearance-none pr-8"
          >
            <option value="ALL">{t('amendments.filter_all')}</option>
            <option value="Contract">{t('amendments.filter_contract')}</option>
            <option value="IO">{t('amendments.filter_io')}</option>
          </AlphabeticalSelect>
        </div>
      </Card>

      {/* Amendments List */}
      <div className="space-y-4">
        {filteredAmendments.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground text-xs">
            {t('amendments.no_data')}
          </Card>
        ) : (
          filteredAmendments.map((add) => (
            <Card
              key={add.contract_id || add.addendum_id}
              className="p-5 transition-all space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <div className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-transparent size-8 bg-primary text-accent-foreground">
                    <GitCommit className="w-4 h-4" />
                  </div>
                  <div>
                    <Heading as="h3" size="sm" weight="semibold">{add.nomor_kontrak || add.nomor_addendum}</Heading>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <span>{t('amendments.parent_doc')} ({add.parent_type || t('import.type_contract', 'Contract')}):</span>
                      <strong className="text-foreground font-mono">{add.parent_contract_nomor || add.parent_nomor || add.parent_contract_id || add.parent_id}</strong>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground font-mono text-xs">
                    {t('amendments.date')} {new Date(add.tanggal_mulai || add.tanggal_addendum).toLocaleDateString(getActiveFormattingLocale())}
                  </span>
                  {(add.link_file_kontrak || add.link_file_addendum) && (
                    <a
                      href={add.link_file_kontrak || add.link_file_addendum}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 bg-muted hover:bg-muted text-foreground rounded-lg text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <FileDown className="w-3.5 h-3.5 text-accent-foreground" />
                      <span>{t('amendments.pdf_btn')}</span>
                    </a>
                  )}
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  <span className="text-xs font-semibold text-muted-foreground">{t('amendments.changed_elements')}</span>
                  {(Array.isArray(add.field_yang_berubah) ? add.field_yang_berubah : []).map((f) => (
                    <span
                      key={f}
                      className="bg-status-warning-soft text-status-warning border border-status-warning-border text-xs font-bold px-2 py-0.5 rounded-sm"
                    >
                      {f}
                    </span>
                  ))}
                </div>

                <Card className="p-3 text-foreground font-mono text-xs leading-relaxed">
                  <span className="text-muted-foreground block text-xs font-sans font-bold uppercase mb-1">
                    {t('amendments.summary_label')}
                  </span>
                  {add.ringkasan_perubahan}
                </Card>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};
