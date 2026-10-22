/**
 * Async database facade. Callers write `await sql.get/all/run/exec(...)` and `await sql.tx(async () => ...)`;
 * phase D swaps this SQLite backend for PostgreSQL behind the same shape.
 *
 * Parameters: positional `?` values, or a single object for `@name` placeholders.
 * Transactions are ambient (AsyncLocalStorage): every `sql.*` call awaited inside `tx` joins it,
 * a nested `tx` is a savepoint. Never leave a `sql.*` call un-awaited inside `tx`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type Database from 'better-sqlite3';

type Store = { done: boolean; savepoints: number };
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
// int8 values outside the double range stay exact as strings, matching the pg backend.
const plain = (row: any) => {
  if (row) for (const key in row) {
    const value = row[key];
    if (typeof value === 'bigint') row[key] = value <= MAX_SAFE && value >= -MAX_SAFE ? Number(value) : String(value);
  }
  return row;
};

function build(connection: () => Database.Database) {
  const ambient = new AsyncLocalStorage<Store>();
  const statements = new WeakMap<Database.Database, Map<string, Database.Statement>>();
  let queue: Promise<unknown> = Promise.resolve();
  // A store outlives its tx in any promise leaked from it; `done` sends such stragglers back to the queue.
  const active = () => { const store = ambient.getStore(); return store && !store.done ? store : undefined; };
  // SQLite has one connection: work outside the open transaction waits until it ends.
  const exclusive = <T>(fn: () => T | Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => undefined);
    return run;
  };
  const call = <T>(fn: () => T): Promise<T> => (active() ? new Promise<T>((resolve) => resolve(fn())) : exclusive(fn));
  const prepare = (text: string) => {
    const db = connection();
    let cache = statements.get(db);
    if (!cache) statements.set(db, cache = new Map());
    // shortcut: generated IN (?,?,…) lists make the key space open-ended; clearing at 1000 bounds memory, use an LRU if hit rates matter.
    if (cache.size > 1000) cache.clear();
    let statement = cache.get(text);
    if (!statement) cache.set(text, statement = db.prepare(text));
    return statement;
  };
  const reader = (text: string) => { const statement = prepare(text); return statement.reader ? statement.safeIntegers(true) : statement; };

  return {
    get: <T = any>(text: string, ...params: unknown[]): Promise<T | undefined> => call(() => plain(reader(text).get(...params)) as T | undefined),
    all: <T = any>(text: string, ...params: unknown[]): Promise<T[]> => call(() => (reader(text).all(...params) as any[]).map(plain) as T[]),
    run: (text: string, ...params: unknown[]): Promise<{ changes: number }> => call(() => ({ changes: prepare(text).run(...params).changes })),
    exec: (text: string): Promise<void> => call(() => { connection().exec(text); }),
    inTx: () => Boolean(active()),
    async tx<T>(fn: () => Promise<T>): Promise<T> {
      const store = active();
      if (store) {
        const name = `sp_${++store.savepoints}`;
        const db = connection();
        db.exec(`SAVEPOINT ${name}`);
        try {
          const result = await fn();
          db.exec(`RELEASE ${name}`);
          return result;
        } catch (error) {
          db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
          throw error;
        }
      }
      return exclusive(() => {
        const own: Store = { done: false, savepoints: 0 };
        return ambient.run(own, async () => {
          const db = connection();
          db.exec('BEGIN');
          try {
            const result = await fn();
            db.exec('COMMIT');
            return result;
          } catch (error) {
            if (db.inTransaction) db.exec('ROLLBACK');
            throw error;
          } finally {
            own.done = true;
          }
        });
      });
    },
  };
}

export type Sql = ReturnType<typeof build>;

const facades = new WeakMap<Database.Database, Sql>();
let current: Database.Database | null = null;

/** The application's facade; `useSqlite` binds it to the process connection. */
export const sql: Sql = build(() => {
  if (!current) throw new Error('The database is not connected.');
  return current;
});

export function useSqlite(connection: Database.Database) {
  current = connection;
  facades.set(connection, sql);
}

/** One facade (one queue, one ambient tx) per connection; tests and migrations wrap their own handles. */
export function createSql(connection: Database.Database): Sql {
  let facade = facades.get(connection);
  if (!facade) facades.set(connection, facade = build(() => connection));
  return facade;
}

/** A duplicate key on insert; callers treat it as "someone else created it first" and re-read. Phase D adds pg `23505`. */
export const isUniqueViolation = (err: unknown) =>
  ['SQLITE_CONSTRAINT_UNIQUE', 'SQLITE_CONSTRAINT_PRIMARYKEY'].includes(String((err as { code?: unknown } | null)?.code));
