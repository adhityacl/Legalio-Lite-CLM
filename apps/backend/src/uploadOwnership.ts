import crypto from 'node:crypto';
import type { Sql } from './db';
import { componentLog } from './logger';

const log = componentLog('uploads');
const BACKFILL_MARKER = 'uploads-ownership-backfill-v1';

/** `/uploads/...` links found anywhere in a record's JSON (the same scan the legacy inference used). */
export function uploadLinksIn(record: unknown): string[] {
  return JSON.stringify(record ?? null).match(/\/uploads\/[^"\\]+/g) || [];
}

/** Storage key for a new upload: organization id, an unguessable random segment, the category and the file name. */
export function newUploadKey(organizationId: string, category: string, fileName: string): string {
  const safe = (value: string) => value.replace(/[/\\?%*:|"<>\0]/g, '_').replace(/^\.+/, '_').trim() || '_';
  return [organizationId, crypto.randomBytes(12).toString('hex'), safe(category), safe(fileName)].join('/');
}

/** Server-written ownership of a stored object. First writer wins: an existing owner is never reassigned. */
export async function recordUploadOwner(db: Sql, key: string, organizationId: string, source: 'upload' | 'backfill' = 'upload') {
  await db.run(`INSERT INTO upload_owners (storage_key, organization_id, source, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (storage_key) DO NOTHING`,
    key, organizationId, source, new Date().toISOString());
}

export async function uploadOwnerOf(db: Sql, key: string): Promise<string | null> {
  return (await db.get<{ organization_id: string }>('SELECT organization_id FROM upload_owners WHERE storage_key = ?', key))?.organization_id ?? null;
}

export async function forgetUploadOwners(db: Sql, where: { organizationId?: string; keys?: string[] }) {
  if (where.keys) await db.run('DELETE FROM upload_owners WHERE storage_key = ANY(?)', where.keys);
  else if (where.organizationId) await db.run('DELETE FROM upload_owners WHERE organization_id = ?', where.organizationId);
  else await db.run('DELETE FROM upload_owners');
}

const keyOfLink = (link: string) => {
  try { return decodeURIComponent(link.split(/[?#]/)[0].slice('/uploads/'.length)); } catch { return null; }
};

/**
 * One-time backfill from the same scan the legacy authorization used: a key referenced by records of exactly one
 * organization is assigned to it. A key referenced by several organizations is ambiguous and stays unassigned
 * (it keeps falling back to legacy inference, with a warning, until an operator resolves it).
 */
export async function backfillUploadOwners(db: Sql, records: Array<{ organizationId?: string | null; record: unknown }>) {
  if (await db.get('SELECT 1 FROM schema_migrations WHERE id = ?', BACKFILL_MARKER)) return { skipped: true, assigned: 0, ambiguous: 0 };
  const orgsByKey = new Map<string, Set<string>>();
  for (const { organizationId, record } of records) {
    if (!organizationId) continue;
    for (const link of uploadLinksIn(record)) {
      const key = keyOfLink(link);
      if (!key) continue;
      if (!orgsByKey.has(key)) orgsByKey.set(key, new Set());
      orgsByKey.get(key)!.add(organizationId);
    }
  }
  let assigned = 0, ambiguous = 0;
  await db.tx(async () => {
    for (const [key, orgs] of orgsByKey) {
      if (orgs.size !== 1) { ambiguous++; log.warn(`Upload ${key} is referenced by ${orgs.size} organizations; ownership left unassigned.`); continue; }
      await recordUploadOwner(db, key, [...orgs][0], 'backfill');
      assigned++;
    }
    await db.run(`INSERT INTO schema_migrations (id, "appliedAt", summary) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      BACKFILL_MARKER, new Date().toISOString(), `assigned ${assigned}, ambiguous ${ambiguous}`);
  });
  log.info(`Upload ownership backfill: ${assigned} assigned, ${ambiguous} ambiguous.`);
  return { skipped: false, assigned, ambiguous };
}

/**
 * Records allowed to vouch for `key`. With a server-written owner only that organization's records count, so a record
 * in another organization that merely contains the path string cannot grant access. Without one (legacy, not backfilled)
 * every referencing record counts, and the key is logged so it can be backfilled.
 */
export async function eligibleOwners<T extends { record: any }>(db: Sql, key: string, inferred: T[]): Promise<T[]> {
  const owner = await uploadOwnerOf(db, key);
  if (owner) return inferred.filter(item => item.record?.organizationId === owner);
  if (inferred.length) log.warn(`Serving legacy upload without a recorded owner: ${key}`);
  return inferred;
}
