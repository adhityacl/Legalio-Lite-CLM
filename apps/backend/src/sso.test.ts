import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startMockOidc } from './mockOidcProvider';
import { checkEndpointUrl, clearOidcCaches, OidcError, oidcTuning, pkceChallenge } from './oidc';
import { mapRoleClaim, safeReturnTo } from './sso';
import { bootApp, ORIGIN, PASSWORD, type Harness } from './testHarness';

let h: Harness;
let idp: Awaited<ReturnType<typeof startMockOidc>>;
let legalId = '';
let otherDeptId = '';
const SECRET = 'client-secret-value';

before(async () => {
  idp = await startMockOidc();
  h = await bootApp({
    tag: 'sso', env: { WEBHOOK_ALLOW_HTTP: 'true', WEBHOOK_ALLOW_PRIVATE_NETWORKS: 'true' },
    orgs: [{ id: 'orgA', name: 'Org A' }, { id: 'orgB', name: 'Org B' }],
    users: [['adminA', 'orgA', 'admin'], ['editorA', 'orgA', 'editor', 'Legal'], ['adminB', 'orgB', 'admin'], ['memberB', 'orgB', 'editor', 'Ops'], ['outsider', null, 'viewer'], ['root', null, 'superuser']],
  });
  legalId = (await h.sql.get<{ id: string }>(`SELECT id FROM team WHERE "organizationId" = 'orgA' AND name = 'Legal'`))!.id;
  otherDeptId = (await h.sql.get<{ id: string }>(`SELECT id FROM team WHERE "organizationId" = 'orgB' AND name = 'Ops'`))!.id;
});
after(async () => { await h?.close(); await idp?.close(); });

const configBody = (extra: Record<string, unknown> = {}) => ({
  enabled: true, issuerUrl: idp.issuer, clientId: 'legalio-client', clientSecret: SECRET, allowedDomains: ['corp.test', 'example.com'], jitEnabled: true, defaultRole: 'viewer',
  defaultDepartmentIds: [legalId], roleClaim: 'groups',
  roleMapping: [{ value: 'legal-managers', role: 'manager', departmentIds: [legalId] }, { value: 'org-admins', role: 'admin', departmentIds: [] }], ...extra,
});
const save = (extra: Record<string, unknown> = {}, user = 'adminA', org = 'orgA') => h.api(user, 'PUT', `/api/organizations/${org}/sso`, { body: configBody(extra) });

interface Attempt { start: Response; callback: Response; location: string; cookies: string[]; session: string; error: string | null; returnTo: string }
/** The whole browser flow: start -> provider (auto-approves) -> callback. */
async function login(slug = 'org-a', options: { dropBinding?: boolean; tamperState?: boolean; reuseCallback?: boolean; query?: string } = {}): Promise<Attempt & { callbackUrl: string; binding: string }> {
  const start = await fetch(`${h.base}/api/sso/${slug}/start${options.query ?? ''}`, { redirect: 'manual' });
  const binding = /legalio_sso_bind=([^;]+)/.exec(start.headers.getSetCookie().join('\n'))?.[1] ?? '';
  const authorize = start.headers.get('location');
  if (start.status !== 302 || !authorize || !authorize.startsWith(idp.issuer)) {
    return { start, callback: start, location: authorize ?? '', cookies: [], session: '', error: new URL(authorize ?? '/', ORIGIN).searchParams.get('sso_error'), returnTo: '', callbackUrl: '', binding };
  }
  const approved = await fetch(authorize, { redirect: 'manual' });
  const back = new URL(approved.headers.get('location')!);
  if (options.tamperState) back.searchParams.set('state', `${back.searchParams.get('state')}x`);
  const callbackUrl = `${h.base}${back.pathname}${back.search}`;
  const callback = await fetch(callbackUrl, { redirect: 'manual', headers: options.dropBinding ? {} : { cookie: `legalio_sso_bind=${binding}` } });
  const cookies = callback.headers.getSetCookie();
  const session = /better-auth\.session_token=([^;]+)/.exec(cookies.join('\n'))?.[1] ?? '';
  const location = callback.headers.get('location') ?? '';
  return { start, callback, location, cookies, session, error: new URL(location || '/', ORIGIN).searchParams.get('sso_error'), returnTo: location, callbackUrl, binding };
}
const me = (session: string) => h.request('GET', '/api/me', { headers: { cookie: `better-auth.session_token=${session}` } });
const membershipOf = (email: string, org: string) => h.sql.get<any>(`SELECT m.role, m.status FROM member m JOIN "user" u ON u.id = m."userId" WHERE LOWER(u.email) = ? AND m."organizationId" = ?`, email, org);
const reset = () => { idp.reset(); clearOidcCaches(); };

