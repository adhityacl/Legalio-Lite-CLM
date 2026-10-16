/** Shared by the approval API (apps/backend/src/approvalRoutes.ts) and the Document Approval UI. */

import { DOCUMENT_TYPES, type DocumentType } from './documents';

/** An approval is typed with the same document types as My Documents. */
export const APPROVAL_CATEGORIES = DOCUMENT_TYPES;
export type ApprovalCategory = DocumentType;

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ApprovalStepStatus = 'waiting' | 'approved' | 'rejected';
export type ApprovalSource = 'document' | 'upload';
export type ApprovalBox = 'inbox' | 'mine' | 'all';

export const APPROVAL_FILE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
export const APPROVAL_MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface ApprovalSummary {
  id: string;
  code: string;
  title: string;
  category: ApprovalCategory;
  status: ApprovalStatus;
  current_step: number;
  step_count: number;
  file_name: string;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  due_at: string;
  decided_at: string | null;
}

export interface ApprovalStep {
  step_no: number;
  approver_id: string;
  approver_name: string | null;
  approver_role: string | null;
  status: ApprovalStepStatus;
  comment: string;
  decided_at: string | null;
}

export interface ApprovalEvent {
  id: string;
  actor_id: string;
  actor_name: string | null;
  kind: 'submitted' | 'approved' | 'rejected';
  message: string;
  created_at: string;
}

export interface ApprovalDetail extends ApprovalSummary {
  note: string;
  source: ApprovalSource;
  document_id: string | null;
  file_mime: string;
  file_size: number;
  steps: ApprovalStep[];
  events: ApprovalEvent[];
}

export interface ApprovalStats {
  waiting: number;
  near_sla: number;
  done_this_month: number;
}

export interface ApprovalCandidate {
  id: string;
  name: string;
  role: string;
}
