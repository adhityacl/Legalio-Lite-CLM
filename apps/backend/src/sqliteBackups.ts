import fs from 'node:fs';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import type { RequestHandler, Response } from 'express';
import { ApiError } from './organizationSettingsStore';

const run = promisify(execFile);
const DATABASE_FILENAME = 'kaelyn.db';
const LEGACY_DATABASE_FILENAME = 'auth.db';
const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
export interface BackupEntry { id: string; createdAt: string; status: 'success' | 'failed'; sizeBytes: number; purpose: 'manual' | 'safety'; }
const invalid = (message: string) => new ApiError(400, 'INVALID_BACKUP', message);
function digest(file: string) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try { let bytes: number; while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, bytes)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function inventory(root: string, prefix = ''): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of fs.readdirSync(path.join(root, prefix)).sort()) {
    const relative = path.join(prefix, name);
    const file = path.join(root, relative);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw invalid('Backup contains an unsupported file.');
    if (stat.isDirectory()) Object.assign(files, inventory(root, relative));
    else if (relative !== 'manifest.json') files[relative] = digest(file);
  }
  return files;
}
function schema(db: Database.Database) {
  return JSON.stringify(db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all());
}
function databaseFile(payload: string) {
  const candidates = [DATABASE_FILENAME, LEGACY_DATABASE_FILENAME].filter((name) => fs.existsSync(path.join(payload, name)));
  if (candidates.length !== 1) throw invalid('Backup must contain exactly one SQLite database file.');
  return path.join(payload, candidates[0]);
}
function validate(directory: string, expectedSchema?: string) {
  const payload = path.join(directory, 'payload');
  const manifest = JSON.parse(fs.readFileSync(path.join(payload, 'manifest.json'), 'utf8'));
  if (manifest.format !== 'legalio-backup-v1' || JSON.stringify(inventory(payload)) !== JSON.stringify(manifest.files)) throw invalid('Backup integrity validation failed.');
  const db = new Database(databaseFile(payload), { readonly: true, fileMustExist: true });
  try {
    if ((db.pragma('quick_check', { simple: true }) !== 'ok') || (db.pragma('foreign_key_check') as unknown[]).length) throw invalid('SQLite integrity validation failed.');
    if (expectedSchema && schema(db) !== expectedSchema) throw invalid('Backup schema differs from this application version.');
    if (!db.prepare("SELECT 1 FROM user WHERE role = 'superuser' LIMIT 1").get()) throw invalid('Backup must contain a superuser account.');
  } finally { db.close(); }
  return payload;
}

/** One-time, idempotent rename for installations created before kaelyn.db became the default. */
export function migrateLegacyDatabaseFilename(dbPath: string, dataDir: string) {
  if (path.basename(dbPath) !== DATABASE_FILENAME || fs.existsSync(dbPath)) return false;
  const legacyPath = path.join(path.dirname(dbPath), LEGACY_DATABASE_FILENAME);
  if (!fs.existsSync(legacyPath)) return false;
  const stagedPath = dbPath + '.migrate';
  fs.rmSync(stagedPath, { force: true });
  const source = new Database(legacyPath, { fileMustExist: true });
  try {
    if (source.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Legacy SQLite integrity validation failed.');
    source.prepare('VACUUM INTO ?').run(stagedPath);
  } finally { source.close(); }
  try {
    const candidate = new Database(stagedPath, { readonly: true, fileMustExist: true });
    try {
      if (candidate.pragma('quick_check', { simple: true }) !== 'ok' || (candidate.pragma('foreign_key_check') as unknown[]).length) {
        throw new Error('Migrated SQLite integrity validation failed.');
      }
    } finally { candidate.close(); }
    fs.chmodSync(stagedPath, 0o600);
    fs.renameSync(stagedPath, dbPath);
  } catch (error) {
    fs.rmSync(stagedPath, { force: true });
    throw error;
  }

  const rollbackDirectory = path.join(dataDir, 'backups', 'pre-kaelyn-filename-migration');
  fs.mkdirSync(rollbackDirectory, { recursive: true, mode: 0o700 });
  for (const suffix of ['', '-wal', '-shm']) {
    const sourcePath = legacyPath + suffix;
    if (!fs.existsSync(sourcePath)) continue;
    const rollbackPath = path.join(rollbackDirectory, LEGACY_DATABASE_FILENAME + suffix);
    if (!fs.existsSync(rollbackPath)) fs.renameSync(sourcePath, rollbackPath);
    fs.chmodSync(rollbackPath, 0o600);
  }
  console.log(`SQLite database renamed from ${LEGACY_DATABASE_FILENAME} to ${DATABASE_FILENAME}.`);
  return true;
}
function writeJson(file: string, value: unknown) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}

