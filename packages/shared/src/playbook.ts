/**
 * The playbook engine: checks a contract's text against the organization's clause library with deterministic rules (no AI, no I/O).
 *
 *   - required clauses: the contract must contain wording that matches one of the clause's detection phrases;
 *   - forbidden phrases: wording the organization does not accept;
 *   - numeric thresholds: payment terms, liability cap, notice period, late-payment interest and contract term are read from the text
 *     (digits, "thirty (30)", English number words) and compared with the allowed range; custom metrics use a pattern with one capture group.
 *
 * Every finding carries a severity, the source quote (the sentence it was found in) and, where the library has one, the text to put
 * in the contract instead: the approved clause for a missing one, the first fallback for a violation.
 *
 * Detection phrases are plain phrases (case-insensitive, whitespace-flexible, matched on word boundaries) or, with a `re:` prefix, a regular
 * expression. Because these patterns are written by users and run on other users' documents, regular expressions are restricted to a
 * safe subset (see `regexProblem`): no backreferences, no lookbehind, no quantified groups, bounded length.
 */

export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const NUMERIC_METRICS = ['payment_terms_days', 'liability_cap_months', 'notice_period_days', 'late_interest_pct', 'term_months', 'custom'] as const;
export type NumericMetric = (typeof NUMERIC_METRICS)[number];
export const CLAUSE_LANGUAGES = ['', 'en', 'id', 'zh'] as const;

export const MAX_PHRASES = 25;
export const MAX_PHRASE_LENGTH = 200;
export const MAX_NUMERIC_RULES = 10;
export const MAX_ANALYSED_CHARS = 200_000;

export interface NumericRule {
  metric: NumericMetric;
  min: number | null;
  max: number | null;
  /** `custom` only: a `re:` pattern with ONE capture group holding the number. */
  pattern?: string;
  /** Display name of the quantity (`custom`), e.g. "warranty months". */
  label?: string;
  /** When the contract states no such figure at all, report it. */
  required: boolean;
}
export interface ClauseRules {
  /** The contract must contain this clause (one of `present_any` must match). */
  required: boolean;
  present_any: string[];
  forbidden: string[];
  numeric: NumericRule[];
  /** Overrides the severity derived from the clause's risk level. */
  severity: Severity | null;
}
export const EMPTY_RULES: ClauseRules = { required: false, present_any: [], forbidden: [], numeric: [], severity: null };

export interface PlaybookClause {
  id: string;
  title: string;
  category: string;
  risk_level: RiskLevel;
  approved_text: string;
  fallback_texts: string[];
  guidance: string;
  rules: ClauseRules;
}

export type FindingKind = 'missing_required' | 'forbidden_phrase' | 'numeric_out_of_range' | 'numeric_not_found' | 'ai_semantic';
export interface Finding {
  id: string;
  kind: FindingKind;
  severity: Severity;
  clause_id: string;
  clause_title: string;
  message: string;
  /** The sentence of the contract the finding is about (null for a missing clause). */
  quote: string | null;
  /** Text offsets of the quote in the analysed text. */
  start: number | null;
  end: number | null;
  /** What the contract says / what the playbook allows, for numeric findings. */
  metric?: NumericMetric;
  found?: number;
  min?: number | null;
  max?: number | null;
  /** Wording to use: the approved clause for a missing one, the first fallback (else the approved clause) for a violation. */
  suggested_text: string | null;
  suggested_kind: 'approved' | 'fallback' | null;
  /** True for findings from the optional AI semantic check (advisory). */
  ai?: boolean;
}

/* ------------------------------ patterns ------------------------------ */

const REGEX_PREFIX = 're:';

