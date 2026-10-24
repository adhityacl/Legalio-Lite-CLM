import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown, BookMarked, Download, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { PAGE_SIZES } from '@legalio/types/documents';
import { Badge } from '@legalio/ui-components/badge';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { Input } from '@legalio/ui-components/input';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { Table, TableBody, TableCell, TableColumnHeader, TableHeader, TableRow, TableScrollArea } from '@legalio/ui-components/table';
import { Text } from '@legalio/ui-components/text';
import { useLanguage } from '../../context/LanguageContext';
import { useTenant } from '../../context/TenantContext';
import { useNavigation } from '../../context/NavigationContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { usePermissions } from '../../lib/permissions';
import { useServerList } from '../../lib/useServerList';
import { errorMessage } from '../../api/client';
import { clausesApi, type Clause } from '../../api/clauses';
import { ActionMenu, type ActionMenuItem } from '../../components/ui/action-menu';
import { TableEmptyState } from '../../components/ui/table-empty-state';
import { TablePagination } from '../../components/ui/TablePagination';
import { ClauseDialog } from './ClauseDialog';
import { StarterImportDialog } from './StarterImportDialog';
import { LANGUAGE_KEYS, RISK_KEYS, RISK_LEVELS, RiskBadge } from './clauseUi';

const FILTER_KEYS = ['category', 'risk', 'language', 'status'] as const;
const SORTABLE = ['title', 'category', 'risk_level', 'updated_at'] as const;
type SortField = (typeof SORTABLE)[number];

