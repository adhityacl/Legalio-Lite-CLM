import { resolveActiveGoogleToken } from './googleDrive';
import path from 'path';
import fs from 'fs';
import { APP_DATA_DIR, IS_TEST_MODE } from './runtimePaths';
import { sanitizeParentFolderId, getOrCreateDriveFolder, uploadFileToDrive } from './lib/googleDriveSync';
import { db } from './memoryDb';
import { ObjectStore } from './objectStore';
import { getStore, getMimeType, onUploadStored } from './uploadStorage';
import { componentLog } from './logger';
const log = componentLog('driveBackup');

/** Optional backup of stored uploads to Google Drive (debounced, one pass at a time). */

export const DRIVE_BACKUP_INDEX = path.join(APP_DATA_DIR, "drive-backup.json");
let driveBackupRunning = false;
let driveBackupTimer: NodeJS.Timeout | null = null;
/**
 * Mirrors the uploaded objects (Org/Partner/Category keys) to Drive under the master root.
 * Object storage stays the source of truth: links and objects are never touched here. An object's ETag is its stamp.
 * `only` limits the pass to those keys; without it every object is checked.
 * shortcut: a file edited in place is uploaded again as a new Drive file, no version replace.
 * shortcut: a file that fails in an `only` pass is retried by the next full pass (connect, config save, Backup Sekarang).
 */
export async function backupLocalFilesToGoogleDrive(token?, only?: string[]) {
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
  if (driveBackupRunning) return { backedUpCount: 0, failedCount: 0, busy: true };
  driveBackupRunning = true;
  let backedUpCount = 0;
  let failedCount = 0;
  let alreadyBackedUpCount = 0;
  let done: Record<string, string> = {};
  try {
    done = JSON.parse(fs.readFileSync(DRIVE_BACKUP_INDEX, "utf8"));
  } catch (_) {}
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
  try {
    const objects = only
      ? (await Promise.all(only.map((key) => storage.list(key)))).flat().filter((o) => only.includes(o.key))
      : await storage.list("");
    for (const { key, etag: stamp } of objects) {
      const parts = key.split("/");
      if (parts.some((part) => part.startsWith("."))) continue;
      try {
        if (done[key] === stamp) {
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
        done[key] = stamp;
        backedUpCount++;
      } catch (err) {
        failedCount++;
        log.warn(`[Drive Backup] Gagal mencadangkan '${key}':`, err?.message);
      }
    }
  } finally {
    driveBackupRunning = false;
    try {
      fs.writeFileSync(DRIVE_BACKUP_INDEX, JSON.stringify(done));
    } catch (err) {
      log.warn("[Drive Backup] Gagal menyimpan indeks backup:", err?.message);
    }
  }
  if (backedUpCount) log.info(`[Drive Backup] ${backedUpCount} file dicadangkan ke Google Drive.`);
  return { backedUpCount, failedCount, alreadyBackedUpCount };
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