import { useDocumentList } from '../../features/documents/useDocumentList';
import { TableViewMenu } from '../ui/table-view-menu';
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
import { INPUT_CLASS, statusBadgeClass, statusLabel, typeBadgeClass, typeLabel } from './documentLabels';

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
    if (value.trim()) runAction(() => documentsApi.update(id, { name: value.trim() }), t('documents.msg.renamed', 'Nama dokumen diperbarui'));
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
    if (ok) runAction(() => documentsApi.remove(doc.id), t('documents.msg.deleted', 'Dokumen dihapus'));
  };

  const rowActions = (doc: DocumentSummary): ActionMenuItem[] => {
    const archived = doc.status === 'archived';
    return [
      { label: t('documents.action.open', 'Buka'), icon: <FolderInput className="w-3.5 h-3.5" />, onClick: () => onOpen(doc.id) },
      ...(canEdit
        ? [
            {
              label: t('documents.action.rename', 'Ganti nama'),
              icon: <Pencil className="w-3.5 h-3.5" />,
              onClick: () => setRenaming({ id: doc.id, value: doc.name }),
            },
            {
              label: archived ? t('documents.action.unarchive', 'Keluarkan dari arsip') : t('documents.action.archive', 'Arsipkan'),
              icon: archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />,
              onClick: () => toggleArchive(doc),
            },
          ]
        : []),
      ...(canDelete
        ? [
            {
              label: t('documents.action.delete', 'Hapus'),
              icon: <Trash2 className="w-3.5 h-3.5" />,
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

  const sortHeader = (sortKey: DocumentSortKey, label: string, className = 'p-4') => {
    const active = sort.key === sortKey;
    return (
      <th
        key={sortKey}
        scope="col"
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={`${className} text-xs font-bold text-ink text-left select-none align-middle`}
      >
        <button
          type="button"
          onClick={() => toggleSort(sortKey)}
          className="flex items-center gap-1.5 hover:text-ink dark:hover:text-white transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none rounded-sm py-0.5"
        >
          <span>{label}</span>
          {active ? (
            sort.dir === 'asc' ? (
              <ArrowUp className="w-3.5 h-3.5 text-accent-text shrink-0" aria-hidden />
            ) : (
              <ArrowDown className="w-3.5 h-3.5 text-accent-text shrink-0" aria-hidden />
            )
          ) : (
            <ArrowUpDown className="w-3.5 h-3.5 text-ink-soft shrink-0" aria-hidden />
          )}
        </button>
      </th>
    );
  };

  return (
    <section className="w-full min-w-0 bg-transparent" aria-labelledby="document-explorer-heading">
      <div className="w-full space-y-6">
        <div className="ds-page-bar">
          <div>
            <h2 id="document-explorer-heading" ref={headingRef} tabIndex={-1} className="ds-page-heading">
              {t('documents.explorer.title', 'Dokumen Saya')}
            </h2>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={onCreate}
              className="ui-button ui-button-lg mobile-page-action inline-flex w-fit items-center cursor-pointer ds-button ds-button-lg ds-button-default"
            >
              <FilePlus2 className="w-4 h-4" aria-hidden />
              <span>{t('documents.explorer.new', 'Dokumen Baru')}</span>
            </button>
          )}
        </div>

        <div className="ds-panel p-4 sm:p-5">
          <div className="mobile-filter-grid flex flex-wrap items-center gap-2.5 w-full ds-grid">
            <div className="relative flex-1 min-w-[200px] sm:min-w-[240px]">
              <Search className="w-4 h-4 text-ink-soft absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
              <label htmlFor="document-search" className="sr-only">
                {t('documents.explorer.search_label', 'Search Document')}
              </label>
              <input
                id="document-search"
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t('documents.explorer.search_placeholder', 'Search Documents…')}
                className="ds-input w-full pl-9 pr-3"
              />
            </div>
            <label htmlFor="document-status-filter" className="sr-only">
              {t('documents.filter.status_label', 'Document Status')}
            </label>
            <AlphabeticalSelect
              id="document-status-filter"
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value)}
              className="ds-input min-w-[130px] flex-1 cursor-pointer"
            >
              <option value="">{t('documents.filter.status_active', 'Semua status aktif')}</option>
              {DOCUMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(t, s)}
                </option>
              ))}
              <option value="all">{t('documents.filter.status_all', 'Semua (termasuk arsip)')}</option>
            </AlphabeticalSelect>

            <label htmlFor="document-type-filter" className="sr-only">
              {t('documents.filter.type_label', 'Document Type')}
            </label>
            <AlphabeticalSelect
              id="document-type-filter"
              value={filters.type}
              onChange={(e) => updateFilter('type', e.target.value)}
              className="ds-input min-w-[130px] flex-1 cursor-pointer"
            >
              <option value="">{t('documents.filter.type_all', 'All Document Types')}</option>
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {typeLabel(t, type)}
                </option>
              ))}
            </AlphabeticalSelect>

            <label htmlFor="document-creator-filter" className="sr-only">
              {t('documents.filter.created_by_label', 'Created By')}
            </label>
            <AlphabeticalSelect
              id="document-creator-filter"
              value={filters.created_by}
              onChange={(e) => updateFilter('created_by', e.target.value)}
              className="ds-input min-w-[130px] flex-1 cursor-pointer"
            >
              <option value="">{t('documents.filter.created_by_all', 'All Creators')}</option>
              {(data?.creators ?? []).map((creator) => (
                <option key={creator.id} value={creator.id}>
                  {creator.name || creator.id}
                </option>
              ))}
            </AlphabeticalSelect>

            <TableViewMenu label={t('documents.filter.view', 'View')}>
              <div className="mb-1 border-b border-hairline px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-ink-soft">
                {t('documents.filter.toggle_columns', 'Toggle Columns')}
              </div>
              {([
                ['type', t('documents.field.type', 'Type')],
                ['status', t('documents.field.status', 'Status')],
                ['created', t('documents.field.created', 'Created')],
                ['modified', t('documents.field.modified', 'Modified')],
                ['createdBy', t('documents.field.created_by', 'Created by')],
                ['size', t('documents.field.size', 'Size')],
              ] as const).map(([column, label]) => (
                <label key={column} className="flex cursor-pointer items-center gap-2.5 px-3.5 py-2 text-xs font-semibold text-ink hover:bg-surface dark:hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={visibleColumns[column]}
                    onChange={() => toggleColumnVisibility(column)}
                    className="rounded-sm border-hairline text-accent-text focus:ring-accent"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </TableViewMenu>
          </div>
        </div>

        <section
          className="ds-table-surface bg-surface border border-hairline rounded-2xl shadow-sm overflow-hidden"
          aria-busy={isFetching}
          aria-live="polite"
        >
          {state.status === 'loading' && (
            <div className="divide-y divide-hairline" role="status">
              <span className="sr-only">{t('common.loading', 'Memuat…')}</span>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-14 px-3 flex items-center gap-3 animate-pulse motion-reduce:animate-none">
                  <div className="h-3 w-1/3 rounded-sm bg-surface-2" />
                  <div className="h-3 w-16 rounded-sm bg-surface-2" />
                  <div className="h-3 w-20 rounded-sm bg-surface-2 ml-auto" />
                </div>
              ))}
            </div>
          )}

          {state.status === 'error' && (
            <div role="alert" className="p-8 text-center space-y-3">
              <p className="text-sm font-semibold text-status-danger">
                {t('documents.explorer.load_failed', 'Gagal memuat daftar dokumen.')}
              </p>
              <p className="text-xs text-ink-soft">{state.message}</p>
              <button
                type="button"
                onClick={reload}
                className="inline-flex items-center gap-1.5 px-4 min-h-10 rounded-md bg-ink text-white text-sm font-semibold cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden />
                {t('common.retry', 'Coba lagi')}
              </button>
            </div>
          )}

          {data && (
            <>
              <div className="relative overflow-x-auto bg-surface">
                <table className="ds-table app-data-table document-data-table w-full text-left border-collapse text-xs bg-surface">
                  <caption className="sr-only">{t('documents.explorer.title', 'Dokumen Saya')}</caption>
                  <thead className="bg-surface dark:bg-surface-2/50">
                    <tr className="bg-surface dark:bg-surface-2/50 border-b border-hairline text-xs font-bold text-ink h-12">
                      {sortHeader('name', t('documents.field.name', 'Nama'), 'pl-6 pr-4 py-4')}
                      {visibleColumns.type && sortHeader('type', t('documents.field.type', 'Jenis'), 'p-4 hidden md:table-cell')}
                      {visibleColumns.status && sortHeader('status', t('documents.field.status', 'Status'))}
                      {visibleColumns.created && sortHeader('created_at', t('documents.field.created', 'Dibuat'), 'p-4 hidden lg:table-cell')}
                      {visibleColumns.modified && sortHeader('modified_at', t('documents.field.modified', 'Diubah'))}
                      {visibleColumns.createdBy && sortHeader('created_by', t('documents.field.created_by', 'Dibuat oleh'), 'p-4 hidden md:table-cell')}
                      {visibleColumns.size && sortHeader('file_size', t('documents.field.size', 'Ukuran'), 'p-4 hidden lg:table-cell')}
                      <th scope="col" className="pl-2 pr-6 py-4 text-right w-20 text-xs font-bold text-ink align-middle">
                        <div className="flex items-center justify-end">{t('documents.field.actions', 'Aksi')}</div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {data.documents.length === 0 ? (
                      <TableEmptyState
                        colSpan={Object.values(visibleColumns).filter(Boolean).length + 2}
                        message={t('documents.explorer.empty', 'Belum ada dokumen tersimpan.')}
                      />
                    ) : data.documents.map((doc) => (
                      <tr key={doc.id} className="hover:bg-surface dark:hover:bg-surface-2/50 transition-colors">
                        <td className="pl-6 pr-4 py-4 text-xs text-left align-middle max-w-[320px]">
                          {renaming?.id === doc.id ? (
                            <input
                              autoFocus
                              aria-label={t('documents.action.rename', 'Ganti nama')}
                              value={renaming.value}
                              onChange={(e) => setRenaming({ id: doc.id, value: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') submitRename();
                                if (e.key === 'Escape') setRenaming(null);
                              }}
                              onBlur={submitRename}
                              className={INPUT_CLASS}
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => onOpen(doc.id)}
                              className="font-semibold text-left text-ink hover:text-accent-text truncate block max-w-full cursor-pointer transition-colors"
                              title={doc.name}
                            >
                              {doc.name}
                            </button>
                          )}
                          <span className="text-xs text-ink-soft">v{doc.current_version}</span>
                        </td>
                        {visibleColumns.type && <td className="py-4 px-4 text-xs text-left align-middle hidden md:table-cell">
                          <span className={typeBadgeClass(doc.type)}>{typeLabel(t, doc.type)}</span>
                        </td>}
                        {visibleColumns.status && <td className="py-4 px-4 text-xs text-left align-middle">
                          <span className={statusBadgeClass(doc.status)}>{statusLabel(t, doc.status)}</span>
                        </td>}
                        {visibleColumns.created && <td className="py-4 px-4 text-xs font-normal text-ink text-left align-middle whitespace-nowrap hidden lg:table-cell">
                          <RelativeTime iso={doc.created_at} />
                        </td>}
                        {visibleColumns.modified && <td className="py-4 px-4 text-xs font-normal text-ink text-left align-middle whitespace-nowrap">
                          <RelativeTime iso={doc.modified_at} />
                        </td>}
                        {visibleColumns.createdBy && <td className="py-4 px-4 text-xs font-normal text-ink text-left align-middle hidden md:table-cell">
                          {doc.created_by_name || '—'}
                        </td>}
                        {visibleColumns.size && <td className="py-4 px-4 text-xs font-normal text-ink text-left align-middle whitespace-nowrap hidden lg:table-cell">
                          {formatBytes(doc.file_size)}
                        </td>}
                        <td className="pl-2 pr-6 py-4 text-right align-middle w-20">
                          <div className="flex items-center justify-end">
                            <ActionMenu items={rowActions(doc)} title={`${t('documents.field.actions', 'Aksi')}: ${doc.name}`} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {data.total > 0 && <TablePagination
                currentPage={data.page}
                totalPages={totalPages}
                rowsPerPage={limit}
                rowsPerPageOptions={[...PAGE_SIZES]}
                onPageChange={setPage}
                onRowsPerPageChange={(size) => {
                  setLimit(size);
                  setPage(1);
                }}
              />}
            </>
          )}
        </section>
      </div>
    </section>
  );
};
