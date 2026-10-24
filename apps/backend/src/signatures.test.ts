import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { SIGNATURE_STATUSES, approvalStatusAfterSignature, canTransition, currentSigners, isFinal, mayNowSign, statusAfterSigning } from './signatureStates';
import type { SignatureError } from './signatures';
import { bootApp, ORIGIN, type Harness } from './testHarness';

let h: Harness;
const ids: Record<string, string> = {};
const orgOf = (user: string) => (user.endsWith('B') ? 'org-b' : 'org-a');
const api = (user: string, method: string, route: string, init: { body?: unknown; org?: string } = {}) => h.api(user, method, route, { org: orgOf(user), ...init });
const pdf = (text = 'signed') => `data:application/pdf;base64,${Buffer.from(`%PDF-1.7\n${text}\n%%EOF`).toString('base64')}`;
const MAX = 4096;

/* ------------------------------ pure rules ------------------------------ */

test('state machine: exactly the documented transitions are allowed, and final states stay final', () => {
  const allowed: Record<string, string[]> = {
    draft: ['sent', 'cancelled'],
    sent: ['partially_signed', 'completed', 'declined', 'expired', 'cancelled'],
    partially_signed: ['partially_signed', 'completed', 'declined', 'expired', 'cancelled'],
    completed: [], declined: [], expired: [], cancelled: [],
  };
  for (const from of SIGNATURE_STATUSES) for (const to of SIGNATURE_STATUSES) {
    assert.equal(canTransition(from, to), allowed[from].includes(to), `${from} -> ${to}`);
  }
  for (const status of ['completed', 'declined', 'expired', 'cancelled'] as const) assert.equal(isFinal(status), true, status);
  assert.equal(isFinal('sent'), false);
  assert.equal(canTransition('draft', 'expired'), false, 'a draft never expires');
});

test('signing order: sequential waits for earlier signers, equal orders sign in any sequence, parallel has no order', () => {
  const signers = [{ id: 'a', signing_order: 1, status: 'pending' as const }, { id: 'b', signing_order: 2, status: 'pending' as const }, { id: 'c', signing_order: 2, status: 'pending' as const }];
  assert.deepEqual(currentSigners('sequential', signers).map((s) => s.id), ['a']);
  const afterA = signers.map((s) => (s.id === 'a' ? { ...s, status: 'signed' as const } : s));
  assert.deepEqual(currentSigners('sequential', afterA).map((s) => s.id), ['b', 'c']);
  assert.equal(mayNowSign('sequential', signers[1], signers), false);
  assert.equal(mayNowSign('parallel', signers[1], signers), true);
  assert.equal(mayNowSign('parallel', afterA[0], afterA), false, 'a signer who signed cannot sign again');
  assert.equal(statusAfterSigning(afterA), 'partially_signed');
  assert.equal(statusAfterSigning(afterA.map((s) => ({ ...s, status: 'signed' as const }))), 'completed');
  assert.equal(statusAfterSigning([]), 'partially_signed');
});

test('contract approval status after a completed signature', () => {
  const today = '2026-10-24';
  assert.equal(approvalStatusAfterSignature({ status_approval: 'Draft', start_date: '2027-01-01' }, today), 'Signed');
  assert.equal(approvalStatusAfterSignature({ status_approval: 'Review', start_date: '2027-01-01' }, today), 'Signed');
  assert.equal(approvalStatusAfterSignature({ status_approval: 'Draft', start_date: '2026-01-01' }, today), 'Active', 'the term has begun');
  assert.equal(approvalStatusAfterSignature({ status_approval: 'Signed', start_date: '2026-01-01' }, today), 'Active');
  assert.equal(approvalStatusAfterSignature({ status_approval: 'Signed', start_date: '2027-01-01' }, today), null, 'already Signed, not begun');
  assert.equal(approvalStatusAfterSignature({ status_approval: 'Active', start_date: '2026-01-01' }, today), null);
  assert.equal(approvalStatusAfterSignature({ status_approval: 'Draft', start_date: '2026-01-01', lifecycle_mode: 'terminated' }, today), null, 'a terminated contract is not revived');
  assert.equal(approvalStatusAfterSignature({ status_approval: 'Weird', start_date: '2026-01-01' }, today), null);
});

test('files: magic bytes decide the type, size is checked before decoding, a signed copy must be a PDF', async () => {
  // Application modules are imported inside the tests: the harness sets the test environment before the application loads.
  const { detectFileType, parseFileInput } = await import('./signatures');
  const previous = process.env.SIGNATURE_MAX_FILE_BYTES;
  process.env.SIGNATURE_MAX_FILE_BYTES = String(MAX);
  assert.equal(detectFileType(Buffer.from('%PDF-1.4'))?.contentType, 'application/pdf');
  assert.equal(detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.extension, 'png');
  assert.equal(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.extension, 'jpg');
  assert.equal(detectFileType(Buffer.from('<html>')), null);
  assert.equal(parseFileInput(pdf(), 'signed').extension, 'pdf');
  const code = (fn: () => unknown) => { try { fn(); } catch (err) { return (err as SignatureError).code; } return 'none'; };
  assert.equal(code(() => parseFileInput(Buffer.from('MZ not a pdf').toString('base64'), 'signed')), 'INVALID_FILE');
  assert.equal(code(() => parseFileInput(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]).toString('base64'), 'signed')), 'INVALID_FILE', 'a JPEG is not an acceptable signed copy');
  assert.equal(code(() => parseFileInput(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]).toString('base64'), 'evidence')), 'none', 'but is acceptable evidence');
  assert.equal(code(() => parseFileInput(Buffer.alloc(MAX + 1, 0x25).toString('base64'), 'evidence')), 'FILE_TOO_LARGE');
  assert.equal(code(() => parseFileInput('!!!not base64!!!', 'evidence')), 'INVALID_FILE');
  assert.equal(code(() => parseFileInput('', 'signed')), 'INVALID_FILE');
  assert.equal(code(() => parseFileInput(undefined, 'signed')), 'INVALID_FILE');
  if (previous === undefined) delete process.env.SIGNATURE_MAX_FILE_BYTES; else process.env.SIGNATURE_MAX_FILE_BYTES = previous;
});

