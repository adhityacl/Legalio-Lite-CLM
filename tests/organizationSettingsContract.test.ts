import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import type { OrganizationSettingsDto } from '@legalio/types/organizationSettings';
import { defaultSettingsPayload, readOrganizationSettings } from '../apps/backend/src/organizationSettingsStore';

test('the canonical settings response survives JSON serialization with the shared API contract', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE organization (id TEXT, name TEXT, slug TEXT); CREATE TABLE organization_settings (organizationId TEXT, payload TEXT, version INTEGER);');
    db.prepare('INSERT INTO organization VALUES (?, ?, ?)').run('org-test', 'Test', 'test');
    const payload = defaultSettingsPayload({ primaryColor: '#5B5BD6' });
    db.prepare('INSERT INTO organization_settings VALUES (?, ?, ?)').run('org-test', JSON.stringify(payload), 2);
    const response: OrganizationSettingsDto = readOrganizationSettings(db, 'org-test');
    assert.deepEqual(JSON.parse(JSON.stringify(response)), JSON.parse(JSON.stringify({ organizationId: 'org-test', name: 'Test', slug: 'test', version: 2, ...payload })));
    // Checked by npm run lint: changing the shared version type must break consumers.
    // @ts-expect-error API versions are numbers, not strings.
    const invalid: OrganizationSettingsDto = { ...response, version: '2' };
    assert.notEqual(invalid.version, response.version);
  } finally {
    db.close();
  }
});
