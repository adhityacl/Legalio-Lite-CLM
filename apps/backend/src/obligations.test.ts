import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { bootApp, type Harness } from './testHarness';

let h: Harness;
let today = '';
let day: (offset: number) => string;
const ids: Record<string, string> = {};
const orgOf = (user: string) => (user.endsWith('B') ? 'org-b' : 'org-a');
const api = (user: string, method: string, route: string, init: { org?: string; body?: unknown } = {}) => h.api(user, method, route, { org: orgOf(user), ...init });

before(async () => {
  h = await bootApp({
    tag: 'obligations', orgs: [{ id: 'org-a', name: 'Org A' }, { id: 'org-b', name: 'Org B' }],
    users: [
      ['adminA', 'org-a', 'admin'], ['editorA', 'org-a', 'editor'], ['viewerA', 'org-a', 'viewer'],
      ['legalA', 'org-a', 'editor', 'Legal'], ['financeA', 'org-a', 'editor', 'Finance'], ['adminB', 'org-b', 'admin'],
    ],
  });
  const { organizationToday } = await import('./routes/obligations');
  const { addDays } = await import('@legalio/shared/obligations');
  today = organizationToday('org-a');
  day = (offset) => addDays(today, offset);
  // A partner and a contract per department, plus an organization-wide partner in org B.
  for (const [key, org, user, dept] of [['legal', 'org-a', 'adminA', 'Legal'], ['finance', 'org-a', 'adminA', 'Finance'], ['b', 'org-b', 'adminB', 'Legal']] as const) {
    const partner = await api(user, 'POST', '/api/partners', { body: { partner_name: `Partner ${key}`, internal_pic: dept, country: 'ID' } });
    assert.ok([200, 201].includes(partner.status), partner.raw);
    ids[`partner-${key}`] = partner.body.partner.partner_id;
    const contract = await api(user, 'POST', '/api/contracts', { body: { partner_id: ids[`partner-${key}`], contract_number: `OBL-${key}`, contract_title: `Contract ${key}`, start_date: '2026-01-01', end_date: '2099-12-31', currency: 'USD', contract_value: 10 } });
    assert.ok([200, 201].includes(contract.status), contract.raw);
    ids[`contract-${key}`] = contract.body.contract.contract_id;
  }
});
after(() => h?.close());

const create = (user: string, body: Record<string, unknown>) => api(user, 'POST', '/api/obligations', { body });

test('create, read, update with version checks and mass-assignment protection', async () => {
  const created = await create('adminA', { title: 'Pay milestone 1', type: 'payment', due_date: day(10), contract_id: ids['contract-legal'], status: 'open',
    version: 99, id: 'forged', organization_id: 'org-b', source: 'ai_extracted', source_quote: 'forged', confirmed_by: 'forged', completions: 7, last_due_soon_cycle: 'x' });
  assert.equal(created.status, 201, created.raw);
  const o = created.body.obligation;
  assert.match(o.id, /^obl-/);
  assert.equal(o.version, 1);
  assert.equal(o.organizationId, 'org-a');
  assert.equal(o.source, 'manual', 'provenance cannot be set by a client');
  assert.equal(o.source_quote, null);
  assert.equal(o.completions, 0);
  assert.equal(o.contract_number, 'OBL-legal');
  assert.equal(o.days_until, 10);
  ids.o1 = o.id;

  const fetched = await api('adminA', 'GET', `/api/obligations/${o.id}`);
  assert.equal(fetched.body.title, 'Pay milestone 1');

  const updated = await api('adminA', 'PUT', `/api/obligations/${o.id}`, { body: { title: 'Pay milestone 1 (revised)', due_date: day(12), version: 1 } });
  assert.equal(updated.status, 200, updated.raw);
  assert.equal(updated.body.obligation.version, 2);
  // A stale write is a conflict, not a silent overwrite.
  const stale = await api('adminA', 'PUT', `/api/obligations/${o.id}`, { body: { title: 'stale', version: 1 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'VERSION_CONFLICT');
  assert.equal((await api('adminA', 'GET', `/api/obligations/${o.id}`)).body.title, 'Pay milestone 1 (revised)');
  // Concurrent writers with the same version: exactly one wins.
  const race = await Promise.all([1, 2, 3].map((n) => api('adminA', 'PUT', `/api/obligations/${o.id}`, { body: { description: `racer ${n}`, version: 2 } })));
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409, 409]);
});

