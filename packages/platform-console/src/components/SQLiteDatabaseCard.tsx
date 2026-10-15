import React, { useEffect, useState } from 'react';
import { Database, RefreshCw, Search, Sparkles, AlertCircle, Table as TableIcon, Copy, Download, ArrowUp, ArrowDown, ArrowUpDown, PanelRightClose, PanelRightOpen, KeyRound, Pencil, Save, X } from 'lucide-react';
import { Card } from '@legalio/ui-components/card';
import { Button } from '@legalio/ui-components/button';
import { Input } from '@legalio/ui-components/input';
import { Badge } from '@legalio/ui-components/badge';
import { Spinner } from '@legalio/ui-components/spinner';
import { cn } from '@legalio/ui-components/utils';
import { getAuthHeaders } from '../lib/apiFetch';
import { useLanguage } from '../context/LanguageContext';
import { TablePagination } from './ui/TablePagination';

interface SQLiteStatus {
  status: string;
  version: string;
  fileSizeBytes: number;
  tablesCount: number;
  totalRecords: number;
}
interface TableItem { name: string; count: number; columnsCount: number; }
interface TableColumn { name: string; type: string; notnull: number; dflt_value: unknown; pk: number; sortable: boolean; editable: boolean; editKind?: string; }
interface TableDataResponse {
  table: string;
  primaryKey: string | null;
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  total: number;
}
const cellText = (value: unknown): string => value == null ? 'NULL' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const prettyValue = (value: unknown) => {
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  return typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : cellText(value);
};
// Spreadsheet apps otherwise interpret exported text beginning with these characters as formulas.
const csvCell = (value: unknown) => {
  const text = value == null ? '' : cellText(value);
  return '"' + (typeof value === 'string' && /^[\s]*[=+@\-]/.test(text) ? "'" + text : text).replace(/"/g, '""') + '"';
};

export const SQLiteDatabaseCard: React.FC = () => {
  const { t } = useLanguage();
  const [status, setStatus] = useState<SQLiteStatus | null>(null);
  const [tables, setTables] = useState<TableItem[]>([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [tableData, setTableData] = useState<TableDataResponse | null>(null);
  const [tableSearch, setTableSearch] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState<{ column: string; direction: 'asc' | 'desc' }>({ column: '', direction: 'asc' });
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [selectedColumn, setSelectedColumn] = useState('');
  const [fieldSearch, setFieldSearch] = useState('');
  const [showDetails, setShowDetails] = useState(true);
  const [view, setView] = useState<'data' | 'structure'>('data');
  const [reload, setReload] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const cancelEdit = () => { setEditing(false); setDraft({}); setError(''); };


  useEffect(() => {
    const controller = new AbortController();
    setLoadingStatus(true);
    const options = { headers: getAuthHeaders(), credentials: 'include' as const, signal: controller.signal };
    Promise.all(['/status', '/tables'].map(async endpoint => {
      const response = await fetch('/api/auth-console/sqlite' + endpoint, options);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || t('sqlite.load_failed', 'Could not load database.'));
      return data;
    })).then(([info, list]) => {
      setStatus(info);
      setTables(list.tables);
      setSelectedTable(current => list.tables.some((table: TableItem) => table.name === current) ? current : list.tables.find((table: TableItem) => table.name === 'partners')?.name || list.tables[0]?.name || '');
    }).catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoadingStatus(false); });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (!selectedTable) return;
    const controller = new AbortController();
    setLoadingData(true);
    setError('');
    setTableData(null);
    setSelectedRow(null);
    setSelectedColumn('');
    const params = new URLSearchParams({ table: selectedTable, limit: String(limit), offset: String(offset), search: appliedSearch, sort: sort.column, direction: sort.direction });
    fetch(`/api/auth-console/sqlite/table-data?${params}`, { headers: getAuthHeaders(), credentials: 'include', signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || t('sqlite.load_failed', 'Could not load database.'));
        setTableData(data);
      }).catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoadingData(false); });
    return () => controller.abort();
  }, [selectedTable, offset, limit, appliedSearch, sort, reload]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const chooseTable = (name: string) => {
    setSelectedTable(name); setOffset(0); setSearch(''); setAppliedSearch('');
    setSort({ column: '', direction: 'asc' }); setFieldSearch(''); setView('data');
  };
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setNotice(t('sqlite.copied', 'Copied to clipboard')); }
    catch { setError(t('sqlite.copy_failed', 'Clipboard unavailable. Select and copy the value manually.')); }
  };
  const exportPage = () => {
    if (!tableData) return;
    const columns = tableData.columns.map(col => col.name);
    const csv = [columns.map(csvCell).join(','), ...tableData.rows.map(row => columns.map(column => csvCell(row[column])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = `${selectedTable}-page-${Math.floor(offset / limit) + 1}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const optimize = async () => {
    setOptimizing(true); setError('');
    try {
      const response = await fetch('/api/auth-console/sqlite/optimize', { method: 'POST', headers: getAuthHeaders(), credentials: 'include' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || t('sqlite.optimization_failed', 'Optimization failed'));
      setNotice(t('sqlite.database_optimized', 'Database optimized')); setReload(value => value + 1);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setOptimizing(false); }
  };
  const row = selectedRow === null ? null : tableData?.rows[selectedRow];
  const fields = tableData?.columns.filter(col => col.name.toLowerCase().includes(fieldSearch.toLowerCase())) || [];
  const visibleTables = tables.filter(table => table.name.toLowerCase().includes(tableSearch.toLowerCase()));
  const editable = Boolean(tableData?.columns.some(column => column.editable));
  const saveEdit = async () => {
    if (!row || !tableData?.primaryKey) return;
    setSaving(true); setError('');
    try {
      const changes: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(draft)) {
        const column = tableData.columns.find(item => item.name === name)!;
        if (value === null) changes[name] = null;
        else if (column.editKind === 'number' || column.editKind === 'boolean') {
          if (!value.trim() || !Number.isFinite(Number(value))) throw new Error(t('sqlite.number_required', 'Enter a valid number') + `: ${name}`);
          changes[name] = Number(value);
        } else changes[name] = value;
      }
      const response = await fetch('/api/auth-console/sqlite/table-data', {
        method: 'PATCH', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ table: selectedTable, key: row[tableData.primaryKey], original: row, changes }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || data.error || t('sqlite.save_failed', 'Could not save changes.'));
      setEditing(false); setDraft({}); setNotice(t('sqlite.saved', 'Changes saved')); setReload(value => value + 1);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSaving(false); }
  };
  const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  return (
    <div id="card-sqlite-database" className="min-w-0 space-y-g13">
      <Card id="sqlite-database-summary" className="flex flex-row flex-wrap items-center justify-between gap-g13 p-g13">
        <div className="flex flex-wrap items-center gap-g13">
          <Database className="size-g21 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold">{t('sqlite.sqlite_database', 'SQLite Database')}</h2>
          {status && <span className="text-xs text-muted-foreground">SQLite {status.version} · {formatSize(status.fileSizeBytes)} · {status.tablesCount} {t('sqlite.tables', 'Tables')} · {status.totalRecords.toLocaleString()} {t('sqlite.total_rows', 'Total Rows')}</span>}
        </div>
        <div className="flex items-center gap-g8">
          <Button type="button" variant="outline" disabled={loadingStatus || loadingData || editing} onClick={() => setReload(value => value + 1)}>
            {loadingStatus ? <Spinner size="sm" decorative /> : <RefreshCw aria-hidden="true" />}{t('sqlite.refresh', 'Refresh')}
          </Button>
          <Button type="button" variant="outline" disabled={optimizing || editing} onClick={optimize}>
            {optimizing ? <Spinner size="sm" decorative /> : <Sparkles aria-hidden="true" />}{t('sqlite.optimize', 'Optimize')}
          </Button>
        </div>
      </Card>
      {error && <div role="alert" className="flex items-center gap-g8 rounded-lg border border-destructive/30 bg-destructive/10 p-g13 text-sm text-destructive"><AlertCircle className="size-g16 shrink-0" />{error}</div>}
      <div role="status" aria-live="polite" className={notice ? 'text-sm text-primary' : 'sr-only'}>{notice}</div>
      <Card id="sqlite-database-tables" className="overflow-hidden">
        <div className="flex min-w-0 flex-col lg:flex-row">
          <fieldset disabled={editing} className="contents"><aside aria-label={t('sqlite.tables', 'Tables')} className="shrink-0 border-b border-border bg-muted/30 lg:w-52 lg:border-b-0 lg:border-r">
            <div className="space-y-g8 border-b border-border p-g13">
              <div className="flex justify-between text-xs font-semibold uppercase tracking-wide"><span>{t('sqlite.tables', 'Tables')}</span><span className="text-muted-foreground">{tables.length}</span></div>
              <Input aria-label={t('sqlite.search_tables', 'Find a table')} placeholder={t('sqlite.search_tables', 'Find a table')} value={tableSearch} onChange={e => setTableSearch(e.target.value)} />
            </div>
            <nav className="max-h-48 overflow-auto p-g5 lg:max-h-[65vh]" aria-label={t('sqlite.select_table', 'Select table')}>
              {visibleTables.map(table => <button key={table.name} type="button" onClick={() => chooseTable(table.name)} aria-label={table.name} aria-current={selectedTable === table.name ? 'true' : undefined}
                className={cn('flex min-h-9 w-full items-center gap-g8 rounded-md px-g8 py-g5 text-left text-xs transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary', selectedTable === table.name && 'bg-primary/10 font-semibold text-primary')}>
                <TableIcon className="size-g13 shrink-0" aria-hidden="true" /><span className="truncate font-mono" title={table.name}>{table.name}</span><span className="ml-auto tabular-nums text-muted-foreground">{table.count.toLocaleString()}</span>
              </button>)}
              {!visibleTables.length && <p className="p-g13 text-xs text-muted-foreground">{loadingStatus ? t('sqlite.loading', 'Loading...') : t('sqlite.no_tables', 'No tables found')}</p>}
            </nav>
          </aside>
          <section className="min-w-0 flex-1" aria-label={t('sqlite.records', 'Records')}>
            <div className="flex flex-wrap items-center justify-between gap-g8 border-b border-border p-g13">
              <div className="flex min-w-0 items-center gap-g8"><TableIcon className="size-g16 shrink-0 text-primary" aria-hidden="true" /><h3 className="truncate font-mono text-sm font-semibold">{selectedTable || '—'}</h3><Badge tone="neutral">{tableData?.total ?? '—'}</Badge>{tableData && <Badge id="sqlite-table-edit-status" tone={editable ? 'warning' : 'neutral'}>{editable ? t('sqlite.editable', 'Editable fields') : t('sqlite.read_only_table', 'Read-only table')}</Badge>}</div>
              <div className="flex items-center gap-g8">
                <Button type="button" variant="outline" onClick={exportPage} disabled={!tableData?.rows.length} aria-label={t('sqlite.export_page', 'Export page CSV')} title={t('sqlite.export_page', 'Export page CSV')}><Download aria-hidden="true" /></Button>
                <Button type="button" variant="outline" disabled={editing} aria-pressed={showDetails} aria-label={t('sqlite.toggle_details', 'Toggle row details')} title={t('sqlite.toggle_details', 'Toggle row details')} onClick={() => setShowDetails(value => !value)}>{showDetails ? <PanelRightClose aria-hidden="true" /> : <PanelRightOpen aria-hidden="true" />}</Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-g8 border-b border-border px-g13 py-g8">
              <div className="flex gap-g5" role="group" aria-label={t('sqlite.view', 'Database view')}>
                {(['data', 'structure'] as const).map(tab => <Button key={tab} type="button" variant={view === tab ? 'default' : 'ghost'} aria-pressed={view === tab} onClick={() => setView(tab)}>{tab === 'data' ? t('sqlite.data', 'Data') : t('sqlite.structure', 'Structure')}</Button>)}
              </div>
              {view === 'data' && <form onSubmit={event => { event.preventDefault(); setOffset(0); setAppliedSearch(search); }} className="flex min-w-0 items-center gap-g5">
                <Input className="min-w-0" aria-label={t('sqlite.search_table', 'Search table...')} placeholder={t('sqlite.search_table', 'Search table...')} value={search} onChange={event => setSearch(event.target.value)} />
                <Button type="submit" variant="outline" disabled={!selectedTable || loadingData} aria-label={t('sqlite.go', 'Go')}><Search aria-hidden="true" /></Button>
              </form>}
            </div>
            <div className="max-h-[60vh] min-h-80 overflow-auto" tabIndex={0} role="region" aria-label={t('sqlite.records', 'Records')} aria-busy={loadingData}>
              {loadingData ? <p role="status" className="flex items-center justify-center gap-g8 p-g21 text-sm text-muted-foreground"><Spinner size="sm" decorative />{t('sqlite.loading', 'Loading...')}</p> : view === 'structure' && tableData ? (
                <table className="w-full text-left font-mono text-xs">
                  <thead className="sticky top-0 bg-muted"><tr>{[t('sqlite.field', 'Field'), t('sqlite.type', 'Type'), t('sqlite.constraints', 'Constraints'), t('sqlite.default', 'Default')].map(label => <th key={label} className="whitespace-nowrap border-b border-border px-g13 py-g8">{label}</th>)}</tr></thead>
                  <tbody>{tableData.columns.map(col => <tr key={col.name} className="border-b border-border"><td className="px-g13 py-g8">{col.name}</td><td className="px-g13 py-g8 text-muted-foreground">{col.type || '—'}</td><td className="whitespace-nowrap px-g13 py-g8">{[col.pk ? `PK ${col.pk}` : '', col.notnull ? 'NOT NULL' : ''].filter(Boolean).join(' · ') || '—'}</td><td className="px-g13 py-g8">{cellText(col.dflt_value)}</td></tr>)}</tbody>
                </table>
              ) : tableData ? (
                <table className="w-full border-separate border-spacing-0 text-left font-mono text-xs" aria-label={selectedTable}>
                  <thead className="sticky top-0 z-10 bg-muted"><tr>
                    <th scope="col" className="border-b border-r border-border px-g8 py-g8 text-muted-foreground">#</th>
                    {tableData.columns.map(col => <th key={col.name} scope="col" aria-sort={sort.column === col.name ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'} className="whitespace-nowrap border-b border-r border-border px-g8 py-g5">
                      <button type="button" className="flex min-h-8 items-center gap-g5 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default" disabled={!col.sortable} onClick={() => { setOffset(0); setSort({ column: col.name, direction: sort.column === col.name && sort.direction === 'asc' ? 'desc' : 'asc' }); }}>
                        {col.pk > 0 && <KeyRound className="size-g13 text-status-warning" aria-label="Primary key" />}<span>{col.name}</span>
                        {!!col.sortable && (sort.column === col.name ? sort.direction === 'asc' ? <ArrowUp className="size-g13 text-primary" /> : <ArrowDown className="size-g13 text-primary" /> : <ArrowUpDown className="size-g13 text-muted-foreground" />)}
                      </button>
                    </th>)}
                  </tr></thead>
                  <tbody>{tableData.rows.length === 0 ? <tr><td colSpan={tableData.columns.length + 1} className="p-g21 text-center text-muted-foreground">{t('sqlite.no_records_found', 'No records found')}</td></tr> : tableData.rows.map((record, index) => (
                    <tr key={index} aria-selected={selectedRow === index} className={cn('hover:bg-accent/50', selectedRow === index ? 'bg-primary/10' : index % 2 ? 'bg-muted/20' : 'bg-background')}>
                      <td className="border-b border-r border-border px-g8 text-muted-foreground"><button type="button" className="min-h-8 min-w-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label={t('sqlite.select_row', 'Select row') + ` ${offset + index + 1}`} onClick={() => { setSelectedRow(index); setSelectedColumn(''); setShowDetails(true); }}>{offset + index + 1}</button></td>
                      {tableData.columns.map(col => <td key={col.name} className={cn('max-w-64 border-b border-r border-border p-0', selectedRow === index && selectedColumn === col.name && 'bg-primary/10 ring-2 ring-inset ring-primary')}>
                        <button type="button" title={cellText(record[col.name])} className={cn('block min-h-8 w-full truncate px-g8 py-g5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary', record[col.name] == null && 'italic text-muted-foreground')} onClick={() => { setSelectedRow(index); setSelectedColumn(col.name); setShowDetails(true); }}>{cellText(record[col.name]) || '\u00a0'}</button>
                      </td>)}
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p className="p-g21 text-center text-sm text-muted-foreground">{t('sqlite.no_records_found', 'No records found')}</p>}
            </div>
            {tableData && view === 'data' && <TablePagination currentPage={Math.floor(offset / limit) + 1} totalPages={Math.max(1, Math.ceil(tableData.total / limit))} rowsPerPage={limit} onPageChange={page => setOffset((page - 1) * limit)} onRowsPerPageChange={size => { setLimit(size); setOffset(0); }} className="!gap-g8 !px-g13 !py-g8" />}
          </section></fieldset>
          {showDetails && <aside id="sqlite-row-details" aria-label={t('sqlite.row_details', 'Row details')} className="shrink-0 border-t border-border bg-muted/20 lg:w-64 lg:border-l lg:border-t-0 xl:w-72">
            <div className="flex items-center justify-between border-b border-border p-g13"><h3 className="text-sm font-semibold">{t('sqlite.row_details', 'Row details')}</h3>{row && <span className="text-xs text-muted-foreground">#{offset + selectedRow! + 1}</span>}</div>
            <div className="border-b border-border p-g13"><Input aria-label={t('sqlite.search_fields', 'Find a field')} placeholder={t('sqlite.search_fields', 'Find a field')} value={fieldSearch} onChange={event => setFieldSearch(event.target.value)} /></div>
            <div className="max-h-[60vh] space-y-g13 overflow-auto p-g13">
              {tableData && <p className="text-xs text-muted-foreground">{editable ? t('sqlite.edit_start_hint', 'Select a row, then choose Edit row to change supported fields.') : t('sqlite.protected_table_hint', 'Editing is disabled for this table. Choose a business table such as partners or contracts to edit its supported fields.')}</p>}
              {!row ? <p className="py-g21 text-center text-xs text-muted-foreground">{t('sqlite.select_row_hint', 'Select a cell or row to inspect its values.')}</p> : <>
                <Button type="button" variant="outline" className="w-full" onClick={() => copy(JSON.stringify(row, null, 2))}><Copy aria-hidden="true" />{t('sqlite.copy_row', 'Copy row JSON')}</Button>
                {editable && (editing ? <div className="space-y-g8">
                  <p role="status" className="text-xs text-muted-foreground">{t('sqlite.edit_hint', 'Edit the fields below, then save. Keys and system fields are locked.')}</p>
                  <div className="flex gap-g8">
                    <Button type="button" onClick={saveEdit} disabled={saving || !Object.keys(draft).length}>{saving ? <Spinner size="sm" decorative /> : <Save aria-hidden="true" />}{t('common.save', 'Save')}</Button>
                    <Button type="button" variant="outline" onClick={cancelEdit} disabled={saving}><X aria-hidden="true" />{t('common.cancel', 'Cancel')}</Button>
                  </div>
                </div> : <Button type="button" className="w-full" onClick={() => { setEditing(true); setDraft({}); setFieldSearch(''); setError(''); }}><Pencil aria-hidden="true" />{t('sqlite.edit_row', 'Edit row')}</Button>)}
                {!fields.length && <p className="text-xs text-muted-foreground">{t('sqlite.no_fields', 'No fields found')}</p>}
                {fields.map(col => <div key={col.name} className={cn('rounded-md', selectedColumn === col.name && 'bg-primary/5 ring-1 ring-primary/40')}>
                  <div className="flex min-w-0 items-center justify-between gap-g5 px-g5 pb-g5"><label htmlFor={`sqlite-field-${col.name}`} className="truncate font-mono text-xs font-medium" title={col.name}>{col.pk > 0 && <KeyRound className="mr-1 inline size-g13 text-status-warning" aria-label="Primary key" />}{col.name}</label><span className="shrink-0 text-xs text-muted-foreground">{col.type || '—'}</span></div>
                  <div className="relative"><textarea id={`sqlite-field-${col.name}`} readOnly={!editing || !col.editable} disabled={saving} value={editing && col.editable ? (Object.hasOwn(draft, col.name) ? draft[col.name] ?? '' : row[col.name] == null ? '' : cellText(row[col.name])) : prettyValue(row[col.name])} onChange={event => setDraft(current => ({ ...current, [col.name]: event.target.value }))} rows={Math.min(8, Math.max(1, prettyValue(row[col.name]).split('\n').length))} className="block min-h-9 w-full resize-y rounded-md border border-border bg-background p-g8 pr-9 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary" /><button type="button" onClick={() => copy(cellText(row[col.name]))} aria-label={t('sqlite.copy_value', 'Copy value') + `: ${col.name}`} title={t('sqlite.copy_value', 'Copy value')} className="absolute right-1 top-1 rounded p-g5 text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><Copy className="size-g13" /></button></div>
                  {editing && col.editable && <label className="mt-1 flex items-center gap-g5 text-xs text-muted-foreground"><input type="checkbox" disabled={saving || Boolean(col.notnull)} checked={Object.hasOwn(draft, col.name) ? draft[col.name] === null : row[col.name] === null} onChange={event => setDraft(current => ({ ...current, [col.name]: event.target.checked ? null : '' }))} />NULL<span className="ml-auto">{col.editKind === 'boolean' ? '0 / 1' : col.editKind}</span></label>}
                </div>)}
              </>}
            </div>
          </aside>}
        </div>
      </Card>
    </div>
  );
};