/* ------------------------------ pure helpers ------------------------------ */

test('endpoint URLs go through the SSRF rules; return paths stay on this site', () => {
  const strict = { allowHttp: false, allowPrivateNetworks: false };
  for (const url of ['http://idp.example.com', 'https://169.254.169.254/', 'https://localhost/', 'https://10.0.0.5/realms/x', 'https://user:pw@idp.example.com']) {
    assert.throws(() => checkEndpointUrl(url, 'Issuer', strict), (err: unknown) => err instanceof OidcError && err.code === 'SSO_ENDPOINT_BLOCKED', url);
  }
  assert.equal(checkEndpointUrl('https://login.example.com/realms/x', 'Issuer', strict), 'https://login.example.com/realms/x');
  assert.equal(safeReturnTo('/app?tab=contracts'), '/app?tab=contracts');
  for (const bad of ['https://evil.example/', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/ok\nnext', undefined, 42]) assert.equal(safeReturnTo(bad), '/', String(bad));
  assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'RFC 7636 test vector');
  const provider = { role_claim: 'groups', role_mapping: JSON.stringify([{ value: 'a', role: 'viewer', departmentIds: ['d1'] }, { value: 'b', role: 'manager', departmentIds: ['d2'] }, { value: 'c', role: 'manager', departmentIds: ['d3'] }]) };
  assert.deepEqual(mapRoleClaim(provider, { groups: ['a', 'b', 'c', 'zzz'] }), { role: 'manager', departmentIds: ['d2', 'd3'] });
  assert.equal(mapRoleClaim(provider, { groups: ['zzz'] }), null);
  assert.deepEqual(mapRoleClaim(provider, { groups: 'a' }), { role: 'viewer', departmentIds: ['d1'] }, 'a single string claim works');
});

/* ------------------------------ configuration ------------------------------ */

test('administrators configure SSO; the client secret is sealed and never returned; others and other tenants cannot', async () => {
  const noAdmin = await h.api('editorA', 'PUT', '/api/organizations/orgA/sso', { body: configBody() });
  assert.equal(noAdmin.status, 403);
  assert.equal((await h.api('adminB', 'PUT', '/api/organizations/orgA/sso', { body: configBody() })).status, 404, 'another tenant sees nothing');
  assert.equal((await h.api('adminB', 'GET', '/api/organizations/orgA/sso')).status, 404);
  const saved = await save();
  assert.equal(saved.status, 200, saved.raw);
  assert.equal(saved.body.sso.clientSecretSet, true);
  assert.ok(!saved.raw.includes(SECRET), 'the secret is not echoed');
  const read = await h.api('adminA', 'GET', '/api/organizations/orgA/sso');
  assert.ok(!read.raw.includes(SECRET) && !read.raw.includes('v1:'), 'nothing sealed or secret leaves the server');
  assert.equal(read.body.redirectUri, `${ORIGIN}/api/sso/callback`);
  assert.equal(read.body.loginPath, '/sso/org-a');
  const stored = await h.sql.get<{ client_secret_sealed: string }>(`SELECT client_secret_sealed FROM sso_providers WHERE organization_id = 'orgA'`);
  assert.ok(stored!.client_secret_sealed.startsWith('v1:') && !stored!.client_secret_sealed.includes(SECRET));
  assert.equal((await h.api('adminA', 'POST', '/api/organizations/orgA/sso/test')).body.ok, true);
  assert.equal((await h.api('adminB', 'GET', '/api/organizations/orgB/sso')).body.sso, null, 'organization B has nothing configured');
  // The secret can be left out on a later save (kept), and validation rejects unsafe values.
  assert.equal((await save({ clientSecret: undefined })).status, 200);
  assert.equal((await save({ allowedDomains: [] })).status, 400, 'enabled needs a domain');
  assert.equal((await save({ allowedDomains: ['not a domain'] })).status, 400);
  assert.equal((await save({ defaultRole: 'admin' })).status, 400, 'JIT never defaults to admin');
  assert.equal((await save({ defaultDepartmentIds: [] })).status, 400, 'a non-admin default role needs a department');
  assert.equal((await save({ defaultDepartmentIds: [otherDeptId] })).status, 400, 'departments of another organization are refused');
  assert.equal((await save({ requireSso: true })).status, 400, 'SSO required needs a break-glass administrator');
  assert.equal((await save({ requireSso: true, breakGlassUserIds: ['editorA'] })).status, 400, 'break glass must be an administrator');
  assert.equal((await save({ issuerUrl: 'http://127.0.0.1:1' })).status, 422, 'an unreachable issuer cannot be enabled');
});

test('provider lookup reveals only organizations with SSO enabled, identically for unknown ones', async () => {
  const byDomain = await h.request('GET', '/api/sso/lookup?email=someone@corp.test');
  assert.deepEqual(byDomain.body.organizations, [{ slug: 'org-a', name: 'Org A' }]);
  assert.deepEqual((await h.request('GET', '/api/sso/lookup?slug=org-a')).body.organizations, [{ slug: 'org-a', name: 'Org A' }]);
  const unknown = await h.request('GET', '/api/sso/lookup?slug=does-not-exist');
  const withoutSso = await h.request('GET', '/api/sso/lookup?slug=org-b');
  assert.deepEqual(unknown.body, { organizations: [] });
  assert.deepEqual(withoutSso.body, unknown.body, 'an organization without SSO looks like a missing one');
  assert.deepEqual((await h.request('GET', '/api/sso/lookup?email=x@unrelated.test')).body.organizations, []);
  assert.deepEqual((await h.request('GET', '/api/sso/lookup?email=garbage')).body.organizations, []);
  const start = await fetch(`${h.base}/api/sso/org-b/start`, { redirect: 'manual' });
  assert.match(start.headers.get('location')!, /sso_error=SSO_NOT_ENABLED/);
});

/* ------------------------------ login flow ------------------------------ */

test('happy path: just-in-time provisioning from a claim mapping creates a real Better Auth session', async () => {
  reset();
  idp.state.claims = { sub: 'sub-new-1', email: 'New.Person@Corp.Test', email_verified: true, name: 'New Person', groups: ['legal-managers'] };
  const result = await login('org-a', { query: '?returnTo=/app%3Ftab%3Dcontracts' });
  assert.equal(result.callback.status, 302);
  assert.equal(result.error, null, result.location);
  assert.equal(result.returnTo, `${ORIGIN}/app?tab=contracts`, 'back to the page that was asked for');
  assert.ok(result.session, 'a session cookie is set');
  assert.ok(result.cookies.join('\n').toLowerCase().includes('httponly'));
  assert.ok(decodeURIComponent(result.session).includes('.'), 'the cookie is signed like Better Auth\'s own');
  const identity = await me(result.session);
  assert.equal(identity.status, 200, identity.raw);
  assert.equal(identity.body.identity.email, 'new.person@corp.test');
  assert.equal(identity.body.identity.emailVerified, true);
  assert.equal(identity.body.memberships.length, 1);
  assert.equal(identity.body.memberships[0].organizationId, 'orgA');
  assert.equal(identity.body.memberships[0].tenantRole, 'manager');
  assert.deepEqual(identity.body.memberships[0].departmentIds, [legalId]);
  assert.deepEqual(identity.body.signInMethods, ['sso']);
  // Better Auth itself accepts the cookie.
  const betterAuth = await fetch(`${h.base}/api/auth/get-session`, { headers: { cookie: `better-auth.session_token=${result.session}` } });
  assert.equal((await betterAuth.json() as any)?.user?.email, 'new.person@corp.test');
  const audits = await h.sql.all<{ action: string }>(`SELECT action FROM audit_log WHERE tenant_id = 'orgA' AND action LIKE 'sso.%' ORDER BY created_at`);
  assert.ok(audits.some((row) => row.action === 'sso.provision'));
  // A second login resolves through the linked subject, even if the address changes within an allowed domain.
  idp.state.claims = { sub: 'sub-new-1', email: 'renamed@corp.test', email_verified: true, name: 'New Person' };
  const again = await login();
  assert.equal(again.error, null);
  assert.equal((await me(again.session)).body.identity.id, identity.body.identity.id);
  assert.equal((await h.sql.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "user" WHERE LOWER(email) LIKE '%person%' OR email = 'renamed@corp.test'`))!.n, 1, 'no duplicate user');
});

test('the group mapping can grant admin and unmatched users get the default role', async () => {
  reset();
  idp.state.claims = { sub: 'sub-admin-1', email: 'boss@corp.test', email_verified: true, groups: ['org-admins'] };
  assert.equal((await login()).error, null);
  assert.equal((await membershipOf('boss@corp.test', 'orgA')).role, 'admin');
  idp.state.claims = { sub: 'sub-plain-1', email: 'plain@corp.test', email_verified: true, groups: ['something-else'] };
  assert.equal((await login()).error, null);
  assert.equal((await membershipOf('plain@corp.test', 'orgA')).role, 'viewer');
});

test('an existing local account that is a member of the organization is linked; role sync applies only when enabled', async () => {
  reset();
  idp.state.claims = { sub: 'sub-editor', email: 'editora@example.com', email_verified: true, groups: ['legal-managers'] };
  const first = await login();
  assert.equal(first.error, null, first.location);
  assert.equal((await me(first.session)).body.identity.id, 'editorA');
  assert.equal((await membershipOf('editora@example.com', 'orgA')).role, 'editor', 'roles are not touched unless sync is on');
  assert.equal((await save({ syncRoles: true })).status, 200);
  assert.equal((await login()).error, null);
  assert.equal((await membershipOf('editora@example.com', 'orgA')).role, 'manager');
  assert.equal((await save({ syncRoles: false })).status, 200);
});

test('account takeover is refused: a same-address local account that is not a member is never linked', async () => {
  reset();
  // outsider@example.com exists locally (no membership anywhere); memberb@example.com is a member of another organization only.
  for (const [sub, email] of [['sub-outsider', 'outsider@example.com'], ['sub-memberb', 'memberb@example.com']]) {
    idp.state.claims = { sub, email, email_verified: true };
    const attempt = await login();
    assert.equal(attempt.error, 'SSO_ACCOUNT_NOT_LINKED', email);
    assert.equal(attempt.session, '');
  }
  assert.equal(await membershipOf('outsider@example.com', 'orgA'), undefined);
  assert.equal(await membershipOf('memberb@example.com', 'orgA'), undefined, 'cross-tenant: no membership appears');
  assert.equal((await h.sql.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM sso_identities WHERE email IN ('outsider@example.com', 'memberb@example.com')`))!.n, 0);
});

