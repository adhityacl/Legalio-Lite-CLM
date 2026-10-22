/**
 * Async database facade. Callers write `await sql.get/all/run/exec(...)` and `await sql.tx(async () => ...)`
 * against the PostgreSQL pool from `connect()`.
 *
 * Parameters: positional `?` values, or a single object for `@name` placeholders.
 * Transactions are ambient (AsyncLocalStorage): every `sql.*` call awaited inside `tx` joins it,
 * a nested `tx` is a savepoint. Never leave a `sql.*` call un-awaited inside `tx`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import pg from 'pg';
import { DATABASE_CONFIG_FILE, IS_TEST_MODE } from './runtimePaths';

/** A duplicate key on insert; callers treat it as "someone else created it first" and re-read. */
export const isUniqueViolation = (err: unknown) => (err as { code?: unknown } | null)?.code === '23505';

/** Any integrity constraint (unique, foreign key, not null, check): SQLSTATE class 23. */
export const isConstraintViolation = (err: unknown) => /^23/.test(String((err as { code?: unknown } | null)?.code));

const QUOTED = /'[^']*'?|"[^"]*"?/g;

/**
 * Rewrites `?` and `@name` to `$n`, leaving '…' and "…" untouched (no backslash escapes: `ESCAPE '\'` is valid pg).
 * Outside production it then rejects what pg silently folds: unquoted camelCase, and bare `user` (= current_user).
 */
export function toPg(text: string, params: unknown[]): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const named = new Map<string, number>();
  let positional = 0;
  const translated = text.replace(/'[^']*'?|"[^"]*"?|\?|@([A-Za-z_]\w*)/g, (match, name?: string) => {
    if (match === '?') { values.push(params[positional++]); return `$${values.length}`; }
    if (!name) return match;
    let index = named.get(name);
    if (index === undefined) {
      const source = params[0] as Record<string, unknown> | undefined;
      if (!source || typeof source !== 'object' || !(name in source)) throw new Error(`No value for @${name}.`);
      values.push(source[name]);
      named.set(name, index = values.length);
    }
    return `$${index}`;
  });
  if (process.env.NODE_ENV !== 'production') {
    const bare = translated.replace(QUOTED, ' ');
    const folded = /\b[a-z]\w*[A-Z]\w*/.exec(bare)?.[0] ?? /\b(?:FROM|JOIN|INTO|UPDATE)\s+user\b/i.exec(bare)?.[0];
    if (folded) throw new Error(`Unquoted "${folded}" in SQL: pg folds it to lower case (bare user is current_user); double-quote the identifier.`);
  }
  // Text already written with $n keeps its positional values.
  return { text: translated, values: values.length ? values : params };
}

// Per query, never global: better-auth's own pool keeps pg's default parsers.
const timestamptz = pg.types.getTypeParser(1184);
const parsers: Record<number, (value: string) => unknown> = {
  1184: (value) => { const date = timestamptz(value); return date instanceof Date ? date.toISOString() : value; },
  20: (value) => (Number.isSafeInteger(Number(value)) ? Number(value) : value),
};
const types = { getTypeParser: ((oid: number, format?: 'text' | 'binary') => parsers[oid] ?? pg.types.getTypeParser(oid, format)) as pg.CustomTypesConfig['getTypeParser'] };

type PgStore = { done: boolean; savepoints: number; client: pg.PoolClient };
type Queryable = { query: (config: pg.QueryConfig) => Promise<pg.QueryResult> };

