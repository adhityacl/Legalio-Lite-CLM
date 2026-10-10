import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buildDemoDataset } from '@legalio/shared/data/demoDataset';
import { LanguageProvider } from '../apps/frontend/src/context/LanguageContext';
import { EventItem } from '../apps/frontend/src/features/calendar/EventItem';
import { EXAMPLE_CALENDAR_EVENTS } from '../apps/frontend/src/features/calendar/DocumentCalendar.example';
import { EVENT_TYPES } from '../apps/frontend/src/features/calendar/eventTypes';
import { buildDocumentCalendarEvents, calendarDateKey, getMonthDays, groupCalendarEvents, parseCalendarDate } from '../apps/frontend/src/features/calendar/calendarModel';
import type { Contract, InsertionOrder, Partner, UserSession } from '@legalio/types';

const data = buildDemoDataset();
const tenantId = data.tenants[0].id;
const partner: Partner = { ...data.partners[0] as Partner, pic_internal: 'Legal', internal_pic: 'Legal' };
const user: UserSession = { email: 'calendar@example.com', name: 'Calendar', role: 'Admin', department: 'Legal' };
const contract = (overrides: Partial<Contract> = {}): Contract => ({ ...data.contracts[0] as Contract, organizationId: tenantId,
  partner_id: partner.partner_id, partner_nama: partner.nama_partner, tanggal_mulai: '2026-06-01', tanggal_berakhir: '2026-07-31',
  auto_renewal: false, notice_period_hari: 30, notice_type_required: 'Termination', status: 'Active', status_approval: 'Signed', ...overrides });
const eventsFor = (record: Contract) => buildDocumentCalendarEvents([record], [], [partner], user, tenantId);

test('business dates retain local components, including legacy dates and ISO timestamp prefixes', () => {
  for (const input of ['2026-06-01', '01/06/2026', '01-06-2026', '2026-06-01T00:00:00Z']) {
    const date = parseCalendarDate(input)!;
    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getMonth(), 5);
    assert.equal(date.getDate(), 1);
    assert.equal(calendarDateKey(date), '2026-06-01');
  }
});

test('invalid dates and indefinite end dates produce no events', () => {
  for (const input of ['', 'invalid', '2026-02-29', '2026-04-31', '2026-13-01', '9999-12-31', undefined]) assert.equal(parseCalendarDate(input), null);
  assert.equal(calendarDateKey(parseCalendarDate('2024-02-29')!), '2024-02-29');
  assert.deepEqual(eventsFor(contract({ tanggal_berakhir: '9999-12-31', auto_renewal: true })).map(event => event.type), ['contract_start']);
});

test('notice dates cross month/year boundaries; automatic renewal is explicitly projected', () => {
  const events = eventsFor(contract({ tanggal_berakhir: '2026-01-10', auto_renewal: true }));
  assert.equal(events.find(event => event.type === 'cancellation_notice')?.date, '2025-12-11');
  const renewal = events.find(event => event.type === 'renewal')!;
  assert.equal(renewal.date, '2026-01-11');
  assert.equal(renewal.projected, true);
  assert.equal(renewal.documentKind, 'contract');
});

test('only cancellation notice rules create cancellation events', () => {
  for (const notice_type_required of ['None', 'Extension'] as const) assert.ok(!eventsFor(contract({ notice_type_required })).some(event => event.type === 'cancellation_notice'));
  for (const notice_period_hari of [0, -1, 1.5, NaN]) assert.ok(!eventsFor(contract({ notice_period_hari })).some(event => event.type === 'cancellation_notice'));
  assert.ok(eventsFor(contract({ notice_type_required: 'Both' })).some(event => event.type === 'cancellation_notice'));
});

test('terminated status never invents a termination date or future renewal', () => {
  const events = eventsFor(contract({ status: 'Terminated', auto_renewal: true }));
  assert.ok(!events.some(event => event.type === 'termination' || event.type === 'renewal'));
});

