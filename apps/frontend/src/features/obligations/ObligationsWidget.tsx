import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, CalendarClock, ListChecks } from 'lucide-react';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { Text } from '@legalio/ui-components/text';
import { useLanguage } from '../../context/LanguageContext';
import { useTenant } from '../../context/TenantContext';
import { usePermissions } from '../../lib/permissions';
import { obligationsApi } from '../../api/obligations';

/** Dashboard card: overdue and upcoming obligations (one SQL aggregate, scoped to what the caller may see). */
export const ObligationsWidget: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const { t } = useLanguage();
  const { activeTenantId } = useTenant();
  const { hasPermission } = usePermissions();
  const summary = useQuery({
    queryKey: ['obligations', activeTenantId, 'summary'], queryFn: ({ signal }) => obligationsApi.summary({ signal }),
    enabled: Boolean(activeTenantId) && hasPermission('document.view'), staleTime: 30_000,
  });
  if (!summary.data && !summary.isLoading) return null;
  const data = summary.data;
  const stat = (icon: React.ReactNode, value: number | undefined, label: string, tone: string) => (
    <div className="flex items-center gap-g13">
      <span className={`flex size-g34 shrink-0 items-center justify-center rounded-md ${tone}`}>{icon}</span>
      <div><Text size="lg" weight="semibold" data-testid="obligations-widget-value">{value ?? '–'}</Text><Text size="xs" tone="muted">{label}</Text></div>
    </div>
  );
  return (
    <Card asChild><section aria-label={t('obligations.widget.title', 'Obligations')} className="flex flex-col gap-g13 p-g21" data-testid="obligations-widget">
      <div className="flex flex-wrap items-center justify-between gap-g8">
        <Heading as="h3" size="sm" weight="semibold" className="flex items-center gap-g8"><ListChecks className="size-g16" aria-hidden />{t('obligations.widget.title', 'Obligations')}</Heading>
        <Button type="button" variant="ghost" size="sm" onClick={onOpen}>{t('obligations.widget.open', 'Open obligations')}<ArrowUpRight aria-hidden /></Button>
      </div>
      <div className="grid grid-cols-1 gap-g13 sm:grid-cols-3">
        {stat(<AlertTriangle className="size-g16" aria-hidden />, data?.overdue, t('obligations.stats.overdue', 'Overdue'), 'bg-status-danger-soft text-status-danger')}
        {stat(<CalendarClock className="size-g16" aria-hidden />, data?.dueThisWeek, t('obligations.stats.week', 'Due in the next 7 days'), 'bg-status-warning-soft text-status-warning')}
        {stat(<ListChecks className="size-g16" aria-hidden />, data?.open, t('obligations.stats.open', 'Open in total'), 'bg-status-info-soft text-status-info')}
      </div>
    </section></Card>
  );
};
