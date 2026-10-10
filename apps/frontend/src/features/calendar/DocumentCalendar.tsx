import { useEffect, useMemo, useState } from 'react';
import { addMonths, addYears, endOfMonth, endOfYear, startOfMonth, startOfYear } from 'date-fns';
import { AlertCircle } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useTenantSettings } from '../../context/TenantSettingsContext';
import { todayInTimezone } from '@legalio/shared/policy';
import { Button } from '@legalio/ui-components/button';
import { CalendarToolbar } from './CalendarToolbar';
import { YearView } from './YearView';
import { MonthView } from './MonthView';
import { Legend } from './Legend';
import { groupCalendarEvents, parseCalendarDate } from './calendarModel';
import { EVENT_TYPES, type CalendarEvent, type CalendarView, type EventType } from './eventTypes';

export interface DocumentCalendarProps {
  events: CalendarEvent[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  initialView?: CalendarView;
  initialDate?: Date;
  weekStartsOn?: 0 | 1;
  onEventClick?: (event: CalendarEvent) => void;
  onRangeChange?: (start: Date, end: Date) => void;
}

export function DocumentCalendar({ events, loading, error, onRetry, initialView = 'year', initialDate,
  weekStartsOn = 1, onEventClick, onRangeChange }: DocumentCalendarProps) {
  const { t } = useLanguage();
  const { policy } = useTenantSettings();
  const today = parseCalendarDate(todayInTimezone(policy.settings.timezone))!;
  const [date, setDate] = useState(() => startOfMonth(initialDate && !Number.isNaN(initialDate.getTime()) ? initialDate : today));
  const [view, setView] = useState<CalendarView>(initialView);
  const [enabled, setEnabled] = useState<Set<EventType>>(() => new Set(EVENT_TYPES));
  const groups = useMemo(() => groupCalendarEvents(error ? [] : events, enabled, ''), [events, enabled, error]);
  useEffect(() => {
    onRangeChange?.(view === 'year' ? startOfYear(date) : startOfMonth(date), view === 'year' ? endOfYear(date) : endOfMonth(date));
  }, [date, view, onRangeChange]);
  const onToggle = (type: EventType) => setEnabled(previous => {
    const next = new Set(previous);
    if (next.has(type)) next.delete(type); else next.add(type);
    return next;
  });
  const onMonthClick = (month: Date) => { setDate(month); setView('month'); };
  return <section aria-label={t('calendar.title')} className="space-y-4 rounded-2xl border border-[var(--moduix-color-border)] bg-[var(--moduix-color-card)] p-3 text-[var(--moduix-color-foreground)] shadow-xs sm:p-5">
    <CalendarToolbar date={date} view={view} onViewChange={setView} onNavigate={offset => setDate(previous => view === 'year' ? addYears(previous, offset) : addMonths(previous, offset))}
      onToday={() => setDate(startOfMonth(today))} />
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--moduix-color-destructive)]/30 bg-[var(--moduix-color-muted)] p-3 text-sm">
      <AlertCircle aria-hidden="true" className="size-5 text-[var(--moduix-color-destructive)]" />
      <span className="flex-1">{t('calendar.load_error')}</span>
      {onRetry && <Button type="button" variant="outline" disabled={loading} onClick={onRetry}>{t('calendar.retry')}</Button>}
    </div>}
    {loading && <p role="status" className="sr-only">{t('calendar.loading')}</p>}
    <div aria-busy={loading || undefined}>
      {view === 'year'
        ? <YearView date={date} today={today} byMonth={groups.byMonth} loading={loading} onMonthClick={onMonthClick} onEventClick={onEventClick} />
        : <MonthView date={date} today={today} byDay={groups.byDay} loading={loading} weekStartsOn={weekStartsOn} onEventClick={onEventClick} />}
    </div>
    <Legend enabled={enabled} onToggle={onToggle} />
  </section>;
}
