import { ModalFrame } from './ui/modal-frame';
import { TableViewMenu, TableViewOption } from './ui/table-view-menu';
import { AlphabeticalSelect } from './ui/alphabetical-select';
import { formatBusinessDate } from '../lib/displayDate';
import { FilterSummary } from './ui/filter-summary';
import { TableEmptyState } from './ui/table-empty-state';
import React, { useState, useMemo, useEffect } from 'react';
import { getActiveFormattingLocale, convertToUsdWithFallback } from '@legalio/shared/currencyUtils';
import { Contract, Partner, InsertionOrder } from '@legalio/types';
import { formatMoney } from '@legalio/shared/currencyUtils';
import { ActionMenu } from './ui/action-menu';
import { TablePagination } from './ui/TablePagination';
import { Badge, statusTone } from '@legalio/ui-components/badge';
import { getSavedColumnPreferences, saveColumnPreferences } from '../lib/tablePreferences';
import {
  FileSpreadsheet,
  FileText,
  Search,
  Filter,
  Plus,
  Calendar,
  Clock,
  CheckCircle,
  AlertTriangle,
  FileDown,
  Download,
  ChevronRight,
  ExternalLink,
  Edit2,
  Trash2,
  GitCommit,
  Tag,
  Link2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
  Scale,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import {
  canViewContract,
  canEditContract,
  canCreateContract,
  canDeletePartner,
} from '../lib/rbacScoping';
import { ContractRedliningModal } from './ContractRedliningModal';
import { usePermissions } from '../lib/permissions';
import { ContractEndingSummary } from '../features/contracts/ContractEndingSummary';

import { TableColumnHeader, Table, TableHeader, TableRow, TableBody, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { Button } from '@legalio/ui-components/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { DialogHeader, DialogTitle } from '@legalio/ui-components/dialog';
import { Checkbox, CheckboxControl, CheckboxHiddenInput } from '@legalio/ui-components/checkbox';
interface ContractsViewProps {
  contracts: Contract[];
  partners: Partner[];
    ios: InsertionOrder[];
  onAddContract: () => void;
  onEditContract: (contract: Contract) => void;
  onDeleteContract: (contractId: string) => void;
  onOpenAddendumModal: (contract: Contract) => void;
  onUpdateContractData?: (updatedContract: Contract) => void;
  openDocumentId?: string;
  onDocumentOpened?: () => void;
}

export const ContractsView: React.FC<ContractsViewProps> = ({
  contracts,
  partners,
    ios,
  onAddContract,
  onEditContract,
  onDeleteContract,
  onOpenAddendumModal,
  onUpdateContractData,
  openDocumentId,
  onDocumentOpened,
}) => {
  const { user, isLegal, isAdmin } = useAuth();
  const { hasPermission } = usePermissions();
  const { t, language } = useLanguage();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');

  const [selectedJenisDokumen, setSelectedJenisDokumen] = useState<string>('ALL');
  const [detailContract, setDetailContract] = useState<Contract | null>(null);
  useEffect(() => {
    if (!openDocumentId) return;
    const contract = contracts.find(item => item.contract_id === openDocumentId);
    if (contract && hasPermission('document.view') && canViewContract(contract, partners, user)) setDetailContract(contract);
    onDocumentOpened?.();
  }, [openDocumentId, contracts, partners, user, hasPermission, onDocumentOpened]);
  const [redliningContract, setRedliningContract] = useState<Contract | null>(null);

  // Categories list
  const allCategories = useMemo(() => Array.from(new Set(contracts.flatMap(c => c.kategori_kerjasama || []))), [contracts]);
  const partnersById = useMemo(() => new Map(partners.map(partner => [partner.partner_id, partner])), [partners]);

  // Filter logic
  const filteredContracts = useMemo(() => contracts.filter((c) => {
    // 1. Department Scoping & RBAC restriction (based on internal PIC of partner)
    if (!canViewContract(c, partners, user)) {
      return false;
    }

    const jenis = c.jenis_dokumen || 'Master Agreement';
    const matchJenis = selectedJenisDokumen === 'ALL' || jenis === selectedJenisDokumen;

    const matchSearch =
      c.nomor_kontrak.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.judul_kontrak.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.partner_nama && c.partner_nama.toLowerCase().includes(searchTerm.toLowerCase())) ||
      c.pic_internal.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.parent_contract_nomor && c.parent_contract_nomor.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchCategory =
      selectedCategory === 'ALL' || (c.kategori_kerjasama && c.kategori_kerjasama.includes(selectedCategory));

    const matchStatus = selectedStatus === 'ALL' || c.status === selectedStatus;

    return matchJenis && matchSearch && matchCategory && matchStatus;
  }), [contracts, partners, user, selectedJenisDokumen, selectedCategory, selectedStatus, searchTerm]);

  type SortField = 'no' | 'partner' | 'doc_type' | 'value' | 'duration' | 'status' | 'document';
  type SortOrder = 'asc' | 'desc';

  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const DEFAULT_CONTRACT_COLUMNS = {
    jenis_dokumen: false,
    nomor_kontrak: true,
    judul_kontrak: true,
    partner: true,
    kategori: false,
    nilai: true,
    tanggal_mulai: false,
    tanggal_selesai: false,
    status: true,
    file: false,
  };

  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() =>
    getSavedColumnPreferences('contracts', DEFAULT_CONTRACT_COLUMNS)
  );
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

  const toggleColumnVisibility = (id: string) => {
    setVisibleColumns((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveColumnPreferences('contracts', next);
      return next;
    });
  };


  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortOrder === 'asc') {
        setSortOrder('desc');
      } else {
        setSortField(null);
        setSortOrder('asc');
      }
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const sortedContracts = React.useMemo(() => {
    if (!sortField) return filteredContracts;

    return [...filteredContracts].sort((a, b) => {
      let valA: any = '';
      let valB: any = '';

      const getPartnerName = (c: Contract) => {
        const partnerObj = partnersById.get(c.partner_id);
        return c.partner_nama || partnerObj?.nama_partner || '';
      };

      switch (sortField) {
        case 'no':
          valA = a.nomor_kontrak;
          valB = b.nomor_kontrak;
          break;
        case 'partner':
          valA = getPartnerName(a);
          valB = getPartnerName(b);
          break;
        case 'doc_type':
          valA = `${a.jenis_dokumen || ''}_${(a.kategori_kerjasama || []).join(', ')}`;
          valB = `${b.jenis_dokumen || ''}_${(b.kategori_kerjasama || []).join(', ')}`;
          break;
        case 'value':
          valA = a.nilai_kontrak_usd ?? a.nilai_kontrak;
          valB = b.nilai_kontrak_usd ?? b.nilai_kontrak;
          break;
        case 'duration':
          valA = a.tanggal_selesai || a.tanggal_mulai || '';
          valB = b.tanggal_selesai || b.tanggal_mulai || '';
          break;
        case 'status':
          valA = a.status || '';
          valB = b.status || '';
          break;
        case 'document':
          valA = a.link_file_kontrak || '';
          valB = b.link_file_kontrak || '';
          break;
        default:
          return 0;
      }

      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortOrder === 'asc' ? valA - valB : valB - valA;
      }

      const res = String(valA || '').localeCompare(String(valB || ''), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      return sortOrder === 'asc' ? res : -res;
    });
  }, [filteredContracts, sortField, sortOrder, partnersById]);

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) setSelectedRows(sortedContracts.map(item => item.contract_id));
    else setSelectedRows([]);
  };

  const handleSelectRow = (id: string) => {
    setSelectedRows(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]);
  };

  const totalPages = Math.ceil(sortedContracts.length / rowsPerPage);
  const indexOfLast = currentPage * rowsPerPage;
  const indexOfFirst = indexOfLast - rowsPerPage;
  const currentContracts = sortedContracts.slice(indexOfFirst, indexOfLast);


  const renderSortHeader = (label: string, field: SortField) => {
    const isSorted = sortField === field;
    return (
      <TableColumnHeader
        scope="col"
        aria-sort={isSorted ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
        className="text-left align-middle"
       data-numeric={field === 'value'}>
        <Button variant="ghost" size="sm"
          type="button"
          onClick={() => handleSort(field)}
          title={t('contracts.urutkan_berdasarkan', 'Urutkan berdasarkan {label}', { label })}
        >
          <span>{label}</span>
          {isSorted ? (
            sortOrder === 'asc' ? (
              <ArrowUp className="w-3.5 h-3.5 text-accent-foreground shrink-0" />
            ) : (
              <ArrowDown className="w-3.5 h-3.5 text-accent-foreground shrink-0" />
            )
          ) : (
            <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          )}
        </Button>
      </TableColumnHeader>
    );
  };

  const handleExportCSV = () => {
    const headers = [
      'Jenis Dokumen',
      'Nomor Perjanjian',
      'Judul Perjanjian',
      'Induk Kontrak',
      'Partner',
      'Kategori Kerjasama',
      'Tanggal Mulai',
      'Tanggal Selesai',
      'Currency',
      'Nilai Kontrak',
      'Nilai Kontrak (USD)',
      'Status',
      'Sisa Hari',
      'PIC Internal',
      'Notice Period (Hari)',
      'Notice Type',
      'Link File / Drive',
    ];

    const rows = currentContracts.map((c) => {
      const partnerObj = partnersById.get(c.partner_id);
      const partnerName = c.partner_nama || partnerObj?.nama_partner || '-';
      return [
        c.jenis_dokumen || 'Master Agreement',
        c.nomor_kontrak,
        c.judul_kontrak,
        c.parent_contract_nomor || '-',
        partnerName,
        (c.kategori_kerjasama || []).join('; '),
        c.tanggal_mulai,
        c.tanggal_selesai,
        c.currency || '',
        c.nilai_kontrak,
        c.nilai_kontrak_usd ?? convertToUsdWithFallback(c.nilai_kontrak, c.currency || 'USD'),
        c.status,
        c.sisa_hari !== undefined ? c.sisa_hari : '',
        c.pic_internal,
        c.notice_period_hari,
        c.notice_type_required,
        c.link_file_kontrak || '',
      ];
    });

    const csvLines = [
      headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(','),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvLines], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Export_Agreement_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getStatusBadge = (status: Contract['status']) => {
    return statusTone(status);
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in-50 duration-200">
      {/* Header Bar */}
      <Card className="flex-row flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <Heading as="h2" size="lg" weight="semibold">
            <span>{t('contracts.title')}</span>
          </Heading>
        </div>

        <div className="contracts-mobile-actions flex flex-wrap items-center gap-2.5 shrink-0">
          {hasPermission('export.csv') && (
            <Button variant="outline"
              onClick={handleExportCSV}
              disabled={filteredContracts.length === 0}
              title={t('contracts.export_csv', 'Ekspor CSV')}
            >
              <Download className="w-4 h-4" />
              <span>{t('contracts.export_csv', 'Ekspor CSV')}</span>
            </Button>
          )}

          {canCreateContract(user) && (
            <Button
              onClick={onAddContract}
            >
              <Plus className="w-4 h-4" />
              <span>{t('ui.add_contract')}</span>
            </Button>
          )}
        </div>
      </Card>

      {/* Search and Filters */}
      {/* Search & Filters Bar - Justified Responsive Grid/Flex */}
      <Card className="p-4 sm:p-5">
        <div className="contracts-mobile-filters flex flex-wrap items-center gap-2.5 w-full">
          {/* Search Input */}
          <InputGroup className="relative flex-1 min-w-[200px] sm:min-w-[240px]">
            <InputGroupAddon><Search className="size-4" aria-hidden="true" /></InputGroupAddon>
            <InputGroupInput
              type="text"
              placeholder={t('contracts.search_placeholder')}
              aria-label={t('ui.search')}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
            />
          </InputGroup>
          {/* Jenis Dokumen Filter */}
          <AlphabeticalSelect
            aria-label={t('ui.filter_type')}
              value={selectedJenisDokumen}
            onChange={(e) => setSelectedJenisDokumen(e.target.value)}
            className="w-full" controlProps={{ className: "flex-1 min-w-[130px]" }}
          >
            <option value="ALL">{t('contracts.all_types')}</option>
            <option value="Master Agreement">{t('contracts.master_agreement', 'Master Agreement')}</option>
            <option value="Agreement Addendum">{t('contracts.agreement_addendum', 'Agreement Addendum')}</option>
          </AlphabeticalSelect>
          {/* Category Filter */}
          <AlphabeticalSelect
            aria-label={t('ui.filter_category')}
              value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full" controlProps={{ className: "flex-1 min-w-[130px]" }}
          >
            <option value="ALL">{t('contracts.all_categories')}</option>
            {allCategories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </AlphabeticalSelect>
          {/* Status Filter */}
          <AlphabeticalSelect
            aria-label={t('ui.filter_status')}
              value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="w-full" controlProps={{ className: "flex-1 min-w-[130px]" }}
          >
            <option value="ALL">{t('contracts.all_status')}</option>
            <option value="Active">{t('contracts.active')}</option>
            <option value="Expiring">{t('contracts.expiring')}</option>
            <option value="Expired">{t('contracts.expired')}</option>
            <option value="Terminated">{t('contracts.terminated')}</option>
          </AlphabeticalSelect>

          {/* Column Toggle */}
          <TableViewMenu title={t('io.view_settings', 'Pengaturan Tampilan Kolom')} label={t('io.view', 'View')}>
            <div className="px-3.5 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 border-b border-border">
              {t('io.toggle_columns', 'Toggle Kolom')}
            </div>
            {Object.keys(visibleColumns).map((col) => {
              let label = col;
              if (col === 'jenis_dokumen') label = t('contracts.col_doc_type', 'Jenis Dokumen');
              else if (col === 'nomor_kontrak') label = t('contracts.col_no', 'Nomor Kontrak');
              else if (col === 'judul_kontrak') label = t('contracts.col_title', 'Judul Kontrak');
              else if (col === 'partner') label = t('contracts.col_partner', 'Partner');
              else if (col === 'kategori') label = t('contracts.col_category', 'Kategori');
              else if (col === 'nilai') label = t('contracts.col_value', 'Nilai Kontrak');
              else if (col === 'tanggal_mulai') label = t('contracts.col_start_date', 'Tanggal Mulai');
              else if (col === 'tanggal_selesai') label = t('contracts.col_end_date', 'Tanggal Selesai');
              else if (col === 'status') label = t('contracts.col_status', 'Status');
              else if (col === 'file') label = t('contracts.col_document', 'File Dokumen');

              return (
                <TableViewOption key={col} value={col} checked={visibleColumns[col]} onToggle={() => toggleColumnVisibility(col)}>{label.replace(/_/g, ' ')}</TableViewOption>
              );
            })}
          </TableViewMenu>
      </div>
    </Card>

      {/* Contracts Data Table */}
      <Card className="overflow-hidden">
        <FilterSummary filters={[{ label: t('ui.search'), value: searchTerm, active: Boolean(searchTerm) }, { label: t('ui.filter_type'), value: selectedJenisDokumen, active: selectedJenisDokumen !== 'ALL' }, { label: t('ui.filter_category'), value: selectedCategory, active: selectedCategory !== 'ALL' }, { label: t('ui.filter_status'), value: selectedStatus, active: selectedStatus !== 'ALL' }]} onReset={() => { setSearchTerm(''); setSelectedJenisDokumen('ALL'); setSelectedCategory('ALL'); setSelectedStatus('ALL'); }} />
        <p className="mobile-table-hint px-4 py-2 text-xs text-muted-foreground md:hidden">{t('ui.scroll_table')}</p>
        <TableScrollArea className="data-table-scroll rounded-none border-0" tabIndex={0} role="region" aria-label={t('ui.scroll_table')}>
          <Table className="app-data-table w-full text-left">
            <TableHeader>
              <TableRow>
                <TableColumnHeader scope="col" className="w-12 text-left align-middle">
                  <div className="flex items-center justify-start">
                    <Checkbox checked={selectedRows.length > 0 && selectedRows.length === currentContracts.length} aria-label={t('contracts.select_all', 'Pilih semua kontrak')} onCheckedChange={(details) => handleSelectAll(details.checked === true)}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                  </div>
                </TableColumnHeader>
                {visibleColumns.jenis_dokumen && renderSortHeader(t('contracts.col_doc_type', 'Jenis'), 'doc_type')}
                {visibleColumns.nomor_kontrak && renderSortHeader(t('contracts.col_no', 'Agreement No.'), 'no')}
                {visibleColumns.judul_kontrak && (
                  <TableColumnHeader scope="col" className="text-left align-middle">{t('contracts.col_title', 'Judul')}</TableColumnHeader>
                )}
                {visibleColumns.partner && renderSortHeader(t('contracts.col_partner', 'Partner'), 'partner')}
                {visibleColumns.kategori && (
                  <TableColumnHeader scope="col" className="text-left align-middle">{t('contracts.col_category', 'Kategori')}</TableColumnHeader>
                )}
                {visibleColumns.nilai && renderSortHeader(t('contracts.col_value', 'Nilai'), 'value')}
                {visibleColumns.tanggal_mulai && (
                  <TableColumnHeader scope="col" className="text-left align-middle">{t('contracts.col_start_date', 'Tanggal Mulai')}</TableColumnHeader>
                )}
                {visibleColumns.tanggal_selesai && (
                  <TableColumnHeader scope="col" className="text-left align-middle">{t('contracts.col_end_date', 'Tanggal Selesai')}</TableColumnHeader>
                )}
                {visibleColumns.status && renderSortHeader(t('contracts.col_status', 'Status'), 'status')}
                {visibleColumns.file && (
                  <TableColumnHeader scope="col" className="text-left align-middle">{t('contracts.col_document', 'File')}</TableColumnHeader>
                )}
                <TableColumnHeader data-actions="true" scope="col" className="text-right w-20 align-middle">
                  <div className="flex items-center justify-end">{t('contracts.col_action', 'Aksi')}</div>
                </TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentContracts.length === 0 ? (
                <TableEmptyState colSpan={Object.values(visibleColumns).filter(Boolean).length + 2} />
              ) : (
                currentContracts.map((ctr) => {
                  const isAddendum = ctr.jenis_dokumen === 'Agreement Addendum';
                  const childAddendums = contracts.filter(
                    (c) => c.jenis_dokumen === 'Agreement Addendum' && c.parent_contract_id === ctr.contract_id
                  );
                  const ctrIOs = ios.filter((i) => i.contract_id === ctr.contract_id);

                  return (
                    <TableRow key={ctr.contract_id}>
                      <TableCell className="text-left align-middle">
                        <div className="flex items-center justify-start">
                          <Checkbox checked={selectedRows.includes(ctr.contract_id)} aria-label={t('contracts.pilih_kontrak', 'Pilih kontrak {nomor_kontrak}', { nomor_kontrak: ctr.nomor_kontrak })} onCheckedChange={() => handleSelectRow(ctr.contract_id)}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                        </div>
                      </TableCell>

                      {/* Jenis Dokumen */}
                      {visibleColumns.jenis_dokumen && (
                        <TableCell className="text-left">
                          {isAddendum ? (
                            <Badge tone={statusTone('Addendum')}>
                              {t('contracts.agreement_addendum', 'Agreement Addendum')}
                            </Badge>
                          ) : (
                            <Badge tone={statusTone('Active')}>
                              {t('contracts.master_agreement', 'Master Agreement')}
                            </Badge>
                          )}
                        </TableCell>
                      )}
                      {/* Nomor Kontrak */}
                      {visibleColumns.nomor_kontrak && (
                        <TableCell className="text-left">
                          {ctr.nomor_kontrak}
                        </TableCell>
                      )}
                      {/* Judul Kontrak */}
                      {visibleColumns.judul_kontrak && (
                        <TableCell className="text-left max-w-[200px]">
                          <span className="line-clamp-2" title={ctr.judul_kontrak}>{ctr.judul_kontrak}</span>
                        </TableCell>
                      )}

                      {/* 2. Partner */}
                      {visibleColumns.partner && (
                        <TableCell className="text-left">{ctr.partner_nama}</TableCell>
                      )}

                      {/* Kategori */}
                      {visibleColumns.kategori && (
                        <TableCell className="text-left">
                          <div className="flex flex-wrap gap-1">
                            {(ctr.kategori_kerjasama || []).map((cat) => (
                              <Badge
                                key={cat}
                                tone={statusTone('Neutral')}
                              >
                                {cat}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                      )}
                      {/* Nilai */}
                      {visibleColumns.nilai && (
                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                          {formatMoney(ctr.nilai_kontrak, ctr.currency)}
                        </TableCell>
                      )}

                      {/* Tanggal Mulai */}
                      {visibleColumns.tanggal_mulai && (
                        <TableCell className="text-left whitespace-nowrap">
                          {formatBusinessDate(ctr.tanggal_mulai)}
                        </TableCell>
                      )}
                      {/* Tanggal Selesai */}
                      {visibleColumns.tanggal_selesai && (
                        <TableCell className="text-left whitespace-nowrap">
                          {formatBusinessDate(ctr.tanggal_berakhir)}
                        </TableCell>
                      )}

                      {/* Status */}
                      {visibleColumns.status && (
                        <TableCell className="text-left whitespace-nowrap">
                          <Badge
                            tone={getStatusBadge(
 ctr.status
 )}
                          >
                            {t(`status.${(ctr.status || '').toLowerCase().replace(' ', '_')}`, ctr.status)}
                          </Badge>
                        </TableCell>
                      )}
                      {/* File */}
                      {visibleColumns.file && (
                        <TableCell className="text-left">
                          {ctr.link_file_kontrak ? (
                            <a
                              href={ctr.link_file_kontrak}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-accent-foreground hover:text-accent-foreground font-normal hover:underline"
                            >
                              <FileDown className="w-3.5 h-3.5" /> {t('contracts.pdf', 'PDF')}
                            </a>
                          ) : (
                            <span className="text-primary-foreground">-</span>
                          )}
                        </TableCell>
                      )}

                      {/* 6. Aksi */}
                      <TableCell data-actions="true" className="text-right align-middle w-20">
                        <div className="flex items-center justify-end">
                          <ActionMenu
                            items={[
                              {
                                label: t('io.action_detail', 'Detail'),
                                icon: <ExternalLink className="w-3.5 h-3.5" />,
                                onClick: () => setDetailContract(ctr),
                              },
                              {
                                label: t('contracts.action_redline', 'Redlining'),
                                icon: <Scale className="w-3.5 h-3.5" />,
                                onClick: () => setRedliningContract(ctr),
                              },
                              ...(canEditContract(ctr, partners, user)
                                ? [
                                    {
                                      label: t('hierarchy.edit_btn', 'Edit'),
                                      icon: <Edit2 className="w-3.5 h-3.5" />,
                                      onClick: () => onEditContract(ctr),
                                    },
                                  ]
                                : []),
                              ...(canDeletePartner(user)
                                ? [
                                    {
                                      label: t('io.action_delete', 'Hapus'),
                                      icon: <Trash2 className="w-3.5 h-3.5" />,
                                      onClick: () => onDeleteContract(ctr.contract_id),
                                      variant: 'danger' as const,
                                      dividerBefore: true,
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableScrollArea>

        <TablePagination
          currentPage={currentPage}
          totalPages={totalPages}
          rowsPerPage={rowsPerPage}
          onPageChange={setCurrentPage}
          onRowsPerPageChange={(size) => {
            setRowsPerPage(size);
            setCurrentPage(1);
          }}
        />
      </Card>

      {/* Contract Timeline Detail Modal */}
      {detailContract && (
        <ModalFrame onClose={() => setDetailContract(null)} className="max-w-4xl w-full max-h-[92dvh] flex flex-col overflow-hidden transition-colors">

            {/* Header */}
            <DialogHeader className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-accent-foreground" />
                  <span>{detailContract.nomor_kontrak}</span>
                </DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">{detailContract.judul_kontrak}</p>
              </div>

              <Button variant="secondary" size="icon-sm" aria-label={t('common.close', 'Tutup')}
                type="button"
                onClick={() => setDetailContract(null)}
              >
                <X className="w-5 h-5" />
              </Button>
            </DialogHeader>

            <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-xs flex-1">
              <ContractEndingSummary contract={detailContract} />
              <Card className="grid grid-cols-2 gap-3 p-3.5 bg-background">
                <div>
                  <span className="text-muted-foreground block">{t('contracts.jenis_dokumen', 'Jenis Dokumen:')}</span>
                  <span className="font-bold text-foreground">
                    {detailContract.jenis_dokumen || t('contracts.master_agreement', 'Master Agreement')}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">{t('contracts.partner', 'Partner:')}</span>
                  <span className="font-bold text-foreground">
                    {detailContract.partner_nama || partnersById.get(detailContract.partner_id)?.nama_partner || '-'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">{t('hierarchy.commercial_value', 'Nilai Komersial:')}</span>
                  <span className="font-bold text-accent-foreground">
                    {formatMoney(detailContract.nilai_kontrak, detailContract.currency)}
                    {(detailContract.currency || 'USD') !== 'USD' && (
                      <span className="text-muted-foreground text-xs font-mono ml-1.5 font-normal">
                        (≈ {formatMoney(detailContract.nilai_kontrak_usd, 'USD')})
                      </span>
                    )}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">{t('contracts.kewajiban_notice_period', 'Kewajiban Notice Period:')}</span>
                  <span className="font-semibold text-foreground">
                    {detailContract.notice_period_hari || 0} {t('contracts.hari', 'Hari (')}{detailContract.notice_type_required || '-'})
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">{t('contracts.status_perpanjangan_auto', 'Status Perpanjangan Auto:')}</span>
                  <span className="font-semibold text-foreground">
                    {detailContract.auto_renewal ? t('contracts.ya_auto_renewal', 'Ya (Auto Renewal)') : t('contracts.tidak_manual_notice', 'Tidak (Manual Notice)')}
                  </span>
                </div>
                {detailContract.jenis_dokumen === 'Agreement Addendum' && detailContract.parent_contract_nomor && (
                  <div>
                    <span className="text-muted-foreground block">{t('contracts.master_agreement_induk', 'Master Agreement Induk:')}</span>
                    <span className="font-bold text-status-special font-mono">
                      {detailContract.parent_contract_nomor}
                    </span>
                  </div>
                )}
                {detailContract.internal_notes && (
                  <Card className="col-span-1 md:col-span-2 p-3.5">
                    <span className="text-muted-foreground font-bold text-xs block mb-1.5 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-accent-foreground" />
                      {t('contracts.rangkuman_internal_notes_kontrak', 'Rangkuman / Internal Notes Kontrak:')}
                    </span>
                    <p className="text-foreground text-xs leading-relaxed whitespace-pre-line font-normal">
                      {detailContract.internal_notes}
                    </p>
                  </Card>
                )}
              </Card>

              {/* Child Agreement Addendums */}
              {detailContract.jenis_dokumen !== 'Agreement Addendum' && (
                <div>
                  <h4 className="font-bold text-status-special mb-2.5 text-xs uppercase tracking-wider flex items-center gap-1.5">
                    <Link2 className="w-4 h-4 text-status-special" />
                    <span>{t('contract.addendum_list', 'Daftar Agreement Addendum Turunan')}</span>
                  </h4>
                  {contracts.filter(
                    (c) => c.jenis_dokumen === 'Agreement Addendum' && c.parent_contract_id === detailContract.contract_id
                  ).length === 0 ? (
                    <Card className="p-3 text-muted-foreground text-center text-xs">
                      {t('contracts.belum_ada_agreement_addendum_turunan_untuk', 'Belum ada Agreement Addendum turunan untuk kontrak induk ini.')}
                    </Card>
                  ) : (
                    <div className="space-y-2">
                      {contracts
                        .filter(
                          (c) => c.jenis_dokumen === 'Agreement Addendum' && c.parent_contract_id === detailContract.contract_id
                        )
                        .map((add) => (
                          <div
                            key={add.contract_id}
                            className="p-3 bg-status-special-soft/70 border border-status-special-border rounded-xl flex items-center justify-between gap-3 hover:border-status-special-border transition-colors"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-status-special block font-mono text-xs tracking-tight">{add.nomor_kontrak}</span>
                                {add.status && (
                                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-status-special-soft text-status-special border border-status-special-border ">
                                    {add.status}
                                  </span>
                                )}
                              </div>
                              <span className="text-foreground text-xs block mt-0.5 truncate">{add.judul_kontrak}</span>
                              <span className="text-muted-foreground text-xs block mt-0.5">
                                {t('contracts.validity', 'Validity:')}{' '}
                                {formatBusinessDate(add.tanggal_mulai)}{' '}
                                -{' '}
                                {formatBusinessDate(add.tanggal_berakhir)}
                              </span>
                            </div>
                            {add.link_file_kontrak && (
                              <a
                                href={add.link_file_kontrak}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card text-status-special border border-status-special-border hover:bg-status-special-soft font-semibold text-xs transition-colors shrink-0 shadow-2xs"
                              >
                                <FileDown className="w-3.5 h-3.5" />
                                <span>{t('contracts.pdf', 'PDF')}</span>
                              </a>
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {/* Addendum Timeline (Track-Change) */}
              <div>
                <h4 className="font-bold text-status-special mb-2.5 text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <GitCommit className="w-4 h-4 text-status-special" />
                  <span>{t('contracts.histori_perubahan_amendment_track_change', 'Histori Perubahan (Amendment Track-Change)')}</span>
                </h4>

                {contracts.filter(
                  (a) => a.jenis_dokumen === 'Agreement Addendum' && a.parent_contract_id === detailContract.contract_id
                ).length === 0 ? (
                  <Card className="p-4 text-muted-foreground text-center">
                    {t('contracts.belum_ada_addendum_amendment_tercatat_untuk', 'Belum ada addendum/amendment tercatat untuk kontrak ini.')}
                  </Card>
                ) : (
                  <div className="space-y-3 relative border-l-2 border-status-special-border ml-3 pl-4 pt-1">
                    {contracts
                      .filter((a) => a.jenis_dokumen === 'Agreement Addendum' && a.parent_contract_id === detailContract.contract_id)
                      .map((add) => {
                        const fieldsChanged = Array.isArray(add.field_yang_berubah)
                          ? add.field_yang_berubah
                          : typeof add.field_yang_berubah === 'string' && (add.field_yang_berubah as string).trim().length > 0
                          ? (add.field_yang_berubah as string).split(',').map((s) => s.trim())
                          : [];

                        return (
                          <Card key={add.contract_id} className="relative p-3.5">
                            <span className="absolute -left-[23px] top-4 w-3 h-3 bg-status-special rounded-full border-2 border-white" />
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="font-bold text-status-special text-xs font-mono">{add.nomor_kontrak}</span>
                              <span className="text-xs text-muted-foreground font-mono">
                                {formatBusinessDate(add.tanggal_mulai)}
                              </span>
                            </div>
                            {fieldsChanged.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-2">
                                {fieldsChanged.map((f) => (
                                  <span key={f} className="bg-status-warning-soft text-status-warning border border-status-warning-border text-xs font-semibold px-2 py-0.5 rounded-md">
                                    {f}
                                  </span>
                                ))}
                              </div>
                            )}
                            {add.ringkasan_perubahan && (
                              <p className="text-foreground text-xs leading-relaxed bg-card p-2.5 rounded-lg border border-border font-mono text-xs whitespace-pre-wrap">
                                {add.ringkasan_perubahan}
                              </p>
                            )}
                          </Card>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Linked IOs */}
              <div>
                <h4 className="font-bold text-status-success mb-2.5 text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <FileSpreadsheet className="w-4 h-4 text-status-success" />
                  <span>{t('contracts.insertion_orders_io_turunan', 'Insertion Orders (IO) Turunan')}</span>
                </h4>

                {ios.filter((i) => i.contract_id === detailContract.contract_id).length === 0 ? (
                  <Card className="p-3 text-muted-foreground text-center text-xs">
                    {t('contracts.tidak_ada_io_turunan_di_bawah', 'Tidak ada IO turunan di bawah kontrak ini.')}
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {ios
                      .filter((i) => i.contract_id === detailContract.contract_id)
                      .map((io) => (
                        <Card key={io.io_id} className="p-3 flex items-center justify-between gap-3">
                          <div>
                            <div className="font-bold text-foreground text-xs font-mono">{io.nomor_io}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{io.judul_io}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-bold text-status-success text-xs">{formatMoney(Number(io.nilai_io) || 0, io.currency || io.mata_uang)}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{io.pricing_model || 'Fixed'} • {io.charging_type || '-'}</div>
                          </div>
                        </Card>
                      ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 sm:p-5 bg-card border-t border-border flex justify-end shrink-0">
              <Button variant="ghost" size="sm"
                onClick={() => setDetailContract(null)}
              >
                {t('io.detail_close', 'Tutup Detail')}
              </Button>
            </div>

        </ModalFrame>
      )}

      {/* AI Contract Risk & Compliance Analyzer (AI Redlining Modal) */}
      <ContractRedliningModal
        isOpen={Boolean(redliningContract)}
        contract={redliningContract}
        onClose={() => setRedliningContract(null)}
        onUpdateContract={(updatedContract) => {
          setRedliningContract(updatedContract);
          onUpdateContractData?.(updatedContract);
        }}
      />
    </div>
  );
};
