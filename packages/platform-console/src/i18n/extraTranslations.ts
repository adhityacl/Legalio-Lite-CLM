/**
 * Translation keys added for the global / multi-country release, now split per language under ./catalogs so each
 * language is its own lazily loaded chunk. This module only keeps the old combined export for compatibility;
 * the application loads ./catalogs/en, ./catalogs/id and ./catalogs/zh on demand.
 *
 * Keep keys sorted by feature. Every key must exist in BOTH languages.
 */
import { EXTRA_EN } from './catalogs/extra.en';
import { EXTRA_ID } from './catalogs/extra.id';

export const EXTRA_TRANSLATIONS: Record<'ID' | 'EN', Record<string, string>> = { EN: EXTRA_EN, ID: EXTRA_ID };
