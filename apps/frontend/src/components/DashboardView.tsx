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
import { Badge, statusTone } from '@legalio/ui-components/badge';
import { spendingReportingAllocations } from '@legalio/shared/spendingAllocations';
import { NewsTicker } from './NewsTicker';
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
  BarChart3,
} from 'lucide-react';
import {
  BarChart,
  CartesianGrid,
  Bar,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

import { Table, TableHeader, TableRow, TableColumnHeader, TableBody, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { Button } from '@legalio/ui-components/button';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { CardHeader, Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { Checkbox, CheckboxControl, CheckboxHiddenInput } from '@legalio/ui-components/checkbox';
import { SegmentGroup, SegmentGroupIndicator, SegmentGroupItems } from '@legalio/ui-components/segment-group';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Text } from '@legalio/ui-components/text';
import { Avatar, AvatarFallback } from '@legalio/ui-components/avatar';
import { TableCardHeader } from '@legalio/ui-components/blocks';
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
    <div className="flex flex-col gap-g21 animate-in fade-in-50 duration-200">
      {noDepartmentAccess && (
        <Alert status="warning" role="status"><AlertIndicator />
          <AlertContent><AlertDescription>{t('tb.no_department_access', 'You are not assigned to a department in this organization, so no records are shown. Ask an administrator to assign one.')}</AlertDescription></AlertContent>
        </Alert>
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
      <Card className="overflow-hidden">
        <TableCardHeader tone="danger" icon={<AlertTriangle />} title={t('dashboard.expiring_table_title')} />

        <TableScrollArea role="region" tabIndex={0} aria-label={t('dashboard.expiring_table_title')}>
          <Table className="dashboard-data-table dashboard-document-table w-full min-w-g610 text-left">
            <TableHeader>
              <TableRow>
                <TableColumnHeader scope="col" className="w-g42">
                  <div className="flex items-center justify-start">
                    <Checkbox aria-label={t('dashboard.select_all_requiring_action', 'Select all documents requiring action')} disabled><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                  </div>
                </TableColumnHeader>
                <TableColumnHeader scope="col">{t('dashboard.doc_pending_col_name', 'Document Name')}</TableColumnHeader>
                <TableColumnHeader scope="col">{t('dashboard.doc_pending_col_type', 'Type')}</TableColumnHeader>
                <TableColumnHeader scope="col">{t('dashboard.partner', 'Partner')}</TableColumnHeader>
                <TableColumnHeader scope="col">{t('dashboard.remaining_time', 'Sisa Waktu')}</TableColumnHeader>
                <TableColumnHeader scope="col">{t('dashboard.end_date', 'Tanggal Berakhir')}</TableColumnHeader>
                <TableColumnHeader scope="col" className="text-right w-g89">
                  <div className="flex items-center justify-end">{t('dashboard.action', 'Aksi')}</div>
                </TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requiringActionDocuments.length === 0 ? (
                <TableEmptyState colSpan={7} />
              ) : (
                requiringActionDocuments.map((document) => (
                  <TableRow key={document.id}>
                    <TableCell>
                      <div className="flex items-center justify-start">
                        <Checkbox aria-label={t('dashboard.select_requiring_action', 'Select {name}', { name: document.name })} disabled><CheckboxControl /><CheckboxHiddenInput /></Checkbox>
                      </div>
                    </TableCell>

                    {/* 1. Document Name */}
                    <TableCell className="max-w-g233">
                      <Tooltip><TooltipTrigger asChild><span className="block truncate">{document.name}</span></TooltipTrigger><TooltipBody>{document.name}</TooltipBody></Tooltip>
                    </TableCell>

                    {/* 2. Type */}
                    <TableCell className="max-w-g233">
                      {document.type}
                    </TableCell>

                    {/* 3. Partner */}
                    <TableCell className="whitespace-nowrap">
                      {document.partner}
                    </TableCell>

                    {/* 4. Sisa Waktu */}
                    <TableCell className="whitespace-nowrap">
                      <Badge tone={statusTone('Akan Berakhir')}>
                        <Clock className="w-g13 h-g13" />
                        <span>{document.remainingDays ?? Math.ceil((Date.parse(document.endDate) - Date.now()) / 86_400_000)} {t('dashboard.days_left', 'Days Left')}</span>
                      </Badge>
                    </TableCell>

                    {/* 5. Tanggal Berakhir */}
                    <TableCell className="whitespace-nowrap">
                      {new Date(document.endDate).toLocaleDateString(getActiveFormattingLocale(), {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </TableCell>

                    {/* 6. Aksi */}
                    <TableCell className="text-right w-g89">
                      <Button variant="secondary" size="icon-sm"
                        type="button"
                        onClick={document.onOpen}
                        aria-label={`${t('common.open', 'Open')} ${document.name}`}
                      >
                        <ArrowUpRight className="size-g16" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableScrollArea>
      </Card>

      <RecentDocumentsTable contracts={scopedContracts} ios={scopedIOs} onNavigate={onNavigateTab} />

      {/* Stacked Spending Chart Card (Under Table); hidden with the spending module (PRD §4.5.3) */}
      {policy.settings.modules.spending && (
      <Card className="min-w-0 p-g13 sm:p-g21 space-y-g13">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-g13 pb-g13 border-b border-border">
          <div className="flex items-center gap-g13">
            <Avatar size="md" className="shrink-0 rounded-md border bg-accent text-accent-foreground border border-primary/30"><AvatarFallback className="bg-transparent text-inherit"><DollarSign className="w-g21 h-g21 text-accent-foreground" /></AvatarFallback></Avatar>
            <div>
              <Heading as="h3" size="sm" weight="semibold">
                {t('dashboard.spending_title', 'Tren Spending')}
              </Heading>
            </div>
          </div>

          {/* Chart Filters */}
          <div className="flex w-full min-w-0 flex-nowrap items-center gap-g8 sm:w-auto">
            {/* 1. Year Filter */}
            <NativeSelect
              aria-label={t('ui.filter_year')}
              value={spendingFilterYear}
              onChange={(e) => setSpendingFilterYear(e.target.value)}
              className="w-full" controlProps={{ className: "shrink-0 sm:w-auto" }}
            >
              <option value="ALL">{t('dashboard.all_years', 'Semua Tahun')}</option>
              {availableSpendingYears.map((y) => (
                <option key={y} value={y}>
                  {t('dashboard.year_prefix', 'Tahun')} {y}
                </option>
              ))}
            </NativeSelect>

            {/* 2. Category Filter */}
            <AlphabeticalSelect
              aria-label={t('ui.filter_category')}
              value={spendingCategoryFilter}
              onChange={(e) => setSpendingCategoryFilter(e.target.value)}
              className="w-full truncate" controlProps={{ className: "min-w-0 flex-1 sm:w-g233 sm:flex-none" }}
            >
              <option value="ALL">{t('dashboard.all_categories', 'Semua Kategori')}</option>
              {categoryOptions.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </AlphabeticalSelect>

            {/* 3. Currency Toggle */}
            <SegmentGroup aria-label={t('settings.region.reporting_currency', 'Reporting currency')} value={viewCurrency}
              onValueChange={details => details.value && setSpendingCurrencyView(details.value)} className="shrink-0">
              <SegmentGroupIndicator />
              <SegmentGroupItems items={currencyViews.map(code => ({ value: code, label: code }))} />
            </SegmentGroup>
          </div>
        </div>

        {/* Chart Visualization */}
        <Text size="sm">{t('ui.period_total')}: <strong className="tabular-nums">{formatView(spendingChart.total)}</strong> · {spendingFilterYear === 'ALL' ? t('dashboard.all_years') : spendingFilterYear} · {spendingCategoryFilter === 'ALL' ? t('dashboard.all_categories') : spendingCategoryFilter}</Text>
        {spendingChart.skipped > 0 && <Text size="sm" className="text-status-warning">{t('ui.skipped_dates', undefined, { count: spendingChart.skipped })}</Text>}
        <div className="min-w-0 w-full" role="region" aria-label={t('dashboard.spending_title')}>
        <div className="w-full pt-g8" style={stackKeys.length ? { height: 'clamp(240px, 28vw, 360px)' } : undefined}>
          {stackKeys.length === 0 ? (
            <TableEmptyMessage icon={BarChart3} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stackedData} title={t('dashboard.spending_title')} desc={t('dashboard.spending_title')} margin={{ top: 10, right: isCompactChart ? 2 : 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--moduix-color-border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="month"
                  tickFormatter={formatChartMonth}
                  interval={0}
                  stroke="var(--moduix-color-muted-foreground)"
                  fontSize={isCompactChart ? 10 : 12}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--moduix-color-border)' }}
                  padding={{ left: 0, right: 0 }}
                />
                <YAxis
                  stroke="var(--moduix-color-muted-foreground)"
                  fontSize={isCompactChart ? 10 : 12}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--moduix-color-border)' }}
                  width={isCompactChart ? 64 : 85}
                  tick={({ y, payload }: any) => {
                    const val = payload?.value;
                    const label = formatView(Number(val) || 0, true);

                    return (
                      <text x={0} y={y} dy={4} fill="var(--moduix-color-muted-foreground)" fontSize={isCompactChart ? 10 : 12} fontWeight={500} textAnchor="start">
                        {label}
                      </text>
                    );
                  }}
                />
                <ChartTooltip
                  content={({ active, payload, label }: any) => {
                    if (active && payload && payload.length) {
                      const total = payload.reduce((sum: number, entry: any) => sum + (Number(entry.value) || 0), 0);
                      const formattedTotal = formatView(total);

                      return (
                        <Card className="p-g13 text-xs text-foreground min-w-g144">
                          <div className="font-extrabold pb-g8 mb-g8 border-b border-border text-foreground flex justify-between items-center gap-g8">
                            <span>{formatChartMonth(String(label))}</span>
                            <span className="text-accent-foreground font-black">({formattedTotal})</span>
                          </div>
                          <div className="space-y-g5">
                            {payload.map((entry: any, index: number) => {
                              const val = Number(entry.value) || 0;
                              if (val === 0) return null;
                              const formattedVal = formatView(val);

                              return (
                                <div key={`item-${index}`} className="flex items-center justify-between gap-g13 text-xs">
                                  <div className="flex items-center gap-g5 min-w-0">
                                    <span className="w-g8 h-g8 rounded-full shrink-0" style={{ backgroundColor: entry.color || entry.fill }} />
                                    <span className="text-muted-foreground font-medium truncate">{entry.name}</span>
                                  </div>
                                  <span className="font-bold text-foreground shrink-0">{formattedVal}</span>
                                </div>
                              );
                            })}
                          </div>
                        </Card>
                      );
                    }
                    return null;
                  }}
                />
                <Legend
                  wrapperStyle={{ paddingTop: '12px', fontSize: '13px' }}
                  formatter={value => <span style={{ color: 'var(--moduix-color-muted-foreground)' }}>{value}</span>}
                />
                {stackKeys.map((key) => (
                  <Bar
                    isAnimationActive={false}
                    key={key}
                    dataKey={key}
                    name={spendingChart.series.find(series => series.key === key)?.name}
                    stackId="spendingStack"
                    fill={stackColors[key] || 'var(--moduix-chart-1)'}
                    maxBarSize={isCompactChart ? 28 : 52}
                    radius={[2, 2, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        </div>
      </Card>
      )}
    </div>
  );
};
