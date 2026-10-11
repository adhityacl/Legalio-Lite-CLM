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

import { Card } from '@legalio/ui-components/card';
import { Text } from '@legalio/ui-components/text';
import { Alert, AlertActions, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
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
  return <Card asChild><section aria-label={t('calendar.title')} className="space-y-g13 p-g13 text-foreground sm:p-g21">
    <CalendarToolbar date={date} view={view} onViewChange={setView} onNavigate={offset => setDate(previous => view === 'year' ? addYears(previous, offset) : addMonths(previous, offset))}
      onToday={() => setDate(startOfMonth(today))} onYearChange={year => setDate(previous => new Date(year, previous.getMonth(), 1))} />
    {error && <Alert status="error" role="alert">
      <AlertIndicator />
      <AlertContent><AlertDescription>{t('calendar.load_error')}</AlertDescription></AlertContent>
      {onRetry && <AlertActions><Button type="button" variant="outline" size="sm" disabled={loading} onClick={onRetry}>{t('calendar.retry')}</Button></AlertActions>}
    </Alert>}
    {loading && <Text size="sm" className="sr-only" role="status">{t('calendar.loading')}</Text>}
    <div aria-busy={loading || undefined}>
      {view === 'year'
        ? <YearView date={date} today={today} byMonth={groups.byMonth} loading={loading} onMonthClick={onMonthClick} onEventClick={onEventClick} />
        : <MonthView date={date} today={today} byDay={groups.byDay} loading={loading} weekStartsOn={weekStartsOn} onEventClick={onEventClick} />}
    </div>
    <Legend enabled={enabled} onToggle={onToggle} />
  </section></Card>;
}
