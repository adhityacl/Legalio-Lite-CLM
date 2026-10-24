import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Clock, FolderInput, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { APPROVAL_CATEGORIES, type ApprovalBox, type ApprovalSummary } from '@legalio/types/approvals';
import { PAGE_SIZES } from '@legalio/types/documents';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { Input } from '@legalio/ui-components/input';
import { Text } from '@legalio/ui-components/text';
import { Badge } from '@legalio/ui-components/badge';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Table, TableBody, TableCell, TableColumnHeader, TableHeader, TableRow, TableScrollArea } from '@legalio/ui-components/table';
import { useLanguage } from '../../context/LanguageContext';
import { useTenant } from '../../context/TenantContext';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { AlphabeticalSelect } from '../../components/ui/alphabetical-select';
import { TableEmptyState } from '../../components/ui/table-empty-state';
import { TablePagination } from '../../components/ui/TablePagination';
import { ActionMenu, type ActionMenuItem } from '../../components/ui/action-menu';
import { RelativeTime } from '../../components/documents/RelativeTime';
import { approvalsApi } from './approvalsApi';
import { ApprovalNotifications } from './ApprovalNotifications';
import { PersonAvatar, StatusBadge, categoryLabel, categoryTone, slaLeft } from './approvalUi';

interface Props {
  onOpen: (id: string) => void;
  onCreate: () => void;
}

type SortKey = 'title' | 'created_by_name' | 'category' | 'created_at' | 'due_at';

