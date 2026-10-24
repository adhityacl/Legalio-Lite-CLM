/**
 * A database written by the previous release (everything but contracts in the snapshot format, no version columns) is adopted by the
 * numbered migrations without loss: same rows, same order, same search entries, version 1, and the repositories can edit them.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-adoption-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false', LOG_LEVEL: 'silent' });
const { sql } = await import('./db');
const { runMigrations } = await import('./migrate');
const { MIGRATIONS } = await import('./migrations');
const { ENTITIES } = await import('./normalizedSchema');
const { readBusinessRows, searchBusinessRows } = await import('./normalizedCoreStore');
const { writeLegacySnapshot } = await import('./legacySnapshot');
const { createEntityRepository } = await import('./repositories/entityRepository');
const { createTestDatabase } = await import('./testDatabase');

/** The release before the partner/order/spending/evaluation/notification/template repositories: migrations up to this id. */
const PREVIOUS_RELEASE_LAST_MIGRATION = '0008_search_trigram';

const FIXTURE: Record<string, any[]> = {
  partners: [
    { partner_id: 'P1', organizationId: 'org-a', partner_name: 'Legacy Orchard Services', country: 'ID', internal_pic: 'Sales', pic_name: 'Budi', pic_email: 'budi@example.com', tags: ['Supplier', 'IT'], identifiers: [{ scheme: 'tax', value: '123', country: 'ID', custom: 'kept' }],
      dd_documents: [{ key: 'reg', name: 'Registration', required: true, expires: false, status: 'Available', files: [{ id: 'f1', fileName: 'proof.pdf', linkDrive: '/uploads/org-a/abc/Folder DD/proof.pdf', custom: 'file extra' }] }], custom_extension: { keep: true }, created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-02T00:00:00.000Z' },
    { partner_id: 'P2', organizationId: 'org-a', partner_name: 'Second Partner', tags: [], identifiers: [], dd_documents: [] },
    { partner_id: 'P3', organizationId: 'org-b', partner_name: 'Other Organization Partner', tags: [], identifiers: [], dd_documents: [] },
  ],
  ios: [
    { io_id: 'IO1', organizationId: 'org-a', partner_id: 'P1', io_number: 'IO-001', io_title: 'Legacy Order', io_value: 0.29, currency: 'USD', status: 'Active', custom_flag: true },
    { io_id: 'IO2', organizationId: 'org-a', partner_id: 'P2', io_number: 'IO-002', io_title: 'Second Order', io_value: 1234.5678, currency: 'IDR', status: 'Expired' },
  ],
  spendings: [
    { id: 'SP1', organizationId: 'org-a', vendor_id: 'P1', vendor_name: 'Legacy Orchard Services', invoice_number: 'INV-1', total_amount: 10.01, currency: 'USD', invoice_month: ['2026-01-31'], month_allocations: [{ month: '2026-01', amount: 10.01, custom: 'allocation extra' }] },
    { id: 'SP2', organizationId: 'org-a', vendor_id: null, vendor_name: 'Unlinked Vendor', invoice_number: 'INV-2', total_amount: 5, currency: 'USD' },
  ],
  evaluations: [
    { id: 'EVAL-2026-001', organizationId: 'org-a', partner_id: 'P1', supplier_name: 'Legacy Orchard Services', review_date: '2026-02-01', sla_score: 80, calculated_score: 91.5, final_evaluation: 'Recommended', notes: 'solid' },
  ],
  notifications: [
    { notif_id: 'N1', organizationId: 'org-a', parent_type: 'IO', parent_id: 'IO1', parent_number: 'IO-001', notification_type: 'Reminder 30d', message: 'expires soon', is_sent: true, is_read: false, message_params: { daysRemaining: 30 } },
    { notif_id: 'N2', organizationId: 'org-a', parent_type: 'IO', parent_id: 'IO2', message: 'second', is_sent: false, is_read: true },
  ],
  templates: [
    { id: 'T1', organizationId: 'org-a', name: 'NDA template', contentId: 'doc-1', version: 3, customFields: [{ key: 'party', label: 'Party' }], createdAt: '2025-03-01', updatedAt: '2025-03-02' },
  ],
};

test('rows written by the previous release are adopted by the migrations without loss and can then be edited with versions', async () => {
  const database = await createTestDatabase();
  const snapshotEntities = ENTITIES.filter((entity) => !entity.appendOnly && entity.table !== 'contracts');
  try {
    await runMigrations({ migrations: MIGRATIONS.slice(0, MIGRATIONS.findIndex((m) => m.id === PREVIOUS_RELEASE_LAST_MIGRATION) + 1) });
    await sql.exec(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('org-a', 'A', 'a', now()), ('org-b', 'B', 'b', now())`);
    // The previous release wrote these entities through the full-snapshot sync (before they had a version column).
    await writeLegacySnapshot(sql, FIXTURE);
    const beforeRows: Record<string, any[]> = {};
    for (const entity of snapshotEntities) beforeRows[entity.table] = await readBusinessRows(sql, entity.table);
    const beforeSearch = (await searchBusinessRows(sql, 'org-a', 'Orchard')).map((hit) => hit.entity_id);
    assert.ok(beforeSearch.includes('P1'));

    const report = await runMigrations();
    assert.ok(report.applied.length > 0);

    assert.deepEqual((await searchBusinessRows(sql, 'org-a', 'Orchard')).map((hit) => hit.entity_id).sort(), beforeSearch.sort(), 'the search index written by the old sync still serves the new queries');
    for (const entity of snapshotEntities) {
      const adopted = await readBusinessRows(sql, entity.table);
      const expected = beforeRows[entity.table];
      assert.ok(expected.length > 0, `fixture covers ${entity.table}`);
      // Migrated tables gained a `version` of 1; nothing else changes (order included).
      assert.deepEqual(adopted.map(({ version, ...row }) => row), expected.map(({ version: _v, ...row }) => row), `${entity.table} rows unchanged`);
      assert.ok(await sql.get(`SELECT 1 AS present FROM information_schema.columns WHERE table_name = ? AND column_name = 'version'`, entity.table), `${entity.table} has a version column`);
      // Templates already counted their own saves in `version`; every other table starts at 1.
      const expectedVersion = (row: any) => (entity.table === 'templates' ? Number(FIXTURE.templates.find((t) => t.id === row.id)!.version) : 1);
      assert.ok(adopted.every((row) => row.version === expectedVersion(row)), `${entity.table} rows keep or start at their version`);
      const first = adopted[0];
      const edited = await createEntityRepository(sql, entity.table).update(
        { ...first, ...(entity.search[0] ? { [entity.search[0]]: 'Edited after adoption' } : { message: 'Edited after adoption' }) }, first.version);
      assert.equal(edited.version, first.version + 1, `${entity.table} can be edited after adoption`);
    }
  } finally {
    await database.drop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
