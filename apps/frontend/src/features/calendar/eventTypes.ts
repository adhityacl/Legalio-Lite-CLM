export type EventType = 'contract_start' | 'cancellation_notice' | 'contract_end' | 'renewal' | 'termination' | 'task' | 'obligation';
export type CalendarView = 'year' | 'month';

export interface CalendarEvent {
  id: string;
  type: EventType;
  /** A business date, never an instant in UTC. */
  date: string;
  title: string;
  /** The counterparty shown in the calendar cell; the full details (title, type, date) appear on hover. */
  partnerName?: string;
  documentId?: string;
  documentKind?: 'contract' | 'io' | 'obligation';
  status?: 'open' | 'done';
  projected?: boolean;
}

/** One palette for indicators, chips, filters and the legend, in both themes. The dots use saturated, clearly different hues (3:1 or better against the card) so they tell apart at 8px. light-dark() follows the app theme switch (data-moduix-color-scheme), which Tailwind's dark: variant does not. */
export const EVENT_TYPE_CONFIG: Record<EventType, { labelKey: string; dot: string; chip: string }> = {
  contract_start: { labelKey: 'calendar.contract_start', dot: 'bg-[light-dark(#2563eb,#60a5fa)]', chip: 'bg-status-info-soft text-status-info' },
  cancellation_notice: { labelKey: 'calendar.cancellation_notice', dot: 'bg-[light-dark(#d97706,#fbbf24)]', chip: 'bg-status-warning-soft text-status-warning' },
  contract_end: { labelKey: 'calendar.contract_end', dot: 'bg-[light-dark(#7c3aed,#a78bfa)]', chip: 'bg-status-special-soft text-status-special' },
  renewal: { labelKey: 'calendar.renewal', dot: 'bg-[light-dark(#059669,#34d399)]', chip: 'bg-status-success-soft text-status-success' },
  termination: { labelKey: 'calendar.termination', dot: 'bg-[light-dark(#64748b,#94a3b8)]', chip: 'bg-muted text-foreground' },
  obligation: { labelKey: 'calendar.obligation', dot: 'bg-[light-dark(#e11d48,#fb7185)]', chip: 'bg-status-danger-soft text-status-danger' },
  task: { labelKey: 'calendar.task', dot: 'text-status-finance', chip: 'bg-status-finance-soft text-status-finance' },
};

export const EVENT_TYPES = Object.keys(EVENT_TYPE_CONFIG) as EventType[];
