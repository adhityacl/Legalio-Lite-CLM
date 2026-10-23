import express from 'express';
import { aiPolicyContext } from './tenantPolicy';
import { countryNameForPrompt } from './memoryDb';
import { normalizeCurrencyCode } from '@legalio/shared/currencyUtils';
import { getValidAiModel, generateContentWithRetryAndFallback } from './aiClient';
import { Type } from '@google/genai';
/** Shared AI redline/risk review used by contracts, service orders, partners, spendings and evaluations. */

/** Runs the AI risk/redline review for a saved or draft contract; returns the parsed analysis (not persisted). */
export async function runContractRedlineAnalysis(req: express.Request, contract: any, partner: any) {
  const ctx = aiPolicyContext(contract.organizationId);
  const regulatorLine = ctx.regulators.length > 0
    ? `Regulators relevant to our industry in ${ctx.countryName}: ${ctx.regulators.join(", ")}. Assess outsourcing, audit-right and reporting expectations they typically impose.`
    : "No specific sector regulator is configured; assess against general commercial law and good practice.";
  const prompt = `You are a senior corporate legal counsel and AI contract reviewer acting for ${ctx.organizationName}, a ${ctx.industryName} organization whose primary jurisdiction is ${ctx.countryName}.
Perform a risk and compliance analysis of the commercial contract below and propose balanced redlines. Write every narrative field (titles, summary, findings, clause text and notes) in English.

=== CONTRACT ===
Reference: ${contract.contract_number}
Title: ${contract.contract_title}
Document type: ${contract.document_type || "Master Agreement"}
Counterparty: ${partner?.partner_name || "-"}${partner?.country ? ` (${countryNameForPrompt(partner.country)})` : ""}
Categories: ${(contract.cooperation_categories || []).join(", ") || "-"}
Value: ${normalizeCurrencyCode(contract.currency, ctx.defaultCurrency)} ${Number(contract.contract_value || 0)}
Term: ${contract.start_date} to ${contract.end_date} (days remaining: ${contract.days_remaining ?? "-"})
Auto-renewal: ${contract.auto_renewal ? "yes" : "no"}
Notice period: ${contract.notice_period_days || 30} days (${contract.notice_type_required || "termination/extension"})
Internal notes / clause summary: ${contract.internal_notes || contract.change_summary || "Standard B2B commercial services agreement."}
Counterparty due-diligence status: ${partner?.status_dd || "unknown"}
${req.body.customClauseText ? `
Additional clause text to review:
${String(req.body.customClauseText).slice(0, 20000)}` : ""}

=== REVIEW INSTRUCTIONS ===
Assess liability, termination, indemnities, confidentiality and data protection (reference ${ctx.dataProtectionLaw} where our own processing is concerned), governing law and dispute resolution (our default position: ${ctx.governingLaw}), and these industry focus areas: ${ctx.reviewFocus.join("; ")}.
${regulatorLine}
Industry standards and regulatory frameworks to check against: ${ctx.complianceStandards.join("; ")}.
Industry rule checks — apply every rule below; each rule that is triggered must appear in keyFindings and in analyzedClauses:
${ctx.clauseRules.map((rule) => `- ${rule}`).join("\n")}
Tax points to consider (${ctx.indirectTaxName} and withholding): ${ctx.taxConsiderations.join(" ")}
Do not invent statute or regulation numbers — cite them only when you are certain; otherwise describe the requirement in general terms.

Return JSON with exactly:
1. overallRiskScore: integer 0-100 (0-25 low, 26-55 moderate, 56-75 high, 76-100 critical).
2. riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL".
3. executiveSummary: 2-3 short paragraphs on negotiating position, regulatory fit and key risks.
4. keyFindings: 3-5 of the most important issues.
5. analyzedClauses: the main clauses, each with clauseTitle, riskCategory, severity ("LOW"|"MEDIUM"|"HIGH"|"CRITICAL"), originalTextOrIssue, identifiedRisk, recommendedRedline (balanced replacement wording) and legalRationale (legal basis or negotiation argument).
6. complianceChecklist: 5-6 items, each with item, status ("COMPLIANT" | "NEEDS_REVIEW" | "NON_COMPLIANT") and notes. Cover: data protection, audit and regulator access (if a regulator applies), notice period and auto-renewal clarity, governing law and dispute forum, and the industry focus areas above.
`;
  return generateRedlineAnalysis(req, prompt);
}

/** Sends a redline-review prompt and parses the shared RedlineAnalysisData JSON (contracts and service orders). */
export async function generateRedlineAnalysis(req: express.Request, prompt: string, pdfBase64?: string) {
  const selectedModel = getValidAiModel(req.body.model);
  const contents: any[] = [{ text: prompt }];
  if (pdfBase64) contents.push({ inlineData: { data: pdfBase64.includes("base64,") ? pdfBase64.split("base64,")[1] : pdfBase64, mimeType: "application/pdf" } });
  const response = await generateContentWithRetryAndFallback({
    model: selectedModel,
    contents,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          overallRiskScore: { type: Type.INTEGER },
          riskLevel: { type: Type.STRING },
          executiveSummary: { type: Type.STRING },
          keyFindings: { type: Type.ARRAY, items: { type: Type.STRING } },
          analyzedClauses: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                clauseTitle: { type: Type.STRING },
                riskCategory: { type: Type.STRING },
                severity: { type: Type.STRING },
                originalTextOrIssue: { type: Type.STRING },
                identifiedRisk: { type: Type.STRING },
                recommendedRedline: { type: Type.STRING },
                legalRationale: { type: Type.STRING },
              },
              required: [
                "clauseTitle",
                "severity",
                "originalTextOrIssue",
                "identifiedRisk",
                "recommendedRedline",
                "legalRationale",
              ],
            },
          },
          complianceChecklist: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                item: { type: Type.STRING },
                status: { type: Type.STRING },
                notes: { type: Type.STRING },
              },
              required: ["item", "status", "notes"],
            },
          },
        },
        required: [
          "overallRiskScore",
          "riskLevel",
          "executiveSummary",
          "keyFindings",
          "analyzedClauses",
          "complianceChecklist",
        ],
      },
    },
  });
  const parsed = JSON.parse((response as any).text);
  parsed.analyzed_at = new Date().toISOString();
  return parsed;
}
