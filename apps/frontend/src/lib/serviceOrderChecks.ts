import type { Contract, InsertionOrder } from '@legalio/types';

export type CheckStatus = 'ok' | 'warn' | 'fail';
export interface ServiceOrderCheck { key: 'active' | 'period' | 'partner' | 'currency' | 'budget' | 'number'; status: CheckStatus }

export interface ServiceOrderDraft {
  io_id?: string; io_number: string; partner_id: string; currency: string;
  io_value: number; start_date: string; end_date: string;
}

/** Rule checks of a service order against its parent contract and sibling SOs (no AI). */
export function serviceOrderChecks(draft: ServiceOrderDraft, parent: Contract | undefined, ios: InsertionOrder[]): ServiceOrderCheck[] {
  const others = ios.filter((io) => io.io_id !== draft.io_id);
  const number = draft.io_number.trim().toLowerCase();
  const checks: ServiceOrderCheck[] = [
    { key: 'number', status: number && others.some((io) => (io.io_number || '').trim().toLowerCase() === number) ? 'fail' : 'ok' },
  ];
  if (!parent) return checks;
  // Sibling SOs in another currency can't be summed reliably, so only same-currency SOs count toward the budget.
  const committed = others
    .filter((io) => io.contract_id === parent.contract_id && (io.currency || parent.currency) === draft.currency)
    .reduce((sum, io) => sum + (Number(io.io_value) || 0), 0);
  const value = Number(parent.contract_value) || 0;
  checks.unshift(
    { key: 'active', status: parent.status === 'Expired' || parent.status === 'Terminated' ? 'fail' : 'ok' },
    { key: 'period', status: draft.start_date >= parent.start_date && draft.end_date <= parent.end_date ? 'ok' : 'warn' },
    { key: 'partner', status: draft.partner_id === parent.partner_id ? 'ok' : 'fail' },
    { key: 'currency', status: !parent.currency || draft.currency === parent.currency ? 'ok' : 'warn' },
    { key: 'budget', status: value <= 0 || committed + (Number(draft.io_value) || 0) <= value ? 'ok' : 'warn' },
  );
  return checks;
}
