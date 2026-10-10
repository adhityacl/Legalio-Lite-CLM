import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allocationInvoiceMonths, hydrateSpendingAllocations, parsedSpendingAllocations, splitSpendingEqually, validateSpendingAllocations } from '@legalio/shared/spendingAllocations';

const rows = (amount = 100) => [{ month: '2026-10', amount }];

test('one month and multiple months balance with floating-point tolerance', () => {
  assert.equal(validateSpendingAllocations(rows(), 100), null);
  assert.equal(validateSpendingAllocations([{ month: '2026-10', amount: 0.1 }, { month: '2026-11', amount: 0.2 }], 0.3), null);
  assert.equal(validateSpendingAllocations(rows(99.99), 100), 'mismatch');
  assert.equal(validateSpendingAllocations(rows(100.01), 100), 'mismatch');
});

test('invalid, duplicate, negative and missing values cannot save', () => {
  assert.equal(validateSpendingAllocations([], 0), 'empty');
  assert.equal(validateSpendingAllocations([...rows(), ...rows()], 200), 'duplicate');
  for (const month of ['', '2026-13', '102026', '2026-10-31', 'invalid']) assert.equal(validateSpendingAllocations([{ month, amount: 100 }], 100), 'month');
  for (const amount of ['', -1, NaN, Infinity, '100', null]) assert.equal(validateSpendingAllocations([{ month: '2026-10', amount }], 100), 'amount');
  for (const total of ['', -1, NaN, Infinity, null, undefined]) assert.equal(validateSpendingAllocations(rows(), total), 'total');
});

test('equal split retains rounding residue including zero minor-unit currencies', () => {
  const months = ['2026-10', '2026-11', '2026-12'].map(month => ({ month, amount: '' as const }));
  const usd = splitSpendingEqually(months, 100);
  assert.deepEqual(usd.map(row => row.amount), [33.33, 33.33, 33.34]);
  assert.equal(validateSpendingAllocations(usd, 100), null);
  const jpy = splitSpendingEqually(months, 100, 0);
  assert.deepEqual(jpy.map(row => row.amount), [33, 33, 34]);
  assert.equal(validateSpendingAllocations(jpy, 100), null);
  for (const total of [0, 0.01, 1.999, 30000000, 123.456]) assert.equal(validateSpendingAllocations(splitSpendingEqually(months, total), total), null);
});

test('legacy edit expands existing month formats without assigning historical amounts', () => {
  const legacy = { invoice_month: ['102026 112026', 'December 2026', '2026-10-31'] };
  assert.deepEqual(hydrateSpendingAllocations(legacy), ['2026-10', '2026-11', '2026-12'].map(month => ({ month, amount: '' })));
  assert.deepEqual(legacy.invoice_month, ['102026 112026', 'December 2026', '2026-10-31']);
  assert.deepEqual(hydrateSpendingAllocations(), []);
  const stored = { invoice_month: ['2026-10-31'], month_allocations: rows() };
  const hydrated = hydrateSpendingAllocations(stored);
  hydrated[0].amount = 50;
  assert.equal(stored.month_allocations[0].amount, 100);
});

test('saved reporting months retain existing end-of-month representation', () => {
  assert.deepEqual(allocationInvoiceMonths([{ month: '2024-02' }, { month: '2026-10' }]), ['2024-02-29', '2026-10-31']);
});

test('AI uses only explicit spending months; date and old inferred month cannot populate allocations', () => {
  assert.equal(parsedSpendingAllocations({ invoice_date: '2026-09-29', invoice_month: '2026-09' } as any), null);
  assert.equal(parsedSpendingAllocations({ spending_months: [] }), null);
  assert.deepEqual(parsedSpendingAllocations({ spending_months: ['2026-10', '2026-11', '2026-12'] }), ['2026-10', '2026-11', '2026-12'].map(month => ({ month, amount: '' })));
  assert.deepEqual(parsedSpendingAllocations({ spending_months: ['2026-10'], month_allocations: rows(50) }), rows(50));
  assert.deepEqual(parsedSpendingAllocations({ spending_months: ['2026-10', '2026-10', '2026-13'], month_allocations: rows(-50) }), [{ month: '2026-10', amount: '' }]);
});
