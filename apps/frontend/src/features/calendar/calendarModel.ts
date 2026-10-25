import { addDays, eachDayOfInterval, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, subDays } from 'date-fns';
import type { Contract, InsertionOrder, Partner, UserSession } from '@legalio/types';
import { canViewContract, canViewIO } from '../../lib/rbacScoping';
import { contractLifecycleMode } from '@legalio/shared/contractLifecycle';
import type { CalendarEvent, EventType } from './eventTypes';

/** Read ISO and supported legacy business dates without UTC conversion or date rollover. */
export function parseCalendarDate(value: string | undefined | null): Date | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value || '');
  const legacy = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(value || '');
  if (!iso && !legacy) return null;
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : [Number(legacy![3]), Number(legacy![2]), Number(legacy![1])];
  // The application uses 9999 as an indefinite end-date sentinel.
  if (year < 100 || year >= 9999) return null;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export const calendarDateKey = (date: Date): string => format(date, 'yyyy-MM-dd');

export function getMonthDays(date: Date, weekStartsOn: 0 | 1): Date[] {
  const start = startOfWeek(startOfMonth(date), { weekStartsOn });
  const end = endOfWeek(endOfMonth(date), { weekStartsOn });
  // Keep a minimum of five week rows, including February starting on the first weekday.
  return eachDayOfInterval({ start, end: end < addDays(start, 34) ? addDays(start, 34) : end });
}

export function groupCalendarEvents(events: CalendarEvent[], enabled: ReadonlySet<EventType>, search: string) {
  const byDay = new Map<string, CalendarEvent[]>();
  const byMonth = new Map<string, CalendarEvent[]>();
  const query = search.trim().toLocaleLowerCase();
  const filtered = events.filter(event => enabled.has(event.type) && parseCalendarDate(event.date)
    && event.title.toLocaleLowerCase().includes(query))
    .map(event => ({ ...event, date: calendarDateKey(parseCalendarDate(event.date)!) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  for (const event of filtered) {
    const date = event.date;
    const month = date.slice(0, 7);
    if (!byDay.has(date)) byDay.set(date, []);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byDay.get(date)!.push(event);
    byMonth.get(month)!.push(event);
  }
  return { byDay, byMonth };
}

/** Apply the same document visibility rules as the existing list views before creating events. */
export function buildDocumentCalendarEvents(
  contracts: Contract[], ios: InsertionOrder[], partners: Partner[], user: UserSession | null, tenantId: string,
): CalendarEvent[] {
  if (!user || !tenantId) return [];
  const events: CalendarEvent[] = [];
  const inTenant = (record: { organizationId?: string }) => !record.organizationId || record.organizationId === tenantId;
  function append(record: Contract | InsertionOrder, documentKind: 'contract' | 'io') {
    const contract = documentKind === 'contract' ? record as Contract : undefined;
    const io = documentKind === 'io' ? record as InsertionOrder : undefined;
    const documentId = contract ? contract.contract_id : io!.io_id;
    if (!documentId) return;
    const title = (contract ? contract.contract_title || contract.contract_number : io!.io_title || io!.io_number) || documentId;
    const partnerName = partners.find(partner => partner.partner_id === record.partner_id)?.partner_name || (contract as { partner_name?: string } | undefined)?.partner_name || undefined;
    const add = (type: EventType, date: Date | null, projected = false) => {
      if (date) events.push({ id: `${documentKind}:${documentId}:${type}`, type, date: calendarDateKey(date), title, partnerName, documentId, documentKind, projected });
    };
    add('contract_start', parseCalendarDate(record.start_date));
    const end = parseCalendarDate(record.end_date || record.completion_date);
    add('contract_end', end);
    if (contract && contractLifecycleMode(contract) === 'terminated') add('termination', parseCalendarDate(contract.termination_date));
    const noticeDays = Number(record.notice_period_days ?? io?.notice_period_days);
    if (end && Number.isInteger(noticeDays) && noticeDays > 0 && ['Termination', 'Both'].includes(record.notice_type_required)) {
      add('cancellation_notice', subDays(end, noticeDays));
    }
    if (contract?.auto_renewal && end && contractLifecycleMode(contract) !== 'terminated') {
      // No persisted renewal date exists. The next period begins after the current end date.
      add('renewal', addDays(end, 1), true);
    }
    // A Terminated status is not a termination date. Do not infer it from end/updated_at.
  }
  contracts.filter(record => inTenant(record) && canViewContract(record, partners, user)).forEach(record => append(record, 'contract'));
  ios.filter(record => inTenant(record) && canViewIO(record, partners, user)).forEach(record => append(record, 'io'));
  return events;
}
