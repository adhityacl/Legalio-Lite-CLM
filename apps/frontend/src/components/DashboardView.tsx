import { AlphabeticalSelect } from './ui/alphabetical-select';
import { DashboardOverview } from './DashboardOverview';
import { ObligationsWidget } from '../features/obligations/ObligationsWidget';
import { RecentDocumentsTable } from './RecentDocumentsTable';
import { TableEmptyMessage, TableEmptyState } from './ui/table-empty-state';
import { aggregateValueInCurrency, buildSpendingSeriesFromAggregate } from '../lib/dashboardMetrics';
import type { DashboardAggregate, DashboardDocument } from '../api/aggregates';
import { useMediaQuery } from '../hooks/useMediaQuery';
import React, { useState, useMemo } from 'react';
import { useTenantSettings } from '../context/TenantSettingsContext';
import { convertToUsdWithFallback, getActiveFormattingLocale, getDefaultUsdRate } from '@legalio/shared/currencyUtils';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../lib/permissions';
import { Badge, statusTone } from '@legalio/ui-components/badge';
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
  /** SQL-computed figures for the caller's organization and departments (`GET /api/aggregates/dashboard`). */
  data: DashboardAggregate | undefined;
  loading?: boolean;
  onNavigateTab: (tab: string, recordId?: string) => void;
}

const NO_DATA: DashboardAggregate = {
  organizationId: '', partners: { total: 0, active: 0, byDdStatus: {} }, contracts: { total: 0, byStatus: {}, byApproval: {}, activeValueByCurrency: [] },
  ios: { total: 0, byStatus: {} }, notifications: { total: 0, unread: 0 }, expiring: { contracts: [], ios: [] }, recent: { contracts: [], ios: [] }, categories: [], spending: [],
};
const activeCount = (byStatus: Record<string, number>) => (byStatus.Active ?? 0) + (byStatus.Expiring ?? 0);

