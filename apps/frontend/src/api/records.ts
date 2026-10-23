import { apiRequestWithMeta, api, type ApiQuery, type RequestOptions } from './client';

export interface Page<T> {
  items: T[];
  /** Matching, visible records before paging (`X-Total-Count`); the page length when the server did not send one. */
  total: number;
}

export interface PageQuery {
  q?: string;
  limit?: number;
  offset?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
}

type Opts = Pick<RequestOptions, 'signal' | 'organizationId'>;

/** `GET collection` as one page; the endpoint answers the complete array when no paging parameter is sent. */
export async function fetchPage<T>(path: string, query: ApiQuery, options: Opts = {}): Promise<Page<T>> {
  const { data, total } = await apiRequestWithMeta<T[]>(path, { query, ...options });
  const items = Array.isArray(data) ? data : [];
  return { items, total: total ?? items.length };
}

/** The write/read verbs every record collection shares. `Saved` is the record type the server wraps in `{ success, <key> }`. */
export function createRecordApi<Row, Saved extends string>(collection: string, _key?: Saved) {
  type Envelope = { success: boolean } & { [K in Saved]: Row };
  return {
    list: (options: Opts = {}) => api.get<Row[]>(collection, options),
    create: (body: Partial<Row> & Record<string, unknown>, options: Opts = {}) => api.post<Envelope>(collection, body, options),
    update: (id: string, body: Partial<Row> & Record<string, unknown>, options: Opts = {}) => api.put<Envelope>(`${collection}/${encodeURIComponent(id)}`, body, options),
    remove: (id: string, options: Opts = {}) => api.delete<{ success: boolean }>(`${collection}/${encodeURIComponent(id)}`, options),
    /** Deletes one by one (the API removes a single record per call) and returns the ids that failed. */
    async removeMany(ids: string[], options: Opts = {}): Promise<string[]> {
      const failed: string[] = [];
      for (const id of ids) {
        try { await api.delete(`${collection}/${encodeURIComponent(id)}`, options); } catch { failed.push(id); }
      }
      return failed;
    },
  };
}
