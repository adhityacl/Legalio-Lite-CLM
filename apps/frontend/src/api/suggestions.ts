import type { Obligation } from './obligations';
import { api } from './client';
import { fetchPage, type Page } from './records';

export interface ObligationPayload { title: string; description: string; type: string; due_date: string | null; recurrence: string; recurrence_interval: number | null; party: string }
export interface KeyTermPayload { term_key: string; label: string; value: string; summary: string }

/** One AI proposal waiting for a person's decision, with where in the document it came from. */
export interface Suggestion {
  id: string;
  contract_id: string;
  contract_number: string | null;
  contract_title: string | null;
  kind: 'obligation' | 'key_term';
  status: 'pending' | 'accepted' | 'rejected';
  payload: ObligationPayload & KeyTermPayload;
  source_quote: string;
  source_page: number | null;
  confidence: number | null;
  /** The quote was found in the document text (true), was not (false), or could not be checked (null). */
  quote_verified: boolean | null;
  source_name: string | null;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  result_ref: string | null;
}

export interface KeyTerm {
  id: string; contract_id: string; term_key: string; label: string; value: string; summary: string;
  source_quote: string | null; source_page: number | null; source_confidence: number | null; confirmed_by: string | null; confirmed_at: string | null;
}

export interface ExtractionResult { success: boolean; extractionId: string; created: number; duplicates: number; dropped: number; truncated: boolean; unverifiedQuotes: number }

export const suggestionsApi = {
  page: (query: { status?: string; kind?: string; limit?: number; offset?: number }, options: { signal?: AbortSignal; organizationId?: string | null } = {}): Promise<Page<Suggestion>> =>
    fetchPage<Suggestion>('/suggestions', { status: query.status, kind: query.kind, limit: query.limit ?? 20, offset: query.offset ?? 0 }, options),
  summary: (options: { signal?: AbortSignal } = {}) => api.get<{ obligation: number; key_term: number; total: number }>('/suggestions/summary', { ...options, cache: 'no-store' }),
  accept: (id: string, edits: Record<string, unknown>) => api.post<{ success: boolean; kind: string; obligation?: Obligation; keyTerm?: KeyTerm }>(`/suggestions/${encodeURIComponent(id)}/accept`, { edits }),
  reject: (id: string) => api.post<{ success: boolean }>(`/suggestions/${encodeURIComponent(id)}/reject`, {}),
  /** Reads the contract's document (a file, pasted text, or the file stored with the contract) and queues suggestions. Can take a while. */
  extract: (contractId: string, input: { file?: File | null; text?: string }) => {
    const path = `/contracts/${encodeURIComponent(contractId)}/extract`;
    if (input.file) {
      const form = new FormData();
      form.append('file', input.file);
      return api.post<ExtractionResult>(path, form, { timeoutMs: 180_000 });
    }
    return api.post<ExtractionResult>(path, input.text?.trim() ? { text: input.text } : {}, { timeoutMs: 180_000 });
  },
  keyTerms: (contractId: string, options: { signal?: AbortSignal } = {}) => api.get<KeyTerm[]>(`/contracts/${encodeURIComponent(contractId)}/key-terms`, options),
  removeKeyTerm: (contractId: string, termKey: string) => api.delete<{ success: boolean }>(`/contracts/${encodeURIComponent(contractId)}/key-terms/${encodeURIComponent(termKey)}`),
};
