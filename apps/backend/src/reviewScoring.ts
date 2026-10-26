/**
 * Risk score of an AI review (contracts, service orders, partners, spendings, evaluations), computed from the severities of
 * its findings instead of taken from the model: the same findings always give the same score, and the level always matches
 * one of the four bands the UI knows.
 */
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RiskLevel = Severity;
export const SEVERITY_POINTS: Record<Severity, number> = { CRITICAL: 25, HIGH: 15, MEDIUM: 7, LOW: 2 };
const CHECKLIST_STATUSES = ['COMPLIANT', 'NEEDS_REVIEW', 'NON_COMPLIANT'] as const;
/** The prompts ask for at most 6 findings, most important first; more would also inflate the summed score. */
export const MAX_REVIEW_ITEMS = 6;

/** Models also answer "MODERATE", "Minor", "Severe" and the like; anything unknown counts as MEDIUM. */
export function normalizeSeverity(value: unknown): Severity {
  const v = String(value ?? '').trim().toUpperCase();
  if (v === 'CRITICAL' || v === 'HIGH' || v === 'MEDIUM' || v === 'LOW') return v;
  if (/^(SEVERE|MAJOR|VERY HIGH)$/.test(v)) return 'HIGH';
  if (/^(MINOR|INFO|INFORMATIONAL|NONE)$/.test(v)) return 'LOW';
  return 'MEDIUM';
}

/** The bands the prompts and the UI use: 0–25 low, 26–55 medium, 56–75 high, 76–100 critical. */
export function riskLevelOf(score: number): RiskLevel {
  if (score <= 25) return 'LOW';
  if (score <= 55) return 'MEDIUM';
  if (score <= 75) return 'HIGH';
  return 'CRITICAL';
}

export function scoreOf(severities: Severity[]): number {
  return Math.min(100, severities.reduce((sum, severity) => sum + SEVERITY_POINTS[severity], 0));
}

const clip = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);

/** Checklist items with a status outside the three known ones become NEEDS_REVIEW. Shared with the contract pillar engine. */
export function normalizeChecklist(value: unknown): Array<Record<string, any>> {
  const checklist = Array.isArray(value) ? value.filter((c: unknown) => c && typeof c === 'object') : [];
  for (const item of checklist) {
    const status = String(item.status ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    item.status = (CHECKLIST_STATUSES as readonly string[]).includes(status) ? status : 'NEEDS_REVIEW';
  }
  return checklist;
}

/** Skipped industry rules, kept with the result (not shown in the UI). Shared with the contract pillar engine. */
export function normalizeNotApplicable(value: unknown): Array<{ rule: string; reason: string }> {
  return (Array.isArray(value) ? value : [])
    .filter((r: any) => r && typeof r === 'object' && String(r.rule ?? '').trim())
    .slice(0, 20)
    .map((r: any) => ({ rule: clip(r.rule, 200), reason: clip(r.reason, 500) }));
}

/**
 * Normalizes a parsed review in place of the model's own numbers: clause severities and checklist statuses are mapped onto the
 * known values, the score and level are recomputed, and the model's score is kept as `aiRiskScore` for reference.
 */
export function scoreReview<T extends Record<string, any>>(analysis: T): T & { overallRiskScore: number; riskLevel: RiskLevel; aiRiskScore: number | null; notApplicableRules: Array<{ rule: string; reason: string }> } {
  const clauses = Array.isArray(analysis.analyzedClauses) ? analysis.analyzedClauses.filter((c: unknown) => c && typeof c === 'object').slice(0, MAX_REVIEW_ITEMS) : [];
  for (const clause of clauses) clause.severity = normalizeSeverity(clause.severity);
  const score = scoreOf(clauses.map((c: any) => c.severity));
  const aiScore = Number(analysis.overallRiskScore);
  return {
    ...analysis,
    analyzedClauses: clauses,
    complianceChecklist: normalizeChecklist(analysis.complianceChecklist),
    notApplicableRules: normalizeNotApplicable(analysis.notApplicableRules),
    overallRiskScore: score,
    riskLevel: riskLevelOf(score),
    aiRiskScore: Number.isFinite(aiScore) ? aiScore : null,
  };
}