/** Why a user-written regular expression is not accepted, or null. */
export function regexProblem(source: string): string | null {
  if (source.length === 0) return 'The pattern is empty.';
  if (source.length > MAX_PHRASE_LENGTH) return `The pattern is longer than ${MAX_PHRASE_LENGTH} characters.`;
  if (/\\[1-9]|\\k</.test(source)) return 'Back-references are not allowed.';
  if (/\(\?<?[=!]/.test(source)) return 'Look-around is not allowed.';
  // A group that is itself repeated (`(a+)+`, `(ab)*`, `(a|b){2,}`) is the classic catastrophic-backtracking shape.
  if (/\)\s*(?:[*+]|\{\d*,?\d*\})/.test(source)) return 'A repeated group is not allowed; repeat single characters or classes instead.';
  // Nested open-ended quantifiers on adjacent atoms (`.*.*`, `\s*\s*`) multiply the work.
  if (/(?:[*+]|\{\d+,\})\??\s*(?:\.|\\[sdwSDW]|\[[^\]]*\])\s*(?:[*+]|\{\d+,\})/.test(source)) return 'Adjacent open-ended repetitions are not allowed.';
  try { new RegExp(source, 'iu'); } catch { return 'The pattern is not a valid regular expression.'; }
  return null;
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A compiled detection pattern, or null when it is empty or not acceptable. */
export function compilePattern(pattern: string, flags = 'giu'): RegExp | null {
  const raw = pattern.trim();
  if (!raw) return null;
  if (raw.toLowerCase().startsWith(REGEX_PREFIX)) {
    const source = raw.slice(REGEX_PREFIX.length).trim();
    if (regexProblem(source)) return null;
    return new RegExp(source, flags);
  }
  if (raw.length > MAX_PHRASE_LENGTH) return null;
  const body = raw.split(/\s+/).map(escapeRegex).join('\\s+');
  const lead = /^[\p{L}\p{N}]/u.test(raw) ? '(?<![\\p{L}\\p{N}])' : '';
  const tail = /[\p{L}\p{N}]$/u.test(raw) ? '(?![\\p{L}\\p{N}])' : '';
  return new RegExp(`${lead}${body}${tail}`, flags);
}

/** Problems found in a rules object, in plain words (empty when it is acceptable). */
export function validateRules(input: unknown): string[] {
  const problems: string[] = [];
  if (input === null || input === undefined) return problems;
  if (typeof input !== 'object' || Array.isArray(input)) return ['The rules must be an object.'];
  const rules = input as Record<string, unknown>;
  for (const key of Object.keys(rules)) if (!['required', 'present_any', 'forbidden', 'numeric', 'severity'].includes(key)) problems.push(`Unknown rule field: ${key}.`);
  const phrases = (name: 'present_any' | 'forbidden') => {
    const list = rules[name];
    if (list === undefined) return;
    if (!Array.isArray(list)) { problems.push(`${name} must be a list of phrases.`); return; }
    if (list.length > MAX_PHRASES) problems.push(`${name} has more than ${MAX_PHRASES} phrases.`);
    list.forEach((item, index) => {
      if (typeof item !== 'string' || !item.trim()) { problems.push(`${name} #${index + 1} is empty.`); return; }
      if (item.trim().toLowerCase().startsWith(REGEX_PREFIX)) {
        const problem = regexProblem(item.trim().slice(REGEX_PREFIX.length).trim());
        if (problem) problems.push(`${name} #${index + 1}: ${problem}`);
      } else if (item.length > MAX_PHRASE_LENGTH) problems.push(`${name} #${index + 1} is longer than ${MAX_PHRASE_LENGTH} characters.`);
    });
  };
  phrases('present_any');
  phrases('forbidden');
  if (rules.required !== undefined && typeof rules.required !== 'boolean') problems.push('required must be true or false.');
  if (rules.severity !== undefined && rules.severity !== null && !(SEVERITIES as readonly string[]).includes(rules.severity as string)) problems.push('Unknown severity.');
  if (rules.numeric !== undefined) {
    if (!Array.isArray(rules.numeric)) problems.push('numeric must be a list.');
    else {
      if (rules.numeric.length > MAX_NUMERIC_RULES) problems.push(`At most ${MAX_NUMERIC_RULES} numeric rules.`);
      rules.numeric.forEach((item, index) => {
        const rule = item as Record<string, unknown> | null;
        if (!rule || typeof rule !== 'object') { problems.push(`numeric #${index + 1} is not an object.`); return; }
        if (!(NUMERIC_METRICS as readonly string[]).includes(rule.metric as string)) problems.push(`numeric #${index + 1}: unknown metric.`);
        for (const bound of ['min', 'max'] as const) if (rule[bound] !== undefined && rule[bound] !== null && !Number.isFinite(Number(rule[bound]))) problems.push(`numeric #${index + 1}: ${bound} must be a number.`);
        if (rule.min != null && rule.max != null && Number(rule.min) > Number(rule.max)) problems.push(`numeric #${index + 1}: min is greater than max.`);
        if (rule.metric === 'custom') {
          const pattern = typeof rule.pattern === 'string' ? rule.pattern.trim() : '';
          const source = pattern.toLowerCase().startsWith(REGEX_PREFIX) ? pattern.slice(REGEX_PREFIX.length).trim() : pattern;
          const problem = source ? regexProblem(source) : 'A custom metric needs a pattern.';
          if (problem) problems.push(`numeric #${index + 1}: ${problem}`);
          else if (!/\((?!\?)/.test(source)) problems.push(`numeric #${index + 1}: the pattern needs one capture group around the number.`);
        }
      });
    }
  }
  return problems;
}

/** Lenient normalization of stored rules: unknown or invalid parts are dropped, never thrown on. */
export function normalizeRules(input: unknown): ClauseRules {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const phrases = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim()).slice(0, MAX_PHRASES) : []);
  const numeric: NumericRule[] = [];
  if (Array.isArray(source.numeric)) {
    for (const item of source.numeric.slice(0, MAX_NUMERIC_RULES)) {
      const rule = item as Record<string, unknown> | null;
      if (!rule || typeof rule !== 'object' || !(NUMERIC_METRICS as readonly string[]).includes(rule.metric as string)) continue;
      const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
      numeric.push({ metric: rule.metric as NumericMetric, min: num(rule.min), max: num(rule.max), required: rule.required === true,
        ...(rule.metric === 'custom' ? { pattern: String(rule.pattern ?? '').slice(0, MAX_PHRASE_LENGTH), label: String(rule.label ?? '').slice(0, 80) } : {}) });
    }
  }
  return {
    required: source.required === true, present_any: phrases(source.present_any), forbidden: phrases(source.forbidden), numeric,
    severity: (SEVERITIES as readonly string[]).includes(source.severity as string) ? source.severity as Severity : null,
  };
}

