import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrateNormalizedCore } from './migrations/003_normalized_core';
import { removeLegacyCoreTables } from './migrations/004_remove_legacy_core';
import { addStatusIndexes } from './migrations/005_status_indexes';
import { renameFieldsToEnglish } from './migrations/006_english_field_names';
import { resetOrganizationData } from './organizationReset';
import { ensureDocumentSchema } from './documentRoutes';
import { ensureApprovalSchema } from './approvalRoutes';
import { ENTITIES } from './normalizedSchema';
import { decimalParts, normalizedCoreReady, readBusinessRows, resetSyncCache, searchBusinessRows, synchronizeBusinessRows } from './normalizedCoreStore';
import { createCoreSaver } from './coreDataStore';
import { createSql } from './db';

function fixture(filename = ':memory:') {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE organization(id TEXT PRIMARY KEY); INSERT INTO organization VALUES ('org-a'),('org-b');");
  for (const entity of ENTITIES) db.exec(`CREATE TABLE ${entity.table}(id TEXT PRIMARY KEY, organizationId TEXT, payload TEXT)`);
  const partner = {
    partner_id: 'p1', organizationId: 'org-a', partner_name: 'Unique Orchard Services',
    pic_name: 'PIC', pic_email: 'private@example.com', pic_phone: '+62123',
    tags: ['Supplier','Supplier'], identifiers: [{ scheme:'tax', value:'123', country:'ID', custom: 'preserved' }],
    dd_documents: [{ key:'registration', name:'Company registration', required:true, expires:false, status:'Available', files:[{id:'f1',fileName:'Proof.pdf',linkDrive:'/uploads/proof.pdf',uploadedAt:'2026-01-01',fileSize:'42', custom:'file extra'}] }],
    country: 'ID', created_at:'2026-01-01T00:00:00.000Z', updated_at:'2026-01-01T00:00:00.000Z', custom_extension:{keep:true},
  };
  const contract = { contract_id:'c1', organizationId:'org-a', partner_id:'p1', parent_contract_id:'', contract_number:'CTR-2026-001', contract_title:'Orchard Contract', contract_value:1234.56, currency:'USD', auto_renewal:false, cooperation_categories:['Services'], termination_date:null };
  const io = { io_id:'i1', contract_id:'c1', partner_id:'p1', organizationId:'org-a', io_number:'IO-001', io_title:'Orchard Order', io_value:0.29, currency:'USD' };
  const spending = { id:'s1', organizationId:'org-a', vendor_id:'p1', vendor_name:'Orchard', total_amount:10.01, currency:'USD', invoice_month:['2026-01-31'], month_allocations:[{month:'2026-01',amount:10.01, custom:'allocation extra'}] };
  const rows: Record<string,any[]> = { partners:[partner,{ partner_id:'p2', organizationId:'org-b', partner_name:'Unique Orchard Secret', tags:[], identifiers:[], dd_documents:[] }],contracts:[contract],ios:[io],spendings:[spending],notifications:[{notif_id:'n1',organizationId:'org-a',parent_type:'IO',parent_id:'i1',message:'Reminder',is_read:false}],activityLogs:[],evaluations:[],templates:[] };
  for (const entity of ENTITIES) for (const row of rows[entity.collection]) db.prepare(`INSERT INTO ${entity.table}(id,organizationId,payload) VALUES(?,?,?)`).run(entity.table==='insertion_orders' ? row.contract_id : row[entity.key],row.organizationId,JSON.stringify(row));
  return { db, rows, s: createSql(db) };
}

test('migration preserves fields, child arrays, decimals and independent IO IDs; retry is idempotent', async () => {
  const {db,rows,s} = fixture();
  try {
    const result = await migrateNormalizedCore(db);
    assert.equal(result.applied,true);
    assert.equal(await normalizedCoreReady(s),true);
    for (const entity of ENTITIES) {
      assert.deepEqual(await readBusinessRows(s,entity.table), rows[entity.collection].map(row => entity.table==='partners' && row.pic_email ? {...row,pic_contact:'private@example.com / +62123'} : row));
      assert.equal((db.prepare(`PRAGMA table_info(${entity.table})`).all() as any[]).some(column => column.name==='payload'),false);
    }
    assert.deepEqual(db.prepare('SELECT io_id, contract_id FROM insertion_orders').get(),{io_id:'i1',contract_id:'c1'});
    assert.deepEqual(db.prepare('SELECT io_value_minor,io_value_scale FROM insertion_orders').get(),{io_value_minor:29,io_value_scale:2});
    assert.equal((await migrateNormalizedCore(db)).applied,false);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal((db.prepare('PRAGMA integrity_check').get() as any).integrity_check,'ok');
  } finally {db.close();}
});

