import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Contract, InsertionOrder, Partner, PartnerSpending } from '@legalio/types';
import { spendingChecks, spendingEstimate } from './spendingChecks';

const so = { io_id: 'IO1', partner_id: 'P1', currency: 'IDR', pricing_model: 'CPM', unit: 'impressions', unit_price: 25_000, io_value: 125_000_000,
  start_date: '2026-01-01', end_date: '2026-12-31' } as InsertionOrder;
const earlier = { id: 'S1', vendor_id: 'P1', vendor_name: 'PT Beta Media', invoice_number: 'INV-1', invoice_date: '2026-03-01', currency: 'IDR',
  total_amount: 50_000_000, io_id: 'IO1', bank_account_number: '123-456' } as PartnerSpending;
const draft = { vendor_id: 'P1', vendor_name: 'PT Beta Media', invoice_number: 'INV-2', invoice_date: '2026-07-02', currency: 'IDR',
  total_amount: 50_000_000, bank_account_number: '123456', bank_account_holder_name: 'Beta Media Tbk', io_id: 'IO1', billed_quantity: 1_500_000 };
const partners = [{ partner_id: 'P1', partner_name: 'PT Beta Media', status_dd: 'Complete' }] as Partner[];
const data = { partners, contracts: [] as Contract[], ios: [so], spendings: [earlier] };

test('CPM maths: Rp 50 jt at Rp 25.000 per 1,000 = 2,000,000 impressions; 1.5 jt billed is a 25% shortfall', () => {
  const e = spendingEstimate(draft, so, [earlier])!;
  assert.equal(e.expectedUnits, 2_000_000);
  assert.equal(e.shortfallPct, 25);
  assert.equal(e.budgetUsedPct, 80);
  assert.equal(e.remainingBudget, 25_000_000);
  assert.equal(e.remainingUnits, 1_000_000);
  assert.deepEqual(spendingChecks(draft, data, e), [{ key: 'under_delivery', status: 'warn', value: 25 }]);
});

test('per-unit models divide by the unit price; flat fees get no unit maths', () => {
  assert.equal(spendingEstimate(draft, { ...so, pricing_model: 'CPC', unit_price: 2_000 }, [])!.expectedUnits, 25_000);
  assert.equal(spendingEstimate(draft, { ...so, pricing_model: 'Fixed' }, [])!.expectedUnits, undefined);
  assert.equal(spendingEstimate({ ...draft, currency: 'USD' }, so, []), null);
});

test('flags duplicate, changed bank account, holder mismatch and over budget, but not incomplete vendor DD', () => {
  const bad = { ...draft, invoice_number: 'inv-1', bank_account_number: '999', bank_account_holder_name: 'John Doe', total_amount: 50_000_000, billed_quantity: undefined };
  const twice = { ...earlier, id: 'S0', invoice_number: 'X', total_amount: 80_000_000 } as PartnerSpending;
  const all = { ...data, partners: [{ ...partners[0], status_dd: 'Incomplete' }] as Partner[], spendings: [earlier, twice] };
  const keys = spendingChecks(bad, all, spendingEstimate(bad, so, all.spendings)).map((c) => c.key);
  assert.deepEqual(keys, ['duplicate', 'bank_changed', 'holder_mismatch', 'over_budget']);
});

test('without a linked SO it warns when no contract or SO covers the invoice date', () => {
  const unlinked = { ...draft, io_id: undefined };
  assert.deepEqual(spendingChecks(unlinked, { ...data, ios: [] }, null).map((c) => c.key), ['no_agreement']);
  assert.deepEqual(spendingChecks(unlinked, data, null), []);
});

test('a flat-fee SO billed well ahead of its period is flagged', () => {
  const fixed = { ...so, pricing_model: 'Fixed' } as InsertionOrder;
  const early = { ...draft, invoice_date: '2026-03-01', billed_quantity: undefined };
  const checks = spendingChecks(early, { ...data, ios: [fixed] }, spendingEstimate(early, fixed, [earlier]));
  assert.equal(checks[0].key, 'ahead_of_schedule');
});