function buildPg(pool: () => pg.Pool) {
  const ambient = new AsyncLocalStorage<PgStore>();
  const active = () => { const store = ambient.getStore(); return store && !store.done ? store : undefined; };
  // No queue: outside a tx every statement takes any pooled connection and pg handles the concurrency.
  const query = (text: string, params: unknown[]) => {
    const target: Queryable = active()?.client ?? pool();
    return target.query({ ...toPg(text, params), types });
  };
  return {
    get: async <T = any>(text: string, ...params: unknown[]): Promise<T | undefined> => (await query(text, params)).rows[0] as T | undefined,
    all: async <T = any>(text: string, ...params: unknown[]): Promise<T[]> => (await query(text, params)).rows as T[],
    run: async (text: string, ...params: unknown[]): Promise<{ changes: number }> => ({ changes: (await query(text, params)).rowCount ?? 0 }),
    exec: async (text: string): Promise<void> => { await query(text, []); },
    inTx: () => Boolean(active()),
    async tx<T>(fn: () => Promise<T>): Promise<T> {
      const store = active();
      if (store) {
        const name = `sp_${++store.savepoints}`;
        await store.client.query(`SAVEPOINT ${name}`);
        try {
          const result = await fn();
          await store.client.query(`RELEASE SAVEPOINT ${name}`);
          return result;
        } catch (error) {
          await store.client.query(`ROLLBACK TO SAVEPOINT ${name}; RELEASE SAVEPOINT ${name}`);
          throw error;
        }
      }
      const client = await pool().connect();
      const own: PgStore = { done: false, savepoints: 0, client };
      let broken: Error | undefined;
      try {
        return await ambient.run(own, async () => {
          await client.query('BEGIN');
          try {
            const result = await fn();
            await client.query('COMMIT');
            return result;
          } catch (error) {
            await client.query('ROLLBACK').catch((err: Error) => { broken = err; });
            throw error;
          }
        });
      } finally {
        own.done = true;
        // A connection that could not roll back is destroyed instead of returned to the pool.
        client.release(broken);
      }
    },
  };
}

/** `database.json` (onboarding form) or `{ connectionString }` from DATABASE_URL. */
export interface DatabaseConfig { connectionString?: string; host?: string; port?: number; user?: string; password?: string; database?: string; ssl?: boolean }

function clientConfig(cfg: DatabaseConfig): pg.ClientConfig {
  const name = cfg.connectionString ? decodeURIComponent(new URL(cfg.connectionString).pathname.slice(1)) : cfg.database ?? '';
  if (IS_TEST_MODE && !name.startsWith('legalio_test_')) throw new Error(`APP_TEST_MODE=1 only uses legalio_test_* databases, not "${name}".`);
  return { ...cfg, ssl: cfg.ssl ? { rejectUnauthorized: true } : undefined };
}

let currentPool: pg.Pool | null = null;

export function connect(cfg: DatabaseConfig): pg.Pool {
  const config = clientConfig(cfg);
  if (currentPool) throw new Error('The database is already connected.');
  const created = new pg.Pool(config);
  // An idle connection dropped by the server must not crash the process; the pool replaces it.
  created.on('error', (err) => console.error('[db] idle connection error:', err.message));
  return currentPool = created;
}

export function pool(): pg.Pool {
  if (!currentPool) throw new Error('The database is not connected.');
  return currentPool;
}

export async function end() {
  const closing = currentPool;
  currentPool = null;
  await closing?.end();
}

export type Sql = ReturnType<typeof buildPg>;

/** The application's facade over `pool()`. */
export const sql: Sql = buildPg(pool);

/** DATABASE_URL wins over APP_DATA_DIR/database.json; null means onboarding still has to ask. */
export function resolveDatabaseConfig(): DatabaseConfig | null {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return { connectionString: url };
  try {
    return JSON.parse(readFileSync(DATABASE_CONFIG_FILE, 'utf8')) as DatabaseConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function testConnection(cfg: DatabaseConfig) {
  const client = new pg.Client({ ...clientConfig(cfg), connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** The file holds the database password: owner-only, and atomically replaced. */
export async function saveDatabaseConfig(cfg: DatabaseConfig) {
  const temp = `${DATABASE_CONFIG_FILE}.tmp`;
  await fs.writeFile(temp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  await fs.chmod(temp, 0o600); // writeFile's mode applies only when it creates the file
  await fs.rename(temp, DATABASE_CONFIG_FILE);
}
