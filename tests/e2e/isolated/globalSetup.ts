/**
 * Isolated live browser environment (tenant-boundaries PRD §15).
 *
 * Starts the bundled server with APP_TEST_MODE=1 from a fresh mkdtemp
 * directory (its own auth.db and uploads), seeds the synthetic §16.1
 * `example.test` fixture matrix through the trusted provisioning service and
 * the API, and serves the built frontend with `vite preview`, whose proxy
 * points at that server. The workspace auth.db, uploads/ and data_store.json
 * are never opened. Teardown stops both processes and deletes the directory.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { IsolatedServer, seedFixtures } from '../../tenant-boundaries/harness';
import { API_PORT, WEB_URL, WEB_PORT, type LiveState } from './state';

async function waitFor(url: string, child: ChildProcess, log: () => string) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`vite preview exited early:\n${log()}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${url}:\n${log()}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

export default async function globalSetup() {
  const server = await IsolatedServer.start({ port: API_PORT, systemConsoleDir: resolve('apps/backend/dist/console') });
  try {
    const ids = seedFixtures(server);
    await server.restart(); // rebuild the read projection from the seeded canonical rows
    const admin = server.session(ids.adminA);
    const superuser = server.session(ids.super);
    const partner = async (who: typeof admin, org: string, name: string, pic: string) => {
      const res = await server.call(who, '/api/partners', { method: 'POST', org, body: { nama_partner: name, pic_internal: pic, status: 'Active' } });
      if (res.status !== 200) throw new Error(`partner fixture: ${res.status} ${JSON.stringify(res.data)}`);
      return res.data.partner.partner_id as string;
    };
    ids.pLegal = await partner(admin, 'org-a', 'Alpha Legal Partner', 'Legal');
    ids.pFinance = await partner(admin, 'org-a', 'Alpha Finance Partner', 'Finance');
    ids.pNone = await partner(admin, 'org-a', 'Alpha Unassigned Partner', '');
    ids.pB = await partner(superuser, 'org-b', 'Beta Legal Partner', 'Legal');
    // One active contract per partner, so every dashboard count differs by scope (AC-045).
    const contract = async (who: typeof admin, org: string, partnerId: string, title: string) => {
      const res = await server.call(who, '/api/contracts', { method: 'POST', org, body: {
        nomor_kontrak: title.toUpperCase().replace(/\W+/g, '-'), judul_kontrak: title, partner_id: partnerId,
        tanggal_mulai: '2026-01-01', tanggal_berakhir: '2030-12-31', currency: 'IDR', nilai_kontrak: 1000,
      } });
      if (res.status !== 200) throw new Error(`contract fixture: ${res.status} ${JSON.stringify(res.data)}`);
    };
    await contract(admin, 'org-a', ids.pLegal, 'Alpha Legal Agreement');
    await contract(admin, 'org-a', ids.pFinance, 'Alpha Finance Agreement');
    await contract(admin, 'org-a', ids.pNone, 'Alpha Unassigned Agreement');
    await contract(superuser, 'org-b', ids.pB, 'Beta Legal Agreement');

    if (process.env.TB_E2E_SKIP_BUILD !== '1') {
      const consoleBuild = spawnSync('npm', ['run', 'build:sys'], { stdio: 'inherit' });
      if (consoleBuild.status !== 0) throw new Error('npm run build:sys failed');
      const build = spawnSync('npm', ['run', 'build:frontend'], { stdio: 'inherit' });
      if (build.status !== 0) throw new Error('npm run build:frontend failed');
    }
    let previewLog = '';
    // vite preview reuses server.proxy, which targets localhost:$PORT — the isolated API.
    const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', 'apps/frontend', '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'], {
      env: { ...process.env, PORT: String(API_PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    preview.stdout!.on('data', (c) => { previewLog += c; });
    preview.stderr!.on('data', (c) => { previewLog += c; });
    await waitFor(WEB_URL, preview, () => previewLog);

    const state: LiveState = { dir: server.dir, dbPath: `${server.dir}/auth.db`, apiBase: server.base, ids };
    process.env.TB_E2E_STATE = JSON.stringify(state); // inherited by test workers

    return async () => {
      preview.kill('SIGTERM');
      if (preview.exitCode === null) await once(preview, 'exit');
      await server.stop();
    };
  } catch (err) {
    await server.stop();
    throw err;
  }
}
