import type { Contract, InsertionOrder, Partner, PartnerEvaluation, PartnerSpending } from '@legalio/types';
import { spendingEstimate } from './spendingChecks';

/** One partner's cooperation during an evaluation year, computed from records already in the app (no AI). */
export interface EvaluationSnapshot {
  year: number;
  /** True while the year is still running: figures are year-to-date. */
  ytd: boolean;
  spendUsd: number;
  /** Change vs the previous year's spend; absent when last year had none. */
  growthPct?: number;
  /** USD per month, January..December. */
  monthlyUsd: number[];
  invoices: number;
  activeContracts: number;
  activeSos: number;
  /** Spend on this year's SOs as a share of their value (USD). */
  soUsedPct?: number;
  /** Invoices billing fewer units than their amount covers, of those that record units. */
  underDelivered: { count: number; of: number; avgPct?: number };
  expiring: { number: string; endDate: string; autoRenewal: boolean }[];
  avgRiskScore?: number;
  previous?: { year: number; score: number };
  /** This partner's latest unit price vs other partners' on the same pricing model and currency. */
  pricing?: { model: string; currency: string; price: number; peerAvg: number; diffPct: number };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const yearOf = (date?: string) => Number((date || '').slice(0, 4));
const usdOf = (s: PartnerSpending) => Number(s.total_amount_usd ?? (s.currency === 'USD' ? s.total_amount : 0)) || 0;
const overlapsYear = (r: { start_date: string; end_date: string }, year: number) =>
  r.start_date <= `${year}-12-31` && r.end_date >= `${year}-01-01`;

/** Spreads an invoice's USD value over its month allocations (falls back to the invoice month). */
function addMonthly(monthly: number[], s: PartnerSpending, year: number) {
  const total = Number(s.total_amount) || 0;
  const rows = (s.month_allocations || []).filter((a) => yearOf(a.month) === year);
  if (rows.length && total > 0) {
    for (const a of rows) monthly[Number(a.month.slice(5, 7)) - 1] += (Number(a.amount) / total) * usdOf(s);
  } else if (yearOf(s.invoice_date) === year) {
    monthly[Number(s.invoice_date.slice(5, 7)) - 1] += usdOf(s);
  }
}

export function evaluationSnapshot(
  partner: { partner_id?: string; partner_name: string },
  year: number,
  today: string,
  data: { partners: Partner[]; contracts: Contract[]; ios: InsertionOrder[]; spendings: PartnerSpending[]; evaluations: PartnerEvaluation[] },
  excludeEvaluationId?: string,
): EvaluationSnapshot {
  // Older rows may lack the id, so the name is the fallback key.
  const mine = (id: string | undefined, name: string | undefined) => (partner.partner_id ? id === partner.partner_id : name === partner.partner_name);
  const spends = data.spendings.filter((s) => mine(s.vendor_id, s.vendor_name));
  const inYear = (s: PartnerSpending, y: number) => yearOf(s.invoice_date) === y;
  const thisYear = spends.filter((s) => inYear(s, year));
  const spendUsd = thisYear.reduce((sum, s) => sum + usdOf(s), 0);
  const lastUsd = spends.filter((s) => inYear(s, year - 1)).reduce((sum, s) => sum + usdOf(s), 0);
  const monthlyUsd = Array<number>(12).fill(0);
  spends.forEach((s) => addMonthly(monthlyUsd, s, year));

  const contracts = data.contracts.filter((c) => mine(c.partner_id, undefined) && overlapsYear(c, year));
  const sos = data.ios.filter((io) => mine(io.partner_id, undefined) && overlapsYear(io, year));
  const soValueUsd = sos.reduce((sum, io) => sum + (Number(io.io_value_usd) || 0), 0);
  const soSpendUsd = thisYear.filter((s) => sos.some((io) => io.io_id === s.io_id)).reduce((sum, s) => sum + usdOf(s), 0);

  const shortfalls = thisYear.flatMap((s) => {
    if (!s.io_id || !s.billed_quantity) return [];
    const e = spendingEstimate({ id: s.id, vendor_id: s.vendor_id || '', vendor_name: s.vendor_name, invoice_number: s.invoice_number,
      invoice_date: s.invoice_date, currency: s.currency, total_amount: Number(s.total_amount) || 0, bank_account_number: '',
      bank_account_holder_name: '', io_id: s.io_id, billed_quantity: s.billed_quantity }, data.ios.find((io) => io.io_id === s.io_id), data.spendings);
    return e?.shortfallPct === undefined ? [] : [e.shortfallPct];
  });
  const under = shortfalls.filter((pct) => pct >= 2);

  const in90 = new Date(Date.parse(today) + 90 * 86_400_000).toISOString().slice(0, 10);
  const expiring = data.contracts
    .filter((c) => mine(c.partner_id, undefined) && c.end_date >= today && c.end_date <= in90)
    .map((c) => ({ number: c.contract_number, endDate: c.end_date, autoRenewal: Boolean(c.auto_renewal) }));
  const risks = data.contracts.filter((c) => mine(c.partner_id, undefined) && c.redline_analysis).map((c) => c.redline_analysis!.overallRiskScore);

  const previous = data.evaluations
    .filter((e) => e.id !== excludeEvaluationId && mine(e.partner_id, e.supplier_name) && yearOf(e.review_date) < year)
    .sort((a, b) => b.review_date.localeCompare(a.review_date))[0];
  const previousScore = previous ? Number(previous.calculated_score ?? previous.total_score) : NaN;

  const priced = data.ios.filter((io) => mine(io.partner_id, undefined) && Number(io.unit_price) > 0)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
  let pricing: EvaluationSnapshot['pricing'];
  if (priced) {
    const peers = data.ios.filter((io) => io.partner_id !== priced.partner_id && io.pricing_model === priced.pricing_model
      && io.currency === priced.currency && Number(io.unit_price) > 0);
    if (peers.length) {
      const peerAvg = peers.reduce((sum, io) => sum + Number(io.unit_price), 0) / peers.length;
      pricing = { model: priced.pricing_model, currency: priced.currency || '', price: Number(priced.unit_price), peerAvg: Math.round(peerAvg),
        diffPct: round1(((Number(priced.unit_price) - peerAvg) / peerAvg) * 100) };
    }
  }

  return {
    year,
    ytd: year === yearOf(today),
    spendUsd: round1(spendUsd),
    growthPct: lastUsd > 0 ? round1(((spendUsd - lastUsd) / lastUsd) * 100) : undefined,
    monthlyUsd: monthlyUsd.map(round1),
    invoices: thisYear.length,
    activeContracts: contracts.length,
    activeSos: sos.length,
    soUsedPct: soValueUsd > 0 ? round1((soSpendUsd / soValueUsd) * 100) : undefined,
    underDelivered: { count: under.length, of: shortfalls.length, avgPct: under.length ? round1(under.reduce((a, b) => a + b, 0) / under.length) : undefined },
    expiring,
    avgRiskScore: risks.length ? Math.round(risks.reduce((a, b) => a + b, 0) / risks.length) : undefined,
    previous: previous && Number.isFinite(previousScore) ? { year: yearOf(previous.review_date), score: previousScore } : undefined,
    pricing,
  };
}