const denied: Array<[string, Record<string, unknown>, Record<string, unknown>, string]> = [
  ['wrong audience', {}, { aud: 'some-other-client' }, 'SSO_TOKEN_INVALID'],
  ['wrong issuer', {}, { iss: 'https://evil.example.com' }, 'SSO_TOKEN_INVALID'],
  ['wrong nonce', {}, { nonce: 'not-the-nonce' }, 'SSO_TOKEN_INVALID'],
  ['missing nonce', {}, { nonce: null }, 'SSO_TOKEN_INVALID'],
  ['expired token', {}, { exp: 1_000_000 }, 'SSO_TOKEN_EXPIRED'],
  ['several audiences without azp', {}, { aud: ['legalio-client', 'other'] }, 'SSO_TOKEN_INVALID'],
  ['not yet valid', {}, { nbf: Math.floor(Date.now() / 1000) + 3600 }, 'SSO_TOKEN_INVALID'],
  ['unverified e-mail', { email_verified: false }, {}, 'SSO_EMAIL_UNVERIFIED'],
  ['e-mail verification claim missing', {}, { email_verified: null }, 'SSO_EMAIL_UNVERIFIED'],
  ['no e-mail', {}, { email: null }, 'SSO_EMAIL_MISSING'],
  ['disallowed domain', { email: 'intruder@evil.test' }, {}, 'SSO_DOMAIN_NOT_ALLOWED'],
  ['look-alike domain', { email: 'intruder@notcorp.test' }, {}, 'SSO_DOMAIN_NOT_ALLOWED'],
  ['subdomain of an allowed domain', { email: 'intruder@sub.corp.test' }, {}, 'SSO_DOMAIN_NOT_ALLOWED'],
];
for (const [name, claims, overrides, code] of denied) {
  test(`denied: ${name}`, async () => {
    reset();
    idp.state.claims = { sub: `sub-denied-${name}`, email: 'victim-of-test@corp.test', email_verified: true, ...claims };
    idp.state.overrides = overrides;
    const attempt = await login();
    assert.equal(attempt.error, code);
    assert.equal(attempt.session, '', 'no session cookie');
    assert.equal(await h.sql.get(`SELECT 1 FROM "user" WHERE LOWER(email) IN ('victim-of-test@corp.test', 'intruder@evil.test', 'intruder@notcorp.test', 'intruder@sub.corp.test')`), undefined, 'no account was created');
  });
}

