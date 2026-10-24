/**
 * Default-deny exhaustiveness: every Express route that is actually registered under /api must have an explicit entry in
 * routePolicies.ts, and every entry must correspond to something real. Anything unlisted is answered 404 by the middleware.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-policy-'));
Object.assign(process.env, {
  APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false', BETTER_AUTH_SECRET: 'policy-test-secret-0123456789abcdef', LOG_LEVEL: 'silent',
});
const { ROUTE_POLICIES, findPolicy, BETTER_AUTH_ALLOWED, isBetterAuthPathAllowed } = await import('./routePolicies');
const { isKnownPermission } = await import('./rbac');
const { app } = await import('./server');

interface Registered { method: string; path: string }

function mountPath(layer: any): string {
  if (layer.regexp?.fast_slash) return '';
  const source: string = layer.regexp.source;
  const match = /^\^((?:\\\/|[^\\()?*+|[\]^$])*)\\\/\?\(\?=\\\/\|\$\)$/.exec(source);
  assert.ok(match, `cannot read mount path of ${source}`);
  return match[1].replace(/\\\//g, '/');
}

function collect(stack: any[], prefix: string, out: Registered[]) {
  for (const layer of stack) {
    if (layer.route) {
      const methods = layer.route.methods._all ? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] : Object.keys(layer.route.methods).map((m) => m.toUpperCase());
      for (const p of ([] as string[]).concat(layer.route.path)) for (const method of methods) out.push({ method, path: prefix + p });
    } else if (layer.name === 'router' && layer.handle?.stack) {
      collect(layer.handle.stack, prefix + mountPath(layer), out);
    }
  }
}
const registered: Registered[] = [];
collect((app as any)._router.stack, '', registered);
// `/api/*` is the terminal JSON 404 behind the authorization middleware, not an endpoint.
const apiRoutes = registered.filter((r) => (r.path.startsWith('/api/') || r.path === '/api') && r.path !== '/api/*');
/** A concrete URL for a route pattern. */
const sample = (route: string) => route.replace(/:[A-Za-z]+/g, 'x').replace(/\*/g, 'x/y');

test('the route walker finds the application routes', () => {
  assert.ok(apiRoutes.length > 150, `only ${apiRoutes.length} routes found`);
  for (const probe of ['/api/contracts', '/api/documents/:id/drafts', '/api/approvals/:id/decision', '/api/auth-console/users', '/api/organizations/:organizationId/members']) {
    assert.ok(apiRoutes.some((r) => r.path.startsWith(probe.split(':')[0])), probe);
  }
});

test('every registered /api route has an explicit route policy (Better Auth paths use their own allowlist)', () => {
  // Better Auth's catch-all has its own enumerated allowlist (BETTER_AUTH_ALLOWED), checked in the unclassified-routes test.
  const betterAuthBoundary = (route: string) => route === '/api/auth' || route === '/api/auth/*';
  const missing = apiRoutes
    .filter((r) => !betterAuthBoundary(r.path))
    .filter((r) => !findPolicy(r.method, sample(r.path)))
    .map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(missing, [], `routes without a policy: ${missing.join(', ')}`);
});

test('every policy entry maps to a registered route (no stale or typo entries)', () => {
  const stale = ROUTE_POLICIES
    .filter(([, pattern]) => !pattern.endsWith('/*'))
    .filter(([method, pattern]) => !apiRoutes.some((r) => (method === '*' || r.method === method) && findPolicy(r.method, sample(r.path))?.pattern === pattern))
    .map(([method, pattern]) => `${method} ${pattern}`);
  assert.deepEqual(stale, [], `policy entries matching no registered route: ${stale.join(', ')}`);
});

test('unclassified routes are denied: nothing matches an unknown path or method', () => {
  assert.equal(findPolicy('GET', '/api/definitely-not-a-route'), null);
  assert.equal(findPolicy('POST', '/api/partners/x/y/z'), null);
  assert.equal(findPolicy('DELETE', '/api/health'), null);
  assert.equal(findPolicy('GET', '/api'), null);
  assert.equal(isBetterAuthPathAllowed('/api/auth/admin/create-user'), false);
  assert.equal(isBetterAuthPathAllowed('/api/auth/organization/create'), false);
  assert.ok(Object.keys(BETTER_AUTH_ALLOWED).every((route) => isBetterAuthPathAllowed(route)));
});

test('the set of unauthenticated (public) routes is explicit and reviewed', () => {
  const publicRoutes = ROUTE_POLICIES.filter(([, , policy]) => policy.kind === 'public').map(([method, pattern]) => `${method} ${pattern}`).sort();
  assert.deepEqual(publicRoutes, [
    'GET /api/auth-console/invitations/verify',
    'GET /api/auth/google/client-id',
    'GET /api/branding',
    'GET /api/digest/unsubscribe',
    'GET /api/exchange-rate-historical',
    'GET /api/exchange-rates',
    'GET /api/google-auth/client-id',
    'GET /api/health',
    'GET /api/health/ready',
    'GET /api/invitations/:token/preview',
    'GET /api/sso/:slug/start',
    'GET /api/sso/callback',
    'GET /api/sso/lookup',
    'GET /api/system/public-status',
    'GET /api/system/ui-texts',
    'GET /api/v1/openapi.json',
    'POST /api/auth/google/exchange-code',
    'POST /api/auth/google/sync-session',
    'POST /api/digest/unsubscribe',
    'POST /api/google-auth/exchange-code',
    'POST /api/google-auth/sync-session',
    'POST /api/system/setup',
  ]);
});

test('policies only name known permissions and writes never rest on a view-only permission', () => {
  const viewOnly = new Set(['document.view', 'workspace.view']);
  // Reads that go through POST (AI over records the caller can already see) are the reviewed exceptions.
  const readViaPost = new Set(['POST /api/chat', 'POST /api/playbook/check']);
  // A member's own e-mail preference: it changes nothing but what is sent to the caller, from data the caller can already see.
  const personalSetting = new Set(['PUT /api/organizations/:organizationId/digest/preferences']);
  for (const [method, pattern, policy] of ROUTE_POLICIES) {
    if (policy.kind === 'platform') assert.ok(isKnownPermission(policy.permission), `${method} ${pattern}: ${policy.permission}`);
    if (policy.kind !== 'tenant' && policy.kind !== 'orgParam') continue;
    assert.ok(policy.permissions.length > 0, `${method} ${pattern} has no permission`);
    for (const permission of policy.permissions) assert.ok(isKnownPermission(permission), `${method} ${pattern}: ${permission}`);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !readViaPost.has(`${method} ${pattern}`) && !personalSetting.has(`${method} ${pattern}`)) {
      assert.ok(policy.permissions.some((permission) => !viewOnly.has(permission)), `${method} ${pattern} is a write guarded only by ${policy.permissions.join(',')}`);
    }
  }
});
