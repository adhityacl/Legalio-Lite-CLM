import { nextEntityId } from '../ids';
import * as bodySchemas from '../schemas';
import { resolveActiveGoogleToken, getOrgFolderId, getPartnerCategoryFolderId } from '../googleDrive';
import { db, triggerAutoPushToGoogleSheet } from '../memoryDb';
import { contractRepository, CONTRACT_SORTS, type ContractQuery } from '../repositories/contractRepository';
import { partnerRepository } from '../repositories/partnerRepository';
import { ioRepository } from '../repositories/ioRepository';
import { notificationRepository } from '../repositories/notificationRepository';
import { recordVisible } from '../recordScope';
import { hasOrganizationScope } from '../rbac';
import { getRequestTenantId, scopedRecords, addActivityLog, assertRecordAccess, assertRecordWritable, isMatchingOrg, logActivity, orgContextOf, scopeOf } from '../recordAccess';
import { createGoogleDocInFolder } from '../lib/googleDriveSync';
import { sendRouteError } from '../apiErrors';
import { refreshContractLifecycles, rollForwardAutoRenewal } from '../reminderJobs';
import { normalizeCurrencyCode, convertToUsdWithFallback, getDefaultUsdRate } from '@legalio/shared/currencyUtils';
import { tenantDefaultCurrency, aiPolicyContext, findTenant, getTenantSettings } from '../tenantPolicy';
import { upload } from '../uploadMiddleware';
import { ensureAiAvailable, getValidAiModel, generateContentWithRetryAndFallback, withDocumentTranscriptField, extractAndCacheDocumentTranscript } from '../aiClient';
import { computeInputSha256, globalOcrCache, buildCheapOcrContents, getCachedTranscript } from '../lib/cheapOcrPipeline';
import { buildFieldProvenance } from '../lib/provenance';
import { pagesFromText } from '../contractDocumentText';
import { Type } from '@google/genai';
import { normalizeParsedDate, computeContractEndDateFromDuration } from '../documentParsing';
import { runContractRedlineAnalysis } from '../redlineAnalysis';
import { sql } from '../db';
import { emitContractEvents } from '../webhookEvents';
import { emitWebhookEvent } from '../webhooks';
import { TerminationFile, parseTerminationFile } from '../contractTermination';
import { randomUUID } from 'node:crypto';
import { saveUpload } from '../uploadStorage';
import { CONTRACT_TERMINATION_TRANSLATIONS } from '@legalio/shared/i18n/contractTermination';
import { validateBody } from '../validation';
import { requestedVersion } from '../requestVersion';
import { contractLifecycleMode, validateContractTermination, contractLifecycle } from '@legalio/shared/contractLifecycle';
import { getHistoricalExchangeRate } from '@legalio/shared/currencyRates';
import { formatContractFileName } from '@legalio/shared/fileNaming';
import { normalizeApprovalStatus, normalizeContractStatus } from '@legalio/types/domainStatus';
import { formatAmountForTenant } from '../mailHelpers';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { componentLog } from '../logger';
const log = componentLog('contracts');
/** Fields of the contract parser's answer that carry a source quote. */
const PARSE_PROVENANCE_FIELDS = ["contract_title", "partner_name", "contract_number", "parent_contract_number", "start_date", "end_date", "contract_value", "currency", "auto_renewal", "notice_period_days"] as const;

export function createContractsRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);


app.post("/api/contracts/export-google-docs", async (req: express.Request, res: express.Response) => {
  try {
    const title = req.body.title || req.body.docTitle || "Partnership Agreement";
    const contentHtml = req.body.contentHtml || req.body.htmlContent || req.body.html;
    const partnerName = req.body.partnerName || req.body.partner_name || req.body.partnerId;

    if (!title || !contentHtml) {
      return res.status(400).json({ error: "Title dan contentHtml wajib diisi." });
    }
    const token = await resolveActiveGoogleToken(
      req.headers["x-google-access-token"] ||
      req.body.accessToken ||
      db.googleConfig?.accessToken
    );
    const targetOrgId = getRequestTenantId(req);

    // Only this organization's folder tree — never the platform master root.
    let targetFolderId = (await getOrgFolderId(targetOrgId, token)).id;
    if (partnerName) {
      try {
        const partner = (await scopedRecords(req, "partner")).find(
          (p: any) => p.partner_name?.toLowerCase() === String(partnerName).toLowerCase() || p.partner_id === partnerName
        );
        if (partner) {
          targetFolderId = await getPartnerCategoryFolderId(
            partner,
            "Folder Kontrak",
            token,
            targetOrgId
          );
        }
      } catch (fErr) {
        log.warn("Folder resolve fallback:", fErr);
      }
    }

    if (!targetFolderId) {
      return res.status(409).json({ error: "GOOGLE_FOLDER_UNAVAILABLE", message: "This organization has no Google Drive folder mapping." });
    }
    const docResult = await createGoogleDocInFolder(
      title,
      contentHtml,
      targetFolderId,
      token
    );

    await addActivityLog("", "", "", "DOCUMENT_EXPORT", "DOCUMENTS", `Exported '${title}' to Google Docs`, req, undefined, { documentId: docResult.id }).catch((err) => log.warn("Could not record export activity:", err));
    await emitWebhookEvent(sql, targetOrgId, "document.exported", { kind: "google_doc", title: String(title).slice(0, 300), documentId: docResult.id, documentUrl: docResult.documentUrl });
    res.json({
      success: true,
      documentId: docResult.id,
      documentUrl: docResult.documentUrl,
      webViewLink: docResult.documentUrl,
      data: {
        documentId: docResult.id,
        documentUrl: docResult.documentUrl,
        webViewLink: docResult.documentUrl,
      },
    });
  } catch (error: any) {
    log.error("Error creating Google Doc:", error);
    sendRouteError(req, res, error, "request failed", "Gagal membuat dokumen Google Docs.", { status: 500 });
  }
});

