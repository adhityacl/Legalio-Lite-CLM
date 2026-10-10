import { CalendarDays, ChevronLeft, ChevronRight, List } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { cn } from '@legalio/ui-components/utils';
import { getActiveFormattingLocale } from '@legalio/shared/currencyUtils';
import type { CalendarView } from './eventTypes';

export function CalendarToolbar({ date, view, onViewChange, onNavigate, onToday }: {
  date: Date; view: CalendarView; onViewChange: (view: CalendarView) => void;
  onNavigate: (offset: number) => void; onToday: () => void;
}) {
  const { t } = useLanguage();
  const label = new Intl.DateTimeFormat(getActiveFormattingLocale(), view === 'year' ? { year: 'numeric' } : { month: 'long', year: 'numeric' }).format(date);
  return <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
    <h3 className="text-base font-semibold">{t('calendar.title')}</h3>
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <span className="min-w-12 text-base font-semibold" aria-live="polite" aria-atomic="true">{label}</span>
      <div className="flex items-center rounded-full border border-[var(--moduix-color-border)]" role="group" aria-label={t('calendar.navigation')}>
        <Button type="button" variant="ghost" size="icon-md" aria-label={t(view === 'year' ? 'calendar.previous_year' : 'calendar.previous_month')} onClick={() => onNavigate(-1)}><ChevronLeft className="size-4" aria-hidden="true" /></Button>
        <Button type="button" variant="ghost" onClick={onToday}>{t('calendar.today')}</Button>
        <Button type="button" variant="ghost" size="icon-md" aria-label={t(view === 'year' ? 'calendar.next_year' : 'calendar.next_month')} onClick={() => onNavigate(1)}><ChevronRight className="size-4" aria-hidden="true" /></Button>
      </div>
      <div className="flex rounded-full border border-[var(--moduix-color-border)] p-0.5" role="group" aria-label={t('calendar.view')}>
        {(['month', 'year'] as const).map(mode => {
          const Icon = mode === 'month' ? CalendarDays : List;
          return <Button type="button" key={mode} variant="ghost" size="icon-md" aria-pressed={view === mode} aria-label={t(mode === 'month' ? 'calendar.month_view' : 'calendar.year_view')}
            className={cn('', view === mode && '')}
 onClick={() => onViewChange(mode)}><Icon className="size-4" aria-hidden="true" /></Button>;
        })}
      </div>
    </div>
  </div>;
}