test('validation: dates, recurrence rules, links and the responsible person', async () => {
  const bad = async (body: Record<string, unknown>, label: string) => assert.equal((await create('adminA', { title: 'x', ...body })).status, 400, label);
  await bad({ title: '' }, 'empty title');
  await bad({ due_date: '2026-02-30' }, 'impossible date');
  await bad({ due_date: 'tomorrow' }, 'not a date');
  await bad({ type: 'nonsense' }, 'unknown type');
  await bad({ recurrence: 'monthly' }, 'recurring without a due date');
  await bad({ recurrence: 'every_n_days', due_date: day(1) }, 'every N days without N');
  await bad({ recurrence: 'monthly', due_date: day(5), recurrence_until: day(1) }, 'until before the due date');
  await bad({ contract_id: 'C-does-not-exist' }, 'unknown contract');
  await bad({ contract_id: ids['contract-b'] }, 'a contract of another organization');
  await bad({ partner_id: ids['partner-b'] }, 'a partner of another organization');
  await bad({ responsible_user_id: 'adminB' }, 'a member of another organization');
  await bad({ responsible_user_id: 'nobody' }, 'unknown user');
  const ok = await create('adminA', { title: 'Quarterly report', type: 'reporting', due_date: day(30), recurrence: 'quarterly', responsible_user_id: 'editorA', responsible_department: 'Legal' });
  assert.equal(ok.status, 201, ok.raw);
  assert.equal(ok.body.obligation.responsible_name, 'editorA');
  assert.equal(ok.body.obligation.recurrence_interval, null);
});

test('viewers read but cannot write; unknown bodies are not accepted silently', async () => {
  assert.equal((await api('viewerA', 'GET', '/api/obligations')).status, 200);
  assert.equal((await create('viewerA', { title: 'nope' })).status, 403);
  assert.equal((await api('viewerA', 'PUT', `/api/obligations/${ids.o1}`, { body: { title: 'nope' } })).status, 403);
  assert.equal((await api('viewerA', 'DELETE', `/api/obligations/${ids.o1}`)).status, 403);
  assert.equal((await api('viewerA', 'POST', `/api/obligations/${ids.o1}/complete`, { body: {} })).status, 403);
  assert.equal((await api('viewerA', 'GET', '/api/obligations/assignees')).status, 403);
  assert.equal((await api('editorA', 'GET', '/api/obligations/assignees')).status, 200);
});

test('list: paging, filters, derived overdue status and sort', async () => {
  await create('adminA', { title: 'Late filing', type: 'compliance', due_date: day(-3), contract_id: ids['contract-legal'] });
  await create('adminA', { title: 'Undated duty', type: 'other' });
  await create('adminA', { title: 'Finished thing', type: 'delivery', due_date: day(-9), status: 'done' });
  const all = await api('adminA', 'GET', '/api/obligations?limit=100');
  assert.equal(all.status, 200);
  assert.equal(Number(all.headers.get('x-total-count')), all.body.length);
  const late = all.body.find((r: any) => r.title === 'Late filing');
  assert.equal(late.status, 'overdue');
  assert.equal(late.stored_status, 'open');
  assert.equal(all.body.find((r: any) => r.title === 'Finished thing').status, 'done', 'done work is never overdue');
  // Rows without a due date come last.
  assert.equal(all.body[all.body.length - 1].due_date, null);

  const overdue = await api('adminA', 'GET', '/api/obligations?status=overdue');
  assert.deepEqual(overdue.body.map((r: any) => r.title), ['Late filing']);
  const open = await api('adminA', 'GET', '/api/obligations?status=open');
  assert.ok(open.body.every((r: any) => r.status === 'open'), 'open excludes the overdue ones');
  assert.ok(!open.body.some((r: any) => r.title === 'Late filing'));
  assert.equal((await api('adminA', 'GET', '/api/obligations?type=compliance')).body.length, 1);
  assert.equal((await api('adminA', 'GET', `/api/obligations?contract_id=${ids['contract-legal']}`)).body.length, 2);
  assert.equal((await api('adminA', 'GET', '/api/obligations?q=filing')).body.length, 1);
  assert.equal((await api('adminA', 'GET', '/api/obligations?q=OBL-legal')).body.length, 2, 'search covers the contract number');
  assert.equal((await api('adminA', 'GET', `/api/obligations?due_from=${day(-5)}&due_to=${day(0)}`)).body.length, 1);
  assert.equal((await api('adminA', 'GET', '/api/obligations?responsible=me')).body.length, 0);
  assert.ok((await api('editorA', 'GET', '/api/obligations?responsible=me')).body.some((r: any) => r.title === 'Quarterly report'));

  const page1 = await api('adminA', 'GET', '/api/obligations?limit=2&offset=0&sort=title&dir=asc');
  const page2 = await api('adminA', 'GET', '/api/obligations?limit=2&offset=2&sort=title&dir=asc');
  assert.equal(page1.body.length, 2);
  assert.equal(Number(page1.headers.get('x-total-count')), all.body.length);
  assert.ok(page1.body[1].title.toLowerCase() < page2.body[0].title.toLowerCase());
  assert.equal((await api('adminA', 'GET', '/api/obligations?sort=password;drop')).status, 200, 'unknown sorts fall back');
});

