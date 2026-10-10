import { TableViewMenu, TableViewOption } from './ui/table-view-menu';
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
  CheckCircle2,
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
  Tooltip,
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
import { DialogHeader, DialogTitle } from '@legalio/ui-components/dialog';
import { Alert, AlertContent } from '@legalio/ui-components/alert';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Checkbox, CheckboxControl, CheckboxHiddenInput } from '@legalio/ui-components/checkbox';
const spendingLabelClass = 'block text-sm font-semibold text-foreground  mb-1.5';
const spendingButtonClass = 'ui-button ui-button-md border border-border  bg-card  font-semibold hover:bg-muted  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:cursor-not-allowed';
const spendingUploadClass = 'ds-upload min-w-0 text-center';
const spendingFileInputClass = 'w-[220px] max-w-full min-w-0 text-sm text-muted-foreground  file:mr-2 file:py-1.5 file:px-3.5 file:rounded-xl file:border-0 file:text-sm file:font-bold file:bg-primary file:text-accent-foreground hover:file:bg-primary/20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl';

// Re-export formatMonthTagDisplay for backwards compatibility with any external consumers
export { formatMonthTagDisplay };

interface PartnerSpendingViewProps {
  partners: Partner[];
  spendings: PartnerSpending[];
  onRefreshData: () => void;
  userEmail?: string;
  userName?: string;
  userRole?: string;
}

