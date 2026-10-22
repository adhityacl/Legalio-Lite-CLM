import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cosStore, keyFromLink, memoryStore, parseCosConfig, probe, type ObjectStore } from './objectStore';

const config = { secretId: 'AKIDexample1234', secretKey: 'secret', bucket: 'legalio-1250000000', region: 'ap-jakarta', prefix: 'tenant-a' };

async function contract(store: ObjectStore) {
  assert.equal(await store.get('a/b.pdf'), null);
  await store.put('a/b.pdf', Buffer.from('one'), 'application/pdf');
  await store.put('a/c.pdf', Buffer.from('two'));
  await store.put('z.pdf', Buffer.from('three'));
  const got = await store.get('a/b.pdf');
  assert.equal(got?.body.toString(), 'one');
  assert.deepEqual((await store.list('a/')).map((o) => [o.key, o.size]).sort(), [['a/b.pdf', 3], ['a/c.pdf', 3]]);
  const before = (await store.list('a/b.pdf'))[0].etag;
  await store.put('a/b.pdf', Buffer.from('changed'));
  assert.notEqual((await store.list('a/b.pdf'))[0].etag, before, 'a replaced object gets a new etag');
  await store.delete('a/b.pdf');
  await store.delete('a/b.pdf'); // deleting a missing key is not an error
  assert.equal(await store.get('a/b.pdf'), null);
  assert.equal((await store.list('')).length, 2);
  await probe(store);
  assert.equal((await store.list('')).length, 2, 'probe cleans up after itself');
}

test('memoryStore honours the ObjectStore contract', async () => {
  await contract(memoryStore());
});

test('memoryStore returns copies, not the stored buffer', async () => {
  const store = memoryStore();
  const body = Buffer.from('abc');
  await store.put('k', body);
  body.write('x');
  (await store.get('k'))!.body.write('y');
  assert.equal((await store.get('k'))!.body.toString(), 'abc');
});

/** Just enough of the COS SDK: one bucket, at most `pageSize` keys per getBucket call. */
function fakeCos(pageSize = 2) {
  const objects = new Map<string, Buffer>();
  const calls: any[] = [];
  const client = {
    async putObject(p: any) { calls.push(['put', p]); objects.set(p.Key, Buffer.from(p.Body)); return {}; },
    async getObject(p: any) {
      if (!objects.has(p.Key)) throw Object.assign(new Error('NoSuchKey'), { statusCode: 404 });
      return { Body: Buffer.from(objects.get(p.Key)!), ETag: '"x"', headers: { 'content-type': 'application/pdf' } };
    },
    async deleteObject(p: any) { objects.delete(p.Key); return {}; },
    async getBucket(p: any) {
      calls.push(['list', p]);
      const keys = [...objects.keys()].filter((k) => k.startsWith(p.Prefix) && (!p.Marker || k > p.Marker)).sort();
      const page = keys.slice(0, pageSize);
      return {
        Contents: page.map((Key) => ({ Key, Size: String(objects.get(Key)!.length), ETag: `"${objects.get(Key)!.toString('hex')}"`, LastModified: '2026-01-01T00:00:00Z' })),
        IsTruncated: keys.length > pageSize ? 'true' : 'false',
        NextMarker: keys.length > pageSize ? page.at(-1) : undefined,
      };
    },
  };
  return { client: client as any, objects, calls };
}

test('cosStore prefixes every key, strips it from list and follows truncated pages', async () => {
  const cos = fakeCos();
  const store = cosStore(config, cos.client);
  await contract(store);
  assert.ok([...cos.objects.keys()].every((k) => k.startsWith('tenant-a/')), 'nothing written outside the prefix');
  cos.objects.set('elsewhere.pdf', Buffer.from('not ours'));
  for (let i = 0; i < 5; i++) await store.put(`many/${i}.pdf`, Buffer.from(String(i)));
  assert.deepEqual((await store.list('many/')).map((o) => o.key), [0, 1, 2, 3, 4].map((i) => `many/${i}.pdf`));
  assert.ok(cos.calls.filter(([kind, p]) => kind === 'list' && p.Prefix === 'tenant-a/many/').length >= 3, 'all pages requested');
  assert.equal((await store.get('a/c.pdf'))?.contentType, 'application/pdf');
  const put = cos.calls.find(([kind]) => kind === 'put')[1];
  assert.equal(put.Bucket, 'legalio-1250000000');
  assert.equal(put.Region, 'ap-jakarta');
});

test('parseCosConfig rejects values that could redirect the SDK or escape the prefix', () => {
  assert.equal(parseCosConfig({ ...config, prefix: '' }).prefix, '');
  assert.equal(parseCosConfig({ ...config, prefix: ' a/b ' }).prefix, 'a/b/');
  assert.equal(parseCosConfig({ ...config, prefix: 'a/' }).prefix, 'a/');
  for (const bad of [
    { bucket: 'evil.com/x-1250000000' }, { bucket: 'legalio' }, { bucket: 'Legalio-1250000000' },
    { region: 'ap-jakarta.evil.com' }, { region: 'jakarta' }, { region: 'ap-jakarta/x' },
    { prefix: '/abs' }, { prefix: 'a/../b' }, { prefix: '..' }, { secretId: '' }, { secretKey: ' ' },
  ]) assert.throws(() => parseCosConfig({ ...config, ...bad }), Error, JSON.stringify(bad));
});

test('keyFromLink decodes upload links and refuses traversal, hidden segments and NUL', () => {
  assert.equal(keyFromLink('/uploads/Org%20A/Vendor/Folder%20Contract/file.pdf'), 'Org A/Vendor/Folder Contract/file.pdf');
  for (const bad of ['/uploads/../x', '/uploads/a/%2e%2e/x', '/uploads/a/./x', '/uploads/.env', '/uploads/a/.hidden', '/uploads/a%00b', '/uploads/a%5C..%5Cb', '/uploads/%E0%A4%A', '/uploads/', '/other/x', 'uploads/x']) {
    assert.equal(keyFromLink(bad), null, bad);
  }
});
