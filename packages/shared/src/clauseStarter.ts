/**
 * Starter clause library: the baseline clauses every organization usually wants (with approved wording, fallbacks and the rules the
 * playbook checks them with). Importing them is an explicit, per-organization action and never overwrites anything: a starter clause
 * that already exists (by `starter_key`) is skipped. Industry clauses come from the organization's policy pack (see the server).
 */
import { phrasesFromTitle, type ClauseRules, type RiskLevel } from './playbook';

export interface StarterClause {
  starter_key: string;
  title: string;
  category: string;
  risk_level: RiskLevel;
  approved_text: string;
  fallback_texts: string[];
  guidance: string;
  language: 'en' | '';
  jurisdiction: string;
  tags: string[];
  rules: ClauseRules;
}

const rules = (partial: Partial<ClauseRules>): ClauseRules => ({ required: false, present_any: [], forbidden: [], numeric: [], severity: null, ...partial });

export const BASELINE_STARTER_CLAUSES: StarterClause[] = [
  {
    starter_key: 'baseline.limitation-of-liability', title: 'Limitation of liability', category: 'Liability', risk_level: 'high', language: 'en', jurisdiction: '', tags: ['liability', 'baseline'],
    guidance: 'Liability should be capped at no less than twelve months of fees and should never be unlimited.',
    approved_text: 'Each party\'s total aggregate liability arising out of or in connection with this Agreement shall not exceed the fees paid or payable under this Agreement in the twelve (12) months preceding the event giving rise to the claim. Nothing in this Agreement limits liability for fraud, wilful misconduct, gross negligence, or any liability that cannot be limited by law.',
    fallback_texts: ['Each party\'s total aggregate liability arising out of or in connection with this Agreement shall not exceed one hundred percent (100%) of the total fees paid or payable under this Agreement. Nothing in this Agreement limits liability for fraud, wilful misconduct or any liability that cannot be limited by law.'],
    rules: rules({ required: true, present_any: ['limitation of liability', 'limit of liability', 'liability cap', 'aggregate liability', 'total liability', 'batasan tanggung jawab', 'tanggung jawab maksimum', '责任限制'],
      forbidden: ['unlimited liability', 'liability shall be unlimited', 'tanpa batas tanggung jawab', 'tanggung jawab tidak terbatas', '无限责任'], numeric: [{ metric: 'liability_cap_months', min: 12, max: null, required: false }] }),
  },
  {
    starter_key: 'baseline.payment-terms', title: 'Payment terms', category: 'Commercial', risk_level: 'medium', language: 'en', jurisdiction: '', tags: ['payment', 'baseline'],
    guidance: 'Undisputed invoices are paid within 30 days, at most 45; late payment carries interest.',
    approved_text: 'Each undisputed invoice shall be paid within thirty (30) days of the date on which a correct invoice is received. Amounts not paid when due bear interest at one percent (1%) per month on the overdue amount until payment is made in full.',
    fallback_texts: ['Each undisputed invoice shall be paid within forty-five (45) days of the date on which a correct invoice is received. Amounts not paid when due bear interest at one percent (1%) per month on the overdue amount until payment is made in full.'],
    rules: rules({ required: true, present_any: ['payment terms', 'shall be paid', 'be paid within', 'shall pay', 'will pay', 'pay each invoice', 'payment shall be made', 'invoices shall be paid', 'payable within', 'syarat pembayaran', 'pembayaran dilakukan', 'dibayar dalam', '付款条款', '付款期限'],
      numeric: [{ metric: 'payment_terms_days', min: null, max: 45, required: false }] }),
  },
  {
    starter_key: 'baseline.termination-and-notice', title: 'Termination and notice', category: 'Term and termination', risk_level: 'medium', language: 'en', jurisdiction: '', tags: ['termination', 'baseline'],
    guidance: 'A right to terminate for convenience on 30 to 90 days\' written notice and for uncured material breach.',
    approved_text: 'Either party may terminate this Agreement for convenience by giving the other party not less than thirty (30) days\' prior written notice. Either party may terminate this Agreement immediately by written notice if the other party commits a material breach that is not remedied within thirty (30) days of written notice requiring it to be remedied.',
    fallback_texts: ['Either party may terminate this Agreement for convenience by giving the other party not less than sixty (60) days\' prior written notice. Either party may terminate this Agreement by written notice if the other party commits a material breach that is not remedied within thirty (30) days of written notice.'],
    rules: rules({ required: true, present_any: ['terminate this agreement', 'termination for convenience', 'right to terminate', 'pengakhiran perjanjian', 'mengakhiri perjanjian', '终止本协议', '终止合同'],
      numeric: [{ metric: 'notice_period_days', min: 30, max: 90, required: false }] }),
  },
  {
    starter_key: 'baseline.confidentiality', title: 'Confidentiality', category: 'Confidentiality', risk_level: 'medium', language: 'en', jurisdiction: '', tags: ['confidentiality', 'baseline'],
    guidance: 'Mutual confidentiality that survives termination.',
    approved_text: 'Each party shall keep the other party\'s Confidential Information strictly confidential, use it only to perform this Agreement, and disclose it only to those of its personnel and advisers who need to know it and are bound by equivalent duties. These obligations survive for three (3) years after the termination or expiry of this Agreement.',
    fallback_texts: ['Each party shall keep the other party\'s Confidential Information confidential and use it only for the purposes of this Agreement. These obligations survive for two (2) years after the termination or expiry of this Agreement.'],
    rules: rules({ required: true, present_any: ['confidential information', 'confidentiality', 'non-disclosure', 'informasi rahasia', 'kerahasiaan', '保密信息', '保密义务'] }),
  },
  {
    starter_key: 'baseline.governing-law', title: 'Governing law and disputes', category: 'Disputes', risk_level: 'medium', language: 'en', jurisdiction: '', tags: ['governing law', 'baseline'],
    guidance: 'Name the governing law and the forum; escalate before litigating.',
    approved_text: 'This Agreement is governed by the laws of [jurisdiction]. The parties shall first try to resolve any dispute by good-faith negotiation between their senior management for thirty (30) days; failing that, the dispute shall be finally settled by [the courts of / arbitration in] [place].',
    fallback_texts: ['This Agreement is governed by the laws of [jurisdiction], and the courts of [place] have non-exclusive jurisdiction over any dispute arising out of or in connection with it.'],
    rules: rules({ required: true, present_any: ['governed by the laws', 'governing law', 'laws of', 'hukum yang berlaku', 'diatur oleh hukum', '适用法律', '管辖法律'] }),
  },
  {
    starter_key: 'baseline.data-protection', title: 'Personal data protection', category: 'Data protection', risk_level: 'high', language: 'en', jurisdiction: '', tags: ['privacy', 'baseline'],
    guidance: 'Required whenever personal data is processed: purpose limits, security, breach notice, deletion.',
    approved_text: 'Each party shall process personal data received under this Agreement only for the purposes of this Agreement and in compliance with applicable data protection laws, shall implement appropriate technical and organisational security measures, shall notify the other party without undue delay (and within seventy-two (72) hours) after becoming aware of a personal data breach, and shall delete or return personal data on termination.',
    fallback_texts: ['Each party shall comply with applicable data protection laws when processing personal data under this Agreement and shall notify the other party without undue delay after becoming aware of a personal data breach.'],
    rules: rules({ required: false, present_any: ['personal data', 'data protection', 'data subject', 'data pribadi', 'perlindungan data', '个人信息', '个人数据'] }),
  },
];

