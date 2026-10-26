import express from 'express';
import { aiPolicyContext } from './tenantPolicy';
import { countryNameForPrompt } from './memoryDb';
import { normalizeCurrencyCode } from '@legalio/shared/currencyUtils';
import { aiLimits, getValidAiModel, generateContentWithRetryAndFallback } from './aiClient';
import { parseAiJsonObject } from './aiJson';
import { Type } from '@google/genai';
import { normalizeChecklist, normalizeNotApplicable, scoreReview } from './reviewScoring';
import { MAX_CONTRACT_FINDINGS, scoreContractRisk, SEVERITY_RUBRIC } from './contractRiskEngine';
import { riskProfileFor, type PillarWeights } from './contractRiskMatrix';
import { storedContractPages } from './contractDocumentText';
import { componentLog } from './logger';
const log = componentLog('redlineAnalysis');
/** Shared AI redline/risk review used by contracts, service orders, partners, spendings and evaluations. */

/** JSON shape of text fields (a model once wrote one field as several bare strings) and length limits, for every review prompt. */
export const REVIEW_FORMAT = `JSON format: every text field (executiveSummary included) is ONE JSON string; put several paragraphs inside that one string separated by \\n, never as separate strings.
Length limits — keep the answer short; the reader skims it beside the form:
- executiveSummary: at most 120 words. keyFindings: one sentence each, at most 25 words.
- Each analyzed item: originalTextOrIssue at most 40 words (quote only the decisive words), identifiedRisk and legalRationale at most 30 words each, recommendedRedline at most 80 words — the replacement wording only, no preamble.
- complianceChecklist notes and notApplicableRules reasons: one sentence, at most 20 words.`;

/**
 * Severity guide for the reviews scored by reviewScoring.ts (service orders, partners, spendings, evaluations); the score is the
 * sum of these points, so the model is told them. Contract redlining uses the pillar engine instead (contractRiskEngine.ts).
 */
export const REVIEW_GUIDE = `Severity guide — the overall score is computed from the severities you assign (CRITICAL 25, HIGH 15, MEDIUM 7, LOW 2 points each, capped at 100), so rate each finding on its own merits:
- CRITICAL: an explicit term that exposes us to a regulatory breach, uncapped liability, or loss of control over funds or personal data.
- HIGH: an explicit term that is clearly one-sided against us, or a protection this specific relationship plainly needs and visibly lacks.
- MEDIUM: a gap or ambiguity worth negotiating, including anything you cannot confirm from the text you were given.
- LOW: drafting or clarity improvements.
${REVIEW_FORMAT}`;

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
const FULL_TEXT_TIMEOUT_MS = 180_000;

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
  const categories: string[] = [...new Set([
    ...(Array.isArray(contract.cooperation_categories) ? contract.cooperation_categories : []),
    ...(Array.isArray(partner?.tags) ? partner.tags : []),
  ].map((tag: unknown) => String(tag).trim()).filter(Boolean))];
  const profile = riskProfileFor(ctx.industryKey, categories);
  // Source-of-truth hierarchy: the contract text, then the form metadata, then the AI-written internal notes.
  const evidenceLine = fullText
    ? `Sources, in order of authority: (1) the CONTRACT TEXT below — the primary legal truth (up to ${CONTRACT_TEXT_CHARS.toLocaleString("en-US")} characters${fullText.length > CONTRACT_TEXT_CHARS ? "; it was cut, so a clause missing from it may be in the omitted part — rate such gaps as minor" : ""}); (2) the form metadata (dates, value, currency, notice, auto-renewal, partner, categories) — reconcile it with the text and report any mismatch as a P5 finding; (3) the internal notes — a secondary summary only. Never conclude that a clause is missing because the internal notes say it was "not found"; check the contract text. Quote the contract text in originalTextOrIssue and name the article / clause number.`
    : `You only have the form metadata and a clause summary written by another AI, not the contract itself. A clause missing from the summary may still be in the signed document: report such gaps as "not visible in the summary — confirm in the signed document", give them a base severity of at most 25, and mark the checklist item NEEDS_REVIEW, not NON_COMPLIANT. Only something the summary states explicitly may score higher.`;
  const playbookBlock = profile.playbook
    ? `Relationship playbook for this kind of partnership (${categories.join(", ")}):
In scope — check these first:
${profile.playbook.inScope.map((flag) => `- ${flag}`).join("\n")}${profile.playbook.outOfScope.length ? `
Out of scope — governed by separate agreements; never raise a finding for their absence here:
${profile.playbook.outOfScope.map((flag) => `- ${flag}`).join("\n")}` : ""}`
    : profile.redFlags.length ? `Typical red flags in ${ctx.industryName} contracts, where they apply to this relationship:
${profile.redFlags.map((flag) => `- ${flag}`).join("\n")}` : "";
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

