import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrateNormalizedCore } from './migrations/003_normalized_core';
import { removeLegacyCoreTables } from './migrations/004_remove_legacy_core';
import { ENTITIES } from './normalizedSchema';
import { decimalParts, normalizedCoreReady, readBusinessRows, searchBusinessRows, synchronizeBusinessRows } from './normalizedCoreStore';

function fixture(filename = ':memory:') {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE organization(id TEXT PRIMARY KEY); INSERT INTO organization VALUES ('org-a'),('org-b');");
  for (const entity of ENTITIES) db.exec(`CREATE TABLE ${entity.table}(id TEXT PRIMARY KEY, organizationId TEXT, payload TEXT)`);
  const partner = {
    partner_id: 'p1', organizationId: 'org-a', nama_partner: 'Unique Orchard Services',
    nama_pic: 'PIC', email_pic: 'private@example.com', telepon_pic: '+62123',
    tags: ['Supplier','Supplier'], identifiers: [{ scheme:'tax', value:'123', country:'ID', custom: 'preserved' }],
    daftar_dokumen_dd: [{ key:'registration', nama:'Company registration', wajib:true, expires:false, status:'Available', files:[{id:'f1',fileName:'Proof.pdf',linkDrive:'/uploads/proof.pdf',uploadedAt:'2026-01-01',fileSize:'42', custom:'file extra'}] }],
    country: 'ID', created_at:'2026-01-01T00:00:00.000Z', updated_at:'2026-01-01T00:00:00.000Z', custom_extension:{keep:true},
  };
  const contract = { contract_id:'c1', organizationId:'org-a', partner_id:'p1', parent_contract_id:'', nomor_kontrak:'CTR-2026-001', judul_kontrak:'Orchard Contract', nilai_kontrak:1234.56, currency:'USD', auto_renewal:false, kategori_kerjasama:['Services'], termination_date:null };
  const io = { io_id:'i1', contract_id:'c1', partner_id:'p1', organizationId:'org-a', nomor_io:'IO-001', judul_io:'Orchard Order', nilai_io:0.29, currency:'USD' };
  const spending = { id:'s1', organizationId:'org-a', vendor_id:'p1', vendor_name:'Orchard', total_amount:10.01, currency:'USD', invoice_month:['2026-01-31'], month_allocations:[{month:'2026-01',amount:10.01, custom:'allocation extra'}] };
  const rows: Record<string,any[]> = { partners:[partner,{ partner_id:'p2', organizationId:'org-b', nama_partner:'Unique Orchard Secret', tags:[], identifiers:[], daftar_dokumen_dd:[] }],contracts:[contract],ios:[io],spendings:[spending],notifications:[{notif_id:'n1',organizationId:'org-a',parent_type:'IO',parent_id:'i1',pesan:'Reminder',is_read:false}],activityLogs:[],evaluations:[],templates:[] };
  for (const entity of ENTITIES) for (const row of rows[entity.collection]) db.prepare(`INSERT INTO ${entity.table}(id,organizationId,payload) VALUES(?,?,?)`).run(entity.table==='insertion_orders' ? row.contract_id : row[entity.key],row.organizationId,JSON.stringify(row));
  return { db, rows };
}

test('migration preserves fields, child arrays, decimals and independent IO IDs; retry is idempotent', () => {
  const {db,rows} = fixture();
  try {
    const result = migrateNormalizedCore(db);
    assert.equal(result.applied,true);
    assert.equal(normalizedCoreReady(db),true);
    for (const entity of ENTITIES) {
      assert.deepEqual(readBusinessRows(db,entity.table), rows[entity.collection].map(row => entity.table==='partners' && row.email_pic ? {...row,kontak_pic:'private@example.com / +62123'} : row));
      assert.equal((db.prepare(`PRAGMA table_info(${entity.table})`).all() as any[]).some(column => column.name==='payload'),false);
    }
    assert.deepEqual(db.prepare('SELECT io_id, contract_id FROM insertion_orders').get(),{io_id:'i1',contract_id:'c1'});
    assert.deepEqual(db.prepare('SELECT nilai_io_minor,nilai_io_scale FROM insertion_orders').get(),{nilai_io_minor:29,nilai_io_scale:2});
    assert.equal(migrateNormalizedCore(db).applied,false);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal((db.prepare('PRAGMA integrity_check').get() as any).integrity_check,'ok');
  } finally {db.close();}
});

