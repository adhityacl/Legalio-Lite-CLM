import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, join } from 'node:path';
import { APP_DATA_DIR, AUTH_DB_PATH, REPOSITORY_DIR } from '../apps/backend/src/runtimePaths';

test('workspace cwd does not move the existing SQLite and upload defaults', () => {
  assert.equal(REPOSITORY_DIR, resolve('.'));
  assert.equal(APP_DATA_DIR, process.env.APP_DATA_DIR || REPOSITORY_DIR);
  assert.equal(AUTH_DB_PATH, process.env.AUTH_DB_PATH || join(REPOSITORY_DIR, 'auth.db'));
});
