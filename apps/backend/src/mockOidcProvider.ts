/**
 * Tests and manual smoke runs only: a small OpenID Connect provider (discovery, JWKS, authorize, token) with generated keys.
 *
 * `/authorize` approves immediately and redirects back with a code, so a plain HTTP client can walk the whole flow. What the next
 * ID token contains is steered through `provider.state` (in-process) or `POST /_control` (from curl):
 *   claims     merged into the default claims (email, email_verified, name, sub, groups ...)
 *   overrides  applied to the final payload; a null value deletes the claim (e.g. { "nonce": "wrong", "aud": "other", "exp": 1 })
 *   signWith   k1 (default) | k2 | ec | rogue (a key that is not in the JWKS) | none | hs256
 *   jwksKeys   key ids published by /jwks (default ["k1"]; publish "k2" to test rotation)
 */
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

type SignWith = 'k1' | 'k2' | 'ec' | 'rogue' | 'none' | 'hs256';
export interface MockState {
  clientId: string; clientSecret: string;
  claims: Record<string, unknown>; overrides: Record<string, unknown>;
  signWith: SignWith; jwksKeys: string[];
  authMethods: string[] | undefined;
}

const b64 = (value: Buffer | string) => Buffer.from(value).toString('base64url');

export async function startMockOidc(options: { port?: number; clientId?: string; clientSecret?: string } = {}) {
  const rsa = (kid: string) => { const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); return { kid, alg: 'RS256', ...pair }; };
  const keys: Record<string, { kid: string; alg: string; publicKey: crypto.KeyObject; privateKey: crypto.KeyObject }> = {
    k1: rsa('k1'), k2: rsa('k2'), rogue: rsa('k1'),
    ec: { kid: 'e1', alg: 'ES256', ...crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }) },
  };
  const state: MockState = {
    clientId: options.clientId ?? 'legalio-client', clientSecret: options.clientSecret ?? 'client-secret-value',
    claims: { sub: 'idp-user-1', email: 'person@corp.test', email_verified: true, name: 'Pat Person' }, overrides: {}, signWith: 'k1', jwksKeys: ['k1'], authMethods: undefined,
  };
  const codes = new Map<string, { nonce: string; challenge: string; redirectUri: string; used: boolean }>();
  const log: Array<{ path: string; query?: Record<string, string> }> = [];
  let issuer = '';

  const sign = (payload: Record<string, unknown>) => {
    const which = state.signWith;
    const header: Record<string, unknown> = { typ: 'JWT' };
    let signature = Buffer.alloc(0);
    let input: string;
    if (which === 'none') { header.alg = 'none'; input = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(payload))}`; return `${input}.`; }
    if (which === 'hs256') {
      header.alg = 'HS256'; header.kid = 'k1'; input = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(payload))}`;
      return `${input}.${b64(crypto.createHmac('sha256', state.clientSecret).update(input).digest())}`;
    }
    const key = keys[which];
    header.alg = key.alg; header.kid = key.kid;
    input = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(payload))}`;
    signature = key.alg === 'ES256'
      ? crypto.sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' })
      : crypto.sign('sha256', Buffer.from(input), key.privateKey);
    return `${input}.${b64(signature)}`;
  };

  const readBody = (req: http.IncomingMessage) => new Promise<string>((resolve) => { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => resolve(body)); });
  const json = (res: http.ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const path = url.pathname;
    log.push({ path, query: Object.fromEntries(url.searchParams) });
    if (path === '/.well-known/openid-configuration') {
      return json(res, 200, {
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
        id_token_signing_alg_values_supported: ['RS256', 'ES256'], code_challenge_methods_supported: ['S256'], response_types_supported: ['code'],
        ...(state.authMethods ? { token_endpoint_auth_methods_supported: state.authMethods } : {}),
      });
    }
    if (path === '/jwks') {
      return json(res, 200, { keys: state.jwksKeys.map((id) => { const key = keys[id] ?? Object.values(keys).find((k) => k.kid === id)!; return { ...key.publicKey.export({ format: 'jwk' }), kid: key.kid, alg: key.alg, use: 'sig' }; }) });
    }
    if (path === '/authorize') {
      const q = url.searchParams;
      if (q.get('client_id') !== state.clientId || q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || !q.get('state') || !q.get('nonce') || !q.get('redirect_uri')) {
        return json(res, 400, { error: 'invalid_request' });
      }
      const code = crypto.randomBytes(16).toString('hex');
      codes.set(code, { nonce: q.get('nonce')!, challenge: q.get('code_challenge')!, redirectUri: q.get('redirect_uri')!, used: false });
      const back = new URL(q.get('redirect_uri')!);
      back.searchParams.set('code', code);
      back.searchParams.set('state', q.get('state')!);
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (path === '/token' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      let id = form.get('client_id') ?? '';
      let secret = form.get('client_secret') ?? '';
      const basic = /^Basic (.+)$/.exec(String(req.headers.authorization || ''));
      if (basic) { const [a, b] = Buffer.from(basic[1], 'base64').toString().split(':'); id = decodeURIComponent(a); secret = decodeURIComponent(b ?? ''); }
      const entry = codes.get(form.get('code') ?? '');
      const verifier = form.get('code_verifier') ?? '';
      if (id !== state.clientId || secret !== state.clientSecret || !entry || entry.used || form.get('redirect_uri') !== entry.redirectUri
        || crypto.createHash('sha256').update(verifier).digest('base64url') !== entry.challenge) {
        return json(res, 400, { error: 'invalid_grant' });
      }
      entry.used = true;
      const now = Math.floor(Date.now() / 1000);
      const payload: Record<string, unknown> = { iss: issuer, aud: state.clientId, exp: now + 300, iat: now, nonce: entry.nonce, ...state.claims };
      for (const [key, value] of Object.entries(state.overrides)) { if (value === null) delete payload[key]; else payload[key] = value; }
      return json(res, 200, { access_token: crypto.randomBytes(8).toString('hex'), token_type: 'Bearer', id_token: sign(payload) });
    }
    if (path === '/_control' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      if (body.claims) state.claims = { ...state.claims, ...body.claims };
      if (body.replaceClaims) state.claims = body.replaceClaims;
      if (body.overrides) state.overrides = body.overrides;
      if (body.signWith) state.signWith = body.signWith;
      if (body.jwksKeys) state.jwksKeys = body.jwksKeys;
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not_found' });
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    issuer, state, log, codes,
    reset() { state.claims = { sub: 'idp-user-1', email: 'person@corp.test', email_verified: true, name: 'Pat Person' }; state.overrides = {}; state.signWith = 'k1'; state.jwksKeys = ['k1']; state.authMethods = undefined; },
    close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

if (process.argv[1] && /mockOidcProvider\.[cm]?[jt]s$/.test(process.argv[1])) {
  const port = Number(process.env.MOCK_OIDC_PORT) || 4555;
  startMockOidc({ port }).then((p) => console.log(`mock OIDC provider at ${p.issuer} (client legalio-client / client-secret-value)`));
}