test('multiple IOs per contract, stable notification IDs, updates, and ordering survive reload', () => {
  const {db,rows} = fixture();
  try {
    migrateNormalizedCore(db);
    rows.ios.unshift({...rows.ios[0],io_id:'i2',nomor_io:'IO-002',nilai_io:1.2345678901234567});
    rows.partners[0].daftar_dokumen_dd[0].files[0].fileName='Updated.pdf';
    synchronizeBusinessRows(db,rows);
    synchronizeBusinessRows(db,rows);
    assert.deepEqual(readBusinessRows(db,'insertion_orders').map(row=>row.io_id),['i2','i1']);
    assert.equal(readBusinessRows(db,'insertion_orders')[0].nilai_io,1.2345678901234567);
    assert.equal(readBusinessRows(db,'partners')[0].daftar_dokumen_dd[0].files[0].fileName,'Updated.pdf');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM notifications').get() as any).n,1);
  } finally {db.close();}
});

test('search follows inserts, updates and deletes, scopes organizations and excludes contact identifiers', () => {
  const {db,rows} = fixture();
  try {
    migrateNormalizedCore(db);
    assert.deepEqual(searchBusinessRows(db,'org-a','Unique').map(hit=>hit.entity_id),['p1']);
    assert.deepEqual(searchBusinessRows(db,'org-b','Unique').map(hit=>hit.entity_id),['p2']);
    assert.deepEqual(searchBusinessRows(db,'org-a','private@example.com'),[]);
    assert.equal(searchBusinessRows(db,'org-a','" OR * - ()').every(hit=>hit.entity_id!=='p2'),true);
    rows.partners[0].nama_partner='Renamed Supplier';
    synchronizeBusinessRows(db,rows);
    assert.deepEqual(searchBusinessRows(db,'org-a','Unique'),[]);
    assert.equal(searchBusinessRows(db,'org-a','Renamed')[0].entity_id,'p1');
    rows.partners.pop();
    synchronizeBusinessRows(db,rows);
    assert.deepEqual(searchBusinessRows(db,'org-b','Unique'),[]);
  } finally {db.close();}
});

test('cross-organization references and duplicate IDs roll back all business changes', () => {
  const {db,rows} = fixture();
  try {
    migrateNormalizedCore(db);
    rows.partners[0].nama_partner='Must roll back';
    rows.contracts[0].partner_id='p2';
    assert.throws(()=>synchronizeBusinessRows(db,rows),/FOREIGN KEY/);
    assert.equal(readBusinessRows(db,'partners')[0].nama_partner,'Unique Orchard Services');
    rows.contracts[0].partner_id='p1';
    rows.ios.push({...rows.ios[0]});
    assert.throws(()=>synchronizeBusinessRows(db,rows),/Duplicate io_id/);
    assert.equal(readBusinessRows(db,'partners')[0].nama_partner,'Unique Orchard Services');
  } finally {db.close();}
});

test('a failed migration leaves the original schema and payload untouched', () => {
  const {db} = fixture();
  try {
    db.prepare("UPDATE contracts SET payload=json_set(payload,'$.partner_id','missing')").run();
    assert.throws(()=>migrateNormalizedCore(db),/Foreign-key validation failed/);
    assert.equal(normalizedCoreReady(db),false);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='_legacy_003_contracts'").get() as any).n,0);
    assert.equal((db.prepare('SELECT payload FROM contracts').get() as any).payload.includes('missing'),true);
  } finally {db.close();}
});

test('decimal precision and query plans are explicit', () => {
  assert.deepEqual(decimalParts(0.29),{minor:29n,scale:2});
  assert.deepEqual(decimalParts('1e-7'),{minor:1n,scale:7});
  assert.throws(()=>decimalParts(Infinity));
  assert.throws(()=>decimalParts('10000000000000000000'));
  const {db}=fixture();
  try {
    migrateNormalizedCore(db);
    const plans = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM contracts WHERE organization_id=? AND tanggal_berakhir>=? ORDER BY tanggal_berakhir, contract_id').all('org-a','2026-01-01') as any[];
    assert.equal(plans.some(plan=>plan.detail.includes('idx_v3_contracts_expiry')),true);
  } finally {db.close();}
});

