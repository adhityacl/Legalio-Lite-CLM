import { partnerRepository } from '../repositories/partnerRepository';
import { nextEntityId } from '../ids';
import { computeEvaluationScore } from '../evaluationScoring';
import * as bodySchemas from '../schemas';
import { scopedRecords, getRequestTenantId, assertRecordAccess, assertRecordWritable, logActivity, orgContextOf, scopeOf } from '../recordAccess';
import { evaluationRepository, EVALUATION_SORTS, type EvaluationQuery } from '../repositories/evaluationRepository';
import { requestedVersion } from '../requestVersion';
import { recordVisible } from '../recordScope';
import { hasOrganizationScope } from '../rbac';
import { countryNameForPrompt } from '../memoryDb';
import { ensureAiAvailable } from '../aiClient';
import { aiPolicyContext } from '../tenantPolicy';
import { generateRedlineAnalysis, REVIEW_GUIDE } from '../redlineAnalysis';
import { sendRouteError } from '../apiErrors';
import { validateBody } from '../validation';
import { identityOf } from '../identity';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { componentLog } from '../logger';
const log = componentLog('evaluations');

export function createEvaluationsRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

const queryText = (value: unknown, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const queryList = (value: unknown) => queryText(value, 500).split(",").map((v) => v.trim()).filter(Boolean).slice(0, 20);
/** Paged-list parameters of GET /api/partner-evaluations; `paged` is false when the request asks for the classic full list. */
function evaluationListQuery(query: express.Request["query"]): EvaluationQuery & { paged: boolean; filtered: boolean } {
  const requested = queryText(query.sort, 40);
  const limit = query.limit === undefined ? undefined : Math.min(500, Math.max(1, Math.trunc(Number(query.limit)) || 50));
  const paged = limit !== undefined || query.offset !== undefined;
  const filters = { partnerId: queryList(query.partner_id), finalEvaluation: queryList(query.final_evaluation) };
  const q = queryText(query.q, 200) || undefined;
  const sort = (EVALUATION_SORTS as readonly string[]).includes(requested) ? requested as EvaluationQuery["sort"] : (paged || requested ? "review_date" : "default");
  return {
    paged, filtered: Boolean(q) || Object.values(filters).some((list) => list.length) || query.sort !== undefined,
    q, ...filters, sort, dir: queryText(query.dir, 4).toLowerCase() === "desc" ? "desc" : "asc",
    limit: limit ?? (query.offset !== undefined ? 50 : undefined), offset: Math.max(0, Math.trunc(Number(query.offset)) || 0),
  };
}
/**
 * Without list parameters: every visible evaluation as a bare array (unchanged). With limit/offset/q/sort or a filter (partner_id,
 * final_evaluation; comma lists): the matching visible evaluations, one page at a time, the total in `X-Total-Count`.
 */
app.get("/api/partner-evaluations", async (req: express.Request, res: express.Response) => {
  const query = evaluationListQuery(req.query);
  if (!query.paged && !query.filtered) return res.json(await scopedRecords(req, "evaluation"));
  const ctx = orgContextOf(req);
  const organizationId = getRequestTenantId(req);
  let rows: any[];
  let total: number;
  if (hasOrganizationScope(ctx)) {
    ({ rows, total } = await evaluationRepository.list(organizationId, query));
  } else {
    // Department roles see a subset decided by partner ownership: filter the matches, then page.
    const matched = (await evaluationRepository.list(organizationId, { ...query, limit: undefined, offset: 0 })).rows
      .filter((row) => recordVisible(ctx, scopeOf(req), "evaluation", row));
    total = matched.length;
    rows = query.limit === undefined ? matched : matched.slice(query.offset, (query.offset ?? 0) + query.limit);
  }
  res.setHeader("X-Total-Count", String(total));
  res.setHeader("Access-Control-Expose-Headers", "X-Total-Count");
  res.json(rows);
});
/** AI annual review for the partner evaluation form: summarises the year's snapshot and suggests ratings; an existing evaluation stores the result right away. */
app.post("/api/partner-evaluations/review-analysis", async (req: express.Request, res: express.Response) => {
  const draft = req.body?.evaluation;
  if (!draft || typeof draft !== "object" || !String(draft.supplier_name || "").trim()) {
    return res.status(400).json({ error: "Partner is required." });
  }
  const organizationId = getRequestTenantId(req);
  const saved = draft.id ? await evaluationRepository.get(organizationId, String(draft.id)) : undefined;
  if (draft.id && (!saved || assertRecordAccess(req, "evaluation", saved) || assertRecordWritable(req, "evaluation", saved))) {
    return res.status(404).json({ error: "Evaluasi tidak ditemukan." });
  }
  const partner = await partnerRepository.get(organizationId, String(draft.partner_id ?? ""));
  const visiblePartner = partner && !assertRecordAccess(req, "partner", partner) ? partner : undefined;
  if (!(await ensureAiAvailable(req, res))) return;
  const text = (v: unknown, max = 2000) => (v == null || v === "" ? "-" : String(v).slice(0, max));
  const num = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  const snap = req.body.snapshot && typeof req.body.snapshot === "object" ? req.body.snapshot : {};
  const months = Array.isArray(snap.monthlyUsd) ? snap.monthlyUsd.slice(0, 12).map((v: unknown, i: number) => `${i + 1}:${num(v) ?? 0}`).join(", ") : "-";
  const under = snap.underDelivered && typeof snap.underDelivered === "object" ? snap.underDelivered : {};
  const expiring = Array.isArray(snap.expiring) ? snap.expiring.slice(0, 10).map((c: any) => `${text(c?.number, 80)} ends ${text(c?.endDate, 10)}${c?.autoRenewal ? " (auto-renews)" : ""}`).join("; ") : "";
  const pricing = snap.pricing && typeof snap.pricing === "object" ? snap.pricing : null;
  const ctx = aiPolicyContext(organizationId);
  const prompt = `You are a senior vendor-management lead acting for ${ctx.organizationName}, a ${ctx.industryName} organization in ${ctx.countryName}.
Write the annual partner evaluation review for the partner below, based on the system snapshot of the cooperation year. Write every narrative field (titles, summary, findings, actions and notes) in English.

=== PARTNER ===
${text(draft.supplier_name, 300)}${visiblePartner?.country ? ` (${countryNameForPrompt(visiblePartner.country)})` : ""}; type of work: ${text(draft.type_of_work, 200)}
Evaluation year: ${num(snap.year) ?? "-"}${snap.ytd ? " (year to date)" : ""}

=== SYSTEM SNAPSHOT (already computed — use these numbers, do not recompute) ===
Spend: USD ${num(snap.spendUsd) ?? 0}${num(snap.growthPct) != null ? ` (${num(snap.growthPct)}% vs previous year)` : " (no spend recorded the previous year)"}; invoices: ${num(snap.invoices) ?? 0}
Monthly spend USD (month:amount): ${months}
Active contracts: ${num(snap.activeContracts) ?? 0}; active service orders: ${num(snap.activeSos) ?? 0}; SO budget used: ${num(snap.soUsedPct) != null ? `${num(snap.soUsedPct)}%` : "n/a"}
Under-delivery: ${num(under.count) ?? 0} of ${num(under.of) ?? 0} invoices that record units${num(under.avgPct) != null ? `, average shortfall ${num(under.avgPct)}%` : ""}
Contracts ending within 90 days: ${expiring || "none"}
Average contract redline risk score: ${num(snap.avgRiskScore) ?? "n/a"}/100
Previous evaluation: ${snap.previous && typeof snap.previous === "object" ? `${num(snap.previous.score)}/100 in ${num(snap.previous.year)}` : "none"}
Unit price benchmark: ${pricing ? `${text(pricing.model, 40)} ${text(pricing.currency, 8)} ${num(pricing.price)} vs peer average ${num(pricing.peerAvg)} (${num(pricing.diffPct)}%)` : "not available (no unit prices recorded)"}

=== EVALUATOR'S CURRENT RATINGS ===
Obligation / target: ${text(draft.obligation_target, 40)}; incident frequency: ${text(draft.incident_frequency, 40)}; communication: ${text(draft.communication, 40)}; pricing: ${text(draft.pricing, 40)}; final: ${text(draft.final_evaluation, 40)}
Evaluator notes: ${text(draft.notes)}

=== REVIEW INSTRUCTIONS ===
Describe how the cooperation went this year (growth, spend pattern, delivery, upcoming renewals, pricing) and what to do next (renew, renegotiate, monitor, phase out).
Incident frequency and communication are NOT tracked by the system — never judge them; leave them to the evaluator.
Ratings are suggestions only; the evaluator decides.

${REVIEW_GUIDE}

Return JSON with exactly:
1. overallRiskScore: integer 0-100 for the partnership risk (0-25 low, 26-55 moderate, 56-75 high, 76-100 critical).
2. riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL".
3. executiveSummary: one short paragraph snapshot of the cooperation this year.
4. keyFindings: 2-4 of the most important points.
5. analyzedClauses: 2-5 items, each with clauseTitle (short topic), riskCategory, severity ("LOW"|"MEDIUM"|"HIGH"|"CRITICAL"), originalTextOrIssue (the finding, citing the snapshot numbers), identifiedRisk, recommendedRedline (the concrete recommended action) and legalRationale.
6. complianceChecklist: exactly 3 rating suggestions, with item set to "Obligation / Target", "Pricing" and "Final Evaluation". For each, status is "COMPLIANT" when the evaluator's current rating already matches your suggestion, otherwise "NEEDS_REVIEW"; notes starts with the suggested option — one of "Sangat baik" | "Baik" | "Kurang baik" for Obligation / Target, "Cheap" | "Moderate" | "Expensive" for Pricing (say "No data" when there is no unit price benchmark), "Recommended" | "Recommended with notes" | "Not recommended" for Final Evaluation — then " — " and a one-sentence reason.
`;
  try {
    const analysis = await generateRedlineAnalysis(req, prompt);
    // Row-locked server-side edit: the stored result never overwrites (or fails on) a user's concurrent edit of other fields.
    const stored = saved ? await evaluationRepository.mutate(saved.organizationId, saved.id, (row) => {
      row.redline_analysis = analysis;
      row.redline_analyzed_at = analysis.analyzed_at;
      row.updated_at = analysis.analyzed_at;
    }) : undefined;
    res.json({ success: true, analysis, analyzed_at: analysis.analyzed_at, saved: Boolean(stored) });
  } catch (error) {
    log.error("Error during evaluation review:", error);
    sendRouteError(req, res, error, "request failed", "Gagal melakukan analisis AI. Silakan coba kembali.", { status: 500 });
  }
});

app.post("/api/partner-evaluations", validateBody(bodySchemas.evaluationCreateBody, { requiredMessage: "Harap lengkapi semua bidang isian formulir evaluasi yang wajib." }), async (req: express.Request, res: express.Response) => {
  const {
    review_date,
    partner_id,
    supplier_name,
    type_of_work,
    sla_score,
    obligation_target,
    incident_frequency,
    communication,
    pricing,
    final_evaluation,
    notes,
  } = req.body;
  if (
    !supplier_name ||
    !review_date ||
    !obligation_target ||
    !incident_frequency ||
    !communication ||
    !pricing ||
    !final_evaluation
  ) {
    return res
      .status(400)
      .json({
        error:
          "Harap lengkapi semua bidang isian formulir evaluasi yang wajib.",
      });
  }
  const targetOrgId = getRequestTenantId(req);
  const calculated_score = computeEvaluationScore(
    obligation_target,
    incident_frequency,
    communication,
    pricing,
  );
  const newEval = {
    id: await nextEntityId("evaluation"),
    organizationId: targetOrgId,
    review_date,
    partner_id,
    supplier_name: supplier_name.trim(),
    type_of_work: (type_of_work || "General Service").trim(),
    sla_score: Number(sla_score) || 60,
    obligation_target,
    incident_frequency,
    communication,
    pricing,
    final_evaluation,
    notes: (notes || "").trim(),
    calculated_score,
    // Review run on the add page before the evaluation existed.
    redline_analysis: req.body.redline_analysis && typeof req.body.redline_analysis === "object" ? req.body.redline_analysis : void 0,
    redline_analyzed_at: req.body.redline_analysis && typeof req.body.redline_analysis === "object" ? String(req.body.redline_analyzed_at || new Date().toISOString()) : void 0,
    evaluator_email: identityOf(req).email,
    evaluator_name: identityOf(req).name,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const writeDenial = assertRecordWritable(req, "evaluation", newEval);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  const stored = await evaluationRepository.insert(newEval);
  await logActivity(req, "CREATE", "PARTNER", `Membuat Evaluasi Tahunan Vendor untuk '${newEval.supplier_name}' dengan hasil '${newEval.final_evaluation}' (Skor: ${calculated_score}/100)`);
  res.json({ success: true, evaluation: stored });
});
app.put("/api/partner-evaluations/:id", validateBody(bodySchemas.evaluationUpdateBody), async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const {
    review_date,
    partner_id,
    supplier_name,
    type_of_work,
    sla_score,
    obligation_target,
    incident_frequency,
    communication,
    pricing,
    final_evaluation,
    notes,
    version: clientVersion,
  } = req.body;
  const existing = await evaluationRepository.get(getRequestTenantId(req), id);
  if (!existing) {
    return res.status(404).json({ error: "Data evaluasi tidak ditemukan." });
  }
  // The version the client last saw (body `version` or If-Match) guards against overwriting someone else's edit; clients that
  // send none are still protected for the duration of this request (the version read above).
  const expectedVersion = requestedVersion(req, clientVersion) ?? existing.version;
  const accessDenial = assertRecordAccess(req, "evaluation", existing);
  if (accessDenial) return res.status(accessDenial.status).json(accessDenial.body);
  const calculated_score = computeEvaluationScore(
    obligation_target || existing.obligation_target,
    incident_frequency || existing.incident_frequency,
    communication || existing.communication,
    pricing || existing.pricing,
  );
  const updatedEval: any = {
    ...existing,
    review_date: review_date || existing.review_date,
    partner_id: partner_id !== void 0 ? partner_id : existing.partner_id,
    supplier_name: supplier_name || existing.supplier_name,
    type_of_work: type_of_work || existing.type_of_work,
    sla_score: sla_score !== void 0 ? Number(sla_score) : existing.sla_score,
    obligation_target: obligation_target || existing.obligation_target,
    incident_frequency: incident_frequency || existing.incident_frequency,
    communication: communication || existing.communication,
    pricing: pricing || existing.pricing,
    final_evaluation: final_evaluation || existing.final_evaluation,
    notes: notes !== void 0 ? notes : existing.notes,
    calculated_score,
    updated_at: new Date().toISOString(),
  };
  updatedEval.organizationId = existing.organizationId;
  const writeDenial = assertRecordWritable(req, "evaluation", updatedEval);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  const stored = await evaluationRepository.update(updatedEval, expectedVersion);
  await logActivity(req, "UPDATE", "PARTNER", `Perbarui Evaluasi Tahunan Vendor '${updatedEval.supplier_name}' (${updatedEval.id})`);
  res.json({ success: true, evaluation: stored });
});
app.delete("/api/partner-evaluations/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const removed = await evaluationRepository.get(getRequestTenantId(req), id);
  if (!removed) {
    return res.status(404).json({ error: "Data evaluasi tidak ditemukan." });
  }
  const accessDenial = assertRecordAccess(req, "evaluation", removed);
  if (accessDenial) return res.status(accessDenial.status).json(accessDenial.body);
  await evaluationRepository.remove(removed.organizationId, id);
  await logActivity(req, "DELETE", "PARTNER", `Menghapus Evaluasi Tahunan Vendor '${removed.supplier_name}' (${removed.id})`);
  res.json({ success: true });
});
  return app;
}
