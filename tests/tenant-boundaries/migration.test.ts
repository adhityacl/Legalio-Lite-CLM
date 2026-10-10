/**
 * Migration 002_tenant_boundaries against synthetic legacy fixtures (PRD §14, AC-036, AC-037).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { analyze, applyMigration, sourceDigest } from '../../apps/backend/src/migrations/002_tenant_boundaries';
import { main as cli, parseArgs } from '../../tools/migrate-tenant-boundaries';

let dir: string;

/** Legacy pre-boundary shape: global roles, owner/legal memberships, metadata settings, orgless records. */
function legacyDatabase(file: string, options: { ambiguousOwner?: boolean; conflictingDuplicate?: boolean } = {}) {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL, image TEXT, createdAt DATE NOT NULL, updatedAt DATE NOT NULL, role TEXT, banned INTEGER, banReason TEXT, banExpires DATE);
    CREATE TABLE session (id TEXT PRIMARY KEY, expiresAt DATE NOT NULL, token TEXT NOT NULL UNIQUE, createdAt DATE NOT NULL, updatedAt DATE NOT NULL, ipAddress TEXT, userAgent TEXT, userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, impersonatedBy TEXT, activeOrganizationId TEXT, activeTeamId TEXT);
    CREATE TABLE organization (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE, logo TEXT, createdAt DATE, metadata TEXT);
    CREATE TABLE team (id TEXT PRIMARY KEY, name TEXT NOT NULL, memberCount INTEGER DEFAULT 0, organizationId TEXT NOT NULL, createdAt DATE, updatedAt DATE);
    CREATE TABLE teamMember (id TEXT PRIMARY KEY, teamId TEXT NOT NULL, userId TEXT NOT NULL, membershipKey TEXT, createdAt DATE);
    CREATE TABLE member (id TEXT PRIMARY KEY, organizationId TEXT NOT NULL, userId TEXT NOT NULL, role TEXT NOT NULL, createdAt DATE);
    CREATE TABLE invitation (id TEXT PRIMARY KEY, organizationId TEXT NOT NULL, email TEXT NOT NULL, role TEXT, teamId TEXT, status TEXT NOT NULL, expiresAt DATE, createdAt DATE, inviterId TEXT NOT NULL);
    CREATE TABLE app_settings (id TEXT PRIMARY KEY, organizationId TEXT, payload TEXT NOT NULL, updatedAt TEXT);
    CREATE TABLE partners (id TEXT PRIMARY KEY, partner_id TEXT, organizationId TEXT, payload TEXT NOT NULL, createdAt TEXT, updatedAt TEXT);
    CREATE TABLE tenants (id TEXT PRIMARY KEY, organizationId TEXT, payload TEXT NOT NULL, createdAt TEXT, updatedAt TEXT);
  `);
  const now = '2026-01-01T00:00:00.000Z';
  const user = db.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role, banned) VALUES (?, ?, ?, 1, ?, ?, ?, 0)`);
  user.run('u-super', 'Super', 'super@example.test', now, now, 'superuser');
  user.run('u-admin', 'Admin', 'admin@example.test', now, now, 'admin');
  user.run('u-multi', 'Multi', 'multi@example.test', now, now, options.ambiguousOwner ? 'owner' : 'manager');
  const meta = (country: string) => JSON.stringify({ legalEntity: 'PT Example', primaryColor: '#112233', settings: { countryCode: country }, driveFolderId: `drive_${country}_folder01` });
  db.prepare(`INSERT INTO organization VALUES (?, ?, ?, NULL, ?, ?)`).run('org-a', 'Alpha', 'alpha', now, meta('ID'));
  db.prepare(`INSERT INTO organization VALUES (?, ?, ?, NULL, ?, ?)`).run('org-b', 'Beta', 'beta', now, meta('SG'));
  db.prepare(`INSERT INTO team VALUES ('t-a-legal', 'Legal', 0, 'org-a', ?, ?)`).run(now, now);
  db.prepare(`INSERT INTO team VALUES ('t-b-legal', 'Legal', 0, 'org-b', ?, ?)`).run(now, now);
  const member = db.prepare(`INSERT INTO member VALUES (?, ?, ?, ?, ?)`);
  member.run('m-admin', 'org-a', 'u-admin', 'owner', now);
  member.run('m-multi-a', 'org-a', 'u-multi', 'legal', now);
  member.run('m-multi-b', 'org-b', 'u-multi', 'staff', now);
  if (options.conflictingDuplicate) member.run('m-multi-a2', 'org-a', 'u-multi', 'viewer', '2026-02-01');
  member.run('m-admin-b', 'org-b', 'u-admin', 'admin', now);
  db.prepare(`INSERT INTO teamMember VALUES ('tm1', 't-a-legal', 'u-multi', NULL, ?)`).run(now);
  db.prepare(`INSERT INTO teamMember VALUES ('tm2', 't-b-legal', 'u-multi', NULL, ?)`).run(now);
  db.prepare(`INSERT INTO app_settings VALUES ('google_config', NULL, ?, ?)`).run(JSON.stringify({ geminiApiKey: 'secret-value', notificationEmails: 'ops@example.test', driveFolderId: 'masterRootFolder01' }), now);
  db.prepare(`INSERT INTO partners VALUES ('P1', 'P1', 'org-a', ?, ?, ?)`).run(JSON.stringify({ partner_id: 'P1', organizationId: 'org-a', pic_internal: 'Legal' }), now, now);
  db.prepare(`INSERT INTO partners VALUES ('P2', 'P2', NULL, ?, ?, ?)`).run(JSON.stringify({ partner_id: 'P2', pic_internal: 'Legal' }), now, now);
  db.prepare(`INSERT INTO session VALUES ('s1', ?, 'tok', ?, ?, NULL, NULL, 'u-admin', NULL, 'org-a', NULL)`).run('2099-01-01', now, now);
  return db;
}

