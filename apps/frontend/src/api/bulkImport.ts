import { api } from './client';

export interface BulkImportResult {
  succeeded: Array<{ rowIndex: number; identifier: string; message: string }>;
  skipped: Array<{ rowIndex: number; identifier: string; message: string }>;
  failed: Array<{ rowIndex: number; identifier: string; message: string }>;
}

export const bulkImportApi = {
  run: (input: { type: string; rows: Array<Record<string, unknown>>; defaultDepartment?: string; overrideDepartment?: boolean }) =>
    api.post<BulkImportResult>('/bulk-import', input),
};
