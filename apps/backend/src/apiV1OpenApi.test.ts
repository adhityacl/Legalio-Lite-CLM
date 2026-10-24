/** The OpenAPI document, the registered /api/v1 routes, the operation table and the route policies must describe the same API. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-openapi-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false', BETTER_AUTH_SECRET: 'openapi-test-secret-0123456789abcdef', LOG_LEVEL: 'silent' });
const { ROUTE_POLICIES, findPolicy } = await import('./routePolicies');
const { V1_OPERATIONS } = await import('./apiV1Operations');
const { buildOpenApiDocument } = await import('./apiV1OpenApi');
const { API_SCOPES } = await import('./apiKeys');
const { app } = await import('./server');

function collect(stack: any[], prefix: string, out: string[]) {
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) for (const p of ([] as string[]).concat(layer.route.path)) out.push(`${method.toUpperCase()} ${prefix}${p}`);
    } else if (layer.name === 'router' && layer.handle?.stack) {
      const source: string = layer.regexp.source;
      const mount = layer.regexp.fast_slash ? '' : (/^\^((?:\\\/|[^\\()?*+|[\]^$])*)\\\/\?\(\?=\\\/\|\$\)$/.exec(source)?.[1] ?? '').replace(/\\\//g, '/');
      collect(layer.handle.stack, prefix + mount, out);
    }
  }
}
const registered: string[] = [];
collect((app as any)._router.stack, '', registered);
const v1Registered = registered.filter((r) => r.split(' ')[1].startsWith('/api/v1')).sort();
const expressToOpenApi = (p: string) => p.replace(/:([A-Za-z]+)/g, '{$1}');

test('the document is OpenAPI 3.1 and every reference resolves', () => {
  const doc = buildOpenApiDocument('http://example.test') as any;
  assert.equal(doc.openapi, '3.1.0');
  assert.equal(doc.servers[0].url, 'http://example.test/api/v1');
  const refs: string[] = [];
  JSON.stringify(doc, (key, value) => { if (key === '$ref') refs.push(value); return value; });
  assert.ok(refs.length > 10);
  for (const ref of refs) {
    const target = ref.replace(/^#\//, '').split('/').reduce((node: any, part) => node?.[part], doc);
    assert.ok(target, `unresolved ${ref}`);
  }
  assert.ok(!JSON.stringify(doc).includes('fileData') && !JSON.stringify(doc).includes('accessToken'), 'interactive-only fields are not part of the API');
  for (const scope of API_SCOPES) assert.ok(JSON.stringify(doc).includes(scope));
});

test('every registered /api/v1 route is documented, and every documented operation is registered', () => {
  const doc = buildOpenApiDocument() as any;
  const documented = Object.entries(doc.paths).flatMap(([p, ops]) => Object.keys(ops as object).map((method) => `${method.toUpperCase()} /api/v1${p}`)).sort();
  assert.deepEqual(v1Registered.map((r) => r.replace(/:([A-Za-z]+)/g, '{$1}')), documented);
});

test('every v1 route has exactly the apiKey policy the operation table names (and nothing else is under /api/v1)', () => {
  const policies = ROUTE_POLICIES.filter(([, pattern]) => pattern.startsWith('/api/v1'));
  assert.equal(policies.length, V1_OPERATIONS.length + 1, 'operations plus the public openapi.json');
  for (const op of V1_OPERATIONS) {
    const found = findPolicy(op.method, op.path.replace(/:id/, 'x'));
    assert.ok(found, `${op.method} ${op.path}`);
    assert.deepEqual([found!.policy.kind, (found!.policy as any).scope], ['apiKey', op.scope], `${op.method} ${op.path}`);
    assert.equal(found!.pattern, op.path);
    assert.ok(op.scope === null || API_SCOPES.includes(op.scope));
    if (op.method !== 'GET') assert.ok(op.scope?.endsWith(':write'), `${op.method} ${op.path} must need a write scope`);
  }
  assert.equal(findPolicy('GET', '/api/v1/openapi.json')!.policy.kind, 'public');
  assert.equal(findPolicy('DELETE', '/api/v1/contracts/x'), null, 'no deletes in v1');
  assert.equal(findPolicy('GET', '/api/v1/unknown'), null);
  assert.equal(expressToOpenApi('/api/v1/contracts/:id'), '/api/v1/contracts/{id}');
});
