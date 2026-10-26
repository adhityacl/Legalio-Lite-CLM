/**
 * Contract risk score for AI Contract Redlining: 0–100, LOWER IS SAFER. The model only judges each finding (pillar, base
 * severity, stance toward our organization); the score is computed here, so the same findings always give the same number.
 *
 * Method (Legalio scoring reference, calibrated):
 *   1. adjusted severity s' = min(100, base × stance multiplier)
 *   2. pillar score P_i = min(100, s'_1 + Σ_{m≥2} s'_m × 0.35^(m-1)), findings sorted from worst
 *   3. R_weighted = Σ P_i × W_i with the industry / playbook weights (contractRiskMatrix.ts); a pillar without findings is 0
 *   4. peak blend: when S_max ≥ 45, R = max(R_weighted, 0.55 × R_weighted + 0.45 × S_max); one serious flaw is not averaged away
 *   5. critical override: a critical finding (S_max ≥ 75) keeps the result in the critical band (≥ 71)
 *   6. bands: 0–20 LOW, 21–45 MEDIUM (moderate), 46–70 HIGH, 71–100 CRITICAL
 *
 * Calibration against the reference: its severity rubric (70–85 for a missing liability cap, 90–100 for an ambiguous
 * commission formula) put an ordinary contract at ~99 / 100. The rubric below is shifted down and the adverse multiplier is
 * 1.1 instead of 1.25, so that the reference's own sample (Adapundi × Home Credit, pillar scores 55–70) lands at ~64 HIGH.
 * contractRiskEngine.test.ts pins that and the other calibration scenarios.
 */
import { PILLARS, type Pillar, type PillarWeights } from './contractRiskMatrix';

export type Stance = 'ADVERSE' | 'NEUTRAL' | 'FAVORABLE';
export type RiskBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const STANCE_MULTIPLIER: Record<Stance, number> = { ADVERSE: 1.1, NEUTRAL: 1, FAVORABLE: 0.2 };
export const RESIDUAL_FACTOR = 0.35;
export const PEAK_BLEND_FROM = 45;
export const PEAK_WEIGHT = 0.45;
export const CRITICAL_FROM = 75;
export const CRITICAL_FLOOR = 71;
/** Findings kept in a review, worst first; more would only lengthen the answer. */
export const MAX_CONTRACT_FINDINGS = 8;

/** The rubric the model scores against; it is the calibration, so prompt and engine share this one text. */
export const SEVERITY_RUBRIC = `Base severity (0–100) of each finding, before the stance adjustment:
- 0: the clause is sound, reciprocal and precise.
- 5–10 Drafting: typo, clearly understandable cross-reference slip, wording polish.
- 15–25 Minor gap: missing operational detail, metadata in the form differing from the text, short notice period, a gap you can only suspect from a summary.
- 30–40 Material: missing aggregate liability cap, penalty without time unit or cap, one-sided assignment or termination right, termination mechanics that contradict each other, unbalanced administrative duty.
- 45–60 Serious: ambiguous price / commission / profit-share formula that affects cash flow, counterparty access to all of our records or data, a key right or obligation word missing from the prevailing-language text.
- 75–100 Critical: breach of a mandatory regulation (sector regulator, central bank, personal data law), unlimited existential exposure, a term that makes the agreement void or unenforceable.
Use the gap between 60 and 75 only when a finding is clearly worse than "serious" but not a legal breach.
A missing liability cap or an uncapped indemnity is Material (30–40), or Serious (45–60) when it is one-sided against us — never Critical: the Critical band is reserved for legal breaches and terms that can sink the organization on their own.
Stance of each finding toward our organization: ADVERSE when the imbalance or gap hurts us, NEUTRAL when it hurts legal certainty for both parties (cross-reference errors, contradictions), FAVORABLE when the one-sided term actually benefits us.`;

export interface RiskFinding { pillar?: unknown; severityScore?: unknown; stance?: unknown; [key: string]: any }
export interface PillarScore { pillar: Pillar; score: number; weight: number; findings: number }