/** Contract as the API presents it: normalized currency and a USD value. */
function presentContract(c: any) {
  const cur = normalizeCurrencyCode(c.currency, tenantDefaultCurrency(c.organizationId));
  const amt = Number(c.contract_value) || 0;
  const usdVal =
    c.contract_value_usd !== void 0 && c.contract_value_usd !== null
      ? c.contract_value_usd
      : cur === "USD"
        ? amt
        : convertToUsdWithFallback(amt, cur);
  return {
    ...c,
    currency: cur,
    contract_value_usd: usdVal,
  };
}
const queryText = (value: unknown, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const queryList = (value: unknown) => queryText(value, 500).split(",").map((v) => v.trim()).filter(Boolean).slice(0, 20);
/** Paged-list parameters; undefined when the request asks for the classic full list. */
function contractListQuery(query: express.Request["query"]): (ContractQuery & { paged: boolean }) {
  const sort = queryText(query.sort, 40);
  const dir = queryText(query.dir, 4).toLowerCase() === "desc" ? "desc" as const : "asc" as const;
  const limit = query.limit === undefined ? undefined : Math.min(500, Math.max(1, Math.trunc(Number(query.limit)) || 50));
  const date = (value: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(queryText(value, 10)) ? queryText(value, 10) : undefined);
  return {
    paged: limit !== undefined || query.offset !== undefined,
    q: queryText(query.q, 200) || undefined,
    status: queryList(query.status).map((v) => normalizeContractStatus(v)),
    statusApproval: queryList(query.status_approval).map((v) => normalizeApprovalStatus(v)),
    documentType: queryText(query.document_type, 80) || undefined,
    partnerId: queryList(query.partner_id).length === 1 ? queryList(query.partner_id)[0] : undefined,
    partnerIds: queryList(query.partner_id).length > 1 ? queryList(query.partner_id) : undefined,
    categories: queryList(query.category),
    parentContractId: queryText(query.parent_contract_id, 100) || undefined,
    window: date(query.window_from) && date(query.window_to) ? { from: date(query.window_from)!, to: date(query.window_to)! } : undefined,
    internalPic: queryText(query.internal_pic, 300) || undefined,
    endFrom: date(query.end_from),
    endTo: date(query.end_to),
    sort: (CONTRACT_SORTS as readonly string[]).includes(sort) ? sort as ContractQuery["sort"] : "default",
    dir,
    limit: limit ?? (query.offset !== undefined ? 50 : undefined),
    offset: Math.max(0, Math.trunc(Number(query.offset)) || 0),
  };
}
/**
 * Without paging parameters: every visible contract as a bare array (unchanged). With `limit`/`offset`: one page of the
 * matching, visible contracts, the total in `X-Total-Count`. Filters: q, status (comma list), status_approval, document_type,
 * partner_id, internal_pic, end_from, end_to; sort: one of CONTRACT_SORTS with dir=asc|desc.
 */
app.get("/api/contracts", async (req: express.Request, res: express.Response) => {
  await refreshContractLifecycles();
  const query = contractListQuery(req.query);
  const organizationId = getRequestTenantId(req);
  /** Contracts with the name of their partner next to them (additive field), as the list views show it. */
  const withPartnerNames = async (rows: any[]) => {
    const names = await partnerRepository.names(organizationId, rows.map((row) => row.partner_id));
    return rows.map((row) => ({ ...presentContract(row), partner_name: names.get(row.partner_id) ?? row.partner_name }));
  };
  if (!query.paged && !query.q && !query.status?.length && !query.statusApproval?.length && !query.documentType && !query.partnerId && !query.partnerIds && !query.internalPic && !query.endFrom && !query.endTo
    && !query.categories?.length && !query.parentContractId && !query.window) {
    return res.json(await withPartnerNames(await scopedRecords(req, "contract")));
  }
  const ctx = orgContextOf(req);
  let rows: any[];
  let total: number;
  if (hasOrganizationScope(ctx)) {
    // Everything the caller may see matches in SQL: page there.
    ({ rows, total } = await contractRepository.list(organizationId, query));
  } else {
    // Department roles see a subset decided by partner/department ownership: filter the matches, then page.
    const matched = (await contractRepository.list(organizationId, { ...query, limit: undefined, offset: 0 })).rows
      .filter((row) => recordVisible(ctx, scopeOf(req), "contract", row));
    total = matched.length;
    rows = query.limit === undefined ? matched : matched.slice(query.offset, (query.offset ?? 0) + query.limit);
  }
  res.setHeader("X-Total-Count", String(total));
  res.setHeader("Access-Control-Expose-Headers", "X-Total-Count");
  res.json(await withPartnerNames(rows));
});
app.post("/api/contracts/parse", upload.single("file") as any, async (req: express.Request, res: express.Response) => {
  if (!(await ensureAiAvailable(req, res))) return;
  try {
    const inputData = req.file?.buffer || req.body?.pdfBase64 || req.body?.fileBase64;
    const model = req.body?.model;
    if (!inputData) {
      return res.status(400).json({ error: "File (binary or base64) is required" });
    }

    const tenantId = getRequestTenantId(req);
    const inputHash = computeInputSha256(inputData);
    const cacheScope = `contracts:${tenantId}`;
    const cached = await globalOcrCache.get(inputHash, cacheScope);
    if (cached) {
      return res.json({
        ...cached,
        cached: true,
      });
    }

    const ctx = aiPolicyContext(tenantId);
    const startTime = Date.now();
    const prompt = `You are an expert legal contract analyst. Our organization is "${ctx.organizationName}" (${ctx.industryName}, primary jurisdiction: ${ctx.countryName}). Extract the following from this contract so it can be registered in our contract repository. The contract may be written in any language and governed by any jurisdiction.

1. "document_type": "Agreement Addendum" if this is an amendment, addendum, variation or extension; otherwise "Master Agreement".
2. "contract_title": the full official title of the agreement.
3. "partner_name": the full legal name of the counterparty — the party that is NOT ${ctx.organizationName}.
4. "contract_number": the contract reference number issued by ${ctx.organizationName}. When the document carries two reference numbers (ours and the counterparty's), prefer the one issued by ${ctx.organizationName}; if ours cannot be identified, return the first reference number shown.
5. "parent_contract_number": for an addendum, the reference number of the master agreement it amends; otherwise "".
6. "start_date": the effective (or signing) date as ISO 8601 "YYYY-MM-DD".
7. "end_date": the expiry date as "YYYY-MM-DD", computed precisely:
   a. An explicit end date without automatic renewal: use it as written.
   b. A relative term ("valid for 1 year from the start date"): end date = start date + term − 1 day (e.g. start 2024-11-04, 1 year → 2025-11-03; 6 months → 2025-05-03).
   c. A fixed end date plus automatic renewal for another period: add one renewal period to the written end date and set auto_renewal to true.
   d. Evergreen / renews until terminated by either party: return the day before the start date in year 9999 (start 2024-11-04 → "9999-11-03") and set auto_renewal to true.
   e. An extension addendum: compute the new end date from the previous term's end date.
8. "term_clause": quote verbatim the term/renewal clause.
9. "agreement_duration": the term as short text (e.g. "1 year", "6 months", "Until terminated").
10. "contract_value": the total committed contract value as a number, or 0 when the value is variable, commission-based, or not stated.
11. "currency": the ISO 4217 code of the contract value (e.g. "USD", "SGD", "IDR", "INR", "JPY"); "${ctx.defaultCurrency}" if no currency is stated.
12. "auto_renewal": true when the contract renews automatically or runs until terminated; otherwise false.
13. "notice_period_days": the notice period in days for termination or non-renewal (default 30 when not specified).
14. "change_summary": for an addendum, a clear summary of which clauses changed and how; otherwise "".
15. "changed_fields": for an addendum, an array containing any of exactly these codes: "Nilai Kontrak / IO", "Jangka Waktu Periode", "Ruang Lingkup / Deliverables", "Syarat Pembayaran", "Pihak Berwenang". Otherwise [].
16. "provenance": for each of these fields whose value you took from the text — contract_title, partner_name, contract_number, parent_contract_number, start_date, end_date, contract_value, currency, auto_renewal, notice_period_days — one entry {"field", "source_quote", "confidence"}: source_quote is copied exactly from the contract (one sentence or clause, at most 300 characters; for a computed date, the sentence the computation rests on) and confidence is 0 to 1. Leave a field out when you did not find a supporting passage.
17. "internal_notes": a structured Markdown summary written in ${ctx.responseLanguage}, acting as a senior legal analyst.
   STRICT RULE: do not use the comma character (,) anywhere in internal_notes — use "and", "or", parentheses or hyphens instead — so the text can be exported to CSV safely.
   Use exactly these sections (translate the headings into ${ctx.responseLanguage}):
   # AGREEMENT SUMMARY — [counterparty or product name]
   - Title / our reference / counterparty reference / effective date / expiry date / term
   ## PARTIES — for each party: legal name / address / signatory and title / notice e-mail
   ## SCOPE AND PURPOSE — 3 to 4 bullets on purpose / responsibilities / limits of liability
   ## COMMERCIAL TERMS — fees or commissions / payment terms and currency / taxes (${ctx.indirectTaxName} and withholding)
   ## EXCLUSIVITY AND NON-COMPETE — or state that none is provided
   ## CONFIDENTIALITY AND DATA PROTECTION — NDA reference / confidentiality duties / data-breach notification / reference to ${ctx.dataProtectionLaw} or the law actually cited
   ## GOVERNING LAW AND DISPUTES — governing law as written / dispute resolution steps and forum

Return strictly one valid JSON object matching the schema. Use "" for any text field not found in the document.`;
    const { contents: ocrContents, ocrStats } = await buildCheapOcrContents(
      inputData,
      prompt,
    );
    log.info(
      `[PDF-Inspector Contract Parser] Mode: ${ocrStats.mode.toUpperCase()} (${ocrStats.classification}), Inspected in ${ocrStats.inspectionMs}ms, Pages: ${ocrStats.originalPages} (${ocrStats.originalKb}KB) -> ${ocrStats.processedPages} (${ocrStats.optimizedKb}KB), DigitalText: ${ocrStats.hasDigitalText}, Hash: ${ocrStats.fileHash.slice(0, 8)}`,
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
              document_type: { type: Type.STRING },
              contract_title: { type: Type.STRING },
              partner_name: { type: Type.STRING },
              contract_number: { type: Type.STRING },
              parent_contract_number: { type: Type.STRING },
              start_date: { type: Type.STRING },
              end_date: { type: Type.STRING },
              term_clause: { type: Type.STRING },
              agreement_duration: { type: Type.STRING },
              contract_value: { type: Type.NUMBER },
              currency: { type: Type.STRING },
              auto_renewal: { type: Type.BOOLEAN },
              notice_period_days: { type: Type.NUMBER },
              change_summary: { type: Type.STRING },
              changed_fields: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              provenance: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: { field: { type: Type.STRING }, source_quote: { type: Type.STRING }, confidence: { type: Type.NUMBER } },
                  required: ["field", "source_quote"],
                },
              },
              internal_notes: { type: Type.STRING },
            },
            required: ["internal_notes"],
          },
          ocrStats.mode,
        ),
      },
    });
    const parsedData = JSON.parse((response as any).text);
    await extractAndCacheDocumentTranscript(parsedData, ocrStats.fileHash);
    // Where each value came from: the model's quotes, checked against the document text when it is available (a fresh digital PDF has
    // its pages; a document read before has a transcript without page boundaries; a scan being read now has neither).
    const provenanceSource = ocrStats.pages?.length ? ocrStats.pages.map((p: any) => ({ page: p.num, text: p.text }))
      : ocrStats.classification === "cached_transcript" ? pagesFromText((await getCachedTranscript(ocrStats.fileHash)) ?? "") : null;
    parsedData.provenance = buildFieldProvenance(parsedData.provenance, provenanceSource?.length ? provenanceSource : null, PARSE_PROVENANCE_FIELDS, { pagesKnown: Boolean(ocrStats.pages?.length) });
    if (parsedData.start_date) {
      parsedData.start_date = normalizeParsedDate(parsedData.start_date);
    }
    if (parsedData.end_date) {
      parsedData.end_date = normalizeParsedDate(
        parsedData.end_date,
      );
    }
    const clauseText = `${parsedData.agreement_duration || ""} ${parsedData.term_clause || ""}`;
    const isPerpetualClause =
      /sampai pengakhiran|until terminated|salah satu pihak mengakhiri|terus menerus|tanpa batas|unlimited|perpetual/i.test(
        clauseText,
      );
    if (isPerpetualClause && parsedData.start_date) {
      parsedData.auto_renewal = true;
      const parts = parsedData.start_date.split("-").map(Number);
      if (parts.length === 3) {
        const prevDay = new Date(parts[0], parts[1] - 1, parts[2]);
        prevDay.setDate(prevDay.getDate() - 1);
        const prevMonth = String(prevDay.getMonth() + 1).padStart(2, "0");
        const prevDate = String(prevDay.getDate()).padStart(2, "0");
        parsedData.end_date = `9999-${prevMonth}-${prevDate}`;
      }
    } else if (
      parsedData.start_date &&
      (!parsedData.end_date ||
        parsedData.end_date === parsedData.start_date ||
        new Date(parsedData.end_date) <=
          new Date(parsedData.start_date))
    ) {
      const computedResult = computeContractEndDateFromDuration(
        parsedData.start_date,
        clauseText || (parsedData.auto_renewal ? "1 tahun" : ""),
        Boolean(parsedData.auto_renewal),
      );
      if (computedResult) {
        parsedData.end_date = computedResult.endDate;
        if (computedResult.isAutoRenewal) {
          parsedData.auto_renewal = true;
        }
      }
    }
    if (parsedData.internal_notes) {
      parsedData.internal_notes = String(parsedData.internal_notes)
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
    log.error("Error parsing contract:", error);
    sendRouteError(req, res, error, "request failed", "Failed to parse contract document. Google AI model is currently busy, please try again.", { status: 500 });
  }
});
app.get("/api/contracts/:id/redline-analysis", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const contract = await contractRepository.get(getRequestTenantId(req), id);
  if (!contract || assertRecordAccess(req, "contract", contract)) {
    return res.status(404).json({ error: "Contract not found." });
  }
  res.json({
    success: true,
    hasAnalysis: Boolean(contract.redline_analysis),
    analysis: contract.redline_analysis || null,
    analyzed_at: contract.redline_analyzed_at || null,
  });
});

