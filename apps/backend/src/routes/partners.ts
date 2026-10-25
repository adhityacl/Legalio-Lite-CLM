import { nextEntityId } from '../ids';
import { contractRepository } from '../repositories/contractRepository';
import { sql } from '../db';
import { ioRepository } from '../repositories/ioRepository';
import { spendingRepository } from '../repositories/spendingRepository';
import { notificationRepository } from '../repositories/notificationRepository';
import { evaluationRepository } from '../repositories/evaluationRepository';
import { partnerRepository, PARTNER_SORTS, type PartnerQuery } from '../repositories/partnerRepository';
import { recordVisible } from '../recordScope';
import { hasOrganizationScope } from '../rbac';
import { generateRedlineAnalysis } from '../redlineAnalysis';
import * as bodySchemas from '../schemas';
import { scopedRecords, getRequestTenantId, assertRecordAccess, assertRecordWritable, logActivity, orgContextOf, scopeOf } from '../recordAccess';
import { db, sanitizePartnerTags, sanitizeCountryCode, countryNameForPrompt, sanitizeIdentifiers } from '../memoryDb';
import { upload } from '../uploadMiddleware';
import { ensureAiAvailable, getValidAiModel, generateContentWithRetryAndFallback, withDocumentTranscriptField, extractAndCacheDocumentTranscript } from '../aiClient';
import { computeInputSha256, globalOcrCache, buildCheapOcrContents } from '../lib/cheapOcrPipeline';
import { aiPolicyContext, normalizePartnerDocuments, computeDueDiligenceStatus } from '../tenantPolicy';
import { Type } from '@google/genai';
import { sendRouteError } from '../apiErrors';
import { validateBody } from '../validation';
import { requestedVersion } from '../requestVersion';
import { formatDueDiligenceFileName } from '@legalio/shared/fileNaming';
import { saveUpload } from '../uploadStorage';
import { daysUntilForTenant } from '../mailHelpers';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { componentLog } from '../logger';
const log = componentLog('partners');

export function createPartnersRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

