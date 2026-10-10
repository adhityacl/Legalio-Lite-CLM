/**
 * Isolated live-server harness (tenant-boundaries PRD §15, §16.1).
 *
 * Every server runs from a fresh mkdtemp directory with APP_TEST_MODE=1,
 * AUTH_DB_PATH and APP_DATA_DIR inside it, its own port, and no Google/SMTP/AI
 * transport. Fixtures are synthetic `example.test` identities created through
 * the trusted provisioning service. Nothing here touches the workspace.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { addMembershipRecord, createIdentityRecord, createOrganizationRecord, createTeamRecord } from '../../apps/backend/src/organizationProvisioning';

const ROOT = resolve('.');
let bundlePromise: Promise<string> | null = null;

/** One esbuild bundle per test process, written to its own temp directory. */
function bundle(): Promise<string> {
  bundlePromise ||= (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tb-bundle-'));
    const outfile = join(dir, 'server.cjs');
    await build({ entryPoints: [join(ROOT, 'apps/backend/src/server.ts')], bundle: true, platform: 'node', format: 'cjs', packages: 'external', alias: { '@legalio/shared': resolve(ROOT, 'packages/shared/src'), '@legalio/types': resolve(ROOT, 'packages/types/src') }, outfile, logLevel: 'silent' });
    return outfile;
  })();
  return bundlePromise;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((r) => probe.close(() => r()));
  return port;
}

export interface Session { userId: string; token: string }
export interface Response<T = any> { status: number; data: T; headers: Headers }

export class IsolatedServer {
  child: ChildProcess | null = null;
  logs = '';
  db!: Database.Database;
  base = '';
  constructor(public dir: string, public port: number, public serverFile: string, public systemConsoleDir?: string) {}

  /** `port` pins the API port (the browser suite's preview proxy needs it up front). */
  static async start(options: { port?: number; systemConsoleDir?: string } = {}): Promise<IsolatedServer> {
    const dir = await mkdtemp(join(tmpdir(), 'tenant-boundaries-'));
    await mkdir(join(dir, 'data'), { recursive: true });
    const server = new IsolatedServer(dir, options.port ?? await freePort(), await bundle(), options.systemConsoleDir);
    server.base = `http://127.0.0.1:${server.port}`;
    await server.launch();
    server.db = new Database(join(dir, 'auth.db'));
    server.db.pragma('busy_timeout = 5000');
    return server;
  }