test('denied: signatures that are not the provider\'s (unknown key, none, HMAC with the client secret)', async () => {
  for (const signWith of ['rogue', 'none', 'hs256'] as const) {
    reset();
    idp.state.signWith = signWith;
    idp.state.claims = { sub: `sub-${signWith}`, email: 'forged@corp.test', email_verified: true };
    const attempt = await login();
    assert.equal(attempt.error, 'SSO_TOKEN_INVALID', signWith);
    assert.equal(attempt.session, '');
  }
  assert.equal(await h.sql.get(`SELECT 1 FROM "user" WHERE email = 'forged@corp.test'`), undefined);
});

test('ES256 tokens verify, and a rotated signing key is picked up from the JWKS', async () => {
  reset();
  idp.state.signWith = 'ec';
  idp.state.jwksKeys = ['k1', 'e1'];
  idp.state.claims = { sub: 'sub-ec', email: 'ec@corp.test', email_verified: true };
  assert.equal((await login()).error, null);
  // The provider rotates to k2; the cached JWKS does not have it yet, so one refresh is attempted (the cooldown only limits how often).
  oidcTuning.jwksMissCooldownMs = 0;
  idp.state.signWith = 'k2';
  idp.state.jwksKeys = ['k1', 'e1', 'k2'];
  idp.state.claims = { sub: 'sub-ec', email: 'ec@corp.test', email_verified: true };
  const rotated = await login();
  assert.equal(rotated.error, null, 'a new key id triggers one JWKS refresh');
});

