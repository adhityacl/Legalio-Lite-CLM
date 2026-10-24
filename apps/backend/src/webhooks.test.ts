import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import {
  isBlockedAddress, outboundRequest, parseOutboundUrl, resolvePublicAddresses, SsrfError, type OutboundPolicy,
} from './ssrfGuard';
import { bootApp, type Harness } from './testHarness';

const STRICT: OutboundPolicy = { allowHttp: false, allowPrivateNetworks: false };
const LOCAL: OutboundPolicy = { allowHttp: true, allowPrivateNetworks: true };

/* ------------------------------ SSRF guard (no database) ------------------------------ */

test('private, loopback, link-local, metadata and reserved addresses are blocked; public ones are not', () => {
  for (const ip of ['127.0.0.1', '127.255.255.254', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '169.254.0.1', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '240.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.1',
    '::', '::1', 'fe80::1', 'fc00::1', 'fd00:ec2::254', 'ff02::1', '2001:db8::1', '::ffff:127.0.0.1', '::ffff:10.1.2.3', '::ffff:7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::', '::127.0.0.1', 'not-an-ip']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '11.0.0.1', '100.63.255.255', '169.253.0.1', '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '2002:0808:0808::1']) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test('URLs: https only, no credentials or fragments, no literal internal addresses or internal names', () => {
  assert.equal(parseOutboundUrl('https://hooks.example.com/in?x=1', STRICT).hostname, 'hooks.example.com');
  const refused: Array<[string, string]> = [
    ['http://hooks.example.com/', 'SCHEME_NOT_ALLOWED'], ['ftp://hooks.example.com/', 'SCHEME_NOT_ALLOWED'], ['javascript:alert(1)', 'SCHEME_NOT_ALLOWED'],
    ['https://user:pw@hooks.example.com/', 'URL_INVALID'], ['https://hooks.example.com/#frag', 'URL_INVALID'], ['nonsense', 'URL_INVALID'], ['', 'URL_INVALID'],
    ['https://localhost/', 'HOST_BLOCKED'], ['https://app.localhost/', 'HOST_BLOCKED'], ['https://127.0.0.1/', 'HOST_BLOCKED'], ['https://127.1/', 'HOST_BLOCKED'],
    ['https://0x7f.0.0.1/', 'HOST_BLOCKED'], ['https://2130706433/', 'HOST_BLOCKED'], ['https://017700000001/', 'HOST_BLOCKED'], ['https://[::1]/', 'HOST_BLOCKED'],
    ['https://[::ffff:127.0.0.1]/', 'HOST_BLOCKED'], ['https://169.254.169.254/latest/meta-data/', 'HOST_BLOCKED'], ['https://metadata.google.internal/', 'HOST_BLOCKED'],
    ['https://metadata/', 'HOST_BLOCKED'], ['https://db.internal/', 'HOST_BLOCKED'], ['https://10.0.0.8:8443/', 'HOST_BLOCKED'], ['https://192.168.0.10/', 'HOST_BLOCKED'],
  ];
  for (const [url, code] of refused) {
    assert.throws(() => parseOutboundUrl(url, STRICT), (err: unknown) => err instanceof SsrfError && err.code === code, `${url} -> ${code}`);
  }
  assert.equal(parseOutboundUrl('http://hooks.example.com/', { ...STRICT, allowHttp: true }).protocol, 'http:');
  assert.throws(() => parseOutboundUrl('http://127.0.0.1/', { ...STRICT, allowHttp: true }), SsrfError, 'http for dev does not open private networks');
  assert.equal(parseOutboundUrl('http://127.0.0.1:3999/', LOCAL).port, '3999');
});

test('every address a host name resolves to must be public (DNS pointing inside is refused)', async () => {
  const lookup = (map: Record<string, string[]>) => (async (host: string) => {
    if (!map[host]) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    return map[host].map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  }) as any;
  const dns = lookup({ 'ok.example': ['93.184.216.34', '2606:4700:4700::1111'], 'inside.example': ['10.0.0.5'], 'mixed.example': ['93.184.216.34', '127.0.0.1'], 'v6inside.example': ['::1'], 'mapped.example': ['::ffff:169.254.169.254'] });
  assert.equal((await resolvePublicAddresses('ok.example', STRICT, dns)).length, 2);
  for (const host of ['inside.example', 'mixed.example', 'v6inside.example', 'mapped.example']) {
    await assert.rejects(resolvePublicAddresses(host, STRICT, dns), (err: unknown) => err instanceof SsrfError && err.code === 'ADDRESS_BLOCKED', host);
  }
  await assert.rejects(resolvePublicAddresses('missing.example', STRICT, dns), (err: unknown) => err instanceof SsrfError && err.code === 'DNS_FAILED');
  assert.equal((await resolvePublicAddresses('inside.example', LOCAL, dns)).length, 1, 'development switch');
});

function listener(handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void) {
  const requests: Array<{ url: string; method: string; headers: http.IncomingHttpHeaders; body: string }> = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { const body = Buffer.concat(chunks).toString(); requests.push({ url: req.url ?? '', method: req.method ?? '', headers: req.headers, body }); handler(req, body, res); });
  });
  return new Promise<{ url: string; port: number; requests: typeof requests; close: () => Promise<void> }>((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = (server.address() as AddressInfo).port;
    resolve({ url: `http://127.0.0.1:${port}`, port, requests, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) });
  }));
}

