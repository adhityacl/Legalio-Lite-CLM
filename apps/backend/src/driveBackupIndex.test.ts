/** The Drive backup remembers mirrored objects in the database (shared by every instance); the single-instance index file is imported once. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-drive-index-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false', LOG_LEVEL: 'silent' });
const { sql, withAdvisoryLock } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { ensureSchema } = await import('./schema');
const backup = await import('./driveBackup');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });

test('the index file of earlier releases is imported once, then set aside', async () => {
  fs.writeFileSync(backup.LEGACY_DRIVE_BACKUP_INDEX, JSON.stringify({ 'org/a/Folder DD/x.pdf': 'etag-1', 'org/a/Folder IO/y.pdf': 'etag-2' }));
  await backup.importLegacyIndex();
  assert.deepEqual((await sql.all(`SELECT storage_key, stamp FROM drive_backup_index ORDER BY storage_key`)).map((r) => [r.storage_key, r.stamp]), [['org/a/Folder DD/x.pdf', 'etag-1'], ['org/a/Folder IO/y.pdf', 'etag-2']]);
  assert.ok(!fs.existsSync(backup.LEGACY_DRIVE_BACKUP_INDEX));
  // A leftover file of an instance that did not import yet must not overwrite what the shared table already knows.
  fs.writeFileSync(backup.LEGACY_DRIVE_BACKUP_INDEX, JSON.stringify({ 'org/a/Folder DD/x.pdf': 'stale' }));
  await backup.importLegacyIndex();
  assert.equal((await sql.get(`SELECT stamp FROM drive_backup_index WHERE storage_key = 'org/a/Folder DD/x.pdf'`)).stamp, 'etag-1');
});

test('only one instance runs a backup pass at a time', async () => {
  const entered: string[] = [];
  const outcomes = await Promise.all([1, 2, 3].map((n) => withAdvisoryLock(backup.DRIVE_BACKUP_LOCK_KEY, async () => { entered.push(`in${n}`); await new Promise((r) => setTimeout(r, 150)); return n; })));
  assert.equal(outcomes.filter((o) => o.ran).length, 1);
  assert.equal(entered.length, 1);
});