/** Redline review of the contract form's current values; a new contract saves the result together with the contract. */
app.post("/api/contracts/redline-analysis", async (req: express.Request, res: express.Response) => {
  const draft = req.body?.contract;
  if (!draft || typeof draft !== "object") return res.status(400).json({ error: "Contract data is required." });
  const organizationId = getRequestTenantId(req);
  const partner = await partnerRepository.get(organizationId, String(draft.partner_id ?? ""));
  if (!partner || assertRecordAccess(req, "partner", partner)) return res.status(400).json({ error: "Partner tidak ditemukan." });
  // Editing an existing contract: the result is stored on it right away so it survives leaving without saving.
  const saved = draft.contract_id ? await contractRepository.get(organizationId, String(draft.contract_id)) : undefined;
  if (draft.contract_id && (!saved || assertRecordAccess(req, "contract", saved) || assertRecordWritable(req, "contract", saved))) {
    return res.status(404).json({ error: "Contract not found." });
  }
  if (!(await ensureAiAvailable(req, res))) return;
  const pick = (k: string) => (draft[k] == null ? undefined : String(draft[k]).slice(0, 20000));
  const contract = {
    organizationId,
    partner_id: partner.partner_id,
    contract_number: pick("contract_number"),
    contract_title: pick("contract_title"),
    document_type: pick("document_type"),
    cooperation_categories: Array.isArray(draft.cooperation_categories) ? draft.cooperation_categories.map(String).slice(0, 50) : [],
    currency: pick("currency"),
    contract_value: Number(draft.contract_value) || 0,
    start_date: pick("start_date"),
    end_date: pick("end_date"),
    auto_renewal: Boolean(draft.auto_renewal),
    notice_period_days: Number(draft.notice_period_days) || undefined,
    notice_type_required: pick("notice_type_required"),
    internal_notes: pick("internal_notes"),
    change_summary: pick("change_summary"),
  };
  try {
    const analysis = await runContractRedlineAnalysis(req, contract, partner);
    // Only the analysis fields change, on the row as it is now: a concurrent edit of the contract is neither lost nor rejected.
    const stored = saved ? await contractRepository.mutate(organizationId, saved.contract_id, (row) => {
      row.redline_analysis = analysis;
      row.redline_analyzed_at = analysis.analyzed_at;
      row.updated_at = analysis.analyzed_at;
    }) : undefined;
    res.json({ success: true, analysis, analyzed_at: analysis.analyzed_at, saved: Boolean(stored) });
  } catch (error) {
    log.error("Error during draft redline analysis:", error);
    sendRouteError(req, res, error, "request failed", "Gagal melakukan analisis redline AI. Silakan coba kembali.", { status: 500 });
  }
});

