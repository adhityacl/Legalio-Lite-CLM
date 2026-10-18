import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withTransientRetry } from './documentsApi';

test('a transient failure (HTTP 408, network error) is retried; other errors are not', async () => {
  let calls = 0;
  const flaky = () => { calls += 1; return calls < 3 ? Promise.reject(calls === 1 ? new Error('HTTP 408') : new TypeError('Failed to fetch')) : Promise.resolve('saved'); };
  assert.equal(await withTransientRetry(flaky, [0, 0]), 'saved');
  assert.equal(calls, 3);

  let denied = 0;
  await assert.rejects(withTransientRetry(() => { denied += 1; return Promise.reject(new Error('HTTP 403')); }, [0, 0]), /403/);
  assert.equal(denied, 1);

  let always = 0;
  await assert.rejects(withTransientRetry(() => { always += 1; return Promise.reject(new Error('HTTP 504')); }, [0, 0]), /504/);
  assert.equal(always, 3);
});
