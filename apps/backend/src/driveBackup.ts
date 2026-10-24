import { resolveActiveGoogleToken } from './googleDrive';
import path from 'path';
import fs from 'fs';
import { APP_DATA_DIR, IS_TEST_MODE } from './runtimePaths';
import { sanitizeParentFolderId, getOrCreateDriveFolder, uploadFileToDrive } from './lib/googleDriveSync';
import { db } from './memoryDb';
import { sql, withAdvisoryLock } from './db';
import { ObjectStore } from './objectStore';
import { getStore, getMimeType, onUploadStored } from './uploadStorage';
import { componentLog } from './logger';
const log = componentLog('driveBackup');

/** Optional backup of stored uploads to Google Drive (debounced, one pass at a time). */

/** The pre-database index file of single-instance releases; its entries are imported into the table once. */
export const LEGACY_DRIVE_BACKUP_INDEX = path.join(APP_DATA_DIR, "drive-backup.json");
export const DRIVE_BACKUP_LOCK_KEY = 0x4c474442; // "LGDB": one backup pass at a time across all instances
let driveBackupTimer: NodeJS.Timeout | null = null;

export async function importLegacyIndex() {
  let legacy: Record<string, string>;
  try { legacy = JSON.parse(fs.readFileSync(LEGACY_DRIVE_BACKUP_INDEX, "utf8")); } catch { return; }
  if (await sql.get("SELECT 1 FROM drive_backup_index LIMIT 1")) return;
  const now = new Date().toISOString();
  for (const [key, stamp] of Object.entries(legacy)) {
    await sql.run("INSERT INTO drive_backup_index (storage_key, stamp, backed_up_at) VALUES (?, ?, ?) ON CONFLICT (storage_key) DO NOTHING", key, String(stamp), now);
  }
  try { fs.renameSync(LEGACY_DRIVE_BACKUP_INDEX, `${LEGACY_DRIVE_BACKUP_INDEX}.imported`); } catch { /* read-only data directory: the table is filled, the file is just ignored from now on */ }
}
/**
 * Mirrors the uploaded objects (Org/Partner/Category keys) to Drive under the master root.
 * Object storage stays the source of truth: links and objects are never touched here. An object's ETag is its stamp, kept in the
 * `drive_backup_index` table, and a PostgreSQL advisory lock lets one instance run a pass at a time (the others answer `busy`).
 * `only` limits the pass to those keys; without it every object is checked.
 * shortcut: a file edited in place is uploaded again as a new Drive file, no version replace.
 * shortcut: a file that fails in an `only` pass is retried by the next full pass (connect, config save, Backup Sekarang).
 */
export interface DriveBackupResult { backedUpCount: number; failedCount: number; alreadyBackedUpCount?: number; skipped?: string; busy?: boolean }
export async function backupLocalFilesToGoogleDrive(token?, only?: string[]): Promise<DriveBackupResult> {
  const rootId = sanitizeParentFolderId(db.googleConfig?.driveFolderId);
  const activeToken = await resolveActiveGoogleToken(token);
  if (!rootId) return { backedUpCount: 0, failedCount: 0, skipped: "no_root_folder" };
  if (!activeToken) return { backedUpCount: 0, failedCount: 0, skipped: "not_connected" };
  let storage: ObjectStore;
  try {
    storage = getStore();
  } catch {
    return { backedUpCount: 0, failedCount: 0, skipped: "storage_not_configured" };
  }
  const outcome = await withAdvisoryLock(DRIVE_BACKUP_LOCK_KEY, async () => {
    await importLegacyIndex();
    let backedUpCount = 0;
    let failedCount = 0;
    let alreadyBackedUpCount = 0;
    const folderIds = new Map<string, string>();
    const folderFor = async (names: string[]) => {
      let parent = rootId;
      for (const name of names) {
        const key = `${parent}/${name}`;
        if (!folderIds.has(key)) folderIds.set(key, (await getOrCreateDriveFolder(name, parent, activeToken)).id);
        parent = folderIds.get(key)!;
      }
      return parent;
    };
    const objects = only
      ? (await Promise.all(only.map((key) => storage.list(key)))).flat().filter((o) => only.includes(o.key))
      : await storage.list("");
    const done = new Map((await sql.all<{ storage_key: string; stamp: string }>("SELECT storage_key, stamp FROM drive_backup_index")).map((r) => [r.storage_key, r.stamp]));
    for (const { key, etag: stamp } of objects) {
      const parts = key.split("/");
      if (parts.some((part) => part.startsWith("."))) continue;
      try {
        if (done.get(key) === stamp) {
          alreadyBackedUpCount++;
          continue;
        }
        const object = await storage.get(key);
        if (!object) throw new Error("Objek tidak ditemukan");
        const driveUrl = await uploadFileToDrive(
          parts[parts.length - 1],
          object.body.toString("base64"),
          getMimeType(key),
          await folderFor(parts.slice(0, -1)),
          activeToken,
        );
        if (!driveUrl?.includes("google.com")) throw new Error("Respon URL Drive tidak valid");
        // Recorded per file, so a crash or a lost lock never makes the next pass upload it again.
        await sql.run(`INSERT INTO drive_backup_index (storage_key, stamp, backed_up_at) VALUES (?, ?, ?)
          ON CONFLICT (storage_key) DO UPDATE SET stamp = excluded.stamp, backed_up_at = excluded.backed_up_at`, key, stamp, new Date().toISOString());
        backedUpCount++;
      } catch (err) {
        failedCount++;
        log.warn(`[Drive Backup] Gagal mencadangkan '${key}':`, err?.message);
      }
    }
    if (backedUpCount) log.info(`[Drive Backup] ${backedUpCount} file dicadangkan ke Google Drive.`);
    return { backedUpCount, failedCount, alreadyBackedUpCount };
  });
  return outcome.ran ? outcome.value! : { backedUpCount: 0, failedCount: 0, busy: true };
}
export const pendingDriveBackups = new Set<string>();
/** Debounced so a burst of uploads becomes one pass over just the new objects. */
export function scheduleDriveBackup(key: string) {
  if (IS_TEST_MODE) return;
  pendingDriveBackups.add(key);
  if (driveBackupTimer) clearTimeout(driveBackupTimer);
  driveBackupTimer = setTimeout(async () => {
    const batch = [...pendingDriveBackups];
    pendingDriveBackups.clear();
    try {
      const result = await backupLocalFilesToGoogleDrive(undefined, batch);
      if (result.busy) for (const key of batch) pendingDriveBackups.add(key);
    } catch (e) {
      log.warn("[Drive Backup]", e?.message);
    }
    if (pendingDriveBackups.size) scheduleDriveBackup([...pendingDriveBackups][0]);
  }, 5000);
}
onUploadStored((key) => scheduleDriveBackup(key));