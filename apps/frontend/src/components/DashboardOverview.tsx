import React from 'react';
import { ArrowUpRight, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { Card, CardBody, CardHeader, CardLink, CardTitle } from '@legalio/ui-components/card';
import { Badge } from '@legalio/ui-components/badge';
import { Heading } from '@legalio/ui-components/heading';
import { Text } from '@legalio/ui-components/text';
import { ProgressLinear, ProgressLinearRange, ProgressLinearTrack } from '@legalio/ui-components/progress-linear';

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
const TONES: Record<OverviewMetric['tone'], { card: string; icon: string; range: string }> = {
  mint: { card: 'border-status-success-border bg-status-success-soft text-status-success', icon: 'bg-card text-status-success', range: 'bg-status-success' },
  blue: { card: 'border-status-info-border bg-status-info-soft text-status-info', icon: 'bg-card text-status-info', range: 'bg-status-info' },
  violet: { card: 'border-status-special-border bg-status-special-soft text-status-special', icon: 'bg-card text-status-special', range: 'bg-status-special' },
  amber: { card: 'border-status-warning-border bg-status-warning-soft text-status-warning', icon: 'bg-card text-status-warning', range: 'bg-status-warning' },
};

export function DashboardOverview({ greeting, expiring, metrics }: {
  greeting: string;
  expiring: number;
  metrics: OverviewMetric[];
}) {
  const { t } = useLanguage();
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[1.45fr_1fr_1fr]" aria-label={t('ui.overview')}>
      <Card className="justify-between border-primary bg-primary text-primary-foreground sm:col-span-2 xl:col-span-1 xl:row-span-2">
        <CardHeader className="grid-cols-1">
          <Badge className="justify-self-start border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground"><ShieldCheck aria-hidden="true" />{t('ui.overview')}</Badge>
        </CardHeader>
        <CardBody className="text-primary-foreground">
          <Heading as="h2" size="xl" weight="bold" className="text-primary-foreground">{greeting}</Heading>
          <Text size="sm" className="mt-2 max-w-[36ch] text-primary-foreground/85">{expiring > 0 ? t('ui.review_summary', undefined, { count: expiring }) : t('ui.clear_summary')}</Text>
        </CardBody>
      </Card>
      {metrics.map(({ label, value, total, detail, icon: Icon, tone, onClick }) => (
        <Card key={tone} className={`dashboard-metric ${TONES[tone].card}`}>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-current">
              <CardLink href="#" onClick={event => { event.preventDefault(); onClick(); }}>{label}</CardLink>
            </CardTitle>
            <span className={`col-start-2 row-span-2 row-start-1 inline-flex size-9 items-center justify-center rounded-md ${TONES[tone].icon}`} aria-hidden="true"><Icon className="size-5" /></span>
          </CardHeader>
          <CardBody className="grid gap-2 text-current">
            <span className="flex items-baseline gap-2 text-3xl font-bold tabular-nums">
              {value}<Text as="span" size="xs" weight="medium" className="text-current">{total !== undefined ? `/ ${total}` : t('dashboard.need_notice')}</Text>
            </span>
            <span className="flex items-center justify-between gap-2 text-xs font-medium"><span>{detail}</span><ArrowUpRight className="size-4 shrink-0" aria-hidden="true" /></span>
            {total !== undefined && (
              <ProgressLinear className="w-full" value={total > 0 ? Math.min(100, (value / total) * 100) : 0} aria-hidden="true">
                <ProgressLinearTrack><ProgressLinearRange className={TONES[tone].range} /></ProgressLinearTrack>
              </ProgressLinear>
            )}
          </CardBody>
        </Card>
      ))}
    </section>
  );
}
