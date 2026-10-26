import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiRequest } from '@legalio/shared/apiClient';
import { useLanguage } from '../../context/LanguageContext';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';

const INTERVAL_MS = 5_000;
/** 120 samples at 5 s = the last 10 minutes. */
const MAX_POINTS = 120;

/**
 * Categorical slots 1–4 of the validated reference palette, light and dark steps (light-dark() follows the app's color scheme).
 * Assigned in fixed order per chart. Slots 3 and 4 sit under 3:1 on the light card, so every chart's legend always prints its values.
 */
const SERIES_VARS = {
  '--pgr-s1': 'light-dark(#2a78d6, #3987e5)',
  '--pgr-s2': 'light-dark(#eb6834, #d95926)',
  '--pgr-s3': 'light-dark(#1baf7a, #199e70)',
  '--pgr-s4': 'light-dark(#eda100, #c98500)',
} as React.CSSProperties;
const SLOT = ['var(--pgr-s1)', 'var(--pgr-s2)', 'var(--pgr-s3)', 'var(--pgr-s4)'];

interface Sample {
  at_ms: number; commits: number; rollbacks: number; inserted: number; updated: number; deleted: number; blocks_hit: number; blocks_read: number;
  temp_bytes: number; wal_bytes: number | null; active: number; idle: number; idle_in_transaction: number; waiting: number; longest_tx_seconds: number; statements: number | null;
}
type Point = Record<string, number | null> & { t: number };

const rate = (now: number | null, before: number | null, seconds: number) => (now === null || before === null || now < before ? null : (now - before) / seconds);

/** Rates come from the difference between two consecutive samples; a counter that went backwards (stats reset) yields a gap. */
function toPoint(now: Sample, before: Sample): Point {
  const seconds = (now.at_ms - before.at_ms) / 1000;
  const hit = now.blocks_hit - before.blocks_hit;
  const read = now.blocks_read - before.blocks_read;
  return {
    t: now.at_ms,
    commits: rate(now.commits, before.commits, seconds), rollbacks: rate(now.rollbacks, before.rollbacks, seconds),
    qps: rate(now.statements, before.statements, seconds),
    inserted: rate(now.inserted, before.inserted, seconds), updated: rate(now.updated, before.updated, seconds), deleted: rate(now.deleted, before.deleted, seconds),
    hit: hit >= 0 && read >= 0 && hit + read > 0 ? hit / (hit + read) : null,
    wal: rate(now.wal_bytes, before.wal_bytes, seconds), temp: rate(now.temp_bytes, before.temp_bytes, seconds),
    active: now.active, idle_in_transaction: now.idle_in_transaction, waiting: now.waiting, idle: now.idle, longest: now.longest_tx_seconds,
  };
}

const perSecond = (value: number) => (value >= 100 ? Math.round(value).toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 1 }));
const bytesPerSecond = (value: number) => {
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
};
/** Axis ticks need to stay on one line in a narrow gutter: no decimals once a number has two digits, and the chart title carries "per second". */
const compact = (value: number) => (Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : perSecond(value));
const compactBytes = (value: number) => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
};
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const pctTick = (value: number) => `${(value * 100).toFixed(1)}%`;
const secs = (value: number) => (value < 120 ? `${value.toFixed(1)} s` : `${Math.round(value / 60)} min`);
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

interface SeriesDef { key: string; label: string }
type AxisBound = number | string | ((value: number) => number);
/** A ratio axis tops out at 100% and starts a little under the lowest reading, so a dip from 99.9% to 98% is visible. */
const RATIO_DOMAIN: [AxisBound, AxisBound] = [(min: number) => Math.max(0, Math.floor(min * 100 - 1) / 100), 1];
/** A quiet byte counter would otherwise get a 0–4 B scale; at least 1 KB keeps the axis meaningful. */
const BYTES_DOMAIN: [AxisBound, AxisBound] = [0, (max: number) => Math.max(max, 1024)];

/**
 * One time-series panel. `kind` picks the mark: 'area' fills single measures, 'stacked' stacks parts of a whole, 'line' compares series.
 * The legend sits above the plot in text colors with each series' latest value; the colored dash carries identity.
 */
