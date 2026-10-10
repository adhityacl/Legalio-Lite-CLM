import { ModalFrame, ModalTitle } from './ui/modal-frame';
import { TableViewMenu } from './ui/table-view-menu';
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
import { getStatusBadgeClass } from '@legalio/ui-components/badge';
import { getSavedColumnPreferences, saveColumnPreferences } from '../lib/tablePreferences';
import { Button } from '@legalio/ui-components/button';
import { ActionMenu } from './ui/action-menu';
import { TablePagination } from './ui/TablePagination';
import { usePermissions } from '../lib/permissions';

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
  const [pageSize, setPageSize] = useState(10);

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
      <th
        scope="col"
        aria-sort={isSorted ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
        className="p-4 text-xs font-bold text-ink text-left select-none align-middle"
       data-numeric={field === 'value'}>
        <button
          type="button"
          onClick={() => handleSort(field)}
          className="flex items-center gap-1 hover:text-ink dark:hover:text-white transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none rounded-sm py-0.5"
          title={t('io.urutkan_berdasarkan', 'Urutkan berdasarkan {label}', { label })}
        >
          <span>{label}</span>
          {isSorted ? (
            sortOrder === 'asc' ? (
              <ArrowUp className="w-3.5 h-3.5 text-accent-text shrink-0" />
            ) : (
              <ArrowDown className="w-3.5 h-3.5 text-accent-text shrink-0" />
            )
          ) : (
            <ArrowUpDown className="w-3 h-3 text-ink-soft shrink-0" />
          )}
        </button>
      </th>
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
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
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
    <div className="ds-page animate-in fade-in-50 duration-200">
      {/* Page Header */}
      <div className="ds-page-bar">
        <div>
          <h2 className="ds-page-heading">
            <span>{t('io.title', 'Insertion Order Management')}</span>
          </h2>
        </div>

        <div className="mobile-page-actions flex flex-wrap items-center gap-2.5 shrink-0">
          {hasPermission('export.csv') && (
            <button
              onClick={handleExportCSV}
              disabled={filteredIOs.length === 0}
              className="ui-button ui-button-lg cursor-pointer flex items-center disabled:opacity-50 disabled:cursor-not-allowed ds-button ds-button-lg ds-button-outline"
              title={t('io.export_csv', 'Ekspor CSV')}
            >
              <Download className="w-4 h-4" />
              <span>{t('io.export_csv', 'Ekspor CSV')}</span>
            </button>
          )}

          {canCreateIO(user) && (
            <button
              onClick={onAddIO}
              className="ui-button ui-button-lg cursor-pointer flex items-center ds-button ds-button-lg ds-button-default"
            >
              <Plus className="w-4 h-4 text-white" />
              <span>{t('ui.add_io')}</span>
            </button>
          )}
        </div>
      </div>

      {/* DataTable Toolbar - Justified Responsive Grid/Flex */}
      <div className="ds-panel p-4 sm:p-5 mb-6">
        <div className="mobile-filter-grid flex flex-wrap items-center gap-2.5 w-full ds-grid">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[200px] sm:min-w-[240px]">
            <Search className="w-4 h-4 text-ink-soft absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={t('io.search_ph', 'Cari insertion orders...')}
              aria-label={t('ui.search')}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPageIndex(0);
              }}
              className="ds-input w-full pl-9 pr-3"
            />
          </div>

          {/* Simple Select Filter: Status */}
          <AlphabeticalSelect
            aria-label={t('ui.filter_status')}
              value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="ds-input flex-1 min-w-[130px] appearance-none pr-8"
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
            className="ds-input flex-1 min-w-[130px] appearance-none pr-8"
          >
            <option value="ALL">{t('io.all_pricing_models', 'Semua Model Pricing')}</option>
            {pricingFilterOptions.map((model) => <option key={model} value={model}>{model}</option>)}
          </AlphabeticalSelect>

          {/* Simple Select Filter: Charging Scheme */}
          <AlphabeticalSelect
            aria-label={t('ui.filter_charging')}
              value={selectedChargingType}
            onChange={(e) => setSelectedChargingType(e.target.value)}
            className="ds-input flex-1 min-w-[130px] appearance-none pr-8"
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
              className="text-xs cursor-pointer"
            >
              {t('common.reset', 'Reset')}
              <X className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          )}

          {/* Column Toggle */}
          <TableViewMenu title={t('io.view_settings', 'Pengaturan Tampilan Kolom')} label={t('io.view', 'View')}>
            <div className="px-3.5 py-1.5 text-xs font-bold text-ink-soft uppercase tracking-wider mb-1 border-b border-hairline">
              {t('io.toggle_columns', 'Toggle Kolom')}
            </div>
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
                <label key={col} className="flex items-center gap-2.5 px-3.5 py-1.5 hover:bg-surface dark:hover:bg-surface-2/50 cursor-pointer text-xs font-medium text-ink select-none">
                  <input
                    type="checkbox"
                    checked={visibleColumns[col]}
                    onChange={() => toggleColumnVisibility(col)}
                    className="rounded-sm border-hairline text-accent-text focus:ring-accent"
                  />
                  <span className="capitalize">{label}</span>
                </label>
              );
            })}
          </TableViewMenu>
        </div>
      </div>

      {/* DataTable Container */}
      <div className="ds-table-surface bg-surface border border-hairline rounded-2xl shadow-sm overflow-hidden">
        <FilterSummary filters={[{ label: t('ui.search'), value: searchTerm, active: Boolean(searchTerm) }, { label: t('ui.filter_status'), value: selectedStatus, active: selectedStatus !== 'ALL' }, { label: t('ui.filter_pricing'), value: selectedPricingModel, active: selectedPricingModel !== 'ALL' }, { label: t('ui.filter_charging'), value: selectedChargingType, active: selectedChargingType !== 'ALL' }]} onReset={() => { setSearchTerm(''); setSelectedStatus('ALL'); setSelectedPricingModel('ALL'); setSelectedChargingType('ALL'); }} />
        <p className="mobile-table-hint px-4 py-2 text-xs text-ink-soft md:hidden">{t('ui.scroll_table')}</p>
        <div className="data-table-scroll overflow-x-auto bg-surface" tabIndex={0} role="region" aria-label={t('ui.scroll_table')}>
          <table className="ds-table app-data-table w-full text-left border-collapse text-xs bg-surface">
            <thead className="bg-surface dark:bg-surface-2/50">
              <tr className="bg-surface dark:bg-surface-2/50 border-b border-hairline text-xs font-bold text-ink h-12">
                <th scope="col" className="pl-6 pr-2 py-4 w-12 text-left align-middle">
                  <div className="flex items-center justify-start">
                    <input
                      type="checkbox"
                      onChange={handleSelectAll}
                      checked={isAllSelected}
                      aria-label={t('io.select_all', 'Pilih semua IO')}
                      className="rounded-sm border-hairline text-accent-text focus:ring-accent"
                    />
                  </div>
                </th>
                {visibleColumns.nomor && renderSortHeader(t('io.col_no', 'No. IO'), 'no')}
                {visibleColumns.judul && renderSortHeader(t('io.col_title', 'Judul IO'), 'judul')}
                {visibleColumns.partner && renderSortHeader(t('io.col_partner', 'Partner'), 'partner')}
                {visibleColumns.kanal && (
                  <th scope="col" className="p-4 text-left text-xs font-bold text-ink align-middle">
                    <span>{t('io.col_channel', 'Kanal Media')}</span>
                  </th>
                )}
                {visibleColumns.model_pembayaran && (
                  <th scope="col" className="p-4 text-left text-xs font-bold text-ink align-middle">
                    <span>{t('io.col_pricing_model', 'Model')}</span>
                  </th>
                )}
                {visibleColumns.skema_pembayaran && (
                  <th scope="col" className="p-4 text-left text-xs font-bold text-ink align-middle">
                    <span>{t('io.col_charging_type', 'Skema')}</span>
                  </th>
                )}
                {visibleColumns.tanggal_mulai && (
                  <th scope="col" className="p-4 text-left text-xs font-bold text-ink align-middle">
                    <span>{t('io.col_start_date', 'Tgl Mulai')}</span>
                  </th>
                )}
                {visibleColumns.tanggal_selesai && (
                  <th scope="col" className="p-4 text-left text-xs font-bold text-ink align-middle">
                    <span>{t('io.col_end_date', 'Tgl Selesai')}</span>
                  </th>
                )}
                {visibleColumns.nilai && renderSortHeader(t('io.col_value', 'Nilai Order'), 'value')}
                {visibleColumns.status && renderSortHeader(t('io.col_status', 'Status'), 'status')}
                {visibleColumns.file && (
                  <th scope="col" className="p-4 text-left text-xs font-bold text-ink align-middle">
                    <span>{t('io.col_document', 'File')}</span>
                  </th>
                )}
                <th data-actions="true" scope="col" className="pl-2 pr-6 py-4 text-right w-20 text-xs font-bold text-ink align-middle">
                  <div className="flex items-center justify-end">{t('io.col_action', 'Aksi')}</div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {paginatedIOs.length === 0 ? (
                <TableEmptyState colSpan={Object.values(visibleColumns).filter(Boolean).length + 2} />
              ) : (
                paginatedIOs.map((io) => {
                  const isSelected = selectedRowIds.has(io.io_id);
                  return (
                    <tr
                      key={io.io_id}
                      className={cn(
                        'hover:bg-surface transition-colors text-xs',
                        isSelected && 'bg-accent-soft/50'
                      )}
                    >
                      {/* Checkbox */}
                      <td className="pl-6 pr-2 py-4 text-left align-middle">
                        <div className="flex items-center justify-start">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleSelectRow(io.io_id)}
                            aria-label={t('io.pilih_io', 'Pilih IO {nomor_io}', { nomor_io: io.nomor_io })}
                            className="rounded-sm border-hairline text-accent-text focus:ring-accent"
                          />
                        </div>
                      </td>
                      {/* Nomor IO */}
                      {visibleColumns.nomor && (
                        <td className="py-4 px-4 text-xs font-semibold text-ink text-left whitespace-nowrap">
                          {io.nomor_io}
                        </td>
                      )}
                      {/* Judul IO */}
                      {visibleColumns.judul && (
                        <td className="py-4 px-4 text-left text-xs font-normal text-ink">
                          <span
                            onClick={() => setDetailIO(io)}
                            className="hover:text-accent-text cursor-pointer"
                          >
                            {io.judul_io}
                          </span>
                        </td>
                      )}
                      {/* Partner */}
                      {visibleColumns.partner && (
                        <td className="py-4 px-4 text-xs font-normal text-ink text-left">
                          {io.partner_nama || '-'}
                        </td>
                      )}
                      {/* Kanal */}
                      {visibleColumns.kanal && (
                        <td className="py-4 px-4 text-ink text-xs font-normal text-left">
                          {io.kanal_media || '-'}
                        </td>
                      )}
                      {/* Model Pembayaran */}
                      {visibleColumns.model_pembayaran && (
                        <td className="py-4 px-4 text-left text-xs font-normal text-ink whitespace-nowrap">
                          {io.pricing_model || io.model_pembayaran || '-'}
                        </td>
                      )}
                      {/* Skema */}
                      {visibleColumns.skema_pembayaran && (
                        <td className="py-4 px-4 text-xs text-ink text-left font-normal">
                          {io.skema_pembayaran || io.charging_type || '-'}
                        </td>
                      )}
                      {/* Tanggal Mulai */}
                      {visibleColumns.tanggal_mulai && (
                        <td className="py-4 px-4 text-xs text-ink text-left font-normal whitespace-nowrap">
                          {formatBusinessDate(io.tanggal_mulai)}
                        </td>
                      )}
                      {/* Tanggal Selesai */}
                      {visibleColumns.tanggal_selesai && (
                        <td className="py-4 px-4 text-xs text-ink text-left font-normal whitespace-nowrap">
                          {formatBusinessDate(io.tanggal_berakhir || io.tanggal_selesai)}
                        </td>
                      )}
                      {/* Nilai IO */}
                      {visibleColumns.nilai && (
                        <td className="py-4 px-4 text-right text-xs font-normal text-ink whitespace-nowrap tabular-nums">
                          {formatMoney(io.nilai_io, io.mata_uang)}
                        </td>
                      )}
                      {/* Status */}
                      {visibleColumns.status && (
                        <td className="py-4 px-4 text-left text-xs font-normal text-ink whitespace-nowrap">
                          <span
                            className={`text-xs font-normal px-3 py-0.5 rounded-full border inline-flex items-center justify-center gap-1.5 shadow-2xs whitespace-nowrap ${getStatusBadgeClass(
                              io.status
                            )}`}
                          >
                            {io.status === 'Active' && <CheckCircle2 className="w-3.5 h-3.5" />}
                            {io.status === 'Expired' && <Clock className="w-3.5 h-3.5" />}
                            <span>{t(CONTRACT_STATUS_LABEL_KEY[io.status] || 'status.active', io.status)}</span>
                          </span>
                        </td>
                      )}
                      {/* File */}
                      {visibleColumns.file && (
                        <td className="py-4 px-4 text-left text-xs font-normal text-ink">
                          {io.link_file_io ? (
                            <a
                              href={io.link_file_io}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-accent-text hover:text-accent-text font-normal hover:underline"
                            >
                              <FileDown className="w-3.5 h-3.5" /> {t('io.pdf', 'PDF')}
                            </a>
                          ) : (
                            <span className="text-on-solid">-</span>
                          )}
                        </td>
                      )}
                      {/* Actions Menu */}
                      <td data-actions="true" className="pl-2 pr-6 py-4 text-right align-middle w-20">
                        <div className="flex items-center justify-end">
                          <ActionMenu
                            items={[
                              {
                                label: t('io.action_detail', 'Detail'),
                                icon: <ExternalLink className="w-3.5 h-3.5" />,
                                onClick: () => setDetailIO(io),
                              },
                              ...(canEditIO(io, partners, user)
                                ? [
                                    {
                                      label: t('io.action_edit', 'Edit'),
                                      icon: <Edit2 className="w-3.5 h-3.5" />,
                                      onClick: () => onEditIO(io),
                                    },
                                  ]
                                : []),
                              ...(canDeletePartner(user)
                                ? [
                                    {
                                      label: t('io.action_delete', 'Hapus'),
                                      icon: <Trash2 className="w-3.5 h-3.5" />,
                                      onClick: () => onDeleteIO(io.io_id),
                                      variant: 'danger' as const,
                                      dividerBefore: true,
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          currentPage={pageIndex + 1}
          totalPages={pageCount}
          rowsPerPage={pageSize}
          rowsPerPageOptions={[10, 20, 50, 100]}
          onPageChange={(page) => setPageIndex(page - 1)}
          onRowsPerPageChange={(size) => {
            setPageSize(size);
            setPageIndex(0);
          }}
        />
      </div>

      {/* Detail IO Modal Dialog */}
      {detailIO && (
        <ModalFrame onClose={() => setDetailIO(null)} className="max-w-4xl w-full max-h-[92dvh] flex flex-col overflow-hidden">

            <div className="ds-section-header">
              <div>
                <ModalTitle className="ds-modal-title flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-accent-text" />
                  <span>{detailIO.nomor_io}</span>
                </ModalTitle>
                <p className="text-xs text-ink-soft mt-0.5">{detailIO.judul_io}</p>
              </div>
              <button aria-label={t('common.close', 'Tutup')}
                type="button"
                onClick={() => setDetailIO(null)}
                className="inline-flex items-center justify-center text-ink-soft hover:text-ink dark:hover:text-ink size-8 rounded-md hover:bg-surface-2 dark:hover:bg-surface-2 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-xs flex-1">
              <div className="ds-panel grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-canvas ds-grid">
                <div>
                  <span className="text-ink-soft block text-xs font-medium">{t('io.detail_partner_label', 'Partner / Vendor:')}</span>
                  <span className="font-bold text-ink dark:text-white text-xs">{detailIO.partner_nama || '-'}</span>
                </div>
                <div>
                  <span className="text-ink-soft block text-xs font-medium">{t('io.detail_channel_label', 'Kanal Media Placement:')}</span>
                  <span className="font-bold text-ink dark:text-white text-xs">{detailIO.kanal_media || '-'}</span>
                </div>
                <div>
                  <span className="text-ink-soft block text-xs font-medium">{t('io.detail_total_value_label', 'Nilai Total IO:')}</span>
                  <span className="font-bold text-accent-text font-mono text-xs">
                    {formatMoney(detailIO.nilai_io, detailIO.mata_uang)}
                  </span>
                </div>
                <div>
                  <span className="text-ink-soft block text-xs font-medium">{t('io.detail_pricing_scheme_label', 'Model Pembayaran & Skema:')}</span>
                  <span className="font-bold text-ink dark:text-white text-xs">
                    {detailIO.pricing_model || detailIO.model_pembayaran || '-'} • {detailIO.charging_type || detailIO.skema_pembayaran || '-'}
                  </span>
                </div>
              </div>

              <div>
                <label className="block font-bold text-ink mb-1.5 text-xs">
                  {t('io.detail_deliverables_label', 'Deliverables & Lingkup Pekerjaan')}
                </label>
                <p className="text-ink bg-canvas dark:bg-surface-2/60 p-3.5 rounded-xl border border-hairline leading-relaxed font-mono text-xs whitespace-pre-line">
                  {detailIO.deliverables || t('io.detail_no_deliverables', 'Tidak ada catatan deliverables khusus.')}
                </p>
              </div>

              {detailIO.link_file_io && (
                <div className="pt-3 border-t border-hairline">
                  <button
                    type="button"
                    onClick={() => window.open(detailIO.link_file_io, '_blank')}
                    className="w-full py-2.5 px-4 bg-accent-soft text-accent-text hover:bg-accent/20 border border-accent/30 rounded-md text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>{t('io.detail_open_drive', 'Buka Berkas IO di Google Drive')}</span>
                  </button>
                </div>
              )}
            </div>

            <div className="p-4 sm:p-5 bg-canvas border-t border-hairline flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setDetailIO(null)}
                className="inline-flex items-center px-4 min-h-8 bg-ink hover:bg-ink dark:bg-surface-2 dark:hover:bg-surface-2 text-white font-semibold rounded-md text-xs transition-colors cursor-pointer"
              >
                {t('io.detail_close', 'Tutup Detail')}
              </button>
            </div>

        </ModalFrame>
      )}
    </div>
  );
};