test('denied: tampered or missing state, missing browser binding, and replay of a used callback', async () => {
  reset();
  idp.state.claims = { sub: 'sub-state', email: 'state@corp.test', email_verified: true };
  assert.equal((await login('org-a', { tamperState: true })).error, 'SSO_STATE_INVALID');
  assert.equal((await login('org-a', { dropBinding: true })).error, 'SSO_STATE_INVALID', 'login CSRF: the callback must come from the browser that started the flow');
  const ok = await login();
  assert.equal(ok.error, null);
  const replay = await fetch(ok.callbackUrl, { redirect: 'manual', headers: { cookie: `legalio_sso_bind=${ok.binding}` } });
  assert.match(replay.headers.get('location')!, /sso_error=SSO_STATE_INVALID/, 'a state works once');
  assert.equal(replay.headers.getSetCookie().filter((c) => c.includes('better-auth.session_token')).length, 0);
  const bare = await fetch(`${h.base}/api/sso/callback`, { redirect: 'manual' });
  assert.match(bare.headers.get('location')!, /sso_error=SSO_STATE_INVALID/);
  // A provider error is reported without touching accounts.
  const start = await fetch(`${h.base}/api/sso/org-a/start`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const binding = /legalio_sso_bind=([^;]+)/.exec(start.headers.getSetCookie().join('\n'))![1];
  const refused = await fetch(`${h.base}/api/sso/callback?error=access_denied&state=${state}`, { redirect: 'manual', headers: { cookie: `legalio_sso_bind=${binding}` } });
  assert.match(refused.headers.get('location')!, /sso_error=SSO_PROVIDER_ERROR/);
});

test('the authorization request carries PKCE, state and nonce and the exact redirect URI', async () => {
  reset();
  const start = await fetch(`${h.base}/api/sso/org-a/start?login_hint=a@corp.test`, { redirect: 'manual' });
  const url = new URL(start.headers.get('location')!);
  assert.equal(url.origin, idp.issuer);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'legalio-client');
  assert.equal(url.searchParams.get('redirect_uri'), `${ORIGIN}/api/sso/callback`);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge')!.length >= 43);
  assert.ok(url.searchParams.get('state')!.length >= 32 && url.searchParams.get('nonce')!.length >= 24);
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('login_hint'), 'a@corp.test');
  const cookie = start.headers.getSetCookie().find((c) => c.startsWith('legalio_sso_bind='))!.toLowerCase();
  assert.ok(cookie.includes('httponly') && cookie.includes('samesite=lax') && cookie.includes('path=/api/sso'));
  const rows = await h.sql.all<any>(`SELECT * FROM sso_login_states WHERE state_hash = ?`, (await import('./oidc')).sha256Hex(url.searchParams.get('state')!));
  assert.equal(rows.length, 1);
  assert.ok(rows[0].code_verifier_sealed.startsWith('v1:'), 'the PKCE verifier is sealed at rest');
  assert.ok(!JSON.stringify(rows[0]).includes(url.searchParams.get('state')!), 'the state itself is not stored, only its hash');
  assert.equal(safeReturnTo(new URL(`${h.base}/x?returnTo=https://evil.example`).searchParams.get('returnTo')), '/');
});

