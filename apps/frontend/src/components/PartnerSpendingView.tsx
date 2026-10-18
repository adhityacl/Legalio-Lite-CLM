import { TableViewMenu, TableViewOption } from './ui/table-view-menu';
import { BulkSelectionBar } from './ui/bulk-selection-bar';
import { deleteRecords } from '../lib/bulkDelete';
import { downloadCsv } from '../lib/csv';
import { AlphabeticalSelect } from './ui/alphabetical-select';
import { formatBusinessDate } from '../lib/displayDate';
import { FilterSummary } from './ui/filter-summary';
import { TableEmptyState } from './ui/table-empty-state';
import { ModalFrame } from './ui/modal-frame';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useTenantSettings } from '../context/TenantSettingsContext';
import { Partner, PartnerSpending } from '@legalio/types';
import {
  DollarSign,
  Plus,
  Search,
  Filter,
  Download,
  FolderOpen,
  FileText,
  FileCheck,
  FileDown,
  FileSpreadsheet,
  Building2,
  Calendar,
  CreditCard,
  Trash2,
  Edit,
  ExternalLink,
  X,
  Upload,
  Tag,
  PieChart as PieIcon,
  BarChart3,
  Layers,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Loader2,
  Lightbulb,
} from 'lucide-react';
import { ActionMenu } from './ui/action-menu';
import { TablePagination } from './ui/TablePagination';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useLanguage } from '../context/LanguageContext';
import { useConfirm } from '../context/ConfirmDialogContext';
import { useAlertToast } from '../context/AlertToastContext';
import { useAuth } from '../context/AuthContext';
import {
  canViewSpending,
  canEditSpending,
  canCreateContract,
  canDeletePartner,
} from '../lib/rbacScoping';
import { getCachedAccessToken } from '../lib/googleAuthService';
import { SUPPORTED_CURRENCIES, currencyMinorUnits, currencyLabel, formatMoney, getDefaultUsdRate, getHistoricalUsdRate, fetchHistoricalRate } from '@legalio/shared/currencyUtils';
import { formatInvoiceFileName, formatBillingFileName } from '@legalio/shared/fileNaming';
import { DateInput } from './DateInput';
import { usePermissions } from '../lib/permissions';
import { MonthInput } from './MonthInput';
import { Input } from '@legalio/ui-components/input';
import {
  parseMonthStr,
  parseAllMonths,
  formatMonthTagDisplay,
} from '@legalio/shared/monthUtils';

import {
  ALLOCATION_TOLERANCE, allocationInvoiceMonths, hydrateSpendingAllocations,
  parsedSpendingAllocations, splitSpendingEqually, validateSpendingAllocations,
  type SpendingAllocationInput,
} from '@legalio/shared/spendingAllocations';

import { TableColumnHeader, Table, TableHeader, TableRow, TableBody, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { Button } from '@legalio/ui-components/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Textarea } from '@legalio/ui-components/textarea';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { DialogBody, DialogCloseIcon, DialogFooter, DialogHeader, DialogTitle } from '@legalio/ui-components/dialog';
import { FormSection } from '@legalio/ui-components/blocks';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Checkbox, CheckboxControl, CheckboxHiddenInput } from '@legalio/ui-components/checkbox';

import { FileUpload, FileUploadDropzone, FileUploadDropzoneIcon, FileUploadHiddenInput, FileUploadTrigger } from '@legalio/ui-components/file-upload';
import { Text } from '@legalio/ui-components/text';
import { Fieldset } from '@legalio/ui-components/fieldset';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Spinner } from '@legalio/ui-components/spinner';
import { NumberInput, NumberInputControl, NumberInputDecrementTrigger, NumberInputIncrementTrigger, NumberInputInput } from '@legalio/ui-components/number-input';
// Re-export formatMonthTagDisplay for backwards compatibility with any external consumers
export { formatMonthTagDisplay };

interface PartnerSpendingViewProps {
  partners: Partner[];
  spendings: PartnerSpending[];
  onRefreshData: () => void;
  userEmail?: string;
  userName?: string;
  userRole?: string;
  openSpendingId?: string;
  onSpendingOpened?: () => void;
}

