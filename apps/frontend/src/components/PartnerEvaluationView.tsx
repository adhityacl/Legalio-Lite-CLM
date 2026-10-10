import { TableViewMenu, TableViewOption } from './ui/table-view-menu';
import { downloadCsv } from '../lib/csv';
import { AlphabeticalSelect } from './ui/alphabetical-select';
import { ModalFrame } from './ui/modal-frame';
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
import { Badge, statusTone } from '@legalio/ui-components/badge';
import { getSavedColumnPreferences, saveColumnPreferences } from '../lib/tablePreferences';
import { getCachedAccessToken } from '../lib/googleAuthService';
import { useLanguage } from '../context/LanguageContext';
import { useConfirm } from '../context/ConfirmDialogContext';
import { useAlertToast } from '../context/AlertToastContext';
import { usePermissions } from '../lib/permissions';

import { TableColumnHeader, Table, TableHeader, TableRow, TableBody, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { Button } from '@legalio/ui-components/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Textarea } from '@legalio/ui-components/textarea';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { DialogHeader, DialogTitle } from '@legalio/ui-components/dialog';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Checkbox, CheckboxControl, CheckboxHiddenInput } from '@legalio/ui-components/checkbox';
import { RadioGroup, RadioGroupItem, RadioGroupItemControl, RadioGroupItemHiddenInput, RadioGroupItemText, RadioGroupLabel } from '@legalio/ui-components/radio-group';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
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

  const handleSelectAll = (checked: boolean) => {
    if (checked) setSelectedRows(sortedEvaluations.map(item => item.id || ''));
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
      case 'Excellent': return 'bg-status-success-soft  text-status-success  border-status-success-border ';
      case 'Good': return 'bg-status-info-soft  text-status-info  border-status-info-border ';
      case 'Fair': return 'bg-status-warning-soft  text-status-warning  border-status-warning-border ';
      case 'Poor': return 'bg-status-danger-soft  text-status-danger  border-status-danger-border ';
      case 'Not reviewed': return 'bg-muted text-muted-foreground border-border  opacity-80';
      default: return 'bg-muted text-foreground border-border ';
    }
  };

  const getEvalDotClass = (status: string) => {
    switch (status) {
      case 'Excellent': return 'bg-status-success';
      case 'Good': return 'bg-status-info';
      case 'Fair': return 'bg-status-warning';
      case 'Poor': return 'bg-status-danger';
      case 'Not reviewed': return 'bg-muted-foreground';
      default: return 'bg-muted-foreground';
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
      <TableColumnHeader
        scope="col"
        aria-sort={isSorted ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
        className="text-left align-middle"
      >
        <Button variant="ghost" size="sm"
          type="button"
          onClick={() => handleSort(field)}
          title={t('eval.urutkan_berdasarkan', 'Urutkan berdasarkan {label}', { label })}
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

  return (
    <div className="space-y-6">
      <Card className="flex-row flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <Heading as="h2" size="lg" weight="semibold">
            <span>{t('eval.annual_title', 'Evaluasi Vendor Tahunan')}</span>
          </Heading>
        </div>

        <div className="mobile-page-actions flex items-center gap-2.5 shrink-0 flex-wrap">
          {hasPermission('export.csv') && (
            <Button variant="outline"
              onClick={handleExportCSV}
              disabled={sortedEvaluations.length === 0}
              title={t('eval.export_csv', 'Ekspor CSV')}
            >
              <Download className="w-4 h-4" />
              <span>{t('eval.export_csv', 'Ekspor CSV')}</span>
            </Button>
          )}

          {canCreateEvaluation && (
            <Button
              onClick={handleAddNew}
            >
              <Plus className="w-4 h-4" />
              <span>{t('ui.add_evaluation')}</span>
            </Button>
          )}
        </div>
      </Card>

      {/* Filter Bar & View Toggle - Justified Responsive Grid/Flex */}
      <Card className="p-4 sm:p-5">
        <div className="mobile-filter-grid flex flex-wrap items-center gap-2.5 w-full">
          {/* 1 Box Search */}
          <InputGroup className="relative flex-1 min-w-[200px] sm:min-w-[240px]">
            <InputGroupAddon><Search className="size-4" aria-hidden="true" /></InputGroupAddon>
            <InputGroupInput
              type="text"
              placeholder={t('eval.search_placeholder', 'Cari vendor, reviewer, atau notes...')}
              aria-label={t('ui.search')}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
            />
          </InputGroup>

          {/* Filter 1: Tahun Review */}
          <NativeSelect
            aria-label={t('ui.filter_year')}
              value={selectedYear}
            onChange={(e) => {
              setSelectedYear(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full" controlProps={{ className: "flex-1 min-w-[130px]" }}
          >
            <option value="2026">{t('eval.year_prefix', 'Tahun')} 2026</option>
            <option value="2025">{t('eval.year_prefix', 'Tahun')} 2025</option>
            <option value="2024">{t('eval.year_prefix', 'Tahun')} 2024</option>
            <option value="2023">{t('eval.year_prefix', 'Tahun')} 2023</option>
          </NativeSelect>

          {/* Filter 2: Keputusan Rekomendasi */}
          <AlphabeticalSelect
            aria-label={t('ui.filter_decision')}
              value={selectedEvaluationFilter}
            onChange={(e) => {
              setSelectedEvaluationFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full" controlProps={{ className: "flex-1 min-w-[130px]" }}
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
            className="w-full" controlProps={{ className: "flex-1 min-w-[130px]" }}
          >
            <option value="ALL">{t('eval.all_obligation_targets', 'Semua Target Kewajiban')}</option>
            <option value="Sangat baik">{t('eval.opt_sangat_baik', 'Sangat baik')}</option>
            <option value="Baik">{t('eval.opt_baik', 'Baik')}</option>
            <option value="Kurang baik">{t('eval.opt_kurang_baik', 'Kurang baik')}</option>
          </AlphabeticalSelect>

          {/* View Toggle */}
          <TableViewMenu title={t('eval.view_settings', 'Pengaturan Tampilan Kolom')} label={t('eval.view', 'View')}>
            <div className="px-3.5 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 border-b border-border">
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
                <TableViewOption key={col} value={col} checked={visibleColumns[col]} onToggle={() => toggleColumnVisibility(col)}>{label}</TableViewOption>
              );
            })}
          </TableViewMenu>
      </div>
    </Card>

      <Card className="overflow-hidden">
        <FilterSummary filters={[{ label: t('ui.search'), value: searchTerm, active: Boolean(searchTerm) }, { label: t('ui.filter_year'), value: selectedYear, active: selectedYear !== String(new Date().getFullYear()) }, { label: t('ui.filter_decision'), value: selectedEvaluationFilter, active: selectedEvaluationFilter !== 'ALL' }, { label: t('ui.filter_target'), value: selectedObligationTarget, active: selectedObligationTarget !== 'ALL' }]} onReset={() => { setSearchTerm(''); setSelectedYear(String(new Date().getFullYear())); setSelectedEvaluationFilter('ALL'); setSelectedObligationTarget('ALL'); }} />
        <p className="mobile-table-hint px-4 py-2 text-xs text-muted-foreground md:hidden">{t('ui.scroll_table')}</p>
        <TableScrollArea className="data-table-scroll rounded-none border-0" tabIndex={0} role="region" aria-label={t('ui.scroll_table')}>
          <Table className="app-data-table w-full text-left">
            <TableHeader>
              <TableRow>
                <TableColumnHeader scope="col" className="w-12 text-left align-middle">
                  <div className="flex items-center justify-start">
                    <Checkbox aria-label={t('eval.pilih_semua_evaluasi', 'Pilih semua evaluasi')} checked={selectedRows.length > 0 && selectedRows.length === currentEvaluations.length} onCheckedChange={(details) => handleSelectAll(details.checked === true)}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                  </div>
                </TableColumnHeader>
                {visibleColumns.vendor && (
                  <TableColumnHeader scope="col" aria-sort={sortField === 'vendor' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'} className="text-left align-middle">
                    <Button variant="ghost" size="sm" type="button" onClick={() => handleSort('vendor')}>
                      <span>{t('eval.col_vendor', 'Partner')}</span>
                      <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  </TableColumnHeader>
                )}
                {visibleColumns.target && <TableColumnHeader scope="col" className="text-left align-middle">{t('eval.col_target', 'Target Kewajiban')}</TableColumnHeader>}
                {visibleColumns.skor && (
                  <TableColumnHeader scope="col" aria-sort={sortField === 'calculated_score' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'} className="text-left align-middle">
                    <Button variant="ghost" size="sm" type="button" onClick={() => handleSort('calculated_score')}>
                      <span>{t('eval.col_calculated_score', 'Skor')}</span>
                      <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  </TableColumnHeader>
                )}
                {visibleColumns.hasil && (
                  <TableColumnHeader scope="col" aria-sort={sortField === 'final_eval' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'} className="text-left align-middle">
                    <Button variant="ghost" size="sm" type="button" onClick={() => handleSort('final_eval')}>
                      <span>{t('eval.col_recommendation', 'Hasil Rekomendasi')}</span>
                      <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  </TableColumnHeader>
                )}
                {visibleColumns.tanggal && (
                  <TableColumnHeader scope="col" aria-sort={sortField === 'review_date' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'} className="text-left align-middle">
                    <Button variant="ghost" size="sm" type="button" onClick={() => handleSort('review_date')}>
                      <span>{t('eval.col_review_date', 'Tanggal Review')}</span>
                      <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  </TableColumnHeader>
                )}
                <TableColumnHeader scope="col" className="text-right w-20 align-middle">
                  <div className="flex items-center justify-end">{t('eval.col_action', 'Aksi')}</div>
                </TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
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
                    <TableRow
                      key={item.id}
                    >
                      <TableCell className="text-left align-middle">
                        <div className="flex items-center justify-start">
                          <Checkbox aria-label={t('eval.pilih_evaluasi', 'Pilih evaluasi {supplier_name}', { supplier_name: item.supplier_name })} checked={selectedRows.includes(item.id)} onCheckedChange={() => handleSelectRow(item.id)}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                        </div>
                      </TableCell>

                      {/* 1. Vendor */}
                      {visibleColumns.vendor && (
                        <TableCell className="text-left">
                          {item.supplier_name}
                        </TableCell>
                      )}

                      {/* 2. Target Kewajiban */}
                      {visibleColumns.target && (
                        <TableCell className="text-left">
                          {isNotReviewed ? '—' : item.obligation_target}
                        </TableCell>
                      )}

                      {/* 3. Skor */}
                      {visibleColumns.skor && (
                        <TableCell className="text-left">
                          {isNotReviewed ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className="font-semibold text-foreground">{score} / 100</span>
                          )}
                        </TableCell>
                      )}

                      {/* 4. Hasil Rekomendasi */}
                      {visibleColumns.hasil && (
                        <TableCell className="text-left whitespace-nowrap">
                          {item.final_evaluation === 'Recommended' && (
                            <Badge tone={statusTone('Recommended')}>
                              <CheckCircle2 className="w-3.5 h-3.5 text-accent-foreground" />
                              <span>{t('eval.status_rec', 'Recommended')}</span>
                            </Badge>
                          )}
                          {item.final_evaluation === 'Recommended with notes' && (
                            <Badge tone={statusTone('Recommended with notes')}>
                              <AlertCircle className="w-3.5 h-3.5 text-status-warning" />
                              <span>{t('eval.status_rec_notes', 'Recommended with notes')}</span>
                            </Badge>
                          )}
                          {item.final_evaluation === 'Not recommended' && (
                            <Badge tone={statusTone('Not recommended')}>
                              <XCircle className="w-3.5 h-3.5 text-status-danger" />
                              <span>{t('eval.status_not_rec', 'Not recommended')}</span>
                            </Badge>
                          )}
                          {isNotReviewed && (
                            <Badge tone={statusTone('Draft')}>
                              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                              <span>{t('eval.status_not_reviewed', 'Belum Dinilai')}</span>
                            </Badge>
                          )}
                        </TableCell>
                      )}

                      {/* 5. Tanggal Review */}
                      {visibleColumns.tanggal && (
                        <TableCell className="text-left whitespace-nowrap">
                          {formatBusinessDate(item.review_date)}
                        </TableCell>
                      )}

                      {/* Actions */}
                      <TableCell className="text-right align-middle w-20">
                        <div className="flex items-center justify-end">
                          {isNotReviewed ? (
                            canCreateEvaluation && (
                              <Button size="sm"
                                onClick={() => handleInputNotReviewed(item)}
                                title={`${t('eval.input_eval')} - ${item.supplier_name}`}
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>{t('eval.input_eval')}</span>
                              </Button>
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

      {/* FORM MODAL: Submit / Edit Evaluasi Tahunan Vendor */}
      {showFormModal && (
        <ModalFrame onClose={() => setShowFormModal(false)}>

            {/* Modal Header */}
            <DialogHeader className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
              <div className="flex items-center gap-2.5">
                <ClipboardCheck className="w-5 h-5 text-accent-foreground" />
                <div>
                  <DialogTitle className="flex items-center gap-2">
                    {editingItem?.id && !editingItem.id.startsWith('NOT_REVIEWED')
                      ? t('eval.modal_title_edit', 'Edit Evaluasi Partner')
                      : t('eval.modal_title_add', 'Form Evaluasi Partner')}
                  </DialogTitle>
                  {editingItem?.supplier_name && (
                    <p className="text-xs text-muted-foreground font-medium">{editingItem.supplier_name}</p>
                  )}
                </div>
              </div>
              <Button variant="secondary" size="icon-md"
                type="button"
                onClick={() => setShowFormModal(false)}
                aria-label={t('common.close')}
              >
                <X className="w-5 h-5" />
              </Button>
            </DialogHeader>

            {/* Modal Form Body */}
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden min-h-0">
              <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1 text-xs text-foreground">
              {formError && (
                <div className="p-3.5 bg-status-danger-soft border border-status-danger-border rounded-xl text-xs font-bold text-status-danger flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-status-danger shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* BAGIAN 1: Informasi Dasar */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-border">
                  <Badge tone="info" className="size-6 justify-center rounded-full p-0 font-semibold">1</Badge>
                  <Heading as="h3" size="sm" weight="semibold">{t('eval.section1')}</Heading>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Tanggal Review */}
                  <Field>
                    <FieldLabel htmlFor="partnerevaluationview-field-1">
                      {t('eval.review_date')} <span className="text-status-danger">*</span>
                    </FieldLabel>
                    <DateInput id="partnerevaluationview-field-1"
                      required
                      value={formData.review_date}
                      onChange={(val) => setFormData({ ...formData, review_date: val })}
                    />
                  </Field>

                  {/* Supplier Name (Dropdown Tersinkron) */}
                  <Field required>
                    <FieldLabel htmlFor="partnerevaluationview-field-2">{t('eval.supplier_name')}</FieldLabel>
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
                        className="w-full" controlProps={{ className: "w-full" }}
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
                      <Alert status="warning"><AlertIndicator /><AlertContent><AlertDescription>{t('eval.no_partners_warning')}</AlertDescription></AlertContent></Alert>
                    )}
                  </Field>
                </div>
              </div>

              {/* BAGIAN 2: Kriteria Penilaian */}
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <div className="flex items-center gap-2">
                    <Badge tone="info" className="size-6 justify-center rounded-full p-0 font-semibold">2</Badge>
                    <Heading as="h3" size="sm" weight="semibold">{t('eval.section2')}</Heading>
                  </div>
                </div>

                {/* Obligation / Target */}
                <RadioGroup required value={formData.obligation_target || null} onValueChange={details => details.value && setFormData({ ...formData, obligation_target: details.value as typeof formData.obligation_target })}>
                  <RadioGroupLabel>{t('eval.obligation_target')} <span className="text-destructive" aria-hidden="true">*</span></RadioGroupLabel>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { value: 'Sangat baik', label: t('eval.opt_sangat_baik'), points: `30 ${t('eval.points')}` },
                      { value: 'Baik', label: t('eval.opt_baik'), points: `20 ${t('eval.points')}` },
                      { value: 'Kurang baik', label: t('eval.opt_kurang_baik'), points: `10 ${t('eval.points')}` },
                    ].map((opt) => (
                      <RadioGroupItem key={opt.value} value={opt.value} className="flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 data-[state=checked]:border-primary data-[state=checked]:bg-accent">
                        <RadioGroupItemControl />
                        <RadioGroupItemText className="text-sm">{opt.label}</RadioGroupItemText>
                        <Badge tone="info" className="ms-auto">{opt.points}</Badge>
                        
                        <RadioGroupItemHiddenInput />
                      </RadioGroupItem>
                    ))}
                  </div>
                </RadioGroup>

                {/* Incident Frequency */}
                <RadioGroup required value={formData.incident_frequency || null} onValueChange={details => details.value && setFormData({ ...formData, incident_frequency: details.value as typeof formData.incident_frequency })}>
                  <RadioGroupLabel>{t('eval.incident_freq')} <span className="text-destructive" aria-hidden="true">*</span></RadioGroupLabel>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { value: 'Never', label: t('eval.opt_never'), points: `20 ${t('eval.points')}` },
                      { value: 'Rare', label: t('eval.opt_rare'), points: `15 ${t('eval.points')}` },
                      { value: 'Frequent', label: t('eval.opt_frequent'), points: `10 ${t('eval.points')}` },
                    ].map((opt) => (
                      <RadioGroupItem key={opt.value} value={opt.value} className="flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 data-[state=checked]:border-primary data-[state=checked]:bg-accent">
                        <RadioGroupItemControl />
                        <RadioGroupItemText className="text-sm">{opt.label}</RadioGroupItemText>
                        <Badge tone="info" className="ms-auto">{opt.points}</Badge>
                        
                        <RadioGroupItemHiddenInput />
                      </RadioGroupItem>
                    ))}
                  </div>
                </RadioGroup>

                {/* Communication */}
                <RadioGroup required value={formData.communication || null} onValueChange={details => details.value && setFormData({ ...formData, communication: details.value as typeof formData.communication })}>
                  <RadioGroupLabel>{t('eval.communication')} <span className="text-destructive" aria-hidden="true">*</span></RadioGroupLabel>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { value: 'Sangat baik', label: t('eval.opt_sangat_baik'), points: `20 ${t('eval.points')}` },
                      { value: 'Baik', label: t('eval.opt_baik'), points: `15 ${t('eval.points')}` },
                      { value: 'Kurang baik', label: t('eval.opt_kurang_baik'), points: `10 ${t('eval.points')}` },
                    ].map((opt) => (
                      <RadioGroupItem key={opt.value} value={opt.value} className="flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 data-[state=checked]:border-primary data-[state=checked]:bg-accent">
                        <RadioGroupItemControl />
                        <RadioGroupItemText className="text-sm">{opt.label}</RadioGroupItemText>
                        <Badge tone="info" className="ms-auto">{opt.points}</Badge>
                        
                        <RadioGroupItemHiddenInput />
                      </RadioGroupItem>
                    ))}
                  </div>
                </RadioGroup>

                {/* Pricing */}
                <RadioGroup required value={formData.pricing || null} onValueChange={details => details.value && setFormData({ ...formData, pricing: details.value as typeof formData.pricing })}>
                  <RadioGroupLabel>{t('eval.pricing')} <span className="text-destructive" aria-hidden="true">*</span></RadioGroupLabel>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { value: 'Cheap', label: t('eval.opt_cheap'), points: `30 ${t('eval.points')}` },
                      { value: 'Moderate', label: t('eval.opt_moderate'), points: `20 ${t('eval.points')}` },
                      { value: 'Expensive', label: t('eval.opt_expensive'), points: `10 ${t('eval.points')}` },
                    ].map((opt) => (
                      <RadioGroupItem key={opt.value} value={opt.value} className="flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 data-[state=checked]:border-primary data-[state=checked]:bg-accent">
                        <RadioGroupItemControl />
                        <RadioGroupItemText className="text-sm">{opt.label}</RadioGroupItemText>
                        <Badge tone="info" className="ms-auto">{opt.points}</Badge>
                        
                        <RadioGroupItemHiddenInput />
                      </RadioGroupItem>
                    ))}
                  </div>
                </RadioGroup>
              </div>

              {/* BAGIAN 3: Evaluasi Akhir & Catatan */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-border">
                  <Badge tone="info" className="size-6 justify-center rounded-full p-0 font-semibold">3</Badge>
                  <Heading as="h3" size="sm" weight="semibold">
                    {t('eval.section3')}
                  </Heading>
                </div>

                {/* Live Score Calculation Display */}
                <Card className="gap-3 border-primary/30 bg-accent p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Calculator className="w-4 h-4 text-accent-foreground" />
                      <span className="text-xs font-extrabold text-accent-foreground uppercase tracking-wider">
                        {t('eval.calc_score_breakdown')}
                      </span>
                    </div>
                    <Badge tone="info" className="gap-1 px-3 py-1">
                      {t('eval.total', 'Total:')} <strong className="text-base tabular-nums">{liveBreakdown.total}</strong> / 100 {t('eval.points')}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <Card className="p-2">
                      <span className="text-muted-foreground text-xs block font-medium">{t('eval.obligation_target_2', 'Obligation / Target')}</span>
                      <span className="font-extrabold text-accent-foreground">
                        {liveBreakdown.tScore} {t('eval.points')}
                      </span>
                    </Card>
                    <Card className="p-2">
                      <span className="text-muted-foreground text-xs block font-medium">{t('eval.incident_freq_2', 'Incident Freq')}</span>
                      <span className="font-extrabold text-accent-foreground">
                        {liveBreakdown.fScore} {t('eval.points')}
                      </span>
                    </Card>
                    <Card className="p-2">
                      <span className="text-muted-foreground text-xs block font-medium">{t('audit_col_evalCommunication', 'Communication')}</span>
                      <span className="font-extrabold text-accent-foreground">
                        {liveBreakdown.cScore} {t('eval.points')}
                      </span>
                    </Card>
                    <Card className="p-2">
                      <span className="text-muted-foreground text-xs block font-medium">{t('eval.pricing_2', 'Pricing')}</span>
                      <span className="font-extrabold text-accent-foreground">
                        {liveBreakdown.pScore} {t('eval.points')}
                      </span>
                    </Card>
                  </div>
                </Card>

                {/* Final Evaluation Option */}
                <RadioGroup required value={formData.final_evaluation || null} onValueChange={details => details.value && setFormData({ ...formData, final_evaluation: details.value as typeof formData.final_evaluation })}>
                  <RadioGroupLabel>{t('eval.col_final_eval')} <span className="text-destructive" aria-hidden="true">*</span></RadioGroupLabel>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      {
                        value: 'Recommended',
                        label: t('eval.status_rec'),
                        desc: t('eval.opt_rec_desc'),
                      },
                      {
                        value: 'Recommended with notes',
                        label: t('eval.rec_with_notes'),
                        desc: t('eval.opt_rec_notes_desc'),
                      },
                      {
                        value: 'Not recommended',
                        label: t('eval.status_not_rec'),
                        desc: t('eval.opt_not_rec_desc'),
                      },
                    ].map((opt) => (
                      <RadioGroupItem key={opt.value} value={opt.value} className="flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 data-[state=checked]:border-primary data-[state=checked]:bg-accent">
                        <RadioGroupItemControl />
                        <RadioGroupItemText className="text-sm">{opt.label}</RadioGroupItemText>
                        
                        <RadioGroupItemText className="basis-full text-xs text-muted-foreground">{opt.desc}</RadioGroupItemText>
                        <RadioGroupItemHiddenInput />
                      </RadioGroupItem>
                    ))}
                  </div>
                </RadioGroup>

                {/* Notes / Alasan Evaluasi */}
                <Field>
                  <FieldLabel htmlFor="partnerevaluationview-field-3">
                    {t('eval.notes_label')}
                  </FieldLabel>
                  <Textarea id="partnerevaluationview-field-3"
                    rows={4}
                    placeholder={t('eval.notes_ph')}
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full"
                  />
                </Field>
              </div>
              </div>

              {/* Modal Footer */}
              <div className="p-4 sm:p-5 bg-card border-t border-border flex items-center justify-between gap-2 shrink-0">
                <span className="text-xs text-muted-foreground font-medium hidden sm:inline">
                  {t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan')}
                </span>
                <div className="flex items-center gap-2 ml-auto">
                  <Button variant="ghost"
                    type="button"
                    onClick={() => setShowFormModal(false)}
                  >
                    {t('eval.btn_cancel')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                  >
                    {isSubmitting
                      ? t('eval.btn_saving')
                      : editingItem
                      ? t('eval.btn_update')
                      : t('eval.btn_submit')}
                  </Button>
                </div>
              </div>
            </form>
        </ModalFrame>
      )}

      {/* DETAIL MODAL: View Single Evaluation Report */}
      {viewingDetailItem && (
        <ModalFrame onClose={() => setViewingDetailItem(null)}>

            <DialogHeader className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
              <div className="flex items-center gap-2.5">
                <Building2 className="w-5 h-5 text-accent-foreground" />
                <div>
                  <DialogTitle className="flex items-center gap-2">
                    {t('eval.detail_modal_title', 'Laporan Evaluasi Partner')}
                  </DialogTitle>
                  <p className="text-xs text-muted-foreground font-medium">{viewingDetailItem.supplier_name}</p>
                </div>
              </div>
              <Button variant="secondary" size="icon-md"
                type="button"
                onClick={() => setViewingDetailItem(null)}
                aria-label={t('common.close')}
              >
                <X className="w-5 h-5" />
              </Button>
            </DialogHeader>

            <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-xs text-foreground flex-1">
              <Card className="grid grid-cols-2 gap-3 p-3.5">
                <div>
                  <span className="text-xs text-muted-foreground font-bold uppercase block">
                    {t('eval.col_id_date')} {t('eval.id', 'ID')}
                  </span>
                  <span className="font-mono font-bold text-foreground">{viewingDetailItem.id}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground font-bold uppercase block">
                    {t('eval.review_date')}
                  </span>
                  <span className="font-bold text-foreground">{formatBusinessDate(viewingDetailItem.review_date)}</span>
                </div>
              </Card>

              <div className="p-3 bg-accent rounded-xl border border-primary/30 flex items-center justify-between">
                <div>
                  <span className="text-xs text-accent-foreground font-bold uppercase block">
                    {t('eval.col_calculated_score')}
                  </span>
                  <span className="text-xs text-accent-foreground font-semibold">{t('eval.auto_score_text')}</span>
                </div>
                <div className="text-right">
                  <span className="text-xl font-black text-accent-foreground">
                    {viewingDetailItem.calculated_score !== undefined
                      ? viewingDetailItem.calculated_score
                      : computeScoreFromFields(
                          viewingDetailItem.obligation_target,
                          viewingDetailItem.incident_frequency,
                          viewingDetailItem.communication,
                          viewingDetailItem.pricing
                        )}
                  </span>
                  <span className="text-xs font-semibold text-accent-foreground"> / 100 {t('eval.points')}</span>
                </div>
              </div>

              <Card className="space-y-2 p-3.5 text-xs">
                <div className="flex justify-between pb-1.5 border-b border-border">
                  <span className="text-muted-foreground font-medium">{t('eval.obligation_target_2', 'Obligation / Target')}</span>
                  <span className="font-bold text-foreground">
                    {viewingDetailItem.obligation_target}
                  </span>
                </div>
                <div className="flex justify-between pb-1.5 border-b border-border">
                  <span className="text-muted-foreground font-medium">{t('audit_col_evalIncident', 'Incident Frequency')}</span>
                  <span className="font-bold text-foreground">
                    {viewingDetailItem.incident_frequency}
                  </span>
                </div>
                <div className="flex justify-between pb-1.5 border-b border-border">
                  <span className="text-muted-foreground font-medium">{t('audit_col_evalCommunication', 'Communication')}</span>
                  <span className="font-bold text-foreground">
                    {viewingDetailItem.communication}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-medium">{t('eval.pricing_2', 'Pricing')}</span>
                  <span className="font-bold text-foreground">{viewingDetailItem.pricing}</span>
                </div>
              </Card>

              <div className="pt-2">
                <span className="text-xs text-muted-foreground font-bold uppercase block mb-1">
                  {t('eval.rec_result')}
                </span>
                <div className="font-bold">
                  {viewingDetailItem.final_evaluation === 'Recommended' && (
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-accent text-accent-foreground border border-primary/30 inline-flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-accent-foreground" />
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
                <div className="p-3 bg-background rounded-xl border border-border">
                  <span className="text-xs text-muted-foreground font-bold uppercase block mb-1">
                    {t('eval.notes_title')}
                  </span>
                  <p className="text-xs text-foreground whitespace-pre-wrap">
                    {viewingDetailItem.notes}
                  </p>
                </div>
              )}
            </div>

            <div className="p-4 sm:p-5 bg-background border-t border-border flex justify-end">
              <Button variant="ghost" size="sm"
                type="button"
                onClick={() => setViewingDetailItem(null)}
              >
                {t('eval.btn_close')}
              </Button>
            </div>
        </ModalFrame>
      )}
    </div>
  );
};
