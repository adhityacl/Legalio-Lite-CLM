/**
 * Contract defaults (governing law & dispute forum) per jurisdiction pack, used whenever the
 * organization leaves those fields empty.
 * Run: npx tsx --test tests/contractDefaults.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listCountryPacks } from '@legalio/shared/policy';
import { jurisdictionFromSettings } from '@legalio/shared/data/cooperationAgreementTemplate';

const EXPECTED: Record<string, [string, string]> = {
  INTL: ['Singapore Law', 'SIAC Arbitration, Singapore'],
  ID: ['Indonesian Law', 'BANI Arbitration, Jakarta'],
  SG: ['Singapore Law', 'SIAC Arbitration, Singapore'],
  MY: ['Malaysian Law', 'AIAC Arbitration, Kuala Lumpur'],
  TH: ['Thai Law', 'THAC Arbitration, Bangkok'],
  VN: ['Vietnamese Law', 'VIAC Arbitration, Vietnam'],
  PH: ['Philippine Law', 'PDRCI Arbitration, Manila'],
  IN: ['Indian Law', 'MCIA Arbitration, Mumbai'],
  JP: ['Japanese Law', 'JCAA Arbitration, Tokyo'],
  KR: ['Korean Law', 'KCAB International, Seoul'],
  CN: ['PRC Law', 'CIETAC Arbitration, China'],
  HK: ['Hong Kong Law', 'HKIAC Arbitration, Hong Kong'],
  AE: ['UAE Law', 'DIAC Arbitration, Dubai'],
};

test('every jurisdiction pack has the agreed governing law and dispute forum, in both languages', () => {
  const packs = listCountryPacks();
  assert.deepEqual(packs.map((p) => p.code).sort(), Object.keys(EXPECTED).sort());
  for (const pack of packs) {
    const [law, forum] = EXPECTED[pack.code];
    assert.equal(pack.governingLaw.en, law, `${pack.code} governing law`);
    assert.equal(pack.disputeVenue.en, forum, `${pack.code} dispute forum`);
    assert.ok(pack.governingLaw.id && pack.disputeVenue.id, `${pack.code} has Indonesian wording`);
  }
});

test('empty contract-default fields fall back to the pack; filled fields win', () => {
  const fallback = jurisdictionFromSettings({ countryCode: 'ID', governingLaw: undefined, disputeVenue: undefined });
  assert.deepEqual(fallback.governingLaw, { en: 'Indonesian Law', id: 'Hukum Indonesia' });
  assert.deepEqual(fallback.disputeVenue, { en: 'BANI Arbitration, Jakarta', id: 'Arbitrase BANI, Jakarta' });

  const custom = jurisdictionFromSettings({ countryCode: 'ID', governingLaw: 'Singapore Law', disputeVenue: 'SIAC Arbitration, Singapore' });
  assert.equal(custom.governingLaw.en, 'Singapore Law');
  assert.equal(custom.disputeVenue.id, 'SIAC Arbitration, Singapore');
});
