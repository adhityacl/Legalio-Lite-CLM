import React from 'react';
import { ArrowUpRight, ShieldCheck, type LucideIcon } from 'lucide-react';
import { SKY_INK, SkyGradient, skyPeriodAt } from '@legalio/ui-components/sky-gradient';
import { useLanguage } from '../context/LanguageContext';
import { Card, CardBody, CardHeader, CardLink, CardTitle } from '@legalio/ui-components/card';
import { Badge } from '@legalio/ui-components/badge';
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

/** Metric tones map to the product status palette (consumer utilities on moduix Card parts). */
const TONES: Record<OverviewMetric['tone'], { card: string; icon: string }> = {
  mint: { card: 'border-0 bg-status-success-soft text-status-success', icon: 'bg-card text-status-success' },
  blue: { card: 'border-0 bg-status-info-soft text-status-info', icon: 'bg-card text-status-info' },
  violet: { card: 'border-0 bg-status-special-soft text-status-special', icon: 'bg-card text-status-special' },
  amber: { card: 'border-0 bg-status-warning-soft text-status-warning', icon: 'bg-card text-status-warning' },
};

export function DashboardOverview({ greeting, expiring, metrics }: {
  greeting: string;
  expiring: number;
  metrics: OverviewMetric[];
}) {
  const { t } = useLanguage();
  const period = skyPeriodAt(new Date().getHours());
  return (
    <section className="grid grid-cols-1 gap-g13 xl:grid-cols-2" aria-label={t('ui.overview')}>
      <Card className="relative min-h-g233 justify-between overflow-hidden border-0" style={{ color: SKY_INK[period].color, textShadow: SKY_INK[period].textShadow }}>
        <SkyGradient period={period} />
        <div aria-hidden="true" className="absolute inset-0" style={{ background: `linear-gradient(to top, ${SKY_INK[period].scrim} 0%, ${SKY_INK[period].scrim} 35%, transparent 100%)` }} />
        <CardHeader className="relative grid-cols-1">
          <Badge className="justify-self-start border-foreground/20 bg-background/80 text-foreground [text-shadow:none]"><ShieldCheck aria-hidden="true" />{t('ui.overview')}</Badge>
        </CardHeader>
        <CardBody className="relative text-current">
          <Heading as="h2" size="md" weight="bold" className="text-current">{greeting}</Heading>
          <Text size="sm" className="mt-g5 max-w-g610 text-current">{expiring > 0 ? t('ui.review_summary', undefined, { count: expiring }) : t('ui.clear_summary')}</Text>
        </CardBody>
      </Card>
      <div className="grid grid-cols-1 gap-g13 sm:grid-cols-2">
      {metrics.map(({ label, value, total, detail, icon: Icon, tone, onClick }) => (
        <Card key={tone} size="sm" className={`dashboard-metric h-g144 justify-between ${TONES[tone].card}`}>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-current">
              <CardLink href="#" onClick={event => { event.preventDefault(); onClick(); }}>{label}</CardLink>
            </CardTitle>
            <span className={`col-start-2 row-span-2 row-start-1 inline-flex size-g34 items-center justify-center rounded-md ${TONES[tone].icon}`} aria-hidden="true"><Icon className="size-g21" /></span>
          </CardHeader>
          <CardBody className="grid gap-g8 text-current">
            <span className="flex items-baseline gap-g8 text-2xl leading-g42 font-bold tabular-nums">
              {value}<Text as="span" size="xs" weight="medium" className="text-current">{total !== undefined ? `/ ${total}` : t('dashboard.need_notice')}</Text>
            </span>
            <span className="flex items-center justify-between gap-g8 text-xs font-medium"><span>{detail}</span><ArrowUpRight className="size-g16 shrink-0" aria-hidden="true" /></span>
          </CardBody>
        </Card>
      ))}
      </div>
    </section>
  );
}
