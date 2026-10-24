import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { APPROVAL_CATEGORIES } from '@legalio/types/approvals';
import { bootApp, type Harness } from './testHarness';
import { createMailTemplateStore } from './mailTemplateStore';
import type { ApprovalNoticeDeps } from './approvalNotifications';

let h: Harness;
const mail: Array<{ to: string; subject: string; html: string }> = [];
let clock: Date | null = null;
let failing = false;
let smtp = true;
const deps = (): ApprovalNoticeDeps => ({
  smtpAvailable: () => smtp,
  send: async (m) => { if (failing) return { success: false, error: 'relay down' }; mail.push(m); return { success: true }; },
  render: (id, values, trusted) => createMailTemplateStore(h.sql).render(id, values, trusted),
  publicUrl: () => 'https://legalio.example',
  now: () => clock ?? new Date(),
});

before(async () => {
  h = await bootApp({
    tag: 'approvals', orgs: [{ id: 'org-a', name: 'Org A' }, { id: 'org-b', name: 'Org B' }],
    users: [['adminA', 'org-a', 'admin'], ['reqA', 'org-a', 'editor'], ['ap1', 'org-a', 'editor'], ['ap2', 'org-a', 'editor'], ['adminB', 'org-b', 'admin'], ['reqB', 'org-b', 'editor'], ['apB', 'org-b', 'editor']],
  });
});
after(() => h?.close());

const submit = async (requester: string, org: string, approverIds: string[], title = 'Vendor contract') => {
  const reply = await h.api(requester, 'POST', '/api/approvals', { org, body: { title, category: APPROVAL_CATEGORIES[0], note: 'please', approverIds, file: { name: 'a.pdf', base64: Buffer.from('%PDF-1.4 x').toString('base64') } } });
  assert.equal(reply.status, 201, reply.raw);
  return reply.body.id as string;
};
const decide = (user: string, org: string, id: string, decision: 'approve' | 'reject', comment = '') => h.api(user, 'POST', `/api/approvals/${id}/decision`, { org, body: { decision, comment } });
const setLanguage = (org: string, language: 'EN' | 'ID' | 'ZH') => h.sql.run(`UPDATE organization_settings SET payload = jsonb_set(payload::jsonb, '{policy,language}', to_jsonb(?::text))::text WHERE "organizationId" = ?`, language, org);
const notices = (requestId: string) => h.sql.all(`SELECT kind, step_no, recipient_id, status FROM approval_notices WHERE request_id = ? ORDER BY created_at, kind, recipient_id`, requestId);

