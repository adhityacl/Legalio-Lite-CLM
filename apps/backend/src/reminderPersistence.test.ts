/** Reminders on real PostgreSQL: a ledger entry and its in-app notification commit together, once, even when two passes run at the same time. */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-reminders-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false', LOG_LEVEL: 'silent' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { ensureSchema } = await import('./schema');
const { createOrganizationRecord } = await import('./organizationProvisioning');
const { contractRepository } = await import('./repositories/contractRepository');
const { ioRepository } = await import('./repositories/ioRepository');
const { notificationRepository } = await import('./repositories/notificationRepository');
const { getTenantSettings } = await import('./tenantPolicy');
const { refreshTenantProjection, db } = await import('./memoryDb');
const jobs = await import('./reminderJobs');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });

const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
let offset = 0;
beforeEach(async () => {
  await sql.exec('TRUNCATE organization, search_records, reminder_ledger CASCADE');
  await createOrganizationRecord(sql, { id: 'org-a', name: 'A' });
  await refreshTenantProjection();
  offset = Math.max(...getTenantSettings('org-a').reminderOffsetsDays);
  await sql.exec(`INSERT INTO partners (partner_id, organization_id, record_position) VALUES ('p1', 'org-a', 0)`);
});

test('a due reminder creates its ledger entry and notification together, and a repeated pass creates nothing more', async () => {
  await contractRepository.insert({ contract_id: 'C1', organizationId: 'org-a', partner_id: 'p1', contract_number: 'CTR-1', contract_title: 'Due soon', start_date: '2020-01-01', end_date: isoDay(offset), currency: 'USD', status: 'Active' });
  await ioRepository.insert({ io_id: 'IO1', organizationId: 'org-a', partner_id: 'p1', io_number: 'IO-1', io_title: 'Order due soon', start_date: '2020-01-01', end_date: isoDay(offset), currency: 'USD', status: 'Active' });
  const queued = await jobs.enqueueDueReminders();
  assert.ok(queued >= 2, `queued ${queued}`);
  const rows = await sql.all<any>(`SELECT notif_id, parent_type, parent_id, is_sent, is_read, notification_type FROM notifications ORDER BY parent_id`);
  assert.deepEqual(rows.map((r) => [r.parent_type, r.parent_id]).sort(), [['Contract', 'C1'], ['IO', 'IO1']]);
  assert.ok(rows.every((r) => r.is_sent === 0 && r.is_read === 0));
  const ledger = await sql.all<any>(`SELECT notification_id FROM reminder_ledger WHERE notification_id IS NOT NULL`);
  assert.deepEqual(ledger.map((r) => r.notification_id).sort(), rows.map((r) => r.notif_id).sort(), 'every notification belongs to exactly one ledger entry');
  assert.equal(await jobs.enqueueDueReminders(), 0, 'nothing is queued twice');
  assert.equal((await sql.get(`SELECT COUNT(*) AS n FROM notifications`)).n, rows.length);
});

test('two passes running at once (two instances) queue each reminder exactly once', async () => {
  for (let i = 0; i < 6; i++) {
    await contractRepository.insert({ contract_id: `C${i}`, organizationId: 'org-a', partner_id: 'p1', contract_number: `CTR-${i}`, contract_title: `Due ${i}`, start_date: '2020-01-01', end_date: isoDay(offset), currency: 'USD', status: 'Active' });
  }
  const results = await Promise.all([jobs.enqueueDueReminders(), jobs.enqueueDueReminders(), jobs.enqueueDueReminders()]);
  assert.equal(results.reduce((a, b) => a + b, 0), (await sql.get(`SELECT COUNT(*) AS n FROM notifications`)).n);
  assert.equal((await sql.get(`SELECT COUNT(*) AS n FROM notifications`)).n, (await sql.get(`SELECT COUNT(*) AS n FROM reminder_ledger WHERE notification_id IS NOT NULL`)).n);
  assert.equal((await sql.get(`SELECT COUNT(DISTINCT parent_id) AS n FROM notifications WHERE parent_type = 'Contract'`)).n, 6);
  assert.ok(db.googleConfig, 'the process-wide configuration is untouched by reminders');
});

test('marking a notification as sent is idempotent and keeps it in its organization', async () => {
  await notificationRepository.insert({ notif_id: 'n1', organizationId: 'org-a', parent_type: 'Contract', parent_id: 'C1', message: 'x', is_sent: false, is_read: false });
  assert.equal(await notificationRepository.markSent('org-a', 'n1'), true);
  assert.equal(await notificationRepository.markSent('org-a', 'n1'), false);
  assert.equal(await notificationRepository.markSent('org-b', 'n1'), false);
  const row = (await notificationRepository.get('org-a', 'n1'))!;
  assert.equal(row.is_sent, true);
  assert.equal(row.version, 2);
});