const queryText = (value: unknown, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const queryList = (value: unknown) => queryText(value, 500).split(",").map((v) => v.trim()).filter(Boolean).slice(0, 20);
/** Paged-list parameters of GET /api/partners; `paged` is false when the request asks for the classic full list. */
function partnerListQuery(query: express.Request["query"]): PartnerQuery & { paged: boolean; filtered: boolean } {
  const requested = queryText(query.sort, 40);
  const limit = query.limit === undefined ? undefined : Math.min(500, Math.max(1, Math.trunc(Number(query.limit)) || 50));
  const paged = limit !== undefined || query.offset !== undefined;
  const filters = { internalPic: queryList(query.internal_pic), partnerType: queryList(query.partner_type), statusDd: queryList(query.status_dd), country: queryList(query.country), excludeCountry: queryList(query.exclude_country) };
  const partnerStatus = ["Active", "Inactive"].includes(queryText(query.partner_status, 10)) ? queryText(query.partner_status, 10) as "Active" | "Inactive" : undefined;
  const q = queryText(query.q, 200) || undefined;
  const sort = (PARTNER_SORTS as readonly string[]).includes(requested) ? requested as PartnerQuery["sort"] : (paged || requested ? "partner_name" : "default");
  return {
    paged, filtered: Boolean(q) || Boolean(partnerStatus) || Object.values(filters).some((list) => list.length) || query.sort !== undefined,
    q, ...filters, partnerStatus, deep: query.deep === "1" || query.deep === "true", sort, dir: queryText(query.dir, 4).toLowerCase() === "desc" ? "desc" : "asc",
    limit: limit ?? (query.offset !== undefined ? 50 : undefined), offset: Math.max(0, Math.trunc(Number(query.offset)) || 0),
  };
}
const presentPartner = (p: any) => ({ ...p, tags: sanitizePartnerTags(p.tags) });
/**
 * Without list parameters: every visible partner as a bare array (unchanged). With limit/offset/q/sort or a filter (internal_pic,
 * partner_type, status_dd, country; comma lists): the matching visible partners, one page at a time, the total in `X-Total-Count`.
 */
app.get("/api/partners", async (req: express.Request, res: express.Response) => {
  const query = partnerListQuery(req.query);
  if (!query.paged && !query.filtered) return res.json((await scopedRecords(req, "partner")).map(presentPartner));
  const ctx = orgContextOf(req);
  const organizationId = getRequestTenantId(req);
  let rows: any[];
  let total: number;
  if (hasOrganizationScope(ctx)) {
    ({ rows, total } = await partnerRepository.list(organizationId, query));
  } else {
    // Department roles see a subset decided by partner ownership: filter the matches, then page.
    const matched = (await partnerRepository.list(organizationId, { ...query, limit: undefined, offset: 0 })).rows
      .filter((row) => recordVisible(ctx, scopeOf(req), "partner", row));
    total = matched.length;
    rows = query.limit === undefined ? matched : matched.slice(query.offset, (query.offset ?? 0) + query.limit);
  }
  res.setHeader("X-Total-Count", String(total));
  res.setHeader("Access-Control-Expose-Headers", "X-Total-Count");
  res.json(rows.map(presentPartner));
});
app.post("/api/partners/parse", upload.single("file") as any, async (req: express.Request, res: express.Response) => {
  if (!(await ensureAiAvailable(req, res))) return;
  try {
    const inputData = req.file?.buffer || req.body?.pdfBase64 || req.body?.fileBase64;
    const model = req.body?.model;
    if (!inputData) {
      return res.status(400).json({ error: "File (binary or base64) is required" });
    }

    const tenantId = getRequestTenantId(req);
    const inputHash = computeInputSha256(inputData);
    const cacheScope = `partners:${tenantId}`;
    const cached = await globalOcrCache.get(inputHash, cacheScope);
    if (cached) {
      return res.json({
        ...cached,
        cached: true,
      });
    }

    const ctx = aiPolicyContext(tenantId);
    const prompt = `You are an expert legal document assistant. Extract the following information about the counterparty (partner/vendor/customer) from this contract or agreement so it can be registered in a contract management system. Our own organization is "${ctx.organizationName}" — never return our organization as the counterparty.

1. "partner_name": the counterparty's full legal name exactly as written, including its legal form (e.g. "Pte. Ltd.", "Sdn. Bhd.", "PT", "Co., Ltd."). Do not abbreviate.
2. "country": ISO 3166-1 alpha-2 code of the counterparty's country of incorporation (e.g. "SG", "ID", "IN", "JP"). Return "" if it cannot be determined.
3. "entity_type": the counterparty's legal form as written (e.g. "Private Limited", "Sendirian Berhad", "Perseroan Terbatas"). Return "" if unknown.
4. "pic_name": the counterparty's contact person or team named in the notices/correspondence clause. Return "-" if absent.
5. "pic_email": the counterparty's main notice e-mail address. Return "-" if absent.
6. "pic_phone": the counterparty's phone number in international format (E.164, e.g. "+6591234567") when possible. Return "-" if absent.
7. "pic_address": the counterparty's registered or correspondence address. Return "-" if absent.
8. "notes": acting as a senior due-diligence and vendor-risk analyst, write ONE concise narrative paragraph in ${ctx.responseLanguage} describing the counterparty's core business, the services relevant to this agreement, notable technology or assets, and its jurisdictional context. No bullet points or headings; start directly with the entity name. Do not include personal identification numbers.

Return strictly one valid JSON object matching the schema.`;
    const { contents: ocrContents, ocrStats } = await buildCheapOcrContents(
      inputData,
      prompt,
    );
    log.info(
      `[PDF-Inspector Partner Parser] Mode: ${ocrStats.mode.toUpperCase()} (${ocrStats.classification}), Inspected in ${ocrStats.inspectionMs}ms, Pages: ${ocrStats.originalPages} (${ocrStats.originalKb}KB) -> ${ocrStats.processedPages} (${ocrStats.optimizedKb}KB), DigitalText: ${ocrStats.hasDigitalText}, Hash: ${ocrStats.fileHash.slice(0, 8)}`,
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
              partner_name: { type: Type.STRING },
              country: { type: Type.STRING },
              entity_type: { type: Type.STRING },
              pic_name: { type: Type.STRING },
              pic_email: { type: Type.STRING },
              pic_phone: { type: Type.STRING },
              pic_address: { type: Type.STRING },
              notes: { type: Type.STRING },
            },
          },
          ocrStats.mode,
        ),
      },
    });
    const parsedData = JSON.parse((response as any).text);
    await extractAndCacheDocumentTranscript(parsedData, ocrStats.fileHash);
    const responsePayload = { success: true, data: parsedData, ocrStats };
    if (ocrStats.fileHash) {
      await globalOcrCache.set(ocrStats.fileHash, cacheScope, responsePayload);
    }
    res.json(responsePayload);
  } catch (error) {
    log.error("Error parsing partner:", error);
    sendRouteError(req, res, error, "request failed", "Failed to parse document. Google AI model is currently busy, please try again.", { status: 500 });
  }
});
app.post("/api/partners/generate-dd-notes", async (req: express.Request, res: express.Response) => {
  if (!(await ensureAiAvailable(req, res))) return;
  try {
    const { partner_name, country, entity_type, tags, model, pdfBase64 } = req.body;
    if (!partner_name) {
      return res
        .status(400)
        .json({ error: "Partner name is required." });
    }
    const selectedModel = getValidAiModel(model);
    const contents = [];
    if (pdfBase64 && typeof pdfBase64 === "string") {
      contents.push({
        inlineData: {
          data: pdfBase64.includes("base64,")
            ? pdfBase64.split("base64,")[1]
            : pdfBase64,
          mimeType: "application/pdf",
        },
      });
    }
    const ctx = aiPolicyContext(getRequestTenantId(req));
    const countryName = sanitizeCountryCode(country) ? countryNameForPrompt(sanitizeCountryCode(country)) : "";
    const prompt = `Act as a senior due-diligence and vendor-risk analyst for ${ctx.organizationName}, an organization in the ${ctx.industryName} industry operating in ${ctx.countryName}.

Summarise the counterparty below in ONE comprehensive, professional paragraph written in ${ctx.responseLanguage}.

Counterparty: "${String(partner_name).slice(0, 200)}"${countryName ? ` (incorporated in ${countryName})` : ""}${entity_type ? ` — legal form: ${String(entity_type).slice(0, 120)}` : ""}${Array.isArray(tags) && tags.length > 0 ? ` — relationship categories: ${tags.slice(0, 10).join(", ")}` : ""}

The paragraph must flow through: (1) core business and specialisation, (2) the products or services relevant to this relationship, (3) notable technology, assets or certifications, and (4) jurisdictional and risk context relevant to ${ctx.industryName} (for example: ${ctx.reviewFocus.slice(0, 3).join(", ")}).

Output rules: exactly one paragraph, no bullet points or headings, no opening or closing pleasantries, start with the entity name, and never invent registration or identification numbers.`;
    contents.push({ text: prompt });
    const response = await generateContentWithRetryAndFallback({
      model: selectedModel,
      contents,
    });
    const notesText = ((response as any).text || "").trim();
    res.json({ success: true, notes: notesText });
  } catch (error) {
    log.error("Error generating DD notes:", error);
    sendRouteError(req, res, error, "request failed", "Gagal menghasilkan ringkasan Due Diligence AI.", { status: 500 });
  }
});
/** AI due-diligence review of the partner form's current values; an existing partner stores the result right away. */
app.post("/api/partners/review-analysis", async (req: express.Request, res: express.Response) => {
  const draft = req.body?.partner;
  if (!draft || typeof draft !== "object" || !String(draft.partner_name || "").trim()) {
    return res.status(400).json({ error: "Partner name is required." });
  }
  const saved = draft.partner_id ? await partnerRepository.get(getRequestTenantId(req), String(draft.partner_id)) : undefined;
  if (draft.partner_id && (!saved || assertRecordAccess(req, "partner", saved) || assertRecordWritable(req, "partner", saved))) {
    return res.status(404).json({ error: "Partner tidak ditemukan." });
  }
  if (!(await ensureAiAvailable(req, res))) return;
  const text = (v: unknown, max = 2000) => (v == null || v === "" ? "-" : String(v).slice(0, max));
  const country = sanitizeCountryCode(draft.country);
  const identifiers = sanitizeIdentifiers(draft.identifiers);
  // Only the e-mail domain is sent: it tells corporate vs free-mail without sharing the PIC's personal data.
  const emailDomain = String(draft.pic_email || "").split("@")[1]?.trim().toLowerCase() || "-";
  const documents = Array.isArray(saved?.dd_documents) ? saved.dd_documents : [];
  const ctx = aiPolicyContext(getRequestTenantId(req));
  const prompt = `You are a senior vendor-risk and due-diligence analyst acting for ${ctx.organizationName}, a ${ctx.industryName} organization in ${ctx.countryName}.
Assess onboarding risk for the counterparty below and recommend concrete due-diligence actions. Write every narrative field (titles, summary, findings, actions and notes) in English.

=== COUNTERPARTY ===
Legal name: ${text(draft.partner_name, 300)}
Country of incorporation: ${country ? countryNameForPrompt(country) : "unknown"}
Legal form: ${text(draft.entity_type, 120)}
Registration / tax identifiers: ${identifiers.length ? identifiers.map((i: any) => `${i.scheme} (${i.country || "-"})`).join(", ") : "none provided"}
Partnership categories: ${Array.isArray(draft.tags) && draft.tags.length ? draft.tags.map(String).slice(0, 20).join(", ") : "-"}
PIC e-mail domain: ${emailDomain}
Internal notes: ${text(draft.notes)}
Due-diligence documents on file: ${documents.length ? documents.map((d: any) => `${d.name} [${d.required ? "required" : "optional"}, ${d.status}${d.expiryDate ? `, expires ${d.expiryDate}` : ""}]`).join("; ") : "none yet (new partner)"}

=== REVIEW INSTRUCTIONS ===
You have NO access to company registries, sanctions lists, PEP lists or adverse media. Never state that the counterparty is verified, clean or listed; instead recommend the screening step that should be done.
Assess: jurisdiction risk (cross-border tax such as withholding and tax-treaty documents, ${ctx.indirectTaxName}, cross-border data transfer under ${ctx.dataProtectionLaw}); whether the legal form and identifiers fit the country; missing or expired due-diligence documents; risk of the partnership categories for a ${ctx.industryName} organization (${ctx.reviewFocus.join("; ")}); and contact red flags such as a free-mail domain for a corporate counterparty.
${ctx.regulators.length ? `Regulators relevant to us: ${ctx.regulators.join(", ")} — consider their third-party / outsourcing expectations.` : ""}
Do not invent statute or regulation numbers.

Return JSON with exactly:
1. overallRiskScore: integer 0-100 (0-25 low, 26-55 moderate, 56-75 high, 76-100 critical).
2. riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL".
3. executiveSummary: one short paragraph on the counterparty profile, jurisdiction and readiness to onboard.
4. keyFindings: 2-4 of the most important issues.
5. analyzedClauses: 2-5 items, each with clauseTitle (short topic), riskCategory, severity ("LOW"|"MEDIUM"|"HIGH"|"CRITICAL"), originalTextOrIssue (the finding), identifiedRisk, recommendedRedline (the concrete recommended action, e.g. which document to request or which clause to add to the contract) and legalRationale.
6. complianceChecklist: 3-5 items, each with item, status ("COMPLIANT" | "NEEDS_REVIEW" | "NON_COMPLIANT") and notes.
`;
  try {
    const analysis = await generateRedlineAnalysis(req, prompt);
    // Row-locked server-side edit: the stored result never overwrites (or fails on) a user's concurrent edit of other fields.
    const stored = saved ? await partnerRepository.mutate(saved.organizationId, saved.partner_id, (row) => {
      row.redline_analysis = analysis;
      row.redline_analyzed_at = analysis.analyzed_at;
      row.updated_at = analysis.analyzed_at;
    }) : undefined;
    res.json({ success: true, analysis, analyzed_at: analysis.analyzed_at, saved: Boolean(stored) });
  } catch (error) {
    log.error("Error during partner review:", error);
    sendRouteError(req, res, error, "request failed", "Gagal melakukan analisis AI. Silakan coba kembali.", { status: 500 });
  }
});