app.post("/api/contracts/:id/redline-analysis", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const contract = await contractRepository.get(getRequestTenantId(req), id);
  if (!contract || assertRecordAccess(req, "contract", contract)) {
    return res.status(404).json({ error: "Contract not found." });
  }
  const force = Boolean(req.body.force);
  const hasCustomClause = Boolean(
    req.body.customClauseText && req.body.customClauseText.trim(),
  );
  if (!force && !hasCustomClause && contract.redline_analysis) {
    return res.json({
      success: true,
      cached: true,
      analysis: contract.redline_analysis,
      analyzed_at: contract.redline_analyzed_at || contract.updated_at,
    });
  }
  if (!(await ensureAiAvailable(req, res))) return;
  const partner = await partnerRepository.get(contract.organizationId, String(contract.partner_id ?? ""));
  try {
    const parsed = await runContractRedlineAnalysis(req, contract, partner);
    const nowIso = parsed.analyzed_at;
    await contractRepository.mutate(contract.organizationId, id, (row) => {
      row.redline_analysis = parsed;
      row.redline_analyzed_at = nowIso;
      row.updated_at = nowIso;
    });
    res.json({
      success: true,
      cached: false,
      analysis: parsed,
      analyzed_at: nowIso,
    });
  } catch (error) {
    log.error("Error during redline analysis:", error);
    sendRouteError(req, res, error, "request failed", "Gagal melakukan analisis redline AI. Silakan coba kembali.", { status: 500 });
  }
});

