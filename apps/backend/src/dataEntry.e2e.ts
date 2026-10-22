/** Real HTTP + Chromium check, isolated from the development database and external services. */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { generateKeyPairSync } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import { buildDemoDataset } from '@legalio/shared/data/demoDataset';
import { LEGACY_FIELD_NAMES } from '@legalio/shared/fieldNames';
const repository=path.resolve(import.meta.dirname,'../../..');
const directory=mkdtempSync(path.join(os.tmpdir(),'legalio-data-entry-'));
const freePort=()=>new Promise<number>((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=(s.address() as net.AddressInfo).port;s.close(()=>resolve(p));});});
const backendPort=await freePort();const frontendPort=await freePort();
const backendURL=`http://127.0.0.1:${backendPort}`;const frontendURL=`http://127.0.0.1:${frontendPort}`;
Object.assign(process.env,{APP_TEST_MODE:'1',APP_DATA_DIR:directory,BETTER_AUTH_URL:frontendURL,TRUSTED_ORIGINS:`${backendURL},${frontendURL}`,BETTER_AUTH_ENABLE_INFRA:'false',API_ONLY:'true',SEED_DEMO_ADMIN:'false',PORT:String(backendPort),DISABLE_HMR:'true',BETTER_AUTH_SECRET:'test-only-secret-for-isolated-sqlite-e2e-123456789',GEMINI_API_KEY:'',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',GOOGLE_APPLICATION_CREDENTIALS:''});
const {createTestDatabase}=await import('./testDatabase');
// A throwaway legalio_test_* database; every server this test spawns inherits DATABASE_URL.
const database=await createTestDatabase();process.env.DATABASE_URL=database.url;
const {sql:fixtureSql}=await import('./db');
const {seedOrganizationsFromDataset,createOrganizationRecord}=await import('./organizationProvisioning');
const {synchronizeCoreData}=await import('./coreDataStore');
await (await import('./schema')).ensureSchema();
const dataset=buildDemoDataset();await seedOrganizationsFromDataset(fixtureSql,dataset);await synchronizeCoreData(fixtureSql,dataset);
const now=new Date().toISOString();const password='E2e-local-password-1234';const hash=await hashPassword(password);
for(const [id,email,role] of [['e2e-root','root@example.com','superuser'],['e2e-admin','admin@example.com','user'],['e2e-editor','editor@example.com','user']]){
 await fixtureSql.run('INSERT INTO "user"(id,name,email,"emailVerified",role,banned,"createdAt","updatedAt") VALUES(?,?,?,true,?,false,?,?)',id,id,email,role,now,now);
 await fixtureSql.run(`INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES(?,?,'credential',?,?,?,?)`,`account-${id}`,id,id,hash,now,now);
}
const org=dataset.tenants[0].id;
const otherOrg='e2e-other-org';
await createOrganizationRecord(fixtureSql,{id:otherOrg,name:'Other Organization'});
for(const [id,role] of [['e2e-admin','admin'],['e2e-editor','editor']])await fixtureSql.run(`INSERT INTO member(id,"organizationId","userId",role,status,"createdAt") VALUES(?,?,?,?,'active',?)`,`${id}-member`,org,id,role,now);
const teams=await fixtureSql.all('SELECT id,name FROM team WHERE "organizationId"=? ORDER BY name',org);
const owner=teams[0];const otherOwner=teams[1];
await fixtureSql.run(`INSERT INTO "teamMember"(id,"teamId","userId","createdAt") VALUES('e2e-editor-team',?,'e2e-editor',?)`,owner.id,now);
let server:ChildProcess|undefined;let frontend:ChildProcess|undefined;let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
const logs:string[]=[];const checks:string[]=[];
const appTabs=['dashboard','hierarchy','partners','contracts','create-contract','ios','partner-spending','partner-evaluation','notifikasi','settings-organization','settings-access'];
const systemTabs=['dashboard','users','accounts','sessions','organizations','apikeys','google','google-drive','google-credentials','ai','smtp','mailer','ui-texts','reset'];
const run=(args:string[],cwd=repository,env=process.env)=>{const child=spawn('node',args,{cwd,env,stdio:['ignore','pipe','pipe']});child.stdout?.on('data',c=>logs.push(String(c)));child.stderr?.on('data',c=>logs.push(String(c)));return child;};
const waitFor=async(url:string,child:ChildProcess)=>{const deadline=Date.now()+60000;while(Date.now()<deadline){if(child.exitCode!==null)throw new Error(`Server exited ${child.exitCode}`);try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,200));}throw new Error(`Timed out ${url}`);};
const stop=async(child?:ChildProcess)=>{if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,5000))]);if(child.exitCode===null)child.kill('SIGKILL');};
let token='';
const call=async(route:string,o:{method?:string;body?:any;org?:string;token?:string;status?:number}={})=>{
 const response=await fetch(backendURL+route,{method:o.method||'GET',headers:{'Content-Type':'application/json',Origin:frontendURL,...((o.token??token)?{Authorization:`Bearer ${o.token??token}`} : {}),...(o.org?{'x-organization-id':o.org}:{})},...(o.body!==undefined?{body:JSON.stringify(o.body)}:{})});
 const text=await response.text();let body:any={};if(text){try{body=JSON.parse(text);}catch{throw new Error(`Non-JSON ${response.status} ${route}: ${text.slice(0,150)}`);}}assert.equal(response.status,o.status??200,`${route}: ${text}`);return body;
};
/**
 * Data-entry audit: every entity created the way the forms do (API payloads) and through bulk import,
 * with valid, edge and invalid input. A 5xx is always a problem; invalid input must be rejected with 4xx.
 * Afterwards: read-back equality, persistence across a restart, and a clean server log.
 */
