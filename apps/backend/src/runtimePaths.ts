/**
 * Single source for mutable runtime locations (tenant-boundaries PRD §15).
 *
 * - AUTH_DB_PATH: absolute SQLite path; development default is ./kaelyn.db.
 * - APP_DATA_DIR: absolute directory for the Drive backup index and legacy data_store.json;
 *   development default is the working directory.
 * - APP_TEST_MODE=1: both paths must be explicit, absolute and inside the OS
 *   temp directory, and startup side effects (demo reseeding, Google
 *   provisioning, SMTP/AI/Google calls, periodic jobs) are disabled.
 */
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_DIR = path.resolve(typeof __dirname === 'string' ? __dirname : path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const IS_TEST_MODE = process.env.APP_TEST_MODE === '1';

function resolveExplicit(name: 'AUTH_DB_PATH' | 'APP_DATA_DIR', fallback: string): string {
  const raw = (process.env[name] || '').trim();
  if (!raw) {
    if (IS_TEST_MODE) throw new Error(`${name} must be set when APP_TEST_MODE=1.`);
    return fallback;
  }
  if (!path.isAbsolute(raw)) throw new Error(`${name} must be an absolute path.`);
  const resolved = path.resolve(raw);
  if (IS_TEST_MODE) {
    const tmp = path.resolve(os.tmpdir());
    if (!resolved.startsWith(tmp + path.sep)) {
      throw new Error(`${name} must be inside ${tmp} when APP_TEST_MODE=1.`);
    }
  }
  return resolved;
}

export const AUTH_DB_PATH = resolveExplicit('AUTH_DB_PATH', path.join(REPOSITORY_DIR, 'kaelyn.db'));
export const APP_DATA_DIR = resolveExplicit('APP_DATA_DIR', REPOSITORY_DIR);
export const LEGACY_DATA_FILE = path.join(APP_DATA_DIR, 'data_store.json');
