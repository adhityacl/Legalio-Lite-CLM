/**
 * OpenID Connect relying-party primitives (authorization-code flow with PKCE).
 *
 * Everything here is protocol only: discovery, JWKS caching, ID-token verification and the code exchange. Which user a verified token
 * maps to is decided in sso.ts. All outbound requests go through the webhook SSRF guard (ssrfGuard.ts): the issuer, the discovered
 * `jwks_uri` and `token_endpoint` must be public https addresses (http / private ranges only when the same development switches as the
 * webhooks allow them), nothing is redirected, and responses are size-capped.
 *
 * ID-token rules (OIDC Core 3.1.3.7): asymmetric signatures only (RS/PS/ES families; `none` and HMAC are rejected), `iss` equals the
 * configured issuer exactly, `aud` contains the client id (with `azp` equal to it when there are several audiences), `exp`/`nbf`/`iat`
 * are checked with a small clock skew, and `nonce` equals the value stored when the login started.
 */
import crypto from 'node:crypto';
import { outboundPolicyFromEnv, outboundRequest, parseOutboundUrl, SsrfError, type OutboundOptions, type OutboundPolicy, type OutboundResult } from './ssrfGuard';

export class OidcError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export type OutboundFn = (url: string, options?: OutboundOptions) => Promise<OutboundResult>;
export interface OidcDeps {
  policy?: OutboundPolicy;
  request?: OutboundFn;
  now?: () => number;
}

const MAX_BODY = 512 * 1024;
const TIMEOUT_MS = 8000;
const CLOCK_SKEW_SECONDS = 120;
const SIGNING_ALGS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'] as const;

const b64url = (buffer: Buffer) => buffer.toString('base64url');
export const randomToken = (bytes = 32) => b64url(crypto.randomBytes(bytes));
export const sha256Hex = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
export const pkceChallenge = (verifier: string) => b64url(crypto.createHash('sha256').update(verifier).digest());

/* ------------------------------ discovery ------------------------------ */

export interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  id_token_signing_alg_values_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  code_challenge_methods_supported?: string[];
}

const policyOf = (deps: OidcDeps) => deps.policy ?? outboundPolicyFromEnv();
const requestOf = (deps: OidcDeps): OutboundFn => deps.request ?? outboundRequest;

/** A URL typed by an administrator or returned by a provider: validated before any connection. */
export function checkEndpointUrl(value: unknown, label: string, policy: OutboundPolicy): string {
  try {
    return parseOutboundUrl(value, policy).toString();
  } catch (err) {
    if (err instanceof SsrfError) throw new OidcError('SSO_ENDPOINT_BLOCKED', `${label}: ${err.message}`);
    throw err;
  }
}

async function getJson(url: string, deps: OidcDeps, label: string): Promise<any> {
  const policy = policyOf(deps);
  checkEndpointUrl(url, label, policy);
  let response: OutboundResult;
  try {
    response = await requestOf(deps)(url, { method: 'GET', headers: { accept: 'application/json', 'user-agent': 'Legalio-SSO/1' }, timeoutMs: TIMEOUT_MS, maxResponseBytes: MAX_BODY, policy });
  } catch (err) {
    if (err instanceof SsrfError) throw new OidcError('SSO_ENDPOINT_BLOCKED', `${label}: ${err.message}`);
    throw new OidcError('SSO_PROVIDER_UNREACHABLE', `${label} could not be reached.`);
  }
  if (response.truncated) throw new OidcError('SSO_PROVIDER_INVALID', `${label} response is too large.`);
  if (response.statusCode !== 200) throw new OidcError('SSO_PROVIDER_INVALID', `${label} answered with HTTP ${response.statusCode}.`);
  try { return JSON.parse(response.body); } catch { throw new OidcError('SSO_PROVIDER_INVALID', `${label} did not return JSON.`); }
}

const trimSlash = (value: string) => value.replace(/\/+$/, '');
const discoveryCache = new Map<string, { at: number; doc: DiscoveryDocument }>();
const DISCOVERY_TTL_MS = 10 * 60_000;