test('the person responsible always sees (and can complete) their own obligation, whatever department owns the record', async () => {
  const mine = (await create('adminA', { title: 'Assigned to the editor', due_date: day(8), responsible_user_id: 'editorA', contract_id: ids['contract-finance'] })).body.obligation;
  const seen = await api('editorA', 'GET', `/api/obligations/${mine.id}`);
  assert.equal(seen.status, 200, 'editorA has no department, but is responsible');
  assert.equal((await api('editorA', 'PUT', `/api/obligations/${mine.id}`, { body: { title: 'edit', version: mine.version } })).status, 403, 'editing still needs the department');
  const done = await api('editorA', 'POST', `/api/obligations/${mine.id}/complete`, { body: {} });
  assert.equal(done.status, 200, done.raw);
  assert.equal(done.body.obligation.status, 'done');
  assert.equal((await api('financeA', 'GET', '/api/obligations?limit=500')).body.some((r: any) => r.id === mine.id), true, 'and the owning department sees it as well');
});

test('summary is a SQL aggregate of open work', async () => {
  const summary = await api('adminA', 'GET', '/api/obligations/summary');
  assert.equal(summary.status, 200, summary.raw);
  assert.equal(summary.body.today, today);
  assert.equal(summary.body.overdue, 1);
  assert.equal(summary.body.withoutDate, 1);
  assert.equal(summary.body.dueThisWeek, 0);
  await create('adminA', { title: 'Due in three days', due_date: day(3) });
  await create('adminA', { title: 'Due today', due_date: day(0), status: 'in_progress' });
  const again = (await api('adminA', 'GET', '/api/obligations/summary')).body;
  assert.deepEqual([again.dueThisWeek, again.dueToday, again.overdue], [2, 1, 1]);
});

