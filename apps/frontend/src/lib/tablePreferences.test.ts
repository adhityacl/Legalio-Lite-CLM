import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSavedRowsPerPage } from './tablePreferences';

const store = new Map<string, string>();
globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as Storage;

test('rows per page falls back to the default when nothing is saved', () => {
  assert.equal(getSavedRowsPerPage('contracts', 5), 5);
});

test('rows per page keeps the saved choice', () => {
  store.set('lms_table_rows_contracts', '10');
  assert.equal(getSavedRowsPerPage('contracts', 5), 10);
  assert.equal(getSavedRowsPerPage('io', 5), 5);
});

test('rows per page ignores corrupt saved values', () => {
  for (const bad of ['abc', '0', '-5', '2.5']) {
    store.set('lms_table_rows_partners', bad);
    assert.equal(getSavedRowsPerPage('partners', 5), 5);
  }
});
