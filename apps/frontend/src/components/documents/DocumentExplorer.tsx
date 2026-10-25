import { Badge } from '@legalio/ui-components/badge';
import { useDocumentList } from '../../features/documents/useDocumentList';
import { TableViewMenu, TableViewOption } from '../ui/table-view-menu';
import { AlphabeticalSelect } from '../ui/alphabetical-select';
import { TableEmptyState } from '../ui/table-empty-state';
import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  FilePlus2,
  FileText,
  FolderInput,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { documentsApi, errorMessage } from '../../lib/documentsApi';
import {
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  PAGE_SIZES,
  formatBytes,
  type DocumentListResponse,
  type DocumentSortKey,
  type DocumentSummary,
} from '@legalio/types/documents';
import { RelativeTime } from './RelativeTime';
import { ActionMenu, type ActionMenuItem } from '../ui/action-menu';
import { TablePagination } from '../ui/TablePagination';
import { statusBadgeTone, statusLabel, typeBadgeTone, typeLabel } from './documentLabels';

import { TableColumnHeader, Table, TableHeader, TableRow, TableBody, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { Button } from '@legalio/ui-components/button';
import { Input } from '@legalio/ui-components/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Text } from '@legalio/ui-components/text';
import { Skeleton } from '@legalio/ui-components/skeleton';
interface DocumentExplorerProps {
  canEdit: boolean;
  canDelete: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DocumentListResponse };

interface Filters {
  status: string;
  type: string;
  created_by: string;
}

const EMPTY_FILTERS: Filters = { status: '', type: '', created_by: '' };
const ASCENDING_FIRST: DocumentSortKey[] = ['name', 'type', 'status', 'created_by'];

export const DocumentExplorer: React.FC<DocumentExplorerProps> = ({ canEdit, canDelete, onOpen, onCreate }) => {
  const { t } = useLanguage();
  const confirmDialog = useConfirm();
  const showAlert = useAlertToast();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [visibleColumns, setVisibleColumns] = useState({
    type: true,
    status: true,
    created: false,
    modified: true,
    createdBy: true,
    size: false,
  });
  const [sort, setSort] = useState<{ key: DocumentSortKey; dir: 'asc' | 'desc' }>({ key: 'modified_at', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0]);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  const params: Record<string, string> = { page: String(page), limit: String(limit), sort_by: sort.key, sort_dir: sort.dir };
  if (search) params.search = search;
  for (const [key, value] of Object.entries(filters)) if (value) params[key] = value;
  const query = useDocumentList(params);
  const isFetching = query.isFetching;
  const state: LoadState = query.isError
    ? { status: 'error', message: errorMessage(query.error) }
    : query.data ? { status: 'ready', data: query.data } : { status: 'loading' };
  const reload = () => { void query.refetch(); };

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };
  const toggleColumnVisibility = (column: keyof typeof visibleColumns) => {
    setVisibleColumns((current) => ({ ...current, [column]: !current[column] }));
  };
  const toggleSort = (key: DocumentSortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: ASCENDING_FIRST.includes(key) ? 'asc' : 'desc' },
    );
    setPage(1);
  };

  const runAction = async (action: () => Promise<unknown>, successTitle: string) => {
    try {
      await action();
      showAlert({ title: successTitle, variant: 'success' });
      reload();
    } catch (err) {
      showAlert({ title: t('documents.msg.action_failed', 'Aksi gagal'), description: errorMessage(err), variant: 'destructive' });
    }
  };

  const submitRename = () => {
    if (!renaming) return;
    const { id, value } = renaming;
    setRenaming(null);
    if (value.trim()) void runAction(() => documentsApi.update(id, { name: value.trim() }), t('documents.msg.renamed', 'Nama dokumen diperbarui'));
  };

  const toggleArchive = (doc: DocumentSummary) =>
    runAction(
      () => documentsApi.update(doc.id, { status: doc.status === 'archived' ? 'draft' : 'archived' }),
      doc.status === 'archived' ? t('documents.msg.unarchived', 'Dokumen dikembalikan dari arsip') : t('documents.msg.archived', 'Dokumen diarsipkan'),
    );

  const deleteDocument = async (doc: DocumentSummary) => {
    const ok = await confirmDialog({
      description: t(
        'documents.confirm.delete',
        'Hapus "{name}" beserta seluruh versi, metadata, dan komentarnya? Tindakan ini tidak bisa dibatalkan.',
        { name: doc.name },
      ),
      tone: 'danger',
      confirmLabel: t('contract_creator.confirm.delete_label', 'Hapus'),
    });
    if (ok) void runAction(() => documentsApi.remove(doc.id), t('documents.msg.deleted', 'Dokumen dihapus'));
  };

  const rowActions = (doc: DocumentSummary): ActionMenuItem[] => {
    const archived = doc.status === 'archived';
    return [
      { label: t('documents.action.open', 'Buka'), icon: <FolderInput className="w-g13 h-g13" />, onClick: () => onOpen(doc.id) },
      ...(canEdit
        ? [
            {
              label: t('documents.action.rename', 'Ganti nama'),
              icon: <Pencil className="w-g13 h-g13" />,
              onClick: () => setRenaming({ id: doc.id, value: doc.name }),
            },
            {
              label: archived ? t('documents.action.unarchive', 'Keluarkan dari arsip') : t('documents.action.archive', 'Arsipkan'),
              icon: archived ? <ArchiveRestore className="w-g13 h-g13" /> : <Archive className="w-g13 h-g13" />,
              onClick: () => toggleArchive(doc),
            },
          ]
        : []),
      ...(canDelete
        ? [
            {
              label: t('documents.action.delete', 'Hapus'),
              icon: <Trash2 className="w-g13 h-g13" />,
              onClick: () => deleteDocument(doc),
              variant: 'danger' as const,
              dividerBefore: true,
            },
          ]
        : []),
    ];
  };

  const data = state.status === 'ready' ? state.data : null;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  const sortHeader = (sortKey: DocumentSortKey, label: string, className = '') => {
    const active = sort.key === sortKey;
    return (
      <TableColumnHeader
        key={sortKey}
        scope="col"
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={className || undefined}
      >
        <Button variant="ghost" size="sm" className="-ms-g13 font-semibold text-muted-foreground"
          type="button"
          onClick={() => toggleSort(sortKey)}
        >
          <span>{label}</span>
          {active ? (
            sort.dir === 'asc' ? (
              <ArrowUp className="w-g13 h-g13 text-accent-foreground shrink-0" aria-hidden />
            ) : (
              <ArrowDown className="w-g13 h-g13 text-accent-foreground shrink-0" aria-hidden />
            )
          ) : (
            <ArrowUpDown className="w-g13 h-g13 text-muted-foreground shrink-0" aria-hidden />
          )}
        </Button>
      </TableColumnHeader>
    );
  };

  return (
    <section className="w-full min-w-0 bg-transparent" aria-labelledby="document-explorer-heading">
      <div className="w-full space-y-g21">
        <div className="flex flex-wrap items-center justify-between gap-g13">
          <div>
            <Heading as="h2" size="md" weight="semibold" id="document-explorer-heading" ref={headingRef} tabIndex={-1} className="outline-none">
              {t('documents.explorer.title', 'Dokumen Saya')}
            </Heading>
          </div>
          {canEdit && (
            <Button
              type="button"
              onClick={onCreate}
                          >
              <FilePlus2 className="w-g16 h-g16" aria-hidden />
              <span>{t('documents.explorer.new', 'Dokumen Baru')}</span>
            </Button>
          )}
        </div>

        <Card className="p-g13">
          <div className="flex w-full flex-wrap items-center gap-g13">
            <InputGroup className="flex-1 min-w-g233 sm:min-w-g233">
              <InputGroupAddon><Search className="size-g16" aria-hidden="true" /></InputGroupAddon>
              <InputGroupInput aria-label={t('documents.explorer.search_label', 'Search Document')}
                id="document-search"
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t('documents.explorer.search_placeholder', 'Search Documents…')}
              />
            </InputGroup>
            <AlphabeticalSelect aria-label={t('documents.filter.status_label', 'Document Status')}
              id="document-status-filter"
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value)}
              className="w-full" controlProps={{ className: "min-w-g144 flex-1" }}
            >
              <option value="">{t('documents.filter.status_active', 'Semua status aktif')}</option>
              {DOCUMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(t, s)}
                </option>
              ))}
              <option value="all">{t('documents.filter.status_all', 'Semua (termasuk arsip)')}</option>
            </AlphabeticalSelect>

            <AlphabeticalSelect aria-label={t('documents.filter.type_label', 'Document Type')}
              id="document-type-filter"
              value={filters.type}
              onChange={(e) => updateFilter('type', e.target.value)}
              className="w-full" controlProps={{ className: "min-w-g144 flex-1" }}
            >
              <option value="">{t('documents.filter.type_all', 'All Document Types')}</option>
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {typeLabel(t, type)}
                </option>
              ))}
            </AlphabeticalSelect>

            <AlphabeticalSelect aria-label={t('documents.filter.created_by_label', 'Created By')}
              id="document-creator-filter"
              value={filters.created_by}
              onChange={(e) => updateFilter('created_by', e.target.value)}
              className="w-full" controlProps={{ className: "min-w-g144 flex-1" }}
            >
              <option value="">{t('documents.filter.created_by_all', 'All Creators')}</option>
              {(data?.creators ?? []).map((creator) => (
                <option key={creator.id} value={creator.id}>
                  {creator.name || creator.id}
                </option>
              ))}
            </AlphabeticalSelect>

            <TableViewMenu label={t('documents.filter.view', 'View')} heading={t('documents.filter.toggle_columns', 'Toggle Columns')}>
              {([
                ['type', t('documents.field.type', 'Type')],
                ['status', t('documents.field.status', 'Status')],
                ['created', t('documents.field.created', 'Created')],
                ['modified', t('documents.field.modified', 'Modified')],
                ['createdBy', t('documents.field.created_by', 'Created by')],
                ['size', t('documents.field.size', 'Size')],
              ] as const).map(([column, label]) => (
                <TableViewOption key={column} value={column} checked={visibleColumns[column]} onToggle={() => toggleColumnVisibility(column)}>{label}</TableViewOption>
              ))}
            </TableViewMenu>
          </div>
        </Card>

        <Card asChild><section
          className="overflow-hidden"
          aria-busy={isFetching}
          aria-live="polite"
        >
          {state.status === 'loading' && (
            <div className="divide-y divide-border" role="status">
              <span className="sr-only">{t('common.loading', 'Memuat…')}</span>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-g42 px-g13 flex items-center gap-g13">
                  <Skeleton className="h-g13 w-1/3" />
                  <Skeleton className="h-g13 w-g68" />
                  <Skeleton className="h-g13 w-g89 ms-auto" />
                </div>
              ))}
            </div>
          )}

          {state.status === 'error' && (
            <div role="alert" className="p-g34 text-center space-y-g13">
              <Text size="sm" weight="semibold" tone="destructive">
                {t('documents.explorer.load_failed', 'Gagal memuat daftar dokumen.')}
              </Text>
              <Text size="xs" tone="muted">{state.message}</Text>
              <Button variant="ghost"
                type="button"
                onClick={reload}
              >
                <RefreshCw className="w-g13 h-g13" aria-hidden />
                {t('common.retry', 'Coba lagi')}
              </Button>
            </div>
          )}

          {data && (
            <>
              <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.scroll_table')}>
                <Table>
                  <caption className="sr-only">{t('documents.explorer.title', 'Dokumen Saya')}</caption>
                  <TableHeader>
                    <TableRow>
                      {sortHeader('name', t('documents.field.name', 'Nama'), '')}
                      {visibleColumns.type && sortHeader('type', t('documents.field.type', 'Jenis'), 'hidden md:table-cell')}
                      {visibleColumns.status && sortHeader('status', t('documents.field.status', 'Status'))}
                      {visibleColumns.created && sortHeader('created_at', t('documents.field.created', 'Dibuat'), 'hidden lg:table-cell')}
                      {visibleColumns.modified && sortHeader('modified_at', t('documents.field.modified', 'Diubah'))}
                      {visibleColumns.createdBy && sortHeader('created_by', t('documents.field.created_by', 'Dibuat oleh'), 'hidden md:table-cell')}
                      {visibleColumns.size && sortHeader('file_size', t('documents.field.size', 'Ukuran'), 'hidden lg:table-cell')}
                      <TableColumnHeader scope="col" className="text-right w-g89">
                        <div className="flex items-center justify-end">{t('documents.field.actions', 'Aksi')}</div>
                      </TableColumnHeader>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.documents.length === 0 ? (
                      <TableEmptyState
                        colSpan={Object.values(visibleColumns).filter(Boolean).length + 2}
                        message={t('documents.explorer.empty', 'Belum ada dokumen tersimpan.')}
                      />
                    ) : data.documents.map((doc) => (
                      <TableRow key={doc.id}>
                        <TableCell className="max-w-g377">
                          <div className="flex items-center gap-g8">
                          {renaming?.id === doc.id ? (
                            <Input
                              autoFocus
                              aria-label={t('documents.action.rename', 'Ganti nama')}
                              value={renaming.value}
                              onChange={(e) => setRenaming({ id: doc.id, value: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') submitRename();
                                if (e.key === 'Escape') setRenaming(null);
                              }}
                              onBlur={submitRename}
                            />
                          ) : (
                            <Tooltip><TooltipTrigger asChild><Button variant="link" className="block h-auto min-w-0 truncate p-0 text-start text-foreground no-underline hover:underline" onClick={() => onOpen(doc.id)}>
                              {doc.name}
                            </Button></TooltipTrigger><TooltipBody>{doc.name}</TooltipBody></Tooltip>
                          )}
                          <Text as="span" size="xs" tone="muted" className="shrink-0">v{doc.current_version}</Text>
                          </div>
                        </TableCell>
                        {visibleColumns.type && <TableCell className="hidden md:table-cell">
                          <Badge tone={typeBadgeTone(doc.type)}>{typeLabel(t, doc.type)}</Badge>
                        </TableCell>}
                        {visibleColumns.status && <TableCell>
                          <Badge tone={statusBadgeTone(doc.status)}>{statusLabel(t, doc.status)}</Badge>
                        </TableCell>}
                        {visibleColumns.created && <TableCell className="whitespace-nowrap hidden lg:table-cell">
                          <RelativeTime iso={doc.created_at} />
                        </TableCell>}
                        {visibleColumns.modified && <TableCell className="whitespace-nowrap">
                          <RelativeTime iso={doc.modified_at} />
                        </TableCell>}
                        {visibleColumns.createdBy && <TableCell className="hidden md:table-cell">
                          {doc.created_by_name || '—'}
                        </TableCell>}
                        {visibleColumns.size && <TableCell className="whitespace-nowrap hidden lg:table-cell">
                          {formatBytes(doc.file_size)}
                        </TableCell>}
                        <TableCell className="text-right w-g89">
                          <div className="flex items-center justify-end">
                            <ActionMenu items={rowActions(doc)} title={`${t('documents.field.actions', 'Aksi')}: ${doc.name}`} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableScrollArea>

              <TablePagination
                currentPage={data.page}
                totalPages={totalPages}
                rowsPerPage={limit}
                rowsPerPageOptions={[...PAGE_SIZES]}
                onPageChange={setPage}
                onRowsPerPageChange={(size) => {
                  setLimit(size);
                  setPage(1);
                }}
              />
            </>
          )}
        </section></Card>
      </div>
    </section>
  );
};