export const PartnerSpendingView: React.FC<PartnerSpendingViewProps> = ({
  partners,
  spendings = [],
  onRefreshData,
  userEmail,
  userName,
  userRole,
  openSpendingId,
  onSpendingOpened,
}) => {
  const { hasPermission } = usePermissions();
  const { t, language } = useLanguage();
  const confirmDialog = useConfirm();
  const showAlert = useAlertToast();
  const { user } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedYear, setSelectedYear] = useState<string>('ALL');
  const [selectedVendorFilter, setSelectedVendorFilter] = useState<string>('ALL');
  const [selectedMonthFilter, setSelectedMonthFilter] = useState<string>('ALL');

  const [showModal, setShowModal] = useState(false);

  const [editingSpending, setEditingSpending] = useState<PartnerSpending | null>(null);

  const [formVendorName, setFormVendorName] = useState('');
  const [formVendorId, setFormVendorId] = useState('');
  const [formInvoiceNumber, setFormInvoiceNumber] = useState('');
  const [formInvoiceDate, setFormInvoiceDate] = useState('');
  const [formInvoiceTitle, setFormInvoiceTitle] = useState('');
  const [monthAllocations, setMonthAllocations] = useState<SpendingAllocationInput[]>([]);
  const [formInvoiceDesc, setFormInvoiceDesc] = useState('');
  const tenantCurrency = useTenantSettings().policy.settings.defaultCurrency;
  const [formCurrency, setFormCurrency] = useState(tenantCurrency);
  const [formTotalAmount, setFormTotalAmount] = useState<number | ''>('');
  const [formBankName, setFormBankName] = useState('');
  const [formBankAccountNumber, setFormBankAccountNumber] = useState('');
  const [formBankAccountHolder, setFormBankAccountHolder] = useState('');
  const bankEdited = useRef({ name: false, number: false, holder: false });

  const [invoiceFileObj, setInvoiceFileObj] = useState<{ fileName: string; fileData: string; rawFile?: File } | null>(null);
  const [billingFileObj, setBillingFileObj] = useState<{ fileName: string; fileData: string; rawFile?: File } | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);
  // Remounting the uploads clears zag's accepted files so the same file can be picked again.
  const [uploadKey, setUploadKey] = useState(0);
  const errorRef = useRef<HTMLDivElement>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [parseSuccessMsg, setParseSuccessMsg] = useState<string | null>(null);

  const resetFormState = (item?: PartnerSpending | null) => {
    setEditingSpending(item || null);
    setFormVendorName(item?.vendor_name || '');
    setFormVendorId(item?.vendor_id || partners.find(p => p.partner_name === item?.vendor_name)?.partner_id || '');
    setFormInvoiceNumber(item?.invoice_number || '');
    setFormInvoiceDate(item?.invoice_date || '');
    setFormInvoiceTitle(item?.invoice_title || '');
    setMonthAllocations(hydrateSpendingAllocations(item));
    setFormInvoiceDesc(item?.invoice_description || '');
    setFormCurrency(item?.currency || tenantCurrency);
    setFormTotalAmount(item?.total_amount ?? '');
    bankEdited.current = { name: Boolean(item?.bank_name), number: Boolean(item?.bank_account_number), holder: Boolean(item?.bank_account_holder_name) };
    setFormBankName(item?.bank_name || '');
    setFormBankAccountNumber(item?.bank_account_number || '');
    setFormBankAccountHolder(item?.bank_account_holder_name || '');
    setInvoiceFileObj(null);
    setBillingFileObj(null);
    setUploadKey(key => key + 1);
    setErrorMessage('');
    setParseSuccessMsg(null);
  };

  const handleAddNew = () => {
    resetFormState(null);
    setShowModal(true);
  };

  const handleOpenEditModal = (item: any) => {
    resetFormState(item);
    setShowModal(true);
  };

  const handleDelete = (id: string) => {
    handleDeleteClick(id);
  };

  const handleVendorSelect = (name: string, id?: string) => {
    const partner = partners.find(p => id ? p.partner_id === id : p.partner_name === name);
    setFormVendorName(partner?.partner_name || name);
    setFormVendorId(partner?.partner_id || id || '');
    // Refresh bank autofill for the selected partner while preserving manual input.
    const previous = spendings.find(row => (partner && row.vendor_id === partner.partner_id) || row.vendor_name === name);
    if (!bankEdited.current.name) setFormBankName(previous?.bank_name || '');
    if (!bankEdited.current.number) setFormBankAccountNumber(previous?.bank_account_number || '');
    if (!bankEdited.current.holder) setFormBankAccountHolder(previous?.bank_account_holder_name || '');
  };

  const allocationError = validateSpendingAllocations(monthAllocations, formTotalAmount);
  const allocatedTotal = monthAllocations.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const remaining = Number(formTotalAmount || 0) - allocatedTotal;
  const allocationMessages = {
    total: t('spending.allocation_total_error', 'Enter a valid, non-negative invoice total.'),
    empty: t('spending.allocation_empty_error', 'Add at least one spending month.'),
    month: t('spending.allocation_month_error', 'Select a valid month in every row.'),
    duplicate: t('spending.allocation_duplicate_error', 'Each spending month must be unique.'),
    amount: t('spending.allocation_amount_error', 'Enter a non-negative allocated amount in every row.'),
    mismatch: remaining >= 0
      ? t('spending.allocation_remaining', 'Remaining to allocate: {amount}', { amount: formatMoney(remaining, formCurrency) })
      : t('spending.allocation_over', 'Over allocated by: {amount}', { amount: formatMoney(-remaining, formCurrency) }),
  };
  const allocationStatus = allocationError ? allocationMessages[allocationError]
    : t('spending.allocation_matches', 'Allocation matches invoice total');
  const formBusy = isParsing || isSubmitting || isReadingFile;
  const closeSpendingModal = () => { if (!formBusy) setShowModal(false); };

  useEffect(() => { if (errorMessage) errorRef.current?.focus(); }, [errorMessage]);

  const handleFileChange = (file: File | undefined, type: 'invoice' | 'billing') => {
    setUploadKey(key => key + 1);
    if (file) {
      if (file.size > 20 * 1024 * 1024) {
        setErrorMessage(t('spending.upload_size_error', 'Maximum file size is 20 MB.'));
        return;
      }
      setIsReadingFile(true);
      setErrorMessage('');
      if (type === 'invoice') setParseSuccessMsg(null);
      const reader = new FileReader();
      reader.onload = () => {
        const fileObj = { fileName: file.name, fileData: reader.result as string, rawFile: file };
        if (type === 'invoice') {
          setInvoiceFileObj(fileObj);
        } else {
          setBillingFileObj(fileObj);
        }
        setIsReadingFile(false);
      };
      reader.onerror = () => {
        setIsReadingFile(false);
        setErrorMessage(t('spending.upload_read_error', 'Could not read the file. Please choose it again.'));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleParseSpending = async () => {
    if (!invoiceFileObj || (!invoiceFileObj.fileData && !invoiceFileObj.rawFile)) {
      setErrorMessage('Silakan pilih dokumen Invoice terlebih dahulu untuk parsing.');
      return;
    }
    setIsParsing(true);
    setErrorMessage('');
    setParseSuccessMsg(null);
    try {
      let response: Response;
      if (invoiceFileObj.rawFile) {
        const formData = new FormData();
        formData.append('file', invoiceFileObj.rawFile);
        response = await fetch('/api/spendings/parse', {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await fetch('/api/spendings/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pdfBase64: invoiceFileObj.fileData }),
        });
      }
      const contentType = response.headers.get('content-type');
      let result;
      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        const text = await response.text();
        throw new Error(text && text.trim().startsWith('<') ? t('spending.koneksi_ai_server_timeout_atau_sibuk', 'Koneksi AI Server timeout atau sibuk. Silakan coba kembali beberapa saat lagi.') : (text || t('spending.gagal_mengekstrak_dokumen_invoice', 'Gagal mengekstrak dokumen invoice.')));
      }
      if (!response.ok) {
        throw new Error(result.error || t('spending.gagal_mengekstrak_dokumen_invoice', 'Gagal mengekstrak dokumen invoice.'));
      }
      if (result.success && result.data) {
        const p = result.data;
        if (p.invoice_number) setFormInvoiceNumber(p.invoice_number);
        if (p.invoice_date) {
          let formattedDate = p.invoice_date.trim();
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(formattedDate)) {
            const [d, m, y] = formattedDate.split('/');
            formattedDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
          }
          setFormInvoiceDate(formattedDate);

        }
        if (p.invoice_title) setFormInvoiceTitle(p.invoice_title);
        const parsedAllocations = parsedSpendingAllocations(p);
        setMonthAllocations(parsedAllocations || []);
        if (p.invoice_description) setFormInvoiceDesc(p.invoice_description);
        if (p.currency) {
          const upperCur = p.currency.toUpperCase().trim();
          if (SUPPORTED_CURRENCIES.some((c) => c.code === upperCur)) {
            setFormCurrency(upperCur);
          }
        }
        if (p.total_amount !== undefined && p.total_amount !== null && !isNaN(Number(p.total_amount))) {
          setFormTotalAmount(Number(p.total_amount));
        }
        if (p.bank_name) { bankEdited.current.name = true; setFormBankName(p.bank_name); }
        if (p.account_number) { bankEdited.current.number = true; setFormBankAccountNumber(p.account_number); }
        if (p.account_holder) {
          bankEdited.current.holder = true;
          setFormBankAccountHolder(p.account_holder);
          if (!formVendorName) {
            const rawH = p.account_holder.toLowerCase();
            const matchedP = partners.find((vendor) => {
              const vName = vendor.partner_name.toLowerCase();
              return vName.includes(rawH) || rawH.includes(vName);
            });
            if (matchedP) {
              setFormVendorName(matchedP.partner_name);
              setFormVendorId(matchedP.partner_id);
            }
          }
        }
        if (result.cached) {
          setParseSuccessMsg(t('spending.parse_cached', 'Invoice data filled from the cached extraction.'));
        } else {
          setParseSuccessMsg(t('spending.parse_success', 'Invoice data filled by AI. Review before saving.'));
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Terjadi kesalahan saat parsing invoice.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formBusy) return;
    setErrorMessage('');
    if (!formVendorName) {
      setErrorMessage('Vendor Name wajib dipilih.');
      return;
    }
    if (!formInvoiceNumber.trim()) {
      setErrorMessage('Invoice Number wajib diisi.');
      return;
    }
    if (formTotalAmount === '' || isNaN(Number(formTotalAmount))) {
      setErrorMessage('Total Amount wajib diisi.');
      return;
    }

    if (allocationError) {
      setErrorMessage(allocationStatus);
      return;
    }

    setIsSubmitting(true);
    try {
      const isEdit = Boolean(editingSpending && editingSpending.id);
      const url = isEdit ? `/api/partner-spendings/${editingSpending!.id}` : '/api/partner-spendings';
      const method = isEdit ? 'PUT' : 'POST';

      const payload = {
        vendor_id: formVendorId || undefined,
        vendor_name: formVendorName,
        invoice_number: formInvoiceNumber.trim(),
        invoice_date: formInvoiceDate,
        invoice_title: formInvoiceTitle.trim(),
        invoice_month: allocationInvoiceMonths(monthAllocations),
        month_allocations: monthAllocations,
        invoice_description: formInvoiceDesc.trim(),
        currency: formCurrency,
        total_amount: Number(formTotalAmount),
        total_amount_usd: estimatedUsd,
        bank_name: formBankName.trim(),
        bank_account_number: formBankAccountNumber.trim(),
        bank_account_holder_name: formBankAccountHolder.trim(),
        invoice_file: invoiceFileObj || undefined,
        billing_file: billingFileObj || undefined,
        userEmail,
        userName,
        userRole,
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(allocationMessages[data.allocation_error as keyof typeof allocationMessages] || data.error || t('spending.terjadi_kesalahan_saat_menyimpan_data_spending', 'Terjadi kesalahan saat menyimpan data spending.'));
      }

      onRefreshData();
      setShowModal(false);
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal menyimpan data spending.');
    } finally {
      setIsSubmitting(false);
    }
  };
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({ USD: 1 });
  const [historicalRate, setHistoricalRate] = useState<number>(() => getDefaultUsdRate(tenantCurrency));

  useEffect(() => {
    let isMounted = true;
    if (formCurrency === 'USD') {
      setHistoricalRate(1);
      return;
    }
    fetchHistoricalRate(formCurrency, formInvoiceDate).then((res) => {
      if (isMounted && res.rate) {
        setHistoricalRate(res.rate);
      }
    });
    return () => { isMounted = false; };
  }, [formCurrency, formInvoiceDate]);

  const estimatedUsd = formCurrency === 'USD'
    ? Number(formTotalAmount || 0)
    : Math.round(Number(formTotalAmount || 0) * historicalRate * 100) / 100;

  useEffect(() => {
    const fetchRates = async () => {
      try {
        const token = getCachedAccessToken();
        const headers: Record<string, string> = {};
        if (token) headers['x-google-access-token'] = token;
        const res = await fetch('/api/exchange-rates', { headers, cache: 'no-store' });
        if (res.ok) {
           const data = await res.json();
           setExchangeRates(data);
        }
      } catch (err) {
        console.error("Failed to fetch exchange rates:", err);
      }
    };
    fetchRates();
  }, []);

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    spendings.forEach((s) => {
      let hasMonthYear = false;
      if (s.invoice_month && s.invoice_month.length > 0) {
        s.invoice_month.forEach((m) => {
          const parsedList = parseAllMonths(m);
          parsedList.forEach((p) => {
            if (p.year) {
              years.add(p.year);
              hasMonthYear = true;
            }
          });
        });
      }
      if (!hasMonthYear && s.invoice_date && s.invoice_date.length >= 4) {
        const y = s.invoice_date.startsWith('20') ? s.invoice_date.slice(0, 4) : s.invoice_date.slice(-4);
        if (/^\d{4}$/.test(y)) years.add(y);
      }
    });
    if (years.size === 0) years.add(new Date().getFullYear().toString());
    return Array.from(years).sort().reverse();
  }, [spendings]);

  const filteredSpendings = useMemo(() => {
    return spendings.filter((s) => {
      // 1. Department Scoping & RBAC restriction (based on internal PIC of partner)
      if (!canViewSpending(s, partners, user)) {
        return false;
      }

      const matchSearch =
        (s.id && s.id.toLowerCase().includes(searchTerm.toLowerCase())) ||
        s.invoice_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.vendor_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (s.invoice_description && s.invoice_description.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (s.bank_name && s.bank_name.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchVendor =
        selectedVendorFilter === 'ALL' || s.vendor_name.toLowerCase() === selectedVendorFilter.toLowerCase();

      // Collect all parsed month info for this spending record
      const parsedMonths: ReturnType<typeof parseAllMonths> = [];
      if (s.invoice_month && s.invoice_month.length > 0) {
        s.invoice_month.forEach((m) => {
          const parsedList = parseAllMonths(m);
          parsedList.forEach((p) => parsedMonths.push(p));
        });
      } else if (s.invoice_date) {
        const parsed = parseMonthStr(s.invoice_date);
        if (parsed) parsedMonths.push(parsed);
      }

      let matchYear = true;
      if (selectedYear !== 'ALL') {
        const itemYears = new Set<string>();
        parsedMonths.forEach((p) => itemYears.add(p.year));
        if (s.invoice_date && s.invoice_date.length >= 4) {
          const y = s.invoice_date.startsWith('20') ? s.invoice_date.slice(0, 4) : s.invoice_date.slice(-4);
          if (/^\d{4}$/.test(y)) itemYears.add(y);
        }
        matchYear = itemYears.has(selectedYear);
      }

      let matchMonth = true;
      if (selectedMonthFilter !== 'ALL') {
        const itemMonths = new Set<string>();
        parsedMonths.forEach((p) => {
          if (selectedYear === 'ALL' || p.year === selectedYear) {
            itemMonths.add(p.month);
            itemMonths.add(p.monthShort);
          }
        });
        matchMonth = itemMonths.has(selectedMonthFilter);
      }

      return matchSearch && matchVendor && matchYear && matchMonth;
    });
  }, [spendings, partners, user, searchTerm, selectedVendorFilter, selectedYear, selectedMonthFilter]);

  type SortField = 'invoice_no' | 'vendor' | 'invoice_month' | 'amount' | 'invoice_date' | 'attachment';
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

  const sortedSpendings = useMemo(() => {
    if (!sortField) return filteredSpendings;
    return [...filteredSpendings].sort((a, b) => {
      let comparison = 0;
      if (sortField === 'invoice_no') {
        comparison = (a.invoice_number || '').localeCompare(b.invoice_number || '', undefined, { numeric: true, sensitivity: 'base' });
      } else if (sortField === 'vendor') {
        comparison = (a.vendor_name || '').localeCompare(b.vendor_name || '', undefined, { sensitivity: 'base' });
      } else if (sortField === 'invoice_month') {
        const getEarliestMonthDate = (item: PartnerSpending) => {
          if (item.invoice_month && item.invoice_month.length > 0) {
            const dates = item.invoice_month
              .flatMap((m) => parseAllMonths(m).map((p) => p.endOfMonthDate))
              .filter(Boolean)
              .sort();
            if (dates.length > 0) return dates[0];
          }
          return item.invoice_date || '';
        };
        const dateA = getEarliestMonthDate(a);
        const dateB = getEarliestMonthDate(b);
        comparison = dateA.localeCompare(dateB);
      } else if (sortField === 'invoice_date') {
        const dateA = a.invoice_date || '';
        const dateB = b.invoice_date || '';
        comparison = dateA.localeCompare(dateB);
      } else if (sortField === 'amount') {
        const amtA = Number(a.total_amount_usd !== undefined && a.total_amount_usd !== null ? a.total_amount_usd : a.total_amount || 0);
        const amtB = Number(b.total_amount_usd !== undefined && b.total_amount_usd !== null ? b.total_amount_usd : b.total_amount || 0);
        comparison = amtA - amtB;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [filteredSpendings, sortField, sortOrder]);

  const handleDeleteClick = async (id: string) => {
    const ok = await confirmDialog({ description: t('spending.hapus_data_spending_ini', 'Hapus data spending ini?'), tone: 'danger', confirmLabel: t('io.action_delete', 'Hapus') });
    if (!ok) return;
    try {
      const res = await fetch(`/api/partner-spendings/${id}?userEmail=${encodeURIComponent(userEmail || '')}&userName=${encodeURIComponent(userName || '')}&userRole=${encodeURIComponent(userRole || '')}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(t('spending.gagal_menghapus', 'Gagal menghapus'));
      onRefreshData();
    } catch (e) {
      showAlert({ title: t('spending.gagal_menghapus_data_spending', 'Gagal menghapus data spending'), description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleBulkDelete = async (ids: string[]) => {
    const targets = ids.filter(Boolean);
    if (targets.length === 0) return;
    const ok = await confirmDialog({
      description: t('bulk.confirm_delete', 'Hapus {count} {noun} terpilih? Tindakan ini tidak dapat dibatalkan.', { count: targets.length, noun: t('bulk.noun_spending', 'spending') }),
      tone: 'danger',
      confirmLabel: t('io.action_delete', 'Hapus'),
    });
    if (!ok) return;
    const failed = await deleteRecords('/api/partner-spendings', targets, { userEmail, userName, userRole });
    onRefreshData();
    if (failed.length > 0) {
      showAlert({ title: t('bulk.delete_failed_title', 'Sebagian gagal dihapus'), description: t('bulk.delete_failed_message', '{failed} dari {total} gagal dihapus.', { failed: failed.length, total: targets.length }), variant: 'destructive' });
    }
  };


  const handleExportCSV = () => {
    const headers = [
      'Partner',
      'No. Invoice',
      'Tanggal Invoice',
      'Bulan Invoice (Periode)',
      'Deskripsi Invoice',
      'Currency',
      'Total Amount',
      'Total Amount (USD)',
      'Status Pembayaran',
      'Rekening Bank',
      'Nama Bank',
      'Nama Pemilik Rekening',
      'Link File Invoice',
      'Link File Billing'
    ];

    const rows = sortedSpendings.map(c => [
      c.vendor_name || '-',
      c.invoice_number || '-',
      c.invoice_date || '-',
      (c.invoice_month || []).map((m) => formatMonthTagDisplay(m, language)).join('; '),
      c.invoice_description || '-',
      c.currency || '-',
      c.total_amount || 0,
      c.total_amount_usd || 0,
      c.payment_status || '-',
      c.bank_account_number || '-',
      c.bank_name || '-',
      c.bank_account_holder_name || '-',
      c.invoice_file_url || '-',
      c.billing_file_url || '-'
    ]);

    downloadCsv('partner_spending_export.csv', headers, rows);
  };

  const renderSortHeader = (label: string, field: SortField) => (
    <TableColumnHeader
      scope="col"
      aria-sort={sortField === field ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
     data-numeric={field === 'amount'}>
      <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" className="-ms-g13 font-semibold text-muted-foreground"
        type="button"
        onClick={() => handleSort(field)}
      >
        <span>{label}</span>
        {sortField === field ? (
          sortOrder === 'asc' ? (
            <ArrowUp className="w-g13 h-g13 text-accent-foreground shrink-0" />
          ) : (
            <ArrowDown className="w-g13 h-g13 text-accent-foreground shrink-0" />
          )
        ) : (
          <ArrowUpDown className="w-g13 h-g13 text-muted-foreground shrink-0" />
        )}
      </Button></TooltipTrigger><TooltipBody>{t('spending.urutkan_berdasarkan', 'Urutkan berdasarkan {label}', { label })}</TooltipBody></Tooltip>
    </TableColumnHeader>
  );

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(5);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  useEffect(() => {
    if (!openSpendingId) return;
    const spending = spendings.find(item => item.id === openSpendingId);
    if (spending && hasPermission('document.view') && canViewSpending(spending, partners, user)) {
      setSearchTerm(spending.invoice_number || spending.vendor_name);
      setSelectedVendorFilter(spending.vendor_name);
      setSelectedYear('ALL');
      setSelectedMonthFilter('ALL');
      setCurrentPage(1);
    }
    onSpendingOpened?.();
  }, [openSpendingId, spendings, partners, user, hasPermission, onSpendingOpened]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) setSelectedRows(sortedSpendings.map(item => item.id || ''));
    else setSelectedRows([]);
  };

  const handleSelectRow = (id: string) => {
    setSelectedRows(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]);
  };

  const totalPages = Math.ceil(sortedSpendings.length / rowsPerPage);
  const indexOfLast = currentPage * rowsPerPage;
  const indexOfFirst = indexOfLast - rowsPerPage;
  const currentSpendings = sortedSpendings.slice(indexOfFirst, indexOfLast);

  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    invoice_no: true,
    vendor: true,
    invoice_month: true,
    invoice_date: true,
    amount: true,
    invoice_doc: true,
    billing_doc: true,
  });
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

  const toggleColumnVisibility = (id: string) => {
    setVisibleColumns((prev) => ({ ...prev, [id]: !prev[id] }));
  };


  return (
    <div className="space-y-g21">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-g13">
        <div>
          <Heading as="h2" size="md" weight="semibold">
            <span>{t('spending.partner_spending_invoicing', 'Partner Spending / Invoicing')}</span>
          </Heading>
        </div>

        <div className="flex items-center gap-g8 shrink-0 flex-wrap">
          {hasPermission('export.csv') && (
            <Tooltip><TooltipTrigger asChild><Button variant="outline"
              onClick={handleExportCSV}
              disabled={sortedSpendings.length === 0} aria-label={t('contracts.export_csv', 'Ekspor CSV')}
            >
              <Download className="w-g16 h-g16" />
              <span>{t('contracts.export_csv', 'Ekspor CSV')}</span>
            </Button></TooltipTrigger><TooltipBody>{t('contracts.export_csv', 'Ekspor CSV')}</TooltipBody></Tooltip>
          )}

          {canCreateContract(user) && (
            <Button
              onClick={handleAddNew}
            >
              <Plus className="w-g16 h-g16" />
              <span>{t('ui.add_spending')}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Filter Bar with 3 Dropdowns */}
      {/* Search & Filter Bar - Justified Responsive Grid/Flex */}
      <Card className="p-g13">
        <div className="flex w-full flex-wrap items-center gap-g13">
          {/* 1 Box Search */}
          <InputGroup className="relative flex-1 min-w-g233 sm:min-w-g233">
            <InputGroupAddon><Search className="size-g16" aria-hidden="true" /></InputGroupAddon>
            <InputGroupInput
              type="text"
              placeholder={t('spending.search_placeholder', 'Cari invoice, partner, deskripsi...')}
              aria-label={t('ui.search')}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
            />
          </InputGroup>

          {/* Filter 1: Tahun */}
          <NativeSelect
            aria-label={t('ui.filter_year')}
              value={selectedYear}
            onChange={(e) => {
              setSelectedYear(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
          >
            <option value="ALL">{t('dashboard.all_years', 'Semua Tahun')}</option>
            {availableYears.map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </NativeSelect>

          {/* Filter 2: Partner */}
          <AlphabeticalSelect
            aria-label={t('ui.filter_partner')}
              value={selectedVendorFilter}
            onChange={(e) => {
              setSelectedVendorFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
          >
            <option value="ALL">{t('spending.all_vendors', 'Semua Partner')}</option>
            {Array.from(new Set(spendings.map(s => s.vendor_name).filter(Boolean))).sort().map(vendor => (
              <option key={vendor} value={vendor}>{vendor}</option>
            ))}
          </AlphabeticalSelect>

          {/* Filter 3: Periode Bulan */}
          <NativeSelect
            aria-label={t('ui.filter_month')}
              value={selectedMonthFilter}
            onChange={(e) => {
              setSelectedMonthFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full" controlProps={{ className: "flex-1 min-w-g144" }}
          >
            <option value="ALL">{t('spending.semua_bulan', 'Semua Bulan')}</option>
            <option value="01">{t('spending.januari_01', 'Januari (01)')}</option>
            <option value="02">{t('spending.februari_02', 'Februari (02)')}</option>
            <option value="03">{t('spending.maret_03', 'Maret (03)')}</option>
            <option value="04">{t('spending.april_04', 'April (04)')}</option>
            <option value="05">{t('spending.mei_05', 'Mei (05)')}</option>
            <option value="06">{t('spending.juni_06', 'Juni (06)')}</option>
            <option value="07">{t('spending.juli_07', 'Juli (07)')}</option>
            <option value="08">{t('spending.agustus_08', 'Agustus (08)')}</option>
            <option value="09">{t('spending.september_09', 'September (09)')}</option>
            <option value="10">{t('spending.oktober_10', 'Oktober (10)')}</option>
            <option value="11">{t('spending.november_11', 'November (11)')}</option>
            <option value="12">{t('spending.desember_12', 'Desember (12)')}</option>
          </NativeSelect>

          {/* Column Toggle */}
          <TableViewMenu title={t('io.view_settings', 'Pengaturan Tampilan Kolom')} label={t('io.view', 'View')}>
            {Object.keys(visibleColumns).map((col) => {
              let label = col;
              if (col === 'invoice_no') label = t('spending.col_invoice_no', 'No. Invoice');
              else if (col === 'vendor') label = t('spending.col_vendor', 'Partner');
              else if (col === 'invoice_month') label = t('spending.col_month', 'Periode Bulan');
              else if (col === 'invoice_date') label = t('spending.col_date', 'Tanggal Invoice');
              else if (col === 'amount') label = t('spending.col_amount', 'Total Nilai');
              else if (col === 'invoice_doc') label = t('spending.col_invoice_doc', 'Invoice');
              else if (col === 'billing_doc') label = t('spending.col_billing_doc', 'Billing');

              return (
                <TableViewOption key={col} value={col} checked={visibleColumns[col]} onToggle={() => toggleColumnVisibility(col)}>{label}</TableViewOption>
              );
            })}
          </TableViewMenu>
        </div>
      </Card>

      {/* Table */}
      {canDeletePartner(user) && (
        <BulkSelectionBar
          count={selectedRows.length}
          noun={t('bulk.noun_spending', 'spending')}
          onDelete={async () => { await handleBulkDelete(selectedRows); setSelectedRows([]); }}
        />
      )}
      <Card className="overflow-hidden">
        <FilterSummary filters={[{ label: t('ui.search'), value: searchTerm, active: Boolean(searchTerm) }, { label: t('ui.filter_year'), value: selectedYear, active: selectedYear !== 'ALL' }, { label: t('ui.filter_partner'), value: selectedVendorFilter, active: selectedVendorFilter !== 'ALL' }, { label: t('ui.filter_month'), value: selectedMonthFilter, active: selectedMonthFilter !== 'ALL' }]} onReset={() => { setSearchTerm(''); setSelectedYear('ALL'); setSelectedVendorFilter('ALL'); setSelectedMonthFilter('ALL'); }} />
        <Text size="xs" tone="muted" className="px-g13 py-g8 md:hidden">{t('ui.scroll_table')}</Text>
        <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.scroll_table')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableColumnHeader scope="col" className="w-g42">
                  <div className="flex items-center justify-start">
                    <Checkbox aria-label={t('spending.pilih_semua_spending', 'Pilih semua spending')} checked={selectedRows.length > 0 && selectedRows.length === currentSpendings.length} onCheckedChange={(details) => handleSelectAll(details.checked === true)}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                  </div>
                </TableColumnHeader>
                {visibleColumns.invoice_no && renderSortHeader(t('spending.col_invoice_no', 'No. Invoice'), 'invoice_no')}
                {visibleColumns.vendor && renderSortHeader(t('spending.col_vendor', 'Partner'), 'vendor')}
                {visibleColumns.invoice_month && renderSortHeader(t('spending.col_month', 'Periode Bulan'), 'invoice_month')}
                {visibleColumns.invoice_date && renderSortHeader(t('spending.col_date', 'Tanggal Invoice'), 'invoice_date')}
                {visibleColumns.amount && renderSortHeader(t('spending.col_amount', 'Total Nilai'), 'amount')}
                {visibleColumns.invoice_doc && (
                  <TableColumnHeader scope="col">
                    <span>{t('spending.col_invoice_doc', 'Invoice')}</span>
                  </TableColumnHeader>
                )}
                {visibleColumns.billing_doc && (
                  <TableColumnHeader scope="col">
                    <span>{t('spending.col_billing_doc', 'Billing')}</span>
                  </TableColumnHeader>
                )}
                <TableColumnHeader data-actions="true" scope="col" className="text-right w-g89">
                  <div className="flex items-center justify-end">{t('spending.col_action', 'Aksi')}</div>
                </TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedSpendings.length === 0 ? (
                <TableEmptyState colSpan={Object.values(visibleColumns).filter(Boolean).length + 2} />
              ) : (
                currentSpendings.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="flex items-center justify-start">
                        <Checkbox aria-label={t('spending.pilih_spending', 'Pilih spending {value}', { value: s.invoice_number || s.vendor_name || '' })} checked={selectedRows.includes(s.id || '')} onCheckedChange={() => handleSelectRow(s.id || '')}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                      </div>
                    </TableCell>

                    {/* 1. No. Invoice */}
                    {visibleColumns.invoice_no && (
                      <TableCell className="whitespace-nowrap">
                        {s.invoice_number}
                      </TableCell>
                    )}

                    {/* 2. Partner */}
                    {visibleColumns.vendor && (
                      <TableCell className="whitespace-nowrap">
                        {s.vendor_name}
                      </TableCell>
                    )}

                    {/* 3. Invoice Month */}
                    {visibleColumns.invoice_month && (
                      <TableCell className="whitespace-nowrap">
                        {s.invoice_month && s.invoice_month.length > 0
                          ? s.invoice_month.map((m) => formatMonthTagDisplay(m, language)).join(', ')
                          : '-'}
                      </TableCell>
                    )}

                    {/* 4. Invoice Date */}
                    {visibleColumns.invoice_date && (
                      <TableCell className="whitespace-nowrap">
                        {formatBusinessDate(s.invoice_date)}
                      </TableCell>
                    )}

                    {/* 5. Amount */}
                    {visibleColumns.amount && (
                      <TableCell className="text-right whitespace-nowrap tabular-nums">
                        {formatMoney(s.total_amount, s.currency)}
                      </TableCell>
                    )}

                    {/* 6. Invoice Doc */}
                    {visibleColumns.invoice_doc && (
                      <TableCell className="whitespace-nowrap">
                        {s.invoice_file_url ? (
                          <Button asChild variant="link"><a href={s.invoice_file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            
                          >
                            <FileDown className="w-g13 h-g13" /> {t('spending.pdf', 'PDF')}
                          </a></Button>
                        ) : (
                          <span className="text-primary-foreground">—</span>
                        )}
                      </TableCell>
                    )}

                    {/* 7. Billing Doc */}
                    {visibleColumns.billing_doc && (
                      <TableCell className="whitespace-nowrap">
                        {s.billing_file_url ? (
                          <Button asChild variant="link"><a href={s.billing_file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            
                          >
                            <FileSpreadsheet className="w-g13 h-g13" /> {t('spending.sheet', 'Sheet')}
                          </a></Button>
                        ) : (
                          <span className="text-primary-foreground">—</span>
                        )}
                      </TableCell>
                    )}

                    {/* Actions */}
                    <TableCell data-actions="true" className="text-right w-g89">
                      <div className="flex items-center justify-end">
                        <ActionMenu
                          items={[
                            ...(canEditSpending(s, partners, user)
                              ? [
                                  {
                                    label: t('hierarchy.edit_btn', 'Edit'),
                                    icon: <Edit className="w-g13 h-g13" />,
                                    onClick: () => handleOpenEditModal(s),
                                  },
                                ]
                              : []),
                            ...(canDeletePartner(user)
                              ? [
                                  {
                                    label: t('io.action_delete', 'Hapus'),
                                    icon: <Trash2 className="w-g13 h-g13" />,
                                    onClick: () => handleDelete(s.id || ''),
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
                ))
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

      {/* 3. INPUT FORM MODAL */}
      {showModal && (
    <ModalFrame size="form" onClose={closeSpendingModal}>
            {/* Modal Header */}
            <DialogHeader className="flex items-center justify-between gap-g13 border-b border-border px-g21 py-g13">
              <DialogTitle className="flex items-center gap-g8">
                <CreditCard className="size-g21 text-muted-foreground" aria-hidden="true" />
                <span>{editingSpending ? t('spending.modal_edit_title', 'Edit Data Spending') : t('spending.form_title', 'Input Data Spending')}</span>
              </DialogTitle>
              <DialogCloseIcon aria-label={t('common.close', 'Close')} disabled={formBusy} />
            </DialogHeader>

            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden min-h-0">
              <DialogBody className="mt-0 flex flex-1 flex-col gap-g13 overflow-y-auto px-g21 py-g13 text-foreground">
                {errorMessage && <Alert status="error" ref={errorRef} tabIndex={-1} role="alert"><AlertIndicator /><AlertContent><AlertDescription>{errorMessage}</AlertDescription></AlertContent></Alert>}
                {parseSuccessMsg && <Alert status="success" role="status"><AlertIndicator /><AlertContent><AlertDescription>{parseSuccessMsg}</AlertDescription></AlertContent></Alert>}
                <Fieldset disabled={formBusy} className="flex min-w-0 flex-col gap-g13">
                  <FormSection step={1} title={t('spending.partner_details', 'Partner Details')}>
                    <div className="grid grid-cols-1 gap-g13 sm:grid-cols-2">
                      <Field className="min-w-0">
                        <FieldLabel htmlFor="spending-partner">{t('spending.partner_name', 'Partner Name')} <span className="text-status-danger">*</span></FieldLabel>
                        <AlphabeticalSelect id="spending-partner" required value={formVendorId || formVendorName} onChange={e => {
                          const partner = partners.find(p => p.partner_id === e.target.value);
                          handleVendorSelect(partner?.partner_name || e.target.value, partner?.partner_id);
                        }}>
                          <option value="">{t('spending.vendor_select_ph', '-- Pilih Partner / Vendor --')}</option>
                          {partners.map(p => <option key={p.partner_id} value={p.partner_id}>{p.partner_name} ({p.partner_id})</option>)}
                          {formVendorName && !partners.some(p => p.partner_id === formVendorId || p.partner_name === formVendorName) && <option value={formVendorId || formVendorName}>{formVendorName}</option>}
                        </AlphabeticalSelect>
                      </Field>
                      <Field className="min-w-0">
                        <FieldLabel htmlFor="spending-bank-name">{t('spending.bank_name_label', 'Bank Name')}</FieldLabel>
                        <Input id="spending-bank-name" value={formBankName} onChange={e => { bankEdited.current.name = true; setFormBankName(e.target.value); }} />
                      </Field>
                      <Field className="min-w-0">
                        <FieldLabel htmlFor="spending-invoice-number">{t('spending.invoice_no_label', 'Invoice Number')} <span className="text-status-danger">*</span></FieldLabel>
                        <Input id="spending-invoice-number" required value={formInvoiceNumber} onChange={e => setFormInvoiceNumber(e.target.value)} placeholder={t('spending.invoice_no_example', 'e.g., INV-2026-0801')} />
                        {formInvoiceNumber.trim() && spendings.some(s => s.invoice_number.toLowerCase() === formInvoiceNumber.trim().toLowerCase() && s.id !== editingSpending?.id) && <Text size="xs" className="text-status-warning flex gap-g3"><Lightbulb className="size-g13 shrink-0" aria-hidden="true" />{t('spending.nomor_invoice_ini_sudah_dicatat_sebelumnya', 'Nomor invoice ini sudah dicatat sebelumnya. Diizinkan menginput nomor invoice sama untuk bulan/amount berbeda.')}</Text>}
                      </Field>
                      <Field className="min-w-0">
                        <FieldLabel htmlFor="spending-account-number">{t('spending.bank_account_no_label', 'Account Number')}</FieldLabel>
                        <Input id="spending-account-number" value={formBankAccountNumber} onChange={e => { bankEdited.current.number = true; setFormBankAccountNumber(e.target.value); }} />
                      </Field>
                      <Field className="min-w-0">
                        <FieldLabel htmlFor="spending-invoice-title">{t('spending.invoice_title_label', 'Invoice Title')}</FieldLabel>
                        <Input id="spending-invoice-title" value={formInvoiceTitle} onChange={e => setFormInvoiceTitle(e.target.value)} placeholder={t('spending.invoice_title_ph', 'e.g. Q4 Social Media Retainer')} />
                      </Field>
                      <Field className="min-w-0">
                        <FieldLabel htmlFor="spending-account-holder">{t('spending.bank_account_holder_label', 'Account Holder')}</FieldLabel>
                        <Input id="spending-account-holder" value={formBankAccountHolder} onChange={e => { bankEdited.current.holder = true; setFormBankAccountHolder(e.target.value); }} />
                      </Field>
                    </div>
                  </FormSection>

                  <FormSection step={2} title={t('spending.invoice_details', 'Invoice Details')}>
                    <div className="grid grid-cols-1 gap-g13 sm:grid-cols-2">
                      <Field className="min-w-0">
                        <FieldLabel htmlFor="spending-invoice-date">{t('spending.invoice_date_label', 'Invoice Date')}</FieldLabel>
                        <DateInput id="spending-invoice-date" value={formInvoiceDate} onChange={setFormInvoiceDate} focusColor="emerald" />
                      </Field>
                      <Field className="min-w-0">
                        <FieldLabel htmlFor="spending-currency">{t('spending.currency_label', 'Currency')}</FieldLabel>
                        <AlphabeticalSelect id="spending-currency" value={formCurrency} onChange={e => setFormCurrency(e.target.value)}>
                          {SUPPORTED_CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} — {currencyLabel(c.code, language)}</option>)}
                        </AlphabeticalSelect>
                      </Field>
                      <Field className="min-w-0">
                        <FieldLabel htmlFor="spending-total">{t('spending.total_amount_label', 'Total Amount')} <span className="text-status-danger">*</span></FieldLabel>
                        <NumberInput className="w-full" ids={{ input: "spending-total" }} required min={0} value={String(formTotalAmount ?? '')} onValueChange={details => setFormTotalAmount(details.value === '' ? '' : Number(details.value))}><NumberInputControl><NumberInputDecrementTrigger /><NumberInputInput className="text-right" /><NumberInputIncrementTrigger /></NumberInputControl></NumberInput>
                      </Field>
                      <div className="flex min-w-0 items-end" aria-live="polite">
                        <Text size="sm" tone="muted" className="flex h-control-md items-center" title={formCurrency === 'USD' ? undefined : t('spending.1_usd', '1 {formCurrency} ≈ {value} USD', { formCurrency, value: historicalRate.toFixed(8) })}>{t('spending.usd_estimate', 'Estimated USD Conversion')} {formatMoney(estimatedUsd, 'USD')}</Text>
                      </div>
                    </div>
                    <section aria-label={t('spending.allocation_title', 'Spending Month Allocation')} aria-describedby="spending-allocation-status" className="flex flex-col">
                      <div className="flex flex-wrap items-center justify-between gap-g8 border-y border-border px-g13 py-g8">
                        <Text as="span" size="sm" weight="medium" tone="muted">{t('spending.spending_month', 'Spending Month')}</Text>
                        <div className="flex flex-wrap gap-g8">
                          <Button variant="outline" type="button" disabled={!monthAllocations.length || formTotalAmount === '' || Number(formTotalAmount) < 0} onClick={() => setMonthAllocations(rows => splitSpendingEqually(rows, Number(formTotalAmount), currencyMinorUnits(formCurrency)))}>{t('spending.split_equally', 'Split Equally')}</Button>
                          <Button variant="outline" type="button" onClick={() => setMonthAllocations(rows => [...rows, { month: '', amount: '' }])}><Plus className="size-g16" aria-hidden="true" />{t('spending.add_month', 'Add Month')}</Button>
                        </div>
                      </div>
                      <div className="divide-y divide-border">
                        {monthAllocations.map((row, index) => {
                          const duplicate = Boolean(row.month && monthAllocations.some((other, otherIndex) => index !== otherIndex && other.month === row.month));
                          return <div key={index} className="grid grid-cols-[minmax(0,1fr)_var(--spacing-g34)] sm:grid-cols-[minmax(0,1fr)_var(--spacing-g34)_minmax(0,1fr)] gap-g13 p-g13 items-end">
                            <Field className="min-w-0">
                              <FieldLabel htmlFor={`spending-month-${index}`}>{t('spending.spending_month', 'Spending Month')} {index + 1}</FieldLabel>
                              <MonthInput id={`spending-month-${index}`} required min="1900-01" max="2100-12" value={row.month} invalid={duplicate || !row.month} aria-describedby="spending-allocation-status" onChange={month => setMonthAllocations(rows => rows.map((item, i) => i === index ? { ...item, month } : item))} />
                            </Field>
                            <Button variant="ghost" size="icon-md" type="button" aria-label={t('spending.delete_month', 'Delete spending month {index}', { index: index + 1 })} onClick={() => setMonthAllocations(rows => rows.filter((_, i) => i !== index))} className="col-start-2 row-start-1"><Trash2 className="size-g16 mx-auto" aria-hidden="true" /></Button>
                            <Field className="min-w-0 col-span-2 sm:col-span-1">
                              <FieldLabel htmlFor={`spending-amount-${index}`}>{t('spending.allocated_amount', 'Allocated Amount')} {index + 1} ({formCurrency})</FieldLabel>
                              <NumberInput className="w-full" ids={{ input: `spending-amount-${index}` }} min={0} required value={String(row.amount ?? '')} invalid={row.amount === '' || Number(row.amount) < 0} onValueChange={details => setMonthAllocations(rows => rows.map((item, i) => i === index ? { ...item, amount: details.value === '' ? '' : Number(details.value) } : item))}><NumberInputControl><NumberInputDecrementTrigger /><NumberInputInput aria-describedby="spending-allocation-status" className="text-right" /><NumberInputIncrementTrigger /></NumberInputControl></NumberInput>
                            </Field>
                          </div>;
                        })}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-g8 border-t border-border px-g13 pt-g13">
                        <p id="spending-allocation-status" role="status" className={`text-sm font-medium ${!allocationError ? 'text-status-success' : remaining < -ALLOCATION_TOLERANCE ? 'text-status-danger' : 'text-status-warning'}`}>{allocationStatus}</p>
                        <Text as="span" size="sm" tone="muted">{t('spending.allocated_total', 'Allocated: {amount}', { amount: formatMoney(allocatedTotal, formCurrency) })}</Text>
                      </div>
                    </section>
                  </FormSection>

                  <FormSection step={3} title={t('spending.descriptions_title', 'Descriptions')}>
                    <Field>
                      <FieldLabel htmlFor="spending-description">{t('spending.invoice_desc_label', 'Invoice Description')}</FieldLabel>
                      <Textarea id="spending-description" rows={3} value={formInvoiceDesc} onChange={e => setFormInvoiceDesc(e.target.value)} placeholder={t('spending.description_ph', 'Spending description...')} />
                    </Field>
                  </FormSection>

                  <FormSection step={4} title={t('spending.documents_title', 'Documents')}>
                    <div className="grid grid-cols-1 gap-g13">
                      {([
                        ['billing', t('spending.upload_billing_label', 'Upload Billing'), t('spending.billing_dropzone', 'Billing drop zone'), billingFileObj, editingSpending?.billing_file_url, editingSpending?.billing_file_name || t('spending.existing_billing', 'View existing billing')],
                        ['invoice', t('spending.upload_invoice_label', 'Upload Invoice'), t('spending.invoice_dropzone', 'Invoice drop zone'), invoiceFileObj, editingSpending?.invoice_file_url, editingSpending?.invoice_file_name || t('spending.existing_invoice', 'View existing invoice')],
                      ] as const).map(([kind, label, zoneLabel, fileObj, existingUrl, existingName]) => (
                        <Field key={kind} className="min-w-0">
                          <FieldLabel>{label}</FieldLabel>
                          <FileUpload key={`${kind}-${uploadKey}`} className="w-full" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" maxFiles={1} onFileAccept={details => handleFileChange(details.files[0], kind)}>
                            <FileUploadDropzone aria-label={zoneLabel}>
                              <FileUploadDropzoneIcon />
                              <Text size="sm" weight="semibold" className="break-words">
                                {fileObj ? <>{t('form.contract.file_selected', 'File selected:')} <span className="break-all">{fileObj.fileName}</span></> : t('spending.choose_reference', 'Choose a reference document')}
                              </Text>
                              <FileUploadTrigger asChild><Button size="sm">{t('form.contract.choose_file', 'Pilih File')}</Button></FileUploadTrigger>
                            </FileUploadDropzone>
                            <FileUploadHiddenInput />
                          </FileUpload>
                          {!fileObj && existingUrl && <Button asChild variant="link" className="break-all"><a href={existingUrl} target="_blank" rel="noopener noreferrer">{existingName}</a></Button>}
                          {kind === 'invoice' && fileObj && <Button variant="secondary" type="button" disabled={formBusy} onClick={handleParseSpending} className="self-start">
                            {isParsing && <Spinner size="sm" decorative />}
                            {isParsing ? t('spending.mengekstrak', 'Mengekstrak...') : t('partners.parse_file', 'Parse File')}
                          </Button>}
                        </Field>
                      ))}
                    </div>
                  </FormSection>
                </Fieldset>
              </DialogBody>

              <DialogFooter className="mt-0 flex-wrap items-center justify-between border-t border-border px-g21 py-g13">
                <Text size="xs" tone="muted" className="hidden sm:block">{t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan')}</Text>
                <div className="flex items-center gap-g8 ml-auto">
                  <Button variant="outline" type="button" onClick={closeSpendingModal} disabled={formBusy}>{t('form.common.cancel', 'Batal')}</Button>
                  <Button type="submit" disabled={formBusy || Boolean(allocationError) || !formVendorName || !formInvoiceNumber.trim()}>
                    {isSubmitting ? t('spending.saving_btn', 'Menyimpan...') : t('spending.save_spending', 'Save Spending')}
                  </Button>
                </div>
              </DialogFooter>
            </form>
        </ModalFrame>
      )}
    </div>
  );
};
