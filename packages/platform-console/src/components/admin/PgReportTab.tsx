import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Activity, ChartLine, ListTree, Network, RefreshCw, SquareTerminal, Table2, type LucideIcon } from 'lucide-react';
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

/** The live charts pull in recharts, so they load only when their tab opens. */
const PgReportLive = lazy(() => import('./PgReportLive').then((m) => ({ default: m.PgReportLive })));

type Report = 'overview' | 'live' | 'connections' | 'tables' | 'indexes' | 'queries';
type Row = Record<string, any>;
interface ReportResponse<T> { report: string; generatedAt: string; data: T }

const REPORTS: Report[] = ['overview', 'live', 'connections', 'tables', 'indexes', 'queries'];
const REPORT_ICONS: Record<Report, LucideIcon> = { overview: Activity, live: ChartLine, connections: Network, tables: Table2, indexes: ListTree, queries: SquareTerminal };

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
/** Transaction IDs are 32-bit; past about 2.1 billion PostgreSQL stops accepting writes to avoid wraparound. */
const WRAPAROUND_LIMIT = 2 ** 31;
const WRAPAROUND_ZONES = [{ to: 0.2, tone: 'success' as const }, { to: 0.5, tone: 'warning' as const }, { to: 1, tone: 'danger' as const }];
/** A share that rounds to 0.0% still is not zero. */
const share = (value: number) => (value > 0 && value < 0.001 ? '<0.1%' : percent(value));
const secondsTone = (seconds: number) => (seconds >= 60 ? 'danger' as const : seconds >= 10 ? 'warning' as const : 'default' as const);

