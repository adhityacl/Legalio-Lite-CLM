import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serializeSignedCookie } from 'better-call';
import { IsolatedServer, seedFixtures } from './harness';

test('self-service profile stores name, photo and bio across server restarts', async () => {
  const server = await IsolatedServer.start();
  try {
    const ids = seedFixtures(server);
    const session = server.session(ids.viewerA);
    const cookie = (await serializeSignedCookie('better-auth.session_token', session.token, 'isolated-tenant-boundaries-test-secret-0123456789')).split(';')[0];
    const headers = { origin: server.base, cookie };
    const originalOther = server.db.prepare('SELECT name, image, bio FROM "user" WHERE id = ?').get(ids.adminA);
    const profile = { name: 'Jane Smith', image: 'data:image/png;base64,aW1hZ2U=', bio: 'Legal operations manager' };
    const saved = await server.call(session, '/api/auth/update-user', { method: 'POST', headers, body: profile });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal((await server.call(null, '/api/auth/update-user', { method: 'POST', body: profile })).status, 401);
    await server.restart();
    const me = await server.call(session, '/api/me');
    assert.equal(me.status, 200);
    for (const [key, value] of Object.entries(profile)) assert.equal(me.data.identity[key], value);
    assert.equal(me.data.identity.platformRole, 'user');
    assert.deepEqual(server.db.prepare('SELECT name, image, bio FROM "user" WHERE id = ?').get(ids.adminA), originalOther);
    const cleared = await server.call(session, '/api/auth/update-user', { method: 'POST', headers, body: { bio: '', image: null } });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
    const updated = await server.call(session, '/api/me');
    assert.equal(updated.data.identity.bio, '');
    assert.equal(updated.data.identity.image, null);
  } finally {
    await server.stop();
  }
});
