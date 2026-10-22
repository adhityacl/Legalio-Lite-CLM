import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { createSql } from './db';

function fixture() {
  const raw = new Database(':memory:');
  raw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
  return { raw, sql: createSql(raw) };
}
const count = async (sql: ReturnType<typeof createSql>) => (await sql.get('SELECT COUNT(*) AS n FROM t')).n as number;
const gate = () => { let open!: () => void; const wait = new Promise<void>((resolve) => { open = resolve; }); return { wait, open }; };

test('get/all/run pass positional and named parameters through and report changes', async () => {
  const { raw, sql } = fixture();
  try {
    assert.deepEqual(await sql.run('INSERT INTO t (name) VALUES (?), (?)', 'a', 'b'), { changes: 2 });
    assert.equal((await sql.get('SELECT name FROM t WHERE name = @name', { name: 'b' })).name, 'b');
    assert.deepEqual((await sql.all('SELECT name FROM t ORDER BY id')).map((r) => r.name), ['a', 'b']);
    assert.equal(await sql.get('SELECT name FROM t WHERE id = 99'), undefined);
    await sql.exec('CREATE TABLE u (x); INSERT INTO u VALUES (1);');
    assert.deepEqual(await sql.get('SELECT 9007199254740993 AS big, 5 AS small'), { big: '9007199254740993', small: 5 });
  } finally { raw.close(); }
});

test('tx commits on success and rolls back on error', async () => {
  const { raw, sql } = fixture();
  try {
    assert.equal(await sql.tx(async () => { await sql.run("INSERT INTO t (name) VALUES ('kept')"); return 'ok'; }), 'ok');
    await assert.rejects(sql.tx(async () => { await sql.run("INSERT INTO t (name) VALUES ('lost')"); throw new Error('boom'); }), /boom/);
    assert.deepEqual((await sql.all('SELECT name FROM t')).map((r) => r.name), ['kept']);
    assert.equal(raw.inTransaction, false);
  } finally { raw.close(); }
});

test('a failed nested tx rolls back only its savepoint', async () => {
  const { raw, sql } = fixture();
  try {
    await sql.tx(async () => {
      await sql.run("INSERT INTO t (name) VALUES ('outer')");
      await assert.rejects(sql.tx(async () => { await sql.run("INSERT INTO t (name) VALUES ('inner')"); throw new Error('inner'); }));
      await sql.tx(async () => { await sql.run("INSERT INTO t (name) VALUES ('second')"); });
    });
    assert.deepEqual((await sql.all('SELECT name FROM t ORDER BY id')).map((r) => r.name), ['outer', 'second']);
  } finally { raw.close(); }
});

test('statements inside tx use it; statements outside wait for it to commit', async () => {
  const { raw, sql } = fixture();
  try {
    const hold = gate();
    let inside = -1;
    const running = sql.tx(async () => {
      assert.equal(sql.inTx(), true);
      await sql.run("INSERT INTO t (name) VALUES ('x')");
      inside = await count(sql);
      await hold.wait;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sql.inTx(), false);
    const outside = count(sql);
    hold.open();
    await running;
    assert.equal(inside, 1);
    assert.equal(await outside, 1);
  } finally { raw.close(); }
});

test('work leaked from a finished tx falls back to the connection queue instead of a later tx', async () => {
  const { raw, sql } = fixture();
  try {
    let leaked!: Promise<{ inTx: boolean; n: number }>;
    await sql.tx(async () => {
      leaked = new Promise((resolve) => setTimeout(resolve, 5)).then(async () => ({ inTx: sql.inTx(), n: await count(sql) }));
    });
    const hold = gate();
    const later = sql.tx(async () => { await sql.run("INSERT INTO t (name) VALUES ('uncommitted')"); await hold.wait; throw new Error('rolled back'); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    hold.open();
    await assert.rejects(later);
    assert.deepEqual(await leaked, { inTx: false, n: 0 });
  } finally { raw.close(); }
});

test('concurrent outermost transactions run one at a time in call order', async () => {
  const { raw, sql } = fixture();
  try {
    const events: string[] = [];
    const hold = gate();
    const first = sql.tx(async () => { events.push('first:start'); await hold.wait; events.push('first:end'); });
    const second = sql.tx(async () => { events.push('second:start'); events.push('second:end'); });
    await new Promise((resolve) => setImmediate(resolve));
    hold.open();
    await Promise.all([first, second]);
    assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
  } finally { raw.close(); }
});