/* ------------------------------ application ------------------------------ */

before(async () => {
  h = await bootApp({
    tag: 'signatures', env: { SIGNATURE_MAX_FILE_BYTES: String(MAX) }, orgs: [{ id: 'org-a', name: 'Org A' }, { id: 'org-b', name: 'Org B' }],
    users: [['adminA', 'org-a', 'admin'], ['legalA', 'org-a', 'editor', 'Legal'], ['financeA', 'org-a', 'editor', 'Finance'], ['viewerA', 'org-a', 'viewer', 'Legal'], ['adminB', 'org-b', 'admin']],
  });
  const make = async (key: string, user: string, dept: string, start: string, end: string) => {
    const partner = await api(user, 'POST', '/api/partners', { body: { partner_name: `Partner ${key}`, internal_pic: dept, country: 'ID' } });
    assert.ok([200, 201].includes(partner.status), partner.raw);
    const contract = await api(user, 'POST', '/api/contracts', { body: { partner_id: partner.body.partner.partner_id, contract_number: `SIG-${key}`, contract_title: `Contract ${key}`, start_date: start, end_date: end, currency: 'USD', contract_value: 10, status_approval: 'Review' } });
    assert.ok([200, 201].includes(contract.status), contract.raw);
    ids[key] = contract.body.contract.contract_id;
  };
  await make('started', 'adminA', 'Legal', '2026-01-01', '2099-12-31');
  await make('future', 'adminA', 'Legal', '2098-01-01', '2099-12-31');
  for (const key of ['declined', 'cancel', 'expire', 'hook', 'extra', 'cross']) await make(key, 'adminA', 'Legal', '2098-01-01', '2099-12-31');
  await make('finance', 'adminA', 'Finance', '2098-01-01', '2099-12-31');
  await make('b', 'adminB', 'Legal', '2098-01-01', '2099-12-31');
  // An outbound webhook endpoint that hears every event (delivery itself is not exercised here: the rows queued for it are).
  const hook = await api('adminA', 'POST', '/api/organizations/org-a/webhooks', { body: { url: 'https://hooks.example.com/in', eventTypes: [] } });
  assert.equal(hook.status, 201, hook.raw);
});
after(() => h?.close());

const signers = (n = 2) => Array.from({ length: n }, (_, i) => ({ name: `Signer ${i + 1}`, email: `signer${i + 1}@counterparty.test` }));
const create = (user: string, contractKey: string, extra: Record<string, unknown> = {}) => api(user, 'POST', '/api/signatures', { body: { contract_id: ids[contractKey], signers: signers(), ...extra } });
const contractOf = async (key: string, user = 'adminA') => (await api(user, 'GET', `/api/contracts?q=${encodeURIComponent(`SIG-${key}`)}`)).body.find((c: any) => c.contract_id === ids[key]);
const events = async (id: string) => (await h.sql.all<{ type: string; actor: string }>(`SELECT type, actor FROM signature_events WHERE request_id = ? ORDER BY created_at, id`, id)).map((e) => e.type);

test('permissions and validation when creating a request', async () => {
  assert.equal((await create('viewerA', 'started')).status, 403, 'a viewer cannot request signatures');
  assert.equal((await create('financeA', 'started')).status, 404, 'another department cannot see the contract');
  assert.equal((await create('adminB', 'started')).status, 404, 'another organization cannot see the contract');
  assert.equal((await api('adminA', 'POST', '/api/signatures', { body: { contract_id: 'C-none', signers: signers() } })).status, 404);
  const bad = async (body: Record<string, unknown>, label: string) => assert.equal((await create('adminA', 'declined', body)).status, 400, label);
  await bad({ signers: [] }, 'no signers');
  await bad({ signers: [{ name: 'A', email: 'not-an-email' }] }, 'bad e-mail');
  await bad({ signers: [{ name: '', email: 'a@b.test' }] }, 'no name');
  await bad({ signers: [{ name: 'A', email: 'a@b.test' }, { name: 'B', email: 'A@B.test' }] }, 'duplicate e-mail');
  await bad({ mode: 'diagonal' }, 'unknown mode');
  await bad({ provider: 'docusign' }, 'unknown provider');
  await bad({ expiresAt: '2001-01-01T00:00:00Z' }, 'expiry in the past');
  await bad({ expiresInDays: 4000 }, 'expiry too far');
  await bad({ signers: Array.from({ length: 21 }, (_, i) => ({ name: `S${i}`, email: `s${i}@x.test` })) }, 'too many signers');
  await bad({ documentId: 'doc-that-does-not-exist' }, 'unknown document');
});

