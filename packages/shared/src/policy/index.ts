/**
 * The policy module with every pack loaded up front (server, tests, tools). Browsers resolve `@legalio/shared/policy` to `lazy.ts`
 * (package.json `exports`), which has the same API but loads the industry packs and pack translations on demand.
 */
import { INDUSTRY_PACKS } from './industryPacks';
import { PACK_NAMES, PACK_ZH } from './zh';
import { registerIndustryPacks, registerPackTranslations } from './core';

registerIndustryPacks(INDUSTRY_PACKS);
registerPackTranslations(PACK_ZH, PACK_NAMES);

export * from './core';

/** Same signature as the browser build: everything is already loaded. */
export const loadPolicyPacks = (): Promise<void> => Promise.resolve();
export const policyPacksLoaded = (): boolean => true;
