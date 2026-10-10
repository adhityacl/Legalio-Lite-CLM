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

// Session and organization headers are added by the global fetch interceptor (src/lib/apiFetch.ts).
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
  return body as T;
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
  create: (input: { name: string; content: string; type?: DocumentType }, keepalive = false, tenantId?: string) =>
    request<DocumentDetail>('/documents', json('POST', input, { keepalive, headers: tenantHeaders(tenantId) })),
  update: (id: string, patch: { name?: string; status?: DocumentStatus; type?: DocumentType }) =>
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
