import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test } from 'node:test';
import { SQLiteBackups, applyPendingRestore } from '../apps/backend/src/sqliteBackups';

test('backup captures SQLite and uploads; validated restore preserves a safety backup and clears sessions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sqlite-backups-'));
  const dbPath = join(root, 'auth.db');
  let db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    db.exec("CREATE TABLE user(id TEXT PRIMARY KEY, role TEXT); CREATE TABLE session(id TEXT); INSERT INTO user VALUES('admin', 'superuser'); INSERT INTO session VALUES('old-session');");
    mkdirSync(join(root, 'uploads'));
    writeFileSync(join(root, 'uploads', 'document.txt'), 'original');
    const backups = new SQLiteBackups(db, root);
    const item = await backups.create();
    assert.equal(item.status, 'success');
    assert.ok(item.sizeBytes > 0);
    assert.ok(existsSync(backups.archive(item.id)));
    assert.equal(backups.list().length, 1);
    db.exec("INSERT INTO user VALUES('later', 'user')");
    writeFileSync(join(root, 'uploads', 'document.txt'), 'changed');
    await assert.rejects(backups.stageRestore(item.id, 'wrong'), /RESTORE/);
    await assert.rejects(backups.stageRestore('../auth.db', 'RESTORE'), /Invalid backup/);
    const staged = await backups.stageRestore(item.id, 'RESTORE');
    assert.ok(backups.list().some((entry) => entry.id === staged.safetyBackupId));
    db.close();
    applyPendingRestore(dbPath, root);
    db = new Database(dbPath);
    assert.equal((db.prepare('SELECT count(*) AS n FROM user').get() as any).n, 1);
    assert.equal((db.prepare('SELECT count(*) AS n FROM session').get() as any).n, 0);
    assert.equal(readFileSync(join(root, 'uploads', 'document.txt'), 'utf8'), 'original');
    assert.ok(!existsSync(join(root, 'backups', 'pending-restore.json')));
    applyPendingRestore(dbPath, root); // completed restores never replay
    const service = new SQLiteBackups(db, root);
    writeFileSync(join(root, 'backups', item.id, 'payload', 'uploads', 'document.txt'), 'tampered');
    await assert.rejects(service.stageRestore(item.id, 'RESTORE'), /integrity/i);
    assert.equal(readFileSync(join(root, 'uploads', 'document.txt'), 'utf8'), 'original');
  } finally { if (db.open) db.close(); rmSync(root, { recursive: true, force: true }); }
});

test('rejects symlinks, records failed backups and fails closed if a staged backup is corrupted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sqlite-backups-invalid-'));
  const dbPath = join(root, 'auth.db');
  const db = new Database(dbPath);
  try {
    db.exec("CREATE TABLE user(id TEXT PRIMARY KEY, role TEXT); CREATE TABLE session(id TEXT); INSERT INTO user VALUES('admin', 'superuser');");
    const service = new SQLiteBackups(db, root);
    assert.deepEqual(service.list(), []);
    assert.throws(() => service.archive('00000000-0000-0000-0000-000000000000'), /not available/);
    mkdirSync(join(root, 'uploads'));
    symlinkSync(dbPath, join(root, 'uploads', 'linked.db'));
    await assert.rejects(service.create(), /unsupported file/);
    assert.equal(service.list()[0].status, 'failed');
    rmSync(join(root, 'uploads', 'linked.db'));
    const item = await service.create();
    db.exec('CREATE TABLE new_schema (id TEXT)');
    await assert.rejects(service.stageRestore(item.id, 'RESTORE'), /schema differs/);
    db.exec('DROP TABLE new_schema');
    await service.stageRestore(item.id, 'RESTORE');
    db.close();
    writeFileSync(join(root, 'backups', item.id, 'payload', 'auth.db'), 'corrupt');
    assert.throws(() => applyPendingRestore(dbPath, root), /integrity/i);
    assert.ok(existsSync(join(root, 'backups', 'pending-restore.json')));
    const current = new Database(dbPath);
    assert.equal((current.prepare('SELECT count(*) AS n FROM user').get() as any).n, 1);
    current.close();
  } finally { if (db.open) db.close(); rmSync(root, { recursive: true, force: true }); }
});

test('maintenance waits for existing requests, rejects new writes and releases the lock after failure', async () => {
  const { default: express } = await import('express');
  const root = mkdtempSync(join(tmpdir(), 'sqlite-backup-maintenance-'));
  const db = new Database(join(root, 'auth.db'));
  const service = new SQLiteBackups(db, root);
  const app = express();
  let releaseSlow: () => void = () => {};
  let releaseBackup: () => void = () => {};
  let slowStarted: () => void = () => {};
  let operationStarted: () => void = () => {};
  const slowReady = new Promise<void>((resolve) => { slowStarted = resolve; });
  const backupReady = new Promise<void>((resolve) => { operationStarted = resolve; });
  app.use(service.middleware);
  app.get('/api/slow', (_req, res) => { releaseSlow = () => res.end(); slowStarted(); });
  app.post('/api/write', (_req, res) => res.json({ ok: true }));
  app.post('/api/auth-console/backups', async (_req, res) => {
    try {
      await service.exclusive(res, async () => {
        operationStarted();
        await new Promise<void>((resolve) => { releaseBackup = resolve; });
        throw new Error('simulated storage failure');
      });
    } catch { res.status(409).end(); }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const slow = fetch(base + '/api/slow');
    await slowReady;
    const backup = fetch(base + '/api/auth-console/backups', { method: 'POST' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal((await fetch(base + '/api/write', { method: 'POST' })).status, 503);
    releaseSlow(); await slow; await backupReady;
    assert.equal((await fetch(base + '/api/auth-console/backups', { method: 'POST' })).status, 409);
    releaseBackup(); await backup;
    assert.equal((await fetch(base + '/api/write', { method: 'POST' })).status, 200);
  } finally { releaseSlow(); releaseBackup(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); rmSync(root, { recursive: true, force: true }); }
});


test('import rejects archive links before extracting or staging a restore', async () => {
  const { execFileSync } = await import('node:child_process');
  const root = mkdtempSync(join(tmpdir(), 'sqlite-import-'));
  const db = new Database(join(root, 'auth.db'));
  try {
    mkdirSync(join(root, 'source', 'uploads'), { recursive: true });
    symlinkSync('/etc/passwd', join(root, 'source', 'uploads', 'link'));
    const archive = join(root, 'unsafe.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', join(root, 'source'), 'uploads']);
    const service = new SQLiteBackups(db, root);
    await assert.rejects(service.importArchive(archive), /unsafe archive/);
    assert.deepEqual(service.list(), []);
    assert.equal(existsSync(join(root, 'backups', 'pending-restore.json')), false);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});
