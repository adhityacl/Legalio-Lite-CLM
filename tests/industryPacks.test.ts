/**
 * Industry pack integrity: the configured industry list, the six context areas per pack,
 * migration of the earlier industry keys, and stability of stored due-diligence keys.
 * Run: npx tsx --test tests/industryPacks.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CORE_DUE_DILIGENCE,
  LEGACY_INDUSTRY_KEYS,
  defaultTenantSettings,
  getIndustryPack,
  listCountryPacks,
  listIndustryPacks,
  resolveTenantSettings,
} from '@legalio/shared/policy';

const EXPECTED_INDUSTRIES = [
  'Peer-to-Peer Lending', 'Payment Gateway', 'Banking & Investment', 'Enterprise B2B SaaS', 'IT & Development',
  'Influencer & KOL', 'Media & Creative', 'Hospitals & Medical', 'Healthtech & Telemedicine', 'Marketplace',
  'Retail & Franchise', 'Consumer & Omnichannel', 'Legal & Consulting', 'Digital Agency', 'Headhunting & Recruitment',
  'Freight Logistics', 'Cold Chain Storage', 'Delivery & Fleet', 'Public Transportation', 'Renewable Energy',
  'Oil & Gas', 'Water & Sanitation', 'Education & Research', 'Philanthropy & Donations', 'NGO & Humanitarian',
  'Office Procurement', 'Property Rental', 'Freelance Workforce', 'General',
];

/** Keys shipped by the previous pack list; partner documents and tenant overrides reference them. */
const PREVIOUS_DD_KEYS = [
  'fs_aml_questionnaire', 'fs_outsourcing_assessment', 'fs_business_continuity', 'fs_security_certification',
  'tech_dpa', 'tech_security_questionnaire', 'tech_soc2_iso', 'tech_subprocessors',
  'hc_licence', 'hc_gxp', 'hc_health_data_agreement', 'hc_insurance',
  'mfg_quality_cert', 'mfg_supplier_code',
  'retail_brand_authorisation', 'retail_product_compliance', 'media_placement_docs', 'media_brand_safety',
  'ps_professional_indemnity', 'ps_conflict_check', 'log_operating_licence', 'log_cargo_insurance',
  'energy_hse', 'energy_permits', 'edu_child_safety', 'edu_accreditation', 'np_registration', 'np_anti_terror_financing',
];

const packs = listIndustryPacks();
const bilingual = (text: { en: string; id?: string }) => Boolean(text.en?.trim() && text.id?.trim());

test('the industry dropdown lists exactly the configured industries, in order', () => {
  assert.deepEqual(packs.map((p) => p.name.en), EXPECTED_INDUSTRIES);
  assert.equal(new Set(packs.map((p) => p.key)).size, packs.length, 'keys are unique');
  for (const p of packs) assert.ok(bilingual(p.name), `${p.key} has an Indonesian name`);
});

test('every pack fills all six context areas, bilingually', () => {
  for (const p of packs) {
    assert.ok(p.coreDocuments.length >= 3 && p.coreDocuments.every(bilingual), `${p.key}: core documents`);
    assert.ok(p.partnerCategories.length >= 3, `${p.key}: partner types`);
    assert.ok(p.complianceStandards.length >= 3, `${p.key}: compliance standards`);
    assert.ok(p.criticalClauses.length >= 4, `${p.key}: critical clauses`);
    for (const c of p.criticalClauses) {
      assert.ok(bilingual(c.clause) && bilingual(c.rule), `${p.key}: clause "${c.clause.en}" is bilingual`);
      assert.match(c.rule.en, /flag if/i, `${p.key}: "${c.clause.en}" rule is a flag condition`);
    }
    assert.ok(p.counterpartyTypes.length >= 1, `${p.key}: counterparty types`);
    assert.ok(p.taxConsiderations.length >= 1 && p.taxConsiderations.every(bilingual), `${p.key}: tax considerations`);
    if (p.contractCurrency) assert.match(p.contractCurrency, /^[A-Z]{3}$/, `${p.key}: ISO currency`);
    assert.ok(p.commercialDocument.label && p.commercialDocument.prefix && p.commercialDocument.pricingModels.length, `${p.key}: commercial document`);
    if (p.key !== 'general') assert.ok(p.dueDiligence.length >= 3, `${p.key}: due diligence`);
  }
});

test('due-diligence keys are unique per pack and never shadow core or country items', () => {
  const reserved = new Set([...CORE_DUE_DILIGENCE, ...listCountryPacks().flatMap((c) => c.dueDiligence)].map((d) => d.key));
  for (const p of packs) {
    const keys = p.dueDiligence.map((d) => d.key);
    assert.equal(new Set(keys).size, keys.length, `${p.key}: duplicate DD key`);
    for (const d of p.dueDiligence) {
      assert.ok(!reserved.has(d.key), `${p.key}: ${d.key} collides with a core/country item`);
      assert.ok(bilingual(d.label), `${p.key}: ${d.key} label is bilingual`);
    }
  }
});

test('previously shipped due-diligence keys still exist, so stored partner documents keep matching', () => {
  const current = new Set(packs.flatMap((p) => p.dueDiligence.map((d) => d.key)));
  const missing = PREVIOUS_DD_KEYS.filter((k) => !current.has(k));
  assert.deepEqual(missing, []);
});

test('earlier industry keys migrate to their successor pack', () => {
  for (const [legacy, successor] of Object.entries(LEGACY_INDUSTRY_KEYS)) {
    assert.equal(getIndustryPack(legacy).key, successor, legacy);
  }
  assert.equal(resolveTenantSettings({ settings: { industry: 'financial_services' as never, countryCode: 'ID' } }).industry, 'p2p_lending');
  assert.equal(resolveTenantSettings({ industry: 'technology' }).industry, 'b2b_saas');
  assert.equal(getIndustryPack('no-such-industry').key, 'general');
});

test('country regulators only reference existing industries; Indonesia covers the financial packs', () => {
  const keys = new Set(packs.map((p) => p.key));
  for (const country of listCountryPacks()) {
    for (const industry of Object.keys(country.regulators || {})) {
      assert.ok(keys.has(industry as never), `${country.code}: unknown industry ${industry}`);
    }
  }
  const id = listCountryPacks().find((c) => c.code === 'ID')!;
  assert.ok(id.regulators?.p2p_lending?.some((r) => r.includes('OJK')));
  assert.ok(id.regulators?.payment_gateway?.includes('Bank Indonesia'));
});

test('an industry contract currency becomes the default for new organizations', () => {
  assert.equal(defaultTenantSettings('ID', 'oil_gas').defaultCurrency, 'USD');
  assert.equal(defaultTenantSettings('ID', 'p2p_lending').defaultCurrency, 'IDR');
  assert.equal(resolveTenantSettings({ settings: { countryCode: 'ID', industry: 'oil_gas', defaultCurrency: 'IDR' } }).defaultCurrency, 'IDR', 'a saved choice wins');
});
