/**
 * Trilingual UI (ID / EN / ZH): every catalog key exists in all three languages with the same
 * placeholders, every literal t() key used in src/ is in the catalog, pack texts have Chinese,
 * and API messages translate.
 * Run: npx tsx --test tests/i18n.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { translations } from '../apps/frontend/src/context/LanguageContext';
import { COUNTRY_PACKS, CORE_DUE_DILIGENCE } from '@legalio/shared/policy/countryPacks';
import { INDUSTRY_PACKS } from '@legalio/shared/policy/industryPacks';
import { localize, localizeName, matchesRequirement, resolveTenantSettings } from '@legalio/shared/policy';
import { localizeDueDiligenceDocument } from '@legalio/shared/dueDiligence';
import { PACK_NAMES, PACK_ZH } from '@legalio/shared/policy/zh';
import { translateServerMessage } from '../apps/backend/src/serverMessages';

const LANGS = ['ID', 'EN', 'ZH'] as const;
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('every key exists in ID, EN and ZH with the same placeholders', () => {
  const keys = new Set(LANGS.flatMap((l) => Object.keys(translations[l])));
  for (const key of keys) {
    for (const lang of LANGS) assert.ok(translations[lang][key]?.trim(), `${lang} is missing "${key}"`);
    assert.equal(vars(translations.ID[key]), vars(translations.EN[key]), `placeholders differ (ID/EN) for "${key}"`);
    assert.equal(vars(translations.ZH[key]), vars(translations.EN[key]), `placeholders differ (ZH/EN) for "${key}"`);
  }
});

test('every literal t() key used in src/ is in the catalog', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !path.includes('lib/policy')) files.push(path);
    }
  };
  walk(new URL('../apps/frontend/src', import.meta.url).pathname);
  walk(new URL('../apps/backend/console/src', import.meta.url).pathname);
  walk(new URL('../packages/platform-console/src', import.meta.url).pathname);
  walk(new URL('../packages/ui-components/src', import.meta.url).pathname);
  const missing: string[] = [];
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([\w.]+)'/g)) {
      if (!(m[1] in translations.EN)) missing.push(`${m[1]} (${file.split('/src/')[1]})`);
    }
  }
  assert.deepEqual(missing, []);
});

test('pack texts shown in the UI have Chinese and Indonesian', () => {
  const texts: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.en === 'string' && Object.keys(o).every((k) => ['en', 'id', 'zh'].includes(k))) texts.push(o.en);
      else Object.values(o).forEach(walk);
    }
  };
  walk([COUNTRY_PACKS, CORE_DUE_DILIGENCE, INDUSTRY_PACKS]);
  assert.deepEqual(texts.filter((en) => !PACK_ZH[en]), []);

  const names = [
    ...COUNTRY_PACKS.flatMap((c) => [c.name, ...c.identifierSchemes.map((s) => s.label)]),
    ...INDUSTRY_PACKS.flatMap((p) => [...p.partnerCategories, ...p.complianceStandards]),
  ];
  assert.deepEqual(names.filter((n) => !PACK_NAMES[n]), []);
  assert.equal(localize({ en: 'Singapore Law', id: 'Hukum Singapura' }, 'ZH'), '新加坡法律');
  assert.equal(localizeName('Singapore', 'ID'), 'Singapura');
});

test('API messages follow the UI language, including ones with values', () => {
  assert.equal(translateServerMessage('Kontrak tidak ditemukan.', 'EN'), 'Contract not found.');
  assert.equal(translateServerMessage('Contract not found.', 'ZH'), '未找到合同。');
  assert.equal(translateServerMessage("Nomor Kontrak '01/PKS/2026' sudah terdaftar dalam sistem.", 'ZH'), '合同编号“01/PKS/2026”已在系统中登记。');
  assert.equal(translateServerMessage('Invoice "INV-1" untuk "Acme" sudah ada (ID: 7).', 'ZH'), '“Acme”的发票“INV-1”已存在（ID：7）。');
  assert.equal(translateServerMessage('Some unlisted message', 'ZH'), 'Some unlisted message');
});

test('stored DD labels switch languages by stable key, including retained pack evidence', () => {
  const document = { key: 'nda', nama: 'Perjanjian Kerahasiaan (NDA)', fileName: 'NDA-original.pdf' };
  const original = { ...document };
  assert.equal(localizeDueDiligenceDocument(document, [], 'EN'), 'Non-Disclosure Agreement (NDA)');
  assert.equal(localizeDueDiligenceDocument(document, [], 'ID'), 'Perjanjian Kerahasiaan (NDA)');
  assert.equal(localizeDueDiligenceDocument(document, [], 'ZH'), '保密协议（NDA）');
  const requirements = [...CORE_DUE_DILIGENCE, ...COUNTRY_PACKS.flatMap(p => p.dueDiligence), ...INDUSTRY_PACKS.flatMap(p => p.dueDiligence)];
  for (const requirement of requirements) {
    for (const language of LANGS) {
      assert.equal(localizeDueDiligenceDocument({ key: requirement.key, nama: 'Old stored name' }, [requirement], language), localize(requirement.label, language));
      assert.equal(localizeDueDiligenceDocument({ key: requirement.key, nama: localize(requirement.label, 'ID') }, [], language), localize(requirement.label, language));
    }
  }
  assert.deepEqual(document, original, 'translation must not modify stored names or filenames');
});

test('legacy DD names and aliases resolve across all three languages without confusing Chinese names', () => {
  for (const nama of ['NDA', 'Perjanjian Kerahasiaan (NDA)', 'Non-Disclosure Agreement (NDA)', '保密协议（NDA）']) {
    assert.equal(localizeDueDiligenceDocument({ nama }, [], 'ZH'), '保密协议（NDA）');
    assert.equal(localizeDueDiligenceDocument({ nama }, [], 'EN'), 'Non-Disclosure Agreement (NDA)');
  }
  const bank = CORE_DUE_DILIGENCE.find(item => item.key === 'bank_account_confirmation')!;
  assert.equal(matchesRequirement(bank, { nama: '银行账户确认函' }), true);
  assert.equal(matchesRequirement(bank, { nama: '受益所有人声明' }), false);
  assert.equal(localizeDueDiligenceDocument({ nama: 'Akta' }, [], 'EN'), 'Deed of establishment & amendments (Akta Pendirian)');
});

test('custom DD translations survive settings resolution and unknown names keep their original text', () => {
  const settings = resolveTenantSettings({ settings: { customDueDiligence: [
    { key: 'custom_certificate', label: { en: 'Inspection certificate', id: 'Sertifikat inspeksi', zh: '检验证书' }, required: false },
  ] } });
  const custom = { key: 'custom_certificate', nama: 'Sertifikat inspeksi' };
  assert.equal(localizeDueDiligenceDocument(custom, settings.customDueDiligence, 'ZH'), '检验证书');
  assert.equal(localizeDueDiligenceDocument(custom, settings.customDueDiligence, 'EN'), 'Inspection certificate');
  assert.equal(localizeDueDiligenceDocument(custom, settings.customDueDiligence, 'ID'), 'Sertifikat inspeksi');
  assert.equal(localizeDueDiligenceDocument({ nama: 'My own document' }, [], 'ZH'), 'My own document');
  assert.equal(localizeDueDiligenceDocument({ key: 'custom_unknown', nama: 'NDA' }, [], 'ZH'), 'NDA');
});
