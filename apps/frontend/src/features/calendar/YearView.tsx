import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { cn } from '@legalio/ui-components/utils';
import { getActiveFormattingLocale } from '@legalio/shared/currencyUtils';
import { EventItem } from './EventItem';
import { calendarDateKey } from './calendarModel';
import type { CalendarEvent } from './eventTypes';

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
  return <section aria-label={label} data-current-month={current || undefined} className={cn('min-w-0 bg-[var(--card)]', current && 'bg-status-info-soft/50 dark:bg-status-info-soft/30')}>
    <Button type="button" variant="ghost" className={cn('w-full justify-start text-sm', current && ' ')}
      aria-label={t('calendar.open_month', undefined, { month: label })} onClick={() => onMonthClick(date)}>{month}</Button>
    <div className="flex min-h-40 flex-col p-2">
      {loading ? <div className="space-y-4 p-2" aria-hidden="true">{[0, 1, 2].map(row => <Skeleton key={row} className="h-5 w-full" />)}</div>
        : events.length === 0 ? <p className="flex min-h-36 items-center justify-center text-sm text-[var(--muted-foreground)]">{t('calendar.no_events')}</p>
          : <>
            {events.slice(0, 4).map(event => <EventItem key={event.id} event={event} onEventClick={onEventClick} />)}
            {events.length > 4 && <Button type="button" variant="link" className="justify-start" onClick={() => onMonthClick(date)} aria-label={t('calendar.more_in_month', undefined, { count: events.length - 4, month: label })}>{t('calendar.more', undefined, { count: events.length - 4 })}</Button>}
          </>}
    </div>
  </section>;
}

export function YearView({ date, today, byMonth, ...props }: Omit<MonthCellProps, 'events'> & { byMonth: Map<string, CalendarEvent[]> }) {
  return <div data-testid="calendar-year-grid" className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4 ds-grid">
    {Array.from({ length: 12 }, (_, month) => {
      const start = new Date(date.getFullYear(), month, 1);
      return <MonthCell key={month} date={start} today={today} events={byMonth.get(calendarDateKey(start).slice(0, 7)) || []} {...props} />;
    })}
  </div>;
}
