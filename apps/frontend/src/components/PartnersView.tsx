import { ModalFrame, ModalTitle } from './ui/modal-frame';
import { TableViewMenu } from './ui/table-view-menu';
import { AlphabeticalSelect } from './ui/alphabetical-select';
import { FilterSummary } from './ui/filter-summary';
import { TableEmptyState } from './ui/table-empty-state';
import React, { useState, useEffect } from 'react';
import { CONTRACT_STATUS_LABEL_KEY, DD_STATUS_LABEL_KEY, DOC_STATUS_LABEL_KEY } from '@legalio/types/domainStatus';
import { isTerminationNoticeDocument, localizeDueDiligenceDocument } from '@legalio/shared/dueDiligence';
import { useTenantSettings } from '../context/TenantSettingsContext';
import { getCountryPack, localizeName } from '@legalio/shared/policy';

/** Country of incorporation, falling back to the legacy BHI flag (BHI = Indonesia). */
const partnerCountry = (p: Partner): string => p.country ?? (p.badan_hukum === 'BHI' ? 'ID' : '');
import { Partner, Contract, DDDokumenItem, PartnerEvaluation } from '@legalio/types';
import {
  MoreHorizontal,
  Building2,
  Search,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Upload,
  ExternalLink,
  ShieldCheck,
  Edit2,
  FileCheck2,
  FileText,
  FileDown,
  Download,
  Filter,
  Trash2,
  ClipboardCheck,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
  Shield,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useConfirm } from '../context/ConfirmDialogContext';
import { useDepartments } from '../hooks/useDepartments';
import {
  canViewPartner,
  canEditPartner,
  canCreatePartner,
  canDeletePartner,
  isGlobalRole,
} from '../lib/rbacScoping';
import { PartnerEvaluationView } from './PartnerEvaluationView';
import { TablePagination } from './ui/TablePagination';
import { ActionMenu } from './ui/action-menu';
import { getStatusBadgeClass } from '@legalio/ui-components/badge';
import { getSavedColumnPreferences, saveColumnPreferences } from '../lib/tablePreferences';
import { UploadDDModal } from './UploadDDModal';
import { getAuthHeaders } from '../lib/apiFetch';
import { usePermissions } from '../lib/permissions';

export function getValidPartnerTags(tags?: string[]): string[] {
  if (!tags || !Array.isArray(tags)) return ['Advertising'];
  const valid = tags.filter((t) => t && typeof t === 'string' && !/^\d{4}-\d{2}-\d{2}/.test(t.trim()));
  return valid.length > 0 ? valid : ['Advertising'];
}

interface PartnersViewProps {
  partners: Partner[];
  contracts?: Contract[];
  evaluations?: PartnerEvaluation[];
  onRefreshData?: () => void;
  initialSubTab?: 'list' | 'evaluation';
  onAddPartner: () => void;
  onEditPartner: (partner: Partner) => void;
  onDeletePartner: (id: string, name: string) => void;
  onUploadDDDoc?: (partnerId: string, docName: string) => void;
}

