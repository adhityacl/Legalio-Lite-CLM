import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIST_PARAM_PREFIX as NAVIGATION_PREFIX } from '@legalio/platform-console/context/NavigationContext';
import { applyListState, DEFAULT_LIST_STATE, LIST_PARAM_PREFIX, parseListState } from './listState';
import { aggregateValueInCurrency, buildSpendingSeriesFromAggregate } from './dashboardMetrics';
import { searchHitsToResults } from '@legalio/platform-console/lib/workspaceSearch';

const FILTERS = ['status', 'category'] as const;

test('list state round-trips through the query string and leaves other parameters alone', () => {
  const state = { page: 3, q: 'acme corp', sort: 'end_date', dir: 'desc' as const, filters: { status: 'Active' } };
  const search = applyListState('tab=contracts&id=C1', state, FILTERS);
  const params = new URLSearchParams(search);
  assert.equal(params.get('tab'), 'contracts');
  assert.equal(params.get('id'), 'C1');
  assert.equal(params.get('l.page'), '3');
  assert.deepEqual(parseListState(search, FILTERS), state);
});

test('defaults are not written, stale list parameters are replaced and unknown filters are ignored', () => {
  assert.equal(applyListState('tab=partners&l.page=4&l.q=x&l.f.status=Active', DEFAULT_LIST_STATE, FILTERS), 'tab=partners');
  const parsed = parseListState('l.page=-2&l.sort=&l.dir=sideways&l.f.status=Expired&l.f.evil=1', FILTERS);
  assert.equal(parsed.page, 1);
  assert.equal(parsed.sort, null);
  assert.equal(parsed.dir, 'asc');
  assert.deepEqual(parsed.filters, { status: 'Expired' });
});

test('the list prefix is the one the navigation drops on a page change', () => {
  assert.equal(LIST_PARAM_PREFIX, NAVIGATION_PREFIX);
});

test('server search hits become palette entries whose keywords carry the query', () => {
  const results = searchHitsToResults([
    { entity_type: 'contracts', entity_id: 'C1', title: 'CTR-1 Master' },
    { entity_type: 'partners', entity_id: 'P1', title: 'Acme' },
    { entity_type: 'unknown', entity_id: 'X', title: 'skip' },
  ], 'acme');
  assert.deepEqual(results.map((r) => [r.kind, r.tab, r.recordId]), [['contract', 'contracts', 'C1'], ['partner', 'partners', 'P1']]);
  assert.ok(results.every((r) => r.keywords.includes('acme')));
});

test('spending chart from the server roll-up: year and category filters, top vendors, converted amounts', () => {
  const rows = [
    { vendor_id: 'P1', vendor_name: 'Alpha', month: '2026-01', currency: 'USD', amount: 100, amount_usd: 100, categories: ['Ads'] },
    { vendor_id: 'P1', vendor_name: 'Alpha', month: '2026-02', currency: 'USD', amount: 50, amount_usd: 50, categories: ['Ads'] },
    { vendor_id: 'P2', vendor_name: 'Beta', month: '2025-12', currency: 'USD', amount: 70, amount_usd: 70, categories: [] },
  ];
  const usd = (row: (typeof rows)[number]) => row.amount_usd ?? 0;
  const y2026 = buildSpendingSeriesFromAggregate(rows, '2026', 'ALL', usd, 'Other', 'Other');
  assert.equal(y2026.total, 150);
  assert.deepEqual(y2026.series.map((s) => s.name), ['Alpha']);
  assert.equal(y2026.data[0].month, '2026-01');
  assert.equal(y2026.data[1]['vendor:P1'], 50);
  const all = buildSpendingSeriesFromAggregate(rows, 'ALL', 'ALL', usd, 'Other', 'Other');
  assert.equal(all.total, 220);
  const uncategorised = buildSpendingSeriesFromAggregate(rows, 'ALL', 'Other', usd, 'Other', 'Other');
  assert.equal(uncategorised.total, 70);
  assert.equal(aggregateValueInCurrency([{ currency: 'USD', amount: 10, amountUsdKnown: 10, amountMissingUsd: 0 }], 'USD'), 10);
});
