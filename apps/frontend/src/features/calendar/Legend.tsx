import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { cn } from '@legalio/ui-components/utils';
import { EventIndicator } from './EventItem';
import type { EventFilters } from './EventFilterPopover';
import { EVENT_TYPES, EVENT_TYPE_CONFIG } from './eventTypes';

export function Legend({ enabled, onToggle }: EventFilters) {
  const { t } = useLanguage();
  return <div role="group" aria-label={t('calendar.event_types')} className="flex flex-wrap justify-center gap-x-1 gap-y-0">
    {EVENT_TYPES.filter(type => type !== 'task').map(type => <Button key={type} type="button" variant="ghost" aria-pressed={enabled.has(type)}
      className={cn('', !enabled.has(type) && '')}
 onClick={() => onToggle(type)}><EventIndicator type={type} />{t(EVENT_TYPE_CONFIG[type].labelKey)}</Button>)}
 </div>;
}