export const PartnersView: React.FC<PartnersViewProps> = ({
  partners,
  contracts = [],
  evaluations = [],
  onRefreshData,
  initialSubTab = 'list',
  onAddPartner,
  onEditPartner,
  onDeletePartner,
  onUploadDDDoc,
}) => {
  const { hasPermission } = usePermissions();
  const { isLegal, user } = useAuth();
  const { t, language } = useLanguage();
  const confirmDialog = useConfirm();
  const { departments: ENTERPRISE_DEPARTMENTS } = useDepartments();
  const [subTab, setSubTab] = useState<'list' | 'evaluation'>(initialSubTab);

  useEffect(() => {
    if (initialSubTab) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDDStatus, setSelectedDDStatus] = useState<string>('ALL');
  const [selectedBadanHukum, setSelectedBadanHukum] = useState<string>('ALL');
  const { policy } = useTenantSettings();
  const homeCountry = policy.settings.countryCode;
  const countryLabel = (code: string) => (code ? `${code} · ${getCountryPack(code).code === code ? localizeName(getCountryPack(code).name, language) : code}` : t('common.unknown', 'Unknown'));
  const [selectedPartnerStatus, setSelectedPartnerStatus] = useState<string>('ALL');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('ALL');
  const [selectedPartnerDetail, setSelectedPartnerDetail] = useState<Partner | null>(null);
  const [uploadModalState, setUploadModalState] = useState<{
    partner: Partner;
    docName: string;
  } | null>(null);

  type SortField = 'channel' | 'name' | 'tags' | 'status' | 'pic' | 'status_dd';
  type SortOrder = 'asc' | 'desc';

  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  // Key order is both the Toggle Kolom menu order and the table's column order.
  const DEFAULT_PARTNER_COLUMNS = {
    nama_partner: true,
    channel: false,
    badan_hukum: true,
    kategori: false,
    pic: true,
    email: false,
    telepon: false,
    status: true,
    due_diligence: true,
  };

  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() =>
    getSavedColumnPreferences('partners', DEFAULT_PARTNER_COLUMNS)
  );
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

  const toggleColumnVisibility = (id: string) => {
    setVisibleColumns((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveColumnPreferences('partners', next);
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

  const getPartnerActiveContractsCount = (partnerId: string): number => {
    if (!contracts || contracts.length === 0) return 0;
    return contracts.filter(
      (c) => c.partner_id === partnerId && (c.status === 'Active' || c.status === 'Expiring')
    ).length;
  };

  const getPartnerStatus = (partnerId: string): 'Active' | 'Inactive' => {
    return getPartnerActiveContractsCount(partnerId) > 0 ? 'Active' : 'Inactive';
  };

  const filteredPartners = partners.filter((p) => {
    // 1. Department Scoping & RBAC restriction (based on internal_pic)
    if (!canViewPartner(p, user)) {
      return false;
    }

    const partnerTags = getValidPartnerTags(p.tags);
    const pCountry = partnerCountry(p);

    const matchSearch =
      p.nama_partner.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.codename && p.codename.toLowerCase().includes(searchTerm.toLowerCase())) ||
      countryLabel(pCountry).toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.pic_partner.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.pic_internal && p.pic_internal.toLowerCase().includes(searchTerm.toLowerCase())) ||
      p.partner_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      partnerTags.some((t) => t.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchStatus = selectedDDStatus === 'ALL' || p.status_dd === selectedDDStatus;
    const matchBadanHukum =
      selectedBadanHukum === 'ALL' ||
      (selectedBadanHukum === 'DOMESTIC' && pCountry === homeCountry) ||
      (selectedBadanHukum === 'FOREIGN' && pCountry !== homeCountry) ||
      pCountry === selectedBadanHukum;

    const pStatus = getPartnerStatus(p.partner_id);
    const matchPartnerStatus =
      selectedPartnerStatus === 'ALL' || pStatus === selectedPartnerStatus;

    const matchDepartment =
      selectedDepartment === 'ALL' ||
      Boolean(p.pic_internal && p.pic_internal.toLowerCase() === selectedDepartment.toLowerCase());

    return matchSearch && matchStatus && matchBadanHukum && matchPartnerStatus && matchDepartment;
  });

  const sortedPartners = React.useMemo(() => {
    if (!sortField) return filteredPartners;

    return [...filteredPartners].sort((a, b) => {
      let valA = '';
      let valB = '';

      switch (sortField) {
        case 'channel':
          valA = (a.codename || a.partner_id || '').toLowerCase();
          valB = (b.codename || b.partner_id || '').toLowerCase();
          break;
        case 'name':
          valA = (a.nama_partner || '').toLowerCase();
          valB = (b.nama_partner || '').toLowerCase();
          break;
        case 'tags':
          valA = getValidPartnerTags(a.tags).join(', ').toLowerCase();
          valB = getValidPartnerTags(b.tags).join(', ').toLowerCase();
          break;
        case 'status':
          valA = getPartnerStatus(a.partner_id).toLowerCase();
          valB = getPartnerStatus(b.partner_id).toLowerCase();
          break;
        case 'pic':
          valA = (a.nama_pic || a.pic_partner || '').toLowerCase();
          valB = (b.nama_pic || b.pic_partner || '').toLowerCase();
          break;
        case 'status_dd':
          valA = (a.status_dd || '').toLowerCase();
          valB = (b.status_dd || '').toLowerCase();
          break;
        default:
          return 0;
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredPartners, sortField, sortOrder, contracts]);

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) setSelectedRows(sortedPartners.map(item => item.partner_id));
    else setSelectedRows([]);
  };

  const handleSelectRow = (id: string) => {
    setSelectedRows(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]);
  };

  const totalPages = Math.ceil(sortedPartners.length / rowsPerPage);
  const indexOfLast = currentPage * rowsPerPage;
  const indexOfFirst = indexOfLast - rowsPerPage;
  const currentPartners = sortedPartners.slice(indexOfFirst, indexOfLast);

  const getDDStatusBadge = (status: Partner['status_dd']) => {
    return getStatusBadgeClass(status);
  };

  const renderSortHeader = (label: string, field: SortField) => {
    const isSorted = sortField === field;
    return (
      <th
        scope="col"
        aria-sort={isSorted ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
        className="p-4 text-xs font-bold text-ink text-left select-none align-middle"
      >
        <button
          type="button"
          onClick={() => handleSort(field)}
          className="flex items-center gap-1.5 hover:text-ink dark:hover:text-white transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none rounded-sm py-0.5"
          title={t('partners.urutkan_berdasarkan', 'Urutkan berdasarkan {label}', { label })}
        >
          <span>{label}</span>
          {isSorted ? (
            sortOrder === 'asc' ? (
              <ArrowUp className="w-3.5 h-3.5 text-accent-text shrink-0" />
            ) : (
              <ArrowDown className="w-3.5 h-3.5 text-accent-text shrink-0" />
            )
          ) : (
            <ArrowUpDown className="w-3.5 h-3.5 text-ink-soft shrink-0" />
          )}
        </button>
      </th>
    );
  };

  const handleExportCSV = () => {
    if (currentPartners.length === 0) return;

    const headers = [
      'ID Partner',
      'Nama Partner',
      'Status Partner',
      'Kontrak Aktif',
      'Country',
      'Tags',
      'PIC & Kontak',
      'Status Due Diligence',
      'Progres DD (%)',
      'Dokumen Wajib Terisi',
      'Total Dokumen Wajib',
      'Tanggal Verifikasi DD',
      'Link Folder Drive',
      'Catatan Legal',
    ];

    const rows = currentPartners.map((p) => {
      const documents = p.daftar_dokumen_dd.filter((d) => !isTerminationNoticeDocument(d));
      const wajibDocs = documents.filter((d) => d.wajib);
      const adaWajib = wajibDocs.filter((d) => d.status === 'Available');
      const totalDocs = documents.length || 1;
      const adaDocs = documents.filter((d) => d.status === 'Available').length;
      const progress = wajibDocs.length > 0
        ? Math.round((adaWajib.length / wajibDocs.length) * 100)
        : Math.round((adaDocs / totalDocs) * 100);

      const pTags = getValidPartnerTags(p.tags).join('; ');
      const pStatus = getPartnerStatus(p.partner_id);
      const activeContractsCount = getPartnerActiveContractsCount(p.partner_id);

      return [
        p.partner_id,
        `"${(p.nama_partner || '').replace(/"/g, '""')}"`,
        `"${pStatus}"`,
        `${activeContractsCount}`,
        `"${partnerCountry(p)}"`,
        `"${pTags.replace(/"/g, '""')}"`,
        `"${(p.pic_partner || '').replace(/"/g, '""')}"`,
        `"${(p.status_dd || '').replace(/"/g, '""')}"`,
        `${progress}%`,
        `${wajibDocs.length > 0 ? adaWajib.length : adaDocs}`,
        `${wajibDocs.length > 0 ? wajibDocs.length : totalDocs}`,
        p.tanggal_dd_diverifikasi || '-',
        `"${(p.link_folder_dd || '').replace(/"/g, '""')}"`,
        `"${(p.catatan || '').replace(/"/g, '""')}"`,
      ];
    });

    const csvContent =
      '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `Master_Partner_Due_Diligence_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDeleteDDFile = async (partnerId: string, docName: string, fileId: string, displayName: string) => {
    const ok = await confirmDialog({ description: t('partners.hapus_file_ini_dari_dokumen', 'Hapus file ini dari dokumen {docName}?', { docName: displayName }), tone: 'danger', confirmLabel: t('io.action_delete', 'Hapus') });
    if (!ok) return;
    try {
      const res = await fetch(`/api/partners/${partnerId}/dd-file`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          docName,
          fileId,
          userEmail: user?.email,
          userName: user?.name,
          userRole: user?.role,
        }),
      });
      const data = await res.json();
      if (data.partner) {
        setSelectedPartnerDetail(data.partner);
        onRefreshData?.();
      }
    } catch (err) {
      console.error('Error deleting DD file:', err);
    }
  };

  return (
    <div className="space-y-6">
      {subTab === 'evaluation' ? (
        <PartnerEvaluationView
          partners={partners}
          contracts={contracts}
          evaluations={evaluations}
          onRefreshData={onRefreshData || (() => {})}
          userEmail={user?.email}
          userName={user?.name}
          userRole={user?.role}
        />
      ) : (
        <>
          {/* Header */}
          <div className="ds-page-bar">
            <div>
              <h2 className="ds-page-heading">
                <span>{t('partners.header_title', 'Manajemen Partner')}</span>
              </h2>
            </div>

            <div className="mobile-page-actions flex flex-wrap items-center gap-2.5 shrink-0">
              {hasPermission('export.csv') && (
                <button
                  onClick={handleExportCSV}
                  disabled={filteredPartners.length === 0}
                  className="ui-button ui-button-lg cursor-pointer flex items-center disabled:opacity-50 disabled:cursor-not-allowed ds-button ds-button-lg ds-button-outline"
                  title={t('contracts.export_csv', 'Ekspor CSV')}
                >
                  <Download className="w-4 h-4" />
                  <span>{t('contracts.export_csv', 'Ekspor CSV')}</span>
                </button>
              )}

              {canCreatePartner(user) && (
                <button
                  onClick={onAddPartner}
                  className="ui-button ui-button-lg cursor-pointer flex items-center ds-button ds-button-lg ds-button-default"
                >
                  <Plus className="w-4 h-4 text-white" />
                  <span>{t('ui.add_partner')}</span>
                </button>
              )}
            </div>
          </div>

          {/* Filter Bar & View Toggle - Justified Responsive Grid/Flex */}
          <div className="ds-panel p-4 sm:p-5 mb-6">
            <div className="mobile-filter-grid flex flex-wrap items-center gap-2.5 w-full ds-grid">
              {/* Search Input */}
              <div className="relative flex-1 min-w-[200px] sm:min-w-[240px]">
                <Search className="w-4 h-4 text-ink-soft absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder={t('partners.search_placeholder')}
                  aria-label={t('ui.search')}
              value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="ds-input w-full pl-9 pr-3"
                />
              </div>

              {/* Partner Status Filter (Aktif / Nonaktif) */}
              <AlphabeticalSelect
                aria-label={t('ui.filter_status')}
              value={selectedPartnerStatus}
                onChange={(e) => {
                  setSelectedPartnerStatus(e.target.value);
                  setCurrentPage(1);
                }}
                className="ds-input flex-1 min-w-[130px] appearance-none pr-8"
              >
                <option value="ALL">{t('partners.all_status')}</option>
                <option value="Active">{t('partners.active')}</option>
                <option value="Nonaktif">{t('partners.inactive')}</option>
              </AlphabeticalSelect>

              {/* DD Status Filter */}
              <AlphabeticalSelect
                aria-label={t('ui.filter_dd')}
              value={selectedDDStatus}
                onChange={(e) => {
                  setSelectedDDStatus(e.target.value);
                  setCurrentPage(1);
                }}
                className="ds-input flex-1 min-w-[130px] appearance-none pr-8"
              >
                <option value="ALL">{t('partners.all_dd_status')}</option>
                <option value="Complete">{t('partners.dd_complete')}</option>
                <option value="Incomplete">{t('partners.dd_incomplete')}</option>
                <option value="Expired">{t('partners.dd_expired')}</option>
              </AlphabeticalSelect>

              {/* Country of incorporation filter */}
              <AlphabeticalSelect
                aria-label={t('partners.country_filter', 'Country of incorporation')}
              value={selectedBadanHukum}
                onChange={(e) => {
                  setSelectedBadanHukum(e.target.value);
                  setCurrentPage(1);
                }}
                className="ds-input flex-1 min-w-[130px] appearance-none pr-8"
              >
                <option value="ALL">{t('partners.all_legal_entity')}</option>
                <option value="DOMESTIC">{t('partners.domestic', 'Domestic')}</option>
                <option value="FOREIGN">{t('partners.foreign', 'Foreign')}</option>
                {Array.from(new Set(partners.map(partnerCountry).filter(Boolean))).sort().map((code) => (
                  <option key={code} value={code}>{countryLabel(code)}</option>
                ))}
              </AlphabeticalSelect>

              {/* Column Toggle */}
              <TableViewMenu title={t('io.view_settings', 'Pengaturan Tampilan Kolom')} label={t('io.view', 'View')}>
                <div className="px-3.5 py-1.5 text-xs font-bold text-ink-soft uppercase tracking-wider mb-1 border-b border-hairline">
                  {t('io.toggle_columns', 'Toggle Kolom')}
                </div>
                {Object.keys(visibleColumns).map((col) => {
                  let label = col;
                  if (col === 'nama_partner') label = t('partners.col_name', 'Nama Partner');
                  else if (col === 'channel') label = t('partners.col_channel', 'Nama Channel');
                  else if (col === 'badan_hukum') label = t('partners.col_entity', 'Badan Hukum');
                  else if (col === 'kategori') label = t('partners.col_category', 'Kategori Kerjasama');
                  else if (col === 'pic') label = t('partners.col_pic', 'PIC Partner');
                  else if (col === 'email') label = t('partners.col_email', 'Email');
                  else if (col === 'telepon') label = t('partners.col_phone', 'Telepon');
                  else if (col === 'status') label = t('partners.col_status', 'Status Partner');
                  else if (col === 'due_diligence') label = t('partners.col_dd_status', 'Status Due Diligence');

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

          {/* Partners List: TABLE VIEW */}
          <div className="ds-table-surface bg-surface border border-hairline rounded-2xl shadow-sm overflow-hidden">
              <FilterSummary filters={[{ label: t('ui.search'), value: searchTerm, active: Boolean(searchTerm) }, { label: t('ui.filter_dd'), value: selectedDDStatus, active: selectedDDStatus !== 'ALL' }, { label: t('ui.filter_country'), value: selectedBadanHukum, active: selectedBadanHukum !== 'ALL' }, { label: t('ui.filter_status'), value: selectedPartnerStatus, active: selectedPartnerStatus !== 'ALL' }, { label: t('ui.filter_department'), value: selectedDepartment, active: selectedDepartment !== 'ALL' }]} onReset={() => { setSearchTerm(''); setSelectedDDStatus('ALL'); setSelectedBadanHukum('ALL'); setSelectedPartnerStatus('ALL'); setSelectedDepartment('ALL'); }} />
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
                            checked={selectedRows.length > 0 && selectedRows.length === currentPartners.length}
                            aria-label={t('partners.select_all', 'Pilih semua partner')}
                            className="rounded-sm border-hairline text-accent-text focus:ring-accent"
                          />
                        </div>
                      </th>
                      {visibleColumns.nama_partner && renderSortHeader(t('partners.col_name', 'Nama Partner'), 'name')}
                      {visibleColumns.channel && renderSortHeader(t('partners.col_channel', 'Nama Channel'), 'channel')}
                      {visibleColumns.badan_hukum && <th scope="col" className="p-4 text-xs font-bold text-ink text-left align-middle">{t('partners.col_entity', 'Badan Hukum')}</th>}
                      {visibleColumns.kategori && renderSortHeader(t('partners.col_category', 'Kategori Kerjasama'), 'tags')}
                      {visibleColumns.pic && renderSortHeader(t('partners.col_pic', 'PIC Partner'), 'pic')}
                      {visibleColumns.email && <th scope="col" className="p-4 text-xs font-bold text-ink text-left align-middle">{t('partners.col_email', 'Email')}</th>}
                      {visibleColumns.telepon && <th scope="col" className="p-4 text-xs font-bold text-ink text-left align-middle">{t('partners.col_phone', 'Telepon')}</th>}
                      {visibleColumns.status && renderSortHeader(t('partners.col_status', 'Status Partner'), 'status')}
                      {visibleColumns.due_diligence && renderSortHeader(t('partners.col_dd_status', 'Status DD'), 'status_dd')}
                      <th data-actions="true" scope="col" className="pl-2 pr-6 py-4 text-right w-20 text-xs font-bold text-ink align-middle">
                        <div className="flex items-center justify-end">
                          {t('partners.col_action', 'Aksi')}
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {currentPartners.length === 0 ? (
                      <TableEmptyState colSpan={Object.values(visibleColumns).filter(Boolean).length + 2} />
                    ) : (
                      currentPartners.map((partner) => {
                        const pStatus = getPartnerStatus(partner.partner_id);

                        return (
                          <tr key={partner.partner_id} className="hover:bg-surface dark:hover:bg-surface-2/50 transition-colors">
                            <td className="pl-6 pr-2 py-4 text-left align-middle">
                              <div className="flex items-center justify-start">
                                <input
                                  type="checkbox"
                                  checked={selectedRows.includes(partner.partner_id)}
                                  onChange={() => handleSelectRow(partner.partner_id)}
                                  aria-label={t('partners.pilih', 'Pilih {nama_partner}', { nama_partner: partner.nama_partner })}
                                  className="rounded-sm border-hairline text-accent-text focus:ring-accent"
                                />
                              </div>
                            </td>

                            {/* 1. Nama Partner */}
                            {visibleColumns.nama_partner && (
                              <td className="py-4 px-4 text-xs font-semibold text-ink text-left">
                                {partner.nama_partner}
                              </td>
                            )}

                            {visibleColumns.channel && (
                              <td className="py-4 px-4 text-xs font-normal text-ink text-left">
                                {partner.codename || '—'}
                              </td>
                            )}

                            {/* 2. Country */}
                            {visibleColumns.badan_hukum && (
                              <td className="py-4 px-4 text-xs font-normal text-ink text-left">
                                <span className={`text-xs font-normal px-3 py-0.5 rounded-full border inline-flex items-center justify-center whitespace-nowrap shadow-2xs ${getStatusBadgeClass(partnerCountry(partner) === homeCountry ? 'BHI' : 'BHA')}`}>
                                  {partnerCountry(partner) || '—'}
                                </span>
                              </td>
                            )}

                            {visibleColumns.kategori && (
                              <td className="py-4 px-4 text-xs font-normal text-ink text-left">
                                {getValidPartnerTags(partner.tags).length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {getValidPartnerTags(partner.tags).map((tag) => (
                                      <span key={tag} className="px-2 py-0.5 rounded-full border border-hairline bg-surface whitespace-nowrap">
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  '—'
                                )}
                              </td>
                            )}

                            {/* 3. PIC Partner */}
                            {visibleColumns.pic && (
                              <td className="py-4 px-4 text-xs font-normal text-ink text-left">
                                {partner.nama_pic || partner.pic_partner || '-'}
                              </td>
                            )}

                            {visibleColumns.email && (
                              <td className="py-4 px-4 text-xs font-normal text-ink text-left whitespace-nowrap">
                                {partner.email_pic ? (
                                  <a href={`mailto:${partner.email_pic}`} className="hover:underline hover:text-accent-text">
                                    {partner.email_pic}
                                  </a>
                                ) : (
                                  '—'
                                )}
                              </td>
                            )}

                            {visibleColumns.telepon && (
                              <td className="py-4 px-4 text-xs font-normal text-ink text-left whitespace-nowrap">
                                {partner.telepon_pic ? (
                                  <a href={`tel:${partner.telepon_pic.replace(/[^\d+]/g, '')}`} className="hover:underline hover:text-accent-text">
                                    {partner.telepon_pic}
                                  </a>
                                ) : (
                                  '—'
                                )}
                              </td>
                            )}

                            {/* 4. Status Partner */}
                            {visibleColumns.status && (
                              <td className="py-4 px-4 text-xs font-normal text-ink text-left">
                                {pStatus === 'Active' ? (
                                  <span className={`text-xs font-normal px-3 py-0.5 rounded-full border inline-flex items-center gap-1.5 shadow-2xs whitespace-nowrap ${getStatusBadgeClass('Aktif')}`}>
                                    <span>{t('status.aktif', 'Aktif')}</span>
                                  </span>
                                ) : (
                                  <span className={`text-xs font-normal px-3 py-0.5 rounded-full border inline-flex items-center gap-1.5 shadow-2xs whitespace-nowrap ${getStatusBadgeClass('Inactive')}`}>
                                    <span>{t('status.nonaktif', 'Nonaktif')}</span>
                                  </span>
                                )}
                              </td>
                            )}

                            {/* 5. Status Due Diligence */}
                            {visibleColumns.due_diligence && (
                              <td className="py-4 px-4 text-xs font-normal text-ink text-left">
                                <button
                                  onClick={() => setSelectedPartnerDetail(partner)}
                                  className={`text-xs font-normal px-3 py-0.5 rounded-full border inline-flex items-center gap-1.5 transition-all hover:scale-105 hover:shadow-xs cursor-pointer ${getDDStatusBadge(
                                    partner.status_dd
                                  )}`}
                                  title={t('partners.klik_untuk_audit_checklist_due_diligence', 'Klik untuk Audit Checklist Due Diligence')}
                                >
                                  {partner.status_dd === 'Complete' && <CheckCircle2 className="w-3.5 h-3.5 text-accent-text" />}
                                  {partner.status_dd === 'Incomplete' && <Clock className="w-3.5 h-3.5 text-status-warning" />}
                                  {partner.status_dd === 'Expired' && <AlertTriangle className="w-3.5 h-3.5 text-status-danger" />}
                                  <span>{t(DD_STATUS_LABEL_KEY[partner.status_dd] || 'status.dd_incomplete', partner.status_dd)}</span>
                                </button>
                              </td>
                            )}

                            {/* Aksi */}
                            <td data-actions="true" className="pl-2 pr-6 py-4 text-right align-middle w-20">
                              <div className="flex items-center justify-end">
                                <ActionMenu
                                  items={[
                                    {
                                      label: t('partners.audit_dd', 'Audit DD'),
                                      icon: <FileCheck2 className="w-3.5 h-3.5" />,
                                      onClick: () => setSelectedPartnerDetail(partner),
                                    },
                                    ...(canEditPartner(partner, user)
                                      ? [
                                          {
                                            label: t('hierarchy.edit_btn', 'Edit'),
                                            icon: <Edit2 className="w-3.5 h-3.5" />,
                                            onClick: () => onEditPartner(partner),
                                          },
                                        ]
                                      : []),
                                    ...(canDeletePartner(user)
                                      ? [
                                          {
                                            label: t('io.action_delete', 'Hapus'),
                                            icon: <Trash2 className="w-3.5 h-3.5" />,
                                            onClick: () => onDeletePartner(partner.partner_id, partner.nama_partner),
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
                currentPage={currentPage}
                totalPages={totalPages}
                rowsPerPage={rowsPerPage}
                onPageChange={setCurrentPage}
                onRowsPerPageChange={(size) => {
                  setRowsPerPage(size);
                  setCurrentPage(1);
                }}
              />
            </div>

      {/* Due Diligence Audit Modal */}
      {selectedPartnerDetail && (
        <ModalFrame onClose={() => setSelectedPartnerDetail(null)} className="max-w-4xl w-full max-h-[92dvh] flex flex-col overflow-hidden">

            {/* Header */}
            <div className="ds-section-header">
              <div>
                <ModalTitle className="ds-modal-title flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-accent-text" />
                  <span>{selectedPartnerDetail.nama_partner}</span>
                </ModalTitle>
                <p className="text-xs text-ink-soft mt-0.5">
                  {t('partners.status_dd', 'Status DD:')} <strong className="text-ink">{selectedPartnerDetail.status_dd}</strong> {t('partners.pic', '• PIC: {pic_partner}', { pic_partner: selectedPartnerDetail.pic_partner })}
                </p>
              </div>

              <button aria-label={t('common.close', 'Tutup')}
                type="button"
                onClick={() => setSelectedPartnerDetail(null)}
                className="inline-flex items-center justify-center text-ink-soft hover:text-ink size-8 rounded-md hover:bg-surface-2 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-xs flex-1">
              {/* Due Diligence Narrative Profile */}
              {selectedPartnerDetail.catatan && (
                <div className="ds-panel p-4 space-y-1.5">
                  <h4 className="text-xs font-bold text-accent-text flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-accent-text" />
                    <span>{t('partners.profil_due_diligence_operasional_vendor_senior', 'Profil Due Diligence & Operasional Vendor (Senior Risk Analyst)')}</span>
                  </h4>
                  <p className="text-xs text-ink leading-relaxed font-medium">
                    {selectedPartnerDetail.catatan}
                  </p>
                </div>
              )}

              {/* Checklist Items List with Upload Trigger */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-ink">
                    {t('partners.req_docs_title', 'Dokumen Due Diligence')}
                  </h4>
                  <span className="text-xs text-ink-soft font-medium">
                    {t('partners.nda_bersifat_wajib_dokumen_lain_opsional', '* NDA bersifat Wajib, dokumen lain Opsional')}
                  </span>
                </div>

                {(selectedPartnerDetail.daftar_dokumen_dd || []).filter((doc) => !isTerminationNoticeDocument(doc)).map((doc) => {
                  const displayName = localizeDueDiligenceDocument(doc, policy.dueDiligenceChecklist, language);
                  const docFiles = doc.files && doc.files.length > 0
                    ? doc.files
                    : doc.linkDrive
                    ? [
                        {
                          id: 'legacy_' + doc.nama,
                          fileName: `${doc.nama}.pdf`,
                          linkDrive: doc.linkDrive,
                          uploadedAt: doc.uploadedAt || '',
                          year: doc.uploadedAt ? new Date(doc.uploadedAt).getFullYear().toString() : '',
                          tanggalKadaluarsa: doc.tanggalKadaluarsa,
                        },
                      ]
                    : [];

                  return (
                    <div
                      key={doc.nama}
                      className="ds-panel p-3.5 sm:p-4 space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center flex-wrap gap-2">
                          <span className="font-bold text-xs text-ink">{displayName}</span>

                          {/* Wajib / Opsional Pill Badge (Refined) */}
                          {doc.wajib ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border border-status-danger-border/40 bg-status-danger/10 dark:bg-status-danger-soft/40 text-status-danger uppercase tracking-wide">
                              {t('settings.region.dd_required', 'Wajib')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border border-hairline bg-surface-2 dark:bg-surface-2/80 text-ink-soft uppercase tracking-wide">
                              {t('contract_creator.optional_badge', 'Opsional')}
                            </span>
                          )}

                          {/* Status Ada / Belum / Kadaluarsa Pill Badge */}
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                              doc.status === 'Available'
                                ? 'border-status-success-border/40 bg-status-success/10 dark:bg-status-success-soft/50 text-status-success '
                                : doc.status === 'Expired'
                                ? 'border-status-danger-border/40 bg-status-danger/10 dark:bg-status-danger-soft/50 text-status-danger '
                                : 'border-status-warning-border/40 bg-status-warning/10 dark:bg-status-warning-soft/50 text-status-warning '
                            }`}
                          >
                            {t(DOC_STATUS_LABEL_KEY[doc.status] || 'status.doc_missing', doc.status)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setUploadModalState({
                                partner: selectedPartnerDetail,
                                docName: doc.nama,
                              });
                            }}
                            className="px-3 min-h-8 bg-accent-strong hover:bg-accent-strong-hover text-white rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                          >
                            <Upload className="w-3 h-3" />
                            <span>{t('partners.upload_file', 'Upload File')}</span>
                          </button>
                        </div>
                      </div>

                      {/* Multiple Files list for this DD Requirement */}
                      {docFiles.length > 0 && (
                        <div className="pt-2.5 border-t border-hairline dark:border-hairline/80 space-y-1.5">
                          {docFiles.map((f, fIdx) => (
                            <div
                              key={f.id || fIdx}
                              className="ds-panel px-3 py-2 flex items-center justify-between gap-2"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <FileText className="w-3.5 h-3.5 text-accent-text shrink-0" />
                                <span className="text-xs font-medium text-ink truncate">
                                  {f.fileName || `${doc.nama}.pdf`}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {f.linkDrive && (
                                  <a
                                    href={f.linkDrive}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-2.5 py-1 bg-status-success-soft hover:bg-status-success-soft text-accent-text rounded-sm text-xs font-medium transition-colors flex items-center gap-1 border border-status-success-border/30"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    <span>{t('partners.view_file', 'Lihat File')}</span>
                                  </a>
                                )}
                                {isLegal && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteDDFile(selectedPartnerDetail.partner_id, doc.nama, f.id, displayName)}
                                    className="inline-flex items-center justify-center size-8 text-ink-soft hover:text-status-danger rounded-sm transition-colors cursor-pointer"
                                    title={t('partners.hapus_file_ini', 'Hapus file ini')}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-4 sm:p-5 bg-canvas border-t border-hairline flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setSelectedPartnerDetail(null)}
                className="inline-flex items-center px-4 min-h-8 bg-ink hover:bg-ink text-white font-semibold rounded-md text-xs transition-colors cursor-pointer"
              >
                {t('partners.audit_done')}
              </button>
            </div>

        </ModalFrame>
      )}

      {/* Upload Due Diligence Document to Vendor's Drive Modal */}
      {uploadModalState && (
        <UploadDDModal
          partner={uploadModalState.partner}
          docName={uploadModalState.docName}
          isOpen={true}
          onClose={() => setUploadModalState(null)}
          onSuccess={(updatedPartner) => {
            setSelectedPartnerDetail(updatedPartner);
            onRefreshData?.();
          }}
          getAuthHeaders={getAuthHeaders}
          userEmail={user?.email}
          userName={user?.name}
          userRole={user?.role}
        />
      )}
        </>
      )}
    </div>
  );
};