test('outbound requests: never follow redirects, cap the response, time out, and connect only to the checked address', async () => {
  const target = await listener((req, _body, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: 'http://127.0.0.1:1/secret' }); res.end(); }
    else if (req.url === '/big') { res.writeHead(200); res.end(Buffer.alloc(1_000_000, 'x')); }
    else if (req.url === '/hang') { /* never answers */ }
    else { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('pong'); }
  });
  try {
    const redirect = await outboundRequest(`${target.url}/redirect`, { policy: LOCAL, method: 'POST', body: '{}' });
    assert.equal(redirect.statusCode, 302);
    assert.equal(redirect.headers.location, 'http://127.0.0.1:1/secret', 'the Location is reported, not followed');
    const big = await outboundRequest(`${target.url}/big`, { policy: LOCAL, method: 'GET', maxResponseBytes: 1000 });
    assert.equal(big.truncated, true);
    assert.ok(big.body.length <= 1000);
    await assert.rejects(outboundRequest(`${target.url}/hang`, { policy: LOCAL, method: 'GET', timeoutMs: 250 }), /Timed out/);
    // The connection goes to the address the guard checked, with the original Host.
    const pinned = await outboundRequest(`http://pinned.test:${target.port}/ping`, { policy: LOCAL, method: 'GET', lookup: (async () => [{ address: '127.0.0.1', family: 4 }]) as any });
    assert.equal(pinned.body, 'pong');
    assert.equal(target.requests.at(-1)!.headers.host, `pinned.test:${target.port}`);
    // A host that resolves inside is refused before any connection is made.
    const before = target.requests.length;
    await assert.rejects(outboundRequest(`http://rebind.test:${target.port}/ping`, { policy: { allowHttp: true, allowPrivateNetworks: false }, method: 'GET', lookup: (async () => [{ address: '127.0.0.1', family: 4 }]) as any }),
      (err: unknown) => err instanceof SsrfError && err.code === 'ADDRESS_BLOCKED');
    await assert.rejects(outboundRequest(`http://127.0.0.1:${target.port}/ping`, { policy: { allowHttp: true, allowPrivateNetworks: false }, method: 'GET' }), SsrfError);
    assert.equal(target.requests.length, before, 'nothing reached the internal listener');
  } finally { await target.close(); }
});

