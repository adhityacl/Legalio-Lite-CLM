import { partnerRepository } from '../repositories/partnerRepository';
import { nextEntityId } from '../ids';
import { pageRows, type ListSpec } from '../listQuery';
import { contractRepository } from '../repositories/contractRepository';
import { normalizeSpendingMonths } from '../spendingMonths';
import * as bodySchemas from '../schemas';
import { scopedRecords, getRequestTenantId, assertRecordAccess, assertRecordWritable, logActivity } from '../recordAccess';
import { db, countryNameForPrompt, saveDb, triggerAutoPushToGoogleSheet } from '../memoryDb';
import { normalizeCurrencyCode, convertToUsdWithFallback, getDefaultUsdRate } from '@legalio/shared/currencyUtils';
import { tenantDefaultCurrency, aiPolicyContext, findTenant } from '../tenantPolicy';
import { upload } from '../uploadMiddleware';
import { ensureAiAvailable, getValidAiModel, generateContentWithRetryAndFallback, withDocumentTranscriptField, extractAndCacheDocumentTranscript } from '../aiClient';
import { computeInputSha256, globalOcrCache, buildCheapOcrContents } from '../lib/cheapOcrPipeline';
import { Type } from '@google/genai';
import { normalizeParsedDate } from '../documentParsing';
import { sendRouteError } from '../apiErrors';
import { generateRedlineAnalysis } from '../redlineAnalysis';
import { validateBody } from '../validation';
import { validateSpendingAllocations, allocationInvoiceMonths } from '@legalio/shared/spendingAllocations';
import { resolveActiveGoogleToken } from '../googleDrive';
import { getHistoricalExchangeRate } from '@legalio/shared/currencyRates';
import { formatInvoiceFileName, formatBillingFileName } from '@legalio/shared/fileNaming';
import { saveUpload } from '../uploadStorage';
import { formatAmountForTenant } from '../mailHelpers';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { componentLog } from '../logger';
const log = componentLog('spendings');
const __name = <T>(target: T, value: string): T => Object.defineProperty(target, "name", { value, configurable: true });

export function createSpendingsRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