const TimeChart: React.FC<{ title: string; note?: string; points: Point[]; series: SeriesDef[]; kind: 'area' | 'stacked' | 'line'; format: (value: number) => string; tick?: (value: number) => string; domain?: [AxisBound, AxisBound] }> = ({ title, note, points, series, kind, format, tick = format, domain }) => {
  // The newest interval can be a gap (counter reset, first sample after a pause); the legend shows the latest real value instead.
  const latest = (key: string) => { for (let i = points.length - 1; i >= 0; i -= 1) if (points[i][key] !== null && points[i][key] !== undefined) return points[i][key]; return null; };
  const axis = { stroke: 'var(--moduix-border)', tick: { fill: 'var(--moduix-muted-foreground)', fontSize: 11 }, tickLine: false };
  const common = { data: points, margin: { top: 8, right: 8, bottom: 0, left: 0 } };
  const children = (
    <>
      <CartesianGrid stroke="var(--moduix-border)" strokeOpacity={0.6} vertical={false} />
      <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={clock} minTickGap={48} tickMargin={6} {...axis} />
      <YAxis width={56} tickFormatter={(value: number) => tick(value)} domain={domain} allowDecimals {...axis} axisLine={false} />
      <Tooltip
        isAnimationActive={false}
        cursor={{ stroke: 'var(--moduix-muted-foreground)', strokeWidth: 1 }}
        labelFormatter={(value) => clock(Number(value))}
        formatter={(value, name) => [value === null || value === undefined ? '—' : format(Number(value)), series.find((s) => s.key === name)?.label ?? String(name)]}
        contentStyle={{ background: 'var(--moduix-popover)', border: '1px solid var(--moduix-border)', borderRadius: 8, color: 'var(--moduix-popover-foreground)', fontSize: 12 }}
        labelStyle={{ color: 'var(--moduix-muted-foreground)' }}
        itemStyle={{ color: 'var(--moduix-popover-foreground)' }}
      />
      {series.map((s, index) => kind === 'line'
        ? <Line key={s.key} dataKey={s.key} type="monotone" stroke={SLOT[index]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: 'var(--moduix-card)', strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />
        : <Area key={s.key} dataKey={s.key} type="monotone" stackId={kind === 'stacked' ? 'stack' : undefined} stroke={SLOT[index]} strokeWidth={2} fill={SLOT[index]} fillOpacity={kind === 'stacked' ? 0.35 : 0.18}
            activeDot={{ r: 4, stroke: 'var(--moduix-card)', strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />)}
    </>
  );
  return (
    <Card className="flex min-w-0 flex-col gap-g8 p-g13">
      <div className="flex flex-col gap-g5">
        <Heading as="h3" size="sm" weight="semibold">{title}</Heading>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
        <ul className="flex flex-wrap gap-x-g13 gap-y-g5 text-xs">
          {series.map((s, index) => {
            const value = latest(s.key);
            return (
              <li key={s.key} className="flex items-center gap-g5">
                <span className="h-[2px] w-g13 rounded-full" style={{ background: SLOT[index] }} aria-hidden="true" />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="font-medium tabular-nums">{value === null || value === undefined ? '—' : format(value)}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="h-g233 w-full">
        {points.length < 2 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">…</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {kind === 'line' ? <LineChart {...common}>{children}</LineChart> : <AreaChart {...common}>{children}</AreaChart>}
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
};

/** PgReport → Live: polls the cheap `live` report while the tab is open and plots the last ten minutes. Nothing is stored server-side. */
export const PgReportLive: React.FC = () => {
  const { t } = useLanguage();
  const [points, setPoints] = useState<Point[]>([]);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statements, setStatements] = useState(true);
  const previous = useRef<Sample | null>(null);
  // `t` is a new function whenever the language provider renders; as an effect dependency it would restart the poll and fire extra samples.
  const translate = useRef(t);
  translate.current = t;

  useEffect(() => {
    if (paused) return undefined;
    let cancelled = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const response = await apiRequest<{ data: Sample }>('/auth-console/pg-reports/live', { method: 'GET', cache: 'no-store' });
        if (cancelled) return;
        const sample = response.data;
        setStatements(sample.statements !== null);
        if (previous.current) {
          const point = toPoint(sample, previous.current);
          setPoints((list) => [...list, point].slice(-MAX_POINTS));
        }
        previous.current = sample;
        setError(null);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || translate.current('pgr.live_error', 'The live sample could not be loaded.'));
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [paused]);

  // A pause leaves a hole in the counters; the next sample starts a fresh baseline instead of averaging over the gap.
  const toggle = () => { previous.current = null; setPaused((value) => !value); };

  return (
    <div className="flex flex-col gap-g21" style={SERIES_VARS}>
      <div className="flex flex-wrap items-center justify-between gap-g8">
        <p className="text-xs text-muted-foreground">
          {t('pgr.live_note', 'Sampled every 5 seconds while this tab is open, last 10 minutes. History is not stored and clears when you leave.')}
        </p>
        <Button variant="outline" size="sm" type="button" onClick={toggle}>
          {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}{paused ? t('pgr.resume', 'Resume') : t('pgr.pause', 'Pause')}
        </Button>
      </div>
      {error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}
      <div className="grid grid-cols-1 gap-g13 lg:grid-cols-2">
        <TimeChart title={t('pgr.tps', 'Transactions per second')} kind="area" points={points} format={perSecond} tick={compact}
          series={[{ key: 'commits', label: t('pgr.commits', 'Commits') }, { key: 'rollbacks', label: t('pgr.rollbacks', 'Rollbacks') }]} />
        {statements ? (
          <TimeChart title={t('pgr.qps', 'Queries per second')} note={t('pgr.qps_note', 'Statement calls counted by pg_stat_statements.')} kind="area" points={points} format={perSecond} tick={compact}
            series={[{ key: 'qps', label: t('pgr.statements', 'Statements') }]} />
        ) : (
          <Card className="flex items-center p-g21 text-sm text-muted-foreground">{t('pgr.no_pss', 'The pg_stat_statements extension is not installed in this database, so query statistics are unavailable.')}</Card>
        )}
        <TimeChart title={t('pgr.sessions', 'Sessions by state')} kind="stacked" points={points} format={(value) => Math.round(value).toLocaleString()}
          series={[{ key: 'active', label: t('pgr.active', 'active') }, { key: 'idle_in_transaction', label: t('pgr.idle_tx', 'Idle in transaction') }, { key: 'waiting', label: t('pgr.waiting', 'waiting') }, { key: 'idle', label: t('pgr.idle', 'idle') }]} />
        <TimeChart title={t('pgr.rows_written', 'Rows written per second')} kind="line" points={points} format={perSecond} tick={compact}
          series={[{ key: 'inserted', label: t('pgr.inserts', 'Inserts') }, { key: 'updated', label: t('pgr.updates', 'Updates') }, { key: 'deleted', label: t('pgr.deletes', 'Deletes') }]} />
        <TimeChart title={t('pgr.cache_hit', 'Cache hit ratio')} note={t('pgr.cache_live_note', 'Share of block reads served from shared buffers in each interval.')} kind="line" points={points} format={pct} tick={pctTick}
          domain={RATIO_DOMAIN} series={[{ key: 'hit', label: t('pgr.hit', 'Hit ratio') }]} />
        <TimeChart title={t('pgr.wal_rate', 'WAL generated per second')} kind="area" points={points} format={bytesPerSecond} tick={compactBytes} domain={BYTES_DOMAIN} series={[{ key: 'wal', label: 'WAL' }]} />
        <TimeChart title={t('pgr.temp_rate', 'Temp files written per second')} note={t('pgr.temp_live_note', 'Sorts and hashes that spilled to disk. Steady traffic here suggests work_mem is low.')} kind="area" points={points} format={bytesPerSecond} tick={compactBytes} domain={BYTES_DOMAIN}
          series={[{ key: 'temp', label: t('pgr.temp_files', 'Temp files') }]} />
        <TimeChart title={t('pgr.longest_tx', 'Longest open transactions')} kind="line" points={points} format={secs} series={[{ key: 'longest', label: t('pgr.longest_now', 'Longest') }]} />
      </div>
    </div>
  );
};
