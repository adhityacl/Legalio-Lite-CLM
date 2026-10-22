import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';

// Needs PostgreSQL at TEST_DATABASE_URL (default postgres://legalio:legalio@127.0.0.1:5432/legalio).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-db-pg-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir });
delete process.env.DATABASE_URL;
const { connect, isUniqueViolation, sql, resolveDatabaseConfig, saveDatabaseConfig, testConnection, toPg } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => {
  database = await createTestDatabase();
  await sql.exec('CREATE TABLE t (id serial PRIMARY KEY, name text UNIQUE, n integer NOT NULL DEFAULT 0)');
});
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });

const names = async () => (await sql.all<{ name: string }>('SELECT name FROM t ORDER BY id')).map((row) => row.name);
const gate = () => { let open!: () => void; const wait = new Promise<void>((resolve) => { open = resolve; }); return { wait, open }; };

test('toPg numbers ? and @name outside quotes and rejects identifiers pg would fold', () => {
  assert.deepEqual(toPg('SELECT ? , ?', [1, 'a']), { text: 'SELECT $1 , $2', values: [1, 'a'] });
  assert.deepEqual(toPg('UPDATE t SET a = @a, b = @b WHERE a = @a', [{ a: 1, b: null, extra: 3 }]), { text: 'UPDATE t SET a = $1, b = $2 WHERE a = $1', values: [1, null] });
  assert.deepEqual(toPg(`SELECT '?', 'it''s @x', "@y" FROM t WHERE name LIKE ? ESCAPE '\\' AND id = ?`, ['%', 2]),
    { text: `SELECT '?', 'it''s @x', "@y" FROM t WHERE name LIKE $1 ESCAPE '\\' AND id = $2`, values: ['%', 2] });
  assert.deepEqual(toPg('SELECT $1::int', [7]), { text: 'SELECT $1::int', values: [7] });
  assert.throws(() => toPg('SELECT @missing', [{ other: 1 }]), /@missing/);
  assert.throws(() => toPg('SELECT @x', []), /@x/);
  assert.throws(() => toPg('SELECT organizationId FROM member', []), /organizationId/);
  assert.throws(() => toPg('SELECT m.id FROM member m WHERE m.userId = ?', ['u']), /userId/);
  assert.throws(() => toPg('SELECT COUNT(*) FROM user', []), /FROM user/);
  assert.throws(() => toPg('UPDATE user SET name = ?', ['x']), /UPDATE user/);
  assert.doesNotThrow(() => toPg('SELECT "organizationId" AS "orgName", user_id FROM "user" JOIN users ON true WHERE x = \'camelCase\'', []));
  const environment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try { assert.doesNotThrow(() => toPg('SELECT organizationId FROM user', [])); } finally { process.env.NODE_ENV = environment; }
});

test('tx commits on success, rolls back on error, and run reports changes', async () => {
  await sql.run('DELETE FROM t');
  assert.equal(await sql.tx(async () => { await sql.run('INSERT INTO t (name) VALUES (?)', 'kept'); return 'ok'; }), 'ok');
  await assert.rejects(sql.tx(async () => { await sql.run('INSERT INTO t (name) VALUES (@name)', { name: 'lost' }); throw new Error('boom'); }), /boom/);
  assert.deepEqual(await names(), ['kept']);
  assert.deepEqual(await sql.run('UPDATE t SET n = n + 1'), { changes: 1 });
  assert.equal(await sql.get('SELECT name FROM t WHERE name = ?', 'none'), undefined);
});

test('a failed nested tx rolls back only its savepoint and the outer tx continues', async () => {
  await sql.run('DELETE FROM t');
  await sql.tx(async () => {
    await sql.run(`INSERT INTO t (name) VALUES ('outer')`);
    // A failing statement aborts a pg transaction; the savepoint is what makes it recoverable.
    await assert.rejects(sql.tx(async () => { await sql.run(`INSERT INTO t (name) VALUES ('inner')`); await sql.run(`INSERT INTO t (name) VALUES ('outer')`); }), isUniqueViolation);
    await sql.tx(async () => { await sql.run(`INSERT INTO t (name) VALUES ('second')`); });
  });
  assert.deepEqual(await names(), ['outer', 'second']);
});

