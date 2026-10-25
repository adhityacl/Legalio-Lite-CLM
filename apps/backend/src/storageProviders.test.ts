import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoryStore, probe, type ObjectStore } from './objectStore';
import { createRoutingStore, type StorageSettingsSource } from './objectLocations';
import { parseStorageConfig, s3Settings, s3Store, type S3Config, type S3Like, type StorageConfig, type StorageProvider } from './storageProviders';

const keys = { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret', bucket: 'legalio-files', prefix: 'tenant-a' };

test('parseStorageConfig applies each provider rule and trims the prefix', () => {
  assert.deepEqual(parseStorageConfig('aws', { ...keys, region: 'ap-southeast-1' }), { provider: 'aws', ...keys, region: 'ap-southeast-1', prefix: 'tenant-a/' });
  assert.equal((parseStorageConfig('gcs', { ...keys, region: 'ignored' }) as S3Config).region, 'auto');
  assert.equal((parseStorageConfig('cloudflare', { ...keys, accountId: 'a'.repeat(32) }) as S3Config).region, 'auto');
  const minio = parseStorageConfig('minio', { ...keys, endpoint: ' http://10.0.0.5:9000 ' }) as S3Config;
  assert.equal(minio.endpoint, 'http://10.0.0.5:9000');
  assert.equal(minio.region, 'us-east-1');
  // Tencent keeps its own shape and accepts the generic field names.
  assert.deepEqual(parseStorageConfig('tencent', { accessKeyId: 'AKID1', secretAccessKey: 's', bucket: 'legalio-1250000000', region: 'ap-jakarta', prefix: '' }),
    { secretId: 'AKID1', secretKey: 's', bucket: 'legalio-1250000000', region: 'ap-jakarta', prefix: '' });
});

test('parseStorageConfig rejects values that could redirect the SDK or escape the prefix', () => {
  const base = { ...keys, region: 'us-east-1', accountId: 'a'.repeat(32), endpoint: 'http://host:9000' };
  const cases: Array<[StorageProvider, Record<string, string>]> = [
    ['aws', { bucket: 'evil.example.com/x' }], ['aws', { bucket: 'UPPER' }], ['aws', { region: 'us-east-1.evil.example.com' }], ['aws', { prefix: '../x' }], ['aws', { prefix: '/abs' }],
    ['aws', { secretAccessKey: '' }], ['cloudflare', { accountId: 'short' }], ['minio', { endpoint: 'ftp://host' }], ['minio', { endpoint: 'http://user:pw@host:9000' }],
    ['minio', { endpoint: 'http://host:9000/path' }], ['minio', { endpoint: 'not a url' }], ['minio', { endpoint: '' }],
  ];
  for (const [provider, bad] of cases) assert.throws(() => parseStorageConfig(provider, { ...base, ...bad }), Error, `${provider} ${JSON.stringify(bad)}`);
});

test('s3Settings follows the provider matrix (path style only for MinIO)', () => {
  const s = (config: Partial<S3Config> & { provider: S3Config['provider'] }) => s3Settings({ ...keys, region: 'us-west-004', ...config } as S3Config);
  assert.deepEqual(s({ provider: 'aws', region: 'eu-west-1' }), { region: 'eu-west-1', forcePathStyle: false });
  assert.deepEqual(s({ provider: 'cloudflare', accountId: 'abc' }), { region: 'auto', endpoint: 'https://abc.r2.cloudflarestorage.com', forcePathStyle: false });
  assert.deepEqual(s({ provider: 'backblaze' }), { region: 'us-west-004', endpoint: 'https://s3.us-west-004.backblazeb2.com', forcePathStyle: false });
  assert.deepEqual(s({ provider: 'gcs' }), { region: 'auto', endpoint: 'https://storage.googleapis.com', forcePathStyle: false });
  assert.deepEqual(s({ provider: 'minio', endpoint: 'http://localhost:9000', region: 'us-east-1' }), { region: 'us-east-1', endpoint: 'http://localhost:9000', forcePathStyle: true });
});

/** Just enough of an S3 service: one bucket, at most `pageSize` keys per list call. */
function fakeS3(pageSize = 2) {
  const objects = new Map<string, { body: Buffer; type?: string }>();
  const sent: Array<[string, any]> = [];
  const client: S3Like = {
    async send(command: any) {
      const name = command.constructor.name;
      const input = command.input;
      sent.push([name, input]);
      if (name === 'PutObjectCommand') { objects.set(input.Key, { body: Buffer.from(input.Body), type: input.ContentType }); return {}; }
      if (name === 'GetObjectCommand') {
        const found = objects.get(input.Key);
        if (!found) throw Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
        return { Body: { transformToByteArray: async () => new Uint8Array(found.body) }, ContentType: found.type };
      }
      if (name === 'DeleteObjectCommand') { objects.delete(input.Key); return {}; }
      if (name === 'ListObjectsV2Command') {
        const all = [...objects.keys()].filter((k) => k.startsWith(input.Prefix) && (!input.ContinuationToken || k > input.ContinuationToken)).sort();
        const page = all.slice(0, pageSize);
        return {
          Contents: page.map((Key) => ({ Key, Size: objects.get(Key)!.body.length, ETag: `"${objects.get(Key)!.body.toString('hex')}"`, LastModified: new Date('2026-01-01') })),
          IsTruncated: all.length > pageSize, NextContinuationToken: all.length > pageSize ? page.at(-1) : undefined,
        };
      }
      throw new Error(`unexpected ${name}`);
    },
  };
  return { client, objects, sent };
}
const s3config: S3Config = { provider: 'aws', ...keys, region: 'us-east-1', prefix: 'tenant-a/' };

test('s3Store prefixes every key, strips it from list, follows pages and treats a missing key as null', async () => {
  const fake = fakeS3();
  const store = s3Store(s3config, fake.client);
  await store.put('a/1.pdf', Buffer.from('one'), 'application/pdf');
  await store.put('a/2.pdf', Buffer.from('two'));
  await store.put('a/3.pdf', Buffer.from('three'));
  assert.ok([...fake.objects.keys()].every((k) => k.startsWith('tenant-a/')));
  assert.deepEqual((await store.list('a/')).map((o) => o.key), ['a/1.pdf', 'a/2.pdf', 'a/3.pdf']);
  assert.deepEqual(await store.get('a/1.pdf'), { body: Buffer.from('one'), contentType: 'application/pdf' });
  assert.equal(await store.get('nope'), null);
  await store.delete('a/1.pdf');
  await store.delete('a/1.pdf');
  assert.equal(await store.get('a/1.pdf'), null);
  await probe(store);
  assert.equal((await store.list('')).length, 2, 'probe cleans up after itself');
  assert.ok(fake.sent.some(([name, input]) => name === 'PutObjectCommand' && input.Bucket === 'legalio-files'));
});

test('s3Store rethrows errors other than a missing key', async () => {
  const store = s3Store(s3config, { send: async () => { throw Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }); } });
  await assert.rejects(store.get('k'), /denied/);
});

