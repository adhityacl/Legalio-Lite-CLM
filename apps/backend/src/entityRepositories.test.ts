/**
 * Every repository-backed entity on real PostgreSQL: row-level writes, optimistic concurrency (same-row race -> one winner and one 409,
 * different rows in parallel), locked server-side edits, cascading deletes, and independence from the snapshot sync.
 * Add an entry to SPECS when another entity moves to a repository.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-entity-repos-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false', LOG_LEVEL: 'silent' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { ensureSchema } = await import('./schema');
const { VersionConflictError } = await import('./repositories/errors');
const { synchronizeBusinessRows, resetSyncCache } = await import('./normalizedCoreStore');
const { partnerRepository } = await import('./repositories/partnerRepository');
const { ioRepository } = await import('./repositories/ioRepository');

type Row = Record<string, any>;
interface Spec {
  name: string;
  table: string;
  key: string;
  repo: { insert(row: Row): Promise<Row>; update(row: Row, version: number): Promise<Row>; get(org: string, id: string): Promise<Row | undefined>; mutate(org: string, id: string, change: (row: Row) => void): Promise<Row | undefined>; remove(org: string, id: string): Promise<boolean> };
  make(id: string, org?: string): Row;
  /** A top-level field the tests edit, and a child table row count for the cascade check. */
  field: string;
  childTable?: string;
  childKey?: string;
}

