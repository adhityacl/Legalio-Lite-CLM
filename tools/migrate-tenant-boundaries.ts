/**
 * Explicit-path CLI for migration 002_tenant_boundaries (tenant-boundaries PRD §14.1).
 *
 *   npm run tenant-boundaries:migrate -- --db /abs/auth.db --report /abs/report.json
 *   npm run tenant-boundaries:migrate -- --db /abs/auth.db --report /abs/apply.json \
 *       --mapping /abs/mapping.json --apply --backup /abs/before.db
 *
 * Dry-run is the default and opens the database read-only. --apply needs an
 * unused --backup path; the backup uses SQLite's online backup API (WAL
 * content included) before the single write transaction starts.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { analyze, applyMigration, validateMapping } from '../apps/backend/src/migrations/002_tenant_boundaries';

const ALLOWED = new Set(['--db', '--report', '--mapping', '--backup', '--dry-run', '--apply']);
const VALUE_FLAGS = new Set(['--db', '--report', '--mapping', '--backup']);

export function parseArgs(argv: string[]) {
  const args: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!ALLOWED.has(flag)) throw new Error(`Unknown flag: ${flag}`);
    if (flag in args) throw new Error(`Duplicate flag: ${flag}`);
    if (VALUE_FLAGS.has(flag)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      if (!path.isAbsolute(value)) throw new Error(`${flag} must be an absolute path`);
      args[flag] = path.resolve(value);
    } else {
      args[flag] = true;
    }
  }
  if (!args['--db'] || !args['--report']) throw new Error('--db and --report are required');
  if (args['--apply'] && args['--dry-run']) throw new Error('Choose either --dry-run or --apply, not both');
  const db = args['--db'] as string;
  if (!fs.existsSync(db)) throw new Error('--db does not exist');
  if (args['--report'] === db) throw new Error('--report must differ from --db');
  if (args['--apply']) {
    const backup = args['--backup'] as string | undefined;
    if (!backup) throw new Error('--apply requires --backup');
    if (backup === db) throw new Error('--backup must differ from --db');
    if (fs.existsSync(backup)) throw new Error('--backup already exists; choose an unused path');
  } else if (args['--backup']) {
    throw new Error('--backup is only valid with --apply');
  }
  return {
    db,
    report: args['--report'] as string,
    mapping: args['--mapping'] as string | undefined,
    backup: args['--backup'] as string | undefined,
    apply: Boolean(args['--apply']),
  };
}

const writeReport = (file: string, report: unknown) => fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');

export async function main(argv: string[]) {
  const options = parseArgs(argv);
  const mapping = options.mapping ? JSON.parse(fs.readFileSync(options.mapping, 'utf8')) : null;
  if (!options.apply) {
    const db = new Database(options.db, { readonly: true, fileMustExist: true });
    try {
      const report = analyze(db);
      if (mapping) validateMapping(db, mapping, report); // surfaces mapping errors early, still read-only
      writeReport(options.report, report);
      const blocking = report.conflicts.filter((c) => c.blocking).length;
      console.log(`Dry-run complete: ${report.conflicts.length} conflict(s), ${blocking} blocking. Report: ${options.report}`);
    } finally {
      db.close();
    }
    return;
  }
  const db = new Database(options.db, { fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    const report = analyze(db);
    if (report.alreadyApplied) {
      writeReport(options.report, { ...report, applied: false, appliedChanges: {} });
      console.log('Migration already applied; nothing to do.');
      return;
    }
    validateMapping(db, mapping ?? { formatVersion: 1, migrationId: report.migrationId, sourceDigest: report.sourceDigest, resolutions: [] }, report);
    await db.backup(options.backup!);
    const result = applyMigration(db, mapping);
    writeReport(options.report, result.report);
    console.log(`Migration applied. Backup: ${options.backup}. Report: ${options.report}`);
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('tools', 'migrate-tenant-boundaries.ts'))) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`tenant-boundaries migration failed: ${err?.message || err}`);
    process.exit(1);
  });
}
