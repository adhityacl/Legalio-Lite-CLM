/**
 * Obligations and key dates: the vocabulary and the pure date rules shared by the server (validation, roll-forward, reminders) and the
 * browser (calendar, labels). No I/O here.
 *
 * Recurrence is "RRULE-lite": once, monthly, quarterly, yearly, or every N days. `due_date` is the next occurrence; completing a recurring
 * obligation records the completion and moves `due_date` to the following occurrence.
 */

export const OBLIGATION_TYPES = ['payment', 'delivery', 'renewal_notice', 'reporting', 'compliance', 'other'] as const;
export type ObligationType = (typeof OBLIGATION_TYPES)[number];

/** Stored statuses. `overdue` is never stored: it is derived from an open obligation whose due date has passed. */
export const OBLIGATION_STORED_STATUSES = ['open', 'in_progress', 'done', 'waived'] as const;
export type ObligationStoredStatus = (typeof OBLIGATION_STORED_STATUSES)[number];
export const OBLIGATION_STATUSES = [...OBLIGATION_STORED_STATUSES, 'overdue'] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

export const OBLIGATION_RECURRENCES = ['once', 'monthly', 'quarterly', 'yearly', 'every_n_days'] as const;
export type ObligationRecurrence = (typeof OBLIGATION_RECURRENCES)[number];

export const OBLIGATION_SOURCES = ['manual', 'ai_extracted'] as const;
export type ObligationSource = (typeof OBLIGATION_SOURCES)[number];

export const DEFAULT_LEAD_DAYS = 7;
export const MAX_LEAD_DAYS = 365;
export const MAX_RECURRENCE_INTERVAL = 3650;

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written `YYYY-MM-DD`. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const toUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fromUtc = (date: Date) => date.toISOString().slice(0, 10);
const daysInMonth = (year: number, month0: number) => new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();

/** `iso` plus whole calendar days. */
export function addDays(iso: string, days: number): string {
  const date = toUtc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtc(date);
}

/** `iso` plus calendar months; the day is kept when the target month has it, else clamped to the month's last day. */
export function addMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index - targetYear * 12;
  const clamped = Math.min(day, daysInMonth(targetYear, targetMonth));
  return fromUtc(new Date(Date.UTC(targetYear, targetMonth, clamped)));
}

export interface RecurrenceRule { recurrence: ObligationRecurrence; interval?: number | null; until?: string | null }

/** The occurrence after `from`, or null for a one-off obligation or when the rule has ended (`until`). */
export function nextOccurrence(from: string, rule: RecurrenceRule): string | null {
  let next: string;
  switch (rule.recurrence) {
    case 'monthly': next = addMonths(from, 1); break;
    case 'quarterly': next = addMonths(from, 3); break;
    case 'yearly': next = addMonths(from, 12); break;
    case 'every_n_days': {
      const interval = Number(rule.interval);
      if (!Number.isInteger(interval) || interval < 1) return null;
      next = addDays(from, interval);
      break;
    }
    default: return null;
  }
  if (rule.until && next > rule.until) return null;
  return next;
}

/** Whole days from `today` to `due` (negative when past); null without a due date. Both are `YYYY-MM-DD`. */
export function daysBetween(today: string, due: string | null | undefined): number | null {
  if (!due || !isIsoDate(due) || !isIsoDate(today)) return null;
  return Math.round((toUtc(due).getTime() - toUtc(today).getTime()) / 86_400_000);
}

/** Open work whose due date has passed is "overdue"; everything else keeps its stored status. */
export function effectiveStatus(stored: ObligationStoredStatus, due: string | null | undefined, today: string): ObligationStatus {
  if ((stored === 'open' || stored === 'in_progress') && due && due < today) return 'overdue';
  return stored;
}