test('lifecycle by hand: create, send, resend, sequential order, completion updates the contract', async () => {
  const created = await create('legalA', 'started', { title: 'Master agreement', message: 'Please sign', signers: [{ name: 'First', email: 'First@Counterparty.test', order: 1 }, { name: 'Second', email: 'second@counterparty.test', order: 2 }] });
  assert.equal(created.status, 201, created.raw);
  const request = created.body.request;
  ids.r1 = request.id;
  assert.equal(request.status, 'draft');
  assert.equal(request.mode, 'sequential');
  assert.equal(request.signers[0].email, 'first@counterparty.test');
  assert.deepEqual(request.signers.map((s: any) => s.canSignNow), [false, false], 'a draft cannot be signed yet');
  assert.equal((await create('legalA', 'started')).status, 409, 'one open request per contract');
  assert.equal((await create('legalA', 'started')).body.code, 'OPEN_REQUEST_EXISTS');
  assert.equal((await api('legalA', 'POST', `/api/signatures/${request.id}/signers/${request.signers[0].id}/signed`)).status, 409, 'cannot sign a draft');

  const sent = await api('legalA', 'POST', `/api/signatures/${request.id}/send`);
  assert.equal(sent.status, 200, sent.raw);
  assert.equal(sent.body.request.status, 'sent');
  assert.deepEqual(sent.body.request.signers.map((s: any) => s.canSignNow), [true, false]);
  assert.equal((await api('legalA', 'POST', `/api/signatures/${request.id}/send`)).status, 409, 'sending twice');
  assert.equal((await api('legalA', 'POST', `/api/signatures/${request.id}/resend`)).status, 200);
  assert.equal((await api('legalA', 'POST', `/api/signatures/${request.id}/resend`)).status, 429, 'reminders are spaced');

  const [first, second] = sent.body.request.signers;
  const early = await api('legalA', 'POST', `/api/signatures/${request.id}/signers/${second.id}/signed`);
  assert.equal(early.status, 409);
  assert.equal(early.body.code, 'NOT_THEIR_TURN');
  const one = await api('legalA', 'POST', `/api/signatures/${request.id}/signers/${first.id}/signed`);
  assert.equal(one.status, 200, one.raw);
  assert.equal(one.body.request.status, 'partially_signed');
  assert.equal((await api('legalA', 'POST', `/api/signatures/${request.id}/signers/${first.id}/signed`)).body.duplicate, true, 'recording the same signature twice is a no-op');
  assert.equal((await contractOf('started')).status_approval, 'Review', 'not signed by everybody yet');

  const done = await api('legalA', 'POST', `/api/signatures/${request.id}/signers/${second.id}/signed`);
  assert.equal(done.body.request.status, 'completed');
  assert.ok(done.body.request.completedAt);
  const contract = await contractOf('started');
  assert.equal(contract.status_approval, 'Active', 'the term already began');
  assert.equal(contract.signature_request_id, request.id);
  assert.ok(contract.signed_at);
  assert.equal(contract.contract_number, 'SIG-started', 'nothing else changed');
  assert.equal(contract.version, 2, 'the contract version moved once');
  assert.deepEqual(await events(request.id), ['created', 'sent', 'resent', 'signer_signed', 'progress', 'signer_signed', 'completed']);
  // Final means final.
  for (const action of ['send', 'resend', 'cancel']) assert.equal((await api('legalA', 'POST', `/api/signatures/${request.id}/${action}`)).status, 409, action);
  assert.equal((await api('legalA', 'POST', `/api/signatures/${request.id}/signers/${first.id}/declined`)).status, 409);
  // A completed request can be followed by a new one.
  assert.equal((await create('legalA', 'started')).status, 201);
});

test('timeline: the persisted audit trail is returned with the request and survives reloads', async () => {
  const detail = await api('legalA', 'GET', `/api/signatures/${ids.r1}`);
  assert.equal(detail.status, 200);
  const types = detail.body.request.events.map((e: any) => e.type);
  assert.deepEqual(types, ['created', 'sent', 'resent', 'signer_signed', 'progress', 'signer_signed', 'completed']);
  assert.ok(detail.body.request.events.every((e: any) => e.actor === 'user:legalA' && e.createdAt));
  const list = await api('legalA', 'GET', `/api/signatures?contract_id=${ids.started}`);
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('x-total-count'), '2');
  assert.equal((await api('legalA', 'GET', `/api/signatures?contract_id=${ids.started}&status=completed`)).body.length, 1);
});

