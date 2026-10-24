import type { ClauseRules, Finding, RiskLevel, Severity } from '@legalio/shared/playbook';
import { api } from './client';
import { fetchPage, type Page, type PageQuery } from './records';

export type { ClauseRules, Finding, RiskLevel, Severity };

/** A clause of the organization's library as the API presents it. */
export interface Clause {
  id: string;
  organizationId: string;
  title: string;
  category: string;
  risk_level: RiskLevel;
  approved_text: string;
  fallback_texts: string[];
  guidance: string;
  language: '' | 'en' | 'id' | 'zh';
  jurisdiction: string;
  tags: string[];
  rules: ClauseRules;
  status: 'active' | 'archived';
  starter_key: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}
export type ClauseInput = Partial<Pick<Clause, 'title' | 'category' | 'risk_level' | 'approved_text' | 'fallback_texts' | 'guidance' | 'language' | 'jurisdiction' | 'tags' | 'rules' | 'status'>> & { version?: number };

export interface ClausePageQuery extends PageQuery {
  category?: string;
  risk?: string;
  language?: string;
  tag?: string;
  status?: 'active' | 'archived' | 'all';
}
export interface StarterEntry { starter_key: string; title: string; category: string; risk_level: RiskLevel; source: 'baseline' | 'industry'; guidance: string; has_wording: boolean; imported: boolean }

export type PlaybookFinding = Finding & { quote_verified?: boolean | null };
export interface PlaybookResult {
  success: boolean;
  findings: PlaybookFinding[];
  summary: { total: number; clausesChecked: number; bySeverity: Record<Severity, number> };
  ai: { requested: boolean; ran: boolean; model: string | null; dropped: number; error: string | null };
  truncated: boolean;
  checked_at: string;
}

export const clausesApi = {
  page: (query: ClausePageQuery, options: { signal?: AbortSignal } = {}): Promise<Page<Clause>> =>
    fetchPage<Clause>('/clauses', { limit: query.limit ?? 50, offset: query.offset ?? 0, q: query.q, sort: query.sort, dir: query.dir, category: query.category, risk: query.risk, language: query.language, tag: query.tag, status: query.status }, options),
  get: (id: string) => api.get<Clause>(`/clauses/${encodeURIComponent(id)}`),
  create: (body: ClauseInput) => api.post<{ success: boolean; clause: Clause }>('/clauses', body),
  update: (id: string, body: ClauseInput) => api.put<{ success: boolean; clause: Clause }>(`/clauses/${encodeURIComponent(id)}`, body),
  remove: (id: string) => api.delete<{ success: boolean }>(`/clauses/${encodeURIComponent(id)}`),
  facets: () => api.get<{ categories: string[]; tags: string[]; languages: string[]; jurisdictions: string[] }>('/clauses/facets'),
  starter: () => api.get<StarterEntry[]>('/clauses/starter', { cache: 'no-store' }),
  importStarter: (keys?: string[]) => api.post<{ success: boolean; created: number; skipped: number; clauses: Clause[] }>('/clauses/starter/import', keys ? { keys } : {}),
  check: (body: { text?: string; contract_id?: string; ai?: boolean }) => api.post<PlaybookResult>('/playbook/check', body),
};