/* ------------------------------ text helpers ------------------------------ */

interface Sentence { text: string; start: number; end: number }

const MAX_CHUNK = 1500;
/**
 * Splits on sentence punctuation (followed by a space), semicolons and blank lines; a single line break stays inside the sentence (PDF text
 * wraps lines mid-sentence). A stretch longer than MAX_CHUNK without any boundary is cut so no pattern ever runs on a huge string.
 */
export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  const boundary = /(?<=[.!?。！？;；])\s+|\n\s*\n+/g;
  let start = 0;
  const push = (end: number) => {
    const raw = text.slice(start, end);
    const trimmed = raw.trim();
    if (!trimmed) return;
    const offset = start + raw.indexOf(trimmed);
    for (let at = 0; at < trimmed.length; at += MAX_CHUNK) {
      const piece = trimmed.slice(at, at + MAX_CHUNK);
      sentences.push({ text: piece, start: offset + at, end: offset + at + piece.length });
    }
  };
  for (const match of text.matchAll(boundary)) { push(match.index!); start = match.index! + match[0].length; }
  push(text.length);
  return sentences;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const UNITS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** "thirty (30) days" -> "30 days"; "forty-five days" -> "45 days"; "ninety days" -> "90 days". Applied to one sentence. */
export function normalizeNumbers(sentence: string): string {
  const word = `(?:${[...TENS, ...UNITS, 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'hundred'].join('|')})`;
  // "thirty (30)" and "forty-five (45)": the figure in brackets is what the contract means.
  let out = sentence.replace(new RegExp(`\\b${word}(?:[- ]${word})*\\s*\\(\\s*(\\d{1,4}(?:[.,]\\d+)?)\\s*\\)`, 'gi'), '$1');
  out = out.replace(new RegExp(`\\b(${TENS.join('|')})[- ](${UNITS.join('|')})\\b`, 'gi'), (_m, tens: string, unit: string) => String(WORD_NUMBERS[tens.toLowerCase()] + WORD_NUMBERS[unit.toLowerCase()]));
  out = out.replace(new RegExp(`\\b(${Object.keys(WORD_NUMBERS).join('|')})\\b(?=\\s+(?:calendar\\s+|business\\s+|working\\s+)?(?:days?|months?|years?|per\\s*cent|percent))`, 'gi'), (w) => String(WORD_NUMBERS[w.toLowerCase()]));
  return out;
}

const toNumber = (raw: string) => Number(raw.replace(',', '.'));
const PAYMENT_CONTEXT = /\b(pay|payment|payable|invoice|invoices|invoiced|remit|settle|settlement|bayar|pembayaran|dibayar|tagihan|faktur)\b|付款|支付|发票|结算/iu;
const NOTICE_CONTEXT = /\b(notice|notify|notification|pemberitahuan|pemberitahuan tertulis|memberitahukan)\b|通知/iu;
const LIABILITY_CONTEXT = /\b(liabilit(?:y|ies)|liable|tanggung\s*jawab)\b|责任/iu;
const INTEREST_CONTEXT = /\b(interest|late|penalt(?:y|ies)|denda|bunga|keterlambatan)\b|利息|滞纳|罚/iu;
const TERM_CONTEXT = /\b(term|period|duration|jangka\s*waktu|masa\s*berlaku)\b|期限|有效期/iu;
const DAYS = String.raw`(\d{1,4})\s*(?:calendar\s+|business\s+|working\s+|kalender\s+|kerja\s+)?(?:days?|hari)\b`;
const DAYS_CJK = /(\d{1,4})\s*(?:个)?(?:天|日)/u;
const MONTHS = String.raw`(\d{1,3})\s*(?:calendar\s+)?(?:months?|bulan)\b`;
const YEARS = String.raw`(\d{1,2})\s*(?:years?|tahun)\b`;

