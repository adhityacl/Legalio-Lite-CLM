import { Badge, type StatusTone } from '@legalio/ui-components/badge';
import { NUMERIC_METRICS, RISK_LEVELS, SEVERITIES, type NumericMetric, type RiskLevel, type Severity } from '@legalio/shared/playbook';

export type T = (key: string, fallback?: string, vars?: Record<string, string | number>) => string;

export const RISK_KEYS: Record<RiskLevel, [string, string]> = {
  low: ['clauses.risk.low', 'Low risk'], medium: ['clauses.risk.medium', 'Medium risk'], high: ['clauses.risk.high', 'High risk'],
};
export const SEVERITY_KEYS: Record<Severity, [string, string]> = {
  info: ['playbook.severity.info', 'Info'], low: ['playbook.severity.low', 'Low'], medium: ['playbook.severity.medium', 'Medium'], high: ['playbook.severity.high', 'High'], critical: ['playbook.severity.critical', 'Critical'],
};
export const METRIC_KEYS: Record<NumericMetric, [string, string]> = {
  payment_terms_days: ['clauses.metric.payment_terms_days', 'Payment terms (days)'], liability_cap_months: ['clauses.metric.liability_cap_months', 'Liability cap (months of fees)'],
  notice_period_days: ['clauses.metric.notice_period_days', 'Notice period (days)'], late_interest_pct: ['clauses.metric.late_interest_pct', 'Late-payment interest (%)'],
  term_months: ['clauses.metric.term_months', 'Contract term (months)'], custom: ['clauses.metric.custom', 'Custom value (pattern)'],
};
export const LANGUAGE_KEYS: Record<string, [string, string]> = {
  '': ['clauses.language.any', 'Any language'], en: ['clauses.language.en', 'English'], id: ['clauses.language.id', 'Indonesian'], zh: ['clauses.language.zh', 'Chinese'],
};
export const KIND_KEYS: Record<string, [string, string]> = {
  missing_required: ['playbook.kind.missing_required', 'Missing clause'], forbidden_phrase: ['playbook.kind.forbidden_phrase', 'Unacceptable wording'],
  numeric_out_of_range: ['playbook.kind.numeric_out_of_range', 'Outside the allowed range'], numeric_not_found: ['playbook.kind.numeric_not_found', 'Figure not stated'],
  ai_semantic: ['playbook.kind.ai_semantic', 'AI review'],
};

const RISK_TONE: Record<RiskLevel, StatusTone> = { low: 'success', medium: 'warning', high: 'danger' };
const SEVERITY_TONE: Record<Severity, StatusTone> = { info: 'neutral', low: 'info', medium: 'warning', high: 'danger', critical: 'danger' };

export const RiskBadge = ({ t, risk }: { t: T; risk: RiskLevel }) => <Badge tone={RISK_TONE[risk]}>{t(...RISK_KEYS[risk])}</Badge>;
export const SeverityBadge = ({ t, severity }: { t: T; severity: Severity }) => <Badge tone={SEVERITY_TONE[severity]}>{t(...SEVERITY_KEYS[severity])}</Badge>;

export { NUMERIC_METRICS, RISK_LEVELS, SEVERITIES };
