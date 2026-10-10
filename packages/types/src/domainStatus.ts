/**
 * Stable, language-neutral status codes (PRD §3.2.3, §3.3.1).
 *
 * Earlier releases stored Indonesian display labels ("Aktif", "Lengkap", ...)
 * as data. Codes below are what is persisted now; labels come from i18n.
 * The normalisers accept every legacy spelling so imports, old SQLite rows,
 * and spreadsheets keep working.
 */

export type ContractStatus = 'Active' | 'Expiring' | 'Expired' | 'Terminated';
export type ApprovalStatus = 'Draft' | 'Review' | 'Signed' | 'Active';
export type DueDiligenceStatus = 'Complete' | 'Incomplete' | 'Expired';
export type DocumentEvidenceStatus = 'Available' | 'Missing' | 'Expired';

const CONTRACT_STATUS_ALIASES: Record<string, ContractStatus> = {
  active: 'Active',
  aktif: 'Active',
  expiring: 'Expiring',
  'expiring soon': 'Expiring',
  'akan berakhir': 'Expiring',
  expired: 'Expired',
  kadaluarsa: 'Expired',
  kedaluwarsa: 'Expired',
  berakhir: 'Expired',
  terminated: 'Terminated',
  diakhiri: 'Terminated',
};

const APPROVAL_STATUS_ALIASES: Record<string, ApprovalStatus> = {
  draft: 'Draft',
  review: 'Review',
  'in review': 'Review',
  signed: 'Signed',
  ditandatangani: 'Signed',
  active: 'Active',
  aktif: 'Active',
};

const DD_STATUS_ALIASES: Record<string, DueDiligenceStatus> = {
  complete: 'Complete',
  completed: 'Complete',
  lengkap: 'Complete',
  incomplete: 'Incomplete',
  'belum lengkap': 'Incomplete',
  expired: 'Expired',
  kadaluarsa: 'Expired',
  kedaluwarsa: 'Expired',
};

const DOC_STATUS_ALIASES: Record<string, DocumentEvidenceStatus> = {
  available: 'Available',
  ada: 'Available',
  uploaded: 'Available',
  missing: 'Missing',
  belum: 'Missing',
  'tidak ada': 'Missing',
  expired: 'Expired',
  kadaluarsa: 'Expired',
  kedaluwarsa: 'Expired',
};

const key = (value: unknown) => String(value ?? '').trim().toLowerCase();

export function normalizeContractStatus(value: unknown, fallback: ContractStatus = 'Active'): ContractStatus {
  return CONTRACT_STATUS_ALIASES[key(value)] || fallback;
}

export function normalizeApprovalStatus(value: unknown, fallback: ApprovalStatus = 'Active'): ApprovalStatus {
  return APPROVAL_STATUS_ALIASES[key(value)] || fallback;
}

export function normalizeDueDiligenceStatus(value: unknown, fallback: DueDiligenceStatus = 'Incomplete'): DueDiligenceStatus {
  return DD_STATUS_ALIASES[key(value)] || fallback;
}

export function normalizeDocumentStatus(value: unknown, fallback: DocumentEvidenceStatus = 'Missing'): DocumentEvidenceStatus {
  return DOC_STATUS_ALIASES[key(value)] || fallback;
}

/** i18n keys for each code, so views never print the raw code. */
export const CONTRACT_STATUS_LABEL_KEY: Record<ContractStatus, string> = {
  Active: 'status.active',
  Expiring: 'status.expiring',
  Expired: 'status.expired',
  Terminated: 'status.terminated',
};

export const DD_STATUS_LABEL_KEY: Record<DueDiligenceStatus, string> = {
  Complete: 'status.dd_complete',
  Incomplete: 'status.dd_incomplete',
  Expired: 'status.expired',
};

export const DOC_STATUS_LABEL_KEY: Record<DocumentEvidenceStatus, string> = {
  Available: 'status.doc_available',
  Missing: 'status.doc_missing',
  Expired: 'status.expired',
};

/**
 * Lifecycle status from remaining days, driven by tenant configuration
 * rather than a hardcoded 90-day window.
 */
export function deriveContractStatus(params: {
  current?: unknown;
  daysRemaining: number | null;
  expiryWarningDays: number;
  autoRenewal?: boolean;
}): ContractStatus {
  const current = normalizeContractStatus(params.current);
  if (current === 'Terminated') return 'Terminated';
  const days = params.daysRemaining;
  if (days === null) return current;
  if (days < 0) return params.autoRenewal ? 'Active' : 'Expired';
  if (days <= params.expiryWarningDays) return 'Expiring';
  return 'Active';
}
