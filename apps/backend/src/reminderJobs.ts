import crypto from 'crypto';
import { onDbSaved, db } from './memoryDb';
import { seedLedgerFromLegacy, planReminders, existingKeys as existingReminderKeys, enqueue as enqueueReminder, ReminderSender, deliverDue as deliverDueReminders, createReminderScheduler, schedulerOptionsFromEnv } from './reminders';
import { sql } from './db';
import { contractLifecycleMode, contractLifecycle } from '@legalio/shared/contractLifecycle';
import { contractRepository } from './repositories/contractRepository';
import { ioRepository } from './repositories/ioRepository';
import { notificationRepository } from './repositories/notificationRepository';
import { getTenantSettings, findTenant, computeLifecycle } from './tenantPolicy';
import { todayInTimezone } from '@legalio/shared/policy';
import { normalizeContractStatus } from '@legalio/types/domainStatus';
import { componentLog } from './logger';
import { formatAmountForTenant, buildReminderEmail, sendSmtpEmail } from './mailHelpers';
import { IS_TEST_MODE } from './runtimePaths';
/** Date-driven contract/IO lifecycle refresh, the reminder outbox (enqueue, deliver, retry) and the in-process scheduler. */

// Declared up here because saveDb() already runs during startup, before later `let`s are initialised.
// Statuses only change when a date passes or a contract is saved, so a minute-old pass is as good as a new one.
let lifecyclesFreshUntil = 0;
onDbSaved(() => { lifecyclesFreshUntil = 0; });
/** Notifications written by releases without a ledger count as already sent for the record's current renewal cycle. */
export async function seedReminderLedger() {
  const records = new Map((await reminderRecords()).map((item) => [`${item.kind}:${item.recordId}`, item]));
  const entries: Array<{ organizationId: string; kind: "contract" | "commercial"; recordId: string; cycleEnd: string; offsetDays: number }> = [];
  for (const notification of await notificationRepository.legacyReminders()) {
    const match = /^Reminder (?:(\d+)d|H-(\d+))$/.exec(notification.notification_type || "");
    if (!match) continue;
    const offsetDays = Number(match[1] ?? match[2]);
    const item = records.get(`${notification.parent_type === "Contract" ? "contract" : "commercial"}:${notification.parent_id}`);
    if (!item || !item.record.organizationId || item.daysRemaining > offsetDays) continue; // a reminder of an earlier cycle
    entries.push({ organizationId: item.record.organizationId, kind: item.kind, recordId: item.recordId, cycleEnd: item.cycleEnd, offsetDays });
  }
  const seeded = await seedLedgerFromLegacy(sql, entries);
  if (seeded) reminderLog.info(`Reminder ledger seeded with ${seeded} earlier reminder(s).`);
}
/** Roll an auto-renewing contract's end date forward past "today" (tenant timezone). */
export function rollForwardAutoRenewal(contract: any): void {
  if (contractLifecycleMode(contract) === 'terminated') return;
  if (!contract.auto_renewal || !contract.start_date || !contract.end_date) return;
  const settings = getTenantSettings(contract.organizationId);
  const today = todayInTimezone(settings.timezone);
  const start = String(contract.start_date).slice(0, 10);
  let end = String(contract.end_date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end >= today) return;
  const years = Math.max(1, Number(end.slice(0, 4)) - Number(start.slice(0, 4)) || 1);
  let guard = 0;
  while (end < today && guard++ < 200) {
    end = `${Number(end.slice(0, 4)) + years}${end.slice(4)}`;
  }
  contract.end_date = end;
}
/** Recipients from the record's OWNING organization (PRD §11.5), never global config. */
export function reminderRecipients(tenantId: string, kind: "contract" | "commercial", owner: string | undefined, admins: string[]): string {
  const notifications = findTenant(tenantId)?.notifications || { notificationEmails: [], legalNotificationEmail: null, financeNotificationEmail: null };
  const dedicated = kind === "contract" ? notifications.legalNotificationEmail : notifications.financeNotificationEmail;
  const configured = dedicated ? [dedicated] : notifications.notificationEmails || [];
  return Array.from(new Set([owner, ...configured, ...admins].filter(Boolean))).join(", ");
}
/** Recomputes lifecycle status (and rolls auto-renewals forward) for contracts and commercial documents. Sends nothing. */
export async function recalculateStatuses() {
  await refreshStoredContractLifecycles();
  await refreshStoredIoLifecycles();
}
/**
 * Refreshes the derived status / days_remaining of stored insertion orders, row by row and without a new version (a display value
 * is not an edit). Each row is re-read under a row lock, so a concurrent user edit is never overwritten with old data.
 */