/** The organization's clause library: approved wording, fallbacks and the rules the playbook checks. */
export const ClauseLibraryView: React.FC = () => {
  const { t } = useLanguage();
  const { activeTenantId } = useTenant();
  const { recordId, clearRecordId } = useNavigation();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('document.edit');
  const canDelete = hasPermission('document.delete');
  const canImport = hasPermission('tenant.settings.update');
  const confirmDialog = useConfirm();
  const showAlert = useAlertToast();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState(PAGE_SIZES[1] as number);
  const [dialog, setDialog] = useState<{ clause: Clause | null } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const mapFilters = useMemo(() => (filters: Record<string, string>) => ({ category: filters.category, risk: filters.risk, language: filters.language, status: filters.status }), []);
  const toApiSort = useMemo(() => (field: string) => ((SORTABLE as readonly string[]).includes(field) ? field : null), []);
  const list = useServerList<Clause>({ entity: 'clauses', path: '/clauses', pageSize: rows, filterKeys: FILTER_KEYS, mapFilters, toApiSort });
  const facets = useQuery({ queryKey: ['clauses', activeTenantId, 'facets'], queryFn: () => clausesApi.facets(), enabled: Boolean(activeTenantId), staleTime: 30_000 });

  // Deep link `?tab=clauses&id=...` (chat citations): open that clause.
  useEffect(() => {
    if (!recordId) return;
    let cancelled = false;
    clausesApi.get(recordId).then((c) => { if (!cancelled) setDialog({ clause: c }); }).catch(() => {
      if (!cancelled) showAlert({ title: t('clauses.not_found', 'That clause no longer exists.'), variant: 'destructive' });
    }).finally(() => { if (!cancelled) clearRecordId(); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  const refreshAll = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['clauses'] }), list.refetch()]);
  const failed = (err: unknown) => showAlert({ title: t('clauses.error.action', 'The action failed'), description: errorMessage(err, ''), variant: 'destructive' });
  const remove = async (c: Clause) => {
    if (!(await confirmDialog({ description: t('clauses.confirm_delete', 'Delete "{title}"? This cannot be undone.', { title: c.title }), tone: 'danger', confirmLabel: t('documents.action.delete', 'Delete') }))) return;
    try { await clausesApi.remove(c.id); showAlert({ title: t('clauses.deleted', 'Clause deleted'), variant: 'success' }); await refreshAll(); } catch (err) { failed(err); }
  };
  const actions = (c: Clause): ActionMenuItem[] => [
    { label: canEdit ? t('clauses.edit', 'Edit clause') : t('clauses.view', 'Clause'), icon: <Pencil className="h-g13 w-g13" />, onClick: () => setDialog({ clause: c }) },
    ...(canDelete ? [{ label: t('documents.action.delete', 'Delete'), icon: <Trash2 className="h-g13 w-g13" />, onClick: () => void remove(c), variant: 'danger' as const, dividerBefore: true }] : []),
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

  const emptyLibrary = !list.isLoading && !list.error && list.items.length === 0 && !list.state.q && Object.values(list.state.filters).every((v) => !v || v === 'ALL');

  return (
    <section className="w-full min-w-0 space-y-g21" aria-labelledby="clauses-heading">
      <div className="flex flex-wrap items-center justify-between gap-g13">
        <div>
          <Heading as="h2" size="md" weight="semibold" id="clauses-heading">{t('clauses.title', 'Clause library & playbook')}</Heading>
          <Text size="sm" tone="muted">{t('clauses.subtitle', 'Approved wording, fallbacks and the rules your contracts are checked against. Run the check from the contract editor.')}</Text>
        </div>
        <div className="flex items-center gap-g8">
          <Button variant="outline" size="icon-md" type="button" onClick={() => void refreshAll()} loading={list.isFetching} aria-label={t('approval.refresh', 'Refresh')}><RefreshCw className="size-g16" aria-hidden /></Button>
          {canImport && <Button variant="outline" type="button" onClick={() => setImportOpen(true)}><Download className="size-g16" aria-hidden /><span>{t('clauses.starter.title', 'Import starter clauses')}</span></Button>}
          {canEdit && <Button type="button" onClick={() => setDialog({ clause: null })}><Plus className="size-g16" aria-hidden /><span>{t('clauses.add', 'Add clause')}</span></Button>}
        </div>
      </div>

      <Card className="p-g13">
        <div className="flex w-full flex-wrap items-center gap-g13">
          <div className="relative min-w-g233 flex-1">
            <Search className="absolute left-g13 top-1/2 h-g16 w-g16 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" value={list.searchInput} onChange={(e) => list.setSearch(e.target.value)} className="w-full pl-g34 pr-g13"
              aria-label={t('clauses.search_label', 'Search clauses')} placeholder={t('clauses.search_placeholder', 'Search title, wording or tags…')} />
          </div>
          <NativeSelect aria-label={t('clauses.filter.category', 'Category')} value={list.state.filters.category ?? 'ALL'} onChange={(e) => list.setFilter('category', e.target.value)} controlProps={{ className: 'min-w-g144 flex-1' }}>
            <option value="ALL">{t('clauses.filter.category_all', 'All categories')}</option>
            {(facets.data?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </NativeSelect>
          <NativeSelect aria-label={t('clauses.filter.risk', 'Risk')} value={list.state.filters.risk ?? 'ALL'} onChange={(e) => list.setFilter('risk', e.target.value)} controlProps={{ className: 'min-w-g144 flex-1' }}>
            <option value="ALL">{t('clauses.filter.risk_all', 'All risk levels')}</option>
            {RISK_LEVELS.map((r) => <option key={r} value={r}>{t(...RISK_KEYS[r])}</option>)}
          </NativeSelect>
          <NativeSelect aria-label={t('clauses.filter.language', 'Language')} value={list.state.filters.language ?? 'ALL'} onChange={(e) => list.setFilter('language', e.target.value)} controlProps={{ className: 'min-w-g144 flex-1' }}>
            <option value="ALL">{t('clauses.filter.language_all', 'All languages')}</option>
            {['en', 'id', 'zh'].map((l) => <option key={l} value={l}>{t(...LANGUAGE_KEYS[l])}</option>)}
          </NativeSelect>
          <NativeSelect aria-label={t('clauses.filter.status', 'Status')} value={list.state.filters.status ?? 'ALL'} onChange={(e) => list.setFilter('status', e.target.value)} controlProps={{ className: 'min-w-g144 flex-1' }}>
            <option value="ALL">{t('clauses.status.active', 'Active')}</option>
            <option value="archived">{t('clauses.status.archived', 'Archived')}</option>
            <option value="all">{t('clauses.status.all', 'Active and archived')}</option>
          </NativeSelect>
        </div>
      </Card>

      <Card asChild><section className="overflow-hidden" aria-busy={list.isFetching} aria-live="polite" aria-label={t('clauses.list_label', 'Clause list')}>
        {list.isLoading && (
          <div className="divide-y divide-border" role="status">
            <span className="sr-only">{t('common.loading', 'Loading…')}</span>
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="flex h-g42 items-center gap-g13 px-g13"><Skeleton className="h-g13 w-1/3" /><Skeleton className="h-g13 w-g68" /><Skeleton className="ms-auto h-g13 w-g89" /></div>)}
          </div>
        )}
        {list.error && (
          <div role="alert" className="space-y-g13 p-g34 text-center">
            <Text size="sm" weight="semibold" tone="destructive">{t('clauses.load_failed', 'Could not load the clause library.')}</Text>
            <Button variant="ghost" type="button" onClick={() => void list.refetch()}><RefreshCw className="h-g13 w-g13" aria-hidden />{t('common.retry', 'Retry')}</Button>
          </div>
        )}
        {emptyLibrary && (
          <div className="flex flex-col items-center gap-g13 p-g34 text-center" data-testid="clauses-empty">
            <BookMarked className="size-g34 text-muted-foreground" aria-hidden />
            <Text size="sm" weight="semibold">{t('clauses.empty_library', 'Your clause library is empty.')}</Text>
            <Text size="sm" tone="muted" className="max-w-prose">{t('clauses.empty_hint', 'Start with the starter set (common clauses with wording, fallbacks and rules) or add your own clauses.')}</Text>
            <div className="flex gap-g8">
              {canImport && <Button type="button" onClick={() => setImportOpen(true)}><Download aria-hidden />{t('clauses.starter.title', 'Import starter clauses')}</Button>}
              {canEdit && <Button type="button" variant="outline" onClick={() => setDialog({ clause: null })}><Plus aria-hidden />{t('clauses.add', 'Add clause')}</Button>}
            </div>
          </div>
        )}
        {!list.isLoading && !list.error && !emptyLibrary && (
          <>
            <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.scroll_table')}>
              <Table>
                <caption className="sr-only">{t('clauses.title', 'Clause library & playbook')}</caption>
                <TableHeader>
                  <TableRow>
                    {sortHeader('title', t('clauses.field.title', 'Title'))}
                    {sortHeader('category', t('clauses.field.category', 'Category'), 'hidden md:table-cell')}
                    {sortHeader('risk_level', t('clauses.field.risk', 'Risk level'))}
                    <TableColumnHeader scope="col" className="hidden lg:table-cell">{t('clauses.col.tags', 'Language, jurisdiction, tags')}</TableColumnHeader>
                    {sortHeader('updated_at', t('clauses.col.updated', 'Updated'), 'hidden xl:table-cell')}
                    <TableColumnHeader scope="col" className="w-g89 text-right">{t('approval.col.action', 'Action')}</TableColumnHeader>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.items.length === 0 ? (
                    <TableEmptyState colSpan={6} message={t('clauses.empty', 'No clauses match.')} />
                  ) : list.items.map((c) => (
                    <TableRow key={c.id} data-testid="clause-row">
                      <TableCell className="max-w-g377">
                        <Button variant="link" className="block h-auto min-w-0 max-w-full truncate p-0 text-start text-sm font-semibold" onClick={() => setDialog({ clause: c })}>{c.title}</Button>
                        <Text size="xs" tone="muted" className="truncate">
                          {c.rules.required ? t('clauses.required_badge', 'Required') : t('clauses.optional_badge', 'Optional')}
                          {c.fallback_texts.length ? ` · ${t('clauses.fallback_count', '{n} fallback(s)', { n: c.fallback_texts.length })}` : ''}
                          {c.status === 'archived' ? ` · ${t('clauses.status.archived', 'Archived')}` : ''}
                        </Text>
                      </TableCell>
                      <TableCell className="hidden md:table-cell"><Text size="sm" className="truncate">{c.category || '—'}</Text></TableCell>
                      <TableCell className="whitespace-nowrap"><RiskBadge t={t} risk={c.risk_level} /></TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <div className="flex flex-wrap gap-g3">
                          {c.language && <Badge tone="neutral">{t(...LANGUAGE_KEYS[c.language])}</Badge>}
                          {c.jurisdiction && <Badge tone="neutral">{c.jurisdiction}</Badge>}
                          {c.tags.slice(0, 3).map((tag) => <Badge key={tag} tone="info">{tag}</Badge>)}
                        </div>
                      </TableCell>
                      <TableCell className="hidden xl:table-cell"><Text size="sm" className="whitespace-nowrap">{c.updated_at.slice(0, 10)}</Text></TableCell>
                      <TableCell className="w-g89 text-right"><div className="flex items-center justify-end"><ActionMenu title={`${t('approval.col.action', 'Action')}: ${c.title}`} items={actions(c)} /></div></TableCell>
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

      {dialog && <ClauseDialog clause={dialog.clause} readOnly={!canEdit} onClose={() => setDialog(null)}
        onSaved={() => { setDialog(null); showAlert({ title: t('clauses.saved', 'Clause saved'), variant: 'success' }); void refreshAll(); }} />}
      {importOpen && <StarterImportDialog onClose={() => setImportOpen(false)}
        onImported={(created, skipped) => {
          setImportOpen(false);
          showAlert({ title: t('clauses.starter.done', '{n} clause(s) imported', { n: created }), description: skipped ? t('clauses.starter.skipped', '{n} were already in your library.', { n: skipped }) : undefined, variant: 'success' });
          void refreshAll();
        }} />}
    </section>
  );
};
