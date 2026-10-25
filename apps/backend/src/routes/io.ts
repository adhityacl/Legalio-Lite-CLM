import { partnerRepository } from '../repositories/partnerRepository';
import { nextEntityId } from '../ids';
import { ioRepository, IO_SORTS, type IoQuery } from '../repositories/ioRepository';
import { requestedVersion } from '../requestVersion';
import { recordVisible } from '../recordScope';
import { hasOrganizationScope } from '../rbac';
import { contractRepository } from '../repositories/contractRepository';
import * as bodySchemas from '../schemas';
import { scopedRecords, getRequestTenantId, assertRecordAccess, assertRecordWritable, logActivity, orgContextOf, scopeOf } from '../recordAccess';
import { db, countryNameForPrompt } from '../memoryDb';
import { normalizeCurrencyCode, convertToUsdWithFallback, getDefaultUsdRate } from '@legalio/shared/currencyUtils';
import { tenantDefaultCurrency, aiPolicyContext, getTenantSettings, findTenant, computeLifecycle } from '../tenantPolicy';
import { upload } from '../uploadMiddleware';
import { ensureAiAvailable, getValidAiModel, generateContentWithRetryAndFallback, withDocumentTranscriptField, extractAndCacheDocumentTranscript } from '../aiClient';
import { computeInputSha256, globalOcrCache, buildCheapOcrContents } from '../lib/cheapOcrPipeline';
import { getIndustryPack } from '@legalio/shared/policy';
import { Type } from '@google/genai';
import { normalizeParsedDate, computeContractEndDateFromDuration } from '../documentParsing';
import { sendRouteError } from '../apiErrors';
import { generateRedlineAnalysis } from '../redlineAnalysis';
import { validateBody } from '../validation';
import { getHistoricalExchangeRate } from '@legalio/shared/currencyRates';
import { formatIOFileName } from '@legalio/shared/fileNaming';
import { saveUpload } from '../uploadStorage';
import { formatAmountForTenant } from '../mailHelpers';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { componentLog } from '../logger';
const log = componentLog('io');

export function createIoRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

