import React, { useCallback, useEffect, useState } from 'react';
import { Activity, ListTree, Network, RefreshCw, SquareTerminal, Table2, type LucideIcon } from 'lucide-react';
import { apiRequest } from '@legalio/shared/apiClient';
import { useLanguage } from '../../context/LanguageContext';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Badge, type StatusTone } from '@legalio/ui-components/badge';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Spinner } from '@legalio/ui-components/spinner';
import { Table, TableBody, TableCell, TableColumnHeader, TableHeader, TableRow, TableScrollArea } from '@legalio/ui-components/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@legalio/ui-components/tabs';
import { TableEmptyState } from '../ui/table-empty-state';

type Report = 'overview' | 'connections' | 'tables' | 'indexes' | 'queries';
type Row = Record<string, any>;
interface ReportResponse<T> { report: string; generatedAt: string; data: T }

const REPORTS: Report[] = ['overview', 'connections', 'tables', 'indexes', 'queries'];
const REPORT_ICONS: Record<Report, LucideIcon> = { overview: Activity, connections: Network, tables: Table2, indexes: ListTree, queries: SquareTerminal };

const number = (value: unknown, digits = 0) => (value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits }));
const percent = (value: unknown) => (value === null || value === undefined ? '—' : `${(Number(value) * 100).toFixed(1)}%`);
const bytes = (value: unknown) => {
  let size = Number(value);
  if (!Number.isFinite(size)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
};
const duration = (seconds: unknown) => {
  const value = Number(seconds);
  if (seconds === null || seconds === undefined || !Number.isFinite(value)) return '—';
  if (value < 1) return `${Math.round(value * 1000)} ms`;
  if (value < 120) return `${value.toFixed(1)} s`;
  if (value < 7200) return `${Math.round(value / 60)} min`;
  return `${(value / 3600).toFixed(1)} h`;
};
const millis = (value: unknown) => (value === null || value === undefined ? '—' : Number(value) >= 1000 ? `${(Number(value) / 1000).toFixed(2)} s` : `${Number(value).toFixed(2)} ms`);
const when = (value: unknown) => (value ? new Date(String(value)).toLocaleString() : '—');
const uptime = (since: unknown) => duration(since ? (Date.now() - new Date(String(since)).getTime()) / 1000 : null);

const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string; tone?: StatusTone }> = ({ label, value, hint, tone }) => (
  <Card className="flex flex-col gap-g5 p-g13">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="flex items-center gap-g8 text-lg font-semibold">{value}{tone && <Badge tone={tone}>{tone === 'success' ? 'OK' : tone === 'warning' ? '!' : '!!'}</Badge>}</span>
    {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
  </Card>
);

const Section: React.FC<{ title: string; children: React.ReactNode; note?: string }> = ({ title, children, note }) => (
  <section className="flex flex-col gap-g8">
    <Heading as="h3" size="sm" weight="semibold">{title}</Heading>
    {note && <p className="text-xs text-muted-foreground">{note}</p>}
    {children}
  </section>
);

const DataTable: React.FC<{ columns: Array<{ key: string; label: string; render?: (row: Row) => React.ReactNode; className?: string }>; rows: Row[]; empty: string }> = ({ columns, rows, empty }) => (
  <Card className="p-0">
    <TableScrollArea>
      <Table>
        <TableHeader><TableRow>{columns.map((column) => <TableColumnHeader key={column.key} className={column.className}>{column.label}</TableColumnHeader>)}</TableRow></TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableEmptyState colSpan={columns.length} message={empty} /> : rows.map((row, index) => (
            <TableRow key={index}>{columns.map((column) => <TableCell key={column.key} className={column.className}>{column.render ? column.render(row) : String(row[column.key] ?? '—')}</TableCell>)}</TableRow>
          ))}
        </TableBody>
      </Table>
    </TableScrollArea>
  </Card>
);

const Sql: React.FC<{ text?: string | null }> = ({ text }) => (
  <code className="block max-w-g610 truncate whitespace-pre font-mono text-xs" title={text || undefined}>{(text || '').replace(/\s+/g, ' ') || '—'}</code>
);

