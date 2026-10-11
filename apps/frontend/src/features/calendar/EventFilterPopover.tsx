import { CalendarSearch } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { Input } from '@legalio/ui-components/input';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Fieldset, FieldsetLegend } from '@legalio/ui-components/fieldset';
import { Checkbox, CheckboxControl, CheckboxGroup, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { Popover, PopoverBody, PopoverContent, PopoverFooter, PopoverHeader, PopoverPositioner, PopoverTitle, PopoverTrigger } from '@legalio/ui-components/popover';
import { EVENT_TYPES, EVENT_TYPE_CONFIG, type EventType } from './eventTypes';
import { EventIndicator } from './EventItem';

import { BadgeDot } from '@legalio/ui-components/badge';
export interface EventFilters {
  enabled: ReadonlySet<EventType>;
  onToggle: (type: EventType) => void;
}

export function EventFilterPopover({ enabled, onToggle, search, onSearch, onReset }: EventFilters & {
  search: string; onSearch: (search: string) => void; onReset: () => void;
}) {
  const { t } = useLanguage();
  const filtered = enabled.size < EVENT_TYPES.length || Boolean(search.trim());
  return (
    <Popover positioning={{ placement: 'bottom-end', gutter: 8 }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-md" className="relative" aria-label={t('calendar.filter_events')}>
          <CalendarSearch aria-hidden="true" />
          {filtered && <BadgeDot className="size-g8 absolute end-g8 top-g8 text-primary" aria-hidden="true" />}
        </Button>
      </PopoverTrigger>
      <PopoverPositioner>
        <PopoverContent className="w-g377 max-w-full" aria-label={t('calendar.filter_events')}>
          <PopoverHeader><PopoverTitle>{t('calendar.filter_events')}</PopoverTitle></PopoverHeader>
          <PopoverBody className="grid gap-g13">
            <Field>
              <FieldLabel>{t('calendar.search_documents')}</FieldLabel>
              <Input type="search" value={search} onChange={event => onSearch(event.target.value)} placeholder={t('calendar.search_placeholder')} />
            </Field>
            <Fieldset>
              <FieldsetLegend>{t('calendar.event_types')}</FieldsetLegend>
              <CheckboxGroup>
                {EVENT_TYPES.map(type => (
                  <Checkbox key={type} checked={enabled.has(type)} onCheckedChange={() => onToggle(type)}>
                    <CheckboxControl />
                    <CheckboxLabel className="gap-g8"><EventIndicator type={type} />{t(EVENT_TYPE_CONFIG[type].labelKey)}</CheckboxLabel>
                    <CheckboxHiddenInput />
                  </Checkbox>
                ))}
              </CheckboxGroup>
            </Fieldset>
          </PopoverBody>
          <PopoverFooter>
            <Button variant="outline" className="w-full" onClick={onReset}>{t('calendar.reset_filters')}</Button>
          </PopoverFooter>
        </PopoverContent>
      </PopoverPositioner>
    </Popover>
  );
}