interface Reading { value: number; sentence: Sentence }

const firstNumber = (sentence: string, patterns: Array<[RegExp, number]>): number | null => {
  for (const [pattern, factor] of patterns) {
    const match = pattern.exec(sentence);
    if (match) return toNumber(match[1]) * factor;
  }
  return null;
};

/** Every reading of a built-in metric in the text (one per sentence that states it). */
function readMetric(metric: Exclude<NumericMetric, 'custom'>, sentences: Sentence[]): Reading[] {
  const readings: Reading[] = [];
  for (const sentence of sentences) {
    const text = normalizeNumbers(sentence.text);
    let value: number | null = null;
    switch (metric) {
      case 'payment_terms_days':
        if (PAYMENT_CONTEXT.test(text)) value = firstNumber(text, [[new RegExp(DAYS, 'iu'), 1], [DAYS_CJK, 1]]);
        break;
      case 'notice_period_days':
        if (NOTICE_CONTEXT.test(text)) value = firstNumber(text, [[new RegExp(DAYS, 'iu'), 1], [DAYS_CJK, 1], [new RegExp(MONTHS, 'iu'), 30]]);
        break;
      case 'liability_cap_months':
        if (LIABILITY_CONTEXT.test(text)) value = firstNumber(text, [[new RegExp(MONTHS, 'iu'), 1], [new RegExp(YEARS, 'iu'), 12], [/(\d{1,3})\s*个月/u, 1], [/(\d{1,2})\s*年/u, 12]]);
        break;
      case 'late_interest_pct':
        if (INTEREST_CONTEXT.test(text)) value = firstNumber(text, [[/(\d{1,3}(?:[.,]\d+)?)\s*(?:%|per\s*cent|percent|persen)/iu, 1]]);
        break;
      case 'term_months':
        if (TERM_CONTEXT.test(text)) value = firstNumber(text, [[new RegExp(YEARS, 'iu'), 12], [new RegExp(MONTHS, 'iu'), 1], [/(\d{1,2})\s*年/u, 12], [/(\d{1,3})\s*个月/u, 1]]);
        break;
    }
    if (value !== null && Number.isFinite(value)) readings.push({ value, sentence });
  }
  return readings;
}

const METRIC_LABEL: Record<NumericMetric, string> = {
  payment_terms_days: 'payment terms (days)', liability_cap_months: 'liability cap (months of fees)', notice_period_days: 'notice period (days)',
  late_interest_pct: 'late-payment interest (%)', term_months: 'contract term (months)', custom: 'value',
};
export const metricLabel = (metric: NumericMetric) => METRIC_LABEL[metric];

