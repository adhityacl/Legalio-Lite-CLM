/** URL representation of a server list's state (page, search, sort, filters); pure so it can be tested without React. */
/** Must equal LIST_PARAM_PREFIX of the navigation context, which drops these parameters when the user changes page. */
export const LIST_PARAM_PREFIX = 'l.';

export type SortDir = 'asc' | 'desc';
export const SEARCH_DEBOUNCE_MS = 300;

export interface ListState {
  page: number;
  q: string;
  sort: string | null;
  dir: SortDir;
  filters: Record<string, string>;
}

export const DEFAULT_LIST_STATE: ListState = { page: 1, q: '', sort: null, dir: 'asc', filters: {} };

/** Reads the list state out of a query string (pure, for tests). */
export function parseListState(search: string, filterKeys: readonly string[] = []): ListState {
  const params = new URLSearchParams(search);
  const page = Math.trunc(Number(params.get(`${LIST_PARAM_PREFIX}page`)));
  const filters: Record<string, string> = {};
  for (const key of filterKeys) {
    const value = params.get(`${LIST_PARAM_PREFIX}f.${key}`);
    if (value) filters[key] = value;
  }
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    q: (params.get(`${LIST_PARAM_PREFIX}q`) ?? '').slice(0, 200),
    sort: params.get(`${LIST_PARAM_PREFIX}sort`) || null,
    dir: params.get(`${LIST_PARAM_PREFIX}dir`) === 'desc' ? 'desc' : 'asc',
    filters,
  };
}

/** Writes the list state into a query string, leaving every other parameter (tab, id, ...) as it is. */
export function applyListState(search: string, state: ListState, filterKeys: readonly string[] = []): string {
  const params = new URLSearchParams(search);
  for (const key of [...params.keys()]) if (key.startsWith(LIST_PARAM_PREFIX)) params.delete(key);
  if (state.page > 1) params.set(`${LIST_PARAM_PREFIX}page`, String(state.page));
  if (state.q) params.set(`${LIST_PARAM_PREFIX}q`, state.q);
  if (state.sort) {
    params.set(`${LIST_PARAM_PREFIX}sort`, state.sort);
    if (state.dir === 'desc') params.set(`${LIST_PARAM_PREFIX}dir`, 'desc');
  }
  for (const key of filterKeys) if (state.filters[key]) params.set(`${LIST_PARAM_PREFIX}f.${key}`, state.filters[key]);
  return params.toString();
}

