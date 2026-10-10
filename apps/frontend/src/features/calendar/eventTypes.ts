export type EventType = 'contract_start' | 'cancellation_notice' | 'contract_end' | 'renewal' | 'termination' | 'task';
export type CalendarView = 'year' | 'month';

export interface CalendarEvent {
  id: string;
  type: EventType;
  /** A business date, never an instant in UTC. */
  date: string;
  title: string;
  documentId?: string;
  documentKind?: 'contract' | 'io';
  status?: 'open' | 'done';
  projected?: boolean;
}

/** One palette for indicators, chips, filters and the legend, in both themes. */
export const EVENT_TYPE_CONFIG: Record<EventType, { labelKey: string; dot: string; chip: string }> = {
  contract_start: { labelKey: 'calendar.contract_start', dot: 'bg-info', chip: 'bg-info-soft text-info' },
  cancellation_notice: { labelKey: 'calendar.cancellation_notice', dot: 'bg-warning', chip: 'bg-warning-soft text-warning' },
  contract_end: { labelKey: 'calendar.contract_end', dot: 'bg-danger', chip: 'bg-danger-soft text-danger' },
  renewal: { labelKey: 'calendar.renewal', dot: 'bg-success', chip: 'bg-success-soft text-success' },
  termination: { labelKey: 'calendar.termination', dot: 'bg-muted-foreground', chip: 'bg-muted text-foreground' },
  task: { labelKey: 'calendar.task', dot: 'text-finance', chip: 'bg-finance-soft text-finance' },
};

export const EVENT_TYPES = Object.keys(EVENT_TYPE_CONFIG) as EventType[];
