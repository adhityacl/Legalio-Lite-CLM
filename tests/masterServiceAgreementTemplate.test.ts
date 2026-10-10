import test from 'node:test';
import assert from 'node:assert/strict';
import { jurisdictionFromSettings, COOPERATION_AGREEMENT_FIELDS } from '@legalio/shared/data/cooperationAgreementTemplate';
import { buildMasterServiceAgreementHtml, MASTER_SERVICE_AGREEMENT_CUSTOM_FIELDS } from '@legalio/shared/data/masterServiceAgreementTemplate';

test('built-in MSA uses editor fields for every blank and the tenant jurisdiction', () => {
  const jurisdiction = jurisdictionFromSettings({ countryCode: 'ID' } as any);
  const html = buildMasterServiceAgreementHtml(jurisdiction);
  const keys = new Set([...html.matchAll(/data-slot-key="([^"]+)"/g)].map((m) => m[1]));
  const known = new Set([...COOPERATION_AGREEMENT_FIELDS.map((f) => f.key), ...MASTER_SERVICE_AGREEMENT_CUSTOM_FIELDS.map((f) => f.key)]);
  for (const key of keys) assert.ok(known.has(key), `unknown slot ${key}`);
  for (const f of MASTER_SERVICE_AGREEMENT_CUSTOM_FIELDS) assert.ok(keys.has(f.key), `unused custom field ${f.key}`);
  assert.ok(!html.includes('[fill with'));
  assert.ok(html.includes(jurisdiction.governingLaw.en));
  assert.equal((html.match(/<h2>/g) || []).length, 16);
});
