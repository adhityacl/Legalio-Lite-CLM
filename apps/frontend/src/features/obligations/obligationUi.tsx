import type { StatusTone } from '@legalio/ui-components/badge';
import { Badge } from '@legalio/ui-components/badge';
import { Text } from '@legalio/ui-components/text';
import { OBLIGATION_RECURRENCES, OBLIGATION_STATUSES, OBLIGATION_TYPES, type ObligationRecurrence, type ObligationStatus, type ObligationType } from '@legalio/shared/obligations';
import type { Obligation } from '../../api/obligations';
import { formatBusinessDate } from '../../lib/displayDate';

export type T = (key: string, fallback?: string, vars?: Record<string, string | number>) => string;

export const TYPE_KEYS: Record<ObligationType, [string, string]> = {
  payment: ['obligations.type.payment', 'Payment'], delivery: ['obligations.type.delivery', 'Delivery'], renewal_notice: ['obligations.type.renewal_notice', 'Renewal / notice'],
  reporting: ['obligations.type.reporting', 'Reporting'], compliance: ['obligations.type.compliance', 'Compliance'], other: ['obligations.type.other', 'Other'],
};
export const STATUS_KEYS: Record<ObligationStatus, [string, string]> = {
  open: ['obligations.status.open', 'Open'], in_progress: ['obligations.status.in_progress', 'In progress'], done: ['obligations.status.done', 'Done'],
  waived: ['obligations.status.waived', 'Waived'], overdue: ['obligations.status.overdue', 'Overdue'],
};
export const RECURRENCE_KEYS: Record<ObligationRecurrence, [string, string]> = {
  once: ['obligations.recurrence.once', 'Once'], monthly: ['obligations.recurrence.monthly', 'Every month'], quarterly: ['obligations.recurrence.quarterly', 'Every quarter'],
  yearly: ['obligations.recurrence.yearly', 'Every year'], every_n_days: ['obligations.recurrence.every_n_days', 'Every N days'],
};
const STATUS_TONE: Record<ObligationStatus, StatusTone> = { open: 'info', in_progress: 'special', done: 'success', waived: 'neutral', overdue: 'danger' };

export const typeLabel = (t: T, type: ObligationType) => t(...TYPE_KEYS[type] ?? TYPE_KEYS.other);
export const statusLabel = (t: T, status: ObligationStatus) => t(...STATUS_KEYS[status]);
export const recurrenceLabel = (t: T, o: Pick<Obligation, 'recurrence' | 'recurrence_interval'>) =>
  o.recurrence === 'every_n_days' ? t('obligations.recurrence.every_days', 'Every {n} days', { n: o.recurrence_interval ?? 0 }) : t(...RECURRENCE_KEYS[o.recurrence]);
export const TYPE_OPTIONS = OBLIGATION_TYPES;
export const STATUS_OPTIONS = OBLIGATION_STATUSES;
export const RECURRENCE_OPTIONS = OBLIGATION_RECURRENCES;

export const StatusBadge = ({ t, status }: { t: T; status: ObligationStatus }) => <Badge tone={STATUS_TONE[status]}>{statusLabel(t, status)}</Badge>;

/** "in 3 days", "today", "2 days overdue" next to the due date. */
export function dueHint(t: T, o: Pick<Obligation, 'days_until' | 'status'>): string {
  if (o.days_until === null || o.status === 'done' || o.status === 'waived') return '';
  if (o.days_until === 0) return t('obligations.due_today', 'Due today');
  if (o.days_until < 0) return t('obligations.days_overdue', '{n} day(s) overdue', { n: -o.days_until });
  return t('obligations.days_left', 'in {n} day(s)', { n: o.days_until });
}

export const DueCell = ({ t, o }: { t: T; o: Obligation }) => (
  <div className="min-w-0">
    <Text size="sm" className="whitespace-nowrap">{o.due_date ? formatBusinessDate(o.due_date) : t('obligations.no_date', 'No date')}</Text>
    {dueHint(t, o) && <Text size="xs" tone={o.status === 'overdue' ? 'destructive' : 'muted'}>{dueHint(t, o)}</Text>}
  </div>
);

/** The record an obligation hangs on, as short text: contract number, order number or partner. */
export const attachedTo = (o: Obligation) => o.contract_number || o.io_number || o.partner_name || '';
