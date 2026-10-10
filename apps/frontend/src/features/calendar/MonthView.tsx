import { isSameDay, isSameMonth } from 'date-fns';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@legalio/ui-components/popover';
import { cn } from '@legalio/ui-components/utils';
import { getActiveFormattingLocale } from '@legalio/shared/currencyUtils';
import { calendarDateKey, getMonthDays } from './calendarModel';
import { EventItem } from './EventItem';
import type { CalendarEvent } from './eventTypes';

export function MonthView({ date, today, byDay, loading, weekStartsOn, onEventClick }: {
  date: Date; today: Date; byDay: Map<string, CalendarEvent[]>; loading?: boolean; weekStartsOn: 0 | 1;
  onEventClick?: (event: CalendarEvent) => void;
}) {
  const { t } = useLanguage();
  const locale = getActiveFormattingLocale();
  const days = getMonthDays(date, weekStartsOn);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: 'full' });
  return <div data-testid="calendar-month-grid" className="overflow-hidden rounded-xl border border-[var(--border)]">
    <div className="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--muted)] ds-grid">
      {days.slice(0, 7).map(day => <div key={day.getDay()} className="px-1 py-3 text-center text-xs font-semibold">{weekday.format(day)}</div>)}
    </div>
    <div className="grid grid-cols-7 gap-px bg-[var(--border)] ds-grid">
      {days.map(day => {
        const key = calendarDateKey(day);
        const events = byDay.get(key) || [];
        const current = isSameDay(day, today);
        const outside = !isSameMonth(day, date);
        return <section key={key} aria-label={fullDate.format(day)} data-date={key} className={cn('min-h-44 min-w-0 bg-[var(--card)] p-0.5 sm:p-2', outside && 'bg-[var(--muted)]')}>
          <time dateTime={key} aria-current={current ? 'date' : undefined} className={cn('mb-1 flex size-7 items-center justify-center rounded-full text-xs', outside && 'text-[var(--muted-foreground)]', current && 'bg-status-info text-white')}>{day.getDate()}</time>
          {loading ? <Skeleton className="h-5 w-full" /> : <>
            <div className={cn('space-y-1', outside && 'opacity-60')}>
              {events.slice(0, 3).map(event => <EventItem key={event.id} event={event} chip onEventClick={onEventClick} />)}
            </div>
            {events.length > 3 && <Popover>
              <PopoverTrigger asChild><Button type="button" variant="link" className="w-full min-w-0 text-xs" aria-label={t('calendar.more_on_day', undefined, { count: events.length - 3, date: fullDate.format(day) })}>{t('calendar.more', undefined, { count: events.length - 3 })}</Button></PopoverTrigger>
              <PopoverContent className="max-h-[min(20rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto" aria-label={fullDate.format(day)}>
                <h4 className="mb-2 text-sm font-semibold">{fullDate.format(day)}</h4>
                {events.map(event => <EventItem key={event.id} event={event} onEventClick={onEventClick} />)}
              </PopoverContent>
            </Popover>}
          </>}
        </section>;
      })}
    </div>
  </div>;
}