/** The only statements the routing store issues, over a Map. */
function fakeDb() {
  const rows = new Map<string, string>();
  return {
    rows,
    async get(text: string, key: string) { assert.match(text, /FROM object_locations/); return rows.has(key) ? { provider: rows.get(key) } : undefined; },
    async run(text: string, ...args: any[]) {
      if (/^INSERT/.test(text.trim())) rows.set(args[0], args[1]);
      else if (/^DELETE/.test(text.trim())) rows.delete(args[0]);
      else assert.fail(text);
    },
  } as any;
}

function routing(initial: { active?: StorageProvider; configured: StorageProvider[] }) {
  const state = { active: (initial.active ?? null) as StorageProvider | null, configs: new Map<StorageProvider, StorageConfig>() };
  const stores = new Map<StorageConfig, ObjectStore>();
  for (const provider of initial.configured) {
    state.configs.set(provider, provider === 'tencent' ? { secretId: 'i', secretKey: 'k', bucket: 'b-1250000000', region: 'ap-jakarta', prefix: '' } : ({ ...s3config, provider } as S3Config));
  }
  const settings: StorageSettingsSource = { getActive: () => state.active, getConfig: (p) => state.configs.get(p) ?? null, configuredProviders: () => [...state.configs.keys()] };
  const db = fakeDb();
  const store = createRoutingStore(db, settings, (config) => { if (!stores.has(config)) stores.set(config, memoryStore()); return stores.get(config)!; });
  const backing = (provider: StorageProvider) => {
    const config = state.configs.get(provider)!;
    if (!stores.has(config)) stores.set(config, memoryStore());
    return stores.get(config)!;
  };
  return { state, db, store, backing };
}

test('routing store writes to the active provider and reads from where each file was written', async () => {
  const r = routing({ active: 'aws', configured: ['aws', 'cloudflare'] });
  await r.store.put('old.pdf', Buffer.from('old'));
  r.state.active = 'cloudflare';
  await r.store.put('new.pdf', Buffer.from('new'));
  assert.equal(r.db.rows.get('old.pdf'), 'aws');
  assert.equal(r.db.rows.get('new.pdf'), 'cloudflare');
  assert.equal((await r.store.get('old.pdf'))?.body.toString(), 'old', 'old files stay readable after the active provider changed');
  assert.equal((await r.store.get('new.pdf'))?.body.toString(), 'new');
  assert.equal(await r.backing('cloudflare').get('old.pdf'), null);
  assert.deepEqual((await r.store.list('')).map((o) => o.key).sort(), ['new.pdf', 'old.pdf']);
  await r.store.delete('old.pdf');
  assert.equal(await r.backing('aws').get('old.pdf'), null, 'a delete goes to the provider that holds the file');
  assert.equal(r.db.rows.has('old.pdf'), false);
});

test('objects without a location record are treated as Tencent COS when it is configured, else as the active provider', async () => {
  const withCos = routing({ active: 'aws', configured: ['tencent', 'aws'] });
  await withCos.backing('tencent').put('legacy.pdf', Buffer.from('legacy'));
  assert.equal((await withCos.store.get('legacy.pdf'))?.body.toString(), 'legacy');
  const noCos = routing({ active: 'aws', configured: ['aws'] });
  await noCos.backing('aws').put('x.pdf', Buffer.from('x'));
  assert.equal((await noCos.store.get('x.pdf'))?.body.toString(), 'x');
});

test('rewriting a key under another provider moves it and removes the superseded copy', async () => {
  const r = routing({ active: 'aws', configured: ['aws', 'minio'] });
  await r.store.put('same.pdf', Buffer.from('v1'));
  r.state.active = 'minio';
  await r.store.put('same.pdf', Buffer.from('v2'));
  assert.equal(r.db.rows.get('same.pdf'), 'minio');
  assert.equal(await r.backing('aws').get('same.pdf'), null);
  assert.equal((await r.store.get('same.pdf'))?.body.toString(), 'v2');
});

test('routing store refuses to write or read without configured storage', async () => {
  const r = routing({ configured: [] });
  await assert.rejects(r.store.put('k', Buffer.from('x')), /not configured/);
  await assert.rejects(r.store.get('k'), /not configured/);
});
