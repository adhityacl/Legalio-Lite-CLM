/**
 * Server-side exchange-rate provider (PRD §4.1 `ExchangeRateProvider`).
 *
 * The provider URL is configurable through `EXCHANGE_RATE_API_URL` and can be
 * disabled with `EXCHANGE_RATE_API_URL=off` for air-gapped deployments, in
 * which case reference fallback rates are used and flagged.
 */
import { getDefaultUsdRate, normalizeCurrencyCode } from './currencyUtils';

const DEFAULT_PROVIDER_URL = 'https://api.exchangerate-api.com/v4/latest/USD';

let globalRatesCache: Record<string, number> = {};
let lastGlobalRatesFetch = 0;

function providerUrl(): string | null {
  const configured = typeof process !== 'undefined' ? process.env?.EXCHANGE_RATE_API_URL : undefined;
  if (configured && configured.trim().toLowerCase() === 'off') return null;
  return (configured && configured.trim()) || DEFAULT_PROVIDER_URL;
}

/** Units of each currency per 1 USD, cached for an hour. */
export async function fetchRealRates(): Promise<Record<string, number>> {
  if (Date.now() - lastGlobalRatesFetch < 3_600_000 && Object.keys(globalRatesCache).length > 0) {
    return globalRatesCache;
  }
  const url = providerUrl();
  if (!url) return globalRatesCache;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json() as { rates?: Record<string, number> };
      globalRatesCache = data.rates || {};
      lastGlobalRatesFetch = Date.now();
    }
  } catch (e) {
    console.warn('Failed to fetch exchange rates, using reference fallback rates', e);
  }
  return globalRatesCache;
}

/** USD value of one unit of `currency`, with a flag when it is a fallback. */
export async function getUsdRate(currency: string): Promise<{ rate: number; isFallback: boolean }> {
  const code = normalizeCurrencyCode(currency);
  if (code === 'USD') return { rate: 1, isFallback: false };
  const rates = await fetchRealRates();
  if (rates[code]) return { rate: 1 / rates[code], isFallback: false };
  return { rate: getDefaultUsdRate(code), isFallback: true };
}

export async function getHistoricalExchangeRatesBatch(
  _spreadsheetId: string,
  _token: string,
  items: { currency: string; invoice_date?: string }[],
): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  for (const item of items) {
    const code = normalizeCurrencyCode(item.currency);
    map[`${code}_${item.invoice_date || ''}`] = (await getUsdRate(code)).rate;
  }
  return map;
}

export async function getHistoricalExchangeRate(
  spreadsheetId: string,
  token: string,
  currency: string,
  invoiceDateStr?: string,
): Promise<number> {
  const code = normalizeCurrencyCode(currency);
  const map = await getHistoricalExchangeRatesBatch(spreadsheetId, token, [{ currency: code, invoice_date: invoiceDateStr }]);
  return map[`${code}_${invoiceDateStr || ''}`] || getDefaultUsdRate(code);
}

export async function getExchangeRates(_spreadsheetId: string, _token: string, currencies: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const cur of Array.from(new Set(currencies.map((c) => normalizeCurrencyCode(c)).filter((c) => c !== 'USD')))) {
    result[cur] = (await getUsdRate(cur)).rate;
  }
  return result;
}