test('configuration projections stay synchronized and AI views omit contact details', () => {
  const {db}=fixture();
  try {
    db.exec('CREATE TABLE organization_settings(organizationId TEXT PRIMARY KEY,payload TEXT)');
    db.prepare('INSERT INTO organization_settings VALUES(?,?)').run('org-a',JSON.stringify({profile:{legalEntity:'Example Ltd',brandName:'Example'},policy:{countryCode:'ID',industry:'technology',defaultCurrency:'IDR',expiryWarningDays:30}}));
    migrateNormalizedCore(db);
    assert.deepEqual(db.prepare('SELECT country_code,default_currency,expiry_warning_days FROM organization_settings').get(),{country_code:'ID',default_currency:'IDR',expiry_warning_days:30});
    db.prepare("UPDATE organization_settings SET payload=json_set(payload,'$.policy.countryCode','SG')").run();
    assert.equal((db.prepare('SELECT country_code FROM organization_settings').get() as any).country_code,'SG');
    const summary=db.prepare('SELECT * FROM v_partner_summary WHERE partner_id=?').get('p1') as any;
    assert.equal(summary.contract_count,1);
    assert.equal('email_pic' in summary,false);
    assert.equal('telepon_pic' in summary,false);
    assert.equal((db.prepare('SELECT nama_partner FROM v_contract_summary WHERE contract_id=?').get('c1') as any).nama_partner,'Unique Orchard Services');
  } finally {db.close();}
});


test('legacy cleanup backs up snapshots, preserves active schema/data and never recreates archives on retry', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'legalio-legacy-cleanup-'));
  const { db } = fixture(path.join(directory, 'fixture.db'));
  try {
    migrateNormalizedCore(db);
    db.exec("CREATE TABLE account(id TEXT PRIMARY KEY, password TEXT); INSERT INTO account VALUES ('account-1','synthetic-hash'); CREATE TABLE app_settings(id TEXT PRIMARY KEY, payload TEXT); INSERT INTO app_settings VALUES ('provider','{\"enabled\":true}'); CREATE TABLE _legacy_003_unrelated(id TEXT PRIMARY KEY); INSERT INTO _legacy_003_unrelated VALUES ('keep');");
    const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB '_legacy_003_*' AND tbl_name NOT GLOB '_legacy_003_*' ORDER BY type,name").all();
    const rows = ENTITIES.map(entity => readBusinessRows(db, entity.table));
    const search = searchBusinessRows(db, 'org-a', 'Unique');
    const backupPath = path.join(directory, 'backups', 'before-cleanup.db');
    assert.throws(() => removeLegacyCoreTables(db), /backup path is required/);
    const result = removeLegacyCoreTables(db, backupPath);
    assert.equal(result.applied, true);
    assert.equal(result.tables.length, 8);
    for (const table of result.tables) assert.equal(db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(table), undefined);
    assert.deepEqual(db.prepare("SELECT * FROM _legacy_003_unrelated").all(), [{ id: 'keep' }]);
    assert.deepEqual(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB '_legacy_003_*' AND tbl_name NOT GLOB '_legacy_003_*' ORDER BY type,name").all(), schema);
    assert.deepEqual(ENTITIES.map(entity => readBusinessRows(db, entity.table)), rows);
    assert.deepEqual(searchBusinessRows(db, 'org-a', 'Unique'), search);
    assert.deepEqual(db.prepare('SELECT * FROM account').all(), [{ id: 'account-1', password: 'synthetic-hash' }]);
    assert.deepEqual(db.prepare('SELECT * FROM app_settings').all(), [{ id: 'provider', payload: '{"enabled":true}' }]);
    assert.equal(statSync(backupPath).mode & 0o777, 0o600);
    const backup = new Database(backupPath, { readonly: true });
    try {
      assert.equal((backup.prepare('SELECT COUNT(*) AS n FROM _legacy_003_partners').get() as any).n, 2);
      assert.equal((backup.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE id='004_remove_legacy_core'").get() as any).n, 0);
      assert.equal(backup.pragma('integrity_check', { simple: true }), 'ok');
    } finally { backup.close(); }
    assert.equal(migrateNormalizedCore(db).applied, false);
    assert.equal(removeLegacyCoreTables(db, backupPath).applied, false);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('legacy cleanup refuses unmigrated databases and rolls back dropped tables on a late failure', () => {
  const { db } = fixture();
  try {
    assert.throws(() => removeLegacyCoreTables(db), /Migration 003 must complete/);
    assert.ok(db.prepare('SELECT payload FROM partners').get());
    migrateNormalizedCore(db);
    db.exec("CREATE TRIGGER fail_cleanup BEFORE INSERT ON schema_migrations WHEN NEW.id='004_remove_legacy_core' BEGIN SELECT RAISE(ABORT,'injected cleanup failure'); END");
    assert.throws(() => removeLegacyCoreTables(db), /injected cleanup failure/);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM _legacy_003_partners').get() as any).n, 2);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name GLOB '_legacy_003_*' AND type='table'").get() as any).n, 8);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE id='004_remove_legacy_core'").get() as any).n, 0);
    assert.equal(readBusinessRows(db, 'partners')[0].nama_partner, 'Unique Orchard Services');
    db.exec('DROP TRIGGER fail_cleanup');
    assert.equal(removeLegacyCoreTables(db).applied, true);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally { db.close(); }
});