test('the first approver is e-mailed when a request is submitted, the next one and the requester as it moves on', async () => {
  const { deliverApprovalNotices } = await import('./approvalNotifications');
  await setLanguage('org-a', 'EN');
  const id = await submit('reqA', 'org-a', ['ap1', 'ap2']);
  assert.deepEqual(await notices(id), [{ kind: 'requested', step_no: 1, recipient_id: 'ap1', status: 'pending' }]);
  mail.length = 0;
  assert.equal((await deliverApprovalNotices(h.sql, deps())).sent, 1);
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to, 'ap1@example.com');
  assert.match(mail[0].subject, /^\[Approval needed\] OA-\d{4}-\d{5} — Vendor contract$/);
  assert.ok(mail[0].html.includes('https://legalio.example/app?tab=document-approval'));
  assert.ok(mail[0].html.includes('Vendor contract') && mail[0].html.includes('reqA'));
  assert.doesNotMatch(mail[0].html + mail[0].subject, /{{/);
  assert.equal((await deliverApprovalNotices(h.sql, deps())).attempted, 0, 'nothing is sent twice');

  assert.equal((await decide('ap1', 'org-a', id, 'approve', 'looks fine')).status, 200);
  assert.deepEqual((await notices(id)).map((n: any) => `${n.kind}:${n.step_no}:${n.recipient_id}`).sort(), ['decided:1:reqA', 'requested:1:ap1', 'requested:2:ap2']);
  mail.length = 0;
  await deliverApprovalNotices(h.sql, deps());
  assert.deepEqual(mail.map((m) => m.to).sort(), ['ap2@example.com', 'reqa@example.com']);
  const toRequester = mail.find((m) => m.to === 'reqa@example.com')!;
  assert.match(toRequester.subject, /^\[Step approved\]/);
  assert.ok(toRequester.html.includes('looks fine') && toRequester.html.includes('ap1'));

  assert.equal((await decide('ap2', 'org-a', id, 'reject', 'missing annex')).status, 200);
  mail.length = 0;
  await deliverApprovalNotices(h.sql, deps());
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to, 'reqa@example.com');
  assert.match(mail[0].subject, /^\[Rejected\]/);
  assert.ok(mail[0].html.includes('missing annex'));

  // In-app entries are personal.
  const reqInbox = (await h.api('reqA', 'GET', '/api/organizations/org-a/my-notifications')).body;
  assert.deepEqual(reqInbox.notifications.map((n: any) => n.kind).sort(), ['approval.decided', 'approval.decided']);
  assert.equal(reqInbox.unread, 2);
  const ap1Inbox = (await h.api('ap1', 'GET', '/api/organizations/org-a/my-notifications')).body;
  assert.deepEqual(ap1Inbox.notifications.map((n: any) => n.kind), ['approval.requested']);
  assert.equal((await h.api('adminA', 'GET', '/api/organizations/org-a/my-notifications')).body.notifications.length, 0, 'an admin does not see other people\'s entries');
  assert.equal((await h.api('reqA', 'POST', '/api/organizations/org-a/my-notifications/read', { body: { ids: ap1Inbox.notifications.map((n: any) => n.id) } })).body.updated, 0, 'cannot mark someone else\'s entry');
  assert.equal((await h.api('ap1', 'POST', '/api/organizations/org-a/my-notifications/read', { body: { all: true } })).body.updated, 1);
  assert.equal((await h.api('ap1', 'GET', '/api/organizations/org-a/my-notifications')).body.unread, 0);
  assert.equal((await h.api('ap1', 'POST', '/api/organizations/org-a/my-notifications/read', { body: {} })).status, 400);
  assert.equal((await h.api('adminB', 'GET', '/api/organizations/org-a/my-notifications')).status, 404);
});

test('mails follow the organization language (en, id, zh)', async () => {
  const { deliverApprovalNotices } = await import('./approvalNotifications');
  for (const [language, subject, heading] of [['ID', /^\[Perlu persetujuan\]/, 'Dokumen menunggu persetujuan Anda'], ['ZH', /^【待审批】/, '有文档等待您审批']] as const) {
    await setLanguage('org-a', language);
    await submit('reqA', 'org-a', ['ap1'], `Dok ${language}`);
    mail.length = 0;
    await deliverApprovalNotices(h.sql, deps());
    assert.match(mail[0].subject, subject, language);
    assert.ok(mail[0].html.includes(heading), language);
  }
  await setLanguage('org-a', 'EN');
});

test('the SLA is a per-organization setting that new requests use', async () => {
  assert.equal((await h.api('adminA', 'GET', '/api/organizations/org-a/approval-settings')).body.slaHours, 48);
  assert.equal((await h.api('editorless' as any, 'GET', '/api/organizations/org-a/approval-settings').catch(() => ({ status: 401 }))).status, 401);
  assert.equal((await h.api('reqA', 'PUT', '/api/organizations/org-a/approval-settings', { body: { slaHours: 5 } })).status, 403);
  assert.equal((await h.api('adminB', 'PUT', '/api/organizations/org-a/approval-settings', { body: { slaHours: 5 } })).status, 404);
  for (const body of [{ slaHours: 0 }, { slaHours: 721 }, { slaHours: 1.5 }, { slaHours: 'x' }, { escalation: 'everyone' }, { other: 1 }]) assert.equal((await h.api('adminA', 'PUT', '/api/organizations/org-a/approval-settings', { body })).status, 400, JSON.stringify(body));
  const saved = await h.api('adminA', 'PUT', '/api/organizations/org-a/approval-settings', { body: { slaHours: 10, escalation: 'admins' } });
  assert.equal(saved.status, 200, saved.raw);
  const id = await submit('reqA', 'org-a', ['ap1'], 'Ten hours');
  const row = await h.sql.get(`SELECT created_at, due_at FROM approval_requests WHERE id = ?`, id);
  assert.equal(new Date(row.due_at).getTime() - new Date(row.created_at).getTime(), 10 * 3600_000);
  const other = await submit('reqB', 'org-b', ['apB'], 'Default hours');
  const otherRow = await h.sql.get(`SELECT created_at, due_at FROM approval_requests WHERE id = ?`, other);
  assert.equal(new Date(otherRow.due_at).getTime() - new Date(otherRow.created_at).getTime(), 48 * 3600_000, 'another organization keeps the default');
  assert.ok((await h.sql.get(`SELECT 1 FROM audit_log WHERE action = 'approval.settings.update' AND tenant_id = 'org-a'`)));
  await h.sql.exec(`DELETE FROM approval_requests WHERE title IN ('Ten hours')`);
});

