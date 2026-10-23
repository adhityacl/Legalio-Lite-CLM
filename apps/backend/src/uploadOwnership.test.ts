import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Needs PostgreSQL at TEST_DATABASE_URL (see testDatabase.ts).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-uploads-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { ensureSchema } = await import('./schema');
const { backfillUploadOwners, eligibleOwners, forgetUploadOwners, newUploadKey, recordUploadOwner, uploadOwnerOf } = await import('./uploadOwnership');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });

test('new object keys use the organization id and a random segment, not names', () => {
  const a = newUploadKey('org-1', 'Folder Contract', 'file.pdf');
  const b = newUploadKey('org-1', 'Folder Contract', 'file.pdf');
  assert.match(a, /^org-1\/[0-9a-f]{24}\/Folder Contract\/file\.pdf$/);
  assert.notEqual(a, b);
  assert.ok(newUploadKey('org-1', 'x', '../..').split('/').every((segment) => !segment.startsWith('.')));
});

test('a recorded owner is never reassigned', async () => {
  await recordUploadOwner(sql, 'org-a/x/c/f.pdf', 'org-a');
  await recordUploadOwner(sql, 'org-a/x/c/f.pdf', 'org-b');
  assert.equal(await uploadOwnerOf(sql, 'org-a/x/c/f.pdf'), 'org-a');
});

test('cross-tenant: a record in another organization that contains the path does not vouch for it', async () => {
  const key = 'org-a/abc/Folder DD/proof.pdf';
  await recordUploadOwner(sql, key, 'org-a');
  const inferred = [
    { kind: 'partner', record: { organizationId: 'org-a', linkDrive: `/uploads/${key}` } },
    { kind: 'partner', record: { organizationId: 'org-b', linkDrive: `/uploads/${key}` } }, // forged reference
  ];
  const eligible = await eligibleOwners(sql, key, inferred);
  assert.deepEqual(eligible.map((item) => item.record.organizationId), ['org-a']);
  // Only the forging organization references it: nobody is eligible, so the route answers 404.
  assert.deepEqual(await eligibleOwners(sql, key, [inferred[1]]), []);
});

test('legacy keys without a recorded owner fall back to inference', async () => {
  const inferred = [{ kind: 'contract', record: { organizationId: 'org-c' } }];
  assert.equal((await eligibleOwners(sql, 'Old Org/Vendor/Folder IO/a.pdf', inferred)).length, 1);
});

test('backfill assigns single-organization references once and leaves ambiguous ones unassigned', async () => {
  const records = [
    { organizationId: 'org-1', record: { contract_file_link: '/uploads/Acme/Vendor/Folder%20Contract/a.pdf' } },
    { organizationId: 'org-1', record: { nested: { files: [{ linkDrive: '/uploads/Acme/Vendor/Folder%20DD/b.pdf' }] } } },
    { organizationId: 'org-1', record: { io_file_link: '/uploads/Shared/V/Folder%20IO/c.pdf' } },
    { organizationId: 'org-2', record: { io_file_link: '/uploads/Shared/V/Folder%20IO/c.pdf' } },
    { organizationId: null, record: { x: '/uploads/Orphan/V/d.pdf' } },
  ];
  const first = await backfillUploadOwners(sql, records);
  assert.deepEqual({ ...first }, { skipped: false, assigned: 2, ambiguous: 1 });
  assert.equal(await uploadOwnerOf(sql, 'Acme/Vendor/Folder Contract/a.pdf'), 'org-1');
  assert.equal(await uploadOwnerOf(sql, 'Acme/Vendor/Folder DD/b.pdf'), 'org-1');
  assert.equal(await uploadOwnerOf(sql, 'Shared/V/Folder IO/c.pdf'), null);
  assert.equal(await uploadOwnerOf(sql, 'Orphan/V/d.pdf'), null);
  assert.equal((await backfillUploadOwners(sql, records)).skipped, true);
});

test('owners can be forgotten per organization', async () => {
  await recordUploadOwner(sql, 'org-z/1/c/f.pdf', 'org-z');
  await forgetUploadOwners(sql, { organizationId: 'org-z' });
  assert.equal(await uploadOwnerOf(sql, 'org-z/1/c/f.pdf'), null);
});
