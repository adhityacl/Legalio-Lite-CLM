import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { bootApp, type Harness } from './testHarness';
import { createMailTemplateStore } from './mailTemplateStore';
import type { DigestDeps } from './digest';

let h: Harness;
const mail: Array<{ to: string; subject: string; html: string; headers?: Record<string, string> }> = [];
let failing = false;
let smtp = true;
let clock: Date | null = null;
const deps = (): DigestDeps => ({
  smtpAvailable: () => smtp,
  send: async (m) => { if (failing) return { success: false, error: 'relay down' }; mail.push(m); return { success: true }; },
  render: (values) => createMailTemplateStore(h.sql).render('digest', values, ['details']),
  publicUrl: () => 'https://legalio.example',
  now: () => clock ?? new Date(),
});
const DAY = 86_400_000;

before(async () => {
  h = await bootApp({
    tag: 'digest', orgs: [{ id: 'org-a', name: 'Org A' }, { id: 'org-b', name: 'Org B' }],
    users: [['adminA', 'org-a', 'admin'], ['salesA', 'org-a', 'editor', 'Sales'], ['legalA', 'org-a', 'viewer', 'Legal'], ['adminB', 'org-b', 'admin']],
  });
});
after(() => h?.close());

/* ------------------------------ pure time and token logic ------------------------------ */

test('send times follow the organization time zone, daily and weekly periods are keyed and bounded', async () => {
  const { zonedInstant, periodOf, localDate } = await import('./digest');
  // Asia/Jakarta is UTC+7 all year: 08:00 local is 01:00 UTC.
  assert.equal(new Date(zonedInstant('2026-10-26', 8, 'Asia/Jakarta')).toISOString(), '2026-10-26T01:00:00.000Z');
  // New York: EDT (UTC-4) before the November change, EST (UTC-5) after it.
  assert.equal(new Date(zonedInstant('2026-10-26', 8, 'America/New_York')).toISOString(), '2026-10-26T12:00:00.000Z');
  assert.equal(new Date(zonedInstant('2026-11-02', 8, 'America/New_York')).toISOString(), '2026-11-02T13:00:00.000Z');
  assert.equal(localDate(Date.parse('2026-10-25T20:00:00Z'), 'Asia/Jakarta'), '2026-10-26', 'late evening UTC is already tomorrow in Jakarta');
  const wed = Date.parse('2026-10-28T10:00:00Z'); // Wednesday
  const daily = periodOf('daily', wed, 'UTC', 1, 8);
  assert.equal(daily.key, '2026-10-28');
  assert.equal(new Date(daily.scheduledAt).toISOString(), '2026-10-28T08:00:00.000Z');
  assert.equal(new Date(daily.endsAt).toISOString(), '2026-10-29T00:00:00.000Z');
  const weekly = periodOf('weekly', wed, 'UTC', 1, 8);
  assert.equal(weekly.key, 'week-2026-10-26');
  assert.equal(new Date(weekly.scheduledAt).toISOString(), '2026-10-26T08:00:00.000Z', 'Monday of that week');
  assert.equal(new Date(weekly.endsAt).toISOString(), '2026-11-02T00:00:00.000Z');
  assert.equal(periodOf('weekly', Date.parse('2026-11-01T23:00:00Z'), 'UTC', 7, 9).key, 'week-2026-10-26', 'Sunday belongs to the week that started on Monday');
  assert.equal(new Date(periodOf('weekly', Date.parse('2026-11-01T23:00:00Z'), 'UTC', 7, 9).scheduledAt).toISOString(), '2026-11-01T09:00:00.000Z');
});

