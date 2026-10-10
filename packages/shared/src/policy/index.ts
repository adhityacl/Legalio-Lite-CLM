import { CORE_DUE_DILIGENCE, COUNTRY_PACKS } from './countryPacks';
import { INDUSTRY_PACKS, LEGACY_INDUSTRY_KEYS } from './industryPacks';
import { PACK_NAMES, PACK_ZH } from './zh';
import type {
  CountryPack,
  DueDiligenceRequirement,
  IndustryKey,
  IndustryPack,
  LocalizedText,
  TenantModules,
  TenantSettings,
  UiLanguage,
} from '@legalio/types/policy';

export * from '@legalio/types/policy';
export { CORE_DUE_DILIGENCE } from './countryPacks';
export { LEGACY_INDUSTRY_KEYS } from './industryPacks';

/* ------------------------------------------------------------------ */
/* Registry — packs are data, and plugins may register more at boot.   */
/* ------------------------------------------------------------------ */

const countryRegistry = new Map<string, CountryPack>(COUNTRY_PACKS.map((p) => [p.code, p]));
const industryRegistry = new Map<string, IndustryPack>(INDUSTRY_PACKS.map((p) => [p.key, p]));

export const NEUTRAL_COUNTRY_CODE = 'INTL';
export const NEUTRAL_INDUSTRY: IndustryKey = 'general';

/** Register or replace a country pack (PRD §4.2 — plugins, not core edits). */
export function registerCountryPack(pack: CountryPack): void {
  countryRegistry.set(pack.code.toUpperCase(), pack);
}

export function registerIndustryPack(pack: IndustryPack): void {
  industryRegistry.set(pack.key, pack);
}

export function listCountryPacks(): CountryPack[] {
  return Array.from(countryRegistry.values());
}

export function listIndustryPacks(): IndustryPack[] {
  return Array.from(industryRegistry.values());
}

export function getCountryPack(code?: string | null): CountryPack {
  const key = String(code || '').toUpperCase();
  return countryRegistry.get(key) || countryRegistry.get(NEUTRAL_COUNTRY_CODE)!;
}

/** Unknown keys fall back to General; keys from the earlier, broader pack list map to their successor. */
export function getIndustryPack(key?: string | null): IndustryPack {
  const raw = String(key || '');
  return industryRegistry.get(raw) || industryRegistry.get(LEGACY_INDUSTRY_KEYS[raw]) || industryRegistry.get(NEUTRAL_INDUSTRY)!;
}

export function localize(text: LocalizedText | string | undefined, language: UiLanguage = 'EN'): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  if (language === 'ID') return text.id || text.en;
  if (language === 'ZH') return text.zh || PACK_ZH[text.en] || text.en;
  return text.en;
}

/** Display text for a plain-string pack field (country name, identifier label, partner type, standard). */
export function localizeName(text: string, language: UiLanguage = 'EN'): string {
  if (language === 'EN') return text;
  const entry = PACK_NAMES[text];
  return (entry && (language === 'ID' ? entry.id : entry.zh)) || text;
}

/* ------------------------------------------------------------------ */
/* Tenant settings                                                     */
/* ------------------------------------------------------------------ */

export const DEFAULT_MODULES: TenantModules = {
  commercialDocuments: true,
  spending: true,
  evaluation: true,
  aiAssistant: true,
  newsTicker: false,
};

export const DEFAULT_EXPIRY_WARNING_DAYS = 90;
export const DEFAULT_REMINDER_OFFSETS = [90, 60, 30, 14];

/** Defaults derived purely from the chosen country and industry packs. */
export function defaultTenantSettings(countryCode?: string, industry?: string): TenantSettings {
  const country = getCountryPack(countryCode);
  const ind = getIndustryPack(industry);
  return {
    countryCode: country.code,
    industry: ind.key,
    language: country.code === 'ID' ? 'ID' : 'EN',
    timezone: country.timezone,
    defaultCurrency: ind.contractCurrency || country.defaultCurrency,
    reportingCurrency: 'USD',
    expiryWarningDays: DEFAULT_EXPIRY_WARNING_DAYS,
    reminderOffsetsDays: [...DEFAULT_REMINDER_OFFSETS],
    modules: { ...DEFAULT_MODULES },
    ddOverrides: {},
    customDueDiligence: [],
  };
}

const CURRENCY_CODE = /^[A-Z]{3}$/;

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Merge stored (possibly partial or legacy) tenant settings over pack
 * defaults and sanitise every field. Safe to call with untrusted input.
 */
