import { useLanguage } from '../../context/LanguageContext';
import { Toggle } from '@legalio/ui-components/toggle';
import { EventIndicator } from './EventItem';
import type { EventFilters } from './EventFilterPopover';
import { EVENT_TYPES, EVENT_TYPE_CONFIG } from './eventTypes';

/** Event-type legend; each entry is a moduix Toggle that shows or hides that type. */
export function Legend({ enabled, onToggle }: EventFilters) {
  const { t } = useLanguage();
  return <div role="group" aria-label={t('calendar.event_types')} className="flex flex-wrap justify-center gap-g8">
    {EVENT_TYPES.filter(type => type !== 'task').map(type => (
      <Toggle key={type} variant="outline" size="sm" pressed={enabled.has(type)} onPressedChange={() => onToggle(type)} className="rounded-full border-border bg-card px-g13 text-foreground data-[state=on]:border-border data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:opacity-70">
        <EventIndicator type={type} />{t(EVENT_TYPE_CONFIG[type].labelKey)}
      </Toggle>
    ))}
  </div>;
}
