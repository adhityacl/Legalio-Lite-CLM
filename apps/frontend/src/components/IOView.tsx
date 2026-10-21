import { ModalFrame } from './ui/modal-frame';
import { BulkSelectionBar } from './ui/bulk-selection-bar';
import { TableViewMenu, TableViewOption } from './ui/table-view-menu';
import { AlphabeticalSelect } from './ui/alphabetical-select';
import { formatBusinessDate } from '../lib/displayDate';
import { sortServiceOrders, type ServiceOrderSortField, type SortOrder } from '../lib/serviceOrderSort';
import { FilterSummary } from './ui/filter-summary';
import { TableEmptyState } from './ui/table-empty-state';
import React, { useState, useMemo, useEffect } from 'react';
import { CONTRACT_STATUS_LABEL_KEY, DD_STATUS_LABEL_KEY, DOC_STATUS_LABEL_KEY } from '@legalio/types/domainStatus';
import { InsertionOrder, Contract, Partner, PRICING_MODELS } from '@legalio/types';
import { formatMoney } from '@legalio/shared/currencyUtils';
import { FileDown, FileSpreadsheet,
  Search,
  Plus,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Download,
  ExternalLink,
  Edit2,
  Trash2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  MoreHorizontal,
  X,
  Building2,
  Eye,
  HelpCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import {
  canViewIO,
  canEditIO,
  canCreateIO,
  canDeletePartner,
} from '../lib/rbacScoping';
import { cn } from '@legalio/ui-components/utils';
import { Badge, statusTone } from '@legalio/ui-components/badge';
import { getSavedColumnPreferences, saveColumnPreferences, useRowsPerPage } from '../lib/tablePreferences';
import { Button } from '@legalio/ui-components/button';
import { ActionMenu } from './ui/action-menu';
import { TablePagination } from './ui/TablePagination';
import { usePermissions } from '../lib/permissions';

import { TableColumnHeader, Table, TableHeader, TableRow, TableBody, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { DialogHeader, DialogTitle } from '@legalio/ui-components/dialog';
import { Checkbox, CheckboxControl, CheckboxHiddenInput } from '@legalio/ui-components/checkbox';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Text } from '@legalio/ui-components/text';
interface IOViewProps {
  ios: InsertionOrder[];
  contracts: Contract[];
  partners: Partner[];
  onAddIO: () => void;
  onEditIO: (io: InsertionOrder) => void;
  onDeleteIO: (ioId: string) => void;
  onDeleteIOs: (ids: string[]) => Promise<void>;
  openDocumentId?: string;
  onDocumentOpened?: () => void;
}

export const IOView: React.FC<IOViewProps> = ({
  ios,
  contracts,
  partners,
  onAddIO,
  onEditIO,
  onDeleteIO,
  onDeleteIOs,
  openDocumentId,
  onDocumentOpened,
}) => {
  const { user, isLegal, isAdmin } = useAuth();
  const { hasPermission } = usePermissions();
  const { t, language } = useLanguage();

  // Search & Filters State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedPricingModel, setSelectedPricingModel] = useState<string>('ALL');
  const [selectedChargingType, setSelectedChargingType] = useState<string>('ALL');

  // Row selection & Pagination State
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useRowsPerPage('io');

  // Sorting State
  type SortField = ServiceOrderSortField;
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Detail Modal State
  const [detailIO, setDetailIO] = useState<InsertionOrder | null>(null);
  useEffect(() => {
    if (!openDocumentId) return;
    const io = ios.find(item => item.io_id === openDocumentId);
    if (io && hasPermission('document.view') && canViewIO(io, partners, user)) setDetailIO(io);
    onDocumentOpened?.();
  }, [openDocumentId, ios, partners, user, hasPermission, onDocumentOpened]);

  // Action Menu State
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

  const DEFAULT_IO_COLUMNS = {
    nomor: true,
    judul: true,
    partner: true,
    kanal: true,
    nilai: false,
    pricing_model: false,
    payment_scheme: false,
    start_date: true,
    completion_date: true,
    status: false,
    file: true,
  };

  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() =>
    getSavedColumnPreferences('io', DEFAULT_IO_COLUMNS)
  );


  const toggleColumnVisibility = (id: string) => {
    setVisibleColumns((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveColumnPreferences('io', next);
      return next;
    });
  };

  // Standard models plus any legacy/custom value still stored on existing orders.
  const pricingFilterOptions = useMemo(
    () => [...new Set([...PRICING_MODELS, ...ios.map((i) => i.pricing_model).filter(Boolean)])],
    [ios],
  );

  const partnerNameOf = (id: string) => partners.find((p) => p.partner_id === id)?.partner_name || '';

  // Filtering Logic
  const filteredIOs = useMemo(() => {
    return ios.filter((i) => {
      // 1. Department Scoping & RBAC restriction (based on internal PIC of partner)
      if (!canViewIO(i, partners, user)) {
        return false;
      }

      const matchSearch =
        searchTerm === '' ||
        i.io_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
        i.io_title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        partnerNameOf(i.partner_id).toLowerCase().includes(searchTerm.toLowerCase()) ||
        (i.media_channel && i.media_channel.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchStatus = selectedStatus === 'ALL' || i.status === selectedStatus;
      const matchPricing = selectedPricingModel === 'ALL' || (i.pricing_model) === selectedPricingModel;
      const matchCharging = selectedChargingType === 'ALL' || (i.charging_type || i.payment_scheme) === selectedChargingType;

      return matchSearch && matchStatus && matchPricing && matchCharging;
    });
  }, [ios, partners, user, searchTerm, selectedStatus, selectedPricingModel, selectedChargingType]);

  // Sorting Logic
  const sortedIOs = useMemo(
    () => (sortField ? sortServiceOrders(filteredIOs, sortField, sortOrder, partnerNameOf) : filteredIOs),
    [filteredIOs, sortField, sortOrder, partners],
  );

  // Paginated Slices
  const pageCount = Math.ceil(sortedIOs.length / pageSize);
  const paginatedIOs = useMemo(() => {
    const start = pageIndex * pageSize;
    return sortedIOs.slice(start, start + pageSize);
  }, [sortedIOs, pageIndex, pageSize]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortOrder === 'asc') setSortOrder('desc');
      else setSortField(null);
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

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
        </Button></TooltipTrigger><TooltipBody>{t('io.urutkan_berdasarkan', 'Urutkan berdasarkan {label}', { label })}</TooltipBody></Tooltip>
      </TableColumnHeader>
    );
  };

  const isFiltered =
    searchTerm !== '' ||
    selectedStatus !== 'ALL' ||
    selectedPricingModel !== 'ALL' ||
    selectedChargingType !== 'ALL';

  const resetFilters = () => {
    setSearchTerm('');
    setSelectedStatus('ALL');
    setSelectedPricingModel('ALL');
    setSelectedChargingType('ALL');
    setPageIndex(0);
  };

  // Row selection handlers
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = new Set(paginatedIOs.map((i) => i.io_id));
      setSelectedRowIds(allIds);
    } else {
      setSelectedRowIds(new Set());
    }
  };

  const handleSelectRow = (id: string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isAllSelected =
    paginatedIOs.length > 0 && paginatedIOs.every((i) => selectedRowIds.has(i.io_id));

  // CSV Export
  const handleExportCSV = () => {
    const dataToExport =
      selectedRowIds.size > 0 ? ios.filter((i) => selectedRowIds.has(i.io_id)) : sortedIOs;

    const headers = [
      'Nomor IO',
      'Judul IO',
      'Induk Kontrak',
      'Partner / Vendor',
      'Kanal Media / Placement',
      'Pricing Model',
      'Charging Type',
      'Tanggal Mulai',
      'Tanggal Selesai',
      'Currency',
      'Nilai IO',
      'Status',
      'Deliverables',
      'Link File / Drive',
    ];

    const rows = dataToExport.map((i) => {
      return [
        i.io_number,
        i.io_title,
        i.contract_id || '-',
        partnerNameOf(i.partner_id) || '-',
        i.media_channel || '-',
        i.pricing_model || '-',
        i.payment_scheme || '-',
        i.start_date,
        i.end_date || i.completion_date || '-',
        i.currency || '',
        i.io_value,
        i.status,
        i.deliverables || '-',
        i.io_file_link || '',
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
    a.download = `Export_IO_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-g21 animate-in fade-in-50 duration-200">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-g13">
        <div>
          <Heading as="h2" size="md" weight="semibold">
            <span>{t('io.title', 'Insertion Order Management')}</span>
          </Heading>
        </div>

        <div className="flex flex-wrap items-center gap-g8 shrink-0">
          {hasPermission('export.csv') && (
            <Tooltip><TooltipTrigger asChild><Button variant="outline"
              onClick={handleExportCSV}
              disabled={filteredIOs.length === 0} aria-label={t('io.export_csv', 'Ekspor CSV')}
            >
              <Download className="w-g16 h-g16" />
              <span>{t('io.export_csv', 'Ekspor CSV')}</span>
            </Button></TooltipTrigger><TooltipBody>{t('io.export_csv', 'Ekspor CSV')}</TooltipBody></Tooltip>
          )}

          {canCreateIO(user) && (
            <Button
              onClick={onAddIO}
            >
              <Plus className="w-g16 h-g16" />
              <span>{t('ui.add_io')}</span>
            </Button>
          )}
        </div>
      </div>

      {/* DataTable Toolbar - Justified Responsive Grid/Flex */}
      <Card className="p-g13">
        <div className="flex w-full flex-wrap items-center gap-g13">
          {/* Search Input */}
          <InputGroup className="relative flex-1 min-w-g233 sm:min-w-g233">
            <InputGroupAddon><Search className="size-g16" aria-hidden="true" /></InputGroupAddon>
            <InputGroupInput
              type="text"
              placeholder={t('io.search_ph', 'Cari insertion orders...')}
              aria-label={t('ui.search')}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPageIndex(0);
              }}
            />
          </InputGroup>

          {/* Simple Select Filter: Status */}
          <AlphabeticalSelect
            aria-label={t('ui.filter_status')}
              value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
          >
            <option value="ALL">{t('io.all_status', 'Semua Status')}</option>
            <option value="Berjalan">{t('io.status_berjalan', 'Berjalan')}</option>
            <option value="Selesai">{t('io.status_selesai', 'Selesai')}</option>
            <option value="Draft">{t('io.status_draft', 'Draft')}</option>
            <option value="Dibatalkan">{t('io.status_dibatalkan', 'Dibatalkan')}</option>
          </AlphabeticalSelect>

          {/* Simple Select Filter: Pricing Model */}
          <AlphabeticalSelect
            aria-label={t('ui.filter_pricing')}
              value={selectedPricingModel}
            onChange={(e) => setSelectedPricingModel(e.target.value)}
            className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
          >
            <option value="ALL">{t('io.all_pricing_models', 'Semua Model Pricing')}</option>
            {pricingFilterOptions.map((model) => <option key={model} value={model}>{model}</option>)}
          </AlphabeticalSelect>

          {/* Simple Select Filter: Charging Scheme */}
          <AlphabeticalSelect
            aria-label={t('ui.filter_charging')}
              value={selectedChargingType}
            onChange={(e) => setSelectedChargingType(e.target.value)}
            className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
          >
            <option value="ALL">{t('io.all_charging_types', 'Semua Skema Pembayaran')}</option>
            <option value="Prepaid">{t('io.prepaid', 'Prepaid')}</option>
            <option value="Postpaid">{t('io.postpaid', 'Postpaid')}</option>
            <option value="Milestone">{t('io.milestone', 'Milestone')}</option>
          </AlphabeticalSelect>

          {/* Reset Filters */}
          {isFiltered && (
            <Button
              variant="ghost"
              onClick={resetFilters}
            >
              {t('common.reset', 'Reset')}
              <X className="ml-g5 h-g13 w-g13" />
            </Button>
          )}

          {/* Column Toggle */}
          <TableViewMenu title={t('io.view_settings', 'Pengaturan Tampilan Kolom')} label={t('io.view', 'View')}>
            {Object.keys(visibleColumns)
              .filter((col) => col !== 'detail_pembayaran')
              .map((col) => {
              let label = col;
              if (col === 'nomor') label = t('io.col_no', 'Nomor IO');
              else if (col === 'judul') label = t('io.col_title', 'Judul IO');
              else if (col === 'partner') label = t('io.col_partner', 'Partner');
              else if (col === 'kanal') label = t('io.col_channel', 'Kanal Media');
              else if (col === 'nilai') label = t('io.col_value', 'Nilai Order');
              else if (col === 'pricing_model') label = t('io.col_pricing_model', 'Model Pembayaran');
              else if (col === 'payment_scheme') label = t('io.col_charging_type', 'Skema Pembayaran');
              else if (col === 'start_date') label = t('io.col_start_date', 'Tanggal Mulai');
              else if (col === 'completion_date') label = t('io.col_end_date', 'Tanggal Selesai');
              else if (col === 'status') label = t('io.col_status', 'Status');
              else if (col === 'file') label = t('io.col_document', 'Document');

              return (
                <TableViewOption key={col} value={col} checked={visibleColumns[col]} onToggle={() => toggleColumnVisibility(col)}>{label}</TableViewOption>
              );
            })}
          </TableViewMenu>
        </div>
      </Card>

      {/* DataTable Container */}
      {canDeletePartner(user) && (
        <BulkSelectionBar
          count={selectedRowIds.size}
          noun={t('bulk.noun_io', 'IO')}
          onDelete={async () => { await onDeleteIOs([...selectedRowIds]); setSelectedRowIds(new Set()); }}
        />
      )}
      <Card className="overflow-hidden">
        <FilterSummary filters={[{ label: t('ui.search'), value: searchTerm, active: Boolean(searchTerm) }, { label: t('ui.filter_status'), value: selectedStatus, active: selectedStatus !== 'ALL' }, { label: t('ui.filter_pricing'), value: selectedPricingModel, active: selectedPricingModel !== 'ALL' }, { label: t('ui.filter_charging'), value: selectedChargingType, active: selectedChargingType !== 'ALL' }]} onReset={() => { setSearchTerm(''); setSelectedStatus('ALL'); setSelectedPricingModel('ALL'); setSelectedChargingType('ALL'); }} />
        <Text size="xs" tone="muted" className="px-g13 py-g8 md:hidden">{t('ui.scroll_table')}</Text>
        <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.scroll_table')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableColumnHeader scope="col" className="w-g42">
                  <div className="flex items-center justify-start">
                    <Checkbox checked={isAllSelected} aria-label={t('io.select_all', 'Pilih semua IO')} onCheckedChange={(details) => handleSelectAll(details.checked === true)}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                  </div>
                </TableColumnHeader>
                {visibleColumns.nomor && renderSortHeader(t('io.col_no', 'No. IO'), 'no')}
                {visibleColumns.judul && renderSortHeader(t('io.col_title', 'Judul IO'), 'judul')}
                {visibleColumns.partner && renderSortHeader(t('io.col_partner', 'Partner'), 'partner')}
                {visibleColumns.kanal && (
                  <TableColumnHeader scope="col">
                    <span>{t('io.col_channel', 'Kanal Media')}</span>
                  </TableColumnHeader>
                )}
                {visibleColumns.pricing_model && (
                  <TableColumnHeader scope="col">
                    <span>{t('io.col_pricing_model', 'Model')}</span>
                  </TableColumnHeader>
                )}
                {visibleColumns.payment_scheme && (
                  <TableColumnHeader scope="col">
                    <span>{t('io.col_charging_type', 'Skema')}</span>
                  </TableColumnHeader>
                )}
                {visibleColumns.start_date && renderSortHeader(t('io.col_start_date', 'Tgl Mulai'), 'start')}
                {visibleColumns.completion_date && renderSortHeader(t('io.col_end_date', 'Tgl Selesai'), 'end')}
                {visibleColumns.nilai && renderSortHeader(t('io.col_value', 'Nilai Order'), 'value')}
                {visibleColumns.status && renderSortHeader(t('io.col_status', 'Status'), 'status')}
                {visibleColumns.file && (
                  <TableColumnHeader scope="col">
                    <span>{t('io.col_document', 'Document')}</span>
                  </TableColumnHeader>
                )}
                <TableColumnHeader data-actions="true" scope="col" className="text-right w-g89">
                  <div className="flex items-center justify-end">{t('io.col_action', 'Aksi')}</div>
                </TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedIOs.length === 0 ? (
                <TableEmptyState colSpan={Object.values(visibleColumns).filter(Boolean).length + 2} />
              ) : (
                paginatedIOs.map((io) => {
                  const isSelected = selectedRowIds.has(io.io_id);
                  return (
                    <TableRow
                      key={io.io_id}
                      className={cn(
                        '',
 isSelected && ''
 )}
 >
 {/* Checkbox */}
 <TableCell>
                        <div className="flex items-center justify-start">
                          <Checkbox checked={isSelected} aria-label={t('io.pilih_io', 'Pilih IO {io_number}', { io_number: io.io_number })} onCheckedChange={() => handleSelectRow(io.io_id)}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                        </div>
                      </TableCell>
                      {/* Nomor IO */}
                      {visibleColumns.nomor && (
                        <TableCell className="whitespace-nowrap">
                          {io.io_number}
                        </TableCell>
                      )}
                      {/* Judul IO */}
                      {visibleColumns.judul && (
                        <TableCell className="max-w-g233">
                          <Tooltip><TooltipTrigger asChild><span
                            onClick={() => setDetailIO(io)}
                            className="block cursor-pointer truncate hover:text-accent-foreground"
                          >
                            {io.io_title}
                          </span></TooltipTrigger><TooltipBody>{io.io_title}</TooltipBody></Tooltip>
                        </TableCell>
                      )}
                      {/* Partner */}
                      {visibleColumns.partner && (
                        <TableCell>
                          {partnerNameOf(io.partner_id) || '-'}
                        </TableCell>
                      )}
                      {/* Kanal */}
                      {visibleColumns.kanal && (
                        <TableCell>
                          {io.media_channel || '-'}
                        </TableCell>
                      )}
                      {/* Model Pembayaran */}
                      {visibleColumns.pricing_model && (
                        <TableCell className="whitespace-nowrap">
                          {io.pricing_model || '-'}
                        </TableCell>
                      )}
                      {/* Skema */}
                      {visibleColumns.payment_scheme && (
                        <TableCell>
                          {io.payment_scheme || io.charging_type || '-'}
                        </TableCell>
                      )}
                      {/* Tanggal Mulai */}
                      {visibleColumns.start_date && (
                        <TableCell className="whitespace-nowrap">
                          {formatBusinessDate(io.start_date)}
                        </TableCell>
                      )}
                      {/* Tanggal Selesai */}
                      {visibleColumns.completion_date && (
                        <TableCell className="whitespace-nowrap">
                          {formatBusinessDate(io.end_date || io.completion_date)}
                        </TableCell>
                      )}
                      {/* Nilai IO */}
                      {visibleColumns.nilai && (
                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                          {formatMoney(io.io_value, io.currency)}
                        </TableCell>
                      )}
                      {/* Status */}
                      {visibleColumns.status && (
                        <TableCell className="whitespace-nowrap">
                          <Badge
                            tone={statusTone(
 io.status
 )}
                          >
                            {io.status === 'Active' && <CheckCircle2 className="w-g13 h-g13" />}
                            {io.status === 'Expired' && <Clock className="w-g13 h-g13" />}
                            <span>{t(CONTRACT_STATUS_LABEL_KEY[io.status] || 'status.active', io.status)}</span>
                          </Badge>
                        </TableCell>
                      )}
                      {/* File */}
                      {visibleColumns.file && (
                        <TableCell>
                          {io.io_file_link ? (
                            <Button asChild variant="link"><a href={io.io_file_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              
                            >
                              <FileDown className="w-g13 h-g13" /> {t('io.pdf', 'PDF')}
                            </a></Button>
                          ) : (
                            <span className="text-primary-foreground">-</span>
                          )}
                        </TableCell>
                      )}
                      {/* Actions Menu */}
                      <TableCell data-actions="true" className="text-right w-g89">
                        <div className="flex items-center justify-end">
                          <ActionMenu
                            items={[
                              {
                                label: t('io.action_detail', 'Detail'),
                                icon: <ExternalLink className="w-g13 h-g13" />,
                                onClick: () => setDetailIO(io),
                              },
                              ...(canEditIO(io, partners, user)
                                ? [
                                    {
                                      label: t('io.action_edit', 'Edit'),
                                      icon: <Edit2 className="w-g13 h-g13" />,
                                      onClick: () => onEditIO(io),
                                    },
                                  ]
                                : []),
                              ...(canDeletePartner(user)
                                ? [
                                    {
                                      label: t('io.action_delete', 'Hapus'),
                                      icon: <Trash2 className="w-g13 h-g13" />,
                                      onClick: () => onDeleteIO(io.io_id),
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
          currentPage={pageIndex + 1}
          totalPages={pageCount}
          rowsPerPage={pageSize}
          onPageChange={(page) => setPageIndex(page - 1)}
          onRowsPerPageChange={(size) => {
            setPageSize(size);
            setPageIndex(0);
          }}
        />
      </Card>

      {/* Detail IO Modal Dialog */}
      {detailIO && (
        <ModalFrame onClose={() => setDetailIO(null)} className="max-w-g987 w-full flex flex-col overflow-hidden">

            <DialogHeader className="flex items-center justify-between gap-g13 border-b border-border px-g21 py-g13">
              <div>
                <DialogTitle className="flex items-center gap-g8">
                  <FileSpreadsheet className="w-g21 h-g21 text-accent-foreground" />
                  <span>{detailIO.io_number}</span>
                </DialogTitle>
                <Text size="xs" tone="muted" className="mt-g2">{detailIO.io_title}</Text>
              </div>
              <Button variant="secondary" size="icon-sm" aria-label={t('common.close', 'Tutup')}
                type="button"
                onClick={() => setDetailIO(null)}
              >
                <X className="w-g21 h-g21" />
              </Button>
            </DialogHeader>

            <div className="p-g21 sm:p-g21 overflow-y-auto space-y-g13 text-xs flex-1">
              <Card className="grid grid-cols-1 sm:grid-cols-2 gap-g13 p-g13 bg-background">
                <div>
                  <Text as="span" size="xs" weight="medium" tone="muted" className="block">{t('io.detail_partner_label', 'Partner / Vendor:')}</Text>
                  <Text as="span" size="xs" weight="bold">{partnerNameOf(detailIO.partner_id) || '-'}</Text>
                </div>
                <div>
                  <Text as="span" size="xs" weight="medium" tone="muted" className="block">{t('io.detail_channel_label', 'Kanal Media Placement:')}</Text>
                  <Text as="span" size="xs" weight="bold">{detailIO.media_channel || '-'}</Text>
                </div>
                <div>
                  <Text as="span" size="xs" weight="medium" tone="muted" className="block">{t('io.detail_total_value_label', 'Nilai Total IO:')}</Text>
                  <Text as="span" size="xs" weight="bold" tone="primary" className="font-mono">
                    {formatMoney(detailIO.io_value, detailIO.currency)}
                  </Text>
                </div>
                <div>
                  <Text as="span" size="xs" weight="medium" tone="muted" className="block">{t('io.detail_pricing_scheme_label', 'Model Pembayaran & Skema:')}</Text>
                  <Text as="span" size="xs" weight="bold">
                    {detailIO.pricing_model || '-'} • {detailIO.charging_type || detailIO.payment_scheme || '-'}
                  </Text>
                </div>
              </Card>

              <section className="grid gap-g5">
                <Heading as="h3" size="xs" weight="semibold">{t('io.detail_deliverables_label', 'Deliverables & Lingkup Pekerjaan')}</Heading>
                <Card variant="subtle" size="sm" className="p-g13 font-mono text-xs whitespace-pre-line">
                  {detailIO.deliverables || t('io.detail_no_deliverables', 'Tidak ada catatan deliverables khusus.')}
                </Card>
              </section>

              {detailIO.io_file_link && (
                <div className="pt-g13 border-t border-border">
                  <Button variant="outline" size="sm"
                    type="button"
                    onClick={() => window.open(detailIO.io_file_link, '_blank')}
                    className="w-full"
                  >
                    <ExternalLink className="w-g16 h-g16" />
                    <span>{t('io.detail_open_drive', 'Buka Berkas IO di Google Drive')}</span>
                  </Button>
                </div>
              )}
            </div>

            <div className="p-g13 sm:p-g21 bg-background border-t border-border flex justify-end shrink-0">
              <Button variant="ghost" size="sm"
                type="button"
                onClick={() => setDetailIO(null)}
              >
                {t('io.detail_close', 'Tutup Detail')}
              </Button>
            </div>

        </ModalFrame>
      )}
    </div>
  );
};
