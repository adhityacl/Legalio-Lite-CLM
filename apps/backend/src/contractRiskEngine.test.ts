import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adjustedSeverity, bandOf, compositeScore, MAX_CONTRACT_FINDINGS, normalizePillar, normalizeStance, pillarScore, scoreContractRisk } from './contractRiskEngine';
import { riskProfileFor } from './contractRiskMatrix';

const AFFILIATE = riskProfileFor('p2p_lending', ['Distribution / Channel Partner']).weights;
const finding = (pillar: string, severityScore: number, stance = 'ADVERSE', clauseTitle = `${pillar}-${severityScore}`) => ({ pillar, severityScore, stance, clauseTitle });

test('the reference’s corrected sample: pillars 70 / 60 / 65 / 55 / 60 on the affiliate weights give 63.5 → 64 HIGH', () => {
  const score = compositeScore({ P1: 70, P2: 60, P3: 65, P4: 55, P5: 60 }, AFFILIATE, 60);
  assert.equal(score, 64);
  assert.equal(bandOf(score), 'HIGH');
});

test('calibration: the Home Credit findings, scored with the rubric, land in HIGH around the reference’s 64', () => {
  const result = scoreContractRisk({ analyzedClauses: [
    finding('P1', 55), finding('P1', 35),   // commission formula without time unit; late penalty without unit or cap
    finding('P2', 35), finding('P2', 35),   // no liability cap; duty to follow every instruction of the other party
    finding('P3', 55), finding('P3', 20),   // access to "all records"; no breach-notice deadline
    finding('P4', 35, 'NEUTRAL'), finding('P4', 35), // contradictory termination; assignment for the partner only
    finding('P5', 50, 'NEUTRAL'), finding('P5', 10, 'NEUTRAL'), // word missing in the prevailing language; typos
  ] }, AFFILIATE);
  assert.ok(result.overallRiskScore >= 58 && result.overallRiskScore <= 68, `got ${result.overallRiskScore}`);
  assert.equal(result.riskLevel, 'HIGH');
});

test('calibration: one serious flaw in an otherwise clean contract is MODERATE, not averaged down to LOW', () => {
  const result = scoreContractRisk({ analyzedClauses: [finding('P1', 55)] }, AFFILIATE);
  assert.equal(result.riskLevel, 'MEDIUM');
});

test('calibration: a breach of mandatory regulation is CRITICAL even when it is the only finding', () => {
  const result = scoreContractRisk({ analyzedClauses: [finding('P3', 80)] }, AFFILIATE);
  assert.ok(result.overallRiskScore >= 71);
  assert.equal(result.riskLevel, 'CRITICAL');
});

test('calibration: a few drafting slips and minor gaps stay LOW; a clean contract scores 0', () => {
  assert.equal(scoreContractRisk({ analyzedClauses: [finding('P5', 10, 'NEUTRAL'), finding('P4', 20, 'NEUTRAL'), finding('P1', 15, 'NEUTRAL')] }, AFFILIATE).riskLevel, 'LOW');
  assert.equal(scoreContractRisk({ analyzedClauses: [] }, AFFILIATE).overallRiskScore, 0);
});

test('a one-sided term that favours us counts for a fifth of an adverse one', () => {
  assert.equal(adjustedSeverity(40, 'ADVERSE'), 44);
  assert.equal(adjustedSeverity(40, 'NEUTRAL'), 40);
  assert.equal(adjustedSeverity(40, 'FAVORABLE'), 8);
  assert.equal(adjustedSeverity(95, 'ADVERSE'), 100, 'capped at 100');
});

test('within a pillar the worst finding counts fully and each next one 0.35× the previous share', () => {
  assert.equal(pillarScore([]), 0);
  assert.equal(pillarScore([40, 60]), 60 + 40 * 0.35);
  assert.equal(Math.round(pillarScore([60, 40, 20]) * 100) / 100, Math.round((60 + 14 + 20 * 0.35 ** 2) * 100) / 100);
  assert.equal(pillarScore([90, 90, 90]), 100);
});

test('findings are normalized, banded, sorted worst first and capped; the breakdown and the model score are kept', () => {
  const many = Array.from({ length: 12 }, (_, i) => finding('Financial', 10 + i, 'adverse'));
  const result = scoreContractRisk({ overallRiskScore: 82, analyzedClauses: [...many, null] }, AFFILIATE);
  assert.equal(result.analyzedClauses.length, MAX_CONTRACT_FINDINGS);
  assert.equal(result.analyzedClauses[0].severityScore, 21);
  assert.ok(result.analyzedClauses.every((c: any) => c.pillar === 'P1' && c.stance === 'ADVERSE'));
  assert.equal(result.aiRiskScore, 82);
  assert.deepEqual(result.pillarBreakdown.map((p: any) => p.pillar), ['P1', 'P2', 'P3', 'P4', 'P5']);
  assert.equal(result.pillarBreakdown.reduce((n: number, p: any) => n + p.findings, 0), MAX_CONTRACT_FINDINGS);
});

test('pillar and stance names the models write map onto the codes', () => {
  assert.equal(normalizePillar('FINANCIAL'), 'P1');
  assert.equal(normalizePillar('liability_ip'), 'P2');
  assert.equal(normalizePillar('regulatory_data_audit'), 'P3');
  assert.equal(normalizePillar('OPERATIONAL'), 'P4');
  assert.equal(normalizePillar('editorial_metadata_sync'), 'P5');
  assert.equal(normalizePillar('p3'), 'P3');
  assert.equal(normalizeStance('favourable'), 'FAVORABLE');
  assert.equal(normalizeStance('neutral'), 'NEUTRAL');
  assert.equal(normalizeStance(undefined), 'ADVERSE');
});

test('weights: P2P picks the playbook from the partnership category; other packs use their base weights; unknown is general', () => {
  assert.equal(riskProfileFor('p2p_lending', ['Collection Agency']).playbook?.key, 'collection_agency');
  assert.equal(riskProfileFor('p2p_lending', ['marketing affiliate']).playbook?.key, 'marketing_affiliate_referral_in_app_offering');
  assert.equal(riskProfileFor('p2p_lending', ['Advertising']).playbook, null);
  assert.equal(riskProfileFor('b2b_saas', ['Reseller']).weights.P2, 0.30);
  assert.equal(riskProfileFor('nope', []).weights.P5, 0.15);
  for (const key of ['p2p_lending', 'b2b_saas', 'general', 'oil_gas']) {
    const { weights } = riskProfileFor(key, []);
    assert.equal(Math.round(Object.values(weights).reduce((a, b) => a + b, 0) * 100) / 100, 1, key);
  }
});
