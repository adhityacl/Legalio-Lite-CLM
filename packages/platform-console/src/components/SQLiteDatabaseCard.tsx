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
import { Card, CardBody, CardHeader, CardTitle } from '@legalio/ui-components/card';
import { TableEmptyMessage, TableEmptyState } from './ui/table-empty-state';
import { Button } from '@legalio/ui-components/button';
import { AlphabeticalSelect } from './ui/alphabetical-select';
import { Badge, BadgeDot } from '@legalio/ui-components/badge';
import { cn } from '@legalio/ui-components/utils';
import { getAuthHeaders } from '../lib/apiFetch';
import { useLanguage } from '../context/LanguageContext';

import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { Table, TableHeader, TableRow, TableColumnHeader, TableBody, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { Dialog, DialogBackdrop, DialogBody, DialogCloseIcon, DialogContent, DialogFooter, DialogHeader, DialogPositioner, DialogTitle } from '@legalio/ui-components/dialog';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Spinner } from '@legalio/ui-components/spinner';
import { Text } from '@legalio/ui-components/text';
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
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-g13">
        <div className="space-y-g2">
          <CardTitle className="flex items-center gap-g8">
            <Database className="w-g21 h-g21 text-accent-foreground" />
            <span>{t('sqlite.sqlite_database', 'SQLite Database')}</span>
          </CardTitle>
        </div>

        <div className="flex items-center gap-g8 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={fetchStatusAndTables}
            disabled={loadingStatus}
          >
            {loadingStatus ? <Spinner size="sm" decorative /> : <RefreshCw aria-hidden="true" />}
 <span>{t('sqlite.refresh', 'Refresh')}</span>
 </Button>

 <Button
 type="button"
            onClick={handleOptimize}
            disabled={optimizing}
          >
            {optimizing ? <Spinner size="sm" decorative /> : <Sparkles aria-hidden="true" />}
 <span>{optimizing ? t('sqlite.optimizing', 'Optimizing...') : t('sqlite.optimize', 'Optimize')}</span>
 </Button>
 </div>
 </CardHeader>

 <CardBody className="space-y-g13">
        {message && (
          <div
            className={cn(
              'p-g8 rounded-xl text-xs font-medium flex items-center justify-between animate-in fade-in-50',
 message.type === 'success'
 ? 'bg-status-success/10 border border-status-success-border/20 text-status-success '
 : 'bg-destructive/10 border border-destructive/20 text-destructive'
 )}
 >
 <div className="flex items-center gap-g8">
              {message.type === 'success' ? (
                <CheckCircle2 className="w-g13 h-g13 shrink-0" />
              ) : (
                <AlertCircle className="w-g13 h-g13 shrink-0" />
              )}
              <span>{message.text}</span>
            </div>
          </div>
        )}

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-g8">
          <Card className="p-g13 space-y-g3">
            <Text as="span" size="xs" tone="muted" className="flex items-center gap-g5">
              <Activity className="w-g13 h-g13 text-accent-foreground" />
              <span>{t('dashboard.status', 'Status')}</span>
            </Text>
            <div className="flex items-center gap-g8">
              <BadgeDot className="size-g8 text-primary animate-pulse" />
              <Text size="xs" weight="bold" className="font-mono uppercase">
                {status?.status || t('status.aktif', 'Active')}
              </Text>
            </div>
          </Card>

          <Card className="p-g13 space-y-g3">
            <Text as="span" size="xs" tone="muted" className="flex items-center gap-g5">
              <HardDrive className="w-g13 h-g13 text-status-info" />
              <span>{t('documents.field.size', 'Size')}</span>
            </Text>
            <Text size="xs" weight="bold" className="font-mono">
              {status ? formatBytes(status.fileSizeBytes) : '-'}
            </Text>
          </Card>

          <Card className="p-g13 space-y-g3">
            <Text as="span" size="xs" tone="muted" className="flex items-center gap-g5">
              <Layers className="w-g13 h-g13 text-status-special" />
              <span>{t('sqlite.tables', 'Tables')}</span>
            </Text>
            <Text size="xs" weight="bold" className="font-mono">
              {status?.tablesCount ?? tables.length}
            </Text>
          </Card>

          <Card className="p-g13 space-y-g3">
            <Text as="span" size="xs" tone="muted" className="flex items-center gap-g5">
              <TableIcon className="w-g13 h-g13 text-status-warning" />
              <span>{t('sqlite.total_rows', 'Total Rows')}</span>
            </Text>
            <Text size="xs" weight="bold" className="font-mono">
              {status?.totalRecords?.toLocaleString() ?? '-'}
            </Text>
          </Card>
        </div>

        {/* Table Selector & Search */}
        <div className="pt-g8 space-y-g13">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-g8">
            {/* Table Selector */}
            <AlphabeticalSelect
              aria-label={t('sqlite.tables', 'Tables')}
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value)}
              disabled={tables.length === 0}
              className="w-full disabled:cursor-not-allowed disabled:opacity-50" controlProps={{ className: "sm:w-g233 min-w-0 max-w-full w-full" }}
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
            <form onSubmit={handleSearchSubmit} className="flex items-center gap-g5 shrink-0">
              <InputGroup className="relative">
                <InputGroupAddon><Search className="size-g16" aria-hidden="true" /></InputGroupAddon>
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

          {/* Data Table: the section Card above is the only frame, so the table gets none of its own. */}
          <div className="-mx-g21 overflow-hidden border-t border-border">
            <TableScrollArea role="region" tabIndex={0} aria-label={t('ui.scroll_table')} className="max-h-g377">
              {loadingData ? (
                <TableEmptyMessage message={t('sqlite.loading', 'Loading...')} />
              ) : !tableData ? (
                <TableEmptyMessage />
              ) : (
                <Table className="font-mono">
                  <TableHeader>
                    <TableRow>
                      {tableData.columns.map((col) => (
                        <TableColumnHeader key={col.name} className="whitespace-nowrap">
                          <div className="flex items-center gap-g5">
                            <span>{col.name}</span>
                            {col.pk === 1 && (
                              <Badge tone="warning">{t('sqlite.pk', 'PK')}</Badge>
                            )}
                            <Text as="span" size="xs" tone="muted">
                              {col.type || 'TEXT'}
                            </Text>
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
                            <Tooltip key={col.name}><TooltipTrigger asChild><TableCell className="max-w-g377 truncate whitespace-nowrap"
                            >
                              {isNull ? (
                                <Text as="span" size="xs" tone="muted" className="italic">{t('sqlite.null', 'NULL')}</Text>
                              ) : strVal.length > 35 ? (
                                <Button variant="link"
                                  type="button"
                                  onClick={() => setExpandedCell({ col: col.name, val: strVal })}
                                  className="block h-auto min-w-0 truncate p-0 text-start text-foreground"
                                >
                                  {strVal.slice(0, 35)}...
                                </Button>
                              ) : (
                                <span>{strVal}</span>
                              )}
                            </TableCell></TooltipTrigger><TooltipBody>{strVal}</TooltipBody></Tooltip>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TableScrollArea>

            {/* Pagination Controls */}
            {tableData && tableData.total > 0 && (
              <div className="p-g8 bg-card border-t border-border flex items-center justify-between text-xs">
                <Text as="span" size="xs" tone="muted" className="font-mono">
                  {offset + 1} {t('sqlite.of', '- {value} of {total}', { value: Math.min(offset + limit, tableData.total), total: tableData.total })}
                </Text>

                <div className="flex items-center gap-g3">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-md"
                    onClick={() => handlePageChange(Math.max(0, offset - limit))}
                    aria-label={t('pagination.prev_page', 'Previous Page')}
                    disabled={offset === 0 || loadingData}
                  >
                    <ChevronLeft className="w-g13 h-g13" />
                  </Button>
                  <Text as="span" size="xs" tone="muted" className="px-g8 font-mono">
                    {currentPage}/{totalPages}
                  </Text>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-md"
                    onClick={() => handlePageChange(offset + limit)}
                    aria-label={t('pagination.next_page', 'Next Page')}
                    disabled={offset + limit >= tableData.total || loadingData}
                  >
                    <ChevronRight className="w-g13 h-g13" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardBody>

      {/* Expanded Cell View Modal */}
      <Dialog open={!!expandedCell} onOpenChange={details => { if (!details.open) setExpandedCell(null); }}>
        <DialogBackdrop />
        <DialogPositioner>
          <DialogContent className="w-full max-w-g610">
            <DialogHeader>
              <DialogTitle className="font-mono text-sm">{expandedCell?.col}</DialogTitle>
              <DialogCloseIcon aria-label={t('common.close', 'Close')} />
            </DialogHeader>
            <DialogBody>
              <pre className="max-h-g233 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted p-g13 font-mono text-xs">{expandedCell?.val}</pre>
            </DialogBody>
            <DialogFooter>
              <Button type="button" onClick={() => setExpandedCell(null)}>{t('redline.close', 'Close')}</Button>
            </DialogFooter>
          </DialogContent>
        </DialogPositioner>
      </Dialog>
    </Card>
  );
};
