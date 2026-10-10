/**
 * Currency helpers (PRD §3.3.5).
 *
 * - Codes are ISO 4217; no currency is privileged as "the" default — callers
 *   pass the tenant's default currency.
 * - Fallback USD rates are rough reference values used ONLY when no live
 *   rate is available; results computed from them are flagged `isFallback`.
 */

export interface CurrencyInfo {
  code: string;
  label: string;
  /** Approximate USD value of one unit, used only as a last-resort fallback. */
  fallbackRateToUsd: number;
}

export const SUPPORTED_CURRENCIES: CurrencyInfo[] = [
  { code: 'USD', label: 'US Dollar', fallbackRateToUsd: 1 },
  { code: 'EUR', label: 'Euro', fallbackRateToUsd: 1.08 },
  { code: 'GBP', label: 'British Pound', fallbackRateToUsd: 1.27 },
  { code: 'AUD', label: 'Australian Dollar', fallbackRateToUsd: 0.66 },
  { code: 'SGD', label: 'Singapore Dollar', fallbackRateToUsd: 0.74 },
  { code: 'IDR', label: 'Indonesian Rupiah', fallbackRateToUsd: 0.000062 },
  { code: 'MYR', label: 'Malaysian Ringgit', fallbackRateToUsd: 0.22 },
  { code: 'THB', label: 'Thai Baht', fallbackRateToUsd: 0.028 },
  { code: 'VND', label: 'Vietnamese Dong', fallbackRateToUsd: 0.000039 },
  { code: 'PHP', label: 'Philippine Peso', fallbackRateToUsd: 0.017 },
  { code: 'INR', label: 'Indian Rupee', fallbackRateToUsd: 0.012 },
  { code: 'JPY', label: 'Japanese Yen', fallbackRateToUsd: 0.0067 },
  { code: 'KRW', label: 'South Korean Won', fallbackRateToUsd: 0.00073 },
  { code: 'CNY', label: 'Chinese Yuan', fallbackRateToUsd: 0.14 },
  { code: 'HKD', label: 'Hong Kong Dollar', fallbackRateToUsd: 0.128 },
  { code: 'TWD', label: 'New Taiwan Dollar', fallbackRateToUsd: 0.031 },
  { code: 'AED', label: 'UAE Dirham', fallbackRateToUsd: 0.272 },
  { code: 'SAR', label: 'Saudi Riyal', fallbackRateToUsd: 0.267 },
  { code: 'BDT', label: 'Bangladeshi Taka', fallbackRateToUsd: 0.0084 },
  { code: 'PKR', label: 'Pakistani Rupee', fallbackRateToUsd: 0.0036 },
  { code: 'LKR', label: 'Sri Lankan Rupee', fallbackRateToUsd: 0.0033 },
];

const DISPLAY_LOCALE: Record<string, string> = { ID: 'id', EN: 'en', ZH: 'zh-CN' };

/** Currency name in the UI language via the platform's CLDR data (e.g. "美元", "Dolar AS"). */
export function currencyLabel(code: string, language: 'ID' | 'EN' | 'ZH' = 'EN'): string {
  try {
    const name = new Intl.DisplayNames([DISPLAY_LOCALE[language] || 'en'], { type: 'currency' }).of(code);
    if (name && name !== code) return name;
  } catch {
    /* Intl.DisplayNames unavailable — use the English label */
  }
  return SUPPORTED_CURRENCIES.find((c) => c.code === code)?.label || code;
}

const FALLBACK_BY_CODE = new Map(SUPPORTED_CURRENCIES.map((c) => [c.code, c.fallbackRateToUsd]));

export function normalizeCurrencyCode(value: unknown, fallback = 'USD'): string {
  const code = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
}

/** Reference USD rate for a currency, or `null` when it is unknown. */
export function getFallbackUsdRate(currency: string): number | null {
  const code = normalizeCurrencyCode(currency);
  if (code === 'USD') return 1;
  return FALLBACK_BY_CODE.get(code) ?? null;
}

/** Back-compat helper: reference rate, `1` when unknown (flag the result as fallback). */
export function getDefaultUsdRate(currency: string): number {
  return getFallbackUsdRate(currency) ?? 1;
}

/** Convert an amount to USD with a reference rate, rounded to cents. */
export function convertToUsdWithFallback(amount: number, currency: string): number {
  const rate = getDefaultUsdRate(currency);
  return Math.round((Number(amount) || 0) * rate * 100) / 100;
}

/** ISO 4217 minor units, taken from the runtime's Intl data. */
export function currencyMinorUnits(currency: string): number {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: normalizeCurrencyCode(currency) })
      .resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

let activeFormattingLocale = 'en-US';

/** Called once the UI knows the user's language and the tenant's country. */
export function setActiveFormattingLocale(locale: string): void {
  try {
    new Intl.NumberFormat(locale);
    activeFormattingLocale = locale;
  } catch {
    activeFormattingLocale = 'en-US';
  }
}

export function getActiveFormattingLocale(): string {
  return activeFormattingLocale;
}

export function formatMoney(amount: number, currency = 'USD', locale: string = activeFormattingLocale): string {
  const code = normalizeCurrencyCode(currency);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code, currencyDisplay: 'code' }).format(Number(amount) || 0);
  } catch {
    return `${code} ${(Number(amount) || 0).toLocaleString(locale)}`;
  }
}

export async function fetchHistoricalRate(
  currency: string,
  dateStr?: string,
): Promise<{ rate: number; isFallback?: boolean }> {
  const code = normalizeCurrencyCode(currency);
  if (code === 'USD') return { rate: 1, isFallback: false };
  try {
    const params = new URLSearchParams({ currency: code });
    if (dateStr) params.append('date', dateStr);
    const res = await fetch(`/api/exchange-rate-historical?${params.toString()}`);
    if (res.ok) {
      const data = await res.json() as { rate?: unknown; isFallback?: unknown };
      if (typeof data.rate === 'number' && !isNaN(data.rate) && data.rate > 0) {
        return { rate: data.rate, isFallback: Boolean(data.isFallback) };
      }
    }
  } catch (e) {
    console.warn('Failed to fetch historical exchange rate:', e);
  }
  return { rate: getDefaultUsdRate(code), isFallback: true };
}

export const getHistoricalUsdRate = fetchHistoricalRate;
