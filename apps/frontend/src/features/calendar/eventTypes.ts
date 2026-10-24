export type EventType = 'contract_start' | 'cancellation_notice' | 'contract_end' | 'renewal' | 'termination' | 'task' | 'obligation';
export type CalendarView = 'year' | 'month';

export interface CalendarEvent {
  id: string;
  type: EventType;
  /** A business date, never an instant in UTC. */
  date: string;
  title: string;
  documentId?: string;
  documentKind?: 'contract' | 'io' | 'obligation';
  status?: 'open' | 'done';
  projected?: boolean;
}

/** One palette for indicators, chips, filters and the legend, in both themes. */
export const EVENT_TYPE_CONFIG: Record<EventType, { labelKey: string; dot: string; chip: string }> = {
  contract_start: { labelKey: 'calendar.contract_start', dot: 'bg-status-info', chip: 'bg-status-info-soft text-status-info' },
  cancellation_notice: { labelKey: 'calendar.cancellation_notice', dot: 'bg-status-warning', chip: 'bg-status-warning-soft text-status-warning' },
  contract_end: { labelKey: 'calendar.contract_end', dot: 'bg-status-special', chip: 'bg-status-special-soft text-status-special' },
  renewal: { labelKey: 'calendar.renewal', dot: 'bg-status-success', chip: 'bg-status-success-soft text-status-success' },
  termination: { labelKey: 'calendar.termination', dot: 'bg-muted-foreground', chip: 'bg-muted text-foreground' },
  obligation: { labelKey: 'calendar.obligation', dot: 'bg-status-danger', chip: 'bg-status-danger-soft text-status-danger' },
  task: { labelKey: 'calendar.task', dot: 'text-status-finance', chip: 'bg-status-finance-soft text-status-finance' },
};

export const EVENT_TYPES = Object.keys(EVENT_TYPE_CONFIG) as EventType[];
