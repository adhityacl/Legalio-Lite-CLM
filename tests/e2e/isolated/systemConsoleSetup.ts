import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { hashPassword } from 'better-auth/crypto';
import { IsolatedServer, seedFixtures } from '../../tenant-boundaries/harness';
import { API_PORT, type LiveState } from './state';

/** No frontend process is started: /sys comes entirely from the API backend. */
export default async function setup() {
  if (process.env.SYS_E2E_SKIP_BUILD !== '1') {
    const build = spawnSync('npm', ['run', 'build:sys'], { stdio: 'inherit' });
    if (build.status !== 0) throw new Error('Console build failed');
  }
  const server = await IsolatedServer.start({ port: API_PORT, systemConsoleDir: resolve('apps/backend/dist/console') });
  try {
    const ids = seedFixtures(server);
    const now = new Date().toISOString();
    const password = await hashPassword('console-password-9');
    for (const id of [ids.super, ids.nomember]) {
      server.db.prepare('INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run(`credential-${id}`, id, 'credential', id, password, now, now);
    }
    await server.restart();
    const state: LiveState = { dir: server.dir, dbPath: `${server.dir}/auth.db`, apiBase: server.base, ids };
    process.env.TB_E2E_STATE = JSON.stringify(state);
    return async () => { await server.stop(); };
  } catch (err) { await server.stop(); throw err; }
}
