import { CalendarSearch } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { Input } from '@legalio/ui-components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@legalio/ui-components/popover';
import { EVENT_TYPES, EVENT_TYPE_CONFIG, type EventType } from './eventTypes';
import { EventIndicator } from './EventItem';

import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
export interface EventFilters {
  enabled: ReadonlySet<EventType>;
  onToggle: (type: EventType) => void;
}

export function EventFilterPopover({ enabled, onToggle, search, onSearch, onReset }: EventFilters & {
  search: string; onSearch: (search: string) => void; onReset: () => void;
}) {
  const { t } = useLanguage();
  const filtered = enabled.size < EVENT_TYPES.length || Boolean(search.trim());
  return <Popover>
    <PopoverTrigger asChild>
      <Button type="button" variant="ghost" size="icon-md" className="relative" aria-label={t('calendar.filter_events')}>
        <CalendarSearch className="size-5" aria-hidden="true" />
        {filtered && <span className="absolute right-2 top-2 size-2 rounded-full bg-primary" aria-hidden="true" />}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-2rem)] overflow-y-auto space-y-3" aria-label={t('calendar.filter_events')}>
      <h3 className="text-sm font-semibold">{t('calendar.filter_events')}</h3>
      <label className="block space-y-2 text-xs font-medium">
        <span>{t('calendar.search_documents')}</span>
        <Input type="search" value={search} onChange={event => onSearch(event.target.value)} placeholder={t('calendar.search_placeholder')} />
      </label>
      <fieldset>
        <legend className="mb-1 text-xs font-medium">{t('calendar.event_types')}</legend>
        {EVENT_TYPES.map(type => <Checkbox checked={enabled.has(type)} onCheckedChange={() => onToggle(type)}><CheckboxControl /><CheckboxLabel><EventIndicator type={type} /> <span>{t(EVENT_TYPE_CONFIG[type].labelKey)}</span></CheckboxLabel><CheckboxHiddenInput /></Checkbox>)}
      </fieldset>
      <Button type="button" variant="outline" className="w-full" onClick={onReset}>{t('calendar.reset_filters')}</Button>
    </PopoverContent>
  </Popover>;
}
