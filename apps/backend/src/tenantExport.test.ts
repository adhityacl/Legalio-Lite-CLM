import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootApp, type Harness } from './testHarness';

let h: Harness;
const pdf = () => 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 export').toString('base64');

before(async () => {
  h = await bootApp({
    tag: 'export', orgs: [{ id: 'org-a', name: 'Org A' }, { id: 'org-b', name: 'Org B' }],
    users: [['adminA', 'org-a', 'admin'], ['editorA', 'org-a', 'editor'], ['managerA', 'org-a', 'manager'], ['adminB', 'org-b', 'admin']],
  });
  const seed = async (user: string, org: string, tag: string) => {
    const partner = (await h.api(user, 'POST', '/api/partners', { org, body: { partner_name: `Partner ${tag}`, country: 'ID' } })).body.partner;
    assert.ok(partner, 'partner');
    const contract = await h.api(user, 'POST', '/api/contracts', { org, body: { partner_id: partner.partner_id, contract_number: `CTR-${tag}`, contract_title: `=Contract ${tag}`, start_date: '2026-01-01', end_date: '2099-12-31', currency: 'USD', contract_value: 100, fileName: `${tag}.pdf`, fileData: pdf() } });
    assert.equal(contract.status, 200, contract.raw);
    await h.api(user, 'POST', '/api/partner-spendings', { org, body: { vendor_id: partner.partner_id, vendor_name: partner.partner_name, invoice_number: `INV-${tag}`, invoice_date: '2026-10-01', invoice_month: ['2026-10-31'], currency: 'USD', total_amount: 5 } });
  };
  await seed('adminA', 'org-a', 'A');
  await seed('adminB', 'org-b', 'B');
});
after(() => h?.close());

const unzipList = (zipPath: string) => execFileSync('python3', ['-I', '-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print("\\n".join(z.namelist()))', zipPath]).toString().trim().split('\n');
const unzipRead = (zipPath: string, name: string) => execFileSync('python3', ['-I', '-c', 'import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))', zipPath, name], { maxBuffer: 64 * 1024 * 1024 });

