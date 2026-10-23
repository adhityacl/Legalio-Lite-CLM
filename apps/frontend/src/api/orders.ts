import type { InsertionOrder } from '@legalio/types';
import { createRecordApi, fetchPage, type Page, type PageQuery } from './records';
import { parseDocument } from './contracts';

export interface OrderPageQuery extends PageQuery {
  status?: string;
  partnerId?: string;
  contractId?: string;
  sort?: 'end_date' | 'io_number' | 'start_date' | 'created_at';
}

const record = createRecordApi<InsertionOrder, 'io'>('/ios', 'io');

export const ordersApi = {
  ...record,
  page: (query: OrderPageQuery, options: { signal?: AbortSignal } = {}): Promise<Page<InsertionOrder>> =>
    fetchPage<InsertionOrder>('/ios', { limit: query.limit ?? 50, offset: query.offset ?? 0, q: query.q, sort: query.sort, dir: query.dir, status: query.status, partner_id: query.partnerId, contract_id: query.contractId }, options),
  parse: (input: File | { pdfBase64: string }, options: { signal?: AbortSignal } = {}) => parseDocument('/ios/parse', input, options),
};
