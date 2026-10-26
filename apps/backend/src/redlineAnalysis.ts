import express from 'express';
import { aiPolicyContext } from './tenantPolicy';
import { countryNameForPrompt } from './memoryDb';
import { normalizeCurrencyCode } from '@legalio/shared/currencyUtils';
import { getValidAiModel, generateContentWithRetryAndFallback } from './aiClient';
import { parseAiJsonObject } from './aiJson';
import { Type } from '@google/genai';
import { scoreReview } from './reviewScoring';
import { storedContractPages } from './contractDocumentText';
import { componentLog } from './logger';
const log = componentLog('redlineAnalysis');
/** Shared AI redline/risk review used by contracts, service orders, partners, spendings and evaluations. */

/**
 * Shared by every review prompt: how severities are assigned (the score is recomputed from them in reviewScoring.ts, so the model
 * is told the points) and the JSON shape of text fields (a model once wrote one field as several bare strings).
 */
export const REVIEW_GUIDE = `Severity guide — the overall score is computed from the severities you assign (CRITICAL 25, HIGH 15, MEDIUM 7, LOW 2 points each, capped at 100), so rate each finding on its own merits:
- CRITICAL: an explicit term that exposes us to a regulatory breach, uncapped liability, or loss of control over funds or personal data.
- HIGH: an explicit term that is clearly one-sided against us, or a protection this specific relationship plainly needs and visibly lacks.
- MEDIUM: a gap or ambiguity worth negotiating, including anything you cannot confirm from the text you were given.
- LOW: drafting or clarity improvements.
JSON format: every text field (executiveSummary included) is ONE JSON string; put several paragraphs inside that one string separated by \\n, never as separate strings.`;

/**
 * The industry rules are written for the organization's industry in general; this block makes the model decide, per rule,
 * whether this relationship actually involves the activity before raising anything for it.
 */
export function ruleApplicabilityBlock(rules: string[], industryName: string, categories: string[]): string {
  if (!rules.length) return '';
  return `Industry rules (written for ${industryName} relationships in general). Partnership categories of this relationship: ${categories.length ? categories.join(', ') : 'not given — infer the relationship from the title and text'}.
First state to yourself what this relationship covers and which party performs which activity. A rule applies ONLY when this relationship makes the counterparty perform, control or influence the activity the rule is about — for example, collection rules only if the counterparty collects from customers; fund-segregation rules only if it holds or moves customer or lender funds; customer-pricing rules only if it sets, charges or discloses that pricing; customer-data rules only if it receives that data. Raise findings only for rules that apply. List every rule that does not apply in notApplicableRules with a one-line reason, and do not mention it in keyFindings, analyzedClauses or complianceChecklist.
${rules.map((rule) => `- ${rule}`).join("\n")}`;
}

/** The `notApplicableRules` item every review prompt adds to its "Return JSON" list. */
export const NOT_APPLICABLE_RETURN = `notApplicableRules: the industry rules that do not apply to this relationship, each with rule and reason (empty array when all apply).`;

const CONTRACT_TEXT_CHARS = 100_000;

/** Text of the document stored with a saved contract (digital text or the parser's cached transcript), or null. */
async function storedContractText(contract: any): Promise<string | null> {
  if (!contract.contract_file_link) return null;
  try {
    const { pages } = await storedContractPages(contract);
    const text = pages.map((p) => p.text).join("\n\n").trim();
    return text || null;
  } catch (err: any) {
    // No text layer and no transcript yet, or the file is gone: the review falls back to the summary.
    log.info(`Contract text unavailable for redline review: ${String(err?.message ?? err).slice(0, 160)}`);
    return null;
  }
}

