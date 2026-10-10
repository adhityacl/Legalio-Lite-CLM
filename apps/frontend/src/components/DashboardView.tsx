import { AlphabeticalSelect } from './ui/alphabetical-select';
import { DashboardOverview } from './DashboardOverview';
import { RecentDocumentsTable } from './RecentDocumentsTable';
import { TableEmptyMessage, TableEmptyState } from './ui/table-empty-state';
import { buildSpendingSeries, contractTotalInCurrency } from '../lib/dashboardMetrics';
import { useMediaQuery } from '../hooks/useMediaQuery';
import React, { useState, useMemo } from 'react';
import { useTenantSettings } from '../context/TenantSettingsContext';
import { convertToUsdWithFallback, getActiveFormattingLocale, getDefaultUsdRate } from '@legalio/shared/currencyUtils';
import { Contract, InsertionOrder, Partner, NotificationLog, PartnerSpending } from '@legalio/types';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../lib/permissions';
import {
  canViewPartner,
  canViewContract,
  canViewIO,
  canViewSpending,
} from '../lib/rbacScoping';
import { getSavedCategories } from '../lib/categoryUtils';
import { getStatusBadgeClass } from '@legalio/ui-components/badge';
import { spendingReportingAllocations } from '@legalio/shared/spendingAllocations';
import { NewsTicker } from './NewsTicker';
import { useDocumentList } from '../features/documents/useDocumentList';
import { formatDateTime } from '@legalio/types/documents';
import { typeLabel } from './documents/documentLabels';
import {
  FileText,
  FileSpreadsheet,
  AlertTriangle,
  Building2,
  Clock,
  ArrowUpRight,
  ShieldAlert,
  Bell,
  Calendar,
  DollarSign,
  TrendingUp,
  GitFork,
  FileClock,
  BarChart3,
} from 'lucide-react';
import {
  BarChart,
  CartesianGrid,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

interface DashboardViewProps {
  contracts: Contract[];
  ios: InsertionOrder[];
  partners: Partner[];
  spendings?: PartnerSpending[];
  notifications: NotificationLog[];
  onNavigateTab: (tab: string) => void;
  onSelectContract: (contract: Contract) => void;
  onSelectPartner: (partner: Partner) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  contracts,
  ios,
  partners,
  spendings = [],
  notifications,
  onNavigateTab,
  onSelectContract,
  onSelectPartner,
}) => {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const caps = usePermissions();
  // PRD §4.5.3: a non-admin membership without departments sees an explicit state, not an error or org totals.
  const noDepartmentAccess = caps.status === 'ready' && caps.accessMode === 'membership' && caps.tenantRole !== 'admin' && caps.departmentIds.length === 0;
  const isCompactChart = useMediaQuery('(max-width: 639px)');

  // Get time-based dynamic greeting
  const getGreetingText = () => {
    const currentHour = new Date().getHours();
    let greetingKey = 'greeting.morning';
    if (currentHour >= 5 && currentHour < 12) {
      greetingKey = 'greeting.morning';
    } else if (currentHour >= 12 && currentHour < 15) {
      greetingKey = 'greeting.afternoon';
    } else if (currentHour >= 15 && currentHour < 18) {
      greetingKey = 'greeting.evening';
    } else {
      greetingKey = 'greeting.night';
    }

    const greetingWord = t(greetingKey, 'Selamat Datang');
    const userName = user?.name?.trim() || 'Admin';
    return `${greetingWord}, ${userName}`;
  };

  // Documents awaiting review, for the "Pending Review" table below
  const pendingReviewQuery = useDocumentList({ status: 'pending_review', page: '1', limit: '5', sort_by: 'modified_at', sort_dir: 'desc' });
  const pendingReviewDocs = pendingReviewQuery.data?.documents || [];
  const pendingReviewState = pendingReviewQuery.isError ? 'error' : pendingReviewQuery.data ? 'ready' : 'loading';

  // Department-scoped datasets based on RBAC and Internal PIC of Partner
  const scopedPartners = useMemo(() => (partners || []).filter((p) => canViewPartner(p, user)), [partners, user]);
  const scopedContracts = useMemo(() => (contracts || []).filter((c) => canViewContract(c, partners, user)), [contracts, partners, user]);
  // Commercial documents disappear from every widget and table while their module is off.
  const commercialEnabled = useTenantSettings().policy.settings.modules.commercialDocuments;
  const scopedIOs = useMemo(() => (commercialEnabled ? ios || [] : []).filter((i) => canViewIO(i, partners, user)), [commercialEnabled, ios, partners, user]);
  const scopedSpendings = useMemo(() => (spendings || []).filter((s) => canViewSpending(s, partners, user)), [spendings, partners, user]);

  // Stacked Spending Chart State & Filter Controls
  const [spendingFilterYear, setSpendingFilterYear] = useState<string>(() => String(new Date().getFullYear()));
  const [spendingCategoryFilter, setSpendingCategoryFilter] = useState<string>('ALL');
  const { policy } = useTenantSettings();
  // Reporting toggles between USD and the organization's own currency.
  const localCurrency = policy.settings.defaultCurrency;
  const [spendingCurrencyView, setSpendingCurrencyView] = useState<string>('USD');
  const currencyViews = Array.from(new Set(['USD', localCurrency]));
  const viewCurrency = currencyViews.includes(spendingCurrencyView) ? spendingCurrencyView : 'USD';
  const toViewCurrency = (s: PartnerSpending): number => {
    const usd = s.total_amount_usd ?? convertToUsdWithFallback(s.total_amount, s.currency || localCurrency);
    if (viewCurrency === 'USD') return usd;
    if ((s.currency || localCurrency) === viewCurrency) return s.total_amount;
    return usd / (getDefaultUsdRate(viewCurrency) || 1);
  };
  const formatView = (value: number, compact = false) => {
    try {
      return new Intl.NumberFormat(getActiveFormattingLocale(), {
        style: 'currency',
        currency: viewCurrency,
        currencyDisplay: 'code',
        maximumFractionDigits: compact ? 1 : 0,
        ...(compact ? { notation: 'compact' as const } : {}),
      }).format(value);
    } catch {
      return `${viewCurrency} ${Math.round(value)}`;
    }
  };

  // Available Cooperation Categories directly and exclusively from Contracts (c.kategori_kerjasama)
  const categoryOptions = useMemo(() => {
    const catSet = new Set<string>();
    (scopedContracts || []).forEach((c) => {
      (c.kategori_kerjasama || []).forEach((cat) => {
        if (cat && cat.trim()) catSet.add(cat.trim());
      });
    });

    return Array.from(catSet).sort((a, b) => a.localeCompare(b));
  }, [scopedContracts]);

  // Use the same reporting periods for the year filter and chart amounts.
  const availableSpendingYears = useMemo(() => {
    const yearsSet = new Set<string>();
    (scopedSpendings || []).forEach((s) => {
      spendingReportingAllocations(s).forEach(({ month }) => yearsSet.add(month.slice(0, 4)));
    });
    if (yearsSet.size === 0) yearsSet.add(new Date().getFullYear().toString());
    return Array.from(yearsSet).sort().reverse();
  }, [scopedSpendings]);

  const spendingChart = useMemo(() => buildSpendingSeries(
    scopedSpendings, spendingFilterYear, spendingCategoryFilter,
    row => {
      const partner = scopedPartners.find(p => p.partner_id === row.vendor_id || p.nama_partner === row.vendor_name);
      const categories = scopedContracts.filter(c => c.partner_id === partner?.partner_id)
        .flatMap(c => c.kategori_kerjasama || []);
      return categories.length ? categories : [t('ui.other')];
    }, toViewCurrency, t('ui.other'),
  ), [scopedSpendings, scopedPartners, scopedContracts, spendingFilterYear, spendingCategoryFilter, viewCurrency, localCurrency, language]);
  const stackedData = spendingChart.data;
  const stackKeys = spendingChart.series.map(s => s.key);
  const stackColors = Object.fromEntries(spendingChart.series.map(s => [s.key, s.color]));
  const formatChartMonth = (period: string) => new Intl.DateTimeFormat(getActiveFormattingLocale(), {
    month: 'short', timeZone: 'UTC',
  }).format(new Date(`${/^\d{2}$/.test(period) ? `2000-${period}` : period}-01T00:00:00Z`));

  // Calculations
  const activeContracts = scopedContracts.filter((c) => c.status === 'Active' || c.status === 'Expiring');
  const activeIOs = scopedIOs.filter((i) => i.status === 'Active' || i.status === 'Expiring');
  const expiringContracts = scopedContracts.filter((c) => c.status === 'Expiring');
  const expiringIOs = scopedIOs.filter((i) => i.status === 'Expiring');
  const expiredContracts = scopedContracts.filter((c) => c.status === 'Expired');
  const requiringActionDocuments = [
    ...expiringContracts.map((contract) => ({
      id: contract.contract_id,
      name: contract.judul_kontrak,
      type: contract.jenis_dokumen === 'Agreement Addendum'
        ? t('contracts.agreement_addendum', 'Agreement Addendum')
        : t('contracts.master_agreement', 'Master Agreement'),
      partner: contract.partner_nama || '—',
      endDate: contract.tanggal_berakhir,
      remainingDays: contract.sisa_hari,
      onOpen: () => onSelectContract(contract),
    })),
    ...expiringIOs.map((io) => ({
      id: io.io_id,
      name: io.judul_io,
      type: t('dashboard.insertion_orders', 'IO / SO / SOW'),
      partner: io.partner_nama || '—',
      endDate: io.tanggal_berakhir || io.tanggal_selesai || '',
      remainingDays: io.sisa_hari,
      onOpen: () => onNavigateTab('ios'),
    })),
  ].sort((a, b) => Date.parse(a.endDate) - Date.parse(b.endDate));

  // Partner Aktif = minimal 1 kontrak dengan status Active atau Expiring
  const activePartnersCount = scopedPartners.filter((p) =>
    scopedContracts.some((c) => c.partner_id === p.partner_id && (c.status === 'Active' || c.status === 'Expiring'))
  ).length;

  const totalNilaiKontrak = contractTotalInCurrency(activeContracts, viewCurrency);
  return (
    <div className="ds-page animate-in fade-in-50 duration-200">
      {noDepartmentAccess && (
        <p role="status" className="ds-alert ds-status-warning border">
          {t('tb.no_department_access', 'You are not assigned to a department in this organization, so no records are shown. Ask an administrator to assign one.')}
        </p>
      )}
      <DashboardOverview
        greeting={getGreetingText()}
        expiring={expiringContracts.length}
        metrics={[
          { label: t('dashboard.active_partners'), value: activePartnersCount, total: scopedPartners.length, detail: t('dashboard.min_one_contract'), icon: Building2, tone: 'mint', onClick: () => onNavigateTab('partners') },
          { label: t('dashboard.active_contracts'), value: activeContracts.length, total: scopedContracts.length, detail: `${t('dashboard.value')}: ${formatView(totalNilaiKontrak, true)}`, icon: FileText, tone: 'blue', onClick: () => onNavigateTab('contracts') },
          ...(commercialEnabled ? [{ label: t('dashboard.insertion_orders'), value: activeIOs.length, total: scopedIOs.length, detail: t('dashboard.from_contracts', 'From {contracts} Contracts', { contracts: scopedContracts.length }), icon: FileSpreadsheet, tone: 'violet' as const, onClick: () => onNavigateTab('ios') }] : []),
          { label: t('dashboard.expiring_contracts'), value: expiringContracts.length, detail: t('dashboard.extension_termination'), icon: AlertTriangle, tone: 'amber', onClick: () => onNavigateTab('contracts') },
        ]}
      />
      <NewsTicker />

      {/* Notice Period Tracker Table */}
      <div className="bg-surface border border-hairline rounded-2xl shadow-sm overflow-hidden">
        <div className="ds-section-header">
          <div className="flex items-center gap-3">
            <div className="ds-icon-tile bg-status-danger-soft dark:bg-status-danger-soft/60 text-status-danger border border-status-danger-border dark:border-status-danger-border/30">
              <AlertTriangle className="w-5 h-5 text-status-danger" />
            </div>
            <div>
              <h3 className="ds-section-title">
                {t('dashboard.expiring_table_title')}
              </h3>
            </div>
          </div>

        </div>

        <div className="overflow-x-auto ds-table-surface" role="region" tabIndex={0} aria-label={t('dashboard.expiring_table_title')}>
          <table className="ds-table dashboard-data-table dashboard-document-table w-full min-w-[760px] text-left text-xs">
            <thead className="bg-surface dark:bg-surface-2/50">
              <tr className="bg-surface dark:bg-surface-2/50 border-b border-hairline text-xs font-bold text-ink h-12">
                <th scope="col" className="pl-6 pr-2 py-4 w-12 text-left align-middle">
                  <div className="flex items-center justify-start">
                    <input
                      type="checkbox"
                      aria-label={t('dashboard.select_all_requiring_action', 'Select all documents requiring action')}
                      className="rounded-sm border-hairline text-accent-text focus:ring-accent"
                      disabled
                    />
                  </div>
                </th>
                <th scope="col" className="px-6 py-4 font-bold">{t('dashboard.doc_pending_col_name', 'Document Name')}</th>
                <th scope="col" className="px-6 py-4 font-bold">{t('dashboard.doc_pending_col_type', 'Type')}</th>
                <th scope="col" className="px-6 py-4 font-bold">{t('dashboard.partner', 'Partner')}</th>
                <th scope="col" className="px-6 py-4 font-bold">{t('dashboard.remaining_time', 'Sisa Waktu')}</th>
                <th scope="col" className="px-6 py-4 font-bold">{t('dashboard.end_date', 'Tanggal Berakhir')}</th>
                <th scope="col" className="pl-2 pr-6 py-4 text-right w-20 text-xs font-bold text-ink align-middle">
                  <div className="flex items-center justify-end">{t('dashboard.action', 'Aksi')}</div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {requiringActionDocuments.length === 0 ? (
                <TableEmptyState colSpan={7} />
              ) : (
                requiringActionDocuments.map((document) => (
                  <tr key={document.id} className="hover:bg-surface dark:hover:bg-surface-2/50 transition-colors">
                    <td className="pl-6 pr-2 py-4 text-left align-middle">
                      <div className="flex items-center justify-start">
                        <input
                          type="checkbox"
                          aria-label={t('dashboard.select_requiring_action', 'Select {name}', { name: document.name })}
                          className="rounded-sm border-hairline text-accent-text focus:ring-accent"
                          disabled
                        />
                      </div>
                    </td>

                    {/* 1. Document Name */}
                    <td className="px-6 py-4 max-w-72 font-semibold text-ink">
                      <span className="line-clamp-2" title={document.name}>{document.name}</span>
                    </td>

                    {/* 2. Type */}
                    <td className="px-6 py-4 text-ink max-w-72">
                      {document.type}
                    </td>

                    {/* 3. Partner */}
                    <td className="px-6 py-4 text-ink whitespace-nowrap">
                      {document.partner}
                    </td>

                    {/* 4. Sisa Waktu */}
                    <td className="px-6 py-4 text-ink whitespace-nowrap">
                      <span className={`text-xs font-normal px-3 py-0.5 rounded-full border inline-flex items-center gap-1.5 shadow-2xs whitespace-nowrap ${getStatusBadgeClass('Akan Berakhir')}`}>
                        <Clock className="w-3.5 h-3.5" />
                        <span>{document.remainingDays ?? Math.ceil((Date.parse(document.endDate) - Date.now()) / 86_400_000)} {t('dashboard.days_left', 'Days Left')}</span>
                      </span>
                    </td>

                    {/* 5. Tanggal Berakhir */}
                    <td className="px-6 py-4 text-ink whitespace-nowrap">
                      {new Date(document.endDate).toLocaleDateString(getActiveFormattingLocale(), {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>

                    {/* 6. Aksi */}
                    <td className="pl-2 pr-6 py-4 text-right align-middle w-20">
                      <button
                        type="button"
                        onClick={document.onOpen}
                        aria-label={`${t('common.open', 'Open')} ${document.name}`}
                        className="inline-flex size-10 items-center justify-center rounded-md text-ink-soft hover:bg-surface-2 hover:text-status-success dark:hover:bg-surface-2 dark:hover:text-status-success cursor-pointer"
                      >
                        <ArrowUpRight className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <RecentDocumentsTable contracts={scopedContracts} ios={scopedIOs} onNavigate={onNavigateTab} />

      <div className="bg-surface border border-hairline rounded-2xl shadow-sm overflow-hidden">
        <div className="ds-section-header">
          <div className="flex items-center gap-3">
            <div className="ds-icon-tile bg-status-warning-soft dark:bg-status-warning-soft/60 text-status-warning border border-status-warning-border dark:border-status-warning-border/30">
              <FileClock className="w-5 h-5 text-status-warning" />
            </div>
            <div>
              <h3 className="ds-section-title">
                {t('dashboard.pending_review_table_title', 'Dokumen Menunggu Review (Pending Review)')}
              </h3>
            </div>
          </div>

        </div>

        <div className="overflow-x-auto ds-table-surface" role="region" tabIndex={0} aria-label={t('dashboard.pending_review_table_title')}>
          <table className="ds-table dashboard-data-table w-full min-w-[760px] text-left text-xs">
            <thead className="bg-surface dark:bg-surface-2/50">
              <tr className="bg-surface dark:bg-surface-2/50 border-b border-hairline text-xs font-bold text-ink h-12">
                <th scope="col" className="pl-6 pr-2 py-4 w-12 text-left align-middle">
                  <div className="flex items-center justify-start">
                    <input
                      type="checkbox"
                      aria-label={t('dashboard.pilih_semua_dokumen_pending_review', 'Pilih semua dokumen pending review')}
                      className="rounded-sm border-hairline text-accent-text focus:ring-accent"
                      disabled
                    />
                  </div>
                </th>
                <th scope="col" className="px-6 py-4 font-bold">{t('dashboard.doc_pending_col_name', 'Nama Dokumen')}</th>
                <th scope="col" className="px-6 py-4 font-bold">{t('dashboard.doc_pending_col_type', 'Jenis')}</th>
                <th scope="col" className="px-6 py-4 font-bold">{t('dashboard.doc_pending_col_modified_by', 'Diubah Oleh')}</th>
                <th scope="col" className="px-6 py-4 font-bold">{t('dashboard.doc_pending_col_created_at', 'Dibuat')}</th>
                <th scope="col" className="px-6 py-4 font-bold">{t('dashboard.doc_pending_col_modified_at', 'Terakhir Diubah')}</th>
                <th scope="col" className="pl-2 pr-6 py-4 text-right w-20 text-xs font-bold text-ink align-middle">
                  <div className="flex items-center justify-end">{t('dashboard.action', 'Aksi')}</div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {pendingReviewState === 'loading' ? (
                <tr>
                  <td colSpan={7} className="px-6 py-6 text-center text-ink-soft">
                    {t('common.loading', 'Memuat Data...')}
                  </td>
                </tr>
              ) : pendingReviewDocs.length === 0 ? (
                <TableEmptyState colSpan={7} />
              ) : (
                pendingReviewDocs.map((doc) => (
                  <tr key={doc.id} className="hover:bg-surface dark:hover:bg-surface-2/50 transition-colors">
                    <td className="pl-6 pr-2 py-4 text-left align-middle">
                      <div className="flex items-center justify-start">
                        <input
                          type="checkbox"
                          aria-label={t('dashboard.pilih_dokumen', 'Pilih dokumen {nama}', { nama: doc.name })}
                          className="rounded-sm border-hairline text-accent-text focus:ring-accent"
                          disabled
                        />
                      </div>
                    </td>

                    {/* 1. Nama Dokumen */}
                    <td className="px-6 py-4 font-semibold text-ink max-w-72">
                      <span className="line-clamp-2" title={doc.name}>{doc.name}</span>
                    </td>

                    {/* 2. Jenis */}
                    <td className="px-6 py-4 text-ink whitespace-nowrap">
                      {typeLabel(t, doc.type)}
                    </td>

                    {/* 3. Diubah Oleh */}
                    <td className="px-6 py-4 text-ink whitespace-nowrap">
                      {doc.modified_by_name || '—'}
                    </td>

                    {/* 4. Dibuat */}
                    <td className="px-6 py-4 text-ink whitespace-nowrap">
                      {formatDateTime(doc.created_at, language)}
                    </td>

                    {/* 5. Terakhir Diubah */}
                    <td className="px-6 py-4 text-ink whitespace-nowrap">
                      {formatDateTime(doc.modified_at, language)}
                    </td>

                    {/* 6. Aksi */}
                    <td className="pl-2 pr-6 py-4 text-right align-middle w-20">
                      <button
                        type="button"
                        onClick={() => onNavigateTab('create-contract')}
                        aria-label={`${t('common.open', 'Open')} ${doc.name}`}
                        className="inline-flex size-10 items-center justify-center rounded-md text-ink-soft hover:bg-surface-2 hover:text-status-success dark:hover:bg-surface-2 dark:hover:text-status-success cursor-pointer"
                      >
                        <ArrowUpRight className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stacked Spending Chart Card (Under Table); hidden with the spending module (PRD §4.5.3) */}
      {policy.settings.modules.spending && (
      <div className="ds-panel min-w-0 p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-hairline">
          <div className="flex items-center gap-3">
            <div className="ds-icon-tile bg-accent-soft text-accent-text border border-accent/30">
              <DollarSign className="w-5 h-5 text-accent-text" />
            </div>
            <div>
              <h3 className="ds-section-title">
                {t('dashboard.spending_title', 'Tren Spending')}
              </h3>
            </div>
          </div>

          {/* Chart Filters */}
          <div className="mobile-filter-grid flex w-full min-w-0 flex-nowrap items-center gap-2 sm:w-auto ds-grid">
            {/* 1. Year Filter */}
            <select
              aria-label={t('ui.filter_year')}
              value={spendingFilterYear}
              onChange={(e) => setSpendingFilterYear(e.target.value)}
              className="ds-input w-[92px] shrink-0 sm:w-auto"
            >
              <option value="ALL">{t('dashboard.all_years', 'Semua Tahun')}</option>
              {availableSpendingYears.map((y) => (
                <option key={y} value={y}>
                  {t('dashboard.year_prefix', 'Tahun')} {y}
                </option>
              ))}
            </select>

            {/* 2. Category Filter */}
            <AlphabeticalSelect
              aria-label={t('ui.filter_category')}
              value={spendingCategoryFilter}
              onChange={(e) => setSpendingCategoryFilter(e.target.value)}
              className="ds-input min-w-0 flex-1 sm:w-48 sm:flex-none cursor-pointer truncate"
            >
              <option value="ALL">{t('dashboard.all_categories', 'Semua Kategori')}</option>
              {categoryOptions.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </AlphabeticalSelect>

            {/* 3. Currency Toggle */}
            <div role="group" aria-label={t('settings.region.reporting_currency', 'Reporting currency')} className="ds-panel flex h-10 shrink-0 items-center p-0.75">
              {currencyViews.map((code) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={viewCurrency === code}
                  onClick={() => setSpendingCurrencyView(code)}
                  className={`ui-button ui-button-md cursor-pointer ds-button ds-button-md ds-button-default ${
                    viewCurrency === code
                      ? ''
                      : ''
                  }`}
                >
                  {code}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Chart Visualization */}
        <p className="text-sm text-ink">{t('ui.period_total')}: <strong className="tabular-nums">{formatView(spendingChart.total)}</strong> · {spendingFilterYear === 'ALL' ? t('dashboard.all_years') : spendingFilterYear} · {spendingCategoryFilter === 'ALL' ? t('dashboard.all_categories') : spendingCategoryFilter}</p>
        {spendingChart.skipped > 0 && <p className="text-sm text-status-warning">{t('ui.skipped_dates', undefined, { count: spendingChart.skipped })}</p>}
        <div className="min-w-0 w-full" role="region" aria-label={t('dashboard.spending_title')}>
        <div className="w-full pt-2" style={stackKeys.length ? { height: 'clamp(240px, 28vw, 360px)' } : undefined}>
          {stackKeys.length === 0 ? (
            <TableEmptyMessage icon={BarChart3} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stackedData} title={t('dashboard.spending_title')} desc={t('dashboard.spending_title')} margin={{ top: 10, right: isCompactChart ? 2 : 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="month"
                  tickFormatter={formatChartMonth}
                  interval={0}
                  stroke="var(--chart-label)"
                  fontSize={isCompactChart ? 10 : 12}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--chart-grid)' }}
                  padding={{ left: 0, right: 0 }}
                />
                <YAxis
                  stroke="var(--chart-label)"
                  fontSize={isCompactChart ? 10 : 12}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--chart-grid)' }}
                  width={isCompactChart ? 64 : 85}
                  tick={({ y, payload }: any) => {
                    const val = payload?.value;
                    const label = formatView(Number(val) || 0, true);

                    return (
                      <text x={0} y={y} dy={4} fill="var(--chart-label)" fontSize={isCompactChart ? 10 : 12} fontWeight={500} textAnchor="start">
                        {label}
                      </text>
                    );
                  }}
                />
                <Tooltip
                  content={({ active, payload, label }: any) => {
                    if (active && payload && payload.length) {
                      const total = payload.reduce((sum: number, entry: any) => sum + (Number(entry.value) || 0), 0);
                      const formattedTotal = formatView(total);

                      return (
                        <div className="ds-panel p-3 text-xs text-ink min-w-42.5">
                          <div className="font-extrabold pb-2 mb-2 border-b border-hairline text-ink flex justify-between items-center gap-2">
                            <span>{formatChartMonth(String(label))}</span>
                            <span className="text-accent-text font-black">({formattedTotal})</span>
                          </div>
                          <div className="space-y-1.5">
                            {payload.map((entry: any, index: number) => {
                              const val = Number(entry.value) || 0;
                              if (val === 0) return null;
                              const formattedVal = formatView(val);

                              return (
                                <div key={`item-${index}`} className="flex items-center justify-between gap-3 text-[11px]">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color || entry.fill }} />
                                    <span className="text-ink-soft font-medium truncate">{entry.name}</span>
                                  </div>
                                  <span className="font-bold text-ink shrink-0">{formattedVal}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend
                  wrapperStyle={{ paddingTop: '12px', fontSize: '13px' }}
                  formatter={value => <span style={{ color: 'var(--chart-label)' }}>{value}</span>}
                />
                {stackKeys.map((key) => (
                  <Bar
                    isAnimationActive={false}
                    key={key}
                    dataKey={key}
                    name={spendingChart.series.find(series => series.key === key)?.name}
                    stackId="spendingStack"
                    fill={stackColors[key] || '#4CAF50'}
                    maxBarSize={isCompactChart ? 28 : 52}
                    radius={[2, 2, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        </div>
      </div>
      )}
    </div>
  );
};