test('reminder at 80% of the SLA and escalation on breach, each once, to the right people', async () => {
  const { runApprovalSlaPass, deliverApprovalNotices } = await import('./approvalNotifications');
  await h.sql.exec(`DELETE FROM approval_requests; DELETE FROM approval_notices; DELETE FROM user_notifications`);
  await h.api('adminA', 'PUT', '/api/organizations/org-a/approval-settings', { body: { slaHours: 10, escalation: 'admins' } });
  const id = await submit('reqA', 'org-a', ['ap1', 'ap2'], 'Slow one');
  const created = new Date((await h.sql.get(`SELECT created_at FROM approval_requests WHERE id = ?`, id)).created_at).getTime();
  const at = (hours: number) => new Date(created + hours * 3600_000);
  assert.deepEqual(await runApprovalSlaPass(h.sql, at(7)), { reminders: 0, breaches: 0 }, 'before 80%');
  assert.deepEqual(await runApprovalSlaPass(h.sql, at(8.5)), { reminders: 1, breaches: 0 });
  assert.deepEqual(await runApprovalSlaPass(h.sql, at(9)), { reminders: 0, breaches: 0 }, 'idempotent');
  const [a, b] = await Promise.all([runApprovalSlaPass(h.sql, at(10.5)), runApprovalSlaPass(h.sql, at(10.5))]);
  assert.equal(a.breaches + b.breaches, 2, 'two passes at once still enqueue each notice once: the approver and the admin');
  assert.deepEqual(await runApprovalSlaPass(h.sql, at(11)), { reminders: 0, breaches: 0 });
  assert.deepEqual((await notices(id)).map((n: any) => `${n.kind}:${n.recipient_id}`).sort(), ['requested:ap1', 'sla_breach:adminA', 'sla_breach:ap1', 'sla_reminder:ap1']);

  mail.length = 0;
  clock = at(11);
  await deliverApprovalNotices(h.sql, deps());
  const reminder = mail.find((m) => m.subject.startsWith('[SLA reminder]'))!;
  assert.equal(reminder.to, 'ap1@example.com');
  assert.ok(reminder.html.includes('SLA deadline'));
  const escalation = mail.find((m) => m.to === 'admina@example.com')!;
  assert.match(escalation.subject, /^\[Overdue\]/);
  assert.ok(escalation.html.includes('escalation') && escalation.html.includes('ap1'), 'names the delayed approver');
  const own = mail.find((m) => m.to === 'ap1@example.com' && m.subject.startsWith('[Overdue]'))!;
  assert.ok(own.html.includes('waiting for your decision'));
  const adminInbox = (await h.api('adminA', 'GET', '/api/organizations/org-a/my-notifications')).body;
  assert.deepEqual(adminInbox.notifications.map((n: any) => n.kind), ['approval.sla_breach']);
  clock = null;

  // Next-approver escalation: the person after the delayed one is told; on the last step it falls back to the admins.
  await h.api('adminA', 'PUT', '/api/organizations/org-a/approval-settings', { body: { escalation: 'next_approver' } });
  const second = await submit('reqA', 'org-a', ['ap1', 'ap2'], 'Next approver');
  const t0 = new Date((await h.sql.get(`SELECT created_at FROM approval_requests WHERE id = ?`, second)).created_at).getTime();
  await runApprovalSlaPass(h.sql, new Date(t0 + 11 * 3600_000));
  assert.deepEqual((await notices(second)).filter((n: any) => n.kind === 'sla_breach').map((n: any) => n.recipient_id).sort(), ['ap1', 'ap2']);
  await decide('ap1', 'org-a', second, 'approve');
  await runApprovalSlaPass(h.sql, new Date(t0 + 12 * 3600_000));
  assert.deepEqual((await notices(second)).filter((n: any) => n.kind === 'sla_breach' && n.step_no === 2).map((n: any) => n.recipient_id).sort(), ['adminA', 'ap2'], 'last step: admins');

  // A decided approval is never nagged about, and queued reminders for it are dropped at delivery.
  const third = await submit('reqA', 'org-a', ['ap1'], 'Decided in time');
  const t3 = new Date((await h.sql.get(`SELECT created_at FROM approval_requests WHERE id = ?`, third)).created_at).getTime();
  await runApprovalSlaPass(h.sql, new Date(t3 + 8.5 * 3600_000));
  await decide('ap1', 'org-a', third, 'approve');
  assert.deepEqual(await runApprovalSlaPass(h.sql, new Date(t3 + 12 * 3600_000)), { reminders: 0, breaches: 0 });
  mail.length = 0;
  await deliverApprovalNotices(h.sql, deps());
  assert.ok(!mail.some((m) => m.subject.includes('Decided in time') && m.subject.startsWith('[SLA reminder]')));
  assert.equal((await h.sql.get(`SELECT status FROM approval_notices WHERE request_id = ? AND kind = 'sla_reminder'`, third)).status, 'skipped');
});

