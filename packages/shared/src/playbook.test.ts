import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASELINE_STARTER_CLAUSES, packStarterClauses } from './clauseStarter';
import { compilePattern, normalizeNumbers, normalizeRules, phrasesFromTitle, regexProblem, runPlaybook, splitSentences, validateRules, type PlaybookClause } from './playbook';

const starter = (key: string): PlaybookClause => {
  const c = BASELINE_STARTER_CLAUSES.find((s) => s.starter_key === key)!;
  return { id: key, title: c.title, category: c.category, risk_level: c.risk_level, approved_text: c.approved_text, fallback_texts: c.fallback_texts, guidance: c.guidance, rules: c.rules };
};
const liability = starter('baseline.limitation-of-liability');
const payment = starter('baseline.payment-terms');
const termination = starter('baseline.termination-and-notice');

test('numbers are read from digits, "thirty (30)" and English words, per sentence', () => {
  assert.equal(normalizeNumbers('within thirty (30) days'), 'within 30 days');
  assert.equal(normalizeNumbers('within forty-five days of receipt'), 'within 45 days of receipt');
  assert.equal(normalizeNumbers('a period of ninety days'), 'a period of 90 days');
  assert.equal(normalizeNumbers('the one party shall pay'), 'the one party shall pay', 'words not followed by a unit are left alone');
  assert.deepEqual(splitSentences('First one. Second; third\nfourth').map((s) => s.text), ['First one.', 'Second;', 'third\nfourth']);
  const text = 'Alpha. Beta gamma.';
  for (const s of splitSentences(text)) assert.equal(text.slice(s.start, s.end), s.text, 'offsets point into the original text');
});

test('payment terms: within range is quiet, out of range is flagged with the sentence, the fallback and the severity', () => {
  const fine = 'The Customer shall pay each invoice within thirty (30) days of receipt. Late payment bears interest.';
  assert.deepEqual(runPlaybook(fine, [payment]), []);
  const slow = 'This agreement covers services. The Customer shall pay each invoice within ninety (90) days of the invoice date.';
  const [finding] = runPlaybook(slow, [payment]);
  assert.equal(finding.kind, 'numeric_out_of_range');
  assert.equal(finding.metric, 'payment_terms_days');
  assert.equal(finding.found, 90);
  assert.equal(finding.max, 45);
  assert.equal(finding.severity, 'medium');
  assert.equal(finding.quote, 'The Customer shall pay each invoice within ninety (90) days of the invoice date.');
  assert.equal(slow.slice(finding.start!, finding.end!), finding.quote);
  assert.equal(finding.suggested_kind, 'fallback');
  assert.match(finding.suggested_text!, /forty-five \(45\) days/);
  assert.match(finding.message, /says 90.*at most 45/);
  // Indonesian wording and a notice period are not confused with payment terms.
  assert.equal(runPlaybook('Pembayaran dilakukan dalam waktu 60 hari sejak tagihan diterima.', [payment])[0]?.found, 60);
  assert.deepEqual(runPlaybook('Either party may terminate this Agreement on ninety (90) days written notice.', [payment]).filter((f) => f.kind === 'numeric_out_of_range'), [], 'a notice period is not a payment term');
});

test('a required clause that is not in the contract is reported with the approved wording to insert', () => {
  const contract = 'The supplier delivers services. Fees are due monthly.';
  const findings = runPlaybook(contract, [liability, termination]);
  const missing = findings.filter((f) => f.kind === 'missing_required');
  assert.deepEqual(missing.map((f) => f.clause_title), ['Limitation of liability', 'Termination and notice']);
  assert.equal(missing[0].severity, 'high', 'a high-risk clause is reported as high');
  assert.equal(missing[1].severity, 'medium');
  assert.equal(missing[0].quote, null);
  assert.equal(missing[0].suggested_kind, 'approved');
  assert.match(missing[0].suggested_text!, /twelve \(12\) months/);
  assert.equal(findings[0].clause_title, 'Limitation of liability', 'most severe first');
  assert.deepEqual(runPlaybook('Our liability is limited: the limitation of liability is twelve (12) months of fees. Either party may terminate this agreement on 30 days notice.', [liability, termination]), []);
});