export const DashboardView: React.FC<DashboardViewProps> = ({
  data: loaded,
  loading = false,
  onNavigateTab,
}) => {
  const data = loaded ?? NO_DATA;
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

  // Commercial documents disappear from every widget and table while their module is off.
  const commercialEnabled = useTenantSettings().policy.settings.modules.commercialDocuments;

  // Stacked Spending Chart State & Filter Controls
  const [spendingFilterYear, setSpendingFilterYear] = useState<string>(() => String(new Date().getFullYear()));
  const [spendingCategoryFilter, setSpendingCategoryFilter] = useState<string>('ALL');
  const { policy } = useTenantSettings();
  // Reporting toggles between USD and the organization's own currency.
  const localCurrency = policy.settings.defaultCurrency;
  const [spendingCurrencyView, setSpendingCurrencyView] = useState<string>('USD');
  const currencyViews = Array.from(new Set(['USD', localCurrency]));
  const viewCurrency = currencyViews.includes(spendingCurrencyView) ? spendingCurrencyView : 'USD';
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

  // Cooperation categories of the contracts the caller may see.
  const categoryOptions = useMemo(() => [...data.categories].sort((a, b) => a.localeCompare(b)), [data.categories]);

  // The same reporting periods feed the year filter and the chart amounts.
  const availableSpendingYears = useMemo(() => {
    const yearsSet = new Set<string>(data.spending.map((row) => row.month.slice(0, 4)));
    if (yearsSet.size === 0) yearsSet.add(new Date().getFullYear().toString());
    return Array.from(yearsSet).sort().reverse();
  }, [data.spending]);

  const toViewCurrencyRow = (row: DashboardAggregate['spending'][number]): number => {
    if (viewCurrency === 'USD') return row.amount_usd ?? convertToUsdWithFallback(row.amount, row.currency || localCurrency);
    if ((row.currency || localCurrency) === viewCurrency) return row.amount;
    const usd = row.amount_usd ?? convertToUsdWithFallback(row.amount, row.currency || localCurrency);
    return usd / (getDefaultUsdRate(viewCurrency) || 1);
  };
  const spendingChart = useMemo(() => buildSpendingSeriesFromAggregate(
    data.spending, spendingFilterYear, spendingCategoryFilter, toViewCurrencyRow, t('ui.other'), t('ui.other'),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [data.spending, spendingFilterYear, spendingCategoryFilter, viewCurrency, localCurrency, language]);
  const stackedData = spendingChart.data;
  const stackKeys = spendingChart.series.map(s => s.key);
  const stackColors = Object.fromEntries(spendingChart.series.map(s => [s.key, s.color]));
  const formatChartMonth = (period: string) => new Intl.DateTimeFormat(getActiveFormattingLocale(), {
    month: 'short', timeZone: 'UTC',
  }).format(new Date(`${/^\d{2}$/.test(period) ? `2000-${period}` : period}-01T00:00:00Z`));

  // Calculations
  const activeContractsCount = activeCount(data.contracts.byStatus);
  const activeIOsCount = commercialEnabled ? activeCount(data.ios.byStatus) : 0;
  const totalIOs = commercialEnabled ? data.ios.total : 0;
  const expiringCount = data.contracts.byStatus.Expiring ?? 0;
  const documentLabel = (row: DashboardDocument) => row.document_type === 'Agreement Addendum'
    ? t('contracts.agreement_addendum', 'Agreement Addendum')
    : t('contracts.master_agreement', 'Master Agreement');
  const requiringActionDocuments = [
    ...data.expiring.contracts.map((contract) => ({
      id: contract.id,
      name: contract.title,
      type: documentLabel(contract),
      partner: contract.partner_name || '—',
      endDate: contract.end_date ?? '',
      remainingDays: contract.days_remaining ?? undefined,
      onOpen: () => onNavigateTab('contracts', contract.id),
    })),
    ...(commercialEnabled ? data.expiring.ios : []).map((io) => ({
      id: io.id,
      name: io.title,
      type: t('dashboard.insertion_orders', 'IO / SO / SOW'),
      partner: io.partner_name || '—',
      endDate: io.end_date ?? '',
      remainingDays: io.days_remaining ?? undefined,
      onOpen: () => onNavigateTab('ios', io.id),
    })),
  ].sort((a, b) => Date.parse(a.endDate) - Date.parse(b.endDate)).slice(0, 5);

  const totalNilaiKontrak = aggregateValueInCurrency(data.contracts.activeValueByCurrency, viewCurrency);
  return (
    <div className="flex flex-col gap-g21 animate-in fade-in-50 duration-200" aria-busy={loading}>
      {noDepartmentAccess && (
        <Alert status="warning" role="status"><AlertIndicator />
          <AlertContent><AlertDescription>{t('tb.no_department_access', 'You are not assigned to a department in this organization, so no records are shown. Ask an administrator to assign one.')}</AlertDescription></AlertContent>
        </Alert>
      )}
      <DashboardOverview
        greeting={getGreetingText()}
        expiring={expiringCount}
        metrics={[
          { label: t('dashboard.active_partners'), value: data.partners.active, total: data.partners.total, detail: t('dashboard.min_one_contract'), icon: Building2, tone: 'mint', onClick: () => onNavigateTab('partners') },
          { label: t('dashboard.active_contracts'), value: activeContractsCount, total: data.contracts.total, detail: `${t('dashboard.value')}: ${formatView(totalNilaiKontrak, true)}`, icon: FileText, tone: 'blue', onClick: () => onNavigateTab('contracts') },
          ...(commercialEnabled ? [{ label: t('dashboard.insertion_orders'), value: activeIOsCount, total: totalIOs, detail: t('dashboard.from_contracts', 'From {contracts} Contracts', { contracts: data.contracts.total }), icon: FileSpreadsheet, tone: 'violet' as const, onClick: () => onNavigateTab('ios') }] : []),
          { label: t('dashboard.expiring_contracts'), value: expiringCount, detail: t('dashboard.extension_termination'), icon: AlertTriangle, tone: 'amber', onClick: () => onNavigateTab('contracts') },
        ]}
      />
      <ObligationsWidget onOpen={() => onNavigateTab('obligations')} />
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

      <RecentDocumentsTable contracts={data.recent.contracts} ios={commercialEnabled ? data.recent.ios : []} onNavigate={onNavigateTab} />

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