=== REVIEW METHOD ===
Stage 1 — sources. ${evidenceLine}
Stage 2 — roles. Assess every risk from ${ctx.organizationName}'s side. Decide our role in this contract (payer, provider or co-partner) and the counterparty's, and what the contract's actual subject is.
Stage 3 — scope gate. Raise a finding only for what this contract itself must govern. Never penalize the absence of terms that the contract leaves to a separate agreement (funding agreement, DPA, NDA, collection agreement) or that belong to a different kind of relationship.
${ruleApplicabilityBlock(ctx.clauseRules, ctx.industryName, categories)}
${playbookBlock}
Stage 4 — audit the contract through five pillars and assign every finding to exactly one:
- P1 Financial: price / commission / profit-share formulas (every multiplier has an explicit unit — day, month, year — and a clear base such as funds actually disbursed), reconciliation, payment terms, tax (${ctx.indirectTaxName}, withholding: ${ctx.taxConsiderations.join(" ")}), late penalties with a time unit and a cap.
- P2 Liability: aggregate liability cap, balanced indemnities, relevant disclaimers, IP and trademark protection.
- P3 Regulation, data and audit: sector regulation (${ctx.regulators.length ? ctx.regulators.join(", ") : "general commercial law"}), ${ctx.dataProtectionLaw} where personal data is shared (breach notice within 24–72 hours, no use beyond the purpose), and audit rights limited to records relevant to this cooperation — never "all records" of a party. ${regulatorLine}
- P4 Operations and exit: SLA, cure periods, termination that a defaulting party cannot block (no "signed mutual agreement" requirement for termination for breach), equal assignment rights.
- P5 Drafting and metadata: legal entity names everywhere (including notice clauses), cross-references, missing or duplicated words, and the form metadata against the text.${fullText ? ` If the contract is bilingual, compare the two languages sentence by sentence; when the prevailing language (usually Indonesian) misses or garbles a key word, condition or party name that the other language has, that is a serious finding because the prevailing text binds in court.` : ""}
Industry standards and frameworks, for the rules that apply: ${ctx.complianceStandards.join("; ")}. Governing law default: ${ctx.governingLaw}.
Do not invent statute or regulation numbers — cite them only when you are certain; otherwise describe the requirement in general terms.

${SEVERITY_RUBRIC}
The overall score is computed by the system from your pillar, severityScore and stance per finding (0–100, lower is safer), so judge each finding on its own and do not try to steer the total.

${REVIEW_FORMAT}

Return JSON with exactly:
1. overallRiskScore: your own estimate, integer 0-100, lower is safer (the system recomputes it).
2. riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL".
3. executiveSummary: the contract's risk posture within its real business scope, the main financial / legal exposure, and any metadata mismatch.
4. keyFindings: 3-5 of the most important issues.
5. analyzedClauses: at most ${MAX_CONTRACT_FINDINGS} findings, worst first, each with clauseTitle (topic and article number, e.g. "Art. 2(13)(a) — commission formula"), pillar ("P1"|"P2"|"P3"|"P4"|"P5"), severityScore (integer 0-100, base severity per the rubric), stance ("ADVERSE"|"NEUTRAL"|"FAVORABLE"), riskCategory, originalTextOrIssue, identifiedRisk, recommendedRedline (balanced, ready-to-paste replacement wording) and legalRationale.
6. complianceChecklist: 5-6 items, each with item, status ("COMPLIANT" | "NEEDS_REVIEW" | "NON_COMPLIANT") and notes. Cover: data protection, audit and regulator access (only if a regulator applies to this relationship), notice period and auto-renewal clarity, governing law and dispute forum, and the industry rules that apply.
7. ${NOT_APPLICABLE_RETURN}
`;
  // A whole contract (tens of thousands of tokens) takes a proxy endpoint 75–85 s to review; give it room beyond the default.
  return generateRedlineAnalysis(req, prompt, undefined, { contractWeights: profile.weights, timeoutMs: fullText ? Math.max(aiLimits.timeoutMs, FULL_TEXT_TIMEOUT_MS) : undefined });
}

/**
 * Sends a review prompt and parses the shared RedlineAnalysisData JSON. The score is recomputed on the server: with
 * `contractWeights` by the pillar engine (contract redlining), otherwise from the severity points (reviewScoring.ts).
 */
export async function generateRedlineAnalysis(req: express.Request, prompt: string, pdfBase64?: string, options: { contractWeights?: PillarWeights; timeoutMs?: number } = {}) {
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
                // Contract redlining only: the pillar engine's inputs.
                pillar: { type: Type.STRING },
                severityScore: { type: Type.INTEGER },
                stance: { type: Type.STRING },
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
  }, { timeoutMs: options.timeoutMs });
  // The score and level come from the findings, not from the model's own number.
  const parsed = parseAiJsonObject((response as any).text, "The AI review answer was not valid JSON. Try again.");
  const scored = options.contractWeights
    ? { ...scoreContractRisk(parsed, options.contractWeights), complianceChecklist: normalizeChecklist(parsed.complianceChecklist), notApplicableRules: normalizeNotApplicable(parsed.notApplicableRules) }
    : scoreReview(parsed);
  return { ...scored, analyzed_at: new Date().toISOString() };
}
