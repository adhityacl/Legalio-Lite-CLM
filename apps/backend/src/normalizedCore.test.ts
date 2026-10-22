import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resetOrganizationData } from './organizationReset';
import { memoryStore } from './objectStore';
import { ENTITIES } from './normalizedSchema';
import { decimalParts, readBusinessRows, resetSyncCache, searchBusinessRows, synchronizeBusinessRows } from './normalizedCoreStore';
import { createCoreSaver } from './coreDataStore';
import { sql as s } from './db';
import { ensureSchema } from './schema';
import { createTestDatabase } from './testDatabase';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(() => database?.drop());

/** Two organizations and one stored record of every business collection; each test starts from it. */
async function fixture() {
  await s.exec(`TRUNCATE organization, search_records, contract_documents, contract_comments, approval_requests, approval_steps CASCADE`);
  await s.exec(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('org-a', 'A', 'a', now()), ('org-b', 'B', 'b', now())`);
  resetSyncCache(s);
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
  await synchronizeBusinessRows(s, rows);
  return { rows };
}

test('stored rows read back with every field, child array, decimal and independent IO ID', async () => {
  const {rows} = await fixture();
  for (const entity of ENTITIES) {
    assert.deepEqual(await readBusinessRows(s,entity.table), rows[entity.collection].map(row => entity.table==='partners' && row.pic_email ? {...row,pic_contact:'private@example.com / +62123'} : row));
  }
  assert.deepEqual(await s.get('SELECT io_id, contract_id FROM insertion_orders'),{io_id:'i1',contract_id:'c1'});
  assert.deepEqual(await s.get('SELECT io_value_minor,io_value_scale FROM insertion_orders'),{io_value_minor:29,io_value_scale:2});
});

test('multiple IOs per contract, stable notification IDs, updates, and ordering survive reload', async () => {
  const {rows} = await fixture();
  {
    rows.ios.unshift({...rows.ios[0],io_id:'i2',io_number:'IO-002',io_value:1.2345678901234567});
    rows.partners[0].dd_documents[0].files[0].fileName='Updated.pdf';
    await synchronizeBusinessRows(s,rows);
    await synchronizeBusinessRows(s,rows);
    assert.deepEqual((await readBusinessRows(s,'insertion_orders')).map(row=>row.io_id),['i2','i1']);
    assert.equal((await readBusinessRows(s,'insertion_orders'))[0].io_value,1.2345678901234567);
    assert.equal((await readBusinessRows(s,'partners'))[0].dd_documents[0].files[0].fileName,'Updated.pdf');
    assert.equal((await s.get('SELECT COUNT(*) AS n FROM notifications')).n,1);
  }
});

test('search follows inserts, updates and deletes, scopes organizations and excludes contact identifiers', async () => {
  const {rows} = await fixture();
  {
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
  }
});

test('cross-organization references and duplicate IDs roll back all business changes', async () => {
  const {rows} = await fixture();
  {
    rows.partners[0].partner_name='Must roll back';
    rows.contracts[0].partner_id='p2';
    await assert.rejects(() => synchronizeBusinessRows(s,rows),/foreign key/);
    assert.equal((await readBusinessRows(s,'partners'))[0].partner_name,'Unique Orchard Services');
    rows.contracts[0].partner_id='p1';
    rows.ios.push({...rows.ios[0]});
    await assert.rejects(() => synchronizeBusinessRows(s,rows),/Duplicate io_id/);
    assert.equal((await readBusinessRows(s,'partners'))[0].partner_name,'Unique Orchard Services');
  }
});

test('unchanged rows are skipped, yet direct writes, deletions and failed saves never leave stale state', async () => {
  const {rows} = await fixture();
  {
    await synchronizeBusinessRows(s,rows);
    // A direct write to business tables (application reset) must drop the fingerprints so the next save rewrites rows.
    await s.run("UPDATE partners SET partner_name = 'Edited elsewhere' WHERE partner_id = 'p1'");
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
    await assert.rejects(() => synchronizeBusinessRows(s,rows),/foreign key/);
    rows.contracts[0].partner_id='p1';
    await synchronizeBusinessRows(s,rows);
    assert.equal((await readBusinessRows(s,'partners'))[0].partner_name,'Retry persists');
  }
});

test('serialized saves snapshot when their turn comes, so mutations during a write end consistent', async () => {
  const {rows} = await fixture();
  {
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
  }
});

test('a failed save reloads memory inside the lock, so the queued save neither replays the bad state nor loses its own write', async () => {
  const {rows} = await fixture();
  {
    await s.exec('CREATE TABLE IF NOT EXISTS audit (note text); TRUNCATE audit');
    const persisted = structuredClone(rows);
    let memory: Record<string, any> = rows;
    const saver = createCoreSaver(s, () => memory, async () => { memory = structuredClone(persisted); });
    memory.ios.push({...memory.ios[0]});
    const failed = saver.save();
    const queued = saver.save(() => s.run(`INSERT INTO audit VALUES ('queued')`));
    await assert.rejects(failed, /Duplicate io_id/);
    await queued;
    assert.equal(memory.ios.length, 1);
    assert.equal((await readBusinessRows(s,'insertion_orders')).length, 1);
    assert.deepEqual(await s.all('SELECT note FROM audit'), [{ note: 'queued' }]);
  }
});

test('organization reset empties one organization\'s business data, editor documents, approvals and own files only', async () => {
  const {rows} = await fixture();
  const storage = memoryStore();
  {
    for (const key of ['proof.pdf','other-org.pdf','../outside.txt']) await storage.put(key,Buffer.from(key));
    rows.partners[1].dd_documents = [{ key:'x', name:'Doc', required:false, expires:false, status:'Available', files:[{ id:'f2', fileName:'b.pdf', linkDrive:'/uploads/other-org.pdf' }] }];
    rows.partners[0].custom_extension = { escape:'/uploads/../outside.txt' }; // must never reach a key outside the uploads
    await synchronizeBusinessRows(s,rows);
    const insert = (text:string,...values:unknown[]) => s.run(text,...values);
    for (const [id,org] of [['d-a','org-a'],['d-b','org-b']]) {
      await insert("INSERT INTO contract_documents(id,organization_id,name,created_by,created_at,modified_at) VALUES(?,?,?,?,?,?)",id,org,'Doc','u','2026-01-01','2026-01-01');
      await insert("INSERT INTO contract_comments(id,contract_id,comment_type,author_id,created_at) VALUES(?,?,?,?,?)",`c-${id}`,id,'comment','u','2026-01-01');
      await insert("INSERT INTO approval_requests(id,organization_id,code,title,category,source,file_name,created_by,created_at,due_at) VALUES(?,?,?,?,?,?,?,?,?,?)",`r-${id}`,org,'A','T','C','upload','f.pdf','u','2026-01-01','2026-02-01');
      await insert("INSERT INTO approval_steps(id,request_id,step_no,approver_id) VALUES(?,?,?,?)",`s-${id}`,`r-${id}`,1,'u');
    }
    let saved = 0;
    const result = await resetOrganizationData({ db: s, memory: rows, organizationId:'org-a', storage, save: async () => { saved++; await synchronizeBusinessRows(s,rows); } });

    assert.equal(saved,1);
    assert.equal(result.removed.partners,1);
    assert.equal(result.removed.contracts,1);
    assert.equal(result.removed.contract_documents,1);
    assert.equal(result.removed.contract_comments,1);
    assert.equal(result.removed.approval_requests,1);
    assert.equal(result.removed.approval_steps,1);
    assert.deepEqual((await readBusinessRows(s,'partners')).map(row=>row.partner_id),['p2']);
    for (const table of ['contracts','insertion_orders','spendings']) assert.equal((await readBusinessRows(s,table,'org-a')).length,0,table);
    assert.equal((await s.get('SELECT COUNT(*) AS n FROM contract_documents')).n,1);
    assert.equal((await s.get('SELECT organization_id AS o FROM approval_requests')).o,'org-b');
    assert.equal(result.files,1);
    assert.deepEqual((await storage.list('')).map(o=>o.key).sort(),['../outside.txt','other-org.pdf']);
  }
});

test('decimal precision is explicit', () => {
  assert.deepEqual(decimalParts(0.29),{minor:29n,scale:2});
  assert.deepEqual(decimalParts('1e-7'),{minor:1n,scale:7});
  assert.throws(()=>decimalParts(Infinity));
  assert.throws(()=>decimalParts('10000000000000000000'));
});
