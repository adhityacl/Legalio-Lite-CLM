import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, addMonths, daysBetween, effectiveStatus, isIsoDate, nextOccurrence } from './obligations';

test('month arithmetic keeps the day and clamps to the end of shorter months', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(addMonths('2026-12-31', 12), '2027-12-31');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
});

test('recurrence rules produce the next occurrence and stop at the end date', () => {
  assert.equal(nextOccurrence('2026-10-31', { recurrence: 'monthly' }), '2026-11-30');
  assert.equal(nextOccurrence('2026-10-15', { recurrence: 'quarterly' }), '2027-01-15');
  assert.equal(nextOccurrence('2026-10-15', { recurrence: 'yearly' }), '2027-10-15');
  assert.equal(nextOccurrence('2026-10-15', { recurrence: 'every_n_days', interval: 10 }), '2026-10-25');
  assert.equal(nextOccurrence('2026-10-15', { recurrence: 'every_n_days', interval: 0 }), null);
  assert.equal(nextOccurrence('2026-10-15', { recurrence: 'once' }), null);
  assert.equal(nextOccurrence('2026-10-15', { recurrence: 'monthly', until: '2026-11-14' }), null);
  assert.equal(nextOccurrence('2026-10-15', { recurrence: 'monthly', until: '2026-11-15' }), '2026-11-15');
});

test('overdue is derived from open work only', () => {
  assert.equal(effectiveStatus('open', '2026-10-01', '2026-10-02'), 'overdue');
  assert.equal(effectiveStatus('in_progress', '2026-10-01', '2026-10-02'), 'overdue');
  assert.equal(effectiveStatus('open', '2026-10-02', '2026-10-02'), 'open', 'due today is not overdue yet');
  assert.equal(effectiveStatus('done', '2026-10-01', '2026-10-02'), 'done');
  assert.equal(effectiveStatus('waived', '2026-10-01', '2026-10-02'), 'waived');
  assert.equal(effectiveStatus('open', null, '2026-10-02'), 'open');
});

test('dates are validated as real calendar days', () => {
  assert.ok(isIsoDate('2028-02-29'));
  assert.ok(!isIsoDate('2027-02-29'));
  assert.ok(!isIsoDate('2026-13-01'));
  assert.ok(!isIsoDate('2026-1-1'));
  assert.equal(daysBetween('2026-10-24', '2026-10-31'), 7);
  assert.equal(daysBetween('2026-10-24', '2026-10-20'), -4);
  assert.equal(daysBetween('2026-10-24', null), null);
});
