import { api, apiBlob } from './client';

/** A record the answer was based on: `?tab=<tab>&<param>=<id>` opens it. `cited` is true when the answer names it. */
export interface ChatSource {
  ref: string;
  type: 'contract' | 'partner' | 'order' | 'spending' | 'evaluation' | 'obligation' | 'clause' | 'key_term' | 'document';
  id: string;
  title: string;
  subtitle: string;
  tab: string;
  param: 'id' | 'document';
  origin: 'match' | 'upcoming';
  score: number;
  cited: boolean;
}

export const assistantApi = {
  chat: (input: { query: string; history: unknown[] }) => api.post<{ reply?: string; error?: string; sources?: ChatSource[] }>('/chat', input),
  newsTicker: () => api.get<{ items?: string[] }>('/dashboard/news-ticker'),
};

/** An uploaded file (`/uploads/...`) or an attachment endpoint, as a Blob. */
export const downloadFile = (path: string) => apiBlob(path);
