import type { PartnerSpending, SpendingMonthAllocation } from '@legalio/types';
import { parseAllMonths, parseMonthStr, normalizeMonthToDate } from './monthUtils';

export interface SpendingAllocationInput {
  month: string;
  amount: number | '';
}

export const ALLOCATION_TOLERANCE = 0.000001;

export type AllocationError = 'total' | 'empty' | 'month' | 'duplicate' | 'amount' | 'mismatch';

/** Shared by the form and API, so direct API writes obey the same constraints. */
export function validateSpendingAllocations(rows: unknown, total: unknown): AllocationError | null {
  if (total === '' || total === null || total === undefined || !Number.isFinite(Number(total)) || Number(total) < 0) return 'total';
  if (!Array.isArray(rows) || !rows.length) return 'empty';
  const seen = new Set<string>();
  let allocated = 0;
  for (const row of rows) {
    if (!row || typeof row.month !== 'string' || !/^(?:19\d{2}|20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(row.month)) return 'month';
    if (seen.has(row.month)) return 'duplicate';
    seen.add(row.month);
    if (typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount < 0) return 'amount';
    allocated += row.amount;
  }
  return Math.abs(allocated - Number(total)) <= ALLOCATION_TOLERANCE ? null : 'mismatch';
}

/** Leave historical amounts unassigned until the user explicitly confirms them. */
export function hydrateSpendingAllocations(item?: Pick<PartnerSpending, 'invoice_month' | 'month_allocations'> | null): SpendingAllocationInput[] {
  if (Array.isArray(item?.month_allocations)) return item.month_allocations.map(row => ({ ...row }));
  const months = (item?.invoice_month || []).flatMap(parseAllMonths).map(row => `${row.year}-${row.month}`);
  return [...new Set(months)].map(month => ({ month, amount: '' }));
}

/** Put rounding residue in the final row; never change the invoice total. */
export function splitSpendingEqually(rows: SpendingAllocationInput[], total: number, minorUnits = 2): SpendingAllocationInput[] {
  if (!rows.length || !Number.isFinite(total) || total < 0) return rows;
  const scale = 10 ** minorUnits;
  const base = Math.floor(Math.round(total * scale) / rows.length) / scale;
  return rows.map((row, index) => ({ ...row, amount: index === rows.length - 1
    ? Number((total - base * (rows.length - 1)).toFixed(8)) : base }));
}

export function allocationInvoiceMonths(rows: Pick<SpendingMonthAllocation, 'month'>[]): string[] {
  return rows.map(row => normalizeMonthToDate(row.month));
}

/** Reporting uses confirmed allocations; only legacy invoices are split equally.
 * Invalid explicit allocations must not silently become an equal split.
 */
export function spendingReportingAllocations(item: PartnerSpending): SpendingMonthAllocation[] {
  if (item.month_allocations !== undefined) {
    return validateSpendingAllocations(item.month_allocations, item.total_amount) === null
      ? item.month_allocations!.map(({ month, amount }) => ({ month, amount })) : [];
  }
  const total = Number(item.total_amount);
  if (!Number.isFinite(total) || total < 0) return [];
  let months = (item.invoice_month || []).flatMap(parseAllMonths);
  if (!months.length) {
    const month = parseMonthStr(item.invoice_date || '');
    if (month) months = [month];
  }
  const periods = [...new Set(months.map(({ year, month }) => `${year}-${month}`))];
  return periods.map(month => ({ month, amount: total / periods.length }));
}

/** The parser supplies months only from an explicitly printed service period. */
export function parsedSpendingAllocations(data: { spending_months?: unknown; month_allocations?: unknown }): SpendingAllocationInput[] | null {
  if (!Array.isArray(data.spending_months) || !data.spending_months.length) return null;
  const months = [...new Set(data.spending_months.filter((month): month is string =>
    typeof month === 'string' && /^(?:19\d{2}|20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(month)))];
  if (!months.length) return null;
  const amounts = Array.isArray(data.month_allocations) ? data.month_allocations : [];
  return months.map(month => {
    const row = amounts.find(row => row?.month === month);
    return { month, amount: typeof row?.amount === 'number' && Number.isFinite(row.amount) && row.amount >= 0 ? row.amount : '' };
  });
}
