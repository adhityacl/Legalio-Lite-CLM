import { ModalFrame } from './ui/modal-frame';
import { TableViewMenu, TableViewOption } from './ui/table-view-menu';
import { AlphabeticalSelect } from './ui/alphabetical-select';
import { formatBusinessDate } from '../lib/displayDate';
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
import { getSavedColumnPreferences, saveColumnPreferences } from '../lib/tablePreferences';
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
  const [pageSize, setPageSize] = useState(5);

  // Sorting State
  type SortField = 'no' | 'judul' | 'partner' | 'pricing' | 'value' | 'duration' | 'status';
  type SortOrder = 'asc' | 'desc';
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
    nilai: true,
    model_pembayaran: false,
    skema_pembayaran: false,
    tanggal_mulai: false,
    tanggal_selesai: false,
    status: false,
    file: false,
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

  // Filtering Logic
  const filteredIOs = useMemo(() => {
    return ios.filter((i) => {
      // 1. Department Scoping & RBAC restriction (based on internal PIC of partner)
      if (!canViewIO(i, partners, user)) {
        return false;
      }

      const matchSearch =
        searchTerm === '' ||
        i.nomor_io.toLowerCase().includes(searchTerm.toLowerCase()) ||
        i.judul_io.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (i.partner_nama && i.partner_nama.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (i.kanal_media && i.kanal_media.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchStatus = selectedStatus === 'ALL' || i.status === selectedStatus;
      const matchPricing = selectedPricingModel === 'ALL' || (i.pricing_model || i.model_pembayaran) === selectedPricingModel;
      const matchCharging = selectedChargingType === 'ALL' || (i.charging_type || i.skema_pembayaran) === selectedChargingType;

      return matchSearch && matchStatus && matchPricing && matchCharging;
    });
  }, [ios, partners, user, searchTerm, selectedStatus, selectedPricingModel, selectedChargingType]);

  // Sorting Logic
  const sortedIOs = useMemo(() => {
    if (!sortField) return filteredIOs;

    return [...filteredIOs].sort((a, b) => {
      let valA: any = '';
      let valB: any = '';

      switch (sortField) {
        case 'no':
          valA = a.nomor_io || '';
          valB = b.nomor_io || '';
          break;
        case 'judul':
          valA = a.judul_io || '';
          valB = b.judul_io || '';
          break;
        case 'partner':
          valA = a.partner_nama || '';
          valB = b.partner_nama || '';
          break;
        case 'pricing':
          valA = a.pricing_model || a.model_pembayaran || '';
          valB = b.pricing_model || b.model_pembayaran || '';
          break;
        case 'value':
          valA = a.nilai_io || 0;
          valB = b.nilai_io || 0;
          break;
        case 'duration':
          valA = a.tanggal_berakhir || a.tanggal_selesai || a.tanggal_mulai || '';
          valB = b.tanggal_berakhir || b.tanggal_selesai || b.tanggal_mulai || '';
          break;
        case 'status':
          valA = a.status || '';
          valB = b.status || '';
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
  }, [filteredIOs, sortField, sortOrder]);

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
        i.nomor_io,
        i.judul_io,
        i.contract_id || '-',
        i.partner_nama || '-',
        i.kanal_media || '-',
        i.model_pembayaran || '-',
        i.skema_pembayaran || '-',
        i.tanggal_mulai,
        i.tanggal_berakhir || i.tanggal_selesai || '-',
        i.currency || i.mata_uang || '',
        i.nilai_io,
        i.status,
        i.deliverables || '-',
        i.link_file_io || '',
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
              else if (col === 'model_pembayaran') label = t('io.col_pricing_model', 'Model Pembayaran');
              else if (col === 'skema_pembayaran') label = t('io.col_charging_type', 'Skema Pembayaran');
              else if (col === 'tanggal_mulai') label = t('io.col_start_date', 'Tanggal Mulai');
              else if (col === 'tanggal_selesai') label = t('io.col_end_date', 'Tanggal Selesai');
              else if (col === 'status') label = t('io.col_status', 'Status');
              else if (col === 'file') label = t('io.col_document', 'File PDF');

              return (
                <TableViewOption key={col} value={col} checked={visibleColumns[col]} onToggle={() => toggleColumnVisibility(col)}>{label}</TableViewOption>
              );
            })}
          </TableViewMenu>
        </div>
      </Card>

      {/* DataTable Container */}
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
                {visibleColumns.model_pembayaran && (
                  <TableColumnHeader scope="col">
                    <span>{t('io.col_pricing_model', 'Model')}</span>
                  </TableColumnHeader>
                )}
                {visibleColumns.skema_pembayaran && (
                  <TableColumnHeader scope="col">
                    <span>{t('io.col_charging_type', 'Skema')}</span>
                  </TableColumnHeader>
                )}
                {visibleColumns.tanggal_mulai && (
                  <TableColumnHeader scope="col">
                    <span>{t('io.col_start_date', 'Tgl Mulai')}</span>
                  </TableColumnHeader>
                )}
                {visibleColumns.tanggal_selesai && (
                  <TableColumnHeader scope="col">
                    <span>{t('io.col_end_date', 'Tgl Selesai')}</span>
                  </TableColumnHeader>
                )}
                {visibleColumns.nilai && renderSortHeader(t('io.col_value', 'Nilai Order'), 'value')}
                {visibleColumns.status && renderSortHeader(t('io.col_status', 'Status'), 'status')}
                {visibleColumns.file && (
                  <TableColumnHeader scope="col">
                    <span>{t('io.col_document', 'File')}</span>
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
                          <Checkbox checked={isSelected} aria-label={t('io.pilih_io', 'Pilih IO {nomor_io}', { nomor_io: io.nomor_io })} onCheckedChange={() => handleSelectRow(io.io_id)}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                        </div>
                      </TableCell>
                      {/* Nomor IO */}
                      {visibleColumns.nomor && (
                        <TableCell className="whitespace-nowrap">
                          {io.nomor_io}
                        </TableCell>
                      )}
                      {/* Judul IO */}
                      {visibleColumns.judul && (
                        <TableCell className="max-w-g233">
                          <Tooltip><TooltipTrigger asChild><span
                            onClick={() => setDetailIO(io)}
                            className="block cursor-pointer truncate hover:text-accent-foreground"
                          >
                            {io.judul_io}
                          </span></TooltipTrigger><TooltipBody>{io.judul_io}</TooltipBody></Tooltip>
                        </TableCell>
                      )}
                      {/* Partner */}
                      {visibleColumns.partner && (
                        <TableCell>
                          {io.partner_nama || '-'}
                        </TableCell>
                      )}
                      {/* Kanal */}
                      {visibleColumns.kanal && (
                        <TableCell>
                          {io.kanal_media || '-'}
                        </TableCell>
                      )}
                      {/* Model Pembayaran */}
                      {visibleColumns.model_pembayaran && (
                        <TableCell className="whitespace-nowrap">
                          {io.pricing_model || io.model_pembayaran || '-'}
                        </TableCell>
                      )}
                      {/* Skema */}
                      {visibleColumns.skema_pembayaran && (
                        <TableCell>
                          {io.skema_pembayaran || io.charging_type || '-'}
                        </TableCell>
                      )}
                      {/* Tanggal Mulai */}
                      {visibleColumns.tanggal_mulai && (
                        <TableCell className="whitespace-nowrap">
                          {formatBusinessDate(io.tanggal_mulai)}
                        </TableCell>
                      )}
                      {/* Tanggal Selesai */}
                      {visibleColumns.tanggal_selesai && (
                        <TableCell className="whitespace-nowrap">
                          {formatBusinessDate(io.tanggal_berakhir || io.tanggal_selesai)}
                        </TableCell>
                      )}
                      {/* Nilai IO */}
                      {visibleColumns.nilai && (
                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                          {formatMoney(io.nilai_io, io.mata_uang)}
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
                          {io.link_file_io ? (
                            <Button asChild variant="link"><a href={io.link_file_io}
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
                  <span>{detailIO.nomor_io}</span>
                </DialogTitle>
                <Text size="xs" tone="muted" className="mt-g2">{detailIO.judul_io}</Text>
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
                  <Text as="span" size="xs" weight="bold">{detailIO.partner_nama || '-'}</Text>
                </div>
                <div>
                  <Text as="span" size="xs" weight="medium" tone="muted" className="block">{t('io.detail_channel_label', 'Kanal Media Placement:')}</Text>
                  <Text as="span" size="xs" weight="bold">{detailIO.kanal_media || '-'}</Text>
                </div>
                <div>
                  <Text as="span" size="xs" weight="medium" tone="muted" className="block">{t('io.detail_total_value_label', 'Nilai Total IO:')}</Text>
                  <Text as="span" size="xs" weight="bold" tone="primary" className="font-mono">
                    {formatMoney(detailIO.nilai_io, detailIO.mata_uang)}
                  </Text>
                </div>
                <div>
                  <Text as="span" size="xs" weight="medium" tone="muted" className="block">{t('io.detail_pricing_scheme_label', 'Model Pembayaran & Skema:')}</Text>
                  <Text as="span" size="xs" weight="bold">
                    {detailIO.pricing_model || detailIO.model_pembayaran || '-'} • {detailIO.charging_type || detailIO.skema_pembayaran || '-'}
                  </Text>
                </div>
              </Card>

              <section className="grid gap-g5">
                <Heading as="h3" size="xs" weight="semibold">{t('io.detail_deliverables_label', 'Deliverables & Lingkup Pekerjaan')}</Heading>
                <Card variant="subtle" size="sm" className="p-g13 font-mono text-xs whitespace-pre-line">
                  {detailIO.deliverables || t('io.detail_no_deliverables', 'Tidak ada catatan deliverables khusus.')}
                </Card>
              </section>

              {detailIO.link_file_io && (
                <div className="pt-g13 border-t border-border">
                  <Button variant="outline" size="sm"
                    type="button"
                    onClick={() => window.open(detailIO.link_file_io, '_blank')}
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