const SPENDING_LIST: ListSpec<any> = {
  search: ["vendor_name", "invoice_number", "invoice_title", "invoice_description", "payment_status", "id"],
  sorts: { invoice_date: (s) => String(s.invoice_date ?? ""), vendor_name: (s) => String(s.vendor_name ?? "").toLowerCase(), total_amount_usd: (s) => Number(s.total_amount_usd) || 0, created_at: (s) => String(s.created_at ?? "") },
  filters: ["payment_status", "vendor_id", "currency"],
};
app.get("/api/partner-spendings", async (req: express.Request, res: express.Response) => {
  const spendingsList = await scopedRecords(req, "spending");
  const list = spendingsList.map((s) => {
    if (s.total_amount_usd === void 0 || s.total_amount_usd === null) {
      const amt = Number(s.total_amount) || 0;
      const cur = normalizeCurrencyCode(s.currency, tenantDefaultCurrency(s.organizationId));
      const usdVal =
        cur === "USD"
          ? amt
          : convertToUsdWithFallback(amt, cur);
      return { ...s, total_amount_usd: usdVal };
    }
    return s;
  });
  res.json(pageRows(req, res, list, SPENDING_LIST) ?? list);
});
app.post("/api/spendings/parse", upload.single("file") as any, async (req: express.Request, res: express.Response) => {
  if (!(await ensureAiAvailable(req, res))) return;
  try {
    const inputData = req.file?.buffer || req.body?.pdfBase64 || req.body?.fileBase64;
    const model = req.body?.model;
    if (!inputData) {
      return res.status(400).json({ error: "File (binary or base64) is required" });
    }

    const tenantId = getRequestTenantId(req);
    const inputHash = computeInputSha256(inputData);
    const cacheScope = `spendings:v2-explicit-period:${tenantId}`;
    const cached = await globalOcrCache.get(inputHash, cacheScope);
    if (cached) {
      return res.json({
        ...cached,
        cached: true,
      });
    }

    const ctx = aiPolicyContext(tenantId);
    const prompt = `You are an expert OCR and data-extraction assistant processing a B2B invoice or billing document received by ${ctx.organizationName}. Extract:

1. "invoice_number": the official invoice number exactly as printed.
2. "invoice_date": the issue date, converted to ISO 8601 "YYYY-MM-DD".
3. "spending_months": all months in an explicitly printed billing/service/spending period, as an array of "YYYY-MM" strings. Expand a printed range (e.g. October–December 2026) into every covered month. Return [] when no period is printed. NEVER infer a spending month from invoice_date or the issue date.
   "invoice_month": the first explicitly identified spending month, or "" if none.
   "month_allocations": an array of {"month": "YYYY-MM", "amount": number}, ONLY for per-month amounts explicitly printed in that period. Return [] when amounts are not specified. Do not invent an equal split.
4. "invoice_description": every line-item description from the invoice table, joined with newline characters ("\n"), verbatim.
5. "currency": the ISO 4217 three-letter currency code of the invoice total (e.g. "USD", "SGD", "INR", "JPY"). If only a symbol is shown, infer the code from the issuer's country; default to "${ctx.defaultCurrency}" when still unclear.
6. "total_amount": the final invoice total as a plain number, without symbols or thousands separators.
7. "bank_name": the beneficiary bank name only.
8. "account_number": the beneficiary account number or IBAN exactly as printed, keeping separators.
9. "account_holder": the beneficiary account name exactly as printed.
10. "invoice_title": a short invoice/service title when present; keep it separate from the full line-item description. Use "" when absent.

Return strictly one valid JSON object matching the schema. Use an empty string "" for any text field that is not present.`;
    const { contents: ocrContents, ocrStats } = await buildCheapOcrContents(
      inputData,
      prompt,
    );
    log.info(
      `[PDF-Inspector Spending Parser] Mode: ${ocrStats.mode.toUpperCase()} (${ocrStats.classification}), Inspected in ${ocrStats.inspectionMs}ms, Pages: ${ocrStats.originalPages} (${ocrStats.originalKb}KB) -> ${ocrStats.processedPages} (${ocrStats.optimizedKb}KB), DigitalText: ${ocrStats.hasDigitalText}, Hash: ${ocrStats.fileHash.slice(0, 8)}`,
    );
    const selectedModel = getValidAiModel(model);
    const response = await generateContentWithRetryAndFallback({
      model: selectedModel,
      contents: ocrContents,
      config: {
        responseMimeType: "application/json",
        responseSchema: withDocumentTranscriptField(
          {
            type: Type.OBJECT,
            properties: {
              invoice_number: { type: Type.STRING },
              invoice_date: { type: Type.STRING },
              invoice_month: { type: Type.STRING },
              invoice_title: { type: Type.STRING },
              spending_months: { type: Type.ARRAY, items: { type: Type.STRING } },
              month_allocations: { type: Type.ARRAY, items: {
                type: Type.OBJECT, properties: { month: { type: Type.STRING }, amount: { type: Type.NUMBER } },
              } },
              invoice_description: { type: Type.STRING },
              currency: { type: Type.STRING },
              total_amount: { type: Type.NUMBER },
              bank_name: { type: Type.STRING },
              account_number: { type: Type.STRING },
              account_holder: { type: Type.STRING },
            },
          },
          ocrStats.mode,
        ),
      },
    });
    const parsedData = JSON.parse((response as any).text);
    await extractAndCacheDocumentTranscript(parsedData, ocrStats.fileHash);
    if (parsedData.invoice_date) {
      parsedData.invoice_date = normalizeParsedDate(parsedData.invoice_date);
    }
    const responsePayload = { success: true, data: parsedData, ocrStats };
    if (ocrStats.fileHash) {
      await globalOcrCache.set(ocrStats.fileHash, cacheScope, responsePayload);
    }
    res.json(responsePayload);
  } catch (error) {
    log.error("Error parsing Spending:", error);
    sendRouteError(req, res, error, "request failed", "Failed to parse Spending document. Google AI model is currently busy, please try again.", { status: 500 });
  }
});
/** AI review of the spending (invoice) form's current values before payment; an existing spending stores the result right away. */
app.post("/api/spendings/review-analysis", async (req: express.Request, res: express.Response) => {
  const draft = req.body?.spending;
  if (!draft || typeof draft !== "object") return res.status(400).json({ error: "Spending data is required." });
  const organizationId = getRequestTenantId(req);
  const saved = draft.id ? (db.spendings || []).find((s) => s.id === String(draft.id)) : undefined;
  if (draft.id && (!saved || assertRecordAccess(req, "spending", saved) || assertRecordWritable(req, "spending", saved))) {
    return res.status(404).json({ error: "Data spending tidak ditemukan." });
  }
  const partner = await partnerRepository.get(organizationId, String(draft.vendor_id ?? ""));
  const visiblePartner = partner && !assertRecordAccess(req, "partner", partner) ? partner : undefined;
  const so = draft.io_id ? db.ios.find((io) => io.io_id === String(draft.io_id)) : undefined;
  const visibleSo = so && !assertRecordAccess(req, "io", so) ? so : undefined;
  const parent = visibleSo?.contract_id ? await contractRepository.get(organizationId, visibleSo.contract_id) : undefined;
  if (!(await ensureAiAvailable(req, res))) return;
  const text = (v: unknown, max = 2000) => (v == null || v === "" ? "-" : String(v).slice(0, max));
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const c = req.body.computed && typeof req.body.computed === "object" ? req.body.computed : {};
  const flags = req.body.flags && typeof req.body.flags === "object" ? req.body.flags : {};
  const allocations = Array.isArray(draft.month_allocations) ? draft.month_allocations.slice(0, 36).map((a: any) => `${text(a?.month, 7)}: ${num(a?.amount) ?? "-"}`).join(", ") : "-";
  const pdf = typeof req.body.pdfBase64 === "string" && req.body.pdfBase64.length < 20 * 1024 * 1024 ? req.body.pdfBase64 : undefined;
  const ctx = aiPolicyContext(organizationId);
  const prompt = `You are a senior accounts-payable controller and procurement auditor acting for ${ctx.organizationName}, a ${ctx.industryName} organization in ${ctx.countryName}.
Review the vendor invoice below BEFORE payment and recommend concrete actions. Write every narrative field (titles, summary, findings, actions and notes) in English.

=== INVOICE (as typed in the form) ===
Vendor: ${text(draft.vendor_name, 300)}${visiblePartner?.country ? ` (${countryNameForPrompt(visiblePartner.country)})` : ""}; vendor due-diligence status: ${visiblePartner?.status_dd || "unknown"}
Invoice number: ${text(draft.invoice_number, 120)}; invoice date: ${text(draft.invoice_date, 20)}
Title: ${text(draft.invoice_title, 300)}
Description: ${text(draft.invoice_description)}
Amount: ${text(draft.currency, 8)} ${num(draft.total_amount) ?? "-"}; monthly allocation: ${allocations}
Units billed (as typed): ${num(draft.billed_quantity) ?? "not given"}
Bank details: ${flags.bank_changed ? "CHANGED compared with this vendor's previous invoices" : "same as previous invoices or no history"}; account holder ${flags.holder_mismatch ? "does NOT match the vendor name" : "matches the vendor name or is empty"}. (Account numbers are deliberately withheld.)
${visibleSo ? `
=== LINKED SERVICE ORDER ===
${text(visibleSo.io_number, 120)} — ${text(visibleSo.io_title, 300)}${parent ? ` (under contract ${parent.contract_number})` : ""}
Period: ${visibleSo.start_date} to ${visibleSo.end_date}; value: ${visibleSo.currency || "-"} ${Number(visibleSo.io_value || 0)}
Pricing: ${text(visibleSo.pricing_model, 60)}${visibleSo.unit_price ? `, ${visibleSo.currency || ""} ${visibleSo.unit_price} per ${visibleSo.pricing_model === "CPM" ? "1,000 " : ""}${visibleSo.unit || "unit"}` : ", no unit price recorded"}${visibleSo.unit_quantity ? `; agreed quantity ${visibleSo.unit_quantity} ${visibleSo.unit || "units"}` : ""}
Deliverables: ${text(visibleSo.deliverables)}` : "\nNo service order is linked to this invoice."}

=== SYSTEM CALCULATIONS (already computed — use these numbers, do not recompute) ===
Expected units for this invoice at the SO unit price: ${num(c.expectedUnits) ?? "n/a"}
Units billed: ${num(c.billedUnits) ?? "n/a"}; shortfall vs expected: ${num(c.shortfallPct) != null ? `${num(c.shortfallPct)}%` : "n/a"}
SO budget used including this invoice: ${num(c.budgetUsedPct) != null ? `${num(c.budgetUsedPct)}%` : "n/a"}; SO period elapsed at invoice date: ${num(c.elapsedPct) != null ? `${num(c.elapsedPct)}%` : "n/a"}
Remaining SO budget: ${num(c.remainingBudget) ?? "n/a"}; remaining units: ${num(c.remainingUnits) ?? "n/a"}
${pdf ? "\nThe invoice document is attached: compare its amount, invoice number, date, currency, units, bank details and tax lines with the typed values above and report every mismatch." : "\nNo invoice document is attached; say so when a finding would need it."}

=== REVIEW INSTRUCTIONS ===
Assess: whether what is billed is covered by the linked SO / contract scope; under-delivery or over-billing using the system calculations; billing ahead of schedule; tax treatment (${ctx.indirectTaxName}, withholding tax, tax-treaty documents for foreign vendors, valid tax invoice for local vendors: ${ctx.taxConsiderations.join(" ")}); payment fraud red flags (changed bank details, account holder mismatch); and duplicate-billing risk.
Never approve or reject payment — recommend checks and actions for Finance. Do not invent statute or regulation numbers.

Return JSON with exactly:
1. overallRiskScore: integer 0-100 (0-25 low, 26-55 moderate, 56-75 high, 76-100 critical).
2. riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL".
3. executiveSummary: one short paragraph on whether the invoice looks consistent with the agreement and what to check before paying.
4. keyFindings: 2-4 of the most important issues.
5. analyzedClauses: 2-5 items, each with clauseTitle (short topic), riskCategory, severity ("LOW"|"MEDIUM"|"HIGH"|"CRITICAL"), originalTextOrIssue (the finding, citing the numbers), identifiedRisk, recommendedRedline (the concrete recommended action, e.g. request a delivery report, ask for a make-good or credit note, withhold tax) and legalRationale.
6. complianceChecklist: 3-5 items, each with item, status ("COMPLIANT" | "NEEDS_REVIEW" | "NON_COMPLIANT") and notes.
`;
  try {
    const analysis = await generateRedlineAnalysis(req, prompt, pdf);
    if (saved) {
      saved.redline_analysis = analysis;
      saved.redline_analyzed_at = analysis.analyzed_at;
      saved.updated_at = analysis.analyzed_at;
      await saveDb();
    }
    res.json({ success: true, analysis, analyzed_at: analysis.analyzed_at, saved: Boolean(saved) });
  } catch (error) {
    log.error("Error during invoice review:", error);
    sendRouteError(req, res, error, "request failed", "Gagal melakukan analisis AI. Silakan coba kembali.", { status: 500 });
  }
});