test('manual "mark as signed" with an uploaded copy: validates the file, completes, stores the link on the contract and serves it', async () => {
  const created = (await create('adminA', 'future', { mode: 'parallel', send: true })).body.request;
  assert.equal(created.status, 'sent');
  assert.deepEqual(created.signers.map((s: any) => s.canSignNow), [true, true], 'parallel: everybody may sign');
  const complete = (body: Record<string, unknown>) => api('adminA', 'POST', `/api/signatures/${created.id}/complete`, { body });
  assert.equal((await complete({})).status, 422, 'the signed copy is required');
  assert.equal((await complete({ fileName: 'x.pdf', fileData: `data:application/pdf;base64,${Buffer.from('MZ\u0090 not a pdf').toString('base64')}` })).body.code, 'INVALID_FILE');
  assert.equal((await complete({ fileName: 'x.pdf', fileData: `data:application/pdf;base64,${Buffer.from(`%PDF-1.7${' '.repeat(MAX)}`).toString('base64')}` })).status, 413);
  assert.equal((await api('adminA', 'GET', `/api/signatures/${created.id}`)).body.request.status, 'sent', 'rejected uploads change nothing');
  assert.equal((await complete({ fileName: 'x.pdf', fileData: pdf(), evidence: [{ fileName: 'e.txt', fileData: Buffer.from('plain text').toString('base64') }] })).status, 422, 'evidence is validated too');
  const done = await complete({ fileName: 'Signed ../../etc/passwd.pdf', fileData: pdf('final copy'), evidence: [{ fileName: 'audit.png', fileData: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]).toString('base64') }] });
  assert.equal(done.status, 200, done.raw);
  assert.equal(done.body.request.status, 'completed');
  assert.ok(done.body.request.signers.every((s: any) => s.status === 'signed'));
  assert.equal(done.body.request.files.length, 2);
  assert.ok(!done.body.request.signedFile.fileName.includes('/') && done.body.request.signedFile.fileName.endsWith('.pdf'));
  assert.equal(done.body.request.signedFile.sizeBytes, Buffer.from(`%PDF-1.7\nfinal copy\n%%EOF`).length);
  const contract = await contractOf('future');
  assert.equal(contract.status_approval, 'Signed', 'the term has not begun');
  assert.match(contract.signed_file_link, /^\/uploads\/org-a\//);
  // The ownership of the stored object is registered, and the link serves the PDF to people who can see the contract.
  const key = decodeURIComponent(contract.signed_file_link.slice('/uploads/'.length));
  assert.equal((await h.sql.get<any>(`SELECT organization_id FROM upload_owners WHERE storage_key = ?`, key))?.organization_id, 'org-a');
  const served = await fetch(h.base + contract.signed_file_link, { headers: { authorization: `Bearer ${h.tokens.adminA}`, origin: ORIGIN } });
  assert.equal(served.status, 200);
  assert.equal(await served.text(), `%PDF-1.7\nfinal copy\n%%EOF`);
  assert.equal((await fetch(h.base + contract.signed_file_link, { headers: { authorization: `Bearer ${h.tokens.adminB}`, origin: ORIGIN } })).status, 404, 'another organization cannot open it');
  assert.equal((await fetch(h.base + contract.signed_file_link, { headers: { authorization: `Bearer ${h.tokens.financeA}`, origin: ORIGIN } })).status, 404, 'nor another department');
  // Evidence is downloaded through the request, as an attachment, by people who can see the contract.
  const evidence = done.body.request.files.find((f: any) => f.kind === 'evidence');
  const download = await fetch(h.base + evidence.downloadUrl, { headers: { authorization: `Bearer ${h.tokens.legalA}`, origin: ORIGIN, 'x-organization-id': 'org-a' } });
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition') ?? '', /attachment/);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(h.base + evidence.downloadUrl, { headers: { authorization: `Bearer ${h.tokens.financeA}`, origin: ORIGIN, 'x-organization-id': 'org-a' } })).status, 404);
  assert.equal((await fetch(h.base + evidence.downloadUrl, { headers: { authorization: `Bearer ${h.tokens.adminB}`, origin: ORIGIN, 'x-organization-id': 'org-b' } })).status, 404);
});

