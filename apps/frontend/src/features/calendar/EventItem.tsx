import { CheckSquare, Square } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { cn } from '@legalio/ui-components/utils';
import { getActiveFormattingLocale } from '@legalio/shared/currencyUtils';
import { calendarDateKey, parseCalendarDate } from './calendarModel';
import { EVENT_TYPE_CONFIG, type CalendarEvent, type EventType } from './eventTypes';

import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
export function EventIndicator({ type, done }: { type: EventType; done?: boolean }) {
  const config = EVENT_TYPE_CONFIG[type];
  if (type === 'task') {
    const Icon = done ? CheckSquare : Square;
    return <Icon aria-hidden="true" className={cn('size-g13 shrink-0', config.dot)} />;
 }
 return <span aria-hidden="true" className={cn('size-g8 rounded-full shrink-0', config.dot)} />;
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
 const className = cn('w-full min-w-0 justify-start gap-g8 rounded-md px-g3 py-g2 text-xs font-medium text-foreground',
 chip ? EVENT_TYPE_CONFIG[event.type].chip : 'hover:bg-muted');
 const content = <>
 {!chip && <time dateTime={calendarDateKey(date)} className="inline-flex size-g21 shrink-0 items-center justify-center rounded-sm bg-muted text-xs font-semibold tabular-nums text-muted-foreground">{date.getDate()}</time>}
 <EventIndicator type={event.type} done={done} />
    <span className={cn('truncate', done && 'line-through', chip && 'hidden sm:inline')}>{event.title}</span>
 {chip && <span className="truncate sm:hidden" aria-hidden="true">{date.getDate()}</span>}
  </>;
  return onEventClick
    ? <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" data-calendar-event className={className} aria-label={label} onClick={() => onEventClick(event)}>{content}</Button></TooltipTrigger><TooltipBody>{label}</TooltipBody></Tooltip>
    : <Tooltip><TooltipTrigger asChild><div className={cn('flex items-center', className)} aria-label={label}>{content}</div></TooltipTrigger><TooltipBody>{label}</TooltipBody></Tooltip>;
}