const resolutionsFor = (report: any) => report.conflicts.map((c: any) => {
  if (c.kind === 'global-notification-recipients') return { conflictId: c.conflictId, decision: 'set-settings-field', organizationId: 'org-a', fieldPath: 'notifications.notificationEmails', value: ['ops@example.test'] };
  if (c.kind === 'unowned-resource') return { conflictId: c.conflictId, decision: 'quarantine-resource' };
  throw new Error(`unexpected conflict ${c.kind}`);
});

before(async () => { dir = await mkdtemp(join(tmpdir(), 'tb-migration-')); });
after(async () => { await rm(dir, { recursive: true, force: true }); });

describe('dry-run, apply and reapply (AC-036)', () => {
  it('dry-run is read-only and redacted; apply preserves multi-organization data; reapply changes nothing', async () => {
    const file = join(dir, 'case1.db');
    legacyDatabase(file).close();
    const ro = new Database(file, { readonly: true });
    const digest = sourceDigest(ro);
    const report = analyze(ro);
    assert.equal(sourceDigest(ro), digest);
    ro.close();
    const text = JSON.stringify(report);
    for (const secret of ['secret-value', 'admin@example.test', 'ops@example.test']) assert.ok(!text.includes(secret), secret);
    assert.equal(report.counts.providerSecretsPresent && (report.counts.providerSecretsPresent as any).geminiApiKey, true);
    assert.deepEqual(report.conflicts.map((c) => c.kind).sort(), ['global-notification-recipients', 'unowned-resource']);

    const db = new Database(file);
    assert.throws(() => applyMigration(db, null), /has no resolution/);
    const mapping = { formatVersion: 1, migrationId: report.migrationId, sourceDigest: report.sourceDigest, resolutions: resolutionsFor(report) };
    const result = applyMigration(db, mapping);
    assert.equal(result.report.applied, true);
    const roles = Object.fromEntries((db.prepare(`SELECT id, role FROM "user"`).all() as any[]).map((u) => [u.id, u.role]));
    assert.deepEqual(roles, { 'u-super': 'superuser', 'u-admin': 'user', 'u-multi': 'user' });
    const members = Object.fromEntries((db.prepare(`SELECT id, role, status FROM member`).all() as any[]).map((m) => [m.id, `${m.role}/${m.status}`]));
    assert.deepEqual(members, { 'm-admin': 'admin/active', 'm-multi-a': 'manager/active', 'm-multi-b': 'viewer/active', 'm-admin-b': 'admin/active' });
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM teamMember`).get() as any).n, 2); // other-organization assignment kept
    const settings = JSON.parse((db.prepare(`SELECT payload FROM organization_settings WHERE organizationId = 'org-a'`).get() as any).payload);
    assert.equal(settings.profile.legalEntity, 'PT Example');
    assert.deepEqual(settings.notifications.notificationEmails, ['ops@example.test']);
    const settingsB = JSON.parse((db.prepare(`SELECT payload FROM organization_settings WHERE organizationId = 'org-b'`).get() as any).payload);
    assert.deepEqual(settingsB.notifications.notificationEmails, []); // never copied to every tenant
    assert.equal((db.prepare(`SELECT driveFolderId FROM organization_integrations WHERE organizationId = 'org-a'`).get() as any).driveFolderId, 'drive_ID_folder01');
    const platform = JSON.parse((db.prepare(`SELECT payload FROM app_settings WHERE id = 'google_config'`).get() as any).payload);
    assert.equal(platform.notificationEmails, undefined);
    assert.equal(platform.geminiApiKey, 'secret-value');
    assert.equal((db.prepare(`SELECT organizationId FROM partners WHERE id = 'P2'`).get() as any).organizationId, null);
    assert.ok(db.prepare(`SELECT 1 FROM migration_quarantine WHERE record_id = 'P2'`).get());
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM session`).get() as any).n, 0);
    const digestAfter = sourceDigest(db);
    const again = applyMigration(db, null);
    assert.equal(again.report.applied, false);
    assert.equal(sourceDigest(db), digestAfter);
    db.close();
  });
});

