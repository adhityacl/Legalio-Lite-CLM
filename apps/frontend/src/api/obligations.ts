import type { ObligationRecurrence, ObligationSource, ObligationStatus, ObligationStoredStatus, ObligationType } from '@legalio/shared/obligations';
import { api } from './client';
import { fetchPage, type Page, type PageQuery } from './records';

/** An obligation as the API presents it (status is derived: open work past its date is `overdue`). */
export interface Obligation {
  id: string;
  organizationId: string;
  contract_id: string | null;
  io_id: string | null;
  partner_id: string | null;
  title: string;
  description: string;
  type: ObligationType;
  due_date: string | null;
  recurrence: ObligationRecurrence;
  recurrence_interval: number | null;
  recurrence_until: string | null;
  responsible_user_id: string | null;
  responsible_department: string;
  status: ObligationStatus;
  stored_status: ObligationStoredStatus;
  days_until: number | null;
  lead_days: number | null;
  source: ObligationSource;
  source_quote: string | null;
  source_page: number | null;
  source_confidence: number | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  completions: number;
  version: number;
  created_at: string;
  updated_at: string;
  contract_number?: string | null;
  contract_title?: string | null;
  io_number?: string | null;
  io_title?: string | null;
  partner_name?: string | null;
  responsible_name?: string | null;
  responsible_email?: string | null;
}

/** The fields a form writes. */
export type ObligationInput = Partial<Pick<Obligation, 'title' | 'description' | 'type' | 'due_date' | 'recurrence' | 'recurrence_interval' | 'recurrence_until' | 'contract_id' | 'io_id'
  | 'partner_id' | 'responsible_user_id' | 'responsible_department' | 'lead_days'>> & { status?: ObligationStoredStatus; version?: number };

export interface ObligationPageQuery extends PageQuery {
  status?: string[];
  type?: string[];
  contractId?: string;
  ioId?: string;
  partnerId?: string;
  responsible?: string;
  dueFrom?: string;
  dueTo?: string;
  source?: string;
  sort?: 'due_date' | 'title' | 'type' | 'status' | 'created_at' | 'updated_at';
}

export interface ObligationSummary { today: string; weekEnd: string; overdue: number; dueToday: number; dueThisWeek: number; open: number; withoutDate: number }
export interface Assignee { id: string; name: string; email: string }

export const obligationsApi = {
  page: (query: ObligationPageQuery, options: { signal?: AbortSignal; organizationId?: string | null } = {}): Promise<Page<Obligation>> =>
    fetchPage<Obligation>('/obligations', {
      limit: query.limit ?? 50, offset: query.offset ?? 0, q: query.q, sort: query.sort, dir: query.dir, status: query.status?.join(','), type: query.type?.join(','),
      contract_id: query.contractId, io_id: query.ioId, partner_id: query.partnerId, responsible: query.responsible, due_from: query.dueFrom, due_to: query.dueTo, source: query.source,
    }, options),
  get: (id: string) => api.get<Obligation>(`/obligations/${encodeURIComponent(id)}`),
  create: (body: ObligationInput) => api.post<{ success: boolean; obligation: Obligation }>('/obligations', body),
  update: (id: string, body: ObligationInput) => api.put<{ success: boolean; obligation: Obligation }>(`/obligations/${encodeURIComponent(id)}`, body),
  complete: (id: string, version?: number) => api.post<{ success: boolean; obligation: Obligation }>(`/obligations/${encodeURIComponent(id)}/complete`, version ? { version } : {}),
  remove: (id: string) => api.delete<{ success: boolean }>(`/obligations/${encodeURIComponent(id)}`),
  summary: (options: { signal?: AbortSignal } = {}) => api.get<ObligationSummary>('/obligations/summary', { ...options, cache: 'no-store' }),
  settings: () => api.get<{ leadDays: number; configured: boolean }>('/obligations/settings', { cache: 'no-store' }),
  saveSettings: (leadDays: number) => api.put<{ leadDays: number; configured: boolean }>('/obligations/settings', { leadDays }),
  assignees: () => api.get<Assignee[]>('/obligations/assignees'),
};