export const PartnerSpendingView: React.FC<PartnerSpendingViewProps> = ({
  partners,
  spendings = [],
  onRefreshData,
  userEmail,
  userName,
  userRole,
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
  const errorRef = useRef<HTMLDivElement>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [parseSuccessMsg, setParseSuccessMsg] = useState<string | null>(null);

  const resetFormState = (item?: PartnerSpending | null) => {
    setEditingSpending(item || null);
    setFormVendorName(item?.vendor_name || '');
    setFormVendorId(item?.vendor_id || partners.find(p => p.nama_partner === item?.vendor_name)?.partner_id || '');
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
    const partner = partners.find(p => id ? p.partner_id === id : p.nama_partner === name);
    setFormVendorName(partner?.nama_partner || name);
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'invoice' | 'billing') => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) {
        setErrorMessage(t('spending.upload_size_error', 'Maximum file size is 20 MB.'));
        e.target.value = '';
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
              const vName = vendor.nama_partner.toLowerCase();
              return vName.includes(rawH) || rawH.includes(vName);
            });
            if (matchedP) {
              setFormVendorName(matchedP.nama_partner);
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
      className="text-left align-middle"
     data-numeric={field === 'amount'}>
      <Button variant="ghost" size="sm"
        type="button"
        onClick={() => handleSort(field)}
        title={t('spending.urutkan_berdasarkan', 'Urutkan berdasarkan {label}', { label })}
      >
        <span>{label}</span>
        {sortField === field ? (
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

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);

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
    <div className="space-y-6">
      {/* Header */}
      <Card className="flex-row flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <Heading as="h2" size="lg" weight="semibold">
            <span>{t('spending.partner_spending_invoicing', 'Partner Spending / Invoicing')}</span>
          </Heading>
        </div>

        <div className="mobile-page-actions flex items-center gap-2.5 shrink-0 flex-wrap">
          {hasPermission('export.csv') && (
            <Button variant="outline"
              onClick={handleExportCSV}
              disabled={sortedSpendings.length === 0}
              title={t('contracts.export_csv', 'Ekspor CSV')}
            >
              <Download className="w-4 h-4" />
              <span>{t('contracts.export_csv', 'Ekspor CSV')}</span>
            </Button>
          )}

          {canCreateContract(user) && (
            <Button
              onClick={handleAddNew}
            >
              <Plus className="w-4 h-4" />
              <span>{t('ui.add_spending')}</span>
            </Button>
          )}
        </div>
      </Card>

      {/* Filter Bar with 3 Dropdowns */}
      {/* Search & Filter Bar - Justified Responsive Grid/Flex */}
      <Card className="p-4 sm:p-5">
        <div className="mobile-filter-grid flex flex-wrap items-center gap-2.5 w-full">
          {/* 1 Box Search */}
          <InputGroup className="relative flex-1 min-w-[200px] sm:min-w-[240px]">
            <InputGroupAddon><Search className="size-4" aria-hidden="true" /></InputGroupAddon>
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
            className="flex-1 min-w-[130px]"
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
            className="flex-1 min-w-[130px] appearance-none pr-8"
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
            className="flex-1 min-w-[130px]"
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
            <div className="px-3.5 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 border-b border-border">
              {t('io.toggle_columns', 'Toggle Kolom')}
            </div>
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
      <Card className="overflow-hidden">
        <FilterSummary filters={[{ label: t('ui.search'), value: searchTerm, active: Boolean(searchTerm) }, { label: t('ui.filter_year'), value: selectedYear, active: selectedYear !== 'ALL' }, { label: t('ui.filter_partner'), value: selectedVendorFilter, active: selectedVendorFilter !== 'ALL' }, { label: t('ui.filter_month'), value: selectedMonthFilter, active: selectedMonthFilter !== 'ALL' }]} onReset={() => { setSearchTerm(''); setSelectedYear('ALL'); setSelectedVendorFilter('ALL'); setSelectedMonthFilter('ALL'); }} />
        <p className="mobile-table-hint px-4 py-2 text-xs text-muted-foreground md:hidden">{t('ui.scroll_table')}</p>
        <TableScrollArea className="data-table-scroll" tabIndex={0} role="region" aria-label={t('ui.scroll_table')}>
          <Table className="app-data-table w-full text-left">
            <TableHeader>
              <TableRow>
                <TableColumnHeader scope="col" className="w-12 text-left align-middle">
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
                  <TableColumnHeader scope="col" className="text-left align-middle">
                    <span>{t('spending.col_invoice_doc', 'Invoice')}</span>
                  </TableColumnHeader>
                )}
                {visibleColumns.billing_doc && (
                  <TableColumnHeader scope="col" className="text-left align-middle">
                    <span>{t('spending.col_billing_doc', 'Billing')}</span>
                  </TableColumnHeader>
                )}
                <TableColumnHeader data-actions="true" scope="col" className="text-right w-20 align-middle">
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
                    <TableCell className="text-left align-middle">
                      <div className="flex items-center justify-start">
                        <Checkbox aria-label={t('spending.pilih_spending', 'Pilih spending {value}', { value: s.invoice_number || s.vendor_name || '' })} checked={selectedRows.includes(s.id || '')} onCheckedChange={() => handleSelectRow(s.id || '')}><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                      </div>
                    </TableCell>

                    {/* 1. No. Invoice */}
                    {visibleColumns.invoice_no && (
                      <TableCell className="text-left whitespace-nowrap">
                        {s.invoice_number}
                      </TableCell>
                    )}

                    {/* 2. Partner */}
                    {visibleColumns.vendor && (
                      <TableCell className="text-left whitespace-nowrap">
                        {s.vendor_name}
                      </TableCell>
                    )}

                    {/* 3. Invoice Month */}
                    {visibleColumns.invoice_month && (
                      <TableCell className="text-left whitespace-nowrap">
                        {s.invoice_month && s.invoice_month.length > 0
                          ? s.invoice_month.map((m) => formatMonthTagDisplay(m, language)).join(', ')
                          : '-'}
                      </TableCell>
                    )}

                    {/* 4. Invoice Date */}
                    {visibleColumns.invoice_date && (
                      <TableCell className="text-left whitespace-nowrap">
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
                      <TableCell className="text-left whitespace-nowrap">
                        {s.invoice_file_url ? (
                          <a
                            href={s.invoice_file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-accent-foreground hover:text-accent-foreground font-normal hover:underline"
                          >
                            <FileDown className="w-3.5 h-3.5" /> {t('spending.pdf', 'PDF')}
                          </a>
                        ) : (
                          <span className="text-primary-foreground">—</span>
                        )}
                      </TableCell>
                    )}

                    {/* 7. Billing Doc */}
                    {visibleColumns.billing_doc && (
                      <TableCell className="text-left whitespace-nowrap">
                        {s.billing_file_url ? (
                          <a
                            href={s.billing_file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-accent-foreground hover:text-accent-foreground font-normal hover:underline"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5" /> {t('spending.sheet', 'Sheet')}
                          </a>
                        ) : (
                          <span className="text-primary-foreground">—</span>
                        )}
                      </TableCell>
                    )}

                    {/* Actions */}
                    <TableCell data-actions="true" className="text-right align-middle w-20">
                      <div className="flex items-center justify-end">
                        <ActionMenu
                          items={[
                            ...(canEditSpending(s, partners, user)
                              ? [
                                  {
                                    label: t('hierarchy.edit_btn', 'Edit'),
                                    icon: <Edit className="w-3.5 h-3.5" />,
                                    onClick: () => handleOpenEditModal(s),
                                  },
                                ]
                              : []),
                            ...(canDeletePartner(user)
                              ? [
                                  {
                                    label: t('io.action_delete', 'Hapus'),
                                    icon: <Trash2 className="w-3.5 h-3.5" />,
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
    <ModalFrame onClose={closeSpendingModal}>
            {/* Modal Header */}
            <DialogHeader className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-accent-foreground" />
                  <span>
                    {editingSpending
                      ? t('spending.modal_edit_title', 'Edit Data Spending')
                      : t('spending.modal_title', 'Input Data Spending')}
                  </span>
                </DialogTitle>
              </div>
              <Button variant="secondary" size="icon-md"
                type="button"
                onClick={closeSpendingModal} disabled={formBusy}
                aria-label={t('common.close', 'Close')}
              >
                <X className="w-5 h-5" />
              </Button>
            </DialogHeader>

            {/* Modal Form */}
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden min-h-0">
              <div className="p-5 sm:p-6 overflow-y-auto space-y-6 text-sm flex-1 min-w-0 text-foreground">
                {errorMessage && <Alert status="error" ref={errorRef} tabIndex={-1} role="alert"><AlertContent>{errorMessage}</AlertContent></Alert>}
                {parseSuccessMsg && <Alert status="success" role="status" className="flex items-start gap-2"><AlertContent><CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />{parseSuccessMsg}</AlertContent></Alert>}
                <fieldset disabled={formBusy} className="space-y-6 min-w-0">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <section aria-labelledby="spending-partner-heading" className="min-w-0">
                      <h3 id="spending-partner-heading" className="font-semibold text-base mb-3">{t('spending.partner_details', 'Partner Details')}</h3>
                      <Card className="p-4 sm:p-5 space-y-3">
                        <div>
                          <label htmlFor="spending-partner" className={spendingLabelClass}>{t('spending.partner_name', 'Partner Name')} <span className="text-status-danger">*</span></label>
                          <AlphabeticalSelect id="spending-partner" required value={formVendorId || formVendorName} onChange={e => {
                            const partner = partners.find(p => p.partner_id === e.target.value);
                            handleVendorSelect(partner?.nama_partner || e.target.value, partner?.partner_id);
                          }}>
                            <option value="">{t('spending.vendor_select_ph', '-- Pilih Partner / Vendor --')}</option>
                            {partners.map(p => <option key={p.partner_id} value={p.partner_id}>{p.nama_partner} ({p.partner_id})</option>)}
                            {formVendorName && !partners.some(p => p.partner_id === formVendorId || p.nama_partner === formVendorName) && <option value={formVendorId || formVendorName}>{formVendorName}</option>}
                          </AlphabeticalSelect>
                        </div>
                        <Field>
                          <FieldLabel htmlFor="spending-invoice-number" className={spendingLabelClass}>{t('spending.invoice_no_label', 'Invoice Number')} <span className="text-status-danger">*</span></FieldLabel>
                          <Input id="spending-invoice-number" required value={formInvoiceNumber} onChange={e => setFormInvoiceNumber(e.target.value)} placeholder={t('spending.invoice_no_ph', 'Contoh: INV-2026-0801')} />
                          {formInvoiceNumber.trim() && spendings.some(s => s.invoice_number.toLowerCase() === formInvoiceNumber.trim().toLowerCase() && s.id !== editingSpending?.id) && <p className="text-xs text-status-warning mt-1 flex gap-1"><Lightbulb className="size-3.5 shrink-0" aria-hidden="true" />{t('spending.nomor_invoice_ini_sudah_dicatat_sebelumnya', 'Nomor invoice ini sudah dicatat sebelumnya. Diizinkan menginput nomor invoice sama untuk bulan/amount berbeda.')}</p>}
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="spending-invoice-title" className={spendingLabelClass}>{t('spending.invoice_title_label', 'Invoice Title')}</FieldLabel>
                          <Input id="spending-invoice-title" value={formInvoiceTitle} onChange={e => setFormInvoiceTitle(e.target.value)} placeholder={t('spending.invoice_title_ph', 'e.g. Q4 Social Media Retainer')} />
                        </Field>
                      </Card>
                    </section>
                    <section aria-labelledby="spending-bank-heading" className="min-w-0">
                      <h3 id="spending-bank-heading" className="font-semibold text-base mb-3">{t('spending.bank_panel_title', 'Bank Account Information')}</h3>
                      <Card className="p-4 sm:p-5 space-y-3">
                        <Field>
                          <FieldLabel htmlFor="spending-bank-name" className={spendingLabelClass}>{t('spending.bank_name_label', 'Bank Name')}</FieldLabel>
                          <Input id="spending-bank-name" value={formBankName} onChange={e => { bankEdited.current.name = true; setFormBankName(e.target.value); }} />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="spending-account-number" className={spendingLabelClass}>{t('spending.bank_account_no_label', 'Account Number')}</FieldLabel>
                          <Input id="spending-account-number" value={formBankAccountNumber} onChange={e => { bankEdited.current.number = true; setFormBankAccountNumber(e.target.value); }} />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="spending-account-holder" className={spendingLabelClass}>{t('spending.bank_account_holder_label', 'Account Holder')}</FieldLabel>
                          <Input id="spending-account-holder" value={formBankAccountHolder} onChange={e => { bankEdited.current.holder = true; setFormBankAccountHolder(e.target.value); }} />
                        </Field>
                      </Card>
                    </section>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Field className="min-w-0">
                      <FieldLabel htmlFor="spending-invoice-date" className={spendingLabelClass}>{t('spending.invoice_date_label', 'Invoice Date')}</FieldLabel>
                      <DateInput id="spending-invoice-date" value={formInvoiceDate} onChange={setFormInvoiceDate} focusColor="emerald" />
                    </Field>
                    <div className="min-w-0">
                      <label htmlFor="spending-currency" className={spendingLabelClass}>{t('spending.currency_label', 'Currency')}</label>
                      <AlphabeticalSelect id="spending-currency" value={formCurrency} onChange={e => setFormCurrency(e.target.value)}>
                        {SUPPORTED_CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} — {currencyLabel(c.code, language)}</option>)}
                      </AlphabeticalSelect>
                    </div>
                    <div className="min-w-0">
                      <label htmlFor="spending-total" className={spendingLabelClass}>{t('spending.total_amount_label', 'Total Amount')} <span className="text-status-danger">*</span></label>
                      <Input id="spending-total" required type="number" min="0" step="any" value={formTotalAmount} onChange={e => setFormTotalAmount(e.target.value === '' ? '' : Number(e.target.value))} className={`text-right`} />
                      <div className="mt-2 text-xs text-muted-foreground flex flex-wrap justify-between gap-1" aria-live="polite">
                        <span>{t('spending.usd_estimate', 'Estimated USD Conversion')}</span><strong className="text-foreground">{formatMoney(estimatedUsd, 'USD')}</strong>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{formCurrency === 'USD' ? t('spending.sama_mata_uang_usd', 'Sama (Mata uang USD)') : t('spending.1_usd', '1 {formCurrency} ≈ {value} USD', { formCurrency, value: historicalRate.toFixed(8) })}</p>
                    </div>
                  </div>
                  <section aria-labelledby="spending-allocation-heading" aria-describedby="spending-allocation-status" className="rounded-xl border border-border overflow-hidden">
                    <div className="flex flex-wrap justify-between items-center gap-3 p-4">
                      <div><h3 id="spending-allocation-heading" className="font-semibold">{t('spending.allocation_title', 'Spending Month Allocation')}</h3><p className="text-xs text-muted-foreground mt-1">{t('spending.allocation_help', 'One invoice can cover one or multiple spending months.')}</p></div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="ghost" type="button" disabled={!monthAllocations.length || formTotalAmount === '' || Number(formTotalAmount) < 0} onClick={() => setMonthAllocations(rows => splitSpendingEqually(rows, Number(formTotalAmount), currencyMinorUnits(formCurrency)))} className={spendingButtonClass}>{t('spending.split_equally', 'Split Equally')}</Button>
                        <Button variant="ghost" type="button" onClick={() => setMonthAllocations(rows => [...rows, { month: '', amount: '' }])} className={`${spendingButtonClass} `}><Plus className="size-4" aria-hidden="true" />{t('spending.add_month', 'Add Month')}</Button>
                      </div>
                    </div>
                    <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] gap-3 px-4 py-3 bg-card border-y border-border text-xs font-semibold text-muted-foreground" aria-hidden="true"><span>{t('spending.spending_month', 'Spending Month')}</span><span className="text-right">{t('spending.allocated_amount', 'Allocated Amount')} ({formCurrency})</span><span className="sr-only">{t('spending.delete_month', 'Delete spending month {index}', { index: '' })}</span></div>
                    <div className="divide-y divide-border">
                      {monthAllocations.map((row, index) => {
                        const duplicate = Boolean(row.month && monthAllocations.some((other, otherIndex) => index !== otherIndex && other.month === row.month));
                        return <div key={index} className="grid grid-cols-[minmax(0,1fr)_44px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] gap-3 p-4 items-end">
                          <Field className="min-w-0">
                            <FieldLabel htmlFor={`spending-month-${index}`}>{t('spending.spending_month', 'Spending Month')} {index + 1}</FieldLabel>
                            <Input id={`spending-month-${index}`} type="month" required min="1900-01" max="2100-12" value={row.month} aria-invalid={duplicate || !row.month} aria-describedby="spending-allocation-status" onChange={e => setMonthAllocations(rows => rows.map((item, i) => i === index ? { ...item, month: e.target.value } : item))} />
                          </Field>
                          <Field className="min-w-0 col-start-1 row-start-2 sm:col-start-auto sm:row-start-auto">
                            <FieldLabel htmlFor={`spending-amount-${index}`}>{t('spending.allocated_amount', 'Allocated Amount')} {index + 1} ({formCurrency})</FieldLabel>
                            <Input id={`spending-amount-${index}`} type="number" min="0" step="any" required value={row.amount} aria-invalid={row.amount === '' || Number(row.amount) < 0} aria-describedby="spending-allocation-status" onChange={e => setMonthAllocations(rows => rows.map((item, i) => i === index ? { ...item, amount: e.target.value === '' ? '' : Number(e.target.value) } : item))} className={`text-right`} />
                          </Field>
                          <Button variant="ghost" size="icon-md" type="button" aria-label={t('spending.delete_month', 'Delete spending month {index}', { index: index + 1 })} onClick={() => setMonthAllocations(rows => rows.filter((_, i) => i !== index))} className={`${spendingButtonClass.replace('', '')} col-start-2 row-start-1`}><Trash2 className="size-4 mx-auto" aria-hidden="true" /></Button>
                        </div>;
                      })}
                    </div>
                    <div className="p-4 bg-card border-t border-border flex flex-wrap items-center justify-between gap-2">
                      <p id="spending-allocation-status" role="status" className={`text-sm font-medium ${!allocationError ? 'text-status-success ' : remaining < -ALLOCATION_TOLERANCE ? 'text-status-danger ' : 'text-status-warning '}`}>{allocationStatus}</p>
                      <span className="text-xs text-muted-foreground">{t('spending.allocated_total', 'Allocated: {amount}', { amount: formatMoney(allocatedTotal, formCurrency) })}</span>
                    </div>
                  </section>
                  <Field>
                    <FieldLabel htmlFor="spending-description" className={spendingLabelClass}>{t('spending.invoice_desc_label', 'Invoice Description')}</FieldLabel>
                    <Textarea id="spending-description" rows={4} value={formInvoiceDesc} onChange={e => setFormInvoiceDesc(e.target.value)} placeholder={t('spending.invoice_desc_ph', 'Keterangan lengkap pengeluaran / rincian invoice...')} className={`resize-y`} />
                  </Field>
                  <section aria-labelledby="spending-documents-heading">
                    <h3 id="spending-documents-heading" className="font-semibold text-base mb-3">{t('spending.documents_title', 'Documents')}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="min-w-0">
                        <label htmlFor="spending-invoice-file" className={spendingLabelClass}>{t('spending.upload_invoice_label', 'Upload Invoice')}</label>
                        <div className={spendingUploadClass}>
                          <Upload className="size-6 text-accent-foreground mx-auto mb-1.5" aria-hidden="true" />
                          <p className="text-sm font-bold text-foreground break-words">
                            {invoiceFileObj ? <>{t('form.contract.file_selected', 'File selected:')} <span className="break-all">{invoiceFileObj.fileName}</span></>
                              : editingSpending?.invoice_file_url ? <a href={editingSpending.invoice_file_url} target="_blank" rel="noopener noreferrer" className="break-all underline">{editingSpending.invoice_file_name || t('spending.existing_invoice', 'View existing invoice')}</a>
                              : t('form.partner.drag_ref', 'Choose a reference document')}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
                            {invoiceFileObj && <Button variant="ghost" type="button" disabled={formBusy} onClick={handleParseSpending}>
                              {isParsing && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                              {isParsing ? t('spending.mengekstrak', 'Mengekstrak...') : t('partners.parse_file', 'Parse File')}
                            </Button>}
                            <input id="spending-invoice-file" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onChange={e => handleFileChange(e, 'invoice')} className={spendingFileInputClass} />
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{t('spending.documents_help', 'PDF, Word, JPG or PNG. Maximum 20 MB.')}</p>
                      </div>
                      <div className="min-w-0">
                        <label htmlFor="spending-billing-file" className={spendingLabelClass}>{t('spending.upload_billing_label', 'Upload Billing')}</label>
                        <div className={spendingUploadClass}>
                          <Upload className="size-6 text-accent-foreground mx-auto mb-1.5" aria-hidden="true" />
                          <p className="text-sm font-bold text-foreground break-words">
                            {billingFileObj ? <>{t('form.contract.file_selected', 'File selected:')} <span className="break-all">{billingFileObj.fileName}</span></>
                              : editingSpending?.billing_file_url ? <a href={editingSpending.billing_file_url} target="_blank" rel="noopener noreferrer" className="break-all underline">{editingSpending.billing_file_name || t('spending.existing_billing', 'View existing billing')}</a>
                              : t('form.partner.drag_ref', 'Choose a reference document')}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
                            <input id="spending-billing-file" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onChange={e => handleFileChange(e, 'billing')} className={spendingFileInputClass} />
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{t('spending.documents_help', 'PDF, Word, JPG or PNG. Maximum 20 MB.')}</p>
                      </div>
                    </div>
                  </section>
                </fieldset>
              </div>

              {/* Actions */}
              <div className="p-4 sm:p-5 bg-card border-t border-border flex items-center justify-between gap-2 shrink-0">
                <span className="text-xs text-muted-foreground font-medium hidden sm:inline">
                  {t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan')}
                </span>
                <div className="flex items-center gap-2 ml-auto">
                  <Button variant="ghost"
                    type="button"
                    onClick={closeSpendingModal} disabled={formBusy}
                  >
                    {t('spending.cancel_btn', 'Batal')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={formBusy || Boolean(allocationError) || !formVendorName || !formInvoiceNumber.trim()}
                  >
                    {isSubmitting
                      ? t('spending.saving_btn', 'Menyimpan...')
                      : t('spending.save_btn', 'Simpan Spending')}
                  </Button>
                </div>
              </div>
            </form>
        </ModalFrame>
      )}
    </div>
  );
};