function readCustom(rule: NumericRule, sentences: Sentence[]): Reading[] {
  const regex = rule.pattern ? compilePattern(rule.pattern, 'iu') : null;
  if (!regex || !/\((?!\?)/.test(regex.source)) return [];
  const readings: Reading[] = [];
  for (const sentence of sentences) {
    const match = regex.exec(normalizeNumbers(sentence.text));
    if (match && match[1] !== undefined) {
      const value = toNumber(match[1]);
      if (Number.isFinite(value)) readings.push({ value, sentence });
    }
  }
  return readings;
}

/* ------------------------------ the engine ------------------------------ */

const RISK_SEVERITY: Record<RiskLevel, Severity> = { low: 'low', medium: 'medium', high: 'high' };
const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

function allowedRange(rule: NumericRule): string {
  if (rule.min != null && rule.max != null) return `${fmt(rule.min)} to ${fmt(rule.max)}`;
  if (rule.max != null) return `at most ${fmt(rule.max)}`;
  if (rule.min != null) return `at least ${fmt(rule.min)}`;
  return 'any';
}

export interface PlaybookOptions { maxChars?: number }

/** Runs every clause's rules over `text`. Findings come back most severe first, then in clause order. */
export function runPlaybook(text: string, clauses: PlaybookClause[], options: PlaybookOptions = {}): Finding[] {
  const body = String(text ?? '').slice(0, options.maxChars ?? MAX_ANALYSED_CHARS);
  const sentences = splitSentences(body);
  const findings: Array<Finding & { order: number }> = [];
  const seen = new Set<string>();
  const add = (order: number, finding: Omit<Finding, 'id'>) => {
    const key = `${finding.clause_id}|${finding.kind}|${finding.metric ?? ''}|${finding.quote ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ ...finding, id: `f${findings.length + 1}`, order });
  };

  clauses.forEach((clause, order) => {
    const rules = clause.rules;
    const severity = rules.severity ?? RISK_SEVERITY[clause.risk_level] ?? 'medium';
    const approved = clause.approved_text.trim() || null;
    const fallback = clause.fallback_texts.map((f) => f.trim()).find(Boolean) ?? null;
    const base = { clause_id: clause.id, clause_title: clause.title };

    if (rules.required && rules.present_any.length) {
      // Per sentence: a pattern never runs on more than one bounded stretch of text, whatever the document looks like.
      const present = rules.present_any.some((phrase) => { const regex = compilePattern(phrase, 'iu'); return regex ? sentences.some((s) => regex.test(s.text)) : false; });
      if (!present) {
        add(order, { ...base, kind: 'missing_required', severity, quote: null, start: null, end: null,
          message: `No wording for "${clause.title}" was found${clause.guidance ? `: ${clause.guidance}` : ''}`,
          suggested_text: approved, suggested_kind: approved ? 'approved' : null });
      }
    }

    for (const phrase of rules.forbidden) {
      const regex = compilePattern(phrase, 'giu');
      if (!regex) continue;
      let hits = 0;
      for (const sentence of sentences) {
        const match = regex.exec(sentence.text);
        regex.lastIndex = 0;
        if (!match || !match[0]) continue;
        if (++hits > 20) break;
        add(order, { ...base, kind: 'forbidden_phrase', severity, quote: oneLine(sentence.text), start: sentence.start, end: sentence.end,
          message: `"${match[0].replace(/\s+/g, ' ').slice(0, 80)}" is not acceptable under "${clause.title}"`, suggested_text: fallback ?? approved, suggested_kind: fallback ? 'fallback' : approved ? 'approved' : null });
      }
    }

    for (const rule of rules.numeric) {
      const readings = rule.metric === 'custom' ? readCustom(rule, sentences) : readMetric(rule.metric, sentences);
      const label = rule.metric === 'custom' && rule.label ? rule.label : metricLabel(rule.metric);
      if (!readings.length) {
        if (rule.required) {
          add(order, { ...base, kind: 'numeric_not_found', severity: severity === 'critical' || severity === 'high' ? 'medium' : 'low', quote: null, start: null, end: null, metric: rule.metric, min: rule.min, max: rule.max,
            message: `The contract does not state ${label}; the playbook expects ${allowedRange(rule)}`, suggested_text: approved, suggested_kind: approved ? 'approved' : null });
        }
        continue;
      }
      for (const reading of readings) {
        const below = rule.min != null && reading.value < rule.min;
        const above = rule.max != null && reading.value > rule.max;
        if (!below && !above) continue;
        add(order, { ...base, kind: 'numeric_out_of_range', severity, quote: oneLine(reading.sentence.text), start: reading.sentence.start, end: reading.sentence.end, metric: rule.metric, found: reading.value, min: rule.min, max: rule.max,
          message: `${label}: the contract says ${fmt(reading.value)}, the playbook allows ${allowedRange(rule)}`, suggested_text: fallback ?? approved, suggested_kind: fallback ? 'fallback' : approved ? 'approved' : null });
      }
    }
  });

  return findings
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.order - b.order || (a.start ?? 0) - (b.start ?? 0))
    .map(({ order: _order, ...finding }, index) => ({ ...finding, id: `f${index + 1}` }));
}

/* ------------------------------ starter content ------------------------------ */

const STOP = new Set(['and', 'the', 'of', 'for', 'to', 'a', 'an', 'in', 'on', 'dan', 'untuk', 'yang']);
/** Detection phrases for a clause known only by its title: each part of "A & B / C" and the title's main words. Heuristic, meant to be refined. */
export function phrasesFromTitle(title: string): string[] {
  const parts = title.split(/[&/,;()]|\band\b|\bdan\b/i).map((p) => p.trim().toLowerCase()).filter((p) => p.length >= 4);
  const out = new Set<string>();
  for (const part of parts) {
    const words = part.split(/\s+/).filter((w) => !STOP.has(w));
    if (words.length) out.add(words.join(' '));
  }
  return [...out].slice(0, 6);
}
