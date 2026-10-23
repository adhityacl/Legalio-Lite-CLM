import { resetSyncCache, synchronizeBusinessRows } from './normalizedCoreStore';
import { ENTITIES } from './normalizedSchema';
import type { Sql } from './db';
import { sealProviderSecrets } from './providerSecrets';

export function normalizeSqliteId(row: any, fallback: string) {
  if (row?.id) return String(row.id);
  if (row?.notif_id) return String(row.notif_id);
  if (row?.io_id) return String(row.io_id);
  if (row?.contract_id) return String(row.contract_id);
  if (row?.partner_id) return String(row.partner_id);
  if (row?.email) return String(row.email);
  if (row?.templateId) return String(row.templateId);
  if (row?.tenantId) return String(row.tenantId);
  if (row?.name) return String(row.name);
  return fallback;
}

export function isValidAllowedUserRow(row: any) {
  if (!row || typeof row !== 'object') return false;
  const email = String(row.email || row.emailAddress || row.userEmail || '').trim();
  return email.length > 0;
}

async function synchronizeCoreDataTransaction(db: Sql, data: any) {
  if (!data || typeof data !== 'object') return;

  // Business collections live in the normalized tables; only the onboarding allowlist is still a payload table.
  await synchronizeBusinessRows(db, data);
  const users = Array.isArray(data.allowedUsers) ? data.allowedUsers.filter(isValidAllowedUserRow) : [];
  const existing = new Map((await db.all(`SELECT id, payload FROM allowed_users`) as { id: string; payload: string }[])
    .map(row => [row.id, row.payload]));
  const seen = new Set<string>();
  const remove = (id: string) => db.run(`DELETE FROM allowed_users WHERE id = ?`, id);
  // Remove changed users first so valid email swaps retain the previous full-replacement behavior.
  const incoming = new Map(users.map(row => [normalizeSqliteId(row, ''), JSON.stringify(row)]));
  for (const [id, payload] of existing) if (incoming.get(id) !== payload) await remove(id);
  for (const row of users) {
    const id = normalizeSqliteId(row, `allowed_users-${Math.random().toString(36).slice(2, 10)}`);
    if (seen.has(id)) throw new Error(`Duplicate id in allowed_users: ${id}`);
    seen.add(id);
    const payload = JSON.stringify(row);
    if (existing.get(id) === payload) continue;
    await db.run(`
      INSERT INTO allowed_users (id, email, name, role, status, "organizationId", payload, "createdAt", "updatedAt")
      VALUES (@id, @email, @name, @role, @status, @organizationId, @payload, @createdAt, @updatedAt)
      ON CONFLICT (id) DO UPDATE SET email = excluded.email, name = excluded.name, role = excluded.role, status = excluded.status,
        "organizationId" = excluded."organizationId", payload = excluded.payload, "createdAt" = excluded."createdAt", "updatedAt" = excluded."updatedAt"
    `, {
      id, organizationId: row?.organizationId ?? null, payload,
      createdAt: row?.createdAt ?? row?.created_at ?? new Date().toISOString(),
      updatedAt: row?.updatedAt ?? row?.updated_at ?? new Date().toISOString(),
      email: String(row.email || row.emailAddress || row.userEmail || '').trim(),
      name: row.name ?? row.fullName ?? null, role: row.role ?? null, status: row.status ?? null,
    });
  }
  for (const id of existing.keys()) if (!seen.has(id)) await remove(id);

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
const PERSISTED = ['allowedUsers', ...ENTITIES.filter(entity => !entity.appendOnly && !entity.repository).map(entity => entity.collection), 'branding', 'googleConfig', 'appSettings', 'newsTicker'];

/**
 * Serialized saves of the in-memory projection. Each save snapshots the collections synchronously when its turn
 * comes, so handlers mutating `memory` during a write cannot tear it. The lock is taken outside the transaction
 * (waiters hold no connection); `withSaveLock` lets other writers of the same tables join the queue.
 */
export function createCoreSaver(db: Sql, memory: () => Record<string, any>, reload?: () => Promise<void>) {
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
    } catch (error) {
      resetSyncCache(db);
      // Still holding the lock: the next queued save must snapshot the reloaded state, not the one that just failed.
      await reload?.();
      throw error;
    }
  });
  /** Resolves once every save queued so far has finished (successfully or not); used by graceful shutdown. */
  const idle = async () => { let seen; do { seen = queue; await seen; } while (seen !== queue); };
  return { save, withSaveLock, snapshot, idle };
}