/* ------------------------------ policy-pack clauses ------------------------------ */


/** The shape of a policy pack's `criticalClauses` entry that matters here (kept structural so the browser build needs no pack types). */
export interface PackClauseInput { clause: { en: string; id?: string }; rule: { en: string; id?: string } }

const slug = (value: string) => value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const sameTitle = (a: string, b: string) => slug(a) === slug(b);

/**
 * Starter clauses from an industry pack's `clauseRules` (the clauses the AI reviewer already looks for, with the rule that flags them). A pack
 * clause has no approved wording (the organization writes its own); it is a required clause detected by the words of its title, and the pack's
 * rule becomes the guidance. Clauses the baseline already covers are left out.
 */
export function packStarterClauses(industryKey: string, criticalClauses: PackClauseInput[]): StarterClause[] {
  const out: StarterClause[] = [];
  const seen = new Set<string>();
  for (const entry of criticalClauses) {
    const title = entry.clause.en.trim();
    if (!title || BASELINE_STARTER_CLAUSES.some((b) => sameTitle(b.title, title))) continue;
    const key = `pack.${slug(industryKey)}.${slug(title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const phrases = [...new Set([...phrasesFromTitle(title), ...phrasesFromTitle(entry.clause.id ?? '')])].slice(0, 8);
    out.push({
      starter_key: key, title, category: 'Industry', risk_level: 'medium', language: 'en', jurisdiction: '', tags: ['industry', slug(industryKey)],
      guidance: entry.rule.en.trim(), approved_text: '', fallback_texts: [],
      rules: { required: phrases.length > 0, present_any: phrases, forbidden: [], numeric: [], severity: null },
    });
  }
  return out;
}
