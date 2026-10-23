import type { Contract, InsertionOrder, NotificationLog, Partner, PartnerEvaluation, PartnerSpending } from '@legalio/types';
import { api } from './client';

/** `GET /api/init-data`: every record the caller may see, in one response (kept for compatibility; list views may page instead). */
export interface WorkspaceSnapshot {
  organizationId: string;
  contracts: Contract[];
  ios: InsertionOrder[];
  partners: Partner[];
  notifications: NotificationLog[];
  evaluations: PartnerEvaluation[];
  spendings: PartnerSpending[];
  services: { aiAvailable: boolean; googleUploadsAvailable: boolean };
  timestamp: number;
}

export const workspaceApi = {
  /** Bound to `organizationId`: a later organization switch cannot change which workspace this request reads. */
  initData: (organizationId: string | null | undefined, signal?: AbortSignal) =>
    api.get<WorkspaceSnapshot>('/init-data', { organizationId, signal, cache: 'no-store' }),
};
