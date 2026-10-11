import { needsOrganization, resolveRoute } from '@legalio/platform-console/lib/appRoutes';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { mountSystemConsole } from '../apps/backend/src/systemConsoleHosting';

test('serves the console without a frontend server and isolates its assets and legacy links', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sys-hosting-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<html>System Console</html>');
  writeFileSync(join(dir, 'assets', 'console.js'), 'console.log("sys")');
  const app = express();
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  mountSystemConsole(app, dir);
  app.use((_req, res) => res.status(418).send('main frontend fallback'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    for (const path of ['/sys', '/sys/', '/sys?tab=admin-system-users']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /System Console/);
      assert.match(response.headers.get('cache-control') || '', /no-cache/);
    }
    assert.equal((await fetch(base + '/sys/assets/console.js')).status, 200);
    for (const path of ['/sys/assets/missing.js', '/sys/unknown', '/sys/assets/../missing.js']) {
      assert.equal((await fetch(base + path)).status, 404);
    }
    const redirect = await fetch(base + '/app?tab=admin-system-users&extra=1', { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), '/sys?tab=admin-system-users');
    assert.equal((await fetch(base + '/app?tab=admin-system-invalid', { redirect: 'manual' })).status, 418);
    assert.equal((await fetch(base + '/app?tab=contracts')).status, 418);
    assert.equal((await fetch(base + '/api/health')).status, 200);
    rmSync(join(dir, 'index.html'));
    assert.equal((await fetch(base + '/sys')).status, 503);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy platform configuration and removed system tabs resolve without selecting an organization', () => {
  const context = { isPlatformAdmin: true, organizationReady: false, can: () => false };
  assert.equal(needsOrganization('admin-system-settings', true), false);
  assert.deepEqual(resolveRoute('admin-system-settings', context), { kind: 'redirect', tab: 'admin-system-google' });
  assert.equal(needsOrganization('admin-system-rbac', true), false);
  assert.deepEqual(resolveRoute('admin-system-rbac', context), { kind: 'denied' });
});


test('separate console pages are platform-only and require no organization selection', () => {
  for (const tab of ['admin-system-google-drive', 'admin-system-google-credentials', 'admin-system-database', 'admin-system-backups', 'admin-system-reset']) {
    assert.equal(needsOrganization(tab, true), false);
    assert.deepEqual(resolveRoute(tab, { isPlatformAdmin: true, organizationReady: false, can: () => false }), { kind: 'allow', tab });
    assert.deepEqual(resolveRoute(tab, { isPlatformAdmin: false, organizationReady: false, can: () => false }), { kind: 'denied' });
  }
});
