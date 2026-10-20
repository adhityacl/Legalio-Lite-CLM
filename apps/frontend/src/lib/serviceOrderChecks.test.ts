import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Contract, InsertionOrder } from '@legalio/types';
import { serviceOrderChecks } from './serviceOrderChecks';

const parent = { contract_id: 'C1', partner_id: 'P1', currency: 'IDR', contract_value: 100, status: 'Active', start_date: '2026-01-01', end_date: '2026-12-31' } as Contract;
const sibling = { io_id: 'IO1', io_number: 'SO/1', contract_id: 'C1', currency: 'IDR', io_value: 60 } as InsertionOrder;
const draft = { io_number: 'SO/2', partner_id: 'P1', currency: 'IDR', io_value: 30, start_date: '2026-02-01', end_date: '2026-03-01' };
const byKey = (checks: ReturnType<typeof serviceOrderChecks>) => Object.fromEntries(checks.map((c) => [c.key, c.status]));

test('an SO that fits its parent contract passes every check', () => {
  assert.deepEqual(byKey(serviceOrderChecks(draft, parent, [sibling])), { active: 'ok', period: 'ok', partner: 'ok', currency: 'ok', budget: 'ok', number: 'ok' });
});

test('flags an expired parent, out-of-term dates, another partner, over-budget and a duplicate number', () => {
  const bad = { ...draft, io_number: 'so/1 ', partner_id: 'P2', io_value: 50, end_date: '2027-01-31' };
  assert.deepEqual(byKey(serviceOrderChecks(bad, { ...parent, status: 'Expired' }, [sibling])),
    { active: 'fail', period: 'warn', partner: 'fail', currency: 'ok', budget: 'warn', number: 'fail' });
});

test('editing an SO does not count itself as a duplicate or against the budget', () => {
  assert.deepEqual(byKey(serviceOrderChecks({ ...draft, io_id: 'IO1', io_number: 'SO/1', io_value: 100 }, parent, [sibling])).number, 'ok');
  assert.equal(byKey(serviceOrderChecks({ ...draft, io_id: 'IO1', io_number: 'SO/1', io_value: 100 }, parent, [sibling])).budget, 'ok');
});

test('without a parent contract only the duplicate-number check runs', () => {
  assert.deepEqual(serviceOrderChecks(draft, undefined, [sibling]), [{ key: 'number', status: 'ok' }]);
});
