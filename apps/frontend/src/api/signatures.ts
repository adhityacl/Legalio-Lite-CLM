import { api } from './client';
import { fetchPage, type Page } from './records';

export type SignatureStatus = 'draft' | 'sent' | 'partially_signed' | 'completed' | 'declined' | 'expired' | 'cancelled';
export interface Signer { id: string; name: string; email: string; order: number; status: 'pending' | 'signed' | 'declined'; signedAt: string | null; declineReason: string | null; canSignNow: boolean }
export interface SignatureFile { id: string; kind: 'signed' | 'evidence'; fileName: string; contentType: string; sizeBytes: number; sha256: string; uploadedBy: string; createdAt: string; downloadUrl: string }
export interface SignatureEvent { id: string; type: string; actor: string; signerId: string | null; detail: Record<string, unknown>; createdAt: string }
export interface SignatureRequest {
  id: string; contractId: string; title: string; message: string; mode: 'sequential' | 'parallel'; status: SignatureStatus; provider: string; providerRef: string | null;
  expiresAt: string | null; requestedBy: string; requestedByName?: string | null; sentAt: string | null; completedAt: string | null; closedReason: string | null; version: number;
  createdAt: string; updatedAt: string; signers: Signer[]; signedFile: SignatureFile | null; files?: SignatureFile[]; events?: SignatureEvent[];
}
export interface SignatureEndpoint { id: string; name: string; enabled: boolean; createdAt: string; rotatedAt: string | null; lastReceivedAt: string | null; url: string }
export interface CreateSignatureInput {
  contract_id: string; title?: string; message?: string; mode: 'sequential' | 'parallel'; signers: Array<{ name: string; email: string; order?: number }>; expiresInDays?: number; send?: boolean;
}
export interface FileInput { fileName: string; fileData: string }

const base = (id: string) => `/signatures/${encodeURIComponent(id)}`;
type Saved = { success: boolean; request: SignatureRequest };

export const signaturesApi = {
  forContract: (contractId: string, options: { signal?: AbortSignal; organizationId?: string | null } = {}): Promise<Page<SignatureRequest>> =>
    fetchPage<SignatureRequest>('/signatures', { contract_id: contractId, limit: 50 }, options),
  get: (id: string, options: { signal?: AbortSignal } = {}) => api.get<{ request: SignatureRequest }>(base(id), { ...options, cache: 'no-store' }),
  create: (body: CreateSignatureInput) => api.post<Saved>('/signatures', body),
  send: (id: string) => api.post<Saved>(`${base(id)}/send`, {}),
  resend: (id: string) => api.post<Saved>(`${base(id)}/resend`, {}),
  cancel: (id: string, reason?: string) => api.post<Saved>(`${base(id)}/cancel`, { reason }),
  signerSigned: (id: string, signerId: string) => api.post<Saved>(`${base(id)}/signers/${encodeURIComponent(signerId)}/signed`, {}),
  signerDeclined: (id: string, signerId: string, reason?: string) => api.post<Saved>(`${base(id)}/signers/${encodeURIComponent(signerId)}/declined`, { reason }),
  complete: (id: string, signed: FileInput, evidence: FileInput[] = []) => api.post<Saved>(`${base(id)}/complete`, { ...signed, evidence }),
  addEvidence: (id: string, files: FileInput[]) => api.post<Saved>(`${base(id)}/files`, { files: files.map((file) => ({ ...file, kind: 'evidence' })) }),
};

export const endpointsApi = (organizationId: string) => {
  const path = `/organizations/${encodeURIComponent(organizationId)}/signature-endpoints`;
  return {
    list: () => api.get<{ endpoints: SignatureEndpoint[] }>(path, { cache: 'no-store' }),
    create: (name: string) => api.post<{ endpoint: SignatureEndpoint; secret: string }>(path, { name }),
    update: (id: string, body: { name?: string; enabled?: boolean }) => api.patch<{ endpoint: SignatureEndpoint }>(`${path}/${encodeURIComponent(id)}`, body),
    rotate: (id: string) => api.post<{ secret: string }>(`${path}/${encodeURIComponent(id)}/rotate-secret`, {}),
    remove: (id: string) => api.delete<unknown>(`${path}/${encodeURIComponent(id)}`),
  };
};

/** A file chosen in the browser as a `data:` URL (the form the API expects), refused above `maxBytes` before it is read. */
export function readFileAsDataUrl(file: File, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) return reject(new RangeError('FILE_TOO_LARGE'));
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
export const MAX_SIGNATURE_FILE_BYTES = 15 * 1024 * 1024;
