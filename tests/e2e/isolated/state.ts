/**
 * Access to the isolated live environment created by globalSetup.ts.
 * Refuses to run against anything but a temporary test database.
 */
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import type { Page } from '@playwright/test';

export const API_PORT = Number(process.env.TB_E2E_API_PORT || 4291);
export const WEB_PORT = Number(process.env.TB_E2E_WEB_PORT || 4290);
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

export interface LiveState { dir: string; dbPath: string; apiBase: string; ids: Record<string, string> }

export function liveState(): LiveState {
  const raw = process.env.TB_E2E_STATE;
  if (!raw) throw new Error('No isolated server: run through playwright.tenant-boundaries.config.ts (npm run test:e2e:tenant-boundaries).');
  const state = JSON.parse(raw) as LiveState;
  if (!resolve(state.dbPath).startsWith(resolve(tmpdir()) + sep)) throw new Error(`Refusing non-temporary database ${state.dbPath}`);
  return state;
}

export const ids = () => liveState().ids;

/** Opens the isolated test database (for assertions and session rows only). */
export function testDb() {
  const db = new Database(liveState().dbPath);
  db.pragma('busy_timeout = 5000');
  return db;
}

/** A fresh session row for a fixture identity, so tests never share a session default. */
export function newSession(userKey: string, activeOrganizationId: string | null = null): string {
  const db = testDb();
  try {
    const token = crypto.randomBytes(24).toString('hex');
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId, activeOrganizationId) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(`sess_${crypto.randomUUID()}`, new Date(Date.now() + 3_600_000).toISOString(), token, now, now, ids()[userKey], activeOrganizationId);
    return token;
  } finally {
    db.close();
  }
}

/** Signs the page in as a fixture identity (the app sends the token as a Bearer header). */
export async function signIn(page: Page, userKey: string, activeOrganizationId: string | null = null): Promise<string> {
  const token = newSession(userKey, activeOrganizationId);
  await page.addInitScript((value) => localStorage.setItem('auth_session_token', value), token);
  return token;
}

/** Direct API call to the isolated server (no browser). */
export async function api(token: string, path: string, init: { method?: string; body?: unknown; org?: string } = {}) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (init.org) headers['x-organization-id'] = init.org;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(liveState().apiBase + path, { method: init.method || 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const text = await res.text();
  let data: any = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, data };
}
