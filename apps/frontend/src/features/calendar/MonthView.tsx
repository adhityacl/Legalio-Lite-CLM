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

import { Heading } from '@legalio/ui-components/heading';
import { Card } from '@legalio/ui-components/card';
export function MonthView({ date, today, byDay, loading, weekStartsOn, onEventClick }: {
  date: Date; today: Date; byDay: Map<string, CalendarEvent[]>; loading?: boolean; weekStartsOn: 0 | 1;
  onEventClick?: (event: CalendarEvent) => void;
}) {
  const { t } = useLanguage();
  const locale = getActiveFormattingLocale();
  const days = getMonthDays(date, weekStartsOn);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: 'full' });
  return <Card data-testid="calendar-month-grid" className="overflow-hidden">
    <div className="grid grid-cols-7 border-b border-border bg-muted">
      {days.slice(0, 7).map(day => <div key={day.getDay()} className="px-g3 py-g13 text-center text-xs font-semibold">{weekday.format(day)}</div>)}
    </div>
    <div className="grid grid-cols-7 gap-px bg-border">
      {days.map(day => {
        const key = calendarDateKey(day);
        const events = byDay.get(key) || [];
        const current = isSameDay(day, today);
        const outside = !isSameMonth(day, date);
        return <section key={key} aria-label={fullDate.format(day)} data-date={key} className={cn('min-h-g144 min-w-0 bg-card p-g2 sm:p-g8', outside && 'bg-muted')}>
 <time dateTime={key} aria-current={current ? 'date' : undefined} className={cn('mb-g3 flex size-g26 items-center justify-center rounded-full text-xs', outside && 'text-muted-foreground', current && 'bg-primary text-primary-foreground')}>{day.getDate()}</time>
 {loading ? <Skeleton className="h-g21 w-full" /> : <>
            <div className={cn('space-y-g3', outside && 'opacity-60')}>
 {events.slice(0, 3).map(event => <EventItem key={event.id} event={event} chip onEventClick={onEventClick} />)}
 </div>
 {events.length > 3 && <Popover>
 <PopoverTrigger asChild><Button type="button" variant="link" className="w-full min-w-0" aria-label={t('calendar.more_on_day', undefined, { count: events.length - 3, date: fullDate.format(day) })}>{t('calendar.more', undefined, { count: events.length - 3 })}</Button></PopoverTrigger>
              <PopoverContent className="max-h-g377 w-g377 max-w-full overflow-y-auto" aria-label={fullDate.format(day)}>
                <Heading as="h4" size="xs" weight="semibold" className="mb-g8">{fullDate.format(day)}</Heading>
                {events.map(event => <EventItem key={event.id} event={event} onEventClick={onEventClick} />)}
              </PopoverContent>
            </Popover>}
          </>}
        </section>;
      })}
    </div>
  </Card>;
}
