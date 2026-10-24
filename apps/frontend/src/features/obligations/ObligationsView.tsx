import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, CalendarClock, CalendarDays, CheckCircle2, Clock, ListChecks, Pencil, Plus, RefreshCw, Search, Settings2, Sparkles, Trash2 } from 'lucide-react';
import { PAGE_SIZES } from '@legalio/types/documents';
import { Badge } from '@legalio/ui-components/badge';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { Heading } from '@legalio/ui-components/heading';
import { Input } from '@legalio/ui-components/input';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { Table, TableBody, TableCell, TableColumnHeader, TableHeader, TableRow, TableScrollArea } from '@legalio/ui-components/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@legalio/ui-components/tabs';
import { Text } from '@legalio/ui-components/text';
import { useLanguage } from '../../context/LanguageContext';
import { useTenant } from '../../context/TenantContext';
import { useNavigation } from '../../context/NavigationContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { usePermissions } from '../../lib/permissions';
import { useServerList } from '../../lib/useServerList';
import { errorMessage } from '../../api/client';
import { contractsApi } from '../../api/contracts';
import { obligationsApi, type Obligation } from '../../api/obligations';
import { ActionMenu, type ActionMenuItem } from '../../components/ui/action-menu';
import { TableEmptyState } from '../../components/ui/table-empty-state';
import { TablePagination } from '../../components/ui/TablePagination';
import { useSnapshotDemand, useWorkspace } from '../workspace/WorkspaceContext';
import { WorkspaceDocumentCalendar } from '../calendar/WorkspaceDocumentCalendar';
import { ApprovalNotifications } from '../approvals/ApprovalNotifications';
import { ObligationDialog } from './ObligationDialog';
import { ObligationSettingsDialog } from './ObligationSettingsDialog';
import { invalidateObligations } from './obligationQueries';
import { DueCell, STATUS_KEYS, StatusBadge, TYPE_KEYS, TYPE_OPTIONS, attachedTo, recurrenceLabel, typeLabel } from './obligationUi';

const FILTER_KEYS = ['status', 'type', 'responsible'] as const;
const SORTABLE = ['due_date', 'title', 'type', 'status'] as const;
type SortField = (typeof SORTABLE)[number];
/** Status filter choices: the stored statuses, the derived overdue, and "active" (all open work). */
const STATUS_FILTERS = ['active', 'overdue', 'open', 'in_progress', 'done', 'waived'] as const;

