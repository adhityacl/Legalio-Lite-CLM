import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, parseCSV } from '../apps/frontend/src/lib/csv';

const build = (rows: string[][]) => '﻿sep=,\r\n' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

test('exported CSV (BOM + sep line, commas, quotes, line breaks) re-imports intact', () => {
  const rows = [
    ['nama_partner', 'catatan', 'tanggal'],
    ['PT Contoh, Tbk', 'Baris 1\nBaris 2 "kutip"', 'Apr 1, 2025'],
  ];
  const parsed = parseCSV(build(rows))!;
  assert.deepEqual(parsed.headers, rows[0]);
  assert.deepEqual(Object.values(parsed.rows[0]), rows[1]);
});

test('semicolon-delimited Excel files and formula-looking cells', () => {
  const parsed = parseCSV('a;b\r\n1;2\r\n')!;
  assert.deepEqual(parsed.rows, [{ a: '1', b: '2' }]);
  assert.equal(csvCell('=SUM(A1)'), `"'=SUM(A1)"`);
  assert.equal(csvCell('-5'), '"-5"');
  assert.equal(parseCSV('only header'), null);
});