test('signatures: HMAC-SHA256 over timestamp.body, constant-time compare, replay window', async () => {
  const { signatureHeader, verifySignature, signPayload } = await import('./webhooks');
  const secret = 'whsec_test';
  const body = JSON.stringify({ hello: 'world' });
  const header = signatureHeader(secret, body, 1_700_000_000);
  assert.equal(header, `t=1700000000,v1=${signPayload(secret, 1_700_000_000, body)}`);
  assert.match(header, /^t=1700000000,v1=[0-9a-f]{64}$/);
  assert.equal(verifySignature(secret, header, body, 300, 1_700_000_100), true);
  assert.equal(verifySignature(secret, header, body + ' ', 300, 1_700_000_100), false, 'tampered body');
  assert.equal(verifySignature('whsec_other', header, body, 300, 1_700_000_100), false, 'wrong secret');
  assert.equal(verifySignature(secret, header, body, 300, 1_700_001_000), false, 'too old');
  assert.equal(verifySignature(secret, 'garbage', body), false);
  assert.equal(verifySignature(secret, 't=1700000000,v1=zz', body, 300, 1_700_000_100), false);
  // Independent computation, as a receiver in another language would do it.
  const { createHmac } = await import('node:crypto');
  assert.equal(createHmac('sha256', secret).update(`1700000000.${body}`).digest('hex'), header.split('v1=')[1]);
});

/* ------------------------------ endpoints, events, delivery (database) ------------------------------ */

let h: Harness;
before(async () => {
  h = await bootApp({
    tag: 'webhooks', orgs: [{ id: 'org-a', name: 'Org A' }, { id: 'org-b', name: 'Org B' }],
    users: [['adminA', 'org-a', 'admin'], ['editorA', 'org-a', 'editor'], ['adminB', 'org-b', 'admin']],
  });
});
after(() => h?.close());

const hook = (user: string, method: string, route: string, body?: unknown, org = 'org-a') => h.api(user, method, `/api/organizations/${org}/webhooks${route}`, { body });

test('webhook management: admins only, https-only URLs, secrets shown once and sealed at rest', async () => {
  assert.equal((await hook('editorA', 'GET', '')).status, 403);
  assert.equal((await hook('editorA', 'POST', '', { url: 'https://hooks.example.com/x' })).status, 403);
  assert.equal((await hook('adminB', 'GET', '', undefined, 'org-a')).status, 404);
  for (const [url, code] of [['http://hooks.example.com/x', 'WEBHOOK_SCHEME_NOT_ALLOWED'], ['https://127.0.0.1/x', 'WEBHOOK_HOST_BLOCKED'], ['https://169.254.169.254/', 'WEBHOOK_HOST_BLOCKED'], ['https://localhost/x', 'WEBHOOK_HOST_BLOCKED'], ['https://u:p@hooks.example.com/', 'WEBHOOK_URL_INVALID'], ['nope', 'WEBHOOK_URL_INVALID']]) {
    const reply = await hook('adminA', 'POST', '', { url });
    assert.equal(reply.status, 400, url);
    assert.equal(reply.body.code, code, url);
  }
  assert.equal((await hook('adminA', 'POST', '', { url: 'https://hooks.example.com/x', eventTypes: ['contract.exploded'] })).status, 400);
  assert.equal((await hook('adminA', 'POST', '', { url: 'https://hooks.example.com/x', secret: 'mine' })).status, 400);
  const created = await hook('adminA', 'POST', '', { url: 'https://hooks.example.com/x', description: 'ERP', eventTypes: ['contract.created'] });
  assert.equal(created.status, 201, created.raw);
  assert.match(created.body.secret, /^whsec_[A-Za-z0-9_-]{43}$/);
  const id = created.body.webhook.id;
  const listed = await hook('adminA', 'GET', '');
  assert.ok(!listed.raw.includes(created.body.secret) && !/sealed|secret/i.test(JSON.stringify(listed.body.webhooks)), 'no secret after creation');
  assert.ok(listed.body.eventTypes.includes('signature.completed'));
  const row = await h.sql.get(`SELECT secret_sealed FROM webhook_endpoints WHERE id = ?`, id);
  assert.match(row.secret_sealed, /^v1:/);
  assert.ok(!row.secret_sealed.includes(created.body.secret));
  const { open } = await import('./secretBox');
  assert.equal(open(row.secret_sealed), created.body.secret);
  const patched = await hook('adminA', 'PATCH', `/${id}`, { description: 'ERP 2', eventTypes: [], enabled: false });
  assert.equal(patched.status, 200);
  assert.deepEqual([patched.body.webhook.description, patched.body.webhook.eventTypes, patched.body.webhook.enabled], ['ERP 2', [], false]);
  assert.equal((await hook('adminA', 'PATCH', `/${id}`, { url: 'http://insecure.example/x' })).status, 400, 'a URL change is validated again');
  assert.equal((await hook('adminB', 'PATCH', `/${id}`, { enabled: true }, 'org-b')).status, 404, 'another organization cannot touch it');
  const rotated = await hook('adminA', 'POST', `/${id}/rotate-secret`);
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.body.secret, created.body.secret);
  assert.equal((await hook('adminA', 'DELETE', `/${id}`)).status, 204);
  assert.equal((await hook('adminA', 'DELETE', `/${id}`)).status, 404);
  const actions = (await h.sql.all(`SELECT action FROM audit_log WHERE target_type = 'webhook' ORDER BY created_at`)).map((a: any) => a.action);
  assert.deepEqual(actions, ['webhook.create', 'webhook.update', 'webhook.rotate_secret', 'webhook.delete']);
});

