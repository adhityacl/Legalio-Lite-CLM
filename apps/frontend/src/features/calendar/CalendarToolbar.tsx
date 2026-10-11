import { CalendarDays, ChevronLeft, ChevronRight, List } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { getActiveFormattingLocale } from '@legalio/shared/currencyUtils';
import type { CalendarView } from './eventTypes';

import { Heading } from '@legalio/ui-components/heading';
import { Text } from '@legalio/ui-components/text';
import { ToggleGroup, ToggleGroupItem } from '@legalio/ui-components/toggle-group';
export function CalendarToolbar({ date, view, onViewChange, onNavigate, onToday, onYearChange }: {
  date: Date; view: CalendarView; onViewChange: (view: CalendarView) => void;
  onNavigate: (offset: number) => void; onToday: () => void; onYearChange: (year: number) => void;
}) {
  const { t } = useLanguage();
  const label = new Intl.DateTimeFormat(getActiveFormattingLocale(), view === 'year' ? { year: 'numeric' } : { month: 'long', year: 'numeric' }).format(date);
  const year = date.getFullYear();
  const years = Array.from({ length: 11 }, (_, i) => year - 5 + i);
  return <div className="flex flex-col gap-g13 lg:flex-row lg:items-center lg:justify-between">
    <Heading as="h3" size="sm" weight="bold">{t('calendar.title')}</Heading>
    <div className="flex flex-wrap items-center gap-g8 sm:gap-g13">
      <Text as="span" className="sr-only" aria-live="polite" aria-atomic="true">{label}</Text>
      <div className="flex items-center gap-g3" role="group" aria-label={t('calendar.navigation')}>
        <Button type="button" variant="outline" size="icon-md" aria-label={t(view === 'year' ? 'calendar.previous_year' : 'calendar.previous_month')} onClick={() => onNavigate(-1)}><ChevronLeft aria-hidden="true" /></Button>
        <Button type="button" variant="outline" onClick={onToday}>{t('calendar.today')}</Button>
        <Button type="button" variant="outline" size="icon-md" aria-label={t(view === 'year' ? 'calendar.next_year' : 'calendar.next_month')} onClick={() => onNavigate(1)}><ChevronRight aria-hidden="true" /></Button>
      </div>
      <NativeSelect aria-label={t('calendar.year', 'Year')} value={year} onChange={event => onYearChange(Number(event.target.value))}
        className="border-primary bg-primary font-semibold text-primary-foreground" controlProps={{ className: 'w-g89 [&_[data-part=indicator]]:text-primary-foreground' }}>
        {years.map(option => <option key={option} value={option}>{option}</option>)}
      </NativeSelect>
      <ToggleGroup aria-label={t('calendar.view')} value={[view]} deselectable={false} onValueChange={details => details.value[0] && onViewChange(details.value[0] as CalendarView)}>
        {(['month', 'year'] as const).map(mode => {
          const Icon = mode === 'month' ? CalendarDays : List;
          return <ToggleGroupItem key={mode} value={mode} aria-label={t(mode === 'month' ? 'calendar.month_view' : 'calendar.year_view')}><Icon aria-hidden="true" /></ToggleGroupItem>;
        })}
      </ToggleGroup>
    </div>
  </div>;
}