/** Loads one report; `deps` (schema, sort) re-run it. */
function useReport<T>(report: Report, params: Record<string, string> = {}) {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; data?: T; at?: string; error?: string }>({ status: 'loading' });
  const key = JSON.stringify(params);
  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'loading' }));
    try {
      const query = new URLSearchParams(JSON.parse(key)).toString();
      const response = await apiRequest<ReportResponse<T>>(`/auth-console/pg-reports/${report}${query ? `?${query}` : ''}`, { method: 'GET', cache: 'no-store' });
      setState({ status: 'ready', data: response.data, at: response.generatedAt });
    } catch (err: any) {
      setState((prev) => ({ ...prev, status: 'error', error: err?.message || 'The report could not be loaded.' }));
    }
  }, [report, key]);
  useEffect(() => { void load(); }, [load]);
  return { ...state, reload: load };
}

const ReportFrame: React.FC<{ state: ReturnType<typeof useReport<any>>; toolbar?: React.ReactNode; children: (data: any) => React.ReactNode }> = ({ state, toolbar, children }) => {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-g21">
      <div className="flex flex-wrap items-center justify-between gap-g8">
        <div className="flex items-center gap-g8">{toolbar}</div>
        <div className="flex items-center gap-g8 text-xs text-muted-foreground">
          {state.at && <span>{t('pgr.updated', 'Updated')} {new Date(state.at).toLocaleTimeString()}</span>}
          <Button variant="ghost" size="icon-md" type="button" onClick={() => void state.reload()} disabled={state.status === 'loading'} aria-label={t('admin.refresh_btn', 'Refresh Data')}>
            {state.status === 'loading' ? <Spinner size="sm" decorative /> : <RefreshCw aria-hidden="true" />}
          </Button>
        </div>
      </div>
      {state.status === 'error' && (
        <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{state.error}</AlertDescription></AlertContent></Alert>
      )}
      {state.data ? children(state.data) : state.status === 'loading' && (
        <div role="status" className="flex min-h-g233 items-center justify-center gap-g8 text-sm text-muted-foreground"><Spinner size="sm" decorative />{t('pgr.loading', 'Loading report…')}</div>
      )}
    </div>
  );
};

const Overview: React.FC = () => {
  const { t } = useLanguage();
  const state = useReport<any>('overview');
  return (
    <ReportFrame state={state}>{(d) => {
      const usage = d.connections.total / d.server.max_connections;
      const hit = d.stats.cache_hit_ratio;
      const rollbackRatio = d.stats.commits + d.stats.rollbacks > 0 ? d.stats.rollbacks / (d.stats.commits + d.stats.rollbacks) : 0;
      return (
        <>
          <div className="grid grid-cols-2 gap-g13 lg:grid-cols-4">
            <Stat label={t('pgr.version', 'PostgreSQL')} value={d.server.version} hint={d.server.database} />
            <Stat label={t('pgr.uptime', 'Uptime')} value={uptime(d.server.started_at)} hint={when(d.server.started_at)} />
            <Stat label={t('pgr.db_size', 'Database size')} value={bytes(d.server.size_bytes)} />
            <Stat label={t('pgr.cache_hit', 'Cache hit ratio')} value={percent(hit)} tone={hit === null ? undefined : hit >= 0.99 ? 'success' : hit >= 0.95 ? 'warning' : 'danger'} hint={t('pgr.cache_hint', 'Below 99% suggests too little memory')} />
            <Stat label={t('pgr.connections', 'Connections')} value={`${d.connections.total} / ${d.server.max_connections}`} tone={usage < 0.7 ? 'success' : usage < 0.9 ? 'warning' : 'danger'} hint={`${d.connections.active} ${t('pgr.active', 'active')} · ${d.connections.idle} ${t('pgr.idle', 'idle')}`} />
            <Stat label={t('pgr.idle_tx', 'Idle in transaction')} value={number(d.connections.idle_in_transaction)} tone={d.connections.idle_in_transaction === 0 ? 'success' : 'warning'} hint={t('pgr.idle_tx_hint', 'Holds locks and blocks vacuum')} />
            <Stat label={t('pgr.lock_waits', 'Waiting on locks')} value={number(d.connections.waiting_on_locks)} tone={d.connections.waiting_on_locks === 0 ? 'success' : 'warning'} />
            <Stat label={t('pgr.deadlocks', 'Deadlocks')} value={number(d.stats.deadlocks)} tone={d.stats.deadlocks === 0 ? 'success' : 'danger'} />
            <Stat label={t('pgr.commits', 'Commits')} value={number(d.stats.commits)} />
            <Stat label={t('pgr.rollbacks', 'Rollbacks')} value={number(d.stats.rollbacks)} hint={percent(rollbackRatio)} />
            <Stat label={t('pgr.temp_files', 'Temp files')} value={number(d.stats.temp_files)} hint={bytes(d.stats.temp_bytes)} />
            <Stat label={t('pgr.stats_since', 'Statistics since')} value={when(d.stats.stats_reset)} />
          </div>
          <Section title={t('pgr.extensions', 'Extensions')} note={t('pgr.extensions_note', 'pg_stat_statements powers the Queries report.')}>
            <DataTable rows={d.extensions} empty={t('pgr.none', 'Nothing to show.')} columns={[
              { key: 'name', label: t('pgr.name', 'Name') },
              { key: 'installed', label: t('pgr.status', 'Status'), render: (r) => r.installed ? <Badge tone="success">{`${t('pgr.installed', 'Installed')} ${r.installed}`}</Badge> : <Badge>{t('pgr.not_installed', 'Not installed')}</Badge> },
              { key: 'available', label: t('pgr.available', 'Available version') },
            ]} />
          </Section>
        </>
      );
    }}</ReportFrame>
  );
};

