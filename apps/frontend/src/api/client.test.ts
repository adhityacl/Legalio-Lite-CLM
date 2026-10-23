import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ApiError, api, apiBlob, apiRequestWithMeta, errorMessage, isApiError, onUnauthorized, withQuery } from './client';
import { contractsApi } from './contracts';

type Call = { url: string; init: RequestInit & { headers: Record<string, string> } };
const realFetch = globalThis.fetch;
const calls: Call[] = [];
afterEach(() => { globalThis.fetch = realFetch; calls.length = 0; });

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init, headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) } });
function mockFetch(respond: (call: Call) => Response | Promise<Response>) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const call = { url: String(url), init: init as Call['init'] };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
}

test('requests go to /api with credentials, a request id and JSON; query values that are empty are left out', async () => {
  mockFetch(() => json({ ok: true }, { headers: { 'x-request-id': 'echoed-1' } }));
  const meta = await apiRequestWithMeta<{ ok: boolean }>('/contracts', { query: { q: 'abc', limit: 5, offset: 0, status: '', dir: undefined } });
  assert.deepEqual(meta.data, { ok: true });
  assert.equal(meta.requestId, 'echoed-1');
  assert.equal(calls[0].url, '/api/contracts?q=abc&limit=5&offset=0');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.method, 'GET');
  assert.ok(calls[0].init.headers['X-Request-Id']);
  assert.equal(calls[0].init.headers.Accept, 'application/json');
  assert.equal(withQuery('/api/x?a=1', { b: 2 }), '/api/x?a=1&b=2');
});

test('plain objects are sent as JSON, FormData and strings are left alone, organization can be pinned', async () => {
  mockFetch(() => json({}));
  await api.post('/contracts', { a: 1 }, { organizationId: 'org-1' });
  assert.equal(calls[0].init.body, '{"a":1}');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.headers['x-organization-id'], 'org-1');
  const form = new FormData();
  form.append('file', new Blob(['x']), 'x.pdf');
  await api.post('/contracts/parse', form);
  assert.equal(calls[1].init.body, form);
  assert.equal(calls[1].init.headers['Content-Type'], undefined, 'the browser sets the multipart boundary');
  await api.put('/contracts/C1', undefined);
  assert.equal(calls[2].init.body, '{}');
});

test('errors have one shape: error, code, message, status, requestId, plus the extra body fields', async () => {
  mockFetch(() => json({ error: 'Nomor sudah ada', code: 'DUPLICATE_VALUE', message: 'Nomor sudah ada', status: 409, requestId: 'srv-9', details: { field: 'contract_number' } }, { status: 409 }));
  await assert.rejects(api.get('/contracts'), (error: unknown) => {
    assert.ok(error instanceof ApiError && isApiError(error));
    assert.deepEqual(error.toJSON(), { error: 'Nomor sudah ada', code: 'DUPLICATE_VALUE', message: 'Nomor sudah ada', status: 409, requestId: 'srv-9' });
    assert.deepEqual(error.body, { details: { field: 'contract_number' } });
    assert.equal(errorMessage(error, 'fallback'), 'Nomor sudah ada');
    return true;
  });
});

test('a code-first body and a gateway HTML page still become ApiErrors with sensible messages and the request id', async () => {
  mockFetch(() => json({ error: 'ORGANIZATION_REQUIRED', message: 'Choose an organization.' }, { status: 409, headers: { 'x-request-id': 'hdr-1' } }));
  await assert.rejects(api.get('/x'), (error: unknown) => isApiError(error) && error.error === 'ORGANIZATION_REQUIRED' && error.message === 'Choose an organization.' && error.requestId === 'hdr-1');
  mockFetch(() => new Response('<html>Bad gateway' + 'x'.repeat(400) + '</html>', { status: 502, headers: { 'content-type': 'text/html', 'x-request-id': 'gw-1' } }));
  await assert.rejects(api.get('/x'), (error: unknown) => {
    assert.ok(isApiError(error));
    assert.equal(error.status, 502);
    assert.equal(error.message, 'HTTP 502');
    assert.equal(error.requestId, 'gw-1');
    assert.equal(errorMessage(error, 'The AI server is busy'), 'The AI server is busy', 'a bare HTTP status is not shown to people');
    return true;
  });
});

test('network failures and timeouts are ApiErrors; aborts pass through untouched', async () => {
  globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
  await assert.rejects(api.get('/x'), (error: unknown) => isApiError(error) && error.code === 'NETWORK_ERROR' && error.status === 0 && Boolean(error.requestId));

  globalThis.fetch = ((_: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  })) as typeof fetch;
  await assert.rejects(api.get('/x', { timeoutMs: 20 }), (error: unknown) => isApiError(error) && error.code === 'TIMEOUT');
  const controller = new AbortController();
  const pending = api.get('/x', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error: unknown) => !isApiError(error) && (error as Error).name === 'AbortError');
});

test('a 401 on an authenticated call tells the session layer; sign-in and session probes do not', async () => {
  const seen: string[] = [];
  const off = onUnauthorized((info) => seen.push(info.path));
  mockFetch(() => json({ error: 'UNAUTHENTICATED', code: 'UNAUTHENTICATED', message: 'Authentication is required.' }, { status: 401 }));
  await assert.rejects(api.get('/contracts'));
  await assert.rejects(api.post('/auth/sign-in/email', {}));
  await assert.rejects(api.get('/me'));
  await assert.rejects(api.get('/contracts', { notifyUnauthorized: false }));
  off();
  assert.deepEqual(seen, ['/api/contracts']);
});

test('paged lists report X-Total-Count; 204 has no body; downloads use the same error handling', async () => {
  mockFetch(() => json([{ contract_id: 'C1' }], { headers: { 'x-total-count': '42' } }));
  const page = await contractsApi.page({ limit: 1, offset: 1, q: 'abc', status: ['Active', 'Expiring'], sort: 'end_date', dir: 'desc' });
  assert.equal(page.total, 42);
  assert.equal(page.items.length, 1);
  assert.equal(calls[0].url, '/api/contracts?limit=1&offset=1&q=abc&sort=end_date&dir=desc&status=Active%2CExpiring');
  mockFetch(() => new Response(null, { status: 204 }));
  assert.equal(await api.delete('/contracts/C1'), undefined);
  mockFetch(() => new Response('pdf-bytes', { status: 200, headers: { 'content-type': 'application/pdf' } }));
  assert.equal(await (await apiBlob('/uploads/org/x.pdf')).text(), 'pdf-bytes');
  assert.equal(calls.at(-1)!.url, '/uploads/org/x.pdf');
  mockFetch(() => json({ error: 'nope', code: 'RESOURCE_NOT_FOUND' }, { status: 404 }));
  await assert.rejects(apiBlob('/uploads/org/x.pdf'), (error: unknown) => isApiError(error) && error.status === 404);
});

test('a contract edit carries the version it was based on and the record routes use the right verbs', async () => {
  mockFetch(() => json({ success: true, contract: { contract_id: 'C1', version: 3 } }));
  await contractsApi.save('C1', { contract_title: 'x', version: 2 });
  assert.equal(calls[0].url, '/api/contracts/C1');
  assert.equal(calls[0].init.method, 'PUT');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { contract_title: 'x', version: 2 });
  await contractsApi.save(undefined, { contract_title: 'new' });
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].url, '/api/contracts');
  const body = JSON.parse(String(calls[1].init.body));
  assert.ok(!('userEmail' in body) && !('userRole' in body), 'the actor is the session, never a body field');
});