describe('ambiguity blocks apply (AC-037)', () => {
  it('a bare global owner and conflicting duplicate memberships refuse apply without a partial marker', () => {
    const file = join(dir, 'case2.db');
    const db = legacyDatabase(file, { ambiguousOwner: true, conflictingDuplicate: true });
    const report = analyze(db);
    const kinds = report.conflicts.map((c) => c.kind);
    assert.ok(kinds.includes('ambiguous-platform-role'));
    assert.ok(kinds.includes('conflicting-duplicate-membership'));
    const digest = sourceDigest(db);
    assert.throws(() => applyMigration(db, { formatVersion: 1, migrationId: report.migrationId, sourceDigest: report.sourceDigest, resolutions: resolutionsFor({ conflicts: report.conflicts.filter((c) => ['global-notification-recipients', 'unowned-resource'].includes(c.kind)) }) }), /has no resolution/);
    assert.equal(sourceDigest(db), digest);
    assert.equal(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'schema_migrations'`).get(), undefined);
    db.close();
  });

  it('rejects stale digests, unknown conflicts and invalid resolutions', () => {
    const file = join(dir, 'case3.db');
    const db = legacyDatabase(file, { ambiguousOwner: true });
    const report = analyze(db);
    const base = { formatVersion: 1, migrationId: report.migrationId, sourceDigest: report.sourceDigest };
    assert.throws(() => applyMigration(db, { ...base, sourceDigest: 'stale', resolutions: [] }), /sourceDigest/);
    assert.throws(() => applyMigration(db, { ...base, resolutions: [{ conflictId: 'nope', decision: 'quarantine-resource' }] }), /unknown conflictId/);
    const owner = report.conflicts.find((c) => c.kind === 'ambiguous-platform-role')!;
    assert.throws(() => applyMigration(db, { ...base, resolutions: [{ conflictId: owner.conflictId, decision: 'quarantine-resource' }] }), /not permitted/);
    assert.throws(() => applyMigration(db, { ...base, resolutions: [{ conflictId: owner.conflictId, decision: 'set-platform-role', userId: 'u-admin', platformRole: 'superuser' }] }), /must name the conflict identity/);
    const resolved = applyMigration(db, { ...base, resolutions: [
      { conflictId: owner.conflictId, decision: 'set-platform-role', userId: 'u-multi', platformRole: 'user' },
      ...resolutionsFor({ conflicts: report.conflicts.filter((c) => c.kind !== 'ambiguous-platform-role') }),
    ] });
    assert.equal(resolved.report.applied, true);
    db.close();
  });
});

describe('CLI contract (PRD §14.1)', () => {
  it('validates flags and paths, dry-runs by default and never overwrites a backup', async () => {
    const file = join(dir, 'case4.db');
    legacyDatabase(file).close();
    assert.throws(() => parseArgs(['--db', 'relative.db', '--report', join(dir, 'r.json')]), /absolute/);
    assert.throws(() => parseArgs(['--db', file]), /required/);
    assert.throws(() => parseArgs(['--db', file, '--report', join(dir, 'r.json'), '--apply', '--dry-run', '--backup', join(dir, 'b.db')]), /either/);
    assert.throws(() => parseArgs(['--db', file, '--report', join(dir, 'r.json'), '--apply']), /requires --backup/);
    assert.throws(() => parseArgs(['--db', file, '--report', join(dir, 'r.json'), '--apply', '--backup', file]), /differ/);
    assert.throws(() => parseArgs(['--db', file, '--report', join(dir, 'r.json'), '--force']), /Unknown flag/);
    await cli(['--db', file, '--report', join(dir, 'dry.json')]);
    const report = JSON.parse(await readFile(join(dir, 'dry.json'), 'utf8'));
    assert.equal(report.formatVersion, 1);
    assert.equal(report.applied, false);
    await writeFile(join(dir, 'map.json'), JSON.stringify({ formatVersion: 1, migrationId: report.migrationId, sourceDigest: report.sourceDigest, resolutions: resolutionsFor(report) }));
    await cli(['--db', file, '--report', join(dir, 'apply.json'), '--mapping', join(dir, 'map.json'), '--apply', '--backup', join(dir, 'before.db')]);
    assert.ok(existsSync(join(dir, 'before.db')));
    const backup = new Database(join(dir, 'before.db'), { readonly: true });
    assert.equal((backup.prepare(`SELECT role FROM "user" WHERE id = 'u-admin'`).get() as any).role, 'admin');
    backup.close();
    assert.throws(() => parseArgs(['--db', file, '--report', join(dir, 'x.json'), '--apply', '--backup', join(dir, 'before.db')]), /already exists/);
  });
});
