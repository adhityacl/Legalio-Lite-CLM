/**
 * Provenance of AI-extracted values: every value carries the quote it came from, the page and a confidence. A quote is only trusted
 * after it has been located in the document text (whitespace- and case-insensitive); a quote that cannot be found is kept but flagged.
 */
export interface PageText { page: number; text: string }

/** Lower-cases, folds typographic quotes/dashes and collapses whitespace so a quote survives line breaks and page layout. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[‘’‛]/g, "'").replace(/[“”„]/g, '"').replace(/[‐-―−]/g, '-')
    .replace(/[­​-‍﻿]/g, '')
    .replace(/\s+/g, ' ').replace(/(\p{L})- (?=\p{Ll})/gu, '$1').trim().toLowerCase();
}

export interface QuoteLocation { found: boolean; page: number | null }

/**
 * Finds `quote` in the pages. `hintPage` (the model's claim) is checked first so a repeated sentence keeps the page the model named;
 * otherwise the first page containing it wins. A quote spanning a page break is looked up in the concatenation of neighbouring pages.
 */
export function locateQuote(pages: PageText[], quote: string, hintPage?: number | null): QuoteLocation {
  const needle = normalizeForMatch(quote);
  if (needle.length < 4) return { found: false, page: hintPage ?? null };
  const normalized = pages.map((p) => ({ page: p.page, text: normalizeForMatch(p.text) }));
  const order = hintPage ? [...normalized.filter((p) => p.page === hintPage), ...normalized.filter((p) => p.page !== hintPage)] : normalized;
  for (const p of order) if (p.text.includes(needle)) return { found: true, page: p.page };
  // A quote may run over a page break (and a word may be hyphenated there): look at neighbouring pages joined before normalizing.
  for (let i = 0; i + 1 < pages.length; i++) {
    if (normalizeForMatch(`${pages[i].text} ${pages[i + 1].text}`).includes(needle)) return { found: true, page: pages[i].page };
  }
  return { found: false, page: hintPage ?? null };
}

/** Control characters out, length bounded. Used for every string that comes back from a model. */
export function cleanModelText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export const clampConfidence = (value: unknown): number | null => {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return null;
  return Math.round(Math.min(1, Math.max(0, n > 1 && n <= 100 ? n / 100 : n)) * 100) / 100;
};

export const pageNumber = (value: unknown): number | null => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= 5000 ? n : null;
};

export interface FieldProvenance { quote: string; page: number | null; confidence: number | null; /** Found in the document text (true), not found (false), or not checkable (null). */ verified: boolean | null }

/**
 * Turns the model's `provenance` list ({ field, source_quote, confidence }) into a map by field name, keeping only the fields in `allowed`
 * (one entry per field, the first wins). When the page texts are known the quote is located to give its page and a verified flag.
 */
export function buildFieldProvenance(raw: unknown, pages: PageText[] | null, allowed: readonly string[], options: { pagesKnown?: boolean } = {}): Record<string, FieldProvenance> {
  const result: Record<string, FieldProvenance> = {};
  if (!Array.isArray(raw)) return result;
  for (const item of raw.slice(0, 50)) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const field = cleanModelText(entry.field, 60);
    const quote = cleanModelText(entry.source_quote ?? entry.quote, 400);
    if (!field || !quote || !allowed.includes(field) || result[field]) continue;
    const located = pages ? locateQuote(pages, quote, pageNumber(entry.page)) : null;
    result[field] = {
      quote, confidence: clampConfidence(entry.confidence),
      page: located && options.pagesKnown !== false ? located.page : pageNumber(entry.page), verified: located ? located.found : null,
    };
  }
  return result;
}