export const ApprovalInbox: React.FC<Props> = ({ onOpen, onCreate }) => {
  const { t } = useLanguage();
  const { activeTenantId } = useTenant();
  const { user } = useAuth();
  const confirmDialog = useConfirm();
  const showAlert = useAlertToast();
  const queryClient = useQueryClient();
  const [box, setBox] = useState<ApprovalBox>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'due_at', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<number>(PAGE_SIZES[1]);

  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const params = { box, search, category };
  const { data, isFetching, isLoading, error, refetch } = useQuery({
    queryKey: ['approvals', activeTenantId, params],
    queryFn: () => approvalsApi.list(params),
    enabled: Boolean(activeTenantId),
  });

  // shortcut: sorting and paging run on the client over the server's 200-row cap; move both server-side if inboxes grow past that.
  const sorted = [...(data?.items ?? [])].sort((a, b) => {
    const cmp = String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? ''), undefined, { sensitivity: 'base' });
    return sort.dir === 'asc' ? cmp : -cmp;
  });
  const totalPages = Math.max(1, Math.ceil(sorted.length / limit));
  const rows = sorted.slice((page - 1) * limit, page * limit);

  const stats = data?.stats;
  const statCards = [
    { icon: Clock, tone: 'bg-status-warning-soft text-status-warning', value: stats?.waiting, label: t('approval.stats.waiting', 'Waiting for decision') },
    { icon: AlertTriangle, tone: 'bg-status-danger-soft text-status-danger', value: stats?.near_sla, label: t('approval.stats.near_sla', 'Near SLA') },
    { icon: CheckCircle2, tone: 'bg-status-success-soft text-status-success', value: stats?.done_this_month, label: t('approval.stats.done_month', 'Decided this month') },
  ];

  const sortHeader = (key: SortKey, label: string, className = '') => {
    const active = sort.key === key;
    return (
      <TableColumnHeader key={key} scope="col" className={className || undefined}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <Button variant="ghost" size="sm" type="button" className="-ms-g13 font-semibold text-muted-foreground"
          onClick={() => setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))}>
          <span>{label}</span>
          {active
            ? (sort.dir === 'asc' ? <ArrowUp className="h-g13 w-g13 shrink-0 text-accent-foreground" aria-hidden /> : <ArrowDown className="h-g13 w-g13 shrink-0 text-accent-foreground" aria-hidden />)
            : <ArrowUpDown className="h-g13 w-g13 shrink-0 text-muted-foreground" aria-hidden />}
        </Button>
      </TableColumnHeader>
    );
  };

  const deleteApproval = async (item: ApprovalSummary) => {
    const ok = await confirmDialog({
      description: t('approval.confirm_delete', 'Delete "{title}" and its approval history? This cannot be undone.', { title: item.title }),
      tone: 'danger',
      confirmLabel: t('contract_creator.confirm.delete_label', 'Hapus'),
    });
    if (!ok) return;
    try {
      await approvalsApi.remove(item.id);
      showAlert({ title: t('approval.deleted', 'Approval deleted'), variant: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['approvals'] });
    } catch (err) {
      showAlert({ title: t('documents.msg.action_failed', 'Aksi gagal'), description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  };

  const rowActions = (item: ApprovalSummary): ActionMenuItem[] => [
    { label: t('approval.detail.open', 'Open'), icon: <FolderInput className="h-g13 w-g13" />, onClick: () => onOpen(item.id) },
    ...(item.created_by === user?.id
      ? [{ label: t('documents.action.delete', 'Hapus'), icon: <Trash2 className="h-g13 w-g13" />, onClick: () => deleteApproval(item), variant: 'danger' as const, dividerBefore: true }]
      : []),
  ];

  const slaCell = (item: ApprovalSummary) => {
    if (item.status !== 'pending') return <StatusBadge t={t} status={item.status} />;
    const sla = slaLeft(t, item.due_at);
    return <Badge tone={sla.near ? 'danger' : 'warning'}>{sla.text}</Badge>;
  };

  return (
    <section className="w-full min-w-0 bg-transparent" aria-labelledby="approval-inbox-heading">
      <div className="w-full space-y-g21">
        <div className="flex flex-wrap items-center justify-between gap-g13">
          <Heading as="h2" size="md" weight="semibold" id="approval-inbox-heading">{t('nav.document_approval', 'My Approval')}</Heading>
          <div className="flex items-center gap-g8">
            <Button variant="outline" size="icon-md" type="button" onClick={() => refetch()} loading={isFetching} aria-label={t('approval.refresh', 'Refresh')}>
              <RefreshCw className="size-g16" aria-hidden />
            </Button>
            <Button type="button" onClick={onCreate}>
              <Plus className="size-g16" aria-hidden />
              <span>{t('approval.new', 'Submit approval')}</span>
            </Button>
          </div>
        </div>

        <ApprovalNotifications onOpen={onOpen} />

        <div className="grid grid-cols-1 gap-g13 sm:grid-cols-3">
          {statCards.map(({ icon: Icon, tone, value, label }) => (
            <Card key={label} className="flex flex-row items-center gap-g13 p-g13">
              <span className={`flex size-g34 shrink-0 items-center justify-center rounded-md ${tone}`}><Icon className="size-g16" aria-hidden /></span>
              <div>
                <Text size="lg" weight="semibold">{value ?? '–'}</Text>
                <Text size="xs" tone="muted">{label}</Text>
              </div>
            </Card>
          ))}
        </div>

        <Card className="p-g13">
          <div className="flex w-full flex-wrap items-center gap-g13">
            <div className="relative min-w-g233 flex-1 sm:min-w-g233">
              <Search className="absolute left-g13 top-1/2 h-g16 w-g16 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input type="search" id="approval-search" value={searchInput} onChange={e => setSearchInput(e.target.value)} className="w-full pl-g34 pr-g13"
                aria-label={t('approval.search_label', 'Search approvals')} placeholder={t('approval.search_placeholder', 'Search document or requester…')} />
            </div>
            <AlphabeticalSelect aria-label={t('approval.box_label', 'Show')} id="approval-box-filter" value={box}
              onChange={e => { setBox(e.target.value as ApprovalBox); setPage(1); }}
              className="w-full" controlProps={{ className: 'min-w-g144 flex-1' }}>
              <option value="all">{t('approval.box.all', 'Received and submitted')}</option>
              <option value="inbox">{t('approval.box.inbox', 'Waiting for me')}</option>
              <option value="mine">{t('approval.box.mine', 'Submitted by me')}</option>
            </AlphabeticalSelect>
            <AlphabeticalSelect aria-label={t('documents.filter.type_label', 'Document Type')} id="approval-category-filter" value={category}
              onChange={e => { setCategory(e.target.value); setPage(1); }}
              className="w-full" controlProps={{ className: 'min-w-g144 flex-1' }}>
              <option value="all">{t('documents.filter.type_all', 'All Document Types')}</option>
              {APPROVAL_CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel(t, c)}</option>)}
            </AlphabeticalSelect>
          </div>
        </Card>

        <Card asChild><section className="overflow-hidden" aria-busy={isFetching} aria-live="polite">
          {isLoading && (
            <div className="divide-y divide-border" role="status">
              <span className="sr-only">{t('common.loading', 'Memuat…')}</span>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex h-g42 items-center gap-g13 px-g13">
                  <Skeleton className="h-g13 w-1/3" />
                  <Skeleton className="h-g13 w-g68" />
                  <Skeleton className="ms-auto h-g13 w-g89" />
                </div>
              ))}
            </div>
          )}

          {error && (
            <div role="alert" className="space-y-g13 p-g34 text-center">
              <Text size="sm" weight="semibold" tone="destructive">{t('approval.load_failed', 'Could not load approvals.')}</Text>
              <Text size="xs" tone="muted">{(error as Error).message}</Text>
              <Button variant="ghost" type="button" onClick={() => refetch()}>
                <RefreshCw className="h-g13 w-g13" aria-hidden />
                {t('common.retry', 'Coba lagi')}
              </Button>
            </div>
          )}

          {data && (
            <>
              <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.scroll_table')}>
                <Table>
                  <caption className="sr-only">{t('nav.document_approval', 'My Approval')}</caption>
                  <TableHeader>
                    <TableRow>
                      {sortHeader('title', t('approval.col.document', 'Document'))}
                      {sortHeader('created_by_name', t('approval.col.requester', 'Requester'), 'hidden md:table-cell')}
                      {sortHeader('category', t('documents.field.type', 'Type'), 'hidden md:table-cell')}
                      {sortHeader('created_at', t('approval.col.submitted', 'Submitted'), 'hidden lg:table-cell')}
                      {sortHeader('due_at', t('approval.col.sla', 'SLA left'))}
                      <TableColumnHeader scope="col" className="w-g89 text-right">
                        <div className="flex items-center justify-end">{t('approval.col.action', 'Action')}</div>
                      </TableColumnHeader>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableEmptyState colSpan={6}
                        message={box === 'inbox' ? t('approval.empty_inbox', 'Nothing is waiting for you.') : t('approval.empty', 'No approvals found.')} />
                    ) : rows.map(item => (
                      <TableRow key={item.id}>
                        <TableCell className="max-w-g377">
                          <Text size="sm" weight="semibold" className="truncate">{item.title}</Text>
                          <Tooltip><TooltipTrigger asChild>
                            <Button variant="link" size="sm" className="block h-auto min-w-0 max-w-full truncate p-0 text-start text-xs font-normal text-muted-foreground no-underline hover:underline" onClick={() => onOpen(item.id)}>
                              {item.code}
                            </Button>
                          </TooltipTrigger><TooltipBody>{item.code}</TooltipBody></Tooltip>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <div className="flex items-center gap-g8"><PersonAvatar name={item.created_by_name} /><span>{item.created_by_name || '—'}</span></div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell"><Badge tone={categoryTone(item.category)}>{categoryLabel(t, item.category)}</Badge></TableCell>
                        <TableCell className="hidden whitespace-nowrap lg:table-cell"><RelativeTime iso={item.created_at} /></TableCell>
                        <TableCell className="whitespace-nowrap">{slaCell(item)}</TableCell>
                        <TableCell className="w-g89 text-right">
                          <div className="flex items-center justify-end">
                            <ActionMenu title={`${t('approval.col.action', 'Action')}: ${item.title}`} items={rowActions(item)} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableScrollArea>

              <TablePagination currentPage={page} totalPages={totalPages} rowsPerPage={limit} rowsPerPageOptions={[...PAGE_SIZES]}
                onPageChange={setPage} onRowsPerPageChange={size => { setLimit(size); setPage(1); }} />
            </>
          )}
        </section></Card>
      </div>
    </section>
  );
};