/** Runs the AI risk/redline review for a saved or draft contract; returns the parsed analysis (not persisted). */
export async function runContractRedlineAnalysis(req: express.Request, contract: any, partner: any) {
  const ctx = aiPolicyContext(contract.organizationId);
  const regulatorLine = ctx.regulators.length > 0
    ? `Regulators relevant to our industry in ${ctx.countryName}: ${ctx.regulators.join(", ")}. Where this relationship outsources a regulated activity to the counterparty, assess the outsourcing, audit-right and reporting expectations they typically impose.`
    : "No specific sector regulator is configured; assess against general commercial law and good practice.";
  const fullText = await storedContractText(contract);
  const categories: string[] = Array.isArray(contract.cooperation_categories) ? contract.cooperation_categories.filter(Boolean) : [];
  const evidenceLine = fullText
    ? `You have the contract text below (up to ${CONTRACT_TEXT_CHARS.toLocaleString("en-US")} characters${fullText.length > CONTRACT_TEXT_CHARS ? "; it was cut, so a clause missing from it may be in the omitted part — rate such gaps MEDIUM" : ""}). Quote it in originalTextOrIssue where you can.`
    : `You only have a clause summary written by another AI, not the contract itself. A clause missing from the summary may still be in the signed document: report such gaps as "not visible in the summary — confirm in the signed document", rate them at most MEDIUM, and mark the checklist item NEEDS_REVIEW, not NON_COMPLIANT. Only something the summary states explicitly may be rated HIGH or CRITICAL.`;
  const prompt = `You are a senior corporate legal counsel and AI contract reviewer acting for ${ctx.organizationName}, a ${ctx.industryName} organization whose primary jurisdiction is ${ctx.countryName}.
Perform a risk and compliance analysis of the commercial contract below and propose balanced redlines. Write every narrative field (titles, summary, findings, clause text and notes) in English.

=== CONTRACT ===
Reference: ${contract.contract_number}
Title: ${contract.contract_title}
Document type: ${contract.document_type || "Master Agreement"}
Counterparty: ${partner?.partner_name || "-"}${partner?.country ? ` (${countryNameForPrompt(partner.country)})` : ""}
Partnership categories: ${categories.join(", ") || "-"}
Value: ${normalizeCurrencyCode(contract.currency, ctx.defaultCurrency)} ${Number(contract.contract_value || 0)}
Term: ${contract.start_date} to ${contract.end_date} (days remaining: ${contract.days_remaining ?? "-"})
Auto-renewal: ${contract.auto_renewal ? "yes" : "no"}
Notice period: ${contract.notice_period_days || 30} days (${contract.notice_type_required || "termination/extension"})
Internal notes / clause summary: ${contract.internal_notes || contract.change_summary || "Standard B2B commercial services agreement."}
Counterparty due-diligence status: ${partner?.status_dd || "unknown"}
${req.body.customClauseText ? `
Additional clause text to review:
${String(req.body.customClauseText).slice(0, 20000)}` : ""}
${fullText ? `
=== CONTRACT TEXT ===
${fullText.slice(0, CONTRACT_TEXT_CHARS)}` : ""}

=== REVIEW INSTRUCTIONS ===
${evidenceLine}
Assess liability, termination, indemnities, confidentiality and data protection (reference ${ctx.dataProtectionLaw} where personal data is actually shared), and governing law and dispute resolution (our default position: ${ctx.governingLaw}).
${regulatorLine}
${ruleApplicabilityBlock(ctx.clauseRules, ctx.industryName, categories)}
Industry standards and frameworks, for the rules that apply: ${ctx.complianceStandards.join("; ")}.
Tax points to consider (${ctx.indirectTaxName} and withholding), where the contract involves payments they affect: ${ctx.taxConsiderations.join(" ")}
Do not invent statute or regulation numbers — cite them only when you are certain; otherwise describe the requirement in general terms.

${REVIEW_GUIDE}

Return JSON with exactly:
1. overallRiskScore: integer 0-100 (0-25 low, 26-55 moderate, 56-75 high, 76-100 critical).
2. riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL".
3. executiveSummary: 2-3 short paragraphs on negotiating position, regulatory fit and key risks.
4. keyFindings: 3-5 of the most important issues.
5. analyzedClauses: the main clauses, each with clauseTitle, riskCategory, severity ("LOW"|"MEDIUM"|"HIGH"|"CRITICAL"), originalTextOrIssue, identifiedRisk, recommendedRedline (balanced replacement wording) and legalRationale (legal basis or negotiation argument).
6. complianceChecklist: 5-6 items, each with item, status ("COMPLIANT" | "NEEDS_REVIEW" | "NON_COMPLIANT") and notes. Cover: data protection, audit and regulator access (only if a regulator applies to this relationship), notice period and auto-renewal clarity, governing law and dispute forum, and the industry rules that apply.
7. ${NOT_APPLICABLE_RETURN}
`;
  return generateRedlineAnalysis(req, prompt);
}

/** Sends a review prompt and parses the shared RedlineAnalysisData JSON, with the score recomputed from the severities. */
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
          notApplicableRules: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { rule: { type: Type.STRING }, reason: { type: Type.STRING } },
              required: ["rule", "reason"],
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
  // The score and level come from the findings' severities, not from the model's own number (reviewScoring.ts).
  const scored = scoreReview(parseAiJsonObject((response as any).text, "The AI review answer was not valid JSON. Try again."));
  return { ...scored, analyzed_at: new Date().toISOString() };
}