test('statements inside tx use its connection; statements outside use the pool without waiting', async () => {
  await sql.run('DELETE FROM t');
  const hold = gate();
  let inside = -1;
  const running = sql.tx(async () => {
    assert.equal(sql.inTx(), true);
    await sql.run(`INSERT INTO t (name) VALUES ('x')`);
    inside = (await sql.get('SELECT COUNT(*) AS n FROM t')).n;
    await hold.wait;
  });
  while (inside < 0) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(sql.inTx(), false);
  assert.equal((await sql.get('SELECT COUNT(*) AS n FROM t')).n, 0);
  hold.open();
  await running;
  assert.equal(inside, 1);
  assert.equal((await sql.get('SELECT COUNT(*) AS n FROM t')).n, 1);
});

test('work leaked from a finished tx falls back to the pool instead of a later tx', async () => {
  await sql.run('DELETE FROM t');
  let leaked!: Promise<{ inTx: boolean; n: number }>;
  await sql.tx(async () => {
    leaked = new Promise((resolve) => setTimeout(resolve, 20)).then(async () => ({ inTx: sql.inTx(), n: (await sql.get('SELECT COUNT(*) AS n FROM t')).n }));
  });
  const hold = gate();
  const later = sql.tx(async () => { await sql.run(`INSERT INTO t (name) VALUES ('uncommitted')`); await hold.wait; throw new Error('rolled back'); });
  assert.deepEqual(await leaked, { inTx: false, n: 0 });
  hold.open();
  await assert.rejects(later, /rolled back/);
});

test('timestamptz reads as an ISO string and int8 as a Number only when exact, without touching global parsers', async () => {
  assert.deepEqual(await sql.get(`SELECT '2026-10-22 10:00:00.5+07'::timestamptz AS at, 9007199254740993::int8 AS big, 5::int8 AS small, -3::int8 AS negative, NULL::timestamptz AS empty`),
    { at: '2026-10-22T03:00:00.500Z', big: '9007199254740993', small: 5, negative: -3, empty: null });
  assert.equal(pg.types.getTypeParser(20)('5'), '5');
});

test('isUniqueViolation recognizes pg duplicate keys only', async () => {
  await sql.run('DELETE FROM t');
  await sql.run(`INSERT INTO t (name) VALUES ('a')`);
  const failure = (text: string) => sql.run(text).then(() => assert.fail('expected a constraint error'), (err) => err);
  const duplicate = await failure(`INSERT INTO t (name) VALUES ('a')`);
  assert.equal(duplicate.code, '23505');
  assert.ok(isUniqueViolation(duplicate));
  assert.ok(!isUniqueViolation(await failure(`INSERT INTO t (name, n) VALUES ('b', NULL)`)));
});

test('saveDatabaseConfig writes an owner-only file that resolveDatabaseConfig reads, and DATABASE_URL wins', async () => {
  const file = path.join(dir, 'database.json');
  assert.equal(resolveDatabaseConfig(), null);
  fs.writeFileSync(`${file}.tmp`, 'stale', { mode: 0o644 });
  const cfg = { host: '127.0.0.1', port: 5432, user: 'legalio', password: 'secret', database: 'legalio_test_x', ssl: false };
  await saveDatabaseConfig(cfg);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
  assert.deepEqual(resolveDatabaseConfig(), cfg);
  process.env.DATABASE_URL = 'postgres://u:p@db:5432/legalio_test_env';
  try { assert.deepEqual(resolveDatabaseConfig(), { connectionString: 'postgres://u:p@db:5432/legalio_test_env' }); } finally { delete process.env.DATABASE_URL; }
});

test('test mode refuses databases outside legalio_test_*; testConnection checks credentials', async () => {
  assert.throws(() => connect({ connectionString: 'postgres://legalio:legalio@127.0.0.1:5432/legalio' }), /legalio_test_/);
  await assert.rejects(testConnection({ host: '127.0.0.1', user: 'legalio', password: 'legalio', database: 'legalio' }), /legalio_test_/);
  await testConnection({ connectionString: database.url });
  const wrong = new URL(database.url);
  wrong.password = 'wrong';
  await assert.rejects(testConnection({ connectionString: wrong.href }), /password/);
});
