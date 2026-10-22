import { normalizedCoreReady, resetSyncCache, synchronizeBusinessRows } from './normalizedCoreStore';
import { ENTITIES } from './normalizedSchema';
import { migratePartnerContact } from './partnerContact';
import type { Sql } from './db';

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

async function synchronizeCoreDataTransaction(sqliteDb: Sql, data: any) {
  if (!data || typeof data !== 'object') return;

  const normalized = await normalizedCoreReady(sqliteDb);
  const syncTable = async (table: string, rows: any[] = []) => {
    if (normalized && ENTITIES.some(entity => entity.table === table)) return;
    await sqliteDb.tx(async () => {
      const existing = new Map((await sqliteDb.all(`SELECT id, payload FROM ${table}`) as { id: string; payload: string }[])
        .map(row => [row.id, row.payload]));
      const seen = new Set<string>();
      const isUserTable = table === 'allowed_users';
      const remove = (id: string) => sqliteDb.run(`DELETE FROM ${table} WHERE id = ?`, id);
      // Remove changed users first so valid email swaps retain the previous full-replacement behavior.
      if (isUserTable) {
        const incoming = new Map(rows.filter(isValidAllowedUserRow).map(row => [normalizeSqliteId(row, ''), JSON.stringify(row)]));
        for (const [id, payload] of existing) if (incoming.get(id) !== payload) await remove(id);
      }
      const columns = isUserTable
        ? ['id', 'email', 'name', 'role', 'status', 'organizationId', 'payload', 'createdAt', 'updatedAt']
        : ['id', 'organizationId', 'payload', 'createdAt', 'updatedAt'];
      const insert = (record: object) => sqliteDb.run(`INSERT INTO ${table} (${columns.join(', ')})
        VALUES (${columns.map(column => `@${column}`).join(', ')})
        ON CONFLICT(id) DO UPDATE SET ${columns.slice(1).map(column => `${column}=excluded.${column}`).join(', ')}`, record);
      for (const row of Array.isArray(rows) ? rows : []) {
        if (isUserTable && !isValidAllowedUserRow(row)) continue;
        const id = normalizeSqliteId(row, `${table}-${Math.random().toString(36).slice(2, 10)}`);
        if (seen.has(id)) throw new Error(`Duplicate id in ${table}: ${id}`);
        seen.add(id);
        if (table === 'partners') migratePartnerContact(row);
        const payload = JSON.stringify(row);
        if (existing.get(id) === payload) continue;
        const record = {
          id, organizationId: row?.organizationId ?? null, payload,
          createdAt: row?.createdAt ?? row?.created_at ?? new Date().toISOString(),
          updatedAt: row?.updatedAt ?? row?.updated_at ?? new Date().toISOString(),
        };
        await insert(isUserTable ? {
          ...record, email: String(row.email || row.emailAddress || row.userEmail || '').trim(),
          name: row.name ?? row.fullName ?? null, role: row.role ?? null, status: row.status ?? null,
        } : record);
      }
      for (const id of existing.keys()) if (!seen.has(id)) await remove(id);
    });
  };

  if (normalized) await synchronizeBusinessRows(sqliteDb, data);
  await syncTable('allowed_users', Array.isArray(data.allowedUsers) ? data.allowedUsers.filter(isValidAllowedUserRow) : []);
  await syncTable('partners', Array.isArray(data.partners) ? data.partners : []);
  await syncTable('contracts', Array.isArray(data.contracts) ? data.contracts : []);
  await syncTable('insertion_orders', Array.isArray(data.ios) ? data.ios : []);
  await syncTable('notifications', Array.isArray(data.notifications) ? data.notifications : []);
  await syncTable('activity_logs', Array.isArray(data.activityLogs) ? data.activityLogs : []);
  await syncTable('evaluations', Array.isArray(data.evaluations) ? data.evaluations : []);
  await syncTable('spendings', Array.isArray(data.spendings) ? data.spendings : []);
  // `tenants`/`departments` are legacy projections of the canonical
  // organization/team rows (tenant-boundaries PRD §7.3): never snapshot-
  // replaced from memory, so they stay intact as migration input.
  await syncTable('templates', Array.isArray(data.templates) ? data.templates : []);

  if (data.branding) {
    await sqliteDb.run(`
      INSERT INTO branding (id, organizationId, payload, updatedAt)
      VALUES (@id, @organizationId, @payload, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        organizationId = excluded.organizationId,
        payload = excluded.payload,
        updatedAt = excluded.updatedAt
      WHERE branding.payload IS NOT excluded.payload
    `, {
      id: 'branding',
      organizationId: data.branding.organizationId ?? null,
      payload: JSON.stringify(data.branding),
      updatedAt: new Date().toISOString(),
    });
  }

  const googleConfigPayload = data.googleConfig ?? data.appSettings ?? null;
  if (googleConfigPayload) {
    await sqliteDb.run(`
      INSERT INTO app_settings (id, organizationId, payload, updatedAt)
      VALUES (@id, @organizationId, @payload, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        organizationId = excluded.organizationId,
        payload = excluded.payload,
        updatedAt = excluded.updatedAt
      WHERE app_settings.payload IS NOT excluded.payload
    `, {
      id: 'google_config',
      organizationId: googleConfigPayload.organizationId ?? null,
      payload: JSON.stringify(googleConfigPayload),
      updatedAt: new Date().toISOString(),
    });
  }

  if (data.newsTicker) {
    await sqliteDb.run(`
      INSERT INTO news_ticker (id, payload, updatedAt)
      VALUES (@id, @payload, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        updatedAt = excluded.updatedAt
      WHERE news_ticker.payload IS NOT excluded.payload
    `, {
      id: 'default',
      payload: JSON.stringify(data.newsTicker),
      updatedAt: new Date().toISOString(),
    });
  }
}

export async function synchronizeCoreData(sqliteDb: Sql, data: any) {
  await sqliteDb.tx(() => synchronizeCoreDataTransaction(sqliteDb, data));
}

/** Parts of the in-memory projection that synchronizeCoreData persists. */
const PERSISTED = ['allowedUsers', ...ENTITIES.map(entity => entity.collection), 'branding', 'googleConfig', 'appSettings', 'newsTicker'];

/**
 * Serialized saves of the in-memory projection. Each save snapshots the collections synchronously when its turn
 * comes, so handlers mutating `memory` during a write cannot tear it. The lock is taken outside the transaction
 * (waiters hold no connection); `withSaveLock` lets other writers of the same tables join the queue.
 */
export function createCoreSaver(db: Sql, memory: () => Record<string, any>) {
  let queue: Promise<unknown> = Promise.resolve();
  const withSaveLock = <T>(fn: () => Promise<T>): Promise<T> => {
    if (process.env.NODE_ENV !== 'production' && db.inTx()) throw new Error('Saves must not start inside a transaction.');
    const run = queue.then(fn);
    queue = run.catch(() => undefined);
    return run;
  };
  const snapshot = () => { const data = memory(); return structuredClone(Object.fromEntries(PERSISTED.filter(key => data[key] !== undefined).map(key => [key, data[key]]))); };
  /** `alongside` runs in the same transaction after the sync (e.g. the audit row of the change being saved). */
  const save = (alongside?: () => Promise<unknown>) => withSaveLock(async () => {
    const data = snapshot();
    try {
      await db.tx(async () => {
        await synchronizeCoreData(db, data);
        await alongside?.();
      });
    } catch (error) {
      resetSyncCache(db);
      throw error;
    }
  });
  return { save, withSaveLock, snapshot };
}