const queryText = (value: unknown, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const queryList = (value: unknown) => queryText(value, 500).split(",").map((v) => v.trim()).filter(Boolean).slice(0, 20);
/** Paged-list parameters of GET /api/ios; `paged` is false when the request asks for the classic full list. */
function ioListQuery(query: express.Request["query"]): IoQuery & { paged: boolean; filtered: boolean } {
  const requested = queryText(query.sort, 40);
  const limit = query.limit === undefined ? undefined : Math.min(500, Math.max(1, Math.trunc(Number(query.limit)) || 50));
  const paged = limit !== undefined || query.offset !== undefined;
  const filters = { status: queryList(query.status), partnerId: queryList(query.partner_id), contractId: queryList(query.contract_id), pricingModel: queryList(query.pricing_model), chargingType: queryList(query.charging_type) };
  const date = (value: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(queryText(value, 10)) ? queryText(value, 10) : undefined);
  const window = date(query.window_from) && date(query.window_to) ? { from: date(query.window_from)!, to: date(query.window_to)! } : undefined;
  const q = queryText(query.q, 200) || undefined;
  const sort = (IO_SORTS as readonly string[]).includes(requested) ? requested as IoQuery["sort"] : (paged || requested ? "end_date" : "default");
  return {
    paged, filtered: Boolean(q) || Boolean(window) || Object.values(filters).some((list) => list.length) || query.sort !== undefined,
    q, ...filters, window, sort, dir: queryText(query.dir, 4).toLowerCase() === "desc" ? "desc" : "asc",
    limit: limit ?? (query.offset !== undefined ? 50 : undefined), offset: Math.max(0, Math.trunc(Number(query.offset)) || 0),
  };
}
/** The order as the API presents it: normalized currency, a USD value and the number of the contract it belongs to. */
function presentIos(rows: any[], labels: Map<string, { contract_number: string | null }>, partnerNames: Map<string, string>) {
  return rows.map((io) => {
    const c = labels.get(io.contract_id);
    const cur = normalizeCurrencyCode(io.currency, tenantDefaultCurrency(io.organizationId));
    const amt = Number(io.io_value) || 0;
    const usdVal =
      io.io_value_usd !== void 0 && io.io_value_usd !== null
        ? io.io_value_usd
        : cur === "USD"
          ? amt
          : convertToUsdWithFallback(amt, cur);
    return {
      ...io,
      currency: cur,
      io_value_usd: usdVal,
      contract_number: c ? c.contract_number : io.contract_number || "-",
      partner_name: partnerNames.get(io.partner_id) ?? io.partner_name,
    };
  });
}
/**
 * Without list parameters: every visible order as a bare array (unchanged). With limit/offset/q/sort or a filter (status, partner_id,
 * contract_id; comma lists): the matching visible orders, one page at a time, the total in `X-Total-Count`.
 */
app.get("/api/ios", async (req: express.Request, res: express.Response) => {
  const query = ioListQuery(req.query);
  const ctx = orgContextOf(req);
  const organizationId = getRequestTenantId(req);
  let rows: any[];
  if (!query.paged && !query.filtered) {
    rows = await scopedRecords(req, "io");
  } else {
    let total: number;
    if (hasOrganizationScope(ctx)) {
      ({ rows, total } = await ioRepository.list(organizationId, query));
    } else {
      // Department roles see a subset decided by partner/contract ownership: filter the matches, then page.
      const matched = (await ioRepository.list(organizationId, { ...query, limit: undefined, offset: 0 })).rows
        .filter((row) => recordVisible(ctx, scopeOf(req), "io", row));
      total = matched.length;
      rows = query.limit === undefined ? matched : matched.slice(query.offset, (query.offset ?? 0) + query.limit);
    }
    res.setHeader("X-Total-Count", String(total));
    res.setHeader("Access-Control-Expose-Headers", "X-Total-Count");
  }
  const labels = await contractRepository.labels(organizationId, rows.map((io) => io.contract_id));
  res.json(presentIos(rows, labels, await partnerRepository.names(organizationId, rows.map((io) => io.partner_id))));
});
app.post("/api/ios/parse", upload.single("file") as any, async (req: express.Request, res: express.Response) => {
  if (!(await ensureAiAvailable(req, res))) return;
  try {
    const inputData = req.file?.buffer || req.body?.pdfBase64 || req.body?.fileBase64;
    const model = req.body?.model;
    if (!inputData) {
      return res.status(400).json({ error: "File (binary or base64) is required" });
    }

    const tenantId = getRequestTenantId(req);
    const inputHash = computeInputSha256(inputData);
    const cacheScope = `ios:${tenantId}`;
    const cached = await globalOcrCache.get(inputHash, cacheScope);
    if (cached) {
      return res.json({
        ...cached,
        cached: true,
      });
    }

    const ctx = aiPolicyContext(tenantId);
    const profile = getIndustryPack(getTenantSettings(tenantId).industry).commercialDocument;
    const startTime = Date.now();
    const prompt = `You are an expert commercial-document analyst for ${ctx.organizationName} (${ctx.industryName}). The document is a ${profile.label} or a similar order/schedule issued under a master agreement (it may also be a purchase order, order form, statement of work, insertion order or service order). Extract:

1. "io_number": the document's reference number; "-" if it has none.
2. "io_title": the order, campaign, project or engagement title.
3. "partner_name": the counterparty's full legal name (not ${ctx.organizationName}).
4. "contract_number": the reference number of the master agreement it refers to, if any.
5. "media_channel": the ${profile.channelLabel.toLowerCase()} this document covers (e.g. ${profile.channelPlaceholder.replace(/^e\.g\. /, "")}); "-" if not stated.
6. "pricing_model": one of ${profile.pricingModels.map((m) => `"${m}"`).join(", ")} — or the closest short label used in the document.
7. "start_date": the start date as ISO 8601 "YYYY-MM-DD"; "-" if not separately stated.
8. "end_date": the end date as "YYYY-MM-DD". If only a duration is given, end date = start date + duration − 1 day. "-" if unknown.
9. "campaign_duration": the duration as short text (e.g. "3 months", "14 days").
10. "io_value": the total committed value as a plain number; 0 when the value is variable or uncapped.
11. "currency": the ISO 4217 code of the value; "${ctx.defaultCurrency}" if none is stated.
12. "deliverables": a structured Markdown summary in ${ctx.responseLanguage}. STRICT RULES: never use the comma character (,) — use "and", "or", parentheses or hyphens — and do not add citation markers. Use these sections (translate headings into ${ctx.responseLanguage}):
   # ${profile.label.toUpperCase()} SUMMARY
   - Document name / reference / master agreement / start date / end date
   ## PARTIES — provider (contact and e-mail) and customer (signatory and billing address)
   ## SCOPE AND DELIVERABLES — region / service or goods / ${profile.channelLabel.toLowerCase()} / KPIs or acceptance criteria
   ## PRICING — model / unit prices or tiers / fees / discounts or rebates / budget or cap
   ## PAYMENT AND INVOICING — prepaid or postpaid / payment term from invoice / invoice requirements

Return strictly one valid JSON object matching the schema.`;
    const { contents: ocrContents, ocrStats } = await buildCheapOcrContents(
      inputData,
      prompt,
    );
    log.info(
      `[PDF-Inspector IO Parser] Mode: ${ocrStats.mode.toUpperCase()} (${ocrStats.classification}), Inspected in ${ocrStats.inspectionMs}ms, Pages: ${ocrStats.originalPages} (${ocrStats.originalKb}KB) -> ${ocrStats.processedPages} (${ocrStats.optimizedKb}KB), DigitalText: ${ocrStats.hasDigitalText}, Hash: ${ocrStats.fileHash.slice(0, 8)}`,
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
              io_number: { type: Type.STRING },
              io_title: { type: Type.STRING },
              partner_name: { type: Type.STRING },
              contract_number: { type: Type.STRING },
              media_channel: { type: Type.STRING },
              pricing_model: { type: Type.STRING },
              start_date: { type: Type.STRING },
              end_date: { type: Type.STRING },
              campaign_duration: { type: Type.STRING },
              io_value: { type: Type.NUMBER },
              currency: { type: Type.STRING },
              deliverables: { type: Type.STRING },
            },
          },
          ocrStats.mode,
        ),
      },
    });
    const parsedData = JSON.parse((response as any).text);
    await extractAndCacheDocumentTranscript(parsedData, ocrStats.fileHash);
    if (parsedData.start_date) {
      parsedData.start_date = normalizeParsedDate(parsedData.start_date);
    }
    if (parsedData.end_date) {
      parsedData.end_date = normalizeParsedDate(
        parsedData.end_date,
      );
    }
    if (
      parsedData.start_date &&
      (!parsedData.end_date ||
        parsedData.end_date === parsedData.start_date ||
        new Date(parsedData.end_date) <=
          new Date(parsedData.start_date))
    ) {
      const computedEnd = computeContractEndDateFromDuration(
        parsedData.start_date,
        parsedData.campaign_duration || "",
      );
      if (computedEnd) {
        parsedData.end_date = computedEnd;
      }
    }
    if (
      parsedData.io_value === null ||
      parsedData.io_value === void 0 ||
      isNaN(parsedData.io_value)
    ) {
      parsedData.io_value = 0;
    }
    if (parsedData.deliverables) {
      parsedData.deliverables = String(parsedData.deliverables)
        .replace(/,/g, " ")
        .trim();
    }
    const durationMs = Date.now() - startTime;
    const responsePayload = {
      success: true,
      data: parsedData,
      performance: { durationMs, ...ocrStats },
    };
    if (ocrStats.fileHash) {
      await globalOcrCache.set(ocrStats.fileHash, cacheScope, responsePayload);
    }
    res.json(responsePayload);
  } catch (error) {
    log.error("Error parsing IO:", error);
    sendRouteError(req, res, error, "request failed", "Failed to parse IO document. Google AI model is currently busy, please try again.", { status: 500 });
  }
});
/** AI review of the service order form's current values (deliverables and commercial terms); an existing SO stores the result right away. */
app.post("/api/ios/review-analysis", async (req: express.Request, res: express.Response) => {
  const draft = req.body?.io;
  if (!draft || typeof draft !== "object") return res.status(400).json({ error: "Service order data is required." });
  const organizationId = getRequestTenantId(req);
  const partner = await partnerRepository.get(organizationId, String(draft.partner_id ?? ""));
  if (!partner || assertRecordAccess(req, "partner", partner)) return res.status(400).json({ error: "Partner tidak ditemukan." });
  const saved = draft.io_id ? await ioRepository.get(organizationId, String(draft.io_id)) : undefined;
  if (draft.io_id && (!saved || assertRecordAccess(req, "io", saved) || assertRecordWritable(req, "io", saved))) {
    return res.status(404).json({ error: "Service order not found." });
  }
  const parent = draft.contract_id ? await contractRepository.get(organizationId, String(draft.contract_id)) : undefined;
  const parentVisible = parent && !assertRecordAccess(req, "contract", parent) ? parent : undefined;
  if (!(await ensureAiAvailable(req, res))) return;
  const pick = (k: string) => (draft[k] == null ? "-" : String(draft[k]).slice(0, 20000));
  const ctx = aiPolicyContext(organizationId);
  const prompt = `You are a senior commercial counsel and procurement reviewer acting for ${ctx.organizationName}, a ${ctx.industryName} organization in ${ctx.countryName}.
Review the service order (SO) below — an operational order placed under a vendor relationship — and propose balanced fixes. Write every narrative field (titles, summary, findings, clause text and notes) in English.

=== SERVICE ORDER ===
SO number: ${pick("io_number")}
Title: ${pick("io_title")}
Vendor: ${partner.partner_name}${partner.country ? ` (${countryNameForPrompt(partner.country)})` : ""}
Deliverable / channel: ${pick("media_channel")}
Pricing model: ${pick("pricing_model")}
Charging type: ${pick("charging_type")}
Value: ${pick("currency")} ${Number(draft.io_value) || 0}
Period: ${pick("start_date")} to ${pick("end_date")}
Notice period: ${pick("notice_period_days")} days
Deliverables text:
${pick("deliverables")}
${parentVisible ? `
=== PARENT CONTRACT ===
Reference: ${parentVisible.contract_number} — ${parentVisible.contract_title}
Term: ${parentVisible.start_date} to ${parentVisible.end_date}; status: ${parentVisible.status || "-"}
Value: ${parentVisible.currency || "-"} ${Number(parentVisible.contract_value || 0)}
Clause summary: ${parentVisible.internal_notes || "-"}` : "\nNo parent contract is linked; the SO must stand on its own terms."}

=== REVIEW INSTRUCTIONS ===
Focus on: (1) whether deliverables are measurable — quantities, specs, KPIs, dates and acceptance criteria; (2) commercial fit — the pricing model matches the charging type, payment timing is clear, and there is a remedy for under-delivery (make-good, credit or refund); (3) reporting/proof-of-performance obligations; (4) cancellation and change terms; (5) consistency with the parent contract when one is given.
Industry focus areas: ${ctx.reviewFocus.join("; ")}.
Do not invent statute or regulation numbers.

Return JSON with exactly:
1. overallRiskScore: integer 0-100 (0-25 low, 26-55 moderate, 56-75 high, 76-100 critical).
2. riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL".
3. executiveSummary: one short paragraph on how ready this SO is to issue and its main gaps.
4. keyFindings: 2-4 of the most important issues.
5. analyzedClauses: 2-5 items to fix, each with clauseTitle, riskCategory, severity ("LOW"|"MEDIUM"|"HIGH"|"CRITICAL"), originalTextOrIssue (quote the SO wording when possible, otherwise describe what is missing), identifiedRisk, recommendedRedline (replacement or additional SO wording) and legalRationale.
6. complianceChecklist: 3-5 items, each with item, status ("COMPLIANT" | "NEEDS_REVIEW" | "NON_COMPLIANT") and notes.
`;
  try {
    const analysis = await generateRedlineAnalysis(req, prompt);
    // Row-locked server-side edit: the stored result never overwrites (or fails on) a user's concurrent edit of other fields.
    const stored = saved ? await ioRepository.mutate(saved.organizationId, saved.io_id, (row) => {
      row.redline_analysis = analysis;
      row.redline_analyzed_at = analysis.analyzed_at;
      row.updated_at = analysis.analyzed_at;
    }) : undefined;
    res.json({ success: true, analysis, analyzed_at: analysis.analyzed_at, saved: Boolean(stored) });
  } catch (error) {
    log.error("Error during service order review:", error);
    sendRouteError(req, res, error, "request failed", "Gagal melakukan analisis AI. Silakan coba kembali.", { status: 500 });
  }
});