export function normalizePillar(value: unknown): Pillar {
  const v = String(value ?? '').trim().toUpperCase();
  if ((PILLARS as readonly string[]).includes(v)) return v as Pillar;
  // Editorial first: "metadata" would otherwise match the data-privacy pillar.
  if (/EDITOR|DRAFT|BILING|METADATA|REFERENCE|TYPO/.test(v)) return 'P5';
  if (/FINANC|COMMERC|PRIC|COMMISSION|TAX/.test(v)) return 'P1';
  if (/LIAB|INDEMN|RISK ALLOC|IP\b|INTELLECT/.test(v)) return 'P2';
  if (/REGUL|COMPLIAN|PRIVACY|DATA|AUDIT/.test(v)) return 'P3';
  if (/OPERAT|SLA|TERMINAT|EXIT|SUPPLY/.test(v)) return 'P4';
  return 'P2';
}

export function normalizeStance(value: unknown): Stance {
  const v = String(value ?? '').trim().toUpperCase();
  if (v.startsWith('FAV') || v === 'BENEFICIAL') return 'FAVORABLE';
  if (v.startsWith('NEU') || v === 'SYMMETRIC') return 'NEUTRAL';
  return 'ADVERSE';
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export function adjustedSeverity(base: unknown, stance: Stance): number {
  const n = Number(base);
  return clamp((Number.isFinite(n) ? n : 30) * STANCE_MULTIPLIER[stance]);
}

/** P_i from the adjusted severities of one pillar: the worst counts fully, each next one 0.35× the previous share. */
export function pillarScore(severities: number[]): number {
  const sorted = [...severities].sort((a, b) => b - a);
  return clamp(sorted.reduce((sum, s, m) => sum + s * RESIDUAL_FACTOR ** m, 0));
}

export function bandOf(score: number): RiskBand {
  if (score <= 20) return 'LOW';
  if (score <= 45) return 'MEDIUM';
  if (score <= 70) return 'HIGH';
  return 'CRITICAL';
}

/** Weighted composite with the peak blend and the critical override (steps 3–5). */
export function compositeScore(pillars: Record<Pillar, number>, weights: PillarWeights, peak: number): number {
  const weighted = PILLARS.reduce((sum, p) => sum + pillars[p] * weights[p], 0);
  let score = peak >= PEAK_BLEND_FROM ? Math.max(weighted, (1 - PEAK_WEIGHT) * weighted + PEAK_WEIGHT * peak) : weighted;
  if (peak >= CRITICAL_FROM) score = Math.max(score, CRITICAL_FLOOR);
  return Math.round(clamp(score));
}

/**
 * Scores the model's findings in place of its own numbers: each finding gets its pillar, stance, base and adjusted severity
 * and a severity band; findings are sorted worst first and capped; the analysis gets the composite score, level and the
 * per-pillar breakdown. The model's own score is kept as `aiRiskScore`.
 */
export function scoreContractRisk<T extends Record<string, any>>(analysis: T, weights: PillarWeights) {
  const raw: RiskFinding[] = Array.isArray(analysis.analyzedClauses) ? analysis.analyzedClauses.filter((c: unknown) => c && typeof c === 'object') : [];
  const findings = raw.map((f) => {
    const pillar = normalizePillar(f.pillar);
    const stance = normalizeStance(f.stance);
    const base = clamp(Number.isFinite(Number(f.severityScore)) ? Number(f.severityScore) : 30);
    const adjusted = Math.round(adjustedSeverity(base, stance) * 10) / 10;
    return { ...f, pillar, stance, severityScore: base, adjustedScore: adjusted, severity: bandOf(adjusted) };
  }).sort((a, b) => b.adjustedScore - a.adjustedScore).slice(0, MAX_CONTRACT_FINDINGS);

  const byPillar = Object.fromEntries(PILLARS.map((p) => [p, pillarScore(findings.filter((f) => f.pillar === p).map((f) => f.adjustedScore))])) as Record<Pillar, number>;
  const peak = findings.reduce((max, f) => Math.max(max, f.adjustedScore), 0);
  const score = compositeScore(byPillar, weights, peak);
  const pillarBreakdown: PillarScore[] = PILLARS.map((p) => ({ pillar: p, score: Math.round(byPillar[p]), weight: weights[p], findings: findings.filter((f) => f.pillar === p).length }));
  const aiScore = Number(analysis.overallRiskScore);
  return { ...analysis, analyzedClauses: findings, overallRiskScore: score, riskLevel: bandOf(score), pillarBreakdown, aiRiskScore: Number.isFinite(aiScore) ? aiScore : null };
}

