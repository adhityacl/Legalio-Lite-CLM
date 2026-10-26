import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractAiJson, parseAiJsonObject } from './aiJson';

test('plain JSON is parsed as is', () => {
  assert.deepEqual(extractAiJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractAiJson('  [1,2] '), [1, 2]);
});

test('a ```json fence, a bare fence and a byte-order mark are tolerated', () => {
  assert.deepEqual(extractAiJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractAiJson('```\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractAiJson(`${String.fromCharCode(0xfeff)}{"a":1}`), { a: 1 });
});

test('prose around the object is ignored', () => {
  assert.deepEqual(extractAiJson('Here is the result:\n```json\n{"a":{"b":[1]}}\n```\nLet me know.'), { a: { b: [1] } });
  assert.deepEqual(extractAiJson('Sure! {"a":"x}y"} Hope this helps.'), { a: 'x}y' });
});

test('nothing recoverable gives undefined, and the object helper a 502 AI_INVALID_OUTPUT', () => {
  assert.equal(extractAiJson(''), undefined);
  assert.equal(extractAiJson(undefined), undefined);
  assert.equal(extractAiJson('no json here'), undefined);
  assert.equal(extractAiJson('{"a": 1,, }'), undefined);
  assert.throws(() => parseAiJsonObject('not json'), (e: any) => e.status === 502 && e.code === 'AI_INVALID_OUTPUT');
  assert.throws(() => parseAiJsonObject('[1,2]'), (e: any) => e.code === 'AI_INVALID_OUTPUT', 'an array is not the object we asked for');
  assert.deepEqual(parseAiJsonObject('```json\n{"ok":true}\n```'), { ok: true });
});