test('client_secret_post is used when the provider does not offer basic authentication', async () => {
  reset();
  idp.state.authMethods = ['client_secret_post'];
  idp.state.claims = { sub: 'sub-post', email: 'post@corp.test', email_verified: true };
  clearOidcCaches();
  assert.equal((await login()).error, null);
});

test('just-in-time off: unknown people are refused, invitations still work, existing members still sign in', async () => {
  reset();
  assert.equal((await save({ jitEnabled: false })).status, 200);
  idp.state.claims = { sub: 'sub-stranger', email: 'stranger@corp.test', email_verified: true };
  const stranger = await login();
  assert.equal(stranger.error, 'SSO_NOT_PROVISIONED');
  assert.equal(await h.sql.get(`SELECT 1 FROM "user" WHERE email = 'stranger@corp.test'`), undefined);
  // An invitation to this organization lets exactly that address in, with the invited role.
  const invited = await h.api('adminA', 'POST', '/api/organizations/orgA/invitations', { body: { email: 'invited@corp.test', tenantRole: 'editor', departmentIds: [legalId] } });
  assert.ok(invited.status === 200 || invited.status === 201, invited.raw);
  idp.state.claims = { sub: 'sub-invited', email: 'invited@corp.test', email_verified: true };
  const joined = await login();
  assert.equal(joined.error, null, joined.location);
  assert.equal((await membershipOf('invited@corp.test', 'orgA')).role, 'editor');
  assert.equal((await h.sql.get<any>(`SELECT status FROM invitation WHERE LOWER(email) = 'invited@corp.test'`)).status, 'accepted');
  idp.state.claims = { sub: 'sub-editor', email: 'editora@example.com', email_verified: true };
  assert.equal((await login()).error, null, 'a linked member does not need JIT');
  assert.equal((await save({ jitEnabled: true })).status, 200);
});

test('a suspended member and a removed provider cannot sign in', async () => {
  reset();
  idp.state.claims = { sub: 'sub-plain-1', email: 'plain@corp.test', email_verified: true };
  await h.sql.run(`UPDATE member SET status = 'suspended' WHERE "organizationId" = 'orgA' AND "userId" = (SELECT id FROM "user" WHERE email = 'plain@corp.test')`);
  assert.equal((await login()).error, 'SSO_NOT_MEMBER');
  await h.sql.run(`UPDATE member SET status = 'active' WHERE "organizationId" = 'orgA' AND "userId" = (SELECT id FROM "user" WHERE email = 'plain@corp.test')`);
  assert.equal((await login()).error, null);
  await h.sql.run(`UPDATE "user" SET banned = true, "banReason" = 'x' WHERE email = 'plain@corp.test'`);
  assert.equal((await login()).error, 'SSO_ACCOUNT_DISABLED');
  await h.sql.run(`UPDATE "user" SET banned = false, "banReason" = NULL WHERE email = 'plain@corp.test'`);
});

