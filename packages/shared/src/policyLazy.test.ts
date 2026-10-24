import assert from 'node:assert/strict';
import { test } from 'node:test';

// The browser build of the policy module: industry packs and pack translations arrive on demand (this file must run before anything
// imports the eager build, which fills the same registries).
const lazy = await import('./policy/lazy');

test('the browser build starts with the neutral industry and English only, and announces the packs when they load', async () => {
  let notified = 0;
  const unsubscribe = lazy.subscribePolicyPacks(() => { notified += 1; });
  const versionBefore = lazy.getPolicyPacksVersion();
  assert.equal(lazy.policyPacksLoaded(), false);
  assert.equal(lazy.getIndustryPack('p2p_lending').key, 'general', 'unknown until loaded: falls back to general');
  assert.equal(lazy.getCountryPack('ID').code, 'ID', 'country packs are part of the entry');
  assert.equal(lazy.localize({ en: 'Certificate of incorporation / registration' }, 'ZH'), 'Certificate of incorporation / registration');

  await Promise.all([lazy.loadPolicyPacks(), lazy.loadPolicyPacks()]);
  assert.equal(lazy.policyPacksLoaded(), true);
  assert.ok(notified >= 1 && lazy.getPolicyPacksVersion() > versionBefore, 'subscribers are told');
  assert.equal(lazy.getIndustryPack('p2p_lending').key, 'p2p_lending');
  assert.equal(lazy.getIndustryPack('financial_services').key, 'p2p_lending', 'legacy keys resolve after loading');
  assert.equal(lazy.localize({ en: 'Certificate of incorporation / registration' }, 'ZH'), '公司注册证书');
  assert.equal(lazy.listIndustryPacks().at(-1)?.key, 'general', 'the dropdown keeps its order, general last');
  unsubscribe();
});

test('both builds describe the same packs', async () => {
  // Importing the eager build registers every pack into the shared core, so it is loaded only after the lazy checks above.
  const eager = await import('./policy/index');
  assert.deepEqual(lazy.listIndustryPacks().map((p) => p.key), eager.listIndustryPacks().map((p) => p.key));
  assert.deepEqual(lazy.listCountryPacks().map((p) => p.code), eager.listCountryPacks().map((p) => p.code));
  assert.equal(eager.policyPacksLoaded(), true);
  assert.equal(eager.getIndustryPack('p2p_lending').key, 'p2p_lending');
  assert.equal(eager.localizeName('Indonesia', 'ID'), lazy.localizeName('Indonesia', 'ID'));
});
