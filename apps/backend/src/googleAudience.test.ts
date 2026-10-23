import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyGoogleAccessToken, type GoogleVerifierDeps } from './googleAudience';

const CLIENT = 'my-app.apps.googleusercontent.com';
const deps = (token: object, user: object | null = { email: 'Alice@Example.com', email_verified: true }): GoogleVerifierDeps => ({
  tokenInfo: async () => token,
  userInfo: async () => user,
});

test('a token issued to this app with a verified e-mail yields the lower-cased address', async () => {
  assert.equal(await verifyGoogleAccessToken('tok', CLIENT, deps({ aud: CLIENT })), 'alice@example.com');
});

test('a token issued to another OAuth client is rejected even though userinfo would succeed', async () => {
  assert.equal(await verifyGoogleAccessToken('tok', CLIENT, deps({ aud: 'someone-elses-app.apps.googleusercontent.com' })), null);
  assert.equal(await verifyGoogleAccessToken('tok', CLIENT, deps({})), null);
});

test('an unverified or missing e-mail is rejected', async () => {
  assert.equal(await verifyGoogleAccessToken('tok', CLIENT, deps({ aud: CLIENT }, { email: 'a@b.com', email_verified: false })), null);
  assert.equal(await verifyGoogleAccessToken('tok', CLIENT, deps({ aud: CLIENT }, { email: 'a@b.com' })), null, 'email_verified must be present and true');
  assert.equal(await verifyGoogleAccessToken('tok', CLIENT, deps({ aud: CLIENT }, { email_verified: true })), null);
  assert.equal(await verifyGoogleAccessToken('tok', CLIENT, deps({ aud: CLIENT }, null)), null);
  assert.equal(await verifyGoogleAccessToken('tok', CLIENT, deps({ aud: CLIENT, email_verified: false })), null);
});

test('tokeninfo and userinfo must agree on the address', async () => {
  assert.equal(await verifyGoogleAccessToken('tok', CLIENT, deps({ aud: CLIENT, email: 'mallory@example.com' })), null);
  assert.equal(await verifyGoogleAccessToken('tok', CLIENT, deps({ aud: CLIENT, email: 'ALICE@example.com' })), 'alice@example.com');
});

test('expired tokens, a missing client id, bad input and verifier errors all fail closed', async () => {
  assert.equal(await verifyGoogleAccessToken('tok', CLIENT, deps({ aud: CLIENT, expiry_date: Date.now() - 1000 })), null);
  assert.equal(await verifyGoogleAccessToken('tok', '', deps({ aud: CLIENT })), null);
  assert.equal(await verifyGoogleAccessToken('tok', undefined, deps({ aud: undefined })), null);
  assert.equal(await verifyGoogleAccessToken(undefined, CLIENT, deps({ aud: CLIENT })), null);
  assert.equal(await verifyGoogleAccessToken(42, CLIENT, deps({ aud: CLIENT })), null);
  const failing: GoogleVerifierDeps = { tokenInfo: async () => { throw new Error('invalid_token'); }, userInfo: async () => ({ email: 'a@b.com', email_verified: true }) };
  assert.equal(await verifyGoogleAccessToken('tok', CLIENT, failing), null);
});
