import { TableViewMenu, TableViewOption } from './ui/table-view-menu';
import { BulkSelectionBar } from './ui/bulk-selection-bar';
import { deleteRecords } from '../lib/bulkDelete';
import { downloadCsv } from '../lib/csv';
import { AlphabeticalSelect } from './ui/alphabetical-select';
import { ModalFrame } from './ui/modal-frame';
import { formatBusinessDate } from '../lib/displayDate';
import { FilterSummary } from './ui/filter-summary';
import { TableEmptyState } from './ui/table-empty-state';
import React, { useEffect, useState } from 'react';
import { Partner, PartnerEvaluation, Contract, InsertionOrder, PartnerSpending, RedlineAnalysisData } from '@legalio/types';
import { ContractRedliningPanel } from './ContractRedliningPanel';
import { evaluationSnapshot, type EvaluationSnapshot } from '../lib/evaluationSnapshot';
import { formatMoney, getActiveFormattingLocale } from '@legalio/shared/currencyUtils';
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
  ArrowLeft,
  AlertTriangle,
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
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Text } from '@legalio/ui-components/text';
import { FormSection } from '@legalio/ui-components/blocks';
interface PartnerEvaluationViewProps {
  partners: Partner[];
  contracts?: Contract[];
  /** For the partnership snapshot shown beside the form. */
  ios?: InsertionOrder[];
  spendings?: PartnerSpending[];
  evaluations: PartnerEvaluation[];
  onRefreshData: () => void;
  userEmail?: string;
  userName?: string;
  userRole?: string;
  openEvaluationId?: string;
  onEvaluationOpened?: () => void;
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


/** Criterion with its answers as one row of 34 tall pills: label on the minor side, pills on the major side (golden split). */
function CriterionRow({ label, value, onChange, options, stacked = false }: {
  label: React.ReactNode;
  value: string | undefined;
  onChange: (value: string) => void;
  options: { value: string; label: React.ReactNode; points: React.ReactNode }[];
  stacked?: boolean;
}) {
  return (
    <RadioGroup required value={value || null} onValueChange={details => details.value && onChange(details.value)}
      className={stacked ? 'gap-g8' : 'items-center gap-g8 sm:grid sm:grid-cols-[var(--spacing-g233)_minmax(0,1fr)] sm:gap-g13'}>
      <RadioGroupLabel>{label} <span className="text-destructive" aria-hidden="true">*</span></RadioGroupLabel>
      <div className="grid grid-cols-3 gap-g8">
        {options.map(opt => (
          <RadioGroupItem key={opt.value} value={opt.value}
            className="h-g34 w-full min-w-0 justify-center overflow-hidden rounded-full border border-border bg-muted px-g8 text-sm font-medium data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground">
            <RadioGroupItemText className="text-center leading-g16 whitespace-normal">{opt.label}</RadioGroupItemText>
            <span className="sr-only">{opt.points}</span>
            <RadioGroupItemHiddenInput />
          </RadioGroupItem>
        ))}
      </div>
    </RadioGroup>
  );
}

/** Single-series monthly spend bars (USD): one colour, no legend, value on hover and in a screen-reader list. */
function MonthlySpendBars({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(...values, 0);
  const locale = getActiveFormattingLocale();
  const month = (i: number, style: 'narrow' | 'short') => new Intl.DateTimeFormat(locale, { month: style }).format(new Date(2026, i, 1));
  return (
    <figure className="space-y-g5">
      <figcaption><Text as="span" size="xs" tone="muted">{label}</Text></figcaption>
      <div className="flex h-g55 items-end gap-[2px]" aria-hidden="true">
        {values.map((v, i) => (
          <div key={i} title={`${month(i, 'short')}: ${formatMoney(v, 'USD')}`} className="flex h-full flex-1 items-end hover:bg-muted">
            <div className="w-full rounded-t-[4px] bg-primary" style={{ height: max > 0 ? `${(v / max) * 100}%` : 0 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-[2px]" aria-hidden="true">
        {values.map((_, i) => <Text key={i} as="span" size="xs" tone="muted" className="flex-1 text-center">{month(i, 'narrow')}</Text>)}
      </div>
      <ul className="sr-only">{values.map((v, i) => <li key={i}>{month(i, 'short')}: {formatMoney(v, 'USD')}</li>)}</ul>
    </figure>
  );
}

function SnapshotTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-muted/40 p-g8">
      <Text as="span" size="xs" tone="muted" className="block truncate">{label}</Text>
      <Text as="span" size="sm" weight="bold" className="block tabular-nums">{value}</Text>
      {sub && <Text as="span" size="xs" tone="muted" className="block">{sub}</Text>}
    </div>
  );
}

export const PartnerEvaluationView: React.FC<PartnerEvaluationViewProps> = ({
  partners,
  contracts = [],
  ios = [],
  spendings = [],
  evaluations = [],
  onRefreshData,
  userEmail,
  userName,
  userRole,
  openEvaluationId,
  onEvaluationOpened,
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
        ...(redline && { redline_analysis: redline.analysis, redline_analyzed_at: redline.at }),
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
  useEffect(() => {
    if (!openEvaluationId) return;
    const evaluation = evaluations.find(item => item.id === openEvaluationId);
    if (evaluation && hasPermission('document.view')) setViewingDetailItem(evaluation);
    onEvaluationOpened?.();
  }, [openEvaluationId, evaluations, hasPermission, onEvaluationOpened]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [redline, setRedline] = useState<{ analysis: RedlineAnalysisData; at?: string } | null>(null);
  // Every opener sets editingItem, so the stored review follows it.
  useEffect(() => {
    setRedline(editingItem?.redline_analysis ? { analysis: editingItem.redline_analysis, at: editingItem.redline_analyzed_at } : null);
  }, [editingItem]);

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
      if (c.start_date) {
        const yr = c.start_date.split('-')[0];
        if (yr && yr.length === 4) yrSet.add(yr);
      }
      if (c.end_date && !c.end_date.toLowerCase().includes('unlimited')) {
        const yr = c.end_date.split('-')[0];
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
          if (c.start_date) {
            const yr = parseInt(c.start_date.split('-')[0], 10);
            if (!isNaN(yr)) startYr = yr;
          }

          const endStr = (c.end_date || '').toLowerCase().trim();
          const isUnlimited =
            !c.end_date ||
            endStr === '' ||
            endStr.includes('unlimited') ||
            endStr.includes('tanpa batas') ||
            endStr.includes('seumur hidup') ||
            c.auto_renewal;

          let endYr = Infinity;
          if (!isUnlimited && c.end_date) {
            const parsedEnd = parseInt(c.end_date.split('-')[0], 10);
            if (!isNaN(parsedEnd)) {
              endYr = parsedEnd;
            }
          }

          if (c.status === 'Terminated') {
            if (!isUnlimited && endYr !== Infinity) {
            } else if (c.updated_at) {
              const termYr = parseInt(c.updated_at.split('-')[0], 10);
              if (!isNaN(termYr)) endYr = termYr;
            } else if (c.end_date) {
              const parsedEnd = parseInt(c.end_date.split('-')[0], 10);
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
        const hasByName = evaluatedPartnerNames.has(p.partner_name.toLowerCase());
        return !hasById && !hasByName;
      })
      .map((p) => ({
        id: `NOT_REVIEWED_${p.partner_id}_${selectedYear}`,
        review_date: `${selectedYear}`,
        partner_id: p.partner_id,
        supplier_name: p.partner_name,
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
  const [rowsPerPage, setRowsPerPage] = useState(5);
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

  const handleBulkDelete = async (ids: string[]) => {
    if (!canDeleteEvaluation) return;
    // Rows for partners without a review are placeholders, not records.
    const targets = ids.filter(id => id && !id.startsWith('NOT_REVIEWED'));
    if (targets.length === 0) return;
    const ok = await confirmDialog({
      description: t('bulk.confirm_delete', 'Hapus {count} {noun} terpilih? Tindakan ini tidak dapat dibatalkan.', { count: targets.length, noun: t('bulk.noun_evaluation', 'evaluasi') }),
      tone: 'danger',
      confirmLabel: t('io.action_delete', 'Hapus'),
    });
    if (!ok) return;
    const failed = await deleteRecords('/api/partner-evaluations', targets, { userEmail, userName, userRole });
    onRefreshData();
    if (failed.length > 0) {
      showAlert({ title: t('bulk.delete_failed_title', 'Sebagian gagal dihapus'), description: t('bulk.delete_failed_message', '{failed} dari {total} gagal dihapus.', { failed: failed.length, total: targets.length }), variant: 'destructive' });
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
        </Button></TooltipTrigger><TooltipBody>{t('eval.urutkan_berdasarkan', 'Urutkan berdasarkan {label}', { label })}</TooltipBody></Tooltip>
      </TableColumnHeader>
    );
  };

  const isSavedEvaluation = Boolean(editingItem?.id && !editingItem.id.startsWith('NOT_REVIEWED'));
  const snapshotYear = Number((formData.review_date || '').slice(0, 4)) || new Date().getFullYear();
  const snapshot: EvaluationSnapshot | null = formData.supplier_name
    ? evaluationSnapshot({ partner_id: formData.partner_id || undefined, partner_name: formData.supplier_name }, snapshotYear,
        new Date().toISOString().slice(0, 10), { partners, contracts, ios, spendings, evaluations }, isSavedEvaluation ? editingItem?.id : undefined)
    : null;

  /** Snapshot figures; lines that have nothing to report are left out to keep the panel minimal. */
  const renderSnapshot = (snap: EvaluationSnapshot, liveTotal: number) => {
    const pct = (n: number) => `${n > 0 ? '+' : ''}${n}%`;
    return (
      <div className="space-y-g13">
        {snap.ytd && <Text size="xs" tone="muted">{t('eval.snapshot.ytd', 'Year to date, until today')}</Text>}
        <div className="grid grid-cols-2 gap-g8">
          <SnapshotTile label={t('eval.snapshot.spend', 'Total spending')} value={formatMoney(snap.spendUsd, 'USD')}
            sub={snap.growthPct !== undefined ? t('eval.snapshot.vs_last_year', '{pct} vs {year}', { pct: pct(snap.growthPct), year: snap.year - 1 }) : undefined} />
          <SnapshotTile label={t('eval.snapshot.invoices', 'Invoices')} value={snap.invoices} />
          <SnapshotTile label={t('eval.snapshot.agreements', 'Active contracts · SOs')} value={`${snap.activeContracts} · ${snap.activeSos}`} />
          <SnapshotTile label={t('eval.snapshot.so_used', 'SO budget used')} value={snap.soUsedPct !== undefined ? `${snap.soUsedPct}%` : '—'} />
        </div>
        {snap.spendUsd > 0 && <MonthlySpendBars values={snap.monthlyUsd} label={t('eval.snapshot.monthly', 'Monthly spending (USD)')} />}
        <ul className="flex flex-col gap-g5">
          {snap.previous && (
            <li><Text size="xs">{t('eval.snapshot.previous', 'Previous evaluation ({year}): {score}/100 · now {now}/100', { year: snap.previous.year, score: snap.previous.score, now: liveTotal })}</Text></li>
          )}
          {snap.underDelivered.count > 0 && (
            <li><Text size="xs">{t('eval.snapshot.under', '{count} of {of} invoices under-delivered (avg {pct}% below)', { count: snap.underDelivered.count, of: snap.underDelivered.of, pct: snap.underDelivered.avgPct ?? 0 })}</Text></li>
          )}
          {snap.expiring.map((c) => (
            <li key={c.number}><Text size="xs">{c.autoRenewal
              ? t('eval.snapshot.expiring_auto', 'Contract {number} ends {date} (auto-renews)', { number: c.number, date: formatBusinessDate(c.endDate) })
              : t('eval.snapshot.expiring', 'Contract {number} ends {date}', { number: c.number, date: formatBusinessDate(c.endDate) })}</Text></li>
          ))}
          {snap.avgRiskScore !== undefined && (
            <li><Text size="xs">{t('eval.snapshot.risk', 'Average contract risk score: {score}/100', { score: snap.avgRiskScore })}</Text></li>
          )}
          {snap.pricing && (
            <li><Text size="xs">{t('eval.snapshot.pricing', '{model} {price} vs peer average {avg} ({pct})', { model: snap.pricing.model,
              price: formatMoney(snap.pricing.price, snap.pricing.currency), avg: formatMoney(snap.pricing.peerAvg, snap.pricing.currency), pct: pct(snap.pricing.diffPct) })}</Text></li>
          )}
        </ul>
      </div>
    );
  };

  if (showFormModal) {
    return (
    <form onSubmit={handleSubmit} className="w-full min-w-0 space-y-g21" aria-labelledby="evaluation-form-heading">
      <div className="flex flex-wrap items-center justify-between gap-g13">
        <Heading as="h2" size="md" weight="semibold" id="evaluation-form-heading">
          {isSavedEvaluation ? t('eval.modal_title_edit', 'Edit Evaluasi Partner') : t('eval.modal_title_add', 'Form Evaluasi Partner')}
        </Heading>
        <Button variant="link" size="sm" type="button" onClick={() => setShowFormModal(false)} className="no-underline hover:underline"><ArrowLeft className="size-g13" aria-hidden />{t('eval.back', 'Back to evaluation list')}</Button>
      </div>

      <div className="grid grid-cols-1 items-start gap-g21 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
              <div className="flex min-w-0 flex-col gap-g13 text-foreground">
              {formError && (
                <Alert status="error"><AlertIndicator /><AlertContent><AlertDescription>{formError}</AlertDescription></AlertContent></Alert>
              )}

              <FormSection step={1} title={t('eval.section1')}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-g13">
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
                            const found = partners.find((p) => p.partner_name === selectedPartnerName);
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
                            <option key={p.partner_id} value={p.partner_name}>
                              {p.partner_name} ({p.partner_id} - {p.partner_type})
                            </option>
                          ))}
                        </AlphabeticalSelect>
                      ) : (
                        <Alert status="warning"><AlertIndicator /><AlertContent><AlertDescription>{t('eval.no_partners_warning')}</AlertDescription></AlertContent></Alert>
                      )}
                    </Field>
                  </div>
              </FormSection>

              <FormSection step={2} title={t('eval.section2')}>
                <CriterionRow label={t('eval.obligation_target')} value={formData.obligation_target} onChange={value => setFormData({ ...formData, obligation_target: value as typeof formData.obligation_target })} options={[
                  { value: 'Sangat baik', label: t('eval.opt_sangat_baik'), points: `30 ${t('eval.points')}` },
                  { value: 'Baik', label: t('eval.opt_baik'), points: `20 ${t('eval.points')}` },
                  { value: 'Kurang baik', label: t('eval.opt_kurang_baik'), points: `10 ${t('eval.points')}` },
                ]} />
                <CriterionRow label={t('eval.incident_freq')} value={formData.incident_frequency} onChange={value => setFormData({ ...formData, incident_frequency: value as typeof formData.incident_frequency })} options={[
                  { value: 'Never', label: t('eval.opt_never'), points: `20 ${t('eval.points')}` },
                  { value: 'Rare', label: t('eval.opt_rare'), points: `15 ${t('eval.points')}` },
                  { value: 'Frequent', label: t('eval.opt_frequent'), points: `10 ${t('eval.points')}` },
                ]} />
                <CriterionRow label={t('eval.communication')} value={formData.communication} onChange={value => setFormData({ ...formData, communication: value as typeof formData.communication })} options={[
                  { value: 'Sangat baik', label: t('eval.opt_sangat_baik'), points: `20 ${t('eval.points')}` },
                  { value: 'Baik', label: t('eval.opt_baik'), points: `15 ${t('eval.points')}` },
                  { value: 'Kurang baik', label: t('eval.opt_kurang_baik'), points: `10 ${t('eval.points')}` },
                ]} />
                <CriterionRow label={t('eval.pricing')} value={formData.pricing} onChange={value => setFormData({ ...formData, pricing: value as typeof formData.pricing })} options={[
                  { value: 'Cheap', label: t('eval.opt_cheap'), points: `30 ${t('eval.points')}` },
                  { value: 'Moderate', label: t('eval.opt_moderate'), points: `20 ${t('eval.points')}` },
                  { value: 'Expensive', label: t('eval.opt_expensive'), points: `10 ${t('eval.points')}` },
                ]} />
              </FormSection>

              <FormSection step={3} title={t('eval.section3')}>
                <div className="grid grid-cols-2 gap-g8 sm:grid-cols-5" aria-label={t('eval.calc_score_breakdown')}>
                  {[
                    [t('eval.obligation_target_2', 'Obligation / Target'), liveBreakdown.tScore],
                    [t('eval.incident_freq_2', 'Incident Freq'), liveBreakdown.fScore],
                    [t('audit_col_evalCommunication', 'Communication'), liveBreakdown.cScore],
                    [t('eval.pricing_2', 'Pricing'), liveBreakdown.pScore],
                  ].map(([label, score]) => (
                    <div key={String(label)} className="rounded-md border border-border bg-muted p-g8">
                      <Text as="span" size="xs" weight="semibold" tone="muted" className="block truncate">{label}</Text>
                      <Text as="span" weight="bold" size="md" className="tabular-nums">{score} {t('eval.points')}</Text>
                    </div>
                  ))}
                  <div className="col-span-2 rounded-md border border-primary bg-primary p-g8 text-primary-foreground sm:col-span-1">
                    <Text as="span" size="xs" weight="semibold" className="block text-current">{t('eval.total', 'Total:')}</Text>
                    <Text as="span" weight="bold" size="md" className="tabular-nums text-current">{liveBreakdown.total} / 100</Text>
                  </div>
                </div>

                <CriterionRow stacked label={t('eval.col_final_eval')} value={formData.final_evaluation} onChange={value => setFormData({ ...formData, final_evaluation: value as typeof formData.final_evaluation })} options={[
                  { value: 'Recommended', label: t('eval.status_rec'), points: t('eval.opt_rec_desc') },
                  { value: 'Recommended with notes', label: t('eval.rec_with_notes'), points: t('eval.opt_rec_notes_desc') },
                  { value: 'Not recommended', label: t('eval.status_not_rec'), points: t('eval.opt_not_rec_desc') },
                ]} />

                <Field>
                  <FieldLabel htmlFor="partnerevaluationview-field-3">{t('eval.notes_label')}</FieldLabel>
                  <Textarea id="partnerevaluationview-field-3"
                    rows={2}
                    placeholder={t('eval.notes_ph')}
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full"
                  />
                </Field>
              </FormSection>
              </div>

          <ContractRedliningPanel
            title={snapshot ? t('eval.snapshot.panel_title_year', 'Partnership Snapshot {year}', { year: snapshot.year }) : t('eval.snapshot.panel_title', 'Partnership Snapshot')}
            endpoint="/api/partner-evaluations/review-analysis"
            canAnalyze={Boolean(formData.supplier_name)}
            analysis={redline?.analysis ?? null}
            onAnalysis={(analysis, at) => {
              setRedline({ analysis, at });
              if (isSavedEvaluation) onRefreshData();
            }}
            labels={{
              attention: t('partner.review.attention', '{count} items require attention.'),
              items: t('partner.review.items', 'Key items'),
              original: t('partner.review.finding', 'Finding'),
              recommended: t('partner.review.action', 'Recommended Action'),
            }}
            body={{ evaluation: { ...formData, id: isSavedEvaluation ? editingItem?.id : undefined }, snapshot: snapshot ?? undefined }}
            renderExtra={(analysis) => analysis.complianceChecklist?.length ? (
              <div className="space-y-g5">
                <Text as="span" size="sm" weight="bold">{t('eval.snapshot.suggested', 'Suggested ratings')}</Text>
                <ul className="flex flex-col gap-g5">
                  {analysis.complianceChecklist.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-g8">
                      {item.status === 'COMPLIANT'
                        ? <CheckCircle2 className="mt-g2 size-g13 shrink-0 text-status-success" aria-hidden />
                        : <AlertTriangle className="mt-g2 size-g13 shrink-0 text-status-warning" aria-hidden />}
                      <Text size="xs"><span className="font-semibold">{item.item}:</span> {item.notes}</Text>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          >
            {snapshot && renderSnapshot(snapshot, liveBreakdown.total)}
          </ContractRedliningPanel>
      </div>

              <Card className="flex-row flex-wrap items-center justify-between gap-g8 px-g21 py-g13">
                <Text as="span" size="xs" weight="medium" tone="muted" className="hidden sm:inline">
                  {t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan')}
                </Text>
                <div className="flex items-center gap-g8 ml-auto">
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
              </Card>
    </form>
    );
  }

  return (
    <div className="space-y-g21">
      <div className="flex flex-wrap items-center justify-between gap-g13">
        <div>
          <Heading as="h2" size="md" weight="semibold">
            <span>{t('eval.annual_title', 'Evaluasi Vendor Tahunan')}</span>
          </Heading>
        </div>

        <div className="flex items-center gap-g8 shrink-0 flex-wrap">
          {hasPermission('export.csv') && (
            <Tooltip><TooltipTrigger asChild><Button variant="outline"
              onClick={handleExportCSV}
              disabled={sortedEvaluations.length === 0} aria-label={t('eval.export_csv', 'Ekspor CSV')}
            >
              <Download className="w-g16 h-g16" />
              <span>{t('eval.export_csv', 'Ekspor CSV')}</span>
            </Button></TooltipTrigger><TooltipBody>{t('eval.export_csv', 'Ekspor CSV')}</TooltipBody></Tooltip>
          )}

          {canCreateEvaluation && (
            <Button
              onClick={handleAddNew}
            >
              <Plus className="w-g16 h-g16" />
              <span>{t('ui.add_evaluation')}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Filter Bar & View Toggle - Justified Responsive Grid/Flex */}
      <Card className="p-g13">
        <div className="flex w-full flex-wrap items-center gap-g13">
          {/* 1 Box Search */}
          <InputGroup className="relative flex-1 min-w-g233 sm:min-w-g233">
            <InputGroupAddon><Search className="size-g16" aria-hidden="true" /></InputGroupAddon>
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
            className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
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
            className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
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
            className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
          >
            <option value="ALL">{t('eval.all_obligation_targets', 'Semua Target Kewajiban')}</option>
            <option value="Sangat baik">{t('eval.opt_sangat_baik', 'Sangat baik')}</option>
            <option value="Baik">{t('eval.opt_baik', 'Baik')}</option>
            <option value="Kurang baik">{t('eval.opt_kurang_baik', 'Kurang baik')}</option>
          </AlphabeticalSelect>

          {/* View Toggle */}
          <TableViewMenu title={t('eval.view_settings', 'Pengaturan Tampilan Kolom')} label={t('eval.view', 'View')}>
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

      {canDeleteEvaluation && (
        <BulkSelectionBar
          count={selectedRows.filter(id => id && !id.startsWith('NOT_REVIEWED')).length}
          noun={t('bulk.noun_evaluation', 'evaluasi')}
          onDelete={async () => { await handleBulkDelete(selectedRows); setSelectedRows([]); }}
        />
      )}
      <Card className="overflow-hidden">
        <FilterSummary filters={[{ label: t('ui.search'), value: searchTerm, active: Boolean(searchTerm) }, { label: t('ui.filter_year'), value: selectedYear, active: selectedYear !== String(new Date().getFullYear()) }, { label: t('ui.filter_decision'), value: selectedEvaluationFilter, active: selectedEvaluationFilter !== 'ALL' }, { label: t('ui.filter_target'), value: selectedObligationTarget, active: selectedObligationTarget !== 'ALL' }]} onReset={() => { setSearchTerm(''); setSelectedYear(String(new Date().getFullYear())); setSelectedEvaluationFilter('ALL'); setSelectedObligationTarget('ALL'); }} />
        <Text size="xs" tone="muted" className="px-g13 py-g8 md:hidden">{t('ui.scroll_table')}</Text>
        <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.scroll_table')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableColumnHeader scope="col" className="w-g42">
                  <div className="flex items-center justify-start">
                    <Checkbox aria-label={t('eval.pilih_semua_evaluasi', 'Pilih semua evaluasi')} checked={selectedRows.length > 0 && selectedRows.length === sortedEvaluations.length} onCheckedChange={(details) => handleSelectAll(details.checked === true)}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                  </div>
                </TableColumnHeader>
                {visibleColumns.vendor && (
                  <TableColumnHeader scope="col" aria-sort={sortField === 'vendor' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <Button variant="ghost" size="sm" className="-ms-g13 font-semibold text-muted-foreground" type="button" onClick={() => handleSort('vendor')}>
                      <span>{t('eval.col_vendor', 'Partner')}</span>
                      <ArrowUpDown className="w-g13 h-g13 text-muted-foreground" />
                    </Button>
                  </TableColumnHeader>
                )}
                {visibleColumns.target && <TableColumnHeader scope="col">{t('eval.col_target', 'Target Kewajiban')}</TableColumnHeader>}
                {visibleColumns.skor && (
                  <TableColumnHeader scope="col" aria-sort={sortField === 'calculated_score' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <Button variant="ghost" size="sm" className="-ms-g13 font-semibold text-muted-foreground" type="button" onClick={() => handleSort('calculated_score')}>
                      <span>{t('eval.col_calculated_score', 'Skor')}</span>
                      <ArrowUpDown className="w-g13 h-g13 text-muted-foreground" />
                    </Button>
                  </TableColumnHeader>
                )}
                {visibleColumns.hasil && (
                  <TableColumnHeader scope="col" aria-sort={sortField === 'final_eval' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <Button variant="ghost" size="sm" className="-ms-g13 font-semibold text-muted-foreground" type="button" onClick={() => handleSort('final_eval')}>
                      <span>{t('eval.col_recommendation', 'Hasil Rekomendasi')}</span>
                      <ArrowUpDown className="w-g13 h-g13 text-muted-foreground" />
                    </Button>
                  </TableColumnHeader>
                )}
                {visibleColumns.tanggal && (
                  <TableColumnHeader scope="col" aria-sort={sortField === 'review_date' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <Button variant="ghost" size="sm" className="-ms-g13 font-semibold text-muted-foreground" type="button" onClick={() => handleSort('review_date')}>
                      <span>{t('eval.col_review_date', 'Tanggal Review')}</span>
                      <ArrowUpDown className="w-g13 h-g13 text-muted-foreground" />
                    </Button>
                  </TableColumnHeader>
                )}
                <TableColumnHeader scope="col" className="text-right w-g89">
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
                      <TableCell>
                        <div className="flex items-center justify-start">
                          <Checkbox aria-label={t('eval.pilih_evaluasi', 'Pilih evaluasi {supplier_name}', { supplier_name: item.supplier_name })} checked={selectedRows.includes(item.id)} onCheckedChange={() => handleSelectRow(item.id)}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                        </div>
                      </TableCell>

                      {/* 1. Vendor */}
                      {visibleColumns.vendor && (
                        <TableCell>
                          {item.supplier_name}
                        </TableCell>
                      )}

                      {/* 2. Target Kewajiban */}
                      {visibleColumns.target && (
                        <TableCell>
                          {isNotReviewed ? '—' : item.obligation_target}
                        </TableCell>
                      )}

                      {/* 3. Skor */}
                      {visibleColumns.skor && (
                        <TableCell>
                          {isNotReviewed ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className="font-semibold text-foreground">{score} / 100</span>
                          )}
                        </TableCell>
                      )}

                      {/* 4. Hasil Rekomendasi */}
                      {visibleColumns.hasil && (
                        <TableCell className="whitespace-nowrap">
                          {item.final_evaluation === 'Recommended' && (
                            <Badge tone={statusTone('Recommended')}>
                              <CheckCircle2 className="w-g13 h-g13 text-accent-foreground" />
                              <span>{t('eval.status_rec', 'Recommended')}</span>
                            </Badge>
                          )}
                          {item.final_evaluation === 'Recommended with notes' && (
                            <Badge tone={statusTone('Recommended with notes')}>
                              <AlertCircle className="w-g13 h-g13 text-status-warning" />
                              <span>{t('eval.status_rec_notes', 'Recommended with notes')}</span>
                            </Badge>
                          )}
                          {item.final_evaluation === 'Not recommended' && (
                            <Badge tone={statusTone('Not recommended')}>
                              <XCircle className="w-g13 h-g13 text-status-danger" />
                              <span>{t('eval.status_not_rec', 'Not recommended')}</span>
                            </Badge>
                          )}
                          {isNotReviewed && (
                            <Badge tone={statusTone('Draft')}>
                              <Clock className="w-g13 h-g13 text-muted-foreground" />
                              <span>{t('eval.status_not_reviewed', 'Belum Dinilai')}</span>
                            </Badge>
                          )}
                        </TableCell>
                      )}

                      {/* 5. Tanggal Review */}
                      {visibleColumns.tanggal && (
                        <TableCell className="whitespace-nowrap">
                          {formatBusinessDate(item.review_date)}
                        </TableCell>
                      )}

                      {/* Actions */}
                      <TableCell className="text-right w-g89">
                        <div className="flex items-center justify-end">
                          {isNotReviewed ? (
                            canCreateEvaluation && (
                              <Tooltip><TooltipTrigger asChild><Button size="sm"
                                onClick={() => handleInputNotReviewed(item)} aria-label={`${t('eval.evaluate', 'Evaluate')} - ${item.supplier_name}`}
                              >
                                <Plus className="w-g13 h-g13" />
                                <span>{t('eval.evaluate', 'Evaluate')}</span>
                              </Button></TooltipTrigger><TooltipBody>{`${t('eval.input_eval')} - ${item.supplier_name}`}</TooltipBody></Tooltip>
                            )
                          ) : (
                            <ActionMenu
                              items={[
                                {
                                  label: t('eval.action_detail', 'Detail'),
                                  icon: <Award className="w-g13 h-g13" />,
                                  onClick: () => setViewingDetailItem(item),
                                },
                                canEditEvaluation && {
                                  label: t('eval.action_edit', 'Edit'),
                                  icon: <Edit2 className="w-g13 h-g13" />,
                                  onClick: () => handleOpenEditModal(item),
                                },
                                canDeleteEvaluation && {
                                  label: t('eval.action_delete', 'Hapus'),
                                  icon: <Trash2 className="w-g13 h-g13" />,
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


      {/* DETAIL MODAL: View Single Evaluation Report */}
      {viewingDetailItem && (
        <ModalFrame onClose={() => setViewingDetailItem(null)}>

            <DialogHeader className="flex items-center justify-between gap-g13 border-b border-border px-g21 py-g13">
              <div className="flex items-center gap-g8">
                <Building2 className="w-g21 h-g21 text-accent-foreground" />
                <div>
                  <DialogTitle className="flex items-center gap-g8">
                    {t('eval.detail_modal_title', 'Laporan Evaluasi Partner')}
                  </DialogTitle>
                  <Text size="xs" weight="medium" tone="muted">{viewingDetailItem.supplier_name}</Text>
                </div>
              </div>
              <Button variant="secondary" size="icon-md"
                type="button"
                onClick={() => setViewingDetailItem(null)}
                aria-label={t('common.close')}
              >
                <X className="w-g21 h-g21" />
              </Button>
            </DialogHeader>

            <div className="p-g21 sm:p-g21 overflow-y-auto space-y-g13 text-xs text-foreground flex-1">
              <Card className="grid grid-cols-2 gap-g13 p-g13">
                <div>
                  <Text as="span" size="xs" weight="bold" tone="muted" className="uppercase block">
                    {t('eval.col_id_date')} {t('eval.id', 'ID')}
                  </Text>
                  <span className="font-mono font-bold text-foreground">{viewingDetailItem.id}</span>
                </div>
                <div>
                  <Text as="span" size="xs" weight="bold" tone="muted" className="uppercase block">
                    {t('eval.review_date')}
                  </Text>
                  <span className="font-bold text-foreground">{formatBusinessDate(viewingDetailItem.review_date)}</span>
                </div>
              </Card>

              <Card variant="subtle" className="flex-row items-center justify-between p-g13">
                <div>
                  <Text as="span" size="xs" weight="bold" tone="primary" className="uppercase block">
                    {t('eval.col_calculated_score')}
                  </Text>
                  <Text as="span" size="xs" weight="semibold" tone="primary">{t('eval.auto_score_text')}</Text>
                </div>
                <div className="text-right">
                  <Text as="span" size="xl" weight="bold" tone="primary">
                    {viewingDetailItem.calculated_score !== undefined
                      ? viewingDetailItem.calculated_score
                      : computeScoreFromFields(
                          viewingDetailItem.obligation_target,
                          viewingDetailItem.incident_frequency,
                          viewingDetailItem.communication,
                          viewingDetailItem.pricing
                        )}
                  </Text>
                  <Text as="span" size="xs" weight="semibold" tone="primary"> / 100 {t('eval.points')}</Text>
                </div>
              </Card>

              <Card className="space-y-g8 p-g13 text-xs">
                <div className="flex justify-between pb-g5 border-b border-border">
                  <span className="text-muted-foreground font-medium">{t('eval.obligation_target_2', 'Obligation / Target')}</span>
                  <span className="font-bold text-foreground">
                    {viewingDetailItem.obligation_target}
                  </span>
                </div>
                <div className="flex justify-between pb-g5 border-b border-border">
                  <span className="text-muted-foreground font-medium">{t('audit_col_evalIncident', 'Incident Frequency')}</span>
                  <span className="font-bold text-foreground">
                    {viewingDetailItem.incident_frequency}
                  </span>
                </div>
                <div className="flex justify-between pb-g5 border-b border-border">
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

              <div className="pt-g8">
                <Text as="span" size="xs" weight="bold" tone="muted" className="uppercase block mb-g3">
                  {t('eval.rec_result')}
                </Text>
                <div className="font-bold">
                  {viewingDetailItem.final_evaluation === 'Recommended' && (
                    <Badge tone="info"><CheckCircle2 className="w-g13 h-g13 text-accent-foreground" /><span>{t('eval.status_rec')}</span></Badge>
                  )}
                  {viewingDetailItem.final_evaluation === 'Recommended with notes' && (
                    <Badge tone="warning"><AlertCircle aria-hidden="true" />{t('eval.status_rec_notes')}</Badge>
                  )}
                  {viewingDetailItem.final_evaluation === 'Not recommended' && (
                    <Badge tone="danger"><X aria-hidden="true" />{t('eval.status_not_rec')}</Badge>
                  )}
                </div>
              </div>

              {viewingDetailItem.notes && (
                <Card className="p-g13 bg-background">
                  <Text as="span" size="xs" weight="bold" tone="muted" className="uppercase block mb-g3">
                    {t('eval.notes_title')}
                  </Text>
                  <Text size="xs" className="whitespace-pre-wrap">
                    {viewingDetailItem.notes}
                  </Text>
                </Card>
              )}
            </div>

            <div className="p-g13 sm:p-g21 bg-background border-t border-border flex justify-end">
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