test('forbidden phrases and liability-cap thresholds', () => {
  const unlimited = 'The Supplier accepts unlimited liability for all losses. Total liability shall not exceed fees paid in the preceding six (6) months.';
  const findings = runPlaybook(unlimited, [liability]);
  assert.deepEqual(findings.map((f) => f.kind).sort(), ['forbidden_phrase', 'numeric_out_of_range']);
  const cap = findings.find((f) => f.kind === 'numeric_out_of_range')!;
  assert.equal(cap.found, 6);
  assert.equal(cap.min, 12);
  assert.match(cap.message, /at least 12/);
  assert.equal(findings.find((f) => f.kind === 'forbidden_phrase')!.quote, 'The Supplier accepts unlimited liability for all losses.');
  assert.equal(runPlaybook('Liability cap: total liability shall not exceed fees of two (2) years.', [liability]).length, 0, '2 years = 24 months');
  assert.equal(runPlaybook('Limitation of liability: 18 months of fees.', [liability]).length, 0);
  assert.equal(runPlaybook('Batasan tanggung jawab: tanpa batas tanggung jawab untuk Pemasok.', [liability])[0].kind, 'forbidden_phrase');
});

test('notice period, late-payment interest, term and custom metrics', () => {
  const notice: PlaybookClause = { ...termination, rules: { ...termination.rules, required: false, numeric: [{ metric: 'notice_period_days', min: 30, max: 90, required: true }] } };
  assert.equal(runPlaybook('Either party may terminate on ten (10) days written notice.', [notice])[0].found, 10);
  assert.equal(runPlaybook('Termination requires six months written notice.', [notice])[0].found, 180, 'months are converted to days');
  assert.equal(runPlaybook('Either party may terminate on 45 days written notice.', [notice]).length, 0);
  const none = runPlaybook('Nothing about it.', [notice]);
  assert.deepEqual(none.map((f) => f.kind), ['numeric_not_found']);
  assert.equal(none[0].severity, 'low');

  const interest: PlaybookClause = { ...payment, rules: { ...payment.rules, required: false, numeric: [{ metric: 'late_interest_pct', min: null, max: 2, required: false }] } };
  assert.equal(runPlaybook('Late payment bears interest of 5% per month.', [interest])[0].found, 5);
  assert.equal(runPlaybook('Late payment bears interest of 1.5% per month.', [interest]).length, 0);

  const term: PlaybookClause = { ...payment, rules: { ...payment.rules, required: false, numeric: [{ metric: 'term_months', min: null, max: 36, required: false }] } };
  assert.equal(runPlaybook('The initial term of this Agreement is five (5) years.', [term])[0].found, 60);

  const custom: PlaybookClause = { ...payment, rules: { ...payment.rules, required: false, numeric: [{ metric: 'custom', pattern: 're:warranty period of (\\d+) months', label: 'warranty months', min: 12, max: null, required: false }] } };
  const hit = runPlaybook('The warranty period of 6 months applies.', [custom])[0];
  assert.equal(hit.found, 6);
  assert.match(hit.message, /warranty months/);
});

test('detection patterns: phrases are whole-word and whitespace-flexible; regular expressions are restricted', () => {
  assert.ok(compilePattern('limitation of liability', 'iu')!.test('LIMITATION\n  OF   LIABILITY'));
  assert.ok(!compilePattern('law', 'iu')!.test('lawful'), 'whole words only');
  assert.ok(compilePattern('re:gover?ning\\s+law', 'iu')!.test('Governing law'));
  for (const bad of ['re:(a+)+$', 're:(a|aa)*b', 're:(\\w+)\\1', 're:(?<=a)b', 're:.*.*x', 're:a{2,}{3}', 're:[unclosed']) assert.equal(compilePattern(bad), null, bad);
  assert.equal(regexProblem('x'.repeat(300)) !== null, true);
  assert.equal(regexProblem('payment\\s+within\\s+(\\d+)'), null);
  // A pathological text against an accepted pattern still finishes at once.
  const started = Date.now();
  runPlaybook('a'.repeat(100_000), [{ ...payment, rules: { ...payment.rules, present_any: ['re:a+b'], required: true } }]);
  assert.ok(Date.now() - started < 2000);
});