async function endpointFor(org: string, url: string, eventTypes: string[] = []) {
  const { createEndpoint } = await import('./webhooks');
  return createEndpoint(h.sql, org, null, { url, eventTypes }, LOCAL);
}

test('domain events are queued per subscribed endpoint, signed, delivered and logged; other organizations hear nothing', async () => {
  const receiver = await listener((_req, _body, res) => { res.writeHead(200); res.end('ok'); });
  const { deliverDueWebhooks, verifySignature } = await import('./webhooks');
  try {
    const a = await endpointFor('org-a', `${receiver.url}/hook`, ['contract.created', 'contract.status_changed', 'contract.terminated']);
    const b = await endpointFor('org-b', `${receiver.url}/other`);
    const partner = (await h.api('adminA', 'POST', '/api/partners', { org: 'org-a', body: { partner_name: 'Hook Partner', country: 'ID' } })).body.partner;
    const created = await h.api('adminA', 'POST', '/api/contracts', { org: 'org-a', body: { partner_id: partner.partner_id, contract_number: 'WH-1', contract_title: 'Webhook contract', start_date: '2026-01-01', end_date: '2099-12-31', currency: 'USD', contract_value: 5 } });
    assert.equal(created.status, 200, created.raw);
    const contract = created.body.contract;
    // A title edit is "contract.updated": not subscribed by endpoint A, so no delivery row.
    const edited = await h.api('adminA', 'PUT', `/api/contracts/${contract.contract_id}`, { org: 'org-a', body: { contract_title: 'Renamed', version: contract.version } });
    assert.equal(edited.status, 200, edited.raw);
    const terminated = await h.api('adminA', 'PUT', `/api/contracts/${contract.contract_id}`, { org: 'org-a', body: { lifecycle_mode: 'terminated', termination_date: '2026-06-01', termination_reason: 'test', version: edited.body.contract.version } });
    assert.equal(terminated.status, 200, terminated.raw);
    const rows = await h.sql.all(`SELECT event_type, endpoint_id, status FROM webhook_deliveries ORDER BY created_at`);
    assert.deepEqual(rows.map((r: any) => r.event_type).sort(), ['contract.created', 'contract.status_changed', 'contract.terminated']);
    assert.ok(rows.every((r: any) => r.endpoint_id === a.endpoint.id && r.status === 'pending'), 'nothing for the other organization\'s endpoint');

    const result = await deliverDueWebhooks(h.sql, { policy: LOCAL });
    assert.deepEqual([result.attempted, result.sent, result.failed, result.dead], [3, 3, 0, 0]);
    assert.equal(receiver.requests.length, 3);
    for (const request of receiver.requests) {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/hook');
      assert.equal(request.headers['content-type'], 'application/json');
      assert.equal(verifySignature(a.secret, String(request.headers['legalio-signature']), request.body), true, 'valid signature');
      assert.equal(verifySignature(b.secret, String(request.headers['legalio-signature']), request.body), false, 'another endpoint\'s secret does not verify');
      const event = JSON.parse(request.body);
      assert.equal(event.organizationId, 'org-a');
      assert.equal(event.id, request.headers['legalio-event-id']);
      assert.equal(event.type, request.headers['legalio-event-type']);
      assert.ok(request.headers['legalio-delivery-id']);
    }
    const byType = Object.fromEntries(receiver.requests.map((r) => [JSON.parse(r.body).type, JSON.parse(r.body)]));
    assert.equal(byType['contract.created'].data.contract.contractNumber, 'WH-1');
    assert.deepEqual([byType['contract.status_changed'].data.to, byType['contract.terminated'].data.contract.status], ['Terminated', 'Terminated']);
    // Delivery log (admin view).
    const log = await hook('adminA', 'GET', `/${a.endpoint.id}/deliveries`);
    assert.equal(log.body.total, 3);
    assert.ok(log.body.deliveries.every((d: any) => d.status === 'sent' && d.lastStatusCode === 200 && d.attempts === 1));
    assert.ok(!log.raw.includes('"payload"'), 'the list does not carry payloads');
    const detail = await hook('adminA', 'GET', `/${a.endpoint.id}/deliveries/${log.body.deliveries[0].id}`);
    assert.ok(detail.body.delivery.payload.type);
    assert.equal((await hook('adminB', 'GET', `/${a.endpoint.id}/deliveries`, undefined, 'org-b')).status, 404);
    assert.equal((await hook('adminB', 'GET', `/${b.endpoint.id}/deliveries/${log.body.deliveries[0].id}`, undefined, 'org-b')).status, 404, 'a delivery id of another endpoint');
  } finally { await receiver.close(); }
});

