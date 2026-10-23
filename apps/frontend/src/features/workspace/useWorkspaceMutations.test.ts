/**
 * The record mutations as the application wires them: the real hook (rendered once on the server to obtain its functions), the real
 * query client, the real API layer, and a stubbed fetch. Covers optimistic update, rollback, refresh, and what goes on the wire.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWorkspaceMutations } from './useWorkspaceMutations';
import { workspaceQueryKey, normalizeWorkspace } from './useWorkspaceData';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const KEY = workspaceQueryKey('user-1', 'org-1');
const contract = (id: string, extra: Record<string, unknown> = {}) => ({ contract_id: id, contract_number: `N-${id}`, contract_title: `T-${id}`, partner_id: 'P1', version: 1, ...extra });

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  queryClient.setQueryData(KEY, normalizeWorkspace({
    organizationId: 'org-1', contracts: [contract('C1'), contract('C2')] as any, partners: [{ partner_id: 'P1', partner_name: 'Acme' }] as any,
    ios: [{ io_id: 'IO1', partner_id: 'P1', contract_id: 'C1' }] as any,
  }));
  let actions!: ReturnType<typeof useWorkspaceMutations>;
  const Probe = () => { actions = useWorkspaceMutations(KEY); return null; };
  renderToString(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)));
  const cached = () => queryClient.getQueryData<any>(KEY);
  return { queryClient, actions, cached };
}

type Wire = { url: string; method: string; body: any };
function stubFetch(respond: (wire: Wire) => Promise<Response> | Response) {
  const wire: Wire[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const call = { url: String(url), method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : undefined };
    wire.push(call);
    return respond(call);
  }) as typeof fetch;
  return wire;
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const fail = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const gate = () => { let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; }); return { wait, release }; };

test('editing a contract updates the cache at once, sends the version and no actor, and keeps the server answer after the refresh', async () => {
  const { actions, cached, queryClient } = setup();
  const hold = gate();
  const wire = stubFetch(async () => { await hold.wait; return ok({ success: true, contract: contract('C1', { contract_title: 'Edited', version: 2 }) }); });
  const pending = actions.saveContract({ contract_title: 'Edited' }, contract('C1') as any);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(cached().contracts.find((c: any) => c.contract_id === 'C1').contract_title, 'Edited', 'optimistic: visible before the server answers');
  hold.release();
  await pending;
  assert.equal(wire.length, 1);
  assert.equal(wire[0].method, 'PUT');
  assert.equal(wire[0].url, '/api/contracts/C1');
  assert.deepEqual(wire[0].body, { contract_title: 'Edited', version: 1 });
  assert.ok(!('userEmail' in wire[0].body) && !('userName' in wire[0].body) && !('userRole' in wire[0].body));
  assert.ok(queryClient.getQueryState(KEY)?.isInvalidated, 'the snapshot is marked for refresh once the mutation settles');
});

test('a failed edit rolls the cache back, and a version conflict surfaces as the ApiError', async () => {
  const { actions, cached } = setup();
  stubFetch(() => fail(409, { error: 'changed', code: 'VERSION_CONFLICT', message: 'changed', status: 409, requestId: 'r1' }));
  await assert.rejects(actions.saveContract({ contract_title: 'Mine' }, contract('C1') as any), (error: any) => error.code === 'VERSION_CONFLICT' && error.status === 409);
  assert.equal(cached().contracts.find((c: any) => c.contract_id === 'C1').contract_title, 'T-C1');
});

test('rollback never undoes a newer edit that replaced the optimistic value meanwhile', async () => {
  const { actions, cached, queryClient } = setup();
  const hold = gate();
  stubFetch(async () => { await hold.wait; return fail(500, { error: 'boom' }); });
  const pending = actions.deleteContract('C2');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(cached().contracts.map((c: any) => c.contract_id), ['C1']);
  // A refresh from the server lands while the delete is still in flight.
  queryClient.setQueryData(KEY, { ...cached(), contracts: [contract('C1'), contract('C2'), contract('C3')] });
  hold.release();
  await assert.rejects(pending);
  assert.deepEqual(cached().contracts.map((c: any) => c.contract_id), ['C1', 'C2', 'C3'], 'the newer snapshot is left as it is');
});

test('creating inserts a temporary row first; deleting a partner removes its contracts and orders from the cache, and rolls them all back on failure', async () => {
  const { actions, cached } = setup();
  const hold = gate();
  stubFetch(async () => { await hold.wait; return ok({ success: true }); });
  const created = actions.saveContract({ contract_number: 'NEW', contract_title: 'Fresh', partner_id: 'P1' }, null);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(cached().contracts.length, 3);
  assert.equal(cached().contracts[0].contract_number, 'NEW');
  hold.release();
  await created;

  const wire = stubFetch(() => fail(500, { error: 'no' }));
  const before = cached();
  await assert.rejects(actions.deletePartner('P1'));
  assert.equal(wire[0].method, 'DELETE');
  assert.equal(wire[0].url, '/api/partners/P1');
  assert.deepEqual(cached().partners, before.partners);
  assert.equal(cached().contracts.length, before.contracts.length);
  assert.deepEqual(cached().ios, before.ios);
});

test('bulk delete reports the ids that failed and uses one request per record', async () => {
  const { actions } = setup();
  const wire = stubFetch((call) => (call.url.endsWith('/C2') ? fail(403, { error: 'no' }) : ok({ success: true })));
  assert.deepEqual(await actions.bulkDelete('contracts', ['C1', 'C2', 'C3']), ['C2']);
  assert.deepEqual(wire.map((call) => `${call.method} ${call.url}`), ['DELETE /api/contracts/C1', 'DELETE /api/contracts/C2', 'DELETE /api/contracts/C3']);
});
