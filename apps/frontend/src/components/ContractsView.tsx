import { ModalFrame } from './ui/modal-frame';
import { BulkSelectionBar } from './ui/bulk-selection-bar';
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
import { Badge, BadgeDot, statusTone } from '@legalio/ui-components/badge';
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
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Text } from '@legalio/ui-components/text';
interface ContractsViewProps {
  contracts: Contract[];
  partners: Partner[];
    ios: InsertionOrder[];
  onAddContract: () => void;
  onEditContract: (contract: Contract) => void;
  onDeleteContract: (contractId: string) => void;
  onDeleteContracts: (ids: string[]) => Promise<void>;
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
  onDeleteContracts,
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
  const allCategories = useMemo(() => Array.from(new Set(contracts.flatMap(c => c.cooperation_categories || []))), [contracts]);
  const partnersById = useMemo(() => new Map(partners.map(partner => [partner.partner_id, partner])), [partners]);

  // Filter logic
  const filteredContracts = useMemo(() => contracts.filter((c) => {
    // 1. Department Scoping & RBAC restriction (based on internal PIC of partner)
    if (!canViewContract(c, partners, user)) {
      return false;
    }

    const jenis = c.document_type || 'Master Agreement';
    const matchJenis = selectedJenisDokumen === 'ALL' || jenis === selectedJenisDokumen;

    const matchSearch =
      c.contract_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.contract_title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (partnersById.get(c.partner_id)?.partner_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.internal_pic.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.parent_contract_number && c.parent_contract_number.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchCategory =
      selectedCategory === 'ALL' || (c.cooperation_categories && c.cooperation_categories.includes(selectedCategory));

    const matchStatus = selectedStatus === 'ALL' || c.status === selectedStatus;

    return matchJenis && matchSearch && matchCategory && matchStatus;
  }), [contracts, partners, partnersById, user, selectedJenisDokumen, selectedCategory, selectedStatus, searchTerm]);

  type SortField = 'no' | 'partner' | 'doc_type' | 'value' | 'duration' | 'status' | 'document';
  type SortOrder = 'asc' | 'desc';

  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const DEFAULT_CONTRACT_COLUMNS = {
    document_type: false,
    contract_number: true,
    contract_title: true,
    partner: true,
    kategori: false,
    nilai: true,
    start_date: false,
    completion_date: false,
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

      const getPartnerName = (c: Contract) => partnersById.get(c.partner_id)?.partner_name || '';

      switch (sortField) {
        case 'no':
          valA = a.contract_number;
          valB = b.contract_number;
          break;
        case 'partner':
          valA = getPartnerName(a);
          valB = getPartnerName(b);
          break;
        case 'doc_type':
          valA = `${a.document_type || ''}_${(a.cooperation_categories || []).join(', ')}`;
          valB = `${b.document_type || ''}_${(b.cooperation_categories || []).join(', ')}`;
          break;
        case 'value':
          valA = a.contract_value_usd ?? a.contract_value;
          valB = b.contract_value_usd ?? b.contract_value;
          break;
        case 'duration':
          valA = a.completion_date || a.start_date || '';
          valB = b.completion_date || b.start_date || '';
          break;
        case 'status':
          valA = a.status || '';
          valB = b.status || '';
          break;
        case 'document':
          valA = a.contract_file_link || '';
          valB = b.contract_file_link || '';
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
  const [rowsPerPage, setRowsPerPage] = useState(5);
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
       data-numeric={field === 'value'}>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" className="-ms-g13 font-semibold text-muted-foreground"
          type="button"
          onClick={() => handleSort(field)}
        >
          <span>{label}</span>
          {isSorted ? (
            sortOrder === 'asc' ? (
              <ArrowUp className="w-g13 h-g13 text-accent-foreground shrink-0" />
            ) : (
              <ArrowDown className="w-g13 h-g13 text-accent-foreground shrink-0" />
            )
          ) : (
            <ArrowUpDown className="w-g13 h-g13 text-muted-foreground shrink-0" />
          )}
        </Button></TooltipTrigger><TooltipBody>{t('contracts.urutkan_berdasarkan', 'Urutkan berdasarkan {label}', { label })}</TooltipBody></Tooltip>
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
      const partnerName = partnerObj?.partner_name || '-';
      return [
        c.document_type || 'Master Agreement',
        c.contract_number,
        c.contract_title,
        c.parent_contract_number || '-',
        partnerName,
        (c.cooperation_categories || []).join('; '),
        c.start_date,
        c.completion_date,
        c.currency || '',
        c.contract_value,
        c.contract_value_usd ?? convertToUsdWithFallback(c.contract_value, c.currency || 'USD'),
        c.status,
        c.days_remaining !== undefined ? c.days_remaining : '',
        c.internal_pic,
        c.notice_period_days,
        c.notice_type_required,
        c.contract_file_link || '',
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
    <div className="flex flex-col gap-g21 animate-in fade-in-50 duration-200">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-g13">
        <div>
          <Heading as="h2" size="md" weight="semibold">
            <span>{t('contracts.title')}</span>
          </Heading>
        </div>

        <div className="flex flex-wrap items-center gap-g8 shrink-0">
          {hasPermission('export.csv') && (
            <Tooltip><TooltipTrigger asChild><Button variant="outline"
              onClick={handleExportCSV}
              disabled={filteredContracts.length === 0} aria-label={t('contracts.export_csv', 'Ekspor CSV')}
            >
              <Download className="w-g16 h-g16" />
              <span>{t('contracts.export_csv', 'Ekspor CSV')}</span>
            </Button></TooltipTrigger><TooltipBody>{t('contracts.export_csv', 'Ekspor CSV')}</TooltipBody></Tooltip>
          )}

          {canCreateContract(user) && (
            <Button
              onClick={onAddContract}
            >
              <Plus className="w-g16 h-g16" />
              <span>{t('ui.add_contract')}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Search and Filters */}
      {/* Search & Filters Bar - Justified Responsive Grid/Flex */}
      <Card className="p-g13">
        <div className="flex w-full flex-wrap items-center gap-g13">
          {/* Search Input */}
          <InputGroup className="relative flex-1 min-w-g233 sm:min-w-g233">
            <InputGroupAddon><Search className="size-g16" aria-hidden="true" /></InputGroupAddon>
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
            className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
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
            className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
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
            className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
          >
            <option value="ALL">{t('contracts.all_status')}</option>
            <option value="Active">{t('contracts.active')}</option>
            <option value="Expiring">{t('contracts.expiring')}</option>
            <option value="Expired">{t('contracts.expired')}</option>
            <option value="Terminated">{t('contracts.terminated')}</option>
          </AlphabeticalSelect>

          {/* Column Toggle */}
          <TableViewMenu title={t('io.view_settings', 'Pengaturan Tampilan Kolom')} label={t('io.view', 'View')}>
            {Object.keys(visibleColumns).map((col) => {
              let label = col;
              if (col === 'document_type') label = t('contracts.col_doc_type', 'Jenis Dokumen');
              else if (col === 'contract_number') label = t('contracts.col_no', 'Nomor Kontrak');
              else if (col === 'contract_title') label = t('contracts.col_title', 'Judul Kontrak');
              else if (col === 'partner') label = t('contracts.col_partner', 'Partner');
              else if (col === 'kategori') label = t('contracts.col_category', 'Kategori');
              else if (col === 'nilai') label = t('contracts.col_value', 'Nilai Kontrak');
              else if (col === 'start_date') label = t('contracts.col_start_date', 'Tanggal Mulai');
              else if (col === 'completion_date') label = t('contracts.col_end_date', 'Tanggal Selesai');
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
      {canDeletePartner(user) && (
        <BulkSelectionBar
          count={selectedRows.length}
          noun={t('bulk.noun_contract', 'kontrak')}
          onDelete={async () => { await onDeleteContracts(selectedRows); setSelectedRows([]); }}
        />
      )}
      <Card className="overflow-hidden">
        <FilterSummary filters={[{ label: t('ui.search'), value: searchTerm, active: Boolean(searchTerm) }, { label: t('ui.filter_type'), value: selectedJenisDokumen, active: selectedJenisDokumen !== 'ALL' }, { label: t('ui.filter_category'), value: selectedCategory, active: selectedCategory !== 'ALL' }, { label: t('ui.filter_status'), value: selectedStatus, active: selectedStatus !== 'ALL' }]} onReset={() => { setSearchTerm(''); setSelectedJenisDokumen('ALL'); setSelectedCategory('ALL'); setSelectedStatus('ALL'); }} />
        <Text size="xs" tone="muted" className="px-g13 py-g8 md:hidden">{t('ui.scroll_table')}</Text>
        <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.scroll_table')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableColumnHeader scope="col" className="w-g42">
                  <div className="flex items-center justify-start">
                    <Checkbox checked={selectedRows.length > 0 && selectedRows.length === currentContracts.length} aria-label={t('contracts.select_all', 'Pilih semua kontrak')} onCheckedChange={(details) => handleSelectAll(details.checked === true)}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                  </div>
                </TableColumnHeader>
                {visibleColumns.document_type && renderSortHeader(t('contracts.col_doc_type', 'Jenis'), 'doc_type')}
                {visibleColumns.contract_number && renderSortHeader(t('contracts.col_no', 'Agreement No.'), 'no')}
                {visibleColumns.contract_title && (
                  <TableColumnHeader scope="col">{t('contracts.col_title', 'Judul')}</TableColumnHeader>
                )}
                {visibleColumns.partner && renderSortHeader(t('contracts.col_partner', 'Partner'), 'partner')}
                {visibleColumns.kategori && (
                  <TableColumnHeader scope="col">{t('contracts.col_category', 'Kategori')}</TableColumnHeader>
                )}
                {visibleColumns.nilai && renderSortHeader(t('contracts.col_value', 'Nilai'), 'value')}
                {visibleColumns.start_date && (
                  <TableColumnHeader scope="col">{t('contracts.col_start_date', 'Tanggal Mulai')}</TableColumnHeader>
                )}
                {visibleColumns.completion_date && (
                  <TableColumnHeader scope="col">{t('contracts.col_end_date', 'Tanggal Selesai')}</TableColumnHeader>
                )}
                {visibleColumns.status && renderSortHeader(t('contracts.col_status', 'Status'), 'status')}
                {visibleColumns.file && (
                  <TableColumnHeader scope="col">{t('contracts.col_document', 'File')}</TableColumnHeader>
                )}
                <TableColumnHeader data-actions="true" scope="col" className="text-right w-g89">
                  <div className="flex items-center justify-end">{t('contracts.col_action', 'Aksi')}</div>
                </TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentContracts.length === 0 ? (
                <TableEmptyState colSpan={Object.values(visibleColumns).filter(Boolean).length + 2} />
              ) : (
                currentContracts.map((ctr) => {
                  const isAddendum = ctr.document_type === 'Agreement Addendum';
                  const childAddendums = contracts.filter(
                    (c) => c.document_type === 'Agreement Addendum' && c.parent_contract_id === ctr.contract_id
                  );
                  const ctrIOs = ios.filter((i) => i.contract_id === ctr.contract_id);

                  return (
                    <TableRow key={ctr.contract_id}>
                      <TableCell>
                        <div className="flex items-center justify-start">
                          <Checkbox checked={selectedRows.includes(ctr.contract_id)} aria-label={t('contracts.pilih_kontrak', 'Pilih kontrak {contract_number}', { contract_number: ctr.contract_number })} onCheckedChange={() => handleSelectRow(ctr.contract_id)}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                        </div>
                      </TableCell>

                      {/* Jenis Dokumen */}
                      {visibleColumns.document_type && (
                        <TableCell>
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
                      {visibleColumns.contract_number && (
                        <TableCell>
                          {ctr.contract_number}
                        </TableCell>
                      )}
                      {/* Judul Kontrak */}
                      {visibleColumns.contract_title && (
                        <TableCell className="max-w-g233">
                          <Tooltip><TooltipTrigger asChild><span className="block truncate">{ctr.contract_title}</span></TooltipTrigger><TooltipBody>{ctr.contract_title}</TooltipBody></Tooltip>
                        </TableCell>
                      )}

                      {/* 2. Partner */}
                      {visibleColumns.partner && (
                        <TableCell>{partnersById.get(ctr.partner_id)?.partner_name || '-'}</TableCell>
                      )}

                      {/* Kategori */}
                      {visibleColumns.kategori && (
                        <TableCell>
                          <div className="flex flex-wrap gap-g3">
                            {(ctr.cooperation_categories || []).map((cat) => (
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
                          {formatMoney(ctr.contract_value, ctr.currency)}
                        </TableCell>
                      )}

                      {/* Tanggal Mulai */}
                      {visibleColumns.start_date && (
                        <TableCell className="whitespace-nowrap">
                          {formatBusinessDate(ctr.start_date)}
                        </TableCell>
                      )}
                      {/* Tanggal Selesai */}
                      {visibleColumns.completion_date && (
                        <TableCell className="whitespace-nowrap">
                          {formatBusinessDate(ctr.end_date)}
                        </TableCell>
                      )}

                      {/* Status */}
                      {visibleColumns.status && (
                        <TableCell className="whitespace-nowrap">
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
                        <TableCell>
                          {ctr.contract_file_link ? (
                            <Button asChild variant="link"><a href={ctr.contract_file_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              
                            >
                              <FileDown className="w-g13 h-g13" /> {t('contracts.pdf', 'PDF')}
                            </a></Button>
                          ) : (
                            <span className="text-primary-foreground">-</span>
                          )}
                        </TableCell>
                      )}

                      {/* 6. Aksi */}
                      <TableCell data-actions="true" className="text-right w-g89">
                        <div className="flex items-center justify-end">
                          <ActionMenu
                            items={[
                              {
                                label: t('io.action_detail', 'Detail'),
                                icon: <ExternalLink className="w-g13 h-g13" />,
                                onClick: () => setDetailContract(ctr),
                              },
                              {
                                label: t('contracts.action_redline', 'Redlining'),
                                icon: <Scale className="w-g13 h-g13" />,
                                onClick: () => setRedliningContract(ctr),
                              },
                              ...(canEditContract(ctr, partners, user)
                                ? [
                                    {
                                      label: t('hierarchy.edit_btn', 'Edit'),
                                      icon: <Edit2 className="w-g13 h-g13" />,
                                      onClick: () => onEditContract(ctr),
                                    },
                                  ]
                                : []),
                              ...(canDeletePartner(user)
                                ? [
                                    {
                                      label: t('io.action_delete', 'Hapus'),
                                      icon: <Trash2 className="w-g13 h-g13" />,
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
        <ModalFrame onClose={() => setDetailContract(null)} className="max-w-g987 w-full flex flex-col overflow-hidden transition-colors">

            {/* Header */}
            <DialogHeader className="flex items-center justify-between gap-g13 border-b border-border px-g21 py-g13">
              <div>
                <DialogTitle className="flex items-center gap-g8">
                  <FileText className="w-g21 h-g21 text-accent-foreground" />
                  <span>{detailContract.contract_number}</span>
                </DialogTitle>
                <Text size="xs" tone="muted" className="mt-g2">{detailContract.contract_title}</Text>
              </div>

              <Button variant="secondary" size="icon-sm" aria-label={t('common.close', 'Tutup')}
                type="button"
                onClick={() => setDetailContract(null)}
              >
                <X className="w-g21 h-g21" />
              </Button>
            </DialogHeader>

            <div className="p-g21 sm:p-g21 overflow-y-auto space-y-g13 text-xs flex-1">
              <ContractEndingSummary contract={detailContract} />
              <Card className="grid grid-cols-2 gap-g13 p-g13 bg-background">
                <div>
                  <span className="text-muted-foreground block">{t('contracts.document_type', 'Jenis Dokumen:')}</span>
                  <span className="font-bold text-foreground">
                    {detailContract.document_type || t('contracts.master_agreement', 'Master Agreement')}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">{t('contracts.partner', 'Partner:')}</span>
                  <span className="font-bold text-foreground">
                    {partnersById.get(detailContract.partner_id)?.partner_name || '-'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">{t('hierarchy.commercial_value', 'Nilai Komersial:')}</span>
                  <span className="font-bold text-accent-foreground">
                    {formatMoney(detailContract.contract_value, detailContract.currency)}
                    {(detailContract.currency || 'USD') !== 'USD' && (
                      <Text as="span" size="xs" tone="muted" className="font-mono ml-g5">
                        (≈ {formatMoney(detailContract.contract_value_usd, 'USD')})
                      </Text>
                    )}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">{t('contracts.kewajiban_notice_period', 'Kewajiban Notice Period:')}</span>
                  <span className="font-semibold text-foreground">
                    {detailContract.notice_period_days || 0} {t('contracts.hari', 'Hari (')}{detailContract.notice_type_required || '-'})
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">{t('contracts.status_perpanjangan_auto', 'Status Perpanjangan Auto:')}</span>
                  <span className="font-semibold text-foreground">
                    {detailContract.auto_renewal ? t('contracts.ya_auto_renewal', 'Ya (Auto Renewal)') : t('contracts.tidak_manual_notice', 'Tidak (Manual Notice)')}
                  </span>
                </div>
                {detailContract.document_type === 'Agreement Addendum' && detailContract.parent_contract_number && (
                  <div>
                    <span className="text-muted-foreground block">{t('contracts.master_agreement_induk', 'Master Agreement Induk:')}</span>
                    <span className="font-bold text-status-special font-mono">
                      {detailContract.parent_contract_number}
                    </span>
                  </div>
                )}
                {detailContract.internal_notes && (
                  <Card className="col-span-1 md:col-span-2 p-g13">
                    <Text as="span" size="xs" weight="bold" tone="muted" className="block mb-g5 flex items-center gap-g5">
                      <FileText className="w-g13 h-g13 text-accent-foreground" />
                      {t('contracts.rangkuman_internal_notes_kontrak', 'Rangkuman / Internal Notes Kontrak:')}
                    </Text>
                    <Text size="xs" className="leading-relaxed whitespace-pre-line">
                      {detailContract.internal_notes}
                    </Text>
                  </Card>
                )}
              </Card>

              {/* Child Agreement Addendums */}
              {detailContract.document_type !== 'Agreement Addendum' && (
                <div>
                  <Heading as="h4" size="xs" weight="bold" className="text-status-special mb-g8 uppercase tracking-wider flex items-center gap-g5">
                    <Link2 className="w-g16 h-g16 text-status-special" />
                    <span>{t('contract.addendum_list', 'Daftar Agreement Addendum Turunan')}</span>
                  </Heading>
                  {contracts.filter(
                    (c) => c.document_type === 'Agreement Addendum' && c.parent_contract_id === detailContract.contract_id
                  ).length === 0 ? (
                    <Card className="p-g13 text-muted-foreground text-center text-xs">
                      {t('contracts.belum_ada_agreement_addendum_turunan_untuk', 'Belum ada Agreement Addendum turunan untuk kontrak induk ini.')}
                    </Card>
                  ) : (
                    <div className="space-y-g8">
                      {contracts
                        .filter(
                          (c) => c.document_type === 'Agreement Addendum' && c.parent_contract_id === detailContract.contract_id
                        )
                        .map((add) => (
                          <div
                            key={add.contract_id}
                            className="p-g13 bg-status-special-soft/70 border border-status-special-border rounded-xl flex items-center justify-between gap-g13 hover:border-status-special-border transition-colors"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-g8 flex-wrap">
                                <span className="font-bold text-status-special block font-mono text-xs tracking-tight">{add.contract_number}</span>
                                {add.status && (
                                  <Badge tone="special">{add.status}</Badge>
                                )}
                              </div>
                              <Text as="span" size="xs" truncate className="block mt-g2">{add.contract_title}</Text>
                              <Text as="span" size="xs" tone="muted" className="block mt-g2">
                                {t('contracts.validity', 'Validity:')}{' '}
                                {formatBusinessDate(add.start_date)}{' '}
                                -{' '}
                                {formatBusinessDate(add.end_date)}
                              </Text>
                            </div>
                            {add.contract_file_link && (
                              <Button asChild variant="outline" size="sm" className="shrink-0"><a href={add.contract_file_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                
                              >
                                <FileDown className="w-g13 h-g13" />
                                <span>{t('contracts.pdf', 'PDF')}</span>
                              </a></Button>
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {/* Addendum Timeline (Track-Change) */}
              <div>
                <Heading as="h4" size="xs" weight="bold" className="text-status-special mb-g8 uppercase tracking-wider flex items-center gap-g5">
                  <GitCommit className="w-g16 h-g16 text-status-special" />
                  <span>{t('contracts.histori_perubahan_amendment_track_change', 'Histori Perubahan (Amendment Track-Change)')}</span>
                </Heading>

                {contracts.filter(
                  (a) => a.document_type === 'Agreement Addendum' && a.parent_contract_id === detailContract.contract_id
                ).length === 0 ? (
                  <Card className="p-g13 text-muted-foreground text-center">
                    {t('contracts.belum_ada_addendum_amendment_tercatat_untuk', 'Belum ada addendum/amendment tercatat untuk kontrak ini.')}
                  </Card>
                ) : (
                  <div className="space-y-g13 relative border-l-2 border-status-special-border ml-g13 pl-g13 pt-g3">
                    {contracts
                      .filter((a) => a.document_type === 'Agreement Addendum' && a.parent_contract_id === detailContract.contract_id)
                      .map((add) => {
                        const fieldsChanged = Array.isArray(add.changed_fields)
                          ? add.changed_fields
                          : typeof add.changed_fields === 'string' && (add.changed_fields as string).trim().length > 0
                          ? (add.changed_fields as string).split(',').map((s) => s.trim())
                          : [];

                        return (
                          <Card key={add.contract_id} className="relative p-g13">
                            <BadgeDot className="size-g13 absolute -left-g26 top-g16 text-status-special border-2 border-card" />
                            <div className="flex items-center justify-between mb-g5">
                              <span className="font-bold text-status-special text-xs font-mono">{add.contract_number}</span>
                              <Text as="span" size="xs" tone="muted" className="font-mono">
                                {formatBusinessDate(add.start_date)}
                              </Text>
                            </div>
                            {fieldsChanged.length > 0 && (
                              <div className="flex flex-wrap gap-g3 mb-g8">
                                {fieldsChanged.map((f) => (
                                  <Badge key={f} tone="warning">{f}</Badge>
                                ))}
                              </div>
                            )}
                            {add.change_summary && (
                              <Card asChild><Text size="xs" className="leading-relaxed p-g8 font-mono whitespace-pre-wrap">
                                {add.change_summary}
                              </Text></Card>
                            )}
                          </Card>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Linked IOs */}
              <div>
                <Heading as="h4" size="xs" weight="bold" className="text-status-success mb-g8 uppercase tracking-wider flex items-center gap-g5">
                  <FileSpreadsheet className="w-g16 h-g16 text-status-success" />
                  <span>{t('contracts.insertion_orders_io_turunan', 'Insertion Orders (IO) Turunan')}</span>
                </Heading>

                {ios.filter((i) => i.contract_id === detailContract.contract_id).length === 0 ? (
                  <Card className="p-g13 text-muted-foreground text-center text-xs">
                    {t('contracts.tidak_ada_io_turunan_di_bawah', 'Tidak ada IO turunan di bawah kontrak ini.')}
                  </Card>
                ) : (
                  <div className="space-y-g8">
                    {ios
                      .filter((i) => i.contract_id === detailContract.contract_id)
                      .map((io) => (
                        <Card key={io.io_id} className="p-g13 flex items-center justify-between gap-g13">
                          <div>
                            <div className="font-bold text-foreground text-xs font-mono">{io.io_number}</div>
                            <div className="text-xs text-muted-foreground mt-g2">{io.io_title}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-bold text-status-success text-xs">{formatMoney(Number(io.io_value) || 0, io.currency)}</div>
                            <div className="text-xs text-muted-foreground mt-g2">{io.pricing_model || 'Fixed'} • {io.charging_type || '-'}</div>
                          </div>
                        </Card>
                      ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-g13 sm:p-g21 bg-card border-t border-border flex justify-end shrink-0">
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
        partnerName={partnersById.get(redliningContract?.partner_id || '')?.partner_name}
        onClose={() => setRedliningContract(null)}
        onUpdateContract={(updatedContract) => {
          setRedliningContract(updatedContract);
          onUpdateContractData?.(updatedContract);
        }}
      />
    </div>
  );
};
