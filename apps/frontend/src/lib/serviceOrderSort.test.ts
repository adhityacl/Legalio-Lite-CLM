import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InsertionOrder } from '@legalio/types';
import { sortServiceOrders } from './serviceOrderSort';

// Rows from the Service Order table screenshot, plus a legacy row that only has completion_date.
const ios = [
  { io_id: 'A', start_date: '2026-01-01', end_date: '2026-12-30' },
  { io_id: 'B', start_date: '2026-03-12', end_date: '2027-03-12' },
  { io_id: 'C', start_date: '2024-11-04', end_date: '2025-11-03' },
  { io_id: 'D', start_date: '2025-01-01', end_date: '2026-01-01' },
  { io_id: 'E', start_date: '2024-07-01', end_date: '2025-07-01' },
  { io_id: 'F', start_date: '2025-06-01', end_date: '', completion_date: '9999-01-31' },
] as InsertionOrder[];
const ids = (list: InsertionOrder[]) => list.map((io) => io.io_id).join('');

test('sorts service orders by start date', () => {
  assert.equal(ids(sortServiceOrders(ios, 'start', 'asc')), 'ECDFAB');
  assert.equal(ids(sortServiceOrders(ios, 'start', 'desc')), 'BAFDCE');
});

test('sorts service orders by end date, falling back to completion_date', () => {
  assert.equal(ids(sortServiceOrders(ios, 'end', 'asc')), 'ECDABF');
  assert.equal(ids(sortServiceOrders(ios, 'end', 'desc')), 'FBADCE');
});

test('does not mutate the input list', () => {
  sortServiceOrders(ios, 'start', 'asc');
  assert.equal(ids(ios), 'ABCDEF');
});