/** Fetches `<issuer>/.well-known/openid-configuration`; the document's `issuer` must equal the configured one (no mix-up between providers). */
export async function discover(issuer: string, deps: OidcDeps = {}, options: { fresh?: boolean } = {}): Promise<DiscoveryDocument> {
  const policy = policyOf(deps);
  const issuerUrl = checkEndpointUrl(issuer, 'Issuer URL', policy);
  const now = (deps.now ?? Date.now)();
  const cached = discoveryCache.get(issuer);
  if (!options.fresh && cached && now - cached.at < DISCOVERY_TTL_MS) return cached.doc;
  const doc = await getJson(`${trimSlash(issuerUrl)}/.well-known/openid-configuration`, deps, 'Discovery document');
  if (!doc || typeof doc !== 'object' || trimSlash(String(doc.issuer ?? '')) !== trimSlash(issuer)) {
    throw new OidcError('SSO_PROVIDER_INVALID', 'The discovery document names a different issuer.');
  }
  for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    if (typeof doc[key] !== 'string') throw new OidcError('SSO_PROVIDER_INVALID', `The discovery document has no ${key}.`);
    checkEndpointUrl(doc[key], key, policy);
  }
  if (Array.isArray(doc.code_challenge_methods_supported) && !doc.code_challenge_methods_supported.includes('S256')) {
    throw new OidcError('SSO_PROVIDER_INVALID', 'The provider does not support PKCE (S256).');
  }
  const result: DiscoveryDocument = {
    issuer: doc.issuer, authorization_endpoint: doc.authorization_endpoint, token_endpoint: doc.token_endpoint, jwks_uri: doc.jwks_uri,
    id_token_signing_alg_values_supported: Array.isArray(doc.id_token_signing_alg_values_supported) ? doc.id_token_signing_alg_values_supported.map(String) : undefined,
    token_endpoint_auth_methods_supported: Array.isArray(doc.token_endpoint_auth_methods_supported) ? doc.token_endpoint_auth_methods_supported.map(String) : undefined,
    code_challenge_methods_supported: Array.isArray(doc.code_challenge_methods_supported) ? doc.code_challenge_methods_supported.map(String) : undefined,
  };
  discoveryCache.set(issuer, { at: now, doc: result });
  return result;
}

/* ------------------------------ JWKS ------------------------------ */

interface Jwk extends crypto.JsonWebKey { kid?: string; use?: string; alg?: string }
const jwksCache = new Map<string, { at: number; fetchedForKidMissAt: number; keys: Jwk[] }>();
const JWKS_TTL_MS = 10 * 60_000;
/** Tests shorten the cooldown between JWKS refreshes triggered by an unknown key id. */
export const oidcTuning = { jwksMissCooldownMs: 30_000 };

export function clearOidcCaches() { discoveryCache.clear(); jwksCache.clear(); }

async function loadJwks(jwksUri: string, deps: OidcDeps, force: boolean): Promise<Jwk[]> {
  const now = (deps.now ?? Date.now)();
  const cached = jwksCache.get(jwksUri);
  if (!force && cached && now - cached.at < JWKS_TTL_MS) return cached.keys;
  const body = await getJson(jwksUri, deps, 'JWKS');
  if (!body || !Array.isArray(body.keys)) throw new OidcError('SSO_PROVIDER_INVALID', 'The JWKS document has no keys.');
  const keys = (body.keys as Jwk[]).filter((key) => key && typeof key === 'object' && (key.use === undefined || key.use === 'sig'));
  jwksCache.set(jwksUri, { at: now, fetchedForKidMissAt: now, keys });
  return keys;
}

/** The signing key for `kid`: cached keys first, and at most one forced refresh per 30 s when the key id is unknown (key rotation). */
async function findKey(jwksUri: string, header: { kid?: string; alg: string }, deps: OidcDeps): Promise<Jwk> {
  const pick = (keys: Jwk[]) => {
    const family = header.alg.startsWith('ES') ? 'EC' : 'RSA';
    const candidates = keys.filter((key) => key.kty === family && (!key.alg || key.alg === header.alg));
    if (header.kid) return candidates.find((key) => key.kid === header.kid);
    return candidates.length === 1 ? candidates[0] : undefined;
  };
  let key = pick(await loadJwks(jwksUri, deps, false));
  if (!key) {
    const cached = jwksCache.get(jwksUri);
    const now = (deps.now ?? Date.now)();
    if (!cached || now - cached.fetchedForKidMissAt >= oidcTuning.jwksMissCooldownMs) key = pick(await loadJwks(jwksUri, deps, true));
  }
  if (!key) throw new OidcError('SSO_TOKEN_INVALID', 'The token is signed with an unknown key.');
  return key;
}

/* ------------------------------ ID token ------------------------------ */

export interface IdTokenClaims {
  iss: string; sub: string; aud: string | string[]; exp: number; iat?: number; nbf?: number; nonce?: string; azp?: string;
  email?: string; email_verified?: boolean | string; name?: string; [claim: string]: unknown;
}

function decodePart(part: string): any {
  try { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); } catch { throw new OidcError('SSO_TOKEN_INVALID', 'The token is malformed.'); }
}

