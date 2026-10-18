import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bulkDate, bulkDateAmbiguous, bulkNumber } from './bulkParse';

test('bulkDateAmbiguous flags only day/month text that could be read either way', () => {
  for (const text of ['03/04/2026', '3-4-2026', '12.01.2026']) assert.equal(bulkDateAmbiguous(text), true, text);
  for (const text of ['13/04/2026', '31/12/2026', '05/05/2026', '2026-04-03', 'abc', '', '31/02/2026', '02/30/2026']) assert.equal(bulkDateAmbiguous(text), false, text);
});

test('bulkNumber reads Indonesian, English and plain spreadsheet amounts', () => {
  const cases: Array<[unknown, number]> = [
    ['1.000.000,50', 1000000.5], ['1,000,000.50', 1000000.5], ['Rp 1.500', 1500], ['1.500.000', 1500000],
    ['1000000.50', 1000000.5], ['2.50', 2.5], ['2,5', 2.5], ['0.125', 0.125], ['-1.234,5', -1234.5],
    [5000, 5000], ['', 0], [undefined, 0], ['abc', 0],
  ];
  for (const [input, expected] of cases) assert.equal(bulkNumber(input), expected, String(input));
});

test('bulkDate normalizes real dates and rejects impossible ones', () => {
  assert.equal(bulkDate('2026-01-05'), '2026-01-05');
  assert.equal(bulkDate('5/1/2026'), '2026-01-05');
  assert.equal(bulkDate('31-12-2026'), '2026-12-31');
  assert.equal(bulkDate('2026-03-01T00:00:00.000Z'), '2026-03-01');
  assert.equal(bulkDate('  '), '');
  assert.equal(bulkDate(undefined), '');
  for (const bad of ['not-a-date', '2026-02-30', '31/02/2026', '13/13/2026', '46023']) assert.equal(bulkDate(bad), null, bad);
});
