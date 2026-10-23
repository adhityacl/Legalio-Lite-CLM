/**
 * Optional server-side paging, filtering, search and sorting for list endpoints that already hold their (tenant- and
 * department-scoped) rows: `?limit&offset&q&sort&dir` plus per-endpoint exact filters. Without any of those parameters the endpoint
 * keeps answering the complete array, so existing clients are unaffected. The total before paging is returned in `X-Total-Count`.
 */
import type express from 'express';

export interface ListSpec<T> {
  /** Fields searched by `q` (every word must occur in at least one of them, case-insensitive). */
  search: Array<keyof T & string>;
  /** `sort` values -> sort key. The first entry is the default order when only paging is requested. */
  sorts: Record<string, (row: T) => string | number>;
  /** Query parameters that must equal the row's field exactly (comma-separated alternatives allowed). */
  filters: Array<keyof T & string>;
}

const text = (value: unknown, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const fold = (value: unknown) => String(value ?? '').toLowerCase();

export function wantsPage(query: express.Request['query'], spec: ListSpec<any>): boolean {
  return ['limit', 'offset', 'q', 'sort'].some((key) => query[key] !== undefined) || spec.filters.some((key) => query[key] !== undefined);
}

/** Applies the request's list parameters to `rows`; null when the request asks for the classic full list. */
export function pageRows<T extends Record<string, any>>(req: express.Request, res: express.Response, rows: T[], spec: ListSpec<T>): T[] | null {
  if (!wantsPage(req.query, spec)) return null;
  let result = rows;
  for (const key of spec.filters) {
    const wanted = text(req.query[key], 500).split(',').map((v) => v.trim()).filter(Boolean);
    if (wanted.length) result = result.filter((row) => wanted.includes(String(row[key] ?? '')));
  }
  const words = text(req.query.q).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 16);
  if (words.length) {
    result = result.filter((row) => {
      const haystack = spec.search.map((key) => fold(row[key])).join('\n');
      return words.every((word) => haystack.includes(word));
    });
  }
  const names = Object.keys(spec.sorts);
  const requested = text(req.query.sort, 40);
  const sortName = names.includes(requested) ? requested : (req.query.limit !== undefined || req.query.offset !== undefined || requested ? names[0] : undefined);
  if (sortName) {
    const key = spec.sorts[sortName];
    const direction = text(req.query.dir, 4).toLowerCase() === 'desc' ? -1 : 1;
    result = [...result].sort((a, b) => {
      const left = key(a), right = key(b);
      return (typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right))) * direction;
    });
  }
  const total = result.length;
  const offset = Math.max(0, Math.trunc(Number(req.query.offset)) || 0);
  if (req.query.limit !== undefined || req.query.offset !== undefined) {
    const limit = Math.min(500, Math.max(1, Math.trunc(Number(req.query.limit)) || 50));
    result = result.slice(offset, offset + limit);
  }
  res.setHeader('X-Total-Count', String(total));
  res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count');
  return result;
}