async function waitFor(org: string, id: string, user = 'adminA') {
  for (let i = 0; i < 100; i++) {
    const job = (await h.api(user, 'GET', `/api/organizations/${org}/exports/${id}`)).body;
    if (job.status !== 'queued' && job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('export did not finish');
}

test('only organization administrators can request, list or download exports', async () => {
  for (const user of ['editorA', 'managerA']) {
    assert.equal((await h.api(user, 'POST', '/api/organizations/org-a/exports', { body: {} })).status, 403, user);
    assert.equal((await h.api(user, 'GET', '/api/organizations/org-a/exports')).status, 403, user);
  }
  assert.equal((await h.request('GET', '/api/organizations/org-a/exports')).status, 401);
  assert.equal((await h.api('adminB', 'POST', '/api/organizations/org-a/exports', { body: {} })).status, 404, 'another organization');
});

test('an administrator exports the organization as a valid ZIP with only its own data, audited', async () => {
  const bad = await h.api('adminA', 'POST', '/api/organizations/org-a/exports', { body: { includeFiles: 'yes' } });
  assert.equal(bad.status, 400);
  const queued = await h.api('adminA', 'POST', '/api/organizations/org-a/exports', { body: { includeFiles: true } });
  assert.equal(queued.status, 202, queued.raw);
  assert.ok(['queued', 'running', 'succeeded'].includes(queued.body.status));
  const again = await h.api('adminA', 'POST', '/api/organizations/org-a/exports', { body: {} });
  assert.ok([202, 409].includes(again.status));
  const job = await waitFor('org-a', queued.body.id);
  assert.equal(job.status, 'succeeded', job.error);
  assert.ok(job.downloadUrl && new Date(job.expiresAt).getTime() > Date.now());
  assert.equal(job.summary.partners, 1);
  assert.equal(job.summary.contracts, 1);
  assert.equal(job.summary.files, 1);
  assert.equal(job.summary.filesIncluded, 1);

  // Another organization's administrator cannot see or download this job.
  assert.equal((await h.api('adminB', 'GET', `/api/organizations/org-b/exports/${job.id}`)).status, 404);
  assert.equal((await h.api('adminB', 'GET', `/api/organizations/org-a/exports/${job.id}/download`)).status, 404);

  const res = await fetch(h.base + job.downloadUrl, { headers: { authorization: `Bearer ${h.tokens.adminA}` } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  const zipPath = path.join(os.tmpdir(), `export-${job.id}.zip`);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.length, job.sizeBytes);
  fs.writeFileSync(zipPath, bytes);
  try {
    const names = unzipList(zipPath);
    for (const expected of ['export-info.json', 'settings.json', 'partners.json', 'partners.csv', 'contracts.json', 'contracts.csv', 'orders.json', 'spendings.json', 'evaluations.json', 'documents.json', 'approvals.json', 'activity-log.json', 'activity-log.csv', 'files-manifest.json']) {
      assert.ok(names.includes(expected), `${expected} in ${names.join(',')}`);
    }
    assert.equal(names.filter((n) => n.startsWith('files/')).length, 1, 'the uploaded file is included');
    const partners = JSON.parse(unzipRead(zipPath, 'partners.json').toString());
    assert.deepEqual(partners.map((p: any) => p.partner_name), ['Partner A']);
    const all = names.filter((n) => !n.startsWith('files/')).map((n) => unzipRead(zipPath, n).toString()).join('\n');
    assert.ok(!all.includes('Partner B') && !all.includes('CTR-B') && !all.includes('INV-B'), 'no data of the other organization');
    // Formula-like cells are neutralized in CSV.
    assert.ok(unzipRead(zipPath, 'contracts.csv').toString().includes("'=Contract A"));
    const manifest = JSON.parse(unzipRead(zipPath, 'files-manifest.json').toString());
    assert.equal(manifest[0].status, 'included');
    assert.match(manifest[0].sha256, /^[0-9a-f]{64}$/);
    const settings = JSON.parse(unzipRead(zipPath, 'settings.json').toString());
    assert.ok(settings.settings.policy && settings.members.some((m: any) => m.email === 'admina@example.com'));
    assert.ok(!/secret|password|api[_-]?key/i.test(JSON.stringify(settings)), 'settings.json carries no secrets');
  } finally { fs.rmSync(zipPath, { force: true }); }

  const audit = await h.sql.all(`SELECT action FROM audit_log WHERE tenant_id = 'org-a' AND target_type = 'export' ORDER BY created_at`);
  const actions = audit.map((a: any) => a.action);
  assert.ok(actions.includes('export.request.with_files') && actions.includes('export.download'), actions.join(','));
});

test('without the files flag the archive carries a manifest only, and an expired export can no longer be downloaded', async () => {
  const queued = await h.api('adminA', 'POST', '/api/organizations/org-a/exports', { body: {} });
  let job = queued.status === 202 ? await waitFor('org-a', queued.body.id) : null;
  if (!job) { // the previous test's second request may still have been running
    const list = (await h.api('adminA', 'GET', '/api/organizations/org-a/exports')).body.exports;
    job = await waitFor('org-a', list[0].id);
  }
  assert.equal(job.status, 'succeeded');
  assert.equal(job.summary.filesIncluded, 0);
  const { processExports } = await import('./tenantExport');
  await h.sql.run(`UPDATE export_jobs SET expires_at = ? WHERE id = ?`, new Date(Date.now() - 1000).toISOString(), job.id);
  assert.equal((await h.api('adminA', 'GET', `/api/organizations/org-a/exports/${job.id}/download`)).status, 410);
  const pass = await processExports(h.sql);
  assert.ok(pass.expired >= 1);
  assert.equal((await h.api('adminA', 'GET', `/api/organizations/org-a/exports/${job.id}`)).body.status, 'expired');
  assert.equal((await h.sql.get(`SELECT COUNT(*)::int AS n FROM export_job_chunks WHERE job_id = ?`, job.id)).n, 0);
  assert.equal((await h.api('adminA', 'GET', `/api/organizations/org-a/exports/${job.id}/download`)).status, 410);
});

test('a job that exceeds the size limit fails cleanly and an interrupted job is failed by the next pass', async () => {
  const { createExportJob, runExportJob, processExports, getExportJob } = await import('./tenantExport');
  await h.sql.exec(`UPDATE export_jobs SET status = 'failed' WHERE status IN ('queued','running')`);
  const big = await createExportJob(h.sql, { organizationId: 'org-a', requestedBy: 'adminA', includeFiles: false });
  const done = await runExportJob(h.sql, big.id, { maxBytes: 200 });
  assert.equal(done?.status, 'failed');
  assert.match(done!.error!, /exceeds/);
  assert.equal((await h.sql.get(`SELECT COUNT(*)::int AS n FROM export_job_chunks WHERE job_id = ?`, big.id)).n, 0);
  const stuck = await createExportJob(h.sql, { organizationId: 'org-a', requestedBy: 'adminA', includeFiles: false });
  await h.sql.run(`UPDATE export_jobs SET status = 'running', heartbeat_at = ? WHERE id = ?`, new Date(Date.now() - 3600_000).toISOString(), stuck.id);
  assert.equal((await processExports(h.sql)).interrupted, 1);
  assert.equal((await getExportJob(h.sql, 'org-a', stuck.id))?.status, 'failed');
});

test('the ZIP writer produces valid archives for stored, deflated, empty and large entries', async () => {
  const { createZipWriter } = await import('./zipWriter');
  const chunks: Buffer[] = [];
  const zip = createZipWriter((c) => { chunks.push(c); });
  await zip.addEntry('a.txt', 'hello');
  await zip.addEntry('dir/empty.txt', '');
  const big = Buffer.alloc(3_000_000, 'abcdefghij');
  await zip.addEntry('big.bin', (async function* () { for (let i = 0; i < big.length; i += 65536) yield big.subarray(i, i + 65536); })());
  await zip.addEntry('raw.pdf', Buffer.from('%PDF'), { store: true });
  await zip.finish();
  const file = path.join(os.tmpdir(), `zip-${Date.now()}.zip`);
  fs.writeFileSync(file, Buffer.concat(chunks));
  try {
    assert.deepEqual(unzipList(file), ['a.txt', 'dir/empty.txt', 'big.bin', 'raw.pdf']);
    assert.equal(unzipRead(file, 'a.txt').toString(), 'hello');
    assert.equal(unzipRead(file, 'big.bin').equals(big), true);
  } finally { fs.rmSync(file, { force: true }); }
  await assert.rejects(zip.addEntry('late.txt', 'x'));
});