interface Bar { id: string; label: string; display: string; value: number; tone?: 'default' | 'warning' | 'danger'; hint?: string; title?: string }
const TONE_FILL = { default: 'bg-primary', warning: 'bg-status-warning', danger: 'bg-status-danger' } as const;

/** Horizontal bars scaled to the largest value. Text stays in text colors; the bar carries the magnitude, its tone only a threshold. */
const BarList: React.FC<{ rows: Bar[]; empty: string; mono?: boolean }> = ({ rows, empty, mono }) => {
  if (rows.length === 0) return <Card className="p-g21 text-sm text-muted-foreground">{empty}</Card>;
  const max = Math.max(...rows.map((row) => row.value), 0) || 1;
  return (
    <Card className="p-g13">
      <ul className="flex flex-col gap-g13">
        {rows.map((row) => (
          <li key={row.id} title={row.title ?? row.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-g13 gap-y-g5 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_6rem]">
            <span className={`min-w-0 truncate text-sm ${mono ? 'font-mono text-xs' : ''}`}>{row.label}{row.hint && <span className="ml-g8 text-xs text-muted-foreground">{row.hint}</span>}</span>
            <span className="text-right text-sm tabular-nums sm:order-3">{row.display}</span>
            <span className="col-span-2 h-g8 overflow-hidden rounded-full bg-muted sm:order-2 sm:col-span-1" aria-hidden="true">
              <span className={`block h-full rounded-full ${TONE_FILL[row.tone ?? 'default']}`} style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
};

/** One stacked bar split into labelled parts; the legend carries identity so color is never the only cue. */
const Split: React.FC<{ parts: Array<{ label: string; value: number; fill: string }> }> = ({ parts }) => {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return (
    <Card className="flex flex-col gap-g13 p-g13">
      <div className="flex h-g21 w-full gap-[2px] overflow-hidden rounded-md" role="img" aria-label={parts.map((part) => `${part.label}: ${part.value}`).join(', ')}>
        {total === 0 ? <span className="h-full w-full bg-muted" /> : parts.filter((part) => part.value > 0).map((part) => (
          <span key={part.label} className={`h-full ${part.fill}`} style={{ width: `${(part.value / total) * 100}%` }} title={`${part.label}: ${part.value}`} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-g21 gap-y-g5 text-sm">
        {parts.map((part) => <li key={part.label} className="flex items-center gap-g8"><span className={`size-g8 rounded-full ${part.fill}`} aria-hidden="true" />{part.label} <span className="font-medium tabular-nums">{part.value}</span></li>)}
      </ul>
    </Card>
  );
};

const oneLine = (text?: string | null) => (text || '').replace(/\s+/g, ' ').trim() || '—';

const Connections: React.FC = () => {
  const { t } = useLanguage();
  const state = useReport<any>('connections');
  return (
    <ReportFrame state={state}>{(d) => {
      const count = (name: string) => (d.sessions as Row[]).filter((s) => s.state === name).length;
      const other = d.sessions.length - count('active') - count('idle') - count('idle in transaction');
      const longest = (d.sessions as Row[]).filter((s) => s.state === 'active' && s.query_seconds !== null).sort((a, b) => b.query_seconds - a.query_seconds).slice(0, 8);
      return (
        <>
          <Section title={t('pgr.sessions', 'Sessions by state')}>
            <Split parts={[
              { label: t('pgr.active', 'active'), value: count('active'), fill: 'bg-primary' },
              { label: t('pgr.idle', 'idle'), value: count('idle'), fill: 'bg-muted-foreground/40' },
              { label: t('pgr.idle_tx', 'Idle in transaction'), value: count('idle in transaction'), fill: 'bg-status-warning' },
              { label: t('pgr.other', 'other'), value: other, fill: 'bg-border' },
            ]} />
          </Section>
          <Section title={t('pgr.longest', 'Longest running queries')} note={t('pgr.longest_note', 'Active queries by how long they have been running.')}>
            <BarList mono empty={t('pgr.no_active', 'No query is running right now.')} rows={longest.map((s) => ({
              id: String(s.pid), label: oneLine(s.query), hint: s.user, value: s.query_seconds, display: duration(s.query_seconds), tone: s.query_seconds >= 60 ? 'danger' : s.query_seconds >= 10 ? 'warning' : 'default', title: `PID ${s.pid} · ${s.user}\n${oneLine(s.query)}`,
            }))} />
          </Section>
          {d.blocking.length > 0 && (
            <Section title={t('pgr.blocking', 'Blocking queries')} note={t('pgr.blocking_note', 'A session waiting for a lock held by another session.')}>
              <DataTable rows={d.blocking} empty="" columns={[
                { key: 'blocked_pid', label: t('pgr.blocked_pid', 'Blocked PID') },
                { key: 'blocked_seconds', label: t('pgr.waiting_for', 'Waiting'), render: (r) => duration(r.blocked_seconds) },
                { key: 'blocked_query', label: t('pgr.blocked_query', 'Blocked query'), render: (r) => <Sql text={r.blocked_query} /> },
                { key: 'blocking_pid', label: t('pgr.blocking_pid', 'Blocking PID') },
                { key: 'blocking_query', label: t('pgr.blocking_query', 'Blocking query'), render: (r) => <Sql text={r.blocking_query} /> },
              ]} />
            </Section>
          )}
        </>
      );
    }}</ReportFrame>
  );
};

const SchemaPicker: React.FC<{ schema: string; schemas: string[]; onChange: (schema: string) => void }> = ({ schema, schemas, onChange }) => {
  const { t } = useLanguage();
  return (
    <label className="flex items-center gap-g8 text-sm">
      <span className="shrink-0 whitespace-nowrap text-muted-foreground">{t('pgr.schema', 'Schema')}</span>
      <NativeSelect className="w-auto min-w-40" value={schema} onChange={(e) => onChange(e.target.value)} aria-label={t('pgr.schema', 'Schema')}>
        {(schemas.length ? schemas : [schema]).map((name) => <option key={name} value={name}>{name}</option>)}
      </NativeSelect>
    </label>
  );
};

const Tables: React.FC = () => {
  const { t } = useLanguage();
  const [schema, setSchema] = useState('public');
  const state = useReport<any>('tables', { schema });
  return (
    <ReportFrame state={state} toolbar={<SchemaPicker schema={state.data?.schema || schema} schemas={state.data?.schemas || []} onChange={setSchema} />}>{(d) => {
      const rows = d.tables as Row[];
      const bloated = rows.filter((r) => r.dead_ratio > 0).sort((a, b) => b.dead_ratio - a.dead_ratio).slice(0, 8);
      return (
        <>
          <Section title={t('pgr.tables_title', 'Largest tables')} note={t('pgr.tables_note', 'Total size including indexes.')}>
            <BarList empty={t('pgr.none', 'Nothing to show.')} rows={rows.slice(0, 10).map((r) => ({
              id: r.name, label: r.name, hint: `${number(r.live_rows)} ${t('pgr.rows', 'rows')}`, value: r.total_bytes, display: bytes(r.total_bytes),
              title: `${r.name}\n${t('pgr.data_size', 'Data')} ${bytes(r.table_bytes)} · ${t('pgr.index_size', 'Indexes')} ${bytes(r.index_bytes)}`,
            }))} />
          </Section>
          <Section title={t('pgr.dead_title', 'Dead tuples')} note={t('pgr.dead_note', 'Share of rows waiting for vacuum (estimate). Above 10% is worth watching, above 20% means autovacuum is behind.')}>
            <BarList empty={t('pgr.no_dead', 'No table has dead tuples.')} rows={bloated.map((r) => ({
              id: r.name, label: r.name, hint: `${number(r.dead_rows)} ${t('pgr.dead_rows', 'dead')}`, value: r.dead_ratio, display: percent(r.dead_ratio), tone: r.dead_ratio >= 0.2 ? 'danger' : r.dead_ratio >= 0.1 ? 'warning' : 'default',
              title: `${r.name}\n${t('pgr.last_vacuum', 'Last vacuum')}: ${when(r.last_vacuum)}`,
            }))} />
          </Section>
        </>
      );
    }}</ReportFrame>
  );
};

const Indexes: React.FC = () => {
  const { t } = useLanguage();
  const [schema, setSchema] = useState('public');
  const state = useReport<any>('indexes', { schema });
  return (
    <ReportFrame state={state} toolbar={<SchemaPicker schema={state.data?.schema || schema} schemas={state.data?.schemas || []} onChange={setSchema} />}>{(d) => (
      <>
        <div className="grid grid-cols-1 gap-g13 sm:grid-cols-3">
          <Stat label={t('pgr.unused_short', 'Unused')} value={number(d.unused.length)} />
          <Stat label={t('pgr.duplicate_short', 'Duplicate')} value={number(d.duplicate.length)} tone={d.duplicate.length === 0 ? 'success' : 'warning'} />
          <Stat label={t('pgr.invalid_short', 'Invalid')} value={number(d.invalid.length)} tone={d.invalid.length === 0 ? 'success' : 'danger'} />
        </div>
        <Section title={t('pgr.unused', 'Unused indexes')} note={t('pgr.unused_note', 'Never scanned since statistics were reset, largest first. Check the statistics are old enough before dropping anything.')}>
          <BarList empty={t('pgr.no_unused', 'No unused indexes.')} rows={(d.unused as Row[]).slice(0, 10).map((r) => ({ id: `${r.table}.${r.index}`, label: r.index, hint: r.table, value: r.size_bytes, display: bytes(r.size_bytes) }))} />
        </Section>
        {d.duplicate.length > 0 && (
          <Section title={t('pgr.duplicate', 'Duplicate indexes')} note={t('pgr.duplicate_note', 'Identical columns on the same table: one of each group can go.')}>
            <BarList empty="" rows={(d.duplicate as Row[]).slice(0, 10).map((r) => ({ id: `${r.table}.${(r.indexes as string[]).join()}`, label: (r.indexes as string[]).join(', '), hint: r.table, value: r.size_bytes, display: bytes(r.size_bytes), tone: 'warning' as const }))} />
          </Section>
        )}
        {d.invalid.length > 0 && (
          <Section title={t('pgr.invalid', 'Invalid indexes')} note={t('pgr.invalid_note', 'Left behind by a failed CREATE INDEX CONCURRENTLY. They cost writes and are never used.')}>
            <BarList empty="" rows={(d.invalid as Row[]).map((r) => ({ id: `${r.table}.${r.index}`, label: r.index, hint: r.table, value: r.size_bytes, display: bytes(r.size_bytes), tone: 'danger' as const }))} />
          </Section>
        )}
        {d.seqHeavy.length > 0 && (
          <Section title={t('pgr.seq_heavy', 'Read mostly by sequential scan')} note={t('pgr.seq_heavy_note', 'Over 1,000 rows and at least twice as many sequential as index scans. A missing index is possible.')}>
            <BarList empty="" rows={(d.seqHeavy as Row[]).slice(0, 8).map((r) => ({ id: r.table, label: r.table, hint: `${number(r.live_rows)} ${t('pgr.rows', 'rows')}`, value: r.seq_scans, display: number(r.seq_scans), tone: 'warning' as const, title: `${r.table}\n${t('pgr.seq_scans', 'Seq scans')} ${number(r.seq_scans)} · ${t('pgr.idx_scans', 'Index scans')} ${number(r.index_scans)}` }))} />
          </Section>
        )}
      </>
    )}</ReportFrame>
  );
};

const Queries: React.FC = () => {
  const { t } = useLanguage();
  const [sort, setSort] = useState('total');
  const state = useReport<any>('queries', { sort });
  const sorts: Array<[string, string]> = [['total', t('pgr.sort_total', 'Total time')], ['mean', t('pgr.sort_mean', 'Average time')], ['calls', t('pgr.sort_calls', 'Calls')], ['rows', t('pgr.sort_rows', 'Rows')]];
  const metric = (r: Row) => (sort === 'total' ? r.total_ms : sort === 'mean' ? r.mean_ms : sort === 'calls' ? r.calls : r.rows);
  const show = (r: Row) => (sort === 'total' || sort === 'mean' ? millis(metric(r)) : number(metric(r)));
  return (
    <ReportFrame state={state} toolbar={(
      <label className="flex items-center gap-g8 text-sm">
        <span className="shrink-0 whitespace-nowrap text-muted-foreground">{t('pgr.sort_by', 'Sort by')}</span>
        <NativeSelect className="w-auto min-w-40" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t('pgr.sort_by', 'Sort by')}>
          {sorts.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </NativeSelect>
      </label>
    )}>{(d) => d.available === false ? (
      <Alert status="warning" role="status"><AlertIndicator /><AlertContent><AlertDescription>{t('pgr.no_pss', 'The pg_stat_statements extension is not installed in this database, so query statistics are unavailable.')}</AlertDescription></AlertContent></Alert>
    ) : (
      <Section title={t('pgr.queries_title', 'Top statements')} note={t('pgr.queries_note', 'Hover a row for the full statement and its numbers. Text can contain business data.')}>
        <BarList mono empty={t('pgr.none', 'Nothing to show.')} rows={(d.rows as Row[]).slice(0, 12).map((r, index) => ({
          id: String(index), label: oneLine(r.query), value: metric(r), display: show(r), tone: sort === 'mean' && r.mean_ms >= 1000 ? 'danger' : sort === 'mean' && r.mean_ms >= 100 ? 'warning' : 'default',
          title: `${oneLine(r.query)}\n${t('pgr.calls', 'Calls')} ${number(r.calls)} · ${t('pgr.sort_total', 'Total time')} ${millis(r.total_ms)} · ${t('pgr.sort_mean', 'Average time')} ${millis(r.mean_ms)} · ${t('pgr.max', 'Max')} ${millis(r.max_ms)} · ${t('pgr.rows', 'Rows')} ${number(r.rows)}`,
        }))} />
      </Section>
    )}</ReportFrame>
  );
};

/** System Admin → PgReport: read-only PostgreSQL health, connections, tables, indexes and statements. */
export const PgReportTab: React.FC = () => {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Report>('overview');
  const labels: Record<Report, string> = {
    overview: t('pgr.tab_overview', 'Overview'), connections: t('pgr.tab_connections', 'Connections'), tables: t('pgr.tab_tables', 'Tables'),
    indexes: t('pgr.tab_indexes', 'Indexes'), queries: t('pgr.tab_queries', 'Queries'),
  };
  return (
    <div className="flex flex-col gap-g21">
      <Heading as="h2" size="md" weight="semibold">{t('pgr.nav', 'PgReport')}</Heading>
      <Tabs value={tab} onValueChange={(details) => setTab(details.value as Report)} className="gap-g21">
        <Card className="flex-row flex-wrap items-center gap-g13 p-g13">
          <TabsList aria-label={t('pgr.nav', 'PgReport')} className="w-full sm:w-auto">
            {REPORTS.map((report) => {
              const Icon = REPORT_ICONS[report];
              return <TabsTrigger key={report} value={report}><Icon aria-hidden="true" />{labels[report]}</TabsTrigger>;
            })}
          </TabsList>
        </Card>
        <TabsContent value="overview"><Overview /></TabsContent>
        <TabsContent value="connections"><Connections /></TabsContent>
        <TabsContent value="tables"><Tables /></TabsContent>
        <TabsContent value="indexes"><Indexes /></TabsContent>
        <TabsContent value="queries"><Queries /></TabsContent>
      </Tabs>
    </div>
  );
};