app.post("/api/partners", validateBody(bodySchemas.partnerCreateBody, { requiredMessage: "Nama Partner wajib diisi." }), async (req: express.Request, res: express.Response) => {
  const {
    partner_name,
    codename,
    country,
    entity_type,
    identifiers,
    partner_type,
    pic_name,
    pic_email,
    pic_phone,
    pic_address,
    pic_contact,
    internal_pic,
    notes,
    tags,
  } = req.body;
  if (!partner_name) {
    return res.status(400).json({ error: "Nama Partner wajib diisi." });
  }
  const targetOrgId = getRequestTenantId(req);
  const partnerCountry = sanitizeCountryCode(country);
  const defaultDD = normalizePartnerDocuments({ organizationId: targetOrgId, country: partnerCountry, dd_documents: [] });
  const newPartner = {
    partner_id: await nextEntityId("partner"),
    organizationId: targetOrgId,
    partner_name,
    codename: codename || "",
    country: partnerCountry,
    entity_type: String(entity_type || "").slice(0, 120),
    identifiers: sanitizeIdentifiers(identifiers),
    partner_type: partner_type || "Vendor",
    pic_name: pic_name || "",
    pic_email: pic_email || "",
    pic_phone: pic_phone || "",
    pic_address: pic_address || "",
    pic_contact:
      pic_contact ||
      (pic_email && pic_phone ? `${pic_email} / ${pic_phone}` : ""),
    internal_pic: internal_pic || "",
    status_dd: computeDueDiligenceStatus(defaultDD),
    dd_folder_link: "",
    dd_documents: defaultDD,
    notes: notes || "",
    tags: sanitizePartnerTags(tags),
    // Review run on the add page before the partner existed.
    redline_analysis: req.body.redline_analysis && typeof req.body.redline_analysis === "object" ? req.body.redline_analysis : void 0,
    redline_analyzed_at: req.body.redline_analysis && typeof req.body.redline_analysis === "object" ? String(req.body.redline_analyzed_at || new Date().toISOString()) : void 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const writeDenial = assertRecordWritable(req, "partner", newPartner);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  const stored = await partnerRepository.insert(newPartner);
  await logActivity(req, "CREATE", "PARTNER", `Menambahkan Partner baru: ${partner_name}${partnerCountry ? ` (${partnerCountry})` : ""}`);
  res.json({ success: true, partner: stored });
});
app.put("/api/partners/:id", validateBody(bodySchemas.partnerUpdateBody), async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const {
    partner_name,
    codename,
    country,
    entity_type,
    identifiers,
    partner_type,
    pic_name,
    pic_email,
    pic_phone,
    pic_address,
    pic_contact,
    internal_pic,
    notes,
    tags,
    dd_documents,
    version: clientVersion,
  } = req.body;
  const existing = await partnerRepository.get(getRequestTenantId(req), id);
  if (!existing) {
    return res.status(404).json({ error: "Partner tidak ditemukan." });
  }
  // The version the client last saw (body `version` or If-Match) guards against overwriting someone else's edit; clients that
  // send none are still protected for the duration of this request (the version read above).
  const expectedVersion = requestedVersion(req, clientVersion) ?? existing.version;
  const tenantDenial = assertRecordAccess(req, "partner", existing);
  if (tenantDenial) return res.status(tenantDenial.status).json(tenantDenial.body);
  const nextCountry = country !== void 0 ? sanitizeCountryCode(country) : existing.country || "";
  const nextDocuments = normalizePartnerDocuments({
    organizationId: existing.organizationId,
    country: nextCountry,
    dd_documents: Array.isArray(dd_documents) ? dd_documents : existing.dd_documents,
  });
  const status_dd = computeDueDiligenceStatus(nextDocuments);
  const updatedPartner: any = {
    ...existing,
    partner_name: partner_name || existing.partner_name,
    codename: codename !== void 0 ? codename : existing.codename,
    country: nextCountry,
    entity_type: entity_type !== void 0 ? String(entity_type).slice(0, 120) : existing.entity_type || "",
    identifiers: identifiers !== void 0 ? sanitizeIdentifiers(identifiers) : existing.identifiers || [],
    partner_type: partner_type || existing.partner_type || "Vendor",
    pic_name: pic_name !== void 0 ? pic_name : existing.pic_name,
    pic_email: pic_email !== void 0 ? pic_email : existing.pic_email,
    pic_phone: pic_phone !== void 0 ? pic_phone : existing.pic_phone,
    pic_address: pic_address !== void 0 ? pic_address : existing.pic_address,
    pic_contact: pic_contact !== void 0 ? pic_contact : existing.pic_contact,
    internal_pic:
      internal_pic !== void 0 ? internal_pic : existing.internal_pic,
    notes: notes !== void 0 ? notes : existing.notes,
    tags:
      tags !== void 0
        ? sanitizePartnerTags(tags)
        : sanitizePartnerTags(existing.tags),
    dd_documents: nextDocuments,
    status_dd,
    dd_verified_date:
      status_dd === "Complete" && existing.status_dd !== "Complete"
        ? new Date().toISOString().split("T")[0]
        : existing.dd_verified_date,
    updated_at: new Date().toISOString(),
  };
  updatedPartner.organizationId = existing.organizationId;
  const writeDenial = assertRecordWritable(req, "partner", updatedPartner);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  const stored = await partnerRepository.update(updatedPartner, expectedVersion);
  await logActivity(req, "DD_UPDATE", "PARTNER", `Memperbarui profil & status DD Partner ${updatedPartner.partner_name} menjadi '${status_dd}'`);
  res.json({ success: true, partner: stored });
});
app.delete("/api/partners/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const partner = await partnerRepository.get(getRequestTenantId(req), id);
  if (!partner) {
    return res.status(404).json({ error: "Partner tidak ditemukan." });
  }
  const tenantDenial = assertRecordAccess(req, "partner", partner);
  if (tenantDenial) return res.status(tenantDenial.status).json(tenantDenial.body);
  // One transaction: the partner, its contracts, orders and notifications go together; invoices and evaluations lose the link only.
  // The partner row is locked first, so a contract being created for it meanwhile either lands before (and goes too) or fails its foreign key.
  const { contractIds, ioIds } = await sql.tx(async () => {
    await sql.get("SELECT 1 FROM partners WHERE organization_id = ? AND partner_id = ? FOR UPDATE", partner.organizationId, id);
    const contractIds = await contractRepository.idsByPartner(partner.organizationId, id);
    const ioIds = await ioRepository.idsByPartnerOrContracts(partner.organizationId, id, contractIds);
    await notificationRepository.removeByParents(partner.organizationId, [...contractIds, ...ioIds]);
    await spendingRepository.detachVendor(partner.organizationId, id);
    await evaluationRepository.detachPartner(partner.organizationId, id);
    await ioRepository.removeMany(partner.organizationId, ioIds);
    await contractRepository.removeByPartner(partner.organizationId, id);
    await partnerRepository.remove(partner.organizationId, id);
    return { contractIds, ioIds };
  });
  await logActivity(req, "DELETE", "PARTNER", `Menghapus Partner '${partner.partner_name}' beserta ${contractIds.length} Kontrak dan ${ioIds.length} Insertion Order pendukung.`);
  res.json({
    success: true,
    deletedContractsCount: contractIds.length,
    deletedIosCount: ioIds.length,
  });
});
app.post("/api/partners/:id/upload-dd", validateBody(bodySchemas.partnerUploadDdBody), async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const {
    docName,
    fileName,
    fileData,
    documentNumber,
    expiryDate,
  } = req.body;
  const partner = await partnerRepository.get(getRequestTenantId(req), id);
  if (!partner) {
    return res.status(404).json({ error: "Partner tidak ditemukan." });
  }
  const uploadDenial = assertRecordAccess(req, "partner", partner);
  if (uploadDenial) return res.status(uploadDenial.status).json(uploadDenial.body);
  const docObj = (partner.dd_documents || []).find((d) => d.name === docName);
  const currentFilesCount = (docObj?.files || []).length;
  const finalFileName =
    fileName ||
    formatDueDiligenceFileName({
      vendorName: partner.partner_name,
      documentName: docName,
      documentDate: expiryDate || new Date().toISOString(),
      sequence: currentFilesCount + 1,
      rawFileName: "document.pdf",
    });
  let driveLink = "";
  if (
    fileData &&
    typeof fileData === "string" &&
    fileData.includes("base64,")
  ) {
    driveLink = await saveUpload(
      partner.partner_name,
      "Folder DD",
      finalFileName,
      fileData,
      partner.organizationId,
    );
    await logActivity(req, "UPLOAD_SUCCESS", "PARTNER", `Dokumen DD '${finalFileName}' untuk vendor '${partner.partner_name}' disimpan di penyimpanan file aplikasi`);
  }
  // Row-locked edit of the partner as it is now: concurrent uploads to different documents (or a form save) all land.
  const stored = await partnerRepository.mutate(partner.organizationId, id, (partner) => {
  partner.dd_documents = (partner.dd_documents || []).map((doc) => {
    if (doc.name === docName) {
      const nowIso = new Date().toISOString();
      const newFileItem = driveLink
        ? {
            id:
              "dd_file_" +
              Date.now() +
              "_" +
              Math.random().toString(36).substring(2, 7),
            fileName: finalFileName,
            linkDrive: driveLink,
            uploadedAt: nowIso,
            year: new Date().getFullYear().toString(),
            expiryDate: expiryDate || "",
          }
        : null;
      const existingFiles = doc.files || [];
      if (
        existingFiles.length === 0 &&
        doc.linkDrive &&
        doc.linkDrive !== driveLink
      ) {
        existingFiles.push({
          id: "dd_file_prev_" + Date.now(),
          fileName: `${doc.name} (Versi Sebelumnya).pdf`,
          linkDrive: doc.linkDrive,
          uploadedAt: doc.uploadedAt || nowIso,
          year: doc.uploadedAt
            ? new Date(doc.uploadedAt).getFullYear().toString()
            : "",
          expiryDate: doc.expiryDate || "",
        });
      }
      const updatedFiles = newFileItem
        ? [
            newFileItem,
            ...existingFiles.filter((f) => f.linkDrive !== driveLink),
          ]
        : existingFiles;
      const expiry = expiryDate || doc.expiryDate;
      const expiryDays = expiry ? daysUntilForTenant(partner.organizationId, expiry) : null;
      return {
        ...doc,
        status: updatedFiles.length === 0 ? "Missing" : expiryDays !== null && expiryDays < 0 ? "Expired" : "Available",
        documentNumber: documentNumber || doc.documentNumber || "",
        expiryDate: expiryDate || doc.expiryDate,
        linkDrive: driveLink || doc.linkDrive || "",
        uploadedAt: driveLink ? nowIso : doc.uploadedAt,
        files: updatedFiles,
      };
    }
    return doc;
  });
  const previousDdStatus = partner.status_dd;
  partner.status_dd = computeDueDiligenceStatus(partner.dd_documents);
  if (partner.status_dd === "Complete" && previousDdStatus !== "Complete") {
    partner.dd_verified_date = new Date().toISOString().split("T")[0];
  }
  partner.updated_at = new Date().toISOString();
  });
  await logActivity(req, "DD_UPDATE", "PARTNER", `Mengunggah dokumen DD '${docName}' untuk partner ${partner.partner_name}`);
  res.json({ success: true, partner: stored ?? partner });
});
app.delete("/api/partners/:id/dd-file", validateBody(bodySchemas.partnerDdFileDeleteBody), async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { docName, fileId } = req.body;
  const partner = await partnerRepository.get(getRequestTenantId(req), id);
  if (!partner) {
    return res.status(404).json({ error: "Partner tidak ditemukan." });
  }
  const deleteDenial = assertRecordAccess(req, "partner", partner);
  if (deleteDenial) return res.status(deleteDenial.status).json(deleteDenial.body);
  const stored = await partnerRepository.mutate(partner.organizationId, id, (partner) => {
  partner.dd_documents = (partner.dd_documents || []).map((doc) => {
    if (doc.name === docName) {
      const remainingFiles = (doc.files || []).filter((f) => f.id !== fileId);
      const hasFiles = remainingFiles.length > 0;
      return {
        ...doc,
        files: remainingFiles,
        status: hasFiles ? "Available" : "Missing",
        linkDrive: hasFiles ? remainingFiles[0].linkDrive : void 0,
        uploadedAt: hasFiles ? remainingFiles[0].uploadedAt : void 0,
      };
    }
    return doc;
  });
  const previousDdStatus = partner.status_dd;
  partner.status_dd = computeDueDiligenceStatus(partner.dd_documents);
  if (partner.status_dd === "Complete" && previousDdStatus !== "Complete") {
    partner.dd_verified_date = new Date().toISOString().split("T")[0];
  }
  partner.updated_at = new Date().toISOString();
  });
  await logActivity(req, "DELETE", "PARTNER", `Menghapus file dari dokumen DD '${docName}' partner ${partner.partner_name}`);
  res.json({ success: true, partner: stored ?? partner });
});
  return app;
}
