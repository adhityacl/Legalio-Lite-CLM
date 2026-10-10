import type { DocumentStatus, DocumentType } from '@legalio/types/documents';
import { statusTone, type StatusTone } from '@legalio/ui-components/badge';

type Translate = (key: string, fallback?: string, vars?: Record<string, string | number>) => string;

const STATUS_FALLBACK: Record<DocumentStatus, string> = {
  draft: 'Draf',
  pending_review: 'Menunggu Review',
  approved: 'Disetujui',
  archived: 'Diarsipkan',
};

const TYPE_FALLBACK: Record<DocumentType, string> = {
  contract: 'Kontrak',
  nda: 'NDA',
  agreement: 'Perjanjian',
  addendum: 'Adendum',
  io: 'IO',
  other: 'Lainnya',
};

export const statusLabel = (t: Translate, status: DocumentStatus) => t(`documents.status.${status}`, STATUS_FALLBACK[status]);
export const typeLabel = (t: Translate, type: DocumentType) => t(`documents.type.${type}`, TYPE_FALLBACK[type]);

const STATUS_BADGE_KEY: Record<DocumentStatus, string> = {
  draft: 'draft',
  pending_review: 'pending',
  approved: 'success',
  archived: 'inactive',
};

/** Badge tones shared with the Partners / Contracts / Service Orders tables. */
export const statusBadgeTone = (status: DocumentStatus): StatusTone => statusTone(STATUS_BADGE_KEY[status]);
export const typeBadgeTone = (type: DocumentType): StatusTone => statusTone(type);
