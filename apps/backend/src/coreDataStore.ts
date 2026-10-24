import type { Sql } from './db';
import { sealProviderSecrets } from './providerSecrets';

async function synchronizeCoreDataTransaction(db: Sql, data: any) {
  if (!data || typeof data !== 'object') return;

  // Business records and the allowlist are written by their repositories (src/repositories); this persists the installation configuration.
  if (data.branding) {
    await db.run(`
      INSERT INTO branding (id, "organizationId", payload, "updatedAt")
      VALUES (@id, @organizationId, @payload, @updatedAt)
      ON CONFLICT (id) DO UPDATE SET
        "organizationId" = excluded."organizationId",
        payload = excluded.payload,
        "updatedAt" = excluded."updatedAt"
      WHERE branding.payload IS DISTINCT FROM excluded.payload
    `, {
      id: 'branding',
      organizationId: data.branding.organizationId ?? null,
      payload: JSON.stringify(data.branding),
      updatedAt: new Date().toISOString(),
    });
  }

  const googleConfigPayload = data.googleConfig ?? data.appSettings ?? null;
  if (googleConfigPayload) {
    await db.run(`
      INSERT INTO app_settings (id, "organizationId", payload, "updatedAt")
      VALUES (@id, @organizationId, @payload, @updatedAt)
      ON CONFLICT (id) DO UPDATE SET
        "organizationId" = excluded."organizationId",
        payload = excluded.payload,
        "updatedAt" = excluded."updatedAt"
      WHERE app_settings.payload IS DISTINCT FROM excluded.payload
    `, {
      id: 'google_config',
      organizationId: googleConfigPayload.organizationId ?? null,
      // SMTP password, Gemini key and Google tokens are encrypted at rest (providerSecrets.ts).
      payload: JSON.stringify(sealProviderSecrets(googleConfigPayload)),
      updatedAt: new Date().toISOString(),
    });
  }

  if (data.newsTicker) {
    await db.run(`
      INSERT INTO news_ticker (id, payload, "updatedAt")
      VALUES (@id, @payload, @updatedAt)
      ON CONFLICT (id) DO UPDATE SET
        payload = excluded.payload,
        "updatedAt" = excluded."updatedAt"
      WHERE news_ticker.payload IS DISTINCT FROM excluded.payload
    `, {
      id: 'default',
      payload: JSON.stringify(data.newsTicker),
      updatedAt: new Date().toISOString(),
    });
  }
}

export async function synchronizeCoreData(db: Sql, data: any) {
  await db.tx(() => synchronizeCoreDataTransaction(db, data));
}

/** Parts of the in-memory projection that synchronizeCoreData persists. */
const PERSISTED = ['branding', 'googleConfig', 'appSettings', 'newsTicker'];

/**
 * Serialized saves of the in-memory projection. Each save snapshots the collections synchronously when its turn
 * comes, so handlers mutating `memory` during a write cannot tear it. The lock is taken outside the transaction
 * (waiters hold no connection); `withSaveLock` lets other writers of the same tables join the queue.
 */
export function createCoreSaver(db: Sql, memory: () => Record<string, any>, reload?: () => Promise<void>, onSaved?: (saved: Record<string, any>) => void) {
  let queue: Promise<unknown> = Promise.resolve();
  const withSaveLock = <T>(fn: () => Promise<T>): Promise<T> => {
    if (process.env.NODE_ENV !== 'production' && db.inTx()) throw new Error('Saves must not start inside a transaction.');
    const run = queue.then(fn);
    queue = run.catch(() => undefined);
    return run;
  };
  const snapshot = () => { const data = memory(); return structuredClone(Object.fromEntries(PERSISTED.filter(key => data[key] !== undefined).map(key => [key, data[key]]))); };
  /** `alongside` runs in the same transaction after the sync (e.g. the audit row of the change being saved); `reload` restores `memory` from the database after a failed save. */
  const save = (alongside?: () => Promise<unknown>) => withSaveLock(async () => {
    const data = snapshot();
    try {
      await db.tx(async () => {
        await synchronizeCoreData(db, data);
        await alongside?.();
      });
      onSaved?.(data);
    } catch (error) {
      // Still holding the lock: the next queued save must snapshot the reloaded state, not the one that just failed.
      await reload?.();
      throw error;
    }
  });
  /** Resolves once every save queued so far has finished (successfully or not); used by graceful shutdown. */
  const idle = async () => { let seen; do { seen = queue; await seen; } while (seen !== queue); };
  return { save, withSaveLock, snapshot, idle };
}
