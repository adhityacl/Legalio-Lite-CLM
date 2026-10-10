/**
 * Google credential upload (service account + OAuth client JSON).
 * Run: npx tsx --test tests/googleCredentials.test.ts
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import express from 'express';
import { createGoogleCredentialStore, createGoogleCredentialsRouter } from '../apps/backend/src/googleCredentials';
import { getGoogleDriveClient, getGoogleSheetsClient, loadServiceAccountCredentials, setStoredServiceAccountProvider } from '../apps/backend/src/lib/googleServiceAccountAuth';
import { parseOAuthClientFile, parseServiceAccountFile } from '@legalio/shared/googleCredentialFiles';
import { needsOrganizationSelector } from '../apps/frontend/src/lib/apiFetch';

for (const key of ['GOOGLE_CLIENT_ID', 'VITE_GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_SERVICE_ACCOUNT_KEY', 'GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY']) {
  delete process.env[key];
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = '/nonexistent/credentials.json';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: 'demo-project',
  private_key_id: 'abc',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  client_email: 'bot@demo-project.iam.gserviceaccount.com',
  client_id: '123',
  token_uri: 'https://oauth2.googleapis.com/token',
};
const OAUTH_CLIENT = {
  web: {
    client_id: '42-abc.apps.googleusercontent.com',
    project_id: 'demo-project',
    client_secret: 'GOCSPX-test-secret',
    redirect_uris: ['http://localhost:3000'],
    javascript_origins: ['http://localhost:3000'],
  },
};

const db = new Database(':memory:');
const store = createGoogleCredentialStore(db);
setStoredServiceAccountProvider(store.getServiceAccount);

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const role = String(req.headers['x-test-role'] || '');
  (req as any).identity = role && role !== 'actor-only' ? { userId: `u-${role}`, platformRole: role === 'superuser' ? 'superuser' : 'user' } : null;
  (req as any).actor = { id: 'legacy-actor', role: 'superuser' };
  next();
});
app.use('/api', createGoogleCredentialsRouter(store));
const server = app.listen(0);
after(() => server.close());
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/integrations/google/credentials`;

async function call(role: string, method: string, path = '', body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-role': role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

test('file parsers reject swapped or malformed files', () => {
  assert.equal(parseServiceAccountFile(SERVICE_ACCOUNT).ok, true);
  assert.deepEqual(parseServiceAccountFile(OAUTH_CLIENT), { ok: false, code: 'looks_like_oauth_client' });
  assert.deepEqual(parseOAuthClientFile(SERVICE_ACCOUNT), { ok: false, code: 'looks_like_service_account' });
  assert.deepEqual(parseServiceAccountFile({ type: 'service_account', client_email: 'x' }), { ok: false, code: 'missing_fields' });
  assert.deepEqual(parseOAuthClientFile({ web: { client_id: 'nope', client_secret: 's' } }), { ok: false, code: 'invalid_client_id' });
  const desktop = parseOAuthClientFile({ installed: { client_id: '1-x.apps.googleusercontent.com', client_secret: 's' } });
  assert.equal(desktop.ok, true, 'desktop ("installed") clients are accepted');
});

test('only a superuser can read or change credentials', async () => {
  assert.equal((await call('admin', 'GET')).status, 403);
  assert.equal((await call('actor-only', 'GET')).status, 403, 'a legacy actor cannot grant platform access');
  assert.equal((await call('', 'PUT', '/oauth-client', { file: OAUTH_CLIENT })).status, 403);
  assert.equal((await call('superuser', 'GET')).status, 200);
});

test('platform credential requests never receive an organization selector', () => {
  for (const path of ['', '/service-account', '/oauth-client']) {
    assert.equal(needsOrganizationSelector(`/api/integrations/google/credentials${path}`), false);
  }
  assert.equal(needsOrganizationSelector('/api/integrations/google/credentials-other'), true);
});

test('upload, use, and remove both files', async () => {
  const empty = await call('superuser', 'GET');
  assert.equal(empty.body.serviceAccount.source, null);
  assert.equal(empty.body.oauthClient.source, null);
  assert.equal(loadServiceAccountCredentials(undefined, false), null);

  const bad = await call('superuser', 'PUT', '/service-account', { file: { ...SERVICE_ACCOUNT, private_key: '-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_private_key');
  assert.equal((await call('superuser', 'PUT', '/service-account', { file: OAUTH_CLIENT })).body.error, 'looks_like_oauth_client');

  const sa = await call('superuser', 'PUT', '/service-account', { file: SERVICE_ACCOUNT });
  assert.equal(sa.status, 200);
  assert.equal(sa.body.serviceAccount.source, 'upload');
  assert.equal(sa.body.serviceAccount.client_email, SERVICE_ACCOUNT.client_email);
  assert.ok(!JSON.stringify(sa.body).includes('PRIVATE KEY'), 'the private key is never sent back');
  assert.equal(loadServiceAccountCredentials(undefined, false)?.client_email, SERVICE_ACCOUNT.client_email, 'Drive/Sheets clients now use the upload');
  const drive = getGoogleDriveClient();
  const sheets = getGoogleSheetsClient();
  assert.equal((drive.context._options.auth as any).email, SERVICE_ACCOUNT.client_email);
  assert.equal((sheets.context._options.auth as any).email, SERVICE_ACCOUNT.client_email);
  assert.equal(typeof drive.files.list, 'function');
  assert.equal(typeof sheets.spreadsheets.values.get, 'function');

  const oauth = await call('superuser', 'PUT', '/oauth-client', { file: OAUTH_CLIENT });
  assert.equal(oauth.body.oauthClient.client_id, OAUTH_CLIENT.web.client_id);
  assert.deepEqual(oauth.body.oauthClient.javascript_origins, ['http://localhost:3000']);
  assert.ok(!JSON.stringify(oauth.body).includes('GOCSPX'), 'the client secret is never sent back');
  assert.deepEqual(store.getOAuthClient(), { clientId: OAUTH_CLIENT.web.client_id, clientSecret: 'GOCSPX-test-secret' });

  process.env.GOOGLE_CLIENT_ID = 'env-id.apps.googleusercontent.com';
  assert.equal(store.getOAuthClient().clientId, OAUTH_CLIENT.web.client_id, 'uploaded file wins over .env');
  await call('superuser', 'DELETE', '/oauth-client');
  assert.equal(store.getOAuthClient().clientId, 'env-id.apps.googleusercontent.com', 'falls back to .env after removal');
  assert.equal((await call('superuser', 'GET')).body.oauthClient.source, 'env');
  delete process.env.GOOGLE_CLIENT_ID;

  await call('superuser', 'DELETE', '/service-account');
  assert.equal(loadServiceAccountCredentials(undefined, false), null);
});