/** Apply only before ANY SQLite connection opens. A pending marker survives failures, so startup fails closed and retries rather than serving partial data. */
export function applyPendingRestore(dbPath: string, dataDir: string) {
  const root = path.join(dataDir, 'backups');
  const pending = path.join(root, 'pending-restore.json');
  if (!fs.existsSync(pending)) return;
  const { id } = JSON.parse(fs.readFileSync(pending, 'utf8'));
  if (typeof id !== 'string' || !validId(id)) throw invalid('Invalid backup identifier.');
  const payload = validate(path.join(root, id));
  const uploads = path.join(dataDir, 'uploads');
  const staged = uploads + '.restore';
  fs.rmSync(staged, { recursive: true, force: true });
  fs.cpSync(path.join(payload, 'uploads'), staged, { recursive: true });
  fs.copyFileSync(databaseFile(payload), dbPath + '.restore');
  fs.chmodSync(dbPath + '.restore', 0o600);
  const candidate = new Database(dbPath + '.restore');
  try { candidate.exec('DELETE FROM session'); } finally { candidate.close(); }
  // WAL sidecars belong to the old database, and must not be replayed against the restored file.
  for (const suffix of ['-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  fs.renameSync(dbPath + '.restore', dbPath);
  fs.rmSync(uploads, { recursive: true, force: true });
  fs.renameSync(staged, uploads);
  fs.unlinkSync(pending);
}

export class SQLiteBackups {
  private root: string;
  private busy = false;
  private pending = false;
  private active = new Set<Response>();
  constructor(private db: Database.Database, private dataDir: string) { this.root = path.join(dataDir, 'backups'); }
  // ponytail: one backend process owns the database/uploads. Multiple writers or replicas require an external maintenance lock.
  middleware: RequestHandler = (req, res, next) => {
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/uploads/')) return next();
    if ((this.busy || this.pending) && req.path !== '/api/health' && !req.path.startsWith('/api/auth-console/backups')) {
      res.setHeader('Retry-After', '5');
      res.status(503).json({ error: 'BACKUP_MAINTENANCE', message: 'Backup or restore maintenance is in progress.' });
      return;
    }
    this.active.add(res);
    // ponytail: an aborted response may leave an async writer running; retain it until restart rather than risk an inconsistent snapshot.
    res.once('finish', () => this.active.delete(res));
    next();
  };
  async exclusive<T>(response: Response, operation: () => Promise<T>) {
    if (this.busy || this.pending) throw new ApiError(409, 'BACKUP_BUSY', 'Another backup or restore is in progress.');
    this.busy = true;
    try {
      const deadline = Date.now() + 30_000;
      while ([...this.active].some((res) => res !== response)) {
        if ([...this.active].some((res) => res !== response && res.destroyed)) throw new ApiError(409, 'BACKUP_BUSY', 'An interrupted request may still be writing. Restart the backend before backing up.');
        if (Date.now() > deadline) throw new ApiError(409, 'BACKUP_BUSY', 'Active requests have not finished. Retry the backup.');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return await operation();
    } finally { this.busy = false; }
  }
  private directory(id: string) {
    if (!validId(id)) throw invalid('Invalid backup identifier.');
    return path.join(this.root, id);
  }
  list(): BackupEntry[] {
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root).filter(validId).flatMap((id) => {
      try { return [JSON.parse(fs.readFileSync(path.join(this.directory(id), 'entry.json'), 'utf8')) as BackupEntry]; } catch { return []; }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async create(purpose: BackupEntry['purpose'] = 'manual'): Promise<BackupEntry> {
    const id = crypto.randomUUID();
    const directory = this.directory(id);
    const payload = path.join(directory, 'payload');
    await mkdir(path.join(payload, 'uploads'), { recursive: true, mode: 0o700 });
    fs.chmodSync(this.root, 0o700);
    const entry: BackupEntry = { id, createdAt: new Date().toISOString(), status: 'failed', sizeBytes: 0, purpose };
    try {
      await this.db.backup(path.join(payload, DATABASE_FILENAME));
      const snapshot = new Database(path.join(payload, DATABASE_FILENAME));
      try { snapshot.pragma('journal_mode = DELETE'); } finally { snapshot.close(); }
      fs.chmodSync(path.join(payload, DATABASE_FILENAME), 0o600);
      const uploads = path.join(this.dataDir, 'uploads');
      if (fs.existsSync(uploads)) await cp(uploads, path.join(payload, 'uploads'), { recursive: true, filter: (source) => {
        const stat = fs.lstatSync(source);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw invalid('Uploads contain an unsupported file.');
        return true;
      } });
      writeJson(path.join(payload, 'manifest.json'), { format: 'legalio-backup-v1', files: inventory(payload) });
      await run('tar', ['-czf', path.join(directory, 'backup.tar.gz'), '-C', payload, DATABASE_FILENAME, 'uploads', 'manifest.json']);
      fs.chmodSync(path.join(directory, 'backup.tar.gz'), 0o600);
      entry.sizeBytes = fs.statSync(path.join(directory, 'backup.tar.gz')).size;
      entry.status = 'success';
      return entry;
    } finally { writeJson(path.join(directory, 'entry.json'), entry); }
  }
  archive(id: string) {
    const directory = this.directory(id);
    if (!this.list().some((item) => item.id === id && item.status === 'success')) throw invalid('Backup is not available.');
    validate(directory);
    return path.join(directory, 'backup.tar.gz');
  }
  async importArchive(archive: string) {
    const id = crypto.randomUUID();
    const directory = this.directory(id);
    const payload = path.join(directory, 'payload');
    await mkdir(payload, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.root, 0o700);
    try {
      // Validate every member before extraction: no traversal, links, devices or unexpected roots.
      const options = { timeout: 30_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } };
      const { stdout: names } = await run('tar', ['-tzf', archive], options);
      const { stdout: details } = await run('tar', ['-tvzf', archive], options);
      const members = names.trimEnd().split('\n');
      let expanded = 0;
      const rows = details.trimEnd().split('\n');
      if (rows.length !== members.length) throw invalid('Invalid archive members.');
      for (let i = 0; i < members.length; i++) {
        const name = members[i];
        const parts = name.replace(/\/$/, '').split('/');
        if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\')) ||
            !([DATABASE_FILENAME, LEGACY_DATABASE_FILENAME, 'manifest.json'].includes(name) || name === 'uploads/' || name.startsWith('uploads/')) ||
            !['-', 'd'].includes(rows[i][0])) throw invalid('Backup contains an unsafe archive member.');
        const size = Number(rows[i].split(/\s+/)[2]);
        if (!Number.isSafeInteger(size) || size < 0) throw invalid('Invalid archive size.');
        expanded += size;
        if (expanded > 2 * 1024 ** 3) throw invalid('Expanded backup exceeds 2 GB.');
      }
      await run('tar', ['-xzf', archive, '-C', payload, '--no-same-owner', '--no-same-permissions'], options);
      if (!fs.statSync(path.join(payload, 'uploads')).isDirectory()) throw invalid('Backup uploads directory is missing.');
      validate(directory, schema(this.db));
      fs.copyFileSync(archive, path.join(directory, 'backup.tar.gz'));
      fs.chmodSync(path.join(directory, 'backup.tar.gz'), 0o600);
      writeJson(path.join(directory, 'entry.json'), { id, createdAt: new Date().toISOString(), status: 'success', sizeBytes: fs.statSync(archive).size, purpose: 'manual' });
      return id;
    } catch (error) {
      fs.rmSync(directory, { recursive: true, force: true });
      if (error instanceof ApiError) throw error;
      throw invalid('Invalid or unreadable backup archive.');
    }
  }
  async stageRestore(id: string, confirmation: string) {
    if (confirmation !== 'RESTORE') throw invalid('Type RESTORE to confirm.');
    this.archive(id);
    validate(this.directory(id), schema(this.db));
    const safety = await this.create('safety');
    writeJson(path.join(this.root, 'pending-restore.json'), { id, safetyBackupId: safety.id });
    this.pending = true;
    return { safetyBackupId: safety.id, restartRequired: true };
  }
}
