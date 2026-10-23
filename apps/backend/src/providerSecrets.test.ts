import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Needs PostgreSQL at TEST_DATABASE_URL (see testDatabase.ts).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-secrets-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false', BETTER_AUTH_SECRET: 'unit-test-secret-one-0123456789abcdef' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { ensureSchema } = await import('./schema');
const { createCoreSaver } = await import('./coreDataStore');
const { loadCoreData } = await import('./lib/auth');
const { sealProviderSecrets, openProviderSecrets, hasPlaintextSecrets } = await import('./providerSecrets');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });

const SECRETS = { smtpPassword: 'smtp-pass-123', geminiApiKey: 'AIza-secret-key', accessToken: 'ya29.access', refreshToken: '1//refresh' };
const rawPayload = async () => (await sql.get<{ payload: string }>(`SELECT payload FROM app_settings WHERE id = 'google_config'`))!.payload;
const saverFor = (googleConfig: any) => createCoreSaver(sql, () => ({ googleConfig, allowedUsers: [], partners: [], contracts: [], ios: [], spendings: [], evaluations: [], notifications: [], templates: [] }));

test('secrets are encrypted at rest and read back transparently', async () => {
  const config = { smtpHost: 'smtp.example.com', smtpEnabled: true, ...SECRETS };
  await saverFor(config).save();
  const payload = await rawPayload();
  for (const value of Object.values(SECRETS)) assert.equal(payload.includes(value), false, `plaintext ${value} found in the database`);
  const stored = JSON.parse(payload);
  assert.match(stored.smtpPassword, /^v1:/);
  assert.equal(stored.smtpHost, 'smtp.example.com', 'non-secret fields stay readable');
  assert.deepEqual({ ...(await loadCoreData()).googleConfig }, config);
  assert.equal(config.smtpPassword, SECRETS.smtpPassword, 'the in-memory configuration is not modified');
});

test('saving an unchanged configuration does not rewrite the row', async () => {
  const config = { ...SECRETS, smtpHost: 'h' };
  const saver = saverFor(openProviderSecrets(sealProviderSecrets(config)));
  await saver.save();
  const first = await rawPayload();
  const before = (await sql.get<{ updatedAt: string }>(`SELECT "updatedAt" FROM app_settings WHERE id = 'google_config'`))!.updatedAt;
  await new Promise((resolve) => setTimeout(resolve, 5));
  await saver.save();
  assert.equal(await rawPayload(), first);
  assert.equal((await sql.get<{ updatedAt: string }>(`SELECT "updatedAt" FROM app_settings WHERE id = 'google_config'`))!.updatedAt, before);
});

test('legacy plaintext rows still load and are sealed by the next save', async () => {
  const legacy = { smtpHost: 'old', ...SECRETS };
  await sql.run(`UPDATE app_settings SET payload = ? WHERE id = 'google_config'`, JSON.stringify(legacy));
  assert.equal(hasPlaintextSecrets(JSON.parse(await rawPayload())), true);
  const loaded = (await loadCoreData()).googleConfig;
  assert.deepEqual({ ...loaded }, legacy);
  await saverFor(loaded).save();
  assert.equal(hasPlaintextSecrets(JSON.parse(await rawPayload())), false);
  assert.deepEqual({ ...(await loadCoreData()).googleConfig }, legacy);
});

test('a value sealed under another BETTER_AUTH_SECRET reads as empty instead of throwing', async () => {
  const sealed = sealProviderSecrets({ geminiApiKey: 'key-under-old-secret' });
  const original = process.env.BETTER_AUTH_SECRET;
  process.env.BETTER_AUTH_SECRET = 'a-completely-different-secret-value-0000';
  try {
    assert.equal(openProviderSecrets(sealed).geminiApiKey, '');
  } finally {
    process.env.BETTER_AUTH_SECRET = original;
  }
});

test('empty and missing secrets are left alone', () => {
  assert.deepEqual(sealProviderSecrets({ smtpPassword: '', other: 1 }), { smtpPassword: '', other: 1 });
  assert.deepEqual(openProviderSecrets({ other: 1 }), { other: 1 });
});