/** Obligations and key dates: server-paged list and the document calendar with the organization's deadlines. */
export const ObligationsView: React.FC = () => {
  const { t } = useLanguage();
  const { activeTenantId } = useTenant();
  const { recordId, clearRecordId, setActiveTab } = useNavigation();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('document.edit');
  const canDelete = hasPermission('document.delete');
  const canConfigure = hasPermission('tenant.settings.update');
  const confirmDialog = useConfirm();
  const showAlert = useAlertToast();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [rows, setRows] = useState(PAGE_SIZES[1] as number);
  const [dialog, setDialog] = useState<{ obligation: Obligation | null } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const mapFilters = useMemo(() => (filters: Record<string, string>) => ({
    status: filters.status === 'active' ? 'open,in_progress,overdue' : filters.status, type: filters.type, responsible: filters.responsible,
  }), []);
  const toApiSort = useMemo(() => (field: string) => ((SORTABLE as readonly string[]).includes(field) ? field : null), []);
  const list = useServerList<Obligation>({ entity: 'obligations', path: '/obligations', pageSize: rows, filterKeys: FILTER_KEYS, mapFilters, toApiSort });
  const summary = useQuery({ queryKey: ['obligations', activeTenantId, 'summary'], queryFn: ({ signal }) => obligationsApi.summary({ signal }), enabled: Boolean(activeTenantId), staleTime: 15_000 });

  // The calendar cross-references contracts and orders; the picker lists contracts to link to (up to the API's page maximum).
  useSnapshotDemand(view === 'calendar');
  const { contracts, ios, partners, workspaceLoading, workspaceError, loadAllData } = useWorkspace();
  const contractChoices = useQuery({
    queryKey: ['obligations', activeTenantId, 'contract-choices'], enabled: Boolean(activeTenantId) && dialog !== null,
    queryFn: async () => (await contractsApi.page({ limit: 500, sort: 'contract_number', dir: 'asc' })).items.map((c) => ({ id: c.contract_id, label: `${c.contract_number} · ${c.contract_title}` })),
    staleTime: 60_000,
  });

  // Deep link `?tab=obligations&id=...` (search results, reminders, calendar): open that obligation.
  useEffect(() => {
    if (!recordId) return;
    let cancelled = false;
    obligationsApi.get(recordId).then((o) => { if (!cancelled) setDialog({ obligation: o }); }).catch(() => {
      if (!cancelled) showAlert({ title: t('obligations.not_found', 'That obligation no longer exists or you cannot see it.'), variant: 'destructive' });
    }).finally(() => { if (!cancelled) clearRecordId(); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  const refreshAll = () => Promise.all([invalidateObligations(queryClient), list.refetch()]);
  const failed = (err: unknown) => showAlert({ title: t('obligations.error.action', 'The action failed'), description: errorMessage(err, ''), variant: 'destructive' });
  const complete = async (o: Obligation) => {
    try {
      const result = await obligationsApi.complete(o.id, o.version);
      showAlert({ title: result.obligation.status === 'open' ? t('obligations.completed_next', 'Done. Next due {date}.', { date: result.obligation.due_date ?? '' }) : t('obligations.completed', 'Marked as done'), variant: 'success' });
      await refreshAll();
    } catch (err) { failed(err); }
  };
  const remove = async (o: Obligation) => {
    if (!(await confirmDialog({ description: t('obligations.confirm_delete', 'Delete "{title}"? This cannot be undone.', { title: o.title }), tone: 'danger', confirmLabel: t('documents.action.delete', 'Delete') }))) return;
    try { await obligationsApi.remove(o.id); showAlert({ title: t('obligations.deleted', 'Obligation deleted'), variant: 'success' }); await refreshAll(); } catch (err) { failed(err); }
  };
  const actions = (o: Obligation): ActionMenuItem[] => [
    { label: canEdit ? t('obligations.edit', 'Edit obligation') : t('obligations.view', 'Obligation'), icon: <Pencil className="h-g13 w-g13" />, onClick: () => setDialog({ obligation: o }) },
    ...(canEdit && (o.stored_status === 'open' || o.stored_status === 'in_progress') ? [{ label: t('obligations.mark_done', 'Mark done'), icon: <CheckCircle2 className="h-g13 w-g13" />, onClick: () => void complete(o) }] : []),
    ...(canDelete ? [{ label: t('documents.action.delete', 'Delete'), icon: <Trash2 className="h-g13 w-g13" />, onClick: () => void remove(o), variant: 'danger' as const, dividerBefore: true }] : []),
  ];

  const sortHeader = (field: SortField, label: string, className = '') => {
    const active = list.state.sort === field;
    return (
      <TableColumnHeader key={field} scope="col" className={className || undefined} aria-sort={active ? (list.state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <Button variant="ghost" size="sm" type="button" className="-ms-g13 font-semibold text-muted-foreground" onClick={() => list.toggleSort(field)}>
          <span>{label}</span>
          {active ? (list.state.dir === 'asc' ? <ArrowUp className="h-g13 w-g13 shrink-0 text-accent-foreground" aria-hidden /> : <ArrowDown className="h-g13 w-g13 shrink-0 text-accent-foreground" aria-hidden />) : <ArrowUpDown className="h-g13 w-g13 shrink-0 text-muted-foreground" aria-hidden />}
        </Button>
      </TableColumnHeader>
    );
  };

  const stats = summary.data;
  const cards = [
    { icon: AlertTriangle, tone: 'bg-status-danger-soft text-status-danger', value: stats?.overdue, label: t('obligations.stats.overdue', 'Overdue'), filter: 'overdue' },
    { icon: CalendarClock, tone: 'bg-status-warning-soft text-status-warning', value: stats?.dueThisWeek, label: t('obligations.stats.week', 'Due in the next 7 days'), filter: 'active' },
    { icon: Clock, tone: 'bg-status-info-soft text-status-info', value: stats?.open, label: t('obligations.stats.open', 'Open in total'), filter: 'active' },
  ];
  const statusValue = list.state.filters.status ?? 'ALL';

  return (
    <section className="w-full min-w-0 space-y-g21" aria-labelledby="obligations-heading">
      <div className="flex flex-wrap items-center justify-between gap-g13">
        <div>
          <Heading as="h2" size="md" weight="semibold" id="obligations-heading">{t('obligations.title', 'Obligations & key dates')}</Heading>
          <Text size="sm" tone="muted">{t('obligations.subtitle', 'Deadlines and duties that come out of your contracts, with reminders for the people responsible.')}</Text>
        </div>
        <div className="flex items-center gap-g8">
          <Button variant="outline" size="icon-md" type="button" onClick={() => void refreshAll()} loading={list.isFetching} aria-label={t('approval.refresh', 'Refresh')}><RefreshCw className="size-g16" aria-hidden /></Button>
          {canConfigure && <Button variant="outline" type="button" onClick={() => setSettingsOpen(true)}><Settings2 className="size-g16" aria-hidden /><span>{t('obligations.reminder_settings', 'Reminders')}</span></Button>}
          {canEdit && <Button type="button" onClick={() => setDialog({ obligation: null })}><Plus className="size-g16" aria-hidden /><span>{t('obligations.add', 'Add obligation')}</span></Button>}
        </div>
      </div>

      <ApprovalNotifications scope="obligation" />

      <div className="grid grid-cols-1 gap-g13 sm:grid-cols-3">
        {cards.map(({ icon: Icon, tone, value, label, filter }) => (
          <Card key={label} className="flex flex-row items-center gap-g13 p-g13">
            <span className={`flex size-g34 shrink-0 items-center justify-center rounded-md ${tone}`}><Icon className="size-g16" aria-hidden /></span>
            <div>
              <Text size="lg" weight="semibold" data-testid="obligation-stat">{value ?? '–'}</Text>
              <Button type="button" variant="link" className="h-auto p-0 text-xs font-normal text-muted-foreground no-underline hover:underline" onClick={() => { setView('list'); list.setFilter('status', filter); }}>{label}</Button>
            </div>
          </Card>
        ))}
      </div>

      <Tabs value={view} onValueChange={(details) => setView(details.value as 'list' | 'calendar')} className="flex flex-col gap-g13">
        <TabsList aria-label={t('obligations.title', 'Obligations & key dates')} className="w-full sm:w-auto">
          <TabsTrigger value="list"><ListChecks aria-hidden="true" />{t('obligations.view.list', 'List')}</TabsTrigger>
          <TabsTrigger value="calendar"><CalendarDays aria-hidden="true" />{t('obligations.view.calendar', 'Calendar')}</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-0 space-y-g13">
          <Card className="p-g13">
            <div className="flex w-full flex-wrap items-center gap-g13">
              <div className="relative min-w-g233 flex-1">
                <Search className="absolute left-g13 top-1/2 h-g16 w-g16 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input type="search" value={list.searchInput} onChange={(e) => list.setSearch(e.target.value)} className="w-full pl-g34 pr-g13"
                  aria-label={t('obligations.search_label', 'Search obligations')} placeholder={t('obligations.search_placeholder', 'Search title, contract or counterparty…')} />
              </div>
              <NativeSelect aria-label={t('obligations.filter.status', 'Status')} value={statusValue} onChange={(e) => list.setFilter('status', e.target.value)} controlProps={{ className: 'min-w-g144 flex-1' }}>
                <option value="ALL">{t('obligations.filter.status_all', 'All statuses')}</option>
                {STATUS_FILTERS.map((value) => <option key={value} value={value}>{value === 'active' ? t('obligations.status.active', 'Active (open work)') : t(...STATUS_KEYS[value])}</option>)}
              </NativeSelect>
              <NativeSelect aria-label={t('obligations.filter.type', 'Type')} value={list.state.filters.type ?? 'ALL'} onChange={(e) => list.setFilter('type', e.target.value)} controlProps={{ className: 'min-w-g144 flex-1' }}>
                <option value="ALL">{t('obligations.filter.type_all', 'All types')}</option>
                {TYPE_OPTIONS.map((value) => <option key={value} value={value}>{t(...TYPE_KEYS[value])}</option>)}
              </NativeSelect>
              <Checkbox checked={list.state.filters.responsible === 'me'} onCheckedChange={(details) => list.setFilter('responsible', details.checked === true ? 'me' : null)}>
                <CheckboxControl /><CheckboxLabel>{t('obligations.filter.mine', 'Assigned to me')}</CheckboxLabel><CheckboxHiddenInput />
              </Checkbox>
            </div>
          </Card>

          <Card asChild><section className="overflow-hidden" aria-busy={list.isFetching} aria-live="polite" aria-label={t('obligations.title', 'Obligations & key dates')}>
            {list.isLoading && (
              <div className="divide-y divide-border" role="status">
                <span className="sr-only">{t('common.loading', 'Loading…')}</span>
                {Array.from({ length: 6 }, (_, i) => <div key={i} className="flex h-g42 items-center gap-g13 px-g13"><Skeleton className="h-g13 w-1/3" /><Skeleton className="h-g13 w-g68" /><Skeleton className="ms-auto h-g13 w-g89" /></div>)}
              </div>
            )}
            {list.error && (
              <div role="alert" className="space-y-g13 p-g34 text-center">
                <Text size="sm" weight="semibold" tone="destructive">{t('obligations.load_failed', 'Could not load obligations.')}</Text>
                <Button variant="ghost" type="button" onClick={() => void list.refetch()}><RefreshCw className="h-g13 w-g13" aria-hidden />{t('common.retry', 'Retry')}</Button>
              </div>
            )}
            {!list.isLoading && !list.error && (
              <>
                <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.scroll_table')}>
                  <Table>
                    <caption className="sr-only">{t('obligations.title', 'Obligations & key dates')}</caption>
                    <TableHeader>
                      <TableRow>
                        {sortHeader('title', t('obligations.col.obligation', 'Obligation'))}
                        {sortHeader('type', t('obligations.field.type', 'Type'), 'hidden md:table-cell')}
                        {sortHeader('due_date', t('obligations.field.due', 'Due date'))}
                        {sortHeader('status', t('obligations.field.status', 'Status'))}
                        <TableColumnHeader scope="col" className="hidden lg:table-cell">{t('obligations.field.responsible', 'Responsible person')}</TableColumnHeader>
                        <TableColumnHeader scope="col" className="w-g89 text-right">{t('approval.col.action', 'Action')}</TableColumnHeader>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {list.items.length === 0 ? (
                        <TableEmptyState colSpan={6} message={t('obligations.empty', 'No obligations match.')}
                          action={canEdit ? <Button type="button" onClick={() => setDialog({ obligation: null })}><Plus aria-hidden />{t('obligations.add', 'Add obligation')}</Button> : undefined} />
                      ) : list.items.map((o) => (
                        <TableRow key={o.id} data-testid="obligation-row">
                          <TableCell className="max-w-g377">
                            <Button variant="link" className="block h-auto min-w-0 max-w-full truncate p-0 text-start text-sm font-semibold" onClick={() => setDialog({ obligation: o })}>{o.title}</Button>
                            <Text size="xs" tone="muted" className="truncate">
                              {[attachedTo(o), o.recurrence !== 'once' ? recurrenceLabel(t, o) : ''].filter(Boolean).join(' · ')}
                              {o.source === 'ai_extracted' && <span className="ms-g5 inline-flex items-center gap-g3 text-status-special"><Sparkles className="size-g13" aria-hidden />{t('obligations.ai_badge', 'AI')}</span>}
                            </Text>
                          </TableCell>
                          <TableCell className="hidden md:table-cell"><Badge tone="neutral">{typeLabel(t, o.type)}</Badge></TableCell>
                          <TableCell><DueCell t={t} o={o} /></TableCell>
                          <TableCell className="whitespace-nowrap"><StatusBadge t={t} status={o.status} /></TableCell>
                          <TableCell className="hidden lg:table-cell"><Text size="sm" className="truncate">{o.responsible_name || o.responsible_department || '—'}</Text></TableCell>
                          <TableCell className="w-g89 text-right"><div className="flex items-center justify-end"><ActionMenu title={`${t('approval.col.action', 'Action')}: ${o.title}`} items={actions(o)} /></div></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableScrollArea>
                <TablePagination currentPage={list.state.page} totalPages={list.pageCount} rowsPerPage={rows} rowsPerPageOptions={[...PAGE_SIZES]}
                  onPageChange={list.setPage} onRowsPerPageChange={(size) => { setRows(size); list.setPage(1); }} />
              </>
            )}
          </section></Card>
        </TabsContent>

        <TabsContent value="calendar" className="mt-0">
          {view === 'calendar' && <WorkspaceDocumentCalendar contracts={contracts} ios={ios} partners={partners} loading={workspaceLoading} error={workspaceError} onRetry={() => void loadAllData()}
            onOpenDocument={(kind, id) => setActiveTab(kind === 'contract' ? 'contracts' : 'ios', undefined, { recordId: id })}
            onOpenObligation={(id) => { void obligationsApi.get(id).then((o) => setDialog({ obligation: o })).catch((err) => failed(err)); }} />}
        </TabsContent>
      </Tabs>

      {dialog && <ObligationDialog obligation={dialog.obligation} contracts={contractChoices.data ?? []} readOnly={!canEdit} onClose={() => setDialog(null)}
        onSaved={() => { setDialog(null); showAlert({ title: t('obligations.saved', 'Obligation saved'), variant: 'success' }); void refreshAll(); }} />}
      {settingsOpen && <ObligationSettingsDialog onClose={() => setSettingsOpen(false)} />}
    </section>
  );
};
