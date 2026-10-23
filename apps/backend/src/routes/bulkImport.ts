import { BULK_DATE_FIELDS, bulkDate, bulkNumber } from '@legalio/shared/bulkParse';
import { getRequestTenantId, isMatchingOrg, scopeOf, addActivityLog } from '../recordAccess';
import { tenantDefaultCurrency, normalizePartnerDocuments, computeDueDiligenceStatus } from '../tenantPolicy';
import { db, generateNextPartnerId, sanitizeCountryCode, sanitizeIdentifiers, sanitizePartnerTags, generateNextContractId, generateNextIOId, generateNextSpendingId } from '../memoryDb';
import { normalizeCurrencyCode, convertToUsdWithFallback } from '@legalio/shared/currencyUtils';
import { computeEvaluationScore } from '../evaluationScoring';
import { normalizeSpendingMonths } from '../spendingMonths';
import { recalculateStatuses } from '../reminderJobs';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { componentLog } from '../logger';
const log = componentLog('bulkImport');

export function createBulkImportRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

/** Bulk-import row failure text: the cause is logged, the response carries only the row's generic message. */
function bulkRowFailure(err: unknown, fallback: string) {
  log.warn("[bulk-import] row failed:", err);
  return fallback;
}
/** Case-insensitive match against an allowed list: "" when blank, null when not allowed. */
function pickEnum(value: unknown, allowed: readonly string[]): string | null {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return allowed.find((item) => item.toLowerCase() === text.toLowerCase()) ?? null;
}
const bulkSplitList = (value: unknown) => String(value ?? "").split(/[;,|]/).map((item) => item.trim()).filter(Boolean);
const bulkBool = (value: unknown) => /^(1|true|ya|yes|y)$/i.test(String(value ?? "").trim());
const BULK_PRICING_MODELS = ["CPM", "CPC", "CPA", "Fixed", "Retainer", "Hourly", "Milestone", "Commission", "Subscription"];
const BULK_NOTICE_TYPES = ["Termination", "Extension", "Both", "None"];
const BULK_ENUMS = {
  document_type: ["Master Agreement", "Agreement Addendum"],
  status_approval: ["Draft", "Review", "Signed", "Active"],
  charging_type: ["Prepaid", "Postpaid", "Milestone-based"],
  obligation_target: ["Sangat baik", "Baik", "Kurang baik", "Met", "Not met"],
  incident_frequency: ["Never", "Rare", "Frequent"],
  communication: ["Sangat baik", "Baik", "Kurang baik", "Good", "Poor/Needs Improvement"],
  pricing: ["Cheap", "Moderate", "Expensive"],
  final_evaluation: ["Recommended", "Recommended with notes", "Not recommended", "Not reviewed"],
};
app.post("/api/bulk-import", async (req: express.Request, res: express.Response) => {
  const {
    type,
    rows: rawRows,
    defaultDepartment,
    overrideDepartment,
  } = req.body;
  if (!type || !Array.isArray(rawRows) || rawRows.length === 0) {
    return res
      .status(400)
      .json({ error: "Tipe data dan baris tidak boleh kosong." });
  }
  // Spreadsheet cells arrive as numbers or booleans as often as text, and dates in local formats.
  const invalidDates = new Map<number, string>();
  const rows = rawRows.map((raw, i) => {
    const row: Record<string, any> = {};
    for (const [key, value] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
      row[key] = typeof value === "number" || typeof value === "boolean" ? String(value) : value;
    }
    for (const field of BULK_DATE_FIELDS) {
      if (!(field in row)) continue;
      const normalized = bulkDate(row[field]);
      if (normalized === null) invalidDates.set(i, `${field} harus berformat YYYY-MM-DD atau DD/MM/YYYY.`);
      else row[field] = normalized;
    }
    return row;
  });
  const tenantId = getRequestTenantId(req);
  const tenantCurrency = tenantDefaultCurrency(tenantId);
  const inTenant = (row: any) => isMatchingOrg(row?.organizationId, tenantId);
  const succeeded = [];
  const skipped = [];
  const failed = [];
  const now = new Date().toISOString();
  const defDept =
    typeof defaultDepartment === "string" ? defaultDepartment.trim() : "";
  const forceDept = Boolean(overrideDepartment) && Boolean(defDept);
  if (type === "partners") {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = i + 2;
      if (invalidDates.has(i)) {
        failed.push({ rowIndex, identifier: `Baris ${rowIndex}`, message: invalidDates.get(i)! });
        continue;
      }
      const name = (row.partner_name || "").trim();
      if (!name) {
        failed.push({
          rowIndex,
          identifier: `Baris ${rowIndex}`,
          message: "Kolom partner_name wajib diisi.",
        });
        continue;
      }
      const exists = db.partners.find(
        (p) => inTenant(p) && inTenant(p) && p.partner_name?.toLowerCase() === name.toLowerCase(),
      );
      if (exists) {
        skipped.push({
          rowIndex,
          identifier: name,
          message: `Partner dengan nama "${name}" sudah ada (ID: ${exists.partner_id}).`,
        });
        continue;
      }
      try {
        const partnerChannel = (
          row.partner_channel ||
          row.codename ||
          row.channel ||
          row.nama_channel ||
          ""
        ).trim();
        let internalPic = (
          row.internal_pic ||
          row.internal_pic ||
          row.picInternal ||
          ""
        ).trim();
        if (forceDept) {
          internalPic = defDept;
        } else if (!internalPic && defDept) {
          internalPic = defDept;
        }
        // Imported references must resolve inside the selected organization (PRD §4.5.2).
        if (internalPic && !scopeOf(req).teamOf(internalPic)) {
          failed.push({ rowIndex, identifier: name, message: `Department "${internalPic}" does not exist in this organization.` });
          continue;
        }
        const fullKontakPic =
          row.pic_contact ||
          (row.pic_email || row.pic_phone
            ? `${(row.pic_email || "").trim()} / ${(row.pic_phone || "").trim()}`
            : "");
        const newPartner = {
          partner_id: generateNextPartnerId(),
          partner_name: name,
          codename: partnerChannel,
          partner_channel: partnerChannel,
          internal_pic: internalPic,
          partner_type: row.partner_type || "Vendor",
          pic_name: row.pic_name || "",
          pic_email: row.pic_email || "",
          pic_phone: row.pic_phone || "",
          pic_address: row.pic_address || "",
          pic_contact: fullKontakPic,
          organizationId: tenantId,
          country: sanitizeCountryCode(row.country) || (row.legal_status_flag === "BHI" ? "ID" : ""),
          entity_type: String(row.entity_type || "").slice(0, 120),
          identifiers: sanitizeIdentifiers(
            bulkSplitList(row.identifiers).map((pair) => {
              const at = pair.indexOf(":");
              return { scheme: at > 0 ? pair.slice(0, at).trim() : "other", value: at > 0 ? pair.slice(at + 1).trim() : pair, country: row.country };
            }),
          ),
          status_dd: "Incomplete",
          notes: row.notes || "",
          tags: sanitizePartnerTags(row.tags),
          dd_documents: [],
          created_at: now,
          updated_at: now,
        };
        newPartner.dd_documents = normalizePartnerDocuments(newPartner);
        newPartner.status_dd = computeDueDiligenceStatus(newPartner.dd_documents);
        db.partners.push(newPartner);
        succeeded.push({
          rowIndex,
          identifier: name,
          message: `Partner berhasil dibuat (ID: ${newPartner.partner_id}).`,
        });
      } catch (err) {
        failed.push({
          rowIndex,
          identifier: name,
          message: bulkRowFailure(err, "Gagal membuat partner."),
        });
      }
    }
  } else if (type === "contracts") {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = i + 2;
      if (invalidDates.has(i)) {
        failed.push({ rowIndex, identifier: `Baris ${rowIndex}`, message: invalidDates.get(i)! });
        continue;
      }
      const nomor = (row.contract_number || "").trim();
      if (!nomor) {
        failed.push({
          rowIndex,
          identifier: `Baris ${rowIndex}`,
          message: "Kolom contract_number wajib diisi.",
        });
        continue;
      }
      const exists = db.contracts.find(
        (c) => inTenant(c) && c.contract_number?.toLowerCase() === nomor.toLowerCase(),
      );
      if (exists) {
        skipped.push({
          rowIndex,
          identifier: nomor,
          message: `Kontrak "${nomor}" sudah ada (ID: ${exists.contract_id}).`,
        });
        continue;
      }
      const partnerNama = (row.partner_name || "").trim();
      const partner = db.partners.find(
        (p) => inTenant(p) && p.partner_name?.toLowerCase() === partnerNama.toLowerCase(),
      );
      if (!partner) {
        failed.push({ rowIndex, identifier: nomor, message: `Partner "${partnerNama}" tidak ditemukan. Impor partner lebih dulu atau samakan nama persis dengan data Partner.` });
        continue;
      }
      try {
        const kategori = bulkSplitList(row.cooperation_categories);
        const jenisDokumen = pickEnum(row.document_type, BULK_ENUMS.document_type);
        const statusApproval = pickEnum(row.status_approval, BULK_ENUMS.status_approval);
        const noticeType = pickEnum(row.notice_type_required, BULK_NOTICE_TYPES);
        const invalid = jenisDokumen === null ? `document_type harus salah satu dari: ${BULK_ENUMS.document_type.join(", ")}.`
          : statusApproval === null ? `status_approval harus salah satu dari: ${BULK_ENUMS.status_approval.join(", ")}.`
          : noticeType === null ? `notice_type_required harus salah satu dari: ${BULK_NOTICE_TYPES.join(", ")}.`
          : "";
        if (invalid) {
          failed.push({ rowIndex, identifier: nomor, message: invalid });
          continue;
        }
        const parentNomor = (row.parent_contract_number || "").trim();
        const parentContract = parentNomor
          ? db.contracts.find((c) => inTenant(c) && c.contract_number?.toLowerCase() === parentNomor.toLowerCase())
          : null;
        if (parentNomor && !parentContract) {
          failed.push({ rowIndex, identifier: nomor, message: `Kontrak induk "${parentNomor}" tidak ditemukan. Impor kontrak induk lebih dulu.` });
          continue;
        }
        let contractPic = (row.internal_pic || "").trim();
        if (forceDept) {
          contractPic = defDept;
        } else if (!contractPic && defDept) {
          contractPic = defDept;
        } else if (!contractPic && partner?.internal_pic) {
          contractPic = partner.internal_pic;
        }
        if (contractPic && !scopeOf(req).teamOf(contractPic)) {
          failed.push({ rowIndex, identifier: nomor, message: `Department "${contractPic}" does not exist in this organization.` });
          continue;
        }
        const newContract = {
          contract_id: generateNextContractId(),
          organizationId: tenantId,
          contract_number: nomor,
          contract_title: row.contract_title || nomor,
          partner_id: partner.partner_id,
          document_type: jenisDokumen || "Master Agreement",
          ...(parentContract ? { parent_contract_id: parentContract.contract_id, parent_contract_number: parentContract.contract_number } : {}),
          cooperation_categories: kategori,
          start_date: row.start_date || "",
          end_date: row.end_date || "",
          currency: normalizeCurrencyCode(row.currency, tenantCurrency),
          contract_value: bulkNumber(row.contract_value),
          auto_renewal: bulkBool(row.auto_renewal),
          notice_period_days: parseInt(row.notice_period_days) || 30,
          notice_type_required: noticeType || "Both",
          internal_pic: contractPic,
          internal_notes: row.internal_notes || "",
          status: "Active",
          status_approval: statusApproval || "Signed",
          created_at: now,
          updated_at: now,
        };
        db.contracts.push(newContract);
        succeeded.push({
          rowIndex,
          identifier: nomor,
          message: `Kontrak berhasil dibuat (ID: ${newContract.contract_id}).`,
        });
      } catch (err) {
        failed.push({
          rowIndex,
          identifier: nomor,
          message: bulkRowFailure(err, "Gagal membuat kontrak."),
        });
      }
    }
  } else if (type === "ios") {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = i + 2;
      if (invalidDates.has(i)) {
        failed.push({ rowIndex, identifier: `Baris ${rowIndex}`, message: invalidDates.get(i)! });
        continue;
      }
      const nomor = (row.io_number || "").trim();
      if (!nomor) {
        failed.push({
          rowIndex,
          identifier: `Baris ${rowIndex}`,
          message: "Kolom io_number wajib diisi.",
        });
        continue;
      }
      const exists = db.ios.find(
        (io) => inTenant(io) && io.io_number?.toLowerCase() === nomor.toLowerCase(),
      );
      if (exists) {
        skipped.push({
          rowIndex,
          identifier: nomor,
          message: `IO "${nomor}" sudah ada (ID: ${exists.io_id}).`,
        });
        continue;
      }
      const partnerNama = (row.partner_name || "").trim();
      const partner = db.partners.find(
        (p) => inTenant(p) && p.partner_name?.toLowerCase() === partnerNama.toLowerCase(),
      );
      if (!partner) {
        failed.push({ rowIndex, identifier: nomor, message: `Partner "${partnerNama}" tidak ditemukan. Impor partner lebih dulu atau samakan nama persis dengan data Partner.` });
        continue;
      }
      const contractNomor = (row.contract_number || "").trim();
      const contract = db.contracts.find(
        (c) => inTenant(c) && c.contract_number?.toLowerCase() === contractNomor.toLowerCase(),
      );
      const chargingType = pickEnum(row.charging_type, BULK_ENUMS.charging_type);
      const noticeTypeIo = pickEnum(row.notice_type_required, BULK_NOTICE_TYPES);
      if (chargingType === null || noticeTypeIo === null) {
        failed.push({
          rowIndex,
          identifier: nomor,
          message: chargingType === null
            ? `charging_type harus salah satu dari: ${BULK_ENUMS.charging_type.join(", ")}.`
            : `notice_type_required harus salah satu dari: ${BULK_NOTICE_TYPES.join(", ")}.`,
        });
        continue;
      }
      try {
        const newIO = {
          io_id: generateNextIOId(),
          organizationId: tenantId,
          io_number: nomor,
          io_title: row.io_title || nomor,
          partner_id: partner.partner_id,
          contract_id: contract?.contract_id || "",
          media_channel: row.media_channel || "",
          start_date: row.start_date || "",
          end_date: row.end_date || "",
          // Standard models are normalised ("cpm" -> "CPM"); anything else is kept as a custom model.
          pricing_model: pickEnum(row.pricing_model, BULK_PRICING_MODELS) || String(row.pricing_model || "").trim() || "Fixed",
          charging_type: chargingType || "Prepaid",
          currency: normalizeCurrencyCode(row.currency, tenantCurrency),
          io_value: bulkNumber(row.io_value),
          deliverables: row.deliverables || "",
          notice_period_days: parseInt(row.notice_period_days) || 14,
          notice_type_required: noticeTypeIo || "Termination",
          internal_notes: row.internal_notes || "",
          status: "Active",
          created_at: now,
          updated_at: now,
        };
        db.ios.push(newIO);
        succeeded.push({
          rowIndex,
          identifier: nomor,
          message: `IO berhasil dibuat (ID: ${newIO.io_id}).`,
        });
      } catch (err) {
        failed.push({
          rowIndex,
          identifier: nomor,
          message: err.message || "Gagal membuat IO.",
        });
      }
    }
  } else if (type === "evaluations") {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = i + 2;
      if (invalidDates.has(i)) {
        failed.push({ rowIndex, identifier: `Baris ${rowIndex}`, message: invalidDates.get(i)! });
        continue;
      }
      const supplierName = (row.supplier_name || "").trim();
      const reviewDate = (row.review_date || "").trim();
      if (!supplierName || !reviewDate) {
        failed.push({
          rowIndex,
          identifier: `Baris ${rowIndex}`,
          message: "Kolom supplier_name dan review_date wajib diisi.",
        });
        continue;
      }
      const identifier = `${supplierName} \u2014 ${reviewDate}`;
      const exists = db.evaluations.find(
        (e) =>
          inTenant(e) &&
          e.supplier_name?.toLowerCase() === supplierName.toLowerCase() &&
          e.review_date === reviewDate,
      );
      if (exists) {
        skipped.push({
          rowIndex,
          identifier,
          message: `Evaluasi untuk "${supplierName}" pada ${reviewDate} sudah ada.`,
        });
        continue;
      }
      const partner = db.partners.find(
        (p) => inTenant(p) && p.partner_name?.toLowerCase() === supplierName.toLowerCase(),
      );
      const picks = {
        obligation_target: pickEnum(row.obligation_target, BULK_ENUMS.obligation_target),
        incident_frequency: pickEnum(row.incident_frequency, BULK_ENUMS.incident_frequency),
        communication: pickEnum(row.communication, BULK_ENUMS.communication),
        pricing: pickEnum(row.pricing, BULK_ENUMS.pricing),
        final_evaluation: pickEnum(row.final_evaluation, BULK_ENUMS.final_evaluation),
      } as const;
      const badField = (Object.keys(picks) as Array<keyof typeof picks>).find((key) => !picks[key]);
      if (badField) {
        failed.push({
          rowIndex,
          identifier,
          message: `${badField} wajib diisi dengan salah satu dari: ${BULK_ENUMS[badField].join(", ")}.`,
        });
        continue;
      }
      try {
        const year = (reviewDate.match(/^\d{4}/) || [String(new Date().getFullYear())])[0];
        const newEval = {
          id: `EVAL-${year}-${String(db.evaluations.length + 1).padStart(3, "0")}`,
          organizationId: tenantId,
          review_date: reviewDate,
          year,
          partner_id: partner?.partner_id || "",
          supplier_name: supplierName,
          type_of_work: (row.type_of_work || "General Service").trim(),
          sla_score: parseFloat(row.sla_score) || 60,
          ...picks,
          notes: row.notes || "",
          calculated_score: computeEvaluationScore(picks.obligation_target, picks.incident_frequency, picks.communication, picks.pricing),
          evaluator_email: (req as any).identity?.email || "system",
          evaluator_name: (req as any).identity?.name || "System",
          created_at: now,
          updated_at: now,
        };
        db.evaluations.push(newEval);
        succeeded.push({
          rowIndex,
          identifier,
          message: `Evaluasi berhasil dibuat (ID: ${newEval.id}).`,
        });
      } catch (err) {
        failed.push({
          rowIndex,
          identifier,
          message: bulkRowFailure(err, "Gagal membuat evaluasi."),
        });
      }
    }
  } else if (type === "spendings") {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = i + 2;
      if (invalidDates.has(i)) {
        failed.push({ rowIndex, identifier: `Baris ${rowIndex}`, message: invalidDates.get(i)! });
        continue;
      }
      const invoiceNumber = (row.invoice_number || "").trim();
      const vendorName = (row.vendor_name || "").trim();
      if (!invoiceNumber || !vendorName) {
        failed.push({
          rowIndex,
          identifier: `Baris ${rowIndex}`,
          message: "Kolom invoice_number dan vendor_name wajib diisi.",
        });
        continue;
      }
      const identifier = `${vendorName} \u2014 ${invoiceNumber}`;
      const exists = db.spendings.find(
        (s) => inTenant(s) &&
          s.invoice_number?.toLowerCase() === invoiceNumber.toLowerCase() &&
          s.vendor_name?.toLowerCase() === vendorName.toLowerCase(),
      );
      if (exists) {
        skipped.push({
          rowIndex,
          identifier,
          message: `Invoice "${invoiceNumber}" untuk "${vendorName}" sudah ada (ID: ${exists.id}).`,
        });
        continue;
      }
      const partner = db.partners.find(
        (p) => inTenant(p) && p.partner_name?.toLowerCase() === vendorName.toLowerCase(),
      );
      try {
        const invoiceMonth = normalizeSpendingMonths(row.invoice_month);
        const totalAmount = bulkNumber(row.total_amount);
        const currency = normalizeCurrencyCode(row.currency, tenantCurrency);
        const newSpending = {
          id: generateNextSpendingId(),
          organizationId: tenantId,
          vendor_id: partner?.partner_id || "",
          vendor_name: vendorName,
          invoice_number: invoiceNumber,
          invoice_date: row.invoice_date || "",
          invoice_month: invoiceMonth,
          invoice_description: row.invoice_description || "",
          currency,
          total_amount: totalAmount,
          total_amount_usd: currency === "USD" ? totalAmount : Math.round(convertToUsdWithFallback(totalAmount, currency) * 100) / 100,
          invoice_title: row.invoice_title || "",
          payment_status: String(row.payment_status || "").trim(),
          bank_name: row.bank_name || "",
          bank_account_number: row.bank_account_number || "",
          bank_account_holder_name: row.bank_account_holder_name || "",
        };
        db.spendings.push(newSpending);
        succeeded.push({
          rowIndex,
          identifier,
          message: `Spending berhasil dibuat (ID: ${newSpending.id}).`,
        });
      } catch (err) {
        failed.push({
          rowIndex,
          identifier,
          message: bulkRowFailure(err, "Gagal membuat spending."),
        });
      }
    }
  } else {
    return res
      .status(400)
      .json({ error: `Tipe import tidak dikenal: ${type}` });
  }
  await recalculateStatuses(); // once per import: it saves the whole database
  const totalSucceeded = succeeded.length;
  if (totalSucceeded > 0) {
    await addActivityLog(
      "system", "System", "User", "BULK_IMPORT", type.toUpperCase(),
      `Bulk import ${type}: ${totalSucceeded} berhasil, ${skipped.length} dilewati, ${failed.length} gagal.`,
      req,
    );
  }
  return res.json({ succeeded, skipped, failed });
});
  return app;
}
