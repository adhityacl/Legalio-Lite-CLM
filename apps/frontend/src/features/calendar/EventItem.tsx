import { CheckSquare, Square } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { cn } from '@legalio/ui-components/utils';
import { getActiveFormattingLocale } from '@legalio/shared/currencyUtils';
import { calendarDateKey, parseCalendarDate } from './calendarModel';
import { EVENT_TYPE_CONFIG, type CalendarEvent, type EventType } from './eventTypes';

export function EventIndicator({ type, done }: { type: EventType; done?: boolean }) {
  const config = EVENT_TYPE_CONFIG[type];
  if (type === 'task') {
    const Icon = done ? CheckSquare : Square;
    return <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', config.dot)} />;
 }
 return <span aria-hidden="true" className={cn('size-2 rounded-full shrink-0', config.dot)} />;
}

export function EventItem({ event, chip = false, onEventClick }: {
 event: CalendarEvent; chip?: boolean; onEventClick?: (event: CalendarEvent) => void;
}) {
 const { t } = useLanguage();
 const date = parseCalendarDate(event.date)!;
 const locale = getActiveFormattingLocale();
 const done = event.type === 'task' && event.status === 'done';
 const label = [t(EVENT_TYPE_CONFIG[event.type].labelKey), new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date),
 event.title, done ? t('calendar.done') : '', event.projected ? t('calendar.projected') : ''].filter(Boolean).join(' · ');
 const className = cn('min-h-10 w-full min-w-0 justify-start gap-2 rounded-md px-2 py-1 text-xs font-normal text-[var(--moduix-color-foreground)]',
 chip ? EVENT_TYPE_CONFIG[event.type].chip : 'hover:bg-[var(--moduix-color-muted)]');
 const content = <>
 <EventIndicator type={event.type} done={done} />
 {!chip && <time dateTime={calendarDateKey(date)} className="shrink-0 text-[var(--moduix-color-muted-foreground)]">{new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date)}</time>}
    <span className={cn('truncate', done && 'line-through', chip && 'hidden sm:inline')}>{event.title}</span>
 {chip && <span className="truncate sm:hidden" aria-hidden="true">{date.getDate()}</span>}
  </>;
  return onEventClick
    ? <Button type="button" variant="ghost" data-calendar-event className={className} aria-label={label} title={label} onClick={() => onEventClick(event)}>{content}</Button>
    : <div className={cn('flex items-center', className)} aria-label={label} title={label}>{content}</div>;
}
