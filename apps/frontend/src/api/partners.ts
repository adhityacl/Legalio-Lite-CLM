import type { Partner } from '@legalio/types';
import { apiRequest } from './client';
import { parseDocument } from './contracts';
import { createRecordApi, fetchPage, type Page, type PageQuery } from './records';

export interface PartnerPageQuery extends PageQuery {
  internalPic?: string;
  partnerType?: string;
  statusDd?: string;
  country?: string;
  sort?: 'partner_name' | 'created_at' | 'updated_at' | 'internal_pic' | 'status_dd';
}

const record = createRecordApi<Partner, 'partner'>('/partners', 'partner');

export const partnersApi = {
  ...record,
  page: (query: PartnerPageQuery, options: { signal?: AbortSignal } = {}): Promise<Page<Partner>> =>
    fetchPage<Partner>('/partners', {
      limit: query.limit ?? 50, offset: query.offset ?? 0, q: query.q, sort: query.sort, dir: query.dir,
      internal_pic: query.internalPic, partner_type: query.partnerType, status_dd: query.statusDd, country: query.country,
    }, options),
  parse: (input: File | { pdfBase64: string }, options: { signal?: AbortSignal } = {}) => parseDocument('/partners/parse', input, options),
  /** Removes one due-diligence file; answers the updated partner. */
  deleteDdFile: (partnerId: string, body: { docName: string; fileId?: string }) =>
    apiRequest<{ success: boolean; partner?: Partner }>(`/partners/${encodeURIComponent(partnerId)}/dd-file`, { method: 'DELETE', body }),
  uploadDd: (partnerId: string, body: { docName: string; fileName: string; fileData: string; expiryDate?: string }) =>
    apiRequest<{ success: boolean; partner?: Partner }>(`/partners/${encodeURIComponent(partnerId)}/upload-dd`, { method: 'POST', body }),
};