test('recurring obligations roll forward on completion; one-off ones close; webhooks are queued', async () => {
  const { createEndpoint } = await import('./webhooks');
  await createEndpoint(h.sql, 'org-a', null, { url: 'http://127.0.0.1:9/hook', eventTypes: ['obligation.created', 'obligation.completed'] }, { allowHttp: true, allowPrivateNetworks: true });
  const monthly = (await create('adminA', { title: 'Monthly SLA report', type: 'reporting', due_date: day(2), recurrence: 'monthly' })).body.obligation;
  const done = await api('adminA', 'POST', `/api/obligations/${monthly.id}/complete`, { body: {} });
  assert.equal(done.status, 200, done.raw);
  assert.equal(done.body.obligation.status, 'open', 'a recurring obligation is open again for the next occurrence');
  assert.ok(done.body.obligation.due_date > day(27), `rolled to ${done.body.obligation.due_date}`);
  assert.equal(done.body.obligation.completions, 1);
  assert.ok(done.body.obligation.completed_at);
  assert.equal(done.body.obligation.version, 2);

  const once = (await create('adminA', { title: 'One-off delivery', type: 'delivery', due_date: day(2) })).body.obligation;
  const closed = await api('adminA', 'POST', `/api/obligations/${once.id}/complete`, { body: {} });
  assert.equal(closed.body.obligation.status, 'done');
  assert.equal(closed.body.obligation.due_date, day(2));
  assert.equal((await api('adminA', 'POST', `/api/obligations/${once.id}/complete`, { body: {} })).status, 409, 'already closed');

  // An editor that marks done through a normal edit gets the same roll-forward.
  const yearly = (await create('adminA', { title: 'Annual audit', type: 'compliance', due_date: day(1), recurrence: 'yearly', recurrence_until: day(100) })).body.obligation;
  const viaEdit = await api('adminA', 'PUT', `/api/obligations/${yearly.id}`, { body: { status: 'done', version: yearly.version } });
  assert.equal(viaEdit.body.obligation.status, 'done', 'the rule ended (until), so it stays done');
  assert.equal(viaEdit.body.obligation.completions, 1);

  // A stale version on the complete shortcut is a conflict.
  const stale = (await create('adminA', { title: 'Stale completion', due_date: day(4) })).body.obligation;
  await api('adminA', 'PUT', `/api/obligations/${stale.id}`, { body: { description: 'edited', version: 1 } });
  assert.equal((await api('adminA', 'POST', `/api/obligations/${stale.id}/complete`, { body: { version: 1 } })).status, 409);

  const events = await h.sql.all(`SELECT event_type, payload FROM webhook_deliveries WHERE organization_id = 'org-a' ORDER BY created_at`);
  const types = events.map((e: any) => e.event_type);
  assert.ok(types.includes('obligation.created') && types.includes('obligation.completed'), types.join(','));
  const completed = events.find((e: any) => e.event_type === 'obligation.completed' && JSON.parse(e.payload).data.obligation.title === 'Monthly SLA report');
  assert.ok(JSON.parse(completed.payload).data.nextDueDate, 'the event reports the next occurrence');
  const activity = await h.sql.all(`SELECT action_type FROM activity_logs WHERE organization_id = 'org-a' AND module = 'OBLIGATIONS'`);
  assert.ok(activity.some((a: any) => a.action_type === 'OBLIGATION_CREATE') && activity.some((a: any) => a.action_type === 'OBLIGATION_COMPLETE'));
});

test('tenant isolation: another organization can neither see, change nor delete obligations', async () => {
  assert.equal((await api('adminB', 'GET', `/api/obligations/${ids.o1}`)).status, 404);
  assert.equal((await api('adminB', 'PUT', `/api/obligations/${ids.o1}`, { body: { title: 'hijack', version: 1 } })).status, 404);
  assert.equal((await api('adminB', 'POST', `/api/obligations/${ids.o1}/complete`, { body: {} })).status, 404);
  assert.equal((await api('adminB', 'DELETE', `/api/obligations/${ids.o1}`)).status, 404);
  assert.deepEqual((await api('adminB', 'GET', '/api/obligations')).body, []);
  assert.deepEqual(await api('adminB', 'GET', '/api/obligations/summary').then((r) => [r.body.overdue, r.body.open]), [0, 0]);
  const mine = await create('adminB', { title: 'Org B duty', due_date: day(5), contract_id: ids['contract-b'] });
  assert.equal(mine.status, 201, mine.raw);
  assert.equal((await api('adminA', 'GET', `/api/obligations/${mine.body.obligation.id}`)).status, 404);
  assert.ok(!(await api('adminA', 'GET', '/api/obligations?limit=500')).raw.includes('Org B duty'));
  // A header naming the other organization does not widen a session's reach.
  assert.equal((await api('adminB', 'GET', '/api/obligations', { org: 'org-a' })).status, 404, 'not a member of that organization');
  assert.equal((await h.sql.get<any>(`SELECT organization_id FROM obligations WHERE id = ?`, ids.o1)).organization_id, 'org-a');
});

