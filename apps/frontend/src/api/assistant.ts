import { api, apiBlob } from './client';

export const assistantApi = {
  chat: (input: { query: string; history: unknown[] }) => api.post<{ reply?: string; error?: string }>('/chat', input),
  newsTicker: () => api.get<{ items?: string[] }>('/dashboard/news-ticker'),
};

/** An uploaded file (`/uploads/...`) or an attachment endpoint, as a Blob. */
export const downloadFile = (path: string) => apiBlob(path);