app.post("/api/ios", validateBody(bodySchemas.ioCreateBody, { requiredMessage: "Nomor IO, Judul, Partner, Tanggal, Pricing Model, & Charging Type wajib diisi." }), async (req: express.Request, res: express.Response) => {
  const {
    contract_id,
    io_number,
    io_title,
    partner_id,
    media_channel,
    start_date,
    end_date,
    pricing_model,
    charging_type,
    currency,
    io_value,
    io_value_usd: req_usd,
    deliverables,
    notice_period_days,
    notice_type_required,
    fileName,
    fileData,
  } = req.body;
  if (
    !io_number ||
    !io_title ||
    !partner_id ||
    !start_date ||
    !end_date ||
    !pricing_model ||
    !charging_type
  ) {
    return res
      .status(400)
      .json({
        error:
          "Nomor IO, Judul, Partner, Tanggal, Pricing Model, & Charging Type wajib diisi.",
      });
  }
  if (new Date(end_date) <= new Date(start_date)) {
    return res
      .status(400)
      .json({ error: "Tanggal Berakhir harus setelah Tanggal Mulai." });
  }
  const ioTenantId = getRequestTenantId(req);
  const existingIODup = await ioRepository.findByNumber(ioTenantId, io_number);
  if (existingIODup) {
    return res
      .status(400)
      .json({ error: `Nomor IO '${io_number}' sudah terdaftar dalam sistem.` });
  }
  const targetOrgId = getRequestTenantId(req);
  const targetTenant = findTenant(targetOrgId);
  const partner = await partnerRepository.get(targetOrgId, String(partner_id ?? ""));
  if (!partner) return res.status(400).json({ error: "Partner tidak ditemukan." });
  const contract = contract_id ? await contractRepository.get(targetOrgId, contract_id) : undefined;
  const cur = normalizeCurrencyCode(currency, tenantDefaultCurrency(targetOrgId));
  const amt = Number(io_value) || 0;
  let total_usd = req_usd;
  if (total_usd === void 0 || total_usd === null || isNaN(Number(total_usd))) {
    if (cur === "USD") {
      total_usd = amt;
    } else {
      let rate = getDefaultUsdRate(cur);
      try {
        rate = await getHistoricalExchangeRate(cur, start_date);
      } catch (e) {
        log.error("Failed fetching historical rate for IO:", e);
      }
      total_usd = Math.round(amt * rate * 100) / 100;
    }
  }
  const targetFileName = formatIOFileName({
    partnerName: partner?.partner_name,
    mediaChannel: media_channel || "Digital Channel",
    ioNumber: io_number,
    startDate: start_date,
    rawFileName: fileName || `${io_number}.pdf`,
  });
  let io_file_link = "";
  if (
    fileData &&
    typeof fileData === "string" &&
    fileData.includes("base64,")
  ) {
    if (!io_file_link) {
      io_file_link = await saveUpload(
        partner?.partner_name,
        "Folder IO",
        targetFileName,
        fileData,
        targetTenant?.id,
      );
      await logActivity(req, "UPLOAD_SUCCESS", "IO", `File IO '${targetFileName}' disimpan di penyimpanan file aplikasi`);
    }
  }
  const { status, daysRemaining: diffDays } = computeLifecycle(targetOrgId, end_date, "Active", false);
  const newIO = {
    io_id: await nextEntityId("io"),
    organizationId: targetOrgId,
    contract_id: contract_id || void 0,
    contract_number: contract ? contract.contract_number : "-",
    io_number,
    io_title,
    partner_id,
    media_channel: media_channel || "",
    start_date,
    end_date,
    pricing_model,
    charging_type,
    currency: cur,
    io_value: amt,
    io_value_usd: Number(total_usd),
    deliverables: deliverables || "-",
    // Optional unit pricing used to estimate how many units an invoice should cover.
    unit: req.body.unit ? String(req.body.unit).slice(0, 60) : void 0,
    unit_price: Number(req.body.unit_price) > 0 ? Number(req.body.unit_price) : void 0,
    unit_quantity: Number(req.body.unit_quantity) > 0 ? Number(req.body.unit_quantity) : void 0,
    notice_period_days: Number(notice_period_days) || 14,
    // Review run on the add page before the SO existed.
    redline_analysis: req.body.redline_analysis && typeof req.body.redline_analysis === "object" ? req.body.redline_analysis : void 0,
    redline_analyzed_at: req.body.redline_analysis && typeof req.body.redline_analysis === "object" ? String(req.body.redline_analyzed_at || new Date().toISOString()) : void 0,
    notice_type_required: notice_type_required || "Termination",
    status,
    io_file_link,
    fileName: targetFileName,
    days_remaining: diffDays,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const writeDenial = assertRecordWritable(req, "io", newIO);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  const stored = await ioRepository.insert(newIO);
  await logActivity(req, "CREATE", "IO", `Membuat dokumen komersial baru '${io_number}' (${io_title}) senilai ${formatAmountForTenant(amt, cur, targetOrgId)}`);
  res.json({ success: true, io: stored });
});
app.put("/api/ios/:id", validateBody(bodySchemas.ioUpdateBody), async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { fileData: uploadedData, fileName: uploadedName, accessToken: _accessToken, version: clientVersion, ...updates } = req.body;
  const existing = await ioRepository.get(getRequestTenantId(req), id);
  if (!existing) return res.status(404).json({ error: "IO tidak ditemukan." });
  // The version the client last saw (body `version` or If-Match) guards against overwriting someone else's edit; clients that
  // send none are still protected for the duration of this request (the version read above).
  const expectedVersion = requestedVersion(req, clientVersion) ?? existing.version;
  const tenantDenial = assertRecordAccess(req, "io", existing);
  if (tenantDenial) return res.status(tenantDenial.status).json(tenantDenial.body);
  const updated = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  if (updates.contract_id !== undefined) {
    const parent = updates.contract_id ? await contractRepository.get(existing.organizationId, updates.contract_id) : undefined;
    updated.contract_number = parent ? parent.contract_number : "-";
  }
  const cur = normalizeCurrencyCode(updated.currency || existing.currency, tenantDefaultCurrency(existing.organizationId));
  updated.currency = cur;
  const amt = Number(updated.io_value) || 0;
  let total_usd = updates.io_value_usd;
  if (total_usd === void 0 || total_usd === null || isNaN(Number(total_usd))) {
    if (cur === "USD") {
      total_usd = amt;
    } else {
      let rate = getDefaultUsdRate(cur);
      try {
        const startDate = updated.start_date || existing.start_date;
        rate = await getHistoricalExchangeRate(cur, startDate);
      } catch (e) {
        log.error("Failed fetching rate for edit IO:", e);
      }
      total_usd = Math.round(amt * rate * 100) / 100;
    }
  }
  updated.currency = cur;
  updated.io_value = amt;
  updated.io_value_usd = Number(total_usd);
  if (
    uploadedData &&
    typeof uploadedData === "string" &&
    uploadedData.includes("base64,")
  ) {
    const fileData = uploadedData;
    const partner = await partnerRepository.get(existing.organizationId, String(updated.partner_id ?? ""));
    const targetFileName = formatIOFileName({
      partnerName: partner?.partner_name,
      mediaChannel: updated.media_channel || "Digital Channel",
      ioNumber: updated.io_number,
      startDate: updated.start_date,
      rawFileName:
        uploadedName || updated.fileName || `${updated.io_number}.pdf`,
    });
    let io_file_link = "";
    if (!io_file_link) {
      io_file_link = await saveUpload(
        partner?.partner_name,
        "Folder IO",
        targetFileName,
        fileData,
        existing.organizationId,
      );
      await logActivity(req, "UPLOAD_SUCCESS", "IO", `File IO '${targetFileName}' disimpan di penyimpanan file aplikasi`);
    }
    updated.io_file_link = io_file_link;
    updated.fileName = targetFileName;
  }
  if (
    updated.start_date &&
    updated.end_date &&
    new Date(updated.end_date) <= new Date(updated.start_date)
  ) {
    return res
      .status(400)
      .json({ error: "Tanggal Berakhir harus setelah Tanggal Mulai." });
  }
  if (updated.io_number) {
    const dup = await ioRepository.findByNumber(existing.organizationId, updated.io_number, id);
    if (dup) {
      return res
        .status(400)
        .json({
          error: `Nomor IO '${updated.io_number}' sudah digunakan oleh IO lain.`,
        });
    }
  }
  const ioLifecycle = computeLifecycle(updated.organizationId, updated.end_date, updated.status, false);
  updated.days_remaining = ioLifecycle.daysRemaining ?? updated.days_remaining;
  updated.status = ioLifecycle.status;
  updated.organizationId = existing.organizationId;
  const writeDenial = assertRecordWritable(req, "io", updated);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  const stored = await ioRepository.update(updated, expectedVersion);
  await logActivity(req, "UPDATE", "IO", `Memperbarui data Insertion Order '${updated.io_number}'`);
  res.json({ success: true, io: stored });
});
app.delete("/api/ios/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const item = await ioRepository.get(getRequestTenantId(req), id);
  if (!item) return res.status(404).json({ error: "IO tidak ditemukan." });
  const tenantDenial = assertRecordAccess(req, "io", item);
  if (tenantDenial) return res.status(tenantDenial.status).json(tenantDenial.body);
  await ioRepository.remove(item.organizationId, id);
  await logActivity(req, "DELETE", "IO", `Menghapus Insertion Order '${item.io_number}' (${item.io_title})`);
  res.json({ success: true });
});
  return app;
}
