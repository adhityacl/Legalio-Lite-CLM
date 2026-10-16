import type { ApprovalCandidate, ApprovalCategory, ApprovalDetail, ApprovalStats, ApprovalSummary } from '@legalio/types/approvals';

// Session and organization headers are added by the global fetch interceptor (src/lib/apiFetch.ts).
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
  return body as T;
}

export interface NewApproval {
  title: string;
  category: ApprovalCategory;
  note: string;
  approverIds: string[];
  documentId?: string;
  file?: { name: string; base64: string };
}

export const approvalsApi = {
  list: (params: Record<string, string>) =>
    request<{ items: ApprovalSummary[]; stats: ApprovalStats }>(`/approvals?${new URLSearchParams(params)}`),
  approvers: () => request<{ approvers: ApprovalCandidate[] }>('/approvals/approvers'),
  get: (id: string) => request<ApprovalDetail>(`/approvals/${id}`),
  create: (input: NewApproval) => request<{ id: string }>('/approvals', { method: 'POST', body: JSON.stringify(input) }),
  decide: (id: string, decision: 'approve' | 'reject', comment: string) =>
    request<{ ok: true }>(`/approvals/${id}/decision`, { method: 'POST', body: JSON.stringify({ decision, comment }) }),
  remove: (id: string) => request<{ ok: true }>(`/approvals/${id}`, { method: 'DELETE' }),
  fileUrl: (id: string) => `/api/approvals/${id}/file`,
};