test('failed deliveries back off, then dead-letter; an administrator can retry; a concurrent pass delivers once', async () => {
  let mode = 500;
  const receiver = await listener((_req, _body, res) => { res.writeHead(mode); res.end(mode === 500 ? 'boom' : 'ok'); });
  const { deliverDueWebhooks, emitWebhookEvent, webhookBackoffMs, getEndpoint } = await import('./webhooks');
  try {
    const { endpoint } = await endpointFor('org-a', `${receiver.url}/flaky`, ['reminder.sent']);
    await emitWebhookEvent(h.sql, 'org-a', 'reminder.sent', { kind: 'contract', recordId: 'c-1' });
    const t0 = new Date();
    const deps = { policy: LOCAL, maxAttempts: 3 };
    const first = await deliverDueWebhooks(h.sql, { ...deps, now: () => t0 });
    assert.deepEqual([first.attempted, first.failed], [1, 1]);
    let row = await h.sql.get(`SELECT * FROM webhook_deliveries WHERE endpoint_id = ?`, endpoint.id);
    assert.equal(row.status, 'failed');
    assert.equal(row.attempts, 1);
    assert.equal(row.last_status_code, 500);
    assert.equal(row.response_snippet, 'boom');
    assert.equal(new Date(row.next_attempt_at).getTime(), t0.getTime() + webhookBackoffMs(1));
    assert.equal((await deliverDueWebhooks(h.sql, { ...deps, now: () => new Date(t0.getTime() + 1000) })).attempted, 0, 'not due yet');
    assert.equal((await deliverDueWebhooks(h.sql, { ...deps, now: () => new Date(t0.getTime() + 60_000) })).failed, 1);
    assert.equal((await deliverDueWebhooks(h.sql, { ...deps, now: () => new Date(t0.getTime() + 3600_000) })).dead, 1);
    row = await h.sql.get(`SELECT * FROM webhook_deliveries WHERE endpoint_id = ?`, endpoint.id);
    assert.deepEqual([row.status, row.attempts], ['dead', 3]);
    assert.equal((await getEndpoint(h.sql, 'org-a', endpoint.id))!.consecutiveFailures, 1);
    assert.equal(webhookBackoffMs(30), 6 * 3600_000, 'backoff is capped');

    mode = 200;
    assert.equal((await hook('adminA', 'POST', `/${endpoint.id}/deliveries/${row.id}/retry`)).status, 202);
    assert.equal((await hook('adminB', 'POST', `/${endpoint.id}/deliveries/${row.id}/retry`, undefined, 'org-b')).status, 404);
    const before = receiver.requests.length;
    const [one, two] = await Promise.all([deliverDueWebhooks(h.sql, { policy: LOCAL }), deliverDueWebhooks(h.sql, { policy: LOCAL })]);
    assert.equal(one.sent + two.sent, 1, 'claimed by exactly one pass');
    assert.equal(receiver.requests.length - before, 1);
    assert.equal((await getEndpoint(h.sql, 'org-a', endpoint.id))!.consecutiveFailures, 0, 'a success resets the failure count');
  } finally { await receiver.close(); }
});

