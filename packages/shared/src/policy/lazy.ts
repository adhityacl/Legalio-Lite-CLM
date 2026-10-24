/**
 * Browser build of the policy module (selected by the `browser` condition of `@legalio/shared/policy`). The country packs and the
 * neutral "general" industry load with the entry; the other industry packs (about 110 KB) and the Chinese/Indonesian pack texts
 * (about 100 KB) arrive in separate chunks, started by `loadPolicyPacks()`. Until then lookups fall back to the "general" industry
 * and to English, and `subscribePolicyPacks` tells the UI when to re-read them.
 */
import { registerIndustryPacks, registerPackTranslations } from './core';

export * from './core';

let loading: Promise<void> | undefined;
let loaded = false;

export const policyPacksLoaded = (): boolean => loaded;

/** Loads the industry packs and the pack translations once; resolves when both are registered. */
export function loadPolicyPacks(): Promise<void> {
  loading ??= Promise.all([import('./industryPacks'), import('./zh')]).then(([industry, zh]) => {
    registerIndustryPacks(industry.INDUSTRY_PACKS);
    registerPackTranslations(zh.PACK_ZH, zh.PACK_NAMES);
    loaded = true;
  }).catch((error) => {
    loading = undefined; // allow a retry after a failed chunk load
    throw error;
  });
  return loading;
}