test('multiple IOs per contract, stable notification IDs, updates, and ordering survive reload', async () => {
  const {db,rows,s} = fixture();
  try {
    await migrateNormalizedCore(db);
    rows.ios.unshift({...rows.ios[0],io_id:'i2',io_number:'IO-002',io_value:1.2345678901234567});
    rows.partners[0].dd_documents[0].files[0].fileName='Updated.pdf';
    await synchronizeBusinessRows(s,rows);
    await synchronizeBusinessRows(s,rows);
    assert.deepEqual((await readBusinessRows(s,'insertion_orders')).map(row=>row.io_id),['i2','i1']);
    assert.equal((await readBusinessRows(s,'insertion_orders'))[0].io_value,1.2345678901234567);
    assert.equal((await readBusinessRows(s,'partners'))[0].dd_documents[0].files[0].fileName,'Updated.pdf');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM notifications').get() as any).n,1);
  } finally {db.close();}
});

test('search follows inserts, updates and deletes, scopes organizations and excludes contact identifiers', async () => {
  const {db,rows,s} = fixture();
  try {
    await migrateNormalizedCore(db);
    assert.deepEqual((await searchBusinessRows(s,'org-a','Unique')).map(hit=>hit.entity_id),['p1']);
    assert.deepEqual((await searchBusinessRows(s,'org-b','Unique')).map(hit=>hit.entity_id),['p2']);
    assert.deepEqual(await searchBusinessRows(s,'org-a','private@example.com'),[]);
    assert.equal((await searchBusinessRows(s,'org-a','" OR * - ()')).every(hit=>hit.entity_id!=='p2'),true);
    rows.partners[0].partner_name='Renamed Supplier';
    await synchronizeBusinessRows(s,rows);
    assert.deepEqual(await searchBusinessRows(s,'org-a','Unique'),[]);
    assert.equal((await searchBusinessRows(s,'org-a','Renamed'))[0].entity_id,'p1');
    rows.partners.pop();
    await synchronizeBusinessRows(s,rows);
    assert.deepEqual(await searchBusinessRows(s,'org-b','Unique'),[]);
  } finally {db.close();}
});

test('cross-organization references and duplicate IDs roll back all business changes', async () => {
  const {db,rows,s} = fixture();
  try {
    await migrateNormalizedCore(db);
    rows.partners[0].partner_name='Must roll back';
    rows.contracts[0].partner_id='p2';
    await assert.rejects(() => synchronizeBusinessRows(s,rows),/FOREIGN KEY/);
    assert.equal((await readBusinessRows(s,'partners'))[0].partner_name,'Unique Orchard Services');
    rows.contracts[0].partner_id='p1';
    rows.ios.push({...rows.ios[0]});
    await assert.rejects(() => synchronizeBusinessRows(s,rows),/Duplicate io_id/);
    assert.equal((await readBusinessRows(s,'partners'))[0].partner_name,'Unique Orchard Services');
  } finally {db.close();}
});

test('unchanged rows are skipped, yet direct writes, deletions and failed saves never leave stale state', async () => {
  const {db,rows,s} = fixture();
  try {
    await migrateNormalizedCore(db);
    await synchronizeBusinessRows(s,rows);
    // A direct write to business tables (application reset) must drop the fingerprints so the next save rewrites rows.
    db.prepare("UPDATE partners SET partner_name = 'Edited elsewhere' WHERE partner_id = 'p1'").run();
    resetSyncCache(s);
    await synchronizeBusinessRows(s,rows);
    assert.equal((await readBusinessRows(s,'partners'))[0].partner_name,'Unique Orchard Services');
    // Rows removed from memory disappear even though every remaining row is unchanged.
    rows.ios.pop();
    await synchronizeBusinessRows(s,rows);
    assert.equal((await readBusinessRows(s,'insertion_orders')).length,0);
    // A rolled-back save forgets what it believed was written, so the retry persists the change.
    rows.partners[0].partner_name='Retry persists';
    rows.contracts[0].partner_id='p2';
    await assert.rejects(() => synchronizeBusinessRows(s,rows),/FOREIGN KEY/);
    rows.contracts[0].partner_id='p1';
    await synchronizeBusinessRows(s,rows);
    assert.equal((await readBusinessRows(s,'partners'))[0].partner_name,'Retry persists');
  } finally {db.close();}
});

