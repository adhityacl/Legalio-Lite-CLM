/**
 * Boot-time entry for the schema: applies pending versioned migrations (see migrate.ts and ./migrations).
 * server.ts init() runs it before anything reads the tables; `npm run migrate` runs the same thing standalone.
 */
import { runMigrations } from './migrate';

export async function ensureSchema() {
  await runMigrations();
}
