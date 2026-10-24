/**
 * Several instances can run against one database. Business records live in PostgreSQL and are read on demand; the few things a process
 * keeps in memory because code reads them synchronously (installation configuration, the organizations' policy projection, the
 * Google/COS credentials) are registered here by name. A change made by any instance is announced with `NOTIFY legalio_shared_state`,
 * every other instance reloads that part at once, and a periodic reload (SHARED_STATE_POLL_MS, default 30 s, 0 disables) covers a
 * missed notification or a dropped listener connection.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { pool, sql } from './db';
import { componentLog } from './logger';

const log = componentLog('sharedState');
export const SHARED_STATE_CHANNEL = 'legalio_shared_state';
const INSTANCE = randomUUID();
const loaders = new Map<string, () => Promise<void>>();

/** `load` rebuilds the process-wide copy of `name` from the database. Registering again replaces the loader. */
export function registerSharedState(name: string, load: () => Promise<void>) {
  loaders.set(name, load);
}

/** Tells the other instances that `name` changed (delivered when the surrounding transaction, if any, commits). Never throws. */
export async function notifySharedState(name: string) {
  try {
    await sql.get('SELECT pg_notify(?, ?)', SHARED_STATE_CHANNEL, `${name}:${INSTANCE}`);
  } catch (err) {
    log.warn(`Could not announce a change of ${name}; other instances pick it up on their next periodic reload:`, err);
  }
}

/** Reloads the named parts (all when omitted) in this process. A failing loader is logged and does not stop the others. */
export async function refreshSharedState(names: string[] = [...loaders.keys()]) {
  for (const name of names) {
    try { await loaders.get(name)?.(); } catch (err) { log.warn(`Could not reload ${name}:`, err); }
  }
}

let listener: { client: pg.PoolClient | null; timer: NodeJS.Timeout | null; stopped: boolean } | null = null;

async function listen(state: NonNullable<typeof listener>) {
  if (state.stopped) return;
  let client: pg.PoolClient;
  try {
    client = await pool().connect();
    await client.query(`LISTEN ${SHARED_STATE_CHANNEL}`);
  } catch (err) {
    log.warn('Cannot listen for shared-state changes; relying on the periodic reload:', err);
    if (!state.stopped) setTimeout(() => void listen(state), 5000).unref();
    return;
  }
  state.client = client;
  client.on('notification', (message) => {
    const [name, origin] = String(message.payload ?? '').split(':');
    if (origin !== INSTANCE && name) void refreshSharedState([name]);
  });
  const lost = (err?: Error) => {
    if (state.client !== client) return;
    state.client = null;
    client.removeAllListeners();
    client.release(err ?? true as any);
    if (!state.stopped) { log.warn('Shared-state listener connection lost; reconnecting.'); setTimeout(() => void listen(state), 1000).unref(); }
  };
  client.on('error', lost);
  client.on('end', () => lost());
}

/** Starts listening and the periodic reload. Idempotent; stop it with `stopSharedStateSync` before closing the pool. */
export function startSharedStateSync() {
  if (listener) return;
  const pollMs = Number(process.env.SHARED_STATE_POLL_MS ?? 30_000);
  const state: NonNullable<typeof listener> = { client: null, timer: null, stopped: false };
  listener = state;
  void listen(state);
  if (Number.isFinite(pollMs) && pollMs > 0) {
    state.timer = setInterval(() => void refreshSharedState(), pollMs);
    state.timer.unref();
  }
}

export async function stopSharedStateSync() {
  const state = listener;
  listener = null;
  if (!state) return;
  state.stopped = true;
  if (state.timer) clearInterval(state.timer);
  const client = state.client;
  state.client = null;
  if (client) {
    client.removeAllListeners();
    await client.query(`UNLISTEN ${SHARED_STATE_CHANNEL}`).catch(() => undefined);
    client.release();
  }
}