  async launch() {
    this.logs = '';
    this.child = spawn(process.execPath, [this.serverFile], {
      cwd: this.dir,
      env: {
        PATH: process.env.PATH,
        NODE_PATH: join(ROOT, 'node_modules'),
        NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE,
        APP_TEST_MODE: '1',
        AUTH_DB_PATH: join(this.dir, 'auth.db'),
        APP_DATA_DIR: join(this.dir, 'data'),
        API_ONLY: 'true',
        SYSTEM_CONSOLE_DIR: this.systemConsoleDir,
        PORT: String(this.port),
        SEED_DEMO_ADMIN: 'false',
        BETTER_AUTH_SECRET: 'isolated-tenant-boundaries-test-secret-0123456789',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child.stdout!.on('data', (c) => { this.logs += c.toString(); });
    this.child.stderr!.on('data', (c) => { this.logs += c.toString(); });
    const deadline = Date.now() + 45_000;
    while (!this.logs.includes('Server running on')) {
      assert.equal(this.child.exitCode, null, this.logs);
      assert.ok(Date.now() < deadline, this.logs);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async restart() {
    await this.kill();
    await this.launch();
  }

  async kill() {
    if (this.child && this.child.exitCode === null) {
      this.child.kill('SIGTERM');
      await once(this.child, 'exit');
    }
  }

  async stop() {
    await this.kill();
    this.db?.close();
    await rm(this.dir, { recursive: true, force: true });
  }

  session(userId: string, options: { expiresInMs?: number; activeOrganizationId?: string | null } = {}): Session {
    const token = crypto.randomBytes(24).toString('hex');
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId, activeOrganizationId) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(`sess_${crypto.randomUUID()}`, new Date(Date.now() + (options.expiresInMs ?? 600_000)).toISOString(), token, now, now, userId, options.activeOrganizationId ?? null);
    return { userId, token };
  }

  async call<T = any>(who: Session | null, path: string, init: { method?: string; body?: unknown; org?: string; headers?: Record<string, string> } = {}): Promise<Response<T>> {
    const headers: Record<string, string> = { ...(init.headers || {}) };
    if (who) headers.authorization = `Bearer ${who.token}`;
    if (init.org) headers['x-organization-id'] = init.org;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(this.base + path, { method: init.method || 'GET', headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
    const text = await res.text();
    let data: any = text;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { status: res.status, data, headers: res.headers };
  }

  /** Row counts used to prove that reads have no side effects (AC-008). */
  snapshot() {
    const q = (sql: string) => this.db.prepare(sql).all();
    return JSON.stringify({
      member: q(`SELECT id, organizationId, userId, role, status FROM member ORDER BY id`),
      team: q(`SELECT id, organizationId, name FROM team ORDER BY id`),
      teamMember: q(`SELECT teamId, userId FROM teamMember ORDER BY teamId, userId`),
      allowed: q(`SELECT id FROM allowed_users ORDER BY id`),
      sessions: q(`SELECT id, activeOrganizationId FROM session ORDER BY id`),
      integrations: q(`SELECT * FROM organization_integrations ORDER BY organizationId`),
      settings: q(`SELECT organizationId, version FROM organization_settings ORDER BY organizationId`),
      invitations: q(`SELECT id, status FROM invitation ORDER BY id`),
      user: q(`SELECT id, role, banned FROM "user" ORDER BY id`),
    });
  }
}

/**
 * §16.1 synthetic fixture matrix: organizations A/B, identical department
 * names across them, every tenant role in A, a multi-organization identity,
 * a partial-scope target, suspended / no-membership / banned identities.
 */
export function seedFixtures(server: IsolatedServer) {
  const db = server.db;
  const ids: Record<string, string> = {};
  db.transaction(() => {
    ids.orgA = createOrganizationRecord(db, { id: 'org-a', name: 'Alpha Org', slug: 'alpha', settings: { countryCode: 'ID' } });
    ids.orgB = createOrganizationRecord(db, { id: 'org-b', name: 'Beta Org', slug: 'beta', settings: { countryCode: 'SG' } });
    ids.aLegal = createTeamRecord(db, 'org-a', 'Legal', 'team-a-legal');
    ids.aFinance = createTeamRecord(db, 'org-a', 'Finance', 'team-a-finance');
    ids.bLegal = createTeamRecord(db, 'org-b', 'Legal', 'team-b-legal');
    const user = (key: string, platformRole: 'user' | 'superuser' = 'user', emailVerified = true) => {
      ids[key] = createIdentityRecord(db, { id: `u-${key}`, name: `User ${key}`, email: `${key}@example.test`, platformRole, emailVerified });
      return ids[key];
    };
    user('super', 'superuser');
    addMembershipRecord(db, { userId: user('adminA'), organizationId: 'org-a', tenantRole: 'admin' });
    addMembershipRecord(db, { userId: user('adminB'), organizationId: 'org-b', tenantRole: 'admin' });
    addMembershipRecord(db, { userId: user('managerA'), organizationId: 'org-a', tenantRole: 'manager', departmentIds: ['team-a-legal'] });
    addMembershipRecord(db, { userId: user('editorA'), organizationId: 'org-a', tenantRole: 'editor', departmentIds: ['team-a-legal'] });
    addMembershipRecord(db, { userId: user('viewerA'), organizationId: 'org-a', tenantRole: 'viewer', departmentIds: ['team-a-legal'] });
    addMembershipRecord(db, { userId: user('financeViewerA'), organizationId: 'org-a', tenantRole: 'viewer', departmentIds: ['team-a-finance'] });
    addMembershipRecord(db, { userId: user('multi'), organizationId: 'org-a', tenantRole: 'admin' });
    addMembershipRecord(db, { userId: ids.multi, organizationId: 'org-b', tenantRole: 'viewer', departmentIds: ['team-b-legal'] });
    addMembershipRecord(db, { userId: user('targetEditor'), organizationId: 'org-a', tenantRole: 'editor', departmentIds: ['team-a-legal', 'team-a-finance'] });
    addMembershipRecord(db, { userId: user('noDept'), organizationId: 'org-a', tenantRole: 'viewer' });
    const suspended = addMembershipRecord(db, { userId: user('suspended'), organizationId: 'org-a', tenantRole: 'viewer', departmentIds: ['team-a-legal'] });
    db.prepare(`UPDATE member SET status = 'suspended' WHERE id = ?`).run(suspended);
    addMembershipRecord(db, { userId: user('suspended2'), organizationId: 'org-b', tenantRole: 'viewer', departmentIds: ['team-b-legal'] });
    user('nomember');
    user('unverified', 'user', false);
    addMembershipRecord(db, { userId: user('banned'), organizationId: 'org-a', tenantRole: 'viewer', departmentIds: ['team-a-legal'] });
    db.prepare(`UPDATE "user" SET banned = 1, banReason = 'test' WHERE id = ?`).run(ids.banned);
  })();
  return ids;
}

export const membershipIdOf = (server: IsolatedServer, userId: string, organizationId: string) =>
  (server.db.prepare(`SELECT id FROM member WHERE userId = ? AND organizationId = ?`).get(userId, organizationId) as { id: string } | undefined)?.id;
