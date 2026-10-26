import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeSeverity, riskLevelOf, scoreOf, scoreReview } from './reviewScoring';

test('severities the models actually return map onto the four known ones', () => {
  assert.equal(normalizeSeverity('critical'), 'CRITICAL');
  assert.equal(normalizeSeverity(' High '), 'HIGH');
  assert.equal(normalizeSeverity('MODERATE'), 'MEDIUM');
  assert.equal(normalizeSeverity('Severe'), 'HIGH');
  assert.equal(normalizeSeverity('minor'), 'LOW');
  assert.equal(normalizeSeverity(undefined), 'MEDIUM');
});

test('score is the sum of severity points, capped at 100, with the documented bands', () => {
  assert.equal(scoreOf([]), 0);
  assert.equal(scoreOf(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']), 49);
  assert.equal(scoreOf(Array(5).fill('CRITICAL')), 100);
  assert.deepEqual([0, 25, 26, 55, 56, 75, 76, 100].map(riskLevelOf), ['LOW', 'LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'HIGH', 'CRITICAL', 'CRITICAL']);
});

test('scoreReview replaces the model score and level, and normalizes clauses, checklist and skipped rules', () => {
  const result = scoreReview({
    overallRiskScore: 82,
    riskLevel: 'MODERATE',
    analyzedClauses: [{ clauseTitle: 'a', severity: 'HIGH' }, { clauseTitle: 'b', severity: 'moderate' }, null],
    complianceChecklist: [{ item: 'x', status: 'non compliant' }, { item: 'y', status: 'unclear' }],
    notApplicableRules: [{ rule: 'Escrow segregation', reason: 'No funds are held.' }, { rule: '' }, 'junk'],
  });
  assert.equal(result.overallRiskScore, 22);
  assert.equal(result.riskLevel, 'LOW');
  assert.equal(result.aiRiskScore, 82);
  assert.deepEqual(result.analyzedClauses.map((c: any) => c.severity), ['HIGH', 'MEDIUM']);
  assert.deepEqual(result.complianceChecklist.map((c: any) => c.status), ['NON_COMPLIANT', 'NEEDS_REVIEW']);
  assert.deepEqual(result.notApplicableRules, [{ rule: 'Escrow segregation', reason: 'No funds are held.' }]);
});

test('only the first six findings are kept and scored, so a long answer cannot inflate the score', () => {
  const result = scoreReview({ analyzedClauses: Array.from({ length: 9 }, (_, i) => ({ clauseTitle: `c${i}`, severity: 'HIGH' })) });
  assert.equal(result.analyzedClauses.length, 6);
  assert.deepEqual(result.analyzedClauses.map((c: any) => c.clauseTitle), ['c0', 'c1', 'c2', 'c3', 'c4', 'c5']);
  assert.equal(result.overallRiskScore, 90);
});

test('a review without clauses scores 0 and keeps no model score when there was none', () => {
  const result = scoreReview({ executiveSummary: 'fine' });
  assert.equal(result.overallRiskScore, 0);
  assert.equal(result.riskLevel, 'LOW');
  assert.equal(result.aiRiskScore, null);
  assert.deepEqual(result.notApplicableRules, []);
});