test('explicit termination dates create events even while a termination is scheduled', () => {
  const events = eventsFor(contract({ lifecycle_mode: 'terminated', termination_date: '2026-07-10', status: 'Active', auto_renewal: true }));
  assert.equal(events.find(event => event.type === 'termination')?.date, '2026-07-10');
  assert.ok(!events.some(event => event.type === 'renewal'));
});

// Department scope is enforced by the server before records reach the client
// (tenant-boundaries PRD §4.5.3); the calendar keeps tenant and final-document rules.
test('tenant and final-document scoping are applied before event creation', () => {
  const viewer = { ...user, role: 'Viewer' };
  const records = [contract(), contract({ contract_id: 'other-tenant', organizationId: 'elsewhere' }),
    contract({ contract_id: 'draft', status: 'Expired', status_approval: 'Draft' })];
  const events = buildDocumentCalendarEvents(records, [], [partner], viewer, tenantId);
  assert.ok(events.length > 0);
  assert.ok(events.every(event => event.documentId === records[0].contract_id));
  assert.deepEqual(buildDocumentCalendarEvents(records, [], [partner], null, tenantId), []);
  assert.deepEqual(buildDocumentCalendarEvents(records, [], [partner], user, ''), []);
});

test('commercial documents use their own IDs and dates, including legacy end-date fallback', () => {
  const io: InsertionOrder = { ...data.ios[0] as InsertionOrder, organizationId: tenantId, io_id: data.contracts[0].contract_id, partner_id: partner.partner_id,
    tanggal_mulai: '2026-05-01', tanggal_berakhir: '', tanggal_selesai: '2026-05-31', notice_type_required: 'None' as const };
  const events = buildDocumentCalendarEvents([contract()], [io], [partner], user, tenantId);
  assert.equal(new Set(events.map(event => event.id)).size, events.length);
  assert.equal(events.find(event => event.documentKind === 'io' && event.type === 'contract_end')?.date, '2026-05-31');
});

test('month grid has complete weeks, configured first weekday and at least five rows', () => {
  for (const weekStartsOn of [0, 1] as const) {
    for (let month = 0; month < 12; month++) {
      const days = getMonthDays(new Date(2026, month, 1), weekStartsOn);
      assert.ok([35, 42].includes(days.length));
      assert.equal(days[0].getDay(), weekStartsOn);
      assert.ok(days.some(day => day.getMonth() === month && day.getDate() === 1));
    }
  }
});

test('shared filters and search group sorted events into day and month buckets', () => {
  const enabled = new Set(EVENT_TYPES);
  const groups = groupCalendarEvents([...EXAMPLE_CALENDAR_EVENTS].reverse(), enabled, '');
  assert.equal(groups.byMonth.get('2026-06')!.length, 6);
  assert.equal(groups.byDay.get('2026-06-12')!.length, 5);
  assert.equal(groups.byMonth.get('2026-06')!.at(-1)!.date, '2026-06-15');
  assert.equal(groupCalendarEvents(EXAMPLE_CALENDAR_EVENTS, enabled, '  CLOUD ').byDay.size, 1);
  enabled.delete('renewal');
  assert.equal(groupCalendarEvents(EXAMPLE_CALENDAR_EVENTS, enabled, 'cloud').byDay.size, 0);
  assert.equal(groupCalendarEvents(EXAMPLE_CALENDAR_EVENTS, new Set(), '').byDay.size, 0);
  assert.equal(groupCalendarEvents([{ ...EXAMPLE_CALENDAR_EVENTS[0], date: '2026-02-30' }], enabled, '').byDay.size, 0);
});

test('example covers all six event types, overflowing month/day and completed task presentation', () => {
  assert.ok(EXAMPLE_CALENDAR_EVENTS.length >= 15);
  assert.deepEqual(new Set(EXAMPLE_CALENDAR_EVENTS.map(event => event.type)), new Set(EVENT_TYPES));
  const done = EXAMPLE_CALENDAR_EVENTS.find(event => event.status === 'done')!;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  try {
    const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() },
      createElement(LanguageProvider, null, createElement(EventItem, { event: done, onEventClick: () => {} }))));
    assert.match(markup, /line-through/);
    assert.match(markup, /<button/);
    assert.match(markup, /aria-label=/);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
