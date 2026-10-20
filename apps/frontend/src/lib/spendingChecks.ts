import type { Contract, InsertionOrder, Partner, PartnerSpending } from '@legalio/types';

export interface SpendingDraft {
  id?: string; vendor_id: string; vendor_name: string; invoice_number: string; invoice_date: string;
  currency: string; total_amount: number; bank_account_number: string; bank_account_holder_name: string;
  io_id?: string; billed_quantity?: number;
}

/** What the linked SO says this invoice should cover. Fields are absent when they can't be computed. */
export interface SpendingEstimate {
  unit: string;
  /** 1000 for CPM, 1 otherwise. */
  per: number;
  expectedUnits?: number;
  billedUnits?: number;
  shortfallPct?: number;
  budgetUsedPct?: number;
  elapsedPct?: number;
  remainingBudget?: number;
  remainingUnits?: number;
}

export interface SpendingCheck {
  key: 'duplicate' | 'bank_changed' | 'holder_mismatch' | 'no_agreement' | 'currency' | 'over_budget' | 'under_delivery' | 'ahead_of_schedule';
  status: 'warn' | 'fail';
  /** Percentage for under_delivery / ahead_of_schedule. */
  value?: number;
}

/** Flat-fee models are billed over time, so they get a pace check instead of unit maths. */
const PACED_MODELS = ['Fixed', 'Retainer', 'Subscription'];
const NO_UNIT_MODELS = [...PACED_MODELS, 'Milestone', 'Commission'];
const round1 = (n: number) => Math.round(n * 10) / 10;
const digits = (v: string) => v.replace(/\D/g, '');
const LEGAL_WORDS = /\b(pt|cv|tbk|persero|ltd|pte|inc|llc|co|corp|corporation|limited|company|gmbh|bv)\b/g;
const nameCore = (v: string) => v.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(LEGAL_WORDS, ' ').replace(/\s+/g, '');
const sameVendor = (row: PartnerSpending, draft: SpendingDraft) =>
  draft.vendor_id ? row.vendor_id === draft.vendor_id : row.vendor_name === draft.vendor_name;

export function spendingEstimate(draft: SpendingDraft, so: InsertionOrder | undefined, spendings: PartnerSpending[]): SpendingEstimate | null {
  if (!so || (so.currency && so.currency !== draft.currency)) return null;
  const per = so.pricing_model === 'CPM' ? 1000 : 1;
  const hasUnits = Number(so.unit_price) > 0 && !NO_UNIT_MODELS.includes(so.pricing_model);
  const toUnits = (amount: number) => Math.round((amount / Number(so.unit_price)) * per);
  const estimate: SpendingEstimate = { unit: so.unit || 'units', per };
  if (hasUnits) {
    estimate.expectedUnits = toUnits(draft.total_amount);
    if (draft.billed_quantity && draft.billed_quantity > 0) {
      estimate.billedUnits = draft.billed_quantity;
      estimate.shortfallPct = estimate.expectedUnits > 0 ? Math.max(0, round1(((estimate.expectedUnits - draft.billed_quantity) / estimate.expectedUnits) * 100)) : 0;
    }
  }
  const value = Number(so.io_value) || 0;
  if (value > 0) {
    const used = spendings
      .filter((s) => s.io_id === so.io_id && s.id !== draft.id && (s.currency || draft.currency) === draft.currency)
      .reduce((sum, s) => sum + (Number(s.total_amount) || 0), 0) + draft.total_amount;
    estimate.budgetUsedPct = round1((used / value) * 100);
    estimate.remainingBudget = value - used;
    if (hasUnits) estimate.remainingUnits = toUnits(Math.max(0, estimate.remainingBudget));
  }
  const start = Date.parse(so.start_date), end = Date.parse(so.end_date), at = Date.parse(draft.invoice_date);
  if (end > start && !Number.isNaN(at)) estimate.elapsedPct = round1(Math.min(100, Math.max(0, ((at - start) / (end - start)) * 100)));
  return estimate;
}

/** Rule checks for the spending form (no AI); only problems are returned. */
export function spendingChecks(
  draft: SpendingDraft,
  data: { partners: Partner[]; contracts: Contract[]; ios: InsertionOrder[]; spendings: PartnerSpending[] },
  estimate: SpendingEstimate | null,
): SpendingCheck[] {
  const checks: SpendingCheck[] = [];
  const others = data.spendings.filter((s) => s.id !== draft.id && sameVendor(s, draft));
  const number = draft.invoice_number.trim().toLowerCase();
  if (number && others.some((s) => s.invoice_number.trim().toLowerCase() === number && Number(s.total_amount) === draft.total_amount)) {
    checks.push({ key: 'duplicate', status: 'fail' });
  }

  const previous = others.filter((s) => digits(s.bank_account_number || ''))
    .sort((a, b) => (b.invoice_date || b.created_at || '').localeCompare(a.invoice_date || a.created_at || ''))[0];
  if (previous && digits(draft.bank_account_number) && digits(previous.bank_account_number || '') !== digits(draft.bank_account_number)) {
    checks.push({ key: 'bank_changed', status: 'fail' });
  }
  const holder = nameCore(draft.bank_account_holder_name), vendor = nameCore(draft.vendor_name);
  if (holder && vendor && !holder.includes(vendor) && !vendor.includes(holder)) checks.push({ key: 'holder_mismatch', status: 'warn' });

  const so = data.ios.find((io) => io.io_id === draft.io_id);
  if (!so && draft.vendor_id && draft.invoice_date) {
    const covers = (r: { partner_id: string; start_date: string; end_date: string }) =>
      r.partner_id === draft.vendor_id && r.start_date <= draft.invoice_date && draft.invoice_date <= r.end_date;
    if (!data.contracts.some(covers) && !data.ios.some(covers)) checks.push({ key: 'no_agreement', status: 'warn' });
  }
  if (so?.currency && so.currency !== draft.currency) checks.push({ key: 'currency', status: 'warn' });
  if (estimate?.budgetUsedPct !== undefined && estimate.budgetUsedPct > 100) checks.push({ key: 'over_budget', status: 'fail' });
  if (estimate?.shortfallPct !== undefined && estimate.shortfallPct >= 2) checks.push({ key: 'under_delivery', status: 'warn', value: estimate.shortfallPct });
  if (so && PACED_MODELS.includes(so.pricing_model) && estimate?.budgetUsedPct !== undefined && estimate.elapsedPct !== undefined
    && estimate.budgetUsedPct - estimate.elapsedPct > 15) {
    checks.push({ key: 'ahead_of_schedule', status: 'warn', value: round1(estimate.budgetUsedPct - estimate.elapsedPct) });
  }
  return checks;
}
