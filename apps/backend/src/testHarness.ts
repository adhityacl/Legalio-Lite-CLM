/** Tests only: boots the real Express app on a throwaway PostgreSQL database with real Better Auth sessions (same setup as routeIsolation.test.ts). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

export const PASSWORD = 'Harness-test-pw-1234';
export const ORIGIN = 'http://localhost:3000';

export type HarnessRole = 'admin' | 'manager' | 'editor' | 'viewer' | 'superuser';
export interface HarnessOptions {
  tag: string;
  orgs: Array<{ id: string; name: string }>;
  /** Optional fourth entry: the name of a department (created in the organization) the member belongs to. */
  users: Array<[key: string, org: string | null, role: HarnessRole, department?: string]>;
  /** Extra environment applied before the application is imported. */
  env?: Record<string, string>;
}
export interface Reply { status: number; body: any; raw: string; headers: Headers }

export async function bootApp(options: HarnessOptions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `legalio-${options.tag}-`));
  Object.assign(process.env, {
    APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_URL: ORIGIN, TRUSTED_ORIGINS: ORIGIN, BETTER_AUTH_ENABLE_INFRA: 'false',
    BETTER_AUTH_SECRET: `${options.tag}-test-secret-0123456789abcdef`, SEED_DEMO_ADMIN: 'false', RATE_LIMIT_DISABLED: 'true', LOG_LEVEL: 'silent',
    GEMINI_API_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_APPLICATION_CREDENTIALS: '', ...options.env,
  });
  const { sql } = await import('./db');
  const { createTestDatabase } = await import('./testDatabase');
  const { ensureSchema } = await import('./schema');
  const { createOrganizationRecord, createIdentityRecord, addMembershipRecord, createTeamRecord } = await import('./organizationProvisioning');
  const { hashPassword } = await import('better-auth/crypto');
  const database = await createTestDatabase();
  await ensureSchema();
  for (const org of options.orgs) await createOrganizationRecord(sql, { id: org.id, name: org.name });
  const hash = await hashPassword(PASSWORD);
  const now = new Date().toISOString();
  const teams = new Map<string, string>();
  for (const [key, org, role, department] of options.users) {
    await createIdentityRecord(sql, { id: key, name: key, email: `${key.toLowerCase()}@example.com`, platformRole: role === 'superuser' ? 'superuser' : 'user' });
    await sql.run(`INSERT INTO account(id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") VALUES (?, ?, 'credential', ?, ?, ?, ?)`, `acct-${key}`, key, key, hash, now, now);
    if (department && org && !teams.has(`${org}:${department}`)) teams.set(`${org}:${department}`, await createTeamRecord(sql, org, department));
    if (org && role !== 'superuser') await addMembershipRecord(sql, { userId: key, organizationId: org, tenantRole: role, departmentIds: department && org ? [teams.get(`${org}:${department}`)!] : [] });
  }
  const serverModule = await import('./server');
  await serverModule.init();
  const server: Server = serverModule.app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const tokens: Record<string, string> = {};
  for (const [key] of options.users) {
    const res = await fetch(`${base}/api/auth/sign-in/email`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email: `${key.toLowerCase()}@example.com`, password: PASSWORD }),
    });
    assert.equal(res.status, 200, `sign-in ${key}`);
    tokens[key] = ((await res.json()) as any).token;
  }

  async function request(method: string, route: string, init: { headers?: Record<string, string>; body?: unknown; raw?: boolean } = {}): Promise<Reply> {
    const res = await fetch(base + route, {
      method, headers: { 'content-type': 'application/json', ...init.headers },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const raw = await res.text();
    let body: any = raw;
    try { body = JSON.parse(raw); } catch { /* not JSON */ }
    return { status: res.status, body, raw, headers: res.headers };
  }
  /** A request as a signed-in user (session token as Bearer; the origin header satisfies the CSRF check for cookie-style clients). */
  const api = (user: string, method: string, route: string, init: { org?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    request(method, route, { body: init.body, headers: { origin: ORIGIN, authorization: `Bearer ${tokens[user]}`, ...(init.org ? { 'x-organization-id': init.org } : {}), ...init.headers } });

  return {
    sql, base, tokens, api, request, serverModule, database,
    async close() {
      await new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); });
      await serverModule.drain();
      await database.drop();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
export type Harness = Awaited<ReturnType<typeof bootApp>>;