test('department roles only see and write obligations of records their department owns', async () => {
  const legal = (await create('adminA', { title: 'Legal-only duty', due_date: day(6), contract_id: ids['contract-legal'] })).body.obligation;
  const finance = (await create('adminA', { title: 'Finance-only duty', due_date: day(6), contract_id: ids['contract-finance'] })).body.obligation;
  const unattached = (await create('adminA', { title: 'Organization-wide duty', due_date: day(6) })).body.obligation;
  const viaPartner = (await create('adminA', { title: 'Finance partner duty', due_date: day(6), partner_id: ids['partner-finance'] })).body.obligation;
  const byDepartment = (await create('adminA', { title: 'Legal department duty', due_date: day(6), responsible_department: 'Legal' })).body.obligation;

  const titles = async (user: string, query = '') => (await api(user, 'GET', `/api/obligations?limit=500${query}`)).body.map((r: any) => r.title);
  const legalSees = await titles('legalA');
  assert.ok(legalSees.includes('Legal-only duty') && legalSees.includes('Legal department duty'));
  for (const hidden of ['Finance-only duty', 'Finance partner duty', 'Organization-wide duty', 'Org B duty']) {
    assert.ok(!legalSees.includes(hidden), `legal must not see ${hidden}`);
  }
  const financeSees = await titles('financeA');
  assert.ok(financeSees.includes('Finance-only duty') && financeSees.includes('Finance partner duty'));
  assert.ok(!financeSees.includes('Legal-only duty') && !financeSees.includes('Organization-wide duty'));
  // Paging counts only what the caller may see.
  const paged = await api('legalA', 'GET', '/api/obligations?limit=1&offset=0');
  assert.equal(Number(paged.headers.get('x-total-count')), legalSees.length);

  assert.equal((await api('legalA', 'GET', `/api/obligations/${finance.id}`)).status, 404);
  assert.equal((await api('legalA', 'GET', `/api/obligations/${unattached.id}`)).status, 404);
  assert.equal((await api('legalA', 'PUT', `/api/obligations/${finance.id}`, { body: { title: 'x', version: 1 } })).status, 404);
  assert.equal((await api('legalA', 'DELETE', `/api/obligations/${viaPartner.id}`)).status, 404);
  assert.equal((await api('legalA', 'POST', `/api/obligations/${finance.id}/complete`, { body: {} })).status, 404);
  assert.equal((await create('legalA', { title: 'Into Finance', contract_id: ids['contract-finance'] })).status, 403, 'cannot place an obligation outside the department');
  assert.equal((await create('legalA', { title: 'Organization-wide by Legal' })).status, 403, 'an unattached obligation is organization-wide');
  assert.equal((await create('legalA', { title: 'Mine', contract_id: ids['contract-legal'] })).status, 201);
  // Moving one out of the department is refused too.
  assert.equal((await api('legalA', 'PUT', `/api/obligations/${legal.id}`, { body: { contract_id: ids['contract-finance'], version: 1 } })).status, 403);

  // The dashboard figures follow the same scope.
  const orgTotal = (await api('adminA', 'GET', '/api/obligations/summary')).body.open;
  const legalTotal = (await api('legalA', 'GET', '/api/obligations/summary')).body.open;
  const financeTotal = (await api('financeA', 'GET', '/api/obligations/summary')).body.open;
  assert.ok(legalTotal > 0 && financeTotal > 0 && legalTotal < orgTotal && financeTotal < orgTotal && legalTotal + financeTotal < orgTotal);
  assert.equal(byDepartment.responsible_department, 'Legal');
});

test('deleting a contract removes its obligations; the foreign key keeps tenants apart', async () => {
  const contract = await api('adminA', 'POST', '/api/contracts', { body: { partner_id: ids['partner-legal'], contract_number: 'OBL-temp', contract_title: 'Temp', start_date: '2026-01-01', end_date: '2099-12-31', currency: 'USD', contract_value: 1 } });
  const id = contract.body.contract.contract_id;
  const o = (await create('adminA', { title: 'Goes with the contract', contract_id: id })).body.obligation;
  assert.equal((await api('adminA', 'DELETE', `/api/contracts/${id}`)).status, 200);
  assert.equal((await api('adminA', 'GET', `/api/obligations/${o.id}`)).status, 404);
  assert.equal((await api('adminA', 'DELETE', `/api/obligations/${ids.o1}`)).status, 200);
  assert.equal((await api('adminA', 'DELETE', `/api/obligations/${ids.o1}`)).status, 404);
});

test('settings: the reminder lead time is configurable by admins', async () => {
  assert.equal((await api('editorA', 'GET', '/api/obligations/settings')).body.leadDays, 7);
  assert.equal((await api('editorA', 'PUT', '/api/obligations/settings', { body: { leadDays: 3 } })).status, 403);
  assert.equal((await api('adminA', 'PUT', '/api/obligations/settings', { body: { leadDays: 400 } })).status, 400);
  assert.equal((await api('adminA', 'PUT', '/api/obligations/settings', { body: { leadDays: 3 } })).status, 200);
  assert.deepEqual((await api('editorA', 'GET', '/api/obligations/settings')).body, { leadDays: 3, configured: true });
  assert.equal((await api('adminB', 'GET', '/api/obligations/settings')).body.leadDays, 7, 'per organization');
  await api('adminA', 'PUT', '/api/obligations/settings', { body: { leadDays: 7 } });
});

