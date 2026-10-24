import { api } from './client';
import { fetchPage, type Page } from './records';

type Opts = { signal?: AbortSignal; organizationId?: string | null };

/** One contract or order row of the dashboard's "expiring" and "recent" lists. */
export interface DashboardDocument {
  id: string; title: string; number: string; partner_id: string | null; partner_name: string | null;
  end_date: string | null; days_remaining: number | null; status: string; created_at: string; document_type?: string;
}
export interface SpendingMonthRow {
  vendor_id: string | null; vendor_name: string; month: string; currency: string; amount: number; amount_usd: number | null; categories: string[];
}
export interface DashboardAggregate {
  organizationId: string;
  partners: { total: number; active: number; byDdStatus: Record<string, number> };
  contracts: {
    total: number; byStatus: Record<string, number>; byApproval: Record<string, number>;
    activeValueByCurrency: Array<{ currency: string; amount: number; amountUsdKnown: number; amountMissingUsd: number }>;
  };
  ios: { total: number; byStatus: Record<string, number> };
  notifications: { total: number; unread: number };
  expiring: { contracts: DashboardDocument[]; ios: DashboardDocument[] };
  recent: { contracts: DashboardDocument[]; ios: DashboardDocument[] };
  categories: string[];
  spending: SpendingMonthRow[];
}
export interface BadgeAggregate { expiringContracts: number; unreadNotifications: number }
export interface FacetAggregate {
  categories: string[]; pricingModels: string[]; chargingTypes: string[]; vendors: string[]; spendingYears: string[]; departments: string[]; countries: string[];
}
export interface PartnerRollup {
  partner_id: string; partner_name: string; partner_type: string | null; internal_pic: string | null; status_dd: string | null; country: string | null;
  contracts: { total: number; active: number; expiring: number; valueUsd: number; nextEndDate: string | null };
  ios: { total: number; active: number; valueUsd: number };
  spending: { count: number; totalUsd: number };
  evaluations: { count: number; averageScore: number | null; lastReviewDate: string | null };
}

/** SQL-computed figures for the dashboard, the navigation badges and the hierarchy; replaces loading every record into the browser. */
export const aggregatesApi = {
  dashboard: (options: Opts = {}) => api.get<DashboardAggregate>('/aggregates/dashboard', { ...options, cache: 'no-store' }),
  badges: (options: Opts = {}) => api.get<BadgeAggregate>('/aggregates/badges', { ...options, cache: 'no-store' }),
  facets: (options: Opts = {}) => api.get<FacetAggregate>('/aggregates/facets', { ...options, cache: 'no-store' }),
  partners: (query: Record<string, string | number | undefined>, options: Opts = {}): Promise<Page<PartnerRollup>> =>
    fetchPage<PartnerRollup>('/aggregates/partners', query, options),
};
