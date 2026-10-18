/** Real HTTP + Chromium check, isolated from the development database and external services. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { generateKeyPairSync } from 'node:crypto';
import Database from 'better-sqlite3';
import { chromium, expect } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import { buildDemoDataset } from '@legalio/shared/data/demoDataset';
const repository=path.resolve(import.meta.dirname,'../../..');
const directory=mkdtempSync(path.join(os.tmpdir(),'legalio-data-entry-'));
const freePort=()=>new Promise<number>((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=(s.address() as net.AddressInfo).port;s.close(()=>resolve(p));});});
const backendPort=await freePort();const frontendPort=await freePort();
const backendURL=`http://127.0.0.1:${backendPort}`;const frontendURL=`http://127.0.0.1:${frontendPort}`;
Object.assign(process.env,{APP_TEST_MODE:'1',AUTH_DB_PATH:path.join(directory,'kaelyn.db'),APP_DATA_DIR:directory,BETTER_AUTH_URL:frontendURL,TRUSTED_ORIGINS:`${backendURL},${frontendURL}`,BETTER_AUTH_ENABLE_INFRA:'false',API_ONLY:'true',SEED_DEMO_ADMIN:'false',PORT:String(backendPort),DISABLE_HMR:'true',BETTER_AUTH_SECRET:'test-only-secret-for-isolated-sqlite-e2e-123456789',GEMINI_API_KEY:'',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',GOOGLE_APPLICATION_CREDENTIALS:''});
const {sqliteDb:fixtureDb,hydrateCoreDataFromJson}=await import('./lib/auth');
const {seedOrganizationsFromDataset,createOrganizationRecord}=await import('./organizationProvisioning');
const {markMigrationApplied}=await import('./organizationSettingsStore');
const dataset=buildDemoDataset();seedOrganizationsFromDataset(fixtureDb,dataset);markMigrationApplied(fixtureDb,{fixture:true});hydrateCoreDataFromJson(dataset);
fixtureDb.exec("UPDATE insertion_orders SET id=json_extract(payload,'$.contract_id')");
const now=new Date().toISOString();const password='E2e-local-password-1234';const hash=await hashPassword(password);
for(const [id,email,role] of [['e2e-root','root@example.com','superuser'],['e2e-admin','admin@example.com','user'],['e2e-editor','editor@example.com','user']]){
 fixtureDb.prepare('INSERT INTO "user"(id,name,email,emailVerified,role,banned,createdAt,updatedAt) VALUES(?,?,?,1,?,0,?,?)').run(id,id,email,role,now,now);
 fixtureDb.prepare("INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,'credential',?,?,?,?)").run(`account-${id}`,id,id,hash,now,now);
}
const org=dataset.tenants[0].id;
const otherOrg='e2e-other-org';
createOrganizationRecord(fixtureDb,{id:otherOrg,name:'Other Organization'});
for(const [id,role] of [['e2e-admin','admin'],['e2e-editor','editor']])fixtureDb.prepare("INSERT INTO member(id,organizationId,userId,role,status) VALUES(?,?,?,?,'active')").run(`${id}-member`,org,id,role);
const teams=fixtureDb.prepare('SELECT id,name FROM team WHERE organizationId=? ORDER BY name').all(org) as any[];
const owner=teams[0];const otherOwner=teams[1];
fixtureDb.prepare("INSERT INTO teamMember(id,teamId,userId) VALUES('e2e-editor-team',?,'e2e-editor')").run(owner.id);fixtureDb.close();
let server:ChildProcess|undefined;let frontend:ChildProcess|undefined;let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
const logs:string[]=[];const checks:string[]=[];
const appTabs=['dashboard','hierarchy','partners','contracts','create-contract','ios','partner-spending','partner-evaluation','notifikasi','settings-organization','settings-access'];
const systemTabs=['dashboard','users','accounts','sessions','organizations','apikeys','google','google-drive','google-credentials','ai','smtp','mailer','ui-texts','database','backups','reset'];
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
 * Afterwards: read-back equality, SQLite integrity, persistence across a restart, and a clean server log.
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
const uploadsPath=(link:string)=>path.join(directory,'uploads',...decodeURIComponent(link.slice('/uploads/'.length)).split('/'));
const initData=async()=>(await call('/api/init-data',{org}));
const errorLogPattern=/Failed to save|TypeError|ReferenceError|SQLITE_|UnhandledPromise|Unhandled rejection|Cannot read prop/i;
try{
 server=run(['apps/backend/dist/server.cjs']);await waitFor(backendURL+'/api/health',server);
 token=(await call('/api/auth/sign-in/email',{method:'POST',body:{email:'root@example.com',password},token:''})).token;assert.ok(token);
 const before=await initData();

 // ---- Forms: partners
 const unicodeName='DE Ünïcode 株式会社 & Co. "Quote" \'x\' <b>';
 const pA=(await send('form partner full','/api/partners','POST',{nama_partner:'DE Vendor Alpha',jenis_partner:'Vendor',country:'ID',entity_type:'PT',pic_internal:owner.name,tags:['Supplier','Media'],identifiers:[{scheme:'tax',value:'01.234.567.8-901.000',country:'ID'}],nama_pic:'Budi',email_pic:'budi@example.com',telepon_pic:'+62 812-0000',alamat_pic:'Jl. Sudirman No. 1, Jakarta',catatan:'Catatan panjang '.repeat(50)},'ok')).json.partner;
 const pB=(await send('form partner unicode/special characters','/api/partners','POST',{nama_partner:unicodeName,jenis_partner:'Customer'},'ok')).json.partner;
 await send('form partner minimal','/api/partners','POST',{nama_partner:'DE Minimal'},'ok');
 await send('form partner duplicate name','/api/partners','POST',{nama_partner:'de vendor alpha'},'any');
 await send('form partner without name','/api/partners','POST',{jenis_partner:'Vendor'},'reject');
 await send('form partner update','/api/partners/'+pA.partner_id,'PUT',{catatan:'Updated note',nama_pic:'Siti'},'ok');

 // ---- Forms: contracts
 const cMaster=(await send('form contract master with decimals, categories and file','/api/contracts','POST',{partner_id:pA.partner_id,nomor_kontrak:'DE-CTR-001',judul_kontrak:'Master é ü 株式会社',tanggal_mulai:'2026-01-01',tanggal_berakhir:'2027-12-31',currency:'IDR',nilai_kontrak:1234567890.55,status_approval:'Signed',auto_renewal:true,notice_period_hari:60,notice_type_required:'Both',pic_internal:owner.name,kategori_kerjasama:['Media','Tech'],internal_notes:'note',fileName:'DE-CTR-001.pdf',fileData:pdf()},'ok')).json.contract;
 await send('form contract USD','/api/contracts','POST',{partner_id:pA.partner_id,nomor_kontrak:'DE-CTR-002',judul_kontrak:'USD contract',tanggal_mulai:'2026-02-01',tanggal_berakhir:'2026-12-31',currency:'USD',nilai_kontrak:5000.1,status_approval:'Draft',auto_renewal:false,pic_internal:owner.name},'ok');
 const cAdd=(await send('form contract addendum with parent','/api/contracts','POST',{partner_id:pA.partner_id,jenis_dokumen:'Agreement Addendum',parent_contract_id:cMaster.contract_id,parent_contract_nomor:cMaster.nomor_kontrak,nomor_kontrak:'DE-CTR-001-A1',judul_kontrak:'Addendum 1',tanggal_mulai:'2026-06-01',tanggal_berakhir:'2027-12-31',currency:'IDR',nilai_kontrak:1000,status_approval:'Signed',auto_renewal:false,pic_internal:owner.name},'ok')).json.contract;
 await send('form contract unknown partner','/api/contracts','POST',{partner_id:'does-not-exist',nomor_kontrak:'DE-CTR-BAD',judul_kontrak:'x',tanggal_mulai:'2026-01-01',tanggal_berakhir:'2026-12-31',currency:'IDR',nilai_kontrak:1,pic_internal:owner.name},'reject');
 await send('form contract without number','/api/contracts','POST',{partner_id:pA.partner_id,judul_kontrak:'x',tanggal_mulai:'2026-01-01',tanggal_berakhir:'2026-12-31',currency:'IDR',nilai_kontrak:1,pic_internal:owner.name},'reject');
 await send('form contract duplicate number','/api/contracts','POST',{partner_id:pA.partner_id,nomor_kontrak:'DE-CTR-001',judul_kontrak:'dup',tanggal_mulai:'2026-01-01',tanggal_berakhir:'2026-12-31',currency:'IDR',nilai_kontrak:1,pic_internal:owner.name},'any');
 await send('form contract with termination document','/api/contracts','POST',{partner_id:pA.partner_id,nomor_kontrak:'DE-CTR-TERM',judul_kontrak:'Terminated',tanggal_mulai:'2026-01-01',tanggal_berakhir:'2026-12-31',currency:'IDR',nilai_kontrak:1,pic_internal:owner.name,lifecycle_mode:'terminated',termination_date:'2026-06-01',termination_reason:'Test',termination_document_file:{fileName:'term.pdf',fileData:pdf('%PDF-1.4 term')}},'any');
 await send('form contract update value, title and new file','/api/contracts/'+cMaster.contract_id,'PUT',{judul_kontrak:'Master updated',nilai_kontrak:2000000.25,fileName:'DE-CTR-001-v2.pdf',fileData:pdf('%PDF-1.4 v2')},'ok');

 // ---- Forms: commercial documents
 const ioA=(await send('form IO linked to contract with file','/api/ios','POST',{contract_id:cMaster.contract_id,partner_id:pA.partner_id,nomor_io:'DE-IO-001',judul_io:'IO é',kanal_media:'Digital',tanggal_mulai:'2026-01-01',tanggal_berakhir:'2026-12-31',pricing_model:'CPM',charging_type:'Prepaid',currency:'IDR',nilai_io:250000.75,deliverables:'x',notice_period_hari:30,notice_type_required:'Both',fileName:'io.pdf',fileData:pdf()},'ok')).json.io;
 await send('form IO without contract','/api/ios','POST',{partner_id:pA.partner_id,nomor_io:'DE-IO-002',judul_io:'Standalone',kanal_media:'Event',tanggal_mulai:'2026-01-01',tanggal_berakhir:'2026-12-31',pricing_model:'Fixed',charging_type:'Postpaid',currency:'USD',nilai_io:10},'ok');
 await send('form IO without partner','/api/ios','POST',{nomor_io:'DE-IO-BAD',judul_io:'x'},'reject');
 await send('form IO update','/api/ios/'+ioA.io_id,'PUT',{judul_io:'IO updated',nilai_io:999.99,fileName:'io2.pdf',fileData:pdf('%PDF-1.4 io2')},'ok');

 // ---- Forms: spending and evaluation
 const sA=(await send('form spending with invoice and billing files','/api/partner-spendings','POST',{vendor_id:pA.partner_id,vendor_name:pA.nama_partner,invoice_number:'DE-INV-001',invoice_date:'2026-10-01',invoice_month:['2026-10-31'],currency:'IDR',total_amount:15000000.5,invoice_title:'Oct',invoice_file:{fileName:'inv.pdf',fileData:pdf()},billing_file:{fileName:'bill.pdf',fileData:pdf()}},'ok')).json.spending;
 await send('form spending multi-month allocations','/api/partner-spendings','POST',{vendor_id:pA.partner_id,vendor_name:pA.nama_partner,invoice_number:'DE-INV-002',invoice_date:'2026-09-30',invoice_month:['2026-08-31','2026-09-30'],month_allocations:[{month:'2026-08',amount:100},{month:'2026-09',amount:50.5}],currency:'USD',total_amount:150.5},'ok');
 await send('form spending without invoice number','/api/partner-spendings','POST',{vendor_id:pA.partner_id,vendor_name:pA.nama_partner,total_amount:1},'reject');
 await send('form spending update','/api/partner-spendings/'+sA.id,'PUT',{invoice_title:'Updated',total_amount:15000001.25},'ok');
 const eA=(await send('form evaluation','/api/partner-evaluations','POST',{partner_id:pA.partner_id,supplier_name:pA.nama_partner,review_date:'2026-10-01',type_of_work:'Services',sla_score:90,obligation_target:'Met',incident_frequency:'Never',communication:'Good',pricing:'Moderate',final_evaluation:'Recommended',notes:'ok'},'ok')).json.evaluation;
 await send('form evaluation without date','/api/partner-evaluations','POST',{partner_id:pA.partner_id,supplier_name:pA.nama_partner},'reject');
 await send('form evaluation update','/api/partner-evaluations/'+eA.id,'PUT',{notes:'Updated'},'ok');

 // ---- Forms: due-diligence upload and template
 const ddName=(await initData()).partners.find((p:any)=>p.partner_id===pA.partner_id).daftar_dokumen_dd[0].nama;
 await send('form DD document upload','/api/partners/'+pA.partner_id+'/upload-dd','POST',{docName:ddName,fileName:'dd.pdf',fileData:pdf(),nomorDokumen:'N-1',tanggalKadaluarsa:'2030-01-01'},'ok');
 await send('form template','/api/templates','POST',{name:'DE Template',contentId:'de-content',customFields:[]},'any');

 // ---- Import
 const imp=async(name:string,type:string,rows:any[],want:Want='ok')=>send(name,'/api/bulk-import','POST',{type,rows},want);
 const partnersImport=await imp('import partners: valid, duplicate, blank, bad department','partners',[
  {nama_partner:'DE Imp Alpha',jenis_partner:'Vendor',country:'id',pic_internal:owner.name,tags:'Supplier;Media',identifiers:'tax:123;npwp:456',email_pic:'a@b.co',telepon_pic:'+62'},
  {nama_partner:'DE Imp Ünï 株式会社'},{nama_partner:'de imp alpha'},{nama_partner:''},{nama_partner:'DE Imp BadDept',pic_internal:'Nonexistent Department'}]);
 assert.deepEqual([partnersImport.json.succeeded?.length,partnersImport.json.skipped?.length,partnersImport.json.failed?.length],[2,1,2],JSON.stringify(partnersImport.json));
 const numericPartner=await imp('import partners: numeric cell instead of text','partners',[{nama_partner:12345}]);
 assert.equal(numericPartner.json.succeeded?.length,1,JSON.stringify(numericPartner.json));
 const contractsImport=await imp('import contracts: valid, addendum, unknown partner, bad enum, comma decimal','contracts',[
  {nomor_kontrak:'DE-IMP-C1',judul_kontrak:'t',partner_nama:'DE Imp Alpha',jenis_dokumen:'Master Agreement',tanggal_mulai:'2026-01-01',tanggal_berakhir:'2027-01-01',nilai_kontrak:'1000000.50',currency:'IDR',auto_renewal:'ya',notice_period_hari:'45',kategori_kerjasama:'A;B'},
  {nomor_kontrak:'DE-IMP-C1-A1',judul_kontrak:'add',partner_nama:'DE Imp Alpha',jenis_dokumen:'Agreement Addendum',parent_contract_nomor:'DE-IMP-C1',tanggal_mulai:'2026-03-01',tanggal_berakhir:'2027-01-01',nilai_kontrak:'1'},
  {nomor_kontrak:'DE-IMP-C2',partner_nama:'No Such Partner'},{nomor_kontrak:'DE-IMP-C3',partner_nama:'DE Imp Alpha',jenis_dokumen:'Weird'},
  {nomor_kontrak:'DE-IMP-C4',partner_nama:'DE Imp Alpha',tanggal_mulai:'2026-01-01',tanggal_berakhir:'2027-01-01',nilai_kontrak:'1.000.000,50'},
  {nomor_kontrak:'DE-IMP-C6',partner_nama:'DE Imp Alpha',tanggal_mulai:'15/03/2026',tanggal_berakhir:'14-03-2027'}]);
 assert.deepEqual([contractsImport.json.succeeded?.length,contractsImport.json.failed?.length],[4,2],JSON.stringify(contractsImport.json));
 const numericContract=await imp('import contracts: numeric cells','contracts',[{nomor_kontrak:777,partner_nama:'DE Imp Alpha',nilai_kontrak:5000}]);
 assert.equal(numericContract.json.succeeded?.length,1,JSON.stringify(numericContract.json));
 const badDates=await imp('import contracts: unparseable dates are rejected','contracts',[{nomor_kontrak:'DE-IMP-C5',partner_nama:'DE Imp Alpha',tanggal_mulai:'31/12/2026',tanggal_berakhir:'not-a-date'}]);
 assert.equal(badDates.json.failed?.length,1,JSON.stringify(badDates.json));assert.match(badDates.json.failed[0].message,/tanggal_berakhir/);
 const iosImport=await imp('import IOs: valid, duplicate, unknown partner','ios',[
  {nomor_io:'DE-IMP-IO1',judul_io:'x',partner_nama:'DE Imp Alpha',contract_nomor:'DE-IMP-C1',kanal_media:'Digital',tanggal_mulai:'2026-01-01',tanggal_berakhir:'2026-12-31',pricing_model:'CPM',charging_type:'Prepaid',nilai_io:'500.25',currency:'IDR'},
  {nomor_io:'de-imp-io1',partner_nama:'DE Imp Alpha'},{nomor_io:'DE-IMP-IO2',partner_nama:'No Such Partner'}]);
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

 // ---- Read-back: values must survive unchanged
 const data=await initData();
 const byId=(rows:any[],key:string,id:string)=>rows.find((r:any)=>r[key]===id);
 assert.equal(byId(data.partners,'partner_id',pB.partner_id).nama_partner,unicodeName);
 const rA=byId(data.partners,'partner_id',pA.partner_id);assert.equal(rA.nama_pic,'Siti');assert.deepEqual(rA.tags,['Supplier','Media']);assert.equal(rA.identifiers[0].value,'01.234.567.8-901.000');
 const ddFile=rA.daftar_dokumen_dd.find((d:any)=>d.nama===ddName).files?.[0];assert.match(ddFile.linkDrive,/^\/uploads\//);assert.ok(existsSync(uploadsPath(ddFile.linkDrive)),'DD file on disk');
 const rM=byId(data.contracts,'contract_id',cMaster.contract_id);assert.equal(rM.nilai_kontrak,2000000.25);assert.equal(rM.judul_kontrak,'Master updated');assert.deepEqual(rM.kategori_kerjasama,['Media','Tech']);assert.equal(rM.auto_renewal,true);
 assert.match(rM.link_file_kontrak,/^\/uploads\//);assert.equal(readFileSync(uploadsPath(rM.link_file_kontrak),'utf8'),'%PDF-1.4 v2');
 assert.equal(byId(data.contracts,'contract_id',cAdd.contract_id).parent_contract_id,cMaster.contract_id);
 assert.equal(byId(data.ios,'io_id',ioA.io_id).nilai_io,999.99);assert.match(byId(data.ios,'io_id',ioA.io_id).link_file_io,/^\/uploads\//);
 const rS=byId(data.spendings,'id',sA.id);assert.equal(rS.total_amount,15000001.25);assert.match(rS.invoice_file_url,/^\/uploads\//);assert.match(rS.billing_file_url,/^\/uploads\//);
 const multi=data.spendings.find((s:any)=>s.invoice_number==='DE-INV-002');assert.equal(multi.month_allocations.length,2);assert.equal(multi.month_allocations[1].amount,50.5);
 for(const kind of ['contracts','ios'])for(const row of data[kind])assert.equal('partner_nama' in row,false,`${kind} row carries partner_nama`);
 assert.equal(data.contracts.find((c:any)=>c.nomor_kontrak==='DE-IMP-C4').nilai_kontrak,1000000.5,'Indonesian decimal format');
 assert.equal(data.contracts.find((c:any)=>c.nomor_kontrak==='DE-IMP-C1').nilai_kontrak,1000000.5);
 assert.equal(data.contracts.find((c:any)=>c.nomor_kontrak==='777').nilai_kontrak,5000);
 const dmy=data.contracts.find((c:any)=>c.nomor_kontrak==='DE-IMP-C6');assert.equal(dmy.tanggal_mulai,'2026-03-15');assert.equal(dmy.tanggal_berakhir,'2027-03-14');
 assert.equal(data.contracts.some((c:any)=>c.nomor_kontrak==='DE-IMP-C5'),false);
 assert.equal(data.spendings.find((s:any)=>s.invoice_number==='DE-IMP-INV1').total_amount,2500000.75);
 const importedPartnerCountry=data.partners.find((p:any)=>p.nama_partner==='DE Imp Alpha');assert.equal(importedPartnerCountry.country,'ID');assert.deepEqual(importedPartnerCountry.tags,['Supplier','Media']);

 // ---- SQLite integrity, then persistence across a restart
 const sql=new Database(path.join(directory,'kaelyn.db'),{readonly:true});
 assert.equal(sql.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(sql.pragma('foreign_key_check'),[]);
 for(const table of ['partners','contracts','insertion_orders','spendings','evaluations']){const n=(sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE extra_json != '{}'`).get() as any).n;outcomes.push(`INFO  ${table}: ${n} rows keep unmapped fields in extra_json`);}
 sql.close();
 const counts=(d:any)=>['partners','contracts','ios','spendings','evaluations'].map(k=>d[k].length);
 const beforeRestart=counts(data);await stop(server);server=run(['apps/backend/dist/server.cjs']);await waitFor(backendURL+'/api/health',server);
 token=(await call('/api/auth/sign-in/email',{method:'POST',body:{email:'root@example.com',password},token:''})).token;
 const afterRestart=await initData();assert.deepEqual(counts(afterRestart),beforeRestart,'row counts after restart');
 assert.equal(byId(afterRestart.contracts,'contract_id',cMaster.contract_id).nilai_kontrak,2000000.25);assert.equal(byId(afterRestart.partners,'partner_id',pB.partner_id).nama_partner,unicodeName);
 const added=counts(afterRestart).map((n,i)=>n-counts(before)[i]);outcomes.push(`INFO  rows added (partners, contracts, ios, spendings, evaluations): ${added.join(', ')}`);

 // ---- Server log must be free of runtime errors
 const badLines=logs.join('').split('\n').filter(line=>errorLogPattern.test(line));
 if(badLines.length)problems.push(`server log: ${badLines.slice(0,5).join(' | ')}`);
 console.log(outcomes.join('\n'));
 if(problems.length){console.error('\nPROBLEMS:\n'+problems.map(p=>' - '+p).join('\n'));process.exitCode=1;}
 else console.log(`\nAll ${outcomes.filter(o=>!o.startsWith('INFO')).length} data-entry scenarios behaved correctly.`);
}catch(error){console.log(outcomes.join('\n'));console.error('PROBLEMS so far:\n'+problems.map(p=>' - '+p).join('\n'));throw error;}
finally{writeFileSync(path.join(directory,'servers.log'),logs.join(''));await stop(server);}
