import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { sql } from './db';
import { ensureSchema } from './schema';
import { createTestDatabase } from './testDatabase';
import { open, seal } from './secretBox';
import { createStorageCredentialStore } from './storageCredentials';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(() => database?.drop());

const withSecret = <T>(secret: string | undefined, fn: () => T): T => {
  const previous = process.env.BETTER_AUTH_SECRET;
  if (secret === undefined) delete process.env.BETTER_AUTH_SECRET; else process.env.BETTER_AUTH_SECRET = secret;
  try { return fn(); } finally { if (previous === undefined) delete process.env.BETTER_AUTH_SECRET; else process.env.BETTER_AUTH_SECRET = previous; }
};

test('seal/open round-trips and never repeats a ciphertext', () => {
  withSecret('secret-one', () => {
    const text = JSON.stringify({ secretKey: 'Ünïcode key 🔑' });
    const a = seal(text);
    assert.match(a, /^v1:/);
    assert.equal(a.includes('secretKey'), false);
    assert.notEqual(seal(text), a);
    assert.equal(open(a), text);
  });
  withSecret(undefined, () => assert.equal(open(seal('fallback')), 'fallback'));
});

test('open rejects tampering, a different secret and unknown formats', () => {
  const sealed = withSecret('secret-one', () => seal('payload'));
  const raw = Buffer.from(sealed.slice(3), 'base64');
  for (const at of [0, 12, raw.length - 1]) {
    const bad = Buffer.from(raw);
    bad[at] ^= 1;
    assert.throws(() => withSecret('secret-one', () => open('v1:' + bad.toString('base64'))), undefined, `byte ${at}`);
  }
  assert.throws(() => withSecret('secret-one', () => open('v1:' + raw.subarray(0, 20).toString('base64'))));
  assert.throws(() => withSecret('secret-two', () => open(sealed)));
  assert.throws(() => open('{"plain":true}'), /format/);
});

test('credential rows are sealed at rest, legacy plain rows still load, and storage status hides the secret', async () => {
  {
    const store = createStorageCredentialStore(sql);
    await store.init();
    const cos = { secretId: 'AKIDabcdWXYZ', secretKey: 'very-secret-key', bucket: 'legalio-1250000000', region: 'ap-jakarta', prefix: 'p/' };
    await store.saveCos(cos, 'root');
    const payload = (await sql.get("SELECT payload FROM integration_credentials WHERE id = 'tencent_cos'")).payload as string;
    assert.match(payload, /^v1:/);
    assert.equal(payload.includes('very-secret-key'), false);
    assert.deepEqual(JSON.parse(open(payload)), cos);
    const status = store.providerStatus('tencent');
    assert.equal(JSON.stringify(status).includes('very-secret-key'), false);
    assert.equal(JSON.stringify(status).includes('AKIDabcd'), false);
    assert.deepEqual({ ...status, updated_at: undefined }, { configured: true, bucket: cos.bucket, region: cos.region, prefix: cos.prefix, secretIdLast4: 'WXYZ', accessKeyLast4: 'WXYZ', updated_at: undefined });
    assert.equal(store.storageStatus().active, 'tencent', 'the first provider saved becomes the active one');

    // A row of a removed integration that cannot be read must not break startup or hide the storage row.
    await sql.run("INSERT INTO integration_credentials (id, payload, updated_at) VALUES ('legacy_unreadable', 'v1:AAAA', '2026-01-01')");
    const reloaded = createStorageCredentialStore(sql);
    await reloaded.init();
    assert.deepEqual(reloaded.getCos(), cos);
  }
});
