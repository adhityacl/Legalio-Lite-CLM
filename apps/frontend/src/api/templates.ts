import { api } from './client';

export interface TemplateRecord { id?: string; name: string; contentId?: string; customFields?: unknown[]; version?: number; createdAt?: string; updatedAt?: string; [key: string]: unknown }

export const templatesApi = {
  list: (signal?: AbortSignal) => api.get<TemplateRecord[]>('/templates', { signal }),
  create: (input: { name: string; contentId: string; customFields: unknown[] }) => api.post<{ success: boolean }>('/templates', input),
  remove: (id: string) => api.delete<{ success: boolean }>(`/templates/${encodeURIComponent(id)}`),
  aiGenerate: (input: { docType: string; prompt: string }) =>
    api.post<{ success: boolean; title?: string; sections?: any[]; fields?: any[] }>('/templates/ai-generate', input),
};
