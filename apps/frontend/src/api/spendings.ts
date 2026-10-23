import type { PartnerSpending } from '@legalio/types';
import { api } from './client';
import { createRecordApi, fetchPage, type Page, type PageQuery } from './records';
import { parseDocument } from './contracts';

export interface SpendingPageQuery extends PageQuery {
  paymentStatus?: string;
  vendorId?: string;
  currency?: string;
  sort?: 'invoice_date' | 'vendor_name' | 'total_amount_usd' | 'created_at';
}

const record = createRecordApi<PartnerSpending, 'spending'>('/partner-spendings', 'spending');

export const spendingsApi = {
  ...record,
  page: (query: SpendingPageQuery, options: { signal?: AbortSignal } = {}): Promise<Page<PartnerSpending>> =>
    fetchPage<PartnerSpending>('/partner-spendings', { limit: query.limit ?? 50, offset: query.offset ?? 0, q: query.q, sort: query.sort, dir: query.dir, payment_status: query.paymentStatus, vendor_id: query.vendorId, currency: query.currency }, options),
  parse: (input: File | { pdfBase64: string }, options: { signal?: AbortSignal } = {}) => parseDocument('/spendings/parse', input, options),
  exchangeRates: (headers: Record<string, string> = {}) => api.get<Record<string, number>>('/exchange-rates', { headers, cache: 'no-store' }),
};
