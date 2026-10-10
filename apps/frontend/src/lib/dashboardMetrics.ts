import { spendingReportingAllocations } from '@legalio/shared/spendingAllocations';
import { convertToUsdWithFallback, getDefaultUsdRate } from '@legalio/shared/currencyUtils';
import type { Contract, PartnerSpending } from '@legalio/types';

export function contractTotalInCurrency(contracts: Contract[], currency: string): number {
  return contracts.reduce((sum, contract) => {
    const source = contract.currency || currency;
    if (source === currency) return sum + Number(contract.nilai_kontrak || 0);
    const usd = contract.nilai_kontrak_usd ?? convertToUsdWithFallback(contract.nilai_kontrak, source);
    return sum + usd / (getDefaultUsdRate(currency) || 1);
  }, 0);
}

// Material Design (2014) 500-shade hues. Picked by a hash of the vendor id so a vendor keeps its
// color when rankings or filters change; yellow/lime/grey shades are left out for contrast.
// ponytail: hash pick, two of the five vendors can share a hue; a persisted per-vendor color would rule it out.
export const MATERIAL_SERIES_COLORS = [
  '#2196F3', '#FF9800', '#4CAF50', '#009688', '#3F51B5', '#9C27B0', '#8BC34A',
  '#F44336', '#00BCD4', '#E91E63', '#FF5722', '#795548', '#673AB7', '#03A9F4',
];
const MATERIAL_BLUE_GREY = '#607D8B';

export function vendorColor(id: string): string {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return MATERIAL_SERIES_COLORS[(hash >>> 0) % MATERIAL_SERIES_COLORS.length];
}

export function buildSpendingSeries(rows: PartnerSpending[], year: string, category: string,
  categories: (row: PartnerSpending) => string[], amount: (row: PartnerSpending) => number,
  otherLabel: string) {
  const values: { period: string; id: string; name: string; value: number }[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (category !== 'ALL' && !categories(row).some(c => c.toLowerCase() === category.toLowerCase())) continue;
    const allocations = spendingReportingAllocations(row);
    if (!allocations.length) { skipped++; continue; }
    const convertedTotal = amount(row);
    if (!Number.isFinite(convertedTotal) || convertedTotal < 0) { skipped++; continue; }
    const sourceTotal = Number(row.total_amount);
    // Preserve the invoice's stored exchange rate for every allocated month.
    const rate = sourceTotal > 0 ? convertedTotal / sourceTotal : 0;
    for (const allocation of allocations) {
      if (year !== 'ALL' && !allocation.month.startsWith(year + '-')) continue;
      values.push({ period: allocation.month, id: row.vendor_id || row.vendor_name || 'unknown', name: row.vendor_name || otherLabel, value: allocation.amount * rate });
    }
  }
  const totals = new Map<string, { name: string; total: number }>();
  for (const row of values) {
    const previous = totals.get(row.id);
    totals.set(row.id, { name: row.name, total: (previous?.total || 0) + row.value });
  }
  const top = [...totals].sort((a, b) => b[1].total - a[1].total).slice(0, 5);
  const series = top.map(([id, item]) => ({ key: `vendor:${id}`, name: item.name, color: vendorColor(id) }));
  if (totals.size > 5) series.push({ key: 'other', name: otherLabel, color: MATERIAL_BLUE_GREY });
  const topIds = new Set(top.map(([id]) => id));
  const buckets = new Map<string, Record<string, number>>();
  for (const row of values) {
    const period = year === 'ALL' ? row.period.slice(5) : row.period;
    const bucket = buckets.get(period) || {};
    const key = topIds.has(row.id) ? `vendor:${row.id}` : 'other';
    bucket[key] = (bucket[key] || 0) + row.value;
    buckets.set(period, bucket);
  }
  const data: Array<{ month: string; [key: string]: string | number }> = Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, '0');
    const period = year === 'ALL' ? month : `${year}-${month}`;
    return { month: period, ...Object.fromEntries(series.map(s => [s.key, buckets.get(period)?.[s.key] || 0])) };
  });
  return { data, series, total: values.reduce((sum, row) => sum + row.value, 0), skipped };
}
