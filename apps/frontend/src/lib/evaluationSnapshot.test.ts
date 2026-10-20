import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Contract, InsertionOrder, PartnerEvaluation, PartnerSpending } from '@legalio/types';
import { evaluationSnapshot } from './evaluationSnapshot';

const so = { io_id: 'IO1', partner_id: 'P1', currency: 'IDR', pricing_model: 'CPM', unit_price: 32_000, io_value: 160_000_000, io_value_usd: 10_000,
  start_date: '2026-01-01', end_date: '2026-12-31' } as InsertionOrder;
const peer = { ...so, io_id: 'IO2', partner_id: 'P2', unit_price: 25_000 } as InsertionOrder;
const spend = (id: string, date: string, usd: number, extra: Partial<PartnerSpending> = {}) =>
  ({ id, vendor_id: 'P1', vendor_name: 'Beta', invoice_number: id, invoice_date: date, currency: 'IDR', total_amount: usd * 16_000, total_amount_usd: usd, ...extra }) as PartnerSpending;
const data = {
  partners: [],
  contracts: [
    { contract_id: 'C1', partner_id: 'P1', contract_number: 'PKS/1', start_date: '2025-06-01', end_date: '2026-12-15', auto_renewal: true,
      redline_analysis: { overallRiskScore: 40 } } as Contract,
    { contract_id: 'C2', partner_id: 'P1', contract_number: 'PKS/0', start_date: '2023-01-01', end_date: '2024-12-31', redline_analysis: { overallRiskScore: 60 } } as Contract,
  ],
  ios: [so, peer],
  spendings: [
    spend('S1', '2026-02-10', 2_000, { io_id: 'IO1', billed_quantity: 750_000 }), // 32 jt IDR at CPM 32.000 = 1,000,000 → 25% short
    spend('S2', '2026-05-01', 3_000, { io_id: 'IO1', month_allocations: [{ month: '2026-05', amount: 24_000_000 }, { month: '2026-06', amount: 24_000_000 }] }),
    spend('S3', '2025-03-01', 4_000),
    { ...spend('S4', '2026-04-01', 9_999), vendor_id: 'P2' },
  ],
  evaluations: [{ id: 'E1', partner_id: 'P1', supplier_name: 'Beta', review_date: '2025-12-01', calculated_score: 82 } as PartnerEvaluation],
};

test('summarises one partner for the evaluation year from contracts, SOs, spendings and past evaluations', () => {
  const s = evaluationSnapshot({ partner_id: 'P1', partner_name: 'Beta' }, 2026, '2026-10-20', data);
  assert.equal(s.ytd, true);
  assert.equal(s.spendUsd, 5_000);
  assert.equal(s.growthPct, 25);
  assert.deepEqual(s.monthlyUsd, [0, 2_000, 0, 0, 1_500, 1_500, 0, 0, 0, 0, 0, 0]);
  assert.equal(s.invoices, 2);
  assert.equal(s.activeContracts, 1);
  assert.equal(s.activeSos, 1);
  assert.equal(s.soUsedPct, 50);
  assert.deepEqual(s.underDelivered, { count: 1, of: 1, avgPct: 25 });
  assert.deepEqual(s.expiring, [{ number: 'PKS/1', endDate: '2026-12-15', autoRenewal: true }]);
  assert.equal(s.avgRiskScore, 50);
  assert.deepEqual(s.previous, { year: 2025, score: 82 });
  assert.deepEqual(s.pricing, { model: 'CPM', currency: 'IDR', price: 32_000, peerAvg: 25_000, diffPct: 28 });
});

test('a partner with no history gives an empty snapshot without growth, previous score or pricing', () => {
  const s = evaluationSnapshot({ partner_id: 'P9', partner_name: 'New' }, 2026, '2026-10-20', data);
  assert.equal(s.spendUsd, 0);
  assert.equal(s.growthPct, undefined);
  assert.equal(s.previous, undefined);
  assert.equal(s.pricing, undefined);
  assert.deepEqual(s.underDelivered, { count: 0, of: 0, avgPct: undefined });
});

test('older rows without a partner id are matched by name, and the evaluation being edited is not its own "previous"', () => {
  const byName = evaluationSnapshot({ partner_name: 'Beta' }, 2026, '2026-10-20', data, 'E1');
  assert.equal(byName.previous, undefined);
  assert.equal(byName.spendUsd, 14_999); // name-only match includes the P2 row that reuses the name
});