test('public API: read-only obligations with their own scope, tenant isolated', async () => {
  const key = async (user: string, org: string, scopes: string[]) => (await api(user, 'POST', `/api/organizations/${org}/api-keys`, { body: { name: `k-${scopes.join('-')}-${org}`, scopes } })).body.secret as string;
  const v1 = (secret: string, method: string, route: string, body?: unknown) => h.request(method, `/api/v1${route}`, { body, headers: { authorization: `Bearer ${secret}` } });
  const readKey = await key('adminA', 'org-a', ['obligations:read']);
  const contractsOnly = await key('adminA', 'org-a', ['contracts:read']);
  const list = await v1(readKey, 'GET', '/obligations?limit=5&sort=due_date');
  assert.equal(list.status, 200, list.raw);
  assert.ok(list.body.total >= 5 && list.body.data.length === 5 && list.body.limit === 5);
  assert.ok(list.body.data.every((r: any) => r.organizationId === 'org-a'));
  const one = await v1(readKey, 'GET', `/obligations/${list.body.data[0].id}`);
  assert.equal(one.status, 200, one.raw);
  assert.equal(one.body.data.id, list.body.data[0].id);
  assert.equal(one.body.data.status, list.body.data[0].status);
  assert.equal((await v1(contractsOnly, 'GET', '/obligations')).status, 403);
  assert.equal((await v1(readKey, 'POST', '/obligations', { title: 'x' })).status, 404, 'no write operation exists');
  assert.equal((await v1(readKey, 'GET', '/contracts')).status, 403);
  const keyB = await key('adminB', 'org-b', ['obligations:read']);
  assert.equal((await v1(keyB, 'GET', `/obligations/${list.body.data[0].id}`)).status, 404);
  assert.ok((await v1(keyB, 'GET', '/obligations')).body.data.every((r: any) => r.organizationId === 'org-b'));
  const filtered = await v1(readKey, 'GET', '/obligations?status=overdue');
  assert.ok(filtered.body.data.every((r: any) => r.status === 'overdue'));
});