test('cross-tenant: organization B configures its own provider; identities never cross over', async () => {
  reset();
  const saved = await h.api('adminB', 'PUT', '/api/organizations/orgB/sso', { body: { enabled: true, issuerUrl: idp.issuer, clientId: 'legalio-client', clientSecret: SECRET, allowedDomains: ['other.test'], jitEnabled: true, defaultRole: 'viewer', defaultDepartmentIds: [otherDeptId] } });
  assert.equal(saved.status, 200, saved.raw);
  // A corp.test address is not allowed in B, and the same subject in B is a different person than in A.
  idp.state.claims = { sub: 'sub-new-1', email: 'new.person@corp.test', email_verified: true };
  assert.equal((await login('org-b')).error, 'SSO_DOMAIN_NOT_ALLOWED');
  idp.state.claims = { sub: 'sub-new-1', email: 'b-person@other.test', email_verified: true };
  const inB = await login('org-b');
  assert.equal(inB.error, null, inB.location);
  const identity = await me(inB.session);
  assert.deepEqual(identity.body.memberships.map((m: any) => m.organizationId), ['orgB']);
  assert.notEqual(identity.body.identity.email, 'new.person@corp.test');
  // The B session cannot read A's SSO settings.
  const probe = await h.request('GET', '/api/organizations/orgA/sso', { headers: { cookie: `better-auth.session_token=${inB.session}` } });
  assert.equal(probe.status, 404);
  assert.equal((await h.api('adminA', 'GET', '/api/organizations/orgB/sso')).status, 404);
  assert.deepEqual((await h.request('GET', '/api/sso/lookup?email=x@other.test')).body.organizations, [{ slug: 'org-b', name: 'Org B' }]);
  assert.equal((await h.api('adminB', 'DELETE', '/api/organizations/orgB/sso')).status, 204);
  assert.equal((await h.sql.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM sso_identities WHERE organization_id = 'orgB'`))!.n, 0);
  assert.equal((await h.sql.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM sso_providers WHERE organization_id = 'orgA'`))!.n, 1, 'A is untouched');
});

/* ------------------------------ SSO required ------------------------------ */

const passwordLogin = (email: string) => h.request('POST', '/api/auth/sign-in/email', { headers: { origin: ORIGIN }, body: { email, password: PASSWORD } });

test('SSO required: members cannot use a password, break-glass administrators and others still can', async () => {
  reset();
  assert.equal((await passwordLogin('editora@example.com')).status, 200, 'before: password works');
  const on = await save({ requireSso: true, breakGlassUserIds: ['adminA'] });
  assert.equal(on.status, 200, on.raw);
  const blocked = await passwordLogin('editora@example.com');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'SSO_REQUIRED');
  assert.equal((await passwordLogin('adminb@example.com')).status, 200, 'another organization\'s members are unaffected');
  assert.equal((await passwordLogin('outsider@example.com')).status, 200, 'non-members are unaffected');
  assert.equal((await passwordLogin('root@example.com')).status, 200, 'platform superusers are never locked out');
  assert.equal((await passwordLogin('adminA@example.com')).status, 200, 'the break-glass administrator signs in with a password');
  // ... but only while they are still an administrator of the organization.
  await h.sql.run(`UPDATE member SET role = 'editor' WHERE "userId" = 'adminA' AND "organizationId" = 'orgA'`);
  assert.equal((await passwordLogin('adminA@example.com')).status, 403);
  await h.sql.run(`UPDATE member SET role = 'admin' WHERE "userId" = 'adminA' AND "organizationId" = 'orgA'`);
  // SSO itself keeps working for the same people.
  idp.state.claims = { sub: 'sub-editor', email: 'editora@example.com', email_verified: true };
  const viaSso = await login();
  assert.equal(viaSso.error, null);
  assert.equal((await me(viaSso.session)).status, 200);
  // Social sign-in is not available at all.
  const social = await h.request('POST', '/api/auth/sign-in/social', { headers: { origin: ORIGIN }, body: { provider: 'google' } });
  assert.notEqual(social.status, 200);
  // Turning it off restores passwords.
  assert.equal((await save({ requireSso: false })).status, 200);
  assert.equal((await passwordLogin('editora@example.com')).status, 200);
  // Disabling SSO entirely also lifts the requirement (a disabled provider enforces nothing).
  assert.equal((await save({ requireSso: true, breakGlassUserIds: ['adminA'] })).status, 200);
  assert.equal((await passwordLogin('editora@example.com')).status, 403);
  assert.equal((await save({ enabled: false, requireSso: false })).status, 200);
  assert.equal((await passwordLogin('editora@example.com')).status, 200);
  assert.equal((await save({ enabled: true })).status, 200);
});

test('a disabled provider refuses new logins', async () => {
  reset();
  assert.equal((await save({ enabled: false })).status, 200);
  assert.match((await fetch(`${h.base}/api/sso/org-a/start`, { redirect: 'manual' })).headers.get('location')!, /sso_error=SSO_NOT_ENABLED/);
  assert.deepEqual((await h.request('GET', '/api/sso/lookup?slug=org-a')).body.organizations, []);
  assert.equal((await save({ enabled: true })).status, 200);
});
