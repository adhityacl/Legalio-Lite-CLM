/** Shared by the document API (src/server/documentRoutes.ts) and the Create Contract UI. */

export const DOCUMENT_STATUSES = ['draft', 'pending_review', 'approved', 'archived'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_TYPES = ['contract', 'nda', 'agreement', 'addendum', 'io', 'other'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const METADATA_FIELD_TYPES = ['text', 'select', 'date', 'multi_select'] as const;
export type MetadataFieldType = (typeof METADATA_FIELD_TYPES)[number];

export const DOCUMENT_SORT_KEYS = ['name', 'type', 'status', 'created_at', 'modified_at', 'created_by', 'file_size'] as const;
export type DocumentSortKey = (typeof DOCUMENT_SORT_KEYS)[number];

export const PAGE_SIZES = [25, 50, 100] as const;

export type SaveKind = 'auto' | 'manual' | 'restore';
export type CommentType = 'comment' | 'suggestion';
export type CommentStatus = 'open' | 'resolved' | 'accepted' | 'rejected';
export type CommentAction = 'accept' | 'reject' | 'resolve' | 'reopen';

export interface DocumentSummary {
  id: string;
  name: string;
  type: DocumentType;
  status: DocumentStatus;
  file_size: number;
  current_version: number;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  modified_by: string | null;
  modified_by_name: string | null;
  modified_at: string;
}

export interface DocumentDetail extends DocumentSummary {
  organization_id: string;
  content: string;
  draft_count: number;
}

export interface DocumentListResponse {
  total: number;
  page: number;
  limit: number;
  documents: DocumentSummary[];
  creators: Array<{ id: string; name: string | null }>;
}

export interface DraftVersion {
  version_number: number;
  draft_name: string | null;
  labels: string[];
  file_size: number;
  save_kind: SaveKind;
  restored_from: number | null;
  saved_by: string;
  saved_by_name: string | null;
  saved_at: string;
}

export interface MetadataField {
  id: string;
  name: string;
  field_type: MetadataFieldType;
  options: string[];
}

/** Values keyed by field id; multi-select values are string arrays. */
export type MetadataValues = Record<string, string | string[]>;

export interface DocumentComment {
  id: string;
  parent_id: string | null;
  comment_type: CommentType;
  body: string;
  quote: string;
  new_text: string | null;
  status: CommentStatus;
  author_id: string;
  author_name: string | null;
  created_at: string;
  resolved_by: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
}

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

type UiLanguage = 'ID' | 'EN' | 'ZH';
const LOCALE: Record<UiLanguage, string> = { ID: 'id-ID', EN: 'en-US', ZH: 'zh-CN' };

export function formatRelativeTime(iso: string, language: UiLanguage, now = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(LOCALE[language], { numeric: 'auto' });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(0, 'second');
}

export function formatDateTime(iso: string, language: UiLanguage): string {
  return new Date(iso).toLocaleString(LOCALE[language], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
