import { api } from './client';

export interface SearchResponse { results: Array<{ entity_type: string; entity_id: string; title: string }>; total: number }

/** `GET /api/search`: words that must all match, across partners, contracts, orders, invoices and evaluations the caller may see. */
export const searchApi = {
  query: (q: string, options: { limit?: number; types?: string[]; signal?: AbortSignal; organizationId?: string | null } = {}) =>
    api.get<SearchResponse>('/search', { query: { q, limit: options.limit ?? 20, type: options.types?.join(',') }, signal: options.signal, organizationId: options.organizationId }),
};
