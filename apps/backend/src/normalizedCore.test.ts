import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resetOrganizationData } from './organizationReset';
import { memoryStore } from './objectStore';
import { ENTITIES } from './normalizedSchema';
import { decimalParts, readBusinessRows, searchBusinessRows } from './normalizedCoreStore';
import { createCoreSaver } from './coreDataStore';
import { sql as s } from './db';
import { contractRepository } from './repositories/contractRepository';
import { partnerRepository } from './repositories/partnerRepository';
import { ioRepository } from './repositories/ioRepository';
import { spendingRepository } from './repositories/spendingRepository';
import { templateRepository } from './repositories/templateRepository';
import { insertRepositoryRows } from './repositories/seed';
import { ensureSchema } from './schema';
import { createTestDatabase } from './testDatabase';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(() => database?.drop());

/** Two organizations and one stored record of every business collection; each test starts from it. */
async function fixture() {
  await s.exec(`TRUNCATE organization, search_records, contract_documents, contract_comments, approval_requests, approval_steps CASCADE`);
  await s.exec(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('org-a', 'A', 'a', now()), ('org-b', 'B', 'b', now())`);
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
  const rows: Record<string,any[]> = {
    partners:[partner,{ partner_id:'p2', organizationId:'org-b', partner_name:'Unique Orchard Secret', tags:[], identifiers:[], dd_documents:[] }],
    contracts:[contract], ios:[io], spendings:[spending],
    notifications:[{notif_id:'n1',organizationId:'org-a',parent_type:'IO',parent_id:'i1',message:'Reminder',is_read:false},{notif_id:'n2',organizationId:'org-a',parent_type:'IO',parent_id:'i1',message:'Second',is_read:false}],
    evaluations:[{ id:'e1', organizationId:'org-a', partner_id:'p1', supplier_name:'Orchard', review_date:'2026-01-01', sla_score:80 }],
    templates:[{ id:'t1', organizationId:'org-a', name:'Orchard template', contentId:'doc-1', customFields:[{ key:'party' }], version:2, createdAt:'2026-01-01', updatedAt:'2026-01-02' }],
  };
  // Every business entity is repository-backed: one transaction, foreign keys are checked at commit.
  await s.tx(() => insertRepositoryRows(s, rows));
  return { rows };
}

test('stored rows read back with every field, child array, decimal and independent IO ID', async () => {
  const {rows} = await fixture();
  for (const entity of ENTITIES.filter(entity => !entity.appendOnly)) {
    const expected = rows[entity.collection].map(row => entity.table==='templates' ? row : {...row,version:1,...(entity.table==='partners' && row.pic_email ? {pic_contact:'private@example.com / +62123'} : {})});
    assert.deepEqual(await readBusinessRows(s,entity.table), expected, entity.table);
  }
  assert.deepEqual(await s.get('SELECT io_id, contract_id FROM insertion_orders'),{io_id:'i1',contract_id:'c1'});
  assert.deepEqual(await s.get('SELECT io_value_minor,io_value_scale FROM insertion_orders'),{io_value_minor:29,io_value_scale:2});
});

test('multiple IOs per contract, stable notification IDs, updates, and ordering survive reload', async () => {
  const {rows} = await fixture();
  await ioRepository.insert({...rows.ios[0],io_id:'i2',io_number:'IO-002',io_value:1.2345678901234567});
  rows.partners[0].dd_documents[0].files[0].fileName='Updated.pdf';
  await partnerRepository.update(rows.partners[0],1);
  assert.deepEqual((await readBusinessRows(s,'insertion_orders')).map(row=>row.io_id),['i2','i1']);
  assert.equal((await readBusinessRows(s,'insertion_orders'))[0].io_value,1.2345678901234567);
  assert.equal((await readBusinessRows(s,'partners'))[0].dd_documents[0].files[0].fileName,'Updated.pdf');
  assert.equal((await s.get('SELECT COUNT(*) AS n FROM notifications')).n,2);
});

test('search follows inserts, updates and deletes, scopes organizations and excludes contact identifiers', async () => {
  const {rows} = await fixture();
  assert.deepEqual((await searchBusinessRows(s,'org-a','Unique')).map(hit=>hit.entity_id),['p1']);
  assert.deepEqual((await searchBusinessRows(s,'org-b','Unique')).map(hit=>hit.entity_id),['p2']);
  assert.deepEqual(await searchBusinessRows(s,'org-a','private@example.com'),[]);
  assert.equal((await searchBusinessRows(s,'org-a','" OR * - ()')).every(hit=>hit.entity_id!=='p2'),true);
  rows.partners[0].partner_name='Renamed Supplier';
  await partnerRepository.update(rows.partners[0],1);
  assert.deepEqual(await searchBusinessRows(s,'org-a','Unique'),[]);
  assert.equal((await searchBusinessRows(s,'org-a','Renamed'))[0].entity_id,'p1');
  await partnerRepository.remove('org-b','p2');
  assert.deepEqual(await searchBusinessRows(s,'org-b','Unique'),[]);
  assert.deepEqual((await searchBusinessRows(s,'org-a','Orchard template')).map(hit=>hit.entity_type),['templates']);
});

test('cross-organization references and duplicate IDs roll back all business changes', async () => {
  const {rows} = await fixture();
  // A change that breaks a foreign key (a contract pointing at another organization's partner) takes the rest of its transaction with it.
  await assert.rejects(() => s.tx(async () => {
    await partnerRepository.update({...rows.partners[0],partner_name:'Must roll back'},1);
    await contractRepository.update({...rows.contracts[0],partner_id:'p2'},1);
  }),/foreign key/);
  assert.equal((await readBusinessRows(s,'partners'))[0].partner_name,'Unique Orchard Services');
  // The same primary key twice is a duplicate-value conflict (409), and leaves what was there.
  await assert.rejects(() => s.tx(async () => {
    await partnerRepository.update({...rows.partners[0],partner_name:'Must roll back too'},1);
    await ioRepository.insert({...rows.ios[0],io_number:'IO-DUP'});
  }),/already exists/);
  assert.equal((await readBusinessRows(s,'partners'))[0].partner_name,'Unique Orchard Services');
  assert.equal((await readBusinessRows(s,'insertion_orders')).length,1);
});

test('organization reset empties one organization\'s business data, editor documents, approvals and own files only', async () => {
  const {rows} = await fixture();
  const storage = memoryStore();
  for (const key of ['proof.pdf','other-org.pdf','../outside.txt']) await storage.put(key,Buffer.from(key));
  rows.partners[1].dd_documents = [{ key:'x', name:'Doc', required:false, expires:false, status:'Available', files:[{ id:'f2', fileName:'b.pdf', linkDrive:'/uploads/other-org.pdf' }] }];
  rows.partners[0].custom_extension = { escape:'/uploads/../outside.txt' }; // must never reach a key outside the uploads
  await partnerRepository.update(rows.partners[1],1);
  await partnerRepository.update(rows.partners[0],1);
  await templateRepository.insert({ id:'t2', organizationId:'org-b', name:'Other organization template', contentId:'doc-2' });
  const insert = (text:string,...values:unknown[]) => s.run(text,...values);
  for (const [id,org] of [['d-a','org-a'],['d-b','org-b']]) {
    await insert("INSERT INTO contract_documents(id,organization_id,name,created_by,created_at,modified_at) VALUES(?,?,?,?,?,?)",id,org,'Doc','u','2026-01-01','2026-01-01');
    await insert("INSERT INTO contract_comments(id,contract_id,comment_type,author_id,created_at) VALUES(?,?,?,?,?)",`c-${id}`,id,'comment','u','2026-01-01');
    await insert("INSERT INTO approval_requests(id,organization_id,code,title,category,source,file_name,created_by,created_at,due_at) VALUES(?,?,?,?,?,?,?,?,?,?)",`r-${id}`,org,'A','T','C','upload','f.pdf','u','2026-01-01','2026-02-01');
    await insert("INSERT INTO approval_steps(id,request_id,step_no,approver_id) VALUES(?,?,?,?)",`s-${id}`,`r-${id}`,1,'u');
  }
  const result = await resetOrganizationData({ db: s, organizationId:'org-a', storage });

  assert.equal(result.removed.partners,1);
  assert.equal(result.removed.contracts,1);
  assert.equal(result.removed.ios,1);
  assert.equal(result.removed.notifications,2);
  assert.equal(result.removed.templates,1);
  assert.equal(result.removed.contract_documents,1);
  assert.equal(result.removed.contract_comments,1);
  assert.equal(result.removed.approval_requests,1);
  assert.equal(result.removed.approval_steps,1);
  assert.deepEqual((await readBusinessRows(s,'partners')).map(row=>row.partner_id),['p2']);
  assert.deepEqual((await readBusinessRows(s,'templates')).map(row=>row.id),['t2']);
  for (const table of ['contracts','insertion_orders','spendings','evaluations','notifications']) assert.equal((await readBusinessRows(s,table,'org-a')).length,0,table);
  assert.equal((await s.get('SELECT COUNT(*) AS n FROM contract_documents')).n,1);
  assert.equal((await s.get('SELECT organization_id AS o FROM approval_requests')).o,'org-b');
  assert.equal(result.files,1);
  assert.deepEqual((await storage.list('')).map(o=>o.key).sort(),['../outside.txt','other-org.pdf']);
});

test('a list read costs one query per table, not per parent row', async () => {
  await fixture();
  const partner = (id: string) => ({ partner_id:id, organizationId:'org-a', partner_name:id, tags:[id,'x'], identifiers:[{scheme:'tax',value:id}], dd_documents:[0,1].map(r => ({ key:`k${r}`, files:[{id:`${id}-${r}-a`},{id:`${id}-${r}-b`}] })) });
  const spending = (id: string) => ({ id, organizationId:'org-a', invoice_month:[id], month_allocations:[{month:id,amount:1.5}] });
  let queries = 0;
  const counted = { ...s, all: (text: string, ...params: unknown[]) => { queries++; return s.all(text, ...params); } };
  const readCount = async (k: number) => {
    const ids = Array.from({ length: k }, (_, i) => `p${i}`);
    const rows = { partners: ids.map(partner), contracts: ids.map(id => ({ contract_id:`c-${id}`, organizationId:'org-a', cooperation_categories:[id,'y'] })), spendings: ids.map(id => spending(`s-${id}`)) };
    await s.run('DELETE FROM insertion_orders');
    await s.run('DELETE FROM notifications');
    await s.run('DELETE FROM evaluations');
    await spendingRepository.removeAll();
    await contractRepository.removeAll();
    await partnerRepository.removeAll();
    await s.tx(() => insertRepositoryRows(s, rows));
    queries = 0;
    for (const [table, collection] of [['partners','partners'],['contracts','contracts'],['spendings','spendings']]) assert.deepEqual(await readBusinessRows(counted, table), rows[collection as keyof typeof rows].map(row => ({ ...row, version: 1 })));
    return queries;
  };
  assert.equal(await readCount(1), await readCount(6));
});

test('saves of the in-memory configuration are serialized and snapshot when their turn comes', async () => {
  await s.run(`DELETE FROM branding`);
  const memory: Record<string, any> = { allowedUsers: [], branding: { appName: 'Initial' } };
  let snapshots = 0;
  const saver = createCoreSaver(s, () => {
    // Another handler edits memory while the first save is still writing.
    if (++snapshots === 1) queueMicrotask(() => { memory.branding = { appName: 'Second edit' }; });
    return memory;
  });
  const stored = async () => JSON.parse((await s.get(`SELECT payload FROM branding WHERE id = 'branding'`)).payload).appName;
  memory.branding = { appName: 'First edit' };
  const first = saver.save();
  const second = saver.save();
  await first;
  assert.equal(await stored(), 'First edit');
  await second;
  assert.equal(await stored(), 'Second edit');
  // A save never runs inside a transaction (it would wait on itself), and a rolled-back save is retried in full.
  await assert.rejects(s.tx(() => saver.save()), /inside a transaction/);
  memory.branding = { appName: 'Kept after rollback' };
  await assert.rejects(saver.save(async () => { throw new Error('audit failed'); }), /audit failed/);
  assert.equal(await stored(), 'Second edit');
  await saver.save();
  assert.equal(await stored(), 'Kept after rollback');
});

test('a failed save reloads memory inside the lock, so the queued save neither replays the bad state nor loses its own write', async () => {
  await s.exec('CREATE TABLE IF NOT EXISTS audit (note text); TRUNCATE audit');
  const persisted = { allowedUsers: [{ email: 'a@example.com', name: 'A' }], branding: { appName: 'Persisted' } };
  let memory: Record<string, any> = structuredClone(persisted);
  const saver = createCoreSaver(s, () => memory, async () => { memory = structuredClone(persisted); });
  memory.allowedUsers.push({ email: 'b@example.com', name: 'Added, then the save fails' });
  memory.branding = { appName: 'Bad state' };
  const failed = saver.save(async () => { throw new Error('boom'); });
  const queued = saver.save(() => s.run(`INSERT INTO audit VALUES ('queued')`));
  await assert.rejects(failed, /boom/);
  await queued;
  assert.equal(memory.allowedUsers.length, 1);
  assert.equal(JSON.parse((await s.get(`SELECT payload FROM branding WHERE id = 'branding'`)).payload).appName, 'Persisted');
  assert.deepEqual(await s.all('SELECT note FROM audit'), [{ note: 'queued' }]);
});

test('decimal precision is explicit', () => {
  assert.deepEqual(decimalParts(0.29),{minor:29n,scale:2});
  assert.deepEqual(decimalParts('1e-7'),{minor:1n,scale:7});
  assert.throws(()=>decimalParts(Infinity));
  assert.throws(()=>decimalParts('10000000000000000000'));
});
