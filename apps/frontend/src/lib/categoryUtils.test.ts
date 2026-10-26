import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
});
const { CATEGORY_STORAGE_KEY, DEFAULT_CATEGORIES, getSavedCategories, saveCategory, saveMultipleCategories } = await import('./categoryUtils');

const P2P = ['Institutional Lender', 'Distribution / Channel Partner', 'Marketing Affiliate'];
const stored = () => JSON.parse(store.get(CATEGORY_STORAGE_KEY) ?? '[]');

beforeEach(() => store.clear());

test('the industry pack categories come first, then the user’s own, then the neutral defaults', () => {
  store.set(CATEGORY_STORAGE_KEY, JSON.stringify(['Advertising']));
  assert.deepEqual(getSavedCategories(P2P), [...P2P, 'Advertising', ...DEFAULT_CATEGORIES]);
});

test('defaults stored by older versions do not push the pack categories down', () => {
  store.set(CATEGORY_STORAGE_KEY, JSON.stringify(['Supplier', 'IT', 'Advertising']));
  assert.deepEqual(getSavedCategories(P2P).slice(0, 4), [...P2P, 'Advertising']);
});

test('only categories the user typed are stored, without case duplicates, and the pack stays in the result', () => {
  const result = saveMultipleCategories(['Content', 'content', 'marketing affiliate', 'Supplier', '  '], P2P);
  assert.deepEqual(stored(), ['Content'], 'pack categories, defaults and repeats are not stored');
  assert.deepEqual(result.slice(0, 4), [...P2P, 'Content']);
  assert.deepEqual(saveCategory('Revenue Share Partner', P2P).slice(0, 5), [...P2P, 'Revenue Share Partner', 'Content']);
  assert.deepEqual(stored(), ['Revenue Share Partner', 'Content']);
});

test('without a pack the defaults still apply, and unreadable storage is ignored', () => {
  store.set(CATEGORY_STORAGE_KEY, '{not json');
  assert.deepEqual(getSavedCategories(), DEFAULT_CATEGORIES);
});
