/**
 * Request-body schemas for the record routes (partners, contracts, insertion orders, spendings, evaluations).
 *
 * Each schema lists exactly the fields the current frontend forms send. Zod objects drop undeclared keys, so a client can no
 * longer merge ids, organization, ownership, created_at/created_by, derived status, days_remaining, file URLs and the like into a
 * stored record. Values keep the shapes the handlers already tolerate (numbers may arrive as numeric strings; `null` clears
 * an optional value). Only genuinely free-form payloads (AI analysis snapshots, due-diligence documents) are open records.
 */
import { z } from 'zod';

const s = (max: number) => z.string().max(max);
const optional = <T extends z.ZodType>(schema: T) => schema.nullish();
/** Present and not blank; the value itself is stored as sent (handlers already trim where they compare). */
const required = (max: number) => z.string().max(max).refine((value) => value.trim().length > 0, 'is required');
const date = z.string().max(40).regex(/^(\d{4}-\d{2}-\d{2}([T ].*)?)?$/, 'must be a YYYY-MM-DD date');
const requiredDate = required(40).regex(/^\d{4}-\d{2}-\d{2}([T ].*)?$/, 'must be a YYYY-MM-DD date');
/** A number, or text that Number() will read (forms and older clients send both). */
const numeric = z.union([z.number().finite(), s(64)]);
const stringList = (item = 200, count = 200) => z.array(s(item)).max(count);
const openRecord = z.record(z.string(), z.unknown());
const accessToken = optional(s(4096));
/** The version the client last read; a stale one is answered with 409 VERSION_CONFLICT. */
const versionField = optional(z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d{0,9}$/)]));
const analysis = { redline_analysis: optional(openRecord), redline_analyzed_at: optional(s(64)) };
const base64File = { fileName: optional(s(300)), fileData: optional(z.string()) };
const attachedFile = optional(z.object({ fileName: optional(s(300)), fileData: optional(z.string()) }));

/* ------------------------------ partners ------------------------------ */

const identifier = z.object({ scheme: optional(s(64)), value: optional(s(256)), country: optional(s(8)) });
const partnerFields = {
  codename: optional(s(200)),
  country: optional(s(8)),
  entity_type: optional(s(200)),
  identifiers: optional(z.array(identifier).max(100)),
  partner_type: optional(s(60)),
  pic_name: optional(s(500)),
  pic_email: optional(s(500)),
  pic_phone: optional(s(100)),
  pic_address: optional(s(2000)),
  pic_contact: optional(s(1000)),
  internal_pic: optional(s(300)),
  notes: optional(s(20_000)),
  tags: optional(z.union([stringList(), s(5000)])),
};
export const partnerCreateBody = z.object({ partner_name: required(300), ...partnerFields, ...analysis, accessToken });
export const partnerUpdateBody = z.object({
  partner_name: optional(s(300)),
  ...partnerFields,
  dd_documents: optional(z.array(openRecord).max(500)),
  version: versionField,
});

export const partnerUploadDdBody = z.object({
  docName: required(300),
  fileName: optional(s(300)),
  fileData: optional(z.string()),
  documentNumber: optional(s(200)),
  expiryDate: optional(s(40)),
  accessToken,
});
export const partnerDdFileDeleteBody = z.object({ docName: required(300), fileId: optional(s(200)) });

/* ------------------------------ contracts ------------------------------ */

const terminationFile = optional(openRecord);
const contractFields = {
  document_type: optional(s(80)),
  parent_contract_id: optional(s(100)),
  parent_contract_number: optional(s(200)),
  cooperation_categories: optional(stringList()),
  currency: optional(s(8)),
  contract_value: optional(numeric),
  contract_value_usd: optional(numeric),
  auto_renewal: optional(z.boolean()),
  notice_period_days: optional(numeric),
  notice_type_required: optional(s(60)),
  lifecycle_mode: optional(s(40)),
  termination_date: optional(date),
  termination_reason: optional(s(10_000)),
  termination_document_file: terminationFile,
  internal_pic: optional(s(300)),
  internal_notes: optional(s(20_000)),
  changed_fields: optional(stringList()),
  change_summary: optional(s(20_000)),
  ...base64File,
  ...analysis,
  accessToken,
};
/** `status` is accepted because older clients use it to request a termination; the stored status is always recomputed from the lifecycle. */
export const contractCreateBody = z.object({
  contract_number: required(200),
  contract_title: required(1000),
  partner_id: required(100),
  start_date: requiredDate,
  end_date: requiredDate,
  status: optional(s(40)),
  status_approval: optional(s(40)),
  ...contractFields,
});
export const contractUpdateBody = z.object({
  contract_number: optional(s(200)),
  contract_title: optional(s(1000)),
  partner_id: optional(s(100)),
  start_date: optional(date),
  end_date: optional(date),
  status: optional(s(40)),
  version: versionField,
  ...contractFields,
});

