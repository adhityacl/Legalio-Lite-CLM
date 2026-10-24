/**
 * How a record is shown to the AI chat. Privacy by design (PRD §3.4.1, §5.1): only the active tenant's records reach this point, and
 * direct identifiers (phone numbers, e-mail addresses, postal addresses, identity/tax numbers, full bank account numbers) are never part
 * of what is sent: the mappers below name the fields that may leave the server, everything else stays out.
 */
import { computeLifecycle } from './tenantPolicy';

/** Mask all but the last `keep` characters, e.g. bank account numbers. */
export function maskTail(value: unknown, keep = 4): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.length <= keep ? '•'.repeat(text.length) : `${'•'.repeat(Math.min(6, text.length - keep))}${text.slice(-keep)}`;
}

/** Free text from documents and notes: e-mail addresses and long digit sequences (phone, identity, account numbers) are replaced. */
export function scrubText(value: unknown, max = 600): string {
  return String(value ?? '')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, (m) => (m.replace(/\D/g, '').length >= 8 ? '[number]' : m))
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

export type Names = (id: string) => string;

export const partnerContext = (p: any) => ({
  partner_id: p.partner_id || p.id,
  name: p.partner_name,
  codename: p.codename || p.partner_channel || '',
  type: p.partner_type || 'Vendor',
  country: p.country || '',
  entity_type: p.entity_type || '',
  dd_status: p.status_dd,
  dd_verified_at: p.dd_verified_date || '',
  internal_owner: p.internal_pic || '',
  contact_name: p.pic_name || '',
  categories: p.tags || [],
  internal_notes: p.notes || p.internal_notes || '',
  dd_documents: Array.isArray(p.dd_documents)
    ? p.dd_documents.map((d: any) => ({ name: d.name, status: d.status, required: d.required, expires_at: d.expiryDate || '' }))
    : [],
});

export const contractContext = (c: any, partnerNameOf: Names) => ({
  contract_id: c.contract_id || c.id,
  reference: c.contract_number,
  title: c.contract_title,
  counterparty: partnerNameOf(c.partner_id),
  partner_id: c.partner_id || '',
  document_type: c.document_type || 'Master Agreement',
  parent_reference: c.parent_contract_number || c.parent_number || '',
  categories: c.cooperation_categories || [],
  start_date: c.start_date,
  end_date: c.end_date,
  currency: c.currency,
  value: c.contract_value || 0,
  value_usd: c.contract_value_usd || 0,
  auto_renewal: Boolean(c.auto_renewal),
  notice_period_days: c.notice_period_days || 30,
  notice_type: c.notice_type_required || 'Termination',
  status: c.status,
  approval_status: c.status_approval,
  internal_owner: c.internal_pic || '',
  internal_notes: c.internal_notes || c.notes || '',
  change_summary: c.change_summary || '',
  changed_fields: c.changed_fields || [],
  days_remaining: c.days_remaining,
});

export const orderContext = (i: any, partnerNameOf: Names) => {
  const endDate = i.end_date || i.completion_date || i.period_end || '';
  const lifecycle = computeLifecycle(i.organizationId, endDate, i.status);
  return {
    id: i.io_id || i.id,
    reference: i.io_number,
    title: i.io_title,
    counterparty: partnerNameOf(i.partner_id),
    partner_id: i.partner_id || '',
    contract_reference: i.contract_number || '',
    scope: i.media_channel || i.channel || '',
    start_date: i.start_date || i.period_start || '',
    end_date: endDate,
    pricing_model: i.pricing_model || '',
    charging_type: i.charging_type || '',
    payment_scheme: i.payment_scheme || i.pricing_model || '',
    currency: i.currency,
    value: i.io_value || i.total_nominal || 0,
    value_usd: i.io_value_usd || 0,
    deliverables: i.deliverables || '',
    notice_period_days: i.notice_period_days || 14,
    status: lifecycle.status,
    internal_notes: i.internal_notes || i.notes || '',
    days_remaining: lifecycle.daysRemaining,
  };
};

export const spendingContext = (s: any) => ({
  spending_id: s.id,
  vendor_name: s.vendor_name || s.partner_name || '',
  vendor_id: s.vendor_id || s.partner_id || '',
  invoice_number: s.invoice_number || '',
  invoice_date: s.invoice_date || '',
  invoice_month: s.invoice_month || s.month || '',
  currency: s.currency,
  total_amount: s.total_amount || s.amount || 0,
  total_amount_usd: s.total_amount_usd || s.amount_usd || 0,
  description: s.invoice_description || s.description || '',
  payment_status: s.payment_status || '',
  bank: [s.bank_name, maskTail(s.bank_account_number)].filter(Boolean).join(' '),
});

export const evaluationContext = (e: any) => ({
  evaluation_id: e.id,
  supplier_name: e.supplier_name,
  review_date: e.review_date,
  type_of_work: e.type_of_work,
  sla_score: e.sla_score,
  obligation_target: e.obligation_target,
  communication: e.communication,
  pricing: e.pricing,
  calculated_score: e.calculated_score,
  final_evaluation: e.final_evaluation,
  internal_notes: e.notes || '',
});

export const obligationContext = (o: any) => ({
  obligation_id: o.id,
  title: o.title,
  description: scrubText(o.description, 600),
  type: o.type,
  due_date: o.due_date || '',
  status: o.status,
  recurrence: o.recurrence,
  contract_reference: o.contract_number || '',
  order_reference: o.io_number || '',
  partner: o.partner_name || '',
  responsible_department: o.responsible_department || '',
});

export const clauseContext = (c: any) => ({
  clause_id: c.id,
  title: c.title,
  category: c.category,
  risk_level: c.risk_level,
  guidance: c.guidance,
  approved_wording: scrubText(c.approved_text, 800),
  fallback_count: Array.isArray(c.fallback_texts) ? c.fallback_texts.length : 0,
  jurisdiction: c.jurisdiction,
});

export const keyTermContext = (k: any) => ({
  contract_reference: k.contract_number || '',
  term: k.label,
  value: k.value,
  summary: scrubText(k.summary, 400),
  source_quote: scrubText(k.source_quote, 300),
  source_page: k.source_page ?? null,
});

export const documentContext = (d: any, snippet: string) => ({
  document_id: d.id,
  name: d.name,
  type: d.type,
  status: d.status,
  excerpt: scrubText(snippet, 700),
});