app.post("/api/partner-spendings", validateBody(bodySchemas.spendingCreateBody, { requiredMessage: "Vendor Name, Invoice Number, and Total Amount are required." }), async (req: express.Request, res: express.Response) => {
  const {
    vendor_id,
    vendor_name,
    invoice_number,
    invoice_date,
    invoice_month,
    invoice_title,
    month_allocations,
    invoice_description,
    currency,
    total_amount,
    total_amount_usd: req_usd,
    bank_name,
    bank_account_number,
    bank_account_holder_name,
    invoice_file,
    billing_file,
  } = req.body;
  if (!vendor_name || !invoice_number || total_amount === void 0) {
    return res
      .status(400)
      .json({
        error: "Vendor Name, Invoice Number, and Total Amount are required.",
      });
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "month_allocations")) {
    const allocationError = validateSpendingAllocations(month_allocations, total_amount);
    if (allocationError) return res.status(400).json({ error: "Invalid spending month allocation.", allocation_error: allocationError });
  }
  const targetOrgId = getRequestTenantId(req);
  const targetTenant = findTenant(targetOrgId);
  const monthsArray = normalizeSpendingMonths(month_allocations !== undefined
    ? allocationInvoiceMonths(month_allocations) : invoice_month);
  const formattedMonthStr =
    monthsArray.length > 0 ? monthsArray.join("_") : "Month";
  const cleanVendorName = vendor_name.replace(/[/\\?%*:|"<>]/g, "").trim();
  let invoice_file_url = "";
  let invoice_file_name = "";
  let billing_file_url = "";
  let billing_file_name = "";
  const token = await resolveActiveGoogleToken(
    req.headers["x-google-access-token"] || req.body.accessToken,
  );
  let total_amount_usd = req_usd;
  if (
    total_amount_usd === void 0 ||
    total_amount_usd === null ||
    isNaN(Number(total_amount_usd))
  ) {
    const cur = normalizeCurrencyCode(currency, tenantDefaultCurrency(targetOrgId));
    const amt = Number(total_amount) || 0;
    if (cur === "USD") {
      total_amount_usd = amt;
    } else {
      let rate = getDefaultUsdRate(cur);
      try {
        const sheetId =
          targetTenant?.spreadsheetId || db.googleConfig?.spreadsheetId;
        rate = await getHistoricalExchangeRate(
          sheetId,
          token,
          cur,
          invoice_date,
        );
      } catch (e) {}
      total_amount_usd = Math.round(amt * rate * 100) / 100;
    }
  } else {
    total_amount_usd = Number(total_amount_usd);
  }
  // Only this organization's partners: another tenant's partner of the same name must never be linked or described.
  const partner = await partnerRepository.findByIdOrName(targetOrgId, vendor_id, vendor_name);
  if (invoice_file && invoice_file.fileData) {
    const targetInvoiceName = formatInvoiceFileName({
      partnerName: partner?.partner_name || vendor_name,
      invoiceMonth: monthsArray,
      invoiceNumber: invoice_number,
      invoiceDate: invoice_date || new Date().toISOString().split("T")[0],
      rawFileName: invoice_file.fileName,
    });
    invoice_file_name = targetInvoiceName;
    if (!invoice_file_url) {
      invoice_file_url = await saveUpload(
        partner?.partner_name || vendor_name,
        "Folder Invoice & Billing",
        targetInvoiceName,
        invoice_file.fileData,
        targetTenant?.id,
      );
      await logActivity(req, "UPLOAD_SUCCESS", "PARTNER", `File Invoice '${targetInvoiceName}' disimpan di server lokal aplikasi (dicadangkan ke Google Drive otomatis jika terhubung)`);
    }
  }
  if (billing_file && billing_file.fileData) {
    const targetBillingName = formatBillingFileName({
      partnerName: partner?.partner_name || vendor_name,
      invoiceMonth: monthsArray,
      invoiceNumber: invoice_number,
      invoiceDate: invoice_date || new Date().toISOString().split("T")[0],
      rawFileName: billing_file.fileName,
    });
    billing_file_name = targetBillingName;
    if (!billing_file_url) {
      billing_file_url = await saveUpload(
        partner?.partner_name || vendor_name,
        "Folder Invoice & Billing",
        targetBillingName,
        billing_file.fileData,
        targetTenant?.id,
      );
      await logActivity(req, "UPLOAD_SUCCESS", "PARTNER", `File Billing '${targetBillingName}' disimpan di server lokal aplikasi (dicadangkan ke Google Drive otomatis jika terhubung)`);
    }
  }
  const newSpending = {
    id: await nextEntityId("spending"),
    organizationId: targetOrgId,
    vendor_id: partner ? partner.partner_id : vendor_id || void 0,
    vendor_name,
    invoice_number,
    invoice_date: invoice_date || new Date().toISOString().split("T")[0],
    invoice_month: monthsArray,
    invoice_title: invoice_title || "",
    ...(month_allocations !== undefined ? { month_allocations: month_allocations.map(({ month, amount }) => ({ month, amount })) } : {}),
    invoice_description: invoice_description || "",
    currency: normalizeCurrencyCode(currency, tenantDefaultCurrency(targetOrgId)),
    total_amount: Number(total_amount) || 0,
    total_amount_usd,
    bank_name: bank_name || "",
    bank_account_number: bank_account_number || "",
    bank_account_holder_name: bank_account_holder_name || "",
    invoice_file_url,
    invoice_file_name,
    billing_file_url,
    billing_file_name,
    folder_link: partner ? partner.dd_folder_link : void 0,
    io_id: req.body.io_id && db.ios.some((io) => io.io_id === String(req.body.io_id) && io.organizationId === targetOrgId) ? String(req.body.io_id) : void 0,
    billed_quantity: Number(req.body.billed_quantity) > 0 ? Number(req.body.billed_quantity) : void 0,
    // Review run on the add page before the spending existed.
    redline_analysis: req.body.redline_analysis && typeof req.body.redline_analysis === "object" ? req.body.redline_analysis : void 0,
    redline_analyzed_at: req.body.redline_analysis && typeof req.body.redline_analysis === "object" ? String(req.body.redline_analyzed_at || new Date().toISOString()) : void 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.spendings = db.spendings || [];
  const writeDenial = assertRecordWritable(req, "spending", newSpending);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  db.spendings.unshift(newSpending);
  await saveDb();
  await logActivity(req, "CREATE", "PARTNER", `Menambahkan Catatan Partner Spending untuk '${vendor_name}' (Invoice #${invoice_number}) senilai ${formatAmountForTenant(total_amount, normalizeCurrencyCode(currency, tenantDefaultCurrency(targetOrgId)), targetOrgId)}`);
  await triggerAutoPushToGoogleSheet(req, { tenantId: targetOrgId });
  res.json({ success: true, spending: newSpending });
});
app.put("/api/partner-spendings/:id", validateBody(bodySchemas.spendingUpdateBody), async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const {
    invoice_file,
    billing_file,
    accessToken: _accessToken,
    ...updates
  } = req.body;
  const idx = (db.spendings || []).findIndex((s) => s.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Data spending tidak ditemukan." });
  }
  const existing = db.spendings[idx];
  const accessDenial = assertRecordAccess(req, "spending", existing);
  if (accessDenial) return res.status(accessDenial.status).json(accessDenial.body);
  const hasAllocations = Object.prototype.hasOwnProperty.call(updates, "month_allocations") || existing.month_allocations !== undefined;
  if (hasAllocations) {
    const rows = Object.prototype.hasOwnProperty.call(updates, "month_allocations") ? updates.month_allocations : existing.month_allocations;
    const allocationError = validateSpendingAllocations(rows, Object.prototype.hasOwnProperty.call(updates, "total_amount") ? updates.total_amount : existing.total_amount);
    if (allocationError) return res.status(400).json({ error: "Invalid spending month allocation.", allocation_error: allocationError });
    updates.month_allocations = rows.map(({ month, amount }) => ({ month, amount }));
    updates.invoice_month = allocationInvoiceMonths(updates.month_allocations);
  }
  if (
    updates.total_amount_usd === void 0 ||
    updates.total_amount_usd === null
  ) {
    const cur = normalizeCurrencyCode(updates.currency || existing.currency, tenantDefaultCurrency(existing.organizationId));
    const amt =
      Number(
        updates.total_amount !== void 0
          ? updates.total_amount
          : existing.total_amount,
      ) || 0;
    const invDate = updates.invoice_date || existing.invoice_date;
    if (cur === "USD") {
      updates.total_amount_usd = amt;
    } else {
      let rate = getDefaultUsdRate(cur);
      try {
        const token2 = await resolveActiveGoogleToken(
          req.headers["x-google-access-token"],
        );
        rate = await getHistoricalExchangeRate(
          db.googleConfig.spreadsheetId,
          token2,
          cur,
          invDate,
        );
      } catch (e) {}
      updates.total_amount_usd = Math.round(amt * rate * 100) / 100;
    }
  } else {
    updates.total_amount_usd = Number(updates.total_amount_usd);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "io_id")) {
    updates.io_id = updates.io_id && db.ios.some((io) => io.io_id === String(updates.io_id) && io.organizationId === existing.organizationId) ? String(updates.io_id) : void 0;
  }
  const updated = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  const partner = await partnerRepository.findByIdOrName(existing.organizationId, updated.vendor_id, updated.vendor_name);
  const token = await resolveActiveGoogleToken(
    req.headers["x-google-access-token"] || req.body.accessToken,
  );
  if (updated.invoice_month) {
    updated.invoice_month = normalizeSpendingMonths(updated.invoice_month);
  }
  const monthsArray = normalizeSpendingMonths(updated.invoice_month);
  if (invoice_file && invoice_file.fileData) {
    const targetInvoiceName = formatInvoiceFileName({
      partnerName: partner?.partner_name || updated.vendor_name,
      invoiceMonth: monthsArray,
      invoiceNumber: updated.invoice_number,
      invoiceDate:
        updated.invoice_date || new Date().toISOString().split("T")[0],
      rawFileName: invoice_file.fileName,
    });
    updated.invoice_file_name = targetInvoiceName;
    let invoice_file_url = "";
    if (!invoice_file_url) {
      invoice_file_url = await saveUpload(
        partner?.partner_name || updated.vendor_name,
        "Folder Invoice & Billing",
        targetInvoiceName,
        invoice_file.fileData,
        existing.organizationId,
      );
      await logActivity(req, "UPLOAD_SUCCESS", "PARTNER", `File Invoice '${targetInvoiceName}' disimpan di server lokal aplikasi (dicadangkan ke Google Drive otomatis jika terhubung)`);
    }
    updated.invoice_file_url = invoice_file_url;
  }
  if (billing_file && billing_file.fileData) {
    const targetBillingName = formatBillingFileName({
      partnerName: partner?.partner_name || updated.vendor_name,
      invoiceMonth: monthsArray,
      invoiceNumber: updated.invoice_number,
      invoiceDate:
        updated.invoice_date || new Date().toISOString().split("T")[0],
      rawFileName: billing_file.fileName,
    });
    updated.billing_file_name = targetBillingName;
    let billing_file_url = "";
    if (!billing_file_url) {
      billing_file_url = await saveUpload(
        partner?.partner_name || updated.vendor_name,
        "Folder Invoice & Billing",
        targetBillingName,
        billing_file.fileData,
        existing.organizationId,
      );
      await logActivity(req, "UPLOAD_SUCCESS", "PARTNER", `File Billing '${targetBillingName}' disimpan di server lokal aplikasi (dicadangkan ke Google Drive otomatis jika terhubung)`);
    }
    updated.billing_file_url = billing_file_url;
  }
  updated.organizationId = existing.organizationId;
  const writeDenial = assertRecordWritable(req, "spending", updated);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  db.spendings[idx] = updated;
  await saveDb();
  await logActivity(req, "UPDATE", "PARTNER", `Memperbarui Catatan Partner Spending untuk '${updated.vendor_name}' (Invoice #${updated.invoice_number})`);
  await triggerAutoPushToGoogleSheet(req);
  res.json({ success: true, spending: updated });
});
app.delete("/api/partner-spendings/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const idx = (db.spendings || []).findIndex((s) => s.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Data spending tidak ditemukan." });
  }
  const removed = db.spendings[idx];
  const accessDenial = assertRecordAccess(req, "spending", removed);
  if (accessDenial) return res.status(accessDenial.status).json(accessDenial.body);
  db.spendings.splice(idx, 1);
  await saveDb();
  await logActivity(req, "DELETE", "PARTNER", `Menghapus Catatan Partner Spending '${removed.vendor_name}' (Invoice #${removed.invoice_number})`);
  await triggerAutoPushToGoogleSheet(req);
  res.json({ success: true });
});
  return app;
}