const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string; tone?: StatusTone }> = ({ label, value, hint, tone }) => (
  <Card className="flex flex-col gap-g5 p-g13">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="flex items-center gap-g8 text-lg font-semibold">{value}<ToneBadge tone={tone} /></span>
    {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
  </Card>
);

const TONE_STROKE: Record<string, string> = { success: 'stroke-status-success', warning: 'stroke-status-warning', danger: 'stroke-status-danger' };

/** Only a problem earns a badge; a healthy reading stays quiet so the warnings stand out. The word carries the state, not just the color. */
const ToneBadge: React.FC<{ tone?: StatusTone }> = ({ tone }) => {
  const { t } = useLanguage();
  if (tone !== 'warning' && tone !== 'danger') return null;
  return <Badge tone={tone}>{tone === 'warning' ? t('pgr.tone_warning', 'Check') : t('pgr.tone_danger', 'Critical')}</Badge>;
};

/** Point on the gauge's half circle for a 0–1 position, left to right. */
const arcPoint = (r: number, at: number) => {
  const angle = Math.PI * (1 - at);
  return { x: 100 + r * Math.cos(angle), y: 104 - r * Math.sin(angle) };
};
const arc = (r: number, from: number, to: number) => {
  const a = arcPoint(r, from);
  const b = arcPoint(r, to);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
};

interface GaugeZone { to: number; tone: 'success' | 'warning' | 'danger' }

/**
 * Half-circle gauge over a labelled scale. The thin outer ring shows the threshold zones, the thick arc fills to the reading in the
 * color of the zone it is in, and the badge names a problem state in words. Readings below `min` pin to the start of the scale.
 */
const Gauge: React.FC<{ label: string; value: number | null; min?: number; max?: number; zones: GaugeZone[]; display: string; minLabel: string; maxLabel: string; hint?: string }> = ({ label, value, min = 0, max = 1, zones, display, minLabel, maxLabel, hint }) => {
  const position = (v: number) => Math.min(1, Math.max(0, (v - min) / (max - min)));
  const at = value === null ? 0 : position(value);
  const tone = value === null ? undefined : (zones.find((zone) => value <= zone.to) ?? zones[zones.length - 1]).tone;
  let start = 0;
  const bands = zones.map((zone) => { const band = { from: start, to: position(zone.to), tone: zone.tone }; start = band.to; return band; }).filter((band) => band.to > band.from);
  return (
    <Card className="flex flex-col gap-g5 p-g13">
      <span className="flex items-center justify-between gap-g8 text-xs text-muted-foreground">{label}<ToneBadge tone={tone} /></span>
      <svg viewBox="0 0 200 128" className="mx-auto w-full max-w-g233" role="img" aria-label={`${label}: ${display}${hint ? `, ${hint}` : ''}`}>
        {bands.map((band) => <path key={band.from} d={arc(93, band.from, band.to)} fill="none" strokeWidth={4} className={`${TONE_STROKE[band.tone]} opacity-60`} />)}
        <path d={arc(76, 0, 1)} fill="none" strokeWidth={14} strokeLinecap="round" className="stroke-border" />
        {at >= 0.005 && <path d={arc(76, 0, at)} fill="none" strokeWidth={14} strokeLinecap="round" className={tone ? TONE_STROKE[tone] : 'stroke-primary'} />}
        <text x="100" y="98" textAnchor="middle" className="fill-foreground text-[24px] font-semibold tabular-nums">{display}</text>
        <text x="24" y="124" textAnchor="middle" className="fill-muted-foreground text-[11px] tabular-nums">{minLabel}</text>
        <text x="176" y="124" textAnchor="middle" className="fill-muted-foreground text-[11px] tabular-nums">{maxLabel}</text>
      </svg>
      {hint && <span className="text-center text-xs text-muted-foreground">{hint}</span>}
    </Card>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode; note?: string; action?: React.ReactNode }> = ({ title, children, note, action }) => (
  <section className="flex flex-col gap-g8">
    <div className="flex flex-wrap items-center justify-between gap-g8">
      <Heading as="h3" size="sm" weight="semibold">{title}</Heading>
      {action}
    </div>
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
            <Gauge label={t('pgr.connections', 'Connections')} value={usage} zones={[{ to: 0.7, tone: 'success' }, { to: 0.9, tone: 'warning' }, { to: 1, tone: 'danger' }]}
              display={`${d.connections.total} / ${d.server.max_connections}`} minLabel="0" maxLabel={String(d.server.max_connections)}
              hint={`${d.connections.active} ${t('pgr.active', 'active')} · ${d.connections.idle} ${t('pgr.idle', 'idle')}`} />
            <Gauge label={t('pgr.cache_hit', 'Cache hit ratio')} value={hit} min={0.9} zones={[{ to: 0.95, tone: 'danger' }, { to: 0.99, tone: 'warning' }, { to: 1, tone: 'success' }]}
              display={percent(hit)} minLabel="90%" maxLabel="100%" hint={t('pgr.cache_hint', 'Below 99% suggests too little memory')} />
            <Gauge label={t('pgr.xid_age', 'Transaction ID age')} value={d.health.xid_age / WRAPAROUND_LIMIT} zones={WRAPAROUND_ZONES}
              display={share(d.health.xid_age / WRAPAROUND_LIMIT)} minLabel="0%" maxLabel="100%" hint={`${number(d.health.xid_age)} ${t('pgr.xid_hint', 'transactions since the last freeze')}`} />
            <Gauge label={t('pgr.mxid_age', 'Multixact ID age')} value={d.health.mxid_age / WRAPAROUND_LIMIT} zones={WRAPAROUND_ZONES}
              display={share(d.health.mxid_age / WRAPAROUND_LIMIT)} minLabel="0%" maxLabel="100%" hint={`${number(d.health.mxid_age)} ${t('pgr.mxid_hint', 'multixacts since the last freeze')}`} />
          </div>
          <div className="grid grid-cols-2 gap-g13 lg:grid-cols-4">
            <Stat label={t('pgr.version', 'PostgreSQL')} value={d.server.version} hint={`${d.server.database} · ${d.health.in_recovery ? t('pgr.replica', 'Replica') : t('pgr.primary', 'Primary')}`} />
            <Stat label={t('pgr.uptime', 'Uptime')} value={uptime(d.server.started_at)} hint={when(d.server.started_at)} />
            <Stat label={t('pgr.db_size', 'Database size')} value={bytes(d.server.size_bytes)} />
            <Stat label={t('pgr.stats_since', 'Statistics since')} value={when(d.stats.stats_reset)} />
          </div>
          <Section title={t('pgr.activity_title', 'Activity')} note={t('pgr.activity_overview_note', 'Sessions are right now; the other counters run since statistics were reset.')}>
            <div className="grid grid-cols-2 gap-g13 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label={t('pgr.idle_tx', 'Idle in transaction')} value={number(d.connections.idle_in_transaction)} tone={d.connections.idle_in_transaction === 0 ? 'success' : 'warning'} hint={t('pgr.idle_tx_hint', 'Holds locks and blocks vacuum')} />
              <Stat label={t('pgr.lock_waits', 'Waiting on locks')} value={number(d.connections.waiting_on_locks)} tone={d.connections.waiting_on_locks === 0 ? 'success' : 'warning'} />
              <Stat label={t('pgr.deadlocks', 'Deadlocks')} value={number(d.stats.deadlocks)} tone={d.stats.deadlocks === 0 ? 'success' : 'danger'} />
              <Stat label={t('pgr.commits', 'Commits')} value={number(d.stats.commits)} />
              <Stat label={t('pgr.rollbacks', 'Rollbacks')} value={number(d.stats.rollbacks)} hint={percent(rollbackRatio)} />
              <Stat label={t('pgr.temp_files', 'Temp files')} value={number(d.stats.temp_files)} hint={bytes(d.stats.temp_bytes)} />
            </div>
          </Section>
          <Checkpoints c={d.checkpoints} />
          {d.replication.length > 0 && (
            <Section title={t('pgr.replication', 'Replication lag')} note={t('pgr.replication_note', 'WAL each standby has yet to replay.')}>
              <BarList empty="" rows={(d.replication as Row[]).map((r, index) => ({
                id: String(index), label: r.application_name || r.client_addr || '—', hint: [r.state, r.sync_state].filter(Boolean).join(' · '), value: r.lag_bytes ?? 0, display: bytes(r.lag_bytes),
                title: `${r.application_name || r.client_addr || '—'}\n${t('pgr.lag_time', 'Replay lag')} ${duration(r.lag_seconds)}`,
              }))} />
            </Section>
          )}
          {d.archiver && (
            <Section title={t('pgr.archiving', 'WAL archiving')}>
              <div className="grid grid-cols-1 gap-g13 sm:grid-cols-2">
                <Stat label={t('pgr.archived', 'Archived segments')} value={number(d.archiver.archived)} hint={`${t('pgr.last', 'Last')}: ${when(d.archiver.last_archived)}`} />
                <Stat label={t('pgr.archive_failed', 'Failed attempts')} value={number(d.archiver.failed)} tone={d.archiver.failed === 0 ? 'success' : 'warning'} hint={`${t('pgr.last', 'Last')}: ${when(d.archiver.last_failed)}`} />
              </div>
            </Section>
          )}
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
const Split: React.FC<{ parts: Array<{ label: string; value: number; fill: string; display?: string }> }> = ({ parts }) => {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const shown = (part: { value: number; display?: string }) => part.display ?? String(part.value);
  return (
    <Card className="flex flex-col gap-g13 p-g13">
      <div className="flex h-g21 w-full gap-[2px] overflow-hidden rounded-md" role="img" aria-label={parts.map((part) => `${part.label}: ${shown(part)}`).join(', ')}>
        {total === 0 ? <span className="h-full w-full bg-muted" /> : parts.filter((part) => part.value > 0).map((part) => (
          <span key={part.label} className={`h-full ${part.fill}`} style={{ width: `${(part.value / total) * 100}%` }} title={`${part.label}: ${shown(part)}`} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-g21 gap-y-g5 text-sm">
        {parts.map((part) => <li key={part.label} className="flex items-center gap-g8"><span className={`size-g8 rounded-full ${part.fill}`} aria-hidden="true" />{part.label} <span className="font-medium tabular-nums">{shown(part)}</span></li>)}
      </ul>
    </Card>
  );
};

/** Checkpoint and background-writer counters since their last reset. */
const Checkpoints: React.FC<{ c: Row }> = ({ c }) => {
  const { t } = useLanguage();
  const total = c.timed + c.requested;
  const requestedShare = total > 0 ? c.requested / total : 0;
  const writes = [
    { label: t('pgr.written_cp', 'Written by checkpoints'), value: c.checkpoint_bytes ?? 0, display: bytes(c.checkpoint_bytes), fill: 'bg-primary' },
    { label: t('pgr.written_bg', 'Written by background writer'), value: c.bgwriter_bytes ?? 0, display: bytes(c.bgwriter_bytes), fill: 'bg-primary/40' },
    ...(c.backend_bytes === null ? [] : [{ label: t('pgr.written_backend', 'Written by backends'), value: c.backend_bytes, display: bytes(c.backend_bytes), fill: 'bg-status-warning' }]),
  ];
  return (
    <Section title={t('pgr.checkpoints', 'Checkpoints & background writer')} note={`${t('pgr.checkpoints_note', 'Counted since')} ${when(c.stats_reset)}. ${t('pgr.checkpoints_hint', 'Many requested checkpoints mean max_wal_size is small for the write load; many backend writes mean shared_buffers or the background writer cannot keep up.')}`}>
      <div className="grid grid-cols-2 gap-g13 lg:grid-cols-4">
        <Stat label={t('pgr.cp_timed', 'Timed checkpoints')} value={number(c.timed)} />
        <Stat label={t('pgr.cp_requested', 'Requested checkpoints')} value={number(c.requested)} hint={`${percent(requestedShare)} ${t('pgr.of_all', 'of all')}`}
          tone={total === 0 ? undefined : requestedShare < 0.1 ? 'success' : requestedShare < 0.3 ? 'warning' : 'danger'} />
        <Stat label={t('pgr.cp_write', 'Write time per checkpoint')} value={millis(total > 0 ? c.write_ms / total : null)} hint={`${t('pgr.cp_sync', 'Sync')} ${millis(total > 0 ? c.sync_ms / total : null)}`} />
        <Stat label={t('pgr.bg_stopped', 'Background writer stopped early')} value={number(c.maxwritten_clean)} hint={t('pgr.bg_stopped_hint', 'Times it hit bgwriter_lru_maxpages')} />
      </div>
      {/* A split with a single non-empty part is just a full bar; the numbers then say it better. */}
      {writes.filter((part) => part.value > 0).length > 1 ? <Split parts={writes} /> : (
        <p className="text-xs text-muted-foreground">{writes.map((part) => `${part.label}: ${part.display}`).join(' · ')}</p>
      )}
    </Section>
  );
};

interface Tile { id: string; label: string; value: number; display: string; title: string; x: number; y: number; w: number; h: number }
const MAP_W = 100;
const MAP_H = 60;

/** Squarified treemap (Bruls et al.): fills rows along the shorter side while that keeps tiles close to square. Values must be sorted largest first. */
function squarify(items: Array<Omit<Tile, 'x' | 'y' | 'w' | 'h'>>): Tile[] {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) return [];
  const scaled = items.map((item) => ({ item, area: (item.value / total) * MAP_W * MAP_H }));
  const out: Tile[] = [];
  let rect = { x: 0, y: 0, w: MAP_W, h: MAP_H };
  const worst = (row: typeof scaled, side: number) => {
    const sum = row.reduce((acc, r) => acc + r.area, 0);
    const areas = row.map((r) => r.area);
    return Math.max((side * side * Math.max(...areas)) / (sum * sum), (sum * sum) / (side * side * Math.min(...areas)));
  };
  const place = (row: typeof scaled) => {
    const sum = row.reduce((acc, r) => acc + r.area, 0);
    if (rect.w >= rect.h) {
      const width = sum / rect.h;
      let y = rect.y;
      for (const r of row) { const h = r.area / width; out.push({ ...r.item, x: rect.x, y, w: width, h }); y += h; }
      rect = { x: rect.x + width, y: rect.y, w: rect.w - width, h: rect.h };
    } else {
      const height = sum / rect.w;
      let x = rect.x;
      for (const r of row) { const w = r.area / height; out.push({ ...r.item, x, y: rect.y, w, h: height }); x += w; }
      rect = { x: rect.x, y: rect.y + height, w: rect.w, h: rect.h - height };
    }
  };
  let row: typeof scaled = [];
  for (const next of scaled) {
    const side = Math.min(rect.w, rect.h);
    if (row.length === 0 || worst([...row, next], side) <= worst(row, side)) row.push(next);
    else { place(row); row = [next]; }
  }
  if (row.length) place(row);
  return out;
}

/**
 * Area carries the magnitude; the fill repeats it as one hue from light (small) to dark (large) so the big tables read at a glance.
 * A 2px surface gap separates tiles. Labels show only where they fit; hover shows the rest.
 */
const Treemap: React.FC<{ items: Array<Omit<Tile, 'x' | 'y' | 'w' | 'h'>>; label: string; empty: string }> = ({ items, label, empty }) => {
  const tiles = squarify(items.filter((item) => item.value > 0));
  if (tiles.length === 0) return <Card className="p-g21 text-sm text-muted-foreground">{empty}</Card>;
  const largest = tiles[0].value;
  return (
    <Card className="p-g13">
      <div className="relative aspect-[5/3] w-full" role="img" aria-label={`${label}: ${tiles.map((tile) => `${tile.label} ${tile.display}`).join(', ')}`}>
        {tiles.map((tile) => (
          <div key={tile.id} title={tile.title} className="absolute p-px"
            style={{ left: `${(tile.x / MAP_W) * 100}%`, top: `${(tile.y / MAP_H) * 100}%`, width: `${(tile.w / MAP_W) * 100}%`, height: `${(tile.h / MAP_H) * 100}%` }}>
            <div className="flex h-full w-full flex-col overflow-hidden rounded-sm border border-primary/30 p-g5 hover:brightness-95"
              style={{ background: `color-mix(in oklab, var(--moduix-primary) ${Math.round(10 + 40 * Math.sqrt(tile.value / largest))}%, var(--moduix-card))` }}>
              {tile.w >= 10 && tile.h >= 6 && (
                <>
                  <span className="truncate text-xs font-medium">{tile.label}</span>
                  <span className="truncate text-xs tabular-nums text-muted-foreground">{tile.display}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
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
      const transactions = (d.sessions as Row[]).filter((s) => s.transaction_seconds !== null).sort((a, b) => b.transaction_seconds - a.transaction_seconds).slice(0, 8);
      const lockModes = new Map<string, { granted: number; waiting: number }>();
      for (const l of d.locks as Row[]) {
        const entry = lockModes.get(l.mode) ?? { granted: 0, waiting: 0 };
        if (l.granted) entry.granted += l.count; else entry.waiting += l.count;
        lockModes.set(l.mode, entry);
      }
      const locks = [...lockModes].map(([mode, c]) => ({ mode, ...c, total: c.granted + c.waiting })).sort((a, b) => b.total - a.total);
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
              id: String(s.pid), label: oneLine(s.query), hint: s.user, value: s.query_seconds, display: duration(s.query_seconds), tone: secondsTone(s.query_seconds), title: `PID ${s.pid} · ${s.user}\n${oneLine(s.query)}`,
            }))} />
          </Section>
          <Section title={t('pgr.longest_tx', 'Longest open transactions')} note={t('pgr.longest_tx_note', 'Open transactions in any state. A long one, especially idle in transaction, holds locks and keeps vacuum from cleaning up.')}>
            <BarList mono empty={t('pgr.no_tx', 'No transaction is open right now.')} rows={transactions.map((s) => ({
              id: String(s.pid), label: oneLine(s.query), hint: `${s.state ?? '—'} · ${s.user}`, value: s.transaction_seconds, display: duration(s.transaction_seconds), tone: secondsTone(s.transaction_seconds),
              title: `PID ${s.pid} · ${s.user} · ${s.state ?? '—'}\n${oneLine(s.query)}`,
            }))} />
          </Section>
          <Section title={t('pgr.locks', 'Locks by mode')} note={t('pgr.locks_note', 'Every lock held or awaited on the server right now. Waiting locks are marked.')}>
            <BarList empty={t('pgr.no_locks', 'No locks are held right now.')} rows={locks.map((l) => ({
              id: l.mode, label: l.mode, hint: l.waiting > 0 ? `${number(l.waiting)} ${t('pgr.waiting', 'waiting')}` : undefined, value: l.total, display: number(l.total), tone: l.waiting > 0 ? 'warning' as const : 'default' as const,
              title: `${l.mode}\n${t('pgr.granted', 'Granted')} ${number(l.granted)} · ${t('pgr.waiting', 'waiting')} ${number(l.waiting)}`,
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

const Picker: React.FC<{ label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }> = ({ label, value, options, onChange }) => (
  <label className="flex items-center gap-g8 text-sm">
    <span className="shrink-0 whitespace-nowrap text-muted-foreground">{label}</span>
    <NativeSelect className="w-auto min-w-40" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
    </NativeSelect>
  </label>
);

type SizeKey = 'total_bytes' | 'table_bytes' | 'index_bytes';
type ActivityKey = 'inserts' | 'updates' | 'deletes' | 'seq_scans';

const Tables: React.FC = () => {
  const { t } = useLanguage();
  const [schema, setSchema] = useState('public');
  const [size, setSize] = useState<SizeKey>('total_bytes');
  const [activity, setActivity] = useState<ActivityKey>('inserts');
  const state = useReport<any>('tables', { schema });
  const sizes: Array<[SizeKey, string]> = [['total_bytes', t('pgr.size_total', 'Total')], ['table_bytes', t('pgr.data_size', 'Data')], ['index_bytes', t('pgr.index_size', 'Indexes')]];
  const activities: Array<[ActivityKey, string]> = [['inserts', t('pgr.inserts', 'Inserts')], ['updates', t('pgr.updates', 'Updates')], ['deletes', t('pgr.deletes', 'Deletes')], ['seq_scans', t('pgr.seq_scans', 'Seq scans')]];
  return (
    <ReportFrame state={state} toolbar={<SchemaPicker schema={state.data?.schema || schema} schemas={state.data?.schemas || []} onChange={setSchema} />}>{(d) => {
      const rows = d.tables as Row[];
      const bloated = rows.filter((r) => r.dead_ratio > 0).sort((a, b) => b.dead_ratio - a.dead_ratio).slice(0, 8);
      // Every table gets its own tile (the report returns at most 100): an "Other" bucket of many small tables outgrew the real ones.
      const tiles = rows.filter((r) => r[size] > 0).sort((a, b) => b[size] - a[size]).map((r) => ({
        id: r.name, label: r.name, value: r[size], display: bytes(r[size]),
        title: `${r.name} · ${number(r.live_rows)} ${t('pgr.rows', 'rows')}\n${t('pgr.size_total', 'Total')} ${bytes(r.total_bytes)} · ${t('pgr.data_size', 'Data')} ${bytes(r.table_bytes)} · ${t('pgr.index_size', 'Indexes')} ${bytes(r.index_bytes)}`,
      }));
      // Autovacuum's default trigger: 50 rows plus 20% of the table. Small tables cross 50% dead easily and that is not a problem.
      const vacuumDue = (r: Row) => r.dead_rows > 50 + 0.2 * r.live_rows;
      const busiest = rows.filter((r) => r[activity] > 0).sort((a, b) => b[activity] - a[activity]).slice(0, 8);
      const readBytes = (r: Row) => (r.heap_read_bytes ?? 0) + (r.index_read_bytes ?? 0) + (r.toast_read_bytes ?? 0);
      const readHeavy = rows.filter((r) => readBytes(r) > 0).sort((a, b) => readBytes(b) - readBytes(a)).slice(0, 8);
      return (
        <>
          <Section title={t('pgr.size_map', 'Table size map')} note={t('pgr.size_map_note', 'Each tile’s area is the table’s share of the schema. Hover a tile for its sizes.')}
            action={<Picker label={t('pgr.size_by', 'Size')} value={size} options={sizes} onChange={(value) => setSize(value as SizeKey)} />}>
            <Treemap label={t('pgr.size_map', 'Table size map')} items={tiles} empty={t('pgr.none', 'Nothing to show.')} />
          </Section>
          <Section title={t('pgr.dead_title', 'Dead tuples')} note={t('pgr.dead_note', 'Share of rows waiting for vacuum (estimate). Marked when autovacuum is due (more than 50 rows plus 20% of the table are dead); critical when that is also over 1,000 rows.')}>
            <BarList empty={t('pgr.no_dead', 'No table has dead tuples.')} rows={bloated.map((r) => ({
              id: r.name, label: r.name, hint: `${number(r.dead_rows)} ${t('pgr.dead_rows', 'dead')}${vacuumDue(r) ? ` · ${t('pgr.vacuum_due', 'vacuum due')}` : ''}`, value: r.dead_ratio, display: percent(r.dead_ratio),
              tone: !vacuumDue(r) ? 'default' : r.dead_rows >= 1000 ? 'danger' : 'warning',
              title: `${r.name}\n${t('pgr.last_vacuum', 'Last vacuum')}: ${when(r.last_vacuum)}`,
            }))} />
          </Section>
          <Section title={t('pgr.activity', 'Busiest tables')} note={t('pgr.activity_note', 'Rows written or sequential scans since statistics were reset, among the largest 100 tables.')}
            action={<Picker label={t('pgr.activity_by', 'Activity')} value={activity} options={activities} onChange={(value) => setActivity(value as ActivityKey)} />}>
            <BarList empty={t('pgr.none', 'Nothing to show.')} rows={busiest.map((r) => ({
              id: r.name, label: r.name, hint: bytes(r.total_bytes), value: r[activity], display: number(r[activity]),
              title: `${r.name}\n${t('pgr.inserts', 'Inserts')} ${number(r.inserts)} · ${t('pgr.updates', 'Updates')} ${number(r.updates)} · ${t('pgr.deletes', 'Deletes')} ${number(r.deletes)} · ${t('pgr.seq_scans', 'Seq scans')} ${number(r.seq_scans)} · ${t('pgr.idx_scans', 'Index scans')} ${number(r.index_scans)}`,
            }))} />
          </Section>
          <Section title={t('pgr.disk_reads', 'Most read from disk')} note={t('pgr.disk_reads_note', 'Blocks read outside shared buffers (from the OS cache or disk), table plus indexes and TOAST. High numbers with a low cache hit ratio point to too little memory.')}>
            <BarList empty={t('pgr.none', 'Nothing to show.')} rows={readHeavy.map((r) => ({
              id: r.name, label: r.name, hint: `${t('pgr.cache_hit_short', 'hit')} ${percent(r.cache_hit_ratio)}`, value: readBytes(r), display: bytes(readBytes(r)),
              tone: r.cache_hit_ratio !== null && r.cache_hit_ratio < 0.95 ? 'warning' as const : 'default' as const,
              title: `${r.name}\n${t('pgr.read_heap', 'Table')} ${bytes(r.heap_read_bytes)} · ${t('pgr.index_size', 'Indexes')} ${bytes(r.index_read_bytes)} · TOAST ${bytes(r.toast_read_bytes)}`,
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
    overview: t('pgr.tab_overview', 'Overview'), live: t('pgr.tab_live', 'Live'), connections: t('pgr.tab_connections', 'Connections'), tables: t('pgr.tab_tables', 'Tables'),
    indexes: t('pgr.tab_indexes', 'Indexes'), queries: t('pgr.tab_queries', 'Queries'),
  };
  return (
    <div className="flex flex-col gap-g21">
      <Heading as="h2" size="md" weight="semibold">{t('pgr.nav', 'PgReport')}</Heading>
      <Tabs value={tab} onValueChange={(details) => setTab(details.value as Report)} className="gap-g21">
        {/* Six tabs do not fit a phone; the list scrolls sideways inside the card instead of being cut off. */}
        <Card className="overflow-x-auto p-g13">
          <TabsList aria-label={t('pgr.nav', 'PgReport')} className="w-max">
            {REPORTS.map((report) => {
              const Icon = REPORT_ICONS[report];
              return <TabsTrigger key={report} value={report}><Icon aria-hidden="true" />{labels[report]}</TabsTrigger>;
            })}
          </TabsList>
        </Card>
        <TabsContent value="overview"><Overview /></TabsContent>
        <TabsContent value="live">
          {tab === 'live' && (
            <Suspense fallback={<div role="status" className="flex min-h-g233 items-center justify-center gap-g8 text-sm text-muted-foreground"><Spinner size="sm" decorative />{t('pgr.loading', 'Loading report…')}</div>}>
              <PgReportLive />
            </Suspense>
          )}
        </TabsContent>
        <TabsContent value="connections"><Connections /></TabsContent>
        <TabsContent value="tables"><Tables /></TabsContent>
        <TabsContent value="indexes"><Indexes /></TabsContent>
        <TabsContent value="queries"><Queries /></TabsContent>
      </Tabs>
    </div>
  );
};
