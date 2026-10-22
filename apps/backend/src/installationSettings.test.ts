import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { getPublicBaseUrl, loadInstallationSettings, normalizePublicUrl, saveInstallationPublicUrl } from './installationSettings';
import { sql as db } from './db';
import { ensureSchema } from './schema';
import { createTestDatabase } from './testDatabase';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(() => database?.drop());

test('setup URL validation, transactional persistence, reload, and environment override', async () => {
  const override = process.env.BETTER_AUTH_URL;
  delete process.env.BETTER_AUTH_URL;
  try {
    assert.equal(normalizePublicUrl(' HTTPS://Example.COM:8443/ '), 'https://example.com:8443');
    for (const invalid of ['', 'example.com', 'https:example.com', 'javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?x=1', 'https://example.com/#hash']) {
      assert.throws(() => normalizePublicUrl(invalid));
    }
    await loadInstallationSettings(db);
    assert.equal(getPublicBaseUrl(), '');
    await assert.rejects(db.tx(async () => {
      await saveInstallationPublicUrl(db, 'http://example.com:8080');
      throw new Error('Account creation failed');
    }));
    await loadInstallationSettings(db);
    assert.equal(getPublicBaseUrl(), '');
    await db.tx(() => saveInstallationPublicUrl(db, 'http://example.com:8080/'));
    await loadInstallationSettings(db);
    assert.equal(getPublicBaseUrl(), 'http://example.com:8080');
    await db.tx(async () => {
      await db.run('DELETE FROM installation_settings');
      await loadInstallationSettings(db);
      assert.equal(getPublicBaseUrl(), '');
      throw new Error('rollback');
    }).catch(() => undefined);
    await loadInstallationSettings(db);
    assert.equal(getPublicBaseUrl(), 'http://example.com:8080');
    process.env.BETTER_AUTH_URL = 'https://override.example/';
    assert.equal(getPublicBaseUrl(), 'https://override.example');
  } finally {
    if (override === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = override;
  }
});