test('delivery refuses internal destinations and redirects, and the test button reports honestly', async () => {
  const redirector = await listener((_req, _body, res) => { res.writeHead(307, { location: 'http://169.254.169.254/latest/meta-data/' }); res.end(); });
  const { deliverDueWebhooks, emitWebhookEvent } = await import('./webhooks');
  try {
    // 1) A host name that resolves to a private address is refused at delivery time (DNS changed after the URL was saved).
    const rebinding = await endpointFor('org-a', 'http://rebinding.test:9/in', ['approval.requested']);
    await emitWebhookEvent(h.sql, 'org-a', 'approval.requested', { approvalId: 'a-1' });
    const blocked = await deliverDueWebhooks(h.sql, { policy: { allowHttp: true, allowPrivateNetworks: false }, lookup: (async () => [{ address: '10.1.2.3', family: 4 }]) as any, maxAttempts: 1 });
    assert.equal(blocked.dead, 1);
    const blockedRow = await h.sql.get(`SELECT last_error, last_status_code FROM webhook_deliveries WHERE endpoint_id = ?`, rebinding.endpoint.id);
    assert.match(blockedRow.last_error, /^Blocked: .*private/);
    assert.equal(blockedRow.last_status_code, null);
    // 2) A 307 to the metadata address is a failed delivery; the redirect is not followed.
    const redirecting = await endpointFor('org-a', `${redirector.url}/r`, ['approval.decided']);
    await emitWebhookEvent(h.sql, 'org-a', 'approval.decided', { approvalId: 'a-1' });
    await deliverDueWebhooks(h.sql, { policy: LOCAL, maxAttempts: 1 });
    const redirected = await h.sql.get(`SELECT status, last_status_code, last_error FROM webhook_deliveries WHERE endpoint_id = ?`, redirecting.endpoint.id);
    assert.deepEqual([redirected.status, redirected.last_status_code], ['dead', 307]);
    assert.match(redirected.last_error, /redirect/i);
    assert.equal(redirector.requests.length, 1);
  } finally { await redirector.close(); }

  // 3) The test button: strict policy blocks a local receiver; with the development switches it reaches it and logs a test delivery.
  const receiver = await listener((_req, _body, res) => { res.writeHead(204); res.end(); });
  const { endpoint, secret } = await endpointFor('org-a', `${receiver.url}/t`);
  try {
    const strict = await hook('adminA', 'POST', `/${endpoint.id}/test`);
    assert.equal(strict.status, 200);
    assert.equal(strict.body.ok, false);
    assert.match(strict.body.error, /Blocked/);
    assert.equal(receiver.requests.length, 0);
    Object.assign(process.env, { WEBHOOK_ALLOW_HTTP: 'true', WEBHOOK_ALLOW_PRIVATE_NETWORKS: 'true' });
    const ok = await hook('adminA', 'POST', `/${endpoint.id}/test`);
    assert.equal(ok.body.ok, true, ok.raw);
    assert.equal(ok.body.statusCode, 204);
    const { verifySignature } = await import('./webhooks');
    assert.equal(JSON.parse(receiver.requests[0].body).type, 'webhook.test');
    assert.equal(verifySignature(secret, String(receiver.requests[0].headers['legalio-signature']), receiver.requests[0].body), true);
    const logged = await hook('adminA', 'GET', `/${endpoint.id}/deliveries`);
    assert.deepEqual(logged.body.deliveries.map((d: any) => [d.eventType, d.status]), [['webhook.test', 'sent'], ['webhook.test', 'dead']]);
  } finally {
    delete process.env.WEBHOOK_ALLOW_HTTP; delete process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS;
    await receiver.close();
  }
});

