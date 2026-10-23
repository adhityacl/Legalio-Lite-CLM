/** `npm run migrate` applies pending schema migrations; `npm run migrate -- status` lists them. Uses DATABASE_URL or database.json. */
import 'dotenv/config';
import { connect, end, resolveDatabaseConfig } from './db';
import { migrationStatus, runMigrations } from './migrate';

async function main() {
  const command = process.argv[2] ?? 'up';
  if (command !== 'up' && command !== 'status') {
    console.error('Usage: migrate [up|status]');
    return 2;
  }
  const config = resolveDatabaseConfig();
  if (!config) {
    console.error('No database configured: set DATABASE_URL (or complete the onboarding database step).');
    return 2;
  }
  connect(config);
  try {
    if (command === 'status') {
      const status = await migrationStatus();
      for (const row of status.migrations) console.log(`${row.applied ? 'applied ' : 'PENDING '} ${row.id}  ${row.applied ? row.appliedAt : ''}  ${row.name}`);
      for (const id of status.unknown) console.log(`unknown  ${id}  (applied by a newer release)`);
      console.log(`${status.pending} pending`);
      return status.pending ? 1 : 0;
    }
    const report = await runMigrations();
    console.log(report.applied.length ? `Applied: ${report.applied.join(', ')}` : 'Database is up to date.');
    return 0;
  } finally {
    await end();
  }
}

main().then((code) => process.exit(code), (err) => { console.error('Migration failed:', err?.message ?? err); process.exit(1); });