test('rules are validated for the UI and normalized leniently for storage', () => {
  assert.deepEqual(validateRules({ required: true, present_any: ['a', 're:b+'], numeric: [{ metric: 'payment_terms_days', max: 30 }] }), []);
  const problems = validateRules({ colour: 1, required: 'yes', present_any: ['', 're:(a+)+'], forbidden: 'x', numeric: [{ metric: 'nope' }, { metric: 'custom', pattern: 're:abc' }, { metric: 'payment_terms_days', min: 9, max: 3 }], severity: 'extreme' });
  assert.ok(problems.length >= 8, problems.join(' | '));
  assert.match(problems.join('|'), /capture group/);
  assert.deepEqual(normalizeRules({ required: true, present_any: ['x', 5, ''], numeric: [{ metric: 'payment_terms_days', max: '30' }, { metric: 'nope' }], severity: 'bad', extra: 1 }),
    { required: true, present_any: ['x'], forbidden: [], numeric: [{ metric: 'payment_terms_days', min: null, max: 30, required: false }], severity: null });
  assert.deepEqual(normalizeRules('garbage'), { required: false, present_any: [], forbidden: [], numeric: [], severity: null });
});

test('severity: a clause override wins, and duplicates are reported once', () => {
  const strict: PlaybookClause = { ...payment, rules: { ...payment.rules, severity: 'critical' } };
  const text = 'Pay within 90 days. Pay within 90 days of invoice.';
  const findings = runPlaybook(text, [strict]);
  assert.ok(findings.every((f) => f.severity === 'critical'));
  assert.equal(findings.filter((f) => f.kind === 'numeric_out_of_range').length, 2, 'two different sentences, one finding each');
  assert.deepEqual(findings.map((f) => f.id), ['f1', 'f2', 'f3']);
  const twice = runPlaybook('Pay within 90 days.\n\nPay within 90 days.', [{ ...strict, rules: { ...strict.rules, required: false } }]);
  assert.equal(twice.length, 1, 'the same sentence is reported once');
});

test('starter titles give detection phrases and every starter clause validates', () => {
  assert.deepEqual(phrasesFromTitle('Regulator audit & inspection rights'), ['regulator audit', 'inspection rights']);
  assert.deepEqual(phrasesFromTitle('Uptime SLA & service credits'), ['uptime sla', 'service credits']);
  for (const clause of BASELINE_STARTER_CLAUSES) assert.deepEqual(validateRules(clause.rules), [], clause.title);
  // The approved wording of every baseline clause satisfies its own rules (no finding against the playbook's own text).
  for (const clause of BASELINE_STARTER_CLAUSES) {
    const library = BASELINE_STARTER_CLAUSES.map((c) => ({ id: c.starter_key, title: c.title, category: c.category, risk_level: c.risk_level, approved_text: c.approved_text, fallback_texts: c.fallback_texts, guidance: c.guidance, rules: c.rules }));
    const own = library.find((c) => c.id === clause.starter_key)!;
    assert.deepEqual(runPlaybook(clause.approved_text, [own]).filter((f) => f.kind !== 'missing_required' || own.rules.present_any.length === 0), [], `${clause.title}: approved text passes its own rules`);
    for (const fallback of clause.fallback_texts) assert.deepEqual(runPlaybook(fallback, [own]), [], `${clause.title}: fallback passes its own rules`);
  }
});

test('policy-pack clauses become required clauses detected by their title, without duplicating the baseline', () => {
  const pack = [
    { clause: { en: 'Limitation of liability', id: 'Batasan tanggung jawab' }, rule: { en: 'Flag if uncapped.' } },
    { clause: { en: 'Regulator audit & inspection rights', id: 'Hak audit regulator' }, rule: { en: 'Flag if the regulator cannot audit.' } },
    { clause: { en: 'Regulator audit & inspection rights' }, rule: { en: 'duplicate' } },
  ];
  const starters = packStarterClauses('financial-services', pack);
  assert.deepEqual(starters.map((s) => s.starter_key), ['pack.financial-services.regulator-audit-and-inspection-rights']);
  const [audit] = starters;
  assert.equal(audit.guidance, 'Flag if the regulator cannot audit.');
  assert.equal(audit.rules.required, true);
  assert.deepEqual(validateRules(audit.rules), []);
  const clause: PlaybookClause = { id: audit.starter_key, title: audit.title, category: audit.category, risk_level: audit.risk_level, approved_text: '', fallback_texts: [], guidance: audit.guidance, rules: audit.rules };
  assert.equal(runPlaybook('The regulator has inspection rights at all times.', [clause]).length, 0);
  const [missing] = runPlaybook('Nothing on this topic.', [clause]);
  assert.equal(missing.kind, 'missing_required');
  assert.equal(missing.suggested_text, null, 'a pack clause has no approved wording until the organization writes it');
});