/* ------------------------------ insertion orders ------------------------------ */

const ioFields = {
  contract_id: optional(s(100)),
  media_channel: optional(s(300)),
  completion_date: optional(date),
  currency: optional(s(8)),
  io_value: optional(numeric),
  io_value_usd: optional(numeric),
  deliverables: optional(s(50_000)),
  unit: optional(s(60)),
  unit_price: optional(numeric),
  unit_quantity: optional(numeric),
  notice_period_days: optional(numeric),
  notice_type_required: optional(s(60)),
  ...base64File,
  ...analysis,
  accessToken,
};
export const ioCreateBody = z.object({
  io_number: required(200),
  io_title: required(1000),
  partner_id: required(100),
  start_date: requiredDate,
  end_date: requiredDate,
  pricing_model: required(200),
  charging_type: required(200),
  ...ioFields,
});
export const ioUpdateBody = z.object({
  io_number: optional(s(200)),
  io_title: optional(s(1000)),
  partner_id: optional(s(100)),
  start_date: optional(date),
  end_date: optional(date),
  pricing_model: optional(s(200)),
  charging_type: optional(s(200)),
  version: versionField,
  ...ioFields,
});

/* ------------------------------ spendings ------------------------------ */

const monthAllocation = z.object({ month: s(20), amount: numeric });
const spendingFields = {
  vendor_id: optional(s(100)),
  invoice_date: optional(date),
  invoice_month: optional(z.union([stringList(40, 60), s(400)])),
  invoice_title: optional(s(1000)),
  month_allocations: z.array(monthAllocation).max(60).optional(),
  invoice_description: optional(s(20_000)),
  currency: optional(s(8)),
  total_amount_usd: optional(numeric),
  bank_name: optional(s(300)),
  bank_account_number: optional(s(100)),
  bank_account_holder_name: optional(s(300)),
  invoice_file: attachedFile,
  billing_file: attachedFile,
  io_id: optional(s(100)),
  billed_quantity: optional(numeric),
  ...analysis,
  accessToken,
};
export const spendingCreateBody = z.object({
  vendor_name: required(500),
  invoice_number: required(200),
  total_amount: numeric,
  ...spendingFields,
});
export const spendingUpdateBody = z.object({
  vendor_name: optional(s(500)),
  invoice_number: optional(s(200)),
  total_amount: optional(numeric),
  version: versionField,
  ...spendingFields,
});

/* ------------------------------ evaluations ------------------------------ */

const evaluationFields = {
  partner_id: optional(s(100)),
  type_of_work: optional(s(500)),
  sla_score: optional(numeric),
  notes: optional(s(20_000)),
};
export const evaluationCreateBody = z.object({
  supplier_name: required(500),
  review_date: requiredDate,
  obligation_target: required(100),
  incident_frequency: required(100),
  communication: required(100),
  pricing: required(100),
  final_evaluation: required(200),
  ...evaluationFields,
  ...analysis,
});
export const evaluationUpdateBody = z.object({
  version: versionField,
  supplier_name: optional(s(500)),
  review_date: optional(date),
  obligation_target: optional(s(100)),
  incident_frequency: optional(s(100)),
  communication: optional(s(100)),
  pricing: optional(s(100)),
  final_evaluation: optional(s(200)),
  ...evaluationFields,
});

/* ------------------------------ AI and export helpers ------------------------------ */

/** JSON variants of the *-parse endpoints (the multipart variant is handled by multer). */
export const parseDocumentBody = z.object({ pdfBase64: optional(z.string()), fileBase64: optional(z.string()), model: optional(s(100)) });
export const partnerDdNotesBody = z.object({
  partner_name: optional(s(500)), country: optional(s(8)), entity_type: optional(s(200)), tags: optional(z.union([stringList(), s(5000)])),
  model: optional(s(100)), pdfBase64: optional(z.string()),
});
export const partnerReviewBody = z.object({ partner: optional(openRecord), model: optional(s(100)) });
export const evaluationReviewBody = z.object({ evaluation: optional(openRecord), snapshot: optional(openRecord), model: optional(s(100)) });
export const spendingReviewBody = z.object({
  spending: optional(openRecord), computed: optional(openRecord), flags: optional(openRecord), pdfBase64: optional(z.string()), model: optional(s(100)),
});
export const ioReviewBody = z.object({ io: optional(openRecord), model: optional(s(100)) });
export const contractReviewBody = z.object({
  contract: optional(openRecord), customClauseText: optional(s(20_000)), force: optional(z.boolean()), model: optional(s(100)),
});
export const exportGoogleDocsBody = z.object({
  title: optional(s(500)), docTitle: optional(s(500)),
  contentHtml: optional(z.string()), htmlContent: optional(z.string()), html: optional(z.string()),
  partnerName: optional(s(500)), partner_name: optional(s(500)), partnerId: optional(s(200)),
  accessToken,
});
