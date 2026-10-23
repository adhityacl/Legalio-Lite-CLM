import type { Contract } from '@legalio/types';
import { api } from './client';
import { createRecordApi, fetchPage, type Page, type PageQuery } from './records';

export interface ContractPageQuery extends PageQuery {
  status?: string[];
  statusApproval?: string[];
  documentType?: string;
  partnerId?: string;
  internalPic?: string;
  endFrom?: string;
  endTo?: string;
  sort?: 'default' | 'contract_number' | 'contract_title' | 'start_date' | 'end_date' | 'status' | 'updated_at' | 'created_at';
}

const record = createRecordApi<Contract, 'contract'>('/contracts', 'contract');

export const contractsApi = {
  ...record,
  /** One server-side page: filtering, search and sorting happen in SQL, scoped to the caller's organization and departments. */
  page: (query: ContractPageQuery, options: { signal?: AbortSignal } = {}): Promise<Page<Contract>> =>
    fetchPage<Contract>('/contracts', {
      limit: query.limit ?? 50, offset: query.offset ?? 0, q: query.q, sort: query.sort, dir: query.dir,
      status: query.status?.join(','), status_approval: query.statusApproval?.join(','), document_type: query.documentType,
      partner_id: query.partnerId, internal_pic: query.internalPic, end_from: query.endFrom, end_to: query.endTo,
    }, options),
  /** Edit with the version the user saw: a stale copy is rejected with ApiError { code: 'VERSION_CONFLICT', status: 409 }. */
  save: (id: string | undefined, body: Record<string, unknown>) =>
    id ? record.update(id, body as Partial<Contract>) : record.create(body as Partial<Contract>),
  /** AI extraction from an uploaded file (FormData) or a base64 payload. */
  parse: (input: File | { pdfBase64: string }, options: { signal?: AbortSignal; timeoutMs?: number } = {}) => parseDocument('/contracts/parse', input, options),
};

export function parseDocument<T = any>(path: string, input: File | { pdfBase64: string }, options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
  if (input instanceof File || input instanceof Blob) {
    const form = new FormData();
    form.append('file', input);
    return api.post<T>(path, form, options);
  }
  return api.post<T>(path, input, options);
}