test('escalations never cross organizations', async () => {
  const { runApprovalSlaPass } = await import('./approvalNotifications');
  const id = await submit('reqB', 'org-b', ['apB'], 'B approval');
  const created = new Date((await h.sql.get(`SELECT created_at FROM approval_requests WHERE id = ?`, id)).created_at).getTime();
  await h.api('adminB', 'PUT', '/api/organizations/org-b/approval-settings', { body: { escalation: 'admins' } });
  await runApprovalSlaPass(h.sql, new Date(created + 72 * 3600_000));
  const recipients = (await notices(id)).filter((n: any) => n.kind === 'sla_breach').map((n: any) => n.recipient_id).sort();
  assert.deepEqual(recipients, ['adminB', 'apB']);
  assert.ok(!(await h.sql.get(`SELECT 1 FROM user_notifications WHERE organization_id = 'org-a' AND params LIKE ?`, `%${id}%`)));
});

test('delivery retries with backoff, dead-letters, and is skipped without an SMTP relay (the in-app entry stays)', async () => {
  const { deliverApprovalNotices, backoffMs } = await import('./approvalNotifications').then(async (m) => ({ ...m, ...(await import('./reminders')) }));
  const id = await submit('reqA', 'org-a', ['ap2'], 'Mail trouble');
  failing = true;
  clock = new Date();
  const first = await deliverApprovalNotices(h.sql, deps(), { maxAttempts: 3 });
  assert.equal(first.failed >= 1, true);
  const row = await h.sql.get(`SELECT status, attempts, last_error, next_attempt_at FROM approval_notices WHERE request_id = ?`, id);
  assert.deepEqual([row.status, row.attempts, row.last_error], ['failed', 1, 'relay down']);
  assert.equal(new Date(row.next_attempt_at).getTime(), clock!.getTime() + backoffMs(1));
  clock = new Date(clock!.getTime() + 3600_000);
  await deliverApprovalNotices(h.sql, deps(), { maxAttempts: 3 });
  clock = new Date(clock!.getTime() + 3 * 3600_000);
  const last = await deliverApprovalNotices(h.sql, deps(), { maxAttempts: 3 });
  assert.equal(last.dead >= 1, true);
  assert.equal((await h.sql.get(`SELECT status FROM approval_notices WHERE request_id = ?`, id)).status, 'dead');
  failing = false;
  clock = null;
  smtp = false;
  const quiet = await submit('reqA', 'org-a', ['ap2'], 'No relay');
  await deliverApprovalNotices(h.sql, deps());
  assert.equal((await h.sql.get(`SELECT status, last_error FROM approval_notices WHERE request_id = ?`, quiet)).status, 'skipped');
  assert.ok((await h.api('ap2', 'GET', '/api/organizations/org-a/my-notifications')).body.notifications.some((n: any) => n.params.title === 'No relay'), 'in-app entry exists');
  smtp = true;
});
