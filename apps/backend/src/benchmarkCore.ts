/**
 * Core data benchmark: `node --import tsx apps/backend/src/benchmarkCore.ts [partners=2000]`.
 * Seeds a throwaway SQLite file, then times the paths that run on every request or save.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrateNormalizedCore } from './migrations/003_normalized_core';
import { addStatusIndexes } from './migrations/005_status_indexes';
import { ENTITIES } from './normalizedSchema';
import { readBusinessRows, synchronizeBusinessRows } from './normalizedCoreStore';

const partnerCount = Number(process.argv[2] || 2000);
const dir = mkdtempSync(path.join(os.tmpdir(), 'legalio-bench-'));
const db = new Database(path.join(dir, 'bench.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec("CREATE TABLE organization(id TEXT PRIMARY KEY); INSERT INTO organization VALUES ('org-a'),('org-b');");
for (const entity of ENTITIES) db.exec(`CREATE TABLE ${entity.table}(id TEXT PRIMARY KEY, organizationId TEXT, payload TEXT)`);
migrateNormalizedCore(db);
addStatusIndexes(db);

const data: Record<string, any[]> = Object.fromEntries(ENTITIES.map(e => [e.collection, []]));
for (let p = 0; p < partnerCount; p++) {
  const org = p % 2 ? 'org-a' : 'org-b';
  data.partners.push({
    partner_id: `p${p}`, organizationId: org, partner_name: `Partner ${p}`, tags: ['Supplier', 'Media'],
    identifiers: [{ scheme: 'tax', value: String(p), country: 'ID' }],
    dd_documents: [0, 1, 2].map(k => ({ key: `d${k}`, name: `Doc ${k}`, required: true, expires: false, status: 'Available', files: [{ id: `f${p}-${k}`, fileName: 'a.pdf', linkDrive: '/uploads/a.pdf' }] })),
  });
  for (let c = 0; c < 5; c++) {
    data.contracts.push({ contract_id: `c${p}-${c}`, organizationId: org, partner_id: `p${p}`, contract_number: `CTR-${p}-${c}`, contract_title: `Contract ${p}-${c}`, contract_value: 1000 + c, currency: 'IDR', status: 'Active', end_date: '2027-01-01', cooperation_categories: ['A'] });
  }
  for (let i = 0; i < 2; i++) {
    data.ios.push({ io_id: `i${p}-${i}`, organizationId: org, partner_id: `p${p}`, contract_id: `c${p}-0`, io_number: `IO-${p}-${i}`, io_title: `IO ${p}-${i}`, io_value: 10, currency: 'IDR' });
  }
}

const time = (label: string, fn: () => void) => {
  const start = performance.now();
  fn();
  console.log(`${label.padEnd(42)} ${(performance.now() - start).toFixed(1).padStart(9)} ms`);
};

console.log(`partners=${data.partners.length} contracts=${data.contracts.length} ios=${data.ios.length}`);
time('initial full sync', () => synchronizeBusinessRows(db, data));
time('save with no changes (every saveDb)', () => synchronizeBusinessRows(db, data));
data.contracts[0].contract_title = 'Changed';
time('save with 1 changed contract', () => synchronizeBusinessRows(db, data));
time('read partners (one org)', () => readBusinessRows(db, 'partners', 'org-a'));
time('read contracts (one org)', () => readBusinessRows(db, 'contracts', 'org-a'));
time('read ios (one org)', () => readBusinessRows(db, 'insertion_orders', 'org-a'));
for (const [label, sql] of [
  ['contracts by status', "SELECT contract_id FROM contracts WHERE organization_id='org-a' AND status='Active'"],
  ['contracts expiring soonest', "SELECT contract_id FROM contracts WHERE organization_id='org-a' ORDER BY end_date LIMIT 5"],
  ['ios by status', "SELECT io_id FROM insertion_orders WHERE organization_id='org-a' AND status='Active'"],
  ['spendings by payment_status', "SELECT id FROM spendings WHERE organization_id='org-a' AND payment_status='Paid'"],
]) {
  const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map(r => r.detail).join(' | ');
  console.log(`plan ${label.padEnd(30)} ${plan}`);
}
db.close();
rmSync(dir, { recursive: true, force: true });