test('serialized saves snapshot when their turn comes, so mutations during a write end consistent', async () => {
  const {db,rows,s} = fixture();
  try {
    await migrateNormalizedCore(db);
    db.exec('CREATE TABLE allowed_users (id TEXT PRIMARY KEY, email TEXT, name TEXT, role TEXT, status TEXT, organizationId TEXT, payload TEXT, createdAt TEXT, updatedAt TEXT)');
    let snapshots = 0;
    const saver = createCoreSaver(s, () => {
      // Another handler edits memory while the first save is still writing.
      if (++snapshots === 1) queueMicrotask(() => {
        rows.partners[0].partner_name = 'Second edit';
        rows.partners.push({ partner_id: 'p3', organizationId: 'org-a', partner_name: 'Late partner', tags: [], identifiers: [], dd_documents: [] });
      });
      return rows;
    });
    const names = async () => (await readBusinessRows(s,'partners')).map(row => `${row.partner_id}:${row.partner_name}`);
    rows.partners[0].partner_name = 'First edit';
    const first = saver.save();
    const second = saver.save();
    await first;
    assert.deepEqual(await names(), ['p1:First edit','p2:Unique Orchard Secret']);
    await second;
    assert.deepEqual(await names(), ['p1:Second edit','p2:Unique Orchard Secret','p3:Late partner']);
    // A save never runs inside a transaction (it would wait on itself), and a rolled-back save is retried in full.
    await assert.rejects(s.tx(() => saver.save()), /inside a transaction/);
    rows.partners[0].partner_name = 'Kept after rollback';
    await assert.rejects(saver.save(async () => { throw new Error('audit failed'); }), /audit failed/);
    assert.equal((await readBusinessRows(s,'partners'))[0].partner_name,'Second edit');
    await saver.save();
    assert.equal((await readBusinessRows(s,'partners'))[0].partner_name,'Kept after rollback');
  } finally {db.close();}
});

