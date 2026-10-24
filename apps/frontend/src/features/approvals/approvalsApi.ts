import { apiRequest, type RequestOptions } from '../../api/client';
import type { ApprovalCandidate, ApprovalCategory, ApprovalDetail, ApprovalStats, ApprovalSummary } from '@legalio/types/approvals';

// Transport, session/organization headers and the unified error shape come from the central client (src/api/client.ts).
function request<T>(path: string, init: { method?: RequestOptions['method']; body?: unknown } = {}): Promise<T> {
  return apiRequest<T>(path, init);
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
  create: (input: NewApproval) => request<{ id: string }>('/approvals', { method: 'POST', body: input }),
  decide: (id: string, decision: 'approve' | 'reject', comment: string) =>
    request<{ ok: true }>(`/approvals/${id}/decision`, { method: 'POST', body: { decision, comment } }),
  remove: (id: string) => request<{ ok: true }>(`/approvals/${id}`, { method: 'DELETE' }),
  fileUrl: (id: string) => `/api/approvals/${id}/file`,
  notifications: (organizationId: string) =>
    request<{ notifications: Array<{ id: string; kind: string; params: Record<string, any>; isRead: boolean; createdAt: string }>; unread: number }>(`/api/organizations/${encodeURIComponent(organizationId)}/my-notifications`),
  markNotificationsRead: (organizationId: string) =>
    request<{ updated: number }>(`/api/organizations/${encodeURIComponent(organizationId)}/my-notifications/read`, { method: 'POST', body: { all: true } }),
};