export function resolveTenantSettings(tenant?: {
  settings?: Partial<TenantSettings> | null;
  currency?: string;
  countryCode?: string;
  industry?: string;
} | null): TenantSettings {
  const stored: Partial<TenantSettings> = (tenant?.settings && typeof tenant.settings === 'object') ? tenant.settings : {};
  const countryCode = getCountryPack(stored.countryCode || tenant?.countryCode).code;
  const industry = getIndustryPack(stored.industry || tenant?.industry).key;
  const base = defaultTenantSettings(countryCode, industry);

  const defaultCurrency = String(stored.defaultCurrency || tenant?.currency || base.defaultCurrency).toUpperCase();
  const reportingCurrency = String(stored.reportingCurrency || base.reportingCurrency).toUpperCase();
  const offsets = Array.isArray(stored.reminderOffsetsDays)
    ? Array.from(new Set(stored.reminderOffsetsDays.map((d) => clampInt(d, 1, 730, 0)).filter((d) => d > 0))).sort((a, b) => b - a)
    : base.reminderOffsetsDays;

  const customDueDiligence = Array.isArray(stored.customDueDiligence)
    ? stored.customDueDiligence
        .filter((d) => d && typeof d.key === 'string' && d.key.trim() && d.label)
        .map((d) => ({
          key: String(d.key).trim().slice(0, 64),
          label: typeof d.label === 'string' ? { en: d.label } : { en: String(d.label.en || d.key), id: d.label.id, zh: d.label.zh },
          required: Boolean(d.required),
          expires: Boolean(d.expires),
          source: 'tenant' as const,
        }))
    : [];

  const ddOverrides: TenantSettings['ddOverrides'] = {};
  if (stored.ddOverrides && typeof stored.ddOverrides === 'object') {
    for (const [key, value] of Object.entries(stored.ddOverrides)) {
      if (!value || typeof value !== 'object') continue;
      ddOverrides[key] = {
        ...(typeof value.required === 'boolean' ? { required: value.required } : {}),
        ...(typeof value.disabled === 'boolean' ? { disabled: value.disabled } : {}),
      };
    }
  }

  return {
    countryCode,
    industry,
    language: stored.language === 'ID' || stored.language === 'EN' || stored.language === 'ZH' ? stored.language : base.language,
    timezone: stored.timezone && isValidTimezone(stored.timezone) ? stored.timezone : base.timezone,
    defaultCurrency: CURRENCY_CODE.test(defaultCurrency) ? defaultCurrency : base.defaultCurrency,
    reportingCurrency: CURRENCY_CODE.test(reportingCurrency) ? reportingCurrency : base.reportingCurrency,
    expiryWarningDays: clampInt(stored.expiryWarningDays, 1, 730, base.expiryWarningDays),
    reminderOffsetsDays: offsets.length > 0 ? offsets : base.reminderOffsetsDays,
    modules: { ...DEFAULT_MODULES, ...(stored.modules || {}) },
    governingLaw: typeof stored.governingLaw === 'string' && stored.governingLaw.trim() ? stored.governingLaw.trim() : undefined,
    disputeVenue: typeof stored.disputeVenue === 'string' && stored.disputeVenue.trim() ? stored.disputeVenue.trim() : undefined,
    ddOverrides,
    customDueDiligence,
  };
}

/* ------------------------------------------------------------------ */
/* Due diligence                                                       */
/* ------------------------------------------------------------------ */

export interface ChecklistOptions {
  /** ISO code of the counterparty's country of incorporation, if known. */
  counterpartyCountry?: string | null;
  /** Include items disabled by the tenant (admin screens only). */
  includeDisabled?: boolean;
}

/**
 * Compose the due-diligence checklist for a tenant:
 * core items + country pack + industry pack + tenant custom items, then
 * apply the tenant's required/disabled overrides.
 */
export function buildDueDiligenceChecklist(
  settings: TenantSettings,
  options: ChecklistOptions = {},
): Array<DueDiligenceRequirement & { disabled?: boolean }> {
  const country = getCountryPack(settings.countryCode);
  const industry = getIndustryPack(settings.industry);
  const counterparty = options.counterpartyCountry ? String(options.counterpartyCountry).toUpperCase() : '';
  const isForeign = Boolean(counterparty) && counterparty !== country.code;

  const seen = new Set<string>();
  const merged: Array<DueDiligenceRequirement & { disabled?: boolean }> = [];
  for (const item of [...CORE_DUE_DILIGENCE, ...country.dueDiligence, ...industry.dueDiligence, ...settings.customDueDiligence]) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    // Foreign-only evidence (e.g. treaty residence certificates) is skipped
    // for domestic counterparties; kept when the country is unknown.
    if (item.foreignCounterpartyOnly && counterparty && !isForeign) continue;
    const override = settings.ddOverrides[item.key] || {};
    const disabled = Boolean(override.disabled);
    if (disabled && !options.includeDisabled) continue;
    merged.push({
      ...item,
      required: typeof override.required === 'boolean' ? override.required : item.required,
      ...(disabled ? { disabled } : {}),
    });
  }
  return merged;
}

function normalizeName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Does a stored document (by key or legacy display name) satisfy a requirement? */
export function matchesRequirement(
  requirement: DueDiligenceRequirement,
  stored: { key?: string; nama?: string },
): boolean {
  if (stored.key && stored.key === requirement.key) return true;
  const name = normalizeName(String(stored.nama || ''));
  if (!name) return false;
  const candidates = [requirement.label.en, requirement.label.id, localize(requirement.label, 'ZH'), ...(requirement.aliases || [])]
    .filter(Boolean)
    .map((c) => normalizeName(String(c)));
  return candidates.includes(name);
}

/* ------------------------------------------------------------------ */
/* Dates in the tenant's timezone                                      */
/* ------------------------------------------------------------------ */

/** Today's calendar date (`YYYY-MM-DD`) in the given IANA timezone. */
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Whole calendar days from "today in `timezone`" until `endDate`
 * (a `YYYY-MM-DD` or ISO string). Negative when already past.
 * Returns `null` for an unparseable date.
 */
export function daysUntil(endDate: string | undefined | null, timezone: string, now: Date = new Date()): number | null {
  if (!endDate) return null;
  const datePart = String(endDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const end = Date.parse(`${datePart}T00:00:00Z`);
  const today = Date.parse(`${todayInTimezone(timezone, now)}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(today)) return null;
  return Math.round((end - today) / 86_400_000);
}

/** Formatting locale for a UI language + tenant country, e.g. `en-SG`, `id-ID`. */
export function formattingLocaleFor(language: UiLanguage, countryCode?: string): string {
  if (language === 'ID') return 'id-ID';
  if (language === 'ZH') return 'zh-CN';
  const pack = getCountryPack(countryCode);
  return pack.formattingLocale.startsWith('en') ? pack.formattingLocale : 'en-US';
}