type Want='ok'|'reject'|'any';
const outcomes:string[]=[];const problems:string[]=[];
const send=async(name:string,route:string,method:string,body:any,want:Want,orgId=org)=>{
 const response=await fetch(backendURL+route,{method,headers:{'Content-Type':'application/json',Origin:frontendURL,Authorization:`Bearer ${token}`,'x-organization-id':orgId},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const text=await response.text();let json:any={};try{json=JSON.parse(text);}catch{}
 const s=response.status;
 if(s>=500)problems.push(`${name}: HTTP ${s} ${text.slice(0,220)}`);
 else if(want==='ok'&&!(s>=200&&s<300))problems.push(`${name}: expected success, got ${s} ${text.slice(0,220)}`);
 else if(want==='reject'&&!(s>=400))problems.push(`${name}: invalid input was accepted (${s})`);
 outcomes.push(`${String(s).padEnd(4)} ${want.padEnd(6)} ${name}`);
 return {status:s,json};
};
const pdf=(text='%PDF-1.4 data-entry')=>'data:application/pdf;base64,'+Buffer.from(text).toString('base64');
const uploadText=async(link:string)=>{const response=await fetch(backendURL+link,{headers:{Authorization:`Bearer ${token}`}});assert.equal(response.status,200,link);return response.text();};
const initData=async()=>(await call('/api/init-data',{org}));
const errorLogPattern=/Failed to save|TypeError|ReferenceError|Unquoted "|violates .*constraint|syntax error at|(column|relation) .* does not exist|UnhandledPromise|Unhandled rejection|Cannot read prop/i;
try{
 server=run(['apps/backend/dist/server.cjs']);await waitFor(backendURL+'/api/health',server);
 token=(await call('/api/auth/sign-in/email',{method:'POST',body:{email:'root@example.com',password},token:''})).token;assert.ok(token);
 const before=await initData();

 // ---- Forms: partners
 const unicodeName='DE Ünïcode 株式会社 & Co. "Quote" \'x\' <b>';
 const pA=(await send('form partner full','/api/partners','POST',{partner_name:'DE Vendor Alpha',partner_type:'Vendor',country:'ID',entity_type:'PT',internal_pic:owner.name,tags:['Supplier','Media'],identifiers:[{scheme:'tax',value:'01.234.567.8-901.000',country:'ID'}],pic_name:'Budi',pic_email:'budi@example.com',pic_phone:'+62 812-0000',pic_address:'Jl. Sudirman No. 1, Jakarta',notes:'Catatan panjang '.repeat(50)},'ok')).json.partner;
 const pB=(await send('form partner unicode/special characters','/api/partners','POST',{partner_name:unicodeName,partner_type:'Customer'},'ok')).json.partner;
 await send('form partner minimal','/api/partners','POST',{partner_name:'DE Minimal'},'ok');
 await send('form partner duplicate name','/api/partners','POST',{partner_name:'de vendor alpha'},'any');
 await send('form partner without name','/api/partners','POST',{partner_type:'Vendor'},'reject');
 await send('form partner update','/api/partners/'+pA.partner_id,'PUT',{notes:'Updated note',pic_name:'Siti'},'ok');

 // ---- Forms: contracts
 const cMaster=(await send('form contract master with decimals, categories and file','/api/contracts','POST',{partner_id:pA.partner_id,contract_number:'DE-CTR-001',contract_title:'Master é ü 株式会社',start_date:'2026-01-01',end_date:'2027-12-31',currency:'IDR',contract_value:1234567890.55,status_approval:'Signed',auto_renewal:true,notice_period_days:60,notice_type_required:'Both',internal_pic:owner.name,cooperation_categories:['Media','Tech'],internal_notes:'note',fileName:'DE-CTR-001.pdf',fileData:pdf()},'ok')).json.contract;
 await send('form contract USD','/api/contracts','POST',{partner_id:pA.partner_id,contract_number:'DE-CTR-002',contract_title:'USD contract',start_date:'2026-02-01',end_date:'2026-12-31',currency:'USD',contract_value:5000.1,status_approval:'Draft',auto_renewal:false,internal_pic:owner.name},'ok');
 const cAdd=(await send('form contract addendum with parent','/api/contracts','POST',{partner_id:pA.partner_id,document_type:'Agreement Addendum',parent_contract_id:cMaster.contract_id,parent_contract_number:cMaster.contract_number,contract_number:'DE-CTR-001-A1',contract_title:'Addendum 1',start_date:'2026-06-01',end_date:'2027-12-31',currency:'IDR',contract_value:1000,status_approval:'Signed',auto_renewal:false,internal_pic:owner.name},'ok')).json.contract;
 await send('form contract unknown partner','/api/contracts','POST',{partner_id:'does-not-exist',contract_number:'DE-CTR-BAD',contract_title:'x',start_date:'2026-01-01',end_date:'2026-12-31',currency:'IDR',contract_value:1,internal_pic:owner.name},'reject');
 await send('form contract without number','/api/contracts','POST',{partner_id:pA.partner_id,contract_title:'x',start_date:'2026-01-01',end_date:'2026-12-31',currency:'IDR',contract_value:1,internal_pic:owner.name},'reject');
 await send('form contract duplicate number','/api/contracts','POST',{partner_id:pA.partner_id,contract_number:'DE-CTR-001',contract_title:'dup',start_date:'2026-01-01',end_date:'2026-12-31',currency:'IDR',contract_value:1,internal_pic:owner.name},'any');
 await send('form contract with termination document','/api/contracts','POST',{partner_id:pA.partner_id,contract_number:'DE-CTR-TERM',contract_title:'Terminated',start_date:'2026-01-01',end_date:'2026-12-31',currency:'IDR',contract_value:1,internal_pic:owner.name,lifecycle_mode:'terminated',termination_date:'2026-06-01',termination_reason:'Test',termination_document_file:{fileName:'term.pdf',fileData:pdf('%PDF-1.4 term')}},'any');
 await send('form contract update value, title and new file','/api/contracts/'+cMaster.contract_id,'PUT',{contract_title:'Master updated',contract_value:2000000.25,fileName:'DE-CTR-001-v2.pdf',fileData:pdf('%PDF-1.4 v2')},'ok');

 // ---- Forms: commercial documents
 const ioA=(await send('form IO linked to contract with file','/api/ios','POST',{contract_id:cMaster.contract_id,partner_id:pA.partner_id,io_number:'DE-IO-001',io_title:'IO é',media_channel:'Digital',start_date:'2026-01-01',end_date:'2026-12-31',pricing_model:'CPM',charging_type:'Prepaid',currency:'IDR',io_value:250000.75,deliverables:'x',notice_period_days:30,notice_type_required:'Both',fileName:'io.pdf',fileData:pdf()},'ok')).json.io;
 await send('form IO without contract','/api/ios','POST',{partner_id:pA.partner_id,io_number:'DE-IO-002',io_title:'Standalone',media_channel:'Event',start_date:'2026-01-01',end_date:'2026-12-31',pricing_model:'Fixed',charging_type:'Postpaid',currency:'USD',io_value:10},'ok');
 await send('form IO without partner','/api/ios','POST',{io_number:'DE-IO-BAD',io_title:'x'},'reject');
 await send('form IO update','/api/ios/'+ioA.io_id,'PUT',{io_title:'IO updated',io_value:999.99,fileName:'io2.pdf',fileData:pdf('%PDF-1.4 io2')},'ok');

 // ---- Forms: spending and evaluation
 const sA=(await send('form spending with invoice and billing files','/api/partner-spendings','POST',{vendor_id:pA.partner_id,vendor_name:pA.partner_name,invoice_number:'DE-INV-001',invoice_date:'2026-10-01',invoice_month:['2026-10-31'],currency:'IDR',total_amount:15000000.5,invoice_title:'Oct',invoice_file:{fileName:'inv.pdf',fileData:pdf()},billing_file:{fileName:'bill.pdf',fileData:pdf()}},'ok')).json.spending;
 await send('form spending multi-month allocations','/api/partner-spendings','POST',{vendor_id:pA.partner_id,vendor_name:pA.partner_name,invoice_number:'DE-INV-002',invoice_date:'2026-09-30',invoice_month:['2026-08-31','2026-09-30'],month_allocations:[{month:'2026-08',amount:100},{month:'2026-09',amount:50.5}],currency:'USD',total_amount:150.5},'ok');
 await send('form spending without invoice number','/api/partner-spendings','POST',{vendor_id:pA.partner_id,vendor_name:pA.partner_name,total_amount:1},'reject');
 await send('form spending update','/api/partner-spendings/'+sA.id,'PUT',{invoice_title:'Updated',total_amount:15000001.25},'ok');
 const eA=(await send('form evaluation','/api/partner-evaluations','POST',{partner_id:pA.partner_id,supplier_name:pA.partner_name,review_date:'2026-10-01',type_of_work:'Services',sla_score:90,obligation_target:'Met',incident_frequency:'Never',communication:'Good',pricing:'Moderate',final_evaluation:'Recommended',notes:'ok'},'ok')).json.evaluation;
 await send('form evaluation without date','/api/partner-evaluations','POST',{partner_id:pA.partner_id,supplier_name:pA.partner_name},'reject');
 await send('form evaluation update','/api/partner-evaluations/'+eA.id,'PUT',{notes:'Updated'},'ok');

 // ---- Forms: due-diligence upload and template
 const ddName=(await initData()).partners.find((p:any)=>p.partner_id===pA.partner_id).dd_documents[0].name;
 await send('form DD document upload','/api/partners/'+pA.partner_id+'/upload-dd','POST',{docName:ddName,fileName:'dd.pdf',fileData:pdf(),documentNumber:'N-1',expiryDate:'2030-01-01'},'ok');
 await send('form template','/api/templates','POST',{name:'DE Template',contentId:'de-content',customFields:[]},'any');

 // ---- Import
 const imp=async(name:string,type:string,rows:any[],want:Want='ok')=>send(name,'/api/bulk-import','POST',{type,rows},want);
 const partnersImport=await imp('import partners: valid, duplicate, blank, bad department','partners',[
  {partner_name:'DE Imp Alpha',partner_type:'Vendor',country:'id',internal_pic:owner.name,tags:'Supplier;Media',identifiers:'tax:123;npwp:456',pic_email:'a@b.co',pic_phone:'+62'},
  {partner_name:'DE Imp Ünï 株式会社'},{partner_name:'de imp alpha'},{partner_name:''},{partner_name:'DE Imp BadDept',internal_pic:'Nonexistent Department'}]);
 assert.deepEqual([partnersImport.json.succeeded?.length,partnersImport.json.skipped?.length,partnersImport.json.failed?.length],[2,1,2],JSON.stringify(partnersImport.json));
 const numericPartner=await imp('import partners: numeric cell instead of text','partners',[{partner_name:12345}]);
 assert.equal(numericPartner.json.succeeded?.length,1,JSON.stringify(numericPartner.json));
 const contractsImport=await imp('import contracts: valid, addendum, unknown partner, bad enum, comma decimal','contracts',[
  {contract_number:'DE-IMP-C1',contract_title:'t',partner_name:'DE Imp Alpha',document_type:'Master Agreement',start_date:'2026-01-01',end_date:'2027-01-01',contract_value:'1000000.50',currency:'IDR',auto_renewal:'ya',notice_period_days:'45',cooperation_categories:'A;B'},
  {contract_number:'DE-IMP-C1-A1',contract_title:'add',partner_name:'DE Imp Alpha',document_type:'Agreement Addendum',parent_contract_number:'DE-IMP-C1',start_date:'2026-03-01',end_date:'2027-01-01',contract_value:'1'},
  {contract_number:'DE-IMP-C2',partner_name:'No Such Partner'},{contract_number:'DE-IMP-C3',partner_name:'DE Imp Alpha',document_type:'Weird'},
  {contract_number:'DE-IMP-C4',partner_name:'DE Imp Alpha',start_date:'2026-01-01',end_date:'2027-01-01',contract_value:'1.000.000,50'},
  {contract_number:'DE-IMP-C6',partner_name:'DE Imp Alpha',start_date:'15/03/2026',end_date:'14-03-2027'}]);
 assert.deepEqual([contractsImport.json.succeeded?.length,contractsImport.json.failed?.length],[4,2],JSON.stringify(contractsImport.json));
 const numericContract=await imp('import contracts: numeric cells','contracts',[{contract_number:777,partner_name:'DE Imp Alpha',contract_value:5000}]);
 assert.equal(numericContract.json.succeeded?.length,1,JSON.stringify(numericContract.json));
 const badDates=await imp('import contracts: unparseable dates are rejected','contracts',[{contract_number:'DE-IMP-C5',partner_name:'DE Imp Alpha',start_date:'31/12/2026',end_date:'not-a-date'}]);
 assert.equal(badDates.json.failed?.length,1,JSON.stringify(badDates.json));assert.match(badDates.json.failed[0].message,/end_date/);
 const iosImport=await imp('import IOs: valid, duplicate, unknown partner','ios',[
  {io_number:'DE-IMP-IO1',io_title:'x',partner_name:'DE Imp Alpha',contract_number:'DE-IMP-C1',media_channel:'Digital',start_date:'2026-01-01',end_date:'2026-12-31',pricing_model:'CPM',charging_type:'Prepaid',io_value:'500.25',currency:'IDR'},
  {io_number:'de-imp-io1',partner_name:'DE Imp Alpha'},{io_number:'DE-IMP-IO2',partner_name:'No Such Partner'}]);
 assert.deepEqual([iosImport.json.succeeded?.length,iosImport.json.skipped?.length,iosImport.json.failed?.length],[1,1,1],JSON.stringify(iosImport.json));
 const evalImport=await imp('import evaluations: valid, duplicate, missing date','evaluations',[
  {supplier_name:'DE Imp Alpha',review_date:'2026-09-01',type_of_work:'Services',sla_score:'88',obligation_target:'Met',incident_frequency:'Never',communication:'Good',pricing:'Moderate',final_evaluation:'Recommended'},
  {supplier_name:'DE Imp Alpha',review_date:'2026-09-01',obligation_target:'Met',incident_frequency:'Never',communication:'Good',pricing:'Moderate',final_evaluation:'Recommended'},{supplier_name:'DE Imp Alpha'}]);
 assert.deepEqual([evalImport.json.succeeded?.length,evalImport.json.skipped?.length,evalImport.json.failed?.length],[1,1,1],JSON.stringify(evalImport.json));
 const spendImport=await imp('import spendings: valid, month formats, unknown vendor, duplicate, missing','spendings',[
  {invoice_number:'DE-IMP-INV1',vendor_name:'DE Imp Alpha',invoice_date:'2026-10-01',invoice_month:'2026-10',total_amount:'2500000.75',currency:'IDR',payment_status:'Paid'},
  {invoice_number:'DE-IMP-INV2',vendor_name:'DE Imp Alpha',invoice_date:'2026-10-01',invoice_month:'Oct 2026',total_amount:'10',currency:'USD'},
  {invoice_number:'DE-IMP-INV3',vendor_name:'Nobody Ltd',invoice_date:'2026-10-01',invoice_month:'2026-10',total_amount:'1'},
  {invoice_number:'de-imp-inv1',vendor_name:'DE Imp Alpha'},{invoice_number:'DE-IMP-INV4'}]);
 assert.equal(spendImport.json.failed?.length,1,JSON.stringify(spendImport.json));
 await imp('import with unknown type','nothing',[{a:1}],'reject');
 await imp('import with empty rows','contracts',[],'reject');

 // ---- Older clients and old CSV files still send the Indonesian names; they are accepted, never returned
 const legacyPartner=(await send('legacy API: partner with Indonesian field names','/api/partners','POST',{nama_partner:'DE Legacy Partner',jenis_partner:'Vendor',nama_pic:'Dewi',email_pic:'dewi@example.com',catatan:'legacy note',pic_internal:owner.name,daftar_dokumen_dd:[]},'ok')).json.partner;
 assert.equal(legacyPartner.partner_name,'DE Legacy Partner');assert.equal(legacyPartner.notes,'legacy note');
 await send('legacy API: contract with Indonesian field names','/api/contracts','POST',{partner_id:legacyPartner.partner_id,nomor_kontrak:'DE-LEG-001',judul_kontrak:'Legacy contract',tanggal_mulai:'2026-02-01',tanggal_berakhir:'2027-02-01',nilai_kontrak:750000.5,notice_period_hari:45,kategori_kerjasama:['Media'],jenis_dokumen:'Master Agreement',currency:'IDR',status_approval:'Signed',auto_renewal:false,pic_internal:owner.name},'ok');
 const legacyImport=await send('legacy CSV: import with old Indonesian headers','/api/bulk-import','POST',{type:'contracts',rows:[{nomor_kontrak:'DE-LEG-IMP',judul_kontrak:'Old template row',partner_nama:'DE Legacy Partner',jenis_dokumen:'Master Agreement',tanggal_mulai:'01/03/2026',tanggal_berakhir:'2027-03-01',nilai_kontrak:'1.250.000,75',notice_period_hari:'20',kategori_kerjasama:'A;B'}]},'ok');
 assert.equal(legacyImport.json.succeeded?.length,1,JSON.stringify(legacyImport.json));
 const oldHeaderPartners=await send('legacy CSV: partners import with old headers','/api/bulk-import','POST',{type:'partners',rows:[{nama_partner:'DE Legacy Imported',jenis_partner:'Klien',nama_pic:'Rudi',catatan:'from old csv'}]},'ok');
 assert.equal(oldHeaderPartners.json.succeeded?.length,1,JSON.stringify(oldHeaderPartners.json));

 // ---- Read-back: values must survive unchanged
 const data=await initData();
 const byId=(rows:any[],key:string,id:string)=>rows.find((r:any)=>r[key]===id);
 assert.equal(byId(data.partners,'partner_id',pB.partner_id).partner_name,unicodeName);
 const rA=byId(data.partners,'partner_id',pA.partner_id);assert.equal(rA.pic_name,'Siti');assert.deepEqual(rA.tags,['Supplier','Media']);assert.equal(rA.identifiers[0].value,'01.234.567.8-901.000');
 const ddFile=rA.dd_documents.find((d:any)=>d.name===ddName).files?.[0];assert.match(ddFile.linkDrive,/^\/uploads\//);await uploadText(ddFile.linkDrive);
 const rM=byId(data.contracts,'contract_id',cMaster.contract_id);assert.equal(rM.contract_value,2000000.25);assert.equal(rM.contract_title,'Master updated');assert.deepEqual(rM.cooperation_categories,['Media','Tech']);assert.equal(rM.auto_renewal,true);
 assert.match(rM.contract_file_link,/^\/uploads\//);assert.equal(await uploadText(rM.contract_file_link),'%PDF-1.4 v2');
 assert.equal(byId(data.contracts,'contract_id',cAdd.contract_id).parent_contract_id,cMaster.contract_id);
 assert.equal(byId(data.ios,'io_id',ioA.io_id).io_value,999.99);assert.match(byId(data.ios,'io_id',ioA.io_id).io_file_link,/^\/uploads\//);
 const rS=byId(data.spendings,'id',sA.id);assert.equal(rS.total_amount,15000001.25);assert.match(rS.invoice_file_url,/^\/uploads\//);assert.match(rS.billing_file_url,/^\/uploads\//);
 const multi=data.spendings.find((s:any)=>s.invoice_number==='DE-INV-002');assert.equal(multi.month_allocations.length,2);assert.equal(multi.month_allocations[1].amount,50.5);
 for(const kind of ['contracts','ios'])for(const row of data[kind])assert.equal('partner_name' in row,false,`${kind} row carries partner_name`);
 const legacyKeysIn=(value:any,found=new Set<string>()):Set<string>=>{if(Array.isArray(value))value.forEach(item=>legacyKeysIn(item,found));else if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){if(key in LEGACY_FIELD_NAMES)found.add(key);legacyKeysIn(child,found);}return found;};
 for(const collection of ['partners','contracts','ios','spendings','evaluations','notifications'])assert.deepEqual([...legacyKeysIn(data[collection])],[],`${collection} still return Indonesian field names`);
 const legacyContract=data.contracts.find((c:any)=>c.contract_number==='DE-LEG-001');assert.equal(legacyContract.contract_value,750000.5);assert.equal(legacyContract.notice_period_days,45);assert.equal(legacyContract.start_date,'2026-02-01');assert.deepEqual(legacyContract.cooperation_categories,['Media']);
 const legacyImported=data.contracts.find((c:any)=>c.contract_number==='DE-LEG-IMP');assert.equal(legacyImported.contract_value,1250000.75);assert.equal(legacyImported.start_date,'2026-03-01');assert.equal(legacyImported.notice_period_days,20);
 assert.equal(data.partners.find((p:any)=>p.partner_name==='DE Legacy Imported').notes,'from old csv');
 assert.equal(data.contracts.find((c:any)=>c.contract_number==='DE-IMP-C4').contract_value,1000000.5,'Indonesian decimal format');
 assert.equal(data.contracts.find((c:any)=>c.contract_number==='DE-IMP-C1').contract_value,1000000.5);
 assert.equal(data.contracts.find((c:any)=>c.contract_number==='777').contract_value,5000);
 const dmy=data.contracts.find((c:any)=>c.contract_number==='DE-IMP-C6');assert.equal(dmy.start_date,'2026-03-15');assert.equal(dmy.end_date,'2027-03-14');
 assert.equal(data.contracts.some((c:any)=>c.contract_number==='DE-IMP-C5'),false);
 assert.equal(data.spendings.find((s:any)=>s.invoice_number==='DE-IMP-INV1').total_amount,2500000.75);
 const importedPartnerCountry=data.partners.find((p:any)=>p.partner_name==='DE Imp Alpha');assert.equal(importedPartnerCountry.country,'ID');assert.deepEqual(importedPartnerCountry.tags,['Supplier','Media']);

 // ---- Unmapped fields, then persistence across a restart
 for(const table of ['partners','contracts','insertion_orders','spendings','evaluations']){const n=(await fixtureSql.get(`SELECT COUNT(*) AS n FROM ${table} WHERE extra_json != '{}'`)).n;outcomes.push(`INFO  ${table}: ${n} rows keep unmapped fields in extra_json`);}
 const counts=(d:any)=>['partners','contracts','ios','spendings','evaluations'].map(k=>d[k].length);
 const beforeRestart=counts(data);await stop(server);server=run(['apps/backend/dist/server.cjs']);await waitFor(backendURL+'/api/health',server);
 token=(await call('/api/auth/sign-in/email',{method:'POST',body:{email:'root@example.com',password},token:''})).token;
 const afterRestart=await initData();assert.deepEqual(counts(afterRestart),beforeRestart,'row counts after restart');
 assert.equal(byId(afterRestart.contracts,'contract_id',cMaster.contract_id).contract_value,2000000.25);assert.equal(byId(afterRestart.partners,'partner_id',pB.partner_id).partner_name,unicodeName);
 const added=counts(afterRestart).map((n,i)=>n-counts(before)[i]);outcomes.push(`INFO  rows added (partners, contracts, ios, spendings, evaluations): ${added.join(', ')}`);

 // ---- Server log must be free of runtime errors
 const badLines=logs.join('').split('\n').filter(line=>errorLogPattern.test(line));
 if(badLines.length)problems.push(`server log: ${badLines.slice(0,5).join(' | ')}`);
 console.log(outcomes.join('\n'));
 if(problems.length){console.error('\nPROBLEMS:\n'+problems.map(p=>' - '+p).join('\n'));process.exitCode=1;}
 else console.log(`\nAll ${outcomes.filter(o=>!o.startsWith('INFO')).length} data-entry scenarios behaved correctly.`);
}catch(error){console.log(outcomes.join('\n'));console.error('PROBLEMS so far:\n'+problems.map(p=>' - '+p).join('\n'));throw error;}
finally{writeFileSync(path.join(directory,'servers.log'),logs.join(''));await stop(server);await database.drop();}