test('decline, cancel and expiry close a request without touching the contract; webhooks and notices are queued', async () => {
  const before = await contractOf('declined');
  const created = (await create('adminA', 'declined', { send: true })).body.request;
  const declined = await api('adminA', 'POST', `/api/signatures/${created.id}/signers/${created.signers[0].id}/declined`, { body: { reason: 'Terms not acceptable' } });
  assert.equal(declined.body.request.status, 'declined');
  assert.equal(declined.body.request.signers[0].declineReason, 'Terms not acceptable');
  const after = await contractOf('declined');
  assert.equal(after.status_approval, before.status_approval);
  assert.equal(after.version, before.version, 'the contract is untouched');
  assert.equal((await api('adminA', 'POST', `/api/signatures/${created.id}/send`)).status, 409);

  const draft = (await create('adminA', 'cancel')).body.request;
  const cancelled = await api('adminA', 'POST', `/api/signatures/${draft.id}/cancel`, { body: { reason: 'wrong counterparty' } });
  assert.equal(cancelled.body.request.status, 'cancelled');
  assert.equal(cancelled.body.request.closedReason, 'wrong counterparty');
  assert.equal((await api('adminA', 'POST', `/api/signatures/${draft.id}/cancel`)).status, 409);

  const open = (await create('adminA', 'expire', { send: true })).body.request;
  // Not yet due: the pass leaves it alone.
  const { expireDueRequests } = await import('./signatures');
  assert.equal(await expireDueRequests(h.sql), 0);
  await h.sql.run(`UPDATE signature_requests SET expires_at = ? WHERE id = ?`, new Date(Date.now() - 1000).toISOString(), open.id);
  const passes = await Promise.all([expireDueRequests(h.sql), expireDueRequests(h.sql), expireDueRequests(h.sql)]);
  assert.equal(passes.reduce((a, b) => a + b, 0), 1, 'exactly one pass claims the request');
  assert.equal(await expireDueRequests(h.sql), 0, 'idempotent');
  assert.equal((await api('adminA', 'GET', `/api/signatures/${open.id}`)).body.request.status, 'expired');
  assert.equal((await api('adminA', 'POST', `/api/signatures/${open.id}/signers/${open.signers[0].id}/signed`)).status, 409, 'an expired request cannot be signed');
  assert.equal((await contractOf('expire')).status_approval, 'Review');
  // The pass also runs under the scheduler's advisory lock.
  const { runSignaturePass } = await import('./backgroundJobs');
  const locked = await runSignaturePass();
  assert.equal(locked.ran, true);

  const deliveries = await h.sql.all<{ event_type: string; payload: string }>(`SELECT event_type, payload FROM webhook_deliveries WHERE organization_id = 'org-a' AND event_type LIKE 'signature.%' ORDER BY created_at`);
  const types = deliveries.map((d) => d.event_type);
  for (const wanted of ['signature.sent', 'signature.completed', 'signature.declined', 'signature.expired']) assert.ok(types.includes(wanted), wanted);
  const completed = JSON.parse(deliveries.find((d) => d.event_type === 'signature.completed')!.payload);
  assert.equal(completed.data.contractNumber, 'SIG-started');
  assert.equal(completed.data.status, 'completed');
  assert.ok(!JSON.stringify(completed).includes('/uploads/'), 'no storage links in webhook payloads');
  assert.equal((await h.sql.all(`SELECT 1 FROM webhook_deliveries WHERE organization_id = 'org-b'`)).length, 0);
  const contractUpdated = await h.sql.get<any>(`SELECT payload FROM webhook_deliveries WHERE event_type = 'contract.updated' AND payload LIKE '%status_approval%' ORDER BY created_at LIMIT 1`);
  assert.ok(contractUpdated, 'completion raised contract.updated for the approval status');

  // Notices to the requester: one per (request, kind), delivered through the mailer with the organization language.
  const notices = await h.sql.all<any>(`SELECT kind, recipient_id, status FROM signature_notices ORDER BY created_at`);
  assert.deepEqual(notices.map((n) => n.kind).sort(), ['completed', 'completed', 'declined', 'expired']);
  // The scheduler pass above found the mail relay disabled and recorded that honestly; put the notices back to try the delivery itself.
  assert.ok(notices.every((n) => n.status === 'skipped'));
  await h.sql.run(`UPDATE signature_notices SET status = 'pending', attempts = 0, last_error = NULL`);
  const mails: Array<{ to: string; subject: string; html: string }> = [];
  const { deliverSignatureNotices, signatureNoticeContent } = await import('./signatureNotifications');
  const result = await deliverSignatureNotices(h.sql, {
    smtpAvailable: () => true, publicUrl: () => 'https://legalio.example', send: async (m) => { mails.push(m); return { success: true }; },
    render: async (_id, values) => ({ subject: values.subject, html: `${values.heading}|${values.intro}|${values.details}|${values.actionUrl}` }),
  });
  assert.equal(result.sent, 4, JSON.stringify(result) + JSON.stringify(await h.sql.all(`SELECT kind, status, last_error FROM signature_notices`)));
  assert.ok(mails.every((m) => m.to === 'admina@example.com' || m.to === 'legala@example.com'), 'only the requester is told');
  assert.ok(mails.some((m) => /Declined/.test(m.subject)) && mails.some((m) => /Expired/.test(m.subject)) && mails.some((m) => /Signed/.test(m.subject)));
  assert.equal((await deliverSignatureNotices(h.sql, { smtpAvailable: () => true, publicUrl: () => '', send: async () => ({ success: true }), render: async () => ({ subject: 's', html: 'h' }) })).attempted, 0, 'sent notices are not sent again');
  assert.match(signatureNoticeContent('declined', { title: 'T', contractNumber: 'C', signerName: 'Zed' }, 'ID').subject, /Ditolak/);
});

/* ------------------------------ inbound webhook ------------------------------ */