test('scheduler: due-soon and overdue events are raised once per due date, with notices to the responsible person', async () => {
  const { runObligationPass, deliverObligationNotices } = await import('./obligationJobs');
  const { createEndpoint } = await import('./webhooks');
  await h.sql.run(`DELETE FROM webhook_deliveries`);
  await h.sql.run(`DELETE FROM webhook_endpoints`);
  await createEndpoint(h.sql, 'org-a', null, { url: 'http://127.0.0.1:9/hook', eventTypes: [] }, { allowHttp: true, allowPrivateNetworks: true });
  await h.sql.run(`DELETE FROM obligations`);
  await h.sql.run(`DELETE FROM user_notifications`);
  const soon = (await create('adminA', { title: 'Soon duty', due_date: day(5), responsible_user_id: 'editorA' })).body.obligation;
  const far = (await create('adminA', { title: 'Far duty', due_date: day(40), responsible_user_id: 'editorA' })).body.obligation;
  const custom = (await create('adminA', { title: 'Custom lead duty', due_date: day(40), responsible_user_id: 'editorA', lead_days: 60 })).body.obligation;
  const late = (await create('adminA', { title: 'Late duty', due_date: day(-2) })).body.obligation; // nobody assigned: admins hear about it
  const closed = (await create('adminA', { title: 'Closed duty', due_date: day(-2), status: 'done', responsible_user_id: 'editorA' })).body.obligation;
  assert.ok(far && closed);

  const first = await runObligationPass(h.sql);
  assert.deepEqual([first.dueSoon, first.overdue], [2, 1]);
  const again = await runObligationPass(h.sql);
  assert.deepEqual([again.dueSoon, again.overdue, again.notices], [0, 0, 0], 'idempotent');

  const notices = await h.sql.all(`SELECT obligation_id, kind, recipient_id FROM obligation_notices ORDER BY kind, recipient_id`);
  const forSoon = notices.filter((n: any) => n.obligation_id === soon.id);
  assert.deepEqual(forSoon.map((n: any) => [n.kind, n.recipient_id]), [['due_soon', 'editorA']]);
  assert.deepEqual(notices.filter((n: any) => n.obligation_id === custom.id).map((n: any) => n.kind), ['due_soon'], 'its own lead time applies');
  assert.equal(notices.some((n: any) => n.obligation_id === far.id), false);
  assert.equal(notices.some((n: any) => n.obligation_id === closed.id), false, 'closed work is not reminded');
  const lateRecipients = notices.filter((n: any) => n.obligation_id === late.id).map((n: any) => n.recipient_id);
  assert.deepEqual(lateRecipients, ['adminA'], 'unassigned: the organization admins (and managers)');
  const inApp = await h.sql.all(`SELECT user_id, kind, link FROM user_notifications ORDER BY kind, user_id`);
  assert.ok(inApp.some((n: any) => n.user_id === 'editorA' && n.kind === 'obligation.due_soon' && n.link === `?tab=obligations&id=${soon.id}`));

  const events = (await h.sql.all(`SELECT event_type, payload FROM webhook_deliveries ORDER BY event_type`)).filter((e: any) => /due_soon|overdue/.test(e.event_type));
  assert.deepEqual(events.map((e: any) => e.event_type).sort(), ['obligation.due_soon', 'obligation.due_soon', 'obligation.overdue']);
  assert.equal(JSON.parse(events.find((e: any) => e.event_type === 'obligation.overdue').payload).data.daysUntilDue, -2);

  // Changing the due date starts a new cycle with fresh reminders.
  await api('adminA', 'PUT', `/api/obligations/${soon.id}`, { body: { due_date: day(3), version: 1 } });
  const resched = await runObligationPass(h.sql);
  assert.equal(resched.dueSoon, 1);
  // The organization's lead time applies to obligations without their own.
  await api('adminA', 'PUT', '/api/obligations/settings', { body: { leadDays: 45 } });
  assert.equal((await runObligationPass(h.sql)).dueSoon, 1, 'the far duty is within 45 days now');
  await api('adminA', 'PUT', '/api/obligations/settings', { body: { leadDays: 7 } });

  // Delivery: one e-mail per notice, nothing for a notice whose obligation was completed meanwhile, retries and dead letters.
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  let fail = false;
  const deps = {
    smtpAvailable: () => true, publicUrl: () => 'https://legalio.example',
    send: async (mail: { to: string; subject: string; html: string }) => { if (fail) return { success: false, error: 'relay down' }; sent.push(mail); return { success: true }; },
    render: async (_id: 'obligation-reminder', values: Record<string, string>) => ({ subject: values.subject, html: `${values.heading}|${values.intro}|${values.details}|${values.actionUrl}` }),
  };
  await api('adminA', 'POST', `/api/obligations/${custom.id}/complete`, { body: {} });
  const delivery = await deliverObligationNotices(h.sql, deps);
  assert.ok(delivery.sent >= 3, JSON.stringify(delivery));
  assert.ok(delivery.skipped >= 1, 'the completed obligation\'s notice is skipped');
  assert.ok(sent.every((m) => m.html.includes('https://legalio.example/app?tab=obligations&id=')));
  assert.ok(sent.some((m) => m.to === 'editora@example.com' && m.subject.includes('Soon duty')));
  assert.ok(sent.some((m) => m.to === 'admina@example.com' && m.subject.startsWith('[Overdue]')));
  assert.ok(!sent.some((m) => m.subject.includes('Custom lead duty')));
  assert.equal((await deliverObligationNotices(h.sql, deps)).attempted, 0, 'nothing is sent twice');

  await h.sql.run(`DELETE FROM obligation_notices`);
  await h.sql.run(`UPDATE obligations SET last_due_soon_cycle = NULL, last_overdue_cycle = NULL`);
  await runObligationPass(h.sql);
  fail = true;
  const failed = await deliverObligationNotices(h.sql, deps, { maxAttempts: 2 });
  assert.ok(failed.failed > 0 && failed.dead === 0);
  await h.sql.run(`UPDATE obligation_notices SET next_attempt_at = NULL WHERE status = 'failed'`);
  const dead = await deliverObligationNotices(h.sql, deps, { maxAttempts: 2 });
  assert.ok(dead.dead > 0);
  assert.equal((await h.sql.get<any>(`SELECT COUNT(*)::int AS n FROM obligation_notices WHERE status = 'dead'`)).n, dead.dead);
});
