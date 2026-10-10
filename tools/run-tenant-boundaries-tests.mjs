#!/usr/bin/env node
/**
 * Isolated tenant-boundaries test runner (PRD §15, AC-040).
 *
 * Every live server in the suite runs from its own mkdtemp directory with
 * APP_TEST_MODE=1; this runner never reuses a running server. It records
 * checksums of the workspace runtime files before and after and fails if any
 * changed, proving the suite did not touch auth.db, uploads/ or data_store.json.
 *
 *   node tools/run-tenant-boundaries-tests.mjs         API/migration/unit suites
 *   node tools/run-tenant-boundaries-tests.mjs --e2e   isolated browser suite
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve('.');
const watched = ['auth.db', 'auth.db-wal', 'auth.db-shm', 'data_store.json', 'uploads'];

function digest(path) {
  const hash = createHash('sha256');
  const walk = (p) => {
    if (!existsSync(p)) return hash.update(`missing:${p}`);
    const stat = statSync(p);
    if (stat.isDirectory()) {
      for (const name of readdirSync(p).sort()) walk(join(p, name));
    } else {
      hash.update(p).update(readFileSync(p));
    }
  };
  walk(path);
  return hash.digest('hex');
}

const snapshot = () => Object.fromEntries(watched.map((name) => [name, digest(join(root, name))]));
const before = snapshot();

const e2e = process.argv.includes('--e2e');
const command = e2e
  ? ['npx', ['playwright', 'test', '--config', 'playwright.tenant-boundaries.config.ts']]
  : ['npx', ['tsx', '--test', '--test-concurrency=1', 'tests/tenant-boundaries/api.test.ts', 'tests/tenant-boundaries/accountProfile.test.ts', 'tests/tenant-boundaries/migration.test.ts', 'tests/tenant-boundaries/store.test.ts', 'tests/rbac.test.ts']];
const env = { ...process.env };
delete env.APP_TEST_MODE; // each harness server sets its own isolated paths
const result = spawnSync(command[0], command[1], { stdio: 'inherit', env });

const after = snapshot();
const changed = watched.filter((name) => before[name] !== after[name]);
if (changed.length) {
  console.error(`\n[tenant-boundaries] FAILED: workspace runtime files changed during the run: ${changed.join(', ')}`);
  process.exit(1);
}
console.log('\n[tenant-boundaries] Workspace runtime files unchanged (auth.db, uploads/, data_store.json).');
process.exit(result.status ?? 1);