let endpoint: { id: string; url: string }; let secret = '';
// `h.request` JSON-encodes its body, which would change the bytes after signing; the exact signed string is sent with fetch instead.
const send = async (endpointId: string, body: unknown, options: { secret?: string; key?: string | null; timestamp?: number; header?: string } = {}) => {
  const { signatureHeader } = await import('./webhooks');
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const t = options.timestamp ?? Math.floor(Date.now() / 1000);
  const response = await fetch(`${h.base}/api/signatures/webhook/${endpointId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'legalio-signature': options.header ?? signatureHeader(options.secret ?? secret, raw, t), ...(options.key === null ? {} : { 'idempotency-key': options.key ?? crypto.randomUUID() }) },
    body: raw,
  });
  const text = await response.text();
  let parsed: any = text; try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, body: parsed };
};

test('endpoint administration: the secret is shown once and sealed; only administrators; tenants are separate', async () => {
  assert.equal((await api('legalA', 'POST', '/api/organizations/org-a/signature-endpoints', { body: { name: 'Zapier' } })).status, 403, 'editors cannot manage endpoints');
  assert.equal((await api('adminB', 'POST', '/api/organizations/org-a/signature-endpoints', { org: 'org-a', body: { name: 'Zapier' } })).status, 404);
  assert.equal((await api('adminA', 'POST', '/api/organizations/org-a/signature-endpoints', { body: { name: '' } })).status, 400);
  const created = await api('adminA', 'POST', '/api/organizations/org-a/signature-endpoints', { body: { name: 'Zapier bridge' } });
  assert.equal(created.status, 201, created.raw);
  secret = created.body.secret;
  endpoint = created.body.endpoint;
  assert.match(secret, /^sigsec_/);
  assert.match(endpoint.id, /^sgw_[0-9a-f]{32}$/);
  assert.ok(endpoint.url.endsWith(`/api/signatures/webhook/${endpoint.id}`));
  assert.equal(created.headers.get('cache-control'), 'no-store');
  const listed = await api('adminA', 'GET', '/api/organizations/org-a/signature-endpoints');
  assert.ok(!listed.raw.includes(secret) && !listed.raw.includes('v1:'), 'never returned again');
  assert.equal(listed.body.endpoints.length, 1);
  assert.deepEqual((await api('adminB', 'GET', '/api/organizations/org-b/signature-endpoints')).body.endpoints, []);
  const stored = await h.sql.get<any>(`SELECT secret_sealed FROM signature_endpoints WHERE id = ?`, endpoint.id);
  assert.ok(stored.secret_sealed.startsWith('v1:') && !stored.secret_sealed.includes(secret));
});

test('inbound webhook: authentication (HMAC), freshness and replay protection', async () => {
  const created = (await create('adminA', 'hook', { send: true })).body.request;
  ids.hookReq = created.id;
  const event = { type: 'signer.signed', requestId: created.id, signer: { email: 'signer1@counterparty.test' } };
  // Authentication failures all look the same and change nothing.
  const refusals = [
    await send(endpoint.id, event, { secret: 'sigsec_wrong' }),
    await send(endpoint.id, event, { header: '' }),
    await send(endpoint.id, event, { header: 't=1,v1=00' }),
    await send(endpoint.id, event, { timestamp: Math.floor(Date.now() / 1000) - 3600 }),
    await send(endpoint.id, event, { timestamp: Math.floor(Date.now() / 1000) + 3600 }),
    await send(`sgw_${'0'.repeat(32)}`, event),
    await send('nonsense', event),
  ];
  for (const refused of refusals) { assert.equal(refused.status, 401); assert.equal(refused.body.code, 'INVALID_SIGNATURE'); }
  // The body that was signed must be the body that arrives.
  const { signatureHeader } = await import('./webhooks');
  const raw = JSON.stringify(event);
  const header = signatureHeader(secret, raw);
  const tampered = await send(endpoint.id, raw.replace('signer1', 'signer2'), { header });
  assert.equal(tampered.status, 401);
  assert.equal((await api('adminA', 'GET', `/api/signatures/${created.id}`)).body.request.signers[0].status, 'pending');

  assert.equal((await send(endpoint.id, event, { key: null })).status, 400, 'an idempotency key is required');
  assert.equal((await send(endpoint.id, { ...event, type: 'signer.exploded' })).status, 400);
  assert.equal((await send(endpoint.id, '{not json')).status, 400);
  assert.equal((await send(endpoint.id, { type: 'signer.signed', signer: { email: 'a@b.test' } })).status, 400, 'a request must be named');

  const key = 'evt-001';
  const first = await send(endpoint.id, event, { key });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.status, 'applied');
  assert.equal(first.body.requestStatus, 'partially_signed');
  const eventsAfterFirst = (await events(created.id)).length;
  // Replays: the exact same delivery, and the same key with a fresh timestamp.
  const replay = await send(endpoint.id, event, { key });
  assert.deepEqual(replay.body, { status: 'duplicate' });
  assert.equal((await send(endpoint.id, event, { key, timestamp: Math.floor(Date.now() / 1000) - 5 })).body.status, 'duplicate');
  assert.equal((await events(created.id)).length, eventsAfterFirst, 'a replay writes nothing');
  // The same signature again under a new key is a harmless duplicate of the signer's state.
  assert.equal((await send(endpoint.id, event)).body.status, 'duplicate');
  assert.equal((await h.sql.get<any>(`SELECT last_received_at FROM signature_endpoints WHERE id = ?`, endpoint.id)).last_received_at !== null, true);
  const actors = await h.sql.all<{ actor: string }>(`SELECT DISTINCT actor FROM signature_events WHERE request_id = ? AND type = 'signer_signed'`, created.id);
  assert.deepEqual(actors.map((a) => a.actor), [`webhook:${endpoint.id}`]);
});

test('inbound webhook: a rejected event consumes nothing, files are validated, completion attaches the signed PDF', async () => {
  const id = ids.hookReq;
  const document = (bytes: Buffer, fileName = 'signed.pdf') => ({ fileName, contentBase64: bytes.toString('base64') });
  const key = 'evt-bad-file';
  const notPdf = await send(endpoint.id, { type: 'signer.signed', requestId: id, signer: { email: 'signer2@counterparty.test' }, document: document(Buffer.from('MZ binary')) }, { key });
  assert.equal(notPdf.status, 422);
  assert.equal(notPdf.body.code, 'INVALID_FILE');
  const tooBig = await send(endpoint.id, { type: 'signer.signed', requestId: id, signer: { email: 'signer2@counterparty.test' }, document: document(Buffer.from(`%PDF-1.7${'x'.repeat(MAX)}`)) });
  assert.equal(tooBig.status, 413);
  assert.equal((await api('adminA', 'GET', `/api/signatures/${id}`)).body.request.status, 'partially_signed', 'nothing changed');
  // The failed delivery did not use up its idempotency key: the corrected retry is processed.
  const ok = await send(endpoint.id, { type: 'signer.signed', requestId: id, signer: { email: 'SIGNER2@counterparty.test' }, document: document(Buffer.from('%PDF-1.7 final from provider')), occurredAt: '2026-10-20T10:00:00Z' }, { key });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.requestStatus, 'completed');
  const detail = (await api('adminA', 'GET', `/api/signatures/${id}`)).body.request;
  assert.equal(detail.signedFile.fileName, 'signed.pdf');
  assert.equal(detail.signers[1].signedAt, '2026-10-20T10:00:00.000Z');
  const contract = await contractOf('hook');
  assert.equal(contract.status_approval, 'Signed');
  assert.match(contract.signed_file_link, /^\/uploads\/org-a\//);
  const key2 = decodeURIComponent(contract.signed_file_link.slice('/uploads/'.length));
  assert.equal((await h.sql.get<any>(`SELECT organization_id FROM upload_owners WHERE storage_key = ?`, key2))?.organization_id, 'org-a');
  // A late signed copy for a completed request is attached; transitions out of a final state are conflicts.
  const late = await send(endpoint.id, { type: 'request.document', requestId: id, document: document(Buffer.from('%PDF-1.7 corrected copy'), 'corrected.pdf') });
  assert.equal(late.status, 200);
  assert.equal((await api('adminA', 'GET', `/api/signatures/${id}`)).body.request.signedFile.fileName, 'corrected.pdf');
  assert.match((await contractOf('hook')).signed_file_name, /corrected/);
  const declinedAfter = await send(endpoint.id, { type: 'signer.declined', requestId: id, signer: { email: 'signer1@counterparty.test' } });
  assert.equal(declinedAfter.status, 409);
  assert.equal(declinedAfter.body.code, 'INVALID_TRANSITION');
  assert.equal((await send(endpoint.id, { type: 'request.completed', requestId: id })).body.status, 'duplicate', 'completing a completed request is idempotent');
});

test('inbound webhook: provider references, whole-request events and out-of-order delivery', async () => {
  const sequential = (await create('adminA', 'extra', { mode: 'sequential' })).body.request;
  // Reported before the request was sent: the bridge may send it first.
  const sent = await send(endpoint.id, { type: 'request.sent', requestId: sequential.id, providerRef: 'ENV-42' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.requestStatus, 'sent');
  assert.equal((await api('adminA', 'GET', `/api/signatures/${sequential.id}`)).body.request.providerRef, 'ENV-42');
  // The provider is the authority on order: signer 2 first is accepted over the webhook (the manual UI would refuse it).
  const outOfOrder = await send(endpoint.id, { type: 'signer.signed', providerRef: 'ENV-42', signer: { email: 'signer2@counterparty.test' } });
  assert.equal(outOfOrder.status, 200);
  assert.equal(outOfOrder.body.requestStatus, 'partially_signed');
  assert.equal((await send(endpoint.id, { type: 'signer.signed', providerRef: 'ENV-42', signer: { email: 'stranger@counterparty.test' } })).status, 404, 'unknown signer');
  const completed = await send(endpoint.id, { type: 'request.completed', providerRef: 'ENV-42' });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.requestStatus, 'completed', 'the remaining signers are recorded as signed');
  assert.equal((await api('adminA', 'GET', `/api/signatures/${sequential.id}`)).body.request.signedFile, null, 'completed without a document; a copy can follow');

  const another = (await create('adminA', 'cross', { send: true })).body.request;
  assert.equal((await send(endpoint.id, { type: 'request.declined', requestId: another.id, reason: 'no' })).body.requestStatus, 'declined');
  assert.equal((await send(endpoint.id, { type: 'request.declined', requestId: another.id })).body.status, 'duplicate');
  const third = (await create('adminA', 'cross', { send: true })).body.request;
  assert.equal((await send(endpoint.id, { type: 'request.expired', requestId: third.id })).body.requestStatus, 'expired');
  const fourth = (await create('adminA', 'cross', { send: true })).body.request;
  assert.equal((await send(endpoint.id, { type: 'request.cancelled', requestId: fourth.id, reason: 'withdrawn' })).body.requestStatus, 'cancelled');
});

test('cross-tenant: another organization\'s endpoint cannot see or change this organization\'s requests', async () => {
  const other = await api('adminB', 'POST', '/api/organizations/org-b/signature-endpoints', { body: { name: 'B bridge' } });
  const foreign = await create('adminA', 'cross', { send: true });
  assert.equal(foreign.status, 201, foreign.raw);
  const attempt = await send(other.body.endpoint.id, { type: 'request.completed', requestId: foreign.body.request.id }, { secret: other.body.secret });
  assert.equal(attempt.status, 404);
  assert.equal((await send(other.body.endpoint.id, { type: 'request.completed', requestId: foreign.body.request.id }, { secret: secret })).status, 401, 'nor with the other organization\'s secret');
  assert.equal((await api('adminA', 'GET', `/api/signatures/${foreign.body.request.id}`)).body.request.status, 'sent');
  // The tenant API says 404 for everything of another organization.
  const id = foreign.body.request.id;
  assert.equal((await api('adminB', 'GET', `/api/signatures/${id}`)).status, 404);
  assert.equal((await api('adminB', 'POST', `/api/signatures/${id}/cancel`)).status, 404);
  assert.equal((await api('adminB', 'POST', `/api/signatures/${id}/complete`, { body: { fileName: 'x.pdf', fileData: pdf() } })).status, 404);
  assert.equal((await api('adminB', 'GET', `/api/signatures?contract_id=${ids.cross}`)).status, 404);
  assert.deepEqual((await api('adminB', 'GET', '/api/signatures')).body, []);
  assert.equal((await api('financeA', 'GET', `/api/signatures/${id}`)).status, 404, 'another department');
  assert.deepEqual((await api('financeA', 'GET', '/api/signatures')).body, [], 'the department list holds nothing of the Legal contracts');
  assert.ok((await api('legalA', 'GET', '/api/signatures')).body.length > 0);
  // A request cannot be created for a contract of another organization, and an endpoint cannot be managed across tenants.
  assert.equal((await api('adminB', 'POST', '/api/signatures', { body: { contract_id: ids.cross, signers: signers() } })).status, 404);
  assert.equal((await api('adminB', 'PATCH', `/api/organizations/org-a/signature-endpoints/${endpoint.id}`, { org: 'org-a', body: { enabled: false } })).status, 404);
  assert.equal((await api('adminB', 'DELETE', `/api/organizations/org-b/signature-endpoints/${endpoint.id}`)).status, 404, 'an id from another organization matches nothing');
  await api('adminA', 'POST', `/api/signatures/${id}/cancel`);
});

test('secret rotation, disabling and deleting an endpoint', async () => {
  const old = secret;
  const rotated = await api('adminA', 'POST', `/api/organizations/org-a/signature-endpoints/${endpoint.id}/rotate-secret`);
  assert.equal(rotated.status, 200);
  secret = rotated.body.secret;
  assert.notEqual(secret, old);
  const probe = { type: 'request.document', requestId: ids.hookReq, document: { fileName: 'a.pdf', contentBase64: Buffer.from('%PDF-1.7 x').toString('base64') } };
  assert.equal((await send(endpoint.id, probe, { secret: old })).status, 401, 'the old secret stops working at once');
  assert.equal((await send(endpoint.id, probe)).status, 200);
  assert.equal((await api('adminA', 'PATCH', `/api/organizations/org-a/signature-endpoints/${endpoint.id}`, { body: { enabled: false } })).body.endpoint.enabled, false);
  assert.equal((await send(endpoint.id, probe)).status, 401, 'a disabled endpoint refuses');
  assert.equal((await api('adminA', 'PATCH', `/api/organizations/org-a/signature-endpoints/${endpoint.id}`, { body: { enabled: true, color: 'red' } })).status, 400, 'unknown fields are refused');
  await api('adminA', 'PATCH', `/api/organizations/org-a/signature-endpoints/${endpoint.id}`, { body: { enabled: true } });
  assert.equal((await api('adminA', 'DELETE', `/api/organizations/org-a/signature-endpoints/${endpoint.id}`)).status, 204);
  assert.equal((await send(endpoint.id, probe)).status, 401);
  assert.equal((await h.sql.get<any>(`SELECT COUNT(*)::int AS n FROM signature_receipts WHERE endpoint_id = ?`, endpoint.id)).n, 0, 'receipts go with the endpoint');
  const audit = await h.sql.all<{ action: string }>(`SELECT action FROM audit_log WHERE tenant_id = 'org-a' AND action LIKE 'signature_endpoint.%' ORDER BY created_at`);
  assert.deepEqual(audit.map((a) => a.action), ['signature_endpoint.create', 'signature_endpoint.rotate_secret', 'signature_endpoint.update', 'signature_endpoint.update', 'signature_endpoint.delete']);
});

test('public API v1: read-only signature status with its own scope', async () => {
  const key = await api('adminA', 'POST', '/api/organizations/org-a/api-keys', { body: { name: 'sig', scopes: ['signatures:read'] } });
  assert.equal(key.status, 201, key.raw);
  const bearer = { authorization: `Bearer ${key.body.secret}` };
  const list = await h.request('GET', `/api/v1/signatures?contract_id=${ids.started}`, { headers: bearer });
  assert.equal(list.status, 200, list.raw);
  assert.equal(list.body.total, 2);
  assert.ok(list.body.data.every((r: any) => r.contractId === ids.started));
  const one = await h.request('GET', `/api/v1/signatures/${ids.r1}`, { headers: bearer });
  assert.equal(one.status, 200);
  assert.equal(one.body.data.status, 'completed');
  assert.equal(one.body.data.events.length, 7);
  assert.equal((await h.request('GET', '/api/v1/signatures/sig_none', { headers: bearer })).status, 404);
  assert.equal((await h.request('GET', '/api/v1/contracts', { headers: bearer })).status, 403, 'the scope grants only signatures');
  assert.equal((await h.request('POST', '/api/v1/signatures', { headers: bearer, body: {} })).status, 404, 'there is no write operation');
  const other = await api('adminB', 'POST', '/api/organizations/org-b/api-keys', { body: { name: 'sigb', scopes: ['signatures:read'] } });
  assert.equal((await h.request('GET', `/api/v1/signatures/${ids.r1}`, { headers: { authorization: `Bearer ${other.body.secret}` } })).status, 404, 'another organization\'s key');
  assert.equal((await h.request('GET', '/api/v1/signatures', { headers: { authorization: `Bearer ${other.body.secret}` } })).body.total, 0);
  const spec = (await h.request('GET', '/api/v1/openapi.json')).body;
  assert.ok(spec.paths['/signatures'].get && spec.paths['/signatures/{id}'].get);
  assert.ok(spec.components.securitySchemes.ApiKey.description.includes('signatures:read'));
});

test('deleting a contract removes its signature data; the organization schema keeps no orphans', async () => {
  const before = (await h.sql.get<any>(`SELECT COUNT(*)::int AS n FROM signature_requests WHERE contract_id = ?`, ids.declined)).n;
  assert.ok(before >= 1);
  assert.equal((await api('adminA', 'DELETE', `/api/contracts/${ids.declined}`)).status, 200);
  assert.equal((await h.sql.get<any>(`SELECT COUNT(*)::int AS n FROM signature_requests WHERE contract_id = ?`, ids.declined)).n, 0);
  assert.equal((await h.sql.get<any>(`SELECT COUNT(*)::int AS n FROM signature_signers s WHERE NOT EXISTS (SELECT 1 FROM signature_requests r WHERE r.id = s.request_id)`)).n, 0);
});
