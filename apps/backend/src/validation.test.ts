import assert from 'node:assert/strict';
import { test } from 'node:test';
import type express from 'express';
import { validateBody } from './validation';
import { sendApiError, sendRouteError, PublicError } from './apiErrors';
import * as schemas from './schemas';

function run(handler: express.RequestHandler, body: unknown) {
  const req = { body, requestId: 'req-1234567890', method: 'PUT', path: '/x' } as unknown as express.Request;
  const out: { status?: number; json?: any; nextCalled: boolean } = { nextCalled: false };
  const res = { status(code: number) { out.status = code; return this; }, json(value: unknown) { out.json = value; return this; } } as unknown as express.Response;
  handler(req, res, () => { out.nextCalled = true; });
  return { req, out };
}

test('contract update keeps only the fields the form sends; ids, ownership, timestamps and derived data are dropped', () => {
  const { req, out } = run(validateBody(schemas.contractUpdateBody), {
    contract_id: 'C9999', organizationId: 'org-b', created_by: 'attacker', created_at: '2000-01-01', updated_at: 'x', days_remaining: 5,
    status_approval: 'Signed', termination_document: { url: '/uploads/other' }, userEmail: 'a@b.c', userName: 'n', userRole: 'Admin',
    contract_title: 'New title', contract_value: '12.5', auto_renewal: true, cooperation_categories: ['A'], termination_date: null,
  });
  assert.equal(out.nextCalled, true);
  assert.deepEqual(req.body, { contract_title: 'New title', contract_value: '12.5', auto_renewal: true, cooperation_categories: ['A'], termination_date: null });
});

test('every update schema rejects nothing for an empty body and drops identity fields', () => {
  for (const schema of [schemas.partnerUpdateBody, schemas.contractUpdateBody, schemas.ioUpdateBody, schemas.spendingUpdateBody, schemas.evaluationUpdateBody]) {
    const { req, out } = run(validateBody(schema), { id: 'X', io_id_x: 1, partner_id_x: 1, organizationId: 'o', created_at: 'c', evaluator_email: 'e@x', userEmail: 'u' });
    assert.equal(out.nextCalled, true);
    assert.deepEqual(req.body, {});
  }
});

test('spending update cannot set file urls, ids or the owner', () => {
  const { req } = run(validateBody(schemas.spendingUpdateBody), {
    id: 'SP0001', organizationId: 'o', invoice_file_url: '/uploads/x', billing_file_url: '/uploads/y', folder_link: 'z', invoice_title: 'T',
  });
  assert.deepEqual(req.body, { invoice_title: 'T' });
});

test('missing required fields answer with the route sentence; other problems say which field is wrong', () => {
  const missing = run(validateBody(schemas.contractCreateBody, { requiredMessage: 'fill everything' }), { contract_number: ' ' });
  assert.equal(missing.out.status, 400);
  assert.equal(missing.out.json.message, 'fill everything');
  assert.equal(missing.out.json.code, 'VALIDATION_FAILED');
  assert.equal(missing.out.json.status, 400);
  assert.equal(missing.out.json.requestId, 'req-1234567890');
  assert.ok(Array.isArray(missing.out.json.issues));
  const wrong = run(validateBody(schemas.contractCreateBody, { requiredMessage: 'fill everything' }), {
    contract_number: 'N', contract_title: 'T', partner_id: 'P', start_date: 'tomorrow', end_date: '2026-01-02',
  });
  assert.equal(wrong.out.status, 400);
  assert.match(wrong.out.json.message, /start_date/);
});

test('type confusion is rejected', () => {
  assert.equal(run(validateBody(schemas.partnerCreateBody), { partner_name: { $ne: 1 } }).out.status, 400);
  assert.equal(run(validateBody(schemas.partnerCreateBody), []).out.status, 400);
  assert.equal(run(validateBody(schemas.contractUpdateBody), { contract_value: { a: 1 } }).out.status, 400);
  assert.equal(run(validateBody(schemas.contractUpdateBody), { auto_renewal: 'yes' }).out.status, 400);
});

test('unified error bodies carry error, code, message, status and requestId; unexpected errors are not echoed', () => {
  const req = { requestId: 'req-abcdefghij', method: 'POST', path: '/api/x' } as unknown as express.Request;
  const sent: any[] = [];
  const res = { status(code: number) { sent.push(code); return this; }, json(value: unknown) { sent.push(value); return this; } } as unknown as express.Response;
  sendApiError(req, res, 404, 'NOT_FOUND', 'Nope.');
  assert.deepEqual(sent[1], { error: 'Nope.', code: 'NOT_FOUND', message: 'Nope.', status: 404, requestId: 'req-abcdefghij' });
  sent.length = 0;
  sendRouteError(req, res, new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'), 'test', 'Something failed.');
  assert.equal(sent[0], 500);
  assert.equal(sent[1].message, 'Something failed.');
  assert.equal(sent[1].code, 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(sent[1]).includes('hunter2'));
  sent.length = 0;
  sendRouteError(req, res, new PublicError('Quota exceeded.', 500, 'AI_PROVIDER_ERROR'), 'test', 'fallback');
  assert.equal(sent[1].message, 'Quota exceeded.');
  assert.equal(sent[1].code, 'AI_PROVIDER_ERROR');
});
