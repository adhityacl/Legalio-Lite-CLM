import { partnerRepository } from '../repositories/partnerRepository';
import { nextEntityId } from '../ids';
import { computeEvaluationScore } from '../evaluationScoring';
import * as bodySchemas from '../schemas';
import { scopedRecords, getRequestTenantId, assertRecordAccess, assertRecordWritable, logActivity } from '../recordAccess';
import { db, countryNameForPrompt, saveDb, triggerAutoPushToGoogleSheet } from '../memoryDb';
import { ensureAiAvailable } from '../aiClient';
import { aiPolicyContext } from '../tenantPolicy';
import { generateRedlineAnalysis } from '../redlineAnalysis';
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

app.get("/api/partner-evaluations", async (req: express.Request, res: express.Response) => {
  const list = await scopedRecords(req, "evaluation");
  res.json(list);
});
/** AI annual review for the partner evaluation form: summarises the year's snapshot and suggests ratings; an existing evaluation stores the result right away. */
app.post("/api/partner-evaluations/review-analysis", async (req: express.Request, res: express.Response) => {
  const draft = req.body?.evaluation;
  if (!draft || typeof draft !== "object" || !String(draft.supplier_name || "").trim()) {
    return res.status(400).json({ error: "Partner is required." });
  }
  const organizationId = getRequestTenantId(req);
  const saved = draft.id ? (db.evaluations || []).find((e) => e.id === String(draft.id)) : undefined;
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
    if (saved) {
      saved.redline_analysis = analysis;
      saved.redline_analyzed_at = analysis.analyzed_at;
      saved.updated_at = analysis.analyzed_at;
      await saveDb();
    }
    res.json({ success: true, analysis, analyzed_at: analysis.analyzed_at, saved: Boolean(saved) });
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
  if (!db.evaluations) db.evaluations = [];
  const writeDenial = assertRecordWritable(req, "evaluation", newEval);
  if (writeDenial) return res.status(writeDenial.status).json(writeDenial.body);
  db.evaluations.unshift(newEval);
  await saveDb();
  await logActivity(req, "CREATE", "PARTNER", `Membuat Evaluasi Tahunan Vendor untuk '${newEval.supplier_name}' dengan hasil '${newEval.final_evaluation}' (Skor: ${calculated_score}/100)`);
  await triggerAutoPushToGoogleSheet(req, { tenantId: targetOrgId });
  res.json({ success: true, evaluation: newEval });
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
  } = req.body;
  const evalIndex = (db.evaluations || []).findIndex((e) => e.id === id);
  if (evalIndex === -1) {
    return res.status(404).json({ error: "Data evaluasi tidak ditemukan." });
  }
  const existing = db.evaluations[evalIndex];
  const accessDenial = assertRecordAccess(req, "evaluation", existing);
  if (accessDenial) return res.status(accessDenial.status).json(accessDenial.body);
  const calculated_score = computeEvaluationScore(
    obligation_target || existing.obligation_target,
    incident_frequency || existing.incident_frequency,
    communication || existing.communication,
    pricing || existing.pricing,
  );
  const updatedEval = {
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
  db.evaluations[evalIndex] = updatedEval;
  await saveDb();
  await logActivity(req, "UPDATE", "PARTNER", `Perbarui Evaluasi Tahunan Vendor '${updatedEval.supplier_name}' (${updatedEval.id})`);
  res.json({ success: true, evaluation: updatedEval });
});
app.delete("/api/partner-evaluations/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const evalIndex = (db.evaluations || []).findIndex((e) => e.id === id);
  if (evalIndex === -1) {
    return res.status(404).json({ error: "Data evaluasi tidak ditemukan." });
  }
  const removed = db.evaluations[evalIndex];
  const accessDenial = assertRecordAccess(req, "evaluation", removed);
  if (accessDenial) return res.status(accessDenial.status).json(accessDenial.body);
  db.evaluations.splice(evalIndex, 1);
  await saveDb();
  await logActivity(req, "DELETE", "PARTNER", `Menghapus Evaluasi Tahunan Vendor '${removed.supplier_name}' (${removed.id})`);
  res.json({ success: true });
});
  return app;
}
