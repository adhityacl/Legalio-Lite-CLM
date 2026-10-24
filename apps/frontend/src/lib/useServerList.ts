/**
 * Server-side list state for the record tables: page, search, sort and filters live in the URL (`?tab=contracts&l.page=2&l.q=acme`),
 * the data comes from `GET <collection>?limit&offset&q&sort&dir&<filters>` (X-Total-Count) through the central API client and
 * TanStack Query. The previous page stays on screen while the next one loads, and typing in the search box is debounced.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useIdentity } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { applyListState, DEFAULT_LIST_STATE, parseListState, SEARCH_DEBOUNCE_MS, type ListState } from './listState';
import { fetchPage, type Page } from '../api/records';

export interface ServerListOptions {
  /** Cache scope and the key rows-per-page is remembered under, e.g. `contracts`. */
  entity: string;
  /** API collection, e.g. `/contracts`. */
  path: string;
  pageSize: number;
  /** Filter names (the API's query parameters). Only these are read from and written to the URL. */
  filterKeys?: readonly string[];
  /** Query parameters sent in every request (e.g. a fixed `final_only`). */
  fixed?: Record<string, string | number | boolean | undefined>;
  /** Maps a UI sort field to the API's `sort` value; return null to leave the server's default order. */
  toApiSort?: (field: string) => string | null;
  /** Turns the UI's filter values into API parameters when they differ (must be a stable function, e.g. module-level or useCallback). */
  mapFilters?: (filters: Record<string, string>) => Record<string, string | undefined>;
  enabled?: boolean;
}

const readUrl = (filterKeys: readonly string[]): ListState =>
  typeof window === 'undefined' ? DEFAULT_LIST_STATE : parseListState(window.location.search, filterKeys);

function writeUrl(state: ListState, filterKeys: readonly string[]) {
  if (typeof window === 'undefined') return;
  const next = applyListState(window.location.search, state, filterKeys);
  const url = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`;
  if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, '', url);
}

export function useServerList<T>(options: ServerListOptions) {
  const { entity, path, pageSize, fixed, toApiSort, mapFilters, enabled = true } = options;
  const filterKeys = useMemo(() => options.filterKeys ?? [], [options.filterKeys]);
  const { identity } = useIdentity();
  const { activeTenantId } = useTenant();
  const [state, setState] = useState<ListState>(() => readUrl(filterKeys));
  // What the search box shows right now; `state.q` follows it after the debounce.
  const [searchInput, setSearchInput] = useState(state.q);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { writeUrl(state, filterKeys); }, [state, filterKeys]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const patch = useCallback((change: Partial<ListState>, resetPage = true) => {
    setState((current) => ({ ...current, ...change, page: change.page ?? (resetPage ? 1 : current.page) }));
  }, []);

  const setSearch = useCallback((value: string) => {
    setSearchInput(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => patch({ q: value.trim() }), SEARCH_DEBOUNCE_MS);
  }, [patch]);

  const setPage = useCallback((page: number) => patch({ page: Math.max(1, Math.trunc(page) || 1) }, false), [patch]);
  const setFilter = useCallback((key: string, value: string | null) => {
    setState((current) => {
      const filters = { ...current.filters };
      if (value && value !== 'ALL') filters[key] = value; else delete filters[key];
      return { ...current, filters, page: 1 };
    });
  }, []);
  /** none -> ascending -> descending -> none, as the column headers do. */
  const toggleSort = useCallback((field: string) => {
    setState((current) => {
      if (current.sort !== field) return { ...current, sort: field, dir: 'asc', page: 1 };
      if (current.dir === 'asc') return { ...current, dir: 'desc', page: 1 };
      return { ...current, sort: null, dir: 'asc', page: 1 };
    });
  }, []);
  const reset = useCallback(() => { clearTimeout(timer.current); setSearchInput(''); setState(DEFAULT_LIST_STATE); }, []);

  const apiSort = state.sort ? (toApiSort ? toApiSort(state.sort) : state.sort) : null;
  const query = useMemo(() => ({
    ...fixed,
    limit: pageSize, offset: (state.page - 1) * pageSize,
    q: state.q || undefined, sort: apiSort ?? undefined, dir: apiSort ? state.dir : undefined,
    ...(mapFilters ? mapFilters(state.filters) : state.filters),
  }), [fixed, pageSize, state.page, state.q, apiSort, state.dir, state.filters, mapFilters]);

  const result = useQuery<Page<T>>({
    queryKey: ['lists', entity, identity?.id, activeTenantId, query],
    queryFn: ({ signal }) => fetchPage<T>(path, query as any, { signal, organizationId: activeTenantId }),
    enabled: enabled && Boolean(identity?.id && activeTenantId),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });

  const total = result.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // A page that no longer exists (rows were deleted, the filter changed elsewhere) falls back to the last one.
  useEffect(() => {
    if (result.data && !result.isPlaceholderData && state.page > pageCount) setState((current) => ({ ...current, page: pageCount }));
  }, [result.data, result.isPlaceholderData, state.page, pageCount]);

  return {
    items: result.data?.items ?? [],
    total,
    pageCount,
    state,
    searchInput,
    setSearch,
    setPage,
    setFilter,
    toggleSort,
    reset,
    isLoading: result.isLoading,
    /** True while a request is running, also when the previous page is still shown. */
    isFetching: result.isFetching,
    isPlaceholder: result.isPlaceholderData,
    error: result.error,
    refetch: result.refetch,
    query,
  };
}