test('approval, reminder, export and document events reach subscribed endpoints', async () => {
  const { emitWebhookEvent } = await import('./webhooks');
  const { endpoint } = await endpointFor('org-a', 'http://events.test:9/in', ['approval.requested', 'approval.decided', 'document.exported', 'reminder.sent']);
  await h.sql.run(`UPDATE webhook_deliveries SET status = 'skipped'`);
  // Approval flow through the real routes.
  const doc = await h.api('adminA', 'POST', '/api/documents', { org: 'org-a', body: { name: 'NDA', type: 'contract' } });
  assert.ok([200, 201].includes(doc.status), doc.raw);
  await h.sql.exec(`INSERT INTO "user"(id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ('approver1', 'Approver', 'approver1@example.com', true, now(), now()) ON CONFLICT DO NOTHING`);
  await h.sql.exec(`INSERT INTO member(id, "organizationId", "userId", role, status, "createdAt") VALUES ('m-ap1', 'org-a', 'approver1', 'editor', 'active', now()) ON CONFLICT DO NOTHING`);
  const submitted = await h.api('adminA', 'POST', '/api/approvals', { org: 'org-a', body: { title: 'Please approve', documentId: doc.body.id ?? doc.body.document?.id, approverIds: ['approver1'], note: 'n' } });
  assert.equal(submitted.status, 201, submitted.raw);
  const requested = await h.sql.get(`SELECT payload FROM webhook_deliveries WHERE endpoint_id = ? AND event_type = 'approval.requested'`, endpoint.id);
  assert.equal(JSON.parse(requested.payload).data.approvalId, submitted.body.id);
  assert.deepEqual(JSON.parse(requested.payload).data.approverIds, ['approver1']);
  // Direct emission for the rest (their producers are exercised by their own tests).
  assert.equal(await emitWebhookEvent(h.sql, 'org-a', 'document.exported', { kind: 'google_doc' }), 2, 'this endpoint and the catch-all endpoint of the test-button case');
  assert.equal(await emitWebhookEvent(h.sql, 'org-b', 'document.exported', { kind: 'google_doc' }), 1, 'org B has its own endpoint from the earlier test');
  assert.equal(await emitWebhookEvent(h.sql, 'org-a', 'signature.completed', {}), 1, 'only the catch-all endpoint hears an event nobody filtered for');
  assert.equal(await emitWebhookEvent(h.sql, null, 'document.exported', {}), 0);
});
