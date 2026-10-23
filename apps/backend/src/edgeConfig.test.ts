import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createSensitiveRateLimiter, rateLimitOptions, trustProxySetting } from './edgeConfig';

test('trust proxy defaults to private ranges and is configurable', () => {
  assert.equal(trustProxySetting({}), 'loopback, linklocal, uniquelocal');
  assert.equal(trustProxySetting({ TRUST_PROXY: '1' }), 1);
  assert.equal(trustProxySetting({ TRUST_PROXY: 'true' }), true);
  assert.equal(trustProxySetting({ TRUST_PROXY: 'false' }), false);
  assert.equal(trustProxySetting({ TRUST_PROXY: '10.0.0.0/8' }), '10.0.0.0/8');
});

test('rate limit options read the environment', () => {
  assert.deepEqual(rateLimitOptions({ RATE_LIMIT_AUTH_MAX: '5', RATE_LIMIT_WINDOW_MS: '1000' }), { windowMs: 1000, max: 5, disabled: false });
  assert.equal(rateLimitOptions({ RATE_LIMIT_DISABLED: 'true' }).disabled, true);
  assert.equal(rateLimitOptions({ RATE_LIMIT_AUTH_MAX: 'x' }).max, 30);
});

test('only sensitive write endpoints are limited', async () => {
  const app = express();
  app.use(createSensitiveRateLimiter({ windowMs: 60_000, max: 2, disabled: false }));
  app.all('*', (_req, res) => { res.json({ ok: true }); });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const post = (p: string) => fetch(base + p, { method: 'POST' }).then((r) => r.status);
    assert.deepEqual([await post('/api/auth/sign-in/email'), await post('/api/auth/sign-in/email'), await post('/api/auth/sign-in/email')], [200, 200, 429]);
    assert.equal(await post('/api/system/setup'), 429); // shared per-client counter
    for (let i = 0; i < 5; i++) assert.equal(await fetch(base + '/api/auth/get-session').then((r) => r.status), 200);
    for (let i = 0; i < 5; i++) assert.equal(await post('/api/contracts'), 200);
  } finally { server.closeAllConnections(); server.close(); }
});
