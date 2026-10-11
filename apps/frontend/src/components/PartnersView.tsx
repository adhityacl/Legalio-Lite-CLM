import { ModalFrame } from './ui/modal-frame';
import { TableViewMenu, TableViewOption } from './ui/table-view-menu';
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
import { Badge, statusTone } from '@legalio/ui-components/badge';
import { getSavedColumnPreferences, saveColumnPreferences } from '../lib/tablePreferences';
import { UploadDDModal } from './UploadDDModal';
import { getAuthHeaders } from '../lib/apiFetch';
import { usePermissions } from '../lib/permissions';

import { TableColumnHeader, Table, TableHeader, TableRow, TableBody, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { Button } from '@legalio/ui-components/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { DialogHeader, DialogTitle } from '@legalio/ui-components/dialog';
import { Checkbox, CheckboxControl, CheckboxHiddenInput } from '@legalio/ui-components/checkbox';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Text } from '@legalio/ui-components/text';
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
  const [rowsPerPage, setRowsPerPage] = useState(5);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) setSelectedRows(sortedPartners.map(item => item.partner_id));
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
    return statusTone(status);
  };

  const renderSortHeader = (label: string, field: SortField) => {
    const isSorted = sortField === field;
    return (
      <TableColumnHeader
        scope="col"
        aria-sort={isSorted ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
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
        </Button></TooltipTrigger><TooltipBody>{t('partners.urutkan_berdasarkan', 'Urutkan berdasarkan {label}', { label })}</TooltipBody></Tooltip>
      </TableColumnHeader>
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
    <div className="space-y-g21">
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
          <div className="flex flex-wrap items-center justify-between gap-g13">
            <div>
              <Heading as="h2" size="md" weight="semibold">
                <span>{t('partners.header_title', 'Manajemen Partner')}</span>
              </Heading>
            </div>

            <div className="flex flex-wrap items-center gap-g8 shrink-0">
              {hasPermission('export.csv') && (
                <Tooltip><TooltipTrigger asChild><Button variant="outline"
                  onClick={handleExportCSV}
                  disabled={filteredPartners.length === 0} aria-label={t('contracts.export_csv', 'Ekspor CSV')}
                >
                  <Download className="w-g16 h-g16" />
                  <span>{t('contracts.export_csv', 'Ekspor CSV')}</span>
                </Button></TooltipTrigger><TooltipBody>{t('contracts.export_csv', 'Ekspor CSV')}</TooltipBody></Tooltip>
              )}

              {canCreatePartner(user) && (
                <Button
                  onClick={onAddPartner}
                >
                  <Plus className="w-g16 h-g16" />
                  <span>{t('ui.add_partner')}</span>
                </Button>
              )}
            </div>
          </div>

          {/* Filter Bar & View Toggle - Justified Responsive Grid/Flex */}
          <Card className="p-g13">
            <div className="flex w-full flex-wrap items-center gap-g13">
              {/* Search Input */}
              <InputGroup className="relative flex-1 min-w-g233 sm:min-w-g233">
                <InputGroupAddon><Search className="size-g16" aria-hidden="true" /></InputGroupAddon>
                <InputGroupInput
                  type="text"
                  placeholder={t('partners.search_placeholder')}
                  aria-label={t('ui.search')}
              value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                />
              </InputGroup>

              {/* Partner Status Filter (Aktif / Nonaktif) */}
              <AlphabeticalSelect
                aria-label={t('ui.filter_status')}
              value={selectedPartnerStatus}
                onChange={(e) => {
                  setSelectedPartnerStatus(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
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
                className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
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
                className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
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
                    <TableViewOption key={col} value={col} checked={visibleColumns[col]} onToggle={() => toggleColumnVisibility(col)}>{label}</TableViewOption>
                  );
                })}
              </TableViewMenu>
          </div>
        </Card>

          {/* Partners List: TABLE VIEW */}
          <Card className="overflow-hidden">
              <FilterSummary filters={[{ label: t('ui.search'), value: searchTerm, active: Boolean(searchTerm) }, { label: t('ui.filter_dd'), value: selectedDDStatus, active: selectedDDStatus !== 'ALL' }, { label: t('ui.filter_country'), value: selectedBadanHukum, active: selectedBadanHukum !== 'ALL' }, { label: t('ui.filter_status'), value: selectedPartnerStatus, active: selectedPartnerStatus !== 'ALL' }, { label: t('ui.filter_department'), value: selectedDepartment, active: selectedDepartment !== 'ALL' }]} onReset={() => { setSearchTerm(''); setSelectedDDStatus('ALL'); setSelectedBadanHukum('ALL'); setSelectedPartnerStatus('ALL'); setSelectedDepartment('ALL'); }} />
        <Text size="xs" tone="muted" className="px-g13 py-g8 md:hidden">{t('ui.scroll_table')}</Text>
        <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.scroll_table')}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableColumnHeader scope="col" className="w-g42">
                        <div className="flex items-center justify-start">
                          <Checkbox checked={selectedRows.length > 0 && selectedRows.length === currentPartners.length} aria-label={t('partners.select_all', 'Pilih semua partner')} onCheckedChange={(details) => handleSelectAll(details.checked === true)}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                        </div>
                      </TableColumnHeader>
                      {visibleColumns.nama_partner && renderSortHeader(t('partners.col_name', 'Nama Partner'), 'name')}
                      {visibleColumns.channel && renderSortHeader(t('partners.col_channel', 'Nama Channel'), 'channel')}
                      {visibleColumns.badan_hukum && <TableColumnHeader scope="col">{t('partners.col_entity', 'Badan Hukum')}</TableColumnHeader>}
                      {visibleColumns.kategori && renderSortHeader(t('partners.col_category', 'Kategori Kerjasama'), 'tags')}
                      {visibleColumns.pic && renderSortHeader(t('partners.col_pic', 'PIC Partner'), 'pic')}
                      {visibleColumns.email && <TableColumnHeader scope="col">{t('partners.col_email', 'Email')}</TableColumnHeader>}
                      {visibleColumns.telepon && <TableColumnHeader scope="col">{t('partners.col_phone', 'Telepon')}</TableColumnHeader>}
                      {visibleColumns.status && renderSortHeader(t('partners.col_status', 'Status Partner'), 'status')}
                      {visibleColumns.due_diligence && renderSortHeader(t('partners.col_dd_status', 'Status DD'), 'status_dd')}
                      <TableColumnHeader data-actions="true" scope="col" className="text-right w-g89">
                        <div className="flex items-center justify-end">
                          {t('partners.col_action', 'Aksi')}
                        </div>
                      </TableColumnHeader>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentPartners.length === 0 ? (
                      <TableEmptyState colSpan={Object.values(visibleColumns).filter(Boolean).length + 2} />
                    ) : (
                      currentPartners.map((partner) => {
                        const pStatus = getPartnerStatus(partner.partner_id);

                        return (
                          <TableRow key={partner.partner_id}>
                            <TableCell>
                              <div className="flex items-center justify-start">
                                <Checkbox checked={selectedRows.includes(partner.partner_id)} aria-label={t('partners.pilih', 'Pilih {nama_partner}', { nama_partner: partner.nama_partner })} onCheckedChange={() => handleSelectRow(partner.partner_id)}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                              </div>
                            </TableCell>

                            {/* 1. Nama Partner */}
                            {visibleColumns.nama_partner && (
                              <TableCell>
                                {partner.nama_partner}
                              </TableCell>
                            )}

                            {visibleColumns.channel && (
                              <TableCell>
                                {partner.codename || '—'}
                              </TableCell>
                            )}

                            {/* 2. Country */}
                            {visibleColumns.badan_hukum && (
                              <TableCell>
                                <Badge tone={statusTone(partnerCountry(partner) === homeCountry ? 'BHI' : 'BHA')}>
                                  {partnerCountry(partner) || '—'}
                                </Badge>
                              </TableCell>
                            )}

                            {visibleColumns.kategori && (
                              <TableCell>
                                {getValidPartnerTags(partner.tags).length > 0 ? (
                                  <div className="flex flex-wrap gap-g3">
                                    {getValidPartnerTags(partner.tags).map((tag) => (
                                      <Badge tone="neutral" className="whitespace-nowrap" key={tag}>{tag}</Badge>
                                    ))}
                                  </div>
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                            )}

                            {/* 3. PIC Partner */}
                            {visibleColumns.pic && (
                              <TableCell>
                                {partner.nama_pic || partner.pic_partner || '-'}
                              </TableCell>
                            )}

                            {visibleColumns.email && (
                              <TableCell className="whitespace-nowrap">
                                {partner.email_pic ? (
                                  <Button asChild variant="link"><a href={`mailto:${partner.email_pic}`} >
                                    {partner.email_pic}
                                  </a></Button>
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                            )}

                            {visibleColumns.telepon && (
                              <TableCell className="whitespace-nowrap">
                                {partner.telepon_pic ? (
                                  <Button asChild variant="link"><a href={`tel:${partner.telepon_pic.replace(/[^\d+]/g, '')}`} >
                                    {partner.telepon_pic}
                                  </a></Button>
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                            )}

                            {/* 4. Status Partner */}
                            {visibleColumns.status && (
                              <TableCell>
                                {pStatus === 'Active' ? (
                                  <Badge tone={statusTone('Aktif')}>
                                    <span>{t('status.aktif', 'Aktif')}</span>
                                  </Badge>
                                ) : (
                                  <Badge tone={statusTone('Inactive')}>
                                    <span>{t('status.nonaktif', 'Nonaktif')}</span>
                                  </Badge>
                                )}
                              </TableCell>
                            )}

                            {/* 5. Status Due Diligence */}
                            {visibleColumns.due_diligence && (
                              <TableCell>
                                <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" className="h-auto px-g3" onClick={() => setSelectedPartnerDetail(partner)} aria-label={t('partners.klik_untuk_audit_checklist_due_diligence', 'Klik untuk Audit Checklist Due Diligence')}>
                                  <Badge tone={getDDStatusBadge(partner.status_dd)}>
                                  {partner.status_dd === 'Complete' && <CheckCircle2 className="w-g13 h-g13 text-accent-foreground" />}
                                  {partner.status_dd === 'Incomplete' && <Clock className="w-g13 h-g13 text-status-warning" />}
                                  {partner.status_dd === 'Expired' && <AlertTriangle className="w-g13 h-g13 text-status-danger" />}
                                  {t(DD_STATUS_LABEL_KEY[partner.status_dd] || 'status.dd_incomplete', partner.status_dd)}
                                  </Badge>
                                </Button></TooltipTrigger><TooltipBody>{t('partners.klik_untuk_audit_checklist_due_diligence', 'Klik untuk Audit Checklist Due Diligence')}</TooltipBody></Tooltip>
                              </TableCell>
                            )}

                            {/* Aksi */}
                            <TableCell data-actions="true" className="text-right w-g89">
                              <div className="flex items-center justify-end">
                                <ActionMenu
                                  items={[
                                    {
                                      label: t('partners.audit_dd', 'Audit DD'),
                                      icon: <FileCheck2 className="w-g13 h-g13" />,
                                      onClick: () => setSelectedPartnerDetail(partner),
                                    },
                                    ...(canEditPartner(partner, user)
                                      ? [
                                          {
                                            label: t('hierarchy.edit_btn', 'Edit'),
                                            icon: <Edit2 className="w-g13 h-g13" />,
                                            onClick: () => onEditPartner(partner),
                                          },
                                        ]
                                      : []),
                                    ...(canDeletePartner(user)
                                      ? [
                                          {
                                            label: t('io.action_delete', 'Hapus'),
                                            icon: <Trash2 className="w-g13 h-g13" />,
                                            onClick: () => onDeletePartner(partner.partner_id, partner.nama_partner),
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

      {/* Due Diligence Audit Modal */}
      {selectedPartnerDetail && (
        <ModalFrame onClose={() => setSelectedPartnerDetail(null)} className="max-w-g987 w-full flex flex-col overflow-hidden">

            {/* Header */}
            <DialogHeader className="flex items-center justify-between gap-g13 border-b border-border px-g21 py-g13">
              <div>
                <DialogTitle className="flex items-center gap-g8">
                  <Building2 className="w-g21 h-g21 text-accent-foreground" />
                  <span>{selectedPartnerDetail.nama_partner}</span>
                </DialogTitle>
                <Text size="xs" tone="muted" className="mt-g2">
                  {t('partners.status_dd', 'Status DD:')} <strong className="text-foreground">{selectedPartnerDetail.status_dd}</strong> {t('partners.pic', '• PIC: {pic_partner}', { pic_partner: selectedPartnerDetail.pic_partner })}
                </Text>
              </div>

              <Button variant="secondary" size="icon-sm" aria-label={t('common.close', 'Tutup')}
                type="button"
                onClick={() => setSelectedPartnerDetail(null)}
              >
                <X className="w-g21 h-g21" />
              </Button>
            </DialogHeader>

            <div className="p-g21 sm:p-g21 overflow-y-auto space-y-g13 text-xs flex-1">
              {/* Due Diligence Narrative Profile */}
              {selectedPartnerDetail.catatan && (
                <Card className="p-g13 space-y-g5">
                  <Heading as="h4" size="xs" weight="bold" className="text-accent-foreground flex items-center gap-g5">
                    <ShieldCheck className="w-g16 h-g16 text-accent-foreground" />
                    <span>{t('partners.profil_due_diligence_operasional_vendor_senior', 'Profil Due Diligence & Operasional Vendor (Senior Risk Analyst)')}</span>
                  </Heading>
                  <Text size="xs" weight="medium" className="leading-relaxed">
                    {selectedPartnerDetail.catatan}
                  </Text>
                </Card>
              )}

              {/* Checklist Items List with Upload Trigger */}
              <div className="space-y-g13">
                <div className="flex items-center justify-between">
                  <Heading as="h4" size="xs" weight="bold" className="uppercase tracking-wider">
                    {t('partners.req_docs_title', 'Dokumen Due Diligence')}
                  </Heading>
                  <Text as="span" size="xs" weight="medium" tone="muted">
                    {t('partners.nda_bersifat_wajib_dokumen_lain_opsional', '* NDA bersifat Wajib, dokumen lain Opsional')}
                  </Text>
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
                    <Card
                      key={doc.nama}
                      className="p-g13 sm:p-g13 space-y-g13"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-g13">
                        <div className="flex items-center flex-wrap gap-g8">
                          <Text as="span" size="xs" weight="bold">{displayName}</Text>

                          {/* Wajib / Opsional Pill Badge (Refined) */}
                          {doc.wajib ? (
                            <Badge tone="danger" className="uppercase">{t('settings.region.dd_required', 'Wajib')}</Badge>
                          ) : (
                            <Badge tone="neutral" className="uppercase">{t('contract_creator.optional_badge', 'Opsional')}</Badge>
                          )}

                          {/* Status Ada / Belum / Kadaluarsa Pill Badge */}
                          <span
                            className={`inline-flex items-center px-g8 py-g2 rounded-full text-xs font-semibold border ${
 doc.status === 'Available'
 ? 'border-status-success-border/40 bg-status-success/10 text-status-success '
 : doc.status === 'Expired'
 ? 'border-status-danger-border/40 bg-status-danger/10 text-status-danger '
 : 'border-status-warning-border/40 bg-status-warning/10 text-status-warning '
 }`}
                          >
                            {t(DOC_STATUS_LABEL_KEY[doc.status] || 'status.doc_missing', doc.status)}
                          </span>
                        </div>

                        <div className="flex items-center gap-g8 shrink-0">
                          <Button variant="ghost" size="sm"
                            type="button"
                            onClick={() => {
                              setUploadModalState({
                                partner: selectedPartnerDetail,
                                docName: doc.nama,
                              });
                            }}
                          >
                            <Upload className="w-g13 h-g13" />
                            <span>{t('partners.upload_file', 'Upload File')}</span>
                          </Button>
                        </div>
                      </div>

                      {/* Multiple Files list for this DD Requirement */}
                      {docFiles.length > 0 && (
                        <div className="pt-g8 border-t border-border space-y-g5">
                          {docFiles.map((f, fIdx) => (
                            <Card
                              key={f.id || fIdx}
                              className="px-g13 py-g8 flex items-center justify-between gap-g8"
                            >
                              <div className="flex items-center gap-g8 min-w-0">
                                <FileText className="w-g13 h-g13 text-accent-foreground shrink-0" />
                                <Text as="span" size="xs" weight="medium" truncate>
                                  {f.fileName || `${doc.nama}.pdf`}
                                </Text>
                              </div>

                              <div className="flex items-center gap-g5 shrink-0">
                                {f.linkDrive && (
                                  <Button asChild variant="outline" size="sm"><a href={f.linkDrive}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    
                                  >
                                    <ExternalLink className="w-g13 h-g13" />
                                    <span>{t('partners.view_file', 'Lihat File')}</span>
                                  </a></Button>
                                )}
                                {isLegal && (
                                  <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm"
                                    type="button"
                                    onClick={() => handleDeleteDDFile(selectedPartnerDetail.partner_id, doc.nama, f.id, displayName)}
                                    className="text-destructive" aria-label={t('partners.hapus_file_ini', 'Hapus file ini')}
                                  >
                                    <Trash2 className="w-g13 h-g13" />
                                  </Button></TooltipTrigger><TooltipBody>{t('partners.hapus_file_ini', 'Hapus file ini')}</TooltipBody></Tooltip>
                                )}
                              </div>
                            </Card>
                          ))}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>

            <div className="p-g13 sm:p-g21 bg-background border-t border-border flex justify-end shrink-0">
              <Button variant="ghost" size="sm"
                type="button"
                onClick={() => setSelectedPartnerDetail(null)}
              >
                {t('partners.audit_done')}
              </Button>
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
