import React from 'react';
import { ArrowUpRight, CalendarDays, ShieldCheck, type LucideIcon } from 'lucide-react';
import { SKY_INK, SkyGradient, skyPeriodAt } from '@legalio/ui-components/sky-gradient';
import { useLanguage } from '../context/LanguageContext';
import { Card, CardBody, CardHeader, CardLink, CardTitle } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { Text } from '@legalio/ui-components/text';

export interface OverviewMetric {
  label: string;
  value: number;
  total?: number;
  detail: string;
  icon: LucideIcon;
  tone: 'mint' | 'blue' | 'violet' | 'amber';
  onClick: () => void;
}

/** Soft glows share the overview's sky palette while keeping each metric identifiable. */
const TONES: Record<OverviewMetric['tone'], string> = {
  mint: '#83dfc4', blue: '#9ebdff', violet: '#c5aaff', amber: '#f3ca83',
};

export function DashboardOverview({ greeting, expiring, metrics }: {
  greeting: string;
  expiring: number;
  metrics: OverviewMetric[];
}) {
  const { t, language } = useLanguage();
  const today = new Date();
  const dateLabel = new Intl.DateTimeFormat(language === 'ID' ? 'id-ID' : language === 'ZH' ? 'zh-CN' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'long' }).format(today);
  const period = skyPeriodAt(today.getHours());
  return (
    <section className="grid grid-cols-1 gap-g13 xl:grid-cols-2" aria-label={t('ui.overview')}>
      <Card className="relative min-h-g233 justify-between gap-g21 overflow-hidden border-0 p-g21" style={{ color: SKY_INK[period].color, textShadow: SKY_INK[period].textShadow }}>
        <SkyGradient period={period} />
        <div aria-hidden="true" className="absolute inset-0" style={{ background: `linear-gradient(to top, ${SKY_INK[period].scrim} 0%, ${SKY_INK[period].scrim} 35%, transparent 100%)` }} />
        <div className="relative flex flex-wrap items-center justify-between gap-g13">
          <span className="inline-flex min-h-g34 items-center gap-g8 rounded-full bg-background/80 px-g13 py-g5 text-xs font-medium text-foreground backdrop-blur-md [text-shadow:none]"><ShieldCheck aria-hidden="true" />Legalio</span>
          <time dateTime={`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`} className="inline-flex min-h-g34 items-center gap-g8 rounded-full bg-background/80 px-g13 py-g5 text-xs font-medium text-foreground backdrop-blur-md [text-shadow:none]"><CalendarDays className="size-g13" aria-hidden="true" />{dateLabel}</time>
        </div>
        <div className="relative pt-g21 text-current">
          <Heading as="h2" size="lg" weight="bold" className="max-w-[20ch] text-current tracking-tight leading-tight">{greeting}</Heading>
          <Text size="sm" className="mt-g13 max-w-[42ch] leading-relaxed text-current">{expiring > 0 ? t('ui.review_summary', undefined, { count: expiring }) : t('ui.clear_summary')}</Text>
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-g13 sm:grid-cols-2">
      {metrics.map(({ label, value, total, detail, icon: Icon, tone, onClick }) => (
        <Card key={tone} size="sm" className="dashboard-overview-metric min-h-g144 justify-between" style={{ '--metric-accent': TONES[tone] } as React.CSSProperties}>
          <CardHeader className="relative items-center">
            <CardTitle className="text-sm font-semibold text-current">
              <CardLink href="#" onClick={event => { event.preventDefault(); onClick(); }}>{label}</CardLink>
            </CardTitle>
            <span className="dashboard-overview-metric-icon col-start-2 row-span-2 row-start-1 inline-flex size-g34 items-center justify-center rounded-lg" aria-hidden="true"><Icon className="size-g21" /></span>
          </CardHeader>
          <CardBody className="relative grid gap-g8 text-current">
            <span className="flex items-baseline gap-g8 text-2xl leading-g42 font-bold tabular-nums">
              {value}<Text as="span" size="xs" weight="semibold" className="text-current opacity-75">{total !== undefined ? `/ ${total}` : t('dashboard.need_notice')}</Text>
            </span>
            <span className="flex items-center justify-between gap-g8 border-t border-current/10 pt-g8 text-xs font-semibold text-current"><span>{detail}</span><ArrowUpRight className="size-g16 shrink-0" aria-hidden="true" /></span>
          </CardBody>
        </Card>
      ))}
      </div>
    </section>
  );
}
