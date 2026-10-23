import type { UITextLanguage } from '@legalio/types/uiTexts';

export type CatalogLanguage = UITextLanguage;
export type Catalog = Record<string, string>;

/*
 * Built-in UI texts are one lazily loaded chunk per language, so the entry bundle carries none of them.
 * English is the fallback for every other language and is therefore always loaded first.
 */
const LOADERS: Record<CatalogLanguage, () => Promise<{ default: Catalog }>> = {
  EN: () => import('./catalogs/en'),
  ID: () => import('./catalogs/id'),
  ZH: () => import('./catalogs/zh'),
};

const loaded: Partial<Record<CatalogLanguage, Catalog>> = {};
const pending = new Map<CatalogLanguage, Promise<Catalog>>();

/** The catalog if it has been loaded, else undefined (never triggers a load). */
export const loadedCatalog = (language: CatalogLanguage): Catalog | undefined => loaded[language];

/** Loads (once) the catalog of `language`. A failed load is not remembered, so the next call retries. */
export function loadCatalog(language: CatalogLanguage): Promise<Catalog> {
  if (loaded[language]) return Promise.resolve(loaded[language]!);
  let promise = pending.get(language);
  if (promise === undefined) {
    promise = LOADERS[language]().then((module) => (loaded[language] = module.default)).finally(() => pending.delete(language));
    pending.set(language, promise);
  }
  return promise;
}

/** English plus the requested language. */
export const loadCatalogWithFallback = async (language: CatalogLanguage) => {
  await Promise.all([loadCatalog('EN'), loadCatalog(language)]);
};

export const loadAllCatalogs = async () => {
  await Promise.all((Object.keys(LOADERS) as CatalogLanguage[]).map(loadCatalog));
};
