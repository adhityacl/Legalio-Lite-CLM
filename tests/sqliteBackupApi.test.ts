import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { IsolatedServer, seedFixtures } from './tenant-boundaries/harness';

test('backup API gates platform access, downloads an archive and restores on restart', { timeout: 60_000 }, async () => {
  const server = await IsolatedServer.start();
  try {
    const request = (method: string, path: string, who: any = null, body?: unknown) => server.call(who, path, { method, body });
    const ids = seedFixtures(server);
    const superuser = server.session(ids.super);
    const user = server.session(ids.nomember);
    assert.equal((await request('GET', '/api/auth-console/backups')).status, 401);
    assert.equal((await request('GET', '/api/auth-console/backups', user)).status, 403);
    assert.equal((await request('POST', '/api/auth-console/backups', user, {})).status, 403);
    mkdirSync(join(server.dir, 'data', 'uploads'), { recursive: true });
    writeFileSync(join(server.dir, 'data', 'uploads', 'sample.txt'), 'before');
    const created = await request('POST', '/api/auth-console/backups', superuser, {});
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const id = created.data.id;
    const download = await fetch(server.base + `/api/auth-console/backups/${id}/download`, { headers: { Authorization: `Bearer ${superuser.token}` } });
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition') || '', /\.tar\.gz/);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(bytes[0], 0x1f); assert.equal(bytes[1], 0x8b);
    writeFileSync(join(server.dir, 'data', 'uploads', 'sample.txt'), 'after');
    assert.equal((await request('POST', `/api/auth-console/backups/${id}/restore`, user, { confirmation: 'RESTORE' })).status, 403);
    assert.equal((await request('POST', `/api/auth-console/backups/${id}/restore`, superuser, { confirmation: 'wrong' })).status, 400);
    const upload = async (who: typeof superuser, confirmation: string, content: Uint8Array = bytes) => {
      const form = new FormData();
      form.append('confirmation', confirmation);
      form.append('file', new Blob([content]), 'backup.tar.gz');
      const response = await fetch(server.base + '/api/auth-console/backups/restore-file', { method: 'POST', headers: { Authorization: `Bearer ${who.token}` }, body: form });
      return { status: response.status, data: await response.json() };
    };
    assert.equal((await upload(user, 'RESTORE')).status, 403);
    assert.equal((await upload(superuser, 'wrong')).status, 400);
    assert.equal((await upload(superuser, 'RESTORE', Buffer.from('not an archive'))).status, 400);
    assert.equal(readFileSync(join(server.dir, 'data', 'uploads', 'sample.txt'), 'utf8'), 'after');
    const restored = await upload(superuser, 'RESTORE');
    assert.equal(restored.status, 202, JSON.stringify(restored.data));
    assert.ok(restored.data.safetyBackupId);
    assert.equal((await request('POST', '/api/auth-console/backups', superuser, {})).status, 409);
    await server.kill();
    server.db.close();
    await server.launch();
    server.db = new Database(join(server.dir, 'auth.db'));
    assert.equal(readFileSync(join(server.dir, 'data', 'uploads', 'sample.txt'), 'utf8'), 'before');
    assert.equal((await request('GET', '/api/auth-console/backups', superuser)).status, 401);
    const fresh = server.session(ids.super);
    const listing = await request('GET', '/api/auth-console/backups', fresh);
    assert.equal(listing.status, 200);
    assert.equal(listing.data.backups.length, 3);
  } finally { await server.stop(); }
});
