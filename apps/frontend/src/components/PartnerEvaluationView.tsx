import { TableViewMenu } from './ui/table-view-menu';
import { downloadCsv } from '../lib/csv';
import { AlphabeticalSelect } from './ui/alphabetical-select';
import { ModalFrame, ModalTitle } from './ui/modal-frame';
import { formatBusinessDate } from '../lib/displayDate';
import { FilterSummary } from './ui/filter-summary';
import { TableEmptyState } from './ui/table-empty-state';
import React, { useState } from 'react';
import { Partner, PartnerEvaluation, Contract } from '@legalio/types';
import { DateInput } from './DateInput';
import { XCircle, Clock, Filter, ClipboardCheck,
  Plus,
  Search,
  Download,
  Calendar,
  Building2,
  AlertCircle,
  CheckCircle2,
  X,
  Edit2,
  Trash2,
  Award,
  FileText,
  Calculator,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { ActionMenu } from './ui/action-menu';
import { TablePagination } from './ui/TablePagination';
import { getStatusBadgeClass } from '@legalio/ui-components/badge';
import { getSavedColumnPreferences, saveColumnPreferences } from '../lib/tablePreferences';
import { getCachedAccessToken } from '../lib/googleAuthService';
import { useLanguage } from '../context/LanguageContext';
import { useConfirm } from '../context/ConfirmDialogContext';
import { useAlertToast } from '../context/AlertToastContext';
import { usePermissions } from '../lib/permissions';

interface PartnerEvaluationViewProps {
  partners: Partner[];
  contracts?: Contract[];
  evaluations: PartnerEvaluation[];
  onRefreshData: () => void;
  userEmail?: string;
  userName?: string;
  userRole?: string;
}

export const computeScoreFromFields = (
  obligationTarget: string,
  incidentFreq: string,
  comm: string,
  pricing: string
): number => {
  let targetScore = 10;
  if (obligationTarget === 'Sangat baik' || obligationTarget === 'Met') targetScore = 30;
  else if (obligationTarget === 'Baik') targetScore = 20;
  else if (obligationTarget === 'Kurang baik' || obligationTarget === 'Not met') targetScore = 10;

  let incidentScore = 10;
  if (incidentFreq === 'Never') incidentScore = 20;
  else if (incidentFreq === 'Rare') incidentScore = 15;
  else if (incidentFreq === 'Frequent') incidentScore = 10;

  let commScore = 10;
  if (comm === 'Sangat baik' || comm === 'Good') commScore = 20;
  else if (comm === 'Baik') commScore = 15;
  else if (comm === 'Kurang baik' || comm === 'Poor/Needs Improvement') commScore = 10;

  let pricingScore = 10;
  if (pricing === 'Cheap') pricingScore = 30;
  else if (pricing === 'Moderate') pricingScore = 20;
  else if (pricing === 'Expensive') pricingScore = 10;

  return targetScore + incidentScore + commScore + pricingScore;
};

export const PartnerEvaluationView: React.FC<PartnerEvaluationViewProps> = ({
  partners,
  contracts = [],
  evaluations = [],
  onRefreshData,
  userEmail,
  userName,
  userRole,
}) => {
  const { hasPermission } = usePermissions();
  const { t } = useLanguage();
  const confirmDialog = useConfirm();
  const showAlert = useAlertToast();

  const DEFAULT_EVAL_COLUMNS = {
    vendor: true,
    target: true,
    skor: true,
    hasil: true,
    tanggal: true,
  };

  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() =>
    getSavedColumnPreferences('evaluations', DEFAULT_EVAL_COLUMNS)
  );
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

  const toggleColumnVisibility = (id: string) => {
    setVisibleColumns((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveColumnPreferences('evaluations', next);
      return next;
    });
  };

  const [selectedYear, setSelectedYear] = useState<string>(() => {
    return new Date().getFullYear().toString();
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEvaluationFilter, setSelectedEvaluationFilter] = useState<string>('ALL');
  const [selectedObligationTarget, setSelectedObligationTarget] = useState<string>('ALL');
  const filterStatus = selectedEvaluationFilter;
  const filterYear = selectedYear;

  const [showFormModal, setShowFormModal] = useState(false);
  const canCreateEvaluation = hasPermission('document.create');
  const canEditEvaluation = hasPermission('document.edit');
  const canDeleteEvaluation = hasPermission('document.delete');

  const handleInputNotReviewed = (item: PartnerEvaluation) => {
    if (!canCreateEvaluation) return;
    const newItem = { ...item, id: '', created_at: '', updated_at: '' };
    setEditingItem(newItem);
    setFormData({
      review_date: newItem.review_date || new Date().toISOString().split('T')[0],
      partner_id: newItem.partner_id || '',
      supplier_name: newItem.supplier_name || '',
      type_of_work: newItem.type_of_work || 'General Service',
      obligation_target: newItem.obligation_target || 'Kurang baik',
      incident_frequency: newItem.incident_frequency || 'Frequent',
      communication: newItem.communication || 'Kurang baik',
      pricing: newItem.pricing || 'Expensive',
      final_evaluation: newItem.final_evaluation === 'Not reviewed' ? 'Not recommended' : newItem.final_evaluation,
      notes: newItem.notes || ''
    });
    setShowFormModal(true);
  };

  const handleOpenEditModal = (item: PartnerEvaluation, mode?: any) => {
    if (!canEditEvaluation) return;
    setEditingItem(item);
    setFormData({
      review_date: item.review_date || new Date().toISOString().split('T')[0],
      partner_id: item.partner_id || '',
      supplier_name: item.supplier_name || '',
      type_of_work: item.type_of_work || 'General Service',
      obligation_target: item.obligation_target || 'Sangat baik',
      incident_frequency: item.incident_frequency || 'Never',
      communication: item.communication || 'Sangat baik',
      pricing: item.pricing || 'Moderate',
      final_evaluation: item.final_evaluation || 'Recommended',
      notes: item.notes || ''
    });
    setShowFormModal(true);
  };

  const [formData, setFormData] = useState<any>({
    review_date: new Date().toISOString().split('T')[0],
    partner_id: '',
    supplier_name: '',
    type_of_work: 'General Service',
    obligation_target: 'Sangat baik',
    incident_frequency: 'Never',
    communication: 'Sangat baik',
    pricing: 'Moderate',
    final_evaluation: 'Recommended',
    notes: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError('');

    try {
      const isEdit = editingItem && editingItem.id && !editingItem.id.startsWith('NOT_REVIEWED');
      const url = isEdit ? `/api/partner-evaluations/${editingItem.id}` : '/api/partner-evaluations';
      const method = isEdit ? 'PUT' : 'POST';

      const payload = {
        ...formData,
        userEmail,
        userName,
        userRole,
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('eval.terjadi_kesalahan_saat_menyimpan_evaluasi', 'Terjadi kesalahan saat menyimpan evaluasi.'));
      }

      onRefreshData();
      setShowFormModal(false);
    } catch (err: any) {
      setFormError(err.message || t('eval.gagal_menyimpan_data', 'Gagal menyimpan data.'));
      console.warn(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const calculateLiveBreakdown = () => {
    let tScore = 10;
    if (formData.obligation_target === 'Sangat baik' || formData.obligation_target === 'Met' || formData.obligation_target === 'Very Good') tScore = 30;
    else if (formData.obligation_target === 'Baik' || formData.obligation_target === 'Good') tScore = 20;

    let fScore = 10;
    if (formData.incident_frequency === 'Never') fScore = 20;
    else if (formData.incident_frequency === 'Rare') fScore = 15;

    let cScore = 10;
    if (formData.communication === 'Sangat baik' || formData.communication === 'Good' || formData.communication === 'Very Good') cScore = 20;
    else if (formData.communication === 'Baik') cScore = 15;

    let pScore = 10;
    if (formData.pricing === 'Cheap') pScore = 30;
    else if (formData.pricing === 'Moderate') pScore = 20;

    return {
      tScore,
      fScore,
      cScore,
      pScore,
      total: tScore + fScore + cScore + pScore
    };
  };

  const liveBreakdown = calculateLiveBreakdown();

  const [editingItem, setEditingItem] = useState<PartnerEvaluation | null>(null);
  const [viewingDetailItem, setViewingDetailItem] = useState<PartnerEvaluation | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const availableYears = React.useMemo(() => {
    const currentYr = new Date().getFullYear().toString();
    const yrSet = new Set<string>([currentYr, '2026', '2025', '2024', '2023']);
    evaluations.forEach((e) => {
      if (e.review_date) {
        const yr = e.review_date.split('-')[0];
        if (yr && yr.length === 4) {
          yrSet.add(yr);
        }
      }
    });
    contracts.forEach((c) => {
      if (c.tanggal_mulai) {
        const yr = c.tanggal_mulai.split('-')[0];
        if (yr && yr.length === 4) yrSet.add(yr);
      }
      if (c.tanggal_berakhir && !c.tanggal_berakhir.toLowerCase().includes('unlimited')) {
        const yr = c.tanggal_berakhir.split('-')[0];
        if (yr && yr.length === 4) yrSet.add(yr);
      }
    });
    return Array.from(yrSet).sort((a, b) => Number(b) - Number(a));
  }, [evaluations, contracts]);

  const targetPartnersList = React.useMemo(() => {
    const selectedYrNum = Number(selectedYear);
    if (isNaN(selectedYrNum)) return partners;

    return partners.filter((p) => {
      const partnerContracts = contracts.filter((c) => c.partner_id === p.partner_id);

      if (partnerContracts.length > 0) {
        return partnerContracts.some((c) => {
          let startYr = 2023;
          if (c.tanggal_mulai) {
            const yr = parseInt(c.tanggal_mulai.split('-')[0], 10);
            if (!isNaN(yr)) startYr = yr;
          }

          const endStr = (c.tanggal_berakhir || '').toLowerCase().trim();
          const isUnlimited =
            !c.tanggal_berakhir ||
            endStr === '' ||
            endStr.includes('unlimited') ||
            endStr.includes('tanpa batas') ||
            endStr.includes('seumur hidup') ||
            c.auto_renewal;

          let endYr = Infinity;
          if (!isUnlimited && c.tanggal_berakhir) {
            const parsedEnd = parseInt(c.tanggal_berakhir.split('-')[0], 10);
            if (!isNaN(parsedEnd)) {
              endYr = parsedEnd;
            }
          }

          if (c.status === 'Terminated') {
            if (!isUnlimited && endYr !== Infinity) {
            } else if (c.updated_at) {
              const termYr = parseInt(c.updated_at.split('-')[0], 10);
              if (!isNaN(termYr)) endYr = termYr;
            } else if (c.tanggal_berakhir) {
              const parsedEnd = parseInt(c.tanggal_berakhir.split('-')[0], 10);
              if (!isNaN(parsedEnd)) endYr = parsedEnd;
            }
          }

          return selectedYrNum >= startYr && selectedYrNum <= endYr;
        });
      }

      return false;
    });
  }, [partners, contracts, selectedYear]);

  const combinedYearItems = React.useMemo(() => {
    const realEvalsInYear = evaluations.filter((e) => {
      if (!e.review_date) return false;
      const yr = e.review_date.split('-')[0];
      return yr === selectedYear;
    });

    const evaluatedPartnerIds = new Set(realEvalsInYear.map((e) => e.partner_id).filter(Boolean));
    const evaluatedPartnerNames = new Set(
      realEvalsInYear.map((e) => e.supplier_name.toLowerCase())
    );

    const unEvaluatedItems: PartnerEvaluation[] = targetPartnersList
      .filter((p) => {
        const hasById = evaluatedPartnerIds.has(p.partner_id);
        const hasByName = evaluatedPartnerNames.has(p.nama_partner.toLowerCase());
        return !hasById && !hasByName;
      })
      .map((p) => ({
        id: `NOT_REVIEWED_${p.partner_id}_${selectedYear}`,
        review_date: `${selectedYear}`,
        partner_id: p.partner_id,
        supplier_name: p.nama_partner,
        obligation_target: 'Kurang baik',
        incident_frequency: 'Frequent',
        communication: 'Kurang baik',
        pricing: 'Expensive',
        final_evaluation: 'Not reviewed' as const,
        notes: `Belum dilakukan evaluasi vendor untuk tahun ${selectedYear}.`,
        created_at: '',
        updated_at: '',
      }));

    return [...realEvalsInYear, ...unEvaluatedItems];
  }, [evaluations, targetPartnersList, selectedYear]);

  const filteredEvaluations = combinedYearItems.filter((item) => {
    const matchSearch =
      item.supplier_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.partner_id || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.notes.toLowerCase().includes(searchTerm.toLowerCase());
    const matchFilter =
      selectedEvaluationFilter === 'ALL' || item.final_evaluation === selectedEvaluationFilter;
    const matchTarget =
      selectedObligationTarget === 'ALL' || item.obligation_target === selectedObligationTarget;
    return matchSearch && matchFilter && matchTarget;
  });

  type SortField = 'id' | 'review_date' | 'vendor' | 'cooperation' | 'criteria' | 'calculated_score' | 'final_eval';
  type SortOrder = 'asc' | 'desc';

  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

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

  const sortedEvaluations = React.useMemo(() => {
    if (!sortField) return filteredEvaluations;

    return [...filteredEvaluations].sort((a, b) => {
      let valA: any = '';
      let valB: any = '';

      const getScore = (item: PartnerEvaluation) =>
        item.final_evaluation === 'Not reviewed'
          ? -1
          : item.calculated_score !== undefined
          ? item.calculated_score
          : computeScoreFromFields(
              item.obligation_target,
              item.incident_frequency,
              item.communication,
              item.pricing
            );

      if (sortField === 'vendor') {
        valA = a.supplier_name;
        valB = b.supplier_name;
      } else if (sortField === 'calculated_score') {
        valA = getScore(a);
        valB = getScore(b);
      } else if (sortField === 'review_date') {
        valA = a.review_date;
        valB = b.review_date;
      } else if (sortField === 'final_eval') {
        valA = a.final_evaluation;
        valB = b.final_evaluation;
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredEvaluations, sortField, sortOrder]);

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) setSelectedRows(sortedEvaluations.map(item => item.id || ''));
    else setSelectedRows([]);
  };

  const handleSelectRow = (id: string) => {
    setSelectedRows(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]);
  };

  const totalPages = Math.ceil(sortedEvaluations.length / rowsPerPage);
  const indexOfLast = currentPage * rowsPerPage;
  const indexOfFirst = indexOfLast - rowsPerPage;
  const currentEvaluations = sortedEvaluations.slice(indexOfFirst, indexOfLast);

  const getEvalBadgeClass = (status: string) => {
    switch (status) {
      case 'Excellent': return 'bg-status-success-soft dark:bg-status-success-soft/30 text-status-success  border-status-success-border ';
      case 'Good': return 'bg-status-info-soft dark:bg-status-info-soft/30 text-status-info  border-status-info-border ';
      case 'Fair': return 'bg-status-warning-soft dark:bg-status-warning-soft/30 text-status-warning  border-status-warning-border ';
      case 'Poor': return 'bg-status-danger-soft dark:bg-status-danger-soft/30 text-status-danger  border-status-danger-border ';
      case 'Not reviewed': return 'bg-surface-2 text-ink-soft border-hairline  opacity-80';
      default: return 'bg-surface-2 text-ink border-hairline ';
    }
  };

  const getEvalDotClass = (status: string) => {
    switch (status) {
      case 'Excellent': return 'bg-status-success';
      case 'Good': return 'bg-status-info';
      case 'Fair': return 'bg-status-warning';
      case 'Poor': return 'bg-status-danger';
      case 'Not reviewed': return 'bg-ink-faint';
      default: return 'bg-ink-faint';
    }
  };

  const getRelatedContractsCount = (pid: string | undefined) => {
    if (!pid) return 0;
    return contracts.filter((c) => c.partner_id === pid).length;
  };

  const handleDelete = async (id: string | undefined, name?: string) => {
    if (!canDeleteEvaluation) return;
    if (!id || id.startsWith('NOT_REVIEWED')) return;
    if (
      await confirmDialog({
        description: t('evaluation.delete_confirm', 'Hapus evaluasi ini?'),
        tone: 'danger',
      })
    ) {
      try {
        const res = await fetch(`/api/partner-evaluations/${id}?userEmail=${encodeURIComponent(userEmail || '')}&userName=${encodeURIComponent(userName || '')}&userRole=${encodeURIComponent(userRole || '')}`, { method: 'DELETE' });
        if (res.ok) {
          onRefreshData();
        } else {
          showAlert({ title: t('eval.gagal_menghapus_data_evaluasi', 'Gagal menghapus data evaluasi'), variant: 'destructive' });
        }
      } catch (err) {
        console.warn(err);
      }
    }
  };


  const handleExportCSV = () => {
    const headers = ['Tahun', 'Partner', 'Skor Akhir', 'Status Rekomendasi', 'Tanggal Review', 'Obligation Target', 'Incident Frequency', 'Comm & Price'];
    const rows = sortedEvaluations.map(c => [
      c.year,
      c.supplier_name,
      c.total_score,
      c.recommendation_status,
      c.review_date,
      c.obligation_target,
      c.incident_frequency,
      c.communication
    ]);
    downloadCsv('partner_evaluation_export.csv', headers, rows);
  };

  const handleAddNew = () => {
    if (!canCreateEvaluation) return;
    setEditingItem({
      id: '',
      year: new Date().getFullYear(),
      supplier_name: '',
      total_score: 0,
      recommendation_status: '',
      review_date: new Date().toISOString().split('T')[0],
      obligation_target: 'Sangat baik',
      incident_frequency: 'Never',
      communication: 'Sangat baik',
      pricing: 'Moderate',
      final_evaluation: 'Not reviewed',
      notes: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    setShowFormModal(true);
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
          title={t('eval.urutkan_berdasarkan', 'Urutkan berdasarkan {label}', { label })}
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

  return (
    <div className="space-y-6">
      <div className="ds-page-bar">
        <div>
          <h2 className="ds-page-heading">
            <span>{t('eval.annual_title', 'Evaluasi Vendor Tahunan')}</span>
          </h2>
        </div>

        <div className="mobile-page-actions flex items-center gap-2.5 shrink-0 flex-wrap">
          {hasPermission('export.csv') && (
            <button
              onClick={handleExportCSV}
              disabled={sortedEvaluations.length === 0}
              className="ui-button ui-button-lg cursor-pointer flex items-center disabled:opacity-50 disabled:cursor-not-allowed ds-button ds-button-lg ds-button-outline"
              title={t('eval.export_csv', 'Ekspor CSV')}
            >
              <Download className="w-4 h-4" />
              <span>{t('eval.export_csv', 'Ekspor CSV')}</span>
            </button>
          )}

          {canCreateEvaluation && (
            <button
              onClick={handleAddNew}
              className="ui-button ui-button-lg cursor-pointer flex items-center ds-button ds-button-lg ds-button-default"
            >
              <Plus className="w-4 h-4 text-white" />
              <span>{t('ui.add_evaluation')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Bar & View Toggle - Justified Responsive Grid/Flex */}
      <div className="ds-panel p-4 sm:p-5 mb-6">
        <div className="mobile-filter-grid flex flex-wrap items-center gap-2.5 w-full ds-grid">
          {/* 1 Box Search */}
          <div className="relative flex-1 min-w-[200px] sm:min-w-[240px]">
            <Search className="w-4 h-4 text-ink-soft absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={t('eval.search_placeholder', 'Cari vendor, reviewer, atau notes...')}
              aria-label={t('ui.search')}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="ds-input w-full pl-9 pr-3"
            />
          </div>

          {/* Filter 1: Tahun Review */}
          <select
            aria-label={t('ui.filter_year')}
              value={selectedYear}
            onChange={(e) => {
              setSelectedYear(e.target.value);
              setCurrentPage(1);
            }}
            className="ds-input flex-1 min-w-[130px] appearance-none pr-8"
          >
            <option value="2026">{t('eval.year_prefix', 'Tahun')} 2026</option>
            <option value="2025">{t('eval.year_prefix', 'Tahun')} 2025</option>
            <option value="2024">{t('eval.year_prefix', 'Tahun')} 2024</option>
            <option value="2023">{t('eval.year_prefix', 'Tahun')} 2023</option>
          </select>

          {/* Filter 2: Keputusan Rekomendasi */}
          <AlphabeticalSelect
            aria-label={t('ui.filter_decision')}
              value={selectedEvaluationFilter}
            onChange={(e) => {
              setSelectedEvaluationFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="ds-input flex-1 min-w-[130px] appearance-none pr-8"
          >
            <option value="ALL">{t('eval.all_decisions', 'Semua Keputusan')}</option>
            <option value="Recommended">{t('eval.decision_recommended', 'Lanjutkan Kerjasama')}</option>
            <option value="Recommended with notes">{t('eval.decision_rec_notes', 'Tinjauan Khusus')}</option>
            <option value="Not recommended">{t('eval.decision_not_rec', 'Putuskan Kerjasama')}</option>
            <option value="Not reviewed">{t('eval.decision_not_reviewed', 'Belum Dinilai')}</option>
          </AlphabeticalSelect>

          {/* Filter 3: Target Kewajiban */}
          <AlphabeticalSelect
            aria-label={t('ui.filter_target')}
              value={selectedObligationTarget}
            onChange={(e) => {
              setSelectedObligationTarget(e.target.value);
              setCurrentPage(1);
            }}
            className="ds-input flex-1 min-w-[130px] appearance-none pr-8"
          >
            <option value="ALL">{t('eval.all_obligation_targets', 'Semua Target Kewajiban')}</option>
            <option value="Sangat baik">{t('eval.opt_sangat_baik', 'Sangat baik')}</option>
            <option value="Baik">{t('eval.opt_baik', 'Baik')}</option>
            <option value="Kurang baik">{t('eval.opt_kurang_baik', 'Kurang baik')}</option>
          </AlphabeticalSelect>

          {/* View Toggle */}
          <TableViewMenu title={t('eval.view_settings', 'Pengaturan Tampilan Kolom')} label={t('eval.view', 'View')}>
            <div className="px-3.5 py-1.5 text-xs font-bold text-ink-soft uppercase tracking-wider mb-1 border-b border-hairline">
              {t('eval.toggle_columns', 'Toggle Kolom')}
            </div>
            {Object.keys(visibleColumns).map((col) => {
              let label = col;
              if (col === 'vendor') label = t('eval.col_vendor', 'Partner');
              else if (col === 'target') label = t('eval.col_target', 'Target Kewajiban');
              else if (col === 'skor') label = t('eval.col_calculated_score', 'Skor');
              else if (col === 'hasil') label = t('eval.col_recommendation', 'Hasil Rekomendasi');
              else if (col === 'tanggal') label = t('eval.col_review_date', 'Tanggal Review');

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

      <div className="ds-table-surface bg-surface border border-hairline rounded-2xl shadow-sm overflow-hidden">
        <FilterSummary filters={[{ label: t('ui.search'), value: searchTerm, active: Boolean(searchTerm) }, { label: t('ui.filter_year'), value: selectedYear, active: selectedYear !== String(new Date().getFullYear()) }, { label: t('ui.filter_decision'), value: selectedEvaluationFilter, active: selectedEvaluationFilter !== 'ALL' }, { label: t('ui.filter_target'), value: selectedObligationTarget, active: selectedObligationTarget !== 'ALL' }]} onReset={() => { setSearchTerm(''); setSelectedYear(String(new Date().getFullYear())); setSelectedEvaluationFilter('ALL'); setSelectedObligationTarget('ALL'); }} />
        <p className="mobile-table-hint px-4 py-2 text-xs text-ink-soft md:hidden">{t('ui.scroll_table')}</p>
        <div className="data-table-scroll overflow-x-auto bg-surface" tabIndex={0} role="region" aria-label={t('ui.scroll_table')}>
          <table className="ds-table app-data-table w-full text-left border-collapse text-xs bg-surface">
            <thead className="bg-surface dark:bg-surface-2/50">
              <tr className="bg-surface dark:bg-surface-2/50 border-b border-hairline text-xs font-bold text-ink h-12">
                <th scope="col" className="pl-6 pr-2 py-4 w-12 text-left align-middle">
                  <div className="flex items-center justify-start">
                    <input
                      type="checkbox"
                      aria-label={t('eval.pilih_semua_evaluasi', 'Pilih semua evaluasi')}
                      onChange={handleSelectAll}
                      checked={selectedRows.length > 0 && selectedRows.length === currentEvaluations.length}
                      className="rounded-sm border-hairline text-accent-text focus:ring-accent"
                    />
                  </div>
                </th>
                {visibleColumns.vendor && (
                  <th scope="col" aria-sort={sortField === 'vendor' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'} className="p-4 text-xs font-bold text-ink text-left align-middle">
                    <button type="button" onClick={() => handleSort('vendor')} className="flex items-center gap-1 cursor-pointer hover:text-ink dark:hover:text-white select-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none rounded-sm py-0.5">
                      <span>{t('eval.col_vendor', 'Partner')}</span>
                      <ArrowUpDown className="w-3.5 h-3.5 text-ink-soft" />
                    </button>
                  </th>
                )}
                {visibleColumns.target && <th scope="col" className="p-4 text-xs font-bold text-ink text-left align-middle">{t('eval.col_target', 'Target Kewajiban')}</th>}
                {visibleColumns.skor && (
                  <th scope="col" aria-sort={sortField === 'calculated_score' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'} className="p-4 text-xs font-bold text-ink text-left align-middle">
                    <button type="button" onClick={() => handleSort('calculated_score')} className="flex items-center gap-1 cursor-pointer hover:text-ink dark:hover:text-white select-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none rounded-sm py-0.5">
                      <span>{t('eval.col_calculated_score', 'Skor')}</span>
                      <ArrowUpDown className="w-3.5 h-3.5 text-ink-soft" />
                    </button>
                  </th>
                )}
                {visibleColumns.hasil && (
                  <th scope="col" aria-sort={sortField === 'final_eval' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'} className="p-4 text-xs font-bold text-ink text-left align-middle">
                    <button type="button" onClick={() => handleSort('final_eval')} className="flex items-center gap-1 cursor-pointer hover:text-ink dark:hover:text-white select-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none rounded-sm py-0.5">
                      <span>{t('eval.col_recommendation', 'Hasil Rekomendasi')}</span>
                      <ArrowUpDown className="w-3.5 h-3.5 text-ink-soft" />
                    </button>
                  </th>
                )}
                {visibleColumns.tanggal && (
                  <th scope="col" aria-sort={sortField === 'review_date' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'} className="p-4 text-xs font-bold text-ink text-left align-middle">
                    <button type="button" onClick={() => handleSort('review_date')} className="flex items-center gap-1 cursor-pointer hover:text-ink dark:hover:text-white select-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none rounded-sm py-0.5">
                      <span>{t('eval.col_review_date', 'Tanggal Review')}</span>
                      <ArrowUpDown className="w-3.5 h-3.5 text-ink-soft" />
                    </button>
                  </th>
                )}
                <th scope="col" className="pl-2 pr-6 py-4 text-right w-20 text-xs font-bold text-ink align-middle">
                  <div className="flex items-center justify-end">{t('eval.col_action', 'Aksi')}</div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {currentEvaluations.length === 0 ? (
                <TableEmptyState colSpan={Object.values(visibleColumns).filter(Boolean).length + 2} />
              ) : (
                currentEvaluations.map((item) => {
                  const isNotReviewed = item.final_evaluation === 'Not reviewed';
                  const score =
                    item.calculated_score !== undefined
                      ? item.calculated_score
                      : computeScoreFromFields(
                          item.obligation_target,
                          item.incident_frequency,
                          item.communication,
                          item.pricing
                        );

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-surface dark:hover:bg-surface-2/50 transition-colors"
                    >
                      <td className="pl-6 pr-2 py-4 text-left align-middle">
                        <div className="flex items-center justify-start">
                          <input
                            type="checkbox"
                            aria-label={t('eval.pilih_evaluasi', 'Pilih evaluasi {supplier_name}', { supplier_name: item.supplier_name })}
                            checked={selectedRows.includes(item.id)}
                            onChange={() => handleSelectRow(item.id)}
                            className="rounded-sm border-hairline text-accent-text focus:ring-accent"
                          />
                        </div>
                      </td>

                      {/* 1. Vendor */}
                      {visibleColumns.vendor && (
                        <td className="py-4 px-4 text-xs font-semibold text-ink text-left">
                          {item.supplier_name}
                        </td>
                      )}

                      {/* 2. Target Kewajiban */}
                      {visibleColumns.target && (
                        <td className="py-4 px-4 text-xs font-normal text-ink text-left">
                          {isNotReviewed ? '—' : item.obligation_target}
                        </td>
                      )}

                      {/* 3. Skor */}
                      {visibleColumns.skor && (
                        <td className="py-4 px-4 text-xs font-normal text-ink text-left">
                          {isNotReviewed ? (
                            <span className="text-ink-soft">—</span>
                          ) : (
                            <span className="font-semibold text-ink">{score} / 100</span>
                          )}
                        </td>
                      )}

                      {/* 4. Hasil Rekomendasi */}
                      {visibleColumns.hasil && (
                        <td className="py-4 px-4 text-xs font-normal text-ink text-left whitespace-nowrap">
                          {item.final_evaluation === 'Recommended' && (
                            <span className={`text-xs font-normal px-3 py-0.5 rounded-full border inline-flex items-center gap-1.5 shadow-2xs whitespace-nowrap ${getStatusBadgeClass('Recommended')}`}>
                              <CheckCircle2 className="w-3.5 h-3.5 text-accent-text" />
                              <span>{t('eval.status_rec', 'Recommended')}</span>
                            </span>
                          )}
                          {item.final_evaluation === 'Recommended with notes' && (
                            <span className={`text-xs font-normal px-3 py-0.5 rounded-full border inline-flex items-center gap-1.5 shadow-2xs whitespace-nowrap ${getStatusBadgeClass('Recommended with notes')}`}>
                              <AlertCircle className="w-3.5 h-3.5 text-status-warning" />
                              <span>{t('eval.status_rec_notes', 'Recommended with notes')}</span>
                            </span>
                          )}
                          {item.final_evaluation === 'Not recommended' && (
                            <span className={`text-xs font-normal px-3 py-0.5 rounded-full border inline-flex items-center gap-1.5 shadow-2xs whitespace-nowrap ${getStatusBadgeClass('Not recommended')}`}>
                              <XCircle className="w-3.5 h-3.5 text-status-danger" />
                              <span>{t('eval.status_not_rec', 'Not recommended')}</span>
                            </span>
                          )}
                          {isNotReviewed && (
                            <span className={`text-xs font-normal px-3 py-0.5 rounded-full border inline-flex items-center gap-1.5 shadow-2xs whitespace-nowrap ${getStatusBadgeClass('Draft')}`}>
                              <Clock className="w-3.5 h-3.5 text-ink-soft" />
                              <span>{t('eval.status_not_reviewed', 'Belum Dinilai')}</span>
                            </span>
                          )}
                        </td>
                      )}

                      {/* 5. Tanggal Review */}
                      {visibleColumns.tanggal && (
                        <td className="py-4 px-4 text-xs font-normal text-ink text-left whitespace-nowrap">
                          {formatBusinessDate(item.review_date)}
                        </td>
                      )}

                      {/* Actions */}
                      <td className="pl-2 pr-6 py-4 text-right align-middle w-20">
                        <div className="flex items-center justify-end">
                          {isNotReviewed ? (
                            canCreateEvaluation && (
                              <button
                                onClick={() => handleInputNotReviewed(item)}
                                className="px-3 min-h-8 bg-surface border border-hairline text-accent-text hover:bg-accent-soft rounded-md text-xs font-semibold transition-all inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                title={`${t('eval.input_eval')} - ${item.supplier_name}`}
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>{t('eval.input_eval')}</span>
                              </button>
                            )
                          ) : (
                            <ActionMenu
                              items={[
                                {
                                  label: t('eval.action_detail', 'Detail'),
                                  icon: <Award className="w-3.5 h-3.5" />,
                                  onClick: () => setViewingDetailItem(item),
                                },
                                canEditEvaluation && {
                                  label: t('eval.action_edit', 'Edit'),
                                  icon: <Edit2 className="w-3.5 h-3.5" />,
                                  onClick: () => handleOpenEditModal(item),
                                },
                                canDeleteEvaluation && {
                                  label: t('eval.action_delete', 'Hapus'),
                                  icon: <Trash2 className="w-3.5 h-3.5" />,
                                  onClick: () => handleDelete(item.id, item.supplier_name),
                                  variant: 'danger' as const,
                                  dividerBefore: true,
                                },
                              ].filter(Boolean)}
                            />
                          )}
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

      {/* FORM MODAL: Submit / Edit Evaluasi Tahunan Vendor */}
      {showFormModal && (
        <ModalFrame onClose={() => setShowFormModal(false)}>

            {/* Modal Header */}
            <div className="ds-section-header">
              <div className="flex items-center gap-2.5">
                <ClipboardCheck className="w-5 h-5 text-accent-text" />
                <div>
                  <ModalTitle className="ds-modal-title flex items-center gap-2">
                    {editingItem?.id && !editingItem.id.startsWith('NOT_REVIEWED')
                      ? t('eval.modal_title_edit', 'Edit Evaluasi Partner')
                      : t('eval.modal_title_add', 'Form Evaluasi Partner')}
                  </ModalTitle>
                  {editingItem?.supplier_name && (
                    <p className="text-xs text-ink-soft font-medium">{editingItem.supplier_name}</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowFormModal(false)}
                aria-label={t('common.close')} className="min-w-10 min-h-10 inline-flex items-center justify-center text-ink-soft hover:text-ink dark:hover:text-ink p-1.5 rounded-md hover:bg-surface-2 dark:hover:bg-surface-2 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form Body */}
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden min-h-0">
              <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1 text-xs text-ink">
              {formError && (
                <div className="p-3.5 bg-status-danger-soft dark:bg-status-danger-soft/40 border border-status-danger-border rounded-xl text-xs font-bold text-status-danger flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-status-danger shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* BAGIAN 1: Informasi Dasar */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-hairline">
                  <span className="w-6 h-6 rounded-full bg-accent-soft text-accent-text border border-accent/30 font-black text-xs flex items-center justify-center shrink-0">
                    1
                  </span>
                  <h3 className="ds-section-title">{t('eval.section1')}</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 ds-grid">
                  {/* Tanggal Review */}
                  <div>
                    <label htmlFor="partnerevaluationview-field-1" className="block text-xs font-bold text-ink mb-1">
                      {t('eval.review_date')} <span className="text-status-danger">*</span>
                    </label>
                    <DateInput id="partnerevaluationview-field-1"
                      required
                      value={formData.review_date}
                      onChange={(val) => setFormData({ ...formData, review_date: val })}
                    />
                  </div>

                  {/* Supplier Name (Dropdown Tersinkron) */}
                  <div>
                    <label htmlFor="partnerevaluationview-field-2" className="block text-xs font-bold text-ink mb-1">
                      {t('eval.supplier_name')} <span className="text-status-danger">*</span>
                    </label>
                    {partners.length > 0 ? (
                      <AlphabeticalSelect id="partnerevaluationview-field-2"
                        required
                        value={formData.supplier_name}
                        onChange={(e) => {
                          const selectedPartnerName = e.target.value;
                          const found = partners.find((p) => p.nama_partner === selectedPartnerName);
                          setFormData({
                            ...formData,
                            supplier_name: selectedPartnerName,
                            partner_id: found ? found.partner_id : '',
                          });
                        }}
                        className="ds-input w-full"
                      >
                        <option value="" disabled>
                          {t('eval.select_partner_ph')}
                        </option>
                        {partners.map((p) => (
                          <option key={p.partner_id} value={p.nama_partner}>
                            {p.nama_partner} ({p.partner_id} - {p.jenis_partner})
                          </option>
                        ))}
                      </AlphabeticalSelect>
                    ) : (
                      <div className="p-3 bg-status-warning-soft dark:bg-status-warning-soft/40 border border-status-warning-border rounded-xl text-xs font-bold text-status-warning">
                        {t('eval.no_partners_warning')}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* BAGIAN 2: Kriteria Penilaian */}
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-hairline">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-accent-soft text-accent-text border border-accent/30 font-black text-xs flex items-center justify-center shrink-0">
                      2
                    </span>
                    <h3 className="ds-section-title">{t('eval.section2')}</h3>
                  </div>
                </div>

                {/* Obligation / Target */}
                <div>
                  <label className="block text-xs font-bold text-ink mb-1.5">
                    {t('eval.obligation_target')} <span className="text-status-danger">*</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 ds-grid">
                    {[
                      { value: 'Sangat baik', label: t('eval.opt_sangat_baik'), points: `30 ${t('eval.points')}` },
                      { value: 'Baik', label: t('eval.opt_baik'), points: `20 ${t('eval.points')}` },
                      { value: 'Kurang baik', label: t('eval.opt_kurang_baik'), points: `10 ${t('eval.points')}` },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                          formData.obligation_target === opt.value
                            ? 'bg-accent-soft border-accent text-ink font-bold shadow-2xs'
                            : 'bg-canvas dark:bg-surface-2/80 border-hairline text-ink hover:bg-surface-2 dark:hover:bg-surface-2'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="obligation_target"
                            value={opt.value}
                            checked={formData.obligation_target === opt.value}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                obligation_target: e.target.value as any,
                              })
                            }
                            className="accent-[#2653F6]"
                          />
                          <span className="text-xs">{opt.label}</span>
                        </div>
                        <span className="text-xs font-bold text-accent-text bg-accent-soft border border-accent/30 px-2 py-0.5 rounded-md">
                          {opt.points}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Incident Frequency */}
                <div>
                  <label className="block text-xs font-bold text-ink mb-1.5">
                    {t('eval.incident_freq')} <span className="text-status-danger">*</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 ds-grid">
                    {[
                      { value: 'Never', label: t('eval.opt_never'), points: `20 ${t('eval.points')}` },
                      { value: 'Rare', label: t('eval.opt_rare'), points: `15 ${t('eval.points')}` },
                      { value: 'Frequent', label: t('eval.opt_frequent'), points: `10 ${t('eval.points')}` },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                          formData.incident_frequency === opt.value
                            ? 'bg-accent-soft border-accent text-ink font-bold shadow-2xs'
                            : 'bg-canvas dark:bg-surface-2/80 border-hairline text-ink hover:bg-surface-2 dark:hover:bg-surface-2'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <input
                            type="radio"
                            name="incident_frequency"
                            value={opt.value}
                            checked={formData.incident_frequency === opt.value}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                incident_frequency: e.target.value as any,
                              })
                            }
                            className="accent-[#2653F6]"
                          />
                          <span className="text-xs">{opt.label}</span>
                        </div>
                        <span className="text-xs font-bold text-accent-text bg-accent-soft border border-accent/30 px-2 py-0.5 rounded-md">
                          {opt.points}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Communication */}
                <div>
                  <label className="block text-xs font-bold text-ink mb-1.5">
                    {t('eval.communication')} <span className="text-status-danger">*</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 ds-grid">
                    {[
                      { value: 'Sangat baik', label: t('eval.opt_sangat_baik'), points: `20 ${t('eval.points')}` },
                      { value: 'Baik', label: t('eval.opt_baik'), points: `15 ${t('eval.points')}` },
                      { value: 'Kurang baik', label: t('eval.opt_kurang_baik'), points: `10 ${t('eval.points')}` },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                          formData.communication === opt.value
                            ? 'bg-accent-soft border-accent text-ink font-bold shadow-2xs'
                            : 'bg-canvas dark:bg-surface-2/80 border-hairline text-ink hover:bg-surface-2 dark:hover:bg-surface-2'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="communication"
                            value={opt.value}
                            checked={formData.communication === opt.value}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                communication: e.target.value as any,
                              })
                            }
                            className="accent-[#2653F6]"
                          />
                          <span className="text-xs">{opt.label}</span>
                        </div>
                        <span className="text-xs font-bold text-accent-text bg-accent-soft border border-accent/30 px-2 py-0.5 rounded-md">
                          {opt.points}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Pricing */}
                <div>
                  <label className="block text-xs font-bold text-ink mb-1.5">
                    {t('eval.pricing')} <span className="text-status-danger">*</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 ds-grid">
                    {[
                      { value: 'Cheap', label: t('eval.opt_cheap'), points: `30 ${t('eval.points')}` },
                      { value: 'Moderate', label: t('eval.opt_moderate'), points: `20 ${t('eval.points')}` },
                      { value: 'Expensive', label: t('eval.opt_expensive'), points: `10 ${t('eval.points')}` },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                          formData.pricing === opt.value
                            ? 'bg-accent-soft border-accent text-ink font-bold shadow-2xs'
                            : 'bg-canvas dark:bg-surface-2/80 border-hairline text-ink hover:bg-surface-2 dark:hover:bg-surface-2'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <input
                            type="radio"
                            name="pricing"
                            value={opt.value}
                            checked={formData.pricing === opt.value}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                pricing: e.target.value as any,
                              })
                            }
                            className="accent-[#2653F6]"
                          />
                          <span className="text-xs">{opt.label}</span>
                        </div>
                        <span className="text-xs font-bold text-accent-text bg-accent-soft border border-accent/30 px-2 py-0.5 rounded-md">
                          {opt.points}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* BAGIAN 3: Evaluasi Akhir & Catatan */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-hairline">
                  <span className="w-6 h-6 rounded-full bg-accent-soft text-accent-text border border-accent/30 font-black text-xs flex items-center justify-center shrink-0">
                    3
                  </span>
                  <h3 className="ds-section-title">
                    {t('eval.section3')}
                  </h3>
                </div>

                {/* Live Score Calculation Display */}
                <div className="p-4 bg-accent-soft border border-accent/30 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Calculator className="w-4 h-4 text-accent-text" />
                      <span className="text-xs font-extrabold text-accent-text uppercase tracking-wider">
                        {t('eval.calc_score_breakdown')}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 bg-accent-strong text-white px-3 py-1 rounded-xl shadow-2xs">
                      <span className="text-xs font-semibold">{t('eval.total', 'Total:')}</span>
                      <span className="text-base font-black">{liveBreakdown.total}</span>
                      <span className="text-xs opacity-80">/ 100 {t('eval.points')}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs ds-grid">
                    <div className="ds-panel p-2">
                      <span className="text-ink-soft text-xs block font-medium">{t('eval.obligation_target_2', 'Obligation / Target')}</span>
                      <span className="font-extrabold text-accent-text">
                        {liveBreakdown.tScore} {t('eval.points')}
                      </span>
                    </div>
                    <div className="ds-panel p-2">
                      <span className="text-ink-soft text-xs block font-medium">{t('eval.incident_freq_2', 'Incident Freq')}</span>
                      <span className="font-extrabold text-accent-text">
                        {liveBreakdown.fScore} {t('eval.points')}
                      </span>
                    </div>
                    <div className="ds-panel p-2">
                      <span className="text-ink-soft text-xs block font-medium">{t('audit_col_evalCommunication', 'Communication')}</span>
                      <span className="font-extrabold text-accent-text">
                        {liveBreakdown.cScore} {t('eval.points')}
                      </span>
                    </div>
                    <div className="ds-panel p-2">
                      <span className="text-ink-soft text-xs block font-medium">{t('eval.pricing_2', 'Pricing')}</span>
                      <span className="font-extrabold text-accent-text">
                        {liveBreakdown.pScore} {t('eval.points')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Final Evaluation Option */}
                <div>
                  <label className="block text-xs font-bold text-ink mb-1.5">
                    {t('eval.col_final_eval')} <span className="text-status-danger">*</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 ds-grid">
                    {[
                      {
                        value: 'Recommended',
                        label: t('eval.status_rec'),
                        desc: t('eval.opt_rec_desc'),
                        activeClass: 'bg-accent-soft border-accent text-ink ',
                      },
                      {
                        value: 'Recommended with notes',
                        label: t('eval.rec_with_notes'),
                        desc: t('eval.opt_rec_notes_desc'),
                        activeClass: 'bg-status-warning-soft dark:bg-status-warning-soft/50 border-status-warning-border  text-ink ',
                      },
                      {
                        value: 'Not recommended',
                        label: t('eval.status_not_rec'),
                        desc: t('eval.opt_not_rec_desc'),
                        activeClass: 'bg-status-danger-soft dark:bg-status-danger-soft/50 border-status-danger-border  text-ink ',
                      },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className={`p-3 rounded-xl border flex flex-col justify-between cursor-pointer transition-all ${
                          formData.final_evaluation === opt.value
                            ? `${opt.activeClass} font-bold shadow-2xs`
                            : 'bg-canvas dark:bg-surface-2/80 border-hairline text-ink hover:bg-surface-2 dark:hover:bg-surface-2'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <input
                            type="radio"
                            name="final_evaluation"
                            value={opt.value}
                            checked={formData.final_evaluation === opt.value}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                final_evaluation: e.target.value as any,
                              })
                            }
                            className="accent-[#2653F6]"
                          />
                          <span className="text-xs">{opt.label}</span>
                        </div>
                        <span className="text-xs text-ink-soft">{opt.desc}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Notes / Alasan Evaluasi */}
                <div>
                  <label htmlFor="partnerevaluationview-field-3" className="block text-xs font-bold text-ink mb-1">
                    {t('eval.notes_label')}
                  </label>
                  <textarea id="partnerevaluationview-field-3"
                    rows={4}
                    placeholder={t('eval.notes_ph')}
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="ds-input w-full"
                  />
                </div>
              </div>
              </div>

              {/* Modal Footer */}
              <div className="p-4 sm:p-5 bg-surface border-t border-hairline flex items-center justify-between gap-2 shrink-0">
                <span className="text-xs text-ink-soft font-medium hidden sm:inline">
                  {t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan')}
                </span>
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => setShowFormModal(false)}
                    className="ui-button ui-button-lg cursor-pointer ds-button ds-button-lg ds-button-ghost"
                  >
                    {t('eval.btn_cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="ui-button ui-button-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ds-button ds-button-lg ds-button-default"
                  >
                    {isSubmitting
                      ? t('eval.btn_saving')
                      : editingItem
                      ? t('eval.btn_update')
                      : t('eval.btn_submit')}
                  </button>
                </div>
              </div>
            </form>
        </ModalFrame>
      )}

      {/* DETAIL MODAL: View Single Evaluation Report */}
      {viewingDetailItem && (
        <ModalFrame onClose={() => setViewingDetailItem(null)}>

            <div className="ds-section-header">
              <div className="flex items-center gap-2.5">
                <Building2 className="w-5 h-5 text-accent-text" />
                <div>
                  <ModalTitle className="ds-modal-title flex items-center gap-2">
                    {t('eval.detail_modal_title', 'Laporan Evaluasi Partner')}
                  </ModalTitle>
                  <p className="text-xs text-ink-soft font-medium">{viewingDetailItem.supplier_name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingDetailItem(null)}
                aria-label={t('common.close')} className="min-w-10 min-h-10 inline-flex items-center justify-center text-ink-soft hover:text-ink dark:hover:text-ink p-1.5 rounded-md hover:bg-surface-2 dark:hover:bg-surface-2 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-xs text-ink flex-1">
              <div className="ds-panel grid grid-cols-2 gap-3 p-3.5 ds-grid">
                <div>
                  <span className="text-xs text-ink-soft font-bold uppercase block">
                    {t('eval.col_id_date')} {t('eval.id', 'ID')}
                  </span>
                  <span className="font-mono font-bold text-ink">{viewingDetailItem.id}</span>
                </div>
                <div>
                  <span className="text-xs text-ink-soft font-bold uppercase block">
                    {t('eval.review_date')}
                  </span>
                  <span className="font-bold text-ink">{formatBusinessDate(viewingDetailItem.review_date)}</span>
                </div>
              </div>

              <div className="p-3 bg-accent-soft rounded-xl border border-accent/30 flex items-center justify-between">
                <div>
                  <span className="text-xs text-accent-text font-bold uppercase block">
                    {t('eval.col_calculated_score')}
                  </span>
                  <span className="text-xs text-accent-text font-semibold">{t('eval.auto_score_text')}</span>
                </div>
                <div className="text-right">
                  <span className="text-xl font-black text-accent-text">
                    {viewingDetailItem.calculated_score !== undefined
                      ? viewingDetailItem.calculated_score
                      : computeScoreFromFields(
                          viewingDetailItem.obligation_target,
                          viewingDetailItem.incident_frequency,
                          viewingDetailItem.communication,
                          viewingDetailItem.pricing
                        )}
                  </span>
                  <span className="text-xs font-semibold text-accent-text"> / 100 {t('eval.points')}</span>
                </div>
              </div>

              <div className="ds-panel space-y-2 p-3.5 text-xs">
                <div className="flex justify-between pb-1.5 border-b border-hairline">
                  <span className="text-ink-soft font-medium">{t('eval.obligation_target_2', 'Obligation / Target')}</span>
                  <span className="font-bold text-ink">
                    {viewingDetailItem.obligation_target}
                  </span>
                </div>
                <div className="flex justify-between pb-1.5 border-b border-hairline">
                  <span className="text-ink-soft font-medium">{t('audit_col_evalIncident', 'Incident Frequency')}</span>
                  <span className="font-bold text-ink">
                    {viewingDetailItem.incident_frequency}
                  </span>
                </div>
                <div className="flex justify-between pb-1.5 border-b border-hairline">
                  <span className="text-ink-soft font-medium">{t('audit_col_evalCommunication', 'Communication')}</span>
                  <span className="font-bold text-ink">
                    {viewingDetailItem.communication}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-soft font-medium">{t('eval.pricing_2', 'Pricing')}</span>
                  <span className="font-bold text-ink">{viewingDetailItem.pricing}</span>
                </div>
              </div>

              <div className="pt-2">
                <span className="text-xs text-ink-soft font-bold uppercase block mb-1">
                  {t('eval.rec_result')}
                </span>
                <div className="font-bold">
                  {viewingDetailItem.final_evaluation === 'Recommended' && (
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-accent-soft text-accent-text border border-accent/30 inline-flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-accent-text" />
                      <span>{t('eval.status_rec')}</span>
                    </span>
                  )}
                  {viewingDetailItem.final_evaluation === 'Recommended with notes' && (
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-status-warning-soft text-status-warning border border-status-warning-border inline-flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-status-warning" />
                      <span>{t('eval.status_rec_notes')}</span>
                    </span>
                  )}
                  {viewingDetailItem.final_evaluation === 'Not recommended' && (
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-status-danger-soft text-status-danger border border-status-danger-border inline-flex items-center gap-1.5">
                      <X className="w-3.5 h-3.5 text-status-danger" />
                      <span>{t('eval.status_not_rec')}</span>
                    </span>
                  )}
                </div>
              </div>

              {viewingDetailItem.notes && (
                <div className="p-3 bg-canvas rounded-xl border border-hairline">
                  <span className="text-xs text-ink-soft font-bold uppercase block mb-1">
                    {t('eval.notes_title')}
                  </span>
                  <p className="text-xs text-ink whitespace-pre-wrap">
                    {viewingDetailItem.notes}
                  </p>
                </div>
              )}
            </div>

            <div className="p-4 sm:p-5 bg-canvas border-t border-hairline flex justify-end">
              <button
                type="button"
                onClick={() => setViewingDetailItem(null)}
                className="inline-flex items-center px-4 min-h-8 bg-ink hover:bg-ink text-white font-semibold rounded-md text-xs transition-colors cursor-pointer"
              >
                {t('eval.btn_close')}
              </button>
            </div>
        </ModalFrame>
      )}
    </div>
  );
};
