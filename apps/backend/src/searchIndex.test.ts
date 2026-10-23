/** Workspace search index: the pg_trgm migration is index-assisted when the extension exists and harmless when it does not. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-search-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false', LOG_LEVEL: 'silent' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { runMigrations } = await import('./migrate');
const { MIGRATIONS } = await import('./migrations');
const { migration } = await import('./migrations/0008_search_trigram');
const { searchBusinessRows, searchPatterns, searchClauses, SEARCH_TEXT } = await import('./normalizedCoreStore');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => {
  database = await createTestDatabase();
  await runMigrations({ migrations: MIGRATIONS.filter((m) => m.id < '0008') });
  await sql.exec(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('o', 'O', 'o', now())`);
  for (let i = 0; i < 300; i++) {
    await sql.run(`INSERT INTO search_records (organization_id, entity_type, entity_id, title, body) VALUES ('o', 'contracts', ?, ?, ?)`, `C${i}`, `CTR-${i}`, `Agreement number ${i}\nnotes ${i % 7 ? 'standard' : 'Orchard special'}`);
  }
});
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });

const hasIndex = async () => Boolean(await sql.get(`SELECT 1 AS x FROM pg_indexes WHERE indexname = 'idx_v8_search_records_trgm'`));

test('without pg_trgm the migration still succeeds and search works through a scan', async () => {
  // Simulate a server where the extension cannot be created: the statement is pointed at an extension that does not exist.
  const unavailable = { ...sql, exec: (text: string) => sql.exec(text.replace('CREATE EXTENSION IF NOT EXISTS pg_trgm', 'CREATE EXTENSION IF NOT EXISTS pg_trgm_missing_for_test')) };
  await migration.up(unavailable as typeof sql);
  assert.equal(await hasIndex(), false);
  const hits = await searchBusinessRows(sql, 'o', 'orchard special');
  assert.ok(hits.length > 0 && hits.every((hit) => hit.entity_type === 'contracts'));
});

test('the migration creates a trigram GIN index that the search expression can use', async () => {
  await runMigrations();
  assert.equal(await hasIndex(), true);
  const patterns = searchPatterns('orchard special');
  assert.equal(patterns.length, 2);
  const plan = await sql.tx(async () => {
    await sql.exec('SET LOCAL enable_seqscan = off');
    // Without the organization predicate (which the planner may prefer on this tiny table) only the trigram index can serve the text match.
    return (await sql.all(`EXPLAIN SELECT entity_id FROM search_records WHERE ${searchClauses(SEARCH_TEXT, patterns)}`, ...patterns))
      .map((row) => row['QUERY PLAN']).join('\n');
  });
  assert.match(plan, /idx_v8_search_records_trgm/);
  assert.deepEqual((await searchBusinessRows(sql, 'o', 'orchard special', { limit: 3 })).length, 3);
  assert.deepEqual(await searchBusinessRows(sql, 'o', '%_\\'), [], 'wildcards are literal');
  assert.deepEqual(await searchBusinessRows(sql, 'other-org', 'orchard'), []);
});
