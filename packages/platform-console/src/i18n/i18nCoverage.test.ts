import assert from 'node:assert/strict';
import { test } from 'node:test';
import EN from './catalogs/en';
import ID from './catalogs/id';
import ZH from './catalogs/zh';

/** Keys of `reference` that `catalog` lacks or leaves empty. */
const missing = (reference: Record<string, string>, catalog: Record<string, string>) => Object.keys(reference).filter((key) => !catalog[key]);

test('the Indonesian and Chinese catalogs cover every English key', () => {
  const zh = missing(EN, ZH);
  const id = missing(EN, ID);
  if (zh.length) console.warn(`zh is missing ${zh.length} key(s) from en:\n${zh.join('\n')}`);
  assert.deepEqual(zh, [], 'add these keys to packages/platform-console/src/i18n/zh.ts');
  assert.deepEqual(id, [], 'add these keys to the Indonesian catalogs');
});

test('no language defines keys that English lacks', () => {
  assert.deepEqual(missing(ID, EN), []);
  assert.deepEqual(missing(ZH, EN), []);
});

test('placeholders used by English texts survive translation', () => {
  const placeholders = (text: string) => (text.match(/\{\w+\}/g) || []).sort().join(',');
  const broken = Object.keys(EN).filter((key) => ZH[key] && placeholders(EN[key]) !== placeholders(ZH[key]));
  assert.deepEqual(broken, []);
});
