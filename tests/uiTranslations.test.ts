import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IsolatedServer, seedFixtures } from './tenant-boundaries/harness';

test('platform UI texts reach other users, persist, validate input and restrict writes', { timeout: 60_000 }, async () => {
  const server = await IsolatedServer.start();
  try {
    const ids = seedFixtures(server);
    await server.restart();
    const admin = server.session(ids.super);
    const viewer = server.session(ids.viewerA);
    const tenantAdmin = server.session(ids.adminB);
    const route = '/api/system/ui-texts';
    const empty = { ID: {}, EN: {}, ZH: {} };
    assert.deepEqual((await server.call(null, route)).data, { overrides: empty });
    const patch = (who: typeof admin | null, values: unknown) => server.call(who, '/api/platform/configuration', {
      method: 'PATCH', body: { section: 'uiTexts', values },
    });
    const overrides = { ID: { 'nav.dashboard': 'Beranda bersama' }, EN: { 'nav.dashboard': 'Shared home' }, ZH: { 'nav.dashboard': '共享首页' } };
    assert.equal((await patch(null, { overrides })).status, 401);
    assert.equal((await patch(viewer, { overrides })).status, 403);
    assert.equal((await patch(tenantAdmin, { overrides })).status, 403);
    assert.equal((await patch(admin, { overrides })).status, 200);
    for (const who of [null, viewer, tenantAdmin]) {
      const response = await server.call(who, route);
      assert.equal(response.status, 200);
      assert.deepEqual(response.data, { overrides });
      assert.match(response.headers.get('cache-control') || '', /no-store/);
    }
    await patch(admin, { overrides: { EN: { 'nav.partners': 'Shared partners' } } });
    assert.equal((await server.call(viewer, route)).data.overrides.EN['nav.dashboard'], 'Shared home', 'a partial edit preserves other keys');
    for (const values of [
      { overrides: { FR: { x: 'bad' } } }, { overrides: { EN: { x: 42 } } },
      { overrides: { EN: { x: 'x'.repeat(10_001) } } },
      { overrides: JSON.parse('{"EN":{"__proto__":"bad"}}') },
      { overrides: [], }, { reset: false }, { reset: true, overrides },
    ]) assert.equal((await patch(admin, values)).status, 400);
    await server.restart();
    assert.equal((await server.call(viewer, route)).data.overrides.EN['nav.dashboard'], 'Shared home', 'texts survive a server restart');
    assert.equal((await patch(admin, { overrides: { EN: { 'nav.dashboard': '' } } })).status, 200);
    assert.equal((await server.call(viewer, route)).data.overrides.EN['nav.dashboard'], undefined, 'blank text restores the built-in value');
    assert.equal((await patch(admin, { reset: true })).status, 200);
    assert.deepEqual((await server.call(viewer, route)).data, { overrides: empty });
  } finally {
    await server.stop();
  }
});