/**
 * AI Redlining for the Contract Creator editor: reviews the whole document
 * against the tenant's country/industry rules (same aiPolicyContext used by
 * the contract-level redline analysis above) and files each finding as an
 * ordinary suggestion in contract_comments — so it shows up, and is
 * accepted/rejected, exactly like a manually authored "Suggest Change".
 *
 * The client sends plain text (editor.getText({blockSeparator: ' '})) rather
 * than this route deriving it from the stored HTML: that guarantees the text
 * the model reviews is byte-for-byte what the client will later search
 * within to anchor each suggestion back into the live document.
 */
app.post("/api/documents/:id/ai-redline", async (req: express.Request, res: express.Response) => {
  const document = await sql.get(`SELECT id, organization_id, name FROM contract_documents WHERE id = ?`, req.params.id) as { id: string; organization_id: string; name: string } | undefined;
  if (!document || !isMatchingOrg(document.organization_id, getRequestTenantId(req))) {
    return res.status(404).json({ error: "Document not found." });
  }
  if (!(await ensureAiAvailable(req, res))) return;
  const plainText = String(req.body?.plainText || "").trim().slice(0, 40000);
  if (!plainText) {
    return res.status(400).json({ error: "The document has no text to review yet." });
  }
  const actor = (req as any).actor;
  if (!actor) return res.status(401).json({ error: "UNAUTHENTICATED" });
  try {
    const selectedModel = getValidAiModel(req.body.model);
    const ctx = aiPolicyContext(document.organization_id);
    const regulatorLine = ctx.regulators.length > 0
      ? `Regulators relevant to our industry in ${ctx.countryName}: ${ctx.regulators.join(", ")}. Flag wording that conflicts with outsourcing, audit-right or reporting expectations they typically impose.`
      : "No specific sector regulator is configured; assess against general commercial law and good practice.";
    const prompt = `You are a senior corporate legal counsel performing AI-assisted contract redlining for ${ctx.organizationName}, a ${ctx.industryName} organization whose primary jurisdiction is ${ctx.countryName}.
Review the ENTIRE document below and propose specific clause-level redlines needed to align it with our governing-law position (${ctx.governingLaw}), our data-protection posture (${ctx.dataProtectionLaw}), and these industry rules — apply every rule that is actually triggered by the document's wording:
${ctx.clauseRules.map((rule) => `- ${rule}`).join("\n")}
${regulatorLine}
Compliance standards to check against: ${ctx.complianceStandards.join("; ")}.
Tax points to consider (${ctx.indirectTaxName} and withholding): ${ctx.taxConsiderations.join(" ")}
Write every "rationale" in ${ctx.responseLanguage}. Do not invent statute or regulation numbers — cite them only when certain, otherwise describe the requirement in general terms. Skip clauses that are already compliant. Return at most 20 suggestions, most severe first.

Each "quote" MUST be copied EXACTLY, character-for-character, from the document text below — a short excerpt (at most one sentence or clause), never paraphrased, never with added or removed whitespace, because it is used to locate the clause in the live document. "new_text" is the balanced replacement wording for that exact excerpt (or an empty string to recommend deleting it outright).

=== DOCUMENT: ${document.name} ===
${plainText}
`;
    const response = await generateContentWithRetryAndFallback({
      model: selectedModel,
      contents: [{ text: prompt }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            suggestions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  quote: { type: Type.STRING },
                  new_text: { type: Type.STRING },
                  rationale: { type: Type.STRING },
                },
                required: ["quote", "new_text", "rationale"],
              },
            },
          },
          required: ["suggestions"],
        },
      },
    });
    const parsed = JSON.parse((response as any).text);
    const rawSuggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    const nowIso = new Date().toISOString();
    const created: Array<{ id: string; quote: string; new_text: string }> = [];
    let skipped = 0;
    for (const item of rawSuggestions.slice(0, 20)) {
      const quote = String(item?.quote || "").trim();
      const newText = String(item?.new_text ?? "").trim();
      const rationale = String(item?.rationale || "").trim();
      // The model sometimes paraphrases despite instructions; a quote that isn't a
      // literal substring can never be anchored back into the document, so drop it
      // rather than filing an orphaned suggestion nobody can act on.
      if (!quote || !plainText.includes(quote)) {
        skipped++;
        continue;
      }
      const id = `cmt-${crypto.randomUUID()}`;
      await sql.run(`
        INSERT INTO contract_comments (id, contract_id, parent_id, comment_type, body, quote, new_text, status, author_id, created_at)
        VALUES (?, ?, NULL, 'suggestion', ?, ?, ?, 'open', ?, ?)
      `, id, document.id, rationale ? `AI Redlining: ${rationale}` : "AI Redlining suggestion.", quote, newText, actor.id, nowIso);
      created.push({ id, quote, new_text: newText });
    }
    res.status(201).json({ success: true, created, skipped });
  } catch (error: any) {
    log.error("Error during AI redlining:", error);
    sendRouteError(req, res, error, "request failed", "AI redlining failed. Please try again.", { status: 500 });
  }
});

