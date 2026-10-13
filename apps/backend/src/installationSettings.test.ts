import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { getPublicBaseUrl, loadInstallationSettings, normalizePublicUrl, saveInstallationPublicUrl } from './installationSettings';

test('setup URL validation, transactional persistence, reload, and environment override', () => {
  const override = process.env.BETTER_AUTH_URL;
  delete process.env.BETTER_AUTH_URL;
  const db = new Database(':memory:');
  try {
    assert.equal(normalizePublicUrl(' HTTPS://Example.COM:8443/ '), 'https://example.com:8443');
    for (const invalid of ['', 'example.com', 'https:example.com', 'javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?x=1', 'https://example.com/#hash']) {
      assert.throws(() => normalizePublicUrl(invalid));
    }
    loadInstallationSettings(db);
    assert.equal(getPublicBaseUrl(), '');
    assert.throws(db.transaction(() => {
      saveInstallationPublicUrl(db, 'http://example.com:8080');
      throw new Error('Account creation failed');
    }));
    loadInstallationSettings(db);
    assert.equal(getPublicBaseUrl(), '');
    db.transaction(() => saveInstallationPublicUrl(db, 'http://example.com:8080/'))();
    loadInstallationSettings(db);
    assert.equal(getPublicBaseUrl(), 'http://example.com:8080');
    const empty = new Database(':memory:');
    loadInstallationSettings(empty);
    assert.equal(getPublicBaseUrl(), '');
    empty.close();
    loadInstallationSettings(db);
    assert.equal(getPublicBaseUrl(), 'http://example.com:8080');
    process.env.BETTER_AUTH_URL = 'https://override.example/';
    assert.equal(getPublicBaseUrl(), 'https://override.example');
  } finally {
    db.close();
    if (override === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = override;
  }
});
