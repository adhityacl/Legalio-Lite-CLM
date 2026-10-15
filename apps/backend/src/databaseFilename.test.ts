import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrateLegacyDatabaseFilename } from './sqliteBackups';

test('legacy auth.db is migrated once to kaelyn.db with a rollback copy', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'legalio-db-filename-'));
  const legacyPath = path.join(directory, 'auth.db');
  const targetPath = path.join(directory, 'kaelyn.db');
  const source = new Database(legacyPath);
  source.exec("CREATE TABLE fixture(id TEXT PRIMARY KEY, value TEXT); INSERT INTO fixture VALUES ('one','preserved');");
  source.close();

  try {
    assert.equal(migrateLegacyDatabaseFilename(targetPath, directory), true);
    assert.equal(existsSync(targetPath), true);
    assert.equal(existsSync(legacyPath), false);
    assert.equal(statSync(targetPath).mode & 0o777, 0o600);
    const migrated = new Database(targetPath, { readonly: true });
    try {
      assert.deepEqual(migrated.prepare('SELECT * FROM fixture').all(), [{ id: 'one', value: 'preserved' }]);
      assert.equal(migrated.pragma('integrity_check', { simple: true }), 'ok');
    } finally { migrated.close(); }
    const rollbackPath = path.join(directory, 'backups', 'pre-kaelyn-filename-migration', 'auth.db');
    assert.equal(existsSync(rollbackPath), true);
    assert.equal(statSync(rollbackPath).mode & 0o777, 0o600);
    assert.equal(migrateLegacyDatabaseFilename(targetPath, directory), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('an existing kaelyn.db is never replaced by auth.db', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'legalio-db-filename-'));
  const legacy = new Database(path.join(directory, 'auth.db'));
  legacy.exec("CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES ('legacy');");
  legacy.close();
  const current = new Database(path.join(directory, 'kaelyn.db'));
  current.exec("CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES ('current');");
  current.close();
  try {
    assert.equal(migrateLegacyDatabaseFilename(path.join(directory, 'kaelyn.db'), directory), false);
    const verified = new Database(path.join(directory, 'kaelyn.db'), { readonly: true });
    try { assert.equal((verified.prepare('SELECT value FROM fixture').get() as { value: string }).value, 'current'); }
    finally { verified.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
