import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rememberReturnTo, takeReturnTo } from './returnTo';

const memory = () => {
  const data = new Map<string, string>();
  return { setItem: (k: string, v: string) => void data.set(k, v), getItem: (k: string) => data.get(k) ?? null, removeItem: (k: string) => void data.delete(k), data };
};

test('the requested page and record survive sign-in once, and only once', () => {
  const storage = memory();
  rememberReturnTo('contracts', 'C0001', storage);
  assert.deepEqual(takeReturnTo(storage), { tab: 'contracts', recordId: 'C0001' });
  assert.equal(takeReturnTo(storage), null);
});

test('login itself, malformed tabs and malformed record ids are not remembered', () => {
  const storage = memory();
  rememberReturnTo('login', null, storage);
  rememberReturnTo('../etc', null, storage);
  assert.equal(takeReturnTo(storage), null);
  rememberReturnTo('contracts', '"><script>', storage);
  assert.deepEqual(takeReturnTo(storage), { tab: 'contracts', recordId: null });
  storage.setItem('legalio:return-to', JSON.stringify({ tab: 'login' }));
  assert.equal(takeReturnTo(storage), null);
  storage.setItem('legalio:return-to', 'not json');
  assert.equal(takeReturnTo(storage), null);
});

test('unavailable storage is harmless', () => {
  const broken = { setItem: () => { throw new Error('denied'); }, getItem: () => { throw new Error('denied'); }, removeItem: () => undefined };
  assert.doesNotThrow(() => rememberReturnTo('contracts', 'C1', broken));
  assert.equal(takeReturnTo(broken), null);
});