async function persistContractTerminationFile(req: express.Request, record: { organizationId?: string; partner_id?: string }, file: TerminationFile) {
  const partner = await partnerRepository.get(String(record.organizationId ?? ""), String(record.partner_id ?? ""));
  const tenant = findTenant(record.organizationId);
  const storedName = `termination-${randomUUID()}.${file.extension}`;
  const url = await saveUpload(partner?.partner_name, 'Folder Termination', storedName, file.fileData, record.organizationId);
  return { fileName: file.fileName, url };
}

function terminationWriteError(res: express.Response, code: string) {
  return res.status(400).json({ code, error: CONTRACT_TERMINATION_TRANSLATIONS.EN[code] || code });
}

app.post("/api/contracts", validateBody(bodySchemas.contractCreateBody, { requiredMessage: "Nomor Kontrak, Judul, Partner, dan Tanggal Mula/Selesai wajib diisi." }), async (req: express.Request, res: express.Response) => {
  const {
    contract_number,
    contract_title,
    partner_id,
    document_type,
    parent_contract_id,
    parent_contract_number,
    cooperation_categories,
    start_date,
    end_date,
    currency,
    contract_value,
    contract_value_usd: req_usd,
    auto_renewal,
    notice_period_days,
    notice_type_required,
    status_approval,
    status,
    internal_pic,
    internal_notes,
    changed_fields,
    change_summary,
    fileName,
    fileData,
  } = req.body;
  if (
    !contract_number ||
    !contract_title ||
    !partner_id ||
    !start_date ||
    !end_date
  ) {
    return res
      .status(400)
      .json({
        error:
          "Nomor Kontrak, Judul, Partner, dan Tanggal Mula/Selesai wajib diisi.",
      });
  }
  if (new Date(end_date) <= new Date(start_date)) {
    return res
      .status(400)
      .json({ error: "Tanggal Berakhir harus setelah Tanggal Mulai." });
  }
  const lifecycleMode = contractLifecycleMode(req.body);
  const terminationError = validateContractTermination({ ...req.body, lifecycle_mode: req.body.lifecycle_mode ?? lifecycleMode });
  if (terminationError) return terminationWriteError(res, terminationError);
  let terminationFile: TerminationFile | undefined;
  try { terminationFile = parseTerminationFile(req.body.termination_document_file); }
  catch { return terminationWriteError(res, 'termination.file_invalid'); }
  const requestTenantId = getRequestTenantId(req);
  const existingContractDup = await contractRepository.findByNumber(requestTenantId, contract_number);
  if (existingContractDup) {
    return res
      .status(400)
      .json({
        error: `Nomor Kontrak '${contract_number}' sudah terdaftar dalam sistem.`,
      });
  }
  const targetOrgId = getRequestTenantId(req);
  const targetTenant = findTenant(targetOrgId);
  const partner = await partnerRepository.get(targetOrgId, String(partner_id ?? ""));
  if (!partner) return res.status(400).json({ error: "Partner tidak ditemukan." });
  const token = await resolveActiveGoogleToken(
    req.headers["x-google-access-token"] || req.body.accessToken,
  );
  const cur = normalizeCurrencyCode(currency, tenantDefaultCurrency(targetOrgId));
  const amt = Number(contract_value) || 0;
  let total_usd = req_usd;
  if (total_usd === void 0 || total_usd === null || isNaN(Number(total_usd))) {
    if (cur === "USD") {
      total_usd = amt;
    } else {
      let rate = getDefaultUsdRate(cur);
      try {
        const sheetId =
          targetTenant?.spreadsheetId || db.googleConfig?.spreadsheetId;
        rate = await getHistoricalExchangeRate(
          sheetId,
          token,
          cur,
          start_date,
        );
      } catch (e) {
        log.error("Failed fetching historical rate for contract:", e);
      }
      total_usd = Math.round(amt * rate * 100) / 100;
    }
  }
  const targetFileName = formatContractFileName({
    partnerName: partner?.partner_name,
    documentType: document_type || "Master Agreement",
    contractNumber: contract_number,
    startDate: start_date,
    rawFileName: fileName || `${contract_number}.pdf`,
  });
  let contract_file_link = "";
  if (
    fileData &&
    typeof fileData === "string" &&
    fileData.includes("base64,")
  ) {
    if (!contract_file_link) {
      contract_file_link = await saveUpload(
        partner?.partner_name,
        "Folder Contract",
        targetFileName,
        fileData,
        targetTenant?.id,
      );
      await logActivity(req, "UPLOAD_SUCCESS", "CONTRACT", `File Kontrak '${targetFileName}' disimpan di server lokal aplikasi (dicadangkan ke Google Drive otomatis jika terhubung)`);
    }
  }
  const lifecycleDraft: any = {
    organizationId: targetOrgId,
    start_date,
    end_date,
    auto_renewal: lifecycleMode !== 'terminated' && Boolean(auto_renewal),
    lifecycle_mode: lifecycleMode,
    termination_date: lifecycleMode === 'terminated' ? req.body.termination_date : null,
  };
  rollForwardAutoRenewal(lifecycleDraft);
  const finalTanggalBerakhir = lifecycleDraft.end_date;
  const { status: finalStatus, daysRemaining: diffDays } = contractLifecycle(lifecycleDraft, getTenantSettings(targetOrgId));
  const terminationDocument = terminationFile ? await persistContractTerminationFile(req, { organizationId: targetOrgId, partner_id }, terminationFile) : undefined;
  const newContract = {
    contract_id: await nextEntityId("contract"),
    organizationId: targetOrgId,
    document_type: document_type || "Master Agreement",
    parent_contract_id:
      document_type === "Agreement Addendum" ? parent_contract_id : void 0,
    parent_contract_number:
      document_type === "Agreement Addendum" ? parent_contract_number : void 0,
    contract_number,
    contract_title,
    partner_id,
    cooperation_categories: Array.isArray(cooperation_categories)
      ? cooperation_categories
      : ["Umum"],
    start_date,
    end_date: finalTanggalBerakhir,
    currency: cur,
    contract_value: amt,
    contract_value_usd: Number(total_usd),
    auto_renewal: lifecycleDraft.auto_renewal,
    lifecycle_mode: lifecycleMode,
    termination_date: lifecycleDraft.termination_date,
    termination_reason: String(req.body.termination_reason || '').trim().slice(0, 10000),
    termination_document: terminationDocument,
    notice_period_days: Number(notice_period_days) || 30,
    notice_type_required: notice_type_required || "Termination",
    status: finalStatus,
    status_approval: normalizeApprovalStatus(status_approval),
    internal_pic: internal_pic || "Legal Team",
    internal_notes: internal_notes ? String(internal_notes).trim() : void 0,
    contract_file_link,
    fileName: targetFileName,
    changed_fields: Array.isArray(changed_fields)
      ? changed_fields
      : void 0,
    change_summary: change_summary || void 0,
    // Analysis run on the add page before the contract existed.
    redline_analysis: req.body.redline_analysis && typeof req.body.redline_analysis === "object" ? req.body.redline_analysis : void 0,
    redline_analyzed_at: req.body.redline_analysis && typeof req.body.redline_analysis === "object" ? String(req.body.redline_analyzed_at || new Date().toISOString()) : void 0,
    days_remaining: diffDays,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const writeDenial = assertRecordWritable(req, "contract", newContract);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  const stored = await sql.tx(async () => {
    const row = await contractRepository.insert(newContract);
    await emitContractEvents(sql, null, row);
    return row;
  });
  await logActivity(req, "CREATE", "CONTRACT", `Membuat Kontrak Baru '${contract_number}' (${contract_title}) senilai ${formatAmountForTenant(amt, cur, targetOrgId)}`);
  await triggerAutoPushToGoogleSheet(req, { tenantId: targetOrgId });
  res.json({ success: true, contract: stored });
});
app.put("/api/contracts/:id", validateBody(bodySchemas.contractUpdateBody), async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  // The schema is the whitelist: ids, organization, timestamps, creator and derived fields never come from the client.
  const { fileData, fileName, termination_document_file, accessToken: _accessToken, version: clientVersion, ...updates } = req.body;
  const existing = await contractRepository.get(getRequestTenantId(req), id);
  if (!existing) {
    return res.status(404).json({ error: "Kontrak tidak ditemukan." });
  }
  // The version the client last saw (body `version` or If-Match) guards against overwriting someone else's edit; clients that
  // send none are still protected for the duration of this request (the version read above).
  const expectedVersion = requestedVersion(req, clientVersion) ?? existing.version;
  const tenantDenial = assertRecordAccess(req, "contract", existing);
  if (tenantDenial) return res.status(tenantDenial.status).json(tenantDenial.body);
  const updated = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  // Status-only legacy clients may still request a lifecycle transition.
  if (updates.lifecycle_mode === undefined && updates.status !== undefined) {
    updated.lifecycle_mode = normalizeContractStatus(updates.status) === 'Terminated' ? 'terminated' : 'normal';
  }
  updated.lifecycle_mode = contractLifecycleMode(updated);
  if (updated.lifecycle_mode === 'normal') updated.termination_date = null;
  const unchangedLegacyTermination = existing.status === 'Terminated' && !existing.termination_date && updates.lifecycle_mode === undefined && updates.status === undefined;
  const terminationError = unchangedLegacyTermination ? null : validateContractTermination(updated);
  if (terminationError) return terminationWriteError(res, terminationError);
  let terminationFile: TerminationFile | undefined;
  try { terminationFile = parseTerminationFile(termination_document_file); }
  catch { return terminationWriteError(res, 'termination.file_invalid'); }
  updated.termination_reason = String(updated.termination_reason || '').trim().slice(0, 10000);
  if (updated.lifecycle_mode === 'terminated') updated.auto_renewal = false;
  const cur = normalizeCurrencyCode(updated.currency || existing.currency, tenantDefaultCurrency(existing.organizationId));
  updated.currency = cur;
  const amt = Number(updated.contract_value) || 0;
  let total_usd = updates.contract_value_usd;
  if (total_usd === void 0 || total_usd === null || isNaN(Number(total_usd))) {
    if (cur === "USD") {
      total_usd = amt;
    } else {
      let rate = getDefaultUsdRate(cur);
      try {
        const token = await resolveActiveGoogleToken(
          req.headers["x-google-access-token"] || req.body.accessToken,
        );
        const startDate = updated.start_date || existing.start_date;
        rate = await getHistoricalExchangeRate(
          db.googleConfig.spreadsheetId,
          token,
          cur,
          startDate,
        );
      } catch (e) {
        log.error("Failed fetching rate for edit contract:", e);
      }
      total_usd = Math.round(amt * rate * 100) / 100;
    }
  }
  updated.currency = cur;
  updated.contract_value = amt;
  updated.contract_value_usd = Number(total_usd);
  if (
    updated.start_date &&
    updated.end_date &&
    new Date(updated.end_date) <= new Date(updated.start_date)
  ) {
    return res
      .status(400)
      .json({ error: "Tanggal Berakhir harus setelah Tanggal Mulai." });
  }
  if (updated.contract_number) {
    const dup = await contractRepository.findByNumber(existing.organizationId, updated.contract_number, id);
    if (dup) {
      return res
        .status(400)
        .json({
          error: `Nomor Kontrak '${updated.contract_number}' sudah digunakan oleh kontrak lain.`,
        });
    }
  }
  if (
    fileData &&
    typeof fileData === "string" &&
    fileData.includes("base64,")
  ) {
    const partner = await partnerRepository.get(existing.organizationId, String(updated.partner_id ?? ""));
    const targetFileName = formatContractFileName({
      partnerName: partner?.partner_name,
      documentType: updated.document_type || "Master Agreement",
      contractNumber: updated.contract_number,
      startDate: updated.start_date,
      rawFileName:
        fileName || updated.fileName || `${updated.contract_number}.pdf`,
    });
    const token = await resolveActiveGoogleToken(
      req.headers["x-google-access-token"] || req.body.accessToken,
    );
    let contract_file_link = "";
    if (!contract_file_link) {
      contract_file_link = await saveUpload(
        partner?.partner_name,
        "Folder Contract",
        targetFileName,
        fileData,
        existing.organizationId,
      );
      await logActivity(req, "UPLOAD_SUCCESS", "CONTRACT", `File Kontrak '${targetFileName}' disimpan di server lokal aplikasi (dicadangkan ke Google Drive otomatis jika terhubung)`);
    }
    updated.contract_file_link = contract_file_link;
    updated.fileName = targetFileName;
  }
  if (terminationFile) updated.termination_document = await persistContractTerminationFile(req, updated, terminationFile);
  updated.status = normalizeContractStatus(updated.status);
  updated.status_approval = normalizeApprovalStatus(updated.status_approval);
  rollForwardAutoRenewal(updated);
  const lifecycle = contractLifecycle(updated, getTenantSettings(updated.organizationId));
  updated.days_remaining = lifecycle.daysRemaining ?? updated.days_remaining;
  updated.status = lifecycle.status;
  updated.organizationId = existing.organizationId;
  const writeDenial = assertRecordWritable(req, "contract", updated);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  const stored = await sql.tx(async () => {
    const row = await contractRepository.update(updated, expectedVersion);
    await emitContractEvents(sql, existing, row);
    return row;
  });
  await logActivity(req, "UPDATE", "CONTRACT", `Memperbarui data Kontrak '${updated.contract_number}'`);
  await triggerAutoPushToGoogleSheet(req);
  res.json({ success: true, contract: stored });
});
app.delete("/api/contracts/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const ctr = await contractRepository.get(getRequestTenantId(req), id);
  if (!ctr) return res.status(404).json({ error: "Kontrak tidak ditemukan." });
  const tenantDenial = assertRecordAccess(req, "contract", ctr);
  if (tenantDenial) return res.status(tenantDenial.status).json(tenantDenial.body);
  // One transaction, so the contract is never gone while an order still points at it, or the other way round.
  await sql.tx(async () => {
    await notificationRepository.removeByParents(ctr.organizationId, [id], 'Contract');
    await ioRepository.detachContract(ctr.organizationId, id);
    await contractRepository.removeWithChildren(ctr.organizationId, id);
  });
  await logActivity(req, "DELETE", "CONTRACT", `Menghapus Kontrak '${ctr.contract_number}' (${ctr.contract_title})`);
  await triggerAutoPushToGoogleSheet(req);
  res.json({ success: true });
});
  return app;
}
