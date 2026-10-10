import React, { useState, useEffect } from 'react';
import {
  Database,
  RefreshCw,
  Search,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Table as TableIcon,
  ChevronLeft,
  ChevronRight,
  Layers,
  HardDrive,
  Activity,
  Maximize2,
  X,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@legalio/ui-components/card';
import { TableEmptyMessage, TableEmptyState } from './ui/table-empty-state';
import { Button } from '@legalio/ui-components/button';
import { AlphabeticalSelect } from './ui/alphabetical-select';
import { Badge } from '@legalio/ui-components/badge';
import { cn } from '@legalio/ui-components/utils';
import { getAuthHeaders } from '../lib/apiFetch';
import { useLanguage } from '../context/LanguageContext';

import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { Table, TableHeader, TableRow, TableColumnHeader, TableBody, TableCell } from '@legalio/ui-components/table';
interface SQLiteStatus {
  status: string;
  journalMode: string;
  version: string;
  fileSizeBytes: number;
  pageCount: number;
  pageSize: number;
  modifiedAt: string | null;
  tablesCount: number;
  totalRecords: number;
  tableSummaries: Record<string, number>;
}

interface TableItem {
  name: string;
  count: number;
  columnsCount: number;
}

interface TableColumn {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: any;
  pk: number;
}

interface TableDataResponse {
  table: string;
  columns: TableColumn[];
  rows: Record<string, any>[];
  total: number;
  limit: number;
  offset: number;
}

export const SQLiteDatabaseCard: React.FC = () => {
  const { t } = useLanguage();
  const [status, setStatus] = useState<SQLiteStatus | null>(null);
  const [tables, setTables] = useState<TableItem[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [tableData, setTableData] = useState<TableDataResponse | null>(null);
  const [search, setSearch] = useState<string>('');
  const [offset, setOffset] = useState<number>(0);
  const limit = 15;

  const [loadingStatus, setLoadingStatus] = useState<boolean>(false);
  const [loadingData, setLoadingData] = useState<boolean>(false);
  const [optimizing, setOptimizing] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [expandedCell, setExpandedCell] = useState<{ col: string; val: string } | null>(null);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const fetchStatusAndTables = async () => {
    setLoadingStatus(true);
    try {
      const headers = getAuthHeaders();
      const [statusRes, tablesRes] = await Promise.all([
        fetch('/api/auth-console/sqlite/status', { headers, credentials: 'include' }),
        fetch('/api/auth-console/sqlite/tables', { headers, credentials: 'include' }),
      ]);

      if (statusRes.ok) {
        const data = await statusRes.json();
        if (data.success) setStatus(data);
      }

      if (tablesRes.ok) {
        const data = await tablesRes.json();
        if (data.success && Array.isArray(data.tables)) {
          setTables(data.tables);
          if (!selectedTable && data.tables.length > 0) {
            setSelectedTable(data.tables[0].name);
          }
        }
      }
    } catch (err: any) {
      console.error('Error fetching SQLite info:', err);
    } finally {
      setLoadingStatus(false);
    }
  };

  const fetchTableData = async (table: string, currentOffset = 0, currentSearch = '') => {
    if (!table) return;
    setLoadingData(true);
    try {
      const headers = getAuthHeaders();
      const params = new URLSearchParams({
        table,
        limit: String(limit),
        offset: String(currentOffset),
      });
      if (currentSearch.trim()) {
        params.set('search', currentSearch.trim());
      }

      const res = await fetch(`/api/auth-console/sqlite/table-data?${params.toString()}`, {
        headers,
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setTableData(data);
        }
      }
    } catch (err: any) {
      console.error('Error fetching table data:', err);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    fetchStatusAndTables();
  }, []);

  useEffect(() => {
    if (selectedTable) {
      setOffset(0);
      fetchTableData(selectedTable, 0, search);
    }
  }, [selectedTable]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setOffset(0);
    fetchTableData(selectedTable, 0, search);
  };

  const handlePageChange = (newOffset: number) => {
    setOffset(newOffset);
    fetchTableData(selectedTable, newOffset, search);
  };

  const handleOptimize = async () => {
    setOptimizing(true);
    setMessage(null);
    try {
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      const res = await fetch('/api/auth-console/sqlite/optimize', {
        method: 'POST',
        headers,
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({ type: 'success', text: t('sqlite.database_optimized', 'Database optimized') });
        fetchStatusAndTables();
        if (selectedTable) fetchTableData(selectedTable, offset, search);
      } else {
        setMessage({ type: 'error', text: data.error || t('sqlite.optimization_failed', 'Optimization failed') });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || t('sqlite.optimization_failed', 'Optimization failed') });
    } finally {
      setOptimizing(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = tableData ? Math.ceil(tableData.total / limit) || 1 : 1;

  return (
    <Card id="card-sqlite-database" className="overflow-hidden">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5 text-accent-foreground" />
            <span>{t('sqlite.sqlite_database', 'SQLite Database')}</span>
          </CardTitle>
        </div>

        <div className="mobile-page-actions flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={fetchStatusAndTables}
            disabled={loadingStatus}
          >
            <RefreshCw className={cn('w-3 h-3', loadingStatus && 'animate-spin')} />
 <span>{t('sqlite.refresh', 'Refresh')}</span>
 </Button>

 <Button
 type="button"
            onClick={handleOptimize}
            disabled={optimizing}
          >
            <Sparkles className={cn('w-3 h-3', optimizing && 'animate-spin')} />
 <span>{optimizing ? t('sqlite.optimizing', 'Optimizing...') : t('sqlite.optimize', 'Optimize')}</span>
 </Button>
 </div>
 </CardHeader>

 <CardContent className="space-y-4">
        {message && (
          <div
            className={cn(
              'p-2.5 rounded-xl text-xs font-medium flex items-center justify-between animate-in fade-in-50',
 message.type === 'success'
 ? 'bg-status-success/10 border border-status-success-border/20 text-status-success '
 : 'bg-destructive/10 border border-destructive/20 text-destructive'
 )}
 >
 <div className="flex items-center gap-2">
              {message.type === 'success' ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{message.text}</span>
            </div>
          </div>
        )}

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <Card className="p-3 space-y-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-accent-foreground" />
              <span>{t('dashboard.status', 'Status')}</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-primary animate-pulse" />
              <p className="font-bold text-foreground font-mono text-xs uppercase">
                {status?.status || t('status.aktif', 'Active')}
              </p>
            </div>
          </Card>

          <Card className="p-3 space-y-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <HardDrive className="w-3 h-3 text-status-info" />
              <span>{t('documents.field.size', 'Size')}</span>
            </span>
            <p className="font-bold text-foreground font-mono text-xs">
              {status ? formatBytes(status.fileSizeBytes) : '-'}
            </p>
          </Card>

          <Card className="p-3 space-y-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Layers className="w-3 h-3 text-status-special" />
              <span>{t('sqlite.tables', 'Tables')}</span>
            </span>
            <p className="font-bold text-foreground font-mono text-xs">
              {status?.tablesCount ?? tables.length}
            </p>
          </Card>

          <Card className="p-3 space-y-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <TableIcon className="w-3 h-3 text-status-warning" />
              <span>{t('sqlite.total_rows', 'Total Rows')}</span>
            </span>
            <p className="font-bold text-foreground font-mono text-xs">
              {status?.totalRecords?.toLocaleString() ?? '-'}
            </p>
          </Card>
        </div>

        {/* Table Selector & Search */}
        <div className="pt-2 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            {/* Table Selector */}
            <AlphabeticalSelect
              aria-label={t('sqlite.tables', 'Tables')}
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value)}
              disabled={tables.length === 0}
              className="w-full sm:w-72 min-w-0 max-w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              {tables.length === 0 && (
                <option value="">
                  {loadingStatus ? t('sqlite.loading', 'Loading...') : t('sqlite.tables', 'Tables')}
                </option>
              )}
              {tables.map((table) => (
                <option key={table.name} value={table.name}>
                  {table.name} ({table.count})
                </option>
              ))}
            </AlphabeticalSelect>

            {/* Search Input */}
            <form onSubmit={handleSearchSubmit} className="mobile-search-form flex items-center gap-1.5 shrink-0">
              <InputGroup className="relative">
                <InputGroupAddon><Search className="size-4" aria-hidden="true" /></InputGroupAddon>
                <InputGroupInput
                  aria-label={t('sqlite.search_table', 'Search table...')}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('sqlite.search_table', 'Search table...')}
                />
              </InputGroup>
              <Button
                type="submit"
                variant="outline"
              >
                {t('sqlite.go', 'Go')}
              </Button>
            </form>
          </div>

          {/* Data Table */}
          <div className="border border-border rounded-xl overflow-hidden bg-card">
            <div className="overflow-x-auto max-h-96">
              {loadingData ? (
                <div className="p-8 text-center text-muted-foreground">
                  <RefreshCw className="w-5 h-5 mx-auto animate-spin mb-2 text-accent-foreground" />
                  <span>{t('sqlite.loading', 'Loading...')}</span>
                </div>
              ) : !tableData ? (
                <TableEmptyMessage />
              ) : (
                <Table className="w-full text-left font-mono">
                  <TableHeader>
                    <TableRow>
                      {tableData.columns.map((col) => (
                        <TableColumnHeader key={col.name} className="whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span>{col.name}</span>
                            {col.pk === 1 && (
                              <span className="text-xs px-1 py-0.2 bg-status-warning/10 text-status-warning rounded-sm">
                                {t('sqlite.pk', 'PK')}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground font-normal">
                              {col.type || 'TEXT'}
                            </span>
                          </div>
                        </TableColumnHeader>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tableData.rows.length === 0 ? <TableEmptyState colSpan={Math.max(tableData.columns.length, 1)} /> : tableData.rows.map((row, rIdx) => (
                      <TableRow
                        key={rIdx}
                      >
                        {tableData.columns.map((col) => {
                          const val = row[col.name];
                          const strVal =
                            val === null || val === undefined
                              ? 'NULL'
                              : typeof val === 'object'
                              ? JSON.stringify(val)
                              : String(val);

                          const isNull = val === null || val === undefined;

                          return (
                            <TableCell
                              key={col.name}
                              className="max-w-xs truncate whitespace-nowrap"
                              title={strVal}
                            >
                              {isNull ? (
                                <span className="text-muted-foreground italic text-xs">{t('sqlite.null', 'NULL')}</span>
                              ) : strVal.length > 35 ? (
                                <Button variant="link"
                                  type="button"
                                  onClick={() => setExpandedCell({ col: col.name, val: strVal })}
                                  className="text-left truncate"
                                >
                                  {strVal.slice(0, 35)}...
                                </Button>
                              ) : (
                                <span>{strVal}</span>
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            {/* Pagination Controls */}
            {tableData && tableData.total > 0 && (
              <div className="p-2.5 bg-card border-t border-border flex items-center justify-between text-xs">
                <span className="text-muted-foreground font-mono text-xs">
                  {offset + 1} {t('sqlite.of', '- {value} of {total}', { value: Math.min(offset + limit, tableData.total), total: tableData.total })}
                </span>

                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-md"
                    onClick={() => handlePageChange(Math.max(0, offset - limit))}
                    aria-label={t('pagination.prev_page', 'Previous Page')}
                    disabled={offset === 0 || loadingData}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <span className="px-2 font-mono text-muted-foreground text-xs">
                    {currentPage}/{totalPages}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-md"
                    onClick={() => handlePageChange(offset + limit)}
                    aria-label={t('pagination.next_page', 'Next Page')}
                    disabled={offset + limit >= tableData.total || loadingData}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>

      {/* Expanded Cell View Modal */}
      {expandedCell && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <Card className="max-w-lg w-full p-4 space-y-3 animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <span className="font-mono text-xs font-bold text-foreground">
                {expandedCell.col}
              </span>
              <Button variant="ghost" size="icon-sm"
                type="button"
                onClick={() => setExpandedCell(null)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <pre className="p-3 bg-card rounded-xl text-xs font-mono max-h-64 overflow-auto whitespace-pre-wrap break-all text-foreground">
              {expandedCell.val}
            </pre>
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => setExpandedCell(null)}
              >
                {t('redline.close', 'Close')}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </Card>
  );
};