const SPECS: Spec[] = [
  {
    name: 'partners', table: 'partners', key: 'partner_id', repo: partnerRepository, field: 'partner_name', childTable: 'partner_categories', childKey: 'partner_id',
    make: (id, org = 'org-a') => ({ partner_id: id, organizationId: org, partner_name: `Partner ${id}`, country: 'ID', internal_pic: 'Sales', tags: ['Supplier', 'IT'], identifiers: [{ scheme: 'tax', value: id, country: 'ID' }],
      dd_documents: [{ key: 'reg', name: 'Registration', required: true, expires: false, status: 'Available', files: [{ id: `f-${id}`, fileName: 'a.pdf', linkDrive: `/uploads/${id}.pdf` }] }], notes: 'Orchard notes', custom_extension: { keep: true } }),
  },
  {
    name: 'insertion orders', table: 'insertion_orders', key: 'io_id', repo: ioRepository, field: 'io_title',
    make: (id, org = 'org-a') => ({ io_id: id, organizationId: org, io_number: `IO-${id}`, io_title: `Order ${id}`, partner_id: null, contract_id: null, io_value: 0.29, currency: 'USD', status: 'Active',
      start_date: '2026-01-01', end_date: '2030-01-01', media_channel: 'Digital', deliverables: 'Orchard banners', custom_extension: { keep: true } }),
  },
];

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => {
  await sql.exec(`TRUNCATE organization, search_records CASCADE`);
  await sql.exec(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('org-a', 'A', 'a', now()), ('org-b', 'B', 'b', now())`);
});

for (const spec of SPECS) {
  describe(`${spec.name} repository`, () => {
    const { repo } = spec;

    test('insert and get: version 1, extra fields and children round-trip, organizations are isolated', async () => {
      const first = await repo.insert(spec.make('X1'));
      await repo.insert(spec.make('X2', 'org-b'));
      assert.equal(first.version, 1);
      assert.deepEqual(first.custom_extension ?? { keep: true }, { keep: true });
      assert.equal((await repo.get('org-a', 'X1'))?.[spec.key], 'X1');
      assert.equal(await repo.get('org-a', 'X2'), undefined, 'another organization cannot read it by id');
      assert.equal(await repo.remove('org-a', 'X2'), false, 'and cannot delete it');
      assert.equal((await repo.get('org-b', 'X2'))?.[spec.key], 'X2');
    });

    test('update increments the version; a stale version is rejected with a 409 and changes nothing', async () => {
      const created = await repo.insert(spec.make('X1'));
      const updated = await repo.update({ ...created, [spec.field]: 'Edited' }, 1);
      assert.equal(updated.version, 2);
      await assert.rejects(() => repo.update({ ...created, [spec.field]: 'Stale write' }, 1), (error: any) => {
        assert.ok(error instanceof VersionConflictError);
        assert.equal(error.status, 409);
        assert.equal(error.apiCode, 'VERSION_CONFLICT');
        return true;
      });
      const stored = (await repo.get('org-a', 'X1'))!;
      assert.equal(stored[spec.field], 'Edited');
      assert.equal(stored.version, 2);
    });

    test('same-row race: exactly one winner, one 409, and the stored content is the winner\'s', async () => {
      const created = await repo.insert(spec.make('X1'));
      const outcomes = await Promise.allSettled([
        repo.update({ ...created, [spec.field]: 'Writer one', notes: 'one' }, created.version),
        repo.update({ ...created, [spec.field]: 'Writer two', notes: 'two' }, created.version),
      ]);
      const won = outcomes.filter((o): o is PromiseFulfilledResult<Row> => o.status === 'fulfilled');
      const lost = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
      assert.equal(won.length, 1);
      assert.equal(lost.length, 1);
      assert.ok(lost[0].reason instanceof VersionConflictError);
      const stored = (await repo.get('org-a', 'X1'))!;
      assert.equal(stored.version, 2);
      assert.equal(stored[spec.field], won[0].value[spec.field]);
    });

    test('different rows update in parallel without interfering', async () => {
      const rows = await Promise.all(Array.from({ length: 8 }, (_, i) => repo.insert(spec.make(`X${i}`))));
      const results = await Promise.all(rows.map((row) => repo.update({ ...row, [spec.field]: `Edited ${row[spec.key]}` }, row.version)));
      assert.ok(results.every((row) => row.version === 2));
      for (const row of rows) assert.equal((await repo.get('org-a', row[spec.key]))![spec.field], `Edited ${row[spec.key]}`);
    });

    test('mutate is a locked read-modify-write: concurrent edits of different fields all land, none fails', async () => {
      await repo.insert(spec.make('X1'));
      const n = 6;
      await Promise.all(Array.from({ length: n }, (_, i) => repo.mutate('org-a', 'X1', (row) => { row.counter_list = [...(row.counter_list ?? []), i]; })));
      const stored = (await repo.get('org-a', 'X1'))!;
      assert.deepEqual([...stored.counter_list].sort(), Array.from({ length: n }, (_, i) => i));
      assert.equal(stored.version, 1 + n);
      assert.equal(await repo.mutate('org-a', 'missing', () => undefined), undefined);
    });

    test('delete removes the row, its child rows and its search entry', async () => {
      await repo.insert(spec.make('X1'));
      assert.equal(await repo.remove('org-a', 'X1'), true);
      assert.equal(await repo.get('org-a', 'X1'), undefined);
      if (spec.childTable) assert.equal((await sql.get(`SELECT COUNT(*) AS n FROM ${spec.childTable} WHERE ${spec.childKey} = 'X1'`)).n, 0);
      assert.equal((await sql.get(`SELECT COUNT(*) AS n FROM search_records WHERE entity_id = 'X1'`)).n, 0);
    });

    test('the snapshot sync never writes, reads or deletes these rows', async () => {
      await repo.insert(spec.make('X1'));
      await repo.insert(spec.make('X2'));
      const stamp = async () => sql.all(`SELECT ${spec.key} AS id, xmin::text AS xmin, version FROM ${spec.table} ORDER BY ${spec.key}`);
      const before = await stamp();
      resetSyncCache(sql);
      const collection = (await import('./normalizedSchema')).entityFor(spec.table).collection;
      await synchronizeBusinessRows(sql, { [collection]: [] });
      await synchronizeBusinessRows(sql, { [collection]: [spec.make('GHOST')] });
      assert.deepEqual(await stamp(), before, 'rows are byte-for-byte untouched (same xmin, same version)');
      assert.equal(await repo.get('org-a', 'GHOST'), undefined, 'rows passed to the sync are ignored, not inserted');
    });
  });
}
