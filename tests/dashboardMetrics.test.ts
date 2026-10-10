import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpendingSeries, contractTotalInCurrency } from '../apps/frontend/src/lib/dashboardMetrics';
import { formatBusinessDate } from '../apps/frontend/src/lib/displayDate';
import type { Contract, PartnerSpending } from '@legalio/types';
const row = (id: string, months: string[], amount: number) => ({ vendor_id: id, vendor_name: id, invoice_month: months, total_amount: amount }) as PartnerSpending;
const chart = (rows: PartnerSpending[], year = 'ALL') => buildSpendingSeries(rows, year, 'ALL', () => [], r => r.total_amount, 'Other');

test('mixed-currency totals use stored USD amounts rather than adding raw nominal amounts', () => {
  const contracts = [
    { currency: 'USD', nilai_kontrak: 100 },
    { currency: 'IDR', nilai_kontrak: 1600000, nilai_kontrak_usd: 100 },
  ] as Contract[];
  assert.equal(contractTotalInCurrency(contracts, 'USD'), 200);
});
test('all years combines matching months and always returns January through December', () => {
  const result = chart([row('a', ['2025-01-31'], 100), row('a', ['2026-01-31'], 200)]);
  assert.equal(result.data.length, 12);
  assert.equal(result.data[0].month, '01');
  assert.equal(result.data[11].month, '12');
  assert.equal(result.data[0]['vendor:a'], 300);
  assert.equal(result.data[1]['vendor:a'], 0);
});
test('year filters allocate multi-period invoices without moving the full amount into one year', () => {
  const result = chart([row('a', ['2025-12-31', '2026-01-31'], 100)], '2026');
  assert.equal(result.total, 50);
  assert.equal(result.data[0]['vendor:a'], 50);
});
test('explicit June and July amounts override legacy months and the invoice date', () => {
  const invoice = { ...row('a', ['2026-08-31'], 100), invoice_date: '2026-08-19',
    month_allocations: [{ month: '2026-06', amount: 25 }, { month: '2026-07', amount: 75 }] };
  const result = chart([invoice], '2026');
  assert.equal(result.data[5]['vendor:a'], 25);
  assert.equal(result.data[6]['vendor:a'], 75);
  assert.equal(result.data[7]['vendor:a'], 0);
  assert.equal(result.total, 100);
});
test('cross-year allocations retain their exact amount in each year and all years', () => {
  const invoice = { ...row('a', [], 51042431), month_allocations: [
    { month: '2025-07', amount: 25521215 }, { month: '2026-06', amount: 25521216 },
  ] };
  const current = chart([invoice], '2026');
  assert.equal(current.total, 25521216);
  assert.equal(current.data[5]['vendor:a'], 25521216);
  assert.equal(current.data[6]['vendor:a'], 0);
  assert.equal(chart([invoice], '2025').data[6]['vendor:a'], 25521215);
  const all = chart([invoice]);
  assert.equal(all.total, 51042431);
  assert.equal(all.data[5]['vendor:a'], 25521216);
  assert.equal(all.data[6]['vendor:a'], 25521215);
});
test('monthly currency conversion uses the invoice rate and retains rounding residue', () => {
  const invoice = { ...row('a', [], 100), total_amount_usd: 10, month_allocations: [
    { month: '2026-06', amount: 33.33 }, { month: '2026-07', amount: 66.67 },
  ] };
  const result = buildSpendingSeries([invoice], '2026', 'ALL', () => [], r => r.total_amount_usd!, 'Other');
  assert.ok(Math.abs(Number(result.data[5]['vendor:a']) - 3.333) < 1e-10);
  assert.ok(Math.abs(Number(result.data[6]['vendor:a']) - 6.667) < 1e-10);
  assert.ok(Math.abs(result.total - 10) < 1e-10);
});
test('invalid explicit allocations are skipped without inventing an equal split', () => {
  for (const month_allocations of [[], [{ month: '2026-06', amount: 90 }],
    [{ month: '2026-13', amount: 100 }], [{ month: '2026-06', amount: -100 }]]) {
    const result = chart([{ ...row('a', ['2026-06-30'], 100), month_allocations }]);
    assert.equal(result.skipped, 1);
    assert.equal(result.total, 0);
  }
  const zero = chart([{ ...row('a', [], 0), month_allocations: [{ month: '2026-06', amount: 0 }] }]);
  assert.equal(zero.skipped, 0);
  assert.equal(zero.total, 0);
  assert.equal(zero.data[5]['vendor:a'], 0);
});
test('category and vendor aggregation sum the allocated amounts', () => {
  const invoice = { ...row('a', [], 100), month_allocations: [
    { month: '2026-06', amount: 25 }, { month: '2026-07', amount: 75 },
  ] };
  const result = buildSpendingSeries([invoice, { ...invoice }], '2026', 'Hosting', () => ['hosting'], r => r.total_amount, 'Other');
  assert.equal(result.data[5]['vendor:a'], 50);
  assert.equal(result.data[6]['vendor:a'], 150);
  assert.equal(result.total, 200);
  assert.equal(buildSpendingSeries([invoice], '2026', 'Other', () => ['Hosting'], r => r.total_amount, 'Other').total, 0);
});
test('vendor colors survive changes in ranking and top-five aggregation preserves totals', () => {
  const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => row(id, ['2026-01-31'], (index + 1) * 10));
  const original = chart(rows);
  const changed = chart([row('f', ['2026-01-31'], 1), row('e', ['2026-01-31'], 99)]);
  assert.equal(original.series.find(s => s.key === 'vendor:f')?.color, changed.series.find(s => s.key === 'vendor:f')?.color);
  assert.equal(original.data[0].other, 10);
  assert.equal(original.total, 210);
});
test('invalid periods are excluded rather than fabricated as January', () => {
  const result = chart([row('a', [], 100)]);
  assert.equal(result.skipped, 1);
  assert.equal(result.total, 0);
});
test('date-only formatting is consistent and missing review dates stay empty', () => {
  assert.equal(formatBusinessDate('2026-07-31', 'en-GB'), formatBusinessDate('31/07/2026', 'en-GB'));
  assert.equal(formatBusinessDate('2026'), '—');
  assert.equal(formatBusinessDate('2026-02-30'), '—');
});