test('unsubscribe tokens are signed per member and cannot be forged', async () => {
  const { signUnsubscribeToken, verifyUnsubscribeToken } = await import('./digest');
  const token = signUnsubscribeToken('org-a', 'salesA');
  assert.deepEqual(verifyUnsubscribeToken(token), { organizationId: 'org-a', userId: 'salesA' });
  const [payload, mac] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ o: 'org-a', u: 'adminA', k: 'digest' })).toString('base64url');
  for (const bad of [`${forged}.${mac}`, `${payload}.${mac.slice(0, -2)}AA`, payload, '', 'a.b', `${payload}.`, 'x'.repeat(700)]) assert.equal(verifyUnsubscribeToken(bad), null, bad.slice(0, 30));
  assert.equal(verifyUnsubscribeToken(undefined), null);
  assert.equal(verifyUnsubscribeToken({}), null);
});

/* ------------------------------ content, with scope ------------------------------ */

const dateIn = (today: string, days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
let today = '';
let timeZone = '';

test('setup: partners and contracts in two departments, one terminated, one orders and an approval', async () => {
  const { readOrganizationSettings } = await import('./organizationSettingsStore');
  const { localDate } = await import('./digest');
  timeZone = (await readOrganizationSettings(h.sql, 'org-a')).policy.timezone;
  today = localDate(Date.now(), timeZone);
  const partner = async (name: string, department: string) => (await h.api('adminA', 'POST', '/api/partners', { org: 'org-a', body: { partner_name: name, internal_pic: department, country: 'ID' } })).body.partner.partner_id;
  const sales = await partner('Sales Partner', 'Sales');
  const legal = await partner('Legal Partner', 'Legal');
  const contract = async (number: string, partnerId: string, endIn: number, notice: number) => {
    const reply = await h.api('adminA', 'POST', '/api/contracts', { org: 'org-a', body: { partner_id: partnerId, contract_number: number, contract_title: `Title ${number}`, start_date: dateIn(today, -300), end_date: dateIn(today, endIn), notice_period_days: notice, currency: 'USD', contract_value: 1 } });
    assert.equal(reply.status, 200, reply.raw);
    return reply.body.contract;
  };
  await contract('S-OVERDUE', sales, 20, 30);      // notice deadline was 10 days ago: overdue; expires in 20 days
  await contract('S-NOTICE', sales, 60, 40);       // notice deadline in 20 days
  await contract('L-SOON', legal, 10, 5);          // expires in 10 days, notice deadline in 5 days
  await contract('S-FAR', sales, 400, 30);         // nothing to report
  const dead = await contract('L-TERMINATED', legal, 12, 5);
  const terminated = await h.api('adminA', 'PUT', `/api/contracts/${dead.contract_id}`, { org: 'org-a', body: { lifecycle_mode: 'terminated', termination_date: today, termination_reason: 'done', version: dead.version } });
  assert.equal(terminated.status, 200, terminated.raw);
  const order = await h.api('adminA', 'POST', '/api/ios', { org: 'org-a', body: { partner_id: sales, io_number: 'IO-SALES', io_title: 'Sales order', start_date: dateIn(today, -100), end_date: dateIn(today, 15), currency: 'USD', io_value: 1, pricing_model: 'Fixed', charging_type: 'Postpaid' } });
  assert.equal(order.status, 200, order.raw);
  // An approval from adminA waiting for salesA, already past its deadline.
  const approval = await h.api('adminA', 'POST', '/api/approvals', { org: 'org-a', body: { title: 'Digest approval', category: 'contract', note: '', approverIds: ['salesA'], file: { name: 'a.pdf', base64: Buffer.from('%PDF-1.4').toString('base64') } } });
  assert.equal(approval.status, 201, approval.raw);
  await h.sql.run(`UPDATE approval_requests SET due_at = ? WHERE id = ?`, new Date(Date.now() - 3600_000).toISOString(), approval.body.id);
  // Organization B has its own contract that must never show up for A's members.
  const bPartner = (await h.api('adminB', 'POST', '/api/partners', { org: 'org-b', body: { partner_name: 'B Partner', country: 'ID' } })).body.partner.partner_id;
  await h.api('adminB', 'POST', '/api/contracts', { org: 'org-b', body: { partner_id: bPartner, contract_number: 'B-SOON', contract_title: 'B soon', start_date: dateIn(today, -300), end_date: dateIn(today, 5), notice_period_days: 3, currency: 'USD', contract_value: 1 } });
});

const refs = (items: Array<{ reference: string }>) => items.map((i) => i.reference).sort();

test('a digest holds notice deadlines, expiring items, pending approvals and overdue items, limited to the member\'s scope', async () => {
  const { buildDigest } = await import('./digest');
  const admin = (await buildDigest(h.sql, 'org-a', 'adminA'))!;
  assert.deepEqual(refs(admin.sections.noticeDeadlines), ['L-SOON', 'S-NOTICE']);
  assert.deepEqual(refs(admin.sections.expiring), ['IO-SALES', 'L-SOON', 'S-OVERDUE']);
  const approvalRef = admin.sections.pendingApprovals[0].reference;
  assert.deepEqual(refs(admin.sections.pendingApprovals), [approvalRef], 'the approval adminA submitted');
  assert.deepEqual(refs(admin.sections.overdue), ['S-OVERDUE', approvalRef].sort(), 'a missed notice deadline and the approval past its SLA');
  assert.ok(!JSON.stringify(admin).includes('L-TERMINATED') && !JSON.stringify(admin).includes('S-FAR') && !JSON.stringify(admin).includes('B-SOON'));
  assert.deepEqual(admin.counts, { noticeDeadlines: 2, expiring: 3, pendingApprovals: 1, overdue: 2 });
  assert.equal(admin.empty, false);
  assert.equal(admin.sections.noticeDeadlines[0].date, dateIn(today, 5));
  assert.equal(admin.sections.noticeDeadlines[0].days, 5);

  const sales = (await buildDigest(h.sql, 'org-a', 'salesA'))!;
  assert.deepEqual(refs(sales.sections.noticeDeadlines), ['S-NOTICE'], 'only the Sales department');
  assert.deepEqual(refs(sales.sections.expiring), ['IO-SALES', 'S-OVERDUE']);
  assert.ok(sales.sections.pendingApprovals.length === 1 && sales.sections.overdue.some((i) => i.kind === 'approval'), 'the approval waiting for salesA');
  assert.ok(!JSON.stringify(sales).includes('L-SOON'));

  const legal = (await buildDigest(h.sql, 'org-a', 'legalA'))!;
  assert.deepEqual(refs(legal.sections.noticeDeadlines), ['L-SOON']);
  assert.deepEqual(refs(legal.sections.expiring), ['L-SOON']);
  assert.deepEqual(legal.counts.pendingApprovals + legal.counts.overdue, 0);

  const b = (await buildDigest(h.sql, 'org-b', 'adminB'))!;
  assert.deepEqual(refs(b.sections.expiring), ['B-SOON']);
  assert.equal(await buildDigest(h.sql, 'org-a', 'adminB'), null, 'a member of another organization has no digest here');
  assert.equal(await buildDigest(h.sql, 'org-a', 'nobody'), null);
});

/* ------------------------------ preferences, ledger, delivery ------------------------------ */

const ledger = (org = 'org-a') => h.sql.all(`SELECT user_id, frequency, period_key, status FROM digest_ledger WHERE organization_id = ? ORDER BY period_key, user_id`, org);

test('preferences: members choose for themselves, admins set the organization default', async () => {
  assert.deepEqual((await h.api('salesA', 'GET', '/api/organizations/org-a/digest/preferences')).body, { frequency: 'inherit', effective: 'off', defaults: { frequency: 'off', weekday: 1, hour: 8, effectiveFrom: null } });
  assert.equal((await h.api('salesA', 'PUT', '/api/organizations/org-a/digest/preferences', { body: { frequency: 'hourly' } })).status, 400);
  assert.equal((await h.api('salesA', 'PUT', '/api/organizations/org-a/digest/preferences', { body: { frequency: 'daily', userId: 'adminA' } })).status, 400);
  assert.equal((await h.api('adminB', 'GET', '/api/organizations/org-a/digest/preferences')).status, 404);
  const saved = await h.api('legalA', 'PUT', '/api/organizations/org-a/digest/preferences', { body: { frequency: 'weekly' } });
  assert.equal(saved.status, 200, saved.raw);
  assert.equal(saved.body.effective, 'weekly');
  assert.equal((await h.api('salesA', 'GET', '/api/organizations/org-a/digest/preferences')).body.frequency, 'inherit', 'another member is unaffected');
  assert.equal((await h.api('salesA', 'PUT', '/api/organizations/org-a/digest/defaults', { body: { frequency: 'daily' } })).status, 403);
  assert.equal((await h.api('adminB', 'PUT', '/api/organizations/org-a/digest/defaults', { body: { frequency: 'daily' } })).status, 404);
  for (const body of [{ frequency: 'monthly' }, { weekday: 0 }, { weekday: 8 }, { hour: 24 }, { hour: 1.5 }, { x: 1 }]) assert.equal((await h.api('adminA', 'PUT', '/api/organizations/org-a/digest/defaults', { body })).status, 400, JSON.stringify(body));
  const defaults = await h.api('adminA', 'PUT', '/api/organizations/org-a/digest/defaults', { body: { frequency: 'weekly', weekday: 1, hour: 8 } });
  assert.equal(defaults.status, 200, defaults.raw);
  assert.equal((await h.api('salesA', 'GET', '/api/organizations/org-a/digest/preferences')).body.effective, 'weekly', 'inherits the default');
  assert.ok(await h.sql.get(`SELECT 1 FROM audit_log WHERE action = 'digest.defaults.update' AND tenant_id = 'org-a'`));
  const preview = await h.api('salesA', 'GET', '/api/organizations/org-a/digest/preview');
  assert.equal(preview.status, 200, preview.raw);
  assert.deepEqual(refs(preview.body.sections.noticeDeadlines), ['S-NOTICE']);
  assert.equal((await h.api('adminB', 'GET', '/api/organizations/org-a/digest/preview')).status, 404);
});

test('each member gets one ledger row per period: scheduled time, opt-ins and opt-outs, idempotent and race-free', async () => {
  const { enqueueDueDigests, zonedInstant, periodOf } = await import('./digest');
  // adminA and salesA inherit weekly (Mon 08:00), legalA chose weekly itself; add a daily opt-in and an opt-out.
  await h.api('adminA', 'PUT', '/api/organizations/org-a/digest/preferences', { body: { frequency: 'daily' } });
  await h.api('salesA', 'PUT', '/api/organizations/org-a/digest/preferences', { body: { frequency: 'off' } });
  // Everything chosen so far took effect in the past of the instants below.
  const futureMonday = (() => { let d = new Date(`${today}T00:00:00Z`); do { d = new Date(d.getTime() + DAY); } while (d.getUTCDay() !== 1); d = new Date(d.getTime() + 7 * DAY); return d.toISOString().slice(0, 10); })();
  const scheduled = zonedInstant(futureMonday, 8, timeZone);
  assert.equal(await enqueueDueDigests(h.sql, new Date(scheduled - 60_000)), 0, 'before the send time');
  const first = await Promise.all([enqueueDueDigests(h.sql, new Date(scheduled + 60_000)), enqueueDueDigests(h.sql, new Date(scheduled + 61_000))]);
  assert.equal(first[0] + first[1], 2, 'adminA daily and legalA weekly, exactly once even with two passes at once');
  assert.deepEqual((await ledger()).map((r: any) => `${r.user_id}:${r.frequency}`).sort(), ['adminA:daily', 'legalA:weekly']);
  assert.equal(await enqueueDueDigests(h.sql, new Date(scheduled + 3600_000)), 0, 'a later pass in the same period adds nothing');
  const nextDay = new Date(scheduled + DAY + 3600_000);
  assert.equal(await enqueueDueDigests(h.sql, nextDay), 1, 'the daily digest has a new period, the weekly one does not');
  assert.equal(await enqueueDueDigests(h.sql, new Date(scheduled + 7 * DAY + 3600_000)), 2, 'the next week');
  assert.equal(periodOf('weekly', scheduled + 60_000, timeZone, 1, 8).key.startsWith('week-'), true);

  // A choice made after this period's send time waits for the next period.
  await h.sql.run(`UPDATE digest_preferences SET frequency = 'daily', effective_from = ? WHERE user_id = 'salesA'`, new Date(scheduled + 14 * DAY + 2 * 3600_000).toISOString());
  assert.equal(await enqueueDueDigests(h.sql, new Date(scheduled + 14 * DAY + 3 * 3600_000)), 2, 'adminA daily + legalA weekly, but not salesA (opted in after 08:00)');
  assert.equal(await enqueueDueDigests(h.sql, new Date(scheduled + 15 * DAY + 3600_000)), 2, 'salesA joins with the next day\'s period');
  await h.sql.run(`UPDATE digest_preferences SET frequency = 'off' WHERE user_id = 'salesA'`);
});

test('delivery: content mailed with a one-click unsubscribe, empty digests skipped, opt-outs honoured, once per period', async () => {
  const { deliverDigests, verifyUnsubscribeToken } = await import('./digest');
  await h.sql.exec(`DELETE FROM digest_ledger`);
  const { enqueueDueDigests, zonedInstant } = await import('./digest');
  const monday = (() => { let d = new Date(`${today}T00:00:00Z`); do { d = new Date(d.getTime() + DAY); } while (d.getUTCDay() !== 1); return d.toISOString().slice(0, 10); })();
  const at = new Date(zonedInstant(monday, 9, timeZone));
  clock = at;
  await h.sql.run(`UPDATE digest_defaults SET effective_from = ? WHERE organization_id = 'org-a'`, new Date(0).toISOString());
  await h.sql.run(`UPDATE digest_preferences SET frequency = 'weekly', effective_from = ? WHERE user_id IN ('adminA', 'legalA')`, new Date(0).toISOString());
  await h.sql.exec(`INSERT INTO digest_preferences (organization_id, user_id, frequency, effective_from, updated_at) VALUES ('org-a', 'salesA', 'inherit', '1970-01-01T00:00:00.000Z', now()::text) ON CONFLICT (organization_id, user_id) DO UPDATE SET frequency = 'inherit', effective_from = '1970-01-01T00:00:00.000Z'`);
  assert.equal(await enqueueDueDigests(h.sql, at), 3);
  mail.length = 0;
  const first = await deliverDigests(h.sql, deps());
  // salesA/legalA: their sections are non-empty relative to "now" = next Monday? Content depends on that date; check the mails that were produced.
  assert.equal(first.attempted, 3);
  assert.equal(first.sent + first.skipped, 3);
  assert.ok(first.sent >= 1);
  for (const m of mail) {
    assert.ok(m.headers?.['List-Unsubscribe']?.startsWith('<https://legalio.example/api/digest/unsubscribe?token='));
    assert.equal(m.headers?.['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.ok(m.html.includes('Unsubscribe from this digest') || m.html.includes('Berhenti') || m.html.includes('退订'));
    assert.doesNotMatch(m.html + m.subject, /{{/);
    const token = decodeURIComponent(/token=([^"<>&]+)/.exec(m.headers!['List-Unsubscribe'])![1]);
    assert.equal(verifyUnsubscribeToken(token)?.organizationId, 'org-a');
    assert.ok(!m.html.includes('B-SOON'), 'never another organization');
  }
  const again = await deliverDigests(h.sql, deps());
  assert.equal(again.attempted, 0, 'each ledger row is delivered once');
  clock = null;
});

test('delivery details: only the member\'s scope in the mail, opt-out between queue and send, no relay, retries', async () => {
  const { deliverDigests, enqueueDueDigests, zonedInstant } = await import('./digest');
  await h.sql.exec(`DELETE FROM digest_ledger; DELETE FROM digest_preferences;`);
  await h.sql.run(`UPDATE digest_defaults SET frequency = 'daily', effective_from = '1970-01-01T00:00:00.000Z' WHERE organization_id = 'org-a'`);
  const at = new Date(zonedInstant(today, 8, timeZone) + 3 * 3600_000);
  clock = at;
  assert.equal(await enqueueDueDigests(h.sql, at), 3);
  // legalA opts out after the row was written.
  await h.api('legalA', 'PUT', '/api/organizations/org-a/digest/preferences', { body: { frequency: 'off' } });
  mail.length = 0;
  const result = await deliverDigests(h.sql, deps());
  assert.equal(result.sent, 2);
  assert.equal(result.skipped, 1);
  assert.equal((await h.sql.get(`SELECT last_error FROM digest_ledger WHERE user_id = 'legalA'`)).last_error, 'The member no longer receives this digest');
  const toSales = mail.find((m) => m.to === 'salesa@example.com')!;
  assert.ok(toSales.html.includes('S-NOTICE') && toSales.html.includes('IO-SALES'));
  assert.ok(!toSales.html.includes('L-SOON'), 'the Sales member does not see Legal contracts');
  assert.match(toSales.subject, /^\[Daily digest\]/);
  const toAdmin = mail.find((m) => m.to === 'admina@example.com')!;
  assert.ok(toAdmin.html.includes('L-SOON') && toAdmin.html.includes('S-NOTICE') && toAdmin.html.includes('Digest approval'));
  assert.ok(!toAdmin.html.includes('B-SOON'));

  // Failure, backoff and dead letter; and no relay.
  await h.sql.exec(`DELETE FROM digest_ledger`);
  clock = new Date(at.getTime() + DAY);
  await enqueueDueDigests(h.sql, clock);
  failing = true;
  const failed = await deliverDigests(h.sql, deps(), { maxAttempts: 2 });
  assert.ok(failed.failed >= 1);
  clock = new Date(clock.getTime() + 6 * 3600_000);
  const dead = await deliverDigests(h.sql, deps(), { maxAttempts: 2 });
  assert.ok(dead.dead >= 1);
  failing = false;
  await h.sql.exec(`DELETE FROM digest_ledger`);
  smtp = false;
  clock = new Date(at.getTime() + 2 * DAY);
  await enqueueDueDigests(h.sql, clock);
  const quiet = await deliverDigests(h.sql, deps());
  assert.ok(quiet.skipped >= 1 && quiet.sent === 0);
  smtp = true;
  clock = null;
});

test('one-click unsubscribe works without signing in and only for the member in the token', async () => {
  const { signUnsubscribeToken } = await import('./digest');
  await h.api('salesA', 'PUT', '/api/organizations/org-a/digest/preferences', { body: { frequency: 'weekly' } });
  const token = signUnsubscribeToken('org-a', 'salesA');
  const page = await fetch(`${h.base}/api/digest/unsubscribe?token=${encodeURIComponent(token)}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await page.text(), /no longer receive/);
  assert.equal((await h.api('salesA', 'GET', '/api/organizations/org-a/digest/preferences')).body.frequency, 'off');
  assert.equal((await h.api('adminA', 'GET', '/api/organizations/org-a/digest/preferences')).body.frequency, 'inherit', 'other members are untouched');
  // RFC 8058 style POST, idempotent.
  await h.api('salesA', 'PUT', '/api/organizations/org-a/digest/preferences', { body: { frequency: 'daily' } });
  const post = await fetch(`${h.base}/api/digest/unsubscribe?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
  assert.equal(post.status, 200);
  assert.equal((await h.api('salesA', 'GET', '/api/organizations/org-a/digest/preferences')).body.frequency, 'off');
  for (const bad of ['', 'garbage', `${token}x`, signUnsubscribeToken('org-b', 'salesA')]) {
    const res = await fetch(`${h.base}/api/digest/unsubscribe?token=${encodeURIComponent(bad)}`);
    assert.equal(res.status, 400, bad.slice(0, 20));
  }
  assert.equal((await fetch(`${h.base}/api/digest/unsubscribe`, { method: 'POST' })).status, 400);
});