function verifySignature(alg: string, key: Jwk, signingInput: string, signature: Buffer): boolean {
  const hash = `sha${alg.slice(2)}`;
  const publicKey = crypto.createPublicKey({ key: key as crypto.JsonWebKey, format: 'jwk' });
  if (alg.startsWith('ES')) return crypto.verify(hash, Buffer.from(signingInput), { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
  if (alg.startsWith('PS')) {
    return crypto.verify(hash, Buffer.from(signingInput), { key: publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }, signature);
  }
  return crypto.verify(hash, Buffer.from(signingInput), publicKey, signature);
}

export interface VerifyOptions { issuer: string; clientId: string; nonce: string; jwksUri: string; allowedAlgs?: string[] }

/** Verifies signature and claims; throws OidcError('SSO_TOKEN_INVALID') for anything wrong. Returns the claims. */
export async function verifyIdToken(idToken: unknown, options: VerifyOptions, deps: OidcDeps = {}): Promise<IdTokenClaims> {
  if (typeof idToken !== 'string' || idToken.length > 16 * 1024) throw new OidcError('SSO_TOKEN_INVALID', 'The token is missing.');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new OidcError('SSO_TOKEN_INVALID', 'The token is malformed.');
  const header = decodePart(parts[0]);
  const alg = String(header?.alg ?? '');
  if (!(SIGNING_ALGS as readonly string[]).includes(alg)) throw new OidcError('SSO_TOKEN_INVALID', 'The token uses an unsupported signature algorithm.');
  if (options.allowedAlgs?.length && !options.allowedAlgs.includes(alg)) throw new OidcError('SSO_TOKEN_INVALID', 'The token algorithm is not one the provider advertises.');
  const key = await findKey(options.jwksUri, { kid: typeof header.kid === 'string' ? header.kid : undefined, alg }, deps);
  let valid = false;
  try { valid = verifySignature(alg, key, `${parts[0]}.${parts[1]}`, Buffer.from(parts[2], 'base64url')); } catch { valid = false; }
  if (!valid) throw new OidcError('SSO_TOKEN_INVALID', 'The token signature is not valid.');
  const claims = decodePart(parts[1]) as IdTokenClaims;
  const nowSeconds = Math.floor((deps.now ?? Date.now)() / 1000);
  if (trimSlash(String(claims.iss ?? '')) !== trimSlash(options.issuer)) throw new OidcError('SSO_TOKEN_INVALID', 'The token was issued by a different provider.');
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(options.clientId)) throw new OidcError('SSO_TOKEN_INVALID', 'The token was issued for a different client.');
  if (audiences.length > 1 && claims.azp !== options.clientId) throw new OidcError('SSO_TOKEN_INVALID', 'The authorized party does not match.');
  if (claims.azp !== undefined && claims.azp !== options.clientId) throw new OidcError('SSO_TOKEN_INVALID', 'The authorized party does not match.');
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) throw new OidcError('SSO_TOKEN_EXPIRED', 'The token has expired.');
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > nowSeconds) throw new OidcError('SSO_TOKEN_INVALID', 'The token is not valid yet.');
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SECONDS > nowSeconds) throw new OidcError('SSO_TOKEN_INVALID', 'The token was issued in the future.');
  if (typeof claims.nonce !== 'string' || !timingSafeEqual(claims.nonce, options.nonce)) throw new OidcError('SSO_TOKEN_INVALID', 'The token nonce does not match.');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw new OidcError('SSO_TOKEN_INVALID', 'The token has no subject.');
  return claims;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/* ------------------------------ authorization request and code exchange ------------------------------ */

export function buildAuthorizationUrl(doc: DiscoveryDocument, params: { clientId: string; redirectUri: string; scopes: string; state: string; nonce: string; codeVerifier: string; loginHint?: string }): string {
  const url = new URL(doc.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', params.scopes);
  url.searchParams.set('state', params.state);
  url.searchParams.set('nonce', params.nonce);
  url.searchParams.set('code_challenge', pkceChallenge(params.codeVerifier));
  url.searchParams.set('code_challenge_method', 'S256');
  if (params.loginHint) url.searchParams.set('login_hint', params.loginHint);
  return url.toString();
}

/** Exchanges the code at the token endpoint (client_secret_basic unless the provider only offers client_secret_post). Returns the raw id_token. */
export async function exchangeCode(doc: DiscoveryDocument, params: { clientId: string; clientSecret: string; code: string; redirectUri: string; codeVerifier: string }, deps: OidcDeps = {}): Promise<string> {
  const policy = policyOf(deps);
  const form = new URLSearchParams({ grant_type: 'authorization_code', code: params.code, redirect_uri: params.redirectUri, code_verifier: params.codeVerifier });
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': 'Legalio-SSO/1' };
  const methods = doc.token_endpoint_auth_methods_supported;
  if (!methods || methods.includes('client_secret_basic')) {
    headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(params.clientId)}:${encodeURIComponent(params.clientSecret)}`).toString('base64')}`;
  } else if (methods.includes('client_secret_post')) {
    form.set('client_id', params.clientId);
    form.set('client_secret', params.clientSecret);
  } else {
    throw new OidcError('SSO_PROVIDER_INVALID', 'The provider supports no client authentication method Legalio can use.');
  }
  let response: OutboundResult;
  try {
    response = await requestOf(deps)(doc.token_endpoint, { method: 'POST', headers, body: form.toString(), timeoutMs: TIMEOUT_MS, maxResponseBytes: MAX_BODY, policy });
  } catch (err) {
    if (err instanceof SsrfError) throw new OidcError('SSO_ENDPOINT_BLOCKED', err.message);
    throw new OidcError('SSO_PROVIDER_UNREACHABLE', 'The token endpoint could not be reached.');
  }
  let body: any = null;
  try { body = JSON.parse(response.body); } catch { /* handled below */ }
  if (response.statusCode !== 200 || !body || typeof body.id_token !== 'string') {
    throw new OidcError('SSO_CODE_REJECTED', 'The provider did not accept the authorization code.');
  }
  return body.id_token;
}

/** Verified-claim helpers shared with sso.ts. */
export const isTrue = (value: unknown) => value === true || value === 'true';
