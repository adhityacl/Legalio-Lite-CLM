import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { cn } from '@legalio/ui-components/utils';
import { getActiveFormattingLocale } from '@legalio/shared/currencyUtils';
import { EventItem } from './EventItem';
import { calendarDateKey } from './calendarModel';
import type { CalendarEvent } from './eventTypes';

import { Text } from '@legalio/ui-components/text';
interface MonthCellProps {
  date: Date; today: Date; events: CalendarEvent[]; loading?: boolean;
  onMonthClick: (date: Date) => void; onEventClick?: (event: CalendarEvent) => void;
}

export function MonthCell({ date, today, events, loading, onMonthClick, onEventClick }: MonthCellProps) {
  const { t } = useLanguage();
  const current = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
  const locale = getActiveFormattingLocale();
  const month = new Intl.DateTimeFormat(locale, { month: 'long' }).format(date);
  const label = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date);
  return <section aria-label={label} data-current-month={current || undefined} className={cn('flex min-w-0 flex-col gap-g8 bg-card px-g13 py-g8', current && 'bg-muted')}>
    <div className="flex items-center justify-between gap-g8">
      <Button type="button" variant="ghost" size="sm" className="-ms-g8 justify-start px-g8 font-bold" aria-label={t('calendar.open_month', undefined, { month: label })} onClick={() => onMonthClick(date)}>{month}</Button>
      {!loading && <Text as="span" size="sm" weight="semibold" tone={events.length ? undefined : 'muted'}>{events.length === 1 ? t('calendar.event_count_one', '1 event') : t('calendar.event_count', '{count} events', { count: events.length })}</Text>}
    </div>
    <div className="flex min-h-g144 flex-col gap-g3">
      {loading ? <div className="space-y-g13" aria-hidden="true">{[0, 1, 2].map(row => <Skeleton key={row} className="h-g21 w-full" />)}</div>
        : events.length === 0 ? <Text size="sm" tone="muted" className="flex flex-1 items-center justify-center">{t('calendar.no_events')}</Text>
          : <>
            {events.slice(0, 4).map(event => <EventItem key={event.id} event={event} onEventClick={onEventClick} />)}
            {events.length > 4 && <Button type="button" variant="link" size="sm" className="justify-start px-g3" onClick={() => onMonthClick(date)} aria-label={t('calendar.more_in_month', undefined, { count: events.length - 4, month: label })}>{t('calendar.more', undefined, { count: events.length - 4 })}</Button>}
          </>}
    </div>
  </section>;
}

export function YearView({ date, today, byMonth, ...props }: Omit<MonthCellProps, 'events'> & { byMonth: Map<string, CalendarEvent[]> }) {
  return <div data-testid="calendar-year-grid" className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: 12 }, (_, month) => {
      const start = new Date(date.getFullYear(), month, 1);
      return <MonthCell key={month} date={start} today={today} events={byMonth.get(calendarDateKey(start).slice(0, 7)) || []} {...props} />;
    })}
  </div>;
}