test('field-name migration renames columns, extra_json aliases, views and indexes of an existing database, once', async () => {
  const {db,s} = fixture();
  try {
    await migrateNormalizedCore(db);
    addStatusIndexes(db);
    // Turn the fresh schema back into what a database from before the rename looks like.
    const before: Record<string,Record<string,string>> = {
      partners: { partner_name:'nama_partner', partner_type:'jenis_partner', pic_name:'nama_pic', pic_email:'email_pic', pic_phone:'telepon_pic', pic_address:'alamat_pic', internal_pic:'pic_internal', dd_folder_link:'link_folder_dd', dd_verified_date:'tanggal_dd_diverifikasi', notes:'catatan' },
      contracts: { document_type:'jenis_dokumen', contract_number:'nomor_kontrak', contract_title:'judul_kontrak', start_date:'tanggal_mulai', end_date:'tanggal_berakhir', contract_value_minor:'nilai_kontrak_minor', contract_value_scale:'nilai_kontrak_scale', notice_period_days:'notice_period_hari' },
      insertion_orders: { io_number:'nomor_io', io_title:'judul_io', media_channel:'kanal_media', io_value_minor:'nilai_io_minor', io_value_scale:'nilai_io_scale' },
      notifications: { message:'pesan', recipient:'penerima', sent_at:'tanggal_terkirim' },
      partner_dd_requirements: { name:'nama', required:'wajib', document_number:'nomor_dokumen', expiry_date:'tanggal_kadaluarsa' },
    };
    for (const [table,map] of Object.entries(before)) for (const [to,from] of Object.entries(map)) db.exec(`ALTER TABLE ${table} RENAME COLUMN ${to} TO ${from}`);
    db.exec("DELETE FROM schema_migrations WHERE id = '006_english_field_names'");
    db.prepare("UPDATE partners SET extra_json = ? WHERE partner_id = 'p1'").run(JSON.stringify({ custom_extension:{ keep:true }, kontak_pic:'a / b', pic_internal:'stale alias', badan_hukum:'BHI' }));
    const stored = db.prepare('SELECT nama_partner FROM partners WHERE partner_id = ?').get('p1') as {nama_partner:string};

    const result = renameFieldsToEnglish(db);
    assert.equal(result.applied,true);
    assert.equal(result.renamed,Object.values(before).reduce((total,map)=>total+Object.keys(map).length,0));
    const columns = (table:string) => (db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(column=>column.name);
    assert.ok(columns('partners').includes('partner_name') && !columns('partners').includes('nama_partner'));
    assert.ok(columns('contracts').includes('contract_value_minor') && !columns('contracts').includes('nilai_kontrak_minor'));
    assert.ok(columns('partner_dd_requirements').includes('required') && !columns('partner_dd_requirements').includes('wajib'));
    const partner = (await readBusinessRows(s,'partners'))[0];
    assert.equal(partner.partner_name,stored.nama_partner);
    assert.equal(partner.pic_contact,'a / b');
    assert.equal(partner.legal_status_flag,'BHI');
    assert.deepEqual(partner.custom_extension,{ keep:true });
    for (const stale of ['kontak_pic','pic_internal','badan_hukum']) assert.equal(stale in partner,false,stale);
    assert.equal((await readBusinessRows(s,'contracts'))[0].contract_number,'CTR-2026-001');
    assert.equal((db.prepare('SELECT contract_number FROM v_contract_summary').get() as any).contract_number,'CTR-2026-001');
    assert.match((db.prepare("SELECT sql FROM sqlite_master WHERE name='idx_v5_contracts_status'").get() as any).sql,/end_date/);
    assert.equal(renameFieldsToEnglish(db).applied,false);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {db.close();}
});

test('organization reset empties one organization\'s business data, editor documents, approvals and own files only', async () => {
  const {db,rows,s} = fixture();
  const uploads = mkdtempSync(path.join(os.tmpdir(),'reset-uploads-'));
  const outside = path.join(path.dirname(uploads),`outside-${path.basename(uploads)}.txt`);
  try {
    await migrateNormalizedCore(db);
    await ensureDocumentSchema(s);
    await ensureApprovalSchema(s);
    writeFileSync(path.join(uploads,'proof.pdf'),'a');
    writeFileSync(path.join(uploads,'other-org.pdf'),'b');
    writeFileSync(outside,'c');
    rows.partners[1].dd_documents = [{ key:'x', name:'Doc', required:false, expires:false, status:'Available', files:[{ id:'f2', fileName:'b.pdf', linkDrive:'/uploads/other-org.pdf' }] }];
    rows.partners[0].custom_extension = { escape:`/uploads/../${path.basename(outside)}` }; // must never delete outside the uploads dir
    await synchronizeBusinessRows(s,rows);
    const insert = (sql:string,...values:unknown[]) => db.prepare(sql).run(...values);
    for (const [id,org] of [['d-a','org-a'],['d-b','org-b']]) {
      insert("INSERT INTO contract_documents(id,organization_id,name,created_by,created_at,modified_at) VALUES(?,?,?,?,?,?)",id,org,'Doc','u','2026-01-01','2026-01-01');
      insert("INSERT INTO contract_comments(id,contract_id,comment_type,author_id,created_at) VALUES(?,?,?,?,?)",`c-${id}`,id,'comment','u','2026-01-01');
      insert("INSERT INTO approval_requests(id,organization_id,code,title,category,source,file_name,created_by,created_at,due_at) VALUES(?,?,?,?,?,?,?,?,?,?)",`r-${id}`,org,'A','T','C','upload','f.pdf','u','2026-01-01','2026-02-01');
      insert("INSERT INTO approval_steps(id,request_id,step_no,approver_id) VALUES(?,?,?,?)",`s-${id}`,`r-${id}`,1,'u');
    }
    let saved = 0;
    const result = await resetOrganizationData({ db: s, memory: rows, organizationId:'org-a', uploadsDir: uploads, save: async () => { saved++; await synchronizeBusinessRows(s,rows); } });

    assert.equal(saved,1);
    assert.equal(result.removed.partners,1);
    assert.equal(result.removed.contracts,1);
    assert.equal(result.removed.contract_documents,1);
    assert.equal(result.removed.contract_comments,1);
    assert.equal(result.removed.approval_requests,1);
    assert.equal(result.removed.approval_steps,1);
    assert.deepEqual((await readBusinessRows(s,'partners')).map(row=>row.partner_id),['p2']);
    for (const table of ['contracts','insertion_orders','spendings']) assert.equal((await readBusinessRows(s,table,'org-a')).length,0,table);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM contract_documents').get() as any).n,1);
    assert.equal((db.prepare('SELECT organization_id AS o FROM approval_requests').get() as any).o,'org-b');
    assert.equal(result.files,1);
    assert.equal(existsSync(path.join(uploads,'proof.pdf')),false);
    assert.equal(existsSync(path.join(uploads,'other-org.pdf')),true);
    assert.equal(existsSync(outside),true);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { rmSync(uploads,{recursive:true,force:true}); rmSync(outside,{force:true}); db.close(); }
});

test('status index migration is idempotent and serves status filters', async () => {
  const {db,s} = fixture();
  try {
    await migrateNormalizedCore(db);
    assert.equal(addStatusIndexes(db).applied,true);
    assert.equal(addStatusIndexes(db).applied,false);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_v5_%'").all() as {name:string}[]).map(row=>row.name).sort();
    assert.deepEqual(names,['idx_v5_contracts_status','idx_v5_ios_status','idx_v5_spendings_payment']);
  } finally {db.close();}
});

test('a failed migration leaves the original schema and payload untouched', async () => {
  const {db,s} = fixture();
  try {
    db.prepare("UPDATE contracts SET payload=json_set(payload,'$.partner_id','missing')").run();
    await assert.rejects(() => migrateNormalizedCore(db),/Foreign-key validation failed/);
    assert.equal(await normalizedCoreReady(s),false);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='_legacy_003_contracts'").get() as any).n,0);
    assert.equal((db.prepare('SELECT payload FROM contracts').get() as any).payload.includes('missing'),true);
  } finally {db.close();}
});

test('decimal precision and query plans are explicit', async () => {
  assert.deepEqual(decimalParts(0.29),{minor:29n,scale:2});
  assert.deepEqual(decimalParts('1e-7'),{minor:1n,scale:7});
  assert.throws(()=>decimalParts(Infinity));
  assert.throws(()=>decimalParts('10000000000000000000'));
  const {db,s} = fixture();
  try {
    await migrateNormalizedCore(db);
    const plans = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM contracts WHERE organization_id=? AND end_date>=? ORDER BY end_date, contract_id').all('org-a','2026-01-01') as any[];
    assert.equal(plans.some(plan=>plan.detail.includes('idx_v3_contracts_expiry')),true);
  } finally {db.close();}
});

test('configuration projections stay synchronized and AI views omit contact details', async () => {
  const {db,s} = fixture();
  try {
    db.exec('CREATE TABLE organization_settings(organizationId TEXT PRIMARY KEY,payload TEXT)');
    db.prepare('INSERT INTO organization_settings VALUES(?,?)').run('org-a',JSON.stringify({profile:{legalEntity:'Example Ltd',brandName:'Example'},policy:{countryCode:'ID',industry:'technology',defaultCurrency:'IDR',expiryWarningDays:30}}));
    await migrateNormalizedCore(db);
    assert.deepEqual(db.prepare('SELECT country_code,default_currency,expiry_warning_days FROM organization_settings').get(),{country_code:'ID',default_currency:'IDR',expiry_warning_days:30});
    db.prepare("UPDATE organization_settings SET payload=json_set(payload,'$.policy.countryCode','SG')").run();
    assert.equal((db.prepare('SELECT country_code FROM organization_settings').get() as any).country_code,'SG');
    const summary=db.prepare('SELECT * FROM v_partner_summary WHERE partner_id=?').get('p1') as any;
    assert.equal(summary.contract_count,1);
    assert.equal('pic_email' in summary,false);
    assert.equal('pic_phone' in summary,false);
    assert.equal((db.prepare('SELECT partner_name FROM v_contract_summary WHERE contract_id=?').get('c1') as any).partner_name,'Unique Orchard Services');
  } finally {db.close();}
});


test('legacy cleanup backs up snapshots, preserves active schema/data and never recreates archives on retry', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'legalio-legacy-cleanup-'));
  const { db, s } = fixture(path.join(directory, 'fixture.db'));
  try {
    await migrateNormalizedCore(db);
    db.exec("CREATE TABLE account(id TEXT PRIMARY KEY, password TEXT); INSERT INTO account VALUES ('account-1','synthetic-hash'); CREATE TABLE app_settings(id TEXT PRIMARY KEY, payload TEXT); INSERT INTO app_settings VALUES ('provider','{\"enabled\":true}'); CREATE TABLE _legacy_003_unrelated(id TEXT PRIMARY KEY); INSERT INTO _legacy_003_unrelated VALUES ('keep');");
    const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB '_legacy_003_*' AND tbl_name NOT GLOB '_legacy_003_*' ORDER BY type,name").all();
    const rows = await Promise.all(ENTITIES.map(entity => readBusinessRows(s, entity.table)));
    const search = await searchBusinessRows(s, 'org-a', 'Unique');
    const backupPath = path.join(directory, 'backups', 'before-cleanup.db');
    assert.throws(() => removeLegacyCoreTables(db), /backup path is required/);
    const result = removeLegacyCoreTables(db, backupPath);
    assert.equal(result.applied, true);
    assert.equal(result.tables.length, 8);
    for (const table of result.tables) assert.equal(db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(table), undefined);
    assert.deepEqual(db.prepare("SELECT * FROM _legacy_003_unrelated").all(), [{ id: 'keep' }]);
    assert.deepEqual(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB '_legacy_003_*' AND tbl_name NOT GLOB '_legacy_003_*' ORDER BY type,name").all(), schema);
    assert.deepEqual(await Promise.all(ENTITIES.map(entity => readBusinessRows(s, entity.table))), rows);
    assert.deepEqual(await searchBusinessRows(s, 'org-a', 'Unique'), search);
    assert.deepEqual(db.prepare('SELECT * FROM account').all(), [{ id: 'account-1', password: 'synthetic-hash' }]);
    assert.deepEqual(db.prepare('SELECT * FROM app_settings').all(), [{ id: 'provider', payload: '{"enabled":true}' }]);
    assert.equal(statSync(backupPath).mode & 0o777, 0o600);
    const backup = new Database(backupPath, { readonly: true });
    try {
      assert.equal((backup.prepare('SELECT COUNT(*) AS n FROM _legacy_003_partners').get() as any).n, 2);
      assert.equal((backup.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE id='004_remove_legacy_core'").get() as any).n, 0);
      assert.equal(backup.pragma('integrity_check', { simple: true }), 'ok');
    } finally { backup.close(); }
    assert.equal((await migrateNormalizedCore(db)).applied, false);
    assert.equal(removeLegacyCoreTables(db, backupPath).applied, false);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('legacy cleanup refuses unmigrated databases and rolls back dropped tables on a late failure', async () => {
  const { db, s } = fixture();
  try {
    assert.throws(() => removeLegacyCoreTables(db), /Migration 003 must complete/);
    assert.ok(db.prepare('SELECT payload FROM partners').get());
    await migrateNormalizedCore(db);
    db.exec("CREATE TRIGGER fail_cleanup BEFORE INSERT ON schema_migrations WHEN NEW.id='004_remove_legacy_core' BEGIN SELECT RAISE(ABORT,'injected cleanup failure'); END");
    assert.throws(() => removeLegacyCoreTables(db), /injected cleanup failure/);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM _legacy_003_partners').get() as any).n, 2);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name GLOB '_legacy_003_*' AND type='table'").get() as any).n, 8);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE id='004_remove_legacy_core'").get() as any).n, 0);
    assert.equal((await readBusinessRows(s, 'partners'))[0].partner_name, 'Unique Orchard Services');
    db.exec('DROP TRIGGER fail_cleanup');
    assert.equal(removeLegacyCoreTables(db).applied, true);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally { db.close(); }
});
