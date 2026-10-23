import { apiRequest, isApiError, type RequestOptions } from '../api/client';
import type { PageLayout } from '@legalio/shared/pageLayout';
import type {
  CommentAction,
  CommentType,
  DocumentComment,
  DocumentDetail,
  DocumentListResponse,
  DocumentStatus,
  DocumentType,
  DraftVersion,
  MetadataField,
  MetadataFieldType,
  MetadataValues,
} from '@legalio/types/documents';

// Transport, session/organization headers and the unified error shape come from the central client (src/api/client.ts).
function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return apiRequest<T>(path, {
    method: (init.method as RequestOptions['method']) ?? undefined,
    body: init.body ?? undefined,
    headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
    signal: init.signal ?? undefined,
    keepalive: init.keepalive,
  });
}

const json = (method: string, body?: unknown, extra: RequestInit = {}): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
  ...extra,
});

// Keep outgoing saves and query results bound to the workspace that started them.
const tenantHeaders = (tenantId?: string) => tenantId ? { 'x-organization-id': tenantId, 'x-tenant-id': tenantId } : {};

export interface SaveDraftResult {
  document: DocumentDetail;
  version: number;
  created: boolean;
}

export const documentsApi = {
  list: (params: Record<string, string>, signal?: AbortSignal, tenantId?: string) =>
    request<DocumentListResponse>(`/documents?${new URLSearchParams(params)}`, { signal, headers: tenantHeaders(tenantId) }),
  get: (id: string) => request<DocumentDetail>(`/documents/${id}`),
  create: (input: { name: string; content: string; type?: DocumentType; page_layout?: PageLayout }, keepalive = false, tenantId?: string) =>
    request<DocumentDetail>('/documents', json('POST', input, { keepalive, headers: tenantHeaders(tenantId) })),
  update: (id: string, patch: { name?: string; status?: DocumentStatus; type?: DocumentType; page_layout?: PageLayout }) =>
    request<DocumentDetail>(`/documents/${id}`, json('PATCH', patch)),
  remove: (id: string) => request<{ success: true }>(`/documents/${id}`, json('DELETE')),

  listDrafts: (id: string) => request<DraftVersion[]>(`/documents/${id}/drafts`),
  getDraft: (id: string, version: number) =>
    request<DraftVersion & { content: string }>(`/documents/${id}/drafts/${version}`),
  saveDraft: (id: string, input: { content: string; name: string; kind: 'auto' | 'manual' }, keepalive = false, tenantId?: string) =>
    request<SaveDraftResult>(`/documents/${id}/drafts`, json('POST', input, { keepalive, headers: tenantHeaders(tenantId) })),
  updateDraft: (id: string, version: number, input: { draft_name: string; labels: string[] }) =>
    request<{ success: true }>(`/documents/${id}/drafts/${version}`, json('PATCH', input)),
  restoreDraft: (id: string, version: number) =>
    request<SaveDraftResult>(`/documents/${id}/drafts/${version}/restore`, json('POST')),

  listFields: () => request<MetadataField[]>('/metadata-fields'),
  createField: (input: { name: string; field_type: MetadataFieldType; options: string[] }) =>
    request<MetadataField>('/metadata-fields', json('POST', input)),
  deleteField: (fieldId: string) => request<{ success: true }>(`/metadata-fields/${fieldId}`, json('DELETE')),
  getMetadata: (id: string) => request<MetadataValues>(`/documents/${id}/metadata`),
  saveMetadata: (id: string, values: MetadataValues) =>
    request<{ success: true }>(`/documents/${id}/metadata`, json('PUT', { values })),

  listComments: (id: string) => request<DocumentComment[]>(`/documents/${id}/comments`),
  addComment: (
    id: string,
    input: { comment_type?: CommentType; body?: string; quote?: string; new_text?: string; parent_id?: string },
  ) => request<DocumentComment>(`/documents/${id}/comments`, json('POST', input)),
  commentAction: (id: string, commentId: string, action: CommentAction) =>
    request<DocumentComment>(`/documents/${id}/comments/${commentId}/${action}`, json('POST')),
  aiRedline: (id: string, plainText: string) =>
    request<{ success: true; created: Array<{ id: string; quote: string; new_text: string }>; skipped: number }>(
      `/documents/${id}/ai-redline`,
      json('POST', { plainText }),
    ),
};

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Request failures that say nothing about the request itself: a cut-off connection, timeout or busy gateway. */
export const isTransientFailure = (err: unknown) =>
  err instanceof TypeError || (isApiError(err) && (err.code === 'NETWORK_ERROR' || [408, 429, 502, 503, 504].includes(err.status))) || /^HTTP (408|429|502|503|504)$/.test(errorMessage(err));

/** Runs `request` again after a short pause when it failed for a transient reason (e.g. the dev tunnel's HTTP 408). */
export async function withTransientRetry<T>(request: () => Promise<T>, delaysMs: number[] = [600, 1500]): Promise<T> {
  for (const delay of delaysMs) {
    try {
      return await request();
    } catch (err) {
      if (!isTransientFailure(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return request();
}