async function refreshStoredIoLifecycles(): Promise<number> {
  const apply = (io: any) => {
    const { daysRemaining, status } = computeLifecycle(io.organizationId, io.end_date, io.status, false);
    const remaining = daysRemaining ?? io.days_remaining;
    const changed = io.status !== status || io.days_remaining !== remaining;
    if (changed) { io.status = status; io.days_remaining = remaining; }
    return changed;
  };
  let updated = 0;
  // A stored Terminated status is final until the order is edited, so those rows are never scanned.
  for await (const batch of ioRepository.batches(500, "status IS DISTINCT FROM 'Terminated'")) {
    for (const stale of batch) {
      if (!apply({ ...stale })) continue;
      await ioRepository.mutate(stale.organizationId, stale.io_id, (row) => (apply(row) ? undefined : false), { bumpVersion: false });
      updated++;
    }
  }
  return updated;
}
/**
 * Rolls auto-renewals forward and refreshes the derived status / days_remaining of stored contracts, row by row. A stale
 * display value is rewritten without a new version (nobody's edit becomes outdated); a rolled-forward end date gets one.
 * Each row is re-read under a row lock, so a concurrent user edit is never overwritten with old data.
 */
async function refreshStoredContractLifecycles(): Promise<number> {
  const settingsByOrg = new Map<string, ReturnType<typeof getTenantSettings>>();
  const apply = (contract: any) => {
    const previousEnd = contract.end_date;
    rollForwardAutoRenewal(contract);
    const orgKey = String(contract.organizationId ?? "");
    if (!settingsByOrg.has(orgKey)) settingsByOrg.set(orgKey, getTenantSettings(contract.organizationId));
    const lifecycle = contractLifecycle(contract, settingsByOrg.get(orgKey)!);
    const remaining = lifecycle.daysRemaining ?? contract.days_remaining;
    const changed = previousEnd !== contract.end_date || contract.status !== lifecycle.status || contract.days_remaining !== remaining;
    if (changed) { contract.status = lifecycle.status; contract.days_remaining = remaining; }
    return { changed, endMoved: previousEnd !== contract.end_date };
  };
  let updated = 0;
  // A stored Terminated status is final until the contract is edited (an edit recomputes it), so those rows are never scanned.
  for await (const batch of contractRepository.batches(500, "status IS DISTINCT FROM 'Terminated'")) {
    for (const stale of batch) {
      if (!apply({ ...stale }).changed) continue;
      let endMoved = false;
      await contractRepository.mutate(stale.organizationId, stale.contract_id, (row) => {
        const outcome = apply(row);
        endMoved = outcome.endMoved;
        return outcome.changed ? undefined : false;
      }, { bumpVersion: () => endMoved });
      updated++;
    }
  }
  return updated;
}
export const REMINDER_NOTICE_LEAD_DAYS = Math.max(0, Number(process.env.REMINDER_NOTICE_LEAD_DAYS ?? 7) || 0);
export const reminderLog = componentLog("reminders");
type ReminderRecord = { kind: "contract" | "commercial"; record: any; recordId: string; cycleEnd: string; daysRemaining: number };
function contractReminder(contract: any): ReminderRecord | null {
  const { daysRemaining, status } = contractLifecycle(contract, getTenantSettings(contract.organizationId));
  if (status === "Terminated" || daysRemaining === null || !contract.end_date) return null;
  return { kind: "contract", record: contract, recordId: contract.contract_id, cycleEnd: String(contract.end_date).slice(0, 10), daysRemaining };
}
function commercialReminder(io: any): ReminderRecord | null {
  if (normalizeContractStatus(io.status) === "Terminated" || !io.end_date) return null;
  const { daysRemaining } = computeLifecycle(io.organizationId, io.end_date, io.status, false);
  if (daysRemaining === null) return null;
  return { kind: "commercial", record: io, recordId: io.io_id, cycleEnd: String(io.end_date).slice(0, 10), daysRemaining };
}
/** Records that can carry reminders right now, with their renewal cycle (end date) and remaining days. */
export async function reminderRecords(): Promise<ReminderRecord[]> {
  const found: ReminderRecord[] = [];
  for await (const batch of contractRepository.batches(500, "status IS DISTINCT FROM 'Terminated'")) {
    for (const contract of batch) { const item = contractReminder(contract); if (item) found.push(item); }
  }
  for await (const batch of ioRepository.batches(500, "status IS DISTINCT FROM 'Terminated'")) {
    for (const io of batch) { const item = commercialReminder(io); if (item) found.push(item); }
  }
  return found;
}
/** One ledger row's record, looked up directly (a delivery pass must not scan every contract per row). */
async function reminderRecordFor(row: { organization_id: string; kind: string; record_id: string }): Promise<ReminderRecord | null> {
  if (row.kind === "contract") {
    const contract = await contractRepository.get(row.organization_id, row.record_id);
    return contract ? contractReminder(contract) : null;
  }
  const io = await ioRepository.get(row.organization_id, row.record_id);
  return io ? commercialReminder(io) : null;
}
export function reminderContent(item: ReminderRecord, trigger: "offset" | "notice", offsetDays: number) {
  const { kind, record, daysRemaining } = item;
  const settings = getTenantSettings(record.organizationId);
  // en/id/zh in that order, matching settings.language.
  const pick = <T,>(en: T, id: T, zh: T): T => (settings.language === "ID" ? id : settings.language === "ZH" ? zh : en);
  const reference = kind === "contract" ? record.contract_number : record.io_number;
  const title = kind === "contract" ? record.contract_title : record.io_title;
  const noticeType = record.notice_type_required || "Termination";
  const noticeDays = record.notice_period_days || 30;
  const message = trigger === "notice"
    ? pick(
      `${reference} (${title}): the ${noticeType} notice deadline is here (${noticeDays} days before expiry, ${daysRemaining} days left).`,
      `${reference} (${title}): batas pemberitahuan ${noticeType} tiba (${noticeDays} hari sebelum berakhir, sisa ${daysRemaining} hari).`,
      `${reference}（${title}）：${noticeType}通知期限已到（到期前 ${noticeDays} 天，剩余 ${daysRemaining} 天）。`,
    )
    : pick(
      `${reference} (${title}) expires in ${daysRemaining} days.${kind === "contract" ? ` ${noticeType} notice is due ${noticeDays} days before expiry.` : ""}`,
      `${reference} (${title}) berakhir dalam ${daysRemaining} hari.${kind === "contract" ? ` Pemberitahuan ${noticeType} diperlukan ${noticeDays} hari sebelumnya.` : ""}`,
      `${reference}（${title}）将在 ${daysRemaining} 天后到期。${kind === "contract" ? `需在到期前 ${noticeDays} 天发出${noticeType}通知。` : ""}`,
    );
  return { settings, pick, reference, title, noticeType, noticeDays, message, type: trigger === "notice" ? "Notice deadline" : `Reminder ${offsetDays}d` };
}
/** Finds due reminders and records them in the ledger (once per record, renewal cycle and trigger) with an in-app notification. */
export async function enqueueDueReminders(): Promise<number> {
  const adminEmails = new Map<string, string[]>();
  for (const row of await sql.all(`
    SELECT m."organizationId", u.email FROM member m JOIN "user" u ON u.id = m."userId"
    WHERE m.status = 'active' AND m.role IN ('admin', 'manager') AND u.banned IS NOT TRUE
  `)) adminEmails.set(row.organizationId, [...(adminEmails.get(row.organizationId) || []), row.email]);
  let queued = 0;
  for (const item of await reminderRecords()) {
    const tenantId = item.record.organizationId;
    if (!findTenant(tenantId)) continue; // unowned records get no reminders
    const settings = getTenantSettings(tenantId);
    const input = { daysRemaining: item.daysRemaining, offsets: settings.reminderOffsetsDays, noticeDays: item.record.notice_period_days ? Number(item.record.notice_period_days) : null, noticeLeadDays: REMINDER_NOTICE_LEAD_DAYS };
    if (!planReminders({ ...input, existing: new Set() }).length) continue;
    const planned = planReminders({ ...input, existing: await existingReminderKeys(sql, item.kind, item.recordId, item.cycleEnd) });
    for (const plan of planned) {
      const content = reminderContent(item, plan.trigger, plan.offsetDays);
      const recipients = reminderRecipients(tenantId, item.kind, item.record.internal_pic && String(item.record.internal_pic).includes("@") ? item.record.internal_pic : "", adminEmails.get(tenantId) || []);
      const entry = { organizationId: tenantId, kind: item.kind, recordId: item.recordId, cycleEnd: item.cycleEnd, trigger: plan.trigger, offsetDays: plan.offsetDays, recipients };
      if (plan.skip) { await enqueueReminder(sql, { ...entry, skip: true }); continue; }
      const notificationId = `notif-${item.kind === "contract" ? "ctr" : "doc"}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
      // The ledger entry and the in-app notification commit together; a pass or instance that got there first makes this a no-op.
      const created = await sql.tx(async () => {
        if (!await enqueueReminder(sql, { ...entry, notificationId })) return false;
        await notificationRepository.insert({
        notif_id: notificationId,
        organizationId: tenantId,
        parent_type: item.kind === "contract" ? "Contract" : "IO",
        parent_id: item.recordId,
        parent_number: content.reference,
        parent_title: content.title,
        notification_type: content.type,
        sent_at: new Date().toISOString(),
        // Becomes true only once the e-mail was delivered.
        is_sent: false,
        recipient: recipients,
        message: content.message,
        // Lets the UI render the message in the viewer's language; `message` stays in the organization language.
        ...(plan.trigger === "offset" ? { message_params: { kind: item.kind, daysRemaining: item.daysRemaining, noticeType: content.noticeType, noticeDays: content.noticeDays } } : {}),
        is_read: false,
        });
        return true;
      });
      if (created) queued++;
    }
  }
  return queued;
}
/** Sends one ledger row through the platform SMTP relay. */
export const sendLedgerReminder: ReminderSender = async (row) => {
  const found = await reminderRecordFor(row);
  const item = found && found.cycleEnd === row.cycle_end_date ? found : undefined;
  if (!item) return { ok: false, skipped: true, error: "record changed or removed" };
  if (!db.googleConfig?.smtpEnabled) return { ok: false, skipped: true, error: "SMTP relay disabled" };
  const validRecipients = String(row.recipients || "").split(",").map((s) => s.trim()).filter((s) => s.includes("@"));
  if (!validRecipients.length) return { ok: false, skipped: true, error: "no recipients" };
  const content = reminderContent(item, row.trigger, row.offset_days);
  const { pick, noticeDays, noticeType, reference, title } = content;
  const tenantId = item.record.organizationId;
  const rows: Array<[string, string]> = [
    [pick("Value", "Nilai", "金额"), formatAmountForTenant(item.kind === "contract" ? item.record.contract_value : item.record.io_value, item.record.currency, tenantId)],
  ];
  if (item.kind === "contract") {
    rows.push([pick("Notice period", "Periode pemberitahuan", "通知期"), `${noticeDays} ${pick("days", "hari", "天")} (${noticeType})`]);
    rows.push([pick("Auto-renewal", "Perpanjangan otomatis", "自动续约"), item.record.auto_renewal ? pick("Yes", "Ya", "是") : pick("No", "Tidak", "否")]);
  } else {
    rows.push([pick("Pricing model", "Model harga", "定价模式"), item.record.pricing_model || "-"]);
  }
  const { subject, html } = await buildReminderEmail({
    tenantId, kind: item.kind, reference, title, endDate: item.record.end_date, daysRemaining: item.daysRemaining, rows, variant: row.trigger,
  });
  const result = await sendSmtpEmail({ to: validRecipients, subject, html });
  return result.success ? { ok: true } : { ok: false, error: String(result.error || "SMTP send failed") };
};
export async function deliverReminders() {
  const result = await deliverDueReminders(sql, sendLedgerReminder, {
    onSent: async (row) => {
      if (row.notification_id) await notificationRepository.markSent(row.organization_id, row.notification_id);
    },
  });
  if (result.attempted) reminderLog.info(`Reminder delivery: ${result.sent} sent, ${result.failed} failed (will retry), ${result.dead} abandoned, ${result.skipped} skipped.`);
  return result;
}
/** Full pass: refresh statuses, queue what is due, deliver (with retries). Used by the scheduler and POST /api/cron/trigger-check. */
export async function runReminderPass() {
  await recalculateStatuses();
  const queued = await enqueueDueReminders();
  const delivery = await deliverReminders();
  reminderLog.info(`Reminder pass finished: ${queued} queued.`);
  return { queued, delivery };
}
export const reminderScheduler = createReminderScheduler({
  ...schedulerOptionsFromEnv(process.env, IS_TEST_MODE),
  fullPass: runReminderPass,
  retryPass: async () => { await deliverReminders(); },
});
export function stopReminderScheduler() {
  return reminderScheduler.stop();
}
let lifecycleRefresh: Promise<void> | null = null;
/** Reads refresh date-driven status without sending reminders or requiring a cron run. Concurrent reads share one in-flight refresh, so none returns before its save lands. */
export function refreshContractLifecycles(): Promise<void> {
  return lifecycleRefresh ??= refreshLifecyclesOnce().finally(() => { lifecycleRefresh = null; });
}
export async function refreshLifecyclesOnce() {
  if (Date.now() < lifecyclesFreshUntil) return;
  lifecyclesFreshUntil = Date.now() + 60_000;
  await refreshStoredContractLifecycles();
}
